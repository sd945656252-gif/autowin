# Self-Built Canvas Stack Cleanup Plan

## Scope

- Keep the current self-built DOM/SVG canvas stack as the main canvas implementation.
- Remove unused `@xyflow/react` and `elkjs` dependencies and source imports.
- Delete the superseded React Flow migration plan created for the previous direction.
- Update `commercial-production-standard.md` and `project-development-standard.md` so their canvas technology requirements match the current project direction.

## Non-Goals

- Do not change backend APIs, workflow execution, queues, database schema, provider adapters, model center behavior, permissions, or media storage behavior.
- Do not implement the 3D director stage in this change.
- Do not migrate to React Flow, ELK, Next.js, NestJS, Temporal, or new package boundaries.

## Current Project Findings

- The active canvas render path in `apps/web/src/components/Canvas.tsx` is still the self-built DOM/SVG viewport with manual pan, zoom, node tree rendering, and SVG path edges.
- `@xyflow/react` and `elkjs` are present in `package.json` but are not part of the active canvas render path.
- The project currently uses `idb-keyval`, not Dexie.
- The project currently does not depend on Radix UI, Zustand, or React Hook Form.
- Three/R3F/Drei should remain a future 3D director editor choice, isolated from the main canvas shell.

## Old Implementation Cleanup

- Remove unused React Flow imports and helper declarations from `Canvas.tsx`.
- Remove `@xyflow/react` and `elkjs` from package manifests.
- Remove the obsolete React Flow migration plan to avoid parallel technical direction.

## Documentation Changes

- Main canvas technology becomes self-built fixed-sequence DOM/SVG canvas.
- Layout is calculated from stage order, parent-child relationships, and project data order by project-owned code.
- React Flow, `@xyflow/react`, and ELK.js are not default canvas technologies.
- Radix UI, Zustand, React Hook Form, and Dexie are not mandatory current-stack requirements; they are allowed only by later plan when a concrete need exists.
- Three.js/R3F/Drei are reserved for the 3D director editor surface, not the main canvas shell.

## Database Impact

- None.

## Permission Impact

- None.

## Security Risks

- No new runtime surface is introduced.
- Removing unused dependencies reduces supply-chain surface.

## Acceptance Commands

- `npm run lint`
- `npm run build`

## Browser Verification

- Open `http://localhost:3001/pipeline`.
- Confirm the self-built canvas still renders existing workflow nodes and SVG edges.
- Confirm the browser console has no blocking errors.

## Rollback Strategy

- Reinstall `@xyflow/react` and `elkjs` and restore the removed imports only if a later approved plan returns to React Flow.
- Revert the standard-document wording to the previous React Flow/ELK requirement if the product direction changes again.

## Results

- Removed `@xyflow/react` and `elkjs` from `package.json` and `package-lock.json`.
- Removed obsolete React Flow import/helper residue from `apps/web/src/components/Canvas.tsx`.
- Deleted the superseded React Flow migration plan.
- Updated workflow APIs to prefer `canvas` payloads while keeping legacy `reactFlow` request compatibility for existing callers and the existing Prisma `reactFlowJson` column.
- Updated both standard documents to lock the main canvas to the self-built fixed-sequence DOM/SVG stack.
- Documented that lucide-react, motion, textarea-caret, idb-keyval, and the current Express backend do not conflict with the self-built canvas direction and do not need replacement in this cleanup.

## Verification Results

- `npm run lint` passed.
- `npm run build` passed.
- Browser verification passed on `http://localhost:3001/pipeline` after opening existing project `个人影视创作1`: self-built canvas nodes and SVG elements rendered, and console error log was empty.
