import React, { useEffect, useRef, useState } from "react";
import {
  Cpu,
  Download,
  Play,
  Square,
  RefreshCw,
  Folder,
  FileJson,
  Trash2,
  Check,
} from "lucide-react";
import { HarnessLogo } from "../harnesses/HarnessLogo.jsx";
import { Autocomplete } from "../components/Autocomplete.jsx";
import { createCheckpointProfile } from "../../shared/local-models.mjs";
import { LocalModelPreset } from "./LocalModelPreset.jsx";
import "./local-models.css";

const folders = [
  "checkpoints",
  "diffusion_models",
  "text_encoders",
  "vae",
  "loras",
  "clip_vision",
];
const presets = [
  {
    value: "qwen3:0.6b",
    label: "Qwen 3 · 0.6B",
    description: "Small starter · prompt writing and setup verification",
  },
  {
    value: "qwen3:4b",
    label: "Qwen 3 · 4B",
    description: "General prompt writing · more memory required",
  },
  {
    value: "gemma3:4b",
    label: "Gemma 3 · 4B",
    description: "Multimodal prompt writing · check model license",
  },
];
const bytes = (n) =>
  Number.isFinite(n)
    ? n >= 1024 ** 3
      ? `${(n / 1024 ** 3).toFixed(1)} GB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`
    : "Unknown size";
