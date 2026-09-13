import { parseServerProperties, serializeServerProperties } from '../lib/server-properties.js';
import type { ServerRepository } from '../repositories/server-repository.js';
import { FileService } from './file-service.js';
import type { MinecraftServerService, UpdateMinecraftServerInput } from './minecraft-server-service.js';

export interface ServerSettingsPatch {
  serverName?: string;
  motd?: string;
  maxPlayers?: number;
  gamemode?: 'survival' | 'creative' | 'adventure' | 'spectator';
  difficulty?: 'peaceful' | 'easy' | 'normal' | 'hard';
  pvp?: boolean;
  whitelist?: boolean;
  onlineMode?: boolean;
  viewDistance?: number;
  simulationDistance?: number;
  ramMb?: number;
  javaVersion?: 17 | 21 | 25;
  restartPolicy?: 'no' | 'on-failure' | 'unless-stopped' | 'always';
  jvmFlags?: string | null;
  autoRestartSchedule?: string | null;
  minecraftVersion?: string;
  loader?: string;
  loaderVersion?: string | null;
  port?: number;
  customDomain?: string | null;
}

export class SettingsService {
  constructor(
    private readonly servers: ServerRepository,
    private readonly serverService: MinecraftServerService,
    private readonly files: FileService,
  ) {}

  async get(serverId: string) {
    const server = await this.servers.requireById(serverId);
    const properties = parseServerProperties(await this.files.readText(server, 'data/server.properties'));
    return {
      general: {
        serverName: server.name,
        motd: properties.motd ?? server.name,
        maxPlayers: numberValue(properties['max-players'], server.maxPlayers),
        gamemode: properties.gamemode ?? 'survival',
        difficulty: properties.difficulty ?? 'normal',
        pvp: boolValue(properties.pvp, true),
        whitelist: boolValue(properties.whitelist, false),
        onlineMode: boolValue(properties['online-mode'], true),
      },
      performance: {
        viewDistance: numberValue(properties['view-distance'], 10),
        simulationDistance: numberValue(properties['simulation-distance'], 10),
        ramMb: server.memoryMb,
        javaVersion: server.javaVersion,
        restartPolicy: server.restartPolicy,
        jvmFlags: server.jvmFlags,
        autoRestartSchedule: server.autoRestartSchedule,
      },
      version: {
        minecraftVersion: server.version,
        loader: server.loader,
        loaderVersion: server.loaderVersion,
      },
      networking: {
        port: server.port,
        customDomain: server.customDomain,
      },
    };
  }

  async patch(serverId: string, input: ServerSettingsPatch) {
    const server = await this.servers.requireById(serverId);
    const originalPropertiesText = await this.files.readText(server, 'data/server.properties');
    const properties = parseServerProperties(originalPropertiesText);
    let propertiesChanged = false;
    const propertyMap: Array<[keyof ServerSettingsPatch, string]> = [
      ['motd', 'motd'],
      ['maxPlayers', 'max-players'],
      ['gamemode', 'gamemode'],
      ['difficulty', 'difficulty'],
      ['pvp', 'pvp'],
      ['whitelist', 'whitelist'],
      ['onlineMode', 'online-mode'],
      ['viewDistance', 'view-distance'],
      ['simulationDistance', 'simulation-distance'],
    ];
    for (const [inputKey, propertyKey] of propertyMap) {
      const value = input[inputKey];
      if (value !== undefined) {
        properties[propertyKey] = String(value);
        propertiesChanged = true;
      }
    }
    if (propertiesChanged) {
      await this.files.writeText(server, 'data/server.properties', serializeServerProperties(properties));
    }

    const runtime: UpdateMinecraftServerInput = {};
    if (input.serverName !== undefined) runtime.name = input.serverName;
    if (input.minecraftVersion !== undefined) runtime.version = input.minecraftVersion;
    if (input.loader !== undefined) runtime.loader = input.loader;
    if (input.loaderVersion !== undefined) runtime.loaderVersion = input.loaderVersion;
    if (input.ramMb !== undefined) runtime.memoryMb = input.ramMb;
    if (input.javaVersion !== undefined) runtime.javaVersion = input.javaVersion;
    if (input.restartPolicy !== undefined) runtime.restartPolicy = input.restartPolicy;
    if (input.port !== undefined) runtime.port = input.port;
    if (input.maxPlayers !== undefined) runtime.maxPlayers = input.maxPlayers;
    if (input.customDomain !== undefined) runtime.customDomain = input.customDomain;
    if (input.jvmFlags !== undefined) runtime.jvmFlags = input.jvmFlags;
    if (input.autoRestartSchedule !== undefined) runtime.autoRestartSchedule = input.autoRestartSchedule;

    try {
      if (Object.keys(runtime).length > 0) await this.serverService.update(serverId, runtime);
    } catch (error) {
      if (propertiesChanged) {
        await this.files.writeText(server, 'data/server.properties', originalPropertiesText).catch(() => undefined);
      }
      throw error;
    }

    const recreatedForRuntimeChange =
      (input.minecraftVersion !== undefined && input.minecraftVersion !== server.version) ||
      (input.loader !== undefined && input.loader !== server.loader) ||
      (input.loaderVersion !== undefined && input.loaderVersion !== server.loaderVersion) ||
      (input.ramMb !== undefined && input.ramMb !== server.memoryMb) ||
      (input.javaVersion !== undefined && input.javaVersion !== server.javaVersion) ||
      (input.restartPolicy !== undefined && input.restartPolicy !== server.restartPolicy) ||
      (input.port !== undefined && input.port !== server.port) ||
      input.jvmFlags !== undefined;

    return {
      ...(await this.get(serverId)),
      restartRequired: propertiesChanged && !recreatedForRuntimeChange,
    };
  }
}

function boolValue(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value.toLowerCase() === 'true';
}

function numberValue(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
