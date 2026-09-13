import type { PrismaClient } from '@prisma/client';
import type { ServerRecord } from '../types/domain.js';
import { NotFoundError } from '../lib/errors.js';

export interface CreateServerRecord {
  id?: string;
  name: string;
  containerName: string;
  rootPath: string;
  version: string;
  loader: string;
  loaderVersion?: string | null;
  memoryMb: number;
  javaVersion: number;
  restartPolicy: string;
  port: number;
  maxPlayers: number;
  status?: string;
}

export interface UpdateServerRecord {
  name?: string;
  containerId?: string | null;
  status?: string;
  version?: string;
  loader?: string;
  loaderVersion?: string | null;
  memoryMb?: number;
  javaVersion?: number;
  restartPolicy?: string;
  port?: number;
  maxPlayers?: number;
  customDomain?: string | null;
  jvmFlags?: string | null;
  autoRestartSchedule?: string | null;
  backupEnabled?: boolean;
  backupIntervalMinutes?: number;
  backupRetentionCount?: number;
  backupDefaultType?: string;
  backupLastRunAt?: Date | null;
  settingsJson?: string;
}

export interface ServerRepository {
  list(): Promise<ServerRecord[]>;
  findById(id: string): Promise<ServerRecord | null>;
  requireById(id: string): Promise<ServerRecord>;
  findByPort(port: number): Promise<ServerRecord | null>;
  create(input: CreateServerRecord): Promise<ServerRecord>;
  update(id: string, input: UpdateServerRecord): Promise<ServerRecord>;
  delete(id: string): Promise<void>;
}

export class PrismaServerRepository implements ServerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(): Promise<ServerRecord[]> {
    return this.prisma.minecraftServer.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string): Promise<ServerRecord | null> {
    return this.prisma.minecraftServer.findUnique({ where: { id } });
  }

  async requireById(id: string): Promise<ServerRecord> {
    const server = await this.findById(id);
    if (!server) throw new NotFoundError('Minecraft server not found');
    return server;
  }

  findByPort(port: number): Promise<ServerRecord | null> {
    return this.prisma.minecraftServer.findUnique({ where: { port } });
  }

  create(input: CreateServerRecord): Promise<ServerRecord> {
    return this.prisma.minecraftServer.create({ data: input });
  }

  update(id: string, input: UpdateServerRecord): Promise<ServerRecord> {
    return this.prisma.minecraftServer.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.minecraftServer.delete({ where: { id } });
  }
}
