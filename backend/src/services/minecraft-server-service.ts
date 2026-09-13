import { mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppEnv } from '../config/env.js';
import { AppError, ConflictError, ValidationError } from '../lib/errors.js';
import { KeyedLock } from '../lib/async-lock.js';
import { sanitizeConsoleCommand } from '../lib/console.js';
import { serializeServerProperties, validateJvmFlags } from '../lib/server-properties.js';
import type { ServerRepository, UpdateServerRecord } from '../repositories/server-repository.js';
import type { ServerRecord } from '../types/domain.js';
import { FileService } from './file-service.js';
import type { ContainerCreateSpec, ContainerRuntime } from './docker/container-runtime.js';
import { prepareServerRuntimeDirectories } from './docker/server-paths.js';
import type { JavaVersion, RestartPolicy } from './docker/runtime-types.js';

export interface CreateMinecraftServerInput {
  name: string;
  version: string;
  loader: string;
  loaderVersion?: string | null;
  memoryMb: number;
  javaVersion?: JavaVersion;
  restartPolicy?: RestartPolicy;
  port: number;
  maxPlayers: number;
  motd?: string;
  gamemode?: string;
  difficulty?: string;
  pvp?: boolean;
  whitelist?: boolean;
}

export interface UpdateMinecraftServerInput {
  name?: string;
  version?: string;
  loader?: string;
  loaderVersion?: string | null;
  memoryMb?: number;
  javaVersion?: JavaVersion;
  restartPolicy?: RestartPolicy;
  port?: number;
  maxPlayers?: number;
  customDomain?: string | null;
  jvmFlags?: string | null;
  autoRestartSchedule?: string | null;
}

export interface ServerDto {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'starting' | 'stopping' | 'creating' | 'error';
  version: string;
  loader: string;
  loaderVersion: string | null;
  memoryMb: number;
  javaVersion: number;
  restartPolicy: string;
  port: number;
  maxPlayers: number;
  address: string;
  customDomain: string | null;
  createdAt: string;
  updatedAt: string;
}

export class MinecraftServerService {
  constructor(
    private readonly servers: ServerRepository,
    private readonly runtime: ContainerRuntime,
    private readonly files: FileService,
    private readonly env: AppEnv,
    private readonly lock: KeyedLock = new KeyedLock(),
  ) {}

  async list(): Promise<ServerDto[]> {
    const servers = await this.servers.list();
    return Promise.all(servers.map((server) => this.refreshAndMap(server)));
  }

  async get(id: string): Promise<ServerDto> {
    const server = await this.servers.requireById(id);
    return this.refreshAndMap(server);
  }

  requireRecord(id: string): Promise<ServerRecord> {
    return this.servers.requireById(id);
  }

  async create(input: CreateMinecraftServerInput): Promise<ServerDto> {
    this.assertMemory(input.memoryMb);
    const portOwner = await this.servers.findByPort(input.port);
    if (portOwner) throw new ConflictError('That host port is already assigned to another server');

    const id = randomUUID();
    const containerName = `mc-panel-${id.slice(0, 12)}`;
    const rootPath = `${this.env.SERVER_DATA_ROOT}/${id}`;
    const server = await this.servers.create({
      id,
      name: input.name,
      containerName,
      rootPath,
      status: 'creating',
      version: input.version,
      loader: input.loader,
      loaderVersion: input.loaderVersion ?? null,
      memoryMb: input.memoryMb,
      javaVersion: input.javaVersion ?? (this.env.MC_DEFAULT_JAVA_VERSION as JavaVersion),
      restartPolicy: input.restartPolicy ?? this.env.MC_DEFAULT_RESTART_POLICY,
      port: input.port,
      maxPlayers: input.maxPlayers,
    });

    try {
      await mkdir(rootPath, { recursive: true, mode: 0o750 });
      await this.files.ensureServerRoot(server);
      await prepareServerRuntimeDirectories(this.env, rootPath);
      await this.files.createDirectory(server, 'plugins').catch(() => undefined);
      await this.files.writeText(
        server,
        'data/server.properties',
        serializeServerProperties({
          motd: input.motd ?? input.name,
          'max-players': String(input.maxPlayers),
          gamemode: input.gamemode ?? 'survival',
          difficulty: input.difficulty ?? 'normal',
          pvp: String(input.pvp ?? true),
          whitelist: String(input.whitelist ?? false),
          'online-mode': 'true',
          'server-port': '25565',
          'view-distance': '10',
          'simulation-distance': '10',
        }),
      );
      await this.files.writeText(server, 'data/eula.txt', 'eula=true\n');

      const created = await this.runtime.create(this.toContainerSpec(server));
      const updated = await this.servers.update(server.id, { containerId: created.id, status: 'offline' });
      return this.toDto(updated);
    } catch (error) {
      await this.servers.update(server.id, { status: 'error' }).catch(() => undefined);
      throw error;
    }
  }

