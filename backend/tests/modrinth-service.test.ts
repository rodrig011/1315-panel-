import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { ModrinthService } from '../src/services/modrinth-service.js';

const env = loadEnv({
  NODE_ENV: 'test',
  AUTH_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
  AUTH_RECOVERY_PEPPER: '0123456789abcdef0123456789abcdef',
  ADMIN_PASSWORD: 'correct-horse-battery-staple',
  MODRINTH_CACHE_TTL_MS: '60000',
  MODRINTH_RETRY_COUNT: '2',
  MODRINTH_RETRY_BASE_MS: '1',
  MAX_UPLOAD_BYTES: String(1024 * 1024),
});

afterEach(() => vi.unstubAllGlobals());

describe('ModrinthService', () => {
  it('filters search by loader/version and caches identical API calls', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/search?')) {
        return Response.json({ hits: [{ project_id:'proj123', slug:'demo', title:'Demo Mod', description:'Demo', author:'author', categories:['neoforge','technology'], versions:['1.21.1'], downloads:1234, icon_url:'https://cdn.modrinth.com/data/proj123/icon.png' }], offset:0, limit:20, total_hits:1 });
      }
      if (url.includes('/project/proj123/version')) {
        return Response.json([{ id:'ver123', project_id:'proj123', name:'1.0.0', version_number:'1.0.0', loaders:['neoforge'], game_versions:['1.21.1'], dependencies:[], files:[{ filename:'demo.jar', url:'https://cdn.modrinth.com/data/proj123/versions/ver123/demo.jar', primary:true, size:3, hashes:{ sha512:createHash('sha512').update(Buffer.from('jar')).digest('hex') } }] }]);
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new ModrinthService(env);
    const first = await service.search({ query:'demo', minecraftVersion:'1.21.1', loader:'NeoForge' });
    const second = await service.search({ query:'demo', minecraftVersion:'1.21.1', loader:'NeoForge' });
    expect(first.items[0]?.latestCompatibleVersion?.id).toBe('ver123');
    expect(second.items[0]?.name).toBe('Demo Mod');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('categories%3Aneoforge');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('versions%3A1.21.1');
  });

  it('retries transient API errors and verifies artifact sha512', async () => {
    const bytes = Buffer.from('valid-jar-bytes');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('temporary', { status: 503 });
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    }));
    const service = new ModrinthService(env);
    const result = await service.downloadVerified({
      filename:'demo.jar',
      url:'https://cdn.modrinth.com/data/proj/versions/ver/demo.jar',
      size:bytes.length,
      sha512:createHash('sha512').update(bytes).digest('hex'),
    });
    expect(result.equals(bytes)).toBe(true);
    expect(calls).toBe(2);
  });

  it('rejects non-Modrinth artifact hosts before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = new ModrinthService(env);
    await expect(service.downloadVerified({ filename:'evil.jar', url:'https://example.com/evil.jar', size:1, sha512:'00' })).rejects.toThrow(/untrusted/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
