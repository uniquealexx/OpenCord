#!/bin/sh
set -eu

api_key="$(tr -d '\r\n' < /run/secrets/livekit_api_key)"
api_secret="$(tr -d '\r\n' < /run/secrets/livekit_api_secret)"

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
  use_external_ip: true
turn:
  enabled: true
  udp_port: 3478
webhook:
  api_key: "${api_key}"
  urls:
    - "${LIVEKIT_WEBHOOK_URL}"
EOF

exec /livekit-server --config /tmp/livekit.yaml
