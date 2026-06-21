import type express from "express";
import { z } from "zod";
import { AuditAction, UserRole } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth, requireRoles } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { isPromptOptimizationProfileKey, PROMPT_OPTIMIZATION_DEFAULTS } from "./prompt-optimization.defaults";

const updateProfileSchema = z.object({
  systemPrompt: z.string().trim().min(20).max(30_000),
  isEnabled: z.boolean().optional()
});

export async function ensurePromptOptimizationProfiles() {
  const existingProfiles = await prisma.promptOptimizationProfile.findMany({
    where: { key: { in: PROMPT_OPTIMIZATION_DEFAULTS.map((profile) => profile.key) } }
  });
  const existingByKey = new Map(existingProfiles.map((profile) => [profile.key, profile]));
  for (const profile of PROMPT_OPTIMIZATION_DEFAULTS) {
    const existing = existingByKey.get(profile.key);
    if (!existing) {
      await prisma.promptOptimizationProfile.create({
        data: {
          key: profile.key,
          label: profile.label,
          description: profile.description,
          systemPrompt: profile.systemPrompt,
          defaultSystemPrompt: profile.systemPrompt,
          sortOrder: profile.sortOrder
        }
      });
      continue;
    }
    if (
      existing.label !== profile.label ||
      existing.description !== profile.description ||
      existing.defaultSystemPrompt !== profile.systemPrompt ||
      existing.sortOrder !== profile.sortOrder
    ) {
      await prisma.promptOptimizationProfile.update({
        where: { key: profile.key },
        data: {
          label: profile.label,
          description: profile.description,
          defaultSystemPrompt: profile.systemPrompt,
          sortOrder: profile.sortOrder
        }
      });
    }
  }
}

function serializePromptOptimizationProfile(profile: any) {
  return {
    id: profile.id,
    key: profile.key,
    label: profile.label,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    defaultSystemPrompt: profile.defaultSystemPrompt,
    isEnabled: profile.isEnabled,
    sortOrder: profile.sortOrder,
    updatedById: profile.updatedById,
    updatedAt: profile.updatedAt?.toISOString?.() || profile.updatedAt,
    createdAt: profile.createdAt?.toISOString?.() || profile.createdAt
  };
}

async function findProfileByKey(key: string) {
  if (!isPromptOptimizationProfileKey(key)) {
    throw new HttpError(404, "Prompt optimization profile not found.", "PROMPT_OPTIMIZATION_PROFILE_NOT_FOUND");
  }
  await ensurePromptOptimizationProfiles();
  const profile = await prisma.promptOptimizationProfile.findUnique({ where: { key } });
  if (!profile) {
    throw new HttpError(404, "Prompt optimization profile not found.", "PROMPT_OPTIMIZATION_PROFILE_NOT_FOUND");
  }
  return profile;
}

export function registerPromptOptimizationRoutes(app: express.Express) {
  app.get("/api/prompt-optimization/profiles", async (req, res) => {
    try {
      await requireAuth(req);
      await ensurePromptOptimizationProfiles();
      const profiles = await prisma.promptOptimizationProfile.findMany({
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }]
      });
      res.json({ success: true, profiles: profiles.map(serializePromptOptimizationProfile) });
    } catch (error: any) {
      console.error("[PromptOptimization] Failed to list profiles:", error);
      sendApiError(res, error, "Failed to list prompt optimization profiles.");
    }
  });

  app.put("/api/prompt-optimization/profiles/:key", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const existing = await findProfileByKey(req.params.key);
      const body = updateProfileSchema.parse(req.body || {});
      const profile = await prisma.promptOptimizationProfile.update({
        where: { key: existing.key },
        data: {
          systemPrompt: body.systemPrompt,
          ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
          updatedById: requestUser.id
        }
      });
      await writeAuditLog({
        actor: requestUser,
        action: AuditAction.UPDATE,
        entityType: "PromptOptimizationProfile",
        entityId: profile.id,
        req,
        metadata: { key: profile.key },
        beforeJson: serializePromptOptimizationProfile(existing),
        afterJson: serializePromptOptimizationProfile(profile)
      });
      res.json({ success: true, profile: serializePromptOptimizationProfile(profile) });
    } catch (error: any) {
      console.error("[PromptOptimization] Failed to update profile:", error);
      sendApiError(res, error, "Failed to update prompt optimization profile.");
    }
  });

  app.post("/api/prompt-optimization/profiles/:key/reset", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const existing = await findProfileByKey(req.params.key);
      const profile = await prisma.promptOptimizationProfile.update({
        where: { key: existing.key },
        data: {
          systemPrompt: existing.defaultSystemPrompt,
          isEnabled: true,
          updatedById: requestUser.id
        }
      });
      await writeAuditLog({
        actor: requestUser,
        action: AuditAction.UPDATE,
        entityType: "PromptOptimizationProfile",
        entityId: profile.id,
        req,
        metadata: { key: profile.key, reset: true },
        beforeJson: serializePromptOptimizationProfile(existing),
        afterJson: serializePromptOptimizationProfile(profile)
      });
      res.json({ success: true, profile: serializePromptOptimizationProfile(profile) });
    } catch (error: any) {
      console.error("[PromptOptimization] Failed to reset profile:", error);
      sendApiError(res, error, "Failed to reset prompt optimization profile.");
    }
  });
}
