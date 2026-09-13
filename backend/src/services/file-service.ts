import { createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  chown,
  chmod,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AppEnv } from '../config/env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import type { ServerRecord } from '../types/domain.js';

const ALLOWED_ROOT_ENTRIES = new Set([
  'data',
  'backups',
  'mods',
  'plugins',
  'config',
  'world',
  'world_nether',
  'world_the_end',
  'logs',
  'kubejs',
  'defaultconfigs',
  'resourcepacks',
  'server.properties',
  'whitelist.json',
  'ops.json',
  'banned-players.json',
  'banned-ips.json',
  'usercache.json',
  'eula.txt',
]);

const EDITABLE_EXTENSIONS = new Set([
  '.properties',
  '.json',
  '.json5',
  '.yml',
  '.yaml',
  '.toml',
  '.cfg',
  '.conf',
  '.txt',
  '.js',
]);

const UPLOAD_EXTENSIONS = new Set([
  ...EDITABLE_EXTENSIONS,
  '.jar',
  '.zip',
  '.dat',
  '.nbt',
  '.png',
  '.mcmeta',
]);

export interface FileEntryDto {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes: number | null;
  modifiedAt: string;
}

export class FileService {
  constructor(private readonly env: AppEnv) {}

  async ensureServerRoot(server: ServerRecord): Promise<void> {
    this.assertConfiguredRoot(server.rootPath);
    await mkdir(server.rootPath, { recursive: true, mode: 0o750 });
  }

  async list(server: ServerRecord, relativePath = ''): Promise<FileEntryDto[]> {
    const target = await this.resolveSafe(server, relativePath, true);
    const info = await this.safeLstat(target);
    if (!info?.isDirectory()) throw new ValidationError('Requested path is not a directory');

    const entries = await readdir(target, { withFileTypes: true });
    const isRoot = resolve(target) === resolve(server.rootPath);
    const visible = isRoot ? entries.filter((entry) => ALLOWED_ROOT_ENTRIES.has(entry.name)) : entries;

    return Promise.all(
      visible
        .filter((entry) => !entry.isSymbolicLink())
        .map(async (entry) => {
          const absolute = join(target, entry.name);
          const entryStat = await stat(absolute);
          return {
            name: entry.name,
            path: normalizeRelative(relative(server.rootPath, absolute)),
            type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
            sizeBytes: entry.isFile() ? entryStat.size : null,
            modifiedAt: entryStat.mtime.toISOString(),
          };
        }),
    );
  }

  async readText(server: ServerRecord, relativePath: string): Promise<string> {
    const target = await this.resolveSafe(server, relativePath, false);
    this.assertEditableExtension(target);
    const info = await this.safeLstat(target);
    if (!info?.isFile()) throw new NotFoundError('File not found');
    if (info.size > this.env.MAX_TEXT_FILE_BYTES) {
      throw new ValidationError('File is too large to edit in the panel');
    }
    return readFile(target, 'utf8');
  }

  async writeText(server: ServerRecord, relativePath: string, content: string): Promise<void> {
    if (Buffer.byteLength(content, 'utf8') > this.env.MAX_TEXT_FILE_BYTES) {
      throw new ValidationError('Text file exceeds the configured size limit');
    }
    const target = await this.resolveSafe(server, relativePath, false, true);
    this.assertEditableExtension(target);
    await this.ensureSafeParent(server, dirname(target));
    await this.atomicWrite(target, Buffer.from(content, 'utf8'));
    await this.applyManagedOwnership(target, false);
  }

