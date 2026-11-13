import { z } from "zod";
import { runOptionsSchema, runSubmissionSchema } from "./run-options.mjs";
import {
  imageSettingsSchema,
  videoSettingsSchema,
} from "./generation-modes.mjs";
import { editRequestSchema } from "./image-editor.mjs";

// Command definitions drive offline help and argument validation before any I/O.
const globalFlags = "json help root url port project";
const selection =
  "workflow node count seed provider model prompt-provider prompt-model prompt-set items";
const recipe =
  "name id media prompt prompts records template seed-image modes ratio quality resolution duration video-mode prompt-instructions output-format frames frame-delay complexity background from";
const commands = new Map();
function add(names, flags = "", args = "", effect = "read", example) {
  for (const name of names.split("|"))
    commands.set(name, { name, flags, args, effect, example });
}
add("serve", "", "", "start-server");
add("stop", "force", "", "stop-server");
add("restart", "force", "", "restart-server");
add("mcp", "", "", "serve-mcp");
add("migrate", "plan", "", "migrate-storage");
add("skills|skills status", "target");
add("skills install", "target", "", "install");
add(
  "open",
  "workflow node run gallery styles projects editor print-url",
  "[WORKFLOW_ID]",
  "open-viewer",
);
add(
  "guide|schema|status|gallery|runs|search-status|rules|providers|providers usage|providers codex|providers fal|providers grok|providers gemini-video|providers example",
);
add("providers reload|search-retry", "", "", "refresh");
add(
  "providers configure-codex|providers configure-fal|providers configure-grok|providers configure-video|providers create",
  "from",
  "",
  "configure",
);
add("providers save", "from", "ID", "configure");
add("providers test|providers remove", "", "ID", "manage-connection");
add(
  "providers login-codex|providers cancel-codex-login",
  "",
  "",
  "manage-login",
);
add("local");
add("local status", "", "[RUNTIME]");
add("local profiles");
add("local profile validate", "", "ID", "validate-runtime");
add("local profile save|local checkpoint", "from", "", "configure");
add("local profile remove", "", "ID", "configure");
add("local configure", "from", "RUNTIME", "configure");
add(
  "local setup|local start|local stop|local cancel|local install",
  "wait timeout",
  "RUNTIME_OR_PRESET",
  "manage-runtime",
);
add("local pull", "from model wait timeout", "RUNTIME", "download");
add("projects", "search archived");
add("project|project inspect", "", "[PROJECT_ID]");
add("project init", "name workflow", "", "register-project");
add("project register", "from name", "", "register-project");
add("project update", "name workflow clear-default", "[PROJECT_ID]", "write");
add("project archive|project restore", "", "[PROJECT_ID]", "write");
add("workflows", "archived");
add("workflow", "", "WORKFLOW_ID");
add(
  "workflow create",
  recipe +
    " provider model count seed prompt-provider prompt-model prompt-set node",
  "",
  "create-workflow",
  'flow workflow create --prompt "A mountain at dawn" --provider local-color --json',
);
add("workflow organize", "geometry plan", "WORKFLOW_ID", "arrange-workflow");
add("workflow archive|workflow restore", "", "WORKFLOW_ID", "write");
add("fork", "name run", "WORKFLOW_ID", "create-workflow");
add("import", "from", "", "save-workflow");
add("export|manifest", "output", "ID", "export");
add(
  "plan",
  selection,
  "[WORKFLOW_ID]",
  "preview",
  "flow plan WORKFLOW_ID --count 1 --json",
);
add(
  "run",
  selection + " " + recipe + " request-id concurrency plan wait timeout",
  "[WORKFLOW_ID]",
  "start-run",
  "flow run WORKFLOW_ID --request-id REQUEST_ID --json",
);
add("wait", "timeout", "RUN_ID");
add("inspect", "", "RUN_ID");
add("pause|resume|retry|cancel", "", "RUN_ID", "control-run");
add("download", "output", "RUN_ID", "write-file");
add("results", "", "WORKFLOW_ID");
add("prompt-set preview", "workflow node items", "[WORKFLOW_ID]");
add("styles", "search category favorites", "[STYLE_ID]");
add("style create", "from seed-image", "", "write");
add("style update", "from seed-image", "STYLE_ID", "write");
add(
  "style start",
  "name subject prompt provider model",
  "STYLE_ID",
  "create-workflow",
  'flow style start STYLE_ID --subject "A mountain" --provider local-color --model color-study --json',
);
add("style favorite", "unfavorite", "STYLE_ID", "write");
add("style references", "from", "STYLE_ID", "write");
add("style import-run", "", "RUN_ID", "write");
add("rules save", "from", "", "write");
add("upload", "seed-image", "[FILES...]", "upload");
add("assets", "run image workflow");
add("asset|asset lineage", "", "ASSET_ID");
add("asset annotate", "from", "ASSET_ID", "write");
add("dataset|dataset export", "mode run workflow output", "", "export");
add("search", "scope workflow run provider count", "TEXT...");
add("agent|agent session", "from", "", "open-session");
add("agent schema");
add(
  "agent ask",
  "from workflow run editor node regions id prompt provider model reasoning",
  "[SESSION_ID]",
  "start-inference",
);
add("agent read", "from", "[SESSION_ID]");
add("agent trace", "from id", "[SESSION_ID] [TURN_ID]");
add(
  "agent apply|agent cancel|agent undo",
  "from id",
  "[SESSION_ID] [TURN_ID]",
  "write",
);
add("editor|editor list|editor status");
add("editor setup", "", "", "install");
add("editor open", "from image seed-image", "", "open-editor");
add("editor inspect|editor variations", "editor", "[EDITOR_ID]");
add("editor cancel-naming", "editor", "[EDITOR_ID]", "cancel-inference");
add(
  "editor name",
  "editor from provider model",
  "[EDITOR_ID]",
  "start-inference",
);
add("editor segment", "editor from", "[EDITOR_ID]", "segment");
add("editor patch", "editor from", "[EDITOR_ID]", "write");
add(
  "editor prepare",
  "editor from regions prompt provider model count mode color strength",
  "[EDITOR_ID]",
  "prepare-edit",
);
add(
  "editor send",
  "editor from",
  "[EDITOR_ID] [REQUEST_ID]",
  "start-inference",
);

