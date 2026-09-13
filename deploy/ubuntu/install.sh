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

# Docker Engine + Compose plugin from Docker's official apt repository.
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

# Node.js 24 LTS. The panel itself is containerized, but installing LTS on the
# host keeps maintenance/build tooling available without using an EOL Ubuntu package.
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

# Non-root application/deploy account. Deliberately NOT added to docker group.
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

# Reuse the root key for the deploy user when present; SSH hardening is a later,
# explicit step after the operator verifies mcpanel login in a second session.
if [[ -s /root/.ssh/authorized_keys && ! -s /home/mcpanel/.ssh/authorized_keys ]]; then
  install -d -o mcpanel -g mcpanel -m 0700 /home/mcpanel/.ssh
  install -o mcpanel -g mcpanel -m 0600 /root/.ssh/authorized_keys /home/mcpanel/.ssh/authorized_keys
fi

if [[ ! -f /opt/mcpanel/.env ]]; then
  PANEL_HOST="${PANEL_DOMAIN:-}"
  API_HOST="${API_DOMAIN:-}"
  if [[ -z "$PANEL_HOST" || -z "$API_HOST" ]]; then
    echo "PANEL_DOMAIN and API_DOMAIN are required (for example panel.example.com and api.example.com)." >&2
    exit 2
  fi
  ORIGIN="${PANEL_ORIGIN:-https://$PANEL_HOST}"
  API_ORIGIN_VALUE="${API_ORIGIN:-https://$API_HOST}"
  HOSTNAME_VALUE="${PUBLIC_HOST:-play.example.com}"
  HOSTNAME_VALUE="${HOSTNAME_VALUE#http://}"
  HOSTNAME_VALUE="${HOSTNAME_VALUE#https://}"
  HOSTNAME_VALUE="${HOSTNAME_VALUE%%/*}"
  ADMIN_PASSWORD_VALUE="${ADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -d '\n')}"
  AUTH_ENCRYPTION_KEY_VALUE="$(openssl rand -base64 32 | tr "+/" "-_" | tr -d "=\n")"
  AUTH_RECOVERY_PEPPER_VALUE="$(openssl rand -hex 32)"
  cat >/opt/mcpanel/.env <<ENVFILE
PANEL_DOMAIN=$PANEL_HOST
API_DOMAIN=$API_HOST
PANEL_ORIGIN=$ORIGIN
API_ORIGIN=$API_ORIGIN_VALUE
ACME_EMAIL=${ACME_EMAIL:-admin@example.com}
MCPANEL_UID=$MCPANEL_UID
MCPANEL_GID=$MCPANEL_GID
AUTH_ENCRYPTION_KEY=$AUTH_ENCRYPTION_KEY_VALUE
AUTH_RECOVERY_PEPPER=$AUTH_RECOVERY_PEPPER_VALUE
SESSION_TTL_HOURS=12
LOGIN_LOCKOUT_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
TOTP_ISSUER=MCPanel
COOKIE_DOMAIN=${COOKIE_DOMAIN:-}
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=$ADMIN_PASSWORD_VALUE
COOKIE_NAME=mc_panel_session
PUBLIC_HOST=$HOSTNAME_VALUE
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
MC_HEAP_RATIO=0.75
MC_TIMEZONE=UTC
MAX_UPLOAD_BYTES=67108864
MAX_TEXT_FILE_BYTES=2097152
METRICS_INTERVAL_MS=5000
METRICS_RETENTION_HOURS=24
MOD_DOWNLOAD_HOSTS=cdn.modrinth.com
MODRINTH_API_HOST=api.modrinth.com
MODRINTH_USER_AGENT=minecraft-panel/1.0 (self-hosted)
MODRINTH_CACHE_TTL_MS=60000
MODRINTH_CACHE_MAX_ENTRIES=500
MODRINTH_TIMEOUT_MS=10000
MODRINTH_RETRY_COUNT=3
MODRINTH_RETRY_BASE_MS=250
TRUST_PROXY=true
LOG_LEVEL=info
ENVFILE
  chmod 0600 /opt/mcpanel/.env
  echo "Generated initial admin password: $ADMIN_PASSWORD_VALUE"
  echo "Store it securely; it is also present in root-only /opt/mcpanel/.env."
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

# Host firewall. OpenSSH is allowed before enabling UFW to avoid lockout.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp comment 'MCPanel HTTP'
ufw allow 443/tcp comment 'MCPanel HTTPS'
ufw allow 25565/tcp comment 'Minecraft'
ufw --force enable

systemctl daemon-reload
systemctl enable --now mcpanel-firewall.service

cd /opt/mcpanel
docker compose --env-file /opt/mcpanel/.env -f /opt/mcpanel/docker-compose.production.yml config >/dev/null
docker compose --env-file /opt/mcpanel/.env -f /opt/mcpanel/docker-compose.production.yml build --pull
docker compose --env-file /opt/mcpanel/.env -f /opt/mcpanel/docker-compose.production.yml up -d --remove-orphans
systemctl enable mcpanel-stack.service

printf '\nInstallation complete.\n'
printf '1. Verify: sudo -u mcpanel ssh-keygen -F localhost >/dev/null 2>&1 || true\n'
printf '2. From YOUR workstation open a second session: ssh mcpanel@<VPS-IP>\n'
printf '3. Only after that succeeds, run: sudo mcpanel-harden-ssh\n'
printf '4. Status: sudo mcpanel-status\n'
