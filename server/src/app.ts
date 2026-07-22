import { randomBytes, randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { PROTOCOL_VERSION, clientEventSchema, type ClientEvent, type ServerEvent } from "@opencord/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { Database } from "./database/database";
import { runMigrations } from "./database/migrations";
import { ChatRepository } from "./database/repository";
import { userIdFromPublicKey, verifyChallenge } from "./identity";

interface ConnectionState {
  socket: WebSocket;
  challenge: string;
  challengeRequestId: string;
  challengeExpiresAt: number;
  userId: string | null;
}

export interface BuildAppOptions {
  database: Database;
  logger?: boolean | object;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  await runMigrations(options.database);
  const repository = new ChatRepository(options.database);
  const connections = new Set<ConnectionState>();
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2_100_000 });

  await app.register(cors, { origin: false });
  await app.register(websocket, { options: { maxPayload: 2_100_000 } });

  app.get("/health", async () => ({ status: "ok", database: options.database.kind, protocolVersion: PROTOCOL_VERSION }));

  app.get("/ws", { websocket: true }, (socket) => {
    const challenge = randomBytes(32).toString("base64");
    const requestId = randomUUID();
    const expiresAt = Date.now() + 60_000;
    const state: ConnectionState = { socket, challenge, challengeRequestId: requestId, challengeExpiresAt: expiresAt, userId: null };
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
      if (state.userId) void broadcastMember(state.userId, false);
    });
  });

  app.addHook("onClose", async () => {
    for (const connection of connections) connection.socket.close(1001, "Server shutdown");
    connections.clear();
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
    if (event.type === "ping") return send(connection.socket, { type: "pong", requestId: event.requestId, serverTime: new Date().toISOString() });
    if (event.type === "history.request") {
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      const messages = await repository.getHistory(event.channelId, event.limit);
      return send(connection.socket, { type: "history.result", requestId: event.requestId, channelId: event.channelId, messages });
    }
    if (event.type === "chat.send") {
      if (!(await repository.channelExists(event.channelId))) return sendError(connection.socket, event.requestId, "NOT_FOUND", "Канал не найден");
      const message = await repository.createMessage(randomUUID(), event.channelId, connection.userId, event.content);
      broadcast({ type: "message.created", message });
    }
  }

  async function authenticate(connection: ConnectionState, event: Extract<ClientEvent, { type: "auth.respond" }>): Promise<void> {
    if (event.protocolVersion !== PROTOCOL_VERSION) return sendError(connection.socket, event.requestId, "PROTOCOL_MISMATCH", "Версия протокола не поддерживается");
    if (event.requestId !== connection.challengeRequestId || Date.now() > connection.challengeExpiresAt || !verifyChallenge(event.publicKey, connection.challenge, event.signature)) {
      return sendError(connection.socket, event.requestId, "AUTH_FAILED", "Не удалось подтвердить владение ключом");
    }
    const userId = userIdFromPublicKey(event.publicKey);
    await repository.upsertUser(userId, event.publicKey, event.profile);
    connection.userId = userId;
    const server = await repository.getServer();
    send(connection.socket, { type: "auth.ok", requestId: event.requestId, userId, serverId: server.id });
    send(connection.socket, { type: "server.snapshot", server: { ...server, members: await repository.listMembers(onlineUserIds()) } });
    await broadcastMember(userId, true);
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

  return app;
}

function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
}

function sendError(socket: WebSocket, requestId: string | null, code: Extract<ServerEvent, { type: "error" }>["code"], message: string): void {
  send(socket, { type: "error", requestId, code, message });
}
