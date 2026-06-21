import { ModelCapability, ModelCapabilityVerificationStatus } from "@prisma/client";

export type CapabilityMode =
  | "chat_completion"
  | "prompt_completion"
  | "text_to_image"
  | "image_to_image"
  | "image_edit"
  | "text_to_video"
  | "image_to_video"
  | "first_last_frame"
  | "reference_to_video"
  | "video_edit";

export type CapabilityRegistryEntry = {
  canonicalModelId: string;
  officialModelId: string;
  provider: string;
  capability: ModelCapability;
  aliases: string[];
  verificationStatus: ModelCapabilityVerificationStatus;
  sourceUrls: string[];
  params: Record<string, any>;
};

function openAiTextParams() {
  return {
    textCapabilities: {
      modes: ["chat_completion"],
      defaultMode: "chat_completion",
      controls: {
        systemPrompt: true,
        attachments: true,
        stream: true,
        maxPromptChars: 12000,
        maxOutputTokens: { min: 1, max: 16384, default: 2048 },
        temperature: { min: 0, max: 2, default: 0.7 }
      },
      limits: {
        maxAttachmentCount: 6,
        maxAttachmentBytes: 3145728,
        maxTotalAttachmentBytes: 10485760
      },
      supportedAttachmentMimePrefixes: ["image/"],
      providerAdapter: "openai-chat" as const,
      runtime: {
        endpoint: "/chat/completions",
        streamEndpoint: "/chat/completions",
        responsePaths: ["choices.0.message.content", "choices.0.text", "text", "output_text"],
        streamChunkPaths: ["choices.0.delta.content", "choices.0.text", "delta.content"]
      }
    }
  };
}

function geminiTextParams() {
  return {
    textCapabilities: {
      modes: ["chat_completion"],
      defaultMode: "chat_completion",
      controls: {
        systemPrompt: true,
        attachments: true,
        stream: true,
        maxPromptChars: 12000,
        maxOutputTokens: { min: 1, max: 8192, default: 2048 },
        temperature: { min: 0, max: 2, default: 0.7 }
      },
      limits: {
        maxAttachmentCount: 6,
        maxAttachmentBytes: 3145728,
        maxTotalAttachmentBytes: 10485760
      },
      supportedAttachmentMimePrefixes: ["image/"],
      providerAdapter: "gemini-native" as const,
      runtime: {
        responsePaths: ["candidates.0.content.parts.0.text", "text", "output_text"],
        streamChunkPaths: ["candidates.0.content.parts.0.text", "text"]
      }
    }
  };
}

function geminiImageParams(options: {
  modelOverride: string;
  sizes?: string[];
  ratios: string[];
}) {
  return {
    imageCapabilities: {
      modes: ["text_to_image"],
      defaultMode: "text_to_image",
      inputSlots: {
        referenceImages: { enabled: false, maxCount: 0 },
        sourceImage: { enabled: false },
        maskImage: { enabled: false }
      },
      controls: {
        prompt: true,
        negativePrompt: false,
        aspectRatio: options.ratios,
        size: options.sizes || ["1K", "2K", "4K"],
        quality: [],
        outputFormat: ["png"],
        seed: false,
        steps: false,
        cfgScale: false,
        strength: false,
        safetyFilterLevel: ["block_low_and_above", "block_medium_and_above", "block_only_high"],
        personGeneration: ["allow_adult", "allow_all", "dont_allow"]
      },
      limits: {
        maxOutputImages: 4,
        maxInputImages: 0
      },
      providerAdapter: "google-gemini-image" as const,
      runtime: {
        modelOverride: options.modelOverride,
        endpoint: "/v1/images/generations",
        payloadFields: {
          model: "model",
          prompt: "prompt",
          aspectRatio: "aspect_ratio",
          resolution: "resolution"
        },
        responsePaths: ["data.0.url", "data.0.b64_json", "data.0.image_url", "url", "image_url", "result.url", "result.image_url", "result.images.0.url", "output.0.url"],
        taskIdPaths: ["id", "task_id", "taskId", "data.id", "data.task_id", "data.taskId"]
      }
    }
  };
}

