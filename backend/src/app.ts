import { PrismaClient } from '@prisma/client';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { loadEnv, type AppEnv } from './config/env.js';
import { AppError, ForbiddenError } from './lib/errors.js';
import { hasPermission, type Permission } from './auth/permissions.js';
import { registerRoutes } from './routes/index.js';
import type { ContainerRuntime } from './services/docker/container-runtime.js';
import { DockerContainerRuntime } from './services/docker/docker-runtime.js';
import { createServices, type AppServices } from './services/service-container.js';

export interface BuildAppOptions {
  env?: AppEnv;
  prisma?: PrismaClient;
  runtime?: ContainerRuntime;
  services?: AppServices;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();
  const ownsPrisma = !options.services && !options.prisma;
  const prisma = options.services ? options.prisma : (options.prisma ?? new PrismaClient());
  const runtime = options.runtime ?? new DockerContainerRuntime(env);
  const services =
    options.services ?? createServices(env, prisma as PrismaClient, runtime);
  const logger = options.logger === false ? false : loggerOptions(env);
  const app = Fastify({ logger, trustProxy: env.TRUST_PROXY, bodyLimit: env.MAX_UPLOAD_BYTES + 1024 * 1024 });

  app.decorate('env', env);
  app.decorate('services', services);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(cors, {
    origin: env.APP_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: env.MAX_UPLOAD_BYTES,
      fields: 10,
      parts: 12,
    },
    throwFileSizeLimit: true,
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.decorate('authenticate', async function authenticate(request: FastifyRequest): Promise<void> {
    const rawToken = request.cookies[env.COOKIE_NAME];
    const result = await app.services.auth.authenticate(rawToken);
    const csrfToken = request.headers['x-csrf-token'];
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      app.services.auth.verifyCsrf(result.session, typeof csrfToken === 'string' ? csrfToken : undefined);
    }
    request.auth = result;
  });
  app.decorate('authorize', function authorize(permission: Permission) {
    return async function permissionGuard(request: FastifyRequest): Promise<void> {
      await app.authenticate(request);
      if (!request.auth || !hasPermission(request.auth.user.role, permission)) throw new ForbiddenError('Insufficient permission');
    };
  });

  app.addHook('onRequest', async (request) => {
    if (env.NODE_ENV !== 'production') return;
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    const requiresOrigin =
      (isMutation && request.url.startsWith('/api/')) || request.url.startsWith('/ws/');
    if (!requiresOrigin) return;
    const origin = request.headers.origin;
    if (origin !== env.APP_ORIGIN) throw new ForbiddenError('Invalid request origin');
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  await registerRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ err: error, code: error.code }, error.message);
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues },
      });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: error.validation,
        },
      });
    }
    if (isPrismaUniqueViolation(error)) {
      return reply.code(409).send({
        error: { code: 'CONFLICT', message: 'A unique resource with those values already exists' },
      });
    }
    if (isClientHttpError(error)) {
      const statusCode = error.statusCode;
      const message = statusCode === 413 ? 'Request payload too large' : 'Invalid request';
      request.log.warn({ err: error, statusCode }, message);
      return reply.code(statusCode).send({
        error: { code: statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'REQUEST_ERROR', message },
      });
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  app.addHook('onClose', async () => {
    app.services.backupScheduler.stop();
    app.services.metrics.stopAll();
    if (ownsPrisma && prisma) await prisma.$disconnect();
  });

  await app.services.auth.ensureBootstrapAdmin();
  app.services.metrics.start();
  app.services.backupScheduler.start();
  return app;
}

function loggerOptions(env: AppEnv) {
  const base = {
    level: env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[REDACTED]',
    },
  };
  if (env.NODE_ENV === 'production') return base;
  return {
    ...base,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', singleLine: true },
    },
  };
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

function isClientHttpError(error: unknown): error is { statusCode: number } {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}
