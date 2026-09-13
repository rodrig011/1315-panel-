import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import type { Backup, BackupRestoreLog, InstalledMod, MetricSample, User, Session } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { AuthService } from '../src/services/auth-service.js';
import { BackupService } from '../src/services/backup-service.js';
import { BackupScheduler } from '../src/services/backup-scheduler.js';
import { BackupProgressHub } from '../src/services/backup-progress.js';
import { LocalBackupStorage } from '../src/services/backups/local-backup-storage.js';
import type { ContainerCreateSpec, ContainerRuntime, CreatedContainer } from '../src/services/docker/container-runtime.js';
import { FileService } from '../src/services/file-service.js';
import { MetricsService } from '../src/services/metrics-service.js';
import { MinecraftServerService } from '../src/services/minecraft-server-service.js';
import { ModService } from '../src/services/mod-service.js';
import { ModrinthService } from '../src/services/modrinth-service.js';
import { PlayerService } from '../src/services/player-service.js';
import type { AppServices } from '../src/services/service-container.js';
import { SettingsService } from '../src/services/settings-service.js';
import type { AuditRepository } from '../src/repositories/audit-repository.js';
import type { BackupRepository } from '../src/repositories/backup-repository.js';
import type { MetricRepository } from '../src/repositories/metric-repository.js';
import type { ModRepository } from '../src/repositories/mod-repository.js';
import type { CreateServerRecord, ServerRepository, UpdateServerRecord } from '../src/repositories/server-repository.js';
import type { UserRepository } from '../src/repositories/user-repository.js';
import type { SessionRepository } from '../src/repositories/session-repository.js';
import type { MetricSnapshot, ServerRecord } from '../src/types/domain.js';

class MemoryUserRepository implements UserRepository {
  private users = new Map<string, User>();
  async findByUsername(username: string): Promise<User | null> { return [...this.users.values()].find((u) => u.username === username) ?? null; }
  async findById(id: string): Promise<User | null> { return this.users.get(id) ?? null; }
  async upsertOwner(username: string, passwordHash: string): Promise<User> { const existing=await this.findByUsername(username); if(existing)return existing; const now=new Date(); const user={id:`user-${this.users.size+1}`,username,email:null,passwordHash,role:'owner',failedLoginCount:0,lockedUntil:null,totpEnabled:false,totpSecretEncrypted:null,recoveryCodeHashes:'[]',passwordChangedAt:now,lastLoginAt:null,createdAt:now,updatedAt:now} as User; this.users.set(user.id,user); return user; }
  async recordFailedLogin(id:string,failedLoginCount:number,lockedUntil:Date|null){const u=this.users.get(id)!;this.users.set(id,{...u,failedLoginCount,lockedUntil} as User);}
  async recordSuccessfulLogin(id:string){const u=this.users.get(id)!;this.users.set(id,{...u,failedLoginCount:0,lockedUntil:null,lastLoginAt:new Date()} as User);}
  async updatePassword(id:string,passwordHash:string){const u=this.users.get(id)!;this.users.set(id,{...u,passwordHash,passwordChangedAt:new Date()} as User);}
  async setTotp(id:string,totpSecretEncrypted:string,recoveryCodeHashes:string,totpEnabled:boolean){const u=this.users.get(id)!;this.users.set(id,{...u,totpSecretEncrypted,recoveryCodeHashes,totpEnabled} as User);}
  async disableTotp(id:string){const u=this.users.get(id)!;this.users.set(id,{...u,totpEnabled:false,totpSecretEncrypted:null,recoveryCodeHashes:'[]'} as User);}
  async updateRecoveryCodeHashes(id:string,recoveryCodeHashes:string){const u=this.users.get(id)!;this.users.set(id,{...u,recoveryCodeHashes} as User);}
}

