# OpenCord release manifest v1

`release-manifest.json` описывает единый релиз OpenCord и является будущим источником метаданных для клиента и `opencordctl`. Его Zod-схема экспортируется как `releaseManifestSchema` из `@opencord/shared`.

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

Docker-образ сервера публикуется workflow `.github/workflows/publish-server-image.yml` при отправке beta-тега. Для `0.1.0-beta.1` создаются теги GHCR `0.1.0-beta.1`, `beta`, `latest` и неизменяемый `sha-<commit>`. Docker-развёртывание использует точный version-тег из `OPENCORD_VERSION`; плавающие `beta` и `latest` предназначены для ручной проверки и обнаружения релиза.

SHA-256 подтверждает соответствие скачанного артефакта manifest, но не заменяет цифровую подпись. До появления GitHub Actions доверенным источником считается только `https://github.com/uniquealexx/OpenCord/releases`. Artifact attestations будут добавлены отдельным этапом.
