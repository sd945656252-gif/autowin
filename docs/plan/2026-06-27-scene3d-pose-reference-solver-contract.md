# Scene3D Pose Reference Solver Contract

## Scope

Add the first real contract for converting character pose reference images into a structured Scene3D rig pose.

This step does not fabricate pose values. If no pose estimation provider is configured, the backend returns a clear not-configured error and the node UI displays that error.

## Implementation

- Add a Scene3D pose reference request schema to the workflow API.
- Add `POST /api/workflow/scene3d/solve-pose-reference`.
- Validate reference images, selected character, current rig pose, and joint axis profile.
- Return only validated solver output when a real provider is available.
- In the Scene3D node pose panel, add a compact `解析姿势` action, loading state, success/error status, and no automatic pose overwrite.

## Non-goals

- No mocked rig pose.
- No fake progress.
- No auto-apply to the character skeleton until validated solver output exists.
