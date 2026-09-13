# 1315 Panel — Ubuntu 24.04 deployment

This guide deploys **1315 Panel** and **1315 SMP** on a fresh Ubuntu 24.04 VPS.

Target initial host:

- Ubuntu 24.04
- public IPv4
- 8 GB RAM
- 2 vCPU
- 80 GB disk
- Chicago
- no domain required
- panel: `http://PUBLIC_IP/`
- Minecraft: `PUBLIC_IP:25565`

## Production topology

```text
Internet
  22/tcp      -> SSH
  80/tcp      -> Caddy -> frontend, /api/* + /ws/* -> backend
  443/tcp     -> Caddy (used later for domain/HTTPS mode)
  25565/tcp   -> managed Minecraft container

backend -> private control network -> docker-socket-proxy -> /var/run/docker.sock
```

Frontend, backend, and Docker socket proxy have no public host ports. The backend never mounts `/var/run/docker.sock`; only the private proxy does. The `mcpanel` deploy account is not added to the Docker group.

Persistent paths:

```text
/opt/mcpanel/                 application/control-plane state
/srv/mcpanel/servers/         Minecraft server data
/var/log/mcpanel/             service logs
```

## First boot — no domain

SSH to the new VPS as root and run:

```bash
apt-get update
apt-get install -y git
git clone https://github.com/rodrig011/1315-panel-.git
cd 1315-panel-
sudo ./deploy/ubuntu/install.sh
```

If public-IP autodetection is wrong, provide it explicitly:

```bash
sudo PUBLIC_IP=203.0.113.10 ./deploy/ubuntu/install.sh
```

The installer does **not** require `PANEL_DOMAIN` or `API_DOMAIN`.

It will:

1. install Docker Engine, Compose, Node.js 24, and system dependencies;
2. create the non-root `mcpanel` deploy user;
3. create the application/server/log directories;
4. copy this repository to `/opt/mcpanel/app`;
5. generate opaque-session/TOTP/recovery secrets and a bootstrap admin password;
6. configure UFW, a persistent Docker ingress policy, fail2ban, log rotation, and unattended security updates;
7. configure Caddy for same-origin HTTP routing by public IP;
8. build and start the production Compose stack;
9. print the exact panel URL, admin username, bootstrap password, Minecraft address, and status command.

Expected first-boot output includes:

```text
Panel URL: http://PUBLIC_IP
Admin username: admin
Bootstrap password: <generated value>
Minecraft join address: PUBLIC_IP:25565
Status command: sudo mcpanel-status
```

Open the printed panel URL in your browser, sign in, and change the bootstrap password.

## HTTP/IP security tradeoff

Plain HTTP by IP is intentionally supported so the server can be deployed before DNS is available.

In this mode:

```dotenv
CADDY_SITE_ADDRESS=:80
PANEL_ORIGIN=http://PUBLIC_IP
COOKIE_DOMAIN=
COOKIE_SECURE=false
PUBLIC_HOST=PUBLIC_IP
```

The session cookie remains HttpOnly + SameSite and CSRF protection remains active, but HTTP does not encrypt the browser connection. Treat this as a temporary bootstrap mode and add HTTPS when a domain is available.

## Create and launch 1315 SMP

After login:

1. Open **Create server**.
2. Keep the default name **1315 SMP**.
3. Select the desired Minecraft version (current default `1.21.1`).
4. Select **NeoForge** for the initial modded setup.
5. Keep RAM at **6 GB**.
6. Optionally enter a world seed.
7. Review the configuration.
8. Click **Launch server**.

The wizard waits for the backend to:

- create the server database record;
- create `/srv/mcpanel/servers/<server-id>` and persistent runtime directories;
- write `server.properties` and accept the EULA;
- provision the labeled isolated Docker container;
- start the container.

It redirects to Overview only after backend confirmation.

The 8 GB VPS profile sets:

```dotenv
HOST_MEMORY_MB=8192
MC_MAX_MEMORY_MB=6144
MC_HEAP_RATIO=0.92
```

