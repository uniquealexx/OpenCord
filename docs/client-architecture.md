# OpenCord Client Architecture (English)

## Current Status

The client remains an early Windows prototype, but it already connects to the OpenCord Server over WebSocket, proves its Ed25519 identity, works with server-side message history, and deploys a single server instance to an Ubuntu VPS over SSH. The connection is kept alive by heartbeat events and is restored with capped exponential backoff. The voice infrastructure is not implemented yet.

## Processes

- **Electron main** manages the window, local state, the protected identity key, the limited SSH deployment operation, and prioritized streaming of user-selected attachments.
- **Preload** exposes only typed operations for the window, storage, challenge signing, and the deployment wizard.
- **Next.js renderer** renders the interface, locally crops and compresses selected avatars and banners via Canvas, and has no access to Node.js, the file system, or arbitrary IPC.

In production and current Windows development, Next.js is built as a static export. No Next server runs on the user's device. This temporarily removes renderer hot reload, but ensures the dev launch and the installer behave identically; the server side keeps running via `tsx watch`.

After the main window is created, Electron creates an OpenCord icon in the system tray. Normal window close, including the button in the custom title bar, hides the window and keeps the client, connections, and voice session running. The window returns on a click on the icon or via the "Open OpenCord" item. Full exit happens only via the "Quit" item in the tray menu, an update install, or an explicit process termination; before exiting, the existing cleanup of temporary resources is preserved.

## Mobile prototype (Android)

An Android prototype wraps the same static renderer in a Capacitor 8 WebView (`client/android/`, config in `client/capacitor.config.ts`). Electron cannot produce an APK, so the renderer is reused as-is and only the native layer is replaced: the desktop preload bridge (`window.openCord`) has a mobile implementation in `client/src/platform/` — Ed25519 identity via WebCrypto with the private key in Android Keystore (`@aparajita/capacitor-secure-storage`), client state in validated `localStorage`, attachments and the `/health` probe through native `CapacitorHttp` (CORS does not apply, so the server is unchanged). The desktop-only surfaces (`window`, `deployment`, `screenShare`, `updates`) are intentionally absent, and the VPS deployment entry point is hidden on mobile. The channel list and member list become overlays on narrow screens. Details, threat model, and limitations: `docs/mobile-android-prototype.md`.

## Local State

The `client-state.json` file lives in Electron's system `userData` directory. Data is validated against a Zod schema before writing and after reading. Writes go through a temporary file and an atomic rename. If the JSON is corrupted or does not match the schema, the original file is copied as `client-state.corrupt-<timestamp>.json`, after which a safe initial state is created. Versioned migrations preserve user servers and settings; the v1→v2 migration removes the former built-in `open-space` server and only the local messages associated with it.

The JSON stores the profile, addresses of added servers, their local cache, and UI settings. For servers deployed through the client, non-secret parameters for repeat SSH deployment are also stored: host, port, user, domain, ACME email, install mode, and authentication type. The SSH password, sudo password, passphrase, fingerprint, and private key contents are not stored; before an update, the required secret is selected or entered again. The initial state no longer creates built-in demo servers.

The Ed25519 private key is stored separately in `identity.json` only in encrypted Windows `safeStorage` form. The server receives the public key and the signature of a one-time challenge, but never receives the private key.

## Internationalization

The interface is available in English, Russian, and Chinese. English is the default for fresh installs; the language is stored in `preferences.language` of `client-state.json` (existing states without the field fall back to English) and is switched live from the Settings dialog. The language can also be chosen right on the onboarding screen before the local profile is created, and the Settings dialog is reachable both from the server sidebar and from the home screen. All UI strings live in `client/src/lib/i18n/en.ts` (the canonical dictionary that defines the `Dictionary` type), `ru.ts`, and `zh.ts`, which must mirror the canonical keys via `satisfies Dictionary`. Components read the dictionary through the `useI18n()` hook under the `I18nRoot` provider; event-time and module-level code (connection and voice hooks, image helpers) uses `currentDictionary()`, backed by a module store that `ClientApp` syncs from preferences. Date formatting and locale-aware local search use the active BCP 47 locale, and `I18nRoot` keeps the `lang` attribute of `<html>` in sync. Electron main-process messages and Zod schema validation texts remain untranslated technical strings.

## Security

