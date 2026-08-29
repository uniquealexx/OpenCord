import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ServerSearchPanel } from "@/components/server-search-panel";

const channel = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", serverId: "server", name: "общий", kind: "text" as const, description: "", participantLimit: null, slowmodeSeconds: 0 };
const member = { id: "user-1", username: "Лина", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff", avatar: null };
const panelProps = { previewAvailable: false, onPreview: vi.fn(async () => "data:image/png;base64,AA=="), onReset: vi.fn() };

afterEach(cleanup);

it("combines Discord-like search filters and opens a result", async () => {
  const user = userEvent.setup();
  const onSearch = vi.fn();
  const onOpenMessage = vi.fn();
  const { rerender } = render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={vi.fn()} onSearch={onSearch} onOpenMessage={onOpenMessage} {...panelProps} />);

  await user.type(screen.getByRole("textbox", { name: "Текст поиска" }), "котик");
  await user.click(screen.getByRole("combobox", { name: "Автор сообщения" }));
  await user.click(screen.getByRole("option", { name: member.username }));
  await user.click(screen.getByRole("combobox", { name: "Канал" }));
  await user.click(screen.getByRole("option", { name: `#${channel.name}` }));
  await user.click(screen.getByRole("button", { name: "Изображения" }));
  await user.click(screen.getByRole("button", { name: "Найти" }));
  expect(onSearch).toHaveBeenCalledWith({ query: "котик", authorId: member.id, channelId: channel.id, contentTypes: ["image"], offset: 0, limit: 25 });

  const message = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.username, authorAvatar: null, content: "Вот котик", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [], mentions: [], reactions: [], kind: "chat" as const, targetUserId: null, anonymous: false, replyToMessageId: null };
  rerender(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={{ messages: [message], total: 1, offset: 0, hasMore: false }} loading={false} onClose={vi.fn()} onSearch={onSearch} onOpenMessage={onOpenMessage} {...panelProps} />);
  await user.click(screen.getByRole("button", { name: /Лина/u }));
  expect(onOpenMessage).toHaveBeenCalledWith(expect.objectContaining({ id: message.id, content: "Вот котик" }));
});

it("searches every attachment type without requiring text", async () => {
  const user = userEvent.setup();
  const onSearch = vi.fn();
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={vi.fn()} onSearch={onSearch} onOpenMessage={vi.fn()} {...panelProps} />);

  const submit = screen.getByRole("button", { name: "Найти" });
  expect(submit).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Вложения" }));
  expect(submit).toBeEnabled();
  await user.click(submit);

  expect(onSearch).toHaveBeenCalledWith({ query: "", authorId: null, channelId: null, contentTypes: ["image", "video", "file"], offset: 0, limit: 25 });
});

it("renders mentions as readable tags instead of raw markers", () => {
  const mentioned = { ...member, id: "user-2", username: "mark", discriminator: "5678" };
  const message = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.username, authorAvatar: null, content: "Привет <@user-2>!", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [], mentions: [{ userId: "user-2" }], reactions: [], kind: "chat" as const, targetUserId: null, anonymous: false, replyToMessageId: null };
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[mentioned]} result={{ messages: [message], total: 1, offset: 0, hasMore: false }} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);

  expect(screen.getByText("Привет @mark!")).toBeInTheDocument();
  expect(screen.queryByText(/<@user-2>/u)).not.toBeInTheDocument();
});

it("renders a mention of a removed member as unknown user", () => {
  const message = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.username, authorAvatar: null, content: "Привет <@user-gone>!", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [], mentions: [{ userId: "user-gone" }], reactions: [], kind: "chat" as const, targetUserId: null, anonymous: false, replyToMessageId: null };
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={{ messages: [message], total: 1, offset: 0, hasMore: false }} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);

  expect(screen.getByText("Привет @Неизвестный пользователь!")).toBeInTheDocument();
});

it("marks a video attachment with a clear video badge and preview placeholders", () => {
  const video = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "демо.mp4", mimeType: "video/mp4", sizeBytes: 1024, sha256: "a".repeat(64) };
  const photo = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "фото.png", mimeType: "image/png", sizeBytes: 512, sha256: "b".repeat(64) };
  const message = { id: "33959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.username, authorAvatar: null, content: "Медиа", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [video, photo], mentions: [], reactions: [], kind: "chat" as const, targetUserId: null, anonymous: false, replyToMessageId: null };
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={{ messages: [message], total: 1, offset: 0, hasMore: false }} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);

  expect(screen.getByTitle("демо.mp4")).toHaveTextContent("Видео");
  expect(screen.getByTitle("фото.png")).toBeInTheDocument();
});

it("renders localized labels for private and anonymous message results", () => {
  const apm = { id: "42959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.username, authorAvatar: null, content: "Секрет", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [], mentions: [], reactions: [], kind: "apm" as const, targetUserId: "user-2", anonymous: true, replyToMessageId: null };
  const pm = { id: "52959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.username, authorAvatar: null, content: "Личное", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [], mentions: [], reactions: [], kind: "pm" as const, targetUserId: "user-2", anonymous: false, replyToMessageId: null };
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={{ messages: [apm, pm], total: 2, offset: 0, hasMore: false }} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);

  expect(screen.getByText("Личное сообщение · анонимно")).toBeInTheDocument();
  expect(screen.getByText("Личное сообщение")).toBeInTheDocument();
});

it("resets filters and reports the session reset via the reset button", async () => {
  const user = userEvent.setup();
  const onReset = vi.fn();
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} onReset={onReset} />);

  await user.type(screen.getByRole("textbox", { name: "Текст поиска" }), "котик");
  await user.click(screen.getByRole("combobox", { name: "Автор сообщения" }));
  await user.click(screen.getByRole("option", { name: member.username }));

  const reset = screen.getByRole("button", { name: "Сбросить поиск" });
  expect(reset).toBeEnabled();
  await user.click(reset);

  expect(onReset).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Текст поиска" })).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "Автор сообщения" })).toHaveTextContent("Любой автор");
  expect(screen.getByRole("button", { name: "Найти" })).toBeDisabled();
  expect(reset).toBeDisabled();
});

it("disables the reset button without an active search session", () => {
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);
  expect(screen.getByRole("button", { name: "Сбросить поиск" })).toBeDisabled();
});

it("clears the search session when the panel closes", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);
  await user.type(screen.getByRole("textbox", { name: "Текст поиска" }), "котик");

  rerender(<ServerSearchPanel open={false} serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);
  rerender(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);

  expect(screen.getByRole("textbox", { name: "Текст поиска" })).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "Автор сообщения" })).toHaveTextContent("Любой автор");
});

it("closes the search panel when clicking outside it", () => {
  const onClose = vi.fn();
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={onClose} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);

  fireEvent.pointerDown(document.body);
  expect(onClose).toHaveBeenCalledTimes(1);

  // Клик внутри панели (по самой панели) не закрывает её.
  fireEvent.pointerDown(screen.getByLabelText("Поиск по серверу"));
  expect(onClose).toHaveBeenCalledTimes(1);
});
