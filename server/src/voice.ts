import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from "livekit-server-sdk";
import type { VoiceCapability, VoicePresence } from "@opencord/shared";

export interface VoiceJoinRequest {
  serverId: string;
  channelId: string;
  userId: string;
  participantLimit: number;
}

export interface VoiceJoinAuthorization {
  endpoint: string;
  token: string;
  expiresAt: string;
  replaced: VoicePresence | null;
}

export interface VoiceWebhookChange {
  joined?: VoicePresence;
  left?: VoicePresence;
}

export interface VoiceService {
  capability(): Promise<VoiceCapability>;
  issueJoin(request: VoiceJoinRequest): Promise<VoiceJoinAuthorization>;
  leave(userId: string): Promise<VoicePresence | null>;
  disconnect(userId: string, reason: "moderated" | "replaced" | "channel_deleted"): Promise<VoicePresence | null>;
  removeChannel(channelId: string): Promise<VoicePresence[]>;
  presence(): VoicePresence[];
  receiveWebhook(body: string, authorization: string | undefined): Promise<VoiceWebhookChange | null>;
  reconcile(channelIds: string[]): Promise<VoicePresence[]>;
}

export interface LiveKitVoiceOptions {
  internalUrl: string;
  publicUrl: string;
  apiKey: string;
  apiSecret: string;
  secureTransport: boolean;
  maxParticipants: number;
}

export class DisabledVoiceService implements VoiceService {
  async capability(): Promise<VoiceCapability> {
    return { status: "disabled", secureTransport: false, maxParticipants: 25, warning: "Голосовой сервер не настроен" };
  }

  async issueJoin(): Promise<VoiceJoinAuthorization> { throw new VoiceUnavailableError(); }
  async leave(): Promise<VoicePresence | null> { return null; }
  async disconnect(): Promise<VoicePresence | null> { return null; }
  async removeChannel(): Promise<VoicePresence[]> { return []; }
  presence(): VoicePresence[] { return []; }
  async receiveWebhook(): Promise<VoiceWebhookChange | null> { return null; }
  async reconcile(): Promise<VoicePresence[]> { return []; }
}

export class LiveKitVoiceService implements VoiceService {
  private readonly client: RoomServiceClient;
  private readonly receiver: WebhookReceiver;
  private readonly presences = new Map<string, VoicePresence>();
  private readonly roomsByChannel = new Map<string, string>();
  private healthy = false;

  constructor(private readonly options: LiveKitVoiceOptions) {
    this.client = new RoomServiceClient(options.internalUrl, options.apiKey, options.apiSecret);
    this.receiver = new WebhookReceiver(options.apiKey, options.apiSecret);
  }

  async capability(): Promise<VoiceCapability> {
    try {
      await this.probe();
      this.healthy = true;
    } catch {
      this.healthy = false;
    }
    return this.healthy
      ? { status: "available", secureTransport: this.options.secureTransport, maxParticipants: this.options.maxParticipants, warning: this.options.secureTransport ? null : "Голос работает без TLS: соединение и токены могут быть перехвачены" }
      : { status: "degraded", secureTransport: this.options.secureTransport, maxParticipants: this.options.maxParticipants, warning: "LiveKit недоступен. Текстовый чат продолжает работать" };
  }

