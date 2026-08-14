# Voice Chat v1 (English)

OpenCord Server remains the source of identity, roles, and permissions. LiveKit is used only as a self-hosted SFU for WebRTC/Opus: the client first obtains a short-lived OpenCord token and then connects to LiveKit directly. Audio and SDP are not transmitted over the OpenCord WebSocket.

## Version boundaries

- For each voice channel a limit from 1 to 25 participants is configured. The next slider position enables an experimental mode without a limit (`∞`); its actual capacity depends on the VPS resources and is not considered guaranteed.
- Only the microphone audio track; camera, screen, LiveKit Data API, recording, and egress are not granted by the token.
- The token is valid for five minutes and is bound to a single room whose name is built only from the server and channel identifiers.
- The first version has no E2EE: the VPS owner controls the SFU. Media between the client and the SFU is protected by DTLS-SRTP, but this is not end-to-end encryption.

## Network

With a domain deployment, the client uses `wss://voice.<домен>`. Caddy issues a TLS certificate and proxies signaling to the LiveKit container. ICE/TURN requires externally reachable UDP `3478`, TCP `7881`, and UDP `50000–50200`.

In IP/WSL mode, `ws://<адрес>:7880` is available; the OpenCord interface marks this mode as insecure because the token and signaling are subject to MITM. Behind a strict NAT or a corporate firewall, voice may not work without TURN/TLS.

The LiveKit webhook is accepted only on an internal OpenCord route and is deliberately blocked by the public Caddy. It is signed with an API secret; the events support presence in the channel. When LiveKit is unavailable, text chat keeps working and the snapshot reports the `degraded` state.

Since protocol v14, voice presence also contains the `muted` and `deafened` states. The client sends them over the controlling OpenCord WebSocket after actually entering the LiveKit room, and the server broadcasts the update to all participants. These fields are needed only for the interface; the audio stream is not transmitted over the OpenCord WebSocket. Avatar, name, description, and banner are still taken from the participant's public profile on OpenCord Server and are not duplicated in LiveKit.

## Management

`VOICE_CONNECT` and `VOICE_SPEAK` are granted to participants, `VOICE_MODERATE` to administrators and the owner. An administrator can mute a regular participant; the owner can mute anyone else. The client has no LiveKit room-admin grants.

A Docker deployment creates a separate LiveKit container and stores its API key/secret as Docker secrets. `sudo opencordctl restart` restarts both OpenCord Server and LiveKit; `status` shows the containers together.

The native installer does not yet include LiveKit: it needs a verified Caddy-L4/LiveKit binary bundle that must be built and signed by the release pipeline. Therefore in native mode the voice capability stays `disabled` rather than being simulated as a working feature.

---

# Голосовой чат v1 (Русский)

OpenCord Server остаётся источником идентичности, ролей и прав. LiveKit используется только как self-hosted SFU для WebRTC/Opus: клиент сначала получает короткоживущий токен OpenCord, а затем соединяется с LiveKit напрямую. Аудио и SDP через WebSocket OpenCord не передаются.

## Границы версии

- Для каждого голосового канала настраивается лимит от 1 до 25 участников. Следующая позиция слайдера включает экспериментальный режим без ограничения (`∞`); фактическая вместимость в нём зависит от ресурсов VPS и не считается гарантированной.
- Только микрофонный аудиотрек; камера, экран, LiveKit Data API, запись и egress не выдаются токеном.
- Токен действует пять минут и связан с одной комнатой, имя которой построено только из идентификаторов сервера и канала.
- В первой версии нет E2EE: владелец VPS контролирует SFU. Медиа между клиентом и SFU защищено DTLS-SRTP, но это не сквозное шифрование.

## Сеть

При доменном развёртывании клиент использует `wss://voice.<домен>`. Caddy выпускает TLS-сертификат и проксирует сигналинг к контейнеру LiveKit. Для ICE/TURN необходимы доступные извне UDP `3478`, TCP `7881` и UDP `50000–50200`.

В режиме IP/WSL доступен `ws://<адрес>:7880`; интерфейс OpenCord помечает такой режим как небезопасный, потому что токен и сигналинг подвержены MITM. За строгим NAT или корпоративным firewall голос может не заработать без TURN/TLS.

Вебхук LiveKit принимается только на внутреннем маршруте OpenCord и намеренно блокируется публичным Caddy. Он подписан API secret; события поддерживают присутствие в канале. При недоступности LiveKit текстовый чат продолжает работать, а snapshot сообщает состояние `degraded`.

