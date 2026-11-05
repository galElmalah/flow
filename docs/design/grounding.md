> Historical design record of the image-only prototype, before text jobs and provider setup forms. Links point to current source files for the same concerns; the descriptions below retain the original design context. For current interfaces, use [ARCHITECTURE.md](../ARCHITECTURE.md) and [the agent guide](../agents.md).

### Overview

Flow already has a good execution split: **the planner expands the graph, the queue schedules dependencies, and provider adapters perform generation**. Its current implementation assumes that every scheduled generation produces an image. Prompt nodes only concatenate existing text.

Adding Pi, Codex, Gemini CLI, and Claude Code for prompt generation therefore needs a text job/result contract alongside the existing image contract. Registering these CLIs as current command providers would still require them to produce `output.png`.

### Key concepts

- **Workflow graph:** `workflowSchema`, `outputType`, `inputTypes`, and `validateGraph()` define node data, compatible sockets, unique IDs, and an acyclic execution order. Current types are `image`, `prompt`, `variations`, `generate`, and `output`. [shared/graph.mjs](../../shared/graph.mjs)
- **Planning contexts:** `planWorkflow()` propagates `{ text, images }` values. Incoming branches form a Cartesian product; variations expand contexts; image generation creates a job per context/copy. [server/graph.mjs](../../server/graph.mjs)
- **Job dependencies:** Currently derived exclusively from upstream image `{ jobId }` references. Prompts are completely assembled before execution. [server/graph.mjs](../../server/graph.mjs)
- **Provider definition versus execution:** `ProviderRegistry` loads configuration, publishes a safe catalog, checks readiness/model compatibility, and dispatches adapters. Every result then undergoes image validation and PNG normalization. [harness-integrations/registry.mjs](../../harness-integrations/registry.mjs)

### How it works

```text
Canvas edits → validateGraph / planWorkflow → expanded jobs
Run request → provider preflight → persisted run → Queue.next()
                                                    ↓
                                 completed dependencies?
                                                    ↓
                              resolve input files → adapter
                                                    ↓
                       validate PNG → save result → SSE → UI
```

`POST /api/plan` previews job counts without inference. `POST /api/runs` repeats planning, checks providers and assets, then submits the same plan to `Queue.create()`. [server/index.mjs](../../server/index.mjs)

`Queue.next()` releases jobs only after all dependencies complete and blocks jobs whose upstream work fails. `execute()` resolves asset/image references, invokes the registry, and currently assigns an image URL unconditionally. Pause prevents new scheduling; cancellation aborts active adapters; retry preserves successful jobs. [server/queue.mjs](../../server/queue.mjs)

`Store` saves complete run records through serialized atomic writes. Restart marks unfinished jobs as interrupted, requiring explicit resume. A generated text result must survive this same lifecycle. [server/store.mjs](../../server/store.mjs)

### Where things live

| Concern | Current ownership and extension point |
|---|---|
| Text generation node | Add its schema/socket behavior in `shared/graph.mjs`; planning in `server/graph.mjs`; rendering/defaults/connection handling in `App.jsx`. |
| CLI harnesses | `runCommand()` sends versioned JSON through stdin and `request.json`, substitutes paths, captures progress, and handles timeout/cancellation. It currently requests an image file. Text harness wrappers need explicit text output extraction; log/stdout progress is not a reliable final result. [command adapter](../../harness-integrations/command/index.mjs) |
| OpenAI-compatible APIs | `runImageApi()` already uses `baseUrl`, bearer credentials, configured models, and `/images/generations` or `/images/edits`. A text API adapter belongs beside it. [image API adapter](../../harness-integrations/openai-compatible/image.mjs) |
| Provider setup | `ProviderSettings` currently displays status and instructs manual editing of `.flow/providers.json`; it has reload/example actions, no create/update form. Backend currently offers catalog/reload endpoints, no configuration-writing endpoint. [provider picker](../../src/panels/ProviderPicker.jsx) |
| Provider selection | Catalog arrives through bootstrap. Picker selection stores `providerId`, default model, and compatible ratio on each image node. It needs capability filtering for text versus images. [App.jsx](../../src/App.jsx) |
| Results | Gallery, output nodes, file serving and ZIP download all assume completed jobs contain images. Keep their image-only selection explicit when text jobs are introduced. [server/index.mjs](../../server/index.mjs) |

### Gotchas and required invariants

1. **Text must become a real dependency.** Represent ordered prompt fragments as literal text or upstream text-job references. Add both text and image references to `dependencies`, then resolve prompt text immediately before execution. Persist the rendered prompt for history/export.

2. **Keep cardinality predictable.** One generated-text job producing one prompt preserves static planning and existing combination counts. Interpreting arbitrary generated lines as additional variations would require a separate dynamic expansion design.

3. **Preserve context propagation.** Prompt nodes currently pass reference images through despite exposing a text output socket. Generated prompt nodes should retain that context when workflows depend on `image → prompt → image generation`.

4. **Separate output capability from transport.** Both commands and compatible APIs can generate text or images. Registry preflight and the picker need capability/model compatibility checks; image normalization must run only for image results. Keep the existing reserved `codex` image behavior compatible.

5. **Publish completion only after a valid result exists.** Empty text should fail; successful text must be persisted before downstream jobs consume it. Resume/retry should reuse completed text rather than regenerate it unexpectedly.

6. **Keep credentials server-side.** Current configuration references environment variables, and `catalog()` excludes credentials. A URL/API-key setup form needs a backend save mechanism with safe credential storage and redacted responses; keys must stay out of graphs, run records, SSE, manifests, and browser persistence.

7. **Update both connection validators.** `App.jsx:isValidConnection()` duplicates socket classification from shared validation. Both must accept the new node consistently. [App.jsx](../../src/App.jsx)

8. **“Ready” currently means basic availability.** Commands check executable presence; API providers check configured credentials, without verifying authentication or endpoint behavior. A setup test should report its stronger verification separately.