  async issueJoin(request: VoiceJoinRequest): Promise<VoiceJoinAuthorization> {
    if (!(await this.isHealthy())) throw new VoiceUnavailableError();
    const replaced = this.presences.get(request.userId) ?? null;
    if (replaced && replaced.channelId !== request.channelId) await this.removeFromRoom(replaced);
    const room = roomName(request.serverId, request.channelId);
    this.roomsByChannel.set(request.channelId, room);
    try {
      // Room capacity is enforced by OpenCord so it can be changed while a room
      // exists. LiveKit's zero value keeps the underlying room unrestricted.
      await this.client.createRoom({ name: room, maxParticipants: 0, emptyTimeout: 60, departureTimeout: 30 });
    } catch {
      // The room is commonly created concurrently by the first two participants.
      // LiveKit's token join remains safe when it already exists.
    }
    const participants = await this.client.listParticipants(room);
    if (request.participantLimit > 0 && participants.filter((participant) => participant.identity !== request.userId).length >= request.participantLimit) throw new VoiceRoomFullError();
    const token = new AccessToken(this.options.apiKey, this.options.apiSecret, { identity: request.userId, ttl: 300 });
    token.addGrant({ roomJoin: true, room, canPublish: true, canPublishSources: [TrackSource.MICROPHONE], canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
    return { endpoint: this.options.publicUrl, token: await token.toJwt(), expiresAt: new Date(Date.now() + 300_000).toISOString(), replaced };
  }

  async leave(userId: string): Promise<VoicePresence | null> {
    const presence = this.presences.get(userId) ?? null;
    if (!presence) return null;
    await this.removeFromRoom(presence);
    return presence;
  }

  async disconnect(userId: string, reason: "moderated" | "replaced" | "channel_deleted"): Promise<VoicePresence | null> {
    void reason;
    return this.leave(userId);
  }

  async removeChannel(channelId: string): Promise<VoicePresence[]> {
    const affected = this.presence().filter((presence) => presence.channelId === channelId);
    if (!affected.length) return [];
    try { await this.client.deleteRoom(this.roomForChannel(channelId)); } catch { /* A room may already be empty/closed. */ }
    for (const presence of affected) this.presences.delete(presence.userId);
    this.roomsByChannel.delete(channelId);
    return affected;
  }

  presence(): VoicePresence[] { return [...this.presences.values()]; }

  async receiveWebhook(body: string, authorization: string | undefined): Promise<VoiceWebhookChange | null> {
    const event = await this.receiver.receive(body, authorization);
    const userId = event.participant?.identity;
    const room = event.room?.name;
    if (!userId || !room) return null;
    const parsed = parseRoomName(room);
    if (!parsed) return null;
    this.roomsByChannel.set(parsed.channelId, room);
    const presence: VoicePresence = { userId, channelId: parsed.channelId };
    if (event.event === "participant_joined") {
      this.presences.set(userId, presence);
      return { joined: presence };
    }
    if (event.event === "participant_left" || event.event === "participant_connection_aborted") {
      const current = this.presences.get(userId);
      if (current?.channelId === presence.channelId) this.presences.delete(userId);
      return { left: presence };
    }
    return null;
  }

  async reconcile(channelIds: string[]): Promise<VoicePresence[]> {
    const rooms = await this.client.listRooms();
    const next = new Map<string, VoicePresence>();
    for (const room of rooms) {
      const parsed = parseRoomName(room.name);
      if (!parsed || !channelIds.includes(parsed.channelId)) continue;
      this.roomsByChannel.set(parsed.channelId, room.name);
      const participants = await this.client.listParticipants(room.name);
      for (const participant of participants) if (participant.identity) next.set(participant.identity, { userId: participant.identity, channelId: parsed.channelId });
    }
    this.presences.clear();
    for (const presence of next.values()) this.presences.set(presence.userId, presence);
    this.healthy = true;
    return this.presence();
  }

  private async isHealthy(): Promise<boolean> {
    try { await this.probe(); this.healthy = true; return true; } catch { this.healthy = false; return false; }
  }

  private async probe(): Promise<void> {
    await Promise.race([
      this.client.listRooms().then(() => undefined),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("LiveKit probe timed out")), 2_000)),
    ]);
  }

  private async removeFromRoom(presence: VoicePresence): Promise<void> {
    try { await this.client.removeParticipant(this.roomForChannel(presence.channelId), presence.userId, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) }); } catch { /* The participant may have already left. */ }
    this.presences.delete(presence.userId);
  }

  private roomForChannel(channelId: string): string {
    const room = this.roomsByChannel.get(channelId);
    if (!room) throw new Error("Voice room is unknown");
    return room;
  }
}

export class VoiceUnavailableError extends Error {
  constructor() { super("Голосовой сервер недоступен"); }
}

export class VoiceRoomFullError extends Error {
  constructor() { super("Голосовой канал заполнен"); }
}

// Room names contain only stable identifiers; user-facing channel names never reach LiveKit.
export function roomName(serverId: string, channelId: string): string { return `oc_${serverId}_${channelId}`; }

function parseRoomName(value: string): { channelId: string } | null {
  const match = /^oc_[0-9a-f-]+_([0-9a-f-]{36})$/iu.exec(value);
  return match ? { channelId: match[1]!.toLowerCase() } : null;
}
