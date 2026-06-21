import { ModelCapability } from "@prisma/client";

const TYPE_TO_CAPABILITY: Record<string, ModelCapability> = {
  text: ModelCapability.TEXT_GENERATOR,
  image: ModelCapability.IMAGE_GENERATOR,
  video: ModelCapability.VIDEO_GENERATOR
};

const CAPABILITY_TO_TYPE: Record<ModelCapability, "text" | "image" | "video"> = {
  [ModelCapability.TEXT_GENERATOR]: "text",
  [ModelCapability.IMAGE_GENERATOR]: "image",
  [ModelCapability.VIDEO_GENERATOR]: "video"
};

const SENSITIVE_METADATA_KEYS = /(api|key|secret|token|auth|password|baseurl|url|header|model|id)/i;

export function normalizeCustomApiType(type: unknown): "text" | "image" | "video" {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "text" || normalized === "image" || normalized === "video") return normalized;
  throw new Error("type must be image, video or text.");
}

export function normalizeModelCapability(capability: unknown, type?: unknown): ModelCapability {
  const raw = String(capability || "").trim().toUpperCase();
  if (raw && Object.values(ModelCapability).includes(raw as ModelCapability)) {
    return raw as ModelCapability;
  }
  const normalizedType = normalizeCustomApiType(type || "text");
  return TYPE_TO_CAPABILITY[normalizedType];
}

export function capabilityToType(capability: ModelCapability): "text" | "image" | "video" {
  return CAPABILITY_TO_TYPE[capability] || "text";
}

export function normalizeTypeAndCapability(input: { type?: unknown; capability?: unknown }) {
  const capability = normalizeModelCapability(input.capability, input.type);
  const type = input.type ? normalizeCustomApiType(input.type) : capabilityToType(capability);
  return { type, capability };
}

function safePublicMetadata(metadata: any, options: { revealSensitive?: boolean } = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const revealSensitive = Boolean(options.revealSensitive);
  const safe: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.test(key)) continue;
    if (!revealSensitive && key.toLowerCase() === "description") continue;
    if (["string", "number", "boolean"].includes(typeof value) || Array.isArray(value)) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function activeRevisionFor(profile: any) {
  const activeId = profile?.activeRevisionId;
  const revisions = Array.isArray(profile?.revisions) ? profile.revisions : [];
  return profile?.activeRevision || revisions.find((revision: any) => revision.id === activeId) || revisions[0] || null;
}

function publicCapabilityParams(params: any, revealSensitive: boolean) {
  if (!params || typeof params !== "object") return {};
  if (revealSensitive) {
    return {
      imageCapabilities: params.imageCapabilities,
      videoCapabilities: params.videoCapabilities,
      textCapabilities: params.textCapabilities
    };
  }
  const sanitize = (capabilities: any) => {
    if (!capabilities || typeof capabilities !== "object") return undefined;
    const { runtime, ...safe } = capabilities;
    return safe;
  };
  return {
    imageCapabilities: sanitize(params.imageCapabilities),
    videoCapabilities: sanitize(params.videoCapabilities),
    textCapabilities: sanitize(params.textCapabilities)
  };
}

function serializePublicCapabilityProfile(profile: any, revealSensitive: boolean) {
  const activeRevision = activeRevisionFor(profile);
  const params = activeRevision?.params || undefined;
  const publicParams = publicCapabilityParams(params, revealSensitive);
  return {
    id: revealSensitive ? profile.id : undefined,
    canonicalModelId: revealSensitive ? profile.canonicalModelId : undefined,
    officialModelId: revealSensitive ? profile.officialModelId : undefined,
    provider: profile.provider,
    capability: profile.capability,
    aliases: revealSensitive && Array.isArray(profile.aliases) ? profile.aliases : [],
    sourceUrls: revealSensitive && Array.isArray(profile.sourceUrls) ? profile.sourceUrls : [],
    verificationStatus: profile.verificationStatus,
    executable: profile.verificationStatus === "VERIFIED" || profile.verificationStatus === "MANUAL_VERIFIED",
    activeRevisionId: revealSensitive ? profile.activeRevisionId || null : undefined,
    activeRevision: revealSensitive && activeRevision ? {
      id: activeRevision.id,
      revision: activeRevision.revision,
      params,
      sourceHash: activeRevision.sourceHash,
      changedSummary: activeRevision.changedSummary,
      createdAt: activeRevision.createdAt?.toISOString?.() || activeRevision.createdAt
    } : null,
    imageCapabilities: publicParams.imageCapabilities,
    videoCapabilities: publicParams.videoCapabilities,
    textCapabilities: publicParams.textCapabilities,
    runtime: revealSensitive ? params?.imageCapabilities?.runtime || params?.videoCapabilities?.runtime || params?.textCapabilities?.runtime : undefined,
    lastCheckedAt: profile.lastCheckedAt?.toISOString?.() || profile.lastCheckedAt || null
  };
}

export function serializeCustomApiConfig(config: any) {
  const capabilityProfile = config.capabilityProfile || config.capabilityProfiles || null;
  return {
    id: config.id,
    ownerId: config.ownerId,
    alias: config.alias,
    provider: config.provider || "Custom",
    type: config.type,
    capability: config.capability,
    canonicalModelId: config.canonicalModelId || undefined,
    activeCapabilityRevisionId: config.activeCapabilityRevisionId || undefined,
    baseUrl: config.baseUrl,
    modelName: config.modelName,
    metadata: config.metadata || undefined,
    capabilityProfile: capabilityProfile ? serializePublicCapabilityProfile(capabilityProfile, true) : undefined,
    isEnabled: config.isEnabled,
    userAccessEnabled: Boolean(config.userAccessEnabled),
    hasApiKey: !!config.encryptedKey,
    keyPreview: config.keyPreview || undefined,
    createdAt: config.createdAt?.toISOString?.() || config.createdAt,
    updatedAt: config.updatedAt?.toISOString?.() || config.updatedAt
  };
}

export function serializePublicModelConfig(config: any, options: { revealSensitive?: boolean } = {}) {
  const capabilityProfile = config.capabilityProfile || config.capabilityProfiles || null;
  const displayName = String(config.alias || "").trim();
  const revealSensitive = Boolean(options.revealSensitive);
  return {
    id: config.id,
    customModelId: config.id,
    alias: config.alias,
    displayName,
    provider: config.provider || "Custom",
    type: config.type,
    capability: config.capability,
    canonicalModelId: revealSensitive ? config.canonicalModelId || undefined : undefined,
    activeCapabilityRevisionId: revealSensitive ? config.activeCapabilityRevisionId || undefined : undefined,
    capabilityProfile: capabilityProfile ? serializePublicCapabilityProfile(capabilityProfile, revealSensitive) : undefined,
    modelName: revealSensitive ? config.modelName : "",
    sensitiveFieldsHidden: !revealSensitive,
    isEnabled: config.isEnabled,
    userAccessEnabled: Boolean(config.userAccessEnabled),
    metadata: safePublicMetadata(config.metadata, { revealSensitive }),
    createdAt: config.createdAt?.toISOString?.() || config.createdAt,
    updatedAt: config.updatedAt?.toISOString?.() || config.updatedAt
  };
}
