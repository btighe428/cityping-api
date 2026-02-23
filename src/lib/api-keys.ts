import { randomBytes, createHash } from 'crypto';

export function generateApiKey(): { raw: string; hashed: string; prefix: string } {
  const raw = `sk_live_${randomBytes(32).toString('base64url')}`;
  const hashed = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.substring(0, 12);
  return { raw, hashed, prefix };
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}
