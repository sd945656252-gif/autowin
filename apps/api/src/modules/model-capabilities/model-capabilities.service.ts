import crypto from "crypto";
import { MediaAssetType, ModelCapability, ModelCapabilityVerificationStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../shared/http";
import { canReadMediaAsset } from "../media/media.service";
import type { RequestUser } from "../auth/auth.shared";
import { CAPABILITY_REGISTRY, findRegistryEntry, isExecutableVerificationStatus, type CapabilityMode } from "./model-capabilities.registry";
import { parseCapabilityParams } from "./model-capabilities.schema";

export function normalizeCapability(value: unknown): ModelCapability {
  const raw = String(value || "").trim().toUpperCase();
  if (Object.values(ModelCapability).includes(raw as ModelCapability)) return raw as ModelCapability;
  throw new HttpError(400, "Invalid model capability.", "INVALID_MODEL_CAPABILITY", { capability: value });
}

export function normalizeCapabilityStatus(value: unknown): ModelCapabilityVerificationStatus {
  const raw = String(value || "").trim().toUpperCase();
  if (Object.values(ModelCapabilityVerificationStatus).includes(raw as ModelCapabilityVerificationStatus)) {
    return raw as ModelCapabilityVerificationStatus;
  }
  throw new HttpError(400, "Invalid verification status.", "INVALID_VERIFICATION_STATUS", { status: value });
}

function activeRevisionFor(profile: any) {
  const activeId = profile.activeRevisionId;
  const revisions = Array.isArray(profile.revisions) ? profile.revisions : [];
  return revisions.find((revision: any) => revision.id === activeId) || revisions[0] || null;
}

function slugPart(value: unknown, fallback: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function inferTextProviderAdapter(input: { provider?: unknown; modelName?: unknown }) {
  const combined = `${input.provider || ""} ${input.modelName || ""}`.toLowerCase();
  if (combined.includes("gemini") || combined.includes("google")) return "gemini-native";
  return "openai-chat";
}

function normalizeProviderForCompare(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "");
}

function providerMatchesProfile(inputProvider: unknown, profileProvider: unknown, capability: ModelCapability) {
  const normalizedInput = normalizeProviderForCompare(inputProvider);
  if (!normalizedInput || normalizedInput === "custom") return true;
  const normalizedProfile = normalizeProviderForCompare(profileProvider);
  if (normalizedProfile === normalizedInput) return true;
  return capability === ModelCapability.TEXT_GENERATOR
    && normalizedInput === "openaicompatible"
    && normalizedProfile === "openai";
}

function assertCapabilityProviderMatch(input: { requestedProvider?: unknown; profile: any; capability: ModelCapability; canonicalModelId?: unknown }) {
  if (input.capability !== ModelCapability.TEXT_GENERATOR) return;
  if (providerMatchesProfile(input.requestedProvider, input.profile?.provider, input.capability)) return;
  throw new HttpError(400, "Selected capability template provider does not match this model provider.", "MODEL_CAPABILITY_PROVIDER_MISMATCH", {
    requestedProvider: input.requestedProvider || null,
    profileProvider: input.profile?.provider || null,
    canonicalModelId: input.canonicalModelId || input.profile?.canonicalModelId || null,
    capability: input.capability
  });
}

function inferImageProviderAdapter(input: { provider?: unknown; modelName?: unknown }) {
  const combined = `${input.provider || ""} ${input.modelName || ""}`.toLowerCase();
  if (combined.includes("gemini") || combined.includes("google") || combined.includes("nano-banana")) return "google-gemini-image";
  if (combined.includes("openai") || combined.includes("gpt-image") || combined.includes("dall-e") || combined.includes("dalle")) return "openai-image";
  return "custom";
}

function inferVideoProviderAdapter(input: { provider?: unknown; modelName?: unknown }) {
  const combined = `${input.provider || ""} ${input.modelName || ""}`.toLowerCase();
  if (combined.includes("seedance") || combined.includes("bytedance") || combined.includes("volcengine") || combined.includes("doubao")) return "seedance-video";
  return "custom";
}

function defaultTextCapabilityParams(input: { provider?: unknown; modelName?: unknown }) {
  const providerAdapter = inferTextProviderAdapter(input);
  const isGemini = providerAdapter === "gemini-native";
  const runtime = isGemini
    ? {
        responsePaths: ["candidates.0.content.parts.0.text", "text", "output_text"],
        streamChunkPaths: ["candidates.0.content.parts.0.text", "text"]
      }
    : {
        endpoint: "/chat/completions",
        streamEndpoint: "/chat/completions",
        responsePaths: ["choices.0.message.content", "choices.0.text", "text", "output_text"],
        streamChunkPaths: ["choices.0.delta.content", "choices.0.text", "delta.content"]
      };
  return {
    textCapabilities: {
      modes: ["chat_completion"],
      defaultMode: "chat_completion",
      controls: {
        systemPrompt: true,
        attachments: true,
        stream: true,
        maxPromptChars: 12000,
        maxOutputTokens: { min: 1, max: isGemini ? 8192 : 16384, default: 2048 },
        temperature: { min: 0, max: 2, default: 0.7 }
      },
      limits: {
        maxAttachmentCount: 6,
        maxAttachmentBytes: 3145728,
        maxTotalAttachmentBytes: 10485760
      },
      supportedAttachmentMimePrefixes: ["image/"],
      providerAdapter,
      runtime
    }
  };
}

function defaultImageCapabilityParams(input: { provider?: unknown; modelName?: unknown }) {
  const providerAdapter = inferImageProviderAdapter(input);
  const isOpenAi = providerAdapter === "openai-image";
  const isGemini = providerAdapter === "google-gemini-image";
  const geminiRatios = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
  return {
    imageCapabilities: {
      modes: isOpenAi ? ["text_to_image", "image_to_image", "image_edit"] : ["text_to_image"],
      defaultMode: "text_to_image",
      inputSlots: {
        referenceImages: { enabled: isOpenAi, maxCount: isOpenAi ? 16 : 0 },
        sourceImage: { enabled: isOpenAi },
        maskImage: { enabled: isOpenAi }
      },
      controls: {
        prompt: true,
        promptMaxChars: 12000,
        negativePrompt: !isOpenAi && !isGemini,
        aspectRatio: isOpenAi ? ["auto", "1:3", "9:16", "2:3", "3:4", "4:5", "1:1", "5:4", "4:3", "3:2", "16:9", "21:9", "2:1", "3:1"] : isGemini ? geminiRatios : ["1:1", "16:9", "9:16"],
        size: isOpenAi ? ["1024x1024", "1024x3072", "1152x2048", "1024x1536", "1024x1280", "1280x1024", "1536x1024", "2048x1152", "2560x1088", "2048x1024", "3072x1024", "3840x2160", "auto"] : isGemini ? ["512", "1K", "2K", "4K"] : [],
        quality: isOpenAi ? ["auto", "high", "medium", "low"] : isGemini ? [] : ["standard"],
        outputFormat: isOpenAi ? ["png", "jpeg", "webp"] : ["png"],
        outputCompression: isOpenAi ? { enabled: true, min: 0, max: 100, default: 100 } : false,
        background: isOpenAi ? ["auto", "opaque"] : undefined,
        moderation: isOpenAi ? ["auto", "low"] : undefined,
        stream: false,
        partialImages: isOpenAi ? { enabled: true, min: 0, max: 3, default: 0 } : false,
        inputFidelity: false,
        responseFormat: false,
        style: false,
        seed: false,
        steps: false,
        cfgScale: false,
        strength: false
      },
      limits: {
        maxOutputImages: 1,
        maxInputImages: isOpenAi ? 16 : 0
      },
      providerAdapter,
      runtime: {
        ...(providerAdapter === "custom" ? { endpoint: "/images/generations" } : {}),
        ...(isGemini ? {
          endpoint: "/v1/images/generations",
          payloadFields: {
            model: "model",
            prompt: "prompt",
            aspectRatio: "aspect_ratio",
            resolution: "resolution"
          }
        } : {}),
        responsePaths: ["data.0.url", "data.0.b64_json", "data.0.image_url", "url", "image_url", "result.url", "result.image_url", "result.images.0.url", "output.0.url"],
        taskIdPaths: ["id", "task_id", "taskId", "data.id", "data.task_id", "data.taskId"]
      }
    }
  };
}

function defaultVideoCapabilityParams(input: { provider?: unknown; modelName?: unknown }) {
  const providerAdapter = inferVideoProviderAdapter(input);
  const isSeedance = providerAdapter === "seedance-video";
  return {
    videoCapabilities: {
      modes: isSeedance ? ["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"] : ["text_to_video"],
      defaultMode: "text_to_video",
      inputSlots: {
        firstFrame: { enabled: isSeedance },
        lastFrame: { enabled: isSeedance },
        referenceImages: { enabled: isSeedance, maxCount: isSeedance ? 9 : 0 },
        sourceVideo: { enabled: isSeedance },
        referenceVideo: { enabled: isSeedance },
        audio: { enabled: isSeedance }
      },
      controls: {
        prompt: true,
        negativePrompt: !isSeedance,
        duration: isSeedance ? [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] : [5],
        aspectRatio: isSeedance ? ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] : ["16:9", "9:16", "1:1"],
        resolution: isSeedance ? ["480p", "720p", "1080p"] : ["720P", "1080P"],
        fps: [24],
        cameraControl: false,
        motionStrength: false,
        seed: true,
        generateAudio: isSeedance
      },
      limits: {
        maxInputImages: isSeedance ? 9 : 0,
        maxInputVideos: isSeedance ? 3 : 0,
        maxInputAudios: isSeedance ? 3 : 0
      },
      providerAdapter,
      runtime: {
        endpoint: "/video/generations",
        ...(isSeedance ? {
          payloadFields: {
            model: "model",
            prompt: "prompt",
            aspectRatio: "ratio",
            resolution: "resolution",
            duration: "duration",
            generateAudio: "generate_audio",
            seed: "seed"
          }
        } : {}),
        responsePaths: ["data.0.url", "data.0.video_url", "data.0.videoUrl", "url", "video_url", "videoUrl", "result.url", "result.video_url", "result.videoUrl", "result.videos.0.url", "output.0.url", "output.0"],
        taskIdPaths: ["id", "task_id", "taskId", "data.id", "data.task_id", "data.taskId"],
        pollEndpoint: "/video/status/{taskId}",
        pollResultPaths: ["url", "video_url", "videoUrl", "data.0.url", "data.0.video_url", "data.0.videoUrl", "output.0"],
        pollStatusPaths: ["status", "state", "data.status", "data.state"],
        failedStatuses: ["failed", "error", "canceled", "cancelled"]
      }
    }
  };
}

