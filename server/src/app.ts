import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { PROTOCOL_VERSION, clientEventSchema, type ClientEvent, type Permission, type ServerEvent } from "@opencord/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Database } from "./database/database";
import { runMigrations } from "./database/migrations";
import { ChatRepository, permissionsForRole } from "./database/repository";
import { userIdFromPublicKey, verifyChallenge } from "./identity";
import { AttachmentSizeError, FileSystemAttachmentStorage, MAX_ATTACHMENT_BYTES, type AttachmentStorage } from "./attachments/storage";

interface ConnectionState {
  socket: WebSocket;
  challenge: string;
  challengeRequestId: string;
  challengeExpiresAt: number;
  userId: string | null;
  sessionToken: string | null;
}

export interface BuildAppOptions {
  database: Database;
  logger?: boolean | object;
  bootstrapOwnerPublicKey?: string;
  allowInsecureFirstUserOwner?: boolean;
  serverName?: string;
  deploymentId?: string;
  attachmentsDir?: string;
  attachmentStorage?: AttachmentStorage;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  await runMigrations(options.database);
  const repository = new ChatRepository(options.database);
  const attachmentStorage = options.attachmentStorage ?? new FileSystemAttachmentStorage(options.attachmentsDir ?? path.resolve(".data", "attachments"));
  if (options.serverName && options.deploymentId) await repository.configureServer(options.serverName, options.deploymentId);
  const connections = new Set<ConnectionState>();
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2_100_000 });

  await app.register(cors, { origin: false });
  await app.register(websocket, { options: { maxPayload: 2_100_000 } });
  app.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));

  app.get("/health", async () => ({ status: "ok", database: options.database.kind, protocolVersion: PROTOCOL_VERSION }));

  app.post("/api/attachments", { bodyLimit: MAX_ATTACHMENT_BYTES }, async (request, reply) => {
    const userId = authorizeHttp(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "AUTH_REQUIRED" });
    if (await repository.countPendingAttachments(userId) >= 20) return reply.code(429).send({ error: "TOO_MANY_PENDING_ATTACHMENTS" });
    const expectedSize = Number(request.headers["content-length"]);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_ATTACHMENT_BYTES) return reply.code(413).send({ error: "FILE_TOO_LARGE" });
    const fileName = decodeFileName(request.headers["x-opencord-file-name"]);
    if (!fileName) return reply.code(400).send({ error: "INVALID_FILE_NAME" });
    const mimeType = parseMimeType(request.headers["x-opencord-mime-type"]);
    const id = randomUUID();
    try {
      const stored = await attachmentStorage.store(id, request.body as Readable, expectedSize);
      try {
        const attachment = await repository.createAttachment(id, userId, stored.storageKey, fileName, mimeType, stored.sizeBytes, stored.sha256);
        return reply.code(201).send(attachment);
      } catch (error) {
        await attachmentStorage.remove(stored.storageKey);
        throw error;
      }
    } catch (error) {
      if (error instanceof AttachmentSizeError) return reply.code(413).send({ error: "FILE_TOO_LARGE" });
      throw error;
    }
  });

  app.get<{ Params: { attachmentId: string } }>("/api/attachments/:attachmentId", async (request, reply) => {
    const userId = authorizeHttp(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "AUTH_REQUIRED" });
    const attachment = await repository.getAccessibleAttachment(request.params.attachmentId, userId);
    if (!attachment) return reply.code(404).send({ error: "NOT_FOUND" });
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    reply.header("Content-Length", attachment.sizeBytes);
    return reply.type(attachment.mimeType).send(attachmentStorage.open(attachment.storageKey));
  });

  app.get("/ws", { websocket: true }, (socket) => {
    const challenge = randomBytes(32).toString("base64");
    const requestId = randomUUID();
    const expiresAt = Date.now() + 60_000;
    const state: ConnectionState = { socket, challenge, challengeRequestId: requestId, challengeExpiresAt: expiresAt, userId: null, sessionToken: null };
    connections.add(state);
    send(socket, { type: "auth.challenge", requestId, protocolVersion: PROTOCOL_VERSION, challenge, expiresAt: new Date(expiresAt).toISOString() });

    socket.on("message", (raw) => {
      void handleIncoming(state, raw.toString()).catch((error: unknown) => {
        app.log.error(error);
        send(socket, { type: "error", requestId: null, code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" });
      });
    });

    socket.on("close", () => {
      connections.delete(state);
      if (state.sessionToken) sessions.delete(state.sessionToken);
      if (state.userId) void broadcastMember(state.userId, false);
    });
  });

  app.addHook("onClose", async () => {
    for (const connection of connections) connection.socket.close(1001, "Server shutdown");
    connections.clear();
    sessions.clear();
    await options.database.close();
  });

  async function handleIncoming(connection: ConnectionState, raw: string): Promise<void> {
    let decoded: unknown;
    try { decoded = JSON.parse(raw) as unknown; } catch { return sendError(connection.socket, null, "INVALID_EVENT", "Некорректный JSON"); }
    const parsed = clientEventSchema.safeParse(decoded);
    if (!parsed.success) {
      const requestId = typeof decoded === "object" && decoded && "requestId" in decoded && typeof decoded.requestId === "string" ? decoded.requestId : null;
      return sendError(connection.socket, requestId, "INVALID_EVENT", "Событие не соответствует протоколу");
    }
    const event = parsed.data;
    if (event.type === "auth.respond") return authenticate(connection, event);
    if (!connection.userId) return sendError(connection.socket, event.requestId, "AUTH_REQUIRED", "Сначала необходимо подтвердить идентичность");
    if (connection.sessionToken) {
      const session = sessions.get(connection.sessionToken);
      if (session) session.expiresAt = Date.now() + 15 * 60_000;
    }
    if (event.type === "ping") return send(connection.socket, { type: "pong", requestId: event.requestId, serverTime: new Date().toISOString() });
    if (event.type === "history.request") {
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      const messages = await repository.getHistory(event.channelId, event.limit);
      return send(connection.socket, { type: "history.result", requestId: event.requestId, channelId: event.channelId, messages });
    }
    if (event.type === "chat.send") {
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      const message = await repository.createMessage(randomUUID(), event.channelId, connection.userId, event.content, event.attachmentIds);
      if (!message) return sendError(connection.socket, event.requestId, "CONFLICT", "Одно или несколько вложений недоступны или уже отправлены");
      broadcast({ type: "message.created", message });
      return;
    }
    if (event.type === "message.update") {
      const existing = await repository.getMessageAccess(event.messageId);
      if (!existing) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Сообщение не найдено");
      if (existing.authorId !== connection.userId) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Редактировать можно только собственные сообщения");
      const message = await repository.updateMessage(event.messageId, connection.userId, event.content);
      if (!message) return sendError(connection.socket, event.requestId, "CONFLICT", "Сообщение должно содержать текст или вложение");
      broadcast({ type: "message.updated", message });
      return;
    }
    if (event.type === "message.delete") {
      const existing = await repository.getMessageAccess(event.messageId);
      if (!existing) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Сообщение не найдено");
      const canDeleteAny = await hasPermission(connection.userId, "MANAGE_MESSAGES");
      if (existing.authorId !== connection.userId && !canDeleteAny) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Недостаточно прав для удаления чужого сообщения");
      const deleted = await repository.deleteMessage(event.messageId, connection.userId, canDeleteAny);
      if (!deleted) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Сообщение уже удалено");
      await Promise.all(deleted.storageKeys.map((storageKey) => attachmentStorage.remove(storageKey).catch((error: unknown) => app.log.error(error))));
      broadcast({ type: "message.deleted", messageId: event.messageId, channelId: deleted.channelId });
      return;
    }
    if (event.type === "channel.create") {
      if (!(await hasPermission(connection.userId, "MANAGE_CHANNELS"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Недостаточно прав для создания каналов");
      await repository.createChannel(randomUUID(), event.name, event.kind, event.description);
      await broadcastSnapshots();
      return;
    }
    if (event.type === "channel.update") {
      if (!(await hasPermission(connection.userId, "MANAGE_CHANNELS"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Недостаточно прав для изменения каналов");
      if (!(await repository.updateChannel(event.channelId, event.name, event.description))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      await broadcastSnapshots();
      return;
    }
    if (event.type === "channel.delete") {
      if (!(await hasPermission(connection.userId, "MANAGE_CHANNELS"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Недостаточно прав для удаления каналов");
      if (!(await repository.deleteChannel(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      await broadcastSnapshots();
      return;
    }
    if (event.type === "member.role.set") {
      if (!(await hasPermission(connection.userId, "MANAGE_ROLES"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Только владелец может управлять администраторами");
      const result = await repository.setMemberRole(event.userId, event.role);
      if (result === "not_found") return sendError(connection.socket, event.requestId, "NOT_FOUND", "Участник не найден");
      if (result === "owner") return sendError(connection.socket, event.requestId, "CONFLICT", "Роль владельца нельзя изменить этой командой");
      await broadcastSnapshots();
      return;
    }
    if (event.type === "server.delete") {
      if (!(await hasPermission(connection.userId, "DELETE_SERVER"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Только владелец может удалить сервер для всех участников");
      await repository.markServerDeleted();
      const server = await repository.getServer();
      broadcast({ type: "server.deleted", serverId: server.id });
      for (const activeConnection of connections) activeConnection.socket.close(4001, "Server deleted");
    }
  }

  async function authenticate(connection: ConnectionState, event: Extract<ClientEvent, { type: "auth.respond" }>): Promise<void> {
    if (event.protocolVersion !== PROTOCOL_VERSION) return sendError(connection.socket, event.requestId, "PROTOCOL_MISMATCH", "Версия протокола не поддерживается");
    if (event.requestId !== connection.challengeRequestId || Date.now() > connection.challengeExpiresAt || !verifyChallenge(event.publicKey, connection.challenge, event.signature)) {
      return sendError(connection.socket, event.requestId, "AUTH_FAILED", "Не удалось подтвердить владение ключом");
    }
    const userId = userIdFromPublicKey(event.publicKey);
    if (await repository.isServerDeleted()) {
      const server = await repository.getServer();
      send(connection.socket, { type: "server.deleted", serverId: server.id });
      connection.socket.close(4001, "Server deleted");
      return;
    }
    await repository.upsertUser(userId, event.publicKey, event.profile);
    await repository.ensureMembership(userId, event.publicKey, options.bootstrapOwnerPublicKey, options.allowInsecureFirstUserOwner === true);
    connection.userId = userId;
    const server = await repository.getServer();
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionExpiresAt = Date.now() + 15 * 60_000;
    sessions.set(sessionToken, { userId, expiresAt: sessionExpiresAt });
    if (connection.sessionToken) sessions.delete(connection.sessionToken);
    connection.sessionToken = sessionToken;
    send(connection.socket, { type: "auth.ok", requestId: event.requestId, userId, serverId: server.id, sessionToken, sessionExpiresAt: new Date(sessionExpiresAt).toISOString() });
    await sendSnapshot(connection);
    await broadcastMember(userId, true);
  }

  async function hasPermission(userId: string, permission: Permission): Promise<boolean> {
    return permissionsForRole(await repository.getMemberRole(userId)).includes(permission);
  }

  async function sendSnapshot(connection: ConnectionState): Promise<void> {
    if (!connection.userId || connection.socket.readyState !== connection.socket.OPEN) return;
    const server = await repository.getServer();
    const role = await repository.getMemberRole(connection.userId);
    send(connection.socket, {
      type: "server.snapshot",
      server: { ...server, members: await repository.listMembers(onlineUserIds()), currentUser: { id: connection.userId, role, permissions: permissionsForRole(role) } },
    });
  }

  async function broadcastSnapshots(): Promise<void> {
    await Promise.all([...connections].map((connection) => sendSnapshot(connection)));
  }

  function onlineUserIds(): Set<string> {
    return new Set([...connections].flatMap((connection) => connection.userId ? [connection.userId] : []));
  }

  async function broadcastMember(userId: string, online: boolean): Promise<void> {
    try { broadcast({ type: "member.updated", member: await repository.getMember(userId, online) }); } catch (error) { app.log.error(error); }
  }

  function broadcast(event: ServerEvent): void {
    for (const connection of connections) if (connection.userId && connection.socket.readyState === connection.socket.OPEN) send(connection.socket, event);
  }

  function authorizeHttp(authorization: string | undefined): string | null {
    const match = /^Bearer ([A-Za-z0-9_-]{40,200})$/u.exec(authorization ?? "");
    if (!match) return null;
    const token = match[1]!;
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return session.userId;
  }

  return app;
}

function decodeFileName(header: string | string[] | undefined): string | null {
  if (typeof header !== "string" || header.length > 500) return null;
  try {
    const decoded = Buffer.from(header, "base64url").toString("utf8").replaceAll("\\", "/").split("/").at(-1)?.trim() ?? "";
    return decoded && decoded.length <= 255 && !/[\u0000-\u001f\u007f]/u.test(decoded) ? decoded : null;
  } catch { return null; }
}

function parseMimeType(header: string | string[] | undefined): string {
  return typeof header === "string" && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(header) && header.length <= 100
    ? header.toLowerCase()
    : "application/octet-stream";
}

function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
}

function sendError(socket: WebSocket, requestId: string | null, code: Extract<ServerEvent, { type: "error" }>["code"], message: string): void {
  send(socket, { type: "error", requestId, code, message });
}
