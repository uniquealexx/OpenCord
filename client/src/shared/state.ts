import { z } from "zod";
import { attachmentSchema, attachmentUploadLimitSchema, bannedMemberSchema, CUSTOM_STATUS_EMOJI_MAX_LENGTH, CUSTOM_STATUS_MAX_LENGTH, DEFAULT_ATTACHMENT_LIMIT_BYTES, discriminatorSchema, nameFontSchema, profileAccentColorSchema, publicMemberStatusSchema, screenShareFrameRateSchema, screenShareResolutionSchema, userStatusSchema, usernameSchema } from "@opencord/shared";
import { DEFAULT_LANGUAGE, LANGUAGES } from "../lib/i18n/languages";
import { savedDeploymentConfigurationSchema } from "./deployment";

export const STATE_VERSION = 4 as const;
const LEGACY_TEMPLATE_SERVER_ID = "open-space";

export const localProfileSchema = z.object({
  id: z.string().min(1),
  username: usernameSchema,
  discriminator: discriminatorSchema,
  bio: z.string().max(160),
  avatar: z.string().max(2_000_000).nullable(),
  banner: z.string().max(500_000).nullable().default(null),
  status: userStatusSchema.optional(),
  customStatus: z.string().max(CUSTOM_STATUS_MAX_LENGTH).optional(),
  customStatusEmoji: z.string().max(CUSTOM_STATUS_EMOJI_MAX_LENGTH).optional(),
  // Акцентный цвет превью профиля; поле необязательное, чтобы старые состояния читались.
  accentColor: profileAccentColorSchema.nullish(),
  // Мягкое свечение ника; отсутствует или null — выключено.
  nameGlow: profileAccentColorSchema.nullish(),
  // Шрифт ника; дефолт держит совместимость со старыми состояниями.
  nameFont: nameFontSchema.nullish(),
  createdAt: z.string().datetime(),
});

/** Профиль состояний v1–v3: до появления username и дискриминатора. */
const legacyLocalProfileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(2).max(32),
  bio: z.string().max(160),
  avatar: z.string().max(2_000_000).nullable(),
  banner: z.string().max(500_000).nullable().default(null),
  status: userStatusSchema.optional(),
  createdAt: z.string().datetime(),
});

export const mockChannelSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  name: z.string().min(1).max(48),
  kind: z.enum(["text", "voice"]),
  description: z.string().max(120),
  participantLimit: z.number().int().min(0).max(25).nullable().default(null),
  // Медленный режим приходит с сервера; у голосовых каналов он всегда 0.
  slowmodeSeconds: z.number().int().min(0).max(21_600).default(0),
});

export const mockMemberSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1).max(32).default("unknown"),
  discriminator: z.string().regex(/^[0-9]{4}$/).optional(),
  fingerprint: z.string().min(1).max(100).optional(),
  bio: z.string().max(160).optional(),
  role: z.string().max(32),
  serverRole: z.enum(["owner", "administrator", "member"]).optional(),
  status: publicMemberStatusSchema,
  customStatus: z.string().max(CUSTOM_STATUS_MAX_LENGTH).optional(),
  customStatusEmoji: z.string().max(CUSTOM_STATUS_EMOJI_MAX_LENGTH).optional(),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  nameGlow: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  nameFont: nameFontSchema.nullish(),
  avatarColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  avatar: z.string().max(2_000_000).nullable().optional(),
  banner: z.string().max(500_000).nullable().optional(),
  chatMuted: z.boolean().optional(),
  chatMutedUntil: z.string().datetime().nullable().optional(),
});

export const mockServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(48),
  description: z.string().max(160).optional(),
  avatar: z.string().max(1_500_000).nullable().optional(),
  banner: z.string().max(500_000).nullable().optional(),
  address: z.string().max(200).nullable(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  maxAttachmentBytes: attachmentUploadLimitSchema.default(DEFAULT_ATTACHMENT_LIMIT_BYTES),
  screenShareMaxResolution: screenShareResolutionSchema.optional(),
  screenShareMaxFrameRate: screenShareFrameRateSchema.optional(),
  channels: z.array(mockChannelSchema),
  members: z.array(mockMemberSchema),
  bannedMembers: z.array(bannedMemberSchema).optional(),
  deployment: savedDeploymentConfigurationSchema.optional(),
});