function defaultCapabilityParams(input: { provider?: unknown; capability: ModelCapability; modelName?: unknown }) {
  if (input.capability === ModelCapability.IMAGE_GENERATOR) return defaultImageCapabilityParams(input);
  if (input.capability === ModelCapability.VIDEO_GENERATOR) return defaultVideoCapabilityParams(input);
  return defaultTextCapabilityParams(input);
}

function customCapabilityPrefix(capability: ModelCapability) {
  if (capability === ModelCapability.IMAGE_GENERATOR) return "custom-image";
  if (capability === ModelCapability.VIDEO_GENERATOR) return "custom-video";
  return "custom-text";
}

function findCustomCapabilityProfile(input: { provider: string; capability: ModelCapability; canonicalModelId: string }) {
  return prisma.modelCapabilityProfile.findFirst({
    where: {
      provider: input.provider,
      capability: input.capability,
      canonicalModelId: input.canonicalModelId
    },
    include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
  });
}

async function ensureCustomCapabilityProfile(input: { provider?: unknown; capability: ModelCapability; modelName?: unknown }) {
  const provider = String(input.provider || "Custom").trim() || "Custom";
  const modelName = String(input.modelName || "").trim();
  if (!modelName) return null;
  const canonicalModelId = `${customCapabilityPrefix(input.capability)}:${slugPart(provider, "custom")}:${slugPart(modelName, "model")}`;
  const params = parseCapabilityParams(input.capability, defaultCapabilityParams(input));
  const existing = await findCustomCapabilityProfile({ provider, capability: input.capability, canonicalModelId });
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      const profile = await tx.modelCapabilityProfile.create({
        data: {
          canonicalModelId,
          officialModelId: modelName,
          provider,
          capability: input.capability,
          aliases: [modelName],
          sourceUrls: [`project://model-center/${customCapabilityPrefix(input.capability)}-default`],
          verificationStatus: ModelCapabilityVerificationStatus.MANUAL_VERIFIED,
          lastCheckedAt: new Date()
        }
      });
      const revision = await tx.modelCapabilityRevision.create({
        data: {
          profileId: profile.id,
          revision: 1,
          params: params as Prisma.InputJsonValue,
          sourceHash: null,
          changedSummary: "Initial custom capability scaffold. Runtime can be edited in model center."
        }
      });
      return tx.modelCapabilityProfile.update({
        where: { id: profile.id },
        data: { activeRevisionId: revision.id },
        include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
      });
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      const raced = await findCustomCapabilityProfile({ provider, capability: input.capability, canonicalModelId });
      if (raced) return raced;
    }
    throw error;
  }
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

