# OpenCord — Agent Guidelines (English)

## About the project

OpenCord is an open-source project conceived as a decentralized alternative to Discord. The user independently deploys an OpenCord Server instance on their own VPS and then connects to it through the OpenCord Client to communicate in text and voice channels. There is no central account and no central server: the user is identified by a locally created Ed25519 key pair.

The project is in a working beta stage (see the version in the root `package.json`; it must stay identical across all workspace packages and `BOOTSTRAP_VERSION` in `deploy/scripts/bootstrap.sh` — enforced by `scripts/check-versions.mjs`). The minimal end-to-end loop — identity, deployment, registration, messaging, history, roles, voice — is implemented. Architecture and the protocol may still evolve: do not present planned features as already implemented and do not lock in controversial technical decisions without agreement.

## Main parts of the system

A pnpm workspace with logically separated areas of responsibility.

### 1. OpenCord Client (`client/`)

- **Desktop:** Electron shell + statically exported Next.js UI. The renderer is sandboxed (`contextIsolation`, `sandbox`, no Node) and accesses native capabilities only through the typed bridge `window.openCord` (`client/src/shared/bridge.ts`). The Electron main process owns identity, SSH deployment, attachments, updates, and window lifecycle.
- **Android:** a prototype on Capacitor 8 that reuses the same static renderer. The platform layer lives in `client/src/platform/`; Ed25519 is done via WebCrypto with the private key in Android Keystore (`@aparajita/capacitor-secure-storage`). Desktop-only features (VPS deployment, screen share, auto-updates, window control) are intentionally absent on mobile.
- **Local identity:** Ed25519 via `node:crypto` on desktop. The private key is encrypted with Electron `safeStorage` (DPAPI/Keychain/libsecret) and stored in `identity.json`; local state is validated with Zod and written atomically. Reset creates a new identity and never grants access to the previous profile; the UI must warn about consequences.
- Also responsible for: the VPS deployment module, voice (livekit-client), screen sharing, RNNoise noise suppression (`@sapphi-red/web-noise-suppressor` in an AudioWorklet), attachments, i18n (EN/RU/ZH), settings.

The private key must never be transmitted to the VPS or to other users. Only the public key and the public profile fields necessary for a specific server are sent. If the private key does not match the public key of a previously registered profile, access to that identity must be denied.

### 2. OpenCord Server (`server/`)

- Fastify + `@fastify/websocket`; all payloads (WebSocket events, HTTP bodies) are validated with Zod schemas from `@opencord/shared`.
- **Authentication:** `auth.challenge` (random bytes, short TTL) → the client signs it with Ed25519 → `auth.respond` (SPKI public key, signature, public profile). User ID = SHA-256 of the public key. A short-lived Bearer token issued in `auth.ok` is valid only for `/api/attachments`.
- **Roles v1:** `owner` / `administrator` / `member`, enforced server-side (see `docs/authorization.md`). Owner is bound to a public key at deployment time; the role cannot be transferred.
- **Storage:** PostgreSQL (production) or PGlite (local development, no Docker required). Migrations are versioned inline SQL in `server/src/database/migrations.ts`; data access goes through `src/database/repository.ts`.
- **Attachments:** metadata in SQL, bytes via the `AttachmentStorage` abstraction (filesystem), with size and rate limits.
- **Voice:** issues short-lived LiveKit tokens and processes webhooks (`src/voice.ts`); the server degrades gracefully without LiveKit.
- **Diagnostics:** `GET /health`, validated by `serverHealthSchema`.

The server stores message history in a form accessible to it. Data transmission must be protected by TLS. End-to-end encryption must not be claimed until it is actually implemented and verified. Assume the VPS administrator technically controls the data stored on the server. E2EE, additional protection, and storage optimization are future directions.

### 3. Shared protocol (`shared/`)

`PROTOCOL_VERSION` in `shared/src/protocol.ts` and the Zod schemas are the single source of truth for the client↔server contract. Shared code goes here only when it is actually used by several parts of the system and does not expose server secrets to the client.

### 4. VPS deployment and management (`deploy/`)

- Docker Compose stack: PostgreSQL + server + LiveKit + Caddy (TLS); a native Ubuntu/systemd variant also exists.
- `bootstrap.sh` — a one-command installer; the SSH installer module is embedded in the client (`ssh2`).
- Management: `deploy/management/opencordctl`, `update-server`, release channels, update bundles (`pnpm bundle:server`), `release-manifest.json`.

