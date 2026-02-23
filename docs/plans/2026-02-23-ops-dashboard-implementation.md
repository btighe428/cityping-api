# Ops Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full operational dashboard at `/admin` that visualizes all cron jobs, scrapers, email delivery, B2B API usage, and recent failures with 30-second auto-refresh.

**Architecture:** New API route (`/api/admin/dashboard`) queries Prisma for job health, email stats, API usage, and failures. Client page polls every 30s and renders grouped status cards. Auth via ADMIN_SECRET bearer token.

**Tech Stack:** Next.js App Router, Prisma ORM, Tailwind CSS, React useState/useEffect

**Design Doc:** `docs/plans/2026-02-23-ops-dashboard-design.md`

---

### Task 1: Build the Dashboard API Route

**Files:**
- Create: `src/app/api/admin/dashboard/route.ts`
- Test: `__tests__/api/admin/dashboard.test.ts`

**Step 1: Write the failing test**

Create `__tests__/api/admin/dashboard.test.ts`:

```typescript
import { GET } from '@/app/api/admin/dashboard/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: {
    jobRun: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    emailOutbox: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    apiLog: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    compiledBriefing: {
      findFirst: jest.fn().mockResolvedValue(null),
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/api/admin/dashboard.test.ts --no-cache
```

Expected: FAIL — Cannot find module

**Step 3: Write the API route**

Create `src/app/api/admin/dashboard/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSystemHealth } from '@/lib/job-monitor';
import db from '@/lib/db';

const JOB_CATEGORIES: Record<string, string> = {
  'ingest-mta-alerts': 'scraper',
  'ingest-nyc-events': 'scraper',
  'ingest-sample-sales': 'scraper',
  'ingest-housing-lotteries': 'scraper',
  'ingest-news': 'scraper',
  'scrape-311': 'scraper',
  'scrape-air-quality': 'scraper',
  'scrape-dining': 'scraper',
  'scrape-parks': 'scraper',
  'scrape-events': 'scraper',
  'scrape-streets': 'scraper',
  'scrape-emergency': 'scraper',
  'embed-content': 'processing',
  'curate-news': 'processing',
  'orchestrate-data': 'processing',
  'compile-briefing': 'processing',
  'preflight-check': 'processing',
  'aggregate-feedback': 'processing',
  'email-timeslot-morning': 'email',
  'email-timeslot-noon': 'email',
  'email-timeslot-evening': 'email',
  'send-daily-pulse': 'email',
  'send-daily-digest': 'email',
  'send-day-ahead': 'email',
  'send-weekly-digest': 'email',
  'send-reminders': 'email',
  'send-notifications': 'email',
  'send-monthly-recap': 'email',
};

export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    // Run all queries in parallel
    const [
      systemHealth,
      emailStatsByStatus,
      emailStatsByType,
      apiCallsToday,
      apiCallsMonth,
      topApiKeys,
      latestBriefing,
      recentFailures,
      lastRunPerJob,
    ] = await Promise.all([
      getSystemHealth(),

      // Email stats by status (today)
      db.emailOutbox.groupBy({
        by: ['status'],
        where: { targetDate: { gte: todayStart } },
        _count: true,
      }),

      // Email stats by type (today)
      db.emailOutbox.groupBy({
        by: ['emailType', 'status'],
        where: { targetDate: { gte: todayStart } },
        _count: true,
      }),

      // API calls today
      db.apiLog.count({
        where: { createdAt: { gte: todayStart } },
      }),

      // API calls this month
      db.apiLog.count({
        where: { createdAt: { gte: monthStart } },
      }),

      // Top API keys by usage (today)
      db.apiLog.groupBy({
        by: ['apiKeyId'],
        where: { createdAt: { gte: todayStart } },
        _count: true,
        orderBy: { _count: { apiKeyId: 'desc' } },
        take: 3,
      }),

      // Latest compiled briefing
      db.compiledBriefing.findFirst({
        where: { city: 'nyc' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),

      // Recent failures (last 10)
      db.jobRun.findMany({
        where: { status: 'failed' },
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: {
          jobName: true,
          errorMessage: true,
          startedAt: true,
          durationMs: true,
        },
      }),

      // Last run per job (for duration/items data not in health check)
      db.jobRun.findMany({
        where: {
          startedAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        },
        orderBy: { startedAt: 'desc' },
        distinct: ['jobName'],
        select: {
          jobName: true,
          status: true,
          startedAt: true,
          durationMs: true,
          itemsProcessed: true,
          itemsFailed: true,
        },
      }),
    ]);

    // Build email stats
    const emailToday: Record<string, number> = { sent: 0, failed: 0, pending: 0, skipped: 0 };
    for (const row of emailStatsByStatus) {
      emailToday[row.status] = row._count;
    }

    const emailByType: Record<string, Record<string, number>> = {};
    for (const row of emailStatsByType) {
      if (!emailByType[row.emailType]) emailByType[row.emailType] = {};
      emailByType[row.emailType][row.status] = row._count;
    }

    // Resolve API key prefixes for top keys
    let topKeys: { prefix: string; calls: number }[] = [];
    if (topApiKeys.length > 0) {
      const keyIds = topApiKeys.map((k) => k.apiKeyId);
      const keys = await db.apiKey.findMany({
        where: { id: { in: keyIds } },
        select: { id: true, keyPrefix: true },
      });
      const prefixMap = new Map(keys.map((k) => [k.id, k.keyPrefix]));
      topKeys = topApiKeys.map((k) => ({
        prefix: prefixMap.get(k.apiKeyId) ?? 'unknown',
        calls: k._count,
      }));
    }

    // Merge health data with last run details
    const lastRunMap = new Map(lastRunPerJob.map((r) => [r.jobName, r]));
    const jobs = systemHealth.jobs.map((job) => {
      const lastRun = lastRunMap.get(job.jobName);
      return {
        name: job.jobName,
        displayName: job.displayName,
        category: JOB_CATEGORIES[job.jobName] ?? 'other',
        status: job.status,
        lastRun: job.lastRun?.toISOString() ?? null,
        lastStatus: job.lastStatus,
        expectedFrequency: job.expectedFrequency,
        missedRuns: job.missedRuns,
        consecutiveFailures: job.consecutiveFailures,
        durationMs: lastRun?.durationMs ?? null,
        itemsProcessed: lastRun?.itemsProcessed ?? null,
        itemsFailed: lastRun?.itemsFailed ?? null,
      };
    });

    // Calculate briefing age in minutes
    const briefingAgeMin = latestBriefing
      ? Math.round((Date.now() - latestBriefing.createdAt.getTime()) / 60000)
      : null;

    return NextResponse.json({
      status: systemHealth.status,
      updatedAt: new Date().toISOString(),
      summary: {
        totalJobs: jobs.length,
        healthy: jobs.filter((j) => j.status === 'healthy').length,
        warning: jobs.filter((j) => j.status === 'warning').length,
        critical: jobs.filter((j) => j.status === 'critical').length,
        unknown: jobs.filter((j) => j.status === 'unknown').length,
      },
      jobs,
      email: {
        today: emailToday,
        byType: emailByType,
      },
      api: {
        callsToday: apiCallsToday,
        callsThisMonth: apiCallsMonth,
        latestBriefingAgeMin: briefingAgeMin,
        topKeys,
      },
      recentFailures: recentFailures.map((f) => ({
        jobName: f.jobName,
        errorMessage: f.errorMessage,
        startedAt: f.startedAt.toISOString(),
        durationMs: f.durationMs,
      })),
    });
  } catch (error) {
    console.error('[Dashboard API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest __tests__/api/admin/dashboard.test.ts --no-cache
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/app/api/admin/dashboard/route.ts __tests__/api/admin/dashboard.test.ts
git commit -m "feat: add /api/admin/dashboard endpoint for ops monitoring"
```

