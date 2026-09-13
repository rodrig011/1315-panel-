import { secureHeaders } from "./security";
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

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: secureHeaders(init),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const sid = (serverId: string) => encodeURIComponent(serverId);

export const backupsApi = {
  async list(serverId: string) {
    return request<{ backups: BackupDto[] }>(`/api/servers/${sid(serverId)}/backups`);
  },
  async create(serverId: string, input: { type: BackupType; notes?: string | null }) {
    return request<{ backup: BackupDto }>(`/api/servers/${sid(serverId)}/backups`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async remove(serverId: string, backupId: string) {
    return request<void>(`/api/servers/${sid(serverId)}/backups/${encodeURIComponent(backupId)}`, { method: "DELETE" });
  },
  async restore(serverId: string, backupId: string) {
    return request<{ ok: true }>(`/api/servers/${sid(serverId)}/backups/${encodeURIComponent(backupId)}/restore`, {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
  },
  async settings(serverId: string) {
    return request<{ settings: BackupSettings }>(`/api/servers/${sid(serverId)}/backups/settings`);
  },
  async updateSettings(serverId: string, settings: Partial<BackupSettings>) {
    return request<{ settings: BackupSettings }>(`/api/servers/${sid(serverId)}/backups/settings`, {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  },
  async restoreLogs(serverId: string) {
    return request<{ logs: RestoreLog[] }>(`/api/servers/${sid(serverId)}/backups/restore-logs?limit=20`);
  },
  progressUrl(serverId: string) {
    const url = new URL(API_BASE);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/ws/servers/${sid(serverId)}/backups`;
    return url.toString();
  },
};
