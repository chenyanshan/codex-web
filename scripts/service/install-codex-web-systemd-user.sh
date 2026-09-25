#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="codex-web.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIG_DIR="${HOME}/.config/codex-web"
ENV_FILE="${CONFIG_DIR}/service.env"
STATE_DIR="${HOME}/.codex-web"
LOG_DIR="${STATE_DIR}/logs"
STDOUT_LOG="${LOG_DIR}/codex-web.stdout.log"
STDERR_LOG="${LOG_DIR}/codex-web.stderr.log"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
UNIT_PATH="${SYSTEMD_DIR}/${SERVICE_NAME}"
START_SERVICE="yes"

usage() {
  cat <<'EOF'
Usage:
  scripts/service/install-codex-web-systemd-user.sh [--no-start]

Options:
  --no-start  Write and enable the user systemd unit without starting it.
  --help      Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-start)
      START_SERVICE="no"
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer only supports Linux systemd user services." >&2
  exit 1
fi

command -v systemctl >/dev/null 2>&1 || {
  echo "systemctl is required but was not found in PATH." >&2
  exit 1
}

NPM_BIN="$(command -v npm || true)"
if [[ -z "${NPM_BIN}" ]]; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi
NODE_BIN="$(command -v node || true)"
NODE_BIN_DIR=""

node_major_version() {
  local candidate="$1"
  local version
  version="$("${candidate}" -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
  if [[ "${version}" =~ ^[0-9]+$ ]]; then
    printf '%s' "${version}"
    return
  fi
  printf '0'
}

select_node_bin() {
  local candidates=(
    "${CODEX_WEB_NODE_BIN:-}"
    "${REPO_ROOT}/../.local/node-v24.16.0/bin/node"
    "${HOME}/.local/node-v24.16.0/bin/node"
    "/home/ubuntu/workspace/.local/node-v24.16.0/bin/node"
    "$(command -v node || true)"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -n "${candidate}" && -x "${candidate}" && "$(node_major_version "${candidate}")" -ge 24 ]]; then
      printf '%s' "${candidate}"
      return
    fi
  done
}

SELECTED_NODE_BIN="$(select_node_bin)"
if [[ -z "${SELECTED_NODE_BIN}" ]]; then
  echo "Node.js >=24 is required. Set CODEX_WEB_NODE_BIN to a Node 24+ binary." >&2
  exit 1
fi
NODE_BIN="${SELECTED_NODE_BIN}"
NODE_BIN_DIR="$(dirname "${NODE_BIN}")"
NPM_BIN="${NODE_BIN_DIR}/npm"
if [[ ! -x "${NPM_BIN}" ]]; then
  NPM_BIN="$(command -v npm || true)"
fi

CODEX_BIN="$(command -v codex || true)"
if [[ -z "${CODEX_BIN}" ]]; then
  CODEX_BIN="codex"
fi

write_default_env_file_if_missing() {
  if [[ -f "${ENV_FILE}" ]]; then
    return
  fi

  mkdir -p "${CONFIG_DIR}"
  umask 077
  cat > "${ENV_FILE}" <<EOF
# Codex Web systemd user service configuration.
# Do not store CODEX_WEB_PASSWORD in this file.
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=${REPO_ROOT}
CODEX_REAL_BIN=${CODEX_BIN}
CODEX_WEB_DEBUG=0
EOF
  chmod 600 "${ENV_FILE}"
}

write_unit() {
  mkdir -p "${SYSTEMD_DIR}"
  cat > "${UNIT_PATH}" <<EOF
[Unit]
Description=Codex Web mobile console
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_ROOT}
EnvironmentFile=${ENV_FILE}
Environment=PATH=${NODE_BIN_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${NPM_BIN} run serve --workspace packages/codex-web
Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=15
StandardOutput=append:${STDOUT_LOG}
StandardError=append:${STDERR_LOG}

[Install]
WantedBy=default.target
EOF
}

mkdir -p "${LOG_DIR}"
touch "${STDOUT_LOG}" "${STDERR_LOG}"
chmod 700 "${STATE_DIR}" "${LOG_DIR}" 2>/dev/null || true

write_default_env_file_if_missing
write_unit

systemctl --user daemon-reload
if [[ "${START_SERVICE}" == "yes" ]]; then
  systemctl --user enable --now "${SERVICE_NAME}"
else
  systemctl --user enable "${SERVICE_NAME}"
fi

echo "installed systemd user service: ${UNIT_PATH}"
echo "config file: ${ENV_FILE}"
echo "logs: ${LOG_DIR}"
echo "status command: systemctl --user status ${SERVICE_NAME}"
