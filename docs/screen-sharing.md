# Screen sharing (English)

OpenCord publishes screen sharing as the standard LiveKit tracks `SCREEN_SHARE` and `SCREEN_SHARE_AUDIO`. The feature was introduced in protocol 17: the client and server must be updated together, because previous voice tokens only allowed publishing a microphone.

## Data flow

1. The renderer requests the list of windows and screens from the Electron main process through a narrow IPC bridge.
2. The user explicitly selects the source and whether system audio is needed.
3. The main process stores a one-time permission for 15 seconds and hands the source only to the trusted main renderer frame after a user action.
4. The selected quality sets the actual frame height, while the width is calculated from the source aspect ratio. For example, a 2560×1080 source in 1080p mode is published as 2560×1080, and in 720p mode as 1706×720. The “Source” mode transmits the original frame up to 2560×1440; a larger source is proportionally scaled down to that limit. Sources smaller than the selected quality are not artificially upscaled.
5. The bitrate scales with the actual number of pixels in the frame, so an ultrawide source gets more data than a 16:9 source of the same height.
6. LiveKit publishes VP8 video with simulcast and, if enabled, Windows loopback audio.
7. Receivers explicitly request the HIGH layer of the screen track: rendering through a canvas does not provide the `adaptiveStream` sizing of a regular `<video>`. The canvas keeps the full input resolution without the previous 1920-pixel width limit.

480p, 720p, 1080p, and “Source” (up to 2560×1440) are available at 15, 30, or 60 FPS. The “Text” mode preserves resolution when the network degrades, and the “Motion” mode preserves frame rate. For a 2K source the maximum video bitrate is 16 Mbps; for smaller frames it is proportionally reduced.

The server owner can separately limit the maximum resolution and FPS in the server settings. These values are stored by the server, are included in `server.snapshot`, and limit the options for new screen shares in the official client. An already-running screen share is not automatically restarted. Media tracks are transmitted directly through LiveKit, so this is a client-side policy limit, not protection against a modified client.

## Screen share viewers

When a user opens or closes a screen share, the client syncs `viewingScreenShareUserId` in the voice presence. The OpenCord Server accepts the target only when the presenter and the viewer are in the same voice channel, and then broadcasts the updated presence to all clients. In the room, next to each active screen share and in the open viewer, the viewers' avatars are displayed. This is viewing service state; the video stream itself is still transmitted through LiveKit.

## Security and compatibility boundaries

- An arbitrary `getDisplayMedia` request without prior source selection is rejected.
- Electron grants the system `display-capture` permission only to the trusted renderer; the actual source is still handed out only on a one-time selection. The Chromium `userGesture` flag is not used as an access boundary, because the asynchronous source-selection IPC resets it before the LiveKit call.
- The selected window or screen is not sent to the OpenCord Server. The server receives only the participant ID whose screen share the user is watching, and issues a limited LiveKit token.
- System audio through Electron loopback is designed for Windows. For individual windows its availability depends on Electron/Chromium and the source.
- Screen sharing is protected by the WebRTC/LiveKit transport, but end-to-end encryption in OpenCord is not yet implemented.

---

# Демонстрация экрана (Русский)

OpenCord публикует демонстрацию как стандартные треки LiveKit `SCREEN_SHARE` и `SCREEN_SHARE_AUDIO`. Функция введена в протоколе 17: клиент и сервер должны быть обновлены вместе, поскольку прежние голосовые токены разрешали публиковать только микрофон.

## Поток данных

1. Renderer запрашивает у Electron main process список окон и экранов через узкий IPC-мост.
2. Пользователь явно выбирает источник и необходимость системного звука.
3. Main process сохраняет одноразовое разрешение на 15 секунд и отдаёт источник только доверенному главному renderer frame после пользовательского действия.
4. Выбранное качество задаёт фактическую высоту кадра, а ширина рассчитывается по исходному соотношению сторон. Например, источник 2560×1080 в режиме 1080p публикуется как 2560×1080, а в режиме 720p — как 1706×720. Режим «Источник» передаёт исходный кадр до 2560×1440; более крупный источник пропорционально уменьшается до этого предела. Источники меньше выбранного качества не увеличиваются искусственно.
5. Битрейт масштабируется по реальному числу пикселей кадра, поэтому ультраширокий источник получает больше данных, чем 16:9 с той же высотой.
6. LiveKit публикует VP8-видео с simulcast и, если включено, loopback-аудио Windows.
7. Получатели явно запрашивают HIGH-слой экранного трека: вывод через canvas не предоставляет `adaptiveStream` размер обычного `<video>`. Canvas сохраняет полное входное разрешение без прежнего ограничения шириной 1920 пикселей.

Доступны 480p, 720p, 1080p и «Источник» (до 2560×1440) при 15, 30 или 60 FPS. Режим «Текст» сохраняет разрешение при ухудшении сети, режим «Движение» — частоту кадров. Для 2K-источника верхний видеобитрейт составляет 16 Мбит/с; для меньших кадров он пропорционально уменьшается.

