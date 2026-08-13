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
    return comparisonKey(left) === comparisonKey(right);
  } catch {
    return left.trim().replace(/\/$/u, "").toLowerCase() === right.trim().replace(/\/$/u, "").toLowerCase();
  }
}

/** Сравнение адресов: loopback-алиасы (localhost, 127.0.0.1, ::1) считаются одним хостом. */
function comparisonKey(input: string): string {
  const url = new URL(normalizeServerAddress(input, { allowInsecureHttp: true }));
  const host = isLoopbackHost(url.hostname) ? "loopback" : url.hostname.toLowerCase();
  return `${url.protocol}//${host}:${url.port}`;
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}
