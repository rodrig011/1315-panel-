import type { Backup, BackupRestoreLog, PrismaClient } from '@prisma/client';
import { NotFoundError } from '../lib/errors.js';

export interface CreateBackupInput {
  serverId: string;
  type: string;
  source: string;
  fileName: string;
  filePath: string;
  storageKey?: string | null;
  sizeBytes: number;
  minecraftVersion?: string | null;
  loader?: string | null;
  notes?: string | null;
  checksumSha256?: string | null;
}

export interface BackupRepository {
  list(serverId: string): Promise<Backup[]>;
  create(input: CreateBackupInput): Promise<Backup>;
  require(serverId: string, id: string): Promise<Backup>;
  delete(id: string): Promise<void>;
  createRestoreLog(input: { serverId: string; backupId: string; status: string; message?: string | null }): Promise<BackupRestoreLog>;
  updateRestoreLog(id: string, input: { status?: string; message?: string | null; completedAt?: Date | null }): Promise<BackupRestoreLog>;
  listRestoreLogs(serverId: string, limit: number): Promise<BackupRestoreLog[]>;
}

export class PrismaBackupRepository implements BackupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(serverId: string): Promise<Backup[]> {
    return this.prisma.backup.findMany({ where: { serverId }, orderBy: { createdAt: 'desc' } });
  }

  create(input: CreateBackupInput): Promise<Backup> {
    return this.prisma.backup.create({ data: input });
  }

  async require(serverId: string, id: string): Promise<Backup> {
    const backup = await this.prisma.backup.findFirst({ where: { id, serverId } });
    if (!backup) throw new NotFoundError('Backup not found');
    return backup;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.backup.delete({ where: { id } });
  }

  createRestoreLog(input: { serverId: string; backupId: string; status: string; message?: string | null }): Promise<BackupRestoreLog> {
    return this.prisma.backupRestoreLog.create({ data: input });
  }

  updateRestoreLog(id: string, input: { status?: string; message?: string | null; completedAt?: Date | null }): Promise<BackupRestoreLog> {
    return this.prisma.backupRestoreLog.update({ where: { id }, data: input });
  }

  listRestoreLogs(serverId: string, limit: number): Promise<BackupRestoreLog[]> {
    return this.prisma.backupRestoreLog.findMany({ where: { serverId }, orderBy: { startedAt: 'desc' }, take: limit });
  }
}
