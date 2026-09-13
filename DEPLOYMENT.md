# Ubuntu 24.04 production deployment

This guide deploys MCPanel on a fresh Ubuntu 24.04 VPS with Docker Engine, Docker Compose, Node.js 24 LTS, UFW, fail2ban, unattended security updates, Caddy, and a non-root `mcpanel` deploy account.

## Production topology

- Caddy is the only public web service (`80/tcp`, `443/tcp`).
- Minecraft publishes only `25565/tcp` by default.
- Frontend and backend have no host-published ports.
- The backend **does not receive `/var/run/docker.sock`**. It talks to a Docker socket proxy on an internal-only network.
- Only the socket proxy mounts the Docker socket, and its API sections are explicitly allowlisted.
- The `mcpanel` Linux user is **not** added to the `docker` group.
- Persistent server data lives under `/srv/mcpanel/servers`.
- Control-plane state lives under `/opt/mcpanel`.
- Caddy/app operational logs live under `/var/log/mcpanel`; Docker JSON logs are size-rotated by Docker.

> Docker documents that container-published ports can bypass UFW. This deployment therefore uses both UFW and a persistent `DOCKER-USER` allowlist. Do not remove `mcpanel-firewall.service`.

## 1. DNS / HTTPS

Production uses separate web origins:

```text
panel.example.com -> frontend
api.example.com   -> backend REST + WebSockets
play.example.com  -> Minecraft TCP/25565
```

Create `A` records for all three names pointing at the VPS IPv4. `panel` and `api` may be proxied through Cloudflare; keep `play` DNS-only unless you intentionally use Cloudflare Spectrum. Caddy automatically obtains and renews public certificates for both web domains. See `DOMAIN-HTTPS.md` for exact DNS, optional Minecraft SRV, Cloudflare, WebSocket, health-check, compression, and TLS test instructions.

## 2. Upload the project

From your workstation:

```bash
scp minecraft-panel.zip root@YOUR_VPS_IP:/root/
ssh root@YOUR_VPS_IP
apt-get update && apt-get install -y unzip
mkdir -p /root/mcpanel-source
unzip /root/minecraft-panel.zip -d /root/mcpanel-source
cd /root/mcpanel-source/minecraft-panel
```

## 3. Run the installer

With a domain:

```bash
export PANEL_DOMAIN=panel.example.com
export API_DOMAIN=api.example.com
export PANEL_ORIGIN=https://panel.example.com
export API_ORIGIN=https://api.example.com
export ACME_EMAIL=you@example.com
export PUBLIC_HOST=play.example.com
# Optional: set this yourself; otherwise a strong random password is generated.
export ADMIN_PASSWORD='use-a-long-unique-password-here'

bash deploy/ubuntu/install.sh
```

Caddy production deployment requires DNS names for browser-trusted HTTPS. Point the `panel` and `api` records at the VPS before running the installer.

The installer:

1. installs base packages, Docker Engine + Compose plugin, and Node.js 24 LTS;
2. creates the non-root `mcpanel` user without Docker-group membership;
3. creates `/opt/mcpanel`, `/srv/mcpanel/servers`, and `/var/log/mcpanel`;
4. copies the app to `/opt/mcpanel/app`;
5. generates `/opt/mcpanel/.env` with a random JWT secret;
6. enables UFW, fail2ban, unattended security updates, Docker ingress filtering, and log rotation;
7. builds and starts the production Compose stack.

Node 24 is the current LTS line used by this setup. The app itself is also built from `node:24-bookworm-slim` images.

## 4. Verify the non-root SSH account **before** disabling root SSH

Keep the original root session open. From a second terminal on your workstation:

```bash
ssh mcpanel@YOUR_VPS_IP
```

The installer copies root's `authorized_keys` to `mcpanel` when a key exists. If the login does not work, fix the key before continuing.

After `ssh mcpanel@...` succeeds:

```bash
sudo mcpanel-harden-ssh
```

