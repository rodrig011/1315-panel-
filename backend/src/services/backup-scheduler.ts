import type { ServerRepository } from '../repositories/server-repository.js';
import type { BackupService } from './backup-service.js';

export class BackupScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private readonly servers: ServerRepository, private readonly backups: BackupService, private readonly intervalMs = 30_000) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const servers = await this.servers.list();
      for (const server of servers) {
        if (!server.backupEnabled) continue;
        const last = server.backupLastRunAt?.getTime() ?? 0;
        if (now.getTime() - last < server.backupIntervalMinutes * 60_000) continue;
        await this.backups.create(server.id, { type: server.backupDefaultType === 'world' ? 'world' : 'full', source: 'scheduled', notes: 'Automatic scheduled backup' }).catch(() => undefined);
      }
    } finally { this.running = false; }
  }
}
