#!/usr/bin/env bash
set -euo pipefail
umask 077

LABEL="${CODEX_WEB_LAUNCHD_LABEL:-com.chenyanshan.codex-web}"
LAUNCHD_DOMAIN="gui/${UID}"
LAUNCHD_TARGET="${LAUNCHD_DOMAIN}/${LABEL}"

launchctl disable "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true
if launchctl print "${LAUNCHD_TARGET}" >/dev/null 2>&1; then
  launchctl bootout "${LAUNCHD_TARGET}"
fi

echo "stopped: ${LAUNCHD_TARGET}"
