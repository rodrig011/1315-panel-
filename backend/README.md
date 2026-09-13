# Minecraft Panel Backend

Production-oriented control-plane API for the Minecraft server management panel. It manages panel-owned Minecraft instances on a Linux VPS through Docker while keeping Docker, host filesystem paths, and host-level execution behind a server-side security boundary.

## Stack

- Node.js 22+ and TypeScript with strict mode
- Fastify 5
- Zod request validation through `fastify-type-provider-zod`
- Prisma ORM with SQLite by default
- HTTP-only JWT session cookie authentication
- `@fastify/websocket` for console and metrics streams
- Dockerode behind a swappable `ContainerRuntime` interface
- `tar` for in-process backup creation/restoration (no shelling out)
- Vitest integration tests

## Architecture

```text
backend/
├── prisma/
│   ├── migrations/              # SQLite production migrations
│   ├── schema.prisma            # Default SQLite schema
│   └── schema.postgresql.prisma # Ready PostgreSQL model definition
├── src/
│   ├── app.ts                   # Fastify composition and security plugins
│   ├── server.ts                # Process entry point / graceful shutdown
│   ├── config/                  # Validated environment
│   ├── lib/                     # errors, locking, password hashing, parsers
│   ├── repositories/            # Prisma-backed persistence interfaces
│   ├── routes/                  # thin HTTP/WebSocket controllers
│   ├── schemas/                 # Zod schemas for params/query/body
│   ├── services/
│   │   ├── docker/              # ContainerRuntime + Dockerode implementation
│   │   ├── auth-service.ts
│   │   ├── backup-service.ts
│   │   ├── file-service.ts
│   │   ├── metrics-service.ts
│   │   ├── minecraft-server-service.ts
│   │   ├── mod-service.ts
│   │   ├── player-service.ts
│   │   └── settings-service.ts
│   └── types/
└── tests/
    └── api.integration.test.ts
```

Routes do not talk to Docker or the filesystem directly. They call services, and the Docker integration is isolated behind `ContainerRuntime`, so Dockerode can later be replaced with a remote agent, containerd implementation, or restricted Docker API proxy.

## Security model

The browser never receives Docker credentials, container IDs, Docker socket access, or host data paths.

- Every API request is validated with Zod.
- Auth uses a signed JWT in an `HttpOnly`, `SameSite=Strict` cookie. Production cookies also use `Secure`.
- Mutating browser requests are origin-checked in production against `APP_ORIGIN`.
- Login, lifecycle, console, uploads, mods, backups, settings, and moderation endpoints have rate limits in addition to the global limit.
- Passwords use Node's built-in `scrypt` with a random salt and constant-time comparison.
- Docker operations only work against containers carrying both panel-management labels and the expected server ID.
- The API never accepts a Docker image, host command, Docker command, or host filesystem path from the browser.
- Minecraft console commands are single-line, bounded, control-character-free strings and are passed as a single argv value to the fixed `rcon-cli` binary inside the managed container. No host shell is used.
- File paths must stay under a server's data root and under an explicit top-level allowlist. Absolute paths, `..`, backslashes, NULs, and symlink traversal are rejected.
- Uploads are streamed to temporary files, bounded by `MAX_UPLOAD_BYTES`, restricted by extension, and JAR/ZIP files must have a valid ZIP signature before being renamed into place.
- Mod download URLs must use HTTPS and an explicitly approved hostname; redirects are revalidated.
- Backups are produced with the Node tar API, not `tar` through a shell. Restore validates archive paths and rejects symlinks/hardlinks before extraction.
- Container configuration uses memory/pid limits, log rotation, `no-new-privileges`, drops all capabilities, and adds back only the small set needed by the Minecraft image startup flow.
- Audit records are written for important lifecycle, auth, console, file, backup, mod, and settings actions.

### Docker socket warning

Access to `/var/run/docker.sock` is effectively host-root-equivalent. The API prevents the frontend from reaching it, but a compromised backend process with direct Docker socket access can still be highly privileged. For a hardened public deployment, run this API on a trusted management host or swap `ContainerRuntime` for a restricted Docker API proxy/remote agent that exposes only the operations this panel needs.

## Environment

Copy the example:

```bash
cp .env.example .env
```

