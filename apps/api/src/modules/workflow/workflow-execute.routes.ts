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
  durationSec: z.number().finite().min(0.2).max(120),
  curve: z.enum(["linear", "ease_in", "ease_out", "ease_in_out", "bullet_time", "pulse", "hold_then_burst"]),
  startTransform: z.unknown(),
  endTransform: z.unknown(),
  startPose: z.unknown(),
  endPose: z.unknown(),
  startFingerPose: z.unknown().optional(),
  endFingerPose: z.unknown().optional(),
  fixedPoseConstraints: z.array(z.unknown()).max(12).default([]),
  fixedPoseSegments: z.array(z.unknown()).max(12).default([]),
  middleKeyframeConstraints: z.array(z.unknown()).max(10).default([]),
  currentCharacterTransform: z.unknown().optional(),
  constraints: z.unknown().optional(),
  localSemanticPlan: z.unknown().optional(),
  localActionPlan: z.unknown().optional(),
  localCompilerContract: z.unknown().optional(),
  promptRequirementGraph: z.unknown().optional(),
  negativeConstraints: z.array(z.unknown()).max(80).default([]),
  motionStyleProfile: z.unknown().optional(),
  availableSemanticStageTemplates: z.array(z.unknown()).max(24).default([]),
  availableActionSkills: z.array(z.unknown()).max(24).default([]),
  availableMotionPrimitives: z.array(z.unknown()).max(24).default([]),
  motionPrimitiveInstruction: z.string().trim().max(1600).optional(),
  characters: z.array(z.unknown()).max(12).default([]),
  characterRigMappings: z.array(z.unknown()).max(12).default([]),
  cameras: z.array(z.unknown()).max(8).default([]),
  props: z.array(z.unknown()).max(16).default([]),
  sceneContext: z.unknown().optional(),
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
const scene3dMotionFamilySchema = z.enum(["locomotion", "turn", "roll", "fall", "get_up", "dodge", "crawl", "kneel", "stumble", "reach", "carry", "combat"]);
const scene3dMotionSemanticActionFamilySchema = z.enum(["locomotion", "combat", "push_pull", "throw", "jump", "fall", "crawl", "posture", "turn", "reach", "unknown"]);
const scene3dMotionSemanticActionTypeSchema = z.enum(["walk", "run", "dash", "push", "pull", "throw", "punch", "block", "kick", "side_kick", "jump", "crouch", "crawl", "fall", "get_up", "turn", "reach", "idle", "unknown"]);
const scene3dMotionKeyframeHintSchema = z.object({
  timeRatio: z.number().finite().min(0).max(1),
  label: z.string().trim().min(1).max(120),
  posePresetId: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional()
});
const scene3dCameraMotionTypeSchema = z.enum(["none", "dolly_in", "dolly_out", "truck_left", "truck_right", "orbit", "follow_character", "low_tilt_up", "top_tilt_down", "handheld", "close_follow"]);
const scene3dCameraMotionHintSchema = z.object({
  enabled: z.boolean().default(false),
  type: scene3dCameraMotionTypeSchema.default("none"),
  intensity: z.number().finite().min(0).max(1).default(0.6),
  startTimeSec: z.number().finite().min(0).default(0),
  endTimeSec: z.number().finite().min(0).default(2),
  distance: z.number().finite().min(0).max(8).default(1.2),
  heightOffset: z.number().finite().min(-4).max(4).default(0),
  orbitAngleDeg: z.number().finite().min(-360).max(360).default(35),
  keepCharacterInFrame: z.boolean().default(true)
});

const scene3dMotionIntentSchema = z.object({
  version: z.literal(1),
  intent: z.string().trim().min(1).max(1200),
  durationSec: z.number().finite().min(0.2).max(120),
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
  actionFamily: scene3dMotionSemanticActionFamilySchema.optional(),
  actionType: scene3dMotionSemanticActionTypeSchema.optional(),
  motionFamilies: z.array(scene3dMotionFamilySchema).max(12).default([]),
  keyframeHints: z.array(scene3dMotionKeyframeHintSchema).max(10).default([]),
  contactHints: z.array(z.object({
    timeSec: z.number().finite().min(0).optional(),
    contact: scene3dMotionContactHintSchema,
    note: z.string().trim().max(300).optional()
  })).max(12).default([]),
  cameraMotionHint: scene3dCameraMotionHintSchema.optional(),
  warnings: z.array(z.string().trim().min(1).max(300)).max(24),
  confidence: z.number().finite().min(0).max(1)
}).strict();

const scene3dMotionDraftRequirementSchema = z.object({
  id: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(300),
  category: z.enum(["action", "body", "timing", "contact", "camera", "style", "constraint", "other"]).default("other"),
  priority: z.enum(["low", "normal", "high"]).optional()
}).strict();
const scene3dMotionDraftPhaseSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  startSec: z.number().finite().min(0).max(120),
  endSec: z.number().finite().min(0).max(120),
  purpose: z.string().trim().max(300).optional(),
  keyJoints: z.array(scene3dPoseJointKeySchema).max(8).default([]),
  contacts: z.array(scene3dMotionContactHintSchema).max(8).default([]),
  requirementIds: z.array(z.string().trim().min(1).max(80)).max(12).default([])
}).strict();
const scene3dMotionDraftTransformKeyframeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  timeSec: z.number().finite().min(0).max(120),
  position: z.object({
    x: z.number().finite().min(-50).max(50),
    y: z.number().finite().min(-50).max(50),
    z: z.number().finite().min(-50).max(50)
  }).strict().optional(),
  rotation: z.object({
    x: z.number().finite().min(-180).max(180),
    y: z.number().finite().min(-180).max(180),
    z: z.number().finite().min(-180).max(180)
  }).strict().optional(),
  scale: z.object({
    x: z.number().finite().min(0.01).max(20),
    y: z.number().finite().min(0.01).max(20),
    z: z.number().finite().min(0.01).max(20)
  }).strict().optional(),
  phaseId: z.string().trim().max(80).optional(),
  requirementIds: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  note: z.string().trim().max(300).optional()
}).strict();
const scene3dMotionDraftBoneKeyframeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  timeSec: z.number().finite().min(0).max(120),
  joint: scene3dPoseJointKeySchema,
  rotation: z.object({
    x: z.number().finite().min(-180).max(180),
    y: z.number().finite().min(-180).max(180),
    z: z.number().finite().min(-180).max(180)
  }).strict(),
  phaseId: z.string().trim().max(80).optional(),
  requirementIds: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  note: z.string().trim().max(300).optional()
}).strict();
const scene3dMotionDraftContactFrameSchema = z.object({
  id: z.string().trim().min(1).max(80),
  timeSec: z.number().finite().min(0).max(120),
  contact: scene3dMotionContactHintSchema,
  type: z.enum(["ground", "prop", "look", "release", "hold", "other"]).optional(),
  targetObjectId: z.string().trim().max(120).optional(),
  phaseId: z.string().trim().max(80).optional(),
  requirementIds: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  note: z.string().trim().max(300).optional()
}).strict();
const scene3dMotionDraftConstraintSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(["head_look", "hand_target", "foot_lock", "body_aim", "grounding", "prop_contact", "other"]),
  target: z.string().trim().max(160).optional(),
  startSec: z.number().finite().min(0).max(120).optional(),
  endSec: z.number().finite().min(0).max(120).optional(),
  joints: z.array(scene3dPoseJointKeySchema).max(8).default([]),
  requirementIds: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  note: z.string().trim().max(300).optional()
}).strict();
const scene3dMotionDraftRequirementMapSchema = z.object({
  requirementId: z.string().trim().min(1).max(80),
  appliedTo: z.array(z.object({
    kind: z.enum(["phase", "transformKeyframe", "boneKeyframe", "contactFrame", "constraint", "camera"]),
    id: z.string().trim().max(80).optional(),
    timeSec: z.number().finite().min(0).max(120).optional(),
    joint: scene3dPoseJointKeySchema.optional(),
    phaseId: z.string().trim().max(80).optional()
  }).strict()).max(16).default([]),
  note: z.string().trim().max(300).optional()
}).strict();
const scene3dMotionPrimitiveHintSchema = z.object({
  primitiveId: z.string().trim().min(1).max(80),
  actionType: scene3dMotionSemanticActionTypeSchema,
  phaseId: z.string().trim().max(80).optional(),
  startSec: z.number().finite().min(0).max(120),
  endSec: z.number().finite().min(0).max(120),
  requirementIds: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  reason: z.string().trim().min(1).max(300)
}).strict();
const scene3dMotionDraftSchema = z.object({
  version: z.literal(1),
  actionIntent: z.string().trim().min(1).max(1200),
  durationSec: z.number().finite().min(0.2).max(120),
  fpsHint: z.number().finite().min(12).max(60).optional(),
  generatedMotionPrompt: z.string().trim().min(1).max(4000),
  promptRequirements: z.array(scene3dMotionDraftRequirementSchema).max(20).default([]),
  promptRequirementMap: z.array(scene3dMotionDraftRequirementMapSchema).max(20).default([]),
  phasePlan: z.array(scene3dMotionDraftPhaseSchema).max(12).default([]),
  transformKeyframes: z.array(scene3dMotionDraftTransformKeyframeSchema).max(24).default([]),
  boneKeyframes: z.array(scene3dMotionDraftBoneKeyframeSchema).max(80).default([]),
  contactFrames: z.array(scene3dMotionDraftContactFrameSchema).max(32).default([]),
  constraints: z.array(scene3dMotionDraftConstraintSchema).max(24).default([]),
  primitiveHints: z.array(scene3dMotionPrimitiveHintSchema).max(12).default([]).optional(),
  timing: z.object({
    anticipation: z.number().finite().min(0).max(120).optional(),
    mainActionStart: z.number().finite().min(0).max(120).optional(),
    mainActionEnd: z.number().finite().min(0).max(120).optional(),
    settle: z.number().finite().min(0).max(120).optional()
  }).strict().optional(),
  warnings: z.array(z.string().trim().min(1).max(300)).max(24).default([]),
  confidence: z.number().finite().min(0).max(1)
}).strict();

const scene3dInteractionTargetTypeSchema = z.enum(["character", "prop", "camera", "point"]);
const scene3dInteractionActorRoleSchema = z.enum(["primary", "secondary", "target", "obstacle"]);
const scene3dInteractionTargetRoleSchema = z.enum(["push_target", "receive_target", "avoid_target", "look_target", "obstacle", "held_object"]);
const scene3dInteractionActionTypeSchema = z.enum(["approach", "push", "pull", "handoff", "receive", "avoid", "chase", "fight_basic", "kick_prop", "pick_up", "put_down"]);
const scene3dInteractionContactTypeSchema = z.enum(["reach", "touch", "hold", "push", "pull", "hit", "release", "receive", "avoid"]);
const scene3dInteractionSyncMarkerTypeSchema = z.enum(["contact", "release", "dodge", "receive", "impact", "look", "camera_cue"]);
const scene3dInteractionPropPhysicalHintSchema = z.enum(["slide", "roll", "lift", "drop", "impact", "carry"]);
const scene3dInteractionActorSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  role: scene3dInteractionActorRoleSchema,
  actionType: scene3dMotionSemanticActionTypeSchema.default("unknown"),
  startRatio: z.number().finite().min(0).max(1),
  endRatio: z.number().finite().min(0).max(1),
  targetObjectId: z.string().trim().max(120).optional(),
  relativePositionGoal: z.string().trim().max(240).optional(),
  motionDraftRef: z.string().trim().max(120).optional(),
  motionDraft: scene3dMotionDraftSchema.optional(),
  notes: z.array(z.string().trim().min(1).max(300)).max(8).default([])
}).strict();
const scene3dInteractionTargetSchema = z.object({
  targetId: z.string().trim().min(1).max(120),
  targetType: scene3dInteractionTargetTypeSchema,
  role: scene3dInteractionTargetRoleSchema,
  worldPosition: scene3dVec3Schema.optional(),
  boundingHint: z.object({
    x: z.number().finite().min(0).max(20),
    y: z.number().finite().min(0).max(20),
    z: z.number().finite().min(0).max(20)
  }).strict().optional(),
  notes: z.array(z.string().trim().min(1).max(300)).max(8).default([])
}).strict();
const scene3dInteractionContactSchema = z.object({
  id: z.string().trim().min(1).max(80),
  timeSec: z.number().finite().min(0).max(120),
  actorId: z.string().trim().min(1).max(120),
  limb: z.enum(["head", "leftHand", "rightHand", "leftFoot", "rightFoot"]),
  targetId: z.string().trim().min(1).max(120),
  targetType: scene3dInteractionTargetTypeSchema,
  contactType: scene3dInteractionContactTypeSchema,
  worldPosition: scene3dVec3Schema.optional(),
  required: z.boolean().default(true)
}).strict();
const scene3dInteractionDraftClipSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  actionType: scene3dInteractionActionTypeSchema,
  actorIds: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  targetIds: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  startSec: z.number().finite().min(0).max(120),
  endSec: z.number().finite().min(0).max(120),
  requiredContacts: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  relativePositionRules: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  notes: z.array(z.string().trim().min(1).max(300)).max(8).default([])
}).strict();
const scene3dInteractionSyncMarkerSchema = z.object({
  id: z.string().trim().min(1).max(80),
  timeSec: z.number().finite().min(0).max(120),
  markerType: scene3dInteractionSyncMarkerTypeSchema,
  actorId: z.string().trim().max(120).optional(),
  targetId: z.string().trim().max(120).optional(),
  triggers: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  notes: z.array(z.string().trim().min(1).max(300)).max(8).default([])
}).strict();
const scene3dInteractionPropMotionSchema = z.object({
  propId: z.string().trim().min(1).max(120),
  startSec: z.number().finite().min(0).max(120),
  endSec: z.number().finite().min(0).max(120),
  transformKeyframes: z.array(z.object({
    timeSec: z.number().finite().min(0).max(120),
    transform: z.object({
      position: z.object({
        x: z.number().finite().min(-50).max(50),
        y: z.number().finite().min(-50).max(50),
        z: z.number().finite().min(-50).max(50)
      }).strict().optional(),
      rotation: z.object({
        x: z.number().finite().min(-180).max(180),
        y: z.number().finite().min(-180).max(180),
        z: z.number().finite().min(-180).max(180)
      }).strict().optional(),
      scale: z.object({
        x: z.number().finite().min(0.01).max(20),
        y: z.number().finite().min(0.01).max(20),
        z: z.number().finite().min(0.01).max(20)
      }).strict().optional()
    }).strict(),
    note: z.string().trim().max(300).optional()
  }).strict()).max(12).default([]),
  causedByActorId: z.string().trim().max(120).optional(),
  causeContactId: z.string().trim().max(80).optional(),
  physicalHint: scene3dInteractionPropPhysicalHintSchema,
  notes: z.array(z.string().trim().min(1).max(300)).max(8).default([])
}).strict();
const scene3dInteractionDraftSchema = z.object({
  version: z.literal(1),
  primaryActorId: z.string().trim().max(120).optional(),
  actors: z.array(scene3dInteractionActorSchema).max(8).default([]),
  targets: z.array(scene3dInteractionTargetSchema).max(16).default([]),
  interactionClips: z.array(scene3dInteractionDraftClipSchema).max(16).default([]),
  contacts: z.array(scene3dInteractionContactSchema).max(48).default([]),
  syncMarkers: z.array(scene3dInteractionSyncMarkerSchema).max(32).default([]),
  propMotions: z.array(scene3dInteractionPropMotionSchema).max(12).default([]),
  spatialConstraints: z.array(z.string().trim().min(1).max(300)).max(16).default([]),
  warnings: z.array(z.string().trim().min(1).max(300)).max(24).default([]),
  confidence: z.number().finite().min(0).max(1)
}).strict();
const scene3dMotionRefineResultSchema = z.object({
  motionIntent: scene3dMotionIntentSchema,
  motionDraft: scene3dMotionDraftSchema.optional(),
  interactionDraft: scene3dInteractionDraftSchema.optional()
}).strict();

