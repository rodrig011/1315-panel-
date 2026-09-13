import { EventEmitter } from 'node:events';
import type { AppEnv } from '../config/env.js';
import type { MetricRepository } from '../repositories/metric-repository.js';
import type { ServerRepository } from '../repositories/server-repository.js';
import type { MetricSnapshot } from '../types/domain.js';
import type { ContainerRuntime } from './docker/container-runtime.js';
import { FileService } from './file-service.js';

export class MetricsService {
  private readonly events = new EventEmitter();
  private readonly lastPersisted = new Map<string, number>();
  private collectionTimer: NodeJS.Timeout | undefined;
  private collecting = false;
  private lastPrunedAt = 0;

  constructor(
    private readonly env: AppEnv,
    private readonly servers: ServerRepository,
    private readonly runtime: ContainerRuntime,
    private readonly files: FileService,
    private readonly metrics: MetricRepository,
  ) {
    this.events.setMaxListeners(1000);
  }

  start(): void {
    if (this.collectionTimer) return;
    void this.collectAll();
    this.collectionTimer = setInterval(() => void this.collectAll(), this.env.METRICS_INTERVAL_MS);
    this.collectionTimer.unref?.();
  }

  async current(serverId: string): Promise<MetricSnapshot> {
    const server = await this.servers.requireById(serverId);
    const diskUsedBytes = await this.files.diskUsage(server);
    const status = await this.runtime.status(server).catch(() => 'missing' as const);
    if (status !== 'running') {
      return {
        cpuPercent: 0,
        memoryUsedBytes: 0,
        memoryLimitBytes: server.memoryMb * 1024 * 1024,
        networkRxBytes: 0,
        networkTxBytes: 0,
        diskUsedBytes,
        tps: null,
        playersOnline: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const container = await this.runtime.metrics(server);
    const [tps, playersOnline] = await Promise.all([
      this.readTps(server).catch(() => null),
      this.readOnlineCount(server).catch(() => null),
    ]);
    return {
      ...container,
      diskUsedBytes,
      tps,
      playersOnline,
      timestamp: new Date().toISOString(),
    };
  }

  async history(serverId: string, minutes = 60, limit = 1000) {
    await this.servers.requireById(serverId);
    const boundedMinutes = Math.min(Math.max(minutes, 1), this.env.METRICS_RETENTION_HOURS * 60);
    const boundedLimit = Math.min(Math.max(limit, 1), 5000);
    return this.metrics.listSince(
      serverId,
      new Date(Date.now() - boundedMinutes * 60_000),
      boundedLimit,
    );
  }

  subscribe(serverId: string, listener: (metric: MetricSnapshot) => void): () => void {
    const event = `metric:${serverId}`;
    this.events.on(event, listener);
    return () => this.events.off(event, listener);
  }

  async prune(): Promise<number> {
    const before = new Date(Date.now() - this.env.METRICS_RETENTION_HOURS * 60 * 60_000);
    return this.metrics.deleteBefore(before);
  }

  stopAll(): void {
    if (this.collectionTimer) clearInterval(this.collectionTimer);
    this.collectionTimer = undefined;
    this.events.removeAllListeners();
  }

  private async collectAll(): Promise<void> {
    if (this.collecting) return;
    this.collecting = true;
    try {
      const servers = await this.servers.list();
      await Promise.allSettled(
        servers.map(async (server) => {
          const metric = await this.current(server.id);
          this.events.emit(`metric:${server.id}`, metric);
          const now = Date.now();
          if (now - (this.lastPersisted.get(server.id) ?? 0) >= 30_000) {
            await this.metrics.insert(server.id, metric);
            this.lastPersisted.set(server.id, now);
          }
        }),
      );

      const now = Date.now();
      if (now - this.lastPrunedAt >= 60 * 60_000) {
        await this.prune();
        this.lastPrunedAt = now;
      }
    } finally {
      this.collecting = false;
    }
  }

  private async readTps(
    server: Awaited<ReturnType<ServerRepository['requireById']>>,
  ): Promise<number | null> {
    const output = await this.runtime.command(server, 'tps');
    const match = output.match(
      /TPS(?: from last 1m, 5m, 15m|):?\s*\*?([0-9]+(?:\.[0-9]+)?)/iu,
    );
    if (!match?.[1]) return null;
    return Math.min(20, Math.max(0, Number.parseFloat(match[1])));
  }

  private async readOnlineCount(
    server: Awaited<ReturnType<ServerRepository['requireById']>>,
  ): Promise<number | null> {
    const output = await this.runtime.command(server, 'list');
    const match = output.match(/There are\s+(\d+)\s+of a max of\s+\d+\s+players online/iu);
    return match?.[1] ? Number.parseInt(match[1], 10) : null;
  }
}
