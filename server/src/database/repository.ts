import { isReactionEmoji, stripBidiControls, NAME_FONT_VALUES, PROFILE_RETENTION_DAYS, parseServerHelpPage, publicKeyFingerprint, resolveChannelPermissions, AUDIT_LOG_MAX_ENTRIES, DEFAULT_WELCOME_MESSAGE, auditActionSchema, type Attachment, type AuditAction, type AuditEntry, type BanDurationMinutes, type BannedMember, type Channel, type ChannelOverwrite, type ChatMessage, type CustomRole, type Member, type MemberRole, type MessageReaction, type MessageSearchFilters, type MessageSearchResult, type NameFont, type Permission, type PublicMemberStatus, type PublicProfile, type ServerHelp, type ServerSettings } from "@opencord/shared";
import type { Database, QueryRow } from "./database";
import { DEFAULT_SERVER_ID } from "./migrations";

interface ServerRow extends QueryRow { id: string; name: string; description: string; avatar: string | null; banner: string | null; max_attachment_bytes: number | string | null; screen_share_max_resolution: number; screen_share_max_frame_rate: number; help_page: string | null; welcome_channel_id: string | null; welcome_message: string | null }
interface ChannelRow extends QueryRow { id: string; name: string; kind: "text" | "voice"; description: string; participant_limit: number | null; slowmode_seconds?: number | null }
interface UserRow extends QueryRow { id: string; username: string | null; discriminator: string | null; public_key: string; bio: string; avatar: string | null; banner: string | null; member_background: string | null; custom_status: string; custom_status_emoji: string | null; accent_color: string | null; name_glow: string | null; name_font: string | null; role: MemberRole; chat_muted: boolean; chat_muted_until: Date | string | null; help_accepted: boolean }
interface BannedUserRow extends QueryRow { id: string; username: string | null; discriminator: string | null; public_key: string; bio: string; avatar: string | null; banner: string | null; banned_at: Date | string; banned_by: string; expires_at: Date | string | null }
interface MessageRow extends QueryRow { id: string; channel_id: string; author_id: string; author_name: string; author_avatar: string | null; content: string; created_at: Date | string; edited_at: Date | string | null; kind: "chat" | "pm" | "apm"; target_user_id: string | null; anonymous: boolean; reply_to_message_id: string | null; pinned: boolean; pinned_at: Date | string | null }
interface MentionRow extends QueryRow { message_id: string; user_id: string }
interface ReactionRow extends QueryRow { message_id: string; user_id: string; emoji: string }
interface AttachmentRow extends QueryRow { id: string; storage_key: string; original_name: string; mime_type: string; size_bytes: number; sha256: string; message_id?: string }
interface RoleRow extends QueryRow { id: string; name: string; color: string | null; position: number; permissions: string[] | string | null }
interface OverwriteRow extends QueryRow { channel_id: string; role_id: string; allow: string[] | string | null; deny: string[] | string | null }
interface AuditRow extends QueryRow { id: string; at: Date | string; actor_id: string; action: string; target_id: string | null; detail: string | null }

/** Сиды legacy-ролей (миграция 036): повторяют поведение до кастомных ролей. */
export const SEEDED_ADMINISTRATOR_ROLE_ID = "00000000-0000-4000-8000-00000000a001" as const;
export const SEEDED_MEMBER_ROLE_ID = "00000000-0000-4000-8000-00000000a002" as const;
/** Топ владельца — вне таблицы, выше любой кастомной позиции. */
export const OWNER_TOP_POSITION = 10_000 as const;
export const ALL_PERMISSIONS: Permission[] = ["MANAGE_SERVER", "MANAGE_CHANNELS", "MANAGE_MESSAGES", "MANAGE_ROLES", "KICK_MEMBERS", "DELETE_SERVER", "VOICE_CONNECT", "VOICE_SPEAK", "VOICE_MODERATE"];
interface DeleteCandidateRow extends QueryRow { author_id: string; channel_id: string; attachment_id: string | null; storage_key: string | null }
interface MessageUpdateRow extends MessageRow { removed_storage_keys: string[] | null }

/** Профиль от клиента. `discriminator` необязателен: его выдаёт сервер, клиент лишь просит. */
type ProfileInput = Pick<PublicProfile, "username" | "avatar"> & Partial<Omit<PublicProfile, "username" | "avatar">>;

const DISCRIMINATOR_ALLOCATION_ATTEMPTS = 5;

