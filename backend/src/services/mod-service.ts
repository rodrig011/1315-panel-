import { Readable } from 'node:stream';
import type { InstalledMod, MinecraftServer } from '@prisma/client';
import type { ModRepository } from '../repositories/mod-repository.js';
import type { ServerRepository } from '../repositories/server-repository.js';
import { ConflictError, ValidationError } from '../lib/errors.js';
import { FileService } from './file-service.js';
import type {
  ModrinthDependency,
  ModrinthSearchInput,
  ModrinthSearchResult,
  ModrinthVersion,
} from './modrinth-service.js';
import { ModrinthService } from './modrinth-service.js';

export interface ModDto {
  id: string;
  name: string;
  version: string | null;
  fileName: string;
  enabled: boolean;
  source: string | null;
  sourceProjectId: string | null;
  sourceVersionId: string | null;
  updateAvailable?: boolean;
  latestVersion?: string | null;
}

export interface DependencyPlanItem {
  projectId: string | null;
  versionId: string | null;
  name: string;
  type: 'required' | 'optional' | 'incompatible';
  compatible: boolean;
  reason: string | null;
  selectedVersion: string | null;
  alreadyInstalled: boolean;
}

export interface InstallPlan {
  projectId: string;
  versionId: string;
  version: string;
  dependencies: DependencyPlanItem[];
  canInstall: boolean;
  warnings: string[];
}

export class ModService {
  constructor(
    private readonly mods: ModRepository,
    private readonly servers: ServerRepository,
    private readonly files: FileService,
    private readonly modrinth: ModrinthService,
  ) {}

  async list(serverId: string): Promise<ModDto[]> {
    const server = await this.servers.requireById(serverId);
    const installed = await this.mods.list(serverId);
    return Promise.all(installed.map(async (mod) => {
      const dto = toDto(mod);
      if (!mod.sourceProjectId || mod.source !== 'modrinth') return dto;
      try {
        const latest = await this.modrinth.latestVersion(mod.sourceProjectId, server.version, server.loader);
        return {
          ...dto,
          updateAvailable: Boolean(latest && latest.id !== mod.sourceVersionId),
          latestVersion: latest?.version ?? null,
        };
      } catch {
        return dto;
      }
    }));
  }

  async search(serverId: string, input: Omit<ModrinthSearchInput, 'minecraftVersion' | 'loader'> & { minecraftVersion?: string; loader?: string }): Promise<ModrinthSearchResult> {
    const server = await this.servers.requireById(serverId);
    this.assertModCapable(server.loader);
    return this.modrinth.search({
      ...input,
      minecraftVersion: input.minecraftVersion ?? server.version,
      loader: input.loader ?? server.loader,
    });
  }

  async planInstall(serverId: string, projectId: string, versionId?: string | null): Promise<InstallPlan> {
    const server = await this.servers.requireById(serverId);
    this.assertModCapable(server.loader);
    const version = await this.modrinth.resolveVersion({ projectId, versionId, minecraftVersion: server.version, loader: server.loader });
    const installed = await this.mods.list(serverId);
    const planItems = await Promise.all(
      version.dependencies
        .filter((dependency) => dependency.type !== 'embedded')
        .map((dependency) => this.resolveDependencyPlan(server, dependency, installed)),
    );
    const warnings = planItems
      .filter((item) => !item.compatible || item.type === 'incompatible')
      .map((item) => item.reason ?? `${item.name} is incompatible`);
    return {
      projectId,
      versionId: version.id,
      version: version.version,
      dependencies: planItems,
      canInstall: !planItems.some((item) => item.type === 'required' && !item.compatible),
      warnings,
    };
  }

  async installFromModrinth(serverId: string, input: { projectId: string; versionId?: string | null; optionalDependencyProjectIds?: string[] }): Promise<{ installed: ModDto[]; plan: InstallPlan }> {
    const server = await this.servers.requireById(serverId);
    this.assertModCapable(server.loader);
    const plan = await this.planInstall(serverId, input.projectId, input.versionId);
    if (!plan.canInstall) throw new ConflictError('Required mod dependencies are incompatible with this server');

    const selectedOptional = new Set(input.optionalDependencyProjectIds ?? []);
    const installedRecords: ModDto[] = [];
    const visited = new Set<string>();
    const root = await this.modrinth.resolveVersion({
      projectId: input.projectId,
      versionId: plan.versionId,
      minecraftVersion: server.version,
      loader: server.loader,
    });
    await this.installVersionRecursive(server, root, selectedOptional, visited, installedRecords, true);
    return { installed: installedRecords, plan };
  }

