import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApp } from "@/components/client-app";
import { createDefaultState, type PersistedClientState } from "@/shared/state";

type Listener = (event: MessageEvent<string> | Event) => void;

function bannedState(): PersistedClientState {
  const state: PersistedClientState = {
    ...createDefaultState(),
    onboardingComplete: true,
    profile: { id: "local-user", username: "lina", discriminator: "1234", bio: "", avatar: null, banner: null, createdAt: new Date().toISOString() },
  };
  state.servers = [
    {
      id: "banned-server",
      name: "Закрытый сервер",
      address: "http://127.0.0.1:3210",
      accent: "#4d6bfe",
      maxAttachmentBytes: 10 * 1024 * 1024,
      channels: [{ id: "general", serverId: "banned-server", name: "общий", kind: "text", description: "", participantLimit: null, slowmodeSeconds: 0 }],
      members: [],
    },
  ];
  state.activeServerId = "banned-server";
  state.activeChannelId = "general";
  return state;
}

describe("banned screen", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    window.openCord = {
      storage: { load: vi.fn(async () => bannedState()), save: vi.fn(async () => undefined), reset: vi.fn(async () => createDefaultState()) },
      identity: {
        getOrCreate: vi.fn(async () => ({ publicKey: "p".repeat(64), fingerprint: "test", discriminator: "1234" })),
        signChallenge: vi.fn(async () => "s".repeat(64)),
        reset: vi.fn(),
      },
      attachments: { selectAndUpload: vi.fn(async () => null), uploadFile: vi.fn(async () => { throw new Error("uploadFile не ожидается в этом тесте"); }), download: vi.fn(async () => true), preview: vi.fn(async () => "data:image/png;base64,AA=="), setLatencySensitive: vi.fn(async () => undefined) },
    } as unknown as NonNullable<typeof window.openCord>;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function renderBanned(banExpiresAt: string | null): Promise<void> {
    render(<ClientApp />);
    await screen.findByText("Закрытый сервер");
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    act(() => FakeWebSocket.instances[0]?.receive({ type: "error", requestId: null, code: "BANNED", message: "Ваша идентичность заблокирована на этом сервере", banExpiresAt }));
  }

  it("replaces the empty server view with the ban reason and its deadline", async () => {
    const expiresAt = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    await renderBanned(expiresAt);

    expect(await screen.findByText("Вы заблокированы на этом сервере")).toBeInTheDocument();
    expect(screen.getByText(/Блокировка снимется автоматически/u)).toBeInTheDocument();
    expect(screen.getByText("Осталось около 3 ч.")).toBeInTheDocument();
    // Каналы и поле ввода недоступны — вместо пустого сервера показан экран блокировки.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("общий")).not.toBeInTheDocument();
  });

  it("marks a permanent ban as liftable only by an administrator", async () => {
    await renderBanned(null);

    expect(await screen.findByText("Вы заблокированы на этом сервере")).toBeInTheDocument();
    expect(screen.getByText("Блокировка перманентная — снять её может только администратор.")).toBeInTheDocument();
    expect(screen.queryByText(/Блокировка снимется автоматически/u)).not.toBeInTheDocument();
  });
});

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
    for (const listener of this.listeners.get("close") ?? []) listener(new Event("close"));
  }

  receive(value: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}
