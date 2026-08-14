# OpenCord Server Deployment (English)

## Current implementation boundaries

The `deploy/` directory contains two production installation methods for Ubuntu 22.04/24.04 LTS. The recommended option uses Node.js 24.18.0, PostgreSQL 18.4, and Caddy 2.11.4 containers. The native option installs the pinned Node.js 24.18.0, PostgreSQL from the Ubuntu repository, the official Caddy package, and an OpenCord systemd service. The Electron client verifies the environment, delivers a limited bundle over SSH, and runs the chosen installer. In addition, `deploy/scripts/bootstrap.sh` lets you deploy the server with a single command directly in the VPS console without SSH: the script itself downloads the pinned release bundle and invokes the chosen installer.

Local development still uses PGlite and does not require Docker.

## VPS requirements

- Ubuntu Server 22.04 or 24.04 LTS;
- root access via `sudo`;
- a DNS A/AAAA record for the domain pointing to the VPS;
- free inbound TCP ports 80 and 443;
- UDP 443 for HTTP/3 is desirable but not required for WebSocket;
- access to the required official apt repositories and the image registry for Docker mode.

Before installation, check the firewall settings at your hosting provider. Docker has specific interactions with `ufw`: published container ports can bypass some of its rules. A local `ufw` rule should not be considered the only network barrier.

### Domainless mode for WSL and local tests

The domain and ACME email can be left empty. In that case the wizard shows a warning and requires explicit confirmation, after which it runs the installer with `--insecure`. The server listens on `0.0.0.0:3210`, Caddy and TLS are not configured, and the client connects to `http://<SSH-адрес>:3210`.

This mode does not protect messages, the profile, session tokens, and other traffic from interception or modification on the network. It is intended only for WSL, a test virtual machine, or another trusted local environment. Do not expose port 3210 to the internet. For a real VPS, use a domain and HTTPS.

## Installation

There are two equally valid deployment paths:

- **from OpenCord Client** — the client connects to the VPS over SSH and performs the installation (SSH access is required);
- **manually in the VPS console with one command** — the command runs in the VPS console or the provider's web console (SSH is not needed).

Both paths use the same idempotent installers, preserve data identically on re-run, and require the same inputs: the owner's public key, the server name, a domain with an email, or an explicitly confirmed insecure mode.

### Manually in the VPS console with one command

The bootstrap script downloads the pinned release bundle from GitHub Releases, asks questions, and runs the same installer as the client wizard. The script is pinned to a specific release; in the command below, substitute the current version (the URL is updated in this documentation on every release):

```bash
curl -fsSL https://raw.githubusercontent.com/uniquealexx/OpenCord/v<ВЕРСИЯ>/deploy/scripts/bootstrap.sh -o /tmp/opencord-bootstrap.sh && sudo bash /tmp/opencord-bootstrap.sh
```

An alternative URL from the server release:

```bash
curl -fsSL https://github.com/uniquealexx/OpenCord/releases/download/server-v<ВЕРСИЯ>/bootstrap.sh -o /tmp/opencord-bootstrap.sh && sudo bash /tmp/opencord-bootstrap.sh
```

The wizard asks questions only when run in a terminal (`sudo bash /tmp/opencord-bootstrap.sh`); when run through a pipe, all parameters are passed via flags. The interactive wizard asks:

1. the installation method — Docker (recommended) or native installation. If Docker Engine and the Compose plugin are missing, the installer adds the official Docker apt repository and installs them; the `curl | sh` convenience script is not used;
2. the domain and ACME email for TLS, or the insecure mode without a domain — with an explicit warning and mandatory confirmation by typing «да»;
3. in insecure mode — the address the client will use to connect to the server (the external IPv4 is suggested by default);
4. the server name;
5. the owner's public key — copied by the «Скопировать публичный ключ» button in the client settings («Идентичность и приватность»). Only the identity with this public key becomes the server owner; the private key is not transferred to the VPS and is never requested anywhere.

For automation, the questions can be skipped with flags:

```bash
curl -fsSL https://raw.githubusercontent.com/uniquealexx/OpenCord/v<ВЕРСИЯ>/deploy/scripts/bootstrap.sh | sudo bash -s -- \
  --mode docker --domain chat.example.com --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' --server-name 'Команда OpenCord'
```

Only for a trusted local test without TLS:

```bash
curl -fsSL https://raw.githubusercontent.com/uniquealexx/OpenCord/v<ВЕРСИЯ>/deploy/scripts/bootstrap.sh | sudo bash -s -- \
  --mode native --insecure --yes --public-host <адрес> \
  --owner-public-key '<публичный ключ OpenCord>' --server-name 'Команда OpenCord'
```

Bootstrap checks Ubuntu 22.04/24.04 x64, downloads the exact-version `release-manifest.json` from the canonical URL, verifies the manifest fields, the actual size and SHA-256 of the bundle, and the safety of the tar entries before unpacking. No compilation runs on the VPS, and Node.js is not required before installation. Trust is based on HTTPS and an immutable Git tag on GitHub; a digital signature is not implemented yet (see [release-manifest.md](./release-manifest.md)), so run bootstrap only using the command from this documentation or the URL of the official server release.

At the end of the installation, the connection details are printed: the server address (`https://домен` or `http://адрес:3210` in insecure mode) and the WebSocket endpoint. Re-running the same command is an update operation: the PostgreSQL database, attachments, and secrets are preserved. After installation, the `sudo opencordctl …` commands from the "Managing the installed server" section are available.

### From OpenCord Client

1. For a public VPS, point the domain's DNS A/AAAA record at its address in advance and open inbound TCP 80/443 (UDP 443 is also recommended). For a local test without a domain, free up TCP 3210.
2. Click `+` in the server list.
3. Specify the SSH address, port, and user. The domain and ACME email are provided together, or both are left empty.
4. Preferably choose a private SSH key. Password login is supported as a fallback option.
5. Compare the displayed SHA256 fingerprint with the fingerprint in the provider panel or in the VPS console and confirm they match.
6. The client authenticates over SSH and checks the OS, architecture, `systemd`, Docker Compose, and occupied ports.
7. Choose the offered option: existing/to-be-installed Docker, or native installation.
8. Wait for a successful `/health`: HTTPS with a domain, or HTTP on port 3210 in the confirmed insecure mode.

The renderer does not receive the path to the selected key and has no filesystem access. The Electron main process keeps the mapping of the identifier to the path only in memory while the wizard is open, and releases it when the key is changed or the wizard is closed. The SSH password, the key passphrase, and the `sudo` password are not stored in the local JSON and are cleared from the form state after completion/closure. Installer output passes through redaction of known secrets, but at this early stage the wizard should not be used on an untrusted or already compromised VPS.

For the `root` user, the installer runs directly. For another user, permitted `sudo` is required: either passwordless `sudo`, or a password provided in a separate field. The client does not retain persistent SSH access. The absence of Docker does not cause a hidden switch to native: the decision is always made by the user.

### Docker Compose manually

This path is needed when the bundle is transferred to the VPS manually (for example, without access to GitHub); usually the one-command installation from the previous section is sufficient.

Transfer the source bundle of the project to the VPS without `node_modules`, `.env`, `.data`, and user data. From the bundle root, run:

