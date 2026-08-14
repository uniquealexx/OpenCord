import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { PROTOCOL_VERSION, type Attachment } from "@opencord/shared";

const mocks = vi.hoisted(() => ({
  secureValues: new Map<string, string>(),
  secureGetItem: vi.fn(),
  secureSetItem: vi.fn(),
  secureRemoveItem: vi.fn(),
  httpPost: vi.fn(),
  httpGet: vi.fn(),
  nativePlatform: vi.fn(() => true),
}));

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: {
    getItem: (...args: unknown[]) => mocks.secureGetItem(...args),
    setItem: (...args: unknown[]) => mocks.secureSetItem(...args),
    removeItem: (...args: unknown[]) => mocks.secureRemoveItem(...args),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mocks.nativePlatform(),
    getPlatform: () => "android",
  },
  CapacitorHttp: {
    post: (...args: unknown[]) => mocks.httpPost(...args),
    get: (...args: unknown[]) => mocks.httpGet(...args),
  },
}));

import { createMobileBridge } from "@/platform/mobile-bridge";
import { installPlatformBridge, isMobilePlatform } from "@/platform";
import type { OpenCordBridge } from "@/shared/bridge";

const TEST_TOKEN = "a".repeat(64);
const TEST_SERVER = "https://opencord.example.com";
const TEST_ATTACHMENT_ID = "11111111-2222-4333-8444-555555555555";

const validHealth = {
  status: "ok",
  service: "opencord-server",
  version: "0.1.0",
  releaseChannel: "stable",
  buildCommit: "0123456789ab",
  protocolVersion: PROTOCOL_VERSION,
  database: "postgres",
  voice: { status: "available", secureTransport: true, maxParticipants: 25, warning: null },
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  const content = new Uint8Array([1, 2, 3, 4]);
  return {
    id: TEST_ATTACHMENT_ID,
    fileName: "pixel.png",
    mimeType: "image/png",
    sizeBytes: content.length,
    sha256: sha256Hex(content),
    ...overrides,
  };
}

