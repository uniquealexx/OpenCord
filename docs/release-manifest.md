# OpenCord release manifest v1 (English)

`release-manifest.json` describes a single OpenCord release and is the source of metadata for the Electron client and for `opencordctl` automatic updates. Its Zod schema is exported as `releaseManifestSchema` from `@opencord/shared`.

The manifest contains the SemVer product version, the WebSocket protocol version, the Git commit, and verifiable descriptions of the artifacts. The server bundle is required. The GHCR image and Windows client sections are part of schema v1, but have the value `null` until the corresponding release pipelines are implemented.

The development manifest is created with the command:

```bash
pnpm bundle:server
```

The results are placed in the ignored `release/` directory: the archive, the `.sha256` sidecar, and `release-manifest.json`. An individual manifest can be validated with the command `pnpm manifest:validate -- release/release-manifest.json`.

The beta mode is run via `pnpm bundle:server -- --channel beta`, and the stable mode via `pnpm bundle:server -- --channel stable`. Both publishable modes require:

- a clean Git working tree;
- a `vX.Y.Z` tag on the current commit;
- the tag matching the version in the root, client, and server `package.json`;
- the full lowercase Git commit;
- HTTPS links to the canonical GitHub Releases repository.

The beta version has the form `X.Y.Z-beta.N`. The Git tag must exactly match `vX.Y.Z-beta.N`. The stable channel, by contrast, does not allow a prerelease suffix.

The Docker image, server bundle, and Windows client are published by the `.github/workflows/publish-server-image.yml` workflow when any `v*` tag is pushed. The tag must exactly match the version in `package.json`: `vX.Y.Z-beta.N` publishes the `beta` channel, and `vX.Y.Z` publishes `stable`; other prerelease suffixes are rejected. For a beta release, GHCR tags for the exact version, `beta`, `latest`, and the immutable `sha-<commit>` are created, and the main GitHub prerelease receives the server bundle, `.sha256`, NSIS installer, blockmap, `beta.yml`, and the final `release-manifest.json`. After it completes, the workflow creates a separate server-only prerelease tagged `server-vX.Y.Z-beta.N`, containing the server bundle, `.sha256`, and a copy of the final manifest. The stable build, instead of `beta`, receives the `stable` tag, `latest.yml`, a regular main GitHub Release, and a separate server-only release. Docker deployment uses the exact version tag from `OPENCORD_VERSION`; the floating channel tags and `latest` are intended for manual verification and release discovery.

SHA-256 confirms that a downloaded artifact matches the manifest, but does not replace a digital signature. Only `https://github.com/uniquealexx/OpenCord/releases` is considered a trusted source. Artifact attestations will be added as a separate stage.

Electron requests the manifest for a specific client version at `https://github.com/uniquealexx/OpenCord/releases/download/v<version>/release-manifest.json`. The client accepts only the published `beta` or `stable` channel, an exact match of the version and protocol, the Linux x64 bundle, and the canonical link to an asset of the same GitHub Release. The archive is downloaded atomically to a temporary directory with a size limit, verified by size and SHA-256 from the manifest, after which `bundle-info.json` and the embedded runtime are validated separately. The temporary file is not written to user state and is removed when the application exits.

For anonymous downloading, the repository and GitHub Release assets must be publicly accessible. At the current stage, trust is based on HTTPS and control of the GitHub repository; a cryptographic signature of the manifest is not yet implemented.

`sudo opencordctl check-update` fetches the latest regular (non-prerelease) GitHub Release via the API, so it applies only to the `stable` channel. `sudo opencordctl update --channel stable` uses the same resolver, rejects downgrades, protocol version changes, and non-canonical URLs, then verifies the actual size and SHA-256 of the bundle before extraction. The beta channel in `opencordctl` is intentionally not enabled yet.