async function request(path = "", method = "GET", body) {
  const response = await fetch(`/api/local-models${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Local model operation failed.");
  return value;
}
const activeTask = (runtime) => runtime?.task?.status === "running";
function TaskProgress({ task }) {
  if (!task) return null;
  const progress = task.download;
  return (
    <div className="local-model-task" role="status" aria-live="polite">
      <div>
        <strong>{task.stage || task.action}</strong>
        <span>{task.status}</span>
      </div>
      <p>{task.message}</p>
      {task.fileCount && (
        <small>
          File {task.fileIndex} of {task.fileCount}
        </small>
      )}
      {progress && (
        <>
          <progress
            max="100"
            {...(Number.isFinite(progress.percent)
              ? { value: progress.percent }
              : {})}
            aria-label={`${task.action} download progress`}
          />
          <small>
            {bytes(progress.downloadedBytes)}
            {Number.isFinite(progress.totalBytes)
              ? ` / ${bytes(progress.totalBytes)}`
              : " downloaded"}
            {Number.isFinite(progress.percent)
              ? ` · ${Math.round(progress.percent)}%`
              : ""}
            {progress.scope ? ` · ${progress.scope}` : ""}
            {progress.attempt > 1 ? ` · retry ${progress.attempt - 1}/3` : ""}
          </small>
        </>
      )}
    </div>
  );
}
function RuntimeCard({ runtime, name, description, busy, act, children }) {
  const [endpoint, setEndpoint] = useState(runtime?.baseUrl || "");
  useEffect(() => setEndpoint(runtime?.baseUrl || ""), [runtime?.baseUrl]);
  const runningTask = activeTask(runtime);
  return (
    <section
      className="settings-card local-runtime-card"
      aria-label={`${name} local runtime`}
    >
      <div className="settings-card-heading">
        <div>
          <h3>
            <HarnessLogo
              id={runtime?.id === "ollama" ? "ollama" : "comfyui-image"}
              size={19}
            />
            {name}
          </h3>
          <p>{description}</p>
        </div>
        <span className="settings-status">
          {runtime?.running
            ? "Runtime reachable"
            : runtime?.installed
              ? "Installed · stopped"
              : "Setup required"}
        </span>
      </div>
      <p>{runtime?.message || "Reading runtime status…"}</p>
      {runtime?.lastGeneration && (
        <div className="local-generation-proof" role="status">
          <Check size={14} />
          <div>
            <strong>
              Generation verified · {runtime.lastGeneration.model}
            </strong>
            <span>
              {new Date(runtime.lastGeneration.finishedAt).toLocaleString()} ·{" "}
              <a
                href={`/run/${encodeURIComponent(runtime.lastGeneration.runId)}`}
              >
                View recorded run ↗
              </a>
            </span>
            <small>
              This completed run verifies the model and endpoint used at that
              time.
            </small>
          </div>
        </div>
      )}
      {runtime && (
        <>
          <div className="local-runtime-actions">
            {!runtime.installed && (
              <button
                className="settings-button settings-primary"
                disabled={busy || runningTask}
                onClick={() => act(`/${runtime.id}/setup`, {})}
              >
                <Download size={14} />
                Install runtime
              </button>
            )}
            {!runtime.running && (
              <button
                className="settings-button"
                disabled={busy || runningTask || !runtime.installed}
                onClick={() => act(`/${runtime.id}/start`, {})}
              >
                <Play size={14} />
                Start runtime
              </button>
            )}
            {runtime.running && runtime.managed && (
              <button
                className="settings-button"
                disabled={busy || runningTask}
                onClick={() => act(`/${runtime.id}/stop`, {})}
              >
                <Square size={13} />
                Stop managed runtime
              </button>
            )}
            {runningTask && (
              <button
                className="settings-button"
                disabled={busy}
                onClick={() => act(`/${runtime.id}/cancel`, {})}
              >
                Cancel setup task
              </button>
            )}
          </div>
          <TaskProgress task={runtime.task} />
          <details className="local-model-details">
            <summary>Runtime location & endpoint</summary>
            <p>
              {runtime.managed
                ? "Managed by Flow in its local data folder."
                : "External runtimes stay under your control. Flow stops only processes it starts."}
            </p>
            <code className="local-model-path">{runtime.directory}</code>
            <code className="local-model-path">{runtime.modelDirectory}</code>
            <form
              className="local-model-inline"
              onSubmit={(event) => {
                event.preventDefault();
                act(`/${runtime.id}`, { baseUrl: endpoint }, "PUT");
              }}
            >
              <label>
                Loopback endpoint
                <input
                  aria-label={`${name} endpoint`}
                  type="url"
                  required
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder={
                    runtime.id === "ollama"
                      ? "http://127.0.0.1:11434"
                      : "http://127.0.0.1:8188"
                  }
                />
              </label>
              <button
                className="settings-button"
                disabled={busy || runningTask || endpoint === runtime.baseUrl}
              >
                Save endpoint
              </button>
            </form>
          </details>
          {children}
        </>
      )}
    </section>
  );
}
export function LocalModelsSettings({ onReload }) {
  const [state, setState] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [message, setMessage] = useState("");
  const [model, setModel] = useState("qwen3:0.6b"),
    [customModel, setCustomModel] = useState("");
  const [weight, setWeight] = useState({
    url: "",
    filename: "",
    folder: "checkpoints",
    sha256: "",
  });
  const [recipe, setRecipe] = useState({
    id: "local-image",
    name: "Local image",
    checkpoint: "",
    imageToImage: false,
  });
  const [profileText, setProfileText] = useState(""),
    [validation, setValidation] = useState({});
  const loading = useRef(false),
    mounted = useRef(false),
    catalogSignature = useRef(null);
  const load = async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await request();
      if (mounted.current) {
        setState(result);
        setLoadError("");
      }
    } catch (failure) {
      if (mounted.current) setLoadError(failure.message);
    } finally {
      loading.current = false;
    }
  };
  useEffect(() => {
    mounted.current = true;
    load();
    const timer = setInterval(load, 2500);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!state) return;
    const signature = JSON.stringify(
      state.runtimes?.map((runtime) => ({
        id: runtime.id,
        running: runtime.running,
        models: runtime.models?.map((model) => model.id || model.filename),
        task: runtime.task?.status,
      })),
    );
    if (catalogSignature.current && catalogSignature.current !== signature)
      onReload?.();
    catalogSignature.current = signature;
  }, [state, onReload]);
  const act = async (path, body, method = "POST") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request(path, method, body);
      if (path.endsWith("/validate")) {
        setValidation((old) => ({ ...old, [result.profileId]: result }));
        setMessage(
          result.valid
            ? "Profile validated against the running local runtime. Inference has not been tested."
            : "Profile needs the changes listed below.",
        );
      } else if (path === "/comfyui/profiles")
        setMessage(
          "Local workflow profile saved. Validate it before running a generation.",
        );
      await load();
      await onReload?.();
      return result;
    } catch (failure) {
      setError(failure.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const ollama = state?.runtimes?.find((runtime) => runtime.id === "ollama");
  const comfy = state?.runtimes?.find((runtime) => runtime.id === "comfyui");
  const profiles = Array.isArray(state?.profiles) ? state.profiles : [];
  const checkpoints = (comfy?.models || [])
    .filter(
      (entry) =>
        (entry.folder === "checkpoints" || entry.type === "checkpoints") &&
        (!comfy?.running ||
          comfy.managed ||
          entry.source === "runtime" ||
          entry.availableInRuntime),
    )
    .map((entry) => ({
      value: entry.filename || entry.id || entry.name,
      label: entry.filename || entry.id || entry.name,
    }));
  return (
    <div className="local-model-settings">
      <div className="settings-section-heading">
        <div>
          <h2>Local models</h2>
        </div>
        <button className="settings-button" disabled={busy} onClick={load}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {state?.hardware && (
        <div className="local-hardware">
          <Cpu size={15} />
          <span>
            {state.hardware.platform} · {state.hardware.arch} ·{" "}
            {bytes(state.hardware.memoryBytes)} memory
          </span>
        </div>
      )}
      <p className="local-model-explainer">
        Install a runtime, download a model, then select it in a workflow.
      </p>
      {(error || loadError) && (
        <p className="settings-error" role="alert">
          {error || loadError}
        </p>
      )}
      {message && (
        <p className="settings-error" role="status">
          {message}
        </p>
      )}
      <LocalModelPreset
        state={state}
        busy={busy}
        act={act}
        validation={validation}
        progress={comfy?.task?.presetId && <TaskProgress task={comfy.task} />}
      />
      <RuntimeCard
        runtime={ollama}
        name="Ollama · prompts"
        description="Local text models for prompt and scene generation. Installing the runtime does not download a model."
        busy={busy}
        act={act}
      >
        <div className="local-model-block">
          <h4>Download a text model</h4>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              act("/ollama/pull", { model: customModel.trim() || model });
            }}
          >
            <label>
              Starter model
              <Autocomplete
                label="Ollama starter model"
                value={model}
                options={presets}
                onChange={setModel}
                disabled={busy}
              />
            </label>
            <label>
              Or use a model name
              <input
                aria-label="Custom Ollama model name"
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
                placeholder="e.g. qwen3:8b"
              />
            </label>
            <button
              className="settings-button"
              disabled={busy || activeTask(ollama) || !ollama?.running}
            >
              <Download size={14} />
              Download model
            </button>
          </form>
          <p>
            Models stay local. Choose a size that fits your available memory and
            review its license before use.
          </p>
        </div>
        <div className="local-model-block">
          <h4>Installed text models</h4>
          {ollama?.models?.length ? (
            <ul className="local-installed-models">
              {ollama.models.map((entry) => (
                <li key={entry.id || entry.name}>
                  <span>{entry.id || entry.name}</span>
                  <small>{bytes(entry.sizeBytes)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No local text models detected. Start Ollama, then download one
              above.
            </p>
          )}
        </div>
      </RuntimeCard>
      <RuntimeCard
        runtime={comfy}
        name="ComfyUI · images & video"
        description="Native local media workflows. Setup installs an isolated runtime; model weights are a separate download."
        busy={busy}
        act={act}
      >
        <div className="local-model-block">
          <h4>Download model weights</h4>
          <p>
            Use a direct HTTPS .safetensors URL and its published SHA-256. Flow
            verifies the bytes before installing them.
          </p>
          <p className="local-model-download-location">
            Downloads install in Flow’s managed model folder:
            <code className="local-model-path">
              {comfy?.modelDirectory || "Loading local model directory…"}
            </code>
            {comfy?.running &&
              !comfy.managed &&
              "Your external ComfyUI runtime must include this folder in its model paths, or you can install weights in that runtime’s own model folder."}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              act("/comfyui/pull", weight);
            }}
          >
            <label>
              Model file URL
              <input
                type="url"
                required
                aria-label="Model weights URL"
                placeholder="https://…/model.safetensors"
                value={weight.url}
                onChange={(event) =>
                  setWeight({ ...weight, url: event.target.value })
                }
              />
            </label>
            <div className="local-model-pair">
              <label>
                Filename
                <input
                  required
                  pattern={"[A-Za-z0-9][A-Za-z0-9._-]{0,180}\\.safetensors"}
                  aria-label="Model weights filename"
                  placeholder="model.safetensors"
                  value={weight.filename}
                  onChange={(event) =>
                    setWeight({ ...weight, filename: event.target.value })
                  }
                />
              </label>
              <label>
                Model folder
                <Autocomplete
                  label="Model weights folder"
                  value={weight.folder}
                  options={folders.map((folder) => ({
                    value: folder,
                    label: folder,
                  }))}
                  onChange={(folder) => setWeight({ ...weight, folder })}
                  disabled={busy}
                />
              </label>
            </div>
            <label>
              SHA-256
              <input
                required
                pattern="[a-fA-F0-9]{64}"
                aria-label="Model weights SHA-256"
                placeholder="64 hexadecimal characters"
                value={weight.sha256}
                onChange={(event) =>
                  setWeight({ ...weight, sha256: event.target.value.trim() })
                }
              />
            </label>
            <button
              className="settings-button"
              disabled={busy || activeTask(comfy) || !comfy?.installed}
            >
              <Download size={14} />
              Download & verify weights
            </button>
          </form>
        </div>
        <div className="local-model-block">
          <h4>Installed media weights</h4>
          {comfy?.models?.length ? (
            <ul className="local-installed-models">
              {comfy.models.map((entry) => (
                <li key={`${entry.folder}/${entry.filename || entry.id}`}>
                  <span>
                    <Folder size={13} />
                    {entry.folder ? `${entry.folder}/` : ""}
                    {entry.filename || entry.id || entry.name}
                    <small>
                      {entry.source === "runtime" || entry.availableInRuntime
                        ? "runtime available"
                        : "managed folder"}
                    </small>
                  </span>
                  <small>{bytes(entry.sizeBytes)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No managed media weights detected.</p>
          )}
        </div>
        <div className="local-model-block">
          <h4>Create an image profile</h4>
          <p>
            Build a basic local checkpoint workflow. For video or advanced
            architectures, import a compatible API workflow below.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const profile = createCheckpointProfile(recipe);
                act("/comfyui/profiles", profile);
              } catch (failure) {
                setError(failure.message);
              }
            }}
          >
            <div className="local-model-pair">
              <label>
                Profile ID
                <input
                  required
                  aria-label="Local profile ID"
                  value={recipe.id}
                  onChange={(event) =>
                    setRecipe({ ...recipe, id: event.target.value })
                  }
                />
              </label>
              <label>
                Name
                <input
                  required
                  aria-label="Local profile name"
                  value={recipe.name}
                  onChange={(event) =>
                    setRecipe({ ...recipe, name: event.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Installed checkpoint
              <Autocomplete
                label="Installed ComfyUI checkpoint"
                value={recipe.checkpoint}
                fallbackLabel="Choose a checkpoint…"
                options={checkpoints}
                onChange={(checkpoint) => setRecipe({ ...recipe, checkpoint })}
                disabled={busy || !checkpoints.length}
              />
            </label>
            <label className="local-model-check">
              <input
                type="checkbox"
                checked={recipe.imageToImage}
                onChange={(event) =>
                  setRecipe({ ...recipe, imageToImage: event.target.checked })
                }
              />
              Use a source image · image-to-image
            </label>
            <button
              className="settings-button"
              disabled={busy || !recipe.checkpoint}
            >
              <Check size={14} />
              Save image profile
            </button>
          </form>
        </div>
        <details className="local-model-details">
          <summary>
            <FileJson size={14} />
            Import an image or video profile
          </summary>
          <p>
            Use a ComfyUI API-format graph wrapped with its prompt, optional
            image/seed bindings, and output selector. Missing custom nodes or
            weights are reported by Validate; Flow does not install custom-node
            code.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                act("/comfyui/profiles", JSON.parse(profileText));
              } catch {
                setError("Profile must be valid JSON.");
              }
            }}
          >
            <label>
              Profile JSON file
              <input
                type="file"
                accept=".json,application/json"
                aria-label="Import local profile JSON"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2 * 1024 * 1024) {
                    setError("Choose a profile smaller than 2 MB.");
                    return;
                  }
                  setProfileText(await file.text());
                }}
              />
            </label>
            <label>
              API profile JSON
              <textarea
                aria-label="Local API profile JSON"
                rows="10"
                value={profileText}
                onChange={(event) => setProfileText(event.target.value)}
                spellCheck="false"
                placeholder={
                  '{"id":"local-video","name":"Local video","kind":"video","graph":{…},"bindings":{"prompt":{"nodeId":"6","input":"text"}},"output":{"nodeId":"9","field":"videos"}}'
                }
              />
            </label>
            <button
              className="settings-button"
              disabled={busy || !profileText.trim()}
            >
              <FileJson size={14} />
              Save profile
            </button>
          </form>
        </details>
        <div className="local-model-block">
          <h4>Generation profiles</h4>
          <p>
            Profiles become selectable models on the local image or video
            provider. Validation checks installed nodes and weights; run a
            workflow to verify inference.
          </p>
          {profiles.length ? (
            <ul className="local-profile-list">
              {profiles.map((profile) => (
                <li key={profile.id}>
                  <div className="local-profile-heading">
                    <div>
                      <strong>{profile.name || profile.id}</strong>
                      <small>
                        {profile.id} · {profile.kind}
                      </small>
                    </div>
                    <button
                      className="settings-button"
                      disabled={busy || !comfy?.running}
                      onClick={() =>
                        act(
                          `/comfyui/profiles/${encodeURIComponent(profile.id)}/validate`,
                          {},
                        )
                      }
                    >
                      Validate
                    </button>
                    <button
                      className="settings-button"
                      aria-label={`Remove profile ${profile.name || profile.id}`}
                      disabled={busy}
                      onClick={() =>
                        act(
                          `/comfyui/profiles/${encodeURIComponent(profile.id)}`,
                          undefined,
                          "DELETE",
                        )
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {validation[profile.id] && (
                    <div className="local-profile-validation" role="status">
                      {validation[profile.id].valid ? (
                        "Compatible with this runtime · inference untested"
                      ) : (
                        <ul>
                          {validation[profile.id].errors?.map(
                            (issue, index) => (
                              <li key={index}>{issue}</li>
                            ),
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No image or video profiles yet.</p>
          )}
        </div>
      </RuntimeCard>
    </div>
  );
}
