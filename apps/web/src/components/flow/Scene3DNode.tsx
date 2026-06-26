import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas as ThreeCanvas, ThreeEvent, useThree } from '@react-three/fiber';
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  OrbitControls,
  TransformControls,
  useGLTF
} from '@react-three/drei';
import * as THREE from 'three';
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
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
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
};
type SceneChangeHandler = (updater: SceneChangeUpdater, options?: SceneChangeOptions) => void;
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
};

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
  fingerPose?: StandardHumanFingerPose;
  libTvJointAngles?: LibTvJointAngles;
  model: {
    type: 'glb' | 'proxy';
    url?: string;
    sourceName?: string;
    normalizedHeight?: number;
  };
};

type PropObject = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  shape: 'box' | 'sphere' | 'cylinder';
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
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
  captures: Capture[];
};

type LightObject = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  lightType: 'ambient' | 'directional' | 'point';
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  intensity: number;
};

type PoseTransitionTemplate = {
  id: ActionTemplateId;
  label: string;
  hand?: 'left' | 'right';
  targetObjectId?: string | null;
  strength: number;
};

type PoseTransitionActionPlan = {
  templates: PoseTransitionTemplate[];
  notes: string[];
};

type PoseTransitionConstraints = {
  headLookAt: {
    enabled: boolean;
    targetMode: 'camera' | 'object' | 'point';
    targetObjectId?: string;
    targetPosition?: Vec3;
  };
  handTarget: {
    enabled: boolean;
    hand: 'left' | 'right';
    targetMode: 'object' | 'point';
    targetObjectId?: string;
    targetPosition?: Vec3;
  };
  footLock: {
    enabled: boolean;
    left: boolean;
    right: boolean;
  };
  jointLimitsEnabled: boolean;
};

type AnimationClipSample = {
  timeSec: number;
  transform: PoseTransform;
  pose: StandardHumanRigPose;
  fingerPose?: StandardHumanFingerPose;
  libTvJointAngles?: LibTvJointAngles;
};

type PreviewState = {
  transitionId?: string;
  currentTimeSec: number;
  playing: boolean;
  loop: boolean;
  enabled: boolean;
};

type AnimationContactFrame = {
  timeSec: number;
  kind: 'reach' | 'grasp' | 'release' | 'foot_lock';
  targetObjectId?: string;
  limb: 'head' | 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
  position: Vec3;
  note: string;
};

type SerializedAnimationTrack = {
  name: string;
  kind: 'quaternion' | 'vector';
  times: number[];
  values: number[];
};

type SerializedAnimationClip = {
  name: string;
  durationSec: number;
  sampleRate: number;
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
  constraints: PoseTransitionConstraints;
  durationSec: number;
  curve: CurveType;
  startPose?: StandardHumanRigPose;
  endPose?: StandardHumanRigPose;
  startFingerPose?: StandardHumanFingerPose;
  endFingerPose?: StandardHumanFingerPose;
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

type Scene3DHistorySnapshot = {
  version: number;
  background: {
    type: 'color';
    color: string;
  };
  objects: {
    characters: CharacterObject[];
    props: PropObject[];
    cameras: CameraObject[];
    lights: LightObject[];
  };
  activeCameraId?: string;
  aspectRatio: string;
  gridSnapEnabled: boolean;
  groundGridEnabled: boolean;
  groundEnabled: boolean;
  characterLabelsEnabled: boolean;
  compositionGuideEnabled: boolean;
  captures: Capture[];
  poseTransitions: PoseTransition[];
};

type Scene3DHistoryEntry = {
  id: string;
  label: string;
  before: Scene3DHistorySnapshot;
  after: Scene3DHistorySnapshot;
  mergeKey?: string;
  createdAt: string;
};

type Scene3DState = {
  version: number;
  background: {
    type: 'color';
    color: string;
  };
  objects: {
    characters: CharacterObject[];
    props: PropObject[];
    cameras: CameraObject[];
    lights: LightObject[];
  };
  selectedObjectId?: string;
  activeViewMode: 'director' | 'camera';
  activeCameraId?: string;
  transformMode: TransformMode;
  aspectRatio: string;
  gridSnapEnabled: boolean;
  groundGridEnabled: boolean;
  groundEnabled: boolean;
  characterLabelsEnabled: boolean;
  compositionGuideEnabled: boolean;
  captures: Capture[];
  poseTransitions: PoseTransition[];
  activeTransitionId?: string;
  undoStack: Scene3DHistoryEntry[];
  redoStack: Scene3DHistoryEntry[];
};

type Scene3DCaptureResult = {
  capture: Capture;
  scene: Scene3DState;
};

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
const SCENE_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
  '2.35:1',
  '1.85:1',
  '1.91:1'
];
const POSE_KEYS: PoseJointKey[] = [
  'pelvis',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'rightUpperArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'rightUpperLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot'
];

function handFingerPose(curl = 12, spread = 0): HandFingerPose {
  return { thumb: curl, index: curl, middle: curl, ring: curl, pinky: curl, spread };
}

function fingerPose(left: HandFingerPose = handFingerPose(), right: HandFingerPose = handFingerPose()): StandardHumanFingerPose {
  return {
    left: { ...left },
    right: { ...right }
  };
}

const FINGER_POSE_RELAXED = fingerPose(handFingerPose(12, 4), handFingerPose(12, 4));
const FINGER_POSE_OPEN = fingerPose(handFingerPose(2, 10), handFingerPose(2, 10));
const FINGER_POSE_FISTS = fingerPose(handFingerPose(78, 0), handFingerPose(78, 0));
const FINGER_POSE_HALF_CLOSED = fingerPose(handFingerPose(42, 2), handFingerPose(42, 2));
const FINGER_POSE_PHONE = fingerPose(
  { thumb: 34, index: 18, middle: 26, ring: 38, pinky: 42, spread: 3 },
  { thumb: 34, index: 18, middle: 26, ring: 38, pinky: 42, spread: 3 }
);

function cloneFingerPose(value?: StandardHumanFingerPose | null): StandardHumanFingerPose {
  const source = value || FINGER_POSE_RELAXED;
  return fingerPose(source.left, source.right);
}

function normalizeHandFingerPose(value: any, fallback: HandFingerPose): HandFingerPose {
  const numberOrFallback = (key: keyof HandFingerPose) => {
    const next = Number(value?.[key]);
    return Number.isFinite(next) ? Math.min(95, Math.max(0, next)) : fallback[key];
  };
  return {
    thumb: numberOrFallback('thumb'),
    index: numberOrFallback('index'),
    middle: numberOrFallback('middle'),
    ring: numberOrFallback('ring'),
    pinky: numberOrFallback('pinky'),
    spread: Math.min(20, Math.max(-20, Number.isFinite(Number(value?.spread)) ? Number(value.spread) : fallback.spread))
  };
}

function normalizeFingerPose(value: any, fallback: StandardHumanFingerPose = FINGER_POSE_RELAXED): StandardHumanFingerPose {
  return {
    left: normalizeHandFingerPose(value?.left, fallback.left),
    right: normalizeHandFingerPose(value?.right, fallback.right)
  };
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

function lerpFingerPose(a: StandardHumanFingerPose, b: StandardHumanFingerPose, t: number): StandardHumanFingerPose {
  return {
    left: lerpHandFingerPose(a.left, b.left, t),
    right: lerpHandFingerPose(a.right, b.right, t)
  };
}

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
  fingerPose?: StandardHumanFingerPose;
};

function presetRigPose(patch: Partial<Record<PoseJointKey, Partial<RigRotation>>> = {}) {
  return patchPose(zeroPose(), patch);
}

