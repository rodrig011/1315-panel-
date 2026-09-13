import { z } from 'zod';

const relativePath = z.string().max(2048);

export const fileListQuerySchema = z.object({ path: relativePath.default('') });
export const filePathQuerySchema = z.object({ path: relativePath.min(1) });
export const fileUploadQuerySchema = z.object({
  path: relativePath.default(''),
  overwrite: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export const fileContentBodySchema = z.object({ content: z.string() });
export const createFolderBodySchema = z.object({ path: relativePath.min(1) });
export const renameFileBodySchema = z.object({
  from: relativePath.min(1),
  to: relativePath.min(1),
});
