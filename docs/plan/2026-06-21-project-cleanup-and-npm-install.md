# Project Cleanup And Npm Install Plan

## Scope

- Run `npm install` for the current workspace and record the dependency audit result.
- Clean only ignored development artifacts that are already covered by the project cleanup script.
- Remove low-risk frontend duplication in the current image and video generator nodes.
- Fix obvious source noise that does not change runtime behavior.

## Non-Goals

- Do not remove `node_modules`; the user explicitly asked to run npm install.
- Do not delete uploads, storage, backups, database dumps, migrations, smoke scripts, docs, or compatibility fields.
- Do not remove `custom_url`, `custom_key`, or `use_custom_api` from types or payloads in this pass; those fields still protect legacy node compatibility and backend rejection paths.
- Do not change Prisma schema, queue contracts, workflow execution behavior, permissions, or model center behavior.
- Do not add new dependencies.
- Do not migrate the self-built DOM/SVG canvas to any other canvas stack.

## Current Findings

- `npm install --offline` completed successfully during the first attempt because the online escalation request was blocked by the approval service.
- The dependency tree was already up to date and npm reported `0 vulnerabilities`.
- React Flow, `@xyflow/react`, and ELK are absent from active source and package manifests; remaining mentions are standards and plan history.
- `dist/` and `node_modules/` are ignored by `.gitignore`; `dist/` is a safe build artifact and `node_modules/` should stay.
- `apps/web/src/components/flow/ImageGeneratorNode.tsx` and `apps/web/src/components/flow/VideoGeneratorNode.tsx` duplicate workflow status polling and media asset ID parsing.
- Several large files exceed the 800-line target, but broad splitting needs feature-specific plans to avoid destabilizing active behavior.

## Planned Cleanup

- Run normal `npm install` now that network access is available.
- Run `npm run clean` without `-IncludeUserData` to remove safe ignored dev artifacts such as `dist/`.
- Upgrade direct dependency `undici` within the existing 8.x line if npm audit reports an unexpected high severity issue.
- Add a small shared flow utility for:
  - workflow task status payload typing,
  - media asset ID extraction from `/api/media/assets/:id/stream`,
  - generated media workflow status application,
  - task polling with missing-status and timeout handling.
- Replace duplicated image/video generator polling code with the shared helper.
- Fix the broken encoding in the Vite config comment.

## Database Impact

None. No schema, migration, Prisma model, seed, or database data change.

## Permission Impact

None. No role, session, route guard, media permission, or model center permission change.

## Security Risks

- Low risk: shared polling helpers must not expose API keys, provider URLs, Authorization headers, or raw provider responses.
- `custom_key` compatibility fields remain guarded by the existing backend rejection path and are not removed in this pass.
- No ordinary-user API Key or API URL UI is added.

## Validation Commands

- `npm install`
- `npm run clean`
- `npm run lint`
- `npm run build`
- `git status --short`

## Browser Verification

No browser verification is required for this pass unless the shared helper changes visible behavior. This cleanup does not change layout, controls, routes, or rendered node UI. If lint/build reveal behavior-affecting changes, reopen `http://localhost:3001/pipeline` and check console/DOM.

## Rollback

- Revert the new shared utility and restore duplicated polling blocks in `ImageGeneratorNode.tsx` and `VideoGeneratorNode.tsx`.
- Revert the Vite config comment edit.
- Rebuild if `dist/` is needed again locally.

## Results

- Ran normal `npm install`; dependency tree was up to date, then npm audit reported 3 findings.
- Ran `npm run clean`; removed `dist/` and preserved uploads, storage, backups, and database dumps.
- Upgraded `undici` from the vulnerable 8.4.x range to `^8.5.0`, which removed the unexpected high severity npm audit finding.
- Left the known `exceljs -> uuid` moderate findings in place because the project audit script explicitly accepts that path and npm's proposed fix downgrades `exceljs` across a major boundary.
- Added `apps/web/src/components/flow/workflowNodeUtils.ts` for shared workflow task polling, generated media status handling, and media asset ID parsing.
- Removed duplicated polling/status code from `ImageGeneratorNode.tsx` and `VideoGeneratorNode.tsx`.
- Fixed a broken encoding comment in `apps/web/vite.config.ts`.
- Did not remove `custom_url`, `custom_key`, or `use_custom_api`; they remain active compatibility and backend rejection fields.

## Verification Results

- `npm install` passed.
- `npm run clean` passed.
- `npm run security:audit` passed with accepted `exceljs` and `uuid` findings only.
- `npm run lint` passed.
- `npm run build` passed.
- Browser verification was not run because this pass did not change visible layout, controls, routes, or rendered node UI.

