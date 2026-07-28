import path from "node:path";
import { readFileSync } from "node:fs";
import { z } from "zod";

const configSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3210),
  DATABASE_URL: z.string().url().optional(),
  PGLITE_DATA_DIR: z.string().default(path.resolve(".data", "opencord")),
  ATTACHMENTS_DIR: z.string().default(path.resolve(".data", "attachments")),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  BOOTSTRAP_OWNER_PUBLIC_KEY: z.string().min(40).max(1_000).optional(),
  SERVER_NAME: z.string().trim().min(2).max(48).regex(/^[^\u0000-\u001f\u007f]+$/u).default("OpenCord Server"),
  DEPLOYMENT_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000000"),
  ALLOW_INSECURE_FIRST_USER_OWNER: z.boolean().default(false),
  LIVEKIT_INTERNAL_URL: z.string().url().optional(),
  LIVEKIT_PUBLIC_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(8).max(256).optional(),
  LIVEKIT_API_SECRET: z.string().min(16).max(512).optional(),
  VOICE_SECURE_MODE: z.boolean().default(false),
  VOICE_MAX_PARTICIPANTS: z.coerce.number().int().min(1).max(100).default(25),
});

const environmentSchema = configSchema.extend({
  DATABASE_URL_FILE: z.string().min(1).optional(),
  BOOTSTRAP_OWNER_PUBLIC_KEY_FILE: z.string().min(1).optional(),
  SERVER_NAME_FILE: z.string().min(1).optional(),
  DEPLOYMENT_ID_FILE: z.string().min(1).optional(),
  LIVEKIT_API_KEY_FILE: z.string().min(1).optional(),
  LIVEKIT_API_SECRET_FILE: z.string().min(1).optional(),
  BOOTSTRAP_OWNER_PUBLIC_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().min(40).max(1_000).optional()),
  ALLOW_INSECURE_FIRST_USER_OWNER: z.preprocess((value) => value === "true" ? true : value === "false" || value === undefined ? false : value, z.boolean()),
  VOICE_SECURE_MODE: z.preprocess((value) => value === "true" ? true : value === "false" || value === undefined ? false : value, z.boolean()),
}).superRefine((environment, context) => {
  if (environment.DATABASE_URL && environment.DATABASE_URL_FILE) {
    context.addIssue({ code: "custom", path: ["DATABASE_URL_FILE"], message: "Use DATABASE_URL or DATABASE_URL_FILE, not both" });
  }
  if (environment.BOOTSTRAP_OWNER_PUBLIC_KEY && environment.BOOTSTRAP_OWNER_PUBLIC_KEY_FILE) {
    context.addIssue({ code: "custom", path: ["BOOTSTRAP_OWNER_PUBLIC_KEY_FILE"], message: "Use BOOTSTRAP_OWNER_PUBLIC_KEY or BOOTSTRAP_OWNER_PUBLIC_KEY_FILE, not both" });
  }
  if (environment.LIVEKIT_API_KEY && environment.LIVEKIT_API_KEY_FILE) context.addIssue({ code: "custom", path: ["LIVEKIT_API_KEY_FILE"], message: "Use LIVEKIT_API_KEY or LIVEKIT_API_KEY_FILE, not both" });
  if (environment.LIVEKIT_API_SECRET && environment.LIVEKIT_API_SECRET_FILE) context.addIssue({ code: "custom", path: ["LIVEKIT_API_SECRET_FILE"], message: "Use LIVEKIT_API_SECRET or LIVEKIT_API_SECRET_FILE, not both" });
  const voiceValues = [environment.LIVEKIT_INTERNAL_URL, environment.LIVEKIT_PUBLIC_URL, environment.LIVEKIT_API_KEY ?? environment.LIVEKIT_API_KEY_FILE, environment.LIVEKIT_API_SECRET ?? environment.LIVEKIT_API_SECRET_FILE];
  if (voiceValues.some(Boolean) && voiceValues.some((value) => !value)) context.addIssue({ code: "custom", path: ["LIVEKIT_INTERNAL_URL"], message: "LiveKit requires internal/public URLs, API key and API secret" });
});

export type ServerConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = environmentSchema.parse(environment);
  const databaseUrl = parsed.DATABASE_URL_FILE ? readSecret(parsed.DATABASE_URL_FILE) : parsed.DATABASE_URL;
  const ownerPublicKey = parsed.BOOTSTRAP_OWNER_PUBLIC_KEY_FILE ? readSecret(parsed.BOOTSTRAP_OWNER_PUBLIC_KEY_FILE) : parsed.BOOTSTRAP_OWNER_PUBLIC_KEY;
  const serverName = parsed.SERVER_NAME_FILE ? readSecret(parsed.SERVER_NAME_FILE) : parsed.SERVER_NAME;
  const deploymentId = parsed.DEPLOYMENT_ID_FILE ? readSecret(parsed.DEPLOYMENT_ID_FILE) : parsed.DEPLOYMENT_ID;
  const livekitApiKey = parsed.LIVEKIT_API_KEY_FILE ? readSecret(parsed.LIVEKIT_API_KEY_FILE) : parsed.LIVEKIT_API_KEY;
  const livekitApiSecret = parsed.LIVEKIT_API_SECRET_FILE ? readSecret(parsed.LIVEKIT_API_SECRET_FILE) : parsed.LIVEKIT_API_SECRET;
  return configSchema.parse({ ...parsed, DATABASE_URL: databaseUrl, BOOTSTRAP_OWNER_PUBLIC_KEY: ownerPublicKey, SERVER_NAME: serverName, DEPLOYMENT_ID: deploymentId, LIVEKIT_API_KEY: livekitApiKey, LIVEKIT_API_SECRET: livekitApiSecret });
}

function readSecret(filePath: string): string {
  const value = readFileSync(filePath, "utf8").trim();
  if (!value) throw new Error(`Secret file is empty: ${filePath}`);
  return value;
}
