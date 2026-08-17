import "@testing-library/jest-dom/vitest";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

// Node 26 exposes a configurable localStorage getter that resolves to undefined
// without --localstorage-file and shadows jsdom's implementation.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: createMemoryStorage(),
});
