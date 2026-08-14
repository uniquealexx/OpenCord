import { createPrivateKey, generateKeyPairSync, randomInt, sign } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import { publicKeyFingerprint } from "@opencord/shared";
import type { PublicIdentity } from "../src/shared/bridge";

interface StoredIdentity {
  version: 2;
  publicKey: string;
  encryptedPrivateKey: string;
  discriminator: string;
  createdAt: string;
}

export class IdentityStore {
  private readonly filePath: string;

  constructor(private readonly directory: string) {
    this.filePath = path.join(directory, "identity.json");
  }

  async getOrCreate(): Promise<PublicIdentity> {
    const stored = await this.read();
    if (stored) {
      // Файл v1 или v2 без корректного дискриминатора: до-генерируем его, не трогая ключи.
      if (!stored.discriminator) {
        const upgraded: StoredIdentity = { ...stored, version: 2, discriminator: randomDiscriminator() };
        await this.write(upgraded);
        return publicIdentity(upgraded.publicKey, upgraded.discriminator);
      }
      return publicIdentity(stored.publicKey, stored.discriminator);
    }
    return this.reset();
  }

  async signChallenge(challenge: unknown): Promise<string> {
    if (typeof challenge !== "string" || challenge.length < 16 || challenge.length > 1_000) throw new Error("Invalid challenge");
    const decodedChallenge = Buffer.from(challenge, "base64");
    if (decodedChallenge.length < 16 || decodedChallenge.length > 256) throw new Error("Invalid challenge length");
    const stored = await this.read();
    if (!stored) throw new Error("Identity is missing");
    const privateKeyDer = safeStorage.decryptString(Buffer.from(stored.encryptedPrivateKey, "base64"));
    const privateKey = createPrivateKey({ key: Buffer.from(privateKeyDer, "base64"), format: "der", type: "pkcs8" });
    return sign(null, decodedChallenge, privateKey).toString("base64");
  }

  async reset(): Promise<PublicIdentity> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption is unavailable");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const encodedPublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const encodedPrivateKey = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const stored: StoredIdentity = {
      version: 2,
      publicKey: encodedPublicKey,
      encryptedPrivateKey: safeStorage.encryptString(encodedPrivateKey).toString("base64"),
      discriminator: randomDiscriminator(),
      createdAt: new Date().toISOString(),
    };
    await this.write(stored);
    return publicIdentity(encodedPublicKey, stored.discriminator);
  }

  private async read(): Promise<StoredIdentity | null> {
    try {
      const input = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<Omit<StoredIdentity, "version">> & { version?: number };
      const fieldsValid = typeof input.publicKey === "string" && typeof input.encryptedPrivateKey === "string" && typeof input.createdAt === "string";
      if ((input.version !== 1 && input.version !== 2) || !fieldsValid) throw new Error("Invalid identity file");
      return {
        version: 2,
        publicKey: input.publicKey!,
        encryptedPrivateKey: input.encryptedPrivateKey!,
        discriminator: typeof input.discriminator === "string" && /^\d{4}$/u.test(input.discriminator) ? input.discriminator : "",
        createdAt: input.createdAt!,
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  private async write(stored: StoredIdentity): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}

/** Дискриминатор тега username#1234 — ровно 4 цифры, как в старом Discord. */
function randomDiscriminator(): string {
  return randomInt(0, 10_000).toString().padStart(4, "0");
}

async function publicIdentity(publicKey: string, discriminator: string): Promise<PublicIdentity> {
  // Отпечаток считается общим алгоритмом из @opencord/shared: SHA-256 от SPKI DER,
  // группы по 4 hex-символа. Сервер возвращает тот же код для этого пользователя.
  const fingerprint = await publicKeyFingerprint(publicKey);
  return { publicKey, fingerprint, discriminator };
}