  async remove(serverId: string, modId: string): Promise<void> {
    const server = await this.servers.requireById(serverId);
    const mod = await this.mods.require(serverId, modId);
    await this.files.delete(server, `mods/${mod.fileName}`).catch(() => undefined);
    await this.mods.delete(mod.id);
  }

  async setEnabled(serverId: string, modId: string, enabled: boolean): Promise<ModDto> {
    const server = await this.servers.requireById(serverId);
    const mod = await this.mods.require(serverId, modId);
    if (mod.enabled === enabled) return toDto(mod);
    const targetName = enabled ? mod.fileName.replace(/\.disabled$/u, '') : `${mod.fileName}.disabled`;
    if (enabled && targetName === mod.fileName) throw new ConflictError('Disabled mod filename is inconsistent');
    await this.files.renameWithinServer(server, `mods/${mod.fileName}`, `mods/${targetName}`);
    return toDto(await this.mods.update(mod.id, { enabled, fileName: targetName }));
  }

  async update(serverId: string, modId: string): Promise<ModDto> {
    const server = await this.servers.requireById(serverId);
    const mod = await this.mods.require(serverId, modId);
    if (!mod.sourceProjectId || mod.source !== 'modrinth') throw new ConflictError('Only Modrinth-managed mods can be updated automatically');
    const latest = await this.modrinth.latestVersion(mod.sourceProjectId, server.version, server.loader);
    if (!latest || latest.id === mod.sourceVersionId) return toDto(mod);
    return this.replaceInstalled(server, mod, latest);
  }

  async updateAll(serverId: string): Promise<{ updated: ModDto[]; skipped: string[] }> {
    const server = await this.servers.requireById(serverId);
    this.assertModCapable(server.loader);
    const installed = await this.mods.list(serverId);
    const updated: ModDto[] = [];
    const skipped: string[] = [];
    for (const mod of installed) {
      if (!mod.sourceProjectId || mod.source !== 'modrinth') { skipped.push(mod.name); continue; }
      const latest = await this.modrinth.latestVersion(mod.sourceProjectId, server.version, server.loader);
      if (!latest || latest.id === mod.sourceVersionId) { skipped.push(mod.name); continue; }
      const plan = await this.planInstall(serverId, mod.sourceProjectId, latest.id);
      if (!plan.canInstall) { skipped.push(`${mod.name} (dependency conflict)`); continue; }
      updated.push(await this.replaceInstalled(server, mod, latest));
    }
    return { updated, skipped };
  }

  async updates(serverId: string): Promise<ModDto[]> {
    return (await this.list(serverId)).filter((mod) => mod.updateAvailable);
  }

  private async installVersionRecursive(
    server: MinecraftServer,
    version: ModrinthVersion,
    selectedOptional: Set<string>,
    visited: Set<string>,
    output: ModDto[],
    installRoot: boolean,
  ): Promise<void> {
    if (visited.has(version.projectId)) return;
    visited.add(version.projectId);
    const currentlyInstalled = await this.mods.list(server.id);
    if (currentlyInstalled.some((mod) => mod.sourceProjectId === version.projectId)) return;

    for (const dependency of version.dependencies) {
      if (!dependency.projectId || dependency.type === 'embedded' || dependency.type === 'incompatible') continue;
      if (dependency.type === 'optional' && !selectedOptional.has(dependency.projectId)) continue;
      let dependencyVersion: ModrinthVersion;
      try {
        dependencyVersion = await this.modrinth.resolveVersion({
          projectId: dependency.projectId,
          versionId: dependency.versionId,
          minecraftVersion: server.version,
          loader: server.loader,
        });
      } catch (error) {
        if (dependency.type === 'required') throw new ConflictError(`Required dependency ${dependency.projectId} is incompatible`);
        continue;
      }
      await this.installVersionRecursive(server, dependencyVersion, selectedOptional, visited, output, false);
    }

    const project = await this.modrinth.getProject(version.projectId);
    const bytes = await this.modrinth.downloadVerified(version.artifact);
    const uploaded = await this.files.upload(server, 'mods', version.artifact.filename, Readable.from(bytes), false);
    try {
      const record = await this.mods.create({
        serverId: server.id,
        name: project.name,
        fileName: uploaded.name,
        version: version.version,
        enabled: true,
        source: 'modrinth',
        sourceProjectId: version.projectId,
        sourceVersionId: version.id,
      });
      output.push(toDto(record));
    } catch (error) {
      await this.files.delete(server, `mods/${uploaded.name}`).catch(() => undefined);
      if (installRoot) throw error;
      throw error;
    }
  }

