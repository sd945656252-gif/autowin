import crypto from "crypto";
import fs from "fs/promises";
import type express from "express";
import type { GoogleGenAI } from "@google/genai";
import { ModelCapability, UserRole, WorkflowRunStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { safeAxiosGet, safeAxiosPost } from "../../security/safe-outbound";
import { HttpError } from "../../shared/http";
import { requireAuth, type RequestUser } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { canReadMediaAsset, resolveLocalUploadPath, saveGeneratedToLocalFile } from "../media/media.service";
import { resolveCustomApiRuntimeConfig } from "../custom-api-configs/custom-api-configs.service";
import { validateWorkflowCapabilityExecution } from "../model-capabilities/model-capabilities.service";
import { buildImageProviderRequest, buildVideoProviderRequest, joinProviderEndpoint, pickFirstPathValue } from "./provider-adapters";
import { createRequestContext, enqueueWorkflowExecution, startWorkflowExecutionWorker, type WorkflowExecutionJobData } from "./workflow-execute.queue";
import { setWorkflowTask, setWorkflowTaskRunLink } from "./workflow-task.store";
import { getWorkflowNodeDefinition, getWorkflowNodeRequiredCapability, listExecutableWorkflowNodeTypes, type WorkflowNodeDefinition, type WorkflowNodeModelCapability } from "../../../../shared/src/workflow/node-contracts";

type RegisterWorkflowExecuteRoutesOptions = {
  getAI: () => GoogleGenAI;
};

type WorkflowExecuteBody = {
  node_id?: string;
  node_type?: string;
  prompt?: string;
  use_custom_api?: boolean;
  custom_config_id?: string;
  selected_api_id?: string;
  custom_url?: string;
  custom_key?: string;
  custom_model?: string;
  aspect_ratio?: string;
  width?: number;
  height?: number;
  resolution?: string;
  video_resolution?: string;
  video_duration?: number;
  images?: string[];
  uploaded_images?: string[];
  image_generation_mode?: string;
  image_inputs?: {
    referenceImageAssetIds?: string[];
    sourceImageAssetId?: string;
    maskImageAssetId?: string;
    editInstruction?: string;
  };
  video_generation_mode?: string;
  video_media_list?: Array<{ type?: string; url?: string; [key: string]: any }>;
  video_inputs?: {
    firstFrameAssetId?: string;
    lastFrameAssetId?: string;
    referenceImageAssetIds?: string[];
    sourceVideoAssetId?: string;
    referenceVideoAssetId?: string;
    audioAssetId?: string;
    editInstruction?: string;
  };
  negative_prompt?: string;
  image_quality?: string;
  output_format?: string;
  output_compression?: number;
  image_background?: string;
  moderation?: string;
  partial_images?: number;
  seed?: number;
  cfg_scale?: number;
  steps?: number;
  generate_audio?: boolean;
  workflow_id?: string;
  workflow_version_id?: string;
};

type WorkflowRequestContext = WorkflowExecutionJobData["requestContext"];

const WORKFLOW_MEDIA_MAX_ITEMS = Number(process.env.WORKFLOW_MEDIA_MAX_ITEMS || 6);
const WORKFLOW_MEDIA_URL_MAX_LENGTH = Number(process.env.WORKFLOW_MEDIA_URL_MAX_LENGTH || 2048);
const IMAGE_GENERATION_TIMEOUT_MS = Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 180000);
const SENSITIVE_WORKFLOW_INPUT_KEYS = /(^|[_-])?(api[_-]?key|custom[_-]?key|authorization|bearer|token|secret|password|headers?)($|[_-])?/i;
const REDACTED_WORKFLOW_SECRET = "[REDACTED]";

function getExecutableWorkflowNodeDefinition(nodeType: unknown): WorkflowNodeDefinition {
  const definition = getWorkflowNodeDefinition(nodeType);
  if (!definition || definition.lifecycle !== "active" || definition.execution.status !== "active") {
    throw new HttpError(400, `Unsupported workflow node type: ${String(nodeType || "unknown")}`, "UNSUPPORTED_WORKFLOW_NODE_TYPE", {
      nodeType: nodeType || null,
      supportedTypes: listExecutableWorkflowNodeTypes()
    });
  }
  return definition;
}

function toPrismaModelCapability(capability: WorkflowNodeModelCapability | null): ModelCapability | undefined {
  if (!capability) return undefined;
  if (capability === "TEXT_GENERATOR") return ModelCapability.TEXT_GENERATOR;
  if (capability === "IMAGE_GENERATOR") return ModelCapability.IMAGE_GENERATOR;
  if (capability === "VIDEO_GENERATOR") return ModelCapability.VIDEO_GENERATOR;
  throw new HttpError(400, `Workflow node capability is not enabled in the current database schema: ${capability}`, "UNSUPPORTED_WORKFLOW_NODE_CAPABILITY", { capability });
}

