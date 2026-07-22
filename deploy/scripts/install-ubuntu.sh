#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_ROOT="/opt/opencord"
INSTALL_DOCKER="true"
OPENCORD_DOMAIN="${OPENCORD_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

usage() {
  printf 'Usage: sudo bash deploy/scripts/install-ubuntu.sh --domain chat.example.com --email admin@example.com [--install-dir /opt/opencord] [--skip-docker-install]\n'
}

while (($#)); do
  case "$1" in
    --domain) OPENCORD_DOMAIN="${2:-}"; shift 2 ;;
    --email) ACME_EMAIL="${2:-}"; shift 2 ;;
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

if [[ -z "${OPENCORD_DOMAIN}" || ! "${OPENCORD_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ || "${OPENCORD_DOMAIN}" != *.* ]]; then
  printf 'A valid DNS hostname is required through --domain.\n' >&2
  exit 1
fi

if [[ -z "${ACME_EMAIL}" || "${ACME_EMAIL}" != *@*.* ]]; then
  printf 'A valid ACME contact email is required through --email.\n' >&2
  exit 1
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

for required_file in .dockerignore package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json deploy/Dockerfile deploy/compose.yml deploy/Caddyfile server/package.json shared/package.json; do
  if [[ ! -f "${SOURCE_ROOT}/${required_file}" ]]; then
    printf 'Installation bundle is incomplete: %s is missing.\n' "${required_file}" >&2
    exit 1
  fi
done

install_docker_engine() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    systemctl enable --now docker
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
  if ss -H -ltn | awk '{print $4}' | grep -Eq '(^|:)(80|443)$'; then
    printf 'TCP port 80 or 443 is already in use. Stop the conflicting service before installation.\n' >&2
    exit 1
  fi
}

install_docker_engine
check_initial_ports

if ! getent passwd opencord >/dev/null; then
  useradd --system --home-dir "${INSTALL_ROOT}" --shell /usr/sbin/nologin opencord
fi

install -d -m 0750 -o root -g opencord "${INSTALL_ROOT}" "${INSTALL_ROOT}/deploy"

tar --create --file - --directory "${SOURCE_ROOT}" \
  --exclude='node_modules' --exclude='dist' --exclude='.data' --exclude='coverage' \
  .dockerignore package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json \
  server shared deploy/Dockerfile deploy/compose.yml deploy/Caddyfile deploy/.env.example \
  | tar --extract --file - --directory "${INSTALL_ROOT}"

DEPLOY_DIR="${INSTALL_ROOT}/deploy"
SECRETS_DIR="${DEPLOY_DIR}/secrets"
install -d -m 0700 -o root -g root "${SECRETS_DIR}"

if [[ ! -s "${SECRETS_DIR}/postgres_password" ]]; then
  openssl rand -hex 32 > "${SECRETS_DIR}/postgres_password"
fi
chmod 0600 "${SECRETS_DIR}/postgres_password"

postgres_password="$(tr -d '\r\n' < "${SECRETS_DIR}/postgres_password")"
printf 'postgresql://opencord:%s@database:5432/opencord\n' "${postgres_password}" > "${SECRETS_DIR}/database_url"
unset postgres_password
chmod 0600 "${SECRETS_DIR}/database_url"

printf 'OPENCORD_DOMAIN=%s\nACME_EMAIL=%s\nOPENCORD_VERSION=local\nSERVER_LOG_LEVEL=info\n' \
  "${OPENCORD_DOMAIN}" "${ACME_EMAIL}" > "${DEPLOY_DIR}/.env"
chmod 0600 "${DEPLOY_DIR}/.env"

compose() {
  docker compose --project-directory "${INSTALL_ROOT}" --env-file "${DEPLOY_DIR}/.env" --file "${DEPLOY_DIR}/compose.yml" "$@"
}

printf 'Validating the OpenCord Compose configuration...\n'
compose config --quiet
printf 'Pulling infrastructure images and building OpenCord Server...\n'
compose pull database caddy
compose build --pull server
compose up --detach --remove-orphans

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

public_health="pending"
for _attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 10 "https://${OPENCORD_DOMAIN}/health" >/dev/null 2>&1; then
    public_health="ready"
    break
  fi
  sleep 3
done

printf '\nOpenCord containers are healthy.\n'
if [[ "${public_health}" == "ready" ]]; then
  printf 'Public endpoint: https://%s\nWebSocket endpoint: wss://%s/ws\n' "${OPENCORD_DOMAIN}" "${OPENCORD_DOMAIN}"
else
  printf 'TLS endpoint is not reachable yet. Check DNS A/AAAA records and inbound TCP ports 80/443 (plus UDP 443 for HTTP/3), then inspect: docker compose --env-file %s/.env -f %s/compose.yml logs caddy\n' "${DEPLOY_DIR}" "${DEPLOY_DIR}"
fi
printf 'Re-running this installer updates the application without deleting the PostgreSQL volume.\n'