type Scene3DMotionRefineRequest = z.infer<typeof scene3dMotionRefineRequestSchema>;
type Scene3DMotionIntent = z.infer<typeof scene3dMotionIntentSchema>;
type Scene3DMotionDraft = z.infer<typeof scene3dMotionDraftSchema>;
type Scene3DInteractionDraft = z.infer<typeof scene3dInteractionDraftSchema>;
type Scene3DMotionRefineResult = z.infer<typeof scene3dMotionRefineResultSchema>;

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

function scene3DMotionPromptAllowsAirborne(prompt: string) {
  return /跳|跳起|跃起|飞跃|飞|浮空|离地|腾空|翻滚|空翻|jump|leap|airborne|fly|flip|roll/i.test(prompt || "");
}

function scene3DMotionRequestAllowsAirborne(request: Scene3DMotionRefineRequest) {
  const semanticPlan: any = request.localSemanticPlan || {};
  const compilerContract: any = request.localCompilerContract || {};
  const actionType = String(semanticPlan.actionType || "");
  const actionSkill = semanticPlan.actionSkill || {};
  return Boolean(actionSkill.allowAirborne)
    || Boolean(compilerContract.allowAirborne)
    || actionType === "jump"
    || scene3DMotionPromptAllowsAirborne(request.actionPrompt);
}

function scene3DLocalCompilerContract(request: Scene3DMotionRefineRequest) {
  const contract: any = request.localCompilerContract || {};
  const semanticPlan: any = request.localSemanticPlan || {};
  const actionTypeRaw = String(contract.actionType || semanticPlan.actionType || "");
  const actionFamilyRaw = String(contract.actionFamily || semanticPlan.actionFamily || "");
  const allowedActionTypes = new Set(scene3dMotionSemanticActionTypeSchema.options);
  const allowedActionFamilies = new Set(scene3dMotionSemanticActionFamilySchema.options);
  const actionType = allowedActionTypes.has(actionTypeRaw as any) ? actionTypeRaw : undefined;
  const actionFamily = allowedActionFamilies.has(actionFamilyRaw as any) ? actionFamilyRaw : undefined;
  const contacts = Array.isArray(contract.contacts)
    ? contract.contacts.map((item: any) => String(item)).filter((item: string) => scene3dMotionContactHintSchema.options.includes(item as any)).slice(0, 12)
    : [];
  const actionSequence = Array.isArray(contract.actionSequence)
    ? contract.actionSequence.map((item: any) => ({
      actionType: allowedActionTypes.has(String(item?.actionType) as any) ? String(item.actionType) : undefined,
      label: typeof item?.label === "string" ? item.label.trim().slice(0, 120) : undefined,
      startRatio: coerceScene3DNumber(item?.startRatio, 0, 0, 1),
      endRatio: coerceScene3DNumber(item?.endRatio, 1, 0, 1),
      sourceText: typeof item?.sourceText === "string" ? item.sourceText.trim().slice(0, 160) : undefined
    })).filter((item: any) => item.actionType).slice(0, 10)
    : [];
  const actionChains = Array.isArray(contract.actionChains)
    ? contract.actionChains.map((item: any) => ({
      id: typeof item?.id === "string" ? item.id.trim().slice(0, 80) : undefined,
      label: typeof item?.label === "string" ? item.label.trim().slice(0, 120) : undefined,
      steps: Array.isArray(item?.steps)
        ? item.steps.map((step: any) => String(step)).filter((step: string) => allowedActionTypes.has(step as any)).slice(0, 8)
        : [],
      description: typeof item?.description === "string" ? item.description.trim().slice(0, 260) : undefined,
      qualityExpectationIds: Array.isArray(item?.qualityExpectationIds)
        ? item.qualityExpectationIds.map((id: any) => String(id).trim()).filter(Boolean).slice(0, 8)
        : []
    })).filter((item: any) => item.id || item.label).slice(0, 6)
    : [];
  const poseStages = Array.isArray(contract.poseStages)
    ? contract.poseStages.map((item: any) => ({
      id: typeof item?.id === "string" ? item.id.trim().slice(0, 80) : undefined,
      label: typeof item?.label === "string" ? item.label.trim().slice(0, 120) : undefined,
      timeRatio: coerceScene3DNumber(item?.timeRatio, 0.5, 0, 1),
      poseHint: typeof item?.poseHint === "string" ? item.poseHint.trim().slice(0, 220) : undefined,
      rootMotionHint: typeof item?.rootMotionHint === "string" ? item.rootMotionHint.trim().slice(0, 220) : undefined,
      contactHint: typeof item?.contactHint === "string" ? item.contactHint.trim().slice(0, 220) : undefined
    })).filter((item: any) => item.label).slice(0, 10)
    : [];
  const qualityExpectations = Array.isArray(contract.qualityExpectations)
    ? contract.qualityExpectations.map((item: any) => ({
      id: typeof item?.id === "string" ? item.id.trim().slice(0, 80) : undefined,
      label: typeof item?.label === "string" ? item.label.trim().slice(0, 120) : undefined,
      metric: typeof item?.metric === "string" ? item.metric.trim().slice(0, 80) : undefined
    })).filter((item: any) => item.id || item.label).slice(0, 16)
    : [];
  const promptControlRaw = contract.promptControl && typeof contract.promptControl === "object" ? contract.promptControl : {};
  const promptControl = {
    directionLabel: typeof promptControlRaw.directionLabel === "string" ? promptControlRaw.directionLabel.trim().slice(0, 80) : undefined,
    speedLabel: typeof promptControlRaw.speedLabel === "string" ? promptControlRaw.speedLabel.trim().slice(0, 40) : undefined,
    forceLabel: typeof promptControlRaw.forceLabel === "string" ? promptControlRaw.forceLabel.trim().slice(0, 40) : undefined,
    timingTags: Array.isArray(promptControlRaw.timingTags) ? promptControlRaw.timingTags.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 8) : [],
    stageTags: Array.isArray(promptControlRaw.stageTags) ? promptControlRaw.stageTags.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 10) : [],
    bodyTags: Array.isArray(promptControlRaw.bodyTags) ? promptControlRaw.bodyTags.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 12) : [],
    speedScale: coerceScene3DNumber(promptControlRaw.speedScale, 1, 0.2, 2),
    forceScale: coerceScene3DNumber(promptControlRaw.forceScale, 1, 0.2, 2),
    holdScale: coerceScene3DNumber(promptControlRaw.holdScale, 1, 0.2, 2),
    travelScale: coerceScene3DNumber(promptControlRaw.travelScale, 1, 0.2, 2)
  };
  const forbiddenOutputFields = Array.isArray(contract.forbiddenOutputFields)
    ? contract.forbiddenOutputFields.map((item: any) => String(item)).filter(Boolean).slice(0, 24)
    : ["samples", "animationClip", "transforms", "keyframes", "bonePose", "boneRotations", "jointRotations", "rawFrames", "constraints"];
  return {
    actionType,
    actionFamily,
    actionLockedByPrompt: Boolean(contract.actionLockedByPrompt),
    actionLockReason: typeof contract.actionLockReason === "string" ? contract.actionLockReason.trim().slice(0, 300) : undefined,
    actionSequence,
    actionChains,
    poseStages,
    promptControl,
    qualityExpectations,
    forbiddenOutputFields,
    contacts,
    targetObjectId: typeof contract.targetObjectId === "string" && contract.targetObjectId.trim() ? contract.targetObjectId.trim() : undefined,
    grounded: Boolean(contract.grounded),
    allowAirborne: Boolean(contract.allowAirborne)
  };
}

function coerceScene3DMotionIntent(value: any, request: Scene3DMotionRefineRequest) {
  const allowsAirborne = scene3DMotionRequestAllowsAirborne(request);
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
  const allowedFamilies = new Set(scene3dMotionFamilySchema.options);
  const motionFamilies = Array.isArray(value?.motionFamilies)
    ? value.motionFamilies.map((item: any) => String(item)).filter((item: string) => allowedFamilies.has(item as any)).slice(0, 12)
    : [];
  const allowedActionFamilies = new Set(scene3dMotionSemanticActionFamilySchema.options);
  const compilerContract = scene3DLocalCompilerContract(request);
  const rawActionFamily = allowedActionFamilies.has(String(value?.actionFamily) as any) ? String(value.actionFamily) : undefined;
  const allowedActionTypes = new Set(scene3dMotionSemanticActionTypeSchema.options);
  const rawActionType = allowedActionTypes.has(String(value?.actionType) as any) ? String(value.actionType) : undefined;
  const actionType = compilerContract.actionType && compilerContract.actionType !== "unknown" && compilerContract.actionType !== "idle"
    ? compilerContract.actionType
    : rawActionType;
  const actionFamily = compilerContract.actionFamily && compilerContract.actionFamily !== "unknown"
    ? compilerContract.actionFamily
    : rawActionFamily;
  const keyframeHints = Array.isArray(value?.keyframeHints)
    ? value.keyframeHints.map((item: any) => ({
      timeRatio: coerceScene3DNumber(item?.timeRatio, 0.5, 0, 1),
      label: typeof item?.label === "string" && item.label.trim() ? item.label.trim().slice(0, 120) : "动作阶段",
      posePresetId: typeof item?.posePresetId === "string" && item.posePresetId.trim() ? item.posePresetId.trim().slice(0, 120) : undefined,
      note: typeof item?.note === "string" && item.note.trim() ? item.note.trim().slice(0, 300) : undefined
    })).slice(0, 10)
    : [];
  const contactHints = Array.isArray(value?.contactHints)
    ? value.contactHints.map((item: any) => ({
      timeSec: Number.isFinite(Number(item?.timeSec)) ? Math.max(0, Number(item.timeSec)) : undefined,
      contact: allowedContacts.has(String(item?.contact) as any) ? String(item.contact) : "feet",
      note: typeof item?.note === "string" && item.note.trim() ? item.note.trim().slice(0, 300) : undefined
    })).slice(0, 12)
    : [];
  const cameraMotionValidation = scene3dCameraMotionHintSchema.safeParse(value?.cameraMotionHint);
  const warnings = Array.isArray(value?.warnings) ? value.warnings.map((item: any) => String(item)).filter(Boolean).slice(0, 24) : [];
  const forbiddenReturnedFields = compilerContract.forbiddenOutputFields.filter((field: string) => Object.prototype.hasOwnProperty.call(value || {}, field));
  if (forbiddenReturnedFields.length) {
    warnings.push(`AI returned forbidden raw motion fields (${forbiddenReturnedFields.join(", ")}); they were ignored. Scene3D local compiler remains the only animation executor.`);
  }
  if (compilerContract.actionType && rawActionType && rawActionType !== compilerContract.actionType) {
    warnings.push(`AI actionType ${rawActionType} was aligned to local compiler actionType ${compilerContract.actionType}.`);
  }
  if (compilerContract.actionFamily && rawActionFamily && rawActionFamily !== compilerContract.actionFamily) {
    warnings.push(`AI actionFamily ${rawActionFamily} was aligned to local compiler actionFamily ${compilerContract.actionFamily}.`);
  }
  const targetObjectId = compilerContract.targetObjectId
    || (typeof value?.targetObjectId === "string" && value.targetObjectId.trim() ? value.targetObjectId.trim() : undefined);
  const mergedContacts = Array.from(new Set([...compilerContract.contacts, ...contacts])).slice(0, 12);

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
    roll: coerceScene3DNumber(value?.roll, 0, 0, allowsAirborne ? 1 : 0.12),
    crouch: coerceScene3DNumber(value?.crouch, 0, 0, 1),
    verticalLift: coerceScene3DNumber(value?.verticalLift, 0, 0, allowsAirborne ? 2 : 0.06),
    bodyLean: coerceScene3DVec3(value?.bodyLean),
    armSwing: coerceScene3DNumber(value?.armSwing, 0, 0, 1),
    rhythm,
    contacts: mergedContacts,
    lookAt,
    targetObjectId,
    actionFamily,
    actionType,
    motionFamilies,
    keyframeHints,
    contactHints,
    cameraMotionHint: cameraMotionValidation.success ? cameraMotionValidation.data : undefined,
    warnings: warnings.slice(0, 24),
    confidence: coerceScene3DNumber(value?.confidence, 0.5, 0, 1)
  };
}

