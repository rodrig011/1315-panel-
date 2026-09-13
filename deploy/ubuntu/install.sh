#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != ubuntu || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "This installer supports Ubuntu 24.04 only." >&2
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg git jq rsync unzip tar openssl sqlite3 \
  ufw fail2ban unattended-upgrades apt-transport-https

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<DOCKERREPO
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
DOCKERREPO

curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg
cat >/etc/apt/sources.list.d/nodesource.list <<'NODEREPO'
deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main
NODEREPO

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nodejs
systemctl enable --now docker

install -d -m 0755 /etc/docker
if [[ ! -f /etc/docker/daemon.json ]]; then
cat >/etc/docker/daemon.json <<'DOCKERDAEMON'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {"max-size": "10m", "max-file": "5"}
}
DOCKERDAEMON
systemctl restart docker
fi

if ! id mcpanel >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash mcpanel
fi
MCPANEL_UID="$(id -u mcpanel)"
MCPANEL_GID="$(id -g mcpanel)"

install -d -o mcpanel -g mcpanel -m 0750 /opt/mcpanel/app /opt/mcpanel/staging /opt/mcpanel/releases \
  /opt/mcpanel/data /srv/mcpanel/servers
install -d -o root -g root -m 0700 /opt/mcpanel/control-backups /opt/mcpanel/caddy/data /opt/mcpanel/caddy/config
install -d -o mcpanel -g mcpanel -m 0750 /var/log/mcpanel/backend
install -d -o root -g root -m 0750 /var/log/mcpanel/caddy

rsync -a --delete --exclude node_modules --exclude .next --exclude .git "$PROJECT_ROOT/" /opt/mcpanel/app/
chown -R mcpanel:mcpanel /opt/mcpanel/app /opt/mcpanel/staging /opt/mcpanel/releases /opt/mcpanel/data /srv/mcpanel/servers
install -m 0644 "$PROJECT_ROOT/docker-compose.production.yml" /opt/mcpanel/docker-compose.production.yml

if [[ -s /root/.ssh/authorized_keys && ! -s /home/mcpanel/.ssh/authorized_keys ]]; then
  install -d -o mcpanel -g mcpanel -m 0700 /home/mcpanel/.ssh
  install -o mcpanel -g mcpanel -m 0600 /root/.ssh/authorized_keys /home/mcpanel/.ssh/authorized_keys
fi

PUBLIC_IP_VALUE="${PUBLIC_IP:-}"
if [[ -z "$PUBLIC_IP_VALUE" ]]; then
  PUBLIC_IP_VALUE="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
fi
if [[ -z "$PUBLIC_IP_VALUE" ]]; then
  PUBLIC_IP_VALUE="$(hostname -I | awk '{print $1}')"
fi
if [[ -z "$PUBLIC_IP_VALUE" ]]; then
  echo "Could not determine the public IPv4 address. Re-run with PUBLIC_IP=x.x.x.x." >&2
  exit 2
fi

PANEL_DOMAIN_VALUE="${PANEL_DOMAIN:-}"
if [[ -n "$PANEL_DOMAIN_VALUE" ]]; then
  CADDY_SITE_ADDRESS_VALUE="$PANEL_DOMAIN_VALUE"
  PANEL_ORIGIN_VALUE="${PANEL_ORIGIN:-https://$PANEL_DOMAIN_VALUE}"
  COOKIE_SECURE_VALUE=true
  PANEL_URL="$PANEL_ORIGIN_VALUE"
else
  CADDY_SITE_ADDRESS_VALUE=":80"
  PANEL_ORIGIN_VALUE="${PANEL_ORIGIN:-http://$PUBLIC_IP_VALUE}"
  COOKIE_SECURE_VALUE=false
  PANEL_URL="$PANEL_ORIGIN_VALUE"
fi

PUBLIC_HOST_VALUE="${PUBLIC_HOST:-$PUBLIC_IP_VALUE}"
PUBLIC_HOST_VALUE="${PUBLIC_HOST_VALUE#http://}"
PUBLIC_HOST_VALUE="${PUBLIC_HOST_VALUE#https://}"
PUBLIC_HOST_VALUE="${PUBLIC_HOST_VALUE%%/*}"
ADMIN_PASSWORD_VALUE=""

if [[ ! -f /opt/mcpanel/.env ]]; then
  ADMIN_PASSWORD_VALUE="${ADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -d '\n')}"
  AUTH_ENCRYPTION_KEY_VALUE="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  AUTH_RECOVERY_PEPPER_VALUE="$(openssl rand -hex 32)"
  cat >/opt/mcpanel/.env <<ENVFILE
