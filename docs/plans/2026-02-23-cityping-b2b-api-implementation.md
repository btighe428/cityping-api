# CityPing B2B API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a read-only REST API layer to CityPing that serves pre-compiled NYC briefing data to B2B customers, authenticated via API keys.

**Architecture:** Fork the existing repo, add 4 Prisma models (ApiClient, ApiKey, ApiLog, CompiledBriefing), a compiler job that aggregates data every 15 minutes, a thin GET endpoint with auth middleware, and a developer dashboard for key management.

**Tech Stack:** Next.js 14 (App Router), Prisma ORM, PostgreSQL/Supabase, Tailwind CSS, Node.js crypto

**Design Doc:** `docs/plans/2026-02-23-cityping-b2b-api-design.md`

---

### Task 1: Fork Repository and Set Up Workspace

**Files:**
- None (git operations only)

**Step 1: Fork the repo on GitHub**

```bash
gh repo fork btighe428/cityping --clone=false --fork-name cityping-api
```

**Step 2: Clone the fork locally**

```bash
cd /Users/btighe
gh repo clone btighe428/cityping-api
cd cityping-api
```

**Step 3: Install dependencies**

```bash
npm install
```

**Step 4: Verify the project builds**

```bash
npx prisma generate
```

**Step 5: Commit baseline**

```bash
git checkout -b feat/b2b-api
git push -u origin feat/b2b-api
```

---

### Task 2: Add Prisma Schema — ApiClient and ApiKey Models

**Files:**
- Modify: `prisma/schema.prisma` (append after existing models)
- Test: `__tests__/api/api-key-generation.test.ts`

**Step 1: Write the failing test for API key generation utility**

Create `__tests__/api/api-key-generation.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/api/api-key-generation.test.ts --no-cache
```

Expected: FAIL — `Cannot find module '@/lib/api-keys'`

**Step 3: Write the API key generation utility**

Create `src/lib/api-keys.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

```bash
npx jest __tests__/api/api-key-generation.test.ts --no-cache
```

Expected: PASS (4 tests)

**Step 5: Add Prisma models to schema**

Append to `prisma/schema.prisma`:

```prisma
// ============================================================================
// B2B API — Clients, Keys, Logs, Compiled Briefings
// ============================================================================

/// Plan tier for API access rate limiting and billing.
enum ApiPlanTier {
  free       // 100 requests/day
  pro        // 10,000 requests/day
  enterprise // Unlimited

  @@map("api_plan_tier")
}

/// B2B API customer. Separate from B2C User model.
model ApiClient {
  id          String   @id @default(cuid())
  email       String   @unique
  companyName String?  @map("company_name")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz

  apiKeys ApiKey[]

  @@map("api_clients")
}

/// API key for B2B authentication.
/// Raw key shown once on creation; only SHA-256 hash stored.
model ApiKey {
  id          String      @id @default(cuid())
  hashedKey   String      @unique @map("hashed_key")
  keyPrefix   String      @map("key_prefix") // "sk_live_Ab..." for display
  apiClientId String      @map("api_client_id")
  name        String?     // User-friendly label like "Production Key"
  planTier    ApiPlanTier @default(free) @map("plan_tier")
  isActive    Boolean     @default(true) @map("is_active")
  lastUsedAt  DateTime?   @map("last_used_at") @db.Timestamptz
  createdAt   DateTime    @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime    @updatedAt @map("updated_at") @db.Timestamptz

  apiClient ApiClient @relation(fields: [apiClientId], references: [id], onDelete: Cascade)
  logs      ApiLog[]

  @@map("api_keys")
}

/// Request log for rate limiting and billing analytics.
model ApiLog {
  id             String   @id @default(cuid())
  apiKeyId       String   @map("api_key_id")
  endpoint       String   // "/api/v1/briefing"
  statusCode     Int      @map("status_code")
  responseTimeMs Int?     @map("response_time_ms")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz

  apiKey ApiKey @relation(fields: [apiKeyId], references: [id], onDelete: Cascade)

  @@index([apiKeyId, createdAt])
  @@index([createdAt])
  @@map("api_logs")
}

