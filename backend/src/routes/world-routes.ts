import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { serverIdParamsSchema } from '../schemas/common.js';
import { createWorldBodySchema, worldNameParamsSchema } from '../schemas/worlds.js';

export const worldRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/servers/:id/worlds', { preHandler: [app.authorize('server.manage')], schema: { params: serverIdParamsSchema } }, async (request) => ({ worlds: await app.services.worlds.list(request.params.id) }));

  app.post('/api/servers/:id/worlds', {
    preHandler: [app.authorize('server.manage')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: serverIdParamsSchema, body: createWorldBodySchema },
  }, async (request, reply) => {
    const worlds = await app.services.worlds.create(request.params.id, request.body.name, request.body.setActive);
    await app.services.audit.record({ userId: request.user.sub, action: 'world.create', serverId: request.params.id, metadata: { name: request.body.name }, ip: request.ip });
    return reply.code(201).send({ worlds });
  });

  app.post('/api/servers/:id/worlds/:worldName/activate', {
    preHandler: [app.authorize('server.manage')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: worldNameParamsSchema },
  }, async (request) => {
    const worlds = await app.services.worlds.setActive(request.params.id, request.params.worldName);
    await app.services.audit.record({ userId: request.user.sub, action: 'world.activate', serverId: request.params.id, metadata: { name: request.params.worldName }, ip: request.ip });
    return { worlds };
  });

  app.delete('/api/servers/:id/worlds/:worldName', {
    preHandler: [app.authorize('server.manage')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: worldNameParamsSchema },
  }, async (request) => {
    const worlds = await app.services.worlds.delete(request.params.id, request.params.worldName);
    await app.services.audit.record({ userId: request.user.sub, action: 'world.delete', serverId: request.params.id, metadata: { name: request.params.worldName }, ip: request.ip });
    return { worlds };
  });
};