```bash
sudo bash deploy/scripts/install-ubuntu.sh \
  --domain chat.example.com \
  --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

Only for a trusted local test without TLS:

```bash
sudo bash deploy/scripts/install-ubuntu.sh --insecure \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

By default, files are installed to `/opt/opencord`. If Docker Engine and the Compose plugin are missing, the installer adds the official Docker apt repository and installs them. The `curl | sh` convenience script is not used.

The installer:

1. checks the OS, the bundle, and port usage on first installation;
2. creates the `opencord` system user without an interactive login;
3. copies only the necessary sources and the deploy configuration;
4. generates a URL-safe PostgreSQL password if it does not exist yet;
5. stores the password and the connection string in `/opt/opencord/deploy/secrets/` with restricted permissions;
6. validates Compose, builds the server, and starts the containers;
7. waits for a successful server healthcheck and separately checks the public TLS endpoint.

Secrets are not printed in the report and are not stored in `deploy/.env`. The `.env` file contains only the domain, the ACME email, the version label, and the log level.

The PostgreSQL 18 volume is mounted at `/var/lib/postgresql`, not at the deprecated path `/var/lib/postgresql/data`. The official PostgreSQL 18 image uses a versioned `PGDATA`; a wrong mount point can lead to a separate anonymous volume being created and to the loss of the expected persistence after the container is recreated.

### Native installation manually

From the root of the transferred bundle, run:

```bash
sudo bash deploy/scripts/install-native-ubuntu.sh \
  --domain chat.example.com \
  --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

Only for a trusted local test without TLS:

```bash
sudo bash deploy/scripts/install-native-ubuntu.sh --insecure \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

The native installer:

1. checks Ubuntu, `systemd`, the architecture, the bundle, and the ports;
2. downloads the Node.js 24.18.0 archive from `nodejs.org` and verifies it against `SHASUMS256.txt`;
3. installs PostgreSQL from the repository of the specific Ubuntu version;
4. creates the database, a role, and a separate random password in `/etc/opencord/`;
5. installs Caddy from the official apt repository;
6. builds a new versioned release in `/opt/opencord/releases/`;
7. atomically switches `/opt/opencord/current` and starts the hardened `opencord-server.service`;
8. on a failed start or local healthcheck, rolls back to the previous release;
9. configures the TLS reverse proxy and checks the public endpoint.

Old release directories are not removed automatically, so as not to destroy the possibility of a manual rollback. A PostgreSQL backup can be created via `opencordctl backup`; the rotation policy and an automatic schedule will be added separately.

## Re-running and updating

The same invocation of the Docker installer is an update operation. It does not recreate the PostgreSQL password, does not run `docker compose down -v`, and does not remove named volumes. The native installer likewise preserves PostgreSQL and the password, creates a new release, and switches the systemd service only after the build. Every successful deployment records a new instance generation and the common server name. This makes it possible to safely activate a previously deleted tombstone and to replace the client's local record at the same normalized address without creating a duplicate.

Before significant updates, run `sudo opencordctl backup` and copy the resulting file off the VPS. The verified restore command and the automatic schedule are not implemented yet and will be added before the public production release.

## Managing the installed server

After a successful Docker or native installation, the administrative directory `/home/opencord` is created. The `opencord` system user does not get an interactive shell, and its contents are accessible only to `root` and the `opencord` group.

```text
/home/opencord/
├── README.md
├── opencordctl
├── backups/
├── data/README.md
├── settings/server.env
└── scripts/
    ├── backup.sh
    ├── logs.sh
    ├── restart.sh
    ├── settings.sh
    ├── status.sh
    └── uninstall.sh
```

Main commands:

