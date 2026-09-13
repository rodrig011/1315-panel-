import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sanitizeConsoleCommand } from '../lib/console.js';
import { consoleCommandBodySchema, logsQuerySchema } from '../schemas/console.js';
import { serverIdParamsSchema } from '../schemas/common.js';

export const consoleRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/api/servers/:id/logs',
    {
      preHandler: [app.authorize('console.access')],
      schema: { params: serverIdParamsSchema, querystring: logsQuerySchema },
    },
    async (request) => ({ logs: await app.services.servers.logs(request.params.id, request.query.tail) }),
  );

  app.post(
    '/api/servers/:id/command',
    {
      preHandler: [app.authorize('console.access')],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: serverIdParamsSchema, body: consoleCommandBodySchema },
    },
    async (request) => {
      const command = sanitizeConsoleCommand(request.body.command);
      const output = await app.services.servers.command(request.params.id, command);
      await app.services.audit.record({
        userId: request.user.sub,
        action: 'console.command',
        serverId: request.params.id,
        metadata: { command },
        ip: request.ip,
      });
      return { output };
    },
  );

  app.get(
    '/ws/servers/:id/console',
    {
      websocket: true,
      preValidation: [app.authorize('console.access')],
      schema: { params: serverIdParamsSchema },
    },
    (socket, request) => {
      let stream: Awaited<ReturnType<typeof app.services.servers.streamLogs>> | undefined;
      let pending = '';
      let pingTimer: NodeJS.Timeout | undefined;

      void (async () => {
        try {
          stream = await app.services.servers.streamLogs(request.params.id);
          stream.on('data', (chunk: Buffer | string) => {
            pending += chunk.toString();
            const lines = pending.split(/\r?\n/u);
            pending = lines.pop() ?? '';
            for (const line of lines) {
              if (socket.readyState === socket.OPEN) {
                socket.send(JSON.stringify({ type: 'log', line }));
              }
            }
          });
          stream.on('error', () => socket.close(1011, 'Console stream error'));
          stream.on('end', () => socket.close(1000, 'Console stream ended'));
          pingTimer = setInterval(() => {
            if (socket.readyState === socket.OPEN) socket.ping();
          }, 30_000);
        } catch {
          socket.close(1011, 'Unable to open console stream');
        }
      })();

      socket.on('close', () => {
        if (pingTimer) clearInterval(pingTimer);
        stream?.destroy();
      });
    },
  );
};
