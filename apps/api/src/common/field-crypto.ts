import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Application-layer encryption for sensitive columns (identity numbers, bank accounts).
 * AES-256-GCM with a random IV per value; stored as "v1:<base64 iv|tag|ciphertext>".
 *
 * The key comes from FIELD_ENCRYPTION_KEY (32 bytes, base64). Outside production it falls back
 * to a key derived from JWT_SECRET so local set-up needs no extra step; production refuses to
 * start without a real key, which belongs in a secrets manager.
 */
let cachedKey: Buffer | null = null;

export function fieldKey(): Buffer {
  if (cachedKey) return cachedKey;
  const configured = process.env.FIELD_ENCRYPTION_KEY;
  if (configured) {
    const key = Buffer.from(configured, 'base64');
    if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    cachedKey = key;
  } else {
    if (process.env.NODE_ENV === 'production') throw new Error('Set FIELD_ENCRYPTION_KEY before starting in production');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('Set FIELD_ENCRYPTION_KEY or JWT_SECRET');
    cachedKey = createHash('sha256').update(`gpp-field-key:${secret}`).digest();
  }
  return cachedKey;
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', fieldKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function decryptField(stored: string): string {
  if (!stored.startsWith('v1:')) throw new Error('Unknown encrypted field format');
  const raw = Buffer.from(stored.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', fieldKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const last4 = (s: string) => s.replace(/\s+/g, '').slice(-4);

/** "•••• 1234" */
export const masked = (l4: string) => `•••• ${l4}`;
