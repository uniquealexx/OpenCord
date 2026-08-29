import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDefaultState, parsePersistedState, STATE_VERSION, type PersistedClientState } from "../src/shared/state";
import { createPlainTextCipher, type StateCipher } from "./state-cipher";

/**
 * Конверт зашифрованного состояния. Отдельное поле `format` нужно, чтобы отличить его
 * от старого открытого файла: у того на верхнем уровне лежит сам стейт со своим `version`.
 */
const ENCRYPTED_FORMAT = "opencord-encrypted-state@1";

interface EncryptedEnvelope {
  format: typeof ENCRYPTED_FORMAT;
  payload: string;
}

export class ClientStateStore {
  readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * `client-state.json` содержит кэш переписки, включая личные сообщения, и профиль.
   * Режим 0o600 закрывает файл от других пользователей POSIX, но на Windows — основной
   * платформе — ACL не выставляются, поэтому содержимое шифруется ключом ОС.
   */
  constructor(private readonly directory: string, private readonly cipher: StateCipher = createPlainTextCipher()) {
    this.filePath = path.join(directory, "client-state.json");
  }

  async load(): Promise<PersistedClientState> {
    await mkdir(this.directory, { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const stored = JSON.parse(raw) as unknown;
      const decoded = isEncryptedEnvelope(stored)
        ? JSON.parse(this.cipher.decrypt(Buffer.from(stored.payload, "base64"))) as unknown
        : stored;
      const state = parsePersistedState(decoded);
      // Открытый файл, оставшийся от прежних версий, переписывается зашифрованным.
      if (!isCurrentState(decoded) || !isEncryptedEnvelope(stored)) await this.save(state);
      return state;
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
    const write = this.writeQueue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${this.serialize(state)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    this.writeQueue = write.catch(() => undefined);
    await write;
    return state;
  }

  async reset(): Promise<PersistedClientState> {
    return this.save(createDefaultState());
  }

  /**
   * Доступность шифрования проверяется на каждой записи, а не один раз в конструкторе:
   * в Linux связка ключей может подняться уже после старта приложения.
   */
  private serialize(state: PersistedClientState): string {
    if (!this.cipher.isAvailable()) return JSON.stringify(state, null, 2);
    const envelope: EncryptedEnvelope = {
      format: ENCRYPTED_FORMAT,
      payload: this.cipher.encrypt(JSON.stringify(state)).toString("base64"),
    };
    return JSON.stringify(envelope, null, 2);
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

function isCurrentState(value: unknown): boolean {
  return typeof value === "object" && value !== null && "version" in value && value.version === STATE_VERSION;
}

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return typeof value === "object" && value !== null
    && "format" in value && value.format === ENCRYPTED_FORMAT
    && "payload" in value && typeof value.payload === "string";
}
