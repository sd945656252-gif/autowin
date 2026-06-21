import { ModelCapability } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../../shared/http";

const booleanControlSchema = z.boolean();
const numberRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
  default: z.number()
}).refine((value) => value.min <= value.default && value.default <= value.max, {
  message: "default must be between min and max"
});
const imageSizeConstraintsSchema = z.object({
  minTotalPixels: z.number().int().min(1).optional(),
  maxTotalPixels: z.number().int().min(1).optional(),
  maxEdge: z.number().int().min(1).optional(),
  multipleOf: z.number().int().min(1).optional(),
  maxLongToShortRatio: z.number().positive().optional()
}).strict();
const maskRequirementsSchema = z.object({
  sameFormatAndSize: z.boolean().optional(),
  alphaChannelRequired: z.boolean().optional(),
  maxBytes: z.number().int().min(1).optional()
}).strict();
const officialDocSourceSchema = z.object({
  url: z.string().url(),
  via: z.string().max(80).optional(),
  checkedAt: z.string().max(40).optional()
}).strict();
const runtimeAdapterSchema = z.object({
  modelOverride: z.string().max(160).optional(),
  endpoint: z.string().max(500).optional(),
  streamEndpoint: z.string().max(500).optional(),
  payloadFields: z.record(z.string(), z.string().max(120)).optional(),
  payloadDefaults: z.record(z.string(), z.any()).optional(),
  responsePaths: z.array(z.string().max(120)).max(40).optional(),
  streamChunkPaths: z.array(z.string().max(120)).max(40).optional(),
  taskIdPaths: z.array(z.string().max(120)).max(20).optional(),
  pollEndpoint: z.string().max(500).optional(),
  pollResultPaths: z.array(z.string().max(120)).max(40).optional(),
  pollStatusPaths: z.array(z.string().max(120)).max(20).optional(),
  failedStatuses: z.array(z.string().max(40)).max(20).optional(),
  multipartFields: z.object({
    referenceImages: z.string().max(80).optional(),
    firstFrame: z.string().max(80).optional(),
    lastFrame: z.string().max(80).optional(),
    sourceVideo: z.string().max(80).optional(),
    referenceVideo: z.string().max(80).optional(),
    audio: z.string().max(80).optional()
  }).strict().optional()
}).strict();
const enabledRangeSchema = z.object({
  enabled: z.boolean(),
  min: z.number(),
  max: z.number(),
  default: z.number()
}).refine((value) => value.min <= value.default && value.default <= value.max, {
  message: "default must be between min and max"
}).passthrough();

const imageModeSchema = z.enum(["text_to_image", "image_to_image", "image_edit"]);
const videoModeSchema = z.enum(["text_to_video", "image_to_video", "first_last_frame", "reference_to_video", "video_edit"]);
const textModeSchema = z.enum(["chat_completion", "prompt_completion"]);

export const imageCapabilitiesSchema = z.object({
  modes: z.array(imageModeSchema).min(1),
  defaultMode: imageModeSchema,
  inputSlots: z.object({
    referenceImages: z.object({ enabled: z.boolean(), maxCount: z.number().int().min(0).max(20) }),
    sourceImage: z.object({ enabled: z.boolean() }),
    maskImage: z.object({ enabled: z.boolean(), requirements: maskRequirementsSchema.optional() })
  }),
  controls: z.object({
    prompt: z.literal(true),
    promptMaxChars: z.number().int().min(1).optional(),
    negativePrompt: booleanControlSchema,
    aspectRatio: z.array(z.string()).max(40),
    size: z.array(z.string()).max(80),
    sizeConstraints: imageSizeConstraintsSchema.optional(),
    quality: z.array(z.string()).max(40),
      outputFormat: z.array(z.string()).max(20),
      outputCompression: z.union([enabledRangeSchema, z.literal(false)]).optional(),
      background: z.array(z.string()).max(20).optional(),
      transparentBackground: booleanControlSchema.optional(),
      moderation: z.array(z.string()).max(20).optional(),
      stream: booleanControlSchema.optional(),
      partialImages: z.union([enabledRangeSchema, z.literal(false)]).optional(),
      inputFidelity: z.union([z.array(z.string()).max(20), z.literal(false)]).optional(),
      responseFormat: booleanControlSchema.optional(),
      style: booleanControlSchema.optional(),
      seed: booleanControlSchema,
    steps: z.union([numberRangeSchema, z.literal(false)]),
    cfgScale: z.union([numberRangeSchema, z.literal(false)]),
    strength: z.union([numberRangeSchema, z.literal(false)])
  }),
  modeDetection: z.record(z.string(), z.any()).optional(),
  limits: z.object({
    maxOutputImages: z.number().int().min(1).max(20),
    maxInputImages: z.number().int().min(0).max(20)
  }),
  officialLimits: z.object({
    maxOutputImages: z.number().int().min(1).max(20).optional(),
    maxInputImages: z.number().int().min(0).max(20).optional()
  }).strict().optional(),
  sourceDocs: z.array(officialDocSourceSchema).max(10).optional(),
  runtime: runtimeAdapterSchema.optional(),
  providerAdapter: z.enum(["openai-image", "google-gemini-image", "custom"])
}).refine((value) => value.modes.includes(value.defaultMode), {
  message: "defaultMode must be included in modes"
});

