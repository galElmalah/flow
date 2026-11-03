import { spawn } from "node:child_process";
import { open, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function localUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Server lifecycle commands require an HTTP localhost URL with no path.",
    );
  return url;
}
async function inspect(url, stopping = false, allowLegacy = false) {
  let response;
  try {
    response = await fetch(new URL("/api/server", url), {
      signal: AbortSignal.timeout(5000),
      headers: { Connection: "close" },
    });
  } catch (error) {
    if (
      error.cause?.code === "ECONNREFUSED" ||
      (stopping && ["ECONNRESET", "UND_ERR_SOCKET"].includes(error.cause?.code))
    )
      return null;
    throw new Error("Could not verify the local server: " + error.message, { cause: error });
  }
  let info;
  try {
    info = await response.json();
  } catch {}
  if (!response.ok || !(info?.application === "flow" || (allowLegacy && info?.application === "weft")))
    throw new Error(
      "This port is already serving an unrecognized app. No process was changed.",
    );
  return info;
}
function sameWorkspace(info, root, dataRoot) {
  if (info.root !== root || info.dataDirectory !== dataRoot)
    throw new Error(
      "This port belongs to a different Flow workspace. No process was changed.",
    );
}
export async function startServer({ url: address, root, dataRoot }) {
  const url = localUrl(address);
  root = path.resolve(root);
  dataRoot = path.resolve(dataRoot);
  const existing = await inspect(url);
  if (existing) {
    sameWorkspace(existing, root, dataRoot);
    return { ...existing, url: url.origin, alreadyRunning: true };
  }
  await mkdir(dataRoot, { recursive: true });
  const lockPath = path.join(dataRoot, "server-start.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = Number(await readFile(lockPath, "utf8"));
    let alive = true;
    if (Number.isSafeInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
      } catch (error) {
        if (error.code === "ESRCH") alive = false;
      }
    }
    if (alive)
      throw new Error(
        "A server start is already in progress. Try again shortly.",
      );
    await unlink(lockPath);
    lock = await open(lockPath, "wx");
  }
  await lock.writeFile(String(process.pid));
  let child;
  try {
    const log = await open(path.join(dataRoot, "server.log"), "a");
    try {
      child = spawn(
        process.execPath,
        [path.join(root, "server/index.mjs"), "--production"],
        {
          cwd: root,
          detached: true,
          stdio: ["ignore", log.fd, log.fd],
          env: {
            ...process.env,
            PORT: url.port || "80",
            FLOW_DATA_DIR: dataRoot,
          },
        },
      );
      let spawnError;
      child.on("error", (error) => {
        spawnError = error;
      });
      child.unref();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null)
          throw new Error(
            `Server exited with code ${child.exitCode}. Check ${path.join(dataRoot, "server.log")}.`,
          );
        const info = await inspect(url);
        if (info?.ready) {
          sameWorkspace(info, root, dataRoot);
          if (info.pid !== child.pid)
            throw new Error("Another server took this port during startup.");
          return { ...info, url: url.origin, alreadyRunning: false };
        }
        await wait(100);
      }
      throw new Error(
        `Server did not become ready. Check ${path.join(dataRoot, "server.log")}.`,
      );
    } finally {
      await log.close();
    }
  } catch (error) {
    if (child?.pid && child.exitCode === null) child.kill("SIGTERM");
    throw error;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}
export async function stopServer({
  url: address,
  root,
  dataRoot,
  force = false,
  allowLegacy = false,
}) {
  const url = localUrl(address);
  root = path.resolve(root);
  dataRoot = path.resolve(dataRoot);
  const info = await inspect(url, false, allowLegacy);
  if (!info) return { stopped: true, alreadyStopped: true, url: url.origin };
  sameWorkspace(info, root, dataRoot);
  const owned = JSON.parse(
    await readFile(path.join(dataRoot, "server.json"), "utf8"),
  );
  if (
    owned.pid !== info.pid ||
    owned.instanceId !== info.instanceId ||
    !Number.isSafeInteger(info.pid) ||
    info.pid <= 0
  )
    throw new Error(
      "The server ownership record does not match. No process was changed.",
    );
  if (info.activeJobs && !force)
    throw new Error(
      `${info.activeJobs} image jobs are active. Pause and finish them, or use --force to interrupt them.`,
    );
  process.kill(info.pid, "SIGTERM");
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    try {
      const current = await inspect(url, true, allowLegacy);
      if (!current || current.instanceId !== info.instanceId)
        return { stopped: true, alreadyStopped: false, url: url.origin };
    } catch (error) {
      if (error.cause?.name !== "TimeoutError") throw error;
    }
    await wait(100);
  }
  // A suspended client may resume after the server has already finished draining.
  const final = await inspect(url, true, allowLegacy);
  if (!final || final.instanceId !== info.instanceId)
    return { stopped: true, alreadyStopped: false, url: url.origin };
  throw new Error("The server has not stopped yet. Check server.log.");
}