function expectedCapabilityForDefinition(definition: WorkflowNodeDefinition): ModelCapability | undefined {
  return toPrismaModelCapability(getWorkflowNodeRequiredCapability(definition.type));
}

function isExpressRequest(value: express.Request | WorkflowRequestContext): value is express.Request {
  return typeof (value as express.Request).get === "function";
}

async function resolveMediaAssets(user: RequestUser, assetIds: string[]) {
  const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: uniqueIds } } });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return uniqueIds.map((assetId) => {
    const asset = byId.get(assetId);
    if (!asset || !canReadMediaAsset(user, asset)) throw new HttpError(404, "输入素材不存在或无权访问。", "MEDIA_ASSET_NOT_ACCESSIBLE", { assetId });
    return { asset };
  });
}

function resolveMediaAssetPath(asset: { storageKey?: string | null; url?: string | null }) {
  const storageKey = asset.storageKey || (asset.url?.startsWith("/uploads/") ? asset.url.slice("/uploads/".length) : null);
  if (!storageKey) throw new HttpError(400, "输入素材缺少本地存储引用。", "MEDIA_ASSET_STORAGE_KEY_REQUIRED");
  return resolveLocalUploadPath(storageKey);
}

async function mediaAssetToFormFile(asset: { storageKey?: string | null; url?: string | null; mimeType?: string | null; originalName?: string | null; title?: string | null }) {
  const filePath = resolveMediaAssetPath(asset);
  const bytes = await fs.readFile(filePath);
  const mimeType = asset.mimeType || "image/png";
  const name = asset.originalName || asset.title || "image.png";
  return new File([bytes], name, { type: mimeType });
}

function setFormValue(form: FormData, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  form.set(key, String(value));
}

function appendPayloadToForm(form: FormData, payload: Record<string, any>) {
  for (const [key, value] of Object.entries(payload)) {
    setFormValue(form, key, value);
  }
}

function assertWorkflowMediaReferences(body: WorkflowExecuteBody) {
  const imageRefs = [...(body.images || []), ...(body.uploaded_images || [])];
  const videoRefs = body.video_media_list || [];
  if (imageRefs.length > WORKFLOW_MEDIA_MAX_ITEMS) throw new HttpError(400, `Too many image references. Limit is ${WORKFLOW_MEDIA_MAX_ITEMS}.`);
  if (videoRefs.length > WORKFLOW_MEDIA_MAX_ITEMS) throw new HttpError(400, `Too many video media references. Limit is ${WORKFLOW_MEDIA_MAX_ITEMS}.`);

  for (const value of imageRefs) {
    if (typeof value !== "string" || value.length > WORKFLOW_MEDIA_URL_MAX_LENGTH) {
      throw new HttpError(400, "Invalid image reference.");
    }
    if (value.startsWith("data:")) throw new HttpError(400, "Inline base64 media is not allowed in workflow execution. Upload the file first.");
  }

  for (const item of videoRefs) {
    const url = item?.url;
    if (typeof url !== "string" || url.length > WORKFLOW_MEDIA_URL_MAX_LENGTH) {
      throw new HttpError(400, "Invalid video media reference.");
    }
    if (url.startsWith("data:")) throw new HttpError(400, "Inline base64 media is not allowed in workflow execution. Upload the file first.");
  }
}

function workflowMediaOwner(ownerId: string): RequestUser {
  return { id: ownerId, role: UserRole.USER, isGuest: false };
}

function toOpenAiBaseUrl(customUrl?: string) {
  let base = (customUrl || "https://api.openai.com/v1").trim();
  if (!base.startsWith("http")) base = `https://${base}`;
  base = base.replace(/\/+$/, "");

  if (base.endsWith("/v1")) return base;
  if (base.includes("/v1/")) return `${base.split("/v1/")[0]}/v1`;
  if (!base.includes("/v1")) return `${base}/v1`;
  return base;
}

function toProviderBaseUrl(customUrl?: string) {
  let base = (customUrl || "").trim();
  if (!base) return "";
  if (!base.startsWith("http")) base = `https://${base}`;
  return base.replace(/\/+$/, "");
}

