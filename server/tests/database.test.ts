import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PGliteDatabase } from "../src/database/database";

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
