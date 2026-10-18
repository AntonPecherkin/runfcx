import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fcxHome } from "./paths.js";

export interface ExecResult { code: number; stdout: string; stderr: string }
export interface Ssh {
  run(cmd: string, opts?: { inherit?: boolean }): Promise<ExecResult>;
  copy(localFiles: string[], remoteDir: string): Promise<void>;
  tunnel(localPort: number, remotePort: number): { close(): void };
}

export const sshKeyPath = () => join(fcxHome(), "ssh_ed25519");
const OPTS = () => ["-i", sshKeyPath(), "-o", "StrictHostKeyChecking=accept-new",
  "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30"];

function exec(bin: string, args: string[], inherit = false): Promise<ExecResult> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout?.on("data", (d) => (stdout += d)); p.stderr?.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function ensureKey(): Promise<string> {
  const k = sshKeyPath();
  if (!existsSync(k)) {
    const r = await exec("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "fcx", "-f", k]);
    if (r.code !== 0) throw new Error(`ssh-keygen failed: ${r.stderr}`);
  }
  return readFileSync(`${k}.pub`, "utf8").trim();
}

export function makeSsh(target: string): Ssh {
  return {
    run: (cmd, o) => exec("ssh", [...OPTS(), target, cmd], o?.inherit),
    async copy(files, dir) {
      const r = await exec("scp", ["-q", ...OPTS(), ...files, `${target}:${dir}/`]);
      if (r.code !== 0) throw new Error(`scp failed: ${r.stderr.trim()}`);
    },
    tunnel(local, remote) {
      const p = spawn("ssh", [...OPTS(), "-N", "-L", `${local}:127.0.0.1:${remote}`, target], { stdio: "ignore" });
      return { close: () => p.kill() };
    },
  };
}

export async function waitForSsh(ssh: Ssh, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((await ssh.run("true")).code === 0) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Server did not accept SSH in time.");
}
