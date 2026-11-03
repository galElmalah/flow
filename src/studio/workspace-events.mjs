// Hidden tabs must release HTTP/1 event streams so images and API calls can load.
export function subscribeWorkspaceEvents(
  url,
  { onMessage, onOpen, onConnection },
  {
    document = globalThis.document,
    window = globalThis.window,
    EventSource = globalThis.EventSource,
  } = {},
) {
  let source = null;
  const disconnect = () => {
    if (!source) return;
    const previous = source;
    source = null;
    previous.close();
    onConnection(false);
  };
  const connect = () => {
    if (source || document.visibilityState === "hidden") return;
    const current = new EventSource(url);
    source = current;
    current.onmessage = (event) => {
      if (source === current) onMessage(event);
    };
    current.onerror = () => {
      if (source === current) onConnection(false);
    };
    current.onopen = () => {
      if (source !== current) return;
      onConnection(true);
      onOpen();
    };
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") disconnect();
    else connect();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", disconnect);
  window.addEventListener("pageshow", connect);
  connect();
  return () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", disconnect);
    window.removeEventListener("pageshow", connect);
    disconnect();
  };
}
