# OpenCord Protocol v38 (English)

The protocol version describes the compatibility of WebSocket events and does not coincide with the SemVer version of OpenCord Server. The public contract of the version and server state is described in [health.md](./health.md).

Protocol v38 adds the optional `nameGlow` profile field — a `#rrggbb` color without alpha with which the client renders a soft diffuse glow around the nickname wherever it is shown (chat, member list, voice, mentions, profile card). It travels through `auth.respond.profile`, `profile.update`, `server.snapshot.members`, and `member.updated`. The field is optional, so a server of an earlier version stays compatible.

Protocol v37 adds the optional `accentColor` profile field — a `#rrggbb` color without alpha that tints the glass of the profile preview card. It travels through `auth.respond.profile`, `profile.update`, `server.snapshot.members`, and `member.updated`. The field is optional, so a server of an earlier version stays compatible.

Protocol v36 binds the `username#1234` tag to the identity — the server assigns and owns the discriminator — and adds the per-channel `slowmodeSeconds` rate limit together with the `channel.slowmode.set` bulk event and the `RATE_LIMITED` error code.

Protocol v35 removed the separate nickname: `username` is now the only user name in profiles, members, messages, and mentions. The custom status keeps its text of up to 32 characters and replaces the `#RRGGBB` color with an optional `customStatusEmoji` of up to 16 characters, the way Discord shows it. These fields travel through `server.settings.update`, `auth.respond.profile`, snapshots, and `member.updated` events.

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

`auth.respond.profile` contains the `username`, a public description of up to 160 characters, optional public avatar and banner, and the chosen status: `online`, `idle`, `dnd`, or `invisible`. After a file is selected, the client shows a local cropping editor with panning and zoom. The selected avatar square is scaled down to 128×128 and encoded as WebP of at most 96 KB. The banner is cropped to a 5:2 ratio, scaled down to at most 600×240, and encoded as WebP of at most 256 KB. The server re-validates the format and size limits and stores a single current version of the user's profile — messages do not create separate copies. The server avatar uses the same square-frame editor before separate server-side compression. The server banner follows the profile-banner format (5:2 crop, at most 600×240, WebP up to 256 KB): the owner updates it with `server.banner.update`, the server broadcasts `server.banner.updated`, and the snapshot includes the current `banner`.

The username, description, avatar, and banner are returned in `server.snapshot.members` and `member.updated`; the current username and avatar are also used by events and the message history. Therefore one server profile is used by the member list, the text chat, and the voice room interface, while the banner is shown in the profile preview that opens. When the profile or status changes, the client sends `profile.update` over the existing WebSocket without reconnecting. The server replaces the previous public fields in the user's single record and broadcasts `member.updated` to all active clients. On explicit leave, the public description, avatar, and banner are cleared on the server. Since protocol v37 the profile also carries the optional `accentColor` — a `#rrggbb` value without alpha with which the client tints the glass of the profile preview card; since v38 it additionally carries `nameGlow` in the same format, drawing a soft diffuse glow around the nickname. Both fields are decorative, are not included in `bannedMembers`, and are cleared together with the rest of the public fields.

`auth.respond.profile` additionally contains `username` (2–32 lowercase letters, digits, dots, underscores, or dashes; it is used for @mentions) and the four-digit `discriminator` that completes the `username#1234` tag. The discriminator in `auth.respond.profile` is only a request: the server assigns the discriminator when a key registers for the first time, keeps it bound to that identity afterwards, and ignores the value a client sends later. The requested value is honoured only when `username#discriminator` is still free; otherwise a random free discriminator is issued. The pair is unique per server, so a tag always points at exactly one identity and cannot be copied to impersonate another member. The authoritative tag reaches the client through `server.snapshot` and `member.updated`. Each member entry also carries `fingerprint` — the SHA-256 fingerprint of the public key formatted as `XXXX-XXXX-XXXX-XXXX` — so identical tags can be told apart by comparing the identity codes shown in profile previews. The fingerprint is derived from the public key the server already stores, so it adds no new disclosure.

The status is stored locally and re-sent on the next connection. The server keeps presence only in the memory of the active WebSocket connection: `online`, `idle`, and `dnd` are visible to other members as "Online", "Idle", and "Do Not Disturb". `invisible` is never revealed to other clients and is converted by the server into a public `offline`; after the last connection is closed, any user also becomes `offline`.

On explicit leave, the client sends `server.leave`. For a regular member the server removes membership, broadcasts `member.removed`, and retains the public profile for seven days so recent history remains readable. After the retention deadline a background cleanup replaces the name with `Unknown user` semantics and clears username, discriminator, description, avatar, banner, accent color, and name glow, while preserving the cryptographic identity and all messages. Rejoining before or after cleanup restores the public profile from the authenticated client. The owner is not removed without an ownership transfer or server deletion.

## Attachments

- `POST /api/attachments` accepts an `application/octet-stream` stream up to 10 MB. The name is passed in `x-opencord-file-name` as UTF-8 base64url, and the MIME type in `x-opencord-mime-type`.
- `chat.send.attachmentIds` associates up to five files pre-uploaded by the current user with the message.
- `message.update.attachmentIds` passes the final list of attachments after editing. The author may keep the previous files, detach them, or add their own pre-uploaded files; detached attachments are removed from the metadata and the file storage.
- The `chat.send.content` text may be empty if at least one `attachmentId` is provided; a completely empty message is rejected by the protocol.
- `GET /api/attachments/:id` always returns the file as a download with `X-Content-Type-Options: nosniff`. Authentication alone is not enough: the caller must be the uploader of a not yet attached file, or the attachment must hang on a message the caller may read. The visibility rule matches `history.request` — a regular message is open to every member, while a `pm`/`apm` attachment is limited to the sender and the recipient, so knowing an attachment id does not open somebody else's private conversation. Everything else answers `404`.

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

A client may mention server members in the composer with `@username` or `@username#1234`. The composer suggests matching members after `@` (avatar, `@username`, and the custom status or role) and inserts `@username`, appending `#1234` only when several members share that username. When sending, the client resolves `@username[#1234]` into member IDs: a unique match is selected, and an ambiguous token resolves to the first candidate in the member-list order; the identity code in the profile preview is the reliable way to tell two identical usernames apart.

The transmitted message stores mentions as `<@userId>` markers inside the plain-text content plus a separate `mentions` array of user IDs, so renames never break old mentions. `chat.send.mentions` and `message.update.mentions` accept up to 20 unique member IDs; the server silently drops IDs that are not members of the current server and stores the rest in the `message_mentions` table. The history and search results return `mentions` as well.

The chat renders a mention as a highlighted chip with the mentioned member's current display name; clicking it opens the profile preview. Mentions of members who have left render as a plain "unknown user" chip. A message may consist of only an attachment and mentions; the 4000-character limit applies to the content including its markers.

### Private messages and slash commands

The client composer supports slash commands: `/pm @user message` sends a private message, `/apm @user message` sends an anonymous private message, `/roll` posts a random number from 0 to 100 (generated locally by the client), and `/mute @user` / `/unmute @user` control the chat mute.

`chat.pm` and `chat.apm` create a message with `kind: "pm"` or `kind: "apm"` and a `targetUserId`. Such messages are stored in the channel but delivered only to the author and the target — both as live `message.created`/`message.updated`/`message.deleted` events and in `history.result`, which filters out private messages that the viewer does not participate in. For `/apm` the recipient receives a masked copy: a synthetic `authorId`, the name "Anonymous", and no avatar, so the sender's identity is not revealed to the recipient; the sender sees their own message as usual. Private messages do not appear in `message.search` results. Sending a private message to yourself, to a non-member, or into a non-existent channel is rejected. `message.react` respects the same boundary: a member outside the conversation receives the same `NOT_FOUND` as for a message that does not exist, so a stray reaction can neither appear in somebody else's private message nor confirm that one exists.

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
- `channel.slowmode.set`;
- `channel.delete`;
- `member.role.set`;
- `member.kick`;
- `member.ban`;
- `member.unban`;
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
- `member.updated`, `member.removed`, `profile.anonymized`;
- `voice.join.authorized`, `voice.participant.joined`, `voice.participant.updated`, `voice.participant.left`, `voice.participant.disconnected`;
- `pong`, `error`.

