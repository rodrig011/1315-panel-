ALTER TABLE "MinecraftServer" ADD COLUMN "backupEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MinecraftServer" ADD COLUMN "backupIntervalMinutes" INTEGER NOT NULL DEFAULT 360;
ALTER TABLE "MinecraftServer" ADD COLUMN "backupRetentionCount" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "MinecraftServer" ADD COLUMN "backupDefaultType" TEXT NOT NULL DEFAULT 'full';
ALTER TABLE "MinecraftServer" ADD COLUMN "backupLastRunAt" DATETIME;

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Backup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serverId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'full',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "fileName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "storageKey" TEXT,
  "sizeBytes" REAL NOT NULL,
  "minecraftVersion" TEXT,
  "loader" TEXT,
  "notes" TEXT,
  "checksumSha256" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Backup_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MinecraftServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Backup" ("id", "serverId", "type", "source", "fileName", "filePath", "storageKey", "sizeBytes", "createdAt")
SELECT "id", "serverId", 'full', CASE WHEN "type" = 'scheduled' THEN 'scheduled' ELSE 'manual' END, "fileName", "filePath", "fileName", "sizeBytes", "createdAt" FROM "Backup";
DROP TABLE "Backup";
ALTER TABLE "new_Backup" RENAME TO "Backup";
CREATE UNIQUE INDEX "Backup_filePath_key" ON "Backup"("filePath");
CREATE INDEX "Backup_serverId_createdAt_idx" ON "Backup"("serverId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE TABLE "BackupRestoreLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serverId" TEXT NOT NULL,
  "backupId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "message" TEXT,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME,
  CONSTRAINT "BackupRestoreLog_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "Backup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BackupRestoreLog_serverId_startedAt_idx" ON "BackupRestoreLog"("serverId", "startedAt");
CREATE INDEX "BackupRestoreLog_backupId_idx" ON "BackupRestoreLog"("backupId");
