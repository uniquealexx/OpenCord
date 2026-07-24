import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyServerSnapshot, ChannelSidebar, ClientApp, upsertDeployedServer } from "@/components/client-app";
import { createDefaultState, type PersistedClientState } from "@/shared/state";

function readyState(): PersistedClientState {
  const state: PersistedClientState = {
    ...createDefaultState(),
    onboardingComplete: true,
    profile: { id: "local-user", displayName: "Лина", bio: "", avatar: null, createdAt: new Date().toISOString() },
  };
  state.servers = [{
    id: "test-server",
    name: "Тестовый сервер",
    address: null,
    accent: "#7c5cff",
    channels: [
      { id: "welcome", serverId: "test-server", name: "добро-пожаловать", kind: "text", description: "Начните знакомство" },
      { id: "general", serverId: "test-server", name: "общий", kind: "text", description: "Разговоры обо всём" },
      { id: "voice", serverId: "test-server", name: "Гостиная", kind: "voice", description: "Голосовой канал" },
    ],
    members: [],
  }];
  state.messages = [{ id: "welcome-message", channelId: "welcome", authorId: "member", authorName: "Мира", authorColor: "#7c5cff", content: "Тестовое сообщение", createdAt: new Date().toISOString() }];
  state.activeServerId = "test-server";
  state.activeChannelId = "welcome";
  return state;
}