```bash
sudo opencordctl status
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

The backup is created atomically in `/home/opencord/backups/` via `pg_dump` in the custom format. A normal `uninstall` stops the server but preserves the application, configuration, database, and backups. Irreversible removal requires the exact phrase `--purge-data DELETE-OPENCORD-DATA` and also deletes local backups.

`clear-messages` temporarily stops the OpenCord Server process, automatically creates a backup, removes all rows only from the `messages` table, and starts the server again. Channels, members, roles, and settings are preserved. The command requires the exact safety phrase `DELETE-ALL-MESSAGES`; without a successfully created backup, the clearing is not performed.

`update` does not require a new SSH deployment from the client. Channel mode obtains the bundle from the official stable GitHub Release, and manual mode downloads the specified HTTPS release bundle or reads `--bundle-file`. The command verifies the SHA-256 and the archive structure, creates a backup of PostgreSQL and attachments, and runs the idempotent Docker or native installer. Working data is not removed.

The format of the release artifact source is described in [release-manifest.md](./release-manifest.md). Electron automatically downloads the manifest and the server bundle of the client's exact version from the public GitHub Release. `opencordctl check-update` checks the latest published stable release, and `opencordctl update --channel stable` downloads and installs it after verifying the manifest, the protocol version, the canonical URL, the size, and the SHA-256. If the release protocol differs from the installed one, the automatic update stops: a compatible client and a re-deployment from it are required first.

Channel update does not perform a downgrade and changes nothing if the installed version is current or newer than the published one. It requires access to `api.github.com` and `github.com`; the stable release and its assets must be public. Manual `--bundle-url`/`--bundle-file` remain an emergency path and require an explicitly specified SHA-256.

The owner can also open the server menu in the client and select «Обновить сервер». For instances initially deployed by the current client, the VPS address, SSH port, user, domain, email, and selected mode are already filled in. The client downloads and verifies the release bundle of its own version and runs the idempotent installer while preserving PostgreSQL and attachments. Passwords, the passphrase, the fingerprint, and private SSH keys are not held in local state, so the secret must be entered or selected again. For an old server record without a saved configuration, the button must be activated by a single re-deployment through the wizard.

The `pnpm bundle:server` command is used to prepare the release bundle from a verified checkout. It creates the Git-ignored files `release/opencord-server-<version>.tar.gz` and `.sha256`; publishing the archive and the checksum must be performed separately by the release process. Docker mode obtains the ready-made source-free image `ghcr.io/uniquealexx/opencord-server:<OPENCORD_VERSION>`; the VPS does not compile TypeScript and does not run pnpm.

Full re-creation differs from updating and re-deploying. It irreversibly removes the application, the database, attachments, and local backup files:

```bash
sudo opencordctl uninstall --purge-data DELETE-OPENCORD-DATA
```

After this command, the server can be deployed again through the client as a new instance.

The working database and secrets are intentionally not placed in the home directory. Docker stores PostgreSQL in a named volume and secrets in `/opt/opencord/deploy/secrets`; native mode uses the system PostgreSQL and `/etc/opencord`. The `settings/server.env` file contains only the mode, the public endpoint, and fixed paths, but not passwords or private keys.

## Attachment storage

Docker stores files in a separate named volume `opencord_attachments_data`, while native installation stores them in `/var/lib/opencord/attachments` with access for the `opencord` system user. Re-deployment preserves this storage. `sudo opencordctl backup` creates a pair of files: the PostgreSQL `.dump` and `.attachments.tar`; for a full restore, both must be copied. A normal `uninstall` preserves attachments, while `uninstall --purge-data DELETE-OPENCORD-DATA` removes them irreversibly.

## Local Docker check

With Docker Desktop running, from the repository root:

```bash
pnpm docker:up
curl http://127.0.0.1:3210/health
pnpm docker:down
```

The command creates local ignored secrets in `deploy/secrets/`, starts PostgreSQL and the server, then waits for the healthcheck. Caddy does not start in the local override, so a domain and public TLS are not required for this check.

## Diagnostics

Docker Compose:

```bash
cd /opt/opencord
sudo docker compose --env-file deploy/.env -f deploy/compose.yml ps
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 server
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 caddy
curl https://chat.example.com/health
```

Native installation:

```bash
sudo systemctl status opencord-server postgresql caddy --no-pager
sudo journalctl -u opencord-server -n 200 --no-pager
sudo journalctl -u caddy -n 200 --no-pager
curl http://127.0.0.1:3210/health
curl https://chat.example.com/health
```

A successful `/health` confirms the availability of the server process and the connection to the database at the migration start stage. It is not yet a full check of free space, certificate expiry, or the ability to write new messages.

## Standard mechanisms used

- [official Docker Engine installation on Ubuntu](https://docs.docker.com/engine/install/ubuntu/);
- [waiting for healthy dependencies in Docker Compose](https://docs.docker.com/compose/how-tos/startup-order/);
- [Caddy in Docker Compose](https://caddyserver.com/docs/running#docker-compose);
- [WebSocket proxy in Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy);
- [pnpm deploy for a monorepo](https://pnpm.io/cli/deploy).
- [changing PGDATA and the volume in the official PostgreSQL 18 image](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata).
- [official Caddy packages for Debian/Ubuntu](https://caddyserver.com/docs/install#debian-ubuntu-raspbian);
- [official Node.js 24.18.0 files](https://nodejs.org/dist/v24.18.0/).
## Server release bundle without source code

`pnpm bundle:server` creates a ready-made artifact for Ubuntu Linux x64. This command requires Docker Desktop with a running Linux daemon, but ordinary client and server development still does not require Docker.

The outer `opencord-server-<version>.tar.gz` contains the installers, `bundle-info.json`, compatible package metadata, and `server-runtime-linux-x64.tar.gz`. It intentionally excludes `server/src`, `shared/src`, the TypeScript configurations, the workspace lockfile, tests, and dev dependencies. The nested runtime is built by a pinned Linux builder and contains the compiled server, production dependencies, and the runtime `package.json`.

Electron and the VPS installers verify the outer SHA-256. The installers additionally verify the bundle metadata and platform, the size and SHA-256 of the nested runtime, the paths, the entry types, and the symlink boundaries. The local `.sha256` detects corruption, and automatic download uses the SHA-256 from the verified GitHub manifest. The digital signature of the manifest remains a separate future step.

In development, the client first looks for `release/opencord-server-<version>.tar.gz`, then can download the bundle of the client's exact version from GitHub Release; a different archive can be chosen manually in the deployment window. The packaged client uses the verified GitHub download with manual selection as a fallback path, and the path to a local file is not saved.

---

# Развёртывание OpenCord Server (Русский)

## Границы текущей реализации

Каталог `deploy/` содержит два production-способа установки на Ubuntu 22.04/24.04 LTS. Рекомендуемый вариант использует контейнеры Node.js 24.18.0, PostgreSQL 18.4 и Caddy 2.11.4. Нативный вариант устанавливает проверенный Node.js 24.18.0, PostgreSQL из репозитория Ubuntu, официальный пакет Caddy и systemd-службу OpenCord. Electron-клиент проверяет окружение, доставляет ограниченный комплект по SSH и запускает выбранный установщик. Дополнительно `deploy/scripts/bootstrap.sh` позволяет развернуть сервер одной командой прямо в консоли VPS без SSH: скрипт сам скачивает проверенный release bundle и вызывает выбранный установщик.

Локальная разработка по-прежнему использует PGlite и не требует Docker.

## Требования к VPS

- Ubuntu Server 22.04 или 24.04 LTS;
- root-доступ через `sudo`;
- DNS A/AAAA-запись домена, указывающая на VPS;
- свободные входящие TCP-порты 80 и 443;
- UDP 443 для HTTP/3 является желательным, но не обязательным для WebSocket;
- доступ к необходимым официальным apt-репозиториям и registry образов для Docker-режима.

Перед установкой проверьте настройки firewall у хостинг-провайдера. У Docker есть особенности взаимодействия с `ufw`: опубликованные контейнерные порты могут обходить часть его правил. Не следует считать локальное правило `ufw` единственным сетевым барьером.

### Режим без домена для WSL и локальных тестов

Домен и ACME email можно оставить пустыми. В этом случае мастер показывает предупреждение и требует явного подтверждения, после чего запускает установщик с `--insecure`. Сервер слушает `0.0.0.0:3210`, Caddy и TLS не настраиваются, а клиент подключается к `http://<SSH-адрес>:3210`.

Этот режим не защищает сообщения, профиль, токены сессии и другой трафик от перехвата или изменения в сети. Он предназначен только для WSL, тестовой виртуальной машины или другой доверенной локальной среды. Не публикуйте порт 3210 в интернет. Для реального VPS используйте домен и HTTPS.

## Установка

Есть два равноправных пути развёртывания:

- **из OpenCord Client** — клиент подключается к VPS по SSH и выполняет установку (SSH-доступ обязателен);
- **вручную в консоли VPS одной командой** — команда выполняется в консоли VPS или в веб-консоли провайдера (SSH не нужен).

Оба пути используют одни и те же идемпотентные установщики, одинаково сохраняют данные при повторном запуске и требуют одинаковые входные данные: публичный ключ владельца, название сервера, домен с email либо явно подтверждённый небезопасный режим.

### Вручную в консоли VPS одной командой

Bootstrap-скрипт скачивает проверенный release bundle с GitHub Releases, задаёт вопросы и запускает тот же установщик, что и мастер клиента. Скрипт закреплён за конкретным релизом; в команде ниже подставьте актуальную версию (URL обновляется в этой документации при каждом релизе):

```bash
curl -fsSL https://raw.githubusercontent.com/uniquealexx/OpenCord/v<ВЕРСИЯ>/deploy/scripts/bootstrap.sh -o /tmp/opencord-bootstrap.sh && sudo bash /tmp/opencord-bootstrap.sh
```

Альтернативный URL из серверного релиза:

```bash
curl -fsSL https://github.com/uniquealexx/OpenCord/releases/download/server-v<ВЕРСИЯ>/bootstrap.sh -o /tmp/opencord-bootstrap.sh && sudo bash /tmp/opencord-bootstrap.sh
```

Вопросы мастер задаёт только при запуске в терминале (`sudo bash /tmp/opencord-bootstrap.sh`); при запуске через pipe все параметры передаются флагами. Интерактивный мастер спрашивает:

