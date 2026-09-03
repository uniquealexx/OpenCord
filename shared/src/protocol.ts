import { z } from "zod";

export const PROTOCOL_VERSION = 41 as const;
export const PROFILE_RETENTION_DAYS = 7 as const;
export const BAN_DURATION_MINUTES = [10, 30, 60, 360, 720, 1_440, 4_320, 10_080, 43_200] as const;
export const banDurationMinutesSchema = z.union([
  z.literal(BAN_DURATION_MINUTES[0]),
  z.literal(BAN_DURATION_MINUTES[1]),
  z.literal(BAN_DURATION_MINUTES[2]),
  z.literal(BAN_DURATION_MINUTES[3]),
  z.literal(BAN_DURATION_MINUTES[4]),
  z.literal(BAN_DURATION_MINUTES[5]),
  z.literal(BAN_DURATION_MINUTES[6]),
  z.literal(BAN_DURATION_MINUTES[7]),
  z.literal(BAN_DURATION_MINUTES[8]),
  z.null(),
]);

export const MEBIBYTE = 1024 * 1024;
export const ATTACHMENT_LIMIT_MIN_BYTES = MEBIBYTE;
export const ATTACHMENT_LIMIT_MAX_BYTES = 2000 * MEBIBYTE;
export const DEFAULT_ATTACHMENT_LIMIT_BYTES = 10 * MEBIBYTE;
export const attachmentUploadLimitSchema = z.number().int().min(ATTACHMENT_LIMIT_MIN_BYTES).max(ATTACHMENT_LIMIT_MAX_BYTES).nullable();

export const SCREEN_SHARE_RESOLUTIONS = [480, 720, 1080, 1440] as const;
export const SCREEN_SHARE_FRAME_RATES = [15, 30, 60] as const;
export const DEFAULT_SCREEN_SHARE_MAX_RESOLUTION = 1080 as const;
export const DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE = 60 as const;
export const screenShareResolutionSchema = z.union([z.literal(480), z.literal(720), z.literal(1080), z.literal(1440)]);
export const screenShareFrameRateSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);
export const serverNameSchema = z.string().trim().min(2).max(48);
export const SERVER_DESCRIPTION_MAX_LENGTH = 160 as const;
export const CUSTOM_STATUS_MAX_LENGTH = 32 as const;
// Эмодзи своего статуса — как в Discord: один графемный кластер слева от текста.
export const CUSTOM_STATUS_EMOJI_MAX_LENGTH = 16 as const;
export const customStatusEmojiSchema = z.string().trim().max(CUSTOM_STATUS_EMOJI_MAX_LENGTH);
export const serverSettingsSchema = z.object({
  name: serverNameSchema,
  description: z.string().trim().max(SERVER_DESCRIPTION_MAX_LENGTH).optional(),
  maxAttachmentBytes: attachmentUploadLimitSchema,
  screenShareMaxResolution: screenShareResolutionSchema,
  screenShareMaxFrameRate: screenShareFrameRateSchema,
});

export const VOICE_PARTICIPANT_LIMIT_MAX = 25 as const;
export const VOICE_PARTICIPANT_LIMIT_UNLIMITED = 0 as const;
export const voiceParticipantLimitSchema = z.number().int().min(VOICE_PARTICIPANT_LIMIT_UNLIMITED).max(VOICE_PARTICIPANT_LIMIT_MAX);

// Медленный режим текстового канала: минимальная пауза между сообщениями одного участника.
// 0 — режим выключен. Держатели MANAGE_MESSAGES его не ощущают, как и в Discord.
export const SLOWMODE_SECONDS_OPTIONS = [0, 5, 10, 30, 60, 300, 900, 3600] as const;
export const slowmodeSecondsSchema = z.number().int().refine(
  (value) => (SLOWMODE_SECONDS_OPTIONS as readonly number[]).includes(value),
  "Unsupported slowmode interval",
);
/** Сколько каналов разрешено настроить одним событием — хватает на сервер целиком. */
export const CHANNEL_BULK_LIMIT = 100 as const;

