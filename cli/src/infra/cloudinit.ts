import { readFileSync } from "node:fs";
import { join } from "node:path";
import { remoteDir } from "./paths.js";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const read = (f: string) => readFileSync(join(remoteDir(), f));

// The token is never in user-data: anything on the box can read it from the metadata service.
export function renderCloudInit(v: { name: string; deadline: number; keep: boolean }): string {
  let y = read("cloud-init.yaml.tpl").toString("utf8");
  if (v.keep) y = y.replace(/ *# TTL-BEGIN[\s\S]*?# TTL-END\n?/, "");
  return y
    .replace("@NAME@", v.name)
    .replace("@DEADLINE@", String(v.deadline))
    .replace("@LIB_B64@", b64(read("lib.sh")))
    .replace("@TTL_B64@", b64(read("ttl-destroy.sh")));
}
