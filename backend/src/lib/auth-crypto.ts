import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const hmac256 = (key: string, value: string): string => createHmac('sha256', key).update(value).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  try { const aa=Buffer.from(a,'hex'), bb=Buffer.from(b,'hex'); return aa.length===bb.length && timingSafeEqual(aa,bb); } catch { return false; }
}

export function encryptSecret(secret: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64url');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret,'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv,tag,ciphertext].map((x)=>x.toString('base64url')).join('.');
}

export function decryptSecret(value: string, keyBase64: string): string {
  const [ivS,tagS,dataS]=value.split('.');
  if (!ivS || !tagS || !dataS) throw new Error('Invalid encrypted secret');
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(keyBase64,'base64url'),Buffer.from(ivS,'base64url'));
  decipher.setAuthTag(Buffer.from(tagS,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataS,'base64url')),decipher.final()]).toString('utf8');
}

const BASE32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string { let bits=0,v=0,out=''; for(const b of buf){v=(v<<8)|b;bits+=8;while(bits>=5){out+=BASE32[(v>>>(bits-5))&31];bits-=5;}} if(bits>0) out+=BASE32[(v<<(5-bits))&31]; return out; }
function base32Decode(s:string):Buffer { let bits=0,v=0; const out:number[]=[]; for(const c of s.replace(/=+$/,'').toUpperCase()){const i=BASE32.indexOf(c); if(i<0) continue; v=(v<<5)|i;bits+=5;if(bits>=8){out.push((v>>>(bits-8))&255);bits-=8;}} return Buffer.from(out); }
export function verifyTotp(secretBase32:string, code:string, now=Date.now(), window=1):boolean { if(!/^\d{6}$/.test(code)) return false; for(let w=-window;w<=window;w++){const counter=Math.floor(now/30000)+w; const b=Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h=createHmac('sha1',base32Decode(secretBase32)).update(b).digest(); const off=h[h.length-1]!&15; const n=((h[off]!&127)<<24)|(h[off+1]!<<16)|(h[off+2]!<<8)|h[off+3]!; if(String(n%1_000_000).padStart(6,'0')===code) return true;} return false; }