`channel.create`, `channel.update`, `channel.slowmode.set`, and `channel.delete` require the `MANAGE_CHANNELS` permission, which the owner and administrators hold. The type of an existing channel is not changed; when a channel is deleted, PostgreSQL cascades deletion to its messages, after which the server broadcasts a new `server.snapshot` to all clients.

A text channel carries `slowmodeSeconds` — the minimum pause between two `chat.send` messages from the same member, picked from `0, 5, 10, 30, 60, 300, 900, 3600` where `0` disables the limit. Voice channels always report `0`. The countdown is derived from stored history, so a server restart does not reset it, and holders of `MANAGE_MESSAGES` bypass it. An early message is answered with `RATE_LIMITED` and a `retryAfterMs` telling the client how long to wait. `channel.slowmode.set` applies one value to up to 100 channels at once; voice ids in the selection are skipped, and a selection with no text channel answers `NOT_FOUND`.

`message.react.emoji` must be exactly one emoji: the value has to match `\p{RGI_Emoji}`, the set of sequences Unicode recommends for interchange, so a single pictograph, a variation-selector form, a ZWJ family, a flag, a keycap, and a skin-tone modifier are all accepted while anything else is rejected with `INVALID_EVENT`. A free-form string would let a member push combining "zalgo" stacks, a right-to-left override, or plain text into somebody else's message and break the feed layout for everyone who sees it. The outbound `messageReactionSchema` stays a bounded string on purpose — tightening it would make one unexpected legacy value break the whole snapshot — so reactions stored before this rule are filtered out when read and are deleted once at server startup.

Independently of slowmode, the server enforces a fixed anti-flood limit that no setting can disable: a token bucket of 10 actions per identity refilling at 5 per 5 seconds, applied separately to messages (`chat.send`, `chat.pm`, `chat.apm`) and to `message.react`. The bucket is keyed by user, not by socket, so a second connection with the same key does not double the allowance; exceeding it also answers `RATE_LIMITED` with `retryAfterMs`.

`member.kick` removes membership, ends voice and WebSocket sessions, and broadcasts `member.removed`. The departed profile follows the same seven-day retention and anonymization policy as an explicit leave. This is a removal, not a ban: the user may later manually add the server address again. The owner can kick administrators and regular members, an administrator only regular members; one cannot kick themselves or the owner.

`member.ban` includes `durationMinutes`: one of `10`, `30`, `60`, `360`, `720`, `1440`, `4320`, `10080`, `43200`, or `null` for a permanent ban. It blocks the target cryptographic identity, removes membership, ends voice and WebSocket sessions, and rejects authentication with `BANNED` until the deadline. Expired bans are removed automatically; `member.unban` removes one early. Banned profiles follow the same seven-day retention policy, so a long or permanent ban eventually displays as an unknown user while its key fingerprint remains available. Only clients with `KICK_MEMBERS` receive `server.snapshot.bannedMembers`, including `expiresAt`; regular members receive an empty list.

The `BANNED` error carries `banExpiresAt`: the ISO deadline of the ban, or `null` when it is permanent. The banned user is the only member who does not receive `member.removed` — they get this error instead, so the client keeps the server in its list and shows a persistent ban screen with the deadline rather than an empty server. The same error, with the same field, is sent when a banned identity tries to authenticate again. The field is optional, so a server of an earlier version stays compatible; a client that does not receive it treats the ban as one of unknown duration.

A voice channel contains `participantLimit`: values `1–25` define a finite capacity, while `0` means an experimental mode without a limit (`∞` in the client). Text channels always pass `null`. The limit is checked by OpenCord Server before issuing a LiveKit token, so a change applies to an already created room without recreating it. Occupancy is counted from three sources at once — the LiveKit participant list, the presences known to the server, and tokens already issued but not yet connected (a reservation held for 15 seconds and released as soon as the participant really joins) — because a participant moves between them with a delay, and counting the list alone let simultaneous joins overfill the channel. A LiveKit token lives for 300 seconds, and a participant may be kicked, banned or demoted after it was issued — including while they have not reached the room yet, when there was nothing to revoke. So the right to be in voice is checked at the moment of the join webhook and again during reconciliation: a participant who is no longer a member, is banned, or lost `VOICE_CONNECT` is removed from the room with their token revoked, instead of being listed in presence. A LiveKit room is named `oc_<serverId>_<channelId>`, and both halves are verified when a room name is parsed: webhooks and reconciliation accept only rooms belonging to this server. Otherwise, with one LiveKit shared by several OpenCord deployments, a room of another server with a matching `channelId` would be taken for our own and its participants would land in presence as members here. `voice.join` is rate limited per identity (`VOICE_JOIN_BURST` attempts, one restored every `VOICE_JOIN_REFILL_MS`), because every join means calls to LiveKit and a broadcast to everyone; the limit is checked before the permission check and before any LiveKit call, and exceeding it answers `RATE_LIMITED` with `retryAfterMs`. `voice.leave` is deliberately not limited: leaving has to work at all times, and the loop is bounded anyway because joining is its expensive half. `voice.member.disconnect` starts a 30-second rejoin pause (`VOICE_MODERATED_REJOIN_COOLDOWN_MS`) for the disconnected participant, otherwise the moderator's action would be undone by a single click on the channel; during the pause `voice.join` answers `FORBIDDEN` with `retryAfterMs`. The pause covers every voice channel, because the disconnect is addressed to the participant rather than to a room, and it is only started when the participant really was connected.

`VoicePresence` contains `userId`, `channelId`, `muted`, `deafened`, `serverMuted`, and `viewingScreenShareUserId`. After joining a LiveKit room, when toggling mute, and when selecting or closing a screen share, the client sends `voice.state.update`; the server accepts the state only from the connected user themselves, verifies that the selected presenter is in the same voice channel, and broadcasts `voice.participant.updated`. `muted` is only a claim — audio travels through LiveKit, not through OpenCord — so a claimed mute is checked against the real state of the microphone track shortly afterwards, and periodic reconciliation takes the track state in LiveKit as the truth. A participant who reports themselves as muted while still publishing is corrected and the correction is broadcast; the opposite mismatch is left alone, since it is harmless and usually just means the mute is still on its way. `deafened` is enforced on the client by actually dropping the subscription to every remote audio track, not merely by muting the `<audio>` elements: a muted element only stops playback, while the room's audio would keep arriving over the network and stay available to a deafened client. A track published while the state is on is refused at subscription time. Through `viewingScreenShareUserId`, clients display the current list of viewers for each screen share. The owner or an administrator with a higher role can send `voice.member.mute`: the server sets `serverMuted`, forbids the selected participant from publishing the `MICROPHONE` source via LiveKit permissions, but keeps the ability to share the screen. When the server mute is lifted, the microphone permission is restored, and the client restores its own button state. The server mute is stored with the membership rather than with the voice presence, so it survives leaving and rejoining the channel, a reconnect and a server restart: `voice.join` reads the stored flag and issues a LiveKit token whose publish sources reflect it. A regular member cannot perform this operation, an administrator cannot mute the owner or another administrator, and a user cannot apply it to themselves. Audio is not transmitted over the OpenCord WebSocket, and the LiveKit connection does not depend on it: when the last control connection of a participant goes away, the server releases their voice presence itself after a 30-second pause (`VOICE_ORPHAN_GRACE_MS`). Without it a client that dropped the WebSocket stayed in the channel and was audible while listed as offline and holding a slot against the channel limit. The pause covers an ordinary reconnect, so a short network drop does not interrupt the conversation; the decision is taken from the state of the connections at the moment the pause ends.

