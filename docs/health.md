# Server version and the `/health` endpoint (English)

OpenCord uses two independent version numbers:

- product version — SemVer from the root `package.json`, shared by OpenCord Client and OpenCord Server;
- `PROTOCOL_VERSION` — the WebSocket contract compatibility number from `@opencord/shared`.

A matching product version does not guarantee protocol compatibility. The client keeps validating `PROTOCOL_VERSION` during `auth.challenge`, while the product version is intended for diagnostics and future update checks.

## Contract

The public `GET /health` returns HTTP 200 as long as the main server and the text circuit are healthy:

```json
{
  "status": "ok",
  "service": "opencord-server",
  "version": "0.1.0-beta.10",
  "releaseChannel": "development",
  "buildCommit": null,
  "protocolVersion": 18,
  "database": "postgres",
  "voice": {
    "status": "degraded",
    "secureTransport": true,
    "maxParticipants": 25,
    "warning": "LiveKit недоступен"
  }
}
```

The exact schema is exported as `serverHealthSchema` from `@opencord/shared`. In a stable build, `buildCommit` contains the first 12 characters of the full Git commit. A development build may return `null`.

The `voice.status: "degraded"` state does not change the overall `status`: a LiveKit failure must not stop the text chat. The endpoint does not publish the deployment ID, hostname, IP addresses, file paths, secrets, or build time.

## Build metadata

`pnpm --filter @opencord/server build` embeds metadata into the JavaScript bundle. For a local build, the `development` channel and an empty commit are used. The publishable `beta` and `stable` channels require a full Git commit. A stable build is run as follows:

```powershell
$env:OPENCORD_RELEASE_CHANNEL = "stable"
$env:OPENCORD_BUILD_COMMIT = "0123456789abcdef0123456789abcdef01234567"
pnpm --filter @opencord/server build
```

A beta or stable build without a full lowercase commit SHA fails with an error. After the build, these values cannot be changed via runtime environment variables.

---

# Версия сервера и endpoint `/health` (Русский)

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
  "version": "0.1.0-beta.10",
  "releaseChannel": "development",
  "buildCommit": null,
  "protocolVersion": 18,
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

---

# 服务器版本与 `/health` 端点 (中文)

OpenCord 使用两个独立的版本号：

- 产品版本 — 来自根目录 `package.json` 的 SemVer，OpenCord Client 与 OpenCord Server 共用；
- `PROTOCOL_VERSION` — 来自 `@opencord/shared` 的 WebSocket 契约兼容性编号。

产品版本一致并不能保证协议兼容。客户端会在 `auth.challenge` 期间继续验证 `PROTOCOL_VERSION`，而产品版本用于诊断和未来的更新检查。

## 契约

公开的 `GET /health` 只要主服务器和文本回路健康，就会返回 HTTP 200：

```json
{
  "status": "ok",
  "service": "opencord-server",
  "version": "0.1.0-beta.10",
  "releaseChannel": "development",
  "buildCommit": null,
  "protocolVersion": 18,
  "database": "postgres",
  "voice": {
    "status": "degraded",
    "secureTransport": true,
    "maxParticipants": 25,
    "warning": "LiveKit недоступен"
  }
}
```

精确的 schema 以 `serverHealthSchema` 从 `@opencord/shared` 导出。在 stable 构建中，`buildCommit` 包含完整 Git commit 的前 12 个字符。Development 构建可能返回 `null`。

`voice.status: "degraded"` 状态不会改变总体的 `status`：LiveKit 故障不应使文本聊天停止。该端点不公开 deployment ID、hostname、IP 地址、文件路径、密钥和构建时间。

## 构建元数据

`pnpm --filter @opencord/server build` 会将元数据嵌入 JavaScript bundle。本地构建使用 `development` 频道和空 commit。可发布的 `beta` 和 `stable` 频道需要完整的 Git commit。Stable 构建按如下方式运行：

```powershell
$env:OPENCORD_RELEASE_CHANNEL = "stable"
$env:OPENCORD_BUILD_COMMIT = "0123456789abcdef0123456789abcdef01234567"
pnpm --filter @opencord/server build
```

没有完整小写 commit SHA 的 Beta 或 stable 构建会报错失败。构建完成后，这些值无法通过运行时环境变量更改。
