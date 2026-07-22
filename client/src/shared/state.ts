import { z } from "zod";

export const STATE_VERSION = 1 as const;

export const localProfileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(2).max(32),
  bio: z.string().max(160),
  avatar: z.string().max(2_000_000).nullable(),
  createdAt: z.string().datetime(),
});

export const mockChannelSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  name: z.string().min(1).max(48),
  kind: z.enum(["text", "voice"]),
  description: z.string().max(120),
});

export const mockMemberSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(32),
  role: z.string().max(32),
  status: z.enum(["online", "idle", "offline"]),
  avatarColor: z.string().regex(/^#[0-9a-f]{6}$/i),
});

export const mockServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(48),
  address: z.string().max(200).nullable(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  channels: z.array(mockChannelSchema),
  members: z.array(mockMemberSchema),
});

export const mockMessageSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  authorId: z.string().min(1),
  authorName: z.string().min(1).max(32),
  authorColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  content: z.string().trim().min(1).max(4_000),
  createdAt: z.string().datetime(),
});

export const clientPreferencesSchema = z.object({
  compactMode: z.boolean(),
  showMemberList: z.boolean(),
  notifications: z.boolean(),
});

export const persistedClientStateSchema = z
  .object({
    version: z.literal(STATE_VERSION),
    onboardingComplete: z.boolean(),
    profile: localProfileSchema.nullable(),
    servers: z.array(mockServerSchema),
    messages: z.array(mockMessageSchema),
    activeServerId: z.string().nullable(),
    activeChannelId: z.string().nullable(),
    preferences: clientPreferencesSchema,
  })
  .superRefine((state, context) => {
    const activeServer = state.servers.find((server) => server.id === state.activeServerId);
    if (state.activeServerId && !activeServer) {
      context.addIssue({ code: "custom", path: ["activeServerId"], message: "Unknown active server" });
    }
    if (state.activeChannelId && !activeServer?.channels.some((channel) => channel.id === state.activeChannelId)) {
      context.addIssue({ code: "custom", path: ["activeChannelId"], message: "Unknown active channel" });
    }
  });

export type LocalProfile = z.infer<typeof localProfileSchema>;
export type MockChannel = z.infer<typeof mockChannelSchema>;
export type MockMember = z.infer<typeof mockMemberSchema>;
export type MockServer = z.infer<typeof mockServerSchema>;
export type MockMessage = z.infer<typeof mockMessageSchema>;
export type ClientPreferences = z.infer<typeof clientPreferencesSchema>;
export type PersistedClientState = z.infer<typeof persistedClientStateSchema>;

const demoServer: MockServer = {
  id: "open-space",
  name: "Открытое пространство",
    address: null,
  accent: "#7c5cff",
  channels: [
    { id: "welcome", serverId: "open-space", name: "добро-пожаловать", kind: "text", description: "Начните знакомство с OpenCord" },
    { id: "general", serverId: "open-space", name: "общий", kind: "text", description: "Разговоры обо всём" },
    { id: "ideas", serverId: "open-space", name: "идеи-и-фидбек", kind: "text", description: "Обсуждаем будущее проекта" },
    { id: "lounge", serverId: "open-space", name: "Гостиная", kind: "voice", description: "Голосовая комната появится позже" },
  ],
  members: [
    { id: "mira", displayName: "Mira", role: "Администратор", status: "online", avatarColor: "#7c5cff" },
    { id: "alex", displayName: "Alex", role: "Участник", status: "online", avatarColor: "#36c5f0" },
    { id: "nova", displayName: "Nova", role: "Участник", status: "idle", avatarColor: "#f59e0b" },
    { id: "echo", displayName: "Echo", role: "Участник", status: "offline", avatarColor: "#64748b" },
  ],
};

const demoMessages: MockMessage[] = [
  {
    id: "welcome-1",
    channelId: "welcome",
    authorId: "mira",
    authorName: "Mira",
    authorColor: "#7c5cff",
    content: "Добро пожаловать в OpenCord — пространство, которое принадлежит его участникам.",
    createdAt: "2026-07-22T08:30:00.000Z",
  },
  {
    id: "welcome-2",
    channelId: "welcome",
    authorId: "alex",
    authorName: "Alex",
    authorColor: "#36c5f0",
    content: "Это локальный UI-прототип. Сообщения пока сохраняются только на вашем компьютере.",
    createdAt: "2026-07-22T08:34:00.000Z",
  },
  {
    id: "general-1",
    channelId: "general",
    authorId: "nova",
    authorName: "Nova",
    authorColor: "#f59e0b",
    content: "Мне нравится, что каждый сможет разместить свой сервер на собственном VPS.",
    createdAt: "2026-07-22T09:02:00.000Z",
  },
];

export function createDefaultState(): PersistedClientState {
  return {
    version: STATE_VERSION,
    onboardingComplete: false,
    profile: null,
    servers: [structuredClone(demoServer)],
    messages: structuredClone(demoMessages),
    activeServerId: demoServer.id,
    activeChannelId: "welcome",
    preferences: { compactMode: false, showMemberList: true, notifications: true },
  };
}

export function parsePersistedState(input: unknown): PersistedClientState {
  return persistedClientStateSchema.parse(input);
}

export function safePersistedState(input: unknown): PersistedClientState {
  const parsed = persistedClientStateSchema.safeParse(input);
  return parsed.success ? parsed.data : createDefaultState();
}
