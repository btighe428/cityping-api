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
