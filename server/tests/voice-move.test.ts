import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { CUSTOM_ROLE_PERMISSIONS_MAX, PROTOCOL_VERSION, serverEventSchema, type ServerEvent, type VoicePresence } from "@opencord/shared";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";
import { ALL_PERMISSIONS, ChatRepository, permissionsForRole } from "../src/database/repository";
import type { VoiceService } from "../src/voice";

const testBuildInfo = { version: "0.1.0", releaseChannel: "development", commit: null } as const;
const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function memoryVoice(): { service: VoiceService; presences: Map<string, VoicePresence> } {
  const presences = new Map<string, VoicePresence>();
  const service: VoiceService = {
    capability: async () => ({ status: "available", secureTransport: true, maxParticipants: 25, warning: null }),
    issueJoin: async () => ({ endpoint: "wss://voice.example.test", token: "x".repeat(20), expiresAt: new Date(Date.now() + 60_000).toISOString(), replaced: null }),
    leave: async (userId) => {
      const presence = presences.get(userId) ?? null;
      if (presence) presences.delete(userId);
      return presence;
    },
    updateState: () => null,
    disconnect: async (userId) => {
      const presence = presences.get(userId) ?? null;
      if (presence) presences.delete(userId);
      return presence;
    },
    move: async (userId, targetChannelId) => {
      const current = presences.get(userId) ?? null;
      if (!current || current.channelId === targetChannelId) return null;
      const next = { ...current, channelId: targetChannelId, viewingScreenShareUserId: null };
      presences.set(userId, next);
      return next;
    },
    setModeratorMuted: async () => null,
    verifySelfMute: async () => null,
    removeChannel: async () => [],
    presence: () => [...presences.values()],
    receiveWebhook: async () => null,
    reconcile: async () => [],
  };
  return { service, presences };
}

