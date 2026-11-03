import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  runCodexText,
  invocation,
} from "../harness-integrations/codex/text-stream.mjs";

async function fixture(t, mode = "success") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "weft-codex-stream-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, "codex-fixture.mjs");
  await writeFile(
    executable,
    `#!${process.execPath}
import { createInterface } from 'node:readline';
import { appendFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const mode = ${JSON.stringify(mode)};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const scope = {threadId:'thread',turnId:'turn'};
const item = (id,text,phase='final_answer') => ({type:'agentMessage',id,text,phase});
const note = (method,params) => send({method,params});
const answer = '{"message":"Hello 🏊 world","edits":[],"focusNodeIds":[]}';
for await (const line of createInterface({input:process.stdin})) {
 const req = JSON.parse(line);
 await appendFile('received.ndjson',JSON.stringify({args:process.argv.slice(2),authScope:process.env.WEFT_TEST_AUTH_SCOPE,request:req})+'\\n');
 if(req.method==='initialize') send({id:req.id,result:{}});
 if(req.method==='config/read') send({id:req.id,result:{config:{mcp_servers:{'unsafe.server':{enabled:true,command:'fixture',tool_timeout_sec:null}}}}});
 if(req.method==='thread/start') send({id:req.id,result:{thread:{id:'thread'},approvalPolicy:'never',sandbox:{type:mode==='unsafe'?'dangerFullAccess':'readOnly'}}});
 if(req.method!=='turn/start') continue;
 send({id:req.id,result:{turn:{id:'turn'}}});
 if(mode==='request') { send({id:99,method:'item/tool/call',params:{...scope,name:'danger'}}); continue; }
 if(mode==='cap') { process.stdout.write('x'.repeat(2*1024*1024+1)); continue; }
 if(mode==='descendant') {
   const child = spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"],{stdio:'ignore'});
   await writeFile('descendant.pid',String(child.pid)); await sleep(150);
 }
 note('item/started',{...scope,item:item('reasoning','secret reasoning','commentary')});
 note('item/agentMessage/delta',{...scope,itemId:'reasoning',delta:'secret reasoning'});
 note('item/reasoning/textDelta',{...scope,delta:'never show this'});
 note('item/started',{...scope,item:item('answer','',null)});
 note('item/agentMessage/delta',{...scope,threadId:'another',itemId:'answer',delta:'WRONG THREAD'});
 note('item/agentMessage/delta',{...scope,turnId:'another',itemId:'answer',delta:'WRONG TURN'});
 const first = {method:'item/agentMessage/delta',params:{...scope,itemId:'answer',delta:'{"message":"Hello 🏊'}};
 const bytes=Buffer.from(JSON.stringify(first)+'\\n'); const split=bytes.indexOf(Buffer.from('🏊'))+2;
 process.stdout.write(bytes.subarray(0,split)); await sleep(5); process.stdout.write(bytes.subarray(split));
 if(mode==='hang' || mode==='descendant') continue;
 await sleep(100);
 note('item/agentMessage/delta',{...scope,itemId:'answer',delta:' world","edits":[],"focusNodeIds":[]}'});
 note('item/completed',{...scope,item:item('answer',answer)});
 note('turn/completed',{threadId:'another',turn:{id:'turn',status:'failed'}});
 note('turn/completed',{threadId:'thread',turn:{id:'turn',status:mode==='failure'?'failed':'completed',items:[item('answer',answer)]}});
}
`,
  );
  await chmod(executable, 0o700);
  return {
    directory,
    provider: { executable, name: "Codex", timeoutMs: 30000 },
    context: {
      directory,
      imagePaths: ["/reference.png"],
      job: {
        purpose: "app-assistant",
        prompt: "literal $(command)",
        model: "fixture-model",
        reasoningEffort: "medium",
      },
    },
  };
}

