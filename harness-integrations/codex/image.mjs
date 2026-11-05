import { spawn } from "node:child_process";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { codexBin } from "./status.mjs";
import { verifyImage } from "../shared/image.mjs";
import { spriteGrid } from "../shared/image-output.mjs";
export async function runCodexImage({
  job,
  directory,
  imagePaths,
  signal,
  onProgress,
  codexExecution,
}) {
  await mkdir(directory, { recursive: true });
  const output = path.join(directory, "output.png");
  await unlink(output).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const args = [
    ...(codexExecution?.args || []),
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "-c",
    'approval_policy="never"',
    "--json",
    "-C",
    directory,
    "-o",
    path.join(directory, "response.txt"),
  ];
  for (const image of imagePaths) args.push("--image", image);
  args.push("-");
  const animation = job.image?.outputFormat === "gif";
  const count = job.image?.frameCount || 9;
  const { columns, rows } = spriteGrid(count);
  const brief = animation
    ? `Create ONE animation sprite sheet for a seamless looping GIF. Exactly ${count} sequential frames arranged in a precise ${columns}-column by ${rows}-row grid, read left to right then top to bottom. Every cell must have identical dimensions, no borders, no gutters, no labels. ${columns * rows > count ? "Leave unused final cells blank." : ""} Keep camera, character identity, scale and composition fixed across frames; use clear incremental motion and a final frame that transitions to the first. Each frame has aspect ratio ${job.ratio}. Request a sheet size divisible by ${columns} horizontally and ${rows} vertically. Flow will extract and encode the frames locally at ${job.image?.frameDurationMs || 200} ms per frame; do not assemble the GIF yourself.\n\n${job.prompt}`
    : job.prompt;
  const prompt = `Generate exactly ONE image with your built-in image generation tool. ${imagePaths.length ? "Edit/use the attached reference images; preserve the aspects the brief requests." : ""}\n\nCREATIVE BRIEF\n${brief}\n\nOUTPUT\n${animation ? "Return the complete sprite sheet as a single PNG." : `Requested aspect ratio: ${job.ratio}.${job.ratio === "2:1" ? " Generate the ORIGINAL at exactly 2048 x 1024 pixels (2:1 landscape). Pass this native image size to the image tool if supported. Do not crop, pad, resize, or recolor the returned image." : ""}`} ${job.image?.background === "transparent" ? "Set transparent_background:true on the image generation tool." : job.image?.background === "opaque" ? "Use an opaque background." : ""} Quality: ${job.quality}. Variation label: ${job.seed}. Use this label to explore a distinct interpretation; it is not a deterministic model seed.\nSave the ORIGINAL raster image returned by the image tool to this exact path: ${output}\nIf the tool returns a generated image file path, copy it to that path. Do not replace the image with SVG, canvas, code, or a placeholder. Do not call another provider or invoke an image API directly. If image generation is unavailable, report failure and do not create a substitute. You may use shell commands only to copy the generated file and verify it. Do not change files outside this job directory. Return the saved path.\n`;
  const log = await open(path.join(directory, "events.jsonl"), "w");
  const errLog = await open(path.join(directory, "stderr.log"), "w");
  let child;
  try {
    await new Promise((resolve, reject) => {
      child = spawn(codexBin, args, {
        cwd: directory,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: { ...(codexExecution?.env || process.env), NO_COLOR: "1" },
      });
      let buffer = "",
        stderr = "";
      let timedOut = false;
      const terminate = () => {
        try {
          if (process.platform === "win32") child.kill("SIGTERM");
          else process.kill(-child.pid, "SIGTERM");
        } catch {}
      };
      const timeout = setTimeout(
        () => {
          timedOut = true;
          terminate();
        },
        20 * 60 * 1000,
      );
      const abort = () => terminate();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) terminate();
      child.stdout.on("data", (chunk) => {
        log.write(chunk).catch(() => {});
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines)
          try {
            const event = JSON.parse(line);
            if (event.item?.type === "agent_message" && event.item.text)
              onProgress?.(event.item.text.slice(0, 500));
            if (event.type === "turn.failed")
              stderr = event.error?.message || "Codex turn failed.";
          } catch {}
        if (buffer.length > 2 * 1024 * 1024) buffer = "";
      });
      child.stderr.on("data", (chunk) => {
        errLog.write(chunk).catch(() => {});
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(new Error("Cancelled"));
        else if (timedOut)
          reject(new Error("The image job exceeded the 20 minute time limit."));
        else if (code !== 0)
          reject(
            new Error(`Codex exited with code ${code}. ${stderr.slice(-1000)}`),
          );
        else resolve();
      });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
    await verifyImage(output);
    return output;
  } catch (error) {
    if (error.code === "ENOENT" && child) {
      const response = await readFile(
        path.join(directory, "response.txt"),
        "utf8",
      ).catch(() => "");
      throw new Error(
        `Codex did not save an image. ${response.slice(-700) || "See the job log for details."}`,
      );
    }
    throw error;
  } finally {
    await log.close();
    await errLog.close();
  }
}
