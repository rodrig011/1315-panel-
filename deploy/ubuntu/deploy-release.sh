#!/usr/bin/env bash
set -euo pipefail

BASE=/opt/mcpanel
STAGING="$BASE/staging"
APP="$BASE/app"
RELEASES="$BASE/releases"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="$RELEASES/$STAMP"
COMPOSE=(docker compose --env-file "$BASE/.env" -f "$BASE/docker-compose.production.yml")

[[ -f "$STAGING/package.json" && -f "$STAGING/backend/package.json" ]] || {
  echo "Stage a complete project in $STAGING first." >&2
  exit 2
}

mkdir -p "$RELEASE/app"
rsync -a --delete --exclude node_modules --exclude .next --exclude .git "$APP/" "$RELEASE/app/"
if [[ -f "$BASE/data/mcpanel.db" ]]; then
  sqlite3 "$BASE/data/mcpanel.db" ".timeout 10000" ".backup '$RELEASE/mcpanel.db'"
fi

rollback() {
  echo "Deployment failed; restoring $STAMP" >&2
  rsync -a --delete "$RELEASE/app/" "$APP/"
  if [[ -f "$RELEASE/mcpanel.db" ]]; then
    cp "$RELEASE/mcpanel.db" "$BASE/data/mcpanel.db"
    chown mcpanel:mcpanel "$BASE/data/mcpanel.db"
  fi
  chown -R mcpanel:mcpanel "$APP"
  "${COMPOSE[@]}" build
  "${COMPOSE[@]}" up -d --remove-orphans
}
trap rollback ERR

rsync -a --delete --exclude node_modules --exclude .next --exclude .git "$STAGING/" "$APP/"
chown -R mcpanel:mcpanel "$APP"
"${COMPOSE[@]}" build --pull
"${COMPOSE[@]}" up -d --remove-orphans

for service in backend frontend; do
  cid="$("${COMPOSE[@]}" ps -q "$service")"
  [[ -n "$cid" ]]
  healthy=0
  for _ in $(seq 1 30); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
    if [[ "$status" == healthy || "$status" == running ]]; then healthy=1; break; fi
    if [[ "$status" == unhealthy || "$status" == exited || "$status" == dead ]]; then break; fi
    sleep 2
  done
  [[ "$healthy" -eq 1 ]] || { echo "$service failed health verification" >&2; false; }
done

trap - ERR
rm -rf "$STAGING"/*
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | awk 'NR>5 {print $2}' | xargs -r rm -rf
printf 'Deployment successful. Rollback id: %s\n' "$STAMP"
