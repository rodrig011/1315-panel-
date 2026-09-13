import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { backupIdParamsSchema, serverIdParamsSchema } from '../schemas/common.js';
import { backupSettingsSchema, createBackupBodySchema, restoreBackupBodySchema, restoreLogsQuerySchema } from '../schemas/backups.js';

export const backupRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/servers/:id/backups', { preHandler: [app.authorize('backups.access')], schema: { params: serverIdParamsSchema } }, async (request) => ({ backups: await app.services.backups.list(request.params.id) }));

  app.get('/api/servers/:id/backups/settings', { preHandler: [app.authorize('backups.access')], schema: { params: serverIdParamsSchema } }, async (request) => ({ settings: await app.services.backups.settings(request.params.id) }));

  app.patch('/api/servers/:id/backups/settings', { preHandler: [app.authorize('backups.access')], config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { params: serverIdParamsSchema, body: backupSettingsSchema } }, async (request) => ({ settings: await app.services.backups.updateSettings(request.params.id, request.body) }));

  app.get('/api/servers/:id/backups/restore-logs', { preHandler: [app.authorize('backups.access')], schema: { params: serverIdParamsSchema, querystring: restoreLogsQuerySchema } }, async (request) => ({ logs: await app.services.backups.restoreLogs(request.params.id, request.query.limit) }));

  app.post('/api/servers/:id/backups', {
    preHandler: [app.authorize('backups.access')],
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    schema: { params: serverIdParamsSchema, body: createBackupBodySchema.optional() },
  }, async (request, reply) => {
    const backup = await app.services.backups.create(request.params.id, { type: request.body?.type ?? 'full', source: 'manual', notes: request.body?.notes });
    await app.services.audit.record({ userId: request.user.sub, action: 'backup.create', serverId: request.params.id, metadata: { backupId: backup.id, type: backup.type, source: backup.source }, ip: request.ip });
    return reply.code(201).send({ backup });
  });

  app.post('/api/servers/:id/backups/:backupId/restore', {
    preHandler: [app.authorize('backups.access')],
    config: { rateLimit: { max: 2, timeWindow: '10 minutes' } },
    schema: { params: backupIdParamsSchema, body: restoreBackupBodySchema },
  }, async (request) => {
    await app.services.backups.restore(request.params.id, request.params.backupId, request.body.confirm);
    await app.services.audit.record({ userId: request.user.sub, action: 'backup.restore', serverId: request.params.id, metadata: { backupId: request.params.backupId }, ip: request.ip });
    return { ok: true };
  });

  app.delete('/api/servers/:id/backups/:backupId', {
    preHandler: [app.authorize('backups.access')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: backupIdParamsSchema },
  }, async (request, reply) => {
    await app.services.backups.delete(request.params.id, request.params.backupId);
    return reply.code(204).send();
  });

  app.get('/ws/servers/:id/backups', {
    websocket: true,
    preValidation: [app.authorize('backups.access')],
    schema: { params: serverIdParamsSchema },
  }, (socket, request) => {
    let unsubscribe: (() => void) | undefined;
    let pingTimer: NodeJS.Timeout | undefined;
    void app.services.servers.requireRecord(request.params.id).then(() => {
      unsubscribe = app.services.backups.progress.subscribe(request.params.id, (event) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'backup-progress', data: event }));
      });
      pingTimer = setInterval(() => { if (socket.readyState === socket.OPEN) socket.ping(); }, 30_000);
    }).catch(() => socket.close(1011, 'Unable to start backup progress stream'));
    socket.on('close', () => { unsubscribe?.(); if (pingTimer) clearInterval(pingTimer); });
  });
};