`screenShareMaxResolution` and `screenShareMaxFrameRate` are chosen by the owner in the server settings. A LiveKit token cannot constrain the frame at all, and the resolution and bitrate are picked by the client itself, so the resolution limit is applied after the fact: when a screen-share video track is published above the allowed height, the server mutes that track (checked again during reconciliation, in case the webhook was missed). Height is what the setting names — 480/720/1080/1440 — and it is what the client scales by, while the width of an ultrawide monitor is legitimately larger, so only height is compared. The client stops its own share on that mute and explains why, instead of leaving a share that transmits nothing on screen. The frame rate is not reported in the LiveKit track description, so it stays a client-side hint and is not enforced.

`message.update` is allowed exclusively to the message author. Even the owner and an administrator cannot edit someone else's text or attachments. The event contains the final `attachmentIds`: the server accepts the existing attachments of this message and new unused uploads by the author, atomically replaces the relations, and deletes the detached files. After the change the server sets `editedAt` and broadcasts `message.updated`. `message.delete` is allowed to the author, and for others' messages to the owner and administrators with the `MANAGE_MESSAGES` permission; the server broadcasts `message.deleted` and deletes the associated attachments.

`chat.send`, `chat.pm`, and `chat.apm` may include `replyToMessageId`. The server accepts the reference only when the source belongs to the same channel and is visible to the sender; this prevents replies from exposing inaccessible private messages. The stored message and all history/search/live payloads carry only the source ID, while the client resolves the compact quote from messages it already has. The database uses a nullable foreign key with `ON DELETE SET NULL`, so deleting the source keeps the reply without a dangling reference.

`server.avatar.update` is available only to the owner with the `MANAGE_SERVER` permission. After saving, the server immediately broadcasts the lightweight `server.avatar.updated` event to all connected members; the client updates its local state and the icon without reconnecting or re-requesting the history. The avatar is also included in the initial `server.snapshot`, so users who connect later receive the current image. PNG, JPEG, and WebP are allowed as a data URL up to 1.5 MB.

`server.settings.update` is available only to the owner with the `MANAGE_SERVER` permission and atomically changes the server name, the attachment limit, the maximum screen-share quality (480p, 720p, 1080p, or "Source" with a contract value of 1440), and the maximum frame rate (15, 30, or 60 FPS). The "Source" mode keeps the original resolution up to a limit of 2560×1440 without artificially upscaling smaller frames. After saving, the server broadcasts a new `server.snapshot`, so the settings update on all connected clients without reconnecting. The name changed by the owner is preserved when the same deployment restarts.

`server.delete` is available only to the owner. The server stores a tombstone and sends `server.deleted` to all active clients; a client that was offline will receive the same event after its next authentication. The exact fields and constraints are defined by the `shared/src/protocol.ts` schemas. Incompatible changes require incrementing `PROTOCOL_VERSION`.

## Storage

Local development uses PGlite with PostgreSQL-compatible migrations. Production uses the same repository and migrations through a regular PostgreSQL `DATABASE_URL`. The current schema contains the server, channels, public profiles (including `username` and `discriminator`), messages (including the nullable reply reference), message mentions (`message_mentions`), and attachment metadata. Files reside in `ATTACHMENTS_DIR` (`server/.data/attachments` locally, a separate Docker volume, or `/var/lib/opencord/attachments` for a native install).

---

# OpenCord Protocol v38 (Русский)

Версия протокола описывает совместимость WebSocket-событий и не совпадает с SemVer-версией OpenCord Server. Публичный контракт версии и состояния сервера описан в [health.md](./health.md).

Протокол v38 добавляет необязательное поле профиля `nameGlow` — цвет `#rrggbb` без альфы, которым клиент рисует мягкое рассеянное свечение вокруг ника везде, где он отображается (чат, список участников, голос, упоминания, карточка профиля). Поле передаётся через `auth.respond.profile`, `profile.update`, `server.snapshot.members` и `member.updated`. Оно необязательное, поэтому сервер прошлой версии остаётся совместимым.

Протокол v37 добавляет необязательное поле профиля `accentColor` — цвет `#rrggbb` без альфы, которым клиент окрашивает стекло карточки превью профиля. Поле передаётся через `auth.respond.profile`, `profile.update`, `server.snapshot.members` и `member.updated`. Оно необязательное, поэтому сервер прошлой версии остаётся совместимым.

Протокол v36 закрепляет тег `username#1234` за идентичностью — дискриминатор выдаёт и хранит сервер — и добавляет ограничение отправки `slowmodeSeconds` на канал вместе с массовым событием `channel.slowmode.set` и кодом ошибки `RATE_LIMITED`.

В протоколе v35 убран отдельный никнейм: единственное имя пользователя в профиле, участниках, сообщениях и упоминаниях — `username`. Свой статус сохраняет текст до 32 символов, а вместо цвета `#RRGGBB` получает необязательный `customStatusEmoji` до 16 символов — как в Discord. Эти поля передаются через `server.settings.update`, `auth.respond.profile`, snapshot и события `member.updated`.

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

`auth.respond.profile` содержит `username`, публичное описание длиной до 160 символов, необязательные публичные аватар и шапку, а также выбранный статус: `online`, `idle`, `dnd` или `invisible`. После выбора файла клиент показывает локальный редактор кадрирования с перемещением и масштабом. Выбранный квадрат аватара уменьшается до 128×128 и кодируется в WebP размером не более 96 КБ. Шапка кадрируется в пропорции 5:2, уменьшается максимум до 600×240 и кодируется в WebP размером не более 256 КБ. Сервер повторно проверяет формат и ограничения размера и хранит одну актуальную версию профиля пользователя — сообщения не создают отдельных копий. Аватар сервера использует тот же редактор квадратного кадра перед отдельным серверным сжатием. Обложка сервера использует формат шапки профиля (кадр 5:2, максимум 600×240, WebP до 256 КБ): владелец меняет её событием `server.banner.update`, сервер рассылает `server.banner.updated`, а snapshot содержит актуальный `banner`.

`username`, описание, аватар и шапка возвращаются в `server.snapshot.members` и `member.updated`; актуальные имя и аватар также используются событиями и историей сообщений. Поэтому один серверный профиль используется списком участников, текстовым чатом и интерфейсом голосовой комнаты, а шапка показывается в открываемом превью профиля. При смене профиля или статуса клиент отправляет `profile.update` по существующему WebSocket без переподключения. Сервер заменяет прежние публичные поля в единственной записи пользователя и рассылает `member.updated` всем активным клиентам. При явном выходе публичные описание, аватар и шапка очищаются на сервере. Начиная с протокола v37 профиль несёт также необязательный `accentColor` — значение `#rrggbb` без альфы, которым клиент окрашивает стекло карточки превью профиля; с v38 в том же формате передаётся и `nameGlow`, рисующее мягкое рассеянное свечение вокруг ника. Оба поля декоративные, в `bannedMembers` не входят и очищаются вместе с остальными публичными полями.

`auth.respond.profile` дополнительно содержит `username` (2–32 строчные буквы, цифры, точки, подчёркивания или дефисы; используется для упоминаний через @) и четырёхзначный `discriminator`, дополняющий тег `username#1234`. Дискриминатор в `auth.respond.profile` — только пожелание: сервер выдаёт его при первой регистрации ключа, дальше держит закреплённым за идентичностью и игнорирует присланное клиентом значение. Запрошенное значение принимается, лишь если пара `username#discriminator` свободна, иначе выдаётся случайный свободный дискриминатор. Пара уникальна в пределах сервера, поэтому тег всегда указывает ровно на одну идентичность и его нельзя скопировать, чтобы выдать себя за другого участника. Подтверждённый тег приходит клиенту в `server.snapshot` и `member.updated`. Каждая запись участника также несёт `fingerprint` — SHA-256-отпечаток публичного ключа в формате `XXXX-XXXX-XXXX-XXXX`, чтобы одинаковые теги можно было различить сравнением кодов идентичности в превью профиля. Отпечаток выводится из уже хранимого на сервере публичного ключа, поэтому нового раскрытия данных не добавляет.

