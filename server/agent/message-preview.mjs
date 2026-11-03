const skipSpace = (source, position) => {
  while (position < source.length && /\s/.test(source[position])) position++;
  return position;
};

function stringValue(source, position) {
  if (source[position] !== '"') return null;
  const start = position++;
  let end = position;
  const partial = () => {
    try {
      let value = JSON.parse(source.slice(start, end) + '"');
      if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
      return { value, complete: false, end };
    } catch {
      return null;
    }
  };
  while (position < source.length) {
    const char = source[position];
    if (char === '"') {
      try {
        return {
          value: JSON.parse(source.slice(start, position + 1)),
          complete: true,
          end: position + 1,
        };
      } catch {
        return null;
      }
    }
    if (char === "\\") {
      const escape = source[position + 1];
      if (escape === undefined) return partial();
      if (escape === "u") {
        const hex = source.slice(position + 2, position + 6);
        if (!/^[0-9a-f]*$/i.test(hex)) return null;
        if (hex.length < 4) return partial();
        position += 6;
      } else {
        if (!'"\\/bfnrt'.includes(escape)) return null;
        position += 2;
      }
    } else {
      if (char.charCodeAt(0) < 32) return null;
      position++;
    }
    end = position;
  }
  return partial();
}

function skipValue(source, position) {
  if (source[position] === '"') {
    const value = stringValue(source, position);
    return value?.complete ? value.end : null;
  }
  if (source[position] === "{" || source[position] === "[") {
    const stack = [];
    while (position < source.length) {
      const char = source[position];
      if (char === '"') {
        const value = stringValue(source, position);
        if (!value?.complete) return null;
        position = value.end;
        continue;
      }
      if (char === "{" || char === "[") {
        stack.push(char);
        if (stack.length > 128) return null;
      } else if (char === "}" || char === "]") {
        if (stack.pop() !== (char === "}" ? "{" : "[")) return null;
        if (!stack.length) return position + 1;
      }
      position++;
    }
    return null;
  }
  const start = position;
  while (position < source.length && !",}".includes(source[position]))
    position++;
  if (position === source.length) return null;
  try {
    JSON.parse(source.slice(start, position));
    return position;
  } catch {
    return null;
  }
}

// Only the root message string is public. Nested edits and wire events stay private.
export function agentMessagePreview(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 128 * 1024)
    return null;
  const source = raw.trimStart().replace(/^```(?:json)?\s*/i, "");
  let position = skipSpace(source, 0);
  if (source[position++] !== "{") return null;
  while (position < source.length) {
    position = skipSpace(source, position);
    const key = stringValue(source, position);
    if (!key?.complete) return null;
    position = skipSpace(source, key.end);
    if (source[position++] !== ":") return null;
    position = skipSpace(source, position);
    if (key.value === "message") {
      const value = stringValue(source, position);
      return value ? value.value.slice(0, 16000) : null;
    }
    position = skipValue(source, position);
    if (position === null) return null;
    position = skipSpace(source, position);
    if (source[position++] !== ",") return null;
  }
  return null;
}
