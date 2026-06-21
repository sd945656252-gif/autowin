import { z } from "zod";

export const workflowNodeStageSchema = z.enum([
  "SCRIPT_01",
  "DIRECTOR_02",
  "ART_03",
  "SHOT_04",
  "EDIT_05"
]);

export const workflowNodeTypeSchema = z.enum([
  "script",
  "shot",
  "image_generator",
  "video_generator",
  "panorama",
  "scene3d",
  "voice",
  "music",
  "editing",
  "export"
]);

export const workflowNodeModelCapabilitySchema = z.enum([
  "TEXT_GENERATOR",
  "IMAGE_GENERATOR",
  "VIDEO_GENERATOR",
  "PANORAMA_PROCESSOR",
  "SCENE3D_RENDERER",
  "VOICE_GENERATOR",
  "SPEECH_TO_TEXT",
  "MUSIC_GENERATOR",
  "AUDIO_PROCESSOR"
]);

export const workflowArtifactTypeSchema = z.enum([
  "text",
  "shot_breakdown",
  "image_asset",
  "video_asset",
  "audio_asset",
  "panorama_view",
  "scene_json",
  "camera_metadata",
  "reference_frame",
  "voice_audio",
  "music_audio",
  "subtitle_timeline",
  "audio_timeline_metadata",
  "editing_timeline",
  "exported_video"
]);

export const workflowNodeSlotSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().default(false),
  maxCount: z.number().int().min(1).optional(),
  mediaTypes: z.array(z.enum(["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"])).optional(),
  artifactTypes: z.array(workflowArtifactTypeSchema).optional()
}).strict();

export const workflowNodeParameterContractSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  valueType: z.enum(["string", "number", "boolean", "enum", "json", "asset_ref", "asset_ref_list"]),
  required: z.boolean().default(false),
  modelControlled: z.boolean().default(false),
  snapshotRequired: z.boolean().default(true)
}).strict();

export const workflowNodeExecutionContractSchema = z.object({
  status: z.enum(["active", "planned"]),
  endpoint: z.string().min(1).optional(),
  requiresBackend: z.literal(true),
  createsWorkflowRun: z.boolean(),
  createsWorkflowNodeRun: z.boolean(),
  queueRequired: z.boolean(),
  writesMediaAsset: z.boolean(),
  writesNodeArtifact: z.boolean(),
  requiresModelCenterCapability: z.boolean(),
  forbidsInlineSecrets: z.literal(true)
}).strict();

export const workflowNodeDefinitionSchema = z.object({
  type: workflowNodeTypeSchema,
  label: z.string().min(1),
  stage: workflowNodeStageSchema,
  order: z.number().int().min(1),
  version: z.number().int().min(1),
  lifecycle: z.enum(["active", "planned"]),
  requiredModelCapability: workflowNodeModelCapabilitySchema.optional(),
  inputs: z.array(workflowNodeSlotSchema),
  parameters: z.array(workflowNodeParameterContractSchema),
  outputs: z.array(workflowNodeSlotSchema),
  execution: workflowNodeExecutionContractSchema,
  acceptance: z.array(z.string().min(1)).min(1)
}).strict();

export type WorkflowNodeStage = z.infer<typeof workflowNodeStageSchema>;
export type WorkflowNodeType = z.infer<typeof workflowNodeTypeSchema>;
export type WorkflowNodeModelCapability = z.infer<typeof workflowNodeModelCapabilitySchema>;
export type WorkflowArtifactType = z.infer<typeof workflowArtifactTypeSchema>;
export type WorkflowNodeSlot = z.infer<typeof workflowNodeSlotSchema>;
export type WorkflowNodeParameterContract = z.infer<typeof workflowNodeParameterContractSchema>;
export type WorkflowNodeExecutionContract = z.infer<typeof workflowNodeExecutionContractSchema>;
export type WorkflowNodeDefinition = z.infer<typeof workflowNodeDefinitionSchema>;