/**
 * Базовая защита от флуда, которую нельзя выключить настройками: она ограничивает не
 * канал, а саму идентичность, поэтому модифицированный клиент её не обходит.
 */
export const MESSAGE_FLOOD_BURST = 10 as const;
export const MESSAGE_FLOOD_WINDOW_MS = 5_000 as const;
export const MESSAGE_FLOOD_SUSTAINED = 5 as const;

/**
 * Пауза перед возвращением в голос после отключения модератором. Без неё действие
 * модератора не имело смысла: отключённый нажимал на канал ещё раз и возвращался
 * мгновенно, так что единственной работающей мерой оставался бан.
 *
 * Пауза намеренно короткая и общая для всех голосовых каналов: отключение адресовано
 * участнику, а не комнате, но и теневым баном становиться не должно.
 */
/**
 * Ограничение на подключение к голосовому каналу.
 *
 * Каждый вход — это обращения к LiveKit (создание комнаты, чтение списка участников,
 * выдача токена) и рассылка всем участникам сервера, поэтому цикл входов с одной
 * идентичности бил по LiveKit без всяких границ. Запас рассчитан на живое поведение:
 * подряд перебрать несколько каналов можно, крутить цикл — нет.
 *
 * Выход из канала намеренно не ограничивается: он должен работать всегда, иначе
 * участник застрял бы в разговоре. Цикл ограничен и так — дорогая половина у него вход.
 */
export const VOICE_JOIN_BURST = 6 as const;
export const VOICE_JOIN_REFILL_MS = 3_000 as const;

export const VOICE_MODERATED_REJOIN_COOLDOWN_MS = 30_000 as const;

/**
 * Сколько голосовое присутствие переживает потерю управляющего соединения.
 *
 * Соединение с LiveKit не зависит от WebSocket OpenCord, поэтому оборвавший WebSocket
 * оставался в канале и был слышен, но числился офлайн и занимал место в лимите: убрать
 * его могли только вебхук о фактическом разрыве или сверка, которая видела его в комнате
 * и возвращала обратно. Пауза покрывает обычное переподключение клиента (задержки
 * нарастают от 1 до 10 секунд), поэтому короткий обрыв сети разговор не прерывает.
 */
export const VOICE_ORPHAN_GRACE_MS = 30_000 as const;

export const memberRoleSchema = z.enum(["owner", "administrator", "member"]);
export const permissionSchema = z.enum(["MANAGE_SERVER", "MANAGE_CHANNELS", "MANAGE_MESSAGES", "MANAGE_ROLES", "KICK_MEMBERS", "DELETE_SERVER", "VOICE_CONNECT", "VOICE_SPEAK", "VOICE_MODERATE"]);

export const serverAvatarSchema = z.string().max(1_500_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u).nullable();

export const USER_AVATAR_MAX_BYTES = 96 * 1024;
const USER_AVATAR_MAX_DATA_URL_LENGTH = Math.ceil(USER_AVATAR_MAX_BYTES / 3) * 4 + 32;
export const userAvatarSchema = z.string().max(USER_AVATAR_MAX_DATA_URL_LENGTH).regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/u).nullable();
export const USER_BANNER_MAX_BYTES = 256 * 1024;
const USER_BANNER_MAX_DATA_URL_LENGTH = Math.ceil(USER_BANNER_MAX_BYTES / 3) * 4 + 32;
export const userBannerSchema = z.string().max(USER_BANNER_MAX_DATA_URL_LENGTH).regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/u).nullable();
// Обложка сервера: тот же формат, что и у шапки профиля — WebP 5:2, до 256 КБ.
export const serverBannerSchema = userBannerSchema;
// Фон плашки в списке участников: тот же формат, что и у шапки — WebP 5:2, до 256 КБ.
// Отдельное поле, чтобы шапка карточки и фон строки настраивались независимо.
export const userMemberBackgroundSchema = userBannerSchema;

