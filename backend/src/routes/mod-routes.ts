import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { modIdParamsSchema, serverIdParamsSchema } from '../schemas/common.js';
import {
  installModBodySchema,
  modInstallPlanQuerySchema,
  modrinthProjectParamsSchema,
  modSearchQuerySchema,
  patchModBodySchema,
} from '../schemas/mods.js';

export const modRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/api/servers/:id/mods',
    { preHandler: [app.authorize('mods.access')], schema: { params: serverIdParamsSchema } },
    async (request) => ({ mods: await app.services.mods.list(request.params.id) }),
  );

  app.get(
    '/api/servers/:id/mods/search',
    {
      preHandler: [app.authorize('mods.access')],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: serverIdParamsSchema, querystring: modSearchQuerySchema },
    },
    async (request) => app.services.mods.search(request.params.id, {
      query: request.query.q,
      minecraftVersion: request.query.minecraftVersion,
      loader: request.query.loader,
      category: request.query.category,
      offset: request.query.offset,
      limit: request.query.limit,
    }),
  );

  app.get(
    '/api/servers/:id/mods/updates',
    { preHandler: [app.authorize('mods.access')], schema: { params: serverIdParamsSchema } },
    async (request) => ({ mods: await app.services.mods.updates(request.params.id) }),
  );

  app.get(
    '/api/servers/:id/mods/modrinth/:projectId/plan',
    {
      preHandler: [app.authorize('mods.access')],
      schema: { params: modrinthProjectParamsSchema, querystring: modInstallPlanQuerySchema },
    },
    async (request) => app.services.mods.planInstall(
      request.params.id,
      request.params.projectId,
      request.query.versionId,
    ),
  );

  app.post(
    '/api/servers/:id/mods/install',
    {
      preHandler: [app.authorize('mods.access')],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: serverIdParamsSchema, body: installModBodySchema },
    },
    async (request, reply) => {
      const result = await app.services.mods.installFromModrinth(request.params.id, request.body);
      await app.services.audit.record({
        userId: request.user.sub,
        action: 'mod.install',
        serverId: request.params.id,
        metadata: { projectId: request.body.projectId, installed: result.installed.map((mod) => mod.id) },
        ip: request.ip,
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    '/api/servers/:id/mods/:modId/update',
    {
      preHandler: [app.authorize('mods.access')],
      config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
      schema: { params: modIdParamsSchema },
    },
    async (request) => ({ mod: await app.services.mods.update(request.params.id, request.params.modId) }),
  );

  app.delete(
    '/api/servers/:id/mods/:modId',
    {
      preHandler: [app.authorize('mods.access')],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: modIdParamsSchema },
    },
    async (request, reply) => {
      await app.services.mods.remove(request.params.id, request.params.modId);
      await app.services.audit.record({
        userId: request.user.sub,
        action: 'mod.remove',
        serverId: request.params.id,
        metadata: { modId: request.params.modId },
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );

  app.patch(
    '/api/servers/:id/mods/:modId',
    {
      preHandler: [app.authorize('mods.access')],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: modIdParamsSchema, body: patchModBodySchema },
    },
    async (request) => ({
      mod: await app.services.mods.setEnabled(request.params.id, request.params.modId, request.body.enabled),
    }),
  );

  app.post(
    '/api/servers/:id/mods/update-all',
    {
      preHandler: [app.authorize('mods.access')],
      config: { rateLimit: { max: 3, timeWindow: '5 minutes' } },
      schema: { params: serverIdParamsSchema },
    },
    async (request) => app.services.mods.updateAll(request.params.id),
  );
};