function getWorkflowErrorMessage(error: any) {
  let errorMsg = error?.message || "Workflow execution failed";
  if (error?.response?.status === 413) {
    errorMsg = "Request entity too large (413). Reduce attachment count or image resolution and retry.";
  } else if (error?.response?.status === 504) {
    errorMsg = "API provider timed out (504). Check endpoint availability or model load.";
  } else if (error?.code === "ECONNABORTED" || error?.code === "ERR_CANCELED" || error?.name === "AbortError" || error?.cause?.name === "AbortError") {
    errorMsg = `Image API timed out after ${Math.round(IMAGE_GENERATION_TIMEOUT_MS / 1000)} seconds.`;
  } else if (errorMsg === "fetch failed") {
    errorMsg = `Network request failed: ${error.cause ? error.cause.message || error.cause.code || error.cause : "unknown network error"}`;
  } else if (errorMsg.includes("read tcp") || error?.cause?.message?.includes("read tcp")) {
    errorMsg = `Network connection interrupted: ${errorMsg}`;
  }
  return errorMsg;
}

function summarizeWorkflowError(error: any) {
  return {
    name: error?.name || null,
    message: getWorkflowErrorMessage(error),
    code: error?.code || null,
    status: error?.response?.status || null,
    url: error?.config?.url || error?.request?._currentUrl || null
  };
}

function redactWorkflowInput(value: any): any {
  if (Array.isArray(value)) return value.map((item) => redactWorkflowInput(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => {
    if (SENSITIVE_WORKFLOW_INPUT_KEYS.test(key)) {
      return [key, nestedValue ? REDACTED_WORKFLOW_SECRET : nestedValue];
    }
    return [key, redactWorkflowInput(nestedValue)];
  }));
}

