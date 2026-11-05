import { providerFailureFields } from "../shared/provider-errors.mjs";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile, unlink, writeFile, rename, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isMediaJob, mediaKind, mediaArtifact } from "../shared/media.mjs";
import { Store } from "./store.mjs";
import { Queue } from "./queue.mjs";
import { Assets } from "./assets.mjs";
import { createAssetPath } from "./asset-path.mjs";
import { registerAssetRoutes } from "./routes/assets.mjs";
import { verifyImage } from "../harness-integrations/shared/image.mjs";
import { ProviderRegistry } from "../harness-integrations/registry.mjs";
import { ProjectService } from "./projects.mjs";
import { registerDiscoveryRoutes } from "./routes/discovery.mjs";
import { registerProjectRoutes } from "./routes/projects.mjs";
import { registerWorkflowRoutes } from "./routes/workflows.mjs";
import { registerRunRoutes } from "./routes/runs.mjs";
import { registerProviderRoutes } from "./routes/providers.mjs";
import { registerLocalModelRoutes } from "./routes/local-models.mjs";
import { GallerySearch } from "./search/index.mjs";
import { registerSearchRoutes } from "./routes/search.mjs";
import { registerRuleTemplateRoutes } from "./routes/rule-templates.mjs";
import { registerStyleRoutes } from "./routes/styles.mjs";

import { ImageEditors } from "./image-editor/service.mjs";
import { registerImageEditorRoutes } from "./routes/image-editors.mjs";
import { AgentConversations } from "./agent/service.mjs";
import { registerEventRoutes } from "./routes/events.mjs";
import { registerAgentRoutes } from "./routes/agent.mjs";
import {
  initializeTracing,
  traceHttp,
  closeTracing,
  tracingStatus,
} from "../observability/tracing.mjs";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dataRoot = path.resolve(
  process.env.FLOW_DATA_DIR || path.join(root, ".flow"),
);
const port = Number(process.env.PORT || 4310);
if (
  !process.env.FLOW_DATA_DIR &&
  !(await stat(dataRoot).catch(() => null)) &&
  (await stat(path.join(root, ".weft")).catch(() => null))
)
  throw new Error(
    "Legacy workspace found. Run node cli/flow.mjs migrate --json before starting Flow.",
  );
