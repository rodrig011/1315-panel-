export const SERVER_LOADERS = ['Vanilla', 'Paper', 'Fabric', 'Forge', 'NeoForge'] as const;
export type ServerLoader = (typeof SERVER_LOADERS)[number];

export const SERVER_STATUSES = ['creating', 'online', 'offline', 'starting', 'stopping', 'error'] as const;
export type ServerStatus = (typeof SERVER_STATUSES)[number];

export interface ServerRecord {
  id: string;
  name: string;
  containerId: string | null;
  containerName: string;
  rootPath: string;
  status: string;
  version: string;
  loader: string;
  loaderVersion: string | null;
  memoryMb: number;
  javaVersion: number;
  restartPolicy: string;
  port: number;
  maxPlayers: number;
  customDomain: string | null;
  jvmFlags: string | null;
  autoRestartSchedule: string | null;
  backupEnabled: boolean;
  backupIntervalMinutes: number;
  backupRetentionCount: number;
  backupDefaultType: string;
  backupLastRunAt: Date | null;
  settingsJson: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContainerMetrics {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryLimitBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

export interface MetricSnapshot extends ContainerMetrics {
  diskUsedBytes: number;
  tps: number | null;
  playersOnline: number | null;
  timestamp: string;
}

export interface PlayerInfo {
  username: string;
  uuid: string | null;
  online: boolean;
  op: boolean;
  whitelisted: boolean;
  ping: number | null;
  playtimeSeconds: number | null;
}

export interface ConsoleLine {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
}
