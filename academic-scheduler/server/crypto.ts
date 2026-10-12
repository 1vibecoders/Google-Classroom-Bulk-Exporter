// Secrets at rest and random tokens. Google refresh tokens are stored
// AES-256-GCM encrypted with TOKEN_ENCRYPTION_KEY (32 random bytes, base64);
// session ids are stored only as SHA-256 hashes.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('base64url');
}

function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  return bytes;
}

/** "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function encrypt(plain: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(sealed: string, key: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unreadable encrypted value.');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