/// Pre-compiled API response payload.
/// Refreshed every 15 minutes by the compiler task.
model CompiledBriefing {
  id        String   @id @default(cuid())
  city      String   // "nyc"
  payload   Json     // Full JSONB briefing object
  version   String   @default("1.0") // Schema version
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([city, createdAt])
  @@map("compiled_briefings")
}
```

**Step 6: Push schema to database**

```bash
npx prisma db push
npx prisma generate
```

Expected: Schema synced, client regenerated.

**Step 7: Commit**

```bash
git add prisma/schema.prisma src/lib/api-keys.ts __tests__/api/api-key-generation.test.ts
git commit -m "feat: add B2B API schema (ApiClient, ApiKey, ApiLog, CompiledBriefing) and key generation utility"
```

---

### Task 3: Build Auth Middleware for API Routes

**Files:**
- Create: `src/lib/api-auth.ts`
- Test: `__tests__/lib/api-auth.test.ts`

**Step 1: Write the failing test for API auth**

Create `__tests__/lib/api-auth.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/lib/api-auth.test.ts --no-cache
```

Expected: FAIL — `Cannot find module '@/lib/api-auth'`

**Step 3: Write the auth middleware**

Create `src/lib/api-auth.ts`:

```typescript
import { createHash } from 'crypto';
import db from '@/lib/db';

const RATE_LIMITS: Record<string, number> = {
  free: 100,
  pro: 10_000,
  enterprise: -1, // unlimited
};

export async function validateApiKey(authHeader: string | null) {
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer (sk_live_.+)$/);
  if (!match) return null;

  const rawKey = match[1];
  const hashed = createHash('sha256').update(rawKey).digest('hex');

  const apiKey = await db.apiKey.findUnique({
    where: { hashedKey: hashed },
  });

  if (!apiKey || !apiKey.isActive) return null;

  // Update lastUsedAt (fire-and-forget)
  db.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return apiKey;
}

