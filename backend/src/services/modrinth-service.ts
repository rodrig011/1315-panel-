import { createHash } from 'node:crypto';
import type { AppEnv } from '../config/env.js';
import { AppError, ValidationError } from '../lib/errors.js';

export type ModrinthDependencyType = 'required' | 'optional' | 'incompatible' | 'embedded';

export interface ModrinthSearchInput {
  query: string;
  minecraftVersion?: string;
  loader?: string;
  category?: string;
  offset?: number;
  limit?: number;
}

export interface ModrinthSearchItem {
  projectId: string;
  slug: string | null;
  name: string;
  author: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  categories: string[];
  gameVersions: string[];
  latestCompatibleVersion: {
    id: string;
    name: string;
    version: string;
    loaders: string[];
    gameVersions: string[];
  } | null;
}

export interface ModrinthSearchResult {
  items: ModrinthSearchItem[];
  offset: number;
  limit: number;
  total: number;
}

export interface ModrinthArtifact {
  filename: string;
  url: string;
  size: number;
  sha512: string;
  sha1?: string;
}

export interface ModrinthDependency {
  projectId: string | null;
  versionId: string | null;
  fileName: string | null;
  type: ModrinthDependencyType;
}

export interface ModrinthVersion {
  id: string;
  projectId: string;
  name: string;
  version: string;
  loaders: string[];
  gameVersions: string[];
  dependencies: ModrinthDependency[];
  artifact: ModrinthArtifact;
}


interface ApiProject {
  id: string;
  slug?: string | null;
  title: string;
  description: string;
  icon_url?: string | null;
  downloads: number;
  categories: string[];
  game_versions: string[];
  loaders: string[];
  team?: string;
}

export interface ModrinthProject {
  id: string;
  slug: string | null;
  name: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  categories: string[];
  gameVersions: string[];
  loaders: string[];
}

interface SearchHit {
  project_id: string;
  slug?: string | null;
  title: string;
  description: string;
  author: string;
  categories: string[];
  versions: string[];
  downloads: number;
  icon_url?: string | null;
}

interface SearchResponse {
  hits: SearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

interface ApiVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  loaders: string[];
  game_versions: string[];
  dependencies: Array<{
    project_id: string | null;
    version_id: string | null;
    file_name?: string | null;
    dependency_type: ModrinthDependencyType;
  }>;
  files: Array<{
    filename: string;
    url: string;
    primary: boolean;
    size: number;
    hashes: { sha512?: string; sha1?: string };
  }>;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export class ModrinthService {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly apiBase: URL;
  private readonly trustedDownloadHosts: Set<string>;

  constructor(private readonly env: AppEnv) {
    this.apiBase = new URL(`https://${env.MODRINTH_API_HOST}/v2/`);
    this.trustedDownloadHosts = new Set(
      env.MOD_DOWNLOAD_HOSTS.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
    );
  }

  async search(input: ModrinthSearchInput): Promise<ModrinthSearchResult> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 40);
    const offset = Math.max(input.offset ?? 0, 0);
    const facets: string[][] = [['project_type:mod']];
    if (input.loader) facets.push([`categories:${normalizeLoader(input.loader)}`]);
    if (input.minecraftVersion) facets.push([`versions:${input.minecraftVersion}`]);
    if (input.category) facets.push([`categories:${input.category}`]);