function gptImage2Params() {
  return {
    imageCapabilities: {
      modes: ["text_to_image", "image_to_image", "image_edit"],
      defaultMode: "text_to_image",
      inputSlots: {
        referenceImages: { enabled: true, maxCount: 16 },
        sourceImage: { enabled: true },
        maskImage: { enabled: true }
      },
      controls: {
        prompt: true,
        negativePrompt: false,
        aspectRatio: ["auto", "1:3", "9:16", "2:3", "3:4", "4:5", "1:1", "5:4", "4:3", "3:2", "16:9", "21:9", "2:1", "3:1"],
        size: ["1024x1024", "1024x3072", "1152x2048", "1024x1536", "1024x1280", "1280x1024", "1536x1024", "2048x1152", "2560x1088", "2048x1024", "3072x1024", "3840x2160", "auto"],
        sizeConstraints: {
          minTotalPixels: 655360,
          maxTotalPixels: 8294400,
          maxEdge: 3840,
          multipleOf: 16,
          maxLongToShortRatio: 3
        },
        quality: ["auto", "high", "medium", "low"],
        outputFormat: ["png", "jpeg", "webp"],
        outputCompression: { enabled: true, min: 0, max: 100, default: 100 },
        background: ["auto", "opaque"],
        moderation: ["auto", "low"],
        partialImages: { enabled: true, min: 0, max: 3, default: 0 },
        seed: false,
        steps: false,
        cfgScale: false,
        strength: false
      },
      limits: {
        maxOutputImages: 1,
        maxInputImages: 16,
        maxInputImageSizeBytes: 20971520,
        maxMaskImageSizeBytes: 20971520
      },
      providerAdapter: "openai-image" as const,
      runtime: {
        responsePaths: ["data.0.url", "data.0.b64_json", "url", "image_url", "result.url"],
        taskIdPaths: ["id", "task_id", "taskId"]
      }
    }
  };
}