async function executeCustomImageNode(_req: express.Request | WorkflowRequestContext, taskId: string, ownerId: string, body: WorkflowExecuteBody, runtime: { customUrl?: string; customKey?: string; customModel?: string }, requestUser: RequestUser, capabilityValidation?: Awaited<ReturnType<typeof validateWorkflowCapabilityExecution>> | null) {
  if (!runtime.customKey) throw new Error("API key is not configured.");
  if (!runtime.customModel?.trim()) throw new Error("Custom model name is required.");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_GENERATION_TIMEOUT_MS);

  try {
    const imageInputs = body.image_inputs || {};
    const inputAssetIds = [
      ...(imageInputs.referenceImageAssetIds || []),
      ...(imageInputs.sourceImageAssetId ? [imageInputs.sourceImageAssetId] : []),
      ...(imageInputs.maskImageAssetId ? [imageInputs.maskImageAssetId] : [])
    ];
    const resolvedAssetUrls = await resolveMediaAssets(requestUser, inputAssetIds.map(String));
    let processedPrompt = body.prompt || "";
    let processedNegativePrompt = body.negative_prompt || "";

    resolvedAssetUrls.forEach((_item, index) => {
      const tag = `@image${index + 1}`;
      if (processedPrompt.includes(tag)) {
        processedPrompt = processedPrompt.replaceAll(tag, `[attached image ${index + 1}]`);
      }
      if (processedNegativePrompt.includes(tag)) {
        processedNegativePrompt = processedNegativePrompt.replaceAll(tag, `[attached image ${index + 1}]`);
      }
    });

    const sourceAsset = imageInputs.sourceImageAssetId
      ? resolvedAssetUrls.find((item) => item.asset.id === imageInputs.sourceImageAssetId)?.asset
      : null;
    const maskAsset = imageInputs.maskImageAssetId
      ? resolvedAssetUrls.find((item) => item.asset.id === imageInputs.maskImageAssetId)?.asset
      : null;
    const referenceAssets = (imageInputs.referenceImageAssetIds || [])
      .map((id) => resolvedAssetUrls.find((item) => item.asset.id === id)?.asset)
      .filter(Boolean) as any[];
    const editAssets = sourceAsset ? [sourceAsset, ...referenceAssets] : referenceAssets;
    const isImageToImage = editAssets.length > 0;
    const hasPrompt = processedPrompt.trim().length > 0 && processedPrompt !== "Digital photo";
    const modelName = runtime.customModel.trim();
    const isDallE3 = modelName.toLowerCase().includes("dall-e-3");
    let endpointAction = "generations";
    if (isImageToImage && !isDallE3) endpointAction = "edits";

    const imageCapabilities = capabilityValidation?.params?.imageCapabilities;
    const base = imageCapabilities?.providerAdapter === "openai-image"
      ? toOpenAiBaseUrl(runtime.customUrl)
      : toProviderBaseUrl(runtime.customUrl || "https://api.openai.com/v1");
    const providerRequest = buildImageProviderRequest({
      baseUrl: base,
      model: modelName,
      prompt: hasPrompt ? processedPrompt : "Digital photo",
      width: body.width,
      height: body.height,
      aspectRatio: body.aspect_ratio,
      resolution: body.resolution,
      quality: body.image_quality,
      outputFormat: body.output_format,
      outputCompression: body.output_compression,
      background: body.image_background,
      moderation: body.moderation,
      partialImages: body.partial_images,
      mode: capabilityValidation?.mode || endpointAction,
      capabilities: imageCapabilities
    });
    const apiPayload: any = providerRequest.payload;
    const usesPayloadMapping = Boolean(
      imageCapabilities?.runtime?.payloadFields
      && typeof imageCapabilities.runtime.payloadFields === "object"
      && Object.keys(imageCapabilities.runtime.payloadFields).length > 0
    );

    if (!usesPayloadMapping) {
      if (hasPrompt) apiPayload.prompt = processedPrompt;
      else if (endpointAction === "generations") apiPayload.prompt = "Digital photo";
      if (processedNegativePrompt) apiPayload.negative_prompt = processedNegativePrompt;
      if (body.seed !== undefined) apiPayload.seed = body.seed;
      if (body.cfg_scale !== undefined) apiPayload.guidance_scale = body.cfg_scale;
      if (body.steps !== undefined) apiPayload.num_inference_steps = body.steps;
    }

    await setWorkflowTask(taskId, { ownerId, progress: 12, status: "Sending request to image API", completed: false });

    let response;
    if (endpointAction === "edits" && editAssets.length > 0) {
      const form = new FormData();
      form.set("model", apiPayload.model || modelName);
      form.set("prompt", apiPayload.prompt);
      form.set("size", apiPayload.size);
      if (apiPayload.quality) form.set("quality", apiPayload.quality);
      if (apiPayload.output_format) form.set("output_format", apiPayload.output_format);
      if (apiPayload.output_compression !== undefined) form.set("output_compression", String(apiPayload.output_compression));
      if (apiPayload.background) form.set("background", apiPayload.background);
      if (apiPayload.moderation) form.set("moderation", apiPayload.moderation);
      for (const asset of editAssets) form.append("image[]", await mediaAssetToFormFile(asset));
      if (maskAsset) form.set("mask", await mediaAssetToFormFile(maskAsset));
      response = await safeAxiosPost(providerRequest.endpoint, form, {
        label: "custom image API URL",
        headers: {
          Authorization: `Bearer ${runtime.customKey.trim()}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "application/json"
        },
        signal: controller.signal,
        timeout: IMAGE_GENERATION_TIMEOUT_MS,
        validateStatus: null
      });
    } else {
      response = await safeAxiosPost(providerRequest.endpoint, apiPayload, {
        label: "custom image API URL",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${runtime.customKey.trim()}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "application/json"
        },
        signal: controller.signal,
        timeout: IMAGE_GENERATION_TIMEOUT_MS,
        validateStatus: null
      });
    }

    if (response.status >= 400) {
      const errorText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      let friendlyMessage = `Image API error: ${response.status}`;
      if (errorText.includes("model not found") || errorText.includes("model_not_found")) {
        friendlyMessage = `Image model not found. Check custom image API model: "${modelName}"`;
      } else if (response.status === 524 || response.status === 522) {
        friendlyMessage = `Image API gateway timeout (${response.status}). The provider accepted the request but did not return a result in time. Check provider capacity, model availability, or retry with a smaller prompt/input.`;
      } else if (response.status === 503) {
        friendlyMessage = "Image service busy (503). Check provider capacity.";
      } else if (errorText.includes("read tcp") || errorText.includes("connection reset")) {
        friendlyMessage = "Image API proxy network error.";
      }
      console.warn("[WorkflowExecute] Custom image provider failed", { status: response.status, bodyPreviewLength: errorText.length });
      throw new Error(friendlyMessage);
    }

    await setWorkflowTask(taskId, { ownerId, progress: 99, status: "Finalizing image result", completed: false });
    const data: any = response.data;
    let media = pickFirstPathValue(data, providerRequest.responsePaths);
    if (media && !media.startsWith("http") && !media.startsWith("data:")) media = `data:image/png;base64,${media}`;
    const localMediaUrl = await saveGeneratedToLocalFile(media, workflowMediaOwner(ownerId));
    await setWorkflowTask(taskId, { ownerId, progress: 100, status: "Generation completed", media_data: localMediaUrl, completed: true });
    return localMediaUrl;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function executeOfficialImageNode(taskId: string, ownerId: string, body: WorkflowExecuteBody, getAI: () => GoogleGenAI) {
  const inputImages = body.images || body.uploaded_images || [];
  if (inputImages.length > 0) {
    throw new Error("Official Imagen currently supports text-to-image only. Enable a custom image API for image-to-image workflows.");
  }

  await setWorkflowTask(taskId, { ownerId, progress: 20, status: "Starting official image generation", completed: false });
  const ai = getAI();
  const response = await ai.models.generateImages({
    model: "imagen-4.0-generate-001",
    prompt: body.prompt || "Cinematic photo",
    config: {
      numberOfImages: 1,
      aspectRatio: body.aspect_ratio || "1:1",
      outputMimeType: "image/png"
    }
  });

  const base64 = response?.generatedImages?.[0]?.image?.imageBytes;
  if (!base64) {
    throw new Error("Official Imagen did not return image data.");
  }

  const localMediaUrl = await saveGeneratedToLocalFile(`data:image/png;base64,${base64}`, workflowMediaOwner(ownerId));
  await setWorkflowTask(taskId, { ownerId, progress: 100, status: "Generation completed", media_data: localMediaUrl, completed: true });
  return localMediaUrl;
}

async function executeCustomVideoNode(_req: express.Request | WorkflowRequestContext, taskId: string, ownerId: string, body: WorkflowExecuteBody, runtime: { customUrl?: string; customKey?: string; customModel?: string }, requestUser: RequestUser, capabilityValidation?: Awaited<ReturnType<typeof validateWorkflowCapabilityExecution>> | null) {
  if (!runtime.customKey) throw new Error("API key is not configured.");
  if (!runtime.customModel?.trim()) throw new Error("Custom model name is required.");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000);

  try {
    const baseUrl = toProviderBaseUrl(runtime.customUrl || "https://api.openai.com/v1");
    const videoInputs = body.video_inputs || {};
    const imageAssetIds = [
      ...(videoInputs.referenceImageAssetIds || []),
      ...(videoInputs.firstFrameAssetId ? [videoInputs.firstFrameAssetId] : []),
      ...(videoInputs.lastFrameAssetId ? [videoInputs.lastFrameAssetId] : [])
    ].map(String);
    const videoAssetIds = [videoInputs.sourceVideoAssetId, videoInputs.referenceVideoAssetId].filter(Boolean).map(String);
    const audioAssetIds = [videoInputs.audioAssetId].filter(Boolean).map(String);
    const [resolvedImageAssets, resolvedVideoAssets, resolvedAudioAssets] = await Promise.all([
      imageAssetIds.length > 0 ? resolveMediaAssets(requestUser, imageAssetIds) : Promise.resolve([]),
      videoAssetIds.length > 0 ? resolveMediaAssets(requestUser, videoAssetIds) : Promise.resolve([]),
      audioAssetIds.length > 0 ? resolveMediaAssets(requestUser, audioAssetIds) : Promise.resolve([])
    ]);
    const mediaById = new Map(
      [...resolvedImageAssets, ...resolvedVideoAssets, ...resolvedAudioAssets].map((item) => [item.asset.id, item.asset])
    );
    const processedPrompt = body.prompt || "";

    const providerRequest = buildVideoProviderRequest({
      baseUrl,
      model: runtime.customModel.trim(),
      prompt: processedPrompt,
      negativePrompt: body.negative_prompt,
      aspectRatio: body.aspect_ratio,
      resolution: body.video_resolution,
      duration: body.video_duration,
      mode: capabilityValidation?.mode || body.video_generation_mode || "text_to_video",
      generateAudio: body.generate_audio,
      seed: body.seed,
      cfgScale: body.cfg_scale,
      steps: body.steps,
      capabilities: capabilityValidation?.params?.videoCapabilities
    });
    const apiPayload: any = providerRequest.payload;

    const resolvedMode = body.video_generation_mode === "all_in_one_reference" ? "reference_to_video" : body.video_generation_mode;
    const hasInternalMedia = imageAssetIds.length > 0 || videoAssetIds.length > 0 || audioAssetIds.length > 0;

    let response;
    if (hasInternalMedia) {
      const form = new FormData();
      appendPayloadToForm(form, { ...apiPayload, generation_mode: resolvedMode || apiPayload.generation_mode });
      const multipartFields = providerRequest.multipartFields!;

      for (const assetId of videoInputs.referenceImageAssetIds || []) {
        const asset = mediaById.get(String(assetId));
        if (asset) form.append(multipartFields.referenceImages, await mediaAssetToFormFile(asset));
      }
      const firstFrame = videoInputs.firstFrameAssetId ? mediaById.get(String(videoInputs.firstFrameAssetId)) : null;
      const lastFrame = videoInputs.lastFrameAssetId ? mediaById.get(String(videoInputs.lastFrameAssetId)) : null;
      const sourceVideo = videoInputs.sourceVideoAssetId ? mediaById.get(String(videoInputs.sourceVideoAssetId)) : null;
      const referenceVideo = videoInputs.referenceVideoAssetId ? mediaById.get(String(videoInputs.referenceVideoAssetId)) : null;
      const audio = videoInputs.audioAssetId ? mediaById.get(String(videoInputs.audioAssetId)) : null;
      if (firstFrame) form.set(multipartFields.firstFrame, await mediaAssetToFormFile(firstFrame));
      if (lastFrame) form.set(multipartFields.lastFrame, await mediaAssetToFormFile(lastFrame));
      if (sourceVideo) form.set(multipartFields.sourceVideo, await mediaAssetToFormFile(sourceVideo));
      if (referenceVideo) form.set(multipartFields.referenceVideo, await mediaAssetToFormFile(referenceVideo));
      if (audio) form.set(multipartFields.audio, await mediaAssetToFormFile(audio));

      response = await safeAxiosPost(providerRequest.endpoint, form, {
        label: "custom video API URL",
        headers: {
          Authorization: `Bearer ${runtime.customKey.trim()}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "application/json"
        },
        signal: controller.signal,
        timeout: 600000,
        validateStatus: null
      });
    } else {
      response = await safeAxiosPost(providerRequest.endpoint, apiPayload, {
        label: "custom video API URL",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${runtime.customKey.trim()}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "application/json"
        },
        signal: controller.signal,
        timeout: 600000,
        validateStatus: null
      });
    }

    if (response.status >= 400) {
      const errorText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      let friendlyMessage = `Video API error: ${response.status}`;
      if (errorText.includes("model not found") || errorText.includes("model_not_found")) {
        friendlyMessage = `Video model not found. Check custom video API model: "${runtime.customModel}"`;
      } else if (response.status === 524 || response.status === 522) {
        friendlyMessage = `Video API gateway timeout (${response.status}). The provider accepted the request but did not return a result in time. Check provider capacity, model availability, or retry with lighter inputs.`;
      } else if (response.status === 503) {
        friendlyMessage = "Video service busy (503). Check provider capacity.";
      } else if (errorText.includes("read tcp") || errorText.includes("connection reset")) {
        friendlyMessage = "Video API proxy network error.";
      }
      console.warn("[WorkflowExecute] Custom video provider failed", { status: response.status, bodyPreviewLength: errorText.length });
      throw new Error(friendlyMessage);
    }

    await setWorkflowTask(taskId, { ownerId, progress: 25, status: "Video generation started", completed: false });
    const data: any = response.data;
    const media = pickFirstPathValue(data, providerRequest.responsePaths);
    const taskIdValue = pickFirstPathValue(data, providerRequest.taskIdPaths);
    if (!media && !taskIdValue) {
      throw new Error("Video API did not return media or a polling task id.");
    }

    if (!media && taskIdValue) {
      const jobId = String(taskIdValue);
      for (let pollCount = 1; pollCount <= 120; pollCount++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const pollEndpoint = joinProviderEndpoint(baseUrl, (providerRequest.poll?.endpointTemplate || "/video/status/{taskId}").replace("{taskId}", encodeURIComponent(jobId)));
        const pollResp = await safeAxiosGet(pollEndpoint, {
          label: "custom video status URL",
          headers: { Authorization: `Bearer ${runtime.customKey.trim()}` },
          validateStatus: null,
          timeout: 10000
        });

        if (pollResp.status >= 400) continue;

        const pollData = pollResp.data;
        const progress = pollData.progress !== undefined ? pollData.progress : pollData.percent !== undefined ? pollData.percent : null;
        const resultUrl = pickFirstPathValue(pollData, providerRequest.poll?.resultPaths || providerRequest.responsePaths);

        if (resultUrl) {
          const localResultUrl = await saveGeneratedToLocalFile(resultUrl, workflowMediaOwner(ownerId));
          await setWorkflowTask(taskId, { ownerId, progress: 100, status: "Video generation completed", media_data: localResultUrl, completed: true });
          return localResultUrl;
        }

        const statusValue = String(pickFirstPathValue(pollData, providerRequest.poll?.statusPaths || ["status"]) || "").toLowerCase();
        if ((providerRequest.poll?.failedStatuses || ["failed", "error"]).includes(statusValue)) {
          console.warn("[WorkflowExecute] Custom video polling failed", { jobId, status: statusValue });
          throw new Error("Video rendering failed");
        }

        if (progress !== null) {
          const boundedProgress = Math.max(0, Math.min(99, Number(progress)));
          await setWorkflowTask(taskId, { ownerId, progress: boundedProgress, status: `Processing video (${boundedProgress}%)`, completed: false });
        } else {
          await setWorkflowTask(taskId, { ownerId, progress: 25, status: "Processing video", completed: false });
        }
      }
      throw new Error("Video rendering timed out");
    }

    const localMediaUrl = await saveGeneratedToLocalFile(media, workflowMediaOwner(ownerId));
    await setWorkflowTask(taskId, { ownerId, progress: 100, status: "Generation completed", media_data: localMediaUrl, completed: true });
    return localMediaUrl;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function markRunStatus(runId: string | undefined, status: WorkflowRunStatus, data: { outputJson?: any; error?: string } = {}) {
  if (!runId) return;
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status,
      ...(status === WorkflowRunStatus.RUNNING ? { startedAt: new Date() } : {}),
      ...(status === WorkflowRunStatus.SUCCEEDED || status === WorkflowRunStatus.FAILED || status === WorkflowRunStatus.CANCELED ? { finishedAt: new Date() } : {}),
      ...(data.outputJson !== undefined ? { outputJson: data.outputJson } : {}),
      ...(data.error ? { error: data.error } : {})
    }
  }).catch((error) => console.warn("[WorkflowRun] Failed to update run status:", error));
}

