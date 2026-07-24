#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_ROOT="/opt/opencord"
CONFIG_ROOT="/etc/opencord"
NODE_VERSION="24.18.0"
INSECURE_MODE="false"
OPENCORD_DOMAIN="${OPENCORD_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
OWNER_PUBLIC_KEY=""
SERVER_NAME=""
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
TEMP_DIR=""

cleanup() {
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf -- "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

usage() {
  printf 'Usage: sudo bash deploy/scripts/install-native-ubuntu.sh (--domain chat.example.com --email admin@example.com | --insecure) --owner-public-key BASE64_KEY --server-name NAME\n'
}

while (($#)); do
  case "$1" in
    --domain) OPENCORD_DOMAIN="${2:-}"; shift 2 ;;
    --email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --insecure) INSECURE_MODE="true"; shift ;;
    --owner-public-key) OWNER_PUBLIC_KEY="${2:-}"; shift 2 ;;
    --server-name) SERVER_NAME="${2:-}"; shift 2 ;;
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
if [[ "$(ps -p 1 -o comm= | tr -d ' ')" != "systemd" ]]; then
  printf 'Native installation requires systemd as PID 1.\n' >&2
  exit 1
fi
for required_file in package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json deploy/management/opencordctl deploy/management/install-management-home deploy/management/README.md server/package.json shared/package.json; do
  if [[ ! -f "${SOURCE_ROOT}/${required_file}" ]]; then
    printf 'Installation bundle is incomplete: %s is missing.\n' "${required_file}" >&2
    exit 1
  fi
done

case "$(uname -m)" in
  x86_64) node_arch="x64" ;;
  aarch64|arm64) node_arch="arm64" ;;
  *) printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

check_initial_ports() {
  if [[ -f "${INSTALL_ROOT}/.native-installed" ]] || ! command -v ss >/dev/null 2>&1; then
    return
  fi
  local port_pattern='(^|:)(80|443|3210)$'
  if [[ "${INSECURE_MODE}" == "true" ]]; then port_pattern='(^|:)3210$'; fi
  if ss -H -ltn | awk '{print $4}' | grep -Eq "${port_pattern}"; then
    printf 'A required TCP port is already in use. Stop the conflicting service before installation.\n' >&2
    exit 1
  fi
}

check_initial_ports
printf 'Installing native runtime dependencies...\n'
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl xz-utils gnupg openssl iproute2 debian-keyring debian-archive-keyring apt-transport-https postgresql postgresql-contrib

install_node() {
  if command -v node >/dev/null 2>&1 && [[ "$(node --version)" == "v${NODE_VERSION}" ]]; then
    return
  fi
  TEMP_DIR="$(mktemp -d)"
  local archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  local base_url="https://nodejs.org/dist/v${NODE_VERSION}"
  printf 'Installing verified Node.js %s for %s...\n' "${NODE_VERSION}" "${node_arch}"
  curl --fail --silent --show-error --location "${base_url}/${archive}" --output "${TEMP_DIR}/${archive}"
  curl --fail --silent --show-error --location "${base_url}/SHASUMS256.txt" --output "${TEMP_DIR}/SHASUMS256.txt"
  (cd "${TEMP_DIR}" && grep "  ${archive}$" SHASUMS256.txt | sha256sum --check --strict -)
  install -d -m 0755 /usr/local/lib/nodejs
  tar --extract --xz --file "${TEMP_DIR}/${archive}" --directory /usr/local/lib/nodejs
  local node_root="/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-${node_arch}"
  for binary in node npm npx corepack; do
    ln -sfn "${node_root}/bin/${binary}" "/usr/local/bin/${binary}"
  done
  rm -rf -- "${TEMP_DIR}"
  TEMP_DIR=""
}

install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    return
  fi
  TEMP_DIR="$(mktemp -d)"
  printf 'Installing Caddy from its official apt repository...\n'
  curl --fail --silent --show-error --location 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' --output "${TEMP_DIR}/caddy.gpg.key"
  gpg --batch --yes --dearmor --output /usr/share/keyrings/caddy-stable-archive-keyring.gpg "${TEMP_DIR}/caddy.gpg.key"
  curl --fail --silent --show-error --location 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' --output /etc/apt/sources.list.d/caddy-stable.list
  chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
  rm -rf -- "${TEMP_DIR}"
  TEMP_DIR=""
}

