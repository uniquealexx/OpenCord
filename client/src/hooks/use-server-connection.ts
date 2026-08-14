"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION, clientEventSchema, publicProfileSchema, serverAvatarSchema, serverEventSchema, userAvatarSchema, userBannerSchema, type Channel, type ChatMessage, type ClientEvent, type Member, type MemberRole, type MessageSearchFilters, type MessageSearchResult, type PublicProfile, type ServerEvent, type ServerSettings, type VoicePresence } from "@opencord/shared";
import type { LocalProfile, MockServer } from "@/shared/state";
import { currentDictionary } from "@/lib/i18n";

export type ConnectionStatus = "demo" | "connecting" | "authenticating" | "connected" | "reconnecting" | "server-outdated" | "client-outdated" | "error";

type ServerSnapshot = Extract<ServerEvent, { type: "server.snapshot" }>["server"];

interface ConnectionCallbacks {
  onSnapshot(server: ServerSnapshot): void;
  onServerAvatarUpdated(serverId: string, avatar: string | null): void;
  onHistory(channelId: string, messages: ChatMessage[]): void;
  onMessage(message: ChatMessage): void;
  onMessageUpdated(message: ChatMessage): void;
  onMessageDeleted(messageId: string, channelId: string): void;
  onSearchResult?(requestId: string, result: MessageSearchResult): void;
  onMember(member: Member): void;
  onMemberRemoved(userId: string): void;
  onServerDeleted(serverId: string): void;
  onVoiceAuthorization?(authorization: Extract<ServerEvent, { type: "voice.join.authorized" }>): void;
  onVoicePresence?(participant: VoicePresence, connected: boolean): void;
  onVoiceDisconnected?(userId: string, channelId: string, reason: "moderated" | "replaced" | "channel_deleted"): void;
  onError(message: string): void;
}

const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