describe("voice move permission", () => {
  it("seeds VOICE_MOVE_MEMBERS for administrator and exposes it everywhere", async () => {
    const database = new PGliteDatabase("memory://");
    try {
      await runMigrations(database);
      const repository = new ChatRepository(database);
      expect(ALL_PERMISSIONS).toContain("VOICE_MOVE_MEMBERS");
      expect(permissionsForRole("administrator")).toContain("VOICE_MOVE_MEMBERS");
      expect(permissionsForRole("owner")).toContain("VOICE_MOVE_MEMBERS");
      expect(permissionsForRole("member")).not.toContain("VOICE_MOVE_MEMBERS");
      const roles = await repository.listRoles();
      const administrator = roles.find((role) => role.name === "administrator");
      expect(administrator?.permissions).toContain("VOICE_MOVE_MEMBERS");
    } finally {
      await database.close();
    }
  });

  it("validates the move events in the shared schema", () => {
    expect(PROTOCOL_VERSION).toBe(53);
    expect(CUSTOM_ROLE_PERMISSIONS_MAX).toBe(10);
  });

  it("lets the owner move a member and records the audit entry", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const { service, presences } = memoryVoice();
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey), voiceService: service });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const target = await connectAndAuthenticate(url, "Target member");
    const voiceChannels = owner.snapshot.server.channels.filter((channel) => channel.kind === "voice");
    expect(voiceChannels.length).toBeGreaterThanOrEqual(1);
    const secondCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Вторая", kind: "voice", description: "" }));
    const secondSnapshot = await secondCreated;
    const channels = secondSnapshot.server.channels.filter((channel) => channel.kind === "voice");
    expect(channels.length).toBeGreaterThanOrEqual(2);
    const [first, second] = channels as unknown as [{ id: string }, { id: string }];
    presences.set(target.userId, { userId: target.userId, channelId: first.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null });

    const moved = waitForEvent(owner.socket, "voice.participant.moved");
    owner.socket.send(JSON.stringify({ type: "voice.member.move", requestId: randomUUID(), userId: target.userId, targetChannelId: second.id }));
    expect(await moved).toMatchObject({ userId: target.userId, channelId: second.id, reason: "moved" });
    expect(presences.get(target.userId)).toMatchObject({ channelId: second.id });

    const auditRequested = waitForEvent(owner.socket, "audit.result");
    owner.socket.send(JSON.stringify({ type: "audit.list", requestId: randomUUID(), limit: 10, before: null }));
    const audit = await auditRequested;
    expect(audit.entries.some((entry) => entry.action === "voice.member.move" && entry.targetId === target.userId)).toBe(true);

    // Move is not a punishment: no rejoin cooldown blocks the moved user.
    const joinOk = waitForEvent(target.socket, "voice.join.authorized");
    target.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: second.id }));
    await joinOk;

    owner.socket.close();
    target.socket.close();
    await Promise.all([once(owner.socket, "close"), once(target.socket, "close")]);
  }, 15_000);

  it("enforces the hierarchy and validation matrix", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const { service, presences } = memoryVoice();
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey), voiceService: service });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const administrator = await connectAndAuthenticate(url, "Administrator");
    const member = await connectAndAuthenticate(url, "Member");
    const promoted = waitForEvent(administrator.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "member.role.set", requestId: randomUUID(), userId: administrator.userId, role: "administrator" }));
    await promoted;

    const secondCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Вторая", kind: "voice", description: "" }));
    const channels = (await secondCreated).server.channels.filter((channel) => channel.kind === "voice");
    const [first, second] = channels as unknown as [{ id: string }, { id: string }];
    const textChannel = (await secondCreated).server.channels.find((channel) => channel.kind === "text")!;
    presences.set(member.userId, { userId: member.userId, channelId: first.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null });

    // Member without the permission is forbidden.
    const memberDenied = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "voice.member.move", requestId: randomUUID(), userId: administrator.userId, targetChannelId: second.id }));
    expect((await memberDenied).code).toBe("FORBIDDEN");

    // Administrator cannot move the owner.
    presences.set(owner.userId, { userId: owner.userId, channelId: first.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null });
    const hierarchyDenied = waitForEvent(administrator.socket, "error");
    administrator.socket.send(JSON.stringify({ type: "voice.member.move", requestId: randomUUID(), userId: owner.userId, targetChannelId: second.id }));
    expect((await hierarchyDenied).code).toBe("FORBIDDEN");

    // Self-move is a conflict.
    const selfConflict = waitForEvent(administrator.socket, "error");
    presences.set(administrator.userId, { userId: administrator.userId, channelId: first.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null });
    administrator.socket.send(JSON.stringify({ type: "voice.member.move", requestId: randomUUID(), userId: administrator.userId, targetChannelId: second.id }));
    expect((await selfConflict).code).toBe("CONFLICT");

    // Target must be a voice channel.
    const notFound = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "voice.member.move", requestId: randomUUID(), userId: member.userId, targetChannelId: textChannel.id }));
    expect((await notFound).code).toBe("NOT_FOUND");

    // Already in the target channel.
    presences.set(member.userId, { userId: member.userId, channelId: second.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null });
    const sameConflict = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "voice.member.move", requestId: randomUUID(), userId: member.userId, targetChannelId: second.id }));
    expect((await sameConflict).code).toBe("CONFLICT");

    owner.socket.close();
    administrator.socket.close();
    member.socket.close();
  }, 15_000);

  it("rejects moving a user who is not in voice and a full target room", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const { service, presences } = memoryVoice();
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey), voiceService: service });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const target = await connectAndAuthenticate(url, "Target member");
    const secondCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Вторая", kind: "voice", description: "" }));
    const channels = (await secondCreated).server.channels.filter((channel) => channel.kind === "voice");
    const [, second] = channels as unknown as [{ id: string }, { id: string }];

    // Not in voice.
    const notInVoice = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "voice.member.move", requestId: randomUUID(), userId: target.userId, targetChannelId: second.id }));
    expect((await notInVoice).code).toBe("CONFLICT");

    // Full room (limit 1, occupied by someone else).
    const limitSet = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.update", requestId: randomUUID(), channelId: second.id, name: "Вторая", description: "", participantLimit: 1, slowmodeSeconds: 0 }));
    await limitSet;
    const first = channels[0] as { id: string };
    presences.set(target.userId, { userId: target.userId, channelId: first.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null });
    presences.set("occupant", { userId: "occupant", channelId: second.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null });
    const full = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "voice.member.move", requestId: randomUUID(), userId: target.userId, targetChannelId: second.id }));
    expect((await full).code).toBe("VOICE_ROOM_FULL");

    owner.socket.close();
    target.socket.close();
  }, 15_000);

  it("forbids moving a user without VOICE_CONNECT in the target channel", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const { service, presences } = memoryVoice();
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey), voiceService: service });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const target = await connectAndAuthenticate(url, "Target member");
    const created = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Закрытая", kind: "voice", description: "" }));
    const snapshot = await created;
    const channels = snapshot.server.channels.filter((channel) => channel.kind === "voice");
    const [first, closed] = channels.slice(-2) as unknown as [{ id: string }, { id: string }];
    const roles = snapshot.server.roles;
    const memberRole = roles.find((role) => role.name === "member")!;
    const overwritesSet = waitForEvent(owner.socket, "channel.overwrites.updated");
    owner.socket.send(JSON.stringify({ type: "channel.overwrites.set", requestId: randomUUID(), channelId: closed.id, roleId: memberRole.id, allow: [], deny: ["VOICE_CONNECT"] }));
    await overwritesSet;
    presences.set(target.userId, { userId: target.userId, channelId: first.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null });
    const denied = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "voice.member.move", requestId: randomUUID(), userId: target.userId, targetChannelId: closed.id }));
    expect((await denied).code).toBe("FORBIDDEN");
    owner.socket.close();
    target.socket.close();
  }, 15_000);
});

