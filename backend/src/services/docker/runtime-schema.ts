import { z } from 'zod';
import { RESTART_POLICIES } from './runtime-types.js';

export const containerCreateSpecSchema = z.object({
  serverId: z.string().min(1).max(128),
  containerName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u),
  rootPath: z.string().min(1),
  version: z.string().min(1).max(64),
  loader: z.enum(['Vanilla', 'Paper', 'Fabric', 'Forge', 'NeoForge']),
  loaderVersion: z.string().min(1).max(128).nullable(),
  memoryMb: z.number().int().min(512).max(131072),
  javaVersion: z.union([z.literal(17), z.literal(21), z.literal(25)]),
  restartPolicy: z.enum(RESTART_POLICIES),
  port: z.number().int().min(1024).max(65535),
  maxPlayers: z.number().int().min(1).max(1000),
  jvmFlags: z.string().max(1024).nullable(),
});

export const vendorContainerDefinitionSchema = z.object({
  image: z.string().min(1),
  env: z.record(z.string(), z.string()),
  binds: z.array(z.string().min(1)).min(1),
  exposedPorts: z.record(z.string(), z.record(z.string(), z.never())),
  portBindings: z.record(
    z.string(),
    z.array(z.object({ HostIp: z.string().min(1), HostPort: z.string().regex(/^\d+$/u) })).min(1),
  ),
  healthcheck: z.object({
    test: z.array(z.string().min(1)).min(2),
    intervalNanoseconds: z.number().int().positive(),
    timeoutNanoseconds: z.number().int().positive(),
    retries: z.number().int().positive(),
    startPeriodNanoseconds: z.number().int().nonnegative(),
  }),
});
