import { z } from 'zod';

export const javaVersionSchema = z.union([z.literal(17), z.literal(21), z.literal(25)]);
export const restartPolicySchema = z.enum(['no', 'on-failure', 'unless-stopped', 'always']);
