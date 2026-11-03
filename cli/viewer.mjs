import { spawn } from "node:child_process";
import { localViewerUrl } from "../client/viewer.mjs";

export function viewerOpener(platform, url) {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "linux") return ["xdg-open", [url]];
  if (platform === "win32")
    return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
  throw new Error(
    `Opening the viewer is unsupported on ${platform}; use --print-url.`,
  );
}

export async function openViewer(
  receipt,
  { platform = process.platform, spawn: launch = spawn } = {},
) {
  localViewerUrl(new URL(receipt.url).origin);
  const [command, args] = viewerOpener(platform, receipt.url);
  await new Promise((resolve, reject) => {
    const child = launch(command, args, {
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Could not open the viewer (${signal || `exit ${code}`}); use --print-url.`,
            ),
          ),
    );
  });
  return { ...receipt, opened: true };
}
