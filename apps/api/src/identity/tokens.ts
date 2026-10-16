import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/** A random opaque token for refresh tokens and invitation links */
export const newToken = () => randomBytes(32).toString('base64url');

/** Tokens are stored only as their SHA-256 hash */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Six-digit one-time code */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Codes are short, so they are hashed with a server secret to stop offline guessing */
export const hashCode = (code: string, secret: string) => createHmac('sha256', secret).update(code).digest('hex');

export function sameHash(a: string, b: string) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}
