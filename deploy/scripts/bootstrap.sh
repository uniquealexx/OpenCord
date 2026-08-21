#!/usr/bin/env bash
# OpenCord Server bootstrap: manual one-command installation directly on a VPS.
# Downloads the verified release bundle of the pinned version and delegates to
# the existing idempotent Docker or native installer. No SSH access and no
# compilation on the server are required.
set -Eeuo pipefail
umask 077

BOOTSTRAP_VERSION="0.1.0-beta.18"
GITHUB_REPOSITORY="uniquealexx/OpenCord"
GITHUB_ORIGIN="https://github.com"
MAX_BUNDLE_SIZE_BYTES=2147483648

INSTALL_MODE=""
INSECURE_MODE="false"
OPENCORD_DOMAIN=""
ACME_EMAIL=""
OWNER_PUBLIC_KEY=""
SERVER_NAME=""
VOICE_PUBLIC_HOST=""
ASSUME_YES="false"

usage() {
  printf 'Использование:\n'
  printf '  sudo bash bootstrap.sh [--mode docker|native] [--domain ДОМЕН --email EMAIL | --insecure [--public-host АДРЕС]] --owner-public-key КЛЮЧ --server-name НАЗВАНИЕ [--yes]\n'
  printf 'Без параметров скрипт задаёт вопросы в интерактивном режиме.\n'
  printf 'При запуске через pipe (curl | sudo bash) вопросы недоступны — укажите все параметры флагами.\n'
  printf 'Повторный запуск с теми же параметрами обновляет сервер без потери данных.\n'
}

while (($#)); do
  case "$1" in
    --mode) INSTALL_MODE="${2:-}"; shift 2 ;;
    --domain) OPENCORD_DOMAIN="${2:-}"; shift 2 ;;
    --email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --insecure) INSECURE_MODE="true"; shift ;;
    --public-host) VOICE_PUBLIC_HOST="${2:-}"; shift 2 ;;
    --owner-public-key) OWNER_PUBLIC_KEY="${2:-}"; shift 2 ;;
    --server-name) SERVER_NAME="${2:-}"; shift 2 ;;
    --yes) ASSUME_YES="true"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Неизвестный параметр: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Запустите скрипт от root, например: sudo bash bootstrap.sh\n' >&2
  exit 1
fi
if [[ -n "${INSTALL_MODE}" && "${INSTALL_MODE}" != "docker" && "${INSTALL_MODE}" != "native" ]]; then
  printf 'Параметр --mode принимает только docker или native.\n' >&2
  usage >&2
  exit 2
fi
if [[ "${INSECURE_MODE}" == "true" && ( -n "${OPENCORD_DOMAIN}" || -n "${ACME_EMAIL}" ) ]]; then
  printf 'Параметры --insecure и --domain/--email несовместимы.\n' >&2
  exit 2
fi
if [[ -n "${VOICE_PUBLIC_HOST}" && "${INSECURE_MODE}" != "true" ]]; then
  printf 'Параметр --public-host используется только вместе с --insecure.\n' >&2
  exit 2
fi
if [[ -n "${OPENCORD_DOMAIN}" || -n "${ACME_EMAIL}" ]]; then
  if [[ -z "${OPENCORD_DOMAIN}" || -z "${ACME_EMAIL}" ]]; then
    printf 'Параметры --domain и --email задаются только вместе.\n' >&2
    exit 2
  fi
fi

if [[ ! -r /etc/os-release ]]; then
  printf 'Не удалось определить операционную систему.\n' >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || ! "${VERSION_ID:-}" =~ ^(22\.04|24\.04)$ ]]; then
  printf 'Поддерживаются Ubuntu 22.04 LTS и 24.04 LTS. Обнаружено: %s %s\n' "${ID:-unknown}" "${VERSION_ID:-unknown}" >&2
  exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  printf 'Серверный bundle OpenCord поддерживает Ubuntu Linux x64. Обнаружено: %s\n' "$(uname -m)" >&2
  exit 1
