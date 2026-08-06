export interface NormalizeServerAddressOptions {
  allowInsecureHttp?: boolean;
}

export function normalizeServerAddress(input: string, options: NormalizeServerAddressOptions = {}): string {
  const parsed = new URL(input.trim());
  const httpAllowed = parsed.protocol === "http:" && (isLoopbackHost(parsed.hostname) || options.allowInsecureHttp === true);
  if (parsed.protocol !== "https:" && !httpAllowed) throw new Error("HTTPS required");
  if (parsed.username || parsed.password) throw new Error("Credentials are not allowed");
  return parsed.origin;
}

export function requiresInsecureHttpConfirmation(input: string): boolean {
  try {
    const parsed = new URL(input.trim());
    return parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function sameServerAddress(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  try {
    return normalizeServerAddress(left, { allowInsecureHttp: true }) === normalizeServerAddress(right, { allowInsecureHttp: true });
  } catch {
    return left.trim().replace(/\/$/u, "").toLowerCase() === right.trim().replace(/\/$/u, "").toLowerCase();
  }
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}
