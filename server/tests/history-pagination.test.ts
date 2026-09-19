import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";
import { ChatRepository } from "../src/database/repository";

let database: PGliteDatabase;
let repository: ChatRepository;

beforeEach(async () => {
  database = new PGliteDatabase("memory://");
  await runMigrations(database);
  repository = new ChatRepository(database);
});

afterEach(async () => database.close());

describe("ChatRepository.getHistory pagination (protocol v53)", () => {
  it("pages through the whole channel without loss or duplicates", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });

    const seeded: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const id = randomUUID();
      await repository.createMessage(id, channel.id, "user-1", `Сообщение ${index}`);
      seeded.push(id);
    }

    const first = await repository.getHistory(channel.id, 50, "user-1");
    expect(first.messages).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    // Страница возвращается в хронологическом порядке (по возрастанию).
    const firstTimes = first.messages.map((message) => `${message.createdAt}|${message.id}`);
    expect(firstTimes).toEqual([...firstTimes].sort());

    const second = await repository.getHistory(channel.id, 50, "user-1", first.messages[0]!.id);
    expect(second.messages).toHaveLength(50);
    expect(second.hasMore).toBe(true);

    const third = await repository.getHistory(channel.id, 50, "user-1", second.messages[0]!.id);
    expect(third.messages.length).toBeGreaterThanOrEqual(20);
    expect(third.hasMore).toBe(false);

    const firstIds = new Set(first.messages.map((message) => message.id));
    expect(second.messages.some((message) => firstIds.has(message.id))).toBe(false);

    const collected = [...first.messages, ...second.messages, ...third.messages].map((message) => message.id);
    expect(new Set(collected).size).toBe(collected.length);
    expect(new Set(collected)).toEqual(new Set(seeded));
  });

  it("breaks a timestamp tie purely by id without losing or repeating messages", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });

    const seeded: string[] = [];
    for (let index = 0; index < 80; index += 1) {
      const id = randomUUID();
      await repository.createMessage(id, channel.id, "user-1", `Одинаковая метка ${index}`);
      seeded.push(id);
    }
    // Все сообщения получают одну и ту же метку времени: страницу должен делить только id.
    await database.query("UPDATE messages SET created_at = $2::timestamptz WHERE channel_id = $1", [channel.id, "2026-01-01T00:00:00.000Z"]);

    const first = await repository.getHistory(channel.id, 50, "user-1");
    expect(first.messages).toHaveLength(50);
    expect(first.hasMore).toBe(true);

    const second = await repository.getHistory(channel.id, 50, "user-1", first.messages[0]!.id);
    expect(second.messages).toHaveLength(30);
    expect(second.hasMore).toBe(false);

    const collected = [...first.messages, ...second.messages].map((message) => message.id);
    expect(new Set(collected).size).toBe(collected.length);
    expect(new Set(collected)).toEqual(new Set(seeded));
  });

  it("treats an unknown cursor as the end of history", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });
    await repository.createMessage(randomUUID(), channel.id, "user-1", "Единственное сообщение");

    expect(await repository.getHistory(channel.id, 50, "user-1", randomUUID())).toEqual({ messages: [], hasMore: false });
  });

  it("keeps the private message visibility filter on every page", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("author", "author-key", { username: "author", discriminator: "1111", avatar: null });
    await repository.upsertUser("sender", "sender-key", { username: "sender", discriminator: "2222", avatar: null });
    await repository.upsertUser("receiver", "receiver-key", { username: "receiver", discriminator: "3333", avatar: null });

    for (let index = 0; index < 60; index += 1) {
      await repository.createMessage(randomUUID(), channel.id, "author", `Публичное ${index}`);
    }
    const secret = await repository.createMessage(randomUUID(), channel.id, "sender", "Только для получателя", [], [], "pm", "receiver");
    expect(secret).not.toBeNull();

    const collected: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const result: Awaited<ReturnType<ChatRepository["getHistory"]>> = await repository.getHistory(channel.id, 25, "author", before);
      expect(result.messages.some((message) => message.id === secret!.id)).toBe(false);
      collected.push(...result.messages.map((message) => message.id));
      if (!result.hasMore) break;
      before = result.messages[0]!.id;
    }
    expect(collected).toHaveLength(60);
    expect(new Set(collected).size).toBe(60);
  });
});
