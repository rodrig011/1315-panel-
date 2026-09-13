import { z } from 'zod';
import { javaVersionSchema, restartPolicySchema } from './runtime.js';
import {
  cronSchema,
  customDomainSchema,
  loaderSchema,
  loaderVersionSchema,
  maxPlayersSchema,
  memorySchema,
  minecraftVersionSchema,
  portSchema,
  serverNameSchema,
} from './common.js';

export const createServerBodySchema = z.object({
  name: serverNameSchema,
  version: minecraftVersionSchema,
  loader: loaderSchema,
  loaderVersion: loaderVersionSchema.optional(),
  memoryMb: memorySchema.default(4096),
  javaVersion: javaVersionSchema.default(21),
  restartPolicy: restartPolicySchema.default('unless-stopped'),
  port: portSchema.default(25565),
  maxPlayers: maxPlayersSchema.default(20),
  motd: z.string().max(256).optional(),
  gamemode: z.enum(['survival', 'creative', 'adventure', 'spectator']).default('survival'),
  difficulty: z.enum(['peaceful', 'easy', 'normal', 'hard']).default('normal'),
  pvp: z.boolean().default(true),
  whitelist: z.boolean().default(false),
});

export const updateServerBodySchema = z
  .object({
    name: serverNameSchema.optional(),
    version: minecraftVersionSchema.optional(),
    loader: loaderSchema.optional(),
    loaderVersion: loaderVersionSchema.optional(),
    memoryMb: memorySchema.optional(),
    javaVersion: javaVersionSchema.optional(),
    restartPolicy: restartPolicySchema.optional(),
    port: portSchema.optional(),
    maxPlayers: maxPlayersSchema.optional(),
    customDomain: customDomainSchema.optional(),
    jvmFlags: z.string().max(1024).nullable().optional(),
    autoRestartSchedule: cronSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
