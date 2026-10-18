export type TtlState = "none" | "ok" | "warn" | "expired";
const UNIT = { m: 60, h: 3600, d: 86400 } as const;

export function parseTtl(s: string): number {
  if (s === "0") return 0;
  const m = /^(\d+)([mhd])$/.exec(s);
  if (!m) throw new Error(`bad TTL '${s}'. Use 90m, 8h, 2d or 0.`);
  return Number(m[1]) * UNIT[m[2] as keyof typeof UNIT];
}

export function ttlState(deadline: number, now: number): TtlState {
  if (deadline === 0) return "none";
  if (now >= deadline) return "expired";
  return deadline - now <= 1800 ? "warn" : "ok";
}

export const ipCidr = (ip: string) => (ip.includes(":") ? `${ip}/128` : `${ip}/32`);
