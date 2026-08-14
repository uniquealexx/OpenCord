#!/bin/sh
set -eu

api_key="$(tr -d '\r\n' < /run/secrets/livekit_api_key)"
api_secret="$(tr -d '\r\n' < /run/secrets/livekit_api_secret)"
# На VPS дефолты корректны (STUN находит публичный IP). Локальный стек (compose.local.yml)
# выставляет LIVEKIT_USE_EXTERNAL_IP=false и LIVEKIT_NODE_IP=127.0.0.1, потому что за NAT
# Docker Desktop STUN находит IP роутера, недостижимый с хоста, и медиа не проходит.
use_external_ip="${LIVEKIT_USE_EXTERNAL_IP:-true}"
node_ip_line=""
if [ -n "${LIVEKIT_NODE_IP:-}" ]; then
  node_ip_line="  node_ip: \"${LIVEKIT_NODE_IP}\""
fi

cat > /tmp/livekit.yaml <<EOF
port: 7880
bind_addresses:
  - 0.0.0.0
keys:
  "${api_key}": "${api_secret}"
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: ${use_external_ip}
${node_ip_line}
turn:
  enabled: true
  udp_port: 3478
webhook:
  api_key: "${api_key}"
  urls:
    - "${LIVEKIT_WEBHOOK_URL}"
EOF

exec /livekit-server --config /tmp/livekit.yaml