function seedance2Params() {
  return {
    videoCapabilities: {
      modes: ["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"],
      defaultMode: "text_to_video",
      inputSlots: {
        firstFrame: { enabled: true },
        lastFrame: { enabled: true },
        referenceImages: { enabled: true, maxCount: 9 },
        sourceVideo: { enabled: true },
        referenceVideo: { enabled: true },
        audio: { enabled: true }
      },
      controls: {
        prompt: true,
        negativePrompt: false,
        duration: [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        aspectRatio: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        resolution: ["480p", "720p", "1080p"],
        fps: [24],
        cameraControl: false,
        motionStrength: false,
        seed: true,
        generateAudio: true
      },
      limits: {
        maxInputImages: 9,
        maxInputVideos: 3,
        maxInputAudios: 3
      },
      providerAdapter: "seedance-video" as const,
      runtime: {
        endpoint: "/video/generations",
        payloadFields: {
          model: "model",
          prompt: "prompt",
          aspectRatio: "ratio",
          resolution: "resolution",
          duration: "duration",
          generateAudio: "generate_audio",
          seed: "seed"
        },
        responsePaths: ["data.0.url", "data.0.video_url", "url", "video_url", "result.url", "result.video_url"],
        taskIdPaths: ["id", "task_id", "taskId"],
        pollEndpoint: "/video/status/{taskId}",
        pollResultPaths: ["url", "video_url", "data.0.url", "data.0.video_url", "output.0"],
        pollStatusPaths: ["status", "state", "data.status", "data.state"],
        failedStatuses: ["failed", "error", "canceled", "cancelled"]
      }
    }
  };
}

export const CAPABILITY_REGISTRY: CapabilityRegistryEntry[] = [
  {
    canonicalModelId: "openai:chat-completions",
    officialModelId: "openai-chat-compatible",
    provider: "OpenAI",
    capability: ModelCapability.TEXT_GENERATOR,
    aliases: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-5", "gpt-5-mini", "openai-compatible", "chat-completions"],
    verificationStatus: ModelCapabilityVerificationStatus.MANUAL_VERIFIED,
    sourceUrls: ["project://apps/api/src/modules/custom-ai/provider-client.ts"],
    params: openAiTextParams()
  },
  {
    canonicalModelId: "google:gemini-native-text",
    officialModelId: "gemini-native-text",
    provider: "Google",
    capability: ModelCapability.TEXT_GENERATOR,
    aliases: ["gemini", "gemini-pro", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    verificationStatus: ModelCapabilityVerificationStatus.MANUAL_VERIFIED,
    sourceUrls: ["project://apps/api/src/modules/custom-ai/provider-client.ts"],
    params: geminiTextParams()
  },
  {
    canonicalModelId: "openai:gpt-image-2",
    officialModelId: "gpt-image-2",
    provider: "OpenAI",
    capability: ModelCapability.IMAGE_GENERATOR,
    aliases: ["gpt-image-2", "gptimage2", "gpt_image_2", "gpt image 2"],
    verificationStatus: ModelCapabilityVerificationStatus.UNVERIFIED,
    sourceUrls: ["https://platform.openai.com/docs/guides/image-generation", "https://platform.openai.com/docs/api-reference/images"],
    params: gptImage2Params()
  },
  {
    canonicalModelId: "google:nano-banana-2",
    officialModelId: "gemini-3.1-flash-image",
    provider: "Google",
    capability: ModelCapability.IMAGE_GENERATOR,
    aliases: ["nano-banana-2", "nano banana 2", "nanobanana2", "gemini-3.1-flash-image", "gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"],
    verificationStatus: ModelCapabilityVerificationStatus.UNVERIFIED,
    sourceUrls: ["https://ai.google.dev/gemini-api/docs/image-generation", "https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images"],
    params: geminiImageParams({
      modelOverride: "gemini-3.1-flash-image",
      sizes: ["512", "1K", "2K", "4K"],
      ratios: ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"]
    })
  },
  {
    canonicalModelId: "google:nano-banana-pro",
    officialModelId: "gemini-3-pro-image",
    provider: "Google",
    capability: ModelCapability.IMAGE_GENERATOR,
    aliases: ["nano-banana-pro", "nano banana pro", "nanobananapro", "gemini-3-pro-image", "gemini 3 pro image", "gemini-3-pro-image-preview"],
    verificationStatus: ModelCapabilityVerificationStatus.UNVERIFIED,
    sourceUrls: ["https://ai.google.dev/gemini-api/docs/image-generation", "https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images"],
    params: geminiImageParams({
      modelOverride: "gemini-3-pro-image",
      sizes: ["1K", "2K", "4K"],
      ratios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
    })
  },
  {
    canonicalModelId: "bytedance:seedance-2.0",
    officialModelId: "seedance-2.0",
    provider: "ByteDance",
    capability: ModelCapability.VIDEO_GENERATOR,
    aliases: ["seedance-2.0", "seedance2", "seedance 2.0", "doubao seedance2.0", "doubao seedance 2.0", "doubao-seedance-2.0", "seedance 2"],
    verificationStatus: ModelCapabilityVerificationStatus.UNVERIFIED,
    sourceUrls: ["https://www.volcengine.com/docs/82379/1520757?lang=zh"],
    params: seedance2Params()
  }
];

export function normalizeAlias(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "");
}

export function normalizeProviderName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "");
}

export function findRegistryEntry(input: { provider?: unknown; capability: ModelCapability; modelName?: unknown }) {
  const normalizedModel = normalizeAlias(input.modelName);
  const normalizedProvider = normalizeProviderName(input.provider);
  if (!normalizedModel) return null;
  return CAPABILITY_REGISTRY.find((entry) => {
    if (entry.capability !== input.capability) return false;
    const providerMatches = input.capability === ModelCapability.TEXT_GENERATOR
      ? (!normalizedProvider || normalizedProvider === "custom" || normalizedProvider === "openaicompatible" || normalizeProviderName(entry.provider) === normalizedProvider)
      : (!normalizedProvider || normalizeProviderName(entry.provider) === normalizedProvider);
    const normalizedAliases = [entry.officialModelId, entry.canonicalModelId, ...entry.aliases].map(normalizeAlias);
    const aliasMatches = normalizedAliases.some((alias) => {
      if (!alias) return false;
      if (alias === normalizedModel) return true;
      return alias.length >= 8 && (normalizedModel.includes(alias) || alias.includes(normalizedModel));
    });
    return providerMatches && aliasMatches;
  }) || null;
}

export function isExecutableVerificationStatus(status: ModelCapabilityVerificationStatus | string | null | undefined) {
  return status === ModelCapabilityVerificationStatus.VERIFIED || status === ModelCapabilityVerificationStatus.MANUAL_VERIFIED;
}