class MemorySessionRepository implements SessionRepository {
  private items = new Map<string, Session>();
  async create(input: Parameters<SessionRepository['create']>[0]): Promise<Session> { const now=new Date(); const s={id:`session-${this.items.size+1}`,createdAt:now,lastSeenAt:now,revokedAt:null,...input} as Session; this.items.set(s.id,s); return s; }
  async findActiveByTokenHash(tokenHash:string,now:Date){return [...this.items.values()].find(s=>s.tokenHash===tokenHash&&!s.revokedAt&&s.expiresAt>now)??null;}
  async listActiveByUser(userId:string,now:Date){return [...this.items.values()].filter(s=>s.userId===userId&&!s.revokedAt&&s.expiresAt>now);}
  async touch(id:string,at:Date){const s=this.items.get(id);if(s)this.items.set(id,{...s,lastSeenAt:at});}
  async revoke(id:string,userId:string){const s=this.items.get(id);if(!s||s.userId!==userId)return false;this.items.set(id,{...s,revokedAt:new Date()});return true;}
  async revokeAll(userId:string,exceptId?:string){let n=0;for(const [id,s] of this.items){if(s.userId===userId&&!s.revokedAt&&id!==exceptId){this.items.set(id,{...s,revokedAt:new Date()});n++;}}return n;}
  async deleteExpired(now:Date){let n=0;for(const [id,s] of this.items){if(s.expiresAt<=now||s.revokedAt){this.items.delete(id);n++;}}return n;}
}

class MemoryServerRepository implements ServerRepository {
  readonly items = new Map<string, ServerRecord>();

  async list(): Promise<ServerRecord[]> {
    return [...this.items.values()];
  }

  async findById(id: string): Promise<ServerRecord | null> {
    return this.items.get(id) ?? null;
  }

  async requireById(id: string): Promise<ServerRecord> {
    const server = await this.findById(id);
    if (!server) throw new Error('test server missing');
    return server;
  }

  async findByPort(port: number): Promise<ServerRecord | null> {
    return [...this.items.values()].find((server) => server.port === port) ?? null;
  }

