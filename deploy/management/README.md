# OpenCord Server Management (English)

This directory is the administrative entry point. Working files are deliberately separated across system directories: the application is located in `/opt/opencord`, protected settings are in `/etc/opencord` or `/opt/opencord/deploy/secrets`, and PostgreSQL manages its own storage. In Docker mode, the server secret files are accessible to root and to the fixed unprivileged UID of the OpenCord Server container.

Main command:

```bash
sudo opencordctl status
```

Available operations:

```bash
sudo opencordctl logs 200
sudo opencordctl restart
sudo opencordctl settings
sudo opencordctl backup
sudo opencordctl clear-messages DELETE-ALL-MESSAGES
sudo opencordctl check-update
sudo opencordctl update --channel stable
sudo opencordctl update --bundle-url https://releases.example/opencord-server.tar.gz --sha256 '<SHA256>'
sudo opencordctl uninstall
```

`check-update` and `update --channel stable` use the latest public stable GitHub Release `uniquealexx/OpenCord`. Before updating, the release manifest, protocol version, canonical HTTPS URL, size and SHA-256 of the server bundle are verified. If a new version is found, `update` creates a mandatory backup and runs the existing secure installer.

Manual `--bundle-url` and `--bundle-file` are retained for disaster recovery. For them, the SHA-256 must be obtained from a separate trusted source.

Similar short scripts are located in `scripts/`. The `backup` command creates a pair of files in `backups/`: PostgreSQL in `pg_dump` custom format and a `.attachments.tar` archive with attachments. Both files are needed for full recovery.

The `update` command accepts a release bundle only over HTTPS or from an explicitly specified local file and requires the expected SHA-256 sum. After verifying the archive, it creates a mandatory backup and runs the idempotent installer of the current mode. PostgreSQL and attachments are preserved. Until the official release channel is published, the URL and SHA-256 must be taken from a specific trusted release publication; the command intentionally does not download "latest" from an unfixed source.

The `clear-messages` command stops only OpenCord Server, creates a mandatory backup of the database, deletes the entire history from the messages table and starts the server again. Channels, users, roles and settings are not deleted. To protect against accidental execution, the exact phrase `DELETE-ALL-MESSAGES` is required.

A regular `uninstall` stops and disables OpenCord, but preserves the application, settings, database and backups for recovery. Full removal is irreversible and requires the exact command:

```bash
sudo opencordctl uninstall --purge-data DELETE-OPENCORD-DATA
```

Full removal also destroys attachments and local backups from `/home/opencord/backups`. Before running it, copy the needed `.dump` and `.attachments.tar` files to another computer or medium.

The network mode, domain and TLS are currently changed by redeploying from OpenCord Client: this path re-verifies the environment and performs a healthcheck before completing the update.

---

# Управление OpenCord Server (Русский)

Эта директория является административной точкой входа. Рабочие файлы намеренно разделены по системным каталогам: приложение находится в `/opt/opencord`, защищённые настройки — в `/etc/opencord` или `/opt/opencord/deploy/secrets`, а PostgreSQL управляет собственным хранилищем. В Docker-режиме серверные secret-файлы доступны root и фиксированному непривилегированному UID контейнера OpenCord Server.

Основная команда:

```bash
sudo opencordctl status
```

Доступные операции:

```bash
sudo opencordctl logs 200
sudo opencordctl restart
sudo opencordctl settings
sudo opencordctl backup
sudo opencordctl clear-messages DELETE-ALL-MESSAGES
sudo opencordctl check-update
sudo opencordctl update --channel stable
sudo opencordctl update --bundle-url https://releases.example/opencord-server.tar.gz --sha256 '<SHA256>'
sudo opencordctl uninstall
```

`check-update` и `update --channel stable` используют последний публичный stable GitHub Release
`uniquealexx/OpenCord`. Перед обновлением проверяются release manifest, версия протокола,
канонический HTTPS URL, размер и SHA-256 server bundle. Если новая версия найдена, `update`
создаёт обязательную резервную копию и запускает существующий безопасный установщик.

Ручные `--bundle-url` и `--bundle-file` сохранены для аварийного восстановления. Для них
SHA-256 нужно получить из отдельного доверенного источника.

Аналогичные короткие сценарии находятся в `scripts/`. Команда `backup` создаёт в `backups/` пару файлов: PostgreSQL в custom-формате `pg_dump` и архив `.attachments.tar` с вложениями. Оба файла нужны для полного восстановления.

