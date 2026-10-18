import { ipCidr } from "./ttl.js";

export type Kind = "servers" | "volumes" | "firewalls";
export interface Rule { direction: "in"; protocol: "tcp" | "udp"; port: string; source_ips: string[] }

export class HetznerError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export function firewallRules(myIp: string): Rule[] {
  return [
    { direction: "in", protocol: "tcp", port: "22", source_ips: [ipCidr(myIp)] },
    { direction: "in", protocol: "udp", port: "3382", source_ips: ["0.0.0.0/0", "::/0"] },
  ];
}

export class Hetzner {
  constructor(private token: string, private fetchImpl: typeof fetch = fetch,
              private base = "https://api.hetzner.cloud/v1") {}

  private async req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HetznerError(`Hetzner ${method} ${path.split("?")[0]}: ${json?.error?.message ?? res.status}`,
        res.status, json?.error?.code ?? "unknown");
    }
    return json as T;
  }

  // No name: every resource any fcx run created in this project.
  async listByLabel(kind: Kind, name?: string) {
    const sel = name === undefined ? "fcx" : `fcx=${name}`;
    const r = await this.req("GET", `/${kind}?label_selector=${encodeURIComponent(sel)}`);
    return (r[kind] as any[]).map((x) => ({ id: x.id as number, name: x.name as string }));
  }
  async ensureSshKey(name: string, publicKey: string) {
    const r = await this.req("GET", `/ssh_keys?name=${encodeURIComponent(name)}`);
    if (r.ssh_keys.length === 0) await this.req("POST", "/ssh_keys", { name, public_key: publicKey });
  }
  async createFirewall(name: string, label: string, rules: Rule[]) {
    const r = await this.req("POST", "/firewalls", { name, labels: { fcx: label }, rules });
    return r.firewall.id as number;
  }
  async setFirewallRules(id: number, rules: Rule[]) {
    await this.req("POST", `/firewalls/${id}/actions/set_rules`, { rules });
  }
  // The volume is attached at create time, so it is mounted before cloud-init runs.
  async createServer(o: { name: string; type: string; location: string; sshKey: string;
    firewallId: number; volumeId: number; label: string; userData: string }) {
    const r = await this.req("POST", "/servers", {
      name: o.name, server_type: o.type, image: "ubuntu-24.04", location: o.location,
      ssh_keys: [o.sshKey], firewalls: [{ firewall: o.firewallId }], volumes: [o.volumeId], automount: true,
      labels: { fcx: o.label }, user_data: o.userData,
    });
    return { id: r.server.id as number, ip: r.server.public_net.ipv4.ip as string };
  }
  async createVolume(o: { name: string; location: string; label: string; sizeGb: number }) {
    const r = await this.req("POST", "/volumes", { name: o.name, size: o.sizeGb, location: o.location,
      format: "ext4", labels: { fcx: o.label } });
    return r.volume.id as number;
  }
  async deleteServer(id: number) { await this.req("DELETE", `/servers/${id}`); }
  async detachVolume(id: number) { await this.req("POST", `/volumes/${id}/actions/detach`); }
  async deleteVolume(id: number) { await this.req("DELETE", `/volumes/${id}`); }
  async deleteFirewall(id: number) { await this.req("DELETE", `/firewalls/${id}`); }
}