export function metadataFromCapabilityParams(entry: { officialModelId?: string | null; params: Record<string, any>; capability: ModelCapability }) {
  const image = entry.params?.imageCapabilities;
  if (entry.capability === ModelCapability.IMAGE_GENERATOR && image) {
    return {
      ratios: Array.isArray(image.controls?.aspectRatio) ? image.controls.aspectRatio : [],
      resolutions: Array.isArray(image.controls?.size) ? image.controls.size : [],
      qualities: Array.isArray(image.controls?.quality) ? image.controls.quality : [],
      maxImages: image.limits?.maxInputImages,
      supportsNegativePrompt: Boolean(image.controls?.negativePrompt),
      supportsAspectRatio: Array.isArray(image.controls?.aspectRatio) && image.controls.aspectRatio.length > 0,
      supportsQuality: Array.isArray(image.controls?.quality) && image.controls.quality.length > 0,
      supportsResolution: Array.isArray(image.controls?.size) && image.controls.size.length > 0,
      description: `${entry.officialModelId || "Image model"} trusted image capability parameters`
    };
  }
  const video = entry.params?.videoCapabilities;
  if (entry.capability === ModelCapability.VIDEO_GENERATOR && video) {
    const durations = Array.isArray(video.controls?.duration) ? video.controls.duration.map(Number).filter(Number.isFinite) : [];
    const concreteDurations = durations.filter((duration) => duration > 0);
    return {
      ratios: Array.isArray(video.controls?.aspectRatio) ? video.controls.aspectRatio : [],
      resolutions: Array.isArray(video.controls?.resolution) ? video.controls.resolution : [],
      minDuration: concreteDurations.length ? Math.min(...concreteDurations) : undefined,
      maxDuration: concreteDurations.length ? Math.max(...concreteDurations) : undefined,
      defaultDuration: durations[0],
      durations,
      hasAudio: Boolean(video.controls?.generateAudio),
      hasCameraControl: Boolean(video.controls?.cameraControl),
      supportedInputTypes: [
        video.inputSlots?.referenceImages?.enabled || video.inputSlots?.firstFrame?.enabled ? "image" : null,
        video.inputSlots?.sourceVideo?.enabled || video.inputSlots?.referenceVideo?.enabled ? "video" : null,
        video.inputSlots?.audio?.enabled ? "audio" : null
      ].filter(Boolean),
      maxFiles: Number(video.limits?.maxInputImages || 0) + Number(video.limits?.maxInputVideos || 0) + Number(video.limits?.maxInputAudios || 0),
      supportsFirstAndLastFrame: Boolean(video.inputSlots?.firstFrame?.enabled && video.inputSlots?.lastFrame?.enabled),
      supportsAllInOneReference: Boolean(video.inputSlots?.referenceImages?.enabled),
      description: `${entry.officialModelId || "Video model"} trusted video capability parameters`
    };
  }
  return undefined;
}

export function serializeCapabilityProfile(profile: any, options: { revealSensitive?: boolean } = { revealSensitive: true }) {
  const activeRevision = profile.activeRevision || activeRevisionFor(profile);
  const params = activeRevision?.params || undefined;
  const revealSensitive = options.revealSensitive !== false;
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
    executable: isExecutableVerificationStatus(profile.verificationStatus),
    activeRevisionId: revealSensitive ? profile.activeRevisionId : undefined,
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
    lastCheckedAt: profile.lastCheckedAt?.toISOString?.() || profile.lastCheckedAt,
    createdAt: profile.createdAt?.toISOString?.() || profile.createdAt,
    updatedAt: profile.updatedAt?.toISOString?.() || profile.updatedAt
  };
}

