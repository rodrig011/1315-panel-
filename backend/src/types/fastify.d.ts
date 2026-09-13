import type { AppEnv } from '../config/env.js';
import type { AppServices } from '../services/service-container.js';
import type { AuthenticatedUser } from '../services/auth-service.js';
import type { Permission } from '../auth/permissions.js';
import type { Session } from '@prisma/client';
declare module 'fastify' {
 interface FastifyInstance {env:AppEnv;services:AppServices;authenticate:(request:import('fastify').FastifyRequest)=>Promise<void>;authorize:(permission:Permission)=>(request:import('fastify').FastifyRequest)=>Promise<void>;}
 interface FastifyRequest {auth?:{user:AuthenticatedUser;session:Session};}
}
