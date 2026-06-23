import type express from "express";
import { prisma } from "../../db/prisma";
import { sendApiError } from "../../shared/http";
import { requireAuth, resolveRequestUser } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { normalizeCanvasStateToWorkflowSchema, parseWorkflowSchema, redactWorkflowState } from "./workflow-schema.service";

function ownerWhere(ownerId: string, isGuest: boolean) {
  return isGuest ? { ownerId: null } : { ownerId };
}

function getCanvasStatePayload(body: any) {
  return body?.canvas || body?.state || body?.reactFlow;
}

function serializeWorkflow(workflow: any) {
  const latestVersion = workflow.versions?.[0];
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description || undefined,
    ownerId: workflow.ownerId || undefined,
    draftRevision: workflow.draftRevision || 0,
    createdAt: workflow.createdAt?.toISOString?.() || workflow.createdAt,
    updatedAt: workflow.updatedAt?.toISOString?.() || workflow.updatedAt,
    latestVersion: latestVersion
      ? {
          id: latestVersion.id,
          version: latestVersion.version,
          schema: latestVersion.schemaJson,
          canvas: latestVersion.reactFlowJson || undefined,
          createdAt: latestVersion.createdAt?.toISOString?.() || latestVersion.createdAt
        }
      : null
  };
}

function serializeWorkflowVersion(version: any) {
  return {
    id: version.id,
    workflowId: version.workflowId,
    version: version.version,
    schemaJson: redactWorkflowState(version.schemaJson),
    canvasJson: version.reactFlowJson ? redactWorkflowState(version.reactFlowJson) : null,
    createdAt: version.createdAt?.toISOString?.() || version.createdAt
  };
}

function serializeWorkflowRunSummary(run: any) {
  return {
    id: run.id,
    workflowId: run.workflowId,
    versionId: run.versionId,
    status: run.status,
    error: run.error,
    startedAt: run.startedAt?.toISOString?.() || run.startedAt,
    finishedAt: run.finishedAt?.toISOString?.() || run.finishedAt,
    createdAt: run.createdAt?.toISOString?.() || run.createdAt
  };
}

async function assertWorkflowOwner(workflowId: string, requestUser: Awaited<ReturnType<typeof resolveRequestUser>>) {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      ...ownerWhere(requestUser.id, requestUser.isGuest)
    }
  });
  return workflow;
}

export function registerWorkflowRoutes(app: express.Express) {
  app.get("/api/workflows", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const workflows = await prisma.workflow.findMany({
        where: ownerWhere(requestUser.id, requestUser.isGuest),
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 1
          }
        }
      });

      res.json({ success: true, workflows: workflows.map(serializeWorkflow) });
    } catch (error: any) {
      console.error("[Workflow] Failed to list workflows:", error);
      sendApiError(res, error, "Failed to list workflows.");
    }
  });

  app.get("/api/workflows/:id", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const workflow = await prisma.workflow.findFirst({
        where: {
          id: req.params.id,
          ...ownerWhere(requestUser.id, requestUser.isGuest)
        },
        include: {
          versions: { orderBy: { version: "desc" }, take: 20 },
          runs: {
            where: { ownerId: requestUser.id },
            orderBy: { createdAt: "desc" },
            take: 20
          }
        }
      });

      if (!workflow) {
        res.status(404).json({ success: false, error: "Workflow not found." });
        return;
      }

      res.json({
        success: true,
        workflow: serializeWorkflow(workflow),
        versions: workflow.versions.map(serializeWorkflowVersion),
        runs: workflow.runs.map(serializeWorkflowRunSummary)
      });
    } catch (error: any) {
      console.error("[Workflow] Failed to fetch workflow:", error);
      sendApiError(res, error, "Failed to fetch workflow.");
    }
  });

  app.post("/api/workflows", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const name = String(req.body?.name || "Untitled workflow").trim();
      const description = req.body?.description ? String(req.body.description).trim() : null;
      const schema = req.body?.schema
        ? parseWorkflowSchema(req.body.schema)
        : normalizeCanvasStateToWorkflowSchema(getCanvasStatePayload(req.body) || {});
      const canvasState = getCanvasStatePayload(req.body);
      const reactFlowJson = canvasState ? redactWorkflowState(canvasState) : null;

      const workflow = await prisma.$transaction(async (tx) => {
        const createdWorkflow = await tx.workflow.create({
          data: {
            ownerId: requestUser.isGuest ? null : requestUser.id,
            name,
            description
          }
        });
        const version = await tx.workflowVersion.create({
          data: {
            workflowId: createdWorkflow.id,
            version: 1,
            schemaJson: schema,
            reactFlowJson
          }
        });
        return { ...createdWorkflow, versions: [version] };
      });

      await writeAuditLog({
        actor: requestUser,
        action: "CREATE",
        entityType: "Workflow",
        entityId: workflow.id,
        afterJson: { name, version: 1 }
      });

      res.status(201).json({ success: true, workflow: serializeWorkflow(workflow) });
    } catch (error: any) {
      console.error("[Workflow] Failed to create workflow:", error);
      sendApiError(res, error, "Failed to create workflow.");
    }
  });

  app.post("/api/workflows/:id/versions", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const existing = await assertWorkflowOwner(req.params.id, requestUser);
      if (!existing) {
        res.status(404).json({ success: false, error: "Workflow not found." });
        return;
      }

      const schema = req.body?.schema
        ? parseWorkflowSchema(req.body.schema)
        : normalizeCanvasStateToWorkflowSchema(getCanvasStatePayload(req.body) || {});
      const canvasState = getCanvasStatePayload(req.body);
      const reactFlowJson = canvasState ? redactWorkflowState(canvasState) : null;

      const result = await prisma.$transaction(async (tx) => {
        const latest = await tx.workflowVersion.findFirst({
          where: { workflowId: existing.id },
          orderBy: { version: "desc" },
          select: { version: true }
        });
        const nextVersion = (latest?.version || 0) + 1;
        const version = await tx.workflowVersion.create({
          data: {
            workflowId: existing.id,
            version: nextVersion,
            schemaJson: schema,
            reactFlowJson
          }
        });
        const workflow = await tx.workflow.update({
          where: { id: existing.id },
          data: {
            ...(req.body?.name ? { name: String(req.body.name).trim() } : {}),
            ...(req.body?.description !== undefined ? { description: req.body.description ? String(req.body.description).trim() : null } : {})
          },
          include: { versions: { where: { id: version.id } } }
        });
        return { workflow, version };
      });

      await writeAuditLog({
        actor: requestUser,
        action: "UPDATE",
        entityType: "Workflow",
        entityId: existing.id,
        beforeJson: { name: existing.name, description: existing.description },
        afterJson: { version: result.version.version }
      });

      res.json({ success: true, workflow: serializeWorkflow(result.workflow), version: result.version });
    } catch (error: any) {
      console.error("[Workflow] Failed to create workflow version:", error);
      sendApiError(res, error, "Failed to create workflow version.");
    }
  });

  app.delete("/api/workflows/:id", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const existing = await assertWorkflowOwner(req.params.id, requestUser);
      if (!existing) {
        res.status(404).json({ success: false, error: "Workflow not found." });
        return;
      }

      await prisma.workflow.delete({ where: { id: existing.id } });
      await writeAuditLog({
        actor: requestUser,
        action: "DELETE",
        entityType: "Workflow",
        entityId: existing.id,
        beforeJson: { name: existing.name }
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("[Workflow] Failed to delete workflow:", error);
      sendApiError(res, error, "Failed to delete workflow.");
    }
  });
}



