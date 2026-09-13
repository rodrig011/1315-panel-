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

export const settingsPatchBodySchema = z
  .object({
    serverName: serverNameSchema.optional(),
    motd: z.string().max(256).optional(),
    maxPlayers: maxPlayersSchema.optional(),
    gamemode: z.enum(['survival', 'creative', 'adventure', 'spectator']).optional(),
    difficulty: z.enum(['peaceful', 'easy', 'normal', 'hard']).optional(),
    pvp: z.boolean().optional(),
    whitelist: z.boolean().optional(),
    onlineMode: z.boolean().optional(),
    viewDistance: z.number().int().min(2).max(32).optional(),
    simulationDistance: z.number().int().min(2).max(32).optional(),
    ramMb: memorySchema.optional(),
    javaVersion: javaVersionSchema.optional(),
    restartPolicy: restartPolicySchema.optional(),
    jvmFlags: z.string().max(1024).nullable().optional(),
    autoRestartSchedule: cronSchema.optional(),
    minecraftVersion: minecraftVersionSchema.optional(),
    loader: loaderSchema.optional(),
    loaderVersion: loaderVersionSchema.optional(),
    port: portSchema.optional(),
    customDomain: customDomainSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one setting is required');
