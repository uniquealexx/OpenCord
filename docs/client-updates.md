# OpenCord Client Updates (English)

The installed Windows x64 client checks for updates via the public GitHub Releases
`uniquealexx/OpenCord`. Development launch and the unpacked `win-unpacked` do not
activate the updater: only an application installed via the NSIS installer can update.

The check is a mandatory startup-gate and runs before the main window opens.
If a newer version of the allowed channel is published, the client automatically downloads
the NSIS installer, verifies it and launches a silent installation without showing the Setup window, followed by an automatic restart. The main
interface cannot be opened on an outdated version. When GitHub is unavailable or a check
error occurs, the user can only retry the operation or exit; there is no hidden bypass.
A development launch bypasses the gate so that local development does not depend on GitHub.

After a successful launch, a manual check remains available in settings for diagnostics,
but the normal mandatory scenario completes entirely before the application opens.

## Channels

- the beta client accepts newer `X.Y.Z-beta.N` and stable releases;
- the stable client accepts only stable releases;
- downgrade is not performed;
- the channel is not stored in the user profile and is determined from the build version.

## Artifact verification

The main process retrieves the list of GitHub Releases and accepts only canonical HTTPS URLs
of the public repository. `release-manifest.json` is validated with a shared Zod schema. Before handing over
control to `electron-updater`, the SHA-256 of its `beta.yml` or `latest.yml` is verified. After
the NSIS installer is downloaded, it is verified again by name, size and SHA-256 from the manifest.
The renderer receives only typed IPC commands for status, check, download and
installation; an arbitrary URL or path to an executable cannot be passed through the preload.

SHA-256 protects against corruption and mismatched artifacts within a trusted GitHub
Release, but does not yet replace a digital signature. Until Windows code signing is set up, when
a new installer is launched Windows may show a SmartScreen warning. Signing
the client and manifest remains the mandatory next hardening step before a stable release.

## Release pipeline

The workflow for the `v*` tag first creates a draft GitHub Release with the server bundle, then on a
Windows runner builds the NSIS installer, blockmap and update metadata. The script adds their
SHA-256 and sizes to the shared release manifest. The draft is published only after a successful
build of both parts, so the client does not see a partially built new release. After
publishing the shared release, the workflow also creates a separate server-only release with the tag
`server-v<version>` and copies of the server bundle, `.sha256` and the final manifest.

---

# Обновления OpenCord Client (Русский)

Установленный Windows x64 клиент проверяет обновления через публичные GitHub Releases
`uniquealexx/OpenCord`. Development-запуск и распакованный `win-unpacked` updater не
активируют: обновляться может только приложение, установленное NSIS installer-ом.

Проверка является обязательным startup-gate и выполняется до открытия основного окна.
Если опубликована более новая версия разрешённого канала, клиент автоматически скачивает
NSIS installer, проверяет его и запускает тихую установку без отображения окна Setup с последующим автоматическим перезапуском. Основной
интерфейс нельзя открыть на устаревшей версии. При недоступности GitHub или ошибке
проверки пользователь может только повторить операцию либо выйти; скрытого обхода нет.
Development-запуск обходит gate, чтобы локальная разработка не зависела от GitHub.

После успешного запуска ручная проверка остаётся доступной в настройках для диагностики,
но нормальный обязательный сценарий полностью завершается до открытия приложения.

## Каналы

- beta-клиент принимает более новые `X.Y.Z-beta.N` и stable-релизы;
- stable-клиент принимает только stable-релизы;
- downgrade не выполняется;
- канал не сохраняется в пользовательском профиле и определяется из версии сборки.

## Проверка артефактов

Main-процесс получает список GitHub Releases и принимает только канонические HTTPS URL
публичного репозитория. `release-manifest.json` проверяется общей Zod-схемой. До передачи
управления `electron-updater` проверяется SHA-256 его `beta.yml` или `latest.yml`. После
загрузки NSIS installer повторно проверяется по имени, размеру и SHA-256 из manifest.
Renderer получает только типизированные IPC-команды состояния, проверки, загрузки и
установки; произвольный URL или путь к исполняемому файлу передать через preload нельзя.

SHA-256 защищает от повреждения и несоответствия артефактов внутри доверенного GitHub
Release, но пока не заменяет цифровую подпись. До настройки Windows code signing при
запуске нового installer Windows может показывать предупреждение SmartScreen. Подпись
клиента и manifest остаётся обязательным следующим усилением перед стабильным релизом.

## Release pipeline

Workflow для тега `v*` сначала создаёт draft GitHub Release с server bundle, затем на
Windows runner собирает NSIS installer, blockmap и update metadata. Скрипт добавляет их
SHA-256 и размеры в общий release manifest. Draft публикуется только после успешной
сборки обеих частей, поэтому клиент не видит частично собранный новый релиз. После
публикации общего релиза workflow также создаёт отдельный server-only release с тегом
`server-v<version>` и копиями server bundle, `.sha256` и итогового manifest.

---

# OpenCord 客户端更新 (中文)

已安装的 Windows x64 客户端通过公共 GitHub Releases `uniquealexx/OpenCord` 检查更新。
Development 启动和已解压的 `win-unpacked` 不会激活更新器：只有通过 NSIS installer 安装的应用程序才能更新。

检查是强制性的 startup-gate，并在打开主窗口之前执行。
如果发布了允许频道中的更新版本，客户端会自动下载
NSIS installer，对其进行验证，并启动静默安装，不显示 Setup 窗口，随后自动重启。主
界面无法在过时版本上打开。当 GitHub 不可用或检查
出错时，用户只能重试操作或退出；没有隐藏的绕过方式。
Development 启动会绕过该 gate，以便本地开发不依赖 GitHub。

成功启动后，设置中仍可进行手动检查以用于诊断，
但正常的强制性流程会在应用程序打开之前完全结束。

## 频道

- beta 客户端接受更新的 `X.Y.Z-beta.N` 和 stable 版本；
- stable 客户端只接受 stable 版本；
- 不执行 downgrade；
- 频道不保存在用户配置文件中，而是根据构建版本确定。

## 工件验证

Main 进程获取 GitHub Releases 列表，并只接受公共仓库的规范 HTTPS URL。
`release-manifest.json` 通过共享的 Zod schema 进行验证。在将控制权交给
`electron-updater` 之前，会验证其 `beta.yml` 或 `latest.yml` 的 SHA-256。在
下载 NSIS installer 之后，会再次根据 manifest 中的名称、大小和 SHA-256 进行验证。
Renderer 只接收用于状态、检查、下载和
安装的类型化 IPC 命令；无法通过 preload 传递任意 URL 或可执行文件路径。

SHA-256 可防止受信任的 GitHub
Release 内部的工件损坏或不匹配，但尚不能替代数字签名。在配置 Windows code signing 之前，
启动新的 installer 时 Windows 可能显示 SmartScreen 警告。对
客户端和 manifest 进行签名仍然是稳定版本发布前必须执行的下一步加固措施。

## Release pipeline

针对 `v*` 标签的 workflow 首先创建包含 server bundle 的 draft GitHub Release，然后在
Windows runner 上构建 NSIS installer、blockmap 和 update metadata。脚本将它们的
SHA-256 和大小添加到共享的 release manifest 中。只有在
两部分都成功构建后才会发布 draft，因此客户端看不到部分构建的新版本。在
发布共享 release 之后，workflow 还会创建一个单独的 server-only release，其标签为
`server-v<version>`，并附带 server bundle、`.sha256` 和最终 manifest 的副本。
