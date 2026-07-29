# OpenCord release manifest v1

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

Docker-образ, server bundle и Windows-клиент публикуются workflow `.github/workflows/publish-server-image.yml` при отправке любого тега `v*`. Тег обязан точно соответствовать версии в `package.json`: `vX.Y.Z-beta.N` публикует канал `beta`, а `vX.Y.Z` — `stable`; другие prerelease-суффиксы отклоняются. Для `0.1.0-beta.1` создаются теги GHCR `0.1.0-beta.1`, `beta`, `latest` и неизменяемый `sha-<commit>`, а GitHub prerelease получает server bundle, `.sha256`, NSIS installer, blockmap, `beta.yml` и итоговый `release-manifest.json`. Stable-сборка вместо `beta` получает тег `stable`, `latest.yml` и обычный GitHub Release. Docker-развёртывание использует точный version-тег из `OPENCORD_VERSION`; плавающие канальные теги и `latest` предназначены для ручной проверки и обнаружения релиза.

SHA-256 подтверждает соответствие скачанного артефакта manifest, но не заменяет цифровую подпись. Доверенным источником считается только `https://github.com/uniquealexx/OpenCord/releases`. Artifact attestations будут добавлены отдельным этапом.

Electron запрашивает manifest конкретной версии клиента по адресу `https://github.com/uniquealexx/OpenCord/releases/download/v<version>/release-manifest.json`. Клиент принимает только опубликованный канал `beta` или `stable`, точное совпадение версии и протокола, Linux x64 bundle и каноническую ссылку на asset того же GitHub Release. Архив загружается атомарно во временный каталог с ограничением размера, проверяется по размеру и SHA-256 из manifest, после чего отдельно валидируются `bundle-info.json` и вложенный runtime. Временный файл не записывается в пользовательское состояние и удаляется при завершении приложения.

Для анонимной загрузки репозиторий и GitHub Release assets должны быть публично доступны. На текущем этапе доверие основано на HTTPS и контроле GitHub-репозитория; криптографическая подпись manifest ещё не реализована.

`sudo opencordctl check-update` получает последний обычный (не prerelease) GitHub Release через API, поэтому относится только к каналу `stable`. `sudo opencordctl update --channel stable` использует тот же resolver, отклоняет downgrade, смену версии протокола и неканонический URL, после чего проверяет фактический размер и SHA-256 bundle до распаковки. Beta-канал в `opencordctl` пока намеренно не включён.

Windows release pipeline заполняет `artifacts.windowsClient`: NSIS installer, его blockmap и `beta.yml` либо `latest.yml`. Установленный клиент проверяет manifest и update metadata до запуска `electron-updater`, а скачанный installer дополнительно сверяет по размеру и SHA-256. Подробности описаны в [client-updates.md](./client-updates.md).