Статус сохраняется локально и повторно отправляется при следующем подключении. Сервер держит присутствие только в памяти активного WebSocket-соединения: `online`, `idle` и `dnd` видны другим участникам как «В сети», «Недоступен» и «Не беспокоить». `invisible` никогда не раскрывается другим клиентам и преобразуется сервером в публичный `offline`; после закрытия последнего соединения любой пользователь также становится `offline`.

При явном выходе клиент отправляет `server.leave`. Для обычного участника сервер удаляет членство, рассылает `member.removed` и ещё семь дней хранит публичный профиль, чтобы недавняя история оставалась читаемой. После дедлайна фоновая очистка меняет имя на «Неизвестный пользователь» и удаляет username, дискриминатор, описание, аватар, шапку, акцентный цвет и свечение ника, сохраняя криптографическую идентичность и все сообщения. Повторный вход до или после очистки восстанавливает публичный профиль из авторизованного клиента. Владелец не удаляется без передачи владения или удаления сервера.

## Вложения

- `POST /api/attachments` принимает поток `application/octet-stream` размером до 10 МБ. Имя передаётся в `x-opencord-file-name` как UTF-8 base64url, MIME-тип — в `x-opencord-mime-type`.
- `chat.send.attachmentIds` связывает с сообщением до пяти предварительно загруженных текущим пользователем файлов.
- `message.update.attachmentIds` передаёт итоговый список вложений после редактирования. Автор может сохранить прежние файлы, открепить их или добавить собственные предварительно загруженные файлы; снятые вложения удаляются из метаданных и файлового хранилища.
- Текст `chat.send.content` может быть пустым, если передан хотя бы один `attachmentId`; полностью пустое сообщение отклоняется протоколом.
- `GET /api/attachments/:id` всегда отдаёт файл как скачивание с `X-Content-Type-Options: nosniff`. Одной аутентификации недостаточно: вызывающий должен быть загрузившим ещё не прикреплённый файл либо вложение должно висеть на сообщении, которое ему видно. Правило видимости то же, что у `history.request`: обычное сообщение открыто всем участникам, а вложение `pm`/`apm` — только отправителю и получателю, поэтому знание идентификатора вложения не открывает чужую личную переписку. Во всех остальных случаях ответ — `404`.

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

Клиент может упомянуть участников сервера в поле ввода через `@username` или `@username#1234`. Поле ввода после `@` предлагает подходящих участников (аватар, `@username`, свой статус или роль) и вставляет `@username`, добавляя `#1234` только когда username занят несколькими участниками. При отправке клиент резолвит `@username[#1234]` в ID участников: выбирается единственное совпадение, а при неоднозначности — первый кандидат в порядке списка участников; код идентичности в превью профиля — надёжный способ различить одинаковые username.

Передаваемое сообщение хранит упоминания как маркеры `<@userId>` внутри обычного текста плюс отдельный массив `mentions` из ID, поэтому переименования не ломают старые упоминания. `chat.send.mentions` и `message.update.mentions` принимают до 20 уникальных ID участников; сервер молча отбрасывает ID, не являющиеся участниками текущего сервера, а остальные сохраняет в таблицу `message_mentions`. История и результаты поиска также возвращают `mentions`.

Чат отображает упоминание как подсвеченный чип с актуальным отображаемым именем упомянутого участника; клик открывает превью профиля. Упоминания выбывших участников отображаются простым чипом «неизвестный пользователь». Сообщение может состоять только из вложения и упоминаний; лимит в 4000 символов применяется к контенту вместе с маркерами.

### Личные сообщения и слэш-команды

Поле ввода клиента поддерживает слэш-команды: `/pm @пользователь сообщение` отправляет личное сообщение, `/apm @пользователь сообщение` — анонимное личное, `/roll` публикует случайное число от 0 до 100 (генерируется локально клиентом), а `/mute @пользователь` и `/unmute @пользователь` управляют мутом чата.

`chat.pm` и `chat.apm` создают сообщение с `kind: "pm"` или `kind: "apm"` и полем `targetUserId`. Такие сообщения хранятся в канале, но доставляются только отправителю и получателю — и как живые события `message.created`/`message.updated`/`message.deleted`, и в `history.result`, который отфильтровывает личные сообщения, в которых зритель не участвует. При `/apm` получатель получает замаскированную копию: синтетический `authorId`, имя «Аноним» и без аватара — личность отправителя получателю не раскрывается; сам отправитель видит своё сообщение как обычно. В результатах `message.search` личные сообщения не появляются. Отправка личного сообщения самому себе, не-участнику или в несуществующий канал отклоняется. `message.react` соблюдает ту же границу: посторонний участник получает тот же `NOT_FOUND`, что и на несуществующее сообщение, поэтому чужая реакция не может ни появиться в личной переписке, ни подтвердить её существование.

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
- `channel.slowmode.set`;
- `channel.delete`;
- `member.role.set`;
- `member.kick`;
- `member.ban`;
- `member.unban`;
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
- `member.updated`, `member.removed`, `profile.anonymized`;
- `voice.join.authorized`, `voice.participant.joined`, `voice.participant.updated`, `voice.participant.left`, `voice.participant.disconnected`;
- `pong`, `error`.

`channel.create`, `channel.update`, `channel.slowmode.set` и `channel.delete` требуют разрешения `MANAGE_CHANNELS`, которым обладают владелец и администраторы. Тип существующего канала не изменяется; при удалении канала PostgreSQL каскадно удаляет его сообщения, после чего сервер рассылает всем клиентам новый `server.snapshot`.

У текстового канала есть `slowmodeSeconds` — минимальная пауза между двумя сообщениями `chat.send` одного участника, выбираемая из `0, 5, 10, 30, 60, 300, 900, 3600`, где `0` выключает ограничение. Голосовые каналы всегда сообщают `0`. Отсчёт берётся из сохранённой истории, поэтому перезапуск сервера его не сбрасывает, а держатели `MANAGE_MESSAGES` ограничение не ощущают. На преждевременное сообщение приходит `RATE_LIMITED` с полем `retryAfterMs`, показывающим, сколько ждать. `channel.slowmode.set` применяет одно значение сразу к 100 каналам; голосовые идентификаторы в выборке пропускаются, а выборка без единого текстового канала отвечает `NOT_FOUND`.

`message.react.emoji` обязано быть ровно одним эмодзи: значение должно совпасть с `\p{RGI_Emoji}` — набором последовательностей, рекомендованных Unicode к обмену, поэтому простой пиктограф, форма с вариационным селектором, ZWJ-семья, флаг, keycap и модификатор тона кожи принимаются, а всё остальное отклоняется с `INVALID_EVENT`. Свободная строка позволяла бы участнику вставлять в чужое сообщение комбинирующие «zalgo»-стопки, RTL-override или обычный текст и ломать вёрстку ленты у всех, кто её видит. Исходящая `messageReactionSchema` намеренно остаётся ограниченной строкой — ужесточение сделало бы так, что одно неожиданное легаси-значение ломает весь snapshot, — поэтому реакции, сохранённые до этого правила, отсеиваются на чтении и один раз удаляются при старте сервера.

Независимо от медленного режима действует несменяемый настройками предел против флуда: корзина на 10 действий для идентичности, восстанавливающаяся со скоростью 5 за 5 секунд, отдельно для сообщений (`chat.send`, `chat.pm`, `chat.apm`) и для `message.react`. Корзина привязана к пользователю, а не к сокету, поэтому второе подключение с тем же ключом лимит не удваивает; превышение тоже отвечает `RATE_LIMITED` с `retryAfterMs`.

`member.kick` удаляет членство, завершает голосовую и WebSocket-сессии и рассылает `member.removed`. Профиль исключённого участника следует той же политике семидневного хранения и последующего обезличивания, что и при самостоятельном выходе. Это исключение, а не бан: пользователь может позднее вручную добавить адрес сервера снова. Владелец может исключать администраторов и обычных участников, администратор — только обычных участников; исключить себя или владельца нельзя.

