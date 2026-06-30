# Scene3D Motion Refine Plan

## Scope

- Only touch the Scene3D director node and the existing `/api/workflow/scene3d/refine-motion` backend path.
- Do not add a second motion API, a new node type, or unrelated canvas architecture changes.
- Keep the node core in `apps/web/src/components/flow/Scene3DNode.tsx`.

## Contract

- Frontend sends only the lightweight motion context needed for semantic intent: action prompt, duration, curve, start/end transforms, start/end poses, current character transform, constraints, and a compact list of nearby props/cameras.
- Backend returns a serializable `MotionIntent` with normalized motion parameters: direction, distance, turn, roll, crouch, vertical lift, body lean, arm swing, rhythm, contact hints, look-at target, warnings, and confidence.
- Start and end frames remain hard constraints owned by the frontend state.
- AI does not return final clips, transform keyframes, bone keyframes, contact keyframes, or constraints. Local Scene3D compilation remains responsible for generating actual animation samples.

## Implementation

- Backend: update the existing refine-motion Zod schemas, system prompt, validation, response parsing, and route audit summary for `MotionIntent`.
- Frontend: add MotionIntent types, validation, request builder, API call, history persistence, and merge logic into local universal motion planning.
- UI: reuse existing compact Scene3D transition controls; show AI intent confidence, normalized motion parameters, warnings, and real upstream errors.
- Remove the active MotionDraft path from new AI requests so provider load stays small and API failures do not block local motion compilation.
- Phase 2: keep the AI contract lightweight and expand the local universal compiler with semantic motion families. The compiler now derives and layers locomotion, turn, roll, fall, get-up, dodge, crawl, kneel, stumble, reach, and carry behavior from `MotionIntent` numeric parameters, contacts, and prompt text. These families are not preset templates; they are local mechanics used by the same sampler that preserves start/end frames as hard constraints.
- Phase 2: map `MotionIntent.contacts` into clip contact frames where possible. Shoulder/hip semantics remain represented by pose and ground-support hand/foot contacts because the existing serialized clip contact limb contract supports head, hands, and feet.
- Phase 3: expose the local motion families, contact hints, AI-intent cache state, and foot-lock strategy in the compact transition panel so users can inspect what the compiler is doing.
- Phase 3: replace full-clip foot locking with phased foot-lock release for dynamic motions such as roll, fall, get-up, dodge, crawl, kneel, and stumble. Stable or small motions still keep the original locked-foot behavior.
- Phase 4: add a compact motion timeline debug panel inside the transition editor. It renders derived phase segments, generated contact ticks, and sampled left/right foot-lock states so motion quality can be inspected without asking the AI for heavier keyframe output.
- Phase 5: add an independent Scene3D node host at `/dev/scene3d-node-preview`. The host mounts the same `Scene3DNode` with a minimal `CanvasNode` adapter, preserves the existing preview frame and internal behavior, and records real output callbacks without adding a second UI implementation or mock execution path.
- Phase 6: add clip-level motion quality inspection and local partial-regeneration locks. Quality reports are derived from the generated `SerializedAnimationClip` samples and contact frames, checking endpoint drift, root jumps, root rotation spikes, locked-foot changes, and missing contacts. Partial regeneration remains local and deterministic by merging selected scopes from the previous clip or saved endpoints: root position, root rotation, upper body, lower body, or contact frames.
- Phase 7: add in-scene motion path inspection and issue-to-frame navigation. The Scene3D viewport now renders the generated root trajectory, heading markers, current preview point, and contact markers from the same serialized clip used for playback. Quality report issues with a timestamp can jump the preview directly to the affected frame.
- Phase 8: add deterministic one-click quality fixes for generated clips. The node can repair active locked-foot pose drift, smooth root position samples, smooth root rotation samples, and snap endpoints back to saved start/end frames, then rebuild the serialized clip and quality report without calling the AI provider.

## Verification

- Run TypeScript check.
- Run workflow contract/unit tests that cover node contracts and backend schemas where available.
