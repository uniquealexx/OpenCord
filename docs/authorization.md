# OpenCord Server Roles and Permissions (English)

## First-version model

Permissions are determined by the server based on the authenticated Ed25519 identity. The client only displays the available actions: a hidden or manually enabled button does not allow bypassing the server-side check.

Three roles exist on the server:

- `owner` — the instance owner, can create channels, assign or remove the administrator role, and delete the server from the clients of all members;
- `administrator` — an administrator, can create text and voice channels and remove ordinary members;
- `member` — an ordinary member without administrative permissions.

The owner role cannot be transferred or removed through the current protocol. This is an intentional first-version limitation: a separate secure ownership-transfer scenario must account for key loss and confirmation by both identities.

## Custom roles (protocol v48)

On top of the three legacy roles, the server keeps a `server_roles` table (migration `036_custom_roles`): each row has an `id`, a `name` (2-32), an optional `color` (#rrggbb), a `position` (0-9999) and a `permissions` subset of the existing 9 values — no new permissions were introduced. Two rows are seeded to match the previous behavior: `administrator` (position 10) and `member` (position 0).

- The `owner` stays outside the table: it is bound to the deploy public key, cannot be transferred or removed, always holds all permissions and sits on top of the hierarchy.
- A member's effective permissions are the union of the assigned roles; the hierarchy top is the max position. The legacy single `role` field keeps working and is derived from the assignments (seeded administrator present means `administrator`, otherwise `member`), so old clients and snapshots keep parsing.
- Moderator actions (`member.kick`, `member.ban`, `member.role.set`, `member.roles.set`, `chat.mute.set`, `voice.member.disconnect`, `voice.member.mute`) require a strictly higher top position than the target. The owner is exempt; nobody can touch the owner, change their own roles with these commands, or grant a position above their own top.
- Role management events (`role.create`, `role.update`, `role.delete`, `role.list`, `member.roles.set`) require `MANAGE_ROLES`. The snapshot carries the `roles` list and every member carries `roleIds`; `currentUser.permissions` is the computed union.

## Channel permission overwrites (protocol v49)

Per-channel overwrites live in the `channel_overwrites` table (migration `037_channel_overwrites`): one row per `(channel_id, role_id)` with `allow`/`deny` arrays drawn from the existing 9 permissions — no new permissions, roles only (no member-targets). The effective channel permission is `(union role permissions ∪ union allow) − union deny`: per-channel allow overrides role permissions, deny overrides allow, and a deny from any of the member's roles wins over an allow from another role (the Discord rule). The owner is exempt from overwrites and always holds every permission in every channel.

Because no dedicated view/send permissions exist, v49 reuses the voice pair as channel proxies: effective `VOICE_CONNECT` in a channel means visibility (history, search, pinned list, attachment download, voice join), effective `VOICE_SPEAK` means writing (chat.send/pm/apm, message.update, message.react, typing). Moderation inside a channel (`message.delete` of others' messages, `message.bulkDelete`, pin/unpin, `channel.update`/`channel.delete`, slowmode) requires the matching effective permission (`MANAGE_MESSAGES`/`MANAGE_CHANNELS`) in that channel. A channel without effective `VOICE_CONNECT` is hidden: it is filtered out of `server.snapshot.channels` for that user, and a direct read answers `FORBIDDEN`.

`channel.overwrites.set` requires global `MANAGE_CHANNELS` plus the hierarchy check: the target role's position must not exceed the actor's own top (`canGrantPosition`); the owner is exempt. The server broadcasts `channel.overwrites.updated` plus a fresh personalized snapshot, so hidden channels disappear immediately. `server.snapshot` carries `channelOverwrites` only for holders of `MANAGE_CHANNELS`; everyone else receives an empty list.

## Moderator audit log (protocol v50)

Moderator actions are recorded in the append-only `audit_log` table (migration `038_audit_log`): each row has an `id`, an `at` timestamp, an `actor_id`, an `action` reusing an existing event name (`member.kick`/`member.ban`/`member.unban`, `member.role.set`/`member.roles.set`, `role.create`/`role.update`/`role.delete`, `channel.create`/`channel.update`/`channel.delete`, `channel.overwrites.set`, `channel.slowmode.set`, `message.delete`/`message.bulkDelete`, `server.settings.update`/`server.avatar.update`/`server.banner.update`), a nullable `target_id`, and a nullable `detail` (JSON/text, 2000 chars max). No new permissions were introduced. Rows are written best-effort inside the existing handlers — a log error never fails the action — and the table is capped at the latest 1000 rows (pruned on insert).

Reading requires `MANAGE_SERVER` (the owner plus whoever holds it via custom roles): `audit.list` takes a `limit` (1–100) and a nullable `before` cursor and answers `audit.result` with newest-first `entries` plus `hasMore`. Members without `MANAGE_SERVER` receive `FORBIDDEN`.

## How the owner is determined

During deployment, the Electron client obtains the public key of the current local identity and passes it to the installer as `--owner-public-key`. The private key never leaves the user's computer.

The Docker deployment stores the public key in `/opt/opencord/deploy/secrets/owner_public_key` and mounts it into the container read-only. The native deployment stores it in `/etc/opencord/owner_public_key`. On the first successful authentication, the matching identity receives the `owner` role. Re-running the installer does not replace an already saved owner key.

If the creator's key is lost, the local-identity reset button does not restore owner rights. Until a verified recovery procedure is implemented, a backup of the original identity or manual database administration by the VPS owner will be required.

## Local development

The `pnpm dev` command starts the server package with `ALLOW_INSECURE_FIRST_USER_OWNER=true`. Therefore, the first authenticated user becomes the owner of an empty local PGlite database. This mode is intended for development only and is not enabled in the production `start` command, Docker Compose, or the native systemd service.

## Protocol

The server snapshot contains the role and the computed permissions of the current user, and each member has their own public role. Mutating commands:

- `channel.create` requires `MANAGE_CHANNELS`;
- `member.role.set` requires `MANAGE_ROLES` and accepts only `administrator` or `member`.
- `member.kick` requires `KICK_MEMBERS`: the owner can remove an administrator or a member, an administrator can remove only an ordinary member; one cannot remove oneself or the owner.
- `member.ban` and `member.unban` require `KICK_MEMBERS` and use the same role hierarchy. A ban is stored against the user's cryptographic identity, may expire after a protocol-approved duration or remain permanent, and is checked before membership registration.
- `help.accept` records acceptance of the rules gate: while the gate is on and the member has not accepted, writing (`chat.send`/`chat.pm`/`chat.apm`, `message.update`, `message.react`, `voice.join`) is answered with `ACCEPT_REQUIRED`; reading stays open. The flag lives on the membership row and is reset by leaving. Settings stay editable, so a misconfigured gate never locks the owner out.
- `server.delete` requires `DELETE_SERVER` and creates a permanent deletion marker.

Deletion through the client does not immediately erase the history from the VPS: it blocks further connections and tells the clients to delete the local record. Physical deletion of the application and data is performed by the VPS owner through an explicitly confirmed `opencordctl uninstall --purge-data`.

After a change, the server sends each connection a personalized snapshot. In the client, the owner and administrators are marked in the member list, and channel controls are shown only when the corresponding permission is present.

---
# Роли и права OpenCord Server (Русский)

## Модель первой версии

Права определяет сервер по аутентифицированной Ed25519-идентичности. Клиент лишь показывает доступные действия: скрытая или вручную включённая кнопка не позволяет обойти серверную проверку.

На сервере существуют три роли:

- `owner` — владелец экземпляра, может создавать каналы, назначать или снимать роль администратора и удалить сервер из клиентов всех участников;
- `administrator` — администратор, может создавать текстовые и голосовые каналы и исключать обычных участников;
- `member` — обычный участник без административных прав.

Роль владельца нельзя передать или снять через текущий протокол. Это намеренное ограничение первой версии: отдельный безопасный сценарий передачи владения должен учитывать потерю ключа и подтверждение обеими идентичностями.

## Кастомные роли (протокол v48)

Поверх трёх legacy-ролей сервер держит таблицу `server_roles` (миграция `036_custom_roles`): у каждой строки есть `id`, `name` (2-32), необязательный `color` (#rrggbb), `position` (0-9999) и подмножество `permissions` из существующих 9 значений — новых прав не вводилось. Два сида повторяют прежнее поведение: `administrator` (позиция 10) и `member` (позиция 0).

- `owner` остаётся вне таблицы: привязан к ключу развёртывания, не передаётся и не снимается, всегда имеет все права и стоит на вершине иерархии.
- Эффективные права участника — объединение назначенных ролей; вершина иерархии — max position. Legacy-поле `role` продолжает работать и выводится из назначений (есть сид administrator — `administrator`, иначе `member`), поэтому старые клиенты и snapshot продолжают разбираться.
- Модерационные действия (`member.kick`, `member.ban`, `member.role.set`, `member.roles.set`, `chat.mute.set`, `voice.member.disconnect`, `voice.member.mute`) требуют строго более высокой вершины, чем у цели. Владелец вне иерархии; владельца трогать нельзя, собственные роли этими командами менять нельзя, выше собственной вершины выдавать нельзя.
- События управления ролями (`role.create`, `role.update`, `role.delete`, `role.list`, `member.roles.set`) требуют `MANAGE_ROLES`. Snapshot несёт список `roles`, каждый участник — `roleIds`; `currentUser.permissions` — вычисленное объединение.

## Переопределения прав канала (протокол v49)

Переопределения живут в таблице `channel_overwrites` (миграция `037_channel_overwrites`): одна строка на `(channel_id, role_id)` с массивами `allow`/`deny` из существующих 9 прав — новых прав нет, только роли (member-targets нет). Эффективное право в канале: `(union прав ролей ∪ union allow) − union deny`: allow канала перекрывает права ролей, deny перекрывает allow, а запрет любой из ролей участника побеждает разрешение другой роли (правило Discord). Владелец вне overwrites и всегда имеет все права в каждом канале.

Отдельных прав просмотра/отправки нет, поэтому v49 переиспользует голосовую пару как прокси канала: эффективный `VOICE_CONNECT` в канале означает видимость (история, поиск, закрепы, скачивание вложений, вход в голос), эффективный `VOICE_SPEAK` — писанину (chat.send/pm/apm, message.update, message.react, набор текста). Модерация внутри канала (удаление чужих сообщений, bulkDelete, пины, `channel.update`/`channel.delete`, slowmode) требует совпадающее эффективное право (`MANAGE_MESSAGES`/`MANAGE_CHANNELS`) в этом канале. Канал без эффективного `VOICE_CONNECT` скрыт: он вырезается из `server.snapshot.channels` для этого пользователя, а прямое чтение отвечает `FORBIDDEN`.

`channel.overwrites.set` требует глобальное `MANAGE_CHANNELS` плюс проверку иерархии: позиция целевой роли не выше собственной вершины (`canGrantPosition`); владелец вне иерархии. Сервер рассылает `channel.overwrites.updated` плюс свежий персонализированный snapshot, поэтому скрытые каналы исчезают сразу. `server.snapshot` несёт `channelOverwrites` только держателям `MANAGE_CHANNELS`; остальные получают пустой список.

## Журнал модерации (протокол v50)

Модерационные действия записываются в append-only таблицу `audit_log` (миграция `038_audit_log`): у каждой строки есть `id`, метка `at`, `actor_id`, `action` с переиспользованием существующего имени события (`member.kick`/`member.ban`/`member.unban`, `member.role.set`/`member.roles.set`, `role.create`/`role.update`/`role.delete`, `channel.create`/`channel.update`/`channel.delete`, `channel.overwrites.set`, `channel.slowmode.set`, `message.delete`/`message.bulkDelete`, `server.settings.update`/`server.avatar.update`/`server.banner.update`), nullable `target_id` и nullable `detail` (JSON/текст до 2000 символов). Новых прав не вводилось. Строки пишутся best-effort внутри существующих обработчиков — ошибка лога никогда не роняет действие — а таблица ограничена последними 1000 строками (prune на insert).

Чтение требует `MANAGE_SERVER` (владелец и держатели права через кастомные роли): `audit.list` принимает `limit` (1–100) и nullable-курсор `before`, отвечает `audit.result` с `entries` от новых к старым плюс `hasMore`. Участники без `MANAGE_SERVER` получают `FORBIDDEN`.

## Как определяется владелец

При развёртывании Electron-клиент получает публичный ключ текущей локальной идентичности и передаёт его установщику как `--owner-public-key`. Приватный ключ не покидает компьютер пользователя.

Docker-развёртывание сохраняет публичный ключ в `/opt/opencord/deploy/secrets/owner_public_key` и подключает его в контейнер только для чтения. Нативное развёртывание хранит его в `/etc/opencord/owner_public_key`. При первой успешной аутентификации совпадающая идентичность получает роль `owner`. Повторный запуск установщика не заменяет уже сохранённый ключ владельца.

Если ключ создателя потерян, кнопка сброса локальной идентичности не возвращает права владельца. До реализации проверенной процедуры восстановления потребуется резервная копия исходной идентичности либо ручное администрирование базы владельцем VPS.

## Локальная разработка

Команда `pnpm dev` запускает server-пакет с `ALLOW_INSECURE_FIRST_USER_OWNER=true`. Поэтому владельцем пустой локальной PGlite-базы становится первый аутентифицированный пользователь. Этот режим предназначен только для разработки и не включён в production-команде `start`, Docker Compose или нативной systemd-службе.

## Протокол

Snapshot сервера содержит роль и вычисленные разрешения текущего пользователя, а каждый участник — свою публичную роль. Изменяющие команды:

- `channel.create` требует `MANAGE_CHANNELS`;
- `member.role.set` требует `MANAGE_ROLES` и принимает только `administrator` или `member`.
- `member.kick` требует `KICK_MEMBERS`: владелец может исключить администратора или участника, администратор — только обычного участника; себя и владельца исключать нельзя.
- `member.ban` и `member.unban` требуют `KICK_MEMBERS` и соблюдают ту же иерархию ролей. Бан сохраняется для криптографической идентичности, может истечь через разрешённый протоколом срок либо быть перманентным и проверяется до регистрации членства.
- `help.accept` фиксирует принятие гейта правил: пока гейт включён, а участник не принял правила, писанина (`chat.send`/`chat.pm`/`chat.apm`, `message.update`, `message.react`, `voice.join`) отклоняется с `ACCEPT_REQUIRED`; чтение открыто. Флаг живёт на строке членства и сбрасывается выходом. Настройки остаются редактируемыми, поэтому битый гейт никогда не запирает владельца.
- `server.delete` требует `DELETE_SERVER` и создаёт постоянную отметку удаления.

Удаление через клиент не стирает историю с VPS немедленно: оно блокирует дальнейшие подключения и сообщает клиентам удалить локальную запись. Физическое удаление приложения и данных выполняется владельцем VPS через явно подтверждённый `opencordctl uninstall --purge-data`.

После изменения сервер рассылает каждому подключению персонализированный snapshot. В клиенте владелец и администраторы отмечаются в списке участников, а элементы управления каналами показываются только при наличии соответствующего разрешения.

---
# OpenCord Server 角色与权限 (中文)

## 第一版模型

权限由服务器根据经过身份验证的 Ed25519 身份确定。客户端仅显示可用的操作：被隐藏或手动启用的按钮无法绕过服务器端的验证。

服务器上存在三种角色：

- `owner` — 实例所有者，可以创建频道、授予或撤销管理员角色，并从所有成员的客户端中删除该服务器；
- `administrator` — 管理员，可以创建文本和语音频道，并移出普通成员；
- `member` — 没有管理权限的普通成员。

所有者角色无法通过当前协议转让或撤销。这是第一版有意为之的限制：单独的安全所有权转让方案必须考虑密钥丢失以及双方身份的共同确认。

## 自定义角色（协议 v48）

在三种旧角色之上，服务器维护 `server_roles` 表（迁移 `036_custom_roles`）：每行包含 `id`、`name`（2–32 字符）、可选 `color`（#rrggbb）、`position`（0–9999）和现有 9 个权限值的子集 `permissions`——未引入新权限。两个种子行与此前行为一致：`administrator`（位置 10）和 `member`（位置 0）。

- `owner` 保留在表外：绑定部署公钥，不可转让或撤销，始终拥有全部权限并位于层级顶端。
- 成员的有效权限为已分配角色的并集；层级顶点取最大位置。旧版单个 `role` 字段继续有效，并由分配关系推导（含 administrator 种子即为 `administrator`，否则为 `member`），因此旧客户端和 snapshot 仍可解析。
- 管理操作（`member.kick`、`member.ban`、`member.role.set`、`member.roles.set`、`chat.mute.set`、`voice.member.disconnect`、`voice.member.mute`）要求自身最高位置严格高于目标。所有者不受层级限制；无人可操作所有者，不能用这些命令改自己的角色，也不能授予高于自身最高位置的角色。
- 角色管理事件（`role.create`、`role.update`、`role.delete`、`role.list`、`member.roles.set`）需要 `MANAGE_ROLES`。snapshot 携带 `roles` 列表，每个成员携带 `roleIds`；`currentUser.permissions` 为计算出的并集。

## 频道权限覆盖（协议 v49）

覆盖保存在 `channel_overwrites` 表（迁移 `037_channel_overwrites`）中：每个 `(channel_id, role_id)` 一行，`allow`/`deny` 数组取自现有的 9 个权限——不新增权限，仅针对角色（无成员目标）。频道有效权限为 `(角色权限并集 ∪ allow 并集) − deny 并集`：频道 allow 覆盖角色权限，deny 覆盖 allow；成员任一角色的 deny 优先于另一角色的 allow（Discord 规则）。所有者不受覆盖限制，在每个频道始终拥有全部权限。

由于没有独立的查看/发言权限，v49 复用语音权限对作为频道代理：频道内有效的 `VOICE_CONNECT` 表示可见（历史、搜索、置顶、附件下载、语音加入），有效的 `VOICE_SPEAK` 表示可发言（chat.send/pm/apm、message.update、message.react、输入状态）。频道内管理操作（删除他人消息、bulkDelete、置顶、`channel.update`/`channel.delete`、slowmode）要求该频道内有效的对应权限（`MANAGE_MESSAGES`/`MANAGE_CHANNELS`）。没有有效 `VOICE_CONNECT` 的频道会被隐藏：从该用户的 `server.snapshot.channels` 中过滤，直接读取返回 `FORBIDDEN`。

`channel.overwrites.set` 需要全局 `MANAGE_CHANNELS` 及层级校验：目标角色位置不得高于操作者自身顶点（`canGrantPosition`）；所有者不受层级限制。服务器广播 `channel.overwrites.updated` 并附带全新的个性化 snapshot，因此被隐藏的频道会立即消失。`server.snapshot` 仅向持有 `MANAGE_CHANNELS` 的用户携带 `channelOverwrites`；其他人收到空列表。

## 管理审计日志（协议 v50）

管理操作记录在只追加的 `audit_log` 表中（迁移 `038_audit_log`）：每行包含 `id`、`at` 时间戳、`actor_id`、`action`（复用现有事件名：`member.kick`/`member.ban`/`member.unban`、`member.role.set`/`member.roles.set`、`role.create`/`role.update`/`role.delete`、`channel.create`/`channel.update`/`channel.delete`、`channel.overwrites.set`、`channel.slowmode.set`、`message.delete`/`message.bulkDelete`、`server.settings.update`/`server.avatar.update`/`server.banner.update`）、可空 `target_id` 和可空 `detail`（JSON/文本，最多 2000 字符）。未引入新权限。记录在现有处理器内以 best-effort 写入——日志错误绝不导致主操作失败——表仅保留最近 1000 条（写入时裁剪）。

读取需要 `MANAGE_SERVER`（所有者及通过自定义角色持有该权限者）：`audit.list` 接受 `limit`（1–100）和可空游标 `before`，以 `audit.result` 应答（`entries` 按时间倒序及 `hasMore`）。没有 `MANAGE_SERVER` 的成员会收到 `FORBIDDEN`。

## 如何确定所有者

在部署期间，Electron 客户端获取当前本地身份的公钥，并将其作为 `--owner-public-key` 传递给安装程序。私钥不会离开用户的计算机。

Docker 部署将公钥保存在 `/opt/opencord/deploy/secrets/owner_public_key` 中，并以只读方式挂载到容器内。原生部署将其存储在 `/etc/opencord/owner_public_key` 中。首次成功验证身份时，匹配的身份将获得 `owner` 角色。重新运行安装程序不会替换已保存的所有者密钥。

如果创建者的密钥丢失，本地身份重置按钮不会恢复所有者权限。在实现经过验证的恢复程序之前，将需要原始身份的备份，或者由 VPS 所有者手动管理数据库。

## 本地开发

命令 `pnpm dev` 以 `ALLOW_INSECURE_FIRST_USER_OWNER=true` 启动 server 包。因此，空的本地 PGlite 数据库的第一个通过身份验证的用户将成为所有者。此模式仅用于开发，未在 production 命令 `start`、Docker Compose 或原生 systemd 服务中启用。

## 协议

服务器 snapshot 包含当前用户的角色和计算出的权限，每个成员都有各自的公开角色。会改变状态的命令：

- `channel.create` 需要 `MANAGE_CHANNELS`；
- `member.role.set` 需要 `MANAGE_ROLES`，并且只接受 `administrator` 或 `member`。
- `member.kick` 需要 `KICK_MEMBERS`：所有者可以移出管理员或成员，管理员只能移出普通成员；不能移出自己或所有者。
- `member.ban` 和 `member.unban` 需要 `KICK_MEMBERS` 并遵循相同的角色层级。封禁与用户的加密身份绑定，可在协议允许的期限后到期或保持永久，并在注册成员资格之前检查。
- `help.accept` 记录规则门禁的接受状态：在门禁开启且成员尚未接受时，发言（`chat.send`/`chat.pm`/`chat.apm`、`message.update`、`message.react`、`voice.join`）会被以 `ACCEPT_REQUIRED` 拒绝；阅读保持开放。该标志保存在成员资格行，退出即清零。设置始终可编辑，因此配置错误的门禁永远不会把所有者锁在外面。
- `server.delete` 需要 `DELETE_SERVER`，并创建永久的删除标记。

通过客户端删除不会立即清除 VPS 上的历史记录：它会阻止进一步的连接，并通知客户端删除本地记录。应用程序和数据的物理删除由 VPS 所有者通过明确确认的 `opencordctl uninstall --purge-data` 执行。

更改后，服务器会向每个连接发送个性化的 snapshot。在客户端中，所有者和管理员会在成员列表中标记，频道控件仅在具有相应权限时才会显示。
