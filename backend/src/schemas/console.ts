import { z } from 'zod';

export const consoleCommandBodySchema = z.object({
  command: z.string().trim().min(1).max(512),
});

export const logsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(5000).default(500),
});
