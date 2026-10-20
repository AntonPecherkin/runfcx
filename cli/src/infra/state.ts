import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fcxHome } from "./paths.js";

export interface RunState {
  name: string; mode: "hetzner" | "host"; sshTarget: string; dataDir: string; deadline: number;
}
const file = () => join(fcxHome(), "state.json");

export function loadState(): RunState | null {
  return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as RunState) : null;
}
export function requireState(): RunState {
  const s = loadState();
  if (!s) throw new Error("No server yet. Run: runfcx provision");
  return s;
}
export function saveState(s: RunState): void {
  writeFileSync(file(), JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
}
export function clearState(): void { rmSync(file(), { force: true }); }