Installer requirements:

- prefer SSH keys over passwords;
- do not write the SSH password to disk or send it to any third-party services;
- keep the password only in memory for the duration of the operation and clear it after completion;
- do not print passwords, private keys, tokens, or other secrets to logs;
- where possible, create a dedicated system user with minimal permissions;
- use reproducible containerized deployment (Docker Compose);
- configure TLS, verify the required ports and the state of services;
- provide a clear report on installation success or errors;
- do not retain persistent SSH access unless it is required for explicitly enabled management or updates.

Installation scripts must be idempotent to the extent practically possible. A repeated run must not destroy configuration or user data without warning.

## Profiles and privacy

The local profile and the profile on a specific server must be distinguished. Only the necessary public fields are sent to the VPS, for example the display name, username, avatar, description, and public key. Any new field must be evaluated in terms of necessity and privacy.

Core principles:

- minimizing collected and transmitted data;
- no hidden telemetry;
- explicit consent for sending optional data;
- prohibition on transmitting private keys;
- secure storage of local secrets using operating-system facilities;
- clear information about which data is available to the VPS owner;
- no reset mechanism that can bypass proof of identity ownership.

## Voice

Voice is implemented with **LiveKit** as a self-hosted WebRTC SFU (see `docs/voice-livekit-v1.md`): the server issues short-lived, single-room tokens with granular grants; the client uses `livekit-client`. TURN and network ports are configured by the deployment. Voice is optional: without LiveKit the server runs in a degraded state and text keeps working. Noise suppression is done locally with RNNoise in an AudioWorklet (see `docs/voice-audio-processing.md`). Do not add another voice infrastructure component without documented justification.

## Technology stack

The project's primary language and runtime are JavaScript/TypeScript and Node.js (≥ 24, pnpm ≥ 11). TypeScript with strict typing is required for new code.

Current approved decisions:

- Electron + statically exported Next.js for the desktop client; Capacitor for the Android prototype;
- Fastify + WebSocket for the server; shared Zod schemas as the protocol contract;
- PostgreSQL in production, PGlite for local development;
- LiveKit as the self-hosted voice SFU;
- built-in crypto only (`node:crypto` on desktop, WebCrypto on Android) for identity — no external cryptographic libraries;
- Docker and Docker Compose for packaging and deploying the server part; SSH for initial deployment and explicitly permitted administration.

Do not add a heavy dependency or a new infrastructure component without documented justification.

## Repository structure

```text
OpenCord/
├── client/       # Electron + Next.js desktop, Capacitor Android prototype
├── server/       # Fastify API, WebSocket, migrations, attachments, voice tokens
├── shared/       # protocol version, Zod schemas, health and manifest schemas
├── deploy/       # Compose, Caddy, bootstrap/install scripts, management tools
├── docs/         # architecture, protocol, security, deployment documentation
├── scripts/      # version checks and release-manifest tooling
├── release/      # built release bundles and manifests (not for hand edits)
└── AGENTS.md
```

Key documentation: `docs/protocol.md` (protocol v36), `docs/authorization.md`, `docs/client-architecture.md`, `docs/deployment.md`, `docs/voice-livekit-v1.md`, `docs/mobile-android-prototype.md`, `docs/client-updates.md`, `docs/build-targets.md`, `docs/release-manifest.md`, `docs/health.md`, `docs/screen-sharing.md`, `docs/voice-audio-processing.md`. For day-to-day build/run commands see `CLAUDE.md`.

## Development rules for agents

- Before making changes, study the project's existing structure, documentation, and configuration.
- Preserve the separation of the client, server, and installer. Do not place server secrets or administrative logic in the client package.
- Use TypeScript and strict typing for new modules.
- Validate all data at system boundaries: user input, the API, WebSocket events, files, and SSH parameters.
- Never commit passwords, private keys, tokens, `.env` files with secrets, or real user data.
- For protocol changes, bump `PROTOCOL_VERSION` and update the shared schemas, the server, the client, `docs/protocol.md`, and the compatibility documentation in sync.
- For SQL schema changes, add a new versioned migration in `server/src/database/migrations.ts`; never edit existing migrations destructively.
- Keep the version identical across all `package.json` files and `BOOTSTRAP_VERSION` (checked by `scripts/check-versions.mjs`, runs as part of `pnpm build` and `pnpm test`).
- Do not weaken identity verification for the sake of profile-recovery convenience.
- Add tests for authentication, permissions, migrations, message handling, and installer failure scenarios.
- Do not claim security, anonymity, or encryption without precisely describing the threat model and the guarantees actually implemented.
- Document significant architectural decisions and their trade-offs in `docs/`.