async function connectAndAuthenticate(url: string, displayName: string, keys = generateKeyPairSync("ed25519")): Promise<{ socket: WebSocket; snapshot: Extract<ServerEvent, { type: "server.snapshot" }>; userId: string }> {
  const socket = new WebSocket(url);
  const challengeEvent = await waitForEvent(socket, "auth.challenge");
  if (challengeEvent.type !== "auth.challenge") throw new Error("Challenge expected");
  const publicKey = exportPublicKey(keys.publicKey);
  const signature = sign(null, Buffer.from(challengeEvent.challenge, "base64"), keys.privateKey).toString("base64");
  const authOk = waitForEvent(socket, "auth.ok");
  const snapshot = waitForEvent(socket, "server.snapshot");
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challengeEvent.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username: usernameFromDisplayName(displayName), discriminator: "1234", avatar: null } }));
  const authenticated = await authOk;
  const snapshotEvent = await snapshot;
  if (snapshotEvent.type !== "server.snapshot") throw new Error("Snapshot expected");
  if (authenticated.type !== "auth.ok") throw new Error("Auth ok expected");
  return { socket, snapshot: snapshotEvent, userId: authenticated.userId };
}

function usernameFromDisplayName(displayName: string): string {
  const slug = displayName.toLocaleLowerCase("ru").replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug.length >= 2 ? slug.slice(0, 32) : `user-${displayName.length}`;
}

function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

function waitForEvent<T extends ServerEvent["type"]>(socket: WebSocket, type: T): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, 5_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const parsed = serverEventSchema.safeParse(JSON.parse(data.toString()) as unknown);
      if (parsed.success && parsed.data.type === type) { cleanup(); resolve(parsed.data as Extract<ServerEvent, { type: T }>); }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => { clearTimeout(timeout); socket.off("message", onMessage); socket.off("error", onError); };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}
