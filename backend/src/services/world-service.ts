import { lstat, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { parseServerProperties, serializeServerProperties } from '../lib/server-properties.js';
import type { ServerRepository } from '../repositories/server-repository.js';
import type { ContainerRuntime } from './docker/container-runtime.js';
import { FileService } from './file-service.js';

export interface WorldDto {
  name: string;
  active: boolean;
  sizeBytes: number;
  modifiedAt: string;
  generated: boolean;
}

export class WorldService {
  constructor(
    private readonly servers: ServerRepository,
    private readonly runtime: ContainerRuntime,
    private readonly files: FileService,
  ) {}

  async list(serverId: string): Promise<WorldDto[]> {
    const server = await this.servers.requireById(serverId);
    const properties = parseServerProperties(await this.files.readText(server, 'data/server.properties'));
    const active = properties['level-name'] || 'world';
    const dataRoot = await this.files.resolveForInternalUse(server, 'data');
    const entries = await readdir(dataRoot, { withFileTypes: true });
    const worlds: WorldDto[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const name = entry.name;
      if (!isWorldName(name)) continue;
      const root = join(dataRoot, name);
      const generated = await existsRegularFile(join(root, 'level.dat'));
      const managed = await existsRegularFile(join(root, '.mcpanel-world.txt'));
      if (!generated && !managed && name !== active) continue;
      const info = await stat(root);
      worlds.push({ name, active: name === active, sizeBytes: await directorySize(root), modifiedAt: info.mtime.toISOString(), generated });
    }
    if (!worlds.some((world) => world.name === active)) {
      worlds.unshift({ name: active, active: true, sizeBytes: 0, modifiedAt: server.updatedAt.toISOString(), generated: false });
    }
    return worlds.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }

  async create(serverId: string, name: string, setActive = false): Promise<WorldDto[]> {
    const server = await this.requireStopped(serverId);
    const safeName = validateWorldName(name);
    await this.files.createDirectory(server, `data/${safeName}`);
    await this.files.writeText(server, `data/${safeName}/.mcpanel-world.txt`, 'Created by 1315 Panel\n');
    if (setActive) await this.setActiveProperty(server, safeName);
    return this.list(serverId);
  }

  async setActive(serverId: string, name: string): Promise<WorldDto[]> {
    const server = await this.requireStopped(serverId);
    const safeName = validateWorldName(name);
    const absolute = await this.files.resolveForInternalUse(server, `data/${safeName}`);
    const info = await lstat(absolute).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new NotFoundError('World not found');
    await this.setActiveProperty(server, safeName);
    return this.list(serverId);
  }

  async delete(serverId: string, name: string): Promise<WorldDto[]> {
    const server = await this.requireStopped(serverId);
    const safeName = validateWorldName(name);
    const properties = parseServerProperties(await this.files.readText(server, 'data/server.properties'));
    if ((properties['level-name'] || 'world') === safeName) throw new ConflictError('The active world cannot be deleted');
    await this.files.delete(server, `data/${safeName}`);
    return this.list(serverId);
  }

  private async requireStopped(serverId: string) {
    const server = await this.servers.requireById(serverId);
    if ((await this.runtime.status(server)) === 'running') throw new ConflictError('Stop the server before changing worlds');
    return server;
  }

  private async setActiveProperty(server: Awaited<ReturnType<ServerRepository['requireById']>>, name: string) {
    const text = await this.files.readText(server, 'data/server.properties');
    const properties = parseServerProperties(text);
    properties['level-name'] = name;
    await this.files.writeText(server, 'data/server.properties', serializeServerProperties(properties));
  }
}

function validateWorldName(value: string): string {
  const name = value.trim();
  if (!isWorldName(name) || name === '.' || name === '..') throw new ValidationError('World name may contain letters, numbers, spaces, dots, underscores, and hyphens only');
  return name;
}
function isWorldName(value: string): boolean { return value.length >= 1 && value.length <= 64 && /^[A-Za-z0-9 _.-]+$/u.test(value) && !value.includes('..'); }
async function existsRegularFile(path: string): Promise<boolean> { const info = await lstat(path).catch(() => null); return Boolean(info?.isFile() && !info.isSymbolicLink()); }
async function directorySize(root: string): Promise<number> { let total=0;const queue=[root];while(queue.length){const current=queue.pop()!;const entries=await readdir(current,{withFileTypes:true}).catch(()=>[]);for(const entry of entries){if(entry.isSymbolicLink())continue;const absolute=join(current,entry.name);if(entry.isDirectory())queue.push(absolute);else if(entry.isFile())total+=(await stat(absolute)).size;}}return total; }