`deploy/scripts/bootstrap.sh` is a manual one-command installation on a VPS without Node.js and without an already installed server. The script pins `BOOTSTRAP_VERSION` (the match with the package version is checked by `pnpm check:versions`), downloads the manifest for the exact version from the canonical URL, and validates it with a limited set of rules in pure bash: `schemaVersion`, the product, the `beta`/`stable` channel, equality of the version to the pin, an integer `protocolVersion`, the `commit` format, the canonical bundle `releaseUrl` and `downloadUrl`, the `sha256` format and the `sizeBytes` range, platform, and `installModes`. Comparison with the installed version is intentionally absent — on a clean VPS there is none; the full resolver is used in `opencordctl update`. After validation, bootstrap verifies the actual size and SHA-256 of the bundle and the safety of the tar entries before extraction. The script is published to the server-only GitHub Release as `bootstrap.sh` and is also available via an immutable tag through `raw.githubusercontent.com`.

The Windows release pipeline fills in `artifacts.windowsClient`: the NSIS installer, its blockmap, and `beta.yml` or `latest.yml`. The installed client validates the manifest and update metadata before launching `electron-updater`, and the downloaded installer is additionally verified by size and SHA-256. Details are described in [client-updates.md](./client-updates.md).

The same workflow also attaches the Linux x64 client (AppImage, deb, and `latest-linux.yml`) and the universal macOS client (dmg, zip, and `latest-mac.yml`) to the same GitHub Release. These artifacts are intentionally not yet part of manifest schema v1: existing clients parse the `artifacts` object strictly, so adding new sections would break their mandatory startup check and requires a coordinated client migration instead. Until then the macOS and Linux clients verify updates through electron-updater against the update metadata of the canonical GitHub Release (HTTPS plus size and SHA-512 from `latest-mac.yml`/`latest-linux.yml`). Manifest sections for these platforms are planned for schema v2.

The Android prototype is published separately: pushing the `android-vX.Y.Z` (or `android-vX.Y.Z-beta.N`) tag triggers `.github/workflows/publish-android-apk.yml`, which creates a dedicated GitHub Release containing only the signed `OpenCord-Android-<version>.apk` (signed with the debug key until production signing is added). The tag intentionally does not match the `v*` filter of the main workflow, so the Android release never receives server or desktop artifacts. For the same reason as the Linux/macOS clients, the Android artifact is not added to manifest schema v1.

---

# OpenCord release manifest v1 (Русский)

`release-manifest.json` описывает единый релиз OpenCord и является источником метаданных для Electron-клиента и автоматических обновлений `opencordctl`. Его Zod-схема экспортируется как `releaseManifestSchema` из `@opencord/shared`.

Manifest содержит SemVer-версию продукта, версию WebSocket-протокола, Git commit и проверяемые описания артефактов. Server bundle обязателен. Секции GHCR-образа и Windows-клиента входят в schema v1, но имеют значение `null`, пока соответствующие release pipeline не реализованы.

Development manifest создаётся командой:

```bash
pnpm bundle:server
```

Результаты находятся в игнорируемом каталоге `release/`: архив, `.sha256` sidecar и `release-manifest.json`. Проверить отдельный manifest можно командой `pnpm manifest:validate -- release/release-manifest.json`.

Beta-режим запускается через `pnpm bundle:server -- --channel beta`, stable-режим — через `pnpm bundle:server -- --channel stable`. Оба публикуемых режима требуют:

- чистое рабочее дерево Git;
- тег `vX.Y.Z` на текущем commit;
- совпадение тега с версией корневого, клиентского и серверного `package.json`;
- полный lowercase Git commit;
- HTTPS-ссылки на канонический GitHub Releases репозиторий.

Beta-версия имеет вид `X.Y.Z-beta.N`. Git-тег должен точно совпадать с `vX.Y.Z-beta.N`. Stable-канал, напротив, не допускает prerelease-суффикс.

