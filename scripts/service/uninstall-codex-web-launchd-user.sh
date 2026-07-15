#!/usr/bin/env bash
set -euo pipefail
umask 077

LABEL="${CODEX_WEB_LAUNCHD_LABEL:-com.chenyanshan.codex-web}"
ROTATION_LABEL="${LABEL}.logrotate"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
ROTATION_PLIST_PATH="${HOME}/Library/LaunchAgents/${ROTATION_LABEL}.plist"
LAUNCHD_DOMAIN="gui/${UID}"
LAUNCHD_TARGET="${LAUNCHD_DOMAIN}/${LABEL}"
ROTATION_TARGET="${LAUNCHD_DOMAIN}/${ROTATION_LABEL}"

launchctl disable "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true
launchctl disable "${ROTATION_TARGET}" >/dev/null 2>&1 || true
if launchctl print "${LAUNCHD_TARGET}" >/dev/null 2>&1; then
  launchctl bootout "${LAUNCHD_TARGET}"
fi
if launchctl print "${ROTATION_TARGET}" >/dev/null 2>&1; then
  launchctl bootout "${ROTATION_TARGET}"
fi
if [[ -f "${PLIST_PATH}" ]]; then
  rm "${PLIST_PATH}"
fi
if [[ -f "${ROTATION_PLIST_PATH}" ]]; then
  rm "${ROTATION_PLIST_PATH}"
fi

echo "uninstalled launch agent: ${LAUNCHD_TARGET}"
echo "uninstalled log rotation agent: ${ROTATION_TARGET}"
echo "preserved config: ${HOME}/.config/codex-web/service.env"
echo "preserved state: ${HOME}/.codex-web"
