import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  chmod,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { CodexConnection } from "../harness-integrations/codex/connection.mjs";
import { registerProviderRoutes } from "../server/routes/providers.mjs";
import { FlowClient } from "../client/index.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "flow-codex-auth-"));
  const executable = path.join(directory, "codex-fixture.mjs");
  await writeFile(
    executable,
    `#!${process.execPath}
import {readFile,writeFile,mkdir,appendFile,access} from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2), home=process.env.CODEX_HOME;
if(args.includes('--version')) {console.log('codex-fixture 1');process.exit(0);}
if(args.includes('features')) {console.log('image_generation stable true');process.exit(0);}
if(args.includes('status')) {
 try {const auth=JSON.parse(await readFile(path.join(home,'auth.json'),'utf8')); console.log(auth.mode==='api-key' ? 'Logged in using an API key - '+auth.secret : 'Logged in using ChatGPT');}catch{console.error('Not logged in');process.exit(1);}process.exit(0);
}
await mkdir(home,{recursive:true});
await appendFile(path.join(home,'arguments.jsonl'),JSON.stringify({args,envKey:process.env.OPENAI_API_KEY,envToken:process.env.CODEX_API_KEY})+'\\n');
if(args.includes('--with-api-key')) {
 let key='';for await(const chunk of process.stdin)key+=chunk;
 if(key.trim()==='reject-key') {console.error('reject-key raw secret');process.exit(1);}
 await writeFile(path.join(home,'auth.json'),JSON.stringify({mode:'api-key',secret:key.trim()}));process.exit(0);
}
if(args.includes('--device-auth')) {
 console.log('https://evil.example/tokens/NEVER-SHOW');
 console.log('https://auth.openai.com/codex/device');
 console.log('ABCD-EFGHI');console.error('access_token: SECRET-OAUTH-TOKEN');
 const timer=setInterval(async()=>{try{await access(path.join(home,'approved'));await writeFile(path.join(home,'auth.json'),JSON.stringify({mode:'oauth',secret:'SECRET-OAUTH-TOKEN'}));clearInterval(timer);process.exit(0);}catch{}},20);
}
`,
  );
  await chmod(executable, 0o755);
  const connection = new CodexConnection({ dataRoot: directory, executable });
  t.after(async () => {
    connection.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, connection };
}
async function until(fn) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("Timed out waiting for fixture sign-in");
}

test("Codex defaults to the existing harness; API-key login is isolated, durable and write-only", async (t) => {
  const { connection, directory } = await fixture(t);
  assert.equal((await connection.execution()).mode, "harness");
  assert.deepEqual((await connection.execution()).args, []);
  const envBefore = {
    home: process.env.CODEX_HOME,
    key: process.env.OPENAI_API_KEY,
  };
  const value = await connection.configure({
    mode: "api-key",
    apiKey: "SECRET-API-KEY",
  });
  assert.equal(value.mode, "api-key");
  assert.equal(value.authMethod, "api-key");
  assert.equal(value.signedIn, true);
  assert.equal(value.hasApiKey, true);
  assert.ok(!JSON.stringify(value).includes("SECRET-API-KEY"));
  const execution = await connection.execution();
  assert.equal(execution.env.OPENAI_API_KEY, undefined);
  assert.equal(execution.env.CODEX_API_KEY, undefined);
  assert.equal(
    execution.env.CODEX_HOME,
    path.join(directory, "private/codex/api-key"),
  );
  assert.ok(!JSON.stringify(execution).includes("SECRET-API-KEY"));
  const args = await readFile(
    path.join(execution.env.CODEX_HOME, "arguments.jsonl"),
    "utf8",
  );
  assert.ok(!args.includes("SECRET-API-KEY"));
  assert.match(args, /with-api-key/);
  assert.equal(
    (await stat(path.join(execution.env.CODEX_HOME, "auth.json"))).mode & 0o777,
    0o600,
  );
  const restarted = new CodexConnection({
    dataRoot: directory,
    executable: connection.executable,
  });
  assert.equal((await restarted.status()).authMethod, "api-key");
  await restarted.configure({ mode: "harness" });
  assert.deepEqual((await restarted.execution()).args, []);
  assert.deepEqual(
    { home: process.env.CODEX_HOME, key: process.env.OPENAI_API_KEY },
    envBefore,
  );
  await assert.rejects(
    restarted.configure({ mode: "api-key", apiKey: "reject-key" }),
    (e) => !e.message.includes("reject-key"),
  );
  assert.equal(await restarted.mode(), "harness");
});

test("OAuth device sign-in exposes only the official URL and code, resumes status and supports cancellation", async (t) => {
  const { connection } = await fixture(t);
  await assert.rejects(connection.startLogin(), /Select ChatGPT OAuth/);
  await connection.configure({ mode: "oauth" });
  assert.equal((await connection.status()).signedIn, false);
  await connection.startLogin();
  const login = await until(async () => {
    const s = await connection.status();
    return s.login?.status === "pending" && s;
  });
  assert.equal(login.login.url, "https://auth.openai.com/codex/device");
  assert.equal(login.login.code, "ABCD-EFGHI");
  assert.ok(!JSON.stringify(login).includes("SECRET"));
  assert.ok(!JSON.stringify(login).includes("evil.example"));
  await assert.rejects(
    connection.configure({ mode: "harness" }),
    (e) => e.status === 409,
  );
  await connection.cancelLogin();
  assert.equal((await connection.status()).login.status, "cancelled");
  await connection.startLogin();
  const execution = await connection.execution();
  await writeFile(
    path.join(execution.env.CODEX_HOME, "approved"),
    "fixture approval",
  );
  const complete = await until(async () => {
    const s = await connection.status();
    return s.login?.status === "completed" && s;
  });
  assert.equal(complete.authMethod, "chatgpt");
  assert.equal(complete.signedIn, true);
  assert.ok(!JSON.stringify(complete).includes("SECRET-OAUTH-TOKEN"));
});

test("Codex HTTP/client configuration rejects active jobs and invalid input; health follows selected login", async (t) => {
  const { connection, directory } = await fixture(t);
  const { codexStatus } =
    await import("../harness-integrations/codex/status.mjs");
  const providers = {
    codex: connection,
    definitions: new Map(),
    statusCache: new Map(),
    catalog: async () => [],
    reload: async () => [],
    codexHealth: async () =>
      codexStatus({
        ...(await connection.execution()),
        executable: connection.executable,
      }),
  };
  const queue = { active: new Map(), concurrency: 4 };
  const usage = { cache: new Map(), read: async () => ({ accounts: [] }) };
  const app = express();
  app.use(express.json());
  registerProviderRoutes(app, {
    root: directory,
    dataRoot: directory,
    queue,
    providers,
    usage,
  });
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const client = new FlowClient({
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await assert.rejects(
    client.configureCodex({ mode: "unknown" }),
    (e) => e.status === 400,
  );
  queue.active.set("job", {});
  await assert.rejects(
    client.configureCodex({ mode: "api-key", apiKey: "PRIVATE" }),
    (e) => e.status === 409,
  );
  queue.active.clear();
  const configured = await client.configureCodex({
    mode: "api-key",
    apiKey: "PRIVATE",
  });
  assert.equal(configured.authMethod, "api-key");
  assert.equal((await client.codexConnection()).mode, "api-key");
  assert.equal((await client.request("/api/health")).authMethod, "api-key");
  await client.configureCodex({ mode: "oauth" });
  await client.startCodexLogin();
  await client.cancelCodexLogin();
  assert.equal((await client.codexConnection()).login.status, "cancelled");
});
