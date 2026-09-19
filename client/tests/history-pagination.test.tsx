import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { PROTOCOL_VERSION } from "@opencord/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApp } from "@/components/client-app";
import { createDefaultState, type PersistedClientState } from "@/shared/state";

const AUTH_UUID = "11111111-1111-4111-8111-111111111111";
const SERVER_UUID = "5a07aa54-16ef-46ec-a193-9d72a624c253";
const CHANNEL_ID = "12959e6f-7ea9-41d9-8be3-f412354d3e95";

/** Веб-сокет без сети: вручную управляем входящими и читаем отправленные события. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  readonly listeners: Record<string, ((event: { data?: string }) => void)[]> = {};
  readonly sent: string[] = [];
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(): void {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
  receive(value: unknown): void {
    for (const handler of this.listeners.message ?? []) handler({ data: JSON.stringify(value) });
  }
}

function readyState(): PersistedClientState {
  const state: PersistedClientState = {
    ...createDefaultState(),
    onboardingComplete: true,
    profile: { id: "local-user", username: "lina", discriminator: "1234", bio: "", avatar: null, banner: null, memberBackground: null, createdAt: new Date().toISOString() },
  };
  state.servers = [{
    id: "test-server",
    name: "Тестовый сервер",
    address: "http://127.0.0.1:3210",
    accent: "#7c5cff",
    maxAttachmentBytes: 10 * 1024 * 1024,
    channels: [{ id: CHANNEL_ID, serverId: "test-server", name: "общий", kind: "text", description: "", participantLimit: null, slowmodeSeconds: 0 }],
    members: [],
  }];
  state.activeServerId = "test-server";
  state.activeChannelId = CHANNEL_ID;
  state.messages = [];
  return state;
}

function sharedMessage(id: string, content: string, createdAt: string): { id: string; channelId: string; authorId: string; authorName: string; authorAvatar: null; content: string; createdAt: string } {
  return { id, channelId: CHANNEL_ID, authorId: "member-1", authorName: "Мира", authorAvatar: null, content, createdAt };
}

describe("history pagination (client)", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    window.openCord = {
      window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(() => () => undefined) },
      storage: { load: vi.fn(async () => readyState()), save: vi.fn(async (state: PersistedClientState) => state), reset: vi.fn(async () => createDefaultState()) },
      identity: { getOrCreate: vi.fn(async () => ({ publicKey: "p".repeat(64), fingerprint: "test", discriminator: "1234" })), signChallenge: vi.fn(async () => "s".repeat(64)), reset: vi.fn() },
      deployment: { selectServerBundle: vi.fn(async () => null), selectPrivateKey: vi.fn(async () => null), releasePrivateKey: vi.fn(), inspectHost: vi.fn(), inspectEnvironment: vi.fn(), start: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => () => undefined) },
      attachments: { selectAndUpload: vi.fn(async () => null), uploadFile: vi.fn(async (_context: unknown, file: File) => ({ id: "att-1", fileName: file.name, mimeType: "text/plain", sizeBytes: 4, sha256: "a".repeat(64) })), download: vi.fn(async () => true), preview: vi.fn(async () => "data:image/png;base64,AA=="), setLatencySensitive: vi.fn(async () => undefined) },
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** Доводит клиент до сетевого соединения и отдаёт сокет для ручной подачи событий. */
  async function renderConnected(): Promise<FakeWebSocket> {
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error("WebSocket was not created");
    act(() => socket.receive({ type: "auth.challenge", requestId: AUTH_UUID, protocolVersion: PROTOCOL_VERSION, challenge: "challenge", expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    await act(async () => { await Promise.resolve(); });
    act(() => socket.receive({ type: "auth.ok", requestId: AUTH_UUID, userId: "local-user", serverId: SERVER_UUID, sessionToken: "t".repeat(50), sessionExpiresAt: new Date(Date.now() + 60_000).toISOString() }));
    act(() => socket.receive({
      type: "server.snapshot",
      server: {
        id: SERVER_UUID,
        name: "Тестовый сервер",
        avatar: null,
        banner: null,
        maxAttachmentBytes: null,
        screenShareMaxResolution: 1080,
        screenShareMaxFrameRate: 60,
        channels: [{ id: CHANNEL_ID, name: "общий", kind: "text", description: "", participantLimit: null, slowmodeSeconds: 0 }],
        members: [],
        currentUser: { id: "local-user", role: "owner", permissions: [] },
      },
    }));
    return socket;
  }

  function sentHistoryRequests(socket: FakeWebSocket): { requestId: string; channelId: string; limit: number; before: string | null }[] {
    return socket.sent
      .map((event) => JSON.parse(event) as { type: string; requestId?: string; channelId?: string; limit?: number; before?: string | null })
      .filter((event) => event.type === "history.request")
      .map((event) => ({ requestId: event.requestId!, channelId: event.channelId!, limit: event.limit!, before: event.before ?? null }));
  }

  it("prepends older pages, dedupes them and stops once the channel is exhausted", async () => {
    const socket = await renderConnected();
    const container = screen.getByTestId("message-scroll");
    // Высокая лента: автодогрузка «короткой» страницы не срабатывает.
    Object.defineProperty(container, "scrollHeight", { value: 1_000, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 500, configurable: true });

    const oldest = { id: "018f0000-0000-4000-8000-0000000000a1", content: "Самое старое", createdAt: "2026-01-01T10:00:00.000Z" };
    const middle = { id: "018f0000-0000-4000-8000-0000000000b2", content: "Среднее", createdAt: "2026-01-01T10:01:00.000Z" };
    const newest = { id: "018f0000-0000-4000-8000-0000000000c3", content: "Новейшее", createdAt: "2026-01-01T10:02:00.000Z" };

    // Снапшотный запрос пришёл с before: null; отвечаем новейшей страницей.
    const snapshotRequest = sentHistoryRequests(socket).at(-1)!;
    expect(snapshotRequest.before).toBeNull();
    act(() => socket.receive({ type: "history.result", requestId: snapshotRequest.requestId, channelId: CHANNEL_ID, messages: [sharedMessage(middle.id, middle.content, middle.createdAt), sharedMessage(newest.id, newest.content, newest.createdAt)], hasMore: true }));
    expect(await screen.findByText("Новейшее")).toBeInTheDocument();

    // Прокрутка к верхней кромке запрашивает страницу старше самого старого сообщения.
    act(() => {
      container.scrollTop = 0;
      container.dispatchEvent(new Event("scroll"));
    });
    const olderRequest = sentHistoryRequests(socket).at(-1)!;
    expect(olderRequest.requestId).not.toBe(snapshotRequest.requestId);
    expect(olderRequest).toMatchObject({ channelId: CHANNEL_ID, limit: 50, before: middle.id });

    // Пока страница в пути, виден индикатор загрузки.
    expect(screen.getByText("Загружаем более ранние сообщения…")).toBeInTheDocument();

    // Ответ содержит дубль (middle) и новое старое сообщение: дубль не удваивается.
    act(() => socket.receive({ type: "history.result", requestId: olderRequest.requestId, channelId: CHANNEL_ID, messages: [sharedMessage(oldest.id, oldest.content, oldest.createdAt), sharedMessage(middle.id, middle.content, middle.createdAt)], hasMore: false }));
    expect(screen.queryByText("Загружаем более ранние сообщения…")).not.toBeInTheDocument();
    expect(screen.getAllByText("Среднее")).toHaveLength(1);
    expect(screen.getByText("Самое старое")).toBeInTheDocument();

    // Хронологический порядок отображения: старое выше среднего, среднее выше нового.
    const order = Array.from(container.querySelectorAll('[id^="message-"]')).map((element) => element.id);
    expect(order).toEqual([`message-${oldest.id}`, `message-${middle.id}`, `message-${newest.id}`]);

    // hasMore=false помечает историю исчерпанной: повторная прокрутка ничего не шлёт.
    const requestCount = sentHistoryRequests(socket).length;
    act(() => {
      container.scrollTop = 0;
      container.dispatchEvent(new Event("scroll"));
    });
    expect(sentHistoryRequests(socket)).toHaveLength(requestCount);
  });

  it("fills a first page shorter than the viewport without waiting for a scroll", async () => {
    const socket = await renderConnected();
    const container = screen.getByTestId("message-scroll");
    // Лента не прокручивается: окно выше стопки первой страницы.
    Object.defineProperty(container, "scrollHeight", { value: 200, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });

    const only = { id: "018f0000-0000-4000-8000-0000000000d4", content: "Единственное", createdAt: "2026-01-01T10:00:00.000Z" };
    const snapshotRequest = sentHistoryRequests(socket).at(-1)!;
    await act(async () => socket.receive({ type: "history.result", requestId: snapshotRequest.requestId, channelId: CHANNEL_ID, messages: [sharedMessage(only.id, only.content, only.createdAt)], hasMore: true }));
    await waitFor(() => expect(sentHistoryRequests(socket).length).toBeGreaterThan(1));
    expect(sentHistoryRequests(socket).at(-1)?.before).toBe(only.id);
  });
});