---

### Task 2: Build the Admin Dashboard Page

**Files:**
- Create: `src/app/admin/page.tsx`
- Create: `src/app/admin/components.tsx`

**Step 1: Create the client component with all dashboard sections**

Create `src/app/admin/components.tsx`:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface JobInfo {
  name: string;
  displayName: string;
  category: string;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  lastRun: string | null;
  lastStatus: string | null;
  expectedFrequency: string;
  missedRuns: number;
  consecutiveFailures: number;
  durationMs: number | null;
  itemsProcessed: number | null;
  itemsFailed: number | null;
}

interface DashboardData {
  status: 'healthy' | 'degraded' | 'critical';
  updatedAt: string;
  summary: {
    totalJobs: number;
    healthy: number;
    warning: number;
    critical: number;
    unknown: number;
  };
  jobs: JobInfo[];
  email: {
    today: Record<string, number>;
    byType: Record<string, Record<string, number>>;
  };
  api: {
    callsToday: number;
    callsThisMonth: number;
    latestBriefingAgeMin: number | null;
    topKeys: { prefix: string; calls: number }[];
  };
  recentFailures: {
    jobName: string;
    errorMessage: string | null;
    startedAt: string;
    durationMs: number | null;
  }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  healthy: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-red-500',
  unknown: 'bg-gray-400',
} as const;

const STATUS_BG = {
  healthy: 'bg-green-50 border-green-200 text-green-800',
  degraded: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  critical: 'bg-red-50 border-red-200 text-red-800',
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  scraper: 'Scrapers & Ingestion',
  email: 'Email Delivery',
  processing: 'Data Processing',
  other: 'Other',
};

