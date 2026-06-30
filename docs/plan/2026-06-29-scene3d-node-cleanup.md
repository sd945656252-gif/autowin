# Scene3D Node Cleanup Plan

## Scope

Only clean the Scene3D director node and the minimal backend/API persistence contracts it already uses. Do not refactor the canvas, unrelated nodes, routing, or project-wide architecture.

The node is intentionally portable and mostly self-contained, so cleanup should first reduce internal duplication before moving code into shared files.

## Current Problems

- Pose presets have multiple sources of truth: raw RunningHub/Mixamo values, converted runtime presets, XBot foundation presets, saved preset memories, scene overrides, and live character state.
- Some old preset definitions remain in the file even when they no longer drive the selected preset.
- Debug/reference UI grew alongside production controls, making the right panel harder to read.
- Persistence concepts are overloaded: saved memory currently behaves both like a reusable asset and like a preset override.
- The file is large enough that safe changes need smaller internal sections and clear ownership boundaries.

## Cleanup Phases

1. Remove proven dead code
   - Delete unused types, old preset constants, and unused text maps.
   - Keep behavior unchanged.
   - Verify with lint.

2. Clarify pose preset ownership
   - Replace parallel preset resolution with one explicit runtime preset resolver.
   - Make the priority order visible in code: scene override, saved memory, default preset, custom.
   - Stop adding new parallel preset tables for one-off fixes.

3. Simplify memory persistence
   - Treat saved preset memory as the replacement data for that preset.
   - Keep one payload shape for `rigPose`, `bonePose`, `fingerPose`, `toePose`, `rootOffset`, and model info.
   - Keep backend validation compatible with old scene data.

4. Reduce right-panel noise
   - Remove or collapse diagnostic-only sections that do not help users edit the node.
   - Keep pose reference upload, pose editing, memory save/load, and error feedback.

5. Extract only stable adapter boundaries
   - If the node is later moved to another project, extract backend API calls and canvas adapters behind small functions.
   - Do not split core node behavior into many business files unless the node portability contract is preserved.

## First Cleanup Completed

- Removed the unused `ResolvedPosePreset` type.
- Removed obsolete `XBOT_WALK_PRESET`, `XBOT_RUN_PRESET`, and `XBOT_SQUAT_PRESET`.
- Removed the unused `FOUNDATION_POSE_INTENTS` map.
- Kept `XBOT_SIT_PRESET` and `XBOT_SQUAT_FULL_BODY_PRESET` because they still participate in current pose/reference behavior.

## Second Cleanup Completed

- Removed the old RunningHub-vs-XBot preset priority set.
- Replaced scattered preset priority checks with `POSE_PRESET_OVERRIDES` plus the default `POSE_PRESETS` table.
- Added `resolvePosePresetState()` as the single read path for a selected preset in interactive UI code.
- Added `posePatchFromPresetState()` so selecting a preset, auto-applying memory, and saving memory all apply the same character patch shape.
- Kept scene normalization compatibility code in place so old workflows still load.

## Third Cleanup Completed

- Connected `normalizeScene()` to `resolvePosePresetState()` for pose memory lookup.
- Kept legacy normalization logic for old workflow data, including legacy pose fields and old finger-bone-to-bone-pose migration.
- Renamed the normalized memory variable to `presetMemoryPayload` so it is not confused with a default preset.
- Verified the change with TypeScript lint.

## Fourth Cleanup Completed

- Restored `Scene3DNode.tsx` after a broken rewrite left several JSX strings malformed.
- Repaired the character transition panel while keeping its production controls: transition list, start/end pose capture, AI solve/generate, constraints, clip summary, quality fixes, preview, write-back, and delete.
- Removed the right-panel-only motion timeline debug component.
- Removed unused pose landmark diagnostics helpers that remained after the diagnostic panel was deleted.
- Verified the change with TypeScript lint.

## Fifth Cleanup Completed

- Cleaned mojibake user-facing text in the Scene3D node without changing pose values or execution logic.
- Fixed visible labels for RunningHub pose presets, finger/toe/joint controls, camera lens types, default objects, pose memory, pose reference images, motion quality warnings, and history labels.
- Fixed two AI motion note template strings so saved notes interpolate the AI intent and generated motion prompt correctly.
- Verified the change with TypeScript lint.

## Sixth Cleanup Completed

- Added internal section markers to `Scene3DNode.tsx` so the single portable node file has clearer ownership boundaries without splitting node logic across business files.
- Kept behavior unchanged while grouping data model, static constants, pose helpers, preset resolution, rig metadata, backend adapters, React shell, viewport, panels, pose-reference UI, and form primitives.
- Moved the pose-reference view options into the static constants section and removed the duplicate lower definition.
- Repaired the last remaining `????` placeholder error/status text for screenshot upload, WebGL capture, AI motion resolve, imported-model loading, and transition pose write-back.
- Verified the change with TypeScript lint.

## Seventh Cleanup Completed

- Added one shared memory-write path for pose presets: `sceneWithPosePresetMemory()` writes the saved payload into both scene memory tables and applies the same resolved preset patch to the active character.
- Added `sceneWithPosePresetMemories()` so backend-loaded memories are merged through the same payload normalization path instead of rebuilding payload maps inline.
- Replaced the duplicated memory merge code in memory refresh and memory save handlers with the shared helpers.
- Kept preset numeric values and runtime pose application unchanged.
- Verified the change with TypeScript lint.

## Eighth Cleanup Completed

- Restored missing Scene3D protocol declarations, pose preset helpers, clone/normalize helpers, and timeline UI helpers after the single node file became partially corrupted.
- Kept the work inside `Scene3DNode.tsx` so the node remains portable and self-contained.
- Cleaned the remaining visible mojibake labels in camera templates, prop/light defaults, screenshot errors, history labels, and add/delete actions.
- Kept pose preset numeric values unchanged during this repair pass.
- Verified the change with TypeScript lint.

## Ninth Cleanup Completed

- Added `posePresetMemoryMapFromSource()` and `mergePosePresetMemorySources()` so scene memories, override memories, and backend-loaded memories are merged through one helper.
- Simplified `resolvePosePresetState()` so it only resolves a preset from the merged memory source plus the default preset table.
- Fixed the pose preset memory replacement path: saving a memory point now writes the memory, switches the edited character back to the overwritten preset id, applies the saved pose payload immediately, and stamps `poseMemoryAppliedAt`.
- Kept pose preset numeric values unchanged.
- Verified the change with TypeScript lint.

## Tenth Cleanup Completed

- Tightened the live pose edit path so slider-driven rig/finger/toe edits go through `patchScene()` and keep `latestSceneRef` synchronized before persistence.
- Cleared the delayed pose-edit commit timer before saving a memory point, preventing save from reading a stale character pose immediately after manual slider adjustments.
- Attempted real browser verification, but the local Podman machine could not start: `machine did not transition into running state: ssh error: machine not in running state`.
- Verified the code change with TypeScript lint.

## Next Recommended Step

Continue tightening the single-file Scene3D node by grouping related helpers internally and removing remaining duplication in small, lint-verified batches, without changing the canvas adapter or node behavior.