describe("ClientApp", () => {
  const save = vi.fn(async (state: PersistedClientState) => state);

  beforeEach(() => {
    save.mockClear();
    window.openCord = {
      window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(() => () => undefined) },
      storage: { load: vi.fn(async () => readyState()), save, reset: vi.fn(async () => createDefaultState()) },
      identity: { getOrCreate: vi.fn(async () => ({ publicKey: "test-public-key", fingerprint: "test" })), signChallenge: vi.fn(async () => "test-signature"), reset: vi.fn(async () => ({ publicKey: "new-test-public-key", fingerprint: "new-test" })) },
      deployment: { selectPrivateKey: vi.fn(async () => null), releasePrivateKey: vi.fn(), inspectHost: vi.fn(), inspectEnvironment: vi.fn(), start: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => () => undefined) },
    };
  });

  afterEach(cleanup);

  it("switches channels and sends a local message", async () => {
    const user = userEvent.setup();
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");
    await user.click(screen.getByRole("button", { name: /общий/i }));
    const composer = screen.getByLabelText(/написать в #общий/i);
    await user.type(composer, "Привет, OpenCord!");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Привет, OpenCord!")).toBeInTheDocument();
    expect(save).toHaveBeenCalled();
  });

  it("shows an empty-server state instead of a fake channel when no text channels exist", async () => {
    const state = readyState();
    state.servers[0]!.channels = [];
    state.messages = [];
    state.activeChannelId = null;
    vi.mocked(window.openCord!.storage.load).mockResolvedValue(state);
    render(<ClientApp />);
    expect(await screen.findByRole("heading", { name: "На сервере нет текстовых каналов" })).toBeInTheDocument();
    expect(screen.getByText("Нет выбранного канала")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Написать в/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Добро пожаловать в #канал")).not.toBeInTheDocument();
  });

  it("leaves a server, removes its local messages and selects the next server", async () => {
    const user = userEvent.setup();
    const state = readyState();
    state.servers.push({
      id: "next-server",
      name: "Следующий сервер",
      address: null,
      accent: "#36c5f0",
      channels: [{ id: "next-general", serverId: "next-server", name: "общий", kind: "text", description: "Следующий канал" }],
      members: [],
    });
    vi.mocked(window.openCord!.storage.load).mockResolvedValue(state);

    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");
    await user.click(screen.getByRole("button", { name: "Управление сервером: Тестовый сервер" }));
    expect(await screen.findByRole("heading", { name: "Выйти с сервера?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Выйти с сервера" }));

    expect(await screen.findByText("Следующий сервер")).toBeInTheDocument();
    const saved = save.mock.calls.at(-1)?.[0];
    expect(saved?.servers.map((server) => server.id)).toEqual(["next-server"]);
    expect(saved?.activeServerId).toBe("next-server");
    expect(saved?.activeChannelId).toBe("next-general");
    expect(saved?.messages).toHaveLength(0);
  });

  it("uses the shared server name when a server snapshot arrives", () => {
    const state = readyState();
    state.servers[0]!.name = "Мой сервер в WSL";
    const next = applyServerSnapshot(state, {
      id: "7b2f5502-d465-41c2-b794-ef4031e2217a",
      name: "OpenCord Server",
      channels: [{ id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", name: "общий", kind: "text", description: "Основной канал" }],
      members: [{ id: "server-admin", displayName: "Анна", avatar: null, status: "online", role: "administrator" }],
      currentUser: { id: "local-user", role: "owner", permissions: ["MANAGE_CHANNELS", "MANAGE_ROLES", "DELETE_SERVER"] },
    });

    expect(next.servers[0]?.name).toBe("OpenCord Server");
    expect(next.servers[0]?.channels[0]?.serverId).toBe("test-server");
    expect(next.servers[0]?.members[0]).toMatchObject({
      displayName: "Анна",
      role: "Администратор",
      serverRole: "administrator",
    });
  });

  it("removes cached messages when a server snapshot deletes a channel", () => {
    const state = readyState();
    const removedId = state.servers[0]!.channels[0]!.id;
    expect(state.messages.some((message) => message.channelId === removedId)).toBe(true);
    const next = applyServerSnapshot(state, {
      id: "7b2f5502-d465-41c2-b794-ef4031e2217a",
      name: "OpenCord Server",
      channels: state.servers[0]!.channels.slice(1).map((channel) => ({ id: channel.id, name: channel.name, kind: channel.kind, description: channel.description })),
      members: [],
      currentUser: { id: "local-user", role: "owner", permissions: ["MANAGE_CHANNELS", "MANAGE_ROLES", "DELETE_SERVER"] },
    });
    expect(next.messages.some((message) => message.channelId === removedId)).toBe(false);
    expect(next.activeChannelId).not.toBe(removedId);
  });

  it("opens channel management actions with the right mouse button", async () => {
    const user = userEvent.setup();
    const state = readyState();
    const channel = state.servers[0]!.channels[0]!;
    const onEditChannel = vi.fn();
    const onDeleteChannel = vi.fn();
    render(<ChannelSidebar server={state.servers[0]!} activeChannelId={channel.id} profile={state.profile!} canManageChannels onCreateChannel={vi.fn()} onEditChannel={onEditChannel} onDeleteChannel={onDeleteChannel} onSelectChannel={vi.fn()} onServerMenu={vi.fn()} onProfile={vi.fn()} onSettings={vi.fn()} onVoiceNotice={vi.fn()} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: channel.name }), { clientX: 120, clientY: 100 });
    expect(screen.getByRole("menu", { name: `Управление каналом ${channel.name}` })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Редактировать канал" }));
    expect(onEditChannel).toHaveBeenCalledWith(channel);

    fireEvent.contextMenu(screen.getByRole("button", { name: channel.name }), { clientX: 120, clientY: 100 });
    await user.click(screen.getByRole("menuitem", { name: "Удалить канал" }));
    expect(onDeleteChannel).toHaveBeenCalledWith(channel);
  });

  it("opens the home screen and starts the connect flow", async () => {
    const user = userEvent.setup();
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    await user.click(screen.getByRole("button", { name: "Личное пространство" }));
    expect(await screen.findByRole("heading", { name: "Главный экран" })).toBeInTheDocument();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ activeServerId: null, activeChannelId: null }));

    await user.click(screen.getByRole("button", { name: "Подключиться к серверу" }));
    expect(await screen.findByRole("heading", { name: "Подключиться к серверу" })).toBeInTheDocument();
  });

  it("replaces every local duplicate when the same endpoint is redeployed", () => {
    const state = readyState();
    const first = { ...state.servers[0]!, id: "first", address: "http://127.0.0.1:3210/", name: "Старый" };
    const duplicate = { ...state.servers[0]!, id: "duplicate", address: "http://127.0.0.1:3210", name: "Дубликат" };
    state.servers = [first, duplicate];
    state.activeServerId = duplicate.id;
    const next = upsertDeployedServer(state, "http://127.0.0.1:3210", "Общий сервер");
    expect(next.servers).toHaveLength(1);
    expect(next.servers[0]).toMatchObject({ id: "first", name: "Общий сервер", address: "http://127.0.0.1:3210" });
    expect(next.activeServerId).toBe("first");
  });
});