`member.ban` содержит `durationMinutes`: `10`, `30`, `60`, `360`, `720`, `1440`, `4320`, `10080`, `43200` либо `null` для перманентного бана. Событие блокирует криптографическую идентичность, удаляет членство, завершает голосовую и WebSocket-сессии и до дедлайна отклоняет авторизацию с кодом `BANNED`. Истёкшие баны снимаются автоматически; `member.unban` снимает бан досрочно. Профиль забаненного следует той же политике семидневного хранения, поэтому при долгом или перманентном бане он становится «Неизвестным пользователем», но отпечаток ключа сохраняется. Поле `server.snapshot.bannedMembers` с `expiresAt` получают только клиенты с правом `KICK_MEMBERS`; обычным участникам передаётся пустой список.

Ошибка `BANNED` содержит `banExpiresAt`: ISO-дедлайн бана либо `null` для перманентного. Сам забаненный — единственный, кому не отправляется `member.removed`: вместо него уходит эта ошибка, поэтому клиент сохраняет сервер в списке и показывает постоянный экран блокировки со сроком, а не пустой сервер. Та же ошибка с тем же полем приходит при повторной попытке аутентификации забаненной идентичности. Поле необязательное, поэтому сервер прошлой версии остаётся совместимым; клиент, не получивший его, считает срок бана неизвестным.

Голосовой канал содержит `participantLimit`: значения `1–25` задают конечную вместимость, а `0` означает экспериментальный режим без ограничения (`∞` в клиенте). Текстовые каналы всегда передают `null`. Лимит проверяет OpenCord Server перед выдачей LiveKit-токена, поэтому изменение применяется к уже созданной комнате без её пересоздания. Занятые места считаются сразу по трём источникам — список участников LiveKit, известные серверу presence и уже выданные, но ещё не подключившиеся токены (бронь на 15 секунд, снимается сразу после фактического входа), — поскольку участник переходит между ними не мгновенно, а учёт одного лишь списка позволял одновременным входам переполнить канал. Токен LiveKit живёт 300 секунд, и участника могут исключить, забанить или разжаловать уже после его выдачи — в том числе пока он ещё не добрался до комнаты, когда отзывать было нечего. Поэтому право находиться в голосе проверяется в момент вебхука о входе и повторно при сверке: участник, переставший быть членом сервера, забаненный или лишившийся `VOICE_CONNECT`, удаляется из комнаты с отзывом токена, а не попадает в presence. Комната LiveKit называется `oc_<serverId>_<channelId>`, и при разборе имени проверяются обе половины: вебхуки и сверка принимают только комнаты этого сервера. Иначе при общем LiveKit на несколько развёрнутых OpenCord комната чужого сервера с совпавшим `channelId` считалась бы своей, а её участники попадали бы в presence как участники здешнего сервера. `voice.join` ограничен по частоте на идентичность (`VOICE_JOIN_BURST` попыток, одна восстанавливается каждые `VOICE_JOIN_REFILL_MS`), поскольку каждый вход — это обращения к LiveKit и рассылка всем; предел проверяется раньше проверки прав и любого обращения к LiveKit, а его превышение отвечает `RATE_LIMITED` с `retryAfterMs`. `voice.leave` намеренно не ограничивается: выход должен работать всегда, а цикл ограничен и так, поскольку дорогая половина у него вход. `voice.member.disconnect` включает для отключённого участника 30-секундную паузу на возвращение (`VOICE_MODERATED_REJOIN_COOLDOWN_MS`), иначе действие модератора отменялось бы одним нажатием на канал; в течение паузы `voice.join` отвечает `FORBIDDEN` с `retryAfterMs`. Пауза распространяется на все голосовые каналы, поскольку отключение адресовано участнику, а не комнате, и включается только если участник действительно был подключён.

`VoicePresence` содержит `userId`, `channelId`, `muted`, `deafened`, `serverMuted` и `viewingScreenShareUserId`. После входа в LiveKit-комнату, при переключении заглушки и при выборе либо закрытии демонстрации клиент отправляет `voice.state.update`; сервер принимает состояние только от самого подключённого пользователя, проверяет, что выбранный ведущий находится в том же голосовом канале, и рассылает `voice.participant.updated`. `muted` — это лишь заявление, поскольку звук идёт через LiveKit, а не через OpenCord: объявленная заглушка вскоре сверяется с настоящим состоянием дорожки микрофона, а периодическая сверка считает истиной состояние дорожки в LiveKit. Участник, объявивший себя заглушённым и продолжающий передавать звук, исправляется, и исправление рассылается всем; обратное расхождение не трогается — оно безобидно и обычно означает, что заглушка ещё в пути. «Оглохший» клиент на самом деле снимает подписку со всех чужих звуковых дорожек, а не просто выключает элементы `<audio>`: выключенный элемент лишь не воспроизводит поток, тогда как звук комнаты продолжал бы приходить по сети и оставался бы доступен. Дорожка, опубликованная при включённой заглушке ушей, отклоняется на подписке. По `viewingScreenShareUserId` клиенты отображают актуальный список зрителей каждой демонстрации. Владелец либо администратор с более высокой ролью может отправить `voice.member.mute`: сервер выставляет `serverMuted`, запрещает выбранному участнику публиковать источник `MICROPHONE` через разрешения LiveKit, но сохраняет возможность демонстрировать экран. При снятии серверного мута разрешение микрофона возвращается, а клиент восстанавливает собственное состояние кнопки. Серверный мут хранится вместе с членством, а не с голосовой presence, поэтому переживает выход и повторный вход в канал, переподключение и перезапуск сервера: `voice.join` читает сохранённый признак и выдаёт токен LiveKit с соответствующими источниками публикации. Обычный участник не может выполнить эту операцию, администратор не может заглушить владельца или другого администратора, а пользователь не может применить её к себе. Аудио через WebSocket OpenCord не передаётся, и соединение с LiveKit от него не зависит: когда у участника пропадает последнее управляющее соединение, сервер сам освобождает его голосовое присутствие спустя 30-секундную паузу (`VOICE_ORPHAN_GRACE_MS`). Без неё оборвавший WebSocket клиент оставался в канале и был слышен, числясь офлайн и занимая место в лимите канала. Пауза покрывает обычное переподключение, поэтому короткий обрыв сети разговор не прерывает; решение принимается по состоянию соединений на момент окончания паузы.

`screenShareMaxResolution` и `screenShareMaxFrameRate` задаёт владелец в настройках сервера. Токен LiveKit ограничить кадр не позволяет, а разрешение и битрейт выбирает сам клиент, поэтому предел разрешения применяется по факту: когда видеодорожка демонстрации публикуется выше разрешённой высоты, сервер её глушит (повторно проверяется при сверке, если вебхук был пропущен). Сравнивается высота — именно её задаёт настройка (480/720/1080/1440) и по ней же клиент масштабирует кадр, тогда как ширина у широких мониторов законно больше. Клиент по этой заглушке останавливает собственную демонстрацию и объясняет причину, вместо того чтобы оставлять на экране демонстрацию, которая ничего не передаёт. Частоту кадров LiveKit в описании дорожки не сообщает, поэтому она остаётся подсказкой клиенту и не проверяется.

`message.update` разрешён исключительно автору сообщения. Даже владелец и администратор не могут редактировать чужой текст или вложения. Событие содержит итоговый `attachmentIds`: сервер принимает существующие вложения этого сообщения и новые незанятые загрузки автора, атомарно заменяет связи и удаляет откреплённые файлы. После изменения сервер устанавливает `editedAt` и рассылает `message.updated`. `message.delete` разрешён автору, а для чужих сообщений — владельцу и администраторам с правом `MANAGE_MESSAGES`; сервер рассылает `message.deleted` и удаляет связанные вложения.

