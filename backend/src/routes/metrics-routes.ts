import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { serverIdParamsSchema } from '../schemas/common.js';
import { metricsQuerySchema } from '../schemas/metrics.js';

export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/api/servers/:id/metrics',
    {
      preHandler: [app.authenticate],
      schema: { params: serverIdParamsSchema, querystring: metricsQuerySchema },
    },
    async (request) => ({
      current: await app.services.metrics.current(request.params.id),
      history: await app.services.metrics.history(
        request.params.id,
        request.query.minutes,
        request.query.limit,
      ),
    }),
  );

  app.get(
    '/ws/servers/:id/metrics',
    {
      websocket: true,
      preValidation: [app.authenticate],
      schema: { params: serverIdParamsSchema },
    },
    (socket, request) => {
      let unsubscribe: (() => void) | undefined;
      let pingTimer: NodeJS.Timeout | undefined;

      void app.services.servers
        .requireRecord(request.params.id)
        .then(async () => {
          const initial = await app.services.metrics.current(request.params.id);
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: 'metrics', data: initial }));
          }
          unsubscribe = app.services.metrics.subscribe(request.params.id, (metric) => {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ type: 'metrics', data: metric }));
            }
          });
          pingTimer = setInterval(() => {
            if (socket.readyState === socket.OPEN) socket.ping();
          }, 30_000);
        })
        .catch(() => socket.close(1011, 'Unable to start metrics stream'));

      socket.on('close', () => {
        unsubscribe?.();
        if (pingTimer) clearInterval(pingTimer);
      });
    },
  );
};