export const userStatusSchema = z.enum(["online", "idle", "dnd", "invisible"]);
export const publicMemberStatusSchema = z.enum(["online", "idle", "dnd", "offline"]);

// Username (id) в стиле старого Discord: строчные буквы, цифры, точка, подчёркивание, дефис.
export const USERNAME_MIN_LENGTH = 2 as const;
export const USERNAME_MAX_LENGTH = 32 as const;
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{2,32}$/u);
// Дискриминатор тега username#1234: ровно 4 цифры, генерируется один раз вместе с ключами.
export const discriminatorSchema = z.string().regex(/^[0-9]{4}$/u);
// Код идентичности — SHA-256 отпечаток публичного ключа, группы по 4 hex-символа.
export const fingerprintSchema = z.string().regex(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){3}$/u);
// Акцентный цвет превью профиля: только HEX без альфы, чтобы сохранять эффект стекла.
export const profileAccentColorSchema = z.string().regex(/^#[0-9a-f]{6}$/u);
// Шрифт ника: отрисовывается только CSS на клиенте, текст username не меняется.
export const NAME_FONT_VALUES = ["none", "pixel", "gothic", "italic", "mono", "serif"] as const;
export const nameFontSchema = z.enum(NAME_FONT_VALUES);
export type NameFont = z.infer<typeof nameFontSchema>;

export const publicProfileSchema = z.object({
  username: usernameSchema,
  discriminator: discriminatorSchema,
  bio: z.string().trim().max(160).default(""),
  avatar: userAvatarSchema.default(null),
  banner: userBannerSchema.default(null),
  memberBackground: userMemberBackgroundSchema.default(null),
  status: userStatusSchema.default("online"),
  customStatus: z.string().trim().max(CUSTOM_STATUS_MAX_LENGTH).optional(),
  customStatusEmoji: customStatusEmojiSchema.optional(),
  accentColor: profileAccentColorSchema.nullish(),
  // Мягкое свечение ника; отсутствует или null — выключено.
  nameGlow: profileAccentColorSchema.nullish(),
  // Шрифт ника; дефолт держит совместимость со старыми клиентами.
  nameFont: nameFontSchema.default("none"),
});

export const channelSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(48),
  kind: z.enum(["text", "voice"]),
  description: z.string().max(120),
  participantLimit: voiceParticipantLimitSchema.nullable(),
  slowmodeSeconds: slowmodeSecondsSchema.default(0),
});

export const voiceCapabilitySchema = z.object({
  status: z.enum(["available", "degraded", "disabled"]),
  secureTransport: z.boolean(),
  maxParticipants: z.number().int().min(1).max(100),
  warning: z.string().max(240).nullable(),
});

export const voicePresenceSchema = z.object({
  userId: z.string().min(1),
  channelId: z.string().uuid(),
  muted: z.boolean(),
  deafened: z.boolean(),
  serverMuted: z.boolean().default(false),
  viewingScreenShareUserId: z.string().min(1).nullable().default(null),
});

export const memberSchema = z.object({
  id: z.string().min(1),
  username: usernameSchema,
  discriminator: discriminatorSchema,
  fingerprint: fingerprintSchema,
  bio: z.string().max(160),
  avatar: userAvatarSchema,
  banner: userBannerSchema,
  memberBackground: userMemberBackgroundSchema.default(null),
  status: publicMemberStatusSchema,
  customStatus: z.string().max(CUSTOM_STATUS_MAX_LENGTH).optional(),
  customStatusEmoji: customStatusEmojiSchema.optional(),
  accentColor: profileAccentColorSchema.nullish(),
  nameGlow: profileAccentColorSchema.nullish(),
  nameFont: nameFontSchema.default("none"),
  role: memberRoleSchema,
  chatMuted: z.boolean().default(false),
  chatMutedUntil: z.string().datetime().nullable().default(null),
});

