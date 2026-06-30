import crypto from "crypto";
import fs from "fs/promises";
import type express from "express";
import type { GoogleGenAI } from "@google/genai";
import { AuditAction, ModelCapability, ProductionAssetReviewStatus, ProductionAssetScope, ProductionStage, UserRole, WorkflowRunStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { safeAxiosGet, safeAxiosPost } from "../../security/safe-outbound";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth, type RequestUser } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { canReadMediaAsset, protectedMediaUrl, resolveLocalUploadPath, saveGeneratedToLocalFile } from "../media/media.service";
import { callTextProvider, type ProviderAttachment } from "../custom-ai/provider-client";
import { resolveCustomApiRuntimeConfig } from "../custom-api-configs/custom-api-configs.service";
import { validateWorkflowCapabilityExecution } from "../model-capabilities/model-capabilities.service";
import { ensureProjectMember } from "../production-assets/production-assets.shared";
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

const scene3dImportModeSchema = z.enum(["new_scene", "merge"]);
const scene3dImportRequestSchema = z.object({
  workflowId: z.string().min(1),
  nodeId: z.string().min(1),
  imageAssetId: z.string().min(1),
  mode: scene3dImportModeSchema
});

const scene3dVec3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite()
});

const scene3dPoseReferenceViewSchema = z.enum(["front", "side", "back"]);
const scene3dPoseJointKeySchema = z.enum([
  "pelvis",
  "chest",
  "neck",
  "head",
  "leftUpperArm",
  "leftLowerArm",
  "rightUpperArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "rightUpperLeg",
  "rightLowerLeg",
  "leftFoot",
  "rightFoot"
]);
const scene3dRigPoseSchema = z.object(Object.fromEntries(
  scene3dPoseJointKeySchema.options.map((key) => [key, scene3dVec3Schema])
) as Record<z.infer<typeof scene3dPoseJointKeySchema>, typeof scene3dVec3Schema>);
const scene3dBonePoseSchema = z.object({
  space: z.enum(["mixamo-local", "scene3d-local"]).default("mixamo-local"),
  bones: z.record(z.string(), scene3dVec3Schema)
});
const scene3dPoseFoundationHintSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  confidence: z.number().finite().min(0).max(1),
  reason: z.string().trim().min(1).max(400),
  rootOffset: scene3dVec3Schema,
  bonePose: scene3dBonePoseSchema.optional()
});
const scene3dPoseLandmarkPointSchema = z.object({
  x: z.number().finite().min(-1.5).max(1.5),
  y: z.number().finite().min(-1.5).max(1.5),
  visible: z.number().finite().min(0).max(1).optional(),
  depth: z.number().finite().min(-1.5).max(1.5).optional()
});
const scene3dPoseLandmarkKeySchema = z.enum([
  "nose",
  "leftEye",
  "rightEye",
  "leftEar",
  "rightEar",
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftWrist",
  "rightWrist",
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle",
  "leftToe",
  "rightToe"
]);
const scene3dPoseContactSchema = z.object({
  point: z.enum(["leftFoot", "rightFoot", "leftHand", "rightHand", "leftKnee", "rightKnee", "hip"]),
  type: z.enum(["ground", "prop", "body", "unknown"]),
  confidence: z.number().finite().min(0).max(1)
});
const scene3dPoseLandmarksSchema = z.object({
  version: z.literal(1),
  sourceViews: z.array(scene3dPoseReferenceViewSchema).min(1).max(3),
  coordinateSpace: z.literal("image-normalized"),
  points: z.partialRecord(scene3dPoseLandmarkKeySchema, scene3dPoseLandmarkPointSchema),
  bodyFacing: z.number().finite().min(-180).max(180).default(0),
  torsoLean: scene3dVec3Schema.optional(),
  contacts: z.array(scene3dPoseContactSchema).max(8).default([]),
  confidence: z.number().finite().min(0).max(1)
});

const scene3dLightSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(120),
  lightType: z.enum(["ambient", "directional", "point", "spot", "area"]),
  enabled: z.boolean().default(true),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  intensity: z.number().finite().min(0).max(20),
  position: scene3dVec3Schema.optional(),
  rotation: scene3dVec3Schema.optional(),
  targetId: z.string().trim().max(120).optional(),
  targetPosition: scene3dVec3Schema.optional(),
  distance: z.number().finite().min(0).max(200).optional(),
  decay: z.number().finite().min(0).max(8).optional(),
  angle: z.number().finite().min(0.05).max(Math.PI / 2).optional(),
  penumbra: z.number().finite().min(0).max(1).optional(),
  width: z.number().finite().min(0.1).max(20).optional(),
  height: z.number().finite().min(0.1).max(20).optional(),
  castShadow: z.boolean().optional(),
  shadowIntensity: z.number().finite().min(0).max(1).optional(),
  helperVisible: z.boolean().optional()
});

const scene3dEnvironmentMoodSchema = z.object({
  skyColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  horizonColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  groundColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  backgroundType: z.enum(["color", "gradient", "panorama", "hdri"]).default("color"),
  backgroundAssetId: z.string().trim().max(160).optional(),
  panoramaRotationY: z.number().finite().min(-360).max(360).optional(),
  environmentIntensity: z.number().finite().min(0).max(5).optional(),
  fogEnabled: z.boolean().default(false),
  fogColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fogNear: z.number().finite().min(0.1).max(500).optional(),
  fogFar: z.number().finite().min(1).max(1000).optional(),
  fogDensity: z.number().finite().min(0).max(1).optional(),
  exposure: z.number().finite().min(0.1).max(3).optional(),
  toneMapping: z.enum(["none", "linear", "reinhard", "aces"]).optional(),
  moodPreset: z.string().trim().max(120).optional(),
  weatherHint: z.enum(["clear", "cloudy", "rainy", "foggy", "snowy", "night"]).optional(),
  timeOfDay: z.enum(["dawn", "morning", "noon", "golden_hour", "dusk", "night"]).optional()
});

const scene3dMaterialDirectiveSchema = z.object({
  id: z.string().trim().min(1).max(100),
  targetType: z.enum(["character", "object", "scene"]),
  targetId: z.string().trim().min(1).max(120),
  materialSlot: z.string().trim().max(120).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emissiveColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emissiveIntensity: z.number().finite().min(0).max(10).optional(),
  roughness: z.number().finite().min(0).max(1).optional(),
  metalness: z.number().finite().min(0).max(1).optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  transparent: z.boolean().optional(),
  textureAssetId: z.string().trim().max(160).optional(),
  normalMapAssetId: z.string().trim().max(160).optional(),
  styleTag: z.string().trim().max(120).optional(),
  enabled: z.boolean().default(true)
});

const scene3dVisualKeyframeSchema = z.object({
  id: z.string().trim().min(1).max(100),
  atMs: z.number().finite().min(0),
  targetType: z.enum(["light", "environment", "material"]),
  targetId: z.string().trim().max(120).optional(),
  lightPatch: scene3dLightSchema.partial().optional(),
  environmentPatch: scene3dEnvironmentMoodSchema.partial().optional(),
  materialPatch: scene3dMaterialDirectiveSchema.partial().optional(),
  easing: z.enum(["linear", "ease_in", "ease_out", "ease_in_out"]).default("linear"),
  note: z.string().trim().max(300).optional()
});

const scene3dImportResultSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  background: z.object({
    type: z.enum(["color", "panorama", "image_reference"]),
    suggestedColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    referenceAssetId: z.string().trim().nullable(),
    referenceUrl: z.string().trim().nullable()
  }),
  characters: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    roleHint: z.string().trim().max(160).nullable(),
    position: scene3dVec3Schema,
    rotation: scene3dVec3Schema,
    scale: scene3dVec3Schema,
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    posePreset: z.string().trim().max(80).nullable()
  })).max(12),
  cameras: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    position: scene3dVec3Schema,
    targetPosition: scene3dVec3Schema,
    fov: z.number().finite().min(12).max(120),
    shotType: z.string().trim().max(80).nullable(),
    framingHint: z.string().trim().max(240).nullable()
  })).min(1).max(8),
  composition: z.object({
    aspectRatio: z.string().trim().min(3).max(16),
    guideEnabled: z.boolean(),
    notes: z.array(z.string().trim().min(1).max(240)).max(12)
  })
});

type Scene3DImportResult = z.infer<typeof scene3dImportResultSchema>;

const scene3dDirectorRequestSchema = z.object({
  workflowId: z.string().min(1),
  nodeId: z.string().min(1),
  directorDescription: z.string().trim().min(4).max(4000),
  durationMs: z.number().finite().min(500).max(300000),
  aspectRatio: z.string().trim().min(3).max(16),
  cameraStyle: z.string().trim().max(160).optional().default(""),
  actionStyle: z.string().trim().max(160).optional().default(""),
  keepCurrentScene: z.boolean().default(true),
  allowNewCameras: z.boolean().default(true),
  allowCharacterReposition: z.boolean().default(true),
  sceneContext: z.unknown().optional()
});

const scene3dDirectorShotSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  startMs: z.number().finite().min(0),
  endMs: z.number().finite().min(0),
  description: z.string().trim().min(1).max(1000),
  cameraId: z.string().trim().max(120).nullable().optional(),
  cameraName: z.string().trim().max(120).nullable().optional(),
  framing: z.string().trim().max(240).nullable().optional(),
  action: z.string().trim().max(500).nullable().optional(),
  cameraMove: z.string().trim().max(500).nullable().optional()
}).refine((shot) => shot.endMs > shot.startMs, {
  message: "endMs must be greater than startMs",
  path: ["endMs"]
});

const scene3dDirectorCharacterKeyframeSchema = z.object({
  characterId: z.string().trim().max(120).nullable().optional(),
  characterName: z.string().trim().max(120).nullable().optional(),
  position: scene3dVec3Schema,
  rotation: scene3dVec3Schema,
  scale: scene3dVec3Schema.optional(),
  uniformScale: z.number().finite().min(0.05).max(10).optional(),
  posePreset: z.string().trim().max(80).nullable().optional(),
  poseParams: z.record(z.string(), z.number().finite()).optional(),
  actionHint: z.string().trim().max(500).nullable().optional()
});

const scene3dDirectorKeyframeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  shotId: z.string().trim().max(80).nullable().optional(),
  timeMs: z.number().finite().min(0),
  easing: z.enum(["linear", "ease_in", "ease_out", "ease_in_out"]).default("linear"),
  camera: z.object({
    cameraId: z.string().trim().max(120).nullable().optional(),
    cameraName: z.string().trim().max(120).nullable().optional(),
    position: scene3dVec3Schema,
    targetPosition: scene3dVec3Schema,
    fov: z.number().finite().min(12).max(120)
  }),
  characters: z.array(scene3dDirectorCharacterKeyframeSchema).max(24)
});

const scene3dDirectorMotionSegmentSchema = z.object({
  id: z.string().trim().min(1).max(80),
  shotId: z.string().trim().max(80).nullable().optional(),
  startMs: z.number().finite().min(0),
  endMs: z.number().finite().min(0),
  characterId: z.string().trim().max(120).nullable().optional(),
  characterName: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().min(1).max(1000),
  actionStyle: z.string().trim().max(160).nullable().optional(),
  fromKeyframeId: z.string().trim().max(80).nullable().optional(),
  toKeyframeId: z.string().trim().max(80).nullable().optional()
}).refine((segment) => segment.endMs > segment.startMs, {
  message: "endMs must be greater than startMs",
  path: ["endMs"]
});

const scene3dDirectorCameraPathPointSchema = z.object({
  id: z.string().trim().min(1).max(80),
  shotId: z.string().trim().max(80).nullable().optional(),
  cameraId: z.string().trim().max(120).nullable().optional(),
  cameraName: z.string().trim().max(120).nullable().optional(),
  timeMs: z.number().finite().min(0),
  position: scene3dVec3Schema,
  targetPosition: scene3dVec3Schema,
  fov: z.number().finite().min(12).max(120)
});

