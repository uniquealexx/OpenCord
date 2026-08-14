# OpenCord Protocol v28 (English)

The protocol version describes the compatibility of WebSocket events and does not coincide with the SemVer version of OpenCord Server. The public contract of the version and server state is described in [health.md](./health.md).

## Transport

The client connects to `ws://host/ws` for local development or `wss://host/ws` in production. JSON events are validated by the shared Zod schemas from `@opencord/shared`. The maximum WebSocket payload size is about 2 MB; message text is limited to 4000 characters.

## Authentication

1. The server sends `auth.challenge` with random 32 bytes and a validity period of 60 seconds.
2. The client signs the decoded challenge with the private Ed25519 key.
3. The client responds with `auth.respond` containing the protocol version, the public SPKI key, the signature, and the public profile.
4. The server verifies the expiry, the request ID, and the signature, then computes the user ID as the SHA-256 of the public key.
5. After `auth.ok` the server sends `server.snapshot`; only an authenticated client can request history and write messages.

The challenge is single-use within a connection. The private key is not included in any network event.

`auth.ok` also contains a short-lived HTTP session bearer token. It is stored only in the client's memory, is deleted by the server when the WebSocket is closed, and is used exclusively for uploading and downloading attachments.

## Public profiles, avatars, and banners

`auth.respond.profile` contains the display name, a public description of up to 160 characters, optional public avatar and banner, and the chosen status: `online`, `idle`, `dnd`, or `invisible`. After a file is selected, the client shows a local cropping editor with panning and zoom. The selected avatar square is scaled down to 128×128 and encoded as WebP of at most 96 KB. The banner is cropped to a 5:2 ratio, scaled down to at most 600×240, and encoded as WebP of at most 256 KB. The server re-validates the format and size limits and stores a single current version of the user's profile — messages do not create separate copies. The server avatar uses the same square-frame editor before separate server-side compression.

The name, description, avatar, and banner are returned in `server.snapshot.members` and `member.updated`; the current name and avatar are also used by events and the message history. Therefore one server profile is used by the member list, the text chat, and the voice room interface, while the banner is shown in the profile preview that opens. When the profile or status changes, the client sends `profile.update` over the existing WebSocket without reconnecting. The server replaces the previous public fields in the user's single record and broadcasts `member.updated` to all active clients. On explicit leave, the public description, avatar, and banner are cleared on the server.

`auth.respond.profile` additionally contains `username` (2–32 lowercase letters, digits, dots, underscores, or dashes; it is used for @mentions) and the four-digit `discriminator` that completes the `username#1234` tag. The discriminator is generated once by the client together with the Ed25519 key pair and stored next to the keys; resetting the identity generates a new one. Identical tags belonging to different people are allowed by design. Each member entry also carries `fingerprint` — the SHA-256 fingerprint of the public key formatted as `XXXX-XXXX-XXXX-XXXX` — so identical tags can be told apart by comparing the identity codes shown in profile previews. The fingerprint is derived from the public key the server already stores, so it adds no new disclosure.

The status is stored locally and re-sent on the next connection. The server keeps presence only in the memory of the active WebSocket connection: `online`, `idle`, and `dnd` are visible to other members as "Online", "Idle", and "Do Not Disturb". `invisible` is never revealed to other clients and is converted by the server into a public `offline`; after the last connection is closed, any user also becomes `offline`.

On explicit leave, the client sends `server.leave`. The server clears the user's description, avatar, and banner; for a regular member it also removes the membership and broadcasts `member.removed`. The owner is not removed from membership without a transfer of ownership or deletion of the server, but their public media are still cleared and the other clients receive `member.updated`. Historical messages are retained, but no longer contain the removed avatar on the next load.

## Attachments

- `POST /api/attachments` accepts an `application/octet-stream` stream up to 10 MB. The name is passed in `x-opencord-file-name` as UTF-8 base64url, and the MIME type in `x-opencord-mime-type`.
- `chat.send.attachmentIds` associates up to five files pre-uploaded by the current user with the message.
- `message.update.attachmentIds` passes the final list of attachments after editing. The author may keep the previous files, detach them, or add their own pre-uploaded files; detached attachments are removed from the metadata and the file storage.
- The `chat.send.content` text may be empty if at least one `attachmentId` is provided; a completely empty message is rejected by the protocol.
- `GET /api/attachments/:id` is available to an authenticated member of the server and always returns the file as a download with `X-Content-Type-Options: nosniff`.

Metadata and relations are stored in PostgreSQL, and the bytes through the `AttachmentStorage` abstraction; the current implementation uses the filesystem. This is not end-to-end encryption: the VPS owner has technical access to the files. Antivirus scanning, quotas, S3/MinIO, and a lost-upload collector are not implemented yet.

The Electron client displays images up to 10 MB via a verified data URL. MP4, WebM, and Ogg videos of any size allowed by the server are downloaded as a stream into a temporary directory, verified during download against the declared size and SHA-256, and then played from the local file. The cache is cleared on the next client launch; this allows viewing and seeking videos larger than 10 MB without converting the whole file to base64 and without holding it in the renderer process's memory. Previews are loaded only around the visible area of the chat. All transfers of 8 MiB or more are serialized and limited by the client to 8 MiB/s, and to 2 MiB/s during a voice session; this is a local client QoS policy and is not a new server network protocol field.

## Core events

### Message search

An authenticated client sends `message.search` with a `filters` object. The search is performed by the server over all text channels of the current server and is returned only to the requesting client via `message.search.result` with the same `requestId`.

