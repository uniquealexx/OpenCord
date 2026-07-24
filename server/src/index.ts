import { PGliteDatabase, PostgresDatabase } from "./database/database";
import { buildApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const database = config.DATABASE_URL ? new PostgresDatabase(config.DATABASE_URL) : new PGliteDatabase(config.PGLITE_DATA_DIR);
const app = await buildApp({ database, logger: { level: config.LOG_LEVEL }, bootstrapOwnerPublicKey: config.BOOTSTRAP_OWNER_PUBLIC_KEY, allowInsecureFirstUserOwner: config.ALLOW_INSECURE_FIRST_USER_OWNER, serverName: config.SERVER_NAME, deploymentId: config.DEPLOYMENT_ID });

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ database: database.kind }, `OpenCord Server listening on http://${config.HOST}:${config.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
