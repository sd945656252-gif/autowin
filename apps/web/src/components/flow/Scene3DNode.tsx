import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas as ThreeCanvas, ThreeEvent, useThree } from '@react-three/fiber';
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  Line,
  OrbitControls,
  TransformControls,
  useGLTF
} from '@react-three/drei';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  Box,
  Camera,
  Eye,
  EyeOff,
  ImagePlus,
  Lightbulb,
  Lock,
  Maximize2,
  Move3D,
  Plus,
  Redo2,
  RotateCw,
  Settings2,
  Trash2,
  Undo2,
  Unlock,
  UserRound,
  Users,
  X,
  ZoomIn
} from 'lucide-react';
import { CanvasNode } from '../../types';

// Core data model for the portable Scene3D node.
type Vec3 = { x: number; y: number; z: number };
type TransformMode = 'translate' | 'rotate' | 'scale';
type CharacterGender = 'male' | 'female';
type ObjectKind = 'character' | 'prop' | 'camera' | 'light';
type CurveType = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';
type PoseTab = 'property' | 'pose' | 'transition';
type SceneViewportPresentation = 'editor' | 'clean';
type SceneChangeUpdater = Partial<Scene3DState> | ((current: Scene3DState) => Scene3DState);
type SceneChangeOptions = {
  label?: string;
  history?: boolean;
  mergeKey?: string;
  preserveHistory?: boolean;
  historyBefore?: Scene3DHistorySnapshot;
};
type SceneChangeHandler = (updater: SceneChangeUpdater, options?: SceneChangeOptions) => void;
type ObjectChangeOptions = SceneChangeOptions;
type ObjectChangeHandler = (kind: ObjectKind, id: string, patch: any, options?: ObjectChangeOptions) => void;
type ActionTemplateId =
  | 'look_at'
  | 'turn_to'
  | 'raise_hand'
  | 'wave'
  | 'point_at'
  | 'step_forward'
  | 'step_back'
  | 'sit_down'
  | 'stand_up'
  | 'pick_up'
  | 'put_down';

type RigRotation = { x: number; y: number; z: number };
type PoseJointKey =
  | 'pelvis'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'leftHand'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'rightUpperLeg'
  | 'rightLowerLeg'
  | 'leftFoot'
  | 'rightFoot';

type StandardHumanRigPose = Record<PoseJointKey, RigRotation>;
type BodySide = 'left' | 'right';
type FingerKey = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
type ToeKey = 'leftBase' | 'rightBase' | 'leftTip' | 'rightTip';
type HandFingerPose = {
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
  spread: number;
};
type StandardHumanFingerPose = {
  left: HandFingerPose;
  right: HandFingerPose;
  bones?: Record<string, RigRotation>;
  boneSpace?: 'scene3d-local' | 'runninghub-tv-mixamo';
};
type StandardHumanToePose = Record<ToeKey, RigRotation>;
type Scene3DBonePose = {
  space: 'mixamo-local' | 'scene3d-local';
  bones: Record<string, RigRotation>;
  source?: 'runninghub-tv' | 'scene3d';
  adapter?: 'runninghub-tv-to-xbot';
};
type Scene3DCollectedRig = { byName: Map<string, THREE.Bone>; rest: Map<string, THREE.Quaternion> };

type PoseTransform = {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

type Capture = {
  id: string;
  name: string;
  type: 'director_view_capture' | 'camera_view_capture';
  mediaUrl?: string;
  mediaAssetId?: string;
  width: number;
  height: number;
  cameraId?: string;
  cameraName?: string;
  fov: number;
  cameraPosition: Vec3;
  targetPosition: Vec3;
  aspectRatio: string;
  createdAt: string;
};


type ImportedModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';
type ImportedSceneModel = {
  url: string;
  fileName: string;
  format: ImportedModelFormat;
  importedAt: string;
  runtimeOnly?: boolean;
};
type PropShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus' | 'model';
type LightType = 'ambient' | 'hemisphere' | 'directional' | 'spot' | 'point' | 'rect';
type CameraLensType = 'standard' | 'wide' | 'telephoto' | 'fisheye' | 'orthographic' | 'macro' | 'tilt_shift' | 'panorama';
type CameraTemplateId =
  | 'current'
  | 'front_medium'
  | 'front_wait'
  | 'front_full'
  | 'side_follow'
  | 'side_close'
  | 'back_medium'
  | 'overhead_full'
  | 'dutch_45'
  | 'low_angle_close'
  | 'low_angle_wide'
  | 'over_shoulder'
  | 'over_shoulder_right'
  | 'bird_eye'
  | 'dutch_angle';
type PoseLandmarkKey =
  | 'nose'
  | 'leftEye'
  | 'rightEye'
  | 'leftEar'
  | 'rightEar'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftWrist'
  | 'rightWrist'
  | 'leftHip'
  | 'rightHip'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftAnkle'
  | 'rightAnkle'
  | 'leftToe'
  | 'rightToe';
type PoseLandmarkPoint = { x: number; y: number; visible?: number; depth?: number };
type PoseReferenceContact = {
  point: 'leftFoot' | 'rightFoot' | 'leftHand' | 'rightHand' | 'leftKnee' | 'rightKnee' | 'hip';
  type: 'ground' | 'prop' | 'body' | 'unknown';
  confidence: number;
};
type PoseReferenceLandmarks = {
  version: 1;
  sourceViews: PoseReferenceView[];
  coordinateSpace: 'image-normalized';
  points: Partial<Record<PoseLandmarkKey, PoseLandmarkPoint>>;
  bodyFacing: number;
  torsoLean?: Vec3;
  contacts: PoseReferenceContact[];
  confidence: number;
};
type FoundationPoseId = string;
type Scene3DJointDefinition = {
  key: PoseJointKey;
  label: string;
  parent?: PoseJointKey;
  bones: Array<{ name: string; weight: number }>;
  semanticRoles: string[];
  axes: Record<'x' | 'y' | 'z', {
    axis: 'x' | 'y' | 'z';
    range: [number, number];
    positive: { label: string; effect: string };
    negative: { label: string; effect: string };
    motionRole: string;
  }>;
};
type Scene3DJointAxisProfile = {
  version: 1;
  rigId: 'mixamo-xbot';
  modelUrl: string;
  rotationOrder: 'XYZ';
  applicationMode: 'rest_quaternion_multiply_delta';
  source: { skeleton: string; inspectedAt: string; references: string[] };
  joints: Record<PoseJointKey, Scene3DJointDefinition>;
};
type RunningHubTvBoneName = string;
type LibTvJointAngles = {
  body: { bend: number; turn: number; tilt: number };
  torso: { bend: number; turn: number; tilt: number };
  head: { nod: number; turn: number; tilt: number };
  l_arm: { raise: number; straddle: number; turn: number };
  r_arm: { raise: number; straddle: number; turn: number };
  l_elbow: { bend: number };
  r_elbow: { bend: number };
  l_leg: { raise: number; straddle: number; turn: number };
  r_leg: { raise: number; straddle: number; turn: number };
  l_knee: { bend: number };
  r_knee: { bend: number };
};
type LibTvPosePreset = {
  id: string;
  label: string;
  jointAngles: LibTvJointAngles;
  rootOffset?: Vec3;
  rigPose?: StandardHumanRigPose;
  bonePose?: Scene3DBonePose;
  fingerPose?: StandardHumanFingerPose;
  toePose?: StandardHumanToePose;
};
type UniversalMotionFamily = 'locomotion' | 'turn' | 'roll' | 'fall' | 'get_up' | 'dodge' | 'crawl' | 'kneel' | 'stumble' | 'reach' | 'carry';
type MotionContactHint = 'leftFoot' | 'rightFoot' | 'leftHand' | 'rightHand' | 'head' | 'shoulder' | 'hip' | 'feet' | 'hands';
type UniversalMotionPlan = {
  families?: UniversalMotionFamily[];
  direction: Vec3;
  stride: number;
  turn: number;
  armSwing: number;
  bodyLean: number;
  verticalLift: number;
  crouch: number;
  roll: number;
  rhythm: 'subtle' | 'walk' | 'run' | 'perform' | 'impact';
  contacts?: MotionContactHint[];
  lookAt?: MotionIntent['lookAt'];
  targetObjectId?: string;
};
type MotionIntent = {
  version: 1;
  intent: string;
  durationSec: number;
  generatedMotionPrompt: string;
  direction: Vec3;
  distance: number;
  turnDeg: number;
  roll: number;
  crouch: number;
  verticalLift: number;
  bodyLean: Vec3;
  armSwing: number;
  rhythm: 'slow' | 'normal' | 'fast' | 'impact' | 'perform';
  contacts: MotionContactHint[];
  lookAt: 'none' | 'camera' | 'object' | 'point';
  targetObjectId?: string;
  warnings: string[];
  confidence: number;
};
type MotionRefineHistoryEntry = {
  id: string;
  transitionId: string;
  requestedAt: string;
  appliedAt?: string;
  mode: 'resolve' | 'generate';
  requestSummary: { actionPrompt: string; durationSec: number; selectedCharacterId: string; usedReferenceAssetId?: string };
  motionIntent?: MotionIntent;
  error?: string;
};
type MotionRegenerateLockScope = 'none' | 'rootPosition' | 'rootRotation' | 'upperBody' | 'lowerBody' | 'contacts';
type MotionQualityIssue = {
  id: string;
  severity: 'error' | 'warning' | 'info';
  metric: 'endpoint' | 'speed' | 'rotation' | 'foot_lock' | 'contact' | 'pose';
  message: string;
  timeSec?: number;
  value?: number;
};
type MotionQualityReport = {
  version: 1;
  checkedAt: string;
  score: number;
  issues: MotionQualityIssue[];
  metrics: {
    maxStepDistance: number;
    maxRootRotationDelta: number;
    startPositionDrift: number;
    endPositionDrift: number;
    lockedFootChanges: number;
    contactCount: number;
  };
};
type PoseTransitionTemplate = {
  id: ActionTemplateId;
  label: string;
  hand?: 'left' | 'right';
  targetObjectId?: string | null;
  strength: number;
};
type PoseTransitionActionPlan = {
  mode?: 'motion_intent' | 'template_assist' | 'universal';
  universal?: UniversalMotionPlan;
  templates: PoseTransitionTemplate[];
  notes: string[];
};
type PoseTransitionConstraints = {
  headLookAt: { enabled: boolean; targetMode: 'camera' | 'object' | 'point'; targetObjectId?: string; targetPosition?: Vec3 };
  handTarget: { enabled: boolean; hand: 'left' | 'right'; targetMode: 'object' | 'point'; targetObjectId?: string; targetPosition?: Vec3 };
  footLock: { enabled: boolean; left: boolean; right: boolean };
  jointLimitsEnabled: boolean;
};
type AnimationContactFrame = {
  timeSec: number;
  kind: 'reach' | 'grasp' | 'release' | 'foot_lock';
  targetObjectId?: string;
  limb: 'head' | 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
  position: Vec3;
  note: string;
};
type AnimationClipSample = {
  timeSec: number;
  transform: PoseTransform;
  pose: StandardHumanRigPose;
  bonePose?: Scene3DBonePose;
  fingerPose?: StandardHumanFingerPose;
  toePose?: StandardHumanToePose;
  libTvJointAngles?: LibTvJointAngles;
};
type SerializedAnimationTrack = { name: string; kind: 'quaternion' | 'vector'; times: number[]; values: number[] };
type SerializedAnimationClip = {
  name: string;
  durationSec: number;
  sampleRate: number;
  rigProfile?: { rigId: 'mixamo-xbot'; version: 1; rotationOrder: 'XYZ'; applicationMode: 'rest_quaternion_multiply_delta' };
  tracks: SerializedAnimationTrack[];
  samples: AnimationClipSample[];
  contacts: AnimationContactFrame[];
};
type PoseTransition = {
  id: string;
  name: string;
  characterId: string;
  actionPrompt: string;
  actionPlan: PoseTransitionActionPlan;
  aiActionIntent?: string;
  generatedMotionPrompt?: string;
  motionIntent?: MotionIntent;
  motionRefineHistory: MotionRefineHistoryEntry[];
  regenerateLockScope: MotionRegenerateLockScope;
  qualityReport?: MotionQualityReport;
  constraints: PoseTransitionConstraints;
  durationSec: number;
  curve: CurveType;
  startPose?: StandardHumanRigPose;
  endPose?: StandardHumanRigPose;
  startBonePose?: Scene3DBonePose;
  endBonePose?: Scene3DBonePose;
  startFingerPose?: StandardHumanFingerPose;
  endFingerPose?: StandardHumanFingerPose;
  startToePose?: StandardHumanToePose;
  endToePose?: StandardHumanToePose;
  startPosePresetId?: string;
  endPosePresetId?: string;
  startLibTvJointAngles?: LibTvJointAngles;
  endLibTvJointAngles?: LibTvJointAngles;
  startTransform?: PoseTransform;
  endTransform?: PoseTransform;
  animationClip?: SerializedAnimationClip;
  warnings: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};
type PoseReferenceSolveResult = {
  version: 1;
  summary: string;
  rigPose: StandardHumanRigPose;
  bonePose?: Scene3DBonePose;
  rootOffset?: Vec3;
  foundationHint?: PoseFoundationHint;
  poseLandmarks?: PoseReferenceLandmarks;
  compiledFromLandmarks: boolean;
  confidence: number;
  warnings: string[];
  appliedViews: PoseReferenceView[];
};
type PoseReferenceSolveHistoryItem = PoseReferenceSolveResult & {
  id: string;
  solvedAt: string;
  imageRefs: Array<{ view: PoseReferenceView; assetId?: string; fileName: string }>;
};
type CharacterObject = {
  id: string;
  name: string;
  gender: CharacterGender;
  visible: boolean;
  locked: boolean;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  posePreset?: string;
  posePresetId?: string;
  poseRootOffset?: Vec3;
  rigPose: StandardHumanRigPose;
  bonePose?: Scene3DBonePose;
  fingerPose?: StandardHumanFingerPose;
  toePose?: StandardHumanToePose;
  libTvJointAngles?: LibTvJointAngles;
  poseReferenceImages?: Partial<Record<PoseReferenceView, PoseReferenceImage>>;
  poseReferenceSolveHistory?: PoseReferenceSolveHistoryItem[];
  model: { type: 'glb' | 'gltf' | 'fbx' | 'obj' | 'proxy'; url?: string; sourceName?: string; normalizedHeight?: number; runtimeOnly?: boolean };
};
type PropObject = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  shape: PropShape;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  model?: ImportedSceneModel;
  importedModel?: ImportedSceneModel;
};
type CameraObject = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  targetPosition: Vec3;
  fov: number;
  lensType: CameraLensType;
  fisheyeStrength: number;
  focusDistance: number;
  tiltShiftAmount: number;
  orthographicScale: number;
  captures: Capture[];
};
type LightObject = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  lightType: LightType;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  intensity: number;
};
type Scene3DHistorySnapshot = {
  version: number;
  background: { type: 'color'; color: string };
  objects: { characters: CharacterObject[]; props: PropObject[]; cameras: CameraObject[]; lights: LightObject[] };
  activeCameraId?: string;
  selectedObjectId?: string;
  activeViewMode?: 'director' | 'camera';
  activeTransitionId?: string;
  aspectRatio: string;
  gridSnapEnabled: boolean;
  groundGridEnabled: boolean;
  groundEnabled: boolean;
  motionPathEnabled: boolean;
  characterLabelsEnabled: boolean;
  compositionGuideEnabled: boolean;
  sceneZoomPercent: number;
  captures: Capture[];
  poseTransitions: PoseTransition[];
  jointAxisProfile?: Scene3DJointAxisProfile;
};
type Scene3DHistoryEntry = { id: string; label: string; before: Scene3DHistorySnapshot; after: Scene3DHistorySnapshot; mergeKey?: string; createdAt: string };
type Scene3DState = {
  version: number;
  background: { type: 'color'; color: string };
  objects: { characters: CharacterObject[]; props: PropObject[]; cameras: CameraObject[]; lights: LightObject[] };
  selectedObjectId?: string;
  activeViewMode: 'director' | 'camera';
  activeCameraId?: string;
  transformMode: TransformMode;
  aspectRatio: string;
  gridSnapEnabled: boolean;
  groundGridEnabled: boolean;
  groundEnabled: boolean;
  motionPathEnabled: boolean;
  characterLabelsEnabled: boolean;
  compositionGuideEnabled: boolean;
  sceneZoomPercent: number;
  captures: Capture[];
  poseTransitions: PoseTransition[];
  jointAxisProfile: Scene3DJointAxisProfile;
  activeTransitionId?: string;
  undoStack: Scene3DHistoryEntry[];
  redoStack: Scene3DHistoryEntry[];
};
type Scene3DCaptureResult = { capture: Capture; scene: Scene3DState };
type PreviewState = { transitionId?: string; currentTimeSec: number; playing: boolean; loop: boolean; enabled: boolean };
type Scene3DNodeProps = {
  node: CanvasNode;
  isSelected: boolean;
  onUpdate: (updatedFields: Partial<CanvasNode> | ((node: CanvasNode) => Partial<CanvasNode>)) => void;
  onDelete: (e: React.MouseEvent) => void;
  onSelect: (e: React.MouseEvent) => void;
  onCreateImageNode?: (result: Scene3DCaptureResult) => void;
  onSendCaptureToCanvas?: (result: Scene3DCaptureResult) => void;
  onCreateVideoNode?: (result: Scene3DCaptureResult) => void;
  onCreateActionVideoNode?: (result: any) => void;
  currentProjectId?: string | null;
  availableImageSources?: Array<{ id: string; label: string; mediaAssetId: string; mediaUrl: string; kind: string }>;
};

const MODEL_URL = '/models/x-bot.glb';
const MAX_SCENE_HISTORY = 60;
const MAX_IMPORTED_MODEL_BYTES = 80 * 1024 * 1024;
const IMPORTED_MODEL_ACCEPT = '.fbx,.glb,.gltf,.obj,model/gltf-binary,model/gltf+json,model/obj,application/octet-stream';
const MAX_POSE_REFERENCE_IMAGE_BYTES = 12 * 1024 * 1024;
const POSE_REFERENCE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const SCENE_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21', '2.35:1', '1.85:1', '1.91:1'];
const POSE_KEYS: PoseJointKey[] = ['pelvis', 'chest', 'neck', 'head', 'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
const POSE_REFERENCE_VIEW_OPTIONS: Array<{ id: PoseReferenceView; label: string; hint: string }> = [
  { id: 'front', label: '\u6b63\u9762', hint: '\u6b63\u9762\u53c2\u8003\u56fe' },
  { id: 'side', label: '\u4fa7\u9762', hint: '\u4fa7\u9762\u53c2\u8003\u56fe' },
  { id: 'back', label: '\u80cc\u9762', hint: '\u80cc\u9762\u53c2\u8003\u56fe' }
];
const POSE_LANDMARK_BONES: Array<[PoseLandmarkKey, PoseLandmarkKey]> = [
  ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'], ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'], ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'], ['leftAnkle', 'leftToe'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'], ['rightAnkle', 'rightToe'], ['nose', 'leftEye'], ['nose', 'rightEye']
];
const warnedMixamoLocalCoverageKeys = new Set<string>();

type PoseReferenceView = 'front' | 'side' | 'back';

type PoseReferenceImage = {
  id: string;
  view: PoseReferenceView;
  url: string;
  assetId?: string;
  fileName: string;
  mimeType?: string;
  uploadedAt: string;
};

type PoseFoundationHint = {
  id: FoundationPoseId;
  label: string;
  confidence: number;
  reason: string;
  rootOffset: Vec3;
  bonePose?: Scene3DBonePose;
};

const POSE_LANDMARK_KEYS: PoseLandmarkKey[] = [
  'nose',
  'leftEye',
  'rightEye',
  'leftEar',
  'rightEar',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
  'leftToe',
  'rightToe'
];

function normalizePoseLandmarkPoint(value: any): PoseLandmarkPoint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return {
    x: clampNumber(x, -1.5, 1.5),
    y: clampNumber(y, -1.5, 1.5),
    visible: Number.isFinite(Number(value.visible)) ? clampNumber(Number(value.visible), 0, 1) : undefined,
    depth: Number.isFinite(Number(value.depth)) ? clampNumber(Number(value.depth), -1.5, 1.5) : undefined
  };
}

function normalizePoseReferenceLandmarks(value: any): PoseReferenceLandmarks | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const sourceViews = Array.isArray(value.sourceViews)
    ? value.sourceViews.filter((item: any): item is PoseReferenceView => item === 'front' || item === 'side' || item === 'back').slice(0, 3)
    : [];
  if (!sourceViews.length) return undefined;
  const points = POSE_LANDMARK_KEYS.reduce<Partial<Record<PoseLandmarkKey, PoseLandmarkPoint>>>((acc, key) => {
    const point = normalizePoseLandmarkPoint(value.points?.[key]);
    if (point) acc[key] = point;
    return acc;
  }, {});
  if (!Object.keys(points).length) return undefined;
  const contacts = Array.isArray(value.contacts)
    ? value.contacts
        .map((contact: any) => ({
          point: contact?.point,
          type: contact?.type,
          confidence: Number(contact?.confidence)
        }))
        .filter((contact: any): contact is PoseReferenceContact => (
          ['leftFoot', 'rightFoot', 'leftHand', 'rightHand', 'leftKnee', 'rightKnee', 'hip'].includes(contact.point)
          && ['ground', 'prop', 'body', 'unknown'].includes(contact.type)
          && Number.isFinite(contact.confidence)
        ))
        .map((contact) => ({ ...contact, confidence: clampNumber(contact.confidence, 0, 1) }))
        .slice(0, 8)
    : [];
  return {
    version: 1,
    sourceViews,
    coordinateSpace: 'image-normalized',
    points,
    bodyFacing: Number.isFinite(Number(value.bodyFacing)) ? clampNumber(Number(value.bodyFacing), -180, 180) : 0,
    torsoLean: value.torsoLean ? normalizeVec(value.torsoLean, vec()) : undefined,
    contacts,
    confidence: Number.isFinite(Number(value.confidence)) ? clampNumber(Number(value.confidence), 0, 1) : 0
  };
}

function landmarkVisible(point?: PoseLandmarkPoint) {
  return Boolean(point && (point.visible ?? 1) >= 0.25);
}

function midpoint(a?: PoseLandmarkPoint, b?: PoseLandmarkPoint): PoseLandmarkPoint | undefined {
  if (!landmarkVisible(a) || !landmarkVisible(b)) return undefined;
  return {
    x: (a!.x + b!.x) / 2,
    y: (a!.y + b!.y) / 2,
    visible: Math.min(a!.visible ?? 1, b!.visible ?? 1),
    depth: Number.isFinite(a!.depth) || Number.isFinite(b!.depth)
      ? ((a!.depth || 0) + (b!.depth || 0)) / 2
      : undefined
  };
}

function angleBetweenPoints(a: PoseLandmarkPoint, b: PoseLandmarkPoint) {
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

function jointBendDegrees(a?: PoseLandmarkPoint, b?: PoseLandmarkPoint, c?: PoseLandmarkPoint) {
  if (!landmarkVisible(a) || !landmarkVisible(b) || !landmarkVisible(c)) return undefined;
  const ab = Math.atan2(a!.y - b!.y, a!.x - b!.x);
  const cb = Math.atan2(c!.y - b!.y, c!.x - b!.x);
  let diff = Math.abs((ab - cb) * 180 / Math.PI);
  if (diff > 180) diff = 360 - diff;
  return clampNumber(180 - diff, 0, 155);
}

function landmarkDepthDelta(a?: PoseLandmarkPoint, b?: PoseLandmarkPoint) {
  if (!landmarkVisible(a) || !landmarkVisible(b)) return 0;
  return clampNumber((b?.depth || 0) - (a?.depth || 0), -1, 1);
}

function foundationPoseForHint(hint?: PoseFoundationHint): StandardHumanRigPose {
  const item = FOUNDATION_POSE_ITEMS.find((candidate) => candidate.id === hint?.id);
  return clonePose(posePresetForId(hint?.id || item?.id || 'stand')?.pose || item?.preset.pose || zeroPose());
}

function compileArmFromLandmarks(
  pose: StandardHumanRigPose,
  side: BodySide,
  shoulder?: PoseLandmarkPoint,
  elbow?: PoseLandmarkPoint,
  wrist?: PoseLandmarkPoint
) {
  if (!landmarkVisible(shoulder) || !landmarkVisible(elbow)) return;
  const sign = side === 'left' ? -1 : 1;
  const upperKey = side === 'left' ? 'leftUpperArm' : 'rightUpperArm';
  const lowerKey = side === 'left' ? 'leftLowerArm' : 'rightLowerArm';
  const handKey = side === 'left' ? 'leftHand' : 'rightHand';
  const dx = (elbow!.x - shoulder!.x) * sign;
  const dy = elbow!.y - shoulder!.y;
  const upperAngle = angleBetweenPoints(shoulder!, elbow!);
  const sideRaise = clampNumber((Math.abs(dx) / (Math.abs(dx) + Math.max(0.08, Math.abs(dy)))) * 112, 0, 112);
  const forward = landmarkDepthDelta(shoulder, elbow) * 72;
  pose[upperKey] = {
    x: clampNumber(forward + (dy < -0.08 ? -Math.abs(dy) * 55 : 0), JOINT_LIMITS[upperKey].x[0], JOINT_LIMITS[upperKey].x[1]),
    y: clampNumber(dx * 50, JOINT_LIMITS[upperKey].y[0], JOINT_LIMITS[upperKey].y[1]),
    z: clampNumber(sign * sideRaise + clampNumber((upperAngle - 90) * 0.25, -30, 30), JOINT_LIMITS[upperKey].z[0], JOINT_LIMITS[upperKey].z[1])
  };
  const bend = jointBendDegrees(shoulder, elbow, wrist);
  if (bend !== undefined) {
    pose[lowerKey] = {
      x: clampNumber(bend, JOINT_LIMITS[lowerKey].x[0], JOINT_LIMITS[lowerKey].x[1]),
      y: clampNumber(landmarkDepthDelta(elbow, wrist) * 12, JOINT_LIMITS[lowerKey].y[0], JOINT_LIMITS[lowerKey].y[1]),
      z: clampNumber((wrist!.x - elbow!.x) * sign * 18, JOINT_LIMITS[lowerKey].z[0], JOINT_LIMITS[lowerKey].z[1])
    };
    pose[handKey] = {
      x: clampNumber(landmarkDepthDelta(elbow, wrist) * 30, JOINT_LIMITS[handKey].x[0], JOINT_LIMITS[handKey].x[1]),
      y: 0,
      z: clampNumber((angleBetweenPoints(elbow!, wrist!) - upperAngle) * 0.22, JOINT_LIMITS[handKey].z[0], JOINT_LIMITS[handKey].z[1])
    };
  }
}

function compileLegFromLandmarks(
  pose: StandardHumanRigPose,
  side: BodySide,
  hip?: PoseLandmarkPoint,
  knee?: PoseLandmarkPoint,
  ankle?: PoseLandmarkPoint,
  toe?: PoseLandmarkPoint
) {
  if (!landmarkVisible(hip) || !landmarkVisible(knee)) return;
  const sign = side === 'left' ? -1 : 1;
  const upperKey = side === 'left' ? 'leftUpperLeg' : 'rightUpperLeg';
  const lowerKey = side === 'left' ? 'leftLowerLeg' : 'rightLowerLeg';
  const footKey = side === 'left' ? 'leftFoot' : 'rightFoot';
  const dx = (knee!.x - hip!.x) * sign;
  const dy = knee!.y - hip!.y;
  const thighLift = clampNumber((0.48 - dy) * 118 + Math.abs(dx) * 36 - landmarkDepthDelta(hip, knee) * 26, -35, 110);
  pose[upperKey] = {
    x: clampNumber(thighLift, JOINT_LIMITS[upperKey].x[0], JOINT_LIMITS[upperKey].x[1]),
    y: clampNumber(landmarkDepthDelta(hip, knee) * 34, JOINT_LIMITS[upperKey].y[0], JOINT_LIMITS[upperKey].y[1]),
    z: clampNumber(dx * 42, JOINT_LIMITS[upperKey].z[0], JOINT_LIMITS[upperKey].z[1])
  };
  const bend = jointBendDegrees(hip, knee, ankle);
  if (bend !== undefined) {
    pose[lowerKey] = {
      x: clampNumber(bend, JOINT_LIMITS[lowerKey].x[0], JOINT_LIMITS[lowerKey].x[1]),
      y: clampNumber(landmarkDepthDelta(knee, ankle) * 6, JOINT_LIMITS[lowerKey].y[0], JOINT_LIMITS[lowerKey].y[1]),
      z: clampNumber((ankle!.x - knee!.x) * sign * 8, JOINT_LIMITS[lowerKey].z[0], JOINT_LIMITS[lowerKey].z[1])
    };
  }
  if (landmarkVisible(ankle) && landmarkVisible(toe)) {
    const footAngle = angleBetweenPoints(ankle!, toe!);
    pose[footKey] = {
      x: clampNumber((footAngle - 8) * 0.45, JOINT_LIMITS[footKey].x[0], JOINT_LIMITS[footKey].x[1]),
      y: clampNumber(landmarkDepthDelta(ankle, toe) * 18, JOINT_LIMITS[footKey].y[0], JOINT_LIMITS[footKey].y[1]),
      z: clampNumber((toe!.x - ankle!.x) * sign * 18, JOINT_LIMITS[footKey].z[0], JOINT_LIMITS[footKey].z[1])
    };
  }
}

function compilePoseFromLandmarks(
  landmarks: PoseReferenceLandmarks,
  fallbackPose: StandardHumanRigPose,
  foundationHint: PoseFoundationHint | undefined,
  profile: Scene3DJointAxisProfile
) {
  const points = landmarks.points;
  const pose = foundationHint ? foundationPoseForHint(foundationHint) : clonePose(fallbackPose);
  const shoulderMid = midpoint(points.leftShoulder, points.rightShoulder);
  const hipMid = midpoint(points.leftHip, points.rightHip);
  const headPoint = midpoint(points.leftEye, points.rightEye) || points.nose;
  if (shoulderMid && hipMid) {
    const shoulderSlope = landmarkVisible(points.leftShoulder) && landmarkVisible(points.rightShoulder)
      ? angleBetweenPoints(points.leftShoulder!, points.rightShoulder!)
      : 0;
    const hipSlope = landmarkVisible(points.leftHip) && landmarkVisible(points.rightHip)
      ? angleBetweenPoints(points.leftHip!, points.rightHip!)
      : 0;
    const torsoDx = shoulderMid.x - hipMid.x;
    const torsoDy = shoulderMid.y - hipMid.y;
    pose.pelvis = {
      x: clampNumber((landmarks.torsoLean?.x || 0) * 34, JOINT_LIMITS.pelvis.x[0], JOINT_LIMITS.pelvis.x[1]),
      y: clampNumber(landmarks.bodyFacing * 0.42, JOINT_LIMITS.pelvis.y[0], JOINT_LIMITS.pelvis.y[1]),
      z: clampNumber(hipSlope * 0.35, JOINT_LIMITS.pelvis.z[0], JOINT_LIMITS.pelvis.z[1])
    };
    pose.chest = {
      x: clampNumber((0.58 + torsoDy) * -28 + (landmarks.torsoLean?.x || 0) * 40, JOINT_LIMITS.chest.x[0], JOINT_LIMITS.chest.x[1]),
      y: clampNumber(landmarks.bodyFacing * 0.36 + (landmarks.torsoLean?.y || 0) * 18, JOINT_LIMITS.chest.y[0], JOINT_LIMITS.chest.y[1]),
      z: clampNumber(shoulderSlope * 0.42 + torsoDx * 45 + (landmarks.torsoLean?.z || 0) * 30, JOINT_LIMITS.chest.z[0], JOINT_LIMITS.chest.z[1])
    };
  }
  if (headPoint && shoulderMid) {
    const headDx = headPoint.x - shoulderMid.x;
    const headDy = headPoint.y - shoulderMid.y;
    pose.neck = {
      x: clampNumber((headDy + 0.38) * -42, JOINT_LIMITS.neck.x[0], JOINT_LIMITS.neck.x[1]),
      y: clampNumber(headDx * 82 + landmarks.bodyFacing * 0.16, JOINT_LIMITS.neck.y[0], JOINT_LIMITS.neck.y[1]),
      z: clampNumber(headDx * 34, JOINT_LIMITS.neck.z[0], JOINT_LIMITS.neck.z[1])
    };
    pose.head = {
      x: clampNumber(pose.neck.x * 0.72, JOINT_LIMITS.head.x[0], JOINT_LIMITS.head.x[1]),
      y: clampNumber(pose.neck.y * 0.76, JOINT_LIMITS.head.y[0], JOINT_LIMITS.head.y[1]),
      z: clampNumber(pose.neck.z * 0.8, JOINT_LIMITS.head.z[0], JOINT_LIMITS.head.z[1])
    };
  }
  compileArmFromLandmarks(pose, 'left', points.leftShoulder, points.leftElbow, points.leftWrist);
  compileArmFromLandmarks(pose, 'right', points.rightShoulder, points.rightElbow, points.rightWrist);
  compileLegFromLandmarks(pose, 'left', points.leftHip, points.leftKnee, points.leftAnkle, points.leftToe);
  compileLegFromLandmarks(pose, 'right', points.rightHip, points.rightKnee, points.rightAnkle, points.rightToe);
  return clampPoseWithJointProfile(pose, profile);
}

const FINGER_CURL_MIN = 0;
const FINGER_CURL_MAX = 120;
const FINGER_SPREAD_MIN = -30;
const FINGER_SPREAD_MAX = 30;

function handFingerPose(curl = 0, spread = 0): HandFingerPose {
  return { thumb: curl, index: curl, middle: curl, ring: curl, pinky: curl, spread };
}
function fingerPose(left: HandFingerPose = handFingerPose(), right: HandFingerPose = handFingerPose()): StandardHumanFingerPose {
  return { left: { ...left }, right: { ...right } };
}
const FINGER_POSE_RELAXED = fingerPose(handFingerPose(8, 2), handFingerPose(8, 2));
const FINGER_POSE_OPEN = fingerPose(handFingerPose(FINGER_CURL_MIN, 0), handFingerPose(FINGER_CURL_MIN, 0));
const FINGER_POSE_FISTS = fingerPose(handFingerPose(FINGER_CURL_MAX, 0), handFingerPose(FINGER_CURL_MAX, 0));
const TOE_POSE_NEUTRAL: StandardHumanToePose = {
  leftBase: rot(),
  rightBase: rot(),
  leftTip: rot(),
  rightTip: rot()
};
function cloneFingerPose(value?: StandardHumanFingerPose | null): StandardHumanFingerPose {
  const source = value || FINGER_POSE_RELAXED;
  return fingerPose(source.left || FINGER_POSE_RELAXED.left, source.right || FINGER_POSE_RELAXED.right);
}
function cloneEditableFingerPose(value?: StandardHumanFingerPose | null): StandardHumanFingerPose {
  return cloneFingerPose(value);
}
function normalizeHandFingerPose(value: any, fallback: HandFingerPose): HandFingerPose {
  const pick = (key: keyof HandFingerPose) => {
    const next = Number(value?.[key]);
    const min = key === 'spread' ? FINGER_SPREAD_MIN : FINGER_CURL_MIN;
    const max = key === 'spread' ? FINGER_SPREAD_MAX : FINGER_CURL_MAX;
    return Number.isFinite(next) ? clampNumber(next, min, max) : fallback[key];
  };
  return { thumb: pick('thumb'), index: pick('index'), middle: pick('middle'), ring: pick('ring'), pinky: pick('pinky'), spread: pick('spread') };
}
function normalizeFingerPose(value: any, fallback: StandardHumanFingerPose = FINGER_POSE_RELAXED): StandardHumanFingerPose {
  return { left: normalizeHandFingerPose(value?.left, fallback.left), right: normalizeHandFingerPose(value?.right, fallback.right) };
}
function lerpHandFingerPose(a: HandFingerPose, b: HandFingerPose, t: number): HandFingerPose {
  return {
    thumb: Number(lerp(a.thumb, b.thumb, t).toFixed(4)),
    index: Number(lerp(a.index, b.index, t).toFixed(4)),
    middle: Number(lerp(a.middle, b.middle, t).toFixed(4)),
    ring: Number(lerp(a.ring, b.ring, t).toFixed(4)),
    pinky: Number(lerp(a.pinky, b.pinky, t).toFixed(4)),
    spread: Number(lerp(a.spread, b.spread, t).toFixed(4))
  };
}
function lerpFingerPose(a?: StandardHumanFingerPose, b?: StandardHumanFingerPose, t = 0): StandardHumanFingerPose {
  const left = cloneFingerPose(a);
  const right = cloneFingerPose(b);
  return { left: lerpHandFingerPose(left.left, right.left, t), right: lerpHandFingerPose(left.right, right.right, t) };
}
function cloneToePose(value?: StandardHumanToePose | null): StandardHumanToePose {
  const source = value || TOE_POSE_NEUTRAL;
  return {
    leftBase: { ...(source.leftBase || TOE_POSE_NEUTRAL.leftBase) },
    rightBase: { ...(source.rightBase || TOE_POSE_NEUTRAL.rightBase) },
    leftTip: { ...(source.leftTip || TOE_POSE_NEUTRAL.leftTip) },
    rightTip: { ...(source.rightTip || TOE_POSE_NEUTRAL.rightTip) }
  };
}
function normalizeToePose(value: any, fallback?: StandardHumanToePose): StandardHumanToePose {
  return clampToePose(value || fallback);
}
function lerpToePose(a?: StandardHumanToePose, b?: StandardHumanToePose, t = 0): StandardHumanToePose {
  const start = cloneToePose(a);
  const end = cloneToePose(b);
  const next = cloneToePose();
  TOE_OPTIONS.forEach((key) => {
    next[key] = {
      x: Number(lerp(start[key].x, end[key].x, t).toFixed(4)),
      y: Number(lerp(start[key].y, end[key].y, t).toFixed(4)),
      z: Number(lerp(start[key].z, end[key].z, t).toFixed(4))
    };
  });
  return next;
}
function cloneBonePose(value?: Scene3DBonePose | null): Scene3DBonePose | undefined {
  if (!value?.bones) return undefined;
  return {
    space: value.space === 'scene3d-local' ? 'scene3d-local' : 'mixamo-local',
    source: value.source,
    adapter: value.adapter,
    bones: Object.fromEntries(Object.entries(value.bones).map(([name, rotation]) => [name, { ...rotation }]))
  };
}
function normalizeBonePose(value: any, fallback?: Scene3DBonePose): Scene3DBonePose | undefined {
  if (!value && fallback) return cloneBonePose(fallback);
  if (!value || typeof value !== 'object' || !value.bones || typeof value.bones !== 'object') return undefined;
  const bones: Record<string, RigRotation> = {};
  Object.entries(value.bones).forEach(([name, rotation]: [string, any]) => {
    bones[name] = normalizeRotation(rotation, rot());
  });
  return { space: value.space === 'scene3d-local' ? 'scene3d-local' : 'mixamo-local', source: value.source, adapter: value.adapter, bones };
}
function lerpBonePose(a?: Scene3DBonePose, b?: Scene3DBonePose, t = 0): Scene3DBonePose | undefined {
  const start = cloneBonePose(a);
  const end = cloneBonePose(b);
  if (!start && !end) return undefined;
  const names = new Set([...Object.keys(start?.bones || {}), ...Object.keys(end?.bones || {})]);
  const bones: Record<string, RigRotation> = {};
  names.forEach((name) => {
    const av = start?.bones[name] || end?.bones[name] || rot();
    const bv = end?.bones[name] || start?.bones[name] || rot();
    bones[name] = { x: lerp(av.x, bv.x, t), y: lerp(av.y, bv.y, t), z: lerp(av.z, bv.z, t) };
  });
  return { space: end?.space || start?.space || 'mixamo-local', source: end?.source || start?.source, adapter: end?.adapter || start?.adapter, bones };
}
function bonePoseFromBones(bones: Record<string, RigRotation>, space: Scene3DBonePose['space'] = 'mixamo-local'): Scene3DBonePose {
  return { space, bones: Object.fromEntries(Object.entries(bones).map(([name, value]) => [name, { ...value }])) };
}
function cloneLibTvJointAngles(value?: LibTvJointAngles | null): LibTvJointAngles | undefined {
  if (!value) return undefined;
  return {
    body: { ...value.body }, torso: { ...value.torso }, head: { ...value.head },
    l_arm: { ...value.l_arm }, r_arm: { ...value.r_arm }, l_elbow: { ...value.l_elbow }, r_elbow: { ...value.r_elbow },
    l_leg: { ...value.l_leg }, r_leg: { ...value.r_leg }, l_knee: { ...value.l_knee }, r_knee: { ...value.r_knee }
  };
}
function normalizeAngleGroup<T extends Record<string, number>>(value: any, fallback: T): T {
  const next = { ...fallback };
  for (const key of Object.keys(fallback) as Array<keyof T>) {
    const raw = Number(value?.[key]);
    next[key] = (Number.isFinite(raw) ? raw : fallback[key]) as T[keyof T];
  }
  return next;
}
function normalizeLibTvJointAngles(value: any, fallback?: LibTvJointAngles): LibTvJointAngles | undefined {
  if (!value && !fallback) return undefined;
  const base = fallback || LIBTV_POSE_PRESETS[0].jointAngles;
  return {
    body: normalizeAngleGroup(value?.body, base.body), torso: normalizeAngleGroup(value?.torso, base.torso), head: normalizeAngleGroup(value?.head, base.head),
    l_arm: normalizeAngleGroup(value?.l_arm, base.l_arm), r_arm: normalizeAngleGroup(value?.r_arm, base.r_arm), l_elbow: normalizeAngleGroup(value?.l_elbow, base.l_elbow), r_elbow: normalizeAngleGroup(value?.r_elbow, base.r_elbow),
    l_leg: normalizeAngleGroup(value?.l_leg, base.l_leg), r_leg: normalizeAngleGroup(value?.r_leg, base.r_leg), l_knee: normalizeAngleGroup(value?.l_knee, base.l_knee), r_knee: normalizeAngleGroup(value?.r_knee, base.r_knee)
  };
}
function lerpAngleGroup<T extends Record<string, number>>(a: T, b: T, t: number): T {
  const next = { ...a };
  for (const key of Object.keys(a) as Array<keyof T>) next[key] = Number(lerp(a[key], b[key], t).toFixed(4)) as T[keyof T];
  return next;
}
function interpolateLibTvJointAngles(a: LibTvJointAngles, b: LibTvJointAngles, t: number): LibTvJointAngles {
  return {
    body: lerpAngleGroup(a.body, b.body, t), torso: lerpAngleGroup(a.torso, b.torso, t), head: lerpAngleGroup(a.head, b.head, t),
    l_arm: lerpAngleGroup(a.l_arm, b.l_arm, t), r_arm: lerpAngleGroup(a.r_arm, b.r_arm, t), l_elbow: lerpAngleGroup(a.l_elbow, b.l_elbow, t), r_elbow: lerpAngleGroup(a.r_elbow, b.r_elbow, t),
    l_leg: lerpAngleGroup(a.l_leg, b.l_leg, t), r_leg: lerpAngleGroup(a.r_leg, b.r_leg, t), l_knee: lerpAngleGroup(a.l_knee, b.l_knee, t), r_knee: lerpAngleGroup(a.r_knee, b.r_knee, t)
  };
}
function usesMirroredControlSpace(jointKey: PoseJointKey) {
  return (
    jointKey === 'rightUpperArm' ||
    jointKey === 'rightLowerArm' ||
    jointKey === 'rightHand' ||
    jointKey === 'rightUpperLeg' ||
    jointKey === 'rightLowerLeg' ||
    jointKey === 'rightFoot'
  );
}
function rotationToInternalSpace(jointKey: PoseJointKey, rotation: Partial<RigRotation>): RigRotation {
  const next = { x: rotation.x ?? 0, y: rotation.y ?? 0, z: rotation.z ?? 0 };
  if (!usesMirroredControlSpace(jointKey)) return next;
  return { x: next.x, y: -next.y, z: -next.z };
}
function presetRigPose(patch: Partial<Record<PoseJointKey, Partial<RigRotation>>> = {}) {
  const internalPatch: Partial<Record<PoseJointKey, RigRotation>> = {};
  for (const key of Object.keys(patch) as PoseJointKey[]) {
    const rotation = patch[key];
    if (rotation) internalPatch[key] = rotationToInternalSpace(key, rotation);
  }
  return patchPose(zeroPose(), internalPatch);
}
function libTvArmToRig(arm: LibTvJointAngles['l_arm'], side: 'left' | 'right') {
  const sideSign = side === 'left' ? -1 : 1;
  return rot(84 - arm.raise * 1.25, sideSign * arm.straddle, sideSign * arm.turn * 0.35);
}
function libTvLegToRig(leg: LibTvJointAngles['l_leg'], side: 'left' | 'right') {
  const sideSign = side === 'left' ? 1 : -1;
  return rot(leg.raise, leg.turn, sideSign * leg.straddle);
}
function libTvPoseToRigPose(jointAngles: LibTvJointAngles, presetId?: string): StandardHumanRigPose {
  if (presetId === 'tpose') return zeroPose();
  return patchPose(zeroPose(), {
    pelvis: { x: jointAngles.body.bend, y: jointAngles.body.turn, z: jointAngles.body.tilt },
    chest: { x: jointAngles.torso.bend, y: jointAngles.torso.turn, z: jointAngles.torso.tilt },
    neck: { x: jointAngles.head.nod * 0.25, y: jointAngles.head.turn * 0.25, z: jointAngles.head.tilt * 0.25 },
    head: { x: jointAngles.head.nod, y: jointAngles.head.turn, z: jointAngles.head.tilt },
    leftUpperArm: libTvArmToRig(jointAngles.l_arm, 'left'), leftLowerArm: { x: jointAngles.l_elbow.bend },
    rightUpperArm: libTvArmToRig(jointAngles.r_arm, 'right'), rightLowerArm: { x: jointAngles.r_elbow.bend },
    leftUpperLeg: libTvLegToRig(jointAngles.l_leg, 'left'), leftLowerLeg: { x: jointAngles.l_knee.bend },
    rightUpperLeg: libTvLegToRig(jointAngles.r_leg, 'right'), rightLowerLeg: { x: jointAngles.r_knee.bend },
    leftFoot: { x: -jointAngles.l_knee.bend * 0.08 }, rightFoot: { x: -jointAngles.r_knee.bend * 0.08 }
  });
}
const LIBTV_NEUTRAL_JOINT_ANGLES: LibTvJointAngles = {
  body: { bend: 0, turn: 0, tilt: 0 },
  torso: { bend: 0, turn: 0, tilt: 0 },
  head: { nod: -2, turn: 0, tilt: 0 },
  l_arm: { raise: 0, straddle: 0, turn: 0 },
  r_arm: { raise: 0, straddle: 0, turn: 0 },
  l_elbow: { bend: 6 },
  r_elbow: { bend: 6 },
  l_leg: { raise: 0, straddle: 0, turn: 0 },
  r_leg: { raise: 0, straddle: 0, turn: 0 },
  l_knee: { bend: 0 },
  r_knee: { bend: 0 }
};
function libTvAngles(patch: Partial<{ [K in keyof LibTvJointAngles]: Partial<LibTvJointAngles[K]> }> = {}): LibTvJointAngles {
  return {
    body: { ...LIBTV_NEUTRAL_JOINT_ANGLES.body, ...patch.body },
    torso: { ...LIBTV_NEUTRAL_JOINT_ANGLES.torso, ...patch.torso },
    head: { ...LIBTV_NEUTRAL_JOINT_ANGLES.head, ...patch.head },
    l_arm: { ...LIBTV_NEUTRAL_JOINT_ANGLES.l_arm, ...patch.l_arm },
    r_arm: { ...LIBTV_NEUTRAL_JOINT_ANGLES.r_arm, ...patch.r_arm },
    l_elbow: { ...LIBTV_NEUTRAL_JOINT_ANGLES.l_elbow, ...patch.l_elbow },
    r_elbow: { ...LIBTV_NEUTRAL_JOINT_ANGLES.r_elbow, ...patch.r_elbow },
    l_leg: { ...LIBTV_NEUTRAL_JOINT_ANGLES.l_leg, ...patch.l_leg },
    r_leg: { ...LIBTV_NEUTRAL_JOINT_ANGLES.r_leg, ...patch.r_leg },
    l_knee: { ...LIBTV_NEUTRAL_JOINT_ANGLES.l_knee, ...patch.l_knee },
    r_knee: { ...LIBTV_NEUTRAL_JOINT_ANGLES.r_knee, ...patch.r_knee }
  };
}
const LIBTV_POSE_PRESETS: LibTvPosePreset[] = [
  { id: 'stand', label: '站立', jointAngles: libTvAngles(), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 1, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: -2, y: 0 , z: 0 }, leftUpperArm: { x: 77, y: -26 , z: -5 }, leftLowerArm: {  x: 6, y: 0 , z: 0 }, rightUpperArm: { x: 77, y: -26 , z: -5 },  rightLowerArm: { x: 6, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 0, y: 0, z: 0 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, rightUpperLeg: { x: 0, y: 0, z: 0 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 8, index: 8, middle: 8, ring: 8, pinky: 8, spread: 0 }, { thumb: 8, index: 8, middle: 8, ring: 8, pinky: 8, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'tpose', label: 'T型', jointAngles: libTvAngles({ head: { nod: 0 }, l_arm: { raise: 16, straddle: 60, turn: 40 }, r_arm: { raise: 22, straddle: 54, turn: 41 }, l_elbow: { bend: 0 }, r_elbow: { bend: 0 } }), rigPose: presetRigPose(), fingerPose: FINGER_POSE_OPEN },
  { id: 'walk', label: '行走', jointAngles: libTvAngles({ torso: { bend: 3, turn: 4 }, head: { nod: -3 }, l_arm: { raise: 18, straddle: 8 }, r_arm: { raise: -18, straddle: 8 }, l_elbow: { bend: 18 }, r_elbow: { bend: 18 }, l_leg: { raise: -16 }, r_leg: { raise: 24 }, l_knee: { bend: 6 }, r_knee: { bend: 28 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 3 , z: 0 }, chest: { x: 2, y: -3 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: -2, y: 0 , z: 0 }, leftUpperArm: { x: 74, y: -9 , z: 29 }, leftLowerArm: {  x: 10, y: 0 , z: 2 }, rightUpperArm: {  x: 67, y: -14 , z: -10 },  rightLowerArm: {  x: 10, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: -16, y: 0, z: 0 }, leftLowerLeg: { x: 4, y: -3, z: 0 }, rightUpperLeg: { x: 33, y: 0, z: 0 }, rightLowerLeg: { x: 6, y: 0, z: 0 }, leftFoot: { x: 5, y: 0, z: 0 }, rightFoot: { x: -8, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'run', label: '跑步', jointAngles: libTvAngles({ body: { bend: 8 }, torso: { bend: 10, turn: 4 }, head: { nod: -6 }, l_arm: { raise: 30, straddle: 12 }, r_arm: { raise: -30, straddle: 12 }, l_elbow: { bend: 88 }, r_elbow: { bend: 88 }, l_leg: { raise: -34 }, r_leg: { raise: 48 }, l_knee: { bend: 68 }, r_knee: { bend: 34 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 6, y: 0 , z: 0 }, leftUpperArm: { x: -3, y: 31 , z: 68 }, leftLowerArm: {  x: 41, y: -57 , z: 118 }, rightUpperArm: {  x: 73, y: 20 , z: -63 },  rightLowerArm: {  x: 1, y: -1 , z: 122 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: -44, y: 0, z: 0 }, leftLowerLeg: { x: -50, y: 0, z: 0 }, rightUpperLeg: { x: 50, y: 0, z: 0 }, rightLowerLeg: { x: -20, y: 0, z: 0 }, leftFoot: { x: 14, y: 0, z: 0 }, rightFoot: { x: -4, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 30 }, { thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 30 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'dash', label: '冲刺', jointAngles: libTvAngles({ body: { bend: 12, turn: 6 }, torso: { bend: 18, turn: 8 }, head: { nod: -8 }, l_arm: { raise: 42, straddle: 14 }, r_arm: { raise: -38, straddle: 14 }, l_elbow: { bend: 96 }, r_elbow: { bend: 98 }, l_leg: { raise: -42, straddle: 8 }, r_leg: { raise: 58, straddle: 8 }, l_knee: { bend: 82 }, r_knee: { bend: 42 } }), rigPose: presetRigPose({ pelvis: { x: 53, y: -3 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: -6, y: 0 , z: 0 }, head: { x: -9, y: 0 , z: 0 }, leftUpperArm: { x: 66, y: -30 , z: 79 }, leftLowerArm: {  x: 0, y: 0 , z: 85 }, rightUpperArm: {  x: 55, y: 2 , z: -40 },  rightLowerArm: {  x: 30, y: 19 , z: 40 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 107, y: 0, z: 0 }, leftLowerLeg: { x: -124, y: 0, z: 0 }, rightUpperLeg: { x: 6, y: 0, z: 0 }, rightLowerLeg: { x: -17, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 40, y: 0, z: 0 }} },
  { id: 'sit', label: '坐姿', jointAngles: libTvAngles({ torso: { bend: 6 }, head: { nod: -4 }, l_arm: { straddle: 8, turn: 6 }, r_arm: { straddle: 8, turn: 6 }, l_elbow: { bend: 45 }, r_elbow: { bend: 45 }, l_leg: { raise: 82, straddle: 4 }, r_leg: { raise: 82, straddle: 4 }, l_knee: { bend: 88 }, r_knee: { bend: 88 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: -4, y: 0 , z: 0 }, leftUpperArm: { x: 63, y: 55, z: 29 }, leftLowerArm: {  x: -58, y: 0 , z: 27 }, rightUpperArm: {  x: 63, y: 55, z: 29 },  rightLowerArm: {   x: -58, y: 0 , z: 27 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 80, y: 0, z: 21 }, leftLowerLeg: { x: -85, y: 0, z: 2 }, rightUpperLeg: { x: 80, y: 0, z: 21 }, rightLowerLeg: { x: -85, y: 0, z: 2 }, leftFoot: { x: 7, y: 0, z: 0 }, rightFoot: { x: 7, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'lotus_sit', label: '盘腿坐', jointAngles: libTvAngles({ torso: { bend: 30 }, head: { nod: 26 }, l_arm: { straddle: 18, turn: 8 }, r_arm: { straddle: 18, turn: -8 }, l_elbow: { bend: 78 }, r_elbow: { bend: 78 }, l_leg: { raise: 82, straddle: 62, turn: 0 }, r_leg: { raise: 82, straddle: 62, turn: 0 }, l_knee: { bend: 116 }, r_knee: { bend: 116 } }), rigPose: presetRigPose({ pelvis: { x: -18, y: 0 , z: 0 }, chest: { x: 38, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 6, y: 0 , z: 0 }, leftUpperArm: { x: 47, y: 49, z: 32 }, leftLowerArm: {  x: -92, y: 17 , z: 43 }, rightUpperArm: {  x: 47, y: 49, z: 32 },  rightLowerArm: {  x: -92, y: 17 , z: 43 }, leftHand: { x: 4, y: -51, z: 0 }, rightHand: { x: 4, y: -51, z: 0 }, leftUpperLeg: { x: 60, y: 9, z: 19 }, leftLowerLeg: { x: -55, y: 36, z: -98 }, rightUpperLeg: { x: 60, y: 9, z: 19 }, rightLowerLeg: { x: -55, y: 36, z: -98 }, leftFoot: { x: -34, y: -21, z: -13 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 8, y: 0, z: 0 }, rightBase: { x: 8, y: 0, z: 0 }} },
  { id: 'crouch', label: '蹲下', jointAngles: libTvAngles({ body: { bend: 2 }, torso: { bend: 22 }, head: { nod: -8 }, l_arm: { raise: 10, straddle: 6 }, r_arm: { raise: 10, straddle: 6 }, l_elbow: { bend: 62 }, r_elbow: { bend: 62 }, l_leg: { raise: 70, straddle: 10 }, r_leg: { raise: 70, straddle: 10 }, l_knee: { bend: 115 }, r_knee: { bend: 115 } }), rigPose: presetRigPose({ pelvis: { x: -4, y: 0 , z: 0 }, chest: { x: 40, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: -8, y: 0 , z: 0 }, leftUpperArm: { x: 62, y: 0, z: 46 }, leftLowerArm: {  x: 18, y: 4 , z: 67 }, rightUpperArm: {  x: 73, y: 0 , z: 39 },  rightLowerArm: {  x: 4, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 80, y: 2, z: 14 }, leftLowerLeg: { x: -94, y: 3, z: 0 }, rightUpperLeg: { x: 54, y: 0, z: -5 }, rightLowerLeg: { x: -126, y: 0, z: 0 }, leftFoot: { x: 14, y: 0, z: 0 }, rightFoot: { x: 21, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 30 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 34, y: 0, z: 0 }} },
  { id: 'one_knee_kneel', label: '单膝跪', jointAngles: libTvAngles({ torso: { bend: 8 }, head: { nod: -4 }, l_elbow: { bend: 42 }, r_elbow: { bend: 42 }, l_leg: { raise: 78, straddle: 8 }, r_leg: { raise: -18, straddle: 8 }, l_knee: { bend: 104 }, r_knee: { bend: 116 } }), rigPose: presetRigPose({ pelvis: { x: -4, y: 0 , z: 0 }, chest: { x: 40, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: -8 , z: 0 }, leftUpperArm: { x: 64, y: 17, z: 49 }, leftLowerArm: {  x: -70, y: 16 , z: 70 }, rightUpperArm: {  x: 69, y: 0 , z: 46 },  rightLowerArm: {  x: 5, y: 46 , z: 22 }, leftHand: { x: 44, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 80, y: 2, z: 14 }, leftLowerLeg: { x: -94, y: 3, z: 0 }, rightUpperLeg: { x: 13, y: 0, z: -5 }, rightLowerLeg: { x: -109, y: 0, z: 0 }, leftFoot: { x: 14, y: 0, z: 0 }, rightFoot: { x: 21, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 46, y: 0, z: 0 }} },
  { id: 'double_kneel', label: '双膝跪', jointAngles: libTvAngles({ torso: { bend: 6 }, head: { nod: -4 }, l_arm: { straddle: 8 }, r_arm: { straddle: 8 }, l_elbow: { bend: 34 }, r_elbow: { bend: 34 }, l_leg: { raise: 16, straddle: 8 }, r_leg: { raise: 16, straddle: 8 }, l_knee: { bend: 125 }, r_knee: { bend: 125 } }), rigPose: presetRigPose({ pelvis: { x: -3, y: 0 , z: 0 }, chest: { x: 40, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: -8 , z: 0 }, leftUpperArm: { x: 46, y: 26 , z: 46 }, leftLowerArm: {  x: 12, y: -53 , z: 9 }, rightUpperArm: {  x: 46, y: 26 , z: 46 },  rightLowerArm: {  x: 12, y: -53 , z: 9 }, leftHand: { x: 3, y: 0, z: 0 }, rightHand: { x: 3, y: 0, z: 0 }, leftUpperLeg: { x: 13, y: 2, z: 14 }, leftLowerLeg: { x: -109, y: 3, z: 0 }, rightUpperLeg: { x: 13, y: 2, z: 14 }, rightLowerLeg: { x: -109, y: 3, z: 0 }, leftFoot: { x: 14, y: 0, z: 0 }, rightFoot: { x: 14, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 46, y: 0, z: 0 }, rightBase: { x: 46, y: 0, z: 0 }} },
  { id: 'throw', label: '投掷', jointAngles: libTvAngles({ body: { bend: -3, turn: 8, tilt: 9 }, torso: { bend: -9, turn: 12, tilt: 18 }, head: { nod: -2, turn: 10, tilt: 6 }, l_arm: { raise: 62, straddle: 52, turn: -18 }, r_arm: { raise: -12, straddle: 18, turn: 10 }, l_elbow: { bend: 96 }, r_elbow: { bend: 108 }, l_leg: { raise: 10, straddle: 5, turn: -10 }, r_leg: { raise: -8, straddle: 6, turn: 9 }, l_knee: { bend: 24 }, r_knee: { bend: 16 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: -10 , z: 0 }, chest: { x: -37, y: 12 , z: 0 }, neck: { x: -7, y: 0 , z: 0 }, head: { x: 20, y: 14 , z: 0 }, leftUpperArm: { x: 71, y: -69 , z: -12 }, leftLowerArm: {  x: 67, y: 0 , z: 0 }, rightUpperArm: {  x: -37, y: -20 , z: -18 },  rightLowerArm: {  x: 7, y: -78 , z: 59 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 33, y: 0, z: 0 }, leftUpperLeg: { x: 39, y: -35, z: 37 }, leftLowerLeg: { x: -37, y: 0, z: 0 }, rightUpperLeg: { x: -22, y: 0, z: 0 }, rightLowerLeg: { x: -16, y: 0, z: 0 }, leftFoot: { x: 7, y: 0, z: 0 }, rightFoot: { x: 33, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 100, index: 100, middle: 100, ring: 100, pinky: 100, spread: 0 }, { thumb: 100, index: 100, middle: 100, ring: 100, pinky: 100, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'push_object', label: '推东西', jointAngles: libTvAngles({ body: { bend: 14 }, torso: { bend: 40 }, head: { nod: 12 }, l_arm: { raise: 40, straddle: 18, turn: 18 }, r_arm: { raise: 40, straddle: 18, turn: 18 }, l_elbow: { bend: 54 }, r_elbow: { bend: 54 }, l_leg: { raise: 18, straddle: 6, turn: -8 }, r_leg: { raise: -18, straddle: 6, turn: 8 }, l_knee: { bend: 30 }, r_knee: { bend: 26 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 11, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 9, y: -9 , z: 83 }, leftLowerArm: {  x: 0, y: 0 , z: 0 }, rightUpperArm: {  x: 9, y: -9 , z: 83 },  rightLowerArm: {  x: 0, y: 0 , z: 0 }, leftHand: { x: -90, y: 0, z: 0 }, rightHand: { x: -90, y: 0, z: 0 }, leftUpperLeg: { x: 55, y: 0, z: 0 }, leftLowerLeg: { x: -51, y: 0, z: 0 }, rightUpperLeg: { x: -15, y: -19, z: 6 }, rightLowerLeg: { x: -32, y: 4, z: 9 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 51, y: 0, z: -13 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'lean_back', label: '后仰', jointAngles: libTvAngles({ body: { bend: -12 }, torso: { bend: -28 }, head: { nod: -18 }, l_arm: { raise: -10, straddle: 26 }, r_arm: { raise: -10, straddle: 26 }, l_elbow: { bend: 24 }, r_elbow: { bend: 24 }, l_leg: { raise: 10, straddle: 8 }, r_leg: { raise: 10, straddle: 8 }, l_knee: { bend: 12 }, r_knee: { bend: 12 } }), rigPose: presetRigPose({ pelvis: { x: -70, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 37, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: -69, y: -180 , z: -37 }, leftLowerArm: {  x: 116, y: 0 , z: 0 }, rightUpperArm: {  x: -54, y: -180 , z: -37 },  rightLowerArm: {  x: 116, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: -7, y: -24, z: -7 }, leftLowerLeg: { x: -35, y: 0, z: 0 }, rightUpperLeg: { x: 18, y: -37, z: 0 }, rightLowerLeg: { x: -59, y: 0, z: 0 }, leftFoot: { x: -22, y: 0, z: 0 }, rightFoot: { x: -50, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 50, index: 50, middle: 50, ring: 50, pinky: 50, spread: 0 }, { thumb: 50, index: 50, middle: 50, ring: 50, pinky: 50, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'hands_hips', label: '叉腰', jointAngles: libTvAngles({ head: { nod: -4 }, l_arm: { raise: 15, straddle: 28, turn: -8 }, r_arm: { raise: 15, straddle: 28, turn: 8 }, l_elbow: { bend: 112 }, r_elbow: { bend: 112 }, l_leg: { straddle: 6 }, r_leg: { straddle: 6 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 29, y: -12 , z: -16 }, leftLowerArm: {  x: 101, y: 0 , z: 0 }, rightUpperArm: {  x: 29, y: -12 , z: -16 },  rightLowerArm: {  x: 101, y: 0 , z: 0 }, leftHand: { x: -37, y: 39, z: 67 }, rightHand: { x: -37, y: 39, z: 67 }, leftUpperLeg: { x: 0, y: 0, z: 7 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, rightUpperLeg: { x: 0, y: 0, z: 7 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'wave', label: '挥手', jointAngles: libTvAngles({ torso: { bend: 2, turn: -6 }, head: { nod: -4, turn: 8, tilt: 3 }, l_elbow: { bend: 8 }, r_arm: { raise: 88, straddle: -10, turn: 80 }, r_elbow: { bend: 70 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 68, y: 0 , z: 0 }, leftLowerArm: {  x: 11, y: 0 , z: 0 }, rightUpperArm: {  x: -62, y: -83 , z: 0 },  rightLowerArm: {  x: 0, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 21, y: 0, z: 0 }, leftUpperLeg: { x: 0, y: 0, z: 7 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, rightUpperLeg: { x: 0, y: 0, z: 7 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'arms_crossed', label: '抱臂', jointAngles: libTvAngles({ torso: { turn: 2 }, head: { nod: -6 }, l_arm: { raise: 25, straddle: 18, turn: 24 }, r_arm: { raise: 25, straddle: 18, turn: -24 }, l_elbow: { bend: 118 }, r_elbow: { bend: 118 }, l_leg: { straddle: 5 }, r_leg: { straddle: 5 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 66, y: 17 , z: 15 }, leftLowerArm: {  x: -2, y: 60 , z: 113 }, rightUpperArm: {  x: 66, y: 4 , z: 32 },  rightLowerArm: {  x: -2, y: 60, z: 113 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 21, y: 0, z: 0 }, leftUpperLeg: { x: 0, y: 0, z: 7 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, rightUpperLeg: { x: 0, y: 0, z: 7 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 80, index: 80, middle: 80, ring: 80, pinky: 80, spread: 0 }, { thumb: 80, index: 80, middle: 80, ring: 80, pinky: 80, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'salute', label: '敬礼', jointAngles: libTvAngles({ head: { nod: -3 }, l_elbow: { bend: 8 }, r_arm: { raise: 62, straddle: 12, turn: 18 }, r_elbow: { bend: 96 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 79, y: 0 , z: 0 }, leftLowerArm: {  x: 0, y: 0 , z: 0 }, rightUpperArm: {  x: 15, y: -177 , z: 2 },  rightLowerArm: {  x: 141, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 0, y: 0, z: 7 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, rightUpperLeg: { x: 0, y: 0, z: 7 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'bow', label: '鞠躬', jointAngles: libTvAngles({ torso: { bend: 36 }, head: { nod: 10 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 65, y: 0 , z: 0 }, neck: { x: 7, y: 0 , z: 0 }, head: { x: 10, y: 0 , z: 0 }, leftUpperArm: { x: 92, y: -45 , z: 49 }, leftLowerArm: {  x: 11, y: 0 , z: 0 }, rightUpperArm: { x: 92, y: -45 , z: 49 },  rightLowerArm: { x: 11, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 0, y: 0, z: 0 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, rightUpperLeg: { x: 0, y: 0, z: 0 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'point', label: '指向', jointAngles: libTvAngles({ torso: { turn: -8 }, head: { nod: -3, turn: -8 }, l_elbow: { bend: 8 }, r_arm: { raise: 48, straddle: -4, turn: 10 }, r_elbow: { bend: 6 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 79, y: 0 , z: 0 }, leftLowerArm: {  x: 0, y: 0 , z: 0 }, rightUpperArm: {  x: 0, y: 0 , z: 83 },  rightLowerArm: {  x: 0, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 0, y: 0, z: 7 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, rightUpperLeg: { x: 0, y: 0, z: 7 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 120, index: 0, middle: 120, ring: 120, pinky: 120, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'pray', label: '祈祷', jointAngles: libTvAngles({ torso: { bend: 4 }, head: { nod: 10 }, l_arm: { raise: 48, straddle: 8 }, r_arm: { raise: 48, straddle: 8 }, l_elbow: { bend: 92 }, r_elbow: { bend: 92 }, l_leg: { straddle: 4 }, r_leg: { straddle: 4 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 40, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: -8 , z: 0 }, leftUpperArm: { x: 46, y: 26 , z: 46 }, leftLowerArm: {  x: 0, y: -9 , z: 134 }, rightUpperArm: {  x: 46, y: 26 , z: 46 },  rightLowerArm: {  x: 0, y: -9 , z: 134 }, leftHand: { x: -30, y: 0, z: 0 }, rightHand: { x: -30, y: 0, z: 0 }, leftUpperLeg: { x: 13, y: 2, z: 14 }, leftLowerLeg: { x: -109, y: 3, z: 0 }, rightUpperLeg: { x: 13, y: 2, z: 14 }, rightLowerLeg: { x: -109, y: 3, z: 0 }, leftFoot: { x: 14, y: 0, z: 0 }, rightFoot: { x: 14, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 120, index: 0, middle: 120, ring: 120, pinky: 120, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 46, y: 0, z: 0 }, rightBase: { x: 46, y: 0, z: 0 }} },
  { id: 'kneel_pray', label: '跪地祈祷', jointAngles: libTvAngles({ body: { bend: 8 }, torso: { bend: 42 }, head: { nod: 24 }, l_arm: { raise: 36, straddle: 10 }, r_arm: { raise: 36, straddle: 10 }, l_elbow: { bend: 72 }, r_elbow: { bend: 72 }, l_leg: { raise: 20, straddle: 8 }, r_leg: { raise: 20, straddle: 8 }, l_knee: { bend: 126 }, r_knee: { bend: 126 } }), rigPose: presetRigPose({ pelvis: { x: 23, y: 0 , z: 0 }, chest: { x: 79, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 38, y: -38 , z: 66 }, leftLowerArm: {  x: -47, y: 6 , z: 62 }, rightUpperArm: { x: 38, y: -38 , z: 66 },  rightLowerArm: {  x: -47, y: 6 , z: 62 }, leftHand: { x: -38, y: 0, z: 0 }, rightHand: { x: -38, y: 0, z: 0 }, leftUpperLeg: { x: 90, y: 2, z: 14 }, leftLowerLeg: { x: -148, y: 3, z: 0 }, rightUpperLeg: { x: 90, y: 2, z: 14 }, rightLowerLeg: { x: -148, y: 3, z: 0 }, leftFoot: { x: -62, y: 0, z: 0 }, rightFoot: { x: -62, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'push_up', label: '俯卧撑', jointAngles: libTvAngles({ body: { bend: -34 }, torso: { bend: 32 }, head: { nod: -10 }, l_arm: { raise: 28, straddle: 28 }, r_arm: { raise: 28, straddle: 28 }, l_elbow: { bend: 86 }, r_elbow: { bend: 86 }, l_leg: { raise: -34, straddle: 8 }, r_leg: { raise: -34, straddle: 8 }, l_knee: { bend: 8 }, r_knee: { bend: 8 } }), rigPose: presetRigPose({ pelvis: { x: 90, y: 0 , z: 0 }, chest: { x: -6, y: 0 , z: 0 }, neck: { x: -10, y: 0 , z: 0 }, head: { x: -34, y: 0 , z: 0 }, leftUpperArm: { x: 38, y: -90 , z: 0 }, leftLowerArm: {  x: 90, y: 104 , z: 0 }, rightUpperArm: { x: 38, y: -90 , z: 0 },  rightLowerArm: { x: 90, y: 104 , z: 0 }, leftHand: { x: -80, y: 0, z: 0 }, rightHand: { x: -80, y: 0, z: 0 }, leftUpperLeg: { x: 17, y: 0, z: 5 }, leftLowerLeg: { x: -15, y: 0, z: 0 }, rightUpperLeg: { x: 17, y: 0, z: 5 }, rightLowerLeg: { x: -15, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 50, y: 0, z: 0 }, rightBase: { x: 50, y: 0, z: 0 }} },
  { id: 'dance', label: '舞蹈', jointAngles: libTvAngles({ body: { tilt: 10 }, torso: { bend: 6, turn: 14, tilt: -10 }, head: { nod: -6, turn: -8 }, l_arm: { raise: 72, straddle: 28 }, r_arm: { raise: 28, straddle: 36 }, l_elbow: { bend: 36 }, r_elbow: { bend: 80 }, l_leg: { raise: 16, straddle: 16 }, r_leg: { raise: -12, straddle: 10 }, l_knee: { bend: 38 }, r_knee: { bend: 12 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 45, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 28, y: -47 , z: -38 }, leftLowerArm: {  x: 19, y: 0 , z: 0 }, rightUpperArm: {  x: 19, y: 11 , z: 53 },  rightLowerArm: { x: 30, y: 28 , z: 94 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 19, y: 0, z: 0 }, leftLowerLeg: { x: 11, y: 0, z: 0 }, rightUpperLeg: { x: -12, y: 0, z: 0 }, rightLowerLeg: { x: 12, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'roll', label: '翻滚', jointAngles: libTvAngles({ body: { bend: -54, tilt: 20 }, torso: { bend: 60, tilt: -18 }, head: { nod: 18 }, l_arm: { raise: 48, straddle: 24 }, r_arm: { raise: 50, straddle: 24 }, l_elbow: { bend: 102 }, r_elbow: { bend: 104 }, l_leg: { raise: 58, straddle: 10 }, r_leg: { raise: 52, straddle: 10 }, l_knee: { bend: 112 }, r_knee: { bend: 108 } }), rigPose: presetRigPose({ pelvis: { x: 83, y: 0 , z: 0 }, chest: { x: 36, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: -40, y: 0 , z: 0 }, leftUpperArm: { x: 70, y: -64 , z: 145 }, leftLowerArm: {  x: -64, y: 72 , z: 66 }, rightUpperArm: {  x: 70, y: -64 , z: 145 },  rightLowerArm: {  x: -64, y: 72 , z: 66 }, leftHand: { x: -32, y: 0, z: 0 }, rightHand: { x: -32, y: 0, z: 0 }, leftUpperLeg: { x: 34, y: 0, z: 0 }, leftLowerLeg: { x: -21, y: 0, z: 0 }, rightUpperLeg: { x: -6, y: 0, z: 0 }, rightLowerLeg: { x: -21, y: 0, z: 0 }, leftFoot: { x: -34, y: 0, z: 0 }, rightFoot: { x: -60, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'crawl', label: '爬行', jointAngles: libTvAngles({ body: { bend: -28, tilt: 4 }, torso: { bend: 42, tilt: -6 }, head: { nod: -12 }, l_arm: { raise: 24, straddle: 30 }, r_arm: { raise: 40, straddle: 26 }, l_elbow: { bend: 82 }, r_elbow: { bend: 92 }, l_leg: { raise: -62, straddle: 14 }, r_leg: { raise: -38, straddle: 18 }, l_knee: { bend: 106 }, r_knee: { bend: 92 } }), rigPose: presetRigPose({ pelvis: { x: 90, y: 0 , z: 0 }, chest: { x: 0, y: 26 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: -70, y: 0 , z: 0 }, leftUpperArm: { x: 9, y: -34 , z: 115 }, leftLowerArm: {  x: -23, y: 19 , z: 6 }, rightUpperArm: {  x: 36, y: -70 , z: -2 },  rightLowerArm: {  x: -30, y: 11 , z: 111 }, leftHand: { x: -54, y: 0, z: 0 }, rightHand: { x: -47, y: 0, z: 0 }, leftUpperLeg: { x: 36, y: 0, z: 0 }, leftLowerLeg: { x: -30, y: 0, z: 0 }, rightUpperLeg: { x: 145, y: 0, z: 12 }, rightLowerLeg: { x: -141, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 30, middle: 30, ring: 30, pinky: 30, spread: 0 }, { thumb: 0, index: 30, middle: 30, ring: 30, pinky: 30, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 40, y: 0, z: 0 }, rightBase: { x: 51, y: 0, z: 0 }} },
  { id: 'sneak', label: '潜行', jointAngles: libTvAngles({ body: { bend: 10 }, torso: { bend: 24, turn: 6 }, head: { nod: -10, turn: -4 }, l_arm: { raise: 22, straddle: 14 }, r_arm: { raise: -10, straddle: 14 }, l_elbow: { bend: 72 }, r_elbow: { bend: 64 }, l_leg: { raise: 42, straddle: 4 }, r_leg: { raise: -22, straddle: 6 }, l_knee: { bend: 82 }, r_knee: { bend: 58 } }), rigPose: presetRigPose({ pelvis: { x: 38, y: 0 , z: 0 }, chest: { x: 0, y: 13 , z: 0 }, neck: { x: 13, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 36, y: 85 , z: 17 }, leftLowerArm: {  x: -66, y: -62 , z: 17 }, rightUpperArm: {  x: 85, y: 28 , z: -36 },  rightLowerArm: {  x: -4, y: -43 , z: 2 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: -26, y: 0, z: 0 }, leftUpperLeg: { x: 111, y: 0, z: 0 }, leftLowerLeg: { x: -72, y: 0, z: 0 }, rightUpperLeg: { x: 28, y: 0, z: 30 }, rightLowerLeg: { x: -55, y: -6, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: -36, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 30, index: 30, middle: 30, ring: 30, pinky: 30, spread: 0 }, { thumb: 30, index: 30, middle: 30, ring: 30, pinky: 30, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 34, y: 0, z: 0 }} },
  { id: 'slide', label: '滑行', jointAngles: libTvAngles({ body: { bend: -8, tilt: 12 }, torso: { bend: 12, tilt: -12 }, head: { nod: -8 }, l_arm: { raise: 18, straddle: 22 }, r_arm: { raise: -16, straddle: 24 }, l_elbow: { bend: 36 }, r_elbow: { bend: 42 }, l_leg: { raise: 64, straddle: 10 }, r_leg: { raise: -42, straddle: 8 }, l_knee: { bend: 26 }, r_knee: { bend: 92 } }), rigPose: presetRigPose({ pelvis: { x: -40, y: 0 , z: 0 }, chest: { x: 32, y: -21 , z: 0 }, neck: { x: -36, y: 0 , z: 0 }, head: { x: 43, y: 0 , z: 0 }, leftUpperArm: { x: 11, y: 9 , z: 62 }, leftLowerArm: {  x: 32, y: -9 , z: 70 }, rightUpperArm: {  x: 53, y: 0 , z: 0 },  rightLowerArm: {  x: 0, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 38, y: 13, z: 0 }, leftLowerLeg: { x: -11, y: 51, z: 0 }, rightUpperLeg: { x: -45, y: -15, z: 62 }, rightLowerLeg: { x: -109, y: 43, z: -47 }, leftFoot: { x: -81, y: -45, z: -38 }, rightFoot: { x: 23, y: -15, z: -11 } }), fingerPose: fingerPose({ thumb: 0, index: 20, middle: 45, ring: 60, pinky: 80, spread: 0 }, { thumb: 0, index: 10, middle: 30, ring: 50, pinky: 70, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 36, y: -11, z: 0 }} },
  { id: 'prone_kneel', label: '俯身跪', jointAngles: libTvAngles({ body: { bend: -16 }, torso: { bend: 48 }, head: { nod: -10 }, l_arm: { raise: 42, straddle: 24 }, r_arm: { raise: 42, straddle: 24 }, l_elbow: { bend: 78 }, r_elbow: { bend: 78 }, l_leg: { raise: -18, straddle: 12 }, r_leg: { raise: -18, straddle: 12 }, l_knee: { bend: 118 }, r_knee: { bend: 118 } }), rigPose: presetRigPose({ pelvis: { x: 90, y: 0 , z: 0 }, chest: { x: 34, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 6, y: 0 , z: 0 }, leftUpperArm: { x: -6, y: -62, z: 66 }, leftLowerArm: {  x: -47, y: 6 , z: 62 }, rightUpperArm: {  x: 13, y: -121 , z: 124 },  rightLowerArm: {  x: 13, y: 51 , z: -11 }, leftHand: { x: -34, y: 0, z: 0 }, rightHand: { x: -38, y: 0, z: 0 }, leftUpperLeg: { x: 64, y: 2, z: 14 }, leftLowerLeg: { x: -60, y: 3, z: 0 }, rightUpperLeg: { x: 64, y: 2, z: 14 }, rightLowerLeg: { x: -60, y: 3, z: 0 }, leftFoot: { x: -62, y: 0, z: 0 }, rightFoot: { x: -62, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'jump', label: '跳起', jointAngles: libTvAngles({ body: { bend: 8 }, torso: { bend: 12 }, head: { nod: -8 }, l_arm: { raise: 70, straddle: 20 }, r_arm: { raise: 70, straddle: 20 }, l_elbow: { bend: 20 }, r_elbow: { bend: 20 }, l_leg: { raise: 34, straddle: 10 }, r_leg: { raise: 28, straddle: 10 }, l_knee: { bend: 76 }, r_knee: { bend: 72 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 9, y: 0 , z: -68 }, leftLowerArm: {  x: 13, y: 47 , z: 0 }, rightUpperArm: {  x: 9, y: 0 , z: -68 },  rightLowerArm: {  x: 13, y: 47 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 17, y: 0, z: 6 }, leftLowerLeg: { x: -75, y: 0, z: -6 }, rightUpperLeg: { x: 104, y: 4, z: 40 }, rightLowerLeg: { x: -45, y: 30, z: -60 }, leftFoot: { x: -70, y: 0, z: 0 }, rightFoot: { x: -83, y: -49, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'side_kick', label: '侧踢', jointAngles: libTvAngles({ body: { bend: 0, tilt: -18 }, torso: { bend: 4, tilt: 16 }, head: { nod: -6 }, l_arm: { raise: 18, straddle: 24 }, r_arm: { raise: 22, straddle: 24 }, l_elbow: { bend: 60 }, r_elbow: { bend: 56 }, l_leg: { raise: 72, straddle: 62, turn: -18 }, r_leg: { raise: -8, straddle: 8 }, l_knee: { bend: 8 }, r_knee: { bend: 18 } }), rigPose: presetRigPose({ pelvis: { x: -70, y: 70 , z: -13 }, chest: { x: 0, y: 13 , z: 0 }, neck: { x: -6, y: 2 , z: 19 }, head: { x: 4, y: -17 , z: 0 }, leftUpperArm: { x: 9, y: 43, z: -66 }, leftLowerArm: {  x: 55, y: 47 , z: 100 }, rightUpperArm: {  x: 72, y: 0 , z: 0 },  rightLowerArm: {  x: 0, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 0, y: -15, z: 89 }, leftLowerLeg: { x: -6, y: 0, z: -19 }, rightUpperLeg: { x: 32, y: 28, z: 0 }, rightLowerLeg: { x: -28, y: -4, z: 0 }, leftFoot: { x: 11, y: 0, z: 0 }, rightFoot: { x: -11, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 0 }, { thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: -4, y: 4, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'fight', label: '格斗', jointAngles: libTvAngles({ body: { bend: 6, turn: 10 }, torso: { bend: 8, turn: 10 }, head: { nod: -6, turn: -6 }, l_arm: { raise: 36, straddle: 18 }, r_arm: { raise: 36, straddle: 18 }, l_elbow: { bend: 112 }, r_elbow: { bend: 112 }, l_leg: { raise: 12, straddle: 14, turn: 8 }, r_leg: { raise: -8, straddle: 14, turn: -8 }, l_knee: { bend: 24 }, r_knee: { bend: 32 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 11, y: 26 , z: 0 }, neck: { x: 15, y: 0 , z: 0 }, head: { x: -19, y: 60 , z: 0 }, leftUpperArm: { x: 53, y: -23 , z: 34 }, leftLowerArm: {  x: 100, y: 13 , z: 83 }, rightUpperArm: {  x: 85, y: -28 , z: 17 },  rightLowerArm: {  x: 70, y: 60 , z: 75 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 26, y: 0, z: 38 }, leftLowerLeg: { x: -55, y: 6, z: -19 }, rightUpperLeg: { x: 0, y: 40, z: 49 }, rightLowerLeg: { x: -47, y: -34, z: -38 }, leftFoot: { x: 32, y: 0, z: 0 }, rightFoot: { x: 2, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 0 }, { thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'fight1', label: '格斗1', jointAngles: libTvAngles({ body: { bend: 4, turn: -14 }, torso: { bend: 10, turn: -12 }, head: { nod: -6, turn: 8 }, l_arm: { raise: 46, straddle: 18 }, r_arm: { raise: 18, straddle: 22 }, l_elbow: { bend: 96 }, r_elbow: { bend: 122 }, l_leg: { raise: -10, straddle: 12 }, r_leg: { raise: 26, straddle: 12 }, l_knee: { bend: 38 }, r_knee: { bend: 48 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: -36 , z: 0 }, chest: { x: 0, y: 51 , z: 0 }, neck: { x: 15, y: 0 , z: 0 }, head: { x: -4, y: 83 , z: 0 }, leftUpperArm: { x: 19, y: 21 , z: 6 }, leftLowerArm: {  x: 68, y: -9 , z: 115 }, rightUpperArm: {  x: -11, y: -151 , z: 47 },  rightLowerArm: {  x: -85, y: -180 , z: 162 }, leftHand: { x: 17, y: 0, z: 0 }, rightHand: { x: 2, y: 0, z: 0 }, leftUpperLeg: { x: -40, y: -132, z: -23 }, leftLowerLeg: { x: -47, y: 11, z: 13 }, rightUpperLeg: { x: 26, y: 104, z: 13 }, rightLowerLeg: { x: -94, y: -28, z: -21 }, leftFoot: { x: 32, y: 0, z: -17 }, rightFoot: { x: 0, y: 19, z: 0 } }), fingerPose: fingerPose({ thumb: 30, index: 30, middle: 30, ring: 30, pinky: 30, spread: 0 }, { thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'fight2', label: '格斗2', jointAngles: libTvAngles({ body: { bend: 4, turn: -14 }, torso: { bend: 10, turn: -12 }, head: { nod: -6, turn: 8 }, l_arm: { raise: 46, straddle: 18 }, r_arm: { raise: 18, straddle: 22 }, l_elbow: { bend: 96 }, r_elbow: { bend: 122 }, l_leg: { raise: -10, straddle: 12 }, r_leg: { raise: 26, straddle: 12 }, l_knee: { bend: 38 }, r_knee: { bend: 48 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 11, y: 26 , z: 0 }, neck: { x: 15, y: 0 , z: 0 }, head: { x: -19, y: 60 , z: 0 }, leftUpperArm: { x: 43, y: -26 , z: 17 }, leftLowerArm: {  x: 89, y: 28 , z: 96 }, rightUpperArm: {  x: 124, y: -49 , z: 87 },  rightLowerArm: {  x: 55, y: 60 , z: 75 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 26, y: -26, z: 32 }, leftLowerLeg: { x: -23, y: 6, z: -19 }, rightUpperLeg: { x: -21, y: 40, z: 49 }, rightLowerLeg: { x: -38, y: -34, z: -38 }, leftFoot: { x: 0, y: 0, z: 0 }, rightFoot: { x: -19, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 0 }, { thumb: 120, index: 120, middle: 120, ring: 120, pinky: 120, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 45, y: 0, z: 0 }} },
  { id: 'controlled', label: '受控1', jointAngles: libTvAngles({ body: { bend: -8, tilt: 12 }, torso: { bend: -10, tilt: -10 }, head: { nod: -18, tilt: 6 }, l_arm: { raise: 78, straddle: 34 }, r_arm: { raise: 78, straddle: 34 }, l_elbow: { bend: 18 }, r_elbow: { bend: 18 }, l_leg: { raise: 18, straddle: 14 }, r_leg: { raise: -12, straddle: 14 }, l_knee: { bend: 28 }, r_knee: { bend: 20 } }), rigPose: presetRigPose({ pelvis: { x: 90, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 26, y: 0 , z: 0 }, head: { x: 30, y: 0 , z: 0 }, leftUpperArm: { x: 0, y: 0 , z: 90 }, leftLowerArm: {  x: 0, y: 0 , z: 0 }, rightUpperArm: {  x: 0, y: 0 , z: 90 },  rightLowerArm: {  x: 0, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 90, y: 0, z: 3 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, rightUpperLeg: { x: 90, y: 0, z: 3 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: -60, y: 0, z: 0 }, rightFoot: { x: -60, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'controlled2', label: '受控2', jointAngles: libTvAngles({ body: { bend: -14, tilt: -16 }, torso: { bend: -16, tilt: 14 }, head: { nod: -20, turn: -8 }, l_arm: { raise: 88, straddle: 26 }, r_arm: { raise: 62, straddle: 40 }, l_elbow: { bend: 30 }, r_elbow: { bend: 24 }, l_leg: { raise: -20, straddle: 16 }, r_leg: { raise: 20, straddle: 18 }, l_knee: { bend: 32 }, r_knee: { bend: 36 } }), rigPose: presetRigPose({ pelvis: { x: -60, y: 0 , z: 0 }, chest: { x: -50, y: -36 , z: 0 }, neck: { x: -2, y: 0 , z: 0 }, head: { x: -21, y: 0 , z: 0 }, leftUpperArm: { x: -96, y: -96 , z: -43 }, leftLowerArm: {  x: 0, y: 0 , z: 0 }, rightUpperArm: {  x: 0, y: 43 , z: -55 },  rightLowerArm: {  x: 0, y: 0 , z: 0 }, leftHand: { x: -17, y: 0, z: 0 }, rightHand: { x: -13, y: 0, z: 0 }, leftUpperLeg: { x: 0, y: 21, z: 23 }, leftLowerLeg: { x: -60, y: -11, z: -81 }, rightUpperLeg: { x: -40, y: -6, z: 3 }, rightLowerLeg: { x: -26, y: 0, z: 0 }, leftFoot: { x: -72, y: 0, z: 0 }, rightFoot: { x: -77, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 30, index: 30, middle: 30, ring: 30, pinky: 30, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'float1', label: '漂浮1', jointAngles: libTvAngles({ body: { bend: -2, turn: 0, tilt: 0 }, torso: { bend: 0, turn: 0, tilt: 0 }, head: { nod: -2, turn: 0, tilt: 0 }, l_arm: { raise: 42, straddle: 58, turn: -20 }, r_arm: { raise: 42, straddle: 58, turn: 20 }, l_elbow: { bend: 22 }, r_elbow: { bend: 22 }, l_leg: { raise: -12, straddle: 2, turn: -2 }, r_leg: { raise: 36, straddle: 10, turn: 6 }, l_knee: { bend: 6 }, r_knee: { bend: 112 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 68, y: -66 , z: 0 }, leftLowerArm: {  x: 77, y: -32 , z: 68 }, rightUpperArm: {  x: 68, y: -66 , z: 0 },  rightLowerArm: { x: 77, y: -32 , z: 68 }, leftHand: { x: -4, y: 58, z: 0 }, rightHand: {x: -4, y: 58, z: 0 }, leftUpperLeg: { x: 13, y: -36, z: 26 }, leftLowerLeg: { x: 49, y: 13, z: -138 }, rightUpperLeg: { x: 13, y: -4, z: 3 }, rightLowerLeg: { x: -15, y: 6, z: -2 }, leftFoot: { x: -66, y: -96, z: 0 }, rightFoot: { x: -53, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'float2', label: '漂浮2', jointAngles: libTvAngles({ body: { bend: 12, turn: 0, tilt: 0 }, torso: { bend: 22, turn: 0, tilt: 0 }, head: { nod: 22, turn: 0, tilt: 0 }, l_arm: { raise: 104, straddle: 70, turn: -18 }, r_arm: { raise: 104, straddle: 70, turn: 18 }, l_elbow: { bend: 6 }, r_elbow: { bend: 6 }, l_leg: { raise: 78, straddle: 42, turn: -14 }, r_leg: { raise: 78, straddle: 42, turn: 14 }, l_knee: { bend: 124 }, r_knee: { bend: 124 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 0 }, chest: { x: 53, y: 0 , z: 0 }, neck: { x: 40, y: 0 , z: 0 }, head: { x: -23, y: 0 , z: 0 }, leftUpperArm: { x: -11, y: 4, z: -36 }, leftLowerArm: {  x: 0, y: 0 , z: 0 }, rightUpperArm: { x: -11, y: 4, z: -36 },  rightLowerArm: {  x: 0, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 77, y: 6, z: 32 }, leftLowerLeg: { x: -149, y: 0, z: 0 }, rightUpperLeg: { x: 104, y: -19, z: 53 }, rightLowerLeg: { x: -68, y: 75, z: -51 }, leftFoot: { x: -75, y: 0, z: 0 }, rightFoot: { x: -53, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'lie_pose1', label: '躺姿1', jointAngles: libTvAngles({ body: { bend: 84, turn: -4, tilt: 6 }, torso: { bend: -78, turn: 4, tilt: -6 }, head: { nod: -12, turn: 2, tilt: 4 }, l_arm: { raise: 76, straddle: 46, turn: -24 }, r_arm: { raise: 76, straddle: 46, turn: 24 }, l_elbow: { bend: 128 }, r_elbow: { bend: 128 }, l_leg: { raise: -8, straddle: 3, turn: -2 }, r_leg: { raise: -8, straddle: 3, turn: 2 }, l_knee: { bend: 0 }, r_knee: { bend: 0 } }), rigPose: presetRigPose({ pelvis: { x: -90, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 37, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: -69, y: -180 , z: -37 }, leftLowerArm: {  x: 116, y: 0 , z: 0 }, rightUpperArm: {  x: -54, y: -180 , z: -37 },  rightLowerArm: {  x: 116, y: 0 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 47, y: 36, z: 3 }, leftLowerLeg: { x: -115, y: 23, z: -28 }, rightUpperLeg: { x: 0, y: -15, z: 3 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: -22, y: 0, z: 0 }, rightFoot: { x: -72, y: -28, z: 0 } }), fingerPose: fingerPose({ thumb: 50, index: 50, middle: 50, ring: 50, pinky: 50, spread: 0 }, { thumb: 50, index: 50, middle: 50, ring: 50, pinky: 50, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'lie_pose2', label: '躺姿2', jointAngles: libTvAngles({ body: { bend: 84, turn: -2, tilt: -4 }, torso: { bend: -76, turn: 4, tilt: 4 }, head: { nod: -12, turn: 0, tilt: 2 }, l_arm: { raise: 76, straddle: 44, turn: -22 }, r_arm: { raise: 76, straddle: 44, turn: 22 }, l_elbow: { bend: 126 }, r_elbow: { bend: 126 }, l_leg: { raise: -8, straddle: 4, turn: -2 }, r_leg: { raise: 62, straddle: 14, turn: 4 }, l_knee: { bend: 0 }, r_knee: { bend: 96 } }), rigPose: presetRigPose({ pelvis: { x: -90, y: 0 , z: 0 }, chest: { x: 0, y: 0 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: 0 }, leftUpperArm: { x: 36, y: 66 , z: 15 }, leftLowerArm: {  x: 0, y: 0 , z: 0 }, rightUpperArm: {  x: 36, y: 62 , z: 15 },  rightLowerArm: {  x: 15, y: 30 , z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 47, y: 36, z: 3 }, leftLowerLeg: { x: -115, y: 23, z: -28 }, rightUpperLeg: { x: 0, y: -15, z: 3 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: -22, y: 0, z: 0 }, rightFoot: { x: -72, y: -28, z: 0 } }), fingerPose: fingerPose({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0 }, { thumb: 20, index: 30, middle: 40, ring: 50, pinky: 60, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} },
  { id: 'glamour_lie', label: '妖娆躺', jointAngles: libTvAngles({ body: { bend: 72, turn: -8, tilt: 18 }, torso: { bend: -58, turn: -14, tilt: -22 }, head: { nod: -36, turn: -18, tilt: 14 }, l_arm: { raise: -8, straddle: 46, turn: -16 }, r_arm: { raise: 50, straddle: 38, turn: 18 }, l_elbow: { bend: 112 }, r_elbow: { bend: 118 }, l_leg: { raise: -12, straddle: 12, turn: -6 }, r_leg: { raise: 54, straddle: 18, turn: 4 }, l_knee: { bend: 8 }, r_knee: { bend: 92 } }), rigPose: presetRigPose({ pelvis: { x: 0, y: 0 , z: 90 }, chest: { x: 0, y: -9 , z: 0 }, neck: { x: 0, y: 0 , z: 0 }, head: { x: 0, y: 0 , z: -43 }, leftUpperArm: { x: 87, y: 32, z: -17 }, leftLowerArm: {  x: 15, y: -30 , z: 75 }, rightUpperArm: {  x: -51, y: 153 , z: -62 },  rightLowerArm: {  x: -85, y: -153 , z: 166 }, leftHand: { x: 34, y: -6, z: 0 }, rightHand: { x: 4, y: 115, z: 36 }, leftUpperLeg: { x: 102, y: -13, z: -34 }, leftLowerLeg: { x: -141, y: 0, z: 0 }, rightUpperLeg: { x: 0, y: 0, z: 0 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: -62, y: 0, z: 0 }, rightFoot: { x: -32, y: 0, z: 0 } }), fingerPose: fingerPose({ thumb: 30, index: 30, middle: 30, ring: 30, pinky: 30, spread: 0 }, { thumb: 30, index: 30, middle: 30, ring: 30, pinky: 30, spread: 0 }), toePose: { ...TOE_POSE_NEUTRAL, leftBase: { x: 0, y: 0, z: 0 }, rightBase: { x: 0, y: 0, z: 0 }} }
];
const POSE_PRESET_ALIASES: Record<string, string> = { standing: 'stand', t_pose: 'tpose', default: 'stand' };
function normalizePosePresetId(presetId: string | undefined) {
  const id = presetId || 'stand';
  if (id === 'custom') return 'custom';
  const aliased = POSE_PRESET_ALIASES[id] || id;
  return LIBTV_POSE_PRESETS.some((item) => item.id === aliased) ? aliased : 'stand';
}
function libTvPresetForId(presetId?: string) {
  const normalized = normalizePosePresetId(presetId);
  return normalized === 'custom' ? undefined : LIBTV_POSE_PRESETS.find((item) => item.id === normalized);
}
function libTvJointAnglesForPresetId(presetId?: string) {
  return cloneLibTvJointAngles(libTvPresetForId(presetId)?.jointAngles);
}
const POSE_PRESETS: Array<{ id: string; label: string; pose: StandardHumanRigPose; bonePose?: Scene3DBonePose; fingerPose: StandardHumanFingerPose; toePose: StandardHumanToePose; rootOffset?: Vec3 }> = LIBTV_POSE_PRESETS.map((preset) => ({
  id: preset.id,
  label: preset.label,
  pose: preset.rigPose ? clonePose(preset.rigPose) : libTvPoseToRigPose(preset.jointAngles, preset.id),
  bonePose: cloneBonePose(preset.bonePose),
  fingerPose: cloneFingerPose(preset.fingerPose),
  toePose: cloneToePose(preset.toePose),
  rootOffset: preset.rootOffset
}));
function posePresetForId(presetId?: string) {
  return POSE_PRESETS.find((item) => item.id === normalizePosePresetId(presetId));
}
function uniquePosePresetOptions(currentPresetId?: string) {
  const ids = POSE_PRESETS.map((item) => item.id);
  const current = normalizePosePresetId(currentPresetId);
  return current && !ids.includes(current) ? [...ids, current] : ids;
}
function runningHubTvPresetLabel(presetId?: string) {
  return posePresetForId(presetId)?.label || presetId || 'Pose';
}
const FOUNDATION_POSE_ITEMS = POSE_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, preset }));
function normalizePoseFoundationHint(value: any, fallback?: PoseFoundationHint): PoseFoundationHint | undefined {
  if (!value && !fallback) return undefined;
  const source = value || fallback;
  const id = normalizePosePresetId(source?.id || fallback?.id || 'stand');
  return { id, label: source?.label || runningHubTvPresetLabel(id), confidence: Number.isFinite(Number(source?.confidence)) ? clamp01(Number(source.confidence)) : 0.5, reason: String(source?.reason || ''), rootOffset: normalizeVec(source?.rootOffset, vec()), bonePose: normalizeBonePose(source?.bonePose) };
}
function poseFoundationHintForCharacter(character: CharacterObject): PoseFoundationHint {
  const id = normalizePosePresetId(character.posePresetId || character.posePreset);
  return { id, label: runningHubTvPresetLabel(id), confidence: 1, reason: 'selected-preset', rootOffset: character.poseRootOffset || vec(), bonePose: cloneBonePose(character.bonePose) };
}
function resolvePosePresetState(
  presetId: string,
  options: { ignoreDefault?: boolean } = {}
) {
  const normalized = normalizePosePresetId(presetId);
  const preset = posePresetForId(normalized);
  if (options.ignoreDefault && !preset) return undefined;
  return {
    presetId: normalized,
    source: 'preset' as const,
    preset,
    rigPose: preset?.pose || zeroPose(),
    bonePose: cloneBonePose(preset?.bonePose),
    fingerPose: cloneFingerPose(preset?.fingerPose),
    toePose: cloneToePose(preset?.toePose),
    rootOffset: preset?.rootOffset || vec(),
    libTvJointAngles: libTvJointAnglesForPresetId(normalized)
  };
}
function posePatchFromPresetState(state: ReturnType<typeof resolvePosePresetState>) {
  return { posePreset: state.presetId, posePresetId: state.presetId, rigPose: clonePose(state.rigPose), bonePose: cloneBonePose(state.bonePose), fingerPose: cloneFingerPose(state.fingerPose), toePose: cloneToePose(state.toePose), poseRootOffset: state.rootOffset, libTvJointAngles: cloneLibTvJointAngles(state.libTvJointAngles) };
}
function isRunningHubTvBoneName(value: string): value is RunningHubTvBoneName {
  return typeof value === 'string' && value.length > 0;
}
function runningHubTvDeltaQuaternion(nameOrValue: RunningHubTvBoneName | RigRotation, maybeValue?: RigRotation) {
  const value = maybeValue || (nameOrValue as RigRotation);
  return runningHubTvRotationToQuaternion(value);
}
function landmarkSvgPoint(point?: PoseLandmarkPoint) {
  if (!point) return null;
  return { x: 50 + point.x * 45, y: 50 + point.y * 45, opacity: point.visible ?? 1 };
}

const TEMPLATE_LABELS: Record<ActionTemplateId, string> = {
  look_at: 'Look at',
  turn_to: 'Turn to',
  raise_hand: 'Raise hand',
  wave: 'Wave',
  point_at: 'Point at',
  step_forward: 'Step forward',
  step_back: 'Step back',
  sit_down: 'Sit down',
  stand_up: 'Stand up',
  pick_up: 'Pick up',
  put_down: 'Put down'
};

// Rig metadata, joint limits, and joint-axis semantics.
const BONE_TARGETS: Record<PoseJointKey, Array<{ name: string; weight: number }>> = {
  pelvis: [{ name: 'mixamorigHips', weight: 1 }],
  chest: [
    { name: 'mixamorigSpine', weight: 0.2 },
    { name: 'mixamorigSpine1', weight: 0.35 },
    { name: 'mixamorigSpine2', weight: 0.45 }
  ],
  neck: [{ name: 'mixamorigNeck', weight: 1 }],
  head: [{ name: 'mixamorigHead', weight: 1 }],
  leftUpperArm: [
    { name: 'mixamorigLeftShoulder', weight: 0.25 },
    { name: 'mixamorigLeftArm', weight: 0.75 }
  ],
  leftLowerArm: [{ name: 'mixamorigLeftForeArm', weight: 1 }],
  rightUpperArm: [
    { name: 'mixamorigRightShoulder', weight: 0.25 },
    { name: 'mixamorigRightArm', weight: 0.75 }
  ],
  rightLowerArm: [{ name: 'mixamorigRightForeArm', weight: 1 }],
  leftHand: [{ name: 'mixamorigLeftHand', weight: 1 }],
  rightHand: [{ name: 'mixamorigRightHand', weight: 1 }],
  leftUpperLeg: [{ name: 'mixamorigLeftUpLeg', weight: 1 }],
  leftLowerLeg: [{ name: 'mixamorigLeftLeg', weight: 1 }],
  rightUpperLeg: [{ name: 'mixamorigRightUpLeg', weight: 1 }],
  rightLowerLeg: [{ name: 'mixamorigRightLeg', weight: 1 }],
  leftFoot: [{ name: 'mixamorigLeftFoot', weight: 1 }],
  rightFoot: [{ name: 'mixamorigRightFoot', weight: 1 }]
};

const XBOT_BONE_NAME_ALIASES: Record<string, string> = {
  mixamorigHips: 'mixamorig:Hips',
  mixamorigSpine: 'mixamorig:Spine',
  mixamorigSpine1: 'mixamorig:Spine1',
  mixamorigSpine2: 'mixamorig:Spine2',
  mixamorigNeck: 'mixamorig:Neck',
  mixamorigHead: 'mixamorig:Head',
  mixamorigLeftShoulder: 'mixamorig:LeftShoulder',
  mixamorigLeftArm: 'mixamorig:LeftArm',
  mixamorigLeftForeArm: 'mixamorig:LeftForeArm',
  mixamorigLeftHand: 'mixamorig:LeftHand',
  mixamorigRightShoulder: 'mixamorig:RightShoulder',
  mixamorigRightArm: 'mixamorig:RightArm',
  mixamorigRightForeArm: 'mixamorig:RightForeArm',
  mixamorigRightHand: 'mixamorig:RightHand',
  mixamorigLeftUpLeg: 'mixamorig:LeftUpLeg',
  mixamorigLeftLeg: 'mixamorig:LeftLeg',
  mixamorigLeftFoot: 'mixamorig:LeftFoot',
  mixamorigLeftToeBase: 'mixamorig:LeftToeBase',
  mixamorigLeftToe_End: 'mixamorig:LeftToe_End',
  mixamorigRightUpLeg: 'mixamorig:RightUpLeg',
  mixamorigRightLeg: 'mixamorig:RightLeg',
  mixamorigRightFoot: 'mixamorig:RightFoot',
  mixamorigRightToeBase: 'mixamorig:RightToeBase',
  mixamorigRightToe_End: 'mixamorig:RightToe_End'
};

(['Left', 'Right'] as const).forEach((side) => {
  (['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const).forEach((finger) => {
    [1, 2, 3, 4].forEach((index) => {
      XBOT_BONE_NAME_ALIASES[`mixamorig${side}Hand${finger}${index}`] = `mixamorig:${side}Hand${finger}${index}`;
    });
  });
});

function runtimeBoneName(name: string) {
  return name.replace(':', '');
}

function boneNameCandidates(name: string) {
  const runtime = runtimeBoneName(name);
  const alias = XBOT_BONE_NAME_ALIASES[name] || XBOT_BONE_NAME_ALIASES[runtime];
  const candidates = [name, runtime, alias, alias ? runtimeBoneName(alias) : undefined];
  return Array.from(new Set(candidates.filter((candidate): candidate is string => Boolean(candidate))));
}

function findRigBone(rig: Scene3DCollectedRig, name: string) {
  for (const candidate of boneNameCandidates(name)) {
    const bone = rig.byName.get(candidate);
    if (bone) return bone;
  }
  return undefined;
}

function findRigRest(rig: Scene3DCollectedRig, name: string) {
  for (const candidate of boneNameCandidates(name)) {
    const rest = rig.rest.get(candidate);
    if (rest) return rest;
  }
  return undefined;
}

const FINGER_BONE_CHAINS = {
  left: {
    thumb: ['mixamorigLeftHandThumb1', 'mixamorigLeftHandThumb2', 'mixamorigLeftHandThumb3'],
    index: ['mixamorigLeftHandIndex1', 'mixamorigLeftHandIndex2', 'mixamorigLeftHandIndex3'],
    middle: ['mixamorigLeftHandMiddle1', 'mixamorigLeftHandMiddle2', 'mixamorigLeftHandMiddle3'],
    ring: ['mixamorigLeftHandRing1', 'mixamorigLeftHandRing2', 'mixamorigLeftHandRing3'],
    pinky: ['mixamorigLeftHandPinky1', 'mixamorigLeftHandPinky2', 'mixamorigLeftHandPinky3']
  },
  right: {
    thumb: ['mixamorigRightHandThumb1', 'mixamorigRightHandThumb2', 'mixamorigRightHandThumb3'],
    index: ['mixamorigRightHandIndex1', 'mixamorigRightHandIndex2', 'mixamorigRightHandIndex3'],
    middle: ['mixamorigRightHandMiddle1', 'mixamorigRightHandMiddle2', 'mixamorigRightHandMiddle3'],
    ring: ['mixamorigRightHandRing1', 'mixamorigRightHandRing2', 'mixamorigRightHandRing3'],
    pinky: ['mixamorigRightHandPinky1', 'mixamorigRightHandPinky2', 'mixamorigRightHandPinky3']
  }
} as const;

const FINGER_BONE_SUFFIXES = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  pinky: 'Pinky'
} as const;

const FINGER_OPTIONS: FingerKey[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const FINGER_LABELS: Record<FingerKey, string> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  pinky: 'Pinky'
};

const TOE_BONE_NAMES: Record<ToeKey, string[]> = {
  leftBase: ['mixamorigLeftToeBase', 'mixamorigLeftToe'],
  rightBase: ['mixamorigRightToeBase', 'mixamorigRightToe'],
  leftTip: [],
  rightTip: []
};

const TOE_OPTIONS: ToeKey[] = ['leftBase', 'rightBase'];
const TOE_LABELS: Record<ToeKey, string> = {
  leftBase: 'Left toe',
  rightBase: 'Right toe',
  leftTip: 'Left toe tip',
  rightTip: 'Right toe tip'
};

const FULL_ROTATION_LIMITS = { x: [-180, 180], y: [-180, 180], z: [-180, 180] } satisfies JointRotationLimits;

const TOE_LIMITS: Record<ToeKey, { x: [number, number]; y: [number, number]; z: [number, number] }> = {
  leftBase: FULL_ROTATION_LIMITS,
  rightBase: FULL_ROTATION_LIMITS,
  leftTip: FULL_ROTATION_LIMITS,
  rightTip: FULL_ROTATION_LIMITS
};

function clampToeRotation(key: ToeKey, value: RigRotation): RigRotation {
  const limits = TOE_LIMITS[key];
  return {
    x: clampNumber(Number.isFinite(value.x) ? value.x : 0, limits.x[0], limits.x[1]),
    y: clampNumber(Number.isFinite(value.y) ? value.y : 0, limits.y[0], limits.y[1]),
    z: clampNumber(Number.isFinite(value.z) ? value.z : 0, limits.z[0], limits.z[1])
  };
}

function clampToePose(value?: StandardHumanToePose | null): StandardHumanToePose {
  const pose = cloneToePose(value);
  return {
    leftBase: clampToeRotation('leftBase', pose.leftBase),
    rightBase: clampToeRotation('rightBase', pose.rightBase),
    leftTip: clampToeRotation('leftTip', pose.leftTip),
    rightTip: clampToeRotation('rightTip', pose.rightTip)
  };
}

type JointRotationLimits = { x: [number, number]; y: [number, number]; z: [number, number] };

const JOINT_LIMITS: Record<PoseJointKey, JointRotationLimits> = {
  pelvis: FULL_ROTATION_LIMITS,
  chest: FULL_ROTATION_LIMITS,
  neck: FULL_ROTATION_LIMITS,
  head: FULL_ROTATION_LIMITS,
  leftUpperArm: FULL_ROTATION_LIMITS,
  rightUpperArm: FULL_ROTATION_LIMITS,
  leftLowerArm: FULL_ROTATION_LIMITS,
  rightLowerArm: FULL_ROTATION_LIMITS,
  leftHand: FULL_ROTATION_LIMITS,
  rightHand: FULL_ROTATION_LIMITS,
  leftUpperLeg: FULL_ROTATION_LIMITS,
  rightUpperLeg: FULL_ROTATION_LIMITS,
  leftLowerLeg: FULL_ROTATION_LIMITS,
  rightLowerLeg: FULL_ROTATION_LIMITS,
  leftFoot: FULL_ROTATION_LIMITS,
  rightFoot: FULL_ROTATION_LIMITS
};

function rotationToControlSpace(jointKey: PoseJointKey, rotation: RigRotation): RigRotation {
  if (!usesMirroredControlSpace(jointKey)) return rotation;
  return { x: rotation.x, y: -rotation.y, z: -rotation.z };
}

function rotationFromControlSpace(jointKey: PoseJointKey, rotation: RigRotation): RigRotation {
  return rotationToControlSpace(jointKey, rotation);
}

function toeRotationToControlSpace(toeKey: ToeKey, rotation: RigRotation): RigRotation {
  if (toeKey !== 'rightBase' && toeKey !== 'rightTip') return rotation;
  return { x: rotation.x, y: -rotation.y, z: -rotation.z };
}

function toeRotationFromControlSpace(toeKey: ToeKey, rotation: RigRotation): RigRotation {
  return toeRotationToControlSpace(toeKey, rotation);
}

const JOINT_PARENTS: Partial<Record<PoseJointKey, PoseJointKey>> = {
  chest: 'pelvis',
  neck: 'chest',
  head: 'neck',
  leftUpperArm: 'chest',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightUpperArm: 'chest',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'pelvis',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  rightUpperLeg: 'pelvis',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg'
};

const JOINT_LABELS: Record<PoseJointKey, string> = {
  pelvis: 'Pelvis',
  chest: 'Chest',
  neck: 'Neck',
  head: 'Head',
  leftUpperArm: 'Left upper arm',
  leftLowerArm: 'Left forearm',
  leftHand: 'Left hand',
  rightUpperArm: 'Right upper arm',
  rightLowerArm: 'Right forearm',
  rightHand: 'Right hand',
  leftUpperLeg: 'Left thigh',
  leftLowerLeg: 'Left shin',
  leftFoot: 'Left foot',
  rightUpperLeg: 'Right thigh',
  rightLowerLeg: 'Right shin',
  rightFoot: 'Right foot'
};

const JOINT_SEMANTIC_ROLES: Record<PoseJointKey, string[]> = {
  pelvis: ['root', 'balance'],
  chest: ['torso', 'upper body'],
  neck: ['head support'],
  head: ['look direction'],
  leftUpperArm: ['left arm'],
  leftLowerArm: ['left forearm'],
  leftHand: ['left hand'],
  rightUpperArm: ['right arm'],
  rightLowerArm: ['right forearm'],
  rightHand: ['right hand'],
  leftUpperLeg: ['left leg'],
  leftLowerLeg: ['left shin'],
  leftFoot: ['left foot'],
  rightUpperLeg: ['right leg'],
  rightLowerLeg: ['right shin'],
  rightFoot: ['right foot']
};

type AxisEffectTemplate = Record<'x' | 'y' | 'z', {
  positive: string;
  negative: string;
  role: string;
}>;

const DEFAULT_AXIS_EFFECTS: Record<PoseJointKey, AxisEffectTemplate> = POSE_KEYS.reduce((acc, key) => {
  acc[key] = {
    x: { positive: '向前弯曲或抬起', negative: '向后伸展或下压', role: '控制关节在前后方向的弯曲幅度' },
    y: { positive: '向右旋转或外摆', negative: '向左旋转或内收', role: '控制关节左右扭转与开合方向' },
    z: { positive: '顺时针侧摆或翻转', negative: '逆时针侧摆或翻转', role: '控制关节侧向倾斜和局部滚转' }
  };
  return acc;
}, {} as Record<PoseJointKey, AxisEffectTemplate>);

function defaultJointAxisProfile(): Scene3DJointAxisProfile {
  const joints = POSE_KEYS.reduce((acc, key) => {
    const effects = DEFAULT_AXIS_EFFECTS[key];
    acc[key] = {
      key,
      label: JOINT_LABELS[key],
      parent: JOINT_PARENTS[key],
      bones: BONE_TARGETS[key].map((target) => ({
        name: XBOT_BONE_NAME_ALIASES[target.name] || target.name,
        weight: target.weight
      })),
      semanticRoles: JOINT_SEMANTIC_ROLES[key],
      axes: {
        x: {
          axis: 'x',
          range: JOINT_LIMITS[key].x,
          positive: { label: '+X', effect: effects.x.positive },
          negative: { label: '-X', effect: effects.x.negative },
          motionRole: effects.x.role
        },
        y: {
          axis: 'y',
          range: JOINT_LIMITS[key].y,
          positive: { label: '+Y', effect: effects.y.positive },
          negative: { label: '-Y', effect: effects.y.negative },
          motionRole: effects.y.role
        },
        z: {
          axis: 'z',
          range: JOINT_LIMITS[key].z,
          positive: { label: '+Z', effect: effects.z.positive },
          negative: { label: '-Z', effect: effects.z.negative },
          motionRole: effects.z.role
        }
      }
    };
    return acc;
  }, {} as Record<PoseJointKey, Scene3DJointDefinition>);

  return {
    version: 1,
    rigId: 'mixamo-xbot',
    modelUrl: MODEL_URL,
    rotationOrder: 'XYZ',
    applicationMode: 'rest_quaternion_multiply_delta',
    source: {
      skeleton: 'apps/web/public/models/x-bot.glb',
      inspectedAt: '2026-06-26',
      references: [
        'three:Object3D.localRotation',
        'three:Skeleton.boneHierarchy',
        'gltf:skins.joints.inverseBindMatrices'
      ]
    },
    joints
  };
}

function normalizeJointAxisProfile(value: any): Scene3DJointAxisProfile {
  const fallback = defaultJointAxisProfile();
  if (!value || typeof value !== 'object' || value.version !== 1 || value.rigId !== 'mixamo-xbot') return fallback;
  return fallback;
}

// Primitive math, pose, model, upload, and object factory helpers.
function vec(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

function rot(x = 0, y = 0, z = 0): RigRotation {
  return { x, y, z };
}
const createId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const rad = (degree: number) => (degree * Math.PI) / 180;
const deg = (radian: number) => (radian * 180) / Math.PI;

function zeroPose(): StandardHumanRigPose {
  return {
    pelvis: rot(),
    chest: rot(),
    neck: rot(),
    head: rot(),
    leftUpperArm: rot(),
    leftLowerArm: rot(),
    rightUpperArm: rot(),
    rightLowerArm: rot(),
    leftHand: rot(),
    rightHand: rot(),
    leftUpperLeg: rot(),
    leftLowerLeg: rot(),
    rightUpperLeg: rot(),
    rightLowerLeg: rot(),
    leftFoot: rot(),
    rightFoot: rot()
  };
}

function clonePose(pose?: StandardHumanRigPose | null): StandardHumanRigPose {
  const source = pose || zeroPose();
  return POSE_KEYS.reduce((acc, key) => {
    acc[key] = { ...source[key] };
    return acc;
  }, {} as StandardHumanRigPose);
}

function patchPose(base: StandardHumanRigPose, patch: Partial<Record<PoseJointKey, Partial<RigRotation>>>) {
  const next = clonePose(base);
  for (const key of Object.keys(patch) as PoseJointKey[]) {
    next[key] = { ...next[key], ...patch[key] };
  }
  return next;
}

function offsetPose(base: StandardHumanRigPose, offsets: Partial<Record<PoseJointKey, Partial<RigRotation>>>) {
  const next = clonePose(base);
  for (const key of Object.keys(offsets) as PoseJointKey[]) {
    const offset = offsets[key];
    if (!offset) continue;
    next[key] = {
      x: next[key].x + (offset.x || 0),
      y: next[key].y + (offset.y || 0),
      z: next[key].z + (offset.z || 0)
    };
  }
  return next;
}



function naturalStandingPose() {
  const standPreset = LIBTV_POSE_PRESETS.find((item) => item.id === 'stand');
  return standPreset?.rigPose ? clonePose(standPreset.rigPose) : zeroPose();
}

function normalizeCharacterRigPose(model: any, presetId: string, pose: StandardHumanRigPose, options: { preservePresetPose?: boolean } = {}) {
  const normalizedPresetId = normalizePosePresetId(presetId);
  const preset = posePresetForId(normalizedPresetId);
  if (!options.preservePresetPose && isBuiltInCharacterModel(model) && preset) {
    return clonePose(preset.pose);
  }
  return pose;
}

function normalizeCharacterRootOffset(model: any, presetId: string, value: any, options: { preservePresetPose?: boolean } = {}) {
  const preset = posePresetForId(normalizePosePresetId(presetId));
  if (!options.preservePresetPose && isBuiltInCharacterModel(model) && preset) {
    return preset.rootOffset || vec();
  }
  return normalizeVec(value, vec());
}

function genderColor(gender: CharacterGender) {
  return gender === 'female' ? '#f472b6' : '#2563eb';
}

function genderScale(gender: CharacterGender): Vec3 {
  return gender === 'female'
    ? { x: 0.78, y: 0.92, z: 0.76 }
    : { x: 0.88, y: 0.94, z: 0.86 };
}

function genderHeight(gender: CharacterGender) {
  return gender === 'female' ? 1.34 : 1.42;
}

function normalizeCharacterModelHeight(gender: CharacterGender, model: any) {
  const rawHeight = Number(model?.normalizedHeight);
  const fallback = genderHeight(gender);
  const url = typeof model?.url === 'string' ? model.url : MODEL_URL;
  const sourceName = typeof model?.sourceName === 'string' ? model.sourceName : 'x-bot.glb';
  const isBuiltInXbot = url === MODEL_URL || sourceName.toLowerCase() === 'x-bot.glb';
  if (!Number.isFinite(rawHeight)) return fallback;
  return isBuiltInXbot ? Math.min(rawHeight, fallback) : rawHeight;
}

function isBuiltInCharacterModel(model: any) {
  const url = typeof model?.url === 'string' ? model.url : MODEL_URL;
  const sourceName = typeof model?.sourceName === 'string' ? model.sourceName : 'x-bot.glb';
  return model?.type === 'proxy' || url === MODEL_URL || sourceName.toLowerCase() === 'x-bot.glb';
}

function normalizeCharacterScale(gender: CharacterGender, value: any, model: any) {
  const next = normalizeVec(value, genderScale(gender));
  if (!isBuiltInCharacterModel(model)) return next;
  const legacyMale = gender === 'male'
    && Math.abs(next.x - 1.08) < 0.001
    && Math.abs(next.y - 1.05) < 0.001
    && Math.abs(next.z - 1.08) < 0.001;
  const legacyFemale = gender === 'female'
    && Math.abs(next.x - 0.92) < 0.001
    && Math.abs(next.y - 0.98) < 0.001
    && Math.abs(next.z - 0.9) < 0.001;
  if (legacyMale || legacyFemale) return genderScale(gender);
  const clampScale = (scale: number) => Math.min(Math.max(scale, 0.02), 20);
  return {
    x: clampScale(next.x),
    y: clampScale(next.y),
    z: clampScale(next.z)
  };
}

function normalizeCharacterModel(gender: CharacterGender, model: any): CharacterObject['model'] {
  if ((model?.type === 'glb' || model?.type === 'gltf' || model?.type === 'fbx' || model?.type === 'obj') && typeof model.url === 'string' && model.url !== MODEL_URL) {
    return {
      type: model.type,
      url: model.url,
      sourceName: typeof model.sourceName === 'string' ? model.sourceName : 'Imported model',
      normalizedHeight: normalizeCharacterModelHeight(gender, model),
      runtimeOnly: Boolean(model.runtimeOnly)
    };
  }
  return {
    type: 'glb',
    url: MODEL_URL,
    sourceName: 'x-bot.glb',
    normalizedHeight: genderHeight(gender)
  };
}

function normalizeSceneObjectDisplayName(kind: ObjectKind, name: string, index: number, meta?: { gender?: CharacterGender; propShape?: PropShape; lightType?: LightType }) {
  const trimmed = String(name || '').trim();
  const number = index + 1;
  if (kind === 'character') {
    if (/^Male Character\s+\d+$/i.test(trimmed)) return `男性角色 ${number}`;
    if (/^Female Character\s+\d+$/i.test(trimmed)) return `女性角色 ${number}`;
    if (/^Character\s+\d+$/i.test(trimmed)) return `${meta?.gender === 'female' ? '女性角色' : '男性角色'} ${number}`;
    if (/^Imported Character\s+\d+$/i.test(trimmed)) return `导入角色 ${number}`;
  }
  if (kind === 'prop') {
    if (/^Prop\s+\d+$/i.test(trimmed)) return `${PROP_LABELS_BY_SHAPE[meta?.propShape || 'box'] || '道具'} ${number}`;
    if (/^Imported Prop\s+\d+$/i.test(trimmed)) return `导入道具 ${number}`;
  }
  if (kind === 'camera') {
    if (/^Default Camera$/i.test(trimmed) || /^Camera\s+\d+$/i.test(trimmed)) return number === 1 ? '默认机位' : `机位 ${number}`;
  }
  if (kind === 'light') {
    if (/^Ambient Light$/i.test(trimmed)) return `环境光 ${number}`;
    if (/^Key Directional Light$/i.test(trimmed)) return `主方向光 ${number}`;
    if (/^Light\s+\d+$/i.test(trimmed)) return `${LIGHT_LABELS_BY_TYPE[meta?.lightType || 'point'] || '灯光'} ${number}`;
  }
  return trimmed;
}

function importedModelFormatFromFileName(fileName: string): ImportedModelFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'glb' || ext === 'gltf' || ext === 'fbx' || ext === 'obj' ? ext : null;
}

function importedModelFromFile(file: File): ImportedSceneModel | null {
  const format = importedModelFormatFromFileName(file.name);
  if (!format) return null;
  return {
    url: URL.createObjectURL(file),
    fileName: file.name,
    format,
    importedAt: new Date().toISOString(),
    runtimeOnly: true
  };
}

async function uploadImportedModelFile(file: File): Promise<ImportedSceneModel | null> {
  const format = importedModelFormatFromFileName(file.name);
  if (!format) return null;
  const form = new FormData();
  form.append('file', file);
  form.append('key', 'scene3d-model');
  const response = await fetch('/api/media/upload', { method: 'POST', body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success || !body?.url) {
    throw new Error(body?.error || 'Model upload failed');
  }
  return {
    url: String(body.url),
    fileName: String(body.originalName || file.name),
    format,
    importedAt: new Date().toISOString(),
    runtimeOnly: false
  };
}

function normalizeImportedSceneModel(model: any): ImportedSceneModel | undefined {
  const format = importedModelFormatFromFileName(model?.fileName || '') || model?.format;
  if (!model || typeof model.url !== 'string' || model.url.startsWith('data:') || !(format === 'glb' || format === 'gltf' || format === 'fbx' || format === 'obj')) return undefined;
  return {
    url: model.url,
    fileName: typeof model.fileName === 'string' ? model.fileName : `custom-model.${format}`,
    format,
    importedAt: typeof model.importedAt === 'string' ? model.importedAt : new Date().toISOString(),
    runtimeOnly: Boolean(model.runtimeOnly)
  };
}

function isPoseReferenceView(value: any): value is PoseReferenceView {
  return value === 'front' || value === 'side' || value === 'back';
}

function normalizePoseReferenceImage(view: PoseReferenceView, image: any): PoseReferenceImage | undefined {
  if (!image || typeof image.url !== 'string' || !image.url || image.url.startsWith('data:')) return undefined;
  return {
    id: typeof image.id === 'string' ? image.id : createId('pose-ref'),
    view,
    url: image.url,
    assetId: typeof image.assetId === 'string' ? image.assetId : undefined,
    fileName: typeof image.fileName === 'string' && image.fileName.trim() ? image.fileName : `${view}-pose-reference`,
    mimeType: typeof image.mimeType === 'string' ? image.mimeType : undefined,
    uploadedAt: typeof image.uploadedAt === 'string' ? image.uploadedAt : new Date().toISOString()
  };
}

function normalizePoseReferenceImages(value: any): CharacterObject['poseReferenceImages'] {
  const result: Partial<Record<PoseReferenceView, PoseReferenceImage>> = {};
  if (!value || typeof value !== 'object') return result;
  (['front', 'side', 'back'] as const).forEach((view) => {
    const image = normalizePoseReferenceImage(view, value[view]);
    if (image) result[view] = image;
  });
  return result;
}

function normalizePoseReferenceSolveHistoryItem(value: any): PoseReferenceSolveHistoryItem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rigPose = normalizePose(value.rigPose);
  const appliedViews = Array.isArray(value.appliedViews)
    ? value.appliedViews.filter(isPoseReferenceView).slice(0, 3)
    : [];
  if (!appliedViews.length) return undefined;
  const imageRefs = Array.isArray(value.imageRefs)
    ? value.imageRefs
        .map((item: any) => ({
          view: isPoseReferenceView(item?.view) ? item.view : undefined,
          assetId: typeof item?.assetId === 'string' ? item.assetId : undefined,
          fileName: typeof item?.fileName === 'string' && item.fileName.trim() ? item.fileName : 'pose-reference'
        }))
        .filter((item: any): item is PoseReferenceSolveHistoryItem['imageRefs'][number] => Boolean(item.view))
        .slice(0, 3)
    : [];
  return {
    id: typeof value.id === 'string' ? value.id : createId('pose-solve'),
    solvedAt: typeof value.solvedAt === 'string' ? value.solvedAt : new Date().toISOString(),
    version: 1,
    summary: typeof value.summary === 'string' && value.summary.trim() ? value.summary : 'Pose reference parsed',
    rigPose,
    bonePose: normalizeBonePose(value.bonePose),
    rootOffset: value.rootOffset ? normalizeVec(value.rootOffset, vec()) : undefined,
    foundationHint: normalizePoseFoundationHint(value.foundationHint),
    poseLandmarks: normalizePoseReferenceLandmarks(value.poseLandmarks),
    compiledFromLandmarks: Boolean(value.compiledFromLandmarks),
    confidence: Number.isFinite(Number(value.confidence)) ? clampNumber(Number(value.confidence), 0, 1) : 0,
    warnings: Array.isArray(value.warnings) ? value.warnings.map((item: any) => String(item)).filter(Boolean).slice(0, 24) : [],
    appliedViews,
    imageRefs
  };
}

function normalizePoseReferenceSolveHistory(value: any): PoseReferenceSolveHistoryItem[] {
  return Array.isArray(value)
    ? value.map(normalizePoseReferenceSolveHistoryItem).filter((item): item is PoseReferenceSolveHistoryItem => Boolean(item)).slice(0, 8)
    : [];
}

function createPoseReferenceSolveHistoryItem(result: PoseReferenceSolveResult, images?: CharacterObject['poseReferenceImages']): PoseReferenceSolveHistoryItem {
  return {
    ...result,
    id: createId('pose-solve'),
    solvedAt: new Date().toISOString(),
    bonePose: cloneBonePose(result.bonePose),
    rootOffset: result.rootOffset ? vec(result.rootOffset.x, result.rootOffset.y, result.rootOffset.z) : undefined,
    rigPose: clonePose(result.rigPose),
    imageRefs: POSE_REFERENCE_VIEW_OPTIONS
      .map((item) => images?.[item.id])
      .filter((image): image is PoseReferenceImage => Boolean(image?.assetId))
      .map((image) => ({
        view: image.view,
        assetId: image.assetId,
        fileName: image.fileName
      }))
  };
}

async function uploadPoseReferenceImageFile(view: PoseReferenceView, file: File): Promise<PoseReferenceImage> {
  if (!POSE_REFERENCE_IMAGE_ACCEPT.split(',').includes(file.type)) {
    throw new Error('Only JPG, PNG or WEBP pose reference images are supported');
  }
  if (file.size > MAX_POSE_REFERENCE_IMAGE_BYTES) {
    throw new Error('姿势参考图不能超过 12MB');
  }
  const form = new FormData();
  form.append('file', file);
  form.append('key', 'scene3d-pose-reference');
  const response = await fetch('/api/media/upload', { method: 'POST', body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success || !body?.url) {
    throw new Error(body?.error || 'Pose reference image upload failed');
  }
  return {
    id: createId('pose-ref'),
    view,
    url: String(body.url),
    assetId: body.assetId ? String(body.assetId) : undefined,
    fileName: String(body.originalName || file.name),
    mimeType: String(body.mimeType || file.type || ''),
    uploadedAt: new Date().toISOString()
  };
}

function defaultCharacter(gender: CharacterGender, index: number): CharacterObject {
  const standPresetState = resolvePosePresetState('stand');
  return {
    id: createId('char'),
    name: `${gender === 'female' ? 'Female Character' : 'Male Character'} ${index}`,
    gender,
    visible: true,
    locked: false,
    position: vec(index % 2 === 0 ? 0.8 : -0.8, 0, 0),
    rotation: vec(0, 0, 0),
    scale: genderScale(gender),
    color: genderColor(gender),
    posePreset: 'stand',
    posePresetId: 'stand',
    poseRootOffset: standPresetState.rootOffset,
    rigPose: clonePose(standPresetState.rigPose),
    bonePose: cloneBonePose(standPresetState.bonePose),
    fingerPose: cloneFingerPose(standPresetState.fingerPose),
    toePose: cloneToePose(standPresetState.toePose),
    libTvJointAngles: cloneLibTvJointAngles(standPresetState.libTvJointAngles),
    model: {
      type: 'glb',
      url: MODEL_URL,
      sourceName: 'x-bot.glb',
      normalizedHeight: genderHeight(gender)
    }
  };
}

function defaultCamera(): CameraObject {
  return {
    id: createId('cam'),
    name: '\u9ed8\u8ba4\u673a\u4f4d',
    visible: true,
    locked: false,
    position: vec(4, 2.1, 5),
    rotation: vec(0, 0, 0),
    scale: vec(1, 1, 1),
    targetPosition: vec(0, 1, 0),
    fov: 45,
    lensType: 'standard',
    fisheyeStrength: 0.45,
    focusDistance: 1.2,
    tiltShiftAmount: 0,
    orthographicScale: 4.5,
    captures: []
  };
}

const CAMERA_LENS_OPTIONS: Array<{
  id: CameraLensType;
  label: string;
  defaultFov: number;
  zoom: number;
  orthographic?: boolean;
  defaultFisheyeStrength?: number;
  defaultFocusDistance?: number;
  defaultTiltShiftAmount?: number;
  defaultOrthographicScale?: number;
}> = [
  { id: 'standard', label: '\u6807\u51c6\u955c\u5934', defaultFov: 45, zoom: 1 },
  { id: 'wide', label: '\u5e7f\u89d2\u955c\u5934', defaultFov: 72, zoom: 0.92 },
  { id: 'telephoto', label: '\u957f\u7126\u955c\u5934', defaultFov: 24, zoom: 1.28 },
  { id: 'fisheye', label: '\u9c7c\u773c\u955c\u5934', defaultFov: 112, zoom: 0.82, defaultFisheyeStrength: 0.55 },
  { id: 'orthographic', label: '\u6b63\u4ea4\u955c\u5934', defaultFov: 45, zoom: 1.65, orthographic: true, defaultOrthographicScale: 4.5 },
  { id: 'macro', label: '\u5fae\u8ddd\u955c\u5934', defaultFov: 38, zoom: 1.35, defaultFocusDistance: 0.55 },
  { id: 'tilt_shift', label: '\u79fb\u8f74\u955c\u5934', defaultFov: 42, zoom: 1.1, defaultTiltShiftAmount: 0.22 },
  { id: 'panorama', label: '\u5168\u666f\u955c\u5934', defaultFov: 95, zoom: 0.76 }
];
const CAMERA_LENS_LABELS = Object.fromEntries(CAMERA_LENS_OPTIONS.map((item) => [item.id, item.label])) as Record<CameraLensType, string>;
const CAMERA_LENS_BY_ID = Object.fromEntries(CAMERA_LENS_OPTIONS.map((item) => [item.id, item])) as Record<CameraLensType, (typeof CAMERA_LENS_OPTIONS)[number]>;

function normalizeCameraLensType(value: any): CameraLensType {
  return CAMERA_LENS_OPTIONS.some((item) => item.id === value) ? value : 'standard';
}

function cameraLensPatch(lensType: CameraLensType) {
  const lens = CAMERA_LENS_BY_ID[lensType] || CAMERA_LENS_BY_ID.standard;
  return {
    lensType,
    fov: lens.defaultFov,
    fisheyeStrength: lens.defaultFisheyeStrength ?? 0.45,
    focusDistance: lens.defaultFocusDistance ?? 1.2,
    tiltShiftAmount: lens.defaultTiltShiftAmount ?? 0,
    orthographicScale: lens.defaultOrthographicScale ?? 4.5
  };
}

const CHARACTER_ADD_OPTIONS: { id: CharacterGender; label: string }[] = [
  { id: 'male', label: '\u7537\u6027\u89d2\u8272' },
  { id: 'female', label: '\u5973\u6027\u89d2\u8272' }
];
const PROP_ADD_OPTIONS: { id: PropShape; label: string; scale: Vec3; color: string }[] = [
  { id: 'box', label: '\u65b9\u4f53', scale: vec(0.7, 0.7, 0.7), color: '#f59e0b' },
  { id: 'sphere', label: '\u7403\u4f53', scale: vec(0.65, 0.65, 0.65), color: '#38bdf8' },
  { id: 'cylinder', label: '\u5706\u67f1', scale: vec(0.5, 0.9, 0.5), color: '#e5e7eb' }
];
const EXTRA_PROP_ADD_OPTIONS: { id: PropShape; label: string; scale: Vec3; color: string }[] = [
  { id: 'cone', label: '\u5706\u9525', scale: vec(0.62, 0.9, 0.62), color: '#fb7185' },
  { id: 'plane', label: '\u5e73\u9762', scale: vec(1.2, 1, 0.8), color: '#94a3b8' },
  { id: 'torus', label: '\u5706\u73af', scale: vec(0.8, 0.8, 0.8), color: '#a78bfa' }
];
const PROP_CREATION_OPTIONS = [...PROP_ADD_OPTIONS, ...EXTRA_PROP_ADD_OPTIONS];
const PROP_LABELS_BY_SHAPE = Object.fromEntries(PROP_CREATION_OPTIONS.map((item) => [item.id, item.label])) as Record<PropShape, string>;
const PROP_SORT_ORDER = Object.fromEntries(PROP_CREATION_OPTIONS.map((item, index) => [item.id, index])) as Record<PropShape, number>;

const LIGHT_ADD_OPTIONS: { id: LightType; label: string; position: Vec3; color: string; intensity: number }[] = [
  { id: 'ambient', label: '\u73af\u5883\u5149', position: vec(0, 3, 0), color: '#dbeafe', intensity: 0.55 },
  { id: 'hemisphere', label: '\u534a\u7403\u5149', position: vec(0, 4, 0), color: '#bfdbfe', intensity: 0.9 },
  { id: 'directional', label: '\u65b9\u5411\u5149', position: vec(4, 6, 3), color: '#fff7ed', intensity: 2.1 },
  { id: 'spot', label: '\u805a\u5149\u706f', position: vec(2, 4, 2.4), color: '#fef3c7', intensity: 2.4 },
  { id: 'point', label: '\u70b9\u5149', position: vec(2, 3, 2), color: '#ffffff', intensity: 1.2 },
  { id: 'rect', label: '\u9762\u5149', position: vec(0, 2.8, 3), color: '#f8fafc', intensity: 1.8 }
];
const LIGHT_LABELS_BY_TYPE = Object.fromEntries(LIGHT_ADD_OPTIONS.map((item) => [item.id, item.label])) as Record<LightType, string>;
const LIGHT_SORT_ORDER = Object.fromEntries(LIGHT_ADD_OPTIONS.map((item, index) => [item.id, index])) as Record<LightType, number>;

const CAMERA_TEMPLATE_OPTIONS: { id: CameraTemplateId; label: string; position: Vec3; targetPosition: Vec3; fov: number }[] = [
  { id: 'current', label: '\u9ed8\u8ba4\u673a\u4f4d', position: vec(4, 2.1, 5), targetPosition: vec(0, 1, 0), fov: 45 },
  { id: 'front_medium', label: '\u6b63\u9762\u4e2d\u666f', position: vec(0, 1.65, 5.2), targetPosition: vec(0, 1.2, 0), fov: 42 },
  { id: 'front_wait', label: '\u6b63\u9762\u5f85\u673a', position: vec(0.7, 1.55, 4.4), targetPosition: vec(0, 1.1, 0), fov: 36 },
  { id: 'front_full', label: '\u6b63\u9762\u5168\u8eab', position: vec(0, 1.85, 7.2), targetPosition: vec(0, 1, 0), fov: 52 },
  { id: 'side_follow', label: '\u4fa7\u9762\u8ddf\u62cd', position: vec(5.2, 1.45, 0.2), targetPosition: vec(0, 1.15, 0), fov: 42 },
  { id: 'side_close', label: '\u4fa7\u9762\u8fd1\u666f', position: vec(3.2, 1.45, 0.2), targetPosition: vec(0, 1.2, 0), fov: 30 },
  { id: 'back_medium', label: '\u80cc\u9762\u4e2d\u666f', position: vec(0, 1.6, -5.2), targetPosition: vec(0, 1.15, 0), fov: 42 },
  { id: 'overhead_full', label: '\u4fef\u62cd\u5168\u8eab', position: vec(0, 6.2, 3.2), targetPosition: vec(0, 0.8, 0), fov: 55 },
  { id: 'dutch_45', label: '\u659c\u89d2\u56db\u5341\u4e94\u5ea6', position: vec(3.5, 4.1, 3.5), targetPosition: vec(0, 0.9, 0), fov: 42 },
  { id: 'low_angle_close', label: '\u4f4e\u673a\u4f4d\u8fd1\u666f', position: vec(0, 0.45, 3.2), targetPosition: vec(0, 1.45, 0), fov: 34 },
  { id: 'low_angle_wide', label: '\u4f4e\u673a\u4f4d\u5e7f\u89d2', position: vec(0, 0.55, 3.8), targetPosition: vec(0, 1.25, 0), fov: 68 },
  { id: 'over_shoulder', label: '\u5de6\u8fc7\u80a9', position: vec(-1.2, 1.55, 2.4), targetPosition: vec(0.55, 1.25, 0), fov: 34 },
  { id: 'over_shoulder_right', label: '\u53f3\u8fc7\u80a9', position: vec(1.2, 1.55, 2.4), targetPosition: vec(-0.55, 1.25, 0), fov: 34 },
  { id: 'bird_eye', label: '\u9876\u89c6\u673a\u4f4d', position: vec(0, 8, 0.15), targetPosition: vec(0, 0.7, 0), fov: 48 },
  { id: 'dutch_angle', label: '\u503e\u659c\u673a\u4f4d', position: vec(3.1, 1.8, 4.4), targetPosition: vec(0, 1.1, 0), fov: 38 }
];
function defaultConstraints(): PoseTransitionConstraints {
  return {
    headLookAt: { enabled: false, targetMode: 'camera' },
    handTarget: { enabled: false, hand: 'right', targetMode: 'object' },
    footLock: { enabled: true, left: true, right: true },
    jointLimitsEnabled: true
  };
}

// Scene normalization, compatibility migration, and history state.
function defaultScene(): Scene3DState {
  const camera = defaultCamera();
  return {
    version: 15,
    background: { type: 'color', color: '#080b12' },
    objects: {
      characters: [
        defaultCharacter('male', 1),
        defaultCharacter('female', 2)
      ],
      props: [
        {
          id: createId('prop'),
          name: '方体 1',
          visible: true,
          locked: false,
          shape: 'box',
          position: vec(1.6, 0, 0.4),
          rotation: vec(0, 18, 0),
          scale: vec(0.75, 0.85, 0.75),
          color: '#a16207'
        }
      ],
      cameras: [camera],
      lights: [
        {
          id: createId('light'),
          name: '环境光 1',
          visible: true,
          locked: false,
          lightType: 'ambient',
          position: vec(0, 3, 0),
          rotation: vec(),
          scale: vec(1, 1, 1),
          color: '#dbeafe',
          intensity: 0.55
        },
        {
          id: createId('light'),
          name: '主光 2',
          visible: true,
          locked: false,
          lightType: 'directional',
          position: vec(4, 6, 3),
          rotation: vec(),
          scale: vec(1, 1, 1),
          color: '#fff7ed',
          intensity: 2.1
        }
      ]
    },
    selectedObjectId: camera.id,
    activeViewMode: 'director',
    activeCameraId: camera.id,
    transformMode: 'translate',
    aspectRatio: '16:9',
    gridSnapEnabled: false,
    groundGridEnabled: true,
    groundEnabled: true,
    motionPathEnabled: false,
    characterLabelsEnabled: true,
    compositionGuideEnabled: false,
    sceneZoomPercent: 100,
    captures: [],
    poseTransitions: [],
    jointAxisProfile: defaultJointAxisProfile(),
    activeTransitionId: undefined,
    undoStack: [],
    redoStack: []
  };
}

function normalizeVec(value: any, fallback: Vec3): Vec3 {
  if (!value || typeof value !== 'object') return fallback;
  return {
    x: Number.isFinite(Number(value.x)) ? Number(value.x) : fallback.x,
    y: Number.isFinite(Number(value.y)) ? Number(value.y) : fallback.y,
    z: Number.isFinite(Number(value.z)) ? Number(value.z) : fallback.z
  };
}

function normalizeRotation(value: any, fallback: RigRotation): RigRotation {
  if (!value || typeof value !== 'object') return fallback;
  return {
    x: Number.isFinite(Number(value.x)) ? Number(value.x) : fallback.x,
    y: Number.isFinite(Number(value.y)) ? Number(value.y) : fallback.y,
    z: Number.isFinite(Number(value.z)) ? Number(value.z) : fallback.z
  };
}

function normalizePose(value: any): StandardHumanRigPose {
  const fallback = zeroPose();
  if (!value || typeof value !== 'object') return fallback;
  return POSE_KEYS.reduce((acc, key) => {
    acc[key] = normalizeRotation(value[key], fallback[key]);
    return acc;
  }, {} as StandardHumanRigPose);
}

function normalizeTransform(value: any, fallback?: PoseTransform): PoseTransform {
  return {
    position: normalizeVec(value?.position, fallback?.position || vec()),
    rotation: normalizeVec(value?.rotation, fallback?.rotation || vec()),
    scale: normalizeVec(value?.scale, fallback?.scale || vec(1, 1, 1))
  };
}

function normalizeConstraints(value: any): PoseTransitionConstraints {
  const fallback = defaultConstraints();
  return {
    headLookAt: {
      enabled: Boolean(value?.headLookAt?.enabled),
      targetMode: value?.headLookAt?.targetMode === 'object' || value?.headLookAt?.targetMode === 'point' ? value.headLookAt.targetMode : 'camera',
      targetObjectId: typeof value?.headLookAt?.targetObjectId === 'string' ? value.headLookAt.targetObjectId : undefined,
      targetPosition: value?.headLookAt?.targetPosition ? normalizeVec(value.headLookAt.targetPosition, vec()) : undefined
    },
    handTarget: {
      enabled: Boolean(value?.handTarget?.enabled),
      hand: value?.handTarget?.hand === 'left' ? 'left' : 'right',
      targetMode: value?.handTarget?.targetMode === 'point' ? 'point' : 'object',
      targetObjectId: typeof value?.handTarget?.targetObjectId === 'string' ? value.handTarget.targetObjectId : undefined,
      targetPosition: value?.handTarget?.targetPosition ? normalizeVec(value.handTarget.targetPosition, vec()) : undefined
    },
    footLock: {
      enabled: value?.footLock?.enabled !== false,
      left: value?.footLock?.left !== false,
      right: value?.footLock?.right !== false
    },
    jointLimitsEnabled: value?.jointLimitsEnabled !== false
  };
}

function normalizeTrack(track: any): SerializedAnimationTrack | null {
  if (!track || typeof track !== 'object') return null;
  if (typeof track.name !== 'string' || !Array.isArray(track.times) || !Array.isArray(track.values)) return null;
  return {
    name: track.name,
    kind: track.kind === 'vector' ? 'vector' : 'quaternion',
    times: track.times.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value)),
    values: track.values.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value))
  };
}

function normalizeContactFrame(value: any): AnimationContactFrame | null {
  if (!value || typeof value !== 'object') return null;
  const kind = ['reach', 'grasp', 'release', 'foot_lock'].includes(value.kind) ? value.kind : null;
  const limb = ['head', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot'].includes(value.limb) ? value.limb : null;
  if (!kind || !limb) return null;
  return {
    timeSec: Number.isFinite(Number(value.timeSec)) ? Number(value.timeSec) : 0,
    kind,
    targetObjectId: typeof value.targetObjectId === 'string' ? value.targetObjectId : undefined,
    limb,
    position: normalizeVec(value.position, vec()),
    note: typeof value.note === 'string' ? value.note : ''
  };
}

function normalizeAnimationClip(value: any): SerializedAnimationClip | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const tracks = Array.isArray(value.tracks) ? value.tracks.map(normalizeTrack).filter(Boolean) as SerializedAnimationTrack[] : [];
  const samples = Array.isArray(value.samples)
    ? value.samples.map((sample: any): AnimationClipSample => ({
        timeSec: Number.isFinite(Number(sample?.timeSec)) ? Number(sample.timeSec) : 0,
        transform: normalizeTransform(sample?.transform),
        pose: normalizePose(sample?.pose),
        bonePose: normalizeBonePose(sample?.bonePose),
        fingerPose: normalizeFingerPose(sample?.fingerPose),
        toePose: normalizeToePose(sample?.toePose),
        libTvJointAngles: normalizeLibTvJointAngles(sample?.libTvJointAngles)
      }))
    : [];
  if (!tracks.length || !samples.length) return undefined;
  return {
    name: typeof value.name === 'string' ? value.name : 'Pose Transition',
    durationSec: Number.isFinite(Number(value.durationSec)) ? Number(value.durationSec) : samples[samples.length - 1]?.timeSec || 0,
    sampleRate: Number.isFinite(Number(value.sampleRate)) ? Number(value.sampleRate) : 24,
    rigProfile: value.rigProfile && typeof value.rigProfile === 'object'
      ? {
          rigId: value.rigProfile.rigId === 'mixamo-xbot' ? 'mixamo-xbot' : 'mixamo-xbot',
          version: 1,
          rotationOrder: value.rigProfile.rotationOrder === 'XYZ' ? 'XYZ' : 'XYZ',
          applicationMode: value.rigProfile.applicationMode === 'rest_quaternion_multiply_delta' ? 'rest_quaternion_multiply_delta' : 'rest_quaternion_multiply_delta'
        }
      : undefined,
    tracks,
    samples,
    contacts: Array.isArray(value.contacts)
      ? value.contacts.map(normalizeContactFrame).filter(Boolean) as AnimationContactFrame[]
      : []
  };
}

function normalizeActionPlan(value: any): PoseTransitionActionPlan {
  return {
    mode: value?.mode === 'motion_intent' || value?.mode === 'template_assist' || value?.mode === 'universal' ? value.mode : undefined,
    universal: value?.universal && typeof value.universal === 'object'
      ? {
          families: normalizeMotionFamilies(value.universal.families),
          direction: normalizeVec(value.universal.direction, vec()),
          stride: Number.isFinite(Number(value.universal.stride)) ? Math.max(0, Math.min(1.5, Number(value.universal.stride))) : 0,
          turn: Number.isFinite(Number(value.universal.turn)) ? Math.max(-180, Math.min(180, Number(value.universal.turn))) : 0,
          armSwing: Number.isFinite(Number(value.universal.armSwing)) ? Math.max(0, Math.min(1, Number(value.universal.armSwing))) : 0,
          bodyLean: Number.isFinite(Number(value.universal.bodyLean)) ? Math.max(-1, Math.min(1, Number(value.universal.bodyLean))) : 0,
          verticalLift: Number.isFinite(Number(value.universal.verticalLift)) ? Math.max(0, Math.min(0.6, Number(value.universal.verticalLift))) : 0,
          crouch: Number.isFinite(Number(value.universal.crouch)) ? Math.max(0, Math.min(1, Number(value.universal.crouch))) : 0,
          roll: Number.isFinite(Number(value.universal.roll)) ? Math.max(0, Math.min(1, Number(value.universal.roll))) : 0,
          rhythm: value.universal.rhythm === 'walk' || value.universal.rhythm === 'run' || value.universal.rhythm === 'perform' || value.universal.rhythm === 'impact' ? value.universal.rhythm : 'subtle',
          contacts: normalizeMotionContacts(value.universal.contacts),
          lookAt: normalizeMotionLookAt(value.universal.lookAt),
          targetObjectId: typeof value.universal.targetObjectId === 'string' ? value.universal.targetObjectId : undefined
        }
      : undefined,
    templates: Array.isArray(value?.templates)
      ? value.templates
          .map((template: any) => ({
            id: isTemplateId(template?.id) ? template.id : null,
            label: typeof template?.label === 'string' ? template.label : '',
            hand: template?.hand === 'left' ? 'left' : template?.hand === 'right' ? 'right' : undefined,
            targetObjectId: typeof template?.targetObjectId === 'string' ? template.targetObjectId : undefined,
            strength: Number.isFinite(Number(template?.strength)) ? Number(template.strength) : 1
          }))
          .filter((template: any): template is PoseTransitionTemplate => Boolean(template.id))
      : [],
    notes: Array.isArray(value?.notes) ? value.notes.map((note: any) => String(note)) : []
  };
}

function normalizeMotionLookAt(value: any): MotionIntent['lookAt'] {
  return value === 'camera' || value === 'object' || value === 'point' ? value : 'none';
}

function normalizeMotionContacts(value: any): MotionContactHint[] {
  const allowed: MotionContactHint[] = ['leftFoot', 'rightFoot', 'leftHand', 'rightHand', 'head', 'shoulder', 'hip', 'feet', 'hands'];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MotionContactHint => allowed.includes(item)).slice(0, 12);
}

function normalizeMotionFamilies(value: any): UniversalMotionFamily[] {
  const allowed: UniversalMotionFamily[] = ['locomotion', 'turn', 'roll', 'fall', 'get_up', 'dodge', 'crawl', 'kneel', 'stumble', 'reach', 'carry'];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UniversalMotionFamily => allowed.includes(item)).slice(0, 12);
}

function normalizeMotionIntent(value: any, durationFallback = 1.2): MotionIntent | undefined {
  if (!value || typeof value !== 'object' || value.version !== 1) return undefined;
  const durationSec = Number.isFinite(Number(value.durationSec)) ? Math.max(0.5, Number(value.durationSec)) : durationFallback;
  const clamp01 = (raw: any) => Number.isFinite(Number(raw)) ? Math.max(0, Math.min(1, Number(raw))) : 0;
  const rhythm: MotionIntent['rhythm'] = value.rhythm === 'slow' || value.rhythm === 'fast' || value.rhythm === 'impact' || value.rhythm === 'perform'
    ? value.rhythm
    : 'normal';
  return {
    version: 1,
    intent: typeof value.intent === 'string' ? value.intent : '',
    durationSec,
    generatedMotionPrompt: typeof value.generatedMotionPrompt === 'string' ? value.generatedMotionPrompt : '',
    direction: normalizedDirection(normalizeVec(value.direction, vec())),
    distance: Number.isFinite(Number(value.distance)) ? Math.max(0, Math.min(5, Number(value.distance))) : 0,
    turnDeg: Number.isFinite(Number(value.turnDeg)) ? Math.max(-360, Math.min(360, Number(value.turnDeg))) : 0,
    roll: clamp01(value.roll),
    crouch: clamp01(value.crouch),
    verticalLift: Number.isFinite(Number(value.verticalLift)) ? Math.max(0, Math.min(2, Number(value.verticalLift))) : 0,
    bodyLean: normalizeVec(value.bodyLean, vec()),
    armSwing: clamp01(value.armSwing),
    rhythm,
    contacts: normalizeMotionContacts(value.contacts),
    lookAt: normalizeMotionLookAt(value.lookAt),
    targetObjectId: typeof value.targetObjectId === 'string' ? value.targetObjectId : undefined,
    warnings: Array.isArray(value.warnings) ? value.warnings.map((item: any) => String(item)).slice(0, 24) : [],
    confidence: Number.isFinite(Number(value.confidence)) ? Math.min(1, Math.max(0, Number(value.confidence))) : 0
  };
}

function normalizeMotionRefineHistory(value: any, durationFallback: number): MotionRefineHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-20).map((entry: any) => ({
    id: typeof entry?.id === 'string' ? entry.id : createId('motion_refine'),
    transitionId: typeof entry?.transitionId === 'string' ? entry.transitionId : '',
    requestedAt: typeof entry?.requestedAt === 'string' ? entry.requestedAt : new Date().toISOString(),
    appliedAt: typeof entry?.appliedAt === 'string' ? entry.appliedAt : undefined,
    mode: entry?.mode === 'resolve' ? 'resolve' : 'generate',
    requestSummary: {
      actionPrompt: typeof entry?.requestSummary?.actionPrompt === 'string' ? entry.requestSummary.actionPrompt : '',
      durationSec: Number.isFinite(Number(entry?.requestSummary?.durationSec)) ? Number(entry.requestSummary.durationSec) : durationFallback,
      selectedCharacterId: typeof entry?.requestSummary?.selectedCharacterId === 'string' ? entry.requestSummary.selectedCharacterId : '',
      usedReferenceAssetId: typeof entry?.requestSummary?.usedReferenceAssetId === 'string' ? entry.requestSummary.usedReferenceAssetId : undefined
    },
    motionIntent: normalizeMotionIntent(entry?.motionIntent, durationFallback),
    error: typeof entry?.error === 'string' ? entry.error : undefined
  }));
}

function normalizeRegenerateLockScope(value: any): MotionRegenerateLockScope {
  return value === 'rootPosition'
    || value === 'rootRotation'
    || value === 'upperBody'
    || value === 'lowerBody'
    || value === 'contacts'
    ? value
    : 'none';
}

function normalizeMotionQualityReport(value: any): MotionQualityReport | undefined {
  if (!value || typeof value !== 'object' || value.version !== 1) return undefined;
  const issues = Array.isArray(value.issues)
    ? value.issues.slice(0, 32).map((issue: any): MotionQualityIssue => ({
        id: typeof issue?.id === 'string' ? issue.id : createId('quality'),
        severity: issue?.severity === 'error' || issue?.severity === 'warning' ? issue.severity : 'info',
        metric: ['endpoint', 'speed', 'rotation', 'foot_lock', 'contact', 'pose'].includes(issue?.metric) ? issue.metric : 'pose',
        message: typeof issue?.message === 'string' ? issue.message : '',
        timeSec: Number.isFinite(Number(issue?.timeSec)) ? Number(issue.timeSec) : undefined,
        value: Number.isFinite(Number(issue?.value)) ? Number(issue.value) : undefined
      })).filter((issue: MotionQualityIssue) => issue.message)
    : [];
  const metrics = value.metrics || {};
  return {
    version: 1,
    checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : new Date().toISOString(),
    score: Number.isFinite(Number(value.score)) ? Math.max(0, Math.min(100, Number(value.score))) : 0,
    issues,
    metrics: {
      maxStepDistance: Number.isFinite(Number(metrics.maxStepDistance)) ? Number(metrics.maxStepDistance) : 0,
      maxRootRotationDelta: Number.isFinite(Number(metrics.maxRootRotationDelta)) ? Number(metrics.maxRootRotationDelta) : 0,
      startPositionDrift: Number.isFinite(Number(metrics.startPositionDrift)) ? Number(metrics.startPositionDrift) : 0,
      endPositionDrift: Number.isFinite(Number(metrics.endPositionDrift)) ? Number(metrics.endPositionDrift) : 0,
      lockedFootChanges: Number.isFinite(Number(metrics.lockedFootChanges)) ? Number(metrics.lockedFootChanges) : 0,
      contactCount: Number.isFinite(Number(metrics.contactCount)) ? Number(metrics.contactCount) : 0
    }
  };
}

function normalizeTransition(value: any): PoseTransition | null {
  if (!value || typeof value !== 'object' || typeof value.characterId !== 'string') return null;
  const durationSec = Number.isFinite(Number(value.durationSec)) ? Number(value.durationSec) : 1.2;
  return {
    id: typeof value.id === 'string' ? value.id : createId('transition'),
    name: typeof value.name === 'string' ? value.name : 'Pose Transition',
    characterId: value.characterId,
    actionPrompt: typeof value.actionPrompt === 'string' ? value.actionPrompt : '',
    actionPlan: normalizeActionPlan(value.actionPlan),
    aiActionIntent: typeof value.aiActionIntent === 'string' ? value.aiActionIntent : undefined,
    generatedMotionPrompt: typeof value.generatedMotionPrompt === 'string' ? value.generatedMotionPrompt : undefined,
    motionIntent: normalizeMotionIntent(value.motionIntent, durationSec),
    motionRefineHistory: normalizeMotionRefineHistory(value.motionRefineHistory, durationSec),
    regenerateLockScope: normalizeRegenerateLockScope(value.regenerateLockScope),
    qualityReport: normalizeMotionQualityReport(value.qualityReport),
    constraints: normalizeConstraints(value.constraints),
    durationSec,
    curve: value.curve === 'ease_in' || value.curve === 'ease_out' || value.curve === 'ease_in_out' ? value.curve : 'linear',
    startPose: value.startPose ? normalizePose(value.startPose) : undefined,
    endPose: value.endPose ? normalizePose(value.endPose) : undefined,
    startBonePose: normalizeBonePose(value.startBonePose),
    endBonePose: normalizeBonePose(value.endBonePose),
    startFingerPose: value.startFingerPose ? normalizeFingerPose(value.startFingerPose) : undefined,
    endFingerPose: value.endFingerPose ? normalizeFingerPose(value.endFingerPose) : undefined,
    startToePose: value.startToePose ? normalizeToePose(value.startToePose) : undefined,
    endToePose: value.endToePose ? normalizeToePose(value.endToePose) : undefined,
    startPosePresetId: typeof value.startPosePresetId === 'string' ? normalizePosePresetId(value.startPosePresetId) : undefined,
    endPosePresetId: typeof value.endPosePresetId === 'string' ? normalizePosePresetId(value.endPosePresetId) : undefined,
    startLibTvJointAngles: normalizeLibTvJointAngles(value.startLibTvJointAngles),
    endLibTvJointAngles: normalizeLibTvJointAngles(value.endLibTvJointAngles),
    startTransform: value.startTransform ? normalizeTransform(value.startTransform) : undefined,
    endTransform: value.endTransform ? normalizeTransform(value.endTransform) : undefined,
    animationClip: normalizeAnimationClip(value.animationClip),
    warnings: Array.isArray(value.warnings) ? value.warnings.map((item: any) => String(item)) : [],
    error: typeof value.error === 'string' ? value.error : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  };
}

function createHistorySnapshot(scene: Scene3DState): Scene3DHistorySnapshot {
  return JSON.parse(JSON.stringify({
    version: scene.version,
    background: scene.background,
    objects: scene.objects,
    activeCameraId: scene.activeCameraId,
    selectedObjectId: scene.selectedObjectId,
    activeViewMode: scene.activeViewMode,
    activeTransitionId: scene.activeTransitionId,
    aspectRatio: scene.aspectRatio,
    gridSnapEnabled: scene.gridSnapEnabled,
    groundGridEnabled: scene.groundGridEnabled,
    groundEnabled: scene.groundEnabled,
    motionPathEnabled: scene.motionPathEnabled,
    characterLabelsEnabled: scene.characterLabelsEnabled,
    compositionGuideEnabled: scene.compositionGuideEnabled,
    sceneZoomPercent: scene.sceneZoomPercent,
    captures: scene.captures,
    poseTransitions: scene.poseTransitions,
    jointAxisProfile: scene.jointAxisProfile
  })) as Scene3DHistorySnapshot;
}

function normalizeHistorySnapshot(value: any, fallback: Scene3DState): Scene3DHistorySnapshot {
  const base = normalizeScene({
    ...fallback,
    ...value,
    undoStack: [],
    redoStack: []
  });
  return createHistorySnapshot(base);
}

function normalizeHistoryEntry(value: any, fallback: Scene3DState): Scene3DHistoryEntry | null {
  if (!value || typeof value !== 'object' || !value.before || !value.after) return null;
  return {
    id: typeof value.id === 'string' ? value.id : createId('history'),
    label: typeof value.label === 'string' && value.label.trim() ? value.label : 'Edit Scene',
    before: normalizeHistorySnapshot(value.before, fallback),
    after: normalizeHistorySnapshot(value.after, fallback),
    mergeKey: typeof value.mergeKey === 'string' ? value.mergeKey : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
  };
}

function normalizeHistoryStack(value: any, fallback: Scene3DState): Scene3DHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeHistoryEntry(entry, fallback))
    .filter(Boolean)
    .slice(-MAX_SCENE_HISTORY) as Scene3DHistoryEntry[];
}

function normalizeScene(value: any): Scene3DState {
  const fallback = defaultScene();
  if (!value || typeof value !== 'object') return fallback;
  const cameras = Array.isArray(value.objects?.cameras) && value.objects.cameras.length
    ? value.objects.cameras.map((camera: any, index: number): CameraObject => ({
        ...defaultCamera(),
        id: typeof camera.id === 'string' ? camera.id : createId('cam'),
        name: normalizeSceneObjectDisplayName('camera', typeof camera.name === 'string' ? camera.name : '', index),
        visible: camera.visible !== false,
        locked: Boolean(camera.locked),
        position: normalizeVec(camera.position, vec(4, 2.1, 5)),
        rotation: normalizeVec(camera.rotation, vec()),
        scale: normalizeVec(camera.scale, vec(1, 1, 1)),
        targetPosition: normalizeVec(camera.targetPosition, vec(0, 1, 0)),
        fov: Number.isFinite(Number(camera.fov)) ? Number(camera.fov) : 45,
        lensType: normalizeCameraLensType(camera.lensType),
        fisheyeStrength: Number.isFinite(Number(camera.fisheyeStrength)) ? clampNumber(Number(camera.fisheyeStrength), 0, 1) : 0.45,
        focusDistance: Number.isFinite(Number(camera.focusDistance)) ? clampNumber(Number(camera.focusDistance), 0.05, 20) : 1.2,
        tiltShiftAmount: Number.isFinite(Number(camera.tiltShiftAmount)) ? clampNumber(Number(camera.tiltShiftAmount), -1, 1) : 0,
        orthographicScale: Number.isFinite(Number(camera.orthographicScale)) ? clampNumber(Number(camera.orthographicScale), 1, 18) : 4.5,
        captures: Array.isArray(camera.captures) ? camera.captures : []
      }))
    : fallback.objects.cameras;
  const activeCameraId = typeof value.activeCameraId === 'string' ? value.activeCameraId : cameras[0]?.id;
  const scene: Scene3DState = {
    ...fallback,
    ...value,
    background: {
      type: 'color',
      color: typeof value.background?.color === 'string' ? value.background.color : fallback.background.color
    },
    objects: {
      characters: Array.isArray(value.objects?.characters)
        ? value.objects.characters.map((character: any, index: number): CharacterObject => {
            const gender: CharacterGender = character.gender === 'female' ? 'female' : 'male';
            const rawPosePreset = typeof character.posePresetId === 'string'
              ? character.posePresetId
              : typeof character.posePreset === 'string'
                ? character.posePreset
                : 'stand';
            const posePreset = normalizePosePresetId(rawPosePreset);
            const resolvedDefaultPreset = posePreset === 'custom' ? undefined : resolvePosePresetState(posePreset);
            const presetExtremityPose = resolvedDefaultPreset?.preset || posePresetForId(posePreset);
            const presetFingerPose = presetExtremityPose?.fingerPose || FINGER_POSE_RELAXED;
            const presetToePose = presetExtremityPose?.toePose || TOE_POSE_NEUTRAL;
            const libTvJointAngles = normalizeLibTvJointAngles(character.libTvJointAngles, resolvedDefaultPreset?.libTvJointAngles);
            const rigPose = clampPose(normalizeCharacterRigPose(
              character.model,
              posePreset,
              resolvedDefaultPreset?.rigPose || normalizePose(character.rigPose || character.pose || character.poseParams),
              { preservePresetPose: Boolean(resolvedDefaultPreset) }
            ));
            const legacyBonePose = character.fingerPose?.bones
              ? bonePoseFromBones(character.fingerPose.bones, character.fingerPose.boneSpace === 'runninghub-tv-mixamo' ? 'mixamo-local' : 'scene3d-local')
              : undefined;
            const bonePose = normalizeBonePose(character.bonePose, legacyBonePose || presetExtremityPose?.bonePose);
            return {
              ...defaultCharacter(gender, index + 1),
              ...character,
              id: typeof character.id === 'string' ? character.id : createId('char'),
              gender,
              name: normalizeSceneObjectDisplayName('character', typeof character.name === 'string' ? character.name : '', index, { gender }),
              visible: character.visible !== false,
              locked: Boolean(character.locked),
              position: normalizeVec(character.position, vec()),
              rotation: normalizeVec(character.rotation, vec()),
              scale: normalizeCharacterScale(gender, character.scale, character.model),
              color: typeof character.color === 'string' ? character.color : genderColor(gender),
              posePreset,
              posePresetId: posePreset,
              poseRootOffset: normalizeCharacterRootOffset(character.model, posePreset, character.poseRootOffset, { preservePresetPose: Boolean(resolvedDefaultPreset) }),
              rigPose,
              bonePose,
              fingerPose: normalizeFingerPose(character.fingerPose, presetFingerPose),
              toePose: normalizeToePose(character.toePose, presetToePose),
              libTvJointAngles,
              poseReferenceImages: normalizePoseReferenceImages(character.poseReferenceImages),
              poseReferenceSolveHistory: normalizePoseReferenceSolveHistory(character.poseReferenceSolveHistory),
              model: normalizeCharacterModel(gender, character.model)
            };
          })
        : fallback.objects.characters,
      props: Array.isArray(value.objects?.props)
        ? value.objects.props.map((prop: any, index: number): PropObject => ({
            id: typeof prop.id === 'string' ? prop.id : createId('prop'),
            name: normalizeSceneObjectDisplayName('prop', typeof prop.name === 'string' ? prop.name : '', index, { propShape: prop.shape }),
            visible: prop.visible !== false,
            locked: Boolean(prop.locked),
            shape: prop.shape === 'model' && normalizeImportedSceneModel(prop.model)
              ? 'model'
              : PROP_CREATION_OPTIONS.some((item) => item.id === prop.shape)
                ? prop.shape
                : 'box',
            position: normalizeVec(prop.position, vec()),
            rotation: normalizeVec(prop.rotation, vec()),
            scale: normalizeVec(prop.scale, vec(0.6, 0.6, 0.6)),
            color: typeof prop.color === 'string' ? prop.color : '#a16207',
            model: normalizeImportedSceneModel(prop.model)
          }))
        : fallback.objects.props,
      cameras,
      lights: Array.isArray(value.objects?.lights)
        ? value.objects.lights.map((light: any, index: number): LightObject => ({
            id: typeof light.id === 'string' ? light.id : createId('light'),
            name: normalizeSceneObjectDisplayName('light', typeof light.name === 'string' ? light.name : '', index, { lightType: light.lightType }),
            visible: light.visible !== false,
            locked: Boolean(light.locked),
            lightType: LIGHT_ADD_OPTIONS.some((item) => item.id === light.lightType) ? light.lightType : 'ambient',
            position: normalizeVec(light.position, vec(0, 3, 0)),
            rotation: normalizeVec(light.rotation, vec()),
            scale: normalizeVec(light.scale, vec(1, 1, 1)),
            color: typeof light.color === 'string' ? light.color : '#ffffff',
            intensity: Number.isFinite(Number(light.intensity)) ? Number(light.intensity) : 1
          }))
        : fallback.objects.lights
    },
    selectedObjectId: typeof value.selectedObjectId === 'string' ? value.selectedObjectId : fallback.selectedObjectId,
    activeCameraId,
    activeViewMode: value.activeViewMode === 'camera' ? 'camera' : 'director',
    transformMode: value.transformMode === 'rotate' || value.transformMode === 'scale' ? value.transformMode : 'translate',
    aspectRatio: typeof value.aspectRatio === 'string' ? value.aspectRatio : '16:9',
    gridSnapEnabled: Boolean(value.gridSnapEnabled),
    groundGridEnabled: value.groundGridEnabled !== false,
    groundEnabled: value.groundEnabled !== false,
    motionPathEnabled: value.motionPathEnabled === true,
    characterLabelsEnabled: value.characterLabelsEnabled !== false,
    compositionGuideEnabled: value.compositionGuideEnabled === true,
    sceneZoomPercent: Number.isFinite(Number(value.sceneZoomPercent)) && Number(value.sceneZoomPercent) > 0
      ? clampNumber(Number(value.sceneZoomPercent), 50, 500)
      : 100,
    captures: Array.isArray(value.captures) ? value.captures : [],
    poseTransitions: Array.isArray(value.poseTransitions)
      ? value.poseTransitions.map(normalizeTransition).filter(Boolean) as PoseTransition[]
      : [],
    jointAxisProfile: normalizeJointAxisProfile(value.jointAxisProfile),
    activeTransitionId: typeof value.activeTransitionId === 'string' ? value.activeTransitionId : undefined,
    undoStack: [],
    redoStack: []
  };
  scene.undoStack = normalizeHistoryStack(value.undoStack, scene);
  scene.redoStack = normalizeHistoryStack(value.redoStack, scene);
  return scene;
}

function applyHistorySnapshot(scene: Scene3DState, snapshot: Scene3DHistorySnapshot): Scene3DState {
  const restored = normalizeScene({
    ...scene,
    ...snapshot,
    transformMode: scene.transformMode,
    undoStack: scene.undoStack,
    redoStack: scene.redoStack
  });
  const selectedStillExists = Boolean(restored.selectedObjectId) && Boolean(selectedKind(restored));
  const activeTransitionStillExists = restored.poseTransitions.some((item) => item.id === restored.activeTransitionId);
  return normalizeScene({
    ...restored,
    selectedObjectId: selectedStillExists ? restored.selectedObjectId : undefined,
    activeTransitionId: activeTransitionStillExists ? restored.activeTransitionId : undefined,
    activeCameraId: restored.objects.cameras.some((item) => item.id === restored.activeCameraId)
      ? restored.activeCameraId
      : restored.objects.cameras[0]?.id
  });
}

function snapshotsEqual(a: Scene3DHistorySnapshot, b: Scene3DHistorySnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function objectNameForHistory(scene: Scene3DState, kind: ObjectKind, id: string) {
  const list = kind === 'character'
    ? scene.objects.characters
    : kind === 'prop'
      ? scene.objects.props
      : kind === 'camera'
        ? scene.objects.cameras
        : scene.objects.lights;
  return list.find((item) => item.id === id)?.name || 'Object';
}

function defaultObjectPatchLabel(kind: ObjectKind, scene: Scene3DState, id: string, patch: any) {
  const name = objectNameForHistory(scene, kind, id);
  if ('poseReferenceImages' in patch) return `Update ${name} pose references`;
  if ('rigPose' in patch || 'fingerPose' in patch || 'toePose' in patch || 'posePreset' in patch || 'posePresetId' in patch) return `Adjust ${name} pose`;
  if ('gender' in patch) return `Change ${name} role type`;
  if ('name' in patch) return `Rename ${name}`;
  if ('position' in patch) return `Move ${name}`;
  if ('rotation' in patch) return `Rotate ${name}`;
  if ('scale' in patch) return `Scale ${name}`;
  if ('fov' in patch) return `Adjust ${name} fov`;
  if ('lensType' in patch) return `Adjust ${name} lens`;
  if ('fisheyeStrength' in patch || 'focusDistance' in patch || 'tiltShiftAmount' in patch || 'orthographicScale' in patch) return `Adjust ${name} lens parameters`;
  if ('targetPosition' in patch) return `Adjust ${name} target`;
  if ('intensity' in patch) return `Adjust ${name} intensity`;
  if ('color' in patch) return `Adjust ${name} color`;
  if ('shape' in patch) return `Adjust ${name} shape`;
  if ('lightType' in patch) return `Adjust ${name} light type`;
  if ('visible' in patch) return `${patch.visible ? 'Show' : 'Hide'} ${name}`;
  if ('locked' in patch) return `${patch.locked ? 'Lock' : 'Unlock'} ${name}`;
  return `Adjust ${name}`;
}

function historyMergeKeyForObjectPatch(kind: ObjectKind, id: string, patch: any) {
  const keys = Object.keys(patch).sort();
  const mergeableKeys = ['position', 'rotation', 'scale', 'targetPosition', 'fov', 'fisheyeStrength', 'focusDistance', 'tiltShiftAmount', 'orthographicScale', 'rigPose', 'fingerPose', 'toePose', 'intensity', 'color'];
  if (keys.length === 1 && keys[0] === 'poseReferenceImages') return undefined;
  if (keys.length && keys.every((key) => mergeableKeys.includes(key))) {
    return `object:${kind}:${id}:${keys.join(',')}`;
  }
  return undefined;
}

function selectedKind(scene: Scene3DState): ObjectKind | null {
  const id = scene.selectedObjectId;
  if (!id) return null;
  if (scene.objects.characters.some((item) => item.id === id)) return 'character';
  if (scene.objects.props.some((item) => item.id === id)) return 'prop';
  if (scene.objects.cameras.some((item) => item.id === id)) return 'camera';
  if (scene.objects.lights.some((item) => item.id === id)) return 'light';
  return null;
}

function objectListKey(kind: ObjectKind) {
  return kind === 'character' ? 'characters' : kind === 'prop' ? 'props' : kind === 'camera' ? 'cameras' : 'lights';
}

function objectByKind(scene: Scene3DState, kind: ObjectKind, id?: string) {
  if (!id) return null;
  return (scene.objects as any)[objectListKey(kind)].find((item: any) => item.id === id) || null;
}

function nextTypedObjectName<T extends { name: string }>(items: T[], typeLabel: string) {
  const count = items.filter((item) => item.name === typeLabel || item.name.startsWith(`${typeLabel} `)).length + 1;
  return `${typeLabel} ${count}`;
}

function sortedSceneProps(props: PropObject[]) {
  return [...props].sort((a, b) => {
    const byType = (PROP_SORT_ORDER[a.shape] ?? 999) - (PROP_SORT_ORDER[b.shape] ?? 999);
    if (byType !== 0) return byType;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
  });
}

function sortedSceneLights(lights: LightObject[]) {
  return [...lights].sort((a, b) => {
    const byType = (LIGHT_SORT_ORDER[a.lightType] ?? 999) - (LIGHT_SORT_ORDER[b.lightType] ?? 999);
    if (byType !== 0) return byType;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
  });
}

function nextImportedModelPosition(existingCount: number, row = 0): Vec3 {
  const lane = existingCount % 4;
  return vec(-1.8 + lane * 1.2, 0, row);
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function removeDeletedObjectReferences(scene: Scene3DState, kind: ObjectKind, deletingId: string): Scene3DState {
  const poseTransitions = scene.poseTransitions
    .filter((transition) => kind !== 'character' || transition.characterId !== deletingId)
    .map((transition) => {
      const handTarget = transition.constraints.handTarget.targetObjectId === deletingId
        ? {
            ...transition.constraints.handTarget,
            targetObjectId: undefined,
            enabled: false
          }
        : transition.constraints.handTarget;
      const headLookAt = transition.constraints.headLookAt.targetObjectId === deletingId
        ? {
            ...transition.constraints.headLookAt,
            targetObjectId: undefined,
            enabled: false
          }
        : transition.constraints.headLookAt;
      return {
        ...transition,
        constraints: {
          ...transition.constraints,
          handTarget,
          headLookAt
        }
      };
    });
  return normalizeScene({
    ...scene,
    poseTransitions,
    activeTransitionId: poseTransitions.some((transition) => transition.id === scene.activeTransitionId)
      ? scene.activeTransitionId
      : undefined
  });
}

function transformControlSizeForKind(kind: ObjectKind, scale: Vec3, measuredSize?: THREE.Vector3) {
  const scaleDiameter = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), 0.1);
  const measuredDiameter = measuredSize && Number.isFinite(measuredSize.length()) && measuredSize.length() > 0.001
    ? measuredSize.length()
    : scaleDiameter;
  const base = Math.max(scaleDiameter, measuredDiameter);
  const minSize: Record<ObjectKind, number> = {
    character: 0.9,
    prop: 0.62,
    camera: 0.58,
    light: 0.5
  };
  const maxSize: Record<ObjectKind, number> = {
    character: 1.35,
    prop: 1.02,
    camera: 0.9,
    light: 0.78
  };
  const size = base * 0.46;
  return Number(Math.min(maxSize[kind], Math.max(minSize[kind], size)).toFixed(3));
}

function isTemplateId(value: any): value is ActionTemplateId {
  return [
    'look_at',
    'turn_to',
    'raise_hand',
    'wave',
    'point_at',
    'step_forward',
    'step_back',
    'sit_down',
    'stand_up',
    'pick_up',
    'put_down'
  ].includes(value);
}

// Prompt-to-motion planning, deterministic transition generation, and quality fixes.
function captureCharacterState(character: CharacterObject) {
  const posePresetId = normalizePosePresetId(character.posePresetId || character.posePreset);
  const libTvJointAngles = character.libTvJointAngles
    ? cloneLibTvJointAngles(character.libTvJointAngles)
    : libTvJointAnglesForPresetId(posePresetId);
  return {
    posePresetId,
    libTvJointAngles,
    pose: clonePose(character.rigPose),
    bonePose: cloneBonePose(character.bonePose),
    fingerPose: cloneFingerPose(character.fingerPose),
    toePose: cloneToePose(character.toePose),
    transform: {
      position: { ...character.position },
      rotation: { ...character.rotation },
      scale: { ...character.scale }
    }
  };
}

function transitionWithPresetReferenceEndpoints(transition: PoseTransition): PoseTransition {
  const applyEndpoint = (mode: 'start' | 'end', current: PoseTransition): PoseTransition => {
    const presetId = normalizePosePresetId(mode === 'start' ? current.startPosePresetId : current.endPosePresetId);
    if (!presetId || presetId === 'custom') return current;
    const presetState = resolvePosePresetState(presetId, { ignoreDefault: true });
    if (!presetState) return current;
    const patch = mode === 'start'
      ? {
          startPose: clonePose(presetState.rigPose),
          startBonePose: cloneBonePose(presetState.bonePose),
          startFingerPose: cloneFingerPose(presetState.fingerPose),
          startToePose: cloneToePose(presetState.toePose),
          startLibTvJointAngles: cloneLibTvJointAngles(presetState.libTvJointAngles)
        }
      : {
          endPose: clonePose(presetState.rigPose),
          endBonePose: cloneBonePose(presetState.bonePose),
          endFingerPose: cloneFingerPose(presetState.fingerPose),
          endToePose: cloneToePose(presetState.toePose),
          endLibTvJointAngles: cloneLibTvJointAngles(presetState.libTvJointAngles)
        };
    return { ...current, ...patch };
  };
  return applyEndpoint('end', applyEndpoint('start', transition));
}

function easeCurve(curve: CurveType, t: number) {
  if (curve === 'ease_in') return t * t;
  if (curve === 'ease_out') return 1 - (1 - t) * (1 - t);
  if (curve === 'ease_in_out') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return t;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t)
  };
}

function vecToQuaternion(rotation: RigRotation) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(rotation.x), rad(rotation.y), rad(rotation.z), 'XYZ'));
}

function runningHubTvRotationToQuaternion(rotation: RigRotation) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    (rotation.x * Math.PI) / 180,
    (rotation.y * Math.PI) / 180,
    (rotation.z * Math.PI) / 180,
    'XYZ'
  ));
}

function quatToRotation(quaternion: THREE.Quaternion): RigRotation {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    x: Number(((euler.x * 180) / Math.PI).toFixed(3)),
    y: Number(((euler.y * 180) / Math.PI).toFixed(3)),
    z: Number(((euler.z * 180) / Math.PI).toFixed(3))
  };
}

function slerpRotation(start: RigRotation, end: RigRotation, t: number): RigRotation {
  const qa = vecToQuaternion(start);
  const qb = vecToQuaternion(end);
  const result = qa.slerp(qb, t);
  return quatToRotation(result);
}

function clampRotation(value: RigRotation, limits: { x: [number, number]; y: [number, number]; z: [number, number] }): RigRotation {
  return {
    x: Math.min(Math.max(value.x, limits.x[0]), limits.x[1]),
    y: Math.min(Math.max(value.y, limits.y[0]), limits.y[1]),
    z: Math.min(Math.max(value.z, limits.z[0]), limits.z[1])
  };
}

function clampPose(pose: StandardHumanRigPose) {
  const next = clonePose(pose);
  for (const key of POSE_KEYS) next[key] = clampRotation(next[key], JOINT_LIMITS[key]);
  return next;
}

function jointAxisProfileForScene(scene: Scene3DState): Scene3DJointAxisProfile {
  return normalizeJointAxisProfile(scene.jointAxisProfile);
}

function clampRotationWithJointProfile(
  value: RigRotation,
  joint: Scene3DJointDefinition | undefined,
  fallback: { x: [number, number]; y: [number, number]; z: [number, number] }
): RigRotation {
  return {
    x: clampNumber(value.x, joint?.axes.x.range[0] ?? fallback.x[0], joint?.axes.x.range[1] ?? fallback.x[1]),
    y: clampNumber(value.y, joint?.axes.y.range[0] ?? fallback.y[0], joint?.axes.y.range[1] ?? fallback.y[1]),
    z: clampNumber(value.z, joint?.axes.z.range[0] ?? fallback.z[0], joint?.axes.z.range[1] ?? fallback.z[1])
  };
}

function clampPoseWithJointProfile(pose: StandardHumanRigPose, profile?: Scene3DJointAxisProfile) {
  const next = clonePose(pose);
  for (const key of POSE_KEYS) {
    next[key] = clampRotationWithJointProfile(next[key], profile?.joints[key], JOINT_LIMITS[key]);
  }
  return next;
}

function jointAxisProfileSummary(profile: Scene3DJointAxisProfile) {
  return POSE_KEYS.map((key) => {
    const joint = profile.joints[key];
    return {
      key,
      label: joint.label,
      parent: joint.parent,
      bones: joint.bones.map((bone) => bone.name),
      roles: joint.semanticRoles.slice(0, 4),
      axes: {
        x: {
          range: joint.axes.x.range,
          positive: joint.axes.x.positive.effect,
          negative: joint.axes.x.negative.effect,
          role: joint.axes.x.motionRole
        },
        y: {
          range: joint.axes.y.range,
          positive: joint.axes.y.positive.effect,
          negative: joint.axes.y.negative.effect,
          role: joint.axes.y.motionRole
        },
        z: {
          range: joint.axes.z.range,
          positive: joint.axes.z.positive.effect,
          negative: joint.axes.z.negative.effect,
          role: joint.axes.z.motionRole
        }
      }
    };
  });
}

function targetPositionForConstraint(scene: Scene3DState, transition: PoseTransition, transform: PoseTransform) {
  const objectById = (id?: string) => {
    if (!id) return null;
    return scene.objects.props.find((item) => item.id === id)
      || scene.objects.lights.find((item) => item.id === id)
      || scene.objects.cameras.find((item) => item.id === id)
      || scene.objects.characters.find((item) => item.id === id);
  };
  const currentCamera = scene.objects.cameras.find((item) => item.id === scene.activeCameraId) || scene.objects.cameras[0];
  const templateTarget = transition.actionPlan.templates.find((item) => (
    (item.id === 'point_at' || item.id === 'pick_up' || item.id === 'put_down') && item.targetObjectId
  ));
  const templateHand = transition.actionPlan.templates.find((item) => (
    item.id === 'point_at' || item.id === 'pick_up' || item.id === 'put_down' || item.id === 'raise_hand' || item.id === 'wave'
  ))?.hand || transition.constraints.handTarget.hand;
  const headTarget = transition.constraints.headLookAt.targetMode === 'camera'
    ? currentCamera?.position
    : transition.constraints.headLookAt.targetMode === 'object'
      ? objectById(transition.constraints.headLookAt.targetObjectId)?.position
      : transition.constraints.headLookAt.targetPosition;
  const explicitHandTarget = transition.constraints.handTarget.targetMode === 'object'
    ? objectById(transition.constraints.handTarget.targetObjectId)?.position
    : transition.constraints.handTarget.targetPosition;
  const templateTargetObject = objectById(templateTarget?.targetObjectId || undefined);
  const handTarget = explicitHandTarget || templateTargetObject?.position;
  return {
    headTarget: headTarget ? normalizeVec(headTarget, vec()) : undefined,
    handTarget: handTarget ? normalizeVec(handTarget, vec()) : undefined,
    handTargetObjectId: transition.constraints.handTarget.targetObjectId || templateTarget?.targetObjectId || undefined,
    hand: templateHand,
    origin: transform.position
  };
}

function applyHeadLookAt(pose: StandardHumanRigPose, headTarget: Vec3 | undefined, origin: Vec3) {
  if (!headTarget) return pose;
  const direction = new THREE.Vector3(headTarget.x - origin.x, headTarget.y - (origin.y + 1.55), headTarget.z - origin.z);
  if (direction.lengthSq() < 0.0001) return pose;
  const yaw = deg(Math.atan2(direction.x, direction.z));
  const pitch = deg(Math.atan2(direction.y, Math.max(0.0001, Math.sqrt(direction.x * direction.x + direction.z * direction.z))));
  return patchPose(pose, {
    neck: { x: pitch * 0.35, y: yaw * 0.3 },
    head: { x: pitch * 0.65, y: yaw * 0.65 }
  });
}

function solveArmIkToTarget(
  pose: StandardHumanRigPose,
  hand: 'left' | 'right',
  handTarget: Vec3 | undefined,
  origin: Vec3
): { pose: StandardHumanRigPose; warning?: string } {
  if (!handTarget) return { pose };
  const side = hand === 'left' ? -1 : 1;
  const shoulder = new THREE.Vector3(origin.x + side * 0.28, origin.y + 1.28, origin.z);
  const target = new THREE.Vector3(handTarget.x, handTarget.y + 0.22, handTarget.z);
  const direction = target.sub(shoulder);
  const distance = direction.length();
  if (distance < 0.0001) return { pose };
  const upperArm = 0.36;
  const lowerArm = 0.34;
  const maxReach = upperArm + lowerArm;
  const clampedDistance = Math.min(Math.max(distance, 0.08), maxReach);
  const horizontal = Math.max(0.0001, Math.sqrt(direction.x * direction.x + direction.z * direction.z));
  const yaw = deg(Math.atan2(direction.x, Math.max(0.0001, -direction.z)));
  const pitch = deg(Math.atan2(direction.y, horizontal));
  const elbowCos = Math.min(1, Math.max(-1, (upperArm * upperArm + lowerArm * lowerArm - clampedDistance * clampedDistance) / (2 * upperArm * lowerArm)));
  const elbowInner = deg(Math.acos(elbowCos));
  const bend = Math.min(128, Math.max(8, 180 - elbowInner));
  const sideLift = Math.min(78, Math.max(18, Math.abs(yaw) * 0.35 + 26));
  const twist = Math.min(36, Math.max(-36, yaw * 0.2));
  const shoulderX = Math.min(72, Math.max(-92, -pitch - 18));
  const warning = distance > maxReach + 0.08
    ? `${hand === 'left' ? 'Left hand' : 'Right hand'} target is outside the reachable range; clamped automatically`
    : undefined;
  if (hand === 'left') {
    return {
      pose: patchPose(pose, {
        leftUpperArm: { x: shoulderX, y: twist, z: -sideLift },
        leftLowerArm: { x: bend },
        leftHand: { x: Math.min(22, Math.max(-22, pitch * 0.25)), z: -10 }
      }),
      warning
    };
  }
  return {
    pose: patchPose(pose, {
      rightUpperArm: { x: shoulderX, y: twist, z: -sideLift },
      rightLowerArm: { x: bend },
      rightHand: { x: Math.min(22, Math.max(-22, pitch * 0.25)), z: -10 }
    }),
    warning
  };
}

function applyTemplateOverlay(
  pose: StandardHumanRigPose,
  transform: PoseTransform,
  template: PoseTransitionTemplate,
  t: number,
  profile?: Scene3DJointAxisProfile
) {
  const finalize = (nextPose: StandardHumanRigPose) => profile ? clampPoseWithJointProfile(nextPose, profile) : nextPose;
  const weight = template.strength;
  const wave = Math.sin(t * Math.PI * 2);
  if (template.id === 'raise_hand') {
    const hand = template.hand || 'right';
    return finalize(hand === 'left'
      ? patchPose(pose, {
          leftUpperArm: { x: -88 * weight, z: -56 * weight },
          leftLowerArm: { x: 30 * weight }
        })
      : patchPose(pose, {
          rightUpperArm: { x: -88 * weight, z: -56 * weight },
          rightLowerArm: { x: 30 * weight }
        }));
  }
  if (template.id === 'wave') {
    const hand = template.hand || 'right';
    return finalize(hand === 'left'
      ? patchPose(pose, {
          leftUpperArm: { x: -92 * weight, z: -54 * weight },
          leftLowerArm: { x: 38 * weight + wave * 10 * weight },
          leftHand: { y: wave * 16 * weight, z: -24 * weight }
        })
      : patchPose(pose, {
          rightUpperArm: { x: -92 * weight, z: -54 * weight },
          rightLowerArm: { x: 38 * weight + wave * 10 * weight },
          rightHand: { y: -wave * 16 * weight, z: -24 * weight }
        }));
  }
  if (template.id === 'point_at') {
    const hand = template.hand || 'right';
    return finalize(hand === 'left'
      ? patchPose(pose, {
          leftUpperArm: { x: -36 * weight, z: -48 * weight },
          leftLowerArm: { x: 15 * weight }
        })
      : patchPose(pose, {
          rightUpperArm: { x: -36 * weight, z: -48 * weight },
          rightLowerArm: { x: 15 * weight }
        }));
  }
  if (template.id === 'step_forward') {
    const stride = Math.sin(t * Math.PI) * 24 * weight;
    pose = patchPose(pose, {
      leftUpperLeg: { x: stride },
      rightUpperLeg: { x: -stride },
      leftLowerLeg: { x: Math.max(0, -stride) * 0.9 },
      rightLowerLeg: { x: Math.max(0, stride) * 0.9 },
      chest: { x: -6 * weight }
    });
    transform.position.z -= 0.18 * Math.sin(t * Math.PI) * weight;
    return finalize(pose);
  }
  if (template.id === 'step_back') {
    const stride = Math.sin(t * Math.PI) * 24 * weight;
    pose = patchPose(pose, {
      leftUpperLeg: { x: -stride },
      rightUpperLeg: { x: stride },
      leftLowerLeg: { x: Math.max(0, stride) * 0.9 },
      rightLowerLeg: { x: Math.max(0, -stride) * 0.9 },
      chest: { x: 4 * weight }
    });
    transform.position.z += 0.14 * Math.sin(t * Math.PI) * weight;
    return finalize(pose);
  }
  if (template.id === 'sit_down') {
    const k = easeCurve('ease_in_out', t) * weight;
    return finalize(patchPose(pose, {
      pelvis: { x: -10 * k },
      chest: { x: 10 * k },
      leftUpperLeg: { x: 86 * k },
      rightUpperLeg: { x: 86 * k },
      leftLowerLeg: { x: 95 * k },
      rightLowerLeg: { x: 95 * k }
    }));
  }
  if (template.id === 'stand_up') {
    const k = 1 - easeCurve('ease_in_out', 1 - t);
    return finalize(patchPose(pose, {
      pelvis: { x: -10 * (1 - k) },
      chest: { x: 10 * (1 - k) },
      leftUpperLeg: { x: 86 * (1 - k) },
      rightUpperLeg: { x: 86 * (1 - k) },
      leftLowerLeg: { x: 95 * (1 - k) },
      rightLowerLeg: { x: 95 * (1 - k) }
    }));
  }
  if (template.id === 'turn_to') {
    transform.rotation.y += Math.sin(t * Math.PI) * 18 * weight;
    return finalize(patchPose(pose, {
      chest: { y: Math.sin(t * Math.PI) * 16 * weight },
      neck: { y: Math.sin(t * Math.PI) * 6 * weight }
    }));
  }
  if (template.id === 'look_at') {
    return finalize(patchPose(pose, { head: { y: Math.sin(t * Math.PI) * 8 * weight } }));
  }
  if (template.id === 'pick_up') {
    const hand = template.hand || 'right';
    return finalize(patchPose(pose, {
      chest: { x: 20 * weight },
      pelvis: { x: -8 * weight },
      ...(hand === 'left'
        ? {
            leftUpperArm: { x: 38 * weight, z: -40 * weight },
            leftLowerArm: { x: 46 * weight }
          }
        : {
            rightUpperArm: { x: 38 * weight, z: -40 * weight },
            rightLowerArm: { x: 46 * weight }
          }),
      leftUpperLeg: { x: 18 * weight },
      rightUpperLeg: { x: 18 * weight }
    }));
  }
  if (template.id === 'put_down') {
    const hand = template.hand || 'right';
    return finalize(patchPose(pose, {
      chest: { x: 14 * weight },
      ...(hand === 'left'
        ? {
            leftUpperArm: { x: 22 * weight, z: -38 * weight },
            leftLowerArm: { x: 28 * weight }
          }
        : {
            rightUpperArm: { x: 22 * weight, z: -38 * weight },
            rightLowerArm: { x: 28 * weight }
          })
    }));
  }
  return pose;
}

function normalizedDirection(input: Vec3) {
  const length = Math.sqrt(input.x * input.x + input.z * input.z);
  if (length < 0.0001) return vec();
  return vec(input.x / length, 0, input.z / length);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number) {
  return clampNumber(value, 0, 1);
}

function cameraLensProjection(cameraObject: CameraObject) {
  const lens = CAMERA_LENS_BY_ID[cameraObject.lensType] || CAMERA_LENS_BY_ID.standard;
  const fisheyeBoost = cameraObject.lensType === 'fisheye' ? clampNumber(cameraObject.fisheyeStrength, 0, 1) * 42 : 0;
  const fov = clampNumber(cameraObject.fov + fisheyeBoost, 8, 140);
  const focusZoom = cameraObject.lensType === 'macro'
    ? clampNumber(1.15 + (1 / Math.max(cameraObject.focusDistance, 0.15)) * 0.12, 1.1, 1.75)
    : lens.zoom;
  const zoom = cameraObject.lensType === 'orthographic'
    ? clampNumber(7 / Math.max(cameraObject.orthographicScale, 1), 0.45, 3)
    : focusZoom;
  const filmOffset = cameraObject.lensType === 'tilt_shift'
    ? clampNumber(cameraObject.tiltShiftAmount, -1, 1) * 18
    : 0;
  return { fov, zoom, filmOffset };
}

function pulse(t: number, start: number, end: number) {
  if (t <= start || t >= end) return 0;
  const local = (t - start) / Math.max(0.0001, end - start);
  return Math.sin(local * Math.PI);
}

function ramp(t: number, start: number, end: number) {
  if (t <= start) return 0;
  if (t >= end) return 1;
  return easeCurve('ease_in_out', (t - start) / Math.max(0.0001, end - start));
}

function addUniqueFamily(families: UniversalMotionFamily[], family: UniversalMotionFamily) {
  if (!families.includes(family)) families.push(family);
}

function deriveMotionFamiliesFromText(text: string, plan: {
  direction: Vec3;
  stride: number;
  turn: number;
  roll: number;
  crouch: number;
  verticalLift: number;
  rhythm: UniversalMotionPlan['rhythm'];
  contacts?: MotionContactHint[];
}): UniversalMotionFamily[] {
  const normalized = text.trim().toLowerCase();
  const families: UniversalMotionFamily[] = [];
  const contactSet = new Set(plan.contacts || []);
  if (plan.stride > 0.03 || plan.direction.x || plan.direction.z || /step|walk|run|dash|forward|backward|retreat|approach|lunge/.test(normalized)) addUniqueFamily(families, 'locomotion');
  if (Math.abs(plan.turn) > 1 || /turn|rotate|spin|pivot/.test(normalized)) addUniqueFamily(families, 'turn');
  if (plan.roll > 0.08 || /roll|tumble|somersault|cartwheel|flip/.test(normalized)) addUniqueFamily(families, 'roll');
  if (/fall|collapse|drop|trip|knockdown/.test(normalized) || contactSet.has('hip') || contactSet.has('shoulder')) addUniqueFamily(families, 'fall');
  if (/get up|stand up|rise|recover/.test(normalized)) addUniqueFamily(families, 'get_up');
  if (/dodge|evade|sidestep|duck|avoid/.test(normalized)) addUniqueFamily(families, 'dodge');
  if (/crawl|creep/.test(normalized) || (plan.crouch > 0.7 && contactSet.has('hands'))) addUniqueFamily(families, 'crawl');
  if (/kneel/.test(normalized)) addUniqueFamily(families, 'kneel');
  if (/stumble|trip|limp/.test(normalized)) addUniqueFamily(families, 'stumble');
  if (/reach|grab|pick|push|pull|point/.test(normalized) || contactSet.has('leftHand') || contactSet.has('rightHand') || contactSet.has('hands')) addUniqueFamily(families, 'reach');
  if (/carry|hold/.test(normalized)) addUniqueFamily(families, 'carry');
  if (!families.length) addUniqueFamily(families, plan.rhythm === 'perform' ? 'turn' : 'locomotion');
  return families;
}

function universalMotionFamilies(plan: UniversalMotionPlan | undefined, prompt = ''): UniversalMotionFamily[] {
  if (!plan) return [];
  return plan.families?.length ? plan.families : deriveMotionFamiliesFromText(prompt, plan);
}

const UNIVERSAL_MOTION_FAMILY_LABELS: Record<UniversalMotionFamily, string> = {
  locomotion: '\u79fb\u52a8',
  turn: '\u8f6c\u5411',
  roll: '\u7ffb\u6eda',
  fall: '\u5012\u5730',
  get_up: '\u8d77\u8eab',
  dodge: '\u95ea\u907f',
  crawl: '\u722c\u884c',
  kneel: '\u8dea\u59ff',
  stumble: '\u8e09\u8dc4',
  reach: '\u4f38\u624b',
  carry: '\u62b1\u7269'
};

const MOTION_CONTACT_LABELS: Record<MotionContactHint, string> = {
  leftFoot: 'Left foot',
  rightFoot: 'Right foot',
  leftHand: 'Left hand',
  rightHand: 'Right hand',
  head: 'Head',
  shoulder: 'Shoulder',
  hip: 'Hip',
  feet: 'Feet',
  hands: 'Hands'
};

function universalMotionFootLockStrategy(plan: UniversalMotionPlan | undefined, prompt = '') {
  if (!plan) return 'none' as const;
  const families = universalMotionFamilies(plan, prompt);
  const isDynamic = plan.verticalLift > 0.08
    || plan.roll > 0.08
    || plan.stride > 0.35
    || families.some((family) => ['roll', 'fall', 'get_up', 'dodge', 'crawl', 'kneel', 'stumble'].includes(family));
  return isDynamic ? 'phased' as const : 'stable' as const;
}

function footLockPhaseActive(transition: PoseTransition, limb: 'left' | 'right', t: number) {
  if (!transition.constraints.footLock.enabled) return false;
  if (!transition.constraints.footLock[limb]) return false;
  const plan = transition.actionPlan.universal;
  if (universalMotionFootLockStrategy(plan, transition.actionPrompt) !== 'phased') return true;
  const families = universalMotionFamilies(plan, transition.actionPrompt);
  const contactSet = new Set(plan?.contacts || []);
  const early = t <= 0.16;
  const late = t >= 0.84;
  if (families.includes('crawl')) return t <= 0.08 || t >= 0.92;
  if (families.includes('get_up')) return t >= 0.62;
  if (families.includes('fall')) return t <= 0.18 || t >= 0.74;
  if (families.includes('roll')) return early || late;
  if (families.includes('dodge') || families.includes('stumble')) {
    return limb === 'left'
      ? t <= 0.2 || (t >= 0.55 && t <= 0.82)
      : (t >= 0.18 && t <= 0.45) || t >= 0.8;
  }
  if (families.includes('kneel')) return t <= 0.18 || t >= 0.72;
  if (contactSet.has('feet') || contactSet.has(`${limb}Foot` as MotionContactHint)) return early || late;
  return t <= 0.12 || t >= 0.88;
}

function deriveUniversalMotionPlan(prompt: string, templates: PoseTransitionTemplate[]): UniversalMotionPlan {
  const normalized = prompt.trim().toLowerCase();
  const direction = vec();
  if (/\u5411\u53f3|\u53f3\u4fa7|\u53f3\u79fb|sidestep right|move right/.test(normalized)) direction.x += 1;
  if (/\u5411\u5de6|\u5de6\u4fa7|\u5de6\u79fb|sidestep left|move left/.test(normalized)) direction.x -= 1;
  if (/\u524d\u8fdb|\u5411\u524d|\u4e0a\u524d|\u9760\u8fd1|\u63a8\u8fdb|\u6251\u5411|\u51b2\u5411|move forward|forward|approach|lunge/.test(normalized)) direction.z -= 1;
  if (/\u540e\u9000|\u9000\u5411|\u62c9\u5f00|\u8fdc\u79bb|move back|backward|retreat/.test(normalized)) direction.z += 1;

  const hasStep = /\u8fc8\u6b65|\u8d70|\u8dd1|\u51b2|\u9760\u8fd1|\u8fdc\u79bb|step|walk|run|dash|jump|approach|retreat|lunge/.test(normalized)
    || templates.some((item) => item.id === 'step_forward' || item.id === 'step_back');
  const isRun = /\u8dd1|\u51b2|\u5feb\u901f|dash|run|quick|fast/.test(normalized);
  const isJump = /\u8df3|\u8dc3|jump|hop|leap/.test(normalized);
  const isRoll = /\u7ffb\u6eda|\u6eda\u52a8|\u4fa7\u6eda|\u524d\u6eda|roll|tumble|somersault|flip/.test(normalized);
  const isFall = /\u6454|\u5012|\u8dcc|fall|collapse|drop|knockdown/.test(normalized);
  const isCrouch = /\u8e72|\u538b\u4f4e|\u4e0b\u6c89|\u4e0b\u8e72|crouch|squat|duck/.test(normalized);
  const isPerform = /\u6325|\u6446|\u821e|\u8868\u6f14|\u5938\u5f20|\u5c55\u793a|wave|swing|perform|dance/.test(normalized);
  const turnSign = /\u5de6\u8f6c|\u5411\u5de6\u8f6c|turn left/.test(normalized) ? -1 : /\u53f3\u8f6c|\u5411\u53f3\u8f6c|turn right/.test(normalized) ? 1 : 0;
  const hasTurn = /\u8f6c\u8eab|\u8f6c\u5411|\u65cb\u8f6c|\u56de\u5934|turn|rotate|spin|pivot/.test(normalized) || templates.some((item) => item.id === 'turn_to');
  const turn = isRoll ? (turnSign || 1) * 72 : hasTurn ? (turnSign || 1) * (/\u534a\u5708|180/.test(normalized) ? 36 : 22) : 0;
  const stride = isRoll ? 0.32 : hasStep ? (isRun ? 0.42 : 0.26) : (direction.x || direction.z ? 0.18 : 0);
  const plan: Omit<UniversalMotionPlan, 'families'> = {
    direction: normalizedDirection(direction.x || direction.z ? direction : isRoll ? vec(0, 0, -1) : direction),
    stride,
    turn,
    armSwing: Math.max(isPerform ? 0.85 : 0, isRoll ? 0.62 : hasStep ? (isRun ? 0.75 : 0.45) : 0.18),
    bodyLean: isRoll || isFall ? 1 : isRun ? 0.8 : hasStep ? 0.45 : hasTurn ? 0.22 : 0.12,
    verticalLift: isJump ? 0.28 : isRoll ? 0.08 : hasStep ? 0.05 : 0,
    crouch: isRoll || isFall ? 0.9 : isCrouch ? 0.7 : 0,
    roll: isRoll ? 1 : 0,
    rhythm: isRoll || isPerform ? 'perform' : isFall ? 'impact' : isRun ? 'run' : hasStep ? 'walk' : 'subtle'
  };
  return {
    ...plan,
    families: deriveMotionFamiliesFromText(prompt, plan)
  };
}

function motionIntentToUniversalPlan(intent: MotionIntent): UniversalMotionPlan {
  const rhythm: UniversalMotionPlan['rhythm'] = intent.rhythm === 'fast'
    ? 'run'
    : intent.rhythm === 'impact'
      ? 'impact'
      : intent.rhythm === 'perform'
        ? 'perform'
        : intent.distance > 0.15
          ? 'walk'
          : 'subtle';
  const leanMagnitude = Math.max(Math.abs(intent.bodyLean.x), Math.abs(intent.bodyLean.z), intent.roll, intent.crouch * 0.6);
  const plan: Omit<UniversalMotionPlan, 'families'> = {
    direction: normalizedDirection(intent.direction),
    stride: Math.max(0, Math.min(1.5, intent.distance)),
    turn: Math.max(-180, Math.min(180, intent.turnDeg)),
    armSwing: Math.max(0, Math.min(1, intent.armSwing)),
    bodyLean: Math.max(0, Math.min(1, leanMagnitude)),
    verticalLift: Math.max(0, Math.min(0.6, intent.verticalLift)),
    crouch: Math.max(0, Math.min(1, intent.crouch)),
    roll: Math.max(0, Math.min(1, intent.roll)),
    rhythm,
    contacts: intent.contacts,
    lookAt: intent.lookAt,
    targetObjectId: intent.targetObjectId
  };
  return {
    ...plan,
    families: deriveMotionFamiliesFromText(`${intent.intent} ${intent.generatedMotionPrompt}`, plan)
  };
}
function applyUniversalMotionOverlay(
  pose: StandardHumanRigPose,
  transform: PoseTransform,
  plan: UniversalMotionPlan | undefined,
  t: number,
  profile?: Scene3DJointAxisProfile
) {
  if (!plan) return pose;
  const families = plan.families?.length ? plan.families : deriveMotionFamiliesFromText('', plan);
  const hasFamily = (family: UniversalMotionFamily) => families.includes(family);
  const bell = Math.sin(t * Math.PI);
  const cycleSpeed = plan.rhythm === 'run' || plan.rhythm === 'impact' ? 4 : hasFamily('crawl') ? 3 : 2;
  const cycle = Math.sin(t * Math.PI * cycleSpeed);
  const counter = Math.cos(t * Math.PI * cycleSpeed);
  const side = plan.direction.x >= 0 ? 1 : -1;
  const forward = plan.direction.z || (plan.stride > 0 ? -1 : 0);
  const sideways = plan.direction.x;

  if (plan.stride > 0) {
    const strideScale = hasFamily('crawl') ? 0.55 : hasFamily('kneel') ? 0.25 : hasFamily('dodge') ? 1.15 : 1;
    transform.position.x += plan.direction.x * plan.stride * bell * strideScale;
    transform.position.z += plan.direction.z * plan.stride * bell * strideScale;
  }
  if (plan.verticalLift > 0) transform.position.y += plan.verticalLift * bell;
  if (plan.turn) transform.rotation.y += plan.turn * bell;
  if (plan.rhythm === 'impact') {
    transform.position.x += plan.direction.x * plan.stride * 0.35 * Math.sin(t * Math.PI * 2);
    transform.position.z += plan.direction.z * plan.stride * 0.35 * Math.sin(t * Math.PI * 2);
  }
  if (hasFamily('dodge')) {
    transform.position.x += (sideways || side) * Math.max(0.12, plan.stride * 0.25) * pulse(t, 0.12, 0.62);
    transform.position.y -= 0.08 * Math.max(plan.crouch, 0.45) * pulse(t, 0.1, 0.72);
    transform.rotation.z += (sideways || side) * -10 * pulse(t, 0.08, 0.62);
  }
  if (hasFamily('fall')) {
    const drop = ramp(t, 0.08, 0.72);
    transform.position.y -= 0.32 * Math.max(plan.crouch, 0.55) * drop;
    transform.rotation.x += (forward <= 0 ? -1 : 1) * 18 * drop;
    transform.rotation.z += side * 16 * drop;
  }
  if (hasFamily('get_up')) {
    const recover = ramp(t, 0.2, 0.95);
    transform.position.y -= 0.22 * (1 - recover) * Math.max(plan.crouch, 0.35);
    transform.rotation.x += 16 * (1 - recover);
  }
  if (hasFamily('roll')) {
    const rollAmount = Math.max(plan.roll, 0.45);
    transform.rotation.x += (forward <= 0 ? -1 : 1) * 95 * rollAmount * bell;
    transform.rotation.z += side * 45 * rollAmount * bell;
    transform.position.y -= 0.12 * rollAmount * pulse(t, 0.15, 0.72);
  }

  const strideDeg = plan.stride * 62;
  const armDeg = plan.armSwing * 34;
  const leanDeg = plan.bodyLean * 10;
  const crouch = plan.crouch * bell;
  const roll = plan.roll * bell;
  let nextPose = offsetPose(pose, {
    pelvis: { x: -6 * plan.bodyLean * bell - 10 * crouch - 28 * roll, y: plan.turn * 0.08 * bell, z: plan.direction.x * -5 * bell + 34 * roll },
    chest: { x: -leanDeg * bell + 12 * crouch + 46 * roll, y: plan.turn * 0.32 * bell, z: plan.direction.x * 5 * bell - 38 * roll },
    neck: { y: plan.turn * 0.18 * bell },
    leftUpperLeg: { x: cycle * strideDeg - 42 * crouch, z: plan.direction.x > 0 ? 12 * bell : 0 },
    rightUpperLeg: { x: -cycle * strideDeg - 42 * crouch, z: plan.direction.x < 0 ? -12 * bell : 0 },
    leftLowerLeg: { x: Math.max(0, -cycle) * strideDeg * 0.75 + 55 * crouch },
    rightLowerLeg: { x: Math.max(0, cycle) * strideDeg * 0.75 + 55 * crouch },
    leftFoot: { x: -Math.max(0, -cycle) * 8, z: plan.direction.x > 0 ? 8 * bell : 0 },
    rightFoot: { x: -Math.max(0, cycle) * 8, z: plan.direction.x < 0 ? -8 * bell : 0 },
    leftUpperArm: { x: -counter * armDeg - 8 * plan.bodyLean * bell + 28 * roll, z: -10 * plan.armSwing * bell - 28 * roll },
    rightUpperArm: { x: counter * armDeg - 8 * plan.bodyLean * bell + 28 * roll, z: 10 * plan.armSwing * bell + 28 * roll },
    leftLowerArm: { x: Math.max(0, counter) * armDeg * 0.35 + 28 * roll },
    rightLowerArm: { x: Math.max(0, -counter) * armDeg * 0.35 + 28 * roll }
  });

  if (hasFamily('fall')) {
    const fall = ramp(t, 0.08, 0.72);
    nextPose = offsetPose(nextPose, {
      pelvis: { x: -24 * fall, z: 18 * side * fall },
      chest: { x: 36 * fall, z: -34 * side * fall },
      neck: { x: -10 * fall, z: 12 * side * fall },
      leftUpperArm: { x: 34 * fall, z: -46 * fall },
      rightUpperArm: { x: 30 * fall, z: 44 * fall },
      leftLowerArm: { x: 58 * fall },
      rightLowerArm: { x: 54 * fall },
      leftUpperLeg: { x: -24 * fall, z: -18 * side * fall },
      rightUpperLeg: { x: -38 * fall, z: 18 * side * fall },
      leftLowerLeg: { x: 46 * fall },
      rightLowerLeg: { x: 62 * fall }
    });
  }
  if (hasFamily('get_up')) {
    const ground = 1 - ramp(t, 0.18, 0.9);
    const push = pulse(t, 0.18, 0.68);
    nextPose = offsetPose(nextPose, {
      pelvis: { x: -22 * ground + 8 * push },
      chest: { x: 42 * ground - 18 * push },
      leftUpperArm: { x: 60 * ground - 20 * push, z: -28 * ground },
      rightUpperArm: { x: 58 * ground - 18 * push, z: 28 * ground },
      leftLowerArm: { x: 72 * ground },
      rightLowerArm: { x: 72 * ground },
      leftUpperLeg: { x: -48 * ground + 30 * push, z: -12 * side * ground },
      rightUpperLeg: { x: -24 * ground + 42 * push, z: 12 * side * ground },
      leftLowerLeg: { x: 90 * ground },
      rightLowerLeg: { x: 66 * ground }
    });
  }
  if (hasFamily('dodge')) {
    const dodge = pulse(t, 0.08, 0.7);
    nextPose = offsetPose(nextPose, {
      pelvis: { x: -18 * dodge, z: -22 * side * dodge },
      chest: { x: 14 * dodge, z: 24 * side * dodge },
      head: { z: 10 * side * dodge },
      leftUpperLeg: { x: side > 0 ? 18 * dodge : -16 * dodge, z: 20 * side * dodge },
      rightUpperLeg: { x: side > 0 ? -16 * dodge : 18 * dodge, z: 20 * side * dodge },
      leftLowerLeg: { x: 36 * dodge },
      rightLowerLeg: { x: 36 * dodge },
      leftUpperArm: { z: -24 * dodge },
      rightUpperArm: { z: 24 * dodge }
    });
  }
  if (hasFamily('crawl')) {
    const crawl = Math.max(plan.crouch, 0.75) * bell;
    const handCycle = Math.sin(t * Math.PI * 4);
    nextPose = offsetPose(nextPose, {
      pelvis: { x: -36 * crawl, z: 8 * side * crawl },
      chest: { x: 44 * crawl, z: -8 * side * crawl },
      neck: { x: -10 * crawl },
      leftUpperArm: { x: 72 * crawl + Math.max(0, handCycle) * 16, z: -42 * crawl },
      rightUpperArm: { x: 72 * crawl + Math.max(0, -handCycle) * 16, z: 42 * crawl },
      leftLowerArm: { x: 86 * crawl },
      rightLowerArm: { x: 86 * crawl },
      leftUpperLeg: { x: -76 * crawl + Math.max(0, -handCycle) * 20, z: -14 * crawl },
      rightUpperLeg: { x: -76 * crawl + Math.max(0, handCycle) * 20, z: 14 * crawl },
      leftLowerLeg: { x: 108 * crawl },
      rightLowerLeg: { x: 108 * crawl },
      leftFoot: { x: -18 * crawl },
      rightFoot: { x: -18 * crawl }
    });
  }
  if (hasFamily('kneel')) {
    const kneel = Math.max(plan.crouch, 0.7) * bell;
    nextPose = offsetPose(nextPose, {
      pelvis: { x: -12 * kneel, z: -8 * side * kneel },
      chest: { x: 10 * kneel, z: 8 * side * kneel },
      leftUpperLeg: { x: side > 0 ? 32 * kneel : -72 * kneel, z: -8 * kneel },
      rightUpperLeg: { x: side > 0 ? -72 * kneel : 32 * kneel, z: 8 * kneel },
      leftLowerLeg: { x: side > 0 ? 56 * kneel : 118 * kneel },
      rightLowerLeg: { x: side > 0 ? 118 * kneel : 56 * kneel },
      leftFoot: { x: -18 * kneel },
      rightFoot: { x: -18 * kneel }
    });
  }
  if (hasFamily('stumble')) {
    const stumble = Math.sin(t * Math.PI * 3) * bell;
    transform.position.x += side * 0.08 * stumble;
    transform.rotation.z += side * 8 * stumble;
    nextPose = offsetPose(nextPose, {
      pelvis: { z: -12 * side * stumble, x: -8 * bell },
      chest: { z: 18 * side * stumble, x: 10 * bell },
      leftUpperArm: { x: 18 * bell, z: -18 * side * stumble },
      rightUpperArm: { x: 18 * bell, z: -18 * side * stumble },
      leftUpperLeg: { x: 24 * Math.max(0, stumble) },
      rightUpperLeg: { x: 24 * Math.max(0, -stumble) }
    });
  }
  if (hasFamily('reach') || hasFamily('carry')) {
    const reach = hasFamily('carry') ? ramp(t, 0.08, 0.45) : pulse(t, 0.12, 0.82);
    const carry = hasFamily('carry') ? ramp(t, 0.25, 0.7) : 0;
    nextPose = offsetPose(nextPose, {
      chest: { x: 10 * reach - 4 * carry },
      leftUpperArm: { x: 34 * reach + 28 * carry, z: -28 * reach - 16 * carry, y: -8 * carry },
      rightUpperArm: { x: 38 * reach + 28 * carry, z: 28 * reach + 16 * carry, y: 8 * carry },
      leftLowerArm: { x: 42 * reach + 54 * carry },
      rightLowerArm: { x: 46 * reach + 54 * carry },
      leftHand: { x: -8 * reach, z: -12 * carry },
      rightHand: { x: -8 * reach, z: 12 * carry }
    });
  }

  return profile ? clampPoseWithJointProfile(nextPose, profile) : nextPose;
}
function resolveActionPlan(scene: Scene3DState, prompt: string): PoseTransitionActionPlan {
  const normalized = prompt.trim().toLowerCase();
  const templates: PoseTransitionTemplate[] = [];
  const notes: string[] = [];
  const push = (id: ActionTemplateId, extra?: Partial<PoseTransitionTemplate>) => {
    if (templates.some((item) => item.id === id)) return;
    templates.push({
      id,
      label: TEMPLATE_LABELS[id],
      strength: 1,
      ...extra
    });
  };
  if (!normalized) {
    notes.push('No action prompt was provided; using default motion planning.');
  }
  if (/look at|look|target|camera/.test(normalized)) push('look_at');
  if (/turn|rotate|face/.test(normalized)) push('turn_to');
  if (/raise hand|lift hand|hand up|left hand|right hand/.test(normalized)) push('raise_hand', { hand: /left/.test(normalized) ? 'left' : 'right' });
  if (/wave/.test(normalized)) push('wave', { hand: /left/.test(normalized) ? 'left' : 'right' });
  if (/point/.test(normalized)) push('point_at', { hand: /left/.test(normalized) ? 'left' : 'right' });
  if (/step forward|walk forward|forward/.test(normalized)) push('step_forward');
  if (/step back|backward/.test(normalized)) push('step_back');
  if (/sit down|sit/.test(normalized)) push('sit_down');
  if (/stand up|stand/.test(normalized)) push('stand_up');
  if (/pick up|grab/.test(normalized)) push('pick_up');
  if (/put down|release/.test(normalized)) push('put_down');

  const targetObject = scene.objects.props.find((item) => prompt.includes(item.name))
    || scene.objects.characters.find((item) => prompt.includes(item.name))
    || scene.objects.cameras.find((item) => prompt.includes(item.name));
  if (targetObject) {
    templates.forEach((item) => {
      if (item.id === 'point_at' || item.id === 'pick_up' || item.id === 'put_down') item.targetObjectId = targetObject.id;
    });
    notes.push(`Matched target object: ${targetObject.name}`);
  }
  const universal = deriveUniversalMotionPlan(prompt, templates);
  const mode: PoseTransitionActionPlan['mode'] = templates.length ? 'template_assist' : 'universal';
  if (!templates.length && normalized) {
    notes.push('No template matched; using universal motion planning.');
  }
  return { templates, notes, mode, universal };
}

function validateTransition(scene: Scene3DState, transition: PoseTransition) {
  const issues: string[] = [];
  const character = scene.objects.characters.find((item) => item.id === transition.characterId);
  if (!character) issues.push('Character is missing');
  if (!transition.startPose || !transition.endPose) issues.push('Start pose and end pose are required');
  if (!transition.startTransform || !transition.endTransform) issues.push('Start transform and end transform are required');
  if (!(transition.durationSec > 0)) issues.push('Duration must be greater than 0');
  if (transition.constraints.headLookAt.enabled && transition.constraints.headLookAt.targetMode === 'object') {
    const exists = scene.objects.props.some((item) => item.id === transition.constraints.headLookAt.targetObjectId)
      || scene.objects.characters.some((item) => item.id === transition.constraints.headLookAt.targetObjectId)
      || scene.objects.cameras.some((item) => item.id === transition.constraints.headLookAt.targetObjectId);
    if (!exists) issues.push('Head look target does not exist');
  }
  if (transition.constraints.handTarget.enabled && transition.constraints.handTarget.targetMode === 'object') {
    const exists = scene.objects.props.some((item) => item.id === transition.constraints.handTarget.targetObjectId)
      || scene.objects.characters.some((item) => item.id === transition.constraints.handTarget.targetObjectId)
      || scene.objects.cameras.some((item) => item.id === transition.constraints.handTarget.targetObjectId);
    if (!exists) issues.push('Hand target does not exist');
  }
  return { character, issues };
}

function findSceneObject(scene: Scene3DState, id?: string) {
  if (!id) return null;
  return scene.objects.props.find((item) => item.id === id)
    || scene.objects.characters.find((item) => item.id === id)
    || scene.objects.cameras.find((item) => item.id === id)
    || scene.objects.lights.find((item) => item.id === id)
    || null;
}

function contactPositionForObject(object: { position: Vec3; scale?: Vec3 } | null | undefined) {
  if (!object) return vec();
  const height = object.scale?.y || 0.4;
  return vec(object.position.x, object.position.y + Math.max(0.08, height * 0.5), object.position.z);
}

function groundContactPosition(transition: PoseTransition, t: number, lateral = 0, forward = 0) {
  const start = transition.startTransform?.position || vec();
  const end = transition.endTransform?.position || start;
  const base = lerpVec3(start, end, clamp01(t));
  return vec(Number((base.x + lateral).toFixed(4)), Number(start.y.toFixed(4)), Number((base.z + forward).toFixed(4)));
}

function buildContactFrames(scene: Scene3DState, transition: PoseTransition, durationSec: number): AnimationContactFrame[] {
  const frames: AnimationContactFrame[] = [];
  const pushUnique = (frame: AnimationContactFrame) => {
    const key = `${frame.kind}:${frame.limb}:${frame.targetObjectId || ''}:${frame.timeSec.toFixed(2)}`;
    if (frames.some((item) => `${item.kind}:${item.limb}:${item.targetObjectId || ''}:${item.timeSec.toFixed(2)}` === key)) return;
    frames.push(frame);
  };
  for (const template of transition.actionPlan.templates) {
    const target = findSceneObject(scene, template.targetObjectId || transition.constraints.handTarget.targetObjectId);
    const hand = template.hand || transition.constraints.handTarget.hand || 'right';
    const limb = hand === 'left' ? 'leftHand' : 'rightHand';
    const targetPosition = contactPositionForObject(target);
    if (template.id === 'point_at') {
      pushUnique({
        timeSec: Number((durationSec * 0.55).toFixed(3)),
        kind: 'reach',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? 'Left hand' : 'Right hand'} points at target`
      });
    }
    if (template.id === 'pick_up') {
      pushUnique({
        timeSec: Number((durationSec * 0.38).toFixed(3)),
        kind: 'reach',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? 'Left hand' : 'Right hand'} reaches to pick up object`
      });
      pushUnique({
        timeSec: Number((durationSec * 0.55).toFixed(3)),
        kind: 'grasp',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? 'Left hand' : 'Right hand'} grasps object`
      });
    }
    if (template.id === 'put_down') {
      pushUnique({
        timeSec: 0,
        kind: 'grasp',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? 'Left hand' : 'Right hand'} holds object at start`
      });
      pushUnique({
        timeSec: Number((durationSec * 0.45).toFixed(3)),
        kind: 'reach',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? 'Left hand' : 'Right hand'} moves object toward target`
      });
      pushUnique({
        timeSec: Number((durationSec * 0.78).toFixed(3)),
        kind: 'release',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? 'Left hand' : 'Right hand'} releases object`
      });
    }
  }
  const universal = transition.actionPlan.universal;
  if (universal) {
    const families = universal.families?.length ? universal.families : deriveMotionFamiliesFromText(transition.actionPrompt, universal);
    const contacts = new Set(universal.contacts || []);
    const hasFamily = (family: UniversalMotionFamily) => families.includes(family);
    const pushSupport = (timeRatio: number, limb: AnimationContactFrame['limb'], note: string, lateral = 0, forward = 0) => {
      pushUnique({
        timeSec: Number((durationSec * timeRatio).toFixed(3)),
        kind: 'foot_lock',
        limb,
        position: groundContactPosition(transition, timeRatio, lateral, forward),
        note
      });
    };
    if (hasFamily('roll') || hasFamily('fall')) {
      pushSupport(0.24, 'leftHand', 'left hand ground support', -0.22, -0.08);
      pushSupport(0.34, 'rightHand', 'right hand ground support', 0.22, -0.08);
      pushSupport(0.52, 'leftFoot', 'left foot roll brace', -0.14, 0.18);
      pushSupport(0.64, 'rightFoot', 'right foot roll brace', 0.14, 0.18);
    }
    if (hasFamily('get_up')) {
      pushSupport(0.18, 'leftHand', 'left hand push from ground', -0.2, 0);
      pushSupport(0.28, 'rightHand', 'right hand push from ground', 0.2, 0);
      pushSupport(0.58, 'leftFoot', 'left foot recovery plant', -0.13, 0.12);
      pushSupport(0.72, 'rightFoot', 'right foot recovery plant', 0.13, 0.16);
    }
    if (hasFamily('crawl') || contacts.has('hands')) {
      pushSupport(0.18, 'leftHand', 'left hand crawl contact', -0.22, -0.18);
      pushSupport(0.38, 'rightHand', 'right hand crawl contact', 0.22, -0.08);
      pushSupport(0.58, 'leftHand', 'left hand crawl contact', -0.22, 0.05);
      pushSupport(0.78, 'rightHand', 'right hand crawl contact', 0.22, 0.15);
    }
    if (hasFamily('kneel') || contacts.has('leftFoot') || contacts.has('rightFoot') || contacts.has('feet') || contacts.has('hip') || contacts.has('shoulder')) {
      pushSupport(0.3, 'leftFoot', 'left foot support contact', -0.14, 0.06);
      pushSupport(0.3, 'rightFoot', 'right foot support contact', 0.14, 0.06);
    }
  }
  if (transition.constraints.footLock.enabled) {
    const start = transition.startTransform?.position || vec();
    if (transition.constraints.footLock.left) {
      pushUnique({
        timeSec: 0,
        kind: 'foot_lock',
        limb: 'leftFoot',
        position: vec(start.x - 0.12, start.y, start.z),
        note: 'Left foot contact phase'
      });
    }
    if (transition.constraints.footLock.right) {
      pushUnique({
        timeSec: 0,
        kind: 'foot_lock',
        limb: 'rightFoot',
        position: vec(start.x + 0.12, start.y, start.z),
        note: 'Right foot contact phase'
      });
    }
  }
  return frames.sort((a, b) => a.timeSec - b.timeSec);
}

function buildThreeAnimationClip(characterId: string, clip: SerializedAnimationClip) {
  const tracks = clip.tracks.map((track) => {
    if (track.kind === 'vector') return new THREE.VectorKeyframeTrack(track.name, track.times, track.values);
    return new THREE.QuaternionKeyframeTrack(track.name, track.times, track.values);
  });
  return new THREE.AnimationClip(`${characterId}_pose_transition`, clip.durationSec, tracks);
}

function createSerializedClip(
  transition: PoseTransition,
  samples: AnimationClipSample[],
  contacts: AnimationContactFrame[] = [],
  profile?: Scene3DJointAxisProfile
) {
  const tracks: SerializedAnimationTrack[] = [];
  const times = samples.map((sample) => Number(sample.timeSec.toFixed(4)));
  tracks.push({
    name: 'root.position',
    kind: 'vector',
    times,
    values: samples.flatMap((sample) => [
      Number(sample.transform.position.x.toFixed(5)),
      Number(sample.transform.position.y.toFixed(5)),
      Number(sample.transform.position.z.toFixed(5))
    ])
  });
  tracks.push({
    name: 'root.rotation',
    kind: 'quaternion',
    times,
    values: samples.flatMap((sample) => {
      const q = vecToQuaternion(sample.transform.rotation);
      return [q.x, q.y, q.z, q.w].map((value) => Number(value.toFixed(6)));
    })
  });
  for (const key of POSE_KEYS) {
    tracks.push({
      name: `bones.${key}`,
      kind: 'quaternion',
      times,
      values: samples.flatMap((sample) => {
        const q = vecToQuaternion(sample.pose[key]);
        return [q.x, q.y, q.z, q.w].map((value) => Number(value.toFixed(6)));
      })
    });
  }
  const clip: SerializedAnimationClip = {
    name: transition.name,
    durationSec: Number(transition.durationSec.toFixed(4)),
    sampleRate: 24,
    rigProfile: profile
      ? {
          rigId: profile.rigId,
          version: profile.version,
          rotationOrder: profile.rotationOrder,
          applicationMode: profile.applicationMode
        }
      : undefined,
    tracks,
    samples,
    contacts
  };
  buildThreeAnimationClip(transition.characterId, clip);
  return clip;
}

function jointAxisProfileFromClip(clip?: SerializedAnimationClip): Scene3DJointAxisProfile | undefined {
  if (!clip?.rigProfile) return undefined;
  return {
    ...defaultJointAxisProfile(),
    rigId: clip.rigProfile.rigId,
    version: clip.rigProfile.version,
    rotationOrder: clip.rigProfile.rotationOrder,
    applicationMode: clip.rigProfile.applicationMode
  };
}

function sampleBetween(a: AnimationClipSample, b: AnimationClipSample, timeSec: number): AnimationClipSample {
  const span = Math.max(0.0001, b.timeSec - a.timeSec);
  const t = Math.min(Math.max((timeSec - a.timeSec) / span, 0), 1);
  const libTvJointAngles = a.libTvJointAngles && b.libTvJointAngles
    ? interpolateLibTvJointAngles(a.libTvJointAngles, b.libTvJointAngles, t)
    : undefined;
  const pose = clonePose(a.pose);
  for (const key of POSE_KEYS) pose[key] = slerpRotation(a.pose[key], b.pose[key], t);
  const startQ = vecToQuaternion(a.transform.rotation);
  const endQ = vecToQuaternion(b.transform.rotation);
  const rotation = quatToRotation(startQ.slerp(endQ, t));
  return {
    timeSec,
    transform: {
      position: lerpVec3(a.transform.position, b.transform.position, t),
      rotation,
      scale: lerpVec3(a.transform.scale, b.transform.scale, t)
    },
    pose,
    bonePose: lerpBonePose(a.bonePose, b.bonePose, t),
    fingerPose: a.fingerPose && b.fingerPose ? lerpFingerPose(a.fingerPose, b.fingerPose, t) : cloneFingerPose(a.fingerPose),
    toePose: a.toePose && b.toePose ? lerpToePose(a.toePose, b.toePose, t) : cloneToePose(a.toePose),
    libTvJointAngles
  };
}

function sampleClipAtTime(clip: SerializedAnimationClip | undefined, timeSec: number) {
  if (!clip || !clip.samples.length) return null;
  if (timeSec <= 0) return clip.samples[0];
  if (timeSec >= clip.durationSec) return clip.samples[clip.samples.length - 1];
  for (let index = 0; index < clip.samples.length - 1; index += 1) {
    const current = clip.samples[index];
    const next = clip.samples[index + 1];
    if (timeSec >= current.timeSec && timeSec <= next.timeSec) return sampleBetween(current, next, timeSec);
  }
  return clip.samples[clip.samples.length - 1];
}

function vecDistance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function rotationDelta(a: Vec3, b: Vec3) {
  return deg(vecToQuaternion(a).angleTo(vecToQuaternion(b)));
}

function poseJointDelta(a: RigRotation, b: RigRotation) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

function inspectMotionQuality(transition: PoseTransition, clip: SerializedAnimationClip): MotionQualityReport {
  const issues: MotionQualityIssue[] = [];
  const samples = clip.samples;
  const start = samples[0];
  const end = samples[samples.length - 1];
  let maxStepDistance = 0;
  let maxRootRotationDelta = 0;
  let lockedFootChanges = 0;
  const pushIssue = (issue: Omit<MotionQualityIssue, 'id'>) => {
    issues.push({ id: createId('quality'), ...issue });
  };

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const stepDistance = vecDistance(previous.transform.position, current.transform.position);
    const rootTurn = rotationDelta(previous.transform.rotation, current.transform.rotation);
    maxStepDistance = Math.max(maxStepDistance, stepDistance);
    maxRootRotationDelta = Math.max(maxRootRotationDelta, rootTurn);
    if (stepDistance > 0.18) {
      pushIssue({
        severity: stepDistance > 0.32 ? 'error' : 'warning',
        metric: 'speed',
        message: 'Root position deviates from the expected path too much',
        timeSec: current.timeSec,
        value: Number(stepDistance.toFixed(4))
      });
    }
    if (rootTurn > 32) {
      pushIssue({
        severity: rootTurn > 58 ? 'error' : 'warning',
        metric: 'rotation',
        message: 'Root rotation deviates from the expected heading too much',
        timeSec: current.timeSec,
        value: Number(rootTurn.toFixed(2))
      });
    }
  }

  const startPositionDrift = transition.startTransform ? vecDistance(start.transform.position, transition.startTransform.position) : 0;
  const endPositionDrift = transition.endTransform ? vecDistance(end.transform.position, transition.endTransform.position) : 0;
  if (startPositionDrift > 0.01) {
    pushIssue({
      severity: 'error',
      metric: 'endpoint',
      message: 'Motion intent did not match the generated root position',
      timeSec: 0,
      value: Number(startPositionDrift.toFixed(4))
    });
  }
  if (endPositionDrift > 0.01) {
    pushIssue({
      severity: 'error',
      metric: 'endpoint',
      message: 'Motion intent did not match the generated contact plan',
      timeSec: clip.durationSec,
      value: Number(endPositionDrift.toFixed(4))
    });
  }

  if (transition.constraints.footLock.enabled) {
    for (const limb of ['left', 'right'] as const) {
      const poseKey: PoseJointKey = limb === 'left' ? 'leftFoot' : 'rightFoot';
      if (!transition.constraints.footLock[limb]) continue;
      let lockReference: RigRotation | null = null;
      let wasLocked = false;
      for (const sample of samples) {
        const t = clip.durationSec > 0 ? sample.timeSec / clip.durationSec : 0;
        const isLocked = footLockPhaseActive(transition, limb, t);
        if (!isLocked) {
          lockReference = null;
          wasLocked = false;
          continue;
        }
        if (!wasLocked || !lockReference) {
          lockReference = { ...sample.pose[poseKey] };
          wasLocked = true;
          continue;
        }
        const delta = poseJointDelta(sample.pose[poseKey], lockReference);
        if (delta > 8) {
          lockedFootChanges += 1;
          if (lockedFootChanges <= 4) {
            pushIssue({
              severity: delta > 18 ? 'error' : 'warning',
              metric: 'foot_lock',
              message: `${limb === 'left' ? 'Left foot' : 'Right foot'} contact drifts too far from ground`,
              timeSec: sample.timeSec,
              value: Number(delta.toFixed(2))
            });
          }
        }
      }
    }
  }

  const families = universalMotionFamilies(transition.actionPlan.universal, transition.actionPrompt);
  const expectsContact = families.some((family) => ['roll', 'fall', 'get_up', 'crawl', 'kneel', 'carry', 'reach'].includes(family))
    || transition.constraints.handTarget.enabled
    || transition.actionPlan.templates.some((item) => item.id === 'pick_up' || item.id === 'put_down' || item.id === 'point_at');
  if (expectsContact && clip.contacts.length === 0) {
    pushIssue({
      severity: 'warning',
      metric: 'contact',
      message: 'Expected contact frames are missing',
    });
  }

  const issueWeight = issues.reduce((total, issue) => total + (issue.severity === 'error' ? 24 : issue.severity === 'warning' ? 10 : 3), 0);
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    score: Math.max(0, Math.min(100, 100 - issueWeight)),
    issues: issues.slice(0, 24),
    metrics: {
      maxStepDistance: Number(maxStepDistance.toFixed(4)),
      maxRootRotationDelta: Number(maxRootRotationDelta.toFixed(2)),
      startPositionDrift: Number(startPositionDrift.toFixed(4)),
      endPositionDrift: Number(endPositionDrift.toFixed(4)),
      lockedFootChanges,
      contactCount: clip.contacts.length
    }
  };
}

const UPPER_BODY_JOINTS: PoseJointKey[] = [
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand'
];

const LOWER_BODY_JOINTS: PoseJointKey[] = [
  'pelvis',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot'
];

function applyRegenerateLockScope(transition: PoseTransition, clip: SerializedAnimationClip): SerializedAnimationClip {
  const scope = transition.regenerateLockScope || 'none';
  if (scope === 'none') return clip;
  const lockedSource = transition.animationClip;
  const contacts = scope === 'contacts' && lockedSource ? lockedSource.contacts : clip.contacts;
  const samples = clip.samples.map((sample) => {
    const sourceSample = lockedSource ? sampleClipAtTime(lockedSource, sample.timeSec) : null;
    const next: AnimationClipSample = {
      ...sample,
      transform: {
        position: { ...sample.transform.position },
        rotation: { ...sample.transform.rotation },
        scale: { ...sample.transform.scale }
      },
      pose: clonePose(sample.pose),
      bonePose: cloneBonePose(sample.bonePose),
      fingerPose: cloneFingerPose(sample.fingerPose),
      toePose: cloneToePose(sample.toePose),
      libTvJointAngles: cloneLibTvJointAngles(sample.libTvJointAngles)
    };
    if (scope === 'rootPosition') {
      next.transform.position = sourceSample?.transform.position
        ? { ...sourceSample.transform.position }
        : lerpVec3(transition.startTransform?.position || sample.transform.position, transition.endTransform?.position || sample.transform.position, clamp01(sample.timeSec / Math.max(0.0001, clip.durationSec)));
    }
    if (scope === 'rootRotation') {
      next.transform.rotation = sourceSample?.transform.rotation
        ? { ...sourceSample.transform.rotation }
        : { ...sample.transform.rotation };
    }
    if (scope === 'upperBody' || scope === 'lowerBody') {
      const joints = scope === 'upperBody' ? UPPER_BODY_JOINTS : LOWER_BODY_JOINTS;
      const sourcePose = sourceSample?.pose || sample.pose;
      joints.forEach((joint) => {
        next.pose[joint] = { ...sourcePose[joint] };
      });
    }
    return next;
  });
  return createSerializedClip(transition, samples, contacts, jointAxisProfileFromClip(clip) || jointAxisProfileFromClip(transition.animationClip));
}

type MotionQualityFixKind = 'foot_lock' | 'smooth_position' | 'smooth_rotation' | 'snap_endpoints' | 'resample_timeline' | 'auto';
type MotionQualityAtomicFixKind = Exclude<MotionQualityFixKind, 'auto'>;
type MotionQualityAutoFixResult = {
  transition: PoseTransition;
  summary: string;
};

function smoothVec3Samples(samples: AnimationClipSample[], read: (sample: AnimationClipSample) => Vec3, write: (sample: AnimationClipSample, value: Vec3) => void) {
  if (samples.length <= 2) return;
  const source = samples.map((sample) => ({ ...read(sample) }));
  for (let index = 1; index < samples.length - 1; index += 1) {
    write(samples[index], vec(
      (source[index - 1].x + source[index].x * 2 + source[index + 1].x) / 4,
      (source[index - 1].y + source[index].y * 2 + source[index + 1].y) / 4,
      (source[index - 1].z + source[index].z * 2 + source[index + 1].z) / 4
    ));
  }
}

function closestEquivalentAngle(reference: number, value: number) {
  let next = value;
  while (next - reference > 180) next -= 360;
  while (next - reference < -180) next += 360;
  return next;
}

function unwrapSampleRotations(samples: AnimationClipSample[]) {
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1].transform.rotation;
    const current = samples[index].transform.rotation;
    samples[index].transform.rotation = {
      x: closestEquivalentAngle(previous.x, current.x),
      y: closestEquivalentAngle(previous.y, current.y),
      z: closestEquivalentAngle(previous.z, current.z)
    };
  }
}

function cloneClipSamples(samples: AnimationClipSample[]) {
  return samples.map((sample) => ({
    ...sample,
    transform: {
      position: { ...sample.transform.position },
      rotation: { ...sample.transform.rotation },
      scale: { ...sample.transform.scale }
    },
    pose: clonePose(sample.pose),
    bonePose: cloneBonePose(sample.bonePose),
    fingerPose: cloneFingerPose(sample.fingerPose),
    toePose: cloneToePose(sample.toePose),
    libTvJointAngles: cloneLibTvJointAngles(sample.libTvJointAngles)
  }));
}

function resampleClipSamples(clip: SerializedAnimationClip, sampleRate = 72) {
  const duration = Math.max(0.0001, clip.durationSec);
  const sampleCount = Math.max(clip.samples.length - 1, Math.round(duration * sampleRate));
  const samples: AnimationClipSample[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const timeSec = Number(((index / sampleCount) * duration).toFixed(4));
    const sample = sampleClipAtTime(clip, timeSec);
    if (sample) samples.push(sample);
  }
  if (samples.length > 0) {
    samples[0] = cloneClipSamples([clip.samples[0]])[0];
    samples[samples.length - 1] = cloneClipSamples([clip.samples[clip.samples.length - 1]])[0];
  }
  unwrapSampleRotations(samples);
  return samples;
}

function qualityIssueCount(report?: MotionQualityReport) {
  return report?.issues.filter((issue) => issue.severity !== 'info').length || 0;
}

function qualityPenalty(report?: MotionQualityReport) {
  if (!report) return Number.POSITIVE_INFINITY;
  return (
    qualityIssueCount(report) * 1000 +
    Math.max(0, report.metrics.maxStepDistance - 0.18) * 100 +
    Math.max(0, report.metrics.maxRootRotationDelta - 32) * 3 +
    Math.max(0, report.metrics.startPositionDrift - 0.01) * 250 +
    Math.max(0, report.metrics.endPositionDrift - 0.01) * 250 +
    report.metrics.lockedFootChanges * 25 -
    report.score
  );
}

function isBetterQuality(before?: MotionQualityReport, after?: MotionQualityReport) {
  if (!after) return false;
  if (!before) return true;
  return qualityPenalty(after) < qualityPenalty(before) - 0.001;
}

function uniqueQualityMessages(report?: MotionQualityReport) {
  return Array.from(new Set(report?.issues.map((issue) => issue.message) || []));
}

function finalizeMotionQualityFix(
  transition: PoseTransition,
  samples: AnimationClipSample[],
  contacts: AnimationContactFrame[]
): PoseTransition {
  const animationClip = createSerializedClip(transition, samples, contacts, jointAxisProfileFromClip(transition.animationClip));
  const qualityReport = inspectMotionQuality(transition, animationClip);
  const qualityMessages = new Set([
    ...(transition.qualityReport?.issues || []).map((issue) => issue.message),
    ...qualityReport.issues.map((issue) => issue.message)
  ]);
  const warnings = [
    ...transition.warnings.filter((warning) => !qualityMessages.has(warning)),
    ...qualityReport.issues.filter((issue) => issue.severity !== 'info').map((issue) => issue.message)
  ].filter((warning, index, source) => source.indexOf(warning) === index);
  return {
    ...transition,
    animationClip,
    qualityReport,
    warnings,
    error: undefined,
    updatedAt: new Date().toISOString()
  };
}

function applyMotionQualityFix(transition: PoseTransition, fixKind: MotionQualityFixKind): PoseTransition {
  if (fixKind === 'auto') return applyMotionQualityAutoFix(transition).transition;
  const clip = transition.animationClip;
  if (!clip) return transition;
  let samples: AnimationClipSample[] = cloneClipSamples(clip.samples);

  if (fixKind === 'foot_lock') {
    for (const limb of ['left', 'right'] as const) {
      const poseKey: PoseJointKey = limb === 'left' ? 'leftFoot' : 'rightFoot';
      let lockReference: RigRotation | null = null;
      let wasLocked = false;
      for (const sample of samples) {
        const t = clip.durationSec > 0 ? sample.timeSec / clip.durationSec : 0;
        const isLocked = transition.constraints.footLock.enabled && transition.constraints.footLock[limb] && footLockPhaseActive(transition, limb, t);
        if (!isLocked) {
          lockReference = null;
          wasLocked = false;
          continue;
        }
        if (!wasLocked || !lockReference) {
          lockReference = { ...sample.pose[poseKey] };
          wasLocked = true;
        }
        sample.pose[poseKey] = { ...lockReference };
      }
    }
  }

  if (fixKind === 'smooth_position') {
    smoothVec3Samples(samples, (sample) => sample.transform.position, (sample, value) => {
      sample.transform.position = value;
    });
  }

  if (fixKind === 'smooth_rotation') {
    smoothVec3Samples(samples, (sample) => sample.transform.rotation, (sample, value) => {
      sample.transform.rotation = value;
    });
    unwrapSampleRotations(samples);
  }

  if (fixKind === 'resample_timeline') {
    samples = resampleClipSamples(clip);
  }

  if (fixKind === 'snap_endpoints' || fixKind === 'smooth_position' || fixKind === 'smooth_rotation' || fixKind === 'resample_timeline') {
    if (transition.startTransform) {
      samples[0].transform = normalizeTransform(transition.startTransform, samples[0].transform);
    }
    if (transition.endTransform) {
      samples[samples.length - 1].transform = normalizeTransform(transition.endTransform, samples[samples.length - 1].transform);
    }
    if (transition.startPose) samples[0].pose = clonePose(transition.startPose);
    if (transition.endPose) samples[samples.length - 1].pose = clonePose(transition.endPose);
    samples[0].bonePose = cloneBonePose(transition.startBonePose || samples[0].bonePose);
    samples[samples.length - 1].bonePose = cloneBonePose(transition.endBonePose || samples[samples.length - 1].bonePose);
    samples[0].fingerPose = cloneFingerPose(transition.startFingerPose || samples[0].fingerPose);
    samples[samples.length - 1].fingerPose = cloneFingerPose(transition.endFingerPose || samples[samples.length - 1].fingerPose);
    samples[0].toePose = cloneToePose(transition.startToePose || samples[0].toePose);
    samples[samples.length - 1].toePose = cloneToePose(transition.endToePose || samples[samples.length - 1].toePose);
    samples[0].libTvJointAngles = cloneLibTvJointAngles(transition.startLibTvJointAngles);
    samples[samples.length - 1].libTvJointAngles = cloneLibTvJointAngles(transition.endLibTvJointAngles);
    unwrapSampleRotations(samples);
  }

  return finalizeMotionQualityFix(transition, samples, clip.contacts);
}

function pickAutoFixKinds(report: MotionQualityReport): MotionQualityAtomicFixKind[] {
  const kinds: MotionQualityAtomicFixKind[] = [];
  const push = (kind: MotionQualityAtomicFixKind) => {
    if (!kinds.includes(kind)) kinds.push(kind);
  };
  if (report.metrics.startPositionDrift > 0.01 || report.metrics.endPositionDrift > 0.01) push('snap_endpoints');
  if (report.metrics.lockedFootChanges > 0) push('foot_lock');
  if (report.metrics.maxStepDistance > 0.18 || report.metrics.maxRootRotationDelta > 32) push('resample_timeline');
  if (report.metrics.maxStepDistance > 0.18) push('smooth_position');
  if (report.metrics.maxRootRotationDelta > 32) push('smooth_rotation');
  return kinds;
}

function applyMotionQualityAutoFix(transition: PoseTransition): MotionQualityAutoFixResult {
  const beforeReport = transition.qualityReport;
  let current = transition;
  const applied: MotionQualityAtomicFixKind[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    const report = current.qualityReport;
    if (!report || qualityIssueCount(report) === 0) break;
    let improvedThisPass = false;
    for (const kind of pickAutoFixKinds(report)) {
      const candidate = applyMotionQualityFix(current, kind);
      if (isBetterQuality(current.qualityReport, candidate.qualityReport)) {
        current = candidate;
        applied.push(kind);
        improvedThisPass = true;
      }
    }
    if (!improvedThisPass) break;
  }
  const beforeCount = qualityIssueCount(beforeReport);
  const afterCount = qualityIssueCount(current.qualityReport);
  const beforeScore = Math.round(beforeReport?.score || 0);
  const afterScore = Math.round(current.qualityReport?.score || 0);
  const summary = applied.length
    ? `Applied ${applied.length} fixes; issues ${beforeCount} -> ${afterCount}; score ${beforeScore} -> ${afterScore}`
    : 'No automatic quality fixes were applied';
  return { transition: current, summary };
}

function propBaseTransform(prop: PropObject): PoseTransform {
  return {
    position: { ...prop.position },
    rotation: { ...prop.rotation },
    scale: { ...prop.scale }
  };
}

function propGripOffset(prop: PropObject) {
  return vec(0, Math.max(0.03, (prop.scale.y || 0.4) * 0.22), 0);
}

function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

function scaleLocalPoint(point: THREE.Vector3, scale: Vec3) {
  return new THREE.Vector3(point.x * scale.x, point.y * scale.y, point.z * scale.z);
}

function approximateHandWorldPosition(sample: AnimationClipSample, limb: AnimationContactFrame['limb']) {
  const side = limb === 'leftHand' ? -1 : 1;
  const upperKey: PoseJointKey = limb === 'leftHand' ? 'leftUpperArm' : 'rightUpperArm';
  const lowerKey: PoseJointKey = limb === 'leftHand' ? 'leftLowerArm' : 'rightLowerArm';
  const handKey: PoseJointKey = limb === 'leftHand' ? 'leftHand' : 'rightHand';
  const rootRotation = vecToQuaternion(sample.transform.rotation);
  const shoulder = new THREE.Vector3(side * 0.26, 1.34, 0.02);
  const upperQ = vecToQuaternion(sample.pose[upperKey]);
  const lowerQ = upperQ.clone().multiply(vecToQuaternion(sample.pose[lowerKey]));
  const handQ = lowerQ.clone().multiply(vecToQuaternion(sample.pose[handKey]));
  const upper = new THREE.Vector3(side * 0.04, -0.34, -0.02).applyQuaternion(upperQ);
  const lower = new THREE.Vector3(side * 0.03, -0.31, -0.01).applyQuaternion(lowerQ);
  const palm = new THREE.Vector3(side * 0.045, -0.075, -0.02).applyQuaternion(handQ);
  const local = scaleLocalPoint(shoulder.add(upper).add(lower).add(palm), sample.transform.scale);
  const world = local.applyQuaternion(rootRotation).add(new THREE.Vector3(
    sample.transform.position.x,
    sample.transform.position.y,
    sample.transform.position.z
  ));
  return vec(Number(world.x.toFixed(4)), Number(world.y.toFixed(4)), Number(world.z.toFixed(4)));
}

function latestContactBefore(contacts: AnimationContactFrame[], propId: string, timeSec: number, kind: AnimationContactFrame['kind']) {
  return contacts
    .filter((contact) => contact.targetObjectId === propId && contact.kind === kind && contact.timeSec <= timeSec)
    .sort((a, b) => b.timeSec - a.timeSec)[0];
}

function propPreviewTransform(
  prop: PropObject,
  transition: PoseTransition | null,
  sample: AnimationClipSample | null
): PoseTransform {
  const base = propBaseTransform(prop);
  const contacts = transition?.animationClip?.contacts || [];
  if (!transition || !sample || !contacts.length) return base;
  const timeSec = sample.timeSec;
  const grasp = latestContactBefore(contacts, prop.id, timeSec, 'grasp');
  if (!grasp) return base;
  const release = latestContactBefore(contacts, prop.id, timeSec, 'release');
  const offset = propGripOffset(prop);
  if (release && release.timeSec >= grasp.timeSec) {
    return {
      ...base,
      position: subtractVec3(release.position, offset)
    };
  }
  if (grasp.limb !== 'leftHand' && grasp.limb !== 'rightHand') return base;
  const handPosition = approximateHandWorldPosition(sample, grasp.limb);
  return {
    ...base,
    position: subtractVec3(handPosition, offset),
    rotation: {
      x: Number((prop.rotation.x + sample.transform.rotation.x * 0.2).toFixed(3)),
      y: Number((prop.rotation.y + sample.transform.rotation.y).toFixed(3)),
      z: Number((prop.rotation.z + sample.transform.rotation.z * 0.2).toFixed(3))
    }
  };
}

function buildPreviewPropTransforms(
  scene: Scene3DState,
  transition: PoseTransition | null,
  sample: AnimationClipSample | null
) {
  return scene.objects.props.reduce<Record<string, PoseTransform>>((acc, prop) => {
    const next = propPreviewTransform(prop, transition, sample);
    if (
      next.position.x !== prop.position.x ||
      next.position.y !== prop.position.y ||
      next.position.z !== prop.position.z ||
      next.rotation.x !== prop.rotation.x ||
      next.rotation.y !== prop.rotation.y ||
      next.rotation.z !== prop.rotation.z
    ) {
      acc[prop.id] = next;
    }
    return acc;
  }, {});
}

function applyPreviewFrameToScene(scene: Scene3DState, transitionId: string | undefined, sample: AnimationClipSample | null) {
  const transition = scene.poseTransitions.find((item) => item.id === transitionId) || null;
  if (!transition || !sample) return scene;
  const propTransforms = buildPreviewPropTransforms(scene, transition, sample);
  return normalizeScene({
    ...scene,
    objects: {
      ...scene.objects,
      characters: scene.objects.characters.map((character) => (
        character.id === transition.characterId
          ? {
              ...character,
              position: sample.transform.position,
              rotation: sample.transform.rotation,
              scale: sample.transform.scale,
              posePreset: sample.libTvJointAngles ? 'custom' : character.posePreset,
              posePresetId: sample.libTvJointAngles ? 'custom' : character.posePresetId,
              libTvJointAngles: cloneLibTvJointAngles(sample.libTvJointAngles),
              bonePose: cloneBonePose(sample.bonePose),
              fingerPose: cloneFingerPose(sample.fingerPose),
              toePose: cloneToePose(sample.toePose),
              rigPose: sample.pose
            }
          : character
      )),
      props: scene.objects.props.map((prop) => {
        const transform = propTransforms[prop.id];
        return transform
          ? {
              ...prop,
              position: transform.position,
              rotation: transform.rotation,
              scale: transform.scale
            }
          : prop;
      })
    }
  });
}

function generateTransition(scene: Scene3DState, transition: PoseTransition): PoseTransition {
  const jointProfile = jointAxisProfileForScene(scene);
  const warningSet = new Set(transition.actionPlan.notes);
  const { issues } = validateTransition(scene, transition);
  if (issues.length) {
    return {
      ...transition,
      animationClip: undefined,
      qualityReport: undefined,
      warnings: Array.from(warningSet),
      error: issues.join(' ')
    };
  }
  const startPose = transition.constraints.jointLimitsEnabled
    ? clampPoseWithJointProfile(clonePose(transition.startPose), jointProfile)
    : clonePose(transition.startPose);
  const endPose = transition.constraints.jointLimitsEnabled
    ? clampPoseWithJointProfile(clonePose(transition.endPose), jointProfile)
    : clonePose(transition.endPose);
  const startFingerPose = cloneFingerPose(transition.startFingerPose);
  const endFingerPose = cloneFingerPose(transition.endFingerPose);
  const startBonePose = cloneBonePose(transition.startBonePose);
  const endBonePose = cloneBonePose(transition.endBonePose);
  const startToePose = cloneToePose(transition.startToePose);
  const endToePose = cloneToePose(transition.endToePose);
  const startLibTvJointAngles = cloneLibTvJointAngles(transition.startLibTvJointAngles);
  const endLibTvJointAngles = cloneLibTvJointAngles(transition.endLibTvJointAngles);
  const startTransform = normalizeTransform(transition.startTransform);
  const endTransform = normalizeTransform(transition.endTransform);
  const sampleRate = 24;
  const durationSec = Math.max(0.1, transition.durationSec);
  const sampleCount = Math.max(3, Math.round(durationSec * sampleRate));
  const samples: AnimationClipSample[] = [];
  const contactFrames = buildContactFrames(scene, transition, durationSec);
  contactFrames.forEach((frame) => {
    if (!frame.targetObjectId && (frame.kind === 'grasp' || frame.kind === 'release' || frame.kind === 'reach')) {
      warningSet.add(`${frame.note} contact is outside the reachable range`);
    }
  });

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const eased = easeCurve(transition.curve, t);
    const libTvJointAngles = startLibTvJointAngles && endLibTvJointAngles
      ? interpolateLibTvJointAngles(startLibTvJointAngles, endLibTvJointAngles, eased)
      : undefined;
    const pose = clonePose(startPose);
    for (const key of POSE_KEYS) pose[key] = slerpRotation(startPose[key], endPose[key], eased);
    const startRotationQ = vecToQuaternion(startTransform.rotation);
    const endRotationQ = vecToQuaternion(endTransform.rotation);
    const transform: PoseTransform = {
      position: lerpVec3(startTransform.position, endTransform.position, eased),
      rotation: quatToRotation(startRotationQ.slerp(endRotationQ, eased)),
      scale: lerpVec3(startTransform.scale, endTransform.scale, eased)
    };
    let nextPose = pose;
    nextPose = applyUniversalMotionOverlay(nextPose, transform, transition.actionPlan.universal, t, jointProfile);
    for (const template of transition.actionPlan.templates) nextPose = applyTemplateOverlay(nextPose, transform, template, t, jointProfile);
    const targets = targetPositionForConstraint(scene, transition, transform);
    if (transition.constraints.headLookAt.enabled) nextPose = applyHeadLookAt(nextPose, targets.headTarget, targets.origin);
    const hasTemplateHandTarget = transition.actionPlan.templates.some((item) => (
      item.id === 'point_at' || item.id === 'pick_up' || item.id === 'put_down'
    ));
    if (transition.constraints.handTarget.enabled || hasTemplateHandTarget) {
      const solved = solveArmIkToTarget(nextPose, targets.hand, targets.handTarget, targets.origin);
      nextPose = solved.pose;
      if (solved.warning) warningSet.add(solved.warning);
    }
    if (transition.constraints.footLock.enabled) {
      if (footLockPhaseActive(transition, 'left', t)) {
        nextPose.leftFoot = { ...startPose.leftFoot };
      }
      if (footLockPhaseActive(transition, 'right', t)) {
        nextPose.rightFoot = { ...startPose.rightFoot };
      }
    }
    if (transition.constraints.jointLimitsEnabled) nextPose = clampPoseWithJointProfile(nextPose, jointProfile);
    const baseSample: AnimationClipSample = {
      timeSec: Number((t * durationSec).toFixed(4)),
      transform: {
        position: {
          x: Number(transform.position.x.toFixed(4)),
          y: Number(transform.position.y.toFixed(4)),
          z: Number(transform.position.z.toFixed(4))
        },
        rotation: {
          x: Number(transform.rotation.x.toFixed(4)),
          y: Number(transform.rotation.y.toFixed(4)),
          z: Number(transform.rotation.z.toFixed(4))
        },
        scale: {
          x: Number(transform.scale.x.toFixed(4)),
          y: Number(transform.scale.y.toFixed(4)),
          z: Number(transform.scale.z.toFixed(4))
        }
      },
      pose: nextPose,
      bonePose: lerpBonePose(startBonePose, endBonePose, eased),
      fingerPose: lerpFingerPose(startFingerPose, endFingerPose, eased),
      toePose: lerpToePose(startToePose, endToePose, eased),
      libTvJointAngles
    };
    samples.push(baseSample);
  }

  samples[0] = {
    timeSec: 0,
    transform: startTransform,
    pose: startPose,
    bonePose: startBonePose,
    fingerPose: startFingerPose,
    toePose: startToePose,
    libTvJointAngles: startLibTvJointAngles
  };
  samples[samples.length - 1] = {
    timeSec: Number(durationSec.toFixed(4)),
    transform: endTransform,
    pose: endPose,
    bonePose: endBonePose,
    fingerPose: endFingerPose,
    toePose: endToePose,
    libTvJointAngles: endLibTvJointAngles
  };

  try {
    const animationClip = applyRegenerateLockScope(transition, createSerializedClip(transition, samples, contactFrames, jointProfile));
    const qualityReport = inspectMotionQuality(transition, animationClip);
    qualityReport.issues.forEach((issue) => {
      if (issue.severity !== 'info') warningSet.add(issue.message);
    });
    return {
      ...transition,
      animationClip,
      qualityReport,
      warnings: Array.from(warningSet),
      error: undefined,
      updatedAt: new Date().toISOString()
    };
  } catch (error: any) {
    return {
      ...transition,
      animationClip: undefined,
      qualityReport: undefined,
      warnings: Array.from(warningSet),
      error: error?.message || 'Animation generation failed',
      updatedAt: new Date().toISOString()
    };
  }
}

export function createScene3DPreviewNode(): CanvasNode {
  const scene = defaultScene();
  const character = scene.objects.characters[0];
  const now = new Date().toISOString();
  const actionPrompt = 'dash forward and turn right quickly';
  const startPose = naturalStandingPose();
  const endPose = offsetPose(naturalStandingPose(), {
    pelvis: { x: -8, y: 18, z: -8 },
    chest: { x: 12, y: -24, z: 10 },
    head: { x: -4, y: -10, z: 4 },
    leftUpperArm: { x: -18, z: 34 },
    rightUpperArm: { x: 18, z: -34 },
    leftLowerArm: { x: 42 },
    rightLowerArm: { x: 42 },
    leftUpperLeg: { x: -36, z: -10 },
    rightUpperLeg: { x: 46, z: 10 },
    leftLowerLeg: { x: 64 },
    rightLowerLeg: { x: 30 },
    leftFoot: { x: 14 },
    rightFoot: { x: -10 }
  });
  const startTransform: PoseTransform = {
    position: { ...character.position },
    rotation: { ...character.rotation },
    scale: { ...character.scale }
  };
  const endTransform: PoseTransform = {
    position: vec(character.position.x + 0.45, character.position.y, character.position.z - 1.65),
    rotation: vec(0, 132, 0),
    scale: { ...character.scale }
  };
  const transitionSeed: PoseTransition = {
    id: createId('transition_preview'),
    name: '\u52a8\u4f5c\u8d28\u91cf\u9884\u89c8\u7247\u6bb5',
    characterId: character.id,
    actionPrompt,
    actionPlan: resolveActionPlan(scene, actionPrompt),
    motionRefineHistory: [],
    regenerateLockScope: 'none',
    constraints: defaultConstraints(),
    durationSec: 0.28,
    curve: 'ease_in_out',
    startPose,
    endPose,
    startFingerPose: cloneFingerPose(character.fingerPose),
    endFingerPose: FINGER_POSE_FISTS,
    startToePose: cloneToePose(character.toePose),
    endToePose: cloneToePose(character.toePose),
    startPosePresetId: 'stand',
    endPosePresetId: 'fight',
    startLibTvJointAngles: libTvJointAnglesForPresetId('stand'),
    endLibTvJointAngles: libTvJointAnglesForPresetId('fight'),
    startTransform,
    endTransform,
    warnings: [],
    createdAt: now,
    updatedAt: now
  };
  const transition = generateTransition(scene, transitionWithPresetReferenceEndpoints(transitionSeed));
  const previewScene = normalizeScene({
    ...scene,
    selectedObjectId: character.id,
    activeTransitionId: transition.id,
    poseTransitions: [transition]
  });

  return {
    id: 'scene3d-preview-node',
    name: 'Scene3D Director',
    type: 'scene3d',
    x: 0,
    y: 0,
    status: 'draft',
    aspect_ratio: previewScene.aspectRatio,
    generated_media: '',
    scene3dState: previewScene as unknown as Record<string, any>,
    scene3dCaptures: [],
    activeCameraId: previewScene.activeCameraId,
    scene3dMotionPrompt: actionPrompt
  };
}

// Backend/API adapters used by the portable node shell.
function uploadCanvasBlob(blob: Blob) {
  const form = new FormData();
  form.append('file', new File([blob], 'scene3d-' + Date.now() + '.png', { type: 'image/png' }));
  form.append('key', 'scene3d-capture');
  return fetch('/api/media/upload', { method: 'POST', body: form }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.success || !body?.assetId || !body?.url) {
      throw new Error(body?.error || 'Screenshot upload failed');
    }
    return { assetId: String(body.assetId), url: String(body.url) };
  });
}

function parseAspectRatio(value: string) {
  const parts = String(value || '').split(':').map((part) => Number(part));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || parts[0] <= 0 || parts[1] <= 0) {
    return 16 / 9;
  }
  return parts[0] / parts[1];
}

async function canvasToAspectBlob(sourceCanvas: HTMLCanvasElement, aspectRatio: string) {
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  if (!sourceWidth || !sourceHeight) throw new Error('WebGL canvas is empty; cannot capture screenshot');
  const targetRatio = parseAspectRatio(aspectRatio);
  const sourceRatio = sourceWidth / sourceHeight;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (sourceRatio > targetRatio) {
    sw = Math.max(1, Math.round(sourceHeight * targetRatio));
    sx = Math.round((sourceWidth - sw) / 2);
  } else if (sourceRatio < targetRatio) {
    sh = Math.max(1, Math.round(sourceWidth / targetRatio));
    sy = Math.round((sourceHeight - sh) / 2);
  }
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = sw;
  outputCanvas.height = sh;
  const context = outputCanvas.getContext('2d');
  if (!context) throw new Error('Cannot create 2D canvas context for screenshot export');
  context.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob((nextBlob) => (nextBlob ? resolve(nextBlob) : reject(new Error('Failed to export cropped screenshot'))), 'image/png');
  });
  return { blob, width: sw, height: sh };
}

async function captureSceneCanvas({
  renderer,
  scene,
  onPatch,
  onCreateImageNode,
  onError
}: {
  renderer: THREE.WebGLRenderer | null;
  scene: Scene3DState;
  onPatch: SceneChangeHandler;
  onCreateImageNode?: (result: Scene3DCaptureResult) => void;
  onError: (message: string) => void;
}) {
  if (!renderer) {
    onError('WebGL renderer is unavailable; cannot capture screenshot');
    return;
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const canvas = renderer.domElement;
  const cropped = await canvasToAspectBlob(canvas, scene.aspectRatio);
  const uploaded = await uploadCanvasBlob(cropped.blob);
  const activeCamera = scene.objects.cameras.find((camera) => camera.id === scene.activeCameraId) || scene.objects.cameras[0];
  const nextCapture: Capture = {
    id: createId('cap'),
    name: 'Screenshot ' + (scene.captures.length + 1),
    type: scene.activeViewMode === 'camera' ? 'camera_view_capture' : 'director_view_capture',
    mediaUrl: uploaded.url,
    mediaAssetId: uploaded.assetId,
    width: cropped.width,
    height: cropped.height,
    cameraId: activeCamera?.id,
    cameraName: activeCamera?.name,
    fov: activeCamera?.fov || 45,
    cameraPosition: activeCamera?.position || vec(),
    targetPosition: activeCamera?.targetPosition || vec(),
    aspectRatio: scene.aspectRatio,
    createdAt: new Date().toISOString()
  };
  const nextScene = normalizeScene({
    ...scene,
    captures: [...scene.captures, nextCapture],
    objects: {
      ...scene.objects,
      cameras: scene.objects.cameras.map((camera) => (
        camera.id === nextCapture.cameraId
          ? { ...camera, captures: [...camera.captures, nextCapture] }
          : camera
      ))
    }
  });
  onPatch(nextScene, { label: 'Screenshot ' + (scene.captures.length + 1) });
  onCreateImageNode?.({ capture: nextCapture, scene: nextScene });
  onError('');
}

function sceneObjectSummary(scene: Scene3DState) {
  return {
    cameras: scene.objects.cameras.slice(0, 8).map((camera) => ({
      id: camera.id,
      name: camera.name,
      position: camera.position,
      targetPosition: camera.targetPosition,
      fov: camera.fov,
      lensType: camera.lensType,
      visible: camera.visible
    })),
    props: scene.objects.props.slice(0, 16).map((prop) => ({
      id: prop.id,
      name: prop.name,
      shape: prop.shape,
      position: prop.position,
      rotation: prop.rotation,
      scale: prop.scale,
      visible: prop.visible
    }))
  };
}

function buildMotionRefinePayload(input: {
  node: CanvasNode;
  scene: Scene3DState;
  transition: PoseTransition;
  character: CharacterObject;
  currentProjectId?: string | null;
}) {
  const { cameras, props } = sceneObjectSummary(input.scene);
  const referenceCapture = input.scene.captures[input.scene.captures.length - 1];
  return {
    projectId: input.currentProjectId || undefined,
    nodeId: input.node.id,
    transitionId: input.transition.id,
    selectedCharacterId: input.character.id,
    actionPrompt: input.transition.actionPrompt || 'natural motion between start and end poses',
    durationSec: input.transition.durationSec,
    curve: input.transition.curve,
    startTransform: input.transition.startTransform,
    endTransform: input.transition.endTransform,
    startPose: input.transition.startPose,
    endPose: input.transition.endPose,
    startBonePose: input.transition.startBonePose,
    endBonePose: input.transition.endBonePose,
    startFingerPose: input.transition.startFingerPose,
    endFingerPose: input.transition.endFingerPose,
    startToePose: input.transition.startToePose,
    endToePose: input.transition.endToePose,
    currentCharacterTransform: {
      position: input.character.position,
      rotation: input.character.rotation,
      scale: input.character.scale,
      bonePose: input.character.bonePose
    },
    constraints: input.transition.constraints,
    cameras,
    props,
    activeCameraId: input.scene.activeCameraId,
    activeViewMode: input.scene.activeViewMode,
    coordinateSystemDescription: 'Scene3D uses right-handed Three.js-style world coordinates: X left/right, Y up/down, Z depth. Rotations are degrees in XYZ order. Character transforms are world-space. Bone rotations are local joint rotations in degrees.',
    jointAxisProfile: {
      rigId: input.scene.jointAxisProfile?.rigId || 'mixamo-xbot',
      rotationOrder: input.scene.jointAxisProfile?.rotationOrder || 'XYZ',
      applicationMode: input.scene.jointAxisProfile?.applicationMode || 'rest_quaternion_multiply_delta',
      joints: jointAxisProfileSummary(jointAxisProfileForScene(input.scene))
    },
    motionSolverInstruction: 'Return MotionIntent only. Do not generate raw per-frame joint rotations. The frontend compiler will map intent into root trajectory, contacts, and local XYZ joint deltas using jointAxisProfile ranges and semantics.',
    referenceImageAssetId: referenceCapture?.mediaAssetId
  };
}

async function requestMotionIntent(payload: ReturnType<typeof buildMotionRefinePayload>): Promise<MotionIntent> {
  const response = await fetch('/api/workflow/scene3d/refine-motion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.motionIntent) {
    const detailMessage = body?.details?.error?.message || body?.details?.error?.code || body?.details?.error?.status;
    throw new Error([body?.error || 'AI 动作解析失败', detailMessage].filter(Boolean).join(': '));
  }
  const intent = normalizeMotionIntent(body.motionIntent, payload.durationSec);
  if (!intent) throw new Error('AI 返回结果缺少 MotionIntent');
  return intent;
}

function buildPoseReferenceSolvePayload(input: {
  node: CanvasNode;
  scene: Scene3DState;
  character: CharacterObject;
  currentProjectId?: string | null;
}) {
  const jointAxisProfile = jointAxisProfileForScene(input.scene);
  const foundationHint = poseFoundationHintForCharacter(input.character);
  const referenceImages = POSE_REFERENCE_VIEW_OPTIONS
    .map((item) => input.character.poseReferenceImages?.[item.id])
    .filter((image): image is PoseReferenceImage => Boolean(image?.assetId));
  return {
    projectId: input.currentProjectId || undefined,
    nodeId: input.node.id,
    selectedCharacterId: input.character.id,
    referenceImages: referenceImages.map((image) => ({
      view: image.view,
      assetId: image.assetId,
      fileName: image.fileName,
      mimeType: image.mimeType
    })),
    foundationPoseHint: {
      id: foundationHint.id,
      label: foundationHint.label,
      confidence: foundationHint.confidence,
      reason: foundationHint.reason,
      rootOffset: foundationHint.rootOffset,
      bonePose: foundationHint.bonePose
    },
    currentPose: input.character.rigPose,
    currentBonePose: input.character.bonePose,
    currentFingerPose: input.character.fingerPose,
    currentToePose: input.character.toePose,
    currentRootOffset: input.character.poseRootOffset || vec(),
    currentCharacterTransform: {
      position: input.character.position,
      rotation: input.character.rotation,
      scale: input.character.scale
    },
    sceneContext: input.scene,
    coordinateSystemDescription: 'Scene3D uses right-handed Three.js-style world coordinates: X left/right, Y up/down, Z depth. Rotations are degrees in local joint XYZ order.',
    jointAxisProfile: {
      rigId: jointAxisProfile.rigId,
      rotationOrder: jointAxisProfile.rotationOrder,
      applicationMode: jointAxisProfile.applicationMode,
      joints: jointAxisProfileSummary(jointAxisProfile)
    }
  };
}

async function requestPoseReferenceSolve(payload: ReturnType<typeof buildPoseReferenceSolvePayload>, profile: Scene3DJointAxisProfile): Promise<PoseReferenceSolveResult> {
  const response = await fetch('/api/workflow/scene3d/solve-pose-reference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.pose) {
    const detailMessage = body?.details?.error?.message
      || body?.details?.error?.code
      || body?.details?.error?.status
      || body?.details?.issues?.map((issue: any) => String(issue.path || 'request') + ' ' + String(issue.message || '')).join(' / ')
      || body?.code
      || 'HTTP ' + response.status;
    throw new Error([body?.error || 'Pose reference solve failed', detailMessage].filter(Boolean).join(': '));
  }
  const rawPose = body.pose as any;
  const foundationHint = normalizePoseFoundationHint(rawPose.foundationHint || rawPose.foundationPoseHint, payload.foundationPoseHint);
  const poseLandmarks = normalizePoseReferenceLandmarks(rawPose.poseLandmarks);
  const fallbackRigPose = clampPoseWithJointProfile(normalizePose(rawPose.rigPose), profile);
  const rigPose = poseLandmarks
    ? compilePoseFromLandmarks(poseLandmarks, fallbackRigPose, foundationHint, profile)
    : fallbackRigPose;
  return {
    version: 1,
    summary: typeof rawPose.summary === 'string' ? rawPose.summary : '姿势参考图解析结果',
    rigPose,
    bonePose: normalizeBonePose(rawPose.bonePose),
    rootOffset: rawPose.rootOffset ? normalizeVec(rawPose.rootOffset, vec()) : undefined,
    foundationHint,
    poseLandmarks,
    compiledFromLandmarks: Boolean(poseLandmarks),
    confidence: Number.isFinite(Number(rawPose.confidence)) ? clampNumber(Number(rawPose.confidence), 0, 1) : 0,
    warnings: Array.isArray(rawPose.warnings) ? rawPose.warnings.map((item: any) => String(item)).filter(Boolean).slice(0, 24) : [],
    appliedViews: Array.isArray(rawPose.appliedViews)
      ? rawPose.appliedViews.filter((item: any): item is PoseReferenceView => item === 'front' || item === 'side' || item === 'back')
      : []
  };
}


// React node shell: card preview, fullscreen editor, and scene state bridge.
export default function Scene3DNode({
  node,
  isSelected,
  onUpdate,
  onSelect,
  onCreateImageNode,
  currentProjectId
}: Scene3DNodeProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [cardCapturing, setCardCapturing] = useState(false);
  const cardRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const scene = useMemo(() => normalizeScene(node.scene3dState), [node.scene3dState]);
  const lastCapture = scene.captures[scene.captures.length - 1];

  const applySceneChange: SceneChangeHandler = (updater, options = {}) => {
    onUpdate((currentNode) => {
      const currentScene = normalizeScene(currentNode.scene3dState);
      const next = typeof updater === 'function'
        ? normalizeScene(updater(currentScene))
        : normalizeScene({ ...currentScene, ...updater });
      const shouldRecordHistory = options.history !== false;
      let nextWithHistory = next;
      if (shouldRecordHistory) {
          const before = options.historyBefore || createHistorySnapshot(currentScene);
          const after = createHistorySnapshot(next);
        if (!snapshotsEqual(before, after)) {
          const last = currentScene.undoStack[currentScene.undoStack.length - 1];
          const shouldMerge = Boolean(options.mergeKey && last?.mergeKey === options.mergeKey);
          const entry: Scene3DHistoryEntry = {
            id: shouldMerge ? last.id : createId('history'),
            label: options.label || 'Edit Scene',
            before: shouldMerge ? last.before : before,
            after,
            mergeKey: options.mergeKey,
            createdAt: new Date().toISOString()
          };
          const undoStack = shouldMerge
            ? [...currentScene.undoStack.slice(0, -1), entry]
            : [...currentScene.undoStack, entry].slice(-MAX_SCENE_HISTORY);
          nextWithHistory = normalizeScene({
            ...next,
            undoStack,
            redoStack: []
          });
        }
      } else if (options.preserveHistory !== false) {
        nextWithHistory = normalizeScene({
          ...next,
          undoStack: currentScene.undoStack,
          redoStack: currentScene.redoStack
        });
      }
      return {
        scene3dState: nextWithHistory as unknown as Record<string, any>,
        scene3dCaptures: nextWithHistory.captures as unknown as Record<string, any>[],
        activeCameraId: nextWithHistory.activeCameraId,
        scene3dLastCaptureUrl: nextWithHistory.captures[nextWithHistory.captures.length - 1]?.mediaUrl,
        scene3dLastCaptureAssetId: nextWithHistory.captures[nextWithHistory.captures.length - 1]?.mediaAssetId
      };
    });
  };

  const openAndClear = () => {
    setError('');
    applySceneChange((current) => current, { history: false });
    setOpen(true);
  };

  const captureCardPreview = async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    try {
      setCardCapturing(true);
      await captureSceneCanvas({
        renderer: cardRendererRef.current,
        scene,
        onPatch: applySceneChange,
        onCreateImageNode,
        onError: setError
      });
    } catch (captureError: any) {
      setError(captureError?.message || '截图失败');
    } finally {
      setCardCapturing(false);
    }
  };

  return (
    <>
      <div
        onClick={onSelect}
        className={`node-box select-none glass-panel group relative z-10 flex w-[440px] flex-col overflow-hidden rounded-xl border bg-zinc-950/90 text-white shadow-2xl backdrop-blur-2xl transition-all duration-500 ${
          isSelected
            ? 'border-violet-400/60 shadow-[0_0_50px_rgba(139,92,246,0.16)] ring-1 ring-violet-400/20'
            : 'border-white/5 hover:border-white/10'
        }`}
      >
        <div className="absolute -left-2.5 top-1/2 z-30 flex h-5 w-5 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full border-2 border-zinc-800 bg-zinc-900 shadow-lg">
          <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
        </div>
        <div className="absolute -right-2.5 top-1/2 z-30 flex h-5 w-5 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full border-2 border-zinc-800 bg-zinc-900 shadow-lg">
          <div className={`h-1.5 w-1.5 rounded-full bg-green-500 ${cardCapturing ? 'animate-ping' : ''}`} />
        </div>

        <div className="relative h-[247px] w-full overflow-hidden rounded-xl bg-[#101217]">
          <ThreeCanvas
            shadows
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            camera={{ position: [4.2, 2.5, 5.3], fov: 48 }}
            onCreated={({ gl }) => {
              cardRendererRef.current = gl;
            }}
          >
            <Suspense fallback={<Html center><div className="rounded bg-black/70 px-3 py-2 text-xs text-zinc-200">Loading 3D preview...</div></Html>}>
              <ScenePreviewViewport scene={scene} active={!open} />
            </Suspense>
          </ThreeCanvas>

          <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-md border border-white/5 bg-black/45 px-2 py-1 backdrop-blur-md">
            <div className={`h-1.5 w-1.5 rounded-full ${cardCapturing ? 'animate-pulse bg-violet-300' : 'bg-green-500'}`} />
            <span className="text-[9px] font-bold uppercase tracking-tight text-zinc-300">{node.name || 'Scene3D'}</span>
          </div>

          <div className="absolute inset-x-0 top-5 z-20 flex translate-y-[-12px] justify-center gap-2 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openAndClear();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-violet-300/35 bg-black/70 px-3 text-[11px] font-semibold text-violet-100 shadow-xl backdrop-blur-md hover:bg-violet-500/25"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              打开导演台
            </button>
            <button
              type="button"
              disabled={cardCapturing}
              onClick={captureCardPreview}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-3 text-[11px] font-semibold text-zinc-100 shadow-xl backdrop-blur-md hover:bg-white/15 disabled:opacity-60"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {cardCapturing ? '截图中...' : '截图'}
            </button>
            <label
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-3 text-[11px] font-semibold text-zinc-100 shadow-xl backdrop-blur-md hover:bg-white/15"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="text-zinc-400">画幅</span>
              <select
                value={scene.aspectRatio}
                onChange={(event) => {
                  event.stopPropagation();
                  applySceneChange({ aspectRatio: event.target.value }, { label: '调整画幅' });
                }}
                className="h-6 rounded border border-white/10 bg-black/40 px-1.5 text-[11px] text-white outline-none"
              >
                {SCENE_ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio} value={ratio} className="bg-zinc-950">
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {lastCapture?.mediaUrl && (
            <div className="absolute bottom-3 right-3 z-10 overflow-hidden rounded-md border border-white/10 bg-black/50 p-1 shadow-xl backdrop-blur-md">
              <img src={lastCapture.mediaUrl} alt="最近截图" className="h-10 w-16 rounded object-cover" />
            </div>
          )}
        </div>
        {error && <div className="border-t border-red-400/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</div>}
      </div>
      {open && createPortal(
        <DirectorStage
          node={node}
          scene={scene}
          currentProjectId={currentProjectId}
          onClose={() => setOpen(false)}
          onPatch={applySceneChange}
          onError={setError}
          onCreateImageNode={onCreateImageNode}
        />,
        document.body
      )}
    </>
  );
}

function DirectorStage({
  node,
  scene,
  currentProjectId,
  onClose,
  onPatch,
  onError,
  onCreateImageNode
}: {
  node: CanvasNode;
  scene: Scene3DState;
  currentProjectId?: string | null;
  onClose: () => void;
  onPatch: SceneChangeHandler;
  onError: (message: string) => void;
  onCreateImageNode?: (result: Scene3DCaptureResult) => void;
}) {
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const blankPointerDownRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const suppressBlankSelectionUntilRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureCleanFrame, setCaptureCleanFrame] = useState(false);
  const [objectSearch, setObjectSearch] = useState('');
  const [preview, setPreview] = useState<PreviewState>({
    transitionId: scene.activeTransitionId,
    currentTimeSec: 0,
    playing: false,
    loop: true,
    enabled: false
  });
  const selected = selectedKind(scene);
  const selectedCharacter = scene.objects.characters.find((item) => item.id === scene.selectedObjectId) || null;
  const activeTransitionCandidate = scene.poseTransitions.find((item) => item.id === (preview.transitionId || scene.activeTransitionId)) || null;
  const activeTransition = selectedCharacter && activeTransitionCandidate && activeTransitionCandidate.characterId !== selectedCharacter.id
    ? scene.poseTransitions.find((item) => item.characterId === selectedCharacter.id) || null
    : activeTransitionCandidate;
  const previewLocked = Boolean(activeTransition?.animationClip && preview.transitionId === activeTransition.id && preview.enabled);


  const recordBlankPointerDown = (clientX: number, clientY: number, button: number) => {
    if (button !== 0 || captureCleanFrame || dragging || !scene.selectedObjectId) return;
    blankPointerDownRef.current = { x: clientX, y: clientY, time: Date.now() };
  };
  const cancelBlankPointerSelection = (suppressMs = 180) => {
    blankPointerDownRef.current = null;
    suppressBlankSelectionUntilRef.current = Date.now() + suppressMs;
  };
  const clearSelectionFromBlankPointerUp = (clientX: number, clientY: number, button: number) => {
    if (button !== 0 || captureCleanFrame || dragging || !scene.selectedObjectId) {
      blankPointerDownRef.current = null;
      return;
    }
    if (Date.now() < suppressBlankSelectionUntilRef.current) {
      blankPointerDownRef.current = null;
      return;
    }
    const down = blankPointerDownRef.current;
    blankPointerDownRef.current = null;
    if (!down) return;
    const moved = Math.hypot(clientX - down.x, clientY - down.y);
    if (moved > 5) return;
    if (Date.now() - down.time > 650) return;
    onPatch({ selectedObjectId: undefined }, { history: false });
  };
  const handleViewportPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    recordBlankPointerDown(event.clientX, event.clientY, event.button);
  };
  const handleViewportBlankPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    recordBlankPointerDown(event.clientX, event.clientY, event.button);
  };
  const handleViewportBlankPointerUp = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    clearSelectionFromBlankPointerUp(event.clientX, event.clientY, event.button);
  };
  const handleViewportPointerMissed = (event: MouseEvent) => {
    clearSelectionFromBlankPointerUp(event.clientX, event.clientY, event.button);
  };
  const handleViewportObjectPointerDown = () => {
    cancelBlankPointerSelection();
  };
  const handleViewportDragging = (nextDragging: boolean) => {
    if (nextDragging) cancelBlankPointerSelection(240);
    else suppressBlankSelectionUntilRef.current = Date.now() + 420;
    setDragging(nextDragging);
  };


  const undoSceneChange = () => {
    const entry = scene.undoStack[scene.undoStack.length - 1];
    if (!entry) return;
    onPatch((current) => normalizeScene({
      ...applyHistorySnapshot(current, entry.before),
      undoStack: current.undoStack.slice(0, -1),
      redoStack: [...current.redoStack, entry].slice(-MAX_SCENE_HISTORY)
    }), { history: false, preserveHistory: false });
  };

  const redoSceneChange = () => {
    const entry = scene.redoStack[scene.redoStack.length - 1];
    if (!entry) return;
    onPatch((current) => normalizeScene({
      ...applyHistorySnapshot(current, entry.after),
      undoStack: [...current.undoStack, entry].slice(-MAX_SCENE_HISTORY),
      redoStack: current.redoStack.slice(0, -1)
    }), { history: false, preserveHistory: false });
  };

  useEffect(() => {
    if (!preview.playing || !activeTransition?.animationClip) return undefined;
    let frame = 0;
    let lastAt = performance.now();
    const tick = (now: number) => {
      const delta = (now - lastAt) / 1000;
      lastAt = now;
      setPreview((current) => {
        if (!current.playing) return current;
        const duration = activeTransition.animationClip?.durationSec || activeTransition.durationSec;
        let nextTime = current.currentTimeSec + delta;
        let nextPlaying: boolean = current.playing;
        if (nextTime >= duration) {
          if (current.loop) nextTime = 0;
          else {
            nextTime = duration;
            nextPlaying = false;
          }
        }
        return { ...current, currentTimeSec: nextTime, playing: nextPlaying, enabled: true };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [preview.playing, activeTransition]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (!mod && (key === 'delete' || key === 'backspace')) {
        if (!scene.selectedObjectId || !selected) return;
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (!mod && key === 'v') {
        event.preventDefault();
        onPatch({ transformMode: 'translate' }, { history: false });
        return;
      }
      if (!mod && key === 'r') {
        event.preventDefault();
        onPatch({ transformMode: 'rotate' }, { history: false });
        return;
      }
      if (!mod && key === 's') {
        event.preventDefault();
        onPatch({ transformMode: 'scale' }, { history: false });
        return;
      }
      if (!mod && key === 'z') {
        event.preventDefault();
        void capture();
        return;
      }
      if (!mod) return;
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        redoSceneChange();
      } else if (key === 'z') {
        event.preventDefault();
        undoSceneChange();
      } else if (key === 'y') {
        event.preventDefault();
        redoSceneChange();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scene.undoStack, scene.redoStack, scene.selectedObjectId, selected, deleteSelected, undoSceneChange, redoSceneChange, onPatch, capture]);

  const updateObject: ObjectChangeHandler = (kind, id, patch, options = {}) => {
    onPatch((current) => {
      const key = kind === 'character' ? 'characters' : kind === 'prop' ? 'props' : kind === 'camera' ? 'cameras' : 'lights';
      return normalizeScene({
        ...current,
        objects: {
          ...current.objects,
          [key]: (current.objects as any)[key].map((item: any) => (item.id === id ? { ...item, ...patch } : item))
        }
      });
    }, {
      label: options.label || defaultObjectPatchLabel(kind, scene, id, patch),
      mergeKey: options.mergeKey || historyMergeKeyForObjectPatch(kind, id, patch),
      history: options.history,
      preserveHistory: options.preserveHistory,
      historyBefore: options.historyBefore
    });
  };

  const addCharacter = (gender: CharacterGender) => {
    onPatch((current) => {
      const nextCharacter = defaultCharacter(gender, current.objects.characters.length + 1);
      return normalizeScene({
        ...current,
        selectedObjectId: nextCharacter.id,
        objects: {
          ...current.objects,
          characters: [...current.objects.characters, nextCharacter]
        }
      });
        }, { label: gender === 'female' ? '添加女性角色' : '添加男性角色' });
  };

  const addProp = (shape: PropShape) => {
    const config = PROP_CREATION_OPTIONS.find((item) => item.id === shape) || PROP_CREATION_OPTIONS[0];
    onPatch((current) => {
      const typedPropName = nextTypedObjectName(current.objects.props, PROP_LABELS_BY_SHAPE[config.id] || config.label);
      const prop: PropObject = {
        id: createId('prop'),
        name: typedPropName,
        visible: true,
        locked: false,
        shape: config.id,
        position: vec(1.2, 0, 0),
        rotation: vec(),
        scale: config.scale,
        color: config.color
      };
      return normalizeScene({
        ...current,
        selectedObjectId: prop.id,
        objects: { ...current.objects, props: [...current.objects.props, prop] }
      });
    }, { label: '添加道具' });
  };

  const importCustomModel = async (target: 'character' | 'prop', file: File | null | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORTED_MODEL_BYTES) {
      onError('模型文件不能超过 25MB');
      return;
    }
    let model: ImportedSceneModel | null = null;
    let importWarning = '';
    try {
      model = await uploadImportedModelFile(file);
    } catch (error: any) {
      model = importedModelFromFile(file);
      importWarning = `模型上传失败，已使用本地临时预览：${error?.message || '未知错误'}。如需永久保存，请确认后端上传接口可用。`;
    }
    if (!model) {
      onError('模型解析失败，请上传 .fbx、.glb、.gltf 或 .obj 文件。');
      return;
    }
    onPatch((current) => {
      if (target === 'character') {
        const gender: CharacterGender = 'male';
        const character: CharacterObject = {
          ...defaultCharacter(gender, current.objects.characters.length + 1),
          id: createId('char'),
          name: nextTypedObjectName(current.objects.characters, '导入角色'),
          position: nextImportedModelPosition(current.objects.characters.length, -1.2),
          model: {
            type: model.format,
            url: model.url,
            sourceName: model.fileName,
            normalizedHeight: genderHeight(gender),
            runtimeOnly: model.runtimeOnly
          }
        };
        return normalizeScene({
          ...current,
          selectedObjectId: character.id,
          objects: {
            ...current.objects,
            characters: [...current.objects.characters, character]
          }
        });
      }
      const prop: PropObject = {
        id: createId('prop'),
        name: nextTypedObjectName(current.objects.props, '导入道具'),
        visible: true,
        locked: false,
        shape: 'model',
        model,
        position: nextImportedModelPosition(current.objects.props.length, 1.2),
        rotation: vec(),
        scale: vec(1, 1, 1),
        color: '#ffffff'
      };
      return normalizeScene({
        ...current,
        selectedObjectId: prop.id,
        objects: { ...current.objects, props: [...current.objects.props, prop] }
      });
    }, { label: target === 'character' ? '导入角色模型' : '导入道具模型', history: false });
    onError(importWarning);
  };

  const addCamera = (templateId: CameraTemplateId = 'current') => {
    const template = CAMERA_TEMPLATE_OPTIONS.find((item) => item.id === templateId) || CAMERA_TEMPLATE_OPTIONS[0];
    onPatch((current) => {
      const camera = {
        ...defaultCamera(),
        id: createId('cam'),
        name: `${template.label} ${current.objects.cameras.length + 1}`,
        position: template.position,
        targetPosition: template.targetPosition,
        fov: template.fov
      };
      return normalizeScene({
        ...current,
        selectedObjectId: camera.id,
        activeCameraId: current.activeCameraId || camera.id,
        objects: { ...current.objects, cameras: [...current.objects.cameras, camera] }
      });
    }, { label: '添加机位' });
  };

  const addLight = (lightType: LightType = 'point') => {
    const config = LIGHT_ADD_OPTIONS.find((item) => item.id === lightType) || LIGHT_ADD_OPTIONS[0];
    onPatch((current) => {
      const typedLightName = nextTypedObjectName(current.objects.lights, LIGHT_LABELS_BY_TYPE[config.id] || config.label);
      const light: LightObject = {
        id: createId('light'),
        name: typedLightName,
        visible: true,
        locked: false,
        lightType: config.id,
        position: config.position,
        rotation: vec(),
        scale: vec(1, 1, 1),
        color: config.color,
        intensity: config.intensity
      };
      return normalizeScene({
        ...current,
        selectedObjectId: light.id,
        objects: { ...current.objects, lights: [...current.objects.lights, light] }
      });
    }, { label: '添加灯光' });
  };

  function deleteSelected() {
    if (!selected || !scene.selectedObjectId) return;
    const selectedObject = objectByKind(scene, selected, scene.selectedObjectId);
    if (!selectedObject) return;
    if (selectedObject.locked) {
      onError(`${selectedObject.name} 已锁定，不能删除。`);
      return;
    }
    const deleteLabel = `删除 ${selectedObject.name}`;
    onPatch((current) => {
      const deletingId = current.selectedObjectId;
      if (!deletingId) return current;
      const deletingKind = selectedKind(current);
      if (!deletingKind) return current;
      const key = objectListKey(deletingKind);
      const deletingObject = objectByKind(current, deletingKind, deletingId);
      if (!deletingObject || deletingObject.locked) return current;
      const nextList = (current.objects as any)[key].filter((item: any) => item.id !== current.selectedObjectId);
      const nextCameras = key === 'cameras' ? nextList as CameraObject[] : current.objects.cameras;
      const nextScene = normalizeScene({
        ...current,
        selectedObjectId: undefined,
        activeCameraId: deletingKind === 'camera' && current.activeCameraId === deletingId ? nextCameras[0]?.id : current.activeCameraId,
        objects: { ...current.objects, [key]: nextList }
      });
      return removeDeletedObjectReferences(nextScene, deletingKind, deletingId);
    }, { label: deleteLabel });
    onError('');
  }

  async function capture() {
    try {
      setCapturing(true);
      setCaptureCleanFrame(true);
      await captureSceneCanvas({
        renderer: glRef.current,
        scene,
        onPatch,
        onCreateImageNode,
        onError
      });
    } catch (error: any) {
      onError(error?.message || '截图失败');
    } finally {
      setCaptureCleanFrame(false);
      setCapturing(false);
    }
  }

  const previewSample = useMemo(() => {
    if (!activeTransition?.animationClip) return null;
    return sampleClipAtTime(activeTransition.animationClip, preview.currentTimeSec);
  }, [activeTransition, preview.currentTimeSec]);

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 p-4 text-white">
      <div className="mx-auto flex h-[calc(100vh-32px)] max-w-[1440px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#080a0f] shadow-2xl">
        <div className="flex h-10 items-center justify-between border-b border-white/10 px-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Box className="h-4 w-4 text-violet-300" />
            3D导演台
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!scene.undoStack.length}
              onClick={undoSceneChange}
              title={scene.undoStack.length ? `撤销：${scene.undoStack[scene.undoStack.length - 1].label}` : '没有可撤销的操作'}
              className="rounded-md border border-white/10 p-1 text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!scene.redoStack.length}
              onClick={redoSceneChange}
              title={scene.redoStack.length ? `恢复：${scene.redoStack[scene.redoStack.length - 1].label}` : '没有可恢复的操作'}
              className="rounded-md border border-white/10 p-1 text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-white/10" />
            <ToolButton icon={<Move3D className="h-4 w-4" />} label="移动" shortcut="V" active={scene.transformMode === 'translate'} onClick={() => onPatch({ transformMode: 'translate' }, { history: false })} />
            <ToolButton icon={<RotateCw className="h-4 w-4" />} label="旋转" shortcut="R" active={scene.transformMode === 'rotate'} onClick={() => onPatch({ transformMode: 'rotate' }, { history: false })} />
            <ToolButton icon={<ZoomIn className="h-4 w-4" />} label="缩放" shortcut="S" active={scene.transformMode === 'scale'} onClick={() => onPatch({ transformMode: 'scale' }, { history: false })} />
            <ToolButton icon={<ImagePlus className="h-4 w-4" />} label={capturing ? '截图中...' : '截图'} shortcut="Z" disabled={capturing} onClick={capture} />
            <div className="mx-1 h-5 w-px bg-white/10" />
            <Segmented
              value={scene.activeViewMode}
              options={[
                { value: 'director', label: '导演视图' },
                { value: 'camera', label: '机位视图' }
              ]}
              onChange={(value) => onPatch({
                activeViewMode: value as Scene3DState['activeViewMode'],
                activeCameraId: scene.activeCameraId || scene.objects.cameras[0]?.id
              }, { history: false })}
            />
            <button type="button" onClick={onClose} className="rounded-md border border-white/10 p-1 text-zinc-300 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_360px]">
          <ObjectPanel
              scene={scene}
              objectSearch={objectSearch}
              onObjectSearch={setObjectSearch}
              onPatch={onPatch}
              onAddCharacter={addCharacter}
              onAddProp={addProp}
              onAddCamera={addCamera}
              onAddLight={addLight}
              onImportCustomModel={importCustomModel}
              onUpdateObject={updateObject}
            />
          <div className="relative min-h-0 border-x border-white/10" onPointerDownCapture={handleViewportPointerDownCapture}>
            <ThreeCanvas
              shadows
              gl={{ preserveDrawingBuffer: true, antialias: true }}
              camera={{ position: [4.2, 2.8, 5.8], fov: 48 }}
              onPointerMissed={handleViewportPointerMissed}
              onCreated={({ gl }) => {
                glRef.current = gl;
              }}
            >
              <Suspense fallback={<Html center><div className="rounded bg-black/70 px-3 py-2 text-xs">加载 3D 场景...</div></Html>}>
                <SceneViewport
                  scene={scene}
                  selectedKind={selected}
                  dragging={dragging}
                  previewTransitionId={preview.transitionId}
                  previewLocked={previewLocked}
                  previewSample={previewSample}
                  presentation={captureCleanFrame ? 'clean' : 'editor'}
                  onDragging={handleViewportDragging}
                  onBlankPointerDown={handleViewportBlankPointerDown}
                  onBlankPointerUp={handleViewportBlankPointerUp}
                  onSceneObjectPointerDown={handleViewportObjectPointerDown}
                  onPatch={onPatch}
                  onUpdateObject={updateObject}
                />
              </Suspense>
            </ThreeCanvas>
            {scene.compositionGuideEnabled && !captureCleanFrame && <CompositionGuide />}
          </div>
          <PropertyPanel
            node={node}
            scene={scene}
            currentProjectId={currentProjectId}
            selectedKind={selected}
            preview={preview}
            previewSample={previewSample}
            activeTransition={activeTransition}
            onPatch={onPatch}
            onUpdateObject={updateObject}
            onDeleteSelected={deleteSelected}
            onSelectTransition={(transitionId) => {
              const transition = scene.poseTransitions.find((item) => item.id === transitionId);
              setPreview((current) => ({
                ...current,
                transitionId,
                currentTimeSec: 0,
                playing: false,
                enabled: false
              }));
              onPatch({ activeTransitionId: transitionId, selectedObjectId: transition?.characterId || scene.selectedObjectId }, { history: false });
            }}
            onPreviewChange={setPreview}
            onError={onError}
          />
        </div>
          <MiniTimeline
          transition={activeTransition}
          preview={preview}
          onPreviewChange={setPreview}
          onExitPreview={() => {
            setPreview((current) => ({ ...current, transitionId: undefined, currentTimeSec: 0, playing: false, enabled: false }));
            onPatch({ activeTransitionId: undefined }, { history: false });
          }}
          onWriteCurrentPose={() => {
            if (!previewSample || !activeTransition) return;
            onPatch((current) => applyPreviewFrameToScene(current, activeTransition.id, previewSample), { label: '\u5e94\u7528\u9884\u89c8\u5e27' });
          }}
        />
      </div>
    </div>
  );
}

// Three.js viewport, scene primitives, imported model rendering, and rig application.
function SceneViewport({
  scene,
  selectedKind,
  dragging,
  previewTransitionId,
  previewLocked,
  previewSample,
  presentation = 'editor',
  onDragging,
  onBlankPointerDown,
  onBlankPointerUp,
  onSceneObjectPointerDown,
  onPatch,
  onUpdateObject
}: {
  scene: Scene3DState;
  selectedKind: ObjectKind | null;
  dragging: boolean;
  previewTransitionId?: string;
  previewLocked: boolean;
  previewSample: AnimationClipSample | null;
  presentation?: SceneViewportPresentation;
  onDragging: (dragging: boolean) => void;
  onBlankPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onBlankPointerUp?: (event: ThreeEvent<PointerEvent>) => void;
  onSceneObjectPointerDown?: () => void;
  onPatch: SceneChangeHandler;
  onUpdateObject: ObjectChangeHandler;
}) {
  const { camera } = useThree();
  const isClean = presentation === 'clean';
  const suppressSceneSelectUntilRef = useRef(0);
  const activeCamera = scene.objects.cameras.find((item) => item.id === scene.activeCameraId) || scene.objects.cameras[0];
  const previewTransition = scene.poseTransitions.find((item) => item.id === previewTransitionId) || null;
  const previewCharacterId = previewTransition?.characterId;
  const previewPropTransforms = useMemo(
    () => (previewLocked ? buildPreviewPropTransforms(scene, previewTransition, previewSample) : {}),
    [scene, previewTransition, previewSample, previewLocked]
  );

  useEffect(() => {
    if (scene.activeViewMode === 'director' && 'zoom' in camera) {
      const perspectiveCamera = camera as THREE.PerspectiveCamera;
      perspectiveCamera.zoom = isClean ? 1 : scene.sceneZoomPercent / 100;
      perspectiveCamera.filmOffset = 0;
      perspectiveCamera.updateProjectionMatrix();
    }
  }, [camera, isClean, scene.activeViewMode, scene.sceneZoomPercent]);

  useEffect(() => {
    if (scene.activeViewMode !== 'camera' || !activeCamera || dragging) return;
    camera.position.set(activeCamera.position.x, activeCamera.position.y, activeCamera.position.z);
    camera.lookAt(cameraTarget(activeCamera));
    if ('fov' in camera) {
      const projection = cameraLensProjection(activeCamera);
      const perspectiveCamera = camera as THREE.PerspectiveCamera;
      perspectiveCamera.fov = projection.fov;
      perspectiveCamera.zoom = projection.zoom;
      perspectiveCamera.filmOffset = projection.filmOffset;
      perspectiveCamera.updateProjectionMatrix();
    }
  }, [scene.activeViewMode, activeCamera, camera, dragging]);
  const handleTransformDragging = (nextDragging: boolean) => {
    suppressSceneSelectUntilRef.current = Date.now() + (nextDragging ? 240 : 420);
    onDragging(nextDragging);
  };
  const handleGroundPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (isClean || dragging || Date.now() < suppressSceneSelectUntilRef.current) return;
    onBlankPointerDown?.(event);
  };
  const handleGroundPointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (isClean || dragging || Date.now() < suppressSceneSelectUntilRef.current) return;
    onBlankPointerUp?.(event);
  };
  const handleSceneObjectPointerDown = () => {
    onSceneObjectPointerDown?.();
  };

  return (
    <>
      <color attach="background" args={[scene.background.color]} />
      {scene.objects.lights.filter((item) => item.visible).map((light) => (
        light.lightType === 'ambient'
          ? <ambientLight key={light.id} color={light.color} intensity={light.intensity} />
          : light.lightType === 'hemisphere'
            ? <hemisphereLight key={light.id} color={light.color} groundColor="#101827" intensity={light.intensity} />
            : light.lightType === 'directional'
              ? <directionalLight key={light.id} position={[light.position.x, light.position.y, light.position.z]} intensity={light.intensity} color={light.color} castShadow />
              : light.lightType === 'spot'
                ? <spotLight key={light.id} position={[light.position.x, light.position.y, light.position.z]} intensity={light.intensity} color={light.color} angle={0.48} penumbra={0.45} castShadow />
                : light.lightType === 'rect'
                  ? <rectAreaLight key={light.id} position={[light.position.x, light.position.y, light.position.z]} intensity={light.intensity} color={light.color} width={3} height={2} />
                  : <pointLight key={light.id} position={[light.position.x, light.position.y, light.position.z]} intensity={light.intensity} color={light.color} castShadow />
      ))}
      {scene.groundEnabled && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          position={[0, -0.01, 0]}
          onPointerDown={handleGroundPointerDown}
          onPointerUp={handleGroundPointerUp}
        >
          <planeGeometry args={[40, 40]} />
          <shadowMaterial opacity={0.25} />
        </mesh>
      )}
      {scene.groundGridEnabled && (
        <Grid
          args={[40, 40]}
          cellColor="#1f2940"
          sectionColor="#2f3d5c"
          cellThickness={0.5}
          sectionThickness={1}
          infiniteGrid
          fadeDistance={60}
        />
      )}
      {!isClean && scene.motionPathEnabled && previewTransition?.animationClip && (
        <MotionPathOverlay
          transition={previewTransition}
          previewSample={previewSample}
        />
      )}
      <group>
        {scene.objects.characters.filter((item) => item.visible).map((character) => {
          const display = previewLocked && previewCharacterId === character.id && previewSample
            ? {
                position: previewSample.transform.position,
                rotation: previewSample.transform.rotation,
                scale: previewSample.transform.scale,
                posePresetId: character.posePresetId || character.posePreset,
                rigPose: previewSample.pose,
                bonePose: previewSample.bonePose,
                fingerPose: previewSample.fingerPose,
                toePose: previewSample.toePose
              }
            : {
                position: character.position,
                rotation: character.rotation,
                scale: character.scale,
                posePresetId: character.posePresetId || character.posePreset,
                rigPose: character.rigPose,
                bonePose: character.bonePose,
                fingerPose: character.fingerPose,
                toePose: character.toePose
              };
          return (
            <Transformable
              key={character.id}
              kind="character"
              id={character.id}
              objectTransform={{
                position: display.position,
                rotation: display.rotation,
                scale: display.scale
              }}
              scene={scene}
              selected={!isClean && scene.selectedObjectId === character.id && selectedKind === 'character'}
              locked={isClean || character.locked || previewLocked}
              transformMode={scene.transformMode}
              onDragging={handleTransformDragging}
              onPointerDown={handleSceneObjectPointerDown}
              onUpdateObject={onUpdateObject}
            >
              <CharacterModel
                character={character}
                effectivePosePresetId={display.posePresetId}
                effectivePose={display.rigPose}
                effectiveBonePose={display.bonePose}
                effectiveFingerPose={display.fingerPose}
                effectiveToePose={display.toePose}
                showLabel={!isClean && scene.characterLabelsEnabled}
                selected={!isClean && scene.selectedObjectId === character.id}
                onSelect={() => !isClean && onPatch({
                  selectedObjectId: character.id,
                  activeTransitionId: scene.poseTransitions.find((item) => item.characterId === character.id)?.id
                }, { history: false })}
              />
            </Transformable>
          );
        })}
        {scene.objects.props.filter((item) => item.visible).map((prop) => {
          const display = previewPropTransforms[prop.id] || propBaseTransform(prop);
          return (
            <Transformable
              key={prop.id}
              kind="prop"
              id={prop.id}
              objectTransform={display}
              scene={scene}
              selected={!isClean && scene.selectedObjectId === prop.id && selectedKind === 'prop'}
              locked={isClean || prop.locked || previewLocked}
              transformMode={scene.transformMode}
              onDragging={handleTransformDragging}
              onPointerDown={handleSceneObjectPointerDown}
              onUpdateObject={onUpdateObject}
            >
              <PropModel prop={prop} selected={!isClean && scene.selectedObjectId === prop.id} showLabel={!isClean} onSelect={() => !isClean && onPatch({ selectedObjectId: prop.id }, { history: false })} />
            </Transformable>
          );
        })}
        {!isClean && scene.objects.cameras.filter((item) => item.visible && scene.activeViewMode !== 'camera').map((cameraObject) => (
          <Transformable
            key={cameraObject.id}
            kind="camera"
            id={cameraObject.id}
            objectTransform={{ position: cameraObject.position, rotation: cameraObject.rotation, scale: cameraObject.scale }}
            scene={scene}
            selected={scene.selectedObjectId === cameraObject.id && selectedKind === 'camera'}
            locked={cameraObject.locked || previewLocked}
            transformMode={scene.transformMode}
            onDragging={handleTransformDragging}
            onPointerDown={handleSceneObjectPointerDown}
            onUpdateObject={onUpdateObject}
          >
            <CameraRig
              cameraObject={cameraObject}
              selected={scene.selectedObjectId === cameraObject.id || scene.activeCameraId === cameraObject.id}
              onSelect={() => onPatch({ selectedObjectId: cameraObject.id }, { history: false })}
            />
          </Transformable>
        ))}
        {!isClean && scene.objects.lights.filter((item) => item.visible && scene.activeViewMode !== 'camera').map((light) => (
          <Transformable
            key={light.id}
            kind="light"
            id={light.id}
            objectTransform={{ position: light.position, rotation: light.rotation, scale: light.scale }}
            scene={scene}
            selected={scene.selectedObjectId === light.id && selectedKind === 'light'}
            locked={light.locked || previewLocked}
            transformMode={scene.transformMode}
            onDragging={handleTransformDragging}
            onPointerDown={handleSceneObjectPointerDown}
            onUpdateObject={onUpdateObject}
          >
            <LightRig light={light} selected={scene.selectedObjectId === light.id} onSelect={() => onPatch({ selectedObjectId: light.id }, { history: false })} />
          </Transformable>
        ))}
      </group>
      {!isClean && <OrbitControls enabled={!dragging && scene.activeViewMode === 'director'} target={[0, 0.95, 0]} makeDefault />}
      {!isClean && (
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
          <GizmoViewport />
        </GizmoHelper>
      )}
    </>
  );
}

function ScenePreviewViewport({ scene, active = true }: { scene: Scene3DState; active?: boolean }) {
  const noopDragging = useMemo(() => () => undefined, []);
  const noopPatch = useMemo<SceneChangeHandler>(() => () => undefined, []);
  const noopUpdate = useMemo(() => () => undefined, []);
  if (!active) return null;
  return (
    <SceneViewport
      scene={scene}
      selectedKind={null}
      dragging={false}
      previewLocked={false}
      previewSample={null}
      presentation="clean"
      onDragging={noopDragging}
      onPatch={noopPatch}
      onUpdateObject={noopUpdate as any}
    />
  );
}

function contactColor(contact: AnimationContactFrame) {
  if (contact.kind === 'grasp') return '#f59e0b';
  if (contact.kind === 'release') return '#38bdf8';
  if (contact.limb === 'leftFoot' || contact.limb === 'rightFoot') return '#34d399';
  return '#a78bfa';
}

function MotionPathOverlay({
  transition,
  previewSample
}: {
  transition: PoseTransition;
  previewSample: AnimationClipSample | null;
}) {
  const clip = transition.animationClip;
  if (!clip?.samples.length) return null;
  const points = clip.samples.map((sample) => new THREE.Vector3(
    sample.transform.position.x,
    sample.transform.position.y + 0.035,
    sample.transform.position.z
  ));
  const stride = Math.max(1, Math.floor(clip.samples.length / 8));
  const directionSamples = clip.samples.filter((_, index) => index % stride === 0 || index === clip.samples.length - 1).slice(0, 12);
  return (
    <group>
      <Line points={points} color="#22d3ee" lineWidth={2} transparent opacity={0.78} />
      {directionSamples.map((sample) => {
        const yaw = rad(sample.transform.rotation.y);
        return (
          <group key={`dir-${sample.timeSec}`} position={[sample.transform.position.x, sample.transform.position.y + 0.055, sample.transform.position.z]} rotation={[0, yaw, 0]}>
            <Line points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.28)]} color="#f8fafc" lineWidth={1.4} transparent opacity={0.65} />
            <mesh position={[0, 0, -0.32]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.045, 0.11, 12]} />
              <meshBasicMaterial color="#f8fafc" transparent opacity={0.72} />
            </mesh>
          </group>
        );
      })}
      {clip.contacts.map((contact, index) => (
        <group key={`${contact.kind}-${contact.limb}-${contact.timeSec}-${index}`} position={[contact.position.x, contact.position.y + 0.035, contact.position.z]}>
          <mesh>
            <sphereGeometry args={[0.045, 12, 8]} />
            <meshBasicMaterial color={contactColor(contact)} transparent opacity={0.9} />
          </mesh>
          <Html position={[0, 0.12, 0]} center distanceFactor={9} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            <div className="rounded border border-white/10 bg-black/70 px-1.5 py-0.5 text-[9px] leading-none text-zinc-100 shadow">
              {contact.limb} {contact.timeSec.toFixed(1)}s
            </div>
          </Html>
        </group>
      ))}
      {previewSample && (
        <mesh position={[previewSample.transform.position.x, previewSample.transform.position.y + 0.08, previewSample.transform.position.z]}>
          <sphereGeometry args={[0.075, 16, 10]} />
          <meshBasicMaterial color="#f472b6" transparent opacity={0.95} />
        </mesh>
      )}
    </group>
  );
}

function cameraTarget(cameraObject: CameraObject) {
  return new THREE.Vector3(cameraObject.targetPosition.x, cameraObject.targetPosition.y, cameraObject.targetPosition.z);
}

function Transformable({
  kind,
  id,
  objectTransform,
  scene,
  selected,
  locked,
  transformMode,
  onDragging,
  onPointerDown,
  onUpdateObject,
  children
}: {
  kind: ObjectKind;
  id: string;
  objectTransform: PoseTransform;
  scene: Scene3DState;
  selected: boolean;
  locked: boolean;
  transformMode: TransformMode;
  onDragging: (dragging: boolean) => void;
  onPointerDown?: () => void;
  onUpdateObject: ObjectChangeHandler;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const draggingRef = useRef(false);
  const [controlSize, setControlSize] = useState(() => transformControlSizeForKind(kind, objectTransform.scale));
  useEffect(() => {
    if (!selected || !ref.current) return;
    const updateSize = () => {
      const box = new THREE.Box3().setFromObject(ref.current as THREE.Object3D);
      const size = new THREE.Vector3();
      box.getSize(size);
      setControlSize(transformControlSizeForKind(kind, objectTransform.scale, size));
    };
    updateSize();
    const frame = requestAnimationFrame(updateSize);
    return () => cancelAnimationFrame(frame);
  }, [kind, objectTransform.scale, selected]);
  const sync = () => {
    const group = ref.current;
    if (!group) return;
    onUpdateObject(kind, id, {
      position: vec(
        Number(group.position.x.toFixed(3)),
        Number(group.position.y.toFixed(3)),
        Number(group.position.z.toFixed(3))
      ),
      rotation: vec(Number(deg(group.rotation.x).toFixed(2)), Number(deg(group.rotation.y).toFixed(2)), Number(deg(group.rotation.z).toFixed(2))),
      scale: vec(Number(group.scale.x.toFixed(3)), Number(group.scale.y.toFixed(3)), Number(group.scale.z.toFixed(3)))
    });
  };

  const body = (
    <group
      ref={ref}
      position={[objectTransform.position.x, objectTransform.position.y, objectTransform.position.z]}
      rotation={[rad(objectTransform.rotation.x), rad(objectTransform.rotation.y), rad(objectTransform.rotation.z)]}
      scale={[objectTransform.scale.x || 1, objectTransform.scale.y || 1, objectTransform.scale.z || 1]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown?.();
      }}
    >
      <group position={[0, 0, 0]}>
        {children}
      </group>
    </group>
  );

  if (!selected || locked) return body;
  return (
    <>
      {body}
      <TransformControls
        object={ref}
        mode={transformMode}
        size={controlSize}
        onMouseDown={() => {
          onPointerDown?.();
          draggingRef.current = true;
          onDragging(true);
        }}
        onMouseUp={() => {
          draggingRef.current = false;
          onDragging(false);
          sync();
        }}
      />
    </>
  );
}

function SelectionRing({ radius = 0.58 }: { radius?: number }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <torusGeometry args={[radius, 0.012, 8, 72]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.9} depthTest={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.028, 0]}>
        <circleGeometry args={[radius, 72]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.08} depthWrite={false} />
      </mesh>
    </group>
  );
}

function CharacterModel({
  character,
  effectivePosePresetId,
  effectivePose,
  effectiveBonePose,
  effectiveFingerPose,
  effectiveToePose,
  showLabel,
  selected,
  onSelect
}: {
  character: CharacterObject;
  effectivePosePresetId?: string;
  effectivePose: StandardHumanRigPose;
  effectiveBonePose?: Scene3DBonePose;
  effectiveFingerPose?: StandardHumanFingerPose;
  effectiveToePose?: StandardHumanToePose;
  showLabel: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const safePose = useMemo(() => clampPose(effectivePose), [effectivePose]);
  const normalizedEffectivePosePresetId = normalizePosePresetId(effectivePosePresetId || character.posePresetId || character.posePreset);
  const displayPose = safePose;
  const displayBonePose = effectiveBonePose;
  const displayFingerPose = effectiveFingerPose;
  const displayToePose = effectiveToePose;
  if (character.model.type === 'proxy') {
    return <HumanProxy character={character} effectivePose={displayPose} showLabel={showLabel} selected={selected} onSelect={onSelect} />;
  }
  if (character.model.url && character.model.url !== MODEL_URL) {
    return <ImportedCharacterModel character={character} pose={displayPose} bonePose={displayBonePose} fingerPose={displayFingerPose} toePose={displayToePose} showLabel={showLabel} selected={selected} onSelect={onSelect} />;
  }
  return <GLBCharacter character={character} effectivePosePresetId={normalizedEffectivePosePresetId} effectivePose={displayPose} effectiveBonePose={displayBonePose} effectiveFingerPose={displayFingerPose} effectiveToePose={displayToePose} showLabel={showLabel} selected={selected} onSelect={onSelect} />;
}

function GLBCharacter({
  character,
  effectivePosePresetId,
  effectivePose,
  effectiveBonePose,
  effectiveFingerPose,
  effectiveToePose,
  showLabel,
  selected,
  onSelect
}: {
  character: CharacterObject;
  effectivePosePresetId?: string;
  effectivePose: StandardHumanRigPose;
  effectiveBonePose?: Scene3DBonePose;
  effectiveFingerPose?: StandardHumanFingerPose;
  effectiveToePose?: StandardHumanToePose;
  showLabel: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  if (character.model.type === 'fbx' || character.model.type === 'obj') {
    return <ImportedCharacterModel character={character} pose={effectivePose} bonePose={effectiveBonePose} fingerPose={effectiveFingerPose} toePose={effectiveToePose} showLabel={showLabel} selected={selected} onSelect={onSelect} />;
  }
  const gltf = useGLTF(character.model.url || MODEL_URL);
  const model = useMemo(() => {
    const cloned = cloneSkeleton(gltf.scene) as THREE.Object3D;
    cloned.updateMatrixWorld(true);
    return cloned;
  }, [gltf.scene]);
  const rig = useMemo(() => collectRig(model), [model]);
  const modelBounds = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const height = size.y > 0.001 ? size.y : 1.75;
    const normalizedHeight = character.model.normalizedHeight || (character.gender === 'female' ? 1.65 : 1.78);
    const scale = normalizedHeight / height;
    return {
      scale,
      offset: new THREE.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale)
    };
  }, [model, character.gender, character.model.normalizedHeight]);

  useEffect(() => {
    model.traverse((child: any) => {
      if (child.isMesh) {
        child.visible = true;
        child.frustumCulled = false;
        child.castShadow = true;
        child.receiveShadow = true;
        const material = child.material?.clone?.();
        if (material?.color) material.color = new THREE.Color(character.color);
        if (material) {
          material.transparent = false;
          material.opacity = 1;
          material.depthWrite = true;
          material.side = THREE.DoubleSide;
          child.material = material;
        }
      }
    });
  }, [model, character.color]);

  useEffect(() => {
    applyRigPoseToModel(rig, effectivePose, effectiveBonePose, effectiveFingerPose, effectiveToePose);
  }, [rig, effectivePose, effectiveBonePose, effectiveFingerPose, effectiveToePose]);

  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <group position={[character.poseRootOffset?.x || 0, character.poseRootOffset?.y || 0, character.poseRootOffset?.z || 0]}>
        <primitive
          object={model}
          position={[modelBounds.offset.x, modelBounds.offset.y, modelBounds.offset.z]}
          scale={[modelBounds.scale, modelBounds.scale, modelBounds.scale]}
        />
      </group>
      {selected && <SelectionRing radius={0.68} />}
      {showLabel && <NameLabel name={character.name} y={2.15} />}
    </group>
  );
}

function ImportedCharacterModel({
  character,
  pose,
  bonePose,
  fingerPose,
  toePose,
  showLabel,
  selected,
  onSelect
}: {
  character: CharacterObject;
  pose: StandardHumanRigPose;
  bonePose?: Scene3DBonePose;
  fingerPose?: StandardHumanFingerPose;
  toePose?: StandardHumanToePose;
  showLabel: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <RiggedImportedSceneModelPrimitive
        model={{
          url: character.model.url || MODEL_URL,
          fileName: character.model.sourceName || 'custom-model',
          format: character.model.type as ImportedModelFormat,
          importedAt: new Date().toISOString(),
          runtimeOnly: character.model.runtimeOnly
        }}
        color={character.color}
        pose={pose}
        bonePose={bonePose}
        fingerPose={fingerPose}
        toePose={toePose}
      />
      {selected && <SelectionRing radius={0.56} />}
      {showLabel && <NameLabel name={character.name} y={2.05} />}
    </group>
  );
}

function collectRig(model: THREE.Object3D) {
  const byName = new Map<string, THREE.Bone>();
  const rest = new Map<string, THREE.Quaternion>();
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) {
      const bone = child as THREE.Bone;
      byName.set(bone.name, bone);
      byName.set(runtimeBoneName(bone.name), bone);
      rest.set(bone.name, bone.quaternion.clone());
      rest.set(runtimeBoneName(bone.name), bone.quaternion.clone());
      const alias = XBOT_BONE_NAME_ALIASES[runtimeBoneName(bone.name)] || XBOT_BONE_NAME_ALIASES[bone.name];
      if (alias) {
        byName.set(alias, bone);
        byName.set(runtimeBoneName(alias), bone);
        rest.set(alias, bone.quaternion.clone());
        rest.set(runtimeBoneName(alias), bone.quaternion.clone());
      }
    }
  });
  return { byName, rest };
}

function applyRigPoseToModel(
  rig: Scene3DCollectedRig,
  pose: StandardHumanRigPose,
  bonePose?: Scene3DBonePose,
  fingerPose?: StandardHumanFingerPose,
  toePose?: StandardHumanToePose
) {
  resetRigToRestPose(rig);
  if (bonePose?.bones) {
    applyBonePoseToModel(rig, bonePose);
    if (bonePose.source !== 'runninghub-tv') applyToePoseToModel(rig, toePose);
    applyFingerPoseToModel(rig, fingerPose);
    return;
  }
  if (fingerPose?.boneSpace === 'runninghub-tv-mixamo' && fingerPose.bones) {
    applyMixamoLocalBonePoseToModel(rig, fingerPose.bones);
    applyToePoseToModel(rig, toePose);
    return;
  }
  for (const key of POSE_KEYS) {
    for (const target of BONE_TARGETS[key]) {
      const bone = rig.byName.get(target.name);
      const rest = rig.rest.get(target.name);
      if (!bone || !rest) continue;
      const rotation = pose[key];
      const delta = vecToQuaternion({
        x: rotation.x * target.weight,
        y: rotation.y * target.weight,
        z: rotation.z * target.weight
      });
      bone.quaternion.copy(rest).multiply(delta);
    }
  }
  applyToePoseToModel(rig, toePose);
  applyFingerPoseToModel(rig, fingerPose);
}

function resetRigToRestPose(rig: Scene3DCollectedRig) {
  const resetBones = new Set<THREE.Bone>();
  rig.byName.forEach((bone, name) => {
    if (resetBones.has(bone)) return;
    const rest = rig.rest.get(name) || rig.rest.get(runtimeBoneName(name)) || rig.rest.get(bone.name) || rig.rest.get(runtimeBoneName(bone.name));
    if (!rest) return;
    bone.quaternion.copy(rest);
    resetBones.add(bone);
  });
}

function applyBonePoseToModel(
  rig: Scene3DCollectedRig,
  bonePose: Scene3DBonePose
) {
  if (bonePose.space === 'mixamo-local') {
    applyMixamoLocalBonePoseToModel(rig, bonePose.bones);
    return;
  }
  Object.entries(bonePose.bones).forEach(([name, rotation]) => {
    const bone = rig.byName.get(name) || rig.byName.get(runtimeBoneName(name));
    const rest = rig.rest.get(name) || rig.rest.get(runtimeBoneName(name));
    if (!bone || !rest) return;
    bone.quaternion.copy(rest).multiply(vecToQuaternion(rotation));
  });
}

function applyMixamoLocalBonePoseToModel(
  rig: Scene3DCollectedRig,
  sourcePose: Record<string, RigRotation>
) {
  applyRunningHubTvBonePoseToXbotRig(rig, sourcePose);
}

function applyRunningHubTvBonePoseToXbotRig(
  rig: Scene3DCollectedRig,
  sourcePose: Record<string, RigRotation>
) {
  const missing: string[] = [];
  Object.entries(sourcePose).forEach(([name, rotation]) => {
    if (!isRunningHubTvBoneName(name)) return;
    const sourceBoneName = runtimeBoneName(name) as RunningHubTvBoneName;
    const targetBoneName = XBOT_BONE_NAME_ALIASES[sourceBoneName] || sourceBoneName;
    const bone = findRigBone(rig, targetBoneName) || findRigBone(rig, sourceBoneName) || findRigBone(rig, name);
    if (!bone) {
      missing.push(sourceBoneName);
      return;
    }
    const rest = findRigRest(rig, targetBoneName) || findRigRest(rig, sourceBoneName) || findRigRest(rig, name) || findRigRest(rig, bone.name);
    if (!rest) return;
    bone.quaternion.copy(rest).multiply(runningHubTvDeltaQuaternion(sourceBoneName, rotation));
  });
  const devEnv = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;
  if (missing.length && devEnv) {
    const key = missing.sort().join('|');
    if (!warnedMixamoLocalCoverageKeys.has(key)) {
      warnedMixamoLocalCoverageKeys.add(key);
      console.warn('[Scene3DNode] Mixamo local pose skipped missing bones:', missing);
    }
  }
}

function applyFingerPoseToModel(
  rig: Scene3DCollectedRig,
  fingerPose?: StandardHumanFingerPose
) {
  const pose = cloneFingerPose(fingerPose);
  if (pose.bones) {
    Object.entries(pose.bones).forEach(([name, rotation]) => {
      const bone = findRigBone(rig, name);
      const rest = findRigRest(rig, name);
      if (!bone || !rest) return;
      bone.quaternion.copy(rest).multiply(vecToQuaternion(rotation));
    });
  }
  const hasExplicitBone = (name: string) => boneNameCandidates(name).some((candidate) => pose.bones?.[candidate]);
  const weights = [0.72, 0.58, 0.42];
  (['left', 'right'] as const).forEach((side) => {
    const hand = pose[side];
    const sideSign = side === 'left' ? 1 : -1;
    FINGER_OPTIONS.forEach((finger) => {
      const chain = FINGER_BONE_CHAINS[side][finger];
      const curl = clampNumber(hand[finger], FINGER_CURL_MIN, FINGER_CURL_MAX);
      const fistT = clamp01(curl / FINGER_CURL_MAX);
      chain.forEach((name, index) => {
        const preciseName = `mixamorig${side === 'left' ? 'Left' : 'Right'}Hand${FINGER_BONE_SUFFIXES[finger]}${index + 1}`;
        if (hasExplicitBone(preciseName) || hasExplicitBone(name)) return;
        const bone = findRigBone(rig, name);
        const rest = findRigRest(rig, name);
        if (!bone || !rest) return;
        const isThumb = finger === 'thumb';
        const spreadWeight = finger === 'thumb'
          ? 0.55
          : finger === 'index'
            ? -0.75
            : finger === 'middle'
              ? -0.12
              : finger === 'ring'
                ? 0.42
                : 0.78;
        const spreadT = clampNumber(hand.spread, FINGER_SPREAD_MIN, FINGER_SPREAD_MAX) / FINGER_SPREAD_MAX;
        const spreadInfluence = index === 0 ? (0.35 + (1 - fistT) * 0.65) : 0;
        const spreadOffset = hand.spread * spreadInfluence * sideSign * spreadWeight;
        const spreadFan = index === 0 && !isThumb
          ? spreadT * spreadInfluence * (finger === 'index' ? 18 : finger === 'middle' ? 4 : finger === 'ring' ? -10 : -18)
          : 0;
        const thumbOppose = isThumb && index === 0 ? sideSign * Math.min(72, curl * 0.62) : 0;
        const thumbAcrossPalm = isThumb && index === 0 ? -sideSign * Math.min(34, curl * 0.28) + sideSign * hand.spread * 0.22 : spreadFan;
        const delta = vecToQuaternion({
          x: curl * (isThumb ? [0.28, 0.62, 0.5][index] : weights[index]),
          y: spreadOffset + thumbOppose,
          z: thumbAcrossPalm
        });
        bone.quaternion.copy(rest).multiply(delta);
      });
    });
  });
}

function applyToePoseToModel(
  rig: Scene3DCollectedRig,
  toePose?: StandardHumanToePose
) {
  const pose = clampToePose(toePose);
  (Object.keys(TOE_BONE_NAMES) as ToeKey[]).forEach((key) => {
    const name = TOE_BONE_NAMES[key].find((candidate) => rig.byName.has(candidate) || rig.byName.has(runtimeBoneName(candidate)));
    if (!name) return;
    const bone = rig.byName.get(name) || rig.byName.get(runtimeBoneName(name));
    const rest = rig.rest.get(name) || rig.rest.get(runtimeBoneName(name));
    if (!bone || !rest) return;
    bone.quaternion.copy(rest).multiply(vecToQuaternion(pose[key]));
  });
}

function HumanProxy({
  character,
  effectivePose,
  showLabel,
  selected,
  onSelect
}: {
  character: CharacterObject;
  effectivePose: StandardHumanRigPose;
  showLabel: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const chestRef = useRef<THREE.Group>(null);
  const neckRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftUpperArmRef = useRef<THREE.Group>(null);
  const leftLowerArmRef = useRef<THREE.Group>(null);
  const rightUpperArmRef = useRef<THREE.Group>(null);
  const rightLowerArmRef = useRef<THREE.Group>(null);
  const leftUpperLegRef = useRef<THREE.Group>(null);
  const leftLowerLegRef = useRef<THREE.Group>(null);
  const rightUpperLegRef = useRef<THREE.Group>(null);
  const rightLowerLegRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const setRef = (ref: React.RefObject<THREE.Group | null>, rotation: RigRotation) => {
      if (!ref.current) return;
      ref.current.rotation.set(rad(rotation.x), rad(rotation.y), rad(rotation.z));
    };
    setRef(chestRef, effectivePose.chest);
    setRef(neckRef, effectivePose.neck);
    setRef(headRef, effectivePose.head);
    setRef(leftUpperArmRef, effectivePose.leftUpperArm);
    setRef(leftLowerArmRef, effectivePose.leftLowerArm);
    setRef(rightUpperArmRef, effectivePose.rightUpperArm);
    setRef(rightLowerArmRef, effectivePose.rightLowerArm);
    setRef(leftUpperLegRef, effectivePose.leftUpperLeg);
    setRef(leftLowerLegRef, effectivePose.leftLowerLeg);
    setRef(rightUpperLegRef, effectivePose.rightUpperLeg);
    setRef(rightLowerLegRef, effectivePose.rightLowerLeg);
  }, [effectivePose]);

  const material = <meshStandardMaterial color={character.color} roughness={0.58} metalness={0.08} />;
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <group position={[character.poseRootOffset?.x || 0, character.poseRootOffset?.y || 0, character.poseRootOffset?.z || 0]}>
      <group ref={chestRef}>
        <mesh position={[0, 1.1, 0]} castShadow><capsuleGeometry args={[0.18, 0.55, 12, 24]} />{material}</mesh>
        <group ref={neckRef} position={[0, 1.42, 0]}>
          <mesh position={[0, 0.06, 0]} castShadow><cylinderGeometry args={[0.05, 0.06, 0.14, 16]} />{material}</mesh>
          <group ref={headRef} position={[0, 0.18, 0]}>
            <mesh castShadow><sphereGeometry args={[0.17, 28, 16]} />{material}</mesh>
          </group>
        </group>
        <group ref={leftUpperArmRef} position={[-0.24, 1.22, 0]}>
          <mesh position={[0, -0.16, 0]} castShadow><capsuleGeometry args={[0.055, 0.34, 8, 16]} />{material}</mesh>
          <group ref={leftLowerArmRef} position={[0, -0.34, 0]}>
            <mesh position={[0, -0.15, 0]} castShadow><capsuleGeometry args={[0.05, 0.32, 8, 16]} />{material}</mesh>
          </group>
        </group>
        <group ref={rightUpperArmRef} position={[0.24, 1.22, 0]}>
          <mesh position={[0, -0.16, 0]} castShadow><capsuleGeometry args={[0.055, 0.34, 8, 16]} />{material}</mesh>
          <group ref={rightLowerArmRef} position={[0, -0.34, 0]}>
            <mesh position={[0, -0.15, 0]} castShadow><capsuleGeometry args={[0.05, 0.32, 8, 16]} />{material}</mesh>
          </group>
        </group>
      </group>
      <group ref={leftUpperLegRef} position={[-0.1, 0.86, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow><capsuleGeometry args={[0.07, 0.5, 8, 16]} />{material}</mesh>
        <group ref={leftLowerLegRef} position={[0, -0.54, 0]}>
          <mesh position={[0, -0.22, 0]} castShadow><capsuleGeometry args={[0.06, 0.45, 8, 16]} />{material}</mesh>
        </group>
      </group>
      <group ref={rightUpperLegRef} position={[0.1, 0.86, 0]}>
        <mesh position={[0, -0.25, 0]} castShadow><capsuleGeometry args={[0.07, 0.5, 8, 16]} />{material}</mesh>
        <group ref={rightLowerLegRef} position={[0, -0.54, 0]}>
          <mesh position={[0, -0.22, 0]} castShadow><capsuleGeometry args={[0.06, 0.45, 8, 16]} />{material}</mesh>
        </group>
      </group>
      </group>
      {selected && <SelectionRing radius={0.56} />}
      {showLabel && <NameLabel name={character.name} y={2.05} />}
    </group>
  );
}

function PropModel({ prop, selected, showLabel = true, onSelect }: { prop: PropObject; selected: boolean; showLabel?: boolean; onSelect: () => void }) {
  if (prop.shape === 'model' && prop.model) {
    return (
      <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
        <ImportedSceneModelPrimitive model={prop.model} color={prop.color} />
        {selected && <mesh><boxGeometry args={[1.1, 1.1, 1.1]} /><meshBasicMaterial color="#fbbf24" wireframe transparent opacity={0.45} /></mesh>}
        {showLabel && <NameLabel name={prop.name} y={1.05} />}
      </group>
    );
  }
  const geometry = prop.shape === 'sphere'
    ? <sphereGeometry args={[0.5, 32, 16]} />
    : prop.shape === 'cylinder'
      ? <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
      : prop.shape === 'cone'
        ? <coneGeometry args={[0.5, 1, 32]} />
        : prop.shape === 'plane'
          ? <boxGeometry args={[1, 0.04, 1]} />
          : prop.shape === 'torus'
            ? <torusGeometry args={[0.38, 0.12, 16, 48]} />
            : <boxGeometry args={[1, 1, 1]} />;
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <mesh castShadow receiveShadow>
        {geometry}
        <meshStandardMaterial color={prop.color} roughness={0.72} />
      </mesh>
      {selected && <mesh><boxGeometry args={[1.1, 1.1, 1.1]} /><meshBasicMaterial color="#fbbf24" wireframe transparent opacity={0.45} /></mesh>}
      {showLabel && <NameLabel name={prop.name} y={0.9} />}
    </group>
  );
}

function useImportedSceneObject(model: ImportedSceneModel) {
  const [loaded, setLoaded] = useState<THREE.Object3D | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setFailed(false);
    setLoading(true);
    const onLoad = (object: THREE.Object3D) => {
      if (!cancelled) {
        setLoaded(object);
        setLoading(false);
      }
    };
    const onError = () => {
      if (!cancelled) {
        setLoaded(null);
        setFailed(true);
        setLoading(false);
      }
    };
    if (model.format === 'glb' || model.format === 'gltf') {
      new GLTFLoader().load(model.url, (gltf) => onLoad(gltf.scene), undefined, onError);
    } else if (model.format === 'fbx') {
      new FBXLoader().load(model.url, onLoad, undefined, onError);
    } else {
      new OBJLoader().load(model.url, onLoad, undefined, onError);
    }
    return () => {
      cancelled = true;
    };
  }, [model.format, model.url]);
  const object = useMemo(() => {
    if (!loaded) return null;
    const clone = cloneSkeleton(loaded) as THREE.Object3D;
    clone.updateMatrixWorld(true);
    return clone;
  }, [loaded]);
  return { object, failed, loading };
}

function ImportedSceneModelPrimitive({ model, color }: { model: ImportedSceneModel; color: string }) {
  if (model.url.startsWith('blob:') && model.runtimeOnly !== true) {
    return <NormalizedImportedPrimitive object={null} color={color} failed fileName={`${model.fileName} failed to load`} />;
  }
  const { object, failed, loading } = useImportedSceneObject(model);
  return <NormalizedImportedPrimitive object={object} color={color} failed={failed} loading={loading} fileName={model.fileName} />;
}

function RiggedImportedSceneModelPrimitive({
  model,
  color,
  pose,
  bonePose,
  fingerPose,
  toePose
}: {
  model: ImportedSceneModel;
  color: string;
  pose: StandardHumanRigPose;
  bonePose?: Scene3DBonePose;
  fingerPose?: StandardHumanFingerPose;
  toePose?: StandardHumanToePose;
}) {
  if (model.url.startsWith('blob:') && model.runtimeOnly !== true) {
    return <NormalizedImportedPrimitive object={null} color={color} failed fileName={`${model.fileName} failed to load`} />;
  }
  const { object, failed, loading } = useImportedSceneObject(model);
  const rig = useMemo(() => (object ? collectRig(object) : null), [object]);
  useEffect(() => {
    if (!rig) return;
    applyRigPoseToModel(rig, pose, bonePose, fingerPose, toePose);
  }, [rig, pose, bonePose, fingerPose, toePose]);
  return <NormalizedImportedPrimitive object={object} color={color} failed={failed} loading={loading} fileName={model.fileName} />;
}

function NormalizedImportedPrimitive({ object, color, failed = false, loading = false, fileName }: { object: THREE.Object3D | null; color: string; failed?: boolean; loading?: boolean; fileName?: string }) {
  const normalized = useMemo(() => {
    if (!object) return null;
    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxSize = Math.max(size.x, size.y, size.z, 0.001);
    const scale = 1 / maxSize;
    return {
      scale,
      offset: new THREE.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale)
    };
  }, [object]);
  useEffect(() => {
    if (!object) return;
    object.traverse((child: any) => {
      if (child.isMesh) {
        child.visible = true;
        child.frustumCulled = false;
        child.castShadow = true;
        child.receiveShadow = true;
        const material = child.material?.clone?.();
        if (material) {
          if (material.color && color) material.color = new THREE.Color(color);
          material.side = THREE.DoubleSide;
          child.material = material;
        }
      }
    });
  }, [object, color]);
  if (!object || !normalized) {
    return (
      <group>
        <mesh>
          <boxGeometry args={[1.1, 1.1, 1.1]} />
          <meshStandardMaterial color={failed ? '#ef4444' : '#fbbf24'} wireframe transparent opacity={failed ? 0.85 : 0.65} />
        </mesh>
        <Html center distanceFactor={8} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <div className={`rounded border px-2 py-1 text-[11px] shadow ${failed ? 'border-red-400/40 bg-red-950/80 text-red-100' : 'border-amber-300/40 bg-black/75 text-amber-100'}`}>
            {failed ? '模型加载失败' : loading ? '模型加载中...' : '模型预览不可用'}{fileName ? ` - ${fileName}` : ''}
          </div>
        </Html>
      </group>
    );
  }
  return <primitive object={object} position={[normalized.offset.x, normalized.offset.y, normalized.offset.z]} scale={[normalized.scale, normalized.scale, normalized.scale]} />;
}

function CameraRig({ cameraObject, selected, onSelect }: { cameraObject: CameraObject; selected: boolean; onSelect: () => void }) {
  const frustum = useMemo(() => {
    const rootRotation = vecToQuaternion(cameraObject.rotation);
    const inverseRootRotation = rootRotation.clone().invert();
    const target = new THREE.Vector3(
      cameraObject.targetPosition.x - cameraObject.position.x,
      cameraObject.targetPosition.y - cameraObject.position.y,
      cameraObject.targetPosition.z - cameraObject.position.z
    ).applyQuaternion(inverseRootRotation);
    const distance = Math.max(0.7, target.length());
    const forward = target.lengthSq() > 0.0001 ? target.clone().normalize() : new THREE.Vector3(0, 0, -1);
    const worldUp = Math.abs(forward.dot(new THREE.Vector3(0, 1, 0))) > 0.94
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const far = Math.min(Math.max(distance, 1.6), 5.2) / 3;
    const projection = cameraLensProjection(cameraObject);
    const fovHeight = Math.tan(rad(projection.fov || 45) / 2) * far * 2;
    const height = Math.min(Math.max(fovHeight, 0.75), 2.3) / 3;
    const width = height * (cameraObject.lensType === 'panorama' ? 2.35 : cameraObject.lensType === 'fisheye' ? 1.9 : 1.6);
    const center = forward.clone().multiplyScalar(far);
    const topLeft = center.clone().add(up.clone().multiplyScalar(height / 2)).add(right.clone().multiplyScalar(-width / 2));
    const topRight = center.clone().add(up.clone().multiplyScalar(height / 2)).add(right.clone().multiplyScalar(width / 2));
    const bottomRight = center.clone().add(up.clone().multiplyScalar(-height / 2)).add(right.clone().multiplyScalar(width / 2));
    const bottomLeft = center.clone().add(up.clone().multiplyScalar(-height / 2)).add(right.clone().multiplyScalar(-width / 2));
    const bodyYaw = Math.atan2(-forward.x, -forward.z);
    const bodyPitch = -Math.asin(clampNumber(forward.y, -1, 1));
    return {
      forward,
      bodyRotation: new THREE.Euler(bodyPitch, bodyYaw, 0, 'YXZ'),
      nearLine: [new THREE.Vector3(0, 0, 0), center],
      rays: [
        [new THREE.Vector3(0, 0, 0), topLeft],
        [new THREE.Vector3(0, 0, 0), topRight],
        [new THREE.Vector3(0, 0, 0), bottomRight],
        [new THREE.Vector3(0, 0, 0), bottomLeft]
      ],
      frame: [topLeft, topRight, bottomRight, bottomLeft, topLeft]
    };
  }, [cameraObject.fisheyeStrength, cameraObject.fov, cameraObject.lensType, cameraObject.position, cameraObject.rotation, cameraObject.targetPosition]);
  const bodyColor = selected ? '#f59e0b' : '#d97706';
  const frustumColor = selected ? '#67e8f9' : '#38bdf8';
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <group rotation={frustum.bodyRotation}>
        <mesh castShadow receiveShadow position={[0, 0, 0.02]}>
          <boxGeometry args={[0.58, 0.34, 0.26]} />
          <meshStandardMaterial color={bodyColor} roughness={0.48} metalness={0.08} />
        </mesh>
        <mesh castShadow position={[-0.18, 0.205, 0.02]}>
          <boxGeometry args={[0.22, 0.06, 0.13]} />
          <meshStandardMaterial color={bodyColor} roughness={0.45} />
        </mesh>
        <mesh castShadow position={[0.06, 0, -0.17]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.135, 0.18, 0.22, 28]} />
          <meshStandardMaterial color="#111827" roughness={0.32} metalness={0.16} />
        </mesh>
        <mesh position={[0.06, 0, -0.295]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.098, 0.098, 0.022, 28]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
        <mesh position={[0.1, 0.036, -0.308]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.039, 20]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.86} />
        </mesh>
        {selected && (
          <mesh position={[0, 0, 0.02]}>
            <boxGeometry args={[0.64, 0.4, 0.32]} />
            <meshBasicMaterial color="#fbbf24" wireframe transparent opacity={0.48} />
          </mesh>
        )}
      </group>
      <Line points={frustum.nearLine} color={frustumColor} lineWidth={1.4} transparent opacity={0.62} />
      {frustum.rays.map((points, index) => (
        <Line key={`camera-ray-${index}`} points={points} color={frustumColor} lineWidth={1.35} transparent opacity={0.75} />
      ))}
      <Line points={frustum.frame} color={frustumColor} lineWidth={1.45} transparent opacity={0.86} />
      {selected && (
        <Line points={frustum.frame} color="#fbbf24" lineWidth={2} transparent opacity={0.9} />
      )}
      <NameLabel name={cameraObject.name} y={0.5} />
    </group>
  );
}

function LightRig({ light, selected, onSelect }: { light: LightObject; selected: boolean; onSelect: () => void }) {
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <mesh castShadow><sphereGeometry args={[0.16, 24, 12]} /><meshBasicMaterial color={selected ? '#fde68a' : light.color} /></mesh>
      <NameLabel name={light.name} y={0.35} />
    </group>
  );
}

function NameLabel({ name, y }: { name: string; y: number }) {
  return (
    <Html position={[0, y, 0]} center distanceFactor={8} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
      <div className="rounded bg-black/70 px-2 py-0.5 text-[11px] leading-none text-white shadow">{name}</div>
    </Html>
  );
}

// Editor side panels: object tree and selected-object properties.
function ObjectPanel({
  scene,
  objectSearch,
  onObjectSearch,
  onPatch,
  onAddCharacter,
  onAddProp,
  onAddCamera,
  onAddLight,
  onImportCustomModel,
  onUpdateObject
}: {
  scene: Scene3DState;
  objectSearch: string;
  onObjectSearch: (value: string) => void;
  onPatch: SceneChangeHandler;
  onAddCharacter: (gender: CharacterGender) => void;
  onAddProp: (shape: PropShape) => void;
  onAddCamera: (templateId?: CameraTemplateId) => void;
  onAddLight: (lightType?: LightType) => void;
  onImportCustomModel: (target: 'character' | 'prop', file: File | null | undefined) => void;
  onUpdateObject: (kind: ObjectKind, id: string, patch: any) => void;
}) {
  const matches = (name: string) => !objectSearch.trim() || name.toLowerCase().includes(objectSearch.trim().toLowerCase());
  return (
    <div className="min-h-0 overflow-y-auto p-2">
      <input
        value={objectSearch}
        onChange={(event) => onObjectSearch(event.target.value)}
        className="mb-2 h-8 w-full rounded-md border border-white/10 bg-black/25 px-2 text-xs text-white outline-none"
        placeholder="搜索对象"
      />
      <ObjectSection title="自定义模型" icon={<Maximize2 />}>
        <ModelImportButton label="导入角色模型" onImport={(file) => onImportCustomModel('character', file)} />
        <ModelImportButton label="导入道具模型" onImport={(file) => onImportCustomModel('prop', file)} />
      </ObjectSection>
      <ObjectSection
        title="角色"
        icon={<UserRound />}
        addMenu={CHARACTER_ADD_OPTIONS.map((item) => ({ id: item.id, label: item.label, icon: item.id === 'female' ? <Users /> : <UserRound />, onSelect: () => onAddCharacter(item.id) }))}
      >
        {scene.objects.characters.filter((item) => matches(item.name)).map((item) => (
          <ObjectRow
            key={item.id}
            name={item.name}
            active={scene.selectedObjectId === item.id}
            visible={item.visible}
            locked={item.locked}
            onSelect={() => onPatch({ selectedObjectId: item.id, activeTransitionId: scene.poseTransitions.find((transition) => transition.characterId === item.id)?.id }, { history: false })}
            onRename={(name) => onUpdateObject('character', item.id, { name })}
            onToggleVisible={() => onUpdateObject('character', item.id, { visible: !item.visible })}
            onToggleLocked={() => onUpdateObject('character', item.id, { locked: !item.locked })}
          />
        ))}
      </ObjectSection>
      <ObjectSection
        title="道具"
        icon={<Box />}
        addMenu={PROP_CREATION_OPTIONS.map((item) => ({ id: item.id, label: item.label, icon: <Box />, onSelect: () => onAddProp(item.id) }))}
      >
        {sortedSceneProps(scene.objects.props).filter((item) => matches(item.name)).map((item) => (
          <ObjectRow
            key={item.id}
            name={item.name}
            active={scene.selectedObjectId === item.id}
            visible={item.visible}
            locked={item.locked}
            onSelect={() => onPatch({ selectedObjectId: item.id }, { history: false })}
            onRename={(name) => onUpdateObject('prop', item.id, { name })}
            onToggleVisible={() => onUpdateObject('prop', item.id, { visible: !item.visible })}
            onToggleLocked={() => onUpdateObject('prop', item.id, { locked: !item.locked })}
          />
        ))}
      </ObjectSection>
      <ObjectSection title="灯光" icon={<Lightbulb />} addMenu={LIGHT_ADD_OPTIONS.map((item) => ({ id: item.id, label: item.label, icon: <Lightbulb />, onSelect: () => onAddLight(item.id) }))}>
        {sortedSceneLights(scene.objects.lights).filter((item) => matches(item.name)).map((item) => (
          <ObjectRow
            key={item.id}
            name={item.name}
            active={scene.selectedObjectId === item.id}
            visible={item.visible}
            locked={item.locked}
            onSelect={() => onPatch({ selectedObjectId: item.id }, { history: false })}
            onRename={(name) => onUpdateObject('light', item.id, { name })}
            onToggleVisible={() => onUpdateObject('light', item.id, { visible: !item.visible })}
            onToggleLocked={() => onUpdateObject('light', item.id, { locked: !item.locked })}
          />
        ))}
      </ObjectSection>
      <ObjectSection
        title="机位"
        icon={<Camera />}
        addMenu={CAMERA_TEMPLATE_OPTIONS.map((item) => ({ id: item.id, label: item.label, icon: <Camera />, onSelect: () => onAddCamera(item.id) }))}
      >
        {scene.objects.cameras.filter((item) => matches(item.name)).map((item) => (
          <ObjectRow
            key={item.id}
            name={item.name}
            active={scene.selectedObjectId === item.id}
            visible={item.visible}
            locked={item.locked}
            onSelect={() => onPatch({ selectedObjectId: item.id }, { history: false })}
            onRename={(name) => onUpdateObject('camera', item.id, { name })}
            onToggleVisible={() => onUpdateObject('camera', item.id, { visible: !item.visible })}
            onToggleLocked={() => onUpdateObject('camera', item.id, { locked: !item.locked })}
          />
        ))}
      </ObjectSection>
    </div>
  );
}


function PropertyPanel({
  node,
  scene,
  currentProjectId,
  selectedKind,
  preview,
  previewSample,
  activeTransition,
  onPatch,
  onUpdateObject,
  onDeleteSelected,
  onSelectTransition,
  onPreviewChange,
  onError
}: {
  node: CanvasNode;
  scene: Scene3DState;
  currentProjectId?: string | null;
  selectedKind: ObjectKind | null;
  preview: PreviewState;
  previewSample: AnimationClipSample | null;
  activeTransition: PoseTransition | null;
  onPatch: SceneChangeHandler;
  onUpdateObject: ObjectChangeHandler;
  onDeleteSelected: () => void;
  onSelectTransition: (transitionId: string) => void;
  onPreviewChange: React.Dispatch<React.SetStateAction<PreviewState>>;
  onError: (message: string) => void;
}) {
  const [characterTab, setCharacterTab] = useState<PoseTab>('property');
  const [motionResolving, setMotionResolving] = useState(false);
  const [motionGenerating, setMotionGenerating] = useState(false);
  const [poseReferenceSolving, setPoseReferenceSolving] = useState(false);
  const [poseReferenceError, setPoseReferenceError] = useState('');
  const [poseReferenceResult, setPoseReferenceResult] = useState<PoseReferenceSolveResult | null>(null);
  const [selectedFinger, setSelectedFinger] = useState<FingerKey>('index');
  const [selectedToe, setSelectedToe] = useState<ToeKey>('leftBase');
  const poseEditSnapshotRef = useRef<Scene3DHistorySnapshot | null>(null);
  const poseEditCharacterIdRef = useRef<string | null>(null);
  const poseEditCommitTimerRef = useRef<number | null>(null);
  const objectEditSnapshotRef = useRef<Scene3DHistorySnapshot | null>(null);
  const objectEditKeyRef = useRef<string | null>(null);
  const objectEditCommitTimerRef = useRef<number | null>(null);
  const latestSceneRef = useRef(scene);
  const selectedId = scene.selectedObjectId;
  const character = scene.objects.characters.find((item) => item.id === selectedId);
  const prop = scene.objects.props.find((item) => item.id === selectedId);
  const camera = scene.objects.cameras.find((item) => item.id === selectedId);
  const light = scene.objects.lights.find((item) => item.id === selectedId);
  const characterUniformScale = character
    ? Number(((Math.abs(character.scale.x || 1) + Math.abs(character.scale.y || 1) + Math.abs(character.scale.z || 1)) / 3).toFixed(2))
    : 1;
  const characterFingerPose = character ? cloneEditableFingerPose(character.fingerPose) : cloneFingerPose();
  const characterToePose = character ? clampToePose(character.toePose) : cloneToePose();
  const characterTransitions = character ? scene.poseTransitions.filter((item) => item.characterId === character.id) : [];
  const currentTransition = character && activeTransition?.characterId === character.id ? activeTransition : characterTransitions[0] || null;

  useEffect(() => {
    latestSceneRef.current = scene;
  }, [scene]);

  const patchScene: SceneChangeHandler = (updater, options) => {
    onPatch((current) => {
      const nextScene = typeof updater === 'function'
        ? normalizeScene(updater(current))
        : normalizeScene({ ...current, ...updater });
      latestSceneRef.current = nextScene;
      return nextScene;
    }, options);
  };

  const patchTransition = (
    transitionId: string,
    patch: Partial<PoseTransition> | ((transition: PoseTransition) => PoseTransition),
    options: SceneChangeOptions = {}
  ) => {
    patchScene((current) => normalizeScene({
      ...current,
      poseTransitions: current.poseTransitions.map((item) => {
        if (item.id !== transitionId) return item;
        return typeof patch === 'function'
          ? patch(item)
          : { ...item, ...patch, updatedAt: new Date().toISOString() };
      })
    }), {
      label: options.label || '修改补间片段',
      mergeKey: options.mergeKey,
      history: options.history,
      preserveHistory: options.preserveHistory,
      historyBefore: options.historyBefore
    });
  };

  const createTransition = () => {
    if (!character) {
      onError('请先选择一个角色。');
      return null;
    }
    const created: PoseTransition = {
      id: createId('transition'),
      name: `${character.name} 动作补间`,
      characterId: character.id,
      actionPrompt: '',
      actionPlan: { templates: [], notes: [] },
      motionRefineHistory: [],
      regenerateLockScope: 'none',
      constraints: defaultConstraints(),
      durationSec: 1.2,
      curve: 'ease_in_out',
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    patchScene((current) => normalizeScene({
      ...current,
      poseTransitions: [...current.poseTransitions, created],
      activeTransitionId: created.id
    }), { label: '新建补间片段' });
    onPreviewChange((current) => ({ ...current, transitionId: created.id, currentTimeSec: 0, playing: false, enabled: false }));
    return created;
  };

  const ensureTransition = () => currentTransition || createTransition();

  const patchTransitionInput = (transitionId: string, patch: Partial<PoseTransition>) => {
    const invalidatesMotionIntent = Boolean(patch.actionPrompt !== undefined || patch.durationSec !== undefined || patch.curve !== undefined);
    patchTransition(transitionId, {
      ...patch,
      ...(invalidatesMotionIntent ? {
        aiActionIntent: undefined,
        generatedMotionPrompt: undefined,
        motionIntent: undefined
      } : {}),
      animationClip: undefined,
      error: undefined
    }, {
      label: '修改补间片段',
      mergeKey: `transition:${transitionId}:${Object.keys(patch).sort().join(',')}`
    });
  };

  const beginObjectEdit = (kind: ObjectKind, id: string) => {
    const key = `${kind}:${id}`;
    if (objectEditSnapshotRef.current && objectEditKeyRef.current === key) return;
    if (objectEditCommitTimerRef.current !== null) {
      window.clearTimeout(objectEditCommitTimerRef.current);
      objectEditCommitTimerRef.current = null;
    }
    objectEditSnapshotRef.current = createHistorySnapshot(latestSceneRef.current);
    objectEditKeyRef.current = key;
  };

  const commitObjectEdit = (kind?: ObjectKind, id?: string) => {
    const before = objectEditSnapshotRef.current;
    const editKey = objectEditKeyRef.current;
    if (!before || !editKey) return;
    if (kind && id && editKey !== `${kind}:${id}`) return;
    if (objectEditCommitTimerRef.current !== null) {
      window.clearTimeout(objectEditCommitTimerRef.current);
      objectEditCommitTimerRef.current = null;
    }
    objectEditSnapshotRef.current = null;
    objectEditKeyRef.current = null;
    patchScene((current) => current, {
      label: '调整对象参数',
      mergeKey: `${editKey}:sliders`,
      historyBefore: before
    });
  };

  const scheduleObjectEditCommit = (kind: ObjectKind, id: string) => {
    if (objectEditCommitTimerRef.current !== null) window.clearTimeout(objectEditCommitTimerRef.current);
    objectEditCommitTimerRef.current = window.setTimeout(() => {
      objectEditCommitTimerRef.current = null;
      commitObjectEdit(kind, id);
    }, 280);
  };

  const updateObjectLive = (kind: ObjectKind, id: string, patch: any) => {
    beginObjectEdit(kind, id);
    onUpdateObject(kind, id, patch, { history: false, preserveHistory: true });
    scheduleObjectEditCommit(kind, id);
  };

  const saveCurrentPoseToTransition = (mode: 'start' | 'end') => {
    if (!character) {
      onError('请先选择一个角色。');
      return;
    }
    const transition = ensureTransition();
    if (!transition) return;
    const captured = captureCharacterState(character);
    patchTransition(transition.id, {
      [`${mode}Pose`]: captured.pose,
      [`${mode}BonePose`]: captured.bonePose,
      [`${mode}FingerPose`]: captured.fingerPose,
      [`${mode}ToePose`]: captured.toePose,
      [`${mode}PosePresetId`]: captured.posePresetId,
      [`${mode}LibTvJointAngles`]: captured.libTvJointAngles,
      [`${mode}Transform`]: captured.transform,
      aiActionIntent: undefined,
      generatedMotionPrompt: undefined,
      motionIntent: undefined,
      animationClip: undefined,
      error: undefined
    } as Partial<PoseTransition>, { label: mode === 'start' ? '设置起始姿势' : '设置结束姿势' });
    onError('');
  };

  const jumpToTransitionPose = (mode: 'start' | 'end') => {
    if (!character || !currentTransition) return;
    const pose = mode === 'start' ? currentTransition.startPose : currentTransition.endPose;
    const bonePose = mode === 'start' ? currentTransition.startBonePose : currentTransition.endBonePose;
    const fingerPoseValue = mode === 'start' ? currentTransition.startFingerPose : currentTransition.endFingerPose;
    const toePoseValue = mode === 'start' ? currentTransition.startToePose : currentTransition.endToePose;
    const posePresetId = mode === 'start' ? currentTransition.startPosePresetId : currentTransition.endPosePresetId;
    const libTvJointAngles = mode === 'start' ? currentTransition.startLibTvJointAngles : currentTransition.endLibTvJointAngles;
    const transform = mode === 'start' ? currentTransition.startTransform : currentTransition.endTransform;
    if (!pose || !transform) {
      onError(mode === 'start' ? '还没有保存起始姿势。' : '还没有保存结束姿势。');
      return;
    }
    onUpdateObject('character', character.id, {
      position: transform.position,
      rotation: transform.rotation,
      scale: transform.scale,
      posePreset: posePresetId || 'custom',
      posePresetId: posePresetId || 'custom',
      libTvJointAngles: cloneLibTvJointAngles(libTvJointAngles),
      bonePose: cloneBonePose(bonePose),
      fingerPose: cloneFingerPose(fingerPoseValue),
      toePose: cloneToePose(toePoseValue),
      rigPose: pose
    });
    onPreviewChange((current) => ({
      ...current,
      transitionId: currentTransition.id,
      currentTimeSec: mode === 'start' ? 0 : currentTransition.animationClip?.durationSec || currentTransition.durationSec,
      playing: false,
      enabled: false
    }));
    onError('');
  };

  const appendMotionHistory = (
    transition: PoseTransition,
    mode: MotionRefineHistoryEntry['mode'],
    motionIntent: MotionIntent | undefined,
    error?: string
  ): MotionRefineHistoryEntry[] => ([
    ...(transition.motionRefineHistory || []),
    {
      id: createId('motion_refine'),
      transitionId: transition.id,
      requestedAt: new Date().toISOString(),
      appliedAt: motionIntent ? new Date().toISOString() : undefined,
      mode,
      requestSummary: {
        actionPrompt: transition.actionPrompt,
        durationSec: transition.durationSec,
        selectedCharacterId: transition.characterId,
        usedReferenceAssetId: scene.captures[scene.captures.length - 1]?.mediaAssetId
      },
      motionIntent,
      error
    }
  ]).slice(-20);

  const localPlanFromIntent = (transition: PoseTransition, intent: MotionIntent | undefined) => {
    const localPlan = resolveActionPlan(scene, transition.actionPrompt);
    if (!intent) return localPlan;
    return {
      mode: 'motion_intent' as const,
      templates: localPlan.templates,
      universal: motionIntentToUniversalPlan(intent),
      notes: [
        intent.intent ? `AI 动作意图：${intent.intent}` : '',
        intent.generatedMotionPrompt ? `AI 生成动作提示：${intent.generatedMotionPrompt}` : '',
        ...intent.warnings,
        ...localPlan.notes
      ].filter(Boolean)
    };
  };

  const resolveTransitionPlan = () => {
    const transition = ensureTransition();
    if (!transition) return;
    const plan = resolveActionPlan(scene, transition.actionPrompt);
    patchTransition(transition.id, {
      actionPlan: plan,
      warnings: plan.notes,
      animationClip: undefined,
      error: undefined
    }, { label: '解析动作模板' });
    onError(plan.notes.join(' '));
  };

  const regenerateTransition = () => {
    const transition = ensureTransition();
    if (!transition) return;
    const merged = generateTransition(scene, transitionWithPresetReferenceEndpoints({
      ...transition,
      actionPlan: resolveActionPlan(scene, transition.actionPrompt),
      updatedAt: new Date().toISOString()
    }));
    patchTransition(transition.id, merged, { label: '生成姿势过渡' });
    onSelectTransition(transition.id);
    onPreviewChange((current) => ({ ...current, transitionId: transition.id, currentTimeSec: 0, playing: false, enabled: true }));
    onError(merged.error || merged.warnings.join(' '));
  };

  const applyQualityFix = (fixKind: MotionQualityFixKind) => {
    if (!currentTransition?.animationClip) return;
    const autoResult = fixKind === 'auto' ? applyMotionQualityAutoFix(currentTransition) : null;
    const fixed = autoResult?.transition || applyMotionQualityFix(currentTransition, fixKind);
    patchTransition(currentTransition.id, fixed, { label: '优化补间质量' });
    onPreviewChange((current) => ({
      ...current,
      transitionId: currentTransition.id,
      currentTimeSec: 0,
      playing: false,
      enabled: true
    }));
    onError(autoResult?.summary || uniqueQualityMessages(fixed.qualityReport).join(' '));
  };

  const resolveTransitionPlanWithAi = async () => {
    const transition = ensureTransition();
    if (!transition) return;
    try {
      setMotionResolving(true);
      const intent = await requestMotionIntent(buildMotionRefinePayload({ node, scene, transition, character, currentProjectId }));
      const plan = localPlanFromIntent(transition, intent);
      patchTransition(transition.id, {
        actionPlan: plan,
        aiActionIntent: intent.intent,
        generatedMotionPrompt: intent.generatedMotionPrompt,
        motionIntent: intent,
        motionRefineHistory: appendMotionHistory(transition, 'resolve', intent),
        warnings: [...intent.warnings, ...plan.notes],
        animationClip: undefined,
        error: undefined
      }, { label: 'AI 解析动作' });
      onError(intent.warnings.join(' '));
    } catch (error: any) {
      const message = error?.message || 'AI 解析失败';
      const plan = resolveActionPlan(scene, transition.actionPrompt);
      const fallbackNote = `AI 解析失败，已保留本地模板解析：${message}`;
      patchTransition(transition.id, {
        actionPlan: plan,
        motionRefineHistory: appendMotionHistory(transition, 'resolve', undefined, message),
        warnings: [fallbackNote, ...plan.notes],
        animationClip: undefined,
        error: message
      }, { label: 'AI 解析失败' });
      onError(fallbackNote);
    } finally {
      setMotionResolving(false);
    }
  };

  const regenerateTransitionWithAi = async () => {
    const transition = ensureTransition();
    if (!transition) return;
    try {
      setMotionGenerating(true);
      const intent = transition.motionIntent || await requestMotionIntent(buildMotionRefinePayload({ node, scene, transition, character, currentProjectId }));
      const plan = localPlanFromIntent(transition, intent);
      const merged = generateTransition(scene, transitionWithPresetReferenceEndpoints({
        ...transition,
        actionPlan: plan,
        aiActionIntent: intent.intent,
        generatedMotionPrompt: intent.generatedMotionPrompt,
        motionIntent: intent,
        motionRefineHistory: appendMotionHistory(transition, 'generate', intent),
        warnings: [...intent.warnings, ...plan.notes],
        updatedAt: new Date().toISOString()
      }));
      patchTransition(transition.id, merged, { label: 'AI 生成补间' });
      onSelectTransition(transition.id);
      onPreviewChange((current) => ({ ...current, transitionId: transition.id, currentTimeSec: 0, playing: false, enabled: true }));
      onError(merged.error || merged.warnings.join(' '));
    } catch (error: any) {
      const message = error?.message || 'AI 生成失败';
      const fallbackNote = `AI 生成失败，已使用本地补间生成：${message}`;
      const fallbackTransition = {
        ...transition,
        actionPlan: resolveActionPlan(scene, transition.actionPrompt),
        motionRefineHistory: appendMotionHistory(transition, 'generate', undefined, message),
        updatedAt: new Date().toISOString()
      };
      const merged = generateTransition(scene, transitionWithPresetReferenceEndpoints(fallbackTransition));
      patchTransition(transition.id, {
        ...merged,
        warnings: [fallbackNote, ...merged.warnings],
        error: message
      }, { label: 'AI 生成失败' });
      onSelectTransition(transition.id);
      onPreviewChange((current) => ({ ...current, transitionId: transition.id, currentTimeSec: 0, playing: false, enabled: true }));
      onError(fallbackNote);
    } finally {
      setMotionGenerating(false);
    }
  };

  const exitPosePreviewForEditing = () => {
    if (!character) return;
    onPreviewChange((current) => {
      if (!current.transitionId) return current;
      const previewTransition = scene.poseTransitions.find((item) => item.id === current.transitionId);
      if (previewTransition?.characterId !== character.id) return current;
      return { ...current, transitionId: undefined, currentTimeSec: 0, playing: false, enabled: false };
    });
    if (scene.activeTransitionId) {
      const active = scene.poseTransitions.find((item) => item.id === scene.activeTransitionId);
      if (active?.characterId === character.id) patchScene({ activeTransitionId: undefined }, { history: false });
    }
  };

  const beginPoseEdit = () => {
    if (!character || poseEditSnapshotRef.current) return;
    poseEditSnapshotRef.current = createHistorySnapshot(latestSceneRef.current);
    poseEditCharacterIdRef.current = character.id;
  };

  const commitPoseEdit = () => {
    if (!character || !poseEditSnapshotRef.current || poseEditCharacterIdRef.current !== character.id) return;
    if (poseEditCommitTimerRef.current !== null) {
      window.clearTimeout(poseEditCommitTimerRef.current);
      poseEditCommitTimerRef.current = null;
    }
    const before = poseEditSnapshotRef.current;
    poseEditSnapshotRef.current = null;
    poseEditCharacterIdRef.current = null;
    patchScene((current) => current, {
      label: `调整 ${character.name} 姿势`,
      mergeKey: `character:${character.id}:pose`,
      historyBefore: before
    });
  };

  const schedulePoseEditCommit = () => {
    if (poseEditCommitTimerRef.current !== null) window.clearTimeout(poseEditCommitTimerRef.current);
    poseEditCommitTimerRef.current = window.setTimeout(() => {
      poseEditCommitTimerRef.current = null;
      commitPoseEdit();
    }, 280);
  };

  useEffect(() => {
    commitPoseEdit();
    commitObjectEdit();
    setCharacterTab('property');
    setPoseReferenceError('');
    setPoseReferenceResult(null);
    setPoseReferenceSolving(false);
  }, [selectedKind, selectedId]);

  useEffect(() => () => {
    commitPoseEdit();
    commitObjectEdit();
  }, [character?.id]);

  const updateCharacterPose = (patch: Partial<CharacterObject>, options: SceneChangeOptions = {}) => {
    if (!character) return;
    exitPosePreviewForEditing();
    const latestCharacter = latestSceneRef.current.objects.characters.find((item) => item.id === character.id) || character;
    const nextPatch = {
      ...patch,
      rigPose: patch.rigPose ? clonePose(patch.rigPose) : patch.rigPose,
      fingerPose: patch.fingerPose ? cloneFingerPose(patch.fingerPose) : patch.fingerPose,
      toePose: patch.toePose ? cloneToePose(patch.toePose) : patch.toePose
    };
    const isLivePoseEdit = options.history !== true && (
      patch.rigPose !== undefined ||
      patch.fingerPose !== undefined ||
      patch.toePose !== undefined
    ) && patch.posePresetId === 'custom' && patch.libTvJointAngles === undefined;
    if (isLivePoseEdit) {
      beginPoseEdit();
      patchScene((current) => normalizeScene({
        ...current,
        objects: {
          ...current.objects,
          characters: current.objects.characters.map((item) => item.id === latestCharacter.id ? { ...item, ...nextPatch } : item)
        }
      }), { history: false, preserveHistory: true });
      schedulePoseEditCommit();
      return;
    }
    if (options.history === false) {
      patchScene((current) => normalizeScene({
        ...current,
        objects: {
          ...current.objects,
          characters: current.objects.characters.map((item) => item.id === latestCharacter.id ? { ...item, ...nextPatch } : item)
        }
      }), { history: false, preserveHistory: true });
      return;
    }
    onUpdateObject('character', latestCharacter.id, nextPatch);
  };

  const updateCharacterRigJointLive = (jointKey: PoseJointKey, value: RigRotation) => {
    if (!character) return;
    const latestCharacter = latestSceneRef.current.objects.characters.find((item) => item.id === character.id) || character;
    beginPoseEdit();
    updateCharacterPose({
      posePreset: 'custom',
      posePresetId: 'custom',
      libTvJointAngles: undefined,
      bonePose: undefined,
      fingerPose: cloneEditableFingerPose(latestCharacter.fingerPose),
      toePose: cloneToePose(latestCharacter.toePose),
      rigPose: patchPose(latestCharacter.rigPose, { [jointKey]: value })
    }, { history: false });
  };

  const updateCharacterFingerLive = (side: BodySide, finger: FingerKey | 'spread', value: number) => {
    if (!character) return;
    const latestCharacter = latestSceneRef.current.objects.characters.find((item) => item.id === character.id) || character;
    const nextFingerPose = cloneEditableFingerPose(latestCharacter.fingerPose);
    nextFingerPose[side] = {
      ...nextFingerPose[side],
      [finger]: finger === 'spread'
        ? clampNumber(value, FINGER_SPREAD_MIN, FINGER_SPREAD_MAX)
        : clampNumber(value, FINGER_CURL_MIN, FINGER_CURL_MAX)
    };
    beginPoseEdit();
    updateCharacterPose({
      posePreset: 'custom',
      posePresetId: 'custom',
      libTvJointAngles: undefined,
      rigPose: clonePose(latestCharacter.rigPose),
      toePose: cloneToePose(latestCharacter.toePose),
      fingerPose: nextFingerPose
    }, { history: false });
  };

  const updateCharacterToeLive = (toe: ToeKey, value: RigRotation) => {
    if (!character) return;
    const latestCharacter = latestSceneRef.current.objects.characters.find((item) => item.id === character.id) || character;
    const nextToePose = clampToePose(latestCharacter.toePose);
    nextToePose[toe] = clampToeRotation(toe, value);
    beginPoseEdit();
    updateCharacterPose({
      posePreset: 'custom',
      posePresetId: 'custom',
      libTvJointAngles: undefined,
      rigPose: clonePose(latestCharacter.rigPose),
      fingerPose: cloneEditableFingerPose(latestCharacter.fingerPose),
      toePose: nextToePose
    }, { history: false });
  };

  const buildCurrentTweenClip = () => {
    if (!currentTransition) return;
    const generated = generateTransition(scene, transitionWithPresetReferenceEndpoints({
      ...currentTransition,
      actionPlan: currentTransition.actionPlan?.templates?.length ? currentTransition.actionPlan : resolveActionPlan(scene, currentTransition.actionPrompt),
      updatedAt: new Date().toISOString()
    }));
    patchTransition(currentTransition.id, generated, { label: '按预设重算补间' });
    onSelectTransition(currentTransition.id);
    onPreviewChange((current) => ({ ...current, transitionId: currentTransition.id, currentTimeSec: 0, playing: false, enabled: true }));
    onError(generated.error || generated.warnings.join(' '));
  };

  const applyPreset = (presetId: string) => {
    if (!character) return;
    if (presetId === 'custom') {
      updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined });
      return;
    }
    const normalizedPresetId = normalizePosePresetId(presetId);
    const resolvedPreset = resolvePosePresetState(normalizedPresetId);
    if (!resolvedPreset) return;
    updateCharacterPose(posePatchFromPresetState(resolvedPreset));
    onError('');
  };

  const uploadPoseReferenceImage = async (view: PoseReferenceView, file: File | null | undefined) => {
    if (!character || !file) return;
    try {
      const image = await uploadPoseReferenceImageFile(view, file);
      onUpdateObject('character', character.id, {
        poseReferenceImages: {
          ...(character.poseReferenceImages || {}),
          [view]: image
        }
      });
      onError('');
    } catch (error: any) {
      onError(error?.message || '上传姿势参考图失败');
    }
  };

  const removePoseReferenceImage = (view: PoseReferenceView) => {
    if (!character) return;
    const next = { ...(character.poseReferenceImages || {}) };
    delete next[view];
    onUpdateObject('character', character.id, { poseReferenceImages: next });
    setPoseReferenceResult(null);
    setPoseReferenceError('');
    onError('');
  };

  const solvePoseReference = async () => {
    if (!character) return;
    const uploadedImages = POSE_REFERENCE_VIEW_OPTIONS
      .map((item) => character.poseReferenceImages?.[item.id])
      .filter((image): image is PoseReferenceImage => Boolean(image?.assetId));
    if (uploadedImages.length < 1) {
      setPoseReferenceError('请至少上传一张姿势参考图。');
      return;
    }
    setPoseReferenceSolving(true);
    setPoseReferenceError('');
    setPoseReferenceResult(null);
    try {
      const result = await requestPoseReferenceSolve(
        buildPoseReferenceSolvePayload({ node, scene, character, currentProjectId }),
        jointAxisProfileForScene(scene)
      );
      const historyItem = createPoseReferenceSolveHistoryItem(result, character.poseReferenceImages);
      setPoseReferenceResult(result);
      onUpdateObject('character', character.id, {
        poseReferenceSolveHistory: [
          historyItem,
          ...(character.poseReferenceSolveHistory || []).filter((item) => item.id !== historyItem.id)
        ].slice(0, 8)
      });
      onError('');
    } catch (error: any) {
      setPoseReferenceError(error?.message || '姿势参考图解析失败');
    } finally {
      setPoseReferenceSolving(false);
    }
  };

  const applyPoseReferenceResult = () => {
    if (!character || !poseReferenceResult) return;
    updateCharacterPose({
      posePreset: 'custom',
      posePresetId: 'custom',
      libTvJointAngles: undefined,
      ...(poseReferenceResult.rootOffset ? { poseRootOffset: poseReferenceResult.rootOffset } : {}),
      bonePose: cloneBonePose(poseReferenceResult.bonePose),
      rigPose: poseReferenceResult.rigPose
    });
  };

  const replayPoseReferenceSolve = (item: PoseReferenceSolveHistoryItem) => {
    setPoseReferenceResult(item);
    setPoseReferenceError('');
    onError('');
  };

  return (
    <div className="min-h-0 overflow-y-auto p-3 text-xs">
      {!selectedKind && (
        <Panel title="场景属性" icon={<Settings2 />}>
          <ColorField label="天空颜色" value={scene.background.color} onChange={(color) => onPatch({ background: { type: 'color', color } }, { label: '修改天空颜色', mergeKey: 'scene:background.color' })} />
          <SelectField label="画幅比例" value={scene.aspectRatio} options={SCENE_ASPECT_RATIOS} onChange={(aspectRatio) => onPatch({ aspectRatio }, { label: '修改画幅比例' })} />
          <NumberField label="场景缩放" value={scene.sceneZoomPercent} min={50} max={500} step={1} sliderStep={1} suffix="%" onChange={(sceneZoomPercent) => onPatch({ sceneZoomPercent }, { label: '调整场景缩放', mergeKey: 'scene:zoom' })} />
          <ToggleRow label="地面" checked={scene.groundEnabled} onChange={(groundEnabled) => onPatch({ groundEnabled }, { label: groundEnabled ? '显示地面' : '隐藏地面' })} />
          <ToggleRow label="地面网格线" checked={scene.groundGridEnabled} onChange={(groundGridEnabled) => onPatch({ groundGridEnabled }, { label: groundGridEnabled ? '显示地面网格线' : '隐藏地面网格线' })} />
          <ToggleRow label="运动轨迹线" checked={scene.motionPathEnabled} onChange={(motionPathEnabled) => onPatch({ motionPathEnabled }, { label: motionPathEnabled ? '显示运动轨迹线' : '隐藏运动轨迹线' })} />
          <ToggleRow label="角色标签" checked={scene.characterLabelsEnabled} onChange={(characterLabelsEnabled) => onPatch({ characterLabelsEnabled }, { label: characterLabelsEnabled ? '显示角色标签' : '隐藏角色标签' })} />
          <ToggleRow label="构图参考线" checked={scene.compositionGuideEnabled} onChange={(compositionGuideEnabled) => onPatch({ compositionGuideEnabled }, { label: compositionGuideEnabled ? '显示构图参考线' : '隐藏构图参考线' })} />
          <ToggleRow label="网格吸附" checked={scene.gridSnapEnabled} onChange={(gridSnapEnabled) => onPatch({ gridSnapEnabled }, { label: gridSnapEnabled ? '开启网格吸附' : '关闭网格吸附' })} />
        </Panel>
      )}
      {character && (
        <Panel title="角色属性" icon={<UserRound />}>
          <Segmented value={characterTab} options={[{ value: 'property', label: '属性' }, { value: 'pose', label: '姿势' }, { value: 'transition', label: '补间' }]} onChange={(value) => setCharacterTab(value as PoseTab)} />
          {characterTab === 'property' && (
            <div className="space-y-2">
              <TextField label="名称" value={character.name} disabled={character.locked} onChange={(name) => onUpdateObject('character', character.id, { name })} />
              <ColorField label="颜色" value={character.color} disabled={character.locked} onChange={(color) => onUpdateObject('character', character.id, { color })} />
              <VectorField label="位置" value={character.position} sliderMin={-10} sliderMax={10} sliderStep={0.01} disabled={character.locked} onChange={(position) => updateObjectLive('character', character.id, { position })} onCommitStart={() => beginObjectEdit('character', character.id)} onCommitEnd={() => commitObjectEdit('character', character.id)} />
              <VectorField label="旋转" value={character.rotation} sliderMin={-180} sliderMax={180} sliderStep={0.1} disabled={character.locked} onChange={(rotation) => updateObjectLive('character', character.id, { rotation })} onCommitStart={() => beginObjectEdit('character', character.id)} onCommitEnd={() => commitObjectEdit('character', character.id)} />
              <NumberField label="统一缩放" value={characterUniformScale} min={0.02} max={20} step={0.01} sliderMin={0.02} sliderMax={20} sliderStep={0.05} disabled={character.locked} onChange={(uniformScale) => updateObjectLive('character', character.id, { scale: vec(uniformScale, uniformScale, uniformScale) })} onCommitStart={() => beginObjectEdit('character', character.id)} onCommitEnd={() => commitObjectEdit('character', character.id)} />
              <VectorField label="缩放" value={character.scale} min={0.02} max={20} step={0.01} sliderMin={0.02} sliderMax={20} sliderStep={0.05} disabled={character.locked} onChange={(scale) => updateObjectLive('character', character.id, { scale })} onCommitStart={() => beginObjectEdit('character', character.id)} onCommitEnd={() => commitObjectEdit('character', character.id)} />
              <DeleteButton disabled={character.locked} onClick={onDeleteSelected} />
            </div>
          )}
          {characterTab === 'pose' && (
            <div className="space-y-3">
              <SelectField label="姿势预设" value={character.posePresetId || character.posePreset || 'stand'} options={uniquePosePresetOptions(character.posePresetId || character.posePreset)} labels={{ custom: '自定义', squat: '蹲下', ...Object.fromEntries(POSE_PRESETS.map((item) => [item.id, item.label])) }} onChange={applyPreset} />
              <PoseReferenceImagePanel images={character.poseReferenceImages} history={character.poseReferenceSolveHistory} disabled={character.locked} solving={poseReferenceSolving} error={poseReferenceError} result={poseReferenceResult} onUpload={uploadPoseReferenceImage} onRemove={removePoseReferenceImage} onSolve={solvePoseReference} onApplyResult={applyPoseReferenceResult} onReplay={replayPoseReferenceSolve} />
              <FingerPoseField value={characterFingerPose} selectedFinger={selectedFinger} disabled={character.locked} onSelectFinger={setSelectedFinger} onChange={updateCharacterFingerLive} onCommitStart={beginPoseEdit} onCommitEnd={commitPoseEdit} />
              <ToePoseField value={characterToePose} selectedToe={selectedToe} disabled={character.locked} onSelectToe={setSelectedToe} onChange={updateCharacterToeLive} onCommitStart={beginPoseEdit} onCommitEnd={commitPoseEdit} />
              {POSE_KEYS.map((jointKey) => (
                <PoseField key={jointKey} jointKey={jointKey} label={JOINT_LABELS[jointKey] || jointKey} value={character.rigPose[jointKey]} disabled={character.locked} onChange={(value) => updateCharacterRigJointLive(jointKey, value)} onCommitStart={beginPoseEdit} onCommitEnd={commitPoseEdit} />
              ))}
            </div>
          )}
          {characterTab === 'transition' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-[10px] text-zinc-400">当前角色补间片段</div>
                <div className="space-y-1">
                  {characterTransitions.map((transition) => (
                    <button key={transition.id} type="button" onClick={() => onSelectTransition(transition.id)} className={activeTransition?.id === transition.id ? 'flex w-full items-center justify-between rounded-md border border-violet-400/40 bg-violet-400/15 px-2 py-1.5 text-left text-violet-100' : 'flex w-full items-center justify-between rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-left text-zinc-200'}>
                      <span className="truncate">{transition.name}</span>
                      <span className="text-[10px] text-zinc-400">{transition.durationSec.toFixed(1)}s</span>
                    </button>
                  ))}
                  {!characterTransitions.length && <div className="rounded-md border border-dashed border-white/10 bg-black/20 px-2 py-2 text-[11px] text-zinc-500">当前角色还没有补间片段。</div>}
                </div>
              </div>
              <button type="button" onClick={createTransition} className="h-8 w-full rounded-md border border-white/10 bg-white/5 text-zinc-200">新建补间片段</button>
              {currentTransition && (
                <>
                  <TextField label="名称" value={currentTransition.name} onChange={(name) => patchTransition(currentTransition.id, { name })} />
                  <TextField label="动作提示词" value={currentTransition.actionPrompt} onChange={(actionPrompt) => patchTransitionInput(currentTransition.id, { actionPrompt })} />
                  <NumberField label="时长" value={currentTransition.durationSec} min={0.2} max={10} step={0.1} onChange={(durationSec) => patchTransitionInput(currentTransition.id, { durationSec })} />
                  <SelectField label="曲线" value={currentTransition.curve} options={['linear', 'ease_in', 'ease_out', 'ease_in_out']} labels={{ linear: '线性', ease_in: '渐入', ease_out: '渐出', ease_in_out: '渐入渐出' }} onChange={(curve) => patchTransitionInput(currentTransition.id, { curve: curve as CurveType })} />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => saveCurrentPoseToTransition('start')} className="h-8 rounded-md border border-white/10 bg-white/5 text-zinc-200">保存起始姿势</button>
                    <button type="button" onClick={() => saveCurrentPoseToTransition('end')} className="h-8 rounded-md border border-white/10 bg-white/5 text-zinc-200">保存结束姿势</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => jumpToTransitionPose('start')} className="h-8 rounded-md border border-white/10 bg-black/20 text-zinc-300">跳到起点</button>
                    <button type="button" onClick={() => jumpToTransitionPose('end')} className="h-8 rounded-md border border-white/10 bg-black/20 text-zinc-300">跳到终点</button>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
                    <div className={currentTransition.startPose ? 'rounded border border-emerald-400/30 bg-emerald-400/10 px-1 py-1 text-emerald-100' : 'rounded border border-white/10 bg-black/20 px-1 py-1 text-zinc-500'}>起点 {currentTransition.startPose ? '已保存' : '未保存'}</div>
                    <div className={currentTransition.endPose ? 'rounded border border-emerald-400/30 bg-emerald-400/10 px-1 py-1 text-emerald-100' : 'rounded border border-white/10 bg-black/20 px-1 py-1 text-zinc-500'}>终点 {currentTransition.endPose ? '已保存' : '未保存'}</div>
                    <div className={currentTransition.animationClip ? 'rounded border border-violet-400/30 bg-violet-400/10 px-1 py-1 text-violet-100' : 'rounded border border-white/10 bg-black/20 px-1 py-1 text-zinc-500'}>补间 {currentTransition.animationClip ? '已生成' : '未生成'}</div>
                  </div>
                  <button type="button" onClick={resolveTransitionPlan} className="h-8 w-full rounded-md border border-white/10 bg-white/5 text-zinc-200">解析动作模板</button>
                  <button type="button" disabled={motionResolving} onClick={resolveTransitionPlanWithAi} className="h-8 w-full rounded-md border border-white/10 bg-white/5 text-zinc-200 disabled:opacity-50">{motionResolving ? 'AI 解析中...' : 'AI 解析动作'}</button>
                  <button type="button" disabled={motionGenerating} onClick={regenerateTransitionWithAi} className="h-8 w-full rounded-md border border-violet-400/40 bg-violet-400/15 text-violet-100 disabled:opacity-50">{motionGenerating ? 'AI 生成中...' : 'AI 生成补间'}</button>
                  <button type="button" onClick={buildCurrentTweenClip} className="h-8 w-full rounded-md border border-emerald-400/30 bg-emerald-400/10 text-emerald-100">按预设重算补间</button>
                  <TimelinePreview transition={currentTransition} preview={preview} previewSample={previewSample} onPreviewChange={onPreviewChange} onApplySample={() => { if (previewSample && currentTransition) onPatch((current) => applyPreviewFrameToScene(current, currentTransition.id, previewSample), { label: '应用预览帧' }); }} />
                  {currentTransition.animationClip && (
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => applyQualityFix('auto')} className="h-8 rounded-md border border-white/10 bg-white/5 text-zinc-200">自动优化</button>
                      <button type="button" onClick={() => applyQualityFix('snap_endpoints')} className="h-8 rounded-md border border-white/10 bg-white/5 text-zinc-200">校准端点</button>
                    </div>
                  )}
                  {currentTransition.error && <div className="rounded-md border border-red-400/25 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">{currentTransition.error}</div>}
                  {currentTransition.warnings.length > 0 && <div className="rounded-md border border-amber-400/25 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">{currentTransition.warnings.join(' ')}</div>}
                </>
              )}
            </div>
          )}
        </Panel>
      )}
      {prop && (
        <Panel title="道具属性" icon={<Box />}>
          <TextField label="名称" value={prop.name} disabled={prop.locked} onChange={(name) => onUpdateObject('prop', prop.id, { name })} />
          <ColorField label="颜色" value={prop.color} disabled={prop.locked} onChange={(color) => onUpdateObject('prop', prop.id, { color })} />
          <VectorField label="位置" value={prop.position} sliderMin={-10} sliderMax={10} sliderStep={0.01} disabled={prop.locked} onChange={(position) => updateObjectLive('prop', prop.id, { position })} onCommitStart={() => beginObjectEdit('prop', prop.id)} onCommitEnd={() => commitObjectEdit('prop', prop.id)} />
          <VectorField label="旋转" value={prop.rotation} sliderMin={-180} sliderMax={180} sliderStep={0.1} disabled={prop.locked} onChange={(rotation) => updateObjectLive('prop', prop.id, { rotation })} onCommitStart={() => beginObjectEdit('prop', prop.id)} onCommitEnd={() => commitObjectEdit('prop', prop.id)} />
          <VectorField label="缩放" value={prop.scale} min={0.05} max={8} step={0.01} sliderMin={0.05} sliderMax={8} sliderStep={0.01} disabled={prop.locked} onChange={(scale) => updateObjectLive('prop', prop.id, { scale })} onCommitStart={() => beginObjectEdit('prop', prop.id)} onCommitEnd={() => commitObjectEdit('prop', prop.id)} />
          <DeleteButton disabled={prop.locked} onClick={onDeleteSelected} />
        </Panel>
      )}
      {camera && (
        <Panel title="机位属性" icon={<Camera />}>
          <TextField label="名称" value={camera.name} disabled={camera.locked} onChange={(name) => onUpdateObject('camera', camera.id, { name })} />
          <VectorField label="位置" value={camera.position} sliderMin={-10} sliderMax={10} sliderStep={0.01} disabled={camera.locked} onChange={(position) => updateObjectLive('camera', camera.id, { position })} onCommitStart={() => beginObjectEdit('camera', camera.id)} onCommitEnd={() => commitObjectEdit('camera', camera.id)} />
          <VectorField label="注视点" value={camera.targetPosition} sliderMin={-10} sliderMax={10} sliderStep={0.01} disabled={camera.locked} onChange={(targetPosition) => updateObjectLive('camera', camera.id, { targetPosition })} onCommitStart={() => beginObjectEdit('camera', camera.id)} onCommitEnd={() => commitObjectEdit('camera', camera.id)} />
          <SelectField label="镜头" value={camera.lensType} options={CAMERA_LENS_OPTIONS.map((item) => item.id)} labels={CAMERA_LENS_LABELS} disabled={camera.locked} onChange={(lensType) => onUpdateObject('camera', camera.id, cameraLensPatch(lensType as CameraLensType))} />
          <NumberField label="视角" value={camera.fov} min={8} max={120} step={1} disabled={camera.locked} onChange={(fov) => updateObjectLive('camera', camera.id, { fov })} onCommitStart={() => beginObjectEdit('camera', camera.id)} onCommitEnd={() => commitObjectEdit('camera', camera.id)} />
          <NumberField label="鱼眼" value={camera.fisheyeStrength} min={0} max={1} step={0.01} sliderStep={0.01} disabled={camera.locked} onChange={(fisheyeStrength) => updateObjectLive('camera', camera.id, { fisheyeStrength })} onCommitStart={() => beginObjectEdit('camera', camera.id)} onCommitEnd={() => commitObjectEdit('camera', camera.id)} />
          <NumberField label="焦距" value={camera.focusDistance} min={0.05} max={20} step={0.05} sliderStep={0.05} disabled={camera.locked} onChange={(focusDistance) => updateObjectLive('camera', camera.id, { focusDistance })} onCommitStart={() => beginObjectEdit('camera', camera.id)} onCommitEnd={() => commitObjectEdit('camera', camera.id)} />
          <NumberField label="移轴" value={camera.tiltShiftAmount} min={-1} max={1} step={0.01} sliderStep={0.01} disabled={camera.locked} onChange={(tiltShiftAmount) => updateObjectLive('camera', camera.id, { tiltShiftAmount })} onCommitStart={() => beginObjectEdit('camera', camera.id)} onCommitEnd={() => commitObjectEdit('camera', camera.id)} />
          <NumberField label="正交缩放" value={camera.orthographicScale} min={1} max={18} step={0.1} sliderStep={0.1} disabled={camera.locked} onChange={(orthographicScale) => updateObjectLive('camera', camera.id, { orthographicScale })} onCommitStart={() => beginObjectEdit('camera', camera.id)} onCommitEnd={() => commitObjectEdit('camera', camera.id)} />
          <DeleteButton disabled={camera.locked} onClick={onDeleteSelected} />
        </Panel>
      )}
      {light && (
        <Panel title="灯光属性" icon={<Lightbulb />}>
          <TextField label="名称" value={light.name} disabled={light.locked} onChange={(name) => onUpdateObject('light', light.id, { name })} />
          <ColorField label="颜色" value={light.color} disabled={light.locked} onChange={(color) => onUpdateObject('light', light.id, { color })} />
          <NumberField label="强度" value={light.intensity} min={0} max={8} step={0.01} sliderStep={0.01} disabled={light.locked} onChange={(intensity) => updateObjectLive('light', light.id, { intensity })} onCommitStart={() => beginObjectEdit('light', light.id)} onCommitEnd={() => commitObjectEdit('light', light.id)} />
          <VectorField label="位置" value={light.position} sliderMin={-10} sliderMax={10} sliderStep={0.01} disabled={light.locked} onChange={(position) => updateObjectLive('light', light.id, { position })} onCommitStart={() => beginObjectEdit('light', light.id)} onCommitEnd={() => commitObjectEdit('light', light.id)} />
          <DeleteButton disabled={light.locked} onClick={onDeleteSelected} />
        </Panel>
      )}
    </div>
  );
}
function MiniTimeline({ transition, preview, onPreviewChange, onExitPreview, onWriteCurrentPose }: { transition: PoseTransition | null; preview: PreviewState; onPreviewChange: React.Dispatch<React.SetStateAction<PreviewState>>; onExitPreview?: () => void; onWriteCurrentPose?: () => void }) {
  const duration = Math.max(0.1, transition?.animationClip?.durationSec || transition?.durationSec || 1.2);
  const current = Math.min(duration, Math.max(0, preview.currentTimeSec || 0));
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
      <input
        type="range"
        min={0}
        max={duration}
        step={0.01}
        value={current}
        disabled={!transition}
        onChange={(event) => onPreviewChange((state) => ({ ...state, transitionId: transition?.id, currentTimeSec: Number(event.target.value), enabled: true }))}
        className="w-full accent-violet-400 disabled:opacity-40"
      />
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
        <span>{current.toFixed(2)}s / {duration.toFixed(2)}s</span>
        <div className="flex gap-1">
          {onWriteCurrentPose && <button type="button" onClick={onWriteCurrentPose} className="rounded border border-white/10 bg-white/5 px-1.5 text-zinc-300">写回当前帧</button>}
          {onExitPreview && <button type="button" onClick={onExitPreview} className="rounded border border-white/10 bg-white/5 px-1.5 text-zinc-300">退出预览</button>}
        </div>
      </div>
    </div>
  );
}

function TimelinePreview({ transition, preview, previewSample, onPreviewChange, onApplySample }: { transition: PoseTransition | null; preview: PreviewState; previewSample: AnimationClipSample | null; onPreviewChange: React.Dispatch<React.SetStateAction<PreviewState>>; onApplySample: () => void }) {
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      <MiniTimeline transition={transition} preview={preview} onPreviewChange={onPreviewChange} />
      <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
        <span>{previewSample ? '\u9884\u89c8 ' + previewSample.timeSec.toFixed(2) + 's' : '\u6682\u65e0\u9884\u89c8\u91c7\u6837'}</span>
        <button type="button" disabled={!previewSample} onClick={onApplySample} className="h-6 rounded border border-white/10 bg-white/5 px-2 text-[10px] text-zinc-200 disabled:opacity-45">{'\u5e94\u7528\u5e27'}</button>
      </div>
    </div>
  );
}

function ObjectSection({
  title, icon, onAdd, addMenu, children
}: {
  title: string; icon: React.ReactNode; onAdd?: () => void; addMenu?: { id: string; label: string; icon?: React.ReactNode; onSelect: () => void }[]; children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const hasMenu = Boolean(addMenu?.length);
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-zinc-300">
        <button type="button" onClick={() => setExpanded((current) => !current)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-white/5 [&_svg]:h-3.5 [&_svg]:w-3.5">
          <span className={expanded ? 'rotate-90 text-[10px] text-zinc-500 transition-transform' : 'text-[10px] text-zinc-500 transition-transform'}>{'>'}</span>
          {icon}
          <span className="truncate">{title}</span>
        </button>
        <div className="relative">
          <button type="button" onClick={(event) => { event.stopPropagation(); if (hasMenu) setMenuOpen((current) => !current); else onAdd?.(); }} className="rounded border border-white/10 bg-white/5 p-0.5 hover:bg-white/10"><Plus className="h-3.5 w-3.5" /></button>
          {hasMenu && menuOpen && (
            <div className={addMenu!.length > 8 ? 'absolute right-0 top-6 z-30 grid max-h-[288px] w-[212px] grid-cols-2 gap-1 overflow-y-auto rounded-md border border-white/10 bg-zinc-950/95 p-1.5 shadow-xl' : 'absolute right-0 top-6 z-30 grid max-h-[288px] w-[156px] grid-cols-1 gap-1 overflow-y-auto rounded-md border border-white/10 bg-zinc-950/95 p-1.5 shadow-xl'}>
              {addMenu!.map((item) => <button key={item.id} type="button" onClick={(event) => { event.stopPropagation(); item.onSelect(); setMenuOpen(false); setExpanded(true); }} className="flex h-8 items-center gap-2 rounded bg-white/[0.04] px-2 text-left text-[11px] font-medium text-zinc-200 hover:bg-white/10 [&_svg]:h-3.5 [&_svg]:w-3.5">{item.icon}<span className="min-w-0 truncate">{item.label}</span></button>)}
            </div>
          )}
        </div>
      </div>
      {expanded && <div className="space-y-1">{children}</div>}
    </div>
  );
}

function ModelImportButton({ label, onImport }: { label: string; onImport: (file: File | null | undefined) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={IMPORTED_MODEL_ACCEPT}
        className="hidden"
        onChange={(event) => {
          onImport(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 text-left text-[11px] text-zinc-300 hover:bg-white/10"
      >
        <Maximize2 className="h-3.5 w-3.5 text-violet-300" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[10px] text-zinc-500">FBX/GLB/OBJ</span>
      </button>
    </div>
  );
}

// Pose reference upload, overlay, and solve-result UI.
function PoseReferenceImagePanel({ images, history, disabled, solving, error, result, onUpload, onRemove, onSolve, onApplyResult, onReplay }: {
  images?: CharacterObject['poseReferenceImages']; history?: PoseReferenceSolveHistoryItem[]; disabled?: boolean; solving?: boolean; error?: string; result?: PoseReferenceSolveResult | null; onUpload: (view: PoseReferenceView, file: File | null | undefined) => void; onRemove: (view: PoseReferenceView) => void; onSolve: () => void; onApplyResult: () => void; onReplay: (item: PoseReferenceSolveHistoryItem) => void;
}) {
  const uploadedCount = POSE_REFERENCE_VIEW_OPTIONS.filter((item) => images?.[item.id]).length;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={expanded ? 'space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-2' : 'rounded-md border border-white/10 bg-white/[0.03] p-2'}>
      <button type="button" onClick={() => setExpanded((current) => !current)} className="flex w-full items-center justify-between gap-2 rounded px-0.5 py-0.5 text-left hover:bg-white/5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={expanded ? 'rotate-90 shrink-0 text-[10px] text-zinc-500 transition-transform' : 'shrink-0 text-[10px] text-zinc-500 transition-transform'}>{'>'}</span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-zinc-200">姿势参考图</div>
            <div className="truncate text-[10px] text-zinc-500">正面 / 侧面 / 背面参考图</div>
          </div>
        </div>
        <div className={uploadedCount > 0 ? 'shrink-0 rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-100' : 'shrink-0 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-100'}>
          {uploadedCount > 0 ? `已上传 ${uploadedCount}/3` : '未上传'}
        </div>
      </button>
      {expanded && (
        <>
          <div className="grid gap-2">
            {POSE_REFERENCE_VIEW_OPTIONS.map((item) => (
              <PoseReferenceImageSlot key={item.id} view={item.id} label={item.label} hint={item.hint} image={images?.[item.id]} landmarks={result?.poseLandmarks} disabled={disabled} onUpload={onUpload} onRemove={onRemove} />
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="min-w-0 text-[10px] text-zinc-500">{result ? '解析结果已就绪。' : '至少上传一张图片后再解析姿势。'}</div>
            <button type="button" disabled={disabled || solving || uploadedCount < 1} onClick={onSolve} className="h-7 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 text-[10px] font-medium text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-45">{solving ? '解析中...' : '解析姿势'}</button>
          </div>
          {error && <div className="rounded border border-red-400/20 bg-red-400/10 px-2 py-1 text-[10px] leading-4 text-red-100">{error}</div>}
          {result && (
            <div className="space-y-1 rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-1.5 text-[10px] text-emerald-50">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">解析结果</span><span className="text-emerald-100/80">置信度 {Math.round(result.confidence * 100)}%</span></div>
              <div className="line-clamp-2 text-emerald-100/80">{result.summary}</div>
              {result.warnings.length > 0 && <div className="text-amber-100">{result.warnings.slice(0, 2).join(' / ')}</div>}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-emerald-100/70">视角：{result.appliedViews.length ? result.appliedViews.join(' / ') : '无'}</span>
                <button type="button" disabled={disabled} onClick={onApplyResult} className="h-7 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-2 text-[10px] font-medium text-emerald-50 hover:bg-emerald-300/15 disabled:opacity-45">应用</button>
              </div>
            </div>
          )}
          {history && history.length > 0 && (
            <div className="space-y-1 rounded border border-white/10 bg-black/20 px-2 py-1.5 text-[10px] text-zinc-300">
              <div className="flex items-center justify-between gap-2 text-zinc-400"><span>历史</span><span>{history.length}/8</span></div>
              <div className="space-y-1">
                {history.slice(0, 4).map((item) => (
                  <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                    <div className="min-w-0">
                      <div className="truncate text-zinc-100">{new Date(item.solvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} / {item.appliedViews.join('/')} / {Math.round(item.confidence * 100)}%</div>
                      <div className="truncate text-zinc-500">{item.poseLandmarks ? `${Object.keys(item.poseLandmarks.points).length} 个关键点` : '无关键点'} / {item.imageRefs.map((image) => image.fileName).join(' / ') || '无图片引用'}</div>
                    </div>
                    <button type="button" disabled={disabled} onClick={() => onReplay(item)} className="h-6 rounded border border-cyan-300/25 bg-cyan-300/10 px-2 text-[10px] text-cyan-50 hover:bg-cyan-300/15 disabled:opacity-45">回放</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function PoseLandmarkOverlay({ landmarks, view }: { landmarks: PoseReferenceLandmarks; view: PoseReferenceView }) {
  if (!landmarks.sourceViews.includes(view)) return null;
  const points = landmarks.points;
  const visibleKeys = POSE_LANDMARK_KEYS.filter((key) => landmarkVisible(points[key]));
  if (!visibleKeys.length) return null;
  return (
    <svg
      viewBox="0 0 100 100"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.12)" />
      {POSE_LANDMARK_BONES.map(([from, to]) => {
        const start = landmarkSvgPoint(points[from]);
        const end = landmarkSvgPoint(points[to]);
        if (!start || !end) return null;
        return (
          <line
            key={`${from}:${to}`}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke="rgba(34, 211, 238, 0.92)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        );
      })}
      {visibleKeys.map((key) => {
        const point = landmarkSvgPoint(points[key]);
        if (!point) return null;
        const isCore = key.includes('Shoulder') || key.includes('Hip') || key === 'nose';
        return (
          <circle
            key={key}
            cx={point.x}
            cy={point.y}
            r={isCore ? 2.8 : 2.15}
            fill={isCore ? 'rgba(251, 191, 36, 0.96)' : 'rgba(236, 253, 245, 0.96)'}
            stroke="rgba(2, 6, 23, 0.75)"
            strokeWidth="0.7"
            opacity={point.opacity}
          />
        );
      })}
      <text x="4" y="94" fill="rgba(236,253,245,0.9)" fontSize="7" fontWeight="600">
        {visibleKeys.length}/{POSE_LANDMARK_KEYS.length}
      </text>
    </svg>
  );
}

function PoseReferenceImageSlot({
  view,
  label,
  hint,
  image,
  landmarks,
  disabled,
  onUpload,
  onRemove
}: {
  view: PoseReferenceView;
  label: string;
  hint: string;
  image?: PoseReferenceImage;
  landmarks?: PoseReferenceLandmarks;
  disabled?: boolean;
  onUpload: (view: PoseReferenceView, file: File | null | undefined) => void;
  onRemove: (view: PoseReferenceView) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 rounded-md border border-white/10 bg-black/20 p-1.5">
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="relative flex aspect-square items-center justify-center overflow-hidden rounded border border-white/10 bg-white/[0.04] text-zinc-400 disabled:opacity-45">
        {image ? <img src={image.url} alt={`${label}参考图`} className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5" />}
        {image && landmarks && <PoseLandmarkOverlay landmarks={landmarks} view={view} />}
      </button>
      <div className="min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-[11px] font-medium text-zinc-200">{label}</div><div className="truncate text-[10px] text-zinc-500">{image?.fileName || hint}</div></div>{image && <button type="button" disabled={disabled} onClick={() => onRemove(view)} className="rounded border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 text-[10px] text-red-100 disabled:opacity-45">{'\u79fb\u9664'}</button>}</div>
        <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="h-7 w-full rounded-md border border-white/10 bg-white/[0.04] text-[10px] text-zinc-300 hover:bg-white/10 disabled:opacity-45">{image ? '\u66f4\u6362\u56fe\u7247' : '\u4e0a\u4f20\u56fe\u7247'}</button>
        <input ref={inputRef} type="file" accept={POSE_REFERENCE_IMAGE_ACCEPT} className="hidden" onChange={(event) => { onUpload(view, event.target.files?.[0]); event.currentTarget.value = ''; }} />
      </div>
    </div>
  );
}
function ObjectRow({
  name,
  active,
  visible,
  locked,
  onSelect,
  onRename,
  onToggleVisible,
  onToggleLocked
}: {
  name: string;
  active: boolean;
  visible: boolean;
  locked: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onToggleVisible: () => void;
  onToggleLocked: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [editing, name]);
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== name) onRename(next);
    else setDraft(name);
  };
  return (
    <div
      onClick={() => !editing && onSelect()}
      className={`flex h-8 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] ${active ? 'border-violet-400/50 bg-violet-400/15 text-white' : 'border-white/5 bg-white/[0.03] text-zinc-300'} ${visible ? '' : 'opacity-50'}`}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded bg-black/50 px-1 text-white outline-none"
        />
      ) : (
        <span onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); }} className="min-w-0 flex-1 truncate" title="\u53cc\u51fb\u91cd\u547d\u540d">
          {name}
        </span>
      )}
      <button type="button" onClick={(event) => { event.stopPropagation(); onToggleVisible(); }} className="text-zinc-500">{visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onToggleLocked(); }} className="text-zinc-500">{locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button>
    </div>
  );
}

// Small form primitives used by the Scene3D node UI.
function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-1.5 border-b border-white/10 pb-2 text-xs font-semibold text-white [&_svg]:h-4 [&_svg]:w-4">{icon}{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] disabled:opacity-40 ${active ? 'border-violet-400/40 bg-violet-400/15 text-violet-100' : 'border-white/10 bg-white/5 text-zinc-300'}`}
    >
      {icon}
      <span>{label}</span>
      {shortcut && <span className="ml-0.5 rounded border border-white/10 bg-black/30 px-1 text-[10px] text-zinc-500">{shortcut}</span>}
    </button>
  );
}

function Segmented({
  value,
  options,
  onChange
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded-md border border-white/10 bg-black/30 p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)} className={`h-7 rounded px-2 text-[11px] ${value === option.value ? 'bg-white text-black' : 'text-zinc-400'}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TextField({
  label,
  value,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-zinc-400">{label}</span>
      <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-7 w-full rounded-md border border-white/10 bg-black/30 px-2 text-[11px] text-white disabled:opacity-45" />
    </label>
  );
}

function NumberField({
  label,
  value,
  min = -100,
  max = 100,
  step = 0.1,
  sliderMin = min,
  sliderMax = max,
  sliderStep = step,
  suffix,
  disabled,
  onChange,
  onCommitStart,
  onCommitEnd
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
}) {
  const numericValue = Number.isFinite(value) ? value : 0;
  const sliderValue = clampNumber(numericValue, sliderMin, sliderMax);
  const updateValue = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    onChange(raw);
  };
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-zinc-400">{label}</span>
        <div className="flex h-6 w-20 items-center rounded-md border border-white/10 bg-white/10 px-1.5">
          <input type="number" value={numericValue} min={min} max={max} step={step} disabled={disabled} onFocus={onCommitStart} onBlur={onCommitEnd} onChange={(event) => updateValue(Number(event.target.value))} className="min-w-0 flex-1 bg-transparent text-right text-[10px] text-white outline-none disabled:opacity-45" />
          {suffix && <span className="ml-0.5 text-[10px] text-zinc-200">{suffix}</span>}
        </div>
      </div>
      <input type="range" value={sliderValue} min={sliderMin} max={sliderMax} step={sliderStep} disabled={disabled} onPointerDown={onCommitStart} onPointerUp={onCommitEnd} onKeyDown={onCommitStart} onBlur={onCommitEnd} onChange={(event) => updateValue(Number(event.target.value))} className="w-full accent-violet-400 disabled:opacity-40" />
    </label>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-zinc-400">{label}</span>
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-black/30 px-2">
        <input type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-5 w-7 bg-transparent p-0" />
        <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none" />
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  labels,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-zinc-400">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-7 w-full rounded-md border border-white/10 bg-black/30 px-2 text-[11px] text-white disabled:opacity-45">
        {options.map((option) => <option key={option} value={option} className="bg-zinc-950">{labels?.[option] || option}</option>)}
      </select>
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-8 items-center justify-between rounded-md border border-white/10 bg-black/20 px-2 text-[11px] text-zinc-300">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-3.5 w-3.5 accent-violet-400" />
    </label>
  );
}

function VectorField({
  label,
  value,
  min = -100,
  max = 100,
  step = 0.1,
  sliderMin = min,
  sliderMax = max,
  sliderStep = step,
  disabled,
  onChange,
  onCommitStart,
  onCommitEnd
}: {
  label: string;
  value: Vec3;
  min?: number;
  max?: number;
  step?: number;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  disabled?: boolean;
  onChange: (value: Vec3) => void;
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
}) {
  const updateAxis = (axis: keyof Vec3, raw: number) => {
    if (!Number.isFinite(raw)) return;
    onChange({ ...value, [axis]: raw });
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-zinc-400">
        <span>{label}</span>
        <span className="text-zinc-500">XYZ</span>
      </div>
      <div className="space-y-1.5">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis} className="grid grid-cols-[18px_minmax(0,1fr)_64px] items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1">
            <span className="text-[10px] font-medium text-zinc-500">{axis.toUpperCase()}</span>
            <input
              type="range"
              value={clampNumber(Number.isFinite(value[axis]) ? value[axis] : 0, sliderMin, sliderMax)}
              min={sliderMin}
              max={sliderMax}
              step={sliderStep}
              disabled={disabled}
              onPointerDown={onCommitStart}
              onPointerUp={onCommitEnd}
              onKeyDown={onCommitStart}
              onBlur={onCommitEnd}
              onChange={(event) => updateAxis(axis, Number(event.target.value))}
              className="w-full accent-violet-400 disabled:opacity-40"
            />
            <input
              type="number"
              value={Number.isFinite(value[axis]) ? value[axis] : 0}
              min={min}
              max={max}
              step={step}
              disabled={disabled}
              onFocus={onCommitStart}
              onBlur={onCommitEnd}
              onChange={(event) => updateAxis(axis, Number(event.target.value))}
              className="h-6 min-w-0 rounded border border-white/10 bg-black/30 px-1 text-right text-[10px] text-white outline-none disabled:opacity-45"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PoseField({
  jointKey,
  label,
  value,
  disabled,
  onChange,
  onCommitStart,
  onCommitEnd
}: {
  jointKey: PoseJointKey;
  label: string;
  value: RigRotation;
  disabled?: boolean;
  onChange: (value: RigRotation) => void;
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
}) {
  const limits = JOINT_LIMITS[jointKey];
  const controlValue = rotationToControlSpace(jointKey, value);
  const updateAxis = (axis: keyof RigRotation, raw: number) => {
    const [min, max] = limits[axis];
    const next = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : 0;
    onChange(rotationFromControlSpace(jointKey, { ...controlValue, [axis]: next }));
  };
  return (
      <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      <div className="flex items-center justify-between text-[10px] text-zinc-400">
        <span>{label}</span>
        <span className="text-zinc-500">XYZ rotate</span>
      </div>
      <div className="space-y-1.5">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis} className="grid grid-cols-[18px_minmax(0,1fr)_58px] items-center gap-2">
            <span className="text-[10px] font-medium text-zinc-500">{axis.toUpperCase()}</span>
            <input
              type="range"
              min={limits[axis][0]}
              max={limits[axis][1]}
              step={1}
              value={Number.isFinite(controlValue[axis]) ? controlValue[axis] : 0}
              disabled={disabled}
              onPointerDown={onCommitStart}
              onPointerUp={onCommitEnd}
              onKeyDown={onCommitStart}
              onBlur={onCommitEnd}
              onChange={(event) => updateAxis(axis, Number(event.target.value))}
              className="w-full accent-violet-400 disabled:opacity-40"
            />
            <input
              type="number"
              min={limits[axis][0]}
              max={limits[axis][1]}
              step={1}
              value={Number.isFinite(controlValue[axis]) ? controlValue[axis] : 0}
              disabled={disabled}
              onFocus={onCommitStart}
              onBlur={onCommitEnd}
              onChange={(event) => updateAxis(axis, Number(event.target.value))}
              className="h-6 min-w-0 rounded border border-white/10 bg-black/30 px-1 text-right text-[10px] text-white outline-none disabled:opacity-45"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function FingerPoseField({
  value,
  selectedFinger,
  disabled,
  onSelectFinger,
  onChange,
  onCommitStart,
  onCommitEnd
}: {
  value: StandardHumanFingerPose;
  selectedFinger: FingerKey;
  disabled?: boolean;
  onSelectFinger: (finger: FingerKey) => void;
  onChange: (side: BodySide, finger: FingerKey | 'spread', value: number) => void;
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
}) {
  const leftValue = value.left[selectedFinger];
  const rightValue = value.right[selectedFinger];
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium text-zinc-200">{'\u624b\u6307\u63a7\u5236'}</div>
          <div className="text-[10px] text-zinc-500">{'\u8c03\u8282\u5f53\u524d\u89d2\u8272\u6bcf\u6839\u624b\u6307\u7684\u5f2f\u66f2\u548c\u5f20\u5f00\u3002'}</div>
        </div>
        <select
          value={selectedFinger}
          disabled={disabled}
          onChange={(event) => onSelectFinger(event.target.value as FingerKey)}
          className="h-7 rounded-md border border-white/10 bg-black/30 px-2 text-[11px] text-white disabled:opacity-45"
        >
          {FINGER_OPTIONS.map((finger) => (
            <option key={finger} value={finger} className="bg-zinc-950">
              {FINGER_LABELS[finger]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <ScalarSlider
          label="左手弯曲"
          value={leftValue}
          min={FINGER_CURL_MIN}
          max={FINGER_CURL_MAX}
          step={1}
          disabled={disabled}
          onChange={(next) => onChange('left', selectedFinger, next)}
          onCommitStart={onCommitStart}
          onCommitEnd={onCommitEnd}
        />
        <ScalarSlider
          label="右手弯曲"
          value={rightValue}
          min={FINGER_CURL_MIN}
          max={FINGER_CURL_MAX}
          step={1}
          disabled={disabled}
          onChange={(next) => onChange('right', selectedFinger, next)}
          onCommitStart={onCommitStart}
          onCommitEnd={onCommitEnd}
        />
        <ScalarSlider
          label="左手张开"
          value={value.left.spread}
          min={FINGER_SPREAD_MIN}
          max={FINGER_SPREAD_MAX}
          step={1}
          disabled={disabled}
          onChange={(next) => onChange('left', 'spread', next)}
          onCommitStart={onCommitStart}
          onCommitEnd={onCommitEnd}
        />
        <ScalarSlider
          label="右手张开"
          value={value.right.spread}
          min={FINGER_SPREAD_MIN}
          max={FINGER_SPREAD_MAX}
          step={1}
          disabled={disabled}
          onChange={(next) => onChange('right', 'spread', next)}
          onCommitStart={onCommitStart}
          onCommitEnd={onCommitEnd}
        />
      </div>
    </div>
  );
}

function ToePoseField({ value, selectedToe, disabled, onSelectToe, onChange, onCommitStart, onCommitEnd }: { value: StandardHumanToePose; selectedToe: ToeKey; disabled?: boolean; onSelectToe: (toe: ToeKey) => void; onChange: (toe: ToeKey, value: RigRotation) => void; onCommitStart?: () => void; onCommitEnd?: () => void; }) {
  const activeToe = TOE_OPTIONS.includes(selectedToe) ? selectedToe : 'leftBase';
  const toeValue = toeRotationToControlSpace(activeToe, value[activeToe] || TOE_POSE_NEUTRAL[activeToe]);
  const limits = TOE_LIMITS[activeToe];
  const updateAxis = (axis: keyof RigRotation, raw: number) => { const [min, max] = limits[axis]; const next = Number.isFinite(raw) ? clampNumber(raw, min, max) : 0; onChange(activeToe, toeRotationFromControlSpace(activeToe, { ...toeValue, [axis]: next })); };
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2"><div className="flex items-center justify-between gap-2"><div><div className="text-[10px] font-medium text-zinc-200">{'\u811a\u8dbe\u63a7\u5236'}</div><div className="text-[10px] text-zinc-500">{'\u5fae\u8c03\u811a\u8dbe\u65cb\u8f6c\uff0c\u7528\u4e8e\u8d34\u5730\u59ff\u52bf\u3002'}</div></div><select value={activeToe} disabled={disabled} onChange={(event) => onSelectToe(event.target.value as ToeKey)} className="h-7 rounded-md border border-white/10 bg-black/30 px-2 text-[11px] text-white disabled:opacity-45">{TOE_OPTIONS.map((toe) => <option key={toe} value={toe} className="bg-zinc-950">{TOE_LABELS[toe]}</option>)}</select></div><div className="space-y-1.5">{(['x', 'y', 'z'] as const).map((axis) => <div key={axis} className="grid grid-cols-[18px_minmax(0,1fr)_58px] items-center gap-2"><span className="text-[10px] font-medium text-zinc-500">{axis.toUpperCase()}</span><input type="range" min={limits[axis][0]} max={limits[axis][1]} step={1} value={Number.isFinite(toeValue[axis]) ? toeValue[axis] : 0} disabled={disabled} onPointerDown={onCommitStart} onPointerUp={onCommitEnd} onKeyDown={onCommitStart} onBlur={onCommitEnd} onChange={(event) => updateAxis(axis, Number(event.target.value))} className="w-full accent-violet-400 disabled:opacity-40" /><input type="number" min={limits[axis][0]} max={limits[axis][1]} step={1} value={Number.isFinite(toeValue[axis]) ? toeValue[axis] : 0} disabled={disabled} onFocus={onCommitStart} onBlur={onCommitEnd} onChange={(event) => updateAxis(axis, Number(event.target.value))} className="h-6 min-w-0 rounded border border-white/10 bg-black/30 px-1 text-right text-[10px] text-white outline-none disabled:opacity-45" /></div>)}</div></div>
  );
}
function ScalarSlider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  onCommitStart,
  onCommitEnd
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
}) {
  const safeValue = Number.isFinite(value) ? clampNumber(value, min, max) : 0;
  const update = (raw: number) => onChange(Number.isFinite(raw) ? clampNumber(raw, min, max) : 0);
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_58px] items-center gap-2">
      <span className="truncate text-[10px] text-zinc-500">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        disabled={disabled}
        onPointerDown={onCommitStart}
        onPointerUp={onCommitEnd}
        onKeyDown={onCommitStart}
        onBlur={onCommitEnd}
        onChange={(event) => update(Number(event.target.value))}
        className="w-full accent-violet-400 disabled:opacity-40"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        disabled={disabled}
        onFocus={onCommitStart}
        onBlur={onCommitEnd}
        onChange={(event) => update(Number(event.target.value))}
        className="h-6 min-w-0 rounded border border-white/10 bg-black/30 px-1 text-right text-[10px] text-white outline-none disabled:opacity-45"
      />
    </div>
  );
}

function DeleteButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="h-8 rounded-md border border-red-500/25 bg-red-500/10 text-xs text-red-200 disabled:opacity-40">
      <Trash2 className="mr-1 inline h-3.5 w-3.5" />{'\u5220\u9664'}</button>
  );
}

function CompositionGuide() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute left-1/3 top-0 h-full border-l border-white/20" />
      <div className="absolute left-2/3 top-0 h-full border-l border-white/20" />
      <div className="absolute left-0 top-1/3 w-full border-t border-white/20" />
      <div className="absolute left-0 top-2/3 w-full border-t border-white/20" />
    </div>
  );
}

useGLTF.preload(MODEL_URL);
