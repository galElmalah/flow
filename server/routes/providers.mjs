import path from "node:path";
import { readFile } from "node:fs/promises";
import { HarnessUsage } from "../../harness-integrations/usage.mjs";
import { readCodexUsage } from "../../harness-integrations/codex/usage.mjs";

export function registerProviderRoutes(
  app,
  { root, dataRoot, queue, providers, usage },
) {
  usage ||= new HarnessUsage({
    codex: async () => {
      const execution = await providers.codex.execution();
      const health = await providers.codexHealth();
      if (health.authMethod === "api-key" || execution.mode === "api-key")
        return {
          status: "unavailable",
          source: "OpenAI API",
          billing: "api",
          message: "API billing · subscription limits do not apply.",
          windows: [],
        };
      return readCodexUsage(execution);
    },
  });
  const invalidateCodex = () => {
    healthTime = 0;
    providers.statusCache.delete("codex");
    providers.statusCache.delete("codex-text");
    if (usage.invalidate) usage.invalidate("codex");
    else usage.cache.delete("codex");
  };
  app.get("/api/providers/usage", async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(
        await usage.read([...providers.definitions.values()], {
          refresh: req.query.refresh === "1",
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  let healthCache,
    healthTime = 0;
  app.get("/api/health", async (req, res) => {
    if (Date.now() - healthTime > 15000) {
      healthCache = await providers.codexHealth();
      healthTime = Date.now();
    }
    res.json({
      ...healthCache,
      concurrency: queue.concurrency,
      activeJobs: queue.active.size,
      dataDirectory: dataRoot,
    });
  });
  app.get("/api/providers", async (_, res) =>
    res.json(await providers.catalog()),
  );
  let completedLogin = false;
  app.get("/api/providers/codex", async (_, res, next) => {
    try {
      const status = await providers.codex.status();
      if (status.login?.status === "completed" && !completedLogin)
        invalidateCodex();
      completedLogin = status.login?.status === "completed";
      res.set("Cache-Control", "no-store").json(status);
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/providers/codex", async (req, res, next) => {
    try {
      if (queue.active.size)
        throw Object.assign(
          new Error(
            "Wait for running jobs before changing Codex authentication.",
          ),
          { status: 409 },
        );
      const status = await providers.codex.configure(req.body);
      completedLogin = false;
      invalidateCodex();
      await providers.reload();
      res.set("Cache-Control", "no-store").json(status);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/providers/codex/login", async (_, res, next) => {
    try {
      completedLogin = false;
      res
        .set("Cache-Control", "no-store")
        .json(await providers.codex.startLogin());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/providers/codex/login/cancel", async (_, res, next) => {
    try {
      res
        .set("Cache-Control", "no-store")
        .json(await providers.codex.cancelLogin());
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/providers/gemini-video", async (_, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(await providers.video.status());
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/providers/fal", async (_, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(await providers.fal.status());
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/providers/fal", async (req, res, next) => {
    try {
      if (queue.active.size)
        throw Object.assign(
          new Error("Wait for running jobs before changing fal credentials."),
          { status: 409 },
        );
      const status = await providers.fal.configure(req.body);
      providers.statusCache.delete("fal-image");
      providers.statusCache.delete("fal-video");
      res.set("Cache-Control", "no-store").json(status);
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/providers/grok", async (_, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(await providers.grok.status());
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/providers/grok", async (req, res, next) => {
    try {
      const status = await providers.grok.configure(req.body);
      providers.statusCache.delete("grok-image");
      providers.statusCache.delete("grok-video");
      res.set("Cache-Control", "no-store").json(status);
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/providers/gemini-video", async (req, res, next) => {
    try {
      const status = await providers.video.configure(req.body);
      providers.statusCache.delete("gemini-video");
      res.set("Cache-Control", "no-store").json(status);
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/providers/example", async (_, res) =>
    res.json(
      JSON.parse(
        await readFile(
          path.join(root, "examples/providers.example.json"),
          "utf8",
        ),
      ),
    ),
  );
  app.post("/api/providers/connections", async (req, res, next) => {
    try {
      res.status(201).json(await providers.saveConnection(null, req.body));
    } catch (e) {
      next(e);
    }
  });
  app.put("/api/providers/connections/:id", async (req, res, next) => {
    try {
      res.json(await providers.saveConnection(req.params.id, req.body));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/api/providers/connections/:id", async (req, res, next) => {
    try {
      res.json(await providers.removeConnection(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/providers/connections/:id/test", async (req, res, next) => {
    try {
      res.json(await providers.testConnection(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/providers/reload", async (_, res, next) => {
    try {
      res.json(await providers.reload());
    } catch (error) {
      next(error);
    }
  });
}
