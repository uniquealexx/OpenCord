import type { Database } from "./database";

const SERVER_ID = "00000000-0000-4000-8000-000000000001";
const GENERAL_CHANNEL_ID = "00000000-0000-4000-8000-000000000101";
const IDEAS_CHANNEL_ID = "00000000-0000-4000-8000-000000000102";
const VOICE_CHANNEL_ID = "00000000-0000-4000-8000-000000000103";

const migrations = [
  {
    id: "001_initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS servers (
        id uuid PRIMARY KEY,
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 48),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS channels (
        id uuid PRIMARY KEY,
        server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 48),
        kind text NOT NULL CHECK (kind IN ('text', 'voice')),
        description text NOT NULL DEFAULT '',
        position integer NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        public_key text NOT NULL UNIQUE,
        display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 32),
        avatar text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS messages (
        id uuid PRIMARY KEY,
        channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        author_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS messages_channel_created_idx ON messages(channel_id, created_at DESC);
    `,
  },
  {
    id: "002_seed_default_space",
    sql: `
      INSERT INTO servers (id, name) VALUES ('${SERVER_ID}', 'OpenCord Local') ON CONFLICT (id) DO NOTHING;
      INSERT INTO channels (id, server_id, name, kind, description, position) VALUES
        ('${GENERAL_CHANNEL_ID}', '${SERVER_ID}', 'общий', 'text', 'Первый локальный канал', 0),
        ('${IDEAS_CHANNEL_ID}', '${SERVER_ID}', 'идеи-и-фидбек', 'text', 'Обсуждаем будущее OpenCord', 1),
        ('${VOICE_CHANNEL_ID}', '${SERVER_ID}', 'Гостиная', 'voice', 'Голосовая связь появится позже', 2)
      ON CONFLICT (id) DO NOTHING;
    `,
  },
  {
    id: "003_server_roles",
    sql: `
      CREATE TABLE IF NOT EXISTS server_members (
        server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'administrator', 'member')),
        joined_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (server_id, user_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS server_single_owner_idx ON server_members(server_id) WHERE role = 'owner';
      CREATE INDEX IF NOT EXISTS server_members_role_idx ON server_members(server_id, role);
    `,
  },
  {
    id: "004_server_lifecycle",
    sql: `
      ALTER TABLE servers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
      ALTER TABLE servers ADD COLUMN IF NOT EXISTS deployment_id text NOT NULL DEFAULT 'legacy';
    `,
  },
] as const;

export async function runMigrations(database: Database): Promise<void> {
  await database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const migration of migrations) {
    const existing = await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", [migration.id]);
    if (existing.length) continue;
    await database.exec(migration.sql);
    await database.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
  }
}

export const DEFAULT_SERVER_ID = SERVER_ID;
