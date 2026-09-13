import { ValidationError } from './errors.js';

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export function sanitizeConsoleCommand(input: string): string {
  const command = input.trim();
  if (command.length === 0 || command.length > 512) {
    throw new ValidationError('Console command must be between 1 and 512 characters');
  }
  if (command.includes('\n') || command.includes('\r') || CONTROL_CHARS.test(command)) {
    throw new ValidationError('Console command contains forbidden control characters');
  }
  return command.startsWith('/') ? command.slice(1) : command;
}

export function assertMinecraftUsername(username: string): string {
  if (!USERNAME_PATTERN.test(username)) {
    throw new ValidationError('Invalid Minecraft username');
  }
  return username;
}

export function sanitizeReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  const value = reason.trim();
  if (value.length === 0) return undefined;
  if (value.length > 160 || value.includes('\n') || value.includes('\r') || CONTROL_CHARS.test(value)) {
    throw new ValidationError('Invalid moderation reason');
  }
  return value;
}
