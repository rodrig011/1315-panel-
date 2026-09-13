import { apiRequest, wsUrl } from "./client";
export type BackupType = "world" | "full";
export type BackupSource = "manual" | "scheduled";

export interface BackupDto {
  id: string;
  createdAt: string;
  sizeBytes: number;
  type: BackupType;
  source: BackupSource;
  minecraftVersion: string | null;
  loader: string | null;
  notes: string | null;
  checksumSha256: string | null;
}

export interface BackupSettings {
  enabled: boolean;
  intervalMinutes: number;
  retentionCount: number;
  defaultType: BackupType;
  lastRunAt: string | null;
}

export interface BackupProgressEvent {
  serverId: string;
  operationId: string;
  operation: "create" | "restore" | "prune";
  backupId?: string;
  status: string;
  progress: number;
  message: string;
  timestamp: string;
}

export interface RestoreLog {
  id: string;
  backupId: string;
  status: string;
  message: string | null;
  startedAt: string;
  completedAt: string | null;
}

const sid = (serverId: string) => encodeURIComponent(serverId);

export const backupsApi = {
  async list(serverId: string) {
    return apiRequest<{ backups: BackupDto[] }>(`/api/servers/${sid(serverId)}/backups`);
  },
  async create(serverId: string, input: { type: BackupType; notes?: string | null }) {
    return apiRequest<{ backup: BackupDto }>(`/api/servers/${sid(serverId)}/backups`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async remove(serverId: string, backupId: string) {
    return apiRequest<void>(`/api/servers/${sid(serverId)}/backups/${encodeURIComponent(backupId)}`, { method: "DELETE" });
  },
  async restore(serverId: string, backupId: string) {
    return apiRequest<{ ok: true }>(`/api/servers/${sid(serverId)}/backups/${encodeURIComponent(backupId)}/restore`, {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
  },
  async settings(serverId: string) {
    return apiRequest<{ settings: BackupSettings }>(`/api/servers/${sid(serverId)}/backups/settings`);
  },
  async updateSettings(serverId: string, settings: Partial<BackupSettings>) {
    return apiRequest<{ settings: BackupSettings }>(`/api/servers/${sid(serverId)}/backups/settings`, {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  },
  async restoreLogs(serverId: string) {
    return apiRequest<{ logs: RestoreLog[] }>(`/api/servers/${sid(serverId)}/backups/restore-logs?limit=20`);
  },
  progressUrl(serverId: string) {
    return wsUrl(`/ws/servers/${sid(serverId)}/backups`);
  },
};
