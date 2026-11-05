import { pipeline, env } from "@huggingface/transformers";

export const model = "Xenova/all-MiniLM-L6-v2";
export const revision = "751bff37182d3f1213fa05d7196b954e230abad9";

export function loadSearchModel({
  cacheDir,
  allowDownload = false,
  load = pipeline,
}) {
  env.cacheDir = cacheDir;
  env.allowRemoteModels = allowDownload;
  return load("feature-extraction", model, {
    revision,
    local_files_only: !allowDownload,
    dtype: "q8",
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
}