install_node
if [[ "${INSECURE_MODE}" != "true" ]]; then install_caddy; fi
corepack enable --install-directory /usr/local/bin

if ! getent group opencord >/dev/null; then
  groupadd --system opencord
fi
if ! getent passwd opencord >/dev/null; then
  useradd --system --gid opencord --home-dir /home/opencord --shell /usr/sbin/nologin opencord
fi
install -d -m 0750 -o root -g opencord "${INSTALL_ROOT}" "${INSTALL_ROOT}/releases" "${CONFIG_ROOT}"

if [[ ! -s "${CONFIG_ROOT}/owner_public_key" ]]; then
  printf '%s\n' "${OWNER_PUBLIC_KEY}" > "${CONFIG_ROOT}/owner_public_key"
fi
chown root:opencord "${CONFIG_ROOT}/owner_public_key"
chmod 0640 "${CONFIG_ROOT}/owner_public_key"
printf '%s\n' "${SERVER_NAME}" > "${CONFIG_ROOT}/server_name"
cat /proc/sys/kernel/random/uuid > "${CONFIG_ROOT}/deployment_id"
chown root:opencord "${CONFIG_ROOT}/server_name" "${CONFIG_ROOT}/deployment_id"
chmod 0640 "${CONFIG_ROOT}/server_name" "${CONFIG_ROOT}/deployment_id"

systemctl enable --now postgresql
database_password_file="${CONFIG_ROOT}/database_password"
if [[ ! -s "${database_password_file}" ]]; then
  openssl rand -hex 32 > "${database_password_file}"
fi
database_password="$(tr -d '\r\n' < "${database_password_file}")"
if [[ ! "${database_password}" =~ ^[a-f0-9]{64}$ ]]; then
  printf 'The stored PostgreSQL password has an unexpected format.\n' >&2
  exit 1
fi
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='opencord'" | grep -q 1; then
  runuser -u postgres -- createuser --login opencord
fi
runuser -u postgres -- psql --set ON_ERROR_STOP=1 --command "ALTER ROLE opencord WITH LOGIN PASSWORD '${database_password}'"
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='opencord'" | grep -q 1; then
  runuser -u postgres -- createdb --owner opencord opencord
fi
printf 'postgresql://opencord:%s@127.0.0.1:5432/opencord\n' "${database_password}" > "${CONFIG_ROOT}/database_url"
unset database_password
chown root:opencord "${database_password_file}" "${CONFIG_ROOT}/database_url"
chmod 0640 "${database_password_file}" "${CONFIG_ROOT}/database_url"

printf 'Building a versioned OpenCord Server release...\n'
cd "${SOURCE_ROOT}"
pnpm install --frozen-lockfile --filter @opencord/shared... --filter @opencord/server...
pnpm --filter @opencord/shared build
pnpm --filter @opencord/server build
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
release_dir="${INSTALL_ROOT}/releases/${release_id}"
pnpm --filter @opencord/server --prod deploy --legacy "${release_dir}"
chown -R root:opencord "${release_dir}"
chmod -R u=rwX,g=rX,o= "${release_dir}"

if [[ "${INSECURE_MODE}" == "true" ]]; then bind_host="0.0.0.0"; else bind_host="127.0.0.1"; fi
cat > /etc/systemd/system/opencord-server.service <<UNIT
[Unit]
Description=OpenCord Server
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=opencord
Group=opencord
WorkingDirectory=/opt/opencord/current
ExecStart=/usr/local/bin/node /opt/opencord/current/dist/index.js
Environment=HOST=${bind_host}
Environment=PORT=3210
Environment=LOG_LEVEL=info
Environment=DATABASE_URL_FILE=/etc/opencord/database_url
Environment=BOOTSTRAP_OWNER_PUBLIC_KEY_FILE=/etc/opencord/owner_public_key
Environment=SERVER_NAME_FILE=/etc/opencord/server_name
Environment=DEPLOYMENT_ID_FILE=/etc/opencord/deployment_id
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
LockPersonality=true

