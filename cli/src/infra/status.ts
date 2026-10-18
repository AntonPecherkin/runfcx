import type { Ssh } from "./ssh.js";

export interface NodeStatus { phase: string; shard: number | null; chunk: number | null;
  chunks: number | null; eta: string | null; max_block_delay: number | null;
  disk_used_gb: number; disk_free_gb: number; ram_used_gb: number; deadline: number;
  ttl: string; ssh: "ok" | "blocked" }

const REMOTE = "sudo FCX_LIB=/opt/fcx/lib.sh bash /opt/fcx/status-remote.sh";

export async function getStatus(ssh: Ssh): Promise<NodeStatus> {
  const r = await ssh.run(REMOTE);
  if (r.code !== 0 || !r.stdout.trim().startsWith("{")) {
    return { phase: "error", shard: null, chunk: null, chunks: null, eta: null, max_block_delay: null,
      disk_used_gb: 0, disk_free_gb: 0, ram_used_gb: 0, deadline: 0, ttl: "none", ssh: "blocked" };
  }
  return { ...JSON.parse(r.stdout), ssh: "ok" };
}

export function formatLine(s: NodeStatus): string {
  let t = s.phase;
  if (s.phase === "downloading") t += ` shard ${s.shard} ${s.chunk}/${s.chunks} ETA ${s.eta ?? "?"}`;
  if (s.phase === "syncing") t += ` ${s.max_block_delay} blocks behind`;
  if (s.disk_used_gb) t += `  disk ${s.disk_used_gb}G`;
  return t;
}

export function formatHuman(s: NodeStatus): string {
  if (s.ssh === "blocked") return "SSH blocked. Your IP may have changed. Run: fcx allow-ip";
  const out = [`Phase:  ${s.phase}`];
  if (s.phase === "downloading") out.push(`Shard:  ${s.shard}  chunk ${s.chunk}/${s.chunks}  ETA ${s.eta ?? "?"}`);
  if (s.max_block_delay !== null) out.push(`Behind: ${s.max_block_delay} blocks`);
  out.push(`Disk:   ${s.disk_used_gb} GB used, ${s.disk_free_gb} GB free`, `RAM:    ${s.ram_used_gb} GB used`);
  if (s.ttl === "warn") out.push("TTL:    under 30 min left. Extend with: fcx extend 4h");
  else if (s.deadline) out.push(`TTL:    auto-destroy at ${new Date(s.deadline * 1000).toLocaleString()}`);
  if (s.phase === "disk_full") out.push("Disk is full. Use a bigger volume (resize in Hetzner) and restart.");
  return out.join("\n");
}
