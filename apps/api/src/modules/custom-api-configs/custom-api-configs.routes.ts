import type express from "express";
import { prisma } from "../../db/prisma";
import { encryptSecret, createKeyPreview } from "../../security/crypto";
import { assertSafeOutboundUrl } from "../../security/outbound-url";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth, requireRoles } from "../auth/auth.shared";
import { UserRole } from "@prisma/client";
import { writeAuditLog } from "../audit/audit.service";
import { normalizeTypeAndCapability, serializeCustomApiConfig, serializePublicModelConfig, normalizeModelCapability } from "./custom-api-configs.shared";
import { bindCapabilityForConfig, findCapabilityProfileForModel, metadataFromCapabilityParams } from "../model-capabilities/model-capabilities.service";

function normalizeProvider(value: unknown) {
  const provider = String(value || "Custom").trim().slice(0, 80);
  if (!provider) return "Custom";
  if (!/^[\p{L}\p{N} ._()\-]+$/u.test(provider)) {
    throw new HttpError(400, "provider contains unsupported characters.");
  }
  return provider;
}

function activeRevisionFor(profile: any) {
  const activeId = profile?.activeRevisionId;
  const revisions = Array.isArray(profile?.revisions) ? profile.revisions : [];
  return profile?.activeRevision || revisions.find((revision: any) => revision.id === activeId) || revisions[0] || null;
}

async function attachCapabilityProfile(config: any) {
  if (!config?.canonicalModelId) return config;
  const capabilityProfile = await prisma.modelCapabilityProfile.findFirst({
    where: { canonicalModelId: config.canonicalModelId, capability: config.capability },
    include: { revisions: { orderBy: { revision: "desc" }, take: 5 } }
  });
  return { ...config, capabilityProfile: capabilityProfile ? { ...capabilityProfile, activeRevision: activeRevisionFor(capabilityProfile) } : null };
}