С протокола v14 голосовое присутствие также содержит состояния `muted` и `deafened`. Клиент отправляет их через управляющий WebSocket OpenCord после фактического входа в LiveKit-комнату, а сервер рассылает обновление всем участникам. Эти поля нужны только для интерфейса; аудиопоток через OpenCord WebSocket не передаётся. Аватар, имя, описание и шапка по-прежнему берутся из публичного профиля участника на OpenCord Server и не дублируются в LiveKit.

## Управление

`VOICE_CONNECT` и `VOICE_SPEAK` выдаются участникам, `VOICE_MODERATE` — администраторам и владельцу. Администратор может отключить обычного участника; владелец — любого другого. У клиента нет LiveKit room-admin grants.

Docker-развёртывание создаёт отдельный контейнер LiveKit и хранит его API key/secret как Docker secrets. `sudo opencordctl restart` перезапускает и OpenCord Server, и LiveKit; `status` показывает контейнеры вместе.

Нативный установщик пока не включает LiveKit: ему нужен проверенный бинарный bundle Caddy-L4/LiveKit, который должен собираться и подписываться release pipeline. Поэтому при native-режиме голосовой capability остаётся `disabled`, а не имитируется как рабочая функция.

---

# 语音聊天 v1 (中文)

OpenCord Server 仍然是身份、角色和权限的来源。LiveKit 仅用作 WebRTC/Opus 的自托管 SFU：客户端先获取一个短生命周期的 OpenCord 令牌，然后直接连接到 LiveKit。音频和 SDP 不会通过 OpenCord WebSocket 传输。

## 版本边界

- 每个语音频道都配置有 1 到 25 名参与者的限制。滑块的下一个位置会启用无限制的实验模式（`∞`）；该模式下的实际容量取决于 VPS 的资源，且不视为有保证。
- 仅限麦克风音轨；摄像头、屏幕、LiveKit Data API、录制和 egress 均不由令牌授予。
- 令牌有效期为五分钟，并且只绑定到一个房间，该房间的名称仅由服务器和频道的标识符构成。
- 第一版没有 E2EE：VPS 所有者控制 SFU。客户端与 SFU 之间的媒体受 DTLS-SRTP 保护，但这并非端到端加密。

## 网络

在域名部署中，客户端使用 `wss://voice.<домен>`。Caddy 签发 TLS 证书并将信令代理到 LiveKit 容器。ICE/TURN 需要可从外部访问的 UDP `3478`、TCP `7881` 和 UDP `50000–50200`。

在 IP/WSL 模式下，可使用 `ws://<адрес>:7880`；OpenCord 界面会将此模式标记为不安全，因为令牌和信令容易受到 MITM 攻击。在严格 NAT 或企业防火墙之后，如果没有 TURN/TLS，语音可能无法工作。

LiveKit webhook 仅在 OpenCord 的内部路由上被接受，并且会被公共 Caddy 有意阻止。它使用 API secret 签名；事件支持频道内的在场状态。当 LiveKit 不可用时，文本聊天继续工作，而 snapshot 报告 `degraded` 状态。

自协议 v14 起，语音在场状态还包含 `muted` 和 `deafened` 状态。客户端在实际进入 LiveKit 房间后，通过 OpenCord 控制 WebSocket 发送它们，服务器会将该更新广播给所有参与者。这些字段仅用于界面；音频流不会通过 OpenCord WebSocket 传输。头像、名称、描述和横幅仍然取自参与者在 OpenCord Server 上的公共资料，并且不会在 LiveKit 中重复存储。

## 管理

`VOICE_CONNECT` 和 `VOICE_SPEAK` 授予给参与者，`VOICE_MODERATE` 授予给管理员和所有者。管理员可以静音普通参与者；所有者可以静音其他任何人。客户端没有 LiveKit room-admin grants。

Docker 部署会创建一个单独的 LiveKit 容器，并将其 API key/secret 存储为 Docker secrets。`sudo opencordctl restart` 会同时重启 OpenCord Server 和 LiveKit；`status` 会一并显示这些容器。

原生安装程序目前尚未包含 LiveKit：它需要经过验证的 Caddy-L4/LiveKit 二进制包，该包必须由 release pipeline 构建并签名。因此，在原生模式下，语音 capability 保持为 `disabled`，而不会被伪装成可正常工作的功能。