test("Codex streams genuine scoped final-answer deltas before successful completion and reconciles final text", async (t) => {
  const f = await fixture(t);
  const updates = [];
  let completed = false;
  const result = runCodexText(f.provider, {
    ...f.context,
    onText: (text) => updates.push({ text, completed }),
  }).then((text) => {
    completed = true;
    return text;
  });
  const text = await result;
  assert.equal(
    text,
    '{"message":"Hello 🏊 world","edits":[],"focusNodeIds":[]}',
  );
  assert.equal(updates[0].text, '{"message":"Hello 🏊');
  assert.ok(updates.every((update) => !update.completed));
  assert.equal(updates.at(-1).text, text);
  assert.ok(
    !JSON.stringify(updates).match(/secret reasoning|never show|WRONG|�/),
  );
  const received = (
    await readFile(path.join(f.directory, "received.ndjson"), "utf8")
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  const start = received.find((row) => row.request.method === "thread/start")
    .request.params;
  assert.equal(start.ephemeral, true);
  assert.equal(start.approvalPolicy, "never");
  assert.equal(start.sandbox, "read-only");
  assert.equal(start.model, "fixture-model");
  assert.equal(start.config.mcp_servers["unsafe.server"].enabled, false);
  assert.ok(!("tool_timeout_sec" in start.config.mcp_servers["unsafe.server"]));
  const turn = received.find((row) => row.request.method === "turn/start")
    .request.params;
  assert.equal(
    turn.effort,
    "medium",
    "per-turn effort reaches Codex without changing global configuration",
  );
  assert.ok(turn.input[0].text.includes("literal $(command)"));
  assert.deepEqual(turn.input[1], {
    type: "localImage",
    path: "/reference.png",
  });
  assert.ok(
    received.every(
      (row) => !row.args.some((arg) => arg.includes("literal $(command)")),
    ),
  );
  const args = invocation(f.context).args;
  for (const feature of [
    "shell_tool",
    "unified_exec",
    "image_generation",
    "plugins",
    "apps",
  ])
    assert.ok(
      args.some(
        (arg, index) => arg === feature && args[index - 1] === "--disable",
      ),
    );
});

test("Codex partial output never turns a failed turn into success", async (t) => {
  const f = await fixture(t, "failure"),
    updates = [];
  await assert.rejects(
    runCodexText(f.provider, {
      ...f.context,
      onText: (text) => updates.push(text),
    }),
    /turn failed/,
  );
  assert.ok(updates.length > 0);
});

test("Codex cancels an active stream and rejects late final output", async (t) => {
  const f = await fixture(t, "hang"),
    controller = new AbortController();
  const updates = [];
  const task = runCodexText(f.provider, {
    ...f.context,
    signal: controller.signal,
    onText: (text) => {
      updates.push(text);
      controller.abort();
    },
  });
  await assert.rejects(task, /Cancelled/);
  assert.equal(updates.length, 1);
});

test("Codex rejects tools, unsafe sandbox responses, oversized protocol output and timeout", async (t) => {
  for (const [mode, pattern] of [
    ["request", /tool or approval/],
    ["unsafe", /read-only/],
    ["cap", /exceeded 2 MB/],
    ["hang", /timed out/],
  ]) {
    const f = await fixture(t, mode);
    await assert.rejects(
      runCodexText(
        {
          ...f.provider,
          timeoutMs: mode === "hang" ? 200 : f.provider.timeoutMs,
        },
        f.context,
      ),
      pattern,
    );
  }
});

test("Codex callback failures reject safely instead of escaping a process event", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    runCodexText(f.provider, {
      ...f.context,
      onText() {
        throw new Error("preview limit");
      },
    }),
    /preview limit/,
  );
});

test("Codex cancellation escalates the process group after the leader has exited", async (t) => {
  const f = await fixture(t, "descendant"),
    controller = new AbortController();
  const task = runCodexText(f.provider, {
    ...f.context,
    signal: controller.signal,
    onText() {
      controller.abort();
    },
  });
  await assert.rejects(task, /Cancelled/);
  const pid = Number(
    await readFile(path.join(f.directory, "descendant.pid"), "utf8"),
  );
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  t.after(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  });
  assert.ok(alive(), "fixture descendant initially resists SIGTERM");
  const deadline = Date.now() + 3000;
  while (alive() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    alive(),
    false,
    "SIGKILL reaches the remaining group after its leader closes",
  );
});

test("Codex text jobs use the selected isolated authentication environment", async (t) => {
  const f = await fixture(t);
  await runCodexText(f.provider, {
    ...f.context,
    codexExecution: {
      env: { ...process.env, WEFT_TEST_AUTH_SCOPE: "managed-oauth" },
      args: ["-c", 'forced_login_method="chatgpt"'],
    },
  });
  const records = (
    await readFile(path.join(f.directory, "received.ndjson"), "utf8")
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(records.every((r) => r.authScope === "managed-oauth"));
  assert.ok(
    records.every((r) => r.args[1] === 'forced_login_method="chatgpt"'),
  );
});