export async function ensureDefaultCapabilityProfiles() {
  for (const entry of CAPABILITY_REGISTRY) {
    const defaultParams = parseCapabilityParams(entry.capability, entry.params);
    const existing = await prisma.modelCapabilityProfile.findFirst({
      where: {
        provider: entry.provider,
        capability: entry.capability,
        canonicalModelId: entry.canonicalModelId
      }
    });

    if (existing) continue;

    await prisma.$transaction(async (tx) => {
      const profile = await tx.modelCapabilityProfile.create({
        data: {
          canonicalModelId: entry.canonicalModelId,
          officialModelId: entry.officialModelId,
          provider: entry.provider,
          capability: entry.capability,
          aliases: entry.aliases,
          sourceUrls: entry.sourceUrls,
          verificationStatus: entry.verificationStatus,
          lastCheckedAt: null
        }
      });
      const revision = await tx.modelCapabilityRevision.create({
        data: {
          profileId: profile.id,
          revision: 1,
          params: defaultParams as Prisma.InputJsonValue,
          sourceHash: null,
          changedSummary: "Initial unverified capability scaffold. Execution is disabled until official/manual verification."
        }
      });
      await tx.modelCapabilityProfile.update({
        where: { id: profile.id },
        data: { activeRevisionId: revision.id }
      });
    });
  }
}

