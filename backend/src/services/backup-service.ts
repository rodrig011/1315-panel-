import { chown, lstat, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Backup, BackupRestoreLog } from '@prisma/client';
import type { AppEnv } from '../config/env.js';
import { KeyedLock } from '../lib/async-lock.js';
import { ConflictError, ForbiddenError, ValidationError } from '../lib/errors.js';
import { parseServerProperties } from '../lib/server-properties.js';
import type { BackupRepository } from '../repositories/backup-repository.js';
import type { ServerRepository } from '../repositories/server-repository.js';
import type { ContainerRuntime } from './docker/container-runtime.js';
import type { ServerRecord } from '../types/domain.js';
import { BackupProgressHub } from './backup-progress.js';
import type { BackupStorage } from './backups/backup-storage.js';

export type BackupType = 'world' | 'full';
export type BackupSource = 'manual' | 'scheduled';

export interface BackupDto {
  id: string;
  createdAt: string;
  sizeBytes: number;
  type: BackupType;
  source: BackupSource;
  minecraftVersion: string | null;
  loader: string | null;
  notes: string | null;
  checksumSha256: string | null;
}

export interface BackupSettingsDto {
  enabled: boolean;
  intervalMinutes: number;
  retentionCount: number;
  defaultType: BackupType;
  lastRunAt: string | null;
}

export interface RestoreLogDto {
  id: string;
  backupId: string;
  status: string;
  message: string | null;
  startedAt: string;
  completedAt: string | null;
}

export class BackupService {
  constructor(
    private readonly env: AppEnv,
    private readonly backups: BackupRepository,
    private readonly servers: ServerRepository,
    private readonly runtime: ContainerRuntime,
    private readonly storage: BackupStorage,
    readonly progress: BackupProgressHub,
    private readonly lock: KeyedLock = new KeyedLock(),
  ) {}

  async list(serverId: string): Promise<BackupDto[]> {
    await this.servers.requireById(serverId);
    return (await this.backups.list(serverId)).map(toDto);
  }

  async settings(serverId: string): Promise<BackupSettingsDto> {
    return settingsDto(await this.servers.requireById(serverId));
  }

  async updateSettings(serverId: string, input: Partial<{ enabled: boolean; intervalMinutes: number; retentionCount: number; defaultType: BackupType }>): Promise<BackupSettingsDto> {
    await this.servers.requireById(serverId);
    const updated = await this.servers.update(serverId, {
      ...(input.enabled !== undefined ? { backupEnabled: input.enabled } : {}),
      ...(input.intervalMinutes !== undefined ? { backupIntervalMinutes: input.intervalMinutes } : {}),
      ...(input.retentionCount !== undefined ? { backupRetentionCount: input.retentionCount } : {}),
      ...(input.defaultType !== undefined ? { backupDefaultType: input.defaultType } : {}),
    });
    if (input.retentionCount !== undefined) await this.prune(serverId, input.retentionCount);
    return settingsDto(updated);
  }