## Current status and later stages

Implemented in beta: local Ed25519 identity with encrypted storage; VPS deployment via `bootstrap.sh` and the client installer; challenge-response authentication; spaces, text channels, messages, attachments, reactions, mentions, slash commands, slowmode, private messages; roles owner/administrator/member with bans, kicks, and mutes; message history in SQL; voice rooms and screen sharing via LiveKit with RNNoise; auto-updates with release channels and a release manifest; Android prototype.

Later stages (unless a separate task is set): end-to-end encryption, federation between VPS instances, code-signed artifacts, complex scaling and storage optimization.

---

# OpenCord — Правила для агентов (Русский)

## О проекте

OpenCord — проект с открытым исходным кодом, задуманный как децентрализованная альтернатива Discord. Пользователь самостоятельно разворачивает экземпляр OpenCord Server на своём VPS, а затем подключается к нему через OpenCord Client для общения в текстовых и голосовых каналах. Центральной учётной записи и центрального сервера нет: пользователь идентифицируется локально созданной парой ключей Ed25519.

Проект находится в рабочей бета-стадии (версия в корневом `package.json`; она должна совпадать во всех пакетах workspace и в `BOOTSTRAP_VERSION` в `deploy/scripts/bootstrap.sh` — это проверяет `scripts/check-versions.mjs`). Минимальный сквозной сценарий — идентичность, развёртывание, регистрация, сообщения, история, роли, голос — реализован. Архитектура и протокол ещё могут меняться: не выдавайте планируемые возможности за уже реализованные и не закрепляйте спорные технические решения без согласования.

## Основные части системы

pnpm-workspace с логически разделёнными областями ответственности.

### 1. OpenCord Client (`client/`)

- **Десктоп:** оболочка Electron + статически экспортируемый Next.js UI. Рендерер изолирован (`contextIsolation`, `sandbox`, без Node) и обращается к нативным возможностям только через типизированный мост `window.openCord` (`client/src/shared/bridge.ts`). Main-процесс Electron владеет идентичностью, SSH-развёртыванием, вложениями, обновлениями и жизненным циклом окна.
- **Android:** прототип на Capacitor 8, переиспользующий тот же статический рендерер. Платформенный слой — в `client/src/platform/`; Ed25519 через WebCrypto, приватный ключ хранится в Android Keystore (`@aparajita/capacitor-secure-storage`). Десктоп-функции (развёртывание VPS, скриншаринг, автообновления, управление окном) на мобильных намеренно отсутствуют.
- **Локальная идентичность:** Ed25519 через `node:crypto` на десктопе. Приватный ключ шифруется Electron `safeStorage` (DPAPI/Keychain/libsecret) и хранится в `identity.json`; локальное состояние валидируется Zod и записывается атомарно. Сброс создаёт новую идентичность и не даёт доступ к прежнему профилю; интерфейс обязан ясно предупреждать о последствиях сброса.
- Также отвечает за: модуль развёртывания VPS, голос (livekit-client), скриншаринг, шумоподавление RNNoise (`@sapphi-red/web-noise-suppressor` в AudioWorklet), вложения, локализацию (EN/RU/ZH), настройки.

Приватный ключ никогда не передаётся на VPS и другим пользователям. Серверу передаются публичный ключ и только те публичные данные профиля, которые необходимы для работы на конкретном сервере. Если приватный ключ не соответствует публичному ключу ранее зарегистрированного профиля, доступ к этой идентичности должен быть отклонён.

### 2. OpenCord Server (`server/`)