const booleans = new Set(
  "json help version plan force gallery styles projects print-url archived clear-default wait favorites unfavorite".split(
    " ",
  ),
);
const runFields = z.toJSONSchema(runOptionsSchema).properties;
const submissionFields = z.toJSONSchema(runSubmissionSchema).properties;
const imageFields = z.toJSONSchema(imageSettingsSchema).properties;
const videoFields = z.toJSONSchema(videoSettingsSchema).properties;
const editFields = z.toJSONSchema(editRequestSchema).properties;
const numberTypes = {
  count: {
    ...runFields.count,
    description: "Copies per record or scene for each generation mode.",
  },
  concurrency: submissionFields.concurrency,
  seed: runFields.seed,
  port: { type: "integer", minimum: 1, maximum: 65535 },
  timeout: {
    type: "number",
    exclusiveMinimum: 0,
    description: "Seconds to wait.",
  },
  strength: editFields.strength,
  duration: videoFields.durationSeconds,
  frames: imageFields.frameCount,
  "frame-delay": imageFields.frameDurationMs,
};
const words = (value) => value.split(" ").filter(Boolean);
export function hasRecipeFlags(values) {
  return words(recipe).some((flag) => values[flag] !== undefined);
}
function flags(command) {
  let common = globalFlags;
  if (command.name.startsWith("skills")) common = "json help";
  else if (["migrate", "serve", "stop", "restart"].includes(command.name))
    common = "json help url port";
  return [...new Set([...words(common), ...words(command.flags)])];
}
export const parserOptions = Object.fromEntries(
  [...new Set([...commands.values()].flatMap(flags))].map((name) => [
    name,
    name === "seed-image"
      ? { type: "string", multiple: true }
      : { type: booleans.has(name) ? "boolean" : "string" },
  ]),
);
parserOptions.version = { type: "boolean", short: "v" };

function flagSchema(command, flag) {
  if (flag === "request-id") return submissionFields.requestId;
  if (flag === "count" && command.name === "search")
    return {
      type: "integer",
      minimum: 1,
      maximum: 200,
      description: "Maximum number of search results.",
    };
  if (flag === "count" && command.name === "editor prepare")
    return { ...editFields.count, description: "Number of edit variations." };
  if (flag === "seed-image")
    return { type: "array", items: { type: "string" } };
  return (
    numberTypes[flag] || { type: booleans.has(flag) ? "boolean" : "string" }
  );
}

