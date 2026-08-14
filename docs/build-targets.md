# OpenCord client build targets (English)

The desktop client is packaged with electron-builder; the configuration lives in the `build` section
of `client/package.json`. The project is developed on Windows, so this document describes which
targets can be built where and how the release pipeline produces them.

## Target matrix

| Platform | Artifacts | Produced by |
| --- | --- | --- |
| Windows | NSIS installer x64, blockmap, `latest.yml`/`beta.yml` | local Windows build and `windows-2025` CI runner |
| Linux | AppImage and deb x64, `latest-linux.yml` (plus zsync when generated) | WSL2 (Linux host) or the `ubuntu-24.04` CI runner |
| macOS | dmg and zip universal, `latest-mac.yml` | `macos-15` CI runner only |

Neither Linux target builds on Windows: electron-builder 26 assembles the AppImage with the native
`mksquashfs` tool and the deb with the native `fpm` tool, and both exist only for Linux and macOS
hosts. On Windows `pnpm package:linux` fails with instructions. The practical local path is WSL2:
build in a checkout located on the WSL filesystem, because the `/mnt/c` checkout has
Windows-oriented `node_modules`. macOS targets cannot be built on Windows or Linux at all, because
the dmg is created with the macOS-only `hdiutil`; the CI runner is the only build path until a Mac
is available locally.

`npmRebuild` is disabled in the electron-builder config: the client has no required native modules
(`ssh2` uses its optional `cpu-features` binding only as an acceleration, with a pure-JS fallback),
so a cross-platform rebuild step would only fail the packaging.

## Icons

All platforms use `client/build/icon.png` (1024×1024); electron-builder converts it to `.ico` and
`.icns` automatically. The current icon is a generated placeholder and must be replaced with the
real OpenCord logo before a stable release.

## Local builds on Windows

```bash
cd client
pnpm package:win    # OpenCord-Setup-<version>-x64.exe
pnpm package:linux  # AppImage + deb; runs on Linux/macOS hosts only (see below)
```

`pnpm package:mac` builds only on macOS. Linux artifacts are unsigned, like the current NSIS
installer. On Windows the Linux set is built in WSL2: clone the repository inside Ubuntu
(`git clone /mnt/c/Users/<you>/OneDrive/Desktop/OpenCord ~/opencord` also works with a clean working
tree), run `pnpm install --frozen-lockfile` and `pnpm package:linux` there. Smoke-test in the same
WSL2: install the deb with `sudo apt install ./OpenCord-<version>-amd64.deb` and run the AppImage
after `chmod +x`; on Windows 11 WSLg provides the GUI.

## Release pipeline

`.github/workflows/publish-server-image.yml` on a `v*` tag builds all client platforms in parallel
jobs after the server publish job: `publish-client-windows`, `publish-client-linux`,
`publish-client-macos`. Each job uploads its artifacts (including the update metadata
`latest-linux.yml`/`latest-mac.yml`) to the same draft GitHub Release. The `finalize-release` job
publishes the draft only after all three jobs have succeeded, so update clients never observe a
partially built release.

## Signing status

None of the desktop artifacts are signed yet: Windows may show SmartScreen, macOS Gatekeeper warns
about the unsigned dmg (right-click → Open still works). Apple code signing and notarization require
an Apple Developer account and will be added later; Linux artifacts can additionally be signed with
GPG in a later stage. Until then no signature-based security claims are made; integrity of updates
is HTTPS plus the checks described in [client-updates.md](./client-updates.md).

## Updates per install format

- Windows NSIS: mandatory startup gate, verified against `release-manifest.json`.
- macOS: background check after launch and manual check in settings; updates install the zip via
  electron-updater. Untested on real hardware until signing exists.
- Linux AppImage: same flow as macOS using `latest-linux.yml`.
- Linux deb: no self-update mechanism; the settings section shows why updates are disabled.

---

# Цели сборки клиента OpenCord (Русский)

Десктопный клиент упаковывается electron-builder; конфигурация находится в секции `build` файла
`client/package.json`. Проект разрабатывается на Windows, поэтому здесь описано, какие таргеты
можно собирать где и как их производит release pipeline.

## Матрица таргетов