export const mockMessageSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  authorId: z.string().min(1),
  authorName: z.string().min(1).max(32),
  authorColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  authorAvatar: z.string().max(2_000_000).nullable().optional(),
  content: z.string().trim().max(4_000),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable().optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
  mentions: z.array(z.string().min(1).max(200)).max(20).optional(),
  reactions: z.array(z.object({ emoji: z.string().min(1).max(32), userIds: z.array(z.string().min(1).max(200)).max(100) })).max(64).optional(),
  kind: z.enum(["chat", "pm", "apm"]).optional(),
  targetUserId: z.string().min(1).max(200).nullable().optional(),
  anonymous: z.boolean().optional(),
  replyToMessageId: z.string().min(1).nullable().optional(),
}).superRefine((message, context) => {
  if (!message.content && !message.attachments?.length) context.addIssue({ code: "custom", path: ["content"], message: "Message requires text or an attachment" });
});

export const UI_SCALE_OPTIONS = [0.9, 1, 1.1, 1.2] as const;
export const COLOR_THEMES = ["midnight", "amethyst", "ocean", "forest", "sunset", "rose"] as const;
export type ColorTheme = (typeof COLOR_THEMES)[number];
export const DEFAULT_COLOR_THEME: ColorTheme = "midnight";

export const clientPreferencesSchema = z.object({
  language: z.enum(LANGUAGES).default(DEFAULT_LANGUAGE),
  colorTheme: z.enum(COLOR_THEMES).default(DEFAULT_COLOR_THEME),
  compactMode: z.boolean(),
  showMemberList: z.boolean(),
  notifications: z.boolean(),
  uiScale: z.number().min(0.8).max(1.4).default(1),
  voiceInputMode: z.enum(["voice", "push-to-talk"]),
  voiceInputDeviceId: z.string().max(500).nullable(),
  voiceOutputDeviceId: z.string().max(500).nullable(),
  pushToTalkKey: z.string().regex(/^Key[A-Z]$/).default("KeyV"),
  echoCancellation: z.boolean(),
  noiseSuppression: z.boolean(),
  autoGainControl: z.boolean(),
  automaticInputSensitivity: z.boolean().default(true),
  manualInputSensitivityDb: z.number().int().min(-80).max(-10).default(-45),
  voiceParticipantSettings: z.record(z.string().min(1).max(256), z.object({ muted: z.boolean(), volume: z.number().min(0).max(1) })).default({}),
});
const legacyClientPreferencesSchema = z.object({ compactMode: z.boolean(), showMemberList: z.boolean(), notifications: z.boolean() });

const persistedStateFields = {
  onboardingComplete: z.boolean(),
  profile: localProfileSchema.nullable(),
  servers: z.array(mockServerSchema),
  messages: z.array(mockMessageSchema),
  activeServerId: z.string().nullable(),
  activeChannelId: z.string().nullable(),
  preferences: clientPreferencesSchema,
};
function validateStateRelations(state: { servers: MockServer[]; activeServerId: string | null; activeChannelId: string | null }, context: z.RefinementCtx): void {
    const activeServer = state.servers.find((server) => server.id === state.activeServerId);
    if (state.activeServerId && !activeServer) {
      context.addIssue({ code: "custom", path: ["activeServerId"], message: "Unknown active server" });
    }
    if (state.activeChannelId && !activeServer?.channels.some((channel) => channel.id === state.activeChannelId)) {
      context.addIssue({ code: "custom", path: ["activeChannelId"], message: "Unknown active channel" });
    }
}

export const persistedClientStateSchema = z.object({ version: z.literal(STATE_VERSION), ...persistedStateFields }).superRefine(validateStateRelations);
const legacyPersistedStateFields = { ...persistedStateFields, profile: legacyLocalProfileSchema.nullable(), preferences: legacyClientPreferencesSchema };
const persistedClientStateV3Schema = z.object({ version: z.literal(3), ...persistedStateFields, profile: legacyLocalProfileSchema.nullable() }).superRefine(validateStateRelations);
const persistedClientStateV2Schema = z.object({ version: z.literal(2), ...legacyPersistedStateFields }).superRefine(validateStateRelations);
const persistedClientStateV1Schema = z.object({ version: z.literal(1), ...legacyPersistedStateFields }).superRefine(validateStateRelations);

