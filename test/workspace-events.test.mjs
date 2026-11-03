import test from "node:test";
import assert from "node:assert/strict";
import { subscribeWorkspaceEvents } from "../src/studio/workspace-events.mjs";

function browser(visibilityState = "visible") {
  const document = Object.assign(new EventTarget(), { visibilityState });
  const window = new EventTarget();
  const sources = [],
    messages = [],
    connections = [];
  let refreshes = 0;
  class EventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  const stop = subscribeWorkspaceEvents(
    "/api/events?sessionId=scope",
    {
      onMessage: (message) => messages.push(message),
      onConnection: (connected) => connections.push(connected),
      onOpen: () => refreshes++,
    },
    { document, window, EventSource },
  );
  return {
    document,
    window,
    sources,
    messages,
    connections,
    stop,
    get refreshes() {
      return refreshes;
    },
    visibility(value) {
      document.visibilityState = value;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

test("background tabs release streams and refresh durable state when visible again", () => {
  const tabs = Array.from({ length: 8 }, () => browser("hidden"));
  assert.equal(tabs.flatMap((tab) => tab.sources).length, 0);
  for (const tab of tabs) {
    tab.visibility("visible");
    const source = tab.sources[0];
    source.onopen();
    source.onmessage("live update");
    tab.visibility("hidden");
    assert.equal(source.closed, true);
    source.onmessage("stale update");
    source.onopen();
    assert.deepEqual(tab.messages, ["live update"]);
    assert.equal(tab.refreshes, 1);
    tab.visibility("visible");
    tab.visibility("visible");
    assert.equal(tab.sources.length, 2);
    assert.equal(tab.sources[1].url, "/api/events?sessionId=scope");
    tab.sources[1].onopen();
    assert.equal(tab.refreshes, 2);
    tab.stop();
    assert.ok(tab.sources.every((source) => source.closed));
    tab.visibility("visible");
    assert.equal(tab.sources.length, 2);
  }
});

test("page cache navigation closes and restores streams without duplicate connections", () => {
  const tab = browser();
  tab.sources[0].onerror();
  assert.deepEqual(tab.connections, [false]);
  tab.window.dispatchEvent(new Event("pagehide"));
  assert.equal(tab.sources[0].closed, true);
  tab.window.dispatchEvent(new Event("pageshow"));
  tab.window.dispatchEvent(new Event("pageshow"));
  assert.equal(tab.sources.length, 2);
  tab.stop();
  tab.window.dispatchEvent(new Event("pageshow"));
  assert.equal(tab.sources.length, 2);
});