  async create(serverId: string, input: { type?: BackupType; source?: BackupSource; notes?: string | null } = {}): Promise<BackupDto> {
    const operationId = randomUUID();
    this.emit(serverId, operationId, 'create', 'queued', 0, 'Backup queued');
    return this.lock.run(serverId, async () => {
      const server = await this.servers.requireById(serverId);
      const type = input.type ?? normalizeBackupType(server.backupDefaultType);
      const source = input.source ?? 'manual';
      const fileName = `${timestampForFile()}-${type}-${randomUUID().slice(0, 8)}.tar.gz`;
      let savingDisabled = false;

      try {
        this.emit(serverId, operationId, 'create', 'running', 10, 'Preparing server data');
        const running = (await this.runtime.status(server)) === 'running';
        if (running) {
          await this.runtime.command(server, 'save-off');
          savingDisabled = true;
          await this.runtime.command(server, 'save-all flush');
        }

        const relativePaths = await backupPaths(server, type);
        this.emit(serverId, operationId, 'create', 'running', 35, 'Compressing backup archive');
        const stored = await this.storage.createArchive({ serverId, serverRoot: server.rootPath, fileName, relativePaths });

        this.emit(serverId, operationId, 'create', 'verifying', 75, 'Verifying backup archive');
        const verification = await this.storage.verifyArchive(server.rootPath, stored.key);
        this.assertEntriesAllowed(type, verification.entries, relativePaths);
        if (verification.checksumSha256 !== stored.checksumSha256) throw new ValidationError('Backup checksum verification failed');

        if (savingDisabled) {
          await this.runtime.command(server, 'save-on');
          savingDisabled = false;
        }

        const backup = await this.backups.create({
          serverId,
          type,
          source,
          fileName,
          filePath: stored.filePath,
          storageKey: stored.key,
          sizeBytes: stored.sizeBytes,
          minecraftVersion: server.version,
          loader: server.loader,
          notes: sanitizeNotes(input.notes),
          checksumSha256: stored.checksumSha256,
        });

        if (source === 'scheduled') await this.servers.update(serverId, { backupLastRunAt: new Date() });
        await this.pruneUnlocked(serverId, server.backupRetentionCount, server);
        this.emit(serverId, operationId, 'create', 'completed', 100, 'Backup completed', backup.id);
        return toDto(backup);
      } catch (error) {
        if (savingDisabled) await this.runtime.command(server, 'save-on').catch(() => undefined);
        await this.storage.deleteArchive(server.rootPath, fileName).catch(() => undefined);
        this.emit(serverId, operationId, 'create', 'failed', 100, messageOf(error));
        throw error;
      }
    });
  }

  async restore(serverId: string, backupId: string, confirm: boolean): Promise<void> {
    if (!confirm) throw new ValidationError('Restore confirmation is required');
    const operationId = randomUUID();
    this.emit(serverId, operationId, 'restore', 'queued', 0, 'Restore queued', backupId);
    await this.lock.run(serverId, async () => {
      const server = await this.servers.requireById(serverId);
      const backup = await this.backups.require(serverId, backupId);
      const restoreLog = await this.backups.createRestoreLog({ serverId, backupId, status: 'running', message: 'Restore started' });
      const key = backup.storageKey ?? backup.fileName;
      const wasRunning = (await this.runtime.status(server)) === 'running';
      const staging = join(server.rootPath, `.restore-${randomUUID()}`);
      const previous = join(server.rootPath, `.previous-${randomUUID()}`);
      let stopped = false;

      try {
        this.emit(serverId, operationId, 'restore', 'verifying', 10, 'Verifying archive and checksum', backupId);
        const verification = await this.storage.verifyArchive(server.rootPath, key);
        const relativePaths = await backupPaths(server, normalizeBackupType(backup.type));
        this.assertEntriesAllowed(normalizeBackupType(backup.type), verification.entries, relativePaths);
        if (backup.checksumSha256 && verification.checksumSha256 !== backup.checksumSha256) throw new ValidationError('Backup checksum does not match recorded metadata');

        if (wasRunning) {
          this.emit(serverId, operationId, 'restore', 'stopping-server', 20, 'Stopping Minecraft safely before restore', backupId);
          await this.runtime.stop(server, 30);
          stopped = true;
          const afterStop = await this.runtime.status(server);
          if (afterStop === 'running') throw new ConflictError('Server could not be stopped safely; restore aborted');
        }

        await mkdir(staging, { recursive: false, mode: 0o750 });
        await mkdir(previous, { recursive: false, mode: 0o750 });
        this.emit(serverId, operationId, 'restore', 'extracting', 45, 'Extracting verified backup to staging area', backupId);
        await this.storage.extractArchive(server.rootPath, key, staging);

        this.emit(serverId, operationId, 'restore', 'swapping', 70, 'Atomically replacing server data', backupId);
        await atomicSwap(server, staging, previous, verification.entries);
        if (this.env.MC_MANAGE_OWNERSHIP) await applyOwnership(server.rootPath, minimalRoots(verification.entries), this.env.MC_UID, this.env.MC_GID);
        await rm(previous, { recursive: true, force: true });
        await rm(staging, { recursive: true, force: true });

        if (wasRunning) {
          this.emit(serverId, operationId, 'restore', 'restarting-server', 90, 'Restarting Minecraft server', backupId);
          await this.runtime.start(server);
        }
        await this.backups.updateRestoreLog(restoreLog.id, { status: 'completed', message: 'Restore completed successfully', completedAt: new Date() });
        this.emit(serverId, operationId, 'restore', 'completed', 100, 'Restore completed', backupId);
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        await rm(previous, { recursive: true, force: true }).catch(() => undefined);
        if (wasRunning && stopped) await this.runtime.start(server).catch(() => undefined);
        await this.backups.updateRestoreLog(restoreLog.id, { status: 'failed', message: messageOf(error), completedAt: new Date() }).catch(() => undefined);
        this.emit(serverId, operationId, 'restore', 'failed', 100, messageOf(error), backupId);
        throw error;
      }
    });
  }