export const WORKFLOW_NODE_DEFINITIONS: WorkflowNodeDefinition[] = workflowNodeDefinitionSchema.array().parse([
  {
    type: "script",
    label: "Script",
    stage: "SCRIPT_01",
    order: 10,
    version: 1,
    lifecycle: "planned",
    requiredModelCapability: "TEXT_GENERATOR",
    inputs: [],
    parameters: [
      { key: "brief", label: "Brief", valueType: "string", required: true, modelControlled: false, snapshotRequired: true }
    ],
    outputs: [
      { key: "scriptText", label: "Script text", required: true, artifactTypes: ["text"] }
    ],
    execution: {
      status: "planned",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: false,
      writesNodeArtifact: true,
      requiresModelCenterCapability: true,
      forbidsInlineSecrets: true
    },
    acceptance: ["Script output is saved as a backend artifact and can be referenced by downstream shot nodes."]
  },
  {
    type: "shot",
    label: "Shot",
    stage: "DIRECTOR_02",
    order: 20,
    version: 1,
    lifecycle: "planned",
    requiredModelCapability: "TEXT_GENERATOR",
    inputs: [
      { key: "scriptText", label: "Script text", required: true, artifactTypes: ["text"] }
    ],
    parameters: [
      { key: "shotPrompt", label: "Shot prompt", valueType: "string", required: true, modelControlled: false, snapshotRequired: true }
    ],
    outputs: [
      { key: "shotBreakdown", label: "Shot breakdown", required: true, artifactTypes: ["shot_breakdown"] }
    ],
    execution: {
      status: "planned",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: false,
      writesNodeArtifact: true,
      requiresModelCenterCapability: true,
      forbidsInlineSecrets: true
    },
    acceptance: ["Shot breakdown is saved with parameter and model capability snapshots."]
  },
  {
    type: "image_generator",
    label: "Image Generator",
    stage: "ART_03",
    order: 30,
    version: 1,
    lifecycle: "active",
    requiredModelCapability: "IMAGE_GENERATOR",
    inputs: [
      { key: "referenceImages", label: "Reference images", required: false, maxCount: 20, mediaTypes: ["IMAGE"] }
    ],
    parameters: [
      { key: "prompt", label: "Prompt", valueType: "string", required: true, modelControlled: false, snapshotRequired: true },
      { key: "imageInputs", label: "Image inputs", valueType: "json", required: false, modelControlled: false, snapshotRequired: true },
      { key: "modelCapability", label: "Model capability", valueType: "json", required: true, modelControlled: true, snapshotRequired: true }
    ],
    outputs: [
      { key: "generatedImage", label: "Generated image", required: true, maxCount: 20, mediaTypes: ["IMAGE"], artifactTypes: ["image_asset", "reference_frame"] }
    ],
    execution: {
      status: "active",
      endpoint: "/api/workflow/execute",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: true,
      writesNodeArtifact: true,
      requiresModelCenterCapability: true,
      forbidsInlineSecrets: true
    },
    acceptance: ["Execution creates a real WorkflowRun and returns a generated MediaAsset stream URL."]
  },
  {
    type: "video_generator",
    label: "Video Generator",
    stage: "SHOT_04",
    order: 40,
    version: 1,
    lifecycle: "active",
    requiredModelCapability: "VIDEO_GENERATOR",
    inputs: [
      { key: "referenceMedia", label: "Reference media", required: false, maxCount: 20, mediaTypes: ["IMAGE", "VIDEO", "AUDIO"] }
    ],
    parameters: [
      { key: "prompt", label: "Prompt", valueType: "string", required: true, modelControlled: false, snapshotRequired: true },
      { key: "videoInputs", label: "Video inputs", valueType: "json", required: false, modelControlled: false, snapshotRequired: true },
      { key: "modelCapability", label: "Model capability", valueType: "json", required: true, modelControlled: true, snapshotRequired: true }
    ],
    outputs: [
      { key: "generatedVideo", label: "Generated video", required: true, mediaTypes: ["VIDEO"], artifactTypes: ["video_asset"] }
    ],
    execution: {
      status: "active",
      endpoint: "/api/workflow/execute",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: true,
      writesNodeArtifact: true,
      requiresModelCenterCapability: true,
      forbidsInlineSecrets: true
    },
    acceptance: ["Execution uses a configured video capability and writes the generated video to MediaAsset."]
  },
  {
    type: "panorama",
    label: "Panorama",
    stage: "ART_03",
    order: 50,
    version: 1,
    lifecycle: "planned",
    requiredModelCapability: "PANORAMA_PROCESSOR",
    inputs: [
      { key: "panoramaSource", label: "Panorama source", required: true, mediaTypes: ["IMAGE", "VIDEO"], artifactTypes: ["image_asset", "video_asset"] }
    ],
    parameters: [
      { key: "viewMetadata", label: "View metadata", valueType: "json", required: true, modelControlled: false, snapshotRequired: true },
      { key: "hotspots", label: "Hotspots", valueType: "json", required: false, modelControlled: false, snapshotRequired: true }
    ],
    outputs: [
      { key: "panoramaView", label: "Panorama view", required: true, artifactTypes: ["panorama_view", "camera_metadata"] },
      { key: "referenceFrame", label: "Reference frame", required: false, mediaTypes: ["IMAGE"], artifactTypes: ["reference_frame"] }
    ],
    execution: {
      status: "planned",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: true,
      writesNodeArtifact: true,
      requiresModelCenterCapability: false,
      forbidsInlineSecrets: true
    },
    acceptance: ["Panorama metadata and reference frames are saved as backend artifacts before downstream use."]
  },
  {
    type: "scene3d",
    label: "3D Director Stage",
    stage: "SHOT_04",
    order: 60,
    version: 1,
    lifecycle: "planned",
    requiredModelCapability: "SCENE3D_RENDERER",
    inputs: [
      { key: "sceneAssets", label: "Scene assets", required: false, maxCount: 50, mediaTypes: ["IMAGE", "VIDEO", "DOCUMENT"], artifactTypes: ["image_asset", "video_asset"] }
    ],
    parameters: [
      { key: "sceneJson", label: "Scene JSON", valueType: "json", required: true, modelControlled: false, snapshotRequired: true },
      { key: "camera", label: "Camera", valueType: "json", required: true, modelControlled: false, snapshotRequired: true }
    ],
    outputs: [
      { key: "sceneJson", label: "Scene JSON", required: true, artifactTypes: ["scene_json"] },
      { key: "cameraMetadata", label: "Camera metadata", required: true, artifactTypes: ["camera_metadata"] },
      { key: "referenceFrame", label: "Reference frame", required: false, mediaTypes: ["IMAGE"], artifactTypes: ["reference_frame"] }
    ],
    execution: {
      status: "planned",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: true,
      writesNodeArtifact: true,
      requiresModelCenterCapability: false,
      forbidsInlineSecrets: true
    },
    acceptance: ["Scene JSON, camera metadata, thumbnails, and reference frames are persisted with project and node ownership."]
  },
  {
    type: "voice",
    label: "Voice",
    stage: "EDIT_05",
    order: 70,
    version: 1,
    lifecycle: "planned",
    requiredModelCapability: "VOICE_GENERATOR",
    inputs: [
      { key: "voiceText", label: "Voice text", required: true, artifactTypes: ["text", "shot_breakdown"] },
      { key: "referenceAudio", label: "Reference audio", required: false, mediaTypes: ["AUDIO"] }
    ],
    parameters: [
      { key: "voiceProfile", label: "Voice profile", valueType: "json", required: true, modelControlled: true, snapshotRequired: true },
      { key: "emotion", label: "Emotion", valueType: "string", required: false, modelControlled: false, snapshotRequired: true }
    ],
    outputs: [
      { key: "voiceAudio", label: "Voice audio", required: true, mediaTypes: ["AUDIO"], artifactTypes: ["voice_audio", "audio_asset"] },
      { key: "subtitleTimeline", label: "Subtitle timeline", required: false, artifactTypes: ["subtitle_timeline"] }
    ],
    execution: {
      status: "planned",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: true,
      writesNodeArtifact: true,
      requiresModelCenterCapability: true,
      forbidsInlineSecrets: true
    },
    acceptance: ["Voice audio and subtitle timeline are saved as assets/artifacts with model parameter snapshots."]
  },
  {
    type: "music",
    label: "Music",
    stage: "EDIT_05",
    order: 80,
    version: 1,
    lifecycle: "planned",
    requiredModelCapability: "MUSIC_GENERATOR",
    inputs: [
      { key: "referenceAudio", label: "Reference audio", required: false, mediaTypes: ["AUDIO"] }
    ],
    parameters: [
      { key: "musicPrompt", label: "Music prompt", valueType: "string", required: true, modelControlled: false, snapshotRequired: true },
      { key: "structure", label: "Structure", valueType: "json", required: false, modelControlled: false, snapshotRequired: true }
    ],
    outputs: [
      { key: "musicAudio", label: "Music audio", required: true, mediaTypes: ["AUDIO"], artifactTypes: ["music_audio", "audio_asset"] },
      { key: "timelineMetadata", label: "Timeline metadata", required: false, artifactTypes: ["audio_timeline_metadata"] }
    ],
    execution: {
      status: "planned",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: true,
      writesNodeArtifact: true,
      requiresModelCenterCapability: true,
      forbidsInlineSecrets: true
    },
    acceptance: ["Music output stores audio, BPM/loop metadata, and edit timeline references as backend artifacts."]
  },
  {
    type: "editing",
    label: "Editing",
    stage: "EDIT_05",
    order: 90,
    version: 1,
    lifecycle: "planned",
    inputs: [
      { key: "timelineInputs", label: "Timeline inputs", required: true, maxCount: 100, artifactTypes: ["video_asset", "voice_audio", "music_audio", "subtitle_timeline"] }
    ],
    parameters: [
      { key: "timelineJson", label: "Timeline JSON", valueType: "json", required: true, modelControlled: false, snapshotRequired: true }
    ],
    outputs: [
      { key: "editingTimeline", label: "Editing timeline", required: true, artifactTypes: ["editing_timeline"] }
    ],
    execution: {
      status: "planned",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: false,
      writesNodeArtifact: true,
      requiresModelCenterCapability: false,
      forbidsInlineSecrets: true
    },
    acceptance: ["Timeline updates are persisted and recoverable after refresh."]
  },
  {
    type: "export",
    label: "Export",
    stage: "EDIT_05",
    order: 100,
    version: 1,
    lifecycle: "planned",
    inputs: [
      { key: "editingTimeline", label: "Editing timeline", required: true, artifactTypes: ["editing_timeline"] }
    ],
    parameters: [
      { key: "exportSettings", label: "Export settings", valueType: "json", required: true, modelControlled: false, snapshotRequired: true }
    ],
    outputs: [
      { key: "exportedVideo", label: "Exported video", required: true, mediaTypes: ["VIDEO"], artifactTypes: ["exported_video"] }
    ],
    execution: {
      status: "planned",
      requiresBackend: true,
      createsWorkflowRun: true,
      createsWorkflowNodeRun: true,
      queueRequired: true,
      writesMediaAsset: true,
      writesNodeArtifact: true,
      requiresModelCenterCapability: false,
      forbidsInlineSecrets: true
    },
    acceptance: ["Export creates a real backend job and downloadable MediaAsset with permission checks."]
  }
]);

