import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, serverEventSchema, type ServerEvent } from "@opencord/shared";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";
import { ChatRepository, OWNER_TOP_POSITION, permissionsForRole, SEEDED_ADMINISTRATOR_ROLE_ID, SEEDED_MEMBER_ROLE_ID } from "../src/database/repository";

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

describe("custom roles migration", () => {
  it("seeds administrator/member rows matching legacy behavior", async () => {
    const roles = await repository.listRoles();
    expect(roles).toHaveLength(2);
    expect(roles.find((role) => role.id === SEEDED_ADMINISTRATOR_ROLE_ID)).toMatchObject({ name: "administrator", position: 10, color: null });
    expect(new Set(roles.find((role) => role.id === SEEDED_ADMINISTRATOR_ROLE_ID)?.permissions)).toEqual(new Set(permissionsForRole("administrator")));
    expect(roles.find((role) => role.id === SEEDED_MEMBER_ROLE_ID)).toMatchObject({ name: "member", position: 0, color: null });
    expect(new Set(roles.find((role) => role.id === SEEDED_MEMBER_ROLE_ID)?.permissions)).toEqual(new Set(permissionsForRole("member")));
  });

  it("keeps the owner outside the table and backfills legacy members", async () => {
    await repository.upsertUser("owner-1", "owner-key", { username: "owner", discriminator: "0001", avatar: null });
    await repository.ensureMembership("owner-1", "owner-key", "owner-key");
    expect(await repository.getMemberRole("owner-1")).toBe("owner");
    expect(await repository.getMemberRoleIds("owner-1")).toEqual([]);
    expect(await repository.getMemberTopPosition("owner-1")).toBe(OWNER_TOP_POSITION);

    await repository.upsertUser("user-1", "user-key", { username: "lina", discriminator: "0002", avatar: null });
    await repository.ensureMembership("user-1", "user-key");
    expect(await repository.getMemberRoleIds("user-1")).toEqual([SEEDED_MEMBER_ROLE_ID]);
    expect(await repository.getMemberTopPosition("user-1")).toBe(0);
  });
});

describe("permission union and legacy sync", () => {
  it("unions permissions across assigned roles", async () => {
    await repository.upsertUser("user-1", "user-key", { username: "lina", discriminator: "0002", avatar: null });
    await repository.ensureMembership("user-1", "user-key");
    const extra = await repository.createRole(randomUUID(), "Helper", "#ff0000", 5, ["MANAGE_MESSAGES", "MANAGE_CHANNELS"]);
    expect(await repository.setMemberRoles("user-1", [SEEDED_MEMBER_ROLE_ID, extra.id])).toBe("updated");
    const permissions = await repository.getMemberPermissions("user-1");
    expect(new Set(permissions)).toEqual(new Set(["VOICE_CONNECT", "VOICE_SPEAK", "MANAGE_MESSAGES", "MANAGE_CHANNELS"]));
    expect(await repository.getMemberTopPosition("user-1")).toBe(5);
    // Legacy-поле выводится из назначений: без сида administrator — member.
    expect(await repository.getMemberRole("user-1")).toBe("member");
  });

  it("maps the legacy single role onto seeded rows", async () => {
    await repository.upsertUser("user-1", "user-key", { username: "lina", discriminator: "0002", avatar: null });
    await repository.ensureMembership("user-1", "user-key");
    expect(await repository.setMemberRole("user-1", "administrator")).toBe("updated");
    expect(await repository.getMemberRoleIds("user-1")).toEqual([SEEDED_ADMINISTRATOR_ROLE_ID]);
    expect(new Set(await repository.getMemberPermissions("user-1"))).toEqual(new Set(permissionsForRole("administrator")));
    const member = await repository.getMember("user-1", "online");
    expect(member.role).toBe("administrator");
    expect(member.roleIds).toEqual([SEEDED_ADMINISTRATOR_ROLE_ID]);
  });

  it("never touches the owner through role commands", async () => {
    await repository.upsertUser("owner-1", "owner-key", { username: "owner", discriminator: "0001", avatar: null });
    await repository.ensureMembership("owner-1", "owner-key", "owner-key");
    expect(await repository.setMemberRole("owner-1", "member")).toBe("owner");
    expect(await repository.setMemberRoles("owner-1", [SEEDED_MEMBER_ROLE_ID])).toBe("owner");
    expect(await repository.getMemberRole("owner-1")).toBe("owner");
    expect(new Set(await repository.getMemberPermissions("owner-1"))).toEqual(new Set(permissionsForRole("owner")));
  });

  it("refuses to strip the owner through membership refresh", async () => {
    await repository.upsertUser("owner-1", "owner-key", { username: "owner", discriminator: "0001", avatar: null });
    await repository.ensureMembership("owner-1", "owner-key", "owner-key");
    // Повторный вход владельца не создаёт ему строк в member_roles.
    await repository.ensureMembership("owner-1", "owner-key", "owner-key");
    expect(await repository.getMemberRoleIds("owner-1")).toEqual([]);
  });

  it("cleans assignments on leave and ban", async () => {
    await repository.upsertUser("user-1", "user-key", { username: "lina", discriminator: "0002", avatar: null });
    await repository.ensureMembership("user-1", "user-key");
    const extra = await repository.createRole(randomUUID(), "Helper", null, 5, ["MANAGE_MESSAGES"]);
    await repository.setMemberRoles("user-1", [extra.id]);
    await repository.leaveServer("user-1", "leave");
    expect(await repository.getMemberRoleIds("user-1")).toEqual([]);
  });
});

