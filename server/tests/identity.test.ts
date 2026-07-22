import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { userIdFromPublicKey, verifyChallenge } from "../src/identity";

describe("identity verification", () => {
  it("verifies an Ed25519 challenge and derives a stable user id", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const encodedPublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const challenge = Buffer.from("random challenge").toString("base64");
    const signature = sign(null, Buffer.from(challenge, "base64"), privateKey).toString("base64");
    expect(verifyChallenge(encodedPublicKey, challenge, signature)).toBe(true);
    expect(userIdFromPublicKey(encodedPublicKey)).toBe(userIdFromPublicKey(encodedPublicKey));
  });

  it("rejects a signature from another key", () => {
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");
    const publicKey = first.publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const challenge = Buffer.from("challenge").toString("base64");
    const signature = sign(null, Buffer.from(challenge, "base64"), second.privateKey).toString("base64");
    expect(verifyChallenge(publicKey, challenge, signature)).toBe(false);
  });
});
