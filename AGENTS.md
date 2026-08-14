# OpenCord — Agent Guidelines (English)

## About the project

OpenCord is an open-source project conceived as a decentralized alternative to Discord. The user must be able to independently deploy an OpenCord Server instance on their own VPS and then connect to it through the OpenCord Client to communicate in text and voice channels.

The project is at an early stage. The architecture, protocols, and specific libraries may still change. Assumed capabilities should not be presented as already implemented, nor should controversial technical decisions be locked in without agreement.

## Main parts of the system

Three logically separated areas of responsibility are planned.

### 1. OpenCord Client

The client part provides the user interface and is responsible for:

- creating and configuring a local profile;
- creating the user's local cryptographic identity;
- connecting to self-hosted OpenCord servers;
- creating a server through the automated VPS deployment module;
- working with servers, text channels, and messages;
- voice communication;
- displaying names, avatars, and other public profile data;
- user, connection, and privacy settings.

A central account is not a required part of the model. The user is identified by a cryptographic key pair created locally. The private key must not be transmitted to the VPS or to other users. Only the public key and those public profile fields that are necessary for operation on a specific server are sent to the server.

If the private key does not match the public key of a previously registered profile, access to that identity must be denied. Recovering a previous identity is possible only from a protected backup of the private key created in advance or from another separately designed recovery mechanism. The key reset button creates a new identity and by itself must not grant access to the previous profile. The interface must clearly warn the user about the consequences of a reset.

### 2. OpenCord Server

The server part is installed and runs directly on the VPS. It is responsible for:

- the API and persistent connections with clients;
- verifying users' cryptographic identity;
- servers/spaces, channels, roles, and permissions;
- receiving, storing, and serving the history of text messages;
- storing public server profiles, avatars, and attachments;
- voice signaling and the necessary voice infrastructure;
- administrative operations, updates, and instance diagnostics.

At the first stage the server stores message history in a form accessible to it. Data transmission must be protected by TLS. End-to-end encryption must not be claimed until it is actually implemented and verified. It should be assumed that the VPS administrator technically controls the data stored on the server. End-to-end encryption, additional protection, and storage optimization are considered future directions.

### 3. VPS deployment and management

The installer is a separate module, even if its interface is embedded in the client. The user specifies the VPS address and SSH access credentials, after which the installer runs a reproducible installation scenario for the OpenCord Server.

Installer requirements:

- prefer SSH keys over passwords;
- do not write the SSH password to disk or send it to any third-party services;
- keep the password only in memory for the duration of the operation and clear it after completion;
- do not print passwords, private keys, tokens, or other secrets to logs;
- where possible, create a dedicated system user with minimal permissions;
- use reproducible containerized deployment, preferably Docker Compose;
- configure TLS, verify the required ports and the state of services;
- provide a clear report on installation success or errors;
- do not retain persistent SSH access unless it is required for explicitly enabled management or updates.

Installation scripts must be idempotent to the extent practically possible. A repeated run must not destroy configuration or user data without warning.

## Profiles and privacy

The local profile and the profile on a specific server must be distinguished. Only the necessary public fields are sent to the VPS, for example the display name, avatar, description, and public key. Any new field must be evaluated in terms of necessity and privacy.

Core principles:

- minimizing collected and transmitted data;
- no hidden telemetry;
- explicit consent for sending optional data;
- prohibition on transmitting private keys;
- secure storage of local secrets using operating-system facilities;
- clear information about which data is available to the VPS owner;
- no reset mechanism that can bypass proof of identity ownership.

## Voice

Voice is treated as a separate subsystem. The preferred direction is WebRTC with server signaling. NAT, TURN, and group calls must be taken into account when designing. A scalable group room may require an SFU. Concrete implementations and libraries must be chosen after prototyping and measurements, not assumed in advance.

## Technology stack

The project's primary language and runtime are JavaScript/TypeScript and Node.js. TypeScript is preferred for new code unless otherwise justified by the requirements of a specific module.

Additional technologies:

- Docker and Docker Compose for packaging and deploying the server part;
- an SQL database for persistent storage of server data;
- SSH for initial deployment and explicitly permitted administration;
- WebRTC as the preferred direction for voice.

Current approved decisions: Electron + Next.js for the Windows client, Fastify + WebSocket for the server, shared-protocol Zod schemas, and PostgreSQL in production. Local development uses PGlite so that Docker is not required. The voice library is not yet approved. Do not add a heavy dependency or a new infrastructure component without documented justification.

## Intended repository structure

```text
OpenCord/
├── client/       # user interface and local identity
├── server/       # API, messages, profiles, permissions, and voice signaling
├── deploy/       # Docker Compose, SSH installation, and updates
├── shared/       # shared types, schemas, and protocol contract
├── docs/         # architecture, security, and protocol documentation
└── AGENTS.md
```

This is a target structure, not a requirement to create empty directories in advance. Shared code should go into `shared/` only when it is actually used by several parts of the system and does not expose server secrets to the client.

