import type { PrismaClient } from '@prisma/client';
import { KeyedLock } from '../lib/async-lock.js';
import type { AppEnv } from '../config/env.js';
import { PrismaAuditRepository, type AuditRepository } from '../repositories/audit-repository.js';
import { PrismaBackupRepository } from '../repositories/backup-repository.js';
import { PrismaMetricRepository } from '../repositories/metric-repository.js';
import { PrismaModRepository } from '../repositories/mod-repository.js';
import { PrismaServerRepository } from '../repositories/server-repository.js';
import { PrismaUserRepository } from '../repositories/user-repository.js';
import { PrismaSessionRepository } from '../repositories/session-repository.js';
import { AuthService } from './auth-service.js';
import { BackupService } from './backup-service.js';
import { BackupScheduler } from './backup-scheduler.js';
import { BackupProgressHub } from './backup-progress.js';
import { LocalBackupStorage } from './backups/local-backup-storage.js';
import type { ContainerRuntime } from './docker/container-runtime.js';
import { FileService } from './file-service.js';
import { MetricsService } from './metrics-service.js';
import { MinecraftServerService } from './minecraft-server-service.js';
import { ModrinthService } from './modrinth-service.js';
import { ModService } from './mod-service.js';
import { PlayerService } from './player-service.js';
import { SettingsService } from './settings-service.js';

export interface AppServices {
  auth: AuthService;
  servers: MinecraftServerService;
  files: FileService;
  backups: BackupService;
  backupScheduler: BackupScheduler;
  metrics: MetricsService;
  mods: ModService;
  players: PlayerService;
  settings: SettingsService;
  audit: AuditRepository;
}

export function createServices(
  env: AppEnv,
  prisma: PrismaClient,
  runtime: ContainerRuntime,
): AppServices {
  const serverRepository = new PrismaServerRepository(prisma);
  const userRepository = new PrismaUserRepository(prisma);
  const sessionRepository = new PrismaSessionRepository(prisma);
  const backupRepository = new PrismaBackupRepository(prisma);
  const metricRepository = new PrismaMetricRepository(prisma);
  const modRepository = new PrismaModRepository(prisma);
  const audit = new PrismaAuditRepository(prisma);
  const files = new FileService(env);
  const serverLock = new KeyedLock();
  const servers = new MinecraftServerService(serverRepository, runtime, files, env, serverLock);
  const auth = new AuthService(userRepository, sessionRepository, env);
  const backupProgress = new BackupProgressHub();
  const backupStorage = new LocalBackupStorage();
  const backups = new BackupService(env, backupRepository, serverRepository, runtime, backupStorage, backupProgress, serverLock);
  const backupScheduler = new BackupScheduler(serverRepository, backups);
  const metrics = new MetricsService(env, serverRepository, runtime, files, metricRepository);
  const modrinth = new ModrinthService(env);
  const mods = new ModService(modRepository, serverRepository, files, modrinth);
  const players = new PlayerService(serverRepository, runtime, files);
  const settings = new SettingsService(serverRepository, servers, files);

  return { auth, servers, files, backups, backupScheduler, metrics, mods, players, settings, audit };
}
