#!/usr/bin/env bash
set -euo pipefail

BASE=/opt/mcpanel
ID="${1:-}"
[[ "$ID" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "Usage: sudo mcpanel-rollback YYYYMMDDTHHMMSSZ" >&2; exit 2; }
RELEASE="$BASE/releases/$ID"
[[ -d "$RELEASE/app" ]] || { echo "Unknown release: $ID" >&2; exit 2; }
COMPOSE=(docker compose --env-file "$BASE/.env" -f "$BASE/docker-compose.production.yml")

"${COMPOSE[@]}" stop backend frontend
rsync -a --delete "$RELEASE/app/" "$BASE/app/"
if [[ -f "$RELEASE/mcpanel.db" ]]; then
  cp "$RELEASE/mcpanel.db" "$BASE/data/mcpanel.db"
fi
chown -R mcpanel:mcpanel "$BASE/app" "$BASE/data"
"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d --remove-orphans
echo "Rolled back to $ID"
