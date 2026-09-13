import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { serverIdParamsSchema } from '../schemas/common.js';
import { settingsPatchBodySchema } from '../schemas/settings.js';

export const settingsRoutes:FastifyPluginAsync=async(fastify)=>{const app=fastify.withTypeProvider<ZodTypeProvider>();
 app.get('/api/servers/:id/settings',{preHandler:[app.authorize('server.manage')],schema:{params:serverIdParamsSchema}},async(request)=>({settings:await app.services.settings.get(request.params.id)}));
 app.patch('/api/servers/:id/settings',{preHandler:[app.authorize('server.manage')],config:{rateLimit:{max:20,timeWindow:'1 minute'}},schema:{params:serverIdParamsSchema,body:settingsPatchBodySchema}},async(request)=>{const settings=await app.services.settings.patch(request.params.id,request.body);await app.services.audit.record({userId:request.auth!.user.id,action:'settings.update',serverId:request.params.id,metadata:{fields:Object.keys(request.body)},ip:request.ip});return{settings};});
};
