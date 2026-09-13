import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { serverIdParamsSchema } from '../schemas/common.js';
import {
  createFolderBodySchema,
  fileContentBodySchema,
  fileListQuerySchema,
  filePathQuerySchema,
  fileUploadQuerySchema,
  renameFileBodySchema,
} from '../schemas/files.js';

export const fileRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/api/servers/:id/files',
    {
      preHandler: [app.authorize('files.access')],
      schema: { params: serverIdParamsSchema, querystring: fileListQuerySchema },
    },
    async (request) => {
      const server = await app.services.servers.requireRecord(request.params.id);
      return { files: await app.services.files.list(server, request.query.path) };
    },
  );

  app.get(
    '/api/servers/:id/files/content',
    {
      preHandler: [app.authorize('files.access')],
      schema: { params: serverIdParamsSchema, querystring: filePathQuerySchema },
    },
    async (request) => {
      const server = await app.services.servers.requireRecord(request.params.id);
      return {
        path: request.query.path,
        content: await app.services.files.readText(server, request.query.path),
      };
    },
  );

  app.put(
    '/api/servers/:id/files/content',
    {
      preHandler: [app.authorize('files.access')],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: serverIdParamsSchema,
        querystring: filePathQuerySchema,
        body: fileContentBodySchema,
      },
    },
    async (request) => {
      const server = await app.services.servers.requireRecord(request.params.id);
      await app.services.files.writeText(server, request.query.path, request.body.content);
      await app.services.audit.record({
        userId: request.user.sub,
        action: 'file.write',
        serverId: request.params.id,
        metadata: { path: request.query.path },
        ip: request.ip,
      });
      return { ok: true };
    },
  );

  app.post(
    '/api/servers/:id/files/upload',
    {
      preHandler: [app.authorize('files.access')],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: serverIdParamsSchema, querystring: fileUploadQuerySchema },
    },
    async (request, reply) => {
      const server = await app.services.servers.requireRecord(request.params.id);
      const upload = await request.file();
      if (!upload) return reply.code(400).send({ error: { code: 'FILE_REQUIRED', message: 'File is required' } });
      const file = await app.services.files.upload(
        server,
        request.query.path,
        upload.filename,
        upload.file,
        request.query.overwrite,
      );
      await app.services.audit.record({
        userId: request.user.sub,
        action: 'file.upload',
        serverId: request.params.id,
        metadata: { path: file.path, sizeBytes: file.sizeBytes },
        ip: request.ip,
      });
      return reply.code(201).send({ file });
    },
  );

  app.delete(
    '/api/servers/:id/files',
    {
      preHandler: [app.authorize('files.access')],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: serverIdParamsSchema, querystring: filePathQuerySchema },
    },
    async (request, reply) => {
      const server = await app.services.servers.requireRecord(request.params.id);
      await app.services.files.delete(server, request.query.path);
      await app.services.audit.record({
        userId: request.user.sub,
        action: 'file.delete',
        serverId: request.params.id,
        metadata: { path: request.query.path },
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/servers/:id/files/folder',
    {
      preHandler: [app.authorize('files.access')],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: serverIdParamsSchema, body: createFolderBodySchema },
    },
    async (request, reply) => {
      const server = await app.services.servers.requireRecord(request.params.id);
      await app.services.files.createDirectory(server, request.body.path);
      return reply.code(201).send({ ok: true });
    },
  );

  app.patch(
    '/api/servers/:id/files',
    {
      preHandler: [app.authorize('files.access')],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: serverIdParamsSchema, body: renameFileBodySchema },
    },
    async (request) => {
      const server = await app.services.servers.requireRecord(request.params.id);
      await app.services.files.renameWithinServer(server, request.body.from, request.body.to);
      return { ok: true };
    },
  );
};
