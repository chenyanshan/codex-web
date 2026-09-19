#!/usr/bin/env bash
set -euo pipefail
umask 077

LABEL="${CODEX_WEB_LAUNCHD_LABEL:-com.chenyanshan.codex-web}"
HELPER_LABEL="${LABEL}.restart"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
HELPER_PLIST_PATH="${HOME}/Library/LaunchAgents/${HELPER_LABEL}.plist"
LAUNCHD_DOMAIN="gui/${UID}"
LAUNCHD_TARGET="${LAUNCHD_DOMAIN}/${LABEL}"
LOG_DIR="${HOME}/.codex-web/logs"
HELPER_LOG="${LOG_DIR}/${HELPER_LABEL}.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_SCRIPT="${SCRIPT_DIR}/run-codex-web-restart-job.sh"
MODE=restart
ROLLBACK_PATH=''

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "${value}"
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --reload-plist) MODE=reload; shift ;;
    --rollback-plist) ROLLBACK_PATH="${2:?missing rollback plist}"; shift 2 ;;
    *) echo 'usage: restart-codex-web-launchd-user-detached.sh [--reload-plist] [--rollback-plist path]' >&2; exit 1 ;;
  esac
done
plutil -lint "${PLIST_PATH}" >/dev/null
if [[ -n "${ROLLBACK_PATH}" ]]; then plutil -lint "${ROLLBACK_PATH}" >/dev/null; fi
if launchctl print "${LAUNCHD_DOMAIN}/${HELPER_LABEL}" 2>/dev/null | awk '/^[[:space:]]*pid = / { found = 1 } END { exit !found }'; then
  echo "restart already in progress: ${LAUNCHD_TARGET}" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}" "$(dirname "${HELPER_PLIST_PATH}")"
# Embed a snapshot: launchd's shell need not read a repository in a macOS
# protected Documents folder, and later edits cannot change the pending job.
cat > "${HELPER_PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>$(xml_escape "${HELPER_LABEL}")</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-c</string>
      <string>$(xml_escape "$(cat "${WORKER_SCRIPT}")")</string>
      <string>codex-web-restart</string>
      <string>$(xml_escape "${LAUNCHD_DOMAIN}")</string>
      <string>$(xml_escape "${LABEL}")</string>
      <string>$(xml_escape "${PLIST_PATH}")</string>
      <string>$(xml_escape "${MODE}")</string>
      <string>$(xml_escape "${ROLLBACK_PATH}")</string>
      <string>$(xml_escape "${HELPER_PLIST_PATH}")</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>$(xml_escape "${HELPER_LOG}")</string>
    <key>StandardErrorPath</key><string>$(xml_escape "${HELPER_LOG}")</string>
  </dict>
</plist>
PLIST
chmod 600 "${HELPER_PLIST_PATH}"

launchctl bootout "${LAUNCHD_DOMAIN}/${HELPER_LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "${LAUNCHD_DOMAIN}" "${HELPER_PLIST_PATH}"
# RunAtLoad starts it exactly once; kickstart -k here races that initial run.
echo "scheduled detached restart: ${LAUNCHD_TARGET}"
echo "helper label: ${LAUNCHD_DOMAIN}/${HELPER_LABEL}"
echo "helper log: ${HELPER_LOG}"
