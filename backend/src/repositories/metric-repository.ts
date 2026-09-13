import type { MetricSample, PrismaClient } from '@prisma/client';
import type { MetricSnapshot } from '../types/domain.js';

export interface MetricRepository {
  insert(serverId: string, metric: MetricSnapshot): Promise<MetricSample>;
  listSince(serverId: string, since: Date, limit: number): Promise<MetricSample[]>;
  deleteBefore(before: Date): Promise<number>;
}

export class PrismaMetricRepository implements MetricRepository {
  constructor(private readonly prisma: PrismaClient) {}

  insert(serverId: string, metric: MetricSnapshot): Promise<MetricSample> {
    return this.prisma.metricSample.create({
      data: {
        serverId,
        cpuPercent: metric.cpuPercent,
        ramUsedBytes: metric.memoryUsedBytes,
        ramLimitBytes: metric.memoryLimitBytes,
        diskUsedBytes: metric.diskUsedBytes,
        networkRx: metric.networkRxBytes,
        networkTx: metric.networkTxBytes,
        tps: metric.tps,
        playersOnline: metric.playersOnline,
        createdAt: new Date(metric.timestamp),
      },
    });
  }

  listSince(serverId: string, since: Date, limit: number): Promise<MetricSample[]> {
    return this.prisma.metricSample.findMany({
      where: { serverId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async deleteBefore(before: Date): Promise<number> {
    const result = await this.prisma.metricSample.deleteMany({ where: { createdAt: { lt: before } } });
    return result.count;
  }
}