const scene3dCharacterRelationTypeSchema = z.enum(["look_at", "follow", "keep_distance", "face_each_other", "circle_around", "avoid"]);
const scene3dInteractionClipTypeSchema = z.enum(["handshake", "handoff", "dialogue_blocking", "chase", "fight_basic", "custom"]);
const scene3dSyncMarkerTriggerSchema = z.enum(["time", "arrive_position", "pose_reached", "clip_end"]);
const scene3dSyncMarkerActionSchema = z.enum(["start_clip", "hold", "look_at", "face_each_other"]);

const scene3dCharacterRelationSchema = z.object({
  id: z.string().trim().min(1).max(100),
  type: scene3dCharacterRelationTypeSchema,
  sourceCharacterId: z.string().trim().min(1).max(120),
  targetCharacterId: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  distance: z.number().finite().min(0.35).max(12).default(1.2),
  radius: z.number().finite().min(0.5).max(12).default(1.6),
  strength: z.number().finite().min(0).max(1).default(0.75),
  startSec: z.number().finite().min(0).optional(),
  endSec: z.number().finite().min(0).optional(),
  notes: z.string().trim().max(500).optional(),
  source: z.enum(["ai", "manual", "imported"]).default("ai"),
  createdAt: z.string().trim().optional(),
  updatedAt: z.string().trim().optional()
}).refine((relation) => relation.sourceCharacterId !== relation.targetCharacterId, {
  message: "sourceCharacterId and targetCharacterId must be different",
  path: ["targetCharacterId"]
});

const scene3dInteractionClipSchema = z.object({
  id: z.string().trim().min(1).max(100),
  type: scene3dInteractionClipTypeSchema,
  label: z.string().trim().min(1).max(140),
  participantIds: z.array(z.string().trim().min(1).max(120)).min(2).max(8),
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().min(0),
  description: z.string().trim().min(1).max(1200),
  relationIds: z.array(z.string().trim().min(1).max(100)).max(24).default([]),
  syncMarkerIds: z.array(z.string().trim().min(1).max(100)).max(24).default([]),
  source: z.enum(["ai", "manual", "imported"]).default("ai"),
  createdAt: z.string().trim().optional(),
  updatedAt: z.string().trim().optional()
}).refine((clip) => clip.endSec > clip.startSec, {
  message: "endSec must be greater than startSec",
  path: ["endSec"]
});

const scene3dSyncMarkerSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(140),
  timeSec: z.number().finite().min(0),
  trigger: scene3dSyncMarkerTriggerSchema,
  sourceCharacterId: z.string().trim().min(1).max(120),
  targetCharacterId: z.string().trim().max(120).optional(),
  action: scene3dSyncMarkerActionSchema,
  linkedInteractionClipId: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  createdAt: z.string().trim().optional(),
  updatedAt: z.string().trim().optional()
});

const scene3dDirectorPlanSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(160),
  durationMs: z.number().finite().min(500).max(300000),
  aspectRatio: z.string().trim().min(3).max(16),
  summary: z.string().trim().min(1).max(1600),
  shots: z.array(scene3dDirectorShotSchema).min(1).max(24),
  keyframes: z.array(scene3dDirectorKeyframeSchema).min(2).max(80),
  motionSegments: z.array(scene3dDirectorMotionSegmentSchema).max(80),
  cameraPath: z.array(scene3dDirectorCameraPathPointSchema).max(120),
  characterRelations: z.array(scene3dCharacterRelationSchema).max(80),
  interactionClips: z.array(scene3dInteractionClipSchema).max(80),
  syncMarkers: z.array(scene3dSyncMarkerSchema).max(120),
  sceneLights: z.array(scene3dLightSchema).max(24).default([]),
  environmentMood: scene3dEnvironmentMoodSchema.optional(),
  materialDirectives: z.array(scene3dMaterialDirectiveSchema).max(80).default([]),
  visualKeyframes: z.array(scene3dVisualKeyframeSchema).max(120).default([]),
  moodPrompt: z.string().trim().max(1200).optional(),
  renderStylePrompt: z.string().trim().max(1200).optional(),
  warnings: z.array(z.string().trim().min(1).max(300)).max(24)
}).superRefine((plan, ctx) => {
  const maxTime = plan.durationMs;
  for (const [index, shot] of plan.shots.entries()) {
    if (shot.endMs > maxTime) ctx.addIssue({ code: "custom", path: ["shots", index, "endMs"], message: "shot endMs exceeds durationMs" });
  }
  for (const [index, keyframe] of plan.keyframes.entries()) {
    if (keyframe.timeMs > maxTime) ctx.addIssue({ code: "custom", path: ["keyframes", index, "timeMs"], message: "keyframe timeMs exceeds durationMs" });
  }
  for (const [index, segment] of plan.motionSegments.entries()) {
    if (segment.endMs > maxTime) ctx.addIssue({ code: "custom", path: ["motionSegments", index, "endMs"], message: "motion segment endMs exceeds durationMs" });
  }
  for (const [index, point] of plan.cameraPath.entries()) {
    if (point.timeMs > maxTime) ctx.addIssue({ code: "custom", path: ["cameraPath", index, "timeMs"], message: "camera path timeMs exceeds durationMs" });
  }
  for (const [index, relation] of plan.characterRelations.entries()) {
    if (relation.endSec !== undefined && relation.startSec !== undefined && relation.endSec < relation.startSec) {
      ctx.addIssue({ code: "custom", path: ["characterRelations", index, "endSec"], message: "relation endSec must be after startSec" });
    }
    if (relation.endSec !== undefined && relation.endSec * 1000 > maxTime) {
      ctx.addIssue({ code: "custom", path: ["characterRelations", index, "endSec"], message: "relation endSec exceeds durationMs" });
    }
  }
  for (const [index, clip] of plan.interactionClips.entries()) {
    if (clip.endSec * 1000 > maxTime) ctx.addIssue({ code: "custom", path: ["interactionClips", index, "endSec"], message: "interaction clip endSec exceeds durationMs" });
  }
  for (const [index, marker] of plan.syncMarkers.entries()) {
    if (marker.timeSec * 1000 > maxTime) ctx.addIssue({ code: "custom", path: ["syncMarkers", index, "timeSec"], message: "sync marker timeSec exceeds durationMs" });
  }
  for (const [index, keyframe] of plan.visualKeyframes.entries()) {
    if (keyframe.atMs > maxTime) ctx.addIssue({ code: "custom", path: ["visualKeyframes", index, "atMs"], message: "visual keyframe atMs exceeds durationMs" });
    if (keyframe.targetType === "light" && !keyframe.targetId) ctx.addIssue({ code: "custom", path: ["visualKeyframes", index, "targetId"], message: "light visual keyframes require targetId" });
    if (keyframe.targetType === "material" && !keyframe.targetId) ctx.addIssue({ code: "custom", path: ["visualKeyframes", index, "targetId"], message: "material visual keyframes require targetId" });
  }
});

type Scene3DDirectorRequest = z.infer<typeof scene3dDirectorRequestSchema>;
type Scene3DDirectorPlan = z.infer<typeof scene3dDirectorPlanSchema>;

const scene3dMotionRefineRequestSchema = z.object({
  workflowId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  nodeId: z.string().min(1),
  transitionId: z.string().min(1),
  selectedCharacterId: z.string().min(1),
  actionPrompt: z.string().trim().min(1).max(4000),
  durationSec: z.number().finite().min(0.5).max(120),
  curve: z.enum(["linear", "ease_in", "ease_out", "ease_in_out"]),
  startTransform: z.unknown(),
  endTransform: z.unknown(),
  startPose: z.unknown(),
  endPose: z.unknown(),
  startFingerPose: z.unknown().optional(),
  endFingerPose: z.unknown().optional(),
  currentCharacterTransform: z.unknown().optional(),
  constraints: z.unknown().optional(),
  cameras: z.array(z.unknown()).max(8).default([]),
  props: z.array(z.unknown()).max(16).default([]),
  activeCameraId: z.string().max(120).optional(),
  activeViewMode: z.enum(["director", "camera"]).default("director"),
  coordinateSystemDescription: z.string().trim().max(1200),
  viewportScreenshotAssetId: z.string().trim().max(160).optional(),
  referenceImageAssetId: z.string().trim().max(160).optional()
}).refine((request) => Boolean(request.workflowId || request.projectId), {
  message: "workflowId or projectId is required",
  path: ["workflowId"]
});

const scene3dMotionContactHintSchema = z.enum([
  "leftFoot",
  "rightFoot",
  "leftHand",
  "rightHand",
  "head",
  "shoulder",
  "hip",
  "feet",
  "hands"
]);

const scene3dMotionIntentSchema = z.object({
  version: z.literal(1),
  intent: z.string().trim().min(1).max(1200),
  durationSec: z.number().finite().min(0.5).max(120),
  generatedMotionPrompt: z.string().trim().min(1).max(4000),
  direction: scene3dVec3Schema,
  distance: z.number().finite().min(0).max(5),
  turnDeg: z.number().finite().min(-360).max(360),
  roll: z.number().finite().min(0).max(1),
  crouch: z.number().finite().min(0).max(1),
  verticalLift: z.number().finite().min(0).max(2),
  bodyLean: scene3dVec3Schema,
  armSwing: z.number().finite().min(0).max(1),
  rhythm: z.enum(["slow", "normal", "fast", "impact", "perform"]),
  contacts: z.array(scene3dMotionContactHintSchema).max(12),
  lookAt: z.enum(["none", "camera", "object", "point"]),
  targetObjectId: z.string().trim().max(120).optional(),
  warnings: z.array(z.string().trim().min(1).max(300)).max(24),
  confidence: z.number().finite().min(0).max(1)
}).strict();

type Scene3DMotionRefineRequest = z.infer<typeof scene3dMotionRefineRequestSchema>;
type Scene3DMotionIntent = z.infer<typeof scene3dMotionIntentSchema>;

const scene3dPoseReferenceImageSchema = z.object({
  view: scene3dPoseReferenceViewSchema,
  assetId: z.string().trim().min(1).max(160),
  fileName: z.string().trim().max(240).optional(),
  mimeType: z.string().trim().max(120).optional()
});

const scene3dPoseReferenceSolveRequestSchema = z.object({
  workflowId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  nodeId: z.string().min(1),
  selectedCharacterId: z.string().min(1),
  referenceImages: z.array(scene3dPoseReferenceImageSchema).min(1).max(3),
  currentPose: scene3dRigPoseSchema,
  currentBonePose: scene3dBonePoseSchema.optional(),
  currentFingerPose: z.unknown().optional(),
  currentToePose: z.unknown().optional(),
  currentRootOffset: scene3dVec3Schema.optional(),
  foundationPoseHint: scene3dPoseFoundationHintSchema.optional(),
  currentCharacterTransform: z.unknown().optional(),
  sceneContext: z.unknown().optional(),
  coordinateSystemDescription: z.string().trim().max(1200),
  jointAxisProfile: z.unknown()
}).refine((request) => Boolean(request.workflowId || request.projectId), {
  message: "workflowId or projectId is required",
  path: ["workflowId"]
});

const scene3dPoseReferenceSolveResultSchema = z.object({
  version: z.literal(1),
  summary: z.string().trim().min(1).max(1200),
  rigPose: scene3dRigPoseSchema,
  bonePose: scene3dBonePoseSchema.optional(),
  poseLandmarks: scene3dPoseLandmarksSchema.optional(),
  foundationHint: scene3dPoseFoundationHintSchema.optional(),
  rootOffset: scene3dVec3Schema.optional(),
  confidence: z.number().finite().min(0).max(1),
  warnings: z.array(z.string().trim().min(1).max(300)).max(24),
  appliedViews: z.array(scene3dPoseReferenceViewSchema).min(1).max(3)
}).strict();

type Scene3DPoseReferenceSolveRequest = z.infer<typeof scene3dPoseReferenceSolveRequestSchema>;
type Scene3DPoseReferenceSolveResult = z.infer<typeof scene3dPoseReferenceSolveResultSchema>;

function coerceScene3DNumber(value: any, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, numberValue));
}

function coerceScene3DVec3(value: any, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: coerceScene3DNumber(value?.x, fallback.x, -10000, 10000),
    y: coerceScene3DNumber(value?.y, fallback.y, -10000, 10000),
    z: coerceScene3DNumber(value?.z, fallback.z, -10000, 10000)
  };
}

