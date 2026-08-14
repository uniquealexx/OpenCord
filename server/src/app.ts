import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { PROTOCOL_VERSION, clientEventSchema, serverHealthSchema, type ChatMessage, type ClientEvent, type Permission, type PublicMemberStatus, type ServerEvent, type UserStatus } from "@opencord/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Database } from "./database/database";
import { runMigrations } from "./database/migrations";
import { ChatRepository, messageForViewer, permissionsForRole } from "./database/repository";
import { userIdFromPublicKey, verifyChallenge } from "./identity";
import { AttachmentSizeError, FileSystemAttachmentStorage, type AttachmentStorage } from "./attachments/storage";
import { DisabledVoiceService, VoiceRoomFullError, VoiceUnavailableError, type VoiceService } from "./voice";
import type { ServerBuildInfo } from "./build-info";

interface ConnectionState {
  socket: WebSocket;
  challenge: string;
  challengeRequestId: string;
  challengeExpiresAt: number;
  userId: string | null;
  sessionToken: string | null;
  presenceStatus: UserStatus | null;
}

export interface BuildAppOptions {
  database: Database;
  buildInfo: ServerBuildInfo;
  logger?: boolean | object;
  bootstrapOwnerPublicKey?: string;
  allowInsecureFirstUserOwner?: boolean;
  serverName?: string;
  deploymentId?: string;
  attachmentsDir?: string;
  attachmentStorage?: AttachmentStorage;
  voiceService?: VoiceService;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  await runMigrations(options.database);
  const repository = new ChatRepository(options.database);
  const attachmentStorage = options.attachmentStorage ?? new FileSystemAttachmentStorage(options.attachmentsDir ?? path.resolve(".data", "attachments"));
  const voice = options.voiceService ?? new DisabledVoiceService();
  if (options.serverName && options.deploymentId) await repository.configureServer(options.serverName, options.deploymentId);
  const connections = new Set<ConnectionState>();
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2_100_000 });
  const voiceReconcileTimer = setInterval(() => { void reconcileVoicePresence(); }, 30_000);
  voiceReconcileTimer.unref();

  await app.register(cors, { origin: false });
  await app.register(websocket, { options: { maxPayload: 2_100_000 } });
  app.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));
  app.addContentTypeParser("application/webhook+json", { parseAs: "string" }, (_request, body, done) => done(null, body));

  app.get("/health", async () => serverHealthSchema.parse({
    status: "ok",
    service: "opencord-server",
    version: options.buildInfo.version,
    releaseChannel: options.buildInfo.releaseChannel,
    buildCommit: options.buildInfo.commit?.slice(0, 12) ?? null,
    database: options.database.kind,
    protocolVersion: PROTOCOL_VERSION,
    voice: await voice.capability(),
  }));

  app.post("/internal/livekit/webhook", async (request, reply) => {
    if (typeof request.body !== "string") return reply.code(400).send({ error: "INVALID_WEBHOOK" });
    try {
      const change = await voice.receiveWebhook(request.body, request.headers.authorization);
      if (change?.joined) broadcast({ type: "voice.participant.joined", participant: change.joined });
      if (change?.left) broadcast({ type: "voice.participant.left", participant: change.left });
      return reply.code(204).send();
    } catch { return reply.code(401).send({ error: "INVALID_WEBHOOK" }); }
  });

  app.post("/api/attachments", { bodyLimit: Number.MAX_SAFE_INTEGER }, async (request, reply) => {
    const userId = authorizeHttp(request.headers.authorization);
    if (!userId) return reply.code(401).send({ error: "AUTH_REQUIRED" });
    if (await repository.countPendingAttachments(userId) >= 20) return reply.code(429).send({ error: "TOO_MANY_PENDING_ATTACHMENTS" });
    const expectedSize = Number(request.headers["content-length"]);
    const { maxAttachmentBytes } = await repository.getServer();
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || (maxAttachmentBytes !== null && expectedSize > maxAttachmentBytes)) return reply.code(413).send({ error: "FILE_TOO_LARGE" });
    const fileName = decodeFileName(request.headers["x-opencord-file-name"]);
    if (!fileName) return reply.code(400).send({ error: "INVALID_FILE_NAME" });
    const mimeType = parseMimeType(request.headers["x-opencord-mime-type"]);
    const id = randomUUID();
    try {
      const stored = await attachmentStorage.store(id, request.body as Readable, expectedSize, maxAttachmentBytes);
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
    const state: ConnectionState = { socket, challenge, challengeRequestId: requestId, challengeExpiresAt: expiresAt, userId: null, sessionToken: null, presenceStatus: null };
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
      if (state.userId) void broadcastMember(state.userId, publicUserStatuses().get(state.userId) ?? "offline");
    });
  });

  app.addHook("onClose", async () => {
    clearInterval(voiceReconcileTimer);
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
    if (event.type === "chat.send" || event.type === "chat.pm" || event.type === "chat.apm") {
      if (await repository.isChatMuted(connection.userId)) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Вы отключены от чата администратором");
    }
    if (event.type === "profile.update") {
      if (!(await repository.updateUserProfile(connection.userId, event.profile))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Профиль пользователя не найден");
      connection.presenceStatus = event.profile.status;
      await broadcastMember(connection.userId, publicStatus(event.profile.status));
      return;
    }
    if (event.type === "server.leave") {
      const userId = connection.userId;
      const voicePresence = await voice.leave(userId);
      if (voicePresence) broadcast({ type: "voice.participant.left", participant: voicePresence });
      const role = await repository.leaveServer(userId);
      if (!role) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Участник сервера не найден");
      if (role === "owner") broadcast({ type: "member.updated", member: await repository.getMember(userId, "offline") });
      else broadcast({ type: "member.removed", userId });
      connection.userId = null;
      connection.socket.close(1000, "Left server");
      return;
    }
    if (event.type === "history.request") {
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      const messages = await repository.getHistory(event.channelId, event.limit, connection.userId);
      return send(connection.socket, { type: "history.result", requestId: event.requestId, channelId: event.channelId, messages });
    }
    if (event.type === "message.search") {
      const result = await repository.searchMessages(event.filters);
      return send(connection.socket, { type: "message.search.result", requestId: event.requestId, result });
    }
    if (event.type === "chat.send") {
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      const message = await repository.createMessage(randomUUID(), event.channelId, connection.userId, event.content, event.attachmentIds, event.mentions);
      if (!message) return sendError(connection.socket, event.requestId, "CONFLICT", "Одно или несколько вложений недоступны или уже отправлены");
      broadcast({ type: "message.created", message });
      return;
    }
    if (event.type === "chat.pm" || event.type === "chat.apm") {
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      if (event.targetUserId === connection.userId) return sendError(connection.socket, event.requestId, "CONFLICT", "Нельзя отправить личное сообщение самому себе");
      try { await repository.getMemberRole(event.targetUserId); } catch { return sendError(connection.socket, event.requestId, "NOT_FOUND", "Получатель не найден"); }
      const anonymous = event.type === "chat.apm";
      const message = await repository.createMessage(randomUUID(), event.channelId, connection.userId, event.content, [], [], anonymous ? "apm" : "pm", event.targetUserId, anonymous);
      if (!message) return sendError(connection.socket, event.requestId, "CONFLICT", "Не удалось отправить личное сообщение");
      routeMessageEvent(message, (current) => ({ type: "message.created", message: current }));
      return;
    }
    if (event.type === "chat.mute.set") {
      if (!(await hasPermission(connection.userId, "MANAGE_MESSAGES"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Недостаточно прав для управления чатом");
      if (event.userId === connection.userId) return sendError(connection.socket, event.requestId, "CONFLICT", "Нельзя замьютить самого себя");
      let targetRole: import("@opencord/shared").MemberRole;
      try { targetRole = await repository.getMemberRole(event.userId); } catch { return sendError(connection.socket, event.requestId, "NOT_FOUND", "Участник не найден"); }
      const actorRole = await repository.getMemberRole(connection.userId);
      if (targetRole === "owner" || (actorRole === "administrator" && targetRole !== "member")) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нельзя изменить мут этого участника");
      if (!(await repository.setChatMuted(event.userId, event.muted, event.durationMinutes))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Участник не найден");
      await broadcastMember(event.userId, publicUserStatuses().get(event.userId) ?? "offline");
      return;
    }
    if (event.type === "message.update") {
      const existing = await repository.getMessageAccess(event.messageId);
      if (!existing) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Сообщение не найдено");
      if (existing.authorId !== connection.userId) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Редактировать можно только собственные сообщения");
      const updated = await repository.updateMessage(event.messageId, connection.userId, event.content, event.attachmentIds, event.mentions);
      if (!updated) return sendError(connection.socket, event.requestId, "CONFLICT", "Сообщение должно содержать текст или доступное вложение");
      await Promise.all(updated.removedStorageKeys.map((storageKey) => attachmentStorage.remove(storageKey).catch((error: unknown) => app.log.error(error))));
      routeMessageEvent(updated.message, (current) => ({ type: "message.updated", message: current }));
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
      if (existing.kind === "chat") broadcast({ type: "message.deleted", messageId: event.messageId, channelId: deleted.channelId });
      else sendToParticipants(existing.authorId, existing.targetUserId, { type: "message.deleted", messageId: event.messageId, channelId: deleted.channelId });
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
      const existingChannel = await repository.getChannel(event.channelId);
      if (!existingChannel) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      if (existingChannel.kind === "voice" && event.participantLimit === null) return sendError(connection.socket, event.requestId, "INVALID_EVENT", "Для голосового канала необходим лимит участников");
      if (!(await repository.updateChannel(event.channelId, event.name, event.description, event.participantLimit))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      await broadcastSnapshots();
      return;
    }
    if (event.type === "channel.delete") {
      if (!(await hasPermission(connection.userId, "MANAGE_CHANNELS"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Недостаточно прав для удаления каналов");
      const channel = await repository.getChannel(event.channelId);
      if (!(await repository.deleteChannel(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      if (channel?.kind === "voice") {
        const disconnected = await voice.removeChannel(channel.id);
        for (const participant of disconnected) broadcast({ type: "voice.participant.disconnected", userId: participant.userId, channelId: participant.channelId, reason: "channel_deleted" });
      }
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
    if (event.type === "server.avatar.update") {
      if (!(await hasPermission(connection.userId, "MANAGE_SERVER"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Только владелец может изменить аватар сервера");
      await repository.updateServerAvatar(event.avatar);
      const server = await repository.getServer();
      broadcast({ type: "server.avatar.updated", serverId: server.id, avatar: server.avatar });
      return;
    }
    if (event.type === "server.banner.update") {
      if (!(await hasPermission(connection.userId, "MANAGE_SERVER"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Только владелец может изменить обложку сервера");
      await repository.updateServerBanner(event.banner);
      const server = await repository.getServer();
      broadcast({ type: "server.banner.updated", serverId: server.id, banner: server.banner });
      return;
    }
    if (event.type === "member.kick") {
      if (!(await hasPermission(connection.userId, "KICK_MEMBERS"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нет прав для исключения участников");
      if (event.userId === connection.userId) return sendError(connection.socket, event.requestId, "CONFLICT", "Нельзя исключить самого себя");
      let targetRole: import("@opencord/shared").MemberRole;
      try { targetRole = await repository.getMemberRole(event.userId); } catch { return sendError(connection.socket, event.requestId, "NOT_FOUND", "Участник не найден"); }
      const actorRole = await repository.getMemberRole(connection.userId);
      if (targetRole === "owner" || (actorRole === "administrator" && targetRole !== "member")) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нельзя исключить этого участника");
      const voicePresence = await voice.disconnect(event.userId, "moderated");
      if (voicePresence) broadcast({ type: "voice.participant.disconnected", userId: voicePresence.userId, channelId: voicePresence.channelId, reason: "moderated" });
      const removedRole = await repository.leaveServer(event.userId);
      if (!removedRole || removedRole === "owner") return sendError(connection.socket, event.requestId, "CONFLICT", "Не удалось исключить участника");
      broadcast({ type: "member.removed", userId: event.userId });
      for (const targetConnection of connections) {
        if (targetConnection.userId !== event.userId) continue;
        if (targetConnection.sessionToken) sessions.delete(targetConnection.sessionToken);
        targetConnection.userId = null;
        targetConnection.sessionToken = null;
        targetConnection.socket.close(4003, "Kicked from server");
      }
      return;
    }
    if (event.type === "server.settings.update") {
      if (!(await hasPermission(connection.userId, "MANAGE_SERVER"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Недостаточно прав для изменения настроек сервера");
      await repository.updateServerSettings({ name: event.name, maxAttachmentBytes: event.maxAttachmentBytes, screenShareMaxResolution: event.screenShareMaxResolution, screenShareMaxFrameRate: event.screenShareMaxFrameRate });
      await broadcastSnapshots();
      return;
    }
    if (event.type === "voice.join") {
      if (!(await hasPermission(connection.userId, "VOICE_CONNECT")) || !(await hasPermission(connection.userId, "VOICE_SPEAK"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нет прав для подключения к голосовому каналу");
      const channel = await repository.getChannel(event.channelId);
      if (!channel || channel.kind !== "voice") return sendError(connection.socket, event.requestId, "NOT_FOUND", "Голосовой канал не найден");
      try {
        const server = await repository.getServer();
        const authorization = await voice.issueJoin({ serverId: server.id, channelId: channel.id, userId: connection.userId, participantLimit: channel.participantLimit ?? 25 });
        if (authorization.replaced) broadcast({ type: "voice.participant.disconnected", userId: authorization.replaced.userId, channelId: authorization.replaced.channelId, reason: "replaced" });
        send(connection.socket, { type: "voice.join.authorized", requestId: event.requestId, channelId: channel.id, endpoint: authorization.endpoint, token: authorization.token, expiresAt: authorization.expiresAt });
      } catch (error) {
        if (error instanceof VoiceUnavailableError) return sendError(connection.socket, event.requestId, "VOICE_UNAVAILABLE", error.message);
        if (error instanceof VoiceRoomFullError) return sendError(connection.socket, event.requestId, "VOICE_ROOM_FULL", error.message);
        app.log.error(error);
        return sendError(connection.socket, event.requestId, "INTERNAL_ERROR", "Не удалось подготовить голосовое подключение");
      }
      return;
    }
    if (event.type === "voice.leave") {
      const presence = await voice.leave(connection.userId);
      if (presence) broadcast({ type: "voice.participant.left", participant: presence });
      return;
    }
    if (event.type === "voice.state.update") {
      const presence = voice.updateState(connection.userId, { muted: event.muted, deafened: event.deafened, viewingScreenShareUserId: event.viewingScreenShareUserId });
      if (!presence) return sendError(connection.socket, event.requestId, "CONFLICT", "Сначала подключитесь к голосовому каналу");
      broadcast({ type: "voice.participant.updated", participant: presence });
      return;
    }
    if (event.type === "voice.member.disconnect") {
      if (!(await hasPermission(connection.userId, "VOICE_MODERATE"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нет прав для управления голосовым каналом");
      if (event.userId === connection.userId) return sendError(connection.socket, event.requestId, "CONFLICT", "Выйдите из канала самостоятельно");
      let targetRole: import("@opencord/shared").MemberRole;
      try { targetRole = await repository.getMemberRole(event.userId); } catch { return sendError(connection.socket, event.requestId, "NOT_FOUND", "Участник не найден"); }
      const actorRole = await repository.getMemberRole(connection.userId);
      if (targetRole === "owner" || (actorRole === "administrator" && targetRole !== "member")) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нельзя отключить этого участника");
      const presence = await voice.disconnect(event.userId, "moderated");
      if (presence) broadcast({ type: "voice.participant.disconnected", userId: presence.userId, channelId: presence.channelId, reason: "moderated" });
      return;
    }
    if (event.type === "voice.member.mute") {
      if (!(await hasPermission(connection.userId, "VOICE_MODERATE"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нет прав для управления голосовым каналом");
      if (event.userId === connection.userId) return sendError(connection.socket, event.requestId, "CONFLICT", "Используйте собственную кнопку микрофона");
      let targetRole: import("@opencord/shared").MemberRole;
      try { targetRole = await repository.getMemberRole(event.userId); } catch { return sendError(connection.socket, event.requestId, "NOT_FOUND", "Участник не найден"); }
      const actorRole = await repository.getMemberRole(connection.userId);
      if (targetRole === "owner" || (actorRole === "administrator" && targetRole !== "member")) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нельзя изменить серверный мут этого участника");
      try {
        const presence = await voice.setModeratorMuted(event.userId, event.muted);
        if (!presence) return sendError(connection.socket, event.requestId, "CONFLICT", "Участник не подключён к голосовому каналу");
        broadcast({ type: "voice.participant.updated", participant: presence });
      } catch (error) {
        app.log.error(error);
        return sendError(connection.socket, event.requestId, "INTERNAL_ERROR", "Не удалось изменить серверный мут участника");
      }
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
    connection.presenceStatus = event.profile.status;
    const server = await repository.getServer();
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionExpiresAt = Date.now() + 15 * 60_000;
    sessions.set(sessionToken, { userId, expiresAt: sessionExpiresAt });
    if (connection.sessionToken) sessions.delete(connection.sessionToken);
    connection.sessionToken = sessionToken;
    send(connection.socket, { type: "auth.ok", requestId: event.requestId, userId, serverId: server.id, sessionToken, sessionExpiresAt: new Date(sessionExpiresAt).toISOString() });
    await sendSnapshot(connection);
    await broadcastMember(userId, publicStatus(event.profile.status));
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
      server: { ...server, members: await repository.listMembers(publicUserStatuses()), currentUser: { id: connection.userId, role, permissions: permissionsForRole(role) }, voice: await voice.capability(), voiceParticipants: voice.presence() },
    });
  }

  async function broadcastSnapshots(): Promise<void> {
    await Promise.all([...connections].map((connection) => sendSnapshot(connection)));
  }

  async function reconcileVoicePresence(): Promise<void> {
    try {
      const server = await repository.getServer();
      const before = JSON.stringify({ presence: voice.presence(), capability: await voice.capability() });
      await voice.reconcile(server.channels.filter((channel) => channel.kind === "voice").map((channel) => channel.id));
      const after = JSON.stringify({ presence: voice.presence(), capability: await voice.capability() });
      if (before !== after) await broadcastSnapshots();
    } catch (error) { app.log.warn(error, "Voice presence reconciliation failed"); }
  }

  function publicStatus(status: UserStatus | null): PublicMemberStatus {
    return status === "invisible" || status === null ? "offline" : status;
  }

  function publicUserStatuses(): Map<string, PublicMemberStatus> {
    const statuses = new Map<string, PublicMemberStatus>();
    for (const connection of connections) if (connection.userId) statuses.set(connection.userId, publicStatus(connection.presenceStatus));
    return statuses;
  }

  async function broadcastMember(userId: string, status: PublicMemberStatus): Promise<void> {
    try { broadcast({ type: "member.updated", member: await repository.getMember(userId, status) }); } catch (error) { app.log.error(error); }
  }

  function broadcast(event: ServerEvent): void {
    for (const connection of connections) if (connection.userId && connection.socket.readyState === connection.socket.OPEN) send(connection.socket, event);
  }

  /**
   * Доставка события о личном сообщении: обычные сообщения — всем, личные —
   * только отправителю и получателю. Анонимное сообщение получателю маскируется.
   */
  function routeMessageEvent(message: ChatMessage, build: (message: ChatMessage) => ServerEvent): void {
    if (message.kind === "chat") { broadcast(build(message)); return; }
    const recipients = new Set([message.authorId, message.targetUserId].filter((id): id is string => typeof id === "string" && id.length > 0));
    for (const connection of connections) {
      if (connection.userId && recipients.has(connection.userId) && connection.socket.readyState === connection.socket.OPEN) {
        send(connection.socket, build(messageForViewer(message, connection.userId)));
      }
    }
  }

  function sendToParticipants(authorId: string, targetUserId: string | null, event: ServerEvent): void {
    const recipients = new Set([authorId, targetUserId].filter((id): id is string => typeof id === "string" && id.length > 0));
    for (const connection of connections) {
      if (connection.userId && recipients.has(connection.userId) && connection.socket.readyState === connection.socket.OPEN) send(connection.socket, event);
    }
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
