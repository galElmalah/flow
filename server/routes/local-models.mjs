import {
  localRuntimeSchema,
  localRuntimeConfigSchema,
  comfyProfileSchema,
  comfyCheckpointRecipeSchema,
  createCheckpointProfile,
} from "../../shared/local-models.mjs";
import {
  localModelPresets,
  localModelPresetIdSchema,
  createPresetProfile,
} from "../../shared/local-model-presets.mjs";

export function registerLocalModelRoutes(
  app,
  { providers, queue, store, agent },
) {
  const { runtimes, comfy } = providers;
  const occupied = (runtime) => {
    const ids =
      runtime === "ollama" ? ["ollama"] : ["comfyui-image", "comfyui-video"];
    for (const [jobId, active] of queue.active) {
      const job = store.runs
        .get(active.runId)
        ?.jobs.find((job) => job.id === jobId);
      if (ids.includes(job?.providerId)) return true;
    }
    if (runtime === "ollama" && agent) {
      for (const key of agent.active.keys()) {
        const [sessionId, turnId] = key.split("/");
        const turn = agent
          .get(sessionId)
          ?.turns.find((turn) => turn.id === turnId);
        if (turn?.providerId === "ollama") return true;
      }
    }
    return false;
  };
  const guard = (runtime) => {
    if (occupied(runtime)) {
      const error = new Error(
        "This local runtime is generating. Finish or cancel its jobs before changing its setup.",
      );
      error.status = 409;
      throw error;
    }
  };
  const send = (operation) => async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(await operation(req));
    } catch (error) {
      next(error);
    }
  };
  const describe = async (runtime, current) => {
    const status = current || (await runtimes.status(runtime));
    const providerIds =
      runtime === "ollama" ? ["ollama"] : ["comfyui-image", "comfyui-video"];
    let lastGeneration;
    const presetGenerations = {};
    for (const run of store.runs.values()) {
      for (const job of run.jobs) {
        if (
          job.status !== "completed" ||
          !providerIds.includes(job.providerId) ||
          job.metadata?.effectiveSettings?.endpoint !== status.baseUrl
        )
          continue;
        const generation = {
          runId: run.id,
          jobId: job.id,
          model: job.model,
          finishedAt: job.finishedAt,
          width: job.metadata?.width,
          height: job.metadata?.height,
        };
        if (!lastGeneration || job.finishedAt > lastGeneration.finishedAt)
          lastGeneration = generation;
        const preset = localModelPresets.find((entry) =>
          entry.weights.every((weight) =>
            job.metadata?.modelFacts?.some(
              (fact) =>
                fact.present &&
                fact.hashVerified &&
                fact.sha256 === weight.sha256,
            ),
          ),
        );
        if (
          preset &&
          (!presetGenerations[preset.id] ||
            job.finishedAt > presetGenerations[preset.id].finishedAt)
        )
          presetGenerations[preset.id] = generation;
      }
    }
    return {
      ...status,
      presetGenerations,
      ...(lastGeneration && {
        verifiedInference: true,
        lastGeneration,
        ...(status.running && {
          message: `${status.managed ? "Managed" : "External"} local runtime is reachable. See the last completed generation below.`,
        }),
      }),
    };
  };
  app.get(
    "/api/local-models",
    send(async () => ({
      ...(await (async () => {
        const status = await runtimes.status();
        return {
          hardware: status.hardware,
          runtimes: await Promise.all(
            status.runtimes.map((runtime) => describe(runtime.id, runtime)),
          ),
        };
      })()),
      profiles: await comfy.profiles(),
      presets: localModelPresets,
    })),
  );
  app.post(
    "/api/local-models/comfyui/presets/:id/install",
    send(async (req) => {
      guard("comfyui");
      const id = localModelPresetIdSchema.parse(req.params.id);
      return runtimes.installPreset(id, async () => {
        // Retain user adjustments on repeated setup.
        if (!(await comfy.profiles()).some((profile) => profile.id === id))
          await comfy.saveProfile(createPresetProfile(id));
        await providers.reload();
      });
    }),
  );
  app.get(
    "/api/local-models/comfyui/profiles",
    send(() => comfy.profiles()),
  );
  app.post(
    "/api/local-models/comfyui/profiles",
    send(async (req) => {
      const result = await comfy.saveProfile(
        comfyProfileSchema.parse(req.body),
      );
      await providers.reload();
      return result;
    }),
  );
  app.post(
    "/api/local-models/comfyui/checkpoint-profile",
    send(async (req) => {
      const result = await comfy.saveProfile(
        createCheckpointProfile(comfyCheckpointRecipeSchema.parse(req.body)),
      );
      await providers.reload();
      return result;
    }),
  );
  app.delete(
    "/api/local-models/comfyui/profiles/:id",
    send(async (req) => {
      guard("comfyui");
      const result = await comfy.removeProfile(req.params.id);
      await providers.reload();
      return result ?? { removed: true };
    }),
  );
  app.post(
    "/api/local-models/comfyui/profiles/:id/validate",
    send((req) => comfy.validateProfile(req.params.id)),
  );
  app.get(
    "/api/local-models/:runtime",
    send((req) => describe(localRuntimeSchema.parse(req.params.runtime))),
  );
  app.put(
    "/api/local-models/:runtime",
    send(async (req) => {
      const runtime = localRuntimeSchema.parse(req.params.runtime);
      guard(runtime);
      const result = await runtimes.configure(
        runtime,
        localRuntimeConfigSchema.parse(req.body),
      );
      await providers.reload();
      return result;
    }),
  );
  for (const action of ["setup", "start", "stop", "pull", "cancel"]) {
    app.post(
      `/api/local-models/:runtime/${action}`,
      send(async (req) => {
        const runtime = localRuntimeSchema.parse(req.params.runtime);
        if (["setup", "stop", "pull"].includes(action)) guard(runtime);
        const result = await runtimes[action](runtime, req.body);
        if (["stop", "cancel"].includes(action)) providers.statusCache.clear();
        return result;
      }),
    );
  }
}
