import { randomBytes } from 'node:crypto';
import type { AppEnv } from '../../../config/env.js';
import { ValidationError } from '../../../lib/errors.js';
import type { ContainerCreateSpec } from '../container-runtime.js';
import { serverRuntimePaths } from '../server-paths.js';
import type { VendorContainerDefinition } from '../runtime-types.js';
import type { MinecraftImageAdapter } from './minecraft-image-adapter.js';

export class ItzgMinecraftImageAdapter implements MinecraftImageAdapter {
  readonly id = 'itzg/minecraft-server';

  constructor(private readonly env: AppEnv) {}

  buildDefinition(spec: ContainerCreateSpec): VendorContainerDefinition {
    const paths = serverRuntimePaths(spec.rootPath);
    const heapMb = Math.max(384, Math.floor(spec.memoryMb * this.env.MC_HEAP_RATIO));
    const env: Record<string, string> = {
      EULA: 'TRUE',
      TYPE: loaderToImageType(spec.loader),
      VERSION: spec.version,
      MEMORY: `${heapMb}M`,
      MAX_PLAYERS: String(spec.maxPlayers),
      ENABLE_RCON: 'TRUE',
      RCON_PASSWORD: randomBytes(32).toString('base64url'),
      UID: String(this.env.MC_UID),
      GID: String(this.env.MC_GID),
      TZ: this.env.MC_TIMEZONE,
    };
    if (this.env.MC_MANAGE_OWNERSHIP) env.SKIP_CHOWN_DATA = 'TRUE';

    if (spec.jvmFlags) {
      const flags = spec.jvmFlags.split(/\s+/u).filter(Boolean);
      const xxFlags = flags.filter((flag) => flag.startsWith('-XX:'));
      const regularFlags = flags.filter((flag) => !flag.startsWith('-XX:'));
      if (regularFlags.length > 0) env.JVM_OPTS = regularFlags.join(' ');
      if (xxFlags.length > 0) env.JVM_XX_OPTS = xxFlags.join(' ');
    }

    if (spec.loaderVersion) {
      const key = loaderVersionEnvKey(spec.loader);
      if (key) env[key] = spec.loaderVersion;
    }

    return {
      image: imageForJava(this.env.MINECRAFT_IMAGE_REPOSITORY, spec.javaVersion),
      env,
      binds: [
        `${paths.data}:/data`,
        `${paths.mods}:/data/mods`,
        `${paths.config}:/data/config`,
        `${paths.logs}:/data/logs`,
      ],
      exposedPorts: { '25565/tcp': {} },
      portBindings: {
        '25565/tcp': [{ HostIp: this.env.MC_BIND_ADDRESS, HostPort: String(spec.port) }],
      },
      healthcheck: {
        test: ['CMD', 'mc-health'],
        intervalNanoseconds: 10_000_000_000,
        timeoutNanoseconds: 5_000_000_000,
        retries: 12,
        startPeriodNanoseconds: 60_000_000_000,
      },
    };
  }
}

export function imageForJava(repository: string, javaVersion: number): string {
  if (![17, 21, 25].includes(javaVersion)) {
    throw new ValidationError(`Unsupported Java version: ${javaVersion}`);
  }
  return `${repository}:java${javaVersion}`;
}

function loaderToImageType(loader: string): string {
  const normalized = loader.toUpperCase();
  if (['VANILLA', 'PAPER', 'FABRIC', 'FORGE', 'NEOFORGE'].includes(normalized)) return normalized;
  throw new ValidationError(`Unsupported loader: ${loader}`);
}

function loaderVersionEnvKey(loader: string): string | null {
  switch (loader.toUpperCase()) {
    case 'PAPER':
      return 'PAPER_BUILD';
    case 'FABRIC':
      return 'FABRIC_LOADER_VERSION';
    case 'FORGE':
      return 'FORGE_VERSION';
    case 'NEOFORGE':
      return 'NEOFORGE_VERSION';
    default:
      return null;
  }
}