export async function checkRateLimit(
  apiKeyId: string,
  planTier: string
): Promise<{ allowed: boolean; remaining: number }> {
  const limit = RATE_LIMITS[planTier] ?? RATE_LIMITS.free;

  if (limit === -1) {
    return { allowed: true, remaining: -1 };
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const count = await db.apiLog.count({
    where: {
      apiKeyId,
      createdAt: { gte: todayStart },
    },
  });

  const remaining = Math.max(0, limit - count);
  return { allowed: count < limit, remaining };
}

export async function logApiRequest(
  apiKeyId: string,
  endpoint: string,
  statusCode: number,
  responseTimeMs?: number
) {
  await db.apiLog.create({
    data: { apiKeyId, endpoint, statusCode, responseTimeMs },
  });
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest __tests__/lib/api-auth.test.ts --no-cache
```

Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add src/lib/api-auth.ts __tests__/lib/api-auth.test.ts
git commit -m "feat: add API key auth middleware with rate limiting"
```

---

### Task 4: Build the Compiler Task — compile-nyc-briefing

**Files:**
- Create: `src/lib/compile-briefing.ts`
- Create: `src/app/api/jobs/compile-briefing/route.ts`
- Test: `__tests__/api/jobs/compile-briefing.test.ts`

**Step 1: Write the failing test**

Create `__tests__/api/jobs/compile-briefing.test.ts`:

```typescript
import { compileNycBriefing } from '@/lib/compile-briefing';

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: {
    alertEvent: { findMany: jest.fn().mockResolvedValue([]) },
    cityEvent: { findMany: jest.fn().mockResolvedValue([]) },
    newsArticle: { findMany: jest.fn().mockResolvedValue([]) },
    suspensionEvent: { findMany: jest.fn().mockResolvedValue([]) },
    airQualityReading: { findMany: jest.fn().mockResolvedValue([]) },
    serviceAlert: { findMany: jest.fn().mockResolvedValue([]) },
    diningDeal: { findMany: jest.fn().mockResolvedValue([]) },
    parkEvent: { findMany: jest.fn().mockResolvedValue([]) },
    compiledBriefing: { create: jest.fn().mockResolvedValue({ id: 'test' }) },
  },
}));

describe('compileNycBriefing', () => {
  it('returns a payload with all expected top-level keys', async () => {
    const result = await compileNycBriefing();
    expect(result).toHaveProperty('city', 'nyc');
    expect(result).toHaveProperty('version', '1.0');
    expect(result).toHaveProperty('generatedAt');
    expect(result).toHaveProperty('transit');
    expect(result).toHaveProperty('parking');
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('dining');
    expect(result).toHaveProperty('news');
    expect(result).toHaveProperty('serviceAlerts');
    expect(result).toHaveProperty('parks');
    expect(result).toHaveProperty('airQuality');
  });

  it('saves the compiled briefing to the database', async () => {
    const db = (await import('@/lib/db')).default;
    await compileNycBriefing();
    expect(db.compiledBriefing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        city: 'nyc',
        version: '1.0',
        payload: expect.any(Object),
      }),
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/api/jobs/compile-briefing.test.ts --no-cache
```

Expected: FAIL — `Cannot find module '@/lib/compile-briefing'`

**Step 3: Write the compiler**

Create `src/lib/compile-briefing.ts`:

```typescript
import db from '@/lib/db';

export async function compileNycBriefing() {
  const now = new Date();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Query all data sources in parallel
  const [
    transitAlerts,
    cityEvents,
    newsArticles,
    suspensionEvents,
    airQuality,
    serviceAlerts,
    diningDeals,
    parkEvents,
  ] = await Promise.all([
    db.alertEvent.findMany({
      where: {
        source: { module: { id: 'transit' } },
        createdAt: { gte: todayStart },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.cityEvent.findMany({
      where: {
        status: 'published',
        startsAt: { gte: todayStart, lte: weekFromNow },
      },
      orderBy: [{ insiderScore: 'desc' }, { startsAt: 'asc' }],
      take: 20,
    }),
    db.newsArticle.findMany({
      where: {
        isSelected: true,
        curatedFor: todayStart,
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    }),
    db.suspensionEvent.findMany({
      where: {
        date: { gte: todayStart },
      },
      orderBy: { date: 'asc' },
      take: 10,
      include: { city: true },
    }),
    db.airQualityReading.findMany({
      where: {
        forecastDate: todayStart,
      },
      orderBy: { aqi: 'desc' },
      take: 5,
    }),
    db.serviceAlert.findMany({
      where: {
        status: { not: 'Closed' },
        severity: { in: ['high', 'critical'] },
      },
      orderBy: { createdDate: 'desc' },
      take: 10,
    }),
    db.diningDeal.findMany({
      where: {
        isActive: true,
        OR: [
          { endDate: null },
          { endDate: { gte: todayStart } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.parkEvent.findMany({
      where: {
        date: { gte: todayStart, lte: weekFromNow },
      },
      orderBy: { date: 'asc' },
      take: 10,
    }),
  ]);

  // Check if ASP is suspended today
  const todaySuspension = suspensionEvents.find(
    (e) => e.date.toISOString().split('T')[0] === todayStart.toISOString().split('T')[0]
  );

  const payload = {
    city: 'nyc',
    generatedAt: now.toISOString(),
    version: '1.0',
    transit: {
      alerts: transitAlerts.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        neighborhoods: a.neighborhoods,
        startsAt: a.startsAt?.toISOString() ?? null,
        endsAt: a.endsAt?.toISOString() ?? null,
        metadata: a.metadata,
      })),
    },
    parking: {
      aspSuspended: !!todaySuspension,
      reason: todaySuspension?.title ?? null,
      upcoming: suspensionEvents.map((e) => ({
        date: e.date.toISOString().split('T')[0],
        reason: e.summary,
      })),
    },
    events: {
      featured: cityEvents.filter((e) => e.insiderScore >= 70).slice(0, 5).map(formatCityEvent),
      today: cityEvents.filter((e) => {
        const eventDate = e.startsAt?.toISOString().split('T')[0];
        const today = todayStart.toISOString().split('T')[0];
        return eventDate === today;
      }).map(formatCityEvent),
      thisWeek: cityEvents.map(formatCityEvent),
    },
    dining: diningDeals.map((d) => ({
      id: d.id,
      restaurant: d.restaurant,
      neighborhood: d.neighborhood,
      cuisine: d.cuisine,
      dealType: d.dealType,
      title: d.title,
      description: d.description,
      price: d.price,
      startDate: d.startDate?.toISOString().split('T')[0] ?? null,
      endDate: d.endDate?.toISOString().split('T')[0] ?? null,
      url: d.url,
    })),
    news: {
      topStories: newsArticles.map((n) => ({
        id: n.id,
        title: n.title,
        source: n.source,
        summary: n.summary,
        nycAngle: n.nycAngle,
        url: n.url,
        publishedAt: n.publishedAt.toISOString(),
      })),
    },
    airQuality: airQuality.map((a) => ({
      zipCode: a.zipCode,
      aqi: a.aqi,
      category: a.category,
      pollutant: a.pollutant,
      isAlert: a.isAlert,
    })),
    serviceAlerts: serviceAlerts.map((s) => ({
      id: s.id,
      type: s.complaintType,
      descriptor: s.descriptor,
      address: s.address,
      borough: s.borough,
      severity: s.severity,
      status: s.status,
    })),
    parks: parkEvents.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      parkName: p.parkName,
      borough: p.borough,
      date: p.date.toISOString().split('T')[0],
      startTime: p.startTime,
      endTime: p.endTime,
      category: p.category,
      isFree: p.isFree,
      url: p.url,
    })),
  };

  // Save to database
  await db.compiledBriefing.create({
    data: {
      city: 'nyc',
      version: '1.0',
      payload,
    },
  });

  return payload;
}

function formatCityEvent(e: {
  id: string;
  title: string;
  description: string | null;
  category: string;
  startsAt: Date | null;
  endsAt: Date | null;
  venue: string | null;
  neighborhood: string | null;
  borough: string | null;
  insiderScore: number;
  scarcityScore: number;
  tags: string[];
}) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    category: e.category,
    startsAt: e.startsAt?.toISOString() ?? null,
    endsAt: e.endsAt?.toISOString() ?? null,
    venue: e.venue,
    neighborhood: e.neighborhood,
    borough: e.borough,
    insiderScore: e.insiderScore,
    scarcityScore: e.scarcityScore,
    tags: e.tags,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest __tests__/api/jobs/compile-briefing.test.ts --no-cache
```

Expected: PASS (2 tests)

**Step 5: Create the cron API route**

Create `src/app/api/jobs/compile-briefing/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { compileNycBriefing } from '@/lib/compile-briefing';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = await compileNycBriefing();
    return NextResponse.json({
      success: true,
      city: payload.city,
      generatedAt: payload.generatedAt,
    });
  } catch (error) {
    console.error('Compile briefing failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

**Step 6: Add cron schedule to vercel.json**

Modify `vercel.json` — add to the existing `crons` array:

```json
{
  "path": "/api/jobs/compile-briefing",
  "schedule": "*/15 * * * *"
}
```

**Step 7: Commit**

```bash
git add src/lib/compile-briefing.ts src/app/api/jobs/compile-briefing/route.ts __tests__/api/jobs/compile-briefing.test.ts vercel.json
git commit -m "feat: add compiled briefing task — aggregates all data sources into JSONB payload every 15 min"
```

---

### Task 5: Build the Core GET /api/v1/briefing Endpoint

**Files:**
- Create: `src/app/api/v1/briefing/route.ts`
- Test: `__tests__/api/v1/briefing.test.ts`

**Step 1: Write the failing test**

Create `__tests__/api/v1/briefing.test.ts`:

```typescript
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
  beforeEach(() => jest.clearAllMocks());

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
    });

    await GET(makeRequest({ authorization: 'Bearer sk_live_test' }, '?city=nyc'));
    expect(logApiRequest).toHaveBeenCalledWith('key1', '/api/v1/briefing', 200, expect.any(Number));
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/api/v1/briefing.test.ts --no-cache
```

Expected: FAIL — `Cannot find module '@/app/api/v1/briefing/route'`

**Step 3: Write the route handler**

Create `src/app/api/v1/briefing/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey, checkRateLimit, logApiRequest } from '@/lib/api-auth';
import db from '@/lib/db';

