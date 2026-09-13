import { z } from 'zod';

export const worldNameParamsSchema = z.object({
  id: z.string().uuid(),
  worldName: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9 _.-]+$/u),
});

export const createWorldBodySchema = z.object({
  name: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9 _.-]+$/u),
  setActive: z.boolean().default(false),
});
