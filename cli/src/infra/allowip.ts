import { firewallRules, type Hetzner } from "./hetzner.js";
import type { RunState } from "./state.js";

export async function allowIp(s: RunState, api: Hetzner, ip: string): Promise<void> {
  if (s.mode !== "hetzner") throw new Error("Only for Hetzner runs. Update your own firewall.");
  const [fw] = await api.listByLabel("firewalls", s.name);
  if (!fw) throw new Error(`No firewall found for run '${s.name}'.`);
  await api.setFirewallRules(fw.id, firewallRules(ip));
}
