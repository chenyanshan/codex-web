#!/usr/bin/env bash
set -euo pipefail
umask 077

LABEL="${CODEX_WEB_LAUNCHD_LABEL:-com.chenyanshan.codex-web}"
ROTATION_LABEL="${LABEL}.logrotate"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROTATION_SCRIPT="${SCRIPT_DIR}/rotate-codex-web-logs.sh"
NODE_BIN="$(command -v node)"
CONFIG_DIR="${HOME}/.config/codex-web"
ENV_FILE="${CONFIG_DIR}/service.env"
STATE_DIR="${HOME}/.codex-web"
LOG_DIR="${STATE_DIR}/logs"
STDOUT_LOG="${LOG_DIR}/codex-web.stdout.log"
STDERR_LOG="${LOG_DIR}/codex-web.stderr.log"
ROTATION_LOG="${LOG_DIR}/codex-web-logrotate.log"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
ROTATION_PLIST_PATH="${PLIST_DIR}/${ROTATION_LABEL}.plist"
LAUNCHD_DOMAIN="gui/${UID}"
LAUNCHD_TARGET="${LAUNCHD_DOMAIN}/${LABEL}"
ROTATION_TARGET="${LAUNCHD_DOMAIN}/${ROTATION_LABEL}"

shell_escape() {
  printf '%q' "$1"
}

env_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "${value}"
}

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "${value}"
}

write_default_env_file_if_missing() {
  if [[ -f "${ENV_FILE}" ]]; then
    return
  fi

  mkdir -p "${CONFIG_DIR}"
  umask 077
  cat > "${ENV_FILE}" <<EOF
# Codex Web launchd service configuration.
# Do not store CODEX_WEB_PASSWORD in this file.
CODEX_WEB_HOST=$(env_escape "0.0.0.0")
CODEX_WEB_PORT=$(env_escape "43210")
CODEX_WEB_DEFAULT_CWD=$(env_escape "${REPO_ROOT}")
CODEX_REAL_BIN=$(env_escape "codex")
CODEX_WEB_DEBUG=$(env_escape "0")
# Public share links are disabled unless explicitly enabled.
CODEX_WEB_PUBLIC_SHARES_ENABLED=$(env_escape "false")
CODEX_WEB_PUBLIC_SHARE_TTL_SECONDS=$(env_escape "86400")
# Managed state uses a 2 GiB total cap. Project uploads use 512 MiB per project.
CODEX_WEB_MANAGED_STORAGE_MAX_BYTES=$(env_escape "2147483648")
CODEX_WEB_PROJECT_UPLOAD_MAX_BYTES=$(env_escape "536870912")
CODEX_WEB_UPLOAD_TTL_SECONDS=$(env_escape "604800")
CODEX_WEB_TURN_ATTACHMENT_TTL_SECONDS=$(env_escape "2592000")
CODEX_WEB_REPORT_TTL_SECONDS=$(env_escape "31536000")
CODEX_WEB_RUNTIME_CONTEXT_TTL_SECONDS=$(env_escape "2592000")
CODEX_WEB_TIMELINE_MAX_ENTRIES_PER_SESSION=$(env_escape "500")
CODEX_WEB_TIMELINE_MAX_BYTES=$(env_escape "16777216")
# launchd log rotation runs hourly and retains five 10 MiB generations.
CODEX_WEB_LOG_MAX_BYTES=$(env_escape "10485760")
CODEX_WEB_LOG_GENERATIONS=$(env_escape "5")
EOF
  chmod 600 "${ENV_FILE}"
}

write_plist() {
  local command
  command=$(
    printf 'set -euo pipefail; mkdir -p %s; set -a; source %s; set +a; cd %s; exec %s --conditions=development --import tsx packages/codex-web/src/cli.ts serve' \
      "$(shell_escape "${LOG_DIR}")" \
      "$(shell_escape "${ENV_FILE}")" \
      "$(shell_escape "${REPO_ROOT}")" \
      "$(shell_escape "${NODE_BIN}")"
  )

  mkdir -p "${PLIST_DIR}"
  cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$(xml_escape "${LABEL}")</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>-lc</string>
      <string>$(xml_escape "${command}")</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$(xml_escape "${REPO_ROOT}")</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$(xml_escape "${STDOUT_LOG}")</string>
    <key>StandardErrorPath</key>
    <string>$(xml_escape "${STDERR_LOG}")</string>
  </dict>
</plist>
EOF
}

write_rotation_plist() {
  local command
  command=$(
    printf 'set -euo pipefail; set -a; source %s; set +a; exec %s' \
      "$(shell_escape "${ENV_FILE}")" \
      "$(shell_escape "${ROTATION_SCRIPT}")"
  )

  cat > "${ROTATION_PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$(xml_escape "${ROTATION_LABEL}")</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>-lc</string>
      <string>$(xml_escape "${command}")</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>$(xml_escape "${ROTATION_LOG}")</string>
    <key>StandardErrorPath</key>
    <string>$(xml_escape "${ROTATION_LOG}")</string>
  </dict>
</plist>
EOF
}

mkdir -p "${LOG_DIR}"
touch "${STDOUT_LOG}" "${STDERR_LOG}" "${ROTATION_LOG}"
chmod 700 "${STATE_DIR}" "${LOG_DIR}" 2>/dev/null || true
chmod 600 "${STDOUT_LOG}" "${STDERR_LOG}" "${ROTATION_LOG}"

write_default_env_file_if_missing
write_plist
write_rotation_plist

# Do not bootout an already loaded job here. This script may be invoked by a
# Codex turn running under the service itself; unloading that job kills the
# caller before it can bootstrap the replacement.
if launchctl print "${LAUNCHD_TARGET}" >/dev/null 2>&1; then
  echo "launch agent already loaded: ${LAUNCHD_TARGET}"
else
  launchctl bootstrap "${LAUNCHD_DOMAIN}" "${PLIST_PATH}"
fi
launchctl enable "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true
launchctl kickstart -k "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true

if launchctl print "${ROTATION_TARGET}" >/dev/null 2>&1; then
  echo "log rotation agent already loaded: ${ROTATION_TARGET}"
else
  launchctl bootstrap "${LAUNCHD_DOMAIN}" "${ROTATION_PLIST_PATH}"
fi
launchctl enable "${ROTATION_TARGET}" >/dev/null 2>&1 || true
launchctl kickstart "${ROTATION_TARGET}" >/dev/null 2>&1 || true

echo "installed launch agent: ${PLIST_PATH}"
echo "installed log rotation agent: ${ROTATION_PLIST_PATH}"
echo "config file: ${ENV_FILE}"
echo "logs: ${LOG_DIR}"
echo "status label: ${LAUNCHD_TARGET}"