function coerceScene3DMotionIntent(value: any, request: Scene3DMotionRefineRequest) {
  const rhythmRaw = String(value?.rhythm || "").toLowerCase();
  const rhythm = rhythmRaw === "slow"
    ? "slow"
    : rhythmRaw === "fast" || rhythmRaw === "quick" || rhythmRaw === "run"
      ? "fast"
      : rhythmRaw === "impact" || rhythmRaw === "hit"
        ? "impact"
        : rhythmRaw === "perform" || rhythmRaw === "dance"
          ? "perform"
          : "normal";
  const lookAtRaw = String(value?.lookAt || "").toLowerCase();
  const lookAt = lookAtRaw === "camera" || lookAtRaw === "object" || lookAtRaw === "point" ? lookAtRaw : "none";
  const allowedContacts = new Set(scene3dMotionContactHintSchema.options);
  const contacts = Array.isArray(value?.contacts)
    ? value.contacts.map((item: any) => String(item)).filter((item: string) => allowedContacts.has(item as any)).slice(0, 12)
    : [];
  return {
    version: 1 as const,
    intent: typeof value?.intent === "string" && value.intent.trim() ? value.intent.trim() : request.actionPrompt,
    durationSec: request.durationSec,
    generatedMotionPrompt: typeof value?.generatedMotionPrompt === "string" && value.generatedMotionPrompt.trim()
      ? value.generatedMotionPrompt.trim()
      : request.actionPrompt,
    direction: coerceScene3DVec3(value?.direction),
    distance: coerceScene3DNumber(value?.distance, 0, 0, 5),
    turnDeg: coerceScene3DNumber(value?.turnDeg ?? value?.turn, 0, -360, 360),
    roll: coerceScene3DNumber(value?.roll, 0, 0, 1),
    crouch: coerceScene3DNumber(value?.crouch, 0, 0, 1),
    verticalLift: coerceScene3DNumber(value?.verticalLift, 0, 0, 2),
    bodyLean: coerceScene3DVec3(value?.bodyLean),
    armSwing: coerceScene3DNumber(value?.armSwing, 0, 0, 1),
    rhythm,
    contacts,
    lookAt,
    targetObjectId: typeof value?.targetObjectId === "string" && value.targetObjectId.trim() ? value.targetObjectId.trim() : undefined,
    warnings: Array.isArray(value?.warnings) ? value.warnings.map((item: any) => String(item)).filter(Boolean).slice(0, 24) : [],
    confidence: coerceScene3DNumber(value?.confidence, 0.5, 0, 1)
  };
}

const scene3dReusableAssetKindSchema = z.enum(["actionClip", "cameraMove", "directorTemplate", "posePresetMemory"]);
const scene3dReusableAssetSourceType: Record<z.infer<typeof scene3dReusableAssetKindSchema>, string> = {
  actionClip: "scene3d_action_clip",
  cameraMove: "scene3d_camera_move",
  directorTemplate: "scene3d_director_template",
  posePresetMemory: "scene3d_pose_preset_memory"
};
const scene3dReusableAssetSourceTypes = Object.values(scene3dReusableAssetSourceType);

const scene3dReusableAssetSaveSchema = z.object({
  workflowId: z.string().min(1).optional(),
  nodeId: z.string().min(1),
  projectId: z.string().min(1),
  kind: scene3dReusableAssetKindSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  payload: z.record(z.string(), z.any()),
  sceneContext: z.unknown().optional()
}).refine((request) => Boolean(request.workflowId || request.sceneContext), {
  message: "workflowId or sceneContext is required",
  path: ["workflowId"]
});

const scene3dReusableAssetListSchema = z.object({
  projectId: z.string().min(1),
  nodeId: z.string().min(1).optional(),
  kind: scene3dReusableAssetKindSchema.optional(),
  query: z.string().trim().max(120).optional()
});

type Scene3DReusableAssetKind = z.infer<typeof scene3dReusableAssetKindSchema>;

const WORKFLOW_MEDIA_MAX_ITEMS = Number(process.env.WORKFLOW_MEDIA_MAX_ITEMS || 6);
const WORKFLOW_MEDIA_URL_MAX_LENGTH = Number(process.env.WORKFLOW_MEDIA_URL_MAX_LENGTH || 2048);
const IMAGE_GENERATION_TIMEOUT_MS = Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 180000);
const SCENE3D_IMPORT_TIMEOUT_MS = Number(process.env.SCENE3D_IMPORT_TIMEOUT_MS || 90000);
const SCENE3D_IMPORT_MAX_IMAGE_BYTES = Number(process.env.SCENE3D_IMPORT_MAX_IMAGE_BYTES || 8 * 1024 * 1024);
const SCENE3D_MOTION_REFINE_MAX_IMAGE_BYTES = Number(process.env.SCENE3D_MOTION_REFINE_MAX_IMAGE_BYTES || 3 * 1024 * 1024);
const SCENE3D_POSE_REFERENCE_MAX_IMAGE_BYTES = Number(process.env.SCENE3D_POSE_REFERENCE_MAX_IMAGE_BYTES || 4 * 1024 * 1024);
const SCENE3D_DIRECTOR_TIMEOUT_MS = Number(process.env.SCENE3D_DIRECTOR_TIMEOUT_MS || 90000);
const SCENE3D_MOTION_REFINE_TIMEOUT_MS = Number(process.env.SCENE3D_MOTION_REFINE_TIMEOUT_MS || 90000);
const SCENE3D_POSE_REFERENCE_TIMEOUT_MS = Number(process.env.SCENE3D_POSE_REFERENCE_TIMEOUT_MS || 90000);
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
    providerCode: error?.details?.code || null,
    providerMessage: error?.details?.message || null,
    status: error?.response?.status || null,
    httpStatus: error?.status || null,
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

function stripJsonMarkdown(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) return trimmed.slice(firstObject, lastObject + 1);
  return trimmed;
}

