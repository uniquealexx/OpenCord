import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, serverEventSchema, type ServerEvent } from "@opencord/shared";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";
import { ChatRepository, SEEDED_MEMBER_ROLE_ID } from "../src/database/repository";

const testBuildInfo = { version: "0.1.0", releaseChannel: "development", commit: null } as const;
const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];

let database: PGliteDatabase;
let repository: ChatRepository;

beforeEach(async () => {
  database = new PGliteDatabase("memory://");
  await runMigrations(database);
  repository = new ChatRepository(database);
});

afterEach(async () => {
  await database.close();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("audit_log migration", () => {
  it("creates the table and round-trips rows with pagination", async () => {
    await repository.upsertUser("actor-1", "actor-key", { username: "owner", discriminator: "0001", avatar: null });
    await repository.ensureMembership("actor-1", "actor-key");
    const first = await repository.appendAuditLog({ id: randomUUID(), actorId: "actor-1", action: "member.kick", targetId: "victim-1", detail: null });
    expect(first).toMatchObject({ actorId: "actor-1", action: "member.kick", targetId: "victim-1" });
    await repository.appendAuditLog({ id: randomUUID(), actorId: "actor-1", action: "member.ban", targetId: "victim-2", detail: "10" });
    const page = await repository.listAuditLog(50, null);
    expect(page.entries).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.entries[0]?.action).toBe("member.ban");
    const older = await repository.listAuditLog(50, page.entries[0]?.at ?? null);
    expect(older.entries).toHaveLength(1);
    expect(older.entries[0]?.action).toBe("member.kick");
  });

  it("caps the table at 1000 rows on insert", async () => {
    await repository.upsertUser("actor-1", "actor-key", { username: "owner", discriminator: "0001", avatar: null });
    await repository.ensureMembership("actor-1", "actor-key");
    // Bulk-seed past the cap with plain SQL (no per-row prune), then a single
    // repository insert must prune back down to exactly 1000 rows.
    for (let chunk = 0; chunk < 11; chunk += 1) {
      const rows: string[] = [];
      for (let index = 0; index < 100 && chunk * 100 + index < 1005; index += 1) {
        rows.push(`('${randomUUID()}', 'actor-1', 'message.delete', 'target-${chunk * 100 + index}', NULL)`);
      }
      await database.query(`INSERT INTO audit_log (id, actor_id, action, target_id, detail) VALUES ${rows.join(",")}`);
    }
    await repository.appendAuditLog({ id: randomUUID(), actorId: "actor-1", action: "message.delete", targetId: "target-final", detail: null });
    const count = await database.query<{ count: string }>("SELECT count(*) AS count FROM audit_log");
    expect(Number(count[0]?.count ?? 0)).toBe(1000);
    const page = await repository.listAuditLog(100, null);
    expect(page.entries).toHaveLength(100);
    expect(page.hasMore).toBe(true);
  });
});

describe("WebSocket audit log", () => {
  it("writes rows on kick/ban/role-set/overwrite/bulkDelete and gates listing by MANAGE_SERVER", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey) });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "owner-user", ownerKeys);
    const member = await connectAndAuthenticate(url, "member-user");
    const victim = await connectAndAuthenticate(url, "victim-user");
    const banned = await connectAndAuthenticate(url, "banned-user");
    const channel = owner.snapshot.server.channels.find((item) => item.kind === "text");
    if (!channel) throw new Error("Seed text channel expected");

    const forbidden = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "audit.list", requestId: randomUUID(), limit: 50, before: null }));
    expect((await forbidden).code).toBe("FORBIDDEN");

    const kicked = waitForEvent(owner.socket, "member.removed");
    owner.socket.send(JSON.stringify({ type: "member.kick", requestId: randomUUID(), userId: victim.userId }));
    expect((await kicked).userId).toBe(victim.userId);

    const bannedRemoved = waitForEvent(owner.socket, "member.removed");
    owner.socket.send(JSON.stringify({ type: "member.ban", requestId: randomUUID(), userId: banned.userId, durationMinutes: 10 }));
    expect((await bannedRemoved).userId).toBe(banned.userId);

    const rolesSnapshot = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "member.roles.set", requestId: randomUUID(), userId: member.userId, roleIds: [SEEDED_MEMBER_ROLE_ID] }));
    await rolesSnapshot;

    const overwriteUpdated = waitForEvent(owner.socket, "channel.overwrites.updated");
    owner.socket.send(JSON.stringify({ type: "channel.overwrites.set", requestId: randomUUID(), channelId: channel.id, roleId: SEEDED_MEMBER_ROLE_ID, allow: [], deny: ["VOICE_SPEAK"] }));
    await overwriteUpdated;

    const firstId = await sendChat(owner.socket, member.socket, channel.id, "Первая");
    const secondId = await sendChat(owner.socket, member.socket, channel.id, "Вторая");
    const firstDeleted = waitForEventMatching(owner.socket, "message.deleted", (event) => event.messageId === firstId);
    owner.socket.send(JSON.stringify({ type: "message.bulkDelete", requestId: randomUUID(), channelId: channel.id, messageIds: [firstId, secondId] }));
    await firstDeleted;

    const expected = new Set(["member.kick", "member.ban", "member.roles.set", "channel.overwrites.set", "message.bulkDelete"]);
    let seen = new Set<string>();
    for (let attempt = 0; attempt < 30 && ![...expected].every((action) => seen.has(action)); attempt += 1) {
      const result = await listAudit(owner.socket);
      seen = new Set(result.entries.map((entry) => entry.action));
      if (![...expected].every((action) => seen.has(action))) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect([...expected].every((action) => seen.has(action))).toBe(true);

    const closed = [once(owner.socket, "close"), once(member.socket, "close")];
    owner.socket.close();
    member.socket.close();
    await Promise.all(closed);
  }, 30_000);
});