const scene3dReusableAssetKindSchema = z.enum(["actionClip", "cameraMove", "directorTemplate"]);
const scene3dReusableAssetSourceType: Record<z.infer<typeof scene3dReusableAssetKindSchema>, string> = {
  actionClip: "scene3d_action_clip",
  cameraMove: "scene3d_camera_move",
  directorTemplate: "scene3d_director_template"
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
const SCENE3D_MOTION_REFINE_TIMEOUT_MS = Number(process.env.SCENE3D_MOTION_REFINE_TIMEOUT_MS || 18000);
const SCENE3D_MOTION_REFINE_ULTRA_TIMEOUT_MS = Number(process.env.SCENE3D_MOTION_REFINE_ULTRA_TIMEOUT_MS || 12000);
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

function scene3DMotionContextObjectIds(request: Scene3DMotionRefineRequest) {
  const objectIds = new Set<string>([request.selectedCharacterId]);
  for (const item of request.characters as any[]) if (typeof item?.id === "string") objectIds.add(item.id);
  for (const item of request.props as any[]) if (typeof item?.id === "string") objectIds.add(item.id);
  for (const item of request.cameras as any[]) if (typeof item?.id === "string") objectIds.add(item.id);
  return objectIds;
}

function scene3DMotionContextIdsByType(request: Scene3DMotionRefineRequest) {
  const characters = new Set<string>([request.selectedCharacterId]);
  const props = new Set<string>();
  const cameras = new Set<string>();
  for (const item of request.characters as any[]) if (typeof item?.id === "string") characters.add(item.id);
  for (const item of request.props as any[]) if (typeof item?.id === "string") props.add(item.id);
  for (const item of request.cameras as any[]) if (typeof item?.id === "string") cameras.add(item.id);
  return { characters, props, cameras, all: scene3DMotionContextObjectIds(request) };
}

function validateScene3DMotionDraftSemantics(draft: Scene3DMotionDraft, request: Scene3DMotionRefineRequest) {
  const issues: Array<{ path: string; message: string }> = [];
  const objectIds = scene3DMotionContextObjectIds(request);
  const primitiveIds = new Set(
    (request.availableMotionPrimitives as any[])
      .map((item) => typeof item?.id === "string" ? item.id : typeof item === "string" ? item : "")
      .filter(Boolean)
  );
  const endpointEpsilon = 0.001;
  const isMiddleTime = (timeSec: number) => timeSec > endpointEpsilon && timeSec < request.durationSec - endpointEpsilon;
  if (Math.abs(draft.durationSec - request.durationSec) > endpointEpsilon) {
    issues.push({ path: "motionDraft.durationSec", message: "motionDraft.durationSec must match request durationSec" });
  }
  for (const [index, phase] of draft.phasePlan.entries()) {
    if (phase.endSec < phase.startSec) issues.push({ path: `motionDraft.phasePlan.${index}.endSec`, message: "phase endSec must be greater than or equal to startSec" });
    if (phase.endSec > request.durationSec + endpointEpsilon) issues.push({ path: `motionDraft.phasePlan.${index}.endSec`, message: "phase endSec exceeds request durationSec" });
  }
  for (const [index, keyframe] of draft.transformKeyframes.entries()) {
    if (!isMiddleTime(keyframe.timeSec)) issues.push({ path: `motionDraft.transformKeyframes.${index}.timeSec`, message: "transformKeyframes cannot cover the 0s start frame or durationSec end frame" });
  }
  for (const [index, keyframe] of draft.boneKeyframes.entries()) {
    if (!isMiddleTime(keyframe.timeSec)) issues.push({ path: `motionDraft.boneKeyframes.${index}.timeSec`, message: "boneKeyframes cannot cover the 0s start frame or durationSec end frame" });
  }
  for (const [index, contact] of draft.contactFrames.entries()) {
    if (!isMiddleTime(contact.timeSec)) issues.push({ path: `motionDraft.contactFrames.${index}.timeSec`, message: "contactFrames cannot cover the 0s start frame or durationSec end frame" });
    if (contact.targetObjectId && !objectIds.has(contact.targetObjectId)) {
      issues.push({ path: `motionDraft.contactFrames.${index}.targetObjectId`, message: "targetObjectId does not exist in the compact Scene3D context" });
    }
  }
  for (const [index, constraint] of draft.constraints.entries()) {
    if (constraint.startSec !== undefined && constraint.endSec !== undefined && constraint.endSec < constraint.startSec) {
      issues.push({ path: `motionDraft.constraints.${index}.endSec`, message: "constraint endSec must be greater than or equal to startSec" });
    }
    if (constraint.startSec !== undefined && constraint.startSec > request.durationSec + endpointEpsilon) {
      issues.push({ path: `motionDraft.constraints.${index}.startSec`, message: "constraint startSec exceeds request durationSec" });
    }
    if (constraint.endSec !== undefined && constraint.endSec > request.durationSec + endpointEpsilon) {
      issues.push({ path: `motionDraft.constraints.${index}.endSec`, message: "constraint endSec exceeds request durationSec" });
    }
  }
  for (const [index, hint] of (draft.primitiveHints || []).entries()) {
    if (primitiveIds.size > 0 && !primitiveIds.has(hint.primitiveId)) {
      issues.push({ path: `motionDraft.primitiveHints.${index}.primitiveId`, message: "primitiveId is not listed in availableMotionPrimitives" });
    }
    if (hint.endSec <= hint.startSec) {
      issues.push({ path: `motionDraft.primitiveHints.${index}.endSec`, message: "primitiveHint endSec must be greater than startSec" });
    }
    if (hint.startSec < -endpointEpsilon || hint.endSec > request.durationSec + endpointEpsilon) {
      issues.push({ path: `motionDraft.primitiveHints.${index}.endSec`, message: "primitiveHint must stay within request durationSec" });
    }
    if (hint.endSec - hint.startSec < 0.08) {
      issues.push({ path: `motionDraft.primitiveHints.${index}.endSec`, message: "primitiveHint duration is too short to compile" });
    }
  }
  if (draft.timing) {
    for (const key of ["anticipation", "mainActionStart", "mainActionEnd", "settle"] as const) {
      const value = draft.timing[key];
      if (value !== undefined && value > request.durationSec + endpointEpsilon) {
        issues.push({ path: `motionDraft.timing.${key}`, message: "timing value exceeds request durationSec" });
      }
    }
    if (draft.timing.mainActionStart !== undefined && draft.timing.mainActionEnd !== undefined && draft.timing.mainActionEnd < draft.timing.mainActionStart) {
      issues.push({ path: "motionDraft.timing.mainActionEnd", message: "mainActionEnd must be greater than or equal to mainActionStart" });
    }
  }
  return issues;
}

function validateScene3DInteractionDraftSemantics(draft: Scene3DInteractionDraft, request: Scene3DMotionRefineRequest) {
  const issues: Array<{ path: string; message: string }> = [];
  const ids = scene3DMotionContextIdsByType(request);
  const targetExists = (targetId: string | undefined, targetType?: string) => {
    if (!targetId) return false;
    if (targetType === "character") return ids.characters.has(targetId);
    if (targetType === "prop") return ids.props.has(targetId);
    if (targetType === "camera") return ids.cameras.has(targetId);
    return ids.all.has(targetId);
  };
  const checkTime = (path: string, value: number) => {
    if (value > request.durationSec + 0.001) issues.push({ path, message: "time exceeds request durationSec" });
  };
  if (draft.primaryActorId && !ids.characters.has(draft.primaryActorId)) {
    issues.push({ path: "interactionDraft.primaryActorId", message: "primaryActorId must reference an existing character id" });
  }
  for (const [index, actor] of draft.actors.entries()) {
    if (!ids.characters.has(actor.actorId)) {
      issues.push({ path: `interactionDraft.actors.${index}.actorId`, message: "actorId must reference an existing character id" });
    }
    if (actor.endRatio < actor.startRatio) {
      issues.push({ path: `interactionDraft.actors.${index}.endRatio`, message: "actor endRatio must be greater than or equal to startRatio" });
    }
    if (actor.targetObjectId && !ids.all.has(actor.targetObjectId)) {
      issues.push({ path: `interactionDraft.actors.${index}.targetObjectId`, message: "targetObjectId does not exist in compact Scene3D context" });
    }
    if (actor.motionDraft) {
      const nestedIssues = validateScene3DMotionDraftSemantics(actor.motionDraft, request);
      nestedIssues.forEach((issue) => issues.push({ path: `interactionDraft.actors.${index}.${issue.path}`, message: issue.message }));
    }
  }
  for (const [index, target] of draft.targets.entries()) {
    if (target.targetType !== "point" && !targetExists(target.targetId, target.targetType)) {
      issues.push({ path: `interactionDraft.targets.${index}.targetId`, message: "targetId must reference an existing object id for its targetType" });
    }
    if (target.targetType === "point" && !target.worldPosition) {
      issues.push({ path: `interactionDraft.targets.${index}.worldPosition`, message: "point targets require worldPosition" });
    }
  }
  for (const [index, clip] of draft.interactionClips.entries()) {
    checkTime(`interactionDraft.interactionClips.${index}.startSec`, clip.startSec);
    checkTime(`interactionDraft.interactionClips.${index}.endSec`, clip.endSec);
    if (clip.endSec < clip.startSec) issues.push({ path: `interactionDraft.interactionClips.${index}.endSec`, message: "interaction clip endSec must be after startSec" });
    clip.actorIds.forEach((actorId, actorIndex) => {
      if (!ids.characters.has(actorId)) issues.push({ path: `interactionDraft.interactionClips.${index}.actorIds.${actorIndex}`, message: "actorIds must reference existing character ids" });
    });
    clip.targetIds.forEach((targetId, targetIndex) => {
      if (!ids.all.has(targetId)) issues.push({ path: `interactionDraft.interactionClips.${index}.targetIds.${targetIndex}`, message: "targetIds must reference existing object ids" });
    });
  }
  for (const [index, contact] of draft.contacts.entries()) {
    checkTime(`interactionDraft.contacts.${index}.timeSec`, contact.timeSec);
    if (!ids.characters.has(contact.actorId)) issues.push({ path: `interactionDraft.contacts.${index}.actorId`, message: "contact actorId must reference an existing character id" });
    if (contact.targetType !== "point" && !targetExists(contact.targetId, contact.targetType)) {
      issues.push({ path: `interactionDraft.contacts.${index}.targetId`, message: "contact targetId must reference an existing object id for targetType" });
    }
    if (contact.targetType === "point" && !contact.worldPosition) {
      issues.push({ path: `interactionDraft.contacts.${index}.worldPosition`, message: "point contacts require worldPosition" });
    }
  }
  for (const [index, marker] of draft.syncMarkers.entries()) {
    checkTime(`interactionDraft.syncMarkers.${index}.timeSec`, marker.timeSec);
    if (marker.actorId && !ids.characters.has(marker.actorId)) issues.push({ path: `interactionDraft.syncMarkers.${index}.actorId`, message: "sync marker actorId must reference an existing character id" });
    if (marker.targetId && !ids.all.has(marker.targetId)) issues.push({ path: `interactionDraft.syncMarkers.${index}.targetId`, message: "sync marker targetId must reference an existing object id" });
  }
  for (const [index, motion] of draft.propMotions.entries()) {
    if (!ids.props.has(motion.propId)) issues.push({ path: `interactionDraft.propMotions.${index}.propId`, message: "propMotion propId must reference an existing prop id" });
    checkTime(`interactionDraft.propMotions.${index}.startSec`, motion.startSec);
    checkTime(`interactionDraft.propMotions.${index}.endSec`, motion.endSec);
    if (motion.endSec < motion.startSec) issues.push({ path: `interactionDraft.propMotions.${index}.endSec`, message: "propMotion endSec must be after startSec" });
    if (motion.causedByActorId && !ids.characters.has(motion.causedByActorId)) {
      issues.push({ path: `interactionDraft.propMotions.${index}.causedByActorId`, message: "causedByActorId must reference an existing character id" });
    }
    for (const [frameIndex, frame] of motion.transformKeyframes.entries()) {
      checkTime(`interactionDraft.propMotions.${index}.transformKeyframes.${frameIndex}.timeSec`, frame.timeSec);
      if (frame.timeSec < motion.startSec - 0.001 || frame.timeSec > motion.endSec + 0.001) {
        issues.push({ path: `interactionDraft.propMotions.${index}.transformKeyframes.${frameIndex}.timeSec`, message: "propMotion keyframe timeSec must be inside startSec/endSec" });
      }
    }
  }
  return issues;
}

function parseScene3DMotionRefineJson(raw: string, request: Scene3DMotionRefineRequest): Scene3DMotionRefineResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonMarkdown(raw));
  } catch (error: any) {
    throw new HttpError(502, "Scene3D motion intent model returned invalid JSON.", "SCENE3D_MOTION_REFINE_INVALID_JSON", {
      parseError: error?.message || "Invalid JSON"
    });
  }

  const parsedObject = parsed && typeof parsed === "object" ? parsed as any : {};
  const rawMotionIntent = parsedObject.motionIntent && typeof parsedObject.motionIntent === "object"
    ? parsedObject.motionIntent
    : parsedObject;
  const coerced = coerceScene3DMotionIntent(rawMotionIntent, request);
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
  const objectIds = scene3DMotionContextObjectIds(request);

  if (Math.abs(intent.durationSec - request.durationSec) > 0.001) {
    issues.push({ path: "durationSec", message: "durationSec must match request durationSec" });
  }
  if (intent.targetObjectId && !objectIds.has(intent.targetObjectId)) {
    issues.push({ path: "targetObjectId", message: "targetObjectId does not exist in the compact Scene3D context" });
  }

  if (issues.length) {
    throw new HttpError(502, "Scene3D motion intent output failed semantic validation.", "SCENE3D_MOTION_REFINE_SEMANTIC_INVALID", { issues });
  }
  let motionDraft: Scene3DMotionDraft | undefined;
  if (parsedObject.motionDraft !== undefined) {
    const rawDraft = parsedObject.motionDraft && typeof parsedObject.motionDraft === "object"
      ? (({ interactionDraft, ...rest }) => rest)(parsedObject.motionDraft as any)
      : parsedObject.motionDraft;
    const draftValidation = scene3dMotionDraftSchema.safeParse(rawDraft);
    if (!draftValidation.success) {
      throw new HttpError(502, "Scene3D motion draft output failed schema validation.", "SCENE3D_MOTION_DRAFT_SCHEMA_INVALID", {
        issues: draftValidation.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }
    const draftIssues = validateScene3DMotionDraftSemantics(draftValidation.data, request);
    if (draftIssues.length) {
      throw new HttpError(502, "Scene3D motion draft output failed semantic validation.", "SCENE3D_MOTION_DRAFT_SEMANTIC_INVALID", { issues: draftIssues });
    }
    motionDraft = draftValidation.data;
  }
  let interactionDraft: Scene3DInteractionDraft | undefined;
  const rawInteractionDraft = parsedObject.interactionDraft ?? (
    parsedObject.motionDraft && typeof parsedObject.motionDraft === "object"
      ? (parsedObject.motionDraft as any).interactionDraft
      : undefined
  );
  if (rawInteractionDraft !== undefined) {
    const interactionValidation = scene3dInteractionDraftSchema.safeParse(rawInteractionDraft);
    if (!interactionValidation.success) {
      throw new HttpError(502, "Scene3D interaction draft output failed schema validation.", "SCENE3D_INTERACTION_DRAFT_SCHEMA_INVALID", {
        issues: interactionValidation.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }
    const interactionIssues = validateScene3DInteractionDraftSemantics(interactionValidation.data, request);
    if (interactionIssues.length) {
      throw new HttpError(502, "Scene3D interaction draft output failed semantic validation.", "SCENE3D_INTERACTION_DRAFT_SEMANTIC_INVALID", { issues: interactionIssues });
    }
    interactionDraft = interactionValidation.data;
  }
  const resultValidation = scene3dMotionRefineResultSchema.safeParse({ motionIntent: intent, motionDraft, interactionDraft });
  if (!resultValidation.success) {
    throw new HttpError(502, "Scene3D motion refinement output failed result validation.", "SCENE3D_MOTION_REFINE_RESULT_INVALID", {
      issues: resultValidation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return resultValidation.data;
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
    "Generate structured JSON containing motionIntent plus optional but expected motionDraft and interactionDraft. Do not generate video, assets, URLs, fake progress, final animation clips, samples, tracks, raw frame arrays, or rendered results.",
    "Return JSON only. Do not return Markdown, comments, prose outside JSON, or trailing commas.",
    "The local Scene3D compiler will generate the final animation samples later. motionDraft is the selected character's executable intermediate plan between fixed poses; interactionDraft is the structured multi-character and prop interaction plan.",
    "Start, end, and any provided middle keyframe poses/transforms are hard constraints owned by the caller. Do not include draft keyframes at 0 seconds or at durationSec; infer only the motion planning between adjacent fixed poses.",
    "Prefer localSemanticPlan and available stage templates. You may refine them, but must not invent random in-between actions or bypass the local compiler.",
    "localCompilerContract is the executable contract. If it says actionLockedByPrompt is true, actionType/actionFamily, contacts, targetObjectId, grounded/airborne limits, and quality expectations are not suggestions; preserve them.",
    "localCompilerContract.actionSequence and poseStages are the authoritative semantic timeline. You may clarify timing notes, contact notes, camera intent, and warnings, but must not replace the local sequence with unrelated actions.",
    "localCompilerContract.fixedPoseConstraints and middleKeyframeConstraints are mandatory pose checkpoints. Preserve their timing/order and explain the motion between them; do not replace, reorder, smooth away, or ignore middle keyframes.",
    "localCompilerContract.fixedPoseSegments is the ordered adjacent hard-keyframe relationship contract. Use it to plan phasePlan/keyframes/contact timing segment-by-segment; never infer one blind global motion that ignores middle keyframes.",
    "localCompilerContract.actionChains are locked high-level compound-action chains such as approach-contact, turn-throw, and low-recovery-attack. Preserve their order and explain how the intent satisfies their qualityExpectationIds.",
    "Compound chain meanings: approach_contact = move/approach first, slow near target, then hand contact and force; turn_throw = turn/twist first, then wind up, release, and recover; low_recovery_attack = crouch/dodge/block first, rise/recover balance, then strike/throw.",
    "localCompilerContract.promptControl contains locally parsed direction, speed, force, timing, stage, and body-control words from the user prompt. Treat these as explicit user controls, not loose style suggestions.",
    "promptRequirementGraph is the local requirement graph compiled before AI refinement. Preserve required requirements, use their ids in motionDraft.promptRequirements and promptRequirementMap, and never silently omit a local required requirement.",
    "motionStyleProfile is the caller's structured style-control contract. Its numeric fields such as timingScale, poseAmplitudeScale, rootMotionScale, armSwingScale, legStrideScale, crouchScale, verticalLiftScale, recoveryScale, contactHoldScale, and cameraIntensity must influence motionDraft phase timing, middle keyframe intent, contact hold, recovery, and camera hints. Do not treat style as notes only.",
    "negativeConstraints is the local do-not/avoid contract. Treat error severity constraints as hard constraints. Never violate no_endpoint_override, no_manual_keyframe_override, no_unmapped_actor, no_target_ignore, no_unreachable_contact, no_collision, no_penetration, no_foot_slide, no_extreme_joint_rotation, no_camera_jump, or no_prop_teleport.",
    "availableMotionPrimitives is the local executable action-base catalog. Prefer selecting primitiveHints such as run_forward, walk_forward, dash_forward, push_forward, reach_forward, crouch_down, jump_up, and recover_settle instead of guessing final skeletal animation.",
    "Never return animationClip, samples, tracks, videoUrl, assetUrl, rawFrames, bonePose, boneRotations, jointRotations, or final rendered output. Structured intermediate planning is allowed only inside motionDraft.primitiveHints, motionDraft.transformKeyframes, motionDraft.boneKeyframes, motionDraft.contactFrames, motionDraft.constraints, and interactionDraft.propMotions.transformKeyframes.",
    "If the prompt mentions multiple characters, handoff/receive, chase/avoid, fight, dodge, kicking or moving props, or coordinated contact timing, return interactionDraft. Use only existing character, prop, and camera ids from compact context. For abstract point targets, set targetType point and include worldPosition. If a required actor or target is missing, add warnings instead of inventing ids.",
    "You must align the intent to one local action skill. actionType must be one of: walk, run, dash, push, pull, throw, punch, block, kick, side_kick, jump, crouch, crawl, fall, get_up, turn, reach, idle, unknown.",
    "actionFamily must be one of: locomotion, combat, push_pull, throw, jump, fall, crawl, posture, turn, reach, unknown.",
    "If localSemanticPlan already identifies an actionType, preserve it unless the user prompt explicitly contradicts it. User words such as 双手推, 跑步, 投掷, 蹲下, 跳起, 格挡, 出拳 are higher priority than model guesses.",
    "Do not invent unsupported action names. For compound prompts, describe the sequence in generatedMotionPrompt/keyframeHints/contactHints, but keep actionType aligned with the dominant local action skill.",
    "Default style is realistic human / 3D game character motion: readable intent, conservative body mechanics, continuous center of gravity, and grounded feet unless the prompt explicitly asks for jumping, flying, floating, rolling, or exaggerated cartoon motion.",
    "For unusual or underspecified actions, derive conservative universal body mechanics: direction, distance, rotation, crouch, lift, lean, arm swing, contact hints, look target, and rhythm.",
    "Keep values realistic by default: distance usually 0-1.2, turnDeg usually below 90 unless turning is explicit, roll 0 unless falling or rolling, verticalLift 0 unless jump/fly/airborne is explicit, armSwing below 0.6 for normal walk/run/push/combat.",
    "Use normalized scalar strengths from 0 to 1 unless a field specifies degrees or world units.",
    "Direction is a horizontal world-space vector where X is left/right and Z is depth. Keep Y at 0 unless the intent truly needs vertical direction.",
    "The JSON object must exactly match this TypeScript shape. Keep the old MotionIntent fields compatible and add motionDraft/interactionDraft for intermediate planning:",
    `{
  "motionIntent": {
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
    "actionFamily": "locomotion | combat | push_pull | throw | jump | fall | crawl | posture | turn | reach | unknown",
    "actionType": "walk | run | dash | push | pull | throw | punch | block | kick | side_kick | jump | crouch | crawl | fall | get_up | turn | reach | idle | unknown",
    "motionFamilies": ["locomotion", "turn", "reach", "combat"],
    "keyframeHints": [{ "timeRatio": 0.5, "label": "main anticipation or contact pose", "posePresetId": "optional existing preset id", "note": "why this key pose matters" }],
    "contactHints": [{ "timeSec": 0.6, "contact": "rightFoot", "note": "right foot plants on the ground" }],
    "cameraMotionHint": { "enabled": true, "type": "follow_character", "intensity": 0.6, "startTimeSec": 0, "endTimeSec": 2, "distance": 1.2, "heightOffset": 0, "orbitAngleDeg": 35, "keepCharacterInFrame": true },
    "warnings": ["string"],
    "confidence": 0.8
  },
  "motionDraft": {
    "version": 1,
    "actionIntent": "string",
    "durationSec": 2,
    "fpsHint": 60,
    "generatedMotionPrompt": "string",
    "promptRequirements": [{ "id": "req_1", "text": "user requirement", "category": "action | body | timing | contact | camera | style | constraint | other", "priority": "low | normal | high" }],
    "phasePlan": [{ "id": "phase_1", "label": "anticipation", "startSec": 0, "endSec": 0.4, "purpose": "why this phase exists", "keyJoints": ["chest", "rightUpperArm"], "contacts": ["leftFoot"], "requirementIds": ["req_1"] }],
    "transformKeyframes": [{ "id": "root_1", "timeSec": 0.5, "position": { "x": 0, "y": 0, "z": 0.2 }, "rotation": { "x": 0, "y": 15, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 1 }, "phaseId": "phase_1", "requirementIds": ["req_1"], "note": "intermediate root motion only" }],
    "boneKeyframes": [{ "id": "bone_1", "timeSec": 0.5, "joint": "rightUpperArm", "rotation": { "x": 25, "y": 0, "z": -10 }, "phaseId": "phase_1", "requirementIds": ["req_1"], "note": "intermediate joint plan only" }],
    "contactFrames": [{ "id": "contact_1", "timeSec": 0.5, "contact": "rightFoot", "type": "ground | prop | look | release | hold | other", "targetObjectId": "existing object id only when relevant", "phaseId": "phase_1", "requirementIds": ["req_1"], "note": "contact event" }],
    "constraints": [{ "id": "constraint_1", "type": "head_look | hand_target | foot_lock | body_aim | grounding | prop_contact | other", "target": "target description or id", "startSec": 0.2, "endSec": 1.5, "joints": ["head"], "requirementIds": ["req_1"], "note": "constraint meaning" }],
    "primitiveHints": [{ "primitiveId": "run_forward", "actionType": "run", "phaseId": "phase_1", "startSec": 0, "endSec": 2, "requirementIds": ["req_1"], "reason": "local executable base for running gait" }],
    "promptRequirementMap": [{ "requirementId": "req_1", "appliedTo": [{ "kind": "phase | transformKeyframe | boneKeyframe | contactFrame | constraint | camera", "id": "phase_1", "timeSec": 0.5, "joint": "rightUpperArm", "phaseId": "phase_1" }], "note": "where the requirement is applied" }],
    "timing": { "anticipation": 0.2, "mainActionStart": 0.5, "mainActionEnd": 1.5, "settle": 1.9 },
    "warnings": ["string"],
    "confidence": 0.8
  },
  "interactionDraft": {
    "version": 1,
    "primaryActorId": "existing selected or primary character id",
    "actors": [{ "actorId": "existing character id", "role": "primary | secondary | target | obstacle", "actionType": "run", "startRatio": 0, "endRatio": 1, "targetObjectId": "existing object id when relevant", "relativePositionGoal": "approach front-left of target", "motionDraftRef": "optional", "notes": ["string"] }],
    "targets": [{ "targetId": "existing object id or stable point id", "targetType": "character | prop | camera | point", "role": "push_target | receive_target | avoid_target | look_target | obstacle | held_object", "worldPosition": { "x": 0, "y": 0, "z": 0 }, "boundingHint": { "x": 1, "y": 1, "z": 1 }, "notes": ["string"] }],
    "interactionClips": [{ "id": "clip_1", "label": "approach then push", "actionType": "approach | push | pull | handoff | receive | avoid | chase | fight_basic | kick_prop | pick_up | put_down", "actorIds": ["existing character id"], "targetIds": ["existing target id"], "startSec": 0.2, "endSec": 1.4, "requiredContacts": ["contact_1"], "relativePositionRules": ["keep 0.5m from target until contact"], "notes": ["string"] }],
    "contacts": [{ "id": "contact_1", "timeSec": 0.8, "actorId": "existing character id", "limb": "leftHand | rightHand | leftFoot | rightFoot | head", "targetId": "existing object id or point id", "targetType": "character | prop | camera | point", "contactType": "reach | touch | hold | push | pull | hit | release | receive | avoid", "worldPosition": { "x": 0, "y": 1, "z": 0 }, "required": true }],
    "syncMarkers": [{ "id": "sync_1", "timeSec": 0.8, "markerType": "contact | release | dodge | receive | impact | look | camera_cue", "actorId": "existing character id", "targetId": "existing target id", "triggers": ["secondary dodge starts"], "notes": ["string"] }],
    "propMotions": [{ "propId": "existing prop id", "startSec": 0.8, "endSec": 1.5, "transformKeyframes": [{ "timeSec": 1.0, "transform": { "position": { "x": 0.2, "y": 0, "z": 0 } }, "note": "slide after push" }], "causedByActorId": "existing character id", "causeContactId": "contact_1", "physicalHint": "slide | roll | lift | drop | impact | carry", "notes": ["string"] }],
    "spatialConstraints": ["string"],
    "warnings": ["string"],
    "confidence": 0.8
  }
}`
  ].join("\n");
}

function scene3dMotionRefineUserPrompt(input: { request: Scene3DMotionRefineRequest; node: any }) {
  const compilerContract = scene3DLocalCompilerContract(input.request);
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
    "Locked compound action chains from local compiler:",
    compactJson(compilerContract.actionChains || [], 2400),
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
      localSemanticPlan: input.request.localSemanticPlan,
      localActionPlan: input.request.localActionPlan,
      localCompilerContract: compilerContract,
      promptRequirementGraph: input.request.promptRequirementGraph,
      motionStyleProfile: input.request.motionStyleProfile,
      negativeConstraints: input.request.negativeConstraints,
      availableSemanticStageTemplates: input.request.availableSemanticStageTemplates,
      availableActionSkills: input.request.availableActionSkills,
      availableMotionPrimitives: input.request.availableMotionPrimitives,
      motionPrimitiveInstruction: input.request.motionPrimitiveInstruction,
      characters: input.request.characters,
      characterRigMappings: input.request.characterRigMappings,
      cameras: input.request.cameras,
      props: input.request.props,
      fixedPoseConstraints: input.request.fixedPoseConstraints,
      fixedPoseSegments: input.request.fixedPoseSegments,
      middleKeyframeConstraints: input.request.middleKeyframeConstraints,
      viewportScreenshotAssetId: input.request.viewportScreenshotAssetId || null,
      referenceImageAssetId: input.request.referenceImageAssetId || null
    }, 5000),
    "Motion rules:",
    "- Return motionIntent plus motionDraft. Also return interactionDraft when the prompt contains multiple actors, target props, handoff/receive, chase/avoid, fighting, kicking props, prop movement, or synchronized contact timing.",
    "- motionDraft may include only intermediate primitiveHints, transformKeyframes, boneKeyframes, contactFrames, constraints, phasePlan, timing, and requirement mapping.",
    "- interactionDraft may include only actors, targets, interactionClips, contacts, syncMarkers, propMotions, spatialConstraints, warnings, and confidence.",
    "- interactionDraft actors must use existing character ids from compact context. The selectedCharacterId is the default primaryActorId unless the prompt clearly names another existing character.",
    "- interactionDraft targets must use existing character, prop, or camera ids. For point targets, use targetType point and include worldPosition. Never invent missing object ids.",
    "- Use characterRigMappings only to judge whether hand, foot, head, or body IK may be reliable. If retarget confidence is low or hand/foot bones are missing, add warnings; do not invent rig bones, joint tracks, or final animation samples.",
    "- Use syncMarkers to align contact/release/dodge/receive/impact/look/camera_cue events across actors. Use propMotions only for temporary animation/preview motion; do not imply permanent prop movement.",
    "- For push/kick/impact on a prop, add both a contact and a propMotion with physicalHint slide, roll, impact, lift, drop, or carry as appropriate.",
    "- For handoff/receive, align A release and B receive around the same timeSec and worldPosition.",
    "- For chase/avoid/dodge, describe relativePositionGoal and syncMarkers rather than inventing extra animation samples.",
    "- Do not return animationClip, samples, tracks, raw frame arrays, video URLs, fake progress, or final rendered results.",
    "- Use availableMotionPrimitives as executable local action bases. For run/running prompts choose run_forward; for dash/sprint choose dash_forward; for walk choose walk_forward; for push choose push_forward. Add primitiveHints rather than final animation samples.",
    "- Do not put any motionDraft keyframe at 0 seconds or at durationSec. The caller's start frame and end frame are hard constraints and cannot be edited by AI.",
    "- Treat localSemanticPlan as the deterministic local parser result. Preserve explicit user words from actionPrompt over your own guess.",
    "- Treat promptRequirementGraph as the local PromptRequirementCompiler result. motionDraft.promptRequirements must preserve and cover promptRequirementGraph.requirements whenever possible, using the same requirement ids. motionDraft.promptRequirementMap must reference those ids and explain where each requirement is applied.",
    "- Treat motionStyleProfile as structured numeric action style control. For realistic style reduce unsafe amplitude; for exaggerated increase readable pose amplitude within constraints; for fast/sprint increase stride/arm swing/root pacing; for slow/slow motion stretch timing and contact hold; for burst/impact add anticipation/contact/recover emphasis; for tired/heavy lower energy or center of gravity; for light add fluidity and limited lift; for cautious/nervous preserve smoothness and precision; for cinematic align camera hints and phase readability.",
    "- If motionStyleProfile conflicts with negativeConstraints or hard keyframes, obey the hard constraints first and add warnings. Do not use style to create airborne motion, camera jumps, prop teleports, extreme joint rotations, or manual keyframe overrides.",
    "- If promptRequirementGraph has required requirements that you cannot satisfy with middle planning, keep the requirement id in motionDraft.promptRequirements and add a warning. Do not silently drop local required requirements.",
    "- Treat negativeConstraints as explicit forbidden outcomes. If a negative constraint conflicts with a possible positive fix, obey the negative constraint first and add a warning explaining the blocked fix.",
    "- Never violate no_endpoint_override or no_manual_keyframe_override: do not move, replace, smooth away, or shadow start, end, or provided middle keyframes.",
    "- Never violate no_unmapped_actor or no_target_ignore: use only existing ids from context, and when an action requires a target, map contacts/constraints to that target or warn that the target is missing.",
    "- Never use unreachable hand/foot contacts, camera jumps, prop teleporting, obvious foot sliding, or non-jump airborne motion to satisfy a prompt requirement.",
    "- Treat localCompilerContract as the executable local compiler contract. If actionLockedByPrompt is true, do not change actionType/actionFamily; explain and refine only timing, contacts, camera intent, and semantic phase hints.",
    "- localCompilerContract.actionSequence is already the local parser's ordered motion plan. Do not reorder it, replace it, or add unrelated action phases; use keyframeHints only as semantic annotations near the existing stages.",
    "- fixedPoseConstraints and middleKeyframeConstraints are hard pose constraints equal in importance to startPose and endPose. Your intent must pass through them at their exact time ratios and describe only the motion between neighboring fixed poses.",
    "- fixedPoseSegments is the ordered relationship contract between adjacent hard keyframes. Build motionDraft.phasePlan, transformKeyframes, boneKeyframes, contactFrames, timing, and promptRequirementMap around these segments. Do not plan one blind global motion from start to end when middle segments exist.",
    "- Each motionDraft phase/keyframe should either sit inside one fixedPoseSegments time window or explain how it bridges that exact segment. Do not place a phase/keyframe that semantically contradicts the fixed segment's from/to pose delta.",
    "- If middleKeyframeConstraints exist, keyframeHints should support those checkpoints instead of overwriting, smoothing away, or moving them.",
    "- localCompilerContract.actionChains identify fixed compound-action meaning from the prompt. Mention these chains in intent/generatedMotionPrompt and keep their qualityExpectationIds satisfied.",
    "- For approach_contact chains, describe approach/deceleration/contact/force instead of treating the prompt as only locomotion or only pushing.",
    "- For turn_throw chains, describe turn/twist/windup/release/recovery in that order and keep feet grounded unless the prompt explicitly asks for a jump throw.",
    "- For low_recovery_attack chains, describe low dodge/block, rising recovery, then the final attack; do not collapse it into only crouch or only punch.",
    "- localCompilerContract.promptControl is the user's parsed control layer. Preserve its direction, speed, force, timingTags, stageTags, and bodyTags in your semantic explanation and generatedMotionPrompt.",
    "- localCompilerContract.forbiddenOutputFields applies to top-level/final animation output. The only allowed structured intermediate keyframes or action-base hints are inside motionDraft.primitiveHints, motionDraft.transformKeyframes, motionDraft.boneKeyframes, and motionDraft.contactFrames.",
    "- Use availableSemanticStageTemplates to choose or refine semantic stages. Use motionDraft to explain the executable middle planning without replacing fixed start/end/middle constraints.",
    "- Use availableActionSkills as the executable skill contract. If your interpretation conflicts with a listed skill's grounded, allowAirborne, rootLimits, or quality targets, prefer the local skill contract and add a warning instead of inventing a new motion style.",
    "- Use localCompilerContract.qualityExpectations as the acceptance criteria for generatedMotionPrompt, keyframeHints, and contactHints. For example, if it includes gait, support, hand_contact, throw_release, punch_recovery, or prop_contact_motion, your intent must describe how those expectations are satisfied.",
    "- Prefer realistic human or 3D-game motion. Do not add exaggerated animation, random mid-air flips, sudden spins, drifting feet, or unrelated whole-body swings unless the user explicitly asks for 夸张, 翻滚, 飞跃, 浮空, or 离地.",
    "- Ground actions such as walk, run, push, throw, punch, block, crouch, crawl, and turn must keep feet, knees, hands, or body contacts physically plausible. Only jump, fly, or airborne prompts should use obvious verticalLift.",
    "- For push: use brace, contact, force, hold or recover semantics; both feet stay grounded and hands contact the target.",
    "- For throw: use anticipation, torso twist, release, recovery; the throwing hand leads and feet stay grounded unless the prompt says jump throw.",
    "- For walk/run: use small alternating leg steps and opposite arm swing; do not treat locomotion as dance or acrobatics.",
    "- For combat: use guard, strike/contact, recovery with controlled amplitude; do not use random flailing.",
    "- If localSemanticPlan says 双手推 / two-hand push, keep both hands involved. If it says right hand, left hand, feet grounded, low center, or camera motion, preserve that intent unless impossible.",
    "- Convert the action prompt into compatible MotionIntent parameters and a MotionDraft that maps prompt requirements to middle phases, middle root keyframes, middle bone keyframes, contact events, constraints, and timing.",
    "- Explain the physical meaning of the action through intent, motionFamilies, keyframeHints, contacts, bodyLean, crouch, lift, rhythm, and warnings.",
    "- Keyframe hints are semantic anchors for the local compiler; they must not contain raw joint rotations or per-frame bone values.",
    "- Camera motion hints must stay generic and deterministic: dolly, truck, orbit, follow, tilt, handheld, or close follow.",
    "- If the prompt describes camera movement, it has priority over generic camera defaults. For examples like 环绕360°, orbit 360 degrees, or 360 orbit, set cameraMotionHint.type to orbit and orbitAngleDeg to 360.",
    "- For combat prompts such as fight, punch, block, guard, kick, 打斗, 格斗, 出拳, 格挡, 防守, 侧踢, set motionFamilies to include combat, use rhythm impact, describe anticipation/contact/recovery keyframeHints, keep feet/contact balance explicit, and include cameraMotionHint when the prompt requests 运镜, 环绕, 推近, 跟随, or 特写.",
    "- Never fail just because the action does not match a known template.",
    "- If the action includes stepping, reaching, falling, rolling, jumping, looking, dodging, or recovering, express that through direction/distance/turnDeg/roll/crouch/verticalLift/bodyLean/armSwing/rhythm/contacts/lookAt.",
    "- If the prompt is underspecified, add warnings and choose conservative readable motion."
  ].join("\n");
}

function scene3dMotionRefineCompactSystemPrompt() {
  return [
    "You are a 3D character animation planning assistant for a node-based Scene3D director tool.",
    "Return strict JSON only. Do not return Markdown or prose outside JSON.",
    "The caller owns fixed start/end and middle keyframes. Do not include draft keyframes at 0 seconds or at durationSec.",
    "Generate motionIntent and motionDraft only. Add interactionDraft only if the prompt explicitly needs multiple actors or prop interaction.",
    "Do not generate animationClip, samples, tracks, raw frames, video URLs, fake progress, or final rendered output.",
    "Use availableMotionPrimitives as executable local action bases. For run choose run_forward; for push choose push_forward. Add primitiveHints instead of final animation samples.",
    "Use only existing ids from the compact context. If a target is missing, warn instead of inventing ids.",
    "Keep motionDraft concise but executable: 3-6 phasePlan items, 1-4 transformKeyframes, 4-12 boneKeyframes for key joints, and contactFrames when feet/hands/head contact matters.",
    "For walk/run/dash, include alternating feet contacts, opposite arm swing, grounded root motion, and recovery/settle.",
    "For crouch/jump/fall/get_up/reach/turn/combat, include anticipation, main action/contact/release when relevant, and recover/settle.",
    "Use actionType from: walk, run, dash, push, pull, throw, punch, block, kick, side_kick, jump, crouch, crawl, fall, get_up, turn, reach, idle, unknown.",
    "Use actionFamily from: locomotion, combat, push_pull, throw, jump, fall, crawl, posture, turn, reach, unknown.",
    "Return this top-level shape with valid values:",
    `{
  "motionIntent": {
    "version": 1,
    "intent": "string",
    "durationSec": 1.2,
    "generatedMotionPrompt": "string",
    "direction": { "x": 0, "y": 0, "z": 1 },
    "distance": 0.4,
    "turnDeg": 0,
    "roll": 0,
    "crouch": 0,
    "verticalLift": 0,
    "bodyLean": { "x": 0, "y": 0, "z": 0.15 },
    "armSwing": 0.45,
    "rhythm": "slow | normal | fast | impact | perform",
    "contacts": ["leftFoot", "rightFoot"],
    "lookAt": "none | camera | object | point",
    "targetObjectId": "existing id only when needed",
    "actionFamily": "locomotion",
    "actionType": "run",
    "motionFamilies": ["locomotion"],
    "keyframeHints": [{ "timeRatio": 0.5, "label": "main action", "note": "string" }],
    "contactHints": [{ "timeSec": 0.4, "contact": "rightFoot", "note": "string" }],
    "cameraMotionHint": { "enabled": false, "type": "none", "intensity": 0, "startTimeSec": 0, "endTimeSec": 1.2, "distance": 1.2, "heightOffset": 0, "orbitAngleDeg": 0, "keepCharacterInFrame": true },
    "warnings": [],
    "confidence": 0.75
  },
  "motionDraft": {
    "version": 1,
    "actionIntent": "string",
    "durationSec": 1.2,
    "fpsHint": 60,
    "generatedMotionPrompt": "string",
    "promptRequirements": [{ "id": "req_1", "text": "string", "category": "action", "priority": "high" }],
    "promptRequirementMap": [{ "requirementId": "req_1", "appliedTo": [{ "kind": "phase", "id": "phase_1" }], "note": "string" }],
    "phasePlan": [{ "id": "phase_1", "label": "launch", "startSec": 0.15, "endSec": 0.45, "purpose": "string", "keyJoints": ["chest", "rightUpperArm"], "contacts": ["leftFoot"], "requirementIds": ["req_1"] }],
    "transformKeyframes": [{ "id": "root_1", "timeSec": 0.45, "position": { "x": 0, "y": 0, "z": 0.25 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "phaseId": "phase_1", "requirementIds": ["req_1"], "note": "string" }],
    "boneKeyframes": [{ "id": "bone_1", "timeSec": 0.45, "joint": "rightUpperArm", "rotation": { "x": 25, "y": 0, "z": -12 }, "phaseId": "phase_1", "requirementIds": ["req_1"], "note": "string" }],
    "contactFrames": [{ "id": "contact_1", "timeSec": 0.35, "contact": "rightFoot", "type": "ground", "phaseId": "phase_1", "requirementIds": ["req_1"], "note": "string" }],
    "constraints": [{ "id": "constraint_1", "type": "grounding", "startSec": 0.05, "endSec": 1.15, "joints": ["leftFoot", "rightFoot"], "requirementIds": ["req_1"], "note": "string" }],
    "primitiveHints": [{ "primitiveId": "run_forward", "actionType": "run", "phaseId": "phase_1", "startSec": 0, "endSec": 1.2, "requirementIds": ["req_1"], "reason": "local executable run gait base" }],
    "timing": { "anticipation": 0.12, "mainActionStart": 0.25, "mainActionEnd": 0.95, "settle": 1.1 },
    "warnings": [],
    "confidence": 0.75
  }
}`
  ].join("\n");
}

function scene3dMotionRefineCompactUserPrompt(input: { request: Scene3DMotionRefineRequest; node: any }) {
  const compilerContract = scene3DLocalCompilerContract(input.request);
  return [
    `Node id: ${input.request.nodeId}.`,
    `Transition id: ${input.request.transitionId}.`,
    `Selected character id: ${input.request.selectedCharacterId}.`,
    `Duration: ${input.request.durationSec}s.`,
    `Curve: ${input.request.curve}.`,
    `Action prompt: ${input.request.actionPrompt}`,
    "Hard start/end summary:",
    compactJson({
      startTransform: input.request.startTransform,
      endTransform: input.request.endTransform,
      startPose: input.request.startPose,
      endPose: input.request.endPose
    }, 2200),
    "Compiler contract summary:",
    compactJson({
      actionType: compilerContract.actionType,
      actionFamily: compilerContract.actionFamily,
      contacts: compilerContract.contacts,
      actionSequence: compilerContract.actionSequence,
      poseStages: compilerContract.poseStages,
      promptControl: compilerContract.promptControl,
      fixedPoseConstraints: input.request.fixedPoseConstraints,
      fixedPoseSegments: input.request.fixedPoseSegments,
      middleKeyframeConstraints: input.request.middleKeyframeConstraints,
      promptRequirementGraph: input.request.promptRequirementGraph,
      motionStyleProfile: input.request.motionStyleProfile,
      negativeConstraints: input.request.negativeConstraints,
      availableMotionPrimitives: input.request.availableMotionPrimitives,
      motionPrimitiveInstruction: input.request.motionPrimitiveInstruction
    }, 3200),
    "Compact scene objects:",
    compactJson({
      currentCharacterTransform: input.request.currentCharacterTransform,
      characters: input.request.characters,
      props: input.request.props,
      cameras: input.request.cameras,
      activeCameraId: input.request.activeCameraId || null
    }, 2200),
    "Rules:",
    "- Preserve actionType/actionFamily from compiler contract unless actionType is unknown.",
    "- Preserve promptRequirementGraph requirement ids in motionDraft.promptRequirements and promptRequirementMap.",
    "- Obey negativeConstraints and hard keyframes first.",
    "- Choose primitiveHints from availableMotionPrimitives. For 跑步/run use run_forward; do not return samples or tracks.",
    "- Use fixedPoseSegments to plan phase/keyframe/contact timing between adjacent hard keyframes. Do not plan one blind global start-to-end motion when middle keyframes exist.",
    "- Keep all motionDraft keyframes strictly inside (0, durationSec).",
    "- For the prompt 跑步/run, return run locomotion with alternating foot contacts, arm swing boneKeyframes, grounded root motion, and recover/settle."
  ].join("\n");
}

function scene3dMotionRefineUltraSystemPrompt() {
  return [
    "Return strict JSON only.",
    "You create a compact Scene3D motion plan, not final animation.",
    "Never output animationClip, samples, tracks, video, URLs, fake progress, or rendered results.",
    "Use availableMotionPrimitives through motionDraft.primitiveHints. For run choose run_forward; for push choose push_forward.",
    "Do not modify start/end frames. All draft keyframes must be inside 0 < timeSec < durationSec.",
    "Keep the answer short. Prefer 2-4 phases, 1-3 root keyframes, 4-8 bone keyframes, and 2-4 contact frames.",
    "For run/walk/dash, include alternating foot contacts and opposite arm swing.",
    "For jump, include crouch, lift, land, recover.",
    "For turn/reach/crouch/fall/get_up/combat, include anticipation, main action/contact when relevant, and recover.",
    "Allowed joints: pelvis, chest, neck, head, leftUpperArm, leftLowerArm, leftHand, rightUpperArm, rightLowerArm, rightHand, leftUpperLeg, leftLowerLeg, leftFoot, rightUpperLeg, rightLowerLeg, rightFoot.",
    "Return this compact top-level shape:",
    `{
  "motionIntent": {
    "version": 1,
    "intent": "run forward",
    "durationSec": 1.2,
    "generatedMotionPrompt": "grounded run with alternating footfalls and arm swing",
    "direction": { "x": 0, "y": 0, "z": 1 },
    "distance": 0.6,
    "turnDeg": 0,
    "roll": 0,
    "crouch": 0.05,
    "verticalLift": 0,
    "bodyLean": { "x": 0.12, "y": 0, "z": 0.18 },
    "armSwing": 0.55,
    "rhythm": "fast",
    "contacts": ["leftFoot", "rightFoot"],
    "lookAt": "none",
    "actionFamily": "locomotion",
    "actionType": "run",
    "motionFamilies": ["locomotion"],
    "keyframeHints": [{ "timeRatio": 0.5, "label": "running stride", "note": "opposite arm and leg swing" }],
    "contactHints": [{ "timeSec": 0.3, "contact": "leftFoot", "note": "left foot plant" }, { "timeSec": 0.75, "contact": "rightFoot", "note": "right foot plant" }],
    "cameraMotionHint": { "enabled": false, "type": "none", "intensity": 0, "startTimeSec": 0, "endTimeSec": 1.2, "distance": 1.2, "heightOffset": 0, "orbitAngleDeg": 0, "keepCharacterInFrame": true },
    "warnings": [],
    "confidence": 0.75
  },
  "motionDraft": {
    "version": 1,
    "actionIntent": "run forward",
    "durationSec": 1.2,
    "fpsHint": 60,
    "generatedMotionPrompt": "grounded run with alternating footfalls and arm swing",
    "promptRequirements": [{ "id": "req_action", "text": "run", "category": "action", "priority": "high" }],
    "promptRequirementMap": [{ "requirementId": "req_action", "appliedTo": [{ "kind": "phase", "id": "phase_stride" }], "note": "run is mapped to stride phase" }],
    "phasePlan": [{ "id": "phase_launch", "label": "launch", "startSec": 0.12, "endSec": 0.32, "purpose": "start running", "keyJoints": ["pelvis", "chest"], "contacts": ["rightFoot"], "requirementIds": ["req_action"] }, { "id": "phase_stride", "label": "stride", "startSec": 0.32, "endSec": 0.9, "purpose": "alternating steps and arm swing", "keyJoints": ["leftUpperArm", "rightUpperArm", "leftUpperLeg", "rightUpperLeg"], "contacts": ["leftFoot", "rightFoot"], "requirementIds": ["req_action"] }, { "id": "phase_recover", "label": "recover", "startSec": 0.9, "endSec": 1.08, "purpose": "settle without sliding", "keyJoints": ["pelvis", "chest"], "contacts": ["leftFoot"], "requirementIds": ["req_action"] }],
    "transformKeyframes": [{ "id": "root_stride", "timeSec": 0.6, "position": { "x": 0, "y": 0, "z": 0.35 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "phaseId": "phase_stride", "requirementIds": ["req_action"], "note": "forward grounded root travel" }],
    "boneKeyframes": [{ "id": "left_arm_back", "timeSec": 0.35, "joint": "leftUpperArm", "rotation": { "x": -24, "y": 0, "z": 8 }, "phaseId": "phase_stride", "requirementIds": ["req_action"], "note": "left arm back" }, { "id": "right_arm_forward", "timeSec": 0.35, "joint": "rightUpperArm", "rotation": { "x": 24, "y": 0, "z": -8 }, "phaseId": "phase_stride", "requirementIds": ["req_action"], "note": "right arm forward" }, { "id": "left_leg_forward", "timeSec": 0.35, "joint": "leftUpperLeg", "rotation": { "x": 18, "y": 0, "z": 0 }, "phaseId": "phase_stride", "requirementIds": ["req_action"], "note": "left leg forward" }, { "id": "right_leg_back", "timeSec": 0.35, "joint": "rightUpperLeg", "rotation": { "x": -18, "y": 0, "z": 0 }, "phaseId": "phase_stride", "requirementIds": ["req_action"], "note": "right leg back" }],
    "contactFrames": [{ "id": "left_foot_plant", "timeSec": 0.3, "contact": "leftFoot", "type": "ground", "phaseId": "phase_stride", "requirementIds": ["req_action"], "note": "left foot plant" }, { "id": "right_foot_plant", "timeSec": 0.75, "contact": "rightFoot", "type": "ground", "phaseId": "phase_stride", "requirementIds": ["req_action"], "note": "right foot plant" }],
    "constraints": [{ "id": "grounded", "type": "grounding", "startSec": 0.05, "endSec": 1.15, "joints": ["leftFoot", "rightFoot"], "requirementIds": ["req_action"], "note": "keep run grounded" }],
    "primitiveHints": [{ "primitiveId": "run_forward", "actionType": "run", "phaseId": "phase_stride", "startSec": 0, "endSec": 1.2, "requirementIds": ["req_action"], "reason": "local executable run gait base" }],
    "timing": { "anticipation": 0.12, "mainActionStart": 0.28, "mainActionEnd": 0.95, "settle": 1.08 },
    "warnings": [],
    "confidence": 0.75
  }
}`
  ].join("\n");
}

function scene3dMotionRefineUltraUserPrompt(input: { request: Scene3DMotionRefineRequest; node: any }) {
  const compilerContract = scene3DLocalCompilerContract(input.request);
  return [
    `Action prompt: ${input.request.actionPrompt}`,
    `durationSec: ${input.request.durationSec}`,
    `selectedCharacterId: ${input.request.selectedCharacterId}`,
    `local actionType: ${compilerContract.actionType || "unknown"}`,
    `local actionFamily: ${compilerContract.actionFamily || "unknown"}`,
    `local contacts: ${JSON.stringify(compilerContract.contacts || [])}`,
    `local sequence: ${compactJson(compilerContract.actionSequence || [], 800)}`,
    `available primitives: ${compactJson(input.request.availableMotionPrimitives || [], 900)}`,
    `fixed pose constraints: ${compactJson(input.request.fixedPoseConstraints || [], 1200)}`,
    `fixed pose segments: ${compactJson(input.request.fixedPoseSegments || [], 1200)}`,
    `prompt requirements: ${compactJson(input.request.promptRequirementGraph || {}, 1200)}`,
    `style: ${compactJson(input.request.motionStyleProfile || {}, 700)}`,
    "Hard constraints: no endpoint override, no manual keyframe override, no foot slide, no non-jump airborne motion, no extreme joint rotation.",
    "Primitive constraints: choose primitiveHints only from available primitives; run must use run_forward; do not output samples/tracks.",
    "Use fixed pose segments as the ordered adjacent-keyframe relationship. Plan only inside those segment windows; do not ignore or reinterpret middle keyframes.",
    "Return valid JSON now. Keep it compact."
  ].join("\n");
}

function scene3dMotionRefineShouldUseCompactPrompt(request: Scene3DMotionRefineRequest) {
  const prompt = request.actionPrompt || "";
  const compilerContract = scene3DLocalCompilerContract(request);
  const compoundCount = Array.isArray(compilerContract.actionSequence) ? compilerContract.actionSequence.length : 0;
  const hasCompoundChain = Array.isArray(compilerContract.actionChains) && compilerContract.actionChains.length > 0;
  const interactionPrompt = /推|拉|拿|放|拾|捡|踢|打|击|撞|交接|传递|接住|追|躲|绕|避开|箱|桌|道具|物体|双人|多人|角色.*角色|push|pull|pick|put|kick|hit|strike|handoff|receive|chase|avoid|prop|box|table|object/i.test(prompt);
  return !interactionPrompt && !hasCompoundChain && compoundCount <= 1;
}

function scene3dProviderErrorLooksTimeout(error: any) {
  const text = [
    error?.name,
    error?.message,
    error?.code,
    error?.cause?.name,
    error?.cause?.message,
    error?.details?.error?.message
  ].filter(Boolean).join(" ");
  return /timeout|timed out|abort|aborted|UND_ERR_CONNECT_TIMEOUT|ECONNABORTED|ERR_CANCELED/i.test(text);
}

function scene3dMotionRefineLocalTimeoutFallbackJson(request: Scene3DMotionRefineRequest, reason: string) {
  const compilerContract = scene3DLocalCompilerContract(request);
  const prompt = request.actionPrompt || "motion";
  const inferredActionType = String(compilerContract.actionType || (/run|dash|sprint/i.test(prompt) ? "run" : /walk/i.test(prompt) ? "walk" : "unknown"));
  const allowedActionTypes = new Set(scene3dMotionSemanticActionTypeSchema.options);
  const actionType = allowedActionTypes.has(inferredActionType as any) ? inferredActionType : "unknown";
  const inferredActionFamily = String(compilerContract.actionFamily || (actionType === "run" || actionType === "walk" || actionType === "dash" ? "locomotion" : "unknown"));
  const allowedActionFamilies = new Set(scene3dMotionSemanticActionFamilySchema.options);
  const actionFamily = allowedActionFamilies.has(inferredActionFamily as any) ? inferredActionFamily : "unknown";
  const familyToMotionFamily: Record<string, string[]> = {
    locomotion: ["locomotion"],
    combat: ["combat"],
    push_pull: ["reach"],
    throw: ["reach"],
    jump: ["locomotion"],
    fall: ["fall"],
    crawl: ["crawl"],
    posture: ["kneel"],
    turn: ["turn"],
    reach: ["reach"],
    unknown: []
  };
  const durationSec = request.durationSec;
  const t = (ratio: number) => Number(Math.min(Math.max(durationSec * ratio, 0.01), Math.max(0.011, durationSec - 0.01)).toFixed(4));
  const end = (ratio: number) => Number(Math.min(durationSec, Math.max(0, durationSec * ratio)).toFixed(4));
  const isJump = actionType === "jump";
  const isRunLike = actionType === "run" || actionType === "dash" || actionType === "walk" || actionFamily === "locomotion";
  const rhythm = actionType === "dash" || actionType === "run" ? "fast" : "normal";
  const contacts = isJump ? ["leftFoot", "rightFoot"] : isRunLike ? ["leftFoot", "rightFoot"] : (compilerContract.contacts?.length ? compilerContract.contacts : ["leftFoot", "rightFoot"]);
  const startPosition = coerceScene3DVec3((request.startTransform as any)?.position);
  const endPosition = coerceScene3DVec3((request.endTransform as any)?.position, startPosition);
  const fixedConstraintList = Array.isArray(request.fixedPoseConstraints) ? request.fixedPoseConstraints : [];
  const fixedConstraintById = new Map<string, any>();
  fixedConstraintList.forEach((item: any) => {
    const id = typeof item?.id === "string" ? item.id : "";
    if (id) fixedConstraintById.set(id, item);
  });
  const frameForSegmentEndpoint = (endpoint: any, fallbackTransform: any) => {
    const byId = typeof endpoint?.id === "string" ? fixedConstraintById.get(endpoint.id) : undefined;
    if (byId) return byId;
    const endpointTime = coerceScene3DNumber(endpoint?.timeSec, -1, -1, durationSec + 1);
    return fixedConstraintList.find((item: any) => Math.abs(coerceScene3DNumber(item?.timeSec, -1000, -1000, durationSec + 1000) - endpointTime) <= 0.002) || {
      id: typeof endpoint?.id === "string" ? endpoint.id : "",
      label: typeof endpoint?.label === "string" ? endpoint.label : "",
      timeSec: endpointTime,
      transform: fallbackTransform
    };
  };
  const safeInteriorTime = (timeSec: number, segmentStartSec = 0, segmentEndSec = durationSec) => {
    const segmentDuration = Math.max(0.001, segmentEndSec - segmentStartSec);
    const padding = Math.min(0.04, Math.max(0.006, segmentDuration * 0.08));
    const minTime = Math.max(0.01, segmentStartSec + padding);
    const maxTime = Math.min(Math.max(0.011, durationSec - 0.01), segmentEndSec - padding);
    if (maxTime <= minTime) return t(0.5);
    return Number(Math.min(Math.max(timeSec, minTime), maxTime).toFixed(4));
  };
  const fixedSegments = Array.isArray(request.fixedPoseSegments) ? request.fixedPoseSegments : [];
  const segmentWindows = fixedSegments.map((segment: any, index: number) => {
    const startSec = coerceScene3DNumber(segment?.from?.timeSec, Number.NaN, 0, durationSec);
    const endSec = coerceScene3DNumber(segment?.to?.timeSec, Number.NaN, 0, durationSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec - startSec < 0.03) return undefined;
    const fromFrame = frameForSegmentEndpoint(segment?.from, { position: startPosition });
    const toFrame = frameForSegmentEndpoint(segment?.to, { position: endPosition });
    const fromPosition = coerceScene3DVec3(fromFrame?.transform?.position, startPosition);
    const toPosition = coerceScene3DVec3(toFrame?.transform?.position, endPosition);
    const duration = endSec - startSec;
    return {
      id: typeof segment?.id === "string" && segment.id ? segment.id.slice(0, 80) : `fixed_segment_${index + 1}`,
      index,
      startSec: Number(startSec.toFixed(4)),
      endSec: Number(endSec.toFixed(4)),
      midSec: safeInteriorTime(startSec + duration * 0.5, startSec, endSec),
      contactASec: safeInteriorTime(startSec + duration * 0.32, startSec, endSec),
      contactBSec: safeInteriorTime(startSec + duration * 0.68, startSec, endSec),
      fromLabel: typeof segment?.from?.label === "string" && segment.from.label ? segment.from.label.slice(0, 80) : `frame ${index + 1}`,
      toLabel: typeof segment?.to?.label === "string" && segment.to.label ? segment.to.label.slice(0, 80) : `frame ${index + 2}`,
      fromPosition,
      toPosition,
      travelDistance: coerceScene3DNumber(segment?.transformDelta?.travelDistance, Math.hypot(toPosition.x - fromPosition.x, toPosition.z - fromPosition.z), 0, 200)
    };
  }).filter(Boolean) as Array<{
    id: string;
    index: number;
    startSec: number;
    endSec: number;
    midSec: number;
    contactASec: number;
    contactBSec: number;
    fromLabel: string;
    toLabel: string;
    fromPosition: { x: number; y: number; z: number };
    toPosition: { x: number; y: number; z: number };
    travelDistance: number;
  }>;
  const travelX = endPosition.x - startPosition.x;
  const travelZ = endPosition.z - startPosition.z;
  const requestedTravelDistance = Math.hypot(travelX, travelZ);
  const fallbackDistance = actionType === "dash" ? 0.9 : actionType === "run" ? 0.65 : actionType === "walk" ? 0.35 : 0.25;
  const distance = Number(Math.max(fallbackDistance, requestedTravelDistance || 0).toFixed(4));
  const midPosition = {
    x: Number(((startPosition.x + endPosition.x) * 0.5).toFixed(4)),
    y: Number(((startPosition.y + endPosition.y) * 0.5 + (isJump ? 0.35 : 0)).toFixed(4)),
    z: Number(((startPosition.z + endPosition.z) * 0.5).toFixed(4))
  };
  const direction = requestedTravelDistance > 0.001
    ? { x: Number((travelX / requestedTravelDistance).toFixed(4)), y: 0, z: Number((travelZ / requestedTravelDistance).toFixed(4)) }
    : { x: 0, y: 0, z: 1 };
  const warnings = [
    "AI 服务响应超时，已使用 3D导演台本地动作规划完成解析。"
  ];
  if (segmentWindows.length) {
    warnings.push(`Local fallback respected ${segmentWindows.length} fixed pose segments, including manual middle keyframes.`);
  }
  const reqId = "req_action";
  const actionText = actionType === "unknown" ? prompt.slice(0, 80) : actionType;
  const phasePlan = segmentWindows.length
    ? segmentWindows.map((segment) => ({
      id: `phase_${segment.id}`.slice(0, 80),
      label: segment.index === 0 ? (isJump ? "anticipation segment" : "launch segment") : segment.index === segmentWindows.length - 1 ? "recover segment" : isRunLike ? "stride segment" : "motion segment",
      startSec: segment.startSec,
      endSec: segment.endSec,
      purpose: `Follow fixed hard-keyframe segment ${segment.fromLabel} -> ${segment.toLabel}; plan only inside this adjacent segment.`,
      keyJoints: isJump
        ? ["pelvis", "chest", "leftUpperLeg", "rightUpperLeg"]
        : isRunLike
          ? ["leftUpperArm", "rightUpperArm", "leftUpperLeg", "rightUpperLeg"]
          : ["pelvis", "chest"],
      contacts: contacts.slice(0, 4),
      requirementIds: [reqId]
    }))
    : isJump
    ? [
      { id: "phase_crouch", label: "crouch", startSec: 0, endSec: end(0.25), purpose: "anticipation before jump", keyJoints: ["pelvis", "chest"], contacts: ["leftFoot", "rightFoot"], requirementIds: [reqId] },
      { id: "phase_lift", label: "lift", startSec: end(0.25), endSec: end(0.65), purpose: "vertical lift", keyJoints: ["pelvis", "leftUpperLeg", "rightUpperLeg"], contacts: [], requirementIds: [reqId] },
      { id: "phase_land", label: "land", startSec: end(0.65), endSec: durationSec, purpose: "land and recover", keyJoints: ["pelvis", "leftFoot", "rightFoot"], contacts: ["leftFoot", "rightFoot"], requirementIds: [reqId] }
    ]
    : [
      { id: "phase_launch", label: "launch", startSec: 0, endSec: end(0.25), purpose: "start action", keyJoints: ["pelvis", "chest"], contacts: [contacts[0] || "leftFoot"], requirementIds: [reqId] },
      { id: "phase_stride", label: isRunLike ? "stride" : "main action", startSec: end(0.25), endSec: end(0.78), purpose: isRunLike ? "alternating steps and arm swing" : "main motion", keyJoints: ["leftUpperArm", "rightUpperArm", "leftUpperLeg", "rightUpperLeg"], contacts: contacts.slice(0, 4), requirementIds: [reqId] },
      { id: "phase_recover", label: "recover", startSec: end(0.78), endSec: durationSec, purpose: "settle without sliding", keyJoints: ["pelvis", "chest"], contacts: [contacts[1] || contacts[0] || "rightFoot"], requirementIds: [reqId] }
    ];
  const segmentTransformKeyframes = segmentWindows.map((segment) => ({
    id: `root_${segment.id}`.slice(0, 80),
    timeSec: segment.midSec,
    position: {
      x: Number(((segment.fromPosition.x + segment.toPosition.x) * 0.5).toFixed(4)),
      y: Number(((segment.fromPosition.y + segment.toPosition.y) * 0.5 + (isJump ? 0.22 : 0)).toFixed(4)),
      z: Number(((segment.fromPosition.z + segment.toPosition.z) * 0.5).toFixed(4))
    },
    rotation: { x: 0, y: 0, z: 0 },
    phaseId: `phase_${segment.id}`.slice(0, 80),
    requirementIds: [reqId],
    note: `Segment midpoint aligned to fixed hard-keyframe segment ${segment.fromLabel} -> ${segment.toLabel}.`
  }));
  const segmentBoneKeyframes = segmentWindows.slice(0, 10).flatMap((segment, segmentIndex) => {
    const strideSign = segmentIndex % 2 === 0 ? 1 : -1;
    const phaseId = `phase_${segment.id}`.slice(0, 80);
    return [
      { id: `left_arm_${segment.id}`.slice(0, 80), timeSec: segment.midSec, joint: "leftUpperArm", rotation: { x: isRunLike ? -26 * strideSign : -8, y: 0, z: 8 }, phaseId, requirementIds: [reqId], note: "segment-aware left arm counter swing" },
      { id: `right_arm_${segment.id}`.slice(0, 80), timeSec: segment.midSec, joint: "rightUpperArm", rotation: { x: isRunLike ? 26 * strideSign : 8, y: 0, z: -8 }, phaseId, requirementIds: [reqId], note: "segment-aware right arm counter swing" },
      { id: `left_leg_${segment.id}`.slice(0, 80), timeSec: segment.midSec, joint: "leftUpperLeg", rotation: { x: isJump ? -18 : 20 * strideSign, y: 0, z: 0 }, phaseId, requirementIds: [reqId], note: "segment-aware left leg action" },
      { id: `right_leg_${segment.id}`.slice(0, 80), timeSec: segment.midSec, joint: "rightUpperLeg", rotation: { x: isJump ? -18 : -20 * strideSign, y: 0, z: 0 }, phaseId, requirementIds: [reqId], note: "segment-aware right leg action" }
    ];
  });
  const segmentContactFrames = segmentWindows.slice(0, 12).flatMap((segment, segmentIndex) => {
    const phaseId = `phase_${segment.id}`.slice(0, 80);
    const contactCount = Math.max(1, contacts.length);
    const firstContact = contacts[segmentIndex % contactCount] || "leftFoot";
    const secondContact = contacts[(segmentIndex + 1) % contactCount] || contacts[0] || "rightFoot";
    return [
      { id: `contact_a_${segment.id}`.slice(0, 80), timeSec: segment.contactASec, contact: firstContact as any, type: "ground", phaseId, requirementIds: [reqId], note: `first contact inside fixed segment ${segment.fromLabel} -> ${segment.toLabel}` },
      { id: `contact_b_${segment.id}`.slice(0, 80), timeSec: segment.contactBSec, contact: secondContact as any, type: "ground", phaseId, requirementIds: [reqId], note: `second contact inside fixed segment ${segment.fromLabel} -> ${segment.toLabel}` }
    ];
  }).slice(0, 32);
  const mappedPhaseIds = phasePlan.map((phase: any) => phase.id).slice(0, 12);
  const primitiveId = actionType === "run"
    ? "run_forward"
    : actionType === "dash"
      ? "dash_forward"
      : actionType === "walk"
        ? "walk_forward"
        : actionType === "push"
          ? "push_forward"
          : actionType === "pull"
            ? "pull_backward"
            : actionType === "jump"
              ? "jump_up"
              : actionType === "crouch"
                ? "crouch_down"
                : actionType === "reach"
                  ? "reach_forward"
                  : actionType === "turn"
                    ? "turn_in_place"
                    : undefined;
  const motionDraft = {
    version: 1,
    actionIntent: prompt.slice(0, 300),
    durationSec,
    fpsHint: 60,
    generatedMotionPrompt: segmentWindows.length
      ? `Deterministic local ${actionText} motion plan constrained by ${segmentWindows.length} adjacent fixed pose segments.`
      : `Deterministic local ${actionText} motion plan with fixed endpoints preserved.`,
    promptRequirements: [{ id: reqId, text: prompt.slice(0, 300), category: "action", priority: "high" }],
    promptRequirementMap: [{
      requirementId: reqId,
      appliedTo: mappedPhaseIds.length
        ? mappedPhaseIds.map((id: string) => ({ kind: "phase", id }))
        : [{ kind: "phase", id: phasePlan[1]?.id || phasePlan[0].id }],
      note: segmentWindows.length
        ? "Mapped by deterministic local fallback across every fixed adjacent pose segment after provider timeout."
        : "Mapped by deterministic local fallback after provider timeout."
    }],
    phasePlan,
    transformKeyframes: segmentTransformKeyframes.length ? segmentTransformKeyframes : [{
      id: "root_mid",
      timeSec: t(0.5),
      position: midPosition,
      rotation: { x: 0, y: 0, z: 0 },
      phaseId: phasePlan[1]?.id || phasePlan[0].id,
      requirementIds: [reqId],
      note: "Middle root motion from local fallback, aligned to fixed start/end transforms."
    }],
    boneKeyframes: segmentBoneKeyframes.length ? segmentBoneKeyframes.slice(0, 80) : [
      { id: "left_arm", timeSec: t(0.35), joint: "leftUpperArm", rotation: { x: isRunLike ? -24 : -8, y: 0, z: 8 }, phaseId: phasePlan[1]?.id || phasePlan[0].id, requirementIds: [reqId], note: "left arm counter swing" },
      { id: "right_arm", timeSec: t(0.35), joint: "rightUpperArm", rotation: { x: isRunLike ? 24 : 8, y: 0, z: -8 }, phaseId: phasePlan[1]?.id || phasePlan[0].id, requirementIds: [reqId], note: "right arm counter swing" },
      { id: "left_leg", timeSec: t(0.35), joint: "leftUpperLeg", rotation: { x: isJump ? -18 : 18, y: 0, z: 0 }, phaseId: phasePlan[1]?.id || phasePlan[0].id, requirementIds: [reqId], note: "left leg action" },
      { id: "right_leg", timeSec: t(0.35), joint: "rightUpperLeg", rotation: { x: isJump ? -18 : -18, y: 0, z: 0 }, phaseId: phasePlan[1]?.id || phasePlan[0].id, requirementIds: [reqId], note: "right leg action" }
    ],
    contactFrames: segmentContactFrames.length ? segmentContactFrames : [
      { id: "contact_a", timeSec: t(0.28), contact: (contacts[0] || "leftFoot") as any, type: "ground", phaseId: phasePlan[0].id, requirementIds: [reqId], note: "first stable contact" },
      { id: "contact_b", timeSec: t(0.68), contact: (contacts[1] || contacts[0] || "rightFoot") as any, type: "ground", phaseId: phasePlan[1]?.id || phasePlan[0].id, requirementIds: [reqId], note: "second stable contact" }
    ],
    constraints: [{ id: "grounded", type: "grounding", startSec: 0, endSec: durationSec, joints: ["leftFoot", "rightFoot"], requirementIds: [reqId], note: "Preserve grounded contact unless the action is airborne." }],
    primitiveHints: primitiveId ? [{
      primitiveId,
      actionType,
      phaseId: phasePlan[1]?.id || phasePlan[0]?.id,
      startSec: 0,
      endSec: durationSec,
      requirementIds: [reqId],
      reason: `Deterministic timeout fallback selects local executable primitive ${primitiveId}.`
    }] : [],
    timing: { anticipation: end(0.12), mainActionStart: end(0.25), mainActionEnd: end(0.82), settle: end(0.92) },
    warnings,
    confidence: 0.55
  };
  return JSON.stringify({
    motionIntent: {
      version: 1,
      intent: prompt.slice(0, 1200),
      durationSec,
      generatedMotionPrompt: motionDraft.generatedMotionPrompt,
      direction,
      distance,
      turnDeg: 0,
      roll: 0,
      crouch: isJump ? 0.35 : 0.05,
      verticalLift: isJump ? 0.45 : 0,
      bodyLean: { x: isRunLike ? 0.12 : 0, y: 0, z: isRunLike ? 0.18 : 0.06 },
      armSwing: isRunLike ? 0.55 : 0.25,
      rhythm,
      contacts,
      lookAt: "none",
      actionFamily,
      actionType,
      motionFamilies: familyToMotionFamily[actionFamily] || [],
      keyframeHints: [{ timeRatio: 0.5, label: isRunLike ? "stride" : "main action", note: "Deterministic local fallback semantic anchor." }],
      contactHints: motionDraft.contactFrames.map((frame: any) => ({ timeSec: frame.timeSec, contact: frame.contact, note: frame.note })),
      cameraMotionHint: { enabled: false, type: "none", intensity: 0, startTimeSec: 0, endTimeSec: durationSec, distance: 1.2, heightOffset: 0, orbitAngleDeg: 0, keepCharacterInFrame: true },
      warnings,
      confidence: 0.55
    },
    motionDraft
  });
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
  const useCompactPrompt = scene3dMotionRefineShouldUseCompactPrompt(input.request);
  const promptMode: "full" | "ultra" = useCompactPrompt ? "ultra" : "full";
  const systemPrompt = promptMode === "ultra" ? scene3dMotionRefineUltraSystemPrompt() : scene3dMotionRefineSystemPrompt();
  const userPrompt = promptMode === "ultra" ? scene3dMotionRefineUltraUserPrompt({ request: input.request, node: input.node }) : scene3dMotionRefineUserPrompt({ request: input.request, node: input.node });
  const ultraSystemPrompt = promptMode === "ultra" ? systemPrompt : scene3dMotionRefineUltraSystemPrompt();
  const ultraUserPrompt = promptMode === "ultra" ? userPrompt : scene3dMotionRefineUltraUserPrompt({ request: input.request, node: input.node });
  const runtime = await selectScene3DTextRuntime({ requestUser: input.requestUser, req: input.req, source: "scene3d-motion-refine" });
  if (!runtime) {
    throw new HttpError(503, "No Scene3D motion refinement text model is configured in the model center.", "SCENE3D_MOTION_REFINE_AI_NOT_CONFIGURED");
  }

  const attachments = await resolveScene3DMotionAttachment({
    request: input.request,
    requestUser: input.requestUser,
    textCapabilities: runtime.textCapabilities
  });
  const callProvider = (retryAttachments: ProviderAttachment[], retryLabel: "primary" | "text-only-retry" | "ultra-timeout-retry") => callTextProvider({
    baseUrl: runtime.customUrl,
    apiKey: runtime.customKey,
    modelName: runtime.customModel,
    systemPrompt: retryLabel === "ultra-timeout-retry" ? ultraSystemPrompt : systemPrompt,
    userPrompt: retryLabel === "ultra-timeout-retry" ? ultraUserPrompt : userPrompt,
    attachments: retryLabel === "ultra-timeout-retry" ? [] : retryAttachments,
    timeoutMs: promptMode === "ultra" || retryLabel === "ultra-timeout-retry" ? SCENE3D_MOTION_REFINE_ULTRA_TIMEOUT_MS : SCENE3D_MOTION_REFINE_TIMEOUT_MS,
    maxOutputTokens: promptMode === "full" && retryLabel === "primary" ? 3600 : 1100,
    maxPromptChars: promptMode === "full" && retryLabel === "primary" ? 12000 : 3600,
    isRealtimeSpeed: promptMode === "ultra" || retryLabel === "ultra-timeout-retry",
    temperature: retryLabel === "primary" ? 0.25 : 0.15,
    capabilities: runtime.textCapabilities
  });
  try {
    const response = await callProvider(promptMode === "ultra" ? [] : attachments, "primary");
    return response.text;
  } catch (error: any) {
    if (scene3dProviderErrorLooksTimeout(error)) {
      if (promptMode !== "ultra") {
        try {
          const retryResponse = await callProvider([], "ultra-timeout-retry");
          return retryResponse.text;
        } catch (retryError: any) {
          if (scene3dProviderErrorLooksTimeout(retryError)) {
            return scene3dMotionRefineLocalTimeoutFallbackJson(input.request, summarizeWorkflowError(retryError).message);
          }
          throw new HttpError(502, "Scene3D motion refinement AI provider request failed.", "SCENE3D_MOTION_REFINE_PROVIDER_FAILED", {
            provider: "custom",
            configId: runtime.configId,
            retry: "ultra-timeout",
            error: summarizeWorkflowError(retryError),
            firstError: summarizeWorkflowError(error)
          });
        }
      }
      return scene3dMotionRefineLocalTimeoutFallbackJson(input.request, summarizeWorkflowError(error).message);
    }
    if (attachments.length > 0 || error?.status === 502 || error?.message === "Provider returned empty text.") {
      try {
        const retryResponse = await callProvider([], "text-only-retry");
        return retryResponse.text;
      } catch (retryError: any) {
        if (scene3dProviderErrorLooksTimeout(retryError)) {
          return scene3dMotionRefineLocalTimeoutFallbackJson(input.request, summarizeWorkflowError(retryError).message);
        }
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
      promptMode,
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
  const fallbackNode = body.sceneContext
    ? { id: body.nodeId, type: "scene3d", scene3dState: body.sceneContext }
    : undefined;
  const { node } = await assertScene3DWorkflowNode({ workflowId: body.workflowId, projectId: body.projectId, nodeId: body.nodeId, requestUser, fallbackNode });
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
  return parseScene3DMotionRefineJson(rawText, body);
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

  if (!asset) {
    asset = await prisma.productionAsset.create({
      data: {
        projectId: body.projectId,
        stage: ProductionStage.SHOT_04,
        scope: ProductionAssetScope.PERSONAL,
        reviewStatus: ProductionAssetReviewStatus.UNREVIEWED,
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
  const assets = await prisma.productionAsset.findMany({
    where: {
      projectId: query.projectId,
      scope: ProductionAssetScope.PERSONAL,
      creatorId: requestUser.id,
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
      const motionRefine = await refineScene3DMotion(req, options);
      const { motionIntent, motionDraft, interactionDraft } = motionRefine;
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
          motionDraftPhaseCount: motionDraft?.phasePlan.length || 0,
          motionDraftRootKeyframeCount: motionDraft?.transformKeyframes.length || 0,
          motionDraftBoneKeyframeCount: motionDraft?.boneKeyframes.length || 0,
          motionDraftContactFrameCount: motionDraft?.contactFrames.length || 0,
          interactionActorCount: interactionDraft?.actors.length || 0,
          interactionTargetCount: interactionDraft?.targets.length || 0,
          interactionClipCount: interactionDraft?.interactionClips.length || 0,
          interactionContactCount: interactionDraft?.contacts.length || 0,
          interactionSyncMarkerCount: interactionDraft?.syncMarkers.length || 0,
          interactionPropMotionCount: interactionDraft?.propMotions.length || 0,
          warningCount: motionIntent.warnings.length
        }
      });
      res.json(motionRefine);
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
