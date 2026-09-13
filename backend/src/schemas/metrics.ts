import { z } from 'zod';

export const metricsQuerySchema = z.object({
  minutes: z.coerce.number().int().min(1).max(1440).default(60),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});