Команда `update` принимает release bundle только по HTTPS либо из явно указанного локального файла и требует ожидаемую SHA-256 сумму. После проверки архива она создаёт обязательную резервную копию и запускает идемпотентный установщик текущего режима. PostgreSQL и вложения сохраняются. Пока официальный канал релизов не опубликован, URL и SHA-256 должны браться из конкретной доверенной публикации релиза; команда намеренно не скачивает «latest» из незафиксированного источника.

Команда `clear-messages` останавливает только OpenCord Server, создаёт обязательную резервную копию базы, удаляет всю историю из таблицы сообщений и запускает сервер снова. Каналы, пользователи, роли и настройки не удаляются. Для защиты от случайного запуска требуется точная фраза `DELETE-ALL-MESSAGES`.

Обычный `uninstall` останавливает и отключает OpenCord, но сохраняет приложение, настройки, базу и резервные копии для восстановления. Полное удаление необратимо и требует точной команды:

```bash
sudo opencordctl uninstall --purge-data DELETE-OPENCORD-DATA
```

Полное удаление уничтожает также вложения и локальные резервные копии из `/home/opencord/backups`. Перед его запуском скопируйте нужные `.dump` и `.attachments.tar` на другой компьютер или носитель.

Сетевой режим, домен и TLS пока изменяются повторным развёртыванием из OpenCord Client: такой путь повторно проверяет окружение и выполняет healthcheck перед завершением обновления.

---

# OpenCord Server 管理 (中文)

此目录是管理入口。工作文件被有意分散在系统目录中：应用程序位于 `/opt/opencord`，受保护的设置位于 `/etc/opencord` 或 `/opt/opencord/deploy/secrets`，而 PostgreSQL 管理自己的存储。在 Docker 模式下，服务器 secret 文件可供 root 以及 OpenCord Server 容器的固定非特权 UID 访问。

主要命令：

```bash
sudo opencordctl status
```

可用操作：

```bash
sudo opencordctl logs 200
sudo opencordctl restart
sudo opencordctl settings
sudo opencordctl backup
sudo opencordctl clear-messages DELETE-ALL-MESSAGES
sudo opencordctl check-update
sudo opencordctl update --channel stable
sudo opencordctl update --bundle-url https://releases.example/opencord-server.tar.gz --sha256 '<SHA256>'
sudo opencordctl uninstall
```

`check-update` 和 `update --channel stable` 使用最新的公开 stable GitHub Release `uniquealexx/OpenCord`。更新之前会校验 release manifest、协议版本、规范 HTTPS URL、大小和 server bundle 的 SHA-256。如果发现新版本，`update` 会创建强制备份并运行现有的安全安装程序。

手动方式 `--bundle-url` 和 `--bundle-file` 保留用于灾难恢复。对于它们，SHA-256 必须从单独的可信来源获取。

类似的简短脚本位于 `scripts/`。`backup` 命令在 `backups/` 中创建一对文件：`pg_dump` custom 格式的 PostgreSQL，以及包含附件的 `.attachments.tar` 归档。这两个文件都是完整恢复所必需的。

`update` 命令只通过 HTTPS 或从显式指定的本地文件接受 release bundle，并要求预期的 SHA-256 校验和。在验证归档之后，它会创建强制备份并运行当前模式的幂等安装程序。PostgreSQL 和附件会被保留。在官方发布渠道发布之前，URL 和 SHA-256 必须取自特定的可信发布公告；该命令有意不从来源未固定的位置下载「latest」。

`clear-messages` 命令只停止 OpenCord Server，创建数据库的强制备份，删除消息表中的全部历史记录，并重新启动服务器。频道、用户、角色和设置不会被删除。为防止意外执行，需要精确的短语 `DELETE-ALL-MESSAGES`。

常规 `uninstall` 会停止并禁用 OpenCord，但会保留应用程序、设置、数据库和备份以便恢复。完全卸载是不可逆的，并且需要精确的命令：

```bash
sudo opencordctl uninstall --purge-data DELETE-OPENCORD-DATA
```

完全卸载还会销毁附件以及 `/home/opencord/backups` 中的本地备份。在运行它之前，请将所需的 `.dump` 和 `.attachments.tar` 文件复制到另一台计算机或存储介质。

网络模式、域名和 TLS 目前通过从 OpenCord Client 重新部署来更改：此方式会重新检查环境，并在更新完成之前执行 healthcheck。