fi

ANSWER=""
read_answer() {
  # Reads one line from the terminal. Works only when standard input is a
  # terminal: the interactive form is `curl -fsSL … -o bootstrap.sh && sudo bash
  # bootstrap.sh`. Piped invocations (`curl … | sudo bash`) must use flags.
  local prompt="$1"
  if [[ ! -t 0 ]]; then
    return 1
  fi
  printf '%s' "${prompt}" >&2
  IFS= read -r ANSWER || return 1
}

if [[ -z "${INSTALL_MODE}" ]]; then
  if read_answer 'Способ установки: [1] Docker (рекомендуется) [2] Нативная установка. Выбор: '; then
    case "${ANSWER}" in
      1|docker|Docker|DOCKER|"") INSTALL_MODE="docker" ;;
      2|native|Native|NATIVE) INSTALL_MODE="native" ;;
      *) printf 'Укажите 1 (docker) или 2 (native).\n' >&2; exit 2 ;;
    esac
  else
    INSTALL_MODE="docker"
    printf 'Интерактивный терминал недоступен; используется Docker-режим по умолчанию.\n' >&2
  fi
fi

if [[ "${INSTALL_MODE}" == "native" && "$(ps -p 1 -o comm= | tr -d ' ')" != "systemd" ]]; then
  printf 'Нативная установка требует systemd в качестве PID 1.\n' >&2
  exit 1
fi

if [[ "${INSTALL_MODE}" == "docker" ]]; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    printf 'Docker Engine обнаружен.\n'
  else
    printf 'Docker Engine не найден или не готов: установщик поставит его из официального apt-репозитория Docker (download.docker.com).\n'
  fi
fi

if [[ -z "${OPENCORD_DOMAIN}" && "${INSECURE_MODE}" != "true" ]]; then
  if ! read_answer 'Использовать домен и TLS/HTTPS? [y/N]: '; then
    printf 'Без интерактивного терминала укажите --domain/--email или --insecure.\n' >&2
    usage >&2
    exit 2
  fi
  if [[ "${ANSWER}" =~ ^[Yy] ]]; then
    if ! read_answer 'Домен (A/AAAA-запись должна указывать на этот сервер): ' || [[ -z "${ANSWER}" ]]; then
      printf 'Требуется домен, направленный на этот сервер.\n' >&2
      exit 2
    fi
    OPENCORD_DOMAIN="${ANSWER}"
    if ! read_answer 'Email для ACME-сертификата: ' || [[ -z "${ANSWER}" ]]; then
      printf 'Требуется email для ACME-сертификата.\n' >&2
      exit 2
    fi
    ACME_EMAIL="${ANSWER}"
  else
    INSECURE_MODE="true"
  fi
fi

