const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const protocols = new Set(["http/json", "http/protobuf"]);

function endpoint(value, signal, append) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OTLP export requires a valid loopback collector URL.");
  }
  if (
    !loopback.has(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "OTLP export requires a loopback collector URL without credentials, query, or fragment.",
    );
  if (append) url.pathname = url.pathname.replace(/\/$/, "") + `/v1/${signal}`;
  return url.href;
}

function positive(value, fallback, name) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error(`${name} must be a positive integer in milliseconds.`);
  return number;
}

function signalConfig(env, signal, legacy) {
  const upper = signal.toUpperCase();
  const selection = env[`OTEL_${upper}_EXPORTER`];
  if (selection !== undefined && !["none", "otlp"].includes(selection))
    throw new Error(`OTEL_${upper}_EXPORTER supports otlp or none.`);
  const specific = legacy || env[`OTEL_EXPORTER_OTLP_${upper}_ENDPOINT`];
  const base =
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    (selection === "otlp" ? "http://localhost:4318" : undefined);
  const url =
    selection === "none" ? null : endpoint(specific || base, signal, !specific);
  const protocol =
    env[`OTEL_EXPORTER_OTLP_${upper}_PROTOCOL`] ||
    env.OTEL_EXPORTER_OTLP_PROTOCOL ||
    (legacy ? "http/json" : "http/protobuf");
  if (url && !protocols.has(protocol))
    throw new Error(`OTLP ${signal} supports http/protobuf or http/json.`);
  const timeoutMillis = positive(
    env[`OTEL_EXPORTER_OTLP_${upper}_TIMEOUT`] ??
      env.OTEL_EXPORTER_OTLP_TIMEOUT,
    2000,
    `OTLP ${signal} timeout`,
  );
  return { url, protocol, timeoutMillis };
}

export function telemetryConfig(env = process.env, overrides = {}) {
  const enabled =
    (overrides.enabled ?? env.FLOW_OTEL_ENABLED !== "0") &&
    env.OTEL_SDK_DISABLED?.trim().toLowerCase() !== "true";
  if (!enabled) return { enabled: false };
  const traces = signalConfig(
    env,
    "traces",
    overrides.otlpEndpoint ?? env.FLOW_OTEL_OTLP_ENDPOINT,
  );
  const metrics = signalConfig(env, "metrics");
  const exportIntervalMillis = positive(
    env.OTEL_METRIC_EXPORT_INTERVAL,
    60000,
    "OTEL_METRIC_EXPORT_INTERVAL",
  );
  if (metrics.url && exportIntervalMillis < metrics.timeoutMillis)
    throw new Error(
      "OTEL_METRIC_EXPORT_INTERVAL must be at least the OTLP metrics timeout.",
    );
  return {
    enabled: true,
    serviceName: (env.OTEL_SERVICE_NAME || "flow").slice(0, 120),
    traces,
    metrics: { ...metrics, exportIntervalMillis },
  };
}
