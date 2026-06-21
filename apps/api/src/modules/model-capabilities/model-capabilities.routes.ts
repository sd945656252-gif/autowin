import type express from "express";
import { ModelCapability, UserRole } from "@prisma/client";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth, requireRoles } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { prisma } from "../../db/prisma";
import { capabilityToType, serializeCustomApiConfig } from "../custom-api-configs/custom-api-configs.shared";
import {
  createCapabilityRevision,
  findCapabilityProfileForModel,
  listCapabilityProfiles,
  listExecutableCapabilityProfiles,
  metadataFromCapabilityParams,
  normalizeCapability,
  normalizeCapabilityStatus,
  serializeCapabilityProfile
} from "./model-capabilities.service";
import {
  loadOfficialCapabilityEntries,
  probeOfficialJson,
  probeOfficialUrl,
  syncOfficialCapabilityJson
} from "./official-capability-sync.service";
import { CAPABILITY_REGISTRY } from "./model-capabilities.registry";

async function loadMergedRegistry() {
  const byCanonicalId = new Map(CAPABILITY_REGISTRY.map((entry) => [entry.canonicalModelId, entry]));
  try {
    const officialEntries = await loadOfficialCapabilityEntries();
    for (const entry of officialEntries) {
      byCanonicalId.set(entry.canonicalModelId, entry);
    }
  } catch (error) {
    console.warn("[ModelCapabilities] Failed to load trusted capability JSON for registry view:", error);
  }
  return Array.from(byCanonicalId.values()).sort((a, b) => {
    const capabilityOrder = String(a.capability).localeCompare(String(b.capability));
    if (capabilityOrder !== 0) return capabilityOrder;
    return String(a.canonicalModelId).localeCompare(String(b.canonicalModelId));
  });
}

