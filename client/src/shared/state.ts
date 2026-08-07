import { z } from "zod";
import { attachmentSchema, attachmentUploadLimitSchema, DEFAULT_ATTACHMENT_LIMIT_BYTES, publicMemberStatusSchema, screenShareFrameRateSchema, screenShareResolutionSchema, userStatusSchema } from "@opencord/shared";
import { savedDeploymentConfigurationSchema } from "./deployment";

export const STATE_VERSION = 3 as const;
const LEGACY_TEMPLATE_SERVER_ID = "open-space";

export const localProfileSchema = z.object({
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
});

export const mockMemberSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(32),
  bio: z.string().max(160).optional(),
  role: z.string().max(32),
  serverRole: z.enum(["owner", "administrator", "member"]).optional(),
  status: publicMemberStatusSchema,
  avatarColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  avatar: z.string().max(2_000_000).nullable().optional(),
  banner: z.string().max(500_000).nullable().optional(),
});

export const mockServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(48),
  avatar: z.string().max(1_500_000).nullable().optional(),
  address: z.string().max(200).nullable(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  maxAttachmentBytes: attachmentUploadLimitSchema.default(DEFAULT_ATTACHMENT_LIMIT_BYTES),
  screenShareMaxResolution: screenShareResolutionSchema.optional(),
  screenShareMaxFrameRate: screenShareFrameRateSchema.optional(),
  channels: z.array(mockChannelSchema),
  members: z.array(mockMemberSchema),
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
}).superRefine((message, context) => {
  if (!message.content && !message.attachments?.length) context.addIssue({ code: "custom", path: ["content"], message: "Message requires text or an attachment" });
});

export const clientPreferencesSchema = z.object({
  compactMode: z.boolean(),
  showMemberList: z.boolean(),
  notifications: z.boolean(),
  voiceInputMode: z.enum(["voice", "push-to-talk"]),
  voiceInputDeviceId: z.string().max(500).nullable(),
  voiceOutputDeviceId: z.string().max(500).nullable(),
  pushToTalkKey: z.string().regex(/^Key[A-Z]$/).default("KeyV"),
  echoCancellation: z.boolean(),
  noiseSuppression: z.boolean(),
  autoGainControl: z.boolean(),
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
const legacyPersistedStateFields = { ...persistedStateFields, preferences: legacyClientPreferencesSchema };
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
    preferences: { compactMode: false, showMemberList: true, notifications: true, voiceInputMode: "voice", voiceInputDeviceId: null, voiceOutputDeviceId: null, pushToTalkKey: "KeyV", echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceParticipantSettings: {} },
  };
}

export function parsePersistedState(input: unknown): PersistedClientState {
  const current = persistedClientStateSchema.safeParse(input);
  if (current.success) return current.data;
  const legacyV2 = persistedClientStateV2Schema.safeParse(input);
  const legacy = legacyV2.success ? legacyV2.data : persistedClientStateV1Schema.parse(input);
  const template = legacy.servers.find((server) => server.id === LEGACY_TEMPLATE_SERVER_ID);
  const removedChannelIds = new Set(template?.channels.map((channel) => channel.id) ?? []);
  const servers = legacy.servers.filter((server) => server.id !== LEGACY_TEMPLATE_SERVER_ID);
  const activeServerId = legacy.activeServerId === LEGACY_TEMPLATE_SERVER_ID ? servers[0]?.id ?? null : legacy.activeServerId;
  const activeServer = servers.find((server) => server.id === activeServerId);
  const activeChannelId = activeServerId === legacy.activeServerId && activeServer?.channels.some((channel) => channel.id === legacy.activeChannelId)
    ? legacy.activeChannelId
    : activeServer?.channels.find((channel) => channel.kind === "text")?.id ?? null;
  return persistedClientStateSchema.parse({ ...legacy, version: STATE_VERSION, servers, messages: legacy.messages.filter((message) => !removedChannelIds.has(message.channelId)), activeServerId, activeChannelId, preferences: { ...legacy.preferences, voiceInputMode: "voice", voiceInputDeviceId: null, voiceOutputDeviceId: null, pushToTalkKey: "KeyV", echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceParticipantSettings: {} } });
}

export function safePersistedState(input: unknown): PersistedClientState {
  try { return parsePersistedState(input); } catch { return createDefaultState(); }
}
