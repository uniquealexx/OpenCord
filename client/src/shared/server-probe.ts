import { PROTOCOL_VERSION, serverHealthSchema, type ServerHealth } from "@opencord/shared";
import { z } from "zod";

const MAX_HEALTH_RESPONSE_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

/** Платформонезависимая сигнатура fetch: работает и с нативным fetch, и с CapacitorHttp-шимом. */
export type HealthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function probeOpenCordServer(input: unknown, fetchImplementation: HealthFetch = fetch): Promise<ServerProbeResult> {
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
    if (textEncoder.encode(body).length > MAX_HEALTH_RESPONSE_BYTES) return { ok: false, code: "not-opencord" };
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

export const serverProbeAddressSchema = z.string().url().transform((value, context) => {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    context.addIssue({ code: "custom", message: "Некорректный адрес OpenCord Server" });
    return z.NEVER;
  }
  return parsed.origin;
});

export const serverProbeResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), health: serverHealthSchema }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["unavailable", "not-opencord", "incompatible"]),
    protocolVersion: z.number().int().positive().optional(),
  }),
]);

export type ServerProbeResult =
  | { ok: true; health: ServerHealth }
  | { ok: false; code: "unavailable" | "not-opencord" | "incompatible"; protocolVersion?: number };