describe("mobile platform bridge", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    localStorage.clear();
    mocks.secureValues.clear();
    mocks.secureGetItem.mockReset().mockImplementation(async (key: string) => mocks.secureValues.get(key) ?? null);
    mocks.secureSetItem.mockReset().mockImplementation(async (key: string, value: string) => { mocks.secureValues.set(key, value); });
    mocks.secureRemoveItem.mockReset().mockImplementation(async (key: string) => { mocks.secureValues.delete(key); });
    mocks.httpPost.mockReset();
    mocks.httpGet.mockReset();
    mocks.nativePlatform.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete window.openCord;
  });

  describe("storage", () => {
    it("returns a default state on the first load and persists it", async () => {
      const bridge = createMobileBridge();
      const state = await bridge.storage.load();
      expect(state.version).toBe(4);
      expect(state.servers).toEqual([]);
      expect(localStorage.getItem("opencord.client-state")).toContain("\"version\":4");
    });

    it("falls back to the default state when stored JSON is corrupted", async () => {
      localStorage.setItem("opencord.client-state", "{not-json");
      const bridge = createMobileBridge();
      const state = await bridge.storage.load();
      expect(state.profile).toBeNull();
      expect(state.onboardingComplete).toBe(false);
    });

    it("round-trips a saved state through load", async () => {
      const bridge = createMobileBridge();
      const initial = await bridge.storage.load();
      const next = await bridge.storage.save({ ...initial, preferences: { ...initial.preferences, compactMode: true } });
      expect(next.preferences.compactMode).toBe(true);
      const loaded = await bridge.storage.load();
      expect(loaded.preferences.compactMode).toBe(true);
    });

    it("reset restores the default state", async () => {
      const bridge = createMobileBridge();
      const initial = await bridge.storage.load();
      await bridge.storage.save({ ...initial, onboardingComplete: true });
      const reset = await bridge.storage.reset();
      expect(reset.onboardingComplete).toBe(false);
    });
  });

  describe("identity", () => {
    it("creates an Ed25519 identity once and stores both keys and the discriminator in secure storage", async () => {
      const bridge = createMobileBridge();
      const identity = await bridge.identity.getOrCreate();
      expect(identity.publicKey.length).toBeGreaterThan(40);
      expect(identity.fingerprint.split("-")).toHaveLength(4);
      expect(identity.discriminator).toMatch(/^\d{4}$/u);
      expect(mocks.secureValues.has("opencord.identity.publicKey")).toBe(true);
      expect(mocks.secureValues.has("opencord.identity.privateKey")).toBe(true);
      expect(mocks.secureValues.has("opencord.identity.discriminator")).toBe(true);

      const again = await bridge.identity.getOrCreate();
      expect(again.publicKey).toBe(identity.publicKey);
      expect(again.discriminator).toBe(identity.discriminator);
      expect(mocks.secureSetItem.mock.calls.length).toBe(3); // пара ключей + дискриминатор, повторной генерации нет
    });

    it("signs a challenge with a raw Ed25519 signature the server can verify", async () => {
      const bridge = createMobileBridge();
      const identity = await bridge.identity.getOrCreate();
      const challengeBytes = new Uint8Array(32).fill(7);
      const challenge = Buffer.from(challengeBytes).toString("base64");
      const signature = await bridge.identity.signChallenge(challenge);

      const publicKey = await webcrypto.subtle.importKey("spki", Buffer.from(identity.publicKey, "base64"), { name: "Ed25519" }, false, ["verify"]);
      const valid = await webcrypto.subtle.verify({ name: "Ed25519" }, publicKey, Buffer.from(signature, "base64"), challengeBytes);
      expect(valid).toBe(true);
    });

    it("rejects malformed challenges", async () => {
      const bridge = createMobileBridge();
      await bridge.identity.getOrCreate();
      await expect(bridge.identity.signChallenge("too-short")).rejects.toThrow();
      // Реализация принимает unknown и валидирует вход; интерфейс моста типизирован строкой.
      const untypedSign = bridge.identity.signChallenge as unknown as (challenge: unknown) => Promise<string>;
      await expect(untypedSign(123)).rejects.toThrow();
      await expect(bridge.identity.signChallenge("!!!!not-base64!!!!")).rejects.toThrow();
    });

    it("rejects signing when the stored private key is invalid", async () => {
      mocks.secureValues.set("opencord.identity.publicKey", Buffer.alloc(44).toString("base64"));
      mocks.secureValues.set("opencord.identity.privateKey", "AAAA");
      const bridge = createMobileBridge();
      const challenge = Buffer.from(new Uint8Array(32).fill(1)).toString("base64");
      await expect(bridge.identity.signChallenge(challenge)).rejects.toThrow();
    });

    it("reset generates a new identity and overwrites the stored keys", async () => {
      const bridge = createMobileBridge();
      const before = await bridge.identity.getOrCreate();
      const after = await bridge.identity.reset();
      expect(after.publicKey).not.toBe(before.publicKey);
      expect(after.discriminator).toMatch(/^\d{4}$/u);
      expect(mocks.secureValues.get("opencord.identity.publicKey")).toBe(after.publicKey);
      expect(mocks.secureValues.get("opencord.identity.discriminator")).toBe(after.discriminator);
    });
  });

  describe("attachments", () => {
    const uploadContext = { serverAddress: TEST_SERVER, sessionToken: TEST_TOKEN, maxAttachmentBytes: 10 * 1024 * 1024, latencySensitive: false };
    const uploadResponse = { id: TEST_ATTACHMENT_ID, fileName: "file.txt", mimeType: "text/plain", sizeBytes: 3, sha256: sha256Hex(new Uint8Array([1, 2, 3])) };

    function mockFilePicker(file: File | null): void {
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
        Object.defineProperty(this, "files", { configurable: true, value: file ? [file] : [] });
        this.dispatchEvent(new Event("change"));
      });
    }

    it("uploads a picked file through CapacitorHttp and parses the attachment", async () => {
      mocks.httpPost.mockResolvedValue({ status: 201, data: uploadResponse });
      mockFilePicker(new File([new Uint8Array([1, 2, 3])], "тест файл.txt", { type: "text/plain" }));

      const bridge = createMobileBridge();
      const result = await bridge.attachments.selectAndUpload(uploadContext);
      expect(result).toEqual(uploadResponse);

      const request = mocks.httpPost.mock.calls[0]![0] as { url: string; headers: Record<string, string>; data: string; dataType: string };
      expect(request.url).toBe(`${TEST_SERVER}/api/attachments`);
      expect(request.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
      expect(request.headers["content-type"]).toBe("application/octet-stream");
      expect(request.headers["x-opencord-file-name"]).toBe(Buffer.from("тест файл.txt", "utf8").toString("base64url"));
      expect(request.headers["x-opencord-mime-type"]).toBe("text/plain");
      expect(request.dataType).toBe("file");
      expect(Buffer.from(request.data, "base64")).toEqual(Buffer.from([1, 2, 3]));
    });

    it("returns null when the user cancels the file picker", async () => {
      mockFilePicker(null);
      const bridge = createMobileBridge();
      const result = await bridge.attachments.selectAndUpload(uploadContext);
      expect(result).toBeNull();
      expect(mocks.httpPost).not.toHaveBeenCalled();
    });

    it("rejects files above the server attachment limit before uploading", async () => {
      mockFilePicker(new File([new Uint8Array(32)], "big.txt"));
      const bridge = createMobileBridge();
      await expect(bridge.attachments.selectAndUpload({ ...uploadContext, maxAttachmentBytes: 16 })).rejects.toThrow(/лимит/u);
      expect(mocks.httpPost).not.toHaveBeenCalled();
    });

    it("surfaces server errors with the server-provided code", async () => {
      mocks.httpPost.mockResolvedValue({ status: 413, data: JSON.stringify({ error: "FILE_TOO_LARGE" }) });
      mockFilePicker(new File([new Uint8Array(3)], "file.txt"));
      const bridge = createMobileBridge();
      await expect(bridge.attachments.selectAndUpload(uploadContext)).rejects.toThrow(/FILE_TOO_LARGE/u);
    });

    it("returns an image preview as a verified data URL", async () => {
      const content = new Uint8Array([1, 2, 3, 4]);
      const base64 = Buffer.from(content).toString("base64");
      mocks.httpGet.mockResolvedValue({ status: 200, headers: {}, data: base64 });

      const bridge = createMobileBridge();
      const result = await bridge.attachments.preview({ serverAddress: TEST_SERVER, sessionToken: TEST_TOKEN, attachment: attachment(), latencySensitive: false });
      expect(result).toBe(`data:image/png;base64,${base64}`);
      expect((mocks.httpGet.mock.calls[0]![0] as { url: string }).url).toBe(`${TEST_SERVER}/api/attachments/${TEST_ATTACHMENT_ID}`);
    });

    it("rejects previews with a mismatched checksum", async () => {
      mocks.httpGet.mockResolvedValue({ status: 200, headers: {}, data: Buffer.from([9, 9, 9, 9]).toString("base64") });
      const bridge = createMobileBridge();
      await expect(bridge.attachments.preview({ serverAddress: TEST_SERVER, sessionToken: TEST_TOKEN, attachment: attachment(), latencySensitive: false })).rejects.toThrow(/Контрольная сумма/u);
    });

    it("does not preview non-image attachments", async () => {
      const bridge = createMobileBridge();
      await expect(bridge.attachments.preview({ serverAddress: TEST_SERVER, sessionToken: TEST_TOKEN, attachment: attachment({ mimeType: "application/pdf" }), latencySensitive: false })).rejects.toThrow(/недоступен/u);
      expect(mocks.httpGet).not.toHaveBeenCalled();
    });

    it("reports downloads as unsupported in the mobile prototype", async () => {
      const bridge = createMobileBridge();
      await expect(bridge.attachments.download({ serverAddress: TEST_SERVER, sessionToken: TEST_TOKEN, attachment: attachment(), latencySensitive: false })).rejects.toThrow(/недоступно/u);
    });
  });

  describe("server probe", () => {
    it("accepts a healthy OpenCord server response", async () => {
      mocks.httpGet.mockResolvedValue({ status: 200, headers: { "content-length": "200" }, data: validHealth });
      const bridge = createMobileBridge();
      const result = await bridge.server!.probe(TEST_SERVER);
      expect(result).toEqual({ ok: true, health: validHealth });
      expect((mocks.httpGet.mock.calls[0]![0] as { url: string }).url).toBe(`${TEST_SERVER}/health`);
    });

    it("marks unreachable servers as unavailable", async () => {
      mocks.httpGet.mockRejectedValue(new Error("network down"));
      const bridge = createMobileBridge();
      await expect(bridge.server!.probe("https://missing.example")).resolves.toEqual({ ok: false, code: "unavailable" });
    });

    it("marks incompatible protocol versions", async () => {
      mocks.httpGet.mockResolvedValue({ status: 200, headers: {}, data: { ...validHealth, protocolVersion: PROTOCOL_VERSION + 1 } });
      const bridge = createMobileBridge();
      await expect(bridge.server!.probe(TEST_SERVER)).resolves.toEqual({ ok: false, code: "incompatible", protocolVersion: PROTOCOL_VERSION + 1 });
    });

    it("marks non-OpenCord responses", async () => {
      mocks.httpGet.mockResolvedValue({ status: 200, headers: {}, data: { hello: "world" } });
      const bridge = createMobileBridge();
      await expect(bridge.server!.probe(TEST_SERVER)).resolves.toEqual({ ok: false, code: "not-opencord" });
    });
  });
});

