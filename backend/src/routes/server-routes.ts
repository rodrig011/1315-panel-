import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { serverIdParamsSchema } from '../schemas/common.js';
import { createServerBodySchema, updateServerBodySchema } from '../schemas/servers.js';

export const serverRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/servers', { preHandler: [app.authenticate] }, async () => ({
    servers: await app.services.servers.list(),
  }));

  app.post(
    '/api/servers',
    {
      preHandler: [app.authorize('server.manage')],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: createServerBodySchema },
    },
    async (request, reply) => {
      const server = await app.services.servers.create(request.body);
      await app.services.audit.record({
        userId: request.user.sub,
        action: 'server.create',
        serverId: server.id,
        metadata: { name: server.name },
        ip: request.ip,
      });
      return reply.code(201).send({ server });
    },
  );

  app.get(
    '/api/servers/:id',
    { preHandler: [app.authenticate], schema: { params: serverIdParamsSchema } },
    async (request) => ({ server: await app.services.servers.get(request.params.id) }),
  );

  app.patch(
    '/api/servers/:id',
    {
      preHandler: [app.authorize('server.manage')],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: serverIdParamsSchema, body: updateServerBodySchema },
    },
    async (request) => {
      const server = await app.services.servers.update(request.params.id, request.body);
      await app.services.audit.record({
        userId: request.user.sub,
        action: 'server.update',
        serverId: server.id,
        metadata: { fields: Object.keys(request.body) },
        ip: request.ip,
      });
      return { server };
    },
  );

  app.delete(
    '/api/servers/:id',
    {
      preHandler: [app.authorize('server.manage')],
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
      schema: { params: serverIdParamsSchema },
    },
    async (request, reply) => {
      const server = await app.services.servers.get(request.params.id);
      await app.services.servers.delete(request.params.id);
      await app.services.audit.record({
        userId: request.user.sub,
        action: 'server.delete',
        serverId: server.id,
        metadata: { name: server.name },
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );

  for (const action of ['start', 'stop', 'restart', 'kill'] as const) {
    app.post(
      `/api/servers/:id/${action}`,
      {
        preHandler: [app.authorize('server.manage')],
        config: { rateLimit: { max: action === 'kill' ? 5 : 20, timeWindow: '1 minute' } },
        schema: { params: serverIdParamsSchema },
      },
      async (request) => {
        const server = await app.services.servers[action](request.params.id);
        await app.services.audit.record({
          userId: request.user.sub,
          action: `server.${action}`,
          serverId: server.id,
          ip: request.ip,
        });
        return { server };
      },
    );
  }
};