- `contextIsolation: true`;
- `sandbox: true`;
- `nodeIntegration: false`;
- external navigation is blocked, HTTPS links open in the system browser;
- preload does not expose `ipcRenderer` wholesale;
- the renderer does not receive the path to the selected file: system dialogs and attachment reads and writes happen in main, and preload accepts only a validated server context and public metadata;
- attachments from 8 MiB go through a single Electron main queue. Speed is capped at 8 MiB/s outside a voice session and 2 MiB/s during connecting, talking, or reconnecting, so that HTTP transfer does not crowd out WebSocket, LiveKit, and voice packets. When a voice connection starts, an already active transfer is dynamically slowed down. The limit uses Node streams backpressure and does not buffer a heavy file entirely;
- the renderer requests media previews lazily with a 360-pixel margin around the viewport. Therefore opening a long history does not start parallel downloading of all videos it contains;
- PNG, JPEG, GIF, and WebP images, as well as MP4, WebM, and OGG videos, are downloaded for preview by the authorized main process, checked by size and SHA-256, and passed to the renderer as a restricted data URL; photos open in a modal and fullscreen viewer, video plays in Electron's native HTML5 player in the message and in fullscreen, and other formats are shown only as files for download;
- all storage payloads are validated in the renderer, preload, and main.
- the VPS host key is verified against an explicitly confirmed SHA256 fingerprint;
- the renderer receives only a one-time identifier for the selected SSH key, not the path or file contents;
- the install bundle is built from a fixed manifest and does not include `.env`, user data, or secrets;
- the install command is built from validated fields with POSIX quoting, and passwords are not included in the command line or persistent state.
- after fingerprint confirmation, a separate SSH preflight checks the OS, `systemd`, Docker Compose, and ports;
- the domain and ACME email are provided only as a pair; without them, the renderer requires separate risk confirmation, and main launches the explicitly labeled `--insecure` HTTP mode on port 3210;
- Docker and native are explicit modes: the absence of Docker does not let the client silently switch the install method;
- native updates create separate release directories and roll back the symlink when the healthcheck fails.

Resetting the key creates a new identity and does not restore access to the previous server profile. Backup export is not implemented yet.

## Commands

From the repository root:

```bash
pnpm dev          # Next dev server + Electron
pnpm lint
pnpm typecheck
pnpm test
pnpm build        # static renderer + Electron main/preload
pnpm package:win  # Windows x64 NSIS installer
pnpm android:debug # Android debug APK (Capacitor shell)
```

---

# Архитектура OpenCord Client (Русский)

## Текущий статус

Клиент остаётся ранним Windows-прототипом, но уже подключается к OpenCord Server по WebSocket, подтверждает Ed25519-идентичность, работает с серверной историей сообщений и развёртывает один экземпляр сервера на Ubuntu VPS по SSH. Соединение поддерживается heartbeat-событиями и восстанавливается с ограниченной экспоненциальной задержкой. Голосовая инфраструктура ещё не реализована.

## Процессы

- **Electron main** управляет окном, локальным состоянием, защищённым ключом идентичности, ограниченной SSH-операцией развёртывания и приоритетной потоковой передачей выбранных пользователем вложений.
- **Preload** публикует только типизированные операции окна, хранилища, подписи challenge и мастера развёртывания.
- **Next.js renderer** отображает интерфейс, локально кадрирует и сжимает выбранные аватары и шапки через Canvas и не имеет доступа к Node.js, файловой системе или произвольному IPC.

В production и текущем Windows development Next.js собирается как static export. Next-сервер на устройстве пользователя не запускается. Это временно исключает hot reload renderer, но обеспечивает одинаковое поведение dev-запуска и установщика; серверная часть продолжает работать через `tsx watch`.

После создания основного окна Electron создаёт значок OpenCord в системном трее. Обычное закрытие окна, включая кнопку в собственной строке заголовка, скрывает окно и оставляет клиент, соединения и голосовую сессию работающими. Окно возвращается кликом по значку или пунктом «Открыть OpenCord». Полное завершение выполняется только пунктом «Выйти» в меню трея, установкой обновления либо явным завершением процесса; перед выходом сохраняется существующая очистка временных ресурсов.

## Мобильный прототип (Android)

