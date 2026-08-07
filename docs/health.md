# Версия сервера и endpoint `/health`

OpenCord использует два независимых номера версии:

- версия продукта — SemVer из корневого `package.json`, общая для OpenCord Client и OpenCord Server;
- `PROTOCOL_VERSION` — номер совместимости WebSocket-контракта из `@opencord/shared`.

Совпадение версии продукта не гарантирует совместимость протокола. Клиент продолжает проверять `PROTOCOL_VERSION` во время `auth.challenge`, а версия продукта предназначена для диагностики и будущей проверки обновлений.

## Контракт

Публичный `GET /health` возвращает HTTP 200, пока основной сервер и текстовый контур работоспособны:

```json
{
  "status": "ok",
  "service": "opencord-server",
  "version": "0.1.0-beta.8",
  "releaseChannel": "development",
  "buildCommit": null,
  "protocolVersion": 16,
  "database": "postgres",
  "voice": {
    "status": "degraded",
    "secureTransport": true,
    "maxParticipants": 25,
    "warning": "LiveKit недоступен"
  }
}
```

Точная схема экспортируется как `serverHealthSchema` из `@opencord/shared`. В stable-сборке `buildCommit` содержит первые 12 символов полного Git commit. Development-сборка может возвращать `null`.

Состояние `voice.status: "degraded"` не изменяет общий `status`: отказ LiveKit не должен останавливать текстовый чат. Endpoint не публикует deployment ID, hostname, IP-адреса, файловые пути, секреты и время сборки.

## Метаданные сборки

`pnpm --filter @opencord/server build` встраивает метаданные в JavaScript bundle. Для локальной сборки используются канал `development` и пустой commit. Публикуемые каналы `beta` и `stable` требуют полный Git commit. Stable-сборка запускается так:

```powershell
$env:OPENCORD_RELEASE_CHANNEL = "stable"
$env:OPENCORD_BUILD_COMMIT = "0123456789abcdef0123456789abcdef01234567"
pnpm --filter @opencord/server build
```

Beta- или stable-сборка без полного lowercase commit SHA завершается ошибкой. После сборки эти значения нельзя изменить runtime-переменными окружения.