export const bannedMemberSchema = z.object({
  id: z.string().min(1),
  username: usernameSchema.nullable(),
  discriminator: discriminatorSchema.nullable(),
  fingerprint: fingerprintSchema,
  bio: z.string().max(160),
  avatar: userAvatarSchema,
  banner: userBannerSchema,
  bannedAt: z.string().datetime(),
  bannedBy: z.string().min(1),
  expiresAt: z.string().datetime().nullable(),
});

/**
 * Управляющие символы двунаправленного текста. Смысла в имени файла они не несут, но
 * переставляют его при отображении: `счёт-<U+202E>fdp.exe` читается как `счёт-exe.pdf`,
 * и исполняемый файл выглядит документом. Классический приём маскировки вложений.
 */
// ALM, LRM, RLM, встраивания и override (LRE/RLE/PDF/LRO/RLO), изоляты (LRI/RLI/FSI/PDI).
// Записаны кодами: в исходнике сами символы невидимы и правились бы вслепую.
const BIDI_CONTROLS = "\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069";

export function stripBidiControls(value: string): string {
  return value.replace(new RegExp(`[${BIDI_CONTROLS}]`, "gu"), "");
}

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const messageMentionSchema = z.object({
  userId: z.string().min(1).max(200),
});
export const mentionIdsSchema = z.array(z.string().min(1).max(200)).max(20).refine((ids) => new Set(ids).size === ids.length, "Mention user IDs must be unique");

// Реакции на сообщения: эмодзи и список пользователей, которые его поставили.
export const REACTION_EMOJI_MAX_LENGTH = 32;
export const REACTION_EMOJI_MAX = 64;

/**
 * Реакция обязана быть ровно одним эмодзи из RGI — набора последовательностей,
 * рекомендованных Unicode к обмену. Свободная строка здесь давала бы участнику
 * вставлять в чужие сообщения комбинирующие «zalgo»-стопки, RTL-override и просто
 * длинный текст, ломающие вёрстку ленты у всех, кто её видит.
 */
// Флаг `v` нужен для свойства RGI_Emoji, но литерал с ним требует target ES2024,
// а пакеты собираются под ES2022 — поэтому регулярное выражение строится явно.
const RGI_EMOJI_PATTERN = new RegExp("^\\p{RGI_Emoji}$", "v");
export const reactionEmojiSchema = z.string().regex(RGI_EMOJI_PATTERN, "Reaction must be a single emoji");

export function isReactionEmoji(value: string): boolean {
  return reactionEmojiSchema.safeParse(value).success;
}

export const messageReactionSchema = z.object({
  // Исходящая схема намеренно мягче входящей: реакции, сохранённые до появления
  // строгой проверки, отсеиваются на чтении в репозитории. Ужесточать её здесь
  // опасно — одна неожиданная строка сделала бы весь snapshot неразбираемым.
  emoji: z.string().min(1).max(REACTION_EMOJI_MAX_LENGTH),
  userIds: z.array(z.string().min(1).max(200)).max(100),
});

// Вид сообщения: обычное, личное (/pm) или анонимное личное (/apm).
export const messageKindSchema = z.enum(["chat", "pm", "apm"]);
export const privateMessageTargetSchema = z.string().min(1).max(200);
export const messageReplyIdSchema = z.string().uuid().nullable().default(null);

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  authorId: z.string().min(1),
  authorName: z.string().min(1).max(32),
  authorAvatar: userAvatarSchema,
  content: z.string().trim().max(4_000),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable().default(null),
  attachments: z.array(attachmentSchema).max(5).default([]),
  mentions: z.array(messageMentionSchema).max(20).default([]),
  reactions: z.array(messageReactionSchema).max(REACTION_EMOJI_MAX).default([]),
  kind: messageKindSchema.default("chat"),
  targetUserId: privateMessageTargetSchema.nullable().default(null),
  anonymous: z.boolean().default(false),
  replyToMessageId: messageReplyIdSchema,
}).superRefine((message, context) => {
  if (!message.content && message.attachments.length === 0) context.addIssue({ code: "custom", path: ["content"], message: "Message requires text or an attachment" });
});

