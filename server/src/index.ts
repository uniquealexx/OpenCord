import { PGliteDatabase, PostgresDatabase } from "./database/database";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { DisabledVoiceService, LiveKitVoiceService } from "./voice";

const config = loadConfig();
const database = config.DATABASE_URL ? new PostgresDatabase(config.DATABASE_URL) : new PGliteDatabase(config.PGLITE_DATA_DIR);
const voiceService = config.LIVEKIT_INTERNAL_URL && config.LIVEKIT_PUBLIC_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET
  ? new LiveKitVoiceService({ internalUrl: config.LIVEKIT_INTERNAL_URL, publicUrl: config.LIVEKIT_PUBLIC_URL, apiKey: config.LIVEKIT_API_KEY, apiSecret: config.LIVEKIT_API_SECRET, secureTransport: config.VOICE_SECURE_MODE, maxParticipants: config.VOICE_MAX_PARTICIPANTS })
  : new DisabledVoiceService();
const app = await buildApp({
  database,
  logger: { level: config.LOG_LEVEL },
  bootstrapOwnerPublicKey: config.BOOTSTRAP_OWNER_PUBLIC_KEY,
  allowInsecureFirstUserOwner: config.ALLOW_INSECURE_FIRST_USER_OWNER,
  serverName: config.SERVER_NAME,
  deploymentId: config.DEPLOYMENT_ID,
  attachmentsDir: config.ATTACHMENTS_DIR,
  voiceService,
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ database: database.kind }, `OpenCord Server listening on http://${config.HOST}:${config.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
