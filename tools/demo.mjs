import { parseArgs } from "node:util";
import { access } from "node:fs/promises";
import path from "node:path";
import { startServer } from "../cli/server.mjs";
import { createLocalDemo } from "../cli/demo.mjs";
import { openViewer } from "../cli/viewer.mjs";

const { values } = parseArgs({
  options: {
    json: { type: "boolean" },
    "no-open": { type: "boolean" },
    url: { type: "string" },
  },
});
const root = path.resolve(import.meta.dirname, "..");
const dataRoot = path.resolve(
  process.env.FLOW_DATA_DIR || path.join(root, ".flow"),
);
const url =
  values.url ||
  process.env.FLOW_URL ||
  `http://localhost:${process.env.PORT || 4310}`;
try {
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
  console.error(error.message);
  process.exitCode = 1;
}
