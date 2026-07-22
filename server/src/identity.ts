import { createHash, createPublicKey, verify } from "node:crypto";

export function userIdFromPublicKey(publicKey: string): string {
  return createHash("sha256").update(publicKey, "utf8").digest("base64url");
}

export function verifyChallenge(publicKey: string, challenge: string, signature: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(challenge, "base64"), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