This installs an sshd drop-in with:

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
```

It runs `sshd -t` before reloading sshd.

## 5. Verify the services

As `mcpanel`:

```bash
sudo mcpanel-status
```

Or, for detailed container state:

```bash
sudo systemctl status mcpanel-stack.service
sudo systemctl status mcpanel-firewall.service
sudo systemctl status fail2ban
```

From another machine:

```bash
curl -fsS https://panel.example.com/healthz
curl -fsS https://api.example.com/healthz
```

For an IP-only HTTP bootstrap, replace the URL accordingly.

Check that the only public listeners expected by the deployment are SSH, HTTP, HTTPS, and Minecraft:

```bash
sudo ss -lntp
sudo ufw status numbered
sudo iptables -S DOCKER-USER
```

## Directory layout

```text
/opt/mcpanel/
  .env                         # root-only production secrets
  docker-compose.production.yml
  app/                         # current application source
  data/mcpanel.db              # SQLite database
  caddy/data/                  # TLS certificates/state
  caddy/config/
  staging/                     # upload next release here
  releases/                    # last five rollback snapshots
  control-backups/             # control-plane backups

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

The canonical template is `.env.production.example`. The installer writes `/opt/mcpanel/.env` with mode `0600`.

To edit it:

```bash
sudoedit /opt/mcpanel/.env
sudo systemctl restart mcpanel-stack.service
```

Important values:

```dotenv
PANEL_DOMAIN=panel.example.com
API_DOMAIN=api.example.com
PANEL_ORIGIN=https://panel.example.com
API_ORIGIN=https://api.example.com
ACME_EMAIL=you@example.com
PUBLIC_HOST=play.example.com
DATABASE_URL=file:/app/data/mcpanel.db
DOCKER_HOST=tcp://socket-proxy:2375
SERVER_DATA_ROOT=/srv/mcpanel/servers
DOCKER_NETWORK=mcpanel-internal
```

Never publish `socket-proxy:2375`, and never replace `DOCKER_HOST` with a public TCP Docker daemon.

## Firewall policy

UFW permits only:

```text
OpenSSH
80/tcp
443/tcp
25565/tcp
```

View it with:

```bash
sudo ufw status verbose
```

Because Docker manipulates iptables directly, `/usr/local/sbin/mcpanel-firewall` also enforces the container ingress allowlist in `DOCKER-USER`.

This means a server configured to publish a different Minecraft host port will intentionally be unreachable until the firewall policy is explicitly changed. The production default is `25565` only.

## Health checks

Compose health checks are included for:

- backend: `GET http://127.0.0.1:4000/healthz` inside its container;
- frontend: `GET http://127.0.0.1:3000` inside its container;
- Docker socket proxy: Docker `_ping` endpoint.

Inspect them:

```bash
cd /opt/mcpanel
sudo docker compose --env-file .env -f docker-compose.production.yml ps
```

The deploy user does not have direct Docker access by design; use `sudo mcpanel-status` for normal checks.

## Update workflow

The safest workflow stages a complete new source tree, snapshots the current source + SQLite database, builds the replacement images, starts them, and verifies frontend/backend health. A failed health check automatically restores the pre-update source/database snapshot.

On your workstation, unpack the new release. Then upload its contents to staging:

```bash
rsync -az --delete ./minecraft-panel/ mcpanel@YOUR_VPS_IP:/opt/mcpanel/staging/
```

On the VPS:

```bash
ssh mcpanel@YOUR_VPS_IP
sudo mcpanel-deploy-release
```

Successful output includes a rollback ID such as:

```text
Deployment successful. Rollback id: 20260912T021500Z
```

The last five release snapshots are retained under `/opt/mcpanel/releases`.

### Dependency lockfiles

Commit `package-lock.json` files before a real production release whenever possible. The included Dockerfiles use `npm ci` when a lockfile exists and fall back to `npm install` only because this generated source bundle may not yet contain lockfiles.

## Rollback

List available snapshots:

