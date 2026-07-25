import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";
import { ChatRepository, permissionsForRole } from "../src/database/repository";

let database: PGliteDatabase;
let repository: ChatRepository;

beforeEach(async () => {
  database = new PGliteDatabase("memory://");
  await runMigrations(database);
  repository = new ChatRepository(database);
});

afterEach(async () => database.close());

describe("ChatRepository", () => {
  it("stores and returns message history", async () => {
    const server = await repository.getServer();
    const channel = server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();
    await repository.upsertUser("user-1", "public-key", { displayName: "Лина", avatar: null });
    const messageId = randomUUID();
    const created = await repository.createMessage(messageId, channel!.id, "user-1", "Первое настоящее сообщение");
    expect(created?.editedAt).toBeNull();
    const updated = await repository.updateMessage(messageId, "user-1", "Исправленное сообщение");
    expect(updated).toMatchObject({ id: messageId, content: "Исправленное сообщение" });
    expect(updated?.editedAt).toBeTruthy();
    expect(await repository.getHistory(channel!.id, 50)).toEqual([updated]);
    expect(await repository.deleteMessage(messageId, "user-1", false)).toMatchObject({ channelId: channel!.id });
    expect(await repository.getHistory(channel!.id, 50)).toEqual([]);
  });

  it("updates channels and deletes their message history", async () => {
    const created = await repository.createChannel(randomUUID(), "черновик", "text", "Старое описание");
    expect(await repository.updateChannel(created.id, "анонсы", "Новое описание")).toMatchObject({ name: "анонсы", description: "Новое описание", kind: "text" });
    await repository.upsertUser("user-1", "public-key", { displayName: "Лина", avatar: null });
    await repository.createMessage(randomUUID(), created.id, "user-1", "Будет удалено вместе с каналом");
    expect(await repository.deleteChannel(created.id)).toBe(true);
    expect(await repository.deleteChannel(created.id)).toBe(false);
    expect(await repository.getHistory(created.id, 50)).toEqual([]);
  });

  it("creates one configured owner and persists administrative roles", async () => {
    await repository.upsertUser("owner", "owner-public-key", { displayName: "Владелец", avatar: null });
    await repository.upsertUser("member", "member-public-key", { displayName: "Участник", avatar: null });
    expect(await repository.ensureMembership("owner", "owner-public-key", "owner-public-key")).toBe("owner");
    expect(await repository.ensureMembership("member", "member-public-key", "owner-public-key")).toBe("member");
    expect(permissionsForRole("owner")).toEqual(["MANAGE_CHANNELS", "MANAGE_MESSAGES", "MANAGE_ROLES", "DELETE_SERVER"]);
    expect(permissionsForRole("administrator")).toContain("MANAGE_MESSAGES");
    expect(await repository.setMemberRole("member", "administrator")).toBe("updated");
    expect((await repository.listMembers(new Set())).find((member) => member.id === "member")?.role).toBe("administrator");
    expect(await repository.setMemberRole("owner", "member")).toBe("owner");
  });

  it("keeps a deletion tombstone across restarts and clears it for a new deployment", async () => {
    const firstDeployment = randomUUID();
    await repository.configureServer("Первая версия", firstDeployment);
    await repository.markServerDeleted();
    expect(await repository.isServerDeleted()).toBe(true);
    await repository.configureServer("Перезапуск", firstDeployment);
    expect(await repository.isServerDeleted()).toBe(true);
    await repository.configureServer("Новая версия", randomUUID());
    expect(await repository.isServerDeleted()).toBe(false);
    expect((await repository.getServer()).name).toBe("Новая версия");
  });
});