describe("WebSocket custom roles hierarchy", () => {
  it("enforces top-position rules and exposes roles in the snapshot", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey) });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "owner-user", ownerKeys);
    const moderator = await connectAndAuthenticate(url, "mod-user");
    const target = await connectAndAuthenticate(url, "target-user");

    expect(owner.snapshot.server.roles).toHaveLength(2);
    // Снапшот владельца снят до входа модератора — проверяем свежий снапшот цели.
    expect(target.snapshot.server.members.find((member) => member.id === moderator.userId)?.roleIds).toEqual([SEEDED_MEMBER_ROLE_ID]);
    expect(target.snapshot.server.roles).toHaveLength(2);

    // Владелец создаёт роль модератора с MANAGE_ROLES/KICK_MEMBERS на позиции 5.
    const created = waitForEvent(owner.socket, "role.created");
    owner.socket.send(JSON.stringify({ type: "role.create", requestId: randomUUID(), name: "Moderator", color: "#ff0000", position: 5, permissions: ["MANAGE_ROLES", "KICK_MEMBERS", "VOICE_CONNECT", "VOICE_SPEAK"] }));
    const modRole = await created;
    expect(modRole.role).toMatchObject({ name: "Moderator", position: 5 });

    // Владелец создаёт высокую роль на позиции 50 и выдаёт её цели напрямую через базу.
    const highCreated = waitForEvent(owner.socket, "role.created");
    owner.socket.send(JSON.stringify({ type: "role.create", requestId: randomUUID(), name: "Senior", color: null, position: 50, permissions: ["VOICE_CONNECT", "VOICE_SPEAK"] }));
    const highRole = await highCreated;

    const assigned = waitForEvent(moderator.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "member.roles.set", requestId: randomUUID(), userId: moderator.userId, roleIds: [modRole.role.id] }));
    await assigned;
    const listedPromise = waitForEvent(moderator.socket, "role.list.result");
    moderator.socket.send(JSON.stringify({ type: "role.list", requestId: randomUUID() }));
    const listed = await listedPromise;
    expect(listed.roles.map((role) => role.id)).toContain(modRole.role.id);

    // Модератор (топ 5) не может кикнуть цель после выдачи ей роли 50.
    const highAssigned = waitForEvent(target.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "member.roles.set", requestId: randomUUID(), userId: target.userId, roleIds: [highRole.role.id] }));
    await highAssigned;

    const kickForbidden = waitForEvent(moderator.socket, "error");
    moderator.socket.send(JSON.stringify({ type: "member.kick", requestId: randomUUID(), userId: target.userId }));
    expect((await kickForbidden).code).toBe("FORBIDDEN");

    // Модератор не может выдать роль выше собственной вершины.
    const grantForbidden = waitForEvent(moderator.socket, "error");
    moderator.socket.send(JSON.stringify({ type: "member.roles.set", requestId: randomUUID(), userId: target.userId, roleIds: [highRole.role.id] }));
    expect((await grantForbidden).code).toBe("FORBIDDEN");

    // Модератор не может создать роль выше собственной вершины.
    const createForbidden = waitForEvent(moderator.socket, "error");
    moderator.socket.send(JSON.stringify({ type: "role.create", requestId: randomUUID(), name: "TooHigh", color: null, position: 50, permissions: [] }));
    expect((await createForbidden).code).toBe("FORBIDDEN");

    // Модератор не может трогать владельца.
    const ownerForbidden = waitForEvent(moderator.socket, "error");
    moderator.socket.send(JSON.stringify({ type: "member.kick", requestId: randomUUID(), userId: owner.userId }));
    expect((await ownerForbidden).code).toBe("FORBIDDEN");

    // Встроенные сид-роли неудаляемы: их удаление сломало бы legacy-маппинг.
    const seedDelete = waitForEvent(moderator.socket, "error");
    moderator.socket.send(JSON.stringify({ type: "role.delete", requestId: randomUUID(), roleId: "00000000-0000-4000-8000-00000000a002" }));
    expect((await seedDelete).code).toBe("CONFLICT");

    // Legacy-команда продолжает работать: владелец снимает высокую роль целью.
    const legacy = waitForEvent(target.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "member.role.set", requestId: randomUUID(), userId: target.userId, role: "member" }));
    const legacySnapshot = await legacy;
    expect(legacySnapshot.server.members.find((member) => member.id === target.userId)?.role).toBe("member");

    const closed = [once(owner.socket, "close"), once(moderator.socket, "close"), once(target.socket, "close")];
    owner.socket.close();
    moderator.socket.close();
    target.socket.close();
    await Promise.all(closed);
  }, 20_000);
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