  async create(input: CreateServerRecord): Promise<ServerRecord> {
    const now = new Date();
    const server: ServerRecord = {
      id: input.id ?? randomUUID(),
      name: input.name,
      containerId: null,
      containerName: input.containerName,
      rootPath: input.rootPath,
      status: input.status ?? 'offline',
      version: input.version,
      loader: input.loader,
      loaderVersion: input.loaderVersion ?? null,
      memoryMb: input.memoryMb,
      javaVersion: input.javaVersion,
      restartPolicy: input.restartPolicy,
      port: input.port,
      maxPlayers: input.maxPlayers,
      customDomain: null,
      jvmFlags: null,
      autoRestartSchedule: null,
      backupEnabled: false,
      backupIntervalMinutes: 360,
      backupRetentionCount: 14,
      backupDefaultType: 'full',
      backupLastRunAt: null,
      settingsJson: '{}',
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(server.id, server);
    return server;
  }

  async update(id: string, input: UpdateServerRecord): Promise<ServerRecord> {
    const current = await this.requireById(id);
    const next: ServerRecord = { ...current, ...input, updatedAt: new Date() };
    this.items.set(id, next);
    return next;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

class MemoryBackupRepository implements BackupRepository {
  private items = new Map<string, Backup>();
  private restoreItems = new Map<string, BackupRestoreLog>();

  async list(serverId: string): Promise<Backup[]> {
    return [...this.items.values()].filter((backup) => backup.serverId === serverId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async create(input: Parameters<BackupRepository['create']>[0]): Promise<Backup> {
    const backup: Backup = { id: randomUUID(), createdAt: new Date(), storageKey: input.storageKey ?? null, minecraftVersion: input.minecraftVersion ?? null, loader: input.loader ?? null, notes: input.notes ?? null, checksumSha256: input.checksumSha256 ?? null, ...input };
    this.items.set(backup.id, backup);
    return backup;
  }

  async require(serverId: string, id: string): Promise<Backup> {
    const backup = this.items.get(id);
    if (!backup || backup.serverId !== serverId) throw new Error('test backup missing');
    return backup;
  }

  async delete(id: string): Promise<void> { this.items.delete(id); }

  async createRestoreLog(input: { serverId: string; backupId: string; status: string; message?: string | null }): Promise<BackupRestoreLog> {
    const log: BackupRestoreLog = { id: randomUUID(), serverId: input.serverId, backupId: input.backupId, status: input.status, message: input.message ?? null, startedAt: new Date(), completedAt: null };
    this.restoreItems.set(log.id, log);
    return log;
  }

  async updateRestoreLog(id: string, input: { status?: string; message?: string | null; completedAt?: Date | null }): Promise<BackupRestoreLog> {
    const current = this.restoreItems.get(id);
    if (!current) throw new Error('test restore log missing');
    const next = { ...current, ...input };
    this.restoreItems.set(id, next);
    return next;
  }

  async listRestoreLogs(serverId: string, limit: number): Promise<BackupRestoreLog[]> {
    return [...this.restoreItems.values()].filter((item) => item.serverId === serverId).slice(0, limit);
  }
}

class MemoryModRepository implements ModRepository {
  private items = new Map<string, InstalledMod>();

  async list(serverId: string): Promise<InstalledMod[]> {
    return [...this.items.values()].filter((mod) => mod.serverId === serverId);
  }

  async require(serverId: string, id: string): Promise<InstalledMod> {
    const mod = this.items.get(id);
    if (!mod || mod.serverId !== serverId) throw new Error('test mod missing');
    return mod;
  }

  async create(input: {
    serverId: string;
    name: string;
    fileName: string;
    version?: string | null;
    enabled?: boolean;
    source?: string | null;
    sourceProjectId?: string | null;
    sourceVersionId?: string | null;
  }): Promise<InstalledMod> {
    const now = new Date();
    const mod: InstalledMod = {
      id: randomUUID(),
      serverId: input.serverId,
      name: input.name,
      fileName: input.fileName,
      version: input.version ?? null,
      enabled: input.enabled ?? true,
      source: input.source ?? null,
      sourceProjectId: input.sourceProjectId ?? null,
      sourceVersionId: input.sourceVersionId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(mod.id, mod);
    return mod;
  }

  async update(
    id: string,
    input: Partial<Pick<InstalledMod, 'name' | 'fileName' | 'version' | 'enabled' | 'sourceVersionId'>>,
  ): Promise<InstalledMod> {
    const current = this.items.get(id);
    if (!current) throw new Error('test mod missing');
    const next = { ...current, ...input, updatedAt: new Date() };
    this.items.set(id, next);
    return next;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

class MemoryMetricRepository implements MetricRepository {
  private items: MetricSample[] = [];

  async insert(serverId: string, metric: MetricSnapshot): Promise<MetricSample> {
    const sample: MetricSample = {
      id: randomUUID(),
      serverId,
      cpuPercent: metric.cpuPercent,
      ramUsedBytes: metric.memoryUsedBytes,
      ramLimitBytes: metric.memoryLimitBytes,
      diskUsedBytes: metric.diskUsedBytes,
      networkRx: metric.networkRxBytes,
      networkTx: metric.networkTxBytes,
      tps: metric.tps,
      playersOnline: metric.playersOnline,
      createdAt: new Date(metric.timestamp),
    };
    this.items.push(sample);
    return sample;
  }

  async listSince(serverId: string, since: Date, limit: number): Promise<MetricSample[]> {
    return this.items
      .filter((item) => item.serverId === serverId && item.createdAt >= since)
      .slice(0, limit);
  }

  async deleteBefore(before: Date): Promise<number> {
    const previous = this.items.length;
    this.items = this.items.filter((item) => item.createdAt >= before);
    return previous - this.items.length;
  }
}

class MemoryAuditRepository implements AuditRepository {
  readonly entries: Array<{ action: string; serverId?: string }> = [];
  async record(input: {
    userId?: string;
    action: string;
    serverId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
  }): Promise<void> {
    this.entries.push({ action: input.action, ...(input.serverId ? { serverId: input.serverId } : {}) });
  }
}

class FakeRuntime implements ContainerRuntime {
  readonly statusByServer = new Map<string, 'running' | 'stopped'>();
  readonly commands: string[] = [];
  failNextCreate = false;

  async create(spec: ContainerCreateSpec): Promise<CreatedContainer> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('simulated container creation failure');
    }
    this.statusByServer.set(spec.serverId, 'stopped');
    return { id: `container-${spec.serverId}`, name: spec.containerName };
  }
  async remove(server: ServerRecord): Promise<void> {
    this.statusByServer.delete(server.id);
  }
  async start(server: ServerRecord): Promise<void> {
    this.statusByServer.set(server.id, 'running');
  }
  async stop(server: ServerRecord): Promise<void> {
    this.statusByServer.set(server.id, 'stopped');
  }
  async restart(server: ServerRecord): Promise<void> {
    this.statusByServer.set(server.id, 'running');
  }
  async kill(server: ServerRecord): Promise<void> {
    this.statusByServer.set(server.id, 'stopped');
  }
  async status(server: ServerRecord): Promise<'running' | 'stopped' | 'missing'> {
    return this.statusByServer.get(server.id) ?? 'missing';
  }
  async logs(): Promise<string[]> {
    return ['2026-09-11T23:00:00Z [Server thread/INFO]: Done'];
  }
  async streamLogs(): Promise<Readable> {
    return Readable.from(['2026-09-11T23:00:00Z [Server thread/INFO]: Done\n']);
  }
  async attachConsole(): Promise<Readable> {
    return this.streamLogs();
  }
  async command(_server: ServerRecord, command: string): Promise<string> {
    this.commands.push(command);
    if (command === 'list') return 'There are 1 of a max of 10 players online: Alex';
    if (command === 'tps') return 'TPS from last 1m, 5m, 15m: 19.8, 19.9, 20.0';
    return 'OK';
  }
  async metrics() {
    return {
      cpuPercent: 34,
      memoryUsedBytes: 2_000_000_000,
      memoryLimitBytes: 8_000_000_000,
      networkRxBytes: 1024,
      networkTxBytes: 2048,
    };
  }
}


let app: Awaited<ReturnType<typeof buildApp>>;
let workDir: string;
let cookie: string;
let csrfToken: string;
let serverId: string;
let runtime: FakeRuntime;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'minecraft-panel-test-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '4000',
    APP_ORIGIN: 'http://localhost:3000',
    PUBLIC_HOST: 'mc.example.test',
    DATABASE_URL: 'file:./unused-test.db',
    AUTH_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
    AUTH_RECOVERY_PEPPER: '0123456789abcdef0123456789abcdef',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'correct-horse-battery-staple',
    SERVER_DATA_ROOT: join(workDir, 'servers'),
    BACKUP_ROOT: join(workDir, 'legacy-backups'),
    DOCKER_SOCKET: '/var/run/docker.sock',
    DOCKER_NETWORK: 'mcpanel-test',
    MINECRAFT_IMAGE_REPOSITORY: 'itzg/minecraft-server',
    MC_BIND_ADDRESS: '127.0.0.1',
    MC_DEFAULT_JAVA_VERSION: '21',
    MC_DEFAULT_RESTART_POLICY: 'unless-stopped',
    MC_UID: '1000',
    MC_GID: '1000',
    MC_MANAGE_OWNERSHIP: 'false',
    MC_HEAP_RATIO: '0.75',
    MC_TIMEZONE: 'UTC',
    MAX_UPLOAD_BYTES: String(8 * 1024 * 1024),
    MAX_TEXT_FILE_BYTES: String(1024 * 1024),
    METRICS_INTERVAL_MS: '1000',
    METRICS_RETENTION_HOURS: '24',
    MOD_DOWNLOAD_HOSTS: 'cdn.modrinth.com',
    MODRINTH_API_HOST: 'api.modrinth.com',
    COOKIE_NAME: 'mc_panel_session',
    TRUST_PROXY: 'false',
    LOG_LEVEL: 'silent',
  });

  const users = new MemoryUserRepository();
  const serversRepo = new MemoryServerRepository();
  const backupsRepo = new MemoryBackupRepository();
  const modsRepo = new MemoryModRepository();
  const metricsRepo = new MemoryMetricRepository();
  const audit = new MemoryAuditRepository();
  runtime = new FakeRuntime();
  const files = new FileService(env);
  const servers = new MinecraftServerService(serversRepo, runtime, files, env);
  const auth = new AuthService(users, new MemorySessionRepository(), env);
  const backups = new BackupService(env, backupsRepo, serversRepo, runtime, new LocalBackupStorage(), new BackupProgressHub());
  const backupScheduler = new BackupScheduler(serversRepo, backups, 60_000);
  const metrics = new MetricsService(env, serversRepo, runtime, files, metricsRepo);
  const mods = new ModService(modsRepo, serversRepo, files, new ModrinthService(env));
  const players = new PlayerService(serversRepo, runtime, files);
  const settings = new SettingsService(serversRepo, servers, files);
  const services: AppServices = { auth, servers, files, backups, backupScheduler, metrics, mods, players, settings, audit };

  app = await buildApp({ env, services, runtime, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(workDir, { recursive: true, force: true });
});

describe.sequential('Minecraft panel API integration', () => {
  it('logs in with a secure cookie and returns the current user', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'correct-horse-battery-staple' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
    const sessionCookie = cookies.find((value) => value.startsWith('mc_panel_session='))!;
    const csrfCookie = cookies.find((value) => value.startsWith('mc_panel_csrf='))!;
    expect(sessionCookie).toContain('HttpOnly');
    cookie = sessionCookie.split(';')[0]!;
    csrfToken = decodeURIComponent(csrfCookie.split(';')[0]!.split('=')[1]!);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('admin');
  });

  it('creates and starts a managed Minecraft server', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/servers',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {
        name: 'BetterMC Survival',
        version: '1.21.1',
        loader: 'NeoForge',
        memoryMb: 8192,
        port: 25565,
        maxPlayers: 10,
      },
    });
    expect(created.statusCode).toBe(201);
    const server = created.json().server;
    serverId = server.id;
    expect(server.address).toBe('mc.example.test:25565');
    expect(server.status).toBe('offline');

    const started = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/start`,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().server.status).toBe('online');
  });

  it('rejects console control characters and path traversal', async () => {
    const badCommand = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/command`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { command: 'say hello\nstop' },
    });
    expect(badCommand.statusCode).toBe(400);