describe("platform bridge installation", () => {
  beforeEach(() => {
    mocks.nativePlatform.mockReset();
  });

  afterEach(() => {
    delete window.openCord;
    vi.restoreAllMocks();
  });

  it("reports the mobile platform only when Capacitor runs natively on Android", () => {
    mocks.nativePlatform.mockReturnValue(true);
    expect(isMobilePlatform()).toBe(true);
    mocks.nativePlatform.mockReturnValue(false);
    expect(isMobilePlatform()).toBe(false);
  });

  it("installs the mobile bridge in the Capacitor shell", () => {
    mocks.nativePlatform.mockReturnValue(true);
    installPlatformBridge();
    expect(window.openCord?.storage).toBeDefined();
    expect(window.openCord?.identity).toBeDefined();
    expect(window.openCord?.attachments).toBeDefined();
    // Desktop-only поверхности намеренно отсутствуют.
    expect(window.openCord?.window).toBeUndefined();
    expect(window.openCord?.deployment).toBeUndefined();
  });

  it("keeps the Electron preload bridge untouched", () => {
    const electronBridge = { window: { minimize: async () => undefined } } as unknown as OpenCordBridge;
    window.openCord = electronBridge;
    mocks.nativePlatform.mockReturnValue(false);
    installPlatformBridge();
    expect(window.openCord).toBe(electronBridge);
  });

  it("does nothing in a plain browser", () => {
    mocks.nativePlatform.mockReturnValue(false);
    installPlatformBridge();
    expect(window.openCord).toBeUndefined();
  });
});
