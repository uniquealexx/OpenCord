import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROTOCOL_VERSION } from "@opencord/shared";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyServerSnapshot, AttachmentView, ChannelSlowmodeDialog, canDisconnectVoiceParticipant, formatMuteRemaining, canKickServerMember, ChannelSidebar, ClientApp, Composer, deploymentPresetFromServer, EditChannelDialog, focusMessage, LeaveServerDialog, Message, privateMessageStackPosition, ProtocolNotice, shouldRequestVoiceJoin, sortMessagesChronologically, upsertDeployedServer, VoiceChannelView, VoiceParticipantRow } from "@/components/client-app";
import type { ScreenShareStream } from "@/hooks/use-voice-session";
import type { MentionCandidate } from "@/lib/mentions";
import { createDefaultState, type MockMessage, type PersistedClientState } from "@/shared/state";
import { ServerAvatarDialog } from "@/components/server-avatar-dialog";

function readyState(): PersistedClientState {
  const state: PersistedClientState = {
    ...createDefaultState(),
    onboardingComplete: true,
    profile: { id: "local-user", username: "lina", discriminator: "1234", bio: "", avatar: null, banner: null, createdAt: new Date().toISOString() },
  };
  state.servers = [{
    id: "test-server",
    name: "Тестовый сервер",
    address: null,
    accent: "#7c5cff",
    maxAttachmentBytes: 10 * 1024 * 1024,
    channels: [
      { id: "welcome", serverId: "test-server", name: "добро-пожаловать", kind: "text", description: "Начните знакомство", participantLimit: null, slowmodeSeconds: 0 },
      { id: "general", serverId: "test-server", name: "общий", kind: "text", description: "Разговоры обо всём", participantLimit: null, slowmodeSeconds: 0 },
      { id: "voice", serverId: "test-server", name: "Гостиная", kind: "voice", description: "Голосовой канал", participantLimit: 25, slowmodeSeconds: 0 },
    ],
    members: [],
  }];
  state.messages = [{ id: "welcome-message", channelId: "welcome", authorId: "member", authorName: "Мира", authorColor: "#7c5cff", content: "Тестовое сообщение", createdAt: new Date().toISOString() }];
  state.activeServerId = "test-server";
  state.activeChannelId = "welcome";
  return state;
}

