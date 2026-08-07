import { PROTOCOL_VERSION, serverHealthSchema } from "@opencord/shared";
import { serverProbeAddressSchema, serverProbeResultSchema, type ServerProbeResult } from "../src/shared/server-probe";

const MAX_HEALTH_RESPONSE_BYTES = 64 * 1024;

export async function probeOpenCordServer(input: unknown, fetchImplementation: typeof fetch = fetch): Promise<ServerProbeResult> {
  const address = serverProbeAddressSchema.parse(input);
  let response: Response;
  try {
    response = await fetchImplementation(`${address}/health`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
  } catch {
    return { ok: false, code: "unavailable" };
  }
  if (!response.ok) return { ok: false, code: "unavailable" };
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HEALTH_RESPONSE_BYTES) return { ok: false, code: "not-opencord" };

  let payload: unknown;
  try {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_HEALTH_RESPONSE_BYTES) return { ok: false, code: "not-opencord" };
    payload = JSON.parse(body);
  } catch {
    return { ok: false, code: "not-opencord" };
  }

  if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).service !== "opencord-server" || (payload as Record<string, unknown>).status !== "ok") {
    return { ok: false, code: "not-opencord" };
  }
  const protocolVersion = (payload as Record<string, unknown>).protocolVersion;
  if (typeof protocolVersion === "number" && Number.isInteger(protocolVersion) && protocolVersion !== PROTOCOL_VERSION) {
    return { ok: false, code: "incompatible", protocolVersion };
  }
  const health = serverHealthSchema.safeParse(payload);
  return health.success
    ? serverProbeResultSchema.parse({ ok: true, health: health.data })
    : { ok: false, code: "not-opencord" };
}
