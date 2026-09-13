import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import * as tar from 'tar';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import { serverRuntimePaths } from '../docker/server-paths.js';
import type { BackupArchiveInput, BackupArchiveVerification, BackupStorage, StoredBackupArchive } from './backup-storage.js';

export class LocalBackupStorage implements BackupStorage {
  readonly kind = 'local';

  async createArchive(input: BackupArchiveInput): Promise<StoredBackupArchive> {
    const backupDir = serverRuntimePaths(input.serverRoot).backups;
    await mkdir(backupDir, { recursive: true, mode: 0o750 });
    const filePath = this.resolvePath(input.serverRoot, input.fileName);
    try {
      await tar.create({ cwd: input.serverRoot, file: filePath, gzip: true, portable: true, noMtime: true, strict: true }, input.relativePaths);
      const info = await stat(filePath);
      return { key: input.fileName, filePath, sizeBytes: info.size, checksumSha256: await sha256File(filePath) };
    } catch (error) {
      await rm(filePath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async verifyArchive(serverRoot: string, key: string): Promise<BackupArchiveVerification> {
    const filePath = this.resolvePath(serverRoot, key);
    const entries: string[] = [];
    await tar.list({
      file: filePath,
      strict: true,
      onReadEntry: (entry) => {
        if (entries.length >= 100_000) throw new ValidationError('Backup contains too many entries');
        const normalized = normalize(entry.path).replaceAll('\\', '/').replace(/^\.\//u, '');
        if (!normalized || isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
          throw new ForbiddenError('Backup contains an unsafe path');
        }
        if (entry.type === 'SymbolicLink' || entry.type === 'Link') throw new ForbiddenError('Backup archives containing links cannot be restored');
        entries.push(normalized);
      },
    });
    if (entries.length === 0) throw new ValidationError('Backup archive is empty');
    return { entries, checksumSha256: await sha256File(filePath) };
  }

  async extractArchive(serverRoot: string, key: string, destination: string): Promise<void> {
    await tar.extract({ cwd: destination, file: this.resolvePath(serverRoot, key), strict: true, preservePaths: false });
  }

  async deleteArchive(serverRoot: string, key: string): Promise<void> {
    await rm(this.resolvePath(serverRoot, key), { force: true });
  }

  resolvePath(serverRoot: string, key: string): string {
    if (!key || key.includes('/') || key.includes('\\') || key === '.' || key === '..') throw new ForbiddenError('Invalid backup storage key');
    const base = resolve(serverRuntimePaths(serverRoot).backups);
    const target = resolve(join(base, key));
    if (!target.startsWith(`${base}${sep}`)) throw new ForbiddenError('Backup path escaped the server backup directory');
    return target;
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