async function ensureRegistryCapabilityProfile(input: { provider?: unknown; capability: ModelCapability; modelName?: unknown; canonicalModelId?: unknown }) {
  const registryEntry = input.canonicalModelId
    ? CAPABILITY_REGISTRY.find((entry) => entry.canonicalModelId === String(input.canonicalModelId).trim() && entry.capability === input.capability) || null
    : findRegistryEntry(input);
  if (!registryEntry) return null;
  assertCapabilityProviderMatch({
    requestedProvider: input.provider,
    profile: registryEntry,
    capability: input.capability,
    canonicalModelId: registryEntry.canonicalModelId
  });

  const existing = await prisma.modelCapabilityProfile.findFirst({
    where: {
      provider: registryEntry.provider,
      capability: registryEntry.capability,
      canonicalModelId: registryEntry.canonicalModelId
    },
    include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
  });
  if (existing) return existing;

  const officialSync = await import("./official-capability-sync.service");
  const officialEntry = await officialSync.loadOfficialCapabilityEntries()
    .then((entries) => entries.find((entry) => entry.canonicalModelId === registryEntry.canonicalModelId && entry.capability === registryEntry.capability) || null)
    .catch(() => null);
  if (officialEntry) {
    const synced = await officialSync.syncOfficialCapabilityEntry(officialEntry);
    return prisma.modelCapabilityProfile.findFirst({
      where: {
        provider: synced.capability.provider,
        capability: synced.capability.capability,
        canonicalModelId: synced.capability.canonicalModelId
      },
      include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
    });
  }

  const defaultParams = parseCapabilityParams(registryEntry.capability, registryEntry.params);
  try {
    return await prisma.$transaction(async (tx) => {
      const profile = await tx.modelCapabilityProfile.create({
        data: {
          canonicalModelId: registryEntry.canonicalModelId,
          officialModelId: registryEntry.officialModelId,
          provider: registryEntry.provider,
          capability: registryEntry.capability,
          aliases: registryEntry.aliases,
          sourceUrls: registryEntry.sourceUrls,
          verificationStatus: registryEntry.verificationStatus,
          lastCheckedAt: new Date()
        }
      });
      const revision = await tx.modelCapabilityRevision.create({
        data: {
          profileId: profile.id,
          revision: 1,
          params: defaultParams as Prisma.InputJsonValue,
          sourceHash: null,
          changedSummary: "Initial capability scaffold from static registry."
        }
      });
      return tx.modelCapabilityProfile.update({
        where: { id: profile.id },
        data: { activeRevisionId: revision.id },
        include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
      });
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return prisma.modelCapabilityProfile.findFirst({
        where: {
          provider: registryEntry.provider,
          capability: registryEntry.capability,
          canonicalModelId: registryEntry.canonicalModelId
        },
        include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
      });
    }
    throw error;
  }
}

export async function findCapabilityProfileForModel(input: { provider?: unknown; capability: ModelCapability; modelName?: unknown; canonicalModelId?: unknown }) {
  const canonicalModelId = String(input.canonicalModelId || "").trim();
  if (canonicalModelId) {
    const existing = await prisma.modelCapabilityProfile.findFirst({
      where: { canonicalModelId, capability: input.capability },
      include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
    });
    if (existing) {
      assertCapabilityProviderMatch({
        requestedProvider: input.provider,
        profile: existing,
        capability: input.capability,
        canonicalModelId
      });
    }
    return existing || ensureRegistryCapabilityProfile(input);
  }

  const registryEntry = findRegistryEntry(input);
  if (!registryEntry) return null;

  const existing = await prisma.modelCapabilityProfile.findFirst({
    where: {
      provider: registryEntry.provider,
      capability: registryEntry.capability,
      canonicalModelId: registryEntry.canonicalModelId
    },
    include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
  });
  return existing || ensureRegistryCapabilityProfile(input);
}

export async function bindCapabilityForConfig(input: { provider?: unknown; capability: ModelCapability; modelName?: unknown }) {
  if (input.capability === ModelCapability.TEXT_GENERATOR) {
    const profile = await findCapabilityProfileForModel(input) || await ensureCustomCapabilityProfile(input);
    return {
      canonicalModelId: profile?.canonicalModelId || null,
      activeCapabilityRevisionId: profile?.activeRevisionId || null,
      profile
    };
  }

  const profile = await findCapabilityProfileForModel(input) || await ensureCustomCapabilityProfile(input);
  if (!profile) throw new HttpError(400, "模型能力模板创建失败。", "MODEL_CAPABILITY_CREATE_FAILED", input);
  return {
    canonicalModelId: profile.canonicalModelId,
    activeCapabilityRevisionId: profile.activeRevisionId,
    profile
  };
}

export async function listCapabilityProfiles(capability?: ModelCapability) {
  const profiles = await prisma.modelCapabilityProfile.findMany({
    where: capability ? { capability } : undefined,
    include: { revisions: { orderBy: { revision: "desc" }, take: 5 } },
    orderBy: [{ capability: "asc" }, { provider: "asc" }, { canonicalModelId: "asc" }]
  });
  return profiles.map((profile: any) => ({ ...profile, activeRevision: activeRevisionFor(profile) }));
}

export async function listExecutableCapabilityProfiles(capability: ModelCapability) {
  const profiles = await listCapabilityProfiles(capability);
  return profiles.filter((profile: any) => isExecutableVerificationStatus(profile.verificationStatus));
}

export async function createCapabilityRevision(input: {
  canonicalModelId: string;
  capability?: ModelCapability;
  params: any;
  status?: ModelCapabilityVerificationStatus;
  sourceUrls?: string[];
  changedSummary?: string | null;
  createdById?: string | null;
}) {
  const profile = await prisma.modelCapabilityProfile.findFirst({
    where: {
      canonicalModelId: input.canonicalModelId,
      ...(input.capability ? { capability: input.capability } : {})
    }
  });
  if (!profile) throw new HttpError(404, "Model capability profile not found.", "MODEL_CAPABILITY_PROFILE_NOT_FOUND");
  const validatedParams = parseCapabilityParams(profile.capability, input.params);

  return prisma.$transaction(async (tx) => {
    const last = await tx.modelCapabilityRevision.findFirst({
      where: { profileId: profile.id },
      orderBy: { revision: "desc" }
    });
    const revisionNumber = (last?.revision || 0) + 1;
    const sourceHash = crypto.createHash("sha256").update(JSON.stringify({ params: input.params, sourceUrls: input.sourceUrls || [] })).digest("hex");
    const revision = await tx.modelCapabilityRevision.create({
      data: {
        profileId: profile.id,
        revision: revisionNumber,
        params: validatedParams as Prisma.InputJsonValue,
        sourceHash,
        changedSummary: input.changedSummary || null,
        createdById: input.createdById || null
      }
    });
    const updated = await tx.modelCapabilityProfile.update({
      where: { id: profile.id },
      data: {
        activeRevisionId: revision.id,
        verificationStatus: input.status || ModelCapabilityVerificationStatus.MANUAL_VERIFIED,
        sourceUrls: input.sourceUrls || undefined,
        lastCheckedAt: new Date()
      },
      include: { revisions: { orderBy: { revision: "desc" }, take: 5 } }
    });
    await tx.customApiConfig.updateMany({
      where: { canonicalModelId: updated.canonicalModelId, capability: updated.capability },
      data: {
        activeCapabilityRevisionId: revision.id,
        ...(metadataFromCapabilityParams({
          officialModelId: updated.officialModelId,
          capability: updated.capability,
          params: validatedParams
        }) ? {
          metadata: metadataFromCapabilityParams({
            officialModelId: updated.officialModelId,
            capability: updated.capability,
            params: validatedParams
          }) as Prisma.InputJsonValue
        } : {})
      }
    });
    return { ...updated, activeRevision: revision };
  });
}

export function resolveImageGenerationMode(body: any): CapabilityMode {
  const explicit = String(body.imageGenerationMode || body.image_generation_mode || "auto");
  if (explicit && explicit !== "auto") return explicit as CapabilityMode;
  const inputs = body.imageInputs || body.image_inputs || {};
  const referenceIds = Array.isArray(inputs.referenceImageAssetIds) ? inputs.referenceImageAssetIds : [];
  if (inputs.sourceImageAssetId && (inputs.maskImageAssetId || inputs.editInstruction)) return "image_edit";
  if (referenceIds.length > 0 || inputs.sourceImageAssetId) return "image_to_image";
  return "text_to_image";
}

export function resolveVideoGenerationMode(body: any): CapabilityMode {
  const explicit = String(body.videoGenerationMode || body.video_generation_mode || "auto");
  if (explicit && explicit !== "auto") {
    if (explicit === "all_in_one_reference") return "reference_to_video";
    return explicit as CapabilityMode;
  }
  const inputs = body.videoInputs || body.video_inputs || {};
  const references = Array.isArray(inputs.referenceImageAssetIds) ? inputs.referenceImageAssetIds : [];
  if (inputs.sourceVideoAssetId && inputs.editInstruction) return "video_edit";
  if (inputs.firstFrameAssetId && inputs.lastFrameAssetId) return "first_last_frame";
  if (references.length > 1) return "reference_to_video";
  if (inputs.firstFrameAssetId || references.length === 1) return "image_to_video";
  return "text_to_video";
}

function paramsForCapability(profile: any) {
  const activeRevision = profile.activeRevision || activeRevisionFor(profile);
  return activeRevision?.params || {};
}

function supportedModes(params: any, capability: ModelCapability): string[] {
  if (capability === ModelCapability.IMAGE_GENERATOR) return params.imageCapabilities?.modes || [];
  if (capability === ModelCapability.VIDEO_GENERATOR) return params.videoCapabilities?.modes || [];
  return [];
}

function assertEnumControl(input: { value: unknown; allowed: unknown[] | undefined; label: string; code: string }) {
  if (input.value === undefined || input.value === null || input.value === "") return;
  const allowed = Array.isArray(input.allowed) ? input.allowed.map(String) : [];
  if (allowed.length === 0) {
    throw new HttpError(400, `${input.label} 不是当前模型支持的参数。`, input.code, { value: input.value });
  }
  if (!allowed.includes(String(input.value))) {
    throw new HttpError(400, `${input.label} 超出当前模型能力范围。`, input.code, { value: input.value, allowed });
  }
}

function normalizeImageQualityForControls(value: unknown, controls: any) {
  if (value === undefined || value === null || value === "") return value;
  const allowed = Array.isArray(controls?.quality) ? controls.quality.map(String) : [];
  const raw = String(value);
  if (allowed.includes(raw)) return raw;
  if (raw === "standard" && allowed.includes("medium")) return "medium";
  return raw;
}

function assertBooleanControl(input: { present: boolean; enabled: boolean | undefined; label: string; code: string }) {
  if (!input.present) return;
  if (!input.enabled) throw new HttpError(400, `${input.label} 不是当前模型支持的参数。`, input.code);
}

function assertRangeControl(input: { value: unknown; range: any; label: string; code: string }) {
  if (input.value === undefined || input.value === null || input.value === "") return;
  if (!input.range || input.range === false) throw new HttpError(400, `${input.label} 不是当前模型支持的参数。`, input.code, { value: input.value });
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < Number(input.range.min) || value > Number(input.range.max)) {
    throw new HttpError(400, `${input.label} 超出当前模型能力范围。`, input.code, { value, min: input.range.min, max: input.range.max });
  }
}