| Платформа | Артефакты | Где собирается |
| --- | --- | --- |
| Windows | NSIS installer x64, blockmap, `latest.yml`/`beta.yml` | локально на Windows и в CI на `windows-2025` |
| Linux | AppImage и deb x64, `latest-linux.yml` (плюс zsync, если создаётся) | WSL2 (Linux-хост) или CI на `ubuntu-24.04` |
| macOS | dmg и zip universal, `latest-mac.yml` | только в CI на `macos-15` |

Ни один Linux-таргет на Windows не собирается: electron-builder 26 собирает AppImage нативным
инструментом `mksquashfs`, а deb — нативным `fpm`; оба существуют только для Linux и macOS. На
Windows `pnpm package:linux` завершается ошибкой с инструкцией. Практичный локальный путь — WSL2:
собирайте в checkout, расположенном в файловой системе WSL, потому что checkout на `/mnt/c`
содержит Windows-ориентированный `node_modules`. macOS-таргеты на Windows и Linux собрать нельзя
вовсе — dmg создаётся утилитой `hdiutil`, доступной только в macOS; до появления Mac единственный
путь сборки — CI runner.

`npmRebuild` в конфиге electron-builder отключён: обязательных нативных модулей у клиента нет
(`ssh2` использует опциональный биндинг `cpu-features` только как ускорение, с чистым JS-фолбэком),
поэтому кросс-платформенный rebuild только ломал бы упаковку.

## Иконки

Все платформы используют `client/build/icon.png` (1024×1024); electron-builder сам конвертирует его
в `.ico` и `.icns`. Текущая иконка — сгенерированный плейсхолдер, до стабильного релиза её нужно
заменить на настоящий логотип OpenCord.

## Локальная сборка на Windows

```bash
cd client
pnpm package:win    # OpenCord-Setup-<version>-x64.exe
pnpm package:linux  # AppImage + deb; выполняется только на Linux/macOS-хостах (см. ниже)
```

`pnpm package:mac` выполняется только на macOS. Linux-артефакты не подписаны — как и текущий NSIS
installer. На Windows набор Linux-сборок получают в WSL2: склонируйте репозиторий внутри Ubuntu
(`git clone /mnt/c/Users/<you>/OneDrive/Desktop/OpenCord ~/opencord` подходит и при чистом рабочем
дереве), выполните там `pnpm install --frozen-lockfile` и `pnpm package:linux`. Там же удобно
проверять результат: deb ставится командой `sudo apt install ./OpenCord-<version>-amd64.deb`,
AppImage запускается напрямую (сначала `chmod +x`); на Windows 11 графику обеспечивает WSLg.

## Release pipeline

`.github/workflows/publish-server-image.yml` при теге `v*` после job публикации сервера параллельно
собирает клиент на всех платформах: `publish-client-windows`, `publish-client-linux`,
`publish-client-macos`. Каждый job загружает свои артефакты (включая update metadata
`latest-linux.yml`/`latest-mac.yml`) в общий draft GitHub Release. Job `finalize-release` публикует
draft только после успеха всех трёх job, поэтому клиенты обновлений никогда не видят частично
собранный релиз.

## Статус подписи

Ни один из десктопных артефактов пока не подписан: Windows может показывать SmartScreen, macOS
Gatekeeper предупреждает о неподписанном dmg (правый клик → «Открыть» по-прежнему работает).
Подпись и нотаризация Apple требуют аккаунта Apple Developer и будут добавлены позже; Linux-артефакты
дополнительно можно подписывать GPG на более позднем этапе. До этого никаких заявлений о безопасности
на основе подписей нет: целостность обновлений — это HTTPS плюс проверки из
[client-updates.md](./client-updates.md).

## Обновления по форматам установки

- Windows NSIS: обязательный startup-gate, проверка по `release-manifest.json`.
- macOS: фоновая проверка после запуска и ручная проверка в настройках; обновление ставит zip через
  electron-updater. На реальном железе не проверено до появления подписи.
- Linux AppImage: тот же поток, что и macOS, через `latest-linux.yml`.
- Linux deb: механизма самообновления нет; в настройках показана причина отключения обновлений.

---

# OpenCord 客户端构建目标 (中文)

