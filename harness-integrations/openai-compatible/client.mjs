async function request(provider, route, { signal, body } = {}) {
  return fetch(provider.baseUrl.replace(/\/$/, "") + route, {
    method: body ? "POST" : "GET",
    headers: {
      ...(provider.apiKey
        ? { Authorization: `Bearer ${provider.apiKey}` }
        : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(provider.timeoutMs || 30000),
    ]),
    redirect: "error",
  });
}

async function readJson(response) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024)
      throw new Error("API response exceeded 2 MB.");
    chunks.push(chunk);
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new Error(`Endpoint returned non-JSON (HTTP ${response.status}).`);
  }
  if (!response.ok)
    throw new Error(
      `HTTP ${response.status}: ${String(result.error?.message || "API request failed").slice(0, 1000)}`,
    );
  return result;
}

export async function apiJson(provider, route, options = {}) {
  return readJson(await request(provider, route, options));
}

// A streaming request is never retried as JSON: that could charge for two jobs.
export async function apiStream(provider, route, { onEvent, ...options } = {}) {
  const response = await request(provider, route, options);
  if (
    !response.ok ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("text/event-stream")
  )
    return { kind: "json", value: await readJson(response) };
  const decoder = new TextDecoder();
  let length = 0,
    pending = "",
    lines = [],
    done = false,
    skipLF = false;
  const dispatch = () => {
    const data = lines.join("\n");
    lines = [];
    if (!data) return;
    if (data === "[DONE]") {
      done = true;
      return;
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error("Endpoint returned invalid streaming JSON.");
    }
    onEvent(event);
  };
  const consume = (text) => {
    for (const character of text) {
      if (done) break;
      if (skipLF) {
        skipLF = false;
        if (character === "\n") continue;
      }
      if (character === "\r" || character === "\n") {
        const line = pending;
        pending = "";
        skipLF = character === "\r";
        if (!line) dispatch();
        else if (line.startsWith("data:"))
          lines.push(line.slice(5).replace(/^ /, ""));
      } else pending += character;
    }
  };
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024)
      throw new Error("API response exceeded 2 MB.");
    consume(decoder.decode(chunk, { stream: true }));
    if (done) break;
  }
  consume(decoder.decode());
  if (!done && pending) consume("\n");
  if (!done) dispatch();
  return { kind: "stream", done };
}
