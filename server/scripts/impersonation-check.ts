/**
 * Проверка защиты тега username#1234 от копирования — глазами модифицированного клиента.
 *
 * Скрипт говорит с сервером по сырому WebSocket, а не через UI, поэтому делает ровно то,
 * что недоступно штатному клиенту: просит чужой дискриминатор при регистрации ключа и
 * пытается забрать его через profile.update.
 *
 *   pnpm --filter @opencord/server exec tsx scripts/impersonation-check.ts
 *   pnpm --filter @opencord/server exec tsx scripts/impersonation-check.ts ws://127.0.0.1:3210/ws
 *
 * Без аргумента поднимается временный сервер в памяти, локальная dev-база не затрагивается.
 */
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { PROTOCOL_VERSION, type ServerEvent } from "@opencord/shared";
import WebSocket from "ws";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";

const VICTIM_USERNAME = "victim";
const VICTIM_DISCRIMINATOR = "4242";

async function main(): Promise<void> {
  const provided = process.argv[2];
  const app = provided ? null : await startTemporaryServer();
  const url = provided ?? `ws://127.0.0.1:${temporaryPort(app!)}/ws`;
  console.log(`Сервер: ${url}${provided ? "" : " (временный, в памяти)"}\n`);

  try {
    const victim = await connect(url, VICTIM_USERNAME, VICTIM_DISCRIMINATOR);
    console.log(`Жертва зарегистрировалась как ${tag(victim)}`);

    // Атака 1: новый ключ просит уже занятый тег прямо при регистрации.
    const impostor = await connect(url, VICTIM_USERNAME, VICTIM_DISCRIMINATOR);
    console.log(`Самозванец просил ${VICTIM_USERNAME}#${VICTIM_DISCRIMINATOR}, получил ${tag(impostor)}`);
    report("регистрация с чужим тегом", tag(impostor) !== tag(victim));

    // Атака 2: тот же тег, но уже через profile.update у существующего профиля.
    await send(impostor.socket, { type: "profile.update", requestId: randomUUID(), profile: { username: VICTIM_USERNAME, discriminator: VICTIM_DISCRIMINATOR, bio: "", avatar: null, banner: null, status: "online" } });
    const updated = await waitFor(impostor.socket, "member.updated", (event) => event.member.id === impostor.userId);
    console.log(`После profile.update самозванец стал ${updated.member.username}#${updated.member.discriminator}`);
    report("подмена тега через profile.update", updated.member.discriminator !== VICTIM_DISCRIMINATOR);

    // Атака 3: сама жертва тоже не может переписать свой дискриминатор.
    await send(victim.socket, { type: "profile.update", requestId: randomUUID(), profile: { username: VICTIM_USERNAME, discriminator: "0000", bio: "", avatar: null, banner: null, status: "online" } });
    const self = await waitFor(victim.socket, "member.updated", (event) => event.member.id === victim.userId);
    console.log(`Жертва просила #0000, осталась ${self.member.username}#${self.member.discriminator}`);
    report("смена собственного дискриминатора", self.member.discriminator === VICTIM_DISCRIMINATOR);

    victim.socket.close();
    impostor.socket.close();
  } finally {
    await app?.close();
  }
}

function report(attack: string, blocked: boolean): void {
  console.log(`${blocked ? "  OK  " : " FAIL "} ${attack}\n`);
  if (!blocked) process.exitCode = 1;
}

function tag(session: Session): string {
  const member = session.snapshot.server.members.find((candidate) => candidate.id === session.userId);
  return `${member?.username}#${member?.discriminator}`;
}

interface Session {
  socket: WebSocket;
  userId: string;
  snapshot: Extract<ServerEvent, { type: "server.snapshot" }>;
}

/** Регистрирует свежий ключ, запрашивая произвольный тег — как это сделал бы свой клиент. */
async function connect(url: string, username: string, discriminator: string): Promise<Session> {
  const socket = new WebSocket(url);
  const keys = generateKeyPairSync("ed25519");
  const challenge = await waitFor(socket, "auth.challenge", () => true);
  const authenticated = waitFor(socket, "auth.ok", () => true);
  const snapshot = waitFor(socket, "server.snapshot", () => true);
  await send(socket, {
    type: "auth.respond",
    requestId: challenge.requestId,
    protocolVersion: PROTOCOL_VERSION,
    publicKey: exportPublicKey(keys.publicKey),
    signature: sign(null, Buffer.from(challenge.challenge, "base64"), keys.privateKey).toString("base64"),
    profile: { username, discriminator, bio: "", avatar: null, banner: null, status: "online" },
  });
  return { socket, userId: (await authenticated).userId, snapshot: await snapshot };
}

function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

async function send(socket: WebSocket, event: unknown): Promise<void> {
  if (socket.readyState === WebSocket.CONNECTING) await new Promise((resolve) => socket.once("open", resolve));
  socket.send(JSON.stringify(event));
}

function waitFor<T extends ServerEvent["type"]>(socket: WebSocket, type: T, matches: (event: Extract<ServerEvent, { type: T }>) => boolean): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Не дождались события ${type}`)); }, 10_000);
    function cleanup(): void { clearTimeout(timer); socket.off("message", onMessage); }
    function onMessage(raw: WebSocket.RawData): void {
      const event = JSON.parse(raw.toString()) as ServerEvent;
      if (event.type === "error") { cleanup(); reject(new Error(`Сервер ответил ошибкой: ${event.code} ${event.message}`)); return; }
      if (event.type !== type || !matches(event as Extract<ServerEvent, { type: T }>)) return;
      cleanup();
      resolve(event as Extract<ServerEvent, { type: T }>);
    }
    socket.on("message", onMessage);
  });
}

async function startTemporaryServer(): Promise<Awaited<ReturnType<typeof buildApp>>> {
  const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: { version: "0.0.0", releaseChannel: "development", commit: null } });
  await app.listen({ host: "127.0.0.1", port: 0 });
  return app;
}

function temporaryPort(app: Awaited<ReturnType<typeof buildApp>>): number {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Не удалось определить порт временного сервера");
  return address.port;
}

await main();