[Install]
WantedBy=multi-user.target
UNIT

previous_release=""
if [[ -L "${INSTALL_ROOT}/current" ]]; then
  resolved_current="$(readlink -e "${INSTALL_ROOT}/current" 2>/dev/null || true)"
  if [[ -n "${resolved_current}" && -d "${resolved_current}" && "${resolved_current}" != "${INSTALL_ROOT}/current" ]]; then
    previous_release="${resolved_current}"
  fi
fi
ln -sfn "${release_dir}" "${INSTALL_ROOT}/current.next"
mv -Tf "${INSTALL_ROOT}/current.next" "${INSTALL_ROOT}/current"
systemctl daemon-reload
systemctl enable opencord-server

rollback_release() {
  if [[ -n "${previous_release}" && -d "${previous_release}" ]]; then
    ln -sfn "${previous_release}" "${INSTALL_ROOT}/current.rollback"
    mv -Tf "${INSTALL_ROOT}/current.rollback" "${INSTALL_ROOT}/current"
    systemctl restart opencord-server || true
  else
    systemctl stop opencord-server || true
    rm -f -- "${INSTALL_ROOT}/current"
  fi
}

if ! systemctl restart opencord-server; then
  rollback_release
  journalctl -u opencord-server --no-pager -n 100 >&2
  printf 'OpenCord Server failed to start; the previous release was restored when available.\n' >&2
  exit 1
fi

printf 'Waiting for the native OpenCord service...\n'
local_health="pending"
for _attempt in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3210/health >/dev/null 2>&1; then
    local_health="ready"
    break
  fi
  if ! systemctl is-active --quiet opencord-server; then
    break
  fi
  sleep 2
done
if [[ "${local_health}" != "ready" ]]; then
  rollback_release
  journalctl -u opencord-server --no-pager -n 100 >&2
  printf 'OpenCord Server failed its local healthcheck; the previous release was restored when available.\n' >&2
  exit 1
fi

if [[ "${INSECURE_MODE}" != "true" ]]; then
  cat > /etc/caddy/Caddyfile <<EOF
# Managed by OpenCord
{
  email ${ACME_EMAIL}
}

${OPENCORD_DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3210
}
EOF
  caddy validate --config /etc/caddy/Caddyfile
  systemctl enable caddy
  systemctl reload-or-restart caddy

  public_health="pending"
  for _attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 10 "https://${OPENCORD_DOMAIN}/health" >/dev/null 2>&1; then
      public_health="ready"
      break
    fi
    sleep 3
  done
fi

touch "${INSTALL_ROOT}/.native-installed"
chown root:opencord "${INSTALL_ROOT}/.native-installed"
chmod 0640 "${INSTALL_ROOT}/.native-installed"
if [[ "${INSECURE_MODE}" == "true" ]]; then
  management_endpoint='http://<server-address>:3210'
else
  management_endpoint="https://${OPENCORD_DOMAIN}"
fi
bash "${SOURCE_ROOT}/deploy/management/install-management-home" native "${INSECURE_MODE}" "${management_endpoint}"
printf '\nOpenCord native services are healthy.\n'
if [[ "${INSECURE_MODE}" == "true" ]]; then
  printf 'INSECURE endpoint: http://<server-address>:3210\nNo TLS is configured. Do not expose this mode to an untrusted network.\n'
elif [[ "${public_health:-pending}" == "ready" ]]; then
  printf 'Public endpoint: https://%s\nWebSocket endpoint: wss://%s/ws\n' "${OPENCORD_DOMAIN}" "${OPENCORD_DOMAIN}"
else
  printf 'TLS endpoint is not reachable yet. Check DNS and inbound ports 80/443, then run: journalctl -u caddy -n 100\n'
fi
printf 'Re-running this installer creates a new application release without deleting PostgreSQL data.\n'
