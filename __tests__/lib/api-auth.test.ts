import { validateApiKey, checkRateLimit } from '@/lib/api-auth';

// Mock Prisma
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: {
    apiKey: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    apiLog: {
      count: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import db from '@/lib/db';

const mockDb = db as jest.Mocked<typeof db>;

describe('validateApiKey', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null for missing authorization header', async () => {
    const result = await validateApiKey(null);
    expect(result).toBeNull();
  });

  it('returns null for malformed Bearer token', async () => {
    const result = await validateApiKey('Basic abc123');
    expect(result).toBeNull();
  });

  it('returns null for token without sk_live_ prefix', async () => {
    const result = await validateApiKey('Bearer bad_prefix_abc');
    expect(result).toBeNull();
  });

  it('returns null when key not found in database', async () => {
    (mockDb.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    const result = await validateApiKey('Bearer sk_live_test123');
    expect(result).toBeNull();
  });

  it('returns null when key is inactive', async () => {
    (mockDb.apiKey.findUnique as jest.Mock).mockResolvedValue({
      id: 'key1',
      isActive: false,
      planTier: 'free',
      apiClientId: 'client1',
    });
    const result = await validateApiKey('Bearer sk_live_test123');
    expect(result).toBeNull();
  });

  it('returns key data when valid and active', async () => {
    const mockKey = {
      id: 'key1',
      isActive: true,
      planTier: 'free',
      apiClientId: 'client1',
    };
    (mockDb.apiKey.findUnique as jest.Mock).mockResolvedValue(mockKey);
    (mockDb.apiKey.update as jest.Mock).mockResolvedValue(mockKey);
    const result = await validateApiKey('Bearer sk_live_test123');
    expect(result).toEqual(mockKey);
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows requests under free tier limit (100/day)', async () => {
    (mockDb.apiLog.count as jest.Mock).mockResolvedValue(50);
    const result = await checkRateLimit('key1', 'free');
    expect(result).toEqual({ allowed: true, remaining: 50 });
  });

  it('blocks requests over free tier limit', async () => {
    (mockDb.apiLog.count as jest.Mock).mockResolvedValue(100);
    const result = await checkRateLimit('key1', 'free');
    expect(result).toEqual({ allowed: false, remaining: 0 });
  });

  it('allows pro tier up to 10,000/day', async () => {
    (mockDb.apiLog.count as jest.Mock).mockResolvedValue(5000);
    const result = await checkRateLimit('key1', 'pro');
    expect(result).toEqual({ allowed: true, remaining: 5000 });
  });

  it('always allows enterprise tier', async () => {
    const result = await checkRateLimit('key1', 'enterprise');
    expect(result).toEqual({ allowed: true, remaining: -1 });
  });
});
