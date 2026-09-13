import { z } from 'zod';
import { SERVER_LOADERS } from '../types/domain.js';

export const serverIdParamsSchema = z.object({ id: z.string().uuid() });
export const backupIdParamsSchema = serverIdParamsSchema.extend({ backupId: z.string().min(1).max(64) });
export const modIdParamsSchema = serverIdParamsSchema.extend({ modId: z.string().min(1).max(64) });
export const playerParamsSchema = serverIdParamsSchema.extend({
  username: z.string().regex(/^[A-Za-z0-9_]{3,16}$/u),
});

export const loaderSchema = z.enum(SERVER_LOADERS);
export const minecraftVersionSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._+\-]+$/u, 'Invalid Minecraft version');
export const loaderVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._+\-]+$/u)
  .nullable();
export const serverNameSchema = z.string().trim().min(1).max(80);
export const portSchema = z.number().int().min(1024).max(65535);
export const memorySchema = z.number().int().min(512).max(65536);
export const maxPlayersSchema = z.number().int().min(1).max(1000);
export const customDomainSchema = z
  .string()
  .trim()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u,
    'Invalid hostname',
  )
  .nullable();
export const cronSchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/u, 'Expected a five-field cron expression')
  .nullable();
