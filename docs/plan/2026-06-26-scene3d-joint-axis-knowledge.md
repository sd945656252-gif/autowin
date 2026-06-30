# 3D Director Joint Axis Knowledge Plan

## Goal

Build the 3D director motion solver around a persistent joint-axis knowledge base instead of asking the AI model to invent motion frames directly.

The current node controls 16 logical joints:

- pelvis, chest, neck, head
- leftUpperArm, leftLowerArm, leftHand
- rightUpperArm, rightLowerArm, rightHand
- leftUpperLeg, leftLowerLeg, leftFoot
- rightUpperLeg, rightLowerLeg, rightFoot

## Current Finding

`apps/web/public/models/x-bot.glb` is a glTF 2.0 skinned character with 65 skin joints. The logical joints map to Mixamo-style bones such as:

- `mixamorig:Hips`
- `mixamorig:Spine`, `mixamorig:Spine1`, `mixamorig:Spine2`
- `mixamorig:Neck`, `mixamorig:Head`
- `mixamorig:LeftArm`, `mixamorig:LeftForeArm`, `mixamorig:LeftHand`
- `mixamorig:RightArm`, `mixamorig:RightForeArm`, `mixamorig:RightHand`
- `mixamorig:LeftUpLeg`, `mixamorig:LeftLeg`, `mixamorig:LeftFoot`
- `mixamorig:RightUpLeg`, `mixamorig:RightLeg`, `mixamorig:RightFoot`

In the current node implementation, UI rotations are degrees in `XYZ` order and are applied as local delta quaternions:

```ts
bone.quaternion.copy(rest).multiply(delta)
```

This means every action plan should output structured local joint deltas, not vague pose descriptions.

## Phase 1: Node-Local Knowledge Profile

Done in the node file as the first stable source:

- Add `Scene3DJointAxisProfile`.
- Store it under `scene3dState.jointAxisProfile`.
- Keep compatibility by defaulting old scenes to `mixamo-xbot` profile.
- Include actual GLB bone names, logical parent joints, per-axis ranges, axis effects, and semantic roles.

This keeps the data saved with workflow/node persistence without adding a parallel backend truth source too early.

## Phase 2: Solver Consumption

Next, update motion solving so AI produces intent only:

1. Parse prompt into motion intent.
2. Resolve intent into action primitives.
3. Convert primitives into joint deltas using `jointAxisProfile`.
4. Generate root trajectory with contact planning.
5. Apply foot locks, joint limits, quaternion smoothing, and endpoint snapping.
6. Inspect quality and report unresolved issues.

The AI model should not be responsible for directly calculating every joint frame. It should choose intent, timing, contacts, direction, and emphasis; deterministic code should compile the animation.

## Phase 3: Backend/Database Persistence

Only after Phase 1 and Phase 2 are stable, add backend persistence:

- Prisma table for rig profiles, keyed by `rigId` and `version`.
- API endpoints:
  - `GET /api/scene3d/rig-profiles/:rigId`
  - `PUT /api/scene3d/rig-profiles/:rigId` for admin/developer updates
- Migration path:
  - Existing node scenes keep embedded `jointAxisProfile`.
  - New scenes can hydrate from backend profile, then embed a versioned snapshot into node state for portability.

This preserves portability: the node can still be moved to another project with its profile snapshot, while the host app may also maintain canonical profiles.

## References Used

- Three.js `Object3D` local position/rotation/quaternion model.
- Three.js `Skeleton` bone hierarchy model.
- glTF skinning model: joints and inverse bind matrices.