`chat.send`, `chat.pm` и `chat.apm` могут содержать `replyToMessageId`. Сервер принимает ссылку, только если исходное сообщение находится в том же канале и доступно отправителю; так ответ не раскрывает недоступное личное сообщение. В хранилище и протоколе передаётся только ID, а компактную цитату клиент собирает из уже загруженных сообщений. Внешний ключ имеет `ON DELETE SET NULL`, поэтому удаление исходного сообщения сохраняет сам ответ без битой ссылки.

`server.avatar.update` доступен только владельцу с разрешением `MANAGE_SERVER`. После сохранения сервер немедленно рассылает всем подключённым участникам лёгкое событие `server.avatar.updated`; клиент обновляет локальное состояние и иконку без переподключения и повторного запроса истории. Аватар также входит в начальный `server.snapshot`, поэтому актуальное изображение получают пользователи, подключившиеся позднее. Допустимы PNG, JPEG и WebP в виде data URL размером до 1,5 МБ.

`server.settings.update` доступен только владельцу с разрешением `MANAGE_SERVER` и атомарно изменяет название сервера, лимит вложений, максимальное качество демонстрации (480p, 720p, 1080p или «Источник» с контрактным значением 1440) и максимальную частоту кадров (15, 30 или 60 FPS). Режим «Источник» сохраняет исходное разрешение до предела 2560×1440 без искусственного увеличения меньших кадров. После сохранения сервер рассылает новый `server.snapshot`, поэтому настройки обновляются у всех подключённых клиентов без переподключения. Название, изменённое владельцем, сохраняется при перезапуске того же deployment.

`server.delete` доступен только владельцу. Сервер сохраняет tombstone и отправляет `server.deleted` всем активным клиентам; клиент, который был офлайн, получит то же событие после следующей аутентификации. Точные поля и ограничения определяются схемами `shared/src/protocol.ts`. Несовместимые изменения требуют увеличения `PROTOCOL_VERSION`.

## Хранение

Локальный development использует PGlite с PostgreSQL-совместимыми миграциями. Production использует тот же repository и миграции через обычный PostgreSQL `DATABASE_URL`. Текущая схема содержит сервер, каналы, публичные профили (включая `username` и `discriminator`), сообщения (включая nullable-ссылку ответа), упоминания (`message_mentions`) и метаданные вложений. Файлы лежат в `ATTACHMENTS_DIR` (`server/.data/attachments` локально, отдельный volume Docker или `/var/lib/opencord/attachments` при native-установке).

---

# OpenCord 协议 v38 (中文)

协议版本描述了 WebSocket 事件的兼容性，并且与 OpenCord Server 的 SemVer 版本不一致。版本和服务器状态的公共契约在 [health.md](./health.md) 中描述。

协议 v38 新增了可选的个人资料字段 `nameGlow`——一个不带透明度的 `#rrggbb` 颜色，客户端用它为昵称在所有显示位置（聊天、成员列表、语音、提及、资料卡片）绘制柔和的弥散光晕。该字段通过 `auth.respond.profile`、`profile.update`、`server.snapshot.members` 和 `member.updated` 传输。字段是可选的，因此旧版本服务器保持兼容。

协议 v37 新增了可选的个人资料字段 `accentColor`——一个不带透明度的 `#rrggbb` 颜色，客户端用它为个人资料预览卡片的玻璃效果着色。该字段通过 `auth.respond.profile`、`profile.update`、`server.snapshot.members` 和 `member.updated` 传输。字段是可选的，因此旧版本服务器保持兼容。

协议 v36 将 `username#1234` 标签绑定到身份——判别号由服务器分配并持有——并新增了按频道的 `slowmodeSeconds` 发送限制，以及批量事件 `channel.slowmode.set` 和错误码 `RATE_LIMITED`。

协议 v35 移除了独立的昵称：`username` 现在是个人资料、成员、消息和提及中唯一的用户名称。自定义状态保留最长 32 个字符的文本，并以最长 16 个字符的可选 `customStatusEmoji` 取代 `#RRGGBB` 颜色，与 Discord 的显示方式一致。这些字段通过 `server.settings.update`、`auth.respond.profile`、快照和 `member.updated` 事件传输。

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

`auth.respond.profile` 包含 `username`、最长 160 个字符的公开描述、可选的公开头像和横幅，以及所选的状态：`online`、`idle`、`dnd` 或 `invisible`。选择文件后，客户端会显示一个带有平移和缩放的本地裁剪编辑器。选定的头像正方形会缩小到 128×128，并编码为不超过 96 KB 的 WebP。横幅按 5:2 的比例裁剪，最大缩小到 600×240，并编码为不超过 256 KB 的 WebP。服务器会再次验证格式和大小限制，并存储用户个人资料的一个当前版本——消息不会创建单独的副本。服务器头像在单独的服务器端压缩之前使用相同的正方形画面编辑器。服务器封面使用个人资料横幅格式（5:2 裁剪，最大 600×240，WebP 不超过 256 KB）：所有者通过 `server.banner.update` 更新它，服务器广播 `server.banner.updated`，快照中包含当前的 `banner`。

`username`、描述、头像和横幅在 `server.snapshot.members` 和 `member.updated` 中返回；当前的 `username` 和头像也会被事件和消息历史使用。因此，一个服务器个人资料被成员列表、文本聊天和语音房间界面共同使用，而横幅显示在打开的个人资料预览中。当个人资料或状态发生变化时，客户端会通过现有 WebSocket 发送 `profile.update`，无需重新连接。服务器在用户的唯一记录中替换之前的公开字段，并向所有活动客户端广播 `member.updated`。在明确退出时，服务器会清除公开描述、头像和横幅。从协议 v37 开始，个人资料还携带可选的 `accentColor`——一个不带透明度的 `#rrggbb` 值，客户端用它为个人资料预览卡片的玻璃效果着色；从 v38 开始，相同格式还传递 `nameGlow`，为昵称绘制柔和的弥散光晕。这两个字段都是装饰性的，不包含在 `bannedMembers` 中，并与其他公开字段一起清除。

`auth.respond.profile` 还包含 `username`（2–32 个小写字母、数字、点、下划线或连字符；用于 @提及）以及构成 `username#1234` 标签的四位 `discriminator`。`auth.respond.profile` 中的判别号只是请求：服务器在密钥首次注册时分配判别号，此后将其绑定到该身份，并忽略客户端后续发送的值。只有当 `username#discriminator` 仍然空闲时才会采用请求的值，否则会分配一个随机的空闲判别号。该组合在服务器范围内唯一，因此标签始终指向唯一一个身份，无法被复制用于冒充其他成员。确认后的标签通过 `server.snapshot` 和 `member.updated` 传给客户端。每个成员条目还带有 `fingerprint`——公钥的 SHA-256 指纹，格式为 `XXXX-XXXX-XXXX-XXXX`——这样可以通过比较个人资料预览中显示的身份代码来区分相同的标签。指纹来源于服务器已存储的公钥，因此不会增加新的数据披露。

状态在本地保存，并在下次连接时重新发送。服务器仅在活动 WebSocket 连接的内存中维护在线状态：`online`、`idle` 和 `dnd` 对其他成员显示为「在线」「空闲」和「请勿打扰」。`invisible` 从不向其他客户端透露，并由服务器转换为公开的 `offline`；在最后一个连接关闭后，任何用户也会变为 `offline`。

明确退出时，客户端发送 `server.leave`。对于普通成员，服务器会移除成员资格、广播 `member.removed`，并保留公开资料七天，以便近期历史记录仍可阅读。保留期结束后，后台清理会将名称替换为“未知用户”，并清除用户名、识别码、简介、头像、横幅、强调色和昵称光晕，同时保留加密身份及所有消息。用户在清理前后重新加入时，公开资料都会从已认证客户端恢复。所有者在未转让所有权或删除服务器的情况下不会被移除。

## 附件

