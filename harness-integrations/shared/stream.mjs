const MAX_TEXT_BYTES = 128 * 1024;

// stdout has already passed through a streaming UTF-8 decoder. Split on LF only:
// Unicode line separators are valid JSON string content, particularly in Pi.
export function jsonLines(onEvent) {
  let pending = "";
  const line = (value) => {
    if (!value.trim()) return;
    let event;
    try {
      event = JSON.parse(value);
    } catch {
      throw new Error("Harness returned invalid streaming JSON.");
    }
    onEvent(event);
  };
  return {
    write(text) {
      pending += text;
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        line(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    },
    end() {
      line(pending);
      pending = "";
    },
  };
}

export function textSnapshots(onText = () => {}) {
  let value = "";
  return {
    get value() {
      return value;
    },
    set(text) {
      if (typeof text !== "string") return;
      if (Buffer.byteLength(text) > MAX_TEXT_BYTES)
        throw new Error("Harness answer exceeded 128 KB.");
      if (text !== value) {
        value = text;
        onText(value);
      }
    },
    append(text) {
      if (typeof text === "string") this.set(value + text);
    },
  };
}
