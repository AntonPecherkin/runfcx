import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function readToken(): string {
  if (process.env.HCLOUD_TOKEN) return process.env.HCLOUD_TOKEN;
  const f = join(process.env.FCX_CONFIG ?? join(homedir(), ".config", "fcx"), "hcloud-token");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  throw new Error(
    "No Hetzner token.\n" +
    "1. In Hetzner Cloud, create a NEW project just for this (tokens control the whole project).\n" +
    "2. Security → API tokens → Generate (Read & Write). Copy it.\n" +
    "3. mkdir -p ~/.config/fcx && pbpaste > ~/.config/fcx/hcloud-token && chmod 600 ~/.config/fcx/hcloud-token");
}