    const url = new URL('search', this.apiBase);
    url.searchParams.set('query', input.query);
    url.searchParams.set('facets', JSON.stringify(facets));
    url.searchParams.set('index', 'relevance');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));

    const response = await this.getJson<SearchResponse>(url);
    const compatible = await Promise.all(
      response.hits.map(async (hit) => ({
        projectId: hit.project_id,
        slug: hit.slug ?? null,
        name: hit.title,
        author: hit.author,
        description: hit.description,
        iconUrl: hit.icon_url ?? null,
        downloads: hit.downloads,
        categories: hit.categories,
        gameVersions: hit.versions,
        latestCompatibleVersion: input.minecraftVersion && input.loader
          ? await this.latestVersion(hit.project_id, input.minecraftVersion, input.loader)
          : null,
      })),
    );

    return {
      items: compatible.map((item) => ({
        ...item,
        latestCompatibleVersion: item.latestCompatibleVersion
          ? {
              id: item.latestCompatibleVersion.id,
              name: item.latestCompatibleVersion.name,
              version: item.latestCompatibleVersion.version,
              loaders: item.latestCompatibleVersion.loaders,
              gameVersions: item.latestCompatibleVersion.gameVersions,
            }
          : null,
      })),
      offset: response.offset,
      limit: response.limit,
      total: response.total_hits,
    };
  }

  async getProject(projectId: string): Promise<ModrinthProject> {
    assertId(projectId, 'project');
    const project = await this.getJson<ApiProject>(new URL(`project/${encodeURIComponent(projectId)}`, this.apiBase));
    return {
      id: project.id,
      slug: project.slug ?? null,
      name: project.title,
      description: project.description,
      iconUrl: project.icon_url ?? null,
      downloads: project.downloads,
      categories: project.categories,
      gameVersions: project.game_versions,
      loaders: project.loaders,
    };
  }

  async latestVersion(projectId: string, minecraftVersion: string, loader: string): Promise<ModrinthVersion | null> {
    assertId(projectId, 'project');
    const url = new URL(`project/${encodeURIComponent(projectId)}/version`, this.apiBase);
    url.searchParams.set('loaders', JSON.stringify([normalizeLoader(loader)]));
    url.searchParams.set('game_versions', JSON.stringify([minecraftVersion]));
    const versions = await this.getJson<ApiVersion[]>(url);
    const version = versions[0];
    return version ? this.toVersion(version) : null;
  }

  async getVersion(versionId: string): Promise<ModrinthVersion> {
    assertId(versionId, 'version');
    const url = new URL(`version/${encodeURIComponent(versionId)}`, this.apiBase);
    const version = await this.getJson<ApiVersion>(url);
    return this.toVersion(version);
  }

  async resolveVersion(input: {
    projectId: string;
    versionId?: string | null;
    minecraftVersion: string;
    loader: string;
  }): Promise<ModrinthVersion> {
    const version = input.versionId
      ? await this.getVersion(input.versionId)
      : await this.latestVersion(input.projectId, input.minecraftVersion, input.loader);
    if (!version || version.projectId !== input.projectId) {
      throw new ValidationError('No compatible Modrinth version exists for this server');
    }
    this.assertCompatible(version, input.minecraftVersion, input.loader);
    return version;
  }

  async downloadVerified(artifact: ModrinthArtifact): Promise<Buffer> {
    this.assertTrustedArtifact(artifact);
    const response = await this.request(new URL(artifact.url), false);
    if (!response.ok) throw new AppError('Modrinth artifact download failed', 502, 'MODRINTH_DOWNLOAD_ERROR');
    const contentLength = Number(response.headers.get('content-length') ?? artifact.size ?? 0);
    if (contentLength > this.env.MAX_UPLOAD_BYTES || artifact.size > this.env.MAX_UPLOAD_BYTES) {
      throw new ValidationError('Mod file exceeds upload limit');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > this.env.MAX_UPLOAD_BYTES) throw new ValidationError('Mod file exceeds upload limit');
    const sha512 = createHash('sha512').update(bytes).digest('hex');
    if (sha512.toLowerCase() !== artifact.sha512.toLowerCase()) {
      throw new AppError('Downloaded Modrinth artifact failed SHA-512 verification', 502, 'MODRINTH_HASH_MISMATCH');
    }
    return bytes;
  }

  assertCompatible(version: ModrinthVersion, minecraftVersion: string, loader: string): void {
    const normalizedLoader = normalizeLoader(loader);
    if (!version.gameVersions.includes(minecraftVersion)) {
      throw new ValidationError(`Mod version is not compatible with Minecraft ${minecraftVersion}`);
    }
    if (!version.loaders.map((value) => value.toLowerCase()).includes(normalizedLoader)) {
      throw new ValidationError(`Mod version is not compatible with ${loader}`);
    }
  }

  private toVersion(version: ApiVersion): ModrinthVersion {
    const file = version.files.find((item) => item.primary) ?? version.files[0];
    if (!file?.hashes.sha512) throw new AppError('Modrinth version has no verifiable primary artifact', 502, 'MODRINTH_INVALID_ARTIFACT');
    const artifact: ModrinthArtifact = {
      filename: file.filename,
      url: file.url,
      size: file.size,
      sha512: file.hashes.sha512,
      ...(file.hashes.sha1 ? { sha1: file.hashes.sha1 } : {}),
    };
    this.assertTrustedArtifact(artifact);
    return {
      id: version.id,
      projectId: version.project_id,
      name: version.name,
      version: version.version_number,
      loaders: version.loaders,
      gameVersions: version.game_versions,
      dependencies: version.dependencies.map((dependency) => ({
        projectId: dependency.project_id,
        versionId: dependency.version_id,
        fileName: dependency.file_name ?? null,
        type: dependency.dependency_type,
      })),
      artifact,
    };
  }

  private assertTrustedArtifact(artifact: ModrinthArtifact): void {
    const url = new URL(artifact.url);
    if (url.protocol !== 'https:' || !this.trustedDownloadHosts.has(url.hostname.toLowerCase())) {
      throw new ValidationError('Modrinth returned an untrusted artifact host');
    }
    if (url.username || url.password || url.port || !artifact.filename.toLowerCase().endsWith('.jar')) {
      throw new ValidationError('Modrinth returned an invalid artifact');
    }
  }

  private async getJson<T>(url: URL): Promise<T> {
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const task = (async () => {
      const response = await this.request(url, true);
      if (response.status === 404) throw new ValidationError('Modrinth resource was not found');
      if (!response.ok) throw new AppError('Modrinth API request failed', 502, 'MODRINTH_API_ERROR');
      const value = (await response.json()) as T;
      this.cache.set(key, { value, expiresAt: Date.now() + this.env.MODRINTH_CACHE_TTL_MS });
      if (this.cache.size > this.env.MODRINTH_CACHE_MAX_ENTRIES) this.evictExpiredOrOldest();
      return value;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async request(url: URL, apiRequest: boolean): Promise<Response> {
    if (apiRequest && url.hostname.toLowerCase() !== this.env.MODRINTH_API_HOST.toLowerCase()) {
      throw new ValidationError('Refusing request to non-Modrinth API host');
    }
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.env.MODRINTH_RETRY_COUNT; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { 'user-agent': this.env.MODRINTH_USER_AGENT },
          redirect: 'error',
          signal: AbortSignal.timeout(this.env.MODRINTH_TIMEOUT_MS),
        });
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === this.env.MODRINTH_RETRY_COUNT) {
          return response;
        }
        const resetSeconds = Number(response.headers.get('x-ratelimit-reset') ?? 0);
        await sleep(Math.max(resetSeconds * 1000, this.env.MODRINTH_RETRY_BASE_MS * 2 ** attempt));
      } catch (error) {
        lastError = error;
        if (attempt === this.env.MODRINTH_RETRY_COUNT) break;
        await sleep(this.env.MODRINTH_RETRY_BASE_MS * 2 ** attempt);
      }
    }
    throw new AppError(`Modrinth request failed${lastError ? ': network error' : ''}`, 502, 'MODRINTH_NETWORK_ERROR');
  }

  private evictExpiredOrOldest(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    if (this.cache.size <= this.env.MODRINTH_CACHE_MAX_ENTRIES) return;
    const oldest = this.cache.keys().next().value as string | undefined;
    if (oldest) this.cache.delete(oldest);
  }
}

export function normalizeLoader(loader: string): string {
  const value = loader.trim().toLowerCase();
  if (value === 'neoforge') return 'neoforge';
  if (value === 'forge') return 'forge';
  if (value === 'fabric') return 'fabric';
  return value;
}

function assertId(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{2,64}$/u.test(value)) throw new ValidationError(`Invalid Modrinth ${label} id`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