const LIBTV_POSE_PRESETS: LibTvPosePreset[] = [
  // Mixamo/x-bot rig axis guide: upper-arm x=90 lowers the T-pose arm; arm z swings forward/back with mirrored signs.
  { id: 'stand', label: '站立', jointAngles: { body: { bend: 0, turn: 0, tilt: 0 }, torso: { bend: 0, turn: 0, tilt: 0 }, head: { nod: -2, turn: 0, tilt: 0 }, l_arm: { raise: 0, straddle: 0, turn: 0 }, r_arm: { raise: 0, straddle: 0, turn: 0 }, l_elbow: { bend: 6 }, r_elbow: { bend: 6 }, l_leg: { raise: 0, straddle: 0, turn: 0 }, r_leg: { raise: 0, straddle: 0, turn: 0 }, l_knee: { bend: 0 }, r_knee: { bend: 0 } }, rigPose: presetRigPose({ chest: { x: 1 }, head: { x: -2 }, leftUpperArm: { x: 92, y: 0, z: -5 }, rightUpperArm: { x: 92, y: 0, z: 5 }, leftLowerArm: { x: 6 }, rightLowerArm: { x: 6 }, leftHand: { x: -3 }, rightHand: { x: -3 } }) },
  { id: 'tpose', label: 'T型', jointAngles: { body: { bend: 0, turn: 0, tilt: 0 }, torso: { bend: 0, turn: 0, tilt: 0 }, head: { nod: 0, turn: 0, tilt: 0 }, l_arm: { raise: 16, straddle: 60, turn: 40 }, r_arm: { raise: 22, straddle: 54, turn: 41 }, l_elbow: { bend: 0 }, r_elbow: { bend: 0 }, l_leg: { raise: 0, straddle: 0, turn: 0 }, r_leg: { raise: 0, straddle: 0, turn: 0 }, l_knee: { bend: 0 }, r_knee: { bend: 0 } }, rigPose: presetRigPose() , fingerPose: FINGER_POSE_OPEN },
  { id: 'walk', label: '行走', jointAngles: { body: { bend: 0, turn: 0, tilt: 0 }, torso: { bend: 3, turn: 4, tilt: 0 }, head: { nod: -3, turn: 0, tilt: 0 }, l_arm: { raise: 18, straddle: 8, turn: 0 }, r_arm: { raise: -18, straddle: 8, turn: 0 }, l_elbow: { bend: 18 }, r_elbow: { bend: 18 }, l_leg: { raise: -16, straddle: 0, turn: 0 }, r_leg: { raise: 24, straddle: 0, turn: 0 }, l_knee: { bend: 6 }, r_knee: { bend: 28 } }, rigPose: presetRigPose({ pelvis: { y: 3 }, chest: { x: 2, y: -3 }, head: { x: -2 }, leftUpperArm: { x: 88, y: 0, z: 18 }, leftLowerArm: { x: 18 }, rightUpperArm: { x: 88, y: 0, z: 18 }, rightLowerArm: { x: 18 }, leftUpperLeg: { x: -16 }, leftLowerLeg: { x: 6 }, rightUpperLeg: { x: 24 }, rightLowerLeg: { x: 28 }, leftFoot: { x: 5 }, rightFoot: { x: -8 } }) },
  { id: 'run', label: '跑步', jointAngles: { body: { bend: 8, turn: 0, tilt: 0 }, torso: { bend: 10, turn: 4, tilt: 0 }, head: { nod: -6, turn: 0, tilt: 0 }, l_arm: { raise: 30, straddle: 12, turn: 0 }, r_arm: { raise: -30, straddle: 12, turn: 0 }, l_elbow: { bend: 88 }, r_elbow: { bend: 88 }, l_leg: { raise: -34, straddle: 0, turn: 0 }, r_leg: { raise: 48, straddle: 0, turn: 0 }, l_knee: { bend: 68 }, r_knee: { bend: 34 } }, rigPose: presetRigPose({ pelvis: { x: 5, y: 4 }, chest: { x: 12, y: -4 }, head: { x: -6 }, leftUpperArm: { x: 72, y: 0, z: 34 }, leftLowerArm: { x: 88 }, leftHand: { x: -8 }, rightUpperArm: { x: 104, y: 0, z: 32 }, rightLowerArm: { x: 88 }, rightHand: { x: -8 }, leftUpperLeg: { x: -34 }, leftLowerLeg: { x: 68 }, rightUpperLeg: { x: 48 }, rightLowerLeg: { x: 34 }, leftFoot: { x: 18 }, rightFoot: { x: -12 } }) },
  { id: 'sit', label: '坐姿', rootOffset: vec(0, -0.46, 0), jointAngles: { body: { bend: 0, turn: 0, tilt: 0 }, torso: { bend: 6, turn: 0, tilt: 0 }, head: { nod: -4, turn: 0, tilt: 0 }, l_arm: { raise: 0, straddle: 8, turn: 6 }, r_arm: { raise: 0, straddle: 8, turn: 6 }, l_elbow: { bend: 45 }, r_elbow: { bend: 45 }, l_leg: { raise: 82, straddle: 4, turn: 0 }, r_leg: { raise: 82, straddle: 4, turn: 0 }, l_knee: { bend: 88 }, r_knee: { bend: 88 } }, rigPose: presetRigPose({ pelvis: { x: 2 }, chest: { x: 6 }, head: { x: -4 }, leftUpperArm: { x: 78, z: -10 }, rightUpperArm: { x: 78, z: 10 }, leftLowerArm: { x: 45 }, rightLowerArm: { x: 45 }, leftHand: { x: -8 }, rightHand: { x: -8 }, leftUpperLeg: { x: 82, z: -4 }, rightUpperLeg: { x: 82, z: 4 }, leftLowerLeg: { x: 88 }, rightLowerLeg: { x: 88 }, leftFoot: { x: -10 }, rightFoot: { x: -10 } }) },
  { id: 'crouch', label: '蹲下', rootOffset: vec(0, -0.5, 0), jointAngles: { body: { bend: 2, turn: 0, tilt: 0 }, torso: { bend: 22, turn: 0, tilt: 0 }, head: { nod: -8, turn: 0, tilt: 0 }, l_arm: { raise: 10, straddle: 6, turn: 0 }, r_arm: { raise: 10, straddle: 6, turn: 0 }, l_elbow: { bend: 62 }, r_elbow: { bend: 62 }, l_leg: { raise: 70, straddle: 10, turn: 0 }, r_leg: { raise: 70, straddle: 10, turn: 0 }, l_knee: { bend: 115 }, r_knee: { bend: 115 } }, rigPose: presetRigPose({ pelvis: { x: 6 }, chest: { x: 22 }, head: { x: -8 }, leftUpperArm: { x: 78, z: -12 }, rightUpperArm: { x: 78, z: 12 }, leftLowerArm: { x: 62 }, rightLowerArm: { x: 62 }, leftUpperLeg: { x: 70, z: -10 }, rightUpperLeg: { x: 70, z: 10 }, leftLowerLeg: { x: 115 }, rightLowerLeg: { x: 115 }, leftFoot: { x: -18 }, rightFoot: { x: -18 } }) },
  { id: 'hands_hips', label: '叉腰', jointAngles: { body: { bend: 0, turn: 0, tilt: 0 }, torso: { bend: 0, turn: 0, tilt: 0 }, head: { nod: -4, turn: 0, tilt: 0 }, l_arm: { raise: 15, straddle: 28, turn: -8 }, r_arm: { raise: 15, straddle: 28, turn: 8 }, l_elbow: { bend: 112 }, r_elbow: { bend: 112 }, l_leg: { raise: 0, straddle: 6, turn: 0 }, r_leg: { raise: 0, straddle: 6, turn: 0 }, l_knee: { bend: 0 }, r_knee: { bend: 0 } }, rigPose: presetRigPose({ chest: { x: -1 }, head: { x: -4 }, leftUpperArm: { x: 78, y: -18, z: -32 }, rightUpperArm: { x: 78, y: 18, z: 32 }, leftLowerArm: { x: 112, y: 4 }, rightLowerArm: { x: 112, y: -4 }, leftHand: { x: -12, y: -10, z: 24 }, rightHand: { x: -12, y: 10, z: -24 }, leftUpperLeg: { z: -4 }, rightUpperLeg: { z: 4 } }) , fingerPose: FINGER_POSE_HALF_CLOSED },
  { id: 'bow', label: '鞠躬', jointAngles: { body: { bend: 0, turn: 0, tilt: 0 }, torso: { bend: 36, turn: 0, tilt: 0 }, head: { nod: 10, turn: 0, tilt: 0 }, l_arm: { raise: 0, straddle: 0, turn: 0 }, r_arm: { raise: 0, straddle: 0, turn: 0 }, l_elbow: { bend: 6 }, r_elbow: { bend: 6 }, l_leg: { raise: 0, straddle: 0, turn: 0 }, r_leg: { raise: 0, straddle: 0, turn: 0 }, l_knee: { bend: 0 }, r_knee: { bend: 0 } }, rigPose: presetRigPose({ pelvis: { x: 5 }, chest: { x: 36 }, neck: { x: 6 }, head: { x: 10 }, leftUpperArm: { x: 92, z: -4 }, rightUpperArm: { x: 92, z: 4 }, leftLowerArm: { x: 6 }, rightLowerArm: { x: 6 }, leftHand: { x: -3 }, rightHand: { x: -3 } }) },
  { id: 'fight', label: '格斗', jointAngles: { body: { bend: 6, turn: 10, tilt: 0 }, torso: { bend: 8, turn: 10, tilt: 0 }, head: { nod: -6, turn: -6, tilt: 0 }, l_arm: { raise: 36, straddle: 18, turn: 0 }, r_arm: { raise: 36, straddle: 18, turn: 0 }, l_elbow: { bend: 112 }, r_elbow: { bend: 112 }, l_leg: { raise: 12, straddle: 14, turn: 8 }, r_leg: { raise: -8, straddle: 14, turn: -8 }, l_knee: { bend: 24 }, r_knee: { bend: 32 } }, rigPose: presetRigPose({ pelvis: { x: 4, y: 12 }, chest: { x: 8, y: -10 }, head: { x: -6, y: -8 }, leftUpperArm: { x: 54, y: -12, z: 42 }, leftLowerArm: { x: 112 }, leftHand: { x: -8, z: -10 }, rightUpperArm: { x: 54, y: 12, z: -42 }, rightLowerArm: { x: 112 }, rightHand: { x: -8, z: 10 }, leftUpperLeg: { x: 12, z: -14 }, leftLowerLeg: { x: 24 }, rightUpperLeg: { x: -8, z: 14 }, rightLowerLeg: { x: 32 } }) , fingerPose: FINGER_POSE_FISTS },
  { id: 'wave', label: '招手', jointAngles: { body: { bend: 0, turn: 0, tilt: 0 }, torso: { bend: 2, turn: -6, tilt: 0 }, head: { nod: -4, turn: 8, tilt: 3 }, l_arm: { raise: 0, straddle: 0, turn: 0 }, r_arm: { raise: 88, straddle: -10, turn: 80 }, l_elbow: { bend: 8 }, r_elbow: { bend: 70 }, l_leg: { raise: 0, straddle: 0, turn: 0 }, r_leg: { raise: 0, straddle: 0, turn: 0 }, l_knee: { bend: 0 }, r_knee: { bend: 0 } }, rigPose: presetRigPose({ chest: { y: -6 }, head: { x: -4, y: 8, z: 3 }, leftUpperArm: { x: 92, z: -5 }, leftLowerArm: { x: 8 }, rightUpperArm: { x: -82, y: 8, z: -14 }, rightLowerArm: { x: 70 }, rightHand: { x: -8, y: -16, z: -18 } }) , fingerPose: FINGER_POSE_OPEN },
  { id: 'arms_crossed', label: '抱臂', jointAngles: { body: { bend: 0, turn: 0, tilt: 0 }, torso: { bend: 0, turn: 2, tilt: 0 }, head: { nod: -6, turn: 0, tilt: 0 }, l_arm: { raise: 25, straddle: 18, turn: 24 }, r_arm: { raise: 25, straddle: 18, turn: -24 }, l_elbow: { bend: 118 }, r_elbow: { bend: 118 }, l_leg: { raise: 0, straddle: 5, turn: 0 }, r_leg: { raise: 0, straddle: 5, turn: 0 }, l_knee: { bend: 0 }, r_knee: { bend: 0 } }, rigPose: presetRigPose({ chest: { x: -1 }, head: { x: -6 }, leftUpperArm: { x: 58, y: 26, z: 38 }, leftLowerArm: { x: 118, y: 6 }, leftHand: { x: -10, y: 16, z: 22 }, rightUpperArm: { x: 58, y: -26, z: -38 }, rightLowerArm: { x: 118, y: -6 }, rightHand: { x: -10, y: -16, z: -22 }, leftUpperLeg: { z: -4 }, rightUpperLeg: { z: 4 } }) , fingerPose: FINGER_POSE_HALF_CLOSED },
  { id: 'phone', label: '看手机', jointAngles: { body: { bend: 0, turn: 0, tilt: 0 }, torso: { bend: 5, turn: 0, tilt: 0 }, head: { nod: 17, turn: 0, tilt: 0 }, l_arm: { raise: 52, straddle: -10, turn: -4 }, r_arm: { raise: 52, straddle: -10, turn: -13 }, l_elbow: { bend: 90 }, r_elbow: { bend: 90 }, l_leg: { raise: 0, straddle: 5, turn: 0 }, r_leg: { raise: 0, straddle: 5, turn: 0 }, l_knee: { bend: 0 }, r_knee: { bend: 0 } }, rigPose: presetRigPose({ chest: { x: 5 }, head: { x: 17 }, leftUpperArm: { x: 56, y: -8, z: 30 }, leftLowerArm: { x: 92 }, leftHand: { x: -12, y: 8 }, rightUpperArm: { x: 56, y: 8, z: -30 }, rightLowerArm: { x: 92 }, rightHand: { x: -12, y: -8 }, leftUpperLeg: { z: -3 }, rightUpperLeg: { z: 3 } }) , fingerPose: FINGER_POSE_PHONE }
];
const POSE_PRESET_ALIASES: Record<string, string> = {
  standing: 'stand',
  t_pose: 'tpose',
  wave_ready: 'wave',
  akimbo: 'hands_hips',
  fight_guard: 'fight',
  victory: 'wave',
  kneel: 'crouch',
  one_knee: 'crouch',
  double_kneel: 'crouch',
  two_knees: 'crouch',
  combat_ready: 'fight',
  push_pull: 'fight',
  reach_hand: 'wave',
  phone_look: 'phone',
  cross_arms: 'arms_crossed',
  lean: 'stand',
  think: 'phone',
  kick: 'fight',
  throw: 'fight',
  push: 'fight',
  stretch: 'wave'
};

function normalizePosePresetId(presetId: string | undefined) {
  const id = presetId || 'stand';
  if (id === 'custom') return 'custom';
  const aliased = POSE_PRESET_ALIASES[id] || id;
  return LIBTV_POSE_PRESETS.some((item) => item.id === aliased) ? aliased : 'stand';
}

function cloneLibTvJointAngles(value?: LibTvJointAngles | null): LibTvJointAngles | undefined {
  if (!value) return undefined;
  return {
    body: { ...value.body },
    torso: { ...value.torso },
    head: { ...value.head },
    l_arm: { ...value.l_arm },
    r_arm: { ...value.r_arm },
    l_elbow: { ...value.l_elbow },
    r_elbow: { ...value.r_elbow },
    l_leg: { ...value.l_leg },
    r_leg: { ...value.r_leg },
    l_knee: { ...value.l_knee },
    r_knee: { ...value.r_knee }
  };
}

function libTvPresetForId(presetId?: string) {
  const normalized = normalizePosePresetId(presetId);
  if (normalized === 'custom') return undefined;
  return LIBTV_POSE_PRESETS.find((item) => item.id === normalized);
}

function libTvJointAnglesForPresetId(presetId?: string) {
  return cloneLibTvJointAngles(libTvPresetForId(presetId)?.jointAngles);
}

function normalizeAngleGroup<T extends Record<string, number>>(value: any, fallback: T): T {
  const next = { ...fallback };
  for (const key of Object.keys(fallback) as Array<keyof T>) {
    const numberValue = Number(value?.[key]);
    next[key] = (Number.isFinite(numberValue) ? numberValue : fallback[key]) as T[keyof T];
  }
  return next;
}

function normalizeLibTvJointAngles(value: any, fallback?: LibTvJointAngles): LibTvJointAngles | undefined {
  if (!value && !fallback) return undefined;
  const base = fallback || LIBTV_POSE_PRESETS[0].jointAngles;
  return {
    body: normalizeAngleGroup(value?.body, base.body),
    torso: normalizeAngleGroup(value?.torso, base.torso),
    head: normalizeAngleGroup(value?.head, base.head),
    l_arm: normalizeAngleGroup(value?.l_arm, base.l_arm),
    r_arm: normalizeAngleGroup(value?.r_arm, base.r_arm),
    l_elbow: normalizeAngleGroup(value?.l_elbow, base.l_elbow),
    r_elbow: normalizeAngleGroup(value?.r_elbow, base.r_elbow),
    l_leg: normalizeAngleGroup(value?.l_leg, base.l_leg),
    r_leg: normalizeAngleGroup(value?.r_leg, base.r_leg),
    l_knee: normalizeAngleGroup(value?.l_knee, base.l_knee),
    r_knee: normalizeAngleGroup(value?.r_knee, base.r_knee)
  };
}

function lerpAngleGroup<T extends Record<string, number>>(a: T, b: T, t: number): T {
  const next = { ...a };
  for (const key of Object.keys(a) as Array<keyof T>) {
    next[key] = Number(lerp(a[key], b[key], t).toFixed(4)) as T[keyof T];
  }
  return next;
}

function interpolateLibTvJointAngles(a: LibTvJointAngles, b: LibTvJointAngles, t: number): LibTvJointAngles {
  return {
    body: lerpAngleGroup(a.body, b.body, t),
    torso: lerpAngleGroup(a.torso, b.torso, t),
    head: lerpAngleGroup(a.head, b.head, t),
    l_arm: lerpAngleGroup(a.l_arm, b.l_arm, t),
    r_arm: lerpAngleGroup(a.r_arm, b.r_arm, t),
    l_elbow: lerpAngleGroup(a.l_elbow, b.l_elbow, t),
    r_elbow: lerpAngleGroup(a.r_elbow, b.r_elbow, t),
    l_leg: lerpAngleGroup(a.l_leg, b.l_leg, t),
    r_leg: lerpAngleGroup(a.r_leg, b.r_leg, t),
    l_knee: lerpAngleGroup(a.l_knee, b.l_knee, t),
    r_knee: lerpAngleGroup(a.r_knee, b.r_knee, t)
  };
}

