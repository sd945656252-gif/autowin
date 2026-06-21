# Node Code Contract Foundation Plan

## Scope

- Add a shared TypeScript/Zod node contract for the existing self-built workflow canvas.
- Keep existing `CanvasNode` compatibility while making the supported node type list explicit.
- Register active executable contracts for current image and video generator nodes.
- Reserve non-executable contract entries for future `panorama`, `scene3d`, `voice`, and `music` nodes.
- Make `/api/workflow/execute` resolve node capability and executable support through the shared contract instead of duplicated string checks.
- Add a focused unit test for the contract registry.

## Non-Goals

- Do not implement panorama, scene3d, voice, or music nodes in this pass.
- Do not modify Prisma schema or add new `ModelCapability` enum values.
- Do not create a second node system or migrate away from the self-built DOM/SVG canvas.
- Do not add dependencies.
- Do not change provider adapters, queues, workers, media upload, production asset review, or model center UI.
- Do not expose API Key / API URL to ordinary users.

## Existing Implementation Notes

- Frontend `CanvasNode.type` is currently a broad string for backward compatibility.
- Backend workflow execution currently supports `image_generator` and `video_generator`.
- `WorkflowRun` and `WorkflowNodeRun` already exist in Prisma, but current execution mainly updates `WorkflowRun`.
- `ModelCapability` currently supports `TEXT_GENERATOR`, `IMAGE_GENERATOR`, and `VIDEO_GENERATOR`.
- `workflow-schema.service.ts` already redacts sensitive workflow state keys.

## Planned Code Changes

- Add `apps/shared/src/workflow/node-contracts.ts` as a shared source of truth.
- Define:
  - `WorkflowNodeType`
  - `WorkflowNodeStage`
  - `WorkflowNodeModelCapability`
  - `WorkflowArtifactType`
  - `WorkflowNodeDefinition`
  - input/output slot schemas
  - execution contract schema
- Export helpers:
  - `getWorkflowNodeDefinition`
  - `requireWorkflowNodeDefinition`
  - `listWorkflowNodeDefinitions`
  - `listExecutableWorkflowNodeTypes`
  - `getWorkflowNodeRequiredCapability`
  - `isExecutableWorkflowNodeType`
- Update frontend types to reference shared contract types without breaking legacy string values.
- Update backend workflow execution route to reject unsupported or planned-only node types before creating new runs.
- Add unit tests under `tests/unit`.

## Database Impact

None. No Prisma model, enum, migration, seed, or stored data changes.

## Permission Impact

None. Existing route auth and model center permissions remain in place.

## Security Risks

- The contract must explicitly mark inline secrets as forbidden for executable nodes.
- Future node types must remain non-executable until they have real backend validation, queue/worker behavior, asset output, and failure reporting.
- Ordinary-user API Key / API URL visibility must remain unchanged.

## Validation Commands

- `npm run test:unit`
- `npm run lint`
- `npm run build`

## Browser Verification

No browser verification is required for this pass because there is no visible UI change. Future node UI work must verify `/pipeline` in browser with console/DOM/screenshot.

## Rollback

- Remove `apps/shared/src/workflow/node-contracts.ts`.
- Revert workflow execution route back to direct node type checks.
- Revert frontend type imports.
- Remove the new unit test.

## Results

- Added `apps/shared/src/workflow/node-contracts.ts` as the shared node contract registry.
- Registered current active executable node types:
  - `image_generator`
  - `video_generator`
- Registered planned-only node types:
  - `script`
  - `shot`
  - `panorama`
  - `scene3d`
  - `voice`
  - `music`
  - `editing`
  - `export`
- Added explicit artifact types for image, video, panorama view, scene JSON, camera metadata, reference frame, voice audio, music audio, subtitle timeline, audio timeline metadata, editing timeline, and exported video.
- Updated frontend `CanvasNode.type`, `ProductionStage`, and model capability-facing types to reference the shared contract while keeping legacy string compatibility.
- Updated `/api/workflow/execute` to reject unsupported or planned-only node types before creating `WorkflowRun`.
- Kept future node execution disabled until each node has backend validation, queue/worker behavior, asset/artifact writeback, and failure reporting.
- Added unit coverage for registry uniqueness, executable node list, and backend execution guarantees.

## Verification Results

- `npm run test:unit` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm run workflow:smoke:production-assets` was attempted but blocked before exercising the workflow by missing `DATABASE_URL` in the local environment.
- Browser verification was not run because there was no visible UI change.