CADDY_SITE_ADDRESS=$CADDY_SITE_ADDRESS_VALUE
PANEL_DOMAIN=$PANEL_DOMAIN_VALUE
PANEL_ORIGIN=$PANEL_ORIGIN_VALUE
PUBLIC_IP=$PUBLIC_IP_VALUE
MCPANEL_UID=$MCPANEL_UID
MCPANEL_GID=$MCPANEL_GID
AUTH_ENCRYPTION_KEY=$AUTH_ENCRYPTION_KEY_VALUE
AUTH_RECOVERY_PEPPER=$AUTH_RECOVERY_PEPPER_VALUE
SESSION_TTL_HOURS=12
LOGIN_LOCKOUT_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
TOTP_ISSUER=1315 Panel
COOKIE_DOMAIN=
COOKIE_SECURE=$COOKIE_SECURE_VALUE
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=$ADMIN_PASSWORD_VALUE
COOKIE_NAME=mc_panel_session
CSRF_COOKIE_NAME=mc_panel_csrf
PUBLIC_HOST=$PUBLIC_HOST_VALUE
DATABASE_URL=file:/app/data/mcpanel.db
SERVER_DATA_ROOT=/srv/mcpanel/servers
BACKUP_ROOT=/srv/mcpanel/legacy-backups
DOCKER_HOST=tcp://socket-proxy:2375
DOCKER_NETWORK=mcpanel-internal
MINECRAFT_IMAGE_REPOSITORY=itzg/minecraft-server
MC_BIND_ADDRESS=0.0.0.0
MC_DEFAULT_JAVA_VERSION=21
MC_DEFAULT_RESTART_POLICY=unless-stopped
MC_MANAGE_OWNERSHIP=false
HOST_MEMORY_MB=8192
MC_MAX_MEMORY_MB=6144
MC_HEAP_RATIO=0.92
MC_TIMEZONE=America/Chicago
MAX_UPLOAD_BYTES=67108864
MAX_TEXT_FILE_BYTES=2097152
METRICS_INTERVAL_MS=5000
METRICS_RETENTION_HOURS=24
MOD_DOWNLOAD_HOSTS=cdn.modrinth.com
MODRINTH_API_HOST=api.modrinth.com
MODRINTH_USER_AGENT=1315-panel/1.0 (self-hosted)
MODRINTH_CACHE_TTL_MS=60000
MODRINTH_CACHE_MAX_ENTRIES=500
MODRINTH_TIMEOUT_MS=10000
MODRINTH_RETRY_COUNT=3
MODRINTH_RETRY_BASE_MS=250
TRUST_PROXY=true
LOG_LEVEL=info
ENVFILE
  chmod 0600 /opt/mcpanel/.env
fi

install -m 0755 "$PROJECT_ROOT/deploy/ubuntu/mcpanel-firewall.sh" /usr/local/sbin/mcpanel-firewall
install -m 0755 "$PROJECT_ROOT/deploy/ubuntu/harden-ssh.sh" /usr/local/sbin/mcpanel-harden-ssh
install -m 0755 "$PROJECT_ROOT/deploy/ubuntu/control-backup.sh" /usr/local/sbin/mcpanel-control-backup
install -m 0755 "$PROJECT_ROOT/deploy/ubuntu/deploy-release.sh" /usr/local/sbin/mcpanel-deploy-release
install -m 0755 "$PROJECT_ROOT/deploy/ubuntu/rollback.sh" /usr/local/sbin/mcpanel-rollback
install -m 0755 "$PROJECT_ROOT/deploy/ubuntu/status.sh" /usr/local/sbin/mcpanel-status
install -m 0644 "$PROJECT_ROOT/deploy/ubuntu/mcpanel-stack.service" /etc/systemd/system/mcpanel-stack.service
install -m 0644 "$PROJECT_ROOT/deploy/ubuntu/mcpanel-firewall.service" /etc/systemd/system/mcpanel-firewall.service
install -m 0644 "$PROJECT_ROOT/deploy/ubuntu/fail2ban-sshd.local" /etc/fail2ban/jail.d/mcpanel-sshd.local
install -m 0644 "$PROJECT_ROOT/deploy/ubuntu/logrotate-mcpanel" /etc/logrotate.d/mcpanel
install -m 0644 "$PROJECT_ROOT/deploy/ubuntu/50unattended-upgrades-mcpanel" /etc/apt/apt.conf.d/50unattended-upgrades-mcpanel
install -m 0644 "$PROJECT_ROOT/deploy/ubuntu/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades
install -m 0440 "$PROJECT_ROOT/deploy/ubuntu/mcpanel-sudoers" /etc/sudoers.d/mcpanel
visudo -cf /etc/sudoers.d/mcpanel

systemctl enable --now fail2ban
systemctl restart unattended-upgrades || true

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp comment '1315 Panel HTTP'
ufw allow 443/tcp comment '1315 Panel HTTPS'
ufw allow 25565/tcp comment '1315 SMP'
ufw --force enable

systemctl daemon-reload
systemctl enable --now mcpanel-firewall.service

cd /opt/mcpanel
docker compose --env-file /opt/mcpanel/.env -f /opt/mcpanel/docker-compose.production.yml config >/dev/null
docker compose --env-file /opt/mcpanel/.env -f /opt/mcpanel/docker-compose.production.yml build --pull
docker compose --env-file /opt/mcpanel/.env -f /opt/mcpanel/docker-compose.production.yml up -d --remove-orphans
systemctl enable mcpanel-stack.service

printf '\n1315 Panel installation complete.\n'
printf 'Panel URL: %s\n' "$PANEL_URL"
printf 'Admin username: %s\n' "${ADMIN_USERNAME:-admin}"
if [[ -n "$ADMIN_PASSWORD_VALUE" ]]; then
  printf 'Bootstrap password: %s\n' "$ADMIN_PASSWORD_VALUE"
else
  printf 'Bootstrap password: existing value retained in /opt/mcpanel/.env\n'
fi
printf 'Minecraft join address: %s:25565\n' "$PUBLIC_HOST_VALUE"
printf 'Status command: sudo mcpanel-status\n'
printf 'Verify deploy SSH in a second terminal: ssh mcpanel@%s\n' "$PUBLIC_IP_VALUE"
printf 'After that succeeds, harden SSH with: sudo mcpanel-harden-ssh\n'
if [[ -z "$PANEL_DOMAIN_VALUE" ]]; then
  printf '\nWARNING: the panel is using temporary plain HTTP by IP. Add a domain and HTTPS when practical.\n'
fi
