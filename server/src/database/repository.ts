import type { Channel, ChatMessage, Member, PublicProfile } from "@opencord/shared";
import type { Database, QueryRow } from "./database";
import { DEFAULT_SERVER_ID } from "./migrations";

interface ServerRow extends QueryRow { id: string; name: string }
interface ChannelRow extends QueryRow { id: string; name: string; kind: "text" | "voice"; description: string }
interface UserRow extends QueryRow { id: string; display_name: string; avatar: string | null }
interface MessageRow extends QueryRow { id: string; channel_id: string; author_id: string; author_name: string; author_avatar: string | null; content: string; created_at: Date | string }

export class ChatRepository {
  constructor(private readonly database: Database) {}

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

  async upsertUser(userId: string, publicKey: string, profile: PublicProfile): Promise<void> {
    await this.database.query(
      `INSERT INTO users (id, public_key, display_name, avatar) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, avatar = EXCLUDED.avatar, updated_at = now()
       WHERE users.public_key = EXCLUDED.public_key`,
      [userId, publicKey, profile.displayName, profile.avatar],
    );
  }

  async listMembers(onlineIds: ReadonlySet<string>): Promise<Member[]> {
    const users = await this.database.query<UserRow>("SELECT id, display_name, avatar FROM users ORDER BY display_name");
    return users.map((user) => ({ id: user.id, displayName: user.display_name, avatar: user.avatar, status: onlineIds.has(user.id) ? "online" : "offline" }));
  }

  async getMember(userId: string, online: boolean): Promise<Member> {
    const [user] = await this.database.query<UserRow>("SELECT id, display_name, avatar FROM users WHERE id = $1", [userId]);
    if (!user) throw new Error("User is missing");
    return { id: user.id, displayName: user.display_name, avatar: user.avatar, status: online ? "online" : "offline" };
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

function mapMessage(row: MessageRow): ChatMessage {
  return { id: row.id, channelId: row.channel_id, authorId: row.author_id, authorName: row.author_name, authorAvatar: row.author_avatar, content: row.content, createdAt: new Date(row.created_at).toISOString() };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
