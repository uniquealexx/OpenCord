import { act, renderHook } from "@testing-library/react";
import { PROTOCOL_VERSION } from "@opencord/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { protocolCompatibility, reconnectDelay, useServerConnection, websocketEndpoint } from "@/hooks/use-server-connection";
import type { LocalProfile, MockServer } from "@/shared/state";

const profile: LocalProfile = {
  id: "local-user",
  username: "lina",
  discriminator: "1234",
  bio: "Описание Лины",
  avatar: null,
  banner: "data:image/webp;base64,AQ==",
  createdAt: "2026-07-22T00:00:00.000Z",
};

const server: MockServer = {
  id: "local-server",
  name: "Local server",
  address: "http://127.0.0.1:3210",
  accent: "#36c5f0",
  maxAttachmentBytes: 10 * 1024 * 1024,
  channels: [],
  members: [],
};

describe("server connection", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    window.openCord = {
      window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(() => () => undefined) },
      storage: { load: vi.fn(), save: vi.fn(), reset: vi.fn() },
      identity: {
        getOrCreate: vi.fn(async () => ({ publicKey: "p".repeat(64), fingerprint: "test", discriminator: "1234" })),
        signChallenge: vi.fn(async () => "s".repeat(64)),
        reset: vi.fn(),
      },
      deployment: { selectServerBundle: vi.fn(async () => null), selectPrivateKey: vi.fn(async () => null), releasePrivateKey: vi.fn(), inspectHost: vi.fn(), inspectEnvironment: vi.fn(), start: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => () => undefined) },
      attachments: { selectAndUpload: vi.fn(async () => null), uploadFile: vi.fn(async () => { throw new Error("uploadFile не ожидается в этом тесте"); }), download: vi.fn(async () => true), preview: vi.fn(async () => "data:image/png;base64,AA=="), setLatencySensitive: vi.fn(async () => undefined) },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("normalizes HTTP addresses to the WebSocket endpoint", () => {
    expect(websocketEndpoint("http://127.0.0.1:3210/anything?ignored=yes")).toBe("ws://127.0.0.1:3210/ws");
    expect(websocketEndpoint("https://chat.example.test")).toBe("wss://chat.example.test/ws");
    expect(() => websocketEndpoint("https://user:secret@chat.example.test")).toThrow();
  });

  it("caps exponential reconnect delays", () => {
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
  });

  it("detects whether the server or client protocol is outdated", () => {
    expect(protocolCompatibility({ type: "auth.challenge", protocolVersion: PROTOCOL_VERSION - 1 })).toBe("server-outdated");
    expect(protocolCompatibility({ type: "auth.challenge", protocolVersion: PROTOCOL_VERSION + 1 })).toBe("client-outdated");
    expect(protocolCompatibility({ type: "auth.challenge", protocolVersion: PROTOCOL_VERSION })).toBeNull();
  });

  it("automatically reconnects and refreshes data after an outdated server is updated", async () => {
    vi.useFakeTimers();
    const callbacks = { onSnapshot: vi.fn(), onServerAvatarUpdated: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMessageUpdated: vi.fn(), onMessageDeleted: vi.fn(), onSearchResult: vi.fn(), onMember: vi.fn(), onMemberRemoved: vi.fn(), onServerDeleted: vi.fn(), onVoicePresence: vi.fn(), onVoiceDisconnected: vi.fn(), onError: vi.fn() };
    const { result, unmount } = renderHook(() => useServerConnection(server, profile, callbacks));
    const socket = FakeWebSocket.instances[0];
    act(() => socket?.receive({ type: "auth.challenge", requestId: crypto.randomUUID(), protocolVersion: PROTOCOL_VERSION - 1, challenge: "old", expiresAt: new Date().toISOString() }));
    expect(result.current.status).toBe("server-outdated");
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("reconnect automatically"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(FakeWebSocket.instances).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(FakeWebSocket.instances).toHaveLength(2);
    // Повторная попытка идёт «молча»: статус не мигает в «reconnecting», остаётся «server-outdated».
    expect(result.current.status).toBe("server-outdated");
    const refreshed = FakeWebSocket.instances[1];
    const requestId = crypto.randomUUID();
    await act(async () => {
      refreshed?.receive({ type: "auth.challenge", requestId, protocolVersion: PROTOCOL_VERSION, challenge: "updated", expiresAt: new Date().toISOString() });
      await Promise.resolve();
    });
    act(() => {
      refreshed?.receive({ type: "auth.ok", requestId, userId: "local-user", serverId: "5a07aa54-16ef-46ec-a193-9d72a624c253", sessionToken: "A".repeat(43), sessionExpiresAt: new Date(Date.now() + 60_000).toISOString() });
      refreshed?.receive({ type: "server.snapshot", server: { id: "5a07aa54-16ef-46ec-a193-9d72a624c253", name: "Обновлённый сервер", avatar: null, maxAttachmentBytes: null, screenShareMaxResolution: 1440, screenShareMaxFrameRate: 60, channels: [], members: [], currentUser: { id: "local-user", role: "owner", permissions: [] } } });
    });
    expect(result.current.status).toBe("connected");
    expect(callbacks.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ name: "Обновлённый сервер", screenShareMaxResolution: 1440 }));
    unmount();
  });

  it("keeps the outdated status stable while retrying every two seconds", async () => {
    vi.useFakeTimers();
    const callbacks = { onSnapshot: vi.fn(), onServerAvatarUpdated: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMessageUpdated: vi.fn(), onMessageDeleted: vi.fn(), onSearchResult: vi.fn(), onMember: vi.fn(), onMemberRemoved: vi.fn(), onServerDeleted: vi.fn(), onVoicePresence: vi.fn(), onVoiceDisconnected: vi.fn(), onError: vi.fn() };
    const { result, unmount } = renderHook(() => useServerConnection(server, profile, callbacks));
    act(() => FakeWebSocket.instances[0]?.receive({ type: "auth.challenge", requestId: crypto.randomUUID(), protocolVersion: PROTOCOL_VERSION - 1, challenge: "old", expiresAt: new Date().toISOString() }));
    expect(result.current.status).toBe("server-outdated");

    // Несколько циклов: каждые 2 секунды новый сокет, но статус не покидает «server-outdated».
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      const latest = FakeWebSocket.instances.at(-1);
      expect(FakeWebSocket.instances).toHaveLength(2 + cycle);
      expect(result.current.status).toBe("server-outdated");
      act(() => latest?.receive({ type: "auth.challenge", requestId: crypto.randomUUID(), protocolVersion: PROTOCOL_VERSION - 1, challenge: "still-old", expiresAt: new Date().toISOString() }));
      expect(result.current.status).toBe("server-outdated");
    }
    unmount();
  });

  it("reports a ban with its deadline and stops reconnecting", async () => {
    vi.useFakeTimers();
    const callbacks = { onSnapshot: vi.fn(), onServerAvatarUpdated: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMessageUpdated: vi.fn(), onMessageDeleted: vi.fn(), onSearchResult: vi.fn(), onMember: vi.fn(), onMemberRemoved: vi.fn(), onServerDeleted: vi.fn(), onVoicePresence: vi.fn(), onVoiceDisconnected: vi.fn(), onError: vi.fn() };
    const { result, unmount } = renderHook(() => useServerConnection(server, profile, callbacks));
    const expiresAt = "2026-09-01T10:00:00.000Z";
    act(() => FakeWebSocket.instances[0]?.receive({ type: "error", requestId: null, code: "BANNED", message: "Ваша идентичность заблокирована на этом сервере", banExpiresAt: expiresAt }));

    expect(result.current.status).toBe("banned");
    expect(result.current.banExpiresAt).toBe(expiresAt);
    // Блокировку показывает постоянный экран, поэтому исчезающий тост не поднимается.
    expect(callbacks.onError).not.toHaveBeenCalled();

    // Бан фатален: закрытие сокета не запускает переподключение и не сбрасывает статус в «ошибку».
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.status).toBe("banned");
    unmount();
  });

  it("treats a permanent ban as an unknown deadline", () => {
    const callbacks = { onSnapshot: vi.fn(), onServerAvatarUpdated: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMessageUpdated: vi.fn(), onMessageDeleted: vi.fn(), onSearchResult: vi.fn(), onMember: vi.fn(), onMemberRemoved: vi.fn(), onServerDeleted: vi.fn(), onVoicePresence: vi.fn(), onVoiceDisconnected: vi.fn(), onError: vi.fn() };
    const { result, unmount } = renderHook(() => useServerConnection(server, profile, callbacks));
    act(() => FakeWebSocket.instances[0]?.receive({ type: "error", requestId: null, code: "BANNED", message: "Заблокировано", banExpiresAt: null }));
    expect(result.current.status).toBe("banned");
    expect(result.current.banExpiresAt).toBeNull();
    unmount();
  });

  it("authenticates and reconnects after the socket closes", async () => {
    vi.useFakeTimers();
    const callbacks = { onSnapshot: vi.fn(), onServerAvatarUpdated: vi.fn(), onServerBannerUpdated: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMessageUpdated: vi.fn(), onMessageDeleted: vi.fn(), onSearchResult: vi.fn(), onMember: vi.fn(), onMemberRemoved: vi.fn(), onProfileAnonymized: vi.fn(), onServerDeleted: vi.fn(), onVoicePresence: vi.fn(), onVoiceDisconnected: vi.fn(), onError: vi.fn() };
    const { result, unmount } = renderHook(() => useServerConnection(server, profile, callbacks));
    const first = FakeWebSocket.instances[0];
    expect(first?.url).toBe("ws://127.0.0.1:3210/ws");

    await act(async () => {
      first?.receive({
        type: "auth.challenge",
        requestId: "12515573-1ff0-4b9a-9bcf-2ad3fa14323d",
        protocolVersion: PROTOCOL_VERSION,
        challenge: "challenge",
        expiresAt: "2026-07-22T12:00:00.000Z",
      });
      await Promise.resolve();
    });
    expect(first?.sent).toHaveLength(1);
    expect(JSON.parse(first!.sent[0]!) as unknown).toMatchObject({ type: "auth.respond", profile: { username: "lina", discriminator: "1234", bio: "Описание Лины", banner: "data:image/webp;base64,AQ==" } });

    act(() => first?.receive({
      type: "auth.ok",
      requestId: "12515573-1ff0-4b9a-9bcf-2ad3fa14323d",
      userId: "user-id",
      serverId: "5a07aa54-16ef-46ec-a193-9d72a624c253",
      sessionToken: "A".repeat(43),
      sessionExpiresAt: "2026-07-22T13:00:00.000Z",
    }));
    expect(result.current.status).toBe("connected");
    expect(result.current.sessionToken).toBe("A".repeat(43));

    const channelId = "12959e6f-7ea9-41d9-8be3-f412354d3e95";
    let searchRequestId: string | null = null;
    act(() => {
      expect(result.current.updateChannel(channelId, "анонсы", "Важные новости", null, 0)).toBe(true);
      expect(result.current.deleteChannel(channelId)).toBe(true);
      expect(result.current.updateMessage(channelId, "Исправлено", [channelId], ["user-1"])).toBe(true);
      expect(result.current.deleteMessage(channelId)).toBe(true);
      expect(result.current.updateProfile({ username: "lina", discriminator: "1234", bio: "Описание профиля", avatar: "data:image/webp;base64,AA==", banner: "data:image/webp;base64,AQ==", status: "dnd", nameFont: "none" })).toBe(true);
      expect(result.current.leaveServer()).toBe(true);
      expect(result.current.updateServerAvatar("data:image/png;base64,AA==")).toBe(true);
      expect(result.current.updateServerBanner("data:image/webp;base64,AQ==")).toBe(true);
      expect(result.current.updateServerSettings({ name: "Новая команда", maxAttachmentBytes: null, screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 })).toBe(true);
      expect(result.current.updateVoiceState(true, false, "screen-owner")).toBe(true);
      expect(result.current.disconnectVoiceMember("voice-member")).toBe(true);
      expect(result.current.setVoiceMemberMuted("voice-member", true)).toBe(true);
      expect(result.current.kickMember("server-member")).toBe(true);
      expect(result.current.banMember("banned-member", 30)).toBe(true);
      expect(result.current.unbanMember("unbanned-member")).toBe(true);
      searchRequestId = result.current.searchMessages({ query: "важное", authorId: null, channelId: null, contentTypes: ["text"], offset: 0, limit: 25 });
    });
    const sentEvents = first?.sent.map((event) => JSON.parse(event) as { type: string; attachmentIds?: string[]; mentions?: string[]; name?: string; userId?: string; durationMinutes?: number | null; muted?: boolean; viewingScreenShareUserId?: string | null; profile?: { status?: string; bio?: string; banner?: string | null }; screenShareMaxResolution?: number; screenShareMaxFrameRate?: number }) ?? [];
    expect(sentEvents.some((event) => event.type === "channel.update")).toBe(true);
    expect(sentEvents.some((event) => event.type === "channel.delete")).toBe(true);
    expect(sentEvents.some((event) => event.type === "message.update")).toBe(true);
    expect(sentEvents.find((event) => event.type === "message.update")?.attachmentIds).toEqual([channelId]);
    expect(sentEvents.find((event) => event.type === "message.update")?.mentions).toEqual(["user-1"]);
    expect(sentEvents.some((event) => event.type === "message.delete")).toBe(true);
    expect(sentEvents.find((event) => event.type === "profile.update")?.profile).toMatchObject({ status: "dnd", bio: "Описание профиля", banner: "data:image/webp;base64,AQ==" });
    expect(sentEvents.some((event) => event.type === "server.leave")).toBe(true);
    expect(sentEvents.some((event) => event.type === "server.avatar.update")).toBe(true);
    expect(sentEvents.some((event) => event.type === "server.banner.update")).toBe(true);
    expect(sentEvents.find((event) => event.type === "server.settings.update")).toMatchObject({ name: "Новая команда", screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 });
    expect(sentEvents.find((event) => event.type === "voice.state.update")?.viewingScreenShareUserId).toBe("screen-owner");
    expect(sentEvents.find((event) => event.type === "voice.member.disconnect")?.userId).toBe("voice-member");
    expect(sentEvents.find((event) => event.type === "voice.member.mute")).toMatchObject({ userId: "voice-member", muted: true });
    expect(sentEvents.find((event) => event.type === "member.kick")?.userId).toBe("server-member");
    expect(sentEvents.find((event) => event.type === "member.ban")?.userId).toBe("banned-member");
    expect(sentEvents.find((event) => event.type === "member.ban")?.durationMinutes).toBe(30);
    expect(sentEvents.find((event) => event.type === "member.unban")?.userId).toBe("unbanned-member");
    expect(sentEvents.some((event) => event.type === "message.search")).toBe(true);

    const searchResult = { messages: [], total: 0, offset: 0, hasMore: false };
    act(() => first?.receive({ type: "message.search.result", requestId: searchRequestId, result: searchResult }));
    expect(callbacks.onSearchResult).toHaveBeenCalledWith(searchRequestId, searchResult);

    act(() => first?.receive({ type: "server.avatar.updated", serverId: "5a07aa54-16ef-46ec-a193-9d72a624c253", avatar: "data:image/webp;base64,AA==" }));
    expect(callbacks.onServerAvatarUpdated).toHaveBeenCalledWith("5a07aa54-16ef-46ec-a193-9d72a624c253", "data:image/webp;base64,AA==");

    act(() => first?.receive({ type: "server.banner.updated", serverId: "5a07aa54-16ef-46ec-a193-9d72a624c253", banner: "data:image/webp;base64,AQ==" }));
    expect(callbacks.onServerBannerUpdated).toHaveBeenCalledWith("5a07aa54-16ef-46ec-a193-9d72a624c253", "data:image/webp;base64,AQ==");

    const voiceParticipant = { userId: "voice-member", channelId, muted: true, deafened: false, serverMuted: true, viewingScreenShareUserId: "screen-owner" };
    act(() => first?.receive({ type: "voice.participant.updated", participant: voiceParticipant }));
    expect(callbacks.onVoicePresence).toHaveBeenCalledWith(voiceParticipant, true);
    act(() => first?.receive({ type: "voice.participant.disconnected", userId: "voice-member", channelId, reason: "moderated" }));
    expect(callbacks.onVoiceDisconnected).toHaveBeenCalledWith("voice-member", channelId, "moderated");

    const message = { id: channelId, channelId, authorId: "user-id", authorName: "Лина", authorAvatar: null, content: "Исправлено", createdAt: "2026-07-22T12:00:00.000Z", editedAt: "2026-07-22T12:01:00.000Z", attachments: [], mentions: [], reactions: [], kind: "chat" as const, targetUserId: null, anonymous: false, replyToMessageId: null };
    act(() => {
      first?.receive({ type: "message.updated", message });
      first?.receive({ type: "message.deleted", messageId: channelId, channelId });
      first?.receive({ type: "member.removed", userId: "removed-user" });
      first?.receive({ type: "profile.anonymized", userId: "expired-profile" });
    });
    expect(callbacks.onMessageUpdated).toHaveBeenCalledWith(message);
    expect(callbacks.onMessageDeleted).toHaveBeenCalledWith(channelId, channelId);
    expect(callbacks.onMemberRemoved).toHaveBeenCalledWith("removed-user");
    expect(callbacks.onProfileAnonymized).toHaveBeenCalledWith("expired-profile");

    act(() => first?.disconnect());
    expect(result.current.status).toBe("reconnecting");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.status).toBe("reconnecting");
    unmount();
  });

  it("stops reconnecting when the server is deleted", async () => {
    vi.useFakeTimers();
    const callbacks = { onSnapshot: vi.fn(), onServerAvatarUpdated: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMessageUpdated: vi.fn(), onMessageDeleted: vi.fn(), onMember: vi.fn(), onMemberRemoved: vi.fn(), onServerDeleted: vi.fn(), onError: vi.fn() };
    const { unmount } = renderHook(() => useServerConnection(server, profile, callbacks));
    const socket = FakeWebSocket.instances[0];
    act(() => socket?.receive({ type: "server.deleted", serverId: "5a07aa54-16ef-46ec-a193-9d72a624c253" }));
    expect(callbacks.onServerDeleted).toHaveBeenCalledWith("5a07aa54-16ef-46ec-a193-9d72a624c253");
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(FakeWebSocket.instances).toHaveLength(1);
    unmount();
  });

  it("toggles a message reaction and applies the server-side reactions update", async () => {
    vi.useFakeTimers();
    const callbacks = { onSnapshot: vi.fn(), onServerAvatarUpdated: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMessageUpdated: vi.fn(), onMessageDeleted: vi.fn(), onMessageReactionsUpdated: vi.fn(), onMember: vi.fn(), onMemberRemoved: vi.fn(), onServerDeleted: vi.fn(), onVoicePresence: vi.fn(), onVoiceDisconnected: vi.fn(), onError: vi.fn() };
    const { result, unmount } = renderHook(() => useServerConnection(server, profile, callbacks));
    const socket = FakeWebSocket.instances[0];
    const messageId = "12959e6f-7ea9-41d9-8be3-f412354d3e95";

    // До подключения тоггл не отправляется.
    expect(result.current.toggleReaction(messageId, "👍")).toBe(false);

    await act(async () => {
      socket?.receive({ type: "auth.challenge", requestId: "12515573-1ff0-4b9a-9bcf-2ad3fa14323d", protocolVersion: PROTOCOL_VERSION, challenge: "challenge", expiresAt: "2026-07-22T12:00:00.000Z" });
      await Promise.resolve();
    });
    act(() => socket?.receive({ type: "auth.ok", requestId: "12515573-1ff0-4b9a-9bcf-2ad3fa14323d", userId: "user-id", serverId: "5a07aa54-16ef-46ec-a193-9d72a624c253", sessionToken: "A".repeat(43), sessionExpiresAt: "2026-07-22T13:00:00.000Z" }));
    expect(result.current.status).toBe("connected");

    expect(result.current.toggleReaction(messageId, "👍")).toBe(true);
    expect(JSON.parse(socket?.sent.at(-1) ?? "{}") as unknown).toMatchObject({ type: "message.react", messageId, emoji: "👍" });

    const reactions = [{ emoji: "👍", userIds: ["user-id"] }];
    act(() => socket?.receive({ type: "message.reactions.updated", messageId, channelId: messageId, reactions }));
    expect(callbacks.onMessageReactionsUpdated).toHaveBeenCalledWith(messageId, messageId, reactions);

    act(() => socket?.disconnect());
    unmount();
  });
});

type Listener = (event: MessageEvent<string> | Event) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", new Event("close"));
  }

  receive(value: unknown): void {
    this.emit("message", new MessageEvent("message", { data: JSON.stringify(value) }));
  }

  disconnect(): void {
    this.close();
  }

  private emit(type: string, event: MessageEvent<string> | Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