  async upload(
    server: ServerRecord,
    directory: string,
    originalFileName: string,
    stream: Readable,
    overwrite = false,
  ): Promise<FileEntryDto> {
    const name = this.validateUploadFileName(originalFileName);
    const parent = await this.resolveSafe(server, directory, true);
    const parentInfo = await this.safeLstat(parent);
    if (!parentInfo?.isDirectory()) throw new ValidationError('Upload destination is not a directory');

    const extension = extname(name).toLowerCase();
    if (!UPLOAD_EXTENSIONS.has(extension)) {
      throw new ValidationError(`Uploads with ${extension || 'no extension'} are not allowed`);
    }

    const target = await this.resolveSafe(server, normalizeRelative(join(directory, name)), false, true);
    const existing = await this.safeLstat(target);
    if (existing && !overwrite) throw new ConflictError('A file with this name already exists');
    if (existing?.isSymbolicLink()) throw new ForbiddenError('Refusing to overwrite a symbolic link');

    const temp = join(parent, `.upload-${randomUUID()}.tmp`);
    let byteCount = 0;
    let firstBytes = Buffer.alloc(0);
    const maxUploadBytes = this.env.MAX_UPLOAD_BYTES;
    const meter = async function* (source: Readable) {
      for await (const rawChunk of source) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
        byteCount += chunk.length;
        if (byteCount > maxUploadBytes) {
          throw new ValidationError('Upload exceeds the configured size limit');
        }
        if (firstBytes.length < 4) {
          firstBytes = Buffer.concat([firstBytes, chunk.subarray(0, 4 - firstBytes.length)]);
        }
        yield chunk;
      }
    };

    try {
      await pipeline(meter(stream), createWriteStream(temp, { flags: 'wx', mode: 0o640 }));
      if ((extension === '.jar' || extension === '.zip') && !hasZipMagic(firstBytes)) {
        throw new ValidationError('JAR/ZIP upload failed file signature validation');
      }
      await rename(temp, target);
      await this.applyManagedOwnership(target, false);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }

    const info = await stat(target);
    return {
      name,
      path: normalizeRelative(relative(server.rootPath, target)),
      type: 'file',
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    };
  }

  async renameWithinServer(server: ServerRecord, fromPath: string, toPath: string): Promise<void> {
    const source = await this.resolveSafe(server, fromPath, false);
    const target = await this.resolveSafe(server, toPath, false, true);
    const sourceInfo = await this.safeLstat(source);
    if (!sourceInfo || sourceInfo.isSymbolicLink()) throw new NotFoundError('Source file not found');
    if (await this.safeLstat(target)) throw new ConflictError('Destination already exists');
    await this.ensureSafeParent(server, dirname(target));
    await rename(source, target);
  }

  async delete(server: ServerRecord, relativePath: string): Promise<void> {
    const target = await this.resolveSafe(server, relativePath, false);
    if (resolve(target) === resolve(server.rootPath)) {
      throw new ForbiddenError('Cannot delete the server root through the file API');
    }
    const info = await this.safeLstat(target);
    if (!info) throw new NotFoundError('File or directory not found');
    if (info.isSymbolicLink()) throw new ForbiddenError('Symbolic links are not supported');
    await rm(target, { recursive: info.isDirectory(), force: false });
  }

  async createDirectory(server: ServerRecord, relativePath: string): Promise<void> {
    const target = await this.resolveSafe(server, relativePath, false, true);
    await this.ensureSafeParent(server, dirname(target));
    try {
      await mkdir(target, { recursive: false, mode: 0o770 });
      await this.applyManagedOwnership(target, true);
    } catch (error) {
      if (isAlreadyExists(error)) throw new ConflictError('Directory already exists');
      throw error;
    }
  }

  async removeServerRoot(server: ServerRecord): Promise<void> {
    this.assertConfiguredRoot(server.rootPath);
    const info = await this.safeLstat(server.rootPath);
    if (!info) return;
    if (info.isSymbolicLink()) throw new ForbiddenError('Server root cannot be a symbolic link');
    await rm(server.rootPath, { recursive: true, force: false });
  }

  async diskUsage(server: ServerRecord): Promise<number> {
    this.assertConfiguredRoot(server.rootPath);
    return directorySize(server.rootPath);
  }

  async resolveForInternalUse(server: ServerRecord, relativePath: string): Promise<string> {
    return this.resolveSafe(server, relativePath, false, true);
  }

  private async applyManagedOwnership(target: string, directory: boolean): Promise<void> {
    if (!this.env.MC_MANAGE_OWNERSHIP) return;
    await chown(target, this.env.MC_UID, this.env.MC_GID);
    await chmod(target, directory ? 0o770 : 0o660);
  }

  private assertConfiguredRoot(rootPath: string): void {
    const base = resolve(this.env.SERVER_DATA_ROOT);
    const root = resolve(rootPath);
    if (root === base || !root.startsWith(`${base}${sep}`)) {
      throw new ForbiddenError('Server data path is outside the configured server root');
    }
  }

  private async resolveSafe(
    server: ServerRecord,
    relativePath: string,
    allowRoot: boolean,
    allowMissingLeaf = false,
  ): Promise<string> {
    this.assertConfiguredRoot(server.rootPath);
    const normalized = this.validateRelativePath(relativePath);
    if (!allowRoot && normalized === '') throw new ValidationError('A file path is required');
    this.assertAllowedTopLevel(normalized);

    const root = resolve(server.rootPath);
    const target = resolve(root, normalized);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new ForbiddenError('Path traversal attempt rejected');
    }

    await this.assertNoSymlinkTraversal(root, target, allowMissingLeaf);
    return target;
  }

  private validateRelativePath(input: string): string {
    if (input.includes('\0') || input.includes('\\') || isAbsolute(input)) {
      throw new ValidationError('Invalid file path');
    }
    const normalized = input.replace(/^\/+|\/+$/gu, '').replace(/\/{2,}/gu, '/');
    const segments = normalized === '' ? [] : normalized.split('/');
    if (segments.some((segment) => segment === '..' || segment === '.' || segment.length === 0)) {
      throw new ForbiddenError('Path traversal attempt rejected');
    }
    return normalized;
  }

  private assertAllowedTopLevel(relativePath: string): void {
    if (!relativePath) return;
    const [topLevel] = relativePath.split('/');
    if (!topLevel || !ALLOWED_ROOT_ENTRIES.has(topLevel)) {
      throw new ForbiddenError('Path is outside the server directory allowlist');
    }
  }

  private async assertNoSymlinkTraversal(
    root: string,
    target: string,
    allowMissingLeaf: boolean,
  ): Promise<void> {
    const rel = relative(root, target);
    const segments = rel ? rel.split(sep) : [];
    let current = root;

    const rootInfo = await this.safeLstat(root);
    if (rootInfo?.isSymbolicLink()) throw new ForbiddenError('Server root cannot be a symbolic link');

    for (let index = 0; index < segments.length; index += 1) {
      current = join(current, segments[index]!);
      const info = await this.safeLstat(current);
      if (!info) {
        if (allowMissingLeaf) return;
        throw new NotFoundError('Path not found');
      }
      if (info.isSymbolicLink()) throw new ForbiddenError('Symbolic links are not supported');
    }

    if (!allowMissingLeaf) {
      const targetInfo = await this.safeLstat(target);
      if (!targetInfo) throw new NotFoundError('Path not found');
    }
  }

  private async ensureSafeParent(server: ServerRecord, parent: string): Promise<void> {
    const root = resolve(server.rootPath);
    if (parent !== root && !parent.startsWith(`${root}${sep}`)) {
      throw new ForbiddenError('Parent path is outside server root');
    }
    const info = await this.safeLstat(parent);
    if (!info?.isDirectory()) throw new NotFoundError('Parent directory does not exist');
    await this.assertNoSymlinkTraversal(root, parent, false);
  }

  private validateUploadFileName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 180) throw new ValidationError('Invalid upload filename');
    if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
      throw new ValidationError('Upload filename must not contain path separators');
    }
    if (/[^A-Za-z0-9._+()\- ]/u.test(trimmed)) {
      throw new ValidationError('Upload filename contains unsupported characters');
    }
    return trimmed;
  }

  private assertEditableExtension(filePath: string): void {
    const extension = extname(filePath).toLowerCase();
    if (!EDITABLE_EXTENSIONS.has(extension)) {
      throw new ForbiddenError('This file type cannot be edited as text');
    }
  }

  private async atomicWrite(target: string, content: Buffer): Promise<void> {
    const temp = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'wx', 0o640);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  }

  private async safeLstat(target: string) {
    try {
      return await lstat(target);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

async function directorySize(root: string): Promise<number> {
  let total = 0;
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) queue.push(absolute);
      else if (entry.isFile()) total += (await stat(absolute)).size;
    }
  }
  return total;
}

function normalizeRelative(value: string): string {
  return value.split(sep).join('/');
}

function hasZipMagic(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const signature = buffer.readUInt32LE(0);
  return signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