Docker-образ, server bundle и Windows-клиент публикуются workflow `.github/workflows/publish-server-image.yml` при отправке любого тега `v*`. Тег обязан точно соответствовать версии в `package.json`: `vX.Y.Z-beta.N` публикует канал `beta`, а `vX.Y.Z` — `stable`; другие prerelease-суффиксы отклоняются. Для beta-релиза создаются теги GHCR точной версии, `beta`, `latest` и неизменяемый `sha-<commit>`, а основной GitHub prerelease получает server bundle, `.sha256`, NSIS installer, blockmap, `beta.yml` и итоговый `release-manifest.json`. После его завершения workflow создаёт отдельный server-only prerelease с тегом `server-vX.Y.Z-beta.N`, содержащий server bundle, `.sha256` и копию итогового manifest. Stable-сборка вместо `beta` получает тег `stable`, `latest.yml`, обычный основной GitHub Release и отдельный server-only release. Docker-развёртывание использует точный version-тег из `OPENCORD_VERSION`; плавающие канальные теги и `latest` предназначены для ручной проверки и обнаружения релиза.

SHA-256 подтверждает соответствие скачанного артефакта manifest, но не заменяет цифровую подпись. Доверенным источником считается только `https://github.com/uniquealexx/OpenCord/releases`. Artifact attestations будут добавлены отдельным этапом.

Electron запрашивает manifest конкретной версии клиента по адресу `https://github.com/uniquealexx/OpenCord/releases/download/v<version>/release-manifest.json`. Клиент принимает только опубликованный канал `beta` или `stable`, точное совпадение версии и протокола, Linux x64 bundle и каноническую ссылку на asset того же GitHub Release. Архив загружается атомарно во временный каталог с ограничением размера, проверяется по размеру и SHA-256 из manifest, после чего отдельно валидируются `bundle-info.json` и вложенный runtime. Временный файл не записывается в пользовательское состояние и удаляется при завершении приложения.

Для анонимной загрузки репозиторий и GitHub Release assets должны быть публично доступны. На текущем этапе доверие основано на HTTPS и контроле GitHub-репозитория; криптографическая подпись manifest ещё не реализована.

`sudo opencordctl check-update` получает последний обычный (не prerelease) GitHub Release через API, поэтому относится только к каналу `stable`. `sudo opencordctl update --channel stable` использует тот же resolver, отклоняет downgrade, смену версии протокола и неканонический URL, после чего проверяет фактический размер и SHA-256 bundle до распаковки. Beta-канал в `opencordctl` пока намеренно не включён.

`deploy/scripts/bootstrap.sh` — ручная установка одной командой на VPS без Node.js и без уже установленного сервера. Скрипт закрепляет `BOOTSTRAP_VERSION` (совпадение с версией пакетов проверяет `pnpm check:versions`), скачивает manifest точной версии по каноническому URL и проверяет его ограниченным набором правил на чистом bash: `schemaVersion`, продукт, канал `beta`/`stable`, равенство версии пину, целочисленный `protocolVersion`, формат `commit`, канонические `releaseUrl` и `downloadUrl` bundle, формат `sha256` и диапазон `sizeBytes`, platform и `installModes`. Сравнение с установленной версией намеренно отсутствует — на чистом VPS её нет; полный resolver используется в `opencordctl update`. После проверки bootstrap сверяет фактический размер и SHA-256 bundle и безопасность tar-записей до распаковки. Скрипт публикуется в server-only GitHub Release как `bootstrap.sh` и доступен также по неизменяемому тегу через `raw.githubusercontent.com`.

Windows release pipeline заполняет `artifacts.windowsClient`: NSIS installer, его blockmap и `beta.yml` либо `latest.yml`. Установленный клиент проверяет manifest и update metadata до запуска `electron-updater`, а скачанный installer дополнительно сверяет по размеру и SHA-256. Подробности описаны в [client-updates.md](./client-updates.md).

