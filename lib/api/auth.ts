import { apiRequest } from './client';
export interface AuthUser{id:string;username:string;role:'owner'|'admin'|'moderator'|'viewer';permissions:string[];totpEnabled:boolean;}
export const authApi={
 login:(input:{username:string;password:string;totp?:string;recoveryCode?:string})=>apiRequest<{user:AuthUser;expiresAt:string}>('/api/auth/login',{method:'POST',body:JSON.stringify(input)}),
 me:()=>apiRequest<{user:AuthUser;sessionExpiresAt:string}>('/api/auth/me'),
 logout:()=>apiRequest<{ok:true}>('/api/auth/logout',{method:'POST'}),
 sessions:()=>apiRequest<{sessions:Array<{id:string;ip:string|null;userAgent:string|null;createdAt:string;lastSeenAt:string;expiresAt:string;current:boolean}>}>('/api/auth/sessions'),
 revokeSession:(id:string)=>apiRequest<{revoked:boolean}>(`/api/auth/sessions/${encodeURIComponent(id)}`,{method:'DELETE'}),
 revokeOthers:()=>apiRequest<{revoked:number}>('/api/auth/sessions/revoke-others',{method:'POST'}),
 changePassword:(currentPassword:string,newPassword:string)=>apiRequest<{ok:true}>('/api/auth/password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})}),
 beginTotp:()=>apiRequest<{secret:string;otpauthUri:string}>('/api/auth/2fa/setup',{method:'POST'}),
 confirmTotp:(code:string)=>apiRequest<{recoveryCodes:string[]}>('/api/auth/2fa/confirm',{method:'POST',body:JSON.stringify({code})}),
 disableTotp:(password:string,code:string)=>apiRequest<{ok:true}>('/api/auth/2fa/disable',{method:'POST',body:JSON.stringify({password,code})}),
};
