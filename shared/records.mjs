export function parseRecords(source) {
  let rows;
  const trimmed = source.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let value;
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new Error(
        "The JSON file is invalid. Use an array of quote records.",
      );
    }
    rows = Array.isArray(value) ? value : value.records;
  } else {
    const cells = [];
    let row = [],
      cell = "",
      quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"') {
        if (quoted && source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = !quoted;
      } else if (!quoted && (ch === "," || ch === "\n" || ch === "\r")) {
        row.push(cell);
        cell = "";
        if (ch !== ",") {
          if (ch === "\r" && source[i + 1] === "\n") i++;
          if (row.some(Boolean)) cells.push(row);
          row = [];
        }
      } else cell += ch;
    }
    if (quoted) throw new Error("A CSV field has an unclosed quote.");
    if (cell || row.length) {
      row.push(cell);
      if (row.some(Boolean)) cells.push(row);
    }
    const headers = cells.shift()?.map((x) => x.replace(/^\uFEFF/, "").trim());
    if (!headers?.length || new Set(headers).size !== headers.length)
      throw new Error(
        "CSV needs unique column headers such as quote, author, and scene.",
      );
    rows = cells.map((values, index) => {
      if (values.length !== headers.length)
        throw new Error(
          `CSV row ${index + 2} has a different number of fields than its header.`,
        );
      return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
    });
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 500)
    throw new Error("Import 1–500 records.");
  const ids = new Set();
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error(`Record ${index + 1} must be an object.`);
    const fields =
      row.fields ||
      Object.fromEntries(
        Object.entries(row).filter(([k]) => !["id", "images"].includes(k)),
      );
    if (
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields) ||
      !Object.keys(fields).length ||
      Object.keys(fields).length > 100
    )
      throw new Error(`Record ${index + 1} needs fields.`);
    const normalized = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key))
        throw new Error(
          `Column “${key}” must start with a letter and contain only letters, numbers, or underscores.`,
        );
      if (
        !["string", "number", "boolean"].includes(typeof value) &&
        value !== null
      )
        throw new Error(`Column “${key}” needs a text value.`);
      normalized[key] = value === null ? "" : String(value);
      if (normalized[key].length > 16000)
        throw new Error(`Column “${key}” exceeds 16,000 characters.`);
    }
    const id = String(row.id || normalized.readingID || `row-${index + 1}`);
    if (!id || id.length > 160 || ids.has(id))
      throw new Error(
        "Every record needs a unique ID of at most 160 characters.",
      );
    ids.add(id);
    if (
      row.images &&
      (!Array.isArray(row.images) ||
        row.images.length > 16 ||
        row.images.some((x) => typeof x !== "string" || x.length > 500))
    )
      throw new Error("Record image references are invalid.");
    return {
      id,
      fields: normalized,
      ...(row.images ? { images: row.images } : {}),
    };
  });
}
export function expandTemplate(template, context) {
  const parts = [];
  let offset = 0,
    usesInput = false;
  for (const match of template.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g)) {
    if (match.index > offset)
      parts.push({ literal: template.slice(offset, match.index) });
    const key = match[1];
    if (key === "input") {
      parts.push(...context.text);
      usesInput = true;
    } else if (Object.hasOwn(context.fields || {}, key))
      parts.push({ literal: context.fields[key] });
    else
      throw new Error(
        `Template field “${key}” is missing. Connect a quote list with that column.`,
      );
    offset = match.index + match[0].length;
  }
  if (offset < template.length) parts.push({ literal: template.slice(offset) });
  const compact = [];
  for (const part of parts) {
    if (part.literal !== undefined && compact.at(-1)?.literal !== undefined)
      compact.at(-1).literal += part.literal;
    else compact.push({ ...part });
  }
  return usesInput ? compact : [...context.text, ...compact];
}
