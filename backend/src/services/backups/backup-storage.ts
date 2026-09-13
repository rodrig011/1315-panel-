export interface BackupArchiveInput {
  serverId: string;
  serverRoot: string;
  fileName: string;
  relativePaths: string[];
}

export interface StoredBackupArchive {
  key: string;
  filePath: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface BackupArchiveVerification {
  entries: string[];
  checksumSha256: string;
}

export interface BackupStorage {
  readonly kind: string;
  createArchive(input: BackupArchiveInput): Promise<StoredBackupArchive>;
  verifyArchive(serverRoot: string, key: string): Promise<BackupArchiveVerification>;
  extractArchive(serverRoot: string, key: string, destination: string): Promise<void>;
  deleteArchive(serverRoot: string, key: string): Promise<void>;
  resolvePath(serverRoot: string, key: string): string;
}