## Development rules for agents

- Before making changes, study the project's existing structure, documentation, and configuration.
- Preserve the separation of the client, server, and installer. Do not place server secrets or administrative logic in the client package.
- Use TypeScript and strict typing for new modules unless the project specifies otherwise.
- Validate all data at system boundaries: user input, the API, WebSocket events, files, and SSH parameters.
- Never commit passwords, private keys, tokens, `.env` files with secrets, or real user data.
- For protocol changes, update the shared schemas, the server, the client, and the compatibility documentation in sync.
- For SQL schema changes, add versioned migrations; do not change production data in a destructive way without explicit agreement.
- Do not weaken identity verification for the sake of profile-recovery convenience.
- Add tests for authentication, permissions, migrations, message handling, and installer failure scenarios.
- Do not claim security, anonymity, or encryption without precisely describing the threat model and the guarantees actually implemented.
- Document significant architectural decisions and their trade-offs in `docs/`.

## First-version priorities

The first version must focus on a minimal end-to-end scenario:

1. Creating a local identity and securely saving the key.
2. Deploying one server instance on a VPS.
3. Connecting the client and registering a public profile.
4. Creating a text channel, sending and receiving messages.
5. Saving and loading history from the SQL database.
6. Basic roles and access checking.
7. A voice-room prototype after the text loop is stabilized.

Optimization, federation between VPS instances, end-to-end encryption, and complex scaling are later stages unless a separate task is set for them.

---

# OpenCord — Правила для агентов (Русский)

## О проекте

OpenCord — проект с открытым исходным кодом, задуманный как децентрализованная альтернатива Discord. Пользователь должен иметь возможность самостоятельно развернуть экземпляр OpenCord Server на своём VPS, а затем подключаться к нему через OpenCord Client для общения в текстовых и голосовых каналах.

Проект находится на ранней стадии. Архитектура, протоколы и конкретные библиотеки ещё могут меняться. Не следует выдавать предполагаемые возможности за уже реализованные или без согласования закреплять спорные технические решения.

## Основные части системы

Планируются три логически разделённые области ответственности.

### 1. OpenCord Client

Клиентская часть предоставляет пользовательский интерфейс и отвечает за:

- создание и настройку локального профиля;
- создание локальной криптографической идентичности пользователя;
- подключение к самостоятельно размещённым серверам OpenCord;
- создание сервера через модуль автоматизированного развёртывания на VPS;
- работу с серверами, текстовыми каналами и сообщениями;
- голосовое общение;
- отображение имён, аватаров и других публичных данных профилей;
- настройки пользователя, подключения и приватности.

Центральная учётная запись не является обязательной частью модели. Пользователь идентифицируется криптографической парой ключей, создаваемой локально. Приватный ключ не должен передаваться на VPS или другим пользователям. Серверу передаются публичный ключ и только те публичные данные профиля, которые необходимы для работы на конкретном сервере.

Если приватный ключ не соответствует публичному ключу ранее зарегистрированного профиля, доступ к этой идентичности должен быть отклонён. Восстановление прежней идентичности возможно только из заранее созданной защищённой резервной копии приватного ключа или другого отдельно спроектированного механизма восстановления. Кнопка сброса ключей создаёт новую идентичность и сама по себе не должна предоставлять доступ к прежнему профилю. Интерфейс обязан ясно предупреждать пользователя о последствиях сброса.

### 2. OpenCord Server

Серверная часть устанавливается и работает непосредственно на VPS. Она отвечает за:

- API и постоянные соединения с клиентами;
- проверку криптографической идентичности пользователей;
- серверы/пространства, каналы, роли и права доступа;
- приём, хранение и выдачу истории текстовых сообщений;
- хранение публичных серверных профилей, аватаров и вложений;
- голосовой сигналинг и необходимую инфраструктуру голосовой связи;
- административные операции, обновления и диагностику экземпляра.

На первом этапе сервер хранит историю сообщений в доступном ему виде. Передача данных должна быть защищена TLS. Нельзя заявлять о сквозном шифровании, пока оно действительно не реализовано и не проверено. Следует исходить из того, что администратор VPS технически контролирует хранящиеся на сервере данные. Сквозное шифрование, дополнительная защита и оптимизация хранения рассматриваются как будущие направления развития.

### 3. Развёртывание и управление VPS

Установщик является отдельным модулем, даже если его интерфейс встроен в клиент. Пользователь указывает адрес VPS и данные для SSH-доступа, после чего установщик выполняет воспроизводимый сценарий установки OpenCord Server.

Требования к установщику:

- предпочитать SSH-ключи паролям;
- не записывать SSH-пароль на диск и не отправлять его на какие-либо сторонние сервисы;
- хранить пароль только в памяти на время операции и очищать его после завершения;
- не выводить пароли, приватные ключи, токены и другие секреты в логи;
- по возможности создавать отдельного системного пользователя с минимальными правами;
- использовать воспроизводимое контейнерное развёртывание, предпочтительно Docker Compose;
- настраивать TLS, проверять необходимые порты и состояние сервисов;
- предоставлять понятный отчёт об успехе или ошибках установки;
- не сохранять постоянный SSH-доступ, если он не требуется для явно включённого управления или обновления.

Скрипты установки должны быть идемпотентными настолько, насколько это практически возможно. Повторный запуск не должен без предупреждения уничтожать конфигурацию или пользовательские данные.

## Профили и приватность

Локальный профиль и профиль на конкретном сервере следует различать. На VPS отправляются только необходимые публичные поля, например отображаемое имя, аватар, описание и публичный ключ. Любое новое поле должно оцениваться с точки зрения необходимости и приватности.

Основные принципы:

- минимизация собираемых и передаваемых данных;
- отсутствие скрытой телеметрии;
- явное согласие на отправку необязательных данных;
- запрет на передачу приватных ключей;
- безопасное хранение локальных секретов средствами операционной системы;
- понятное информирование о том, какие данные доступны владельцу VPS;
- отсутствие механизма сброса, способного обойти доказательство владения идентичностью.

## Голосовая связь

Голосовая связь рассматривается как отдельная подсистема. Предпочтительным направлением является WebRTC с серверным сигналингом. При проектировании необходимо учитывать NAT, TURN и групповые звонки. Для масштабируемых групповых комнат может потребоваться SFU. Конкретные реализации и библиотеки должны выбираться после прототипирования и измерений, а не предполагаться заранее.

## Технологический стек

Основной язык и среда выполнения проекта — JavaScript/TypeScript и Node.js. Для нового кода предпочтителен TypeScript, если иное не обосновано требованиями конкретного модуля.

Дополнительные технологии:

- Docker и Docker Compose для упаковки и развёртывания серверной части;
- SQL-база данных для постоянного хранения серверных данных;
- SSH для первоначального развёртывания и явно разрешённого администрирования;
- WebRTC как предпочтительное направление для голосовой связи.

Текущие утверждённые решения: Electron + Next.js для Windows-клиента, Fastify + WebSocket для сервера, Zod-схемы общего протокола и PostgreSQL в production. Локальная разработка использует PGlite, чтобы не требовать Docker. Голосовая библиотека пока не утверждена. Не добавляйте тяжёлую зависимость или новый инфраструктурный компонент без документированного обоснования.

## Предполагаемая структура репозитория

```text
OpenCord/
├── client/       # пользовательский интерфейс и локальная идентичность
├── server/       # API, сообщения, профили, права и голосовой сигналинг
├── deploy/       # Docker Compose, SSH-установка и обновления
├── shared/       # общие типы, схемы и контракт протокола
├── docs/         # архитектура, безопасность и документация протокола
└── AGENTS.md
```

Это целевая структура, а не требование создавать пустые каталоги заранее. Общий код должен попадать в `shared/` только тогда, когда он действительно используется несколькими частями системы и не раскрывает серверные секреты клиенту.

## Правила разработки для агентов

- Перед изменениями изучите существующую структуру, документацию и конфигурацию проекта.
- Сохраняйте разделение клиента, сервера и установщика. Не помещайте серверные секреты или административную логику в клиентский пакет.
- Используйте TypeScript и строгую типизацию для новых модулей, если проектом не установлено иное.
- Валидируйте все данные на границах системы: пользовательский ввод, API, WebSocket-события, файлы и параметры SSH.
- Никогда не коммитьте пароли, приватные ключи, токены, `.env` с секретами или реальные данные пользователей.
- Для изменений протокола синхронно обновляйте общие схемы, сервер, клиент и документацию совместимости.
- Для изменений схемы SQL добавляйте версионируемые миграции; не изменяйте рабочие данные разрушительным способом без явного согласования.
- Не ослабляйте проверку идентичности ради удобства восстановления профиля.
- Добавляйте тесты для аутентификации, прав доступа, миграций, обработки сообщений и сценариев отказа установщика.
- Не заявляйте о безопасности, анонимности или шифровании без точного описания модели угроз и фактически реализованных гарантий.
- Документируйте существенные архитектурные решения и их компромиссы в `docs/`.

## Приоритеты первой версии

Первая версия должна сосредоточиться на минимальном сквозном сценарии:

1. Создание локальной идентичности и безопасное сохранение ключа.
2. Развёртывание одного экземпляра сервера на VPS.
3. Подключение клиента и регистрация публичного профиля.
4. Создание текстового канала, отправка и получение сообщений.
5. Сохранение и загрузка истории из SQL-базы.
6. Базовые роли и проверка доступа.
7. Прототип голосовой комнаты после стабилизации текстового контура.

Оптимизация, федерация между VPS, сквозное шифрование и сложное масштабирование являются последующими этапами, если для них не поставлена отдельная задача.