- Fastify + `@fastify/websocket`; все данные (WebSocket-события, тела HTTP-запросов) валидируются Zod-схемами из `@opencord/shared`.
- **Аутентификация:** `auth.challenge` (случайные байты, короткий TTL) → клиент подписывает challenge ключом Ed25519 → `auth.respond` (публичный ключ в SPKI, подпись, публичный профиль). ID пользователя = SHA-256 публичного ключа. Краткоживущий Bearer-токен из `auth.ok` действует только для `/api/attachments`.
- **Роли v1:** `owner` / `administrator` / `member`, права проверяет сервер (см. `docs/authorization.md`). Owner привязывается к публичному ключу при развёртывании; роль не передаётся.
- **Хранение:** PostgreSQL (production) или PGlite (локальная разработка, без Docker). Миграции — версионируемый inline-SQL в `server/src/database/migrations.ts`; доступ к данным — через `src/database/repository.ts`.
- **Вложения:** метаданные в SQL, байты — через абстракцию `AttachmentStorage` (файловая система), с лимитами размера и скорости.
- **Голос:** выдача краткоживущих токенов LiveKit и обработка webhook (`src/voice.ts`); без LiveKit сервер работает в деградировавшем режиме.
- **Диагностика:** `GET /health`, валидируется `serverHealthSchema`.

Сервер хранит историю сообщений в доступном ему виде. Передача данных должна быть защищена TLS. Нельзя заявлять о сквозном шифровании, пока оно действительно не реализовано и не проверено. Следует исходить из того, что администратор VPS технически контролирует хранящиеся на сервере данные. Сквозное шифрование, дополнительная защита и оптимизация хранения — будущие направления.

### 3. Общий протокол (`shared/`)

`PROTOCOL_VERSION` в `shared/src/protocol.ts` и Zod-схемы — единственный источник истины для контракта клиент↔сервер. Общий код попадает сюда, только если он реально используется несколькими частями системы и не раскрывает серверные секреты клиенту.

### 4. Развёртывание и управление VPS (`deploy/`)

- Docker Compose стек: PostgreSQL + сервер + LiveKit + Caddy (TLS); существует также нативный вариант Ubuntu/systemd.
- `bootstrap.sh` — установка одной командой; SSH-установщик встроен в клиент (`ssh2`).
- Управление: `deploy/management/opencordctl`, `update-server`, каналы релизов, бандлы обновлений (`pnpm bundle:server`), `release-manifest.json`.

Требования к установщику:

- предпочитать SSH-ключи паролям;
- не записывать SSH-пароль на диск и не отправлять его на какие-либо сторонние сервисы;
- хранить пароль только в памяти на время операции и очищать его после завершения;
- не выводить пароли, приватные ключи, токены и другие секреты в логи;
- по возможности создавать отдельного системного пользователя с минимальными правами;
- использовать воспроизводимое контейнерное развёртывание (Docker Compose);
- настраивать TLS, проверять необходимые порты и состояние сервисов;
- предоставлять понятный отчёт об успехе или ошибках установки;
- не сохранять постоянный SSH-доступ, если он не требуется для явно включённого управления или обновления.

Скрипты установки должны быть идемпотентными настолько, насколько это практически возможно. Повторный запуск не должен без предупреждения уничтожать конфигурацию или пользовательские данные.

## Профили и приватность

Локальный профиль и профиль на конкретном сервере следует различать. На VPS отправляются только необходимые публичные поля, например отображаемое имя, имя пользователя, аватар, описание и публичный ключ. Любое новое поле должно оцениваться с точки зрения необходимости и приватности.

Основные принципы:

- минимизация собираемых и передаваемых данных;
- отсутствие скрытой телеметрии;
- явное согласие на отправку необязательных данных;
- запрет на передачу приватных ключей;
- безопасное хранение локальных секретов средствами операционной системы;
- понятное информирование о том, какие данные доступны владельцу VPS;
- отсутствие механизма сброса, способного обойти доказательство владения идентичностью.

## Голосовая связь

Голос реализован на **LiveKit** как self-hosted WebRTC SFU (см. `docs/voice-livekit-v1.md`): сервер выдаёт краткоживущие токены на одну комнату с гранулярными правами; клиент использует `livekit-client`. TURN и сетевые порты настраивает развёртывание. Голос опционален: без LiveKit сервер работает в деградировавшем режиме, текст продолжает работать. Шумоподавление выполняется локально через RNNoise в AudioWorklet (см. `docs/voice-audio-processing.md`). Не добавляйте ещё один компонент голосовой инфраструктуры без документированного обоснования.

