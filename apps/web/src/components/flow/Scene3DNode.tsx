import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas as ThreeCanvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
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

// SECTION: Portable node data model
type Vec3 = { x: number; y: number; z: number };
type TransformMode = 'translate' | 'rotate' | 'scale';
type CharacterGender = 'male' | 'female';
type ObjectKind = 'character' | 'prop' | 'camera' | 'light';
type CurveType = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' | 'bullet_time' | 'pulse' | 'hold_then_burst';
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
type ObjectChangeOptions = SceneChangeOptions & { skipGroundClamp?: boolean };
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
  | 'put_down'
  | 'combat_strike'
  | 'combat_block'
  | 'kick';

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
  groundMode?: 'grounded' | 'airborne';
  rigPose?: StandardHumanRigPose;
  bonePose?: Scene3DBonePose;
  fingerPose?: StandardHumanFingerPose;
  toePose?: StandardHumanToePose;
};
type UniversalMotionFamily = 'locomotion' | 'turn' | 'roll' | 'fall' | 'get_up' | 'dodge' | 'crawl' | 'kneel' | 'stumble' | 'reach' | 'carry' | 'combat';
type MotionContactHint = 'leftFoot' | 'rightFoot' | 'leftHand' | 'rightHand' | 'head' | 'shoulder' | 'hip' | 'feet' | 'hands';
type MotionSemanticActionFamily = 'locomotion' | 'combat' | 'push_pull' | 'throw' | 'jump' | 'fall' | 'crawl' | 'posture' | 'turn' | 'reach' | 'unknown';
type MotionSemanticActionType = 'walk' | 'run' | 'dash' | 'push' | 'pull' | 'throw' | 'punch' | 'block' | 'kick' | 'side_kick' | 'jump' | 'crouch' | 'crawl' | 'fall' | 'get_up' | 'turn' | 'reach' | 'idle' | 'unknown';
type MotionSemanticStage = {
  id: string;
  label: string;
  timeRatio: number;
  poseHint: string;
  rootMotionHint: string;
  contactHint: string;
};
type MotionActionSequenceStep = {
  id: string;
  actionType: MotionSemanticActionType;
  label: string;
  startRatio: number;
  endRatio: number;
  sourceText: string;
};
type MotionQualityExpectation = {
  id: string;
  metric: MotionQualityIssue['metric'];
  label: string;
  description: string;
  minValue?: number;
  maxValue?: number;
  required?: boolean;
};
type SequenceBoundaryStats = {
  maxPoseDelta: number;
  maxRootDelta: number;
  maxRotationDelta: number;
  maxVelocityRatio: number;
  issues: Array<Omit<MotionQualityIssue, 'id'>>;
};
type MotionActionChain = {
  id: 'approach_contact' | 'turn_throw' | 'low_recovery_attack';
  label: string;
  steps: MotionSemanticActionType[];
  description: string;
  qualityExpectationIds: string[];
};
type MotionSemanticPlan = {
  version: 1;
  source: 'local' | 'ai' | 'merged';
  promptHash: string;
  actionFamily: MotionSemanticActionFamily;
  actionType: MotionSemanticActionType;
  directionLabel: string;
  speedLabel: string;
  forceLabel: string;
  bodyFocus: string[];
  rootMotion: string[];
  poseStages: MotionSemanticStage[];
  actionSequence?: MotionActionSequenceStep[];
  actionChains?: MotionActionChain[];
  contacts: Array<{ label: string; contact: MotionContactHint; required: boolean }>;
  qualityExpectations?: MotionQualityExpectation[];
  actionSkill?: { label: string; compileMode: 'semantic_only' | 'universal_assist'; grounded: boolean; allowAirborne: boolean; constraints: string[] };
  cameraIntent?: { label: string; type: CameraMotionType; priority: 'prompt' | 'manual'; description: string };
  targetObjectId?: string;
  targetObjectName?: string;
  confidence: number;
  explain: string[];
  warnings: string[];
};
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
  actionFamily?: MotionSemanticActionFamily;
  actionType?: MotionSemanticActionType;
  motionFamilies?: UniversalMotionFamily[];
  keyframeHints?: MotionKeyframeHint[];
  contactHints?: Array<{ timeSec?: number; contact: MotionContactHint; note?: string }>;
  cameraMotionHint?: CameraMotionConfig;
  warnings: string[];
  confidence: number;
};
type MotionKeyframeHint = {
  timeRatio: number;
  label: string;
  posePresetId?: string;
  note?: string;
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
  metric: 'endpoint' | 'speed' | 'rotation' | 'foot_lock' | 'contact' | 'pose' | 'sequence';
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
    rootVelocitySpikeRatio?: number;
    poseVelocitySpikeRatio?: number;
    maxPoseVelocity?: number;
    startPositionDrift: number;
    endPositionDrift: number;
    lockedFootChanges: number;
    contactCount: number;
    motionSampleRate?: number;
    locomotionFootPlantDrift?: number;
    locomotionRootStepJitter?: number;
    locomotionFootContactCount?: number;
    locomotionFootPhaseMismatchCount?: number;
    locomotionRootBacktrackCount?: number;
    locomotionRootTravelDistance?: number;
    locomotionExpectedTravelDistance?: number;
    locomotionPaceCoverageRatio?: number;
    locomotionSupportSwitchCount?: number;
    locomotionSupportCoverageRatio?: number;
    locomotionArmSwingSeparation?: number;
    locomotionArmLegSyncScore?: number;
    locomotionLegSeparation?: number;
    locomotionLegSignChanges?: number;
    semanticTimingPeakRatio?: number;
    semanticTimingSpeedContrast?: number;
    semanticHandReachDistance?: number;
    semanticHandContactSuccessRatio?: number;
    semanticTargetApproachDistance?: number;
    semanticContactBodyDrive?: number;
    semanticContactFootStability?: number;
    semanticContactWindowCoverage?: number;
    semanticPropMotionDistance?: number;
    semanticPropDirectionAlignment?: number;
    semanticThrowReleaseDistance?: number;
    semanticPunchExtension?: number;
    semanticPunchRecoveryRatio?: number;
    sequenceBoundaryMaxPoseDelta?: number;
    sequenceBoundaryMaxRootDelta?: number;
    sequenceBoundaryMaxRotationDelta?: number;
    sequenceBoundaryMaxVelocityRatio?: number;
    sequenceBoundarySmoothnessRatio?: number;
    motionExpectationCount?: number;
    motionExpectationFailedCount?: number;
    motionExpectationPassRatio?: number;
  };
};
type MotionPipelineStepState = 'blocked' | 'ready' | 'running' | 'done' | 'failed' | 'stale';
type PoseTransitionTemplate = {
  id: ActionTemplateId;
  label: string;
  hand?: 'left' | 'right';
  targetObjectId?: string | null;
  strength: number;
};
type MotionGaitConfig = {
  cadenceHz: number;
  rootBob: number;
  weightShift: number;
  footPlant: number;
  strideDeg: number;
  armDeg: number;
  leanDeg: number;
  stanceRatio: number;
  swingLiftDeg: number;
  lateralSway: number;
};
type MotionSkillQualityTarget = {
  maxRootStepDistance: number;
  maxRootRotationDelta: number;
  maxPoseStepDelta: number;
  maxRootLift: number;
  minLegSeparation?: number;
  minArmSwingSeparation?: number;
  minSupportSwitchesPerSec?: number;
  minFootContactsPerSec?: number;
  maxFootPlantDrift?: number;
  maxRootStepJitter?: number;
  minPrimaryJointDelta?: number;
};
type MotionActionSkill = {
  actionType: MotionSemanticActionType;
  compileMode: 'semantic_only' | 'universal_assist';
  grounded: boolean;
  allowAirborne: boolean;
  gait?: MotionGaitConfig;
  rootLimits: { minDrop: number; maxLift: number };
  smoothing: { root: number; rotation: number; pose: number };
  maxHorizontalOverlay: number;
  maxYawOverlay: number;
  defaultTravelPerSec?: number;
  maxTravel?: number;
  quality: MotionSkillQualityTarget;
};
type PoseTransitionActionPlan = {
  mode?: 'motion_intent' | 'template_assist' | 'universal';
  universal?: UniversalMotionPlan;
  semanticPlan?: MotionSemanticPlan;
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
  cameraSamples?: CameraMotionSample[];
};
type TransitionKeyframe = {
  id: string;
  label: string;
  timeSec: number;
  transform: PoseTransform;
  pose: StandardHumanRigPose;
  bonePose?: Scene3DBonePose;
  fingerPose: StandardHumanFingerPose;
  toePose: StandardHumanToePose;
  posePresetId?: string;
  libTvJointAngles?: LibTvJointAngles;
  note?: string;
};
type CameraMotionType = 'none' | 'dolly_in' | 'dolly_out' | 'truck_left' | 'truck_right' | 'orbit' | 'follow_character' | 'low_tilt_up' | 'top_tilt_down' | 'handheld' | 'close_follow';
type CameraMotionConfig = {
  enabled: boolean;
  type: CameraMotionType;
  targetCharacterId?: string;
  intensity: number;
  startTimeSec: number;
  endTimeSec: number;
  distance: number;
  heightOffset: number;
  orbitAngleDeg: number;
  keepCharacterInFrame: boolean;
};
type CameraMotionSample = {
  timeSec: number;
  position: Vec3;
  targetPosition: Vec3;
  fov?: number;
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
  keyframes: TransitionKeyframe[];
  cameraMotion: CameraMotionConfig;
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
  focusObjectId?: string;
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
  onCreateRecordedVideoNode?: (result: Scene3DRecordedVideoResult) => void;
  onCreateActionVideoNode?: (result: any) => void;
  currentProjectId?: string | null;
  availableImageSources?: Array<{ id: string; label: string; mediaAssetId: string; mediaUrl: string; kind: string }>;
};
type Scene3DRecordedVideoResult = {
  video: {
    mediaUrl: string;
    mediaAssetId: string;
    mimeType: string;
    name: string;
    durationSec: number;
    durationMs: number;
  };
  transition: {
    id: string;
    name: string;
    actionPrompt: string;
  };
};

// SECTION: Node constants and option labels
const MODEL_URL = '/models/x-bot.glb';
const MAX_SCENE_HISTORY = 60;
const GROUND_SNAP_SETTLE_FRAMES = 45;
const GRID_SNAP_STEP = 0.25;
const GRID_ROTATION_SNAP_DEG = 5;
const GRID_SCALE_SNAP_STEP = 0.05;
const CURVE_OPTIONS: CurveType[] = ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'bullet_time', 'pulse', 'hold_then_burst'];
const CURVE_LABELS: Record<CurveType, string> = {
  linear: '线性',
  ease_in: '渐入',
  ease_out: '渐出',
  ease_in_out: '渐入渐出',
  bullet_time: '子弹时间',
  pulse: '脉冲',
  hold_then_burst: '保持后冲'
};
const CURVE_DESCRIPTIONS: Record<CurveType, string> = {
  linear: '匀速变化：从起点到终点按固定速度推进，没有加速或减速。',
  ease_in: '渐入：开始较慢，越到后面越快。',
  ease_out: '渐出：开始较快，越到后面越慢。',
  ease_in_out: '渐入渐出：开始和结束较慢，中段最快，整体更平滑。',
  bullet_time: '子弹时间：前段正常推进，中段明显放慢，末段再加速。',
  pulse: '脉冲：整体连续推进，中段短促加速一下，适合打击瞬间或突然发力。',
  hold_then_burst: '保持后冲：前段变化很少，后段快速完成，适合先停住蓄力、最后爆发完成。'
};
const SCENE_TOGGLE_DESCRIPTIONS = {
  groundCollision: '开启后角色和道具向下移动时会被地面阻挡，向上移动不受限制。',
  groundGrid: '显示地面上的参考网格，用于判断角色、道具和机位在场景中的位置关系。',
  motionPath: '显示动态播放时的角色运动轨迹，方便检查位移方向、节奏和轨迹是否流畅。',
  characterLabels: '在视口中显示角色名称，方便多角色场景中快速识别当前对象。',
  gridSnap: '移动、旋转或缩放对象时按网格步长对齐，方便精确摆放和保持位置整齐。'
};
const MAX_IMPORTED_MODEL_BYTES = 80 * 1024 * 1024;
const IMPORTED_MODEL_ACCEPT = '.fbx,.glb,.gltf,.obj,model/gltf-binary,model/gltf+json,model/obj,application/octet-stream';
const MAX_POSE_REFERENCE_IMAGE_BYTES = 12 * 1024 * 1024;
const POSE_REFERENCE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const SCENE_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21', '2.35:1', '1.85:1', '1.91:1'];
const POSE_KEYS: PoseJointKey[] = ['pelvis', 'chest', 'neck', 'head', 'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
const POSE_REFERENCE_VIEW_OPTIONS: Array<{ id: PoseReferenceView; label: string; hint: string }> = [
  { id: 'front', label: '正面', hint: '正面参考图' },
  { id: 'side', label: '侧面', hint: '侧面参考图' },
  { id: 'back', label: '背面', hint: '背面参考图' }
];
const POSE_LANDMARK_BONES: Array<[PoseLandmarkKey, PoseLandmarkKey]> = [
  ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'], ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'], ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'], ['leftAnkle', 'leftToe'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'], ['rightAnkle', 'rightToe'], ['nose', 'leftEye'], ['nose', 'rightEye']
];
const warnedMixamoLocalCoverageKeys = new Set<string>();

// SECTION: Pose reference image parsing and landmark-to-rig helpers
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

// SECTION: Finger, toe, and bone-pose helpers
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
// SECTION: Pose presets and preset compatibility helpers
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
const AIRBORNE_POSE_PRESET_IDS = new Set(['roll', 'jump', 'controlled', 'controlled2', 'float1', 'float2']);
const LIBTV_POSE_PRESETS_WITH_GROUND_MODE: LibTvPosePreset[] = LIBTV_POSE_PRESETS.map((preset) => ({
  ...preset,
  groundMode: AIRBORNE_POSE_PRESET_IDS.has(preset.id) ? 'airborne' : 'grounded'
}));
function normalizePosePresetId(presetId: string | undefined) {
  const id = presetId || 'stand';
  if (id === 'custom') return 'custom';
  const aliased = POSE_PRESET_ALIASES[id] || id;
  return LIBTV_POSE_PRESETS_WITH_GROUND_MODE.some((item) => item.id === aliased) ? aliased : 'stand';
}
function posePresetGroundMode(presetId?: string): 'grounded' | 'airborne' | 'custom' {
  const normalized = normalizePosePresetId(presetId);
  if (normalized === 'custom') return 'custom';
  return LIBTV_POSE_PRESETS_WITH_GROUND_MODE.find((item) => item.id === normalized)?.groundMode || 'grounded';
}
function shouldSnapPosePresetToGround(presetId?: string) {
  return posePresetGroundMode(presetId) === 'grounded';
}
function libTvPresetForId(presetId?: string) {
  const normalized = normalizePosePresetId(presetId);
  return normalized === 'custom' ? undefined : LIBTV_POSE_PRESETS_WITH_GROUND_MODE.find((item) => item.id === normalized);
}
function libTvJointAnglesForPresetId(presetId?: string) {
  return cloneLibTvJointAngles(libTvPresetForId(presetId)?.jointAngles);
}
const POSE_PRESETS: Array<{ id: string; label: string; pose: StandardHumanRigPose; bonePose?: Scene3DBonePose; fingerPose: StandardHumanFingerPose; toePose: StandardHumanToePose; rootOffset?: Vec3; groundMode?: 'grounded' | 'airborne' }> = LIBTV_POSE_PRESETS_WITH_GROUND_MODE.map((preset) => ({
  id: preset.id,
  label: preset.label,
  pose: preset.rigPose ? clonePose(preset.rigPose) : libTvPoseToRigPose(preset.jointAngles, preset.id),
  bonePose: cloneBonePose(preset.bonePose),
  fingerPose: cloneFingerPose(preset.fingerPose),
  toePose: cloneToePose(preset.toePose),
  rootOffset: preset.rootOffset,
  groundMode: preset.groundMode
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

// SECTION: Motion semantic vocabulary and action stages
const TEMPLATE_LABELS: Record<ActionTemplateId, string> = {
  look_at: '看向',
  turn_to: '转向',
  raise_hand: '抬手',
  wave: '挥手',
  point_at: '指向',
  step_forward: '向前迈步',
  step_back: '后退',
  sit_down: '坐下',
  stand_up: '站起',
  pick_up: '拿起',
  put_down: '放下',
  combat_strike: '格斗攻击',
  combat_block: '格挡',
  kick: '踢腿'
};

const MOTION_SEMANTIC_FAMILY_LABELS: Record<MotionSemanticActionFamily, string> = {
  locomotion: '移动',
  combat: '格斗',
  push_pull: '推拉',
  throw: '投掷',
  jump: '跳跃',
  fall: '倒地',
  crawl: '爬行',
  posture: '姿态变化',
  turn: '转身',
  reach: '伸手',
  unknown: '未识别'
};

const MOTION_SEMANTIC_TYPE_LABELS: Record<MotionSemanticActionType, string> = {
  walk: '走路',
  run: '跑步',
  dash: '冲刺',
  push: '推东西',
  pull: '拉东西',
  throw: '投掷',
  punch: '出拳',
  block: '格挡',
  kick: '踢腿',
  side_kick: '侧踢',
  jump: '跳起',
  crouch: '蹲下',
  crawl: '爬行',
  fall: '倒地',
  get_up: '起身',
  turn: '转身',
  reach: '伸手',
  idle: '静态姿势',
  unknown: '未识别'
};

type PromptHandPreference = 'left' | 'right' | 'both' | 'none';
type PromptLegPreference = 'left' | 'right' | 'none';
type MotionPromptLexicon = {
  family: MotionSemanticActionFamily;
  type: MotionSemanticActionType;
  match: RegExp;
  priority: number;
  reason: string;
};
type PromptActionMatch = MotionPromptLexicon & { index: number; sequenceReason?: string };
type PromptSequenceRelation = {
  before: MotionSemanticActionType;
  after: MotionSemanticActionType;
  reason: string;
};

const MOTION_PROMPT_LEXICON: MotionPromptLexicon[] = [
  { family: 'push_pull', type: 'push', priority: 100, match: /推|推动|推开|前推|推东西|推箱子|推门|push/, reason: '识别到“推”的动作动词' },
  { family: 'push_pull', type: 'pull', priority: 100, match: /拉|回拉|拉开|拖拽|拖动|pull|drag/, reason: '识别到“拉”的动作动词' },
  { family: 'throw', type: 'throw', priority: 96, match: /扔|投掷|投出|甩出|抛出|throw|toss/, reason: '识别到投掷动作' },
  { family: 'jump', type: 'jump', priority: 92, match: /跳|跳起|跃起|腾空|jump|hop|leap/, reason: '识别到跳跃或腾空' },
  { family: 'posture', type: 'crouch', priority: 90, match: /蹲|蹲下|下蹲|低重心|压低|躲避|闪避|下潜|crouch|squat|duck|evade/, reason: '识别到下蹲、低重心或躲避' },
  { family: 'combat', type: 'block', priority: 88, match: /格挡|防守|防御|招架|block|guard|parry/, reason: '识别到防守或格挡' },
  { family: 'combat', type: 'side_kick', priority: 86, match: /侧踢|横踢|侧向踢|side\s*kick/, reason: '识别到侧向踢腿' },
  { family: 'combat', type: 'kick', priority: 84, match: /踢|踢腿|踹|kick/, reason: '识别到踢腿动作' },
  { family: 'combat', type: 'punch', priority: 82, match: /出拳|挥拳|拳击|拳|攻击|打击|打斗|格斗|punch|jab|strike|attack|fight|combat/, reason: '识别到格斗攻击' },
  { family: 'crawl', type: 'crawl', priority: 78, match: /爬|爬行|匍匐|crawl|creep/, reason: '识别到爬行动作' },
  { family: 'fall', type: 'fall', priority: 76, match: /摔|倒地|跌倒|倒下|绊倒|fall|collapse|knockdown/, reason: '识别到倒地或跌倒' },
  { family: 'posture', type: 'get_up', priority: 74, match: /起身|站起|get up|stand up|rise/, reason: '识别到起身' },
  { family: 'locomotion', type: 'dash', priority: 70, match: /冲刺|疾跑|猛冲|dash|sprint/, reason: '识别到冲刺' },
  { family: 'locomotion', type: 'run', priority: 68, match: /跑|奔跑|跑步|run/, reason: '识别到跑步' },
  { family: 'locomotion', type: 'walk', priority: 64, match: /走|走路|步行|行走|迈步|walk|step/, reason: '识别到走路或迈步' },
  { family: 'turn', type: 'turn', priority: 58, match: /转身|转向|旋转|回头|turn|rotate|spin|pivot/, reason: '识别到转身' },
  { family: 'reach', type: 'reach', priority: 54, match: /伸手|拿|抓|指向|触碰|reach|grab|point|touch/, reason: '识别到伸手或触碰' }
];
function matchesPrompt(prompt: string, pattern: RegExp) {
  return pattern.test(prompt.trim().toLowerCase());
}

function promptActionMatches(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  return promptActionMatchesByPosition(normalized)
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
}

function promptActionMatchesByPosition(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  return MOTION_PROMPT_LEXICON
    .map((item) => {
      const match = normalized.match(item.match);
      return match && match.index !== undefined ? { ...item, index: match.index } : null;
    })
    .filter((item): item is PromptActionMatch => Boolean(item))
    .sort((a, b) => a.index === b.index ? b.priority - a.priority : a.index - b.index);
}

function hasPromptApproachBeforeContact(normalized: string) {
  const hasApproachVerb = /过去|靠近|接近|上前|跑到|走到|冲到|跑向|走向|冲向|move to|approach/.test(normalized);
  const hasContactVerb = /推|拉|抓|拿|触碰|碰到|接触|攻击|出拳|踢|投掷|扔|push|pull|grab|touch|punch|kick|throw/.test(normalized);
  return hasApproachVerb && hasContactVerb;
}

function hasPromptTurnBeforeAction(normalized: string) {
  return /(?:转身|回身|转向|回头|pivot|turn).{0,12}(?:后|之后|再|然后|投|扔|出拳|挥拳|踢|攻击|throw|punch|kick|attack)/.test(normalized)
    || /(?:投|扔|出拳|挥拳|踢|攻击|throw|punch|kick|attack).{0,12}(?:前|之前).{0,8}(?:转身|回身|转向|回头|pivot|turn)/.test(normalized);
}

function hasPromptCrouchBeforeRecovery(normalized: string) {
  return /(?:蹲|蹲下|下蹲|低重心|躲避|闪避|下潜|crouch|duck|evade).{0,14}(?:后|之后|再|然后|起身|站起|出拳|攻击|get up|stand up|punch|attack)/.test(normalized);
}

function hasPromptRecoveryBeforeAttack(normalized: string) {
  return /(?:起身|站起|get up|stand up|rise).{0,12}(?:后|之后|再|然后|出拳|挥拳|攻击|踢|投|扔|punch|attack|kick|throw)/.test(normalized)
    || /(?:出拳|挥拳|攻击|踢|投|扔|punch|attack|kick|throw).{0,12}(?:前|之前).{0,8}(?:起身|站起|get up|stand up|rise)/.test(normalized);
}

function hasPromptFallBeforeRecovery(normalized: string) {
  return /(?:摔|倒地|跌倒|倒下|fall|collapse).{0,14}(?:后|之后|再|然后|起身|站起|get up|stand up|rise)/.test(normalized);
}

function promptActionOccurrence(normalized: string, actionType: MotionSemanticActionType) {
  const lexicon = MOTION_PROMPT_LEXICON.find((item) => item.type === actionType);
  if (!lexicon) return null;
  const match = normalized.match(lexicon.match);
  if (!match || match.index === undefined) return null;
  return {
    start: match.index,
    end: match.index + match[0].length
  };
}

function promptSequenceConnectorBetween(text: string) {
  return /后|之后|以后|然后|再|接着|随后|紧接着|接下来|then|after/.test(text);
}

function promptReverseSequenceConnectorBetween(text: string) {
  return /前|之前|before/.test(text);
}

function promptExplicitSequenceRelations(normalized: string, actionTypes: MotionSemanticActionType[]): PromptSequenceRelation[] {
  const uniqueTypes = Array.from(new Set(actionTypes.filter((type) => type !== 'unknown' && type !== 'idle')));
  const occurrences = new Map<MotionSemanticActionType, { start: number; end: number }>();
  uniqueTypes.forEach((type) => {
    const occurrence = promptActionOccurrence(normalized, type);
    if (occurrence) occurrences.set(type, occurrence);
  });
  const relations: PromptSequenceRelation[] = [];
  const addRelation = (before: MotionSemanticActionType, after: MotionSemanticActionType, reason: string) => {
    if (before === after) return;
    if (relations.some((item) => item.before === before && item.after === after)) return;
    relations.push({ before, after, reason });
  };

  for (let a = 0; a < uniqueTypes.length; a += 1) {
    for (let b = a + 1; b < uniqueTypes.length; b += 1) {
      const firstType = uniqueTypes[a];
      const secondType = uniqueTypes[b];
      const first = occurrences.get(firstType);
      const second = occurrences.get(secondType);
      if (!first || !second) continue;
      const earlierType = first.start <= second.start ? firstType : secondType;
      const laterType = first.start <= second.start ? secondType : firstType;
      const earlier = first.start <= second.start ? first : second;
      const later = first.start <= second.start ? second : first;
      const between = normalized.slice(earlier.end, later.start);
      if (promptSequenceConnectorBetween(between)) {
        addRelation(earlierType, laterType, '根据“然后/之后/再”等连接词，保持提示词中的先后顺序');
      }
      if (promptReverseSequenceConnectorBetween(between)) {
        addRelation(laterType, earlierType, '根据“之前/前/before”等连接词，后出现的准备动作需要先执行');
      }
    }
  }

  if (hasPromptApproachBeforeContact(normalized)) {
    uniqueTypes.filter(isLocomotionActionType).forEach((locomotionType) => {
      uniqueTypes
        .filter((type) => ['push', 'pull', 'reach', 'throw', 'punch', 'kick', 'side_kick'].includes(type))
        .forEach((actionType) => {
          addRelation(locomotionType, actionType, '根据“过去/靠近/跑到”等语义，先完成靠近目标，再执行接触或攻击动作');
        });
    });
  }

  if (hasPromptTurnBeforeAction(normalized)) {
    uniqueTypes
      .filter((type) => type === 'turn')
      .forEach((turnType) => {
        uniqueTypes
          .filter((type) => ['push', 'pull', 'reach', 'throw', 'punch', 'kick', 'side_kick'].includes(type))
          .forEach((actionType) => addRelation(turnType, actionType, '根据“转身后/回身后”语义，先转身再发力'));
      });
  }

  if (hasPromptCrouchBeforeRecovery(normalized)) {
    uniqueTypes
      .filter((type) => type === 'crouch' || type === 'block')
      .forEach((lowType) => {
        uniqueTypes
          .filter((type) => type === 'get_up' || type === 'punch' || type === 'kick' || type === 'side_kick' || type === 'throw')
          .forEach((actionType) => addRelation(lowType, actionType, '根据“躲避后/蹲下后”语义，先下沉防守，再进入后续动作'));
      });
  }

  if (hasPromptFallBeforeRecovery(normalized)) {
    addRelation('fall', 'get_up', '根据“倒地后起身”语义，先倒地再起身');
  }

  if (hasPromptRecoveryBeforeAttack(normalized)) {
    uniqueTypes
      .filter((type) => type === 'get_up')
      .forEach((recoveryType) => {
        uniqueTypes
          .filter((type) => ['punch', 'kick', 'side_kick', 'throw'].includes(type))
          .forEach((actionType) => addRelation(recoveryType, actionType, '根据“起身后”语义，先恢复站姿再攻击或投掷'));
      });
  }

  return relations;
}

function actionSequenceHasType(items: PromptActionMatch[], predicate: (type: MotionSemanticActionType) => boolean) {
  return items.some((item) => predicate(item.type));
}

function appendPromptActionReason(item: PromptActionMatch, reason: string) {
  const parts = [item.sequenceReason, reason].filter(Boolean);
  return {
    ...item,
    sequenceReason: Array.from(new Set(parts)).join('；')
  };
}

function movePromptActionBefore(items: PromptActionMatch[], before: (type: MotionSemanticActionType) => boolean, after: (type: MotionSemanticActionType) => boolean, reason: string) {
  const beforeIndex = items.findIndex((item) => before(item.type));
  const afterIndex = items.findIndex((item) => after(item.type));
  if (beforeIndex < 0 || afterIndex < 0) return items;
  if (beforeIndex < afterIndex) {
    return items.map((item, index) => index === beforeIndex ? appendPromptActionReason(item, reason) : item);
  }
  const next = items.slice();
  const [moved] = next.splice(beforeIndex, 1);
  const targetIndex = next.findIndex((item) => after(item.type));
  next.splice(Math.max(0, targetIndex), 0, appendPromptActionReason(moved, reason));
  return next;
}

function normalizePromptActionSequenceOrder(items: PromptActionMatch[], normalized: string) {
  let next = items.slice();
  const hasLocomotion = actionSequenceHasType(next, isLocomotionActionType);
  const hasContactOrAttack = actionSequenceHasType(next, (type) => ['push', 'pull', 'reach', 'throw', 'punch', 'kick', 'side_kick'].includes(type));

  if (hasLocomotion && hasContactOrAttack && hasPromptApproachBeforeContact(normalized)) {
    next = movePromptActionBefore(
      next,
      isLocomotionActionType,
      (type) => ['push', 'pull', 'reach', 'throw', 'punch', 'kick', 'side_kick'].includes(type),
      '根据“过去/靠近/跑到”等语义，先完成靠近目标，再执行接触或攻击动作'
    );
  }

  if (hasPromptTurnBeforeAction(normalized)) {
    next = movePromptActionBefore(
      next,
      (type) => type === 'turn',
      (type) => ['throw', 'punch', 'kick', 'side_kick'].includes(type),
      '根据“转身后/回身后”语义，先转身再发力'
    );
  }

  if (hasPromptCrouchBeforeRecovery(normalized)) {
    next = movePromptActionBefore(
      next,
      (type) => type === 'crouch' || type === 'block',
      (type) => type === 'get_up' || type === 'punch' || type === 'kick' || type === 'side_kick',
      '根据“躲避后/蹲下后”语义，先下沉防守，再进入后续动作'
    );
  }

  if (hasPromptFallBeforeRecovery(normalized)) {
    next = movePromptActionBefore(
      next,
      (type) => type === 'fall',
      (type) => type === 'get_up',
      '根据“倒地后起身”语义，先倒地再起身'
    );
  }

  if (hasPromptRecoveryBeforeAttack(normalized)) {
    next = movePromptActionBefore(
      next,
      (type) => type === 'get_up',
      (type) => ['punch', 'kick', 'side_kick', 'throw'].includes(type),
      '根据“起身后”语义，先恢复站姿再攻击或投掷'
    );
  }

  promptExplicitSequenceRelations(normalized, next.map((item) => item.type)).forEach((relation) => {
    next = movePromptActionBefore(
      next,
      (type) => type === relation.before,
      (type) => type === relation.after,
      relation.reason
    );
  });

  return next;
}

function promptNeedsImplicitGetUpBeforeAttack(normalized: string) {
  return /(?:蹲|蹲下|下蹲|低重心|躲避|闪避|下潜|crouch|duck|evade).{0,18}(?:后|之后|再|然后|接着|随后|then|after).{0,18}(?:出拳|挥拳|攻击|踢|投|扔|punch|attack|kick|throw)/.test(normalized);
}

function insertImplicitActionAfter(
  items: PromptActionMatch[],
  after: (type: MotionSemanticActionType) => boolean,
  before: (type: MotionSemanticActionType) => boolean,
  actionType: MotionSemanticActionType,
  reason: string,
  normalizedLength: number
) {
  if (items.some((item) => item.type === actionType)) return items;
  const afterIndex = items.findIndex((item) => after(item.type));
  const beforeIndex = items.findIndex((item) => before(item.type));
  if (afterIndex < 0 || beforeIndex < 0 || beforeIndex <= afterIndex) return items;
  const next = items.slice();
  next.splice(beforeIndex, 0, {
    family: motionSemanticFamilyForAction(actionType),
    type: actionType,
    match: /$/,
    priority: 10,
    reason,
    index: Math.max(0, Math.min(normalizedLength, Math.round((items[afterIndex].index + items[beforeIndex].index) / 2))),
    sequenceReason: reason
  });
  return next;
}

function motionSemanticFamilyForAction(actionType: MotionSemanticActionType): MotionSemanticActionFamily {
  if (actionType === 'walk' || actionType === 'run' || actionType === 'dash') return 'locomotion';
  if (actionType === 'push' || actionType === 'pull') return 'push_pull';
  if (actionType === 'throw') return 'throw';
  if (actionType === 'punch' || actionType === 'block' || actionType === 'kick' || actionType === 'side_kick') return 'combat';
  if (actionType === 'jump') return 'jump';
  if (actionType === 'fall' || actionType === 'get_up') return 'fall';
  if (actionType === 'crawl') return 'crawl';
  if (actionType === 'crouch') return 'posture';
  if (actionType === 'turn') return 'turn';
  if (actionType === 'reach') return 'reach';
  return 'unknown';
}

function sequenceActionCoreWeight(actionType: MotionSemanticActionType, index: number, count: number) {
  if (isLocomotionActionType(actionType)) return index === 0 && count > 1 ? 1.22 : 0.92;
  if (actionType === 'turn') return index === 0 && count > 1 ? 0.78 : 0.9;
  if (actionType === 'push' || actionType === 'pull') return 1.2;
  if (actionType === 'throw') return 1.18;
  if (actionType === 'punch' || actionType === 'kick' || actionType === 'side_kick') return 1.02;
  if (actionType === 'reach') return 0.96;
  if (actionType === 'crouch' || actionType === 'block') return 0.92;
  if (actionType === 'jump') return 1.05;
  return 1;
}

function sequenceActionOverlap(previous: MotionSemanticActionType, next: MotionSemanticActionType) {
  if (isLocomotionActionType(previous) && (next === 'push' || next === 'pull' || next === 'reach')) return 0.12;
  if (isLocomotionActionType(previous) && (next === 'punch' || next === 'kick' || next === 'side_kick')) return 0.1;
  if (previous === 'turn' && (next === 'throw' || next === 'punch' || next === 'kick' || next === 'side_kick')) return 0.12;
  if ((previous === 'push' || previous === 'pull' || previous === 'reach') && (next === 'throw' || next === 'punch')) return 0.08;
  return 0.075;
}

function sequenceActionMinDurationRatio(actionType: MotionSemanticActionType, sequenceLength = 1) {
  const crowdScale = sequenceLength >= 4 ? 0.86 : sequenceLength >= 3 ? 0.93 : 1;
  const base = isLocomotionActionType(actionType)
    ? 0.18
    : actionType === 'push' || actionType === 'pull' || actionType === 'throw'
      ? 0.28
      : actionType === 'reach'
        ? 0.22
        : actionType === 'get_up' || actionType === 'fall'
          ? 0.2
          : 0.16;
  return Number((base * crowdScale).toFixed(3));
}

function scheduledActionSequenceWindows(actions: MotionSemanticActionType[]) {
  const count = actions.length;
  if (!count) return [];
  if (count === 1) return [{ startRatio: 0, endRatio: 1 }];

  const weights = actions.map((actionType, index) => sequenceActionCoreWeight(actionType, index, count));
  const totalWeight = weights.reduce((total, value) => total + value, 0) || 1;
  let cursor = 0;
  const core = weights.map((weight) => {
    const start = cursor;
    const end = cursor + weight / totalWeight;
    cursor = end;
    return { startRatio: start, endRatio: end };
  });

  return core.map((window, index) => {
    const previousOverlap = index > 0 ? sequenceActionOverlap(actions[index - 1], actions[index]) : 0;
    const nextOverlap = index < count - 1 ? sequenceActionOverlap(actions[index], actions[index + 1]) : 0;
    let startRatio = clampNumber(index === 0 ? 0 : window.startRatio - previousOverlap * 0.5, 0, 1);
    let endRatio = clampNumber(index === count - 1 ? 1 : window.endRatio + nextOverlap * 0.5, startRatio + 0.08, 1);
    const minDuration = sequenceActionMinDurationRatio(actions[index], count);
    if (endRatio - startRatio < minDuration) {
      const center = (startRatio + endRatio) / 2;
      startRatio = clampNumber(center - minDuration / 2, 0, Math.max(0, 1 - minDuration));
      endRatio = clampNumber(startRatio + minDuration, minDuration, 1);
    }
    return {
      startRatio: Number(startRatio.toFixed(3)),
      endRatio: Number(endRatio.toFixed(3))
    };
  });
}

function motionActionSequenceSummary(sequence: MotionActionSequenceStep[]) {
  if (!sequence.length) return '';
  return '动作序列：' + sequence
    .map((step) => `${step.label} ${Math.round(step.startRatio * 100)}%-${Math.round(step.endRatio * 100)}%`)
    .join(' → ') + '。';
}

function motionActionChainsForPrompt(prompt: string, sequence: MotionActionSequenceStep[]) {
  if (!sequence.length) return [] as MotionActionChain[];
  const normalized = prompt.trim().toLowerCase();
  const hasStep = (predicate: (type: MotionSemanticActionType) => boolean) => sequence.some((step) => predicate(step.actionType));
  const chains: MotionActionChain[] = [];
  if (hasPromptApproachBeforeContact(normalized) && hasStep(isLocomotionActionType) && hasStep((type) => type === 'push' || type === 'pull')) {
    chains.push({
      id: 'approach_contact',
      label: '靠近后接触',
      steps: sequence.filter((step) => isLocomotionActionType(step.actionType) || step.actionType === 'push' || step.actionType === 'pull').map((step) => step.actionType),
      description: '先移动到目标附近，再减速贴近并用手接触目标发力。',
      qualityExpectationIds: ['target_approach', 'approach_contact_bridge', 'hand_contact', 'contact_window']
    });
  }
  if (hasPromptTurnBeforeAction(normalized) && hasStep((type) => type === 'turn') && hasStep((type) => type === 'throw')) {
    chains.push({
      id: 'turn_throw',
      label: '转身后投掷',
      steps: sequence.filter((step) => step.actionType === 'turn' || step.actionType === 'throw').map((step) => step.actionType),
      description: '先完成转身和躯干扭转，再进入投掷蓄力、出手和释放。',
      qualityExpectationIds: ['turn_throw_bridge', 'throw_body_windup', 'throw_release']
    });
  }
  if (promptNeedsImplicitGetUpBeforeAttack(normalized) && hasStep((type) => type === 'crouch' || type === 'block') && hasStep((type) => type === 'get_up') && hasStep((type) => type === 'punch' || type === 'kick' || type === 'side_kick' || type === 'throw')) {
    chains.push({
      id: 'low_recovery_attack',
      label: '下沉恢复后攻击',
      steps: sequence.filter((step) => step.actionType === 'crouch' || step.actionType === 'block' || step.actionType === 'get_up' || step.actionType === 'punch' || step.actionType === 'kick' || step.actionType === 'side_kick' || step.actionType === 'throw').map((step) => step.actionType),
      description: '先下沉躲避或防守，再起身恢复重心，最后执行攻击。',
      qualityExpectationIds: ['low_recovery_attack_bridge', 'punch_extension', 'punch_recovery']
    });
  }
  return chains;
}

function motionActionChainSummary(chains: MotionActionChain[]) {
  if (!chains.length) return '';
  return '固定动作链路：' + chains.map((chain) => `${chain.label}（${chain.description}）`).join('；') + '。';
}

function rescheduleActionSequence(sequence: MotionActionSequenceStep[] | undefined) {
  if (!sequence || sequence.length <= 1) return sequence;
  const windows = scheduledActionSequenceWindows(sequence.map((step) => step.actionType));
  return sequence.map((step, index) => {
    const window = windows[index];
    if (!window) return step;
    return {
      ...step,
      startRatio: window.startRatio,
      endRatio: window.endRatio,
      sourceText: `${step.sourceText.split(';')[0]}; ${Math.round(window.startRatio * 100)}%-${Math.round(window.endRatio * 100)}%`
    };
  });
}

function sequenceReportHasMessage(report: MotionQualityReport, text: string) {
  return report.issues.some((issue) => issue.metric === 'sequence' && issue.message.includes(text));
}

function sequenceQualityNeedsWindowRebalance(report: MotionQualityReport) {
  return sequenceReportHasMessage(report, '阶段时间过短')
    || sequenceReportHasMessage(report, '缺少承接重叠')
    || sequenceReportHasMessage(report, '混合过多')
    || sequenceReportHasMessage(report, '过渡不够平滑')
    || sequenceReportHasMessage(report, '速度突变')
    || sequenceReportHasMessage(report, '顺序相反')
    || (report.metrics.sequenceBoundarySmoothnessRatio !== undefined && report.metrics.sequenceBoundarySmoothnessRatio < 0.76)
    || (report.metrics.sequenceBoundaryMaxPoseDelta !== undefined && report.metrics.sequenceBoundaryMaxPoseDelta > 30)
    || (report.metrics.sequenceBoundaryMaxRootDelta !== undefined && report.metrics.sequenceBoundaryMaxRootDelta > 0.11)
    || (report.metrics.sequenceBoundaryMaxVelocityRatio !== undefined && report.metrics.sequenceBoundaryMaxVelocityRatio > 2.35);
}

function rebalanceActionSequenceWindows(sequence: MotionActionSequenceStep[], report?: MotionQualityReport) {
  if (sequence.length <= 1) return sequence;
  const scheduled = rescheduleActionSequence(sequence) || sequence;
  if (!report || !sequenceQualityNeedsWindowRebalance(report)) return scheduled;

  const count = scheduled.length;
  const targetOverlap = clampNumber(
    (report.metrics.sequenceBoundarySmoothnessRatio ?? 1) < 0.62 ? 0.13 : 0.095,
    0.075,
    0.14
  );
  const minDurations = scheduled.map((step) => sequenceActionMinDurationRatio(step.actionType, count));
  const next = scheduled.map((step, index) => {
    const minDuration = minDurations[index];
    const startRatio = clampNumber(step.startRatio, 0, Math.max(0, 1 - minDuration));
    const endRatio = clampNumber(step.endRatio, startRatio + minDuration, 1);
    return {
      ...step,
      startRatio,
      endRatio
    };
  });

  for (let index = 0; index < next.length - 1; index += 1) {
    const current = next[index];
    const following = next[index + 1];
    const overlap = current.endRatio - following.startRatio;
    if (overlap >= targetOverlap * 0.72 && overlap <= targetOverlap * 1.75) continue;
    const center = clampNumber((current.endRatio + following.startRatio) / 2, current.startRatio + minDurations[index] * 0.58, following.endRatio - minDurations[index + 1] * 0.58);
    current.endRatio = clampNumber(center + targetOverlap * 0.5, current.startRatio + minDurations[index], 1);
    following.startRatio = clampNumber(center - targetOverlap * 0.5, 0, following.endRatio - minDurations[index + 1]);
    current.sourceText = `${current.sourceText.split(';')[0]}; ${Math.round(current.startRatio * 100)}%-${Math.round(current.endRatio * 100)}%`;
    following.sourceText = `${following.sourceText.split(';')[0]}; ${Math.round(following.startRatio * 100)}%-${Math.round(following.endRatio * 100)}%`;
  }

  next[0].startRatio = 0;
  next[next.length - 1].endRatio = 1;
  return next.map((step) => ({
    ...step,
    startRatio: Number(clamp01(step.startRatio).toFixed(3)),
    endRatio: Number(clampNumber(step.endRatio, step.startRatio, 1).toFixed(3))
  }));
}

function transitionWithQualityAdjustedActionSequence(transition: PoseTransition, report?: MotionQualityReport): PoseTransition {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const sequence = semanticPlan?.actionSequence;
  if (!semanticPlan || !sequence || sequence.length <= 1) return transition;
  const adjusted = rebalanceActionSequenceWindows(sequence, report);
  const changed = adjusted.some((step, index) => (
    step.startRatio !== sequence[index]?.startRatio
    || step.endRatio !== sequence[index]?.endRatio
    || step.sourceText !== sequence[index]?.sourceText
  ));
  if (!changed) return transition;
  return {
    ...transition,
    actionPlan: {
      ...transition.actionPlan,
      semanticPlan: {
        ...semanticPlan,
        actionSequence: adjusted,
        poseStages: sequencePoseStages(adjusted, semanticPlan.actionType),
        explain: [
          ...semanticPlan.explain.filter((item) => !item.startsWith('动作序列：')),
          motionActionSequenceSummary(adjusted)
        ].filter(Boolean)
      }
    }
  };
}

function transitionWithRescheduledActionSequence(transition: PoseTransition): PoseTransition {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const sequence = semanticPlan?.actionSequence ? rebalanceActionSequenceWindows(semanticPlan.actionSequence) : undefined;
  if (!semanticPlan || !sequence || sequence === semanticPlan.actionSequence) return transition;
  return {
    ...transition,
    actionPlan: {
      ...transition.actionPlan,
      semanticPlan: {
        ...semanticPlan,
        actionSequence: sequence,
        poseStages: sequencePoseStages(sequence, semanticPlan.actionType),
        explain: [
          ...semanticPlan.explain.filter((item) => !item.startsWith('动作序列：')),
          motionActionSequenceSummary(sequence)
        ].filter(Boolean)
      }
    }
  };
}

function buildPromptActionSequence(prompt: string, primaryActionType: MotionSemanticActionType): MotionActionSequenceStep[] {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return [];
  const ordered = promptActionMatchesByPosition(normalized);
  const unique: PromptActionMatch[] = [];
  ordered.forEach((item) => {
    if (unique.some((existing) => existing.type === item.type)) return;
    if (unique.length && unique[unique.length - 1].family === item.family && unique[unique.length - 1].type !== primaryActionType) return;
    unique.push(item);
  });
  if (!unique.some((item) => item.type === primaryActionType) && primaryActionType !== 'unknown' && primaryActionType !== 'idle') {
    unique.push({
      family: motionSemanticFamilyForAction(primaryActionType),
      type: primaryActionType,
      match: /$/,
      priority: 0,
      reason: '主动作',
      index: normalized.length
    });
  }
  let sequenced = normalizePromptActionSequenceOrder(unique, normalized);
  if (promptNeedsImplicitGetUpBeforeAttack(normalized)) {
    sequenced = insertImplicitActionAfter(
      sequenced,
      (type) => type === 'crouch' || type === 'block',
      (type) => ['punch', 'kick', 'side_kick', 'throw'].includes(type),
      'get_up',
      '根据“蹲下/躲避后攻击”的语义，自动加入起身恢复阶段',
      normalized.length
    );
  }
  if (sequenced.length <= 1) return [];
  const steps = normalizePromptActionSequenceOrder(sequenced, normalized).slice(0, 4);
  const windows = scheduledActionSequenceWindows(steps.map((item) => item.type));
  return steps.map((item, index) => {
    const window = windows[index] || { startRatio: 0, endRatio: 1 };
    const reason = item.sequenceReason ? `${item.reason}；${item.sequenceReason}` : item.reason;
    return {
      id: `sequence_${index}_${item.type}`,
      actionType: item.type,
      label: MOTION_SEMANTIC_TYPE_LABELS[item.type],
      startRatio: window.startRatio,
      endRatio: window.endRatio,
      sourceText: `${reason}; ${Math.round(window.startRatio * 100)}%-${Math.round(window.endRatio * 100)}%`
    };
  });
}

function normalizedPromptText(prompt: string) {
  return prompt.trim().toLowerCase();
}

function promptHasLeftHand(prompt: string) {
  return /左手|left\s+hand/.test(normalizedPromptText(prompt));
}

function promptHasRightHand(prompt: string) {
  return /右手|right\s+hand/.test(normalizedPromptText(prompt));
}

function promptHasLeftLeg(prompt: string) {
  return /左脚|左腿|left\s+(?:foot|leg)/.test(normalizedPromptText(prompt));
}

function promptHasRightLeg(prompt: string) {
  return /右脚|右腿|right\s+(?:foot|leg)/.test(normalizedPromptText(prompt));
}

function promptHasLeftwardDirection(prompt: string) {
  const normalized = normalizedPromptText(prompt);
  const hasSideTurnOnly = /向左转|左转|转向左|朝左转/.test(normalized)
    && !/(向左走|向左跑|向左冲|向左迈|往左走|往左跑|左移|左侧移动|左侧跑|左侧走)/.test(normalized)
    && !/\b(?:leftward|to\s+the\s+left|move\s+left|step\s+left|run\s+left|walk\s+left|dash\s+left|lunge\s+left|strafe\s+left)\b/.test(normalized);
  if (hasSideTurnOnly) return false;
  return /向左|左侧|左边|左方|往左|朝左|左移/.test(normalized)
    || /\b(?:leftward|to\s+the\s+left|move\s+left|step\s+left|run\s+left|walk\s+left|dash\s+left|lunge\s+left|strafe\s+left)\b/.test(normalized);
}

function promptHasRightwardDirection(prompt: string) {
  const normalized = normalizedPromptText(prompt);
  const hasSideTurnOnly = /向右转|右转|转向右|朝右转/.test(normalized)
    && !/(向右走|向右跑|向右冲|向右迈|往右走|往右跑|右移|右侧移动|右侧跑|右侧走)/.test(normalized)
    && !/\b(?:rightward|to\s+the\s+right|move\s+right|step\s+right|run\s+right|walk\s+right|dash\s+right|lunge\s+right|strafe\s+right)\b/.test(normalized);
  if (hasSideTurnOnly) return false;
  return /向右|右侧|右边|右方|往右|朝右|右移/.test(normalized)
    || /\b(?:rightward|to\s+the\s+right|move\s+right|step\s+right|run\s+right|walk\s+right|dash\s+right|lunge\s+right|strafe\s+right)\b/.test(normalized);
}

function inferPromptHand(prompt: string): PromptHandPreference {
  const normalized = normalizedPromptText(prompt);
  if (/双手|两手|both\s+hands/.test(normalized)) return 'both';
  if (promptHasLeftHand(normalized)) return 'left';
  if (promptHasRightHand(normalized)) return 'right';
  return 'none';
}

function handForTemplate(prompt: string): 'left' | 'right' {
  return inferPromptHand(prompt) === 'left' ? 'left' : 'right';
}

function inferPromptLeg(prompt: string): PromptLegPreference {
  if (promptHasLeftLeg(prompt)) return 'left';
  if (promptHasRightLeg(prompt)) return 'right';
  return 'none';
}

function semanticDirectionFromPrompt(prompt: string, universal?: UniversalMotionPlan) {
  const normalized = normalizedPromptText(prompt);
  if (promptHasLeftwardDirection(normalized)) return { label: '向左', direction: vec(-1, 0, 0) };
  if (promptHasRightwardDirection(normalized)) return { label: '向右', direction: vec(1, 0, 0) };
  if (/向后|后退|退后|远离|back|backward|retreat/.test(normalized)) return { label: '向后', direction: vec(0, 0, 1) };
  if (/向前|前方|前进|靠近|推进|冲向|扑向|forward|approach|lunge/.test(normalized)) return { label: '向前', direction: vec(0, 0, -1) };
  if (universal && Math.abs(universal.turn) > 1) return { label: universal.turn < 0 ? '向左转' : '向右转', direction: vec() };
  if (universal && (universal.direction.x || universal.direction.z)) {
    if (Math.abs(universal.direction.x) > Math.abs(universal.direction.z)) return { label: universal.direction.x < 0 ? '向左' : '向右', direction: universal.direction };
    return { label: universal.direction.z < 0 ? '向前' : '向后', direction: universal.direction };
  }
  return { label: '未指定', direction: vec() };
}

function promptSpeedLabel(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  if (/快速|迅速|疾速|突然|猛冲|冲刺|fast|quick|sudden|dash|sprint/.test(normalized)) return '快速';
  if (/缓慢|慢慢|慢速|slow/.test(normalized)) return '缓慢';
  if (/持续|保持|continuous|hold/.test(normalized)) return '持续';
  return '常规';
}

function promptForceLabel(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  if (/用力|猛烈|重击|强力|heavy|strong|impact|powerful/.test(normalized)) return '强';
  if (/轻微|轻轻|轻|small|soft|slight/.test(normalized)) return '轻';
  return '常规';
}

function motionControlFromPrompt(prompt: string, semanticPlan?: Pick<MotionSemanticPlan, 'speedLabel' | 'forceLabel'>) {
  const speedLabel = semanticPlan?.speedLabel || promptSpeedLabel(prompt);
  const forceLabel = semanticPlan?.forceLabel || promptForceLabel(prompt);
  const burst = promptRequestsBurstTiming(prompt);
  const sustained = promptRequestsSustainedTiming(prompt);
  const accelerate = promptRequestsAccelerateTiming(prompt);
  const decelerate = promptRequestsDecelerateTiming(prompt);
  const speedScale = speedLabel === '快速' || burst
    ? 1.14
    : speedLabel === '缓慢' || decelerate
      ? 0.82
      : 1;
  const forceScale = forceLabel === '强' || burst
    ? 1.22
    : forceLabel === '轻'
      ? 0.72
      : 1;
  const holdScale = sustained
    ? 1.3
    : speedLabel === '缓慢'
      ? 1.18
      : speedLabel === '快速' || burst
        ? 0.86
        : 1;
  const travelScale = forceLabel === '强'
    ? 1.18
    : forceLabel === '轻'
      ? 0.74
      : speedLabel === '快速'
        ? 1.08
        : speedLabel === '缓慢'
          ? 0.86
          : 1;
  return {
    speedLabel,
    forceLabel,
    speedScale,
    forceScale,
    holdScale,
    travelScale,
    burst,
    sustained,
    accelerate,
    decelerate
  };
}

function promptStageTags(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  const tags: string[] = [];
  const add = (tag: string, pattern: RegExp) => {
    if (pattern.test(normalized) && !tags.includes(tag)) tags.push(tag);
  };
  add('预备', /预备|准备|起势|起手|anticipation|prepare/);
  add('蓄力', /蓄力|后拉|回拉|后方|windup|charge|draw back/);
  add('发力', /发力|用力|爆发|甩出|推出|冲出|drive|power|burst/);
  add('接触', /接触|碰到|抓住|握住|贴近|contact|grasp|touch/);
  add('保持', /保持|持续|hold|keep|sustain/);
  add('回收', /回收|收势|恢复|回到|recovery|recover/);
  add('低重心', /低重心|下蹲|蹲下|压低|duck|crouch|low/);
  return tags;
}

function promptBodyControlTags(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  const tags: string[] = [];
  const add = (tag: string, pattern: RegExp) => {
    if (pattern.test(normalized) && !tags.includes(tag)) tags.push(tag);
  };
  add('身体前压', /身体前压|前倾|压上去|lean forward|body forward/);
  add('身体后仰', /后仰|向后仰|lean back/);
  add('双脚贴地', /双脚踩地|脚贴地|踩地|贴地|grounded|feet on ground/);
  add('允许离地', /跳|跳起|腾空|飞跃|浮空|离地|jump|airborne|leap/);
  add('双手主导', /双手|两手|both hands/);
  add('左手主导', /左手|left hand/);
  add('右手主导', /右手|right hand/);
  add('左腿主导', /左脚|左腿|left foot|left leg/);
  add('右腿主导', /右脚|右腿|right foot|right leg/);
  add('看向目标', /看向|面向|盯着|look at|face/);
  return tags;
}

function motionPromptControlSummary(prompt: string, universal?: UniversalMotionPlan, semanticPlan?: Pick<MotionSemanticPlan, 'speedLabel' | 'forceLabel'>) {
  const control = motionControlFromPrompt(prompt, semanticPlan);
  const direction = semanticDirectionFromPrompt(prompt, universal);
  const timingTags = [
    control.burst ? '突然爆发' : '',
    control.sustained ? '持续保持' : '',
    control.accelerate ? '逐渐加速' : '',
    control.decelerate ? '逐渐减速' : ''
  ].filter(Boolean);
  return {
    directionLabel: direction.label,
    speedLabel: control.speedLabel,
    forceLabel: control.forceLabel,
    timingTags,
    stageTags: promptStageTags(prompt),
    bodyTags: promptBodyControlTags(prompt),
    speedScale: Number(control.speedScale.toFixed(2)),
    forceScale: Number(control.forceScale.toFixed(2)),
    holdScale: Number(control.holdScale.toFixed(2)),
    travelScale: Number(control.travelScale.toFixed(2))
  };
}

function motionPromptControlExplain(summary: ReturnType<typeof motionPromptControlSummary>) {
  const parts = [
    `方向 ${summary.directionLabel}`,
    `速度 ${summary.speedLabel}`,
    `力度 ${summary.forceLabel}`,
    summary.timingTags.length ? `节奏 ${summary.timingTags.join('、')}` : '',
    summary.stageTags.length ? `阶段词 ${summary.stageTags.join('、')}` : '',
    summary.bodyTags.length ? `身体控制 ${summary.bodyTags.join('、')}` : ''
  ].filter(Boolean);
  return `提示词控制参数：${parts.join('；')}。`;
}

function semanticTimingExplain(prompt: string, speedLabel: string) {
  if (promptRequestsBurstTiming(prompt)) return '节奏识别：先短暂预备，再突然爆发。';
  if (promptRequestsSustainedTiming(prompt)) return '节奏识别：动作高峰会持续保持一段时间。';
  if (promptRequestsAccelerateTiming(prompt)) return '节奏识别：动作逐渐加速。';
  if (promptRequestsDecelerateTiming(prompt)) return '节奏识别：动作逐渐减速并收稳。';
  if (speedLabel === '快速') return '节奏识别：快速进入动作发力阶段。';
  if (speedLabel === '缓慢') return '节奏识别：缓慢平滑推进动作阶段。';
  return '节奏识别：常规线性动作节奏。';
}

function promptAllowsLargePerformance(prompt: string) {
  return matchesPrompt(prompt, /夸张|大幅度|飞跃|翻滚|空翻|浮空|离地|卡通|exaggerated|cartoon|large|flip|roll|airborne|fly/);
}

function semanticStage(id: string, label: string, timeRatio: number, poseHint: string, rootMotionHint: string, contactHint: string): MotionSemanticStage {
  return { id, label, timeRatio, poseHint, rootMotionHint, contactHint };
}

function motionStagesForAction(actionType: MotionSemanticActionType): MotionSemanticStage[] {
  if (actionType === 'push') return [
    semanticStage('brace', '预备', 0, '双脚站稳，双手靠近目标', '重心轻微前压', '双脚贴地，双手准备接触目标'),
    semanticStage('contact', '接触', 0.45, '双臂向前推，躯干前倾', '根节点小幅向前', '双手接触目标，双脚锁地'),
    semanticStage('hold', '保持', 1, '手臂保持推力，身体稳定', '重心维持低位', '手和脚保持接触')
  ];
  if (actionType === 'pull') return [
    semanticStage('reach', '伸手', 0, '手臂伸向目标', '重心靠近目标', '手准备接触'),
    semanticStage('pull', '回拉', 0.55, '手臂回收，身体后移', '重心向后转移', '手保持接触目标'),
    semanticStage('settle', '稳定', 1, '身体恢复稳定', '根节点停止移动', '脚部贴地')
  ];
  if (actionType === 'throw') return [
    semanticStage('windup', '蓄力', 0, '主手后摆，躯干轻微扭转', '重心压到后脚', '双脚贴地'),
    semanticStage('release', '出手', 0.62, '主手向前甩出，肩胸跟随', '重心向前转移', '投掷手释放目标'),
    semanticStage('follow', '收势', 1, '手臂自然回收，身体稳定', '根节点减速', '脚部保持支撑')
  ];
  if (actionType === 'run' || actionType === 'dash') return [
    semanticStage('drive', actionType === 'dash' ? '冲刺发力' : '起跑', 0, '身体前倾，手臂反向摆动', '根节点持续向前', '支撑脚贴地'),
    semanticStage('flight', '换步', 0.45, '左右腿交替，摆臂配合', '根节点平滑前移', '脚步交替接触地面'),
    semanticStage('land', '落步', 1, '前脚落地，身体稳定', '位移逐渐收稳', '落地脚锁地')
  ];
  if (actionType === 'walk') return [
    semanticStage('start', '起步', 0, '一侧腿向前，另一侧手臂前摆', '根节点小幅前移', '后脚贴地'),
    semanticStage('pass', '经过', 0.5, '双腿交替经过身体中线', '重心平滑过渡', '支撑脚贴地'),
    semanticStage('settle', '站稳', 1, '步伐收稳，手臂自然回摆', '根节点停止移动', '双脚稳定')
  ];
  if (actionType === 'punch') return [
    semanticStage('guard', '护架', 0, '双手护在胸前，重心稳定', '根节点轻微下沉', '双脚支撑'),
    semanticStage('strike', '出拳', 0.55, '主拳向前打出，肩部跟随', '重心轻微前压', '支撑脚贴地'),
    semanticStage('recover', '回收', 1, '拳头回到护架', '重心回正', '双脚稳定')
  ];
  if (actionType === 'block') return [
    semanticStage('raise_guard', '抬手防守', 0, '前臂抬起保护头胸', '重心降低', '双脚支撑'),
    semanticStage('absorb', '承受', 0.55, '手臂保持格挡，躯干微收', '重心后移一点', '脚部稳定'),
    semanticStage('hold', '保持', 1, '防守姿态保持', '根节点稳定', '双脚贴地')
  ];
  if (actionType === 'kick' || actionType === 'side_kick') return [
    semanticStage('chamber', actionType === 'side_kick' ? '侧向蓄腿' : '收腿蓄力', 0, '支撑脚站稳，踢腿收起', '重心压到支撑脚', '支撑脚贴地'),
    semanticStage('extend', actionType === 'side_kick' ? '侧向踢出' : '踢出', 0.56, '踢腿伸出，身体轻微反向平衡', '根节点保持稳定', '支撑脚锁地'),
    semanticStage('retract', '收腿', 1, '踢腿回收，身体回正', '重心回到中线', '双脚恢复支撑')
  ];
  if (actionType === 'jump') return [
    semanticStage('compress', '下压', 0, '膝盖弯曲，身体下沉', '根节点下沉', '双脚蓄力'),
    semanticStage('airborne', '腾空', 0.5, '身体离地，手臂配合上摆', '根节点向上', '允许短暂离地'),
    semanticStage('land', '落地', 1, '膝盖缓冲，身体稳定', '根节点回落', '双脚重新接触地面')
  ];
  if (actionType === 'crouch') return [
    semanticStage('drop', '下蹲', 0, '膝盖弯曲，重心下降', '根节点下沉', '脚部贴地'),
    semanticStage('hold', '低位保持', 0.6, '躯干稳定，腿部保持弯曲', '根节点保持低位', '双脚支撑'),
    semanticStage('settle', '稳定', 1, '低姿态稳定', '根节点稳定', '双脚贴地')
  ];
  if (actionType === 'crawl') return [
    semanticStage('lower', '伏低', 0, '身体贴近地面，手膝准备支撑', '根节点下沉', '手和膝接近地面'),
    semanticStage('crawl', '爬行', 0.5, '手脚交替前移', '根节点缓慢前移', '手脚交替接触地面'),
    semanticStage('settle', '停稳', 1, '身体保持低姿态', '根节点稳定', '手脚支撑')
  ];
  if (actionType === 'fall') return [
    semanticStage('lose_balance', '失衡', 0, '身体偏离重心', '根节点倾斜下落', '脚部失去稳定'),
    semanticStage('impact', '触地', 0.68, '身体接触地面并缓冲', '根节点降到地面附近', '身体或手脚触地'),
    semanticStage('settle', '倒地保持', 1, '倒地姿态稳定', '根节点停止', '身体保持接触地面')
  ];
  if (actionType === 'get_up') return [
    semanticStage('brace', '撑地', 0, '手臂或膝盖支撑身体', '根节点准备抬升', '手脚接触地面'),
    semanticStage('rise', '起身', 0.6, '躯干抬起，腿部发力', '根节点向上', '脚部逐渐承重'),
    semanticStage('stand', '站稳', 1, '身体回到站立', '根节点稳定', '双脚贴地')
  ];
  if (actionType === 'turn') return [
    semanticStage('prepare', '预备转身', 0, '身体准备旋转', '根节点保持原位', '双脚支撑'),
    semanticStage('rotate', '转身', 0.5, '骨盆和胸腔同步转向', '根节点旋转', '脚部小幅调整'),
    semanticStage('settle', '转身完成', 1, '身体面向新方向', '根节点停止旋转', '双脚稳定')
  ];
  if (actionType === 'reach') return [
    semanticStage('aim', '瞄准', 0, '眼睛和身体朝向目标', '根节点稳定', '脚部贴地'),
    semanticStage('reach', '伸手', 0.55, '手臂伸向目标', '重心微微前移', '手接近目标'),
    semanticStage('hold', '保持', 1, '手部保持目标方向', '根节点稳定', '手停在目标附近')
  ];
  return [
    semanticStage('start', '起始', 0, '保持起点姿势', '根节点稳定', '按起点接触关系保持'),
    semanticStage('middle', '过渡', 0.5, '身体平滑过渡到目标姿势', '根节点平滑移动', '保持合理接触'),
    semanticStage('end', '结束', 1, '到达终点姿势', '根节点稳定', '按终点接触关系保持')
  ];
}

function mergeSemanticStages(baseStages: MotionSemanticStage[], aiStages: MotionSemanticStage[]) {
  const merged: MotionSemanticStage[] = [...baseStages];
  aiStages.forEach((stage) => {
    const nearIndex = merged.findIndex((item) => Math.abs(item.timeRatio - stage.timeRatio) <= 0.08 || item.id === stage.id);
    if (nearIndex >= 0) {
      merged[nearIndex] = {
        ...merged[nearIndex],
        poseHint: `${merged[nearIndex].poseHint}；${stage.poseHint}`,
        rootMotionHint: `${merged[nearIndex].rootMotionHint}；${stage.rootMotionHint}`,
        contactHint: `${merged[nearIndex].contactHint}；${stage.contactHint}`
      };
      return;
    }
    merged.push(stage);
  });
  return merged
    .sort((a, b) => a.timeRatio - b.timeRatio)
    .slice(0, 10);
}

// SECTION: Rig metadata, joint limits, and joint-axis semantics.
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
  thumb: '大拇指',
  index: '食指',
  middle: '中指',
  ring: '无名指',
  pinky: '小指'
};

const TOE_BONE_NAMES: Record<ToeKey, string[]> = {
  leftBase: ['mixamorigLeftToeBase', 'mixamorigLeftToe'],
  rightBase: ['mixamorigRightToeBase', 'mixamorigRightToe'],
  leftTip: [],
  rightTip: []
};

const TOE_OPTIONS: ToeKey[] = ['leftBase', 'rightBase'];
const TOE_LABELS: Record<ToeKey, string> = {
  leftBase: '左脚趾',
  rightBase: '右脚趾',
  leftTip: '左脚趾尖',
  rightTip: '右脚趾尖'
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
  pelvis: '骨盆',
  chest: '胸腔',
  neck: '颈部',
  head: '头部',
  leftUpperArm: '左上臂',
  leftLowerArm: '左前臂',
  leftHand: '左手腕',
  rightUpperArm: '右上臂',
  rightLowerArm: '右前臂',
  rightHand: '右手腕',
  leftUpperLeg: '左大腿',
  leftLowerLeg: '左小腿',
  leftFoot: '左脚',
  rightUpperLeg: '右大腿',
  rightLowerLeg: '右小腿',
  rightFoot: '右脚'
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
    x: { positive: '向前弯曲', negative: '向后伸展', role: '控制该关节的前后俯仰' },
    y: { positive: '向右旋转', negative: '向左旋转', role: '控制该关节的左右朝向' },
    z: { positive: '向外侧摆动', negative: '向内侧收拢', role: '控制该关节的侧向摆动' }
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

// SECTION: Primitive math, pose, model, upload, and object factory helpers
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

function composePoseOffsets(...offsets: Array<Partial<Record<PoseJointKey, Partial<RigRotation>>> | undefined>) {
  const next: Partial<Record<PoseJointKey, Partial<RigRotation>>> = {};
  offsets.forEach((patch) => {
    if (!patch) return;
    for (const key of Object.keys(patch) as PoseJointKey[]) {
      const value = patch[key];
      if (!value) continue;
      const current = next[key] || {};
      next[key] = {
        x: (current.x || 0) + (value.x || 0),
        y: (current.y || 0) + (value.y || 0),
        z: (current.z || 0) + (value.z || 0)
      };
    }
  });
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
    if (/^Male Character\s+\d+$/i.test(trimmed)) return '男性角色 ' + number;
    if (/^Female Character\s+\d+$/i.test(trimmed)) return '女性角色 ' + number;
    if (/^Character\s+\d+$/i.test(trimmed)) return (meta?.gender === 'female' ? '女性角色' : '男性角色') + ' ' + number;
    if (/^Imported Character\s+\d+$/i.test(trimmed)) return '导入角色 ' + number;
  }
  if (kind === 'prop') {
    if (/^Prop\s+\d+$/i.test(trimmed)) return (PROP_LABELS_BY_SHAPE[meta?.propShape || 'box'] || '道具') + ' ' + number;
    if (/^Imported Prop\s+\d+$/i.test(trimmed)) return '导入道具 ' + number;
  }
  if (kind === 'camera') {
    if (/^Default Camera$/i.test(trimmed) || /^Camera\s+\d+$/i.test(trimmed)) return number === 1 ? '默认机位' : '机位 ' + number;
  }
  if (kind === 'light') {
    if (/^Ambient Light$/i.test(trimmed)) return '环境光 ' + number;
    if (/^Key Directional Light$/i.test(trimmed)) return '主方向光 ' + number;
    if (/^Light\s+\d+$/i.test(trimmed)) return (LIGHT_LABELS_BY_TYPE[meta?.lightType || 'point'] || '灯光') + ' ' + number;
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
    name: '默认机位',
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
  { id: 'standard', label: '标准镜头', defaultFov: 45, zoom: 1 },
  { id: 'wide', label: '广角镜头', defaultFov: 72, zoom: 0.92 },
  { id: 'telephoto', label: '长焦镜头', defaultFov: 24, zoom: 1.28 },
  { id: 'fisheye', label: '鱼眼镜头', defaultFov: 112, zoom: 0.82, defaultFisheyeStrength: 0.55 },
  { id: 'orthographic', label: '正交镜头', defaultFov: 45, zoom: 1.65, orthographic: true, defaultOrthographicScale: 4.5 },
  { id: 'macro', label: '微距镜头', defaultFov: 38, zoom: 1.35, defaultFocusDistance: 0.55 },
  { id: 'tilt_shift', label: '移轴镜头', defaultFov: 42, zoom: 1.1, defaultTiltShiftAmount: 0.22 },
  { id: 'panorama', label: '全景镜头', defaultFov: 95, zoom: 0.76 }
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
  { id: 'male', label: '男性角色' },
  { id: 'female', label: '女性角色' }
];
const PROP_ADD_OPTIONS: { id: PropShape; label: string; scale: Vec3; color: string }[] = [
  { id: 'box', label: '方体', scale: vec(0.7, 0.7, 0.7), color: '#f59e0b' },
  { id: 'sphere', label: '球体', scale: vec(0.65, 0.65, 0.65), color: '#38bdf8' },
  { id: 'cylinder', label: '圆柱', scale: vec(0.5, 0.9, 0.5), color: '#e5e7eb' }
];
const EXTRA_PROP_ADD_OPTIONS: { id: PropShape; label: string; scale: Vec3; color: string }[] = [
  { id: 'cone', label: '圆锥', scale: vec(0.62, 0.9, 0.62), color: '#fb7185' },
  { id: 'plane', label: '平面', scale: vec(1.2, 1, 0.8), color: '#94a3b8' },
  { id: 'torus', label: '圆环', scale: vec(0.8, 0.8, 0.8), color: '#a78bfa' }
];
const PROP_CREATION_OPTIONS = [...PROP_ADD_OPTIONS, ...EXTRA_PROP_ADD_OPTIONS];
const PROP_LABELS_BY_SHAPE = Object.fromEntries(PROP_CREATION_OPTIONS.map((item) => [item.id, item.label])) as Record<PropShape, string>;
const PROP_SORT_ORDER = Object.fromEntries(PROP_CREATION_OPTIONS.map((item, index) => [item.id, index])) as Record<PropShape, number>;

const LIGHT_ADD_OPTIONS: { id: LightType; label: string; position: Vec3; color: string; intensity: number }[] = [
  { id: 'ambient', label: '环境光', position: vec(0, 3, 0), color: '#dbeafe', intensity: 0.55 },
  { id: 'hemisphere', label: '半球光', position: vec(0, 4, 0), color: '#bfdbfe', intensity: 0.9 },
  { id: 'directional', label: '方向光', position: vec(4, 6, 3), color: '#fff7ed', intensity: 2.1 },
  { id: 'spot', label: '聚光灯', position: vec(2, 4, 2.4), color: '#fef3c7', intensity: 2.4 },
  { id: 'point', label: '点光', position: vec(2, 3, 2), color: '#ffffff', intensity: 1.2 },
  { id: 'rect', label: '面光', position: vec(0, 2.8, 3), color: '#f8fafc', intensity: 1.8 }
];
const LIGHT_LABELS_BY_TYPE = Object.fromEntries(LIGHT_ADD_OPTIONS.map((item) => [item.id, item.label])) as Record<LightType, string>;
const LIGHT_SORT_ORDER = Object.fromEntries(LIGHT_ADD_OPTIONS.map((item, index) => [item.id, index])) as Record<LightType, number>;

const CAMERA_TEMPLATE_OPTIONS: { id: CameraTemplateId; label: string; position: Vec3; targetPosition: Vec3; fov: number }[] = [
  { id: 'current', label: '默认机位', position: vec(4, 2.1, 5), targetPosition: vec(0, 1, 0), fov: 45 },
  { id: 'front_medium', label: '正面中景', position: vec(0, 1.65, 5.2), targetPosition: vec(0, 1.2, 0), fov: 42 },
  { id: 'front_wait', label: '正面待机', position: vec(0.7, 1.55, 4.4), targetPosition: vec(0, 1.1, 0), fov: 36 },
  { id: 'front_full', label: '正面全身', position: vec(0, 1.85, 7.2), targetPosition: vec(0, 1, 0), fov: 52 },
  { id: 'side_follow', label: '侧面跟拍', position: vec(5.2, 1.45, 0.2), targetPosition: vec(0, 1.15, 0), fov: 42 },
  { id: 'side_close', label: '侧面近景', position: vec(3.2, 1.45, 0.2), targetPosition: vec(0, 1.2, 0), fov: 30 },
  { id: 'back_medium', label: '背面中景', position: vec(0, 1.6, -5.2), targetPosition: vec(0, 1.15, 0), fov: 42 },
  { id: 'overhead_full', label: '俯拍全身', position: vec(0, 6.2, 3.2), targetPosition: vec(0, 0.8, 0), fov: 55 },
  { id: 'dutch_45', label: '斜角四十五度', position: vec(3.5, 4.1, 3.5), targetPosition: vec(0, 0.9, 0), fov: 42 },
  { id: 'low_angle_close', label: '低机位近景', position: vec(0, 0.45, 3.2), targetPosition: vec(0, 1.45, 0), fov: 34 },
  { id: 'low_angle_wide', label: '低机位广角', position: vec(0, 0.55, 3.8), targetPosition: vec(0, 1.25, 0), fov: 68 },
  { id: 'over_shoulder', label: '左过肩', position: vec(-1.2, 1.55, 2.4), targetPosition: vec(0.55, 1.25, 0), fov: 34 },
  { id: 'over_shoulder_right', label: '右过肩', position: vec(1.2, 1.55, 2.4), targetPosition: vec(-0.55, 1.25, 0), fov: 34 },
  { id: 'bird_eye', label: '顶视机位', position: vec(0, 8, 0.15), targetPosition: vec(0, 0.7, 0), fov: 48 },
  { id: 'dutch_angle', label: '倾斜机位', position: vec(3.1, 1.8, 4.4), targetPosition: vec(0, 1.1, 0), fov: 38 }
];
const CAMERA_MOTION_OPTIONS: { id: CameraMotionType; label: string }[] = [
  { id: 'none', label: '无' },
  { id: 'dolly_in', label: '推近' },
  { id: 'dolly_out', label: '拉远' },
  { id: 'truck_left', label: '左横移' },
  { id: 'truck_right', label: '右横移' },
  { id: 'orbit', label: '环绕' },
  { id: 'follow_character', label: '跟随角色' },
  { id: 'low_tilt_up', label: '低机位上摇' },
  { id: 'top_tilt_down', label: '俯拍下压' },
  { id: 'handheld', label: '手持轻晃' },
  { id: 'close_follow', label: '特写跟随' }
];
const CAMERA_MOTION_LABELS = Object.fromEntries(CAMERA_MOTION_OPTIONS.map((item) => [item.id, item.label])) as Record<CameraMotionType, string>;
const MAX_MIDDLE_KEYFRAMES = 10;

function defaultCameraMotion(): CameraMotionConfig {
  return {
    enabled: false,
    type: 'none',
    intensity: 0.6,
    startTimeSec: 0,
    endTimeSec: 1.2,
    distance: 1.2,
    heightOffset: 0,
    orbitAngleDeg: 35,
    keepCharacterInFrame: true
  };
}

function defaultConstraints(): PoseTransitionConstraints {
  return {
    headLookAt: { enabled: false, targetMode: 'camera' },
    handTarget: { enabled: false, hand: 'right', targetMode: 'object' },
    footLock: { enabled: true, left: true, right: true },
    jointLimitsEnabled: true
  };
}

// SECTION: Scene normalization, compatibility migration, and history state
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
    groundEnabled: false,
    motionPathEnabled: false,
    characterLabelsEnabled: true,
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

function propLocalGroundHalfHeight(prop: Pick<PropObject, 'shape' | 'scale' | 'model'>) {
  if (prop.shape === 'model') return 0;
  if (prop.shape === 'plane') return Math.abs(prop.scale.y || 1) * 0.02;
  if (prop.shape === 'torus') return Math.abs(prop.scale.y || 1) * 0.5;
  return Math.abs(prop.scale.y || 1) * 0.5;
}

function clampVecToGround(position: Vec3, minY: number) {
  if (position.y >= minY) return position;
  return { ...position, y: minY };
}

function clampPropToGround<T extends PropObject>(prop: T): T {
  const minY = propLocalGroundHalfHeight(prop);
  const position = clampVecToGround(prop.position, minY);
  return position === prop.position ? prop : { ...prop, position };
}

function clampTransformToGround(kind: ObjectKind, transform: PoseTransform, source?: CharacterObject | PropObject): PoseTransform {
  if (kind !== 'prop') return transform;
  const minY = propLocalGroundHalfHeight({ shape: (source as PropObject | undefined)?.shape || 'box', scale: transform.scale, model: (source as PropObject | undefined)?.model });
  const position = clampVecToGround(transform.position, minY);
  return position === transform.position ? transform : { ...transform, position };
}

function snapNumberToStep(value: number, step: number) {
  if (!Number.isFinite(value) || step <= 0) return value;
  return Number((Math.round(value / step) * step).toFixed(4));
}

function snapVec3ToStep(value: Vec3, step: number, axes: Array<keyof Vec3> = ['x', 'y', 'z']): Vec3 {
  const next = { ...value };
  axes.forEach((axis) => {
    next[axis] = snapNumberToStep(next[axis], step);
  });
  return next;
}

function changedVec3Axes(previous: Vec3 | undefined, next: Partial<Vec3> | undefined): Array<keyof Vec3> {
  if (!next) return [];
  return (['x', 'y', 'z'] as Array<keyof Vec3>).filter((axis) => (
    next[axis] !== undefined
    && (!previous || Math.abs(Number(next[axis]) - Number(previous[axis])) > 0.0001)
  ));
}

function gridSnapPatchForChangedAxes(kind: ObjectKind, previous: PoseTransform, patch: any) {
  return {
    position: patch?.position ? changedVec3Axes(previous.position, patch.position).reduce((acc, axis) => ({ ...acc, [axis]: patch.position[axis] }), {} as Partial<Vec3>) : undefined,
    rotation: patch?.rotation ? changedVec3Axes(previous.rotation, patch.rotation).reduce((acc, axis) => ({ ...acc, [axis]: patch.rotation[axis] }), {} as Partial<Vec3>) : undefined,
    scale: patch?.scale && kind !== 'camera' && kind !== 'light' ? changedVec3Axes(previous.scale, patch.scale).reduce((acc, axis) => ({ ...acc, [axis]: patch.scale[axis] }), {} as Partial<Vec3>) : undefined
  };
}

function applyGridSnapToTransform(kind: ObjectKind, transform: PoseTransform, patch: any): PoseTransform {
  const next = clonePoseTransform(transform);
  if (patch?.position) {
    const positionAxes = (Object.keys(patch.position) as Array<keyof Vec3>).filter((axis) => axis === 'x' || axis === 'y' || axis === 'z');
    next.position = snapVec3ToStep(next.position, GRID_SNAP_STEP, positionAxes.length ? positionAxes : ['x', 'y', 'z']);
  }
  if (patch?.rotation) {
    const rotationAxes = (Object.keys(patch.rotation) as Array<keyof Vec3>).filter((axis) => axis === 'x' || axis === 'y' || axis === 'z');
    next.rotation = snapVec3ToStep(next.rotation, GRID_ROTATION_SNAP_DEG, rotationAxes.length ? rotationAxes : ['x', 'y', 'z']);
  }
  if (patch?.scale && kind !== 'camera' && kind !== 'light') {
    const scaleAxes = (Object.keys(patch.scale) as Array<keyof Vec3>).filter((axis) => axis === 'x' || axis === 'y' || axis === 'z');
    next.scale = snapVec3ToStep(next.scale, GRID_SCALE_SNAP_STEP, scaleAxes.length ? scaleAxes : ['x', 'y', 'z']);
  }
  return next;
}

function applyGroundCollision(scene: Scene3DState): Scene3DState {
  if (!scene.groundEnabled) return scene;
  return {
    ...scene,
    objects: {
      ...scene.objects,
      props: scene.objects.props.map(clampPropToGround)
    }
  };
}

function normalizeConstraints(value: any): PoseTransitionConstraints {
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

function normalizeCameraMotion(value: any, durationSec = 1.2, characterId?: string): CameraMotionConfig {
  const fallback = defaultCameraMotion();
  const type = CAMERA_MOTION_OPTIONS.some((item) => item.id === value?.type) ? value.type as CameraMotionType : fallback.type;
  const startTimeSec = clampNumber(Number.isFinite(Number(value?.startTimeSec)) ? Number(value.startTimeSec) : 0, 0, durationSec);
  const endTimeSec = clampNumber(Number.isFinite(Number(value?.endTimeSec)) ? Number(value.endTimeSec) : durationSec, startTimeSec, durationSec);
  return {
    enabled: Boolean(value?.enabled) && type !== 'none',
    type,
    targetCharacterId: typeof value?.targetCharacterId === 'string' ? value.targetCharacterId : characterId,
    intensity: clampNumber(Number.isFinite(Number(value?.intensity)) ? Number(value.intensity) : fallback.intensity, 0, 1),
    startTimeSec,
    endTimeSec,
    distance: clampNumber(Number.isFinite(Number(value?.distance)) ? Number(value.distance) : fallback.distance, 0, 8),
    heightOffset: clampNumber(Number.isFinite(Number(value?.heightOffset)) ? Number(value.heightOffset) : fallback.heightOffset, -4, 4),
    orbitAngleDeg: clampNumber(Number.isFinite(Number(value?.orbitAngleDeg)) ? Number(value.orbitAngleDeg) : fallback.orbitAngleDeg, -360, 360),
    keepCharacterInFrame: value?.keepCharacterInFrame !== false
  };
}

function cameraMotionFromPrompt(prompt: string, durationSec: number, characterId?: string, current?: CameraMotionConfig): { motion: CameraMotionConfig; matched: boolean } {
  const normalized = prompt.trim().toLowerCase();
  let type: CameraMotionType | undefined;
  if (/环绕|围绕|绕着|旋转运镜|orbit|around/.test(normalized)) type = 'orbit';
  else if (/推近|推进|靠近镜头|dolly in|push in|zoom in/.test(normalized)) type = 'dolly_in';
  else if (/拉远|后拉|dolly out|pull back|zoom out/.test(normalized)) type = 'dolly_out';
  else if (/左横移|向左横移|truck left/.test(normalized)) type = 'truck_left';
  else if (/右横移|向右横移|truck right/.test(normalized)) type = 'truck_right';
  else if (/跟随角色|跟拍|follow/.test(normalized)) type = 'follow_character';
  else if (/低机位|上摇|tilt up/.test(normalized)) type = 'low_tilt_up';
  else if (/俯拍|下压|tilt down|top/.test(normalized)) type = 'top_tilt_down';
  else if (/手持|轻晃|handheld|shake/.test(normalized)) type = 'handheld';
  else if (/特写|近景跟随|close follow|close-up/.test(normalized)) type = 'close_follow';
  const base = normalizeCameraMotion(current, durationSec, characterId);
  if (!type) return { motion: base, matched: false };
  const angleMatch = normalized.match(/(?:环绕|围绕|绕着|旋转运镜|orbit|around)[^\d-]*(-?\d+(?:\.\d+)?)\s*(?:度|deg)?/);
  const promptOrbitAngle = angleMatch ? Math.abs(Number(angleMatch[1])) : undefined;
  return {
    matched: true,
    motion: normalizeCameraMotion({
      ...base,
      enabled: true,
      type,
      endTimeSec: durationSec,
      orbitAngleDeg: type === 'orbit' ? clampNumber(Number.isFinite(promptOrbitAngle) ? promptOrbitAngle as number : Math.max(Math.abs(base.orbitAngleDeg), 70), -360, 360) : base.orbitAngleDeg,
      intensity: Math.max(base.intensity, 0.7)
    }, durationSec, characterId)
  };
}

function cameraMotionForTransition(transition: PoseTransition) {
  const promptMotion = cameraMotionFromPrompt(transition.actionPrompt, transition.durationSec, transition.characterId, transition.cameraMotion);
  return promptMotion.matched ? promptMotion.motion : normalizeCameraMotion(transition.cameraMotion, transition.durationSec, transition.characterId);
}

function cameraMotionForAiIntent(transition: PoseTransition, intent: MotionIntent) {
  const promptMotion = cameraMotionFromPrompt(transition.actionPrompt, transition.durationSec, transition.characterId, transition.cameraMotion);
  if (!promptMotion.matched || !intent.cameraMotionHint?.enabled) return cameraMotionForTransition(transition);
  return normalizeCameraMotion(intent.cameraMotionHint, transition.durationSec, transition.characterId);
}

function normalizeTransitionKeyframe(value: any, durationSec: number): TransitionKeyframe | null {
  if (!value || typeof value !== 'object') return null;
  return {
    id: typeof value.id === 'string' ? value.id : createId('keyframe'),
    label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : '中间帧',
    timeSec: clampNumber(Number.isFinite(Number(value.timeSec)) ? Number(value.timeSec) : durationSec / 2, 0, durationSec),
    transform: normalizeTransform(value.transform),
    pose: normalizePose(value.pose),
    bonePose: normalizeBonePose(value.bonePose),
    fingerPose: normalizeFingerPose(value.fingerPose),
    toePose: normalizeToePose(value.toePose),
    posePresetId: typeof value.posePresetId === 'string' ? normalizePosePresetId(value.posePresetId) : undefined,
    libTvJointAngles: normalizeLibTvJointAngles(value.libTvJointAngles),
    note: typeof value.note === 'string' ? value.note : undefined
  };
}

function normalizeTransitionKeyframes(value: any, durationSec: number): TransitionKeyframe[] {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map((item) => normalizeTransitionKeyframe(item, durationSec))
    .filter((item): item is TransitionKeyframe => Boolean(item))
    .sort((a, b) => a.timeSec - b.timeSec)
    .slice(0, MAX_MIDDLE_KEYFRAMES);
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

function normalizeCameraMotionSample(value: any): CameraMotionSample | null {
  if (!value || typeof value !== 'object') return null;
  return {
    timeSec: Number.isFinite(Number(value.timeSec)) ? Number(value.timeSec) : 0,
    position: normalizeVec(value.position, vec()),
    targetPosition: normalizeVec(value.targetPosition, vec()),
    fov: Number.isFinite(Number(value.fov)) ? Number(value.fov) : undefined
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
    name: typeof value.name === 'string' ? value.name : '动态片段',
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
      : [],
    cameraSamples: Array.isArray(value.cameraSamples)
      ? value.cameraSamples.map(normalizeCameraMotionSample).filter(Boolean) as CameraMotionSample[]
      : undefined
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
    semanticPlan: normalizeMotionSemanticPlan(value?.semanticPlan),
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
  const allowed: UniversalMotionFamily[] = ['locomotion', 'turn', 'roll', 'fall', 'get_up', 'dodge', 'crawl', 'kneel', 'stumble', 'reach', 'carry', 'combat'];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UniversalMotionFamily => allowed.includes(item)).slice(0, 12);
}

function normalizeSemanticActionFamily(value: any): MotionSemanticActionFamily {
  const allowed: MotionSemanticActionFamily[] = ['locomotion', 'combat', 'push_pull', 'throw', 'jump', 'fall', 'crawl', 'posture', 'turn', 'reach', 'unknown'];
  return allowed.includes(value) ? value : 'unknown';
}

function normalizeSemanticActionType(value: any): MotionSemanticActionType {
  const allowed: MotionSemanticActionType[] = ['walk', 'run', 'dash', 'push', 'pull', 'throw', 'punch', 'block', 'kick', 'side_kick', 'jump', 'crouch', 'crawl', 'fall', 'get_up', 'turn', 'reach', 'idle', 'unknown'];
  return allowed.includes(value) ? value : 'unknown';
}

function normalizeMotionSemanticStage(value: any, index: number): MotionSemanticStage {
  return {
    id: typeof value?.id === 'string' ? value.id : `stage_${index}`,
    label: typeof value?.label === 'string' && value.label.trim() ? value.label.trim() : `阶段 ${index + 1}`,
    timeRatio: clampNumber(Number.isFinite(Number(value?.timeRatio)) ? Number(value.timeRatio) : index / 3, 0, 1),
    poseHint: typeof value?.poseHint === 'string' ? value.poseHint : '',
    rootMotionHint: typeof value?.rootMotionHint === 'string' ? value.rootMotionHint : '',
    contactHint: typeof value?.contactHint === 'string' ? value.contactHint : ''
  };
}

function normalizeMotionActionSequenceStep(value: any, index: number): MotionActionSequenceStep {
  const startRatio = clampNumber(Number.isFinite(Number(value?.startRatio)) ? Number(value.startRatio) : index / 3, 0, 1);
  const endRatio = clampNumber(Number.isFinite(Number(value?.endRatio)) ? Number(value.endRatio) : Math.min(1, startRatio + 0.34), startRatio, 1);
  const actionType = normalizeSemanticActionType(value?.actionType);
  return {
    id: typeof value?.id === 'string' ? value.id : `sequence_${index}`,
    actionType,
    label: typeof value?.label === 'string' && value.label.trim() ? value.label.trim() : MOTION_SEMANTIC_TYPE_LABELS[actionType],
    startRatio,
    endRatio,
    sourceText: typeof value?.sourceText === 'string' ? value.sourceText : ''
  };
}

function normalizeMotionQualityExpectation(value: any, index: number): MotionQualityExpectation | null {
  const metric = ['endpoint', 'speed', 'rotation', 'foot_lock', 'contact', 'pose', 'sequence'].includes(value?.metric)
    ? value.metric as MotionQualityIssue['metric']
    : null;
  if (!metric) return null;
  return {
    id: typeof value?.id === 'string' && value.id.trim() ? value.id.trim() : `expectation_${index}`,
    metric,
    label: typeof value?.label === 'string' && value.label.trim() ? value.label.trim() : `质量期望 ${index + 1}`,
    description: typeof value?.description === 'string' ? value.description : '',
    minValue: Number.isFinite(Number(value?.minValue)) ? Number(value.minValue) : undefined,
    maxValue: Number.isFinite(Number(value?.maxValue)) ? Number(value.maxValue) : undefined,
    required: value?.required !== false
  };
}

function normalizeMotionActionChain(value: any): MotionActionChain | null {
  const id = value?.id === 'approach_contact' || value?.id === 'turn_throw' || value?.id === 'low_recovery_attack'
    ? value.id as MotionActionChain['id']
    : null;
  if (!id) return null;
  const steps = Array.isArray(value.steps)
    ? value.steps.map(normalizeSemanticActionType).filter((type: MotionSemanticActionType) => type !== 'unknown' && type !== 'idle').slice(0, 6)
    : [];
  return {
    id,
    label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : id,
    steps,
    description: typeof value.description === 'string' ? value.description : '',
    qualityExpectationIds: Array.isArray(value.qualityExpectationIds)
      ? value.qualityExpectationIds.map((item: any) => String(item)).filter(Boolean).slice(0, 8)
      : []
  };
}

function normalizeMotionSemanticPlan(value: any): MotionSemanticPlan | undefined {
  if (!value || typeof value !== 'object' || value.version !== 1) return undefined;
  const cameraType = CAMERA_MOTION_OPTIONS.some((item) => item.id === value?.cameraIntent?.type) ? value.cameraIntent.type as CameraMotionType : 'none';
  return {
    version: 1,
    source: value.source === 'ai' || value.source === 'merged' ? value.source : 'local',
    promptHash: typeof value.promptHash === 'string' ? value.promptHash : '',
    actionFamily: normalizeSemanticActionFamily(value.actionFamily),
    actionType: normalizeSemanticActionType(value.actionType),
    directionLabel: typeof value.directionLabel === 'string' ? value.directionLabel : '未指定',
    speedLabel: typeof value.speedLabel === 'string' ? value.speedLabel : '常规',
    forceLabel: typeof value.forceLabel === 'string' ? value.forceLabel : '常规',
    bodyFocus: Array.isArray(value.bodyFocus) ? value.bodyFocus.map((item: any) => String(item)).filter(Boolean).slice(0, 10) : [],
    rootMotion: Array.isArray(value.rootMotion) ? value.rootMotion.map((item: any) => String(item)).filter(Boolean).slice(0, 10) : [],
    poseStages: Array.isArray(value.poseStages) ? value.poseStages.map(normalizeMotionSemanticStage).slice(0, 10) : [],
    actionSequence: Array.isArray(value.actionSequence) ? value.actionSequence.map(normalizeMotionActionSequenceStep).filter((item: MotionActionSequenceStep) => item.actionType !== 'unknown').slice(0, 6) : undefined,
    actionChains: Array.isArray(value.actionChains) ? value.actionChains.map(normalizeMotionActionChain).filter(Boolean).slice(0, 4) as MotionActionChain[] : undefined,
    contacts: Array.isArray(value.contacts)
      ? value.contacts.map((item: any) => {
          const contact = normalizeMotionContacts([item?.contact])[0] || 'feet';
          return {
            label: typeof item?.label === 'string' ? item.label : MOTION_CONTACT_LABELS[contact],
            contact,
            required: item?.required !== false
          };
        }).slice(0, 12)
      : [],
    qualityExpectations: Array.isArray(value.qualityExpectations)
      ? value.qualityExpectations.map(normalizeMotionQualityExpectation).filter(Boolean).slice(0, 16) as MotionQualityExpectation[]
      : undefined,
    actionSkill: value.actionSkill && typeof value.actionSkill === 'object'
      ? {
          label: typeof value.actionSkill.label === 'string' ? value.actionSkill.label : MOTION_SEMANTIC_TYPE_LABELS[normalizeSemanticActionType(value.actionType)],
          compileMode: value.actionSkill.compileMode === 'universal_assist' ? 'universal_assist' : 'semantic_only',
          grounded: value.actionSkill.grounded !== false,
          allowAirborne: value.actionSkill.allowAirborne === true,
          constraints: Array.isArray(value.actionSkill.constraints) ? value.actionSkill.constraints.map((item: any) => String(item)).filter(Boolean).slice(0, 8) : []
        }
      : undefined,
    cameraIntent: value.cameraIntent && cameraType !== 'none'
      ? {
          label: typeof value.cameraIntent.label === 'string' ? value.cameraIntent.label : CAMERA_MOTION_LABELS[cameraType],
          type: cameraType,
          priority: value.cameraIntent.priority === 'manual' ? 'manual' : 'prompt',
          description: typeof value.cameraIntent.description === 'string' ? value.cameraIntent.description : ''
        }
      : undefined,
    targetObjectId: typeof value.targetObjectId === 'string' ? value.targetObjectId : undefined,
    targetObjectName: typeof value.targetObjectName === 'string' ? value.targetObjectName : undefined,
    confidence: Number.isFinite(Number(value.confidence)) ? clampNumber(Number(value.confidence), 0, 1) : 0,
    explain: Array.isArray(value.explain) ? value.explain.map((item: any) => String(item)).filter(Boolean).slice(0, 12) : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.map((item: any) => String(item)).filter(Boolean).slice(0, 12) : []
  };
}

function normalizeMotionKeyframeHints(value: any): MotionKeyframeHint[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): MotionKeyframeHint | null => {
    if (!item || typeof item !== 'object') return null;
    const timeRatio = clampNumber(Number.isFinite(Number(item.timeRatio)) ? Number(item.timeRatio) : 0.5, 0, 1);
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : '关键姿势';
    return {
      timeRatio,
      label,
      posePresetId: typeof item.posePresetId === 'string' ? normalizePosePresetId(item.posePresetId) : undefined,
      note: typeof item.note === 'string' ? item.note : undefined
    };
  }).filter((item): item is MotionKeyframeHint => Boolean(item)).slice(0, MAX_MIDDLE_KEYFRAMES);
}
function normalizeMotionIntent(value: any, durationFallback = 1.2): MotionIntent | undefined {
  if (!value || typeof value !== 'object' || value.version !== 1) return undefined;
  const durationSec = Number.isFinite(Number(value.durationSec)) ? Math.max(0.2, Number(value.durationSec)) : durationFallback;
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
    actionFamily: value.actionFamily === undefined ? undefined : normalizeSemanticActionFamily(value.actionFamily),
    actionType: value.actionType === undefined ? undefined : normalizeSemanticActionType(value.actionType),
    motionFamilies: normalizeMotionFamilies(value.motionFamilies),
    keyframeHints: normalizeMotionKeyframeHints(value.keyframeHints),
    contactHints: Array.isArray(value.contactHints) ? value.contactHints.map((item: any) => ({
      timeSec: Number.isFinite(Number(item?.timeSec)) ? Number(item.timeSec) : undefined,
      contact: normalizeMotionContacts([item?.contact])[0],
      note: typeof item?.note === 'string' ? item.note : undefined
    })).filter((item: any) => Boolean(item.contact)).slice(0, 12) : [],
    cameraMotionHint: normalizeCameraMotion(value.cameraMotionHint, durationSec),
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
        metric: ['endpoint', 'speed', 'rotation', 'foot_lock', 'contact', 'pose', 'sequence'].includes(issue?.metric) ? issue.metric : 'pose',
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
      contactCount: Number.isFinite(Number(metrics.contactCount)) ? Number(metrics.contactCount) : 0,
      motionSampleRate: Number.isFinite(Number(metrics.motionSampleRate)) ? Number(metrics.motionSampleRate) : undefined,
      locomotionFootPlantDrift: Number.isFinite(Number(metrics.locomotionFootPlantDrift)) ? Number(metrics.locomotionFootPlantDrift) : undefined,
      locomotionRootStepJitter: Number.isFinite(Number(metrics.locomotionRootStepJitter)) ? Number(metrics.locomotionRootStepJitter) : undefined,
      locomotionFootContactCount: Number.isFinite(Number(metrics.locomotionFootContactCount)) ? Number(metrics.locomotionFootContactCount) : undefined,
      locomotionFootPhaseMismatchCount: Number.isFinite(Number(metrics.locomotionFootPhaseMismatchCount)) ? Number(metrics.locomotionFootPhaseMismatchCount) : undefined,
      locomotionRootBacktrackCount: Number.isFinite(Number(metrics.locomotionRootBacktrackCount)) ? Number(metrics.locomotionRootBacktrackCount) : undefined,
      locomotionRootTravelDistance: Number.isFinite(Number(metrics.locomotionRootTravelDistance)) ? Number(metrics.locomotionRootTravelDistance) : undefined,
      locomotionExpectedTravelDistance: Number.isFinite(Number(metrics.locomotionExpectedTravelDistance)) ? Number(metrics.locomotionExpectedTravelDistance) : undefined,
      locomotionPaceCoverageRatio: Number.isFinite(Number(metrics.locomotionPaceCoverageRatio)) ? Number(metrics.locomotionPaceCoverageRatio) : undefined,
      locomotionSupportSwitchCount: Number.isFinite(Number(metrics.locomotionSupportSwitchCount)) ? Number(metrics.locomotionSupportSwitchCount) : undefined,
      locomotionSupportCoverageRatio: Number.isFinite(Number(metrics.locomotionSupportCoverageRatio)) ? Number(metrics.locomotionSupportCoverageRatio) : undefined,
      locomotionArmSwingSeparation: Number.isFinite(Number(metrics.locomotionArmSwingSeparation)) ? Number(metrics.locomotionArmSwingSeparation) : undefined,
      locomotionArmLegSyncScore: Number.isFinite(Number(metrics.locomotionArmLegSyncScore)) ? Number(metrics.locomotionArmLegSyncScore) : undefined,
      locomotionLegSeparation: Number.isFinite(Number(metrics.locomotionLegSeparation)) ? Number(metrics.locomotionLegSeparation) : undefined,
      locomotionLegSignChanges: Number.isFinite(Number(metrics.locomotionLegSignChanges)) ? Number(metrics.locomotionLegSignChanges) : undefined,
      semanticTimingPeakRatio: Number.isFinite(Number(metrics.semanticTimingPeakRatio)) ? Number(metrics.semanticTimingPeakRatio) : undefined,
      semanticTimingSpeedContrast: Number.isFinite(Number(metrics.semanticTimingSpeedContrast)) ? Number(metrics.semanticTimingSpeedContrast) : undefined,
      semanticHandReachDistance: Number.isFinite(Number(metrics.semanticHandReachDistance)) ? Number(metrics.semanticHandReachDistance) : undefined,
      semanticHandContactSuccessRatio: Number.isFinite(Number(metrics.semanticHandContactSuccessRatio)) ? Number(metrics.semanticHandContactSuccessRatio) : undefined,
      semanticTargetApproachDistance: Number.isFinite(Number(metrics.semanticTargetApproachDistance)) ? Number(metrics.semanticTargetApproachDistance) : undefined,
      semanticContactBodyDrive: Number.isFinite(Number(metrics.semanticContactBodyDrive)) ? Number(metrics.semanticContactBodyDrive) : undefined,
      semanticContactFootStability: Number.isFinite(Number(metrics.semanticContactFootStability)) ? Number(metrics.semanticContactFootStability) : undefined,
      semanticContactWindowCoverage: Number.isFinite(Number(metrics.semanticContactWindowCoverage)) ? Number(metrics.semanticContactWindowCoverage) : undefined,
      semanticPropMotionDistance: Number.isFinite(Number(metrics.semanticPropMotionDistance)) ? Number(metrics.semanticPropMotionDistance) : undefined,
      semanticPropDirectionAlignment: Number.isFinite(Number(metrics.semanticPropDirectionAlignment)) ? Number(metrics.semanticPropDirectionAlignment) : undefined,
      semanticThrowReleaseDistance: Number.isFinite(Number(metrics.semanticThrowReleaseDistance)) ? Number(metrics.semanticThrowReleaseDistance) : undefined,
      semanticPunchExtension: Number.isFinite(Number(metrics.semanticPunchExtension)) ? Number(metrics.semanticPunchExtension) : undefined,
      semanticPunchRecoveryRatio: Number.isFinite(Number(metrics.semanticPunchRecoveryRatio)) ? Number(metrics.semanticPunchRecoveryRatio) : undefined,
      sequenceBoundaryMaxPoseDelta: Number.isFinite(Number(metrics.sequenceBoundaryMaxPoseDelta)) ? Number(metrics.sequenceBoundaryMaxPoseDelta) : undefined,
      sequenceBoundaryMaxRootDelta: Number.isFinite(Number(metrics.sequenceBoundaryMaxRootDelta)) ? Number(metrics.sequenceBoundaryMaxRootDelta) : undefined,
      sequenceBoundaryMaxRotationDelta: Number.isFinite(Number(metrics.sequenceBoundaryMaxRotationDelta)) ? Number(metrics.sequenceBoundaryMaxRotationDelta) : undefined,
      sequenceBoundaryMaxVelocityRatio: Number.isFinite(Number(metrics.sequenceBoundaryMaxVelocityRatio)) ? Number(metrics.sequenceBoundaryMaxVelocityRatio) : undefined,
      sequenceBoundarySmoothnessRatio: Number.isFinite(Number(metrics.sequenceBoundarySmoothnessRatio)) ? Number(metrics.sequenceBoundarySmoothnessRatio) : undefined,
      motionExpectationCount: Number.isFinite(Number(metrics.motionExpectationCount)) ? Number(metrics.motionExpectationCount) : undefined,
      motionExpectationFailedCount: Number.isFinite(Number(metrics.motionExpectationFailedCount)) ? Number(metrics.motionExpectationFailedCount) : undefined,
      motionExpectationPassRatio: Number.isFinite(Number(metrics.motionExpectationPassRatio)) ? Number(metrics.motionExpectationPassRatio) : undefined
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
    curve: CURVE_OPTIONS.includes(value.curve) ? value.curve : 'linear',
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
    keyframes: normalizeTransitionKeyframes(value.keyframes, durationSec),
    cameraMotion: normalizeCameraMotion(value.cameraMotion, durationSec, value.characterId),
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
    label: typeof value.label === 'string' && value.label.trim() ? value.label : '编辑场景',
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
        focusObjectId: typeof camera.focusObjectId === 'string' ? camera.focusObjectId : undefined,
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
    groundEnabled: value.groundEnabled === true,
    motionPathEnabled: value.motionPathEnabled === true,
    characterLabelsEnabled: value.characterLabelsEnabled !== false,
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
  const focusableObjectIds = new Set([
    ...scene.objects.characters.map((item) => item.id),
    ...scene.objects.props.map((item) => item.id)
  ]);
  scene.objects.cameras = scene.objects.cameras.map((camera) => (
    camera.focusObjectId && !focusableObjectIds.has(camera.focusObjectId)
      ? { ...camera, focusObjectId: undefined }
      : camera
  ));
  const groundedScene = applyGroundCollision(scene);
  groundedScene.undoStack = normalizeHistoryStack(value.undoStack, groundedScene);
  groundedScene.redoStack = normalizeHistoryStack(value.redoStack, groundedScene);
  return groundedScene;
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
  if ('focusObjectId' in patch) return `Adjust ${name} focus object`;
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
  const mergeableKeys = ['position', 'rotation', 'scale', 'targetPosition', 'focusObjectId', 'fov', 'fisheyeStrength', 'focusDistance', 'tiltShiftAmount', 'orthographicScale', 'rigPose', 'fingerPose', 'toePose', 'intensity', 'color'];
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

function displayDynamicName(name: string) {
  return name.replace(/补间/g, '动态');
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
  const cameras = scene.objects.cameras.map((camera) => (
    camera.focusObjectId === deletingId ? { ...camera, focusObjectId: undefined } : camera
  ));
  return normalizeScene({
    ...scene,
    objects: {
      ...scene.objects,
      cameras
    },
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
    'put_down',
    'combat_strike',
    'combat_block',
    'kick'
  ].includes(value);
}

// SECTION: Transition keyframes and interpolation helpers
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

function transitionKeyframeFromEndpoint(transition: PoseTransition, mode: 'start' | 'end', durationSec: number): TransitionKeyframe {
  const isStart = mode === 'start';
  return {
    id: `${transition.id}-${mode}`,
    label: isStart ? '起点' : '终点',
    timeSec: isStart ? 0 : durationSec,
    transform: normalizeTransform(isStart ? transition.startTransform : transition.endTransform),
    pose: clonePose(isStart ? transition.startPose : transition.endPose),
    bonePose: cloneBonePose(isStart ? transition.startBonePose : transition.endBonePose),
    fingerPose: cloneFingerPose(isStart ? transition.startFingerPose : transition.endFingerPose),
    toePose: cloneToePose(isStart ? transition.startToePose : transition.endToePose),
    posePresetId: isStart ? transition.startPosePresetId : transition.endPosePresetId,
    libTvJointAngles: cloneLibTvJointAngles(isStart ? transition.startLibTvJointAngles : transition.endLibTvJointAngles)
  };
}

function transitionKeyframeTrack(transition: PoseTransition, durationSec: number): TransitionKeyframe[] {
  const middle = normalizeTransitionKeyframes(transition.keyframes, durationSec)
    .filter((item) => item.timeSec > 0 && item.timeSec < durationSec);
  return [
    transitionKeyframeFromEndpoint(transition, 'start', durationSec),
    ...middle,
    transitionKeyframeFromEndpoint(transition, 'end', durationSec)
  ].sort((a, b) => a.timeSec - b.timeSec);
}

function keyframeSegmentAt(track: TransitionKeyframe[], timeSec: number) {
  if (track.length < 2) return { from: track[0], to: track[0], localT: 0 };
  for (let index = 0; index < track.length - 1; index += 1) {
    const from = track[index];
    const to = track[index + 1];
    if (timeSec <= to.timeSec || index === track.length - 2) {
      const span = Math.max(0.0001, to.timeSec - from.timeSec);
      return { from, to, localT: clampNumber((timeSec - from.timeSec) / span, 0, 1) };
    }
  }
  return { from: track[track.length - 2], to: track[track.length - 1], localT: 1 };
}

function interpolateKeyframeSample(from: TransitionKeyframe, to: TransitionKeyframe, eased: number, timeSec: number): AnimationClipSample {
  const pose = clonePose(from.pose);
  for (const key of POSE_KEYS) pose[key] = slerpRotation(from.pose[key], to.pose[key], eased);
  const fromRotationQ = vecToQuaternion(from.transform.rotation);
  const toRotationQ = vecToQuaternion(to.transform.rotation);
  return {
    timeSec: Number(timeSec.toFixed(4)),
    transform: {
      position: lerpVec3(from.transform.position, to.transform.position, eased),
      rotation: quatToRotation(fromRotationQ.slerp(toRotationQ, eased)),
      scale: lerpVec3(from.transform.scale, to.transform.scale, eased)
    },
    pose,
    bonePose: lerpBonePose(from.bonePose, to.bonePose, eased),
    fingerPose: lerpFingerPose(from.fingerPose, to.fingerPose, eased),
    toePose: lerpToePose(from.toePose, to.toePose, eased),
    libTvJointAngles: from.libTvJointAngles && to.libTvJointAngles
      ? interpolateLibTvJointAngles(from.libTvJointAngles, to.libTvJointAngles, eased)
      : undefined
  };
}

function sampleTimesForKeyframeTrack(durationSec: number, sampleCount: number, keyframeTrack: TransitionKeyframe[]) {
  const times = new Map<string, number>();
  for (let index = 0; index <= sampleCount; index += 1) {
    const timeSec = Number(((index / sampleCount) * durationSec).toFixed(4));
    times.set(timeSec.toFixed(4), timeSec);
  }
  keyframeTrack.forEach((frame) => {
    const timeSec = Number(clampNumber(frame.timeSec, 0, durationSec).toFixed(4));
    times.set(timeSec.toFixed(4), timeSec);
  });
  return Array.from(times.values()).sort((a, b) => a - b);
}

function exactKeyframeAtTime(keyframeTrack: TransitionKeyframe[], timeSec: number) {
  return keyframeTrack.find((frame) => Math.abs(frame.timeSec - timeSec) <= 0.0006);
}

function animationSampleFromKeyframe(frame: TransitionKeyframe, timeSec = frame.timeSec): AnimationClipSample {
  return {
    timeSec: Number(timeSec.toFixed(4)),
    transform: clonePoseTransform(frame.transform),
    pose: clonePose(frame.pose),
    bonePose: cloneBonePose(frame.bonePose),
    fingerPose: cloneFingerPose(frame.fingerPose),
    toePose: cloneToePose(frame.toePose),
    libTvJointAngles: cloneLibTvJointAngles(frame.libTvJointAngles)
  };
}

function restoreExplicitMiddleKeyframeSamples(samples: AnimationClipSample[], transition: PoseTransition) {
  if (!samples.length || !transition.keyframes.length) return samples;
  const durationSec = Math.max(0.1, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const middleKeyframes = normalizeTransitionKeyframes(transition.keyframes, durationSec)
    .filter((frame) => frame.timeSec > 0 && frame.timeSec < durationSec);
  if (!middleKeyframes.length) return samples;

  const next = samples.map(cloneAnimationSample);
  middleKeyframes.forEach((frame) => {
    const timeSec = Number(frame.timeSec.toFixed(4));
    let index = next.findIndex((sample) => Math.abs(sample.timeSec - timeSec) <= 0.0006);
    const restored = animationSampleFromKeyframe(frame, timeSec);
    if (index < 0) {
      next.push(restored);
      return;
    }
    next[index] = restored;
  });
  return next.sort((a, b) => a.timeSec - b.timeSec);
}

function explicitMiddleKeyframeTimes(transition: PoseTransition, durationSec: number) {
  return normalizeTransitionKeyframes(transition.keyframes, durationSec)
    .filter((frame) => frame.timeSec > 0 && frame.timeSec < durationSec)
    .map((frame) => Number(frame.timeSec.toFixed(4)));
}

function roundMotionConstraintNumber(value: number, digits = 3) {
  return Number(value.toFixed(digits));
}

function compactMotionVec3(value: Vec3, digits = 3) {
  return {
    x: roundMotionConstraintNumber(value.x, digits),
    y: roundMotionConstraintNumber(value.y, digits),
    z: roundMotionConstraintNumber(value.z, digits)
  };
}

function compactMotionPoseForConstraint(pose: StandardHumanRigPose) {
  const keys: PoseJointKey[] = [
    'pelvis',
    'chest',
    'head',
    'leftUpperArm',
    'leftLowerArm',
    'rightUpperArm',
    'rightLowerArm',
    'leftUpperLeg',
    'leftLowerLeg',
    'rightUpperLeg',
    'rightLowerLeg',
    'leftFoot',
    'rightFoot'
  ];
  return keys.reduce((acc, key) => {
    acc[key] = compactMotionVec3(pose[key], 1);
    return acc;
  }, {} as Partial<Record<PoseJointKey, Vec3>>);
}

function motionFixedPoseConstraints(transition: PoseTransition) {
  const durationSec = Math.max(0.1, transition.durationSec || 1);
  return transitionKeyframeTrack(transition, durationSec).map((frame) => {
    const role = frame.timeSec <= 0.0006
      ? 'start'
      : frame.timeSec >= durationSec - 0.0006
        ? 'end'
        : 'middle';
    return {
      id: frame.id,
      role,
      label: frame.label,
      timeSec: roundMotionConstraintNumber(frame.timeSec, 4),
      timeRatio: roundMotionConstraintNumber(frame.timeSec / durationSec, 4),
      posePresetId: frame.posePresetId,
      transform: {
        position: compactMotionVec3(frame.transform.position),
        rotation: compactMotionVec3(frame.transform.rotation, 1),
        scale: compactMotionVec3(frame.transform.scale)
      },
      pose: compactMotionPoseForConstraint(frame.pose),
      hasBonePose: Boolean(frame.bonePose),
      hasFingerPose: Boolean(frame.fingerPose),
      hasToePose: Boolean(frame.toePose),
      note: frame.note || ''
    };
  });
}

function middleKeyframeConstraintNote(transition: PoseTransition) {
  const count = motionFixedPoseConstraints(transition).filter((frame) => frame.role === 'middle').length;
  return count > 0 ? `已把 ${count} 个中间帧作为硬关键姿势约束，动作理解和生成必须按时间经过这些姿势。` : '';
}

function intervalTouchesExplicitKeyframe(a: number, b: number, keyframeTimes: number[]) {
  if (!keyframeTimes.length) return false;
  return keyframeTimes.some((timeSec) => Math.abs(a - timeSec) <= 0.0006 || Math.abs(b - timeSec) <= 0.0006);
}

function easeCurve(curve: CurveType, t: number) {
  const x = clampNumber(t, 0, 1);
  if (curve === 'ease_in') return x * x;
  if (curve === 'ease_out') return 1 - (1 - x) * (1 - x);
  if (curve === 'ease_in_out') return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  if (curve === 'bullet_time') return x < 0.22 ? x * 1.25 : x < 0.72 ? 0.275 + (x - 0.22) * 0.35 : 0.45 + (x - 0.72) * (0.55 / 0.28);
  if (curve === 'pulse') return clampNumber(x + Math.sin(x * Math.PI) * Math.exp(-Math.pow((x - 0.5) / 0.18, 2)) * 0.18, 0, 1);
  if (curve === 'hold_then_burst') return x < 0.62 ? x * 0.16 : 0.1 + Math.pow((x - 0.62) / 0.38, 2) * 0.9;
  return x;
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

// SECTION: Prompt parsing and deterministic motion planning
function semanticSequenceLocalRatio(transition: PoseTransition, actionType: MotionSemanticActionType, t: number) {
  const step = transition.actionPlan.semanticPlan?.actionSequence?.find((item) => item.actionType === actionType);
  return step ? stageProgress(t, step.startRatio, step.endRatio) : clamp01(t);
}

function semanticContactActionAtTime(transition: PoseTransition, t: number): MotionSemanticActionType | undefined {
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (!semanticPlan) return undefined;
  const contactActions: MotionSemanticActionType[] = ['push', 'pull', 'throw', 'reach'];
  const active = semanticPlan.actionSequence
    ? activeSequenceWeights(semanticPlan.actionSequence, t)
      .filter((item) => contactActions.includes(item.step.actionType))
      .sort((a, b) => b.weight - a.weight)[0]?.step.actionType
    : undefined;
  return active || (contactActions.includes(semanticPlan.actionType) ? semanticPlan.actionType : undefined);
}

function semanticBaseTargetPosition(scene: Scene3DState, transition: PoseTransition, fallbackRatio = 0.45, origin?: Vec3) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const target = findSceneObject(scene, semanticPlan?.targetObjectId);
  const actionType = semanticContactActionAtTime(transition, fallbackRatio) || semanticPlan?.actionType;
  return target ? semanticContactAnchorPosition(target, origin, actionType) : semanticTargetPosition(scene, transition, fallbackRatio);
}

function semanticContactForwardDirection(
  scene: Scene3DState,
  transition: PoseTransition,
  origin: Vec3,
  t = 0.45,
  actionType?: MotionSemanticActionType
) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const contactAction = actionType || semanticContactActionAtTime(transition, t) || semanticPlan?.actionType;
  const target = findSceneObject(scene, semanticPlan?.targetObjectId);
  const targetPosition = target
    ? semanticContactAnchorPosition(target, origin, contactAction)
    : semanticTargetPosition(scene, transition, t);
  const targetVector = vec(targetPosition.x - origin.x, 0, targetPosition.z - origin.z);
  const targetDirection = normalizedDirection(targetVector);
  if (targetDirection.x || targetDirection.z) return targetDirection;
  const promptDirection = normalizedDirection(transition.actionPlan.universal?.direction || vec(0, 0, -1));
  return promptDirection.x || promptDirection.z ? promptDirection : vec(0, 0, -1);
}

function semanticPropContactForwardDirection(prop: PropObject, transition: PoseTransition, sample: AnimationClipSample, actionType?: MotionSemanticActionType) {
  const contactPoint = semanticContactAnchorPosition(prop, sample.transform.position, actionType);
  const targetVector = vec(contactPoint.x - sample.transform.position.x, 0, contactPoint.z - sample.transform.position.z);
  const targetDirection = normalizedDirection(targetVector);
  if (targetDirection.x || targetDirection.z) return targetDirection;
  const promptDirection = normalizedDirection(transition.actionPlan.universal?.direction || vec(0, 0, -1));
  return promptDirection.x || promptDirection.z ? promptDirection : vec(0, 0, -1);
}

function semanticContactWindow(actionType: MotionSemanticActionType | undefined, localT: number, control: ReturnType<typeof motionControlFromPrompt>) {
  const t = clamp01(localT);
  if (actionType === 'push') {
    const reach = ramp(t, 0.08, control.speedLabel === '缓慢' ? 0.38 : 0.32);
    const hold = Math.min(ramp(t, 0.26, 0.44), 1 - ramp(t, control.sustained ? 0.96 : 0.88, 1));
    const drive = ramp(t, control.burst ? 0.44 : 0.48, control.sustained ? 0.94 : 0.84);
    const release = ramp(t, control.sustained ? 0.96 : 0.9, 1);
    return { reach, hold, drive, release, contact: Math.max(hold, drive * 0.9) };
  }
  if (actionType === 'pull') {
    const reach = ramp(t, 0.06, control.speedLabel === '缓慢' ? 0.34 : 0.28);
    const hold = Math.min(ramp(t, 0.26, 0.42), 1 - ramp(t, control.sustained ? 0.94 : 0.86, 1));
    const drive = ramp(t, control.burst ? 0.42 : 0.46, control.sustained ? 0.92 : 0.82);
    const release = ramp(t, control.sustained ? 0.95 : 0.88, 1);
    return { reach, hold, drive, release, contact: Math.max(hold, drive * 0.84) };
  }
  if (actionType === 'throw') {
    const reach = 1 - ramp(t, 0.58, 0.72);
    const hold = 1 - ramp(t, control.burst ? 0.52 : 0.56, control.speedLabel === '缓慢' ? 0.78 : 0.68);
    const drive = ramp(t, control.burst ? 0.48 : 0.52, control.speedLabel === '缓慢' ? 0.82 : 0.72);
    const release = ramp(t, control.burst ? 0.56 : 0.62, control.speedLabel === '缓慢' ? 0.82 : 0.74);
    return { reach, hold: Math.max(0, hold), drive, release, contact: Math.max(0, Math.min(reach, hold)) };
  }
  return { reach: 0, hold: 0, drive: 0, release: 0, contact: 0 };
}

function contactHandOffset(forward: Vec3, limb: 'leftHand' | 'rightHand', width = 0.11) {
  const side = limb === 'leftHand' ? -1 : 1;
  const perpendicular = normalizedDirection(vec(-forward.z, 0, forward.x));
  const fallback = perpendicular.x || perpendicular.z ? perpendicular : vec(1, 0, 0);
  return vec(fallback.x * width * side, 0, fallback.z * width * side);
}

function contactTargetForHand(position: Vec3, forward: Vec3, limb: 'leftHand' | 'rightHand', width = 0.11) {
  const offset = contactHandOffset(forward, limb, width);
  return vec(
    Number((position.x + offset.x).toFixed(4)),
    Number(position.y.toFixed(4)),
    Number((position.z + offset.z).toFixed(4))
  );
}

function semanticContactHandWidth(scene: Scene3DState, transition: PoseTransition, actionType?: MotionSemanticActionType) {
  const target = findSceneObject(scene, transition.actionPlan.semanticPlan?.targetObjectId);
  const targetScale = target && 'scale' in target ? target.scale : undefined;
  const targetWidth = targetScale ? Math.max(targetScale.x || 0.3, targetScale.z || 0.3) : 0.3;
  if (actionType === 'throw') return clampNumber(targetWidth * 0.16, 0.055, 0.11);
  if (actionType === 'push' || actionType === 'pull') return clampNumber(targetWidth * 0.24, 0.1, 0.22);
  return clampNumber(targetWidth * 0.2, 0.08, 0.16);
}

function semanticHandTargetSample(scene: Scene3DState, transition: PoseTransition, transform: PoseTransform, t: number) {
  const actionType = semanticContactActionAtTime(transition, t);
  if (!actionType) return null;
  const localT = semanticSequenceLocalRatio(transition, actionType, t);
  const control = motionControlFromPrompt(transition.actionPrompt, transition.actionPlan.semanticPlan);
  const baseTarget = semanticBaseTargetPosition(scene, transition, localT, transform.position);
  const forward = semanticContactForwardDirection(scene, transition, transform.position, t, actionType);
  const bodyTarget = vec(
    Number((transform.position.x + forward.x * 0.18).toFixed(4)),
    Number((transform.position.y + 1.05).toFixed(4)),
    Number((transform.position.z + forward.z * 0.18).toFixed(4))
  );

  if (actionType === 'push') {
    const window = semanticContactWindow(actionType, localT, control);
    const brace = 1 - window.release;
    const position = vec(
      Number((baseTarget.x + forward.x * 0.34 * window.drive * control.travelScale).toFixed(4)),
      Number((baseTarget.y + 0.015 + 0.025 * brace).toFixed(4)),
      Number((baseTarget.z + forward.z * 0.34 * window.drive * control.travelScale).toFixed(4))
    );
    return { actionType, position, strength: Math.min(1, Math.max(window.reach * 0.55, window.contact * 0.95) * control.holdScale) };
  }

  if (actionType === 'pull') {
    const window = semanticContactWindow(actionType, localT, control);
    const propFollow = 0.3 * control.travelScale * window.hold * window.drive;
    const position = vec(
      Number((baseTarget.x - forward.x * propFollow).toFixed(4)),
      Number(lerp(baseTarget.y, bodyTarget.y, window.drive * 0.18).toFixed(4)),
      Number((baseTarget.z - forward.z * propFollow).toFixed(4))
    );
    return { actionType, position, strength: Math.min(1, Math.max(window.reach * 0.5, window.contact * 0.94) * control.holdScale) };
  }

  if (actionType === 'throw') {
    const window = semanticContactWindow(actionType, localT, control);
    const releaseTarget = releasePositionForThrow(transition);
    const windupTarget = vec(
      Number((transform.position.x - forward.x * 0.2).toFixed(4)),
      Number((transform.position.y + 1.18).toFixed(4)),
      Number((transform.position.z - forward.z * 0.22).toFixed(4))
    );
    const position = localT < 0.42
      ? lerpVec3(baseTarget, windupTarget, ramp(localT, 0.06, 0.34))
      : lerpVec3(windupTarget, releaseTarget, window.release * control.forceScale);
    return { actionType, position, strength: Math.max(0, window.contact * 0.82 * control.holdScale) };
  }

  const reach = Math.min(ramp(localT, 0.1, 0.52), 1 - ramp(localT, 0.88, 1));
  return { actionType, position: baseTarget, strength: reach * 0.78 };
}

function semanticHandTargetForLimb(
  scene: Scene3DState,
  transition: PoseTransition,
  transform: PoseTransform,
  t: number,
  limb: 'leftHand' | 'rightHand'
) {
  const sample = semanticHandTargetSample(scene, transition, transform, t);
  if (!sample) return null;
  const forward = semanticContactForwardDirection(scene, transition, transform.position, t, sample.actionType);
  return {
    ...sample,
    forward,
    position: contactTargetForHand(
      sample.position,
      forward,
      limb,
      semanticContactHandWidth(scene, transition, sample.actionType)
    )
  };
}

function targetPositionForConstraint(scene: Scene3DState, transition: PoseTransition, transform: PoseTransform, t = 0.5) {
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
  const explicitHandTargetObject = transition.constraints.handTarget.targetMode === 'object'
    ? objectById(transition.constraints.handTarget.targetObjectId)
    : null;
  const explicitHandTarget = explicitHandTargetObject
    ? contactPositionForObject(explicitHandTargetObject, transform.position)
    : transition.constraints.handTarget.targetPosition;
  const templateTargetObject = objectById(templateTarget?.targetObjectId || undefined);
  const semanticPlan = transition.actionPlan.semanticPlan;
  const semanticTargetObject = objectById(semanticPlan?.targetObjectId);
  const hasSemanticHandTarget = Boolean(semanticPlan?.contacts.some((item) => (
    item.contact === 'hands' || item.contact === 'leftHand' || item.contact === 'rightHand'
  )));
  const semanticHandTarget = hasSemanticHandTarget
    ? semanticHandTargetSample(scene, transition, transform, t)?.position
      || (semanticTargetObject
        ? semanticContactAnchorPosition(semanticTargetObject, transform.position, semanticContactActionAtTime(transition, t) || semanticPlan?.actionType)
        : semanticTargetPosition(scene, transition))
    : undefined;
  const semanticHandStrength = hasSemanticHandTarget ? semanticHandTargetSample(scene, transition, transform, t)?.strength ?? 0.72 : 0;
  const handTarget = explicitHandTarget || (templateTargetObject ? contactPositionForObject(templateTargetObject, transform.position) : undefined) || semanticHandTarget;
  return {
    headTarget: headTarget ? normalizeVec(headTarget, vec()) : undefined,
    handTarget: handTarget ? normalizeVec(handTarget, vec()) : undefined,
    handTargetObjectId: transition.constraints.handTarget.targetObjectId || templateTarget?.targetObjectId || semanticPlan?.targetObjectId || undefined,
    handStrength: explicitHandTarget || templateTargetObject ? 1 : semanticHandStrength,
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
  origin: Vec3,
  verticalAimOffset = 0.22
): { pose: StandardHumanRigPose; warning?: string } {
  if (!handTarget) return { pose };
  const side = hand === 'left' ? -1 : 1;
  const shoulder = new THREE.Vector3(origin.x + side * 0.28, origin.y + 1.28, origin.z);
  const target = new THREE.Vector3(handTarget.x, handTarget.y + verticalAimOffset, handTarget.z);
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
    ? `${hand === 'left' ? '左手' : '右手'}目标超出可达范围，已自动限制。`
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
      rightUpperArm: { x: shoulderX, y: twist, z: sideLift },
      rightLowerArm: { x: bend },
      rightHand: { x: Math.min(22, Math.max(-22, pitch * 0.25)), z: 10 }
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
  if (template.id === 'combat_strike') {
    const hand = template.hand || 'right';
    const windup = pulse(t, 0.02, 0.42) * weight;
    const strike = pulse(t, 0.32, 0.72) * weight;
    const recover = ramp(t, 0.68, 1) * weight;
    transform.position.z -= 0.16 * strike;
    transform.rotation.y += (hand === 'left' ? -1 : 1) * (8 * strike - 4 * windup);
    return finalize(patchPose(pose, hand === 'left'
      ? {
          pelvis: { x: -8 * strike, y: -6 * strike },
          chest: { x: -10 * strike, y: -18 * strike + 8 * windup },
          head: { y: -10 * strike },
          leftUpperArm: { x: -22 * strike + 22 * windup, y: -34 * strike, z: -58 * strike - 18 * windup },
          leftLowerArm: { x: 8 * strike + 80 * windup - 24 * recover, y: 8 * strike },
          leftHand: { x: -8 * strike, z: -8 * strike },
          rightUpperArm: { x: 36 * strike, y: 16 * strike, z: 42 * strike },
          rightLowerArm: { x: 92 * strike },
          leftUpperLeg: { x: 12 * strike },
          rightUpperLeg: { x: -16 * strike },
          rightLowerLeg: { x: 18 * strike }
        }
      : {
          pelvis: { x: -8 * strike, y: 6 * strike },
          chest: { x: -10 * strike, y: 18 * strike - 8 * windup },
          head: { y: 10 * strike },
          rightUpperArm: { x: -22 * strike + 22 * windup, y: 34 * strike, z: 58 * strike + 18 * windup },
          rightLowerArm: { x: 8 * strike + 80 * windup - 24 * recover, y: -8 * strike },
          rightHand: { x: -8 * strike, z: 8 * strike },
          leftUpperArm: { x: 36 * strike, y: -16 * strike, z: -42 * strike },
          leftLowerArm: { x: 92 * strike },
          rightUpperLeg: { x: 12 * strike },
          leftUpperLeg: { x: -16 * strike },
          leftLowerLeg: { x: 18 * strike }
        }));
  }
  if (template.id === 'combat_block') {
    const block = pulse(t, 0.18, 0.82) * weight;
    transform.position.z += 0.08 * block;
    transform.rotation.z += 4 * block;
    return finalize(patchPose(pose, {
      pelvis: { x: -8 * block },
      chest: { x: -6 * block, z: -7 * block },
      neck: { x: -4 * block },
      head: { x: -6 * block },
      leftUpperArm: { x: 48 * block, y: -22 * block, z: -58 * block },
      rightUpperArm: { x: 48 * block, y: 22 * block, z: 58 * block },
      leftLowerArm: { x: 112 * block, y: 16 * block, z: 16 * block },
      rightLowerArm: { x: 112 * block, y: -16 * block, z: -16 * block },
      leftHand: { x: -10 * block, z: -16 * block },
      rightHand: { x: -10 * block, z: 16 * block },
      leftUpperLeg: { x: -8 * block },
      rightUpperLeg: { x: -8 * block },
      leftLowerLeg: { x: 18 * block },
      rightLowerLeg: { x: 18 * block }
    }));
  }
  if (template.id === 'kick') {
    const kick = pulse(t, 0.2, 0.78) * weight;
    const sideKick = /\bside\b/.test(template.label.toLowerCase()) || template.hand === 'left';
    transform.position.y += 0.04 * kick;
    transform.position.z -= 0.12 * kick;
    transform.rotation.z += (sideKick ? -1 : 1) * 8 * kick;
    return finalize(patchPose(pose, {
      pelvis: { x: -10 * kick, z: (sideKick ? -1 : 1) * 18 * kick },
      chest: { x: 10 * kick, z: (sideKick ? 1 : -1) * 16 * kick },
      head: { z: (sideKick ? 1 : -1) * 8 * kick },
      leftUpperArm: { x: 24 * kick, z: -48 * kick },
      rightUpperArm: { x: 24 * kick, z: 48 * kick },
      leftLowerArm: { x: 72 * kick },
      rightLowerArm: { x: 72 * kick },
      leftUpperLeg: { x: sideKick ? 18 * kick : -74 * kick, z: sideKick ? 86 * kick : -10 * kick },
      leftLowerLeg: { x: sideKick ? -8 * kick : 26 * kick },
      leftFoot: { x: sideKick ? 4 * kick : -18 * kick, z: sideKick ? 12 * kick : 0 },
      rightUpperLeg: { x: sideKick ? -16 * kick : 26 * kick, z: sideKick ? 18 * kick : 0 },
      rightLowerLeg: { x: sideKick ? 22 * kick : 36 * kick },
      rightFoot: { x: -10 * kick }
    }));
  }
  return pose;
}

function stageWindow(t: number, start: number, end: number, fade = 0.08) {
  if (t <= start || t >= end) return 0;
  const fadeIn = ramp(t, start, Math.min(end, start + fade));
  const fadeOut = 1 - ramp(t, Math.max(start, end - fade), end);
  return clamp01(Math.min(fadeIn, fadeOut));
}

function stageProgress(t: number, start: number, end: number) {
  return clamp01((t - start) / Math.max(0.0001, end - start));
}

function promptRequestsBurstTiming(prompt: string) {
  return matchesPrompt(prompt, /突然|猛然|瞬间|爆发|猛冲|急停|burst|sudden|snap|impact/);
}

function promptRequestsSustainedTiming(prompt: string) {
  return matchesPrompt(prompt, /持续|保持|稳住|停住|定住|continuous|sustain|hold|pause|stop/);
}

function promptRequestsAccelerateTiming(prompt: string) {
  return matchesPrompt(prompt, /加速|越来越快|逐渐加快|accelerate|speed up/);
}

function promptRequestsDecelerateTiming(prompt: string) {
  return matchesPrompt(prompt, /减速|放慢|慢下来|停下|刹住|decelerate|slow down|brake/);
}

function semanticActionTime(transition: PoseTransition, t: number) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const x = clamp01(t);
  const prompt = transition.actionPrompt;
  if (promptRequestsBurstTiming(prompt)) return easeCurve('hold_then_burst', x);
  if (promptRequestsSustainedTiming(prompt)) {
    return x < 0.18
      ? easeCurve('ease_out', x / 0.18) * 0.28
      : x < 0.78
        ? 0.28 + (x - 0.18) * 0.36
        : 0.5 + easeCurve('ease_in', (x - 0.78) / 0.22) * 0.5;
  }
  if (promptRequestsAccelerateTiming(prompt)) return easeCurve('ease_in', x);
  if (promptRequestsDecelerateTiming(prompt)) return easeCurve('ease_out', x);
  if (semanticPlan?.speedLabel === '快速') return easeCurve('ease_out', x);
  if (semanticPlan?.speedLabel === '缓慢') return easeCurve('ease_in_out', x);
  if (semanticPlan?.speedLabel === '持续') return x < 0.72 ? x * 0.72 : 0.52 + (x - 0.72) * (0.48 / 0.28);
  return x;
}

function applySemanticActionStageOverlay(
  pose: StandardHumanRigPose,
  transform: PoseTransform,
  transition: PoseTransition,
  t: number,
  profile?: Scene3DJointAxisProfile
) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (!semanticPlan || semanticPlan.actionType === 'unknown' || semanticPlan.actionType === 'idle') return pose;
  const finalize = (nextPose: StandardHumanRigPose) => profile ? clampPoseWithJointProfile(nextPose, profile) : nextPose;
  const actionType = semanticPlan.actionType;
  const prompt = transition.actionPrompt;
  const handPreference = inferPromptHand(prompt);
  const mainHand: 'left' | 'right' = handPreference === 'left' ? 'left' : 'right';
  const bothHands = handPreference === 'both' || semanticPlan.contacts.some((item) => item.contact === 'hands');
  const direction = transition.actionPlan.universal?.direction || vec(0, 0, -1);
  const control = motionControlFromPrompt(prompt, semanticPlan);
  const forceScale = control.forceScale;
  const speedScale = control.speedScale;

  if (actionType === 'push') {
    const brace = ramp(t, 0.02, control.speedLabel === '缓慢' ? 0.28 : 0.2) * (1 - ramp(t, 0.92, 1));
    const reach = stageWindow(t, 0.04, control.speedLabel === '快速' ? 0.28 : 0.34);
    const contact = stageWindow(t, 0.24, control.sustained ? 0.68 : 0.56);
    const exert = stageWindow(t, control.burst ? 0.54 : 0.48, control.sustained ? 0.96 : 0.9) * forceScale;
    const drive = Math.max(contact * 0.72, exert);
    transform.position.x += direction.x * 0.045 * drive * control.travelScale;
    transform.position.z += (direction.z || -1) * 0.045 * drive * control.travelScale;
    const armPatch = bothHands
      ? {
          leftUpperArm: { x: 10 * reach - 26 * drive, y: -6 * drive, z: -24 * brace - 34 * drive },
          rightUpperArm: { x: 10 * reach - 26 * drive, y: 6 * drive, z: 24 * brace + 34 * drive },
          leftLowerArm: { x: 28 * reach + 18 * drive },
          rightLowerArm: { x: 28 * reach + 18 * drive },
          leftHand: { x: -5 * drive, z: -8 * drive },
          rightHand: { x: -5 * drive, z: 8 * drive }
        }
      : mainHand === 'left'
        ? {
            leftUpperArm: { x: 10 * reach - 30 * drive, y: -8 * drive, z: -22 * brace - 38 * drive },
            leftLowerArm: { x: 30 * reach + 18 * drive },
            leftHand: { x: -5 * drive, z: -8 * drive },
            rightUpperArm: { x: 20 * brace, z: 20 * brace },
            rightLowerArm: { x: 58 * brace }
          }
        : {
            rightUpperArm: { x: 10 * reach - 30 * drive, y: 8 * drive, z: 22 * brace + 38 * drive },
            rightLowerArm: { x: 30 * reach + 18 * drive },
            rightHand: { x: -5 * drive, z: 8 * drive },
            leftUpperArm: { x: 20 * brace, z: -20 * brace },
            leftLowerArm: { x: 58 * brace }
          };
    return finalize(offsetPose(pose, {
      pelvis: { x: -6 * brace - 6 * drive },
      chest: { x: -8 * brace - 12 * drive, y: direction.x * 5 * drive },
      head: { x: -3 * drive },
      leftUpperLeg: { x: -5 * brace - 4 * exert, z: -2 * direction.x * drive },
      rightUpperLeg: { x: -5 * brace - 4 * exert, z: 2 * direction.x * drive },
      leftLowerLeg: { x: 8 * brace + 8 * exert },
      rightLowerLeg: { x: 8 * brace + 8 * exert },
      ...armPatch
    }));
  }

  if (actionType === 'pull') {
    const reach = stageWindow(t, 0.02, control.speedLabel === '快速' ? 0.28 : 0.34);
    const grab = stageWindow(t, 0.26, control.sustained ? 0.58 : 0.48);
    const pull = stageWindow(t, control.burst ? 0.48 : 0.42, control.sustained ? 0.94 : 0.84) * forceScale;
    const settle = stageWindow(t, 0.78, 0.98);
    transform.position.x -= direction.x * 0.04 * pull * control.travelScale;
    transform.position.z -= (direction.z || -1) * 0.04 * pull * control.travelScale;
    const armPatch = bothHands
      ? {
          leftUpperArm: { x: -18 * reach + 26 * pull, y: -6 * pull, z: -26 * reach - 12 * pull },
          rightUpperArm: { x: -18 * reach + 26 * pull, y: 6 * pull, z: 26 * reach + 12 * pull },
          leftLowerArm: { x: 26 * reach + 48 * pull - 12 * settle },
          rightLowerArm: { x: 26 * reach + 48 * pull - 12 * settle },
          leftHand: { x: -4 * grab + 6 * pull, z: -6 * grab },
          rightHand: { x: -4 * grab + 6 * pull, z: 6 * grab }
        }
      : mainHand === 'left'
        ? {
            leftUpperArm: { x: -20 * reach + 30 * pull, y: -8 * pull, z: -30 * reach - 12 * pull },
            leftLowerArm: { x: 28 * reach + 50 * pull - 12 * settle },
            leftHand: { x: -4 * grab + 6 * pull, z: -6 * grab },
            rightUpperArm: { x: 20 * grab, z: 18 * grab },
            rightLowerArm: { x: 56 * grab }
          }
        : {
            rightUpperArm: { x: -20 * reach + 30 * pull, y: 8 * pull, z: 30 * reach + 12 * pull },
            rightLowerArm: { x: 28 * reach + 50 * pull - 12 * settle },
            rightHand: { x: -4 * grab + 6 * pull, z: 6 * grab },
            leftUpperArm: { x: 20 * grab, z: -18 * grab },
            leftLowerArm: { x: 56 * grab }
          };
    return finalize(offsetPose(pose, {
      pelvis: { x: 4 * grab + 8 * pull },
      chest: { x: -6 * reach + 10 * pull, y: -direction.x * 5 * pull },
      head: { x: 2 * pull },
      leftUpperLeg: { x: -3 * grab + 5 * pull },
      rightUpperLeg: { x: -3 * grab + 5 * pull },
      leftLowerLeg: { x: 7 * grab },
      rightLowerLeg: { x: 7 * grab },
      ...armPatch
    }));
  }

  if (actionType === 'throw') {
    const windup = stageWindow(t, 0.04, control.burst ? 0.46 : 0.42) * forceScale;
    const release = stageWindow(t, control.burst ? 0.48 : 0.38, control.speedLabel === '缓慢' ? 0.74 : 0.68, control.burst ? 0.035 : 0.055) * forceScale * speedScale;
    const follow = stageWindow(t, 0.62, 0.96);
    const side = mainHand === 'left' ? -1 : 1;
    transform.rotation.y += side * (-14 * windup + 20 * release + 5 * follow);
    transform.position.z += 0.03 * windup - 0.07 * release;
    const throwingArm = mainHand === 'left'
      ? {
          leftUpperArm: { x: 44 * windup - 50 * release + 18 * follow, y: -18 * windup - 28 * release, z: -24 * windup - 42 * release },
          leftLowerArm: { x: 62 * windup - 30 * release + 18 * follow, y: -10 * release },
          leftHand: { x: -8 * release, z: -12 * release },
          rightUpperArm: { x: 18 * windup + 12 * follow, z: 18 * windup },
          rightLowerArm: { x: 48 * windup }
        }
      : {
          rightUpperArm: { x: 44 * windup - 50 * release + 18 * follow, y: 18 * windup + 28 * release, z: 24 * windup + 42 * release },
          rightLowerArm: { x: 62 * windup - 30 * release + 18 * follow, y: 10 * release },
          rightHand: { x: -8 * release, z: 12 * release },
          leftUpperArm: { x: 18 * windup + 12 * follow, z: -18 * windup },
          leftLowerArm: { x: 48 * windup }
        };
    return finalize(offsetPose(pose, {
      pelvis: { x: -4 * windup - 6 * release, y: side * (8 * windup - 10 * release) },
      chest: { x: 8 * windup - 12 * release, y: side * (18 * windup - 24 * release) },
      head: { y: side * 6 * release },
      leftUpperLeg: { x: -4 * windup - 7 * release, z: mainHand === 'left' ? -3 * release : 1 * release },
      rightUpperLeg: { x: -2 * windup + 6 * release, z: mainHand === 'right' ? 3 * release : -1 * release },
      leftLowerLeg: { x: 8 * windup },
      rightLowerLeg: { x: 8 * windup },
      ...throwingArm
    }));
  }

  if (actionType === 'punch') {
    const guard = Math.max(0.35, 1 - ramp(t, 0.86, 1));
    const load = stageWindow(t, 0.06, 0.34) * forceScale;
    const strike = stageWindow(t, 0.28, 0.58, 0.055) * forceScale * speedScale;
    const recover = stageWindow(t, 0.52, 0.92);
    const side = mainHand === 'left' ? -1 : 1;
    transform.position.z -= 0.045 * strike;
    transform.rotation.y += side * (-4 * load + 9 * strike - 5 * recover);
    const strikeArm = mainHand === 'left'
      ? {
          leftUpperArm: { x: 22 * guard + 18 * load - 42 * strike + 18 * recover, y: -8 * guard - 22 * strike, z: -18 * guard - 32 * strike },
          leftLowerArm: { x: 74 * guard + 14 * load - 28 * strike + 22 * recover },
          leftHand: { x: -8 * strike, z: -8 * strike },
          rightUpperArm: { x: 28 * guard + 5 * strike, z: 26 * guard },
          rightLowerArm: { x: 72 * guard },
          rightHand: { x: -4 * guard }
        }
      : {
          rightUpperArm: { x: 22 * guard + 18 * load - 42 * strike + 18 * recover, y: 8 * guard + 22 * strike, z: 18 * guard + 32 * strike },
          rightLowerArm: { x: 74 * guard + 14 * load - 28 * strike + 22 * recover },
          rightHand: { x: -8 * strike, z: 8 * strike },
          leftUpperArm: { x: 28 * guard + 5 * strike, z: -26 * guard },
          leftLowerArm: { x: 72 * guard },
          leftHand: { x: -4 * guard }
        };
    return finalize(offsetPose(pose, {
      pelvis: { x: -4 * guard - 5 * strike, y: side * (-3 * load + 5 * strike) },
      chest: { x: -5 * guard - 8 * strike, y: side * (7 * load + 13 * strike - 4 * recover) },
      head: { y: side * 5 * strike },
      leftUpperLeg: { x: -5 * guard + 4 * strike, z: mainHand === 'left' ? -2 * strike : 1 * strike },
      rightUpperLeg: { x: -5 * guard - 3 * strike, z: mainHand === 'right' ? 2 * strike : -1 * strike },
      ...strikeArm
    }));
  }

  if (actionType === 'block') {
    const raise = ramp(t, 0.06, 0.34);
    const absorb = stageWindow(t, 0.32, 0.68);
    const hold = Math.max(raise * (1 - ramp(t, 0.92, 1)), absorb);
    transform.position.z += 0.028 * absorb;
    return finalize(offsetPose(pose, {
      pelvis: { x: -5 * hold, z: -2 * absorb },
      chest: { x: -6 * hold, z: -4 * hold },
      head: { x: -3 * hold },
      leftUpperArm: { x: 32 * hold, y: -10 * hold, z: -34 * hold },
      rightUpperArm: { x: 32 * hold, y: 10 * hold, z: 34 * hold },
      leftLowerArm: { x: 82 * hold, y: 10 * hold, z: -8 * absorb },
      rightLowerArm: { x: 82 * hold, y: -10 * hold, z: 8 * absorb },
      leftHand: { z: -6 * hold },
      rightHand: { z: 6 * hold }
    }));
  }

  if (actionType === 'kick' || actionType === 'side_kick') {
    const chamber = stageWindow(t, 0.08, 0.34);
    const extend = stageWindow(t, 0.32, 0.62, 0.055) * forceScale;
    const retract = stageWindow(t, 0.58, 0.92);
    const sideKick = actionType === 'side_kick' || /侧|横|side/.test(prompt);
    const kickLeg = inferPromptLeg(prompt) === 'left' ? 'left' : 'right';
    const side = sideKick ? (semanticDirectionLabel(prompt, transition.actionPlan.universal || deriveUniversalMotionPlan(prompt, [])) === '向左' ? -1 : 1) : 1;
    const kickSign = kickLeg === 'left' ? -1 : 1;
    transform.rotation.z += sideKick ? -side * 5 * extend : -kickSign * 2 * extend;
    transform.position.z -= sideKick ? 0 : 0.035 * extend;
    const leftKickPatch = kickLeg === 'left'
      ? {
          leftUpperLeg: { x: sideKick ? 20 * chamber - 40 * retract : -38 * chamber - 48 * extend + 26 * retract, z: sideKick ? side * 54 * extend : -7 * extend },
          leftLowerLeg: { x: sideKick ? 12 * chamber - 14 * extend + 10 * retract : 28 * chamber - 18 * extend + 18 * retract },
          leftFoot: { x: sideKick ? 4 * extend : -14 * extend, z: sideKick ? side * 8 * extend : 0 },
          rightUpperLeg: { x: -10 * chamber + 10 * extend, z: sideKick ? -side * 8 * extend : 0 },
          rightLowerLeg: { x: 18 * chamber + 8 * extend }
        }
      : {
          rightUpperLeg: { x: sideKick ? 20 * chamber - 40 * retract : -38 * chamber - 48 * extend + 26 * retract, z: sideKick ? side * 54 * extend : 7 * extend },
          rightLowerLeg: { x: sideKick ? 12 * chamber - 14 * extend + 10 * retract : 28 * chamber - 18 * extend + 18 * retract },
          rightFoot: { x: sideKick ? 4 * extend : -14 * extend, z: sideKick ? side * 8 * extend : 0 },
          leftUpperLeg: { x: -10 * chamber + 10 * extend, z: sideKick ? -side * 8 * extend : 0 },
          leftLowerLeg: { x: 18 * chamber + 8 * extend }
        };
    return finalize(offsetPose(pose, {
      pelvis: { x: -7 * chamber - 5 * extend, z: sideKick ? -side * 10 * extend : -kickSign * 2 * extend },
      chest: { x: 6 * chamber + 6 * extend, z: sideKick ? side * 10 * extend : kickSign * 3 * extend },
      leftUpperArm: { x: 18 * chamber + 12 * extend, z: -22 * chamber - 12 * extend },
      rightUpperArm: { x: 18 * chamber + 12 * extend, z: 22 * chamber + 12 * extend },
      leftLowerArm: { x: 46 * chamber + 18 * extend },
      rightLowerArm: { x: 46 * chamber + 18 * extend },
      ...leftKickPatch
    }));
  }

  if (actionType === 'turn') {
    const progress = ramp(t, 0.04, 0.92);
    const twist = Math.sin(progress * Math.PI);
    const sign = promptTurnDegrees(transition) < 0 ? -1 : 1;
    return finalize(offsetPose(pose, {
      pelvis: { y: -4 * sign * twist, z: -1.5 * sign * twist },
      chest: { y: 9 * sign * twist, z: 2.5 * sign * twist },
      neck: { y: 5 * sign * twist },
      head: { y: 6 * sign * twist },
      leftUpperLeg: { z: sign > 0 ? 3 * twist : -2 * twist },
      rightUpperLeg: { z: sign > 0 ? 2 * twist : -3 * twist },
      leftFoot: { z: sign > 0 ? 2 * twist : -1 * twist },
      rightFoot: { z: sign > 0 ? 1 * twist : -2 * twist }
    }));
  }

  if (actionType === 'run' || actionType === 'dash' || actionType === 'walk') {
    const gaitFrame = locomotionGaitFrame(transition, actionType, t, forceScale, speedScale);
    transform.position.y += gaitFrame.rootBob;
    return finalize(offsetPose(pose, gaitFrame.posePatch));
  }

  if (actionType === 'crouch') {
    const lower = ramp(t, 0.05, 0.48);
    const hold = stageWindow(t, 0.36, 0.98);
    const k = Math.max(lower * 0.75, hold) * (matchesPrompt(prompt, /低重心|躲避|闪避|duck|evade/) ? 1.05 : 1);
    transform.position.y -= 0.06 * k;
    return finalize(offsetPose(pose, {
      pelvis: { x: -12 * k },
      chest: { x: 10 * k },
      head: { x: -4 * k },
      leftUpperLeg: { x: -44 * k },
      rightUpperLeg: { x: -44 * k },
      leftLowerLeg: { x: 54 * k },
      rightLowerLeg: { x: 54 * k },
      leftFoot: { x: -8 * k },
      rightFoot: { x: -8 * k }
    }));
  }

  if (actionType === 'jump') {
    const compress = stageWindow(t, 0.04, 0.28);
    const airborne = stageWindow(t, 0.24, 0.72);
    const land = stageWindow(t, 0.68, 0.98);
    transform.position.y += 0.18 * airborne - 0.06 * compress - 0.035 * land;
    return finalize(offsetPose(pose, {
      pelvis: { x: -10 * compress + 4 * airborne - 6 * land },
      chest: { x: 8 * compress - 6 * airborne + 5 * land },
      leftUpperArm: { x: -10 * airborne + 12 * compress, z: -18 * airborne },
      rightUpperArm: { x: -10 * airborne + 12 * compress, z: 18 * airborne },
      leftUpperLeg: { x: -30 * compress + 12 * airborne - 18 * land },
      rightUpperLeg: { x: -30 * compress + 12 * airborne - 18 * land },
      leftLowerLeg: { x: 46 * compress - 16 * airborne + 32 * land },
      rightLowerLeg: { x: 46 * compress - 16 * airborne + 32 * land },
      leftFoot: { x: -8 * land },
      rightFoot: { x: -8 * land }
    }));
  }

  return pose;
}

function transitionWithSequenceAction(transition: PoseTransition, step: MotionActionSequenceStep): PoseTransition {
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (!semanticPlan) return transition;
  return {
    ...transition,
    actionPlan: {
      ...transition.actionPlan,
      semanticPlan: {
        ...semanticPlan,
        actionFamily: motionSemanticFamilyForAction(step.actionType),
        actionType: step.actionType,
        contacts: semanticContactsForAction(step.actionType, transition.actionPrompt),
        actionSkill: motionActionSkillSummary(step.actionType),
        actionSequence: undefined
      }
    }
  };
}

function sequenceStepBlendFade(step: MotionActionSequenceStep) {
  const duration = Math.max(0.02, step.endRatio - step.startRatio);
  return clampNumber(duration * 0.28, 0.08, 0.16);
}

function sequenceStepRawWeight(sequence: MotionActionSequenceStep[], step: MotionActionSequenceStep, index: number, t: number) {
  const fade = sequenceStepBlendFade(step);
  const start = index > 0 ? step.startRatio - fade * 0.75 : step.startRatio;
  const end = index < sequence.length - 1 ? step.endRatio + fade * 0.75 : step.endRatio;
  return stageWindow(t, Math.max(0, start), Math.min(1, end), fade);
}

function activeSequenceWeights(sequence: MotionActionSequenceStep[], t: number) {
  const active = sequence
    .map((step, index) => ({
      step,
      index,
      weight: step.actionType === 'unknown' || step.actionType === 'idle' ? 0 : sequenceStepRawWeight(sequence, step, index, t)
    }))
    .filter((item) => item.weight > 0.001);
  const total = active.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 1) return active;
  return active.map((item) => ({ ...item, weight: item.weight / total }));
}

function sequenceBoundaryRatios(sequence: MotionActionSequenceStep[]) {
  const ratios: number[] = [];
  for (let index = 0; index < sequence.length - 1; index += 1) {
    const current = sequence[index];
    const next = sequence[index + 1];
    const boundary = clamp01((current.endRatio + next.startRatio) / 2);
    if (boundary > 0.001 && boundary < 0.999) ratios.push(boundary);
  }
  return ratios;
}

function sequenceTransitionPatch(previous: MotionSemanticActionType, next: MotionSemanticActionType, strength: number) {
  const s = clamp01(strength);
  const patch: Partial<StandardHumanRigPose> = {};

  if (isLocomotionActionType(previous) && (next === 'push' || next === 'pull' || next === 'reach')) {
    Object.assign(patch, {
      pelvis: { x: 4 * s },
      chest: { x: next === 'pull' ? -6 * s : 8 * s },
      leftUpperArm: { x: next === 'pull' ? 46 * s : 62 * s, y: -8 * s, z: 14 * s },
      rightUpperArm: { x: next === 'pull' ? 46 * s : 62 * s, y: 8 * s, z: -14 * s },
      leftLowerArm: { x: next === 'pull' ? 34 * s : 18 * s },
      rightLowerArm: { x: next === 'pull' ? 34 * s : 18 * s },
      leftUpperLeg: { x: -8 * s },
      rightUpperLeg: { x: 8 * s },
      leftLowerLeg: { x: -10 * s },
      rightLowerLeg: { x: -10 * s },
      leftFoot: { x: -4 * s },
      rightFoot: { x: -4 * s }
    });
  }

  if (isLocomotionActionType(previous) && (next === 'punch' || next === 'kick' || next === 'side_kick' || next === 'throw')) {
    Object.assign(patch, {
      pelvis: { x: next === 'throw' ? -2 * s : 4 * s, y: -3 * s },
      chest: { x: next === 'throw' ? -4 * s : 7 * s, y: next === 'throw' ? -12 * s : -7 * s },
      leftUpperArm: { x: next === 'throw' ? 18 * s : 30 * s, y: 8 * s, z: 18 * s },
      rightUpperArm: { x: next === 'throw' ? -26 * s : 38 * s, y: -14 * s, z: -22 * s },
      leftLowerArm: { x: next === 'throw' ? 32 * s : 46 * s },
      rightLowerArm: { x: next === 'throw' ? 68 * s : 44 * s },
      leftUpperLeg: { x: -6 * s },
      rightUpperLeg: { x: 6 * s },
      leftLowerLeg: { x: -8 * s },
      rightLowerLeg: { x: -8 * s },
      leftFoot: { x: -3 * s },
      rightFoot: { x: -3 * s }
    });
  }

  if (previous === 'turn' && (next === 'push' || next === 'pull' || next === 'reach')) {
    Object.assign(patch, {
      pelvis: { y: -6 * s, x: 3 * s },
      chest: { y: next === 'pull' ? 8 * s : -8 * s, x: next === 'pull' ? -4 * s : 7 * s },
      leftUpperArm: { x: next === 'pull' ? 44 * s : 58 * s, y: -6 * s, z: 12 * s },
      rightUpperArm: { x: next === 'pull' ? 44 * s : 58 * s, y: 6 * s, z: -12 * s },
      leftLowerArm: { x: next === 'pull' ? 36 * s : 20 * s },
      rightLowerArm: { x: next === 'pull' ? 36 * s : 20 * s },
      leftLowerLeg: { x: -8 * s },
      rightLowerLeg: { x: -8 * s }
    });
  }

  if (previous === 'turn' && (next === 'throw' || next === 'punch' || next === 'kick' || next === 'side_kick')) {
    Object.assign(patch, {
      pelvis: { y: -8 * s },
      chest: { y: next === 'throw' ? -18 * s : -10 * s, x: 4 * s },
      rightUpperArm: { x: next === 'throw' ? -34 * s : 28 * s, y: -18 * s, z: -18 * s },
      rightLowerArm: { x: next === 'throw' ? 74 * s : 44 * s },
      leftUpperArm: { x: 24 * s, y: 10 * s, z: 18 * s },
      leftLowerArm: { x: 36 * s },
      leftUpperLeg: { x: -4 * s },
      rightUpperLeg: { x: 8 * s },
      leftLowerLeg: { x: -8 * s },
      rightLowerLeg: { x: -10 * s }
    });
  }

  if ((previous === 'crouch' || previous === 'block') && next === 'get_up') {
    Object.assign(patch, {
      pelvis: { x: 12 * (1 - s) },
      chest: { x: 8 * (1 - s) },
      leftUpperLeg: { x: -12 * (1 - s) },
      rightUpperLeg: { x: -12 * (1 - s) },
      leftLowerLeg: { x: -28 * (1 - s) },
      rightLowerLeg: { x: -28 * (1 - s) },
      leftUpperArm: { x: 30 * (1 - s), z: 24 * (1 - s) },
      rightUpperArm: { x: 30 * (1 - s), z: -24 * (1 - s) },
      leftLowerArm: { x: 46 * (1 - s) },
      rightLowerArm: { x: 46 * (1 - s) }
    });
  }

  if ((previous === 'crouch' || previous === 'block') && (next === 'punch' || next === 'kick' || next === 'side_kick' || next === 'throw')) {
    Object.assign(patch, {
      pelvis: { x: 10 * (1 - s) + 3 * s, y: -4 * s },
      chest: { x: 8 * (1 - s) + 5 * s, y: next === 'throw' ? -12 * s : -6 * s },
      leftUpperArm: { x: 28 * (1 - s) + 26 * s, z: 22 * (1 - s) + 16 * s },
      rightUpperArm: { x: next === 'throw' ? -28 * s : 38 * s, y: -12 * s, z: -22 * s },
      leftLowerArm: { x: 44 * (1 - s) + 26 * s },
      rightLowerArm: { x: next === 'throw' ? 70 * s : 42 * s },
      leftUpperLeg: { x: -10 * (1 - s) },
      rightUpperLeg: { x: -10 * (1 - s) },
      leftLowerLeg: { x: -24 * (1 - s) - 6 * s },
      rightLowerLeg: { x: -24 * (1 - s) - 6 * s }
    });
  }

  if (previous === 'get_up' && (next === 'punch' || next === 'kick' || next === 'side_kick' || next === 'throw')) {
    Object.assign(patch, {
      pelvis: { x: next === 'throw' ? -2 * s : 3 * s, y: -4 * s },
      chest: { x: next === 'throw' ? -4 * s : 5 * s, y: next === 'throw' ? -12 * s : -6 * s },
      leftUpperArm: { x: next === 'throw' ? 22 * s : 34 * s, y: 8 * s, z: 24 * s },
      rightUpperArm: { x: next === 'throw' ? -30 * s : next === 'punch' ? 42 * s : 28 * s, y: -12 * s, z: -24 * s },
      leftLowerArm: { x: 58 * s },
      rightLowerArm: { x: next === 'throw' ? 72 * s : next === 'punch' ? 48 * s : 38 * s },
      leftLowerLeg: { x: -8 * s },
      rightLowerLeg: { x: -8 * s }
    });
  }

  if (previous === 'fall' && next === 'get_up') {
    Object.assign(patch, {
      pelvis: { x: -16 * (1 - s) },
      chest: { x: 20 * s },
      leftUpperArm: { x: 46 * s, z: 18 * s },
      rightUpperArm: { x: 46 * s, z: -18 * s },
      leftLowerArm: { x: 52 * s },
      rightLowerArm: { x: 52 * s },
      leftUpperLeg: { x: -18 * (1 - s) },
      rightUpperLeg: { x: -18 * (1 - s) },
      leftLowerLeg: { x: -36 * (1 - s) },
      rightLowerLeg: { x: -36 * (1 - s) }
    });
  }

  return patch;
}

function applySequenceTransitionContinuity(
  pose: StandardHumanRigPose,
  transform: PoseTransform,
  sequence: MotionActionSequenceStep[],
  t: number
) {
  if (sequence.length <= 1) return pose;
  let nextPose = pose;
  sequence.forEach((step, index) => {
    const following = sequence[index + 1];
    if (!following) return;
    const boundary = clamp01((step.endRatio + following.startRatio) / 2);
    const window = clampNumber((sequenceStepBlendFade(step) + sequenceStepBlendFade(following)) * 0.55, 0.08, 0.18);
    const distance = Math.abs(t - boundary);
    if (distance > window) return;
    const local = clamp01(1 - distance / Math.max(0.0001, window));
    const smooth = easeCurve('ease_in_out', local);
    const patch = sequenceTransitionPatch(step.actionType, following.actionType, smooth);
    if (!Object.keys(patch).length) return;
    nextPose = blendPose(nextPose, offsetPose(nextPose, patch), 0.42 * smooth);

    if (isLocomotionActionType(step.actionType) && (following.actionType === 'push' || following.actionType === 'pull' || following.actionType === 'reach')) {
      transform.position.y = Number((transform.position.y - 0.012 * smooth).toFixed(4));
    }
    if (isLocomotionActionType(step.actionType) && (following.actionType === 'punch' || following.actionType === 'kick' || following.actionType === 'side_kick' || following.actionType === 'throw')) {
      transform.position.y = Number((transform.position.y - 0.009 * smooth).toFixed(4));
      transform.rotation.y = Number((transform.rotation.y + (following.actionType === 'throw' ? 4.5 : 2.5) * smooth).toFixed(3));
    }
    if (step.actionType === 'turn' && (following.actionType === 'push' || following.actionType === 'pull' || following.actionType === 'reach' || following.actionType === 'throw' || following.actionType === 'punch' || following.actionType === 'kick' || following.actionType === 'side_kick')) {
      transform.rotation.y = Number((transform.rotation.y + (following.actionType === 'push' || following.actionType === 'pull' || following.actionType === 'reach' ? 3.5 : 5.5) * smooth).toFixed(3));
    }
    if ((step.actionType === 'crouch' || step.actionType === 'block') && (following.actionType === 'punch' || following.actionType === 'kick' || following.actionType === 'side_kick' || following.actionType === 'throw')) {
      transform.position.y = Number((transform.position.y - 0.008 * (1 - smooth)).toFixed(4));
    }
  });
  return nextPose;
}

function applySemanticActionSequenceOverlay(
  pose: StandardHumanRigPose,
  transform: PoseTransform,
  transition: PoseTransition,
  t: number,
  profile?: Scene3DJointAxisProfile
) {
  const sequence = transition.actionPlan.semanticPlan?.actionSequence;
  if (!sequence?.length || sequence.length <= 1) {
    return applySemanticActionStageOverlay(pose, transform, transition, t, profile);
  }
  const active = activeSequenceWeights(sequence, t);
  if (!active.length) return pose;

  const baseTransform = clonePoseTransform(transform);
  let blendedPose: StandardHumanRigPose | null = null;
  let blendedTransform: PoseTransform | null = null;
  let totalWeight = 0;

  active.forEach(({ step, weight }) => {
    const localT = stageProgress(t, step.startRatio, step.endRatio);
    const scopedTransition = transitionWithSequenceAction(transition, step);
    const targetTransform = clonePoseTransform(baseTransform);
    const targetPose = applySemanticActionStageOverlay(pose, targetTransform, scopedTransition, semanticActionTime(scopedTransition, localT), profile);
    const mixWeight = totalWeight > 0 ? weight / (totalWeight + weight) : 1;
    blendedPose = blendedPose ? blendPose(blendedPose, targetPose, mixWeight) : targetPose;
    blendedTransform = blendedTransform ? blendPoseTransform(blendedTransform, targetTransform, mixWeight) : targetTransform;
    totalWeight += weight;
  });

  if (!blendedPose || !blendedTransform) return pose;
  const finalWeight = clamp01(totalWeight);
  const finalPose = blendPose(pose, blendedPose, finalWeight);
  const finalTransform = blendPoseTransform(baseTransform, blendedTransform, Math.min(0.88, finalWeight));
  transform.position = finalTransform.position;
  transform.rotation = finalTransform.rotation;
  transform.scale = finalTransform.scale;
  const continuityPose = applySequenceTransitionContinuity(finalPose, transform, sequence, t);
  return profile ? clampPoseWithJointProfile(continuityPose, profile) : continuityPose;
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
  if (/打斗|格斗|近身|出拳|挥拳|拳击|格挡|防守|踢|侧踢|攻击|反击|蓄力|冲击|fight|combat|punch|jab|strike|block|guard|kick|attack|counter/.test(normalized) || plan.rhythm === 'impact') addUniqueFamily(families, 'combat');
  if (plan.stride > 0.03 || plan.direction.x || plan.direction.z || /迈步|走|跑|冲刺|前进|向前|后退|靠近|远离|step|walk|run|dash|forward|backward|retreat|approach|lunge/.test(normalized)) addUniqueFamily(families, 'locomotion');
  if (Math.abs(plan.turn) > 1 || /转身|转向|旋转|回身|回头|turn|rotate|spin|pivot/.test(normalized)) addUniqueFamily(families, 'turn');
  if (plan.roll > 0.08 || /翻滚|滚动|空翻|roll|tumble|somersault|cartwheel|flip/.test(normalized)) addUniqueFamily(families, 'roll');
  if (/摔|倒地|跌倒|绊倒|fall|collapse|drop|trip|knockdown/.test(normalized) || contactSet.has('hip') || contactSet.has('shoulder')) addUniqueFamily(families, 'fall');
  if (/起身|站起|get up|stand up|rise|recover/.test(normalized)) addUniqueFamily(families, 'get_up');
  if (/闪避|躲避|侧闪|下潜|dodge|evade|sidestep|duck|avoid/.test(normalized)) addUniqueFamily(families, 'dodge');
  if (/爬|匍匐|crawl|creep/.test(normalized) || (plan.crouch > 0.7 && contactSet.has('hands'))) addUniqueFamily(families, 'crawl');
  if (/跪|kneel/.test(normalized)) addUniqueFamily(families, 'kneel');
  if (/踉跄|绊倒|stumble|trip|limp/.test(normalized)) addUniqueFamily(families, 'stumble');
  if (/伸手|抓|拿|推|拉|指向|reach|grab|pick|push|pull|point/.test(normalized) || contactSet.has('leftHand') || contactSet.has('rightHand') || contactSet.has('hands')) addUniqueFamily(families, 'reach');
  if (/抱|携带|拿着|carry|hold/.test(normalized)) addUniqueFamily(families, 'carry');
  if (/踢|侧踢|kick/.test(normalized)) addUniqueFamily(families, 'locomotion');
  if (!families.length) addUniqueFamily(families, plan.rhythm === 'perform' ? 'turn' : 'locomotion');
  return families;
}
function universalMotionFamilies(plan: UniversalMotionPlan | undefined, prompt = ''): UniversalMotionFamily[] {
  if (!plan) return [];
  return plan.families?.length ? plan.families : deriveMotionFamiliesFromText(prompt, plan);
}

const MOTION_CONTACT_LABELS: Record<MotionContactHint, string> = {
  leftFoot: '左脚',
  rightFoot: '右脚',
  leftHand: '左手',
  rightHand: '右手',
  head: '头部',
  shoulder: '肩部',
  hip: '髋部',
  feet: '双脚',
  hands: '双手'
};

function universalMotionFootLockStrategy(plan: UniversalMotionPlan | undefined, prompt = '') {
  if (!plan) return 'none' as const;
  const families = universalMotionFamilies(plan, prompt);
  const isLocomotion = families.includes('locomotion') && (plan.stride > 0.08 || plan.rhythm === 'walk' || plan.rhythm === 'run');
  const isDynamic = plan.verticalLift > 0.08
    || plan.roll > 0.08
    || plan.stride > 0.35
    || isLocomotion
    || families.some((family) => ['roll', 'fall', 'get_up', 'dodge', 'crawl', 'kneel', 'stumble'].includes(family));
  return isDynamic ? 'phased' as const : 'stable' as const;
}

function footLockPhaseActive(transition: PoseTransition, limb: 'left' | 'right', t: number) {
  if (!transition.constraints.footLock.enabled) return false;
  if (!transition.constraints.footLock[limb]) return false;
  const actionType = sequenceLocomotionActionType(transition) || transition.actionPlan.semanticPlan?.actionType;
  if (isLocomotionActionType(actionType)) {
    if (!ratioInActionWindow(transition, actionType, t, 0.015)) return false;
    const localT = sequenceActionLocalRatio(transition, actionType, t);
    const motionT = semanticActionTime(transition, localT);
    return gaitFootPlantStrength(
      actionType,
      limb,
      motionT,
      locomotionEffectiveDurationSec(transition, actionType),
      locomotionGaitTempoScale(transition, actionType)
    ) > 0.18;
  }
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
  const directionInfo = semanticDirectionFromPrompt(prompt);
  const direction = { ...directionInfo.direction };
  const action = inferSemanticAction(prompt, templates);
  const speedLabel = promptSpeedLabel(prompt);
  const forceLabel = promptForceLabel(prompt);
  const control = motionControlFromPrompt(prompt, { speedLabel, forceLabel });
  const promptControl = motionPromptControlSummary(prompt, undefined, { speedLabel, forceLabel });
  const isDash = action.type === 'dash';
  const isRun = action.type === 'run' || isDash;
  const isWalk = action.type === 'walk';
  const isPushPull = action.type === 'push' || action.type === 'pull';
  const isThrow = action.type === 'throw';
  const isJump = action.type === 'jump';
  const isRoll = /翻滚|滚动|侧滚|前滚|roll|tumble|somersault|flip/.test(normalized);
  const isFall = action.type === 'fall';
  const isCrouch = action.type === 'crouch';
  const isKick = action.type === 'kick' || action.type === 'side_kick';
  const isCombat = action.family === 'combat';
  const hasStep = isWalk || isRun || isDash || /迈步|靠近|远离|step|walk|run|dash|approach|retreat|lunge/.test(normalized)
    || templates.some((item) => item.id === 'step_forward' || item.id === 'step_back');
  const isPerform = /挥|摆|舞|表演|夸张|展示|wave|swing|perform|dance/.test(normalized);
  const turnSign = /左转|向左转|turn left/.test(normalized) ? -1 : /右转|向右转|turn right/.test(normalized) ? 1 : 0;
  const hasTurn = /转身|转向|旋转|回头|turn|rotate|spin|pivot/.test(normalized) || templates.some((item) => item.id === 'turn_to');
  const turn = isRoll ? (turnSign || 1) * 60 : hasTurn ? (turnSign || 1) * (/半圈|180/.test(normalized) ? 42 : isCombat || isThrow ? 24 : 18) : 0;
  const stride = isRoll
    ? 0.28
    : isDash
      ? 0.46
      : isRun
        ? 0.34
        : isWalk
          ? 0.22
          : isPushPull
            ? 0.12
            : isCombat || isThrow
              ? 0.1
              : direction.x || direction.z
                ? 0.14
                : 0;
  const armSwing = isThrow
    ? 0.62
    : isPushPull
      ? 0.42
      : isCombat
        ? 0.58
        : isPerform
          ? 0.62
          : isRoll
            ? 0.48
            : hasStep
              ? (isRun ? 0.55 : 0.35)
              : 0.14;
  const bodyLean = isRoll || isFall
    ? 0.75
    : isPushPull
      ? 0.48
      : isThrow
        ? 0.42
        : isCombat
          ? 0.38
          : isRun
            ? 0.46
            : hasStep
              ? 0.3
              : hasTurn
                ? 0.18
                : 0.08;
  const controlledCrouch = promptControl.bodyTags.includes('低重心')
    ? Math.max(isRoll || isFall ? 0.9 : isCrouch ? 0.7 : isCombat ? 0.28 : 0, 0.42)
    : isRoll || isFall ? 0.9 : isCrouch ? 0.7 : isCombat ? 0.28 : 0;
  const controlledBodyLean = clampNumber(
    (promptControl.bodyTags.includes('身体前压') ? Math.max(bodyLean, 0.52) : promptControl.bodyTags.includes('身体后仰') ? Math.max(bodyLean, 0.34) : bodyLean)
      * (0.8 + control.forceScale * 0.22),
    0.04,
    0.8
  );
  const controlledContacts = new Set<MotionContactHint>(
    action.type === 'push' || action.type === 'pull'
      ? ['hands', 'feet']
      : isCombat || isThrow || isWalk || isRun || isCrouch
        ? ['feet']
        : []
  );
  if (promptControl.bodyTags.includes('双脚贴地')) controlledContacts.add('feet');
  if (promptControl.bodyTags.includes('双手主导')) {
    controlledContacts.add('hands');
    controlledContacts.add('leftHand');
    controlledContacts.add('rightHand');
  }
  if (promptControl.bodyTags.includes('左手主导')) controlledContacts.add('leftHand');
  if (promptControl.bodyTags.includes('右手主导')) controlledContacts.add('rightHand');
  if (promptControl.bodyTags.includes('看向目标')) controlledContacts.add('head');

  const plan: Omit<UniversalMotionPlan, 'families'> = {
    direction: normalizedDirection(direction.x || direction.z ? direction : isRoll ? vec(0, 0, -1) : direction),
    stride: Number((stride * (isPushPull || isThrow || isCombat ? control.travelScale : 1)).toFixed(4)),
    turn,
    armSwing: clampNumber(armSwing * control.forceScale, 0.08, 0.92),
    bodyLean: controlledBodyLean,
    verticalLift: isJump ? (speedLabel === '快速' ? 0.28 : 0.22) : isKick ? 0.05 : isRoll ? 0.06 : 0,
    crouch: controlledCrouch,
    roll: isRoll ? 1 : 0,
    rhythm: isCombat || isThrow || isFall ? 'impact' : isRoll || isPerform ? 'perform' : isRun ? 'run' : hasStep ? 'walk' : 'subtle',
    contacts: controlledContacts.size ? Array.from(controlledContacts) : undefined
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

function universalFamiliesForSemanticAction(actionType?: MotionSemanticActionType): UniversalMotionFamily[] {
  if (!actionType || actionType === 'unknown') return [];
  if (isLocomotionActionType(actionType)) return ['locomotion'];
  if (actionType === 'turn') return ['turn'];
  if (actionType === 'fall') return ['fall'];
  if (actionType === 'get_up') return ['get_up'];
  if (actionType === 'crawl') return ['crawl'];
  if (actionType === 'punch' || actionType === 'block' || actionType === 'kick' || actionType === 'side_kick') return ['combat'];
  if (actionType === 'push' || actionType === 'pull' || actionType === 'throw' || actionType === 'reach') return ['reach'];
  if (actionType === 'crouch') return ['locomotion'];
  if (actionType === 'jump') return ['locomotion'];
  return [];
}

function uniqueMotionContacts(contacts: MotionContactHint[]) {
  return Array.from(new Set(contacts.filter(Boolean))).slice(0, 12);
}

function semanticContactsAsMotionContacts(plan: MotionSemanticPlan | undefined) {
  return uniqueMotionContacts((plan?.contacts || []).map((item) => item.contact));
}

function actionTypesCompatibleForLocalCompiler(localAction?: MotionSemanticActionType, aiAction?: MotionSemanticActionType) {
  if (!localAction || !aiAction || aiAction === 'unknown' || aiAction === 'idle') return true;
  if (localAction === aiAction) return true;
  if (isLocomotionActionType(localAction) && isLocomotionActionType(aiAction)) return true;
  if ((localAction === 'push' || localAction === 'pull') && (aiAction === 'push' || aiAction === 'pull' || aiAction === 'reach')) return true;
  if ((localAction === 'punch' || localAction === 'block') && (aiAction === 'punch' || aiAction === 'block' || aiAction === 'reach')) return true;
  return false;
}

function promptLocksActionType(prompt: string, actionType?: MotionSemanticActionType) {
  if (!actionType || actionType === 'unknown' || actionType === 'idle') return false;
  const matches = promptActionMatches(prompt);
  return matches.some((match) => match.type === actionType);
}

function motionIntentLocalCompilerContract(transition: PoseTransition, localPlan: PoseTransitionActionPlan) {
  const semanticPlan = localPlan.semanticPlan;
  const actionType = semanticPlan?.actionType;
  const skill = motionActionSkill(actionType);
  const promptLocked = promptLocksActionType(transition.actionPrompt, actionType);
  const fixedPoseConstraints = motionFixedPoseConstraints(transition);
  const middlePoseConstraintCount = fixedPoseConstraints.filter((frame) => frame.role === 'middle').length;
  return {
    actionFamily: semanticPlan?.actionFamily,
    actionType,
    actionLockedByPrompt: promptLocked,
    actionLockReason: promptLocked && actionType
      ? `用户提示词明确匹配“${MOTION_SEMANTIC_TYPE_LABELS[actionType] || actionType}”，AI 只能补充语义细节。`
      : undefined,
    actionSequence: semanticPlan?.actionSequence?.map((step) => ({
      actionType: step.actionType,
      label: step.label,
      startRatio: step.startRatio,
      endRatio: step.endRatio,
      sourceText: step.sourceText
    })) || [],
    actionChains: semanticPlan?.actionChains?.map((chain) => ({
      id: chain.id,
      label: chain.label,
      steps: chain.steps,
      description: chain.description,
      qualityExpectationIds: chain.qualityExpectationIds
    })) || [],
    poseStages: semanticPlan?.poseStages?.map((stage) => ({
      id: stage.id,
      label: stage.label,
      timeRatio: stage.timeRatio,
      poseHint: stage.poseHint,
      rootMotionHint: stage.rootMotionHint,
      contactHint: stage.contactHint
    })) || [],
    contacts: semanticContactsAsMotionContacts(semanticPlan),
    targetObjectId: semanticPlan?.targetObjectId,
    targetObjectName: semanticPlan?.targetObjectName,
    fixedPoseConstraints,
    middlePoseConstraintCount,
    fixedPoseConstraintRule: middlePoseConstraintCount > 0
      ? '起点、终点和所有中间帧都是硬关键姿势约束。AI 必须把动作理解为按时间经过这些姿势，只能解释和补全相邻关键姿势之间的动作阶段。'
      : '起点和终点是硬关键姿势约束。AI 只能解释和补全两者之间的动作阶段。',
    grounded: skill?.grounded,
    allowAirborne: skill?.allowAirborne,
    rootLimits: skill?.rootLimits,
    maxHorizontalOverlay: skill?.maxHorizontalOverlay,
    maxYawOverlay: skill?.maxYawOverlay,
    maxTravel: skill?.maxTravel,
    promptControl: motionPromptControlSummary(transition.actionPrompt, localPlan.universal, semanticPlan),
    qualityExpectations: semanticPlan?.qualityExpectations?.map((item) => ({
      id: item.id,
      label: item.label,
      metric: item.metric,
      minValue: item.minValue,
      maxValue: item.maxValue
    })) || [],
    forbiddenOutputFields: [
      'samples',
      'animationClip',
      'transforms',
      'keyframes',
      'bonePose',
      'boneRotations',
      'jointRotations',
      'rawFrames',
      'constraints'
    ]
  };
}

function rhythmFromPromptControl(summary: ReturnType<typeof motionPromptControlSummary>): MotionIntent['rhythm'] | undefined {
  if (summary.speedLabel === '缓慢') return 'slow';
  if (summary.speedLabel === '快速') return 'fast';
  if (summary.timingTags.includes('突然爆发')) return 'impact';
  if (summary.timingTags.includes('持续保持')) return 'normal';
  return undefined;
}

function intentDirectionConflictsPromptControl(intentDirection: Vec3, promptDirection: Vec3) {
  const normalizedIntent = normalizedDirection(intentDirection);
  const normalizedPrompt = normalizedDirection(promptDirection);
  if (!normalizedPrompt.x && !normalizedPrompt.z) return false;
  if (!normalizedIntent.x && !normalizedIntent.z) return true;
  return normalizedIntent.x * normalizedPrompt.x + normalizedIntent.z * normalizedPrompt.z < 0.35;
}

function constrainMotionIntentForLocalCompiler(
  transition: PoseTransition,
  localPlan: PoseTransitionActionPlan,
  intent: MotionIntent
) {
  const semanticPlan = localPlan.semanticPlan;
  const actionType = semanticPlan?.actionType;
  const skill = motionActionSkill(actionType);
  const constrained: MotionIntent = {
    ...intent,
    direction: normalizedDirection(intent.direction),
    bodyLean: { ...intent.bodyLean },
    contacts: uniqueMotionContacts([...semanticContactsAsMotionContacts(semanticPlan), ...intent.contacts]),
    warnings: [...intent.warnings]
  };
  const notes: string[] = [];
  const tempTransition: PoseTransition = { ...transition, actionPlan: localPlan };
  const allowsAirborne = transitionAllowsAirborneMotion(tempTransition);
  const explicitActionLock = promptLocksActionType(transition.actionPrompt, actionType);
  const promptControl = motionPromptControlSummary(transition.actionPrompt, localPlan.universal, semanticPlan);
  const promptDirection = semanticDirectionFromPrompt(transition.actionPrompt, localPlan.universal).direction;
  const promptRhythm = rhythmFromPromptControl(promptControl);

  if (promptRhythm && constrained.rhythm !== promptRhythm) {
    notes.push(`AI 节奏为“${constrained.rhythm}”，但提示词控制层要求“${promptControl.speedLabel}${promptControl.timingTags.length ? ' / ' + promptControl.timingTags.join('、') : ''}”，已按提示词节奏执行。`);
    constrained.rhythm = promptRhythm;
  }

  if (intentDirectionConflictsPromptControl(constrained.direction, promptDirection)) {
    notes.push(`AI 方向与提示词控制层“${promptControl.directionLabel}”不一致，已按提示词方向执行。`);
    constrained.direction = normalizedDirection(promptDirection);
  }

  if (promptControl.bodyTags.includes('低重心') && constrained.crouch < 0.22) {
    notes.push('提示词要求低重心，已提高本地动作意图的下沉控制。');
    constrained.crouch = Math.max(constrained.crouch, 0.34);
  }
  if (promptControl.bodyTags.includes('身体前压')) {
    constrained.bodyLean = {
      ...constrained.bodyLean,
      x: Math.min(constrained.bodyLean.x || 0, -0.24)
    };
  }
  if (promptControl.bodyTags.includes('身体后仰')) {
    constrained.bodyLean = {
      ...constrained.bodyLean,
      x: Math.max(constrained.bodyLean.x || 0, 0.22)
    };
  }

  if (semanticPlan) {
    const aiChangedLockedAction = explicitActionLock && intent.actionType && intent.actionType !== actionType;
    if (intent.actionType && (aiChangedLockedAction || !actionTypesCompatibleForLocalCompiler(actionType, intent.actionType))) {
      notes.push(`AI 识别为“${MOTION_SEMANTIC_TYPE_LABELS[intent.actionType] || intent.actionType}”，但本地解析为“${MOTION_SEMANTIC_TYPE_LABELS[actionType || 'unknown'] || actionType}”，已按本地动作技能执行。`);
    }
    constrained.actionType = actionType;
    constrained.actionFamily = semanticPlan.actionFamily;
    constrained.targetObjectId = semanticPlan.targetObjectId || constrained.targetObjectId;
    if (semanticPlan.targetObjectId && intent.targetObjectId && intent.targetObjectId !== semanticPlan.targetObjectId) {
      notes.push(`AI 选择的目标对象与本地解析目标不一致，已保留“${semanticPlan.targetObjectName || semanticPlan.targetObjectId}”。`);
    }
  }

  if (skill) {
    if (promptControl.bodyTags.includes('双脚贴地')) {
      constrained.contacts = uniqueMotionContacts([...constrained.contacts, 'feet', 'leftFoot', 'rightFoot']);
    }
    if (promptControl.bodyTags.includes('双手主导')) {
      constrained.contacts = uniqueMotionContacts([...constrained.contacts, 'hands', 'leftHand', 'rightHand']);
    } else if (promptControl.bodyTags.includes('左手主导')) {
      constrained.contacts = uniqueMotionContacts([...constrained.contacts, 'leftHand']);
    } else if (promptControl.bodyTags.includes('右手主导')) {
      constrained.contacts = uniqueMotionContacts([...constrained.contacts, 'rightHand']);
    }

    if (actionType === 'walk' || actionType === 'run' || actionType === 'dash') {
      constrained.contacts = uniqueMotionContacts([...constrained.contacts, 'leftFoot', 'rightFoot', 'feet']);
    }
    if (actionType === 'push' || actionType === 'pull') {
      constrained.contacts = inferPromptHand(transition.actionPrompt) === 'left'
        ? uniqueMotionContacts([...constrained.contacts, 'leftHand', 'feet'])
        : inferPromptHand(transition.actionPrompt) === 'right'
          ? uniqueMotionContacts([...constrained.contacts, 'rightHand', 'feet'])
          : uniqueMotionContacts([...constrained.contacts, 'hands', 'leftHand', 'rightHand', 'feet']);
    }
    if (actionType === 'throw') {
      constrained.contacts = inferPromptHand(transition.actionPrompt) === 'left'
        ? uniqueMotionContacts([...constrained.contacts, 'leftHand', 'feet'])
        : uniqueMotionContacts([...constrained.contacts, 'rightHand', 'feet']);
    }
    if (actionType === 'punch' || actionType === 'block' || actionType === 'kick' || actionType === 'side_kick' || actionType === 'crouch' || actionType === 'turn') {
      constrained.contacts = uniqueMotionContacts([...constrained.contacts, 'feet']);
    }

    if (!allowsAirborne || promptControl.bodyTags.includes('双脚贴地')) {
      if (constrained.verticalLift > skill.rootLimits.maxLift || constrained.roll > 0.12) {
        notes.push('AI 意图包含明显离地或翻滚，但当前本地动作技能不允许离地，已降级为贴地动作。');
      }
      constrained.verticalLift = Math.min(constrained.verticalLift, Math.max(0.02, skill.rootLimits.maxLift));
      constrained.roll = Math.min(constrained.roll, 0.12);
    }

    const maxDistance = isLocomotionActionType(actionType)
      ? Math.min(1.5, skill.maxTravel || 1.5)
      : actionType === 'jump'
        ? Math.min(1.2, skill.maxTravel || 1.2)
        : Math.max(0.04, skill.maxHorizontalOverlay);
    if (constrained.distance > maxDistance) {
      notes.push(`AI 位移幅度超过“${MOTION_SEMANTIC_TYPE_LABELS[actionType || 'unknown'] || actionType}”动作技能范围，已按本地技能降幅。`);
      constrained.distance = maxDistance;
    }

    const maxTurn = actionType === 'turn' ? Math.max(skill.maxYawOverlay, 55) : skill.maxYawOverlay;
    if (Math.abs(constrained.turnDeg) > maxTurn && !promptAllowsExaggeratedMotion(transition.actionPrompt)) {
      notes.push('AI 旋转幅度超过本地动作技能范围，已降低为可控旋转。');
      constrained.turnDeg = clampMotionNumber(constrained.turnDeg, -maxTurn, maxTurn);
    }
  }

  const localFamilies = universalFamiliesForSemanticAction(actionType);
  const aiPlan = motionIntentToUniversalPlan(constrained);
  const aiFamilies = intent.motionFamilies?.length ? intent.motionFamilies : aiPlan.families || [];
  const allowedFamilies = new Set<UniversalMotionFamily>([
    ...localFamilies,
    ...deriveMotionFamiliesFromText(transition.actionPrompt, aiPlan)
  ]);
  if (allowsAirborne) {
    aiFamilies.forEach((family) => allowedFamilies.add(family));
  } else {
    aiFamilies
      .filter((family) => family !== 'roll')
      .forEach((family) => allowedFamilies.add(family));
  }
  const families = Array.from(allowedFamilies);
  if (localFamilies.length && !localFamilies.every((family) => aiFamilies.includes(family))) {
    notes.push('AI 动作族与本地解析不完全一致，已保留用户提示词对应的本地动作族。');
  }
  const blockedFamilies = aiFamilies.filter((family) => !families.includes(family));
  if (blockedFamilies.length) {
    notes.push(`AI 返回了不属于本地动作技能的动作族（${blockedFamilies.join('、')}），已从落地编译中移除。`);
  }

  const universal: UniversalMotionPlan = {
    ...aiPlan,
    direction: promptDirection.x || promptDirection.z ? normalizedDirection(promptDirection) : aiPlan.direction,
    rhythm: promptRhythm === 'slow'
      ? 'subtle'
      : promptRhythm === 'fast'
        ? 'run'
        : promptRhythm === 'impact'
          ? 'impact'
          : aiPlan.rhythm,
    crouch: promptControl.bodyTags.includes('低重心') ? Math.max(aiPlan.crouch, 0.34) : aiPlan.crouch,
    verticalLift: (!allowsAirborne || promptControl.bodyTags.includes('双脚贴地')) && skill
      ? Math.min(aiPlan.verticalLift, skill.rootLimits.maxLift)
      : aiPlan.verticalLift,
    contacts: constrained.contacts,
    targetObjectId: semanticPlan?.targetObjectId || constrained.targetObjectId,
    families
  };

  return {
    intent: { ...constrained, warnings: [...constrained.warnings, ...notes] },
    universal,
    notes
  };
}

function aiSemanticStagesForLocalCompiler(
  transition: PoseTransition,
  localPlan: PoseTransitionActionPlan,
  intent: MotionIntent
) {
  const semanticPlan = localPlan.semanticPlan;
  const localStages = semanticPlan?.poseStages || [];
  const hints = intent.keyframeHints || [];
  if (!hints.length) return [];
  const locked = promptLocksActionType(transition.actionPrompt, semanticPlan?.actionType);
  return hints
    .filter((hint) => {
      if (!locked || !localStages.length) return true;
      return localStages.some((stage) => Math.abs(stage.timeRatio - hint.timeRatio) <= 0.22);
    })
    .slice(0, 6)
    .map((hint, index) => semanticStage(
      `ai_${index}`,
      hint.label,
      hint.timeRatio,
      hint.note || hint.label,
      '由 AI 建议作为语义关键阶段，本地编译器只读取语义，不读取骨骼帧。',
      hint.note || 'AI 关键姿势建议。'
    ));
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
  if (hasFamily('combat')) {
    const guard = pulse(t, 0.05, 0.35);
    const impact = pulse(t, 0.32, 0.72);
    const kickCue = /踢|侧踢|kick/.test(`${plan.lookAt || ''} ${families.join(' ')}`) ? 1 : 0;
    transform.position.z -= (plan.direction.z || -1) * -0.08 * impact;
    transform.rotation.y += (plan.turn ? plan.turn * 0.35 : 12) * impact;
    nextPose = offsetPose(nextPose, {
      pelvis: { x: -8 * guard - 6 * impact, y: 5 * impact, z: -5 * impact },
      chest: { x: -6 * guard - 12 * impact, y: 14 * impact, z: 8 * impact },
      head: { y: 8 * impact, z: 4 * impact },
      leftUpperArm: { x: 32 * guard + 18 * impact, y: -14 * guard - 18 * impact, z: -42 * guard - 34 * impact },
      rightUpperArm: { x: -16 * impact + 34 * guard, y: 24 * impact + 12 * guard, z: 58 * impact + 36 * guard },
      leftLowerArm: { x: 78 * guard + 82 * impact, y: 10 * impact },
      rightLowerArm: { x: 38 * guard - 28 * impact, y: -12 * impact },
      leftUpperLeg: { x: -8 * guard + (kickCue ? -46 : 8) * impact, z: kickCue ? 42 * impact : -4 * impact },
      leftLowerLeg: { x: (kickCue ? 16 : 12) * impact },
      rightUpperLeg: { x: -12 * guard + 18 * impact },
      rightLowerLeg: { x: 26 * guard + 10 * impact }
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

function clampMotionNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clonePoseTransform(transform: PoseTransform): PoseTransform {
  return {
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale }
  };
}

function promptAllowsExaggeratedMotion(prompt: string) {
  return promptAllowsLargePerformance(prompt);
}

const MOTION_ACTION_SKILLS: Partial<Record<MotionSemanticActionType, MotionActionSkill>> = {
  walk: {
    actionType: 'walk',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    gait: { cadenceHz: 0.92, rootBob: 0.01, weightShift: 2.1, footPlant: 0.82, strideDeg: 18, armDeg: 9, leanDeg: 2.5, stanceRatio: 0.64, swingLiftDeg: 9, lateralSway: 0.012 },
    rootLimits: { minDrop: -0.08, maxLift: 0.035 },
    smoothing: { root: 0.18, rotation: 0.22, pose: 0.08 },
    maxHorizontalOverlay: 0.16,
    maxYawOverlay: 18,
    defaultTravelPerSec: 0.3,
    maxTravel: 2.4,
    quality: { maxRootStepDistance: 0.14, maxRootRotationDelta: 26, maxPoseStepDelta: 38, maxRootLift: 0.045, minLegSeparation: 10, minArmSwingSeparation: 10, minSupportSwitchesPerSec: 0.45, minFootContactsPerSec: 1.2, maxFootPlantDrift: 9, maxRootStepJitter: 0.62 }
  },
  run: {
    actionType: 'run',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    gait: { cadenceHz: 1.55, rootBob: 0.018, weightShift: 3.1, footPlant: 0.72, strideDeg: 26, armDeg: 16, leanDeg: 5.5, stanceRatio: 0.48, swingLiftDeg: 17, lateralSway: 0.016 },
    rootLimits: { minDrop: -0.08, maxLift: 0.035 },
    smoothing: { root: 0.18, rotation: 0.22, pose: 0.08 },
    maxHorizontalOverlay: 0.24,
    maxYawOverlay: 18,
    defaultTravelPerSec: 0.5,
    maxTravel: 4.2,
    quality: { maxRootStepDistance: 0.17, maxRootRotationDelta: 28, maxPoseStepDelta: 44, maxRootLift: 0.055, minLegSeparation: 16, minArmSwingSeparation: 19, minSupportSwitchesPerSec: 0.85, minFootContactsPerSec: 1.9, maxFootPlantDrift: 9, maxRootStepJitter: 0.58 }
  },
  dash: {
    actionType: 'dash',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    gait: { cadenceHz: 1.9, rootBob: 0.021, weightShift: 3.6, footPlant: 0.66, strideDeg: 31, armDeg: 20, leanDeg: 8.5, stanceRatio: 0.42, swingLiftDeg: 22, lateralSway: 0.018 },
    rootLimits: { minDrop: -0.08, maxLift: 0.035 },
    smoothing: { root: 0.18, rotation: 0.22, pose: 0.08 },
    maxHorizontalOverlay: 0.24,
    maxYawOverlay: 18,
    defaultTravelPerSec: 0.68,
    maxTravel: 5.2,
    quality: { maxRootStepDistance: 0.19, maxRootRotationDelta: 30, maxPoseStepDelta: 48, maxRootLift: 0.06, minLegSeparation: 19, minArmSwingSeparation: 22, minSupportSwitchesPerSec: 1.05, minFootContactsPerSec: 2.2, maxFootPlantDrift: 10, maxRootStepJitter: 0.56 }
  },
  turn: {
    actionType: 'turn',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.14, maxLift: 0.04 },
    smoothing: { root: 0.26, rotation: 0.24, pose: 0.12 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 55,
    quality: { maxRootStepDistance: 0.12, maxRootRotationDelta: 34, maxPoseStepDelta: 36, maxRootLift: 0.04 }
  },
  crouch: {
    actionType: 'crouch',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.24, maxLift: 0.025 },
    smoothing: { root: 0.16, rotation: 0.16, pose: 0.06 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 18,
    quality: { maxRootStepDistance: 0.1, maxRootRotationDelta: 20, maxPoseStepDelta: 36, maxRootLift: 0.025 }
  },
  jump: {
    actionType: 'jump',
    compileMode: 'semantic_only',
    grounded: false,
    allowAirborne: true,
    rootLimits: { minDrop: -0.14, maxLift: 0.32 },
    smoothing: { root: 0.16, rotation: 0.16, pose: 0.06 },
    maxHorizontalOverlay: 0.18,
    maxYawOverlay: 18,
    defaultTravelPerSec: 0.22,
    maxTravel: 1.4,
    quality: { maxRootStepDistance: 0.2, maxRootRotationDelta: 28, maxPoseStepDelta: 46, maxRootLift: 0.36 }
  },
  push: {
    actionType: 'push',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.09, maxLift: 0.02 },
    smoothing: { root: 0.24, rotation: 0.24, pose: 0.1 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 18,
    quality: { maxRootStepDistance: 0.11, maxRootRotationDelta: 24, maxPoseStepDelta: 38, maxRootLift: 0.03, minPrimaryJointDelta: 14 }
  },
  pull: {
    actionType: 'pull',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.09, maxLift: 0.02 },
    smoothing: { root: 0.24, rotation: 0.24, pose: 0.1 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 18,
    quality: { maxRootStepDistance: 0.11, maxRootRotationDelta: 24, maxPoseStepDelta: 38, maxRootLift: 0.03, minPrimaryJointDelta: 14 }
  },
  throw: {
    actionType: 'throw',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.14, maxLift: 0.04 },
    smoothing: { root: 0.18, rotation: 0.18, pose: 0.06 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 26,
    quality: { maxRootStepDistance: 0.13, maxRootRotationDelta: 28, maxPoseStepDelta: 48, maxRootLift: 0.045, minPrimaryJointDelta: 20 }
  },
  punch: {
    actionType: 'punch',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.14, maxLift: 0.04 },
    smoothing: { root: 0.18, rotation: 0.18, pose: 0.06 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 26,
    quality: { maxRootStepDistance: 0.12, maxRootRotationDelta: 28, maxPoseStepDelta: 44, maxRootLift: 0.04, minPrimaryJointDelta: 18 }
  },
  block: {
    actionType: 'block',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.14, maxLift: 0.04 },
    smoothing: { root: 0.18, rotation: 0.18, pose: 0.06 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 18,
    quality: { maxRootStepDistance: 0.1, maxRootRotationDelta: 22, maxPoseStepDelta: 38, maxRootLift: 0.04, minPrimaryJointDelta: 12 }
  },
  kick: {
    actionType: 'kick',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.1, maxLift: 0.05 },
    smoothing: { root: 0.18, rotation: 0.18, pose: 0.06 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 18,
    quality: { maxRootStepDistance: 0.12, maxRootRotationDelta: 24, maxPoseStepDelta: 48, maxRootLift: 0.05, minPrimaryJointDelta: 16 }
  },
  side_kick: {
    actionType: 'side_kick',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.1, maxLift: 0.05 },
    smoothing: { root: 0.18, rotation: 0.18, pose: 0.06 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 18,
    quality: { maxRootStepDistance: 0.12, maxRootRotationDelta: 24, maxPoseStepDelta: 48, maxRootLift: 0.05, minPrimaryJointDelta: 16 }
  },
  crawl: {
    actionType: 'crawl',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.24, maxLift: 0.025 },
    smoothing: { root: 0.16, rotation: 0.16, pose: 0.06 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 18,
    quality: { maxRootStepDistance: 0.1, maxRootRotationDelta: 18, maxPoseStepDelta: 34, maxRootLift: 0.025 }
  },
  reach: {
    actionType: 'reach',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.14, maxLift: 0.04 },
    smoothing: { root: 0.26, rotation: 0.24, pose: 0.12 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 18,
    quality: { maxRootStepDistance: 0.1, maxRootRotationDelta: 20, maxPoseStepDelta: 34, maxRootLift: 0.04, minPrimaryJointDelta: 12 }
  },
  idle: {
    actionType: 'idle',
    compileMode: 'semantic_only',
    grounded: true,
    allowAirborne: false,
    rootLimits: { minDrop: -0.14, maxLift: 0.04 },
    smoothing: { root: 0.26, rotation: 0.24, pose: 0.12 },
    maxHorizontalOverlay: 0.12,
    maxYawOverlay: 18,
    quality: { maxRootStepDistance: 0.1, maxRootRotationDelta: 20, maxPoseStepDelta: 30, maxRootLift: 0.04 }
  }
};

function motionActionSkill(actionType?: MotionSemanticActionType) {
  return actionType ? MOTION_ACTION_SKILLS[actionType] : undefined;
}

function mergeMotionQualityTargets(targets: MotionSkillQualityTarget[]) {
  const fallback: MotionSkillQualityTarget = {
    maxRootStepDistance: 0.18,
    maxRootRotationDelta: 32,
    maxPoseStepDelta: 52,
    maxRootLift: 0.08
  };
  return targets.reduce((merged, target) => ({
    maxRootStepDistance: Math.min(merged.maxRootStepDistance, target.maxRootStepDistance),
    maxRootRotationDelta: Math.min(merged.maxRootRotationDelta, target.maxRootRotationDelta),
    maxPoseStepDelta: Math.min(merged.maxPoseStepDelta, target.maxPoseStepDelta),
    maxRootLift: Math.min(merged.maxRootLift, target.maxRootLift),
    minLegSeparation: Math.max(merged.minLegSeparation || 0, target.minLegSeparation || 0) || undefined,
    minArmSwingSeparation: Math.max(merged.minArmSwingSeparation || 0, target.minArmSwingSeparation || 0) || undefined,
    minSupportSwitchesPerSec: Math.max(merged.minSupportSwitchesPerSec || 0, target.minSupportSwitchesPerSec || 0) || undefined,
    minFootContactsPerSec: Math.max(merged.minFootContactsPerSec || 0, target.minFootContactsPerSec || 0) || undefined,
    maxFootPlantDrift: target.maxFootPlantDrift !== undefined
      ? Math.min(merged.maxFootPlantDrift ?? target.maxFootPlantDrift, target.maxFootPlantDrift)
      : merged.maxFootPlantDrift,
    maxRootStepJitter: target.maxRootStepJitter !== undefined
      ? Math.min(merged.maxRootStepJitter ?? target.maxRootStepJitter, target.maxRootStepJitter)
      : merged.maxRootStepJitter,
    minPrimaryJointDelta: Math.max(merged.minPrimaryJointDelta || 0, target.minPrimaryJointDelta || 0) || undefined
  }), fallback);
}

function motionQualityTargetForTransition(transition: PoseTransition) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const actionTypes = Array.from(new Set<MotionSemanticActionType>([
    semanticPlan?.actionType,
    ...(semanticPlan?.actionSequence || []).map((step) => step.actionType)
  ].filter((item): item is MotionSemanticActionType => Boolean(item && item !== 'unknown'))));
  const targets = actionTypes
    .map((actionType) => motionActionSkill(actionType)?.quality)
    .filter((target): target is MotionSkillQualityTarget => Boolean(target));
  return mergeMotionQualityTargets(targets);
}

function motionActionSkillSummary(actionType: MotionSemanticActionType): MotionSemanticPlan['actionSkill'] | undefined {
  const skill = motionActionSkill(actionType);
  if (!skill) return undefined;
  const constraints = [
    skill.grounded ? '默认贴地执行' : '',
    skill.allowAirborne ? '允许离地' : '非跳跃不离地',
    skill.gait ? `步态频率 ${skill.gait.cadenceHz.toFixed(2)}Hz` : '',
    `根节点Y范围 ${skill.rootLimits.minDrop.toFixed(2)}~${skill.rootLimits.maxLift.toFixed(2)}`,
    `平滑强度 ${skill.smoothing.root.toFixed(2)}/${skill.smoothing.pose.toFixed(2)}`,
    skill.quality.minLegSeparation ? `腿部交替≥${skill.quality.minLegSeparation}°` : '',
    skill.quality.minPrimaryJointDelta ? `主导肢体≥${skill.quality.minPrimaryJointDelta}°` : ''
  ].filter(Boolean);
  return {
    label: MOTION_SEMANTIC_TYPE_LABELS[actionType] || actionType,
    compileMode: skill.compileMode,
    grounded: skill.grounded,
    allowAirborne: skill.allowAirborne,
    constraints
  };
}

function serializableMotionActionSkills() {
  return Object.values(MOTION_ACTION_SKILLS)
    .filter((skill): skill is MotionActionSkill => Boolean(skill))
    .map((skill) => ({
      actionType: skill.actionType,
      label: MOTION_SEMANTIC_TYPE_LABELS[skill.actionType] || skill.actionType,
      grounded: skill.grounded,
      allowAirborne: skill.allowAirborne,
      rootLimits: skill.rootLimits,
      gait: skill.gait,
      quality: skill.quality
    }));
}

function transitionAllowsAirborneMotion(transition: PoseTransition) {
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  const skill = motionActionSkill(actionType);
  return Boolean(skill?.allowAirborne) || /跳|跃|飞|浮空|离地|jump|leap|airborne|fly/.test(transition.actionPrompt.toLowerCase());
}

function realismJointLimit(key: PoseJointKey, transition: PoseTransition, exaggerated: boolean) {
  if (exaggerated) return 120;
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  const strongLegAction = actionType === 'kick' || actionType === 'side_kick' || actionType === 'crawl' || actionType === 'crouch';
  const strongArmAction = actionType === 'throw' || actionType === 'punch' || actionType === 'block' || actionType === 'push' || actionType === 'pull';
  if (key === 'pelvis' || key === 'chest') return 18;
  if (key === 'neck' || key === 'head') return 14;
  if (key.endsWith('UpperArm')) return strongArmAction ? 48 : 28;
  if (key.endsWith('LowerArm')) return strongArmAction ? 58 : 32;
  if (key.endsWith('Hand')) return 28;
  if (key.endsWith('UpperLeg')) return strongLegAction ? 58 : actionType === 'run' || actionType === 'dash' ? 38 : 28;
  if (key.endsWith('LowerLeg')) return strongLegAction ? 64 : actionType === 'run' || actionType === 'dash' ? 46 : 34;
  if (key.endsWith('Foot')) return 24;
  return 32;
}

function dampPoseOverlayToRealisticRange(basePose: StandardHumanRigPose, pose: StandardHumanRigPose, transition: PoseTransition) {
  const exaggerated = promptAllowsExaggeratedMotion(transition.actionPrompt);
  const next = clonePose(pose);
  for (const key of POSE_KEYS) {
    const limit = realismJointLimit(key, transition, exaggerated);
    next[key] = {
      x: basePose[key].x + clampMotionNumber(next[key].x - basePose[key].x, -limit, limit),
      y: basePose[key].y + clampMotionNumber(next[key].y - basePose[key].y, -limit, limit),
      z: basePose[key].z + clampMotionNumber(next[key].z - basePose[key].z, -limit, limit)
    };
  }
  return next;
}

function applyRealisticMotionGuard(
  basePose: StandardHumanRigPose,
  pose: StandardHumanRigPose,
  transform: PoseTransform,
  baseTransform: PoseTransform,
  transition: PoseTransition
) {
  const exaggerated = promptAllowsExaggeratedMotion(transition.actionPrompt);
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  const airborneAllowed = transitionAllowsAirborneMotion(transition);
  const groundAction = !airborneAllowed && actionType !== 'fall' && actionType !== 'get_up';
  const skill = motionActionSkill(actionType);
  const maxHorizontalOverlay = exaggerated ? 1.2 : skill?.maxHorizontalOverlay ?? 0.12;
  transform.position.x = baseTransform.position.x + clampMotionNumber(transform.position.x - baseTransform.position.x, -maxHorizontalOverlay, maxHorizontalOverlay);
  transform.position.z = baseTransform.position.z + clampMotionNumber(transform.position.z - baseTransform.position.z, -maxHorizontalOverlay, maxHorizontalOverlay);
  if (groundAction) {
    transform.position.y = baseTransform.position.y + clampMotionNumber(transform.position.y - baseTransform.position.y, -0.18, 0.06);
  } else if (!airborneAllowed) {
    transform.position.y = baseTransform.position.y + clampMotionNumber(transform.position.y - baseTransform.position.y, -0.35, 0.08);
  }
  const maxYaw = exaggerated ? 180 : skill?.maxYawOverlay ?? 18;
  transform.rotation.x = baseTransform.rotation.x + clampMotionNumber(transform.rotation.x - baseTransform.rotation.x, -18, 18);
  transform.rotation.y = baseTransform.rotation.y + clampMotionNumber(transform.rotation.y - baseTransform.rotation.y, -maxYaw, maxYaw);
  transform.rotation.z = baseTransform.rotation.z + clampMotionNumber(transform.rotation.z - baseTransform.rotation.z, -18, 18);
  return dampPoseOverlayToRealisticRange(basePose, pose, transition);
}

function groundedMotionActionType(transition: PoseTransition) {
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  if (transitionAllowsAirborneMotion(transition) || actionType === 'fall' || actionType === 'get_up') return false;
  if (transition.actionPlan.semanticPlan?.contacts.some((item) => item.contact === 'feet')) return true;
  return Boolean(actionType && ['walk', 'run', 'dash', 'push', 'pull', 'punch', 'block', 'throw', 'kick', 'side_kick', 'crouch', 'crawl', 'turn', 'reach'].includes(actionType));
}

function isLocomotionActionType(actionType?: MotionSemanticActionType) {
  return actionType === 'walk' || actionType === 'run' || actionType === 'dash';
}

function isBasicMotionActionType(actionType?: MotionSemanticActionType) {
  return motionActionSkill(actionType)?.compileMode === 'semantic_only';
}

function locomotionGaitConfig(actionType?: MotionSemanticActionType) {
  return motionActionSkill(actionType)?.gait || null;
}

function locomotionGaitTempoScale(transition: PoseTransition, actionType?: MotionSemanticActionType) {
  if (!isLocomotionActionType(actionType)) return 1;
  const control = motionControlFromPrompt(transition.actionPrompt, transition.actionPlan.semanticPlan);
  const actionBias = actionType === 'walk'
    ? 0.9
    : actionType === 'dash'
      ? 1.06
      : 1;
  return clampNumber(control.speedScale * actionBias, 0.74, 1.32);
}

function locomotionGaitCycleCount(actionType: MotionSemanticActionType | undefined, durationSec: number, tempoScale = 1) {
  const config = locomotionGaitConfig(actionType);
  if (!config) return 0;
  const naturalCycles = Math.max(0, durationSec) * config.cadenceHz * clampNumber(tempoScale, 0.5, 1.6);
  const minimumCycles = actionType === 'walk' ? 0.78 : actionType === 'run' ? 1.08 : actionType === 'dash' ? 1.22 : 0;
  return Math.max(naturalCycles, minimumCycles);
}

function gaitPhase(actionType: MotionSemanticActionType | undefined, t: number, durationSec: number, limb?: 'left' | 'right', tempoScale = 1) {
  const config = locomotionGaitConfig(actionType);
  if (!config) return 0;
  return (t * locomotionGaitCycleCount(actionType, durationSec, tempoScale) + (limb === 'right' ? 0.5 : 0)) % 1;
}

function gaitFootPlantStrength(actionType: MotionSemanticActionType | undefined, limb: 'left' | 'right', t: number, durationSec = 1, tempoScale = 1) {
  const config = locomotionGaitConfig(actionType);
  if (!config) return 0;
  const phase = gaitPhase(actionType, t, durationSec, limb, tempoScale);
  const stanceRatio = clampNumber(config.stanceRatio, 0.32, 0.72);
  const fadeIn = clampNumber(stanceRatio * 0.16, 0.045, 0.095);
  const fadeOut = clampNumber(stanceRatio * 0.28, 0.09, 0.18);
  if (phase < fadeIn) return ramp(phase, 0, fadeIn) * config.footPlant;
  if (phase < stanceRatio - fadeOut) return config.footPlant;
  if (phase < stanceRatio) return (1 - ramp(phase, stanceRatio - fadeOut, stanceRatio)) * config.footPlant;
  return 0;
}

function locomotionFootPlantEvents(actionType: MotionSemanticActionType | undefined, durationSec: number, tempoScale = 1) {
  const gait = locomotionGaitConfig(actionType);
  if (!gait) return [];
  const events: Array<{ ratio: number; limb: 'leftFoot' | 'rightFoot'; strength: number }> = [];
  const pushEvent = (ratio: number, limb: 'leftFoot' | 'rightFoot', strength: number) => {
    const clampedRatio = clamp01(ratio);
    if (events.some((event) => event.limb === limb && Math.abs(event.ratio - clampedRatio) < 0.035)) return;
    events.push({ ratio: Number(clampedRatio.toFixed(3)), limb, strength: Number(strength.toFixed(3)) });
  };
  const maybePushEvent = (ratio: number, limb: 'leftFoot' | 'rightFoot', strength: number) => {
    if (strength > gait.footPlant * 0.4) pushEvent(ratio, limb, strength);
  };
  const gaitCycles = locomotionGaitCycleCount(actionType, durationSec, tempoScale);
  const steps = Math.max(24, Math.round(gaitCycles * 36));
  (['left', 'right'] as const).forEach((side) => {
    let wasPlanted = false;
    for (let index = 0; index <= steps; index += 1) {
      const ratio = index / steps;
      const strength = gaitFootPlantStrength(actionType, side, ratio, durationSec, tempoScale);
      const planted = strength > gait.footPlant * 0.52;
      if (planted && !wasPlanted) pushEvent(ratio, side === 'left' ? 'leftFoot' : 'rightFoot', strength);
      wasPlanted = planted;
    }
  });
  maybePushEvent(0, 'leftFoot', gaitFootPlantStrength(actionType, 'left', 0, durationSec, tempoScale));
  maybePushEvent(0, 'rightFoot', gaitFootPlantStrength(actionType, 'right', 0, durationSec, tempoScale));
  maybePushEvent(1, 'leftFoot', gaitFootPlantStrength(actionType, 'left', 1, durationSec, tempoScale));
  maybePushEvent(1, 'rightFoot', gaitFootPlantStrength(actionType, 'right', 1, durationSec, tempoScale));
  return events.sort((a, b) => a.ratio === b.ratio ? a.limb.localeCompare(b.limb) : a.ratio - b.ratio);
}

function locomotionFootPlantEventsForWindow(
  actionType: MotionSemanticActionType | undefined,
  durationSec: number,
  startRatio = 0,
  endRatio = 1,
  tempoScale = 1
) {
  const start = clamp01(startRatio);
  const end = clamp01(Math.max(start, endRatio));
  const windowRatio = Math.max(0.001, end - start);
  const windowDuration = Math.max(0.1, durationSec * windowRatio);
  return locomotionFootPlantEvents(actionType, windowDuration, tempoScale).map((event) => ({
    ...event,
    ratio: Number((start + windowRatio * event.ratio).toFixed(3))
  })).filter((event) => event.ratio >= start && event.ratio <= end);
}

function locomotionEnvelope(t: number) {
  return Math.min(ramp(t, 0, 0.16), 1 - ramp(t, 0.86, 1));
}

function locomotionRootProgress(actionType: MotionSemanticActionType | undefined, t: number, motionT: number) {
  const timed = clamp01(motionT);
  const smooth = easeCurve('ease_in_out', t);
  const settleIn = ramp(t, 0, actionType === 'dash' ? 0.1 : 0.14);
  const settleOut = 1 - ramp(t, actionType === 'dash' ? 0.9 : 0.86, 1);
  const natural = actionType === 'walk'
    ? lerp(t, smooth, 0.34)
    : actionType === 'dash'
      ? lerp(t, smooth, 0.2)
      : lerp(t, smooth, 0.28);
  const paced = actionType === 'walk'
    ? lerp(natural, timed, 0.52)
    : actionType === 'dash'
      ? lerp(natural, timed, 0.68)
      : lerp(natural, timed, 0.6);
  const easedPaced = lerp(smooth, paced, settleIn * settleOut + 0.18);
  return clamp01(easedPaced);
}

function planarTravelDirection(transition: PoseTransition, first: AnimationClipSample, last: AnimationClipSample) {
  const travelX = last.transform.position.x - first.transform.position.x;
  const travelZ = last.transform.position.z - first.transform.position.z;
  const travelDistance = Math.hypot(travelX, travelZ);
  if (travelDistance > 0.0001) return vec(travelX / travelDistance, 0, travelZ / travelDistance);
  return normalizedDirection(transition.actionPlan.universal?.direction || vec(0, 0, -1));
}

function locomotionPlanarTargetPosition(
  transition: PoseTransition,
  first: AnimationClipSample,
  last: AnimationClipSample,
  actionType: MotionSemanticActionType | undefined,
  ratio: number,
  motionT: number,
  lateralOffset = 0
) {
  const hasSequenceWindow = Boolean(
    actionType
    && isLocomotionActionType(actionType)
    && transition.actionPlan.semanticPlan?.actionSequence?.some((step) => step.actionType === actionType)
  );
  const localRatio = hasSequenceWindow ? sequenceActionLocalRatio(transition, actionType, ratio) : ratio;
  const progress = locomotionRootProgress(actionType, localRatio, motionT);
  const direction = planarTravelDirection(transition, first, last);
  const perpendicular = vec(-direction.z, 0, direction.x);
  return {
    x: lerp(first.transform.position.x, last.transform.position.x, progress) + perpendicular.x * lateralOffset,
    y: lerp(first.transform.position.y, last.transform.position.y, ratio),
    z: lerp(first.transform.position.z, last.transform.position.z, progress) + perpendicular.z * lateralOffset
  };
}

function gaitLimbSample(actionType: MotionSemanticActionType | undefined, limb: 'left' | 'right', t: number, durationSec: number, tempoScale = 1) {
  const gait = locomotionGaitConfig(actionType);
  if (!gait) return { upperLegX: 0, lowerLegX: 0, footX: 0, swing: 0, plant: 0 };
  const phase = gaitPhase(actionType, t, durationSec, limb, tempoScale);
  const plant = gaitFootPlantStrength(actionType, limb, t, durationSec, tempoScale);
  const stanceRatio = clampNumber(gait.stanceRatio, 0.32, 0.72);
  const stanceT = clamp01(phase / stanceRatio);
  const swingT = clamp01((phase - stanceRatio) / Math.max(0.001, 1 - stanceRatio));
  const swing = phase > stanceRatio ? Math.sin(swingT * Math.PI) : 0;
  const toeOff = stageWindow(phase, Math.max(0, stanceRatio - 0.16), Math.min(1, stanceRatio + 0.05), 0.045);
  const heelStrike = phase < stanceRatio ? Math.max(0, 1 - stanceT) : 0;
  const stanceUpper = lerp(gait.strideDeg * 0.46, -gait.strideDeg * 0.42, easeCurve('ease_in_out', stanceT));
  const swingUpper = lerp(-gait.strideDeg * 0.46, gait.strideDeg * 0.62, easeCurve('ease_in_out', swingT));
  const upperLegX = phase <= stanceRatio ? stanceUpper : swingUpper;
  const lowerLegX = phase <= stanceRatio
    ? Math.max(0, -stanceUpper) * 0.22 + toeOff * gait.swingLiftDeg * 0.18
    : swing * (gait.swingLiftDeg + gait.strideDeg * 0.28);
  const footX = phase <= stanceRatio
    ? -Math.max(0, -stanceUpper) * 0.12 + heelStrike * 2.4 - toeOff * 3.2
    : -swing * clampNumber(gait.swingLiftDeg * 0.22, 3.5, 7.5);
  return { upperLegX, lowerLegX, footX, swing, plant };
}

function locomotionGaitFrame(
  transition: PoseTransition,
  actionType: MotionSemanticActionType,
  t: number,
  forceScale = 1,
  speedScale = 1
) {
  const gait = locomotionGaitConfig(actionType);
  const drive = locomotionEnvelope(t) * forceScale * speedScale;
  const gaitDurationSec = locomotionEffectiveDurationSec(transition, actionType);
  const tempoScale = locomotionGaitTempoScale(transition, actionType);
  const leftStep = gaitLimbSample(actionType, 'left', t, gaitDurationSec, tempoScale);
  const rightStep = gaitLimbSample(actionType, 'right', t, gaitDurationSec, tempoScale);
  const phase = gaitPhase(actionType, t, gaitDurationSec, undefined, tempoScale);
  const counter = Math.sin(phase * Math.PI * 2 + Math.PI);
  const strideBasis = Math.max(8, (gait?.strideDeg || 18) * 1.05);
  const legCounter = clampNumber((rightStep.upperLegX - leftStep.upperLegX) / strideBasis, -1, 1);
  const armCounter = lerp(counter, legCounter, 0.72);
  const arm = gait?.armDeg || 10;
  const lean = gait?.leanDeg || 3;
  const direction = normalizedDirection(transition.actionPlan.universal?.direction || vec(0, 0, -1));
  const lateral = Math.abs(direction.x) > Math.abs(direction.z) ? direction.x : 0;
  const forward = Math.abs(direction.z) >= Math.abs(direction.x) ? (direction.z || -1) : 0;
  const weightShift = clampMotionNumber((rightStep.plant - leftStep.plant) * (gait?.weightShift || 2.2), -(gait?.weightShift || 2.2), gait?.weightShift || 2.2);
  const swingLift = (leftStep.swing + rightStep.swing) * 0.5;
  const supportBias = gait ? clampNumber((rightStep.plant - leftStep.plant) / Math.max(0.001, gait.footPlant), -1, 1) : 0;
  const leftPlant = clamp01(leftStep.plant / Math.max(0.001, gait?.footPlant || 1));
  const rightPlant = clamp01(rightStep.plant / Math.max(0.001, gait?.footPlant || 1));
  const groundedWeight = Math.max(leftPlant, rightPlant);
  const shoulderCounter = armCounter * (actionType === 'walk' ? 0.82 : actionType === 'run' ? 1 : 1.08);
  const gaitPosePatch = {
    pelvis: { x: -lean * drive, y: supportBias * 0.7 * drive, z: weightShift * drive },
    chest: { x: -lean * 0.65 * drive, y: -supportBias * 0.45 * drive, z: -weightShift * 0.45 * drive },
    head: { x: -lean * 0.18 * drive },
    leftUpperLeg: { x: leftStep.upperLegX * drive * (forward ? 1 : 0.45), z: lateral ? leftStep.upperLegX * 0.72 * lateral * drive : 0 },
    rightUpperLeg: { x: rightStep.upperLegX * drive * (forward ? 1 : 0.45), z: lateral ? rightStep.upperLegX * 0.72 * lateral * drive : 0 },
    leftLowerLeg: { x: leftStep.lowerLegX * drive },
    rightLowerLeg: { x: rightStep.lowerLegX * drive },
    leftFoot: { x: leftStep.footX * drive * (1 - leftPlant * 0.38), z: lateral ? -2 * lateral * leftStep.swing * drive : 0 },
    rightFoot: { x: rightStep.footX * drive * (1 - rightPlant * 0.38), z: lateral ? 2 * lateral * rightStep.swing * drive : 0 },
    leftUpperArm: { x: -shoulderCounter * arm * drive, y: -2.5 * supportBias * drive, z: (-5 - lateral * 4) * drive },
    rightUpperArm: { x: shoulderCounter * arm * drive, y: -2.5 * supportBias * drive, z: (5 - lateral * 4) * drive },
    leftLowerArm: { x: Math.max(0, shoulderCounter) * arm * 0.54 * drive + arm * 0.16 * drive },
    rightLowerArm: { x: Math.max(0, -shoulderCounter) * arm * 0.54 * drive + arm * 0.16 * drive }
  } satisfies Partial<Record<PoseJointKey, Partial<RigRotation>>>;
  return {
    drive,
    rootBob: swingLift * (gait?.rootBob || 0.012) * drive * (1 - groundedWeight * 0.28),
    rootLateral: supportBias * (gait?.lateralSway || 0) * drive,
    leftStep,
    rightStep,
    posePatch: composePoseOffsets(gaitPosePatch, locomotionStagePatch(actionType, t, forceScale))
  };
}

function locomotionStagePatch(actionType: MotionSemanticActionType, t: number, forceScale = 1) {
  if (!isLocomotionActionType(actionType)) return {};
  const runLike = actionType === 'run' || actionType === 'dash';
  const dashBoost = actionType === 'dash' ? 1.18 : 1;
  const prep = runLike ? stageWindow(t, 0.02, 0.2, 0.08) : 0;
  const launch = runLike ? stageWindow(t, 0.16, 0.34, 0.08) : stageWindow(t, 0.08, 0.28, 0.1);
  const settle = stageWindow(t, runLike ? 0.76 : 0.82, 0.98, 0.1);
  const prepStrength = prep * forceScale * dashBoost;
  const launchStrength = launch * forceScale * dashBoost;
  const settleStrength = settle * (runLike ? 0.72 : 0.42);
  if (!runLike) {
    return {
      pelvis: { x: -2 * launchStrength + 1.5 * settleStrength },
      chest: { x: -2.5 * launchStrength + 1.2 * settleStrength },
      head: { x: -0.8 * launchStrength }
    } satisfies Partial<Record<PoseJointKey, Partial<RigRotation>>>;
  }
  return {
    pelvis: { x: -8 * prepStrength - 5 * launchStrength + 3 * settleStrength },
    chest: { x: -10 * prepStrength - 6 * launchStrength + 4 * settleStrength },
    head: { x: -3 * prepStrength - 2 * launchStrength + 1.5 * settleStrength },
    leftUpperArm: { x: 18 * prepStrength - 12 * launchStrength + 8 * settleStrength, z: -14 * prepStrength },
    rightUpperArm: { x: -12 * prepStrength + 14 * launchStrength - 8 * settleStrength, z: 14 * prepStrength },
    leftLowerArm: { x: 42 * prepStrength + 18 * launchStrength },
    rightLowerArm: { x: 46 * prepStrength + 18 * launchStrength },
    leftUpperLeg: { x: -18 * prepStrength - 8 * launchStrength + 4 * settleStrength },
    rightUpperLeg: { x: 12 * prepStrength + 10 * launchStrength - 4 * settleStrength },
    leftLowerLeg: { x: 28 * prepStrength + 12 * launchStrength },
    rightLowerLeg: { x: 18 * prepStrength + 10 * launchStrength },
    leftFoot: { x: -5 * prepStrength },
    rightFoot: { x: -3 * prepStrength }
  } satisfies Partial<Record<PoseJointKey, Partial<RigRotation>>>;
}

function locomotionStableBasePose(baselinePose: StandardHumanRigPose, actionType: MotionSemanticActionType | undefined) {
  const standPose = posePresetForId('stand')?.pose;
  if (!standPose || !isLocomotionActionType(actionType)) return clonePose(baselinePose);
  const neutralPull = actionType === 'walk' ? 0.26 : actionType === 'run' ? 0.32 : 0.36;
  return blendPose(baselinePose, standPose, neutralPull);
}

function locomotionBaselineStrength(actionType: MotionSemanticActionType | undefined, correction = false) {
  const base = actionType === 'walk' ? 0.58 : actionType === 'run' ? 0.66 : actionType === 'dash' ? 0.72 : 0.54;
  return correction ? Math.min(0.84, base + 0.12) : base;
}

function shouldCompileBasicMotionWithSemanticLayer(transition: PoseTransition) {
  return isBasicMotionActionType(transition.actionPlan.semanticPlan?.actionType);
}

function semanticMotionUsesRigPose(transition: PoseTransition) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (!semanticPlan) return false;
  if (semanticPlan.actionType && semanticPlan.actionType !== 'idle' && semanticPlan.actionType !== 'unknown') return true;
  return Boolean(semanticPlan.actionSequence?.some((step) => step.actionType !== 'idle' && step.actionType !== 'unknown'));
}

function templateAppliesToBasicMotion(template: PoseTransitionTemplate, transition: PoseTransition) {
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  if (!isBasicMotionActionType(actionType)) return true;
  if (isLocomotionActionType(actionType) && (template.id === 'step_forward' || template.id === 'step_back')) return false;
  if (actionType === 'turn' && template.id === 'turn_to') return false;
  if (['push', 'pull', 'throw', 'punch', 'block', 'kick', 'side_kick', 'reach', 'crawl'].includes(actionType || '')) return false;
  return true;
}

function promptRequestsInPlaceMotion(prompt: string) {
  return /原地|不移动|站在原地|in place|stationary|without moving/.test(prompt.trim().toLowerCase());
}

function sequenceLocomotionActionType(transition: PoseTransition) {
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  if (isLocomotionActionType(actionType)) return actionType;
  return transition.actionPlan.semanticPlan?.actionSequence?.find((step) => isLocomotionActionType(step.actionType))?.actionType;
}

function sequenceActionWindow(transition: PoseTransition, actionType?: MotionSemanticActionType) {
  if (!actionType) return { startRatio: 0, endRatio: 1 };
  const step = transition.actionPlan.semanticPlan?.actionSequence?.find((item) => item.actionType === actionType);
  if (!step) return { startRatio: 0, endRatio: 1 };
  return {
    startRatio: clamp01(step.startRatio),
    endRatio: clamp01(Math.max(step.startRatio, step.endRatio))
  };
}

function sequenceActionLocalRatio(transition: PoseTransition, actionType: MotionSemanticActionType | undefined, ratio: number) {
  const window = sequenceActionWindow(transition, actionType);
  return clamp01((ratio - window.startRatio) / Math.max(0.001, window.endRatio - window.startRatio));
}

function ratioInActionWindow(transition: PoseTransition, actionType: MotionSemanticActionType | undefined, ratio: number, padding = 0) {
  const window = sequenceActionWindow(transition, actionType);
  return ratio >= window.startRatio - padding && ratio <= window.endRatio + padding;
}

function sequenceActionDurationRatio(transition: PoseTransition, actionType?: MotionSemanticActionType) {
  if (!actionType) return 1;
  const window = sequenceActionWindow(transition, actionType);
  return clampNumber(window.endRatio - window.startRatio, 0.12, 1);
}

function locomotionEffectiveDurationSec(transition: PoseTransition, actionType?: MotionSemanticActionType) {
  return Math.max(0.1, transition.durationSec * sequenceActionDurationRatio(transition, actionType));
}

function motionClipSampleRateForTransition(transition: PoseTransition) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const actionType = semanticPlan?.actionType;
  const hasLocomotion = isLocomotionActionType(actionType)
    || Boolean(semanticPlan?.actionSequence?.some((step) => isLocomotionActionType(step.actionType)));
  const hasContact = Boolean(semanticPlan?.contacts.some((item) => (
    item.contact === 'hands'
    || item.contact === 'leftHand'
    || item.contact === 'rightHand'
  ))) || Boolean(semanticPlan?.targetObjectId);
  const hasSequence = Boolean(semanticPlan?.actionSequence && semanticPlan.actionSequence.length > 1);
  const hasCameraMotion = transition.cameraMotion.enabled && transition.cameraMotion.type !== 'none';
  let sampleRate = hasLocomotion ? 36 : hasContact || hasSequence || hasCameraMotion ? 32 : 30;
  if (transition.durationSec > 20) sampleRate = Math.min(sampleRate, 24);
  if (transition.durationSec > 40) sampleRate = Math.min(sampleRate, 20);
  return sampleRate;
}

function motionClipSampleCountForTransition(transition: PoseTransition, durationSec: number) {
  const sampleRate = motionClipSampleRateForTransition(transition);
  let sampleCount = Math.max(3, Math.round(durationSec * sampleRate));
  const locomotionAction = sequenceLocomotionActionType(transition);
  const gait = locomotionGaitConfig(locomotionAction);
  if (gait && isLocomotionActionType(locomotionAction)) {
    const gaitDurationSec = locomotionEffectiveDurationSec(transition, locomotionAction);
    const supportSamples = Math.ceil(locomotionGaitCycleCount(locomotionAction, gaitDurationSec, locomotionGaitTempoScale(transition, locomotionAction)) * 24);
    sampleCount = Math.max(sampleCount, supportSamples);
  }
  return Math.min(sampleCount, 1800);
}

function promptLocomotionTravelDistance(transition: PoseTransition) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || promptRequestsInPlaceMotion(transition.actionPrompt)) return 0;
  const skill = motionActionSkill(actionType);
  if (!skill?.defaultTravelPerSec || !skill.maxTravel) return 0;
  const duration = locomotionEffectiveDurationSec(transition, actionType);
  const control = motionControlFromPrompt(transition.actionPrompt, transition.actionPlan.semanticPlan);
  const travelScale = clampNumber(control.travelScale, 0.68, 1.28);
  return Math.min(skill.maxTravel * travelScale, duration * skill.defaultTravelPerSec * travelScale);
}

function sequenceContactActionType(transition: PoseTransition) {
  const contactActions: MotionSemanticActionType[] = ['push', 'pull', 'throw', 'reach'];
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  if (contactActions.includes(actionType || 'unknown')) return actionType;
  return transition.actionPlan.semanticPlan?.actionSequence?.find((step) => contactActions.includes(step.actionType))?.actionType;
}

function targetApproachStandDistance(actionType?: MotionSemanticActionType) {
  if (actionType === 'throw') return 0.92;
  if (actionType === 'pull') return 0.58;
  if (actionType === 'reach') return 0.52;
  return 0.64;
}

function targetApproachPositionForTransition(transition: PoseTransition, target: { position: Vec3; scale?: Vec3 } | null | undefined) {
  if (!target || !transition.startTransform) return null;
  const start = transition.startTransform.position;
  const contactPoint = contactPositionForObject(target, start);
  const targetVector = vec(contactPoint.x - start.x, 0, contactPoint.z - start.z);
  const targetDirection = normalizedDirection(targetVector);
  const promptDirection = normalizedDirection(transition.actionPlan.universal?.direction || vec());
  const approachDirection = targetDirection.x || targetDirection.z ? targetDirection : promptDirection;
  if (!approachDirection.x && !approachDirection.z) return null;
  const actionType = sequenceContactActionType(transition);
  const standDistance = targetApproachStandDistance(actionType);
  return vec(
    Number((contactPoint.x - approachDirection.x * standDistance).toFixed(4)),
    Number(start.y.toFixed(4)),
    Number((contactPoint.z - approachDirection.z * standDistance).toFixed(4))
  );
}

function transitionWithPromptTargetApproachRootMotion(scene: Scene3DState, transition: PoseTransition) {
  const locomotionAction = sequenceLocomotionActionType(transition);
  const contactAction = sequenceContactActionType(transition);
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (
    !isLocomotionActionType(locomotionAction)
    || !contactAction
    || !semanticPlan?.targetObjectId
    || promptRequestsInPlaceMotion(transition.actionPrompt)
    || transition.keyframes.length
    || !transition.startTransform
    || !transition.endTransform
  ) {
    return transition;
  }
  const existingDistance = Math.hypot(
    transition.endTransform.position.x - transition.startTransform.position.x,
    transition.endTransform.position.z - transition.startTransform.position.z
  );
  if (existingDistance > 0.12) return transition;
  const target = findSceneObject(scene, semanticPlan.targetObjectId);
  const approachPosition = targetApproachPositionForTransition(transition, target);
  if (!approachPosition) return transition;
  const approachDistance = Math.hypot(
    approachPosition.x - transition.startTransform.position.x,
    approachPosition.z - transition.startTransform.position.z
  );
  if (approachDistance < 0.08) return transition;
  const approachDirection = normalizedDirection(vec(
    approachPosition.x - transition.startTransform.position.x,
    0,
    approachPosition.z - transition.startTransform.position.z
  ));
  return {
    ...transition,
    endTransform: {
      ...transition.endTransform,
      position: {
        ...transition.endTransform.position,
        x: approachPosition.x,
        y: transition.endTransform.position.y,
        z: approachPosition.z
      }
    },
    actionPlan: {
      ...transition.actionPlan,
      universal: transition.actionPlan.universal
        ? {
            ...transition.actionPlan.universal,
            direction: approachDirection.x || approachDirection.z ? approachDirection : transition.actionPlan.universal.direction
          }
        : transition.actionPlan.universal,
      notes: [
        ...transition.actionPlan.notes,
        `已根据目标对象为组合动作自动计算接触前站位，距离目标约 ${targetApproachStandDistance(contactAction).toFixed(2)}m。`
      ]
    }
  };
}

function stabilizeTargetApproachSequenceSamples(scene: Scene3DState, transition: PoseTransition, samples: AnimationClipSample[]) {
  const locomotionAction = sequenceLocomotionActionType(transition);
  const contactAction = sequenceContactActionType(transition);
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (
    !isLocomotionActionType(locomotionAction)
    || !contactAction
    || !semanticPlan?.targetObjectId
    || transition.keyframes.length
    || samples.length <= 3
  ) {
    return samples;
  }
  const target = findSceneObject(scene, semanticPlan.targetObjectId);
  const approachPosition = targetApproachPositionForTransition(transition, target);
  if (!approachPosition) return samples;

  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const locomotionWindow = sequenceActionWindow(transition, locomotionAction);
  const contactWindow = sequenceActionWindow(transition, contactAction);
  const first = samples[0];
  const next = samples.map(cloneAnimationSample);
  const startPosition = first.transform.position;
  const travel = vec(approachPosition.x - startPosition.x, 0, approachPosition.z - startPosition.z);
  const travelDistance = Math.hypot(travel.x, travel.z);
  if (travelDistance < 0.04) return samples;
  const direction = vec(travel.x / travelDistance, 0, travel.z / travelDistance);
  const perpendicular = vec(-direction.z, 0, direction.x);

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    if (t < locomotionWindow.startRatio) continue;

    if (t <= locomotionWindow.endRatio + 0.001) {
      const localT = sequenceActionLocalRatio(transition, locomotionAction, t);
      const motionT = semanticActionTime(transition, localT);
      const progress = locomotionRootProgress(locomotionAction, localT, motionT);
      const gaitFrame = locomotionGaitFrame(transition, locomotionAction, motionT);
      const targetPosition = vec(
        startPosition.x + direction.x * travelDistance * progress + perpendicular.x * gaitFrame.rootLateral,
        sample.transform.position.y,
        startPosition.z + direction.z * travelDistance * progress + perpendicular.z * gaitFrame.rootLateral
      );
      sample.transform.position.x = Number(lerp(sample.transform.position.x, targetPosition.x, 0.78).toFixed(4));
      sample.transform.position.z = Number(lerp(sample.transform.position.z, targetPosition.z, 0.78).toFixed(4));
      continue;
    }

    if (t >= contactWindow.startRatio - 0.04) {
      const holdStrength = t <= contactWindow.endRatio + 0.08 ? 0.72 : 0.52;
      sample.transform.position.x = Number(lerp(sample.transform.position.x, approachPosition.x, holdStrength).toFixed(4));
      sample.transform.position.z = Number(lerp(sample.transform.position.z, approachPosition.z, holdStrength).toFixed(4));
    }
  }

  return alignSampleEndpoints(next, transition);
}

function locomotionTravelVector(transition: PoseTransition, samples?: AnimationClipSample[]) {
  const first = samples?.[0]?.transform.position || transition.startTransform?.position || vec();
  const last = samples?.[samples.length - 1]?.transform.position || transition.endTransform?.position || first;
  const delta = vec(last.x - first.x, 0, last.z - first.z);
  const distance = Math.hypot(delta.x, delta.z);
  const semanticDirection = normalizedDirection(transition.actionPlan.universal?.direction || vec());
  const direction = distance > 0.0001
    ? vec(delta.x / distance, 0, delta.z / distance)
    : semanticDirection;
  return { first, last, delta, distance, direction };
}

function promptJumpTravelDistance(transition: PoseTransition) {
  if (transition.actionPlan.semanticPlan?.actionType !== 'jump' || promptRequestsInPlaceMotion(transition.actionPrompt)) return 0;
  const skill = motionActionSkill('jump');
  const direction = normalizedDirection(transition.actionPlan.universal?.direction || vec());
  if (!direction.x && !direction.z) return 0;
  const duration = Math.max(0.1, transition.durationSec);
  return Math.min(skill?.maxTravel || 1.4, duration * (skill?.defaultTravelPerSec || 0.22));
}

function transitionWithPromptLocomotionRootMotion(transition: PoseTransition) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || transition.keyframes.length || !transition.startTransform || !transition.endTransform) return transition;
  const direction = normalizedDirection(transition.actionPlan.universal?.direction || vec());
  if (!direction.x && !direction.z) return transition;
  const existingDistance = Math.hypot(
    transition.endTransform.position.x - transition.startTransform.position.x,
    transition.endTransform.position.z - transition.startTransform.position.z
  );
  if (existingDistance > 0.08) return transition;
  const travelDistance = promptLocomotionTravelDistance(transition);
  if (travelDistance <= 0) return transition;
  return {
    ...transition,
    endTransform: {
      ...transition.endTransform,
      position: {
        ...transition.endTransform.position,
        x: Number((transition.startTransform.position.x + direction.x * travelDistance).toFixed(4)),
        z: Number((transition.startTransform.position.z + direction.z * travelDistance).toFixed(4))
      }
    }
  };
}

function transitionWithPromptJumpRootMotion(transition: PoseTransition) {
  if (transition.actionPlan.semanticPlan?.actionType !== 'jump' || transition.keyframes.length || !transition.startTransform || !transition.endTransform) return transition;
  const direction = normalizedDirection(transition.actionPlan.universal?.direction || vec());
  if (!direction.x && !direction.z) return transition;
  const existingDistance = Math.hypot(
    transition.endTransform.position.x - transition.startTransform.position.x,
    transition.endTransform.position.z - transition.startTransform.position.z
  );
  if (existingDistance > 0.08) return transition;
  const travelDistance = promptJumpTravelDistance(transition);
  if (travelDistance <= 0) return transition;
  return {
    ...transition,
    endTransform: {
      ...transition.endTransform,
      position: {
        ...transition.endTransform.position,
        x: Number((transition.startTransform.position.x + direction.x * travelDistance).toFixed(4)),
        z: Number((transition.startTransform.position.z + direction.z * travelDistance).toFixed(4))
      }
    }
  };
}

function normalizedAngleDelta(degrees: number) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

function promptTurnDegrees(transition: PoseTransition) {
  const prompt = transition.actionPrompt.trim().toLowerCase();
  const universalTurn = transition.actionPlan.universal?.turn || 0;
  const sign = /向左|左转|left/.test(prompt)
    ? -1
    : /向右|右转|right/.test(prompt)
      ? 1
      : universalTurn < 0
        ? -1
        : 1;
  if (/360|一圈|整圈|around/.test(prompt)) return sign * 360;
  if (/90|直角|quarter/.test(prompt)) return sign * 90;
  if (/45|半侧|slight/.test(prompt)) return sign * 45;
  if (/180|转身|回身|背身|half/.test(prompt)) return sign * 180;
  return universalTurn ? universalTurn : sign * 90;
}

function poseDeltaMagnitude(a?: StandardHumanRigPose, b?: StandardHumanRigPose) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return POSE_KEYS.reduce((max, key) => Math.max(max, poseJointDelta(a[key], b[key])), 0);
}

function transitionWithPromptBasicMotionEndpoints(transition: PoseTransition) {
  let next = transitionWithPromptJumpRootMotion(transitionWithPromptLocomotionRootMotion(transition));
  const actionType = next.actionPlan.semanticPlan?.actionType;
  if (!isBasicMotionActionType(actionType) || next.keyframes.length) return next;

  if (actionType === 'turn' && next.startTransform && next.endTransform) {
    const yawDelta = Math.abs(normalizedAngleDelta(next.endTransform.rotation.y - next.startTransform.rotation.y));
    if (yawDelta < 2) {
      next = {
        ...next,
        endTransform: {
          ...next.endTransform,
          rotation: {
            ...next.endTransform.rotation,
            y: Number((next.startTransform.rotation.y + promptTurnDegrees(next)).toFixed(4))
          }
        }
      };
    }
  }

  if (actionType === 'crouch' && next.startPose && next.endPose && poseDeltaMagnitude(next.startPose, next.endPose) < 8) {
    next = {
      ...next,
      endPose: offsetPose(next.startPose, {
        pelvis: { x: -12 },
        chest: { x: 10 },
        head: { x: -4 },
        leftUpperLeg: { x: -44 },
        rightUpperLeg: { x: -44 },
        leftLowerLeg: { x: 54 },
        rightLowerLeg: { x: 54 },
        leftFoot: { x: -8 },
        rightFoot: { x: -8 }
      })
    };
  }

  return next;
}

function groundedRootLimitsForAction(actionType?: MotionSemanticActionType) {
  return motionActionSkill(actionType)?.rootLimits || { minDrop: -0.14, maxLift: 0.04 };
}

function applyGroundedBalanceAndFooting(
  basePose: StandardHumanRigPose,
  pose: StandardHumanRigPose,
  transform: PoseTransform,
  baseTransform: PoseTransform,
  transition: PoseTransition,
  t: number,
  profile?: Scene3DJointAxisProfile
) {
  if (!groundedMotionActionType(transition)) return pose;
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  const limits = groundedRootLimitsForAction(actionType);
  const gait = locomotionGaitConfig(actionType);
  let nextPose = clonePose(pose);
  let rootDeltaY = transform.position.y - baseTransform.position.y;
  if (gait) {
    const gaitDurationSec = locomotionEffectiveDurationSec(transition, actionType);
    const tempoScale = locomotionGaitTempoScale(transition, actionType);
    const wave = Math.sin(gaitPhase(actionType, t, gaitDurationSec, undefined, tempoScale) * Math.PI * 2);
    const footPulse = Math.abs(wave);
    const rootBob = -footPulse * gait.rootBob;
    rootDeltaY = clampMotionNumber(rootDeltaY + rootBob, limits.minDrop, limits.maxLift);
    const shift = wave * gait.weightShift;
    nextPose = offsetPose(nextPose, {
      pelvis: { z: shift },
      chest: { z: -shift * 0.5 },
      head: { z: -shift * 0.18 }
    });
    const leftPlant = gaitFootPlantStrength(actionType, 'left', t, gaitDurationSec, tempoScale);
    const rightPlant = gaitFootPlantStrength(actionType, 'right', t, gaitDurationSec, tempoScale);
    nextPose.leftFoot = slerpRotation(nextPose.leftFoot, basePose.leftFoot, leftPlant);
    nextPose.rightFoot = slerpRotation(nextPose.rightFoot, basePose.rightFoot, rightPlant);
  } else {
    rootDeltaY = clampMotionNumber(rootDeltaY, limits.minDrop, limits.maxLift);
    const bothFeetPlant = actionType === 'push' || actionType === 'pull' || actionType === 'crouch' || actionType === 'block' ? 0.86 : 0.62;
    nextPose.leftFoot = slerpRotation(nextPose.leftFoot, basePose.leftFoot, bothFeetPlant);
    nextPose.rightFoot = slerpRotation(nextPose.rightFoot, basePose.rightFoot, bothFeetPlant);
  }
  transform.position.y = Number((baseTransform.position.y + rootDeltaY).toFixed(4));
  return profile ? clampPoseWithJointProfile(nextPose, profile) : nextPose;
}

function motionPromptHash(input: { actionPrompt: string; durationSec: number; curve?: string; keyframes?: unknown[]; startPose?: unknown; endPose?: unknown; startTransform?: unknown; endTransform?: unknown }) {
  return JSON.stringify({
    prompt: input.actionPrompt.trim(),
    durationSec: Number(input.durationSec || 0).toFixed(2),
    curve: input.curve || 'linear',
    keyframes: Array.isArray(input.keyframes) ? input.keyframes.map((item: any) => ({ id: item.id, timeSec: Number(item.timeSec || 0).toFixed(2), posePresetId: item.posePresetId })) : [],
    hasStart: Boolean(input.startPose && input.startTransform),
    hasEnd: Boolean(input.endPose && input.endTransform)
  });
}



function inferSemanticAction(prompt: string, templates: PoseTransitionTemplate[]): { family: MotionSemanticActionFamily; type: MotionSemanticActionType } {
  const normalized = prompt.trim().toLowerCase();
  const matches = promptActionMatches(normalized);
  const explicitJumpAttack = matches.some((item) => item.type === 'jump') && matches.some((item) => item.type === 'punch');
  if (explicitJumpAttack) return { family: 'jump', type: 'jump' };
  if (promptNeedsImplicitGetUpBeforeAttack(normalized)) {
    const powerAction = promptActionMatchesByPosition(normalized)
      .find((item) => item.type === 'punch' || item.type === 'kick' || item.type === 'side_kick' || item.type === 'throw');
    if (powerAction) return { family: powerAction.family, type: powerAction.type };
  }
  const explicitCrouchDodge = matches.some((item) => item.type === 'crouch') && /躲避|闪避|下潜|duck|evade/.test(normalized);
  if (explicitCrouchDodge) return { family: 'posture', type: 'crouch' };
  const primary = matches[0];
  if (primary) return { family: primary.family, type: primary.type };
  if (templates.some((item) => item.id === 'step_forward' || item.id === 'step_back')) return { family: 'locomotion', type: 'walk' };
  if (templates.some((item) => item.id === 'turn_to')) return { family: 'turn', type: 'turn' };
  return { family: normalized ? 'unknown' : 'posture', type: normalized ? 'unknown' : 'idle' };
}

function semanticDirectionLabel(prompt: string, universal: UniversalMotionPlan) {
  return semanticDirectionFromPrompt(prompt, universal).label;
}

function semanticContactsForAction(actionType: MotionSemanticActionType, prompt: string): MotionSemanticPlan['contacts'] {
  const normalized = prompt.trim().toLowerCase();
  const contacts: MotionSemanticPlan['contacts'] = [];
  const add = (label: string, contact: MotionContactHint, required = true) => contacts.push({ label, contact, required });

  if (['push', 'pull'].includes(actionType)) {
    const limbs = semanticContactLimbsForAction(actionType, prompt);
    add(limbs.length > 1 ? '双手接触目标' : limbs[0] === 'leftHand' ? '左手接触目标' : '右手接触目标', limbs.length > 1 ? 'hands' : limbs[0]);
    add('双脚贴地支撑', 'feet');
  } else if (actionType === 'throw') {
    const limbs = semanticContactLimbsForAction(actionType, prompt);
    add(limbs.length > 1 ? '双手投掷' : limbs[0] === 'leftHand' ? '左手投掷' : '右手投掷', limbs.length > 1 ? 'hands' : limbs[0]);
    add('支撑脚贴地', 'feet');
  } else if (['punch', 'block', 'kick', 'side_kick', 'walk', 'run', 'dash', 'crouch', 'turn'].includes(actionType)) {
    add(actionType === 'kick' || actionType === 'side_kick' ? '支撑脚贴地' : '双脚贴地', 'feet');
  } else if (actionType === 'jump') {
    add('起跳和落地双脚接触地面', 'feet');
  } else if (actionType === 'crawl') {
    add('双手接触地面', 'hands');
    add('膝盖或脚部接触地面', 'feet');
  } else if (actionType === 'fall') {
    add('身体接触地面', 'hip');
  }

  if (/贴地|踩地|脚.*地|ground|floor/.test(normalized) && !contacts.some((item) => item.contact === 'feet')) add('提示词要求脚部贴地', 'feet');
  return contacts.slice(0, 6);
}

function mergeSequenceContacts(sequence: MotionActionSequenceStep[], prompt: string, fallbackActionType: MotionSemanticActionType) {
  const contacts: MotionSemanticPlan['contacts'] = [];
  const pushUnique = (item: MotionSemanticPlan['contacts'][number]) => {
    if (contacts.some((existing) => existing.contact === item.contact && existing.label === item.label)) return;
    contacts.push(item);
  };
  const source = sequence.length ? sequence : [{ actionType: fallbackActionType }] as Array<Pick<MotionActionSequenceStep, 'actionType'>>;
  source.forEach((step) => {
    semanticContactsForAction(step.actionType, prompt).forEach(pushUnique);
  });
  return contacts.slice(0, 10);
}

function motionQualityExpectationPriority(expectation: MotionQualityExpectation) {
  const priorities: Record<string, number> = {
    sequence_order: 100,
    target_approach: 98,
    sequence_bridge: 96,
    approach_contact_bridge: 95,
    hand_contact: 94,
    contact_window: 92,
    turn_throw_bridge: 91,
    throw_release: 90,
    throw_prop_motion: 88,
    low_recovery_attack_bridge: 87,
    prop_contact_motion: 86,
    prompt_both_hands: 84,
    locomotion_gait: 82,
    locomotion_support: 80,
    locomotion_travel: 78,
    locomotion_smoothness: 76,
    locomotion_arm_sync: 74,
    contact_body_drive: 72,
    contact_foot_anchor: 70,
    throw_body_windup: 68,
    punch_extension: 66,
    punch_recovery: 64,
    punch_body_drive: 62,
    prompt_grounded_feet: 60,
    prompt_forward_lean: 58,
    prompt_low_center: 56
  };
  return priorities[expectation.id] ?? (expectation.required ? 40 : 10);
}

function motionQualityExpectationsForPlan(
  prompt: string,
  actionType: MotionSemanticActionType,
  sequence: MotionActionSequenceStep[],
  targetObjectId?: string
): MotionQualityExpectation[] {
  const expectations: MotionQualityExpectation[] = [];
  const pushUnique = (expectation: MotionQualityExpectation) => {
    if (expectations.some((item) => item.id === expectation.id)) return;
    expectations.push(expectation);
  };
  const actionTypes = new Set<MotionSemanticActionType>([
    actionType,
    ...sequence.map((step) => step.actionType)
  ]);
  const hasAction = (...types: MotionSemanticActionType[]) => types.some((type) => actionTypes.has(type));
  const control = motionControlFromPrompt(prompt);
  const promptControl = motionPromptControlSummary(prompt, undefined, { speedLabel: control.speedLabel, forceLabel: control.forceLabel });

  if (promptControl.bodyTags.includes('低重心')) {
    pushUnique({
      id: 'prompt_low_center',
      metric: 'pose',
      label: '低重心控制',
      description: '提示词要求低重心时，需要明显下沉骨盆并弯曲腿部。',
      minValue: 14,
      required: true
    });
  }
  if (promptControl.bodyTags.includes('身体前压')) {
    pushUnique({
      id: 'prompt_forward_lean',
      metric: 'pose',
      label: '身体前压',
      description: '提示词要求身体前压时，躯干和骨盆需要形成明确前倾发力。',
      minValue: 7,
      required: true
    });
  }
  if (promptControl.bodyTags.includes('双脚贴地')) {
    pushUnique({
      id: 'prompt_grounded_feet',
      metric: 'foot_lock',
      label: '双脚贴地',
      description: '提示词要求双脚贴地时，地面动作不能明显离地，并需要脚部接触帧。',
      minValue: 2,
      required: true
    });
  }
  if (promptControl.bodyTags.includes('双手主导')) {
    pushUnique({
      id: 'prompt_both_hands',
      metric: 'contact',
      label: '双手主导',
      description: '提示词要求双手时，左右手都需要参与接触或主要动作轨迹。',
      minValue: 2,
      required: true
    });
  }

  if (hasAction('walk', 'run', 'dash')) {
    pushUnique({
      id: 'locomotion_gait',
      metric: 'pose',
      label: '走跑步态',
      description: '需要左右腿交替、手臂反向摆动和稳定根节点推进。',
      minValue: hasAction('dash') ? 19 : hasAction('run') ? 16 : 10,
      required: true
    });
    pushUnique({
      id: 'locomotion_support',
      metric: 'foot_lock',
      label: '支撑脚交替',
      description: '走跑冲刺需要清晰的左右脚支撑相位，避免滑行。',
      minValue: hasAction('walk') ? 0.42 : hasAction('run') ? 0.32 : 0.28,
      required: true
    });
    pushUnique({
      id: 'locomotion_smoothness',
      metric: 'speed',
      label: '步速平滑',
      description: '根节点推进需要连续稳定，避免忽快忽慢、卡顿或回抽。',
      maxValue: hasAction('walk') ? 0.58 : hasAction('run') ? 0.62 : 0.66,
      required: true
    });
    pushUnique({
      id: 'locomotion_arm_sync',
      metric: 'pose',
      label: '手脚同步',
      description: '走跑冲刺需要手臂反摆与腿部交替同步，接近真人或3D游戏角色步态。',
      minValue: hasAction('walk') ? 0.34 : 0.38,
      required: true
    });
    if (!promptRequestsInPlaceMotion(prompt)) {
      pushUnique({
        id: 'locomotion_travel',
        metric: 'speed',
        label: '根节点位移',
        description: '移动类动作需要根据提示词形成可见的前进距离。',
        minValue: hasAction('walk') ? 0.58 : hasAction('run') ? 0.64 : 0.68,
        required: true
      });
    }
  }

  if (hasAction('push', 'pull', 'reach')) {
    pushUnique({
      id: 'contact_window',
      metric: 'contact',
      label: '接触窗口',
      description: '接触型动作需要持续接触窗口，不能只在单帧瞬间碰到目标。',
      minValue: hasAction('push', 'pull') ? 4 : 2,
      required: true
    });
    pushUnique({
      id: 'hand_contact',
      metric: 'contact',
      label: '手部接触',
      description: '接触型动作需要手部稳定贴近目标点。',
      minValue: control.forceLabel === '轻' ? 0.46 : 0.5,
      required: true
    });
    pushUnique({
      id: 'contact_body_drive',
      metric: 'pose',
      label: '身体发力',
      description: '推拉动作需要躯干、重心和手部协同发力。',
      minValue: control.forceLabel === '强' ? 11 : control.forceLabel === '轻' ? 5.5 : 8,
      required: true
    });
    pushUnique({
      id: 'contact_foot_anchor',
      metric: 'foot_lock',
      label: '脚部支撑',
      description: '推拉接触时脚部需要稳定锁地，不能为了够到目标而脚步漂移。',
      minValue: control.forceLabel === '强' ? 0.48 : 0.42,
      required: true
    });
    if (targetObjectId) {
      pushUnique({
        id: 'prop_contact_motion',
        metric: 'contact',
        label: '目标物体响应',
        description: '被推拉的目标物体需要跟随动作产生对应位移。',
        minValue: control.forceLabel === '强' ? 0.18 : control.forceLabel === '轻' ? 0.08 : 0.12,
        required: true
      });
    }
  }

  if (hasAction('throw')) {
    pushUnique({
      id: 'contact_window',
      metric: 'contact',
      label: '接触窗口',
      description: '投掷需要抓握、蓄力和释放接触事件，不能只生成一个出手点。',
      minValue: 3,
      required: true
    });
    pushUnique({
      id: 'throw_body_windup',
      metric: 'pose',
      label: '投掷蓄力',
      description: '投掷需要先由躯干和肩臂形成蓄力，再进入出手释放。',
      minValue: control.forceLabel === '强' ? 12 : control.forceLabel === '轻' ? 7 : 9,
      required: true
    });
    pushUnique({
      id: 'throw_release',
      metric: 'contact',
      label: '投掷释放',
      description: '投掷动作需要蓄力、出手释放点和飞出轨迹。',
      minValue: control.forceLabel === '强' ? 0.72 : control.forceLabel === '轻' ? 0.48 : 0.62,
      required: true
    });
    if (targetObjectId) {
      pushUnique({
        id: 'throw_prop_motion',
        metric: 'contact',
        label: '投掷物轨迹',
        description: '投掷目标需要在释放后形成明显离手轨迹。',
        minValue: control.forceLabel === '强' ? 0.42 : control.forceLabel === '轻' ? 0.22 : 0.32,
        required: true
      });
    }
  }

  if (hasAction('punch')) {
    pushUnique({
      id: 'punch_extension',
      metric: 'pose',
      label: '出拳伸展',
      description: '出拳需要主手肩臂明确向前发力，不能只有身体晃动。',
      minValue: control.forceLabel === '强' ? 22 : control.forceLabel === '轻' ? 13 : 17,
      required: true
    });
    pushUnique({
      id: 'punch_recovery',
      metric: 'pose',
      label: '出拳回收',
      description: '出拳后需要回收至护架或稳定收势，避免手臂停在抽象位置。',
      minValue: control.forceLabel === '强' ? 0.36 : 0.42,
      required: true
    });
    pushUnique({
      id: 'punch_body_drive',
      metric: 'pose',
      label: '出拳身体协同',
      description: '出拳需要躯干、重心和主手协同发力，形成可读的攻击方向。',
      minValue: control.forceLabel === '强' ? 10 : control.forceLabel === '轻' ? 5 : 7,
      required: true
    });
  }

  if (sequence.length > 1) {
    pushUnique({
      id: 'sequence_order',
      metric: 'sequence',
      label: '动作顺序',
      description: '组合动作需要符合提示词阶段顺序，并在段落边界平滑过渡。',
      required: true
    });
    pushUnique({
      id: 'sequence_bridge',
      metric: 'sequence',
      label: '阶段承接',
      description: '组合动作的相邻阶段需要共享重心、支撑脚和主导肢体，避免突然切换。',
      minValue: 0.68,
      required: true
    });
    if (hasPromptApproachBeforeContact(prompt.trim().toLowerCase())) {
      pushUnique({
        id: 'target_approach',
        metric: 'contact',
        label: '接触前靠近目标',
        description: '跑过去/靠近后再接触目标，不能隔空推拉或攻击。',
        maxValue: 0.55,
        required: true
      });
      if (hasAction('push') || hasAction('pull')) {
        pushUnique({
          id: 'approach_contact_bridge',
          metric: 'sequence',
          label: '靠近后接触承接',
          description: '跑/走/冲到目标后，需要先减速贴近，再进入双手接触和发力阶段。',
          minValue: 0.72,
          required: true
        });
      }
    }
    if (hasPromptTurnBeforeAction(prompt.trim().toLowerCase()) && hasAction('throw')) {
      pushUnique({
        id: 'turn_throw_bridge',
        metric: 'sequence',
        label: '转身投掷承接',
        description: '转身后投掷需要躯干扭转、肩臂蓄力和出手释放连续发生。',
        minValue: 0.72,
        required: true
      });
    }
    if (promptNeedsImplicitGetUpBeforeAttack(prompt.trim().toLowerCase())) {
      pushUnique({
        id: 'low_recovery_attack_bridge',
        metric: 'sequence',
        label: '下沉恢复后攻击',
        description: '蹲下/躲避后攻击需要先从低重心恢复，再进入出拳、踢腿或投掷阶段。',
        minValue: 0.7,
        required: true
      });
    }
  }

  return expectations
    .map((expectation, index) => ({ expectation, index }))
    .sort((a, b) => motionQualityExpectationPriority(b.expectation) - motionQualityExpectationPriority(a.expectation) || a.index - b.index)
    .slice(0, 16)
    .map((item) => item.expectation);
}

function sequencePoseStages(sequence: MotionActionSequenceStep[], fallbackActionType: MotionSemanticActionType) {
  if (!sequence.length) return motionStagesForAction(fallbackActionType);
  const stages = sequence.flatMap((step, index) => {
    const localStages = motionStagesForAction(step.actionType);
    if (!localStages.length) {
      return [semanticStage(step.id, step.label, step.startRatio, step.label, '按动作序列推进', '')];
    }
    return localStages.map((stage) => {
      const localRatio = clamp01(stage.timeRatio);
      return {
        ...stage,
        id: `${step.id}_${stage.id}`,
        label: `${index + 1}. ${step.label}-${stage.label}`,
        timeRatio: Number(lerp(step.startRatio, step.endRatio, localRatio).toFixed(3))
      };
    });
  });
  if (stages.length <= 10) return stages;
  const preserved = new Map<string, MotionSemanticStage>();
  sequence.forEach((step) => {
    const stepStages = stages.filter((stage) => stage.id.startsWith(`${step.id}_`));
    const first = stepStages[0];
    const peak = stepStages[Math.floor(stepStages.length / 2)];
    const last = stepStages[stepStages.length - 1];
    [first, peak, last].filter(Boolean).forEach((stage) => preserved.set(stage.id, stage));
  });
  stages.forEach((stage) => {
    if (preserved.size >= 10) return;
    preserved.set(stage.id, stage);
  });
  return Array.from(preserved.values()).sort((a, b) => a.timeRatio - b.timeRatio).slice(0, 10);
}

function resolvePromptTargetObject(scene: Scene3DState, prompt: string, actionType: MotionSemanticActionType) {
  const normalized = prompt.trim().toLowerCase();
  const named = scene.objects.props.find((item) => prompt.includes(item.name))
    || scene.objects.characters.find((item) => prompt.includes(item.name))
    || scene.objects.cameras.find((item) => prompt.includes(item.name));
  if (named) return named;
  const propAliases = [
    { match: /箱子|盒子|方块|box|cube|crate/, prop: /箱|盒|方块|box|cube|crate/i },
    { match: /球|石头|石块|ball|stone|rock/, prop: /球|石|ball|stone|rock/i },
    { match: /门|墙|板|door|wall|panel/, prop: /门|墙|板|door|wall|panel/i }
  ];
  for (const alias of propAliases) {
    if (!alias.match.test(normalized)) continue;
    const matched = scene.objects.props.find((item) => alias.prop.test(item.name));
    if (matched) return matched;
  }
  if (['push', 'pull', 'throw', 'reach'].includes(actionType) && scene.objects.props.length) {
    const character = scene.objects.characters.find((item) => item.id === scene.selectedObjectId) || scene.objects.characters[0];
    if (!character) return scene.objects.props[0];
    const yawRad = rad(character.rotation.y || 0);
    const forward = normalizedDirection(vec(Math.sin(yawRad), 0, -Math.cos(yawRad)));
    const scored = scene.objects.props
      .map((prop) => {
        const dx = prop.position.x - character.position.x;
        const dz = prop.position.z - character.position.z;
        const distance = Math.hypot(dx, dz);
        const directionScore = distance > 0.001 ? (dx / distance) * forward.x + (dz / distance) * forward.z : 0;
        const forwardBonus = directionScore > 0.15 ? 1.2 : 0;
        return { prop, score: distance - forwardBonus - directionScore * 0.18 };
      })
      .sort((a, b) => a.score - b.score);
    return scored[0]?.prop || scene.objects.props[0];
  }
  return null;
}

function buildLocalMotionSemanticPlan(scene: Scene3DState, prompt: string, universal: UniversalMotionPlan, templates: PoseTransitionTemplate[], durationSec: number, curve: CurveType = 'linear', cameraMotion?: CameraMotionConfig): MotionSemanticPlan {
  const action = inferSemanticAction(prompt, templates);
  const normalized = prompt.trim().toLowerCase();
  const matches = promptActionMatches(prompt);
  const secondaryTypes = matches.map((item) => item.type).filter((type) => type !== action.type);
  const handPreference = inferPromptHand(prompt);
  const promptCamera = cameraMotionFromPrompt(prompt, durationSec, undefined, cameraMotion);
  const targetObject = resolvePromptTargetObject(scene, prompt, action.type);
  const targetRequired = action.type === 'push' || action.type === 'pull' || action.type === 'throw' || action.type === 'reach';
  const actionSkill = motionActionSkillSummary(action.type);
  const speedLabel = promptSpeedLabel(prompt);
  const forceLabel = promptForceLabel(prompt);
  const control = motionControlFromPrompt(prompt, { speedLabel, forceLabel });
  const promptControl = motionPromptControlSummary(prompt, universal, { speedLabel, forceLabel });
  const actionSequence = buildPromptActionSequence(prompt, action.type);
  const actionChains = motionActionChainsForPrompt(prompt, actionSequence);
  const qualityExpectations = motionQualityExpectationsForPlan(prompt, action.type, actionSequence, targetObject?.id);
  const bodyFocus = new Set<string>();
  if (['push', 'pull'].includes(action.type)) ['双手', '躯干', '双脚'].forEach((item) => bodyFocus.add(item));
  if (action.type === 'throw') ['主手', '躯干', '支撑脚'].forEach((item) => bodyFocus.add(item));
  if (['punch', 'block'].includes(action.type)) ['上半身', '手臂', '双脚'].forEach((item) => bodyFocus.add(item));
  if (['kick', 'side_kick', 'walk', 'run', 'dash', 'jump', 'crouch', 'crawl'].includes(action.type)) ['腿部', '重心', '双脚'].forEach((item) => bodyFocus.add(item));
  if (secondaryTypes.includes('punch') || matchesPrompt(prompt, /拳|攻击|打击/)) ['手臂', '上半身'].forEach((item) => bodyFocus.add(item));
  if (secondaryTypes.includes('kick') || secondaryTypes.includes('side_kick')) ['踢腿', '支撑脚'].forEach((item) => bodyFocus.add(item));
  if (handPreference === 'left') bodyFocus.add('左手');
  if (handPreference === 'right') bodyFocus.add('右手');
  if (handPreference === 'both') bodyFocus.add('双手');
  if (/看向|面向|look|face/.test(normalized)) bodyFocus.add('头部');
  const rootMotion = [
    universal.stride > 0 ? '前移 ' + universal.stride.toFixed(2) : '',
    Math.abs(universal.turn) > 1 ? '转身 ' + Math.round(universal.turn) + '度' : '',
    universal.verticalLift > 0 ? '上升 ' + universal.verticalLift.toFixed(2) : '',
    universal.crouch > 0 ? '下沉 ' + universal.crouch.toFixed(2) : '',
    universal.bodyLean > 0 ? '身体前压/倾斜 ' + universal.bodyLean.toFixed(2) : ''
  ].filter(Boolean);
  const explain = [
    '识别为“' + MOTION_SEMANTIC_TYPE_LABELS[action.type] + '”，动作族为“' + MOTION_SEMANTIC_FAMILY_LABELS[action.family] + '”。',
    secondaryTypes.length ? '同时识别到辅助动作：' + secondaryTypes.slice(0, 3).map((type) => MOTION_SEMANTIC_TYPE_LABELS[type]).join('、') + '。' : '',
    motionActionSequenceSummary(actionSequence),
    motionActionChainSummary(actionChains),
    semanticDirectionLabel(prompt, universal) + '，' + (universal.rhythm === 'run' ? '快速节奏' : universal.rhythm === 'impact' ? '冲击节奏' : '常规节奏') + '。',
    semanticTimingExplain(prompt, speedLabel),
    motionPromptControlExplain(promptControl),
    `动作控制：力度 ${forceLabel}，速度 ${speedLabel}，发力倍率 ${control.forceScale.toFixed(2)}，保持倍率 ${control.holdScale.toFixed(2)}，位移倍率 ${control.travelScale.toFixed(2)}。`,
    qualityExpectations.length ? '质量期望：' + qualityExpectations.map((item) => item.label).join('、') + '。' : '',
    actionSkill ? '本地动作技能：' + actionSkill.label + '，' + actionSkill.constraints.join('，') + '。' : '',
    targetObject ? '识别到目标对象：' + targetObject.name + '。' : '',
    promptCamera.matched ? '提示词包含运镜：' + CAMERA_MOTION_LABELS[promptCamera.motion.type] + '。' : cameraMotion?.enabled ? '未识别提示词运镜，将使用下方运镜类型：' + CAMERA_MOTION_LABELS[cameraMotion.type] + '。' : '未识别运镜，默认不加入运镜。'
  ].filter(Boolean);
  return {
    version: 1,
    source: 'local',
    promptHash: motionPromptHash({ actionPrompt: prompt, durationSec, curve, keyframes: [] }),
    actionFamily: action.family,
    actionType: action.type,
    directionLabel: semanticDirectionLabel(prompt, universal),
    speedLabel,
    forceLabel,
    bodyFocus: Array.from(bodyFocus),
    rootMotion,
    poseStages: sequencePoseStages(actionSequence, action.type),
    actionSequence: actionSequence.length ? actionSequence : undefined,
    actionChains: actionChains.length ? actionChains : undefined,
    contacts: mergeSequenceContacts(actionSequence, prompt, action.type),
    qualityExpectations,
    actionSkill,
    cameraIntent: promptCamera.matched
      ? { label: CAMERA_MOTION_LABELS[promptCamera.motion.type], type: promptCamera.motion.type, priority: 'prompt', description: '动作提示词中的运镜优先于下方运镜类型。' }
      : cameraMotion?.enabled && cameraMotion.type !== 'none'
        ? { label: CAMERA_MOTION_LABELS[cameraMotion.type], type: cameraMotion.type, priority: 'manual', description: '提示词没有运镜描写，使用动态属性里的运镜类型。' }
        : undefined,
    targetObjectId: targetObject?.id,
    targetObjectName: targetObject?.name,
    confidence: action.type === 'unknown' ? 0.35 : targetObject || templates.length || action.type !== 'idle' ? Math.min(0.9, 0.72 + matches.length * 0.04) : 0.55,
    explain,
    warnings: [
      action.type === 'unknown' ? '未识别具体动作，请补充动作动词或目标。' : '',
      targetRequired && !targetObject ? '该动作需要可接触目标，但当前场景没有可用道具，将使用角色前方虚拟目标。' : ''
    ].filter(Boolean)
  };
}

function motionPipelineHash(transition: PoseTransition) {
  return motionPromptHash({
    actionPrompt: transition.actionPrompt,
    durationSec: transition.durationSec,
    curve: transition.curve,
    keyframes: transition.keyframes,
    startPose: transition.startPose,
    endPose: transition.endPose,
    startTransform: transition.startTransform,
    endTransform: transition.endTransform
  });
}

function motionPipelineStatus(transition: PoseTransition | null | undefined, motionResolving = false, motionGenerating = false) {
  const currentHash = transition ? motionPipelineHash(transition) : '';
  const semanticPlan = transition?.actionPlan.semanticPlan;
  const localDone = Boolean(semanticPlan);
  const localStale = Boolean(semanticPlan && semanticPlan.promptHash !== currentHash);
  const aiDone = Boolean(transition?.motionIntent && transition.actionPlan.mode === 'motion_intent');
  const generated = Boolean(transition?.animationClip);
  const parseDone = Boolean(localDone && aiDone);
  return {
    hash: currentHash,
    generate: (!transition || !localDone || localStale || !aiDone ? 'blocked' : motionGenerating ? 'running' : transition.error && !generated ? 'failed' : generated ? 'done' : 'ready') as MotionPipelineStepState,
    parse: (!transition ? 'blocked' : motionResolving ? 'running' : localStale ? 'stale' : parseDone ? 'done' : transition.error && !parseDone ? 'failed' : 'ready') as MotionPipelineStepState,
    canResolve: Boolean(transition && !motionResolving),
    canGenerate: Boolean(transition && localDone && !localStale && aiDone && !motionGenerating),
    isGenerated: generated,
    isStale: Boolean(localStale || (transition?.animationClip && transition.motionIntent && transition.actionPlan.semanticPlan?.promptHash !== currentHash))
  };
}

function resolveActionPlan(scene: Scene3DState, prompt: string, options?: { durationSec?: number; curve?: CurveType; cameraMotion?: CameraMotionConfig }): PoseTransitionActionPlan {
  const normalized = prompt.trim().toLowerCase();
  const hand = handForTemplate(prompt);
  const force = promptForceLabel(prompt);
  const speed = promptSpeedLabel(prompt);
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
    notes.push('未填写动作提示词，使用默认动态规划。');
  }
  if (/看向|面向|look at|look|target|camera/.test(normalized)) push('look_at');
  if (/转身|转向|旋转|面向|turn|rotate|face/.test(normalized)) push('turn_to');
  if (/抬手|举手|raise hand|lift hand|hand up|left hand|right hand/.test(normalized)) push('raise_hand', { hand });
  if (/挥手|wave/.test(normalized)) push('wave', { hand });
  if (/指向|point/.test(normalized)) push('point_at', { hand });
  if (/step forward|walk forward|forward/.test(normalized)) push('step_forward');
  if (/step back|backward/.test(normalized)) push('step_back');
  if (/坐下|sit down|sit/.test(normalized)) push('sit_down');
  if (/站起|起身|stand up|stand/.test(normalized)) push('stand_up');
  if (/拿起|抓取|抓住|pick up|grab/.test(normalized)) push('pick_up', { hand });
  if (/放下|释放|release|put down/.test(normalized)) push('put_down', { hand });
  if (/推|推动|推开|push/.test(normalized)) push('point_at', { hand, strength: force === '强' ? 1.18 : force === '轻' ? 0.85 : 1 });
  if (/拉|拉回|拉开|pull/.test(normalized)) push('pick_up', { hand, strength: force === '强' ? 1.15 : force === '轻' ? 0.85 : 1 });
  if (/扔|抛|投掷|甩出|throw|toss/.test(normalized)) push('put_down', { hand, strength: force === '强' ? 1.15 : 1 });
  if (/出拳|挥拳|拳击|攻击|punch|jab|strike|attack/.test(normalized)) push('combat_strike', { hand, strength: speed === '快速' || force === '强' ? 1.12 : 0.95 });
  if (/格挡|防守|block|guard/.test(normalized)) push('combat_block');
  if (/踢|侧踢|kick/.test(normalized)) push('kick', { label: /侧踢|side kick/.test(normalized) ? '侧踢' : TEMPLATE_LABELS.kick });
  if (/打斗|格斗|近身|fight|combat/.test(normalized)) {
    push('combat_strike', { strength: 1.05 });
    push('combat_block', { strength: 0.85 });
  }

  const action = inferSemanticAction(prompt, templates);
  const targetObject = resolvePromptTargetObject(scene, prompt, action.type);
  if (targetObject) {
    templates.forEach((item) => {
      if (item.id === 'point_at' || item.id === 'pick_up' || item.id === 'put_down') item.targetObjectId = targetObject.id;
    });
    notes.push(`识别到目标对象：${targetObject.name}`);
  }
  const universal = deriveUniversalMotionPlan(prompt, templates);
  const mode: PoseTransitionActionPlan['mode'] = templates.length ? 'template_assist' : 'universal';
  if (!templates.length && normalized) {
    notes.push('未命中具体动作模板，使用通用动态规划。');
  }
  const semanticPlan = buildLocalMotionSemanticPlan(scene, prompt, universal, templates, options?.durationSec || 1.2, options?.curve || 'linear', options?.cameraMotion);
  if (semanticPlan.contacts.some((item) => item.contact === 'feet')) {
    universal.contacts = Array.from(new Set([...(universal.contacts || []), 'feet']));
  }
  if (semanticPlan.contacts.some((item) => item.contact === 'hands')) {
    universal.contacts = Array.from(new Set([...(universal.contacts || []), 'hands']));
  }
  if (semanticPlan.targetObjectId) {
    universal.targetObjectId = semanticPlan.targetObjectId;
    templates.forEach((item) => {
      if (!item.targetObjectId && (item.id === 'point_at' || item.id === 'pick_up' || item.id === 'put_down')) item.targetObjectId = semanticPlan.targetObjectId;
    });
  }
  const semanticSkillNotes = !templates.length && normalized && semanticPlan.actionType !== 'unknown' && semanticPlan.actionType !== 'idle'
    ? [`已命中本地动作技能：${MOTION_SEMANTIC_TYPE_LABELS[semanticPlan.actionType] || semanticPlan.actionType}，使用语义动态编译。`]
    : [];
  const planNotes = [...notes, ...semanticSkillNotes, ...semanticPlan.explain, ...semanticPlan.warnings]
    .filter((note) => !(semanticSkillNotes.length && note === '未命中具体动作模板，使用通用动态规划。'));
  return { templates, notes: planNotes, mode, universal, semanticPlan };
}

// SECTION: Dynamic compilation, contact frames, and quality checks
function validateTransition(scene: Scene3DState, transition: PoseTransition) {
  const issues: string[] = [];
  const character = scene.objects.characters.find((item) => item.id === transition.characterId);
  if (!character) issues.push('缺少当前角色');
  if (!transition.startPose || !transition.endPose) issues.push('需要先保存起点和终点姿势');
  if (!transition.startTransform || !transition.endTransform) issues.push('需要先保存起点和终点位置');
  if (!(transition.durationSec > 0)) issues.push('动态时长必须大于 0');
  if (transition.constraints.headLookAt.enabled && transition.constraints.headLookAt.targetMode === 'object') {
    const exists = scene.objects.props.some((item) => item.id === transition.constraints.headLookAt.targetObjectId)
      || scene.objects.characters.some((item) => item.id === transition.constraints.headLookAt.targetObjectId)
      || scene.objects.cameras.some((item) => item.id === transition.constraints.headLookAt.targetObjectId);
    if (!exists) issues.push('头部朝向目标不存在');
  }
  if (transition.constraints.handTarget.enabled && transition.constraints.handTarget.targetMode === 'object') {
    const exists = scene.objects.props.some((item) => item.id === transition.constraints.handTarget.targetObjectId)
      || scene.objects.characters.some((item) => item.id === transition.constraints.handTarget.targetObjectId)
      || scene.objects.cameras.some((item) => item.id === transition.constraints.handTarget.targetObjectId);
    if (!exists) issues.push('手部目标不存在');
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

function contactPositionForObject(object: { position: Vec3; scale?: Vec3 } | null | undefined, origin?: Vec3) {
  if (!object) return vec();
  const height = object.scale?.y || 0.4;
  const surfaceY = object.position.y + Math.max(0.08, height * 0.5);
  if (!origin) return vec(object.position.x, surfaceY, object.position.z);
  const dx = origin.x - object.position.x;
  const dz = origin.z - object.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.001) return vec(object.position.x, surfaceY, object.position.z);
  const radius = Math.max(object.scale?.x || 0.3, object.scale?.z || 0.3) * 0.48;
  return vec(
    Number((object.position.x + (dx / distance) * radius).toFixed(4)),
    Number(surfaceY.toFixed(4)),
    Number((object.position.z + (dz / distance) * radius).toFixed(4))
  );
}

function semanticContactAnchorPosition(
  object: { position: Vec3; scale?: Vec3 } | null | undefined,
  origin?: Vec3,
  actionType?: MotionSemanticActionType
) {
  if (!object) return vec();
  const surface = contactPositionForObject(object, origin);
  const height = Math.max(0.08, object.scale?.y || 0.4);
  const gripRatio = actionType === 'throw'
    ? 0.62
    : actionType === 'pull'
      ? 0.54
      : actionType === 'push'
        ? 0.58
        : 0.56;
  const y = object.position.y + clampNumber(height * gripRatio, 0.1, 1.18);
  return vec(
    surface.x,
    Number(y.toFixed(4)),
    surface.z
  );
}

function cameraFocusTargetPosition(scene: Scene3DState, cameraObject?: CameraObject | null) {
  if (!cameraObject?.focusObjectId) return null;
  const character = scene.objects.characters.find((item) => item.id === cameraObject.focusObjectId);
  if (character) {
    const height = character.model.normalizedHeight || Math.max(1.2, character.scale.y || 1.7);
    return vec(character.position.x, character.position.y + height * 0.62, character.position.z);
  }
  const prop = scene.objects.props.find((item) => item.id === cameraObject.focusObjectId);
  return prop ? contactPositionForObject(prop) : null;
}

function cameraEffectiveTargetPosition(cameraObject?: CameraObject | null) {
  return cameraObject?.targetPosition || vec(0, 1, 0);
}

function cameraFocusPatchForObject(scene: Scene3DState, cameraObject: CameraObject, focusObjectId?: string) {
  if (!focusObjectId) return { focusObjectId: undefined };
  const focusTarget = cameraFocusTargetPosition(scene, { ...cameraObject, focusObjectId });
  if (!focusTarget) return { focusObjectId: undefined };
  const viewOffset = subtractVec3(cameraObject.position, cameraObject.targetPosition);
  return {
    focusObjectId,
    targetPosition: focusTarget,
    position: vec(
      Number((focusTarget.x + viewOffset.x).toFixed(4)),
      Number((focusTarget.y + viewOffset.y).toFixed(4)),
      Number((focusTarget.z + viewOffset.z).toFixed(4))
    )
  };
}

function groundContactPosition(transition: PoseTransition, t: number, lateral = 0, forward = 0) {
  const start = transition.startTransform?.position || vec();
  const end = transition.endTransform?.position || start;
  const base = lerpVec3(start, end, clamp01(t));
  return vec(Number((base.x + lateral).toFixed(4)), Number(start.y.toFixed(4)), Number((base.z + forward).toFixed(4)));
}

function semanticContactLimbsForAction(actionType: MotionSemanticActionType | undefined, prompt: string): Array<'leftHand' | 'rightHand'> {
  const hand = inferPromptHand(prompt);
  if (actionType === 'push' || actionType === 'pull') {
    if (hand === 'left') return ['leftHand'];
    if (hand === 'right') return ['rightHand'];
    return ['leftHand', 'rightHand'];
  }
  if (actionType === 'throw') {
    if (hand === 'both') return ['leftHand', 'rightHand'];
    return [hand === 'left' ? 'leftHand' : 'rightHand'];
  }
  if (hand === 'both') return ['leftHand', 'rightHand'];
  if (hand === 'left') return ['leftHand'];
  return ['rightHand'];
}

function semanticTargetPosition(scene: Scene3DState, transition: PoseTransition, fallbackRatio = 0.45) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const target = findSceneObject(scene, semanticPlan?.targetObjectId);
  if (target) return contactPositionForObject(target);
  const base = groundContactPosition(transition, fallbackRatio, 0, -0.42);
  return vec(base.x, base.y + 0.92, base.z);
}

function releasePositionForThrow(transition: PoseTransition) {
  const start = transition.startTransform?.position || vec();
  const direction = transition.actionPlan.universal?.direction || vec(0, 0, -1);
  const forward = direction.x || direction.z ? direction : vec(0, 0, -1);
  return vec(
    Number((start.x + forward.x * 0.28).toFixed(4)),
    Number((start.y + 1.22).toFixed(4)),
    Number((start.z + forward.z * 0.72).toFixed(4))
  );
}

function transitionTransformAtRatio(transition: PoseTransition, ratio: number): PoseTransform {
  const start = transition.startTransform || { position: vec(), rotation: vec(), scale: vec(1, 1, 1) };
  const end = transition.endTransform || start;
  const t = clamp01(ratio);
  return {
    position: lerpVec3(start.position, end.position, t),
    rotation: slerpRotation(start.rotation, end.rotation, t),
    scale: lerpVec3(start.scale, end.scale, t)
  };
}

function buildContactFrames(scene: Scene3DState, transition: PoseTransition, durationSec: number): AnimationContactFrame[] {
  const frames: AnimationContactFrame[] = [];
  const locomotionContactAction = sequenceLocomotionActionType(transition);
  const hasLocomotionGait = isLocomotionActionType(locomotionContactAction);
  const pushUnique = (frame: AnimationContactFrame) => {
    const key = `${frame.kind}:${frame.limb}:${frame.targetObjectId || ''}:${frame.timeSec.toFixed(2)}`;
    if (frames.some((item) => `${item.kind}:${item.limb}:${item.targetObjectId || ''}:${item.timeSec.toFixed(2)}` === key)) return;
    frames.push(frame);
  };
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (semanticPlan) {
    const sequenceActionTypes = new Set<MotionSemanticActionType>([
      semanticPlan.actionType,
      ...(semanticPlan.actionSequence || []).map((step) => step.actionType)
    ]);
    const sequenceHasAction = (...types: MotionSemanticActionType[]) => types.some((type) => sequenceActionTypes.has(type));
    const actionRatio = (actionType: MotionSemanticActionType, localRatio: number) => {
      const step = semanticPlan.actionSequence?.find((item) => item.actionType === actionType);
      return step ? lerp(step.startRatio, step.endRatio, clamp01(localRatio)) : localRatio;
    };
    const target = findSceneObject(scene, semanticPlan.targetObjectId);
    const targetPosition = target ? semanticContactAnchorPosition(target, transitionTransformAtRatio(transition, 0.45).position, semanticPlan.actionType) : semanticTargetPosition(scene, transition);
    const control = motionControlFromPrompt(transition.actionPrompt, semanticPlan);
    const semanticPositionAt = (timeRatio: number, fallback = targetPosition) => {
      const transformAtTime = transitionTransformAtRatio(transition, timeRatio);
      const actionTypeAtTime = semanticContactActionAtTime(transition, timeRatio) || semanticPlan.actionType;
      return semanticHandTargetSample(scene, transition, transformAtTime, timeRatio)?.position
        || (target ? semanticContactAnchorPosition(target, transformAtTime.position, actionTypeAtTime) : fallback);
    };
    const addHandReach = (timeRatio: number, limb: 'leftHand' | 'rightHand', note: string, kind: AnimationContactFrame['kind'] = 'reach', position = targetPosition) => {
      const transformAtTime = transitionTransformAtRatio(transition, timeRatio);
      const actionTypeAtTime = semanticContactActionAtTime(transition, timeRatio) || semanticPlan.actionType;
      const contactForward = semanticContactForwardDirection(scene, transition, transformAtTime.position, timeRatio, actionTypeAtTime);
      pushUnique({
        timeSec: Number((durationSec * timeRatio).toFixed(3)),
        kind,
        targetObjectId: semanticPlan.targetObjectId,
        limb,
        position: contactTargetForHand(position, contactForward, limb, semanticContactHandWidth(scene, transition, actionTypeAtTime)),
        note
      });
    };
    const addFootLock = (timeRatio: number, limb: 'leftFoot' | 'rightFoot', note: string) => {
      const lateral = limb === 'leftFoot' ? -0.08 : 0.08;
      pushUnique({
        timeSec: Number((durationSec * clamp01(timeRatio)).toFixed(3)),
        kind: 'foot_lock',
        limb,
        position: groundContactPosition(transition, timeRatio, lateral, 0),
        note
      });
    };
    if (semanticPlan.contacts.some((item) => item.contact === 'feet')) {
      const locomotionActionType = sequenceLocomotionActionType(transition);
      const gait = locomotionGaitConfig(locomotionActionType);
      if (gait) {
        const locomotionStep = semanticPlan.actionSequence?.find((step) => step.actionType === locomotionActionType);
        const startRatio = locomotionStep ? locomotionStep.startRatio : 0;
        const endRatio = locomotionStep ? locomotionStep.endRatio : 1;
        locomotionFootPlantEventsForWindow(
          locomotionActionType,
          durationSec,
          startRatio,
          endRatio,
          locomotionGaitTempoScale(transition, locomotionActionType)
        ).forEach((event) => {
          addFootLock(event.ratio, event.limb, `${event.limb === 'leftFoot' ? '左脚' : '右脚'}步态相位落地点`);
        });
        if (endRatio < 1 && (semanticPlan.actionType === 'push' || semanticPlan.actionType === 'pull' || sequenceHasAction('push', 'pull', 'throw', 'punch', 'block'))) {
          [endRatio, lerp(endRatio, 1, 0.42), lerp(endRatio, 1, 0.78)].forEach((ratio) => {
            addFootLock(ratio, 'leftFoot', '移动后左脚稳定支撑');
            addFootLock(ratio, 'rightFoot', '移动后右脚稳定支撑');
          });
        }
      } else {
        addFootLock(0, 'leftFoot', '语义计划锁定左脚贴地');
        addFootLock(0, 'rightFoot', '语义计划锁定右脚贴地');
        if (semanticPlan.actionType === 'push' || semanticPlan.actionType === 'pull' || semanticPlan.actionType === 'crouch' || semanticPlan.actionType === 'block') {
          [0.32, 0.62, 0.86].forEach((ratio) => {
            addFootLock(ratio, 'leftFoot', '地面动作左脚稳定支撑');
            addFootLock(ratio, 'rightFoot', '地面动作右脚稳定支撑');
          });
        }
        addFootLock(1, 'leftFoot', '语义计划在结束时保持左脚贴地');
        addFootLock(1, 'rightFoot', '语义计划在结束时保持右脚贴地');
      }
    }
    if (sequenceHasAction('push')) {
      const limbs = semanticContactLimbsForAction('push', transition.actionPrompt);
      limbs.forEach((limb) => {
        const braceRatio = actionRatio('push', control.speedLabel === '快速' ? 0.14 : 0.18);
        const reachRatio = actionRatio('push', control.speedLabel === '快速' ? 0.24 : 0.28);
        const contactRatio = actionRatio('push', control.burst ? 0.42 : 0.46);
        const driveRatio = actionRatio('push', control.sustained ? 0.74 : 0.68);
        const holdRatio = actionRatio('push', control.sustained ? 0.92 : 0.86);
        addHandReach(braceRatio, limb, `${MOTION_CONTACT_LABELS[limb]}预备贴近目标`, 'reach', semanticPositionAt(braceRatio));
        addHandReach(reachRatio, limb, `${MOTION_CONTACT_LABELS[limb]}准备推向目标`, 'reach', semanticPositionAt(reachRatio));
        addHandReach(contactRatio, limb, `${MOTION_CONTACT_LABELS[limb]}接触并推动目标`, 'grasp', semanticPositionAt(contactRatio));
        addHandReach(driveRatio, limb, `${MOTION_CONTACT_LABELS[limb]}持续发力推动目标`, 'grasp', semanticPositionAt(driveRatio));
        addHandReach(holdRatio, limb, `${MOTION_CONTACT_LABELS[limb]}保持推力`, 'grasp', semanticPositionAt(holdRatio));
      });
    } else if (sequenceHasAction('pull')) {
      const limbs = semanticContactLimbsForAction('pull', transition.actionPrompt);
      const reachRatio = actionRatio('pull', control.speedLabel === '快速' ? 0.14 : 0.18);
      const graspRatio = actionRatio('pull', control.burst ? 0.32 : 0.36);
      const pullRatio = actionRatio('pull', control.sustained ? 0.7 : 0.62);
      const releaseRatio = actionRatio('pull', control.sustained ? 0.94 : 0.88);
      limbs.forEach((limb) => {
        addHandReach(reachRatio, limb, `${MOTION_CONTACT_LABELS[limb]}伸向目标`, 'reach', semanticPositionAt(reachRatio));
        addHandReach(graspRatio, limb, `${MOTION_CONTACT_LABELS[limb]}抓住目标`, 'grasp', semanticPositionAt(graspRatio));
        addHandReach(pullRatio, limb, `${MOTION_CONTACT_LABELS[limb]}保持抓握并回拉目标`, 'grasp', semanticPositionAt(pullRatio));
        addHandReach(releaseRatio, limb, `${MOTION_CONTACT_LABELS[limb]}拉回后释放目标`, 'release', semanticPositionAt(releaseRatio));
      });
    } else if (sequenceHasAction('throw')) {
      const limbs = semanticContactLimbsForAction('throw', transition.actionPrompt);
      const graspRatio = actionRatio('throw', 0);
      const windupRatio = actionRatio('throw', control.burst ? 0.38 : 0.34);
      const driveRatio = actionRatio('throw', control.burst ? 0.54 : 0.5);
      const releaseRatio = actionRatio('throw', control.speedLabel === '缓慢' ? 0.72 : 0.62);
      limbs.forEach((limb) => {
        addHandReach(graspRatio, limb, `${MOTION_CONTACT_LABELS[limb]}握住投掷目标`, 'grasp', semanticPositionAt(graspRatio));
        addHandReach(windupRatio, limb, `${MOTION_CONTACT_LABELS[limb]}带动目标蓄力`, 'grasp', semanticPositionAt(windupRatio));
        addHandReach(driveRatio, limb, `${MOTION_CONTACT_LABELS[limb]}向前加速带出目标`, 'grasp', semanticPositionAt(driveRatio));
        addHandReach(releaseRatio, limb, `${MOTION_CONTACT_LABELS[limb]}投掷出手释放点`, 'release', semanticPositionAt(releaseRatio, releasePositionForThrow(transition)));
      });
    } else {
      if (semanticPlan.contacts.some((item) => item.contact === 'hands' || item.contact === 'leftHand')) {
        addHandReach(0.45, 'leftHand', '语义计划要求左手接触目标');
      }
      if (semanticPlan.contacts.some((item) => item.contact === 'hands' || item.contact === 'rightHand')) {
        addHandReach(0.45, 'rightHand', '语义计划要求右手接触目标');
      }
    }
  }
  for (const template of transition.actionPlan.templates) {
    const target = findSceneObject(scene, template.targetObjectId || transition.constraints.handTarget.targetObjectId);
    const hand = template.hand || transition.constraints.handTarget.hand || 'right';
    const limb = hand === 'left' ? 'leftHand' : 'rightHand';
    const targetPosition = contactPositionForObject(target, transitionTransformAtRatio(transition, 0.5).position);
    if (template.id === 'point_at') {
      pushUnique({
        timeSec: Number((durationSec * 0.55).toFixed(3)),
        kind: 'reach',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}指向目标`
      });
    }
    if (template.id === 'pick_up') {
      pushUnique({
        timeSec: Number((durationSec * 0.38).toFixed(3)),
        kind: 'reach',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}伸向目标`
      });
      pushUnique({
        timeSec: Number((durationSec * 0.55).toFixed(3)),
        kind: 'grasp',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}抓住目标`
      });
    }
    if (template.id === 'put_down') {
      pushUnique({
        timeSec: 0,
        kind: 'grasp',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}在起点握住目标`
      });
      pushUnique({
        timeSec: Number((durationSec * 0.45).toFixed(3)),
        kind: 'reach',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}带动目标移动`
      });
      pushUnique({
        timeSec: Number((durationSec * 0.78).toFixed(3)),
        kind: 'release',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}释放目标`
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
    if (!hasLocomotionGait && (hasFamily('kneel') || contacts.has('leftFoot') || contacts.has('rightFoot') || contacts.has('feet') || contacts.has('hip') || contacts.has('shoulder'))) {
      pushSupport(0.3, 'leftFoot', '左脚支撑接触', -0.14, 0.06);
      pushSupport(0.3, 'rightFoot', '右脚支撑接触', 0.14, 0.06);
    }
  }
  if (transition.constraints.footLock.enabled && !hasLocomotionGait) {
    const start = transition.startTransform?.position || vec();
    if (transition.constraints.footLock.left) {
      pushUnique({
        timeSec: 0,
        kind: 'foot_lock',
        limb: 'leftFoot',
        position: vec(start.x - 0.12, start.y, start.z),
        note: '左脚接触阶段'
      });
    }
    if (transition.constraints.footLock.right) {
      pushUnique({
        timeSec: 0,
        kind: 'foot_lock',
        limb: 'rightFoot',
        position: vec(start.x + 0.12, start.y, start.z),
        note: '右脚接触阶段'
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
  profile?: Scene3DJointAxisProfile,
  cameraSamples?: CameraMotionSample[]
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
    contacts,
    cameraSamples
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

function sampleAnimationSamplesAtTime(samples: AnimationClipSample[], timeSec: number) {
  if (!samples.length) return null;
  if (timeSec <= samples[0].timeSec) return samples[0];
  if (timeSec >= samples[samples.length - 1].timeSec) return samples[samples.length - 1];
  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];
    if (timeSec >= current.timeSec && timeSec <= next.timeSec) return sampleBetween(current, next, timeSec);
  }
  return samples[samples.length - 1];
}

function sampleCameraMotionAtTime(samples: CameraMotionSample[], timeSec: number): CameraMotionSample | undefined {
  if (!samples.length) return undefined;
  if (timeSec <= samples[0].timeSec) return samples[0];
  if (timeSec >= samples[samples.length - 1].timeSec) return samples[samples.length - 1];
  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];
    if (timeSec >= current.timeSec && timeSec <= next.timeSec) {
      const t = clamp01((timeSec - current.timeSec) / Math.max(0.0001, next.timeSec - current.timeSec));
      return {
        timeSec,
        position: lerpVec3(current.position, next.position, t),
        targetPosition: lerpVec3(current.targetPosition, next.targetPosition, t),
        fov: current.fov !== undefined && next.fov !== undefined ? current.fov + (next.fov - current.fov) * t : current.fov ?? next.fov
      };
    }
  }
  return samples[samples.length - 1];
}

function cloneAnimationSample(sample: AnimationClipSample): AnimationClipSample {
  return {
    timeSec: sample.timeSec,
    transform: clonePoseTransform(sample.transform),
    pose: clonePose(sample.pose),
    bonePose: cloneBonePose(sample.bonePose),
    fingerPose: cloneFingerPose(sample.fingerPose),
    toePose: cloneToePose(sample.toePose),
    libTvJointAngles: cloneLibTvJointAngles(sample.libTvJointAngles)
  };
}

function blendVec3(current: Vec3, target: Vec3, strength: number): Vec3 {
  return lerpVec3(current, target, clamp01(strength));
}

function blendPose(current: StandardHumanRigPose, target: StandardHumanRigPose, strength: number): StandardHumanRigPose {
  const pose = clonePose(current);
  const clampedStrength = clamp01(strength);
  for (const key of POSE_KEYS) pose[key] = slerpRotation(current[key], target[key], clampedStrength);
  return pose;
}

function blendPoseTransform(current: PoseTransform, target: PoseTransform, strength: number): PoseTransform {
  const clampedStrength = clamp01(strength);
  return {
    position: blendVec3(current.position, target.position, clampedStrength),
    rotation: slerpRotation(current.rotation, target.rotation, clampedStrength),
    scale: blendVec3(current.scale, target.scale, clampedStrength)
  };
}

function smoothRotationSample(previous: RigRotation, current: RigRotation, next: RigRotation, strength: number) {
  const midpoint = slerpRotation(previous, next, 0.5);
  return slerpRotation(current, midpoint, clamp01(strength));
}

function averageVec3(previous: Vec3, next: Vec3): Vec3 {
  return {
    x: (previous.x + next.x) / 2,
    y: (previous.y + next.y) / 2,
    z: (previous.z + next.z) / 2
  };
}

function motionSmoothingStrength(transition: PoseTransition) {
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  return motionActionSkill(actionType)?.smoothing || { root: 0.26, rotation: 0.24, pose: 0.12 };
}

function shouldPreserveJointDuringSmoothing(transition: PoseTransition, joint: PoseJointKey, sample: AnimationClipSample) {
  if (joint !== 'leftFoot' && joint !== 'rightFoot') return false;
  const limb = joint === 'leftFoot' ? 'left' : 'right';
  const t = transition.durationSec > 0 ? sample.timeSec / transition.durationSec : 0;
  return footLockPhaseActive(transition, limb, t);
}

function smoothMotionSamples(transition: PoseTransition, samples: AnimationClipSample[]) {
  if (samples.length <= 3) return samples;
  const strength = motionSmoothingStrength(transition);
  const allowsAirborne = transitionAllowsAirborneMotion(transition);
  const smoothed = samples.map(cloneAnimationSample);
  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];
    const rootAverage = averageVec3(previous.transform.position, next.transform.position);
    const rootStrength = strength.root;
    smoothed[index].transform.position = {
      ...blendVec3(current.transform.position, rootAverage, rootStrength),
      y: allowsAirborne
        ? blendVec3(current.transform.position, rootAverage, rootStrength * 0.45).y
        : blendVec3(current.transform.position, rootAverage, rootStrength * 0.25).y
    };
    smoothed[index].transform.rotation = smoothRotationSample(previous.transform.rotation, current.transform.rotation, next.transform.rotation, strength.rotation);
    for (const joint of POSE_KEYS) {
      if (shouldPreserveJointDuringSmoothing(transition, joint, current)) {
        smoothed[index].pose[joint] = { ...current.pose[joint] };
        continue;
      }
      smoothed[index].pose[joint] = smoothRotationSample(previous.pose[joint], current.pose[joint], next.pose[joint], strength.pose);
    }
  }
  smoothed[0] = cloneAnimationSample(samples[0]);
  smoothed[smoothed.length - 1] = cloneAnimationSample(samples[samples.length - 1]);
  return smoothed.map((sample) => ({
    ...sample,
    transform: {
      position: {
        x: Number(sample.transform.position.x.toFixed(4)),
        y: Number(sample.transform.position.y.toFixed(4)),
        z: Number(sample.transform.position.z.toFixed(4))
      },
      rotation: {
        x: Number(sample.transform.rotation.x.toFixed(4)),
        y: Number(sample.transform.rotation.y.toFixed(4)),
        z: Number(sample.transform.rotation.z.toFixed(4))
      },
      scale: {
        x: Number(sample.transform.scale.x.toFixed(4)),
        y: Number(sample.transform.scale.y.toFixed(4)),
        z: Number(sample.transform.scale.z.toFixed(4))
      }
    }
  }));
}

function smoothRootVelocityContinuity(transition: PoseTransition, samples: AnimationClipSample[]) {
  if (samples.length <= 4) return samples;
  const qualityTarget = motionQualityTargetForTransition(transition);
  const next = samples.map(cloneAnimationSample);
  const passes = isLocomotionActionType(sequenceLocomotionActionType(transition)) ? 2 : 1;
  const strength = isLocomotionActionType(sequenceLocomotionActionType(transition)) ? 0.34 : 0.24;

  for (let pass = 0; pass < passes; pass += 1) {
    const source = next.map(cloneAnimationSample);
    for (let index = 1; index < source.length - 1; index += 1) {
      const previous = source[index - 1];
      const current = source[index];
      const following = source[index + 1];
      const dtPrevious = Math.max(0.0001, current.timeSec - previous.timeSec);
      const dtNext = Math.max(0.0001, following.timeSec - current.timeSec);
      const previousStep = vecDistance(previous.transform.position, current.transform.position) / dtPrevious;
      const nextStep = vecDistance(current.transform.position, following.transform.position) / dtNext;
      const meanStep = (previousStep + nextStep) * 0.5;
      const spike = meanStep > 0.0001 ? Math.abs(previousStep - nextStep) / meanStep : 0;
      const localStrength = clamp01((spike - 0.18) / 0.82) * strength;
      if (localStrength <= 0.001) continue;
      const rootAverage = averageVec3(previous.transform.position, following.transform.position);
      next[index].transform.position.x = Number(lerp(current.transform.position.x, rootAverage.x, localStrength).toFixed(4));
      next[index].transform.position.z = Number(lerp(current.transform.position.z, rootAverage.z, localStrength).toFixed(4));
      if (!transitionAllowsAirborneMotion(transition)) {
        const baseY = lerp(samples[0].transform.position.y, samples[samples.length - 1].transform.position.y, clamp01(current.timeSec / Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1)));
        next[index].transform.position.y = Number(clampNumber(
          lerp(current.transform.position.y, rootAverage.y, localStrength * 0.22),
          baseY - Math.abs(groundedRootLimitsForAction(transition.actionPlan.semanticPlan?.actionType).minDrop),
          baseY + qualityTarget.maxRootLift
        ).toFixed(4));
      }
    }
  }

  next[0] = cloneAnimationSample(samples[0]);
  next[next.length - 1] = cloneAnimationSample(samples[samples.length - 1]);
  return next;
}

function sampleFromMotionSamples(samples: AnimationClipSample[], timeSec: number) {
  if (!samples.length) return null;
  if (timeSec <= samples[0].timeSec) return cloneAnimationSample(samples[0]);
  const last = samples[samples.length - 1];
  if (timeSec >= last.timeSec) return cloneAnimationSample(last);
  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];
    if (timeSec >= current.timeSec && timeSec <= next.timeSec) return sampleBetween(current, next, timeSec);
  }
  return cloneAnimationSample(last);
}

function enforceLocomotionRootProgression(transition: PoseTransition, samples: AnimationClipSample[], strength = 0.68) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || samples.length <= 3) return samples;
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const window = sequenceActionWindow(transition, actionType);
  const startSec = durationSec * window.startRatio;
  const endSec = durationSec * window.endRatio;
  const startSample = sampleFromMotionSamples(samples, startSec) || samples[0];
  const endSample = sampleFromMotionSamples(samples, endSec) || samples[samples.length - 1];
  const travelX = endSample.transform.position.x - startSample.transform.position.x;
  const travelZ = endSample.transform.position.z - startSample.transform.position.z;
  const travelDistance = Math.hypot(travelX, travelZ);
  if (travelDistance <= 0.04) return samples;

  const direction = vec(travelX / travelDistance, 0, travelZ / travelDistance);
  const perpendicular = vec(-direction.z, 0, direction.x);
  const next = samples.map(cloneAnimationSample);
  let previousProjection = 0;

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    if (t < window.startRatio || t > window.endRatio) continue;
    const localT = sequenceActionLocalRatio(transition, actionType, t);
    const motionT = semanticActionTime(transition, localT);
    const progress = locomotionRootProgress(actionType, localT, motionT);
    const gaitFrame = locomotionGaitFrame(transition, actionType, motionT);
    const relativeX = sample.transform.position.x - startSample.transform.position.x;
    const relativeZ = sample.transform.position.z - startSample.transform.position.z;
    const projection = relativeX * direction.x + relativeZ * direction.z;
    const lateral = relativeX * perpendicular.x + relativeZ * perpendicular.z;
    const targetProjection = travelDistance * progress;
    const minProjection = Math.max(previousProjection - travelDistance * 0.015, travelDistance * Math.max(0, progress - 0.055));
    const maxProjection = travelDistance * Math.min(1, progress + 0.055);
    const correctedProjection = clampNumber(lerp(projection, targetProjection, strength), minProjection, maxProjection);
    const correctedLateral = lerp(lateral, gaitFrame.rootLateral, Math.min(0.72, strength * 0.62));
    previousProjection = Math.max(previousProjection, correctedProjection);

    sample.transform.position.x = Number((startSample.transform.position.x + direction.x * correctedProjection + perpendicular.x * correctedLateral).toFixed(4));
    sample.transform.position.z = Number((startSample.transform.position.z + direction.z * correctedProjection + perpendicular.z * correctedLateral).toFixed(4));
    const baseY = lerp(startSample.transform.position.y, endSample.transform.position.y, localT);
    const maxBob = actionType === 'walk' ? 0.016 : actionType === 'run' ? 0.024 : 0.028;
    sample.transform.position.y = Number((baseY + clampNumber(sample.transform.position.y - baseY, -0.012, maxBob)).toFixed(4));
  }

  next[0] = cloneAnimationSample(samples[0]);
  next[next.length - 1] = cloneAnimationSample(samples[samples.length - 1]);
  return next;
}

function stabilizeGroundedMotionSamples(transition: PoseTransition, samples: AnimationClipSample[]) {
  if (!groundedMotionActionType(transition) || samples.length <= 2) return samples;
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  const gait = locomotionGaitConfig(actionType);
  const limits = groundedRootLimitsForAction(actionType);
  const next = samples.map(cloneAnimationSample);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const travel = {
    x: last.transform.position.x - first.transform.position.x,
    y: 0,
    z: last.transform.position.z - first.transform.position.z
  };
  const travelDistance = Math.hypot(travel.x, travel.z);
  const travelDirection = travelDistance > 0.0001
    ? vec(travel.x / travelDistance, 0, travel.z / travelDistance)
    : normalizedDirection(transition.actionPlan.universal?.direction || vec());
  const gaitDurationSec = locomotionEffectiveDurationSec(transition, actionType);
  const tempoScale = locomotionGaitTempoScale(transition, actionType);

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = transition.durationSec > 0 ? clamp01(sample.timeSec / transition.durationSec) : index / (next.length - 1);
    const baseY = lerp(first.transform.position.y, last.transform.position.y, t);
    sample.transform.position.y = Number((baseY + clampMotionNumber(sample.transform.position.y - baseY, limits.minDrop, limits.maxLift)).toFixed(4));

    if (gait) {
      const localT = sequenceActionLocalRatio(transition, actionType, t);
      const motionT = semanticActionTime(transition, localT);
      const leftPlant = gaitFootPlantStrength(actionType, 'left', motionT, gaitDurationSec, tempoScale);
      const rightPlant = gaitFootPlantStrength(actionType, 'right', motionT, gaitDurationSec, tempoScale);
      sample.pose.leftFoot = slerpRotation(sample.pose.leftFoot, first.pose.leftFoot, leftPlant * 0.55);
      sample.pose.rightFoot = slerpRotation(sample.pose.rightFoot, first.pose.rightFoot, rightPlant * 0.55);
    } else if (transition.actionPlan.semanticPlan?.contacts.some((item) => item.contact === 'feet')) {
      sample.pose.leftFoot = slerpRotation(sample.pose.leftFoot, first.pose.leftFoot, 0.42);
      sample.pose.rightFoot = slerpRotation(sample.pose.rightFoot, first.pose.rightFoot, 0.42);
    }

    if (gait && travelDistance > 0.05 && (travelDirection.x || travelDirection.z)) {
      const motionT = semanticActionTime(transition, t);
      const gaitFrame = actionType ? locomotionGaitFrame(transition, actionType, motionT) : { rootLateral: 0 };
      const expectedPosition = locomotionPlanarTargetPosition(transition, first, last, actionType, t, motionT, gaitFrame.rootLateral);
      sample.transform.position.x = Number(lerp(sample.transform.position.x, expectedPosition.x, 0.24).toFixed(4));
      sample.transform.position.z = Number(lerp(sample.transform.position.z, expectedPosition.z, 0.24).toFixed(4));
      const relativeX = sample.transform.position.x - first.transform.position.x;
      const relativeZ = sample.transform.position.z - first.transform.position.z;
      const projection = relativeX * travelDirection.x + relativeZ * travelDirection.z;
      const progress = locomotionRootProgress(actionType, t, motionT);
      const minProjection = travelDistance * Math.max(0, progress - 0.12);
      const maxProjection = travelDistance * Math.min(1, progress + 0.12);
      const clampedProjection = clampNumber(projection, minProjection, maxProjection);
      if (Math.abs(clampedProjection - projection) > 0.001) {
        sample.transform.position.x = Number((sample.transform.position.x + (clampedProjection - projection) * travelDirection.x).toFixed(4));
        sample.transform.position.z = Number((sample.transform.position.z + (clampedProjection - projection) * travelDirection.z).toFixed(4));
      }
    }
  }

  next[0] = cloneAnimationSample(first);
  next[next.length - 1] = cloneAnimationSample(last);
  return next;
}

function applyBasicMotionContinuity(transition: PoseTransition, samples: AnimationClipSample[]) {
  if (samples.length <= 2) return samples;
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  if (!isBasicMotionActionType(actionType)) return samples;
  const next = samples.map(cloneAnimationSample);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const durationSec = Math.max(0.0001, transition.durationSec || last.timeSec || 1);
  const travelDistance = Math.hypot(
    last.transform.position.x - first.transform.position.x,
    last.transform.position.z - first.transform.position.z
  );

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    const motionT = semanticActionTime(transition, t);

    if (isLocomotionActionType(actionType)) {
      const gaitFrame = locomotionGaitFrame(transition, actionType, motionT);
      const expectedPosition = locomotionPlanarTargetPosition(transition, first, last, actionType, t, motionT, gaitFrame.rootLateral);
      const blendStrength = travelDistance > 0.05 ? 0.68 : 0.92;
      sample.transform.position.x = Number(lerp(sample.transform.position.x, expectedPosition.x, blendStrength).toFixed(4));
      sample.transform.position.z = Number(lerp(sample.transform.position.z, expectedPosition.z, blendStrength).toFixed(4));
      const baseY = lerp(first.transform.position.y, last.transform.position.y, t);
      const bob = Math.max(0, sample.transform.position.y - baseY);
      sample.transform.position.y = Number((baseY + Math.min(bob, actionType === 'walk' ? 0.018 : 0.03)).toFixed(4));
    }

    if (actionType === 'turn') {
      const turnT = ramp(t, 0.04, 0.94);
      sample.transform.rotation.y = Number(lerp(first.transform.rotation.y, last.transform.rotation.y, turnT).toFixed(4));
      sample.transform.position.x = Number(lerp(sample.transform.position.x, lerp(first.transform.position.x, last.transform.position.x, t), 0.72).toFixed(4));
      sample.transform.position.z = Number(lerp(sample.transform.position.z, lerp(first.transform.position.z, last.transform.position.z, t), 0.72).toFixed(4));
    }

    if (actionType === 'jump') {
      const baseX = lerp(first.transform.position.x, last.transform.position.x, t);
      const baseY = lerp(first.transform.position.y, last.transform.position.y, t);
      const baseZ = lerp(first.transform.position.z, last.transform.position.z, t);
      const lift = Math.max(0.18, transition.actionPlan.universal?.verticalLift || 0.2);
      const compress = 0.045 * stageWindow(t, 0.02, 0.22);
      const landing = 0.035 * stageWindow(t, 0.72, 0.98);
      sample.transform.position.x = Number(lerp(sample.transform.position.x, baseX, 0.62).toFixed(4));
      sample.transform.position.z = Number(lerp(sample.transform.position.z, baseZ, 0.62).toFixed(4));
      sample.transform.position.y = Number((baseY + Math.sin(t * Math.PI) * lift - compress - landing).toFixed(4));
    }

    if (actionType && isBasicMotionActionType(actionType) && actionType !== 'jump') {
      const expectedPosition = isLocomotionActionType(actionType)
        ? locomotionPlanarTargetPosition(transition, first, last, actionType, t, motionT)
        : {
            x: lerp(first.transform.position.x, last.transform.position.x, t),
            y: lerp(first.transform.position.y, last.transform.position.y, t),
            z: lerp(first.transform.position.z, last.transform.position.z, t)
          };
      const expectedX = expectedPosition.x;
      const expectedY = lerp(first.transform.position.y, last.transform.position.y, t);
      const expectedZ = expectedPosition.z;
      const limits = groundedRootLimitsForAction(actionType);
      const pathBlend = isLocomotionActionType(actionType) ? 0.34 : 0.48;
      sample.transform.position.x = Number(lerp(sample.transform.position.x, expectedX, pathBlend).toFixed(4));
      sample.transform.position.z = Number(lerp(sample.transform.position.z, expectedZ, pathBlend).toFixed(4));
      sample.transform.position.y = Number((expectedY + clampNumber(sample.transform.position.y - expectedY, limits.minDrop, limits.maxLift)).toFixed(4));
      if (['push', 'pull', 'punch', 'block', 'throw', 'reach'].includes(actionType)) {
        sample.pose.leftFoot = slerpRotation(sample.pose.leftFoot, first.pose.leftFoot, 0.46);
        sample.pose.rightFoot = slerpRotation(sample.pose.rightFoot, first.pose.rightFoot, 0.46);
      }
    }
  }

  next[0] = cloneAnimationSample(first);
  next[next.length - 1] = cloneAnimationSample(last);
  return next;
}

function smoothCameraMotionSamples(samples: CameraMotionSample[] | undefined) {
  if (!samples || samples.length <= 3) return samples;
  const smoothed = samples.map((sample) => ({
    ...sample,
    position: { ...sample.position },
    targetPosition: { ...sample.targetPosition }
  }));
  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];
    smoothed[index] = {
      ...current,
      position: blendVec3(current.position, averageVec3(previous.position, next.position), 0.22),
      targetPosition: blendVec3(current.targetPosition, averageVec3(previous.targetPosition, next.targetPosition), 0.2),
      fov: current.fov !== undefined && previous.fov !== undefined && next.fov !== undefined
        ? Number(lerp(current.fov, (previous.fov + next.fov) / 2, 0.18).toFixed(3))
        : current.fov
    };
  }
  smoothed[0] = { ...samples[0], position: { ...samples[0].position }, targetPosition: { ...samples[0].targetPosition } };
  smoothed[smoothed.length - 1] = { ...samples[samples.length - 1], position: { ...samples[samples.length - 1].position }, targetPosition: { ...samples[samples.length - 1].targetPosition } };
  return smoothed;
}

function motionQualityNeedsAutoCorrection(report: MotionQualityReport) {
  const diagnosis = diagnoseMotionQuality(report);
  return diagnosis.needsCorrection || report.issues.some((issue) => (
    issue.severity === 'error'
    || issue.metric === 'speed'
    || issue.metric === 'rotation'
    || issue.metric === 'foot_lock'
    || issue.metric === 'contact'
    || issue.metric === 'sequence'
    || (issue.metric === 'pose' && issue.severity === 'warning')
  ))
    || (report.metrics.semanticContactBodyDrive !== undefined && report.metrics.semanticContactBodyDrive < 8)
    || (report.metrics.semanticContactFootStability !== undefined && report.metrics.semanticContactFootStability < 0.42)
    || (report.metrics.semanticPropMotionDistance !== undefined && report.metrics.semanticPropMotionDistance < 0.14)
    || (report.metrics.semanticThrowReleaseDistance !== undefined && report.metrics.semanticThrowReleaseDistance < 0.62);
}

function diagnoseMotionQuality(report: MotionQualityReport) {
  const hasMessage = (text: string) => report.issues.some((issue) => issue.message.includes(text));
  const hasMetric = (metric: MotionQualityIssue['metric']) => report.issues.some((issue) => issue.metric === metric);
  const locomotionNeedsGait = hasMessage('左右腿交替')
    || hasMessage('手臂反向摆动')
    || hasMessage('手臂反摆')
    || hasMessage('支撑脚交替')
    || hasMessage('脚步接触帧不足')
    || hasMessage('脚步接触帧与步态相位不匹配')
    || (report.metrics.locomotionLegSeparation !== undefined && report.metrics.locomotionLegSeparation < 10)
    || (report.metrics.locomotionLegSignChanges !== undefined && report.metrics.locomotionLegSignChanges < 1)
    || (report.metrics.locomotionSupportSwitchCount !== undefined && report.metrics.locomotionSupportSwitchCount < 1)
    || (report.metrics.locomotionArmLegSyncScore !== undefined && report.metrics.locomotionArmLegSyncScore < 0.34);
  const locomotionNeedsRoot = hasMessage('根节点步速不稳定')
    || hasMessage('根节点出现反向回抽')
    || hasMessage('根节点位移没有达到提示词要求')
    || hasMessage('根节点速度出现尖峰')
    || hasMessage('采样密度不足')
    || (report.metrics.locomotionRootStepJitter !== undefined && report.metrics.locomotionRootStepJitter > 0.56)
    || Boolean(report.metrics.locomotionRootBacktrackCount)
    || (report.metrics.rootVelocitySpikeRatio !== undefined && report.metrics.rootVelocitySpikeRatio > 2.8)
    || (report.metrics.locomotionPaceCoverageRatio !== undefined && report.metrics.locomotionExpectedTravelDistance !== undefined && report.metrics.locomotionExpectedTravelDistance > 0.08 && report.metrics.locomotionPaceCoverageRatio < 0.66);
  const contactNeedsCorrection = hasMetric('contact')
    || (report.metrics.semanticHandContactSuccessRatio !== undefined && report.metrics.semanticHandContactSuccessRatio < 0.65)
    || (report.metrics.semanticHandReachDistance !== undefined && report.metrics.semanticHandReachDistance > 0.62)
    || (report.metrics.semanticContactBodyDrive !== undefined && report.metrics.semanticContactBodyDrive < 8)
    || (report.metrics.semanticContactFootStability !== undefined && report.metrics.semanticContactFootStability < 0.42)
    || (report.metrics.semanticContactWindowCoverage !== undefined && report.metrics.semanticContactWindowCoverage < 0.65)
    || (report.metrics.semanticPropMotionDistance !== undefined && report.metrics.semanticPropMotionDistance < 0.14)
    || (report.metrics.semanticPropDirectionAlignment !== undefined && report.metrics.semanticPropDirectionAlignment < 0.45)
    || (report.metrics.semanticThrowReleaseDistance !== undefined && report.metrics.semanticThrowReleaseDistance < 0.62);
  const sequenceNeedsSmoothing = hasMetric('sequence')
    || (report.metrics.sequenceBoundarySmoothnessRatio !== undefined && report.metrics.sequenceBoundarySmoothnessRatio < 0.72)
    || (report.metrics.sequenceBoundaryMaxPoseDelta !== undefined && report.metrics.sequenceBoundaryMaxPoseDelta > 34)
    || (report.metrics.sequenceBoundaryMaxRootDelta !== undefined && report.metrics.sequenceBoundaryMaxRootDelta > 0.13)
    || (report.metrics.sequenceBoundaryMaxVelocityRatio !== undefined && report.metrics.sequenceBoundaryMaxVelocityRatio > 2.55);
  const airborneNeedsClamp = hasMessage('离地');
  const excessivePoseNeedsDamping = hasMessage('幅度过大')
    || hasMessage('关节跳变')
    || hasMessage('关节速度出现尖峰')
    || hasMetric('rotation')
    || (report.metrics.poseVelocitySpikeRatio !== undefined && report.metrics.poseVelocitySpikeRatio > 3.25);
  return {
    locomotionNeedsGait,
    locomotionNeedsRoot,
    contactNeedsCorrection,
    sequenceNeedsSmoothing,
    airborneNeedsClamp,
    excessivePoseNeedsDamping,
    needsCorrection: locomotionNeedsGait
      || locomotionNeedsRoot
      || contactNeedsCorrection
      || sequenceNeedsSmoothing
      || airborneNeedsClamp
      || excessivePoseNeedsDamping
  };
}

function alignSampleEndpoints(samples: AnimationClipSample[], transition: PoseTransition) {
  if (!samples.length) return samples;
  const next = samples.map(cloneAnimationSample);
  const preserveEndpointBonePose = !semanticMotionUsesRigPose(transition);
  if (transition.startTransform) next[0].transform = clonePoseTransform(transition.startTransform);
  if (transition.startPose) next[0].pose = clonePose(transition.startPose);
  next[0].bonePose = preserveEndpointBonePose ? cloneBonePose(transition.startBonePose) : undefined;
  if (transition.startFingerPose) next[0].fingerPose = cloneFingerPose(transition.startFingerPose);
  if (transition.startToePose) next[0].toePose = cloneToePose(transition.startToePose);
  if (transition.startLibTvJointAngles) next[0].libTvJointAngles = cloneLibTvJointAngles(transition.startLibTvJointAngles);
  const last = next.length - 1;
  if (transition.endTransform) next[last].transform = clonePoseTransform(transition.endTransform);
  if (transition.endPose) next[last].pose = clonePose(transition.endPose);
  next[last].bonePose = preserveEndpointBonePose ? cloneBonePose(transition.endBonePose) : undefined;
  if (transition.endFingerPose) next[last].fingerPose = cloneFingerPose(transition.endFingerPose);
  if (transition.endToePose) next[last].toePose = cloneToePose(transition.endToePose);
  if (transition.endLibTvJointAngles) next[last].libTvJointAngles = cloneLibTvJointAngles(transition.endLibTvJointAngles);
  return next;
}

function clampNonAirborneRootMotion(samples: AnimationClipSample[], transition: PoseTransition) {
  if (transitionAllowsAirborneMotion(transition) || samples.length <= 2) return samples;
  const startY = transition.startTransform?.position.y ?? samples[0].transform.position.y;
  const endY = transition.endTransform?.position.y ?? samples[samples.length - 1].transform.position.y;
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  const skillLimits = motionActionSkill(actionType)?.rootLimits;
  const maxLift = skillLimits ? Math.max(0.02, skillLimits.maxLift) : 0.045;
  const minDrop = actionType === 'fall' ? -0.36 : skillLimits ? skillLimits.minDrop : -0.16;
  return samples.map((sample, index) => {
    if (index === 0 || index === samples.length - 1) return cloneAnimationSample(sample);
    const next = cloneAnimationSample(sample);
    const baseY = lerp(startY, endY, clamp01(sample.timeSec / durationSec));
    next.transform.position.y = Number(clampNumber(next.transform.position.y, baseY + minDrop, baseY + maxLift).toFixed(4));
    return next;
  });
}

function dampExcessivePoseDeltas(samples: AnimationClipSample[], transition: PoseTransition) {
  if (samples.length <= 3) return samples;
  const next = samples.map(cloneAnimationSample);
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  const threshold = actionType === 'throw' || actionType === 'punch' || actionType === 'kick' || actionType === 'side_kick' ? 48 : 40;
  for (let index = 1; index < samples.length - 1; index += 1) {
    for (const joint of POSE_KEYS) {
      if (shouldPreserveJointDuringSmoothing(transition, joint, samples[index])) continue;
      const previousDelta = poseJointDelta(samples[index - 1].pose[joint], samples[index].pose[joint]);
      const nextDelta = poseJointDelta(samples[index].pose[joint], samples[index + 1].pose[joint]);
      if (Math.max(previousDelta, nextDelta) <= threshold) continue;
      next[index].pose[joint] = smoothRotationSample(samples[index - 1].pose[joint], samples[index].pose[joint], samples[index + 1].pose[joint], 0.38);
    }
  }
  return next;
}

function reapplyLocomotionPlantPoseLocks(samples: AnimationClipSample[], transition: PoseTransition) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || samples.length <= 2) return samples;
  const next = samples.map(cloneAnimationSample);
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const gaitDurationSec = locomotionEffectiveDurationSec(transition, actionType);
  const tempoScale = locomotionGaitTempoScale(transition, actionType);
  const window = sequenceActionWindow(transition, actionType);
  const plantRefs: Record<'left' | 'right', RigRotation | null> = { left: null, right: null };
  next.forEach((sample, index) => {
    if (index === 0 || index === next.length - 1) return;
    const t = clamp01(sample.timeSec / durationSec);
    if (t < window.startRatio || t > window.endRatio) return;
    const localT = sequenceActionLocalRatio(transition, actionType, t);
    const motionT = semanticActionTime(transition, localT);
    (['left', 'right'] as const).forEach((limb) => {
      const poseKey: PoseJointKey = limb === 'left' ? 'leftFoot' : 'rightFoot';
      const plant = gaitFootPlantStrength(actionType, limb, motionT, gaitDurationSec, tempoScale);
      if (plant < 0.38) {
        plantRefs[limb] = null;
        return;
      }
      if (!plantRefs[limb]) {
        plantRefs[limb] = { ...sample.pose[poseKey] };
        return;
      }
      const strength = clamp01((plant - 0.38) / 0.42) * 0.9;
      sample.pose[poseKey] = slerpRotation(sample.pose[poseKey], plantRefs[limb], strength);
    });
  });
  return alignSampleEndpoints(next, transition);
}

function stabilizeLocomotionFootPhases(transition: PoseTransition, samples: AnimationClipSample[]) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || samples.length <= 2) return samples;
  const next = samples.map(cloneAnimationSample);
  const first = samples[0];
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const gaitDurationSec = locomotionEffectiveDurationSec(transition, actionType);
  const tempoScale = locomotionGaitTempoScale(transition, actionType);
  const window = sequenceActionWindow(transition, actionType);

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    if (t < window.startRatio || t > window.endRatio) continue;
    const localT = sequenceActionLocalRatio(transition, actionType, t);
    const motionT = semanticActionTime(transition, localT);
    const left = gaitLimbSample(actionType, 'left', motionT, gaitDurationSec, tempoScale);
    const right = gaitLimbSample(actionType, 'right', motionT, gaitDurationSec, tempoScale);
    const gaitFrame = locomotionGaitFrame(transition, actionType, motionT);
    const stableBasePose = locomotionStableBasePose(first.pose, actionType);
    const targetPose = offsetPose(stableBasePose, gaitFrame.posePatch);
    const envelope = locomotionEnvelope(motionT);

    ([
      { upper: 'leftUpperLeg' as PoseJointKey, lower: 'leftLowerLeg' as PoseJointKey, foot: 'leftFoot' as PoseJointKey, step: left },
      { upper: 'rightUpperLeg' as PoseJointKey, lower: 'rightLowerLeg' as PoseJointKey, foot: 'rightFoot' as PoseJointKey, step: right }
    ]).forEach(({ upper, lower, foot, step }) => {
      const plantStrength = clamp01(step.plant);
      const swingStrength = clamp01(step.swing);
      const plantPoseStrength = plantStrength * (actionType === 'walk' ? 0.82 : actionType === 'run' ? 0.72 : 0.64) * envelope;
      const swingPoseStrength = swingStrength * (actionType === 'walk' ? 0.48 : actionType === 'run' ? 0.56 : 0.62) * envelope;
      sample.pose[foot] = slerpRotation(sample.pose[foot], first.pose[foot], plantPoseStrength);
      sample.pose[upper] = slerpRotation(sample.pose[upper], targetPose[upper], Math.max(plantPoseStrength * 0.26, swingPoseStrength));
      sample.pose[lower] = slerpRotation(sample.pose[lower], targetPose[lower], Math.max(plantPoseStrength * 0.22, swingPoseStrength));
      if (swingStrength > 0.04) {
        sample.pose[foot] = slerpRotation(sample.pose[foot], targetPose[foot], swingPoseStrength * 0.82);
      }
    });

    sample.pose.leftUpperArm = slerpRotation(sample.pose.leftUpperArm, targetPose.leftUpperArm, 0.48 * envelope);
    sample.pose.rightUpperArm = slerpRotation(sample.pose.rightUpperArm, targetPose.rightUpperArm, 0.48 * envelope);
    sample.pose.leftLowerArm = slerpRotation(sample.pose.leftLowerArm, targetPose.leftLowerArm, 0.34 * envelope);
    sample.pose.rightLowerArm = slerpRotation(sample.pose.rightLowerArm, targetPose.rightLowerArm, 0.34 * envelope);
    sample.pose.pelvis = slerpRotation(sample.pose.pelvis, targetPose.pelvis, 0.22 * envelope);
    sample.pose.chest = slerpRotation(sample.pose.chest, targetPose.chest, 0.18 * envelope);
  }

  next[0] = cloneAnimationSample(samples[0]);
  next[next.length - 1] = cloneAnimationSample(samples[samples.length - 1]);
  return next;
}

function applyLocomotionPhaseConsistency(transition: PoseTransition, samples: AnimationClipSample[], strength = 0.44) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || samples.length <= 3) return samples;
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const window = sequenceActionWindow(transition, actionType);
  const startSample = sampleFromMotionSamples(samples, durationSec * window.startRatio) || samples[0];
  const endSample = sampleFromMotionSamples(samples, durationSec * window.endRatio) || samples[samples.length - 1];
  const travelDistance = Math.hypot(
    endSample.transform.position.x - startSample.transform.position.x,
    endSample.transform.position.z - startSample.transform.position.z
  );
  const next = samples.map(cloneAnimationSample);
  const stableBasePose = locomotionStableBasePose(startSample.pose, actionType);

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    if (t < window.startRatio || t > window.endRatio) continue;
    const localT = sequenceActionLocalRatio(transition, actionType, t);
    const motionT = semanticActionTime(transition, localT);
    const envelope = locomotionEnvelope(motionT);
    if (envelope <= 0.001) continue;
    const gaitFrame = locomotionGaitFrame(transition, actionType, motionT);
    const targetPose = offsetPose(stableBasePose, gaitFrame.posePatch);
    const phaseStrength = clamp01(strength * envelope);

    if (travelDistance > 0.04) {
      const targetPosition = locomotionPlanarTargetPosition(transition, startSample, endSample, actionType, t, motionT, gaitFrame.rootLateral);
      const rootStrength = phaseStrength * (actionType === 'walk' ? 0.42 : actionType === 'run' ? 0.48 : 0.52);
      sample.transform.position.x = Number(lerp(sample.transform.position.x, targetPosition.x, rootStrength).toFixed(4));
      sample.transform.position.z = Number(lerp(sample.transform.position.z, targetPosition.z, rootStrength).toFixed(4));
      const baseY = lerp(startSample.transform.position.y, endSample.transform.position.y, localT);
      const targetY = baseY + gaitFrame.rootBob;
      sample.transform.position.y = Number(lerp(sample.transform.position.y, targetY, rootStrength * 0.34).toFixed(4));
    }

    sample.pose.leftUpperLeg = slerpRotation(sample.pose.leftUpperLeg, targetPose.leftUpperLeg, phaseStrength * 0.58);
    sample.pose.rightUpperLeg = slerpRotation(sample.pose.rightUpperLeg, targetPose.rightUpperLeg, phaseStrength * 0.58);
    sample.pose.leftLowerLeg = slerpRotation(sample.pose.leftLowerLeg, targetPose.leftLowerLeg, phaseStrength * 0.52);
    sample.pose.rightLowerLeg = slerpRotation(sample.pose.rightLowerLeg, targetPose.rightLowerLeg, phaseStrength * 0.52);
    sample.pose.leftFoot = slerpRotation(sample.pose.leftFoot, targetPose.leftFoot, phaseStrength * (gaitFrame.leftStep.swing > 0.04 ? 0.42 : 0.16));
    sample.pose.rightFoot = slerpRotation(sample.pose.rightFoot, targetPose.rightFoot, phaseStrength * (gaitFrame.rightStep.swing > 0.04 ? 0.42 : 0.16));
    sample.pose.leftUpperArm = slerpRotation(sample.pose.leftUpperArm, targetPose.leftUpperArm, phaseStrength * 0.66);
    sample.pose.rightUpperArm = slerpRotation(sample.pose.rightUpperArm, targetPose.rightUpperArm, phaseStrength * 0.66);
    sample.pose.leftLowerArm = slerpRotation(sample.pose.leftLowerArm, targetPose.leftLowerArm, phaseStrength * 0.44);
    sample.pose.rightLowerArm = slerpRotation(sample.pose.rightLowerArm, targetPose.rightLowerArm, phaseStrength * 0.44);
    sample.pose.pelvis = slerpRotation(sample.pose.pelvis, targetPose.pelvis, phaseStrength * 0.26);
    sample.pose.chest = slerpRotation(sample.pose.chest, targetPose.chest, phaseStrength * 0.22);
  }

  next[0] = cloneAnimationSample(samples[0]);
  next[next.length - 1] = cloneAnimationSample(samples[samples.length - 1]);
  return next;
}

function applyLocomotionGoldenStandard(transition: PoseTransition, samples: AnimationClipSample[], strength = 0.5) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || samples.length <= 3) return samples;
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const window = sequenceActionWindow(transition, actionType);
  const startSample = sampleFromMotionSamples(samples, durationSec * window.startRatio) || samples[0];
  const endSample = sampleFromMotionSamples(samples, durationSec * window.endRatio) || samples[samples.length - 1];
  const stableBasePose = locomotionStableBasePose(startSample.pose, actionType);
  const gait = locomotionGaitConfig(actionType);
  const maxBob = actionType === 'walk' ? 0.014 : actionType === 'run' ? 0.022 : 0.026;
  const next = samples.map(cloneAnimationSample);

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    if (t < window.startRatio || t > window.endRatio) continue;
    const localT = sequenceActionLocalRatio(transition, actionType, t);
    const motionT = semanticActionTime(transition, localT);
    const envelope = locomotionEnvelope(motionT);
    if (envelope <= 0.001) continue;
    const gaitFrame = locomotionGaitFrame(transition, actionType, motionT);
    const targetPose = offsetPose(stableBasePose, gaitFrame.posePatch);
    const rootStrength = clamp01(strength * envelope * (actionType === 'walk' ? 0.82 : actionType === 'run' ? 0.9 : 0.96));
    const poseStrength = clamp01(strength * envelope);
    const targetPosition = locomotionPlanarTargetPosition(transition, startSample, endSample, actionType, t, motionT, gaitFrame.rootLateral);
    const baseY = lerp(startSample.transform.position.y, endSample.transform.position.y, localT);
    const targetY = baseY + clampMotionNumber(gaitFrame.rootBob, 0, maxBob);
    sample.transform.position.x = Number(lerp(sample.transform.position.x, targetPosition.x, rootStrength).toFixed(4));
    sample.transform.position.z = Number(lerp(sample.transform.position.z, targetPosition.z, rootStrength).toFixed(4));
    sample.transform.position.y = Number(lerp(sample.transform.position.y, targetY, rootStrength * 0.72).toFixed(4));
    sample.transform.position.y = Number((baseY + clampMotionNumber(sample.transform.position.y - baseY, -0.006, maxBob)).toFixed(4));

    const leftPlant = gait ? clamp01(gaitFrame.leftStep.plant / Math.max(0.001, gait.footPlant)) : 0;
    const rightPlant = gait ? clamp01(gaitFrame.rightStep.plant / Math.max(0.001, gait.footPlant)) : 0;
    sample.pose.leftUpperLeg = slerpRotation(sample.pose.leftUpperLeg, targetPose.leftUpperLeg, poseStrength * 0.7);
    sample.pose.rightUpperLeg = slerpRotation(sample.pose.rightUpperLeg, targetPose.rightUpperLeg, poseStrength * 0.7);
    sample.pose.leftLowerLeg = slerpRotation(sample.pose.leftLowerLeg, targetPose.leftLowerLeg, poseStrength * 0.64);
    sample.pose.rightLowerLeg = slerpRotation(sample.pose.rightLowerLeg, targetPose.rightLowerLeg, poseStrength * 0.64);
    sample.pose.leftFoot = slerpRotation(sample.pose.leftFoot, leftPlant > 0.34 ? stableBasePose.leftFoot : targetPose.leftFoot, poseStrength * (leftPlant > 0.34 ? 0.72 : 0.52));
    sample.pose.rightFoot = slerpRotation(sample.pose.rightFoot, rightPlant > 0.34 ? stableBasePose.rightFoot : targetPose.rightFoot, poseStrength * (rightPlant > 0.34 ? 0.72 : 0.52));
    sample.pose.leftUpperArm = slerpRotation(sample.pose.leftUpperArm, targetPose.leftUpperArm, poseStrength * 0.74);
    sample.pose.rightUpperArm = slerpRotation(sample.pose.rightUpperArm, targetPose.rightUpperArm, poseStrength * 0.74);
    sample.pose.leftLowerArm = slerpRotation(sample.pose.leftLowerArm, targetPose.leftLowerArm, poseStrength * 0.52);
    sample.pose.rightLowerArm = slerpRotation(sample.pose.rightLowerArm, targetPose.rightLowerArm, poseStrength * 0.52);
    sample.pose.pelvis = slerpRotation(sample.pose.pelvis, targetPose.pelvis, poseStrength * 0.34);
    sample.pose.chest = slerpRotation(sample.pose.chest, targetPose.chest, poseStrength * 0.28);
    sample.pose.head = slerpRotation(sample.pose.head, targetPose.head, poseStrength * 0.14);
  }

  return reapplyLocomotionPlantPoseLocks(alignSampleEndpoints(next, transition), transition);
}

function easeLocomotionEndpointPoseTransitions(transition: PoseTransition, samples: AnimationClipSample[]) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || samples.length <= 4) return samples;
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const window = sequenceActionWindow(transition, actionType);
  const startSample = sampleFromMotionSamples(samples, durationSec * window.startRatio) || samples[0];
  const endSample = sampleFromMotionSamples(samples, durationSec * window.endRatio) || samples[samples.length - 1];
  const next = samples.map(cloneAnimationSample);

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const ratio = clamp01(sample.timeSec / durationSec);
    if (ratio < window.startRatio || ratio > window.endRatio) continue;
    const localT = sequenceActionLocalRatio(transition, actionType, ratio);
    const enterHold = 1 - ramp(localT, actionType === 'walk' ? 0.02 : 0.04, actionType === 'walk' ? 0.18 : 0.22);
    const exitHold = ramp(localT, actionType === 'walk' ? 0.82 : 0.76, actionType === 'walk' ? 0.98 : 0.96);
    if (enterHold > 0.001) {
      sample.pose = blendPose(sample.pose, startSample.pose, enterHold * 0.68);
    }
    if (exitHold > 0.001) {
      sample.pose = blendPose(sample.pose, endSample.pose, exitHold * 0.62);
    }
  }

  return alignSampleEndpoints(next, transition);
}

function finalizeLocomotionGoldenStandard(transition: PoseTransition, samples: AnimationClipSample[], strength = 0.66) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || samples.length <= 3) return alignSampleEndpoints(samples, transition);
  const clampedStrength = clamp01(strength);
  let next = samples.map(cloneAnimationSample);
  next = applyLocomotionGaitBaseline(transition, next);
  next = applyLocomotionPhaseConsistency(transition, next, 0.48 + clampedStrength * 0.18);
  next = stabilizeLocomotionFootPhases(transition, next);
  next = applyLocomotionGoldenStandard(transition, next, 0.56 + clampedStrength * 0.16);
  next = easeLocomotionEndpointPoseTransitions(transition, next);
  next = enforceLocomotionRootProgression(transition, next, 0.78 + clampedStrength * 0.16);
  next = smoothRootVelocityContinuity(transition, next);
  next = stabilizeGroundedMotionSamples(transition, next);
  next = clampNonAirborneRootMotion(next, transition);
  next = dampExcessivePoseDeltas(next, transition);
  next = reapplyLocomotionPlantPoseLocks(next, transition);
  return alignSampleEndpoints(next, transition);
}

function applyPromptControlPoseReinforcement(transition: PoseTransition, samples: AnimationClipSample[]) {
  if (samples.length <= 2) return samples;
  const promptControl = motionPromptControlSummary(transition.actionPrompt, transition.actionPlan.universal, transition.actionPlan.semanticPlan);
  const needsLowCenter = promptControl.bodyTags.includes('低重心');
  const needsForwardLean = promptControl.bodyTags.includes('身体前压');
  const needsBackLean = promptControl.bodyTags.includes('身体后仰');
  if (!needsLowCenter && !needsForwardLean && !needsBackLean) return samples;
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const next = samples.map(cloneAnimationSample);

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    const envelope = Math.sin(t * Math.PI);
    if (envelope <= 0.001) continue;
    const patch: Partial<StandardHumanRigPose> = {};
    if (needsLowCenter) {
      Object.assign(patch, {
        pelvis: { x: -8 * envelope },
        chest: { x: 5 * envelope },
        leftUpperLeg: { x: -18 * envelope },
        rightUpperLeg: { x: -18 * envelope },
        leftLowerLeg: { x: 28 * envelope },
        rightLowerLeg: { x: 28 * envelope },
        leftFoot: { x: -5 * envelope },
        rightFoot: { x: -5 * envelope }
      });
      sample.transform.position.y = Number((sample.transform.position.y - 0.025 * envelope).toFixed(4));
    }
    if (needsForwardLean) {
      Object.assign(patch, {
        pelvis: { ...(patch.pelvis || {}), x: (patch.pelvis?.x || 0) - 4 * envelope },
        chest: { ...(patch.chest || {}), x: (patch.chest?.x || 0) - 7 * envelope },
        head: { x: -2 * envelope }
      });
    }
    if (needsBackLean) {
      Object.assign(patch, {
        pelvis: { ...(patch.pelvis || {}), x: (patch.pelvis?.x || 0) + 4 * envelope },
        chest: { ...(patch.chest || {}), x: (patch.chest?.x || 0) + 8 * envelope },
        head: { x: 2 * envelope }
      });
    }
    sample.pose = offsetPose(sample.pose, patch);
  }

  next[0] = cloneAnimationSample(samples[0]);
  next[next.length - 1] = cloneAnimationSample(samples[samples.length - 1]);
  return next;
}

function reapplyFootLockPoses(samples: AnimationClipSample[], transition: PoseTransition) {
  if (!transition.constraints.footLock.enabled || !samples.length) return samples;
  if (isLocomotionActionType(sequenceLocomotionActionType(transition))) {
    return reapplyLocomotionPlantPoseLocks(stabilizeLocomotionFootPhases(transition, samples), transition);
  }
  const next = samples.map(cloneAnimationSample);
  const leftRef = samples[0].pose.leftFoot;
  const rightRef = samples[0].pose.rightFoot;
  next.forEach((sample) => {
    const t = transition.durationSec > 0 ? sample.timeSec / transition.durationSec : 0;
    if (transition.constraints.footLock.left && footLockPhaseActive(transition, 'left', t)) sample.pose.leftFoot = { ...leftRef };
    if (transition.constraints.footLock.right && footLockPhaseActive(transition, 'right', t)) sample.pose.rightFoot = { ...rightRef };
  });
  return next;
}

function applyLocomotionGaitBaseline(transition: PoseTransition, samples: AnimationClipSample[]) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || samples.length <= 2) return samples;
  const next = samples.map(cloneAnimationSample);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const durationSec = Math.max(0.0001, transition.durationSec || last.timeSec || 1);
  const travel = locomotionTravelVector(transition, samples);
  const strength = locomotionBaselineStrength(actionType);
  const window = sequenceActionWindow(transition, actionType);

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    if (t < window.startRatio || t > window.endRatio) continue;
    const localT = sequenceActionLocalRatio(transition, actionType, t);
    const motionT = semanticActionTime(transition, localT);
    const envelope = locomotionEnvelope(motionT);
    if (envelope <= 0.001) continue;

    const baseline = sampleBetween(first, last, sample.timeSec);
    const stableBasePose = locomotionStableBasePose(baseline.pose, actionType);
    const gaitFrame = locomotionGaitFrame(transition, actionType, motionT);
    const targetPose = offsetPose(stableBasePose, gaitFrame.posePatch);
    targetPose.leftFoot = slerpRotation(targetPose.leftFoot, baseline.pose.leftFoot, gaitFrame.leftStep.plant * 0.74);
    targetPose.rightFoot = slerpRotation(targetPose.rightFoot, baseline.pose.rightFoot, gaitFrame.rightStep.plant * 0.74);
    targetPose.leftUpperLeg = slerpRotation(targetPose.leftUpperLeg, stableBasePose.leftUpperLeg, gaitFrame.leftStep.plant * 0.16);
    targetPose.rightUpperLeg = slerpRotation(targetPose.rightUpperLeg, stableBasePose.rightUpperLeg, gaitFrame.rightStep.plant * 0.16);
    targetPose.leftLowerLeg = slerpRotation(targetPose.leftLowerLeg, stableBasePose.leftLowerLeg, gaitFrame.leftStep.plant * 0.14);
    targetPose.rightLowerLeg = slerpRotation(targetPose.rightLowerLeg, stableBasePose.rightLowerLeg, gaitFrame.rightStep.plant * 0.14);
    sample.pose = blendPose(sample.pose, targetPose, strength * envelope);

    const targetPosition = locomotionPlanarTargetPosition(transition, first, last, actionType, t, motionT, gaitFrame.rootLateral);
    const rootStrength = (actionType === 'walk' ? 0.52 : actionType === 'run' ? 0.58 : 0.64) * envelope;
    sample.transform.position.x = Number(lerp(sample.transform.position.x, targetPosition.x, rootStrength).toFixed(4));
    sample.transform.position.z = Number(lerp(sample.transform.position.z, targetPosition.z, rootStrength).toFixed(4));
    if (travel.distance > 0.08 && (travel.direction.x || travel.direction.z)) {
      const relativeX = sample.transform.position.x - first.transform.position.x;
      const relativeZ = sample.transform.position.z - first.transform.position.z;
      const projection = relativeX * travel.direction.x + relativeZ * travel.direction.z;
      const progress = locomotionRootProgress(actionType, t, motionT);
      const minProjection = travel.distance * Math.max(0, progress - 0.08);
      const maxProjection = travel.distance * Math.min(1, progress + 0.08);
      const clampedProjection = clampNumber(projection, minProjection, maxProjection);
      sample.transform.position.x = Number((sample.transform.position.x + (clampedProjection - projection) * travel.direction.x).toFixed(4));
      sample.transform.position.z = Number((sample.transform.position.z + (clampedProjection - projection) * travel.direction.z).toFixed(4));
    }
    const baseY = lerp(first.transform.position.y, last.transform.position.y, t);
    sample.transform.position.y = Number((baseY + Math.min(gaitFrame.rootBob, actionType === 'walk' ? 0.016 : 0.026)).toFixed(4));
  }

  return alignSampleEndpoints(next, transition);
}

function reinforceLocomotionGaitSamples(transition: PoseTransition, samples: AnimationClipSample[], report: MotionQualityReport) {
  const actionType = sequenceLocomotionActionType(transition);
  if (!isLocomotionActionType(actionType) || samples.length <= 2) return { samples, applied: false };
  const needsGaitCorrection = report.issues.some((issue) => (
    issue.metric === 'pose'
    || issue.metric === 'foot_lock'
    || issue.metric === 'speed'
  ));
  if (!needsGaitCorrection) return { samples, applied: false };

  const first = samples[0];
  const last = samples[samples.length - 1];
  const durationSec = Math.max(0.0001, transition.durationSec || last.timeSec || 1);
  const next = samples.map(cloneAnimationSample);
  const window = sequenceActionWindow(transition, actionType);
  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    if (t < window.startRatio || t > window.endRatio) continue;
    const localT = sequenceActionLocalRatio(transition, actionType, t);
    const motionT = semanticActionTime(transition, localT);
    const envelope = locomotionEnvelope(motionT);
    if (envelope <= 0.001) continue;

    const baseline = sampleBetween(first, last, sample.timeSec);
    const stableBasePose = locomotionStableBasePose(baseline.pose, actionType);
    const gaitFrame = locomotionGaitFrame(transition, actionType, motionT);
    const targetPose = offsetPose(stableBasePose, gaitFrame.posePatch);
    targetPose.leftFoot = slerpRotation(targetPose.leftFoot, baseline.pose.leftFoot, gaitFrame.leftStep.plant * 0.72);
    targetPose.rightFoot = slerpRotation(targetPose.rightFoot, baseline.pose.rightFoot, gaitFrame.rightStep.plant * 0.72);
    const targetTransform = clonePoseTransform(baseline.transform);
    targetTransform.position = locomotionPlanarTargetPosition(transition, first, last, actionType, t, motionT, gaitFrame.rootLateral);
    targetTransform.position.y += gaitFrame.rootBob;

    const strength = locomotionBaselineStrength(actionType, true);
    sample.pose = blendPose(sample.pose, targetPose, strength * envelope);
    sample.transform = blendPoseTransform(sample.transform, targetTransform, Math.min(0.7, strength * 0.72 * envelope));
  }

  return { samples: alignSampleEndpoints(next, transition), applied: true };
}

function reinforceSemanticSkillSamples(transition: PoseTransition, samples: AnimationClipSample[], report: MotionQualityReport) {
  const actionType = transition.actionPlan.semanticPlan?.actionType;
  if (!actionType || !isBasicMotionActionType(actionType) || samples.length <= 2) {
    return { samples, applied: false };
  }
  if (isLocomotionActionType(actionType)) return { samples, applied: false };
  const needsSemanticReinforcement = report.issues.some((issue) => (
    issue.metric === 'pose'
    || issue.metric === 'contact'
    || issue.metric === 'foot_lock'
  ));
  if (!needsSemanticReinforcement) return { samples, applied: false };

  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const baseStrength = isLocomotionActionType(actionType)
    ? 0.48
    : actionType === 'push' || actionType === 'pull' || actionType === 'throw'
      ? 0.42
      : 0.36;
  const next = samples.map(cloneAnimationSample);
  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    const motionT = semanticActionTime(transition, t);
    const envelope = isLocomotionActionType(actionType) ? locomotionEnvelope(motionT) : Math.min(ramp(motionT, 0.02, 0.12), 1 - ramp(motionT, 0.94, 1));
    if (envelope <= 0.001) continue;
    const reinforcedTransform = clonePoseTransform(sample.transform);
    const reinforcedPose = applySemanticActionStageOverlay(sample.pose, reinforcedTransform, transition, motionT);
    sample.pose = blendPose(sample.pose, reinforcedPose, baseStrength * envelope);
    sample.transform = blendPoseTransform(sample.transform, reinforcedTransform, Math.min(0.24, baseStrength * 0.45 * envelope));
  }
  return { samples: alignSampleEndpoints(next, transition), applied: true };
}

function reinforceActionSequenceSamples(transition: PoseTransition, samples: AnimationClipSample[], report: MotionQualityReport) {
  const sequence = transition.actionPlan.semanticPlan?.actionSequence;
  if (!sequence || sequence.length <= 1 || samples.length <= 2) return { samples, applied: false };
  const needsSequenceCorrection = report.issues.some((issue) => issue.metric === 'sequence') || sequenceQualityNeedsWindowRebalance(report);
  if (!needsSequenceCorrection) return { samples, applied: false };

  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const next = samples.map(cloneAnimationSample);
  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    const active = activeSequenceWeights(sequence, t);
    if (!active.length) continue;
    const basePose = clonePose(sample.pose);
    const baseTransform = clonePoseTransform(sample.transform);
    let blendedPose: StandardHumanRigPose | null = null;
    let blendedTransform: PoseTransform | null = null;
    let totalWeight = 0;

    active.forEach(({ step, weight }) => {
      const localT = stageProgress(t, step.startRatio, step.endRatio);
      const scopedTransition = transitionWithSequenceAction(transition, step);
      const targetTransform = clonePoseTransform(baseTransform);
      const targetPose = applySemanticActionStageOverlay(basePose, targetTransform, scopedTransition, semanticActionTime(scopedTransition, localT));
      const actionStrength = isLocomotionActionType(step.actionType)
        ? 0.46
        : step.actionType === 'push' || step.actionType === 'pull' || step.actionType === 'throw'
          ? 0.42
          : 0.38;
      const weightedStrength = actionStrength * weight;
      const mixWeight = totalWeight > 0 ? weightedStrength / (totalWeight + weightedStrength) : 1;
      blendedPose = blendedPose ? blendPose(blendedPose, targetPose, mixWeight) : targetPose;
      blendedTransform = blendedTransform ? blendPoseTransform(blendedTransform, targetTransform, mixWeight) : targetTransform;
      totalWeight += weightedStrength;
    });
    if (blendedPose && blendedTransform && totalWeight > 0.001) {
      sample.pose = blendPose(basePose, blendedPose, Math.min(0.62, totalWeight));
      sample.transform = blendPoseTransform(baseTransform, blendedTransform, Math.min(0.3, totalWeight * 0.55));
      sample.pose = applySequenceTransitionContinuity(sample.pose, sample.transform, sequence, t);
    }
  }
  return { samples: alignSampleEndpoints(applyBasicMotionContinuity(transition, next), transition), applied: true };
}

function reinforceHandContactSamples(
  samples: AnimationClipSample[],
  contacts: AnimationContactFrame[] | undefined,
  report: MotionQualityReport,
  intensity = 1
) {
  const handContacts = (contacts || []).filter((contact) => (
    (contact.kind === 'reach' || contact.kind === 'grasp' || contact.kind === 'release')
    && (contact.limb === 'leftHand' || contact.limb === 'rightHand')
  ));
  const needsHandCorrection = handContacts.length > 0 && report.issues.some((issue) => issue.metric === 'contact');
  if (!needsHandCorrection || samples.length <= 2) return { samples, applied: false };

  const next = samples.map(cloneAnimationSample);
  handContacts.forEach((contact) => {
    const hand = contact.limb === 'leftHand' ? 'left' : 'right';
    const windowSec = (contact.kind === 'grasp' ? 0.32 : contact.kind === 'release' ? 0.18 : 0.26) * clampNumber(intensity, 1, 1.65);
    const baseStrength = (contact.kind === 'release' ? 0.52 : contact.kind === 'grasp' ? 0.72 : 0.64) * clampNumber(intensity, 1, 1.35);
    next.forEach((sample, index) => {
      if (index === 0 || index === next.length - 1) return;
      const distanceSec = Math.abs(sample.timeSec - contact.timeSec);
      const strength = clamp01(1 - distanceSec / windowSec);
      if (strength <= 0.001) return;
      const aimOffset = contact.kind === 'release' ? 0.1 : 0.06;
      const solved = solveArmIkToTarget(sample.pose, hand, contact.position, sample.transform.position, aimOffset);
      sample.pose = blendPose(sample.pose, solved.pose, Math.min(0.92, baseStrength * strength));
    });
  });
  return { samples: next, applied: true };
}

function stabilizeSemanticContactSamples(scene: Scene3DState, transition: PoseTransition, samples: AnimationClipSample[], strength = 0.58) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (!semanticPlan || samples.length <= 2) return samples;
  const sequenceHasContact = semanticPlan.actionType === 'push'
    || semanticPlan.actionType === 'pull'
    || semanticPlan.actionType === 'throw'
    || Boolean(semanticPlan.actionSequence?.some((step) => step.actionType === 'push' || step.actionType === 'pull' || step.actionType === 'throw'));
  if (!sequenceHasContact) return samples;
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const control = motionControlFromPrompt(transition.actionPrompt, semanticPlan);
  const next = samples.map(cloneAnimationSample);
  const baseFeet = samples[0]?.pose;

  for (let index = 1; index < next.length - 1; index += 1) {
    const sample = next[index];
    const t = clamp01(sample.timeSec / durationSec);
    const actionType = semanticContactActionAtTime(transition, t);
    if (actionType !== 'push' && actionType !== 'pull' && actionType !== 'throw') continue;
    const localT = semanticSequenceLocalRatio(transition, actionType, t);
    const window = semanticContactWindow(actionType, localT, control);
    const contactStrength = clamp01(Math.max(window.contact, actionType === 'throw' ? window.hold : 0) * strength);
    if (contactStrength <= 0.02) continue;

    const reinforcedTransform = clonePoseTransform(sample.transform);
    const reinforcedPose = applySemanticActionStageOverlay(sample.pose, reinforcedTransform, transition, semanticActionTime(transition, t));
    sample.pose = blendPose(sample.pose, reinforcedPose, contactStrength * (actionType === 'throw' ? 0.34 : 0.42));
    if (baseFeet && (actionType === 'push' || actionType === 'pull')) {
      sample.pose.leftFoot = slerpRotation(sample.pose.leftFoot, baseFeet.leftFoot, contactStrength * 0.62);
      sample.pose.rightFoot = slerpRotation(sample.pose.rightFoot, baseFeet.rightFoot, contactStrength * 0.62);
    }

    semanticContactLimbsForAction(actionType, transition.actionPrompt).forEach((limb) => {
      const target = semanticHandTargetForLimb(scene, transition, sample.transform, t, limb);
      if (!target) return;
      const hand = limb === 'leftHand' ? 'left' : 'right';
      const aimOffset = actionType === 'throw' ? 0.08 : 0.045;
      const solved = solveArmIkToTarget(sample.pose, hand, target.position, sample.transform.position, aimOffset);
      sample.pose = blendPose(sample.pose, solved.pose, contactStrength * (actionType === 'throw' ? 0.68 : 0.84));
    });
  }

  return alignSampleEndpoints(next, transition);
}

function stabilizeActionSequenceBridgeSamples(transition: PoseTransition, samples: AnimationClipSample[], strength = 0.56) {
  const sequence = transition.actionPlan.semanticPlan?.actionSequence;
  if (!sequence || sequence.length <= 1 || samples.length <= 4) return samples;
  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const next = samples.map(cloneAnimationSample);

  for (let sequenceIndex = 0; sequenceIndex < sequence.length - 1; sequenceIndex += 1) {
    const current = sequence[sequenceIndex];
    const following = sequence[sequenceIndex + 1];
    const boundaryRatio = clamp01((current.endRatio + following.startRatio) / 2);
    const boundarySec = durationSec * boundaryRatio;
    const windowSec = clampNumber(durationSec * sequenceActionOverlap(current.actionType, following.actionType) * 1.45, 0.12, 0.34);
    const beforeAnchor = sampleAnimationSamplesAtTime(samples, boundarySec - windowSec);
    const afterAnchor = sampleAnimationSamplesAtTime(samples, boundarySec + windowSec);
    if (!beforeAnchor || !afterAnchor) continue;

    for (let index = 1; index < next.length - 1; index += 1) {
      const sample = next[index];
      const distanceSec = Math.abs(sample.timeSec - boundarySec);
      if (distanceSec > windowSec) continue;
      const localT = clamp01((sample.timeSec - (boundarySec - windowSec)) / Math.max(0.0001, windowSec * 2));
      const bridge = sampleBetween(beforeAnchor, afterAnchor, sample.timeSec);
      const bridgeStrength = clamp01(strength * Math.sin(localT * Math.PI));
      if (bridgeStrength <= 0.001) continue;

      const transitionPatch = sequenceTransitionPatch(current.actionType, following.actionType, easeCurve('ease_in_out', localT));
      const transitionPose = Object.keys(transitionPatch).length ? offsetPose(bridge.pose, transitionPatch) : bridge.pose;
      const previous = samples[Math.max(0, index - 1)];
      const subsequent = samples[Math.min(samples.length - 1, index + 1)];
      const stableTransform = {
        ...bridge.transform,
        position: blendVec3(bridge.transform.position, averageVec3(previous.transform.position, subsequent.transform.position), 0.22),
        rotation: smoothRotationSample(previous.transform.rotation, bridge.transform.rotation, subsequent.transform.rotation, 0.2)
      };

      sample.transform = blendPoseTransform(sample.transform, stableTransform, bridgeStrength * 0.58);
      sample.pose = blendPose(sample.pose, transitionPose, bridgeStrength * 0.46);
      if (isLocomotionActionType(current.actionType) && (following.actionType === 'push' || following.actionType === 'pull' || following.actionType === 'reach')) {
        sample.transform.position.y = Number((sample.transform.position.y - 0.01 * bridgeStrength).toFixed(4));
        sample.pose.leftFoot = slerpRotation(sample.pose.leftFoot, beforeAnchor.pose.leftFoot, bridgeStrength * 0.32);
        sample.pose.rightFoot = slerpRotation(sample.pose.rightFoot, beforeAnchor.pose.rightFoot, bridgeStrength * 0.32);
      }
      if (current.actionType === 'turn' && (following.actionType === 'throw' || following.actionType === 'punch' || following.actionType === 'kick' || following.actionType === 'side_kick')) {
        sample.pose.chest = slerpRotation(sample.pose.chest, transitionPose.chest, bridgeStrength * 0.28);
        sample.pose.pelvis = slerpRotation(sample.pose.pelvis, transitionPose.pelvis, bridgeStrength * 0.24);
      }
    }
  }

  return alignSampleEndpoints(next, transition);
}

function smoothActionSequenceBoundaries(transition: PoseTransition, samples: AnimationClipSample[]) {
  const sequence = transition.actionPlan.semanticPlan?.actionSequence;
  if (!sequence || sequence.length <= 1 || samples.length <= 4) return samples;

  const durationSec = Math.max(0.0001, transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const boundaryPairs = sequence.slice(0, -1).map((step, index) => ({
    step,
    following: sequence[index + 1],
    ratio: clamp01((step.endRatio + sequence[index + 1].startRatio) / 2)
  })).filter((item) => item.ratio > 0.001 && item.ratio < 0.999);
  if (!boundaryPairs.length) return samples;

  const source = samples.map(cloneAnimationSample);
  const next = samples.map(cloneAnimationSample);

  boundaryPairs.forEach(({ step, following, ratio }) => {
    const boundarySec = durationSec * ratio;
    const highEnergyBridge = isLocomotionActionType(step.actionType)
      || isLocomotionActionType(following.actionType)
      || ['push', 'pull', 'throw', 'punch', 'kick', 'side_kick'].includes(step.actionType)
      || ['push', 'pull', 'throw', 'punch', 'kick', 'side_kick'].includes(following.actionType);
    const windowSec = clampNumber(durationSec * (highEnergyBridge ? 0.075 : 0.06), highEnergyBridge ? 0.13 : 0.1, highEnergyBridge ? 0.3 : 0.22);
    const beforeAnchor = sampleAnimationSamplesAtTime(source, boundarySec - windowSec);
    const afterAnchor = sampleAnimationSamplesAtTime(source, boundarySec + windowSec);
    if (!beforeAnchor || !afterAnchor) return;

    for (let index = 1; index < source.length - 1; index += 1) {
      const current = source[index];
      const distanceSec = Math.abs(current.timeSec - boundarySec);
      if (distanceSec > windowSec) continue;
      const previous = source[index - 1];
      const following = source[index + 1];
      const localT = clamp01((current.timeSec - (boundarySec - windowSec)) / Math.max(0.0001, windowSec * 2));
      const boundaryCurve = sampleBetween(beforeAnchor, afterAnchor, current.timeSec);
      const strength = 0.58 * easeCurve('ease_in_out', clamp01(1 - distanceSec / windowSec));
      if (strength <= 0.001) continue;

      const transformTarget = {
        ...boundaryCurve.transform,
        position: blendVec3(boundaryCurve.transform.position, averageVec3(previous.transform.position, following.transform.position), 0.32),
        rotation: smoothRotationSample(previous.transform.rotation, boundaryCurve.transform.rotation, following.transform.rotation, 0.28)
      };
      next[index].transform = blendPoseTransform(current.transform, transformTarget, strength * (0.62 + Math.sin(localT * Math.PI) * 0.18));
      for (const joint of POSE_KEYS) {
        if (shouldPreserveJointDuringSmoothing(transition, joint, current)) {
          next[index].pose[joint] = { ...current.pose[joint] };
          continue;
        }
        const curvePose = slerpRotation(current.pose[joint], boundaryCurve.pose[joint], strength * 0.54);
        next[index].pose[joint] = smoothRotationSample(previous.pose[joint], curvePose, following.pose[joint], strength * 0.42);
      }
    }
  });

  next[0] = cloneAnimationSample(samples[0]);
  next[next.length - 1] = cloneAnimationSample(samples[samples.length - 1]);
  return next;
}

function polishMotionSamples(transition: PoseTransition, samples: AnimationClipSample[]) {
  let next = samples.map(cloneAnimationSample);
  next = applyLocomotionGaitBaseline(transition, next);
  next = applyLocomotionPhaseConsistency(transition, next, 0.38);
  next = applyPromptControlPoseReinforcement(transition, next);
  next = stabilizeGroundedMotionSamples(transition, next);
  next = enforceLocomotionRootProgression(transition, next, 0.62);
  next = smoothMotionSamples(transition, next);
  next = smoothActionSequenceBoundaries(transition, next);
  next = stabilizeActionSequenceBridgeSamples(transition, next, 0.48);
  next = applyBasicMotionContinuity(transition, next);
  next = stabilizeLocomotionFootPhases(transition, next);
  next = applyLocomotionPhaseConsistency(transition, next, 0.52);
  next = applyLocomotionGoldenStandard(transition, next, 0.54);
  next = applyPromptControlPoseReinforcement(transition, next);
  next = enforceLocomotionRootProgression(transition, next, 0.74);
  next = smoothRootVelocityContinuity(transition, next);
  next = finalizeLocomotionGoldenStandard(transition, next, 0.64);
  next = clampNonAirborneRootMotion(next, transition);
  next = dampExcessivePoseDeltas(next, transition);
  next = reapplyFootLockPoses(next, transition);
  return alignSampleEndpoints(next, transition);
}

function qualityDrivenCorrectionIntensity(report: MotionQualityReport, metric: MotionQualityIssue['metric']) {
  const severeCount = report.issues.filter((issue) => issue.metric === metric && issue.severity === 'error').length;
  const warningCount = report.issues.filter((issue) => issue.metric === metric && issue.severity === 'warning').length;
  return clampNumber(1 + severeCount * 0.35 + warningCount * 0.16, 1, 1.65);
}

function failedQualityExpectationIds(transition: PoseTransition, report: MotionQualityReport) {
  const expectations = transition.actionPlan.semanticPlan?.qualityExpectations || [];
  return new Set(expectations
    .filter((expectation) => report.issues.some((issue) => (
      issue.message.includes(`“${expectation.label}”期望`)
      || issue.message.includes(expectation.description)
    )))
    .map((expectation) => expectation.id));
}

function reinforceExpectationDrivenFailures(
  scene: Scene3DState,
  transition: PoseTransition,
  samples: AnimationClipSample[],
  report: MotionQualityReport,
  contacts?: AnimationContactFrame[]
) {
  const failed = failedQualityExpectationIds(transition, report);
  if (!failed.size) return { samples, notes: [] as string[] };
  let next = samples.map(cloneAnimationSample);
  const notes: string[] = [];

  if (
    failed.has('locomotion_gait')
    || failed.has('locomotion_support')
    || failed.has('locomotion_travel')
    || failed.has('locomotion_smoothness')
    || failed.has('locomotion_arm_sync')
  ) {
    const gaitCorrection = reinforceLocomotionGaitSamples(transition, next, report);
    next = gaitCorrection.applied ? gaitCorrection.samples : applyLocomotionGaitBaseline(transition, next);
    next = applyLocomotionPhaseConsistency(transition, next, failed.has('locomotion_arm_sync') ? 0.68 : 0.56);
    next = stabilizeLocomotionFootPhases(transition, next);
    next = applyLocomotionGoldenStandard(transition, next, failed.has('locomotion_smoothness') ? 0.68 : 0.6);
    next = enforceLocomotionRootProgression(transition, next, failed.has('locomotion_travel') ? 0.94 : failed.has('locomotion_smoothness') ? 0.9 : 0.86);
    if (failed.has('locomotion_smoothness')) next = smoothRootVelocityContinuity(transition, next);
    next = reapplyFootLockPoses(next, transition);
    notes.push('已根据走跑质量期望定向补强步态、手脚同步、支撑脚和根节点平滑推进。');
  }

  if (failed.has('target_approach')) {
    next = stabilizeTargetApproachSequenceSamples(scene, transition, next);
    next = enforceLocomotionRootProgression(transition, stabilizeGroundedMotionSamples(transition, next), 0.9);
    next = smoothRootVelocityContinuity(transition, next);
    notes.push('已根据接触前靠近目标期望定向强化根节点靠近轨迹。');
  }

  if (failed.has('hand_contact') || failed.has('contact_window') || failed.has('prompt_both_hands')) {
    const handCorrection = reinforceHandContactSamples(next, contacts, report, Math.max(1.2, qualityDrivenCorrectionIntensity(report, 'contact')));
    if (handCorrection.applied) next = handCorrection.samples;
    notes.push('已根据手部接触和接触窗口期望定向扩大接触窗口并重算手臂 IK。');
  }

  if (
    failed.has('contact_body_drive')
    || failed.has('contact_window')
    || failed.has('contact_foot_anchor')
    || failed.has('prop_contact_motion')
    || failed.has('throw_body_windup')
    || failed.has('throw_release')
    || failed.has('throw_prop_motion')
    || failed.has('turn_throw_bridge')
    || failed.has('punch_extension')
    || failed.has('punch_recovery')
    || failed.has('punch_body_drive')
    || failed.has('low_recovery_attack_bridge')
    || failed.has('prompt_low_center')
    || failed.has('prompt_forward_lean')
    || failed.has('prompt_grounded_feet')
    || failed.has('prompt_both_hands')
    || failed.has('approach_contact_bridge')
  ) {
    const semanticCorrection = reinforceSemanticSkillSamples(transition, next, report);
    next = semanticCorrection.applied ? semanticCorrection.samples : next;
    next = applyPromptControlPoseReinforcement(transition, next);
    next = stabilizeGroundedMotionSamples(transition, next);
    const handCorrection = reinforceHandContactSamples(next, contacts, report, Math.max(1.24, qualityDrivenCorrectionIntensity(report, 'contact')));
    if (handCorrection.applied) next = handCorrection.samples;
    next = smoothMotionSamples(transition, next);
    notes.push('已根据接触/投掷/出拳质量期望定向强化身体发力、脚部支撑、释放点、回收和目标响应。');
  }

  if (
    failed.has('sequence_order')
    || failed.has('sequence_bridge')
    || failed.has('approach_contact_bridge')
    || failed.has('turn_throw_bridge')
    || failed.has('low_recovery_attack_bridge')
  ) {
    const sequenceTransition = transitionWithQualityAdjustedActionSequence(transition, report);
    next = stabilizeActionSequenceBridgeSamples(sequenceTransition, smoothActionSequenceBoundaries(sequenceTransition, reinforceActionSequenceSamples(sequenceTransition, next, report).samples), 0.68);
    next = applyBasicMotionContinuity(sequenceTransition, next);
    notes.push('已根据动作顺序和阶段承接期望定向补强动作段落承接。');
    if (failed.has('approach_contact_bridge')) notes.push('已针对“靠近后接触”链路补强移动减速、手部接触和发力承接。');
    if (failed.has('turn_throw_bridge')) notes.push('已针对“转身后投掷”链路补强转身、蓄力、释放和回收承接。');
    if (failed.has('low_recovery_attack_bridge')) notes.push('已针对“下沉恢复后攻击”链路补强低重心、起身恢复和最终攻击承接。');
  }

  return { samples: alignSampleEndpoints(next, transition), notes };
}

function reinforceQualitySpecificFailures(
  scene: Scene3DState,
  transition: PoseTransition,
  samples: AnimationClipSample[],
  report: MotionQualityReport,
  contacts?: AnimationContactFrame[]
) {
  let next = samples.map(cloneAnimationSample);
  const notes: string[] = [];

  const expectationCorrection = reinforceExpectationDrivenFailures(scene, transition, next, report, contacts);
  if (expectationCorrection.notes.length) {
    next = expectationCorrection.samples;
    notes.push(...expectationCorrection.notes);
  }

  const hasSequenceTimeIssue = report.issues.some((issue) => issue.metric === 'sequence' && issue.message.includes('阶段时间过短'));
  const hasSequenceBoundaryIssue = report.issues.some((issue) => issue.metric === 'sequence' && (
    issue.message.includes('过渡不够平滑')
    || issue.message.includes('缺少承接重叠')
    || issue.message.includes('混合过多')
    || issue.message.includes('顺序相反')
  ));
  if (hasSequenceTimeIssue || hasSequenceBoundaryIssue) {
    const sequenceTransition = transitionWithQualityAdjustedActionSequence(transition, report);
    next = stabilizeActionSequenceBridgeSamples(sequenceTransition, smoothActionSequenceBoundaries(sequenceTransition, reinforceActionSequenceSamples(sequenceTransition, next, report).samples), 0.66);
    next = applyBasicMotionContinuity(sequenceTransition, next);
    notes.push('已根据动作序列质检重新加强阶段承接和段落边界平滑。');
  }

  const handSuccessRatio = report.metrics.semanticHandContactSuccessRatio;
  const handDistance = report.metrics.semanticHandReachDistance;
  if ((handSuccessRatio !== undefined && handSuccessRatio < 0.65) || (handDistance !== undefined && handDistance > 0.62)) {
    const handCorrection = reinforceHandContactSamples(next, contacts, report, qualityDrivenCorrectionIntensity(report, 'contact'));
    if (handCorrection.applied) {
      next = handCorrection.samples;
      notes.push('已根据手部接触质检扩大接触窗口并重新贴近目标。');
    }
  }

  if ((report.metrics.semanticTargetApproachDistance || 0) > 0.55) {
    next = enforceLocomotionRootProgression(transition, stabilizeGroundedMotionSamples(transition, next), 0.88);
    next = smoothRootVelocityContinuity(transition, next);
    notes.push('已根据目标接近质检重新强化角色移动到接触目标前的根节点轨迹。');
  }

  if (
    (report.metrics.semanticContactBodyDrive !== undefined && report.metrics.semanticContactBodyDrive < 8)
    || (report.metrics.semanticContactFootStability !== undefined && report.metrics.semanticContactFootStability < 0.42)
    || (report.metrics.semanticPropMotionDistance !== undefined && report.metrics.semanticPropMotionDistance < 0.14)
    || (report.metrics.semanticThrowReleaseDistance !== undefined && report.metrics.semanticThrowReleaseDistance < 0.62)
  ) {
    const semanticCorrection = reinforceSemanticSkillSamples(transition, next, report);
    next = stabilizeGroundedMotionSamples(transition, semanticCorrection.applied ? semanticCorrection.samples : next);
    const handCorrection = reinforceHandContactSamples(next, contacts, report, qualityDrivenCorrectionIntensity(report, 'contact'));
    if (handCorrection.applied) next = handCorrection.samples;
    notes.push('已根据接触动作质检重新强化身体发力、脚部支撑、手部接触和目标物体运动。');
  }

  const qualityTarget = motionQualityTargetForTransition(transition);
  if (
    report.metrics.locomotionRootBacktrackCount
    || (report.metrics.locomotionRootStepJitter !== undefined && report.metrics.locomotionRootStepJitter > (qualityTarget.maxRootStepJitter || 0.65))
    || (report.metrics.locomotionPaceCoverageRatio !== undefined && report.metrics.locomotionPaceCoverageRatio < 0.64 && (report.metrics.locomotionExpectedTravelDistance || 0) > 0.08)
    || (report.metrics.sequenceBoundaryMaxVelocityRatio !== undefined && report.metrics.sequenceBoundaryMaxVelocityRatio > 2.55)
    || (report.metrics.locomotionFootPlantDrift !== undefined && report.metrics.locomotionFootPlantDrift > (qualityTarget.maxFootPlantDrift || 9))
    || (report.metrics.locomotionFootPhaseMismatchCount !== undefined && report.metrics.locomotionFootPhaseMismatchCount > 0)
    || (report.metrics.locomotionSupportSwitchCount !== undefined && report.metrics.locomotionSupportSwitchCount < 1)
    || (report.metrics.locomotionSupportCoverageRatio !== undefined && report.metrics.locomotionSupportCoverageRatio < 0.32)
    || (report.metrics.locomotionArmSwingSeparation !== undefined && report.metrics.locomotionArmSwingSeparation < (qualityTarget.minArmSwingSeparation || 10))
    || (report.metrics.locomotionArmLegSyncScore !== undefined && report.metrics.locomotionArmLegSyncScore < 0.34)
    || (report.metrics.locomotionLegSeparation !== undefined && report.metrics.locomotionLegSeparation < (qualityTarget.minLegSeparation || 10))
    || (report.metrics.locomotionLegSignChanges !== undefined && report.metrics.locomotionLegSignChanges < 1)
  ) {
    next = reapplyFootLockPoses(
      enforceLocomotionRootProgression(
        transition,
        finalizeLocomotionGoldenStandard(transition, reinforceLocomotionGaitSamples(transition, next, report).samples, 0.78),
        0.86
      ),
      transition
    );
    notes.push('已根据走跑质检重新强化根节点推进、左右腿交替、支撑脚交替、脚步相位和手臂反向摆动。');
  }

  return { samples: next, notes };
}

function autoCorrectMotionSamples(
  scene: Scene3DState,
  transition: PoseTransition,
  samples: AnimationClipSample[],
  report: MotionQualityReport,
  contacts?: AnimationContactFrame[]
) {
  const notes: string[] = [];
  if (!motionQualityNeedsAutoCorrection(report)) {
    return { samples, notes };
  }
  let corrected = samples.map(cloneAnimationSample);
  const diagnosis = diagnoseMotionQuality(report);
  const sequenceAdjustedTransition = transitionWithQualityAdjustedActionSequence(transition, report);
  const hasRootIssue = diagnosis.locomotionNeedsRoot || report.issues.some((issue) => issue.metric === 'speed' || issue.metric === 'rotation' || issue.metric === 'endpoint');
  const hasPoseIssue = diagnosis.locomotionNeedsGait || diagnosis.sequenceNeedsSmoothing || diagnosis.excessivePoseNeedsDamping || report.issues.some((issue) => issue.metric === 'pose' || issue.metric === 'foot_lock' || issue.metric === 'sequence');
  if (hasRootIssue) {
    corrected = stabilizeGroundedMotionSamples(transition, corrected);
    corrected = smoothMotionSamples(transition, corrected);
    corrected = enforceLocomotionRootProgression(transition, corrected, 0.82);
    corrected = smoothRootVelocityContinuity(transition, corrected);
    corrected = enforceLocomotionRootProgression(transition, corrected, 0.9);
    corrected = smoothMotionSamples(transition, corrected);
    notes.push('已根据质量检查自动平滑根节点轨迹。');
  }
  if (diagnosis.airborneNeedsClamp) {
    corrected = clampNonAirborneRootMotion(corrected, transition);
    notes.push('已根据质量检查限制非跳跃动作离地幅度。');
  }
  const gaitCorrection = reinforceLocomotionGaitSamples(transition, corrected, report);
  if (gaitCorrection.applied || diagnosis.locomotionNeedsGait || diagnosis.locomotionNeedsRoot) {
    corrected = gaitCorrection.applied ? gaitCorrection.samples : applyLocomotionGaitBaseline(transition, corrected);
    corrected = finalizeLocomotionGoldenStandard(transition, corrected, diagnosis.locomotionNeedsGait || diagnosis.locomotionNeedsRoot ? 0.82 : 0.64);
    notes.push('已根据动作质量检查重算走跑步态、左右腿交替和根节点连续性。');
  }
  const semanticCorrection = reinforceSemanticSkillSamples(transition, corrected, report);
  if (semanticCorrection.applied) {
    corrected = semanticCorrection.samples;
    notes.push('已根据动作质量检查补强动作技能阶段和主导肢体轨迹。');
  }
  const sequenceCorrection = reinforceActionSequenceSamples(transition, corrected, report);
  if (sequenceCorrection.applied || diagnosis.sequenceNeedsSmoothing) {
    corrected = sequenceCorrection.applied ? sequenceCorrection.samples : corrected;
    corrected = reinforceActionSequenceSamples(sequenceAdjustedTransition, corrected, report).samples;
    corrected = smoothActionSequenceBoundaries(sequenceAdjustedTransition, corrected);
    corrected = stabilizeActionSequenceBridgeSamples(sequenceAdjustedTransition, corrected, 0.68);
    corrected = applyBasicMotionContinuity(sequenceAdjustedTransition, corrected);
    notes.push('已根据动作序列质检补强每一段动作的步态、接触点和主导肢体轨迹。');
  }
  const handContactCorrection = reinforceHandContactSamples(corrected, contacts, report, diagnosis.contactNeedsCorrection ? qualityDrivenCorrectionIntensity(report, 'contact') : 1);
  if (handContactCorrection.applied) {
    corrected = handContactCorrection.samples;
    notes.push('已根据接触点质检校正手部靠近目标的位置。');
  }
  const qualitySpecificCorrection = reinforceQualitySpecificFailures(scene, transition, corrected, report, contacts);
  if (qualitySpecificCorrection.notes.length) {
    corrected = qualitySpecificCorrection.samples;
    notes.push(...qualitySpecificCorrection.notes);
  }
  corrected = stabilizeSemanticContactSamples(scene, transition, corrected, diagnosis.contactNeedsCorrection ? 0.72 : 0.62);
  if (hasPoseIssue) {
    corrected = applyBasicMotionContinuity(transition, stabilizeGroundedMotionSamples(transition, applyPromptControlPoseReinforcement(transition, corrected)));
    corrected = enforceLocomotionRootProgression(transition, corrected, 0.84);
    corrected = smoothRootVelocityContinuity(transition, corrected);
    corrected = dampExcessivePoseDeltas(corrected, transition);
    corrected = reapplyFootLockPoses(corrected, transition);
    notes.push('已根据质量检查降低关节跳变并重应用脚部锁定。');
  }
  corrected = polishMotionSamples(sequenceAdjustedTransition, corrected);
  return { samples: corrected, notes };
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

function locomotionAlternationStats(samples: AnimationClipSample[]) {
  let maxLegSeparation = 0;
  let signChanges = 0;
  let previousSign = 0;
  samples.forEach((sample, index) => {
    if (index === 0 || index === samples.length - 1) return;
    const delta = sample.pose.leftUpperLeg.x - sample.pose.rightUpperLeg.x;
    maxLegSeparation = Math.max(maxLegSeparation, Math.abs(delta));
    const sign = Math.abs(delta) < 1 ? 0 : delta > 0 ? 1 : -1;
    if (!sign) return;
    if (previousSign && sign !== previousSign) signChanges += 1;
    previousSign = sign;
  });
  return { maxLegSeparation, signChanges };
}

function locomotionSupportStats(transition: PoseTransition, clip: SerializedAnimationClip) {
  const actionType = sequenceLocomotionActionType(transition);
  const samples = clip.samples;
  if (!isLocomotionActionType(actionType) || samples.length <= 2) {
    return {
      footPlantDrift: 0,
      rootStepJitter: 0,
      footContactCount: 0,
      footPhaseMismatchCount: 0,
      rootBacktrackCount: 0,
      rootTravelDistance: 0,
      expectedTravelDistance: 0,
      paceCoverageRatio: 1,
      supportSwitchCount: 0,
      supportCoverageRatio: 1,
      armSwingSeparation: 0,
      armLegSyncScore: 1
    };
  }
  const durationSec = Math.max(0.0001, clip.durationSec || transition.durationSec || samples[samples.length - 1].timeSec || 1);
  const plantRefs: Record<'left' | 'right', RigRotation | null> = { left: null, right: null };
  let footPlantDrift = 0;
  const rootSteps: number[] = [];
  let rootBacktrackCount = 0;
  let supportSwitchCount = 0;
  let previousSupport: 'left' | 'right' | null = null;
  let supportSampleCount = 0;
  let activeSampleCount = 0;
  let armSwingSeparation = 0;
  const syncPairs: Array<{ leg: number; arm: number }> = [];
  const travel = locomotionTravelVector(transition, samples);
  const window = sequenceActionWindow(transition, actionType);
  const gaitDurationSec = locomotionEffectiveDurationSec(transition, actionType);
  const tempoScale = locomotionGaitTempoScale(transition, actionType);
  const expectedTravelDistance = promptRequestsInPlaceMotion(transition.actionPrompt)
    ? 0
    : promptLocomotionTravelDistance(transition);

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const currentRatio = clamp01(current.timeSec / durationSec);
    if (!ratioInActionWindow(transition, actionType, currentRatio, 0.015)) continue;
    const stepX = current.transform.position.x - previous.transform.position.x;
    const stepZ = current.transform.position.z - previous.transform.position.z;
    rootSteps.push(Math.hypot(stepX, stepZ));
    const projection = stepX * travel.direction.x + stepZ * travel.direction.z;
    if (travel.distance > 0.08 && projection < -0.006) rootBacktrackCount += 1;
  }

  for (const sample of samples) {
    const t = clamp01(sample.timeSec / durationSec);
    if (t < window.startRatio || t > window.endRatio) continue;
    const localT = sequenceActionLocalRatio(transition, actionType, t);
    const motionT = semanticActionTime(transition, localT);
    const leftPlant = gaitFootPlantStrength(actionType, 'left', motionT, gaitDurationSec, tempoScale);
    const rightPlant = gaitFootPlantStrength(actionType, 'right', motionT, gaitDurationSec, tempoScale);
    const dominantSupport = Math.max(leftPlant, rightPlant) > 0.24 && Math.abs(leftPlant - rightPlant) > 0.12
      ? leftPlant > rightPlant ? 'left' : 'right'
      : null;
    activeSampleCount += 1;
    if (dominantSupport) supportSampleCount += 1;
    if (dominantSupport && previousSupport && dominantSupport !== previousSupport) supportSwitchCount += 1;
    if (dominantSupport) previousSupport = dominantSupport;
    armSwingSeparation = Math.max(armSwingSeparation, Math.abs(sample.pose.leftUpperArm.x - sample.pose.rightUpperArm.x));
    syncPairs.push({
      leg: sample.pose.leftUpperLeg.x - sample.pose.rightUpperLeg.x,
      arm: sample.pose.rightUpperArm.x - sample.pose.leftUpperArm.x
    });

    for (const limb of ['left', 'right'] as const) {
      const poseKey: PoseJointKey = limb === 'left' ? 'leftFoot' : 'rightFoot';
      const plant = limb === 'left' ? leftPlant : rightPlant;
      if (plant < 0.42) {
        plantRefs[limb] = null;
        continue;
      }
      if (!plantRefs[limb]) {
        plantRefs[limb] = { ...sample.pose[poseKey] };
        continue;
      }
      footPlantDrift = Math.max(footPlantDrift, poseJointDelta(sample.pose[poseKey], plantRefs[limb]));
    }
  }

  const meanStep = rootSteps.length ? rootSteps.reduce((total, value) => total + value, 0) / rootSteps.length : 0;
  const variance = rootSteps.length
    ? rootSteps.reduce((total, value) => total + Math.pow(value - meanStep, 2), 0) / rootSteps.length
    : 0;
  const rootStepJitter = meanStep > 0.0001 ? Math.sqrt(variance) / meanStep : 0;
  const supportCoverageRatio = activeSampleCount ? supportSampleCount / activeSampleCount : 1;
  const paceCoverageRatio = expectedTravelDistance > 0.001 ? Math.min(1.6, travel.distance / expectedTravelDistance) : 1;
  const meanLeg = syncPairs.length ? syncPairs.reduce((total, item) => total + item.leg, 0) / syncPairs.length : 0;
  const meanArm = syncPairs.length ? syncPairs.reduce((total, item) => total + item.arm, 0) / syncPairs.length : 0;
  const covariance = syncPairs.reduce((total, item) => total + (item.leg - meanLeg) * (item.arm - meanArm), 0);
  const legVariance = syncPairs.reduce((total, item) => total + Math.pow(item.leg - meanLeg, 2), 0);
  const armVariance = syncPairs.reduce((total, item) => total + Math.pow(item.arm - meanArm, 2), 0);
  const armLegCorrelation = legVariance > 0.001 && armVariance > 0.001
    ? clampNumber(covariance / Math.sqrt(legVariance * armVariance), -1, 1)
    : -1;
  const armLegSyncScore = Math.max(0, -armLegCorrelation);
  const footContactCount = clip.contacts.filter((item) => {
    if (item.kind !== 'foot_lock' || (item.limb !== 'leftFoot' && item.limb !== 'rightFoot')) return false;
    const ratio = clamp01(item.timeSec / durationSec);
    return ratioInActionWindow(transition, actionType, ratio, 0.02);
  }).length;
  const footPhaseMismatchCount = clip.contacts.filter((item) => {
    if (item.kind !== 'foot_lock' || (item.limb !== 'leftFoot' && item.limb !== 'rightFoot')) return false;
    const ratio = clamp01(item.timeSec / durationSec);
    if (!ratioInActionWindow(transition, actionType, ratio, 0.02)) return false;
    const localT = sequenceActionLocalRatio(transition, actionType, ratio);
    const motionT = semanticActionTime(transition, localT);
    const limb = item.limb === 'leftFoot' ? 'left' : 'right';
    return gaitFootPlantStrength(actionType, limb, motionT, gaitDurationSec, tempoScale) < 0.24;
  }).length;

  return {
    footPlantDrift: Number(footPlantDrift.toFixed(2)),
    rootStepJitter: Number(rootStepJitter.toFixed(3)),
    footContactCount,
    footPhaseMismatchCount,
    rootBacktrackCount,
    rootTravelDistance: Number(travel.distance.toFixed(3)),
    expectedTravelDistance: Number(expectedTravelDistance.toFixed(3)),
    paceCoverageRatio: Number(paceCoverageRatio.toFixed(3)),
    supportSwitchCount,
    supportCoverageRatio: Number(supportCoverageRatio.toFixed(3)),
    armSwingSeparation: Number(armSwingSeparation.toFixed(2)),
    armLegSyncScore: Number(armLegSyncScore.toFixed(3))
  };
}

function semanticTimingStats(clip: SerializedAnimationClip) {
  const samples = clip.samples;
  if (samples.length <= 3) return { peakRatio: 0, speedContrast: 0 };
  const speeds: Array<{ ratio: number; speed: number }> = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const dt = Math.max(0.0001, current.timeSec - previous.timeSec);
    const rootDistance = Math.hypot(
      current.transform.position.x - previous.transform.position.x,
      current.transform.position.y - previous.transform.position.y,
      current.transform.position.z - previous.transform.position.z
    );
    const poseMotion = POSE_KEYS.reduce((total, key) => total + poseJointDelta(previous.pose[key], current.pose[key]), 0) / POSE_KEYS.length;
    speeds.push({ ratio: clamp01(current.timeSec / Math.max(0.0001, clip.durationSec)), speed: (rootDistance + poseMotion / 260) / dt });
  }
  const peak = speeds.reduce((best, item) => item.speed > best.speed ? item : best, speeds[0]);
  const mean = speeds.reduce((total, item) => total + item.speed, 0) / speeds.length;
  return {
    peakRatio: Number(peak.ratio.toFixed(3)),
    speedContrast: Number((peak.speed / Math.max(0.0001, mean)).toFixed(3))
  };
}

function motionContinuityStats(samples: AnimationClipSample[], protectedTimes: number[] = []) {
  if (samples.length <= 2) {
    return { rootVelocitySpikeRatio: 1, poseVelocitySpikeRatio: 1, maxPoseVelocity: 0 };
  }
  const rootSpeeds: number[] = [];
  const poseSpeeds: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (intervalTouchesExplicitKeyframe(previous.timeSec, current.timeSec, protectedTimes)) continue;
    const dt = Math.max(0.0001, current.timeSec - previous.timeSec);
    rootSpeeds.push(vecDistance(previous.transform.position, current.transform.position) / dt);
    const poseDelta = POSE_KEYS.reduce((total, key) => total + poseJointDelta(previous.pose[key], current.pose[key]), 0) / POSE_KEYS.length;
    poseSpeeds.push(poseDelta / dt);
  }
  const ratio = (values: number[]) => {
    const active = values.filter((value) => value > 0.0001);
    if (active.length <= 1) return 1;
    const mean = active.reduce((total, value) => total + value, 0) / active.length;
    return mean > 0.0001 ? Math.max(...active) / mean : 1;
  };
  return {
    rootVelocitySpikeRatio: Number(ratio(rootSpeeds).toFixed(3)),
    poseVelocitySpikeRatio: Number(ratio(poseSpeeds).toFixed(3)),
    maxPoseVelocity: Number((poseSpeeds.length ? Math.max(...poseSpeeds) : 0).toFixed(3))
  };
}

function maxJointAxisDeltaFromStart(samples: AnimationClipSample[], joint: PoseJointKey, axis: keyof RigRotation) {
  const start = samples[0]?.pose[joint]?.[axis] || 0;
  return samples.reduce((max, sample) => Math.max(max, Math.abs((sample.pose[joint]?.[axis] || 0) - start)), 0);
}

function samplesForSequenceStep(clip: SerializedAnimationClip, step: MotionActionSequenceStep) {
  const durationSec = Math.max(0.0001, clip.durationSec);
  const startSec = durationSec * clamp01(step.startRatio);
  const endSec = durationSec * clamp01(step.endRatio);
  const ranged = clip.samples.filter((sample) => sample.timeSec >= startSec && sample.timeSec <= endSec);
  const startSample = sampleClipAtTime(clip, startSec);
  const endSample = sampleClipAtTime(clip, endSec);
  const samples = [
    ...(startSample ? [startSample] : []),
    ...ranged,
    ...(endSample ? [endSample] : [])
  ];
  return samples.length ? samples : clip.samples;
}

function maxJointAxisDeltaInSamples(samples: AnimationClipSample[], joint: PoseJointKey, axis: keyof RigRotation) {
  const start = samples[0]?.pose[joint]?.[axis] || 0;
  return samples.reduce((max, sample) => Math.max(max, Math.abs((sample.pose[joint]?.[axis] || 0) - start)), 0);
}

function maxRootLiftInSamples(samples: AnimationClipSample[]) {
  const startY = samples[0]?.transform.position.y || 0;
  return samples.reduce((max, sample) => Math.max(max, sample.transform.position.y - startY), 0);
}

function rootTravelInSamples(samples: AnimationClipSample[]) {
  if (samples.length <= 1) return 0;
  const first = samples[0].transform.position;
  const last = samples[samples.length - 1].transform.position;
  return Math.hypot(last.x - first.x, last.z - first.z);
}

function contactsInSequenceStep(clip: SerializedAnimationClip, step: MotionActionSequenceStep, predicate: (contact: AnimationContactFrame) => boolean) {
  const durationSec = Math.max(0.0001, clip.durationSec);
  const startSec = durationSec * clamp01(step.startRatio);
  const endSec = durationSec * clamp01(step.endRatio);
  return clip.contacts.filter((contact) => contact.timeSec >= startSec && contact.timeSec <= endSec && predicate(contact));
}

function semanticHandReachDistance(clip: SerializedAnimationClip) {
  const handContacts = clip.contacts.filter((contact) => (
    (contact.kind === 'reach' || contact.kind === 'grasp' || contact.kind === 'release')
    && (contact.limb === 'leftHand' || contact.limb === 'rightHand')
  ));
  if (!handContacts.length) return 0;
  let maxDistance = 0;
  handContacts.forEach((contact) => {
    const sample = sampleClipAtTime(clip, contact.timeSec);
    if (!sample || (contact.limb !== 'leftHand' && contact.limb !== 'rightHand')) return;
    const handPosition = approximateHandWorldPosition(sample, contact.limb);
    maxDistance = Math.max(maxDistance, vecDistance(handPosition, contact.position));
  });
  return Number(maxDistance.toFixed(3));
}

function semanticHandContactStats(clip: SerializedAnimationClip, transition?: PoseTransition) {
  const handContacts = clip.contacts.filter((contact) => (
    (contact.kind === 'reach' || contact.kind === 'grasp' || contact.kind === 'release')
    && (contact.limb === 'leftHand' || contact.limb === 'rightHand')
  ));
  if (!handContacts.length) return { maxDistance: 0, successRatio: 1, checkedCount: 0 };
  let maxDistance = 0;
  let successCount = 0;
  handContacts.forEach((contact) => {
    const sample = sampleClipAtTime(clip, contact.timeSec);
    if (!sample || (contact.limb !== 'leftHand' && contact.limb !== 'rightHand')) return;
    const handPosition = approximateHandWorldPosition(sample, contact.limb);
    const distance = vecDistance(handPosition, contact.position);
    maxDistance = Math.max(maxDistance, distance);
    const contactAction = transition
      ? semanticContactActionAtTime(transition, clamp01(contact.timeSec / Math.max(0.0001, clip.durationSec)))
      : undefined;
    const baseThreshold = contact.kind === 'release' ? 0.5 : contact.kind === 'grasp' ? 0.42 : 0.46;
    const threshold = contactAction === 'push' || contactAction === 'pull'
      ? Math.min(baseThreshold, contact.kind === 'release' ? 0.46 : 0.38)
      : contactAction === 'throw'
        ? Math.min(baseThreshold, contact.kind === 'release' ? 0.52 : 0.4)
        : baseThreshold;
    if (distance <= threshold) successCount += 1;
  });
  return {
    maxDistance: Number(maxDistance.toFixed(3)),
    successRatio: Number((successCount / handContacts.length).toFixed(3)),
    checkedCount: handContacts.length
  };
}

function semanticTargetApproachDistance(scene: Scene3DState, transition: PoseTransition, clip: SerializedAnimationClip) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const contactAction = sequenceContactActionType(transition);
  if (!semanticPlan?.targetObjectId || !sequenceLocomotionActionType(transition) || !contactAction) return undefined;
  const target = findSceneObject(scene, semanticPlan.targetObjectId);
  if (!target) return undefined;
  const contactWindow = sequenceActionWindow(transition, contactAction);
  const checkRatio = clamp01(contactWindow.startRatio + (contactWindow.endRatio - contactWindow.startRatio) * 0.18);
  const sample = sampleClipAtTime(clip, clip.durationSec * checkRatio) || clip.samples[Math.max(0, Math.min(clip.samples.length - 1, Math.round((clip.samples.length - 1) * checkRatio)))];
  if (!sample) return undefined;
  const expectedApproach = targetApproachPositionForTransition(transition, target);
  if (!expectedApproach) return undefined;
  return Number(Math.hypot(sample.transform.position.x - expectedApproach.x, sample.transform.position.z - expectedApproach.z).toFixed(3));
}

function semanticContactActionStats(scene: Scene3DState, transition: PoseTransition, clip: SerializedAnimationClip) {
  const semanticPlan = transition.actionPlan.semanticPlan;
  const actionType = sequenceContactActionType(transition)
    || (semanticPlan?.actionType === 'punch' ? 'punch' : undefined)
    || semanticPlan?.actionSequence?.find((step) => step.actionType === 'punch')?.actionType;
  const target = findSceneObject(scene, semanticPlan?.targetObjectId);
  const empty = {
    bodyDrive: undefined as number | undefined,
    footStability: undefined as number | undefined,
    contactWindowCoverage: undefined as number | undefined,
    propMotionDistance: undefined as number | undefined,
    propDirectionAlignment: undefined as number | undefined,
    throwReleaseDistance: undefined as number | undefined,
    punchExtension: undefined as number | undefined,
    punchRecoveryRatio: undefined as number | undefined
  };
  if (!semanticPlan || !actionType || clip.samples.length <= 2) return empty;
  const window = sequenceActionWindow(transition, actionType);
  const ranged = clip.samples.filter((sample) => {
    const ratio = clamp01(sample.timeSec / Math.max(0.0001, clip.durationSec));
    return ratio >= window.startRatio && ratio <= window.endRatio;
  });
  const samples = ranged.length ? ranged : clip.samples;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return empty;
  const chestDrive = samples.reduce((max, sample) => Math.max(max, poseJointDelta(sample.pose.chest, first.pose.chest)), 0);
  const pelvisDrive = samples.reduce((max, sample) => Math.max(max, poseJointDelta(sample.pose.pelvis, first.pose.pelvis)), 0);
  const rootDrive = samples.reduce((max, sample) => Math.max(
    max,
    Math.hypot(sample.transform.position.x - first.transform.position.x, sample.transform.position.z - first.transform.position.z) * 100
  ), 0);
  const bodyDrive = Number(Math.max(chestDrive, pelvisDrive, rootDrive).toFixed(2));
  const leftFootDrift = maxJointAxisDeltaInSamples(samples, 'leftFoot', 'x') + maxJointAxisDeltaInSamples(samples, 'leftFoot', 'z');
  const rightFootDrift = maxJointAxisDeltaInSamples(samples, 'rightFoot', 'x') + maxJointAxisDeltaInSamples(samples, 'rightFoot', 'z');
  const footStability = Number(Math.max(0, 1 - Math.min(leftFootDrift, rightFootDrift) / 26).toFixed(3));
  const baseProp = target && 'shape' in target ? propBaseTransform(target as PropObject) : null;
  const propEnd = baseProp && target && 'shape' in target ? semanticPropMotionTransform(baseProp, target as PropObject, transition, last) : null;
  const propMotionDistance = baseProp && propEnd
    ? Number(Math.hypot(propEnd.position.x - baseProp.position.x, propEnd.position.z - baseProp.position.z, propEnd.position.y - baseProp.position.y).toFixed(3))
    : undefined;
  const propDirectionAlignment = baseProp && propEnd && propMotionDistance && propMotionDistance > 0.001
    ? (() => {
        const forward = target && 'shape' in target
          ? semanticPropContactForwardDirection(target as PropObject, transition, first, actionType)
          : normalizedDirection(transition.actionPlan.universal?.direction || vec(0, 0, -1));
        const expected = actionType === 'pull' ? vec(-forward.x, 0, -forward.z) : forward;
        const actual = normalizedDirection(vec(propEnd.position.x - baseProp.position.x, 0, propEnd.position.z - baseProp.position.z));
        return Number(clampNumber(actual.x * expected.x + actual.z * expected.z, -1, 1).toFixed(3));
      })()
    : undefined;
  const windowStartSec = clip.durationSec * clamp01(window.startRatio);
  const windowEndSec = clip.durationSec * clamp01(window.endRatio);
  const expectedHandContacts = actionType === 'push' || actionType === 'pull' || actionType === 'throw'
    ? semanticContactLimbsForAction(actionType, transition.actionPrompt).length * 3
    : 0;
  const actualHandContacts = clip.contacts.filter((contact) => (
    contact.timeSec >= windowStartSec
    && contact.timeSec <= windowEndSec
    && (contact.kind === 'grasp' || contact.kind === 'release')
    && (contact.limb === 'leftHand' || contact.limb === 'rightHand')
  )).length;
  const contactWindowCoverage = expectedHandContacts
    ? Number(clamp01(actualHandContacts / expectedHandContacts).toFixed(3))
    : undefined;
  const releaseContacts = clip.contacts.filter((contact) => contact.kind === 'release' && (contact.limb === 'leftHand' || contact.limb === 'rightHand'));
  const throwReleaseDistance = actionType === 'throw' && releaseContacts.length
    ? Number(Math.max(...releaseContacts.map((contact) => vecDistance(contact.position, first.transform.position))).toFixed(3))
    : undefined;
  const punchStep = semanticPlan.actionType === 'punch'
    ? undefined
    : semanticPlan.actionSequence?.find((step) => step.actionType === 'punch');
  const punchSamples = actionType === 'punch'
    ? samples
    : punchStep
      ? samplesForSequenceStep(clip, punchStep)
      : [];
  const punchFirst = punchSamples[0];
  const punchLast = punchSamples[punchSamples.length - 1];
  const mainHand = inferPromptHand(transition.actionPrompt) === 'left' ? 'left' : 'right';
  const upperKey: PoseJointKey = mainHand === 'left' ? 'leftUpperArm' : 'rightUpperArm';
  const lowerKey: PoseJointKey = mainHand === 'left' ? 'leftLowerArm' : 'rightLowerArm';
  const startUpper = (punchFirst || first).pose[upperKey];
  const startLower = (punchFirst || first).pose[lowerKey];
  const endUpper = (punchLast || last).pose[upperKey];
  const endLower = (punchLast || last).pose[lowerKey];
  const armDelta = (sample: AnimationClipSample) => Math.max(
    Math.abs(sample.pose[upperKey].x - startUpper.x),
    Math.abs(sample.pose[upperKey].y - startUpper.y),
    Math.abs(sample.pose[upperKey].z - startUpper.z),
    Math.abs(sample.pose[lowerKey].x - startLower.x),
    Math.abs(sample.pose[lowerKey].y - startLower.y),
    Math.abs(sample.pose[lowerKey].z - startLower.z)
  );
  const hasPunchAction = actionType === 'punch' || Boolean(punchStep);
  const punchExtension = hasPunchAction
    ? Number((punchSamples.length ? punchSamples : samples).reduce((max, sample) => Math.max(max, armDelta(sample)), 0).toFixed(2))
    : undefined;
  const punchEndDelta = hasPunchAction
    ? Math.max(
        Math.abs(endUpper.x - startUpper.x),
        Math.abs(endUpper.y - startUpper.y),
        Math.abs(endUpper.z - startUpper.z),
        Math.abs(endLower.x - startLower.x),
        Math.abs(endLower.y - startLower.y),
        Math.abs(endLower.z - startLower.z)
      )
    : 0;
  const punchRecoveryRatio = hasPunchAction && punchExtension && punchExtension > 0.001
    ? Number(clamp01((punchExtension - punchEndDelta) / punchExtension).toFixed(3))
    : undefined;
  return {
    bodyDrive,
    footStability,
    contactWindowCoverage,
    propMotionDistance,
    propDirectionAlignment,
    throwReleaseDistance,
    punchExtension,
    punchRecoveryRatio
  };
}

function inspectMotionQualityExpectations(
  transition: PoseTransition,
  stats: {
    locomotionStats: ReturnType<typeof locomotionSupportStats>;
    locomotionAlternation: ReturnType<typeof locomotionAlternationStats>;
    handContactStats: ReturnType<typeof semanticHandContactStats>;
    targetApproachDistance?: number;
    contactActionStats: ReturnType<typeof semanticContactActionStats>;
    sequenceBoundaryStats: SequenceBoundaryStats;
    samples: AnimationClipSample[];
    contacts: AnimationContactFrame[];
  }
): Array<Omit<MotionQualityIssue, 'id'>> {
  const expectations = transition.actionPlan.semanticPlan?.qualityExpectations || [];
  if (!expectations.length) return [];
  const issues: Array<Omit<MotionQualityIssue, 'id'>> = [];
  const add = (expectation: MotionQualityExpectation, message: string, value?: number) => {
    issues.push({
      severity: expectation.required ? 'warning' : 'info',
      metric: expectation.metric,
      message,
      value: value === undefined ? undefined : Number(value.toFixed(3))
    });
  };

  expectations.forEach((expectation) => {
    if (expectation.id === 'locomotion_gait') {
      const value = stats.locomotionAlternation.maxLegSeparation;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'locomotion_support') {
      const value = stats.locomotionStats.supportCoverageRatio;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'locomotion_travel') {
      const value = stats.locomotionStats.paceCoverageRatio;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'locomotion_smoothness') {
      const value = stats.locomotionStats.rootStepJitter;
      if (expectation.maxValue !== undefined && value > expectation.maxValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'locomotion_arm_sync') {
      const value = stats.locomotionStats.armLegSyncScore;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'prompt_low_center') {
      const value = Math.max(
        maxJointAxisDeltaInSamples(stats.samples, 'pelvis', 'x'),
        maxJointAxisDeltaInSamples(stats.samples, 'leftLowerLeg', 'x'),
        maxJointAxisDeltaInSamples(stats.samples, 'rightLowerLeg', 'x')
      );
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'prompt_forward_lean') {
      const value = Math.max(
        maxJointAxisDeltaInSamples(stats.samples, 'chest', 'x'),
        maxJointAxisDeltaInSamples(stats.samples, 'pelvis', 'x')
      );
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'prompt_grounded_feet') {
      const footContacts = stats.contacts.filter((contact) => contact.kind === 'foot_lock' && (contact.limb === 'leftFoot' || contact.limb === 'rightFoot')).length;
      const maxLift = maxRootLiftInSamples(stats.samples);
      if ((expectation.minValue !== undefined && footContacts < expectation.minValue) || maxLift > 0.08) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, Math.max(footContacts, maxLift));
      }
    }
    if (expectation.id === 'prompt_both_hands') {
      const hasLeft = stats.contacts.some((contact) => contact.limb === 'leftHand');
      const hasRight = stats.contacts.some((contact) => contact.limb === 'rightHand');
      const value = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'contact_window') {
      const value = stats.handContactStats.checkedCount;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'hand_contact') {
      const value = stats.handContactStats.checkedCount > 0 ? stats.handContactStats.successRatio : 0;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'contact_body_drive') {
      const value = stats.contactActionStats.bodyDrive || 0;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'contact_foot_anchor') {
      const value = stats.contactActionStats.footStability || 0;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'prop_contact_motion' || expectation.id === 'throw_prop_motion') {
      const value = stats.contactActionStats.propMotionDistance || 0;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'throw_body_windup') {
      const value = stats.contactActionStats.bodyDrive || 0;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'throw_release') {
      const value = stats.contactActionStats.throwReleaseDistance || 0;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'punch_extension') {
      const value = stats.contactActionStats.punchExtension || 0;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'punch_recovery') {
      const value = stats.contactActionStats.punchRecoveryRatio || 0;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'punch_body_drive') {
      const value = stats.contactActionStats.bodyDrive || 0;
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'target_approach') {
      const value = stats.targetApproachDistance;
      if (value !== undefined && expectation.maxValue !== undefined && value > expectation.maxValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'sequence_bridge') {
      const value = sequenceBoundarySmoothnessRatio(stats.sequenceBoundaryStats);
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
      if (stats.sequenceBoundaryStats.maxVelocityRatio > 2.4) {
        add(expectation, `未达到“${expectation.label}”期望：组合动作段落交界处速度突变过大，需要更平滑的承接。`, stats.sequenceBoundaryStats.maxVelocityRatio);
      }
    }
    if (expectation.id === 'approach_contact_bridge') {
      const smoothness = sequenceBoundarySmoothnessRatio(stats.sequenceBoundaryStats);
      const approachScore = stats.targetApproachDistance === undefined
        ? 1
        : 1 - clamp01(stats.targetApproachDistance / 0.7);
      const contactScore = stats.contactActionStats.contactWindowCoverage ?? stats.handContactStats.successRatio ?? 0;
      const value = Number(Math.min(smoothness, approachScore, contactScore).toFixed(3));
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'turn_throw_bridge') {
      const smoothness = sequenceBoundarySmoothnessRatio(stats.sequenceBoundaryStats);
      const windupScore = clamp01((stats.contactActionStats.bodyDrive || 0) / 12);
      const releaseScore = clamp01((stats.contactActionStats.throwReleaseDistance || 0) / 0.62);
      const value = Number(Math.min(smoothness, windupScore, releaseScore).toFixed(3));
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
    if (expectation.id === 'low_recovery_attack_bridge') {
      const smoothness = sequenceBoundarySmoothnessRatio(stats.sequenceBoundaryStats);
      const bodyDriveScore = clamp01((stats.contactActionStats.bodyDrive || 0) / 9);
      const punchScore = stats.contactActionStats.punchExtension === undefined
        ? bodyDriveScore
        : clamp01(stats.contactActionStats.punchExtension / 16);
      const value = Number(Math.min(smoothness, Math.max(bodyDriveScore, punchScore)).toFixed(3));
      if (expectation.minValue !== undefined && value < expectation.minValue) {
        add(expectation, `未达到“${expectation.label}”期望：${expectation.description}`, value);
      }
    }
  });

  return issues;
}

function locomotionAlternationStatsForSamples(samples: AnimationClipSample[]) {
  let maxLegSeparation = 0;
  let signChanges = 0;
  let previousSign = 0;
  samples.forEach((sample, index) => {
    if (index === 0 || index === samples.length - 1) return;
    const delta = sample.pose.leftUpperLeg.x - sample.pose.rightUpperLeg.x;
    maxLegSeparation = Math.max(maxLegSeparation, Math.abs(delta));
    const sign = Math.abs(delta) < 1 ? 0 : delta > 0 ? 1 : -1;
    if (!sign) return;
    if (previousSign && sign !== previousSign) signChanges += 1;
    previousSign = sign;
  });
  return { maxLegSeparation, signChanges };
}

function sequenceBoundaryContinuityStats(transition: PoseTransition, clip: SerializedAnimationClip): SequenceBoundaryStats {
  const sequence = transition.actionPlan.semanticPlan?.actionSequence;
  const empty = { maxPoseDelta: 0, maxRootDelta: 0, maxRotationDelta: 0, maxVelocityRatio: 1, issues: [] as Array<Omit<MotionQualityIssue, 'id'>> };
  if (!sequence || sequence.length <= 1 || clip.samples.length <= 3) return empty;

  let maxPoseDelta = 0;
  let maxRootDelta = 0;
  let maxRotationDelta = 0;
  let maxVelocityRatio = 1;
  const issues: Array<Omit<MotionQualityIssue, 'id'>> = [];
  const durationSec = Math.max(0.0001, clip.durationSec || transition.durationSec || 1);
  const qualityTarget = motionQualityTargetForTransition(transition);

  sequenceBoundaryRatios(sequence).forEach((boundaryRatio, boundaryIndex) => {
    const boundarySec = durationSec * boundaryRatio;
    let afterIndex = clip.samples.findIndex((sample) => sample.timeSec >= boundarySec);
    if (afterIndex <= 0) afterIndex = 1;
    if (afterIndex >= clip.samples.length) afterIndex = clip.samples.length - 1;
    const beforeIndex = Math.max(0, afterIndex - 1);
    const before = clip.samples[beforeIndex];
    const after = clip.samples[afterIndex];
    if (!before || !after || before === after) return;
    const beforePrev = clip.samples[Math.max(0, beforeIndex - 1)];
    const afterNext = clip.samples[Math.min(clip.samples.length - 1, afterIndex + 1)];

    const rootDelta = vecDistance(before.transform.position, after.transform.position);
    const rotation = rotationDelta(before.transform.rotation, after.transform.rotation);
    const boundaryDt = Math.max(0.0001, after.timeSec - before.timeSec);
    const beforeSpeed = beforePrev && beforePrev !== before
      ? vecDistance(beforePrev.transform.position, before.transform.position) / Math.max(0.0001, before.timeSec - beforePrev.timeSec)
      : 0;
    const afterSpeed = afterNext && afterNext !== after
      ? vecDistance(after.transform.position, afterNext.transform.position) / Math.max(0.0001, afterNext.timeSec - after.timeSec)
      : 0;
    const neighborSpeed = Math.max(0.002, (beforeSpeed + afterSpeed) / 2);
    const boundarySpeed = rootDelta / boundaryDt;
    const velocityRatio = boundarySpeed / neighborSpeed;
    let poseDelta = 0;
    for (const joint of POSE_KEYS) {
      poseDelta = Math.max(poseDelta, poseJointDelta(before.pose[joint], after.pose[joint]));
    }
    maxRootDelta = Math.max(maxRootDelta, rootDelta);
    maxRotationDelta = Math.max(maxRotationDelta, rotation);
    maxVelocityRatio = Math.max(maxVelocityRatio, velocityRatio);
    maxPoseDelta = Math.max(maxPoseDelta, poseDelta);

    const maxRootDeltaAllowed = Math.min(0.13, qualityTarget.maxRootStepDistance * 0.9);
    const maxRotationAllowed = Math.min(26, qualityTarget.maxRootRotationDelta);
    const maxPoseDeltaAllowed = Math.min(34, qualityTarget.maxPoseStepDelta);
    if (rootDelta > maxRootDeltaAllowed || rotation > maxRotationAllowed || poseDelta > maxPoseDeltaAllowed) {
      issues.push({
        severity: rootDelta > maxRootDeltaAllowed * 1.7 || rotation > maxRotationAllowed * 1.6 || poseDelta > maxPoseDeltaAllowed * 1.5 ? 'error' : 'warning',
        metric: 'sequence',
        message: `动作序列第 ${boundaryIndex + 1} 段到第 ${boundaryIndex + 2} 段过渡不够平滑`,
        timeSec: Number(boundarySec.toFixed(3)),
        value: Number(Math.max(rootDelta * 100, rotation, poseDelta).toFixed(2))
      });
    }
    if (velocityRatio > 2.4 && rootDelta > 0.025) {
      issues.push({
        severity: velocityRatio > 3.2 ? 'error' : 'warning',
        metric: 'sequence',
        message: `动作序列第 ${boundaryIndex + 1} 段到第 ${boundaryIndex + 2} 段根节点速度突变，容易产生卡顿。`,
        timeSec: Number(boundarySec.toFixed(3)),
        value: Number(velocityRatio.toFixed(2))
      });
    }
  });

  return {
    maxPoseDelta: Number(maxPoseDelta.toFixed(2)),
    maxRootDelta: Number(maxRootDelta.toFixed(4)),
    maxRotationDelta: Number(maxRotationDelta.toFixed(2)),
    maxVelocityRatio: Number(maxVelocityRatio.toFixed(3)),
    issues
  };
}

function sequenceBoundarySmoothnessRatio(stats: SequenceBoundaryStats) {
  const rootScore = 1 - clamp01(stats.maxRootDelta / 0.16);
  const rotationScore = 1 - clamp01(stats.maxRotationDelta / 32);
  const poseScore = 1 - clamp01(stats.maxPoseDelta / 42);
  const velocityScore = 1 - clamp01((stats.maxVelocityRatio - 1) / 2.2);
  return Number(clamp01(rootScore * 0.3 + rotationScore * 0.22 + poseScore * 0.34 + velocityScore * 0.14).toFixed(3));
}

function inspectActionSequenceRealization(transition: PoseTransition, clip: SerializedAnimationClip): Array<Omit<MotionQualityIssue, 'id'>> {
  const sequence = transition.actionPlan.semanticPlan?.actionSequence;
  if (!sequence || sequence.length <= 1) return [];
  const issues: Array<Omit<MotionQualityIssue, 'id'>> = [];
  const promptHand = inferPromptHand(transition.actionPrompt);
  const promptLeg = inferPromptLeg(transition.actionPrompt);
  const normalizedPrompt = transition.actionPrompt.trim().toLowerCase();
  const addIssue = (step: MotionActionSequenceStep, message: string, value?: number) => {
    issues.push({
      severity: 'warning',
      metric: 'sequence',
      message,
      timeSec: Number((clip.durationSec * ((step.startRatio + step.endRatio) / 2)).toFixed(3)),
      value: value === undefined ? undefined : Number(value.toFixed(2))
    });
  };
  const indexOfStep = (predicate: (type: MotionSemanticActionType) => boolean) => sequence.findIndex((step) => predicate(step.actionType));
  const addOrderIssue = (stepIndex: number, message: string) => {
    const step = sequence[clampNumber(stepIndex, 0, sequence.length - 1)];
    if (!step) return;
    addIssue(step, message);
  };

  const locomotionIndex = indexOfStep(isLocomotionActionType);
  const contactIndex = indexOfStep((type) => ['push', 'pull', 'reach', 'throw', 'punch', 'kick', 'side_kick'].includes(type));
  if (hasPromptApproachBeforeContact(normalizedPrompt) && locomotionIndex >= 0 && contactIndex >= 0 && contactIndex < locomotionIndex) {
    addOrderIssue(contactIndex, '提示词包含靠近目标语义，但动作序列把接触/攻击排在靠近之前。');
  }
  const pushPullIndex = indexOfStep((type) => type === 'push' || type === 'pull');
  if (hasPromptApproachBeforeContact(normalizedPrompt) && locomotionIndex >= 0 && pushPullIndex >= 0) {
    const locomotionStep = sequence[locomotionIndex];
    const contactStep = sequence[pushPullIndex];
    const overlap = locomotionStep.endRatio - contactStep.startRatio;
    if (pushPullIndex < locomotionIndex) {
      addOrderIssue(pushPullIndex, '提示词要求先靠近再推/拉目标，但当前推/拉阶段排在移动之前。');
    } else if (overlap < 0.04) {
      addIssue(contactStep, '跑/走/冲到目标后缺少减速贴近和手部接触承接。', overlap);
    }
  }

  const turnIndex = indexOfStep((type) => type === 'turn');
  const powerActionIndex = indexOfStep((type) => ['throw', 'punch', 'kick', 'side_kick'].includes(type));
  if (hasPromptTurnBeforeAction(normalizedPrompt) && turnIndex >= 0 && powerActionIndex >= 0 && powerActionIndex < turnIndex) {
    addOrderIssue(powerActionIndex, '提示词包含转身后发力语义，但动作序列把发力动作排在转身之前。');
  }
  const throwIndex = indexOfStep((type) => type === 'throw');
  if (hasPromptTurnBeforeAction(normalizedPrompt) && turnIndex >= 0 && throwIndex >= 0) {
    const turnStep = sequence[turnIndex];
    const throwStep = sequence[throwIndex];
    const overlap = turnStep.endRatio - throwStep.startRatio;
    if (throwIndex < turnIndex) {
      addOrderIssue(throwIndex, '提示词要求转身后投掷，但当前投掷阶段排在转身之前。');
    } else if (overlap < 0.035) {
      addIssue(throwStep, '转身后投掷缺少躯干扭转到蓄力出手的承接。', overlap);
    }
  }

  const crouchIndex = indexOfStep((type) => type === 'crouch' || type === 'block');
  const recoveryIndex = indexOfStep((type) => type === 'get_up');
  if (hasPromptCrouchBeforeRecovery(normalizedPrompt) && crouchIndex >= 0 && recoveryIndex >= 0 && recoveryIndex < crouchIndex) {
    addOrderIssue(recoveryIndex, '提示词包含蹲下/躲避后再恢复语义，但动作序列把恢复排在下沉防守之前。');
  }
  if (hasPromptRecoveryBeforeAttack(normalizedPrompt) && recoveryIndex >= 0 && powerActionIndex >= 0 && powerActionIndex < recoveryIndex) {
    addOrderIssue(powerActionIndex, '提示词包含起身后再攻击语义，但动作序列把攻击排在起身之前。');
  }
  if (promptNeedsImplicitGetUpBeforeAttack(normalizedPrompt)) {
    if (recoveryIndex < 0) {
      addOrderIssue(Math.max(crouchIndex, 0), '提示词包含蹲下/躲避后攻击语义，但动作序列缺少起身恢复阶段。');
    } else if (crouchIndex >= 0 && powerActionIndex >= 0 && !(crouchIndex < recoveryIndex && recoveryIndex < powerActionIndex)) {
      addOrderIssue(recoveryIndex, '蹲下/躲避后攻击需要按“下沉 → 起身恢复 → 攻击”顺序执行。');
    }
  }

  promptExplicitSequenceRelations(normalizedPrompt, sequence.map((step) => step.actionType)).forEach((relation) => {
    const beforeIndex = indexOfStep((type) => type === relation.before);
    const afterIndex = indexOfStep((type) => type === relation.after);
    if (beforeIndex >= 0 && afterIndex >= 0 && afterIndex < beforeIndex) {
      addOrderIssue(afterIndex, `提示词要求“${MOTION_SEMANTIC_TYPE_LABELS[relation.before]}”先于“${MOTION_SEMANTIC_TYPE_LABELS[relation.after]}”，但当前动作序列顺序相反。`);
    }
  });

  for (let index = 0; index < sequence.length - 1; index += 1) {
    const current = sequence[index];
    const next = sequence[index + 1];
    const overlap = current.endRatio - next.startRatio;
    if (overlap < 0.015) {
      addIssue(next, `动作序列第${index + 1}段到第${index + 2}段缺少承接重叠，容易出现卡顿。`, overlap);
    } else if (overlap > 0.24) {
      addIssue(next, `动作序列第${index + 1}段到第${index + 2}段混合过多，动作意图可能变得不清晰。`, overlap);
    }
  }

  sequence.forEach((step, index) => {
    if (step.actionType === 'unknown' || step.actionType === 'idle') return;
    const label = step.label || MOTION_SEMANTIC_TYPE_LABELS[step.actionType] || `动作${index + 1}`;
    const stepSamples = samplesForSequenceStep(clip, step);
    if (stepSamples.length <= 2) return;
    const stepDurationRatio = clampNumber(step.endRatio - step.startRatio, 0, 1);
    const minDurationRatio = sequenceActionMinDurationRatio(step.actionType, sequence.length);
    if (stepDurationRatio < minDurationRatio) {
      addIssue(step, `动作序列第${index + 1}段“${label}”阶段时间过短，动作意图可能无法完整呈现。`, stepDurationRatio);
    }
    const hasHandContact = contactsInSequenceStep(clip, step, (contact) => contact.limb === 'leftHand' || contact.limb === 'rightHand').length > 0;
    const hasRelease = contactsInSequenceStep(clip, step, (contact) => contact.kind === 'release').length > 0;

    if (isLocomotionActionType(step.actionType)) {
      const alternation = locomotionAlternationStatsForSamples(stepSamples);
      const minSeparation = motionActionSkill(step.actionType)?.quality.minLegSeparation || (step.actionType === 'walk' ? 8 : 11);
      const travel = rootTravelInSamples(stepSamples);
      if (alternation.maxLegSeparation < minSeparation && travel < 0.08 && !promptRequestsInPlaceMotion(transition.actionPrompt)) {
        addIssue(step, `动作序列第${index + 1}段“${label}”没有形成清晰的步态和位移。`, Math.max(alternation.maxLegSeparation, travel * 100));
      } else if (alternation.maxLegSeparation < minSeparation) {
        addIssue(step, `动作序列第${index + 1}段“${label}”左右腿交替幅度不足。`, alternation.maxLegSeparation);
      }
    }

    if (step.actionType === 'punch' || step.actionType === 'block' || step.actionType === 'reach') {
      const mainHand = promptHand === 'left' ? 'left' : 'right';
      const upper = maxJointAxisDeltaInSamples(stepSamples, mainHand === 'left' ? 'leftUpperArm' : 'rightUpperArm', 'x');
      const lower = maxJointAxisDeltaInSamples(stepSamples, mainHand === 'left' ? 'leftLowerArm' : 'rightLowerArm', 'x');
      const threshold = motionActionSkill(step.actionType)?.quality.minPrimaryJointDelta || (step.actionType === 'block' ? 10 : 13);
      if (Math.max(upper, lower) < threshold && !hasHandContact) {
        addIssue(step, `动作序列第${index + 1}段“${label}”主手轨迹不明显。`, Math.max(upper, lower));
      }
    }

    if (step.actionType === 'push' || step.actionType === 'pull') {
      const limbs = semanticContactLimbsForAction(step.actionType, transition.actionPrompt)
        .map((limb) => limb === 'leftHand' ? 'left' : 'right');
      const armDelta = limbs.reduce((min, limb) => {
        const upper = maxJointAxisDeltaInSamples(stepSamples, limb === 'left' ? 'leftUpperArm' : 'rightUpperArm', 'x');
        const lower = maxJointAxisDeltaInSamples(stepSamples, limb === 'left' ? 'leftLowerArm' : 'rightLowerArm', 'x');
        return Math.min(min, Math.max(upper, lower));
      }, Number.POSITIVE_INFINITY);
      const threshold = motionActionSkill(step.actionType)?.quality.minPrimaryJointDelta || 10;
      if (armDelta < threshold || !hasHandContact) {
        addIssue(step, `动作序列第${index + 1}段“${label}”缺少明确的手部接触和发力。`, Number.isFinite(armDelta) ? armDelta : 0);
      }
    }

    if (step.actionType === 'throw') {
      const mainHand = promptHand === 'left' ? 'left' : 'right';
      const shoulder = maxJointAxisDeltaInSamples(stepSamples, mainHand === 'left' ? 'leftUpperArm' : 'rightUpperArm', 'x');
      const twist = maxJointAxisDeltaInSamples(stepSamples, 'chest', 'y');
      const threshold = motionActionSkill('throw')?.quality.minPrimaryJointDelta || 14;
      if (shoulder < threshold || twist < 6 || !hasRelease) {
        addIssue(step, `动作序列第${index + 1}段“${label}”缺少蓄力、出手或释放点。`, Math.min(shoulder, twist));
      }
    }

    if (step.actionType === 'kick' || step.actionType === 'side_kick') {
      const kickLeg = promptLeg === 'left' ? 'left' : 'right';
      const hip = maxJointAxisDeltaInSamples(stepSamples, kickLeg === 'left' ? 'leftUpperLeg' : 'rightUpperLeg', step.actionType === 'side_kick' ? 'z' : 'x');
      const knee = maxJointAxisDeltaInSamples(stepSamples, kickLeg === 'left' ? 'leftLowerLeg' : 'rightLowerLeg', 'x');
      const threshold = motionActionSkill(step.actionType)?.quality.minPrimaryJointDelta || 12;
      if (hip < threshold || knee < 8) {
        addIssue(step, `动作序列第${index + 1}段“${label}”主腿发力不明显。`, Math.min(hip, knee));
      }
    }

    if (step.actionType === 'crouch') {
      const pelvis = maxJointAxisDeltaInSamples(stepSamples, 'pelvis', 'x');
      const knee = Math.max(
        maxJointAxisDeltaInSamples(stepSamples, 'leftLowerLeg', 'x'),
        maxJointAxisDeltaInSamples(stepSamples, 'rightLowerLeg', 'x')
      );
      if (pelvis < 7 || knee < 10) addIssue(step, `动作序列第${index + 1}段“${label}”下沉姿态不明显。`, Math.min(pelvis, knee));
    }

    if (step.actionType === 'jump') {
      const lift = maxRootLiftInSamples(stepSamples);
      if (lift < 0.1) addIssue(step, `动作序列第${index + 1}段“${label}”缺少明显起跳离地。`, lift);
    }

    if (step.actionType === 'turn') {
      const yaw = Math.abs((stepSamples[stepSamples.length - 1].transform.rotation.y || 0) - (stepSamples[0].transform.rotation.y || 0));
      const chestTwist = maxJointAxisDeltaInSamples(stepSamples, 'chest', 'y');
      if (Math.max(yaw, chestTwist) < 8) addIssue(step, `动作序列第${index + 1}段“${label}”转向变化不明显。`, Math.max(yaw, chestTwist));
    }
  });
  return issues;
}

function inspectMotionQuality(scene: Scene3DState, transition: PoseTransition, clip: SerializedAnimationClip): MotionQualityReport {
  const issues: MotionQualityIssue[] = [];
  const samples = clip.samples;
  const start = samples[0];
  const end = samples[samples.length - 1];
  let maxStepDistance = 0;
  let maxRootRotationDelta = 0;
  let maxConsecutivePoseDelta = 0;
  let lockedFootChanges = 0;
  const locomotionStats = locomotionSupportStats(transition, clip);
  const locomotionActionType = sequenceLocomotionActionType(transition);
  const locomotionAlternation = isLocomotionActionType(locomotionActionType)
    ? locomotionAlternationStats(samples)
    : { maxLegSeparation: 0, signChanges: 0 };
  const timingStats = semanticTimingStats(clip);
  const handContactStats = semanticHandContactStats(clip, transition);
  const handReachDistance = handContactStats.maxDistance || semanticHandReachDistance(clip);
  const targetApproachDistance = semanticTargetApproachDistance(scene, transition, clip);
  const contactActionStats = semanticContactActionStats(scene, transition, clip);
  const sequenceBoundaryStats = sequenceBoundaryContinuityStats(transition, clip);
  const protectedKeyframeTimes = explicitMiddleKeyframeTimes(transition, clip.durationSec);
  const continuityStats = motionContinuityStats(samples, protectedKeyframeTimes);
  const qualityTarget = motionQualityTargetForTransition(transition);
  const actualSampleRate = samples.length > 1 && clip.durationSec > 0
    ? (samples.length - 1) / clip.durationSec
    : 0;
  const expectedSampleRate = motionClipSampleRateForTransition(transition);
  const pushIssue = (issue: Omit<MotionQualityIssue, 'id'>) => {
    issues.push({ id: createId('quality'), ...issue });
  };

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const protectedInterval = intervalTouchesExplicitKeyframe(previous.timeSec, current.timeSec, protectedKeyframeTimes);
    const stepDistance = vecDistance(previous.transform.position, current.transform.position);
    const rootTurn = rotationDelta(previous.transform.rotation, current.transform.rotation);
    if (!protectedInterval) {
      maxStepDistance = Math.max(maxStepDistance, stepDistance);
      maxRootRotationDelta = Math.max(maxRootRotationDelta, rootTurn);
      for (const key of POSE_KEYS) {
        maxConsecutivePoseDelta = Math.max(maxConsecutivePoseDelta, poseJointDelta(previous.pose[key], current.pose[key]));
      }
    }
    if (!protectedInterval && stepDistance > qualityTarget.maxRootStepDistance) {
      pushIssue({
        severity: stepDistance > qualityTarget.maxRootStepDistance * 1.65 ? 'error' : 'warning',
        metric: 'speed',
        message: '根节点位移变化过大',
        timeSec: current.timeSec,
        value: Number(stepDistance.toFixed(4))
      });
    }
    if (!protectedInterval && rootTurn > qualityTarget.maxRootRotationDelta) {
      pushIssue({
        severity: rootTurn > qualityTarget.maxRootRotationDelta * 1.65 ? 'error' : 'warning',
        metric: 'rotation',
        message: '根节点旋转变化过大',
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
      message: '生成动态未对齐起点位置',
      timeSec: 0,
      value: Number(startPositionDrift.toFixed(4))
    });
  }
  if (endPositionDrift > 0.01) {
    pushIssue({
      severity: 'error',
      metric: 'endpoint',
      message: '生成动态未对齐终点位置',
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
              message: `${limb === 'left' ? '左脚' : '右脚'}贴地接触漂移过大`,
              timeSec: sample.timeSec,
              value: Number(delta.toFixed(2))
            });
          }
        }
      }
    }
  }

  const families = universalMotionFamilies(transition.actionPlan.universal, transition.actionPrompt);
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (isLocomotionActionType(locomotionActionType) && actualSampleRate < expectedSampleRate * 0.85) {
    pushIssue({
      severity: 'warning',
      metric: 'speed',
      message: '走跑冲刺采样密度不足，播放时可能出现卡顿或步态跳变',
      value: Number(actualSampleRate.toFixed(2))
    });
  }
  const allowsBurstTiming = promptRequestsBurstTiming(transition.actionPrompt);
  const rootSpikeLimit = isLocomotionActionType(locomotionActionType)
    ? 2.25
    : allowsBurstTiming
      ? 3.8
      : 2.8;
  const poseSpikeLimit = allowsBurstTiming ? 4.4 : 3.25;
  if (continuityStats.rootVelocitySpikeRatio > rootSpikeLimit) {
    pushIssue({
      severity: continuityStats.rootVelocitySpikeRatio > rootSpikeLimit * 1.35 ? 'error' : 'warning',
      metric: 'speed',
      message: '根节点速度出现尖峰，播放时容易卡顿或突然抽动',
      value: continuityStats.rootVelocitySpikeRatio
    });
  }
  if (continuityStats.poseVelocitySpikeRatio > poseSpikeLimit) {
    pushIssue({
      severity: continuityStats.poseVelocitySpikeRatio > poseSpikeLimit * 1.35 ? 'error' : 'warning',
      metric: 'pose',
      message: '关节速度出现尖峰，动作姿态过渡不够丝滑',
      value: continuityStats.poseVelocitySpikeRatio
    });
  }
  const expectsContact = families.some((family) => ['roll', 'fall', 'get_up', 'crawl', 'kneel', 'carry', 'reach'].includes(family))
    || transition.constraints.handTarget.enabled
    || transition.actionPlan.templates.some((item) => item.id === 'pick_up' || item.id === 'put_down' || item.id === 'point_at')
    || Boolean(semanticPlan?.contacts.length);
  if (expectsContact && clip.contacts.length === 0) {
    pushIssue({
      severity: 'warning',
      metric: 'contact',
      message: '缺少预期的接触帧',
    });
  }
  if (semanticPlan) {
    const actionTypes = new Set<MotionSemanticActionType>([
      semanticPlan.actionType,
      ...(semanticPlan.actionSequence || []).map((step) => step.actionType)
    ]);
    const hasAction = (...types: MotionSemanticActionType[]) => types.some((type) => actionTypes.has(type));
    if (hasAction('push', 'pull', 'throw', 'reach') && !semanticPlan.targetObjectId) {
      pushIssue({
        severity: 'warning',
        metric: 'contact',
        message: '接触型动作缺少真实目标对象，将只能使用角色前方虚拟目标',
      });
    }
    if (targetApproachDistance !== undefined && targetApproachDistance > 0.55) {
      pushIssue({
        severity: targetApproachDistance > 0.9 ? 'error' : 'warning',
        metric: 'contact',
        message: '组合动作接触前没有靠近目标对象',
        value: targetApproachDistance
      });
    }
    const allowsAirborne = transitionAllowsAirborneMotion(transition);
    const allowsExaggerated = promptAllowsExaggeratedMotion(transition.actionPrompt);
    const startY = samples[0]?.transform.position.y || 0;
    const maxLift = samples.reduce((max, sample) => Math.max(max, sample.transform.position.y - startY), 0);
    if (!allowsAirborne && maxLift > qualityTarget.maxRootLift) {
      pushIssue({
        severity: 'warning',
        metric: 'pose',
        message: '非跳跃动作出现明显离地',
        value: Number(maxLift.toFixed(3))
      });
    }
    if (!allowsExaggerated && maxConsecutivePoseDelta > qualityTarget.maxPoseStepDelta) {
      pushIssue({
        severity: 'warning',
        metric: 'pose',
        message: '普通动作幅度过大，建议降低幅度',
        value: Number(maxConsecutivePoseDelta.toFixed(2))
      });
    }
    if (promptRequestsBurstTiming(transition.actionPrompt) && timingStats.speedContrast < 1.18) {
      pushIssue({
        severity: 'warning',
        metric: 'speed',
        message: '提示词要求突然爆发，但动态缺少明显速度峰值',
        value: timingStats.speedContrast
      });
    }
    if (semanticPlan.speedLabel === '缓慢' && timingStats.speedContrast > 1.8) {
      pushIssue({
        severity: 'warning',
        metric: 'speed',
        message: '提示词要求缓慢动作，但根节点速度变化过急',
        value: timingStats.speedContrast
      });
    }
    if (semanticPlan.contacts.some((item) => item.contact === 'hands' || item.contact === 'leftHand' || item.contact === 'rightHand')) {
      const handContacts = clip.contacts.filter((item) => item.limb === 'leftHand' || item.limb === 'rightHand');
      if (!handContacts.length) {
        pushIssue({ severity: 'warning', metric: 'contact', message: '提示词要求手部接触，但动态缺少手部接触点' });
      }
      if (handReachDistance > 0.62) {
        pushIssue({
          severity: handReachDistance > 0.9 ? 'error' : 'warning',
          metric: 'contact',
          message: '手部轨迹距离目标接触点过远',
          value: handReachDistance
        });
      }
      if (handContactStats.checkedCount > 0 && handContactStats.successRatio < 0.5) {
        pushIssue({
          severity: 'warning',
          metric: 'contact',
          message: '手部接触帧没有稳定贴近目标',
          value: handContactStats.successRatio
        });
      }
    }
    if (semanticPlan.contacts.some((item) => item.contact === 'feet')) {
      const footContacts = clip.contacts.filter((item) => item.limb === 'leftFoot' || item.limb === 'rightFoot');
      if (!footContacts.length) {
        pushIssue({ severity: 'warning', metric: 'foot_lock', message: '提示词要求脚部贴地，但动态缺少脚部接触点' });
      }
    }
    if (isLocomotionActionType(locomotionActionType)) {
      const minSeparation = qualityTarget.minLegSeparation || (locomotionActionType === 'walk' ? 10 : 14);
      if (locomotionAlternation.maxLegSeparation < minSeparation) {
        pushIssue({ severity: 'warning', metric: 'pose', message: '走跑动作左右腿交替幅度不足', value: Number(locomotionAlternation.maxLegSeparation.toFixed(2)) });
      }
      if (locomotionAlternation.signChanges < 1) {
        pushIssue({ severity: 'warning', metric: 'pose', message: '走跑动作缺少明确的左右腿交替变化', value: locomotionAlternation.signChanges });
      }
      const locomotionDurationRatio = sequenceActionDurationRatio(transition, locomotionActionType);
      const locomotionDurationSec = Math.max(0.1, clip.durationSec * locomotionDurationRatio);
      const gaitCycles = locomotionGaitCycleCount(locomotionActionType, locomotionDurationSec, locomotionGaitTempoScale(transition, locomotionActionType));
      const expectedSupportSwitches = Math.max(
        1,
        Math.floor(gaitCycles * 0.62)
      );
      if (locomotionStats.supportSwitchCount < expectedSupportSwitches) {
        pushIssue({
          severity: 'warning',
          metric: 'foot_lock',
          message: '走跑动作支撑脚交替不足',
          value: locomotionStats.supportSwitchCount
        });
      }
      const minArmSwing = qualityTarget.minArmSwingSeparation || (locomotionActionType === 'walk' ? 10 : locomotionActionType === 'run' ? 18 : 22);
      if (locomotionStats.armSwingSeparation < minArmSwing) {
        pushIssue({
          severity: 'warning',
          metric: 'pose',
          message: '走跑动作手臂反向摆动不足',
          value: locomotionStats.armSwingSeparation
        });
      }
      const maxFootPlantDrift = qualityTarget.maxFootPlantDrift || 9;
      if (locomotionStats.footPlantDrift > maxFootPlantDrift) {
        pushIssue({
          severity: locomotionStats.footPlantDrift > maxFootPlantDrift * 2 ? 'error' : 'warning',
          metric: 'foot_lock',
          message: '走跑动作支撑脚漂移过大',
          value: locomotionStats.footPlantDrift
        });
      }
      const maxRootStepJitter = qualityTarget.maxRootStepJitter || 0.65;
      if (!protectedKeyframeTimes.length && locomotionStats.rootStepJitter > maxRootStepJitter) {
        pushIssue({
          severity: locomotionStats.rootStepJitter > maxRootStepJitter * 1.45 ? 'error' : 'warning',
          metric: 'speed',
          message: '走跑动作根节点步速不稳定',
          value: locomotionStats.rootStepJitter
        });
      }
      if (!protectedKeyframeTimes.length && locomotionStats.rootBacktrackCount > 0) {
        pushIssue({
          severity: locomotionStats.rootBacktrackCount > 2 ? 'error' : 'warning',
          metric: 'speed',
          message: '走跑动作根节点出现反向回抽',
          value: locomotionStats.rootBacktrackCount
        });
      }
      const minPaceCoverage = locomotionActionType === 'walk' ? 0.58 : locomotionActionType === 'run' ? 0.64 : 0.68;
      if (
        locomotionStats.expectedTravelDistance > 0.08
        && locomotionStats.paceCoverageRatio < minPaceCoverage
        && !promptRequestsInPlaceMotion(transition.actionPrompt)
      ) {
        pushIssue({
          severity: locomotionStats.paceCoverageRatio < minPaceCoverage * 0.72 ? 'error' : 'warning',
          metric: 'speed',
          message: '走跑动作根节点位移没有达到提示词要求',
          value: locomotionStats.paceCoverageRatio
        });
      }
      const minSupportCoverage = locomotionActionType === 'walk' ? 0.42 : locomotionActionType === 'run' ? 0.32 : 0.28;
      if (locomotionStats.supportCoverageRatio < minSupportCoverage) {
        pushIssue({
          severity: locomotionStats.supportCoverageRatio < minSupportCoverage * 0.65 ? 'error' : 'warning',
          metric: 'foot_lock',
          message: '走跑动作缺少稳定支撑脚相位',
          value: locomotionStats.supportCoverageRatio
        });
      }
      const minArmLegSync = locomotionActionType === 'walk' ? 0.34 : 0.38;
      if (locomotionStats.armLegSyncScore < minArmLegSync && locomotionStats.armSwingSeparation >= minArmSwing * 0.65) {
        pushIssue({
          severity: 'warning',
          metric: 'pose',
          message: '走跑动作手臂反摆与腿部交替不同步',
          value: locomotionStats.armLegSyncScore
        });
      }
      const contactDensity = locomotionActionType === 'walk' ? 1.35 : locomotionActionType === 'run' ? 1.85 : 2.2;
      const minimumContacts = Math.max(2, Math.floor(locomotionDurationSec * contactDensity));
      const expectedContacts = Math.max(
        minimumContacts,
        Math.floor(gaitCycles * 1.15)
      );
      if (expectedContacts > 0 && locomotionStats.footContactCount < expectedContacts) {
        pushIssue({
          severity: 'warning',
          metric: 'contact',
          message: '走跑动作脚步接触帧不足',
          value: locomotionStats.footContactCount
        });
      }
      if (locomotionStats.footPhaseMismatchCount > 0) {
        pushIssue({
          severity: locomotionStats.footPhaseMismatchCount > 2 ? 'error' : 'warning',
          metric: 'foot_lock',
          message: '走跑动作脚步接触帧与步态相位不匹配',
          value: locomotionStats.footPhaseMismatchCount
        });
      }
    }
    if (hasAction('punch')) {
      const mainHand = inferPromptHand(transition.actionPrompt) === 'left' ? 'left' : 'right';
      const shoulderDelta = maxJointAxisDeltaFromStart(samples, mainHand === 'left' ? 'leftUpperArm' : 'rightUpperArm', 'x');
      const elbowDelta = maxJointAxisDeltaFromStart(samples, mainHand === 'left' ? 'leftLowerArm' : 'rightLowerArm', 'x');
      const minPunchDelta = motionActionSkill('punch')?.quality.minPrimaryJointDelta || 16;
      if (shoulderDelta < minPunchDelta || elbowDelta < minPunchDelta) {
        pushIssue({ severity: 'warning', metric: 'pose', message: '出拳动作主手发力不明显', value: Number(Math.min(shoulderDelta, elbowDelta).toFixed(2)) });
      }
    }
    if (hasAction('push', 'pull')) {
      const pushPullType = hasAction('push') ? 'push' : 'pull';
      const limbs = semanticContactLimbsForAction(pushPullType, transition.actionPrompt)
        .map((limb) => limb === 'leftHand' ? 'left' : 'right');
      const minArmDelta = limbs.reduce((min, limb) => {
        const upper = maxJointAxisDeltaFromStart(samples, limb === 'left' ? 'leftUpperArm' : 'rightUpperArm', 'x');
        const lower = maxJointAxisDeltaFromStart(samples, limb === 'left' ? 'leftLowerArm' : 'rightLowerArm', 'x');
        return Math.min(min, Math.max(upper, lower));
      }, Number.POSITIVE_INFINITY);
      const minPushPullDelta = motionActionSkill(pushPullType)?.quality.minPrimaryJointDelta || 12;
      if (minArmDelta < minPushPullDelta) {
        pushIssue({ severity: 'warning', metric: 'pose', message: pushPullType === 'push' ? '推动作手臂前推幅度不足' : '拉动作手臂回拉幅度不足', value: Number(minArmDelta.toFixed(2)) });
      }
      const hasHandReach = clip.contacts.some((item) => item.limb === 'leftHand' || item.limb === 'rightHand');
      if (!hasHandReach) {
        pushIssue({ severity: 'warning', metric: 'contact', message: pushPullType === 'push' ? '推动作缺少手部接触目标帧' : '拉动作缺少手部抓取目标帧' });
      }
      if (contactActionStats.contactWindowCoverage !== undefined && contactActionStats.contactWindowCoverage < 0.65) {
        pushIssue({
          severity: 'warning',
          metric: 'contact',
          message: pushPullType === 'push' ? '推动作接触窗口不够持续' : '拉动作抓握窗口不够持续',
          value: contactActionStats.contactWindowCoverage
        });
      }
      if ((contactActionStats.bodyDrive || 0) < 7) {
        pushIssue({
          severity: 'warning',
          metric: 'pose',
          message: pushPullType === 'push' ? '推动作缺少身体前压发力' : '拉动作缺少身体后拉发力',
          value: contactActionStats.bodyDrive
        });
      }
      if (contactActionStats.footStability !== undefined && contactActionStats.footStability < 0.42) {
        pushIssue({
          severity: 'warning',
          metric: 'foot_lock',
          message: pushPullType === 'push' ? '推动作脚部支撑不稳定' : '拉动作脚部支撑不稳定',
          value: contactActionStats.footStability
        });
      }
      if (semanticPlan.targetObjectId && (contactActionStats.propMotionDistance || 0) < (pushPullType === 'push' ? 0.14 : 0.1)) {
        pushIssue({
          severity: 'warning',
          metric: 'contact',
          message: pushPullType === 'push' ? '推动作没有带动目标道具向前移动' : '拉动作没有带动目标道具向角色方向移动',
          value: contactActionStats.propMotionDistance
        });
      }
      if (semanticPlan.targetObjectId && contactActionStats.propDirectionAlignment !== undefined && contactActionStats.propDirectionAlignment < 0.45) {
        pushIssue({
          severity: 'warning',
          metric: 'contact',
          message: pushPullType === 'push' ? '推动作目标道具移动方向与推力方向不一致' : '拉动作目标道具移动方向与回拉方向不一致',
          value: contactActionStats.propDirectionAlignment
        });
      }
    }
    if (hasAction('throw')) {
      const mainHand = inferPromptHand(transition.actionPrompt) === 'left' ? 'left' : 'right';
      const shoulderDelta = maxJointAxisDeltaFromStart(samples, mainHand === 'left' ? 'leftUpperArm' : 'rightUpperArm', 'x');
      const twistDelta = maxJointAxisDeltaFromStart(samples, 'chest', 'y');
      const minThrowDelta = motionActionSkill('throw')?.quality.minPrimaryJointDelta || 18;
      if (shoulderDelta < minThrowDelta || twistDelta < 8) {
        pushIssue({ severity: 'warning', metric: 'pose', message: '投掷动作蓄力或出手幅度不足', value: Number(Math.min(shoulderDelta, twistDelta).toFixed(2)) });
      }
      if (!clip.contacts.some((item) => item.kind === 'release')) {
        pushIssue({ severity: 'warning', metric: 'contact', message: '投掷动作缺少出手释放帧' });
      }
      if ((contactActionStats.bodyDrive || 0) < 8) {
        pushIssue({ severity: 'warning', metric: 'pose', message: '投掷动作缺少躯干蓄力和重心转移', value: contactActionStats.bodyDrive });
      }
      if (contactActionStats.throwReleaseDistance !== undefined && contactActionStats.throwReleaseDistance < 0.62) {
        pushIssue({ severity: 'warning', metric: 'contact', message: '投掷动作释放点离身体过近，出手轨迹不明显', value: contactActionStats.throwReleaseDistance });
      }
      if (contactActionStats.contactWindowCoverage !== undefined && contactActionStats.contactWindowCoverage < 0.65) {
        pushIssue({ severity: 'warning', metric: 'contact', message: '投掷动作握持、蓄力、释放窗口不完整', value: contactActionStats.contactWindowCoverage });
      }
      if (semanticPlan.targetObjectId && (contactActionStats.propMotionDistance || 0) < 0.32) {
        pushIssue({ severity: 'warning', metric: 'contact', message: '投掷动作没有带动目标物体形成明显飞出轨迹', value: contactActionStats.propMotionDistance });
      }
      if (semanticPlan.targetObjectId && contactActionStats.propDirectionAlignment !== undefined && contactActionStats.propDirectionAlignment < 0.45) {
        pushIssue({ severity: 'warning', metric: 'contact', message: '投掷目标物体飞出方向与出手方向不一致', value: contactActionStats.propDirectionAlignment });
      }
    }
    if (hasAction('kick', 'side_kick')) {
      const kickType = hasAction('side_kick') ? 'side_kick' : 'kick';
      const kickLeg = inferPromptLeg(transition.actionPrompt) === 'left' ? 'left' : 'right';
      const hipDelta = maxJointAxisDeltaFromStart(samples, kickLeg === 'left' ? 'leftUpperLeg' : 'rightUpperLeg', kickType === 'side_kick' ? 'z' : 'x');
      const kneeDelta = maxJointAxisDeltaFromStart(samples, kickLeg === 'left' ? 'leftLowerLeg' : 'rightLowerLeg', 'x');
      const minKickDelta = motionActionSkill(kickType)?.quality.minPrimaryJointDelta || 14;
      if (hipDelta < minKickDelta || kneeDelta < 10) {
        pushIssue({ severity: 'warning', metric: 'pose', message: '踢腿动作主腿发力不明显', value: Number(Math.min(hipDelta, kneeDelta).toFixed(2)) });
      }
    }
    if (semanticPlan.cameraIntent && !clip.cameraSamples?.length) {
      pushIssue({ severity: 'warning', metric: 'pose', message: '识别到运镜意图，但未生成运镜采样' });
    }
    inspectMotionQualityExpectations(transition, {
      locomotionStats,
      locomotionAlternation,
      handContactStats,
      targetApproachDistance,
      contactActionStats,
      sequenceBoundaryStats,
      samples,
      contacts: clip.contacts
    }).forEach(pushIssue);
    inspectActionSequenceRealization(transition, clip).forEach(pushIssue);
    sequenceBoundaryStats.issues.forEach(pushIssue);
  }

  const motionExpectations = transition.actionPlan.semanticPlan?.qualityExpectations || [];
  const failedExpectationCount = motionExpectations.filter((expectation) => issues.some((issue) => (
    issue.message.includes(`“${expectation.label}”期望`)
    || issue.message.includes(expectation.description)
  ))).length;
  const expectationPassRatio = motionExpectations.length
    ? clamp01((motionExpectations.length - failedExpectationCount) / motionExpectations.length)
    : undefined;
  const issueWeight = issues.reduce((total, issue) => total + (issue.severity === 'error' ? 24 : issue.severity === 'warning' ? 10 : 3), 0);
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    score: Math.max(0, Math.min(100, 100 - issueWeight)),
    issues: issues.slice(0, 24),
    metrics: {
      maxStepDistance: Number(maxStepDistance.toFixed(4)),
      maxRootRotationDelta: Number(maxRootRotationDelta.toFixed(2)),
      rootVelocitySpikeRatio: continuityStats.rootVelocitySpikeRatio,
      poseVelocitySpikeRatio: continuityStats.poseVelocitySpikeRatio,
      maxPoseVelocity: continuityStats.maxPoseVelocity,
      startPositionDrift: Number(startPositionDrift.toFixed(4)),
      endPositionDrift: Number(endPositionDrift.toFixed(4)),
      lockedFootChanges,
      contactCount: clip.contacts.length,
      motionSampleRate: actualSampleRate ? Number(actualSampleRate.toFixed(2)) : undefined,
      locomotionFootPlantDrift: locomotionStats.footPlantDrift,
      locomotionRootStepJitter: locomotionStats.rootStepJitter,
      locomotionFootContactCount: locomotionStats.footContactCount,
      locomotionFootPhaseMismatchCount: locomotionStats.footPhaseMismatchCount,
      locomotionRootBacktrackCount: locomotionStats.rootBacktrackCount,
      locomotionRootTravelDistance: locomotionStats.rootTravelDistance,
      locomotionExpectedTravelDistance: locomotionStats.expectedTravelDistance,
      locomotionPaceCoverageRatio: locomotionStats.paceCoverageRatio,
      locomotionSupportSwitchCount: locomotionStats.supportSwitchCount,
      locomotionSupportCoverageRatio: locomotionStats.supportCoverageRatio,
      locomotionArmSwingSeparation: locomotionStats.armSwingSeparation,
      locomotionArmLegSyncScore: locomotionStats.armLegSyncScore,
      locomotionLegSeparation: locomotionAlternation.maxLegSeparation ? Number(locomotionAlternation.maxLegSeparation.toFixed(2)) : undefined,
      locomotionLegSignChanges: locomotionAlternation.signChanges || undefined,
      semanticTimingPeakRatio: timingStats.peakRatio,
      semanticTimingSpeedContrast: timingStats.speedContrast,
      semanticHandReachDistance: handReachDistance || undefined,
      semanticHandContactSuccessRatio: handContactStats.checkedCount ? handContactStats.successRatio : undefined,
      semanticTargetApproachDistance: targetApproachDistance,
      semanticContactBodyDrive: contactActionStats.bodyDrive,
      semanticContactFootStability: contactActionStats.footStability,
      semanticContactWindowCoverage: contactActionStats.contactWindowCoverage,
      semanticPropMotionDistance: contactActionStats.propMotionDistance,
      semanticPropDirectionAlignment: contactActionStats.propDirectionAlignment,
      semanticThrowReleaseDistance: contactActionStats.throwReleaseDistance,
      semanticPunchExtension: contactActionStats.punchExtension,
      semanticPunchRecoveryRatio: contactActionStats.punchRecoveryRatio,
      sequenceBoundaryMaxPoseDelta: sequenceBoundaryStats.maxPoseDelta || undefined,
      sequenceBoundaryMaxRootDelta: sequenceBoundaryStats.maxRootDelta || undefined,
      sequenceBoundaryMaxRotationDelta: sequenceBoundaryStats.maxRotationDelta || undefined,
      sequenceBoundaryMaxVelocityRatio: sequenceBoundaryStats.maxVelocityRatio > 1 ? sequenceBoundaryStats.maxVelocityRatio : undefined,
      sequenceBoundarySmoothnessRatio: transition.actionPlan.semanticPlan?.actionSequence?.length ? sequenceBoundarySmoothnessRatio(sequenceBoundaryStats) : undefined,
      motionExpectationCount: motionExpectations.length || undefined,
      motionExpectationFailedCount: motionExpectations.length ? failedExpectationCount : undefined,
      motionExpectationPassRatio: expectationPassRatio === undefined ? undefined : Number(expectationPassRatio.toFixed(3))
    }
  };
}

function motionQualityFeedbackNotes(report: MotionQualityReport) {
  const importantIssues = report.issues.filter((issue) => issue.severity !== 'info').slice(0, 5);
  const diagnosis = diagnoseMotionQuality(report);
  const hasIssueText = (text: string) => report.issues.some((issue) => issue.message.includes(text));
  const metricNotes = [
    hasIssueText('靠近后接触承接')
      ? '质量诊断：靠近后接触链路未达标，需要更清晰的移动减速、手部接触和推拉发力。'
      : '',
    hasIssueText('转身投掷承接')
      ? '质量诊断：转身投掷链路未达标，需要更连续的转身、蓄力、释放和回收。'
      : '',
    hasIssueText('下沉恢复后攻击')
      ? '质量诊断：下沉恢复后攻击链路未达标，需要先恢复重心再进入攻击。'
      : '',
    report.metrics.sequenceBoundaryMaxVelocityRatio !== undefined && report.metrics.sequenceBoundaryMaxVelocityRatio > 2.4
      ? `质量诊断：组合动作边界速度突变 ${report.metrics.sequenceBoundaryMaxVelocityRatio.toFixed(2)}x，需要平滑段落衔接。`
      : '',
    report.metrics.rootVelocitySpikeRatio !== undefined && report.metrics.rootVelocitySpikeRatio > 2.8
      ? `质量诊断：根节点速度尖峰 ${report.metrics.rootVelocitySpikeRatio.toFixed(2)}x，需要继续平滑轨迹。`
      : '',
    report.metrics.poseVelocitySpikeRatio !== undefined && report.metrics.poseVelocitySpikeRatio > 3.25
      ? `质量诊断：关节速度尖峰 ${report.metrics.poseVelocitySpikeRatio.toFixed(2)}x，需要降低抽动和过急过渡。`
      : '',
    report.metrics.semanticHandContactSuccessRatio !== undefined && report.metrics.semanticHandContactSuccessRatio < 0.65
      ? `质量诊断：手部接触稳定度 ${Math.round(report.metrics.semanticHandContactSuccessRatio * 100)}%，需要更贴近目标。`
      : '',
    report.metrics.locomotionArmLegSyncScore !== undefined && report.metrics.locomotionArmLegSyncScore < 0.34
      ? `质量诊断：走跑手脚同步度 ${Math.round(report.metrics.locomotionArmLegSyncScore * 100)}%，需要重算步态相位。`
      : ''
  ].filter(Boolean);
  const diagnosisNotes = [
    diagnosis.locomotionNeedsGait ? '质量诊断：需要强化走跑步态、支撑脚和手脚同步。' : '',
    diagnosis.locomotionNeedsRoot ? '质量诊断：需要平滑根节点位移和速度节奏。' : '',
    diagnosis.contactNeedsCorrection ? '质量诊断：需要校正手部接触、目标距离或道具响应。' : '',
    diagnosis.sequenceNeedsSmoothing ? '质量诊断：需要平滑组合动作阶段衔接。' : '',
    diagnosis.airborneNeedsClamp ? '质量诊断：非跳跃动作需要限制离地。' : '',
    diagnosis.excessivePoseNeedsDamping ? '质量诊断：需要降低关节跳变或过大幅度。' : ''
  ].filter(Boolean).slice(0, 3);
  return [
    `动作质量评分：${Math.round(report.score)}/100`,
    report.metrics.motionExpectationCount
      ? `动作期望通过率：${Math.round((report.metrics.motionExpectationPassRatio ?? 0) * 100)}%（${report.metrics.motionExpectationCount - (report.metrics.motionExpectationFailedCount || 0)}/${report.metrics.motionExpectationCount}）`
      : '',
    ...metricNotes.slice(0, 3),
    ...diagnosisNotes,
    ...importantIssues.map((issue) => `动作质量检查：${issue.message}`)
  ].filter(Boolean);
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
  return createSerializedClip(transition, samples, contacts, jointAxisProfileFromClip(clip) || jointAxisProfileFromClip(transition.animationClip), clip.cameraSamples);
}

function propBaseTransform(prop: PropObject): PoseTransform {
  return clampTransformToGround('prop', {
    position: { ...prop.position },
    rotation: { ...prop.rotation },
    scale: { ...prop.scale }
  }, prop);
}

function propGripOffset(prop: PropObject) {
  return vec(0, Math.max(0.03, (prop.scale.y || 0.4) * 0.22), 0);
}

function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

function averageManyVec3(points: Vec3[]) {
  if (!points.length) return vec();
  const total = points.reduce((sum, point) => vec(sum.x + point.x, sum.y + point.y, sum.z + point.z), vec());
  return vec(total.x / points.length, total.y / points.length, total.z / points.length);
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

function semanticPropMotionTransform(base: PoseTransform, prop: PropObject, transition: PoseTransition, sample: AnimationClipSample): PoseTransform | null {
  const semanticPlan = transition.actionPlan.semanticPlan;
  if (!semanticPlan || semanticPlan.targetObjectId !== prop.id) return null;
  const durationSec = Math.max(0.0001, transition.animationClip?.durationSec || transition.durationSec || 1);
  const t = clamp01(sample.timeSec / durationSec);
  const actionType = semanticContactActionAtTime(transition, t) || semanticPlan.actionType;
  const localT = sequenceActionLocalRatio(transition, actionType, t);
  const forward = semanticPropContactForwardDirection(prop, transition, sample, actionType);
  const control = motionControlFromPrompt(transition.actionPrompt, semanticPlan);
  const window = semanticContactWindow(actionType, localT, control);
  if (actionType === 'push') {
    const contact = window.contact;
    const drive = window.drive;
    const amount = 0.36 * control.travelScale * easeCurve(control.speedLabel === '缓慢' ? 'ease_in_out' : 'ease_out', Math.max(contact * 0.42, drive));
    const settle = 1 - window.release;
    return {
      ...base,
      position: {
        x: Number((base.position.x + forward.x * amount).toFixed(4)),
        y: base.position.y,
        z: Number((base.position.z + forward.z * amount).toFixed(4))
      },
      rotation: {
        x: Number((base.rotation.x + sample.transform.rotation.x * 0.04 * contact + 3 * drive * settle * control.forceScale).toFixed(3)),
        y: Number((base.rotation.y + sample.transform.rotation.y * 0.08 * contact).toFixed(3)),
        z: Number((base.rotation.z + 2 * drive * settle * control.forceScale).toFixed(3))
      }
    };
  }
  if (actionType === 'pull') {
    const grab = window.hold;
    const pull = window.drive;
    const settle = 1 - window.release;
    const amount = 0.3 * control.travelScale * grab * pull;
    return {
      ...base,
      position: {
        x: Number((base.position.x - forward.x * amount).toFixed(4)),
        y: base.position.y,
        z: Number((base.position.z - forward.z * amount).toFixed(4))
      },
      rotation: {
        x: Number((base.rotation.x + sample.transform.rotation.x * 0.04 * pull - 2.5 * pull * settle * control.forceScale).toFixed(3)),
        y: Number((base.rotation.y + sample.transform.rotation.y * 0.06 * pull).toFixed(3)),
        z: Number((base.rotation.z - 1.5 * pull * settle * control.forceScale).toFixed(3))
      }
    };
  }
  if (actionType === 'throw') {
    const windup = ramp(localT, 0.08, control.burst ? 0.44 : 0.38) * (1 - window.release);
    const release = window.release;
    const handPreference = inferPromptHand(transition.actionPrompt);
    const throwLimbs: Array<'leftHand' | 'rightHand'> = handPreference === 'both'
      ? ['leftHand', 'rightHand']
      : [handPreference === 'left' ? 'leftHand' : 'rightHand'];
    const handHoldPosition = subtractVec3(averageManyVec3(throwLimbs.map((limb) => approximateHandWorldPosition(sample, limb))), propGripOffset(prop));
    const heldOffset = vec(
      -forward.x * 0.16 * windup,
      0.16 * windup,
      -forward.z * 0.18 * windup
    );
    const heldPosition = lerpVec3(
      vec(base.position.x + heldOffset.x, base.position.y + heldOffset.y, base.position.z + heldOffset.z),
      handHoldPosition,
      clamp01(Math.max(window.reach * 0.72, window.hold))
    );
    if (release <= 0.001) {
      return {
        ...base,
        position: {
          x: Number(heldPosition.x.toFixed(4)),
          y: Number(heldPosition.y.toFixed(4)),
          z: Number(heldPosition.z.toFixed(4))
        },
        rotation: {
          x: Number((base.rotation.x - 18 * windup).toFixed(3)),
          y: Number((base.rotation.y + sample.transform.rotation.y * 0.08 * windup).toFixed(3)),
          z: Number((base.rotation.z + 8 * windup).toFixed(3))
        }
      };
    }
    const ballistic = easeCurve(control.speedLabel === '缓慢' ? 'ease_in_out' : 'ease_out', release);
    const travel = 0.86 * control.travelScale * ballistic;
    const arc = Math.sin(release * Math.PI) * 0.24 * control.forceScale + 0.08 * release;
    return {
      ...base,
      position: {
        x: Number((heldPosition.x + forward.x * travel).toFixed(4)),
        y: Number((heldPosition.y + arc).toFixed(4)),
        z: Number((heldPosition.z + forward.z * travel).toFixed(4))
      },
      rotation: {
        x: Number((base.rotation.x + 118 * release * control.forceScale).toFixed(3)),
        y: Number((base.rotation.y + sample.transform.rotation.y * 0.12).toFixed(3)),
        z: Number((base.rotation.z + 44 * release * control.forceScale).toFixed(3))
      }
    };
  }
  return null;
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
  const semanticMotion = semanticPropMotionTransform(base, prop, transition, sample);
  if (semanticMotion) return semanticMotion;
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

function generateTransition(scene: Scene3DState, transition: PoseTransition): PoseTransition {
  const jointProfile = jointAxisProfileForScene(scene);
  const sequencedTransition = transitionWithRescheduledActionSequence(transition);
  const targetApproachTransition = transitionWithPromptTargetApproachRootMotion(scene, sequencedTransition);
  const rootMotionTransition = transitionWithPromptBasicMotionEndpoints(targetApproachTransition);
  const semanticPlan = rootMotionTransition.actionPlan.semanticPlan;
  const effectiveConstraints: PoseTransitionConstraints = semanticPlan?.contacts.some((item) => item.contact === 'feet')
    ? {
        ...rootMotionTransition.constraints,
        footLock: { enabled: true, left: true, right: true },
        jointLimitsEnabled: rootMotionTransition.constraints.jointLimitsEnabled
      }
    : rootMotionTransition.constraints;
  const effectiveTransition = effectiveConstraints === rootMotionTransition.constraints ? rootMotionTransition : { ...rootMotionTransition, constraints: effectiveConstraints };
  const warningSet = new Set(transition.actionPlan.notes);
  const { issues } = validateTransition(scene, effectiveTransition);
  if (issues.length) {
    return {
      ...transition,
      animationClip: undefined,
      qualityReport: undefined,
      warnings: Array.from(warningSet),
      error: issues.join(' ')
    };
  }
  const durationSec = Math.max(0.1, transition.durationSec);
  const useRigPoseForSemanticMotion = semanticMotionUsesRigPose(effectiveTransition);
  const sampleBonePoseForSemanticMotion = (bonePose?: Scene3DBonePose) => (
    useRigPoseForSemanticMotion ? undefined : bonePose
  );
  const keyframeTrack = transitionKeyframeTrack(effectiveTransition, durationSec).map((item) => ({
    ...item,
    pose: effectiveTransition.constraints.jointLimitsEnabled ? clampPoseWithJointProfile(clonePose(item.pose), jointProfile) : clonePose(item.pose)
  }));
  const startFrame = keyframeTrack[0];
  const endFrame = keyframeTrack[keyframeTrack.length - 1];
  const sampleCount = motionClipSampleCountForTransition(effectiveTransition, durationSec);
  const sampleTimes = sampleTimesForKeyframeTrack(durationSec, sampleCount, keyframeTrack);
  const samples: AnimationClipSample[] = [];
  const contactFrames = buildContactFrames(scene, effectiveTransition, durationSec);
  contactFrames.forEach((frame) => {
    if (!frame.targetObjectId && (frame.kind === 'grasp' || frame.kind === 'release' || frame.kind === 'reach')) {
      warningSet.add(`${frame.note} contact is outside the reachable range`);
    }
  });

  for (const sampleTimeSec of sampleTimes) {
    const t = clamp01(sampleTimeSec / durationSec);
    const motionT = semanticActionTime(effectiveTransition, t);
    const timeSec = sampleTimeSec;
    const segment = keyframeSegmentAt(keyframeTrack, timeSec);
    const eased = easeCurve(transition.curve, segment.localT);
    const keyframeSample = interpolateKeyframeSample(segment.from, segment.to, eased, timeSec);
    const hardKeyframe = exactKeyframeAtTime(keyframeTrack, timeSec);
    const transform = hardKeyframe ? clonePoseTransform(hardKeyframe.transform) : keyframeSample.transform;
    const baseTransform = clonePoseTransform(transform);
    let nextPose = hardKeyframe ? clonePose(hardKeyframe.pose) : keyframeSample.pose;
    if (!hardKeyframe) {
      if (!shouldCompileBasicMotionWithSemanticLayer(effectiveTransition)) {
        nextPose = applyUniversalMotionOverlay(nextPose, transform, effectiveTransition.actionPlan.universal, motionT, jointProfile);
      }
      for (const template of effectiveTransition.actionPlan.templates) {
        if (templateAppliesToBasicMotion(template, effectiveTransition)) {
          nextPose = applyTemplateOverlay(nextPose, transform, template, motionT, jointProfile);
        }
      }
      nextPose = applySemanticActionSequenceOverlay(
        nextPose,
        transform,
        effectiveTransition,
        effectiveTransition.actionPlan.semanticPlan?.actionSequence?.length ? t : motionT,
        jointProfile
      );
      nextPose = applyRealisticMotionGuard(keyframeSample.pose, nextPose, transform, baseTransform, effectiveTransition);
      nextPose = applyGroundedBalanceAndFooting(keyframeSample.pose, nextPose, transform, baseTransform, effectiveTransition, motionT, jointProfile);
      const targets = targetPositionForConstraint(scene, effectiveTransition, transform, motionT);
      if (effectiveTransition.constraints.headLookAt.enabled) nextPose = applyHeadLookAt(nextPose, targets.headTarget, targets.origin);
      const hasTemplateHandTarget = effectiveTransition.actionPlan.templates.some((item) => (
        item.id === 'point_at' || item.id === 'pick_up' || item.id === 'put_down'
      ));
      const hasSemanticHandContact = Boolean(semanticPlan?.contacts.some((item) => item.contact === 'hands' || item.contact === 'leftHand' || item.contact === 'rightHand'));
      if (effectiveTransition.constraints.handTarget.enabled || hasTemplateHandTarget || hasSemanticHandContact) {
        const semanticContacts = semanticPlan?.contacts || [];
        const semanticContactAction = semanticContactActionAtTime(effectiveTransition, t) || semanticPlan?.actionType;
        const semanticSolveHands = semanticContactLimbsForAction(semanticContactAction, effectiveTransition.actionPrompt)
          .filter((limb) => (
            semanticContacts.some((item) => item.contact === 'hands')
            || semanticContacts.some((item) => item.contact === limb)
          ))
          .map((limb) => limb === 'leftHand' ? 'left' : 'right');
        const solveHands: Array<'left' | 'right'> = hasSemanticHandContact
          ? semanticSolveHands.length ? semanticSolveHands : [targets.hand]
          : [targets.hand];
        solveHands.forEach((hand) => {
          const semanticTarget = hasSemanticHandContact
            ? semanticHandTargetForLimb(scene, effectiveTransition, transform, t, hand === 'left' ? 'leftHand' : 'rightHand')
            : null;
          const handTarget = semanticTarget
            ? semanticTarget.position
            : targets.handTarget;
          const solved = solveArmIkToTarget(nextPose, hand, handTarget, targets.origin, semanticTarget ? 0.06 : 0.22);
          nextPose = blendPose(nextPose, solved.pose, clamp01(targets.handStrength || 1));
          if (solved.warning) warningSet.add(solved.warning);
        });
      }
      if (effectiveTransition.constraints.footLock.enabled) {
        if (footLockPhaseActive(effectiveTransition, 'left', t)) {
          nextPose.leftFoot = { ...startFrame.pose.leftFoot };
        }
        if (footLockPhaseActive(effectiveTransition, 'right', t)) {
          nextPose.rightFoot = { ...startFrame.pose.rightFoot };
        }
      }
    }
    if (effectiveTransition.constraints.jointLimitsEnabled) nextPose = clampPoseWithJointProfile(nextPose, jointProfile);
    const baseSample: AnimationClipSample = {
      timeSec: Number(timeSec.toFixed(4)),
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
      bonePose: hardKeyframe ? cloneBonePose(hardKeyframe.bonePose) : sampleBonePoseForSemanticMotion(keyframeSample.bonePose),
      fingerPose: hardKeyframe ? cloneFingerPose(hardKeyframe.fingerPose) : keyframeSample.fingerPose,
      toePose: hardKeyframe ? cloneToePose(hardKeyframe.toePose) : keyframeSample.toePose,
      libTvJointAngles: hardKeyframe ? cloneLibTvJointAngles(hardKeyframe.libTvJointAngles) : keyframeSample.libTvJointAngles
    };
    samples.push(baseSample);
  }

  samples[0] = {
    timeSec: 0,
    transform: startFrame.transform,
    pose: startFrame.pose,
    bonePose: sampleBonePoseForSemanticMotion(startFrame.bonePose),
    fingerPose: startFrame.fingerPose,
    toePose: startFrame.toePose,
    libTvJointAngles: startFrame.libTvJointAngles
  };
  samples[samples.length - 1] = {
    timeSec: Number(durationSec.toFixed(4)),
    transform: endFrame.transform,
    pose: endFrame.pose,
    bonePose: sampleBonePoseForSemanticMotion(endFrame.bonePose),
    fingerPose: endFrame.fingerPose,
    toePose: endFrame.toePose,
    libTvJointAngles: endFrame.libTvJointAngles
  };

  try {
    let finalSamples = stabilizeSemanticContactSamples(
      scene,
      effectiveTransition,
      stabilizeActionSequenceBridgeSamples(
        effectiveTransition,
        stabilizeTargetApproachSequenceSamples(scene, effectiveTransition, polishMotionSamples(effectiveTransition, samples)),
        0.56
      ),
      0.62
    );
    finalSamples = finalizeLocomotionGoldenStandard(effectiveTransition, finalSamples, 0.68);
    finalSamples = restoreExplicitMiddleKeyframeSamples(finalSamples, effectiveTransition);
    let cameraSamples = smoothCameraMotionSamples(buildCameraMotionSamples(scene, effectiveTransition, finalSamples));
    let animationClip = applyRegenerateLockScope(effectiveTransition, createSerializedClip(effectiveTransition, finalSamples, contactFrames, jointProfile, cameraSamples));
    let qualityReport = inspectMotionQuality(scene, effectiveTransition, animationClip);
    for (let correctionPass = 0; correctionPass < 3 && motionQualityNeedsAutoCorrection(qualityReport); correctionPass += 1) {
      const correction = autoCorrectMotionSamples(scene, effectiveTransition, finalSamples, qualityReport, contactFrames);
      correction.notes.forEach((note) => warningSet.add(note));
      finalSamples = stabilizeSemanticContactSamples(
        scene,
        effectiveTransition,
        stabilizeActionSequenceBridgeSamples(effectiveTransition, stabilizeTargetApproachSequenceSamples(scene, effectiveTransition, correction.samples), 0.68),
        0.72
      );
      finalSamples = finalizeLocomotionGoldenStandard(effectiveTransition, finalSamples, 0.78);
      finalSamples = restoreExplicitMiddleKeyframeSamples(finalSamples, effectiveTransition);
      cameraSamples = smoothCameraMotionSamples(buildCameraMotionSamples(scene, effectiveTransition, finalSamples));
      animationClip = applyRegenerateLockScope(effectiveTransition, createSerializedClip(effectiveTransition, finalSamples, contactFrames, jointProfile, cameraSamples));
      qualityReport = inspectMotionQuality(scene, effectiveTransition, animationClip);
    }
    motionQualityFeedbackNotes(qualityReport).forEach((note) => warningSet.add(note));
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
    name: '动作质量预览片段',
    characterId: character.id,
    actionPrompt,
    actionPlan: resolveActionPlan(scene, actionPrompt, { durationSec: 0.28, curve: 'ease_in_out' }),
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
    keyframes: [],
    cameraMotion: defaultCameraMotion(),
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
    name: '3D导演台',
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

// SECTION: Backend and browser API adapters
function uploadCanvasBlob(blob: Blob) {
  const form = new FormData();
  form.append('file', new File([blob], 'scene3d-' + Date.now() + '.png', { type: 'image/png' }));
  form.append('key', 'scene3d-capture');
  return fetch('/api/media/upload', { method: 'POST', body: form }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.success || !body?.assetId || !body?.url) {
      throw new Error(body?.error || '截图上传失败');
    }
    return { assetId: String(body.assetId), url: String(body.url) };
  });
}

function uploadScene3DVideoBlob(blob: Blob, durationSec: number) {
  const mime = (blob.type || 'video/webm').split(';')[0].trim().toLowerCase() || 'video/webm';
  const extension = mime.includes('mp4') ? 'mp4' : 'webm';
  const form = new FormData();
  form.append('file', new File([blob], 'scene3d-recording-' + Date.now() + '.' + extension, { type: mime }));
  form.append('key', 'scene3d-recording');
  return fetch('/api/media/upload', { method: 'POST', body: form }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.success || !body?.assetId || !body?.url) {
      throw new Error(body?.error || '视频录制上传失败');
    }
    return {
      mediaAssetId: String(body.assetId),
      mediaUrl: String(body.url),
      mimeType: String(body.mimeType || mime),
      name: body.originalName ? String(body.originalName) : `Scene3D 时间轴录制${extension}`,
      durationSec,
      durationMs: Math.round(durationSec * 1000)
    };
  });
}

function preferredTimelineRecordingMimeType() {
  const candidates = [
    'video/mp4;codecs=h264',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || 'video/webm';
}

function parseAspectRatio(value: string) {
  const parts = String(value || '').split(':').map((part) => Number(part));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || parts[0] <= 0 || parts[1] <= 0) {
    return 16 / 9;
  }
  return parts[0] / parts[1];
}

function aspectCropRect(sourceWidth: number, sourceHeight: number, aspectRatio: string) {
  if (!sourceWidth || !sourceHeight) throw new Error('WebGL 画布为空，无法导出 3D 导演台媒体');
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
  return { sx, sy, sw, sh };
}

function createAspectRecordingCanvas(sourceCanvas: HTMLCanvasElement, aspectRatio: string) {
  const crop = aspectCropRect(sourceCanvas.width, sourceCanvas.height, aspectRatio);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = crop.sw;
  outputCanvas.height = crop.sh;
  const context = outputCanvas.getContext('2d');
  if (!context) throw new Error('无法创建时间轴录制画布');
  const drawFrame = () => {
    context.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    context.drawImage(sourceCanvas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outputCanvas.width, outputCanvas.height);
  };
  drawFrame();
  return { canvas: outputCanvas, drawFrame, width: outputCanvas.width, height: outputCanvas.height };
}

function waitForRenderedFrames(count = 2) {
  return new Promise<void>((resolve) => {
    let remaining = Math.max(1, count);
    const next = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });
}

async function canvasToAspectBlob(sourceCanvas: HTMLCanvasElement, aspectRatio: string) {
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  if (!sourceWidth || !sourceHeight) throw new Error('WebGL 画布为空，无法截图');
  const { sx, sy, sw, sh } = aspectCropRect(sourceWidth, sourceHeight, aspectRatio);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = sw;
  outputCanvas.height = sh;
  const context = outputCanvas.getContext('2d');
  if (!context) throw new Error('无法创建截图导出画布');
  context.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob((nextBlob) => (nextBlob ? resolve(nextBlob) : reject(new Error('导出裁剪截图失败'))), 'image/png');
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
    onError('WebGL 渲染器不可用，无法截图');
    return;
  }
  await waitForRenderedFrames(3);
  const canvas = renderer.domElement;
  const cropped = await canvasToAspectBlob(canvas, scene.aspectRatio);
  const uploaded = await uploadCanvasBlob(cropped.blob);
  const activeCamera = scene.objects.cameras.find((camera) => camera.id === scene.activeCameraId) || scene.objects.cameras[0];
  const activeCameraTargetPosition = cameraEffectiveTargetPosition(activeCamera);
  const nextCapture: Capture = {
    id: createId('cap'),
    name: '截图 ' + (scene.captures.length + 1),
    type: scene.activeViewMode === 'camera' ? 'camera_view_capture' : 'director_view_capture',
    mediaUrl: uploaded.url,
    mediaAssetId: uploaded.assetId,
    width: cropped.width,
    height: cropped.height,
    cameraId: activeCamera?.id,
    cameraName: activeCamera?.name,
    fov: activeCamera?.fov || 45,
    cameraPosition: activeCamera?.position || vec(),
    targetPosition: activeCameraTargetPosition,
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
  onPatch(nextScene, { label: '截图 ' + (scene.captures.length + 1) });
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
  const localActionPlan = input.transition.actionPlan;
  const localCompilerContract = motionIntentLocalCompilerContract(input.transition, localActionPlan);
  return {
    projectId: input.currentProjectId || undefined,
    nodeId: input.node.id,
    transitionId: input.transition.id,
    selectedCharacterId: input.character.id,
    actionPrompt: input.transition.actionPrompt || '起点和终点之间的自然动作',
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
    fixedPoseConstraints: localCompilerContract.fixedPoseConstraints,
    middleKeyframeConstraints: localCompilerContract.fixedPoseConstraints.filter((frame) => frame.role === 'middle'),
    currentCharacterTransform: {
      position: input.character.position,
      rotation: input.character.rotation,
      scale: input.character.scale,
      bonePose: input.character.bonePose
    },
    constraints: input.transition.constraints,
    localSemanticPlan: localActionPlan.semanticPlan,
    localActionPlan,
    localCompilerContract,
    availableSemanticStageTemplates: Array.from(new Set([
      input.transition.actionPlan.semanticPlan?.actionType,
      'walk',
      'run',
      'push',
      'throw',
      'punch',
      'block',
      'kick',
      'jump',
      'crouch',
      'crawl',
      'fall',
      'get_up'
    ].filter(Boolean))).map((actionType) => ({
      actionType,
      stages: motionStagesForAction(actionType as MotionSemanticActionType)
    })),
    availableActionSkills: serializableMotionActionSkills(),
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
    motionSolverInstruction: 'Return MotionIntent only. Do not generate raw per-frame joint rotations, raw keyframes, transforms, animationClip, bonePose, jointRotations, or constraints. Treat localCompilerContract as the executable truth: preserve locked actionType/actionFamily, actionSequence, poseStages, contacts, target object, grounded/airborne limits, and quality expectations. Choose actionFamily/actionType from availableActionSkills. The frontend compiler will map intent into root trajectory, contacts, and local XYZ joint deltas using jointAxisProfile ranges and semantics.',
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


// SECTION: React node shell and scene state bridge
export default function Scene3DNode({
  node,
  isSelected,
  onUpdate,
  onSelect,
  onCreateImageNode,
  onCreateRecordedVideoNode,
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
            label: options.label || '编辑场景',
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
          <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
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
            <Suspense fallback={<Html center><div className="rounded bg-black/70 px-3 py-2 text-xs text-zinc-200">加载 3D 预览...</div></Html>}>
              <ScenePreviewViewport scene={scene} active={!open} />
            </Suspense>
          </ThreeCanvas>

          <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-md border border-white/5 bg-black/45 px-2 py-1 backdrop-blur-md">
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
              {'打开导演台'}
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
              <span className="text-zinc-400">{'画幅'}</span>
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
              <img src={lastCapture.mediaUrl} alt="截图预览" className="h-10 w-16 rounded object-cover" />
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
          onCreateRecordedVideoNode={onCreateRecordedVideoNode}
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
  onCreateImageNode,
  onCreateRecordedVideoNode
}: {
  node: CanvasNode;
  scene: Scene3DState;
  currentProjectId?: string | null;
  onClose: () => void;
  onPatch: SceneChangeHandler;
  onError: (message: string) => void;
  onCreateImageNode?: (result: Scene3DCaptureResult) => void;
  onCreateRecordedVideoNode?: (result: Scene3DRecordedVideoResult) => void;
}) {
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const blankPointerDownRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const suppressBlankSelectionUntilRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [captureCleanFrame, setCaptureCleanFrame] = useState(false);
  const [objectSearch, setObjectSearch] = useState('');
  const [timelinePreviewExitConfirmOpen, setTimelinePreviewExitConfirmOpen] = useState(false);
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
  const previewCleanFrame = Boolean(previewLocked && preview.playing);

  useEffect(() => {
    if (!previewCleanFrame) setTimelinePreviewExitConfirmOpen(false);
  }, [previewCleanFrame]);

  const exitTimelinePreview = () => {
    setTimelinePreviewExitConfirmOpen(false);
    setPreview((current) => ({ ...current, transitionId: undefined, currentTimeSec: 0, playing: false, enabled: false }));
    onPatch({ activeTransitionId: undefined }, { history: false });
    onError('');
  };

  const askExitTimelinePreview = () => {
    if (!previewCleanFrame) return;
    setTimelinePreviewExitConfirmOpen(true);
  };


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
    const transitionId = activeTransition.id;
    let lastAt = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = (now - lastAt) / 1000;
      lastAt = now;
      setPreview((current) => {
        if (!current.playing || current.transitionId !== transitionId) return current;
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
    }, 33);
    return () => window.clearInterval(timer);
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
          [key]: (current.objects as any)[key].map((item: any) => {
            if (item.id !== id) return item;
            let nextItem = { ...item, ...patch };
            if (current.gridSnapEnabled && (patch.position || patch.rotation || patch.scale)) {
              const gridPatch = gridSnapPatchForChangedAxes(kind, {
                position: item.position,
                rotation: item.rotation,
                scale: item.scale
              }, patch);
              const snappedTransform = applyGridSnapToTransform(kind, {
                position: nextItem.position,
                rotation: nextItem.rotation,
                scale: nextItem.scale
              }, gridPatch);
              nextItem = {
                ...nextItem,
                position: snappedTransform.position,
                rotation: snappedTransform.rotation,
                scale: snappedTransform.scale
              };
            }
            if (!current.groundEnabled || options.skipGroundClamp) return nextItem;
            if (kind === 'prop') return clampPropToGround(nextItem);
            return nextItem;
          })
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
      await waitForRenderedFrames(3);
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

  async function recordTimeline() {
    const transition = activeTransitionCandidate;
    const renderer = glRef.current;
    const canvas = renderer?.domElement;
    if (!transition?.animationClip) {
      onError('请先生成可播放的动态');
      return;
    }
    if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      onError('当前浏览器不支持录制 3D 画布');
      return;
    }
    try {
      setRecording(true);
      setCaptureCleanFrame(true);
      await waitForRenderedFrames(3);
      const durationSec = Math.max(0.1, transition.animationClip.durationSec || transition.durationSec);
      const recordingCanvas = createAspectRecordingCanvas(canvas, scene.aspectRatio);
      recordingCanvas.drawFrame();
      const stream = recordingCanvas.canvas.captureStream(30);
      const recorderMimeType = preferredTimelineRecordingMimeType();
      const outputMimeType = recorderMimeType.split(';')[0].trim().toLowerCase() || 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: recorderMimeType });
      const chunks: BlobPart[] = [];
      const stopped = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => reject(new Error('录制失败'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: outputMimeType }));
      });
      setPreview({ transitionId: transition.id, currentTimeSec: 0, playing: true, loop: false, enabled: true });
      recorder.start(250);
      await new Promise<void>((resolve) => {
        const startedAt = performance.now();
        const tick = () => {
          const elapsed = (performance.now() - startedAt) / 1000;
          const currentTimeSec = Math.min(durationSec, elapsed);
          setPreview({ transitionId: transition.id, currentTimeSec, playing: currentTimeSec < durationSec, loop: false, enabled: true });
          recordingCanvas.drawFrame();
          if (currentTimeSec >= durationSec) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      recorder.requestData();
      recorder.stop();
      const blob = await stopped;
      stream.getTracks().forEach((track) => track.stop());
      if (blob.size <= 0) throw new Error('录制结果为空');
      const uploaded = await uploadScene3DVideoBlob(blob, durationSec);
      onCreateRecordedVideoNode?.({
        video: uploaded,
        transition: {
          id: transition.id,
          name: transition.name,
          actionPrompt: transition.actionPrompt
        }
      });
      onError(uploaded.mimeType.includes('mp4') ? '录制完成' : '录制完成，当前浏览器输出 WebM，后端未转为 MP4');
    } catch (error: any) {
      onError(error?.message || '录制失败');
    } finally {
      setRecording(false);
      setCaptureCleanFrame(false);
      if (activeTransitionCandidate) {
        setPreview((current) => ({ ...current, transitionId: activeTransitionCandidate.id, currentTimeSec: 0, playing: false, enabled: false }));
      }
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
            <ToolButton icon={<Move3D className="h-4 w-4" />} label={'移动'} shortcut="V" active={scene.transformMode === 'translate'} onClick={() => onPatch({ transformMode: 'translate' }, { history: false })} />
            <ToolButton icon={<RotateCw className="h-4 w-4" />} label={'旋转'} shortcut="R" active={scene.transformMode === 'rotate'} onClick={() => onPatch({ transformMode: 'rotate' }, { history: false })} />
            <ToolButton icon={<ZoomIn className="h-4 w-4" />} label={'缩放'} shortcut="S" active={scene.transformMode === 'scale'} onClick={() => onPatch({ transformMode: 'scale' }, { history: false })} />
            <ToolButton icon={<ImagePlus className="h-4 w-4" />} label={capturing ? '截图中...' : '截图'} shortcut="Z" disabled={capturing} onClick={capture} />
            <div className="mx-1 h-5 w-px bg-white/10" />
            <Segmented
              value={scene.activeViewMode}
              options={[
                { value: 'director', label: '导演视图' },
                { value: 'camera', label: '机位视图' }
              ]}
              onChange={(value) => {
                const activeViewMode = value as Scene3DState['activeViewMode'];
                const firstCameraId = scene.objects.cameras[0]?.id;
                onPatch({
                  activeViewMode,
                  activeCameraId: activeViewMode === 'camera' ? firstCameraId : scene.activeCameraId || firstCameraId,
                  selectedObjectId: activeViewMode === 'camera' ? firstCameraId : scene.selectedObjectId
                }, { history: false });
              }}
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
              <Suspense fallback={<Html center><div className="rounded bg-black/70 px-3 py-2 text-xs">{'加载 3D 场景...'}</div></Html>}>
                <SceneViewport
                  scene={scene}
                  selectedKind={selected}
                  dragging={dragging}
                  previewTransitionId={preview.transitionId}
                  previewLocked={previewLocked}
                  previewSample={previewSample}
                  presentation={captureCleanFrame || previewCleanFrame ? 'clean' : 'editor'}
                  onDragging={handleViewportDragging}
                  onBlankPointerDown={handleViewportBlankPointerDown}
                  onBlankPointerUp={handleViewportBlankPointerUp}
                  onSceneObjectPointerDown={handleViewportObjectPointerDown}
                  onPatch={onPatch}
                  onUpdateObject={updateObject}
                />
              </Suspense>
            </ThreeCanvas>
            {previewCleanFrame && (
              <div
                className="absolute inset-0 z-20 cursor-not-allowed bg-transparent"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  askExitTimelinePreview();
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  askExitTimelinePreview();
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerMove={(event) => {
                  if (event.buttons !== 1) return;
                  event.preventDefault();
                  event.stopPropagation();
                  askExitTimelinePreview();
                }}
                title={'当前正在播放时间轴动态'}
              />
            )}
            {timelinePreviewExitConfirmOpen && previewCleanFrame && (
              <div
                className="absolute left-1/2 top-1/2 z-40 w-[min(360px,86%)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/10 bg-[#10131b] p-4 text-center shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="text-sm font-semibold text-zinc-100">当前正在播放时间轴动态</div>
                <div className="mt-2 text-[12px] leading-relaxed text-zinc-400">是否要退出预览？确认后会停止播放并回到可编辑状态，取消则继续预览。</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTimelinePreviewExitConfirmOpen(false)}
                    className="h-8 rounded-md border border-white/10 bg-white/5 text-[12px] font-medium text-zinc-200 hover:bg-white/10"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={exitTimelinePreview}
                    className="h-8 rounded-md border border-violet-400/40 bg-violet-500/20 text-[12px] font-medium text-violet-100 hover:bg-violet-500/30"
                  >
                    确认退出
                  </button>
                </div>
              </div>
            )}
          </div>
          <PropertyPanel
            node={node}
            scene={scene}
            currentProjectId={currentProjectId}
            selectedKind={selected}
            preview={preview}
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
            recording={recording}
            onRecordTimeline={recordTimeline}
            onError={onError}
          />
        </div>
      </div>
    </div>
  );
}

// SECTION: Three.js viewport, scene primitives, imported models, and rig application
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
  const previewCameraActive = Boolean(previewLocked && previewSample && previewTransition?.animationClip?.cameraSamples?.length);
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
    if (!activeCamera || dragging) return;
    const previewCameraSample = previewCameraActive && previewSample && previewTransition?.animationClip?.cameraSamples?.length
      ? sampleCameraMotionAtTime(previewTransition.animationClip.cameraSamples, previewSample.timeSec)
      : undefined;
    if (scene.activeViewMode !== 'camera' && !previewCameraSample) return;
    const cameraPosition = previewCameraSample?.position || activeCamera.position;
    const cameraLookTarget = previewCameraSample?.targetPosition || cameraEffectiveTargetPosition(activeCamera);
    camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    camera.lookAt(new THREE.Vector3(cameraLookTarget.x, cameraLookTarget.y, cameraLookTarget.z));
    if ('fov' in camera) {
      const projection = cameraLensProjection(activeCamera);
      const perspectiveCamera = camera as THREE.PerspectiveCamera;
      perspectiveCamera.fov = previewCameraSample?.fov || projection.fov;
      perspectiveCamera.zoom = projection.zoom;
      perspectiveCamera.filmOffset = projection.filmOffset;
      perspectiveCamera.updateProjectionMatrix();
    }
  }, [scene, activeCamera, camera, dragging, previewCameraActive, previewSample, previewTransition]);
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
          position={[0, -0.002, 0]}
          onPointerDown={handleGroundPointerDown}
          onPointerUp={handleGroundPointerUp}
        >
          <planeGeometry args={[40, 40]} />
          <shadowMaterial opacity={0.25} depthWrite={false} />
        </mesh>
      )}
      {scene.groundGridEnabled && (
        <Grid
          args={[40, 40]}
          cellColor="#1f2940"
          sectionColor="#2f3d5c"
          cellThickness={0.45}
          sectionThickness={0.9}
          fadeDistance={42}
          fadeStrength={1.4}
          position={[0, 0, 0]}
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
          const rawDisplay = previewLocked && previewCharacterId === character.id && previewSample
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
          const displayTransform = { position: rawDisplay.position, rotation: rawDisplay.rotation, scale: rawDisplay.scale };
          const groundSnapEnabled = shouldSnapPosePresetToGround(rawDisplay.posePresetId);
          return (
            <Transformable
              key={character.id}
              kind="character"
              id={character.id}
              objectTransform={displayTransform}
              scene={scene}
              selected={!isClean && scene.selectedObjectId === character.id && selectedKind === 'character'}
              locked={isClean || character.locked || previewLocked}
              transformMode={scene.transformMode}
              onDragging={handleTransformDragging}
              onPointerDown={handleSceneObjectPointerDown}
              onUpdateObject={onUpdateObject}
              collisionSource={{ ...character, scale: rawDisplay.scale, rigPose: rawDisplay.rigPose }}
              groundSnapEnabled={groundSnapEnabled}
              groundSnapKey={[
                rawDisplay.posePresetId || '',
                groundSnapEnabled ? 'grounded' : 'airborne',
                JSON.stringify(rawDisplay.rigPose),
                JSON.stringify(rawDisplay.bonePose || null),
                JSON.stringify(rawDisplay.fingerPose || null),
                JSON.stringify(rawDisplay.toePose || null)
              ].join('|')}
            >
              <CharacterModel
                character={character}
                effectivePose={rawDisplay.rigPose}
                effectiveBonePose={rawDisplay.bonePose}
                effectiveFingerPose={rawDisplay.fingerPose}
                effectiveToePose={rawDisplay.toePose}
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
          const rawDisplay = previewPropTransforms[prop.id] || propBaseTransform(prop);
          const display = scene.groundEnabled ? clampTransformToGround('prop', rawDisplay, prop) : rawDisplay;
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
              collisionSource={prop}
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
              cameraObject={{ ...cameraObject, targetPosition: cameraEffectiveTargetPosition(cameraObject) }}
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
      {!isClean && <OrbitControls enabled={!dragging && scene.activeViewMode === 'director' && !previewCameraActive} target={[0, 0.95, 0]} makeDefault />}
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

function cameraMotionProgress(config: CameraMotionConfig, timeSec: number) {
  if (!config.enabled || config.type === 'none') return 0;
  const span = Math.max(0.0001, config.endTimeSec - config.startTimeSec);
  return clampNumber((timeSec - config.startTimeSec) / span, 0, 1);
}

function cameraSampleForMotion(baseCamera: CameraObject | undefined, config: CameraMotionConfig, characterSample: AnimationClipSample): CameraMotionSample | undefined {
  if (!baseCamera || !config.enabled || config.type === 'none') return undefined;
  const progress = easeCurve('ease_in_out', cameraMotionProgress(config, characterSample.timeSec));
  const intensity = config.intensity;
  const basePosition = new THREE.Vector3(baseCamera.position.x, baseCamera.position.y, baseCamera.position.z);
  const baseTarget = new THREE.Vector3(baseCamera.targetPosition.x, baseCamera.targetPosition.y, baseCamera.targetPosition.z);
  const characterTarget = new THREE.Vector3(characterSample.transform.position.x, characterSample.transform.position.y + 1.05 + config.heightOffset, characterSample.transform.position.z);
  const target = config.keepCharacterInFrame ? characterTarget : baseTarget.clone();
  const forward = target.clone().sub(basePosition);
  if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
  right.normalize();
  let position = basePosition.clone();
  let targetPosition = target.clone();
  const amount = config.distance * intensity * progress;
  if (config.type === 'dolly_in') position.add(forward.clone().multiplyScalar(amount));
  if (config.type === 'dolly_out') position.add(forward.clone().multiplyScalar(-amount));
  if (config.type === 'truck_left') position.add(right.clone().multiplyScalar(-amount));
  if (config.type === 'truck_right') position.add(right.clone().multiplyScalar(amount));
  if (config.type === 'follow_character' || config.type === 'close_follow') {
    const distance = config.type === 'close_follow' ? Math.max(0.8, config.distance) : Math.max(1.4, config.distance);
    position = target.clone().add(forward.clone().multiplyScalar(-distance)).add(new THREE.Vector3(0, config.heightOffset, 0));
  }
  if (config.type === 'orbit') {
    const angle = THREE.MathUtils.degToRad(config.orbitAngleDeg * intensity * progress);
    const offset = basePosition.clone().sub(target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    position = target.clone().add(offset);
  }
  if (config.type === 'low_tilt_up') {
    position.y = basePosition.y - amount * 0.35;
    targetPosition.y = target.y + amount * 0.45;
  }
  if (config.type === 'top_tilt_down') {
    position.y = basePosition.y + amount * 0.55;
    targetPosition.y = target.y - amount * 0.25;
  }
  if (config.type === 'handheld') {
    position.x += Math.sin(characterSample.timeSec * 18) * 0.035 * intensity;
    position.y += Math.cos(characterSample.timeSec * 13) * 0.025 * intensity;
  }
  return {
    timeSec: characterSample.timeSec,
    position: vec(Number(position.x.toFixed(4)), Number(position.y.toFixed(4)), Number(position.z.toFixed(4))),
    targetPosition: vec(Number(targetPosition.x.toFixed(4)), Number(targetPosition.y.toFixed(4)), Number(targetPosition.z.toFixed(4))),
    fov: baseCamera.fov
  };
}

function buildCameraMotionSamples(scene: Scene3DState, transition: PoseTransition, samples: AnimationClipSample[]): CameraMotionSample[] | undefined {
  if (!transition.cameraMotion.enabled || transition.cameraMotion.type === 'none') return undefined;
  const baseCamera = scene.objects.cameras.find((item) => item.id === scene.activeCameraId) || scene.objects.cameras[0];
  const focusedBaseCamera = baseCamera
    ? { ...baseCamera, targetPosition: cameraEffectiveTargetPosition(baseCamera) }
    : undefined;
  const cameraSamples = samples
    .map((sample) => cameraSampleForMotion(focusedBaseCamera, transition.cameraMotion, sample))
    .filter((sample): sample is CameraMotionSample => Boolean(sample));
  return cameraSamples.length ? cameraSamples : undefined;
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
  collisionSource,
  groundSnapKey,
  groundSnapEnabled = true,
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
  collisionSource?: CharacterObject | PropObject;
  groundSnapKey?: string;
  groundSnapEnabled?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const draggingRef = useRef(false);
  const previousGroundEnabledRef = useRef(scene.groundEnabled);
  const previousGroundSnapKeyRef = useRef(groundSnapKey);
  const initialGroundSnapRef = useRef(false);
  const groundSnapSettleRef = useRef<{ frames: number; latestGroundedY: number | null }>({ frames: 0, latestGroundedY: null });
  const displayTransform = scene.groundEnabled ? clampTransformToGround(kind, objectTransform, collisionSource) : objectTransform;
  const shouldAutoSnapToGround = kind === 'character' && groundSnapEnabled;
  const [controlPivotOffset, setControlPivotOffset] = useState<Vec3>(() => vec());
  const [controlSize, setControlSize] = useState(() => transformControlSizeForKind(kind, objectTransform.scale));
  const getRenderedBounds = (group: THREE.Group) => {
    group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const skinnedVertex = new THREE.Vector3();
    const worldVertex = new THREE.Vector3();
    group.traverse((object) => {
      if (object === group) return;
      for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
        if (parent.userData?.ignoreGroundBounds) return;
      }
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const skinnedMesh = mesh as THREE.SkinnedMesh;
      const positionAttribute = mesh.geometry.getAttribute('position');
      const boneTransform = ((skinnedMesh as any).applyBoneTransform || (skinnedMesh as any).boneTransform) as ((index: number, target: THREE.Vector3) => THREE.Vector3) | undefined;
      if (skinnedMesh.isSkinnedMesh && positionAttribute && boneTransform) {
        for (let index = 0; index < positionAttribute.count; index += 1) {
          skinnedVertex.fromBufferAttribute(positionAttribute, index);
          boneTransform.call(skinnedMesh, index, skinnedVertex);
          worldVertex.copy(skinnedVertex).applyMatrix4(skinnedMesh.matrixWorld);
          box.expandByPoint(worldVertex);
        }
        return;
      }
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const geometryBox = mesh.geometry.boundingBox;
      if (!geometryBox) return;
      box.union(geometryBox.clone().applyMatrix4(mesh.matrixWorld));
    });
    return box;
  };
  const getRenderedGroundY = (group: THREE.Group) => {
    const box = getRenderedBounds(group);
    if (!Number.isFinite(box.min.y)) return group.position.y;
    return group.position.y - box.min.y;
  };
  const transformedLocalOffset = (offset: Vec3, rotation: Vec3, scale: Vec3) => {
    const result = new THREE.Vector3(
      offset.x * (scale.x || 1),
      offset.y * (scale.y || 1),
      offset.z * (scale.z || 1)
    );
    result.applyEuler(new THREE.Euler(rad(rotation.x), rad(rotation.y), rad(rotation.z), 'XYZ'));
    return vec(result.x, result.y, result.z);
  };
  const pivotWorldOffset = kind === 'character'
    ? transformedLocalOffset(controlPivotOffset, displayTransform.rotation, displayTransform.scale)
    : vec();
  const pivotDisplayPosition = vec(
    displayTransform.position.x + pivotWorldOffset.x,
    displayTransform.position.y + pivotWorldOffset.y,
    displayTransform.position.z + pivotWorldOffset.z
  );
  useLayoutEffect(() => {
    const group = ref.current;
    if (!group || kind !== 'character' || draggingRef.current) return;
    const box = getRenderedBounds(group);
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const localCenter = group.worldToLocal(center);
    if (localCenter.length() < 0.003) return;
    setControlPivotOffset((current) => vec(
      Number((current.x + localCenter.x).toFixed(4)),
      Number((current.y + localCenter.y).toFixed(4)),
      Number((current.z + localCenter.z).toFixed(4))
    ));
  });
  const snapRenderedObjectToGround = (group: THREE.Group) => {
    if (!scene.groundEnabled || !shouldAutoSnapToGround) return false;
    const groundedY = getRenderedGroundY(group);
    if (!Number.isFinite(groundedY)) return false;
    const previousGroundedY = groundSnapSettleRef.current.latestGroundedY;
    groundSnapSettleRef.current.latestGroundedY = groundedY;
    if (
      Math.abs(group.position.y - groundedY) < 0.001 &&
      (previousGroundedY === null || Math.abs(previousGroundedY - groundedY) < 0.001)
    ) {
      return false;
    }
    group.position.y = Number(groundedY.toFixed(3));
    group.updateMatrixWorld(true);
    return true;
  };
  const clampRenderedObjectToGround = (group: THREE.Group) => {
    if (!scene.groundEnabled || (kind !== 'character' && kind !== 'prop')) return false;
    if (kind === 'prop') {
      const rawTransform = readGroupTransform(group);
      const nextTransform = clampTransformToGround(kind, rawTransform, collisionSource);
      if (nextTransform.position === rawTransform.position) return false;
      group.position.set(nextTransform.position.x, nextTransform.position.y, nextTransform.position.z);
      group.updateMatrixWorld(true);
      return true;
    }
    const groundedY = getRenderedGroundY(group);
    if (!Number.isFinite(groundedY)) return false;
    if (group.position.y >= groundedY - 0.001) return false;
    group.position.y = Number(groundedY.toFixed(3));
    group.updateMatrixWorld(true);
    return true;
  };
  useLayoutEffect(() => {
    const group = ref.current;
    const groundJustEnabled = scene.groundEnabled && !previousGroundEnabledRef.current;
    const groundSnapKeyChanged = groundSnapKey !== previousGroundSnapKeyRef.current;
    previousGroundEnabledRef.current = scene.groundEnabled;
    previousGroundSnapKeyRef.current = groundSnapKey;
    if (!group || !scene.groundEnabled || kind !== 'character' || draggingRef.current) return;
    const shouldSnapToStandard = shouldAutoSnapToGround && (groundJustEnabled || groundSnapKeyChanged || !initialGroundSnapRef.current);
    initialGroundSnapRef.current = true;
    if (shouldSnapToStandard) {
      groundSnapSettleRef.current.latestGroundedY = null;
      groundSnapSettleRef.current.frames = Math.max(groundSnapSettleRef.current.frames, GROUND_SNAP_SETTLE_FRAMES);
    }
    const changed = shouldSnapToStandard
      ? snapRenderedObjectToGround(group)
      : clampRenderedObjectToGround(group);
    if (!changed) return;
    const nextTransform = readGroupTransform(group);
    onUpdateObject(kind, id, nextTransform, { history: false, skipGroundClamp: true });
  }, [displayTransform.position.x, displayTransform.position.y, displayTransform.position.z, displayTransform.rotation.x, displayTransform.rotation.y, displayTransform.rotation.z, displayTransform.scale.x, displayTransform.scale.y, displayTransform.scale.z, groundSnapKey, id, kind, scene.groundEnabled, shouldAutoSnapToGround]);
  useFrame(() => {
    if (!scene.groundEnabled || kind !== 'character' || draggingRef.current || groundSnapSettleRef.current.frames <= 0) return;
    const group = ref.current;
    if (!group) return;
    groundSnapSettleRef.current.frames -= 1;
    const changed = shouldAutoSnapToGround
      ? snapRenderedObjectToGround(group)
      : clampRenderedObjectToGround(group);
    if (!changed) return;
    const nextTransform = readGroupTransform(group);
    onUpdateObject(kind, id, nextTransform, { history: false, skipGroundClamp: true });
  });
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
  const readGroupTransform = (group: THREE.Group): PoseTransform => {
    const rotation = vec(Number(deg(group.rotation.x).toFixed(2)), Number(deg(group.rotation.y).toFixed(2)), Number(deg(group.rotation.z).toFixed(2)));
    const scale = vec(Number(group.scale.x.toFixed(3)), Number(group.scale.y.toFixed(3)), Number(group.scale.z.toFixed(3)));
    const pivotOffset = kind === 'character'
      ? transformedLocalOffset(controlPivotOffset, rotation, scale)
      : vec();
    return {
      position: vec(
        Number((group.position.x - pivotOffset.x).toFixed(3)),
        Number((group.position.y - pivotOffset.y).toFixed(3)),
        Number((group.position.z - pivotOffset.z).toFixed(3))
      ),
      rotation,
      scale
    };
  };
  const sync = () => {
    const group = ref.current;
    if (!group) return;
    if (scene.groundEnabled) clampRenderedObjectToGround(group);
    const nextTransform = readGroupTransform(group);
    group.position.set(nextTransform.position.x, nextTransform.position.y, nextTransform.position.z);
    onUpdateObject(kind, id, nextTransform, { skipGroundClamp: true });
  };
  const clampLiveGroundTransform = () => {
    const group = ref.current;
    if (!group || !scene.groundEnabled || (kind !== 'character' && kind !== 'prop')) return;
    clampRenderedObjectToGround(group);
  };

  const body = (
    <group
      ref={ref}
      position={[pivotDisplayPosition.x, pivotDisplayPosition.y, pivotDisplayPosition.z]}
      rotation={[rad(displayTransform.rotation.x), rad(displayTransform.rotation.y), rad(displayTransform.rotation.z)]}
      scale={[displayTransform.scale.x || 1, displayTransform.scale.y || 1, displayTransform.scale.z || 1]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown?.();
      }}
    >
      <group position={kind === 'character' ? [-controlPivotOffset.x, -controlPivotOffset.y, -controlPivotOffset.z] : [0, 0, 0]}>
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
        translationSnap={scene.gridSnapEnabled ? GRID_SNAP_STEP : undefined}
        rotationSnap={scene.gridSnapEnabled ? THREE.MathUtils.degToRad(GRID_ROTATION_SNAP_DEG) : undefined}
        scaleSnap={scene.gridSnapEnabled ? GRID_SCALE_SNAP_STEP : undefined}
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
        onObjectChange={clampLiveGroundTransform}
      />
    </>
  );
}

function SelectionRing({ radius = 0.58 }: { radius?: number }) {
  return (
    <group userData={{ ignoreGroundBounds: true }}>
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
  effectivePose,
  effectiveBonePose,
  effectiveFingerPose,
  effectiveToePose,
  showLabel,
  selected,
  onSelect
}: {
  character: CharacterObject;
  effectivePose: StandardHumanRigPose;
  effectiveBonePose?: Scene3DBonePose;
  effectiveFingerPose?: StandardHumanFingerPose;
  effectiveToePose?: StandardHumanToePose;
  showLabel: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const safePose = useMemo(() => clampPose(effectivePose), [effectivePose]);
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
  return <GLBCharacter character={character} effectivePose={displayPose} effectiveBonePose={displayBonePose} effectiveFingerPose={displayFingerPose} effectiveToePose={displayToePose} showLabel={showLabel} selected={selected} onSelect={onSelect} />;
}

function GLBCharacter({
  character,
  effectivePose,
  effectiveBonePose,
  effectiveFingerPose,
  effectiveToePose,
  showLabel,
  selected,
  onSelect
}: {
  character: CharacterObject;
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
    model.updateMatrixWorld(true);
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
    object?.updateMatrixWorld(true);
  }, [object, rig, pose, bonePose, fingerPose, toePose]);
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
    <group userData={{ ignoreGroundBounds: true }}>
      <Html position={[0, y, 0]} center distanceFactor={8} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
        <div className="rounded bg-black/70 px-2 py-0.5 text-[11px] leading-none text-white shadow">{name}</div>
      </Html>
    </group>
  );
}

// SECTION: Editor panels, object tree, and selected-object properties
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
      <ObjectSection title="导入模型" icon={<Maximize2 />}>
        <ModelImportButton label="导入角色" onImport={(file) => onImportCustomModel('character', file)} />
        <ModelImportButton label="导入道具" onImport={(file) => onImportCustomModel('prop', file)} />
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
            onSelect={() => onPatch({
              selectedObjectId: item.id,
              ...(scene.activeViewMode === 'camera' ? { activeCameraId: item.id } : {})
            }, { history: false })}
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
  activeTransition,
  onPatch,
  onUpdateObject,
  onDeleteSelected,
  onSelectTransition,
  onPreviewChange,
  recording,
  onRecordTimeline,
  onError
}: {
  node: CanvasNode;
  scene: Scene3DState;
  currentProjectId?: string | null;
  selectedKind: ObjectKind | null;
  preview: PreviewState;
  activeTransition: PoseTransition | null;
  onPatch: SceneChangeHandler;
  onUpdateObject: ObjectChangeHandler;
  onDeleteSelected: () => void;
  onSelectTransition: (transitionId: string) => void;
  onPreviewChange: React.Dispatch<React.SetStateAction<PreviewState>>;
  recording: boolean;
  onRecordTimeline: () => void;
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
  const [editingTransitionNameId, setEditingTransitionNameId] = useState<string | null>(null);
  const [editingTransitionName, setEditingTransitionName] = useState('');
  const [promptEditorTransitionId, setPromptEditorTransitionId] = useState<string | null>(null);
  const [promptEditorDraft, setPromptEditorDraft] = useState('');
  const [promptSpeechListening, setPromptSpeechListening] = useState(false);
  const [promptSpeechStatus, setPromptSpeechStatus] = useState('');
  const [checkpointPulse, setCheckpointPulse] = useState<Record<string, 'updated'>>({});
  const promptEditorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptSpeechRef = useRef<any>(null);
  const poseEditSnapshotRef = useRef<Scene3DHistorySnapshot | null>(null);
  const poseEditCharacterIdRef = useRef<string | null>(null);
  const poseEditCommitTimerRef = useRef<number | null>(null);
  const objectEditSnapshotRef = useRef<Scene3DHistorySnapshot | null>(null);
  const objectEditKeyRef = useRef<string | null>(null);
  const objectEditCommitTimerRef = useRef<number | null>(null);
  const latestSceneRef = useRef(scene);
  const exitTimelinePreview = () => {
    onPreviewChange((current) => ({ ...current, transitionId: undefined, currentTimeSec: 0, playing: false, enabled: false }));
    onPatch({ activeTransitionId: undefined }, { history: false });
    onError('');
  };
  const selectedId = scene.selectedObjectId;
  const character = scene.objects.characters.find((item) => item.id === selectedId);
  const prop = scene.objects.props.find((item) => item.id === selectedId);
  const camera = scene.objects.cameras.find((item) => item.id === selectedId);
  const light = scene.objects.lights.find((item) => item.id === selectedId);
  const cameraFocusOptions = ['none', ...scene.objects.characters.map((item) => item.id), ...scene.objects.props.map((item) => item.id)];
  const cameraFocusLabels: Record<string, string> = {
    none: '无（手动目标）',
    ...Object.fromEntries(scene.objects.characters.map((item) => [item.id, `角色：${item.name}`])),
    ...Object.fromEntries(scene.objects.props.map((item) => [item.id, `道具：${item.name}`]))
  };
  const characterUniformScale = character
    ? Number(((Math.abs(character.scale.x || 1) + Math.abs(character.scale.y || 1) + Math.abs(character.scale.z || 1)) / 3).toFixed(2))
    : 1;
  const propUniformScale = prop
    ? Number(((Math.abs(prop.scale.x || 1) + Math.abs(prop.scale.y || 1) + Math.abs(prop.scale.z || 1)) / 3).toFixed(2))
    : 1;
  const characterFingerPose = character ? cloneEditableFingerPose(character.fingerPose) : cloneFingerPose();
  const characterToePose = character ? clampToePose(character.toePose) : cloneToePose();
  const characterTransitions = character ? scene.poseTransitions.filter((item) => item.characterId === character.id) : [];
  const currentTransition = character && activeTransition?.characterId === character.id ? activeTransition : characterTransitions[0] || null;
  const promptCameraMotion = currentTransition
    ? cameraMotionFromPrompt(currentTransition.actionPrompt, currentTransition.durationSec, currentTransition.characterId, currentTransition.cameraMotion)
    : null;
  const promptCameraHint = promptCameraMotion?.matched
    ? `已识别：${CAMERA_MOTION_LABELS[promptCameraMotion.motion.type]}${promptCameraMotion.motion.type === 'orbit' ? ` ${Math.round(Math.abs(promptCameraMotion.motion.orbitAngleDeg))}度` : ''}`
    : '未识别运镜，将使用下方运镜类型';
  const currentMotionPipeline = motionPipelineStatus(currentTransition, motionResolving, motionGenerating);

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
      label: options.label || '记录关键帧',
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
      name: `${character.name} 动态 1`,
      characterId: character.id,
      actionPrompt: '',
      actionPlan: { templates: [], notes: [] },
      motionRefineHistory: [],
      regenerateLockScope: 'none',
      constraints: defaultConstraints(),
      durationSec: 1.2,
      curve: 'linear',
      keyframes: [],
      cameraMotion: {
        ...defaultCameraMotion(),
        targetCharacterId: character.id
      },
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    patchScene((current) => normalizeScene({
      ...current,
      poseTransitions: [...current.poseTransitions, created],
      activeTransitionId: created.id
    }), { label: '新建动态片段' });
    onPreviewChange((current) => ({ ...current, transitionId: created.id, currentTimeSec: 0, playing: false, enabled: false }));
    return created;
  };

  const ensureTransition = () => currentTransition || createTransition();

  const pulseCheckpoint = (key: string) => {
    setCheckpointPulse((current) => ({ ...current, [key]: 'updated' }));
    window.setTimeout(() => {
      setCheckpointPulse((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }, 900);
  };

  const beginRenameTransition = (transition: PoseTransition) => {
    setEditingTransitionNameId(transition.id);
    setEditingTransitionName(displayDynamicName(transition.name));
  };

  const commitRenameTransition = () => {
    if (!editingTransitionNameId) return;
    const nextName = editingTransitionName.trim();
    const transition = scene.poseTransitions.find((item) => item.id === editingTransitionNameId);
    setEditingTransitionNameId(null);
    if (!transition || !nextName || nextName === displayDynamicName(transition.name)) return;
    patchTransition(editingTransitionNameId, { name: nextName }, { label: '重命名动态片段' });
  };

  const deleteSelectedTransition = () => {
    if (!character || !currentTransition) return;
    const remaining = characterTransitions.filter((item) => item.id !== currentTransition.id);
    const nextActiveTransition = remaining[0] || null;
    patchScene((current) => normalizeScene({
      ...current,
      poseTransitions: current.poseTransitions.filter((item) => item.id !== currentTransition.id),
      activeTransitionId: nextActiveTransition?.id
    }), { label: '删除动态片段' });
    onPreviewChange((current) => ({
      ...current,
      transitionId: nextActiveTransition?.id,
      currentTimeSec: 0,
      playing: false,
      enabled: false
    }));
    onError('');
  };

  const openPromptEditor = (transition: PoseTransition) => {
    setPromptEditorTransitionId(transition.id);
    setPromptEditorDraft(transition.actionPrompt || '');
    setPromptSpeechStatus('');
  };

  useEffect(() => {
    if (!promptEditorTransitionId) return;
    const textarea = promptEditorTextareaRef.current;
    if (!textarea) return;
    const cursor = textarea.value.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  }, [promptEditorTransitionId]);

  const closePromptEditor = () => {
    if (promptSpeechRef.current) {
      try {
        promptSpeechRef.current.stop();
      } catch {
        // SpeechRecognition stop can throw after the browser has already ended it.
      }
      promptSpeechRef.current = null;
    }
    setPromptSpeechListening(false);
    setPromptEditorTransitionId(null);
    setPromptEditorDraft('');
    setPromptSpeechStatus('');
  };

  const confirmPromptEditor = () => {
    if (!promptEditorTransitionId) return;
    patchTransitionInput(promptEditorTransitionId, { actionPrompt: promptEditorDraft });
    closePromptEditor();
  };

  const insertPromptDraftAtCursor = (text: string) => {
    const input = promptEditorTextareaRef.current;
    const insertion = text.trim();
    if (!insertion) return;
    if (!input) {
      setPromptEditorDraft((current) => `${current}${current ? ' ' : ''}${insertion}`);
      return;
    }
    const start = input.selectionStart ?? promptEditorDraft.length;
    const end = input.selectionEnd ?? start;
    const spacerBefore = start > 0 && !/\s$/.test(promptEditorDraft.slice(0, start)) ? ' ' : '';
    const spacerAfter = end < promptEditorDraft.length && !/^\s/.test(promptEditorDraft.slice(end)) ? ' ' : '';
    const next = `${promptEditorDraft.slice(0, start)}${spacerBefore}${insertion}${spacerAfter}${promptEditorDraft.slice(end)}`;
    const cursor = start + spacerBefore.length + insertion.length + spacerAfter.length;
    setPromptEditorDraft(next);
    window.setTimeout(() => {
      input.focus();
      input.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const startPromptSpeechInput = () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setPromptSpeechStatus('当前浏览器不支持语音输入');
      return;
    }
    if (promptSpeechRef.current) {
      try {
        promptSpeechRef.current.stop();
      } catch {
        // Ignore stop races from browser speech APIs.
      }
      promptSpeechRef.current = null;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => {
      setPromptSpeechListening(true);
      setPromptSpeechStatus('正在聆听...');
    };
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results || [])
        .map((result: any) => result?.[0]?.transcript || '')
        .join('')
        .trim();
      insertPromptDraftAtCursor(transcript);
      setPromptSpeechStatus(transcript ? '已追加语音输入' : '未识别到语音内容');
    };
    recognition.onerror = () => {
      setPromptSpeechStatus('语音输入失败，请重试');
    };
    recognition.onend = () => {
      setPromptSpeechListening(false);
      promptSpeechRef.current = null;
    };
    promptSpeechRef.current = recognition;
    recognition.start();
  };

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
      label: '修改动态片段',
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
    const wasSaved = Boolean(mode === 'start' ? transition.startPose : transition.endPose);
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
    } as Partial<PoseTransition>, { label: mode === 'start' ? '设置起点姿势' : '设置终点姿势' });
    if (wasSaved) pulseCheckpoint(`${transition.id}:${mode}`);
    onError('');
  };

  const clearTransitionPose = (mode: 'start' | 'end') => {
    if (!currentTransition) return;
    patchTransition(currentTransition.id, {
      [`${mode}Pose`]: undefined,
      [`${mode}BonePose`]: undefined,
      [`${mode}FingerPose`]: undefined,
      [`${mode}ToePose`]: undefined,
      [`${mode}PosePresetId`]: undefined,
      [`${mode}LibTvJointAngles`]: undefined,
      [`${mode}Transform`]: undefined,
      aiActionIntent: undefined,
      generatedMotionPrompt: undefined,
      motionIntent: undefined,
      animationClip: undefined,
      error: undefined
    } as Partial<PoseTransition>, { label: mode === 'start' ? '清除起点姿势' : '清除终点姿势' });
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
      onError(mode === 'start' ? '还没有保存起点姿势。' : '还没有保存终点姿势。');
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

  const captureCurrentTransitionKeyframe = (timeSec: number, label: string): TransitionKeyframe | null => {
    if (!character) return null;
    const captured = captureCharacterState(character);
    return {
      id: createId('keyframe'),
      label,
      timeSec,
      transform: captured.transform,
      pose: captured.pose,
      bonePose: captured.bonePose,
      fingerPose: captured.fingerPose,
      toePose: captured.toePose,
      posePresetId: captured.posePresetId,
      libTvJointAngles: captured.libTvJointAngles,
      note: ''
    };
  };

  const addMiddleKeyframe = () => {
    if (!currentTransition || currentTransition.keyframes.length >= MAX_MIDDLE_KEYFRAMES) return;
    const timeSec = clampNumber(preview.currentTimeSec || currentTransition.durationSec / 2, 0.01, Math.max(0.01, currentTransition.durationSec - 0.01));
    const frame = captureCurrentTransitionKeyframe(timeSec, `中间帧 ${currentTransition.keyframes.length + 1}`);
    if (!frame) return;
    patchTransition(currentTransition.id, {
      keyframes: [...currentTransition.keyframes, frame].sort((a, b) => a.timeSec - b.timeSec),
      animationClip: undefined,
      updatedAt: new Date().toISOString()
    }, { label: '添加中间关键帧' });
  };

  const updateMiddleKeyframe = (frameId: string, patch: Partial<TransitionKeyframe>) => {
    if (!currentTransition) return;
    patchTransition(currentTransition.id, {
      keyframes: currentTransition.keyframes.map((item) => item.id === frameId
        ? {
            ...item,
            ...patch,
            timeSec: patch.timeSec !== undefined ? clampNumber(patch.timeSec, 0.01, Math.max(0.01, currentTransition.durationSec - 0.01)) : item.timeSec
          }
        : item).sort((a, b) => a.timeSec - b.timeSec),
      animationClip: undefined,
      updatedAt: new Date().toISOString()
    }, { label: '调整中间关键帧' });
  };

  const overwriteMiddleKeyframe = (frameId: string) => {
    if (!currentTransition) return;
    const existing = currentTransition.keyframes.find((item) => item.id === frameId);
    if (!existing) return;
    const frame = captureCurrentTransitionKeyframe(existing.timeSec, existing.label);
    if (!frame) return;
    updateMiddleKeyframe(frameId, { ...frame, id: frameId, note: existing.note });
    pulseCheckpoint(`${currentTransition.id}:frame:${frameId}`);
  };

  const removeMiddleKeyframe = (frameId: string) => {
    if (!currentTransition) return;
    patchTransition(currentTransition.id, {
      keyframes: currentTransition.keyframes.filter((item) => item.id !== frameId),
      animationClip: undefined,
      updatedAt: new Date().toISOString()
    }, { label: '删除中间关键帧' });
  };

  const jumpToMiddleKeyframe = (frame: TransitionKeyframe) => {
    if (!character || !currentTransition) return;
    onUpdateObject('character', character.id, {
      position: frame.transform.position,
      rotation: frame.transform.rotation,
      scale: frame.transform.scale,
      posePreset: frame.posePresetId || 'custom',
      posePresetId: frame.posePresetId || 'custom',
      libTvJointAngles: cloneLibTvJointAngles(frame.libTvJointAngles),
      bonePose: cloneBonePose(frame.bonePose),
      fingerPose: cloneFingerPose(frame.fingerPose),
      toePose: cloneToePose(frame.toePose),
      rigPose: frame.pose
    });
    onPreviewChange((current) => ({ ...current, transitionId: currentTransition.id, currentTimeSec: frame.timeSec, playing: false, enabled: true }));
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

  const resolveTransitionActionPlan = (transition: PoseTransition) => resolveActionPlan(scene, transition.actionPrompt, {
    durationSec: transition.durationSec,
    curve: transition.curve,
    cameraMotion: transition.cameraMotion
  });

  const stampActionPlanForTransition = (transition: PoseTransition, plan: PoseTransitionActionPlan): PoseTransitionActionPlan => ({
    ...plan,
    semanticPlan: plan.semanticPlan
      ? { ...plan.semanticPlan, promptHash: motionPipelineHash(transition) }
      : undefined
  });

  const localPlanFromIntent = (transition: PoseTransition, intent: MotionIntent | undefined) => {
    const localPlan = stampActionPlanForTransition(transition, resolveTransitionActionPlan(transition));
    if (!intent) return localPlan;
    const constrained = constrainMotionIntentForLocalCompiler(transition, localPlan, intent);
    const safeIntent = constrained.intent;
    const promptCameraMatched = cameraMotionFromPrompt(transition.actionPrompt, transition.durationSec, transition.characterId, transition.cameraMotion).matched;
    const aiStages = aiSemanticStagesForLocalCompiler(transition, localPlan, safeIntent);
    const semanticPlan: MotionSemanticPlan | undefined = localPlan.semanticPlan
      ? {
          ...localPlan.semanticPlan,
          source: 'merged',
          confidence: Math.max(localPlan.semanticPlan.confidence, safeIntent.confidence),
          poseStages: aiStages.length ? mergeSemanticStages(localPlan.semanticPlan.poseStages, aiStages) : localPlan.semanticPlan.poseStages,
          actionSequence: localPlan.semanticPlan.actionSequence,
          actionChains: localPlan.semanticPlan.actionChains,
          contacts: Array.from(new Map([
            ...localPlan.semanticPlan.contacts,
            ...(safeIntent.contactHints || []).map((hint) => ({
              label: hint.note || MOTION_CONTACT_LABELS[hint.contact],
              contact: hint.contact,
              required: true
            }))
          ].map((item) => [item.contact, item])).values()).slice(0, 12),
          targetObjectId: localPlan.semanticPlan.targetObjectId || safeIntent.targetObjectId,
          targetObjectName: localPlan.semanticPlan.targetObjectName,
          cameraIntent: promptCameraMatched && safeIntent.cameraMotionHint?.enabled
            ? { label: CAMERA_MOTION_LABELS[safeIntent.cameraMotionHint.type], type: safeIntent.cameraMotionHint.type, priority: 'prompt', description: 'AI 根据动作提示词补全的运镜。' }
            : localPlan.semanticPlan.cameraIntent,
          explain: [
            ...localPlan.semanticPlan.explain,
            middleKeyframeConstraintNote(transition),
            safeIntent.intent ? `AI理解：${safeIntent.intent}` : '',
            safeIntent.generatedMotionPrompt ? `AI补全动作：${safeIntent.generatedMotionPrompt}` : '',
            ...constrained.notes
          ].filter(Boolean),
          warnings: [...localPlan.semanticPlan.warnings, ...safeIntent.warnings]
        }
      : undefined;
    return {
      mode: 'motion_intent' as const,
      templates: localPlan.templates,
      universal: constrained.universal,
      notes: [
        safeIntent.intent ? `AI 动作意图：${safeIntent.intent}` : '',
        safeIntent.generatedMotionPrompt ? `AI 生成动作提示：${safeIntent.generatedMotionPrompt}` : '',
        ...(safeIntent.keyframeHints || []).map((hint) => `关键帧建议 ${Math.round(hint.timeRatio * 100)}%：${hint.label}`),
        middleKeyframeConstraintNote(transition),
        ...constrained.notes,
        ...safeIntent.warnings,
        ...localPlan.notes
      ].filter(Boolean),
      semanticPlan
    };
  };

  const buildCompiledTransition = (transition: PoseTransition, plan: PoseTransitionActionPlan) => generateTransition(scene, transitionWithPresetReferenceEndpoints({
    ...transition,
    actionPlan: plan,
    cameraMotion: cameraMotionForTransition(transition),
    updatedAt: new Date().toISOString()
  }));

  const resolveTransitionPlanWithAi = async () => {
    const transition = ensureTransition();
    if (!transition) return;
    const localPlan = stampActionPlanForTransition(transition, resolveTransitionActionPlan(transition));
    const locallyResolvedTransition: PoseTransition = {
      ...transition,
      actionPlan: localPlan,
      warnings: localPlan.notes,
      animationClip: undefined,
      error: undefined
    };
    try {
      setMotionResolving(true);
      const intent = await requestMotionIntent(buildMotionRefinePayload({ node, scene, transition: locallyResolvedTransition, character, currentProjectId }));
      const plan = localPlanFromIntent(locallyResolvedTransition, intent);
      patchTransition(transition.id, {
        actionPlan: plan,
        aiActionIntent: intent.intent,
        generatedMotionPrompt: intent.generatedMotionPrompt,
        motionIntent: intent,
        cameraMotion: cameraMotionForAiIntent(transition, intent),
        motionRefineHistory: appendMotionHistory(locallyResolvedTransition, 'resolve', intent),
        warnings: [...intent.warnings, ...plan.notes],
        animationClip: undefined,
        error: undefined
      }, { label: 'AI 解析动作' });
      onError(intent.warnings.join(' '));
    } catch (error: any) {
      const message = error?.message || 'AI 解析失败';
      const plan = localPlan;
      const fallbackNote = `AI 解析失败，已保留本地模板解析：${message}`;
      patchTransition(transition.id, {
        actionPlan: plan,
        motionRefineHistory: appendMotionHistory(locallyResolvedTransition, 'resolve', undefined, message),
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
      const merged = buildCompiledTransition({
        ...transition,
        aiActionIntent: intent.intent,
        generatedMotionPrompt: intent.generatedMotionPrompt,
        motionIntent: intent,
        cameraMotion: cameraMotionForAiIntent(transition, intent),
        motionRefineHistory: appendMotionHistory(transition, 'generate', intent),
        warnings: [...intent.warnings, ...plan.notes]
      }, plan);
      patchTransition(transition.id, merged, { label: 'AI 生成动态' });
      onSelectTransition(transition.id);
      onPreviewChange((current) => ({ ...current, transitionId: transition.id, currentTimeSec: 0, playing: false, enabled: false }));
      onError(merged.error || merged.warnings.join(' '));
    } catch (error: any) {
      const message = error?.message || 'AI 生成失败';
      const fallbackNote = `AI 生成失败，已使用本地动作模板生成：${message}`;
      const fallbackTransition = {
        ...transition,
        actionPlan: stampActionPlanForTransition(transition, resolveTransitionActionPlan(transition)),
        motionRefineHistory: appendMotionHistory(transition, 'generate', undefined, message),
        updatedAt: new Date().toISOString()
      };
      const merged = buildCompiledTransition(fallbackTransition, stampActionPlanForTransition(transition, resolveTransitionActionPlan(transition)));
      patchTransition(transition.id, {
        ...merged,
        warnings: [fallbackNote, ...merged.warnings],
        error: message
      }, { label: 'AI 生成失败' });
      onSelectTransition(transition.id);
      onPreviewChange((current) => ({ ...current, transitionId: transition.id, currentTimeSec: 0, playing: false, enabled: false }));
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
    <>
    <div className="min-h-0 overflow-y-auto p-3 text-xs">
      {!selectedKind && (
        <Panel title="场景属性" icon={<Settings2 />}>
          <ColorField label="背景颜色" value={scene.background.color} onChange={(color) => onPatch({ background: { type: 'color', color } }, { label: '调整背景颜色', mergeKey: 'scene:background.color' })} />
          <SelectField label="画幅比例" value={scene.aspectRatio} options={SCENE_ASPECT_RATIOS} onChange={(aspectRatio) => onPatch({ aspectRatio }, { label: '调整画幅' })} />
          <NumberField label="场景缩放" value={scene.sceneZoomPercent} min={50} max={500} step={1} sliderStep={1} suffix="%" onChange={(sceneZoomPercent) => onPatch({ sceneZoomPercent }, { label: '调整场景缩放', mergeKey: 'scene:zoom' })} />
          <ToggleRow label="地面碰撞" description={SCENE_TOGGLE_DESCRIPTIONS.groundCollision} checked={scene.groundEnabled} onChange={(groundEnabled) => onPatch((current) => {
            const nextScene = normalizeScene({ ...current, groundEnabled });
            return groundEnabled ? applyGroundCollision(nextScene) : nextScene;
          }, { label: groundEnabled ? '开启地面碰撞' : '关闭地面碰撞' })} />
          <ToggleRow label="地面网格线" description={SCENE_TOGGLE_DESCRIPTIONS.groundGrid} checked={scene.groundGridEnabled} onChange={(groundGridEnabled) => onPatch({ groundGridEnabled }, { label: groundGridEnabled ? '显示地面网格线' : '隐藏地面网格线' })} />
          <ToggleRow label="运动轨迹线" description={SCENE_TOGGLE_DESCRIPTIONS.motionPath} checked={scene.motionPathEnabled} onChange={(motionPathEnabled) => onPatch({ motionPathEnabled }, { label: motionPathEnabled ? '显示运动轨迹线' : '隐藏运动轨迹线' })} />
          <ToggleRow label="角色标签" description={SCENE_TOGGLE_DESCRIPTIONS.characterLabels} checked={scene.characterLabelsEnabled} onChange={(characterLabelsEnabled) => onPatch({ characterLabelsEnabled }, { label: characterLabelsEnabled ? '显示角色标签' : '隐藏角色标签' })} />
          <ToggleRow label="网格吸附" description={SCENE_TOGGLE_DESCRIPTIONS.gridSnap} checked={scene.gridSnapEnabled} onChange={(gridSnapEnabled) => onPatch({ gridSnapEnabled }, { label: gridSnapEnabled ? '开启网格吸附' : '关闭网格吸附' })} />
        </Panel>
      )}
      {character && (
        <Panel title="角色属性" icon={<UserRound />}>
          <Segmented value={characterTab} options={[{ value: 'property', label: '属性' }, { value: 'pose', label: '姿势' }, { value: 'transition', label: '动态' }]} onChange={(value) => setCharacterTab(value as PoseTab)} />
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
                <div className="text-[10px] text-zinc-400">当前角色动态片段</div>
                <div className="space-y-1">
                  {characterTransitions.map((transition) => (
                    <div key={transition.id} className={activeTransition?.id === transition.id ? 'flex w-full items-center justify-between gap-2 rounded-md border border-violet-400/40 bg-violet-400/15 px-2 py-1.5 text-left text-violet-100' : 'flex w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-left text-zinc-200'}>
                      {editingTransitionNameId === transition.id ? (
                        <input
                          value={editingTransitionName}
                          autoFocus
                          onChange={(event) => setEditingTransitionName(event.target.value)}
                          onBlur={commitRenameTransition}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
                            if (event.key === 'Escape') setEditingTransitionNameId(null);
                          }}
                          className="h-6 min-w-0 flex-1 rounded border border-violet-400/30 bg-black/40 px-1.5 text-[11px] text-zinc-100 outline-none"
                        />
                      ) : (
                        <button type="button" onClick={() => onSelectTransition(transition.id)} onDoubleClick={() => beginRenameTransition(transition)} className="min-w-0 flex-1 truncate text-left">
                          {displayDynamicName(transition.name)}
                        </button>
                      )}
                      <span className="shrink-0 text-[10px] text-zinc-400">{transition.durationSec.toFixed(1)}s</span>
                    </div>
                  ))}
                  {!characterTransitions.length && <div className="rounded-md border border-dashed border-white/10 bg-black/20 px-2 py-2 text-[11px] text-zinc-500">还没有动态片段</div>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={createTransition} className="h-8 rounded-md border border-white/10 bg-white/5 text-zinc-200">新建动态</button>
                <button type="button" disabled={!currentTransition} onClick={deleteSelectedTransition} className="h-8 rounded-md border border-red-400/25 bg-red-500/10 text-red-100 disabled:opacity-45">删除片段</button>
              </div>
              {currentTransition && (
                <>
                  <NumberField label="动态时长" value={currentTransition.durationSec} min={0.2} max={60} step={0.1} sliderMin={0.2} sliderMax={60} sliderStep={0.1} onChange={(durationSec) => patchTransitionInput(currentTransition.id, { durationSec })} />
                  <DynamicKeyframeTimeline
                    transition={currentTransition}
                    checkpointPulse={checkpointPulse}
                    onSaveEndpoint={saveCurrentPoseToTransition}
                    onJumpEndpoint={jumpToTransitionPose}
                    onClearEndpoint={clearTransitionPose}
                    onAdd={addMiddleKeyframe}
                    onJump={jumpToMiddleKeyframe}
                    onOverwrite={overwriteMiddleKeyframe}
                    onRemove={removeMiddleKeyframe}
                    onUpdate={updateMiddleKeyframe}
                  />
                  <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
                    <div className="flex items-end gap-2">
                      <label className="min-w-0 flex-1 space-y-1">
                        <span className="text-[10px] text-zinc-400">动作提示词</span>
                        <input value={currentTransition.actionPrompt} onChange={(event) => patchTransitionInput(currentTransition.id, { actionPrompt: event.target.value })} className="h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-[11px] text-white outline-none" />
                      </label>
                      <button type="button" onClick={() => openPromptEditor(currentTransition)} className="h-8 shrink-0 rounded-md border border-white/10 bg-white/5 px-2 text-[10px] text-zinc-200 hover:bg-white/10">扩大</button>
                    </div>
                    <div className={promptCameraMotion?.matched ? 'rounded border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-[10px] text-sky-100' : 'rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-zinc-500'}>
                      {promptCameraHint}
                    </div>
                  </div>
                  <SelectField label="播放变化曲线" value={currentTransition.curve} options={CURVE_OPTIONS} labels={CURVE_LABELS} descriptions={CURVE_DESCRIPTIONS} onChange={(curve) => patchTransitionInput(currentTransition.id, { curve: curve as CurveType })} />
                  <CameraMotionPanel value={currentTransition.cameraMotion} durationSec={currentTransition.durationSec} characterId={currentTransition.characterId} onChange={(cameraMotion) => patchTransitionInput(currentTransition.id, { cameraMotion })} />
                  <MotionPipelinePanel
                    transition={currentTransition}
                    status={currentMotionPipeline}
                    motionResolving={motionResolving}
                    motionGenerating={motionGenerating}
                    onResolveAi={resolveTransitionPlanWithAi}
                    onGenerate={regenerateTransitionWithAi}
                  />

                  <TimelinePreview
                    transition={currentTransition}
                    preview={preview}
                    onPreviewChange={onPreviewChange}
                    recording={recording}
                    onRecordTimeline={onRecordTimeline}
                    onExitPreview={exitTimelinePreview}
                  />
                  {currentTransition.error && <div className="rounded-md border border-red-400/25 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">{currentTransition.error}</div>}
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
          <NumberField label="统一缩放" value={propUniformScale} min={0.05} max={8} step={0.01} sliderMin={0.05} sliderMax={8} sliderStep={0.01} disabled={prop.locked} onChange={(uniformScale) => updateObjectLive('prop', prop.id, { scale: vec(uniformScale, uniformScale, uniformScale) })} onCommitStart={() => beginObjectEdit('prop', prop.id)} onCommitEnd={() => commitObjectEdit('prop', prop.id)} />
          <VectorField label="缩放" value={prop.scale} min={0.05} max={8} step={0.01} sliderMin={0.05} sliderMax={8} sliderStep={0.01} disabled={prop.locked} onChange={(scale) => updateObjectLive('prop', prop.id, { scale })} onCommitStart={() => beginObjectEdit('prop', prop.id)} onCommitEnd={() => commitObjectEdit('prop', prop.id)} />
          <DeleteButton disabled={prop.locked} onClick={onDeleteSelected} />
        </Panel>
      )}
      {camera && (
        <Panel title="机位属性" icon={<Camera />}>
          <TextField label="名称" value={camera.name} disabled={camera.locked} onChange={(name) => onUpdateObject('camera', camera.id, { name })} />
          <SelectField
            label="聚焦对象"
            value={camera.focusObjectId || 'none'}
            options={cameraFocusOptions}
            labels={cameraFocusLabels}
            disabled={camera.locked}
            onChange={(focusObjectId) => {
              const nextFocusObjectId = focusObjectId === 'none' ? undefined : focusObjectId;
              onUpdateObject('camera', camera.id, cameraFocusPatchForObject(scene, camera, nextFocusObjectId));
            }}
          />
          <VectorField label="位置" value={camera.position} sliderMin={-10} sliderMax={10} sliderStep={0.01} disabled={camera.locked} onChange={(position) => updateObjectLive('camera', camera.id, { position })} onCommitStart={() => beginObjectEdit('camera', camera.id)} onCommitEnd={() => commitObjectEdit('camera', camera.id)} />
          <VectorField label="镜头转向" value={camera.targetPosition} sliderMin={-10} sliderMax={10} sliderStep={0.01} disabled={camera.locked} onChange={(targetPosition) => updateObjectLive('camera', camera.id, { targetPosition })} onCommitStart={() => beginObjectEdit('camera', camera.id)} onCommitEnd={() => commitObjectEdit('camera', camera.id)} />
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
    {promptEditorTransitionId && createPortal(
      <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/55 px-6 py-8 text-white">
        <div className="flex h-[min(620px,82vh)] w-[min(860px,86vw)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#090b12] shadow-2xl">
          <div className="flex h-11 items-center justify-between border-b border-white/10 px-3">
            <div>
              <div className="text-sm font-semibold text-zinc-100">动作提示词</div>
              <div className="text-[10px] text-zinc-500">确认保存，关闭则放弃本次输入</div>
            </div>
            <button type="button" onClick={closePromptEditor} className="rounded-md border border-white/10 bg-white/5 p-1 text-zinc-300 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
          <textarea
            ref={promptEditorTextareaRef}
            value={promptEditorDraft}
            autoFocus
            onChange={(event) => setPromptEditorDraft(event.target.value)}
            className="min-h-0 flex-1 resize-none border-0 bg-black/20 p-4 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600"
            placeholder="描述角色动作、力度、方向、接触点和运镜，例如：角色双手推箱子，身体前压，镜头环绕360度"
          />
          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-3 py-2">
            <div className="min-w-0 text-[11px] text-zinc-500">{promptSpeechStatus || '语音输入会追加到当前光标位置'}</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={startPromptSpeechInput} className={promptSpeechListening ? 'h-8 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 text-[11px] text-emerald-100' : 'h-8 rounded-md border border-white/10 bg-white/5 px-3 text-[11px] text-zinc-200 hover:bg-white/10'}>
                {promptSpeechListening ? '识别中...' : '语音输入'}
              </button>
              <button type="button" onClick={confirmPromptEditor} className="h-8 rounded-md border border-violet-400/40 bg-violet-400/15 px-4 text-[11px] font-medium text-violet-100 hover:bg-violet-400/20">确认</button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}
function MiniTimeline({ transition, preview, onPreviewChange, recording, onRecordTimeline, onExitPreview }: { transition: PoseTransition | null; preview: PreviewState; onPreviewChange: React.Dispatch<React.SetStateAction<PreviewState>>; recording: boolean; onRecordTimeline: () => void; onExitPreview?: () => void }) {
  const duration = Math.max(0.1, transition?.animationClip?.durationSec || transition?.durationSec || 1.2);
  const current = Math.min(duration, Math.max(0, preview.currentTimeSec || 0));
  const canPreview = Boolean(transition?.animationClip);
  const isPlaying = Boolean(preview.playing && preview.transitionId === transition?.id);
  const buttonClass = "h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-zinc-200 disabled:opacity-45 hover:bg-white/10";
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
      <input
        type="range"
        min={0}
        max={duration}
        step={0.01}
        value={current}
        disabled={!transition}
        onChange={(event) => onPreviewChange((state) => ({ ...state, transitionId: transition?.id, currentTimeSec: Number(event.target.value), playing: false, enabled: true }))}
        className="w-full accent-violet-400 disabled:opacity-40"
      />
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
        <span>{current.toFixed(2)}s / {duration.toFixed(2)}s</span>
        <button
          type="button"
          disabled={!transition}
          onClick={() => onPreviewChange((state) => ({ ...state, transitionId: transition?.id, loop: !state.loop }))}
          className={`h-6 rounded border px-2 text-[10px] ${preview.loop ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'} disabled:opacity-45`}
        >
          循环
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <button
          type="button"
          disabled={!canPreview}
          onClick={() => onPreviewChange((state) => ({
            ...state,
            transitionId: transition?.id,
            currentTimeSec: state.currentTimeSec >= duration ? 0 : state.currentTimeSec,
            playing: !isPlaying,
            enabled: true
          }))}
          className={buttonClass}
        >
          {isPlaying ? '暂停' : '播放'}
        </button>
        <button
          type="button"
          disabled={!transition}
          onClick={() => onPreviewChange((state) => ({
            ...state,
            transitionId: transition?.id,
            currentTimeSec: 0,
            playing: false,
            enabled: true
          }))}
          className={buttonClass}
        >
          起点
        </button>
        {onExitPreview && <button type="button" onClick={onExitPreview} className={buttonClass}>退出预览</button>}
      </div>
      <button
        type="button"
        disabled={recording || !canPreview}
        onClick={onRecordTimeline}
        className="mt-2 h-8 w-full rounded-md border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-zinc-200 disabled:opacity-45 hover:bg-white/10"
      >
        {recording ? '录制中...' : '录制时间轴'}
      </button>
    </div>
  );
}
function TimelinePreview({
  transition,
  preview,
  onPreviewChange,
  recording,
  onRecordTimeline,
  onExitPreview
}: {
  transition: PoseTransition | null;
  preview: PreviewState;
  onPreviewChange: React.Dispatch<React.SetStateAction<PreviewState>>;
  recording: boolean;
  onRecordTimeline: () => void;
  onExitPreview?: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      <MiniTimeline
        transition={transition}
        preview={preview}
        onPreviewChange={onPreviewChange}
        recording={recording}
        onRecordTimeline={onRecordTimeline}
        onExitPreview={onExitPreview}
      />
    </div>
  );
}

function MotionPipelinePanel({
  transition,
  status,
  motionResolving,
  motionGenerating,
  onResolveAi,
  onGenerate
}: {
  transition?: PoseTransition | null;
  status: ReturnType<typeof motionPipelineStatus>;
  motionResolving: boolean;
  motionGenerating: boolean;
  onResolveAi: () => void;
  onGenerate: () => void;
}) {
  const actionSkill = transition?.actionPlan.semanticPlan?.actionSkill;
  const qualityReport = transition?.qualityReport;
  const visibleQualityIssues = qualityReport?.issues.filter((issue) => issue.severity !== 'info').slice(0, 3) || [];
  const expectationCount = qualityReport?.metrics.motionExpectationCount || 0;
  const expectationFailedCount = qualityReport?.metrics.motionExpectationFailedCount || 0;
  const expectationPassCount = Math.max(0, expectationCount - expectationFailedCount);
  const expectationPassRatio = qualityReport?.metrics.motionExpectationPassRatio;
  const expectationClass = expectationPassRatio === undefined
    ? 'text-zinc-400'
    : expectationPassRatio >= 0.8
      ? 'text-emerald-100'
      : expectationPassRatio >= 0.6
        ? 'text-amber-100'
        : 'text-red-100';
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium text-zinc-100">{"动态生成流程"}</div>
          <div className="text-[10px] text-zinc-500">{"先理解动作，再生成可播放动态"}</div>
        </div>
        <span className={status.isGenerated && !status.isStale ? 'rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100' : status.isStale ? 'rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-100' : 'rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-400'}>
          {status.isGenerated && !status.isStale ? '已生成' : status.isStale ? '已过期' : '未生成'}
        </span>
      </div>
      <MotionPipelineStep
        index={1}
        title={"解析动态"}
        state={status.parse}
        disabled={!status.canResolve}
        loading={motionResolving}
        onClick={onResolveAi}
      />
      <MotionPipelineStep
        index={2}
        title={"生成动态"}
        state={status.generate}
        disabled={!status.canGenerate}
        loading={motionGenerating}
        onClick={onGenerate}
        primary
      />
      {(actionSkill || qualityReport) && (
        <div className="space-y-1 rounded border border-white/10 bg-black/25 px-2 py-1.5">
          {actionSkill && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-medium text-zinc-300">本地动作技能：{actionSkill.label}</div>
              <div className="text-[10px] leading-relaxed text-zinc-500">{actionSkill.constraints.join(' / ')}</div>
            </div>
          )}
          {qualityReport && (
            <div className="space-y-0.5">
              <div className={qualityReport.score >= 80 ? 'text-[10px] font-medium text-emerald-100' : qualityReport.score >= 60 ? 'text-[10px] font-medium text-amber-100' : 'text-[10px] font-medium text-red-100'}>
                动作质量评分：{Math.round(qualityReport.score)}/100
              </div>
              {expectationCount > 0 && (
                <div className={'text-[10px] font-medium ' + expectationClass}>
                  动作期望通过率：{Math.round((expectationPassRatio ?? 0) * 100)}%（{expectationPassCount}/{expectationCount}）
                </div>
              )}
              {qualityReport.metrics.motionSampleRate !== undefined && (
                <div className="text-[10px] text-zinc-500">
                  动态采样率：{qualityReport.metrics.motionSampleRate} fps
                </div>
              )}
              {visibleQualityIssues.length > 0 && (
                <div className="space-y-0.5">
                  {visibleQualityIssues.map((issue) => (
                    <div key={issue.id} className="truncate text-[10px] text-zinc-500">{issue.message}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MotionPipelineStep({
  index,
  title,
  description,
  state,
  disabled,
  loading,
  primary,
  onClick
}: {
  index: number;
  title: string;
  description?: string;
  state: MotionPipelineStepState;
  disabled?: boolean;
  loading?: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  const stateLabel: Record<MotionPipelineStepState, string> = {
    blocked: '未就绪',
    ready: '可执行',
    running: '处理中',
    done: '已完成',
    failed: '失败',
    stale: '已过期'
  };
  const badgeClass = state === 'done'
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
    : state === 'ready'
      ? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
      : state === 'stale'
        ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
        : state === 'failed'
          ? 'border-red-400/30 bg-red-400/10 text-red-100'
          : 'border-white/10 bg-white/5 text-zinc-500';
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)_70px] items-center gap-2 rounded border border-white/10 bg-white/[0.03] p-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/30 text-[10px] text-zinc-300">{index}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[11px] font-medium text-zinc-100">{title}</span>
          <span className={'rounded border px-1.5 py-0.5 text-[10px] ' + badgeClass}>{loading ? '处理中' : stateLabel[state]}</span>
        </div>
        {description && <div className="truncate text-[10px] text-zinc-500">{description}</div>}
      </div>
      <button type="button" disabled={disabled || loading} onClick={onClick} className={primary ? 'h-7 rounded border border-violet-400/40 bg-violet-400/15 px-2 text-[10px] text-violet-100 disabled:opacity-45' : 'h-7 rounded border border-white/10 bg-white/5 px-2 text-[10px] text-zinc-200 disabled:opacity-45'}>
        {state === 'done' || state === 'stale' ? '重新执行' : '执行'}
      </button>
    </div>
  );
}
function DynamicKeyframeTimeline({
  transition,
  checkpointPulse,
  onSaveEndpoint,
  onJumpEndpoint,
  onClearEndpoint,
  onAdd,
  onJump,
  onOverwrite,
  onRemove,
  onUpdate
}: {
  transition: PoseTransition;
  checkpointPulse: Record<string, 'updated'>;
  onSaveEndpoint: (mode: 'start' | 'end') => void;
  onJumpEndpoint: (mode: 'start' | 'end') => void;
  onClearEndpoint: (mode: 'start' | 'end') => void;
  onAdd: () => void;
  onJump: (frame: TransitionKeyframe) => void;
  onOverwrite: (frameId: string) => void;
  onRemove: (frameId: string) => void;
  onUpdate: (frameId: string, patch: Partial<TransitionKeyframe>) => void;
}) {
  const canAdd = transition.keyframes.length < MAX_MIDDLE_KEYFRAMES;
  const endpointRows = [
    {
      key: 'start' as const,
      title: '起点',
      timeLabel: '0.00s',
      saved: Boolean(transition.startPose),
      updated: checkpointPulse[transition.id + ':start'] === 'updated'
    },
    {
      key: 'end' as const,
      title: '终点',
      timeLabel: transition.durationSec.toFixed(2) + 's',
      saved: Boolean(transition.endPose),
      updated: checkpointPulse[transition.id + ':end'] === 'updated'
    }
  ];
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium text-zinc-100">{'关键姿势时间线'}</div>
          <div className="text-[10px] text-zinc-500">{'起点 / 中间帧'} {transition.keyframes.length}/{MAX_MIDDLE_KEYFRAMES} {'/ 终点'}</div>
        </div>
        <button type="button" disabled={!canAdd} onClick={onAdd} className="h-7 rounded-md border border-white/10 bg-white/5 px-2 text-[10px] text-zinc-200 disabled:opacity-45">{'添加中间帧'}</button>
      </div>
      <div className="relative space-y-1.5 pl-3 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-white/10">
        <TimelineEndpointRow
          title={endpointRows[0].title}
          timeLabel={endpointRows[0].timeLabel}
          saved={endpointRows[0].saved}
          updated={endpointRows[0].updated}
          onSave={() => onSaveEndpoint('start')}
          onJump={() => onJumpEndpoint('start')}
          onClear={() => onClearEndpoint('start')}
        />
        {transition.keyframes.map((frame) => {
          const updated = checkpointPulse[transition.id + ':frame:' + frame.id] === 'updated';
          return (
            <div key={frame.id} className="relative space-y-1.5 overflow-hidden rounded border border-white/10 bg-white/[0.03] p-1.5 before:absolute before:-left-[10px] before:top-3 before:h-2 before:w-2 before:rounded-full before:border before:border-violet-300/50 before:bg-violet-400/40">
              <div className="grid grid-cols-[minmax(48px,1fr)_34px_40px_32px_32px_26px] items-center gap-0.5">
                <input value={frame.label} onChange={(event) => onUpdate(frame.id, { label: event.target.value })} className="h-6 min-w-0 rounded border border-white/10 bg-black/30 px-1.5 text-[10px] font-medium text-zinc-100 outline-none" />
                <span className="text-right text-[10px] text-zinc-500">{frame.timeSec.toFixed(2)}s</span>
                <span className={updated ? 'inline-flex h-6 items-center justify-center rounded border border-emerald-400/30 bg-emerald-400/10 px-1 text-[10px] text-emerald-100' : 'inline-flex h-6 items-center justify-center rounded border border-emerald-400/20 bg-emerald-400/5 px-1 text-[10px] text-emerald-200'}>{updated ? '已更新' : '已保存'}</span>
                <button type="button" onClick={() => onOverwrite(frame.id)} className="h-6 rounded border border-white/10 bg-white/5 px-1 text-[10px] text-zinc-300">{'更新'}</button>
                <button type="button" onClick={() => onJump(frame)} className="h-6 rounded border border-white/10 bg-white/5 px-1 text-[10px] text-zinc-300">{'跳到'}</button>
                <button type="button" onClick={() => onRemove(frame.id)} className="h-6 rounded border border-red-400/20 bg-red-400/10 px-1 text-[10px] text-red-100">{'删'}</button>
              </div>
              <div className="grid grid-cols-[34px_minmax(0,1fr)_48px] items-center gap-2 pl-1">
                <span className="text-[10px] text-zinc-500">{'时间'}</span>
                <input type="range" min={0.01} max={Math.max(0.01, transition.durationSec - 0.01)} step={0.01} value={frame.timeSec} onChange={(event) => onUpdate(frame.id, { timeSec: Number(event.target.value) })} className="w-full accent-violet-400" />
                <input type="number" min={0.01} max={Math.max(0.01, transition.durationSec - 0.01)} step={0.01} value={frame.timeSec} onChange={(event) => onUpdate(frame.id, { timeSec: Number(event.target.value) })} className="h-6 min-w-0 rounded border border-white/10 bg-black/30 px-1 text-right text-[10px] text-zinc-100 outline-none" />
              </div>
            </div>
          );
        })}
        {!transition.keyframes.length && <div className="rounded border border-dashed border-white/10 bg-black/20 px-2 py-2 text-[10px] text-zinc-500">{'还没有中间帧，可添加后写入当前姿势'}</div>}
        <TimelineEndpointRow
          title={endpointRows[1].title}
          timeLabel={endpointRows[1].timeLabel}
          saved={endpointRows[1].saved}
          updated={endpointRows[1].updated}
          onSave={() => onSaveEndpoint('end')}
          onJump={() => onJumpEndpoint('end')}
          onClear={() => onClearEndpoint('end')}
        />
      </div>
    </div>
  );
}

function TimelineEndpointRow({ title, timeLabel, saved, updated, onSave, onJump, onClear }: {
  title: string;
  timeLabel: string;
  saved: boolean;
  updated: boolean;
  onSave: () => void;
  onJump: () => void;
  onClear: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded border border-white/10 bg-white/[0.03] p-1.5">
      <div className="grid grid-cols-[12px_minmax(48px,1fr)_34px_40px_32px_32px_26px] items-center gap-0.5">
        <span className={saved ? 'h-2.5 w-2.5 rounded-full border border-emerald-300/60 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]' : 'h-2.5 w-2.5 rounded-full border border-red-300/60 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'} title={saved ? '已保存' : '未保存'} />
        <span className="min-w-0 truncate text-[11px] font-medium text-zinc-100">{title}</span>
        <span className="text-right text-[10px] text-zinc-500">{timeLabel}</span>
        <span className={updated ? 'inline-flex h-6 items-center justify-center rounded border border-emerald-400/30 bg-emerald-400/10 px-1 text-[10px] text-emerald-100' : saved ? 'inline-flex h-6 items-center justify-center rounded border border-emerald-400/20 bg-emerald-400/5 px-1 text-[10px] text-emerald-200' : 'inline-flex h-6 items-center justify-center rounded border border-white/10 bg-black/20 px-1 text-[10px] text-zinc-500'}>{updated ? '已更新' : saved ? '已保存' : '未保存'}</span>
        <button type="button" onClick={onSave} className="h-6 rounded border border-white/10 bg-white/5 px-1 text-[10px] text-zinc-200">{saved ? '更新' : '保存'}</button>
        <button type="button" disabled={!saved} onClick={onJump} className="h-6 rounded border border-white/10 bg-white/5 px-1 text-[10px] text-zinc-300 disabled:opacity-45">{'跳到'}</button>
        <button type="button" disabled={!saved} onClick={onClear} className="h-6 rounded border border-red-400/20 bg-red-400/10 px-1 text-[10px] text-red-100 disabled:opacity-45">{'删'}</button>
      </div>
    </div>
  );
}

function CameraMotionPanel({ value, durationSec, characterId, onChange }: { value: CameraMotionConfig; durationSec: number; characterId?: string; onChange: (value: CameraMotionConfig) => void }) {
  const [expanded, setExpanded] = useState(false);
  const patch = (next: Partial<CameraMotionConfig>) => onChange(normalizeCameraMotion({ ...value, ...next }, durationSec, characterId));
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-white/5"
        >
          <span className={expanded ? 'rotate-90 shrink-0 text-[10px] text-zinc-500 transition-transform' : 'shrink-0 text-[10px] text-zinc-500 transition-transform'}>{'>'}</span>
          <span className="min-w-0">
            <span className="block text-[10px] font-medium text-zinc-200">{'镜头运动'}</span>
            <span className="block truncate text-[10px] text-zinc-500">{value.enabled && value.type !== 'none' ? CAMERA_MOTION_LABELS[value.type] : '默认关闭，和动态时间轴同步'}</span>
          </span>
        </button>
        <button type="button" onClick={() => patch({ enabled: !value.enabled, type: !value.enabled && value.type === 'none' ? 'dolly_in' : value.type })} className={value.enabled ? 'h-6 rounded border border-emerald-400/30 bg-emerald-400/10 px-2 text-[10px] text-emerald-100' : 'h-6 rounded border border-white/10 bg-white/5 px-2 text-[10px] text-zinc-300'}>{value.enabled ? '开启' : '关闭'}</button>
      </div>
      {expanded && (
        <div className="space-y-2">
          <SelectField label={'运镜类型'} value={value.type} options={CAMERA_MOTION_OPTIONS.map((item) => item.id)} labels={CAMERA_MOTION_LABELS} onChange={(type) => patch({ type: type as CameraMotionType, enabled: type !== 'none' })} />
          <NumberField label={'强度'} value={value.intensity} min={0} max={1} step={0.01} sliderMin={0} sliderMax={1} sliderStep={0.01} onChange={(intensity) => patch({ intensity })} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={'开始'} value={value.startTimeSec} min={0} max={durationSec} step={0.01} sliderMin={0} sliderMax={durationSec} sliderStep={0.01} onChange={(startTimeSec) => patch({ startTimeSec })} />
            <NumberField label={'结束'} value={value.endTimeSec} min={0} max={durationSec} step={0.01} sliderMin={0} sliderMax={durationSec} sliderStep={0.01} onChange={(endTimeSec) => patch({ endTimeSec })} />
          </div>
          <NumberField label={'距离'} value={value.distance} min={0} max={8} step={0.05} sliderMin={0} sliderMax={8} sliderStep={0.05} onChange={(distance) => patch({ distance })} />
          <NumberField label={'高度偏移'} value={value.heightOffset} min={-4} max={4} step={0.05} sliderMin={-4} sliderMax={4} sliderStep={0.05} onChange={(heightOffset) => patch({ heightOffset })} />
          <NumberField label={'环绕角度'} value={value.orbitAngleDeg} min={-360} max={360} step={1} sliderMin={-360} sliderMax={360} sliderStep={1} onChange={(orbitAngleDeg) => patch({ orbitAngleDeg })} />
          <ToggleRow label={'保持入画'} checked={value.keepCharacterInFrame} onChange={(keepCharacterInFrame) => patch({ keepCharacterInFrame })} />
        </div>
      )}
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

// SECTION: Pose reference upload, overlay, and solve-result UI
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
            <div className="min-w-0 text-[10px] text-zinc-500">{result ? '已解析姿势参考图' : '上传参考图后解析角色姿势'}</div>
            <button type="button" disabled={disabled || solving || uploadedCount < 1} onClick={onSolve} className="h-7 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 text-[10px] font-medium text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-45">{solving ? '解析中...' : '解析姿势'}</button>
          </div>
          {error && <div className="rounded border border-red-400/20 bg-red-400/10 px-2 py-1 text-[10px] leading-4 text-red-100">{error}</div>}
          {result && (
            <div className="space-y-1 rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-1.5 text-[10px] text-emerald-50">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">解析结果</span><span className="text-emerald-100/80">置信度 {Math.round(result.confidence * 100)}%</span></div>
              <div className="line-clamp-2 text-emerald-100/80">{result.summary}</div>
              {result.warnings.length > 0 && <div className="text-amber-100">{result.warnings.slice(0, 2).join(' / ')}</div>}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-emerald-100/70">视图 {result.appliedViews.length ? result.appliedViews.join(' / ') : '无'}</span>
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
        <div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-[11px] font-medium text-zinc-200">{label}</div><div className="truncate text-[10px] text-zinc-500">{image?.fileName || hint}</div></div>{image && <button type="button" disabled={disabled} onClick={() => onRemove(view)} className="rounded border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 text-[10px] text-red-100 disabled:opacity-45">{'移除'}</button>}</div>
        <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="h-7 w-full rounded-md border border-white/10 bg-white/[0.04] text-[10px] text-zinc-300 hover:bg-white/10 disabled:opacity-45">{image ? '更换图片' : '上传图片'}</button>
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
        <span onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); }} className="min-w-0 flex-1 truncate" title="双击重命名">
          {name}
        </span>
      )}
      <button type="button" onClick={(event) => { event.stopPropagation(); onToggleVisible(); }} className="text-zinc-500">{visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onToggleLocked(); }} className="text-zinc-500">{locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button>
    </div>
  );
}

// SECTION: Shared form primitives used by the Scene3D node UI
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
  descriptions,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const activeDescription = descriptions?.[value];
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-zinc-400">{label}</span>
      <select value={value} disabled={disabled} title={activeDescription} onChange={(event) => onChange(event.target.value)} className="h-7 w-full rounded-md border border-white/10 bg-black/30 px-2 text-[11px] text-white disabled:opacity-45">
        {options.map((option) => <option key={option} value={option} title={descriptions?.[option]} className="bg-zinc-950">{labels?.[option] || option}</option>)}
      </select>
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label title={description} className="flex h-8 items-center justify-between rounded-md border border-white/10 bg-black/20 px-2 text-[11px] text-zinc-300">
      <span>{label}</span>
      <input type="checkbox" title={description} checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-3.5 w-3.5 accent-violet-400" />
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
        <span className="text-zinc-500">{'XYZ 旋转'}</span>
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
          <div className="text-[10px] font-medium text-zinc-200">{'手指控制'}</div>
          <div className="text-[10px] text-zinc-500">{'调节当前角色每根手指的弯曲和张开。'}</div>
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
          label={'左手弯曲'}
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
          label={'右手弯曲'}
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
          label={'左手张开'}
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
          label={'右手张开'}
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

function ToePoseField({
  value,
  selectedToe,
  disabled,
  onSelectToe,
  onChange,
  onCommitStart,
  onCommitEnd
}: {
  value: StandardHumanToePose;
  selectedToe: ToeKey;
  disabled?: boolean;
  onSelectToe: (toe: ToeKey) => void;
  onChange: (toe: ToeKey, value: RigRotation) => void;
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
}) {
  const activeToe = TOE_OPTIONS.includes(selectedToe) ? selectedToe : 'leftBase';
  const toeValue = toeRotationToControlSpace(activeToe, value[activeToe] || TOE_POSE_NEUTRAL[activeToe]);
  const limits = TOE_LIMITS[activeToe];
  const updateAxis = (axis: keyof RigRotation, raw: number) => {
    const [min, max] = limits[axis];
    const next = Number.isFinite(raw) ? clampNumber(raw, min, max) : 0;
    onChange(activeToe, toeRotationFromControlSpace(activeToe, { ...toeValue, [axis]: next }));
  };

  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium text-zinc-200">{'脚趾控制'}</div>
          <div className="text-[10px] text-zinc-500">{'调节脚趾弯曲与展开'}</div>
        </div>
        <select
          value={activeToe}
          disabled={disabled}
          onChange={(event) => onSelectToe(event.target.value as ToeKey)}
          className="h-7 rounded-md border border-white/10 bg-black/30 px-2 text-[11px] text-white disabled:opacity-45"
        >
          {TOE_OPTIONS.map((toe) => (
            <option key={toe} value={toe} className="bg-zinc-950">
              {TOE_LABELS[toe]}
            </option>
          ))}
        </select>
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
              value={Number.isFinite(toeValue[axis]) ? toeValue[axis] : 0}
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
              value={Number.isFinite(toeValue[axis]) ? toeValue[axis] : 0}
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
      <Trash2 className="mr-1 inline h-3.5 w-3.5" />{'删除'}</button>
  );
}

useGLTF.preload(MODEL_URL);