async function executeWorkflowInBackground(req: express.Request | WorkflowRequestContext, taskId: string, body: WorkflowExecuteBody, options: RegisterWorkflowExecuteRoutesOptions, runId?: string) {
  await markRunStatus(runId, WorkflowRunStatus.RUNNING);
  let requestUser: RequestUser;
  if (isExpressRequest(req)) {
    requestUser = await requireAuth(req);
  } else {
    const userId = req.userId || "unknown";
    const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true } });
    if (!dbUser || dbUser.status !== "ACTIVE") {
      await markRunStatus(runId, WorkflowRunStatus.FAILED, { error: "User account is inactive or deleted." });
      return;
    }
    requestUser = { id: dbUser.id, role: dbUser.role as UserRole, isGuest: false };
  }
  const ownerId = requestUser.id;
  try {
    const nodeDefinition = getExecutableWorkflowNodeDefinition(body.node_type);
    const expectedCapability = expectedCapabilityForDefinition(nodeDefinition);
    let capabilityValidation: Awaited<ReturnType<typeof validateWorkflowCapabilityExecution>> | null = null;
    if (body.use_custom_api && expectedCapability) {
      capabilityValidation = await validateWorkflowCapabilityExecution({
        configId: body.custom_config_id || body.selected_api_id,
        expectedCapability,
        body,
        user: requestUser
      });
      if (expectedCapability === ModelCapability.IMAGE_GENERATOR) body.image_generation_mode = capabilityValidation.mode;
      if (expectedCapability === ModelCapability.VIDEO_GENERATOR) body.video_generation_mode = capabilityValidation.mode;
    }

    const runtime = await resolveCustomApiRuntimeConfig({
      useCustomApi: !!body.use_custom_api,
      customConfigId: body.custom_config_id || body.selected_api_id,
      customUrl: body.custom_url,
      customKey: body.custom_key,
      customModel: body.custom_model,
      expectedCapability,
      ownerId,
      role: requestUser.role,
      audit: { actor: requestUser, req: isExpressRequest(req) ? req : undefined, source: "workflow-execute" }
    });

    if (nodeDefinition.type === "image_generator") {
      const mediaData = body.use_custom_api
        ? await executeCustomImageNode(req, taskId, ownerId, body, runtime, requestUser, capabilityValidation)
        : await executeOfficialImageNode(taskId, ownerId, body, options.getAI);
      await markRunStatus(runId, WorkflowRunStatus.SUCCEEDED, { outputJson: { taskId, mediaData, mode: capabilityValidation?.mode || null, canonicalModelId: capabilityValidation?.profile?.canonicalModelId || null } });
      return;
    }

    if (nodeDefinition.type === "video_generator") {
      if (!body.use_custom_api) {
        throw new Error("Video generation requires a configured video provider in Model Center.");
      }
      const mediaData = await executeCustomVideoNode(req, taskId, ownerId, body, runtime, requestUser, capabilityValidation);
      await markRunStatus(runId, WorkflowRunStatus.SUCCEEDED, { outputJson: { taskId, mediaData, mode: capabilityValidation?.mode || null, canonicalModelId: capabilityValidation?.profile?.canonicalModelId || null } });
      return;
    }

    throw new Error(`Executable workflow node is not wired yet: ${nodeDefinition.type}`);
  } catch (error: any) {
    console.error("Workflow background execute failed:", summarizeWorkflowError(error));
    await setWorkflowTask(taskId, {
      ownerId,
      progress: 100,
      status: "Execution failed",
      error: getWorkflowErrorMessage(error),
      completed: true
    });
    await markRunStatus(runId, WorkflowRunStatus.FAILED, { error: getWorkflowErrorMessage(error) });
  }
}

