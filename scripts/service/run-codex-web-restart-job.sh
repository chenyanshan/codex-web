#!/usr/bin/env bash
set -euo pipefail
umask 077

# Runs in a separate launchd job, never in the service process being replaced.
if [[ "$#" != 6 ]]; then
  echo 'usage: run-codex-web-restart-job.sh domain label plist mode rollback-plist helper-plist' >&2
  exit 1
fi
DOMAIN="$1"
LABEL="$2"
PLIST_PATH="$3"
MODE="$4"
ROLLBACK_PATH="$5"
HELPER_PLIST_PATH="$6"
TARGET="${DOMAIN}/${LABEL}"
PREVIOUS_PID=''
WAIT_FOR_UNLOAD=0

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
running_pid() {
  launchctl print "${TARGET}" 2>/dev/null | awk '
    /^[[:space:]]*state = running$/ { running = 1 }
    /^[[:space:]]*pid = / { pid = $3 }
    END { if (running) print pid }
  '
}

start_and_wait() {
  local attempt current_pid stable_pid=''
  launchctl enable "${TARGET}" || log "enable failed; retrying load: ${TARGET}"
  for ((attempt = 1; attempt <= 20; attempt++)); do
    # bootout is asynchronous: print can still succeed while a job is being
    # removed, and kickstart returns 37 (operation already in progress).
    if [[ "${WAIT_FOR_UNLOAD}" == 1 ]] && launchctl print "${TARGET}" >/dev/null 2>&1; then
      log "waiting for unload: attempt ${attempt}"
      sleep 1
      continue
    fi
    WAIT_FOR_UNLOAD=0
    if ! launchctl print "${TARGET}" >/dev/null 2>&1; then
      launchctl bootstrap "${DOMAIN}" "${PLIST_PATH}" || log "bootstrap attempt ${attempt} failed"
    fi
    # RunAtLoad/KeepAlive starts the loaded job. A kickstart here can block
    # behind launchd's crash throttle and prevent the bounded rollback below.
    current_pid="$(running_pid || true)"
    if [[ -n "${current_pid}" && "${current_pid}" != "${PREVIOUS_PID}" && "${current_pid}" == "${stable_pid}" ]]; then
      log "running: ${TARGET} pid=${current_pid}"
      return 0
    fi
    stable_pid="${current_pid}"
    sleep 1
  done
  return 1
}

trap 'result=$?; log "restart job finished: ${TARGET} exit=${result}"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
log "restart job started: ${TARGET} mode=${MODE}"
if [[ "${MODE}" != restart && "${MODE}" != reload ]]; then
  log 'invalid restart mode'; exit 1
fi
plutil -lint "${PLIST_PATH}"
if [[ -n "${ROLLBACK_PATH}" ]]; then plutil -lint "${ROLLBACK_PATH}"; fi
# No daily timer or login replay: the loaded one-shot job retains its status,
# while its autoload file is removed before touching the service.
rm -f "${HELPER_PLIST_PATH}"
sleep 3
PREVIOUS_PID="$(running_pid || true)"
if [[ "${MODE}" == reload ]]; then
  WAIT_FOR_UNLOAD=1
  launchctl bootout "${TARGET}" || log "job is already absent or stopping: ${TARGET}"
elif [[ -n "${PREVIOUS_PID}" ]]; then
  launchctl kickstart -k "${TARGET}" || log "restart is pending: ${TARGET}"
fi

if start_and_wait; then exit 0; fi
log "requested service did not become stable: ${TARGET}"
if [[ -n "${ROLLBACK_PATH}" ]]; then
  log 'restoring previous launch configuration'
  cp -p "${ROLLBACK_PATH}" "${PLIST_PATH}.recovery.$$"
  mv -f "${PLIST_PATH}.recovery.$$" "${PLIST_PATH}"
  WAIT_FOR_UNLOAD=1
  launchctl bootout "${TARGET}" || true
  if start_and_wait; then
    log 'previous launch configuration recovered; requested change failed'
    exit 2
  fi
fi
log "recovery failed; run scripts/service/restart-codex-web-launchd-user.sh from a terminal"
exit 1
