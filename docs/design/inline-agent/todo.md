# Inline agent implementation

- [x] Ground the harness, persistence, routing, and canvas integration.
- [x] Sketch two distinct designs (frame, fan out, compare).
- [x] Choose a design and record the synthesis; proceed without a checkpoint.
- [x] Implement paths, persistent page-aware chat, and upward toolbar expansion.
- [x] Verify a real harness interaction and browser navigation/edit flows.
- [x] Remove any design scaffolding that the implementation supersedes.

Design rubric: page context remains accurate; mutations preserve concurrent edits and run snapshots; real existing harness integration without extra credentials; one routing owner across UI/client/CLI; compact accessible toolbar with upward expansion; small traceable service boundary.

The skill's default Claude/Grok runner families are unavailable in this host's tool catalog. Use two independent parent-model runners. Cross-family judge is unavailable; compare both designs directly and record the decision.
