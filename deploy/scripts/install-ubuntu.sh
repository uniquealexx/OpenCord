#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_ROOT="/opt/opencord"
INSTALL_DOCKER="true"
INSECURE_MODE="false"
OPENCORD_DOMAIN="${OPENCORD_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
OWNER_PUBLIC_KEY=""
SERVER_NAME=""
VOICE_PUBLIC_HOST=""
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

usage() {
  printf 'Usage: sudo bash deploy/scripts/install-ubuntu.sh (--domain chat.example.com --email admin@example.com | --insecure --public-host HOST) --owner-public-key BASE64_KEY --server-name NAME [--install-dir /opt/opencord] [--skip-docker-install]\n'
}

while (($#)); do
  case "$1" in
    --domain) OPENCORD_DOMAIN="${2:-}"; shift 2 ;;
    --email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --insecure) INSECURE_MODE="true"; shift ;;
    --owner-public-key) OWNER_PUBLIC_KEY="${2:-}"; shift 2 ;;
    --server-name) SERVER_NAME="${2:-}"; shift 2 ;;
    --public-host) VOICE_PUBLIC_HOST="${2:-}"; shift 2 ;;
    --install-dir) INSTALL_ROOT="${2:-}"; shift 2 ;;
    --skip-docker-install) INSTALL_DOCKER="false"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run this installer as root (for example through sudo).\n' >&2
  exit 1
fi

