"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION, clientEventSchema, serverEventSchema, type Channel, type ChatMessage, type ClientEvent, type Member, type MemberRole, type ServerEvent } from "@opencord/shared";
import type { LocalProfile, MockServer } from "@/shared/state";

export type ConnectionStatus = "demo" | "connecting" | "authenticating" | "connected" | "reconnecting" | "error";

type ServerSnapshot = Extract<ServerEvent, { type: "server.snapshot" }>["server"];

interface ConnectionCallbacks {
  onSnapshot(server: ServerSnapshot): void;
  onHistory(channelId: string, messages: ChatMessage[]): void;
  onMessage(message: ChatMessage): void;
  onMember(member: Member): void;
  onServerDeleted(serverId: string): void;
  onError(message: string): void;
}

const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

export function useServerConnection(server: MockServer | undefined, profile: LocalProfile | null | undefined, callbacks: ConnectionCallbacks): { status: ConnectionStatus; sendMessage(channelId: string, content: string): boolean; createChannel(name: string, kind: Channel["kind"], description: string): boolean; updateChannel(channelId: string, name: string, description: string): boolean; deleteChannel(channelId: string): boolean; setMemberRole(userId: string, role: Exclude<MemberRole, "owner">): boolean; deleteServer(): boolean } {
  const connectionKey = server?.address && profile ? `${server.id}|${server.address}|${profile.displayName}|${profile.avatar ?? ""}` : null;
  const endpoint = server?.address ? safeWebsocketEndpoint(server.address) : null;
  const [connectionState, setConnectionState] = useState<{ key: string | null; status: ConnectionStatus }>({ key: null, status: "connecting" });
  const socketRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);
  const status: ConnectionStatus = !connectionKey ? "demo" : !endpoint ? "error" : connectionState.key === connectionKey ? connectionState.status : "connecting";

  useEffect(() => {
    if (!connectionKey || !endpoint || !profile) return;

    let stopped = false;
    let fatal = false;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let failureReported = false;

    const clearHeartbeat = (): void => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };

    const scheduleReconnect = (): void => {
      if (stopped || fatal || reconnectTimer) return;
      clearHeartbeat();
      setConnectionState({ key: connectionKey, status: "reconnecting" });
      const delay = reconnectDelay(retryCount);
      retryCount += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = (): void => {
      if (stopped || fatal) return;
      setConnectionState({ key: connectionKey, status: retryCount === 0 ? "connecting" : "reconnecting" });

      let socket: WebSocket;
      try {
        socket = new WebSocket(endpoint);
      } catch {
        if (!failureReported) callbacksRef.current.onError("Не удалось открыть соединение с сервером");
        failureReported = true;
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.addEventListener("message", (messageEvent) => {
        let decoded: unknown;
        try { decoded = JSON.parse(String(messageEvent.data)) as unknown; } catch { return callbacksRef.current.onError("Сервер отправил некорректный JSON"); }
        const parsed = serverEventSchema.safeParse(decoded);
        if (!parsed.success) return callbacksRef.current.onError("Ответ сервера не соответствует протоколу");
        const event = parsed.data;

        if (event.type === "auth.challenge") {
          setConnectionState({ key: connectionKey, status: "authenticating" });
          void authenticate(socket, event.requestId, event.challenge, profile).catch(() => {
            fatal = true;
            setConnectionState({ key: connectionKey, status: "error" });
            callbacksRef.current.onError("Не удалось подписать запрос сервера");
            socket.close(1000, "Identity error");
          });
        } else if (event.type === "auth.ok") {
          retryCount = 0;
          failureReported = false;
          setConnectionState({ key: connectionKey, status: "connected" });
          clearHeartbeat();
          heartbeatTimer = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) sendEvent(socket, { type: "ping", requestId: crypto.randomUUID() });
          }, HEARTBEAT_INTERVAL_MS);
        } else if (event.type === "server.snapshot") {
          callbacksRef.current.onSnapshot(event.server);
          for (const channel of event.server.channels) {
            if (channel.kind === "text" && socket.readyState === WebSocket.OPEN) {
              sendEvent(socket, { type: "history.request", requestId: crypto.randomUUID(), channelId: channel.id, limit: 50 });
            }
          }
        } else if (event.type === "history.result") {
          callbacksRef.current.onHistory(event.channelId, event.messages);
        } else if (event.type === "message.created") {
          callbacksRef.current.onMessage(event.message);
        } else if (event.type === "member.updated") {
          callbacksRef.current.onMember(event.member);
        } else if (event.type === "server.deleted") {
          fatal = true;
          clearHeartbeat();
          callbacksRef.current.onServerDeleted(event.serverId);
          socket.close(1000, "Server deleted");
        } else if (event.type === "error") {
          if (event.code === "AUTH_FAILED" || event.code === "PROTOCOL_MISMATCH") {
            fatal = true;
            setConnectionState({ key: connectionKey, status: "error" });
            socket.close(1000, "Authentication rejected");
          }
          callbacksRef.current.onError(event.message);
        }
      });

      socket.addEventListener("error", () => {
        if (!failureReported) callbacksRef.current.onError("Не удалось подключиться к серверу — повторяем попытку");
        failureReported = true;
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        scheduleReconnect();
      });
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearHeartbeat();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(1000, "Switching server");
    };
  }, [connectionKey, endpoint, profile]);

  const sendMessage = useCallback((channelId: string, content: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "chat.send", requestId: crypto.randomUUID(), channelId, content });
    return true;
  }, [status]);

  const createChannel = useCallback((name: string, kind: Channel["kind"], description: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "channel.create", requestId: crypto.randomUUID(), name, kind, description });
    return true;
  }, [status]);

  const updateChannel = useCallback((channelId: string, name: string, description: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "channel.update", requestId: crypto.randomUUID(), channelId, name, description });
    return true;
  }, [status]);

  const deleteChannel = useCallback((channelId: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "channel.delete", requestId: crypto.randomUUID(), channelId });
    return true;
  }, [status]);

  const setMemberRole = useCallback((userId: string, role: Exclude<MemberRole, "owner">): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "member.role.set", requestId: crypto.randomUUID(), userId, role });
    return true;
  }, [status]);

  const deleteServer = useCallback((): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "server.delete", requestId: crypto.randomUUID() });
    return true;
  }, [status]);

  return { status, sendMessage, createChannel, updateChannel, deleteChannel, setMemberRole, deleteServer };
}

async function authenticate(socket: WebSocket, requestId: string, challenge: string, profile: LocalProfile): Promise<void> {
  const identity = window.openCord?.identity;
  if (!identity) throw new Error("Identity bridge is unavailable");
  const publicIdentity = await identity.getOrCreate();
  const signature = await identity.signChallenge(challenge);
  sendEvent(socket, {
    type: "auth.respond",
    requestId,
    protocolVersion: PROTOCOL_VERSION,
    publicKey: publicIdentity.publicKey,
    signature,
    profile: { displayName: profile.displayName, avatar: profile.avatar },
  });
}

function sendEvent(socket: WebSocket, event: ClientEvent): void {
  socket.send(JSON.stringify(clientEventSchema.parse(event)));
}

export function websocketEndpoint(address: string): string {
  const url = new URL(address);
  if (url.username || url.password) throw new Error("Credentials are not allowed in a server address");
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error("Unsupported protocol");
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function reconnectDelay(retryCount: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, retryCount), MAX_RECONNECT_DELAY_MS);
}

function safeWebsocketEndpoint(address: string): string | null {
  try { return websocketEndpoint(address); } catch { return null; }
}