export const messageContentTypeSchema = z.enum(["text", "image", "video", "file"]);
export const messageSearchFiltersSchema = z.object({
  query: z.string().trim().max(200).default(""),
  authorId: z.string().min(1).max(200).nullable().default(null),
  channelId: z.string().uuid().nullable().default(null),
  contentTypes: z.array(messageContentTypeSchema).max(4).refine((types) => new Set(types).size === types.length, "Content types must be unique").default([]),
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(50).default(25),
}).refine((filters) => Boolean(filters.query || filters.authorId || filters.channelId || filters.contentTypes.length), "At least one search filter is required");

export const messageSearchResultSchema = z.object({
  messages: z.array(chatMessageSchema).max(50),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  hasMore: z.boolean(),
});

const requestIdSchema = z.string().uuid();
const attachmentIdsSchema = z.array(z.string().uuid()).max(5).refine((ids) => new Set(ids).size === ids.length, "Attachment IDs must be unique");

export const clientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth.respond"),
    requestId: requestIdSchema,
    protocolVersion: z.number().int().min(1),
    publicKey: z.string().min(40).max(1_000),
    signature: z.string().min(40).max(1_000),
    profile: publicProfileSchema,
  }),
  z.object({ type: z.literal("history.request"), requestId: requestIdSchema, channelId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) }),
  z.object({ type: z.literal("message.search"), requestId: requestIdSchema, filters: messageSearchFiltersSchema }),
  z.object({ type: z.literal("chat.send"), requestId: requestIdSchema, channelId: z.string().uuid(), content: z.string().trim().max(4_000), attachmentIds: attachmentIdsSchema.default([]), mentions: mentionIdsSchema.default([]), replyToMessageId: messageReplyIdSchema }),
  z.object({ type: z.literal("chat.pm"), requestId: requestIdSchema, channelId: z.string().uuid(), content: z.string().trim().min(1).max(4_000), targetUserId: privateMessageTargetSchema, replyToMessageId: messageReplyIdSchema }),
  z.object({ type: z.literal("chat.apm"), requestId: requestIdSchema, channelId: z.string().uuid(), content: z.string().trim().min(1).max(4_000), targetUserId: privateMessageTargetSchema, replyToMessageId: messageReplyIdSchema }),
  z.object({ type: z.literal("chat.mute.set"), requestId: requestIdSchema, userId: z.string().min(1), muted: z.boolean(), durationMinutes: z.number().int().min(1).max(10_080).nullable().default(null) }),
  z.object({ type: z.literal("message.update"), requestId: requestIdSchema, messageId: z.string().uuid(), content: z.string().trim().max(4_000), attachmentIds: attachmentIdsSchema.default([]), mentions: mentionIdsSchema.default([]) }),
  z.object({ type: z.literal("message.delete"), requestId: requestIdSchema, messageId: z.string().uuid() }),
  z.object({ type: z.literal("message.react"), requestId: requestIdSchema, messageId: z.string().uuid(), emoji: reactionEmojiSchema }),
  z.object({ type: z.literal("profile.update"), requestId: requestIdSchema, profile: publicProfileSchema }),
  z.object({ type: z.literal("server.leave"), requestId: requestIdSchema }),
  // participantLimit опционален ради старых клиентов: отсутствует — сервер ставит
  // лимит по умолчанию (25 для голосовых, null для текстовых).
  z.object({ type: z.literal("channel.create"), requestId: requestIdSchema, name: z.string().trim().min(1).max(48), kind: z.enum(["text", "voice"]), description: z.string().trim().max(120).default(""), participantLimit: voiceParticipantLimitSchema.nullable().default(null) }),
  z.object({ type: z.literal("channel.update"), requestId: requestIdSchema, channelId: z.string().uuid(), name: z.string().trim().min(1).max(48), description: z.string().trim().max(120).default(""), participantLimit: voiceParticipantLimitSchema.nullable(), slowmodeSeconds: slowmodeSecondsSchema.default(0) }),
  z.object({ type: z.literal("channel.delete"), requestId: requestIdSchema, channelId: z.string().uuid() }),
  // Массовая настройка: один медленный режим сразу на выбранные текстовые каналы.
  z.object({ type: z.literal("channel.slowmode.set"), requestId: requestIdSchema, channelIds: z.array(z.string().uuid()).min(1).max(CHANNEL_BULK_LIMIT).refine((ids) => new Set(ids).size === ids.length, "Channel IDs must be unique"), slowmodeSeconds: slowmodeSecondsSchema }),
  z.object({ type: z.literal("member.role.set"), requestId: requestIdSchema, userId: z.string().min(1), role: z.enum(["administrator", "member"]) }),
  z.object({ type: z.literal("member.kick"), requestId: requestIdSchema, userId: z.string().min(1) }),
  z.object({ type: z.literal("member.ban"), requestId: requestIdSchema, userId: z.string().min(1), durationMinutes: banDurationMinutesSchema }),
  z.object({ type: z.literal("member.unban"), requestId: requestIdSchema, userId: z.string().min(1) }),
  z.object({ type: z.literal("server.avatar.update"), requestId: requestIdSchema, avatar: serverAvatarSchema }),
  z.object({ type: z.literal("server.banner.update"), requestId: requestIdSchema, banner: serverBannerSchema }),
  z.object({ type: z.literal("server.settings.update"), requestId: requestIdSchema, ...serverSettingsSchema.shape }),
  z.object({ type: z.literal("server.delete"), requestId: requestIdSchema }),
  z.object({ type: z.literal("voice.join"), requestId: requestIdSchema, channelId: z.string().uuid() }),
  z.object({ type: z.literal("voice.leave"), requestId: requestIdSchema }),
  z.object({ type: z.literal("voice.state.update"), requestId: requestIdSchema, muted: z.boolean(), deafened: z.boolean(), viewingScreenShareUserId: z.string().min(1).nullable() }),
  z.object({ type: z.literal("voice.member.disconnect"), requestId: requestIdSchema, userId: z.string().min(1) }),
  z.object({ type: z.literal("voice.member.mute"), requestId: requestIdSchema, userId: z.string().min(1), muted: z.boolean() }),
  z.object({ type: z.literal("ping"), requestId: requestIdSchema }),
]).superRefine((event, context) => {
  if ((event.type === "chat.send" || event.type === "message.update") && !event.content && event.attachmentIds.length === 0) context.addIssue({ code: "custom", path: ["content"], message: "Message requires text or an attachment" });
});