function timeAgo(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Components ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? 'bg-gray-400';
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-[#E8E4DF] p-5">
      <h2 className="text-sm font-medium text-[#6B6B6B] mb-3">{title}</h2>
      {children}
    </div>
  );
}

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-semibold text-[#2C2C2C]">{value}</div>
      <div className="text-xs text-[#6B6B6B] mt-0.5">{label}</div>
      {sub && <div className="text-xs text-[#9B9B9B] mt-0.5">{sub}</div>}
    </div>
  );
}

function JobRow({ job }: { job: JobInfo }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-[#FAF8F5] transition-colors">
      <StatusDot status={job.status} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-[#2C2C2C] truncate">{job.name}</div>
        <div className="text-xs text-[#6B6B6B]">{job.displayName}</div>
      </div>
      <div className="text-right text-xs text-[#6B6B6B] whitespace-nowrap">
        {job.lastRun ? timeAgo(job.lastRun) : 'never'}
      </div>
      <div className="text-right text-xs font-mono text-[#6B6B6B] w-16">
        {formatMs(job.durationMs)}
      </div>
      <div className="text-right text-xs text-[#6B6B6B] w-12">
        {job.itemsProcessed !== null ? job.itemsProcessed : '—'}
      </div>
      {job.missedRuns > 0 && (
        <span className="text-xs text-red-600 font-medium">
          {job.missedRuns} missed
        </span>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string>('');
  const [authed, setAuthed] = useState(false);

  const fetchData = useCallback(async (secret: string) => {
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { authorization: `Bearer ${secret}` },
      });
      if (res.status === 401) {
        setAuthed(false);
        setError('Invalid admin secret');
        localStorage.removeItem('admin_secret');
        return;
      }
      if (!res.ok) {
        setError(`Error: ${res.status}`);
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed');
    }
  }, []);

  // Check localStorage for saved token
  useEffect(() => {
    const saved = localStorage.getItem('admin_secret');
    if (saved) {
      setToken(saved);
      setAuthed(true);
      fetchData(saved);
    }
  }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!authed || !token) return;
    const interval = setInterval(() => fetchData(token), 30000);
    return () => clearInterval(interval);
  }, [authed, token, fetchData]);

  const handleLogin = () => {
    localStorage.setItem('admin_secret', token);
    setAuthed(true);
    fetchData(token);
  };

  // Login screen
  if (!authed) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center">
        <div className="bg-white rounded-xl border border-[#E8E4DF] p-8 w-full max-w-sm">
          <h1 className="text-xl font-semibold text-[#2C2C2C] mb-4">Admin Dashboard</h1>
          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
          <input
            type="password"
            placeholder="Admin secret"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-2 border border-[#E8E4DF] rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[#2C2C2C]"
          />
          <button
            onClick={handleLogin}
            className="w-full px-4 py-2 bg-[#2C2C2C] text-white text-sm font-medium rounded-lg hover:bg-[#404040] transition-colors"
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center">
        <p className="text-[#6B6B6B]">Loading...</p>
      </div>
    );
  }

  // Group jobs by category
  const grouped: Record<string, JobInfo[]> = {};
  for (const job of data.jobs) {
    const cat = job.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(job);
  }

  return (
    <div className="min-h-screen bg-[#FAF8F5]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#2C2C2C]">CityPing Ops</h1>
            <p className="text-xs text-[#6B6B6B] mt-1">
              Updated {timeAgo(data.updatedAt)} &middot; Auto-refreshes every 30s
            </p>
          </div>
          <button
            onClick={() => fetchData(token)}
            className="px-3 py-1.5 text-xs border border-[#E8E4DF] rounded-lg hover:bg-white transition-colors text-[#6B6B6B]"
          >
            Refresh
          </button>
        </div>

        {/* System Status Banner */}
        <div className={`rounded-xl border p-4 mb-6 ${STATUS_BG[data.status]}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold capitalize">{data.status}</span>
              <span className="text-sm opacity-75">
                {data.summary.totalJobs} jobs tracked
              </span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-green-700">{data.summary.healthy} healthy</span>
              {data.summary.warning > 0 && (
                <span className="text-yellow-700">{data.summary.warning} warning</span>
              )}
              {data.summary.critical > 0 && (
                <span className="text-red-700">{data.summary.critical} critical</span>
              )}
              {data.summary.unknown > 0 && (
                <span className="text-gray-500">{data.summary.unknown} unknown</span>
              )}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card title="Emails Today">
            <div className="flex justify-around">
              <StatBox label="Sent" value={data.email.today.sent ?? 0} />
              <StatBox label="Failed" value={data.email.today.failed ?? 0} />
              <StatBox label="Pending" value={data.email.today.pending ?? 0} />
            </div>
          </Card>
          <Card title="API Calls">
            <div className="flex justify-around">
              <StatBox label="Today" value={data.api.callsToday} />
              <StatBox label="This Month" value={data.api.callsThisMonth.toLocaleString()} />
            </div>
          </Card>
          <Card title="Latest Briefing">
            <div className="flex justify-center">
              <StatBox
                label="Age"
                value={data.api.latestBriefingAgeMin !== null ? `${data.api.latestBriefingAgeMin}m` : '—'}
                sub={data.api.latestBriefingAgeMin !== null && data.api.latestBriefingAgeMin > 20 ? 'STALE' : 'OK'}
              />
            </div>
          </Card>
          <Card title="Top API Keys">
            {data.api.topKeys.length === 0 ? (
              <p className="text-xs text-[#6B6B6B]">No API calls today</p>
            ) : (
              <div className="space-y-1">
                {data.api.topKeys.map((k) => (
                  <div key={k.prefix} className="flex justify-between text-xs">
                    <span className="font-mono text-[#2C2C2C]">{k.prefix}...</span>
                    <span className="text-[#6B6B6B]">{k.calls} calls</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Job Groups */}
        <div className="space-y-4 mb-6">
          {['scraper', 'email', 'processing', 'other'].map((category) => {
            const jobs = grouped[category];
            if (!jobs || jobs.length === 0) return null;
            return (
              <Card key={category} title={CATEGORY_LABELS[category] ?? category}>
                <div className="flex items-center gap-4 text-xs text-[#9B9B9B] px-3 pb-1 border-b border-[#F0EDE8] mb-1">
                  <span className="w-2.5" />
                  <span className="flex-1">Job</span>
                  <span className="w-16 text-right">Last Run</span>
                  <span className="w-16 text-right">Duration</span>
                  <span className="w-12 text-right">Items</span>
                </div>
                {jobs
                  .sort((a, b) => {
                    const order = { critical: 0, warning: 1, unknown: 2, healthy: 3 };
                    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
                  })
                  .map((job) => (
                    <JobRow key={job.name} job={job} />
                  ))}
              </Card>
            );
          })}
        </div>

        {/* Email Breakdown by Type */}
        {Object.keys(data.email.byType).length > 0 && (
          <Card title="Email Breakdown by Type">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(data.email.byType).map(([type, stats]) => (
                <div key={type} className="bg-[#FAF8F5] rounded-lg p-3">
                  <div className="font-mono text-xs text-[#2C2C2C] mb-1">{type.replace(/_/g, ' ')}</div>
                  <div className="flex gap-2 text-xs text-[#6B6B6B]">
                    {Object.entries(stats).map(([status, count]) => (
                      <span key={status}>
                        {count} {status}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Recent Failures */}
        {data.recentFailures.length > 0 && (
          <div className="mt-4">
            <Card title="Recent Failures">
              <div className="space-y-2">
                {data.recentFailures.map((f, i) => (
                  <div key={i} className="bg-red-50 border border-red-100 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-red-800 font-medium">{f.jobName}</span>
                      <span className="text-xs text-red-600">{timeAgo(f.startedAt)}</span>
                    </div>
                    {f.errorMessage && (
                      <pre className="text-xs text-red-700 bg-red-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                        {f.errorMessage}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create the page wrapper**

Create `src/app/admin/page.tsx`:

```tsx
import { AdminDashboard } from './components';

export default function AdminPage() {
  return <AdminDashboard />;
}
```

**Step 3: Commit**

```bash
git add src/app/admin/
git commit -m "feat: add ops dashboard UI at /admin with auto-refresh"
```

---

### Task 3: Add ADMIN_SECRET to Environment and Vercel Config

**Files:**
- Modify: `.env.example`

**Step 1: Add ADMIN_SECRET to .env.example**

Add this line to `.env.example`:

```
ADMIN_SECRET="your-admin-dashboard-secret"
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add ADMIN_SECRET to .env.example"
```

---

### Task 4: Run Tests, Push, Deploy to Vercel

**Step 1: Run full test suite**

```bash
npx jest --no-cache
```

Expected: All tests pass, no regressions.

**Step 2: Push to remote**

```bash
git push origin feat/b2b-api
```

**Step 3: Verify Vercel deploys**

The app is already connected to Vercel. Pushing will trigger a deployment. After deploy, verify:

1. Visit `https://<your-vercel-url>/admin`
2. Enter your ADMIN_SECRET
3. Dashboard should load with job data

**Step 4: Set ADMIN_SECRET in Vercel environment variables**

```bash
# In Vercel dashboard or via CLI:
# vercel env add ADMIN_SECRET
```
