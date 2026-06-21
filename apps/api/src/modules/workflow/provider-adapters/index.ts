export type ProviderAdapterPayloadInput = {
  model: string;
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  mode?: string;
  seed?: number;
  cfgScale?: number;
  steps?: number;
  quality?: string;
  outputFormat?: string;
  outputCompression?: number;
  background?: string;
  moderation?: string;
  stream?: boolean;
  partialImages?: number;
  generateAudio?: boolean;
};

export type RuntimeProviderRequest = {
  endpoint: string;
  payload: Record<string, any>;
  responsePaths: string[];
  taskIdPaths: string[];
  multipartFields?: VideoMultipartFields;
  poll?: {
    endpointTemplate: string;
    resultPaths: string[];
    statusPaths: string[];
    failedStatuses: string[];
  };
};

export type VideoMultipartFields = {
  referenceImages: string;
  firstFrame: string;
  lastFrame: string;
  sourceVideo: string;
  referenceVideo: string;
  audio: string;
};

const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "4:3": "1365x1024",
  "3:4": "1024x1365",
  "16:9": "1792x1024",
  "9:16": "1024x1792",
  "auto": "auto"
};

function withRuntimeModel(input: ProviderAdapterPayloadInput, runtime: Record<string, any>) {
  const modelOverride = typeof runtime?.modelOverride === "string" ? runtime.modelOverride.trim() : "";
  return modelOverride ? { ...input, model: modelOverride } : input;
}

const STANDARD_PAYLOAD_VALUES: Record<string, keyof ProviderAdapterPayloadInput> = {
  model: "model",
  prompt: "prompt",
  negativePrompt: "negativePrompt",
  negative_prompt: "negativePrompt",
  width: "width",
  height: "height",
  aspectRatio: "aspectRatio",
  aspect_ratio: "aspectRatio",
  resolution: "resolution",
  duration: "duration",
  mode: "mode",
  generation_mode: "mode",
  seed: "seed",
  cfgScale: "cfgScale",
  cfg_scale: "cfgScale",
  guidance_scale: "cfgScale",
  steps: "steps",
  quality: "quality",
  outputFormat: "outputFormat",
  output_format: "outputFormat",
  outputCompression: "outputCompression",
  output_compression: "outputCompression",
  background: "background",
  moderation: "moderation",
  stream: "stream",
  partialImages: "partialImages",
  partial_images: "partialImages",
  generateAudio: "generateAudio",
  generate_audio: "generateAudio"
};

function applyRuntimePayloadMapping(input: ProviderAdapterPayloadInput, payload: Record<string, any>, runtime: Record<string, any>) {
  const defaults = runtime?.payloadDefaults && typeof runtime.payloadDefaults === "object"
    ? runtime.payloadDefaults as Record<string, any>
    : {};
  const fields = runtime?.payloadFields && typeof runtime.payloadFields === "object"
    ? runtime.payloadFields as Record<string, string>
    : {};
  const mapped: Record<string, any> = { ...defaults };
  for (const [standardName, providerField] of Object.entries(fields)) {
    const providerFieldName = String(providerField);
    const inputKey = STANDARD_PAYLOAD_VALUES[standardName] || STANDARD_PAYLOAD_VALUES[providerFieldName] || (standardName as keyof ProviderAdapterPayloadInput);
    const value = (input as any)[inputKey];
    if (providerFieldName && value !== undefined && value !== null && value !== "") mapped[providerFieldName] = value;
  }
  return Object.keys(fields).length > 0 ? mapped : { ...defaults, ...payload };
}

function hasRuntimePayloadFields(runtime: Record<string, any>) {
  return Boolean(runtime?.payloadFields && typeof runtime.payloadFields === "object" && Object.keys(runtime.payloadFields).length > 0);
}

function normalizeGoogleImageSize(value?: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return undefined;
  if (normalized === "0.5K" || normalized === "512" || normalized === "512P") return "512";
  if (["1K", "2K", "4K"].includes(normalized)) return normalized;
  return undefined;
}