export function useServerConnection(server: MockServer | undefined, profile: LocalProfile | null | undefined, callbacks: ConnectionCallbacks, reconnectToken = 0): { status: ConnectionStatus; sessionToken: string | null; sendMessage(channelId: string, content: string, attachmentIds?: string[]): boolean; updateMessage(messageId: string, content: string, attachmentIds?: string[]): boolean; deleteMessage(messageId: string): boolean; searchMessages(filters: MessageSearchFilters): string | null; updateProfile(profile: PublicProfile): boolean; leaveServer(): boolean; createChannel(name: string, kind: Channel["kind"], description: string): boolean; updateChannel(channelId: string, name: string, description: string, participantLimit: number | null): boolean; deleteChannel(channelId: string): boolean; updateServerAvatar(avatar: string | null): boolean; updateServerSettings(settings: ServerSettings): boolean; setMemberRole(userId: string, role: Exclude<MemberRole, "owner">): boolean; kickMember(userId: string): boolean; deleteServer(): boolean; joinVoice(channelId: string): boolean; leaveVoice(): boolean; updateVoiceState(muted: boolean, deafened: boolean, viewingScreenShareUserId: string | null): boolean; disconnectVoiceMember(userId: string): boolean; setVoiceMemberMuted(userId: string, muted: boolean): boolean } {
  const connectionKey = server?.address && profile ? `${server.id}|${server.address}|${profile.id}|${reconnectToken}` : null;
  const endpoint = server?.address ? safeWebsocketEndpoint(server.address) : null;
  const [connectionState, setConnectionState] = useState<{ key: string | null; status: ConnectionStatus }>({ key: null, status: "connecting" });
  const [sessionState, setSessionState] = useState<{ key: string; token: string } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const profileRef = useRef(profile);
  const callbacksRef = useRef(callbacks);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);
  const status: ConnectionStatus = !connectionKey ? "demo" : !endpoint ? "error" : connectionState.key === connectionKey ? connectionState.status : "connecting";
  const sessionToken = connectionKey && sessionState?.key === connectionKey ? sessionState.token : null;

  useEffect(() => {
    if (!connectionKey || !endpoint) return;

    let stopped = false;
    let fatal = false;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let failureReported = false;
    let waitingForServerUpdate = false;

    const clearHeartbeat = (): void => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };

    const scheduleReconnect = (): void => {
      if (stopped || fatal || reconnectTimer) return;
      clearHeartbeat();
      if (!waitingForServerUpdate) setConnectionState({ key: connectionKey, status: "reconnecting" });
      const delay = waitingForServerUpdate ? 2_000 : reconnectDelay(retryCount);
      retryCount += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        waitingForServerUpdate = false;
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
        if (!failureReported) callbacksRef.current.onError(currentDictionary().connectionErrors.openFailed);
        failureReported = true;
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.addEventListener("message", (messageEvent) => {
        // События уже закрытого или заменённого сокета не должны попадать в состояние.
        if (socketRef.current !== socket) return;
        let decoded: unknown;
        try { decoded = JSON.parse(String(messageEvent.data)) as unknown; } catch { return callbacksRef.current.onError(currentDictionary().connectionErrors.badJson); }
        const incompatible = protocolCompatibility(decoded);
        if (incompatible) {
          fatal = incompatible === "client-outdated";
          waitingForServerUpdate = incompatible === "server-outdated";
          clearHeartbeat();
          setConnectionState({ key: connectionKey, status: incompatible });
          if (!failureReported) callbacksRef.current.onError(incompatible === "server-outdated"
            ? currentDictionary().connectionErrors.serverOutdatedReconnect
            : currentDictionary().connectionErrors.clientOutdated);
          failureReported = true;
          socket.close(4002, "Protocol mismatch");
          return;
        }
        const parsed = serverEventSchema.safeParse(decoded);
        if (!parsed.success) return callbacksRef.current.onError(currentDictionary().connectionErrors.badProtocolResponse);
        const event = parsed.data;

        if (event.type === "auth.challenge") {
          setConnectionState({ key: connectionKey, status: "authenticating" });
          const currentProfile = profileRef.current;
          if (!currentProfile) return socket.close(1000, "Profile unavailable");
          void authenticate(socket, event.requestId, event.challenge, currentProfile).catch(() => {
            fatal = true;
            setConnectionState({ key: connectionKey, status: "error" });
            callbacksRef.current.onError(currentDictionary().connectionErrors.signFailed);
            socket.close(1000, "Identity error");
          });
        } else if (event.type === "auth.ok") {
          retryCount = 0;
          failureReported = false;
          setConnectionState({ key: connectionKey, status: "connected" });
          setSessionState({ key: connectionKey, token: event.sessionToken });
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
        } else if (event.type === "server.avatar.updated") {
          callbacksRef.current.onServerAvatarUpdated(event.serverId, event.avatar);
        } else if (event.type === "history.result") {
          callbacksRef.current.onHistory(event.channelId, event.messages);
        } else if (event.type === "message.search.result") {
          callbacksRef.current.onSearchResult?.(event.requestId, event.result);
        } else if (event.type === "message.created") {
          callbacksRef.current.onMessage(event.message);
        } else if (event.type === "message.updated") {
          callbacksRef.current.onMessageUpdated(event.message);
        } else if (event.type === "message.deleted") {
          callbacksRef.current.onMessageDeleted(event.messageId, event.channelId);
        } else if (event.type === "member.updated") {
          callbacksRef.current.onMember(event.member);
        } else if (event.type === "member.removed") {
          callbacksRef.current.onMemberRemoved(event.userId);
        } else if (event.type === "voice.join.authorized") {
          callbacksRef.current.onVoiceAuthorization?.(event);
        } else if (event.type === "voice.participant.joined") {
          callbacksRef.current.onVoicePresence?.(event.participant, true);
        } else if (event.type === "voice.participant.updated") {
          callbacksRef.current.onVoicePresence?.(event.participant, true);
        } else if (event.type === "voice.participant.left") {
          callbacksRef.current.onVoicePresence?.(event.participant, false);
        } else if (event.type === "voice.participant.disconnected") {
          callbacksRef.current.onVoiceDisconnected?.(event.userId, event.channelId, event.reason);
        } else if (event.type === "server.deleted") {
          fatal = true;
          clearHeartbeat();
          callbacksRef.current.onServerDeleted(event.serverId);
          socket.close(1000, "Server deleted");
        } else if (event.type === "error") {
          if (event.code === "AUTH_FAILED" || event.code === "PROTOCOL_MISMATCH") {
            fatal = event.code === "AUTH_FAILED";
            waitingForServerUpdate = event.code === "PROTOCOL_MISMATCH";
            setConnectionState({ key: connectionKey, status: event.code === "PROTOCOL_MISMATCH" ? "server-outdated" : "error" });
            socket.close(1000, "Authentication rejected");
          }
          callbacksRef.current.onError(event.code === "PROTOCOL_MISMATCH" ? currentDictionary().connectionErrors.protocolMismatch : event.message);
        }
      });

      socket.addEventListener("error", () => {
        if (!failureReported) callbacksRef.current.onError(currentDictionary().connectionErrors.reconnectFailed);
        failureReported = true;
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        setSessionState((current) => current?.key === connectionKey ? null : current);
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
  }, [connectionKey, endpoint]);

  const sendMessage = useCallback((channelId: string, content: string, attachmentIds: string[] = []): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "chat.send", requestId: crypto.randomUUID(), channelId, content, attachmentIds });
    return true;
  }, [status]);

  const updateMessage = useCallback((messageId: string, content: string, attachmentIds: string[] = []): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "message.update", requestId: crypto.randomUUID(), messageId, content, attachmentIds });
    return true;
  }, [status]);

  const deleteMessage = useCallback((messageId: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "message.delete", requestId: crypto.randomUUID(), messageId });
    return true;
  }, [status]);

  const searchMessages = useCallback((filters: MessageSearchFilters): string | null => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return null;
    const requestId = crypto.randomUUID();
    sendEvent(socket, { type: "message.search", requestId, filters });
    return requestId;
  }, [status]);

  const updateProfile = useCallback((nextProfile: PublicProfile): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "profile.update", requestId: crypto.randomUUID(), profile: publicProfileSchema.parse(nextProfile) });
    return true;
  }, [status]);

  const leaveServer = useCallback((): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "server.leave", requestId: crypto.randomUUID() });
    return true;
  }, [status]);

  const createChannel = useCallback((name: string, kind: Channel["kind"], description: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "channel.create", requestId: crypto.randomUUID(), name, kind, description });
    return true;
  }, [status]);

  const updateChannel = useCallback((channelId: string, name: string, description: string, participantLimit: number | null): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "channel.update", requestId: crypto.randomUUID(), channelId, name, description, participantLimit });
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

  const updateServerAvatar = useCallback((avatar: string | null): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "server.avatar.update", requestId: crypto.randomUUID(), avatar: serverAvatarSchema.parse(avatar) });
    return true;
  }, [status]);

  const kickMember = useCallback((userId: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "member.kick", requestId: crypto.randomUUID(), userId });
    return true;
  }, [status]);

  const updateServerSettings = useCallback((settings: ServerSettings): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "server.settings.update", requestId: crypto.randomUUID(), ...settings });
    return true;
  }, [status]);

  const deleteServer = useCallback((): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "server.delete", requestId: crypto.randomUUID() });
    return true;
  }, [status]);

  const joinVoice = useCallback((channelId: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "voice.join", requestId: crypto.randomUUID(), channelId });
    return true;
  }, [status]);

  const leaveVoice = useCallback((): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "voice.leave", requestId: crypto.randomUUID() });
    return true;
  }, [status]);

  const updateVoiceState = useCallback((muted: boolean, deafened: boolean, viewingScreenShareUserId: string | null): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "voice.state.update", requestId: crypto.randomUUID(), muted, deafened, viewingScreenShareUserId });
    return true;
  }, [status]);

  const disconnectVoiceMember = useCallback((userId: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "voice.member.disconnect", requestId: crypto.randomUUID(), userId });
    return true;
  }, [status]);

  const setVoiceMemberMuted = useCallback((userId: string, muted: boolean): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") return false;
    sendEvent(socket, { type: "voice.member.mute", requestId: crypto.randomUUID(), userId, muted });
    return true;
  }, [status]);

  return { status, sessionToken, sendMessage, updateMessage, deleteMessage, searchMessages, updateProfile, leaveServer, createChannel, updateChannel, deleteChannel, updateServerAvatar, updateServerSettings, setMemberRole, kickMember, deleteServer, joinVoice, leaveVoice, updateVoiceState, disconnectVoiceMember, setVoiceMemberMuted };
}

