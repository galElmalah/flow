# Prompt providers

## Work phases

- Ground: trace graph compilation, queue dependencies, registry ownership and UI selection.
- Sketch: compare two independently proposed shapes.
- Agree: synthesize without a user checkpoint.
- Implement: prompt jobs, harness adapters and compatible-provider setup.
- Scrap: revisit the sketch if implementation repeatedly needs a second execution path.

## Request

Use Pi, Codex, Gemini CLI and Claude Code to generate image prompts. Choose a different provider at each step. Add an in-app OpenAI-compatible connection with base URL and API key, covering text and image models.

## Existing flow

The shared schema validates socket types and a DAG. The planner expands static prompt text and image references into image jobs. The queue waits for parent image jobs, resolves their files, and dispatches through the provider registry. Registry configuration and provider credentials currently live outside workflow snapshots. The UI selects providers per image node. Text generation needs a persistent job result and typed dependency references; it cannot be a hidden pre-run call that disappears from retries and history.

## Rubric

1. Generated text and image dependencies wait, retry and resume through the same durable queue.
2. Each node chooses a capability-compatible provider and model; existing workflows remain image-compatible.
3. Provider URL/key setup is reviewable in the UI; keys are never returned in catalogs, workflows, exports or logs.
4. Built-in harness presets use isolated job directories, bounded subprocesses and no shell interpolation.
5. The design has one execution path and a small registry boundary.

## Review constraints

The skill's default Claude/Grok model families are unavailable in the agent tool. The two design seats use the available parent model. A cross-family judge is unavailable, so synthesis is performed by the parent against the rubric.

## Decision

Grounding and both independent sketches are complete. Both candidates score 5/5 on the rubric with the statically expanded typed-job DAG; the dynamic interpreter adds a second durable frontier without a required variable-cardinality output. Use the existing queue for both operations. Ordered `promptParts` contain literals or text-job references; `kind` distinguishes text/image results. AI prompt output replaces incoming text and preserves image references. Existing image presentation fields stay authoritative for image results; `resultText` is authoritative for text, so there is no duplicated result representation. Legacy runs acquire image kind at the storage boundary.

Registry owns capabilities, compatible connection CRUD and one private connection file (0600). Keys use explicit keep/replace/clear updates. The UI only receives allowlisted catalog fields. Harness presets own fixed noninteractive argv and final-answer parsers. The queue resolves text before dispatch and durably saves completion before releasing dependents. One text result is one string; newline splitting remains explicit in static variation nodes.

Implementation modules: shared graph schema/socket rules; planner text references; queue typed result persistence; registry capability filtering/connection storage; harness and compatible text adapters; HTTP routes; AI prompt node/picker/settings; CLI prompt-provider overrides. Verify each boundary with fixture adapters, then run installed CLIs and exercise the real UI. Sources and full alternative analysis are in candidate-a.md, candidate-b.md and grounding.md.

## Sources inspected

- [Codex noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Claude Code headless](https://code.claude.com/docs/en/headless)
- [Gemini CLI headless](https://geminicli.com/docs/cli/headless/)
- [Pi repository](https://github.com/earendil-works/pi)

## Implementation outcome

All phases are complete. Implemented the static job DAG, ordered prompt references, durable text results, all four CLI presets, compatible text/image connection CRUD, capability-based pickers, generated-text views, and independent CLI prompt overrides. Kept the existing image fields and file-configured command protocol to avoid a presentation-only migration. No second scheduler or pre-run inference pass was needed. The process helper bounds new prompt CLIs; existing command-image process handling remains unchanged.

Verification: 30 behavior tests and production build pass. Real Codex/Claude prompt chaining, fresh CLI prompt generation, local compatible HTTP requests, browser connection CRUD, restart, and image-only ZIP contents are recorded in ../VERIFICATION.md. Pi/Gemini are not installed locally and are not reported as live-verified.