## Технологический стек

Основной язык и среда выполнения проекта — JavaScript/TypeScript и Node.js (≥ 24, pnpm ≥ 11). Для нового кода обязателен TypeScript со строгой типизацией.

Текущие утверждённые решения:

- Electron + статически экспортируемый Next.js для десктоп-клиента; Capacitor для прототипа на Android;
- Fastify + WebSocket для сервера; общие Zod-схемы как контракт протокола;
- PostgreSQL в production, PGlite для локальной разработки;
- LiveKit как self-hosted SFU для голоса;
- только встроенная криптография (`node:crypto` на десктопе, WebCrypto на Android) для идентичности — без внешних криптографических библиотек;
- Docker и Docker Compose для упаковки и развёртывания серверной части; SSH для первоначального развёртывания и явно разрешённого администрирования.

Не добавляйте тяжёлую зависимость или новый инфраструктурный компонент без документированного обоснования.

## Структура репозитория

```text
OpenCord/
├── client/       # Electron + Next.js десктоп, Capacitor-прототип Android
├── server/       # Fastify API, WebSocket, миграции, вложения, голосовые токены
├── shared/       # версия протокола, Zod-схемы, health- и manifest-схемы
├── deploy/       # Compose, Caddy, bootstrap/установочные скрипты, инструменты управления
├── docs/         # архитектура, протокол, безопасность, документация развёртывания
├── scripts/      # проверка версий и инструменты release-manifest
├── release/      # собранные release-бандлы и манифесты (не для ручных правок)
└── AGENTS.md
```

Ключевая документация: `docs/protocol.md` (протокол v36), `docs/authorization.md`, `docs/client-architecture.md`, `docs/deployment.md`, `docs/voice-livekit-v1.md`, `docs/mobile-android-prototype.md`, `docs/client-updates.md`, `docs/build-targets.md`, `docs/release-manifest.md`, `docs/health.md`, `docs/screen-sharing.md`, `docs/voice-audio-processing.md`. Повседневные команды сборки и запуска — в `CLAUDE.md`.

## Правила разработки для агентов

- Перед изменениями изучите существующую структуру, документацию и конфигурацию проекта.
- Сохраняйте разделение клиента, сервера и установщика. Не помещайте серверные секреты или административную логику в клиентский пакет.
- Используйте TypeScript и строгую типизацию для новых модулей.
- Валидируйте все данные на границах системы: пользовательский ввод, API, WebSocket-события, файлы и параметры SSH.
- Никогда не коммитьте пароли, приватные ключи, токены, `.env` с секретами или реальные данные пользователей.
- Для изменений протокола поднимайте `PROTOCOL_VERSION` и синхронно обновляйте общие схемы, сервер, клиент, `docs/protocol.md` и документацию совместимости.
- Для изменений схемы SQL добавляйте новую версионируемую миграцию в `server/src/database/migrations.ts`; никогда не правьте существующие миграции разрушающим образом.
- Держите версию одинаковой во всех `package.json` и в `BOOTSTRAP_VERSION` (проверяет `scripts/check-versions.mjs`, запускается в составе `pnpm build` и `pnpm test`).
- Не ослабляйте проверку идентичности ради удобства восстановления профиля.
- Добавляйте тесты для аутентификации, прав доступа, миграций, обработки сообщений и сценариев отказа установщика.
- Не заявляйте о безопасности, анонимности или шифровании без точного описания модели угроз и фактически реализованных гарантий.
- Документируйте существенные архитектурные решения и их компромиссы в `docs/`.

## Текущий статус и последующие этапы

Реализовано в бете: локальная идентичность Ed25519 с шифрованным хранилищем; развёртывание VPS через `bootstrap.sh` и клиентский установщик; challenge-response аутентификация; пространства, текстовые каналы, сообщения, вложения, реакции, упоминания, слэш-команды, slowmode, личные сообщения; роли owner/administrator/member с банами, киками и мутами; история сообщений в SQL; голосовые комнаты и скриншаринг через LiveKit с RNNoise; автообновления с каналами релизов и release-манифестом; прототип Android.

Последующие этапы (если не поставлена отдельная задача): сквозное шифрование, федерация между экземплярами VPS, кодовая подпись артефактов, сложное масштабирование и оптимизация хранения.