export const serverEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.challenge"), requestId: requestIdSchema, protocolVersion: z.literal(PROTOCOL_VERSION), challenge: z.string(), expiresAt: z.string().datetime() }),
  z.object({ type: z.literal("auth.ok"), requestId: requestIdSchema, userId: z.string(), serverId: z.string().uuid(), sessionToken: z.string().min(40).max(200), sessionExpiresAt: z.string().datetime() }),
  z.object({ type: z.literal("server.snapshot"), server: z.object({ id: z.string().uuid(), avatar: serverAvatarSchema.default(null), banner: serverBannerSchema.default(null), ...serverSettingsSchema.shape, channels: z.array(channelSchema), members: z.array(memberSchema), bannedMembers: z.array(bannedMemberSchema).optional(), currentUser: z.object({ id: z.string().min(1), role: memberRoleSchema, permissions: z.array(permissionSchema) }), voice: voiceCapabilitySchema.optional(), voiceParticipants: z.array(voicePresenceSchema).optional() }) }),
  z.object({ type: z.literal("server.avatar.updated"), serverId: z.string().uuid(), avatar: serverAvatarSchema }),
  z.object({ type: z.literal("server.banner.updated"), serverId: z.string().uuid(), banner: serverBannerSchema }),
  z.object({ type: z.literal("server.deleted"), serverId: z.string().uuid() }),
  z.object({ type: z.literal("history.result"), requestId: requestIdSchema, channelId: z.string().uuid(), messages: z.array(chatMessageSchema) }),
  z.object({ type: z.literal("message.search.result"), requestId: requestIdSchema, result: messageSearchResultSchema }),
  z.object({ type: z.literal("message.created"), message: chatMessageSchema }),
  z.object({ type: z.literal("message.updated"), message: chatMessageSchema }),
  z.object({ type: z.literal("message.deleted"), messageId: z.string().uuid(), channelId: z.string().uuid() }),
  z.object({ type: z.literal("message.reactions.updated"), messageId: z.string().uuid(), channelId: z.string().uuid(), reactions: z.array(messageReactionSchema) }),
  z.object({ type: z.literal("member.updated"), member: memberSchema }),
  z.object({ type: z.literal("member.removed"), userId: z.string().min(1) }),
  z.object({ type: z.literal("profile.anonymized"), userId: z.string().min(1) }),
  z.object({ type: z.literal("voice.join.authorized"), requestId: requestIdSchema, channelId: z.string().uuid(), endpoint: z.string().url(), token: z.string().min(20).max(4_000), expiresAt: z.string().datetime() }),
  z.object({ type: z.literal("voice.participant.joined"), participant: voicePresenceSchema }),
  z.object({ type: z.literal("voice.participant.updated"), participant: voicePresenceSchema }),
  z.object({ type: z.literal("voice.participant.left"), participant: voicePresenceSchema }),
  z.object({ type: z.literal("voice.participant.disconnected"), userId: z.string().min(1), channelId: z.string().uuid(), reason: z.enum(["moderated", "replaced", "channel_deleted"]) }),
  z.object({ type: z.literal("pong"), requestId: requestIdSchema, serverTime: z.string().datetime() }),
  // banExpiresAt сопровождает только код BANNED: ISO-дата снятия бана либо null для
  // перманентного. Поле необязательное, чтобы сервер прошлой версии оставался совместимым.
  z.object({ type: z.literal("error"), requestId: requestIdSchema.nullable(), code: z.enum(["INVALID_EVENT", "AUTH_REQUIRED", "AUTH_FAILED", "BANNED", "PROTOCOL_MISMATCH", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "VOICE_UNAVAILABLE", "VOICE_ROOM_FULL", "INTERNAL_ERROR"]), message: z.string(), banExpiresAt: z.string().datetime().nullable().optional(), retryAfterMs: z.number().int().min(0).optional() }),
]);

