import { z } from "zod";
import { PROTOCOL_VERSION, voiceCapabilitySchema } from "./protocol";

export const releaseChannelSchema = z.enum(["development", "beta", "stable"]);
export const semanticVersionSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  "Expected a semantic version",
);
export const shortBuildCommitSchema = z.string().regex(/^[a-f0-9]{12}$/u, "Expected a 12-character Git commit");

export const serverHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("opencord-server"),
  version: semanticVersionSchema,
  releaseChannel: releaseChannelSchema,
  buildCommit: shortBuildCommitSchema.nullable(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  database: z.enum(["postgres", "pglite"]),
  voice: voiceCapabilitySchema,
}).superRefine((health, context) => {
  if (health.releaseChannel !== "development" && health.buildCommit === null) {
    context.addIssue({ code: "custom", path: ["buildCommit"], message: "Published health responses require a build commit" });
  }
});

export type ReleaseChannel = z.infer<typeof releaseChannelSchema>;
export type ServerHealth = z.infer<typeof serverHealthSchema>;
