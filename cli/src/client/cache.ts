import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fcxHome } from "../infra/paths.js";

const dir = () => { const d = join(fcxHome(), "cache"); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
export function readCache<T>(name: string): T | undefined {
  const f = join(dir(), `${name}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : undefined;
}
export function writeCache(name: string, value: unknown): void {
  writeFileSync(join(dir(), `${name}.json`), JSON.stringify(value), { mode: 0o600 });
}