- `query` searches case-insensitively in the message text and the attachment name; the string may be left empty if an author, a channel, or at least one content type is selected;
- `authorId` limits the results to a single author;
- `channelId` limits the results to a single text channel;
- `contentTypes` accepts `text`, `image`, `video`, and `file`; the selected types are combined with an OR condition, and `file` means an attachment that is not an image or a video;
- `offset` and `limit` define the page, and the response contains `total` and `hasMore`.

An empty request without a single filter is rejected by the shared Zod schema. The "Attachments" button in the client sends an empty `query` and simultaneously selects `image`, `video`, and `file`. Image search classifies the attachment's MIME type and does not perform object or text recognition inside the file.

### Mentions

A client may mention server members in the composer with `@username` or `@username#1234`. The composer suggests matching members after `@` (avatar, tag, and a short prefix of the identity code) and inserts the chosen tag. When sending, the client resolves `@username[#1234]` into member IDs: a unique match is selected, and an ambiguous token resolves to the first candidate in the member-list order; the autocomplete with identity codes is the reliable way to pick an exact person.

The transmitted message stores mentions as `<@userId>` markers inside the plain-text content plus a separate `mentions` array of user IDs, so renames never break old mentions. `chat.send.mentions` and `message.update.mentions` accept up to 20 unique member IDs; the server silently drops IDs that are not members of the current server and stores the rest in the `message_mentions` table. The history and search results return `mentions` as well.

The chat renders a mention as a highlighted chip with the mentioned member's current display name; clicking it opens the profile preview. Mentions of members who have left render as a plain "unknown user" chip. A message may consist of only an attachment and mentions; the 4000-character limit applies to the content including its markers.

### Private messages and slash commands

The client composer supports slash commands: `/pm @user message` sends a private message, `/apm @user message` sends an anonymous private message, `/roll` posts a random number from 0 to 100 (generated locally by the client), and `/mute @user` / `/unmute @user` control the chat mute.

`chat.pm` and `chat.apm` create a message with `kind: "pm"` or `kind: "apm"` and a `targetUserId`. Such messages are stored in the channel but delivered only to the author and the target — both as live `message.created`/`message.updated`/`message.deleted` events and in `history.result`, which filters out private messages that the viewer does not participate in. For `/apm` the recipient receives a masked copy: a synthetic `authorId`, the name "Anonymous", and no avatar, so the sender's identity is not revealed to the recipient; the sender sees their own message as usual. Private messages do not appear in `message.search` results. Sending a private message to yourself, to a non-member, or into a non-existent channel is rejected.

`chat.mute.set` requires the `MANAGE_MESSAGES` permission held by the owner and administrators. The owner can mute administrators and members, an administrator only regular members; muting oneself or the owner is forbidden. The event carries an optional `durationMinutes` (1–10080): when present, the mute expires automatically after that period and the server lazily lifts it on the next message attempt; `null` means an indefinite mute. A muted member's `chat.send`, `chat.pm`, and `chat.apm` are rejected with `FORBIDDEN`; the mute state is part of each `member` entry (`chatMuted`, plus `chatMutedUntil` for a timed mute) and is updated live via `member.updated`.

The client sends:

- `auth.respond`;
- `history.request`;
- `message.search`;
- `chat.send`;
- `chat.pm`, `chat.apm`, `chat.mute.set`;
- `message.update`;
- `message.delete`;
- `profile.update`;
- `server.leave`;
- `server.avatar.update`;
- `server.settings.update`;
- `channel.create`;
- `channel.update`;
- `channel.delete`;
- `member.role.set`;
- `member.kick`;
- `voice.join`, `voice.leave`, `voice.state.update`, `voice.member.disconnect`, `voice.member.mute`;
- `server.delete`;
- `ping`.

The server sends:

- `auth.challenge`, `auth.ok`;
- `server.snapshot`, `server.avatar.updated`;
- `server.deleted`;
- `history.result`;
- `message.search.result`;
- `message.created`, `message.updated`, `message.deleted`;
- `member.updated`, `member.removed`;
- `voice.join.authorized`, `voice.participant.joined`, `voice.participant.updated`, `voice.participant.left`, `voice.participant.disconnected`;
- `pong`, `error`.

`channel.create`, `channel.update`, and `channel.delete` require the `MANAGE_CHANNELS` permission, which the owner and administrators hold. The type of an existing channel is not changed; when a channel is deleted, PostgreSQL cascades deletion to its messages, after which the server broadcasts a new `server.snapshot` to all clients.

`member.kick` removes the member's membership and public avatar, ends their voice and WebSocket sessions, and broadcasts `member.removed`. This is a removal, not a ban: the user may later manually add the server address again. The owner can kick administrators and regular members, an administrator only regular members; one cannot kick themselves or the owner.

A voice channel contains `participantLimit`: values `1–25` define a finite capacity, while `0` means an experimental mode without a limit (`∞` in the client). Text channels always pass `null`. The limit is checked by OpenCord Server before issuing a LiveKit token, so a change applies to an already created room without recreating it.

`VoicePresence` contains `userId`, `channelId`, `muted`, `deafened`, `serverMuted`, and `viewingScreenShareUserId`. After joining a LiveKit room, when toggling mute, and when selecting or closing a screen share, the client sends `voice.state.update`; the server accepts the state only from the connected user themselves, verifies that the selected presenter is in the same voice channel, and broadcasts `voice.participant.updated`. Through `viewingScreenShareUserId`, clients display the current list of viewers for each screen share. The owner or an administrator with a higher role can send `voice.member.mute`: the server sets `serverMuted`, forbids the selected participant from publishing the `MICROPHONE` source via LiveKit permissions, but keeps the ability to share the screen. When the server mute is lifted, the microphone permission is restored, and the client restores its own button state. A regular member cannot perform this operation, an administrator cannot mute the owner or another administrator, and a user cannot apply it to themselves. Audio is not transmitted over the OpenCord WebSocket.