function normalizeGoogleImageModel(model: string) {
  return String(model || "")
    .replace(/-preview$/i, "")
    .trim();
}

const DEFAULT_IMAGE_RESPONSE_PATHS = [
  "data.0.url",
  "data.0.b64_json",
  "data.0.image_url",
  "url",
  "image_url",
  "image",
  "result.url",
  "result.image_url",
  "result.images.0.url",
  "output.0.url"
];

const DEFAULT_VIDEO_RESPONSE_PATHS = [
  "data.0.url",
  "data.0.video_url",
  "data.0.videoUrl",
  "url",
  "video_url",
  "videoUrl",
  "result.url",
  "result.video_url",
  "result.videoUrl",
  "result.videos.0.url",
  "output.0.url",
  "output.0"
];

const DEFAULT_TASK_ID_PATHS = ["id", "task_id", "taskId", "data.id", "data.task_id", "data.taskId"];
const DEFAULT_VIDEO_MULTIPART_FIELDS: VideoMultipartFields = {
  referenceImages: "image[]",
  firstFrame: "first_frame",
  lastFrame: "last_frame",
  sourceVideo: "video",
  referenceVideo: "reference_video",
  audio: "audio"
};

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

export function joinProviderEndpoint(baseUrl: string, endpoint: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  if (!endpoint) return base;
  return `${base}/${trimSlashes(endpoint)}`;
}

function getByPath(value: any, path: string) {
  if (!path) return undefined;
  return path.split(".").reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    return current[key];
  }, value);
}

export function pickFirstPathValue(value: any, paths: string[]) {
  for (const path of paths) {
    const found = getByPath(value, path);
    if (found !== undefined && found !== null && String(found).trim() !== "") return found;
  }
  return undefined;
}

export function buildOpenAiImagePayload(input: ProviderAdapterPayloadInput) {
  const explicitSize = input.resolution && /^\d{3,5}x\d{3,5}$/i.test(input.resolution)
    ? input.resolution
    : input.resolution === "auto"
      ? "auto"
      : undefined;
  const computedSize = input.width && input.height ? `${input.width}x${input.height}` : undefined;
  const payload: Record<string, any> = {
    model: input.model,
    n: 1,
    size: explicitSize || computedSize || (input.aspectRatio
      ? (ASPECT_RATIO_TO_SIZE[input.aspectRatio] ?? `${input.width || 1024}x${input.height || 1024}`)
      : `${input.width || 1024}x${input.height || 1024}`),
    prompt: input.prompt?.trim() || "Digital photo"
  };
  if (input.quality) payload.quality = input.quality;
  if (input.outputFormat) payload.output_format = input.outputFormat;
  if (input.outputCompression !== undefined) payload.output_compression = input.outputCompression;
  if (input.background) payload.background = input.background;
  if (input.moderation) payload.moderation = input.moderation;
  if (input.stream !== undefined) payload.stream = input.stream;
  if (input.partialImages !== undefined) payload.partial_images = input.partialImages;
  return payload;
}

export function buildGoogleGeminiImagePayload(input: ProviderAdapterPayloadInput) {
  const aspectRatio = input.aspectRatio || "1:1";
  const imageSize = normalizeGoogleImageSize(input.resolution);
  const model = normalizeGoogleImageModel(input.model);
  const payload: Record<string, any> = {
    model,
    prompt: input.prompt?.trim() || "Digital photo",
    aspect_ratio: aspectRatio
  };
  if (imageSize) {
    payload.image_size = imageSize;
    payload.resolution = imageSize;
    payload.response_format = { image: { aspect_ratio: aspectRatio, image_size: imageSize } };
  }
  return payload;
}

