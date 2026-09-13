# Nodecraft Minecraft Server Panel

A premium self-hosted Minecraft control panel with a Next.js dashboard and a production-oriented Fastify backend for managing panel-owned Docker Minecraft servers on a Linux VPS.

## Repository

```text
app/ + components/ + lib/    Next.js 15 management UI
backend/                     Fastify + Prisma + Docker control-plane API
```

### Frontend

- Overview metrics and charts
- Live-style console UI
- File manager/editor
- Mods and plugins marketplace UI
- Worlds and backups
- Player administration
- Server settings and danger-zone UI
- Six-step server creation wizard

### Backend

The backend includes a robust backup subsystem with manual/scheduled world or full-server archives, retention pruning, SHA-256 verification, atomic staged restore, restore logs, WebSocket progress events, and a `BackupStorage` interface designed for a future S3-compatible implementation. Local archives live at `/srv/mcpanel/servers/<server-id>/backups`.


- Secure cookie/JWT auth
- Multi-server Prisma records
- Start/stop/restart/kill through a swappable Docker service
- REST console command endpoint + authenticated console WebSocket
- Live/persisted CPU, RAM, disk, network, TPS, and player metrics
- Traversal/symlink-resistant file service and bounded uploads
- Mod install/update service with approved-host downloads
- Player moderation through RCON
- Safe tar backup create/restore/delete
- `server.properties` settings service
- SQLite migrations and PostgreSQL-ready schema
- Rate limiting, audit logs, structured logging, and centralized errors
- API integration tests with a fake container runtime

## Run the frontend

```bash
npm install
npm run dev
```

Frontend: `http://localhost:3000`

## Run the backend

```bash
cd backend
npm install
cp .env.example .env
npm run prisma:deploy
npm run dev
```

Backend default: `http://127.0.0.1:4000`

See [`backend/README.md`](backend/README.md) for the complete API, security model, VPS setup, environment variables, WebSocket formats, and PostgreSQL migration path.

## Root helper scripts

```bash
npm run backend:dev
npm run backend:typecheck
npm run backend:test
npm run backend:build
```

## Security note

Do not expose `/var/run/docker.sock` to the browser or the public network. Direct Docker socket access is highly privileged. The backend validates that containers are panel-managed before lifecycle operations and is intentionally the only layer allowed to talk to Docker.

## Docker runtime layer

The backend now contains the real per-server Docker runtime. Each Minecraft server is isolated in its own managed container with persistent `data`, `mods`, `config`, `logs`, and `backups` directories under `/srv/mcpanel/servers/<server-id>`. Vanilla, Paper, Fabric, Forge, and NeoForge are supported through a replaceable image adapter, with configurable Java 17/21/25, RAM, host port, loader/build version, restart policy, health checks, RCON console commands, Docker metrics, and graceful shutdown. See `backend/README.md` for deployment and security details.

## Modrinth integration

The Mods page now has live **Browse**, **Installed**, and **Updates Available** views backed by the backend's `ModrinthService`. Search supports Minecraft version, loader, category, project icon/author/description/download counts, and the latest compatible version. Installs are planned server-side so required, optional, and incompatible dependencies are visible before anything is downloaded. The browser submits only Modrinth IDs; trusted CDN host validation and SHA-512 artifact verification happen in the backend.


## Ubuntu 24.04 production deployment

A complete hardened VPS deployment bundle is included. See [`DEPLOYMENT.md`](./DEPLOYMENT.md). It includes Docker Engine/Compose installation, Node.js 24 LTS, UFW + a `DOCKER-USER` policy, fail2ban, automatic security updates, a non-root deploy user, Caddy HTTPS reverse proxy, Docker socket isolation, health checks, log rotation, update snapshots, control-plane backups, and rollback helpers.

Primary files:

- `docker-compose.production.yml`
- `.env.production.example`
- `deploy/ubuntu/install.sh`
- `deploy/caddy/Caddyfile`
- `DEPLOYMENT.md`

## Production authentication

Authentication now uses Argon2id password hashing, opaque database-backed sessions, HttpOnly cookies, CSRF tokens, account lockout, optional TOTP/recovery codes, session revocation, and API-enforced RBAC. See [`AUTHENTICATION.md`](./AUTHENTICATION.md) for setup and endpoint documentation.
