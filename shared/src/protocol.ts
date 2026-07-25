import { z } from "zod";

export const PROTOCOL_VERSION = 7 as const;

export const memberRoleSchema = z.enum(["owner", "administrator", "member"]);
export const permissionSchema = z.enum(["MANAGE_CHANNELS", "MANAGE_MESSAGES", "MANAGE_ROLES", "DELETE_SERVER"]);

export const publicProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(32),
  avatar: z.string().max(2_000_000).nullable().default(null),
});

export const channelSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(48),
  kind: z.enum(["text", "voice"]),
  description: z.string().max(120),
});

export const memberSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(32),
  avatar: z.string().max(2_000_000).nullable(),
  status: z.enum(["online", "offline"]),
  role: memberRoleSchema,
});

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  authorId: z.string().min(1),
  authorName: z.string().min(1).max(32),
  authorAvatar: z.string().max(2_000_000).nullable(),
  content: z.string().trim().max(4_000),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable().default(null),
  attachments: z.array(attachmentSchema).max(5).default([]),
}).superRefine((message, context) => {
  if (!message.content && message.attachments.length === 0) context.addIssue({ code: "custom", path: ["content"], message: "Message requires text or an attachment" });
});

const requestIdSchema = z.string().uuid();

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
  z.object({ type: z.literal("chat.send"), requestId: requestIdSchema, channelId: z.string().uuid(), content: z.string().trim().max(4_000), attachmentIds: z.array(z.string().uuid()).max(5).default([]) }),
  z.object({ type: z.literal("message.update"), requestId: requestIdSchema, messageId: z.string().uuid(), content: z.string().trim().max(4_000) }),
  z.object({ type: z.literal("message.delete"), requestId: requestIdSchema, messageId: z.string().uuid() }),
  z.object({ type: z.literal("channel.create"), requestId: requestIdSchema, name: z.string().trim().min(1).max(48), kind: z.enum(["text", "voice"]), description: z.string().trim().max(120).default("") }),
  z.object({ type: z.literal("channel.update"), requestId: requestIdSchema, channelId: z.string().uuid(), name: z.string().trim().min(1).max(48), description: z.string().trim().max(120).default("") }),
  z.object({ type: z.literal("channel.delete"), requestId: requestIdSchema, channelId: z.string().uuid() }),
  z.object({ type: z.literal("member.role.set"), requestId: requestIdSchema, userId: z.string().min(1), role: z.enum(["administrator", "member"]) }),
  z.object({ type: z.literal("server.delete"), requestId: requestIdSchema }),
  z.object({ type: z.literal("ping"), requestId: requestIdSchema }),
]).superRefine((event, context) => {
  if (event.type === "chat.send" && !event.content && event.attachmentIds.length === 0) context.addIssue({ code: "custom", path: ["content"], message: "Message requires text or an attachment" });
});

export const serverEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.challenge"), requestId: requestIdSchema, protocolVersion: z.literal(PROTOCOL_VERSION), challenge: z.string(), expiresAt: z.string().datetime() }),
  z.object({ type: z.literal("auth.ok"), requestId: requestIdSchema, userId: z.string(), serverId: z.string().uuid(), sessionToken: z.string().min(40).max(200), sessionExpiresAt: z.string().datetime() }),
  z.object({ type: z.literal("server.snapshot"), server: z.object({ id: z.string().uuid(), name: z.string().min(2).max(48), channels: z.array(channelSchema), members: z.array(memberSchema), currentUser: z.object({ id: z.string().min(1), role: memberRoleSchema, permissions: z.array(permissionSchema) }) }) }),
  z.object({ type: z.literal("server.deleted"), serverId: z.string().uuid() }),
  z.object({ type: z.literal("history.result"), requestId: requestIdSchema, channelId: z.string().uuid(), messages: z.array(chatMessageSchema) }),
  z.object({ type: z.literal("message.created"), message: chatMessageSchema }),
  z.object({ type: z.literal("message.updated"), message: chatMessageSchema }),
  z.object({ type: z.literal("message.deleted"), messageId: z.string().uuid(), channelId: z.string().uuid() }),
  z.object({ type: z.literal("member.updated"), member: memberSchema }),
  z.object({ type: z.literal("pong"), requestId: requestIdSchema, serverTime: z.string().datetime() }),
  z.object({ type: z.literal("error"), requestId: requestIdSchema.nullable(), code: z.enum(["INVALID_EVENT", "AUTH_REQUIRED", "AUTH_FAILED", "PROTOCOL_MISMATCH", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR"]), message: z.string() }),
]);

export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type Member = z.infer<typeof memberSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;

export function parseClientEvent(input: unknown): ClientEvent {
  return clientEventSchema.parse(input);
}

export function parseServerEvent(input: unknown): ServerEvent {
  return serverEventSchema.parse(input);
}
