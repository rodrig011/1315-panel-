#!/usr/bin/env bash
set -euo pipefail

BASE=/opt/mcpanel
DEST="$BASE/control-backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$DEST/$STAMP"
mkdir -p "$WORK"
chmod 0700 "$DEST" "$WORK"

if [[ -f "$BASE/data/mcpanel.db" ]]; then
  sqlite3 "$BASE/data/mcpanel.db" ".timeout 10000" ".backup '$WORK/mcpanel.db'"
fi
cp -a "$BASE/.env" "$WORK/.env"
cp -a "$BASE/docker-compose.production.yml" "$WORK/docker-compose.production.yml"
cp -a "$BASE/app/deploy/caddy/Caddyfile" "$WORK/Caddyfile"

tar -C "$DEST" -czf "$DEST/mcpanel-control-$STAMP.tar.gz" "$STAMP"
rm -rf "$WORK"
find "$DEST" -maxdepth 1 -type f -name 'mcpanel-control-*.tar.gz' -mtime +30 -delete

echo "$DEST/mcpanel-control-$STAMP.tar.gz"
