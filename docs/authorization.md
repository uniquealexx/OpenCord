# OpenCord Server Roles and Permissions (English)

## First-version model

Permissions are determined by the server based on the authenticated Ed25519 identity. The client only displays the available actions: a hidden or manually enabled button does not allow bypassing the server-side check.

Three roles exist on the server:

- `owner` — the instance owner, can create channels, assign or remove the administrator role, and delete the server from the clients of all members;
- `administrator` — an administrator, can create text and voice channels and remove ordinary members;
- `member` — an ordinary member without administrative permissions.

The owner role cannot be transferred or removed through the current protocol. This is an intentional first-version limitation: a separate secure ownership-transfer scenario must account for key loss and confirmation by both identities.

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
- `server.delete` 需要 `DELETE_SERVER`，并创建永久的删除标记。

通过客户端删除不会立即清除 VPS 上的历史记录：它会阻止进一步的连接，并通知客户端删除本地记录。应用程序和数据的物理删除由 VPS 所有者通过明确确认的 `opencordctl uninstall --purge-data` 执行。

更改后，服务器会向每个连接发送个性化的 snapshot。在客户端中，所有者和管理员会在成员列表中标记，频道控件仅在具有相应权限时才会显示。