export function buildSeedanceVideoPayload(input: ProviderAdapterPayloadInput) {
  const payload: Record<string, any> = {
    model: input.model,
    prompt: input.prompt?.trim() || "Cinematic video",
    aspect_ratio: input.aspectRatio || "16:9",
    resolution: input.resolution || "1080P",
    duration: input.duration || 5,
    generation_mode: input.mode || "text_to_video"
  };
  if (input.generateAudio !== undefined) payload.generate_audio = input.generateAudio;
  return payload;
}

function normalizeOpenAiImageEndpoint(baseUrl: string, mode?: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const action = mode === "image_to_image" || mode === "image_edit" || mode === "edits" ? "edits" : "generations";
  if (base.includes("/images/")) return base;
  if (base.endsWith("/v1")) return `${base}/images/${action}`;
  if (base.includes("/v1/")) return `${base.split("/v1/")[0]}/v1/images/${action}`;
  return `${base}/v1/images/${action}`;
}

export function buildImageProviderRequest(input: ProviderAdapterPayloadInput & {
  baseUrl: string;
  capabilities?: any;
  mode?: string;
}): RuntimeProviderRequest {
  const adapter = input.capabilities?.providerAdapter || "openai-image";
  const runtime = input.capabilities?.runtime || {};
  const effectiveInput = withRuntimeModel(input, runtime);
  if (adapter === "google-gemini-image") {
    const payload = applyRuntimePayloadMapping(effectiveInput, buildGoogleGeminiImagePayload(effectiveInput), runtime);
    return {
      endpoint: joinProviderEndpoint(input.baseUrl, runtime.endpoint || "/v1/images/generations"),
      payload,
      responsePaths: runtime.responsePaths || DEFAULT_IMAGE_RESPONSE_PATHS,
      taskIdPaths: runtime.taskIdPaths || DEFAULT_TASK_ID_PATHS
    };
  }

  const payload = applyRuntimePayloadMapping(effectiveInput, buildOpenAiImagePayload(effectiveInput), runtime);
  return {
    endpoint: runtime.endpoint
      ? joinProviderEndpoint(input.baseUrl, runtime.endpoint)
      : normalizeOpenAiImageEndpoint(input.baseUrl, input.mode),
    payload,
    responsePaths: runtime.responsePaths || DEFAULT_IMAGE_RESPONSE_PATHS,
    taskIdPaths: runtime.taskIdPaths || DEFAULT_TASK_ID_PATHS
  };
}

export function buildVideoProviderRequest(input: ProviderAdapterPayloadInput & {
  baseUrl: string;
  capabilities?: any;
  mode?: string;
}): RuntimeProviderRequest {
  const runtime = input.capabilities?.runtime || {};
  const effectiveInput = withRuntimeModel(input, runtime);
  const payload = applyRuntimePayloadMapping(effectiveInput, buildSeedanceVideoPayload(effectiveInput), runtime);
  if (!hasRuntimePayloadFields(runtime)) {
    if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
    if (input.seed !== undefined && input.seed >= 0) payload.seed = input.seed;
    if (input.cfgScale !== undefined) payload.cfg_scale = input.cfgScale;
    if (input.steps !== undefined) payload.steps = input.steps;
  }

  return {
    endpoint: joinProviderEndpoint(input.baseUrl, runtime.endpoint || "/video/generations"),
    payload,
    responsePaths: runtime.responsePaths || DEFAULT_VIDEO_RESPONSE_PATHS,
    taskIdPaths: runtime.taskIdPaths || DEFAULT_TASK_ID_PATHS,
    multipartFields: { ...DEFAULT_VIDEO_MULTIPART_FIELDS, ...(runtime.multipartFields || {}) },
    poll: {
      endpointTemplate: runtime.pollEndpoint || "/video/status/{taskId}",
      resultPaths: runtime.pollResultPaths || DEFAULT_VIDEO_RESPONSE_PATHS,
      statusPaths: runtime.pollStatusPaths || ["status", "state", "data.status", "data.state"],
      failedStatuses: runtime.failedStatuses || ["failed", "error", "canceled", "cancelled"]
    }
  };
}