export async function GET(req: NextRequest) {
  const start = Date.now();
  const authHeader = req.headers.get('authorization');

  // 1. Authenticate
  const apiKey = await validateApiKey(authHeader);
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or missing API key. Use Authorization: Bearer sk_live_...' },
      { status: 401 }
    );
  }

  // 2. Rate limit
  const { allowed, remaining } = await checkRateLimit(apiKey.id, apiKey.planTier);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too Many Requests', message: 'Daily rate limit exceeded. Upgrade your plan for higher limits.' },
      {
        status: 429,
        headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': '86400' },
      }
    );
  }

  // 3. Get city parameter (default: nyc)
  const city = req.nextUrl.searchParams.get('city') ?? 'nyc';

  // 4. Fetch latest compiled briefing
  const briefing = await db.compiledBriefing.findFirst({
    where: { city },
    orderBy: { createdAt: 'desc' },
  });

  const responseTimeMs = Date.now() - start;

  if (!briefing) {
    logApiRequest(apiKey.id, '/api/v1/briefing', 404, responseTimeMs).catch(() => {});
    return NextResponse.json(
      { error: 'Not Found', message: `No briefing available for city: ${city}` },
      { status: 404 }
    );
  }

  // 5. Log and respond
  logApiRequest(apiKey.id, '/api/v1/briefing', 200, responseTimeMs).catch(() => {});

  return NextResponse.json(
    {
      data: briefing.payload,
      meta: {
        city,
        generatedAt: briefing.createdAt.toISOString(),
        version: briefing.version,
      },
    },
    {
      status: 200,
      headers: {
        'X-RateLimit-Remaining': String(remaining),
        'Cache-Control': 'public, max-age=900', // 15 min cache
      },
    }
  );
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest __tests__/api/v1/briefing.test.ts --no-cache
```

Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/app/api/v1/briefing/route.ts __tests__/api/v1/briefing.test.ts
git commit -m "feat: add GET /api/v1/briefing endpoint with auth, rate limiting, and request logging"
```

---

### Task 6: Build the Developer Dashboard — API Key Management

**Files:**
- Create: `src/app/dashboard/api-keys/page.tsx`
- Create: `src/app/dashboard/api-keys/actions.ts`