  private async replaceInstalled(server: MinecraftServer, mod: InstalledMod, latest: ModrinthVersion): Promise<ModDto> {
    const bytes = await this.modrinth.downloadVerified(latest.artifact);
    const replacesSameFile = latest.artifact.filename === mod.fileName;
    const uploaded = await this.files.upload(server, 'mods', latest.artifact.filename, Readable.from(bytes), replacesSameFile);
    const previousPath = `mods/${mod.fileName}`;
    try {
      const record = await this.mods.update(mod.id, {
        version: latest.version,
        fileName: uploaded.name,
        sourceVersionId: latest.id,
        enabled: true,
      });
      if (!replacesSameFile) await this.files.delete(server, previousPath).catch(() => undefined);
      return toDto(record);
    } catch (error) {
      if (!replacesSameFile) await this.files.delete(server, `mods/${uploaded.name}`).catch(() => undefined);
      throw error;
    }
  }

  private async resolveDependencyPlan(server: MinecraftServer, dependency: ModrinthDependency, installed: InstalledMod[]): Promise<DependencyPlanItem> {
    if (!dependency.projectId) {
      return {
        projectId: null,
        versionId: dependency.versionId,
        name: dependency.fileName ?? 'External dependency',
        type: dependency.type === 'embedded' ? 'optional' : dependency.type,
        compatible: dependency.type !== 'required',
        reason: dependency.type === 'required' ? 'Dependency does not identify a Modrinth project and cannot be installed automatically' : null,
        selectedVersion: null,
        alreadyInstalled: false,
      };
    }
    const project = await this.modrinth.getProject(dependency.projectId).catch(() => null);
    const alreadyInstalled = installed.some((mod) => mod.sourceProjectId === dependency.projectId);
    if (dependency.type === 'incompatible') {
      return {
        projectId: dependency.projectId,
        versionId: dependency.versionId,
        name: project?.name ?? dependency.projectId,
        type: 'incompatible',
        compatible: !alreadyInstalled,
        reason: alreadyInstalled ? `${project?.name ?? dependency.projectId} conflicts with this mod and is currently installed` : `${project?.name ?? dependency.projectId} is marked incompatible by the selected version`,
        selectedVersion: null,
        alreadyInstalled,
      };
    }
    const dependencyType: 'required' | 'optional' = dependency.type === 'required' ? 'required' : 'optional';
    try {
      const version = await this.modrinth.resolveVersion({
        projectId: dependency.projectId,
        versionId: dependency.versionId,
        minecraftVersion: server.version,
        loader: server.loader,
      });
      return {
        projectId: dependency.projectId,
        versionId: version.id,
        name: project?.name ?? dependency.projectId,
        type: dependencyType,
        compatible: true,
        reason: null,
        selectedVersion: version.version,
        alreadyInstalled,
      };
    } catch {
      return {
        projectId: dependency.projectId,
        versionId: dependency.versionId,
        name: project?.name ?? dependency.projectId,
        type: dependencyType,
        compatible: false,
        reason: `${project?.name ?? dependency.projectId} has no compatible ${server.loader} build for Minecraft ${server.version}`,
        selectedVersion: null,
        alreadyInstalled,
      };
    }
  }

  private assertModCapable(loader: string): void {
    if (!['Fabric', 'Forge', 'NeoForge'].includes(loader)) throw new ConflictError('This server loader does not support mods');
  }
}

function toDto(mod: InstalledMod): ModDto {
  return {
    id: mod.id,
    name: mod.name,
    version: mod.version,
    fileName: mod.fileName,
    enabled: mod.enabled,
    source: mod.source,
    sourceProjectId: mod.sourceProjectId,
    sourceVersionId: mod.sourceVersionId,
  };
}
