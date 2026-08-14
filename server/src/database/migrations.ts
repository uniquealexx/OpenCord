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
  {
    id: "005_message_attachments",
    sql: `
      CREATE TABLE IF NOT EXISTS attachments (
        id uuid PRIMARY KEY,
        server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        uploader_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        storage_key text NOT NULL UNIQUE,
        original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
        mime_type text NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 100),
        size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
        sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS message_attachments (
        message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        attachment_id uuid NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK (position BETWEEN 0 AND 4),
        PRIMARY KEY (message_id, attachment_id)
      );
      CREATE INDEX IF NOT EXISTS attachments_uploader_created_idx ON attachments(uploader_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS message_attachments_message_position_idx ON message_attachments(message_id, position);
    `,
  },
  {
    id: "006_attachment_only_messages",
    sql: `
      ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_check;
      ALTER TABLE messages ADD CONSTRAINT messages_content_check CHECK (char_length(content) BETWEEN 0 AND 4000);
    `,
  },
  {
    id: "007_message_editing",
    sql: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;`,
  },
  {
    id: "008_server_avatar",
    sql: `ALTER TABLE servers ADD COLUMN IF NOT EXISTS avatar text;`,
  },
  {
    id: "009_voice_channel_participant_limit",
    sql: `
      ALTER TABLE channels ADD COLUMN IF NOT EXISTS participant_limit integer;
      UPDATE channels SET participant_limit = 25 WHERE kind = 'voice' AND participant_limit IS NULL;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'channels_participant_limit_check'
            AND conrelid = 'channels'::regclass
        ) THEN
          ALTER TABLE channels ADD CONSTRAINT channels_participant_limit_check CHECK (
            (kind = 'text' AND participant_limit IS NULL)
            OR (kind = 'voice' AND participant_limit BETWEEN 0 AND 25)
          );
        END IF;
      END
      $$;
    `,
  },
  {
    id: "010_server_attachment_limit",
    sql: `
      ALTER TABLE servers ADD COLUMN IF NOT EXISTS max_attachment_bytes bigint DEFAULT 10485760;
      ALTER TABLE attachments ALTER COLUMN size_bytes TYPE bigint;
      ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_size_bytes_check;
      ALTER TABLE attachments ADD CONSTRAINT attachments_size_bytes_check CHECK (size_bytes BETWEEN 1 AND 9007199254740991);
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'servers_max_attachment_bytes_check'
            AND conrelid = 'servers'::regclass
        ) THEN
          ALTER TABLE servers ADD CONSTRAINT servers_max_attachment_bytes_check CHECK (
            max_attachment_bytes IS NULL OR max_attachment_bytes BETWEEN 1048576 AND 2097152000
          );
        END IF;
      END
      $$;
    `,
  },
  {
    id: "011_server_screen_share_limits",
    sql: `
      ALTER TABLE servers ADD COLUMN IF NOT EXISTS screen_share_max_resolution integer NOT NULL DEFAULT 1080;
      ALTER TABLE servers ADD COLUMN IF NOT EXISTS screen_share_max_frame_rate integer NOT NULL DEFAULT 60;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'servers_screen_share_max_resolution_check'
            AND conrelid = 'servers'::regclass
        ) THEN
          ALTER TABLE servers ADD CONSTRAINT servers_screen_share_max_resolution_check CHECK (
            screen_share_max_resolution IN (480, 720, 1080)
          );
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'servers_screen_share_max_frame_rate_check'
            AND conrelid = 'servers'::regclass
        ) THEN
          ALTER TABLE servers ADD CONSTRAINT servers_screen_share_max_frame_rate_check CHECK (
            screen_share_max_frame_rate IN (15, 30, 60)
          );
        END IF;
      END
      $$;
    `,
  },
  {
    id: "012_user_profile_bio",
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'users_bio_length_check'
            AND conrelid = 'users'::regclass
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_bio_length_check CHECK (char_length(bio) <= 160);
        END IF;
      END
      $$;
    `,
  },
  {
    id: "013_user_profile_banner",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS banner text NULL;`,
  },
  {
    id: "014_server_screen_share_source_quality",
    sql: `
      ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_screen_share_max_resolution_check;
      ALTER TABLE servers ADD CONSTRAINT servers_screen_share_max_resolution_check CHECK (
        screen_share_max_resolution IN (480, 720, 1080, 1440)
      );
    `,
  },
  {
    id: "015_username_discriminator_mentions",
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS discriminator text;

      UPDATE users SET username = CASE
        WHEN btrim(regexp_replace(lower(display_name), '[^a-z0-9_.-]+', '-', 'g'), '-') = '' THEN 'user-' || left(id, 12)
        ELSE left(CASE
          WHEN char_length(btrim(regexp_replace(lower(display_name), '[^a-z0-9_.-]+', '-', 'g'), '-')) < 2
          THEN btrim(regexp_replace(lower(display_name), '[^a-z0-9_.-]+', '-', 'g'), '-') || repeat('0', 2 - char_length(btrim(regexp_replace(lower(display_name), '[^a-z0-9_.-]+', '-', 'g'), '-')))
          ELSE btrim(regexp_replace(lower(display_name), '[^a-z0-9_.-]+', '-', 'g'), '-')
        END, 32)
      END WHERE username IS NULL;
      UPDATE users SET discriminator = to_char(floor(random() * 10000)::integer, 'FM0000') WHERE discriminator IS NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'users_username_check'
            AND conrelid = 'users'::regclass
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_username_check CHECK (
            username IS NULL OR username ~ '^[a-z0-9_.-]{2,32}$'
          );
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'users_discriminator_check'
            AND conrelid = 'users'::regclass
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_discriminator_check CHECK (
            discriminator IS NULL OR discriminator ~ '^[0-9]{4}$'
          );
        END IF;
      END
      $$;

      CREATE TABLE IF NOT EXISTS message_mentions (
        message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK (position BETWEEN 0 AND 19),
        PRIMARY KEY (message_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS message_mentions_user_idx ON message_mentions(user_id);
    `,
  },
  {
    id: "016_private_messages_chat_mute",
    sql: `
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'chat';
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS target_user_id text REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS anonymous boolean NOT NULL DEFAULT false;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'messages_kind_check'
            AND conrelid = 'messages'::regclass
        ) THEN
          ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('chat', 'pm', 'apm'));
        END IF;
      END
      $$;
      ALTER TABLE server_members ADD COLUMN IF NOT EXISTS chat_muted boolean NOT NULL DEFAULT false;
      CREATE INDEX IF NOT EXISTS messages_target_user_idx ON messages(target_user_id) WHERE target_user_id IS NOT NULL;
    `,
  },
  {
    id: "017_chat_mute_duration",
    sql: `ALTER TABLE server_members ADD COLUMN IF NOT EXISTS chat_muted_until timestamptz;`,
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
