#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="codex-web.service"
UNIT_PATH="${HOME}/.config/systemd/user/${SERVICE_NAME}"
ENV_FILE="${HOME}/.config/codex-web/service.env"
LOG_DIR="${HOME}/.codex-web/logs"

if [[ ! -f "${UNIT_PATH}" ]]; then
  echo "missing systemd unit: ${UNIT_PATH}" >&2
  exit 1
fi

echo "unit: ${UNIT_PATH}"
echo "config file: ${ENV_FILE}"
echo "logs: ${LOG_DIR}"
systemctl --user status "${SERVICE_NAME}" --no-pager