async function resolveExecutableWorkflowReferences(body: WorkflowExecuteBody, requestUser: RequestUser) {
  const workflowId = body.workflow_id || null;
  const versionId = body.workflow_version_id || null;
  if (!workflowId && !versionId) return { workflowId: null, versionId: null };

  let workflow = workflowId
    ? await prisma.workflow.findFirst({
        where: { id: workflowId, ownerId: requestUser.id },
        select: { id: true }
      })
    : null;
  if (workflowId && !workflow) {
    throw new HttpError(404, "Workflow not found.");
  }

  if (versionId) {
    const version = await prisma.workflowVersion.findUnique({
      where: { id: versionId },
      select: { id: true, workflowId: true, workflow: { select: { ownerId: true } } }
    });
    if (!version || version.workflow.ownerId !== requestUser.id) {
      throw new HttpError(404, "Workflow version not found.");
    }
    if (workflowId && version.workflowId !== workflowId) {
      throw new HttpError(400, "Workflow version does not belong to the selected workflow.", "WORKFLOW_VERSION_MISMATCH");
    }
    return { workflowId: version.workflowId, versionId: version.id };
  }

  return { workflowId: workflow?.id || null, versionId: null };
}

async function createWorkflowRun(body: WorkflowExecuteBody, requestUser: RequestUser) {
  const refs = await resolveExecutableWorkflowReferences(body, requestUser);
  return prisma.workflowRun.create({
    data: {
      ownerId: requestUser.id,
      workflowId: refs.workflowId,
      versionId: refs.versionId,
      status: WorkflowRunStatus.QUEUED,
      inputJson: redactWorkflowInput(body)
    }
  });
}