function libTvArmToRig(arm: LibTvJointAngles['l_arm'], side: 'left' | 'right') {
  const sideSign = side === 'left' ? -1 : 1;
  const highArmBoost = Math.max(Math.abs(arm.turn) - 45, 0) * 0.75;
  return rot(
    84 - arm.raise * 1.25 - highArmBoost,
    sideSign * arm.straddle,
    sideSign * arm.turn * 0.35
  );
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
    leftUpperArm: libTvArmToRig(jointAngles.l_arm, 'left'),
    leftLowerArm: { x: jointAngles.l_elbow.bend },
    leftHand: { x: -jointAngles.l_elbow.bend * 0.08, y: jointAngles.l_arm.turn * 0.08, z: jointAngles.l_arm.straddle * 0.2 },
    rightUpperArm: libTvArmToRig(jointAngles.r_arm, 'right'),
    rightLowerArm: { x: jointAngles.r_elbow.bend },
    rightHand: { x: -jointAngles.r_elbow.bend * 0.08, y: -jointAngles.r_arm.turn * 0.08, z: -jointAngles.r_arm.straddle * 0.2 },
    leftUpperLeg: libTvLegToRig(jointAngles.l_leg, 'left'),
    leftLowerLeg: { x: jointAngles.l_knee.bend },
    rightUpperLeg: libTvLegToRig(jointAngles.r_leg, 'right'),
    rightLowerLeg: { x: jointAngles.r_knee.bend },
    leftFoot: { x: -jointAngles.l_knee.bend * 0.08, z: jointAngles.l_leg.straddle * 0.15 },
    rightFoot: { x: -jointAngles.r_knee.bend * 0.08, z: -jointAngles.r_leg.straddle * 0.15 }
  });
}

const POSE_PRESETS: Array<{ id: string; label: string; pose: StandardHumanRigPose; fingerPose: StandardHumanFingerPose; rootOffset?: Vec3 }> = LIBTV_POSE_PRESETS.map((preset) => ({
  id: preset.id,
  label: preset.label,
  pose: preset.rigPose ? clonePose(preset.rigPose) : libTvPoseToRigPose(preset.jointAngles, preset.id),
  fingerPose: cloneFingerPose(preset.fingerPose),
  rootOffset: preset.rootOffset
}));
const TEMPLATE_LABELS: Record<ActionTemplateId, string> = {
  look_at: '看向目标',
  turn_to: '转向目标',
  raise_hand: '抬手',
  wave: '挥手',
  point_at: '指向目标',
  step_forward: '向前迈步',
  step_back: '向后退步',
  sit_down: '坐下',
  stand_up: '站起',
  pick_up: '拿起',
  put_down: '放下'
};

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

const JOINT_LIMITS: Record<PoseJointKey, { x: [number, number]; y: [number, number]; z: [number, number] }> = {
  pelvis: { x: [-35, 35], y: [-55, 55], z: [-30, 30] },
  chest: { x: [-40, 40], y: [-55, 55], z: [-35, 35] },
  neck: { x: [-35, 35], y: [-70, 70], z: [-30, 30] },
  head: { x: [-40, 40], y: [-80, 80], z: [-45, 45] },
  leftUpperArm: { x: [-155, 95], y: [-95, 95], z: [-140, 110] },
  leftLowerArm: { x: [-5, 145], y: [-15, 15], z: [-15, 15] },
  rightUpperArm: { x: [-155, 95], y: [-95, 95], z: [-140, 110] },
  rightLowerArm: { x: [-5, 145], y: [-15, 15], z: [-15, 15] },
  leftHand: { x: [-45, 45], y: [-35, 35], z: [-55, 55] },
  rightHand: { x: [-45, 45], y: [-35, 35], z: [-55, 55] },
  leftUpperLeg: { x: [-110, 80], y: [-40, 40], z: [-55, 55] },
  leftLowerLeg: { x: [0, 155], y: [-8, 8], z: [-8, 8] },
  rightUpperLeg: { x: [-110, 80], y: [-40, 40], z: [-55, 55] },
  rightLowerLeg: { x: [0, 155], y: [-8, 8], z: [-8, 8] },
  leftFoot: { x: [-45, 45], y: [-20, 20], z: [-18, 18] },
  rightFoot: { x: [-45, 45], y: [-20, 20], z: [-18, 18] }
};

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



function naturalStandingPose() {
  const standPreset = LIBTV_POSE_PRESETS.find((item) => item.id === 'stand');
  return standPreset?.rigPose ? clonePose(standPreset.rigPose) : zeroPose();
}

function isRestTPose(pose: StandardHumanRigPose) {
  return POSE_KEYS.every((key) => (
    Math.abs(pose[key].x) < 0.001 &&
    Math.abs(pose[key].y) < 0.001 &&
    Math.abs(pose[key].z) < 0.001
  ));
}