Required production secrets/settings:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=4000
APP_ORIGIN=https://panel.example.com
PUBLIC_HOST=play.example.com
DATABASE_URL=file:./prod.db
AUTH_ENCRYPTION_KEY=<32-random-bytes-base64url>
AUTH_RECOVERY_PEPPER=<at-least-32-random-characters>
SESSION_TTL_HOURS=12
LOGIN_LOCKOUT_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
TOTP_ISSUER=MCPanel
COOKIE_DOMAIN=.example.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-bootstrap-password>
SERVER_DATA_ROOT=/srv/minecraft-panel/servers
BACKUP_ROOT=/srv/mcpanel/legacy-backups
DOCKER_SOCKET=/var/run/docker.sock
DOCKER_NETWORK=mcpanel-internal
MINECRAFT_IMAGE_REPOSITORY=itzg/minecraft-server
MC_BIND_ADDRESS=0.0.0.0
MC_DEFAULT_JAVA_VERSION=21
MC_DEFAULT_RESTART_POLICY=unless-stopped
MC_UID=1000
MC_GID=1000
MC_MANAGE_OWNERSHIP=true
MC_HEAP_RATIO=0.75
MC_TIMEZONE=UTC
MAX_UPLOAD_BYTES=67108864
MAX_TEXT_FILE_BYTES=2097152
METRICS_INTERVAL_MS=5000
METRICS_RETENTION_HOURS=24
MOD_DOWNLOAD_HOSTS=cdn.modrinth.com
MODRINTH_API_HOST=api.modrinth.com
COOKIE_NAME=mc_panel_session
TRUST_PROXY=true
LOG_LEVEL=info
```

Generate the JWT secret with a cryptographically secure source, for example `openssl rand -base64 48` on the VPS.

`ADMIN_USERNAME`/`ADMIN_PASSWORD` are bootstrap credentials. On first startup the admin account is created if it does not exist; changing the environment variable afterward does not silently overwrite an existing password hash.

## Install and migrate

```bash
cd backend
npm install
cp .env.example .env
npm run prisma:deploy
npm run dev
```

For a new local development schema where you want Prisma to create a migration interactively:

```bash
npm run prisma:migrate
```

Health check:

```text
GET /healthz
```

## API

All `/api/*` endpoints except login require the session cookie.

### Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Authenticate and set the HTTP-only session cookie |
| POST | `/api/auth/logout` | Clear the session cookie |
| GET | `/api/auth/me` | Return the authenticated user |

Login body:

```json
{ "username": "admin", "password": "..." }
```

### Servers

| Method | Path |
|---|---|
| GET | `/api/servers` |
| POST | `/api/servers` |
| GET | `/api/servers/:id` |
| PATCH | `/api/servers/:id` |
| DELETE | `/api/servers/:id` |

Creation example:

```json
{
  "name": "BetterMC Survival",
  "version": "1.21.1",
  "loader": "NeoForge",
  "memoryMb": 8192,
  "port": 25565,
  "maxPlayers": 10,
  "motd": "BetterMC Survival",
  "gamemode": "survival",
  "difficulty": "normal",
  "pvp": true,
  "whitelist": false
}
```

Supported loaders: `Vanilla`, `Paper`, `Fabric`, `Forge`, `NeoForge`.

The Docker image is configured server-side with `MINECRAFT_IMAGE`; clients cannot choose arbitrary images.

### Lifecycle

| Method | Path |
|---|---|
| POST | `/api/servers/:id/start` |
| POST | `/api/servers/:id/stop` |
| POST | `/api/servers/:id/restart` |
| POST | `/api/servers/:id/kill` |

`kill` uses `SIGKILL` and should be treated as an emergency action. Normal shutdown should use `stop` so the Minecraft process can save cleanly.

### Console

| Method | Path |
|---|---|
| GET | `/api/servers/:id/logs?tail=500` |
| POST | `/api/servers/:id/command` |
| WS | `/ws/servers/:id/console` |

Command body:

```json
{ "command": "say Server restart in 5 minutes" }
```

Console WebSocket messages sent by the backend:

```json
{ "type": "log", "line": "2026-... [Server thread/INFO]: Done" }
```

Commands intentionally use the authenticated POST endpoint instead of accepting arbitrary messages on the WebSocket.

### Metrics

| Method | Path |
|---|---|
| GET | `/api/servers/:id/metrics?minutes=60&limit=1000` |
| WS | `/ws/servers/:id/metrics` |

WebSocket payload:

```json
{
  "type": "metrics",
  "data": {
    "cpuPercent": 34,
    "memoryUsedBytes": 2000000000,
    "memoryLimitBytes": 8589934592,
    "diskUsedBytes": 18000000000,
    "networkRxBytes": 1000,
    "networkTxBytes": 2000,
    "tps": 19.8,
    "playersOnline": 3,
    "timestamp": "2026-09-11T23:00:00.000Z"
  }
}
```

Docker CPU/RAM/network values are sampled live. Disk usage is computed under the server root. TPS uses the server's `tps` command when available (Paper and compatible servers); unsupported server types return `null` rather than inventing a TPS value. Metrics are sampled in the backend at `METRICS_INTERVAL_MS` even when no dashboard is connected. WebSockets subscribe to that sampler, while history is persisted at a lower cadence and pruned according to `METRICS_RETENTION_HOURS`.

### Files

| Method | Path | Notes |
|---|---|---|
| GET | `/api/servers/:id/files?path=config` | List a directory |
| GET | `/api/servers/:id/files/content?path=server.properties` | Read an allowed text file |
| PUT | `/api/servers/:id/files/content?path=server.properties` | Write an allowed text file |
| POST | `/api/servers/:id/files/upload?path=mods` | Single multipart file upload |
| DELETE | `/api/servers/:id/files?path=logs/latest.log` | Delete file/directory |
| POST | `/api/servers/:id/files/folder` | Extra helper for the frontend file manager |
| PATCH | `/api/servers/:id/files` | Extra helper to rename within the server root |

Text write body:

```json
{ "content": "motd=My server\n" }
```

Folder body:

```json
{ "path": "config/new-folder" }
```

Rename body:

```json
{ "from": "config/old.yml", "to": "config/new.yml" }
```

The allowlisted top-level server entries are intentionally conservative: `mods`, `plugins`, `config`, `world`, `world_nether`, `world_the_end`, `logs`, `kubejs`, `defaultconfigs`, `resourcepacks`, and core JSON/properties files.

### Mods

| Method | Path |
|---|---|
| GET | `/api/servers/:id/mods` |
| POST | `/api/servers/:id/mods/install` |
| DELETE | `/api/servers/:id/mods/:modId` |
| PATCH | `/api/servers/:id/mods/:modId` |
| POST | `/api/servers/:id/mods/update-all` |

Install example:

```json
{
  "name": "FerriteCore",
  "version": "7.0.2",
  "projectId": "uXXizFIs",
  "versionId": "...",
  "source": "modrinth",
  "downloadUrl": "https://cdn.modrinth.com/.../ferritecore.jar",
  "fileName": "ferritecore.jar"
}
```

Only Fabric/Forge/NeoForge servers accept mods. `update-all` uses the `ModProvider` abstraction; the included implementation resolves current Modrinth versions for the server's Minecraft version and loader.

### Players

| Method | Path |
|---|---|
| GET | `/api/servers/:id/players` |
| POST | `/api/servers/:id/players/:username/kick` |
| POST | `/api/servers/:id/players/:username/ban` |
| POST | `/api/servers/:id/players/:username/op` |
| POST | `/api/servers/:id/players/:username/deop` |
| POST | `/api/servers/:id/players/:username/whitelist` |
| DELETE | `/api/servers/:id/players/:username/whitelist` |

Kick/ban may include:

```json
{ "reason": "Please read the server rules" }
```

The generic Minecraft protocol does not expose reliable ping/playtime data through RCON, so those values are returned as `null` unless a future server plugin/provider supplies them.

### Backups

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/servers/:id/backups` | List backup metadata |
| POST | `/api/servers/:id/backups` | Create a manual `world` or `full` backup |
| GET | `/api/servers/:id/backups/settings` | Read automatic-backup settings |
| PATCH | `/api/servers/:id/backups/settings` | Configure schedule, retention and default type |
| GET | `/api/servers/:id/backups/restore-logs` | Read restore history |
| POST | `/api/servers/:id/backups/:backupId/restore` | Verified, confirmation-gated restore |
| DELETE | `/api/servers/:id/backups/:backupId` | Delete backup metadata + stored archive |
| WS | `/ws/servers/:id/backups` | Backup/restore/prune progress events |

Manual creation body:

```json
{ "type": "full", "notes": "Before upgrading NeoForge" }
```

Restore requires an explicit confirmation body:

```json
{ "confirm": true }
```

Automatic-backup settings example:

```json
{
  "enabled": true,
  "intervalMinutes": 360,
  "retentionCount": 14,
  "defaultType": "world"
}
```

The application-level scheduler runs independently of WebSocket/dashboard connections. `retentionCount` prunes the oldest **scheduled** backups and intentionally preserves manual backups. Backups are gzip-compressed tar archives stored under `/srv/mcpanel/servers/<server-id>/backups`. Metadata records the backup ID, creation time, byte size, `world`/`full` type, `manual`/`scheduled` source, Minecraft version, loader, notes, and SHA-256 checksum.

A running server is quiesced with `save-off` + `save-all flush` during backup and saving is restored in a `finally`-style failure path. Restore first verifies the archive structure and checksum, rejects absolute/traversal paths and links, gracefully stops a running server, extracts into a staging directory, and swaps only validated paths by filesystem rename. If the swap itself fails, the previous paths are restored. The server is restarted only if it was running before the restore. Restore attempts are persisted in `BackupRestoreLog`.

`BackupStorage` is the storage boundary. `LocalBackupStorage` is implemented now; an S3-compatible implementation can later provide the same `createArchive`, `verifyArchive`, `extractArchive`, and `deleteArchive` behavior without changing HTTP routes or scheduler logic.

Progress WebSocket payloads look like:

```json
{
  "type": "backup-progress",
  "data": {
    "operationId": "...",
    "operation": "restore",
    "status": "extracting",
    "progress": 45,
    "message": "Extracting verified backup to staging area",
    "timestamp": "2026-09-12T02:30:00.000Z"
  }
}
```

### Settings / `server.properties`

| Method | Path |
|---|---|
| GET | `/api/servers/:id/settings` |
| PATCH | `/api/servers/:id/settings` |

Patchable settings include:

- server name, MOTD, max players, gamemode, difficulty, PVP, whitelist, online mode
- view distance, simulation distance, RAM allocation, JVM flags, auto-restart schedule metadata
- Minecraft version, loader, loader version
- host port and optional custom domain

Runtime-affecting changes such as version/loader/RAM/port/JVM flags recreate the managed container while preserving the data directory. Server-property changes return `restartRequired: true` so the UI can prompt for a restart.

## Database and PostgreSQL migration path

SQLite is the default and is appropriate for a single-VPS control plane with modest write concurrency.

`prisma/schema.postgresql.prisma` contains the same models with the PostgreSQL provider. To move later:

1. Provision PostgreSQL and take a database backup/export.
2. Set a PostgreSQL `DATABASE_URL`.
3. Generate/migrate with the PostgreSQL schema in a controlled maintenance window.
4. Copy/import the existing SQLite data.
5. Run the API against the PostgreSQL-generated client/migrations.

Do not point the SQLite migration directory at PostgreSQL; create PostgreSQL migrations from the PostgreSQL schema so the migration history matches the target engine.

## Docker requirements

The implementation targets the `itzg/minecraft-server` image and uses its in-container `rcon-cli` utility. The container exposes Minecraft on internal port `25565` and publishes only the selected game port. RCON is enabled with a random per-container password but its port is not published to the host.

`memoryMb` is treated as the container's total RAM allocation. The generated Minecraft container gives the Java heap about 75% of that allocation, leaving roughly 25% for non-heap/native JVM memory and container overhead instead of setting Xmx equal to the cgroup limit. `-XX:` options are passed through the image's `JVM_XX_OPTS`; other approved JVM flags use `JVM_OPTS`.

The server directories should be owned by the UID/GID configured in `MC_UID`/`MC_GID` and not writable by unrelated users.

Example VPS preparation:

```bash
sudo mkdir -p /srv/minecraft-panel/servers /srv/minecraft-panel/backups
sudo chown -R <panel-user>:<panel-group> /srv/minecraft-panel
sudo chmod 750 /srv/minecraft-panel /srv/minecraft-panel/servers /srv/minecraft-panel/backups
```

The backend service account must be able to communicate with Docker. Treat Docker-group membership as privileged access.

## Reverse proxy

Bind the API to loopback (`HOST=127.0.0.1`) and proxy it behind the same HTTPS origin as the Next.js frontend. WebSocket upgrades must be enabled for `/ws/*`. Set `TRUST_PROXY=true` only when requests are actually coming through a trusted reverse proxy, so IP-based rate limiting/audit logs use the real client address.

## Quality checks

After dependencies are installed:

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

`npm run build` uses `tsconfig.build.json`, so production output contains only application code under `dist/` and starts with `node dist/server.js`; integration tests remain outside the deploy artifact.

The integration suite boots the real Fastify app with real auth/server/file/backup/settings/metrics services, in-memory repositories, and a fake `ContainerRuntime`. This exercises the HTTP boundary without requiring Docker in CI.

## Backend/frontend connection

From the Next.js app, set the API base to the same origin when possible and send credentials:

```ts
fetch('/api/servers', { credentials: 'include' });
```

For WebSockets, reuse the browser session cookie automatically by connecting to the same site:

```text
wss://panel.example.com/ws/servers/<server-id>/console
wss://panel.example.com/ws/servers/<server-id>/metrics
```

Do not expose the backend's Docker socket, internal container IDs, or host paths to frontend code.

## Docker Minecraft runtime

The backend now creates one isolated Docker container per Minecraft server through the `ContainerRuntime` interface. The default implementation uses `itzg/minecraft-server`, but all vendor-specific image/environment translation is isolated in `src/services/docker/adapters/itzg-adapter.ts` behind `MinecraftImageAdapter`.

### Runtime layout

Each server owns a host directory under `SERVER_DATA_ROOT` (default `/srv/mcpanel/servers`):

```text
/srv/mcpanel/servers/<server-id>/
├── data/       # world, server.properties, whitelist, ops, server runtime data
├── mods/       # Fabric/Forge/NeoForge mods
├── config/     # mod/server config
├── logs/       # Minecraft logs
└── backups/    # panel-generated tar.gz backups
```

The container receives the following bind mounts:

```text
<root>/data   -> /data
<root>/mods   -> /data/mods
<root>/config -> /data/config
<root>/logs   -> /data/logs
```

Backups are intentionally not mounted into the Minecraft container.

### Supported runtime settings

Server creation and update APIs support:

- `loader`: `Vanilla | Paper | Fabric | Forge | NeoForge`
- `version`: Minecraft version
- `loaderVersion`: optional loader/build version
- `memoryMb`: container memory ceiling
- `javaVersion`: `17 | 21 | 25`
- `restartPolicy`: `no | on-failure | unless-stopped | always`
- `port`: host Minecraft TCP port
- `jvmFlags`: validated JVM flags

The itzg adapter maps Java selection to image tags such as `itzg/minecraft-server:java21`, enables EULA acceptance, configures loader/version/memory, enables RCON with a freshly generated random password, and uses `UID`/`GID` for the Minecraft process.

### Docker isolation

The runtime:

- creates/reuses the dedicated `DOCKER_NETWORK` bridge network
- never uses host networking or privileged mode
- publishes only container `25565/tcp`
- does not publish RCON
- labels every managed container and refuses to control unlabeled containers
- applies a memory limit and matching swap limit
- applies a PID limit
- drops all Linux capabilities except `SETUID` and `SETGID`
- enables `no-new-privileges`
- uses Docker `json-file` log rotation
- configures `mc-health`
- uses a Docker restart policy so servers survive backend restarts

Console commands use `docker exec ... rcon-cli` inside the managed container. No arbitrary host command execution is used.

### Graceful shutdown

Stop and restart operations first send Minecraft's `stop` command through RCON and wait for the server process to exit. If it does not stop in the grace window, Docker's bounded stop operation is used as a fallback. `kill` remains an explicit emergency action.

### Permissions

Set `MC_UID` and `MC_GID` to the non-root identity that should own Minecraft data. With `MC_MANAGE_OWNERSHIP=true`, the backend creates and `chown`s the runtime directories before container creation. If the backend itself is intentionally unprivileged, pre-create/chown the directories externally and set `MC_MANAGE_OWNERSHIP=false`.

### Runtime environment

See `.env.example`. Important variables are:

```dotenv
SERVER_DATA_ROOT=/srv/mcpanel/servers
DOCKER_SOCKET=/var/run/docker.sock
DOCKER_NETWORK=mcpanel-internal
MINECRAFT_IMAGE_REPOSITORY=itzg/minecraft-server
MC_BIND_ADDRESS=0.0.0.0
MC_DEFAULT_JAVA_VERSION=21
MC_DEFAULT_RESTART_POLICY=unless-stopped
MC_UID=1000
MC_GID=1000
MC_MANAGE_OWNERSHIP=true
MC_HEAP_RATIO=0.75
MC_TIMEZONE=UTC
```

Do not expose the Docker socket to the browser or public network. The backend should be the only component with Docker Engine access.

### Compose reference template

`deploy/compose/minecraft-server.compose.template.yaml` documents the equivalent Compose definition used by the Docker Engine implementation. It is a reference/template; normal panel operation creates containers through Dockerode so lifecycle remains under the backend's authorization boundary.

### Runtime validation test

`tests/runtime/container-config.test.ts` creates a mock NeoForge server configuration and validates the produced image, persistent mounts, EULA/loader/version/memory variables, generated RCON credential, Minecraft-only port publishing, and health check.

### Modrinth mods

The browser never receives permission to choose an arbitrary artifact URL. It sends Modrinth project/version IDs to the backend; `ModrinthService` resolves metadata from `api.modrinth.com`, accepts artifacts only from configured trusted Modrinth CDN hosts, verifies the returned JAR's SHA-512, and only then writes it to the server's `mods` directory.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/servers/:id/mods` | Installed mods, including update availability |
| GET | `/api/servers/:id/mods/search?q=&minecraftVersion=&loader=&category=` | Search Modrinth with facets |
| GET | `/api/servers/:id/mods/updates` | Installed mods with compatible updates |
| GET | `/api/servers/:id/mods/modrinth/:projectId/plan?versionId=` | Resolve required/optional/incompatible dependencies before install |
| POST | `/api/servers/:id/mods/install` | Install a trusted compatible Modrinth version and required dependencies |
| POST | `/api/servers/:id/mods/:modId/update` | Update one Modrinth-managed mod |
| POST | `/api/servers/:id/mods/update-all` | Bulk update compatible Modrinth-managed mods |
| PATCH | `/api/servers/:id/mods/:modId` | Enable/disable a mod |
| DELETE | `/api/servers/:id/mods/:modId` | Uninstall a mod |

Install body:

```json
{
  "projectId": "AABBCCDD",
  "versionId": "IIJJKKLL",
  "optionalDependencyProjectIds": ["QQRRSSTT"]
}
```

Compatibility is enforced again server-side at installation time. A Fabric-only version cannot be installed on Forge/NeoForge, and a version that does not list the server's Minecraft version is rejected. Required dependencies are recursively installed; optional dependencies are returned in the install plan and installed only when selected; dependencies marked incompatible by Modrinth are surfaced as warnings/conflicts.

Modrinth metadata responses use an in-memory TTL cache with in-flight request de-duplication. Transient `408`, `425`, `429`, `5xx`, timeout, and network failures are retried with bounded exponential backoff. Modrinth documents a per-IP rate limit and exposes rate-limit headers; the retry path honors `X-Ratelimit-Reset` when present.

Relevant environment variables:

```dotenv
MODRINTH_API_HOST=api.modrinth.com
MOD_DOWNLOAD_HOSTS=cdn.modrinth.com
MODRINTH_USER_AGENT=minecraft-panel/0.1 (self-hosted)
MODRINTH_CACHE_TTL_MS=60000
MODRINTH_CACHE_MAX_ENTRIES=500
MODRINTH_TIMEOUT_MS=10000
MODRINTH_RETRY_COUNT=3
MODRINTH_RETRY_BASE_MS=250
```

## Ubuntu 24.04 production deployment

The repository root now contains the production VPS deployment bundle. See `../DEPLOYMENT.md`, `../docker-compose.production.yml`, and `../deploy/ubuntu/install.sh`.

Production does not mount the raw Docker socket into this backend. Set `DOCKER_HOST=tcp://socket-proxy:2375`; `DockerContainerRuntime` supports that internal TCP endpoint while retaining `DOCKER_SOCKET` for local development.


## Production authentication

The API uses Argon2id password hashing, opaque database-backed sessions, HttpOnly cookies, CSRF protection, account lockout, optional TOTP/recovery codes, session revocation, and RBAC. See the repository root `AUTHENTICATION.md` for endpoints and production setup.
