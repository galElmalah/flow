const scrub = (text, secret) =>
  secret ? text.replaceAll(secret, "[redacted]") : text;

export function redactPreview(text, secret) {
  const safe = scrub(text, secret);
  if (!secret) return safe;
  // Hold any suffix that a later snapshot could complete into a credential.
  for (
    let length = Math.min(secret.length - 1, safe.length);
    length > 0;
    length--
  )
    if (safe.endsWith(secret.slice(0, length))) return safe.slice(0, -length);
  return safe;
}

export function redactTextResult(text, secret) {
  if (!secret) return text;
  const raw = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return scrub(text, secret);
  }
  const clean = (value, depth = 0) => {
    if (depth > 128)
      throw new Error("Provider text nesting exceeds the supported limit.");
    if (typeof value === "string") return scrub(value, secret);
    if (Array.isArray(value))
      return value.map((item) => clean(item, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          scrub(key, secret),
          clean(item, depth + 1),
        ]),
      );
    return value;
  };
  return JSON.stringify(clean(parsed));
}
