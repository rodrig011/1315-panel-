import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, hmac256, randomToken, safeEqualHex, sha256 } from '../src/lib/auth-crypto.js';
import { hasPermission, listPermissions } from '../src/auth/permissions.js';

describe('auth security primitives',()=>{
 it('encrypts TOTP material with authenticated encryption',()=>{const key=randomBytes(32).toString('base64url');const encrypted=encryptSecret('JBSWY3DPEHPK3PXP',key);expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');expect(decryptSecret(encrypted,key)).toBe('JBSWY3DPEHPK3PXP');});
 it('hashes opaque tokens and recovery codes without storing plaintext',()=>{const token=randomToken();expect(sha256(token)).not.toBe(token);const digest=hmac256('x'.repeat(32),'recovery-code');expect(safeEqualHex(digest,hmac256('x'.repeat(32),'recovery-code'))).toBe(true);});
 it('enforces future-ready role permissions',()=>{expect(listPermissions('owner').length).toBe(6);expect(hasPermission('moderator','players.moderate')).toBe(true);expect(hasPermission('moderator','files.access')).toBe(false);expect(listPermissions('viewer')).toEqual([]);});
});
