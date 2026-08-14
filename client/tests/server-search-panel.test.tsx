import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ServerSearchPanel } from "@/components/server-search-panel";

const channel = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", serverId: "server", name: "общий", kind: "text" as const, description: "", participantLimit: null };
const member = { id: "user-1", displayName: "Лина", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff", avatar: null };
const panelProps = { previewAvailable: false, onPreview: vi.fn(async () => "data:image/png;base64,AA==") };

afterEach(cleanup);

it("combines Discord-like search filters and opens a result", async () => {
  const user = userEvent.setup();
  const onSearch = vi.fn();
  const onOpenMessage = vi.fn();
  const { rerender } = render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={vi.fn()} onSearch={onSearch} onOpenMessage={onOpenMessage} {...panelProps} />);

  await user.type(screen.getByRole("textbox", { name: "Текст поиска" }), "котик");
  await user.click(screen.getByRole("combobox", { name: "Автор сообщения" }));
  await user.click(screen.getByRole("option", { name: member.displayName }));
  await user.click(screen.getByRole("combobox", { name: "Канал" }));
  await user.click(screen.getByRole("option", { name: `#${channel.name}` }));
  await user.click(screen.getByRole("button", { name: "Изображения" }));
  await user.click(screen.getByRole("button", { name: "Найти" }));
  expect(onSearch).toHaveBeenCalledWith({ query: "котик", authorId: member.id, channelId: channel.id, contentTypes: ["image"], offset: 0, limit: 25 });

  const message = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.displayName, authorAvatar: null, content: "Вот котик", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [], mentions: [], kind: "chat" as const, targetUserId: null, anonymous: false };
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
  const mentioned = { ...member, id: "user-2", username: "mark", discriminator: "5678", displayName: "Марк" };
  const message = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.displayName, authorAvatar: null, content: "Привет <@user-2>!", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [], mentions: [{ userId: "user-2" }], kind: "chat" as const, targetUserId: null, anonymous: false };
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[mentioned]} result={{ messages: [message], total: 1, offset: 0, hasMore: false }} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);

  expect(screen.getByText("Привет @mark#5678!")).toBeInTheDocument();
  expect(screen.queryByText(/<@user-2>/u)).not.toBeInTheDocument();
});

it("renders a mention of a removed member as unknown user", () => {
  const message = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.displayName, authorAvatar: null, content: "Привет <@user-gone>!", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [], mentions: [{ userId: "user-gone" }], kind: "chat" as const, targetUserId: null, anonymous: false };
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={{ messages: [message], total: 1, offset: 0, hasMore: false }} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);

  expect(screen.getByText("Привет @Неизвестный пользователь!")).toBeInTheDocument();
});

it("marks a video attachment with a clear video badge and preview placeholders", () => {
  const video = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "демо.mp4", mimeType: "video/mp4", sizeBytes: 1024, sha256: "a".repeat(64) };
  const photo = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", fileName: "фото.png", mimeType: "image/png", sizeBytes: 512, sha256: "b".repeat(64) };
  const message = { id: "33959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.displayName, authorAvatar: null, content: "Медиа", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [video, photo], mentions: [], kind: "chat" as const, targetUserId: null, anonymous: false };
  render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={{ messages: [message], total: 1, offset: 0, hasMore: false }} loading={false} onClose={vi.fn()} onSearch={vi.fn()} onOpenMessage={vi.fn()} {...panelProps} />);

  expect(screen.getByTitle("демо.mp4")).toHaveTextContent("Видео");
  expect(screen.getByTitle("фото.png")).toBeInTheDocument();
});
