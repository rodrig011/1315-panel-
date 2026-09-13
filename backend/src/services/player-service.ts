import type { ServerRepository } from '../repositories/server-repository.js';
import type { PlayerInfo } from '../types/domain.js';
import { assertMinecraftUsername, sanitizeReason } from '../lib/console.js';
import type { ContainerRuntime } from './docker/container-runtime.js';
import { FileService } from './file-service.js';

interface NamedUuid {
  name: string;
  uuid: string;
}

export class PlayerService {
  constructor(
    private readonly servers: ServerRepository,
    private readonly runtime: ContainerRuntime,
    private readonly files: FileService,
  ) {}

  async list(serverId: string): Promise<PlayerInfo[]> {
    const server = await this.servers.requireById(serverId);
    const [online, whitelist, ops, cache] = await Promise.all([
      this.onlineNames(server).catch(() => []),
      this.readNamedUuid(server, 'data/whitelist.json'),
      this.readNamedUuid(server, 'data/ops.json'),
      this.readNamedUuid(server, 'usercache.json'),
    ]);

    const names = new Set<string>([
      ...online,
      ...whitelist.map((item) => item.name),
      ...ops.map((item) => item.name),
      ...cache.map((item) => item.name),
    ]);
    const uuidByName = new Map(cache.map((item) => [item.name.toLowerCase(), item.uuid]));
    for (const item of whitelist) uuidByName.set(item.name.toLowerCase(), item.uuid);
    for (const item of ops) uuidByName.set(item.name.toLowerCase(), item.uuid);
    const onlineSet = new Set(online.map((name) => name.toLowerCase()));
    const whitelistSet = new Set(whitelist.map((item) => item.name.toLowerCase()));
    const opSet = new Set(ops.map((item) => item.name.toLowerCase()));

    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((username) => ({
        username,
        uuid: uuidByName.get(username.toLowerCase()) ?? null,
        online: onlineSet.has(username.toLowerCase()),
        op: opSet.has(username.toLowerCase()),
        whitelisted: whitelistSet.has(username.toLowerCase()),
        ping: null,
        playtimeSeconds: null,
      }));
  }

  kick(serverId: string, username: string, reason?: string): Promise<string> {
    return this.run(serverId, `kick ${assertMinecraftUsername(username)}${reasonPart(reason)}`);
  }

  ban(serverId: string, username: string, reason?: string): Promise<string> {
    return this.run(serverId, `ban ${assertMinecraftUsername(username)}${reasonPart(reason)}`);
  }

  op(serverId: string, username: string): Promise<string> {
    return this.run(serverId, `op ${assertMinecraftUsername(username)}`);
  }

  deop(serverId: string, username: string): Promise<string> {
    return this.run(serverId, `deop ${assertMinecraftUsername(username)}`);
  }

  whitelist(serverId: string, username: string): Promise<string> {
    return this.run(serverId, `whitelist add ${assertMinecraftUsername(username)}`);
  }

  removeWhitelist(serverId: string, username: string): Promise<string> {
    return this.run(serverId, `whitelist remove ${assertMinecraftUsername(username)}`);
  }

  private async run(serverId: string, command: string): Promise<string> {
    const server = await this.servers.requireById(serverId);
    return this.runtime.command(server, command);
  }

  private async onlineNames(server: Awaited<ReturnType<ServerRepository['requireById']>>): Promise<string[]> {
    if ((await this.runtime.status(server)) !== 'running') return [];
    const output = await this.runtime.command(server, 'list');
    const colon = output.lastIndexOf(':');
    if (colon < 0) return [];
    return output
      .slice(colon + 1)
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => /^[A-Za-z0-9_]{3,16}$/u.test(name));
  }

  private async readNamedUuid(
    server: Awaited<ReturnType<ServerRepository['requireById']>>,
    fileName: string,
  ): Promise<NamedUuid[]> {
    try {
      const text = await this.files.readText(server, fileName);
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((value): NamedUuid[] => {
        if (!value || typeof value !== 'object') return [];
        const record = value as Record<string, unknown>;
        return typeof record.name === 'string' && typeof record.uuid === 'string'
          ? [{ name: record.name, uuid: record.uuid }]
          : [];
      });
    } catch {
      return [];
    }
  }
}

function reasonPart(reason: string | undefined): string {
  const safe = sanitizeReason(reason);
  return safe ? ` ${safe}` : '';
}