`message.update` is allowed exclusively to the message author. Even the owner and an administrator cannot edit someone else's text or attachments. The event contains the final `attachmentIds`: the server accepts the existing attachments of this message and new unused uploads by the author, atomically replaces the relations, and deletes the detached files. After the change the server sets `editedAt` and broadcasts `message.updated`. `message.delete` is allowed to the author, and for others' messages to the owner and administrators with the `MANAGE_MESSAGES` permission; the server broadcasts `message.deleted` and deletes the associated attachments.

`server.avatar.update` is available only to the owner with the `MANAGE_SERVER` permission. After saving, the server immediately broadcasts the lightweight `server.avatar.updated` event to all connected members; the client updates its local state and the icon without reconnecting or re-requesting the history. The avatar is also included in the initial `server.snapshot`, so users who connect later receive the current image. PNG, JPEG, and WebP are allowed as a data URL up to 1.5 MB.

`server.settings.update` is available only to the owner with the `MANAGE_SERVER` permission and atomically changes the server name, the attachment limit, the maximum screen-share quality (480p, 720p, 1080p, or "Source" with a contract value of 1440), and the maximum frame rate (15, 30, or 60 FPS). The "Source" mode keeps the original resolution up to a limit of 2560×1440 without artificially upscaling smaller frames. After saving, the server broadcasts a new `server.snapshot`, so the settings update on all connected clients without reconnecting. The name changed by the owner is preserved when the same deployment restarts.

`server.delete` is available only to the owner. The server stores a tombstone and sends `server.deleted` to all active clients; a client that was offline will receive the same event after its next authentication. The exact fields and constraints are defined by the `shared/src/protocol.ts` schemas. Incompatible changes require incrementing `PROTOCOL_VERSION`.

## Storage

Local development uses PGlite with PostgreSQL-compatible migrations. Production uses the same repository and migrations through a regular PostgreSQL `DATABASE_URL`. The current schema contains the server, channels, public profiles (including `username` and `discriminator`), messages, message mentions (`message_mentions`), and attachment metadata. Files reside in `ATTACHMENTS_DIR` (`server/.data/attachments` locally, a separate Docker volume, or `/var/lib/opencord/attachments` for a native install).

---

# OpenCord Protocol v28 (Русский)

Версия протокола описывает совместимость WebSocket-событий и не совпадает с SemVer-версией OpenCord Server. Публичный контракт версии и состояния сервера описан в [health.md](./health.md).

## Транспорт

Клиент подключается к `ws://host/ws` для локальной разработки или `wss://host/ws` в production. JSON-события валидируются общими Zod-схемами из `@opencord/shared`. Максимальный размер WebSocket payload — около 2 МБ; текст сообщения ограничен 4000 символами.

## Аутентификация

1. Сервер отправляет `auth.challenge` со случайными 32 байтами и сроком действия 60 секунд.
2. Клиент подписывает decoded challenge приватным Ed25519-ключом.
3. Клиент отвечает `auth.respond` с версией протокола, публичным SPKI-ключом, подписью и публичным профилем.
4. Сервер проверяет срок, request ID и подпись, затем вычисляет ID пользователя как SHA-256 публичного ключа.
5. После `auth.ok` сервер отправляет `server.snapshot`; только аутентифицированный клиент может запрашивать историю и писать сообщения.

Challenge одноразовый в рамках соединения. Приватный ключ не входит ни в одно сетевое событие.

`auth.ok` также содержит непродолжительный bearer-токен HTTP-сессии. Он хранится только в памяти клиента, удаляется сервером при закрытии WebSocket и используется исключительно для загрузки и скачивания вложений.

## Публичные профили, аватары и шапки

`auth.respond.profile` содержит отображаемое имя, публичное описание длиной до 160 символов, необязательные публичные аватар и шапку, а также выбранный статус: `online`, `idle`, `dnd` или `invisible`. После выбора файла клиент показывает локальный редактор кадрирования с перемещением и масштабом. Выбранный квадрат аватара уменьшается до 128×128 и кодируется в WebP размером не более 96 КБ. Шапка кадрируется в пропорции 5:2, уменьшается максимум до 600×240 и кодируется в WebP размером не более 256 КБ. Сервер повторно проверяет формат и ограничения размера и хранит одну актуальную версию профиля пользователя — сообщения не создают отдельных копий. Аватар сервера использует тот же редактор квадратного кадра перед отдельным серверным сжатием.

Имя, описание, аватар и шапка возвращаются в `server.snapshot.members` и `member.updated`; актуальные имя и аватар также используются событиями и историей сообщений. Поэтому один серверный профиль используется списком участников, текстовым чатом и интерфейсом голосовой комнаты, а шапка показывается в открываемом превью профиля. При смене профиля или статуса клиент отправляет `profile.update` по существующему WebSocket без переподключения. Сервер заменяет прежние публичные поля в единственной записи пользователя и рассылает `member.updated` всем активным клиентам. При явном выходе публичные описание, аватар и шапка очищаются на сервере.

`auth.respond.profile` дополнительно содержит `username` (2–32 строчные буквы, цифры, точки, подчёркивания или дефисы; используется для упоминаний через @) и четырёхзначный `discriminator`, дополняющий тег `username#1234`. Дискриминатор генерируется клиентом один раз вместе с парой Ed25519-ключей и хранится рядом с ключами; сброс идентичности создаёт новый. Совпадения тегов у разных людей допустимы по замыслу. Каждая запись участника также несёт `fingerprint` — SHA-256-отпечаток публичного ключа в формате `XXXX-XXXX-XXXX-XXXX`, чтобы одинаковые теги можно было различить сравнением кодов идентичности в превью профиля. Отпечаток выводится из уже хранимого на сервере публичного ключа, поэтому нового раскрытия данных не добавляет.

