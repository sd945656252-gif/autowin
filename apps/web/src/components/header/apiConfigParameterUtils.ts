import type { CustomApiConfig } from '../../types';

export type ProbeStatus = 'idle' | 'probing' | 'success' | 'failed';

export type ModelMetadata = NonNullable<CustomApiConfig['metadata']> & {
  maxImages?: number;
  minDuration?: number;
  maxDuration?: number;
  defaultDuration?: number;
  hasAudio?: boolean;
  hasCameraControl?: boolean;
};

export type RegistryEntry = {
  canonicalModelId: string;
  officialModelId: string;
  provider: string;
  capability: 'TEXT_GENERATOR' | 'IMAGE_GENERATOR' | 'VIDEO_GENERATOR';
  aliases: string[];
  params: any;
  sourceUrls: string[];
};

export type RuntimeEditorState = {
  modelOverride: string;
  endpoint: string;
  streamEndpoint: string;
  responsePaths: string;
  streamChunkPaths: string;
  taskIdPaths: string;
  pollEndpoint: string;
  pollResultPaths: string;
  pollStatusPaths: string;
  failedStatuses: string;
};

export function capabilityToType(capability: RegistryEntry['capability']): CustomApiConfig['type'] {
  if (capability === 'IMAGE_GENERATOR') return 'image';
  if (capability === 'VIDEO_GENERATOR') return 'video';
  return 'text';
}

export function metadataFromRegistryEntry(entry: RegistryEntry): CustomApiConfig['metadata'] {
  const image = entry.params?.imageCapabilities;
  if (entry.capability === 'IMAGE_GENERATOR' && image) {
    return {
      ratios: Array.isArray(image.controls?.aspectRatio) ? image.controls.aspectRatio : [],
      resolutions: Array.isArray(image.controls?.size) ? image.controls.size : [],
      qualities: Array.isArray(image.controls?.quality) ? image.controls.quality : [],
      description: `${entry.officialModelId || 'Image model'} trusted image capability parameters`
    };
  }
  const video = entry.params?.videoCapabilities;
  if (entry.capability === 'VIDEO_GENERATOR' && video) {
    const durations = Array.isArray(video.controls?.duration) ? video.controls.duration.map(Number).filter(Number.isFinite) : [];
    return {
      ratios: Array.isArray(video.controls?.aspectRatio) ? video.controls.aspectRatio : [],
      resolutions: Array.isArray(video.controls?.resolution) ? video.controls.resolution : [],
      minDuration: durations.length ? Math.min(...durations) : undefined,
      maxDuration: durations.length ? Math.max(...durations) : undefined,
      defaultDuration: durations[0],
      hasAudio: Boolean(video.controls?.generateAudio),
      hasCameraControl: Boolean(video.controls?.cameraControl),
      description: `${entry.officialModelId || 'Video model'} trusted video capability parameters`
    } as CustomApiConfig['metadata'];
  }
  return undefined;
}

export function capabilityProfileToEditableJson(profile: CustomApiConfig['capabilityProfile'], fallback: CustomApiConfig) {
  if (!profile) return null;
  return {
    canonicalModelId: profile.canonicalModelId,
    officialModelId: profile.officialModelId || fallback.modelName,
    provider: profile.provider || fallback.provider || 'Custom',
    capability: profile.capability || fallback.capability,
    aliases: profile.aliases || [],
    params: profile.activeRevision?.params || {
      ...(profile.imageCapabilities ? { imageCapabilities: profile.imageCapabilities } : {}),
      ...(profile.videoCapabilities ? { videoCapabilities: profile.videoCapabilities } : {}),
      ...(profile.textCapabilities ? { textCapabilities: profile.textCapabilities } : {})
    },
    sourceUrls: profile.sourceUrls || [],
    verificationStatus: profile.verificationStatus,
    activeRevisionId: profile.activeRevisionId,
    changedSummary: profile.activeRevision?.changedSummary || ''
  };
}

export function formatSaveError(error: any) {
  const details = error?.details;
  if (!details || typeof details !== 'object') return error?.message || 'JSON 保存失败，请检查格式和参数结构。';
  const fieldErrors = Object.entries((details as any).fieldErrors || {})
    .flatMap(([field, messages]) => Array.isArray(messages) ? messages.map((message) => `${field}: ${message}`) : []);
  const formErrors = Array.isArray((details as any).formErrors) ? (details as any).formErrors : [];
  const summary = [...fieldErrors, ...formErrors].slice(0, 6).join('；');
  return summary
    ? `${error?.message || 'JSON 保存失败'}：${summary}`
    : error?.message || 'JSON 保存失败，请检查格式和参数结构。';
}

export function csvFromArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).join(', ') : '';
}

export function arrayFromCsv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function runtimeEditorFromParams(params: any, type: CustomApiConfig['type']): RuntimeEditorState {
  const runtime = type === 'image'
    ? params?.imageCapabilities?.runtime || {}
    : type === 'video'
      ? params?.videoCapabilities?.runtime || {}
      : {};
  return {
    modelOverride: runtime.modelOverride || '',
    endpoint: runtime.endpoint || '',
    streamEndpoint: runtime.streamEndpoint || '',
    responsePaths: csvFromArray(runtime.responsePaths),
    streamChunkPaths: csvFromArray(runtime.streamChunkPaths),
    taskIdPaths: csvFromArray(runtime.taskIdPaths),
    pollEndpoint: runtime.pollEndpoint || '',
    pollResultPaths: csvFromArray(runtime.pollResultPaths),
    pollStatusPaths: csvFromArray(runtime.pollStatusPaths),
    failedStatuses: csvFromArray(runtime.failedStatuses)
  };
}

export function runtimeFromEditor(editor: RuntimeEditorState, type: CustomApiConfig['type']) {
  const runtime: Record<string, any> = {};
  if (editor.modelOverride.trim()) runtime.modelOverride = editor.modelOverride.trim();
  if (editor.endpoint.trim()) runtime.endpoint = editor.endpoint.trim();
  const responsePaths = arrayFromCsv(editor.responsePaths);
  const taskIdPaths = arrayFromCsv(editor.taskIdPaths);
  if (responsePaths.length) runtime.responsePaths = responsePaths;
  if (taskIdPaths.length) runtime.taskIdPaths = taskIdPaths;
  if (type === 'video') {
    if (editor.pollEndpoint.trim()) runtime.pollEndpoint = editor.pollEndpoint.trim();
    const pollResultPaths = arrayFromCsv(editor.pollResultPaths);
    const pollStatusPaths = arrayFromCsv(editor.pollStatusPaths);
    const failedStatuses = arrayFromCsv(editor.failedStatuses);
    if (pollResultPaths.length) runtime.pollResultPaths = pollResultPaths;
    if (pollStatusPaths.length) runtime.pollStatusPaths = pollStatusPaths;
    if (failedStatuses.length) runtime.failedStatuses = failedStatuses;
  }
  return runtime;
}

export function cloneWithRuntime(params: any, type: CustomApiConfig['type'], editor: RuntimeEditorState) {
  const nextParams = JSON.parse(JSON.stringify(params || {}));
  const runtime = runtimeFromEditor(editor, type);
  if (type === 'image') {
    nextParams.imageCapabilities = {
      ...(nextParams.imageCapabilities || {}),
      runtime
    };
  } else if (type === 'video') {
    nextParams.videoCapabilities = {
      ...(nextParams.videoCapabilities || {}),
      runtime
    };
  }
  return nextParams;
}