const workflowNodeDefinitionsByType = new Map(WORKFLOW_NODE_DEFINITIONS.map((definition) => [definition.type, definition]));

export function listWorkflowNodeDefinitions() {
  return [...WORKFLOW_NODE_DEFINITIONS];
}

export function getWorkflowNodeDefinition(type: unknown) {
  const parsed = workflowNodeTypeSchema.safeParse(type);
  if (!parsed.success) return null;
  return workflowNodeDefinitionsByType.get(parsed.data) || null;
}

export function requireWorkflowNodeDefinition(type: unknown) {
  const definition = getWorkflowNodeDefinition(type);
  if (!definition) {
    throw new Error(`Unsupported workflow node type: ${String(type || "unknown")}`);
  }
  return definition;
}

export function isExecutableWorkflowNodeType(type: unknown): type is WorkflowNodeType {
  const definition = getWorkflowNodeDefinition(type);
  return Boolean(definition && definition.lifecycle === "active" && definition.execution.status === "active");
}

export function listExecutableWorkflowNodeTypes() {
  return WORKFLOW_NODE_DEFINITIONS
    .filter((definition) => definition.lifecycle === "active" && definition.execution.status === "active")
    .map((definition) => definition.type);
}

export function getWorkflowNodeRequiredCapability(type: unknown) {
  const definition = getWorkflowNodeDefinition(type);
  if (!definition || !isExecutableWorkflowNodeType(definition.type)) return null;
  return definition.requiredModelCapability || null;
}

