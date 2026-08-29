import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";

describe("migrations", () => {
  it("splits already stored duplicate username#discriminator tags and forbids new ones", async () => {
    const database = new PGliteDatabase("memory://");
    try {
      await runMigrations(database);
      // Возвращаем базу в состояние до 026: так выглядят серверы, где дубликаты уже накопились.
      await database.exec("DROP INDEX users_username_discriminator_key");
      await database.query("DELETE FROM schema_migrations WHERE id = $1", ["026_unique_username_discriminator"]);
      await database.query(
        `INSERT INTO users (id, public_key, display_name, bio, avatar, username, discriminator, created_at) VALUES
           ('older', 'older-key', 'twins', '', NULL, 'twins', '4242', now() - interval '1 day'),
           ('newer', 'newer-key', 'twins', '', NULL, 'twins', '4242', now())`,
      );

      await runMigrations(database);

      const rows = await database.query<{ id: string; discriminator: string }>("SELECT id, discriminator FROM users ORDER BY id");
      expect(rows.find((row) => row.id === "older")?.discriminator).toBe("4242");
      expect(rows.find((row) => row.id === "newer")?.discriminator).not.toBe("4242");
      expect(rows.find((row) => row.id === "newer")?.discriminator).toMatch(/^[0-9]{4}$/u);

      await expect(
        database.query("UPDATE users SET discriminator = '4242' WHERE id = 'newer'"),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await database.close();
    }
  }, 30_000);
});

describe("PGliteDatabase", () => {
  it("creates a missing nested data directory on first launch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opencord-pglite-"));
    const dataDir = path.join(root, "missing", "nested", "database");
    const database = new PGliteDatabase(dataDir);
    try {
      await database.exec("CREATE TABLE launch_test (id integer PRIMARY KEY)");
      await database.query("INSERT INTO launch_test (id) VALUES ($1)", [1]);
      await expect(database.query<{ id: number }>("SELECT id FROM launch_test")).resolves.toEqual([{ id: 1 }]);
    } finally {
      await database.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
