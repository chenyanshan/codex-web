#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="codex-web.service"
UNIT_PATH="${HOME}/.config/systemd/user/${SERVICE_NAME}"

if [[ ! -f "${UNIT_PATH}" ]]; then
  echo "missing systemd unit: ${UNIT_PATH}" >&2
  echo "install it with scripts/service/install-codex-web-systemd-user.sh" >&2
  exit 1
fi

systemctl --user daemon-reload
systemctl --user restart "${SERVICE_NAME}"
systemctl --user status "${SERVICE_NAME}" --no-pager