- `POST /api/attachments` 接受最大 10 MB 的 `application/octet-stream` 流。文件名通过 `x-opencord-file-name` 以 UTF-8 base64url 形式传递，MIME 类型通过 `x-opencord-mime-type` 传递。
- `chat.send.attachmentIds` 将当前用户预先上传的最多五个文件与消息关联。
- `message.update.attachmentIds` 传递编辑后的最终附件列表。作者可以保留之前的文件、将其移除，或添加自己预先上传的文件；被移除的附件会从元数据和文件存储中删除。
- 如果至少提供了一个 `attachmentId`，则 `chat.send.content` 文本可以为空；完全为空的消息会被协议拒绝。
- `GET /api/attachments/:id` 始终以带有 `X-Content-Type-Options: nosniff` 的下载形式返回文件。仅通过身份验证并不够：调用者必须是尚未附加文件的上传者，或者该附件挂在调用者可以阅读的消息上。可见性规则与 `history.request` 一致——普通消息对所有成员开放，而 `pm`/`apm` 的附件仅限发送者和接收者，因此知道附件 id 并不能打开他人的私聊。其他情况一律返回 `404`。

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

客户端可以在输入框中通过 `@username` 或 `@username#1234` 提及服务器成员。输入 `@` 后，输入框会建议匹配的成员（头像、`@username`、自定义状态或角色），并插入 `@username`；仅当多个成员共用该 username 时才追加 `#1234`。发送时，客户端将 `@username[#1234]` 解析为成员 ID：唯一匹配会被选中，有歧义时选择成员列表顺序中的第一个候选者；个人资料预览中的身份代码是区分相同 username 的可靠方式。

传输的消息将提及存储为纯文本内容中的 `<@userId>` 标记，再加上单独的 `mentions` 用户 ID 数组，因此重命名不会破坏旧的提及。`chat.send.mentions` 和 `message.update.mentions` 最多接受 20 个唯一的成员 ID；服务器会静默丢弃不是当前服务器成员的 ID，并将其余的存储到 `message_mentions` 表中。历史记录和搜索结果也会返回 `mentions`。

聊天将提及渲染为带有被提及成员当前显示名称的高亮芯片；点击它会打开个人资料预览。已离开成员的提及会渲染为普通的「未知用户」芯片。消息可以仅包含附件和提及；4000 个字符的限制适用于包含标记在内的内容。

### 私聊消息和斜杠命令

客户端输入框支持斜杠命令：`/pm @用户 消息` 发送私聊消息，`/apm @用户 消息` 发送匿名私聊消息，`/roll` 发布 0 到 100 的随机数字（由客户端本地生成），`/mute @用户` 和 `/unmute @用户` 控制聊天禁言。

`chat.pm` 和 `chat.apm` 会创建带有 `kind: "pm"` 或 `kind: "apm"` 以及 `targetUserId` 的消息。此类消息存储在频道中，但只发送给发送者和接收者——无论是实时的 `message.created`/`message.updated`/`message.deleted` 事件，还是 `history.result`（它会过滤掉查看者未参与的私聊消息）。对于 `/apm`，接收者会收到经过遮盖的副本：合成的 `authorId`、名称为「匿名」且没有头像，因此发送者的身份不会透露给接收者；发送者本人则像平常一样看到自己的消息。私聊消息不会出现在 `message.search` 结果中。向自己、非成员或发送到不存在的频道会被拒绝。`message.react` 遵守同样的边界：会话之外的成员会收到与消息不存在时相同的 `NOT_FOUND`，因此他人的反应既不会出现在私聊消息中，也无法确认其存在。

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
- `channel.slowmode.set`;
- `channel.delete`;
- `member.role.set`;
- `member.kick`;
- `member.ban`;
- `member.unban`;
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
- `member.updated`, `member.removed`, `profile.anonymized`;
- `voice.join.authorized`, `voice.participant.joined`, `voice.participant.updated`, `voice.participant.left`, `voice.participant.disconnected`;
- `pong`, `error`.

`channel.create`、`channel.update`、`channel.slowmode.set` 和 `channel.delete` 需要 `MANAGE_CHANNELS` 权限，所有者和管理员拥有该权限。现有频道的类型不会改变；删除频道时，PostgreSQL 会级联删除其消息，之后服务器向所有客户端广播新的 `server.snapshot`。

文字频道带有 `slowmodeSeconds`——同一成员两条 `chat.send` 消息之间的最短间隔，取值为 `0、5、10、30、60、300、900、3600`，其中 `0` 表示关闭限制。语音频道始终报告 `0`。倒计时依据已存储的历史记录计算，因此服务器重启不会重置它，持有 `MANAGE_MESSAGES` 的成员不受限制。过早发送的消息会收到 `RATE_LIMITED` 以及说明需等待多久的 `retryAfterMs`。`channel.slowmode.set` 可一次对最多 100 个频道应用同一个值；选择中的语音频道 id 会被跳过，而不含任何文字频道的选择会返回 `NOT_FOUND`。

`message.react.emoji` 必须恰好是一个表情符号：该值必须匹配 `\p{RGI_Emoji}`，即 Unicode 推荐用于交换的序列集合，因此单个象形字、带变体选择符的形式、ZWJ 家庭、旗帜、keycap 和肤色修饰符都会被接受，其他内容则以 `INVALID_EVENT` 拒绝。自由字符串会让成员把组合式「zalgo」堆叠、从右到左覆盖或纯文本塞进他人的消息，破坏所有查看者的信息流版面。出站的 `messageReactionSchema` 有意保持为有界字符串——收紧它会让一个意外的历史值破坏整个快照——因此在此规则之前保存的反应会在读取时被过滤，并在服务器启动时删除一次。

除慢速模式外，服务器还强制执行任何设置都无法关闭的防刷屏限制：每个身份 10 个动作的令牌桶，以每 5 秒 5 个的速度恢复，分别应用于消息（`chat.send`、`chat.apm`、`chat.pm`）和 `message.react`。令牌桶按用户而非按连接计算，因此使用同一密钥的第二个连接不会使额度翻倍；超出限制同样返回带 `retryAfterMs` 的 `RATE_LIMITED`。

`member.kick` 会移除成员资格、结束语音和 WebSocket 会话，并广播 `member.removed`。被移除成员的资料遵循与主动退出相同的七天保留及匿名化策略。这是一种移除而非封禁：用户之后可以再次手动添加服务器地址。所有者可以移除管理员和普通成员，管理员只能移除普通成员；不能移除自己或所有者。

`member.ban` 包含 `durationMinutes`：可为 `10`、`30`、`60`、`360`、`720`、`1440`、`4320`、`10080`、`43200`，或使用 `null` 表示永久封禁。它会封禁目标加密身份、移除成员资格、结束语音和 WebSocket 会话，并在截止时间前以 `BANNED` 拒绝认证。到期封禁会自动删除，`member.unban` 可提前解除。被封禁资料同样遵循七天保留策略，因此长期或永久封禁最终会显示为未知用户，但密钥指纹仍会保留。只有拥有 `KICK_MEMBERS` 权限的客户端会在包含 `expiresAt` 的 `server.snapshot.bannedMembers` 中收到封禁列表；普通成员收到空列表。

`BANNED` 错误携带 `banExpiresAt`：封禁截止时间的 ISO 字符串，永久封禁时为 `null`。被封禁者是唯一不会收到 `member.removed` 的成员——服务器改为发送该错误，因此客户端会在列表中保留该服务器，并显示带截止时间的常驻封禁界面，而不是一个空服务器。被封禁身份再次尝试认证时会收到同样带该字段的错误。该字段是可选的，因此旧版本服务器仍然兼容；未收到该字段的客户端会将封禁视为时长未知。

