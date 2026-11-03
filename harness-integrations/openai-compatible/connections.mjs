import { readFile, mkdir, writeFile, chmod, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  connectionSchema,
  endpointSchema,
} from "../../shared/provider-connections.mjs";

const persistedConnection = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: connectionSchema.shape.name,
  description: z.string().max(600).default("Your OpenAI-compatible endpoint"),
  baseUrl: endpointSchema,
  models: connectionSchema.shape.models,
  apiKey: z.string().min(1).max(4096).optional(),
});

export class ConnectionStore {
  constructor(dataRoot) {
    this.file = path.join(dataRoot, "connections.json");
    this.pending = Promise.resolve();
  }
  async load() {
    try {
      return z
        .array(persistedConnection)
        .max(50)
        .parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new Error(
        "Could not read private connections. Check local connection configuration.",
      );
    }
  }
  mutate(operation) {
    const task = this.pending.catch(() => {}).then(operation);
    this.pending = task;
    return task;
  }
  async write(entries) {
    const safe = z.array(persistedConnection).max(50).parse(entries);
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = this.file + ".tmp";
    await writeFile(temp, JSON.stringify(safe, null, 2), { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, this.file);
  }
}
