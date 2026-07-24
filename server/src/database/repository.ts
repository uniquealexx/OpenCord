import type { Channel, ChatMessage, Member, MemberRole, Permission, PublicProfile } from "@opencord/shared";
import type { Database, QueryRow } from "./database";
import { DEFAULT_SERVER_ID } from "./migrations";

interface ServerRow extends QueryRow { id: string; name: string }
interface ChannelRow extends QueryRow { id: string; name: string; kind: "text" | "voice"; description: string }
interface UserRow extends QueryRow { id: string; display_name: string; avatar: string | null; role: MemberRole }
interface MessageRow extends QueryRow { id: string; channel_id: string; author_id: string; author_name: string; author_avatar: string | null; content: string; created_at: Date | string }

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

  async getServer(): Promise<{ id: string; name: string; channels: Channel[] }> {
    const [server] = await this.database.query<ServerRow>("SELECT id, name FROM servers WHERE id = $1", [DEFAULT_SERVER_ID]);
    if (!server) throw new Error("Default server is missing");
    const channels = await this.database.query<ChannelRow>("SELECT id, name, kind, description FROM channels WHERE server_id = $1 ORDER BY position, name", [server.id]);
    return { id: server.id, name: server.name, channels };
  }

  async channelExists(channelId: string): Promise<boolean> {
    const rows = await this.database.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1 AND kind = 'text') AS exists", [channelId]);
    return rows[0]?.exists === true;
  }

  async createChannel(id: string, name: string, kind: Channel["kind"], description: string): Promise<Channel> {
    const rows = await this.database.query<ChannelRow>(
      `INSERT INTO channels (id, server_id, name, kind, description, position)
       VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT MAX(position) + 1 FROM channels WHERE server_id = $2), 0))
       RETURNING id, name, kind, description`,
      [id, DEFAULT_SERVER_ID, name, kind, description],
    );
    return required(rows[0], "Created channel is missing");
  }

  async updateChannel(channelId: string, name: string, description: string): Promise<Channel | null> {
    const rows = await this.database.query<ChannelRow>(
      `UPDATE channels SET name = $3, description = $4
       WHERE id = $1 AND server_id = $2
       RETURNING id, name, kind, description`,
      [channelId, DEFAULT_SERVER_ID, name, description],
    );
    return rows[0] ?? null;
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

  async createMessage(id: string, channelId: string, authorId: string, content: string): Promise<ChatMessage> {
    const rows = await this.database.query<MessageRow>(
      `INSERT INTO messages (id, channel_id, author_id, content) VALUES ($1, $2, $3, $4)
       RETURNING id, channel_id, author_id, content, created_at,
       (SELECT display_name FROM users WHERE id = author_id) AS author_name,
       (SELECT avatar FROM users WHERE id = author_id) AS author_avatar`,
      [id, channelId, authorId, content],
    );
    return mapMessage(required(rows[0], "Created message is missing"));
  }

  async getHistory(channelId: string, limit: number): Promise<ChatMessage[]> {
    const rows = await this.database.query<MessageRow>(
      `SELECT m.id, m.channel_id, m.author_id, u.display_name AS author_name, u.avatar AS author_avatar, m.content, m.created_at
       FROM messages m JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = $1 ORDER BY m.created_at DESC LIMIT $2`,
      [channelId, limit],
    );
    return rows.reverse().map(mapMessage);
  }
}

export function permissionsForRole(role: MemberRole): Permission[] {
  if (role === "owner") return ["MANAGE_CHANNELS", "MANAGE_ROLES", "DELETE_SERVER"];
  if (role === "administrator") return ["MANAGE_CHANNELS"];
  return [];
}

function mapMessage(row: MessageRow): ChatMessage {
  return { id: row.id, channelId: row.channel_id, authorId: row.author_id, authorName: row.author_name, authorAvatar: row.author_avatar, content: row.content, createdAt: new Date(row.created_at).toISOString() };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
