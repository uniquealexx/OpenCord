/**
 * Базовая защита от флуда — token bucket на идентичность.
 *
 * Она намеренно не настраивается через UI: медленный режим канала модераторы включают
 * и выключают сами, а этот предел существует, чтобы модифицированный клиент не мог
 * залить сервер сообщениями в цикле. Ключ — пользователь, а не сокет, иначе лимит
 * обходится вторым подключением с тем же ключом.
 */
export interface FloodLimiter {
  /** Списывает попытку. `retryAfterMs` больше нуля только когда запрос отклонён. */
  consume(key: string, now?: number): { allowed: boolean; retryAfterMs: number };
  forget(key: string): void;
  size(): number;
}

export interface FloodLimiterOptions {
  /** Сколько подряд идущих действий допускается, пока корзина полна. */
  capacity: number;
  /** Через сколько миллисекунд восстанавливается одно действие. */
  refillIntervalMs: number;
  /** Порог, после которого при проверке подчищаются восстановившиеся корзины. */
  pruneThreshold?: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function createFloodLimiter(options: FloodLimiterOptions): FloodLimiter {
  const { capacity, refillIntervalMs } = options;
  const pruneThreshold = options.pruneThreshold ?? 1_000;
  if (capacity < 1 || refillIntervalMs <= 0) throw new Error("Некорректные параметры ограничителя");
  const buckets = new Map<string, Bucket>();

  return {
    consume(key, now = Date.now()) {
      const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
      const refilled = Math.min(capacity, bucket.tokens + (now - bucket.updatedAt) / refillIntervalMs);
      if (refilled < 1) {
        // Корзина пуста: продлевать ожидание за каждую отклонённую попытку не нужно,
        // иначе спамящий клиент сам себе бесконечно отодвигает разблокировку.
        buckets.set(key, { tokens: refilled, updatedAt: now });
        return { allowed: false, retryAfterMs: Math.ceil((1 - refilled) * refillIntervalMs) };
      }
      buckets.set(key, { tokens: refilled - 1, updatedAt: now });
      if (buckets.size > pruneThreshold) prune(buckets, capacity, refillIntervalMs, now);
      return { allowed: true, retryAfterMs: 0 };
    },
    forget(key) {
      buckets.delete(key);
    },
    size() {
      return buckets.size;
    },
  };
}

/** Полностью восстановившаяся корзина неотличима от отсутствующей, поэтому её можно забыть. */
function prune(buckets: Map<string, Bucket>, capacity: number, refillIntervalMs: number, now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.tokens + (now - bucket.updatedAt) / refillIntervalMs >= capacity) buckets.delete(key);
  }
}
