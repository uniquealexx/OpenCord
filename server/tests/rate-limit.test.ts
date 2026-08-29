import { describe, expect, it } from "vitest";
import { createFloodLimiter } from "../src/rate-limit";

describe("createFloodLimiter", () => {
  it("allows a burst, then blocks until a token refills", () => {
    const limiter = createFloodLimiter({ capacity: 3, refillIntervalMs: 1_000 });
    const start = 10_000;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(limiter.consume("user", start)).toEqual({ allowed: true, retryAfterMs: 0 });
    }
    const blocked = limiter.consume("user", start);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1_000);

    // Через половину интервала ждать остаётся половину.
    expect(limiter.consume("user", start + 500).retryAfterMs).toBe(500);
    expect(limiter.consume("user", start + 1_000)).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("does not let a spamming caller push its own unlock further away", () => {
    const limiter = createFloodLimiter({ capacity: 1, refillIntervalMs: 1_000 });
    const start = 0;
    expect(limiter.consume("user", start).allowed).toBe(true);
    // Отклонённые попытки токенов не тратят, иначе ожидание росло бы бесконечно.
    for (let attempt = 0; attempt < 20; attempt += 1) limiter.consume("user", start + 100);
    expect(limiter.consume("user", start + 1_000).allowed).toBe(true);
  });

  it("keeps identities independent and forgets a key on demand", () => {
    const limiter = createFloodLimiter({ capacity: 1, refillIntervalMs: 1_000 });
    expect(limiter.consume("first", 0).allowed).toBe(true);
    expect(limiter.consume("second", 0).allowed).toBe(true);
    expect(limiter.consume("first", 0).allowed).toBe(false);
    limiter.forget("first");
    expect(limiter.consume("first", 0).allowed).toBe(true);
  });

  it("prunes refilled buckets so idle identities do not accumulate", () => {
    const limiter = createFloodLimiter({ capacity: 2, refillIntervalMs: 10, pruneThreshold: 5 });
    for (let index = 0; index < 20; index += 1) limiter.consume(`user-${index}`, index * 1_000);
    expect(limiter.size()).toBeLessThanOrEqual(5);
  });

  it("rejects nonsensical configuration", () => {
    expect(() => createFloodLimiter({ capacity: 0, refillIntervalMs: 1_000 })).toThrow();
    expect(() => createFloodLimiter({ capacity: 1, refillIntervalMs: 0 })).toThrow();
  });
});
