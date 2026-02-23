import { GET } from '@/app/api/v1/briefing/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/api-auth', () => ({
  validateApiKey: jest.fn(),
  checkRateLimit: jest.fn(),
  logApiRequest: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: {
    compiledBriefing: {
      findFirst: jest.fn(),
    },
  },
}));

import { validateApiKey, checkRateLimit, logApiRequest } from '@/lib/api-auth';
import db from '@/lib/db';

function makeRequest(headers: Record<string, string> = {}, params = '') {
  return new NextRequest(`http://localhost:3000/api/v1/briefing${params}`, {
    headers,
  });
}

describe('GET /api/v1/briefing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (logApiRequest as jest.Mock).mockResolvedValue(undefined);
  });

  it('returns 401 when no auth header provided', async () => {
    (validateApiKey as jest.Mock).mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 429 when rate limited', async () => {
    (validateApiKey as jest.Mock).mockResolvedValue({
      id: 'key1',
      planTier: 'free',
    });
    (checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      remaining: 0,
    });
    const res = await GET(makeRequest({ authorization: 'Bearer sk_live_test' }));
    expect(res.status).toBe(429);
  });

  it('returns 200 with briefing payload when authorized', async () => {
    const mockPayload = { city: 'nyc', generatedAt: '2026-01-01T00:00:00Z' };
    (validateApiKey as jest.Mock).mockResolvedValue({
      id: 'key1',
      planTier: 'free',
    });
    (checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: true,
      remaining: 99,
    });
    (db.compiledBriefing.findFirst as jest.Mock).mockResolvedValue({
      payload: mockPayload,
      createdAt: new Date(),
      version: '1.0',
    });

    const res = await GET(makeRequest({ authorization: 'Bearer sk_live_test' }, '?city=nyc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(mockPayload);
  });

  it('returns 404 when no briefing exists for city', async () => {
    (validateApiKey as jest.Mock).mockResolvedValue({
      id: 'key1',
      planTier: 'free',
    });
    (checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: true,
      remaining: 99,
    });
    (db.compiledBriefing.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await GET(makeRequest({ authorization: 'Bearer sk_live_test' }, '?city=nyc'));
    expect(res.status).toBe(404);
  });

  it('logs the API request after response', async () => {
    (validateApiKey as jest.Mock).mockResolvedValue({
      id: 'key1',
      planTier: 'free',
    });
    (checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: true,
      remaining: 99,
    });
    (db.compiledBriefing.findFirst as jest.Mock).mockResolvedValue({
      payload: { city: 'nyc' },
      createdAt: new Date(),
      version: '1.0',
    });

    await GET(makeRequest({ authorization: 'Bearer sk_live_test' }, '?city=nyc'));
    expect(logApiRequest).toHaveBeenCalledWith('key1', '/api/v1/briefing', 200, expect.any(Number));
  });
});