    const traversal = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/files/content?path=${encodeURIComponent('../etc/passwd')}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    expect([400, 403]).toContain(traversal.statusCode);
  });

  it('updates settings and reads metrics', async () => {
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/settings`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { motd: 'Welcome to BetterMC', viewDistance: 12, maxPlayers: 12 },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().settings.general.motd).toBe('Welcome to BetterMC');

    const metrics = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/metrics`,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json().current.cpuPercent).toBe(34);
    expect(metrics.json().current.tps).toBe(19.8);
  });

  it('rolls back the previous container if a runtime config recreation fails', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().server.memoryMb).toBe(8192);

    runtime.failNextCreate = true;
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { memoryMb: 6144 },
    });
    expect(update.statusCode).toBe(500);

    const after = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().server.memoryMb).toBe(8192);
    expect(after.json().server.status).toBe('online');
  });

  it('creates and restores a backup without shell execution', async () => {
    const record = await app.services.servers.requireRecord(serverId);
    await app.services.files.writeText(record, 'data/server.properties', 'motd=before-backup\n');

    const created = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/backups`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { type: 'full', notes: 'integration test' },
    });
    expect(created.statusCode).toBe(201);
    const backupId = created.json().backup.id as string;

    await app.services.files.writeText(record, 'data/server.properties', 'motd=after-backup\n');
    const unconfirmed = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/backups/${backupId}/restore`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { confirm: false },
    });
    expect(unconfirmed.statusCode).toBe(400);

    const restored = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/backups/${backupId}/restore`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { confirm: true },
    });
    expect(restored.statusCode).toBe(200);
    expect(await readFile(join(record.rootPath, 'data', 'server.properties'), 'utf8')).toContain('before-backup');
  });
  it('runs scheduled backups and prunes old automatic backups to retention', async () => {
    const settings = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/backups/settings`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { enabled: true, intervalMinutes: 15, retentionCount: 1, defaultType: 'full' },
    });
    expect(settings.statusCode).toBe(200);

    await app.services.backupScheduler.tick(new Date());
    await app.services.backupScheduler.tick(new Date(Date.now() + 16 * 60_000));

    const listed = await app.inject({ method: 'GET', url: `/api/servers/${serverId}/backups`, headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    const scheduled = (listed.json().backups as Array<{ source: string }>).filter((backup) => backup.source === 'scheduled');
    expect(scheduled).toHaveLength(1);
  });

});
