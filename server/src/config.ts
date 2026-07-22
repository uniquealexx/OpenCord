import path from "node:path";
import { readFileSync } from "node:fs";
import { z } from "zod";

const configSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3210),
  DATABASE_URL: z.string().url().optional(),
  PGLITE_DATA_DIR: z.string().default(path.resolve(".data", "opencord")),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const environmentSchema = configSchema.extend({
  DATABASE_URL_FILE: z.string().min(1).optional(),
}).superRefine((environment, context) => {
  if (environment.DATABASE_URL && environment.DATABASE_URL_FILE) {
    context.addIssue({ code: "custom", path: ["DATABASE_URL_FILE"], message: "Use DATABASE_URL or DATABASE_URL_FILE, not both" });
  }
});

export type ServerConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = environmentSchema.parse(environment);
  const databaseUrl = parsed.DATABASE_URL_FILE ? readSecret(parsed.DATABASE_URL_FILE) : parsed.DATABASE_URL;
  return configSchema.parse({ ...parsed, DATABASE_URL: databaseUrl });
}

function readSecret(filePath: string): string {
  const value = readFileSync(filePath, "utf8").trim();
  if (!value) throw new Error(`Secret file is empty: ${filePath}`);
  return value;
}
