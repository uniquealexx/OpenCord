import { act, renderHook } from "@testing-library/react";
import { PROTOCOL_VERSION } from "@opencord/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconnectDelay, useServerConnection, websocketEndpoint } from "@/hooks/use-server-connection";
import type { LocalProfile, MockServer } from "@/shared/state";

const profile: LocalProfile = {
  id: "local-user",
  displayName: "Лина",
  bio: "",
  avatar: null,
  createdAt: "2026-07-22T00:00:00.000Z",
};

const server: MockServer = {
  id: "local-server",
  name: "Local server",
  address: "http://127.0.0.1:3210",
  accent: "#36c5f0",
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
        getOrCreate: vi.fn(async () => ({ publicKey: "p".repeat(64), fingerprint: "test" })),
        signChallenge: vi.fn(async () => "s".repeat(64)),
        reset: vi.fn(),
      },
      deployment: { selectPrivateKey: vi.fn(async () => null), releasePrivateKey: vi.fn(), inspectHost: vi.fn(), inspectEnvironment: vi.fn(), start: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => () => undefined) },
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

  it("authenticates and reconnects after the socket closes", async () => {
    vi.useFakeTimers();
    const callbacks = { onSnapshot: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMember: vi.fn(), onServerDeleted: vi.fn(), onError: vi.fn() };
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

    act(() => first?.receive({
      type: "auth.ok",
      requestId: "12515573-1ff0-4b9a-9bcf-2ad3fa14323d",
      userId: "user-id",
      serverId: "5a07aa54-16ef-46ec-a193-9d72a624c253",
    }));
    expect(result.current.status).toBe("connected");

    const channelId = "12959e6f-7ea9-41d9-8be3-f412354d3e95";
    act(() => {
      expect(result.current.updateChannel(channelId, "анонсы", "Важные новости")).toBe(true);
      expect(result.current.deleteChannel(channelId)).toBe(true);
    });
    const sentEvents = first?.sent.map((event) => JSON.parse(event) as { type: string }) ?? [];
    expect(sentEvents.some((event) => event.type === "channel.update")).toBe(true);
    expect(sentEvents.some((event) => event.type === "channel.delete")).toBe(true);

    act(() => first?.disconnect());
    expect(result.current.status).toBe("reconnecting");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.status).toBe("reconnecting");
    unmount();
  });

  it("stops reconnecting when the server is deleted", async () => {
    vi.useFakeTimers();
    const callbacks = { onSnapshot: vi.fn(), onHistory: vi.fn(), onMessage: vi.fn(), onMember: vi.fn(), onServerDeleted: vi.fn(), onError: vi.fn() };
    const { unmount } = renderHook(() => useServerConnection(server, profile, callbacks));
    const socket = FakeWebSocket.instances[0];
    act(() => socket?.receive({ type: "server.deleted", serverId: "5a07aa54-16ef-46ec-a193-9d72a624c253" }));
    expect(callbacks.onServerDeleted).toHaveBeenCalledWith("5a07aa54-16ef-46ec-a193-9d72a624c253");
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(FakeWebSocket.instances).toHaveLength(1);
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
