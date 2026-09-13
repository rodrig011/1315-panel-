#!/usr/bin/env bash
set -euo pipefail
cd /opt/mcpanel
docker compose --env-file /opt/mcpanel/.env -f /opt/mcpanel/docker-compose.production.yml ps
echo
echo "Firewall:"
ufw status numbered
echo
echo "Fail2ban SSH jail:"
fail2ban-client status sshd || true