async function authenticate(socket: WebSocket, requestId: string, challenge: string, profile: LocalProfile): Promise<void> {
  const identity = window.openCord?.identity;
  if (!identity) throw new Error("Identity bridge is unavailable");
  const publicIdentity = await identity.getOrCreate();
  const signature = await identity.signChallenge(challenge);
  const parsedAvatar = userAvatarSchema.safeParse(profile.avatar);
  const parsedBanner = userBannerSchema.safeParse(profile.banner);
  sendEvent(socket, {
    type: "auth.respond",
    requestId,
    protocolVersion: PROTOCOL_VERSION,
    publicKey: publicIdentity.publicKey,
    signature,
    profile: { displayName: profile.displayName, bio: profile.bio, avatar: parsedAvatar.success ? parsedAvatar.data : null, banner: parsedBanner.success ? parsedBanner.data : null, status: profile.status ?? "online" },
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

export function protocolCompatibility(value: unknown): "server-outdated" | "client-outdated" | null {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "auth.challenge" || !("protocolVersion" in value) || typeof value.protocolVersion !== "number") return null;
  if (value.protocolVersion < PROTOCOL_VERSION) return "server-outdated";
  if (value.protocolVersion > PROTOCOL_VERSION) return "client-outdated";
  return null;
}

function safeWebsocketEndpoint(address: string): string | null {
  try { return websocketEndpoint(address); } catch { return null; }
}
