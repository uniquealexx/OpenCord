import { serverHealthSchema, type ServerHealth } from "@opencord/shared";
import { z } from "zod";

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
