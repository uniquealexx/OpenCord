import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerPreviewDialog } from "@/components/server-preview-dialog";
import { ServerSettingsPage } from "@/components/server-settings-page";
import type { LocalProfile, MockServer } from "@/shared/state";

const profile: LocalProfile = { id: "owner", username: "owner", discriminator: "0001", bio: "", avatar: null, banner: null, memberBackground: null, createdAt: "2026-08-18T00:00:00.000Z" };
const server: MockServer = {
  id: "server",
  name: "Команда",
  avatar: null,
  banner: null,
  address: "https://chat.example.com",
  accent: "#4d6bfe",
  maxAttachmentBytes: 10 * 1024 * 1024,
  screenShareMaxResolution: 1080,
  screenShareMaxFrameRate: 60,
  channels: [],
  members: [
    { id: "owner", username: "owner", discriminator: "0001", fingerprint: "0000-0000-0000-0001", role: "Владелец", serverRole: "owner", status: "online", avatarColor: "#4d6bfe", avatar: null },
    { id: "member", username: "member", discriminator: "0002", fingerprint: "0000-0000-0000-0002", role: "Участник", serverRole: "member", status: "offline", avatarColor: "#58b0ff", avatar: null },
  ],
  bannedMembers: [{ id: "banned", username: "banned", discriminator: "0003", fingerprint: "0000-0000-0000-0003", bio: "", avatar: null, banner: null, bannedAt: "2026-08-18T00:00:00.000Z", bannedBy: "owner", expiresAt: null }],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("server settings experience", () => {
  it("opens a common server preview and exposes settings only to moderators", async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    const { rerender } = render(<ServerPreviewDialog server={server} canOpenSettings canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onSettings={onSettings} onUpdate={vi.fn()} onLeave={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Команда" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Открыть настройки сервера" }));
    expect(onSettings).toHaveBeenCalledOnce();

    rerender(<ServerPreviewDialog server={server} canOpenSettings={false} canUpdate={false} canDeleteForAll={false} canRemoveLocal={false} open onOpenChange={vi.fn()} onSettings={onSettings} onUpdate={vi.fn()} onLeave={vi.fn()} onRemoveLocal={vi.fn()} onDeleteForAll={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Открыть настройки сервера" })).not.toBeInTheDocument();
  });

  it("navigates user-management subpages and sends ban and unban actions", async () => {
    const user = userEvent.setup();
    const onBan = vi.fn();
    const onUnban = vi.fn();
    render(<ServerSettingsPage server={server} profile={profile} access={{ id: "owner", role: "owner", permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] }} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={vi.fn(() => true)} onSetRole={vi.fn()} onKick={vi.fn()} onBan={onBan} onUnban={onUnban} />);

    expect(screen.getByRole("heading", { name: "Оформление сервера" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Управление пользователями" }));
    await user.click(screen.getByRole("button", { name: "Бан пользователей" }));
    await user.click(screen.getByRole("combobox", { name: "Срок бана" }));
    await user.click(screen.getByRole("option", { name: "30 минут" }));
    await user.click(screen.getByRole("button", { name: "Забанить" }));
    const banConfirmation = screen.getByRole("alertdialog", { name: /Забанить пользователя/ });
    expect(onBan).not.toHaveBeenCalled();
    await user.click(within(banConfirmation).getByRole("button", { name: "Забанить" }));
    expect(onBan).toHaveBeenCalledWith("member", 30);

    await user.click(screen.getByRole("button", { name: "Разбан" }));
    expect(screen.getByText("banned")).toBeInTheDocument();
    expect(screen.getByText("Навсегда")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Разбанить" }));
    expect(onUnban).toHaveBeenCalledWith("banned");
  });

  it("asks for kick confirmation inside the settings page", async () => {
    const user = userEvent.setup();
    const onKick = vi.fn();
    render(<ServerSettingsPage server={server} profile={profile} access={{ id: "owner", role: "owner", permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] }} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={vi.fn(() => true)} onSetRole={vi.fn()} onKick={onKick} onBan={vi.fn()} onUnban={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Управление пользователями" }));
    await user.click(screen.getByRole("button", { name: "Кик пользователей" }));
    await user.click(screen.getByRole("button", { name: "Исключить с сервера" }));
    const confirmation = screen.getByRole("alertdialog", { name: /Кикнуть пользователя/ });
    expect(onKick).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole("button", { name: "Исключить с сервера" }));
    expect(onKick).toHaveBeenCalledWith("member");
  });

  it("groups users into three responsive role columns and reflects role snapshots immediately", async () => {
    const user = userEvent.setup();
    const onSetRole = vi.fn();
    const props = { profile, access: { id: "owner", role: "owner" as const, permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] as const }, onClose: vi.fn(), onAvatar: vi.fn(), onBanner: vi.fn(), onSaveSettings: vi.fn(() => true), onSetRole, onKick: vi.fn(), onBan: vi.fn(), onUnban: vi.fn() };
    const { rerender } = render(<ServerSettingsPage server={server} {...props} access={{ ...props.access, permissions: [...props.access.permissions] }} />);

    await user.click(screen.getByRole("button", { name: "Управление пользователями" }));
    expect(screen.getByRole("heading", { name: "Пользователи сервера" })).toBeInTheDocument();
    const creatorColumn = screen.getByRole("heading", { name: "Создатель" }).closest("section");
    const administratorsColumn = screen.getByRole("heading", { name: "Администраторы" }).closest("section");
    const membersColumn = screen.getByRole("heading", { name: "Пользователи" }).closest("section");
    expect(creatorColumn && within(creatorColumn).getByText("owner")).toBeInTheDocument();
    expect(creatorColumn && within(creatorColumn).getByText("Владелец")).toBeInTheDocument();
    expect(administratorsColumn && within(administratorsColumn).getByText("Администраторов пока нет.")).toBeInTheDocument();
    expect(membersColumn && within(membersColumn).getByText("member")).toBeInTheDocument();
    expect(membersColumn && within(membersColumn).getByText("Участник")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Назначить администратором" }));
    expect(onSetRole).toHaveBeenCalledWith("member", "administrator");

    const promotedServer: MockServer = { ...server, members: server.members.map((member) => member.id === "member" ? { ...member, serverRole: "administrator", role: "Администратор" } : member) };
    rerender(<ServerSettingsPage server={promotedServer} {...props} access={{ ...props.access, permissions: [...props.access.permissions] }} />);
    const updatedAdministrators = screen.getByRole("heading", { name: "Администраторы" }).closest("section");
    expect(updatedAdministrators && within(updatedAdministrators).getByText("member")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Снять роль администратора" })).toBeInTheDocument();
  });

  it("edits help pages from a script and saves the compiled spec", async () => {
    const user = userEvent.setup();
    const onSaveSettings = vi.fn(() => true);
    render(<ServerSettingsPage server={server} profile={profile} access={{ id: "owner", role: "owner", permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] }} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={onSaveSettings} onSetRole={vi.fn()} onKick={vi.fn()} onBan={vi.fn()} onUnban={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Кнопка справки" }));
    expect(screen.getByRole("heading", { name: "Кнопка справки" })).toBeInTheDocument();
    const source = screen.getByLabelText("Скрипт страниц");
    await user.clear(source);
    await user.type(source, 'api.page("rules", "Rules");\napi.text("No spam");\n');
    await user.click(screen.getByRole("switch", { name: "Показывать кнопку справки" }));
    await user.click(screen.getByRole("button", { name: "Сохранить страницы" }));
    expect(onSaveSettings).toHaveBeenCalledWith(expect.objectContaining({
      name: "Команда",
      helpPage: { enabled: true, gate: { enabled: false, pageId: null }, pages: [{ id: "rules", title: "Rules", audience: "always", blocks: [{ kind: "text", text: "No spam", size: "sm", weight: "normal", align: "left" }] }] },
    }));
  });

  it("saves a rules gate with required controls from the script", async () => {
    const user = userEvent.setup();
    const onSaveSettings = vi.fn(() => true);
    render(<ServerSettingsPage server={server} profile={profile} access={{ id: "owner", role: "owner", permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] }} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={onSaveSettings} onSetRole={vi.fn()} onKick={vi.fn()} onBan={vi.fn()} onUnban={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Кнопка справки" }));
    const source = screen.getByLabelText("Скрипт страниц");
    await user.clear(source);
    // Фигурные скобки user.type не переваривает (синтаксис клавиш), поэтому вставка напрямую.
    fireEvent.change(source, { target: { value: 'api.gate("rules");\napi.page("rules", "Rules", { audience: "pending" });\napi.checkbox("agree", "Agree");\napi.button("Accept", { accept: true, requires: ["agree"] });\n' } });
    await user.click(screen.getByRole("switch", { name: "Показывать кнопку справки" }));
    await user.click(screen.getByRole("button", { name: "Сохранить страницы" }));
    expect(onSaveSettings).toHaveBeenCalledWith(expect.objectContaining({
      helpPage: {
        enabled: true,
        gate: { enabled: true, pageId: "rules" },
        pages: [{
          id: "rules",
          title: "Rules",
          audience: "pending",
          blocks: [
            { kind: "checkbox", id: "agree", label: "Agree", defaultChecked: false },
            { kind: "button", label: "Accept", variant: "secondary", action: { kind: "accept" }, requires: ["agree"] },
          ],
        }],
      },
    }));
  });

  it("shows the Help Pages API reference link next to the save buttons on desktop", async () => {
    const user = userEvent.setup();
    window.openCord = { window: {} } as unknown as NonNullable<Window["openCord"]>;
    try {
      render(<ServerSettingsPage server={server} profile={profile} access={{ id: "owner", role: "owner", permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] }} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={vi.fn(() => true)} onSetRole={vi.fn()} onKick={vi.fn()} onBan={vi.fn()} onUnban={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Кнопка справки" }));
      const link = screen.getByRole("link", { name: /Справочник API/ });
      expect(link).toHaveAttribute("href", "https://uniquealexx.github.io/OpenCord/");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    } finally {
      delete (window as unknown as { openCord?: unknown }).openCord;
    }
  });

  it("manages custom roles and assigns them to members", async () => {
    const user = userEvent.setup();
    const onCreateRole = vi.fn();
    const onSetMemberRoles = vi.fn();
    const onUpdateRole = vi.fn();
    const onDeleteRole = vi.fn();
    const roleId = "11111111-1111-4111-8111-111111111111";
    const roleServer: MockServer = {
      ...server,
      roles: [{ id: roleId, name: "Moderator", color: "#ff0000", position: 5, permissions: ["KICK_MEMBERS", "VOICE_CONNECT", "VOICE_SPEAK"] }],
      members: server.members.map((member) => member.id === "member" ? { ...member, roleIds: [] as string[] } : member),
    };
    render(<ServerSettingsPage server={roleServer} profile={profile} access={{ id: "owner", role: "owner", permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] }} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={vi.fn(() => true)} onSetRole={vi.fn()} onSetMemberRoles={onSetMemberRoles} onCreateRole={onCreateRole} onUpdateRole={onUpdateRole} onDeleteRole={onDeleteRole} onKick={vi.fn()} onBan={vi.fn()} onUnban={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Роли" }));
    expect(screen.getByRole("heading", { name: "Кастомные роли" })).toBeInTheDocument();
    expect(screen.getByText("Выберите роль слева, чтобы посмотреть и изменить её.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Moderator/ })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Название роли"), "Helper");
    await user.click(screen.getByRole("button", { name: "Создать роль" }));
    expect(onCreateRole).toHaveBeenCalledWith("Helper", expect.any(String), expect.any(Number), expect.arrayContaining(["VOICE_CONNECT", "VOICE_SPEAK"]));

    // Назначение: раскрываем участника и переключаем роль.
    await user.click(screen.getByRole("button", { name: /^member/ }));
    await user.click(screen.getByRole("checkbox", { name: /Moderator/ }));
    expect(onSetMemberRoles).toHaveBeenCalledWith("member", [roleId]);

    // Инспектор: выбор роли открывает детали с группами прав и позицией.
    await user.click(screen.getByRole("button", { name: /Moderator.*Участников/ }));
    const inspector = screen.getByLabelText("Детали роли");
    expect(within(inspector).getByRole("checkbox", { name: /KICK_MEMBERS/ })).toBeInTheDocument();
    expect(screen.getByText("Роли и участники")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Поднять роль выше" })).toBeInTheDocument();
    // Без изменений кнопка сохранения заблокирована — явное состояние.
    expect(within(inspector).getByRole("button", { name: "Сохранить настройки" })).toBeDisabled();

    // Изменение прав помечает форму грязной и сохраняет патч.
    await user.click(within(inspector).getByRole("checkbox", { name: /KICK_MEMBERS/ }));
    expect(screen.getByText("Есть несохранённые изменения")).toBeInTheDocument();
    await user.click(within(inspector).getByRole("button", { name: "Сохранить настройки" }));
    expect(onUpdateRole).toHaveBeenCalledWith(roleId, expect.objectContaining({ name: "Moderator", permissions: expect.not.arrayContaining(["KICK_MEMBERS"]) }));
    expect(screen.getByText("Изменения роли отправлены на сервер")).toBeInTheDocument();

    // Danger zone: удаление требует подтверждения.
    await user.click(screen.getByRole("button", { name: "Удалить роль" }));
    const deleteConfirmation = screen.getByRole("alertdialog", { name: /Удалить роль/ });
    expect(onDeleteRole).not.toHaveBeenCalled();
    await user.click(within(deleteConfirmation).getByRole("button", { name: "Удалить роль" }));
    expect(onDeleteRole).toHaveBeenCalledWith(roleId);
  });

  it("shows the audit log with human-readable actions, actors, and targets", async () => {
    const user = userEvent.setup();
    const onLoadAudit = vi.fn();
    const entries = [
      { id: "11111111-1111-4111-8111-111111111111", at: "2026-08-18T10:00:00.000Z", actorId: "owner", action: "member.kick", targetId: "member", detail: null },
      { id: "22222222-2222-4222-8222-222222222222", at: "2026-08-18T09:00:00.000Z", actorId: "ghost", action: "channel.overwrites.set", targetId: "channel-1", detail: '{"roleId":"role-1"}' },
    ] as const;
    render(<ServerSettingsPage server={server} profile={profile} access={{ id: "owner", role: "owner", permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] }} auditEntries={[...entries]} auditHasMore auditLoading={false} onLoadAudit={onLoadAudit} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={vi.fn(() => true)} onSetRole={vi.fn()} onKick={vi.fn()} onBan={vi.fn()} onUnban={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Журнал аудита" }));
    expect(screen.getByRole("heading", { name: "Журнал модерации" })).toBeInTheDocument();
    expect(onLoadAudit).toHaveBeenCalledWith(null);
    // WHAT: локализованная метка вместо сырого имени события.
    expect(screen.getByText("Исключил участника")).toBeInTheDocument();
    expect(screen.getByText("Изменил права канала")).toBeInTheDocument();
    expect(screen.queryByText("member.kick")).not.toBeInTheDocument();
    // WHO: имя автора и fallback для неизвестного.
    expect(screen.getAllByText("owner").length).toBeGreaterThan(0);
    expect(screen.getByText("Неизвестный участник")).toBeInTheDocument();
    // WHOM: цель с типом и graceful fallback на сырой id.
    expect(screen.getByText("member · участник")).toBeInTheDocument();
    expect(screen.getByText("channel-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Загрузить ещё" }));
    expect(onLoadAudit).toHaveBeenLastCalledWith("2026-08-18T09:00:00.000Z");
  });

  it("hides the audit log without MANAGE_SERVER", async () => {
    const user = userEvent.setup();
    render(<ServerSettingsPage server={server} profile={profile} access={{ id: "member", role: "member", permissions: ["VOICE_CONNECT", "VOICE_SPEAK"] }} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={vi.fn(() => true)} onSetRole={vi.fn()} onKick={vi.fn()} onBan={vi.fn()} onUnban={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Журнал аудита" })).not.toBeInTheDocument();
    void user;
  });

  it("edits the welcome channel and template with a live preview", async () => {
    const user = userEvent.setup();
    const onSaveSettings = vi.fn(() => true);
    const welcomeServer: MockServer = {
      ...server,
      channels: [
        { id: "11111111-1111-4111-8111-111111111111", serverId: "server", name: "общий", kind: "text", description: "", participantLimit: null, slowmodeSeconds: 0 },
        { id: "22222222-2222-4222-8222-222222222222", serverId: "server", name: "Гостиная", kind: "voice", description: "", participantLimit: 25, slowmodeSeconds: 0 },
      ],
      welcomeChannelId: null,
      welcomeMessage: "Welcome to {server}, {user}!",
    };
    render(<ServerSettingsPage server={welcomeServer} profile={profile} access={{ id: "owner", role: "owner", permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] }} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={onSaveSettings} onSetRole={vi.fn()} onKick={vi.fn()} onBan={vi.fn()} onUnban={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Приветствие" }));
    expect(screen.getByRole("heading", { name: "Приветствие новичков" })).toBeInTheDocument();
    // Предпросмотр подставляет текущего пользователя и название сервера.
    expect(screen.getByText("Welcome to Команда, owner!")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Welcome-канал" }));
    await user.click(screen.getByRole("option", { name: "#общий" }));
    const template = screen.getByLabelText("Шаблон приветствия");
    await user.clear(template);
    // Фигурные скобки user.type не переваривает (синтаксис клавиш), поэтому вставка напрямую.
    fireEvent.change(template, { target: { value: "Привет, {user}!" } });
    expect(screen.getByText("Привет, owner!")).toBeInTheDocument();
    expect(screen.getByText("15/500")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Сохранить настройки" }));
    expect(onSaveSettings).toHaveBeenCalledWith(expect.objectContaining({
      name: "Команда",
      welcomeChannelId: "11111111-1111-4111-8111-111111111111",
      welcomeMessage: "Привет, {user}!",
    }));
  });

  it("hides the API reference link where external pages cannot be opened", async () => {
    const user = userEvent.setup();
    // Мобильный мост без desktop-поверхности window: уводить WebView нельзя.
    window.openCord = {} as unknown as NonNullable<Window["openCord"]>;
    try {
      render(<ServerSettingsPage server={server} profile={profile} access={{ id: "owner", role: "owner", permissions: ["MANAGE_SERVER", "MANAGE_ROLES", "KICK_MEMBERS"] }} onClose={vi.fn()} onAvatar={vi.fn()} onBanner={vi.fn()} onSaveSettings={vi.fn(() => true)} onSetRole={vi.fn()} onKick={vi.fn()} onBan={vi.fn()} onUnban={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Кнопка справки" }));
      expect(screen.queryByRole("link", { name: /Справочник API/ })).not.toBeInTheDocument();
    } finally {
      delete (window as unknown as { openCord?: unknown }).openCord;
    }
  });
});
