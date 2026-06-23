import type express from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError, sendApiError } from "../../shared/http";
import { requireRoles } from "../auth/auth.shared";
import { normalizeModelName } from "./model-params.service";
import { normalizeTypeAndCapability } from "../custom-api-configs/custom-api-configs.shared";
import { findCapabilityProfileForModel, metadataFromCapabilityParams, serializeCapabilityProfile } from "../model-capabilities/model-capabilities.service";

export function registerModelParamRoutes(app: express.Express) {
  app.post("/api/model-params/sync", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const { id, type, capability, modelName, alias, provider } = req.body;
      const canSyncAny = requestUser.role === UserRole.ADMIN || requestUser.role === UserRole.DEVELOPER;

      if (id && !canSyncAny) {
        const ownedConfig = await prisma.customApiConfig.findFirst({
          where: { id: String(id), ownerId: null },
          select: { id: true }
        });
        if (!ownedConfig) throw new HttpError(403, "Forbidden.");
      } else if (!id && !canSyncAny) {
        throw new HttpError(403, "Forbidden.");
      }

      const trimmedModelName = String(modelName || "").trim();
      const normalized = normalizeTypeAndCapability({ type, capability });
      const candidateNames = [trimmedModelName, alias, [trimmedModelName, alias].filter(Boolean).join(" ")]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      let profile: any = null;
      for (const candidate of candidateNames) {
        profile = await findCapabilityProfileForModel({
          provider,
          capability: normalized.capability,
          modelName: candidate
        });
        if (profile) break;
      }

      if (!profile) {
        res.status(200).json({
          success: false,
          code: "MODEL_CAPABILITY_NOT_REGISTERED",
          error: "该模型不在后端可信能力注册表中，系统不会写入通用默认参数。",
          details: { type: normalized.type, capability: normalized.capability, modelName: trimmedModelName }
        });
        return;
      }

      const serialized = serializeCapabilityProfile({ ...profile, activeRevision: profile.activeRevision });
      const params = serialized.activeRevision?.params || {
        ...(serialized.imageCapabilities ? { imageCapabilities: serialized.imageCapabilities } : {}),
        ...(serialized.videoCapabilities ? { videoCapabilities: serialized.videoCapabilities } : {}),
        ...(serialized.textCapabilities ? { textCapabilities: serialized.textCapabilities } : {})
      };
      const resolvedData = metadataFromCapabilityParams({
        officialModelId: serialized.officialModelId,
        capability: normalized.capability,
        params
      }) || {};

      if (id && Object.keys(resolvedData).length > 0) {
        const existing = await prisma.customApiConfig.findUnique({ where: { id: String(id) } });
        if (existing) {
          await prisma.customApiConfig.update({
            where: { id: String(id) },
            data: {
              canonicalModelId: serialized.canonicalModelId || existing.canonicalModelId,
              activeCapabilityRevisionId: serialized.activeRevisionId || existing.activeCapabilityRevisionId,
              metadata: {
                ...((existing.metadata as Record<string, any>) || {}),
                ...resolvedData
              }
            }
          });
        }
      }

      if (trimmedModelName && Object.keys(resolvedData).length > 0) {
        await prisma.modelParamCache.upsert({
          where: {
            provider_modelName_type: {
              provider: "builtin",
              modelName: trimmedModelName,
              type: normalized.type
            }
          },
          create: {
            provider: "builtin",
            modelName: trimmedModelName,
            type: normalized.type,
            params: resolvedData
          },
          update: {
            params: resolvedData
          }
        });
      }

      res.json({
        success: true,
        metadata: resolvedData,
        capabilityProfile: serialized,
        verificationStatus: serialized.verificationStatus,
        executable: serialized.executable,
        recognizedAs: serialized.officialModelId || serialized.canonicalModelId
      });
    } catch (err: any) {
      sendApiError(res, err, "Failed to sync model parameters.");
    }
  });

  app.post("/api/model-params/probe", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const { provider, type, capability, modelName } = req.body;
      if (!modelName) {
        res.status(200).json({ success: false, error: "Model name is required." });
        return;
      }

      const trimmedModelName = modelName.trim();
      const lowerName = trimmedModelName.toLowerCase();
      const normalized = normalizeTypeAndCapability({ type, capability });
      const targetNormalized = normalizeModelName(trimmedModelName);
      const profile = await findCapabilityProfileForModel({
        provider,
        modelName: trimmedModelName,
        capability: normalized.capability
      });

      if (profile) {
        const serialized = serializeCapabilityProfile(profile);
        const params = serialized.activeRevision?.params || {
          ...(serialized.imageCapabilities ? { imageCapabilities: serialized.imageCapabilities } : {}),
          ...(serialized.videoCapabilities ? { videoCapabilities: serialized.videoCapabilities } : {}),
          ...(serialized.textCapabilities ? { textCapabilities: serialized.textCapabilities } : {})
        };
        const metadata = metadataFromCapabilityParams({
          officialModelId: serialized.officialModelId,
          capability: serialized.capability,
          params
        });
        res.json({
          success: true,
          metadata,
          capabilityProfile: serialized,
          verificationStatus: serialized.verificationStatus,
          executable: serialized.executable,
          apiProbeSuccess: false,
          recognizedAs: serialized.officialModelId || serialized.canonicalModelId
        });
        return;
      }

      res.status(200).json({
        success: false,
        code: "MODEL_CAPABILITY_NOT_REGISTERED",
        error: "该模型不在后端可信能力注册表中，系统不会用 AI 编造参数。请先维护能力模板。",
        details: { type: normalized.type, capability: normalized.capability, modelName: trimmedModelName, normalizedName: targetNormalized || lowerName }
      });
    } catch (err: any) {
      sendApiError(res, err, "Failed to probe model parameters.");
    }
  });
}