Статус сохраняется локально и повторно отправляется при следующем подключении. Сервер держит присутствие только в памяти активного WebSocket-соединения: `online`, `idle` и `dnd` видны другим участникам как «В сети», «Недоступен» и «Не беспокоить». `invisible` никогда не раскрывается другим клиентам и преобразуется сервером в публичный `offline`; после закрытия последнего соединения любой пользователь также становится `offline`.

При явном выходе клиент отправляет `server.leave`. Сервер очищает описание, аватар и шапку пользователя; для обычного участника также удаляет членство и рассылает `member.removed`. Владелец не удаляется из членства без передачи владения или удаления сервера, но его публичные медиа всё равно очищаются и остальные клиенты получают `member.updated`. Исторические сообщения сохраняются, однако больше не содержат удалённый аватар при следующей загрузке.

## Вложения

- `POST /api/attachments` принимает поток `application/octet-stream` размером до 10 МБ. Имя передаётся в `x-opencord-file-name` как UTF-8 base64url, MIME-тип — в `x-opencord-mime-type`.
- `chat.send.attachmentIds` связывает с сообщением до пяти предварительно загруженных текущим пользователем файлов.
- `message.update.attachmentIds` передаёт итоговый список вложений после редактирования. Автор может сохранить прежние файлы, открепить их или добавить собственные предварительно загруженные файлы; снятые вложения удаляются из метаданных и файлового хранилища.
- Текст `chat.send.content` может быть пустым, если передан хотя бы один `attachmentId`; полностью пустое сообщение отклоняется протоколом.
- `GET /api/attachments/:id` доступен аутентифицированному участнику сервера и всегда отдаёт файл как скачивание с `X-Content-Type-Options: nosniff`.

Метаданные и связи хранятся в PostgreSQL, байты — через абстракцию `AttachmentStorage`; текущая реализация использует файловую систему. Это не сквозное шифрование: владелец VPS имеет технический доступ к файлам. Антивирусная проверка, квоты, S3/MinIO и сборщик потерянных загрузок пока не реализованы.

Electron-клиент показывает изображения до 10 МБ через проверенный data URL. Видео MP4, WebM и Ogg любого разрешённого сервером размера скачиваются потоком во временный каталог, во время загрузки проверяются по заявленному размеру и SHA-256, после чего воспроизводятся из локального файла. Кэш очищается при следующем запуске клиента; это позволяет просматривать и перематывать видео больше 10 МБ, не превращая весь файл в base64 и не удерживая его в памяти renderer-процесса. Превью загружаются только около видимой области чата. Все передачи от 8 МиБ сериализуются и ограничиваются клиентом до 8 МиБ/с, а во время голосовой сессии — до 2 МиБ/с; это локальная QoS-политика клиента и не является новым полем сетевого протокола сервера.

## Основные события

### Поиск сообщений

Аутентифицированный клиент отправляет `message.search` с объектом `filters`. Поиск выполняется сервером по всем текстовым каналам текущего сервера и возвращается только запросившему клиенту через `message.search.result` с тем же `requestId`.

- `query` ищет без учёта регистра в тексте сообщения и имени вложения; строку можно оставить пустой, если выбран автор, канал или хотя бы один тип содержимого;
- `authorId` ограничивает результаты одним автором;
- `channelId` ограничивает результаты одним текстовым каналом;
- `contentTypes` принимает `text`, `image`, `video` и `file`; выбранные типы объединяются условием OR, а `file` означает вложение, которое не является изображением или видео;
- `offset` и `limit` задают страницу, ответ содержит `total` и `hasMore`.

Пустой запрос без единого фильтра отклоняется общей Zod-схемой. Кнопка «Вложения» в клиенте отправляет пустой `query` и одновременно выбирает `image`, `video` и `file`. Поиск по изображениям классифицирует MIME-тип вложения и не выполняет распознавание объектов или текста внутри файла.

### Упоминания

Клиент может упомянуть участников сервера в поле ввода через `@username` или `@username#1234`. Поле ввода после `@` предлагает подходящих участников (аватар, тег и короткий префикс кода идентичности) и вставляет выбранный тег. При отправке клиент резолвит `@username[#1234]` в ID участников: выбирается единственное совпадение, а при неоднозначности — первый кандидат в порядке списка участников; автокомплит с кодами идентичности — надёжный способ выбрать точного человека.

Передаваемое сообщение хранит упоминания как маркеры `<@userId>` внутри обычного текста плюс отдельный массив `mentions` из ID, поэтому переименования не ломают старые упоминания. `chat.send.mentions` и `message.update.mentions` принимают до 20 уникальных ID участников; сервер молча отбрасывает ID, не являющиеся участниками текущего сервера, а остальные сохраняет в таблицу `message_mentions`. История и результаты поиска также возвращают `mentions`.

Чат отображает упоминание как подсвеченный чип с актуальным отображаемым именем упомянутого участника; клик открывает превью профиля. Упоминания выбывших участников отображаются простым чипом «неизвестный пользователь». Сообщение может состоять только из вложения и упоминаний; лимит в 4000 символов применяется к контенту вместе с маркерами.

### Личные сообщения и слэш-команды

Поле ввода клиента поддерживает слэш-команды: `/pm @пользователь сообщение` отправляет личное сообщение, `/apm @пользователь сообщение` — анонимное личное, `/roll` публикует случайное число от 0 до 100 (генерируется локально клиентом), а `/mute @пользователь` и `/unmute @пользователь` управляют мутом чата.