function assertImageSizeConstraints(input: { width: unknown; height: unknown; constraints: any; label: string; code: string }) {
  if (!input.constraints) return;
  const width = Number(input.width || 0);
  const height = Number(input.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new HttpError(400, `${input.label} 必须提供有效宽高。`, input.code, { width: input.width, height: input.height });
  }
  const multipleOf = Number(input.constraints.multipleOf || 1);
  if (multipleOf > 1 && (width % multipleOf !== 0 || height % multipleOf !== 0)) {
    throw new HttpError(400, `${input.label} 宽高必须是 ${multipleOf} 的倍数。`, input.code, { width, height, multipleOf });
  }
  const maxEdge = Number(input.constraints.maxEdge || 0);
  if (maxEdge > 0 && (width > maxEdge || height > maxEdge)) {
    throw new HttpError(400, `${input.label} 边长超出当前模型能力范围。`, input.code, { width, height, maxEdge });
  }
  const pixels = width * height;
  const minTotalPixels = Number(input.constraints.minTotalPixels || 0);
  const maxTotalPixels = Number(input.constraints.maxTotalPixels || 0);
  if (minTotalPixels > 0 && pixels < minTotalPixels) {
    throw new HttpError(400, `${input.label} 总像素低于当前模型能力范围。`, input.code, { width, height, pixels, minTotalPixels });
  }
  if (maxTotalPixels > 0 && pixels > maxTotalPixels) {
    throw new HttpError(400, `${input.label} 总像素超出当前模型能力范围。`, input.code, { width, height, pixels, maxTotalPixels });
  }
  const maxRatio = Number(input.constraints.maxLongToShortRatio || 0);
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  if (maxRatio > 0 && shortEdge > 0 && longEdge / shortEdge > maxRatio) {
    throw new HttpError(400, `${input.label} 长短边比例超出当前模型能力范围。`, input.code, { width, height, maxLongToShortRatio: maxRatio });
  }
}

function assertSlotEnabled(input: { condition: boolean; enabled: boolean | undefined; label: string; code: string }) {
  if (!input.condition) return;
  if (!input.enabled) throw new HttpError(400, `当前模型不支持${input.label}输入。`, input.code);
}

async function assertAssetAccess(input: { assetId: string; user: RequestUser; allowedTypes: MediaAssetType[]; label: string }) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: input.assetId } });
  if (!asset || !canReadMediaAsset(input.user, asset)) {
    throw new HttpError(404, `${input.label} not found or not accessible.`, "MEDIA_ASSET_NOT_ACCESSIBLE", { assetId: input.assetId });
  }
  if (!input.allowedTypes.includes(asset.type)) {
    throw new HttpError(400, `${input.label} type is not supported by the selected mode.`, "MEDIA_ASSET_TYPE_MISMATCH", {
      assetId: input.assetId,
      type: asset.type,
      allowedTypes: input.allowedTypes
    });
  }
  return asset;
}

