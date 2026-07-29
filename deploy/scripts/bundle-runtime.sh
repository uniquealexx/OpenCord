#!/usr/bin/env bash

read_bundle_info() {
  local bundle_root="$1" info_file="${1}/bundle-info.json"
  if [[ ! -f "${info_file}" ]]; then
    printf 'Installation bundle is missing bundle-info.json.\n' >&2
    return 1
  fi
  BUNDLE_FORMAT_VERSION="$(sed -nE 's/^[[:space:]]*"formatVersion"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "${info_file}" | head -n 1)"
  BUNDLE_VERSION="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${info_file}" | head -n 1)"
  BUNDLE_RELEASE_CHANNEL="$(sed -nE 's/^[[:space:]]*"releaseChannel"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${info_file}" | head -n 1)"
  BUNDLE_COMMIT="$(sed -nE 's/^[[:space:]]*"commit"[[:space:]]*:[[:space:]]*"([a-f0-9]+)".*/\1/p' "${info_file}" | head -n 1)"
  BUNDLE_RUNTIME_FILE="$(sed -nE 's/^[[:space:]]*"fileName"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${info_file}" | head -n 1)"
  BUNDLE_RUNTIME_SHA256="$(sed -nE 's/^[[:space:]]*"sha256"[[:space:]]*:[[:space:]]*"([a-f0-9]+)".*/\1/p' "${info_file}" | head -n 1)"
  BUNDLE_RUNTIME_SIZE="$(sed -nE 's/^[[:space:]]*"sizeBytes"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "${info_file}" | head -n 1)"

  if [[ "${BUNDLE_FORMAT_VERSION}" != "1" || "${BUNDLE_RUNTIME_FILE}" != "server-runtime-linux-x64.tar.gz" ]]; then
    printf 'Unsupported OpenCord bundle format or runtime artifact.\n' >&2
    return 1
  fi
  if [[ ! "${BUNDLE_VERSION}" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)([-+][0-9A-Za-z.-]+)?$ ]]; then
    printf 'Bundle contains an invalid OpenCord version.\n' >&2
    return 1
  fi
  if [[ "${BUNDLE_RELEASE_CHANNEL}" != "development" && "${BUNDLE_RELEASE_CHANNEL}" != "beta" && "${BUNDLE_RELEASE_CHANNEL}" != "stable" ]]; then
    printf 'Bundle contains an unsupported release channel.\n' >&2
    return 1
  fi
  if [[ -n "${BUNDLE_COMMIT}" && ! "${BUNDLE_COMMIT}" =~ ^[a-f0-9]{40}$ ]]; then
    printf 'Bundle contains an invalid build commit.\n' >&2
    return 1
  fi
  if [[ "${BUNDLE_RELEASE_CHANNEL}" != "development" && -z "${BUNDLE_COMMIT}" ]]; then
    printf 'Published OpenCord bundles require a build commit.\n' >&2
    return 1
  fi
  if [[ ! "${BUNDLE_RUNTIME_SHA256}" =~ ^[a-f0-9]{64}$ || ! "${BUNDLE_RUNTIME_SIZE}" =~ ^[1-9][0-9]*$ ]]; then
    printf 'Bundle contains invalid runtime integrity metadata.\n' >&2
    return 1
  fi
  BUNDLE_RUNTIME_PATH="${bundle_root}/${BUNDLE_RUNTIME_FILE}"
  [[ -f "${BUNDLE_RUNTIME_PATH}" ]] || { printf 'Bundle runtime archive is missing.\n' >&2; return 1; }
}

verify_runtime_archive() {
  local runtime_path="$1" expected_sha256="$2" expected_size="$3" inspection_root actual_sha256 actual_size resolved_link
  actual_sha256="$(sha256sum -- "${runtime_path}" | awk '{print $1}')"
  actual_size="$(stat --format '%s' -- "${runtime_path}")"
  if [[ "${actual_sha256}" != "${expected_sha256}" || "${actual_size}" != "${expected_size}" ]]; then
    printf 'Server runtime integrity check failed.\n' >&2
    return 1
  fi
  if ! tar --list --gzip --file "${runtime_path}" >/dev/null; then
    printf 'Server runtime is not a valid tar.gz archive.\n' >&2
    return 1
  fi
  if tar --list --gzip --file "${runtime_path}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    printf 'Server runtime contains an unsafe path.\n' >&2
    return 1
  fi
  inspection_root="$(mktemp -d /tmp/opencord-runtime-inspect.XXXXXXXX)"
  if ! tar --extract --gzip --file "${runtime_path}" --directory "${inspection_root}" --no-same-owner --no-same-permissions; then
    rm -rf -- "${inspection_root}"
    return 1
  fi
  if find "${inspection_root}" -mindepth 1 ! -type f ! -type d ! -type l -print -quit | grep -q .; then
    printf 'Server runtime contains an unsupported filesystem entry.\n' >&2
    rm -rf -- "${inspection_root}"
    return 1
  fi
  while IFS= read -r -d '' link_path; do
    resolved_link="$(readlink -m -- "${link_path}")"
    if [[ "${resolved_link}" != "${inspection_root}"/* ]]; then
      printf 'Server runtime contains a symlink escaping the runtime root.\n' >&2
      rm -rf -- "${inspection_root}"
      return 1
    fi
  done < <(find "${inspection_root}" -type l -print0)
  if [[ ! -f "${inspection_root}/dist/index.js" || ! -f "${inspection_root}/package.json" ]]; then
    printf 'Server runtime is missing its production entrypoint.\n' >&2
    rm -rf -- "${inspection_root}"
    return 1
  fi
  rm -rf -- "${inspection_root}"
}