**Step 1: Write the server actions**

Create `src/app/dashboard/api-keys/actions.ts`:

```typescript
'use server';

import { getUserFromSession } from '@/lib/auth';
import { generateApiKey } from '@/lib/api-keys';
import db from '@/lib/db';

export async function createApiKey(name?: string) {
  const user = await getUserFromSession();
  if (!user) throw new Error('Unauthorized');

  // Find or create ApiClient from user
  let apiClient = await db.apiClient.findUnique({
    where: { email: user.email },
  });

  if (!apiClient) {
    apiClient = await db.apiClient.create({
      data: { email: user.email },
    });
  }

  const { raw, hashed, prefix } = generateApiKey();

  await db.apiKey.create({
    data: {
      hashedKey: hashed,
      keyPrefix: prefix,
      apiClientId: apiClient.id,
      name: name || 'Default Key',
    },
  });

  // Return raw key — shown to user exactly once
  return { key: raw, prefix };
}

export async function listApiKeys() {
  const user = await getUserFromSession();
  if (!user) return [];

  const apiClient = await db.apiClient.findUnique({
    where: { email: user.email },
    include: {
      apiKeys: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return apiClient?.apiKeys.map((k) => ({
    id: k.id,
    prefix: k.keyPrefix,
    name: k.name,
    planTier: k.planTier,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  })) ?? [];
}

export async function getMonthlyUsage() {
  const user = await getUserFromSession();
  if (!user) return 0;

  const apiClient = await db.apiClient.findUnique({
    where: { email: user.email },
    include: { apiKeys: { select: { id: true } } },
  });

  if (!apiClient) return 0;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  return db.apiLog.count({
    where: {
      apiKeyId: { in: apiClient.apiKeys.map((k) => k.id) },
      createdAt: { gte: monthStart },
    },
  });
}

export async function revokeApiKey(keyId: string) {
  const user = await getUserFromSession();
  if (!user) throw new Error('Unauthorized');

  const apiClient = await db.apiClient.findUnique({
    where: { email: user.email },
  });
  if (!apiClient) throw new Error('Not found');

  await db.apiKey.update({
    where: { id: keyId, apiClientId: apiClient.id },
    data: { isActive: false },
  });
}
```

**Step 2: Write the dashboard page**

Create `src/app/dashboard/api-keys/page.tsx`:

```tsx
import { listApiKeys, getMonthlyUsage, createApiKey, revokeApiKey } from './actions';
import { ApiKeysClient } from './client';

export default async function ApiKeysPage() {
  const [keys, usage] = await Promise.all([listApiKeys(), getMonthlyUsage()]);

  return (
    <div className="min-h-screen bg-[#FAF8F5]">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold text-[#2C2C2C] mb-2">
          API Keys
        </h1>
        <p className="text-[#6B6B6B] mb-8">
          Manage your CityPing API keys. Use these to authenticate requests to
          the <code className="bg-[#F0EDE8] px-1.5 py-0.5 rounded text-sm">/api/v1/briefing</code> endpoint.
        </p>

        <div className="bg-white rounded-xl border border-[#E8E4DF] p-6 mb-8">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-[#6B6B6B]">API Calls This Month</span>
            <span className="text-2xl font-semibold text-[#2C2C2C]">
              {usage.toLocaleString()}
            </span>
          </div>
        </div>

        <ApiKeysClient
          initialKeys={keys}
          createApiKey={createApiKey}
          revokeApiKey={revokeApiKey}
        />
      </div>
    </div>
  );
}
```

**Step 3: Write the client component**

