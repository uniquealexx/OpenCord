import { safeStorage } from "electron";

/**
 * Шифрование состояния клиента ключом ОС (DPAPI в Windows, Keychain в macOS,
 * libsecret/kwallet в Linux) — тем же механизмом, что уже защищает приватный ключ.
 *
 * Вынесено в интерфейс, чтобы `ClientStateStore` не зависел от Electron: тесты и
 * платформы без доступного хранилища ключей подставляют свою реализацию.
 */
export interface StateCipher {
  isAvailable(): boolean;
  encrypt(plainText: string): Buffer;
  decrypt(payload: Buffer): string;
}

export function createSafeStorageCipher(): StateCipher {
  return {
    // Проверяется при каждой записи: в Linux связка ключей может стать доступной позже.
    isAvailable: () => {
      try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
    },
    encrypt: (plainText) => safeStorage.encryptString(plainText),
    decrypt: (payload) => safeStorage.decryptString(payload),
  };
}

/**
 * Запасной вариант, когда хранилище ключей ОС недоступно (например, Linux без
 * связки ключей). Состояние остаётся открытым — как и до шифрования, — но
 * приложение продолжает работать, а не теряет профиль и историю.
 */
export function createPlainTextCipher(): StateCipher {
  return {
    isAvailable: () => false,
    encrypt: (plainText) => Buffer.from(plainText, "utf8"),
    decrypt: (payload) => payload.toString("utf8"),
  };
}