function hasLegacyBentStandingPose(pose: StandardHumanRigPose) {
  const legKeys: PoseJointKey[] = ['leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
  const torsoKeys: PoseJointKey[] = ['pelvis', 'chest'];
  return (
    legKeys.some((key) => Math.abs(pose[key].x) > 18 || Math.abs(pose[key].z) > 18) ||
    torsoKeys.some((key) => Math.abs(pose[key].x) > 20 || Math.abs(pose[key].z) > 20)
  );
}

function hasUnsafeStandingArmPose(pose: StandardHumanRigPose) {
  return (
    pose.leftUpperArm.x < 45 ||
    pose.rightUpperArm.x < 45 ||
    Math.abs(pose.leftUpperArm.z) > 55 ||
    Math.abs(pose.rightUpperArm.z) > 55 ||
    Math.abs(pose.leftUpperArm.y) > 60 ||
    Math.abs(pose.rightUpperArm.y) > 60
  );
}

function normalizeCharacterRigPose(model: any, presetId: string, pose: StandardHumanRigPose) {
  const normalizedPresetId = normalizePosePresetId(presetId);
  const preset = POSE_PRESETS.find((item) => item.id === normalizedPresetId);
  if (isBuiltInCharacterModel(model) && preset) {
    return clonePose(preset.pose);
  }
  if (isBuiltInCharacterModel(model) && normalizedPresetId === 'stand' && (hasLegacyBentStandingPose(pose) || hasUnsafeStandingArmPose(pose))) {
    return naturalStandingPose();
  }
  if (isBuiltInCharacterModel(model) && normalizedPresetId === 'stand' && isRestTPose(pose)) {
    return naturalStandingPose();
  }
  return pose;
}

function normalizeCharacterRootOffset(model: any, presetId: string, value: any) {
  const preset = POSE_PRESETS.find((item) => item.id === normalizePosePresetId(presetId));
  if (isBuiltInCharacterModel(model) && preset) {
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
  const clampScale = (scale: number) => Math.min(Math.max(scale, 0.05), 8);
  return {
    x: clampScale(next.x),
    y: clampScale(next.y),
    z: clampScale(next.z)
  };
}

function normalizeCharacterModel(gender: CharacterGender, model: any): CharacterObject['model'] {
  if (model?.type === 'glb' && typeof model.url === 'string' && model.url !== MODEL_URL) {
    return {
      type: 'glb',
      url: model.url,
      sourceName: typeof model.sourceName === 'string' ? model.sourceName : '自定义角色模型',
      normalizedHeight: normalizeCharacterModelHeight(gender, model)
    };
  }
  return {
    type: 'glb',
    url: MODEL_URL,
    sourceName: 'x-bot.glb',
    normalizedHeight: genderHeight(gender)
  };
}

function characterPivotLocalY(character: CharacterObject) {
  const modelHeight = Number(character.model.normalizedHeight);
  const height = Number.isFinite(modelHeight) ? modelHeight : genderHeight(character.gender);
  return Math.max(0.48, Math.min(0.78, height * 0.5));
}

function defaultCharacter(gender: CharacterGender, index: number): CharacterObject {
  return {
    id: createId('char'),
    name: `${gender === 'female' ? '女性角色' : '男性角色'} ${index}`,
    gender,
    visible: true,
    locked: false,
    position: vec(index % 2 === 0 ? 0.8 : -0.8, 0, 0),
    rotation: vec(0, 0, 0),
    scale: genderScale(gender),
    color: genderColor(gender),
    posePreset: 'stand',
    posePresetId: 'stand',
    poseRootOffset: vec(),
    rigPose: naturalStandingPose(),
    fingerPose: cloneFingerPose(),
    libTvJointAngles: libTvJointAnglesForPresetId('stand'),
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
    name: '主机位',
    visible: true,
    locked: false,
    position: vec(4, 2.1, 5),
    rotation: vec(0, 0, 0),
    scale: vec(1, 1, 1),
    targetPosition: vec(0, 1, 0),
    fov: 45,
    captures: []
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
          name: '道具1',
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
          name: '环境光',
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
          name: '主方向光',
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
    characterLabelsEnabled: true,
    compositionGuideEnabled: true,
    captures: [],
    poseTransitions: [],
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

function normalizeLegacyPresetPose(preset: string | undefined, pose: StandardHumanRigPose) {
  const next = clonePose(pose);
  if ((preset === 'sit' || preset === 'crouch') && next.leftUpperLeg.x < 0 && next.rightUpperLeg.x < 0) {
    next.leftUpperLeg.x = Math.abs(next.leftUpperLeg.x);
    next.rightUpperLeg.x = Math.abs(next.rightUpperLeg.x);
  }
  if (preset === 'kneel' && next.leftUpperLeg.x < 0) {
    next.leftUpperLeg.x = Math.abs(next.leftUpperLeg.x);
  }
  if ((preset === 'walk' || preset === 'run' || preset === 'fight_guard') && next.leftUpperLeg.x < 0 && next.rightUpperLeg.x > 0) {
    next.leftUpperLeg.x = Math.abs(next.leftUpperLeg.x);
    next.rightUpperLeg.x = -Math.abs(next.rightUpperLeg.x);
  }
  return next;
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
        fingerPose: normalizeFingerPose(sample?.fingerPose),
        libTvJointAngles: normalizeLibTvJointAngles(sample?.libTvJointAngles)
      }))
    : [];
  if (!tracks.length || !samples.length) return undefined;
  return {
    name: typeof value.name === 'string' ? value.name : 'pose_transition',
    durationSec: Number.isFinite(Number(value.durationSec)) ? Number(value.durationSec) : samples[samples.length - 1]?.timeSec || 0,
    sampleRate: Number.isFinite(Number(value.sampleRate)) ? Number(value.sampleRate) : 24,
    tracks,
    samples,
    contacts: Array.isArray(value.contacts)
      ? value.contacts.map(normalizeContactFrame).filter(Boolean) as AnimationContactFrame[]
      : []
  };
}

function normalizeActionPlan(value: any): PoseTransitionActionPlan {
  return {
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

function normalizeTransition(value: any): PoseTransition | null {
  if (!value || typeof value !== 'object' || typeof value.characterId !== 'string') return null;
  return {
    id: typeof value.id === 'string' ? value.id : createId('transition'),
    name: typeof value.name === 'string' ? value.name : '姿势过渡',
    characterId: value.characterId,
    actionPrompt: typeof value.actionPrompt === 'string' ? value.actionPrompt : '',
    actionPlan: normalizeActionPlan(value.actionPlan),
    constraints: normalizeConstraints(value.constraints),
    durationSec: Number.isFinite(Number(value.durationSec)) ? Number(value.durationSec) : 1.2,
    curve: value.curve === 'ease_in' || value.curve === 'ease_out' || value.curve === 'ease_in_out' ? value.curve : 'linear',
    startPose: value.startPose ? normalizePose(value.startPose) : undefined,
    endPose: value.endPose ? normalizePose(value.endPose) : undefined,
    startFingerPose: value.startFingerPose ? normalizeFingerPose(value.startFingerPose) : undefined,
    endFingerPose: value.endFingerPose ? normalizeFingerPose(value.endFingerPose) : undefined,
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
    aspectRatio: scene.aspectRatio,
    gridSnapEnabled: scene.gridSnapEnabled,
    groundGridEnabled: scene.groundGridEnabled,
    groundEnabled: scene.groundEnabled,
    characterLabelsEnabled: scene.characterLabelsEnabled,
    compositionGuideEnabled: scene.compositionGuideEnabled,
    captures: scene.captures,
    poseTransitions: scene.poseTransitions
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
    label: typeof value.label === 'string' && value.label.trim() ? value.label : '修改场景',
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
        name: typeof camera.name === 'string' ? camera.name : `机位 ${index + 1}`,
        visible: camera.visible !== false,
        locked: Boolean(camera.locked),
        position: normalizeVec(camera.position, vec(4, 2.1, 5)),
        rotation: normalizeVec(camera.rotation, vec()),
        scale: normalizeVec(camera.scale, vec(1, 1, 1)),
        targetPosition: normalizeVec(camera.targetPosition, vec(0, 1, 0)),
        fov: Number.isFinite(Number(camera.fov)) ? Number(camera.fov) : 45,
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
            const presetJointAngles = posePreset === 'custom' ? undefined : libTvJointAnglesForPresetId(posePreset);
            const presetFingerPose = POSE_PRESETS.find((item) => item.id === posePreset)?.fingerPose || FINGER_POSE_RELAXED;
            const libTvJointAngles = normalizeLibTvJointAngles(character.libTvJointAngles, presetJointAngles);
            const poseFromLibTv = libTvJointAngles ? libTvPoseToRigPose(libTvJointAngles, posePreset) : undefined;
            const rigPose = clampPose(normalizeCharacterRigPose(
              character.model,
              posePreset,
              normalizeLegacyPresetPose(
                posePreset,
                poseFromLibTv || normalizePose(character.rigPose || character.pose || character.poseParams)
              )
            ));
            return {
              ...defaultCharacter(gender, index + 1),
              ...character,
              id: typeof character.id === 'string' ? character.id : createId('char'),
              gender,
              name: typeof character.name === 'string' ? character.name : `角色 ${index + 1}`,
              visible: character.visible !== false,
              locked: Boolean(character.locked),
              position: normalizeVec(character.position, vec()),
              rotation: normalizeVec(character.rotation, vec()),
              scale: normalizeCharacterScale(gender, character.scale, character.model),
              color: typeof character.color === 'string' ? character.color : genderColor(gender),
              posePreset,
              posePresetId: posePreset,
              poseRootOffset: normalizeCharacterRootOffset(character.model, posePreset, character.poseRootOffset),
              rigPose,
              fingerPose: normalizeFingerPose(character.fingerPose, presetFingerPose),
              libTvJointAngles,
              model: normalizeCharacterModel(gender, character.model)
            };
          })
        : fallback.objects.characters,
      props: Array.isArray(value.objects?.props)
        ? value.objects.props.map((prop: any, index: number): PropObject => ({
            id: typeof prop.id === 'string' ? prop.id : createId('prop'),
            name: typeof prop.name === 'string' ? prop.name : `道具${index + 1}`,
            visible: prop.visible !== false,
            locked: Boolean(prop.locked),
            shape: prop.shape === 'sphere' || prop.shape === 'cylinder' ? prop.shape : 'box',
            position: normalizeVec(prop.position, vec()),
            rotation: normalizeVec(prop.rotation, vec()),
            scale: normalizeVec(prop.scale, vec(0.6, 0.6, 0.6)),
            color: typeof prop.color === 'string' ? prop.color : '#a16207'
          }))
        : fallback.objects.props,
      cameras,
      lights: Array.isArray(value.objects?.lights)
        ? value.objects.lights.map((light: any, index: number): LightObject => ({
            id: typeof light.id === 'string' ? light.id : createId('light'),
            name: typeof light.name === 'string' ? light.name : `灯光 ${index + 1}`,
            visible: light.visible !== false,
            locked: Boolean(light.locked),
            lightType: light.lightType === 'directional' || light.lightType === 'point' ? light.lightType : 'ambient',
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
    characterLabelsEnabled: value.characterLabelsEnabled !== false,
    compositionGuideEnabled: value.compositionGuideEnabled !== false,
    captures: Array.isArray(value.captures) ? value.captures : [],
    poseTransitions: Array.isArray(value.poseTransitions)
      ? value.poseTransitions.map(normalizeTransition).filter(Boolean) as PoseTransition[]
      : [],
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
    selectedObjectId: scene.selectedObjectId,
    activeViewMode: scene.activeViewMode,
    transformMode: scene.transformMode,
    activeTransitionId: scene.activeTransitionId,
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
  return list.find((item) => item.id === id)?.name || '对象';
}

function defaultObjectPatchLabel(kind: ObjectKind, scene: Scene3DState, id: string, patch: any) {
  const name = objectNameForHistory(scene, kind, id);
  if ('rigPose' in patch || 'fingerPose' in patch || 'posePreset' in patch || 'posePresetId' in patch) return `修改${name}姿势`;
  if ('gender' in patch) return `修改${name}性别`;
  if ('name' in patch) return `重命名${name}`;
  if ('position' in patch) return `移动${name}`;
  if ('rotation' in patch) return `旋转${name}`;
  if ('scale' in patch) return `缩放${name}`;
  if ('fov' in patch) return `修改${name}焦距`;
  if ('targetPosition' in patch) return `修改${name}注视点`;
  if ('intensity' in patch) return `修改${name}强度`;
  if ('color' in patch) return `修改${name}颜色`;
  if ('shape' in patch) return `修改${name}形状`;
  if ('lightType' in patch) return `修改${name}类型`;
  if ('visible' in patch) return `${patch.visible ? '显示' : '隐藏'}${name}`;
  if ('locked' in patch) return `${patch.locked ? '锁定' : '解锁'}${name}`;
  return `修改${name}`;
}

function historyMergeKeyForObjectPatch(kind: ObjectKind, id: string, patch: any) {
  const keys = Object.keys(patch).sort();
  const mergeableKeys = ['position', 'rotation', 'scale', 'targetPosition', 'fov', 'rigPose', 'fingerPose', 'intensity', 'color'];
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

function captureCharacterState(character: CharacterObject) {
  const posePresetId = normalizePosePresetId(character.posePresetId || character.posePreset);
  const libTvJointAngles = character.libTvJointAngles
    ? cloneLibTvJointAngles(character.libTvJointAngles)
    : libTvJointAnglesForPresetId(posePresetId);
  return {
    posePresetId,
    libTvJointAngles,
    pose: clonePose(character.rigPose),
    fingerPose: cloneFingerPose(character.fingerPose),
    transform: {
      position: { ...character.position },
      rotation: { ...character.rotation },
      scale: { ...character.scale }
    }
  };
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

function quatToRotation(quaternion: THREE.Quaternion): RigRotation {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    x: Number(deg(euler.x).toFixed(3)),
    y: Number(deg(euler.y).toFixed(3)),
    z: Number(deg(euler.z).toFixed(3))
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
    ? `${hand === 'left' ? '左手' : '右手'}目标超出自然臂展，已按最大可达范围约束。`
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
  t: number
) {
  const weight = template.strength;
  const wave = Math.sin(t * Math.PI * 2);
  if (template.id === 'raise_hand') {
    const hand = template.hand || 'right';
    return hand === 'left'
      ? patchPose(pose, {
          leftUpperArm: { x: -88 * weight, z: -56 * weight },
          leftLowerArm: { x: 30 * weight }
        })
      : patchPose(pose, {
          rightUpperArm: { x: -88 * weight, z: -56 * weight },
          rightLowerArm: { x: 30 * weight }
        });
  }
  if (template.id === 'wave') {
    const hand = template.hand || 'right';
    return hand === 'left'
      ? patchPose(pose, {
          leftUpperArm: { x: -92 * weight, z: -54 * weight },
          leftLowerArm: { x: 38 * weight + wave * 10 * weight },
          leftHand: { y: wave * 16 * weight, z: -24 * weight }
        })
      : patchPose(pose, {
          rightUpperArm: { x: -92 * weight, z: -54 * weight },
          rightLowerArm: { x: 38 * weight + wave * 10 * weight },
          rightHand: { y: -wave * 16 * weight, z: -24 * weight }
        });
  }
  if (template.id === 'point_at') {
    const hand = template.hand || 'right';
    return hand === 'left'
      ? patchPose(pose, {
          leftUpperArm: { x: -36 * weight, z: -48 * weight },
          leftLowerArm: { x: 15 * weight }
        })
      : patchPose(pose, {
          rightUpperArm: { x: -36 * weight, z: -48 * weight },
          rightLowerArm: { x: 15 * weight }
        });
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
    return pose;
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
    return pose;
  }
  if (template.id === 'sit_down') {
    const k = easeCurve('ease_in_out', t) * weight;
    return patchPose(pose, {
      pelvis: { x: -10 * k },
      chest: { x: 10 * k },
      leftUpperLeg: { x: 86 * k },
      rightUpperLeg: { x: 86 * k },
      leftLowerLeg: { x: 95 * k },
      rightLowerLeg: { x: 95 * k }
    });
  }
  if (template.id === 'stand_up') {
    const k = 1 - easeCurve('ease_in_out', 1 - t);
    return patchPose(pose, {
      pelvis: { x: -10 * (1 - k) },
      chest: { x: 10 * (1 - k) },
      leftUpperLeg: { x: 86 * (1 - k) },
      rightUpperLeg: { x: 86 * (1 - k) },
      leftLowerLeg: { x: 95 * (1 - k) },
      rightLowerLeg: { x: 95 * (1 - k) }
    });
  }
  if (template.id === 'turn_to') {
    transform.rotation.y += Math.sin(t * Math.PI) * 18 * weight;
    return patchPose(pose, {
      chest: { y: Math.sin(t * Math.PI) * 16 * weight },
      neck: { y: Math.sin(t * Math.PI) * 6 * weight }
    });
  }
  if (template.id === 'look_at') {
    return patchPose(pose, { head: { y: Math.sin(t * Math.PI) * 8 * weight } });
  }
  if (template.id === 'pick_up') {
    const hand = template.hand || 'right';
    return patchPose(pose, {
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
    });
  }
  if (template.id === 'put_down') {
    const hand = template.hand || 'right';
    return patchPose(pose, {
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
    });
  }
  return pose;
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
    notes.push('未提供动作提示词，将只根据起始与结束姿势做确定性插值。');
  }
  if (/[看望瞄].*(镜头|相机)|look at/.test(normalized)) push('look_at');
  if (/转身|转向|turn/.test(normalized)) push('turn_to');
  if (/抬手|举手|raise hand/.test(normalized)) push('raise_hand', { hand: /左手/.test(normalized) ? 'left' : 'right' });
  if (/挥手|招手|wave/.test(normalized)) push('wave', { hand: /左手/.test(normalized) ? 'left' : 'right' });
  if (/指向|指着|point/.test(normalized)) push('point_at', { hand: /左手/.test(normalized) ? 'left' : 'right' });
  if (/前进|向前|上前|迈步|step forward/.test(normalized)) push('step_forward');
  if (/后退|退后|step back/.test(normalized)) push('step_back');
  if (/坐下|sit down/.test(normalized)) push('sit_down');
  if (/站起|起身|stand up/.test(normalized)) push('stand_up');
  if (/拿起|拾取|pick up/.test(normalized)) push('pick_up');
  if (/放下|put down/.test(normalized)) push('put_down');

  const targetObject = scene.objects.props.find((item) => prompt.includes(item.name))
    || scene.objects.characters.find((item) => prompt.includes(item.name))
    || scene.objects.cameras.find((item) => prompt.includes(item.name));
  if (targetObject) {
    templates.forEach((item) => {
      if (item.id === 'point_at' || item.id === 'pick_up' || item.id === 'put_down') item.targetObjectId = targetObject.id;
    });
    notes.push(`已将动作目标解析为“${targetObject.name}”。`);
  }
  if (!templates.length && normalized) notes.push('动作提示词未匹配到已支持模板，将只做骨骼插值。');
  return { templates, notes };
}

function validateTransition(scene: Scene3DState, transition: PoseTransition) {
  const issues: string[] = [];
  const character = scene.objects.characters.find((item) => item.id === transition.characterId);
  if (!character) issues.push('角色不存在。');
  if (!transition.startPose || !transition.endPose) issues.push('起始姿势和结束姿势必须先保存。');
  if (!transition.startTransform || !transition.endTransform) issues.push('起始位姿和结束位姿必须先保存。');
  if (!(transition.durationSec > 0)) issues.push('时长必须大于 0。');
  if (transition.constraints.headLookAt.enabled && transition.constraints.headLookAt.targetMode === 'object') {
    const exists = scene.objects.props.some((item) => item.id === transition.constraints.headLookAt.targetObjectId)
      || scene.objects.characters.some((item) => item.id === transition.constraints.headLookAt.targetObjectId)
      || scene.objects.cameras.some((item) => item.id === transition.constraints.headLookAt.targetObjectId);
    if (!exists) issues.push('头部看向约束的目标不存在。');
  }
  if (transition.constraints.handTarget.enabled && transition.constraints.handTarget.targetMode === 'object') {
    const exists = scene.objects.props.some((item) => item.id === transition.constraints.handTarget.targetObjectId)
      || scene.objects.characters.some((item) => item.id === transition.constraints.handTarget.targetObjectId)
      || scene.objects.cameras.some((item) => item.id === transition.constraints.handTarget.targetObjectId);
    if (!exists) issues.push('手部目标约束的目标不存在。');
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
        note: `${hand === 'left' ? '左手' : '右手'}到达道具`
      });
      pushUnique({
        timeSec: Number((durationSec * 0.55).toFixed(3)),
        kind: 'grasp',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}抓取道具`
      });
    }
    if (template.id === 'put_down') {
      pushUnique({
        timeSec: 0,
        kind: 'grasp',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}起始持有道具`
      });
      pushUnique({
        timeSec: Number((durationSec * 0.45).toFixed(3)),
        kind: 'reach',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}移动到放置点`
      });
      pushUnique({
        timeSec: Number((durationSec * 0.78).toFixed(3)),
        kind: 'release',
        targetObjectId: template.targetObjectId || transition.constraints.handTarget.targetObjectId,
        limb,
        position: targetPosition,
        note: `${hand === 'left' ? '左手' : '右手'}释放道具`
      });
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
        note: '左脚锁定在起始支撑点'
      });
    }
    if (transition.constraints.footLock.right) {
      pushUnique({
        timeSec: 0,
        kind: 'foot_lock',
        limb: 'rightFoot',
        position: vec(start.x + 0.12, start.y, start.z),
        note: '右脚锁定在起始支撑点'
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
  contacts: AnimationContactFrame[] = []
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
    tracks,
    samples,
    contacts
  };
  buildThreeAnimationClip(transition.characterId, clip);
  return clip;
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
    fingerPose: a.fingerPose && b.fingerPose ? lerpFingerPose(a.fingerPose, b.fingerPose, t) : cloneFingerPose(a.fingerPose),
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
              fingerPose: cloneFingerPose(sample.fingerPose),
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
  const warningSet = new Set(transition.actionPlan.notes);
  const { issues } = validateTransition(scene, transition);
  if (issues.length) {
    return {
      ...transition,
      animationClip: undefined,
      warnings: Array.from(warningSet),
      error: issues.join(' ')
    };
  }
  const startPose = clonePose(transition.startPose);
  const endPose = clonePose(transition.endPose);
  const startFingerPose = cloneFingerPose(transition.startFingerPose);
  const endFingerPose = cloneFingerPose(transition.endFingerPose);
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
      warningSet.add(`${frame.note} 缺少明确目标对象。`);
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
    for (const template of transition.actionPlan.templates) nextPose = applyTemplateOverlay(nextPose, transform, template, t);
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
      if (transition.constraints.footLock.left) {
        nextPose.leftFoot = { ...startPose.leftFoot };
      }
      if (transition.constraints.footLock.right) {
        nextPose.rightFoot = { ...startPose.rightFoot };
      }
    }
    if (transition.constraints.jointLimitsEnabled) nextPose = clampPose(nextPose);
    samples.push({
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
      fingerPose: lerpFingerPose(startFingerPose, endFingerPose, eased),
      libTvJointAngles
    });
  }

  try {
    const animationClip = createSerializedClip(transition, samples, contactFrames);
    return {
      ...transition,
      animationClip,
      warnings: Array.from(warningSet),
      error: undefined,
      updatedAt: new Date().toISOString()
    };
  } catch (error: any) {
    return {
      ...transition,
      animationClip: undefined,
      warnings: Array.from(warningSet),
      error: error?.message || '动画片段构建失败。',
      updatedAt: new Date().toISOString()
    };
  }
}

function uploadCanvasBlob(blob: Blob) {
  const form = new FormData();
  form.append('file', new File([blob], `scene3d-${Date.now()}.png`, { type: 'image/png' }));
  form.append('key', 'scene3d-capture');
  return fetch('/api/media/upload', { method: 'POST', body: form }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.success || !body?.assetId || !body?.url) {
      throw new Error(body?.error || '截图上传失败');
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
  if (!sourceWidth || !sourceHeight) throw new Error('WebGL 画布输出为空。');
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
  if (!context) throw new Error('截图裁切失败，无法创建 2D 画布。');
  context.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob((nextBlob) => (nextBlob ? resolve(nextBlob) : reject(new Error('截图裁切输出为空。'))), 'image/png');
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
    onError('未找到 WebGL 画布，无法截图。');
    return;
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const canvas = renderer.domElement;
  const cropped = await canvasToAspectBlob(canvas, scene.aspectRatio);
  const uploaded = await uploadCanvasBlob(cropped.blob);
  const activeCamera = scene.objects.cameras.find((camera) => camera.id === scene.activeCameraId) || scene.objects.cameras[0];
  const nextCapture: Capture = {
    id: createId('cap'),
    name: `截图 ${scene.captures.length + 1}`,
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
  onPatch(nextScene, { label: `截图 ${scene.captures.length + 1}` });
  onCreateImageNode?.({ capture: nextCapture, scene: nextScene });
  onError('');
}

export default function Scene3DNode({
  node,
  isSelected,
  onUpdate,
  onSelect,
  onCreateImageNode
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
        const before = createHistorySnapshot(currentScene);
        const after = createHistorySnapshot(next);
        if (!snapshotsEqual(before, after)) {
          const last = currentScene.undoStack[currentScene.undoStack.length - 1];
          const shouldMerge = Boolean(options.mergeKey && last?.mergeKey === options.mergeKey);
          const entry: Scene3DHistoryEntry = {
            id: shouldMerge ? last.id : createId('history'),
            label: options.label || '修改场景',
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
      setError(captureError?.message || '截图失败。');
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
            <Suspense fallback={<Html center><div className="rounded bg-black/70 px-3 py-2 text-xs text-zinc-200">正在加载 3D 场景</div></Html>}>
              <ScenePreviewViewport scene={scene} />
            </Suspense>
          </ThreeCanvas>

          <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-md border border-white/5 bg-black/45 px-2 py-1 backdrop-blur-md">
            <div className={`h-1.5 w-1.5 rounded-full ${cardCapturing ? 'animate-pulse bg-violet-300' : 'bg-green-500'}`} />
            <span className="text-[9px] font-bold uppercase tracking-tight text-zinc-300">{node.name || '3D导演台'}</span>
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
              {cardCapturing ? '截图中' : '截图'}
            </button>
          </div>

          {lastCapture?.mediaUrl && (
            <div className="absolute bottom-3 right-3 z-10 overflow-hidden rounded-md border border-white/10 bg-black/50 p-1 shadow-xl backdrop-blur-md">
              <img src={lastCapture.mediaUrl} alt="最后截图" className="h-10 w-16 rounded object-cover" />
            </div>
          )}
        </div>
        {error && <div className="border-t border-red-400/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</div>}
      </div>
      {open && createPortal(
        <DirectorStage
          scene={scene}
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
  scene,
  onClose,
  onPatch,
  onError,
  onCreateImageNode
}: {
  scene: Scene3DState;
  onClose: () => void;
  onPatch: SceneChangeHandler;
  onError: (message: string) => void;
  onCreateImageNode?: (result: Scene3DCaptureResult) => void;
}) {
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
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
  const activeTransition = selectedCharacter && activeTransitionCandidate?.characterId !== selectedCharacter.id
    ? scene.poseTransitions.find((item) => item.characterId === selectedCharacter.id) || null
    : activeTransitionCandidate;
  const previewLocked = Boolean(activeTransition?.animationClip && preview.transitionId === activeTransition.id && preview.enabled);

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
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (!mod && (key === 'delete' || key === 'backspace')) {
        if (!scene.selectedObjectId || !selected) return;
        event.preventDefault();
        deleteSelected();
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
  }, [scene.undoStack, scene.redoStack, scene.selectedObjectId, selected]);

  const updateObject = (kind: ObjectKind, id: string, patch: any) => {
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
      label: defaultObjectPatchLabel(kind, scene, id, patch),
      mergeKey: historyMergeKeyForObjectPatch(kind, id, patch)
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

  const addProp = (shape: 'chair' | 'table' | 'cup' | 'box') => {
    const config: Record<typeof shape, Partial<PropObject>> = {
      chair: { shape: 'box', scale: vec(0.75, 0.85, 0.75), color: '#a16207' },
      table: { shape: 'box', scale: vec(1.6, 0.7, 0.9), color: '#92400e' },
      cup: { shape: 'cylinder', scale: vec(0.22, 0.36, 0.22), color: '#e5e7eb' },
      box: { shape: 'box', scale: vec(0.7, 0.7, 0.7), color: '#f59e0b' }
    };
    onPatch((current) => {
      const propName = `道具${current.objects.props.length + 1}`;
      const prop: PropObject = {
        id: createId('prop'),
        name: propName,
        visible: true,
        locked: false,
        shape: config[shape].shape || 'box',
        position: vec(1.2, 0, 0),
        rotation: vec(),
        scale: config[shape].scale || vec(0.6, 0.6, 0.6),
        color: config[shape].color || '#a16207'
      };
      return normalizeScene({
        ...current,
        selectedObjectId: prop.id,
        objects: { ...current.objects, props: [...current.objects.props, prop] }
      });
    }, { label: '添加道具' });
  };

  const addCamera = () => {
    onPatch((current) => {
      const camera = { ...defaultCamera(), id: createId('cam'), name: `机位 ${current.objects.cameras.length + 1}` };
      return normalizeScene({
        ...current,
        selectedObjectId: camera.id,
        activeCameraId: current.activeCameraId || camera.id,
        objects: { ...current.objects, cameras: [...current.objects.cameras, camera] }
      });
    }, { label: '添加机位' });
  };

  const addLight = () => {
    onPatch((current) => {
      const light: LightObject = {
        id: createId('light'),
        name: `灯光 ${current.objects.lights.length + 1}`,
        visible: true,
        locked: false,
        lightType: 'point',
        position: vec(2, 3, 2),
        rotation: vec(),
        scale: vec(1, 1, 1),
        color: '#ffffff',
        intensity: 1.2
      };
      return normalizeScene({
        ...current,
        selectedObjectId: light.id,
        objects: { ...current.objects, lights: [...current.objects.lights, light] }
      });
    }, { label: '添加灯光' });
  };

  const deleteSelected = () => {
    if (!selected || !scene.selectedObjectId) return;
    const selectedObject = objectByKind(scene, selected, scene.selectedObjectId);
    if (!selectedObject) return;
    if (selectedObject.locked) {
      onError(`“${selectedObject.name}”已锁定，不能删除。`);
      return;
    }
    const deleteLabel = `删除${selectedObject.name}`;
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
  };

  const capture = async () => {
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
      onError(error?.message || '截图失败。');
    } finally {
      setCaptureCleanFrame(false);
      setCapturing(false);
    }
  };

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
              title={scene.undoStack.length ? `撤销：${scene.undoStack[scene.undoStack.length - 1].label}` : '没有可撤销操作'}
              className="rounded-md border border-white/10 p-1 text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!scene.redoStack.length}
              onClick={redoSceneChange}
              title={scene.redoStack.length ? `恢复：${scene.redoStack[scene.redoStack.length - 1].label}` : '没有可恢复操作'}
              className="rounded-md border border-white/10 p-1 text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Redo2 className="h-4 w-4" />
            </button>
              <Segmented
                value={scene.activeViewMode}
                options={[
                  { value: 'director', label: '导演视角' },
                  { value: 'camera', label: '机位视角' }
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
            onUpdateObject={updateObject}
          />
          <div className="relative min-h-0 border-x border-white/10">
            <ThreeCanvas
              shadows
              gl={{ preserveDrawingBuffer: true, antialias: true }}
              camera={{ position: [4.2, 2.8, 5.8], fov: 48 }}
              onCreated={({ gl }) => {
                glRef.current = gl;
              }}
            >
              <Suspense fallback={<Html center><div className="rounded bg-black/70 px-3 py-2 text-xs">正在加载 3D 场景</div></Html>}>
                <SceneViewport
                  scene={scene}
                  selectedKind={selected}
                  dragging={dragging}
                  previewTransitionId={preview.transitionId}
                  previewLocked={previewLocked}
                  previewSample={previewSample}
                  presentation={captureCleanFrame ? 'clean' : 'editor'}
                  onDragging={setDragging}
                  onPatch={onPatch}
                  onUpdateObject={updateObject}
                />
              </Suspense>
            </ThreeCanvas>
            {scene.compositionGuideEnabled && !captureCleanFrame && <CompositionGuide />}
          </div>
          <PropertyPanel
            scene={scene}
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
          onWriteCurrentPose={() => {
            if (!previewSample || !activeTransition) return;
            onPatch((current) => applyPreviewFrameToScene(current, activeTransition.id, previewSample), { label: '写回当前预览帧' });
          }}
        />
        <div className="flex h-11 items-center gap-2 overflow-x-auto border-t border-white/10 px-3">
          <ToolButton icon={<Move3D className="h-4 w-4" />} label="移动" active={scene.transformMode === 'translate'} onClick={() => onPatch({ transformMode: 'translate' }, { history: false })} />
          <ToolButton icon={<RotateCw className="h-4 w-4" />} label="旋转" active={scene.transformMode === 'rotate'} onClick={() => onPatch({ transformMode: 'rotate' }, { history: false })} />
          <ToolButton icon={<ZoomIn className="h-4 w-4" />} label="缩放" active={scene.transformMode === 'scale'} onClick={() => onPatch({ transformMode: 'scale' }, { history: false })} />
          <ToolButton icon={<UserRound className="h-4 w-4" />} label="添加男性" onClick={() => addCharacter('male')} />
          <ToolButton icon={<Users className="h-4 w-4" />} label="添加女性" onClick={() => addCharacter('female')} />
          <ToolButton icon={<Box className="h-4 w-4" />} label="添加道具" onClick={() => addProp('chair')} />
          <ToolButton icon={<Camera className="h-4 w-4" />} label="添加机位" onClick={addCamera} />
          <ToolButton icon={<Lightbulb className="h-4 w-4" />} label="添加灯光" onClick={addLight} />
          <ToolButton icon={<ImagePlus className="h-4 w-4" />} label={capturing ? '截图中' : '截图'} disabled={capturing} onClick={capture} />
        </div>
      </div>
    </div>
  );
}

function SceneViewport({
  scene,
  selectedKind,
  dragging,
  previewTransitionId,
  previewLocked,
  previewSample,
  presentation = 'editor',
  onDragging,
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
  onPatch: SceneChangeHandler;
  onUpdateObject: (kind: ObjectKind, id: string, patch: any) => void;
}) {
  const { camera } = useThree();
  const isClean = presentation === 'clean';
  const activeCamera = scene.objects.cameras.find((item) => item.id === scene.activeCameraId) || scene.objects.cameras[0];
  const previewTransition = scene.poseTransitions.find((item) => item.id === previewTransitionId) || null;
  const previewCharacterId = previewTransition?.characterId;
  const previewPropTransforms = useMemo(
    () => (previewLocked ? buildPreviewPropTransforms(scene, previewTransition, previewSample) : {}),
    [scene, previewTransition, previewSample, previewLocked]
  );

  useEffect(() => {
    if (scene.activeViewMode !== 'camera' || !activeCamera || dragging) return;
    camera.position.set(activeCamera.position.x, activeCamera.position.y, activeCamera.position.z);
    camera.lookAt(cameraTarget(activeCamera));
    if ('fov' in camera) {
      (camera as THREE.PerspectiveCamera).fov = activeCamera.fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
  }, [scene.activeViewMode, activeCamera, camera, dragging]);

  return (
    <>
      <color attach="background" args={[scene.background.color]} />
      {scene.objects.lights.filter((item) => item.visible).map((light) => (
        light.lightType === 'ambient'
          ? <ambientLight key={light.id} color={light.color} intensity={light.intensity} />
          : light.lightType === 'directional'
            ? <directionalLight key={light.id} position={[light.position.x, light.position.y, light.position.z]} intensity={light.intensity} color={light.color} castShadow />
            : <pointLight key={light.id} position={[light.position.x, light.position.y, light.position.z]} intensity={light.intensity} color={light.color} castShadow />
      ))}
      {scene.groundEnabled && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          position={[0, -0.01, 0]}
          onDoubleClick={(event: ThreeEvent<MouseEvent>) => {
            if (isClean) return;
            event.stopPropagation();
            onPatch({ selectedObjectId: undefined, activeViewMode: 'director' }, { history: false });
          }}
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
      <group onPointerMissed={(event) => {
        if (isClean || event.detail < 2) return;
        onPatch({ selectedObjectId: undefined, activeViewMode: 'director' }, { history: false });
      }}>
        {scene.objects.characters.filter((item) => item.visible).map((character) => {
          const display = previewLocked && previewCharacterId === character.id && previewSample
            ? {
                position: previewSample.transform.position,
                rotation: previewSample.transform.rotation,
                scale: previewSample.transform.scale,
                rigPose: previewSample.pose
              }
            : {
                position: character.position,
                rotation: character.rotation,
                scale: character.scale,
                rigPose: character.rigPose
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
              pivotLocalY={characterPivotLocalY(character)}
              onDragging={onDragging}
              onUpdateObject={onUpdateObject}
            >
              <CharacterModel
                character={character}
                effectivePose={display.rigPose}
                showLabel={!isClean && scene.characterLabelsEnabled}
                selected={!isClean && scene.selectedObjectId === character.id}
                onSelect={() => !isClean && onPatch({
                  selectedObjectId: character.id,
                  activeViewMode: 'director',
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
              onDragging={onDragging}
              onUpdateObject={onUpdateObject}
            >
              <PropModel prop={prop} selected={!isClean && scene.selectedObjectId === prop.id} showLabel={!isClean} onSelect={() => !isClean && onPatch({ selectedObjectId: prop.id, activeViewMode: 'director' }, { history: false })} />
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
            onDragging={onDragging}
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
            onDragging={onDragging}
            onUpdateObject={onUpdateObject}
          >
            <LightRig light={light} selected={scene.selectedObjectId === light.id} onSelect={() => onPatch({ selectedObjectId: light.id, activeViewMode: 'director' }, { history: false })} />
          </Transformable>
        ))}
      </group>
      {!isClean && <OrbitControls enabled={!dragging && scene.activeViewMode === 'director' && !previewLocked} target={[0, 0.95, 0]} makeDefault />}
      {!isClean && (
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
          <GizmoViewport />
        </GizmoHelper>
      )}
    </>
  );
}

function ScenePreviewViewport({ scene }: { scene: Scene3DState }) {
  const noopDragging = useMemo(() => () => undefined, []);
  const noopPatch = useMemo<SceneChangeHandler>(() => () => undefined, []);
  const noopUpdate = useMemo(() => () => undefined, []);
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
  pivotLocalY = 0,
  onDragging,
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
  pivotLocalY?: number;
  onDragging: (dragging: boolean) => void;
  onUpdateObject: (kind: ObjectKind, id: string, patch: any) => void;
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
        Number((group.position.y - pivotLocalY * group.scale.y).toFixed(3)),
        Number(group.position.z.toFixed(3))
      ),
      rotation: vec(Number(deg(group.rotation.x).toFixed(2)), Number(deg(group.rotation.y).toFixed(2)), Number(deg(group.rotation.z).toFixed(2))),
      scale: vec(Number(group.scale.x.toFixed(3)), Number(group.scale.y.toFixed(3)), Number(group.scale.z.toFixed(3)))
    });
  };

  const body = (
    <group
      ref={ref}
      position={[objectTransform.position.x, objectTransform.position.y + pivotLocalY * (objectTransform.scale.y || 1), objectTransform.position.z]}
      rotation={[rad(objectTransform.rotation.x), rad(objectTransform.rotation.y), rad(objectTransform.rotation.z)]}
      scale={[objectTransform.scale.x || 1, objectTransform.scale.y || 1, objectTransform.scale.z || 1]}
    >
      <group position={[0, -pivotLocalY, 0]}>
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
          draggingRef.current = true;
          onDragging(true);
        }}
        onMouseUp={() => {
          draggingRef.current = false;
          onDragging(false);
          sync();
        }}
        onObjectChange={() => {
          if (draggingRef.current && transformMode !== 'scale') sync();
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
  const safePose = useMemo(() => clampPose(effectivePose), [effectivePose]);
  if (character.model.type === 'proxy') {
    return <HumanProxy character={character} effectivePose={safePose} showLabel={showLabel} selected={selected} onSelect={onSelect} />;
  }
  return <GLBCharacter character={character} effectivePose={safePose} showLabel={showLabel} selected={selected} onSelect={onSelect} />;
}

function GLBCharacter({
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
    applyRigPoseToModel(rig, effectivePose, character.fingerPose);
  }, [rig, effectivePose, character.fingerPose]);

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

function collectRig(model: THREE.Object3D) {
  const byName = new Map<string, THREE.Bone>();
  const rest = new Map<string, THREE.Quaternion>();
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) {
      const bone = child as THREE.Bone;
      byName.set(bone.name, bone);
      rest.set(bone.name, bone.quaternion.clone());
    }
  });
  return { byName, rest };
}

function applyRigPoseToModel(
  rig: { byName: Map<string, THREE.Bone>; rest: Map<string, THREE.Quaternion> },
  pose: StandardHumanRigPose,
  fingerPose?: StandardHumanFingerPose
) {
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
  applyFingerPoseToModel(rig, fingerPose);
}

function applyFingerPoseToModel(
  rig: { byName: Map<string, THREE.Bone>; rest: Map<string, THREE.Quaternion> },
  fingerPose?: StandardHumanFingerPose
) {
  const pose = cloneFingerPose(fingerPose);
  const weights = [0.55, 0.35, 0.25];
  (['left', 'right'] as const).forEach((side) => {
    const hand = pose[side];
    const sideSign = side === 'left' ? 1 : -1;
    (['thumb', 'index', 'middle', 'ring', 'pinky'] as const).forEach((finger) => {
      const chain = FINGER_BONE_CHAINS[side][finger];
      const curl = hand[finger];
      chain.forEach((name, index) => {
        const bone = rig.byName.get(name);
        const rest = rig.rest.get(name);
        if (!bone || !rest) return;
        const spreadOffset = index === 0 && finger !== 'middle' ? hand.spread * sideSign * (finger === 'thumb' ? 0.8 : finger === 'index' ? -0.3 : 0.25) : 0;
        const thumbYaw = finger === 'thumb' ? sideSign * Math.min(28, curl * 0.35) : 0;
        const delta = vecToQuaternion({
          x: curl * weights[index],
          y: spreadOffset + thumbYaw,
          z: finger === 'thumb' ? sideSign * curl * 0.18 : 0
        });
        bone.quaternion.copy(rest).multiply(delta);
      });
    });
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
  const geometry = prop.shape === 'sphere'
    ? <sphereGeometry args={[0.5, 32, 16]} />
    : prop.shape === 'cylinder'
      ? <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
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

function CameraRig({ cameraObject, selected, onSelect }: { cameraObject: CameraObject; selected: boolean; onSelect: () => void }) {
  return (
    <group onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); }}>
      <mesh castShadow><boxGeometry args={[0.32, 0.2, 0.22]} /><meshStandardMaterial color={selected ? '#38bdf8' : '#64748b'} /></mesh>
      <mesh position={[0, 0, -0.28]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.18, 0.35, 24]} /><meshStandardMaterial color="#111827" /></mesh>
      <line>
        <bufferGeometry attach="geometry" setFromPoints={[
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(
            cameraObject.targetPosition.x - cameraObject.position.x,
            cameraObject.targetPosition.y - cameraObject.position.y,
            cameraObject.targetPosition.z - cameraObject.position.z
          )
        ]} />
        <lineBasicMaterial color="#38bdf8" />
      </line>
      <NameLabel name={cameraObject.name} y={0.45} />
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

function ObjectPanel({
  scene,
  objectSearch,
  onObjectSearch,
  onPatch,
  onAddCharacter,
  onAddProp,
  onAddCamera,
  onAddLight,
  onUpdateObject
}: {
  scene: Scene3DState;
  objectSearch: string;
  onObjectSearch: (value: string) => void;
  onPatch: SceneChangeHandler;
  onAddCharacter: (gender: CharacterGender) => void;
  onAddProp: (shape: 'chair' | 'table' | 'cup' | 'box') => void;
  onAddCamera: () => void;
  onAddLight: () => void;
  onUpdateObject: (kind: ObjectKind, id: string, patch: any) => void;
}) {
  const matches = (name: string) => !objectSearch.trim() || name.toLowerCase().includes(objectSearch.trim().toLowerCase());
  return (
    <div className="min-h-0 overflow-y-auto p-2">
      <input
        value={objectSearch}
        onChange={(event) => onObjectSearch(event.target.value)}
        className="mb-2 h-8 w-full rounded-md border border-white/10 bg-black/25 px-2 text-xs text-white outline-none"
        placeholder="搜索场景对象"
      />
      <ObjectSection title="角色" icon={<UserRound />} onAdd={() => onAddCharacter('male')}>
        {scene.objects.characters.filter((item) => matches(item.name)).map((item) => (
          <ObjectRow
            key={item.id}
            name={item.name}
            active={scene.selectedObjectId === item.id}
            visible={item.visible}
            locked={item.locked}
            onSelect={() => onPatch({
              selectedObjectId: item.id,
              activeViewMode: 'director',
              activeTransitionId: scene.poseTransitions.find((transition) => transition.characterId === item.id)?.id
            }, { history: false })}
            onRename={(name) => onUpdateObject('character', item.id, { name })}
            onToggleVisible={() => onUpdateObject('character', item.id, { visible: !item.visible })}
            onToggleLocked={() => onUpdateObject('character', item.id, { locked: !item.locked })}
          />
        ))}
      </ObjectSection>
      <ObjectSection title="道具" icon={<Box />} onAdd={() => onAddProp('chair')}>
        {scene.objects.props.filter((item) => matches(item.name)).map((item) => (
          <ObjectRow
            key={item.id}
            name={item.name}
            active={scene.selectedObjectId === item.id}
            visible={item.visible}
            locked={item.locked}
            onSelect={() => onPatch({ selectedObjectId: item.id, activeViewMode: 'director' }, { history: false })}
            onRename={(name) => onUpdateObject('prop', item.id, { name })}
            onToggleVisible={() => onUpdateObject('prop', item.id, { visible: !item.visible })}
            onToggleLocked={() => onUpdateObject('prop', item.id, { locked: !item.locked })}
          />
        ))}
      </ObjectSection>
      <ObjectSection title="灯光" icon={<Lightbulb />} onAdd={onAddLight}>
        {scene.objects.lights.filter((item) => matches(item.name)).map((item) => (
          <ObjectRow
            key={item.id}
            name={item.name}
            active={scene.selectedObjectId === item.id}
            visible={item.visible}
            locked={item.locked}
            onSelect={() => onPatch({ selectedObjectId: item.id, activeViewMode: 'director' }, { history: false })}
            onRename={(name) => onUpdateObject('light', item.id, { name })}
            onToggleVisible={() => onUpdateObject('light', item.id, { visible: !item.visible })}
            onToggleLocked={() => onUpdateObject('light', item.id, { locked: !item.locked })}
          />
        ))}
      </ObjectSection>
      <ObjectSection title="机位" icon={<Camera />} onAdd={onAddCamera}>
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
  scene,
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
  scene: Scene3DState;
  selectedKind: ObjectKind | null;
  preview: PreviewState;
  previewSample: AnimationClipSample | null;
  activeTransition: PoseTransition | null;
  onPatch: SceneChangeHandler;
  onUpdateObject: (kind: ObjectKind, id: string, patch: any) => void;
  onDeleteSelected: () => void;
  onSelectTransition: (transitionId: string) => void;
  onPreviewChange: React.Dispatch<React.SetStateAction<PreviewState>>;
  onError: (message: string) => void;
}) {
  const [characterTab, setCharacterTab] = useState<PoseTab>('property');
  const selectedId = scene.selectedObjectId;
  const character = scene.objects.characters.find((item) => item.id === selectedId);
  const prop = scene.objects.props.find((item) => item.id === selectedId);
  const camera = scene.objects.cameras.find((item) => item.id === selectedId);
  const light = scene.objects.lights.find((item) => item.id === selectedId);
  const characterTransitions = character ? scene.poseTransitions.filter((item) => item.characterId === character.id) : [];
  const currentTransition = character && activeTransition?.characterId === character.id ? activeTransition : characterTransitions[0] || null;

  const patchTransition = (
    transitionId: string,
    patch: Partial<PoseTransition> | ((transition: PoseTransition) => PoseTransition),
    options: SceneChangeOptions = {}
  ) => {
    onPatch((current) => normalizeScene({
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
      history: options.history
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
      constraints: defaultConstraints(),
      durationSec: 1.2,
      curve: 'ease_in_out',
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onPatch((current) => normalizeScene({
      ...current,
      poseTransitions: [...current.poseTransitions, created],
      activeTransitionId: created.id
    }), { label: '新建补间片段' });
    onPreviewChange((current) => ({ ...current, transitionId: created.id, currentTimeSec: 0, playing: false, enabled: false }));
    return created;
  };

  const ensureTransition = () => currentTransition || createTransition();

  const patchTransitionInput = (transitionId: string, patch: Partial<PoseTransition>) => {
    patchTransition(transitionId, {
      ...patch,
      animationClip: undefined,
      error: undefined
    }, {
      label: '修改补间片段',
      mergeKey: `transition:${transitionId}:${Object.keys(patch).sort().join(',')}`
    });
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
      [`${mode}FingerPose`]: captured.fingerPose,
      [`${mode}PosePresetId`]: captured.posePresetId,
      [`${mode}LibTvJointAngles`]: captured.libTvJointAngles,
      [`${mode}Transform`]: captured.transform,
      animationClip: undefined,
      error: undefined
    } as Partial<PoseTransition>, { label: mode === 'start' ? '设置起始姿势' : '设置结束姿势' });
    onError('');
  };

  const jumpToTransitionPose = (mode: 'start' | 'end') => {
    if (!character || !currentTransition) return;
    const pose = mode === 'start' ? currentTransition.startPose : currentTransition.endPose;
    const fingerPose = mode === 'start' ? currentTransition.startFingerPose : currentTransition.endFingerPose;
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
      fingerPose: cloneFingerPose(fingerPose),
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
    const merged = generateTransition(scene, {
      ...transition,
      actionPlan: resolveActionPlan(scene, transition.actionPrompt),
      updatedAt: new Date().toISOString()
    });
    patchTransition(transition.id, merged, { label: '生成姿势过渡' });
    onSelectTransition(transition.id);
    onError(merged.error || merged.warnings.join(' '));
  };

  const exitPosePreviewForEditing = () => {
    if (!character) return;
    onPreviewChange((current) => {
      if (!current.enabled || !current.transitionId) return current;
      const previewTransition = scene.poseTransitions.find((item) => item.id === current.transitionId);
      if (previewTransition?.characterId !== character.id) return current;
      return { ...current, playing: false, enabled: false };
    });
  };

  const updateCharacterPose = (patch: Partial<CharacterObject>) => {
    if (!character) return;
    exitPosePreviewForEditing();
    onUpdateObject('character', character.id, patch);
  };

  const applyPreset = (presetId: string) => {
    if (!character) return;
    if (presetId === 'custom') {
      updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined });
      return;
    }
    const preset = POSE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    updateCharacterPose({
      posePreset: presetId,
      posePresetId: presetId,
      libTvJointAngles: libTvJointAnglesForPresetId(presetId),
      poseRootOffset: preset.rootOffset || vec(),
      fingerPose: cloneFingerPose(preset.fingerPose),
      rigPose: clonePose(preset.pose)
    });
  };

  return (
    <div className="min-h-0 overflow-y-auto p-3 text-xs">
      {!selectedKind && (
        <Panel title="场景属性" icon={<Settings2 />}>
          <ColorField label="天空颜色" value={scene.background.color} onChange={(color) => onPatch({ background: { type: 'color', color } }, { label: '修改天空颜色', mergeKey: 'scene:background.color' })} />
          <SelectField label="画幅比例" value={scene.aspectRatio} options={SCENE_ASPECT_RATIOS} onChange={(aspectRatio) => onPatch({ aspectRatio }, { label: '修改画幅比例' })} />
          <ToggleRow label="地面" checked={scene.groundEnabled} onChange={(groundEnabled) => onPatch({ groundEnabled }, { label: groundEnabled ? '显示地面' : '隐藏地面' })} />
          <ToggleRow label="地面网格线" checked={scene.groundGridEnabled} onChange={(groundGridEnabled) => onPatch({ groundGridEnabled }, { label: groundGridEnabled ? '显示地面网格线' : '隐藏地面网格线' })} />
          <ToggleRow label="角色标签" checked={scene.characterLabelsEnabled} onChange={(characterLabelsEnabled) => onPatch({ characterLabelsEnabled }, { label: characterLabelsEnabled ? '显示角色标签' : '隐藏角色标签' })} />
          <ToggleRow label="构图参考线" checked={scene.compositionGuideEnabled} onChange={(compositionGuideEnabled) => onPatch({ compositionGuideEnabled }, { label: compositionGuideEnabled ? '显示构图参考线' : '隐藏构图参考线' })} />
          <ToggleRow label="网格吸附" checked={scene.gridSnapEnabled} onChange={(gridSnapEnabled) => onPatch({ gridSnapEnabled }, { label: gridSnapEnabled ? '开启网格吸附' : '关闭网格吸附' })} />
        </Panel>
      )}
      {character && (
        <Panel title="角色属性" icon={<UserRound />}>
          <Segmented
            value={characterTab}
            options={[
              { value: 'property', label: '属性' },
              { value: 'pose', label: '姿势' },
              { value: 'transition', label: '补间' }
            ]}
            onChange={(value) => setCharacterTab(value as PoseTab)}
          />
          {characterTab === 'property' && (
            <div className="space-y-2">
              <TextField label="名称" value={character.name} disabled={character.locked} onChange={(name) => onUpdateObject('character', character.id, { name })} />
              <SelectField
                label="性别"
                value={character.gender}
                options={['male', 'female']}
                labels={{ male: '男性', female: '女性' }}
                disabled={character.locked}
                onChange={(value) => {
                  const nextGender = value as CharacterGender;
                  const currentWasDefault = character.color === genderColor(character.gender);
                  onUpdateObject('character', character.id, {
                    gender: nextGender,
                    color: currentWasDefault ? genderColor(nextGender) : character.color,
                    scale: genderScale(nextGender),
                    model: { ...character.model, normalizedHeight: genderHeight(nextGender) }
                  });
                }}
              />
              <ColorField label="颜色" value={character.color} disabled={character.locked} onChange={(color) => onUpdateObject('character', character.id, { color })} />
              <VectorField label="位置" value={character.position} disabled={character.locked} onChange={(position) => onUpdateObject('character', character.id, { position })} />
              <VectorField label="旋转" value={character.rotation} disabled={character.locked} onChange={(rotation) => onUpdateObject('character', character.id, { rotation })} />
              <VectorField label="缩放" value={character.scale} min={0.1} max={4} step={0.05} disabled={character.locked} onChange={(scale) => onUpdateObject('character', character.id, { scale })} />
              <DeleteButton disabled={character.locked} onClick={onDeleteSelected} />
            </div>
          )}
          {characterTab === 'pose' && (
            <div className="space-y-3">
              <SelectField
                label="姿势预设"
                value={character.posePreset || 'stand'}
                options={[
                  ...(character.posePreset === 'custom' ? ['custom'] : []),
                  ...POSE_PRESETS.map((item) => item.id)
                ]}
                labels={{
                  custom: '自定义',
                  ...Object.fromEntries(POSE_PRESETS.map((item) => [item.id, item.label]))
                }}
                onChange={applyPreset}
              />
              <PoseField jointKey="pelvis" label="骨盆" value={character.rigPose.pelvis} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { pelvis: value }) })} />
              <PoseField jointKey="chest" label="胸腔" value={character.rigPose.chest} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { chest: value }) })} />
              <PoseField jointKey="neck" label="颈部" value={character.rigPose.neck} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { neck: value }) })} />
              <PoseField jointKey="head" label="头部" value={character.rigPose.head} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { head: value }) })} />
              <PoseField jointKey="leftUpperArm" label="左上臂" value={character.rigPose.leftUpperArm} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { leftUpperArm: value }) })} />
              <PoseField jointKey="leftLowerArm" label="左前臂" value={character.rigPose.leftLowerArm} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { leftLowerArm: value }) })} />
              <PoseField jointKey="leftHand" label="左手腕" value={character.rigPose.leftHand} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { leftHand: value }) })} />
              <PoseField jointKey="rightUpperArm" label="右上臂" value={character.rigPose.rightUpperArm} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { rightUpperArm: value }) })} />
              <PoseField jointKey="rightLowerArm" label="右前臂" value={character.rigPose.rightLowerArm} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { rightLowerArm: value }) })} />
              <PoseField jointKey="rightHand" label="右手腕" value={character.rigPose.rightHand} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { rightHand: value }) })} />
              <PoseField jointKey="leftUpperLeg" label="左大腿" value={character.rigPose.leftUpperLeg} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { leftUpperLeg: value }) })} />
              <PoseField jointKey="leftLowerLeg" label="左小腿" value={character.rigPose.leftLowerLeg} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { leftLowerLeg: value }) })} />
              <PoseField jointKey="leftFoot" label="左脚踝" value={character.rigPose.leftFoot} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { leftFoot: value }) })} />
              <PoseField jointKey="rightUpperLeg" label="右大腿" value={character.rigPose.rightUpperLeg} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { rightUpperLeg: value }) })} />
              <PoseField jointKey="rightLowerLeg" label="右小腿" value={character.rigPose.rightLowerLeg} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { rightLowerLeg: value }) })} />
              <PoseField jointKey="rightFoot" label="右脚踝" value={character.rigPose.rightFoot} disabled={character.locked} onChange={(value) => updateCharacterPose({ posePreset: 'custom', posePresetId: 'custom', libTvJointAngles: undefined, rigPose: patchPose(character.rigPose, { rightFoot: value }) })} />
            </div>
          )}
          {characterTab === 'transition' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-[10px] text-zinc-400">当前角色补间片段</div>
                <div className="space-y-1">
                  {characterTransitions.map((transition) => (
                    <button
                      key={transition.id}
                      type="button"
                      onClick={() => onSelectTransition(transition.id)}
                      className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left ${activeTransition?.id === transition.id ? 'border-violet-400/40 bg-violet-400/15 text-violet-100' : 'border-white/10 bg-black/20 text-zinc-200'}`}
                    >
                      <span className="truncate">{transition.name}</span>
                      <span className="text-[10px] text-zinc-400">{transition.durationSec.toFixed(1)} 秒</span>
                    </button>
                  ))}
                  {!characterTransitions.length && <div className="rounded-md border border-dashed border-white/10 bg-black/20 px-2 py-2 text-[11px] text-zinc-500">当前角色还没有补间片段。</div>}
                </div>
              </div>
              <button type="button" onClick={createTransition} className="h-8 w-full rounded-md border border-white/10 bg-white/5 text-zinc-200">新建补间片段</button>
              {currentTransition && (
                <>
                  <TextField label="片段名称" value={currentTransition.name} onChange={(name) => patchTransition(currentTransition.id, { name })} />
                  <TextField label="动作提示词" value={currentTransition.actionPrompt} onChange={(actionPrompt) => patchTransitionInput(currentTransition.id, { actionPrompt })} />
                  <NumberField label="时长（秒）" value={currentTransition.durationSec} min={0.2} max={10} step={0.1} onChange={(durationSec) => patchTransitionInput(currentTransition.id, { durationSec })} />
                  <SelectField label="插值曲线" value={currentTransition.curve} options={['linear', 'ease_in', 'ease_out', 'ease_in_out']} labels={{ linear: '线性', ease_in: '缓入', ease_out: '缓出', ease_in_out: '缓入缓出' }} onChange={(curve) => patchTransitionInput(currentTransition.id, { curve: curve as CurveType })} />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => saveCurrentPoseToTransition('start')} className="h-8 rounded-md border border-white/10 bg-white/5 text-zinc-200">设为起始姿势</button>
                    <button type="button" onClick={() => saveCurrentPoseToTransition('end')} className="h-8 rounded-md border border-white/10 bg-white/5 text-zinc-200">设为结束姿势</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => jumpToTransitionPose('start')} className="h-8 rounded-md border border-white/10 bg-black/20 text-zinc-300">跳到起始</button>
                    <button type="button" onClick={() => jumpToTransitionPose('end')} className="h-8 rounded-md border border-white/10 bg-black/20 text-zinc-300">跳到结束</button>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
                    <div className={`rounded border px-1 py-1 ${currentTransition.startPose ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-black/20 text-zinc-500'}`}>起始{currentTransition.startPose ? '已保存' : '未保存'}</div>
                    <div className={`rounded border px-1 py-1 ${currentTransition.endPose ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-black/20 text-zinc-500'}`}>结束{currentTransition.endPose ? '已保存' : '未保存'}</div>
                    <div className={`rounded border px-1 py-1 ${currentTransition.animationClip ? 'border-violet-400/30 bg-violet-400/10 text-violet-100' : 'border-white/10 bg-black/20 text-zinc-500'}`}>动画{currentTransition.animationClip ? '已生成' : '未生成'}</div>
                  </div>
                  <button type="button" onClick={resolveTransitionPlan} className="h-8 w-full rounded-md border border-white/10 bg-white/5 text-zinc-200">解析动作模板</button>
                  <button type="button" onClick={regenerateTransition} className="h-8 w-full rounded-md border border-violet-400/40 bg-violet-400/15 text-violet-100">生成姿势过渡</button>
                  <ToggleRow
                    label="头部看向当前机位"
                    checked={currentTransition.constraints.headLookAt.enabled}
                    onChange={(checked) => patchTransitionInput(currentTransition.id, {
                      constraints: {
                        ...currentTransition.constraints,
                        headLookAt: {
                          ...currentTransition.constraints.headLookAt,
                          enabled: checked,
                          targetMode: 'camera'
                        }
                      }
                    })}
                  />
                  <ToggleRow
                    label="手部目标约束"
                    checked={currentTransition.constraints.handTarget.enabled}
                    onChange={(checked) => patchTransitionInput(currentTransition.id, {
                      constraints: {
                        ...currentTransition.constraints,
                        handTarget: {
                          ...currentTransition.constraints.handTarget,
                          enabled: checked
                        }
                      }
                    })}
                  />
                  {currentTransition.constraints.handTarget.enabled && (
                    <>
                      <SelectField
                        label="作用手"
                        value={currentTransition.constraints.handTarget.hand}
                        options={['left', 'right']}
                        labels={{ left: '左手', right: '右手' }}
                        onChange={(hand) => patchTransitionInput(currentTransition.id, {
                          constraints: {
                            ...currentTransition.constraints,
                            handTarget: {
                              ...currentTransition.constraints.handTarget,
                              hand: hand as 'left' | 'right'
                            }
                          }
                        })}
                      />
                      <SelectField
                        label="目标对象"
                        value={currentTransition.constraints.handTarget.targetObjectId || ''}
                        options={['', ...scene.objects.props.map((item) => item.id), ...scene.objects.characters.filter((item) => item.id !== character.id).map((item) => item.id)]}
                        labels={{
                          '': '未选择',
                          ...Object.fromEntries(scene.objects.props.map((item) => [item.id, item.name])),
                          ...Object.fromEntries(scene.objects.characters.map((item) => [item.id, item.name]))
                        }}
                        onChange={(targetObjectId) => patchTransitionInput(currentTransition.id, {
                          constraints: {
                            ...currentTransition.constraints,
                            handTarget: {
                              ...currentTransition.constraints.handTarget,
                              targetMode: 'object',
                              targetObjectId: targetObjectId || undefined
                            }
                          }
                        })}
                      />
                    </>
                  )}
                  <ToggleRow
                    label="脚部锁定"
                    checked={currentTransition.constraints.footLock.enabled}
                    onChange={(checked) => patchTransitionInput(currentTransition.id, {
                      constraints: {
                        ...currentTransition.constraints,
                        footLock: { ...currentTransition.constraints.footLock, enabled: checked }
                      }
                    })}
                  />
                  <ToggleRow
                    label="关节限制"
                    checked={currentTransition.constraints.jointLimitsEnabled}
                    onChange={(checked) => patchTransitionInput(currentTransition.id, {
                      constraints: {
                        ...currentTransition.constraints,
                        jointLimitsEnabled: checked
                      }
                    })}
                  />
                  {currentTransition.actionPlan.templates.length > 0 && (
                    <div className="rounded-md border border-white/10 bg-black/20 p-2 text-[11px] text-zinc-300">
                      <div className="mb-1 text-zinc-400">已解析模板</div>
                      <div className="flex flex-wrap gap-1">
                        {currentTransition.actionPlan.templates.map((template) => (
                          <span key={template.id} className="rounded border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 text-violet-100">{template.label}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {currentTransition.error && <div className="rounded-md border border-red-400/25 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">{currentTransition.error}</div>}
                  {currentTransition.warnings.length > 0 && (
                    <div className="rounded-md border border-amber-400/25 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
                      {currentTransition.warnings.join(' ')}
                    </div>
                  )}
                  {currentTransition.animationClip && (
                    <div className="rounded-md border border-white/10 bg-black/20 p-2 text-[11px] text-zinc-300">
                      <div>动画片段：{currentTransition.animationClip.name}</div>
                      <div>时长：{currentTransition.animationClip.durationSec.toFixed(2)} 秒</div>
                      <div>轨道数：{currentTransition.animationClip.tracks.length}</div>
                      <div>采样帧：{currentTransition.animationClip.samples.length}</div>
                      <div>接触帧：{currentTransition.animationClip.contacts.length}</div>
                      {currentTransition.animationClip.contacts.length > 0 && (
                        <div className="mt-1 space-y-1 border-t border-white/10 pt-1">
                          {currentTransition.animationClip.contacts.slice(0, 5).map((contact, index) => (
                            <div key={`${contact.kind}-${contact.limb}-${contact.timeSec}-${index}`} className="flex justify-between gap-2 text-[10px] text-zinc-400">
                              <span className="truncate">{contact.note}</span>
                              <span>{contact.timeSec.toFixed(2)} 秒</span>
                            </div>
                          ))}
                          {currentTransition.animationClip.contacts.length > 5 && (
                            <div className="text-[10px] text-zinc-500">还有 {currentTransition.animationClip.contacts.length - 5} 个接触帧</div>
                          )}
                        </div>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => onPreviewChange((current) => ({ ...current, transitionId: currentTransition.id, playing: !current.playing, enabled: true }))} className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 text-zinc-200">
                          {preview.playing && preview.transitionId === currentTransition.id ? '暂停预览' : '播放预览'}
                        </button>
                        <button type="button" onClick={() => onPreviewChange((current) => ({ ...current, transitionId: currentTransition.id, currentTimeSec: 0, playing: false, enabled: true }))} className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 text-zinc-200">预览起点</button>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onPatch((current) => normalizeScene({
                      ...current,
                      poseTransitions: current.poseTransitions.filter((item) => item.id !== currentTransition.id),
                      activeTransitionId: current.activeTransitionId === currentTransition.id ? undefined : current.activeTransitionId
                    }), { label: '删除补间片段' })}
                    className="h-8 w-full rounded-md border border-red-500/25 bg-red-500/10 text-red-200"
                  >
                    删除补间片段
                  </button>
                  {previewSample && currentTransition.id === preview.transitionId && (
                    <button
                      type="button"
                      onClick={() => onPatch((current) => applyPreviewFrameToScene(current, currentTransition.id, previewSample), { label: '写回当前预览帧' })}
                      className="h-8 w-full rounded-md border border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                    >
                      写回当前预览帧
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </Panel>
      )}
      {prop && (
        <Panel title="道具属性" icon={<Box />}>
          <TextField label="名称" value={prop.name} disabled={prop.locked} onChange={(name) => onUpdateObject('prop', prop.id, { name })} />
          <SelectField label="形状" value={prop.shape} options={['box', 'sphere', 'cylinder']} labels={{ box: '方体', sphere: '球体', cylinder: '圆柱' }} disabled={prop.locked} onChange={(shape) => onUpdateObject('prop', prop.id, { shape })} />
          <ColorField label="颜色" value={prop.color} disabled={prop.locked} onChange={(color) => onUpdateObject('prop', prop.id, { color })} />
          <VectorField label="位置" value={prop.position} disabled={prop.locked} onChange={(position) => onUpdateObject('prop', prop.id, { position })} />
          <VectorField label="旋转" value={prop.rotation} disabled={prop.locked} onChange={(rotation) => onUpdateObject('prop', prop.id, { rotation })} />
          <VectorField label="缩放" value={prop.scale} min={0.05} max={8} step={0.05} disabled={prop.locked} onChange={(scale) => onUpdateObject('prop', prop.id, { scale })} />
          <DeleteButton disabled={prop.locked} onClick={onDeleteSelected} />
        </Panel>
      )}
      {camera && (
        <Panel title="机位属性" icon={<Camera />}>
          <TextField label="名称" value={camera.name} disabled={camera.locked} onChange={(name) => onUpdateObject('camera', camera.id, { name })} />
          <VectorField label="位置" value={camera.position} disabled={camera.locked} onChange={(position) => onUpdateObject('camera', camera.id, { position })} />
          <VectorField label="注视点" value={camera.targetPosition} disabled={camera.locked} onChange={(targetPosition) => onUpdateObject('camera', camera.id, { targetPosition })} />
          <NumberField label="FOV" value={camera.fov} min={18} max={100} disabled={camera.locked} onChange={(fov) => onUpdateObject('camera', camera.id, { fov })} />
          <button type="button" onClick={() => onPatch({ activeCameraId: camera.id, activeViewMode: 'camera' }, { history: false })} className="h-8 rounded-md border border-cyan-400/30 bg-cyan-400/10 text-cyan-100">切换到该机位</button>
          <DeleteButton disabled={camera.locked} onClick={onDeleteSelected} />
        </Panel>
      )}
      {light && (
        <Panel title="灯光属性" icon={<Lightbulb />}>
          <TextField label="名称" value={light.name} disabled={light.locked} onChange={(name) => onUpdateObject('light', light.id, { name })} />
          <SelectField label="类型" value={light.lightType} options={['ambient', 'directional', 'point']} labels={{ ambient: '环境光', directional: '方向光', point: '点光' }} disabled={light.locked} onChange={(lightType) => onUpdateObject('light', light.id, { lightType })} />
          <ColorField label="颜色" value={light.color} disabled={light.locked} onChange={(color) => onUpdateObject('light', light.id, { color })} />
          <NumberField label="强度" value={light.intensity} min={0} max={8} step={0.1} disabled={light.locked} onChange={(intensity) => onUpdateObject('light', light.id, { intensity })} />
          <VectorField label="位置" value={light.position} disabled={light.locked} onChange={(position) => onUpdateObject('light', light.id, { position })} />
          <DeleteButton disabled={light.locked} onClick={onDeleteSelected} />
        </Panel>
      )}
    </div>
  );
}

function MiniTimeline({
  transition,
  preview,
  onPreviewChange,
  onWriteCurrentPose
}: {
  transition: PoseTransition | null;
  preview: PreviewState;
  onPreviewChange: React.Dispatch<React.SetStateAction<PreviewState>>;
  onWriteCurrentPose: () => void;
}) {
  if (!transition) {
    return (
      <div className="flex h-12 items-center justify-between border-t border-white/10 bg-black/20 px-3 text-[11px] text-zinc-500">
        <span>动作时间轴</span>
        <span>请选择角色并创建补间片段。</span>
      </div>
    );
  }
  const duration = transition.animationClip?.durationSec || transition.durationSec;
  const currentTime = Math.min(preview.currentTimeSec, duration);
  const canPreview = Boolean(transition.animationClip);
  return (
    <div className="flex h-14 items-center gap-3 border-t border-white/10 bg-black/20 px-3 text-[11px]">
      <div className="w-[180px] truncate text-zinc-200">{transition.name}</div>
      <button
        type="button"
        disabled={!canPreview}
        onClick={() => onPreviewChange((current) => ({ ...current, transitionId: transition.id, playing: !current.playing, enabled: true }))}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-200 disabled:opacity-40"
        title={canPreview ? '播放或暂停预览' : '请先生成姿势过渡'}
      >
        {preview.playing && preview.transitionId === transition.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button type="button" onClick={() => onPreviewChange((current) => ({ ...current, transitionId: transition.id, currentTimeSec: 0, playing: false, enabled: true }))} className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-200">
        <RotateCcw className="h-4 w-4" />
      </button>
      <div className="relative flex flex-1 items-center">
        <div className="pointer-events-none absolute left-0 top-1/2 h-3 w-px -translate-y-1/2 bg-emerald-300/70" />
        <div className="pointer-events-none absolute right-0 top-1/2 h-3 w-px -translate-y-1/2 bg-rose-300/70" />
        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={currentTime}
          disabled={!canPreview}
          onChange={(event) => onPreviewChange((current) => ({ ...current, transitionId: transition.id, currentTimeSec: Number(event.target.value), playing: false, enabled: true }))}
          className="w-full accent-violet-400 disabled:opacity-40"
        />
      </div>
      <span className="w-[78px] text-right text-zinc-400">{currentTime.toFixed(2)} / {duration.toFixed(2)} 秒</span>
      <label className="flex items-center gap-1 text-zinc-300">
        <input type="checkbox" checked={preview.loop} onChange={(event) => onPreviewChange((current) => ({ ...current, loop: event.target.checked }))} className="accent-violet-400" />
        循环
      </label>
      <button type="button" disabled={!canPreview} onClick={onWriteCurrentPose} className="h-8 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 text-cyan-100 disabled:opacity-40">写回当前帧</button>
      <button type="button" onClick={() => onPreviewChange((current) => ({ ...current, transitionId: undefined, currentTimeSec: 0, playing: false, enabled: false }))} className="h-8 rounded-md border border-white/10 bg-white/5 px-2 text-zinc-300">退出预览</button>
    </div>
  );
}

function ObjectSection({
  title,
  icon,
  onAdd,
  children
}: {
  title: string;
  icon: React.ReactNode;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-zinc-300">
        <span className="flex items-center gap-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}{title}</span>
        <button type="button" onClick={onAdd} className="rounded border border-white/10 bg-white/5 p-0.5"><Plus className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-1">{children}</div>
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
  active,
  disabled,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
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
      {label}
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
  disabled,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-zinc-400">{label}</span>
      <input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="h-7 w-full rounded-md border border-white/10 bg-black/30 px-2 text-[11px] text-white disabled:opacity-45" />
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
  disabled,
  onChange
}: {
  label: string;
  value: Vec3;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: Vec3) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-zinc-400">{label}</div>
      <div className="grid grid-cols-3 gap-1">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <label key={axis} className="flex h-7 items-center gap-1 rounded-md border border-white/10 bg-black/30 px-1">
            <span className="text-[10px] text-zinc-500">{axis.toUpperCase()}</span>
            <input type="number" value={Number.isFinite(value[axis]) ? value[axis] : 0} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange({ ...value, [axis]: Number(event.target.value) })} className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none disabled:opacity-45" />
          </label>
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
  onChange
}: {
  jointKey: PoseJointKey;
  label: string;
  value: RigRotation;
  disabled?: boolean;
  onChange: (value: RigRotation) => void;
}) {
  const limits = JOINT_LIMITS[jointKey];
  const updateAxis = (axis: keyof RigRotation, raw: number) => {
    const [min, max] = limits[axis];
    const next = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : 0;
    onChange({ ...value, [axis]: next });
  };
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      <div className="flex items-center justify-between text-[10px] text-zinc-400">
        <span>{label}</span>
        <span className="text-zinc-500">XYZ 旋转</span>
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
              value={Number.isFinite(value[axis]) ? value[axis] : 0}
              disabled={disabled}
              onChange={(event) => updateAxis(axis, Number(event.target.value))}
              className="w-full accent-violet-400 disabled:opacity-40"
            />
            <input
              type="number"
              min={limits[axis][0]}
              max={limits[axis][1]}
              step={1}
              value={Number.isFinite(value[axis]) ? value[axis] : 0}
              disabled={disabled}
              onChange={(event) => updateAxis(axis, Number(event.target.value))}
              className="h-6 min-w-0 rounded border border-white/10 bg-black/30 px-1 text-right text-[10px] text-white outline-none disabled:opacity-45"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function DeleteButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="h-8 rounded-md border border-red-500/25 bg-red-500/10 text-xs text-red-200 disabled:opacity-40">
      <Trash2 className="mr-1 inline h-3.5 w-3.5" />
      删除对象
    </button>
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
