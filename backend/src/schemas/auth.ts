import { z } from 'zod';
export const loginBodySchema=z.object({username:z.string().trim().min(1).max(64),password:z.string().min(1).max(1024),totp:z.string().regex(/^\d{6}$/).optional(),recoveryCode:z.string().min(8).max(128).optional()});
export const changePasswordSchema=z.object({currentPassword:z.string().min(1).max(1024),newPassword:z.string().min(14).max(1024)}).refine(v=>v.currentPassword!==v.newPassword,{path:['newPassword'],message:'New password must be different'});
export const totpCodeSchema=z.object({code:z.string().regex(/^\d{6}$/)});
export const disableTotpSchema=z.object({password:z.string().min(1).max(1024),code:z.string().regex(/^\d{6}$/)});
export const sessionIdParamsSchema=z.object({sessionId:z.string().min(1).max(128)});
