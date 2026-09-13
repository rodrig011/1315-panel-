import { z } from 'zod';

export const createBackupBodySchema = z.object({
  type: z.enum(['world', 'full']).default('full'),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const restoreBackupBodySchema = z.object({
  confirm: z.literal(true),
});

export const backupSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(15).max(43_200).optional(),
  retentionCount: z.number().int().min(1).max(500).optional(),
  defaultType: z.enum(['world', 'full']).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one backup setting must be provided' });

export const restoreLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
