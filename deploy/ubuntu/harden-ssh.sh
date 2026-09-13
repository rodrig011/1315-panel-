#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo mcpanel-harden-ssh" >&2
  exit 1
fi

KEYS=/home/mcpanel/.ssh/authorized_keys
if [[ ! -s "$KEYS" ]]; then
  echo "Refusing to disable root/password SSH: $KEYS is missing or empty." >&2
  exit 1
fi

install -m 0644 /opt/mcpanel/app/deploy/ubuntu/sshd-mcpanel.conf /etc/ssh/sshd_config.d/99-mcpanel-hardening.conf
sshd -t
systemctl reload ssh

echo "SSH hardened: password auth disabled and root SSH login disabled."
