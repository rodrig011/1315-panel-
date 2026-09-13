import { EventEmitter } from 'node:events';

export type BackupOperation = 'create' | 'restore' | 'prune';
export type BackupProgressStatus = 'queued' | 'running' | 'verifying' | 'stopping-server' | 'extracting' | 'swapping' | 'restarting-server' | 'completed' | 'failed';

export interface BackupProgressEvent {
  serverId: string;
  operationId: string;
  operation: BackupOperation;
  backupId?: string;
  status: BackupProgressStatus;
  progress: number;
  message: string;
  timestamp: string;
}

export class BackupProgressHub {
  private readonly emitter = new EventEmitter();

  publish(event: Omit<BackupProgressEvent, 'timestamp'>): void {
    this.emitter.emit(event.serverId, { ...event, timestamp: new Date().toISOString() } satisfies BackupProgressEvent);
  }

  subscribe(serverId: string, listener: (event: BackupProgressEvent) => void): () => void {
    this.emitter.on(serverId, listener);
    return () => this.emitter.off(serverId, listener);
  }
}