1. способ установки — Docker (рекомендуется) или нативная установка. Если Docker Engine и Compose plugin отсутствуют, установщик добавляет официальный apt-репозиторий Docker и устанавливает их; convenience-скрипт `curl | sh` не используется;
2. домен и ACME email для TLS либо небезопасный режим без домена — с явным предупреждением и обязательным подтверждением вводом «да»;
3. в небезопасном режиме — адрес, по которому клиент будет подключаться к серверу (по умолчанию предлагается внешний IPv4);
4. название сервера;
5. публичный ключ владельца — его копирует кнопка «Скопировать публичный ключ» в настройках клиента («Идентичность и приватность»). Владельцем сервера станет только идентичность с этим публичным ключом; приватный ключ на VPS не передаётся и нигде не запрашивается.

Для автоматизации вопросы можно пропустить флагами:

```bash
curl -fsSL https://raw.githubusercontent.com/uniquealexx/OpenCord/v<ВЕРСИЯ>/deploy/scripts/bootstrap.sh | sudo bash -s -- \
  --mode docker --domain chat.example.com --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' --server-name 'Команда OpenCord'
```

Только для доверенного локального теста без TLS:

```bash
curl -fsSL https://raw.githubusercontent.com/uniquealexx/OpenCord/v<ВЕРСИЯ>/deploy/scripts/bootstrap.sh | sudo bash -s -- \
  --mode native --insecure --yes --public-host <адрес> \
  --owner-public-key '<публичный ключ OpenCord>' --server-name 'Команда OpenCord'
```

Bootstrap проверяет Ubuntu 22.04/24.04 x64, скачивает `release-manifest.json` точной версии по каноническому URL, сверяет поля манифеста, фактический размер и SHA-256 bundle и безопасность tar-записей до распаковки. Компиляция на VPS не выполняется, Node.js до установки не требуется. Доверие основано на HTTPS и неизменяемом Git-теге на GitHub; цифровая подпись пока не реализована (см. [release-manifest.md](./release-manifest.md)), поэтому запускайте bootstrap только по команде из этой документации или по URL официального серверного релиза.

В конце установки печатаются данные для подключения: адрес сервера (`https://домен` либо `http://адрес:3210` в небезопасном режиме) и WebSocket-эндпоинт. Повторный запуск той же команды — операция обновления: база PostgreSQL, вложения и секреты сохраняются. После установки доступны команды `sudo opencordctl …` из раздела «Управление установленным сервером».

### Из OpenCord Client

1. Для публичного VPS заранее направьте DNS A/AAAA-запись домена на его адрес и откройте входящие TCP 80/443 (рекомендуется также UDP 443). Для локального теста без домена освободите TCP 3210.
2. Нажмите `+` в списке серверов.
3. Укажите SSH-адрес, порт и пользователя. Домен и email для ACME указываются вместе либо оба остаются пустыми.
4. Предпочтительно выберите приватный SSH-ключ. Парольный вход поддерживается как запасной вариант.
5. Сравните показанный SHA256 fingerprint с fingerprint в панели провайдера или в консоли VPS и подтвердите совпадение.
6. Клиент авторизуется по SSH и проверит ОС, архитектуру, `systemd`, Docker Compose и занятые порты.
7. Выберите предложенный вариант: существующий/устанавливаемый Docker либо нативную установку.
8. Дождитесь успешного `/health`: HTTPS с доменом или HTTP на порту 3210 в подтверждённом небезопасном режиме.

Renderer не получает путь к выбранному ключу и не имеет доступа к файловой системе. Electron main хранит соответствие идентификатора и пути только в памяти, пока открыт мастер, и освобождает его при смене ключа или закрытии. Пароль SSH, passphrase ключа и пароль `sudo` не сохраняются в локальном JSON и очищаются из состояния формы после завершения/закрытия. Вывод установщика проходит редактирование известных секретов, однако на ранней стадии не следует использовать мастер на недоверенном или уже скомпрометированном VPS.

Для пользователя `root` установщик запускается напрямую. Для другого пользователя нужен разрешённый `sudo`: либо passwordless `sudo`, либо пароль, указанный в отдельном поле. Клиент не сохраняет постоянный SSH-доступ. Отсутствие Docker не вызывает скрытого переключения на native: решение всегда принимает пользователь.

### Docker Compose вручную

Этот путь нужен, когда bundle передаётся на VPS вручную (например, без доступа к GitHub); обычно достаточно установки одной командой из предыдущего раздела.

Передайте исходный bundle проекта на VPS без `node_modules`, `.env`, `.data` и пользовательских данных. Из корня bundle выполните:

```bash
sudo bash deploy/scripts/install-ubuntu.sh \
  --domain chat.example.com \
  --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

Только для доверенного локального теста без TLS:

```bash
sudo bash deploy/scripts/install-ubuntu.sh --insecure \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

По умолчанию файлы устанавливаются в `/opt/opencord`. Если Docker Engine и Compose plugin отсутствуют, установщик добавляет официальный apt-репозиторий Docker и устанавливает их. Convenience-скрипт `curl | sh` не используется.

Установщик:

1. проверяет ОС, bundle и занятость портов при первой установке;
2. создаёт системного пользователя `opencord` без интерактивного входа;
3. копирует только необходимые исходники и deploy-конфигурацию;
4. генерирует URL-safe пароль PostgreSQL, если он ещё не существует;
5. хранит пароль и строку подключения в `/opt/opencord/deploy/secrets/` с ограниченными правами;
6. валидирует Compose, собирает сервер и запускает контейнеры;
7. ждёт успешного server healthcheck и отдельно проверяет публичный TLS endpoint.

Секреты не печатаются в отчёт и не хранятся в `deploy/.env`. Файл `.env` содержит только домен, ACME email, метку версии и уровень логирования.

Volume PostgreSQL 18 смонтирован в `/var/lib/postgresql`, а не в устаревший путь `/var/lib/postgresql/data`. Официальный образ PostgreSQL 18 использует версионированный `PGDATA`; неверная точка монтирования может привести к созданию отдельного анонимного volume и потере ожидаемой персистентности после пересоздания контейнера.

### Нативная установка вручную

Из корня переданного bundle выполните:

```bash
sudo bash deploy/scripts/install-native-ubuntu.sh \
  --domain chat.example.com \
  --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

Только для доверенного локального теста без TLS:

```bash
sudo bash deploy/scripts/install-native-ubuntu.sh --insecure \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

Нативный установщик:

1. проверяет Ubuntu, `systemd`, архитектуру, комплект и порты;
2. загружает архив Node.js 24.18.0 с `nodejs.org` и сверяет его по `SHASUMS256.txt`;
3. устанавливает PostgreSQL из репозитория конкретной версии Ubuntu;
4. создаёт БД, роль и отдельный случайный пароль в `/etc/opencord/`;
5. устанавливает Caddy из официального apt-репозитория;
6. собирает новый versioned release в `/opt/opencord/releases/`;
7. атомарно переключает `/opt/opencord/current` и запускает защищённую `opencord-server.service`;
8. при неудачном старте или локальном healthcheck возвращает предыдущий release;
9. настраивает TLS reverse proxy и проверяет публичный endpoint.

Старые release-каталоги автоматически не удаляются, чтобы не уничтожить возможность ручного отката. Резервную копию PostgreSQL можно создать через `opencordctl backup`; политика ротации и автоматическое расписание будут добавлены отдельно.

## Повторный запуск и обновление

