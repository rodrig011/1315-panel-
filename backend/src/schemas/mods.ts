import { z } from 'zod';

export const modSearchQuerySchema = z.object({
  q: z.string().trim().max(120).default(''),
  minecraftVersion: z.string().trim().min(1).max(32).optional(),
  loader: z.enum(['Fabric', 'Forge', 'NeoForge', 'fabric', 'forge', 'neoforge']).optional(),
  category: z.string().trim().min(1).max(64).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(40).default(20),
});

export const modrinthProjectParamsSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/u),
});

export const modInstallPlanQuerySchema = z.object({
  versionId: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/u).optional(),
});

export const installModBodySchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/u),
  versionId: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/u).nullable().optional(),
  optionalDependencyProjectIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{2,64}$/u)).max(50).default([]),
});

export const patchModBodySchema = z.object({ enabled: z.boolean() });
