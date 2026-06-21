# Dead Code Cleanup And Stack Recommendations Plan

## Scope

- Remove only code that is provably obsolete, unused, or contradictory to the project standards.
- Keep active product behavior, database schema, permissions, queues, migrations, and public routes intact unless a path is clearly fake/mock/deprecated.
- After cleanup, summarize which technologies, skills, MCP tools, tool calls, or dependencies should be added later and wait for user confirmation before adding anything.

## Non-Goals

- Do not add new dependencies in this pass.
- Do not migrate frameworks.
- Do not change database schema.
- Do not remove smoke scripts, migrations, docs, or compatibility fields unless they are provably orphaned and safe to delete.
- Do not remove legacy compatibility code that still protects existing data.

## Cleanup Rules

- Delete only high-confidence dead or forbidden code.
- For uncertain candidates, report them instead of deleting them.
- Keep ordinary-user API Key and API URL fields out of user-facing flows.
- Run TypeScript and build verification after cleanup.

## Findings

- Current stack remains React 19, Vite 6, TypeScript, Tailwind CSS 4, Express, Prisma, PostgreSQL, Redis/BullMQ, WebSocket, and self-built DOM/SVG canvas.
- `@xyflow/react` and `elkjs` are already absent from package manifests.
- `apps/api/src/modules/workflow/workflow-execute.routes.ts` still contains a local video mock success path that marks a task as completed without real provider execution.
- The screenshot COM+ popup comes from the Codex Windows sandbox setup helper; the current session has sandboxing disabled, so project commands should no longer trigger that helper.

## Planned Cleanup

- Remove the local video mock generation helper.
- Remove imports that only existed for that mock helper.
- Make non-custom video generation fail explicitly until a real video provider/model binding is configured.
- Remove random progress ticking from workflow execution; only show explicit stage changes or provider-reported progress.
- Install Context7 as a global Codex MCP server outside the project dependency tree.

## Acceptance Commands

- `npm run lint`
- `npm run build`

## Browser Verification

- Reopen `http://localhost:3001/pipeline`.
- Confirm an existing project still loads the self-built canvas and console has no blocking errors.

## Results

- Removed the local video mock generation helper from `apps/api/src/modules/workflow/workflow-execute.routes.ts`.
- Removed the video registry imports that only existed for the local mock helper.
- Changed non-custom video node execution to fail explicitly unless a real video provider/model is configured through Model Center.
- Removed the random workflow progress ticker from `apps/api/src/modules/workflow/workflow-execute.routes.ts`.
- Preserved provider-reported video progress when the provider returns `progress` or `percent`; otherwise the task stays at a real stage status without invented percentage increments.
- Added Context7 MCP to the global Codex config using `npx -y @upstash/context7-mcp@3.2.1`; this does not add a project dependency.
- Kept uncertain cleanup candidates in the recommendation list instead of deleting them.

## Verification Results

- `npm run lint` passed.
- `npm run build` passed.
- `npm run test:unit` passed.
- `npx -y @upstash/context7-mcp@3.2.1 --version` returned `3.2.1`.
- Browser verification was not rerun for this follow-up because the changes only affect backend task-status reporting and global MCP configuration, not visible UI layout.
- No `codex-windows-sandbox-setup.exe` process was left running. System logs show recent OpenAI.Codex Windows update failures, which likely explain the COM+ popup seen in the uploaded screenshots.
