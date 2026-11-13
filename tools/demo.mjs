import { parseArgs } from "node:util";
import { access } from "node:fs/promises";
import path from "node:path";
import { startServer } from "../cli/server.mjs";
import { createLocalDemo } from "../cli/demo.mjs";
import { openViewer } from "../cli/viewer.mjs";

let values = {};
const root = path.resolve(import.meta.dirname, "..");
const dataRoot = path.resolve(
  process.env.FLOW_DATA_DIR || path.join(root, ".flow"),
);
try {
  let tokens;
  ({ values, tokens } = parseArgs({
    tokens: true,
    options: {
      json: { type: "boolean" },
      "no-open": { type: "boolean" },
      url: { type: "string" },
      help: { type: "boolean" },
    },
  }));
  if (values.help) {
    const help = {
      command: "node tools/demo.mjs",
      usage:
        "node tools/demo.mjs [--url http://localhost:4310] [--json] [--no-open]",
      effect: "create-or-reopen-local-demo",
      note: "Starts the local server and creates four local-processing outputs on first use. Reopening preserves edits and reuses its run. No accounts, model downloads or paid inference. --json suppresses browser launch.",
    };
    console.log(
      values.json ? JSON.stringify(help) : `${help.usage}\n${help.note}`,
    );
    process.exit(0);
  }
  const addresses = tokens.filter(
    (token) => token.kind === "option" && token.name === "url",
  );
  if (addresses.some((token) => token.value !== values.url))
    throw new Error("Conflicting values for --url. Provide one server URL.");
  if (values.url !== undefined && !values.url.trim())
    throw new Error("--url must be a nonempty local HTTP origin.");
  const url =
    values.url ??
    process.env.FLOW_URL ??
    `http://localhost:${process.env.PORT || 4310}`;
  await access(path.join(root, "dist", "index.html")).catch(() => {
    throw new Error(
      "Build Flow first: npm run setup (or npm run build), then npm run demo.",
    );
  });
  const server = await startServer({ root, dataRoot, url });
  const result = await createLocalDemo({ url: server.url, dataRoot });
  if (values.json) console.log(JSON.stringify(result));
  else
    console.log(
      `${result.reused ? "Opened existing" : "Created"} local demo · ${result.outputs.length} outputs\n${result.url}`,
    );
  if (!values.json && !values["no-open"]) await openViewer(result);
} catch (error) {
  console.error(
    values.json || process.argv.includes("--json")
      ? JSON.stringify({
          error: { code: error.code || "DEMO_FAILED", message: error.message },
        })
      : error.message,
  );
  process.exitCode = 1;
}
