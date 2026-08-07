import { PROTOCOL_VERSION } from "@opencord/shared";
import { describe, expect, it, vi } from "vitest";
import { probeOpenCordServer } from "../electron/server-probe";

const health = {
  status: "ok",
  service: "opencord-server",
  version: "0.1.0-beta.9",
  releaseChannel: "development",
  buildCommit: null,
  protocolVersion: PROTOCOL_VERSION,
  database: "pglite",
  voice: { status: "degraded", secureTransport: false, maxParticipants: 25, warning: "LiveKit unavailable" },
};

describe("OpenCord server probe", () => {
  it("accepts only a reachable OpenCord health contract", async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify(health), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(probeOpenCordServer("http://127.0.0.1:3210/anything", fetchImplementation as typeof fetch)).resolves.toEqual({ ok: true, health });
    expect(fetchImplementation).toHaveBeenCalledWith("http://127.0.0.1:3210/health", expect.objectContaining({ redirect: "error" }));
  });

  it("reports unavailable, unrelated, and incompatible servers separately", async () => {
    const unavailable = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    await expect(probeOpenCordServer("https://missing.example", unavailable as typeof fetch)).resolves.toEqual({ ok: false, code: "unavailable" });

    const unrelated = vi.fn(async () => new Response(JSON.stringify({ status: "ok", service: "other" }), { status: 200 }));
    await expect(probeOpenCordServer("https://example.com", unrelated as typeof fetch)).resolves.toEqual({ ok: false, code: "not-opencord" });

    const incompatible = vi.fn(async () => new Response(JSON.stringify({ ...health, protocolVersion: PROTOCOL_VERSION + 1 }), { status: 200 }));
    await expect(probeOpenCordServer("https://example.com", incompatible as typeof fetch)).resolves.toEqual({ ok: false, code: "incompatible", protocolVersion: PROTOCOL_VERSION + 1 });
  });
});
