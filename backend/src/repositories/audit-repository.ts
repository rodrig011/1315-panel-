import type { PrismaClient } from '@prisma/client';

export interface AuditRepository {
  record(input: {
    userId?: string;
    action: string;
    serverId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
  }): Promise<void>;
}

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: {
    userId?: string;
    action: string;
    serverId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: input.action,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.serverId ? { serverId: input.serverId } : {}),
        ...(input.ip ? { ip: input.ip } : {}),
      },
    });
  }
}
