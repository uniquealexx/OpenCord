import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { stripBidiControls, MESSAGE_FLOOD_BURST, MESSAGE_FLOOD_SUSTAINED, MESSAGE_FLOOD_WINDOW_MS, PROTOCOL_VERSION, VOICE_JOIN_BURST, VOICE_JOIN_REFILL_MS, VOICE_MODERATED_REJOIN_COOLDOWN_MS, VOICE_ORPHAN_GRACE_MS, clientEventSchema, serverHealthSchema, type ChatMessage, type ClientEvent, type Permission, type PublicMemberStatus, type ServerEvent, type UserStatus } from "@opencord/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Database } from "./database/database";
import { runMigrations } from "./database/migrations";
import { ChatRepository, messageForViewer, permissionsForRole } from "./database/repository";
import { userIdFromPublicKey, verifyChallenge } from "./identity";
import { AttachmentSizeError, FileSystemAttachmentStorage, type AttachmentStorage } from "./attachments/storage";
import { createFloodLimiter } from "./rate-limit";
import { DisabledVoiceService, VOICE_MUTE_VERIFY_DELAY_MS, VoiceRoomFullError, VoiceUnavailableError, type VoiceLookups, type VoiceService } from "./voice";
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
  /** Пауза перед освобождением голоса после потери соединения; переопределяется в тестах. */
  voiceOrphanGraceMs?: number;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  await runMigrations(options.database);
  const repository = new ChatRepository(options.database);
  await repository.performRetentionCleanup();
  const purgedReactions = await repository.purgeInvalidReactions();
  const attachmentStorage = options.attachmentStorage ?? new FileSystemAttachmentStorage(options.attachmentsDir ?? path.resolve(".data", "attachments"));
  const voice = options.voiceService ?? new DisabledVoiceService();
  if (options.serverName && options.deploymentId) await repository.configureServer(options.serverName, options.deploymentId);
  const connections = new Set<ConnectionState>();
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  // Пауза после отключения модератором: без неё отключённый возвращался мгновенно.
  // Хранится в памяти намеренно — она живёт секунды, и перезапуск сервера её обнуляет
  // вместе со всей голосовой сессией.
  const voiceRejoinCooldowns = new Map<string, number>();
  // Отложенные проверки заявленного мута, по одной на участника.
  const voiceMuteVerifications = new Map<string, NodeJS.Timeout>();
  // Отложенное освобождение голоса после потери управляющего соединения.
  const voiceOrphanTimers = new Map<string, NodeJS.Timeout>();
  // Настройки, которые голосовой сервис читает в момент события: держать их копию
  // внутри сервиса значило бы дублировать источник истины и разъезжаться с ним.
  const voiceLookups: VoiceLookups = {
    serverMuted: (userId: string) => repository.isVoiceMuted(userId),
    server: async () => {
      const server = await repository.getServer();
      return { id: server.id, screenShareMaxHeight: server.screenShareMaxResolution };
    },
    mayBeInVoice: async (userId: string) => {
      if (await repository.findActiveBan(userId)) return false;
      // getMemberRole бросает для того, кто на сервере не состоит: исключённый — не участник.
      try { return permissionsForRole(await repository.getMemberRole(userId)).includes("VOICE_CONNECT"); } catch { return false; }
    },
  };
  // Предел на идентичность, а не на канал: медленный режим настраивают модераторы,
  // а это — нижняя граница, которую модифицированный клиент не обходит.
  const floodLimiter = createFloodLimiter({ capacity: MESSAGE_FLOOD_BURST, refillIntervalMs: MESSAGE_FLOOD_WINDOW_MS / MESSAGE_FLOOD_SUSTAINED });
  // Отдельный ограничитель: вход в голосовой канал стоит дороже сообщения (обращения
  // к LiveKit и рассылка всем), но и случается несопоставимо реже.
  const voiceJoinLimiter = createFloodLimiter({ capacity: VOICE_JOIN_BURST, refillIntervalMs: VOICE_JOIN_REFILL_MS });
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2_100_000 });
  const voiceReconcileTimer = setInterval(() => { void reconcileVoicePresence(); }, 30_000);
  voiceReconcileTimer.unref();
  const retentionCleanupTimer = setInterval(() => {
    void runRetentionCleanup().catch((error: unknown) => app.log.error(error));
  }, 15 * 60_000);
  retentionCleanupTimer.unref();

  if (purgedReactions > 0) app.log.info(`Удалено реакций, не являющихся эмодзи: ${purgedReactions}`);

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
      const change = await voice.receiveWebhook(request.body, request.headers.authorization, voiceLookups);
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
      if (!state.userId) return;
      void broadcastMember(state.userId, publicUserStatuses().get(state.userId) ?? "offline");
      // Соединение с LiveKit живёт отдельно от этого WebSocket, поэтому голос надо
      // освободить самим — иначе участник остаётся в канале и слышен, числясь офлайн.
      scheduleVoiceOrphanRelease(state.userId);
    });
  });

  app.addHook("onClose", async () => {
    clearInterval(voiceReconcileTimer);
    clearInterval(retentionCleanupTimer);
    for (const timer of voiceMuteVerifications.values()) clearTimeout(timer);
    voiceMuteVerifications.clear();
    for (const timer of voiceOrphanTimers.values()) clearTimeout(timer);
    voiceOrphanTimers.clear();
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
      const flood = floodLimiter.consume(`message:${connection.userId}`);
      if (!flood.allowed) return sendError(connection.socket, event.requestId, "RATE_LIMITED", `Слишком много сообщений подряд, подождите ${formatDelay(flood.retryAfterMs)}`, flood.retryAfterMs);
    }
    if (event.type === "message.react") {
      const flood = floodLimiter.consume(`react:${connection.userId}`);
      if (!flood.allowed) return sendError(connection.socket, event.requestId, "RATE_LIMITED", `Слишком много реакций подряд, подождите ${formatDelay(flood.retryAfterMs)}`, flood.retryAfterMs);
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
      await runRetentionCleanup();
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      const messages = await repository.getHistory(event.channelId, event.limit, connection.userId);
      return send(connection.socket, { type: "history.result", requestId: event.requestId, channelId: event.channelId, messages });
    }
    if (event.type === "message.search") {
      await runRetentionCleanup();
      const result = await repository.searchMessages(event.filters);
      return send(connection.socket, { type: "message.search.result", requestId: event.requestId, result });
    }
    if (event.type === "chat.send") {
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      const waitMs = await slowmodeDelay(connection.userId, event.channelId);
      if (waitMs > 0) return sendError(connection.socket, event.requestId, "RATE_LIMITED", `Медленный режим канала: следующее сообщение можно отправить через ${formatDelay(waitMs)}`, waitMs);
      if (event.replyToMessageId && !(await repository.canReplyToMessage(event.replyToMessageId, event.channelId, connection.userId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Исходное сообщение для ответа не найдено или недоступно");
      const message = await repository.createMessage(randomUUID(), event.channelId, connection.userId, event.content, event.attachmentIds, event.mentions, "chat", null, false, event.replyToMessageId);
      if (!message) return sendError(connection.socket, event.requestId, "CONFLICT", "Одно или несколько вложений недоступны или уже отправлены");
      broadcast({ type: "message.created", message });
      return;
    }
    if (event.type === "chat.pm" || event.type === "chat.apm") {
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      if (event.targetUserId === connection.userId) return sendError(connection.socket, event.requestId, "CONFLICT", "Нельзя отправить личное сообщение самому себе");
      if (event.replyToMessageId && !(await repository.canReplyToMessage(event.replyToMessageId, event.channelId, connection.userId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Исходное сообщение для ответа не найдено или недоступно");
      try { await repository.getMemberRole(event.targetUserId); } catch { return sendError(connection.socket, event.requestId, "NOT_FOUND", "Получатель не найден"); }
      const anonymous = event.type === "chat.apm";
      const message = await repository.createMessage(randomUUID(), event.channelId, connection.userId, event.content, [], [], anonymous ? "apm" : "pm", event.targetUserId, anonymous, event.replyToMessageId);
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
    if (event.type === "message.react") {
      const access = await repository.getMessageAccess(event.messageId);
      if (!access) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Сообщение не найдено");
      // Реагировать можно только на видимое сообщение: посторонний с чужим идентификатором
      // получает тот же ответ, что и на несуществующее, — существование ЛС не подтверждается.
      if (access.kind !== "chat" && access.authorId !== connection.userId && access.targetUserId !== connection.userId) {
        return sendError(connection.socket, event.requestId, "NOT_FOUND", "Сообщение не найдено");
      }
      if (access.kind === "apm" && access.authorId === connection.userId) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нельзя реагировать на собственное анонимное сообщение");
      const reactions = await repository.toggleReaction(event.messageId, connection.userId, event.emoji);
      if (reactions === null) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Сообщение не найдено");
      const payload = { type: "message.reactions.updated" as const, messageId: event.messageId, channelId: access.channelId, reactions };
      if (access.kind === "chat") broadcast(payload);
      else sendToParticipants(access.authorId, access.targetUserId, payload);
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
      if (!(await repository.updateChannel(event.channelId, event.name, event.description, event.participantLimit, event.slowmodeSeconds))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      await broadcastSnapshots();
      return;
    }
    if (event.type === "channel.slowmode.set") {
      if (!(await hasPermission(connection.userId, "MANAGE_CHANNELS"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Недостаточно прав для изменения каналов");
      const updated = await repository.setChannelsSlowmode(event.channelIds, event.slowmodeSeconds);
      if (!updated.length) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Не найдено ни одного текстового канала из списка");
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
      const removedRole = await repository.leaveServer(event.userId, "kick");
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
    if (event.type === "member.ban") {
      if (!(await hasPermission(connection.userId, "KICK_MEMBERS"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нет прав для блокировки участников");
      if (event.userId === connection.userId) return sendError(connection.socket, event.requestId, "CONFLICT", "Нельзя заблокировать самого себя");
      let targetRole: import("@opencord/shared").MemberRole;
      try { targetRole = await repository.getMemberRole(event.userId); } catch { return sendError(connection.socket, event.requestId, "NOT_FOUND", "Участник не найден"); }
      const actorRole = await repository.getMemberRole(connection.userId);
      if (targetRole === "owner" || (actorRole === "administrator" && targetRole !== "member")) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нельзя заблокировать этого участника");
      const voicePresence = await voice.disconnect(event.userId, "moderated");
      if (voicePresence) broadcast({ type: "voice.participant.disconnected", userId: voicePresence.userId, channelId: voicePresence.channelId, reason: "moderated" });
      if (!(await repository.banMember(event.userId, connection.userId, event.durationMinutes))) return sendError(connection.socket, event.requestId, "CONFLICT", "Не удалось заблокировать участника");
      // Самому забаненному member.removed не отправляется: иначе его клиент удалил бы сервер
      // из списка и показал бы «вас исключили» вместо экрана блокировки со сроком.
      broadcast({ type: "member.removed", userId: event.userId }, event.userId);
      const newBan = await repository.findActiveBan(event.userId);
      for (const targetConnection of connections) {
        if (targetConnection.userId !== event.userId) continue;
        if (targetConnection.sessionToken) sessions.delete(targetConnection.sessionToken);
        targetConnection.userId = null;
        targetConnection.sessionToken = null;
        send(targetConnection.socket, { type: "error", requestId: null, code: "BANNED", message: "Ваша идентичность заблокирована на этом сервере", banExpiresAt: newBan?.expiresAt ?? null });
        targetConnection.socket.close(4004, "Banned from server");
      }
      await broadcastSnapshots();
      return;
    }
    if (event.type === "member.unban") {
      if (!(await hasPermission(connection.userId, "KICK_MEMBERS"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нет прав для разблокировки участников");
      if (!(await repository.unbanMember(event.userId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Заблокированный участник не найден");
      await broadcastSnapshots();
      return;
    }
    if (event.type === "server.settings.update") {
      if (!(await hasPermission(connection.userId, "MANAGE_SERVER"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Недостаточно прав для изменения настроек сервера");
      await repository.updateServerSettings({ name: event.name, description: event.description, maxAttachmentBytes: event.maxAttachmentBytes, screenShareMaxResolution: event.screenShareMaxResolution, screenShareMaxFrameRate: event.screenShareMaxFrameRate });
      await broadcastSnapshots();
      return;
    }
    if (event.type === "voice.join") {
      // Проверяется раньше прав и обращений к базе: смысл ограничителя в том, чтобы
      // до дорогой части не доходило вообще ничего.
      const flood = voiceJoinLimiter.consume(`voice.join:${connection.userId}`);
      if (!flood.allowed) return sendError(connection.socket, event.requestId, "RATE_LIMITED", `Слишком частые подключения к голосовым каналам, подождите ${formatDelay(flood.retryAfterMs)}`, flood.retryAfterMs);
      if (!(await hasPermission(connection.userId, "VOICE_CONNECT")) || !(await hasPermission(connection.userId, "VOICE_SPEAK"))) return sendError(connection.socket, event.requestId, "FORBIDDEN", "Нет прав для подключения к голосовому каналу");
      const channel = await repository.getChannel(event.channelId);
      if (!channel || channel.kind !== "voice") return sendError(connection.socket, event.requestId, "NOT_FOUND", "Голосовой канал не найден");
      const cooldownRemaining = voiceRejoinCooldownRemaining(connection.userId);
      if (cooldownRemaining > 0) return sendError(connection.socket, event.requestId, "FORBIDDEN", `Модератор отключил вас от голосового канала. Вернуться можно через ${formatDelay(cooldownRemaining)}`, cooldownRemaining);
      try {
        const server = await repository.getServer();
        const serverMuted = await repository.isVoiceMuted(connection.userId);
        const authorization = await voice.issueJoin({ serverId: server.id, channelId: channel.id, userId: connection.userId, participantLimit: channel.participantLimit ?? 25, serverMuted });
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
      const previousMuted = voice.presence().find((participant) => participant.userId === connection.userId)?.muted;
      const presence = voice.updateState(connection.userId, { muted: event.muted, deafened: event.deafened, viewingScreenShareUserId: event.viewingScreenShareUserId });
      if (!presence) return sendError(connection.socket, event.requestId, "CONFLICT", "Сначала подключитесь к голосовому каналу");
      broadcast({ type: "voice.participant.updated", participant: presence });
      // Заявление о муте — это только заявление: звук идёт мимо OpenCord, через LiveKit.
      // Показывать чужой микрофон выключенным, пока он передаёт, нельзя, поэтому
      // объявленная заглушка проверяется по настоящему состоянию дорожки.
      if (presence.muted && presence.muted !== previousMuted) scheduleVoiceMuteVerification(connection.userId);
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
      // Пауза ставится только по факту отключения: иначе модератор мог бы закрыть
      // голос участнику, который в канал и не заходил.
      if (presence) {
        startVoiceRejoinCooldown(event.userId);
        broadcast({ type: "voice.participant.disconnected", userId: presence.userId, channelId: presence.channelId, reason: "moderated" });
      }
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
        // Мут переживает выход из канала: без записи он держался бы только в presence,
        // и повторный вход выдал бы токен с правом публиковать микрофон.
        await repository.setVoiceMuted(event.userId, event.muted);
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
    await runRetentionCleanup();
    const activeBan = await repository.findActiveBan(userId);
    if (activeBan) {
      // Клиент показывает постоянный экран блокировки, поэтому вместе с кодом уходит и срок:
      // null означает перманентный бан.
      send(connection.socket, { type: "error", requestId: event.requestId, code: "BANNED", message: "Ваша идентичность заблокирована на этом сервере", banExpiresAt: activeBan.expiresAt });
      connection.socket.close(4004, "Banned from server");
      return;
    }
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

  /**
   * Сколько ещё нельзя писать в канал из-за медленного режима; 0 — можно прямо сейчас.
   * Модераторы с MANAGE_MESSAGES режим не ощущают, как и в Discord.
   */
  async function slowmodeDelay(userId: string, channelId: string): Promise<number> {
    const channel = await repository.getChannel(channelId);
    if (!channel || channel.kind !== "text" || channel.slowmodeSeconds <= 0) return 0;
    if (await hasPermission(userId, "MANAGE_MESSAGES")) return 0;
    const lastAt = await repository.lastChatMessageAt(channelId, userId);
    if (!lastAt) return 0;
    return Math.max(0, channel.slowmodeSeconds * 1_000 - (Date.now() - lastAt.getTime()));
  }

  async function sendSnapshot(connection: ConnectionState): Promise<void> {
    if (!connection.userId || connection.socket.readyState !== connection.socket.OPEN) return;
    const server = await repository.getServer();
    const role = await repository.getMemberRole(connection.userId);
    const permissions = permissionsForRole(role);
    send(connection.socket, {
      type: "server.snapshot",
      server: { ...server, members: await repository.listMembers(publicUserStatuses()), bannedMembers: permissions.includes("KICK_MEMBERS") ? await repository.listBannedMembers() : [], currentUser: { id: connection.userId, role, permissions }, voice: await voice.capability(), voiceParticipants: voice.presence() },
    });
  }

  async function broadcastSnapshots(): Promise<void> {
    await Promise.all([...connections].map((connection) => sendSnapshot(connection)));
  }

  async function runRetentionCleanup(): Promise<void> {
    const result = await repository.performRetentionCleanup();
    result.anonymizedUserIds.forEach((userId) => broadcast({ type: "profile.anonymized", userId }));
    if (result.expiredBanUserIds.length) await broadcastSnapshots();
  }

  /**
   * Ставит паузу и заодно подчищает истёкшие: отключения модератором редки, поэтому
   * отдельный таймер ради этой карты не нужен, а без уборки ключи копились бы вечно —
   * отключённый может просто не вернуться.
   */
  function startVoiceRejoinCooldown(userId: string): void {
    const now = Date.now();
    for (const [key, expiresAt] of voiceRejoinCooldowns) if (expiresAt <= now) voiceRejoinCooldowns.delete(key);
    voiceRejoinCooldowns.set(userId, now + VOICE_MODERATED_REJOIN_COOLDOWN_MS);
  }

  /**
   * Одна отложенная проверка на участника: частые переключения микрофона не должны
   * плодить таймеры, поэтому предыдущая проверка заменяется новой.
   */
  function scheduleVoiceMuteVerification(userId: string): void {
    const existing = voiceMuteVerifications.get(userId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      voiceMuteVerifications.delete(userId);
      void voice.verifySelfMute(userId)
        .then((corrected) => { if (corrected) broadcast({ type: "voice.participant.updated", participant: corrected }); })
        .catch((error: unknown) => app.log.warn(error, "Voice mute verification failed"));
    }, VOICE_MUTE_VERIFY_DELAY_MS);
    timer.unref();
    voiceMuteVerifications.set(userId, timer);
  }

  /**
   * Ставит отложенное освобождение голоса, если у участника не осталось ни одного
   * подтверждённого соединения. Пауза нужна, чтобы обычное переподключение клиента
   * не выбрасывало его из разговора: разрыв WebSocket сам по себе ещё ничего не значит.
   *
   * Отдельная отмена таймера при возвращении не нужна: решение принимается по состоянию
   * соединений в момент срабатывания, и это надёжнее — участник мог вернуться любым путём.
   */
  function scheduleVoiceOrphanRelease(userId: string): void {
    if (hasAuthenticatedConnection(userId)) return;
    const existing = voiceOrphanTimers.get(userId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      voiceOrphanTimers.delete(userId);
      if (hasAuthenticatedConnection(userId)) return;
      void voice.leave(userId)
        .then((presence) => { if (presence) broadcast({ type: "voice.participant.left", participant: presence }); })
        .catch((error: unknown) => app.log.warn(error, "Releasing an orphaned voice presence failed"));
    }, options.voiceOrphanGraceMs ?? VOICE_ORPHAN_GRACE_MS);
    timer.unref();
    voiceOrphanTimers.set(userId, timer);
  }

  function hasAuthenticatedConnection(userId: string): boolean {
    for (const connection of connections) if (connection.userId === userId) return true;
    return false;
  }

  /** Сколько осталось до конца паузы, 0 — паузы нет. */
  function voiceRejoinCooldownRemaining(userId: string): number {
    const expiresAt = voiceRejoinCooldowns.get(userId);
    if (expiresAt === undefined) return 0;
    const remaining = expiresAt - Date.now();
    if (remaining > 0) return remaining;
    voiceRejoinCooldowns.delete(userId);
    return 0;
  }

  async function reconcileVoicePresence(): Promise<void> {
    try {
      const server = await repository.getServer();
      const before = JSON.stringify({ presence: voice.presence(), capability: await voice.capability() });
      await voice.reconcile(server.channels.filter((channel) => channel.kind === "voice").map((channel) => channel.id), voiceLookups);
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

  function broadcast(event: ServerEvent, excludeUserId?: string): void {
    for (const connection of connections) if (connection.userId && connection.userId !== excludeUserId && connection.socket.readyState === connection.socket.OPEN) send(connection.socket, event);
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
    const withoutPath = Buffer.from(header, "base64url").toString("utf8").replaceAll("\\", "/").split("/").at(-1) ?? "";
    // Управляющие символы двунаправленного текста вырезаются до trim: иначе имя
    // `счёт-<U+202E>fdp.exe` показывается как `счёт-exe.pdf` и .exe выглядит документом.
    const decoded = stripBidiControls(withoutPath).trim();
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

function sendError(socket: WebSocket, requestId: string | null, code: Extract<ServerEvent, { type: "error" }>["code"], message: string, retryAfterMs?: number): void {
  send(socket, { type: "error", requestId, code, message, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });
}

/** «через 4 с» / «через 2 мин» — сообщение об ожидании читается людьми, а не машиной. */
function formatDelay(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) return `${seconds} с`;
  return `${Math.ceil(seconds / 60)} мин`;
}
