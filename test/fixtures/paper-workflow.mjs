import example from "../../examples/paper-studies.flow.json" with { type: "json" };

// Legacy graph fixtures predate optimistic revisions.
const { revision: _revision, ...starter } = example.workflow;
export { starter };