Тот же workflow прикладывает к общему GitHub Release Linux x64 клиент (AppImage, deb и `latest-linux.yml`) и универсальный macOS клиент (dmg, zip и `latest-mac.yml`). Эти артефакты намеренно пока не входят в manifest schema v1: существующие клиенты разбирают объект `artifacts` строго, поэтому добавление новых секций сломало бы их обязательную проверку при запуске и требует согласованной миграции клиента. До этого macOS и Linux клиенты проверяют обновления через electron-updater по update metadata канонического GitHub Release (HTTPS плюс размер и SHA-512 из `latest-mac.yml`/`latest-linux.yml`). Секции manifest для этих платформ запланированы в schema v2.

Android-прототип публикуется отдельно: отправка тега `android-vX.Y.Z` (или `android-vX.Y.Z-beta.N`) запускает `.github/workflows/publish-android-apk.yml`, который создаёт отдельный GitHub Release, содержащий только подписанный `OpenCord-Android-<version>.apk` (подписан debug-ключом до добавления продакшен-подписи). Тег намеренно не попадает под фильтр `v*` основного workflow, поэтому Android-релиз никогда не получает серверные или десктопные артефакты. По той же причине, что и для Linux/macOS клиентов, Android-артефакт не добавляется в manifest schema v1.

---

# OpenCord 发布清单 v1 (中文)

`release-manifest.json` 描述 OpenCord 的单次发布，是 Electron 客户端和 `opencordctl` 自动更新的元数据来源。它的 Zod 模式以 `releaseManifestSchema` 从 `@opencord/shared` 导出。

清单包含产品的 SemVer 版本、WebSocket 协议版本、Git commit 以及可验证的工件描述。server bundle 是必需的。GHCR 镜像和 Windows 客户端部分属于 schema v1，但在相应的 release pipeline 实现之前，其值为 `null`。

开发清单通过以下命令创建：

```bash
pnpm bundle:server
```

结果位于被忽略的 `release/` 目录中：归档文件、`.sha256` sidecar 和 `release-manifest.json`。可通过命令 `pnpm manifest:validate -- release/release-manifest.json` 验证单个清单。

测试版模式通过 `pnpm bundle:server -- --channel beta` 运行，稳定版模式通过 `pnpm bundle:server -- --channel stable` 运行。两种可发布模式都要求：

- 干净的 Git 工作树；
- 当前 commit 上的 `vX.Y.Z` 标签；
- 标签与根目录、客户端和服务器的 `package.json` 版本一致；
- 完整的 lowercase Git commit；
- 指向规范 GitHub Releases 仓库的 HTTPS 链接。

测试版的格式为 `X.Y.Z-beta.N`。Git 标签必须与 `vX.Y.Z-beta.N` 完全一致。稳定版渠道则相反，不允许 prerelease 后缀。

Docker 镜像、server bundle 和 Windows 客户端在推送任意 `v*` 标签时，由 workflow `.github/workflows/publish-server-image.yml` 发布。标签必须与 `package.json` 中的版本完全一致：`vX.Y.Z-beta.N` 发布 `beta` 渠道，`vX.Y.Z` 发布 `stable`；其他 prerelease 后缀会被拒绝。对于测试版发布，会创建精确版本的 GHCR 标签、`beta`、`latest` 以及不可变的 `sha-<commit>`，主 GitHub prerelease 会收到 server bundle、`.sha256`、NSIS installer、blockmap、`beta.yml` 和最终的 `release-manifest.json`。完成后，workflow 会创建一个单独的 server-only prerelease，标签为 `server-vX.Y.Z-beta.N`，包含 server bundle、`.sha256` 和最终清单的副本。稳定版构建不获取 `beta` 而是获取 `stable` 标签、`latest.yml`、普通的主 GitHub Release 以及单独的 server-only release。Docker 部署使用来自 `OPENCORD_VERSION` 的精确 version 标签；浮动渠道标签和 `latest` 用于手动验证和发布发现。

SHA-256 确认下载的工件与清单一致，但不能替代数字签名。只有 `https://github.com/uniquealexx/OpenCord/releases` 被视为可信来源。Artifact attestations 将作为单独阶段添加。

