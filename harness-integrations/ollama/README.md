# Ollama text and vision

`OllamaText` uses native loopback `/api/tags`, `/api/show`, and streamed `/api/chat`. It supports text output and image inputs only when the model advertises vision. It does not advertise image or video generation.

`RuntimeManager` owns setup, endpoints, processes, and weight downloads. The registry owns model selection and dispatch. Queue text assets retain the observed model digest, requested seed, output, and lineage. The assistant receives visible content snapshots; thinking fields never enter its answer.

Cloud tags and remote model metadata are rejected. Managed startup sets `OLLAMA_NO_CLOUD=1` and `OLLAMA_NUM_PARALLEL=1`. Aborting text inference ends the local request; retry generates a new answer.

Use [the setup guide](../../docs/local-models.md). Protocol behavior is covered by `node --test test/ollama.test.mjs`; real runtime evidence is in `docs/qa/local-models/`.
