import { prisma } from "../../db/prisma";
import { HttpError } from "../../shared/http";
import { decryptSecret } from "../../security/crypto";
import { ModelCapability, UserRole } from "@prisma/client";
import type express from "express";
import { writeAuditLog } from "../audit/audit.service";
import type { RequestUser } from "../auth/auth.shared";

export type CustomApiRuntimeConfigInput = {
  useCustomApi: boolean;
  customConfigId?: string;
  customUrl?: string;
  customKey?: string;
  customModel?: string;
  expectedCapability?: ModelCapability;
  ownerId?: string;
  role?: UserRole | "GUEST" | string;
  audit?: {
    actor: RequestUser;
    req?: express.Request;
    source: string;
  };
};

function canUseGlobalProvider(role?: UserRole | "GUEST" | string) {
  return role === UserRole.ADMIN || role === UserRole.DEVELOPER;
}

function canUseGlobalProviderForCapability(capability: ModelCapability, role?: UserRole | "GUEST" | string) {
  if (capability === ModelCapability.TEXT_GENERATOR) {
    return role === UserRole.ADMIN || role === UserRole.DEVELOPER || role === UserRole.USER;
  }
  return canUseGlobalProvider(role);
}

function activeRevisionFor(profile: any) {
  const activeId = profile?.activeRevisionId;
  const revisions = Array.isArray(profile?.revisions) ? profile.revisions : [];
  return revisions.find((revision: any) => revision.id === activeId) || revisions[0] || null;
}

export async function resolveCustomApiRuntimeConfig(input: CustomApiRuntimeConfigInput) {
  if (!input.useCustomApi) {
    return {
      customUrl: input.customUrl,
      customKey: input.customKey,
      customModel: input.customModel,
      textCapabilities: undefined as any
    };
  }

  if (input.customConfigId) {
    const config = await prisma.customApiConfig.findUnique({
      where: { id: input.customConfigId }
    });

    if (!config) throw new HttpError(404, "Custom API config not found.");
    if (config.ownerId && (!input.ownerId || config.ownerId !== input.ownerId)) throw new HttpError(403, "Forbidden.");
    if (input.expectedCapability && config.capability !== input.expectedCapability) {
      throw new HttpError(400, `Custom API config capability mismatch. Expected ${input.expectedCapability}.`);
    }
    const globalUserAllowed = config.capability === ModelCapability.TEXT_GENERATOR && config.userAccessEnabled === true;
    const globalRoleAllowed = canUseGlobalProvider(input.role)
      || (input.role === UserRole.USER && globalUserAllowed && canUseGlobalProviderForCapability(config.capability, input.role));
    if (!config.ownerId && !globalRoleAllowed) {
      if (input.audit) {
        await writeAuditLog({
          actor: input.audit.actor,
          action: "ACCESS",
          entityType: "CustomApiConfig",
          entityId: config.id,
          req: input.audit.req,
          metadata: {
            source: input.audit.source,
            decision: "denied",
            reason: "global_provider_role_restricted",
            userAccessEnabled: config.userAccessEnabled,
            provider: config.provider,
            type: config.type,
            capability: config.capability,
            alias: config.alias
          }
        });
      }
      throw new HttpError(403, "This global provider is not enabled for your role.");
    }
    if (!config.isEnabled) throw new HttpError(400, "Custom API config is disabled.");
    if (!config.encryptedKey) throw new HttpError(400, "Provider is incomplete.");

    if (!config.ownerId && input.audit) {
      await writeAuditLog({
        actor: input.audit.actor,
        action: "ACCESS",
        entityType: "CustomApiConfig",
        entityId: config.id,
        req: input.audit.req,
        metadata: {
          source: input.audit.source,
          decision: "allowed",
          scope: "global_provider",
          provider: config.provider,
          type: config.type,
          capability: config.capability,
          alias: config.alias
        }
      });
    }

    const decryptedKey = decryptSecret(config.encryptedKey);
    if (!decryptedKey) throw new Error("API key is not configured.");
    const capabilityProfile = config.canonicalModelId
      ? await prisma.modelCapabilityProfile.findFirst({
          where: { canonicalModelId: config.canonicalModelId, capability: config.capability },
          include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
        })
      : null;
    const activeRevision = capabilityProfile ? activeRevisionFor(capabilityProfile) : null;
    const capabilityParams = activeRevision?.params || null;

    return {
      customUrl: config.baseUrl,
      customKey: decryptedKey,
      customModel: config.modelName,
      textCapabilities: config.capability === ModelCapability.TEXT_GENERATOR ? capabilityParams?.textCapabilities : undefined,
      capabilityParams,
      capabilityProfile: capabilityProfile ? { ...capabilityProfile, activeRevision } : null
    };
  }

  if (input.useCustomApi && input.customKey && process.env.ALLOW_INLINE_CUSTOM_API_KEYS !== "true") {
    throw new HttpError(400, "Inline custom API keys are disabled. Save the provider in API settings or config/api-providers.local.json.");
  }

  return {
    customUrl: input.customUrl,
    customKey: input.customKey,
    customModel: input.customModel,
    textCapabilities: undefined as any
  };
}
