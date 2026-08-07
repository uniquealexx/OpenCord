import type { Attachment, Channel, ChatMessage, Member, MemberRole, MessageSearchFilters, MessageSearchResult, Permission, PublicProfile } from "@opencord/shared";
import type { Database, QueryRow } from "./database";
import { DEFAULT_SERVER_ID } from "./migrations";

interface ServerRow extends QueryRow { id: string; name: string; avatar: string | null }
interface ChannelRow extends QueryRow { id: string; name: string; kind: "text" | "voice"; description: string; participant_limit: number | null }
interface UserRow extends QueryRow { id: string; display_name: string; avatar: string | null; role: MemberRole }
interface MessageRow extends QueryRow { id: string; channel_id: string; author_id: string; author_name: string; author_avatar: string | null; content: string; created_at: Date | string; edited_at: Date | string | null }
interface AttachmentRow extends QueryRow { id: string; storage_key: string; original_name: string; mime_type: string; size_bytes: number; sha256: string; message_id?: string }
interface DeleteCandidateRow extends QueryRow { author_id: string; channel_id: string; attachment_id: string | null; storage_key: string | null }
interface MessageUpdateRow extends MessageRow { removed_storage_keys: string[] | null }

export class ChatRepository {
  constructor(private readonly database: Database) {}