`chat.pm` и `chat.apm` создают сообщение с `kind: "pm"` или `kind: "apm"` и полем `targetUserId`. Такие сообщения хранятся в канале, но доставляются только отправителю и получателю — и как живые события `message.created`/`message.updated`/`message.deleted`, и в `history.result`, который отфильтровывает личные сообщения, в которых зритель не участвует. При `/apm` получатель получает замаскированную копию: синтетический `authorId`, имя «Аноним» и без аватара — личность отправителя получателю не раскрывается; сам отправитель видит своё сообщение как обычно. В результатах `message.search` личные сообщения не появляются. Отправка личного сообщения самому себе, не-участнику или в несуществующий канал отклоняется.

`chat.mute.set` требует разрешения `MANAGE_MESSAGES`, которым обладают владелец и администраторы. Владелец может мутить администраторов и участников, администратор — только обычных участников; мутить себя или владельца нельзя. Событие несёт необязательный `durationMinutes` (1–10080): при наличии срока мут истекает автоматически, и сервер лениво снимает его при следующей попытке отправить сообщение; `null` означает бессрочный мут. Сообщения (`chat.send`, `chat.pm`, `chat.apm`) замьюченного участника отклоняются с `FORBIDDEN`; состояние мута входит в каждую запись `member` (`chatMuted`, а для срочного мута ещё `chatMutedUntil`) и обновляется вживую через `member.updated`.

Клиент отправляет:

- `auth.respond`;
- `history.request`;
- `message.search`;
- `chat.send`;
- `chat.pm`, `chat.apm`, `chat.mute.set`;
- `message.update`;
- `message.delete`;
- `profile.update`;
- `server.leave`;
- `server.avatar.update`;
- `server.settings.update`;
- `channel.create`;
- `channel.update`;
- `channel.delete`;
- `member.role.set`;
- `member.kick`;
- `voice.join`, `voice.leave`, `voice.state.update`, `voice.member.disconnect`, `voice.member.mute`;
- `server.delete`;
- `ping`.

Сервер отправляет:

- `auth.challenge`, `auth.ok`;
- `server.snapshot`, `server.avatar.updated`;
- `server.deleted`;
- `history.result`;
- `message.search.result`;
- `message.created`, `message.updated`, `message.deleted`;
- `member.updated`, `member.removed`;
- `voice.join.authorized`, `voice.participant.joined`, `voice.participant.updated`, `voice.participant.left`, `voice.participant.disconnected`;
- `pong`, `error`.

`channel.create`, `channel.update` и `channel.delete` требуют разрешения `MANAGE_CHANNELS`, которым обладают владелец и администраторы. Тип существующего канала не изменяется; при удалении канала PostgreSQL каскадно удаляет его сообщения, после чего сервер рассылает всем клиентам новый `server.snapshot`.

`member.kick` удаляет членство и публичный аватар участника, завершает его голосовую и WebSocket-сессии и рассылает `member.removed`. Это исключение, а не бан: пользователь может позднее вручную добавить адрес сервера снова. Владелец может исключать администраторов и обычных участников, администратор — только обычных участников; исключить себя или владельца нельзя.

Голосовой канал содержит `participantLimit`: значения `1–25` задают конечную вместимость, а `0` означает экспериментальный режим без ограничения (`∞` в клиенте). Текстовые каналы всегда передают `null`. Лимит проверяет OpenCord Server перед выдачей LiveKit-токена, поэтому изменение применяется к уже созданной комнате без её пересоздания.

`VoicePresence` содержит `userId`, `channelId`, `muted`, `deafened`, `serverMuted` и `viewingScreenShareUserId`. После входа в LiveKit-комнату, при переключении заглушки и при выборе либо закрытии демонстрации клиент отправляет `voice.state.update`; сервер принимает состояние только от самого подключённого пользователя, проверяет, что выбранный ведущий находится в том же голосовом канале, и рассылает `voice.participant.updated`. По `viewingScreenShareUserId` клиенты отображают актуальный список зрителей каждой демонстрации. Владелец либо администратор с более высокой ролью может отправить `voice.member.mute`: сервер выставляет `serverMuted`, запрещает выбранному участнику публиковать источник `MICROPHONE` через разрешения LiveKit, но сохраняет возможность демонстрировать экран. При снятии серверного мута разрешение микрофона возвращается, а клиент восстанавливает собственное состояние кнопки. Обычный участник не может выполнить эту операцию, администратор не может заглушить владельца или другого администратора, а пользователь не может применить её к себе. Аудио через WebSocket OpenCord не передаётся.

`message.update` разрешён исключительно автору сообщения. Даже владелец и администратор не могут редактировать чужой текст или вложения. Событие содержит итоговый `attachmentIds`: сервер принимает существующие вложения этого сообщения и новые незанятые загрузки автора, атомарно заменяет связи и удаляет откреплённые файлы. После изменения сервер устанавливает `editedAt` и рассылает `message.updated`. `message.delete` разрешён автору, а для чужих сообщений — владельцу и администраторам с правом `MANAGE_MESSAGES`; сервер рассылает `message.deleted` и удаляет связанные вложения.

`server.avatar.update` доступен только владельцу с разрешением `MANAGE_SERVER`. После сохранения сервер немедленно рассылает всем подключённым участникам лёгкое событие `server.avatar.updated`; клиент обновляет локальное состояние и иконку без переподключения и повторного запроса истории. Аватар также входит в начальный `server.snapshot`, поэтому актуальное изображение получают пользователи, подключившиеся позднее. Допустимы PNG, JPEG и WebP в виде data URL размером до 1,5 МБ.