  async delete(serverId: string, backupId: string): Promise<void> {
    await this.lock.run(serverId, async () => {
      const server = await this.servers.requireById(serverId);
      const backup = await this.backups.require(serverId, backupId);
      await this.storage.deleteArchive(server.rootPath, backup.storageKey ?? backup.fileName);
      await this.backups.delete(backup.id);
    });
  }

  async prune(serverId: string, retentionCount?: number): Promise<number> {
    return this.lock.run(serverId, async () => {
      const server = await this.servers.requireById(serverId);
      return this.pruneUnlocked(serverId, retentionCount ?? server.backupRetentionCount, server);
    });
  }

  private async pruneUnlocked(serverId: string, retentionCount: number, server: ServerRecord): Promise<number> {
    const scheduled = (await this.backups.list(serverId)).filter((backup) => backup.source === 'scheduled');
    const remove = scheduled.slice(Math.max(0, retentionCount));
    if (remove.length === 0) return 0;
    const operationId = randomUUID();
    this.emit(serverId, operationId, 'prune', 'running', 0, `Pruning ${remove.length} old automatic backup(s)`);
    for (let index = 0; index < remove.length; index += 1) {
      const backup = remove[index]!;
      await this.storage.deleteArchive(server.rootPath, backup.storageKey ?? backup.fileName);
      await this.backups.delete(backup.id);
      this.emit(serverId, operationId, 'prune', 'running', Math.round(((index + 1) / remove.length) * 100), 'Pruning old automatic backups');
    }
    this.emit(serverId, operationId, 'prune', 'completed', 100, 'Backup retention pruning completed');
    return remove.length;
  }

  async restoreLogs(serverId: string, limit = 50): Promise<RestoreLogDto[]> {
    await this.servers.requireById(serverId);
    return (await this.backups.listRestoreLogs(serverId, limit)).map(toRestoreLogDto);
  }

  private assertEntriesAllowed(type: BackupType, entries: string[], relativePaths: string[]): void {
    const allowed = relativePaths.map((path) => normalize(path).replaceAll('\\', '/').replace(/\/$/u, ''));
    for (const entry of entries) {
      const normalized = entry.replace(/\/$/u, '');
      if (!allowed.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
        throw new ForbiddenError(`Backup contains an unexpected entry: ${entry}`);
      }
    }
    if (type === 'world' && entries.some((entry) => !entry.startsWith('data/'))) throw new ForbiddenError('World-only backup contains non-world data');
  }

  private emit(serverId: string, operationId: string, operation: 'create' | 'restore' | 'prune', status: Parameters<BackupProgressHub['publish']>[0]['status'], progress: number, message: string, backupId?: string): void {
    this.progress.publish({ serverId, operationId, operation, status, progress, message, ...(backupId ? { backupId } : {}) });
  }
}

async function backupPaths(server: ServerRecord, type: BackupType): Promise<string[]> {
  if (type === 'full') {
    const candidates = ['data', 'mods', 'config', 'logs', 'plugins'];
    const available: string[] = [];
    for (const entry of candidates) if (await exists(join(server.rootPath, entry))) available.push(entry);
    if (available.length === 0) throw new ValidationError('There is no server data to back up');
    return available;
  }

  let levelName = 'world';
  try {
    const content = await readFile(join(server.rootPath, 'data', 'server.properties'), 'utf8');
    levelName = parseServerProperties(content)['level-name']?.trim() || 'world';
  } catch { /* default world */ }
  if (!/^[A-Za-z0-9._ -]{1,64}$/u.test(levelName) || levelName === '.' || levelName === '..') throw new ValidationError('Unsafe level-name in server.properties');
  const candidates = [`data/${levelName}`, `data/${levelName}_nether`, `data/${levelName}_the_end`];
  const available: string[] = [];
  for (const entry of candidates) if (await exists(join(server.rootPath, entry))) available.push(entry);
  if (available.length === 0) throw new ValidationError('No world data was found to back up');
  return available;
}

