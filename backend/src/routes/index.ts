import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth-routes.js';
import { backupRoutes } from './backup-routes.js';
import { consoleRoutes } from './console-routes.js';
import { fileRoutes } from './file-routes.js';
import { metricsRoutes } from './metrics-routes.js';
import { modRoutes } from './mod-routes.js';
import { playerRoutes } from './player-routes.js';
import { serverRoutes } from './server-routes.js';
import { settingsRoutes } from './settings-routes.js';

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(authRoutes);
  await fastify.register(serverRoutes);
  await fastify.register(consoleRoutes);
  await fastify.register(metricsRoutes);
  await fastify.register(fileRoutes);
  await fastify.register(modRoutes);
  await fastify.register(playerRoutes);
  await fastify.register(backupRoutes);
  await fastify.register(settingsRoutes);
}
