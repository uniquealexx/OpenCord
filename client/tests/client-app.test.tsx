import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyServerSnapshot, AttachmentView, canDisconnectVoiceParticipant, canKickServerMember, ChannelSidebar, ClientApp, Composer, deploymentPresetFromServer, EditChannelDialog, LeaveServerDialog, Message, ProtocolNotice, shouldRequestVoiceJoin, sortMessagesChronologically, upsertDeployedServer, VoiceChannelView, VoiceParticipantRow } from "@/components/client-app";
import type { ScreenShareStream } from "@/hooks/use-voice-session";
import { createDefaultState, type PersistedClientState } from "@/shared/state";
import { ServerAvatarDialog } from "@/components/server-avatar-dialog";

function readyState(): PersistedClientState {
  const state: PersistedClientState = {
    ...createDefaultState(),
    onboardingComplete: true,
    profile: { id: "local-user", displayName: "Лина", bio: "", avatar: null, banner: null, createdAt: new Date().toISOString() },
  };
  state.servers = [{
    id: "test-server",
    name: "Тестовый сервер",
    address: null,
    accent: "#7c5cff",
    maxAttachmentBytes: 10 * 1024 * 1024,
    channels: [
      { id: "welcome", serverId: "test-server", name: "добро-пожаловать", kind: "text", description: "Начните знакомство", participantLimit: null },
      { id: "general", serverId: "test-server", name: "общий", kind: "text", description: "Разговоры обо всём", participantLimit: null },
      { id: "voice", serverId: "test-server", name: "Гостиная", kind: "voice", description: "Голосовой канал", participantLimit: 25 },
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
  readyState = FakeWebSocket.CONNECTING;
  readonly listeners: Record<string, ((event: { data?: string }) => void)[]> = {};
  constructor(public readonly url: string) {}
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
      identity: { getOrCreate: vi.fn(async () => ({ publicKey: "test-public-key", fingerprint: "test" })), signChallenge: vi.fn(async () => "test-signature"), reset: vi.fn(async () => ({ publicKey: "new-test-public-key", fingerprint: "new-test" })) },
      deployment: { selectServerBundle: vi.fn(async () => null), selectPrivateKey: vi.fn(async () => null), releasePrivateKey: vi.fn(), inspectHost: vi.fn(), inspectEnvironment: vi.fn(), start: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => () => undefined) },
      attachments: { selectAndUpload: vi.fn(async () => null), download: vi.fn(async () => true), preview: vi.fn(async () => "data:image/png;base64,AA=="), setLatencySensitive: vi.fn(async () => undefined) },
    };
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("does not request another voice join when opening the current room", () => {
    expect(shouldRequestVoiceJoin("connected", "voice", "voice", "voice")).toBe(false);
    expect(shouldRequestVoiceJoin("connecting", null, "voice", "voice")).toBe(false);
    expect(shouldRequestVoiceJoin("reconnecting", "voice", "voice", "voice")).toBe(false);
    expect(shouldRequestVoiceJoin("connected", "voice", "voice", "another-voice")).toBe(true);
    expect(shouldRequestVoiceJoin("error", null, "voice", "voice")).toBe(true);
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
    const { rerender } = render(<LeaveServerDialog server={server} canManageServer canUpdate canDeleteForAll canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onUpdate={onUpdate} onSaveSettings={vi.fn(() => true)} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Обновить сервер" }));
    expect(onUpdate).toHaveBeenCalledOnce();

    rerender(<LeaveServerDialog server={server} canManageServer={false} canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onUpdate={onUpdate} onSaveSettings={vi.fn(() => true)} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
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
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const message = { id: "message-1", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#7c5cff", content: "До правки", createdAt: new Date().toISOString(), editedAt: null };
    render(<Message message={message} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={onEdit} onDelete={onDelete} onDownload={vi.fn()} onPreview={vi.fn()} />);
    expect(screen.getByText("Лина")).not.toHaveAttribute("style");

    await user.click(screen.getByRole("button", { name: /Действия с сообщением/ }));
    await user.click(screen.getByRole("menuitem", { name: "Редактировать" }));
    const editor = screen.getByRole("textbox", { name: "Редактирование сообщения" });
    await user.clear(editor);
    await user.type(editor, "После правки{Enter}");
    expect(onEdit).toHaveBeenCalledWith(message, "После правки", []);

    await user.click(screen.getByRole("button", { name: /Действия с сообщением/ }));
    await user.click(screen.getByRole("menuitem", { name: "Удалить" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith(message);
  });

  it("closes a message action menu outside its bounds and on Escape", async () => {
    const user = userEvent.setup();
    const message = { id: "message-menu", channelId: "welcome", authorId: "local-user", authorName: "Лина", authorColor: "#7c5cff", content: "Закрой меню", createdAt: new Date().toISOString(), editedAt: null };
    render(<Message message={message} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} />);
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
    render(<Message message={message} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach uploading={false} onAttach={vi.fn(async () => newAttachment)} onEdit={onEdit} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Действия с сообщением/ }));
    await user.click(screen.getByRole("menuitem", { name: "Редактировать" }));
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

  it("saves the server name, unlimited attachments and screen-share limits together", async () => {
    const user = userEvent.setup();
    const onSaveSettings = vi.fn(() => true);
    render(<LeaveServerDialog server={{ ...readyState().servers[0]!, address: "http://127.0.0.1:3210" }} canManageServer canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onUpdate={vi.fn()} onSaveSettings={onSaveSettings} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
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
    expect(onSaveSettings).toHaveBeenCalledWith({ name: "Новый OpenCord", maxAttachmentBytes: null, screenShareMaxResolution: 720, screenShareMaxFrameRate: 15 });
  });

  it("saves a manually entered bounded attachment limit", async () => {
    const user = userEvent.setup();
    const onSaveSettings = vi.fn(() => true);
    render(<LeaveServerDialog server={{ ...readyState().servers[0]!, address: "http://127.0.0.1:3210" }} canManageServer canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onAvatar={vi.fn()} onUpdate={vi.fn()} onSaveSettings={onSaveSettings} onConfirm={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Лимит загрузки в мегабайтах" });
    await user.clear(input);
    await user.type(input, "1500");
    fireEvent.change(screen.getByRole("slider", { name: "Максимальное качество демонстрации экрана" }), { target: { value: "3" } });
    expect(screen.getAllByText("Источник")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Сохранить настройки" }));
    expect(onSaveSettings).toHaveBeenCalledWith({ name: "Тестовый сервер", maxAttachmentBytes: 1500 * 1024 * 1024, screenShareMaxResolution: 1440, screenShareMaxFrameRate: 60 });
  });

  it("opens a profile preview from both the message avatar and author name", async () => {
    const user = userEvent.setup();
    const message = readyState().messages[0]!;
    const member = { id: message.authorId, displayName: message.authorName, bio: "Описание с сервера", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: message.authorColor, avatar: null };
    render(<Message message={message} member={member} compact={false} grouped={false} ownAvatar={null} currentUserId="local-user" canManageMessages={false} previewAvailable={false} canAttach={false} uploading={false} onAttach={vi.fn(async () => null)} onEdit={vi.fn()} onDelete={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} />);

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

    await user.click(screen.getByRole("button", { name: "Открыть профиль Лина" }));
    expect(screen.getByRole("dialog", { name: "Профиль Лина" })).toBeInTheDocument();
    expect(screen.getByText("Это вы")).toBeInTheDocument();
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

  it("opens the emoji panel and inserts an emoji at the text cursor", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    render(<Composer draft="Привет мир" channelName="общий" disabled={false} uploading={false} canAttach attachments={[]} onAttach={vi.fn()} onRemoveAttachment={vi.fn()} onDraft={onDraft} onSubmit={vi.fn()} />);

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
      channels: [{ id: "next-general", serverId: "next-server", name: "общий", kind: "text", description: "Следующий канал", participantLimit: null }],
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
      avatar: "data:image/png;base64,AA==",
      maxAttachmentBytes: 25 * 1024 * 1024,
      screenShareMaxResolution: 720,
      screenShareMaxFrameRate: 30,
      channels: [{ id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", name: "общий", kind: "text", description: "Основной канал", participantLimit: null }],
      members: [{ id: "server-admin", displayName: "Анна", bio: "Администрирую сообщество", avatar: "data:image/webp;base64,AA==", banner: "data:image/webp;base64,AQ==", status: "online", role: "administrator" }],
      currentUser: { id: "local-user", role: "owner", permissions: ["MANAGE_CHANNELS", "MANAGE_ROLES", "DELETE_SERVER"] },
    });

    expect(next.servers[0]?.name).toBe("OpenCord Server");
    expect(next.servers[0]?.avatar).toBe("data:image/png;base64,AA==");
    expect(next.servers[0]?.maxAttachmentBytes).toBe(25 * 1024 * 1024);
    expect(next.servers[0]?.screenShareMaxResolution).toBe(720);
    expect(next.servers[0]?.screenShareMaxFrameRate).toBe(30);
    expect(next.servers[0]?.channels[0]?.serverId).toBe("test-server");
    expect(next.servers[0]?.members[0]).toMatchObject({
      displayName: "Анна",
      bio: "Администрирую сообщество",
      role: "Администратор",
      serverRole: "administrator",
      avatar: "data:image/webp;base64,AA==",
      banner: "data:image/webp;base64,AQ==",
    });
  });

  it("removes cached messages when a server snapshot deletes a channel", () => {
    const state = readyState();
    const removedId = state.servers[0]!.channels[0]!.id;
    expect(state.messages.some((message) => message.channelId === removedId)).toBe(true);
    const next = applyServerSnapshot(state, {
      id: "7b2f5502-d465-41c2-b794-ef4031e2217a",
      name: "OpenCord Server",
      avatar: null,
      maxAttachmentBytes: null,
      screenShareMaxResolution: 1080,
      screenShareMaxFrameRate: 60,
      channels: state.servers[0]!.channels.slice(1).map((channel) => ({ id: channel.id, name: channel.name, kind: channel.kind, description: channel.description, participantLimit: channel.participantLimit })),
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
    const member = { id: "voice-member", displayName: "Марина", bio: "Люблю голосовые разговоры", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff", avatar: "data:image/webp;base64,AA==", banner: "data:image/webp;base64,AQ==" };
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
    const server = { ...state.servers[0]!, members: [{ id: "voice-member", displayName: "Марина", bio: "Профиль из голосовой комнаты", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#22d3ee", avatar: null, banner: "data:image/webp;base64,AQ==" }] };
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
    expect(screen.getByLabelText("Смотрят: Лина")).toHaveTextContent("1");

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

  it("offers finite and unlimited capacity for a voice channel", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditChannelDialog channel={readyState().servers[0]!.channels[2]!} open onOpenChange={vi.fn()} onSave={onSave} />);
    const slider = screen.getByRole("slider", { name: "Лимит участников голосового канала" });
    expect(slider).toHaveValue("25");
    fireEvent.change(slider, { target: { value: "26" } });
    expect(screen.getAllByText("∞", { selector: "span" })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    expect(onSave).toHaveBeenCalledWith("Гостиная", "Голосовой канал", 0);
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

  it("clears the message draft when switching servers", async () => {
    const user = userEvent.setup();
    const state = readyState();
    state.servers = [...state.servers, { id: "second-server", name: "Второй сервер", address: null, accent: "#4d6bfe", maxAttachmentBytes: 10 * 1024 * 1024, channels: [{ id: "second-general", serverId: "second-server", name: "главный", kind: "text" as const, description: "", participantLimit: null }], members: [] }];
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
    state.servers = [...state.servers, { id: "second-server", name: "Второй сервер", address: null, accent: "#4d6bfe", maxAttachmentBytes: 10 * 1024 * 1024, channels: [{ id: "second-general", serverId: "second-server", name: "главный", kind: "text" as const, description: "", participantLimit: null }], members: [] }];
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
});
