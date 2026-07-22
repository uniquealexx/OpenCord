import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDefaultState, parsePersistedState, type PersistedClientState } from "../src/shared/state";

export class ClientStateStore {
  readonly filePath: string;

  constructor(private readonly directory: string) {
    this.filePath = path.join(directory, "client-state.json");
  }

  async load(): Promise<PersistedClientState> {
    await mkdir(this.directory, { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      return parsePersistedState(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isMissingFile(error)) {
        const initial = createDefaultState();
        await this.save(initial);
        return initial;
      }

      await this.backupCorruptFile();
      const fallback = createDefaultState();
      await this.save(fallback);
      return fallback;
    }
  }

  async save(input: unknown): Promise<PersistedClientState> {
    const state = parsePersistedState(input);
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    return state;
  }

  async reset(): Promise<PersistedClientState> {
    return this.save(createDefaultState());
  }

  private async backupCorruptFile(): Promise<void> {
    try {
      const backupPath = path.join(this.directory, `client-state.corrupt-${Date.now()}.json`);
      await copyFile(this.filePath, backupPath);
    } catch {
      // If the invalid file disappeared between reading and backup, the safe reset can continue.
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
