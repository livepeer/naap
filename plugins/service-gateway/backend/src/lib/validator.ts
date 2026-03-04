import { z } from 'zod';
import { HostNotAllowedError, ValidationError } from './errors.js';

const ALLOWED_HOSTS = (process.env.SSH_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const COMMAND_BLOCKLIST = [
  /rm\s+-rf\s+\/(?!\w)/,
  /mkfs\b/,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  /dd\s+if=.*of=\/dev\//,
  /shutdown\b/,
  /reboot\b/,
  /init\s+0/,
  /halt\b/,
];

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENV_VALUE_BYTES = 32_768;
const MAX_SCRIPT_BYTES = 65_536;

const sshTarget = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(128),
});

const envMap = z.record(
  z.string().regex(ENV_KEY, 'Invalid env var name'),
  z.string().max(MAX_ENV_VALUE_BYTES),
).optional().default({});

export const ExecSchema = sshTarget.extend({
  command: z.string().min(1).max(8192),
  env: envMap,
  timeout: z.number().int().min(1000).max(300_000).default(30_000),
});

export const ExecAsyncSchema = sshTarget.extend({
  command: z.string().min(1).max(8192),
  env: envMap,
  timeout: z.number().int().min(1000).max(3_600_000).default(300_000),
});

export const ExecScriptSchema = sshTarget.extend({
  script: z.string().min(1).max(MAX_SCRIPT_BYTES),
  env: envMap,
  timeout: z.number().int().min(1000).max(3_600_000).default(600_000),
  workingDirectory: z.string().max(512).default('/tmp'),
});

export const UploadSchema = sshTarget.extend({
  remotePath: z.string().min(1).max(1024),
  content: z.string().min(1),
  mode: z.string().regex(/^0[0-7]{3}$/).default('0644'),
});

export const DownloadSchema = sshTarget.extend({
  remotePath: z.string().min(1).max(1024),
});

export const LsSchema = sshTarget.extend({
  remotePath: z.string().min(1).max(1024),
});

export const ConnectSchema = sshTarget;

export type ExecInput = z.infer<typeof ExecSchema>;
export type ExecAsyncInput = z.infer<typeof ExecAsyncSchema>;
export type ExecScriptInput = z.infer<typeof ExecScriptSchema>;
export type UploadInput = z.infer<typeof UploadSchema>;
export type DownloadInput = z.infer<typeof DownloadSchema>;
export type LsInput = z.infer<typeof LsSchema>;
export type ConnectInput = z.infer<typeof ConnectSchema>;

export function validateHost(host: string): void {
  if (ALLOWED_HOSTS.length === 0) return;
  const match = ALLOWED_HOSTS.some((allowed) => {
    if (allowed.includes('/')) {
      return cidrContains(allowed, host);
    }
    return allowed === host || allowed === '*';
  });
  if (!match) throw new HostNotAllowedError(host);
}

export function validateCommand(command: string): void {
  for (const pattern of COMMAND_BLOCKLIST) {
    if (pattern.test(command)) {
      throw new ValidationError(`Command matches blocklist pattern: ${pattern.source}`);
    }
  }
}

export function validateRemotePath(remotePath: string): void {
  const normalized = remotePath.replace(/\/+/g, '/');
  if (normalized.includes('/../') || normalized.endsWith('/..')) {
    throw new ValidationError('Path traversal detected in remote path');
  }
}

export function validateScript(script: string): void {
  const bytes = new TextEncoder().encode(script).length;
  if (bytes > MAX_SCRIPT_BYTES) {
    throw new ValidationError(`Script exceeds maximum size of ${MAX_SCRIPT_BYTES} bytes`);
  }
  const hasBinary = /[\x00-\x08\x0E-\x1F]/.test(script);
  if (hasBinary) {
    throw new ValidationError('Script contains binary content');
  }
}

function cidrContains(cidr: string, ip: string): boolean {
  const [range, bits] = cidr.split('/');
  if (!bits) return range === ip;
  const mask = ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0;
  const rangeNum = ipToNum(range);
  const ipNum = ipToNum(ip);
  if (rangeNum === null || ipNum === null) return false;
  return (rangeNum & mask) === (ipNum & mask);
}

function ipToNum(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.reduce((acc, octet) => {
    const n = parseInt(octet, 10);
    if (isNaN(n) || n < 0 || n > 255) return NaN;
    return (acc << 8) | n;
  }, 0) >>> 0;
}
