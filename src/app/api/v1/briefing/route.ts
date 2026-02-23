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