function lookup(args) {
  for (let length = Math.min(3, args.length); length > 0; length--) {
    const command = commands.get(args.slice(0, length).join(" "));
    if (command) return { command, params: args.slice(length) };
  }
  throw new Error(`Unknown command: ${args.join(" ")}. Use flow help.`);
}
function describe(command) {
  const usage = ["flow", command.name, command.args].filter(Boolean).join(" ");
  return {
    command: command.name,
    usage,
    effect: command.effect,
    flags: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        flags(command).map((flag) => [flag, flagSchema(command, flag)]),
      ),
    },
    examples: [command.example || usage + " --json"],
  };
}
export function commandHelp(args) {
  const group = args.join(" ");
  const children = [...commands.keys()].filter((name) =>
    name.startsWith(group + " "),
  );
  if (!group || children.length) {
    return {
      command: group || "flow",
      commands: [
        ...(commands.has(group) ? [group] : []),
        ...(group ? children : [...commands.keys()]),
      ],
      ...(commands.has(group) && describe(commands.get(group))),
    };
  }
  const { command, params } = lookup(args);
  if (params.length) throw new Error(`Unknown help topic: ${group}.`);
  return describe(command);
}
export function renderHelp(help) {
  const lines = [];
  if (help.usage) {
    lines.push(
      help.usage,
      `Effect: ${help.effect}`,
      Object.keys(help.flags.properties)
        .map((f) => "--" + f)
        .join(" "),
      ...help.examples,
    );
  }
  if (help.commands)
    lines.push(
      ...help.commands.map((name) => "flow " + name),
      "Use flow help COMMAND --json for options and examples.",
    );
  return lines.join("\n");
}
export function validateInvocation(args, values) {
  const { command, params } = lookup(args);
  const positionals = words(command.args);
  const min = positionals.filter((p) => !p.startsWith("[")).length;
  if (
    params.length < min ||
    (!command.args.includes("...") && params.length > positionals.length)
  )
    throw new Error(
      `Expected: ${["flow", command.name, command.args].filter(Boolean).join(" ")}. Use flow help ${command.name} for options.`,
    );
  const preview =
    command.name === "plan" || (command.name === "run" && values.plan);
  const allowed = new Set(flags(preview ? commands.get("plan") : command));
  if (command.name === "run" && values.plan) allowed.add("plan");
  for (const [key, raw] of Object.entries(values)) {
    if (!allowed.has(key))
      throw new Error(
        `--${key} is not an option for ${preview ? "plan" : command.name}.${preview ? " Create or import a workflow first, then plan its ID." : " Use --help for options."}`,
      );
    if (
      key === "request-id" &&
      !runSubmissionSchema.shape.requestId.safeParse(raw).success
    )
      throw new Error(
        "Invalid --request-id. Use 1–128 letters, numbers, dots, underscores, colons or hyphens, starting with a letter or number.",
      );
    if (!numberTypes[key]) continue;
    const value = Number(raw),
      schema = flagSchema(command, key);
    if (
      !raw.trim() ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isInteger(value)) ||
      value < schema.minimum ||
      value > schema.maximum ||
      value <= schema.exclusiveMinimum ||
      (schema.multipleOf && value % schema.multipleOf)
    )
      throw new Error(
        `Invalid value for --${key}. See flow help ${command.name} --json.`,
      );
  }
  if (
    ["plan", "run", "open", "prompt-set preview"].includes(command.name) &&
    params[0] &&
    values.workflow &&
    params[0] !== values.workflow
  )
    throw new Error("Workflow argument and --workflow must match.");
  if (command.name === "run" && values.from && (params[0] || values.workflow))
    throw new Error("Choose a saved workflow ID or --from.");
  if (command.name === "run" && values["request-id"] && hasRecipeFlags(values))
    throw new Error(
      "Use --request-id with a saved workflow. Create or import the workflow first.",
    );
  if (values.timeout && !values.wait && command.name !== "wait")
    throw new Error("--timeout requires --wait.");
  if (
    command.name === "style start" &&
    values.prompt !== undefined &&
    values.subject !== undefined &&
    values.prompt !== values.subject
  )
    throw new Error("Choose --subject or --prompt for the style scene.");
  if (command.name === "workflow create" || command.name === "run") {
    if (
      values.media !== undefined &&
      !["image", "video"].includes(values.media)
    )
      throw new Error("Choose --media image or video.");
    if (
      values.media === "video" &&
      words("output-format frames frame-delay complexity background").some(
        (flag) => values[flag] !== undefined,
      )
    )
      throw new Error("Image output controls require --media image.");
    if (
      (values.media === "image" ||
        (command.name === "workflow create" &&
          !values.from &&
          !values.media)) &&
      (values.duration !== undefined || values["video-mode"] !== undefined)
    )
      throw new Error("--duration and --video-mode require a video workflow.");
  }
  if (
    command.name === "styles" &&
    params.length &&
    (values.search || values.category || values.favorites)
  )
    throw new Error("List filters apply to flow styles without a style ID.");
}
