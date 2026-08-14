# ADR: Android-прототип клиента на Capacitor

- **Статус:** принято (прототип v1)
- **Дата:** 2026
- **Область:** `client/` (Capacitor-оболочка), `docs/`

## Контекст

Требовалось получить работающий Android-прототип OpenCord Client с минимальными изменениями существующего кода. Предполагалось переиспользовать «тот же кросс-платформенный Electron».

**Electron не поддерживает Android и iOS** — он собирает приложения только для десктопных ОС (Windows, macOS, Linux). APK из Electron собрать нельзя в принципе. Поэтому выбран путь, максимально близкий по духу: та же самая Next.js-оболочка упаковывается в WebView через Capacitor, а нативный слой заменяется реализацией того же типизированного моста.

## Решение

Клиентский renderer уже был спроектирован как переносимый статический бандл:

- `client/next.config.ts` использует `output: "export"` и относительные ассеты (`assetPrefix: "./"`) — тот же `out/` грузится и в Electron (`file://`), и в Capacitor (локальный WebView-сервер);
- весь доступ renderer к нативным возможностям проходит через единственный типизированный интерфейс `window.openCord` (`client/src/shared/bridge.ts`) и только через optional chaining — при отсутствии моста UI деградирует до демо-режима;
- сервер ничего не знает о платформе клиента: WebSocket `/ws` (без проверки Origin) + HTTP `/api/attachments` и `/health` с Bearer-токеном. CORS сервера отключён (`origin: false`), поэтому HTTP-вызовы мобильный адаптер выполняет через нативный `CapacitorHttp`, на который CORS не распространяется — **изменения в `server/` и `shared/` не потребовались**.

Состав решения:

1. **Capacitor 8** (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`) упаковывает `out/` в APK; `client/capacitor.config.ts` задаёт `webDir: "out"` и `server.androidScheme: "http"` (происхождение локальной оболочки `http://localhost` — при этом `localhost` остаётся «потенциально доверенным» происхождением, и WebCrypto доступен; подключения к серверам остаются TLS-only, т.к. адреса серверов принимаются только `https://`/`http://` по выбору пользователя).
2. **Платформенный адаптер** `client/src/platform/`:
   - `index.ts` — `installPlatformBridge()`: в Electron мост уже установлен preload; в Capacitor-оболочке устанавливается мобильный мост; в браузере/тестах — no-op. Вызывается на верхнем уровне модуля `client-app.tsx`;
   - `mobile-bridge.ts` — мобильная реализация `OpenCordBridge` (см. ниже).
3. **Мобильная адаптация UI**: строка заголовка окна скрывается (системный статус-бар), список каналов и список участников становятся накладками поверх чата (кнопки в шапке канала), safe-area отступы через `env(safe-area-inset-*)`.
4. **Сборка**: `pnpm --filter @opencord/client android:debug` → `next build` → `cap sync android` → `gradlew assembleDebug` (обёртка `client/scripts/build-android.mjs` находит JDK и SDK).

### Мобильный мост: что реализовано

| Поверхность | Реализация |
|---|---|
| `identity` | Ed25519 через WebCrypto (`generateKey`/`exportKey spki+pkcs8`/`sign` — форматы идентичны тем, что ждёт сервер). Приватный ключ хранится в Android Keystore через `@aparajita/capacitor-secure-storage`. Fallback на незащищённое хранилище отсутствует |
| `storage` | `localStorage` WebView с той же Zod-валидацией (`parsePersistedState`), что у десктопного `ClientStateStore`; повреждённое состояние заменяется безопасным начальным |
| `attachments.selectAndUpload` | `<input type="file">` + `CapacitorHttp.post` (octet-stream, base64 через `dataType: "file"`, заголовки `x-opencord-file-name`/`x-opencord-mime-type`, Bearer-токен, проверка лимита размера) |
| `attachments.preview` | `CapacitorHttp.get` → base64 → проверка размера и SHA-256 → data URL изображений |
| `attachments.download` | Недоступно в v1: выбрасывается понятная ошибка |
| `server.probe` | Общая функция `probeOpenCordServer` (перенесена из `electron/server-probe.ts` в `src/shared/server-probe.ts`, `Buffer` → `TextEncoder`) с шимом fetch поверх `CapacitorHttp` |
| `window`, `deployment`, `screenShare`, `updates` | Намеренно отсутствуют: renderer получает `undefined` и уже корректно это обрабатывает (диалог развёртывания имеет строки «SSH только на десктопе»); кнопка «Развернуть сервер» скрыта на мобильных |

## Отклонённые альтернативы

- **React Native / Expo** — полноценный новый UI-код; переиспользование ограничивается `shared/`. Правильный долгосрочный путь, но не «минимальные добавления».
- **PWA** — нет APK и нет хранилища ключа средствами ОС; WebCrypto в браузере не даёт защищённого at-rest хранения, что нарушает правило идентичности проекта.
- **Flutter** — дублирование Zod-контракта на Dart и расхождение протокола.
- **Tauri 2** — поддерживает Android, но требует Rust-тулчейн и полной замены Electron-оболочки; дороже Capacitor при том же результате для прототипа.

## Модель угроз и безопасность (мобильная идентичность)

- Пара Ed25519 генерируется в WebView (`crypto.subtle`) и экспортируется в форматах PKCS8 (приватный) и SPKI (публичный) base64 — ровно тех форматах, которые проверяет сервер (`server/src/identity.ts`).
- Приватный ключ хранится только в Android Keystore через `@aparajita/capacitor-secure-storage` (шифрование at rest на уровне ОС); публичный ключ хранится там же.
- Приватный ключ никогда не покидает устройство: серверу отправляются публичный ключ и подпись одноразового challenge. Никакого plaintext-fallback нет: при недоступности Keystore-хранилища или отсутствии Ed25519 в WebView операция завершается ошибкой, ключ не создаётся.
- `android:allowBackup="false"` — резервные копии Android не уносят данные приложения (ключа Keystore в них всё равно нет, и восстановление привело бы к нечитаемым данным).
- Ограничение честности: WebView — та же поверхность атаки, что и браузер; хранилище защищено Keystore, но не Secure Enclave/StrongBox-аттестацией. Для прототипа это соответствует уровню десктопа (safeStorage), при переносе на нативный стек уровень повышается.

## Ограничения v1 (осознанные)

- Голос не проверяется в WebView (LiveKit может частично работать, но это не обещается; серверный capability уже отображает статус). Демонстрация экрана скрыта на мобильных.
- Push-уведомления отсутствуют (нет серверного компонента; работает только foreground WebSocket).
- Развёртывание VPS с мобильного недоступно (SSH-инсталлятор остаётся десктопным).
- Скачивание вложений на диск и превью видео не реализованы (загрузка и превью изображений работают).
- Cleartext HTTP разрешён только в debug-сборках (манифест `src/debug/`); release подключается только к `https://`-адресам.
- Ключ не синхронизируется между устройствами: мобильное устройство создаёт собственную идентичность (как и любая новая установка клиента).

## Сборка и запуск

Требования: JDK 17+ (подходит JBR из Android Studio), Android SDK (`ANDROID_HOME`), принятые лицензии SDK.

```bash
cd client
pnpm android:debug   # next build + cap sync android + gradlew assembleDebug
# APK: client/android/app/build/outputs/apk/debug/app-debug.apk
adb install client/android/app/build/outputs/apk/debug/app-debug.apk
```

`client/scripts/build-android.mjs` берёт `JAVA_HOME`/`ANDROID_HOME` из окружения, а на Windows автоматически находит JBR Android Studio и SDK в `%LOCALAPPDATA%\Android\Sdk`.

Отладка против локального сервера (без VPS): запустить сервер с `HOST=0.0.0.0` (`pnpm dev:server` + `HOST=0.0.0.0`), затем в приложении «Подключиться» ввести `http://<LAN-IP>:3000` (debug-сборка разрешает cleartext; WebSocket станет `ws://`). Альтернатива — `adb reverse tcp:3000 tcp:3000` и адрес `http://localhost:3000`. Для production-проверки используется обычный VPS с TLS (`https://…` → `wss://`).

## Тесты

`client/tests/platform-mobile-bridge.test.ts` (25 тестов): storage-адаптер (round-trip, повреждённое состояние, reset), identity (генерация один раз, подпись проверяется через WebCrypto, отказы на некорректных данных, reset), вложения (заголовки и тело запроса, отмена выбора, лимит размера, ошибки сервера, превью с проверкой SHA-256, отказы), probe (healthy/unavailable/incompatible/not-opencord), установка моста (Capacitor-оболочка, сохранение Electron-моста, браузер).