function parseScene3DImportJson(raw: string): Scene3DImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonMarkdown(raw));
  } catch (error: any) {
    throw new HttpError(502, "Scene3D import model returned invalid JSON.", "SCENE3D_IMPORT_INVALID_JSON", {
      parseError: error?.message || "Invalid JSON"
    });
  }

  const validation = scene3dImportResultSchema.safeParse(parsed);
  if (!validation.success) {
    throw new HttpError(502, "Scene3D import model output failed schema validation.", "SCENE3D_IMPORT_SCHEMA_INVALID", {
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return validation.data;
}

function parseScene3DImportRequest(body: unknown) {
  const validation = scene3dImportRequestSchema.safeParse(body || {});
  if (!validation.success) {
    throw new HttpError(400, "Invalid Scene3D import request.", "SCENE3D_IMPORT_REQUEST_INVALID", {
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return validation.data;
}

function parseScene3DDirectorJson(raw: string): Scene3DDirectorPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonMarkdown(raw));
  } catch (error: any) {
    throw new HttpError(502, "Scene3D director model returned invalid JSON.", "SCENE3D_DIRECTOR_INVALID_JSON", {
      parseError: error?.message || "Invalid JSON"
    });
  }

  const validation = scene3dDirectorPlanSchema.safeParse(parsed);
  if (!validation.success) {
    throw new HttpError(502, "Scene3D director model output failed schema validation.", "SCENE3D_DIRECTOR_SCHEMA_INVALID", {
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return validation.data;
}

function parseScene3DDirectorRequest(body: unknown): Scene3DDirectorRequest {
  const validation = scene3dDirectorRequestSchema.safeParse(body || {});
  if (!validation.success) {
    throw new HttpError(400, "Invalid Scene3D director request.", "SCENE3D_DIRECTOR_REQUEST_INVALID", {
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return validation.data;
}

function parseScene3DMotionRefineRequest(body: unknown): Scene3DMotionRefineRequest {
  const validation = scene3dMotionRefineRequestSchema.safeParse(body || {});
  if (!validation.success) {
    throw new HttpError(400, "Invalid Scene3D motion refinement request.", "SCENE3D_MOTION_REFINE_REQUEST_INVALID", {
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return validation.data;
}

function parseScene3DPoseReferenceSolveRequest(body: unknown): Scene3DPoseReferenceSolveRequest {
  const validation = scene3dPoseReferenceSolveRequestSchema.safeParse(body || {});
  if (!validation.success) {
    throw new HttpError(400, "Invalid Scene3D pose reference solve request.", "SCENE3D_POSE_REFERENCE_REQUEST_INVALID", {
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return validation.data;
}

function parseScene3DMotionIntentJson(raw: string, request: Scene3DMotionRefineRequest): Scene3DMotionIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonMarkdown(raw));
  } catch (error: any) {
    throw new HttpError(502, "Scene3D motion intent model returned invalid JSON.", "SCENE3D_MOTION_REFINE_INVALID_JSON", {
      parseError: error?.message || "Invalid JSON"
    });
  }

  const coerced = coerceScene3DMotionIntent(parsed, request);
  const validation = scene3dMotionIntentSchema.safeParse(coerced);
  if (!validation.success) {
    throw new HttpError(502, "Scene3D motion intent output failed schema validation.", "SCENE3D_MOTION_REFINE_SCHEMA_INVALID", {
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  const intent = validation.data;
  const issues: Array<{ path: string; message: string }> = [];
  const objectIds = new Set<string>();
  for (const item of request.props as any[]) if (typeof item?.id === "string") objectIds.add(item.id);
  for (const item of request.cameras as any[]) if (typeof item?.id === "string") objectIds.add(item.id);

  if (Math.abs(intent.durationSec - request.durationSec) > 0.001) {
    issues.push({ path: "durationSec", message: "durationSec must match request durationSec" });
  }
  if (intent.targetObjectId && !objectIds.has(intent.targetObjectId)) {
    issues.push({ path: "targetObjectId", message: "targetObjectId does not exist in the compact Scene3D context" });
  }

  if (issues.length) {
    throw new HttpError(502, "Scene3D motion intent output failed semantic validation.", "SCENE3D_MOTION_REFINE_SEMANTIC_INVALID", { issues });
  }
  return intent;
}

function parseScene3DPoseReferenceJson(raw: string, request: Scene3DPoseReferenceSolveRequest): Scene3DPoseReferenceSolveResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonMarkdown(raw));
  } catch (error: any) {
    throw new HttpError(502, "Scene3D pose reference model returned invalid JSON.", "SCENE3D_POSE_REFERENCE_INVALID_JSON", {
      parseError: error?.message || "Invalid JSON"
    });
  }

  const validation = scene3dPoseReferenceSolveResultSchema.safeParse(parsed);
  if (!validation.success) {
    throw new HttpError(502, "Scene3D pose reference output failed schema validation.", "SCENE3D_POSE_REFERENCE_SCHEMA_INVALID", {
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  const result = validation.data;
  const requestedViews = new Set(request.referenceImages.map((image) => image.view));
  const invalidViews = result.appliedViews.filter((view) => !requestedViews.has(view));
  if (invalidViews.length) {
    throw new HttpError(502, "Scene3D pose reference output failed semantic validation.", "SCENE3D_POSE_REFERENCE_SEMANTIC_INVALID", {
      issues: invalidViews.map((view) => ({ path: "appliedViews", message: `applied view was not provided: ${view}` }))
    });
  }
  return result;
}

function parseScene3DReusableAssetSave(body: unknown) {
  const validation = scene3dReusableAssetSaveSchema.safeParse(body || {});
  if (!validation.success) {
    throw new HttpError(400, "Invalid Scene3D reusable asset save request.", "SCENE3D_ASSET_SAVE_INVALID", {
      issues: validation.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
  }
  return validation.data;
}

function firstScene3DQueryString(value: unknown) {
  if (Array.isArray(value)) return firstScene3DQueryString(value[0]);
  if (typeof value === "string") return value;
  return undefined;
}

function parseScene3DReusableAssetList(query: unknown) {
  const rawQuery = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const validation = scene3dReusableAssetListSchema.safeParse({
    projectId: firstScene3DQueryString(rawQuery.projectId),
    nodeId: firstScene3DQueryString(rawQuery.nodeId),
    kind: firstScene3DQueryString(rawQuery.kind),
    query: firstScene3DQueryString(rawQuery.query)
  });
  if (!validation.success) {
    throw new HttpError(400, "Invalid Scene3D reusable asset list request.", "SCENE3D_ASSET_LIST_INVALID", {
      issues: validation.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
  }
  return validation.data;
}

function validateScene3DReusableAssetPayload(kind: Scene3DReusableAssetKind, payload: Record<string, any>) {
  const issues: Array<{ path: string; message: string }> = [];
  if (kind === "actionClip") {
    if (!payload.actionClip || typeof payload.actionClip !== "object") issues.push({ path: "payload.actionClip", message: "actionClip payload is required" });
    if (!Array.isArray(payload.boneKeyframes) || payload.boneKeyframes.length < 1) issues.push({ path: "payload.boneKeyframes", message: "boneKeyframes must contain at least one item" });
    if (typeof payload.skeletonType !== "string") issues.push({ path: "payload.skeletonType", message: "skeletonType is required" });
  }
  if (kind === "cameraMove") {
    if (!Array.isArray(payload.cameraPath) || payload.cameraPath.length < 2) issues.push({ path: "payload.cameraPath", message: "cameraPath must contain at least two points" });
    if (!Number.isFinite(Number(payload.durationSec))) issues.push({ path: "payload.durationSec", message: "durationSec is required" });
  }
  if (kind === "directorTemplate") {
    if (!payload.actionPlan || typeof payload.actionPlan !== "object") issues.push({ path: "payload.actionPlan", message: "actionPlan payload is required" });
    if (!Array.isArray(payload.keyframes) || payload.keyframes.length < 1) issues.push({ path: "payload.keyframes", message: "keyframes are required" });
  }
  if (kind === "posePresetMemory") {
    if (typeof payload.presetId !== "string" || !payload.presetId.trim()) issues.push({ path: "payload.presetId", message: "presetId is required" });
    if (!payload.rigPose || typeof payload.rigPose !== "object") issues.push({ path: "payload.rigPose", message: "rigPose payload is required" });
    if (!payload.characterModel || typeof payload.characterModel !== "object") issues.push({ path: "payload.characterModel", message: "characterModel payload is required" });
  }
  if (issues.length) throw new HttpError(400, "Scene3D reusable asset payload is invalid.", "SCENE3D_ASSET_PAYLOAD_INVALID", { issues });
}

function serializeScene3DReusableAsset(asset: any) {
  const sourceType = String(asset.sourceType || "");
  const kind = (Object.entries(scene3dReusableAssetSourceType).find(([, value]) => value === sourceType)?.[0] || "actionClip") as Scene3DReusableAssetKind;
  return {
    id: asset.id,
    projectId: asset.projectId,
    kind,
    sourceType,
    name: asset.displayName || asset.originalName,
    description: asset.description || "",
    reviewStatus: asset.reviewStatus,
    scope: asset.scope,
    sourcePayload: asset.sourcePayload || null,
    metadata: asset.metadata || null,
    createdAt: asset.createdAt?.toISOString?.() || asset.createdAt,
    updatedAt: asset.updatedAt?.toISOString?.() || asset.updatedAt
  };
}

function compactJson(value: unknown, maxChars = 12000) {
  let text = "";
  try {
    text = JSON.stringify(value, (_key, item) => {
      if (typeof item === "string" && item.length > 1000) return `${item.slice(0, 1000)}...`;
      return item;
    }, 2);
  } catch {
    text = "";
  }
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.25));
  return `${head}\n\n[Scene context truncated]\n\n${tail}`;
}

function scene3dImportSystemPrompt() {
  return [
    "You are a professional 3D previs director for a node-based film production canvas.",
    "Analyze the attached reference image and produce a compact structured JSON scene plan.",
    "Return JSON only. Do not return Markdown, comments, prose outside JSON, or trailing commas.",
    "Use metric-like 3D coordinates suitable for a simple humanoid blocking scene.",
    "Do not invent exact identities. Use visual role hints only.",
    "Colors must be #RRGGBB strings or null. FOV must be between 12 and 120.",
    "The JSON object must exactly match this TypeScript shape:",
    `{
  "summary": "string",
  "background": {
    "type": "color | panorama | image_reference",
    "suggestedColor": "#RRGGBB | null",
    "referenceAssetId": "string | null",
    "referenceUrl": "string | null"
  },
  "characters": [{
    "name": "string",
    "roleHint": "string | null",
    "position": { "x": 0, "y": 0, "z": 0 },
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "scale": { "x": 1, "y": 1, "z": 1 },
    "color": "#RRGGBB | null",
    "posePreset": "standing | t_pose | walk | run | sitting | crouch | kneel | akimbo | thinking | fighting | waving | crossed_arms | phone | null"
  }],
  "cameras": [{
    "name": "string",
    "position": { "x": 0, "y": 2, "z": 5 },
    "targetPosition": { "x": 0, "y": 1, "z": 0 },
    "fov": 45,
    "shotType": "string | null",
    "framingHint": "string | null"
  }],
  "composition": {
    "aspectRatio": "16:9",
    "guideEnabled": true,
    "notes": ["string"]
  }
}`
  ].join("\n");
}

function scene3dDirectorSystemPrompt() {
  return [
    "You are an AI director and 3D previs blocking planner for a node-based film production canvas.",
    "Generate a structured director plan that can be applied to a 3D timeline. Do not generate video, images, URLs, assets, or fake progress.",
    "Return JSON only. Do not return Markdown, comments, prose outside JSON, or trailing commas.",
    "Use metric-like coordinates in meters. Rotation values are degrees. FOV is degrees from 12 to 120.",
    "Respect existing character and camera ids/names when provided. If a character is not mentioned, keep them stable unless the user description clearly needs motion.",
    "Keyframes must be sorted by timeMs and include at least one frame at 0 and one at durationMs.",
    "The JSON object must exactly match this TypeScript shape:",
    `{
  "version": 1,
  "title": "string",
  "durationMs": 5000,
  "aspectRatio": "16:9",
  "summary": "string",
  "shots": [{
    "id": "shot_1",
    "title": "string",
    "startMs": 0,
    "endMs": 2000,
    "description": "string",
    "cameraId": "existing camera id or null",
    "cameraName": "camera display name or null",
    "framing": "string or null",
    "action": "string or null",
    "cameraMove": "string or null"
  }],
  "keyframes": [{
    "id": "kf_0",
    "label": "0s setup",
    "shotId": "shot_1",
    "timeMs": 0,
    "easing": "linear | ease_in | ease_out | ease_in_out",
    "camera": {
      "cameraId": "existing camera id or null",
      "cameraName": "camera display name or null",
      "position": { "x": 4, "y": 2.2, "z": 5 },
      "targetPosition": { "x": 0, "y": 1, "z": 0 },
      "fov": 45
    },
    "characters": [{
      "characterId": "existing character id or null",
      "characterName": "character display name or null",
      "position": { "x": 0, "y": 0, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale": { "x": 1, "y": 1, "z": 1 },
      "uniformScale": 1,
      "posePreset": "standing | t_pose | walk | run | sitting | crouch | kneel | akimbo | thinking | fighting | waving | crossed_arms | phone | null",
      "poseParams": {},
      "actionHint": "string or null"
    }]
  }],
  "motionSegments": [{
    "id": "motion_1",
    "shotId": "shot_1",
    "startMs": 0,
    "endMs": 2000,
    "characterId": "existing character id or null",
    "characterName": "character display name or null",
    "description": "string",
    "actionStyle": "string or null",
    "fromKeyframeId": "kf_0",
    "toKeyframeId": "kf_1"
  }],
  "cameraPath": [{
    "id": "cam_path_0",
    "shotId": "shot_1",
    "cameraId": "existing camera id or null",
    "cameraName": "camera display name or null",
    "timeMs": 0,
    "position": { "x": 4, "y": 2.2, "z": 5 },
    "targetPosition": { "x": 0, "y": 1, "z": 0 },
    "fov": 45
  }],
  "characterRelations": [{
    "id": "rel_1",
    "type": "look_at | follow | keep_distance | face_each_other | circle_around | avoid",
    "sourceCharacterId": "existing character id",
    "targetCharacterId": "existing character id",
    "enabled": true,
    "distance": 1.2,
    "radius": 1.6,
    "strength": 0.75,
    "startSec": 0,
    "endSec": 2,
    "notes": "string",
    "source": "ai"
  }],
  "interactionClips": [{
    "id": "interaction_1",
    "type": "handshake | handoff | dialogue_blocking | chase | fight_basic | custom",
    "label": "string",
    "participantIds": ["existing character id A", "existing character id B"],
    "startSec": 0,
    "endSec": 2,
    "description": "string",
    "relationIds": ["rel_1"],
    "syncMarkerIds": ["sync_1"],
    "source": "ai"
  }],
  "syncMarkers": [{
    "id": "sync_1",
    "label": "string",
    "timeSec": 1.0,
    "trigger": "time | arrive_position | pose_reached | clip_end",
    "sourceCharacterId": "existing character id A",
    "targetCharacterId": "existing character id B",
    "action": "start_clip | hold | look_at | face_each_other",
    "linkedInteractionClipId": "interaction_1",
    "notes": "string"
  }],
  "sceneLights": [{
    "id": "light_key",
    "name": "Key light",
    "lightType": "ambient | directional | point | spot | area",
    "enabled": true,
    "visible": true,
    "locked": false,
    "color": "#RRGGBB",
    "intensity": 1.5,
    "position": { "x": 2, "y": 3, "z": 2 },
    "targetPosition": { "x": 0, "y": 1, "z": 0 },
    "distance": 12,
    "decay": 2,
    "angle": 0.5,
    "penumbra": 0.25,
    "width": 2,
    "height": 2,
    "castShadow": true,
    "helperVisible": true
  }],
  "environmentMood": {
    "skyColor": "#RRGGBB",
    "horizonColor": "#RRGGBB",
    "groundColor": "#RRGGBB",
    "backgroundType": "color | gradient | panorama | hdri",
    "environmentIntensity": 1,
    "fogEnabled": false,
    "fogColor": "#RRGGBB",
    "fogNear": 12,
    "fogFar": 70,
    "exposure": 1,
    "toneMapping": "none | linear | reinhard | aces",
    "moodPreset": "string",
    "weatherHint": "clear | cloudy | rainy | foggy | snowy | night",
    "timeOfDay": "dawn | morning | noon | golden_hour | dusk | night"
  },
  "materialDirectives": [{
    "id": "mat_scene",
    "targetType": "character | object | scene",
    "targetId": "existing target id or scene",
    "color": "#RRGGBB",
    "emissiveColor": "#RRGGBB",
    "emissiveIntensity": 0,
    "roughness": 0.7,
    "metalness": 0,
    "opacity": 1,
    "transparent": false,
    "styleTag": "realistic_skin | metal | glass | fabric | plastic | emissive_screen | wet_surface",
    "enabled": true
  }],
  "visualKeyframes": [{
    "id": "visual_0",
    "atMs": 0,
    "targetType": "light | environment | material",
    "targetId": "light_key or mat_scene",
    "lightPatch": { "intensity": 1.5, "color": "#RRGGBB" },
    "environmentPatch": { "skyColor": "#RRGGBB", "fogEnabled": false, "exposure": 1 },
    "materialPatch": { "roughness": 0.7, "metalness": 0 },
    "easing": "linear | ease_in | ease_out | ease_in_out",
    "note": "string"
  }],
  "moodPrompt": "string",
  "renderStylePrompt": "string",
  "warnings": ["string"]
}`
  ].join("\n");
}

function scene3dDirectorUserPrompt(input: { request: Scene3DDirectorRequest; node: any }) {
  const sceneContext = input.request.sceneContext || input.node?.scene3dState || {};
  return [
    `Director description: ${input.request.directorDescription}`,
    `Target duration: ${input.request.durationMs} ms.`,
    `Aspect ratio: ${input.request.aspectRatio}.`,
    `Camera style: ${input.request.cameraStyle || "not specified"}.`,
    `Action style: ${input.request.actionStyle || "not specified"}.`,
    `Keep current scene: ${input.request.keepCurrentScene}.`,
    `Allow new cameras: ${input.request.allowNewCameras}.`,
    `Allow character reposition: ${input.request.allowCharacterReposition}.`,
    "Current Scene3D context JSON follows. Use existing ids when possible:",
    compactJson(sceneContext, 16000),
    "Planning rules:",
    "- If allowNewCameras is false, reuse existing cameras only.",
    "- If allowCharacterReposition is false, keep character positions stable but you may change pose/action hints.",
    "- If keepCurrentScene is true, preserve existing background, characters, scale, and camera continuity.",
    "- Produce practical blocking keyframes suitable for linear interpolation in a simple 3D viewport.",
    "- For scenes with multiple characters, include characterRelations when one character should look at, follow, keep distance from, face, circle around, or avoid another.",
    "- Include interactionClips for coordinated multi-character actions such as handshake, handoff, dialogue blocking, chase, or fight_basic.",
    "- Include syncMarkers when one character's arrival, pose, clip end, or timeline time should trigger another character's action.",
    "- Include sceneLights, environmentMood, materialDirectives, visualKeyframes, moodPrompt, and renderStylePrompt when the description implies lighting, atmosphere, weather, time of day, color, material, or visual style.",
    "- Use existing Scene3D light/material ids from context when possible; otherwise create stable ids. Do not reference missing character/object ids in materialDirectives.",
    "- Visual keyframes must stay inside the requested duration and should align with shot/keyframe timing when lighting or atmosphere changes over time.",
    "- Keep characters at least 0.5 meters apart unless an interaction explicitly requires close contact; add warnings for likely overlaps, targetId mismatches, or timing conflicts.",
    "- Add warnings for assumptions, missing characters, or impossible requests."
  ].join("\n");
}

function scene3dMotionRefineSystemPrompt() {
  return [
    "You are a professional 3D character animation blocking assistant for a node-based film previs tool.",
    "Generate a lightweight MotionIntent only. Do not generate video, assets, URLs, fake progress, final animation clips, transform keyframes, bone keyframes, contact keyframes, or constraints.",
    "Return JSON only. Do not return Markdown, comments, prose outside JSON, or trailing commas.",
    "The local Scene3D compiler will generate positions, rotations, bone poses, contacts, and final animation samples.",
    "Start and end poses/transforms are hard constraints owned by the caller. Infer only the in-between motion semantics.",
    "This is not a template classification task. Do not restrict the solution to predefined actions; solve the general motion implied by the prompt.",
    "For unusual or underspecified actions, derive plausible universal body mechanics: direction, distance, rotation, roll, crouch, lift, lean, arm swing, contact hints, look target, and rhythm.",
    "Use normalized scalar strengths from 0 to 1 unless a field specifies degrees or world units.",
    "Direction is a horizontal world-space vector where X is left/right and Z is depth. Keep Y at 0 unless the intent truly needs vertical direction.",
    "The JSON object must exactly match this TypeScript shape:",
    `{
  "version": 1,
  "intent": "string",
  "durationSec": 2,
  "generatedMotionPrompt": "string",
  "direction": { "x": 1, "y": 0, "z": 0 },
  "distance": 0.4,
  "turnDeg": 90,
  "roll": 0,
  "crouch": 0.2,
  "verticalLift": 0,
  "bodyLean": { "x": 0.2, "y": 0, "z": 0 },
  "armSwing": 0.4,
  "rhythm": "slow | normal | fast | impact | perform",
  "contacts": ["leftFoot", "rightFoot"],
  "lookAt": "none | camera | object | point",
  "targetObjectId": "existing nearby object id when relevant",
  "warnings": ["string"],
  "confidence": 0.8
}`
  ].join("\n");
}

function scene3dMotionRefineUserPrompt(input: { request: Scene3DMotionRefineRequest; node: any }) {
  return [
    `Node id: ${input.request.nodeId}.`,
    `Transition id: ${input.request.transitionId}.`,
    `Selected character id: ${input.request.selectedCharacterId}.`,
    `Duration: ${input.request.durationSec}s.`,
    `Curve: ${input.request.curve}.`,
    `Active view mode: ${input.request.activeViewMode}.`,
    `Active camera id: ${input.request.activeCameraId || "not specified"}.`,
    `Coordinate system: ${input.request.coordinateSystemDescription}`,
    `Action prompt: ${input.request.actionPrompt}`,
    "Hard start/end summary from Scene3D state:",
    compactJson({
      startTransform: input.request.startTransform,
      endTransform: input.request.endTransform,
      startPose: input.request.startPose,
      endPose: input.request.endPose
    }, 5000),
    "Compact local context:",
    compactJson({
      currentCharacterTransform: input.request.currentCharacterTransform,
      constraints: input.request.constraints,
      cameras: input.request.cameras,
      props: input.request.props,
      viewportScreenshotAssetId: input.request.viewportScreenshotAssetId || null,
      referenceImageAssetId: input.request.referenceImageAssetId || null
    }, 5000),
    "Motion rules:",
    "- Do not return keyframes or bone rotations.",
    "- Convert the action prompt into compact universal motion parameters only.",
    "- Never fail just because the action does not match a known template.",
    "- If the action includes stepping, reaching, falling, rolling, jumping, looking, dodging, or recovering, express that through direction/distance/turnDeg/roll/crouch/verticalLift/bodyLean/armSwing/rhythm/contacts/lookAt.",
    "- If the prompt is underspecified, add warnings and choose conservative readable motion."
  ].join("\n");
}

function scene3dPoseReferenceSystemPrompt() {
  return [
    "You are a professional 3D character pose estimation adapter for a node-based film previs tool.",
    "Read the attached character pose reference image(s), estimate normalized human body landmarks first, then provide a conservative local rig pose.",
    "Return JSON only. Do not return Markdown, comments, prose outside JSON, or trailing commas.",
    "Do not invent a different skeleton. Use exactly the requested standard human rig joints.",
    "Rotations are degrees in local XYZ order. Keep values inside the provided joint ranges.",
    "poseLandmarks is the primary contract: use image-normalized coordinates where x=-1 is image left, x=1 is image right, y=-1 is top, y=1 is bottom, and optional depth is -1 toward camera / 1 away from camera.",
    "The frontend will deterministically compile poseLandmarks into the final RunningHub/Mixamo-compatible pose space, so landmarks must be spatially consistent even when the rigPose is conservative.",
    "If a limb is occluded or uncertain, infer conservatively from the available views and add a warning.",
    "Do not generate animation, motion clips, video, fake progress, or asset URLs.",
    "Use foundationHint if a provided foundationPoseHint is the right starting baseline; otherwise return the closest baseline with a low confidence and warning.",
    "The JSON object must exactly match this TypeScript shape, with every rigPose joint present:",
    `{
  "version": 1,
  "summary": "string",
  "poseLandmarks": {
    "version": 1,
    "sourceViews": ["front"],
    "coordinateSpace": "image-normalized",
    "points": {
      "nose": { "x": 0, "y": -0.8, "visible": 1, "depth": 0 },
      "leftShoulder": { "x": -0.25, "y": -0.35, "visible": 1, "depth": 0 },
      "rightShoulder": { "x": 0.25, "y": -0.35, "visible": 1, "depth": 0 },
      "leftElbow": { "x": -0.45, "y": 0, "visible": 1, "depth": 0 },
      "rightElbow": { "x": 0.45, "y": 0, "visible": 1, "depth": 0 },
      "leftWrist": { "x": -0.5, "y": 0.35, "visible": 1, "depth": 0 },
      "rightWrist": { "x": 0.5, "y": 0.35, "visible": 1, "depth": 0 },
      "leftHip": { "x": -0.18, "y": 0.25, "visible": 1, "depth": 0 },
      "rightHip": { "x": 0.18, "y": 0.25, "visible": 1, "depth": 0 },
      "leftKnee": { "x": -0.2, "y": 0.65, "visible": 1, "depth": 0 },
      "rightKnee": { "x": 0.2, "y": 0.65, "visible": 1, "depth": 0 },
      "leftAnkle": { "x": -0.2, "y": 0.95, "visible": 1, "depth": 0 },
      "rightAnkle": { "x": 0.2, "y": 0.95, "visible": 1, "depth": 0 }
    },
    "bodyFacing": 0,
    "torsoLean": { "x": 0, "y": 0, "z": 0 },
    "contacts": [{ "point": "leftFoot", "type": "ground", "confidence": 0.7 }],
    "confidence": 0.75
  },
  "foundationHint": {
    "id": "stand",
    "label": "standing",
    "confidence": 0.75,
    "reason": "string",
    "rootOffset": { "x": 0, "y": 0, "z": 0 }
  },
  "rigPose": {
    "pelvis": { "x": 0, "y": 0, "z": 0 },
    "chest": { "x": 0, "y": 0, "z": 0 },
    "neck": { "x": 0, "y": 0, "z": 0 },
    "head": { "x": 0, "y": 0, "z": 0 },
    "leftUpperArm": { "x": 0, "y": 0, "z": 0 },
    "leftLowerArm": { "x": 0, "y": 0, "z": 0 },
    "leftHand": { "x": 0, "y": 0, "z": 0 },
    "rightUpperArm": { "x": 0, "y": 0, "z": 0 },
    "rightLowerArm": { "x": 0, "y": 0, "z": 0 },
    "rightHand": { "x": 0, "y": 0, "z": 0 },
    "leftUpperLeg": { "x": 0, "y": 0, "z": 0 },
    "leftLowerLeg": { "x": 0, "y": 0, "z": 0 },
    "leftFoot": { "x": 0, "y": 0, "z": 0 },
    "rightUpperLeg": { "x": 0, "y": 0, "z": 0 },
    "rightLowerLeg": { "x": 0, "y": 0, "z": 0 },
    "rightFoot": { "x": 0, "y": 0, "z": 0 }
  },
  "rootOffset": { "x": 0, "y": 0, "z": 0 },
  "confidence": 0.75,
  "warnings": ["string"],
  "appliedViews": ["front"]
}`
  ].join("\n");
}

function scene3dPoseReferenceUserPrompt(input: { request: Scene3DPoseReferenceSolveRequest; node: any }) {
  return [
    `Node id: ${input.request.nodeId}.`,
    `Selected character id: ${input.request.selectedCharacterId}.`,
    `Reference views: ${input.request.referenceImages.map((image) => `${image.view}:${image.assetId}`).join(", ")}.`,
    `Coordinate system: ${input.request.coordinateSystemDescription}`,
    "Current character transform:",
    compactJson(input.request.currentCharacterTransform || {}, 1500),
    "Current rig pose baseline:",
    compactJson(input.request.currentPose, 4000),
    "Foundation pose baseline hint:",
    compactJson(input.request.foundationPoseHint || {}, 5000),
    "Current detailed bone pose, if available:",
    compactJson(input.request.currentBonePose || {}, 5000),
    "Joint axis profile and semantic meanings:",
    compactJson(input.request.jointAxisProfile, 9000),
    "Solve rules:",
    "- Estimate the static pose only, not an action transition.",
    "- First solve poseLandmarks from the image: shoulders, elbows, wrists, hips, knees, ankles, head/nose, optional toes and contacts.",
    "- Then provide a conservative rigPose. The frontend will prefer poseLandmarks for deterministic spatial compilation and use rigPose as fallback.",
    "- The final rigPose must include all 16 standard joints.",
    "- Keep the returned foundationHint aligned with the provided foundationPoseHint unless the image clearly contradicts it.",
    "- Use front view for left/right spread and shoulder/hip alignment.",
    "- Use side view for forward/back depth, bends, and body lean.",
    "- Use back view for torso twist and occlusion correction.",
    "- If only one view is provided, solve the visible axes and infer hidden axes conservatively.",
    "- Use warnings for occlusion, missing views, ambiguity, or non-human reference issues.",
    "- appliedViews must contain only views actually provided in this request."
  ].join("\n");
}

function validateScene3DMotionRequestAgainstContext(request: Scene3DMotionRefineRequest, node: any) {
  const sceneContext = node?.scene3dState;
  const characters = Array.isArray(sceneContext?.characters)
    ? sceneContext.characters
    : Array.isArray(sceneContext?.objects?.characters)
      ? sceneContext.objects.characters
      : [];
  const targetExists = characters.some((character: any) => character?.id === request.selectedCharacterId);
  const issues: Array<{ path: string; message: string }> = [];
  const transitions = Array.isArray(sceneContext?.poseTransitions) ? sceneContext.poseTransitions : [];
  const transition = transitions.find((item: any) => item?.id === request.transitionId);
  if (!targetExists) issues.push({ path: "selectedCharacterId", message: "selectedCharacterId does not exist in Scene3D context" });
  if (transitions.length && !transition) issues.push({ path: "transitionId", message: "transitionId does not exist in Scene3D context" });
  if (transition && transition.characterId !== request.selectedCharacterId) {
    issues.push({ path: "transitionId", message: "transition does not belong to selectedCharacterId" });
  }
  if (!request.startTransform || !request.endTransform) issues.push({ path: "startTransform", message: "startTransform and endTransform are required" });
  if (!request.startPose || !request.endPose) issues.push({ path: "startPose", message: "startPose and endPose are required" });
  if (issues.length) {
    throw new HttpError(400, "Scene3D motion refinement context is invalid.", "SCENE3D_MOTION_REFINE_CONTEXT_INVALID", { issues });
  }
}

function validateScene3DPoseReferenceRequestAgainstContext(request: Scene3DPoseReferenceSolveRequest, node: any) {
  const sceneContext = node?.scene3dState;
  const characters = Array.isArray(sceneContext?.characters)
    ? sceneContext.characters
    : Array.isArray(sceneContext?.objects?.characters)
      ? sceneContext.objects.characters
      : [];
  const targetExists = characters.some((character: any) => character?.id === request.selectedCharacterId);
  const issues: Array<{ path: string; message: string }> = [];
  if (!targetExists) issues.push({ path: "selectedCharacterId", message: "selectedCharacterId does not exist in Scene3D context" });
  const seenViews = new Set<string>();
  for (const reference of request.referenceImages) {
    if (seenViews.has(reference.view)) issues.push({ path: "referenceImages", message: `duplicate reference view: ${reference.view}` });
    seenViews.add(reference.view);
  }
  if (issues.length) {
    throw new HttpError(400, "Scene3D pose reference context is invalid.", "SCENE3D_POSE_REFERENCE_CONTEXT_INVALID", { issues });
  }
}

function scene3dImportUserPrompt(input: { mode: "new_scene" | "merge"; referenceAssetId: string; referenceUrl: string }) {
  return [
    `Import mode: ${input.mode}.`,
    `Use this image asset as the reference background when useful: ${input.referenceAssetId}.`,
    `The protected stream URL is: ${input.referenceUrl}.`,
    "Infer only elements visible or strongly implied by the image.",
    "For a new scene, include a coherent baseline scene. For merge, include only useful additions or corrections.",
    "Place characters around y=0 ground level. Use rotation in degrees. Use scale around 1 unless the subject is visually large or small.",
    "Always include at least one camera matching the image framing."
  ].join("\n");
}

function assertScene3DNodeShape(node: any, nodeId: string) {
  if (!node || node.id !== nodeId) throw new HttpError(404, "Scene3D node was not found in this workflow.", "SCENE3D_NODE_NOT_FOUND");
  const type = String(node.type || "");
  if (type !== "scene3d" && type !== "3D导演台") {
    throw new HttpError(400, "Selected node is not a Scene3D director node.", "SCENE3D_NODE_TYPE_INVALID", { nodeType: type || null });
  }
}

async function assertScene3DWorkflowNode(input: { workflowId?: string; projectId?: string; nodeId: string; requestUser: RequestUser; fallbackNode?: any }) {
  if (input.projectId) await ensureProjectMember(input.projectId, input.requestUser);
  const workflowName = input.projectId ? `canvas-state:${input.requestUser.id}:${input.projectId}` : undefined;
  const workflow = await prisma.workflow.findFirst({
    where: input.workflowId
      ? { id: input.workflowId, ownerId: input.requestUser.id }
      : { name: workflowName, ownerId: input.requestUser.id },
    include: {
      versions: {
        where: { version: 1 },
        take: 1
      }
    }
  });
  if (!workflow) {
    if (input.fallbackNode) {
      assertScene3DNodeShape(input.fallbackNode, input.nodeId);
      return { workflow: null, node: input.fallbackNode };
    }
    throw new HttpError(404, "Workflow not found.", "WORKFLOW_NOT_FOUND");
  }
  const canvas = workflow.versions?.[0]?.reactFlowJson as any;
  const nodes = [
    ...(Array.isArray(canvas?.nodes) ? canvas.nodes : []),
    ...(Array.isArray(canvas?.shotNodes) ? canvas.shotNodes : [])
  ];
  const node = nodes.find((item: any) => item?.id === input.nodeId) || input.fallbackNode;
  assertScene3DNodeShape(node, input.nodeId);
  return { workflow, node };
}

async function resolveScene3DImportImage(input: { imageAssetId: string; requestUser: RequestUser }) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: input.imageAssetId } });
  if (!asset || !canReadMediaAsset(input.requestUser, asset)) {
    throw new HttpError(404, "Image asset not found or not accessible.", "MEDIA_ASSET_NOT_ACCESSIBLE", { assetId: input.imageAssetId });
  }
  const mimeType = asset.mimeType || "";
  if (!mimeType.startsWith("image/")) {
    throw new HttpError(400, "Scene3D import requires an image asset.", "SCENE3D_IMPORT_IMAGE_REQUIRED", { assetId: input.imageAssetId, mimeType });
  }
  if (!asset.storageKey) {
    throw new HttpError(400, "Image asset has no local storage reference.", "MEDIA_ASSET_STORAGE_KEY_REQUIRED", { assetId: input.imageAssetId });
  }
  const filePath = resolveLocalUploadPath(asset.storageKey || "");
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error: any) {
    throw new HttpError(404, "Image asset file could not be read from storage.", "MEDIA_ASSET_FILE_UNREADABLE", {
      assetId: input.imageAssetId,
      reason: error?.code || error?.message || "unknown"
    });
  }
  if (bytes.length > SCENE3D_IMPORT_MAX_IMAGE_BYTES) {
    throw new HttpError(413, "Scene3D import image is too large.", "SCENE3D_IMPORT_IMAGE_TOO_LARGE", {
      maxBytes: SCENE3D_IMPORT_MAX_IMAGE_BYTES,
      bytes: bytes.length
    });
  }
  return {
    asset,
    base64: bytes.toString("base64"),
    mimeType,
    referenceUrl: protectedMediaUrl(asset.id)
  };
}

function scene3DTextRuntimeSupportsImageAttachments(textCapabilities: any) {
  if (!textCapabilities?.controls?.attachments) return false;
  const prefixes = Array.isArray(textCapabilities.supportedAttachmentMimePrefixes)
    ? textCapabilities.supportedAttachmentMimePrefixes
    : [];
  return prefixes.length === 0 || prefixes.some((prefix: string) => {
    const value = String(prefix || "").toLowerCase();
    return value === "image" || value === "image/" || value.startsWith("image/");
  });
}

function scene3DImageMimeSupported(mimeType: string, supportedPrefixes: any[]) {
  const mime = String(mimeType || "").toLowerCase();
  if (!mime.startsWith("image/")) return false;
  if (!Array.isArray(supportedPrefixes) || supportedPrefixes.length === 0) return true;
  return supportedPrefixes.some((prefix: string) => {
    const value = String(prefix || "").toLowerCase();
    return value === "image" || value === "image/" || mime === value || (value.endsWith("/") && mime.startsWith(value));
  });
}

async function resolveScene3DMotionAttachment(input: {
  request: Scene3DMotionRefineRequest;
  requestUser: RequestUser;
  textCapabilities: any;
}): Promise<ProviderAttachment[]> {
  if (!scene3DTextRuntimeSupportsImageAttachments(input.textCapabilities)) return [];
  const assetId = input.request.viewportScreenshotAssetId || input.request.referenceImageAssetId;
  if (!assetId) return [];
  const maxCount = input.textCapabilities?.limits?.maxAttachmentCount;
  if (Number.isFinite(Number(maxCount)) && Number(maxCount) < 1) return [];
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || !canReadMediaAsset(input.requestUser, asset)) {
    throw new HttpError(404, "Scene3D motion reference image not found or not accessible.", "MEDIA_ASSET_NOT_ACCESSIBLE", { assetId });
  }
  const mimeType = asset.mimeType || "";
  const supportedPrefixes = Array.isArray(input.textCapabilities?.supportedAttachmentMimePrefixes)
    ? input.textCapabilities.supportedAttachmentMimePrefixes
    : ["image/"];
  if (!scene3DImageMimeSupported(mimeType, supportedPrefixes)) {
    throw new HttpError(400, "Scene3D motion reference must be an image supported by the selected text model.", "SCENE3D_MOTION_REFINE_IMAGE_UNSUPPORTED", { assetId, mimeType });
  }
  const filePath = resolveMediaAssetPath(asset);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error: any) {
    throw new HttpError(404, "Scene3D motion reference image could not be read from storage.", "MEDIA_ASSET_FILE_UNREADABLE", {
      assetId,
      reason: error?.code || error?.message || "unknown"
    });
  }
  const modelLimit = Number(input.textCapabilities?.limits?.maxAttachmentBytes || input.textCapabilities?.limits?.maxTotalAttachmentBytes || 0);
  const maxBytes = Math.min(
    SCENE3D_MOTION_REFINE_MAX_IMAGE_BYTES,
    Number.isFinite(modelLimit) && modelLimit > 0 ? modelLimit : SCENE3D_MOTION_REFINE_MAX_IMAGE_BYTES
  );
  if (bytes.length > maxBytes) {
    throw new HttpError(413, "Scene3D motion reference image is too large for the selected text model.", "SCENE3D_MOTION_REFINE_IMAGE_TOO_LARGE", {
      assetId,
      maxBytes,
      bytes: bytes.length
    });
  }
  return [{
    mimeType,
    data: bytes.toString("base64"),
    name: asset.originalName || asset.title || "scene3d-motion-reference"
  }];
}

async function resolveScene3DPoseReferenceAttachments(input: {
  request: Scene3DPoseReferenceSolveRequest;
  requestUser: RequestUser;
  textCapabilities: any;
}): Promise<ProviderAttachment[]> {
  if (!scene3DTextRuntimeSupportsImageAttachments(input.textCapabilities)) {
    throw new HttpError(400, "Selected Scene3D pose reference model does not support image attachments.", "SCENE3D_POSE_REFERENCE_MODEL_NO_IMAGE_INPUT");
  }
  const maxCount = Number(input.textCapabilities?.limits?.maxAttachmentCount || input.request.referenceImages.length);
  if (Number.isFinite(maxCount) && maxCount > 0 && input.request.referenceImages.length > maxCount) {
    throw new HttpError(400, "Too many Scene3D pose reference images for the selected model.", "SCENE3D_POSE_REFERENCE_TOO_MANY_IMAGES", {
      maxCount,
      count: input.request.referenceImages.length
    });
  }
  const supportedPrefixes = Array.isArray(input.textCapabilities?.supportedAttachmentMimePrefixes)
    ? input.textCapabilities.supportedAttachmentMimePrefixes
    : ["image/"];
  const modelLimit = Number(input.textCapabilities?.limits?.maxAttachmentBytes || input.textCapabilities?.limits?.maxTotalAttachmentBytes || 0);
  const maxBytes = Math.min(
    SCENE3D_POSE_REFERENCE_MAX_IMAGE_BYTES,
    Number.isFinite(modelLimit) && modelLimit > 0 ? modelLimit : SCENE3D_POSE_REFERENCE_MAX_IMAGE_BYTES
  );
  const attachments: ProviderAttachment[] = [];
  for (const reference of input.request.referenceImages) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: reference.assetId } });
    if (!asset || !canReadMediaAsset(input.requestUser, asset)) {
      throw new HttpError(404, "Scene3D pose reference image not found or not accessible.", "MEDIA_ASSET_NOT_ACCESSIBLE", { assetId: reference.assetId });
    }
    const mimeType = asset.mimeType || reference.mimeType || "";
    if (!scene3DImageMimeSupported(mimeType, supportedPrefixes)) {
      throw new HttpError(400, "Scene3D pose reference must be an image supported by the selected model.", "SCENE3D_POSE_REFERENCE_IMAGE_UNSUPPORTED", {
        assetId: reference.assetId,
        mimeType
      });
    }
    const filePath = resolveMediaAssetPath(asset);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(filePath);
    } catch (error: any) {
      throw new HttpError(404, "Scene3D pose reference image could not be read from storage.", "MEDIA_ASSET_FILE_UNREADABLE", {
        assetId: reference.assetId,
        reason: error?.code || error?.message || "unknown"
      });
    }
    if (bytes.length > maxBytes) {
      throw new HttpError(413, "Scene3D pose reference image is too large for the selected model.", "SCENE3D_POSE_REFERENCE_IMAGE_TOO_LARGE", {
        assetId: reference.assetId,
        maxBytes,
        bytes: bytes.length
      });
    }
    attachments.push({
      mimeType,
      data: bytes.toString("base64"),
      name: `${reference.view}-${asset.originalName || asset.title || reference.fileName || "pose-reference"}`
    });
  }
  return attachments;
}

async function selectScene3DTextRuntime(input: { requestUser: RequestUser; req: express.Request; source?: string }) {
  const configs = await prisma.customApiConfig.findMany({
    where: {
      capability: ModelCapability.TEXT_GENERATOR,
      type: "text",
      isEnabled: true,
      encryptedKey: { not: null },
      OR: [
        { ownerId: input.requestUser.id },
        { ownerId: null, userAccessEnabled: true },
        ...(input.requestUser.role === UserRole.ADMIN || input.requestUser.role === UserRole.DEVELOPER ? [{ ownerId: null }] : [])
      ]
    },
    orderBy: [{ updatedAt: "desc" }, { alias: "asc" }],
    take: 1
  });
  const config = configs[0];
  if (!config) return null;
  const runtime = await resolveCustomApiRuntimeConfig({
    useCustomApi: true,
    customConfigId: config.id,
    expectedCapability: ModelCapability.TEXT_GENERATOR,
    ownerId: input.requestUser.id,
    role: input.requestUser.role,
    audit: { actor: input.requestUser, req: input.req, source: input.source || "scene3d-import-image" }
  });
  if (!runtime.customUrl || !runtime.customKey || !runtime.customModel) return null;
  return { ...runtime, configId: config.id };
}

async function callScene3DImportModel(input: {
  requestUser: RequestUser;
  req: express.Request;
  mode: "new_scene" | "merge";
  imageAssetId: string;
  imageBase64: string;
  imageMimeType: string;
  referenceUrl: string;
  getAI: () => GoogleGenAI;
}) {
  const systemPrompt = scene3dImportSystemPrompt();
  const userPrompt = scene3dImportUserPrompt({
    mode: input.mode,
    referenceAssetId: input.imageAssetId,
    referenceUrl: input.referenceUrl
  });
  const runtime = await selectScene3DTextRuntime({ requestUser: input.requestUser, req: input.req });
  if (runtime) {
    try {
      const response = await callTextProvider({
        baseUrl: runtime.customUrl,
        apiKey: runtime.customKey,
        modelName: runtime.customModel,
        systemPrompt,
        userPrompt,
        attachments: [{
          mimeType: input.imageMimeType,
          data: input.imageBase64,
          name: "scene3d-import-reference"
        }],
        timeoutMs: SCENE3D_IMPORT_TIMEOUT_MS,
        maxOutputTokens: 4096,
        maxPromptChars: 12000,
        isRealtimeSpeed: false,
        temperature: 0.2,
        capabilities: runtime.textCapabilities
      });
      return response.text;
    } catch (error: any) {
      throw new HttpError(502, "Scene3D import AI provider request failed.", "SCENE3D_IMPORT_PROVIDER_FAILED", {
        provider: "custom",
        configId: runtime.configId,
        error: summarizeWorkflowError(error)
      });
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new HttpError(503, "No Scene3D import AI provider is configured.", "SCENE3D_IMPORT_AI_NOT_CONFIGURED");
  }
  const ai = input.getAI();
  try {
    const response = await ai.models.generateContent({
      model: process.env.SCENE3D_IMPORT_GEMINI_MODEL || "gemini-1.5-flash",
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: input.imageMimeType, data: input.imageBase64 } },
          { text: userPrompt }
        ]
      }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 4096
      }
    } as any);
    return String((response as any).text || "").trim();
  } catch (error: any) {
    throw new HttpError(502, "Scene3D import AI provider request failed.", "SCENE3D_IMPORT_PROVIDER_FAILED", {
      provider: "gemini",
      model: process.env.SCENE3D_IMPORT_GEMINI_MODEL || "gemini-1.5-flash",
      error: summarizeWorkflowError(error)
    });
  }
}

