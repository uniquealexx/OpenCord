import { act, renderHook } from "@testing-library/react";
import { PROTOCOL_VERSION } from "@opencord/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatTypingIndicator } from "@/components/client-app";
import { useServerConnection } from "@/hooks/use-server-connection";
import { dictionaries } from "@/lib/i18n";
import type { LocalProfile, MockServer } from "@/shared/state";

describe("formatTypingIndicator", () => {
  it("returns null without typists", () => {
    expect(formatTypingIndicator(dictionaries.en.chat, [])).toBeNull();
  });

  it("lists up to three names in English", () => {
    expect(formatTypingIndicator(dictionaries.en.chat, ["Lina"])).toBe("Lina is typing…");
    expect(formatTypingIndicator(dictionaries.en.chat, ["Lina", "Mark"])).toBe("Lina and Mark are typing…");
    expect(formatTypingIndicator(dictionaries.en.chat, ["Lina", "Mark", "Ivy"])).toBe("Lina, Mark and Ivy are typing…");
  });

  it("falls back to a count beyond three names", () => {
    expect(formatTypingIndicator(dictionaries.en.chat, ["Lina", "Mark", "Ivy", "Sam"])).toBe("4 people are typing…");
  });

  it("keeps Russian and Chinese parity", () => {
    expect(formatTypingIndicator(dictionaries.ru.chat, ["Лина"])).toBe("Лина печатает…");
    expect(formatTypingIndicator(dictionaries.ru.chat, ["Лина", "Марк"])).toBe("Лина и Марк печатают…");
    expect(formatTypingIndicator(dictionaries.ru.chat, ["Лина", "Марк", "Иви", "Сэм", "Ким"])).toBe("5 человек печатают…");
    expect(formatTypingIndicator(dictionaries.zh.chat, ["丽娜"])).toBe("丽娜 正在输入…");
    expect(formatTypingIndicator(dictionaries.zh.chat, ["丽娜", "马克", "艾薇", "山姆"])).toBe("4 人正在输入…");
  });
});

const profile: LocalProfile = {
  id: "local-user",
  username: "lina",
  discriminator: "1234",
  bio: "",
  avatar: null,
  banner: null,
  memberBackground: null,
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

describe("typing over useServerConnection", () => {
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

  it("sends typing.start/stop and dispatches typing.updated", async () => {
    vi.useFakeTimers();
    const callbacks = { onSnapshot: vi.fn(), onServerAvatarUpdated: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMessageUpdated: vi.fn(), onMessageDeleted: vi.fn(), onMember: vi.fn(), onMemberRemoved: vi.fn(), onServerDeleted: vi.fn(), onTyping: vi.fn(), onError: vi.fn() };
    const { result, unmount } = renderHook(() => useServerConnection(server, profile, callbacks));
    const socket = FakeWebSocket.instances[0];
    const channelId = "12959e6f-7ea9-41d9-8be3-f412354d3e95";

    // До подключения ничего не отправляется.
    expect(result.current.sendTypingStart(channelId)).toBe(false);
    expect(result.current.sendTypingStop(channelId)).toBe(false);

    await act(async () => {
      socket?.receive({ type: "auth.challenge", requestId: "12515573-1ff0-4b9a-9bcf-2ad3fa14323d", protocolVersion: PROTOCOL_VERSION, challenge: "challenge", expiresAt: "2026-07-22T12:00:00.000Z" });
      await Promise.resolve();
    });
    act(() => socket?.receive({ type: "auth.ok", requestId: "12515573-1ff0-4b9a-9bcf-2ad3fa14323d", userId: "user-id", serverId: "5a07aa54-16ef-46ec-a193-9d72a624c253", sessionToken: "A".repeat(43), sessionExpiresAt: "2026-07-22T13:00:00.000Z" }));
    expect(result.current.status).toBe("connected");

    expect(result.current.sendTypingStart(channelId)).toBe(true);
    expect(JSON.parse(socket?.sent.at(-1) ?? "{}") as unknown).toMatchObject({ type: "typing.start", channelId });
    expect(result.current.sendTypingStop(channelId)).toBe(true);
    expect(JSON.parse(socket?.sent.at(-1) ?? "{}") as unknown).toMatchObject({ type: "typing.stop", channelId });

    act(() => socket?.receive({ type: "typing.updated", channelId, userId: "other-user", typing: true }));
    expect(callbacks.onTyping).toHaveBeenCalledWith(channelId, "other-user", true);
    act(() => socket?.receive({ type: "typing.updated", channelId, userId: "other-user", typing: false }));
    expect(callbacks.onTyping).toHaveBeenCalledWith(channelId, "other-user", false);

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