Android-прототип упаковывает тот же статический renderer в WebView Capacitor 8 (`client/android/`, конфиг `client/capacitor.config.ts`). Electron не умеет собирать APK, поэтому renderer переиспользуется без изменений, а заменяется только нативный слой: у десктопного preload-моста (`window.openCord`) появилась мобильная реализация в `client/src/platform/` — Ed25519-идентичность через WebCrypto с приватным ключом в Android Keystore (`@aparajita/capacitor-secure-storage`), состояние клиента в валидируемом `localStorage`, вложения и проверка `/health` через нативный `CapacitorHttp` (CORS не применяется, сервер не меняется). Desktop-only поверхности (`window`, `deployment`, `screenShare`, `updates`) намеренно отсутствуют, точка входа развёртывания VPS на мобильных скрыта. Список каналов и список участников на узких экранах становятся накладками. Подробности, модель угроз и ограничения: `docs/mobile-android-prototype.md`.

## Локальное состояние

Файл `client-state.json` находится в системном каталоге Electron `userData`. Перед записью и после чтения данные проверяются Zod-схемой. Запись выполняется через временный файл и атомарное переименование. Если JSON повреждён или не соответствует схеме, исходный файл копируется как `client-state.corrupt-<timestamp>.json`, после чего создаётся безопасное начальное состояние. Версионированные миграции сохраняют пользовательские серверы и настройки; миграция v1→v2 удаляет прежний встроенный сервер `open-space` и только связанные с ним локальные сообщения.

В JSON сохраняются профиль, адреса добавленных серверов, их локальный кэш и UI-настройки. Для серверов, развёрнутых через клиент, также сохраняются несекретные параметры повторного SSH-развёртывания: host, порт, пользователь, домен, ACME email, режим установки и тип аутентификации. SSH-пароль, sudo-пароль, passphrase, fingerprint и содержимое приватного ключа не сохраняются; перед обновлением нужный секрет выбирается или вводится заново. Встроенных демонстрационных серверов начальное состояние больше не создаёт.

Ed25519-приватный ключ хранится отдельно в `identity.json` только в зашифрованном Windows `safeStorage` виде. Сервер получает публичный ключ и подпись одноразового challenge, но никогда не получает приватный ключ.

## Интернационализация

Интерфейс доступен на английском, русском и китайском языках. Для новых установок по умолчанию выбран английский; язык хранится в `preferences.language` файла `client-state.json` (существующие состояния без поля получают английский) и переключается на лету в диалоге настроек. Язык также можно выбрать прямо на экране первого запуска, до создания локального профиля, а диалог настроек доступен и из сайдбара сервера, и с главного экрана. Все строки интерфейса лежат в `client/src/lib/i18n/en.ts` (канонический словарь, определяющий тип `Dictionary`), `ru.ts` и `zh.ts`, которые обязаны зеркалить канонические ключи через `satisfies Dictionary`. Компоненты читают словарь через хук `useI18n()` под провайдером `I18nRoot`; код вне React-дерева (хуки соединения и голоса, помощники изображений) использует `currentDictionary()` на базе модульного хранилища, которое `ClientApp` синхронизирует из настроек. Форматирование дат и локальный поиск с учётом регистра используют активную BCP 47-локаль, а `I18nRoot` поддерживает атрибут `lang` у `<html>`. Сообщения главного процесса Electron и тексты валидации Zod-схем остаются непереведёнными техническими строками.

## Безопасность

- `contextIsolation: true`;
- `sandbox: true`;
- `nodeIntegration: false`;
- внешняя навигация блокируется, HTTPS-ссылки открываются системным браузером;
- preload не раскрывает `ipcRenderer` целиком;
- renderer не получает путь к выбранному файлу: системные диалоги, чтение и запись вложений выполняются в main, а preload принимает только валидированный контекст сервера и публичные метаданные;
- вложения от 8 МиБ проходят через единую очередь Electron main. Скорость ограничивается 8 МиБ/с вне голосовой сессии и 2 МиБ/с во время подключения, разговора или переподключения, чтобы HTTP-передача не вытесняла WebSocket, LiveKit и голосовые пакеты. При начале голосового подключения уже активная передача динамически замедляется. Ограничение использует backpressure Node streams и не буферизует тяжёлый файл целиком;
- renderer запрашивает медиа-превью лениво с запасом 360 пикселей вокруг viewport. Поэтому открытие длинной истории не запускает параллельное скачивание всех содержащихся в ней видео;
- изображения PNG, JPEG, GIF и WebP, а также видео MP4, WebM и OGG загружаются для предпросмотра авторизованным main-процессом, проверяются по размеру и SHA-256 и передаются renderer как ограниченный data URL; фото открываются в модальном и полноэкранном просмотрщике, видео воспроизводится нативным HTML5-плеером Electron в сообщении и в полноэкранном режиме, а остальные форматы отображаются только как файлы для скачивания;
- все payload хранилища валидируются в renderer, preload и main.
- host key VPS проверяется по явно подтверждённому SHA256 fingerprint;
- renderer получает только одноразовый идентификатор выбранного SSH-ключа, а не путь или содержимое файла;
- установочный bundle формируется по фиксированному manifest и не включает `.env`, пользовательские данные или secrets;
- команда установки строится из валидированных полей с POSIX quoting, а пароли не включаются в командную строку или постоянное состояние.
- после подтверждения fingerprint отдельный SSH preflight проверяет ОС, `systemd`, Docker Compose и порты;
- домен и ACME email передаются только парой; без них renderer требует отдельного подтверждения риска, а main запускает явно обозначенный HTTP-режим `--insecure` на порту 3210;
- Docker и native являются явными режимами: отсутствие Docker не разрешает клиенту молча сменить способ установки;
- нативные обновления создают отдельные release-каталоги и откатывают symlink при неуспешном healthcheck.

