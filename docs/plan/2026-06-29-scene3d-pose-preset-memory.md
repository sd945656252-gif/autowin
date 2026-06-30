# Scene3D Pose Preset Memory

## Goal

Add a persistent pose preset memory point to the Scene3D director node.

Users can enter a preset adjustment mode, manually tune the current character pose in real time with the existing joint controls, then save the tuned pose as the durable override for the selected preset. Later, selecting that preset applies the saved override from the backend.

## Scope

- Keep changes inside the Scene3D node and the existing Scene3D reusable asset API.
- Do not add a parallel pose preset library.
- Store user overrides as backend `ProductionAsset` JSON using the existing `/api/workflow/scene3d/assets` route.
- Preserve current UI preview and manual joint controls.

## Contract

New reusable asset kind: `posePresetMemory`.

Payload:

- `presetId`
- `rigPose`
- optional `bonePose`
- optional `fingerPose`
- optional `toePose`
- optional `rootOffset`
- `characterModel`
- `savedAt`

Frontend behavior:

- Load saved pose preset memories for the current project/node when the director opens.
- Applying a preset checks backend memory first, then falls back to built-in presets.
- The adjustment button marks the current preset as editable and switches to custom live edits.
- Save writes the current pose snapshot to the backend and updates the in-memory override map.

## Verification

- Run `npm.cmd run lint`.
- Browser verification should confirm the control appears and selecting a saved preset uses the saved override.
