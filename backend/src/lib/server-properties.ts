import { ValidationError } from './errors.js';

export type ServerProperties = Record<string, string>;

export function parseServerProperties(content: string): ServerProperties {
  const properties: ServerProperties = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (key) properties[key] = value;
  }
  return properties;
}

export function serializeServerProperties(properties: ServerProperties): string {
  const keys = Object.keys(properties).sort();
  return `${keys.map((key) => `${key}=${properties[key] ?? ''}`).join('\n')}\n`;
}

export function booleanProperty(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

export function integerProperty(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function validateJvmFlags(flags: string | null | undefined): string | null | undefined {
  if (flags === undefined || flags === null) return flags;
  const value = flags.trim();
  if (!value) return null;
  if (value.length > 1024 || /[\r\n\0]/u.test(value)) {
    throw new ValidationError('Invalid JVM flags');
  }
  const forbidden = ['-javaagent', '-agentlib', '-agentpath', '-XX:OnError', '-XX:OnOutOfMemoryError'];
  if (forbidden.some((token) => value.toLowerCase().includes(token.toLowerCase()))) {
    throw new ValidationError('JVM flags contain an option that is not allowed');
  }
  if (!/^[A-Za-z0-9_+.,:=\-/% ]+$/u.test(value)) {
    throw new ValidationError('JVM flags contain unsupported characters');
  }
  return value;
}
