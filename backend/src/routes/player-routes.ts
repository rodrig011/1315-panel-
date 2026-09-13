import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { playerParamsSchema, serverIdParamsSchema } from '../schemas/common.js';
import { moderationBodySchema } from '../schemas/players.js';

export const playerRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/api/servers/:id/players',
    { preHandler: [app.authorize('players.moderate')], schema: { params: serverIdParamsSchema } },
    async (request) => ({ players: await app.services.players.list(request.params.id) }),
  );

  app.post(
    '/api/servers/:id/players/:username/kick',
    {
      preHandler: [app.authorize('players.moderate')],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: playerParamsSchema, body: moderationBodySchema.optional() },
    },
    async (request) => ({
      output: await app.services.players.kick(
        request.params.id,
        request.params.username,
        request.body?.reason,
      ),
    }),
  );

  app.post(
    '/api/servers/:id/players/:username/ban',
    {
      preHandler: [app.authorize('players.moderate')],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: playerParamsSchema, body: moderationBodySchema.optional() },
    },
    async (request) => ({
      output: await app.services.players.ban(
        request.params.id,
        request.params.username,
        request.body?.reason,
      ),
    }),
  );

  for (const action of ['op', 'deop', 'whitelist'] as const) {
    app.post(
      `/api/servers/:id/players/:username/${action}`,
      {
        preHandler: [app.authorize('players.moderate')],
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: { params: playerParamsSchema },
      },
      async (request) => ({
        output: await app.services.players[action](request.params.id, request.params.username),
      }),
    );
  }

  app.delete(
    '/api/servers/:id/players/:username/whitelist',
    {
      preHandler: [app.authorize('players.moderate')],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: playerParamsSchema },
    },
    async (request) => ({
      output: await app.services.players.removeWhitelist(
        request.params.id,
        request.params.username,
      ),
    }),
  );
};