Сброс ключа создаёт новую идентичность и не восстанавливает доступ к прежнему серверному профилю. Экспорт резервной копии пока не реализован.

## Команды

Из корня репозитория:

```bash
pnpm dev          # Next dev server + Electron
pnpm lint
pnpm typecheck
pnpm test
pnpm build        # static renderer + Electron main/preload
pnpm package:win  # Windows x64 NSIS installer
pnpm android:debug # Android debug APK (Capacitor shell)
```

---

# OpenCord 客户端架构 (中文)

## 当前状态

客户端仍是一个早期的 Windows 原型，但已经能够通过 WebSocket 连接到 OpenCord Server、证明 Ed25519 身份、使用服务器端消息历史，并通过 SSH 在 Ubuntu VPS 上部署一个服务器实例。连接通过 heartbeat 事件保持，并以受限的指数退避方式恢复。语音基础设施尚未实现。

## 进程

- **Electron main** 管理窗口、本地状态、受保护的身份密钥、受限的 SSH 部署操作以及用户所选附件的优先流式传输。
- **Preload** 仅公开窗口、存储、challenge 签名和部署向导的类型化操作。
- **Next.js renderer** 渲染界面，通过 Canvas 在本地裁剪和压缩所选头像与横幅，且无权访问 Node.js、文件系统或任意 IPC。

在 production 和当前 Windows 开发环境中，Next.js 以 static export 方式构建。用户的设备上不会启动 Next 服务器。这暂时取消了渲染进程的 hot reload，但确保了开发启动与安装程序行为一致；服务器端继续通过 `tsx watch` 运行。

创建主窗口后，Electron 会在系统托盘中创建 OpenCord 图标。窗口的正常关闭（包括自定义标题栏中的按钮）会隐藏窗口，并让客户端、连接和语音会话继续运行。点击图标或选择「打开 OpenCord」即可恢复窗口。只有通过托盘菜单中的「退出」、安装更新或显式终止进程才会完全退出；退出前会保留现有的临时资源清理。

## 移动端原型（Android）

Android 原型将同一个静态 renderer 打包进 Capacitor 8 WebView（`client/android/`，配置见 `client/capacitor.config.ts`）。Electron 无法生成 APK，因此 renderer 原样复用，仅替换原生层：桌面 preload 桥（`window.openCord`）在 `client/src/platform/` 中有移动端实现——通过 WebCrypto 生成 Ed25519 身份、私钥保存在 Android Keystore（`@aparajita/capacitor-secure-storage`），客户端状态保存在经过校验的 `localStorage` 中，附件与 `/health` 探测通过原生 `CapacitorHttp`（不受 CORS 限制，服务器无需改动）。仅桌面端可用的接口（`window`、`deployment`、`screenShare`、`updates`）被有意省略，VPS 部署入口在移动端隐藏。频道列表和成员列表在窄屏上变为覆盖层。详情、威胁模型与限制见 `docs/mobile-android-prototype.md`。

## 本地状态

`client-state.json` 文件位于 Electron 的系统 `userData` 目录中。写入前和读取后都会用 Zod 模式校验数据。写入通过临时文件和原子重命名完成。如果 JSON 损坏或不符合模式，原始文件会被复制为 `client-state.corrupt-<timestamp>.json`，随后创建安全的初始状态。带版本的迁移会保留用户服务器和设置；v1→v2 迁移会删除先前内置的 `open-space` 服务器以及仅与其关联的本地消息。

