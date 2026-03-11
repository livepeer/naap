import * as crypto from 'crypto';

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}