Тот же вызов Docker-установщика является операцией обновления. Он не пересоздаёт пароль PostgreSQL, не выполняет `docker compose down -v` и не удаляет named volumes. Нативный установщик также сохраняет PostgreSQL и пароль, создаёт новый release и переключает systemd-службу только после сборки. Каждое успешное развёртывание записывает новое поколение экземпляра и общее имя сервера. Это позволяет безопасно активировать ранее удалённый tombstone и заменить локальную запись клиента по тому же нормализованному адресу без создания дубликата.

Перед существенными обновлениями следует выполнить `sudo opencordctl backup` и скопировать полученный файл с VPS. Проверенная команда восстановления и автоматическое расписание ещё не реализованы и будут добавлены до публичного production-релиза.

## Управление установленным сервером

После успешной Docker- или нативной установки создаётся административная директория `/home/opencord`. Системный пользователь `opencord` не получает интерактивный shell, а содержимое доступно только `root` и группе `opencord`.

```text
/home/opencord/
├── README.md
├── opencordctl
├── backups/
├── data/README.md
├── settings/server.env
└── scripts/
    ├── backup.sh
    ├── logs.sh
    ├── restart.sh
    ├── settings.sh
    ├── status.sh
    └── uninstall.sh
```

Основные команды:

```bash
sudo opencordctl status
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

Резервная копия создаётся атомарно в `/home/opencord/backups/` через `pg_dump` в custom-формате. Обычный `uninstall` отключает сервер, но сохраняет приложение, конфигурацию, базу и копии. Необратимое удаление требует точной фразы `--purge-data DELETE-OPENCORD-DATA` и удаляет также локальные копии.

`clear-messages` временно останавливает процесс OpenCord Server, автоматически создаёт backup, удаляет все строки только из таблицы `messages` и снова запускает сервер. Каналы, участники, роли и настройки сохраняются. Команда требует точной защитной фразы `DELETE-ALL-MESSAGES`; без успешно созданной резервной копии очистка не выполняется.

`update` не требует нового SSH-развёртывания из клиента. Канальный режим получает bundle из официального stable GitHub Release, а ручной режим загружает указанный HTTPS release bundle либо читает `--bundle-file`. Команда проверяет SHA-256, структуру архива, создаёт backup PostgreSQL и вложений и запускает идемпотентный установщик Docker или native. Рабочие данные не удаляются.

Формат источника релизных артефактов описан в [release-manifest.md](./release-manifest.md). Electron автоматически скачивает manifest и server bundle точной версии клиента из публичного GitHub Release. `opencordctl check-update` проверяет последний опубликованный stable-релиз, а `opencordctl update --channel stable` загружает и устанавливает его после проверки manifest, версии протокола, канонического URL, размера и SHA-256. Если протокол релиза отличается от установленного, автоматическое обновление останавливается: сначала требуется совместимый клиент и повторное развёртывание из него.

Канальное обновление не выполняет downgrade и ничего не меняет, если установленная версия актуальна или новее опубликованной. Оно требует доступ к `api.github.com` и `github.com`; stable-релиз и его assets должны быть публичными. Ручные `--bundle-url`/`--bundle-file` остаются аварийным путём и требуют явно указанной SHA-256.

Владелец также может открыть меню сервера в клиенте и выбрать «Обновить сервер». Для экземпляров, изначально развёрнутых актуальным клиентом, адрес VPS, SSH-порт, пользователь, домен, email и выбранный режим уже заполнены. Клиент скачивает и проверяет release bundle своей версии и запускает идемпотентный установщик с сохранением PostgreSQL и вложений. Пароли, passphrase, fingerprint и приватные SSH-ключи не находятся в локальном состоянии, поэтому секрет требуется ввести или выбрать заново. Для старой записи сервера без сохранённой конфигурации кнопку нужно активировать одним повторным развёртыванием через мастер.

Для подготовки release bundle из проверенного checkout используется команда `pnpm bundle:server`. Она создаёт игнорируемые Git файлы `release/opencord-server-<version>.tar.gz` и `.sha256`; публикация архива и контрольной суммы должна выполняться релизным процессом раздельно. Docker-режим получает готовый source-free образ `ghcr.io/uniquealexx/opencord-server:<OPENCORD_VERSION>`; VPS не компилирует TypeScript и не запускает pnpm.

Полное пересоздание отличается от обновления и переразвёртывания. Оно необратимо удаляет приложение, базу, вложения и локальные backup-файлы:

```bash
sudo opencordctl uninstall --purge-data DELETE-OPENCORD-DATA
```

После этой команды сервер можно развернуть заново через клиент как новый экземпляр.

Рабочую базу и секреты намеренно не переносятся в home. Docker хранит PostgreSQL в named volume и секреты в `/opt/opencord/deploy/secrets`; нативный режим использует системный PostgreSQL и `/etc/opencord`. Файл `settings/server.env` содержит только режим, публичный endpoint и фиксированные пути, но не пароли или приватные ключи.

## Хранилище вложений

Docker хранит файлы в отдельном named volume `opencord_attachments_data`, а нативная установка — в `/var/lib/opencord/attachments` с доступом системного пользователя `opencord`. Повторное развёртывание сохраняет это хранилище. `sudo opencordctl backup` создаёт пару файлов: PostgreSQL `.dump` и `.attachments.tar`; для полного восстановления необходимо скопировать оба. Обычный `uninstall` сохраняет вложения, а `uninstall --purge-data DELETE-OPENCORD-DATA` удаляет их необратимо.

## Локальная Docker-проверка

При запущенном Docker Desktop из корня репозитория:

```bash
pnpm docker:up
curl http://127.0.0.1:3210/health
pnpm docker:down
```

Команда создаёт локальные игнорируемые secrets в `deploy/secrets/`, запускает PostgreSQL и сервер, затем ждёт healthcheck. Caddy в локальном override не запускается, поэтому домен и публичный TLS для этой проверки не требуются.

## Диагностика

Docker Compose:

```bash
cd /opt/opencord
sudo docker compose --env-file deploy/.env -f deploy/compose.yml ps
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 server
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 caddy
curl https://chat.example.com/health
```

Нативная установка:

```bash
sudo systemctl status opencord-server postgresql caddy --no-pager
sudo journalctl -u opencord-server -n 200 --no-pager
sudo journalctl -u caddy -n 200 --no-pager
curl http://127.0.0.1:3210/health
curl https://chat.example.com/health
```

Успешный `/health` подтверждает доступность процесса сервера и подключение к базе на этапе запуска миграций. Он пока не является полной проверкой свободного места, срока сертификата или возможности записи новых сообщений.

## Использованные штатные механизмы

- [официальная установка Docker Engine на Ubuntu](https://docs.docker.com/engine/install/ubuntu/);
- [ожидание healthy-зависимостей в Docker Compose](https://docs.docker.com/compose/how-tos/startup-order/);
- [Caddy в Docker Compose](https://caddyserver.com/docs/running#docker-compose);
- [WebSocket proxy в Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy);
- [pnpm deploy для монорепозитория](https://pnpm.io/cli/deploy).
- [изменение PGDATA и volume в официальном PostgreSQL 18 image](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata).
- [официальные пакеты Caddy для Debian/Ubuntu](https://caddyserver.com/docs/install#debian-ubuntu-raspbian);
- [официальные файлы Node.js 24.18.0](https://nodejs.org/dist/v24.18.0/).
## Server release bundle без исходного кода

`pnpm bundle:server` создаёт готовый артефакт для Ubuntu Linux x64. Для этой команды необходим Docker Desktop с запущенным Linux daemon, но обычная разработка клиента и сервера Docker по-прежнему не требует.

Внешний `opencord-server-<version>.tar.gz` содержит установщики, `bundle-info.json`, совместимые package metadata и `server-runtime-linux-x64.tar.gz`. В него намеренно не входят `server/src`, `shared/src`, конфигурации TypeScript, workspace lockfile, тесты и dev-зависимости. Вложенный runtime собирается закреплённым Linux builder и содержит скомпилированный сервер, production-зависимости и runtime `package.json`.

Electron и VPS-установщики проверяют внешний SHA-256. Установщики дополнительно проверяют метаданные и платформу bundle, размер и SHA-256 вложенного runtime, пути, типы записей и границы симлинков. Локальный `.sha256` обнаруживает повреждение, а автоматическая загрузка использует SHA-256 из проверенного GitHub manifest. Цифровая подпись manifest остаётся отдельным будущим этапом.

В development клиент сначала ищет `release/opencord-server-<version>.tar.gz`, затем может скачать bundle точной версии клиента из GitHub Release; другой архив можно выбрать вручную в окне развёртывания. Упакованный клиент использует проверенную GitHub-загрузку с ручным выбором как запасным путём, а путь к локальному файлу не сохраняется.

---

# 部署 OpenCord Server (中文)

## 当前实现的边界

`deploy/` 目录包含两种适用于 Ubuntu 22.04/24.04 LTS 的生产环境安装方式。推荐方案使用 Node.js 24.18.0、PostgreSQL 18.4 和 Caddy 2.11.4 容器。原生方案安装固定版本的 Node.js 24.18.0、来自 Ubuntu 仓库的 PostgreSQL、官方 Caddy 软件包以及 OpenCord 的 systemd 服务。Electron 客户端会检查环境、通过 SSH 交付一个精简的软件包并运行所选的安装程序。此外，`deploy/scripts/bootstrap.sh` 让你无需 SSH，直接就能在 VPS 控制台里用一条命令部署服务器：脚本会自行下载固定版本的 release bundle 并调用所选的安装程序。

本地开发仍然使用 PGlite，不需要 Docker。

## VPS 要求

- Ubuntu Server 22.04 或 24.04 LTS；
- 通过 `sudo` 获得 root 权限；
- 指向 VPS 的域名 DNS A/AAAA 记录；
- 空闲的入站 TCP 端口 80 和 443；
- 用于 HTTP/3 的 UDP 443 是可选的，但对 WebSocket 并非必需；
- 能够访问必要的官方 apt 仓库以及 Docker 模式所需的镜像仓库。

安装前，请检查托管服务商的防火墙设置。Docker 与 `ufw` 之间存在特殊的交互方式：已发布的容器端口可能会绕过它的部分规则。不应将本地 `ufw` 规则视为唯一的网络屏障。

### 用于 WSL 和本地测试的无域名模式

域名和 ACME 邮箱可以留空。在这种情况下，向导会显示警告并要求明确确认，然后以 `--insecure` 运行安装程序。服务器监听 `0.0.0.0:3210`，不配置 Caddy 和 TLS，客户端连接到 `http://<SSH-адрес>:3210`。