describe("audit detail content", () => {
  it("writes human-readable detail text for ban, bulkDelete, role rename, and overwrites", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey) });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "owner-user", ownerKeys);
    const member = await connectAndAuthenticate(url, "member-user");
    const banned = await connectAndAuthenticate(url, "banned-user");
    const channel = owner.snapshot.server.channels.find((item) => item.kind === "text");
    if (!channel) throw new Error("Seed text channel expected");

    const createdRole = waitForEvent(owner.socket, "role.created");
    owner.socket.send(JSON.stringify({ type: "role.create", requestId: randomUUID(), name: "DetailRole", color: "#ff0000", position: 5, permissions: ["VOICE_CONNECT"] }));
    const roleEvent = await createdRole;
    if (roleEvent.type !== "role.created") throw new Error("Role expected");
    const roleId = roleEvent.role.id;

    const updatedRole = waitForEvent(owner.socket, "role.updated");
    owner.socket.send(JSON.stringify({ type: "role.update", requestId: randomUUID(), roleId, name: "DetailRoleRenamed", position: 7 }));
    await updatedRole;

    const bannedRemoved = waitForEvent(owner.socket, "member.removed");
    owner.socket.send(JSON.stringify({ type: "member.ban", requestId: randomUUID(), userId: banned.userId, durationMinutes: 60 }));
    await bannedRemoved;

    const firstId = await sendChat(owner.socket, member.socket, channel.id, "Первая");
    const secondId = await sendChat(owner.socket, member.socket, channel.id, "Вторая");
    const firstDeleted = waitForEventMatching(owner.socket, "message.deleted", (event) => event.messageId === firstId);
    owner.socket.send(JSON.stringify({ type: "message.bulkDelete", requestId: randomUUID(), channelId: channel.id, messageIds: [firstId, secondId] }));
    await firstDeleted;

    const overwriteUpdated = waitForEvent(owner.socket, "channel.overwrites.updated");
    owner.socket.send(JSON.stringify({ type: "channel.overwrites.set", requestId: randomUUID(), channelId: channel.id, roleId: SEEDED_MEMBER_ROLE_ID, allow: ["VOICE_SPEAK"], deny: [] }));
    await overwriteUpdated;

    const expected = new Set(["role.create", "role.update", "member.ban", "message.bulkDelete", "channel.overwrites.set"]);
    let entries: Extract<ServerEvent, { type: "audit.result" }>["entries"] = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      entries = (await listAudit(owner.socket)).entries;
      if ([...expected].every((action) => entries.some((entry) => entry.action === action))) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const byAction = (action: string): string | null | undefined => entries.find((entry) => entry.action === action)?.detail;

    expect(byAction("role.create")).toContain('role "DetailRole" at position 5');
    expect(byAction("role.update")).toContain('"DetailRole" → "DetailRoleRenamed"');
    expect(byAction("role.update")).toContain("position 5 → 7");
    expect(byAction("member.ban")).toContain("duration: 60 minutes");
    expect(byAction("message.bulkDelete")).toContain("deleted 2 messages");
    expect(byAction("channel.overwrites.set")).toContain('role "member"');
    expect(byAction("channel.overwrites.set")).toContain("VOICE_SPEAK");

    const closed = [once(owner.socket, "close"), once(member.socket, "close")];
    owner.socket.close();
    member.socket.close();
    await Promise.all(closed);
  }, 30_000);
});

async function listAudit(socket: WebSocket): Promise<Extract<ServerEvent, { type: "audit.result" }>> {
  const result = waitForEvent(socket, "audit.result");
  socket.send(JSON.stringify({ type: "audit.list", requestId: randomUUID(), limit: 100, before: null }));
  return result;
}

async function sendChat(sender: WebSocket, observer: WebSocket, channelId: string, content: string): Promise<string> {
  const created = waitForEvent(observer, "message.created");
  sender.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId, content }));
  const event = await created;
  if (event.type !== "message.created") throw new Error("Message expected");
  return event.message.id;
}

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
  if (snapshotEvent.type !== "server.snapshot" || authenticated.type !== "auth.ok") throw new Error("Auth expected");
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
  return waitForEventMatching(socket, type, () => true);
}

function waitForEventMatching<T extends ServerEvent["type"]>(socket: WebSocket, type: T, matches: (event: Extract<ServerEvent, { type: T }>) => boolean): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, 5_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const parsed = serverEventSchema.safeParse(JSON.parse(data.toString()) as unknown);
      if (parsed.success && parsed.data.type === type && matches(parsed.data as Extract<ServerEvent, { type: T }>)) { cleanup(); resolve(parsed.data as Extract<ServerEvent, { type: T }>); }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => { clearTimeout(timeout); socket.off("message", onMessage); socket.off("error", onError); };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}