  async update(id: string, input: UpdateMinecraftServerInput): Promise<ServerDto> {
    return this.lock.run(id, () => this.updateUnlocked(id, input));
  }

  private async updateUnlocked(id: string, input: UpdateMinecraftServerInput): Promise<ServerDto> {
    const current = await this.servers.requireById(id);
    if (input.memoryMb !== undefined) this.assertMemory(input.memoryMb);
    if (input.port !== undefined && input.port !== current.port) {
      const portOwner = await this.servers.findByPort(input.port);
      if (portOwner && portOwner.id !== id) throw new ConflictError('That host port is already assigned to another server');
    }

    const safeJvmFlags = validateJvmFlags(input.jvmFlags);
    const runtimeChange =
      (input.version !== undefined && input.version !== current.version) ||
      (input.loader !== undefined && input.loader !== current.loader) ||
      (input.loaderVersion !== undefined && input.loaderVersion !== current.loaderVersion) ||
      (input.memoryMb !== undefined && input.memoryMb !== current.memoryMb) ||
      (input.javaVersion !== undefined && input.javaVersion !== current.javaVersion) ||
      (input.restartPolicy !== undefined && input.restartPolicy !== current.restartPolicy) ||
      (input.port !== undefined && input.port !== current.port) ||
      (safeJvmFlags !== undefined && safeJvmFlags !== current.jvmFlags);

    const update: UpdateServerRecord = { ...input };
    if (safeJvmFlags !== undefined) update.jvmFlags = safeJvmFlags;
    const updated = await this.servers.update(id, update);

    if (input.maxPlayers !== undefined && input.maxPlayers !== current.maxPlayers) {
      await this.patchProperty(updated, 'max-players', String(input.maxPlayers));
    }

    if (runtimeChange) await this.recreateContainer(updated, current);
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.lock.run(id, async () => {
      const server = await this.servers.requireById(id);
      await this.runtime.remove(server).catch((error) => {
        if (error instanceof AppError && error.code === 'CONTAINER_MISSING') return;
        throw error;
      });
      await this.files.removeServerRoot(server);
      const backupBase = resolve(this.env.BACKUP_ROOT);
      const backupPath = resolve(backupBase, server.id);
      if (backupPath.startsWith(`${backupBase}${sep}`)) await rm(backupPath, { recursive: true, force: true });
      await this.servers.delete(id);
    });
  }

  async start(id: string): Promise<ServerDto> { return this.runAction(id, 'starting', async (server) => this.runtime.start(server), 'online'); }
  async stop(id: string): Promise<ServerDto> { return this.runAction(id, 'stopping', async (server) => this.runtime.stop(server), 'offline'); }
  async restart(id: string): Promise<ServerDto> { return this.runAction(id, 'starting', async (server) => this.runtime.restart(server), 'online'); }
  async kill(id: string): Promise<ServerDto> { return this.runAction(id, 'stopping', async (server) => this.runtime.kill(server), 'offline'); }
  async logs(id: string, tail: number): Promise<string[]> { const server = await this.servers.requireById(id); return this.runtime.logs(server, tail); }
  async command(id: string, command: string): Promise<string> {
    const server = await this.servers.requireById(id);
    if ((await this.runtime.status(server)) !== 'running') throw new ConflictError('Server must be online to send console commands');
    return this.runtime.command(server, sanitizeConsoleCommand(command));
  }
  async streamLogs(id: string) { const server = await this.servers.requireById(id); return this.runtime.streamLogs(server); }

  private async runAction(id: string, transition: string, action: (server: ServerRecord) => Promise<void>, success: string): Promise<ServerDto> {
    return this.lock.run(id, async () => {
      const server = await this.servers.requireById(id);
      await this.servers.update(id, { status: transition });
      try {
        await action(server);
        const updated = await this.servers.update(id, { status: success });
        return this.toDto(updated);
      } catch (error) {
        await this.servers.update(id, { status: 'error' }).catch(() => undefined);
        throw error;
      }
    });
  }

  private async refreshAndMap(server: ServerRecord): Promise<ServerDto> {
    const status = await this.runtime.status(server).catch(() => 'missing' as const);
    const desired = status === 'running' ? 'online' : status === 'stopped' ? 'offline' : 'error';
    const updated = server.status === desired ? server : await this.servers.update(server.id, { status: desired });
    return this.toDto(updated);
  }