async function callScene3DDirectorModel(input: {
  requestUser: RequestUser;
  req: express.Request;
  request: Scene3DDirectorRequest;
  node: any;
  getAI: () => GoogleGenAI;
}) {
  const systemPrompt = scene3dDirectorSystemPrompt();
  const userPrompt = scene3dDirectorUserPrompt({ request: input.request, node: input.node });
  const runtime = await selectScene3DTextRuntime({ requestUser: input.requestUser, req: input.req, source: "scene3d-director-plan" });
  if (runtime) {
    try {
      const response = await callTextProvider({
        baseUrl: runtime.customUrl,
        apiKey: runtime.customKey,
        modelName: runtime.customModel,
        systemPrompt,
        userPrompt,
        timeoutMs: SCENE3D_DIRECTOR_TIMEOUT_MS,
        maxOutputTokens: 8192,
        maxPromptChars: 22000,
        isRealtimeSpeed: false,
        temperature: 0.35,
        capabilities: runtime.textCapabilities
      });
      return response.text;
    } catch (error: any) {
      throw new HttpError(502, "Scene3D director AI provider request failed.", "SCENE3D_DIRECTOR_PROVIDER_FAILED", {
        provider: "custom",
        configId: runtime.configId,
        error: summarizeWorkflowError(error)
      });
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new HttpError(503, "No Scene3D director AI provider is configured.", "SCENE3D_DIRECTOR_AI_NOT_CONFIGURED");
  }
  const ai = input.getAI();
  try {
    const response = await ai.models.generateContent({
      model: process.env.SCENE3D_DIRECTOR_GEMINI_MODEL || process.env.SCENE3D_IMPORT_GEMINI_MODEL || "gemini-1.5-flash",
      contents: [{
        role: "user",
        parts: [{ text: userPrompt }]
      }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        temperature: 0.35,
        maxOutputTokens: 8192
      }
    } as any);
    return String((response as any).text || "").trim();
  } catch (error: any) {
    throw new HttpError(502, "Scene3D director AI provider request failed.", "SCENE3D_DIRECTOR_PROVIDER_FAILED", {
      provider: "gemini",
      model: process.env.SCENE3D_DIRECTOR_GEMINI_MODEL || process.env.SCENE3D_IMPORT_GEMINI_MODEL || "gemini-1.5-flash",
      error: summarizeWorkflowError(error)
    });
  }
}

async function callScene3DMotionRefineModel(input: {
  requestUser: RequestUser;
  req: express.Request;
  request: Scene3DMotionRefineRequest;
  node: any;
  getAI: () => GoogleGenAI;
}) {
  const systemPrompt = scene3dMotionRefineSystemPrompt();
  const userPrompt = scene3dMotionRefineUserPrompt({ request: input.request, node: input.node });
  const runtime = await selectScene3DTextRuntime({ requestUser: input.requestUser, req: input.req, source: "scene3d-motion-refine" });
  if (!runtime) {
    throw new HttpError(503, "No Scene3D motion refinement text model is configured in the model center.", "SCENE3D_MOTION_REFINE_AI_NOT_CONFIGURED");
  }

  const attachments = await resolveScene3DMotionAttachment({
    request: input.request,
    requestUser: input.requestUser,
    textCapabilities: runtime.textCapabilities
  });
  const callProvider = (retryAttachments: ProviderAttachment[], retryLabel: "primary" | "text-only-retry") => callTextProvider({
    baseUrl: runtime.customUrl,
    apiKey: runtime.customKey,
    modelName: runtime.customModel,
    systemPrompt,
    userPrompt,
    attachments: retryAttachments,
    timeoutMs: SCENE3D_MOTION_REFINE_TIMEOUT_MS,
    maxOutputTokens: retryLabel === "primary" ? 1200 : 900,
    maxPromptChars: retryLabel === "primary" ? 12000 : 9000,
    isRealtimeSpeed: false,
    temperature: retryLabel === "primary" ? 0.25 : 0.15,
    capabilities: runtime.textCapabilities
  });
  try {
    const response = await callProvider(attachments, "primary");
    return response.text;
  } catch (error: any) {
    if (attachments.length > 0 || error?.status === 502 || error?.message === "Provider returned empty text.") {
      try {
        const retryResponse = await callProvider([], "text-only-retry");
        return retryResponse.text;
      } catch (retryError: any) {
        throw new HttpError(502, "Scene3D motion refinement AI provider request failed.", "SCENE3D_MOTION_REFINE_PROVIDER_FAILED", {
          provider: "custom",
          configId: runtime.configId,
          attachments: attachments.length,
          retry: "text-only",
          error: summarizeWorkflowError(retryError),
          firstError: summarizeWorkflowError(error)
        });
      }
    }
    throw new HttpError(502, "Scene3D motion refinement AI provider request failed.", "SCENE3D_MOTION_REFINE_PROVIDER_FAILED", {
      provider: "custom",
      configId: runtime.configId,
      attachments: attachments.length,
      error: summarizeWorkflowError(error)
    });
  }
}

async function callScene3DPoseReferenceModel(input: {
  requestUser: RequestUser;
  req: express.Request;
  request: Scene3DPoseReferenceSolveRequest;
  node: any;
}) {
  const systemPrompt = scene3dPoseReferenceSystemPrompt();
  const userPrompt = scene3dPoseReferenceUserPrompt({ request: input.request, node: input.node });
  const runtime = await selectScene3DTextRuntime({ requestUser: input.requestUser, req: input.req, source: "scene3d-pose-reference" });
  if (!runtime) {
    throw new HttpError(503, "No Scene3D pose reference text model is configured in the model center.", "SCENE3D_POSE_REFERENCE_AI_NOT_CONFIGURED");
  }
  const attachments = await resolveScene3DPoseReferenceAttachments({
    request: input.request,
    requestUser: input.requestUser,
    textCapabilities: runtime.textCapabilities
  });
  try {
    const response = await callTextProvider({
      baseUrl: runtime.customUrl,
      apiKey: runtime.customKey,
      modelName: runtime.customModel,
      systemPrompt,
      userPrompt,
      attachments,
      timeoutMs: SCENE3D_POSE_REFERENCE_TIMEOUT_MS,
      maxOutputTokens: 3600,
      maxPromptChars: 16000,
      isRealtimeSpeed: false,
      temperature: 0.1,
      capabilities: runtime.textCapabilities
    });
    return response.text;
  } catch (error: any) {
    throw new HttpError(502, "Scene3D pose reference AI provider request failed.", "SCENE3D_POSE_REFERENCE_PROVIDER_FAILED", {
      provider: "custom",
      configId: runtime.configId,
      attachments: attachments.length,
      error: summarizeWorkflowError(error)
    });
  }
}

async function importScene3DFromImage(req: express.Request, options: RegisterWorkflowExecuteRoutesOptions) {
  const requestUser = await requireAuth(req);
  const body = parseScene3DImportRequest(req.body);
  await assertScene3DWorkflowNode({ workflowId: body.workflowId, nodeId: body.nodeId, requestUser });
  const image = await resolveScene3DImportImage({ imageAssetId: body.imageAssetId, requestUser });
  const rawText = await callScene3DImportModel({
    requestUser,
    req,
    mode: body.mode,
    imageAssetId: body.imageAssetId,
    imageBase64: image.base64,
    imageMimeType: image.mimeType,
    referenceUrl: image.referenceUrl,
    getAI: options.getAI
  });
  if (!rawText.trim()) {
    throw new HttpError(502, "Scene3D import model returned empty output.", "SCENE3D_IMPORT_EMPTY_OUTPUT");
  }
  const parsed = parseScene3DImportJson(rawText);
  return {
    ...parsed,
    background: {
      ...parsed.background,
      referenceAssetId: parsed.background.referenceAssetId || body.imageAssetId,
      referenceUrl: parsed.background.referenceUrl || image.referenceUrl
    }
  };
}

async function planScene3DDirector(req: express.Request, options: RegisterWorkflowExecuteRoutesOptions) {
  const requestUser = await requireAuth(req);
  const body = parseScene3DDirectorRequest(req.body);
  const { node } = await assertScene3DWorkflowNode({ workflowId: body.workflowId, nodeId: body.nodeId, requestUser });
  const rawText = await callScene3DDirectorModel({
    requestUser,
    req,
    request: body,
    node,
    getAI: options.getAI
  });
  if (!rawText.trim()) {
    throw new HttpError(502, "Scene3D director model returned empty output.", "SCENE3D_DIRECTOR_EMPTY_OUTPUT");
  }
  return parseScene3DDirectorJson(rawText);
}

async function refineScene3DMotion(req: express.Request, options: RegisterWorkflowExecuteRoutesOptions) {
  const requestUser = await requireAuth(req);
  const body = parseScene3DMotionRefineRequest(req.body);
  const { node } = await assertScene3DWorkflowNode({ workflowId: body.workflowId, projectId: body.projectId, nodeId: body.nodeId, requestUser });
  validateScene3DMotionRequestAgainstContext(body, node);
  const rawText = await callScene3DMotionRefineModel({
    requestUser,
    req,
    request: body,
    node,
    getAI: options.getAI
  });
  if (!rawText.trim()) {
    throw new HttpError(502, "Scene3D motion intent model returned empty output.", "SCENE3D_MOTION_REFINE_EMPTY_OUTPUT");
  }
  return parseScene3DMotionIntentJson(rawText, body);
}

async function solveScene3DPoseReference(req: express.Request) {
  const requestUser = await requireAuth(req);
  const body = parseScene3DPoseReferenceSolveRequest(req.body);
  const fallbackNode = body.sceneContext
    ? { id: body.nodeId, type: "scene3d", scene3dState: body.sceneContext }
    : undefined;
  const { node } = await assertScene3DWorkflowNode({ workflowId: body.workflowId, projectId: body.projectId, nodeId: body.nodeId, requestUser, fallbackNode });
  validateScene3DPoseReferenceRequestAgainstContext(body, node);
  const rawText = await callScene3DPoseReferenceModel({
    requestUser,
    req,
    request: body,
    node
  });
  if (!rawText.trim()) {
    throw new HttpError(502, "Scene3D pose reference model returned empty output.", "SCENE3D_POSE_REFERENCE_EMPTY_OUTPUT");
  }
  return parseScene3DPoseReferenceJson(rawText, body);
}

async function saveScene3DReusableAsset(req: express.Request) {
  const requestUser = await requireAuth(req);
  const body = parseScene3DReusableAssetSave(req.body);
  await ensureProjectMember(body.projectId, requestUser);
  const fallbackNode = body.sceneContext
    ? { id: body.nodeId, type: "scene3d", scene3dState: body.sceneContext }
    : undefined;
  await assertScene3DWorkflowNode({ workflowId: body.workflowId, projectId: body.projectId, nodeId: body.nodeId, requestUser, fallbackNode });
  validateScene3DReusableAssetPayload(body.kind, body.payload);
  const sourceType = scene3dReusableAssetSourceType[body.kind];
  const sourcePayload = {
    version: 1,
    kind: body.kind,
    ...body.payload
  };
  const metadata = {
    scene3d: true,
    kind: body.kind,
    workflowId: body.workflowId,
    nodeId: body.nodeId
  };
  let asset: any;
  let auditAction: AuditAction = AuditAction.CREATE;

  if (body.kind === "posePresetMemory") {
    const existingAssets = await prisma.productionAsset.findMany({
      where: {
        projectId: body.projectId,
        stage: ProductionStage.SHOT_04,
        sourceType,
        sourceId: body.nodeId,
        deletedAt: null,
        archivedAt: null
      },
      orderBy: { updatedAt: "desc" },
      take: 100
    });
    const samePresetAssets = existingAssets.filter((item: any) => {
      const payload = item.sourcePayload || {};
      return typeof payload?.presetId === "string" && payload.presetId === body.payload.presetId;
    });
    const existing = samePresetAssets.find((item: any) => item.scope === ProductionAssetScope.TEAM) || samePresetAssets[0];
    if (existing) {
      asset = await prisma.productionAsset.update({
        where: { id: existing.id },
        data: {
          scope: ProductionAssetScope.TEAM,
          reviewStatus: ProductionAssetReviewStatus.APPROVED,
          creatorId: requestUser.id,
          originalName: body.name,
          displayName: body.name,
          description: body.description || null,
          mimeType: "application/json",
          sourcePayload,
          metadata
        }
      });
      const duplicateIds = samePresetAssets.map((item: any) => item.id).filter((id: string) => id !== existing.id);
      if (duplicateIds.length) {
        await prisma.productionAsset.updateMany({
          where: { id: { in: duplicateIds } },
          data: { archivedAt: new Date() }
        });
      }
      auditAction = AuditAction.UPDATE;
    }
  }

  if (!asset) {
    asset = await prisma.productionAsset.create({
      data: {
        projectId: body.projectId,
        stage: ProductionStage.SHOT_04,
        scope: body.kind === "posePresetMemory" ? ProductionAssetScope.TEAM : ProductionAssetScope.PERSONAL,
        reviewStatus: body.kind === "posePresetMemory" ? ProductionAssetReviewStatus.APPROVED : ProductionAssetReviewStatus.UNREVIEWED,
        creatorId: requestUser.id,
        originalName: body.name,
        displayName: body.name,
        description: body.description || null,
        mimeType: "application/json",
        sourceType,
        sourceId: body.nodeId,
        sourcePayload,
        metadata
      }
    });
  }
  await writeAuditLog({
    actor: requestUser,
    action: auditAction,
    entityType: "Scene3DReusableAsset",
    entityId: asset.id,
    req,
    metadata: { projectId: body.projectId, kind: body.kind, sourceType }
  });
  return serializeScene3DReusableAsset(asset);
}

async function listScene3DReusableAssets(req: express.Request) {
  const requestUser = await requireAuth(req);
  const query = parseScene3DReusableAssetList(req.query);
  await ensureProjectMember(query.projectId, requestUser);
  const sourceTypes = query.kind ? [scene3dReusableAssetSourceType[query.kind]] : scene3dReusableAssetSourceTypes;
  const sharedPosePresetMemory = query.kind === "posePresetMemory";
  const assets = await prisma.productionAsset.findMany({
    where: {
      projectId: query.projectId,
      ...(sharedPosePresetMemory
        ? { scope: ProductionAssetScope.TEAM, reviewStatus: ProductionAssetReviewStatus.APPROVED }
        : { scope: ProductionAssetScope.PERSONAL, creatorId: requestUser.id }),
      deletedAt: null,
      archivedAt: null,
      stage: ProductionStage.SHOT_04,
      sourceType: { in: sourceTypes },
      ...(query.nodeId ? { sourceId: query.nodeId } : {}),
      ...(query.query ? {
        OR: [
          { originalName: { contains: query.query, mode: "insensitive" as const } },
          { displayName: { contains: query.query, mode: "insensitive" as const } },
          { description: { contains: query.query, mode: "insensitive" as const } }
        ]
      } : {})
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });
  return assets.map(serializeScene3DReusableAsset);
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
  app.post("/api/workflow/scene3d/import-image", async (req, res) => {
    try {
      const importResult = await importScene3DFromImage(req, options);
      const requestUser = await requireAuth(req);
      await writeAuditLog({
        actor: requestUser,
        action: "EXECUTE",
        entityType: "Scene3DImport",
        entityId: req.body?.nodeId || undefined,
        req,
        afterJson: {
          workflowId: req.body?.workflowId || null,
          nodeId: req.body?.nodeId || null,
          imageAssetId: req.body?.imageAssetId || null,
          mode: req.body?.mode || null,
          characterCount: importResult.characters.length,
          cameraCount: importResult.cameras.length
        }
      });
      res.json({ importResult });
    } catch (error: any) {
      sendApiError(res, error, "Scene3D image import failed.");
    }
  });

  app.post("/api/workflow/scene3d/director-plan", async (req, res) => {
    try {
      const directorPlan = await planScene3DDirector(req, options);
      const requestUser = await requireAuth(req);
      await writeAuditLog({
        actor: requestUser,
        action: "EXECUTE",
        entityType: "Scene3DDirectorPlan",
        entityId: req.body?.nodeId || undefined,
        req,
        afterJson: {
          workflowId: req.body?.workflowId || null,
          nodeId: req.body?.nodeId || null,
          durationMs: directorPlan.durationMs,
          aspectRatio: directorPlan.aspectRatio,
          shotCount: directorPlan.shots.length,
          keyframeCount: directorPlan.keyframes.length,
          motionSegmentCount: directorPlan.motionSegments.length,
          cameraPathPointCount: directorPlan.cameraPath.length,
          relationCount: directorPlan.characterRelations.length,
          interactionClipCount: directorPlan.interactionClips.length,
          syncMarkerCount: directorPlan.syncMarkers.length,
          warningCount: directorPlan.warnings.length
        }
      });
      res.json({ directorPlan });
    } catch (error: any) {
      sendApiError(res, error, "Scene3D director planning failed.");
    }
  });

  app.post("/api/workflow/scene3d/refine-motion", async (req, res) => {
    try {
      const motionIntent = await refineScene3DMotion(req, options);
      const requestUser = await requireAuth(req);
      await writeAuditLog({
        actor: requestUser,
        action: "EXECUTE",
        entityType: "Scene3DMotionIntent",
        entityId: req.body?.nodeId || undefined,
        req,
        afterJson: {
          workflowId: req.body?.workflowId || null,
          projectId: req.body?.projectId || null,
          nodeId: req.body?.nodeId || null,
          transitionId: req.body?.transitionId || null,
          selectedCharacterId: req.body?.selectedCharacterId || null,
          actionIntent: motionIntent.intent,
          rhythm: motionIntent.rhythm,
          distance: motionIntent.distance,
          turnDeg: motionIntent.turnDeg,
          confidence: motionIntent.confidence,
          warningCount: motionIntent.warnings.length
        }
      });
      res.json({ motionIntent });
    } catch (error: any) {
      sendApiError(res, error, "Scene3D motion refinement failed.");
    }
  });

  app.post("/api/workflow/scene3d/solve-pose-reference", async (req, res) => {
    try {
      const pose = await solveScene3DPoseReference(req);
      const requestUser = await requireAuth(req);
      await writeAuditLog({
        actor: requestUser,
        action: "EXECUTE",
        entityType: "Scene3DPoseReference",
        entityId: req.body?.nodeId || undefined,
        req,
        afterJson: {
          workflowId: req.body?.workflowId || null,
          projectId: req.body?.projectId || null,
          nodeId: req.body?.nodeId || null,
          selectedCharacterId: req.body?.selectedCharacterId || null,
          referenceImageCount: Array.isArray(req.body?.referenceImages) ? req.body.referenceImages.length : 0,
          appliedViews: pose.appliedViews,
          confidence: pose.confidence,
          warningCount: pose.warnings.length
        }
      });
      res.json({ pose });
    } catch (error: any) {
      sendApiError(res, error, "Scene3D pose reference solve failed.");
    }
  });

  app.post("/api/workflow/scene3d/assets", async (req, res) => {
    try {
      const asset = await saveScene3DReusableAsset(req);
      res.status(201).json({ asset });
    } catch (error: any) {
      sendApiError(res, error, "Scene3D reusable asset save failed.");
    }
  });

  app.get("/api/workflow/scene3d/assets", async (req, res) => {
    try {
      const assets = await listScene3DReusableAssets(req);
      res.json({ assets });
    } catch (error: any) {
      sendApiError(res, error, "Scene3D reusable asset list failed.");
    }
  });

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