`server.settings.update` доступен только владельцу с разрешением `MANAGE_SERVER` и атомарно изменяет название сервера, лимит вложений, максимальное качество демонстрации (480p, 720p, 1080p или «Источник» с контрактным значением 1440) и максимальную частоту кадров (15, 30 или 60 FPS). Режим «Источник» сохраняет исходное разрешение до предела 2560×1440 без искусственного увеличения меньших кадров. После сохранения сервер рассылает новый `server.snapshot`, поэтому настройки обновляются у всех подключённых клиентов без переподключения. Название, изменённое владельцем, сохраняется при перезапуске того же deployment.

`server.delete` доступен только владельцу. Сервер сохраняет tombstone и отправляет `server.deleted` всем активным клиентам; клиент, который был офлайн, получит то же событие после следующей аутентификации. Точные поля и ограничения определяются схемами `shared/src/protocol.ts`. Несовместимые изменения требуют увеличения `PROTOCOL_VERSION`.

## Хранение

Локальный development использует PGlite с PostgreSQL-совместимыми миграциями. Production использует тот же repository и миграции через обычный PostgreSQL `DATABASE_URL`. Текущая схема содержит сервер, каналы, публичные профили (включая `username` и `discriminator`), сообщения, упоминания (`message_mentions`) и метаданные вложений. Файлы лежат в `ATTACHMENTS_DIR` (`server/.data/attachments` локально, отдельный volume Docker или `/var/lib/opencord/attachments` при native-установке).

---

# OpenCord 协议 v28 (中文)

协议版本描述了 WebSocket 事件的兼容性，并且与 OpenCord Server 的 SemVer 版本不一致。版本和服务器状态的公共契约在 [health.md](./health.md) 中描述。

## 传输

客户端连接到 `ws://host/ws` 用于本地开发，或在生产环境中连接到 `wss://host/ws`。JSON 事件由来自 `@opencord/shared` 的共享 Zod 模式进行验证。WebSocket payload 的最大大小约为 2 MB；消息文本限制为 4000 个字符。

## 身份验证

1. 服务器发送带有随机 32 字节且有效期为 60 秒的 `auth.challenge`。
2. 客户端使用私有 Ed25519 密钥对 decoded challenge 进行签名。
3. 客户端以 `auth.respond` 响应，包含协议版本、公开 SPKI 密钥、签名和公开个人资料。
4. 服务器验证有效期、request ID 和签名，然后将公钥的 SHA-256 计算为用户 ID。
5. 在 `auth.ok` 之后，服务器发送 `server.snapshot`；只有经过身份验证的客户端才能请求历史记录并发送消息。

Challenge 在单个连接内是一次性的。私钥不会出现在任何网络事件中。

`auth.ok` 还包含一个短期的 HTTP 会话 bearer 令牌。它只存储在客户端内存中，在 WebSocket 关闭时由服务器删除，并且仅用于上传和下载附件。

## 公开个人资料、头像和横幅

`auth.respond.profile` 包含显示名称、最长 160 个字符的公开描述、可选的公开头像和横幅，以及所选的状态：`online`、`idle`、`dnd` 或 `invisible`。选择文件后，客户端会显示一个带有平移和缩放的本地裁剪编辑器。选定的头像正方形会缩小到 128×128，并编码为不超过 96 KB 的 WebP。横幅按 5:2 的比例裁剪，最大缩小到 600×240，并编码为不超过 256 KB 的 WebP。服务器会再次验证格式和大小限制，并存储用户个人资料的一个当前版本——消息不会创建单独的副本。服务器头像在单独的服务器端压缩之前使用相同的正方形画面编辑器。

名称、描述、头像和横幅在 `server.snapshot.members` 和 `member.updated` 中返回；当前的名称和头像也会被事件和消息历史使用。因此，一个服务器个人资料被成员列表、文本聊天和语音房间界面共同使用，而横幅显示在打开的个人资料预览中。当个人资料或状态发生变化时，客户端会通过现有 WebSocket 发送 `profile.update`，无需重新连接。服务器在用户的唯一记录中替换之前的公开字段，并向所有活动客户端广播 `member.updated`。在明确退出时，服务器会清除公开描述、头像和横幅。

`auth.respond.profile` 还包含 `username`（2–32 个小写字母、数字、点、下划线或连字符；用于 @提及）以及构成 `username#1234` 标签的四位 `discriminator`。判别号由客户端与 Ed25519 密钥对一起生成一次，并存储在密钥旁边；重置身份会生成新的判别号。不同的人拥有相同的标签在设计上是允许的。每个成员条目还带有 `fingerprint`——公钥的 SHA-256 指纹，格式为 `XXXX-XXXX-XXXX-XXXX`——这样可以通过比较个人资料预览中显示的身份代码来区分相同的标签。指纹来源于服务器已存储的公钥，因此不会增加新的数据披露。

状态在本地保存，并在下次连接时重新发送。服务器仅在活动 WebSocket 连接的内存中维护在线状态：`online`、`idle` 和 `dnd` 对其他成员显示为「在线」「空闲」和「请勿打扰」。`invisible` 从不向其他客户端透露，并由服务器转换为公开的 `offline`；在最后一个连接关闭后，任何用户也会变为 `offline`。

在明确退出时，客户端发送 `server.leave`。服务器清除用户的描述、头像和横幅；对于普通成员，还会删除其成员资格并广播 `member.removed`。所有者在未转让所有权或删除服务器的情况下不会被移出成员资格，但其公开媒体仍会被清除，其他客户端会收到 `member.updated`。历史消息会保留，但在下次加载时不再包含已删除的头像。