export function registerWorkflowExecutionWorker(options: RegisterWorkflowExecuteRoutesOptions) {
  startWorkflowExecutionWorker(async (job) => {
    const { taskId, body, requestContext, runId } = job.data;
    await executeWorkflowInBackground(requestContext, taskId, body as WorkflowExecuteBody, options, runId);
  }, options);
}

export function registerWorkflowExecuteRoutes(app: express.Express, options: RegisterWorkflowExecuteRoutesOptions) {
  app.post("/api/workflow/execute", async (req, res) => {
    try {
      const body = req.body as WorkflowExecuteBody;
      const requestUser = await requireAuth(req);
      const nodeDefinition = getExecutableWorkflowNodeDefinition(body.node_type);
      assertWorkflowMediaReferences(body);
      if (body.use_custom_api && body.custom_key && process.env.ALLOW_INLINE_CUSTOM_API_KEYS !== "true") {
        res.status(400).json({
          success: false,
          error: "Inline custom API keys are disabled. Save the provider in API settings or config/api-providers.local.json."
        });
        return;
      }
      const expectedCapability = expectedCapabilityForDefinition(nodeDefinition);
      if (body.use_custom_api && expectedCapability) {
        const validation = await validateWorkflowCapabilityExecution({
          configId: body.custom_config_id || body.selected_api_id,
          expectedCapability,
          body,
          user: requestUser
        });
        if (expectedCapability === ModelCapability.IMAGE_GENERATOR) body.image_generation_mode = validation.mode;
        if (expectedCapability === ModelCapability.VIDEO_GENERATOR) body.video_generation_mode = validation.mode;
      }
      const taskId = crypto.randomUUID();
      const run = await createWorkflowRun(body, requestUser);

      await setWorkflowTaskRunLink(taskId, { ownerId: requestUser.id, runId: run.id });
      await setWorkflowTask(taskId, { ownerId: requestUser.id, runId: run.id, progress: 0, status: "Workflow queued", completed: false });
      const queued = await enqueueWorkflowExecution({
        taskId,
        runId: run.id,
        body,
        requestContext: createRequestContext(req, requestUser.id, requestUser.role)
      });

      if (!queued) {
        void executeWorkflowInBackground(req, taskId, body, options, run.id);
      }

      await writeAuditLog({
        actor: requestUser,
        action: "EXECUTE",
        entityType: "WorkflowRun",
        entityId: run.id,
        afterJson: {
          taskId,
          queued: Boolean(queued),
          nodeType: body.node_type,
          workflowId: body.workflow_id || null,
          workflowVersionId: body.workflow_version_id || null
        }
      });

      res.json({ success: true, task_id: taskId, run_id: run.id, queued: Boolean(queued) });
    } catch (error: any) {
      const requestUser = await requireAuth(req).catch(() => null);
      if (requestUser) {
        await writeAuditLog({
          actor: requestUser,
          action: "ACCESS",
          entityType: "WorkflowExecuteValidation",
          req,
          metadata: {
            decision: "denied",
            code: error?.code || null,
            nodeType: req.body?.node_type || null,
            customConfigId: req.body?.custom_config_id || req.body?.selected_api_id || null,
            hasInlineKey: Boolean(req.body?.custom_key)
          }
        });
      }
      res.status(error?.status || 500).json({
        success: false,
        error: error?.status ? error.message : "Workflow execution failed.",
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.details !== undefined ? { details: error.details } : {})
      });
    }
  });
}

export { executeWorkflowInBackground };