该模式不会保护消息、配置文件、会话令牌和其他流量免受网络上的窃听或篡改。它仅适用于 WSL、测试虚拟机或其他受信任的本地环境。不要将端口 3210 暴露到互联网。对于真实的 VPS，请使用域名和 HTTPS。

## 安装

有两种同等的部署方式：

- **从 OpenCord Client 部署** —— 客户端通过 SSH 连接到 VPS 并执行安装（必须能够通过 SSH 访问）；
- **在 VPS 控制台用一条命令手动部署** —— 该命令在 VPS 控制台或服务商的 Web 控制台中执行（不需要 SSH）。

两种方式使用相同的幂等安装程序，在重复运行时同样地保留数据，并要求相同的输入：所有者的公钥、服务器名称、带邮箱的域名，或经明确确认的不安全模式。

### 在 VPS 控制台用一条命令手动部署

bootstrap 脚本会从 GitHub Releases 下载固定版本的 release bundle，提出问题，并运行与客户端向导相同的安装程序。该脚本绑定到特定的发行版本；在下面的命令中请替换为当前版本（每次发布时本文档中的 URL 都会更新）：

```bash
curl -fsSL https://raw.githubusercontent.com/uniquealexx/OpenCord/v<ВЕРСИЯ>/deploy/scripts/bootstrap.sh -o /tmp/opencord-bootstrap.sh && sudo bash /tmp/opencord-bootstrap.sh
```

来自服务器发行版的备用 URL：

```bash
curl -fsSL https://github.com/uniquealexx/OpenCord/releases/download/server-v<ВЕРСИЯ>/bootstrap.sh -o /tmp/opencord-bootstrap.sh && sudo bash /tmp/opencord-bootstrap.sh
```

向导只在终端中运行时（`sudo bash /tmp/opencord-bootstrap.sh`）才会提问；通过管道运行时，所有参数都通过标志传递。交互式向导会询问：

1. 安装方式 —— Docker（推荐）或原生安装。如果缺少 Docker Engine 和 Compose 插件，安装程序会添加 Docker 官方 apt 仓库并安装它们；不使用 `curl | sh` 便利脚本；
2. 用于 TLS 的域名和 ACME 邮箱，或无域名的不安全模式 —— 并带有明确的警告和必须输入 «да» 的确认；
3. 在不安全模式下 —— 客户端用于连接服务器的地址（默认建议使用外部 IPv4）；
4. 服务器名称；
5. 所有者的公钥 —— 由客户端设置（«Идентичность и приватность»）中的 «Скопировать публичный ключ» 按钮复制。只有持有此公钥的身份才会成为服务器所有者；私钥不会传输到 VPS，也绝不会在任何地方被索要。

为了自动化，可以使用标志跳过这些问题：

```bash
curl -fsSL https://raw.githubusercontent.com/uniquealexx/OpenCord/v<ВЕРСИЯ>/deploy/scripts/bootstrap.sh | sudo bash -s -- \
  --mode docker --domain chat.example.com --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' --server-name 'Команда OpenCord'
```

仅适用于没有 TLS 的受信任本地测试：

```bash
curl -fsSL https://raw.githubusercontent.com/uniquealexx/OpenCord/v<ВЕРСИЯ>/deploy/scripts/bootstrap.sh | sudo bash -s -- \
  --mode native --insecure --yes --public-host <адрес> \
  --owner-public-key '<публичный ключ OpenCord>' --server-name 'Команда OpenCord'
```

