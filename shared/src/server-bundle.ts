import { z } from "zod";
import { fullBuildCommitSchema, sha256Schema } from "./release-manifest";
import { releaseChannelSchema, semanticVersionSchema } from "./health";

export const SERVER_BUNDLE_FORMAT_VERSION = 1 as const;

export const serverBundleInfoSchema = z.object({
  formatVersion: z.literal(SERVER_BUNDLE_FORMAT_VERSION),
  product: z.literal("opencord-server"),
  version: semanticVersionSchema,
  releaseChannel: releaseChannelSchema,
  commit: fullBuildCommitSchema.nullable(),
  protocolVersion: z.number().int().positive(),
  target: z.object({ os: z.literal("linux"), arch: z.literal("x64") }).strict(),
  runtime: z.object({
    fileName: z.literal("server-runtime-linux-x64.tar.gz"),
    sha256: sha256Schema,
    sizeBytes: z.number().int().positive().safe(),
  }).strict(),
}).strict().superRefine((info, context) => {
  if (info.releaseChannel !== "development" && info.commit === null) {
    context.addIssue({ code: "custom", path: ["commit"], message: "Published bundles require a commit" });
  }
});

export type ServerBundleInfo = z.infer<typeof serverBundleInfoSchema>;