Create `src/app/dashboard/api-keys/client.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

type ApiKeyInfo = {
  id: string;
  prefix: string;
  name: string | null;
  planTier: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export function ApiKeysClient({
  initialKeys,
  createApiKey,
  revokeApiKey,
}: {
  initialKeys: ApiKeyInfo[];
  createApiKey: (name?: string) => Promise<{ key: string; prefix: string }>;
  revokeApiKey: (keyId: string) => Promise<void>;
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    startTransition(async () => {
      const result = await createApiKey();
      setNewKey(result.key);
      setCopied(false);
      // Refresh key list
      setKeys((prev) => [
        {
          id: 'new',
          prefix: result.prefix,
          name: 'Default Key',
          planTier: 'free',
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    });
  };

  const handleCopy = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = (keyId: string) => {
    startTransition(async () => {
      await revokeApiKey(keyId);
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    });
  };

  return (
    <div>
      {/* New key banner */}
      {newKey && (
        <div className="bg-[#F0EDE8] border border-[#D4CFC7] rounded-xl p-6 mb-6">
          <p className="text-sm font-medium text-[#2C2C2C] mb-2">
            Your new API key (copy it now — you won&apos;t see it again):
          </p>
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-white px-4 py-2 rounded-lg font-mono text-sm text-[#2C2C2C] border border-[#E8E4DF] overflow-x-auto">
              {newKey}
            </code>
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-[#2C2C2C] text-white text-sm rounded-lg hover:bg-[#404040] transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleCreate}
        disabled={isPending}
        className="mb-8 px-5 py-2.5 bg-[#2C2C2C] text-white text-sm font-medium rounded-lg hover:bg-[#404040] transition-colors disabled:opacity-50"
      >
        {isPending ? 'Generating...' : 'Generate New Key'}
      </button>

      {/* Key list */}
      <div className="space-y-3">
        {keys.length === 0 && (
          <p className="text-[#6B6B6B] text-sm">No API keys yet. Generate one to get started.</p>
        )}
        {keys.map((key) => (
          <div
            key={key.id}
            className="bg-white rounded-xl border border-[#E8E4DF] p-4 flex items-center justify-between"
          >
            <div>
              <p className="font-mono text-sm text-[#2C2C2C]">
                {key.prefix}...
              </p>
              <p className="text-xs text-[#6B6B6B] mt-1">
                {key.name} &middot; {key.planTier} &middot; Created{' '}
                {new Date(key.createdAt).toLocaleDateString()}
                {key.lastUsedAt &&
                  ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
              </p>
            </div>
            <button
              onClick={() => handleRevoke(key.id)}
              disabled={isPending}
              className="text-sm text-red-600 hover:text-red-800 transition-colors disabled:opacity-50"
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Verify it builds**

```bash
npx next build
```

Expected: Build succeeds (or at least no TypeScript errors in the new files).

**Step 5: Commit**

```bash
git add src/app/dashboard/api-keys/
git commit -m "feat: add developer dashboard for API key management"
```

---

### Task 7: Generate OpenAPI Specification

**Files:**
- Create: `public/openapi.yaml`

**Step 1: Write the OpenAPI spec**

Create `public/openapi.yaml`:

```yaml
openapi: '3.0.3'
info:
  title: CityPing API
  description: |
    Real-time, AI-curated city intelligence for NYC. CityPing aggregates data from 14+ municipal
    and cultural sources — transit alerts, parking suspensions, weather, events, dining, news,
    and more — into a single, unified JSON briefing updated every 15 minutes.

    **Built for:** Travel apps, corporate concierge platforms, hospitality dashboards,
    relocation services, and smart city integrations.
  version: '1.0.0'
  contact:
    name: CityPing API Support
    url: https://cityping.com
    email: api@cityping.com

servers:
  - url: https://api.cityping.com
    description: Production
  - url: http://localhost:3000
    description: Local Development

security:
  - BearerAuth: []