/** Нарушение уникальности (SQLSTATE 23505) одинаково приходит из PGlite и из pg. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

export class ChatRepository {
  constructor(private readonly database: Database) {}

  async configureServer(name: string, deploymentId: string): Promise<void> {
    await this.database.query(
      `UPDATE servers SET name = CASE WHEN deployment_id <> $3 THEN $2 ELSE name END, deleted_at = CASE WHEN deployment_id <> $3 THEN NULL ELSE deleted_at END, deployment_id = $3 WHERE id = $1`,
      [DEFAULT_SERVER_ID, name, deploymentId],
    );
  }

  async isServerDeleted(): Promise<boolean> {
    const [row] = await this.database.query<{ deleted: boolean }>("SELECT deleted_at IS NOT NULL AS deleted FROM servers WHERE id = $1", [DEFAULT_SERVER_ID]);
    return row?.deleted === true;
  }

  async markServerDeleted(): Promise<void> {
    await this.database.query("UPDATE servers SET deleted_at = now() WHERE id = $1", [DEFAULT_SERVER_ID]);
  }

  async getServer(): Promise<{ id: string; avatar: string | null; banner: string | null; channels: Channel[] } & ServerSettings> {
    const [server] = await this.database.query<ServerRow>("SELECT id, name, description, avatar, banner, max_attachment_bytes, screen_share_max_resolution, screen_share_max_frame_rate, help_page, welcome_channel_id, welcome_message FROM servers WHERE id = $1", [DEFAULT_SERVER_ID]);
    if (!server) throw new Error("Default server is missing");
    const channels = await this.database.query<ChannelRow>("SELECT id, name, kind, description, participant_limit, slowmode_seconds FROM channels WHERE server_id = $1 ORDER BY position, name", [server.id]);
    return { id: server.id, name: server.name, description: server.description, avatar: server.avatar, banner: server.banner, maxAttachmentBytes: server.max_attachment_bytes === null ? null : Number(server.max_attachment_bytes), screenShareMaxResolution: server.screen_share_max_resolution as ServerSettings["screenShareMaxResolution"], screenShareMaxFrameRate: server.screen_share_max_frame_rate as ServerSettings["screenShareMaxFrameRate"], helpPage: parseServerHelpPage(server.help_page), welcomeChannelId: server.welcome_channel_id ?? null, welcomeMessage: server.welcome_message ?? DEFAULT_WELCOME_MESSAGE, channels: channels.map(mapChannel) };
  }

  async updateServerAvatar(avatar: string | null): Promise<void> {
    await this.database.query("UPDATE servers SET avatar = $2 WHERE id = $1", [DEFAULT_SERVER_ID, avatar]);
  }

  async updateServerBanner(banner: string | null): Promise<void> {
    await this.database.query("UPDATE servers SET banner = $2 WHERE id = $1", [DEFAULT_SERVER_ID, banner]);
  }

  async channelExists(channelId: string): Promise<boolean> {
    const rows = await this.database.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1 AND kind = 'text') AS exists", [channelId]);
    return rows[0]?.exists === true;
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    const rows = await this.database.query<ChannelRow>("SELECT id, name, kind, description, participant_limit, slowmode_seconds FROM channels WHERE id = $1 AND server_id = $2", [channelId, DEFAULT_SERVER_ID]);
    const row = rows[0];
    return row ? mapChannel(row) : null;
  }

  async createChannel(id: string, name: string, kind: Channel["kind"], description: string, participantLimit: number | null): Promise<Channel> {
    const rows = await this.database.query<ChannelRow>(
      `INSERT INTO channels (id, server_id, name, kind, description, participant_limit, position)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'voice' THEN $6::integer ELSE NULL END, COALESCE((SELECT MAX(position) + 1 FROM channels WHERE server_id = $2), 0))
       RETURNING id, name, kind, description, participant_limit, slowmode_seconds`,
      [id, DEFAULT_SERVER_ID, name, kind, description, participantLimit],
    );
    return mapChannel(required(rows[0], "Created channel is missing"));
  }

  async updateChannel(channelId: string, name: string, description: string, participantLimit: number | null, slowmodeSeconds: number): Promise<Channel | null> {
    const rows = await this.database.query<ChannelRow>(
      `UPDATE channels SET name = $3, description = $4,
       participant_limit = CASE WHEN kind = 'voice' THEN $5::integer ELSE NULL END,
       slowmode_seconds = CASE WHEN kind = 'text' THEN $6::integer ELSE 0 END
       WHERE id = $1 AND server_id = $2
       RETURNING id, name, kind, description, participant_limit, slowmode_seconds`,
      [channelId, DEFAULT_SERVER_ID, name, description, participantLimit, slowmodeSeconds],
    );
    return rows[0] ? mapChannel(rows[0]) : null;
  }

  /** Массовая установка медленного режима: голосовые каналы в выборке молча пропускаются. */
  async setChannelsSlowmode(channelIds: readonly string[], slowmodeSeconds: number): Promise<string[]> {
    const rows = await this.database.query<{ id: string }>(
      `UPDATE channels SET slowmode_seconds = $3::integer
       WHERE server_id = $1 AND kind = 'text' AND id = ANY($2::uuid[])
       RETURNING id`,
      [DEFAULT_SERVER_ID, [...channelIds], slowmodeSeconds],
    );
    return rows.map((row) => row.id);
  }

  /**
   * Когда участник в последний раз писал в канал обычное сообщение. Медленный режим
   * считается по истории, а не по памяти процесса, поэтому перезапуск его не сбрасывает.
   */
  async lastChatMessageAt(channelId: string, authorId: string): Promise<Date | null> {
    const [row] = await this.database.query<{ created_at: Date | string }>(
      "SELECT created_at FROM messages WHERE channel_id = $1 AND author_id = $2 AND kind = 'chat' ORDER BY created_at DESC LIMIT 1",
      [channelId, authorId],
    );
    return row ? new Date(row.created_at) : null;
  }

  async deleteChannel(channelId: string): Promise<boolean> {
    const rows = await this.database.query<{ id: string }>(
      "DELETE FROM channels WHERE id = $1 AND server_id = $2 RETURNING id",
      [channelId, DEFAULT_SERVER_ID],
    );
    // Удаление welcome-канала молча выключает приветствие (дублирует FK SET NULL).
    if (rows.length > 0) await this.database.query("UPDATE servers SET welcome_channel_id = NULL WHERE id = $1 AND welcome_channel_id = $2", [DEFAULT_SERVER_ID, channelId]);
    return rows.length > 0;
  }

  async upsertUser(userId: string, publicKey: string, profile: ProfileInput): Promise<void> {
    // display_name — историческая колонка: никнеймов больше нет, поэтому она хранит зеркало username.
    await this.withAllocatedDiscriminator(userId, profile.username, profile.discriminator ?? null, async (discriminator) => {
      await this.database.query(
        `INSERT INTO users (id, public_key, display_name, bio, avatar, banner, member_background, username, discriminator, custom_status, custom_status_emoji, accent_color, name_glow, name_font) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, avatar = EXCLUDED.avatar, banner = EXCLUDED.banner, member_background = EXCLUDED.member_background, username = EXCLUDED.username, discriminator = EXCLUDED.discriminator, custom_status = EXCLUDED.custom_status, custom_status_emoji = EXCLUDED.custom_status_emoji, accent_color = EXCLUDED.accent_color, name_glow = EXCLUDED.name_glow, name_font = EXCLUDED.name_font, updated_at = now()
         WHERE users.public_key = EXCLUDED.public_key`,
        [userId, publicKey, profile.username, profile.bio ?? "", profile.avatar, profile.banner ?? null, profile.memberBackground ?? null, profile.username, discriminator, profile.customStatus ?? "", profile.customStatusEmoji ?? "", profile.accentColor ?? null, profile.nameGlow ?? null, profile.nameFont ?? "none"],
      );
      return true;
    });
  }

  async updateUserProfile(userId: string, profile: ProfileInput): Promise<boolean> {
    const [existing] = await this.database.query<{ id: string }>("SELECT id FROM users WHERE id = $1", [userId]);
    if (!existing) return false;
    // Дискриминатор здесь не пожелание, а собственность идентичности: что бы клиент ни
    // прислал, за пользователем остаётся уже закреплённый тег.
    const updated = await this.withAllocatedDiscriminator(userId, profile.username, null, async (discriminator) => {
      const rows = await this.database.query<{ id: string }>(
        "UPDATE users SET display_name = $2, bio = $3, avatar = $4, banner = $5, member_background = $6, username = $7, discriminator = $8, custom_status = $9, custom_status_emoji = $10, accent_color = $11, name_glow = $12, name_font = $13, updated_at = now() WHERE id = $1 RETURNING id",
        [userId, profile.username, profile.bio ?? "", profile.avatar, profile.banner ?? null, profile.memberBackground ?? null, profile.username, discriminator, profile.customStatus ?? "", profile.customStatusEmoji ?? "", profile.accentColor ?? null, profile.nameGlow ?? null, profile.nameFont ?? "none"],
      );
      return rows.length > 0;
    });
    return updated !== null;
  }

  /**
   * Выдаёт дискриминатор и выполняет запись. Пара username#discriminator уникальна, а
   * гонку двух одновременных регистраций ловит уникальный индекс — поэтому конфликт
   * отрабатывается повтором с новым свободным значением.
   */
  private async withAllocatedDiscriminator(userId: string, username: string, requested: string | null, write: (discriminator: string) => Promise<boolean>): Promise<string | null> {
    for (let attempt = 0; attempt < DISCRIMINATOR_ALLOCATION_ATTEMPTS; attempt += 1) {
      const discriminator = await this.allocateDiscriminator(userId, username, attempt === 0 ? requested : null);
      try {
        return (await write(discriminator)) ? discriminator : null;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === DISCRIMINATOR_ALLOCATION_ATTEMPTS - 1) throw error;
      }
    }
    throw new Error(`Не удалось закрепить дискриминатор за username ${username}`);
  }

  /**
   * Тег `username#1234` принадлежит идентичности, а не клиенту. Уже закреплённый за
   * пользователем дискриминатор сохраняется всегда; присланное клиентом значение — лишь
   * пожелание при первой регистрации ключа и принимается, только если пара свободна.
   * Иначе выдаётся случайный свободный дискриминатор, поэтому скопировать чужой тег
   * целиком нельзя.
   */
  private async allocateDiscriminator(userId: string, username: string, requested: string | null): Promise<string> {
    const [row] = await this.database.query<{ discriminator: string | null }>(
      `SELECT COALESCE(
         (SELECT owned.discriminator FROM users owned
          WHERE owned.id = $1 AND owned.discriminator IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM users taken WHERE taken.id <> $1 AND taken.username = $2 AND taken.discriminator = owned.discriminator)),
         (SELECT $3::text WHERE $3::text IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM users taken WHERE taken.id <> $1 AND taken.username = $2 AND taken.discriminator = $3::text)),
         (SELECT to_char(free.number, 'FM0000') FROM generate_series(0, 9999) AS free(number)
          WHERE NOT EXISTS (SELECT 1 FROM users taken WHERE taken.id <> $1 AND taken.username = $2 AND taken.discriminator = to_char(free.number, 'FM0000'))
          ORDER BY random() LIMIT 1)
       ) AS discriminator`,
      [userId, username, requested],
    );
    const discriminator = row?.discriminator ?? null;
    if (!discriminator) throw new Error(`Свободных дискриминаторов для username ${username} не осталось`);
    return discriminator;
  }

  async leaveServer(userId: string, reason: "leave" | "kick" = "leave"): Promise<MemberRole | null> {
    const role = await this.getOptionalMemberRole(userId);
    if (!role) return null;
    if (role !== "owner") {
      await this.database.query("DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
      await this.database.query(
        `WITH removed AS (
           DELETE FROM server_members WHERE server_id = $1 AND user_id = $2 RETURNING user_id
         )
         INSERT INTO server_departures (server_id, user_id, reason, departed_at, anonymize_after)
         SELECT $1, user_id, $3, now(), now() + ($4::integer * interval '1 day') FROM removed
         ON CONFLICT (server_id, user_id) DO UPDATE SET reason = excluded.reason, departed_at = excluded.departed_at, anonymize_after = excluded.anonymize_after`,
        [DEFAULT_SERVER_ID, userId, reason, PROFILE_RETENTION_DAYS],
      );
    }
    return role;
  }

  /** Активный бан пользователя либо null. `expiresAt === null` — бан перманентный. */
  async findActiveBan(userId: string): Promise<{ expiresAt: string | null } | null> {
    await this.expireBans();
    const [row] = await this.database.query<{ expires_at: Date | string | null }>(
      "SELECT expires_at FROM server_bans WHERE server_id = $1 AND user_id = $2",
      [DEFAULT_SERVER_ID, userId],
    );
    if (!row) return null;
    return { expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null };
  }

  async banMember(userId: string, bannedBy: string, durationMinutes: BanDurationMinutes): Promise<boolean> {
    const rows = await this.database.query<{ user_id: string }>(
      `WITH banned AS (
         INSERT INTO server_bans (server_id, user_id, banned_by, banned_at, expires_at)
         SELECT $1, $2, $3, now(), CASE WHEN $4::integer IS NULL THEN NULL ELSE now() + ($4::integer * interval '1 minute') END
         WHERE EXISTS (SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)
         ON CONFLICT (server_id, user_id) DO UPDATE SET banned_by = excluded.banned_by, banned_at = excluded.banned_at, expires_at = excluded.expires_at
         RETURNING user_id
       ), departed AS (
         INSERT INTO server_departures (server_id, user_id, reason, departed_at, anonymize_after)
         SELECT $1, user_id, 'ban', now(), now() + ($5::integer * interval '1 day') FROM banned
         ON CONFLICT (server_id, user_id) DO UPDATE SET reason = excluded.reason, departed_at = excluded.departed_at, anonymize_after = excluded.anonymize_after
         RETURNING user_id
       ), removed AS (
         DELETE FROM server_members WHERE server_id = $1 AND user_id = $2
         AND EXISTS (SELECT 1 FROM departed) RETURNING user_id
       )
        SELECT user_id FROM banned`,
      [DEFAULT_SERVER_ID, userId, bannedBy, durationMinutes, PROFILE_RETENTION_DAYS],
    );
    if (rows.length === 0) return false;
    await this.database.query("DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    return true;
  }

  async unbanMember(userId: string): Promise<boolean> {
    const rows = await this.database.query<{ user_id: string }>(
      "DELETE FROM server_bans WHERE server_id = $1 AND user_id = $2 RETURNING user_id",
      [DEFAULT_SERVER_ID, userId],
    );
    return rows.length > 0;
  }

  async listBannedMembers(): Promise<BannedMember[]> {
    await this.expireBans();
    const rows = await this.database.query<BannedUserRow>(
      `SELECT u.id, u.username, u.discriminator, u.public_key, u.bio, u.avatar, u.banner,
       b.banned_at, b.banned_by, b.expires_at FROM server_bans b JOIN users u ON u.id = b.user_id
       WHERE b.server_id = $1 ORDER BY b.banned_at DESC, u.username`,
      [DEFAULT_SERVER_ID],
    );
    return Promise.all(rows.map(async (user) => ({
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      fingerprint: await publicKeyFingerprint(user.public_key),
      bio: user.bio,
      avatar: user.avatar,
      banner: user.banner,
      bannedAt: new Date(user.banned_at).toISOString(),
      bannedBy: user.banned_by,
      expiresAt: user.expires_at ? new Date(user.expires_at).toISOString() : null,
    })));
  }

  async performRetentionCleanup(): Promise<{ anonymizedUserIds: string[]; expiredBanUserIds: string[] }> {
    const expiredBanUserIds = await this.expireBans();
    const anonymized = await this.database.query<{ id: string }>(
      `WITH expired AS (
         DELETE FROM server_departures sd
         WHERE sd.anonymize_after <= now()
           AND NOT EXISTS (SELECT 1 FROM server_members sm WHERE sm.server_id = sd.server_id AND sm.user_id = sd.user_id)
         RETURNING sd.user_id
       )
       UPDATE users SET display_name = 'unknown', bio = '', avatar = NULL, banner = NULL, member_background = NULL,
        username = NULL, discriminator = NULL, custom_status = '', custom_status_emoji = '', accent_color = NULL, name_glow = NULL, name_font = 'none', updated_at = now()
       WHERE id IN (SELECT user_id FROM expired)
       RETURNING id`,
    );
    return { anonymizedUserIds: anonymized.map((user) => user.id), expiredBanUserIds };
  }

  private async expireBans(): Promise<string[]> {
    const expired = await this.database.query<{ user_id: string }>("DELETE FROM server_bans WHERE server_id = $1 AND expires_at IS NOT NULL AND expires_at <= now() RETURNING user_id", [DEFAULT_SERVER_ID]);
    return expired.map((ban) => ban.user_id);
  }

  async ensureMembership(userId: string, publicKey: string, bootstrapOwnerPublicKey?: string, allowFirstUserOwner = false): Promise<MemberRole> {
    const [existingOwner] = await this.database.query<{ user_id: string }>("SELECT user_id FROM server_members WHERE server_id = $1 AND role = 'owner'", [DEFAULT_SERVER_ID]);
    const mayBecomeOwner = (!existingOwner || existingOwner.user_id === userId)
      && (publicKey === bootstrapOwnerPublicKey || (allowFirstUserOwner && !existingOwner));
    const inserted = await this.database.query<{ user_id: string }>(
      `INSERT INTO server_members (server_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (server_id, user_id) DO UPDATE SET role = EXCLUDED.role
       WHERE server_members.role <> 'owner' AND EXCLUDED.role = 'owner'
       RETURNING user_id`,
      [DEFAULT_SERVER_ID, userId, mayBecomeOwner ? "owner" : "member"],
    );
    // Новая строка членства получает сид member-роли; владелец — вне таблицы ролей.
    if (inserted.length > 0 && !mayBecomeOwner) {
      await this.database.query(
        "INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [DEFAULT_SERVER_ID, userId, SEEDED_MEMBER_ROLE_ID],
      );
    }
    await this.database.query("DELETE FROM server_departures WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    const role = await this.getMemberRole(userId);
    // Владелец не хранит назначений: зачищаем возможные остатки, чтобы инвариант держался.
    if (role === "owner") await this.database.query("DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    return role;
  }

  async getMemberRole(userId: string): Promise<MemberRole> {
    const [row] = await this.database.query<{ role: MemberRole }>("SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    if (!row) throw new Error("Server membership is missing");
    return row.role;
  }

  private async getOptionalMemberRole(userId: string): Promise<MemberRole | null> {
    const [row] = await this.database.query<{ role: MemberRole }>("SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    return row?.role ?? null;
  }

  async setMemberRole(userId: string, role: Exclude<MemberRole, "owner">): Promise<"updated" | "not_found" | "owner"> {
    const [current] = await this.database.query<{ role: MemberRole }>("SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    if (!current) return "not_found";
    if (current.role === "owner") return "owner";
    await this.database.query("UPDATE server_members SET role = $3 WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId, role]);
    // Legacy-поле остаётся источником для старых клиентов: синхронизируем сид-роли.
    await this.database.query("DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2 AND role_id IN ($3, $4)", [DEFAULT_SERVER_ID, userId, SEEDED_ADMINISTRATOR_ROLE_ID, SEEDED_MEMBER_ROLE_ID]);
    await this.database.query("INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
      DEFAULT_SERVER_ID, userId, role === "administrator" ? SEEDED_ADMINISTRATOR_ROLE_ID : SEEDED_MEMBER_ROLE_ID,
    ]);
    return "updated";
  }

  /**
   * Кастомные роли (протокол v48). Владелец — вне таблицы и обрабатывается
   * вызывающим кодом: здесь только CRUD строк и назначений.
   */
  async listRoles(): Promise<CustomRole[]> {
    const rows = await this.database.query<RoleRow>(
      "SELECT id, name, color, position, permissions FROM server_roles WHERE server_id = $1 ORDER BY position DESC, name",
      [DEFAULT_SERVER_ID],
    );
    return rows.map(mapRole);
  }

  async getRole(roleId: string): Promise<CustomRole | null> {
    const [row] = await this.database.query<RoleRow>("SELECT id, name, color, position, permissions FROM server_roles WHERE server_id = $1 AND id = $2", [DEFAULT_SERVER_ID, roleId]);
    return row ? mapRole(row) : null;
  }

  async createRole(id: string, name: string, color: string | null, position: number, permissions: Permission[]): Promise<CustomRole> {
    const rows = await this.database.query<RoleRow>(
      "INSERT INTO server_roles (id, server_id, name, color, position, permissions) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, color, position, permissions",
      [id, DEFAULT_SERVER_ID, name, color, position, [...new Set(permissions)]],
    );
    return mapRole(required(rows[0], "Created role is missing"));
  }

  async updateRole(roleId: string, patch: { name?: string; color?: string | null; position?: number; permissions?: Permission[] }): Promise<CustomRole | null> {
    const current = await this.getRole(roleId);
    if (!current) return null;
    const next = {
      name: patch.name ?? current.name,
      color: patch.color === undefined ? current.color : patch.color,
      position: patch.position ?? current.position,
      permissions: patch.permissions === undefined ? current.permissions : [...new Set(patch.permissions)],
    };
    const rows = await this.database.query<RoleRow>(
      "UPDATE server_roles SET name = $3, color = $4, position = $5, permissions = $6 WHERE server_id = $1 AND id = $2 RETURNING id, name, color, position, permissions",
      [DEFAULT_SERVER_ID, roleId, next.name, next.color, next.position, next.permissions],
    );
    return rows[0] ? mapRole(rows[0]) : null;
  }

  async deleteRole(roleId: string): Promise<boolean> {
    await this.database.query("DELETE FROM member_roles WHERE server_id = $1 AND role_id = $2", [DEFAULT_SERVER_ID, roleId]);
    const rows = await this.database.query<{ id: string }>("DELETE FROM server_roles WHERE server_id = $1 AND id = $2 RETURNING id", [DEFAULT_SERVER_ID, roleId]);
    if (rows.length > 0) await this.syncLegacyRoleForMembers();
    return rows.length > 0;
  }

  async getMemberRoleIds(userId: string): Promise<string[]> {
    const rows = await this.database.query<{ role_id: string }>("SELECT role_id FROM member_roles WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    return rows.map((row) => row.role_id);
  }

  /**
   * Назначает точный набор ролей; возвращает null для несуществующего участника
   * или владельца (владельца трогать нельзя). Несуществующие roleId молча
   * отбрасываются вызывающим кодом через проверку — здесь фильтруем по таблице.
   */
  async setMemberRoles(userId: string, roleIds: readonly string[]): Promise<"updated" | "not_found" | "owner"> {
    const [current] = await this.database.query<{ role: MemberRole }>("SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    if (!current) return "not_found";
    if (current.role === "owner") return "owner";
    const unique = [...new Set(roleIds)];
    const existing = unique.length
      ? await this.database.query<{ id: string }>("SELECT id FROM server_roles WHERE server_id = $1 AND id = ANY($2::uuid[])", [DEFAULT_SERVER_ID, unique])
      : [];
    const valid = new Set(existing.map((row) => row.id));
    await this.database.query("DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    for (const roleId of unique) {
      if (!valid.has(roleId)) continue;
      await this.database.query("INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [DEFAULT_SERVER_ID, userId, roleId]);
    }
    await this.syncLegacyRole(userId);
    return "updated";
  }

  /**
   * Legacy-поле role — производное от назначений для старых клиентов: сид
   * administrator в наборе даёт `administrator`, иначе `member`. Владелец не трогается.
   */
  private async syncLegacyRole(userId: string): Promise<void> {
    const [current] = await this.database.query<{ role: MemberRole }>("SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    if (!current || current.role === "owner") return;
    const ids = await this.getMemberRoleIds(userId);
    await this.database.query("UPDATE server_members SET role = $3 WHERE server_id = $1 AND user_id = $2", [
      DEFAULT_SERVER_ID, userId, ids.includes(SEEDED_ADMINISTRATOR_ROLE_ID) ? "administrator" : "member",
    ]);
  }

  private async syncLegacyRoleForMembers(): Promise<void> {
    const members = await this.database.query<{ user_id: string }>("SELECT user_id FROM server_members WHERE server_id = $1 AND role <> 'owner'", [DEFAULT_SERVER_ID]);
    for (const member of members) await this.syncLegacyRole(member.user_id);
  }

  /**
   * Эффективные права: владелец — всегда все; остальные — объединение (union)
   * назначенных ролей. Пустой набор даёт базовый голосовой доступ, как legacy member.
   */
  async getMemberPermissions(userId: string): Promise<Permission[]> {
    const role = await this.getMemberRole(userId);
    if (role === "owner") return [...ALL_PERMISSIONS];
    if (role === "administrator") {
      const ids = await this.getMemberRoleIds(userId);
      if (ids.length === 0) return permissionsForRole("administrator");
    }
    const ids = await this.getMemberRoleIds(userId);
    if (ids.length === 0) return permissionsForRole(role);
    const rows = await this.database.query<{ permissions: string[] | string | null }>("SELECT permissions FROM server_roles WHERE server_id = $1 AND id = ANY($2::uuid[])", [DEFAULT_SERVER_ID, ids]);
    const union = new Set<Permission>();
    for (const row of rows) for (const permission of parseRolePermissions(row.permissions)) union.add(permission);
    if (union.size === 0) return permissionsForRole(role);
    return [...union];
  }

  /**
   * Переопределения прав канала (протокол v49): только для ролей (roles only,
   * member-targets нет). allow/deny — подмножества существующих прав, новых нет.
   * Пустая пара (allow и deny пусты) строку не хранит — запись удаляется.
   */
  async listChannelOverwrites(): Promise<ChannelOverwrite[]> {
    const rows = await this.database.query<OverwriteRow>(
      `SELECT o.channel_id, o.role_id, o.allow, o.deny FROM channel_overwrites o
       JOIN channels c ON c.id = o.channel_id WHERE c.server_id = $1
       ORDER BY o.channel_id, o.role_id`,
      [DEFAULT_SERVER_ID],
    );
    return rows.map(mapOverwrite);
  }

  async listChannelOverwritesForChannel(channelId: string): Promise<ChannelOverwrite[]> {
    const rows = await this.database.query<OverwriteRow>(
      `SELECT o.channel_id, o.role_id, o.allow, o.deny FROM channel_overwrites o
       JOIN channels c ON c.id = o.channel_id WHERE c.server_id = $1 AND o.channel_id = $2`,
      [DEFAULT_SERVER_ID, channelId],
    );
    return rows.map(mapOverwrite);
  }

  async setChannelOverwrite(channelId: string, roleId: string, allow: readonly Permission[], deny: readonly Permission[]): Promise<ChannelOverwrite | null> {
    const uniqueAllow = [...new Set(allow)];
    const uniqueDeny = [...new Set(deny)];
    if (uniqueAllow.length === 0 && uniqueDeny.length === 0) {
      await this.database.query("DELETE FROM channel_overwrites WHERE channel_id = $1 AND role_id = $2", [channelId, roleId]);
      return null;
    }
    const rows = await this.database.query<OverwriteRow>(
      `INSERT INTO channel_overwrites (channel_id, role_id, allow, deny) VALUES ($1, $2, $3, $4)
       ON CONFLICT (channel_id, role_id) DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny
       RETURNING channel_id, role_id, allow, deny`,
      [channelId, roleId, uniqueAllow, uniqueDeny],
    );
    return rows[0] ? mapOverwrite(rows[0]) : null;
  }

  /**
   * Эффективные права в канале: (union прав ролей ∪ union allow) − union deny.
   * Deny побеждает allow при конфликте поперёк ролей (правило Discord).
   * Владелец вне overwrites: всегда все права, deny его не касается.
   */
  async getMemberChannelPermissions(userId: string, channelId: string): Promise<Permission[]> {
    const role = await this.getMemberRole(userId);
    if (role === "owner") return [...ALL_PERMISSIONS];
    const base = await this.getMemberPermissions(userId);
    const roleIds = await this.getMemberRoleIds(userId);
    if (roleIds.length === 0) return base;
    const rows = await this.database.query<OverwriteRow>(
      "SELECT channel_id, role_id, allow, deny FROM channel_overwrites WHERE channel_id = $1 AND role_id = ANY($2::uuid[])",
      [channelId, roleIds],
    );
    if (rows.length === 0) return base;
    return resolveChannelPermissions(base, rows.map((row) => mapOverwrite(row)));
  }

  async hasChannelPermission(userId: string, channelId: string, permission: Permission): Promise<boolean> {
    try {
      return (await this.getMemberChannelPermissions(userId, channelId)).includes(permission);
    } catch {
      return false;
    }
  }

  /** Каналы, видимые участнику: эффективный VOICE_CONNECT в канале (см. v49). */
  async getVisibleChannelIds(userId: string): Promise<Set<string>> {
    const role = await this.getMemberRole(userId);
    if (role === "owner") {
      const all = await this.database.query<{ id: string }>("SELECT id FROM channels WHERE server_id = $1", [DEFAULT_SERVER_ID]);
      return new Set(all.map((row) => row.id));
    }
    const visible = new Set<string>();
    const channels = await this.database.query<{ id: string }>("SELECT id FROM channels WHERE server_id = $1", [DEFAULT_SERVER_ID]);
    for (const channel of channels) {
      if (await this.hasChannelPermission(userId, channel.id, "VOICE_CONNECT")) visible.add(channel.id);
    }
    return visible;
  }

  async getAttachmentChannelId(attachmentId: string): Promise<string | null> {
    const [row] = await this.database.query<{ channel_id: string }>(
      `SELECT m.channel_id FROM message_attachments ma JOIN messages m ON m.id = ma.message_id
       WHERE ma.attachment_id = $1 LIMIT 1`,
      [attachmentId],
    );
    return row?.channel_id ?? null;
  }

  /** Вершина иерархии — max position назначенных ролей; владелец вне таблицы. */
  async getMemberTopPosition(userId: string): Promise<number> {
    const role = await this.getMemberRole(userId);
    if (role === "owner") return OWNER_TOP_POSITION;
    const ids = await this.getMemberRoleIds(userId);
    if (ids.length === 0) return role === "administrator" ? 10 : 0;
    const rows = await this.database.query<{ position: number }>("SELECT position FROM server_roles WHERE server_id = $1 AND id = ANY($2::uuid[])", [DEFAULT_SERVER_ID, ids]);
    if (rows.length === 0) return 0;
    return Math.max(...rows.map((row) => Number(row.position)));
  }

  async listMembers(statuses: ReadonlyMap<string, PublicMemberStatus>): Promise<Member[]> {
    const users = await this.database.query<UserRow>(
      `SELECT u.id, u.username, u.discriminator, u.public_key, u.bio, u.avatar, u.banner, u.member_background, u.custom_status, u.custom_status_emoji, u.accent_color, u.name_glow, u.name_font, sm.role, sm.chat_muted, sm.chat_muted_until, sm.help_accepted FROM server_members sm
       JOIN users u ON u.id = sm.user_id WHERE sm.server_id = $1
       ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'administrator' THEN 1 ELSE 2 END, u.username`,
      [DEFAULT_SERVER_ID],
    );
    const roleIds = await this.getRoleIdsForMembers(users.map((user) => user.id));
    return Promise.all(users.map((user) => mapMember(user, statuses.get(user.id) ?? "offline", roleIds.get(user.id) ?? [])));
  }

  async getMember(userId: string, status: PublicMemberStatus): Promise<Member> {
    const [user] = await this.database.query<UserRow>(
      `SELECT u.id, u.username, u.discriminator, u.public_key, u.bio, u.avatar, u.banner, u.member_background, u.custom_status, u.custom_status_emoji, u.accent_color, u.name_glow, u.name_font, sm.role, sm.chat_muted, sm.chat_muted_until, sm.help_accepted FROM users u
       JOIN server_members sm ON sm.user_id = u.id AND sm.server_id = $2 WHERE u.id = $1`,
      [userId, DEFAULT_SERVER_ID],
    );
    if (!user) throw new Error("User is missing");
    return mapMember(user, status, await this.getMemberRoleIds(userId));
  }

  private async getRoleIdsForMembers(userIds: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (userIds.length === 0) return result;
    const rows = await this.database.query<{ user_id: string; role_id: string }>("SELECT user_id, role_id FROM member_roles WHERE server_id = $1 AND user_id = ANY($2::text[])", [DEFAULT_SERVER_ID, [...userIds]]);
    for (const row of rows) {
      const current = result.get(row.user_id) ?? [];
      current.push(row.role_id);
      result.set(row.user_id, current);
    }
    return result;
  }

  /**
   * Эффективный мут: если срок истёк — лениво очищаем флаг и возвращаем false.
   * Сервер так же проверяет перед приёмом сообщений.
   */
  async isChatMuted(userId: string): Promise<boolean> {
    const [row] = await this.database.query<{ chat_muted: boolean; chat_muted_until: Date | string | null }>(
      "SELECT chat_muted, chat_muted_until FROM server_members WHERE server_id = $1 AND user_id = $2",
      [DEFAULT_SERVER_ID, userId],
    );
    if (!row || row.chat_muted !== true) return false;
    if (row.chat_muted_until && new Date(row.chat_muted_until).getTime() <= Date.now()) {
      await this.database.query("UPDATE server_members SET chat_muted = false, chat_muted_until = NULL WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
      return false;
    }
    return true;
  }

  async setChatMuted(userId: string, muted: boolean, durationMinutes: number | null = null): Promise<boolean> {
    const until = muted && durationMinutes !== null ? new Date(Date.now() + durationMinutes * 60_000) : null;
    const rows = await this.database.query<{ user_id: string }>(
      "UPDATE server_members SET chat_muted = $3, chat_muted_until = $4 WHERE server_id = $1 AND user_id = $2 RETURNING user_id",
      [DEFAULT_SERVER_ID, userId, muted, until],
    );
    return rows.length > 0;
  }

  /**
   * Серверный мут голоса — состояние модерации, а не свойство подключения: голосовой
   * сервис держит presence только пока участник в канале, поэтому источником истины
   * должна быть база. Иначе `voice.leave` стирал бы мут вместе с presence.
   */
  async isVoiceMuted(userId: string): Promise<boolean> {
    const [row] = await this.database.query<{ voice_muted: boolean }>(
      "SELECT voice_muted FROM server_members WHERE server_id = $1 AND user_id = $2",
      [DEFAULT_SERVER_ID, userId],
    );
    return row?.voice_muted === true;
  }

  async setVoiceMuted(userId: string, muted: boolean): Promise<boolean> {
    const rows = await this.database.query<{ user_id: string }>(
      "UPDATE server_members SET voice_muted = $3 WHERE server_id = $1 AND user_id = $2 RETURNING user_id",
      [DEFAULT_SERVER_ID, userId, muted],
    );
    return rows.length > 0;
  }

  /**
   * Гейт правил (протокол v43). Принятие хранится на строке членства, поэтому
   * выход с сервера его сбрасывает: повторный вход покажет правила заново.
   */
  async isHelpAccepted(userId: string): Promise<boolean> {
    const [row] = await this.database.query<{ help_accepted: boolean }>(
      "SELECT help_accepted FROM server_members WHERE server_id = $1 AND user_id = $2",
      [DEFAULT_SERVER_ID, userId],
    );
    return row?.help_accepted === true;
  }

  async setHelpAccepted(userId: string): Promise<boolean> {
    const rows = await this.database.query<{ user_id: string }>(
      "UPDATE server_members SET help_accepted = true, help_accepted_at = now() WHERE server_id = $1 AND user_id = $2 RETURNING user_id",
      [DEFAULT_SERVER_ID, userId],
    );
    return rows.length > 0;
  }

  /**
   * Заблокирована ли писанина гейтом: гейт включён в спеке — а участник
   * правила ещё не принял. Проверяется сервером перед chat.send/pm/apm,
   * message.update, message.react и voice.join; чтение остаётся открытым.
   */
  async isHelpGateBlocked(userId: string): Promise<boolean> {
    const server = await this.getServer();
    if (!server.helpPage.enabled || !server.helpPage.gate.enabled) return false;
    return !(await this.isHelpAccepted(userId));
  }

  async createAttachment(id: string, uploaderId: string, storageKey: string, fileName: string, mimeType: string, sizeBytes: number, sha256: string): Promise<Attachment> {
    const rows = await this.database.query<AttachmentRow>(
      `INSERT INTO attachments (id, server_id, uploader_id, storage_key, original_name, mime_type, size_bytes, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, storage_key, original_name, mime_type, size_bytes, sha256`,
      [id, DEFAULT_SERVER_ID, uploaderId, storageKey, fileName, mimeType, sizeBytes, sha256],
    );
    return mapAttachment(required(rows[0], "Created attachment is missing"));
  }

  async countPendingAttachments(uploaderId: string): Promise<number> {
    const [row] = await this.database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM attachments a
       WHERE a.uploader_id = $1 AND a.server_id = $2
       AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id = a.id)`,
      [uploaderId, DEFAULT_SERVER_ID],
    );
    return Number(row?.count ?? 0);
  }

  /**
   * Вложение доступно, только если оно своё (ещё не прикреплённое к сообщению) либо висит
   * на сообщении, которое пользователю видно. Условие видимости то же, что в `getHistory`:
   * личная переписка не открывается посторонним по одному лишь идентификатору файла.
   */
  async getAccessibleAttachment(attachmentId: string, userId: string): Promise<(Attachment & { storageKey: string }) | null> {
    const [row] = await this.database.query<AttachmentRow>(
      `SELECT a.id, a.storage_key, a.original_name, a.mime_type, a.size_bytes, a.sha256
       FROM attachments a WHERE a.id = $1 AND a.server_id = $3
       AND (a.uploader_id = $2 OR EXISTS (
         SELECT 1 FROM message_attachments ma
         JOIN messages m ON m.id = ma.message_id
         JOIN channels c ON c.id = m.channel_id
         WHERE ma.attachment_id = a.id AND c.server_id = $3
           AND (m.kind = 'chat' OR m.author_id = $2 OR m.target_user_id = $2)
       ))`,
      [attachmentId, userId, DEFAULT_SERVER_ID],
    );
    return row ? { ...mapAttachment(row), storageKey: row.storage_key } : null;
  }

  async createMessage(id: string, channelId: string, authorId: string, content: string, attachmentIds: string[] = [], mentions: string[] = [], kind: "chat" | "pm" | "apm" = "chat", targetUserId: string | null = null, anonymous = false, replyToMessageId: string | null = null): Promise<ChatMessage | null> {
    const rows = await this.database.query<MessageRow>(
      `WITH requested AS (
         SELECT value::uuid AS id, (position - 1)::integer AS position
         FROM unnest($5::uuid[]) WITH ORDINALITY AS input(value, position)
       ), available AS (
         SELECT r.id, r.position FROM requested r JOIN attachments a ON a.id = r.id
         WHERE a.uploader_id = $3 AND a.server_id = $6
         AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id = a.id)
       ), inserted AS (
          INSERT INTO messages (id, channel_id, author_id, content, kind, target_user_id, anonymous, reply_to_message_id)
          SELECT $1, $2, $3, $4, $8, $9, $10, $11
          WHERE (SELECT count(*) FROM requested) = (SELECT count(*) FROM available)
          RETURNING id, channel_id, author_id, content, created_at, edited_at, kind, target_user_id, anonymous, reply_to_message_id, pinned, pinned_at
       ), linked AS (
         INSERT INTO message_attachments (message_id, attachment_id, position)
         SELECT inserted.id, available.id, available.position FROM inserted CROSS JOIN available
       ), mentioned AS (
         INSERT INTO message_mentions (message_id, user_id, position)
         SELECT inserted.id, candidate.value, candidate.position FROM inserted
         CROSS JOIN (
           SELECT DISTINCT ON (input.value) input.value, (input.ordinality - 1)::integer AS position
           FROM unnest($7::text[]) WITH ORDINALITY AS input(value, ordinality)
           WHERE EXISTS (SELECT 1 FROM server_members sm WHERE sm.server_id = $6 AND sm.user_id = input.value)
           ORDER BY input.value, input.ordinality
         ) AS candidate
       )
        SELECT id, channel_id, author_id, content, created_at, edited_at, kind, target_user_id, anonymous, reply_to_message_id, pinned, pinned_at,
        (SELECT coalesce(username, 'unknown') FROM users WHERE users.id = author_id) AS author_name,
        (SELECT avatar FROM users WHERE users.id = author_id) AS author_avatar FROM inserted`,
      [id, channelId, authorId, content, attachmentIds, DEFAULT_SERVER_ID, mentions, kind, targetUserId, anonymous, replyToMessageId],
    );
    const row = rows[0];
    if (!row) return null;
    const attachments = await this.getAttachmentsForMessages([id]);
    const messageMentions = await this.getMentionsForMessages([id]);
    const messageReactions = await this.getReactionsForMessages([id]);
    return mapMessage(row, attachments.get(id) ?? [], messageMentions.get(id) ?? [], messageReactions.get(id) ?? []);
  }

  async getMessageAccess(messageId: string): Promise<{ authorId: string; channelId: string; kind: "chat" | "pm" | "apm"; targetUserId: string | null } | null> {
    const [row] = await this.database.query<{ author_id: string; channel_id: string; kind: "chat" | "pm" | "apm"; target_user_id: string | null }>(
      `SELECT m.author_id, m.channel_id, m.kind, m.target_user_id FROM messages m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = $1 AND c.server_id = $2`,
      [messageId, DEFAULT_SERVER_ID],
    );
    return row ? { authorId: row.author_id, channelId: row.channel_id, kind: row.kind, targetUserId: row.target_user_id } : null;
  }

  async canReplyToMessage(messageId: string, channelId: string, viewerId: string): Promise<boolean> {
    const [row] = await this.database.query<{ allowed: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE m.id = $1 AND m.channel_id = $2 AND c.server_id = $4
         AND (m.kind = 'chat' OR m.author_id = $3 OR m.target_user_id = $3)
       ) AS allowed`,
      [messageId, channelId, viewerId, DEFAULT_SERVER_ID],
    );
    return row?.allowed === true;
  }

  async updateMessage(messageId: string, authorId: string, content: string, attachmentIds: string[] = [], mentions: string[] = []): Promise<{ message: ChatMessage; removedStorageKeys: string[] } | null> {
    const rows = await this.database.query<MessageUpdateRow>(
      `WITH requested AS (
         SELECT value::uuid AS id, (position - 1)::integer AS position
         FROM unnest($4::uuid[]) WITH ORDINALITY AS input(value, position)
       ), available AS (
         SELECT r.id, r.position FROM requested r JOIN attachments a ON a.id = r.id
         WHERE a.server_id = $5 AND (
           EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.message_id = $1 AND ma.attachment_id = a.id)
           OR (a.uploader_id = $2 AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id = a.id))
         )
       ), updated AS (
          UPDATE messages AS m SET content = $3, edited_at = now()
          WHERE m.id = $1 AND m.author_id = $2
          AND EXISTS (SELECT 1 FROM channels c WHERE c.id = m.channel_id AND c.server_id = $5)
          AND (SELECT count(*) FROM requested) = (SELECT count(*) FROM available)
          AND ($3 <> '' OR EXISTS (SELECT 1 FROM requested))
          RETURNING m.id, m.channel_id, m.author_id, m.content, m.created_at, m.edited_at, m.kind, m.target_user_id, m.anonymous, m.reply_to_message_id, m.pinned, m.pinned_at
       ), removed AS (
         DELETE FROM message_attachments ma USING updated
         WHERE ma.message_id = updated.id AND NOT EXISTS (SELECT 1 FROM requested r WHERE r.id = ma.attachment_id)
         RETURNING ma.attachment_id
       ), linked AS (
         INSERT INTO message_attachments (message_id, attachment_id, position)
         SELECT updated.id, available.id, available.position FROM updated CROSS JOIN available
         ON CONFLICT (message_id, attachment_id) DO UPDATE SET position = excluded.position
       ), removed_mentions AS (
         DELETE FROM message_mentions mm USING updated
         WHERE mm.message_id = updated.id
         RETURNING mm.user_id
       ), linked_mentions AS (
         INSERT INTO message_mentions (message_id, user_id, position)
         SELECT updated.id, candidate.value, candidate.position FROM updated
         CROSS JOIN (
           SELECT DISTINCT ON (input.value) input.value, (input.ordinality - 1)::integer AS position
           FROM unnest($6::text[]) WITH ORDINALITY AS input(value, ordinality)
           WHERE EXISTS (SELECT 1 FROM server_members sm WHERE sm.server_id = $5 AND sm.user_id = input.value)
           ORDER BY input.value, input.ordinality
         ) AS candidate
       ), removed_files AS (
         DELETE FROM attachments a USING removed WHERE a.id = removed.attachment_id RETURNING a.storage_key
       )
        SELECT updated.id, updated.channel_id, updated.author_id, updated.content, updated.created_at, updated.edited_at, updated.kind, updated.target_user_id, updated.anonymous, updated.reply_to_message_id, updated.pinned, updated.pinned_at,
       (SELECT coalesce(username, 'unknown') FROM users WHERE users.id = updated.author_id) AS author_name,
       (SELECT avatar FROM users WHERE users.id = updated.author_id) AS author_avatar,
       COALESCE((SELECT array_agg(storage_key) FROM removed_files), ARRAY[]::text[]) AS removed_storage_keys
       FROM updated`,
      [messageId, authorId, content, attachmentIds, DEFAULT_SERVER_ID, mentions],
    );
    const row = rows[0];
    if (!row) return null;
    const attachments = await this.getAttachmentsForMessages([messageId]);
    const messageMentions = await this.getMentionsForMessages([messageId]);
    const messageReactions = await this.getReactionsForMessages([messageId]);
    return { message: mapMessage(row, attachments.get(messageId) ?? [], messageMentions.get(messageId) ?? [], messageReactions.get(messageId) ?? []), removedStorageKeys: row.removed_storage_keys ?? [] };
  }

  /**
   * Переключает реакцию: если пользователь уже поставил такой эмодзи — снимает,
   * иначе добавляет. Возвращает актуальный список реакций или null, если сообщение
   * не существует или недоступно на этом сервере.
   */
  async toggleReaction(messageId: string, userId: string, emoji: string): Promise<MessageReaction[] | null> {
    const access = await this.getMessageAccess(messageId);
    if (!access) return null;
    const removed = await this.database.query<{ message_id: string }>(
      `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING message_id`,
      [messageId, userId, emoji],
    );
    if (!removed.length) {
      await this.database.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
        [messageId, userId, emoji],
      );
    }
    return (await this.getReactionsForMessages([messageId])).get(messageId) ?? [];
  }

  async deleteMessage(messageId: string, authorId: string, allowAnyAuthor: boolean): Promise<{ channelId: string; storageKeys: string[] } | null> {
    const candidates = await this.database.query<DeleteCandidateRow>(
      `SELECT m.author_id, m.channel_id, a.id AS attachment_id, a.storage_key
       FROM messages m JOIN channels c ON c.id = m.channel_id
       LEFT JOIN message_attachments ma ON ma.message_id = m.id
       LEFT JOIN attachments a ON a.id = ma.attachment_id
       WHERE m.id = $1 AND c.server_id = $2`,
      [messageId, DEFAULT_SERVER_ID],
    );
    const candidate = candidates[0];
    if (!candidate || (candidate.author_id !== authorId && !allowAnyAuthor)) return null;
    const deleted = await this.database.query<{ channel_id: string }>(
      `DELETE FROM messages WHERE id = $1 AND (author_id = $2 OR $3 = true) RETURNING channel_id`,
      [messageId, authorId, allowAnyAuthor],
    );
    if (!deleted[0]) return null;
    const attachmentIds = candidates.flatMap((row) => row.attachment_id ? [row.attachment_id] : []);
    if (attachmentIds.length) await this.database.query("DELETE FROM attachments WHERE id = ANY($1::uuid[]) AND server_id = $2", [attachmentIds, DEFAULT_SERVER_ID]);
    return { channelId: deleted[0].channel_id, storageKeys: candidates.flatMap((row) => row.storage_key ? [row.storage_key] : []) };
  }

  /**
   * Массово удаляет обычные сообщения одного текстового канала (протокол v47).
   * Всё или ничего: если хотя бы одно сообщение отсутствует, лежит в другом канале
   * или является личным (pm/apm) — ничего не удаляется и возвращается null.
   * Удаление выполняется одним оператором DELETE (атомарно), затем чистятся
   * осиротевшие вложения. Владение не проверяется: права проверяет сервер.
   */
  async deleteMessages(messageIds: readonly string[], channelId: string): Promise<{ deletedIds: string[]; channelId: string; storageKeys: string[] } | null> {
    if (messageIds.length === 0) return null;
    const scope = await this.database.query<{ id: string; channel_id: string; kind: "chat" | "pm" | "apm" }>(
      `SELECT m.id, m.channel_id, m.kind FROM messages m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = ANY($1::uuid[]) AND c.server_id = $2`,
      [[...messageIds], DEFAULT_SERVER_ID],
    );
    if (scope.length !== messageIds.length) return null;
    for (const row of scope) {
      if (row.channel_id !== channelId || row.kind !== "chat") return null;
    }
    const candidates = await this.database.query<{ attachment_id: string | null; storage_key: string | null }>(
      `SELECT a.id AS attachment_id, a.storage_key
       FROM message_attachments ma JOIN attachments a ON a.id = ma.attachment_id
       WHERE ma.message_id = ANY($1::uuid[])`,
      [[...messageIds]],
    );
    const deleted = await this.database.query<{ id: string; channel_id: string }>(
      `DELETE FROM messages WHERE id = ANY($1::uuid[]) RETURNING id, channel_id`,
      [[...messageIds]],
    );
    if (deleted.length !== messageIds.length) return null;
    const attachmentIds = candidates.flatMap((row) => row.attachment_id ? [row.attachment_id] : []);
    if (attachmentIds.length) await this.database.query("DELETE FROM attachments WHERE id = ANY($1::uuid[]) AND server_id = $2", [attachmentIds, DEFAULT_SERVER_ID]);
    return { deletedIds: deleted.map((row) => row.id), channelId, storageKeys: candidates.flatMap((row) => row.storage_key ? [row.storage_key] : []) };
  }

  /**
   * Закрепляет сообщение канала или снимает закреп. Личные (pm/apm) не закрепляются:
   * закреп — свойство канала, а не переписки двух участников.
   */
  async setMessagePinned(messageId: string, pinned: boolean): Promise<ChatMessage | null> {
    const rows = await this.database.query<MessageRow>(
      `UPDATE messages AS m SET pinned = $2, pinned_at = CASE WHEN $2 THEN now() ELSE NULL END
       WHERE m.id = $1 AND m.kind = 'chat'
       AND EXISTS (SELECT 1 FROM channels c WHERE c.id = m.channel_id AND c.server_id = $3)
       RETURNING m.id, m.channel_id, m.author_id,
       (SELECT coalesce(username, 'unknown') FROM users WHERE users.id = m.author_id) AS author_name,
       (SELECT avatar FROM users WHERE users.id = m.author_id) AS author_avatar,
       m.content, m.created_at, m.edited_at, m.kind, m.target_user_id, m.anonymous, m.reply_to_message_id, m.pinned, m.pinned_at`,
      [messageId, pinned, DEFAULT_SERVER_ID],
    );
    const row = rows[0];
    if (!row) return null;
    const attachments = await this.getAttachmentsForMessages([messageId]);
    const messageMentions = await this.getMentionsForMessages([messageId]);
    const messageReactions = await this.getReactionsForMessages([messageId]);
    return mapMessage(row, attachments.get(messageId) ?? [], messageMentions.get(messageId) ?? [], messageReactions.get(messageId) ?? []);
  }

  async listPinnedMessages(channelId: string, limit: number, viewerId: string): Promise<ChatMessage[]> {
    const rows = await this.database.query<MessageRow>(
      `SELECT m.id, m.channel_id, m.author_id, coalesce(u.username, 'unknown') AS author_name, u.avatar AS author_avatar, m.content, m.created_at, m.edited_at, m.kind, m.target_user_id, m.anonymous, m.reply_to_message_id, m.pinned, m.pinned_at
       FROM messages m JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = $1 AND m.pinned = true AND m.kind = 'chat'
       AND (m.kind = 'chat' OR m.author_id = $3 OR m.target_user_id = $3)
       ORDER BY m.pinned_at DESC NULLS LAST, m.created_at DESC LIMIT $2`,
      [channelId, limit, viewerId],
    );
    const attachments = await this.getAttachmentsForMessages(rows.map((message) => message.id));
    const messageMentions = await this.getMentionsForMessages(rows.map((message) => message.id));
    const messageReactions = await this.getReactionsForMessages(rows.map((message) => message.id));
    return rows.map((message) => mapMessage(message, attachments.get(message.id) ?? [], messageMentions.get(message.id) ?? [], messageReactions.get(message.id) ?? [])).map((message) => messageForViewer(message, viewerId));
  }

  async getHistory(channelId: string, limit: number, viewerId: string): Promise<ChatMessage[]> {
    const rows = await this.database.query<MessageRow>(
      `SELECT m.id, m.channel_id, m.author_id, coalesce(u.username, 'unknown') AS author_name, u.avatar AS author_avatar, m.content, m.created_at, m.edited_at, m.kind, m.target_user_id, m.anonymous, m.reply_to_message_id, m.pinned, m.pinned_at
       FROM messages m JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = $1 AND (m.kind = 'chat' OR m.author_id = $3 OR m.target_user_id = $3)
       ORDER BY m.created_at DESC LIMIT $2`,
      [channelId, limit, viewerId],
    );
    const ordered = rows.reverse();
    const attachments = await this.getAttachmentsForMessages(ordered.map((message) => message.id));
    const messageMentions = await this.getMentionsForMessages(ordered.map((message) => message.id));
    const messageReactions = await this.getReactionsForMessages(ordered.map((message) => message.id));
    return ordered.map((message) => mapMessage(message, attachments.get(message.id) ?? [], messageMentions.get(message.id) ?? [], messageReactions.get(message.id) ?? [])).map((message) => messageForViewer(message, viewerId));
  }

  async updateServerSettings(settings: Omit<ServerSettings, "description" | "helpPage" | "welcomeChannelId" | "welcomeMessage"> & { description?: string; helpPage?: ServerHelp; welcomeChannelId?: string | null; welcomeMessage?: string }): Promise<void> {
    // Старые клиенты новые поля не шлют (в событии они опциональны): тогда сохраняем
    // существующие значения, чтобы смена названия не затирала welcome-настройки.
    const [current] = settings.helpPage === undefined || settings.welcomeChannelId === undefined || settings.welcomeMessage === undefined
      ? await this.database.query<Pick<ServerRow, "help_page" | "welcome_channel_id" | "welcome_message">>("SELECT help_page, welcome_channel_id, welcome_message FROM servers WHERE id = $1", [DEFAULT_SERVER_ID])
      : [];
    const helpPage = settings.helpPage ?? parseServerHelpPage(current?.help_page ?? null);
    await this.database.query(
      "UPDATE servers SET name = $2, description = $3, max_attachment_bytes = $4, screen_share_max_resolution = $5, screen_share_max_frame_rate = $6, help_page = $7, welcome_channel_id = $8, welcome_message = $9 WHERE id = $1",
      [DEFAULT_SERVER_ID, settings.name, settings.description ?? "", settings.maxAttachmentBytes, settings.screenShareMaxResolution, settings.screenShareMaxFrameRate, JSON.stringify(helpPage), settings.welcomeChannelId !== undefined ? settings.welcomeChannelId : (current?.welcome_channel_id ?? null), settings.welcomeMessage !== undefined ? settings.welcomeMessage : (current?.welcome_message ?? DEFAULT_WELCOME_MESSAGE)],
    );
  }

  /** Был ли пользователь уже зарегистрирован: повторный вход приветствия не получает. */
  async userExists(userId: string): Promise<boolean> {
    const [row] = await this.database.query<{ id: string }>("SELECT id FROM users WHERE id = $1", [userId]);
    return Boolean(row);
  }

  async isMember(userId: string): Promise<boolean> {
    return (await this.getOptionalMemberRole(userId)) !== null;
  }

  /** Владелец — автор системных приветствий (plain chat от имени сервера). */
  async getOwnerId(): Promise<string | null> {
    const [row] = await this.database.query<{ user_id: string }>("SELECT user_id FROM server_members WHERE server_id = $1 AND role = 'owner'", [DEFAULT_SERVER_ID]);
    return row?.user_id ?? null;
  }

  async searchMessages(filters: MessageSearchFilters, visibleChannelIds?: readonly string[]): Promise<MessageSearchResult> {
    // Личные и анонимные сообщения в общий поиск не попадают.
    // visibleChannelIds (протокол v49): скрытые overwrites-каналы из поиска исключаются.
    const conditions = `c.server_id = $1
      AND m.kind = 'chat'
      AND ($2::text = '' OR m.content ILIKE '%' || $2 || '%' OR EXISTS (
        SELECT 1 FROM message_attachments search_ma JOIN attachments search_a ON search_a.id = search_ma.attachment_id
        WHERE search_ma.message_id = m.id AND search_a.original_name ILIKE '%' || $2 || '%'
      ))
      AND ($3::text IS NULL OR m.author_id = $3)
      AND ($4::uuid IS NULL OR m.channel_id = $4)
      AND (cardinality($5::text[]) = 0
        OR ('text' = ANY($5::text[]) AND m.content <> '')
        OR ('image' = ANY($5::text[]) AND EXISTS (
          SELECT 1 FROM message_attachments image_ma JOIN attachments image_a ON image_a.id = image_ma.attachment_id
          WHERE image_ma.message_id = m.id AND image_a.mime_type LIKE 'image/%'
        ))
        OR ('video' = ANY($5::text[]) AND EXISTS (
          SELECT 1 FROM message_attachments video_ma JOIN attachments video_a ON video_a.id = video_ma.attachment_id
          WHERE video_ma.message_id = m.id AND video_a.mime_type LIKE 'video/%'
        ))
        OR ('file' = ANY($5::text[]) AND EXISTS (
          SELECT 1 FROM message_attachments file_ma JOIN attachments file_a ON file_a.id = file_ma.attachment_id
          WHERE file_ma.message_id = m.id AND file_a.mime_type NOT LIKE 'image/%' AND file_a.mime_type NOT LIKE 'video/%'
        )))
      AND ($6::boolean = false OR m.pinned = true)
      AND ($7::uuid[] IS NULL OR m.channel_id = ANY($7::uuid[]))`;
    const parameters = [DEFAULT_SERVER_ID, filters.query, filters.authorId, filters.channelId, filters.contentTypes, filters.pinnedOnly, visibleChannelIds ? [...visibleChannelIds] : null];
    const [countRow] = await this.database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM messages m JOIN channels c ON c.id = m.channel_id WHERE ${conditions}`,
      parameters,
    );
    const rows = await this.database.query<MessageRow>(
      `SELECT m.id, m.channel_id, m.author_id, coalesce(u.username, 'unknown') AS author_name, u.avatar AS author_avatar, m.content, m.created_at, m.edited_at, m.kind, m.target_user_id, m.anonymous, m.reply_to_message_id, m.pinned, m.pinned_at
       FROM messages m JOIN users u ON u.id = m.author_id JOIN channels c ON c.id = m.channel_id
       WHERE ${conditions} ORDER BY m.created_at DESC, m.id DESC LIMIT $8 OFFSET $9`,
      [...parameters, filters.limit, filters.offset],
    );
    const attachments = await this.getAttachmentsForMessages(rows.map((message) => message.id));
    const messageMentions = await this.getMentionsForMessages(rows.map((message) => message.id));
    const messageReactions = await this.getReactionsForMessages(rows.map((message) => message.id));
    const total = Number(countRow?.count ?? 0);
    return {
      messages: rows.map((message) => mapMessage(message, attachments.get(message.id) ?? [], messageMentions.get(message.id) ?? [], messageReactions.get(message.id) ?? [])),
      total,
      offset: filters.offset,
      hasMore: filters.offset + rows.length < total,
    };
  }

  /**
   * Журнал модерации (протокол v50): append-only запись с cap 1000 строк.
   * Prune выполняется на каждом insert; ошибки логирует вызывающий код (best-effort).
   */
  async appendAuditLog(entry: { id: string; actorId: string; action: AuditAction; targetId?: string | null; detail?: string | null }): Promise<AuditEntry> {
    const rows = await this.database.query<AuditRow>(
      "INSERT INTO audit_log (id, actor_id, action, target_id, detail) VALUES ($1, $2, $3, $4, $5) RETURNING id, at, actor_id, action, target_id, detail",
      [entry.id, entry.actorId, entry.action, entry.targetId ?? null, entry.detail ?? null],
    );
    const saved = rows[0] ? mapAudit(rows[0]) : null;
    await this.database.query(
      `DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY at DESC, id DESC LIMIT $1)`,
      [AUDIT_LOG_MAX_ENTRIES],
    );
    if (!saved) throw new Error("Audit log insert failed");
    return saved;
  }

  async listAuditLog(limit: number, before?: string | null): Promise<{ entries: AuditEntry[]; hasMore: boolean }> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = await this.database.query<AuditRow>(
      `SELECT id, at, actor_id, action, target_id, detail FROM audit_log
       WHERE ($2::timestamptz IS NULL OR at < $2::timestamptz)
       ORDER BY at DESC, id DESC LIMIT $1`,
      [safeLimit + 1, before ?? null],
    );
    const entries: AuditEntry[] = [];
    for (const row of rows) {
      const mapped = mapAuditSafe(row);
      if (mapped) entries.push(mapped);
    }
    return { entries: entries.slice(0, safeLimit), hasMore: entries.length > safeLimit };
  }

  private async getMentionsForMessages(messageIds: string[]): Promise<Map<string, { userId: string }[]>> {
    const result = new Map<string, { userId: string }[]>();
    if (!messageIds.length) return result;
    const rows = await this.database.query<MentionRow>(
      `SELECT mm.message_id, mm.user_id FROM message_mentions mm
       WHERE mm.message_id = ANY($1::uuid[]) ORDER BY mm.message_id, mm.position`,
      [messageIds],
    );
    for (const row of rows) {
      if (!row.message_id) continue;
      const current = result.get(row.message_id) ?? [];
      current.push({ userId: row.user_id });
      result.set(row.message_id, current);
    }
    return result;
  }

  /**
   * Разовая чистка реакций, сохранённых до строгой проверки эмодзи. Проверка идёт тем же
   * валидатором, что и на входе, — SQL-приближение отсеяло бы либо не всё, либо лишнее.
   * Различных значений в таблице мало, поэтому DISTINCT дешёв.
   */
  async purgeInvalidReactions(): Promise<number> {
    const rows = await this.database.query<{ emoji: string }>("SELECT DISTINCT emoji FROM message_reactions");
    const invalid = rows.map((row) => row.emoji).filter((emoji) => !isReactionEmoji(emoji));
    if (!invalid.length) return 0;
    const deleted = await this.database.query<{ emoji: string }>(
      "DELETE FROM message_reactions WHERE emoji = ANY($1::text[]) RETURNING emoji",
      [invalid],
    );
    return deleted.length;
  }

  private async getReactionsForMessages(messageIds: string[]): Promise<Map<string, MessageReaction[]>> {
    const result = new Map<string, MessageReaction[]>();
    if (!messageIds.length) return result;
    const rows = await this.database.query<ReactionRow>(
      `SELECT message_id, user_id, emoji FROM message_reactions
       WHERE message_id = ANY($1::uuid[]) ORDER BY message_id, created_at, emoji`,
      [messageIds],
    );
    for (const row of rows) {
      if (!row.message_id) continue;
      // Реакции, сохранённые до строгой проверки, до клиентов не доходят: показывать
      // чужую «zalgo»-строку под сообщением — то же самое, что и принимать её.
      if (!isReactionEmoji(row.emoji)) continue;
      const current = result.get(row.message_id) ?? [];
      const existing = current.find((reaction) => reaction.emoji === row.emoji);
      if (existing) existing.userIds.push(row.user_id);
      else current.push({ emoji: row.emoji, userIds: [row.user_id] });
      result.set(row.message_id, current);
    }
    return result;
  }

  private async getAttachmentsForMessages(messageIds: string[]): Promise<Map<string, Attachment[]>> {
    const result = new Map<string, Attachment[]>();
    if (!messageIds.length) return result;
    const rows = await this.database.query<AttachmentRow>(
      `SELECT ma.message_id, a.id, a.storage_key, a.original_name, a.mime_type, a.size_bytes, a.sha256
       FROM message_attachments ma JOIN attachments a ON a.id = ma.attachment_id
       WHERE ma.message_id = ANY($1::uuid[]) ORDER BY ma.message_id, ma.position`,
      [messageIds],
    );
    for (const row of rows) {
      if (!row.message_id) continue;
      const current = result.get(row.message_id) ?? [];
      current.push(mapAttachment(row));
      result.set(row.message_id, current);
    }
    return result;
  }
}

export function permissionsForRole(role: MemberRole): Permission[] {
  if (role === "owner") return [...ALL_PERMISSIONS];
  if (role === "administrator") return ["MANAGE_CHANNELS", "MANAGE_MESSAGES", "KICK_MEMBERS", "VOICE_CONNECT", "VOICE_SPEAK", "VOICE_MODERATE"];
  return ["VOICE_CONNECT", "VOICE_SPEAK"];
}

function mapRole(row: RoleRow): CustomRole {
  return { id: row.id, name: row.name, color: row.color, position: Number(row.position), permissions: parseRolePermissions(row.permissions) };
}

function mapOverwrite(row: OverwriteRow): ChannelOverwrite {
  return { channelId: row.channel_id, roleId: row.role_id, allow: parseRolePermissions(row.allow), deny: parseRolePermissions(row.deny) };
}

function mapAudit(row: AuditRow): AuditEntry {
  return { id: row.id, at: new Date(row.at).toISOString(), actorId: row.actor_id, action: auditActionSchema.parse(row.action), targetId: row.target_id, detail: row.detail };
}

function mapAuditSafe(row: AuditRow): AuditEntry | null {
  const parsed = auditActionSchema.safeParse(row.action);
  if (!parsed.success) return null;
  return { id: row.id, at: new Date(row.at).toISOString(), actorId: row.actor_id, action: parsed.data, targetId: row.target_id, detail: row.detail };
}

/** permissions из text[] приходят массивом из pg и строкой `{a,b}` из части драйверов. */
function parseRolePermissions(value: string[] | string | null | undefined): Permission[] {
  const known = new Set<Permission>(ALL_PERMISSIONS);
  const raw: string[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/^[{\[]|[}\]]$/g, "").split(",").map((item) => item.trim().replace(/^"|"$/g, "")).filter(Boolean)
      : [];
  return raw.filter((item): item is Permission => known.has(item as Permission));
}

async function mapMember(user: UserRow, status: PublicMemberStatus, roleIds: string[] = []): Promise<Member> {
  const fingerprint = user.username && user.discriminator ? await publicKeyFingerprint(user.public_key) : "0000-0000-0000-0000";
  const mutedUntil = user.chat_muted_until ? new Date(user.chat_muted_until) : null;
  const chatMuted = user.chat_muted === true && (mutedUntil === null || mutedUntil.getTime() > Date.now());
  // Значение из базы обязано входить в enum протокола: мусор от старых записей
  // не должен ломать snapshot, поэтому неизвестное сводится к дефолту.
  const nameFont: NameFont = (NAME_FONT_VALUES as readonly string[]).includes(user.name_font ?? "") ? (user.name_font as NameFont) : "none";
  return { id: user.id, username: user.username ?? "unknown", discriminator: user.discriminator ?? "0000", fingerprint, bio: user.bio, avatar: user.avatar, banner: user.banner, memberBackground: user.member_background ?? null, status, customStatus: user.custom_status, customStatusEmoji: user.custom_status_emoji ?? "", accentColor: user.accent_color, nameGlow: user.name_glow, nameFont, role: user.role, roleIds, chatMuted, chatMutedUntil: chatMuted && mutedUntil ? mutedUntil.toISOString() : null, helpAccepted: user.help_accepted === true };
}

function mapMessage(row: MessageRow, attachments: Attachment[] = [], mentions: { userId: string }[] = [], reactions: MessageReaction[] = []): ChatMessage {
  return { id: row.id, channelId: row.channel_id, authorId: row.author_id, authorName: row.author_name, authorAvatar: row.author_avatar, content: row.content, createdAt: new Date(row.created_at).toISOString(), editedAt: row.edited_at ? new Date(row.edited_at).toISOString() : null, attachments, mentions, reactions, kind: row.kind, targetUserId: row.target_user_id, anonymous: row.anonymous === true, replyToMessageId: row.reply_to_message_id, pinned: row.pinned === true, pinnedAt: row.pinned_at ? new Date(row.pinned_at).toISOString() : null };
}

/**
 * Представление личного сообщения для конкретного зрителя. Анонимное (/apm)
 * сообщение получатель видит без личности отправителя: синтетический authorId,
 * имя «Аноним» и без аватара. Отправитель видит собственное сообщение как обычно.
 */
export function messageForViewer(message: ChatMessage, viewerId: string): ChatMessage {
  if (message.kind !== "apm" || message.targetUserId !== viewerId || message.authorId === viewerId) return message;
  return { ...message, authorId: `anonymous-${message.id}`, authorName: "Аноним", authorAvatar: null };
}

function mapAttachment(row: AttachmentRow): Attachment {
  // Имена, сохранённые до фильтрации, тоже не должны переставляться при отображении.
  return { id: row.id, fileName: stripBidiControls(row.original_name), mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), sha256: row.sha256 };
}

function mapChannel(row: ChannelRow): Channel {
  // Медленный режим существует только у текстовых каналов: в голосовом сообщений нет.
  return { id: row.id, name: row.name, kind: row.kind, description: row.description, participantLimit: row.kind === "voice" ? Number(row.participant_limit ?? 25) : null, slowmodeSeconds: row.kind === "text" ? Number(row.slowmode_seconds ?? 0) : 0 };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
