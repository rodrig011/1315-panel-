-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "MinecraftServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "containerId" TEXT,
    "containerName" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "version" TEXT NOT NULL,
    "loader" TEXT NOT NULL,
    "loaderVersion" TEXT,
    "memoryMb" INTEGER NOT NULL DEFAULT 4096,
    "port" INTEGER NOT NULL,
    "maxPlayers" INTEGER NOT NULL DEFAULT 20,
    "customDomain" TEXT,
    "jvmFlags" TEXT,
    "autoRestartSchedule" TEXT,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "InstalledMod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "version" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "sourceProjectId" TEXT,
    "sourceVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstalledMod_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MinecraftServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Backup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'manual',
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "sizeBytes" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Backup_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MinecraftServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MetricSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "cpuPercent" REAL NOT NULL,
    "ramUsedBytes" REAL NOT NULL,
    "ramLimitBytes" REAL NOT NULL,
    "diskUsedBytes" REAL NOT NULL,
    "networkRx" REAL NOT NULL,
    "networkTx" REAL NOT NULL,
    "tps" REAL,
    "playersOnline" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricSample_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MinecraftServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "serverId" TEXT,
    "metadata" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "MinecraftServer_containerId_key" ON "MinecraftServer"("containerId");
CREATE UNIQUE INDEX "MinecraftServer_containerName_key" ON "MinecraftServer"("containerName");
CREATE UNIQUE INDEX "MinecraftServer_rootPath_key" ON "MinecraftServer"("rootPath");
CREATE UNIQUE INDEX "MinecraftServer_port_key" ON "MinecraftServer"("port");
CREATE INDEX "MinecraftServer_status_idx" ON "MinecraftServer"("status");
CREATE UNIQUE INDEX "InstalledMod_serverId_fileName_key" ON "InstalledMod"("serverId", "fileName");
CREATE INDEX "InstalledMod_serverId_idx" ON "InstalledMod"("serverId");
CREATE UNIQUE INDEX "Backup_filePath_key" ON "Backup"("filePath");
CREATE INDEX "Backup_serverId_createdAt_idx" ON "Backup"("serverId", "createdAt");
CREATE INDEX "MetricSample_serverId_createdAt_idx" ON "MetricSample"("serverId", "createdAt");
CREATE INDEX "AuditLog_serverId_createdAt_idx" ON "AuditLog"("serverId", "createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