paths:
  /api/v1/briefing:
    get:
      operationId: getBriefing
      summary: Get city briefing
      description: |
        Returns the latest pre-compiled city briefing as a single JSON object.
        Data is refreshed every 15 minutes from 14+ NYC data sources including
        MTA transit alerts, alternate side parking status, weather/air quality,
        curated events, dining deals, breaking news, and service alerts.

        Response times are typically under 200ms.
      tags:
        - Briefing
      parameters:
        - name: city
          in: query
          description: City identifier. Currently only `nyc` is supported.
          required: false
          schema:
            type: string
            default: nyc
            enum: [nyc]
      responses:
        '200':
          description: Latest city briefing
          headers:
            X-RateLimit-Remaining:
              description: Number of requests remaining in current billing period
              schema:
                type: integer
            Cache-Control:
              description: Cache directive (15 minute TTL)
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: '#/components/schemas/Briefing'
                  meta:
                    $ref: '#/components/schemas/Meta'
              example:
                data:
                  city: nyc
                  generatedAt: '2026-02-23T15:00:00.000Z'
                  version: '1.0'
                  transit:
                    alerts:
                      - id: clx1abc
                        title: 'A/C/E: Delays due to signal problems'
                        body: Expect 10-15 minute delays on A, C, and E trains in both directions due to signal problems at 14 St-Penn Station.
                        neighborhoods: ['Chelsea', 'Midtown']
                        startsAt: '2026-02-23T08:30:00.000Z'
                        endsAt: null
                  parking:
                    aspSuspended: true
                    reason: "Presidents' Day"
                    upcoming:
                      - date: '2026-02-23'
                        reason: "Presidents' Day"
                      - date: '2026-03-17'
                        reason: "St. Patrick's Day"
                  events:
                    featured:
                      - id: clx2def
                        title: 'Brooklyn Flea Returns to Williamsburg'
                        description: 'The OG Brooklyn Flea market is back at its Williamsburg waterfront location for the 2026 season.'
                        category: culture
                        startsAt: '2026-02-23T10:00:00.000Z'
                        venue: Brooklyn Flea Williamsburg
                        neighborhood: Williamsburg
                        borough: brooklyn
                        insiderScore: 85
                        scarcityScore: 40
                        tags: ['market', 'vintage', 'outdoor']
                    today: []
                    thisWeek: []
                  dining:
                    - id: clx3ghi
                      restaurant: Via Carota
                      neighborhood: West Village
                      cuisine: Italian
                      dealType: special
                      title: 'Winter Truffle Menu at Via Carota'
                      description: 'Limited-run 4-course truffle tasting menu through March.'
                      price: '$95/person'
                      url: 'https://example.com'
                  news:
                    topStories:
                      - id: clx4jkl
                        title: 'Congestion Pricing Revenue Exceeds Projections in First Month'
                        source: gothamist
                        summary: 'NYC congestion pricing has generated $120M in its first full month, 15% above MTA forecasts.'
                        nycAngle: 'Good news for transit riders — this money funds subway improvements and new bus routes.'
                        url: 'https://gothamist.com/example'
                        publishedAt: '2026-02-23T06:00:00.000Z'
                  airQuality:
                    - zipCode: '10001'
                      aqi: 42
                      category: Good
                      pollutant: PM2.5
                      isAlert: false
                  serviceAlerts:
                    - id: clx5mno
                      type: Water Outage
                      descriptor: Scheduled maintenance
                      address: '123 Broadway'
                      borough: Manhattan
                      severity: high
                      status: Open
                  parks:
                    - id: clx6pqr
                      name: 'Free Yoga in Central Park'
                      description: 'All-levels yoga class on the Great Lawn'
                      parkName: Central Park
                      borough: Manhattan
                      date: '2026-02-23'
                      startTime: '09:00'
                      endTime: '10:00'
                      category: Fitness
                      isFree: true
                meta:
                  city: nyc
                  generatedAt: '2026-02-23T15:00:00.000Z'
                  version: '1.0'
        '401':
          description: Unauthorized — missing or invalid API key
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
              example:
                error: Unauthorized
                message: 'Invalid or missing API key. Use Authorization: Bearer sk_live_...'
        '404':
          description: No briefing available for the requested city
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '429':
          description: Rate limit exceeded
          headers:
            X-RateLimit-Remaining:
              schema:
                type: integer
            Retry-After:
              description: Seconds until rate limit resets
              schema:
                type: integer
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
              example:
                error: Too Many Requests
                message: Daily rate limit exceeded. Upgrade your plan for higher limits.
        '500':
          description: Internal server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      description: |
        API key with `sk_live_` prefix. Generate keys from your developer dashboard.

        Example: `Authorization: Bearer sk_live_abc123def456...`

  schemas:
    Meta:
      type: object
      properties:
        city:
          type: string
        generatedAt:
          type: string
          format: date-time
        version:
          type: string

    Error:
      type: object
      properties:
        error:
          type: string
        message:
          type: string

    Briefing:
      type: object
      properties:
        city:
          type: string
          description: City identifier
        generatedAt:
          type: string
          format: date-time
          description: When this briefing was compiled
        version:
          type: string
          description: API schema version
        transit:
          type: object
          properties:
            alerts:
              type: array
              items:
                $ref: '#/components/schemas/TransitAlert'
        parking:
          type: object
          properties:
            aspSuspended:
              type: boolean
              description: Whether alternate side parking is suspended today
            reason:
              type: string
              nullable: true
            upcoming:
              type: array
              items:
                type: object
                properties:
                  date:
                    type: string
                    format: date
                  reason:
                    type: string
        events:
          type: object
          properties:
            featured:
              type: array
              items:
                $ref: '#/components/schemas/CityEvent'
            today:
              type: array
              items:
                $ref: '#/components/schemas/CityEvent'
            thisWeek:
              type: array
              items:
                $ref: '#/components/schemas/CityEvent'
        dining:
          type: array
          items:
            $ref: '#/components/schemas/DiningDeal'
        news:
          type: object
          properties:
            topStories:
              type: array
              items:
                $ref: '#/components/schemas/NewsStory'
        airQuality:
          type: array
          items:
            $ref: '#/components/schemas/AirQualityReading'
        serviceAlerts:
          type: array
          items:
            $ref: '#/components/schemas/ServiceAlert'
        parks:
          type: array
          items:
            $ref: '#/components/schemas/ParkEvent'

    TransitAlert:
      type: object
      properties:
        id:
          type: string
        title:
          type: string
        body:
          type: string
          nullable: true
        neighborhoods:
          type: array
          items:
            type: string
        startsAt:
          type: string
          format: date-time
          nullable: true
        endsAt:
          type: string
          format: date-time
          nullable: true
        metadata:
          type: object

    CityEvent:
      type: object
      properties:
        id:
          type: string
        title:
          type: string
        description:
          type: string
          nullable: true
        category:
          type: string
          enum: [culture, sports, food, civic, weather, transit, seasonal, local]
        startsAt:
          type: string
          format: date-time
          nullable: true
        endsAt:
          type: string
          format: date-time
          nullable: true
        venue:
          type: string
          nullable: true
        neighborhood:
          type: string
          nullable: true
        borough:
          type: string
          nullable: true
        insiderScore:
          type: integer
          minimum: 0
          maximum: 100
          description: AI-generated insider relevance score
        scarcityScore:
          type: integer
          minimum: 0
          maximum: 100
        tags:
          type: array
          items:
            type: string

    DiningDeal:
      type: object
      properties:
        id:
          type: string
        restaurant:
          type: string
        neighborhood:
          type: string
          nullable: true
        cuisine:
          type: string
          nullable: true
        dealType:
          type: string
          enum: [prix-fixe, opening, special, deal]
        title:
          type: string
        description:
          type: string
          nullable: true
        price:
          type: string
          nullable: true
        startDate:
          type: string
          format: date
          nullable: true
        endDate:
          type: string
          format: date
          nullable: true
        url:
          type: string

    NewsStory:
      type: object
      properties:
        id:
          type: string
        title:
          type: string
        source:
          type: string
        summary:
          type: string
          nullable: true
        nycAngle:
          type: string
          nullable: true
          description: '"Why it matters" local commentary'
        url:
          type: string
        publishedAt:
          type: string
          format: date-time

    AirQualityReading:
      type: object
      properties:
        zipCode:
          type: string
        aqi:
          type: integer
          minimum: 0
          maximum: 500
        category:
          type: string
          enum: [Good, Moderate, 'Unhealthy for Sensitive Groups', Unhealthy, 'Very Unhealthy', Hazardous]
        pollutant:
          type: string
          nullable: true
        isAlert:
          type: boolean

    ServiceAlert:
      type: object
      properties:
        id:
          type: string
        type:
          type: string
        descriptor:
          type: string
          nullable: true
        address:
          type: string
          nullable: true
        borough:
          type: string
          nullable: true
        severity:
          type: string
          enum: [low, medium, high, critical]
        status:
          type: string

    ParkEvent:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        description:
          type: string
          nullable: true
        parkName:
          type: string
        borough:
          type: string
          nullable: true
        date:
          type: string
          format: date
        startTime:
          type: string
          nullable: true
        endTime:
          type: string
          nullable: true
        category:
          type: string
          nullable: true
        isFree:
          type: boolean
        url:
          type: string
          nullable: true