## 附件

- `POST /api/attachments` 接受最大 10 MB 的 `application/octet-stream` 流。文件名通过 `x-opencord-file-name` 以 UTF-8 base64url 形式传递，MIME 类型通过 `x-opencord-mime-type` 传递。
- `chat.send.attachmentIds` 将当前用户预先上传的最多五个文件与消息关联。
- `message.update.attachmentIds` 传递编辑后的最终附件列表。作者可以保留之前的文件、将其移除，或添加自己预先上传的文件；被移除的附件会从元数据和文件存储中删除。
- 如果至少提供了一个 `attachmentId`，则 `chat.send.content` 文本可以为空；完全为空的消息会被协议拒绝。
- `GET /api/attachments/:id` 对服务器中经过身份验证的成员可用，并且始终以带有 `X-Content-Type-Options: nosniff` 的下载形式返回文件。

元数据和关联存储在 PostgreSQL 中，字节通过 `AttachmentStorage` 抽象存储；当前实现使用文件系统。这不是端到端加密：VPS 所有者对文件具有技术访问权限。病毒扫描、配额、S3/MinIO 和丢失上传回收器尚未实现。

Electron 客户端通过经过验证的 data URL 显示最大 10 MB 的图像。服务器允许的任何大小的 MP4、WebM 和 Ogg 视频都会以流的形式下载到临时目录，在下载期间根据声明的大小和 SHA-256 进行验证，然后从本地文件播放。缓存会在下次客户端启动时清除；这样可以在不将整个文件转换为 base64、也不将其保留在 renderer 进程内存中的情况下查看和拖动大于 10 MB 的视频。预览仅在聊天可见区域附近加载。所有达到 8 MiB 或以上的传输都会被客户端串行化并限制为 8 MiB/s，在语音会话期间限制为 2 MiB/s；这是客户端的本地 QoS 策略，而不是新的服务器网络协议字段。

## 主要事件

### 消息搜索

经过身份验证的客户端发送带有 `filters` 对象的 `message.search`。搜索由服务器在当前服务器的所有文本频道上执行，并且只通过带有相同 `requestId` 的 `message.search.result` 返回给发起请求的客户端。

- `query` 在消息文本和附件名称中进行不区分大小写的搜索；如果选择了作者、频道或至少一个内容类型，则该字符串可以为空；
- `authorId` 将结果限制为单个作者；
- `channelId` 将结果限制为单个文本频道；
- `contentTypes` 接受 `text`、`image`、`video` 和 `file`；所选类型以 OR 条件合并，而 `file` 表示不是图像或视频的附件；
- `offset` 和 `limit` 定义页面，响应包含 `total` 和 `hasMore`。

没有任何过滤器的空请求会被共享 Zod 模式拒绝。客户端中的「附件」按钮发送空的 `query`，并同时选择 `image`、`video` 和 `file`。图像搜索对附件的 MIME 类型进行分类，并且不会在文件内部执行对象或文本识别。

### 提及

客户端可以在输入框中通过 `@username` 或 `@username#1234` 提及服务器成员。输入 `@` 后，输入框会建议匹配的成员（头像、标签和身份代码的短前缀），并插入所选标签。发送时，客户端将 `@username[#1234]` 解析为成员 ID：唯一匹配会被选中，有歧义时选择成员列表顺序中的第一个候选者；带有身份代码的自动补全是选择精确对象人的可靠方式。

传输的消息将提及存储为纯文本内容中的 `<@userId>` 标记，再加上单独的 `mentions` 用户 ID 数组，因此重命名不会破坏旧的提及。`chat.send.mentions` 和 `message.update.mentions` 最多接受 20 个唯一的成员 ID；服务器会静默丢弃不是当前服务器成员的 ID，并将其余的存储到 `message_mentions` 表中。历史记录和搜索结果也会返回 `mentions`。

聊天将提及渲染为带有被提及成员当前显示名称的高亮芯片；点击它会打开个人资料预览。已离开成员的提及会渲染为普通的「未知用户」芯片。消息可以仅包含附件和提及；4000 个字符的限制适用于包含标记在内的内容。

### 私聊消息和斜杠命令

客户端输入框支持斜杠命令：`/pm @用户 消息` 发送私聊消息，`/apm @用户 消息` 发送匿名私聊消息，`/roll` 发布 0 到 100 的随机数字（由客户端本地生成），`/mute @用户` 和 `/unmute @用户` 控制聊天禁言。

`chat.pm` 和 `chat.apm` 会创建带有 `kind: "pm"` 或 `kind: "apm"` 以及 `targetUserId` 的消息。此类消息存储在频道中，但只发送给发送者和接收者——无论是实时的 `message.created`/`message.updated`/`message.deleted` 事件，还是 `history.result`（它会过滤掉查看者未参与的私聊消息）。对于 `/apm`，接收者会收到经过遮盖的副本：合成的 `authorId`、名称为「匿名」且没有头像，因此发送者的身份不会透露给接收者；发送者本人则像平常一样看到自己的消息。私聊消息不会出现在 `message.search` 结果中。向自己、非成员或发送到不存在的频道会被拒绝。

`chat.mute.set` 需要所有者和管理员所拥有的 `MANAGE_MESSAGES` 权限。所有者可以禁言管理员和成员，管理员只能禁言普通成员；不能禁言自己或所有者。事件带有可选的 `durationMinutes`（1–10080）：指定时长后禁言会自动到期，服务器会在下一次发送尝试时惰性解除；`null` 表示永久禁言。被禁言成员的 `chat.send`、`chat.pm` 和 `chat.apm` 会被拒绝并返回 `FORBIDDEN`；禁言状态包含在每个 `member` 条目中（`chatMuted`，定时禁言还有 `chatMutedUntil`），并通过 `member.updated` 实时更新。

