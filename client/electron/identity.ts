import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import type { PublicIdentity } from "../src/shared/bridge";

interface StoredIdentity {
  version: 1;
  publicKey: string;
  encryptedPrivateKey: string;
  createdAt: string;
}

export class IdentityStore {
  private readonly filePath: string;

  constructor(private readonly directory: string) {
    this.filePath = path.join(directory, "identity.json");
  }

  async getOrCreate(): Promise<PublicIdentity> {
    const stored = await this.read();
    if (stored) return publicIdentity(stored.publicKey);
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
      version: 1,
      publicKey: encodedPublicKey,
      encryptedPrivateKey: safeStorage.encryptString(encodedPrivateKey).toString("base64"),
      createdAt: new Date().toISOString(),
    };
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    return publicIdentity(encodedPublicKey);
  }

  private async read(): Promise<StoredIdentity | null> {
    try {
      const input = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StoredIdentity>;
      if (input.version !== 1 || typeof input.publicKey !== "string" || typeof input.encryptedPrivateKey !== "string" || typeof input.createdAt !== "string") throw new Error("Invalid identity file");
      return input as StoredIdentity;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }
}

function publicIdentity(publicKey: string): PublicIdentity {
  const fingerprint = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").match(/.{1,4}/g)?.slice(0, 4).join("-") ?? "unknown";
  return { publicKey, fingerprint };
}
