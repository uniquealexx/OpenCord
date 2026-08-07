import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ServerSearchPanel } from "@/components/server-search-panel";

const channel = { id: "12959e6f-7ea9-41d9-8be3-f412354d3e95", serverId: "server", name: "общий", kind: "text" as const, description: "", participantLimit: null };
const member = { id: "user-1", displayName: "Лина", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff", avatar: null };

it("combines Discord-like search filters and opens a result", async () => {
  const user = userEvent.setup();
  const onSearch = vi.fn();
  const onOpenMessage = vi.fn();
  const { rerender } = render(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={null} loading={false} onClose={vi.fn()} onSearch={onSearch} onOpenMessage={onOpenMessage} />);

  await user.type(screen.getByRole("textbox", { name: "Текст поиска" }), "котик");
  await user.selectOptions(screen.getByRole("combobox", { name: "Автор сообщения" }), member.id);
  await user.selectOptions(screen.getByRole("combobox", { name: "Канал" }), channel.id);
  await user.click(screen.getByRole("button", { name: "Изображения" }));
  await user.click(screen.getByRole("button", { name: "Найти" }));
  expect(onSearch).toHaveBeenCalledWith({ query: "котик", authorId: member.id, channelId: channel.id, contentTypes: ["image"], offset: 0, limit: 25 });

  const message = { id: "22959e6f-7ea9-41d9-8be3-f412354d3e95", channelId: channel.id, authorId: member.id, authorName: member.displayName, authorAvatar: null, content: "Вот котик", createdAt: "2026-08-07T00:00:00.000Z", editedAt: null, attachments: [] };
  rerender(<ServerSearchPanel open serverName="Тестовый сервер" channels={[channel]} members={[member]} result={{ messages: [message], total: 1, offset: 0, hasMore: false }} loading={false} onClose={vi.fn()} onSearch={onSearch} onOpenMessage={onOpenMessage} />);
  await user.click(screen.getByRole("button", { name: /Лина/u }));
  expect(onOpenMessage).toHaveBeenCalledWith(expect.objectContaining({ id: message.id, content: "Вот котик" }));
});