Electron 从 `https://github.com/uniquealexx/OpenCord/releases/download/v<version>/release-manifest.json` 请求特定客户端版本的清单。客户端只接受已发布的 `beta` 或 `stable` 渠道、版本和协议的精确匹配、Linux x64 bundle 以及指向同一 GitHub Release 中 asset 的规范链接。归档文件被原子地下载到带大小限制的临时目录，按清单中的大小和 SHA-256 校验，随后单独验证 `bundle-info.json` 和嵌套的 runtime。临时文件不会写入用户状态，并在应用程序退出时删除。

为了实现匿名下载，仓库和 GitHub Release assets 必须公开可访问。在当前阶段，信任基于 HTTPS 和对 GitHub 仓库的控制；清单的加密签名尚未实现。

`sudo opencordctl check-update` 通过 API 获取最新的普通（非 prerelease）GitHub Release，因此仅适用于 `stable` 渠道。`sudo opencordctl update --channel stable` 使用相同的 resolver，拒绝降级、协议版本变更和非规范 URL，然后在解包前校验 bundle 的实际大小和 SHA-256。`opencordctl` 中的测试版渠道目前有意未启用。

`deploy/scripts/bootstrap.sh` 是在没有 Node.js、也没有已安装服务器的 VPS 上进行手动一键安装的脚本。该脚本固定 `BOOTSTRAP_VERSION`（与包版本的一致性由 `pnpm check:versions` 检查），从规范 URL 下载精确版本的清单，并用纯 bash 的有限规则集验证它：`schemaVersion`、产品、`beta`/`stable` 渠道、版本与 pin 相等、整数 `protocolVersion`、`commit` 格式、规范的 bundle `releaseUrl` 和 `downloadUrl`、`sha256` 格式和 `sizeBytes` 范围、platform 以及 `installModes`。与已安装版本的比较有意缺失——在干净的 VPS 上没有已安装版本；完整 resolver 用于 `opencordctl update`。验证后，bootstrap 在解包前核对 bundle 的实际大小和 SHA-256 以及 tar 条目的安全性。该脚本以 `bootstrap.sh` 发布到 server-only GitHub Release，也可通过不可变标签经 `raw.githubusercontent.com` 获取。

Windows release pipeline 填充 `artifacts.windowsClient`：NSIS installer、其 blockmap 以及 `beta.yml` 或 `latest.yml`。已安装的客户端在启动 `electron-updater` 之前验证清单和 update metadata，下载的 installer 还额外按大小和 SHA-256 核对。详情见 [client-updates.md](./client-updates.md)。

同一个 workflow 还会将 Linux x64 客户端（AppImage、deb 和 `latest-linux.yml`）以及 universal macOS 客户端（dmg、zip 和 `latest-mac.yml`）附加到同一个 GitHub Release。这些工件目前有意不纳入 manifest schema v1：现有客户端会严格解析 `artifacts` 对象，因此添加新 section 会破坏它们的强制启动检查，需要协调一致的客户端迁移。在此之前，macOS 和 Linux 客户端通过 electron-updater 根据规范 GitHub Release 的 update metadata 验证更新（HTTPS 加上来自 `latest-mac.yml`/`latest-linux.yml` 的大小和 SHA-512）。这些平台的清单 section 计划在 schema v2 中加入。

Android 原型单独发布：推送 `android-vX.Y.Z`（或 `android-vX.Y.Z-beta.N`）标签会触发 `.github/workflows/publish-android-apk.yml`，该工作流创建一个独立的 GitHub Release，其中只包含签名的 `OpenCord-Android-<version>.apk`（在添加生产签名之前使用 debug 密钥签名）。该标签有意不匹配主工作流的 `v*` 过滤器，因此 Android 发布永远不会收到服务器或桌面工件。与 Linux/macOS 客户端相同的原因，Android 工件不会加入 manifest schema v1。
