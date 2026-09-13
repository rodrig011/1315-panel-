import type { InstalledMod, PrismaClient } from '@prisma/client';
import { NotFoundError } from '../lib/errors.js';

export interface ModRepository {
  list(serverId: string): Promise<InstalledMod[]>;
  require(serverId: string, id: string): Promise<InstalledMod>;
  create(input: {
    serverId: string;
    name: string;
    fileName: string;
    version?: string | null;
    enabled?: boolean;
    source?: string | null;
    sourceProjectId?: string | null;
    sourceVersionId?: string | null;
  }): Promise<InstalledMod>;
  update(
    id: string,
    input: Partial<
      Pick<InstalledMod, 'name' | 'fileName' | 'version' | 'enabled' | 'sourceVersionId'>
    >,
  ): Promise<InstalledMod>;
  delete(id: string): Promise<void>;
}

export class PrismaModRepository implements ModRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(serverId: string): Promise<InstalledMod[]> {
    return this.prisma.installedMod.findMany({
      where: { serverId },
      orderBy: { name: 'asc' },
    });
  }

  async require(serverId: string, id: string): Promise<InstalledMod> {
    const mod = await this.prisma.installedMod.findFirst({ where: { id, serverId } });
    if (!mod) throw new NotFoundError('Mod not found');
    return mod;
  }

  create(input: {
    serverId: string;
    name: string;
    fileName: string;
    version?: string | null;
    enabled?: boolean;
    source?: string | null;
    sourceProjectId?: string | null;
    sourceVersionId?: string | null;
  }): Promise<InstalledMod> {
    return this.prisma.installedMod.create({ data: input });
  }

  update(
    id: string,
    input: Partial<
      Pick<InstalledMod, 'name' | 'fileName' | 'version' | 'enabled' | 'sourceVersionId'>
    >,
  ): Promise<InstalledMod> {
    return this.prisma.installedMod.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.installedMod.delete({ where: { id } });
  }
}
