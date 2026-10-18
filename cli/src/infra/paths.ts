import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function fcxHome(): string {
  const dir = process.env.FCX_HOME ?? join(homedir(), ".fcx");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// dist/infra/paths.js and src/infra/paths.ts both sit two levels below the package root.
export function remoteDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../remote");
}
