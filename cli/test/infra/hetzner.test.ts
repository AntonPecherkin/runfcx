import { describe, it, expect } from "vitest";
import { Hetzner, firewallRules } from "../../src/infra/hetzner.js";

type Call = { method: string; url: string; body?: any; auth?: string };
function fake(responses: Record<string, any>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: (init.headers as Record<string, string>)?.Authorization });
    const r = responses[`${method} ${new URL(url).pathname}`] ?? {};
    const status = r.__status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("firewallRules", () => {
  it("only SSH from me and gossip UDP", () => {
    expect(firewallRules("5.6.7.8")).toEqual([
      { direction: "in", protocol: "tcp", port: "22", source_ips: ["5.6.7.8/32"] },
      { direction: "in", protocol: "udp", port: "3382", source_ips: ["0.0.0.0/0", "::/0"] },
    ]);
  });
});

describe("Hetzner", () => {
  it("sends bearer token and label selector", async () => {
    const { f, calls } = fake({ "GET /v1/servers": { servers: [{ id: 7, name: "fcx-t1" }] } });
    const h = new Hetzner("SECRET123", f, "https://api.test/v1");
    expect(await h.listByLabel("servers", "t1")).toEqual([{ id: 7, name: "fcx-t1" }]);
    expect(calls[0].auth).toBe("Bearer SECRET123");
    expect(calls[0].url).toBe("https://api.test/v1/servers?label_selector=fcx%3Dt1");
  });
  it("creates server with user data, firewall, label, ubuntu-24.04", async () => {
    const { f, calls } = fake({ "POST /v1/servers": { server: { id: 7, public_net: { ipv4: { ip: "1.2.3.4" } } } } });
    const h = new Hetzner("T", f, "https://api.test/v1");
    const r = await h.createServer({ name: "fcx-t1", type: "ccx23", location: "fsn1", sshKey: "fcx",
      firewallId: 22, volumeId: 11, label: "t1", userData: "#cloud-config" });
    expect(r).toEqual({ id: 7, ip: "1.2.3.4" });
    expect(calls[0].body).toEqual({ name: "fcx-t1", server_type: "ccx23", image: "ubuntu-24.04",
      location: "fsn1", ssh_keys: ["fcx"], firewalls: [{ firewall: 22 }], volumes: [11], automount: true,
      labels: { fcx: "t1" }, user_data: "#cloud-config" });
  });
  it("creates a 1500 GB ext4 volume in the location, before the server", async () => {
    const { f, calls } = fake({ "POST /v1/volumes": { volume: { id: 11 } } });
    const h = new Hetzner("T", f, "https://api.test/v1");
    expect(await h.createVolume({ name: "fcx-t1", location: "fsn1", label: "t1", sizeGb: 1500 })).toBe(11);
    expect(calls[0].body).toEqual({ name: "fcx-t1", size: 1500, location: "fsn1",
      format: "ext4", labels: { fcx: "t1" } });
  });
  it("listByLabel without a name finds every fcx run", async () => {
    const { f, calls } = fake({ "GET /v1/volumes": { volumes: [] } });
    await new Hetzner("T", f, "https://api.test/v1").listByLabel("volumes");
    expect(calls[0].url).toBe("https://api.test/v1/volumes?label_selector=fcx");
  });
  it("API errors carry the message, never the token", async () => {
    const { f } = fake({ "POST /v1/volumes": { __status: 403, error: { code: "resource_limit_exceeded", message: "volume size limit" } } });
    const h = new Hetzner("SECRET123", f, "https://api.test/v1");
    const err = await h.createVolume({ name: "x", location: "fsn1", label: "x", sizeGb: 1500 }).catch((e) => e as Error);
    expect(err.message).toMatch(/volume size limit/);
    expect(err.message).not.toMatch(/SECRET123/);
  });
  it("ensureSshKey creates only when missing", async () => {
    const { f, calls } = fake({ "GET /v1/ssh_keys": { ssh_keys: [] }, "POST /v1/ssh_keys": { ssh_key: { id: 1 } } });
    await new Hetzner("T", f, "https://api.test/v1").ensureSshKey("fcx", "ssh-ed25519 AAA");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });
});
