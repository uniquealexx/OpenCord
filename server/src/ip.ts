import { isIP, isIPv4 } from "node:net";

const IPV4_MAPPED_PREFIX = "::ffff:";

function stripIPv4MappedPrefix(ip: string): string {
  if (ip.startsWith(IPV4_MAPPED_PREFIX)) {
    const unmapped = ip.slice(IPV4_MAPPED_PREFIX.length);
    if (isIPv4(unmapped)) return unmapped;
  }
  return ip;
}

export function normalizeIp(ip: string): string {
  return stripIPv4MappedPrefix(ip);
}

export function isPrivateOrLoopback(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (normalized === "::1") return true;
  if (isIPv4(normalized)) {
    const parts = normalized.split(".").map(Number);
    const first = parts[0] ?? 0;
    const second = parts[1] ?? 0;
    if (first === 127) return true;
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
    return false;
  }
  const lower = normalized.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  return false;
}

export function parseXForwardedFor(header: string | string[] | undefined, maxEntries = 5): string | null {
  if (typeof header !== "string" || header.length === 0) return null;
  const entries = header.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0 || entries.length > maxEntries) return null;
  for (const entry of entries) {
    if (isIP(entry) === 0) return null;
  }
  return normalizeIp(entries.at(-1)!);
}

export function getClientIp(peerIp: string, xForwardedFor: string | string[] | undefined): string {
  const normalizedPeer = normalizeIp(peerIp);
  if (!isPrivateOrLoopback(normalizedPeer)) return normalizedPeer;
  const forwarded = parseXForwardedFor(xForwardedFor);
  return forwarded ?? normalizedPeer;
}