await initializeTracing({ dataRoot });
const store = new Store(dataRoot);
await store.init();
const assetPath = createAssetPath({ root, dataRoot, store });
const providers = new ProviderRegistry({ root, dataRoot });
await providers.reload();
const assets = new Assets({ store, resolveAsset: assetPath });
const queue = new Queue(store, {
  assets,
  concurrency: 4,
  resolveAsset: assetPath,
  adapter: (context) => providers.run(context),
  executionLane: (job) => providers.executionLane(job),
});
const projects = new ProjectService(store);
const search = new GallerySearch({ store, dataRoot });
await search.start();
const editors = new ImageEditors({
  assets,
  store,
  projects,
  assetPath,
  dataRoot,
  queue,
  providers,
});
const agent = new AgentConversations({
  store,
  projects,
  providers,
  assetPath,
  dataRoot,
  editors,
});
const services = {
  assets,
  agent,
  editors,
  root,
  dataRoot,
  store,
  projects,
  queue,
  providers,
  assetPath,
  search,
};
const app = express();
const identity = {
  application: "flow",
  instanceId: randomUUID(),
  pid: process.pid,
  root,
  dataDirectory: dataRoot,
  startedAt: new Date().toISOString(),
};
let ready = false;
app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = req.headers.host?.split(":")[0];
  if (!["localhost", "127.0.0.1", "["].includes(host))
    return res
      .status(403)
      .json({ error: "Flow only accepts local connections." });
  if (
    req.path.startsWith("/api") &&
    req.headers.origin &&
    req.headers.origin !== `http://${req.headers.host}`
  )
    return res
      .status(403)
      .json({ error: "Requests must come from this local app." });
  next();
});
app.use(express.json({ limit: "4mb" }));
app.use(traceHttp);
app.get("/api/server", (_, res) =>
  res.json({
    ...identity,
    ready,
    activeJobs:
      queue.active.size +
      editors.active.size +
      editors.naming.size +
      editors.sending.size +
      agent.active.size +
      (editors.model.installation ? 1 : 0) +
      providers.runtimes.activeCount,
    storage: store.storageInfo(),
    telemetry: tracingStatus(),
  }),
);
registerDiscoveryRoutes(app, services);
registerImageEditorRoutes(app, services);
registerAgentRoutes(app, services);
registerRuleTemplateRoutes(app, services);
registerStyleRoutes(app, services);
app.use("/assets", express.static(path.join(root, "public", "assets")));
app.use(
  "/files/uploads",
  express.static(path.join(dataRoot, "uploads"), { dotfiles: "deny" }),
);
app.get("/files/runs/:run/:job/:output", (req, res) => {
  const run = store.runs.get(req.params.run),
    job = run?.jobs.find((j) => j.id === req.params.job);
  if (!job) return res.sendStatus(404);
  const input =
    job.lineage?.inputs.some((ref) => ref.snapshotFile === req.params.output) &&
    /^input-\d+\.(png|jpe?g|webp)$/.test(req.params.output);
  if (job.status !== "completed" && !input) return res.sendStatus(404);
  const artifact = mediaArtifact(job);
  const original =
    mediaKind(job) === "image" &&
    req.params.output === job.metadata?.originalFile &&
    /^original-attempt-\d+\.(png|jpg|webp|gif|svg)$/.test(req.params.output);
  const final =
    req.params.output === artifact.basename &&
    (job.output === `/files/runs/${run.id}/${job.id}/${artifact.basename}` ||
      job.kind === "text");
  if (!original && !final && !input) return res.sendStatus(404);
  const mime =
    original || input
      ? {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
          svg: "image/svg+xml",
        }[path.extname(req.params.output).slice(1)]
      : artifact.mimeType;
  res.type(mime).set("X-Content-Type-Options", "nosniff");
  if (mime === "image/svg+xml")
    res.set(
      "Content-Security-Policy",
      "sandbox; default-src 'none'; style-src 'none'",
    );
  res.sendFile(path.join(dataRoot, "runs", run.id, job.id, req.params.output), {
    dotfiles: "allow",
  });
});
const closeEvents = registerEventRoutes(app, services);
registerProviderRoutes(app, services);
registerLocalModelRoutes(app, services);
registerProjectRoutes(app, services);
registerWorkflowRoutes(app, services);
registerRunRoutes(app, services);
registerSearchRoutes(app, services);
registerAssetRoutes(app, services);
const upload = multer({
  dest: path.join(dataRoot, "uploads"),
  limits: { fileSize: 32 * 1024 * 1024, files: 16 },
});
app.post("/api/uploads", upload.array("images", 16), async (req, res, next) => {
  try {
    if (!req.files?.length) throw new Error("Choose an image to upload.");
    const uploadedAssets = [];
    const projectId = req.body?.projectId || undefined;
    assets.scope(projectId);
    for (const f of req.files) {
      const extension = await verifyImage(f.path);
      const name = `${randomUUID()}.${extension}`;
      await copyFile(f.path, path.join(dataRoot, "uploads", name));
      await unlink(f.path);
      const url = "/files/uploads/" + name;
      const captured = await assets.captureUpload({
        url,
        name: f.originalname,
        projectId,
      });
      uploadedAssets.push({
        url,
        name: f.originalname,
        assetId: captured.id,
        fingerprint: captured.fingerprint,
      });
    }
    res.json(uploadedAssets);
  } catch (e) {
    await Promise.all(
      (req.files || []).map((f) => unlink(f.path).catch(() => {})),
    );
    next(e);
  }
});
if (process.argv.includes("--production")) {
  app.use(express.static(path.join(root, "dist")));
  app.get(
    /^(?:\/projects|\/project\/|\/workflow\/|\/run\/|\/editor\/|\/styles|\/gallery|\/settings(?:\/|$))/,
    (req, res, next) => {
      if (!req.accepts("html")) return next();
      res.sendFile(path.join(root, "dist", "index.html"));
    },
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.status || 400).json({
    ...providerFailureFields(error),
    error:
      error.issues
        ?.map((x) => `${x.path.join(".")}: ${x.message}`)
        .join("; ") || error.message,
  });
});
const server = app.listen(port, "127.0.0.1", async () => {
  const file = path.join(dataRoot, "server.json");
  try {
    await writeFile(file + ".tmp", JSON.stringify(identity, null, 2));
    await rename(file + ".tmp", file);
    ready = true;
  } catch (error) {
    console.error("Could not write server identity:", error.message);
    server.close(() => process.exit(1));
    return;
  }
  console.log(
    `\n  Flow — local image studio\n  http://localhost:${port}\n  Data: ${dataRoot}\n`,
  );
});
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    await agent.close();
    await queue.stop();
    await editors.close();
    await providers.runtimes.close();
    providers.codex.close();
    await search.close();
    await closeTracing();
    closeEvents();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