export async function validateWorkflowCapabilityExecution(input: {
  configId?: string;
  expectedCapability: ModelCapability;
  body: any;
  user: RequestUser;
}) {
  if (!input.configId) throw new HttpError(400, "请选择后端保存的模型配置后再执行生成任务。", "CUSTOM_CONFIG_REQUIRED");
  const config = await prisma.customApiConfig.findUnique({ where: { id: input.configId } });
  if (!config) throw new HttpError(404, "Custom API config not found.", "CUSTOM_API_CONFIG_NOT_FOUND");
  if (!config.isEnabled) throw new HttpError(400, "Custom API config is disabled.", "CUSTOM_API_CONFIG_DISABLED");
  if (config.capability !== input.expectedCapability) {
    throw new HttpError(400, "模型能力类型与当前节点不匹配。", "MODEL_CAPABILITY_MISMATCH", {
      expected: input.expectedCapability,
      actual: config.capability
    });
  }
  if (!config.canonicalModelId || !config.activeCapabilityRevisionId) {
    throw new HttpError(400, "该模型尚未绑定后端能力模板，不能执行生成任务。", "MODEL_CAPABILITY_NOT_BOUND", { configId: config.id });
  }

  const profile = await prisma.modelCapabilityProfile.findFirst({
    where: { canonicalModelId: config.canonicalModelId, capability: config.capability },
    include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
  });
  if (!profile) throw new HttpError(400, "该模型能力模板不存在，不能执行生成任务。", "MODEL_CAPABILITY_PROFILE_NOT_FOUND");
  const activeRevision = activeRevisionFor(profile);
  if (!activeRevision || activeRevision.id !== config.activeCapabilityRevisionId) {
    throw new HttpError(400, "该模型能力版本已变化，请重新保存模型配置后再执行。", "MODEL_CAPABILITY_REVISION_MISMATCH", {
      canonicalModelId: profile.canonicalModelId,
      expectedRevisionId: profile.activeRevisionId,
      configRevisionId: config.activeCapabilityRevisionId
    });
  }
  if (!isExecutableVerificationStatus(profile.verificationStatus)) {
    throw new HttpError(400, "该模型尚未完成官方参数验证，不能执行生成任务。", "MODEL_CAPABILITY_UNVERIFIED", {
      canonicalModelId: profile.canonicalModelId,
      capability: profile.capability,
      verificationStatus: profile.verificationStatus
    });
  }

  const params = paramsForCapability({ ...profile, activeRevision });
  const mode = input.expectedCapability === ModelCapability.IMAGE_GENERATOR
    ? resolveImageGenerationMode(input.body)
    : resolveVideoGenerationMode(input.body);
  const modes = supportedModes(params, input.expectedCapability);
  if (!modes.includes(mode)) {
    throw new HttpError(400, "当前模型不支持该生成模式。", "MODEL_MODE_NOT_SUPPORTED", {
      canonicalModelId: profile.canonicalModelId,
      mode,
      supportedModes: modes
    });
  }

  if (input.expectedCapability === ModelCapability.IMAGE_GENERATOR) {
    const legacyRefs = [...(input.body.images || []), ...(input.body.uploaded_images || [])];
    if (legacyRefs.length > 0) {
      throw new HttpError(400, "图片生成输入素材必须使用后端 assetId，不能传 URL。", "MEDIA_ASSET_ID_REQUIRED");
    }
    const imageInputs = input.body.imageInputs || input.body.image_inputs || {};
    const refs = Array.isArray(imageInputs.referenceImageAssetIds) ? imageInputs.referenceImageAssetIds : [];
    const slots = params.imageCapabilities?.inputSlots || {};
    const controls = params.imageCapabilities?.controls || {};
    const maxInputImages = Number(params.imageCapabilities?.limits?.maxInputImages || 0);
    const totalImages = refs.length + (imageInputs.sourceImageAssetId ? 1 : 0) + (imageInputs.maskImageAssetId ? 1 : 0);
    if (maxInputImages >= 0 && totalImages > maxInputImages) {
      throw new HttpError(400, "输入图片数量超过模型能力限制。", "MEDIA_ASSET_LIMIT_EXCEEDED", { totalImages, maxInputImages });
    }
    if (refs.length > Number(slots.referenceImages?.maxCount || 0)) {
      throw new HttpError(400, "参考图数量超过模型输入槽位限制。", "REFERENCE_IMAGE_SLOT_LIMIT_EXCEEDED", { count: refs.length, maxCount: slots.referenceImages?.maxCount || 0 });
    }
    assertSlotEnabled({ condition: refs.length > 0, enabled: slots.referenceImages?.enabled, label: "参考图", code: "REFERENCE_IMAGE_SLOT_DISABLED" });
    assertSlotEnabled({ condition: Boolean(imageInputs.sourceImageAssetId), enabled: slots.sourceImage?.enabled, label: "源图", code: "SOURCE_IMAGE_SLOT_DISABLED" });
    assertSlotEnabled({ condition: Boolean(imageInputs.maskImageAssetId), enabled: slots.maskImage?.enabled, label: "蒙版", code: "MASK_IMAGE_SLOT_DISABLED" });
    if (controls.sizeConstraints) {
      assertImageSizeConstraints({ width: input.body.width, height: input.body.height, constraints: controls.sizeConstraints, label: "图片尺寸", code: "IMAGE_SIZE_NOT_SUPPORTED" });
    } else {
      assertEnumControl({ value: input.body.aspect_ratio, allowed: controls.aspectRatio, label: "画幅比例", code: "IMAGE_ASPECT_RATIO_NOT_SUPPORTED" });
    }
    input.body.image_quality = normalizeImageQualityForControls(input.body.image_quality, controls) as any;
    assertEnumControl({ value: input.body.image_quality, allowed: controls.quality, label: "画质", code: "IMAGE_QUALITY_NOT_SUPPORTED" });
    assertEnumControl({ value: input.body.output_format, allowed: controls.outputFormat, label: "输出格式", code: "IMAGE_OUTPUT_FORMAT_NOT_SUPPORTED" });
    assertEnumControl({ value: input.body.image_background || input.body.background, allowed: controls.background, label: "背景模式", code: "IMAGE_BACKGROUND_NOT_SUPPORTED" });
    assertEnumControl({ value: input.body.moderation, allowed: controls.moderation, label: "内容审核强度", code: "IMAGE_MODERATION_NOT_SUPPORTED" });
    assertRangeControl({ value: input.body.output_compression, range: controls.outputCompression, label: "输出压缩率", code: "IMAGE_OUTPUT_COMPRESSION_NOT_SUPPORTED" });
    assertRangeControl({ value: input.body.partial_images, range: controls.partialImages, label: "流式局部图片数量", code: "IMAGE_PARTIAL_IMAGES_NOT_SUPPORTED" });
    assertBooleanControl({ present: input.body.stream !== undefined && Boolean(input.body.stream), enabled: controls.stream, label: "流式生成", code: "IMAGE_STREAM_NOT_SUPPORTED" });
    assertBooleanControl({ present: input.body.input_fidelity !== undefined && String(input.body.input_fidelity || "").trim().length > 0, enabled: controls.inputFidelity !== false, label: "输入保真度", code: "IMAGE_INPUT_FIDELITY_NOT_SUPPORTED" });
    assertBooleanControl({ present: input.body.negative_prompt !== undefined && String(input.body.negative_prompt || "").trim().length > 0, enabled: controls.negativePrompt, label: "负向提示词", code: "NEGATIVE_PROMPT_NOT_SUPPORTED" });
    assertBooleanControl({ present: input.body.seed !== undefined && Number(input.body.seed) >= 0, enabled: controls.seed, label: "随机种子", code: "SEED_NOT_SUPPORTED" });
    assertRangeControl({ value: input.body.steps, range: controls.steps, label: "步数", code: "STEPS_NOT_SUPPORTED" });
    assertRangeControl({ value: input.body.cfg_scale, range: controls.cfgScale, label: "CFG Scale", code: "CFG_SCALE_NOT_SUPPORTED" });
    for (const id of refs) await assertAssetAccess({ assetId: String(id), user: input.user, allowedTypes: [MediaAssetType.IMAGE], label: "Reference image" });
    if (imageInputs.sourceImageAssetId) await assertAssetAccess({ assetId: String(imageInputs.sourceImageAssetId), user: input.user, allowedTypes: [MediaAssetType.IMAGE], label: "Source image" });
    if (imageInputs.maskImageAssetId) await assertAssetAccess({ assetId: String(imageInputs.maskImageAssetId), user: input.user, allowedTypes: [MediaAssetType.IMAGE], label: "Mask image" });
  }

  if (input.expectedCapability === ModelCapability.VIDEO_GENERATOR) {
    const legacyRefs = input.body.video_media_list || [];
    if (legacyRefs.some((item: any) => item?.url)) {
      throw new HttpError(400, "视频生成输入素材必须使用后端 assetId，不能传 URL。", "MEDIA_ASSET_ID_REQUIRED");
    }
    const videoInputs = input.body.videoInputs || input.body.video_inputs || {};
    const refImages = Array.isArray(videoInputs.referenceImageAssetIds) ? videoInputs.referenceImageAssetIds : [];
    const slots = params.videoCapabilities?.inputSlots || {};
    const controls = params.videoCapabilities?.controls || {};
    const maxInputImages = Number(params.videoCapabilities?.limits?.maxInputImages || 0);
    if (maxInputImages >= 0 && refImages.length + (videoInputs.firstFrameAssetId ? 1 : 0) + (videoInputs.lastFrameAssetId ? 1 : 0) > maxInputImages) {
      throw new HttpError(400, "输入图片数量超过视频模型能力限制。", "MEDIA_ASSET_LIMIT_EXCEEDED");
    }
    if (refImages.length > Number(slots.referenceImages?.maxCount || 0)) {
      throw new HttpError(400, "参考图数量超过视频模型输入槽位限制。", "REFERENCE_IMAGE_SLOT_LIMIT_EXCEEDED", { count: refImages.length, maxCount: slots.referenceImages?.maxCount || 0 });
    }
    assertSlotEnabled({ condition: Boolean(videoInputs.firstFrameAssetId), enabled: slots.firstFrame?.enabled, label: "首帧", code: "FIRST_FRAME_SLOT_DISABLED" });
    assertSlotEnabled({ condition: Boolean(videoInputs.lastFrameAssetId), enabled: slots.lastFrame?.enabled, label: "尾帧", code: "LAST_FRAME_SLOT_DISABLED" });
    assertSlotEnabled({ condition: refImages.length > 0, enabled: slots.referenceImages?.enabled, label: "参考图", code: "REFERENCE_IMAGE_SLOT_DISABLED" });
    assertSlotEnabled({ condition: Boolean(videoInputs.sourceVideoAssetId), enabled: slots.sourceVideo?.enabled, label: "源视频", code: "SOURCE_VIDEO_SLOT_DISABLED" });
    assertSlotEnabled({ condition: Boolean(videoInputs.referenceVideoAssetId), enabled: slots.referenceVideo?.enabled, label: "参考视频", code: "REFERENCE_VIDEO_SLOT_DISABLED" });
    assertSlotEnabled({ condition: Boolean(videoInputs.audioAssetId), enabled: slots.audio?.enabled, label: "音频", code: "AUDIO_SLOT_DISABLED" });
    assertEnumControl({ value: input.body.aspect_ratio, allowed: controls.aspectRatio, label: "视频画幅比例", code: "VIDEO_ASPECT_RATIO_NOT_SUPPORTED" });
    assertEnumControl({ value: input.body.video_resolution, allowed: controls.resolution, label: "视频分辨率", code: "VIDEO_RESOLUTION_NOT_SUPPORTED" });
    assertEnumControl({ value: input.body.video_duration, allowed: controls.duration, label: "视频时长", code: "VIDEO_DURATION_NOT_SUPPORTED" });
    assertBooleanControl({ present: input.body.negative_prompt !== undefined && String(input.body.negative_prompt || "").trim().length > 0, enabled: controls.negativePrompt, label: "负向提示词", code: "NEGATIVE_PROMPT_NOT_SUPPORTED" });
    assertBooleanControl({ present: input.body.generate_audio !== undefined && Boolean(input.body.generate_audio), enabled: controls.generateAudio, label: "生成音频", code: "GENERATE_AUDIO_NOT_SUPPORTED" });
    assertBooleanControl({ present: input.body.seed !== undefined && Number(input.body.seed) >= 0, enabled: controls.seed, label: "随机种子", code: "SEED_NOT_SUPPORTED" });
    for (const id of refImages) await assertAssetAccess({ assetId: String(id), user: input.user, allowedTypes: [MediaAssetType.IMAGE], label: "Reference image" });
    if (videoInputs.firstFrameAssetId) await assertAssetAccess({ assetId: String(videoInputs.firstFrameAssetId), user: input.user, allowedTypes: [MediaAssetType.IMAGE], label: "First frame" });
    if (videoInputs.lastFrameAssetId) await assertAssetAccess({ assetId: String(videoInputs.lastFrameAssetId), user: input.user, allowedTypes: [MediaAssetType.IMAGE], label: "Last frame" });
    if (videoInputs.sourceVideoAssetId) await assertAssetAccess({ assetId: String(videoInputs.sourceVideoAssetId), user: input.user, allowedTypes: [MediaAssetType.VIDEO], label: "Source video" });
    if (videoInputs.referenceVideoAssetId) await assertAssetAccess({ assetId: String(videoInputs.referenceVideoAssetId), user: input.user, allowedTypes: [MediaAssetType.VIDEO], label: "Reference video" });
    if (videoInputs.audioAssetId) await assertAssetAccess({ assetId: String(videoInputs.audioAssetId), user: input.user, allowedTypes: [MediaAssetType.AUDIO], label: "Audio" });
  }

  return { config, profile: { ...profile, activeRevision }, mode, params };
}