```

**Step 2: Validate the YAML syntax**

```bash
npx yaml public/openapi.yaml
```

Or just check it parses:

```bash
node -e "const fs = require('fs'); const yaml = require('next/dist/compiled/js-yaml'); yaml.load(fs.readFileSync('public/openapi.yaml', 'utf8')); console.log('Valid YAML')"
```

**Step 3: Commit**

```bash
git add public/openapi.yaml
git commit -m "docs: add OpenAPI 3.0 specification for GET /api/v1/briefing"
```

---

### Task 8: Run All Tests and Create PR

**Step 1: Run full test suite**

```bash
npx jest --no-cache
```

Expected: All new tests pass; existing tests unaffected (Rule 1 & 2 compliance).

**Step 2: Verify build**

```bash
npx next build
```

Expected: Build succeeds.

**Step 3: Push and create PR**

```bash
git push origin feat/b2b-api
gh pr create \
  --title "feat: B2B API Data-as-a-Service layer" \
  --body "## Summary
- Add ApiClient, ApiKey, ApiLog, CompiledBriefing Prisma models
- Add compiled briefing task (runs every 15 min)
- Add GET /api/v1/briefing endpoint with Bearer auth and rate limiting
- Add developer dashboard for API key management
- Add OpenAPI 3.0 spec

## Rules Followed
- Existing scraping/processing tasks: UNTOUCHED
- Resend email logic: UNTOUCHED
- New code is strictly additive (read-only API layer)

## Test Plan
- [ ] Run npx prisma db push against dev database
- [ ] Trigger compile-briefing manually, verify JSONB in Supabase
- [ ] Generate API key from dashboard, test with curl
- [ ] Verify rate limiting works (101st request returns 429)
- [ ] Validate openapi.yaml in Mintlify"
```