/** Веб-сокет, который никогда не открывается: тесты не выходят в сеть. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  readonly listeners: Record<string, ((event: { data?: string }) => void)[]> = {};
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(): void {}
  send(): void {}
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    for (const handler of this.listeners.close ?? []) handler({});
  }
}

describe("ClientApp", () => {
  const save = vi.fn(async (state: PersistedClientState) => state);

  beforeEach(() => {
    save.mockClear();
    window.openCord = {
      window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(() => () => undefined) },
      storage: { load: vi.fn(async () => readyState()), save, reset: vi.fn(async () => createDefaultState()) },
      identity: { getOrCreate: vi.fn(async () => ({ publicKey: "test-public-key-test-public-key-test-public-key", fingerprint: "test", discriminator: "1234" })), signChallenge: vi.fn(async () => "s".repeat(64)), reset: vi.fn(async () => ({ publicKey: "new-test-public-key", fingerprint: "new-test", discriminator: "5678" })) },
      deployment: { selectServerBundle: vi.fn(async () => null), selectPrivateKey: vi.fn(async () => null), releasePrivateKey: vi.fn(), inspectHost: vi.fn(), inspectEnvironment: vi.fn(), start: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => () => undefined) },
      attachments: { selectAndUpload: vi.fn(async () => null), uploadFile: vi.fn(async (_context: unknown, file: File) => ({ id: "att-1", fileName: file.name, mimeType: "text/plain", sizeBytes: 4, sha256: "a".repeat(64) })), download: vi.fn(async () => true), preview: vi.fn(async () => "data:image/png;base64,AA=="), setLatencySensitive: vi.fn(async () => undefined) },
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.colorTheme;
    delete document.documentElement.dataset.appearance;
    delete document.documentElement.dataset.darkShade;
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("does not request another voice join when opening the current room", () => {
    expect(shouldRequestVoiceJoin("connected", "voice", "voice", "voice")).toBe(false);
    expect(shouldRequestVoiceJoin("connecting", null, "voice", "voice")).toBe(false);
    expect(shouldRequestVoiceJoin("reconnecting", "voice", "voice", "voice")).toBe(false);
    expect(shouldRequestVoiceJoin("connected", "voice", "voice", "another-voice")).toBe(true);
    expect(shouldRequestVoiceJoin("error", null, "voice", "voice")).toBe(true);
  });

  it("applies the saved color theme to the document root", async () => {
    const state = readyState();
    state.preferences.colorTheme = "forest";
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await waitFor(() => expect(document.documentElement.dataset.colorTheme).toBe("forest"));
  });

  it("applies an explicit light appearance and the dark shade to the document root", async () => {
    const state = readyState();
    state.preferences.themeMode = "light";
    state.preferences.darkShade = "abyss";
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await waitFor(() => expect(document.documentElement.dataset.appearance).toBe("light"));
    expect(document.documentElement.dataset.darkShade).toBe("abyss");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("follows the OS theme in system mode and reacts to its changes", async () => {
    let changeHandler: ((event: { matches: boolean }) => void) | null = null;
    const matchMedia = vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn((_type: string, handler: (event: { matches: boolean }) => void) => {
        changeHandler = handler;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
    try {
      window.openCord!.storage.load = vi.fn(async () => readyState());
      render(<ClientApp />);
      await waitFor(() => expect(document.documentElement.dataset.appearance).toBe("light"));

      act(() => {
        changeHandler?.({ matches: true });
      });
      await waitFor(() => expect(document.documentElement.dataset.appearance).toBe("dark"));
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    } finally {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("enforces the voice moderation role hierarchy in the client", () => {
    expect(canDisconnectVoiceParticipant(true, "owner", "administrator", "owner", "admin")).toBe(true);
    expect(canDisconnectVoiceParticipant(true, "administrator", "member", "admin", "member")).toBe(true);
    expect(canDisconnectVoiceParticipant(true, "administrator", "administrator", "admin", "other-admin")).toBe(false);
    expect(canDisconnectVoiceParticipant(true, "owner", "owner", "owner", "other-owner")).toBe(false);
    expect(canDisconnectVoiceParticipant(true, "owner", "member", "owner", "owner")).toBe(false);
    expect(canDisconnectVoiceParticipant(false, "owner", "member", "owner", "member")).toBe(false);
  });

  it("enforces the server kick role hierarchy in the client", () => {
    expect(canKickServerMember(true, "owner", "administrator", "owner", "admin")).toBe(true);
    expect(canKickServerMember(true, "administrator", "member", "admin", "member")).toBe(true);
    expect(canKickServerMember(true, "administrator", "administrator", "admin", "other-admin")).toBe(false);
    expect(canKickServerMember(true, "owner", "owner", "owner", "other-owner")).toBe(false);
    expect(canKickServerMember(true, "owner", "member", "owner", "owner")).toBe(false);
    expect(canKickServerMember(false, "owner", "member", "owner", "member")).toBe(false);
  });

  it("shows the saved one-button server update action only to the owner", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const server = { ...readyState().servers[0]!, address: "http://127.0.0.1:3210", deployment: { host: "127.0.0.1", port: 2222, username: "root", serverName: "Тестовый сервер", mode: "native" as const, authentication: "password" as const } };
    const { rerender } = render(<LeaveServerDialog server={server} canManageServer canViewSettings canUpdate canDeleteForAll canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onUpdate={onUpdate} onSaveSettings={vi.fn(() => true)} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Обновить сервер" }));
    expect(onUpdate).toHaveBeenCalledOnce();

    rerender(<LeaveServerDialog server={server} canManageServer={false} canViewSettings={false} canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onUpdate={onUpdate} onSaveSettings={vi.fn(() => true)} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Обновить сервер" })).not.toBeInTheDocument();
  });

  it("allows the owner to remove a server avatar", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => true);
    render(<ServerAvatarDialog server={{ ...readyState().servers[0]!, avatar: "data:image/png;base64,AA==" }} open onOpenChange={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    await user.click(screen.getByRole("button", { name: "Сохранить аватар" }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("derives a safe recovery preset for an outdated legacy server", () => {
    expect(deploymentPresetFromServer({ ...readyState().servers[0]!, name: "Legacy", address: "https://chat.example.com" })).toEqual({ host: "chat.example.com", port: 22, username: "root", serverName: "Legacy", authentication: "private-key", domain: "chat.example.com" });
    expect(deploymentPresetFromServer({ ...readyState().servers[0]!, name: "WSL", address: "http://127.0.0.1:3210" })).toEqual({ host: "127.0.0.1", port: 22, username: "root", serverName: "WSL", authentication: "private-key" });
  });

  it("edits and deletes an own message from its action menu", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn(() => true);
    const onDelete = vi.fn(() => true);
    const message = { id: "message-1", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#7c5cff", content: "До правки", createdAt: new Date().toISOString(), editedAt: null };
    render(<Message message={message} members={[]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={onEdit} onDelete={onDelete} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={vi.fn()} />);
    expect(screen.getByText("Лина")).not.toHaveAttribute("style");

    await user.click(screen.getByRole("button", { name: "Редактировать" }));
    const editor = screen.getByRole("textbox", { name: "Редактирование сообщения" });
    await user.clear(editor);
    await user.type(editor, "После правки{Enter}");
    expect(onEdit).toHaveBeenCalledWith(message, "После правки", []);

    await user.click(screen.getByRole("button", { name: /Действия с сообщением/ }));
    await user.click(screen.getByRole("menuitem", { name: "Удалить" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Удалить это сообщение?" });
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole("button", { name: "Удалить" }));
    expect(onDelete).toHaveBeenCalledWith(message);
  });

  it("closes a message action menu outside its bounds and on Escape", async () => {
    const user = userEvent.setup();
    const message = { id: "message-menu", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#7c5cff", content: "Закрой меню", createdAt: new Date().toISOString(), editedAt: null };
    render(<Message message={message} members={[]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /Действия с сообщением/ });

    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByText("Закрой меню"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();

    await user.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("replaces attachments while editing and hides message actions", async () => {
    const user = userEvent.setup();
    const oldAttachment = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "старый.png", mimeType: "image/png", sizeBytes: 1024, sha256: "a".repeat(64) };
    const newAttachment = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "новый.png", mimeType: "image/png", sizeBytes: 2048, sha256: "b".repeat(64) };
    const message = { id: "message-1", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#7c5cff", content: "Текст", createdAt: new Date().toISOString(), editedAt: null, attachments: [oldAttachment] };
    const onEdit = vi.fn(() => true);
    render(<Message message={message} members={[]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach uploading={false} onAttach={vi.fn(async () => newAttachment)} onEdit={onEdit} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Редактировать" }));
    expect(screen.queryByRole("button", { name: /Действия с сообщением/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Удалить" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Открепить старый.png" }));
    await user.click(screen.getByRole("button", { name: "Прикрепить файл к редактируемому сообщению" }));
    expect(await screen.findByText("новый.png")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Редактирование сообщения" }), "{Enter}");
    expect(onEdit).toHaveBeenCalledWith(message, "Текст", [newAttachment]);
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

  const AUTH_UUID = "11111111-1111-4111-8111-111111111111";

  /** Рендерит ClientApp с сетевым сервером и доводит фейковый сокет до auth.ok (сессия есть). */
  async function renderConnectedClient(state: PersistedClientState): Promise<void> {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");
    const socket = FakeWebSocket.instances.at(-1);
    expect(socket).toBeDefined();
    act(() => {
      for (const handler of socket!.listeners.message ?? []) {
        handler({ data: JSON.stringify({ type: "auth.challenge", requestId: AUTH_UUID, protocolVersion: PROTOCOL_VERSION, challenge: Buffer.from("test-challenge-123456").toString("base64"), expiresAt: new Date(Date.now() + 60_000).toISOString() }) });
      }
    });
    act(() => {
      for (const handler of socket!.listeners.message ?? []) {
        handler({ data: JSON.stringify({ type: "auth.ok", requestId: AUTH_UUID, userId: "user-1", serverId: AUTH_UUID, sessionToken: "t".repeat(50), sessionExpiresAt: new Date(Date.now() + 60_000).toISOString() }) });
      }
    });
    await waitFor(() => expect(screen.getByText("подключено")).toBeInTheDocument());
  }

  it("attaches files pasted into the composer and dropped onto the chat", async () => {
    let attachmentCounter = 0;
    const uploadFile = vi.fn(async (_context: unknown, file: File) => ({ id: `att-${++attachmentCounter}`, fileName: file.name, mimeType: "text/plain", sizeBytes: 4, sha256: "a".repeat(64) }));
    window.openCord!.attachments.uploadFile = uploadFile;
    const state = readyState();
    state.servers[0]!.address = "http://127.0.0.1:3210";
    await renderConnectedClient(state);

    const composer = screen.getByLabelText(/написать в #добро-пожаловать/i);
    // clipboardData и dataTransfer — readonly-поля нативных событий: диспатчим вручную.
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", { value: { files: [new File(["раз"], "паста.txt", { type: "text/plain" })] } });
    composer.dispatchEvent(pasteEvent);
    expect(await screen.findByText("паста.txt")).toBeInTheDocument();

    const section = composer.closest("section");
    expect(section).not.toBeNull();
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { types: ["Files"], files: [new File(["два"], "перетащенный.txt", { type: "text/plain" })] } });
    section!.dispatchEvent(dropEvent);
    expect(await screen.findByText("перетащенный.txt")).toBeInTheDocument();

    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile.mock.calls[0]?.[1]?.name).toBe("паста.txt");
    expect(uploadFile.mock.calls[1]?.[1]?.name).toBe("перетащенный.txt");
  });

  it("ignores pasted files while the server is not connected", async () => {
    const uploadFile = vi.fn();
    window.openCord!.attachments.uploadFile = uploadFile;
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");
    const composer = screen.getByLabelText(/написать в #добро-пожаловать/i);
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", { value: { files: [new File(["x"], "без-соединения.txt")] } });
    composer.dispatchEvent(pasteEvent);
    expect(await screen.findByText("Вложения доступны после подключения")).toBeInTheDocument();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("saves the server name, unlimited attachments and screen-share limits together", async () => {
    const user = userEvent.setup();
    const onSaveSettings = vi.fn(() => true);
    render(<LeaveServerDialog server={{ ...readyState().servers[0]!, address: "http://127.0.0.1:3210" }} canManageServer canViewSettings canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onUpdate={vi.fn()} onSaveSettings={onSaveSettings} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    const nameInput = screen.getByRole("textbox", { name: "Название сервера" });
    await user.clear(nameInput);
    await user.type(nameInput, "Новый OpenCord");
    const input = screen.getByRole("textbox", { name: "Лимит загрузки в мегабайтах" });
    await user.clear(input);
    await user.type(input, "2001");
    fireEvent.change(screen.getByRole("slider", { name: "Максимальное качество демонстрации экрана" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("slider", { name: "Максимальная частота кадров демонстрации экрана" }), { target: { value: "0" } });
    expect(screen.getAllByText("∞")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Сохранить настройки" }));
    expect(onSaveSettings).toHaveBeenCalledWith({ name: "Новый OpenCord", description: "", maxAttachmentBytes: null, screenShareMaxResolution: 720, screenShareMaxFrameRate: 15 });
  });

  it("saves a manually entered bounded attachment limit", async () => {
    const user = userEvent.setup();
    const onSaveSettings = vi.fn(() => true);
    render(<LeaveServerDialog server={{ ...readyState().servers[0]!, address: "http://127.0.0.1:3210" }} canManageServer canViewSettings canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onUpdate={vi.fn()} onSaveSettings={onSaveSettings} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Лимит загрузки в мегабайтах" });
    await user.clear(input);
    await user.type(input, "1500");
    fireEvent.change(screen.getByRole("slider", { name: "Максимальное качество демонстрации экрана" }), { target: { value: "3" } });
    expect(screen.getAllByText("Источник")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Сохранить настройки" }));
    expect(onSaveSettings).toHaveBeenCalledWith({ name: "Тестовый сервер", description: "", maxAttachmentBytes: 1500 * 1024 * 1024, screenShareMaxResolution: 1440, screenShareMaxFrameRate: 60 });
  });

  it("shows server settings read-only to an administrator", () => {
    render(<LeaveServerDialog server={{ ...readyState().servers[0]!, address: "http://127.0.0.1:3210" }} canManageServer={false} canViewSettings canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onUpdate={vi.fn()} onSaveSettings={vi.fn()} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Управление сервером" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Название сервера" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Лимит загрузки в мегабайтах" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Максимальный размер загружаемого файла" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Максимальное качество демонстрации экрана" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Максимальная частота кадров демонстрации экрана" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Сохранить настройки" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Аватар сервера" })).not.toBeInTheDocument();
    expect(screen.getByText("Изменять настройки может только владелец сервера.")).toBeInTheDocument();
  });

  it("hides server settings from regular members", () => {
    render(<LeaveServerDialog server={{ ...readyState().servers[0]!, address: "http://127.0.0.1:3210" }} canManageServer={false} canViewSettings={false} canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onUpdate={vi.fn()} onSaveSettings={vi.fn()} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Выйти с сервера?" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Название сервера" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Максимальный размер загружаемого файла" })).not.toBeInTheDocument();
    expect(screen.queryByText("Изменять настройки может только владелец сервера.")).not.toBeInTheDocument();
  });

  it("opens a profile preview from both the message avatar and author name", async () => {
    const user = userEvent.setup();
    const message = readyState().messages[0]!;
    const member = { id: message.authorId, username: message.authorName, bio: "Описание с сервера", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: message.authorColor, avatar: null };
    render(<Message message={message} member={member} members={[member]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={vi.fn()} />);

    const profileButtons = screen.getAllByRole("button", { name: `Открыть профиль ${message.authorName}` });
    expect(profileButtons).toHaveLength(2);
    await user.click(profileButtons[0]!);
    expect(screen.getByRole("dialog", { name: `Профиль ${message.authorName}` })).toBeInTheDocument();
    expect(screen.getByTestId("profile-avatar-frame")).toHaveClass("rounded-full");
    expect(screen.getByText("Описание с сервера")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(profileButtons[0]).not.toHaveFocus();
    await user.click(profileButtons[1]!);
    expect(screen.getByRole("dialog", { name: `Профиль ${message.authorName}` })).toBeInTheDocument();
  });

  it("keeps edited messages ordered by their original creation time", () => {
    const messages = [
      { id: "new", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#7c5cff", content: "Новое", createdAt: "2026-08-07T12:00:00.000Z", editedAt: null },
      { id: "old", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#7c5cff", content: "Старое, но изменённое", createdAt: "2026-08-06T12:00:00.000Z", editedAt: "2026-08-07T13:00:00.000Z" },
    ];

    expect(sortMessagesChronologically(messages).map((message) => message.id)).toEqual(["old", "new"]);
  });

  it("opens a profile preview from the member list", async () => {
    const user = userEvent.setup();
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    await user.click(screen.getByRole("button", { name: "Открыть профиль lina" }));
    expect(screen.getByRole("dialog", { name: "Профиль lina" })).toBeInTheDocument();
    expect(screen.getByText("Это вы")).toBeInTheDocument();
  });

  it("opens the server context menu on double click and disconnects from the server", async () => {
    const user = userEvent.setup();
    const state = readyState();
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    await user.dblClick(screen.getByTitle("Тестовый сервер"));
    expect(screen.getByRole("menu", { name: "Меню сервера Тестовый сервер" })).toBeInTheDocument();
    // Демо-сервер без подключения: роль текущего пользователя неизвестна, пункта настроек нет.
    expect(screen.queryByRole("menuitem", { name: "Открыть настройки" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Отключиться от сервера" }));
    expect(await screen.findByRole("heading", { name: "Главный экран" })).toBeInTheDocument();
    expect(screen.getByText("Вы вышли с сервера")).toBeInTheDocument();
    expect(save).toHaveBeenCalled();
  });

  it("groups the member list by role with the highest role first", async () => {
    const state = readyState();
    state.servers[0]!.members = [
      { id: "member-1", username: "Обычный", bio: "", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff" },
      { id: "admin-1", username: "Админ", bio: "", role: "Администратор", serverRole: "administrator" as const, status: "online" as const, avatarColor: "#7c5cff" },
    ];
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    const memberList = screen.getByRole("heading", { name: /Участники — 3/u }).closest("aside");
    expect(memberList).not.toBeNull();
    const headers = within(memberList!).getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent ?? "");
    expect(headers).toEqual(["Владелец сервера — 1", "Администраторы — 1", "Участники — 1"]);
    const order = within(memberList!).getAllByRole("button", { name: /Открыть профиль/u }).map((button) => button.getAttribute("aria-label"));
    expect(order).toEqual(["Открыть профиль lina", "Открыть профиль Админ", "Открыть профиль Обычный"]);
  });

  it("formats the remaining mute time", () => {
    expect(formatMuteRemaining(5 * 60_000)).toBe("5:00");
    expect(formatMuteRemaining(90_000)).toBe("1:30");
    // Округление вверх: последняя секунда показывается как 0:01, а не 0:00.
    expect(formatMuteRemaining(200)).toBe("0:01");
    expect(formatMuteRemaining(0)).toBe("0:00");
    expect(formatMuteRemaining(-5_000)).toBe("0:00");
    expect(formatMuteRemaining(3_723_000)).toBe("1:02:03");
  });

  it("greys out the composer and counts the mute down in real time", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      render(<Composer draft="" channelName="общий" disabled={false} uploading={false} canAttach attachments={[]} onAttach={vi.fn()} onRemoveAttachment={vi.fn()} onDraft={vi.fn()} onSubmit={vi.fn()} members={[]} chatMuted chatMutedUntil={until} />);

      expect(screen.getByRole("status")).toHaveTextContent("Мут: 5:00");
      expect(screen.getByRole("textbox", { name: /общий/u })).toBeDisabled();

      act(() => { vi.advanceTimersByTime(61_000); });
      expect(screen.getByRole("status")).toHaveTextContent("Мут: 3:59");

      // По истечении срока поле разблокируется само, без нового снапшота с сервера.
      act(() => { vi.advanceTimersByTime(4 * 60_000); });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /общий/u })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts from the moment the mute arrives, not from when the composer mounted", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const composer = (muted: boolean, until: string | null): React.ReactElement => (
        <Composer draft="" channelName="общий" disabled={false} uploading={false} canAttach attachments={[]} onAttach={vi.fn()} onRemoveAttachment={vi.fn()} onDraft={vi.fn()} onSubmit={vi.fn()} members={[]} chatMuted={muted} chatMutedUntil={until} />
      );
      const { rerender } = render(composer(false, null));
      // Поле висит незамученным полминуты, и только потом приходит мут на 5 минут.
      act(() => { vi.advanceTimersByTime(30_000); });
      rerender(composer(true, new Date(Date.now() + 5 * 60_000).toISOString()));
      expect(screen.getByRole("status")).toHaveTextContent("Мут: 5:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an indefinite mute without a countdown", () => {
    render(<Composer draft="" channelName="общий" disabled={false} uploading={false} canAttach attachments={[]} onAttach={vi.fn()} onRemoveAttachment={vi.fn()} onDraft={vi.fn()} onSubmit={vi.fn()} members={[]} chatMuted chatMutedUntil={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Мут: бессрочно");
    expect(screen.getByRole("textbox", { name: /общий/u })).toBeDisabled();
  });

  it("shows uploaded attachments in the composer and allows removing them", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    const onRemoveAttachment = vi.fn();
    render(<Composer draft="сообщение" channelName="общий" disabled={false} uploading={false} canAttach attachments={[{ id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "план.pdf", mimeType: "application/pdf", sizeBytes: 1024, sha256: "a".repeat(64) }]} onAttach={onAttach} onRemoveAttachment={onRemoveAttachment} onDraft={vi.fn()} onSubmit={vi.fn()} members={[]} />);
    expect(screen.getByText("план.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    expect(onAttach).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Убрать план.pdf" }));
    expect(onRemoveAttachment).toHaveBeenCalledWith("12959e6f-7ea9-41d9-8be3-f412354d3e95");
  });

  it("opens the emoji panel and inserts an emoji at the text cursor", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    render(<Composer draft="Привет мир" channelName="общий" disabled={false} uploading={false} canAttach attachments={[]} onAttach={vi.fn()} onRemoveAttachment={vi.fn()} onDraft={onDraft} onSubmit={vi.fn()} members={[]} />);

    const input = screen.getByRole("textbox", { name: "Написать в #общий" }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(7, 7);
    await user.click(screen.getByRole("button", { name: "Открыть панель эмодзи" }));

    expect(screen.getByRole("dialog", { name: "Панель эмодзи" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Вставить 😀" }));
    expect(onDraft).toHaveBeenLastCalledWith("Привет 😀мир");
    await user.click(screen.getByRole("button", { name: "Недавние эмодзи" }));
    expect(screen.getByRole("button", { name: "Вставить 😀" })).toBeInTheDocument();
  });

  it("allows submitting an attachment without message text", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<Composer draft="" channelName="общий" disabled={false} uploading={false} canAttach attachments={[{ id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "фото.png", mimeType: "image/png", sizeBytes: 1024, sha256: "a".repeat(64) }]} onAttach={vi.fn()} onRemoveAttachment={vi.fn()} onDraft={vi.fn()} onSubmit={onSubmit} members={[]} />);
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
    const attachment = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "ролик.mp4", mimeType: "video/mp4", sizeBytes: 25 * 1024 * 1024, sha256: "a".repeat(64) };
    render(<AttachmentView attachment={attachment} onDownload={vi.fn()} onPreview={vi.fn(async () => "file:///C:/Temp/opencord-media-previews/video.mp4")} />);

    expect(await screen.findByLabelText("Видео: ролик.mp4")).toHaveAttribute("src", "file:///C:/Temp/opencord-media-previews/video.mp4");
    expect(screen.getByLabelText("Видео: ролик.mp4")).toHaveAttribute("controls");
    await user.click(screen.getByRole("button", { name: "На весь экран: ролик.mp4" }));

    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("defers heavy media previews until their message is near the viewport", async () => {
    let intersectionCallback!: IntersectionObserverCallback;
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) { intersectionCallback = callback; }
      observe(): void { /* controlled by the test */ }
      disconnect(): void { /* no-op */ }
      unobserve(): void { /* no-op */ }
      takeRecords(): IntersectionObserverEntry[] { return []; }
      readonly root = null;
      readonly rootMargin = "360px 0px";
      readonly thresholds = [0];
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const onPreview = vi.fn(async () => "file:///C:/Temp/opencord-media-previews/video.mp4");
    const attachment = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "тяжёлый-ролик.mp4", mimeType: "video/mp4", sizeBytes: 500 * 1024 * 1024, sha256: "a".repeat(64) };
    render(<AttachmentView attachment={attachment} onDownload={vi.fn()} onPreview={onPreview} />);

    expect(onPreview).not.toHaveBeenCalled();
    act(() => intersectionCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(onPreview).toHaveBeenCalledOnce());
    expect(await screen.findByLabelText("Видео: тяжёлый-ролик.mp4")).toBeInTheDocument();
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
    expect(screen.getByRole("alert")).toHaveTextContent("проверяет его каждые 2 секунды");
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
      maxAttachmentBytes: 10 * 1024 * 1024,
      channels: [{ id: "next-general", serverId: "next-server", name: "общий", kind: "text", description: "Следующий канал", participantLimit: null, slowmodeSeconds: 0 }],
      members: [],
    });
    vi.mocked(window.openCord!.storage.load).mockResolvedValue(state);

    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");
    await user.click(screen.getByRole("button", { name: "Управление сервером: Тестовый сервер" }));
    expect(await screen.findByRole("heading", { name: "Тестовый сервер" })).toBeInTheDocument();
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
      avatar: "data:image/png;base64,AA==",
      banner: "data:image/webp;base64,AQ==",
      maxAttachmentBytes: 25 * 1024 * 1024,
      screenShareMaxResolution: 720,
      screenShareMaxFrameRate: 30,
      channels: [{ id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", name: "общий", kind: "text", description: "Основной канал", participantLimit: null, slowmodeSeconds: 0 }],
      members: [{ id: "server-admin", username: "anna", discriminator: "4242", fingerprint: "abcd-ef01-2345-6789", bio: "Администрирую сообщество", avatar: "data:image/webp;base64,AA==", banner: "data:image/webp;base64,AQ==", status: "online", role: "administrator", chatMuted: false, chatMutedUntil: null, nameFont: "none" }],
      currentUser: { id: "local-user", role: "owner", permissions: ["MANAGE_CHANNELS", "MANAGE_ROLES", "DELETE_SERVER"] },
    });

    expect(next.servers[0]?.name).toBe("OpenCord Server");
    expect(next.servers[0]?.avatar).toBe("data:image/png;base64,AA==");
    expect(next.servers[0]?.banner).toBe("data:image/webp;base64,AQ==");
    expect(next.servers[0]?.maxAttachmentBytes).toBe(25 * 1024 * 1024);
    expect(next.servers[0]?.screenShareMaxResolution).toBe(720);
    expect(next.servers[0]?.screenShareMaxFrameRate).toBe(30);
    expect(next.servers[0]?.channels[0]?.serverId).toBe("test-server");
    expect(next.servers[0]?.members[0]).toMatchObject({
      username: "anna",
      bio: "Администрирую сообщество",
      role: "Administrator",
      serverRole: "administrator",
      avatar: "data:image/webp;base64,AA==",
      banner: "data:image/webp;base64,AQ==",
    });
  });

  it("adopts the discriminator the server assigned to the local identity", () => {
    const state = readyState();
    state.profile!.discriminator = "4242";
    const next = applyServerSnapshot(state, {
      id: "7b2f5502-d465-41c2-b794-ef4031e2217a",
      name: "OpenCord Server",
      avatar: null,
      banner: null,
      maxAttachmentBytes: null,
      screenShareMaxResolution: 1080,
      screenShareMaxFrameRate: 60,
      channels: state.servers[0]!.channels.map((channel) => ({ id: channel.id, name: channel.name, kind: channel.kind, description: channel.description, participantLimit: channel.participantLimit, slowmodeSeconds: channel.slowmodeSeconds })),
      // Тег 4242 уже занят другой идентичностью, поэтому сервер выдал локальному профилю свой.
      members: [
        { id: "someone-else", username: state.profile!.username, discriminator: "4242", fingerprint: "abcd-ef01-2345-6789", bio: "", avatar: null, banner: null, status: "online", role: "member", chatMuted: false, chatMutedUntil: null, nameFont: "none" },
        { id: "local-user", username: state.profile!.username, discriminator: "0731", fingerprint: "1234-5678-9abc-def0", bio: "", avatar: null, banner: null, status: "online", role: "owner", chatMuted: false, chatMutedUntil: null, nameFont: "none" },
      ],
      currentUser: { id: "local-user", role: "owner", permissions: ["MANAGE_CHANNELS", "MANAGE_ROLES", "DELETE_SERVER"] },
    });
    expect(next.profile?.discriminator).toBe("0731");
  });

  it("removes cached messages when a server snapshot deletes a channel", () => {
    const state = readyState();
    const removedId = state.servers[0]!.channels[0]!.id;
    expect(state.messages.some((message) => message.channelId === removedId)).toBe(true);
    const next = applyServerSnapshot(state, {
      id: "7b2f5502-d465-41c2-b794-ef4031e2217a",
      name: "OpenCord Server",
      avatar: null,
      banner: null,
      maxAttachmentBytes: null,
      screenShareMaxResolution: 1080,
      screenShareMaxFrameRate: 60,
      channels: state.servers[0]!.channels.slice(1).map((channel) => ({ id: channel.id, name: channel.name, kind: channel.kind, description: channel.description, participantLimit: channel.participantLimit, slowmodeSeconds: channel.slowmodeSeconds })),
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

  it("shows a voice avatar ring, mute states and a profile preview", () => {
    const profile = readyState().profile!;
    const member = { id: "voice-member", username: "Марина", bio: "Люблю голосовые разговоры", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff", avatar: "data:image/webp;base64,AA==", banner: "data:image/webp;base64,AQ==" };
    const participant = { userId: member.id, channelId: "12959e6f-7ea9-41d9-8be3-f412354d3e95", muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null };
    const { rerender } = render(<VoiceParticipantRow participant={participant} member={member} profile={profile} currentUserId="local-user" speaking />);

    const avatar = screen.getByLabelText("Марина");
    expect(avatar).toHaveClass("ring-2", "ring-emerald-400");
    expect(avatar).not.toHaveClass("transition-[box-shadow]", "duration-150");
    expect(avatar.querySelector("img")).toHaveAttribute("src", member.avatar);
    expect(screen.queryByLabelText(/выключен/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть профиль Марина" }));
    expect(screen.getByRole("dialog", { name: "Профиль Марина" })).toBeInTheDocument();
    expect(screen.getByText("Люблю голосовые разговоры")).toBeInTheDocument();
    expect(screen.getByTestId("profile-banner").querySelector("img")).toHaveAttribute("src", member.banner);
    fireEvent.keyDown(window, { key: "Escape" });

    rerender(<VoiceParticipantRow participant={{ ...participant, muted: true }} member={member} profile={profile} currentUserId="local-user" speaking />);
    expect(screen.getByLabelText("Марина")).not.toHaveClass("ring-2");
    expect(screen.getByLabelText("Микрофон выключен: Марина")).toBeInTheDocument();

    rerender(<VoiceParticipantRow participant={{ ...participant, muted: true, deafened: true }} member={member} profile={profile} currentUserId="local-user" speaking={false} />);
    expect(screen.getByLabelText("Звук и микрофон выключены: Марина")).toBeInTheDocument();
    expect(screen.queryByLabelText("Микрофон выключен: Марина")).not.toBeInTheDocument();
  });

  it("uses the full voice panel control cell as the microphone hitbox", async () => {
    const user = userEvent.setup();
    const state = readyState();
    const voiceChannel = state.servers[0]!.channels[2]!;
    const onMuted = vi.fn();
    render(<ChannelSidebar server={state.servers[0]!} activeChannelId={voiceChannel.id} profile={state.profile!} canManageChannels={false} voiceChannelId={voiceChannel.id} voiceStatus="connected" muted={false} deafened={false} isScreenSharing={false} onCreateChannel={vi.fn()} onEditChannel={vi.fn()} onDeleteChannel={vi.fn()} onSelectChannel={vi.fn()} onServerMenu={vi.fn()} onProfile={vi.fn()} onSettings={vi.fn()} onLeaveVoice={vi.fn()} onMuted={onMuted} onDeafened={vi.fn()} />);

    const muteButton = screen.getByRole("button", { name: "Выключить микрофон" });
    expect(muteButton).toHaveClass("h-11", "w-full");
    expect(muteButton).toHaveAttribute("aria-pressed", "false");
    await user.click(muteButton);
    expect(onMuted).toHaveBeenCalledWith(true);
  });

  it("lets the user choose a screen share and keeps the viewer until explicit exit", async () => {
    const user = userEvent.setup();
    const state = readyState();
    const profile = state.profile!;
    const voiceChannel = state.servers[0]!.channels[2]!;
    const server = { ...state.servers[0]!, members: [{ id: "voice-member", username: "Марина", bio: "Профиль из голосовой комнаты", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#22d3ee", avatar: null, banner: "data:image/webp;base64,AQ==" }] };
    const participant = { userId: "voice-member", channelId: voiceChannel.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null };
    const viewer = { userId: "local-user", channelId: voiceChannel.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: "voice-member" };
    const stream = { participantIdentity: "voice-member", participantName: "Марина", local: false, track: {} } as unknown as ScreenShareStream;
    const onViewScreenShare = vi.fn();
    const onExitScreenShare = vi.fn();
    const onParticipantMuted = vi.fn();
    const onParticipantVolume = vi.fn();
    const onServerMuted = vi.fn();
    const onDisconnectParticipant = vi.fn();
    const commonProps = { channel: voiceChannel, server, profile, participants: [participant, viewer], currentUserId: "local-user", currentUserRole: "owner" as const, canModerateVoice: true, connectedChannelId: voiceChannel.id, status: "connected" as const, muted: false, serverMuted: false, deafened: false, locallyMutedParticipantIds: [], participantVolumes: {}, activeSpeakerIds: [], isScreenSharing: false, onMuted: vi.fn(), onDeafened: vi.fn(), onParticipantMuted, onParticipantVolume, onServerMuted, onDisconnectParticipant, onStartScreenShare: vi.fn(), onStopScreenShare: vi.fn(), onViewScreenShare, onExitScreenShare, onLeaveVoice: vi.fn() };
    const { rerender } = render(<VoiceChannelView {...commonProps} screenShares={[stream]} viewingScreenShareId={null} />);

    expect(screen.getByRole("button", { name: "Выключить микрофон" })).toHaveClass("size-11");
    expect(screen.getByLabelText("Смотрят: lina")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "Открыть профиль Марина" }));
    expect(screen.getByRole("dialog", { name: "Профиль Марина" })).toBeInTheDocument();
    expect(screen.getByText("Профиль из голосовой комнаты")).toBeInTheDocument();
    expect(screen.getByTestId("profile-banner").querySelector("img")).toHaveAttribute("src", server.members[0]!.banner);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Профиль Марина" })).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Заглушить у себя: Марина" })).toHaveClass("size-11");
    await user.click(screen.getByRole("button", { name: "Заглушить у себя: Марина" }));
    expect(onParticipantMuted).toHaveBeenCalledWith("voice-member", true);
    await user.click(screen.getByRole("button", { name: "Заглушить для всех: Марина" }));
    expect(onServerMuted).toHaveBeenCalledWith("voice-member", true);
    rerender(<VoiceChannelView {...commonProps} participants={[{ ...participant, muted: true, serverMuted: true }, viewer]} screenShares={[stream]} viewingScreenShareId={null} />);
    expect(screen.getByText("Заглушён администрацией")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Снять серверный мут: Марина" })).toHaveAttribute("aria-pressed", "true");
    rerender(<VoiceChannelView {...commonProps} participants={[participant, viewer]} locallyMutedParticipantIds={["voice-member"]} screenShares={[stream]} viewingScreenShareId={null} />);
    expect(screen.getByText("Заглушён у вас")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Включить звук у себя: Марина" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("slider", { name: "Громкость у себя: Марина" }), { target: { value: "35" } });
    expect(onParticipantVolume).toHaveBeenCalledWith("voice-member", 0.35);
    await user.click(screen.getByRole("button", { name: "Отключить от голосового канала: Марина" }));
    expect(onDisconnectParticipant).toHaveBeenCalledWith("voice-member");

    await user.click(screen.getByRole("button", { name: "Смотреть трансляцию Марина" }));
    expect(onViewScreenShare).toHaveBeenCalledWith("voice-member");

    rerender(<VoiceChannelView {...commonProps} screenShares={[]} viewingScreenShareId="voice-member" />);
    expect(screen.getByRole("heading", { name: "Трансляция временно недоступна" })).toBeInTheDocument();
    expect(screen.getByText(/останется открытым/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Выйти из просмотра" }));
    expect(onExitScreenShare).toHaveBeenCalledOnce();
  });

  it("keeps the participant card controls above the profile overlay", () => {
    const state = readyState();
    const profile = state.profile!;
    const voiceChannel = state.servers[0]!.channels[2]!;
    const server = { ...state.servers[0]!, members: [{ id: "voice-member", username: "Марина", bio: "", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#22d3ee", avatar: null, banner: null }] };
    const participant = { userId: "voice-member", channelId: voiceChannel.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null };
    render(<VoiceChannelView channel={voiceChannel} server={server} profile={profile} participants={[participant]} currentUserId="local-user" currentUserRole="owner" canModerateVoice connectedChannelId={voiceChannel.id} status="connected" muted={false} serverMuted={false} deafened={false} locallyMutedParticipantIds={[]} participantVolumes={{}} activeSpeakerIds={[]} screenShares={[]} viewingScreenShareId={null} isScreenSharing={false} onMuted={vi.fn()} onDeafened={vi.fn()} onParticipantMuted={vi.fn()} onParticipantVolume={vi.fn()} onServerMuted={vi.fn()} onDisconnectParticipant={vi.fn()} onStartScreenShare={vi.fn()} onStopScreenShare={vi.fn()} onViewScreenShare={vi.fn()} onExitScreenShare={vi.fn()} onLeaveVoice={vi.fn()} />);

    // Обёртка ProfilePreview — позиционированный элемент во всю ширину карточки, и в порядке
    // дерева она идёт после угловых кнопок. Без подъёма слоя она перекрывает их целиком:
    // в Chromium клик по заглушке, серверному муту и отключению не доходил до кнопки вовсе.
    // jsdom раскладку не считает и такой перехват не воспроизводит, поэтому проверяется
    // само условие, которое ставит кнопки выше обёртки.
    const overlay = screen.getByRole("button", { name: "Открыть профиль Марина" }).parentElement!;
    expect(overlay.className).toEqual(expect.stringContaining("relative"));
    expect(overlay.className).toEqual(expect.not.stringContaining("z-"));
    for (const name of ["Заглушить у себя: Марина", "Заглушить для всех: Марина", "Отключить от голосового канала: Марина"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("absolute", "z-10");
    }
  });

  it("offers finite and unlimited capacity for a voice channel", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditChannelDialog channel={readyState().servers[0]!.channels[2]!} open onOpenChange={vi.fn()} onSave={onSave} />);
    const slider = screen.getByRole("slider", { name: "Лимит участников голосового канала" });
    expect(slider).toHaveValue("25");
    fireEvent.change(slider, { target: { value: "26" } });
    expect(screen.getAllByText("∞", { selector: "span" })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    expect(onSave).toHaveBeenCalledWith("Гостиная", "Голосовой канал", 0, 0);
  });

  it("offers a slowmode picker for a text channel only", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const textChannel = readyState().servers[0]!.channels[0]!;
    const { unmount } = render(<EditChannelDialog channel={textChannel} open onOpenChange={vi.fn()} onSave={onSave} />);
    await user.click(screen.getByRole("radio", { name: "30 с" }));
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    expect(onSave).toHaveBeenCalledWith(textChannel.name, textChannel.description, null, 30);
    unmount();

    // У голосового канала сообщений нет, поэтому и выбора ограничения быть не должно.
    render(<EditChannelDialog channel={readyState().servers[0]!.channels[2]!} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByRole("radiogroup", { name: "Ограничение отправки" })).not.toBeInTheDocument();
  });

  it("applies a bulk slowmode to every selected text channel", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const channels = readyState().servers[0]!.channels;
    render(<ChannelSlowmodeDialog channels={channels} open onOpenChange={vi.fn()} onApply={onApply} />);

    // Голосовые каналы в список массовой настройки не попадают.
    const textChannels = channels.filter((channel) => channel.kind === "text");
    expect(screen.getAllByRole("checkbox")).toHaveLength(textChannels.length);

    await user.click(screen.getByRole("button", { name: "Выбрать все" }));
    expect(screen.getByText(`Выбрано каналов: ${textChannels.length}`)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "10 с" }));
    await user.click(screen.getByRole("button", { name: "Применить к выбранным" }));
    expect(onApply).toHaveBeenCalledWith(textChannels.map((channel) => channel.id), 10);
  });

  it("keeps the bulk slowmode apply button disabled until channels are selected", () => {
    render(<ChannelSlowmodeDialog channels={readyState().servers[0]!.channels} open onOpenChange={vi.fn()} onApply={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Применить к выбранным" })).toBeDisabled();
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

  it("opens the settings dialog from the home screen", async () => {
    const user = userEvent.setup();
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");
    await user.click(screen.getByRole("button", { name: "Личное пространство" }));
    await screen.findByRole("heading", { name: "Главный экран" });
    await user.click(screen.getByTitle("Настройки"));
    expect(await screen.findByRole("heading", { name: "Настройки" })).toBeInTheDocument();
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

  it("clears the message draft when switching servers", async () => {
    const user = userEvent.setup();
    const state = readyState();
    state.servers = [...state.servers, { id: "second-server", name: "Второй сервер", address: null, accent: "#4d6bfe", maxAttachmentBytes: 10 * 1024 * 1024, channels: [{ id: "second-general", serverId: "second-server", name: "главный", kind: "text" as const, description: "", participantLimit: null, slowmodeSeconds: 0 }], members: [] }];
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    const composer = screen.getByRole("textbox", { name: "Написать в #добро-пожаловать" }) as HTMLInputElement;
    await user.type(composer, "черновик");
    expect(composer).toHaveValue("черновик");

    await user.click(screen.getByTitle("Второй сервер"));
    expect(await screen.findByRole("textbox", { name: "Написать в #главный" })).toHaveValue("");
  });

  it("closes the search panel and drops results when switching servers", async () => {
    const user = userEvent.setup();
    const state = readyState();
    state.servers = [...state.servers, { id: "second-server", name: "Второй сервер", address: null, accent: "#4d6bfe", maxAttachmentBytes: 10 * 1024 * 1024, channels: [{ id: "second-general", serverId: "second-server", name: "главный", kind: "text" as const, description: "", participantLimit: null, slowmodeSeconds: 0 }], members: [] }];
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    await user.click(screen.getByRole("button", { name: "Открыть поиск по серверу" }));
    await user.type(screen.getByLabelText("Текст поиска"), "Тестовое");
    await user.click(screen.getByRole("button", { name: "Найти" }));
    expect(await screen.findByText("Результаты")).toBeInTheDocument();

    await user.click(screen.getByTitle("Второй сервер"));
    expect(screen.queryByLabelText("Поиск по серверу")).not.toBeInTheDocument();
  });

  it("removes an unreachable server locally through the leave dialog", async () => {
    const user = userEvent.setup();
    const state = readyState();
    state.servers = [{ ...state.servers[0]!, id: "remote-server", address: "http://127.0.0.1:3210" }];
    state.activeServerId = "remote-server";
    window.openCord!.storage.load = vi.fn(async () => state);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    await user.click(screen.getByRole("button", { name: "Управление сервером: Тестовый сервер" }));
    await user.click(await screen.findByRole("button", { name: "Удалить только с этого устройства" }));

    expect(await screen.findByRole("heading", { name: "Главный экран" })).toBeInTheDocument();
    expect(await screen.findByText("Сервер удалён с этого устройства")).toBeInTheDocument();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ servers: [], activeServerId: null, activeChannelId: null }));
  });

  it("opens the profile editor from the home screen", async () => {
    const user = userEvent.setup();
    const state = readyState();
    state.servers = [];
    state.activeServerId = null;
    state.activeChannelId = null;
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByRole("heading", { name: "Главный экран" });

    await user.click(screen.getByRole("button", { name: "Настроить профиль" }));
    expect(await screen.findByRole("heading", { name: "Публичный профиль" })).toBeInTheDocument();
  });

  it("renders a mention as a highlighted chip that opens the profile preview", async () => {
    const user = userEvent.setup();
    const member = { id: "user-mark", username: "mark", discriminator: "5678", fingerprint: "abcd-ef01-2345-6789", bio: "Про упоминания", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff", avatar: null };
    const message = { id: "mention-message", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#4d6bfe", content: "Привет <@user-mark>!", createdAt: new Date().toISOString(), mentions: ["user-mark"] };
    render(<Message message={message} members={[member]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={vi.fn()} />);

    const mention = screen.getByRole("button", { name: "Упоминание: mark" });
    expect(mention).toHaveClass("h-[18px]", "bg-blue-500/18", "text-[12px]");
    await user.click(mention);
    expect(screen.getByRole("dialog", { name: "Профиль mark" })).toBeInTheDocument();
    expect(screen.getByText("@mark#5678")).toBeInTheDocument();
    expect(screen.getByText("abcd-ef01-2345-6789")).toBeInTheDocument();
  });

  it("renders a mention of a left member with an unknown-user fallback", () => {
    const message = { id: "mention-message", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#4d6bfe", content: "Привет <@user-gone>!", createdAt: new Date().toISOString(), mentions: ["user-gone"] };
    render(<Message message={message} members={[]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={vi.fn()} />);
    expect(screen.getByText("@Неизвестный пользователь")).toBeInTheDocument();
  });

  it("suggests members after @ in the composer and inserts the chosen tag", async () => {
    const user = userEvent.setup();
    const candidates: MentionCandidate[] = [
      { id: "user-lina", username: "lina", discriminator: "1234", status: "online" },
      { id: "user-lina2", username: "lina", discriminator: "9999", status: "offline" },
    ];
    render(<StatefulComposer candidates={candidates} />);
    const input = screen.getByRole("textbox", { name: "Написать в #общий" });

    await user.type(input, "@lin");
    expect(screen.getByRole("listbox", { name: "Упоминание участников" })).toBeInTheDocument();
    expect(screen.getAllByText("@lina")).toHaveLength(2);

    await user.keyboard("{Enter}");
    expect(input).toHaveValue("@lina#1234");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens a clickable command list on / and autocompletes with Tab", async () => {
    const user = userEvent.setup();
    render(<StatefulComposer candidates={[]} />);
    const input = screen.getByRole("textbox", { name: "Написать в #общий" });

    await user.type(input, "/");
    const listbox = screen.getByRole("listbox", { name: "Команды" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(within(listbox).getByText("/pm")).toBeInTheDocument();

    await user.type(input, "p");
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);

    await user.tab();
    expect(input).toHaveValue("/pm ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("completes a command by clicking its list item and supports arrows", async () => {
    const user = userEvent.setup();
    render(<StatefulComposer candidates={[]} />);
    const input = screen.getByRole("textbox", { name: "Написать в #общий" });

    await user.type(input, "/");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("/apm ");

    await user.clear(input);
    await user.type(input, "/r");
    await user.click(screen.getByRole("option", { name: /\/roll/u }));
    expect(input).toHaveValue("/roll ");
  });

  it("rolls a random number as a chat message", async () => {
    const user = userEvent.setup();
    const state = readyState();
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    const composer = screen.getByRole("textbox", { name: "Написать в #добро-пожаловать" });
    await user.type(composer, "/roll");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText(/Выпало: \d{1,3} \(0–100\)/u)).toBeInTheDocument();
    expect(save).toHaveBeenCalled();
  });

  it("asks for a recipient when a private message has no @target", async () => {
    const user = userEvent.setup();
    const state = readyState();
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    const composer = screen.getByRole("textbox", { name: "Написать в #добро-пожаловать" });
    await user.type(composer, "/pm привет без адресата");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Укажите получателя через @username")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("stores a local private message with a badge in the demo mode", async () => {
    const user = userEvent.setup();
    const state = readyState();
    state.servers[0]!.members = [{ id: "user-mark", username: "mark", discriminator: "5678", bio: "", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff" }];
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    const composer = screen.getByRole("textbox", { name: "Написать в #добро-пожаловать" });
    await user.type(composer, "/pm @mark Привет лично");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Привет лично")).toBeInTheDocument();
    expect(screen.getByText("Личное сообщение")).toBeInTheDocument();
  });

  it("renders an anonymous private message with the anonymous badge", () => {
    const message = { id: "apm-message", channelId: "welcome", authorId: "anonymous-apm-message", authorName: "Аноним", authorColor: "#7c5cff", content: "Это секрет", createdAt: new Date().toISOString(), kind: "apm" as const, targetUserId: "local-user", anonymous: true };
    render(<Message message={message} members={[]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={vi.fn()} />);
    expect(screen.getByText("Личное сообщение · анонимно")).toBeInTheDocument();
    expect(screen.getByText("Это секрет")).toBeInTheDocument();
  });

  it("merges consecutive private messages into one rounded amber stack", () => {
    const base: MockMessage = { id: "private-1", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#7c5cff", content: "Первое", createdAt: new Date().toISOString(), kind: "pm" };
    const messages: MockMessage[] = [base, { ...base, id: "private-2", content: "Второе", kind: "apm", anonymous: true }];
    expect(privateMessageStackPosition(messages, 0)).toBe("first");
    expect(privateMessageStackPosition(messages, 1)).toBe("last");

    const commonProps = { members: [], compact: false, grouped: false, ownAvatar: null, currentUserId: "local-user", canManageMessages: false, previewAvailable: false, canAttach: false, uploading: false, onAttach: vi.fn(async () => null), onEdit: vi.fn(), onDelete: vi.fn(), onDownload: vi.fn(), onPreview: vi.fn(), onToggleReaction: vi.fn() };
    const { container, rerender } = render(<Message message={messages[0]!} {...commonProps} privateStackPosition="first" />);
    expect(container.querySelector("article")).toHaveClass("rounded-b-none", "pb-1");
    rerender(<Message message={messages[1]!} {...commonProps} privateStackPosition="last" />);
    expect(container.querySelector("article")).toHaveClass("rounded-t-none", "pt-1");
  });

  it("renders reaction chips with a count and toggles on click", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    const member = { id: "user-mark", username: "Марк", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff" };
    const message = { id: "reaction-message", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#4d6bfe", content: "С реакциями", createdAt: new Date().toISOString(), reactions: [{ emoji: "👍", userIds: ["user-mark"] }, { emoji: "🔥", userIds: ["user-gone"] }, { emoji: "❤️", userIds: ["local-user"] }] };
    render(<Message message={message} members={[member]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={onToggleReaction} canReact />);

    // Чип с эмодзи и количеством; подсказка показывает, кто отреагировал.
    const chip = screen.getByRole("button", { name: "Реакция 👍: 1 — Марк" });
    expect(chip).toHaveAttribute("title", "Марк");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(within(chip).getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Реакция ❤️: 1 — Лина" })).toHaveAttribute("aria-pressed", "true");

    await user.click(chip);
    expect(onToggleReaction).toHaveBeenCalledWith("reaction-message", "👍");

    // Ушедший участник подменяется фолбэком «Неизвестный пользователь».
    const unknownChip = screen.getByRole("button", { name: "Реакция 🔥: 1 — Неизвестный пользователь" });
    expect(unknownChip).toHaveAttribute("title", "Неизвестный пользователь");
    await user.click(unknownChip);
    expect(onToggleReaction).toHaveBeenCalledWith("reaction-message", "🔥");
  });

  it("adds a reaction from the hover action bar instead of the reaction chips", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    const message = { id: "reaction-message", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#4d6bfe", content: "С реакциями", createdAt: new Date().toISOString(), reactions: [{ emoji: "🔥", userIds: ["local-user"] }] };
    render(<Message message={message} members={[]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={onToggleReaction} canReact />);

    // Чипы под сообщением содержат только уже поставленные реакции, а добавление
    // находится в общей панели действий сообщения.
    const chip = screen.getByRole("button", { name: "Реакция 🔥: 1 — Лина" });
    const trigger = screen.getByRole("button", { name: "Добавить реакцию" });
    expect(chip.parentElement).not.toContainElement(trigger);
    expect(trigger.closest('[role="toolbar"]')).toHaveAttribute("aria-label", "Действия с сообщением Лина");
    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Выберите реакцию" });
    expect(picker).toBeInTheDocument();
    const thumbsUp = within(picker).getByRole("button", { name: "Реакция 👍" });
    await waitFor(() => expect(thumbsUp).toHaveFocus());
    await user.keyboard("{ArrowRight}");
    expect(within(picker).getByRole("button", { name: "Реакция ❤️" })).toHaveFocus();
    await user.click(thumbsUp);
    expect(onToggleReaction).toHaveBeenCalledWith("reaction-message", "👍");
    // Палитра закрывается после выбора эмодзи.
    expect(screen.queryByRole("dialog", { name: "Выберите реакцию" })).not.toBeInTheDocument();
  });

  it("keeps the reaction picker anchored to the stable action bar after an update", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    const baseMessage = { id: "moving-reaction-anchor", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#4d6bfe", content: "Новая реакция", createdAt: new Date().toISOString() };
    const commonProps = { members: [], compact: false, grouped: false, ownAvatar: null, currentUserId: "local-user", canManageMessages: false, previewAvailable: false, canAttach: false, uploading: false, onAttach: vi.fn(async () => null), onEdit: vi.fn(), onDelete: vi.fn(), onDownload: vi.fn(), onPreview: vi.fn(), onToggleReaction, canReact: true };
    const { rerender } = render(<Message message={{ ...baseMessage, reactions: [] }} {...commonProps} />);

    await user.click(screen.getByRole("button", { name: "Добавить реакцию" }));
    expect(screen.getByRole("dialog", { name: "Выберите реакцию" })).toBeInTheDocument();

    rerender(<Message message={{ ...baseMessage, reactions: [{ emoji: "🔥", userIds: ["local-user"] }] }} {...commonProps} />);
    expect(screen.getByRole("dialog", { name: "Выберите реакцию" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить реакцию" })).toHaveAttribute("aria-expanded", "true");
  });

  it("offers the reference quick reactions in the message action bar", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    const message = { id: "quick-reaction", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#4d6bfe", content: "Быстрые реакции", createdAt: new Date().toISOString(), reactions: [] };
    render(<Message message={message} members={[]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={onToggleReaction} canReact />);

    const toolbar = screen.getByRole("toolbar", { name: "Действия с сообщением Лина" });
    const quickReaction = within(toolbar).getByRole("button", { name: "Реакция ❤️" });
    expect(within(toolbar).getByRole("button", { name: "Реакция 👍" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Реакция 😭" })).toBeInTheDocument();
    await user.click(quickReaction);
    expect(onToggleReaction).toHaveBeenCalledWith("quick-reaction", "❤️");
  });

  it("separates reactions from the reply action and selects the message", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    const message: MockMessage = { id: "reply-source", channelId: "welcome", authorId: "user-mark", authorName: "Марк", authorColor: "#4d6bfe", content: "Исходное сообщение", createdAt: new Date().toISOString() };
    render(<Message message={message} members={[]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={vi.fn()} onReply={onReply} canReact />);

    const toolbar = screen.getByRole("toolbar", { name: "Действия с сообщением Марк" });
    expect(toolbar.querySelector('span[aria-hidden="true"]')).toBeInTheDocument();
    await user.click(within(toolbar).getByRole("button", { name: "Ответить" }));
    expect(onReply).toHaveBeenCalledWith(message);
  });

  it("renders a compact reply reference and composer preview", async () => {
    const user = userEvent.setup();
    const onCancelReply = vi.fn();
    const source: MockMessage = { id: "reply-source", channelId: "welcome", authorId: "user-mark", authorName: "Марк", authorColor: "#4d6bfe", content: "Исходное сообщение", createdAt: new Date().toISOString() };
    const reply: MockMessage = { ...source, id: "reply-message", authorId: "local-user", authorName: "Лина", content: "Мой ответ", replyToMessageId: source.id };
    const commonProps = { members: [], compact: false, grouped: false, ownAvatar: null, currentUserId: "local-user", canManageMessages: false, previewAvailable: false, canAttach: false, uploading: false, onAttach: vi.fn(async () => null), onEdit: vi.fn(), onDelete: vi.fn(), onDownload: vi.fn(), onPreview: vi.fn(), onToggleReaction: vi.fn() };
    const { unmount } = render(<Message message={reply} replyToMessage={source} {...commonProps} />);
    expect(screen.getByRole("button", { name: /Марк.*Исходное сообщение/u })).toBeInTheDocument();
    unmount();

    render(<Composer draft="" channelName="общий" disabled={false} uploading={false} canAttach attachments={[]} replyingTo={source} onCancelReply={onCancelReply} onAttach={vi.fn()} onRemoveAttachment={vi.fn()} onDraft={vi.fn()} onSubmit={vi.fn()} members={[]} />);
    expect(screen.getByText("Ответ пользователю Марк")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Отменить ответ" }));
    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it("scrolls to and softly highlights a replied-to message", () => {
    const target = document.createElement("div");
    target.id = "message-reply-source";
    target.scrollIntoView = vi.fn();
    document.body.append(target);

    focusMessage("reply-source");

    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(target).toHaveClass("message-jump-highlight");
  });

  it("keeps existing reaction chips disabled while disconnected", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    const message = { id: "offline-reaction", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#4d6bfe", content: "Офлайн", createdAt: new Date().toISOString(), reactions: [{ emoji: "👍", userIds: ["local-user"] }] };
    render(<Message message={message} members={[]} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onToggleReaction={onToggleReaction} canReact={false} />);

    const chip = screen.getByRole("button", { name: "Реакция 👍: 1 — Лина" });
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(onToggleReaction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Добавить реакцию" })).not.toBeInTheDocument();
  });

  it("shows reactions after the server broadcasts a reactions update", async () => {
    const state = readyState();
    state.servers[0]!.address = "http://127.0.0.1:3210";
    const channelId = "12959e6f-7ea9-41d9-8be3-f412354d3e95";
    state.servers[0]!.channels = state.servers[0]!.channels.map((channel) => ({ ...channel, id: channel.id === "welcome" ? channelId : channel.id }));
    state.messages = state.messages.map((message) => ({ ...message, id: "c7a83bb4-4d14-4b4f-9e2f-1f6e0f2f4d4c", channelId }));
    state.activeChannelId = channelId;
    await renderConnectedClient(state);

    act(() => {
      for (const handler of FakeWebSocket.instances.at(-1)!.listeners.message ?? []) {
        handler({ data: JSON.stringify({ type: "message.reactions.updated", messageId: "c7a83bb4-4d14-4b4f-9e2f-1f6e0f2f4d4c", channelId, reactions: [{ emoji: "🔥", userIds: ["local-user"] }] }) });
      }
    });
    expect(await screen.findByRole("button", { name: "Реакция 🔥: 1 — lina" })).toBeInTheDocument();
  });

  it("keeps the anonymous label on demo search results", async () => {
    const user = userEvent.setup();
    const state = readyState();
    state.messages = [...state.messages, { id: "apm-demo", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#4d6bfe", content: "секрет-текст", createdAt: new Date().toISOString(), kind: "apm" as const, targetUserId: "member", anonymous: true }];
    window.openCord!.storage.load = vi.fn(async () => state);
    render(<ClientApp />);
    await screen.findByText("Тестовый сервер");

    await user.click(screen.getByRole("button", { name: "Открыть поиск по серверу" }));
    await user.type(screen.getByLabelText("Текст поиска"), "секрет");
    await user.click(screen.getByRole("button", { name: "Найти" }));
    // Метка анонимного сообщения появляется и в результатах поиска, и в самом чате.
    expect(await screen.findAllByText("Личное сообщение · анонимно")).toHaveLength(2);
    expect(within(screen.getByLabelText("Поиск по серверу")).getByText("Личное сообщение · анонимно")).toBeInTheDocument();
  });
  it("offers mute duration presets after /mute @target and applies them by click or Tab", async () => {
    const user = userEvent.setup();
    render(<StatefulComposer candidates={[]} canModerateChat />);
    const input = screen.getByRole("textbox", { name: "Написать в #общий" });

    await user.type(input, "/mute @mark");
    const listbox = screen.getByRole("listbox", { name: "Срок мута" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(7);
    await user.click(within(listbox).getByRole("option", { name: "5 минут" }));
    expect(input).toHaveValue("/mute @mark 5m");

    await user.clear(input);
    await user.type(input, "/mute @mark");
    await user.tab();
    expect(input).toHaveValue("/mute @mark 5m");

    await user.clear(input);
    await user.type(input, "/mute @mark");
    await user.click(screen.getByRole("option", { name: "Навсегда" }));
    expect(input).toHaveValue("/mute @mark");
    expect(screen.queryByRole("listbox", { name: "Срок мута" })).not.toBeInTheDocument();
  });

  it("keeps the command list free of /mute for members without moderation rights", async () => {
    const user = userEvent.setup();
    render(<StatefulComposer candidates={[]} />);
    const input = screen.getByRole("textbox", { name: "Написать в #общий" });
    await user.type(input, "/");
    const listbox = screen.getByRole("listbox", { name: "Команды" });
    expect(within(listbox).queryByText("/mute")).not.toBeInTheDocument();
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
  });
});

function StatefulComposer({ candidates, canModerateChat = false }: { candidates: MentionCandidate[]; canModerateChat?: boolean }): React.ReactElement {
  const [draft, setDraft] = useState("");
  return <Composer draft={draft} channelName="общий" disabled={false} uploading={false} canAttach attachments={[]} onAttach={vi.fn()} onRemoveAttachment={vi.fn()} onDraft={setDraft} onSubmit={vi.fn()} members={candidates} canModerateChat={canModerateChat} />;
}