export function registerCustomApiConfigRoutes(app: express.Express) {
  app.get("/api/model-configs", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const capability = normalizeModelCapability(req.query.capability || "TEXT_GENERATOR");
      const configs = await prisma.customApiConfig.findMany({
        where: {
          ownerId: null,
          isEnabled: true,
          capability,
          ...(requestUser.role === UserRole.USER ? { userAccessEnabled: true } : {})
        },
        orderBy: [{ updatedAt: "desc" }, { alias: "asc" }]
      });
      const canonicalIds = Array.from(new Set(configs.map((config) => config.canonicalModelId).filter(Boolean) as string[]));
      const profiles = canonicalIds.length > 0
        ? await prisma.modelCapabilityProfile.findMany({
            where: { canonicalModelId: { in: canonicalIds } },
            include: { revisions: { orderBy: { revision: "desc" }, take: 5 } }
          })
        : [];
      const profileByCanonicalId = new Map(profiles
        .filter((profile) => profile.capability === capability)
        .map((profile) => [profile.canonicalModelId, profile]));
      const revealSensitive = requestUser.role === UserRole.ADMIN || requestUser.role === UserRole.DEVELOPER;
      res.json({
        success: true,
        models: configs.map((config) => serializePublicModelConfig(
          { ...config, capabilityProfile: config.canonicalModelId ? profileByCanonicalId.get(config.canonicalModelId) : null },
          { revealSensitive }
        ))
      });
    } catch (error: any) {
      console.error("[ModelConfig] Failed to list models:", error);
      sendApiError(res, error, "Failed to list model configs.");
    }
  });

  app.get("/api/custom-api-configs", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const configs = await prisma.customApiConfig.findMany({
        where: { ownerId: null, isEnabled: true },
        orderBy: { updatedAt: "desc" }
      });
      const canonicalIds = Array.from(new Set(configs.map((config) => config.canonicalModelId).filter(Boolean) as string[]));
      const profiles = canonicalIds.length > 0
        ? await prisma.modelCapabilityProfile.findMany({
            where: { canonicalModelId: { in: canonicalIds } },
            include: { revisions: { orderBy: { revision: "desc" }, take: 5 } }
          })
        : [];
      const profileByKey = new Map(profiles.map((profile) => [`${profile.capability}:${profile.canonicalModelId}`, { ...profile, activeRevision: activeRevisionFor(profile) }]));
      res.json({
        success: true,
        configs: configs.map((config) => serializeCustomApiConfig({
          ...config,
          capabilityProfile: config.canonicalModelId ? profileByKey.get(`${config.capability}:${config.canonicalModelId}`) : null
        }))
      });
    } catch (error: any) {
      console.error("[CustomApiConfig] Failed to list configs:", error);
      sendApiError(res, error, "Failed to list custom API configs.");
    }
  });

  app.post("/api/custom-api-configs", async (req, res) => {
    try {
      const { alias, provider, type, capability, baseUrl, modelName, apiKey, metadata, isEnabled = true, userAccessEnabled = false } = req.body || {};
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);

      if (!alias || !type || !baseUrl || !modelName) {
        res.status(400).json({ success: false, error: "alias, type, baseUrl and modelName are required." });
        return;
      }
      const normalized = normalizeTypeAndCapability({ type, capability });
      const normalizedProvider = normalizeProvider(provider);
      await assertSafeOutboundUrl(String(baseUrl).trim(), "baseUrl");
      const requestedCanonicalModelId = String(req.body?.canonicalModelId || "").trim();
      let binding: { canonicalModelId: string | null; activeCapabilityRevisionId: string | null; profile: any };
      if (requestedCanonicalModelId) {
        const profile = await findCapabilityProfileForModel({ provider: normalizedProvider, canonicalModelId: requestedCanonicalModelId, capability: normalized.capability });
        if (!profile) {
          throw new HttpError(400, "Selected capability template does not match this model capability.", "MODEL_CAPABILITY_TEMPLATE_MISMATCH", {
            canonicalModelId: requestedCanonicalModelId,
            capability: normalized.capability
          });
        }
        binding = { canonicalModelId: profile.canonicalModelId, activeCapabilityRevisionId: profile.activeRevisionId, profile };
      } else {
        binding = await bindCapabilityForConfig({
          provider: normalizedProvider,
          capability: normalized.capability,
          modelName
        });
      }

      const encryptedKey = typeof apiKey === "string" && apiKey.trim()
        ? encryptSecret(apiKey.trim())
        : undefined;
      const keyPreview = typeof apiKey === "string" && apiKey.trim()
        ? createKeyPreview(apiKey.trim())
        : undefined;
      const capabilityParams = activeRevisionFor(binding.profile)?.params;
      const capabilityMetadata = binding.profile ? metadataFromCapabilityParams({
        officialModelId: binding.profile.officialModelId,
        capability: binding.profile.capability,
        params: capabilityParams
      }) : undefined;
      const config = await prisma.customApiConfig.create({
        data: {
          ownerId: null,
          alias: String(alias).trim(),
          provider: normalizedProvider,
          type: normalized.type,
          capability: normalized.capability,
          canonicalModelId: binding.canonicalModelId,
          activeCapabilityRevisionId: binding.activeCapabilityRevisionId,
          baseUrl: String(baseUrl).trim(),
          modelName: String(modelName).trim(),
          encryptedKey,
          keyPreview,
          metadata: normalized.capability === "TEXT_GENERATOR"
            ? (metadata || undefined)
            : (metadata || capabilityMetadata || undefined),
          isEnabled: Boolean(isEnabled),
          userAccessEnabled: Boolean(userAccessEnabled)
        }
      });

      await writeAuditLog({
        actor: requestUser,
        action: "CREATE",
        entityType: "CustomApiConfig",
        entityId: config.id,
        req,
        metadata: { capability: config.capability, type: config.type, alias: config.alias, provider: config.provider, userAccessEnabled: config.userAccessEnabled }
      });

      res.json({ success: true, config: serializeCustomApiConfig(await attachCapabilityProfile(config)) });
    } catch (error: any) {
      console.error("[CustomApiConfig] Failed to save config:", error);
      sendApiError(res, error, "Failed to save custom API config.");
    }
  });

  app.put("/api/custom-api-configs/:id", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const id = req.params.id;
      const existing = await prisma.customApiConfig.findFirst({
        where: { id, ownerId: null }
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Custom API config not found." });
        return;
      }

      const { alias, provider, type, capability, baseUrl, modelName, apiKey, metadata, isEnabled, userAccessEnabled } = req.body || {};
      const normalized = type !== undefined || capability !== undefined
        ? normalizeTypeAndCapability({ type: type ?? existing.type, capability: capability ?? existing.capability })
        : null;
      const nextProvider = provider !== undefined ? normalizeProvider(provider) : existing.provider;
      const nextCapability = normalized?.capability || existing.capability;
      const nextModelName = modelName !== undefined ? String(modelName).trim() : existing.modelName;
      if (baseUrl !== undefined) {
        await assertSafeOutboundUrl(String(baseUrl).trim(), "baseUrl");
      }
      const requestedCanonicalModelId = req.body?.canonicalModelId !== undefined
        ? String(req.body.canonicalModelId || "").trim()
        : existing.canonicalModelId;
      let binding: { canonicalModelId: string | null; activeCapabilityRevisionId: string | null; profile: any };
      if (requestedCanonicalModelId) {
        const profile = await findCapabilityProfileForModel({ provider: nextProvider, canonicalModelId: requestedCanonicalModelId, capability: nextCapability });
        if (!profile) {
          throw new HttpError(400, "Selected capability template does not match this model capability.", "MODEL_CAPABILITY_TEMPLATE_MISMATCH", {
            canonicalModelId: requestedCanonicalModelId,
            capability: nextCapability
          });
        }
        binding = { canonicalModelId: profile.canonicalModelId, activeCapabilityRevisionId: profile.activeRevisionId, profile };
      } else {
        binding = await bindCapabilityForConfig({
          provider: nextProvider,
          capability: nextCapability,
          modelName: nextModelName
        });
      }
      const encryptedKey = typeof apiKey === "string" && apiKey.trim()
        ? encryptSecret(apiKey.trim())
        : undefined;
      const keyPreview = typeof apiKey === "string" && apiKey.trim()
        ? createKeyPreview(apiKey.trim())
        : undefined;

      const capabilityParams = activeRevisionFor(binding.profile)?.params;
      const capabilityMetadata = binding.profile ? metadataFromCapabilityParams({
        officialModelId: binding.profile.officialModelId,
        capability: binding.profile.capability,
        params: capabilityParams
      }) : undefined;
      const config = await prisma.customApiConfig.update({
        where: { id },
        data: {
          ...(alias !== undefined ? { alias: String(alias).trim() } : {}),
          ...(provider !== undefined ? { provider: nextProvider } : {}),
          ...(normalized ? { type: normalized.type, capability: normalized.capability } : {}),
          canonicalModelId: binding.canonicalModelId,
          activeCapabilityRevisionId: binding.activeCapabilityRevisionId,
          ...(baseUrl !== undefined ? { baseUrl: String(baseUrl).trim() } : {}),
          ...(modelName !== undefined ? { modelName: String(modelName).trim() } : {}),
          ...(encryptedKey ? { encryptedKey, keyPreview } : {}),
          ...(nextCapability === "TEXT_GENERATOR"
            ? { metadata: metadata !== undefined ? metadata : undefined }
            : metadata !== undefined
              ? { metadata }
              : capabilityMetadata
                ? { metadata: capabilityMetadata }
                : {}),
          ...(isEnabled !== undefined ? { isEnabled: Boolean(isEnabled) } : {}),
          ...(userAccessEnabled !== undefined ? { userAccessEnabled: Boolean(userAccessEnabled) } : {})
        }
      });

      await writeAuditLog({
        actor: requestUser,
        action: "UPDATE",
        entityType: "CustomApiConfig",
        entityId: config.id,
        req,
        metadata: { capability: config.capability, type: config.type, alias: config.alias, provider: config.provider, userAccessEnabled: config.userAccessEnabled },
        beforeJson: { alias: existing.alias, provider: existing.provider, type: existing.type, capability: existing.capability, isEnabled: existing.isEnabled, userAccessEnabled: existing.userAccessEnabled },
        afterJson: { alias: config.alias, provider: config.provider, type: config.type, capability: config.capability, isEnabled: config.isEnabled, userAccessEnabled: config.userAccessEnabled }
      });

      res.json({ success: true, config: serializeCustomApiConfig(await attachCapabilityProfile(config)) });
    } catch (error: any) {
      console.error("[CustomApiConfig] Failed to update config:", error);
      sendApiError(res, error, "Failed to update custom API config.");
    }
  });

  app.delete("/api/custom-api-configs/:id", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const existing = await prisma.customApiConfig.findFirst({
        where: { id: req.params.id, ownerId: null }
      });
      const deleted = await prisma.customApiConfig.deleteMany({
        where: { id: req.params.id, ownerId: null }
      });
      if (deleted.count === 0) {
        res.status(404).json({ success: false, error: "Custom API config not found." });
        return;
      }
      await writeAuditLog({
        actor: requestUser,
        action: "DELETE",
        entityType: "CustomApiConfig",
        entityId: req.params.id,
        req,
        metadata: existing ? { capability: existing.capability, type: existing.type, alias: existing.alias, provider: existing.provider } : undefined,
        beforeJson: existing ? { alias: existing.alias, provider: existing.provider, type: existing.type, capability: existing.capability, isEnabled: existing.isEnabled } : undefined
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("[CustomApiConfig] Failed to delete config:", error);
      sendApiError(res, error, "Failed to delete custom API config.");
    }
  });
}