Bootstrap 会检查 Ubuntu 22.04/24.04 x64，从规范 URL 下载精确版本的 `release-manifest.json`，在解包之前核对清单字段、bundle 的实际大小和 SHA-256，以及 tar 条目的安全性。VPS 上不进行编译，安装前也不需要 Node.js。信任基于 HTTPS 和 GitHub 上不可变的 Git 标签；数字签名尚未实现（参见 [release-manifest.md](./release-manifest.md)），因此请仅使用本文档中的命令或官方服务器发行版的 URL 来运行 bootstrap。

安装结束时，会打印连接所需的数据：服务器地址（`https://домен`，或在不安全模式下为 `http://адрес:3210`）以及 WebSocket 端点。重复运行同一条命令即是一次更新操作：PostgreSQL 数据库、附件和密钥都会得到保留。安装完成后，可以使用“管理已安装的服务器”一节中的 `sudo opencordctl …` 命令。

### 从 OpenCord Client 部署

1. 对于公网 VPS，请提前将域名的 DNS A/AAAA 记录指向其地址，并开放入站 TCP 80/443（也建议开放 UDP 443）。对于没有域名的本地测试，请释放 TCP 3210。
2. 点击服务器列表中的 `+`。
3. 填写 SSH 地址、端口和用户。域名和 ACME 邮箱要么同时填写，要么同时留空。
4. 最好选择 SSH 私钥。密码登录作为备用方式受支持。
5. 将显示的 SHA256 指纹与服务商面板或 VPS 控制台中的指纹进行比对，并确认它们一致。
6. 客户端会通过 SSH 进行身份验证，并检查操作系统、架构、`systemd`、Docker Compose 以及已被占用的端口。
7. 选择给出的方案：现有的/待安装的 Docker，或原生安装。
8. 等待 `/health` 成功：使用域名时为 HTTPS，或在经确认的不安全模式下使用端口 3210 上的 HTTP。

Renderer 不会获得所选密钥的路径，也无法访问文件系统。Electron main 只在向导打开期间于内存中保存标识符与路径的对应关系，并在更换密钥或关闭向导时将其释放。SSH 密码、密钥的 passphrase 和 `sudo` 密码不会保存在本地 JSON 中，并且在完成/关闭后会从表单状态中清除。安装程序的输出会经过已知密钥的脱敏处理，但在当前早期阶段，不应在不受信任或已被入侵的 VPS 上使用该向导。

对于 `root` 用户，安装程序会直接运行。对于其他用户，需要已获授权的 `sudo`：要么是无密码 `sudo`，要么是在单独字段中提供的密码。客户端不会保留持久的 SSH 访问权限。缺少 Docker 不会导致悄悄切换到原生方式：决定始终由用户做出。

### 手动使用 Docker Compose

当 bundle 需要手动传输到 VPS 时（例如无法访问 GitHub）才需要这种方式；通常上一节中的一条命令安装就足够了。

将项目的源 bundle 传输到 VPS，不要包含 `node_modules`、`.env`、`.data` 和用户数据。在 bundle 根目录下执行：

```bash
sudo bash deploy/scripts/install-ubuntu.sh \
  --domain chat.example.com \
  --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

仅适用于没有 TLS 的受信任本地测试：

```bash
sudo bash deploy/scripts/install-ubuntu.sh --insecure \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

默认情况下，文件会安装到 `/opt/opencord`。如果缺少 Docker Engine 和 Compose 插件，安装程序会添加 Docker 官方 apt 仓库并安装它们。不使用 `curl | sh` 便利脚本。

安装程序会：

1. 在首次安装时检查操作系统、bundle 以及端口占用情况；
2. 创建无交互式登录的系统用户 `opencord`；
3. 仅复制必要的源代码和部署配置；
4. 如果 PostgreSQL 密码尚不存在，则生成 URL 安全的密码；
5. 以受限权限将密码和连接字符串保存在 `/opt/opencord/deploy/secrets/` 中；
6. 验证 Compose、构建服务器并启动容器；
7. 等待服务器 healthcheck 成功，并单独检查公开的 TLS 端点。

密钥不会打印到报告中，也不会存储在 `deploy/.env` 中。`.env` 文件只包含域名、ACME 邮箱、版本标签和日志级别。

PostgreSQL 18 的 volume 挂载在 `/var/lib/postgresql`，而不是已弃用的路径 `/var/lib/postgresql/data`。官方 PostgreSQL 18 镜像使用带版本号的 `PGDATA`；错误的挂载点可能导致创建出单独的匿名 volume，并在容器重建后失去预期的持久化。

### 手动进行原生安装

在传输过来的 bundle 的根目录下执行：

```bash
sudo bash deploy/scripts/install-native-ubuntu.sh \
  --domain chat.example.com \
  --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

仅适用于没有 TLS 的受信任本地测试：

```bash
sudo bash deploy/scripts/install-native-ubuntu.sh --insecure \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

原生安装程序会：

1. 检查 Ubuntu、`systemd`、架构、软件包和端口；
2. 从 `nodejs.org` 下载 Node.js 24.18.0 归档文件，并根据 `SHASUMS256.txt` 进行校验；
3. 从特定 Ubuntu 版本的仓库安装 PostgreSQL；
4. 在 `/etc/opencord/` 中创建数据库、角色和单独生成的随机密码；
5. 从官方 apt 仓库安装 Caddy；
6. 在 `/opt/opencord/releases/` 中构建新的带版本号的 release；
7. 原子化地切换 `/opt/opencord/current` 并启动受保护的 `opencord-server.service`；
8. 在启动失败或本地 healthcheck 失败时回滚到上一个 release；
9. 配置 TLS 反向代理并检查公开端点。

旧的 release 目录不会被自动删除，以免破坏手动回滚的能力。可以通过 `opencordctl backup` 创建 PostgreSQL 备份；轮换策略和自动计划将另行添加。

## 重复运行与更新

再次以相同方式调用 Docker 安装程序即是一次更新操作。它不会重新生成 PostgreSQL 密码，不会执行 `docker compose down -v`，也不会删除 named volume。原生安装程序同样会保留 PostgreSQL 和密码，创建新的 release，并且只在构建完成后才切换 systemd 服务。每次成功部署都会记录新的实例代号（generation）和通用的服务器名称。这样可以安全地激活之前已删除的 tombstone，并在同一规范化地址下替换客户端的本地记录，而不会产生重复项。

在进行重大更新之前，应执行 `sudo opencordctl backup` 并将生成的文件从 VPS 复制出来。经过验证的恢复命令和自动计划尚未实现，将在公开生产版本发布之前添加。

## 管理已安装的服务器

在 Docker 或原生安装成功后，会创建管理目录 `/home/opencord`。系统用户 `opencord` 不会被赋予交互式 shell，目录内容仅 `root` 和 `opencord` 组可访问。

```text
/home/opencord/
├── README.md
├── opencordctl
├── backups/
├── data/README.md
├── settings/server.env
└── scripts/
    ├── backup.sh
    ├── logs.sh
    ├── restart.sh
    ├── settings.sh
    ├── status.sh
    └── uninstall.sh
```

主要命令：

