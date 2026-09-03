import { AccessToken, RoomServiceClient, TrackSource, TrackType, WebhookReceiver } from "livekit-server-sdk";
import type { VoiceCapability, VoicePresence } from "@opencord/shared";

export interface VoiceJoinRequest {
  serverId: string;
  channelId: string;
  userId: string;
  participantLimit: number;
  /** Сохранённый серверный мут: presence в памяти для этого не годится, её стирает выход из канала. */
  serverMuted: boolean;
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

/**
 * Справки о настройках сервера, которые голосовому сервису нужны в момент события:
 * вебхук и сверка узнают участника уже по факту, а держать копию настроек внутри
 * сервиса значило бы дублировать источник истины.
 */
export interface VoiceLookups {
  /** Сохранённый серверный мут участника. */
  serverMuted(userId: string): Promise<boolean>;
  /** Настройки сервера, нужные при разборе события; читаются одной выборкой. */
  server(): Promise<VoiceServerSettings>;
  /**
   * Вправе ли участник находиться в голосе прямо сейчас: состоит на сервере, не забанен,
   * имеет право входа. Проверяется по факту, потому что между выдачей токена и входом
   * в комнату участника могут исключить, забанить или лишить права.
   */
  mayBeInVoice(userId: string): Promise<boolean>;
}

export interface VoiceServerSettings {
  /** Идентификатор сервера: он входит в имя комнаты LiveKit и отделяет свои комнаты от чужих. */
  id: string;
  /** Максимальная высота кадра демонстрации экрана, заданная владельцем сервера. */
  screenShareMaxHeight: number;
}

export interface VoiceService {
  capability(): Promise<VoiceCapability>;
  issueJoin(request: VoiceJoinRequest): Promise<VoiceJoinAuthorization>;
  leave(userId: string): Promise<VoicePresence | null>;
  updateState(userId: string, state: Pick<VoicePresence, "muted" | "deafened" | "viewingScreenShareUserId">): VoicePresence | null;
  disconnect(userId: string, reason: "moderated" | "replaced" | "channel_deleted"): Promise<VoicePresence | null>;
  setModeratorMuted(userId: string, muted: boolean): Promise<VoicePresence | null>;
  /**
   * Сверяет заявленный клиентом мут с настоящим состоянием дорожки в LiveKit.
   * Возвращает исправленную presence, если клиент объявил себя заглушённым, продолжая
   * передавать звук, и `null`, если исправлять нечего.
   */
  verifySelfMute(userId: string): Promise<VoicePresence | null>;
  removeChannel(channelId: string): Promise<VoicePresence[]>;
  presence(): VoicePresence[];
  receiveWebhook(body: string, authorization: string | undefined, lookups: VoiceLookups): Promise<VoiceWebhookChange | null>;
  reconcile(channelIds: string[], lookups: VoiceLookups): Promise<VoicePresence[]>;
}

export interface LiveKitVoiceOptions {
  internalUrl: string;
  publicUrl: string;
  apiKey: string;
  apiSecret: string;
  secureTransport: boolean;
  maxParticipants: number;
}

/**
 * Отсрочка перед проверкой заявленного мута. Заглушка в LiveKit и событие
 * `voice.state.update` идут разными путями: проверять сразу — значит ловить честного
 * пользователя на ещё не доехавшей заглушке.
 */
export const VOICE_MUTE_VERIFY_DELAY_MS = 2_500;

/**
 * Сколько выданный токен занимает место в комнате, пока участник не подключился.
 * Между выдачей токена и появлением участника в LiveKit проходит заметное время, и без
 * брони следующий вход этого места не видел: лимит обходился парой одновременных входов.
 * Бронь снимается досрочно, как только участник действительно вошёл.
 */
export const VOICE_JOIN_RESERVATION_MS = 15_000;

export const LIVEKIT_PUBLISH_SOURCES = [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
export const LIVEKIT_SERVER_MUTED_PUBLISH_SOURCES = [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

export class DisabledVoiceService implements VoiceService {
  async capability(): Promise<VoiceCapability> {
    return { status: "disabled", secureTransport: false, maxParticipants: 25, warning: "Голосовой сервер не настроен" };
  }

  async issueJoin(): Promise<VoiceJoinAuthorization> { throw new VoiceUnavailableError(); }
  async leave(): Promise<VoicePresence | null> { return null; }
  updateState(): VoicePresence | null { return null; }
  async disconnect(): Promise<VoicePresence | null> { return null; }
  async setModeratorMuted(): Promise<VoicePresence | null> { return null; }
  async verifySelfMute(): Promise<VoicePresence | null> { return null; }
  async removeChannel(): Promise<VoicePresence[]> { return []; }
  presence(): VoicePresence[] { return []; }
  async receiveWebhook(): Promise<VoiceWebhookChange | null> { return null; }
  async reconcile(): Promise<VoicePresence[]> { return []; }
}

export class LiveKitVoiceService implements VoiceService {
  private readonly client: RoomServiceClient;
  private readonly receiver: WebhookReceiver;
  private readonly presences = new Map<string, VoicePresence>();
  private readonly selfMutedByUser = new Map<string, boolean>();
  private readonly roomsByChannel = new Map<string, string>();
  /** Выданные токены, ещё не превратившиеся в участника LiveKit: ключ — идентичность. */
  private readonly joinReservations = new Map<string, { room: string; expiresAt: number }>();
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
    // Занятые места считаются по трём источникам сразу, потому что участник переходит
    // между ними не мгновенно: список LiveKit отстаёт от выдачи токена, бронь снимается
    // вебхуком о входе, а presence появляется тем же вебхуком. Учитывать только список
    // означало впустить лишних, пока вошедшие в нём ещё не видны.
    //
    // Проверка и бронь ниже идут без единого `await`, поэтому в однопоточной среде они
    // неделимы: параллельный вход либо ещё не дошёл до этого места, либо уже оставил
    // здесь свою бронь и будет учтён.
    const occupants = new Set<string>();
    for (const participant of participants) if (participant.identity) occupants.add(participant.identity);
    for (const presence of this.presences.values()) if (presence.channelId === request.channelId) occupants.add(presence.userId);
    const now = Date.now();
    for (const [userId, reservation] of this.joinReservations) {
      if (reservation.expiresAt <= now) { this.joinReservations.delete(userId); continue; }
      if (reservation.room === room) occupants.add(userId);
    }
    occupants.delete(request.userId);
    if (request.participantLimit > 0 && occupants.size >= request.participantLimit) throw new VoiceRoomFullError();
    this.joinReservations.set(request.userId, { room, expiresAt: now + VOICE_JOIN_RESERVATION_MS });
    const token = new AccessToken(this.options.apiKey, this.options.apiSecret, { identity: request.userId, ttl: 300 });
    // Права берутся из сохранённого мута: `replaced` пуст после выхода из канала,
    // и опора на него позволяла снять серверный мут выходом и повторным входом.
    token.addGrant({ roomJoin: true, room, canPublish: true, canPublishSources: request.serverMuted ? LIVEKIT_SERVER_MUTED_PUBLISH_SOURCES : LIVEKIT_PUBLISH_SOURCES, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
    return { endpoint: this.options.publicUrl, token: await token.toJwt(), expiresAt: new Date(Date.now() + 300_000).toISOString(), replaced };
  }

  async leave(userId: string): Promise<VoicePresence | null> {
    const presence = this.presences.get(userId) ?? null;
    if (!presence) return null;
    await this.removeFromRoom(presence);
    return presence;
  }

  updateState(userId: string, state: Pick<VoicePresence, "muted" | "deafened" | "viewingScreenShareUserId">): VoicePresence | null {
    const current = this.presences.get(userId);
    if (!current) return null;
    this.selfMutedByUser.set(userId, state.muted);
    const viewedParticipant = state.viewingScreenShareUserId ? this.presences.get(state.viewingScreenShareUserId) : null;
    const viewingScreenShareUserId = viewedParticipant?.channelId === current.channelId ? viewedParticipant.userId : null;
    const next = { ...current, ...state, viewingScreenShareUserId, muted: state.muted || current.serverMuted };
    this.presences.set(userId, next);
    return next;
  }

  async disconnect(userId: string, reason: "moderated" | "replaced" | "channel_deleted"): Promise<VoicePresence | null> {
    void reason;
    return this.leave(userId);
  }

  async setModeratorMuted(userId: string, muted: boolean): Promise<VoicePresence | null> {
    const current = this.presences.get(userId);
    if (!current) return null;
    await this.client.updateParticipant(this.roomForChannel(current.channelId), userId, {
      permission: {
        canPublish: true,
        canPublishData: false,
        canPublishSources: muted ? LIVEKIT_SERVER_MUTED_PUBLISH_SOURCES : LIVEKIT_PUBLISH_SOURCES,
        canSubscribe: true,
        canUpdateMetadata: false,
      },
    });
    const selfMuted = this.selfMutedByUser.get(userId) ?? (current.muted && !current.serverMuted);
    const next = { ...current, serverMuted: muted, muted: muted || selfMuted };
    this.presences.set(userId, next);
    return next;
  }

  /**
   * Глушит демонстрацию экрана, кадр которой выше разрешённого владельцем сервера.
   *
   * Настройка канала — это только подсказка интерфейсу: разрешение и битрейт выбирает
   * сам клиент, и в токене LiveKit ограничить их нечем. Поэтому предел проверяется по
   * факту публикации. Сравнивается высота: именно её задаёт настройка (480/720/1080/1440),
   * и по ней же клиент масштабирует кадр, а ширина у широких мониторов законно больше.
   *
   * Частоту кадров LiveKit в описании дорожки не сообщает, поэтому она остаётся
   * подсказкой клиенту и здесь не проверяется.
   */
  private async enforceScreenShareLimit(room: string, userId: string, track: { sid: string; type: TrackType; source: TrackSource; height: number; muted: boolean }, maxHeight: number): Promise<void> {
    if (track.source !== TrackSource.SCREEN_SHARE || track.type !== TrackType.VIDEO) return;
    if (track.muted || track.height <= maxHeight || !track.sid) return;
    try {
      await this.client.mutePublishedTrack(room, userId, track.sid, true);
    } catch {
      // Дорожка могла закрыться сама, пока событие шло до сервера.
    }
  }

  async verifySelfMute(userId: string): Promise<VoicePresence | null> {
    const current = this.presences.get(userId);
    if (!current) return null;
    let room: string;
    try { room = this.roomForChannel(current.channelId); } catch { return null; }
    let participant;
    try { participant = await this.client.getParticipant(room, userId); } catch { return null; }
    const microphone = participant.tracks.find((track) => track.source === TrackSource.MICROPHONE);
    // Нет дорожки — значит звук точно не идёт.
    const actuallySilent = !microphone || microphone.muted === true;
    this.selfMutedByUser.set(userId, actuallySilent);
    // Исправляется только опасное направление: «я в муте» при работающем микрофоне.
    // Обратное расхождение безобидно и к тому же обычно означает, что заглушка ещё в пути.
    if (actuallySilent || !current.muted) return null;
    // Серверный мут держит заглушку сам и заявлением клиента не является: если он стоит,
    // исправлять нечего и рассылать нечего.
    const muted = current.serverMuted;
    if (muted === current.muted) return null;
    const next = { ...current, muted };
    this.presences.set(userId, next);
    return next;
  }

  async removeChannel(channelId: string): Promise<VoicePresence[]> {
    const affected = this.presence().filter((presence) => presence.channelId === channelId);
    if (!affected.length) return [];
    try { await this.client.deleteRoom(this.roomForChannel(channelId)); } catch { /* A room may already be empty/closed. */ }
    for (const presence of affected) {
      this.presences.delete(presence.userId);
      this.selfMutedByUser.delete(presence.userId);
    }
    const room = this.roomsByChannel.get(channelId);
    if (room) for (const [userId, reservation] of this.joinReservations) if (reservation.room === room) this.joinReservations.delete(userId);
    this.roomsByChannel.delete(channelId);
    return affected;
  }

  presence(): VoicePresence[] { return [...this.presences.values()]; }

  async receiveWebhook(body: string, authorization: string | undefined, lookups: VoiceLookups): Promise<VoiceWebhookChange | null> {
    const event = await this.receiver.receive(body, authorization);
    const userId = event.participant?.identity;
    const room = event.room?.name;
    if (!userId || !room) return null;
    const server = await lookups.server();
    const parsed = parseRoomName(room, server.id);
    if (!parsed) return null;
    this.roomsByChannel.set(parsed.channelId, room);
    if (event.event === "track_published" && event.track) {
      await this.enforceScreenShareLimit(room, userId, event.track, server.screenShareMaxHeight);
      return null;
    }
    const previous = this.presences.get(userId);
    // Вебхук о входе приходит уже после выдачи токена и создаёт presence заново,
    // поэтому серверный мут читается из хранилища, а не из стёртой выходом presence.
    const serverMuted = await lookups.serverMuted(userId);
    const presence: VoicePresence = {
      userId,
      channelId: parsed.channelId,
      muted: (previous?.muted ?? false) || serverMuted,
      deafened: previous?.deafened ?? false,
      serverMuted,
      viewingScreenShareUserId: previous?.viewingScreenShareUserId ?? null,
    };
    if (event.event === "participant_joined") {
      // Токен живёт 300 секунд, а исключить, забанить или разжаловать участника могут
      // сразу после его выдачи — в том числе пока он ещё не появился в комнате, когда
      // отзывать у него было нечего. Право находиться здесь проверяется по факту входа.
      if (!(await lookups.mayBeInVoice(userId))) {
        await this.evictFromRoom(room, userId);
        return null;
      }
      // Участник появился в LiveKit и теперь считается по списку: бронь освобождается.
      this.joinReservations.delete(userId);
      this.selfMutedByUser.set(userId, this.selfMutedByUser.get(userId) ?? (presence.muted && !presence.serverMuted));
      this.presences.set(userId, presence);
      return { joined: presence };
    }
    if (event.event === "participant_left" || event.event === "participant_connection_aborted") {
      const current = this.presences.get(userId);
      if (current?.channelId === presence.channelId) {
        this.presences.delete(userId);
        this.selfMutedByUser.delete(userId);
      }
      return { left: presence };
    }
    return null;
  }

  async reconcile(channelIds: string[], lookups: VoiceLookups): Promise<VoicePresence[]> {
    const server = await lookups.server();
    const rooms = await this.client.listRooms();
    const next = new Map<string, VoicePresence>();
    for (const room of rooms) {
      const parsed = parseRoomName(room.name, server.id);
      if (!parsed || !channelIds.includes(parsed.channelId)) continue;
      this.roomsByChannel.set(parsed.channelId, room.name);
      const participants = await this.client.listParticipants(room.name);
      for (const participant of participants) {
        if (!participant.identity) continue;
        if (!(await lookups.mayBeInVoice(participant.identity))) {
          await this.evictFromRoom(room.name, participant.identity);
          continue;
        }
        const previous = this.presences.get(participant.identity);
        const microphone = participant.tracks.find((track) => track.source === TrackSource.MICROPHONE);
        // Раньше мут выводился из прав публикации в LiveKit; теперь у него есть
        // собственное хранилище, и сверка приводит presence именно к нему.
        const serverMuted = await lookups.serverMuted(participant.identity);
        for (const track of participant.tracks) await this.enforceScreenShareLimit(room.name, participant.identity, track, server.screenShareMaxHeight);
        // Истина — состояние дорожки в LiveKit. Раньше запомненное заявление клиента
        // перекрывало его, и объявленный, но ненастоящий мут держался бесконечно.
        // Заявление остаётся запасным вариантом, только пока дорожки ещё нет.
        const selfMuted = microphone ? microphone.muted === true : this.selfMutedByUser.get(participant.identity) ?? previous?.muted ?? false;
        this.selfMutedByUser.set(participant.identity, selfMuted);
        next.set(participant.identity, {
          userId: participant.identity,
          channelId: parsed.channelId,
          muted: serverMuted || selfMuted,
          deafened: previous?.deafened ?? false,
          serverMuted,
          viewingScreenShareUserId: previous?.viewingScreenShareUserId ?? null,
        });
      }
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

  /**
   * Убирает из комнаты того, кому там быть не положено. Токен отзывается по времени
   * удаления, иначе оставшийся у него на руках токен пустил бы обратно.
   */
  private async evictFromRoom(room: string, userId: string): Promise<void> {
    this.joinReservations.delete(userId);
    this.presences.delete(userId);
    this.selfMutedByUser.delete(userId);
    try { await this.client.removeParticipant(room, userId, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) }); } catch { /* Участник мог уже отключиться сам. */ }
  }

  private async removeFromRoom(presence: VoicePresence): Promise<void> {
    this.joinReservations.delete(presence.userId);
    try { await this.client.removeParticipant(this.roomForChannel(presence.channelId), presence.userId, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) }); } catch { /* The participant may have already left. */ }
    this.presences.delete(presence.userId);
    this.selfMutedByUser.delete(presence.userId);
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

/**
 * Разбирает имя комнаты, принадлежащей именно этому серверу.
 *
 * Идентификатор сервера раньше сопоставлялся как «что угодно» и отбрасывался, поэтому
 * при общем LiveKit на несколько развёрнутых OpenCord комната чужого сервера с таким же
 * `channelId` считалась своей, а её участники попадали в presence как свои.
 */
function parseRoomName(value: string, serverId: string): { channelId: string } | null {
  const prefix = `oc_${serverId}_`.toLowerCase();
  const lowered = value.toLowerCase();
  if (!lowered.startsWith(prefix)) return null;
  const channelId = lowered.slice(prefix.length);
  return /^[0-9a-f-]{36}$/u.test(channelId) ? { channelId } : null;
}