桌面客户端使用 electron-builder 打包；配置位于 `client/package.json` 的 `build` section。项目在
Windows 上开发，因此本文档说明哪些目标可以在哪里构建，以及 release pipeline 如何生成它们。

## 目标矩阵

| 平台 | 工件 | 构建位置 |
| --- | --- | --- |
| Windows | NSIS installer x64、blockmap、`latest.yml`/`beta.yml` | 本地 Windows 以及 CI 的 `windows-2025` |
| Linux | AppImage 和 deb x64、`latest-linux.yml`（以及生成时的 zsync） | WSL2（Linux 主机）或 CI 的 `ubuntu-24.04` |
| macOS | dmg 和 zip universal、`latest-mac.yml` | 仅 CI 的 `macos-15` |

两个 Linux 目标都无法在 Windows 上构建：electron-builder 26 使用原生 `mksquashfs` 工具组装
AppImage，使用原生 `fpm` 工具组装 deb，而两者仅存在于 Linux 和 macOS 主机。在 Windows 上
`pnpm package:linux` 会失败并给出说明。实际的本地路径是 WSL2：在位于 WSL 文件系统中的 checkout
内构建，因为 `/mnt/c` 上的 checkout 包含面向 Windows 的 `node_modules`。macOS 目标完全无法在
Windows 或 Linux 上构建，因为 dmg 由仅限 macOS 的 `hdiutil` 创建；在拥有 Mac 之前，CI runner 是
唯一的构建路径。

electron-builder 配置中禁用了 `npmRebuild`：客户端没有必需的原生模块（`ssh2` 仅将可选的
`cpu-features` 绑定用作加速，带有纯 JS 回退），因此跨平台重建只会破坏打包。

## 图标

所有平台使用 `client/build/icon.png`（1024×1024）；electron-builder 会自动将其转换为 `.ico` 和
`.icns`。当前图标是生成的占位符，稳定版本发布前必须替换为真正的 OpenCord 徽标。

## 在 Windows 上本地构建

```bash
cd client
pnpm package:win    # OpenCord-Setup-<version>-x64.exe
pnpm package:linux  # AppImage + deb；仅在 Linux/macOS 主机上运行（见下文）
```

`pnpm package:mac` 只能在 macOS 上执行。Linux 工件未签名——与当前的 NSIS installer 相同。在
Windows 上，Linux 构建集在 WSL2 中完成：在 Ubuntu 内部克隆仓库（工作树干净时
`git clone /mnt/c/Users/<you>/OneDrive/Desktop/OpenCord ~/opencord` 也可行），在那里运行
`pnpm install --frozen-lockfile` 和 `pnpm package:linux`。也可以在同一个 WSL2 中冒烟测试：使用
`sudo apt install ./OpenCord-<version>-amd64.deb` 安装 deb，`chmod +x` 后直接运行 AppImage；
Windows 11 上由 WSLg 提供图形界面。

## Release pipeline

`.github/workflows/publish-server-image.yml` 在推送 `v*` 标签时，在服务器发布 job 之后并行构建所有
客户端平台：`publish-client-windows`、`publish-client-linux`、`publish-client-macos`。每个 job 将
自己的工件（包括 update metadata `latest-linux.yml`/`latest-mac.yml`）上传到同一个 draft GitHub
Release。`finalize-release` job 仅在三个 job 全部成功后发布 draft，因此更新客户端永远不会看到
部分构建的版本。

## 签名状态

所有桌面工件目前均未签名：Windows 可能显示 SmartScreen，macOS Gatekeeper 会对未签名的 dmg 发出
警告（右键 → 打开仍然有效）。Apple 代码签名和公证需要 Apple Developer 账户，将在以后添加；Linux
工件还可以在后续阶段用 GPG 签名。在此之前，不做任何基于签名的安全性声明；更新的完整性基于
HTTPS 以及 [client-updates.md](./client-updates.md) 中描述的检查。

## 各安装格式的更新

- Windows NSIS：强制启动检查，根据 `release-manifest.json` 验证。
- macOS：启动后后台检查以及设置中的手动检查；更新通过 electron-updater 安装 zip。在签名就绪前
  未在真实硬件上验证。
- Linux AppImage：与 macOS 相同的流程，使用 `latest-linux.yml`。
- Linux deb：没有自动更新机制；设置中会显示更新被禁用的原因。
