export function normalizeServerAddress(input: string): string {
  const parsed = new URL(input.trim());
  const localHttp = parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) throw new Error("HTTPS required");
  if (parsed.username || parsed.password) throw new Error("Credentials are not allowed");
  return parsed.origin;
}

export function sameServerAddress(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  try {
    return normalizeServerAddress(left) === normalizeServerAddress(right);
  } catch {
    return left.trim().replace(/\/$/u, "").toLowerCase() === right.trim().replace(/\/$/u, "").toLowerCase();
  }
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}