客户端发送：

- `auth.respond`;
- `history.request`;
- `message.search`;
- `chat.send`;
- `chat.pm`, `chat.apm`, `chat.mute.set`;
- `message.update`;
- `message.delete`;
- `profile.update`;
- `server.leave`;
- `server.avatar.update`;
- `server.settings.update`;
- `channel.create`;
- `channel.update`;
- `channel.delete`;
- `member.role.set`;
- `member.kick`;
- `voice.join`, `voice.leave`, `voice.state.update`, `voice.member.disconnect`, `voice.member.mute`;
- `server.delete`;
- `ping`.

服务器发送：

- `auth.challenge`, `auth.ok`;
- `server.snapshot`, `server.avatar.updated`;
- `server.deleted`;
- `history.result`;
- `message.search.result`;
- `message.created`, `message.updated`, `message.deleted`;
- `member.updated`, `member.removed`;
- `voice.join.authorized`, `voice.participant.joined`, `voice.participant.updated`, `voice.participant.left`, `voice.participant.disconnected`;
- `pong`, `error`.

`channel.create`、`channel.update` 和 `channel.delete` 需要 `MANAGE_CHANNELS` 权限，所有者和管理员拥有该权限。现有频道的类型不会改变；删除频道时，PostgreSQL 会级联删除其消息，之后服务器向所有客户端广播新的 `server.snapshot`。

`member.kick` 会移除成员的成员资格和公开头像，结束其语音和 WebSocket 会话，并广播 `member.removed`。这是一种移除而非封禁：用户之后可以再次手动添加服务器地址。所有者可以移除管理员和普通成员，管理员只能移除普通成员；不能移除自己或所有者。

语音频道包含 `participantLimit`：`1–25` 的值定义了有限的容量，而 `0` 表示无限制的实验模式（客户端中显示为 `∞`）。文本频道始终传递 `null`。OpenCord Server 在颁发 LiveKit 令牌之前会检查该限制，因此更改会应用到已创建的房间，而无需重新创建它。

`VoicePresence` 包含 `userId`、`channelId`、`muted`、`deafened`、`serverMuted` 和 `viewingScreenShareUserId`。在加入 LiveKit 房间后、切换静音时，以及选择或关闭屏幕共享时，客户端会发送 `voice.state.update`；服务器只接受来自已连接用户本人的状态，验证所选演示者是否在同一语音频道中，并广播 `voice.participant.updated`。客户端通过 `viewingScreenShareUserId` 显示每个屏幕共享的当前观众列表。所有者或具有更高角色的管理员可以发送 `voice.member.mute`：服务器设置 `serverMuted`，通过 LiveKit 权限禁止所选参与者发布 `MICROPHONE` 源，但保留共享屏幕的能力。解除服务器静音后，麦克风权限会恢复，客户端会恢复自己的按钮状态。普通成员无法执行此操作，管理员无法静音所有者或其他管理员，用户也无法将其应用于自己。音频不会通过 OpenCord 的 WebSocket 传输。

`message.update` 仅允许消息作者使用。即使是所有者和管理员也无法编辑他人的文本或附件。该事件包含最终的 `attachmentIds`：服务器接受该消息现有的附件以及作者新上传且未被占用的文件，原子地替换关联并删除已分离的文件。更改后，服务器设置 `editedAt` 并广播 `message.updated`。`message.delete` 对作者开放，对于他人的消息，对具有 `MANAGE_MESSAGES` 权限的所有者和管理员开放；服务器广播 `message.deleted` 并删除关联的附件。

`server.avatar.update` 仅对具有 `MANAGE_SERVER` 权限的所有者可用。保存后，服务器会立即向所有已连接的成员广播轻量的 `server.avatar.updated` 事件；客户端更新本地状态和图标，而无需重新连接或重新请求历史记录。头像也包含在初始的 `server.snapshot` 中，因此稍后连接的用户会收到当前图像。允许使用 PNG、JPEG 和 WebP，以最大 1.5 MB 的 data URL 形式提供。

`server.settings.update` 仅对具有 `MANAGE_SERVER` 权限的所有者可用，并以原子方式更改服务器名称、附件限制、最大屏幕共享质量（480p、720p、1080p 或契约值为 1440 的「原始」）以及最大帧率（15、30 或 60 FPS）。「原始」模式保留原始分辨率，最高限制为 2560×1440，不会人为放大较小的帧。保存后，服务器会广播新的 `server.snapshot`，因此所有已连接客户端的设置都会更新，而无需重新连接。所有者更改的名称会在同一 deployment 重启时保留。

`server.delete` 仅对所有者可用。服务器保存 tombstone，并向所有活动客户端发送 `server.deleted`；处于离线状态的客户端将在下次身份验证后收到相同的事件。确切的字段和约束由 `shared/src/protocol.ts` 模式定义。不兼容的更改需要增加 `PROTOCOL_VERSION`。

## 存储

本地 development 使用 PGlite 和 PostgreSQL 兼容的迁移。Production 通过常规 PostgreSQL `DATABASE_URL` 使用相同的 repository 和迁移。当前模式包含服务器、频道、公开个人资料（包括 `username` 和 `discriminator`）、消息、消息提及（`message_mentions`）和附件元数据。文件位于 `ATTACHMENTS_DIR`（本地为 `server/.data/attachments`，独立的 Docker volume，或 native 安装时为 `/var/lib/opencord/attachments`）。
