import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyServerSnapshot, AttachmentView, ChannelSidebar, ClientApp, Composer, deploymentPresetFromServer, LeaveServerDialog, Message, ProtocolNotice, upsertDeployedServer } from "@/components/client-app";
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
      attachments: { selectAndUpload: vi.fn(async () => null), download: vi.fn(async () => true), preview: vi.fn(async () => "data:image/png;base64,AA==") },
    };
  });

  afterEach(cleanup);

  it("shows the saved one-button server update action only to the owner", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const server = { ...readyState().servers[0]!, address: "http://127.0.0.1:3210", deployment: { host: "127.0.0.1", port: 2222, username: "root", serverName: "Тестовый сервер", mode: "native" as const, authentication: "password" as const } };
    const { rerender } = render(<LeaveServerDialog server={server} canUpdate canDeleteForAll open onOpenChange={vi.fn()} onUpdate={onUpdate} onConfirm={vi.fn()} onDeleteForAll={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Обновить сервер" }));
    expect(onUpdate).toHaveBeenCalledOnce();

    rerender(<LeaveServerDialog server={server} canUpdate={false} canDeleteForAll={false} open onOpenChange={vi.fn()} onUpdate={onUpdate} onConfirm={vi.fn()} onDeleteForAll={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Обновить сервер" })).not.toBeInTheDocument();
  });

  it("derives a safe recovery preset for an outdated legacy server", () => {
    expect(deploymentPresetFromServer({ ...readyState().servers[0]!, name: "Legacy", address: "https://chat.example.com" })).toEqual({ host: "chat.example.com", port: 22, username: "root", serverName: "Legacy", authentication: "private-key", domain: "chat.example.com" });
    expect(deploymentPresetFromServer({ ...readyState().servers[0]!, name: "WSL", address: "http://127.0.0.1:3210" })).toEqual({ host: "127.0.0.1", port: 22, username: "root", serverName: "WSL", authentication: "private-key" });
  });

  it("edits and deletes an own message from its action menu", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn(() => true);
    const onDelete = vi.fn(() => true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const message = { id: "message-1", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#7c5cff", content: "До правки", createdAt: new Date().toISOString(), editedAt: null };
    render(<Message message={message} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} onEdit={onEdit} onDelete={onDelete} onDownload={vi.fn()} onPreview={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Действия с сообщением/ }));
    await user.click(screen.getByRole("menuitem", { name: "Редактировать" }));
    const editor = screen.getByRole("textbox", { name: "Редактирование сообщения" });
    await user.clear(editor);
    await user.type(editor, "После правки{Enter}");
    expect(onEdit).toHaveBeenCalledWith(message, "После правки");

    await user.click(screen.getByRole("button", { name: /Действия с сообщением/ }));
    await user.click(screen.getByRole("menuitem", { name: "Удалить" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith(message);
  });

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

  it("shows uploaded attachments in the composer and allows removing them", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    const onRemoveAttachment = vi.fn();
    render(<Composer draft="сообщение" channelName="общий" disabled={false} uploading={false} canAttach attachments={[{ id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "план.pdf", mimeType: "application/pdf", sizeBytes: 1024, sha256: "a".repeat(64) }]} onAttach={onAttach} onRemoveAttachment={onRemoveAttachment} onDraft={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText("план.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    expect(onAttach).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Убрать план.pdf" }));
    expect(onRemoveAttachment).toHaveBeenCalledWith("12959e6f-7ea9-41d9-8be3-f412354d3e95");
  });

  it("allows submitting an attachment without message text", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<Composer draft="" channelName="общий" disabled={false} uploading={false} canAttach attachments={[{ id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "фото.png", mimeType: "image/png", sizeBytes: 1024, sha256: "a".repeat(64) }]} onAttach={vi.fn()} onRemoveAttachment={vi.fn()} onDraft={vi.fn()} onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("opens an image attachment in the media viewer", async () => {
    const user = userEvent.setup();
    let activeFullscreenElement: Element | null = null;
    const requestFullscreen = vi.fn(async () => {
      activeFullscreenElement = screen.getByRole("button", { name: "На весь экран: фото.png" }).parentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exitFullscreen = vi.fn(async () => {
      activeFullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => activeFullscreenElement });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    const attachment = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "фото.png", mimeType: "image/png", sizeBytes: 1024, sha256: "a".repeat(64) };
    render(<AttachmentView attachment={attachment} onDownload={vi.fn()} onPreview={vi.fn(async () => "data:image/png;base64,AA==")} />);

    fireEvent.click(await screen.findByRole("button", { name: "Открыть фото.png" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "На весь экран: фото.png" }));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    await user.click(await screen.findByRole("button", { name: "Выйти из полноэкранного режима: фото.png" }));
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("renders a video player and requests fullscreen", async () => {
    const user = userEvent.setup();
    const requestFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(HTMLVideoElement.prototype, "requestFullscreen", { configurable: true, value: requestFullscreen });
    const attachment = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "ролик.mp4", mimeType: "video/mp4", sizeBytes: 2048, sha256: "a".repeat(64) };
    render(<AttachmentView attachment={attachment} onDownload={vi.fn()} onPreview={vi.fn(async () => "data:video/mp4;base64,AA==")} />);

    expect(await screen.findByLabelText("Видео: ролик.mp4")).toHaveAttribute("controls");
    await user.click(screen.getByRole("button", { name: "На весь экран: ролик.mp4" }));

    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("waits for authentication before loading a cached media preview", async () => {
    const onPreview = vi.fn(async () => "data:image/png;base64,AA==");
    const attachment = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "после-входа.png", mimeType: "image/png", sizeBytes: 1024, sha256: "a".repeat(64) };
    const { rerender } = render(<AttachmentView attachment={attachment} previewAvailable={false} onDownload={vi.fn()} onPreview={onPreview} />);

    expect(onPreview).not.toHaveBeenCalled();
    rerender(<AttachmentView attachment={attachment} previewAvailable onDownload={vi.fn()} onPreview={onPreview} />);

    await waitFor(() => expect(onPreview).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "Открыть после-входа.png" })).toBeEnabled();
  });

  it("shows a persistent instruction when the server protocol is outdated", () => {
    render(<ProtocolNotice status="server-outdated" />);
    expect(screen.getByRole("alert")).toHaveTextContent("OpenCord Server необходимо обновить");
    expect(screen.getByRole("alert")).toHaveTextContent("Повторно разверните сервер");
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
