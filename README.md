# 1315 Panel

1315 Panel is the private self-hosted control plane for **1315 SMP**. It combines a Next.js 15 management UI with a Fastify + Prisma backend that controls panel-owned Docker Minecraft servers on Linux.

## Repository layout

```text
app/ + components/ + lib/    Next.js management UI
backend/                     Fastify + Prisma + Docker control-plane API
deploy/                      Ubuntu, Caddy, firewall, rollback helpers
docker-compose.production.yml
```

## Production data flow

Production pages do not use demo server data. The UI discovers real servers from `GET /api/servers`, persists the selected real server ID, and sends that ID to Overview, Console, Files, Mods, Worlds, Backups, Players, and Settings.

- Overview: Docker CPU/RAM/network/uptime, persistent disk usage, Minecraft TPS/MSPT when exposed by the runtime, player count, and last backup.
- Console: real logs, command endpoint, authenticated WebSocket stream, reconnect state, and command errors.
- Files: list, folder navigation, text edit/save, upload, download, folder creation, rename, and delete through the traversal-resistant backend.
- Mods: real Modrinth search/install/update/dependency resolution.
- Plugins: no fake marketplace. Non-Paper servers are marked not applicable; Paper manual plugin files can be managed under `data/plugins` until a real plugin marketplace backend is implemented.
- Worlds: real list/create/activate/delete with server-stopped enforcement. Archive upload/download is intentionally withheld until verified safe archive handling is implemented.
- Backups: real manual/scheduled world/full backups, retention, verified restore, restore logs, and WebSocket progress.
- Players: real kick/ban/op/deop/whitelist operations through the backend.
- Settings: real `server.properties` and runtime settings; unsafe allocations are rejected server-side.

## Authentication

1315 Panel uses **Argon2id password hashing and opaque database-backed sessions**. It does not use browser-visible JWTs. Session tokens are random and stored only as hashes server-side; the browser receives an HttpOnly cookie plus a non-secret CSRF cookie. Optional TOTP and recovery codes, login lockout, session expiration/revocation, and role/permission checks are implemented by the backend.

See [`AUTHENTICATION.md`](./AUTHENTICATION.md).

## Local development

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
cd backend
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

## Minecraft runtime

Each Minecraft server is a panel-managed Docker container with persistent data under:

```text
/srv/mcpanel/servers/<server-id>/
```

Vanilla, Paper, Fabric, Forge, and NeoForge are supported through the runtime adapter. For the initial BulletServers VPS (8 GB total RAM), production defaults to a **6144 MB container memory ceiling** and `MC_HEAP_RATIO=0.92`, which gives Java roughly **5.5 GiB heap** and preserves host/control-plane headroom. Requests above the configured host profile are rejected.

## Initial production deployment: public IPv4, no domain

The first deployment does **not** require DNS.

```text
http://PUBLIC_IP/        -> Next.js frontend
http://PUBLIC_IP/api/*   -> Fastify backend
ws://PUBLIC_IP/ws/*      -> backend WebSockets
PUBLIC_IP:25565          -> 1315 SMP
```

Caddy provides same-origin routing. This deliberately keeps auth/cookies/CSRF simple. In temporary HTTP-by-IP mode, the session cookie is HttpOnly + SameSite but `Secure=false`, because browsers will not send a Secure cookie over HTTP.

Plain HTTP is temporary and exposes browser traffic to the network path. Add a domain and HTTPS when practical; the same Caddy/app architecture supports it without moving API paths.

Fresh Ubuntu 24.04 deployment:

```bash
git clone https://github.com/rodrig011/1315-panel-.git
cd 1315-panel-
sudo ./deploy/ubuntu/install.sh
```

The installer detects the public IPv4 (or accepts `PUBLIC_IP=x.x.x.x`), installs Docker/Compose + Node.js 24, creates the `mcpanel` deploy user, configures UFW/fail2ban/unattended security updates, generates auth secrets and the bootstrap admin password, builds the stack, and prints the panel URL and Minecraft join address.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for operations, rollback, and domain/HTTPS upgrade instructions.

## Security boundary

The browser never receives Docker credentials or the Docker socket. The backend talks to a private Docker socket proxy over an internal network and validates panel-managed labels before controlling containers. File APIs reject traversal and symlink escapes. Mod downloads are resolved from trusted Modrinth metadata and verified before install.

## Validation

The repository includes `.github/workflows/production-validation.yml`, which runs:

```text
npm install
npm run lint
npm run typecheck
npm run build
cd backend && npm install
npm run prisma:generate
npm run typecheck
npm run test
npm run build
bash -n deploy/ubuntu/install.sh
python3 deploy/tests/validate-production.py
docker compose ... config
```

Successful CI also commits the generated root/backend npm lockfiles for reproducible installation.