```bash
ls -1 /opt/mcpanel/releases
```

Rollback both application source **and the SQLite database** to a snapshot:

```bash
sudo mcpanel-rollback 20260912T021500Z
```

A database rollback discards control-plane changes made after that snapshot. Minecraft world/server data under `/srv/mcpanel/servers` is not replaced by control-plane rollback; use the panel's server backup/restore feature for game data.

## Backup workflow

### Minecraft data

Use the panel's built-in backup scheduler for world/full-server archives. Those remain under:

```text
/srv/mcpanel/servers/<server-id>/backups
```

### Control-plane backup

Run:

```bash
sudo mcpanel-control-backup
```

This creates a compressed backup under:

```text
/opt/mcpanel/control-backups/mcpanel-control-<timestamp>.tar.gz
```

It uses SQLite's `.backup` command rather than copying a live database file. Control-plane archives older than 30 days are pruned by the helper.

For disaster recovery, copy these archives plus the Minecraft backup archives to storage outside the VPS. Keeping the only backup on the same machine does not protect against disk/VPS loss.

## Restore a control-plane backup manually

```bash
sudo systemctl stop mcpanel-stack.service
sudo mkdir -p /root/mcpanel-control-restore
sudo tar -xzf /opt/mcpanel/control-backups/mcpanel-control-YYYYMMDDTHHMMSSZ.tar.gz -C /root/mcpanel-control-restore
```

Inspect the extracted files before replacing anything. Then restore the database/env as required and start the stack:

```bash
sudo cp /root/mcpanel-control-restore/YYYYMMDDTHHMMSSZ/mcpanel.db /opt/mcpanel/data/mcpanel.db
sudo chown mcpanel:mcpanel /opt/mcpanel/data/mcpanel.db
sudo systemctl start mcpanel-stack.service
```

Restore `.env` only when you intentionally need the old credentials/configuration.

## Logs

Caddy access logs:

```bash
sudo tail -f /var/log/mcpanel/caddy/access.log
```

Container application logs:

```bash
sudo journalctl -u docker -f
```

For one-off debugging as root:

```bash
cd /opt/mcpanel
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=200 backend
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=200 frontend
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=200 caddy
```

Docker's `json-file` logs are capped at 10 MB × 5 files per container. `/etc/logrotate.d/mcpanel` additionally rotates host file logs daily.

## fail2ban

```bash
sudo fail2ban-client status sshd
```

Default policy installed by this project:

- 5 failures within 10 minutes;
- 1-hour ban;
- systemd sshd backend.

## Automatic security updates

Verify:

```bash
systemctl status unattended-upgrades
cat /etc/apt/apt.conf.d/20auto-upgrades
```

Only Ubuntu security updates are enabled automatically. Docker, Node, app images, and the application itself should be updated through the controlled release workflow rather than an unattended container updater.

## HTTPS troubleshooting

If Caddy cannot issue a certificate:

```bash
cd /opt/mcpanel
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=200 caddy
```

Check that:

1. `PANEL_SITE_ADDRESS` is the hostname, not an internal IP;
2. its DNS `A` record points to this VPS;
3. ports 80 and 443 are allowed by the VPS provider/security group as well as UFW;
4. no other process occupies ports 80/443.

## Security notes

- The Docker socket is root-equivalent. It is mounted only into the dedicated socket-proxy container.
- The proxy is never published to the host or internet and lives on the `control` internal Docker network.
- The backend can reach only the Docker API sections it requires for managed containers/images/networks/exec operations.
- The frontend has no Docker connectivity.
- `mcpanel` is not a member of the `docker` group.
- App containers run with the numeric non-root UID/GID of the `mcpanel` host account and drop Linux capabilities.
- Caddy gets only `NET_BIND_SERVICE` so it can bind privileged HTTP/HTTPS ports.
- The backend verifies its own managed-container labels before lifecycle operations.
- The generated `.env` is root-readable only.
- Password/root SSH are not disabled until you explicitly verify key login to the deploy account.
