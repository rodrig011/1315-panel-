import { secureHeaders } from './security';
const API_BASE=(process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000').replace(/\/$/,'');
async function request<T>(path:string,init?:RequestInit):Promise<T>{const r=await fetch(`${API_BASE}${path}`,{...init,credentials:'include',headers:secureHeaders(init)});const body=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(body?.error?.message??`Request failed (${r.status})`);return body as T;}
export interface AuthUser{id:string;username:string;role:'owner'|'admin'|'moderator'|'viewer';permissions:string[];totpEnabled:boolean;}
export const authApi={
 login:(input:{username:string;password:string;totp?:string;recoveryCode?:string})=>request<{user:AuthUser;expiresAt:string}>('/api/auth/login',{method:'POST',body:JSON.stringify(input)}),
 me:()=>request<{user:AuthUser;sessionExpiresAt:string}>('/api/auth/me'),
 logout:()=>request<{ok:true}>('/api/auth/logout',{method:'POST'}),
 sessions:()=>request<{sessions:Array<{id:string;ip:string|null;userAgent:string|null;createdAt:string;lastSeenAt:string;expiresAt:string;current:boolean}>}>('/api/auth/sessions'),
 revokeSession:(id:string)=>request<{revoked:boolean}>(`/api/auth/sessions/${encodeURIComponent(id)}`,{method:'DELETE'}),
 revokeOthers:()=>request<{revoked:number}>('/api/auth/sessions/revoke-others',{method:'POST'}),
 changePassword:(currentPassword:string,newPassword:string)=>request<{ok:true}>('/api/auth/password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})}),
 beginTotp:()=>request<{secret:string;otpauthUri:string}>('/api/auth/2fa/setup',{method:'POST'}),
 confirmTotp:(code:string)=>request<{recoveryCodes:string[]}>('/api/auth/2fa/confirm',{method:'POST',body:JSON.stringify({code})}),
 disableTotp:(password:string,code:string)=>request<{ok:true}>('/api/auth/2fa/disable',{method:'POST',body:JSON.stringify({password,code})}),
};
