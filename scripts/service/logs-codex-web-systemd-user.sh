#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="codex-web.service"
LOG_DIR="${HOME}/.codex-web/logs"
STDOUT_LOG="${LOG_DIR}/codex-web.stdout.log"
STDERR_LOG="${LOG_DIR}/codex-web.stderr.log"

mkdir -p "${LOG_DIR}"
touch "${STDOUT_LOG}" "${STDERR_LOG}"

echo "journal: journalctl --user -u ${SERVICE_NAME}"
echo "stdout: ${STDOUT_LOG}"
echo "stderr: ${STDERR_LOG}"
exec journalctl --user -u "${SERVICE_NAME}" -n 80 -f