export function registerModelCapabilityRoutes(app: express.Express) {
  app.get("/api/model-capabilities", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const capability = req.query.capability ? normalizeCapability(req.query.capability) : undefined;
      const profiles = await listCapabilityProfiles(capability);
      const revealSensitive = requestUser.role === UserRole.ADMIN || requestUser.role === UserRole.DEVELOPER;
      res.json({ success: true, capabilities: profiles.map((profile) => serializeCapabilityProfile(profile, { revealSensitive })) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to list model capabilities.");
    }
  });

  app.post("/api/model-capabilities/normalize", async (req, res) => {
    try {
      await requireAuth(req);
      const capability = normalizeCapability(req.body?.capability);
      const profile = await findCapabilityProfileForModel({
        provider: req.body?.provider,
        modelName: req.body?.modelName,
        canonicalModelId: req.body?.canonicalModelId,
        capability
      });
      if (!profile) {
        throw new HttpError(404, "Model is not registered in the backend capability registry.", "MODEL_CAPABILITY_NOT_REGISTERED");
      }
      res.json({ success: true, capability: serializeCapabilityProfile(profile) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to normalize model capability.");
    }
  });

  app.post("/api/model-capabilities/sync-official-json", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const results = await syncOfficialCapabilityJson({ actor: requestUser });
      await writeAuditLog({
        actor: requestUser,
        action: "UPDATE",
        entityType: "ModelCapabilityProfile",
        req,
        metadata: {
          operation: "sync_official_json_all",
          changedCount: results.filter((item) => item.changed).length,
          resultCount: results.length,
          canonicalModelIds: results.map((item) => item.capability.canonicalModelId)
        }
      });
      res.json({ success: true, results });
    } catch (error: any) {
      sendApiError(res, error, "Failed to sync official capability JSON.");
    }
  });

  app.get("/api/model-capabilities/registry", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      res.json({ success: true, registry: await loadMergedRegistry() });
    } catch (error: any) {
      sendApiError(res, error, "Failed to load registry.");
    }
  });

  app.post("/api/model-capabilities/registry/apply", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const { canonicalModelId, configId } = req.body as { canonicalModelId?: string; configId?: string };
      if (!canonicalModelId) throw new HttpError(400, "canonicalModelId is required.", "MISSING_CANONICAL_MODEL_ID");

      const registry = await loadMergedRegistry();
      const entry = registry.find((item) => item.canonicalModelId === canonicalModelId);
      if (!entry) throw new HttpError(404, "Registry entry not found.", "REGISTRY_ENTRY_NOT_FOUND");

      let capabilityProfile: any;
      const officialResults = await syncOfficialCapabilityJson({ canonicalModelId, actor: requestUser }).catch(() => []);
      if (officialResults[0]?.capability) {
        capabilityProfile = officialResults[0].capability;
      } else {
        const updated = await createCapabilityRevision({
          canonicalModelId,
          capability: entry.capability,
          params: entry.params,
          status: entry.verificationStatus as any,
          sourceUrls: entry.sourceUrls,
          changedSummary: "Applied from static registry",
          createdById: requestUser.id
        });
        capabilityProfile = serializeCapabilityProfile(updated);
      }

      let config: any = null;
      let beforeConfig: any = null;
      if (configId && !String(configId).startsWith("draft_")) {
        const existing = await prisma.customApiConfig.findFirst({ where: { id: configId, ownerId: null } });
        if (!existing) throw new HttpError(404, "Custom API config not found.", "CUSTOM_API_CONFIG_NOT_FOUND");
        beforeConfig = {
          alias: existing.alias,
          provider: existing.provider,
          type: existing.type,
          capability: existing.capability,
          modelName: existing.modelName,
          canonicalModelId: existing.canonicalModelId,
          activeCapabilityRevisionId: existing.activeCapabilityRevisionId
        };
        config = await prisma.customApiConfig.update({
          where: { id: existing.id },
          data: {
            provider: entry.provider,
            modelName: entry.officialModelId || existing.modelName,
            type: capabilityToType(entry.capability),
            capability: entry.capability,
            canonicalModelId: entry.canonicalModelId,
            activeCapabilityRevisionId: capabilityProfile.activeRevisionId,
            metadata: metadataFromCapabilityParams(entry) || undefined
          }
        });
      }

      await writeAuditLog({
        actor: requestUser,
        action: "UPDATE",
        entityType: config ? "CustomApiConfig" : "ModelCapabilityRevision",
        entityId: config?.id || capabilityProfile.activeRevisionId,
        req,
        metadata: {
          canonicalModelId,
          operation: config ? "apply_registry_entry_to_config" : "apply_registry_entry",
          configId: config?.id || null,
          capability: entry.capability,
          verificationStatus: capabilityProfile.verificationStatus
        },
        beforeJson: beforeConfig,
        afterJson: config ? {
          alias: config.alias,
          provider: config.provider,
          type: config.type,
          capability: config.capability,
          modelName: config.modelName,
          canonicalModelId: config.canonicalModelId,
          activeCapabilityRevisionId: config.activeCapabilityRevisionId
        } : undefined
      });
      res.json({
        success: true,
        capability: capabilityProfile,
        config: config ? serializeCustomApiConfig(config) : null
      });
    } catch (error: any) {
      sendApiError(res, error, "Failed to apply registry entry.");
    }
  });

  app.post("/api/model-capabilities/probe-official-url", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const probe = await probeOfficialUrl({
        url: req.body?.url,
        canonicalModelId: req.body?.canonicalModelId,
        capability: req.body?.capability
      });
      await writeAuditLog({
        actor: requestUser,
        action: "ACCESS",
        entityType: "ModelCapabilityOfficialProbe",
        entityId: req.body?.canonicalModelId ? String(req.body.canonicalModelId) : null,
        req,
        metadata: {
          operation: "probe_custom_official_url",
          canonicalModelId: req.body?.canonicalModelId || null,
          host: probe.host,
          matchedCanonicalModel: probe.matchedCanonicalModel,
          modelHintCount: probe.candidate.modelHints.length,
          sizeHintCount: probe.candidate.sizeHints.length,
          ratioHintCount: probe.candidate.ratioHints.length,
          durationHintCount: probe.candidate.durationHints.length
        }
      });
      res.json({ success: true, probe });
    } catch (error: any) {
      sendApiError(res, error, "Failed to probe official documentation URL.");
    }
  });

  app.get("/api/model-capabilities/:canonicalModelId", async (req, res) => {
    try {
      await requireAuth(req);
      const capability = req.query.capability ? normalizeCapability(req.query.capability) : undefined;
      const profile = await findCapabilityProfileForModel({
        canonicalModelId: req.params.canonicalModelId,
        capability: capability || ModelCapability.IMAGE_GENERATOR
      }) || await findCapabilityProfileForModel({
        canonicalModelId: req.params.canonicalModelId,
        capability: ModelCapability.VIDEO_GENERATOR
      });
      if (!profile) throw new HttpError(404, "Model capability profile not found.", "MODEL_CAPABILITY_PROFILE_NOT_FOUND");
      res.json({ success: true, capability: serializeCapabilityProfile(profile) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to load model capability.");
    }
  });

  app.get("/api/model-capabilities/:canonicalModelId/revisions", async (req, res) => {
    try {
      await requireAuth(req);
      const capability = req.query.capability ? normalizeCapability(req.query.capability) : undefined;
      const profile = await findCapabilityProfileForModel({
        canonicalModelId: req.params.canonicalModelId,
        capability: capability || ModelCapability.IMAGE_GENERATOR
      }) || await findCapabilityProfileForModel({
        canonicalModelId: req.params.canonicalModelId,
        capability: ModelCapability.VIDEO_GENERATOR
      });
      if (!profile) throw new HttpError(404, "Model capability profile not found.", "MODEL_CAPABILITY_PROFILE_NOT_FOUND");
      res.json({ success: true, revisions: (profile as any).revisions || [] });
    } catch (error: any) {
      sendApiError(res, error, "Failed to list capability revisions.");
    }
  });

  app.post("/api/model-capabilities/:canonicalModelId/revisions", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const capability = req.body?.capability ? normalizeCapability(req.body.capability) : undefined;
      const params = req.body?.params;
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        throw new HttpError(400, "params must be an object.", "INVALID_CAPABILITY_PARAMS");
      }
      const updated = await createCapabilityRevision({
        canonicalModelId: req.params.canonicalModelId,
        capability,
        params,
        status: req.body?.verificationStatus ? normalizeCapabilityStatus(req.body.verificationStatus) : undefined,
        sourceUrls: Array.isArray(req.body?.sourceUrls) ? req.body.sourceUrls.map(String).slice(0, 10) : undefined,
        changedSummary: req.body?.changedSummary ? String(req.body.changedSummary).slice(0, 1000) : null,
        createdById: requestUser.id
      });
      await writeAuditLog({
        actor: requestUser,
        action: "UPDATE",
        entityType: "ModelCapabilityRevision",
        entityId: updated.activeRevisionId,
        req,
        metadata: {
          canonicalModelId: updated.canonicalModelId,
          capability: updated.capability,
          verificationStatus: updated.verificationStatus
        }
      });
      res.json({ success: true, capability: serializeCapabilityProfile(updated) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to create capability revision.");
    }
  });

  app.post("/api/model-capabilities/:canonicalModelId/probe-official", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const probes = await probeOfficialJson(req.params.canonicalModelId);
      await writeAuditLog({
        actor: requestUser,
        action: "ACCESS",
        entityType: "ModelCapabilityOfficialProbe",
        entityId: req.params.canonicalModelId,
        req,
        metadata: {
          operation: "probe_official_json",
          canonicalModelId: req.params.canonicalModelId,
          resultCount: probes.length
        }
      });
      res.json({ success: true, probes });
    } catch (error: any) {
      sendApiError(res, error, "Failed to probe official capability JSON.");
    }
  });

  app.post("/api/model-capabilities/:canonicalModelId/sync-official", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const results = await syncOfficialCapabilityJson({ canonicalModelId: req.params.canonicalModelId, actor: requestUser });
      await writeAuditLog({
        actor: requestUser,
        action: "UPDATE",
        entityType: "ModelCapabilityProfile",
        entityId: req.params.canonicalModelId,
        req,
        metadata: {
          operation: "sync_official_json_entry",
          canonicalModelId: req.params.canonicalModelId,
          changedCount: results.filter((item) => item.changed).length,
          resultCount: results.length
        }
      });
      res.json({ success: true, results });
    } catch (error: any) {
      sendApiError(res, error, "Failed to sync official capability JSON entry.");
    }
  });

  app.get("/api/workflow/models/usable", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const capability = normalizeCapability(req.query.capability);
      const profiles = await listExecutableCapabilityProfiles(capability);
      const revealSensitive = requestUser.role === UserRole.ADMIN || requestUser.role === UserRole.DEVELOPER;
      res.json({ success: true, models: profiles.map((profile) => serializeCapabilityProfile(profile, { revealSensitive })) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to list usable workflow models.");
    }
  });
}