The Minecraft container is capped at 6144 MB and Java receives roughly 5.5 GiB heap, preserving headroom for Ubuntu, Docker, the frontend/backend, Caddy, and filesystem cache. The backend rejects allocations above the configured host profile.

## Verify the deployment

```bash
sudo mcpanel-status
sudo systemctl status mcpanel-stack.service
sudo systemctl status mcpanel-firewall.service
sudo systemctl status fail2ban
sudo ufw status verbose
sudo iptables -S DOCKER-USER
sudo ss -lntp
```

From another computer:

```bash
curl -fsS http://PUBLIC_IP/healthz
curl -fsS http://PUBLIC_IP/api/healthz
```

Only SSH, HTTP, HTTPS, and Minecraft should be reachable publicly.

## Verify the non-root SSH account before disabling root login

Keep the original root SSH session open. From another terminal:

```bash
ssh mcpanel@PUBLIC_IP
```

If that works, harden SSH:

```bash
sudo mcpanel-harden-ssh
```

The helper validates sshd configuration before reload and disables password authentication plus root SSH login.

## Directory layout

```text
/opt/mcpanel/
  .env
  docker-compose.production.yml
  app/
  data/mcpanel.db
  caddy/data/
  caddy/config/
  staging/
  releases/
  control-backups/

/srv/mcpanel/servers/
  <server-id>/
    data/
    mods/
    config/
    logs/
    backups/

/var/log/mcpanel/
  caddy/
  backend/
```

## Production environment

The installer writes `/opt/mcpanel/.env` with mode `0600`.

```bash
sudoedit /opt/mcpanel/.env
sudo systemctl restart mcpanel-stack.service
```

Never publish `socket-proxy:2375` and never point `DOCKER_HOST` at a public Docker daemon.

## Firewall policy

UFW and the persistent `DOCKER-USER` policy allow only:

```text
SSH
80/tcp
443/tcp
25565/tcp
```

Docker can bypass ordinary UFW rules for published ports, which is why `mcpanel-firewall.service` also filters container ingress.

## Health checks

Compose health checks cover:

- backend: `/healthz` on port 4000 inside the container;
- frontend: `/healthz` on port 3000 inside the container;
- Docker socket proxy: Docker `_ping`.

Caddy also health-checks the private frontend/backend upstreams.

## Backups

Minecraft backups are managed by the application and stored under each server directory:

```text
/srv/mcpanel/servers/<server-id>/backups/
```

Control-plane SQLite backup:

```bash
sudo mcpanel-control-backup
```

## Updating

For a normal Git-based update:

```bash
cd /path/to/1315-panel-
git pull --ff-only
sudo rsync -a --delete --exclude .git --exclude node_modules --exclude .next ./ /opt/mcpanel/staging/
sudo mcpanel-deploy-release
```

The release helper snapshots the current code and SQLite control database, deploys the staged release, checks health, and rolls back automatically if the replacement is unhealthy.

## Rollback

List available snapshots:

```bash
ls -1 /opt/mcpanel/releases
```

Rollback:

```bash
sudo mcpanel-rollback <release-timestamp>
```

Minecraft world data under `/srv/mcpanel/servers` is independent of control-plane release rollback.

## Later: domain + automatic HTTPS

When a domain becomes available, point an A record such as `panel.example.com` to the VPS and edit `/opt/mcpanel/.env`:

```dotenv
CADDY_SITE_ADDRESS=panel.example.com
PANEL_DOMAIN=panel.example.com
PANEL_ORIGIN=https://panel.example.com
COOKIE_SECURE=true
PUBLIC_HOST=play.example.com
```

`PUBLIC_HOST` is optional; keep the public IPv4 if you do not yet have Minecraft DNS.

Restart the stack:

```bash
sudo systemctl restart mcpanel-stack.service
```

Caddy will obtain and renew the public certificate automatically. API and WebSocket paths remain same-origin (`/api/*`, `/ws/*`); no application restructuring is required.

See `DOMAIN-HTTPS.md` for DNS/SRV/Cloudflare details.