JSON 中保存着个人资料、已添加服务器的地址、它们的本地缓存和 UI 设置。对于通过客户端部署的服务器，还会保存用于重复 SSH 部署的非机密参数：host、端口、用户、域名、ACME email、安装模式和认证类型。SSH 密码、sudo 密码、passphrase、fingerprint 以及私钥内容不会被保存；更新前需要重新选择或输入所需的密钥。初始状态不再创建内置的演示服务器。

Ed25519 私钥以加密的 Windows `safeStorage` 形式单独存储在 `identity.json` 中。服务器会收到公钥和一次性 challenge 的签名，但永远不会收到私钥。

## 国际化

界面提供英语、俄语和中文三种语言。全新安装默认使用英语；语言保存在 `client-state.json` 的 `preferences.language` 中（没有该字段的旧状态会回退为英语），并可在设置对话框中即时切换。也可以在首次启动的引导页面上、创建本地个人资料之前直接选择语言；设置对话框既可以从服务器侧栏打开，也可以从主界面打开。所有界面字符串位于 `client/src/lib/i18n/en.ts`（定义 `Dictionary` 类型的规范字典）、`ru.ts` 和 `zh.ts`，后两者必须通过 `satisfies Dictionary` 与规范键保持一致。组件通过 `I18nRoot` 提供器下的 `useI18n()` 钩子读取字典；React 树之外的代码（连接和语音钩子、图片辅助函数）使用 `currentDictionary()`，其背后是 `ClientApp` 根据偏好同步的模块级存储。日期格式化和区分大小写的本地搜索使用当前 BCP 47 语言区域，`I18nRoot` 会同步 `<html>` 的 `lang` 属性。Electron 主进程消息和 Zod 模式校验文本仍为未翻译的技术字符串。

## 安全

- `contextIsolation: true`;
- `sandbox: true`;
- `nodeIntegration: false`;
- 阻止外部导航，HTTPS 链接在系统浏览器中打开；
- preload 不会完整暴露 `ipcRenderer`；
- 渲染进程不会收到所选文件的路径：系统对话框以及附件的读取和写入在 main 中完成，preload 只接受经过校验的服务器上下文和公开元数据；
- 8 MiB 及以上的附件会经过 Electron main 的统一队列。在语音会话之外速度限制为 8 MiB/s，在连接、通话或重连期间限制为 2 MiB/s，以免 HTTP 传输挤占 WebSocket、LiveKit 和语音数据包。开始语音连接时，已在进行的传输会被动态减速。该限制使用 Node streams 的背压，且不会将大文件整体缓冲；
- 渲染进程会延迟请求媒体预览，并保留 viewport 周围 360 像素的余量。因此打开较长的历史记录不会触发并行下载其中包含的所有视频；
- PNG、JPEG、GIF 和 WebP 图片以及 MP4、WebM 和 OGG 视频由经过授权的 main 进程下载用于预览，按大小和 SHA-256 校验，并以受限的 data URL 传给渲染进程；照片在模态和全屏查看器中打开，视频通过 Electron 的原生 HTML5 播放器在消息中和全屏模式下播放，其余格式仅显示为可下载的文件；
- 所有存储 payload 都在渲染进程、preload 和 main 中校验。
- VPS 的 host key 会通过显式确认的 SHA256 fingerprint 进行校验；
- 渲染进程只会收到所选 SSH 密钥的一次性标识符，而不会收到路径或文件内容；
- 安装 bundle 依据固定的 manifest 生成，不包含 `.env`、用户数据或 secrets；
- 安装命令由经过校验的字段以 POSIX quoting 构建，密码不会出现在命令行或持久状态中。
- 确认 fingerprint 后，单独的 SSH preflight 会检查操作系统、`systemd`、Docker Compose 和端口；
- 域名和 ACME email 只能成对提供；没有它们时，渲染进程会要求单独确认风险，而 main 会在 3210 端口启动明确标注的 `--insecure` HTTP 模式；
- Docker 和 native 是显式模式：缺少 Docker 不允许客户端静默更改安装方式；
- 原生更新会创建单独的 release 目录，并在 healthcheck 失败时回滚 symlink。

重置密钥会创建新的身份，且不会恢复对先前服务器个人资料的访问。备份导出尚未实现。

## 命令

从仓库根目录运行：

```bash
pnpm dev          # Next dev server + Electron
pnpm lint
pnpm typecheck
pnpm test
pnpm build        # static renderer + Electron main/preload
pnpm package:win  # Windows x64 NSIS installer
pnpm android:debug # Android debug APK (Capacitor shell)
```