```bash
sudo opencordctl status
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

备份通过 `pg_dump` 以 custom 格式原子化地创建在 `/home/opencord/backups/` 中。普通的 `uninstall` 会停止服务器，但保留应用程序、配置、数据库和备份。不可逆的删除需要精确的短语 `--purge-data DELETE-OPENCORD-DATA`，并且也会删除本地备份。

`clear-messages` 会暂时停止 OpenCord Server 进程，自动创建备份，只从 `messages` 表中删除所有行，然后重新启动服务器。频道、成员、角色和设置都会得到保留。该命令需要精确的安全短语 `DELETE-ALL-MESSAGES`；如果没有成功创建备份，则不会执行清理。

`update` 不需要从客户端重新进行 SSH 部署。通道模式（channel mode）从官方 stable GitHub Release 获取 bundle，手动模式则下载指定的 HTTPS release bundle 或读取 `--bundle-file`。该命令会校验 SHA-256 和归档结构，创建 PostgreSQL 和附件的备份，然后运行幂等的 Docker 或原生安装程序。工作数据不会被删除。

发布产物的来源格式在 [release-manifest.md](./release-manifest.md) 中有描述。Electron 会自动从公开的 GitHub Release 下载与客户端精确版本对应的 manifest 和 server bundle。`opencordctl check-update` 检查最新发布的 stable 版本，而 `opencordctl update --channel stable` 会在验证 manifest、协议版本、规范 URL、大小和 SHA-256 之后下载并安装它。如果发布版本的协议与已安装的协议不同，自动更新会停止：首先需要兼容的客户端，并从中重新部署。

通道更新不会执行降级，并且如果已安装的版本是最新的或比已发布的版本更新，则不会做任何更改。它需要能够访问 `api.github.com` 和 `github.com`；stable 版本及其 assets 必须是公开的。手动方式 `--bundle-url`/`--bundle-file` 仍是应急路径，并且需要明确指定 SHA-256。

所有者也可以在客户端中打开服务器菜单并选择 «Обновить сервер»。对于最初由当前版本客户端部署的实例，VPS 地址、SSH 端口、用户、域名、邮箱和所选模式已经填写好。客户端会下载并验证自己版本的 release bundle，并在保留 PostgreSQL 和附件的同时运行幂等安装程序。密码、passphrase、指纹和 SSH 私钥不会保存在本地状态中，因此需要重新输入或选择密钥。对于没有保存配置的旧服务器记录，需要通过向导进行一次重新部署来激活该按钮。

使用 `pnpm bundle:server` 命令从经过验证的 checkout 准备 release bundle。它会创建被 Git 忽略的文件 `release/opencord-server-<version>.tar.gz` 和 `.sha256`；归档文件和校验和的发布必须由发布流程分别完成。Docker 模式会获取现成的、不含源代码的镜像 `ghcr.io/uniquealexx/opencord-server:<OPENCORD_VERSION>`；VPS 不编译 TypeScript，也不运行 pnpm。

完全重建与更新和重新部署不同。它会不可逆地删除应用程序、数据库、附件和本地备份文件：

```bash
sudo opencordctl uninstall --purge-data DELETE-OPENCORD-DATA
```

执行此命令后，可以通过客户端将服务器作为新实例重新部署。

工作数据库和密钥有意不放入 home 目录。Docker 将 PostgreSQL 存储在 named volume 中，密钥存储在 `/opt/opencord/deploy/secrets` 中；原生模式使用系统 PostgreSQL 和 `/etc/opencord`。`settings/server.env` 文件只包含模式、公开端点和固定路径，而不包含密码或私钥。

## 附件存储

Docker 将文件存储在单独的 named volume `opencord_attachments_data` 中，而原生安装则将文件存储在 `/var/lib/opencord/attachments` 中，并授予系统用户 `opencord` 访问权限。重新部署会保留此存储。`sudo opencordctl backup` 会创建一对文件：PostgreSQL 的 `.dump` 和 `.attachments.tar`；要进行完整恢复，必须将两者都复制出来。普通的 `uninstall` 会保留附件，而 `uninstall --purge-data DELETE-OPENCORD-DATA` 会不可逆地删除它们。

## 本地 Docker 验证

在 Docker Desktop 运行时，从仓库根目录：

```bash
pnpm docker:up
curl http://127.0.0.1:3210/health
pnpm docker:down
```

该命令会在 `deploy/secrets/` 中创建本地的、被忽略的密钥，启动 PostgreSQL 和服务器，然后等待 healthcheck。在本地 override 中不会启动 Caddy，因此此验证不需要域名和公开的 TLS。

## 诊断

Docker Compose：

```bash
cd /opt/opencord
sudo docker compose --env-file deploy/.env -f deploy/compose.yml ps
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 server
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 caddy
curl https://chat.example.com/health
```

原生安装：

```bash
sudo systemctl status opencord-server postgresql caddy --no-pager
sudo journalctl -u opencord-server -n 200 --no-pager
sudo journalctl -u caddy -n 200 --no-pager
curl http://127.0.0.1:3210/health
curl https://chat.example.com/health
```

`/health` 成功可以确认服务器进程可用，并且在迁移启动阶段已连接到数据库。它目前还不是对剩余空间、证书有效期或能否写入新消息的完整检查。

## 使用的标准机制

- [在 Ubuntu 上官方安装 Docker Engine](https://docs.docker.com/engine/install/ubuntu/)；
- [在 Docker Compose 中等待 healthy 依赖](https://docs.docker.com/compose/how-tos/startup-order/)；
- [在 Docker Compose 中使用 Caddy](https://caddyserver.com/docs/running#docker-compose)；
- [Caddy 中的 WebSocket 代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)；
- [用于 monorepo 的 pnpm deploy](https://pnpm.io/cli/deploy)。
- [在官方 PostgreSQL 18 镜像中更改 PGDATA 和 volume](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata)。
- [用于 Debian/Ubuntu 的官方 Caddy 软件包](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)；
- [Node.js 24.18.0 官方文件](https://nodejs.org/dist/v24.18.0/)。
## 不含源代码的 Server release bundle

`pnpm bundle:server` 会创建适用于 Ubuntu Linux x64 的现成产物。此命令需要 Docker Desktop 并且 Linux daemon 正在运行，但普通的客户端和服务器开发仍然不需要 Docker。

外层的 `opencord-server-<version>.tar.gz` 包含安装程序、`bundle-info.json`、兼容的 package metadata 和 `server-runtime-linux-x64.tar.gz`。其中有意不包含 `server/src`、`shared/src`、TypeScript 配置、workspace lockfile、测试和 dev 依赖。内嵌的 runtime 由固定版本的 Linux builder 构建，包含已编译的服务器、生产依赖和运行时 `package.json`。

Electron 和 VPS 安装程序会校验外层 SHA-256。安装程序还会校验 bundle 的元数据和平台、内嵌 runtime 的大小和 SHA-256、路径、条目类型以及符号链接的边界。本地 `.sha256` 可以检测损坏，而自动下载使用来自经过验证的 GitHub manifest 的 SHA-256。manifest 的数字签名仍是单独的后续步骤。

在开发环境中，客户端首先查找 `release/opencord-server-<version>.tar.gz`，然后可以从 GitHub Release 下载与客户端精确版本对应的 bundle；也可以在部署窗口手动选择其他归档文件。打包后的客户端使用经过验证的 GitHub 下载，并以手动选择作为备用路径，且不会保存本地文件路径。
