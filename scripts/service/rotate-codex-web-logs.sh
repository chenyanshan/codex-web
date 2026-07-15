#!/usr/bin/env bash
set -euo pipefail
umask 077

LOG_DIR="${CODEX_WEB_LOG_DIR:-${HOME}/.codex-web/logs}"
MAX_BYTES="${CODEX_WEB_LOG_MAX_BYTES:-10485760}"
GENERATIONS="${CODEX_WEB_LOG_GENERATIONS:-5}"
LOCK_DIR="${LOG_DIR}/.rotation.lock"

require_positive_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "${value}" =~ ^[1-9][0-9]*$ ]]; then
    echo "${name} must be a positive integer" >&2
    exit 2
  fi
}

file_size() {
  local file_path="$1"
  if stat -f '%z' "${file_path}" >/dev/null 2>&1; then
    stat -f '%z' "${file_path}"
  else
    stat -c '%s' "${file_path}"
  fi
}

require_positive_integer CODEX_WEB_LOG_MAX_BYTES "${MAX_BYTES}"
require_positive_integer CODEX_WEB_LOG_GENERATIONS "${GENERATIONS}"
if (( GENERATIONS > 20 )); then
  echo "CODEX_WEB_LOG_GENERATIONS must not exceed 20" >&2
  exit 2
fi

mkdir -p "${LOG_DIR}"
chmod 700 "${LOG_DIR}" 2>/dev/null || true
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  owner_pid="$(sed -n '1p' "${LOCK_DIR}/pid" 2>/dev/null || true)"
  if [[ "${owner_pid}" =~ ^[1-9][0-9]*$ ]] && kill -0 "${owner_pid}" 2>/dev/null; then
    exit 0
  fi
  rm -rf "${LOCK_DIR}"
  mkdir "${LOCK_DIR}"
fi
printf '%s\n' "$$" > "${LOCK_DIR}/pid"
cleanup() {
  rm -rf "${LOCK_DIR}"
}
trap cleanup EXIT HUP INT TERM

while IFS= read -r -d '' log_file; do
  [[ -L "${log_file}" ]] && continue
  size="$(file_size "${log_file}")"
  if (( size <= MAX_BYTES )); then
    chmod 600 "${log_file}" 2>/dev/null || true
    continue
  fi

  rm -f "${log_file}.${GENERATIONS}"
  for (( generation = GENERATIONS - 1; generation >= 1; generation -= 1 )); do
    if [[ -f "${log_file}.${generation}" && ! -L "${log_file}.${generation}" ]]; then
      mv "${log_file}.${generation}" "${log_file}.$((generation + 1))"
    fi
  done

  temporary_copy="${log_file}.1.$$.tmp"
  cp -p "${log_file}" "${temporary_copy}"
  chmod 600 "${temporary_copy}"
  mv "${temporary_copy}" "${log_file}.1"
  : > "${log_file}"
  chmod 600 "${log_file}"
  echo "rotated: $(basename "${log_file}") (${size} bytes)"
done < <(find "${LOG_DIR}" -maxdepth 1 -type f -name 'codex-web*.log' -print0)