  private async recreateContainer(updated: ServerRecord, previous: ServerRecord): Promise<void> {
    const wasRunning = (await this.runtime.status(previous).catch(() => 'missing' as const)) === 'running';
    let previousRemoved = false;
    let replacementContainerId: string | null = null;
    try {
      if (previous.containerId) { await this.runtime.remove(previous); previousRemoved = true; }
      const created = await this.runtime.create(this.toContainerSpec(updated));
      replacementContainerId = created.id;
      const record = await this.servers.update(updated.id, { containerId: created.id, status: 'offline' });
      if (wasRunning) { await this.runtime.start(record); await this.servers.update(updated.id, { status: 'online' }); }
    } catch (error) {
      if (replacementContainerId) await this.runtime.remove({ ...updated, containerId: replacementContainerId }).catch(() => undefined);
      try {
        let rollbackContainerId = previous.containerId;
        if (previousRemoved) rollbackContainerId = (await this.runtime.create(this.toContainerSpec(previous))).id;
        const restoredRecord = await this.servers.update(updated.id, { ...runtimeRollbackFields(previous), containerId: rollbackContainerId, status: 'offline' });
        await this.patchProperty(restoredRecord, 'max-players', String(previous.maxPlayers)).catch(() => undefined);
        if (wasRunning && restoredRecord.containerId) { await this.runtime.start(restoredRecord); await this.servers.update(updated.id, { status: 'online' }); }
      } catch {
        await this.servers.update(updated.id, { containerId: null, status: 'error' }).catch(() => undefined);
        throw new AppError('Server configuration failed and the previous container could not be restored', 502, 'SERVER_ROLLBACK_FAILED');
      }
      throw error;
    }
  }

  private toContainerSpec(server: ServerRecord): ContainerCreateSpec {
    return { serverId: server.id, containerName: server.containerName, rootPath: server.rootPath, version: server.version, loader: server.loader, loaderVersion: server.loaderVersion, memoryMb: server.memoryMb, javaVersion: server.javaVersion as JavaVersion, restartPolicy: server.restartPolicy as RestartPolicy, port: server.port, maxPlayers: server.maxPlayers, jvmFlags: server.jvmFlags };
  }

  private async patchProperty(server: ServerRecord, key: string, value: string): Promise<void> {
    const current = await this.files.readText(server, 'data/server.properties');
    const lines = current.split(/\r?\n/u);
    let found = false;
    const next = lines.map((line) => { if (line.startsWith(`${key}=`)) { found = true; return `${key}=${value}`; } return line; });
    if (!found) next.push(`${key}=${value}`);
    await this.files.writeText(server, 'data/server.properties', `${next.filter(Boolean).join('\n')}\n`);
  }

  private assertMemory(memoryMb: number): void {
    if (memoryMb > this.env.MC_MAX_MEMORY_MB) {
      throw new ValidationError(`Memory allocation exceeds this host profile. Maximum is ${this.env.MC_MAX_MEMORY_MB} MB.`);
    }
  }

  private toDto(server: ServerRecord): ServerDto {
    const host = server.customDomain ?? this.env.PUBLIC_HOST;
    return { id: server.id, name: server.name, status: normalizeStatus(server.status), version: server.version, loader: server.loader, loaderVersion: server.loaderVersion, memoryMb: server.memoryMb, javaVersion: server.javaVersion, restartPolicy: server.restartPolicy, port: server.port, maxPlayers: server.maxPlayers, address: `${host}:${server.port}`, customDomain: server.customDomain, createdAt: server.createdAt.toISOString(), updatedAt: server.updatedAt.toISOString() };
  }
}

function runtimeRollbackFields(previous: ServerRecord): UpdateServerRecord {
  return { name: previous.name, version: previous.version, loader: previous.loader, loaderVersion: previous.loaderVersion, memoryMb: previous.memoryMb, javaVersion: previous.javaVersion, restartPolicy: previous.restartPolicy, port: previous.port, maxPlayers: previous.maxPlayers, customDomain: previous.customDomain, jvmFlags: previous.jvmFlags, autoRestartSchedule: previous.autoRestartSchedule, settingsJson: previous.settingsJson };
}

function normalizeStatus(value: string): ServerDto['status'] {
  switch (value) {
    case 'online': case 'offline': case 'starting': case 'stopping': case 'creating': case 'error': return value;
    default: return 'error';
  }
}