export const videoCapabilitiesSchema = z.object({
  modes: z.array(videoModeSchema).min(1),
  defaultMode: videoModeSchema,
  inputSlots: z.object({
    firstFrame: z.object({ enabled: z.boolean() }),
    lastFrame: z.object({ enabled: z.boolean() }),
    referenceImages: z.object({ enabled: z.boolean(), maxCount: z.number().int().min(0).max(20) }),
    sourceVideo: z.object({ enabled: z.boolean() }),
    referenceVideo: z.object({ enabled: z.boolean() }),
    audio: z.object({ enabled: z.boolean() })
  }),
  controls: z.object({
    prompt: z.literal(true),
    negativePrompt: booleanControlSchema,
    duration: z.array(z.number().int().min(-1).max(120)).min(1).max(40),
    aspectRatio: z.array(z.string()).max(40),
    resolution: z.array(z.string()).max(40),
    fps: z.array(z.number().int().min(1).max(240)).max(20),
    cameraControl: booleanControlSchema,
    motionStrength: booleanControlSchema,
    seed: booleanControlSchema,
    generateAudio: booleanControlSchema
  }),
  limits: z.object({
    maxInputImages: z.number().int().min(0).max(20),
    maxInputVideos: z.number().int().min(0).max(10),
    maxInputAudios: z.number().int().min(0).max(10)
  }),
  runtime: runtimeAdapterSchema.optional(),
  providerAdapter: z.enum(["seedance-video", "custom"])
}).refine((value) => value.modes.includes(value.defaultMode), {
  message: "defaultMode must be included in modes"
});

export const textCapabilitiesSchema = z.object({
  modes: z.array(textModeSchema).min(1),
  defaultMode: textModeSchema,
  controls: z.object({
    systemPrompt: booleanControlSchema,
    attachments: booleanControlSchema,
    stream: booleanControlSchema,
    maxPromptChars: z.number().int().min(1).optional(),
    maxOutputTokens: z.union([numberRangeSchema, z.literal(false)]),
    temperature: z.union([numberRangeSchema, z.literal(false)])
  }),
  limits: z.object({
    maxAttachmentCount: z.number().int().min(0).max(50).optional(),
    maxAttachmentBytes: z.number().int().min(1).optional(),
    maxTotalAttachmentBytes: z.number().int().min(1).optional()
  }).strict().optional(),
  supportedAttachmentMimePrefixes: z.array(z.string().max(80)).max(40).optional(),
  runtime: runtimeAdapterSchema.optional(),
  providerAdapter: z.enum(["openai-chat", "gemini-native", "custom"])
}).refine((value) => value.modes.includes(value.defaultMode), {
  message: "defaultMode must be included in modes"
});

export const capabilityParamsSchema = z.object({
  imageCapabilities: imageCapabilitiesSchema.optional(),
  videoCapabilities: videoCapabilitiesSchema.optional(),
  textCapabilities: textCapabilitiesSchema.optional()
}).passthrough();

export function parseCapabilityParams(capability: ModelCapability, params: unknown) {
  const parsed = capabilityParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new HttpError(400, "模型能力参数结构不合法。", "INVALID_CAPABILITY_PARAMS", parsed.error.flatten());
  }
  if (capability === ModelCapability.IMAGE_GENERATOR && !parsed.data.imageCapabilities) {
    throw new HttpError(400, "图片模型能力必须包含 imageCapabilities。", "IMAGE_CAPABILITIES_REQUIRED");
  }
  if (capability === ModelCapability.VIDEO_GENERATOR && !parsed.data.videoCapabilities) {
    throw new HttpError(400, "视频模型能力必须包含 videoCapabilities。", "VIDEO_CAPABILITIES_REQUIRED");
  }
  if (capability === ModelCapability.TEXT_GENERATOR && !parsed.data.textCapabilities) {
    throw new HttpError(400, "文本模型能力必须包含 textCapabilities。", "TEXT_CAPABILITIES_REQUIRED");
  }
  return parsed.data;
}

export type ImageCapabilities = z.infer<typeof imageCapabilitiesSchema>;
export type VideoCapabilities = z.infer<typeof videoCapabilitiesSchema>;
export type TextCapabilities = z.infer<typeof textCapabilitiesSchema>;
