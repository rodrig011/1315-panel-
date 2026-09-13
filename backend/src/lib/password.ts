import { hash, verify, Algorithm } from '@node-rs/argon2';

export async function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 });
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try { return await verify(encoded, password); } catch { return false; }
}
