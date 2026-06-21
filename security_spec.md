# Security Specification for JiYing Local Canvas

## Data Invariants
1. User-owned data APIs must derive the owner from the `jiying_session` httpOnly cookie.
2. Guest mode is allowed only in the `guest` data space.
3. A request with a `userId` that does not match the authenticated local user must fail.
4. Canvas payloads must be JSON objects with array fields for nodes, shot nodes, and shots.
5. Uploaded media must be written under the local uploads directory and recorded in PostgreSQL metadata.

## Denial Payloads
1. **Unauthenticated owner spoofing**: request `/api/canvas-state?userId=some-user` without a session.
2. **Authenticated owner spoofing**: logged-in `userA` sends body/query `userId=userB`.
3. **Malformed canvas**: send a non-object canvas state or huge base64 payload where arrays are expected.
4. **Custom API key leak**: list `/api/custom-api-configs` and verify encrypted keys are not returned.
5. **Cross-user delete**: logged-in `userA` deletes `userB` saved prompt, history item, or custom API config.
6. **Upload path escape**: upload a filename containing path traversal and verify the served URL remains under `/uploads`.

## Test Runner
These scenarios should be covered by API integration tests against the local Express API and PostgreSQL database.
