import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import { PROTOCOL_VERSION, serverEventSchema, type ServerEvent } from "@opencord/shared";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";
import { getClientIp } from "../src/ip";
import { WS_AUTH_FAILURE_BURST, WS_CONNECT_BURST } from "../src/rate-limit";

const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];
const testBuildInfo = { version: "0.1.0", releaseChannel: "development", commit: null } as const;

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

async function listenUrl(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Unexpected test address");
  return `ws://127.0.0.1:${address.port}/ws`;
}

function waitForEvent<T extends ServerEvent["type"]>(socket: WebSocket, type: T): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, 5_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const parsed = serverEventSchema.safeParse(JSON.parse(data.toString()) as unknown);
      if (parsed.success && parsed.data.type === type) { cleanup(); resolve(parsed.data as Extract<ServerEvent, { type: T }>); }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const onClose = (): void => { cleanup(); reject(new Error(`Socket closed before ${type}`)); };
    const cleanup = (): void => { clearTimeout(timeout); socket.off("message", onMessage); socket.off("error", onError); socket.off("close", onClose); };
    socket.on("message", onMessage);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

function buildBadAuthRespond(requestId: string): { type: "auth.respond"; requestId: string; protocolVersion: number; publicKey: string; signature: string; profile: { username: string; discriminator: string; avatar: null } } {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = exportPublicKey(keys.publicKey);
  // Правильный ключ, но подпись от чужих данных: verifyChallenge вернёт false.
  const signature = sign(null, Buffer.from("not-the-challenge", "utf8"), keys.privateKey).toString("base64");
  return { type: "auth.respond", requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username: "baduser", discriminator: "1234", avatar: null } };
}

describe("WebSocket pre-authentication hardening", () => {
  it("closes excess connections from one IP with a policy-violation code", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    const url = await listenUrl(app);

    const allowed: WebSocket[] = [];
    for (let index = 0; index < WS_CONNECT_BURST; index += 1) {
      const socket = new WebSocket(url);
      await waitForEvent(socket, "auth.challenge");
      allowed.push(socket);
    }

    const extra = new WebSocket(url);
    const [code] = await once(extra, "close");
    expect(code).toBe(1008);

    for (const socket of allowed) {
      socket.close();
      await once(socket, "close").catch(() => undefined);
    }
  }, 10_000);

  it(`closes a socket after ${WS_AUTH_FAILURE_BURST} failed auth.respond attempts`, async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    const url = await listenUrl(app);

    const socket = new WebSocket(url);
    const challenge = await waitForEvent(socket, "auth.challenge");

    for (let attempt = 0; attempt < WS_AUTH_FAILURE_BURST - 1; attempt += 1) {
      socket.send(JSON.stringify(buildBadAuthRespond(challenge.requestId)));
      const error = await waitForEvent(socket, "error");
      expect(error.code).toBe("AUTH_FAILED");
    }

    socket.send(JSON.stringify(buildBadAuthRespond(challenge.requestId)));
    const [code] = await once(socket, "close");
    expect(code).toBe(1008);
  }, 10_000);

  it("allows valid authentication from a different IP after failures from another IP", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    const url = await listenUrl(app);

    const failingSocket = new WebSocket(url, { headers: { "x-forwarded-for": "10.0.0.1" } });
    const challenge1 = await waitForEvent(failingSocket, "auth.challenge");

    for (let attempt = 0; attempt < WS_AUTH_FAILURE_BURST; attempt += 1) {
      failingSocket.send(JSON.stringify(buildBadAuthRespond(challenge1.requestId)));
      await waitForEvent(failingSocket, "error");
    }
    await once(failingSocket, "close");

    const keys = generateKeyPairSync("ed25519");
    const goodSocket = new WebSocket(url, { headers: { "x-forwarded-for": "10.0.0.2" } });
    const challenge2 = await waitForEvent(goodSocket, "auth.challenge");
    const publicKey = exportPublicKey(keys.publicKey);
    const signature = sign(null, Buffer.from(challenge2.challenge, "base64"), keys.privateKey).toString("base64");
    const authOk = waitForEvent(goodSocket, "auth.ok");
    goodSocket.send(JSON.stringify({ type: "auth.respond", requestId: challenge2.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username: "good", discriminator: "1234", avatar: null } }));
    const ok = await authOk;
    expect(ok.type).toBe("auth.ok");

    goodSocket.close();
    await once(goodSocket, "close");
  }, 10_000);

  it("uses the last X-Forwarded-For entry when behind a loopback proxy", () => {
    expect(getClientIp("127.0.0.1", "10.0.0.1, 10.0.0.2")).toBe("10.0.0.2");
    expect(getClientIp("::ffff:127.0.0.1", "203.0.113.5")).toBe("203.0.113.5");
  });

  it("ignores X-Forwarded-For spoofing from a non-proxy peer", () => {
    expect(getClientIp("198.51.100.5", "10.0.0.1, 10.0.0.2")).toBe("198.51.100.5");
    expect(getClientIp("203.0.113.7", "127.0.0.1")).toBe("203.0.113.7");
  });
});
