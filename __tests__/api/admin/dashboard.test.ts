import { GET } from '@/app/api/admin/dashboard/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: {
    emailOutbox: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    apiLog: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    apiKey: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    compiledBriefing: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    jobRun: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
  prisma: {
    jobRun: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

jest.mock('@/lib/job-monitor', () => ({
  getSystemHealth: jest.fn().mockResolvedValue({
    status: 'healthy',
    jobs: [],
    lastChecked: new Date(),
  }),
}));

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/admin/dashboard', { headers });
}

describe('GET /api/admin/dashboard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, ADMIN_SECRET: 'test-secret' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 401 without auth', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid auth and expected shape', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('updatedAt');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('jobs');
    expect(body).toHaveProperty('email');
    expect(body).toHaveProperty('api');
    expect(body).toHaveProperty('recentFailures');
  });
});
