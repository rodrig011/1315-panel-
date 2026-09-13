import { mkdir, chown, chmod, lstat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { AppEnv } from '../../config/env.js';
import { ForbiddenError } from '../../lib/errors.js';
import type { ServerRuntimePaths } from './runtime-types.js';

export function serverRuntimePaths(rootPath: string): ServerRuntimePaths {
  return {
    root: rootPath,
    data: resolve(rootPath, 'data'),
    mods: resolve(rootPath, 'mods'),
    config: resolve(rootPath, 'config'),
    logs: resolve(rootPath, 'logs'),
    backups: resolve(rootPath, 'backups'),
  };
}

export async function prepareServerRuntimeDirectories(
  env: AppEnv,
  rootPath: string,
): Promise<ServerRuntimePaths> {
  assertRuntimeRoot(env, rootPath);
  const paths = serverRuntimePaths(rootPath);
  await mkdir(paths.root, { recursive: true, mode: 0o750 });
  await Promise.all([
    mkdir(paths.data, { recursive: true, mode: 0o770 }),
    mkdir(paths.mods, { recursive: true, mode: 0o770 }),
    mkdir(paths.config, { recursive: true, mode: 0o770 }),
    mkdir(paths.logs, { recursive: true, mode: 0o770 }),
    mkdir(paths.backups, { recursive: true, mode: 0o750 }),
  ]);

  for (const path of [paths.root, paths.data, paths.mods, paths.config, paths.logs, paths.backups]) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new ForbiddenError('Runtime directories cannot be symbolic links');
  }

  if (env.MC_MANAGE_OWNERSHIP) {
    for (const path of [paths.data, paths.mods, paths.config, paths.logs]) {
      await chown(path, env.MC_UID, env.MC_GID);
      await chmod(path, 0o770);
    }
    await chown(paths.backups, env.MC_UID, env.MC_GID);
    await chmod(paths.backups, 0o750);
  }

  return paths;
}

export function assertRuntimeRoot(env: AppEnv, rootPath: string): void {
  const base = resolve(env.SERVER_DATA_ROOT);
  const root = resolve(rootPath);
  if (root === base || !root.startsWith(`${base}${sep}`)) {
    throw new ForbiddenError('Server runtime path is outside SERVER_DATA_ROOT');
  }
}