if [[ ${#OWNER_PUBLIC_KEY} -lt 40 || ${#OWNER_PUBLIC_KEY} -gt 1000 || ! "${OWNER_PUBLIC_KEY}" =~ ^[A-Za-z0-9+/=]+$ ]]; then
  printf 'A valid OpenCord owner public key is required through --owner-public-key.\n' >&2
  exit 1
fi
if [[ ${#SERVER_NAME} -lt 2 || ${#SERVER_NAME} -gt 48 || "${SERVER_NAME}" == *$'\n'* || "${SERVER_NAME}" == *$'\r'* ]]; then
  printf 'A server name between 2 and 48 characters is required through --server-name.\n' >&2
  exit 1
fi

if [[ "${INSECURE_MODE}" != "true" ]]; then
  if [[ -z "${OPENCORD_DOMAIN}" || ! "${OPENCORD_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ || "${OPENCORD_DOMAIN}" != *.* ]]; then
    printf 'A valid DNS hostname is required through --domain.\n' >&2
    exit 1
  fi
  email_pattern='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$'
  if [[ ${#ACME_EMAIL} -gt 254 || ! "${ACME_EMAIL}" =~ ${email_pattern} ]]; then
    printf 'A valid ACME contact email is required through --email.\n' >&2
    exit 1
  fi
fi

if [[ ! -r /etc/os-release ]]; then
  printf 'Cannot identify the operating system.\n' >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || ! "${VERSION_ID:-}" =~ ^(22\.04|24\.04)$ ]]; then
  printf 'Supported systems: Ubuntu 22.04 LTS and Ubuntu 24.04 LTS. Found: %s %s\n' "${ID:-unknown}" "${VERSION_ID:-unknown}" >&2
  exit 1
fi

for required_file in .dockerignore package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json deploy/Dockerfile deploy/compose.yml deploy/compose.insecure.yml deploy/Caddyfile deploy/livekit-entrypoint.sh deploy/management/opencordctl deploy/management/install-management-home deploy/management/README.md server/package.json shared/package.json; do
  if [[ ! -f "${SOURCE_ROOT}/${required_file}" ]]; then
    printf 'Installation bundle is incomplete: %s is missing.\n' "${required_file}" >&2
    exit 1
  fi
done

install_docker_engine() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    return
  fi
  if [[ "${INSTALL_DOCKER}" != "true" ]]; then
    printf 'Docker Engine with the Compose plugin is required.\n' >&2
    exit 1
  fi

  printf 'Installing Docker Engine from the official Docker apt repository...\n'
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  local architecture codename
  architecture="$(dpkg --print-architecture)"
  codename="${UBUNTU_CODENAME:-${VERSION_CODENAME}}"
  printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "${codename}" "${architecture}" > /etc/apt/sources.list.d/docker.sources
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

check_initial_ports() {
  local deploy_environment="${INSTALL_ROOT}/deploy/.env"
  if [[ -f "${deploy_environment}" ]] || ! command -v ss >/dev/null 2>&1; then
    return
  fi
  local port_pattern='(^|:)(80|443)$'
  if [[ "${INSECURE_MODE}" == "true" ]]; then port_pattern='(^|:)3210$'; fi
  if ss -H -ltn | awk '{print $4}' | grep -Eq "${port_pattern}"; then
    printf 'A required TCP port is already in use. Stop the conflicting service before installation.\n' >&2
    exit 1
  fi
}

install_docker_engine
check_initial_ports

if ! getent group opencord >/dev/null; then
  groupadd --system opencord
fi
if ! getent passwd opencord >/dev/null; then
  useradd --system --gid opencord --home-dir /home/opencord --shell /usr/sbin/nologin opencord
fi

install -d -m 0750 -o root -g opencord "${INSTALL_ROOT}" "${INSTALL_ROOT}/deploy"

tar --create --file - --directory "${SOURCE_ROOT}" \
  --exclude='node_modules' --exclude='dist' --exclude='.data' --exclude='coverage' \
  .dockerignore package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json \
  server shared deploy/Dockerfile deploy/compose.yml deploy/compose.insecure.yml deploy/Caddyfile deploy/livekit-entrypoint.sh deploy/.env.example deploy/management \
  | tar --extract --file - --directory "${INSTALL_ROOT}"

DEPLOY_DIR="${INSTALL_ROOT}/deploy"
SECRETS_DIR="${DEPLOY_DIR}/secrets"
install -d -m 0700 -o root -g root "${SECRETS_DIR}"

if [[ ! -s "${SECRETS_DIR}/postgres_password" ]]; then
  openssl rand -hex 32 > "${SECRETS_DIR}/postgres_password"
fi
chmod 0600 "${SECRETS_DIR}/postgres_password"

if [[ ! -s "${SECRETS_DIR}/livekit_api_key" ]]; then
  printf 'OC%s\n' "$(openssl rand -hex 10)" > "${SECRETS_DIR}/livekit_api_key"
fi
if [[ ! -s "${SECRETS_DIR}/livekit_api_secret" ]]; then
  openssl rand -base64 48 | tr -d '\r\n' > "${SECRETS_DIR}/livekit_api_secret"
fi
chmod 0600 "${SECRETS_DIR}/livekit_api_key" "${SECRETS_DIR}/livekit_api_secret"

if [[ ! -s "${SECRETS_DIR}/owner_public_key" ]]; then
  printf '%s\n' "${OWNER_PUBLIC_KEY}" > "${SECRETS_DIR}/owner_public_key"
fi
printf '%s\n' "${SERVER_NAME}" > "${SECRETS_DIR}/server_name"
cat /proc/sys/kernel/random/uuid > "${SECRETS_DIR}/deployment_id"

postgres_password="$(tr -d '\r\n' < "${SECRETS_DIR}/postgres_password")"
printf 'postgresql://opencord:%s@database:5432/opencord\n' "${postgres_password}" > "${SECRETS_DIR}/database_url"
unset postgres_password

# Compose file-backed secrets retain the numeric owner and mode of their source
# files. The application image deliberately runs as UID/GID 10001, so only its
# secrets are made readable by that identity. PostgreSQL reads its own password
# during the root-owned entrypoint and keeps a separate root-only source file.
chown 10001:10001 \
  "${SECRETS_DIR}/owner_public_key" \
  "${SECRETS_DIR}/server_name" \
  "${SECRETS_DIR}/deployment_id" \
  "${SECRETS_DIR}/database_url" \
  "${SECRETS_DIR}/livekit_api_key" \
  "${SECRETS_DIR}/livekit_api_secret"
chmod 0400 \
  "${SECRETS_DIR}/owner_public_key" \
  "${SECRETS_DIR}/server_name" \
  "${SECRETS_DIR}/deployment_id" \
  "${SECRETS_DIR}/database_url" \
  "${SECRETS_DIR}/livekit_api_key" \
  "${SECRETS_DIR}/livekit_api_secret"

if [[ "${INSECURE_MODE}" == "true" ]]; then
  # Older clients do not provide this new argument during a redeployment.
  # localhost is correct for the supported WSL test setup; current clients pass
  # the requested SSH host for a remote IP deployment.
  if [[ -z "${VOICE_PUBLIC_HOST}" ]]; then
    VOICE_PUBLIC_HOST="localhost"
    printf 'Voice public host was not supplied; using localhost for insecure mode.\n' >&2
  fi
  if [[ ! "${VOICE_PUBLIC_HOST}" =~ ^[-A-Za-z0-9._:]+$ ]]; then
    printf 'Voice public host contains unsupported characters.\n' >&2
    exit 1
  fi
  printf 'OPENCORD_DOMAIN=localhost\nACME_EMAIL=unused@example.invalid\nOPENCORD_VERSION=local\nSERVER_LOG_LEVEL=info\nVOICE_PUBLIC_HOST=%s\n' "${VOICE_PUBLIC_HOST}" > "${DEPLOY_DIR}/.env"
else
  printf 'OPENCORD_DOMAIN=%s\nACME_EMAIL=%s\nOPENCORD_VERSION=local\nSERVER_LOG_LEVEL=info\n' \
    "${OPENCORD_DOMAIN}" "${ACME_EMAIL}" > "${DEPLOY_DIR}/.env"
fi
chmod 0600 "${DEPLOY_DIR}/.env"

compose() {
  local files=(--file "${DEPLOY_DIR}/compose.yml")
  if [[ "${INSECURE_MODE}" == "true" ]]; then files+=(--file "${DEPLOY_DIR}/compose.insecure.yml"); fi
  docker compose --project-directory "${INSTALL_ROOT}" --env-file "${DEPLOY_DIR}/.env" "${files[@]}" "$@"
}

printf 'Validating the OpenCord Compose configuration...\n'
compose config --quiet
printf 'Pulling infrastructure images and building OpenCord Server...\n'
if [[ "${INSECURE_MODE}" == "true" ]]; then compose pull database livekit; else compose pull database caddy livekit; fi
compose build --pull server
if [[ "${INSECURE_MODE}" == "true" ]]; then
  compose stop caddy >/dev/null 2>&1 || true
  compose rm --force caddy >/dev/null 2>&1 || true
  compose up --detach --remove-orphans database livekit server
else
  compose up --detach --remove-orphans
fi
# Recreate only the stateless application container so updated file-backed
# secret ownership and a freshly built image are always applied. Database and
# Caddy volumes remain intact across an idempotent redeployment.
compose up --detach --force-recreate --no-deps server

printf 'Waiting for OpenCord Server to become healthy...\n'
server_container="$(compose ps --quiet server)"
for attempt in $(seq 1 60); do
  server_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${server_container}" 2>/dev/null || true)"
  if [[ "${server_health}" == "healthy" ]]; then
    break
  fi
  if [[ "${server_health}" == "unhealthy" || "${server_health}" == "exited" ]]; then
    compose logs --tail 100 server >&2
    printf 'OpenCord Server failed its healthcheck.\n' >&2
    exit 1
  fi
  if [[ "${attempt}" -eq 60 ]]; then
    compose logs --tail 100 server >&2
    printf 'Timed out while waiting for OpenCord Server.\n' >&2
    exit 1
  fi
  sleep 2
done

printf '\nOpenCord containers are healthy.\n'
if [[ "${INSECURE_MODE}" == "true" ]]; then
  printf 'INSECURE endpoint: http://<server-address>:3210\nNo TLS is configured. Do not expose this mode to an untrusted network.\n'
else
  public_health="pending"
  for _attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 10 "https://${OPENCORD_DOMAIN}/health" >/dev/null 2>&1; then
      public_health="ready"
      break
    fi
    sleep 3
  done
fi
if [[ "${INSECURE_MODE}" != "true" && "${public_health:-pending}" == "ready" ]]; then
  printf 'Public endpoint: https://%s\nWebSocket endpoint: wss://%s/ws\n' "${OPENCORD_DOMAIN}" "${OPENCORD_DOMAIN}"
elif [[ "${INSECURE_MODE}" != "true" ]]; then
  printf 'TLS endpoint is not reachable yet. Check DNS A/AAAA records and inbound TCP ports 80/443 (plus UDP 443 for HTTP/3), then inspect: docker compose --env-file %s/.env -f %s/compose.yml logs caddy\n' "${DEPLOY_DIR}" "${DEPLOY_DIR}"
fi
if [[ "${INSECURE_MODE}" == "true" ]]; then
  management_endpoint='http://<server-address>:3210'
else
  management_endpoint="https://${OPENCORD_DOMAIN}"
fi
bash "${DEPLOY_DIR}/management/install-management-home" docker "${INSECURE_MODE}" "${management_endpoint}" "${OPENCORD_DOMAIN}" "${ACME_EMAIL}" "${VOICE_PUBLIC_HOST:-${OPENCORD_DOMAIN}}"
printf 'Re-running this installer updates the application without deleting the PostgreSQL volume.\n'