async function atomicSwap(server: ServerRecord, staging: string, previous: string, archiveEntries: string[]): Promise<void> {
  const roots = minimalRoots(archiveEntries);
  const movedPrevious: string[] = [];
  const installed: string[] = [];
  try {
    for (const relativePath of roots) {
      const current = join(server.rootPath, relativePath);
      const old = join(previous, relativePath);
      const restored = join(staging, relativePath);
      await mkdir(dirname(old), { recursive: true, mode: 0o750 });
      if (await exists(current)) {
        await rename(current, old);
        movedPrevious.push(relativePath);
      }
      if (await exists(restored)) {
        await mkdir(dirname(current), { recursive: true, mode: 0o750 });
        await rename(restored, current);
        installed.push(relativePath);
      }
    }
  } catch (error) {
    for (const relativePath of installed.reverse()) await rm(join(server.rootPath, relativePath), { recursive: true, force: true }).catch(() => undefined);
    for (const relativePath of movedPrevious.reverse()) {
      await mkdir(dirname(join(server.rootPath, relativePath)), { recursive: true, mode: 0o750 }).catch(() => undefined);
      await rename(join(previous, relativePath), join(server.rootPath, relativePath)).catch(() => undefined);
    }
    throw error;
  }
}

function minimalRoots(entries: string[]): string[] {
  const candidates = new Set<string>();
  for (const entry of entries) {
    const parts = entry.split('/').filter(Boolean);
    if (parts[0] === 'data' && parts.length >= 2) candidates.add(`data/${parts[1]}`);
    else if (parts[0]) candidates.add(parts[0]);
  }
  const ordered = [...candidates].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return ordered.filter((candidate, index) => !ordered.slice(0, index).some((parent) => candidate.startsWith(`${parent}/`)));
}

async function applyOwnership(rootPath: string, relativePaths: string[], uid: number, gid: number): Promise<void> {
  for (const relativePath of relativePaths) await chownTree(join(rootPath, relativePath), uid, gid);
}

async function chownTree(path: string, uid: number, gid: number): Promise<void> {
  let info;
  try { info = await lstat(path); } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') return;
    throw error;
  }
  if (info.isSymbolicLink()) throw new ForbiddenError('Symbolic links are not allowed in restored data');
  if (info.isDirectory()) {
    for (const entry of await readdir(path)) await chownTree(join(path, entry), uid, gid);
  }
  await chown(path, uid, gid);
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') return false;
    throw error;
  }
}

function toDto(backup: Backup): BackupDto {
  return { id: backup.id, createdAt: backup.createdAt.toISOString(), sizeBytes: backup.sizeBytes, type: normalizeBackupType(backup.type), source: backup.source === 'scheduled' ? 'scheduled' : 'manual', minecraftVersion: backup.minecraftVersion, loader: backup.loader, notes: backup.notes, checksumSha256: backup.checksumSha256 };
}
function toRestoreLogDto(log: BackupRestoreLog): RestoreLogDto {
  return { id: log.id, backupId: log.backupId, status: log.status, message: log.message, startedAt: log.startedAt.toISOString(), completedAt: log.completedAt?.toISOString() ?? null };
}
function settingsDto(server: ServerRecord): BackupSettingsDto {
  return { enabled: server.backupEnabled, intervalMinutes: server.backupIntervalMinutes, retentionCount: server.backupRetentionCount, defaultType: normalizeBackupType(server.backupDefaultType), lastRunAt: server.backupLastRunAt?.toISOString() ?? null };
}
function normalizeBackupType(value: string): BackupType { return value === 'world' ? 'world' : 'full'; }
function sanitizeNotes(value: string | null | undefined): string | null { const notes = value?.trim(); return notes ? notes.slice(0, 500) : null; }
function timestampForFile(): string { return new Date().toISOString().replace(/[:.]/gu, '-'); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : 'Backup operation failed'; }