export type LocalProfile = z.infer<typeof localProfileSchema>;
export type MockChannel = z.infer<typeof mockChannelSchema>;
export type MockMember = z.infer<typeof mockMemberSchema>;
export type MockServer = z.infer<typeof mockServerSchema>;
export type MockMessage = z.infer<typeof mockMessageSchema>;
export type ClientPreferences = z.infer<typeof clientPreferencesSchema>;
export type VoiceParticipantSettings = ClientPreferences["voiceParticipantSettings"];
export type PersistedClientState = z.infer<typeof persistedClientStateSchema>;

export function createDefaultState(): PersistedClientState {
  return {
    version: STATE_VERSION,
    onboardingComplete: false,
    profile: null,
    servers: [],
    messages: [],
    activeServerId: null,
    activeChannelId: null,
    preferences: { language: DEFAULT_LANGUAGE, colorTheme: DEFAULT_COLOR_THEME, compactMode: false, showMemberList: true, notifications: true, uiScale: 1, voiceInputMode: "voice", voiceInputDeviceId: null, voiceOutputDeviceId: null, pushToTalkKey: "KeyV", echoCancellation: true, noiseSuppression: true, autoGainControl: true, automaticInputSensitivity: true, manualInputSensitivityDb: -45, voiceParticipantSettings: {} },
  };
}

export function parsePersistedState(input: unknown): PersistedClientState {
  const current = persistedClientStateSchema.safeParse(input);
  if (current.success) return current.data;
  const legacyV3 = persistedClientStateV3Schema.safeParse(input);
  const legacyV2 = persistedClientStateV2Schema.safeParse(input);
  const legacyV1 = persistedClientStateV1Schema.safeParse(input);
  const legacy = legacyV3.success ? legacyV3.data : legacyV2.success ? legacyV2.data : legacyV1.success ? legacyV1.data : persistedClientStateV1Schema.parse(input);
  const template = legacy.servers.find((server) => server.id === LEGACY_TEMPLATE_SERVER_ID);
  const removedChannelIds = new Set(template?.channels.map((channel) => channel.id) ?? []);
  const servers = legacy.servers.filter((server) => server.id !== LEGACY_TEMPLATE_SERVER_ID);
  const activeServerId = legacy.activeServerId === LEGACY_TEMPLATE_SERVER_ID ? servers[0]?.id ?? null : legacy.activeServerId;
  const activeServer = servers.find((server) => server.id === activeServerId);
  const activeChannelId = activeServerId === legacy.activeServerId && activeServer?.channels.some((channel) => channel.id === legacy.activeChannelId)
    ? legacy.activeChannelId
    : activeServer?.channels.find((channel) => channel.kind === "text")?.id ?? null;
  // Профиль v1–v3: username выводится из отображаемого имени, дискриминатор генерируется
  // случайно; при первом подключении к серверу клиент сверит его с дискриминатором ключей.
  const profile = legacy.profile ? { ...legacy.profile, username: deriveUsername(legacy.profile.displayName), discriminator: randomDiscriminator() } : null;
  return persistedClientStateSchema.parse({ ...legacy, version: STATE_VERSION, profile, servers, messages: legacy.messages.filter((message) => !removedChannelIds.has(message.channelId)), activeServerId, activeChannelId, preferences: { ...legacy.preferences, voiceInputMode: "voice", voiceInputDeviceId: null, voiceOutputDeviceId: null, pushToTalkKey: "KeyV", echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceParticipantSettings: {} } });
}

function deriveUsername(displayName: string): string {
  const slug = displayName.toLocaleLowerCase().replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 32);
  return slug.length >= 2 ? slug : "user";
}

/** Случайный дискриминатор тега username#1234 — фолбэк для сред без моста идентичности. */
export function randomDiscriminator(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String((values[0] ?? 0) % 10_000).padStart(4, "0");
}

export function safePersistedState(input: unknown): PersistedClientState {
  try { return parsePersistedState(input); } catch { return createDefaultState(); }
}
