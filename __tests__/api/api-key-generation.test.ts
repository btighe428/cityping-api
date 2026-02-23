import { generateApiKey } from '@/lib/api-keys';

describe('generateApiKey', () => {
  it('returns a raw key with sk_live_ prefix', () => {
    const { raw } = generateApiKey();
    expect(raw).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
  });

  it('returns a SHA-256 hex hash', () => {
    const { hashed } = generateApiKey();
    expect(hashed).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns a prefix (first 12 chars of raw key)', () => {
    const { raw, prefix } = generateApiKey();
    expect(prefix).toBe(raw.substring(0, 12));
  });

  it('generates unique keys each time', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1.raw).not.toBe(key2.raw);
    expect(key1.hashed).not.toBe(key2.hashed);
  });
});
