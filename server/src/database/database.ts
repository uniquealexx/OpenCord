import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

export interface QueryRow { [column: string]: unknown }

export interface Database {
  query<T extends QueryRow>(sql: string, parameters?: readonly unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: "pglite" | "postgres";
}

export class PGliteDatabase implements Database {
  readonly kind = "pglite" as const;
  private readonly database: PGlite;

  constructor(dataDir = "memory://") {
    ensurePGliteDirectory(dataDir);
    this.database = new PGlite(dataDir);
  }

  async query<T extends QueryRow>(sql: string, parameters: readonly unknown[] = []): Promise<T[]> {
    const result = await this.database.query<T>(sql, [...parameters]);
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.database.exec(sql);
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}

function ensurePGliteDirectory(dataDir: string): void {
  if (dataDir === "memory://" || dataDir.startsWith("idb://")) return;
  const directory = dataDir.startsWith("file://") ? fileURLToPath(dataDir) : dataDir;
  mkdirSync(directory, { recursive: true });
}

export class PostgresDatabase implements Database {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  async query<T extends QueryRow>(sql: string, parameters: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, [...parameters]);
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