export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type PublicMemberStatus = z.infer<typeof publicMemberStatusSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type Member = z.infer<typeof memberSchema>;
export type BannedMember = z.infer<typeof bannedMemberSchema>;
export type BanDurationMinutes = z.infer<typeof banDurationMinutesSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type VoiceCapability = z.infer<typeof voiceCapabilitySchema>;
export type VoicePresence = z.infer<typeof voicePresenceSchema>;
export type ScreenShareResolution = z.infer<typeof screenShareResolutionSchema>;
export type ScreenShareFrameRate = z.infer<typeof screenShareFrameRateSchema>;
export type ServerSettings = z.infer<typeof serverSettingsSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type MessageKind = z.infer<typeof messageKindSchema>;
export type MessageMention = z.infer<typeof messageMentionSchema>;
export type MessageReaction = z.infer<typeof messageReactionSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type MessageContentType = z.infer<typeof messageContentTypeSchema>;
export type MessageSearchFilters = z.infer<typeof messageSearchFiltersSchema>;
export type MessageSearchResult = z.infer<typeof messageSearchResultSchema>;
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;

export function parseClientEvent(input: unknown): ClientEvent {
  return clientEventSchema.parse(input);
}

export function parseServerEvent(input: unknown): ServerEvent {
  return serverEventSchema.parse(input);
}