if [[ "${INSECURE_MODE}" != "true" ]]; then
  if [[ ! "${OPENCORD_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ || "${OPENCORD_DOMAIN}" != *.* ]]; then
    printf 'Некорректный домен: %s\n' "${OPENCORD_DOMAIN}" >&2
    exit 2
  fi
  email_pattern='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$'
  if [[ ${#ACME_EMAIL} -gt 254 || ! "${ACME_EMAIL}" =~ ${email_pattern} ]]; then
    printf 'Некорректный ACME email: %s\n' "${ACME_EMAIL}" >&2
    exit 2
  fi
else
  printf 'ВНИМАНИЕ: режим без домена и TLS не защищает сообщения, профиль и токены сессии\n' >&2
  printf 'от перехвата или изменения в сети. Он предназначен только для доверенной локальной\n' >&2
  printf 'среды (WSL, тестовая VM). Не открывайте порт 3210 в интернет.\n' >&2
  if [[ "${ASSUME_YES}" != "true" ]]; then
    if ! read_answer 'Подтвердите продолжение без TLS: введите "да": '; then
      printf 'Подтверждение требуется: интерактивно или через --yes.\n' >&2
      exit 1
    fi
    if [[ "${ANSWER}" != "да" ]]; then
      printf 'Установка в небезопасном режиме не подтверждена.\n' >&2
      exit 1
    fi
  fi
  if [[ -z "${VOICE_PUBLIC_HOST}" ]]; then
    detected_host="localhost"
    if command -v ip >/dev/null 2>&1; then
      detected_host="$(ip route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i <= NF; i += 1) if ($i == "src") { print $(i + 1); exit } }')"
      [[ -n "${detected_host}" ]] || detected_host="localhost"
    fi
    if read_answer "Адрес, по которому клиент будет подключаться к этому серверу [${detected_host}]: " && [[ -n "${ANSWER}" ]]; then
      VOICE_PUBLIC_HOST="${ANSWER}"
    else
      VOICE_PUBLIC_HOST="${detected_host}"
    fi
  fi
  if [[ ! "${VOICE_PUBLIC_HOST}" =~ ^[-A-Za-z0-9._:]+$ ]]; then
    printf 'Адрес сервера содержит неподдерживаемые символы.\n' >&2
    exit 2
  fi
fi

if [[ -z "${SERVER_NAME}" ]]; then
  if ! read_answer 'Название сервера (2–48 символов): ' || [[ -z "${ANSWER}" ]]; then
    printf 'Требуется название сервера.\n' >&2
    usage >&2
    exit 2
  fi
  SERVER_NAME="${ANSWER}"
fi
if [[ ${#SERVER_NAME} -lt 2 || ${#SERVER_NAME} -gt 48 || "${SERVER_NAME}" == *$'\n'* || "${SERVER_NAME}" == *$'\r'* ]]; then
  printf 'Название сервера должно быть от 2 до 48 символов.\n' >&2
  exit 2
fi

if [[ -z "${OWNER_PUBLIC_KEY}" ]]; then
  if ! read_answer 'Публичный ключ владельца (в OpenCord Client: Настройки → Скопировать публичный ключ): ' || [[ -z "${ANSWER}" ]]; then
    printf 'Требуется публичный ключ владельца.\n' >&2
    usage >&2
    exit 2
  fi
  OWNER_PUBLIC_KEY="${ANSWER}"
fi
if [[ ${#OWNER_PUBLIC_KEY} -lt 40 || ${#OWNER_PUBLIC_KEY} -gt 1000 || ! "${OWNER_PUBLIC_KEY}" =~ ^[A-Za-z0-9+/=]+$ ]]; then
  printf 'Некорректный публичный ключ OpenCord.\n' >&2
  exit 2
fi

if [[ "${INSTALL_MODE}" == "docker" && -f /opt/opencord/deploy/.env ]]; then
  printf 'Обнаружена существующая Docker-установка OpenCord. Повторный запуск выполнит обновление:\nданные PostgreSQL, вложения и секреты сохраняются.\n' >&2
  if [[ "${ASSUME_YES}" != "true" ]]; then
    if ! read_answer 'Продолжить как обновление? [y/N]: ' || [[ ! "${ANSWER}" =~ ^[Yy] ]]; then
      printf 'Операция прервана.\n' >&2
      exit 1
    fi
  fi
elif [[ "${INSTALL_MODE}" == "native" && ( -f /etc/opencord/database_url || -f /opt/opencord/.native-installed ) ]]; then
  printf 'Обнаружена существующая нативная установка OpenCord. Повторный запуск создаст новый release\nприложения: база PostgreSQL, вложения и секреты сохраняются.\n' >&2
  if [[ "${ASSUME_YES}" != "true" ]]; then
    if ! read_answer 'Продолжить как обновление? [y/N]: ' || [[ ! "${ANSWER}" =~ ^[Yy] ]]; then
      printf 'Операция прервана.\n' >&2
      exit 1
    fi
  fi
fi

printf '\nСводка установки:\n'
printf '  Режим: %s\n' "${INSTALL_MODE}"
if [[ "${INSECURE_MODE}" == "true" ]]; then
  printf '  Адрес: http://%s:3210 (без TLS!)\n' "${VOICE_PUBLIC_HOST}"
else
  printf '  Домен: https://%s\n' "${OPENCORD_DOMAIN}"
fi
printf '  Название сервера: %s\n' "${SERVER_NAME}"
printf '  Публичный ключ владельца: задан (не отображается)\n'
if [[ "${ASSUME_YES}" != "true" ]]; then
  if ! read_answer 'Продолжить установку? [y/N]: ' || [[ ! "${ANSWER}" =~ ^[Yy] ]]; then
    printf 'Установка прервана.\n' >&2
    exit 1
  fi
fi

if command -v curl >/dev/null 2>&1; then
  DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER="wget"
else
  printf 'Требуется curl или wget. Установите: sudo apt-get update && sudo apt-get install -y curl\n' >&2
  exit 1
fi

download_file() {
  local url="$1" destination="$2" timeout_seconds="$3"
  local max_bytes="${4:-}"
  if [[ "${DOWNLOADER}" == "curl" ]]; then
    local max_size_args=()
    [[ -n "${max_bytes}" ]] && max_size_args=(--max-filesize "${max_bytes}")
    curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --tlsv1.2 \
      --connect-timeout 20 --max-time "${timeout_seconds}" "${max_size_args[@]}" "${url}" --output "${destination}"
  else
    wget --quiet --output-document="${destination}" --timeout="${timeout_seconds}" --tries=2 "${url}"
  fi
}

TEMP_ROOT="$(mktemp -d /tmp/opencord-bootstrap.XXXXXXXX)"
cleanup() {
  if [[ "${TEMP_ROOT}" == /tmp/opencord-bootstrap.* && -d "${TEMP_ROOT}" ]]; then
    rm -rf -- "${TEMP_ROOT}"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

MANIFEST_URL="${GITHUB_ORIGIN}/${GITHUB_REPOSITORY}/releases/download/v${BOOTSTRAP_VERSION}/release-manifest.json"
MANIFEST_PATH="${TEMP_ROOT}/release-manifest.json"
printf 'Загрузка release-manifest.json версии %s...\n' "${BOOTSTRAP_VERSION}"
if ! download_file "${MANIFEST_URL}" "${MANIFEST_PATH}" 60 1048576; then
  printf 'Не удалось скачать release-manifest.json. Проверьте доступ к github.com и что релиз %s опубликован.\n' "${BOOTSTRAP_VERSION}" >&2
  exit 1
fi

section_scalar() {
  # Prints the raw scalar value of a JSON field from the text in the variable
  # named by the first argument (bash indirection). Values keep their quotes.
  local section_name="$1" field_name="$2"
  printf '%s' "${!section_name}" | sed -nE "s/^[[:space:]]*\"${field_name}\"[[:space:]]*:[[:space:]]*(.*)$/\1/p" | head -n 1 | sed -E 's/,[[:space:]]*$//'
}

fail_manifest() {
  printf 'release-manifest.json не прошёл проверку (%s). Установка остановлена.\n' "$1" >&2
  exit 1
}

MANIFEST_TEXT="$(cat -- "${MANIFEST_PATH}")"
BUNDLE_SECTION="$(printf '%s' "${MANIFEST_TEXT}" | sed -n '/"serverBundle": {/,/^    },$/p')"
if [[ -z "${BUNDLE_SECTION}" ]]; then
  fail_manifest "serverBundle"
fi

[[ "$(section_scalar MANIFEST_TEXT schemaVersion)" == "1" ]] || fail_manifest "schemaVersion"
[[ "$(section_scalar MANIFEST_TEXT product)" == '"opencord"' ]] || fail_manifest "product"
manifest_channel="$(section_scalar MANIFEST_TEXT releaseChannel)"
[[ "${manifest_channel}" == '"beta"' || "${manifest_channel}" == '"stable"' ]] || fail_manifest "releaseChannel"
[[ "$(section_scalar MANIFEST_TEXT version)" == "\"${BOOTSTRAP_VERSION}\"" ]] || fail_manifest "version"
manifest_protocol="$(section_scalar MANIFEST_TEXT protocolVersion)"
[[ "${manifest_protocol}" =~ ^[1-9][0-9]*$ ]] || fail_manifest "protocolVersion"
manifest_commit="$(section_scalar MANIFEST_TEXT commit)"
[[ "${manifest_commit}" =~ ^\"[a-f0-9]{40}\"$ ]] || fail_manifest "commit"
manifest_published="$(section_scalar MANIFEST_TEXT publishedAt)"
[[ "${manifest_published}" =~ ^\"[^\"]+\"$ ]] || fail_manifest "publishedAt"
[[ "$(section_scalar MANIFEST_TEXT releaseUrl)" == "\"${GITHUB_ORIGIN}/${GITHUB_REPOSITORY}/releases/tag/v${BOOTSTRAP_VERSION}\"" ]] || fail_manifest "releaseUrl"

[[ "$(section_scalar BUNDLE_SECTION bundleFormatVersion)" == "1" ]] || fail_manifest "bundleFormatVersion"
[[ "$(section_scalar BUNDLE_SECTION fileName)" == "\"opencord-server-${BOOTSTRAP_VERSION}.tar.gz\"" ]] || fail_manifest "fileName"
manifest_download_url="$(section_scalar BUNDLE_SECTION downloadUrl)"
[[ "${manifest_download_url}" == "\"${GITHUB_ORIGIN}/${GITHUB_REPOSITORY}/releases/download/v${BOOTSTRAP_VERSION}/opencord-server-${BOOTSTRAP_VERSION}.tar.gz\"" ]] || fail_manifest "downloadUrl"
BUNDLE_URL="${manifest_download_url//\"/}"
manifest_sha256="$(section_scalar BUNDLE_SECTION sha256)"
[[ "${manifest_sha256}" =~ ^\"[a-f0-9]{64}\"$ ]] || fail_manifest "sha256"
BUNDLE_SHA256="${manifest_sha256//\"/}"
manifest_size="$(section_scalar BUNDLE_SECTION sizeBytes)"
[[ "${manifest_size}" =~ ^[1-9][0-9]*$ && "${manifest_size}" -le "${MAX_BUNDLE_SIZE_BYTES}" ]] || fail_manifest "sizeBytes"
BUNDLE_SIZE_BYTES="${manifest_size}"
[[ "$(section_scalar BUNDLE_SECTION os)" == '"linux"' ]] || fail_manifest "target.os"
[[ "$(section_scalar BUNDLE_SECTION arch)" == '"x64"' ]] || fail_manifest "target.arch"
printf '%s' "${BUNDLE_SECTION}" | grep -Eq '^[[:space:]]*"docker",?$' || fail_manifest "installModes"
printf '%s' "${BUNDLE_SECTION}" | grep -Eq '^[[:space:]]*"native",?$' || fail_manifest "installModes"

BUNDLE_PATH="${TEMP_ROOT}/server-bundle.tar.gz"
printf 'Загрузка проверенного server bundle (%s байт)...\n' "${BUNDLE_SIZE_BYTES}"
if ! download_file "${BUNDLE_URL}" "${BUNDLE_PATH}" 600 "${BUNDLE_SIZE_BYTES}"; then
  printf 'Не удалось скачать server bundle по HTTPS.\n' >&2
  exit 1
fi

actual_size="$(stat --format='%s' -- "${BUNDLE_PATH}")"
if [[ "${actual_size}" != "${BUNDLE_SIZE_BYTES}" ]]; then
  printf 'Размер bundle не совпадает с manifest: ожидалось %s, получено %s.\n' "${BUNDLE_SIZE_BYTES}" "${actual_size}" >&2
  exit 1
fi
actual_sha256="$(sha256sum -- "${BUNDLE_PATH}" | awk '{print $1}')"
if [[ "${actual_sha256}" != "${BUNDLE_SHA256}" ]]; then
  printf 'SHA-256 bundle не совпадает с manifest.\n' >&2
  exit 1
fi
if ! tar --list --gzip --file "${BUNDLE_PATH}" >/dev/null; then
  printf 'Bundle не является корректным tar.gz архивом.\n' >&2
  exit 1
fi
if tar --list --gzip --file "${BUNDLE_PATH}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  printf 'Bundle содержит небезопасные пути.\n' >&2
  exit 1
fi
if ! tar --list --verbose --gzip --file "${BUNDLE_PATH}" | awk '{ type = substr($1, 1, 1); if (type != "-" && type != "d") exit 1 }'; then
  printf 'Bundle содержит ссылки или специальные файловые записи.\n' >&2
  exit 1
fi

SOURCE_ROOT="${TEMP_ROOT}/bundle"
install -d -m 0700 "${SOURCE_ROOT}"
tar --extract --gzip --file "${BUNDLE_PATH}" --directory "${SOURCE_ROOT}" --no-same-owner --no-same-permissions

for required_file in bundle-info.json server-runtime-linux-x64.tar.gz deploy/scripts/install-ubuntu.sh deploy/scripts/install-native-ubuntu.sh; do
  if [[ ! -f "${SOURCE_ROOT}/${required_file}" ]]; then
    printf 'Bundle установки неполон: отсутствует %s.\n' "${required_file}" >&2
    exit 1
  fi
done

if [[ "${INSTALL_MODE}" == "docker" ]]; then
  installer="${SOURCE_ROOT}/deploy/scripts/install-ubuntu.sh"
else
  installer="${SOURCE_ROOT}/deploy/scripts/install-native-ubuntu.sh"
fi
installer_arguments=(--owner-public-key "${OWNER_PUBLIC_KEY}" --server-name "${SERVER_NAME}")
if [[ "${INSECURE_MODE}" == "true" ]]; then
  installer_arguments=(--insecure --public-host "${VOICE_PUBLIC_HOST}" "${installer_arguments[@]}")
else
  installer_arguments=(--domain "${OPENCORD_DOMAIN}" --email "${ACME_EMAIL}" "${installer_arguments[@]}")
fi

printf 'Запуск проверенного установщика OpenCord (%s)...\n' "${INSTALL_MODE}"
bash "${installer}" "${installer_arguments[@]}"

format_address() {
  if [[ "$1" =~ ^[-A-Za-z0-9._]+$ ]]; then
    printf '%s' "$1"
  else
    printf '[%s]' "$1"
  fi
}

printf '\nУстановка OpenCord Server завершена.\n\n'
printf 'Данные для подключения:\n'
if [[ "${INSECURE_MODE}" == "true" ]]; then
  printf '  Адрес сервера: http://%s:3210 (без TLS — только для доверенной локальной сети!)\n' "$(format_address "${VOICE_PUBLIC_HOST}")"
  printf '  WebSocket:      ws://%s:3210/ws\n' "$(format_address "${VOICE_PUBLIC_HOST}")"
else
  printf '  Адрес сервера: https://%s\n' "${OPENCORD_DOMAIN}"
  printf '  WebSocket:      wss://%s/ws\n' "${OPENCORD_DOMAIN}"
fi
printf 'Название сервера: %s\n' "${SERVER_NAME}"
printf 'Владелец: локальная идентичность OpenCord, чей публичный ключ указан при установке.\n'
printf 'Управление: sudo opencordctl status | logs | restart | backup | update\n'
printf 'Повторный запуск этой команды обновляет сервер без потери данных.\n'
