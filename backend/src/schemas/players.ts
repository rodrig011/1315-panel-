import { z } from 'zod';

export const moderationBodySchema = z.object({
  reason: z.string().trim().min(1).max(160).optional(),
});