  async configureServer(name: string, deploymentId: string): Promise<void> {
    await this.database.query(
      `UPDATE servers SET name = $2, deleted_at = CASE WHEN deployment_id <> $3 THEN NULL ELSE deleted_at END, deployment_id = $3 WHERE id = $1`,
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

  async getServer(): Promise<{ id: string; name: string; avatar: string | null; channels: Channel[] }> {
    const [server] = await this.database.query<ServerRow>("SELECT id, name, avatar FROM servers WHERE id = $1", [DEFAULT_SERVER_ID]);
    if (!server) throw new Error("Default server is missing");
    const channels = await this.database.query<ChannelRow>("SELECT id, name, kind, description, participant_limit FROM channels WHERE server_id = $1 ORDER BY position, name", [server.id]);
    return { id: server.id, name: server.name, avatar: server.avatar, channels: channels.map(mapChannel) };
  }

  async updateServerAvatar(avatar: string | null): Promise<void> {
    await this.database.query("UPDATE servers SET avatar = $2 WHERE id = $1", [DEFAULT_SERVER_ID, avatar]);
  }

  async channelExists(channelId: string): Promise<boolean> {
    const rows = await this.database.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1 AND kind = 'text') AS exists", [channelId]);
    return rows[0]?.exists === true;
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    const rows = await this.database.query<ChannelRow>("SELECT id, name, kind, description, participant_limit FROM channels WHERE id = $1 AND server_id = $2", [channelId, DEFAULT_SERVER_ID]);
    const row = rows[0];
    return row ? mapChannel(row) : null;
  }

  async createChannel(id: string, name: string, kind: Channel["kind"], description: string): Promise<Channel> {
    const rows = await this.database.query<ChannelRow>(
      `INSERT INTO channels (id, server_id, name, kind, description, participant_limit, position)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'voice' THEN 25 ELSE NULL END, COALESCE((SELECT MAX(position) + 1 FROM channels WHERE server_id = $2), 0))
       RETURNING id, name, kind, description, participant_limit`,
      [id, DEFAULT_SERVER_ID, name, kind, description],
    );
    return mapChannel(required(rows[0], "Created channel is missing"));
  }

  async updateChannel(channelId: string, name: string, description: string, participantLimit: number | null): Promise<Channel | null> {
    const rows = await this.database.query<ChannelRow>(
      `UPDATE channels SET name = $3, description = $4,
       participant_limit = CASE WHEN kind = 'voice' THEN $5::integer ELSE NULL END
       WHERE id = $1 AND server_id = $2
       RETURNING id, name, kind, description, participant_limit`,
      [channelId, DEFAULT_SERVER_ID, name, description, participantLimit],
    );
    return rows[0] ? mapChannel(rows[0]) : null;
  }

  async deleteChannel(channelId: string): Promise<boolean> {
    const rows = await this.database.query<{ id: string }>(
      "DELETE FROM channels WHERE id = $1 AND server_id = $2 RETURNING id",
      [channelId, DEFAULT_SERVER_ID],
    );
    return rows.length > 0;
  }

  async upsertUser(userId: string, publicKey: string, profile: PublicProfile): Promise<void> {
    await this.database.query(
      `INSERT INTO users (id, public_key, display_name, avatar) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, avatar = EXCLUDED.avatar, updated_at = now()
       WHERE users.public_key = EXCLUDED.public_key`,
      [userId, publicKey, profile.displayName, profile.avatar],
    );
  }

  async updateUserProfile(userId: string, profile: PublicProfile): Promise<boolean> {
    const rows = await this.database.query<{ id: string }>(
      "UPDATE users SET display_name = $2, avatar = $3, updated_at = now() WHERE id = $1 RETURNING id",
      [userId, profile.displayName, profile.avatar],
    );
    return rows.length > 0;
  }

  async leaveServer(userId: string): Promise<MemberRole | null> {
    const role = await this.getOptionalMemberRole(userId);
    if (!role) return null;
    await this.database.query("UPDATE users SET avatar = NULL, updated_at = now() WHERE id = $1", [userId]);
    if (role !== "owner") await this.database.query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, userId]);
    return role;
  }

  async ensureMembership(userId: string, publicKey: string, bootstrapOwnerPublicKey?: string, allowFirstUserOwner = false): Promise<MemberRole> {
    const [existingOwner] = await this.database.query<{ user_id: string }>("SELECT user_id FROM server_members WHERE server_id = $1 AND role = 'owner'", [DEFAULT_SERVER_ID]);
    const mayBecomeOwner = (!existingOwner || existingOwner.user_id === userId)
      && (publicKey === bootstrapOwnerPublicKey || (allowFirstUserOwner && !existingOwner));
    await this.database.query(
      `INSERT INTO server_members (server_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (server_id, user_id) DO UPDATE SET role = EXCLUDED.role
       WHERE server_members.role <> 'owner' AND EXCLUDED.role = 'owner'`,
      [DEFAULT_SERVER_ID, userId, mayBecomeOwner ? "owner" : "member"],
    );
    return this.getMemberRole(userId);
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
    return "updated";
  }

  async listMembers(onlineIds: ReadonlySet<string>): Promise<Member[]> {
    const users = await this.database.query<UserRow>(
      `SELECT u.id, u.display_name, u.avatar, sm.role FROM server_members sm
       JOIN users u ON u.id = sm.user_id WHERE sm.server_id = $1
       ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'administrator' THEN 1 ELSE 2 END, u.display_name`,
      [DEFAULT_SERVER_ID],
    );
    return users.map((user) => ({ id: user.id, displayName: user.display_name, avatar: user.avatar, status: onlineIds.has(user.id) ? "online" : "offline", role: user.role }));
  }

  async getMember(userId: string, online: boolean): Promise<Member> {
    const [user] = await this.database.query<UserRow>(
      `SELECT u.id, u.display_name, u.avatar, sm.role FROM users u
       JOIN server_members sm ON sm.user_id = u.id AND sm.server_id = $2 WHERE u.id = $1`,
      [userId, DEFAULT_SERVER_ID],
    );
    if (!user) throw new Error("User is missing");
    return { id: user.id, displayName: user.display_name, avatar: user.avatar, status: online ? "online" : "offline", role: user.role };
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

  async getAccessibleAttachment(attachmentId: string, userId: string): Promise<(Attachment & { storageKey: string }) | null> {
    const [row] = await this.database.query<AttachmentRow>(
      `SELECT a.id, a.storage_key, a.original_name, a.mime_type, a.size_bytes, a.sha256
       FROM attachments a WHERE a.id = $1 AND a.server_id = $3
       AND (a.uploader_id = $2 OR EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id = a.id))`,
      [attachmentId, userId, DEFAULT_SERVER_ID],
    );
    return row ? { ...mapAttachment(row), storageKey: row.storage_key } : null;
  }

  async createMessage(id: string, channelId: string, authorId: string, content: string, attachmentIds: string[] = []): Promise<ChatMessage | null> {
    const rows = await this.database.query<MessageRow>(
      `WITH requested AS (
         SELECT value::uuid AS id, (position - 1)::integer AS position
         FROM unnest($5::uuid[]) WITH ORDINALITY AS input(value, position)
       ), available AS (
         SELECT r.id, r.position FROM requested r JOIN attachments a ON a.id = r.id
         WHERE a.uploader_id = $3 AND a.server_id = $6
         AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id = a.id)
       ), inserted AS (
         INSERT INTO messages (id, channel_id, author_id, content)
         SELECT $1, $2, $3, $4
         WHERE (SELECT count(*) FROM requested) = (SELECT count(*) FROM available)
         RETURNING id, channel_id, author_id, content, created_at, edited_at
       ), linked AS (
         INSERT INTO message_attachments (message_id, attachment_id, position)
         SELECT inserted.id, available.id, available.position FROM inserted CROSS JOIN available
       )
       SELECT id, channel_id, author_id, content, created_at, edited_at,
       (SELECT display_name FROM users WHERE users.id = author_id) AS author_name,
       (SELECT avatar FROM users WHERE users.id = author_id) AS author_avatar FROM inserted`,
      [id, channelId, authorId, content, attachmentIds, DEFAULT_SERVER_ID],
    );
    const row = rows[0];
    if (!row) return null;
    const attachments = await this.getAttachmentsForMessages([id]);
    return mapMessage(row, attachments.get(id) ?? []);
  }

  async getMessageAccess(messageId: string): Promise<{ authorId: string; channelId: string } | null> {
    const [row] = await this.database.query<{ author_id: string; channel_id: string }>(
      `SELECT m.author_id, m.channel_id FROM messages m
       JOIN channels c ON c.id = m.channel_id
       WHERE m.id = $1 AND c.server_id = $2`,
      [messageId, DEFAULT_SERVER_ID],
    );
    return row ? { authorId: row.author_id, channelId: row.channel_id } : null;
  }

  async updateMessage(messageId: string, authorId: string, content: string, attachmentIds: string[] = []): Promise<{ message: ChatMessage; removedStorageKeys: string[] } | null> {
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
         RETURNING m.id, m.channel_id, m.author_id, m.content, m.created_at, m.edited_at
       ), removed AS (
         DELETE FROM message_attachments ma USING updated
         WHERE ma.message_id = updated.id AND NOT EXISTS (SELECT 1 FROM requested r WHERE r.id = ma.attachment_id)
         RETURNING ma.attachment_id
       ), linked AS (
         INSERT INTO message_attachments (message_id, attachment_id, position)
         SELECT updated.id, available.id, available.position FROM updated CROSS JOIN available
         ON CONFLICT (message_id, attachment_id) DO UPDATE SET position = excluded.position
       ), removed_files AS (
         DELETE FROM attachments a USING removed WHERE a.id = removed.attachment_id RETURNING a.storage_key
       )
       SELECT updated.id, updated.channel_id, updated.author_id, updated.content, updated.created_at, updated.edited_at,
       (SELECT display_name FROM users WHERE users.id = updated.author_id) AS author_name,
       (SELECT avatar FROM users WHERE users.id = updated.author_id) AS author_avatar,
       COALESCE((SELECT array_agg(storage_key) FROM removed_files), ARRAY[]::text[]) AS removed_storage_keys
       FROM updated`,
      [messageId, authorId, content, attachmentIds, DEFAULT_SERVER_ID],
    );
    const row = rows[0];
    if (!row) return null;
    const attachments = await this.getAttachmentsForMessages([messageId]);
    return { message: mapMessage(row, attachments.get(messageId) ?? []), removedStorageKeys: row.removed_storage_keys ?? [] };
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

  async getHistory(channelId: string, limit: number): Promise<ChatMessage[]> {
    const rows = await this.database.query<MessageRow>(
      `SELECT m.id, m.channel_id, m.author_id, u.display_name AS author_name, u.avatar AS author_avatar, m.content, m.created_at, m.edited_at
       FROM messages m JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = $1 ORDER BY m.created_at DESC LIMIT $2`,
      [channelId, limit],
    );
    const ordered = rows.reverse();
    const attachments = await this.getAttachmentsForMessages(ordered.map((message) => message.id));
    return ordered.map((message) => mapMessage(message, attachments.get(message.id) ?? []));
  }

  async searchMessages(filters: MessageSearchFilters): Promise<MessageSearchResult> {
    const conditions = `c.server_id = $1
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
        )))`;
    const parameters = [DEFAULT_SERVER_ID, filters.query, filters.authorId, filters.channelId, filters.contentTypes];
    const [countRow] = await this.database.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM messages m JOIN channels c ON c.id = m.channel_id WHERE ${conditions}`,
      parameters,
    );
    const rows = await this.database.query<MessageRow>(
      `SELECT m.id, m.channel_id, m.author_id, u.display_name AS author_name, u.avatar AS author_avatar, m.content, m.created_at, m.edited_at
       FROM messages m JOIN users u ON u.id = m.author_id JOIN channels c ON c.id = m.channel_id
       WHERE ${conditions} ORDER BY m.created_at DESC, m.id DESC LIMIT $6 OFFSET $7`,
      [...parameters, filters.limit, filters.offset],
    );
    const attachments = await this.getAttachmentsForMessages(rows.map((message) => message.id));
    const total = Number(countRow?.count ?? 0);
    return {
      messages: rows.map((message) => mapMessage(message, attachments.get(message.id) ?? [])),
      total,
      offset: filters.offset,
      hasMore: filters.offset + rows.length < total,
    };
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
  if (role === "owner") return ["MANAGE_SERVER", "MANAGE_CHANNELS", "MANAGE_MESSAGES", "MANAGE_ROLES", "DELETE_SERVER", "VOICE_CONNECT", "VOICE_SPEAK", "VOICE_MODERATE"];
  if (role === "administrator") return ["MANAGE_CHANNELS", "MANAGE_MESSAGES", "VOICE_CONNECT", "VOICE_SPEAK", "VOICE_MODERATE"];
  return ["VOICE_CONNECT", "VOICE_SPEAK"];
}

function mapMessage(row: MessageRow, attachments: Attachment[] = []): ChatMessage {
  return { id: row.id, channelId: row.channel_id, authorId: row.author_id, authorName: row.author_name, authorAvatar: row.author_avatar, content: row.content, createdAt: new Date(row.created_at).toISOString(), editedAt: row.edited_at ? new Date(row.edited_at).toISOString() : null, attachments };
}

function mapAttachment(row: AttachmentRow): Attachment {
  return { id: row.id, fileName: row.original_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), sha256: row.sha256 };
}

function mapChannel(row: ChannelRow): Channel {
  return { id: row.id, name: row.name, kind: row.kind, description: row.description, participantLimit: row.kind === "voice" ? Number(row.participant_limit ?? 25) : null };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
