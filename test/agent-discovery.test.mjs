import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { registerDiscoveryRoutes } from "../server/routes/discovery.mjs";
import { commandHelp } from "../shared/commands.mjs";

test("agents discover the same help and run constraints over HTTP as the offline CLI", async (t) => {
  const app = express();
  registerDiscoveryRoutes(app, {
    root: path.resolve(import.meta.dirname, ".."),
  });
  app.use((error, req, res, next) =>
    res.status(400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(
    await (await fetch(url + "/api/help?command=style%20start")).json(),
    commandHelp(["style", "start"]),
  );
  const schema = await (await fetch(url + "/api/schema/run")).json();
  assert.equal(schema.options.additionalProperties, false);
  assert.equal(schema.options.properties.count.maximum, 500);
  assert.equal(schema.submission.properties.concurrency.maximum, 128);
  assert.equal(schema.submission.properties.requestId.maxLength, 128);
  const setup = await fetch(url + "/api/guide/setup");
  assert.match(setup.headers.get("content-type"), /text\/markdown/);
  assert.match(await setup.text(), /npm run verify:setup/);
  assert.equal((await fetch(url + "/api/help?command=unknown")).status, 400);
});
