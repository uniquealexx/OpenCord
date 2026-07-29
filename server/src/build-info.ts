import { createRequire } from "node:module";
import { fullBuildCommitSchema, releaseChannelSchema, semanticVersionSchema, type ReleaseChannel } from "@opencord/shared";
import { z } from "zod";

declare const __OPENCORD_VERSION__: string | undefined;
declare const __OPENCORD_RELEASE_CHANNEL__: string | undefined;
declare const __OPENCORD_BUILD_COMMIT__: string | undefined;

export interface ServerBuildInfo {
  version: string;
  releaseChannel: ReleaseChannel;
  commit: string | null;
}

export function validateServerBuildInfo(input: unknown): ServerBuildInfo {
  const schema = z.object({
    version: semanticVersionSchema,
    releaseChannel: releaseChannelSchema,
    commit: fullBuildCommitSchema.nullable(),
  }).superRefine((build, context) => {
    if (build.releaseChannel !== "development" && build.commit === null) {
      context.addIssue({ code: "custom", path: ["commit"], message: "Published server builds require OPENCORD_BUILD_COMMIT" });
    }
  });
  return schema.parse(input);
}

export function loadServerBuildInfo(environment: NodeJS.ProcessEnv = process.env): ServerBuildInfo {
  const embeddedVersion = typeof __OPENCORD_VERSION__ === "string" ? __OPENCORD_VERSION__ : undefined;
  const embeddedChannel = typeof __OPENCORD_RELEASE_CHANNEL__ === "string" ? __OPENCORD_RELEASE_CHANNEL__ : undefined;
  const embeddedCommit = typeof __OPENCORD_BUILD_COMMIT__ === "string" ? __OPENCORD_BUILD_COMMIT__ : undefined;
  const releaseChannel = embeddedChannel ?? environment.OPENCORD_RELEASE_CHANNEL ?? "development";
  const commit = embeddedCommit ?? environment.OPENCORD_BUILD_COMMIT ?? null;

  return validateServerBuildInfo({
    version: embeddedVersion ?? readDevelopmentPackageVersion(),
    releaseChannel,
    commit: commit || null,
  });
}

function readDevelopmentPackageVersion(): unknown {
  const require = createRequire(import.meta.url);
  const rootPackage = require("../../package.json") as { version?: unknown };
  return rootPackage.version;
}