Владелец сервера может отдельно ограничить максимальное разрешение и FPS в настройках сервера. Эти значения хранятся сервером, входят в `server.snapshot` и ограничивают варианты для новых демонстраций в официальном клиенте. Уже запущенная демонстрация автоматически не перезапускается. Медиатреки передаются напрямую через LiveKit, поэтому это ограничение клиентской политики, а не защита от модифицированного клиента.

## Зрители демонстрации

Когда пользователь открывает либо закрывает демонстрацию, клиент синхронизирует `viewingScreenShareUserId` в голосовом presence. OpenCord Server принимает цель только тогда, когда ведущий и зритель находятся в одном голосовом канале, после чего рассылает обновлённый presence всем клиентам. В комнате рядом с каждой активной демонстрацией и в открытом просмотре отображаются аватары зрителей. Это служебное состояние просмотра; сам видеопоток по-прежнему передаётся через LiveKit.

## Границы безопасности и совместимости

- Произвольный запрос `getDisplayMedia` без предварительного выбора источника отклоняется.
- Electron разрешает системное право `display-capture` только доверенному renderer; фактический источник всё равно выдаётся лишь по одноразовому выбору. Флаг Chromium `userGesture` не используется как граница доступа, поскольку асинхронный IPC выбора источника сбрасывает его до вызова LiveKit.
- Выбранное окно или экран не передаётся серверу OpenCord. Сервер получает только идентификатор участника, чью демонстрацию смотрит пользователь, и выдаёт ограниченный LiveKit-токен.
- Системный звук через Electron loopback рассчитан на Windows. Для отдельных окон его доступность зависит от Electron/Chromium и источника.
- Демонстрация защищена транспортом WebRTC/LiveKit, но сквозное шифрование в OpenCord пока не реализовано.

---

# 屏幕共享 (中文)

OpenCord 将屏幕共享作为标准的 LiveKit 轨道 `SCREEN_SHARE` 和 `SCREEN_SHARE_AUDIO` 发布。该功能在协议 17 中引入：客户端和服务器必须一起更新，因为之前的语音令牌只允许发布麦克风。

## 数据流

1. Renderer 通过窄 IPC 桥向 Electron main process 请求窗口和屏幕列表。
2. 用户明确选择来源以及是否需要系统声音。
3. main process 保存 15 秒的一次性授权，并且仅在用户操作后把来源交给受信任的主 renderer frame。
4. 所选质量决定实际帧高，宽度则根据原始宽高比计算。例如，2560×1080 的来源在 1080p 模式下发布为 2560×1080，而在 720p 模式下发布为 1706×720。“来源”模式传输原始帧，最高 2560×1440；更大的来源会按比例缩小到该上限。小于所选质量的来源不会被人工放大。
5. 比特率根据帧的实际像素数缩放，因此超宽来源获得的数据比相同高度的 16:9 来源更多。
6. LiveKit 发布带有 simulcast 的 VP8 视频，并在启用时发布 Windows loopback 音频。
7. 接收方明确请求屏幕轨道的 HIGH 层：通过 canvas 渲染不提供普通 `<video>` 的 `adaptiveStream` 尺寸。Canvas 保留完整的输入分辨率，不再受之前 1920 像素宽度的限制。

在 15、30 或 60 FPS 下可选用 480p、720p、1080p 和“来源”（最高 2560×1440）。“文本”模式在网络变差时保留分辨率，“运动”模式保留帧率。对于 2K 来源，最高视频比特率为 16 Mbps；对于较小的帧，它会按比例降低。

服务器所有者可以在服务器设置中单独限制最高分辨率和 FPS。这些值由服务器存储，包含在 `server.snapshot` 中，并限制官方客户端中新屏幕共享的选项。已经运行的屏幕共享不会自动重启。媒体轨道直接通过 LiveKit 传输，因此这是客户端策略限制，而不是针对被修改客户端的防护。

## 屏幕共享观看者

当用户打开或关闭屏幕共享时，客户端会在语音 presence 中同步 `viewingScreenShareUserId`。只有当演示者和观看者位于同一语音频道时，OpenCord Server 才会接受该目标，然后将更新后的 presence 广播给所有客户端。在房间中，每项活跃屏幕共享旁边以及打开的观看界面中都会显示观看者的头像。这是观看的服务状态；视频流本身仍通过 LiveKit 传输。

## 安全与兼容性边界

- 未经事先选择来源的任意 `getDisplayMedia` 请求会被拒绝。
- Electron 仅向受信任的 renderer 授予系统 `display-capture` 权限；实际来源仍然只在一次性选择时才会交出。Chromium 的 `userGesture` 标志不被用作访问边界，因为异步的来源选择 IPC 会在 LiveKit 调用之前将其重置。
- 所选的窗口或屏幕不会发送给 OpenCord 服务器。服务器只收到用户正在观看其屏幕共享的参与者 ID，并签发一个受限的 LiveKit 令牌。
- 通过 Electron loopback 的系统声音面向 Windows 设计。对于单个窗口，其可用性取决于 Electron/Chromium 和来源。
- 屏幕共享受到 WebRTC/LiveKit 传输的保护，但 OpenCord 中的端到端加密尚未实现。
