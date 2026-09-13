import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_ORIGIN: z.string().url().default('http://localhost:3000'),
    PUBLIC_HOST: z.string().min(1).default('localhost'),
    DATABASE_URL: z.string().min(1).default('file:./dev.db'),
    ADMIN_USERNAME: z.string().min(3).max(64).default('admin'),
    ADMIN_PASSWORD: z.string().min(12),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    LOGIN_LOCKOUT_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    AUTH_ENCRYPTION_KEY: z.string().refine((value) => { try { return Buffer.from(value, 'base64url').length === 32; } catch { return false; } }, 'AUTH_ENCRYPTION_KEY must be 32 random bytes encoded as base64url'),
    AUTH_RECOVERY_PEPPER: z.string().min(32),
    TOTP_ISSUER: z.string().min(1).max(64).default('1315 Panel'),
    SERVER_DATA_ROOT: z.string().min(1).default('/srv/mcpanel/servers'),
    BACKUP_ROOT: z.string().min(1).default('/srv/mcpanel/legacy-backups'),
    DOCKER_SOCKET: z.string().min(1).default('/var/run/docker.sock'),
    DOCKER_HOST: z.string().regex(/^tcp:\/\/[A-Za-z0-9_.-]+:\d+$/u).optional(),
    DOCKER_NETWORK: z.string().regex(/^[A-Za-z0-9_.-]+$/u).default('mcpanel-internal'),
    MINECRAFT_IMAGE_REPOSITORY: z.string().min(1).default('itzg/minecraft-server'),
    MC_BIND_ADDRESS: z.string().min(1).default('0.0.0.0'),
    MC_DEFAULT_JAVA_VERSION: z.coerce.number().int().refine((value) => [17, 21, 25].includes(value)).default(21),
    MC_DEFAULT_RESTART_POLICY: z.enum(['no', 'on-failure', 'unless-stopped', 'always']).default('unless-stopped'),
    MC_UID: z.coerce.number().int().min(1).default(1000),
    MC_GID: z.coerce.number().int().min(1).default(1000),
    MC_MANAGE_OWNERSHIP: booleanString,
    MC_HEAP_RATIO: z.coerce.number().min(0.5).max(0.95).default(0.92),
    HOST_MEMORY_MB: z.coerce.number().int().min(2048).default(8192),
    MC_MAX_MEMORY_MB: z.coerce.number().int().min(512).default(6144),
    MC_TIMEZONE: z.string().min(1).default('UTC'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(64 * 1024 * 1024),
    MAX_TEXT_FILE_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
    METRICS_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
    METRICS_RETENTION_HOURS: z.coerce.number().int().min(1).default(24),
    MOD_DOWNLOAD_HOSTS: z.string().default('cdn.modrinth.com'),
    MODRINTH_API_HOST: z.string().min(1).default('api.modrinth.com'),
    MODRINTH_USER_AGENT: z.string().min(3).default('1315-panel/1.0 (self-hosted)'),
    MODRINTH_CACHE_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
    MODRINTH_CACHE_MAX_ENTRIES: z.coerce.number().int().min(20).max(5000).default(500),
    MODRINTH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    MODRINTH_RETRY_COUNT: z.coerce.number().int().min(0).max(5).default(3),
    MODRINTH_RETRY_BASE_MS: z.coerce.number().int().min(50).max(5000).default(250),
    COOKIE_NAME: z.string().min(1).default('mc_panel_session'),
    CSRF_COOKIE_NAME: z.string().min(1).default('mc_panel_csrf'),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    COOKIE_SECURE: booleanString,
    TRUST_PROXY: booleanString,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.ADMIN_PASSWORD.includes('replace-with')) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_PASSWORD'], message: 'ADMIN_PASSWORD must be changed in production' });
    }
    if (env.NODE_ENV === 'production' && env.MC_BIND_ADDRESS === '127.0.0.1') {
      ctx.addIssue({ code: 'custom', path: ['MC_BIND_ADDRESS'], message: 'MC_BIND_ADDRESS is loopback-only; players will not be able to connect remotely' });
    }
    const reservedMb = 1536;
    if (env.MC_MAX_MEMORY_MB > env.HOST_MEMORY_MB - reservedMb) {
      ctx.addIssue({ code: 'custom', path: ['MC_MAX_MEMORY_MB'], message: `MC_MAX_MEMORY_MB must leave at least ${reservedMb} MB for Ubuntu and the control plane` });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}
