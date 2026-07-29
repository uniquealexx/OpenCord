import { z } from "zod";
import { releaseChannelSchema, semanticVersionSchema } from "./health";

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1 as const;

export const fullBuildCommitSchema = z.string().regex(/^[a-f0-9]{40}$/u, "Expected a full 40-character Git commit");
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u, "Expected a lowercase SHA-256 digest");
export const containerDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u, "Expected a sha256 container digest");

const httpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:", "Expected an HTTPS URL");
const artifactFileNameSchema = z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, "Expected a safe artifact file name");

export const downloadableArtifactSchema = z.object({
  fileName: artifactFileNameSchema,
  downloadUrl: httpsUrlSchema.nullable(),
  sha256: sha256Schema,
  sizeBytes: z.number().int().positive().safe(),
}).strict();

export const serverBundleArtifactSchema = downloadableArtifactSchema.extend({
  bundleFormatVersion: z.literal(1),
  target: z.object({ os: z.literal("linux"), arch: z.literal("x64") }).strict(),
  installModes: z.tuple([z.literal("docker"), z.literal("native")]),
}).strict();

export const serverImageArtifactSchema = z.object({
  reference: z.string().regex(/^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._/-]+:[A-Za-z0-9._-]+$/u, "Expected a tagged GHCR image reference"),
  digest: containerDigestSchema,
  platforms: z.array(z.object({ os: z.literal("linux"), arch: z.enum(["amd64", "arm64"]) }).strict()).min(1).max(4),
}).strict();

export const windowsClientArtifactSchema = z.object({
  installer: downloadableArtifactSchema,
  updateMetadata: downloadableArtifactSchema,
  blockmap: downloadableArtifactSchema.nullable(),
  target: z.object({ os: z.literal("windows"), arch: z.literal("x64") }).strict(),
}).strict();

export const releaseManifestSchema = z.object({
  schemaVersion: z.literal(RELEASE_MANIFEST_SCHEMA_VERSION),
  product: z.literal("opencord"),
  releaseChannel: releaseChannelSchema,
  version: semanticVersionSchema,
  protocolVersion: z.number().int().positive(),
  commit: fullBuildCommitSchema.nullable(),
  publishedAt: z.string().datetime().nullable(),
  releaseUrl: httpsUrlSchema.nullable(),
  artifacts: z.object({
    serverBundle: serverBundleArtifactSchema,
    serverImage: serverImageArtifactSchema.nullable(),
    windowsClient: windowsClientArtifactSchema.nullable(),
  }).strict(),
}).strict().superRefine((manifest, context) => {
  if (manifest.releaseChannel === "development") return;
  const versionWithoutBuild = manifest.version.split("+", 1)[0] ?? manifest.version;
  if (manifest.releaseChannel === "stable" && versionWithoutBuild.includes("-")) context.addIssue({ code: "custom", path: ["version"], message: "Stable releases cannot use a prerelease version" });
  if (manifest.releaseChannel === "beta" && !/-beta(?:\.|$)/u.test(versionWithoutBuild)) context.addIssue({ code: "custom", path: ["version"], message: "Beta releases require a beta prerelease version" });
  if (manifest.commit === null) context.addIssue({ code: "custom", path: ["commit"], message: "Published releases require a commit" });
  if (manifest.publishedAt === null) context.addIssue({ code: "custom", path: ["publishedAt"], message: "Published releases require a publication timestamp" });
  if (manifest.releaseUrl === null) context.addIssue({ code: "custom", path: ["releaseUrl"], message: "Published releases require a release URL" });
  for (const [path, artifact] of downloadableArtifacts(manifest.artifacts)) {
    if (artifact.downloadUrl === null) context.addIssue({ code: "custom", path, message: "Published release artifacts require download URLs" });
  }
});

type DownloadableArtifactInput = z.infer<typeof downloadableArtifactSchema>;

function downloadableArtifacts(artifacts: z.infer<typeof releaseManifestSchema>["artifacts"]): Array<[Array<string | number>, DownloadableArtifactInput]> {
  const result: Array<[Array<string | number>, DownloadableArtifactInput]> = [
    [["artifacts", "serverBundle", "downloadUrl"], artifacts.serverBundle],
  ];
  if (artifacts.windowsClient) {
    result.push([["artifacts", "windowsClient", "installer", "downloadUrl"], artifacts.windowsClient.installer]);
    result.push([["artifacts", "windowsClient", "updateMetadata", "downloadUrl"], artifacts.windowsClient.updateMetadata]);
    if (artifacts.windowsClient.blockmap) result.push([["artifacts", "windowsClient", "blockmap", "downloadUrl"], artifacts.windowsClient.blockmap]);
  }
  return result;
}

export type DownloadableArtifact = z.infer<typeof downloadableArtifactSchema>;
export type ServerBundleArtifact = z.infer<typeof serverBundleArtifactSchema>;
export type ServerImageArtifact = z.infer<typeof serverImageArtifactSchema>;
export type WindowsClientArtifact = z.infer<typeof windowsClientArtifactSchema>;
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