语音频道包含 `participantLimit`：`1–25` 的值定义了有限的容量，而 `0` 表示无限制的实验模式（客户端中显示为 `∞`）。文本频道始终传递 `null`。OpenCord Server 在颁发 LiveKit 令牌之前会检查该限制，因此更改会应用到已创建的房间，而无需重新创建它。占用名额会同时依据三个来源统计——LiveKit 参与者列表、服务器已知的 presence，以及已签发但尚未连接的令牌（保留 15 秒，参与者真正加入后立即释放）——因为参与者在这些来源之间的转移并非瞬时完成，仅依据列表统计会让同时加入的请求超出频道容量。LiveKit 令牌有效期为 300 秒，参与者可能在令牌签发之后被踢出、封禁或降级——包括在他尚未进入房间、无从吊销的时候。因此，是否有权处于语音中会在加入 webhook 时进行检查，并在对账时再次检查：不再是成员、已被封禁或失去 `VOICE_CONNECT` 的参与者会被移出房间并吊销其令牌，而不是被列入 presence。LiveKit 房间命名为 `oc_<serverId>_<channelId>`，解析房间名时会校验两个部分：webhook 和对账只接受属于本服务器的房间。否则，当多个 OpenCord 部署共用一个 LiveKit 时，另一台服务器上 `channelId` 恰好相同的房间会被当作本服务器的房间，其参与者会作为本服务器成员进入 presence。`voice.join` 按身份限速（`VOICE_JOIN_BURST` 次尝试，每 `VOICE_JOIN_REFILL_MS` 恢复一次），因为每次加入都意味着对 LiveKit 的调用以及向所有人的广播；该限制在权限检查和任何 LiveKit 调用之前进行，超出时返回带 `retryAfterMs` 的 `RATE_LIMITED`。`voice.leave` 有意不做限制：离开必须始终可用，而且循环本身已经受限，因为其代价高昂的一半是加入。`voice.member.disconnect` 会为被断开的参与者启动 30 秒的重新加入暂停（`VOICE_MODERATED_REJOIN_COOLDOWN_MS`），否则只需点击一次频道就能撤销管理员的操作；在暂停期间，`voice.join` 会返回带 `retryAfterMs` 的 `FORBIDDEN`。该暂停适用于所有语音频道，因为断开连接针对的是参与者而非房间，并且只有在参与者确实已连接时才会启动。

`VoicePresence` 包含 `userId`、`channelId`、`muted`、`deafened`、`serverMuted` 和 `viewingScreenShareUserId`。在加入 LiveKit 房间后、切换静音时，以及选择或关闭屏幕共享时，客户端会发送 `voice.state.update`；服务器只接受来自已连接用户本人的状态，验证所选演示者是否在同一语音频道中，并广播 `voice.participant.updated`。`muted` 只是一种声明，因为音频经由 LiveKit 而非 OpenCord 传输：声明的静音会在稍后与麦克风轨道的真实状态进行核对，而定期对账则以 LiveKit 中的轨道状态为准。声称自己已静音却仍在发布音频的参与者会被纠正，并将纠正结果广播给所有人；相反方向的不一致则不予处理，因为它无害，通常只是意味着静音尚在途中。`deafened` 在客户端的实现是真正取消对所有远端音频轨道的订阅，而不仅仅是将 `<audio>` 元素设为静音：静音的元素只是停止播放，而房间的音频仍会通过网络到达，对已关闭接收的客户端依然可用。在该状态开启期间发布的轨道会在订阅时被拒绝。客户端通过 `viewingScreenShareUserId` 显示每个屏幕共享的当前观众列表。所有者或具有更高角色的管理员可以发送 `voice.member.mute`：服务器设置 `serverMuted`，通过 LiveKit 权限禁止所选参与者发布 `MICROPHONE` 源，但保留共享屏幕的能力。解除服务器静音后，麦克风权限会恢复，客户端会恢复自己的按钮状态。服务器静音与成员身份一起存储，而不是与语音在线状态一起存储，因此它在离开并重新加入频道、重新连接和服务器重启后依然有效：`voice.join` 会读取已存储的标志，并签发具有相应发布源的 LiveKit 令牌。普通成员无法执行此操作，管理员无法静音所有者或其他管理员，用户也无法将其应用于自己。音频不会通过 OpenCord 的 WebSocket 传输，且与 LiveKit 的连接并不依赖于它：当参与者的最后一个控制连接消失时，服务器会在 30 秒暂停（`VOICE_ORPHAN_GRACE_MS`）后自行释放其语音在线状态。否则，断开 WebSocket 的客户端会留在频道中并且仍可被听到，同时显示为离线并占用频道容量名额。该暂停涵盖了常规的重新连接，因此短暂的网络中断不会打断对话；决定是根据暂停结束时的连接状态作出的。

`screenShareMaxResolution` 和 `screenShareMaxFrameRate` 由所有者在服务器设置中指定。LiveKit 令牌无法约束画面，而分辨率和码率由客户端自行选择，因此分辨率限制在事后生效：当屏幕共享视频轨道以超出允许高度发布时，服务器会将其静音（若遗漏了 webhook，则在对账时再次检查）。比较的是高度——设置指定的正是它（480/720/1080/1440），客户端也按它缩放画面，而超宽显示器的宽度理应更大。客户端会依据该静音停止自己的共享并说明原因，而不是在屏幕上留下一个什么都不传输的共享。LiveKit 不会在轨道描述中报告帧率，因此帧率仍是客户端提示，不做强制。

`message.update` 仅允许消息作者使用。即使是所有者和管理员也无法编辑他人的文本或附件。该事件包含最终的 `attachmentIds`：服务器接受该消息现有的附件以及作者新上传且未被占用的文件，原子地替换关联并删除已分离的文件。更改后，服务器设置 `editedAt` 并广播 `message.updated`。`message.delete` 对作者开放，对于他人的消息，对具有 `MANAGE_MESSAGES` 权限的所有者和管理员开放；服务器广播 `message.deleted` 并删除关联的附件。

`chat.send`、`chat.pm` 和 `chat.apm` 可以包含 `replyToMessageId`。只有当原消息位于同一频道且对发送者可见时，服务器才会接受该引用，从而避免通过回复泄露无权访问的私聊消息。存储和协议中只传输原消息 ID，紧凑引用由客户端从已加载消息中解析。数据库外键使用 `ON DELETE SET NULL`，删除原消息时会保留回复，且不会留下无效引用。

`server.avatar.update` 仅对具有 `MANAGE_SERVER` 权限的所有者可用。保存后，服务器会立即向所有已连接的成员广播轻量的 `server.avatar.updated` 事件；客户端更新本地状态和图标，而无需重新连接或重新请求历史记录。头像也包含在初始的 `server.snapshot` 中，因此稍后连接的用户会收到当前图像。允许使用 PNG、JPEG 和 WebP，以最大 1.5 MB 的 data URL 形式提供。

`server.settings.update` 仅对具有 `MANAGE_SERVER` 权限的所有者可用，并以原子方式更改服务器名称、附件限制、最大屏幕共享质量（480p、720p、1080p 或契约值为 1440 的「原始」）以及最大帧率（15、30 或 60 FPS）。「原始」模式保留原始分辨率，最高限制为 2560×1440，不会人为放大较小的帧。保存后，服务器会广播新的 `server.snapshot`，因此所有已连接客户端的设置都会更新，而无需重新连接。所有者更改的名称会在同一 deployment 重启时保留。

`server.delete` 仅对所有者可用。服务器保存 tombstone，并向所有活动客户端发送 `server.deleted`；处于离线状态的客户端将在下次身份验证后收到相同的事件。确切的字段和约束由 `shared/src/protocol.ts` 模式定义。不兼容的更改需要增加 `PROTOCOL_VERSION`。

## 存储

本地 development 使用 PGlite 和 PostgreSQL 兼容的迁移。Production 通过常规 PostgreSQL `DATABASE_URL` 使用相同的 repository 和迁移。当前模式包含服务器、频道、公开个人资料（包括 `username` 和 `discriminator`）、消息（包括可为 null 的回复引用）、消息提及（`message_mentions`）和附件元数据。文件位于 `ATTACHMENTS_DIR`（本地为 `server/.data/attachments`，独立的 Docker volume，或 native 安装时为 `/var/lib/opencord/attachments`）。
