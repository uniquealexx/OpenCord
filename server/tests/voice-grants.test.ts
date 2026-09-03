import { randomUUID } from "node:crypto";
import type { VoicePresence } from "@opencord/shared";
import { describe, expect, it } from "vitest";
import { TrackSource, TrackType } from "livekit-server-sdk";
import { LIVEKIT_PUBLISH_SOURCES, LIVEKIT_SERVER_MUTED_PUBLISH_SOURCES, LiveKitVoiceService, roomName, VoiceRoomFullError } from "../src/voice";

/** Идентификатор сервера, которому принадлежат комнаты в тестах. */
const testServerId = randomUUID();

/** Справки по умолчанию: мута нет, предел демонстрации заведомо не мешает. */
const testLookups = (screenShareMaxHeight = 1440, id = testServerId, mayBeInVoice = async () => true) => ({ serverMuted: async () => false, server: async () => ({ id, screenShareMaxHeight }), mayBeInVoice });

describe("LiveKit voice grants", () => {
  it("allows microphone, screen video and screen audio only", () => {
    expect(LIVEKIT_PUBLISH_SOURCES).toEqual([
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ]);
  });

  it("removes only microphone publishing while a participant is server-muted", () => {
    expect(LIVEKIT_SERVER_MUTED_PUBLISH_SOURCES).toEqual([
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ]);
    expect(LIVEKIT_SERVER_MUTED_PUBLISH_SOURCES).not.toContain(TrackSource.MICROPHONE);
  });

  it("issues a token without microphone publishing for a server-muted participant, with no presence in memory", async () => {
    const service = new LiveKitVoiceService({ internalUrl: "http://127.0.0.1:7880", publicUrl: "ws://127.0.0.1:7880", apiKey: "test-key", apiSecret: "test-secret", secureTransport: false, maxParticipants: 25 });
    // LiveKit в тесте не поднимается: подменяется только транспорт, логика выдачи прав своя.
    (service as unknown as { client: unknown }).client = {
      listRooms: async () => [],
      createRoom: async () => undefined,
      listParticipants: async () => [],
    };
    const request = { serverId: randomUUID(), channelId: randomUUID(), userId: "muted-user", participantLimit: 25 };

    // Ключевой случай: participant вышел из канала, presence пуста, мут пришёл из хранилища.
    const muted = await service.issueJoin({ ...request, serverMuted: true });
    expect(grantedSources(muted.token)).toEqual(["screen_share", "screen_share_audio"]);
    expect(grantedSources(muted.token)).not.toContain("microphone");
    expect(muted.replaced).toBeNull();

    const unmuted = await service.issueJoin({ ...request, serverMuted: false });
    expect(grantedSources(unmuted.token)).toEqual(["microphone", "screen_share", "screen_share_audio"]);
  });

  describe("self-mute verification", () => {
    const channelId = randomUUID();
    const room = roomName(testServerId, channelId);
    const basePresence = { userId: "liar", channelId, muted: true, deafened: false, serverMuted: false, viewingScreenShareUserId: null };

    /** Сервис с подставленным транспортом LiveKit и известной комнатой для канала. */
    function serviceWithParticipant(tracks: Array<{ source: TrackSource; muted: boolean }>, presence = basePresence): LiveKitVoiceService {
      const service = new LiveKitVoiceService({ internalUrl: "http://127.0.0.1:7880", publicUrl: "ws://127.0.0.1:7880", apiKey: "test-key", apiSecret: "test-secret", secureTransport: false, maxParticipants: 25 });
      const internals = service as unknown as { presences: Map<string, VoicePresence>; roomsByChannel: Map<string, string>; client: unknown };
      internals.presences.set(presence.userId, presence);
      internals.roomsByChannel.set(presence.channelId, room);
      internals.client = { getParticipant: async () => ({ identity: presence.userId, tracks }) };
      return service;
    }

    it("corrects a participant who claims to be muted while the microphone keeps publishing", async () => {
      const service = serviceWithParticipant([{ source: TrackSource.MICROPHONE, muted: false }]);
      const corrected = await service.verifySelfMute("liar");
      expect(corrected).toMatchObject({ userId: "liar", muted: false });
      expect(service.presence()[0]).toMatchObject({ userId: "liar", muted: false });
    });

    it("leaves an honest mute alone, whether the track is muted or not published at all", async () => {
      const withMutedTrack = serviceWithParticipant([{ source: TrackSource.MICROPHONE, muted: true }]);
      expect(await withMutedTrack.verifySelfMute("liar")).toBeNull();
      expect(withMutedTrack.presence()[0]).toMatchObject({ muted: true });

      const withoutTrack = serviceWithParticipant([]);
      expect(await withoutTrack.verifySelfMute("liar")).toBeNull();
      expect(withoutTrack.presence()[0]).toMatchObject({ muted: true });
    });

    it("keeps a server mute in place even when the claim is a lie", async () => {
      const service = serviceWithParticipant([{ source: TrackSource.MICROPHONE, muted: false }], { ...basePresence, serverMuted: true });
      // Серверный мут снимать нельзя: он не является заявлением клиента.
      expect(await service.verifySelfMute("liar")).toBeNull();
      expect(service.presence()[0]).toMatchObject({ muted: true, serverMuted: true });
    });

    it("does nothing for a participant who is not in a voice channel", async () => {
      const service = serviceWithParticipant([{ source: TrackSource.MICROPHONE, muted: false }]);
      expect(await service.verifySelfMute("someone-else")).toBeNull();
    });

    it("stays silent when LiveKit cannot answer", async () => {
      const service = serviceWithParticipant([{ source: TrackSource.MICROPHONE, muted: false }]);
      (service as unknown as { client: unknown }).client = { getParticipant: async () => { throw new Error("LiveKit is down"); } };
      expect(await service.verifySelfMute("liar")).toBeNull();
      expect(service.presence()[0]).toMatchObject({ muted: true });
    });
  });

  it("lets LiveKit track state override a remembered self-mute claim during reconciliation", async () => {
    const service = new LiveKitVoiceService({ internalUrl: "http://127.0.0.1:7880", publicUrl: "ws://127.0.0.1:7880", apiKey: "test-key", apiSecret: "test-secret", secureTransport: false, maxParticipants: 25 });
    const channelId = randomUUID();
    const room = roomName(testServerId, channelId);
    const internals = service as unknown as { selfMutedByUser: Map<string, boolean>; client: unknown };
    // Клиент однажды объявил себя заглушённым — раньше это заявление держалось вечно.
    internals.selfMutedByUser.set("liar", true);
    internals.client = {
      listRooms: async () => [{ name: room }],
      listParticipants: async () => [{ identity: "liar", tracks: [{ source: TrackSource.MICROPHONE, muted: false }], permission: { canPublishSources: [] } }],
    };

    const presence = await service.reconcile([channelId], testLookups());
    expect(presence).toEqual([expect.objectContaining({ userId: "liar", muted: false, serverMuted: false })]);
  });

  describe("screen share limit", () => {
    const channelId = randomUUID();
    const room = roomName(testServerId, channelId);

    function serviceWithMuteSpy(): { service: LiveKitVoiceService; muted: Array<{ identity: string; trackSid: string; muted: boolean }> } {
      const service = new LiveKitVoiceService({ internalUrl: "http://127.0.0.1:7880", publicUrl: "ws://127.0.0.1:7880", apiKey: "test-key", apiSecret: "test-secret", secureTransport: false, maxParticipants: 25 });
      const muted: Array<{ identity: string; trackSid: string; muted: boolean }> = [];
      (service as unknown as { client: unknown }).client = {
        mutePublishedTrack: async (_room: string, identity: string, trackSid: string, value: boolean) => { muted.push({ identity, trackSid, muted: value }); return {}; },
      };
      return { service, muted };
    }

    const publishTrack = (service: LiveKitVoiceService, track: Record<string, unknown>) => {
      (service as unknown as { receiver: unknown }).receiver = {
        receive: async () => ({ event: "track_published", participant: { identity: "sharer" }, room: { name: room }, track }),
      };
      return service.receiveWebhook("{}", "signature", testLookups(1080));
    };

    const screenShare = (height: number, extra: Record<string, unknown> = {}) => ({ sid: "TR_1", type: TrackType.VIDEO, source: TrackSource.SCREEN_SHARE, height, muted: false, ...extra });

    it("mutes a screen share published above the resolution the owner allows", async () => {
      const { service, muted } = serviceWithMuteSpy();
      await publishTrack(service, screenShare(1440));
      expect(muted).toEqual([{ identity: "sharer", trackSid: "TR_1", muted: true }]);
    });

    it("leaves a screen share within the limit alone", async () => {
      const { service, muted } = serviceWithMuteSpy();
      await publishTrack(service, screenShare(1080));
      expect(muted).toEqual([]);
      await publishTrack(service, screenShare(720));
      expect(muted).toEqual([]);
    });

    it("allows a wide frame as long as its height fits: ultrawide monitors are legitimate", async () => {
      const { service, muted } = serviceWithMuteSpy();
      await publishTrack(service, screenShare(1080, { width: 3440 }));
      expect(muted).toEqual([]);
    });

    it("ignores the microphone and camera: the limit is about screen sharing", async () => {
      const { service, muted } = serviceWithMuteSpy();
      await publishTrack(service, { sid: "TR_2", type: TrackType.AUDIO, source: TrackSource.MICROPHONE, height: 0, muted: false });
      await publishTrack(service, { sid: "TR_3", type: TrackType.VIDEO, source: TrackSource.CAMERA, height: 2160, muted: false });
      expect(muted).toEqual([]);
    });

    it("does not touch a track that is already muted", async () => {
      const { service, muted } = serviceWithMuteSpy();
      await publishTrack(service, screenShare(1440, { muted: true }));
      expect(muted).toEqual([]);
    });

    it("stays quiet when LiveKit refuses the mute: the track may already be gone", async () => {
      const { service } = serviceWithMuteSpy();
      (service as unknown as { client: unknown }).client = { mutePublishedTrack: async () => { throw new Error("track not found"); } };
      await expect(publishTrack(service, screenShare(1440))).resolves.toBeNull();
    });

    it("also catches an over-sized share during reconciliation", async () => {
      const { service, muted } = serviceWithMuteSpy();
      (service as unknown as { client: { listRooms: unknown; listParticipants: unknown } }).client = {
        ...(service as unknown as { client: object }).client,
        listRooms: async () => [{ name: room }],
        listParticipants: async () => [{ identity: "sharer", tracks: [screenShare(1440)], permission: { canPublishSources: [] } }],
      };
      await service.reconcile([channelId], testLookups(1080));
      expect(muted).toEqual([{ identity: "sharer", trackSid: "TR_1", muted: true }]);
    });
  });

  describe("room ownership", () => {
    const channelId = randomUUID();
    const foreignServerId = randomUUID();

    function serviceWithRooms(rooms: string[]): LiveKitVoiceService {
      const service = new LiveKitVoiceService({ internalUrl: "http://127.0.0.1:7880", publicUrl: "ws://127.0.0.1:7880", apiKey: "test-key", apiSecret: "test-secret", secureTransport: false, maxParticipants: 25 });
      (service as unknown as { client: unknown }).client = {
        listRooms: async () => rooms.map((name) => ({ name })),
        listParticipants: async () => [{ identity: "outsider", tracks: [], permission: { canPublishSources: [] } }],
      };
      return service;
    }

    const webhookFrom = (service: LiveKitVoiceService, room: string) => {
      (service as unknown as { receiver: unknown }).receiver = {
        receive: async () => ({ event: "participant_joined", participant: { identity: "outsider" }, room: { name: room } }),
      };
      return service.receiveWebhook("{}", "signature", testLookups());
    };

    it("ignores a webhook about a room belonging to another OpenCord server", async () => {
      // Один LiveKit на несколько развёрнутых OpenCord: channelId может совпасть,
      // и раньше чужой участник попадал в presence как свой.
      const service = serviceWithRooms([]);
      expect(await webhookFrom(service, roomName(foreignServerId, channelId))).toBeNull();
      expect(service.presence()).toEqual([]);

      // Своя комната с тем же channelId по-прежнему принимается.
      const change = await webhookFrom(service, roomName(testServerId, channelId));
      expect(change?.joined).toMatchObject({ userId: "outsider", channelId });
    });

    it("skips another server's rooms during reconciliation", async () => {
      const service = serviceWithRooms([roomName(foreignServerId, channelId)]);
      expect(await service.reconcile([channelId], testLookups())).toEqual([]);
    });

    it("still reconciles its own rooms", async () => {
      const service = serviceWithRooms([roomName(testServerId, channelId)]);
      expect(await service.reconcile([channelId], testLookups())).toEqual([expect.objectContaining({ userId: "outsider", channelId })]);
    });

    it("rejects room names that are not shaped like ours at all", async () => {
      const service = serviceWithRooms([]);
      for (const room of ["", "oc_", `oc_${testServerId}_`, `oc_${testServerId}_not-a-uuid`, `prefix_oc_${testServerId}_${channelId}`, channelId]) {
        expect(await webhookFrom(service, room)).toBeNull();
      }
      expect(service.presence()).toEqual([]);
    });
  });

  describe("voice membership", () => {
    const channelId = randomUUID();
    const room = roomName(testServerId, channelId);

    function serviceWithRemovalSpy(participants: string[] = ["outsider"]): { service: LiveKitVoiceService; removed: string[] } {
      const service = new LiveKitVoiceService({ internalUrl: "http://127.0.0.1:7880", publicUrl: "ws://127.0.0.1:7880", apiKey: "test-key", apiSecret: "test-secret", secureTransport: false, maxParticipants: 25 });
      const removed: string[] = [];
      (service as unknown as { client: unknown }).client = {
        removeParticipant: async (_room: string, identity: string) => { removed.push(identity); },
        listRooms: async () => [{ name: room }],
        listParticipants: async () => participants.map((identity) => ({ identity, tracks: [], permission: { canPublishSources: [] } })),
      };
      (service as unknown as { receiver: unknown }).receiver = {
        receive: async () => ({ event: "participant_joined", participant: { identity: "outsider" }, room: { name: room } }),
      };
      return { service, removed };
    }

    const denied = testLookups(1440, testServerId, async () => false);

    it("evicts a participant who joined without the right to be there instead of listing them", async () => {
      // Токен живёт 300 секунд: участника могли забанить или исключить уже после выдачи,
      // в том числе пока он ещё не появился в комнате и отзывать было нечего.
      const { service, removed } = serviceWithRemovalSpy();
      expect(await service.receiveWebhook("{}", "signature", denied)).toBeNull();
      expect(removed).toEqual(["outsider"]);
      expect(service.presence()).toEqual([]);
    });

    it("admits a participant who is still a member", async () => {
      const { service, removed } = serviceWithRemovalSpy();
      const change = await service.receiveWebhook("{}", "signature", testLookups());
      expect(change?.joined).toMatchObject({ userId: "outsider", channelId });
      expect(removed).toEqual([]);
    });

    it("also evicts during reconciliation, and keeps the presence empty", async () => {
      const { service, removed } = serviceWithRemovalSpy();
      expect(await service.reconcile([channelId], denied)).toEqual([]);
      expect(removed).toEqual(["outsider"]);
    });

    it("drops the reservation of an evicted participant so the slot is freed", async () => {
      const { service, removed } = serviceWithRemovalSpy();
      const reservations = (service as unknown as { joinReservations: Map<string, unknown> }).joinReservations;
      reservations.set("outsider", { room, expiresAt: Date.now() + 60_000 });
      await service.receiveWebhook("{}", "signature", denied);
      expect(reservations.has("outsider")).toBe(false);
      expect(removed).toEqual(["outsider"]);
    });
  });

  describe("participant limit", () => {
    const serverId = testServerId;
    const channelId = randomUUID();

    /**
     * LiveKit с искусственной задержкой в `listParticipants`: именно этот промежуток
     * между чтением списка и выдачей токена и позволял двум входам пройти вместе.
     */
    function serviceWithSlowList(participants: string[] = []): { service: LiveKitVoiceService; listCalls: () => number } {
      const service = new LiveKitVoiceService({ internalUrl: "http://127.0.0.1:7880", publicUrl: "ws://127.0.0.1:7880", apiKey: "test-key", apiSecret: "test-secret", secureTransport: false, maxParticipants: 25 });
      let listCalls = 0;
      (service as unknown as { client: unknown }).client = {
        listRooms: async () => [],
        createRoom: async () => undefined,
        listParticipants: async () => {
          listCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return participants.map((identity) => ({ identity, tracks: [], permission: { canPublishSources: [] } }));
        },
      };
      return { service, listCalls: () => listCalls };
    }

    const joinRequest = (userId: string, participantLimit: number) => ({ serverId, channelId, userId, participantLimit, serverMuted: false });

    it("admits only one of two simultaneous joins into the last free slot", async () => {
      const { service } = serviceWithSlowList([]);
      const results = await Promise.allSettled([
        service.issueJoin(joinRequest("first", 1)),
        service.issueJoin(joinRequest("second", 1)),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(VoiceRoomFullError);
    });

    it("counts a token that has been issued but has not reached LiveKit yet", async () => {
      const { service } = serviceWithSlowList([]);
      // Первый вход состоялся, но участник в списке LiveKit ещё не появился.
      await service.issueJoin(joinRequest("first", 1));
      await expect(service.issueJoin(joinRequest("second", 1))).rejects.toBeInstanceOf(VoiceRoomFullError);
    });

    it("lets the same participant re-request a token without taking a second slot", async () => {
      const { service } = serviceWithSlowList([]);
      await service.issueJoin(joinRequest("first", 1));
      await expect(service.issueJoin(joinRequest("first", 1))).resolves.toMatchObject({ endpoint: "ws://127.0.0.1:7880" });
    });

    it("releases the reservation once LiveKit reports the participant has joined", async () => {
      const { service } = serviceWithSlowList([]);
      await service.issueJoin(joinRequest("first", 2));
      const reservations = (service as unknown as { joinReservations: Map<string, unknown> }).joinReservations;
      expect(reservations.has("first")).toBe(true);

      // С этого момента участник считается по списку LiveKit, и бронь только мешала бы.
      (service as unknown as { receiver: unknown }).receiver = {
        receive: async () => ({ event: "participant_joined", participant: { identity: "first" }, room: { name: roomName(serverId, channelId) } }),
      };
      await service.receiveWebhook("{}", "signature", testLookups());
      expect(reservations.has("first")).toBe(false);
    });

    it("counts a participant whose reservation was already handed over to a presence", async () => {
      // Самый узкий момент: вебхук о входе уже снял бронь, а список LiveKit, который
      // читает следующий вход, был получен до этого и вошедшего ещё не содержит.
      const { service } = serviceWithSlowList([]);
      await service.issueJoin(joinRequest("first", 1));
      (service as unknown as { receiver: unknown }).receiver = {
        receive: async () => ({ event: "participant_joined", participant: { identity: "first" }, room: { name: roomName(serverId, channelId) } }),
      };
      await service.receiveWebhook("{}", "signature", testLookups());
      const internals = service as unknown as { joinReservations: Map<string, unknown> };
      expect(internals.joinReservations.has("first")).toBe(false);
      expect(service.presence()).toEqual([expect.objectContaining({ userId: "first" })]);

      // Ни брони, ни строчки в списке — участник виден только по presence.
      await expect(service.issueJoin(joinRequest("second", 1))).rejects.toBeInstanceOf(VoiceRoomFullError);
    });

    it("does not let a stale reservation hold a slot forever", async () => {
      const { service } = serviceWithSlowList([]);
      await service.issueJoin(joinRequest("never-connects", 1));
      const reservations = (service as unknown as { joinReservations: Map<string, { room: string; expiresAt: number }> }).joinReservations;
      expect(reservations.has("never-connects")).toBe(true);
      // Токен выдан, но клиент так и не подключился: место обязано освободиться.
      reservations.set("never-connects", { room: roomName(serverId, channelId), expiresAt: Date.now() - 1 });
      await expect(service.issueJoin(joinRequest("second", 1))).resolves.toBeTruthy();
      expect(reservations.has("never-connects")).toBe(false);
    });

    it("keeps an unlimited channel unlimited", async () => {
      const { service } = serviceWithSlowList(["a", "b", "c"]);
      await expect(service.issueJoin(joinRequest("fourth", 0))).resolves.toBeTruthy();
    });

    it("serialises joins to the same room instead of racing them", async () => {
      const { service, listCalls } = serviceWithSlowList([]);
      await Promise.allSettled([
        service.issueJoin(joinRequest("a", 5)),
        service.issueJoin(joinRequest("b", 5)),
        service.issueJoin(joinRequest("c", 5)),
      ]);
      // Очередь не должна ломаться и не должна терять входы.
      expect(listCalls()).toBe(3);
      const reservations = (service as unknown as { joinReservations: Map<string, unknown> }).joinReservations;
      expect([...reservations.keys()].sort()).toEqual(["a", "b", "c"]);
    });
  });

  it("keeps a screen-share viewer target only inside the same voice channel", () => {
    const service = new LiveKitVoiceService({ internalUrl: "http://127.0.0.1:7880", publicUrl: "ws://127.0.0.1:7880", apiKey: "test-key", apiSecret: "test-secret", secureTransport: false, maxParticipants: 25 });
    const presences = (service as unknown as { presences: Map<string, VoicePresence> }).presences;
    const channelId = randomUUID();
    const otherChannelId = randomUUID();
    const base = { muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null };
    presences.set("viewer", { ...base, userId: "viewer", channelId });
    presences.set("same-room-share", { ...base, userId: "same-room-share", channelId });
    presences.set("other-room-share", { ...base, userId: "other-room-share", channelId: otherChannelId });

    expect(service.updateState("viewer", { muted: false, deafened: false, viewingScreenShareUserId: "same-room-share" })?.viewingScreenShareUserId).toBe("same-room-share");
    expect(service.updateState("viewer", { muted: false, deafened: false, viewingScreenShareUserId: "other-room-share" })?.viewingScreenShareUserId).toBeNull();
  });
});

/** Читает разрешённые источники публикации прямо из выданного JWT: именно эти строки читает LiveKit. */
function grantedSources(token: string): string[] {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Токен без полезной нагрузки");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { video?: { canPublishSources?: string[] } };
  return claims.video?.canPublishSources ?? [];
}
