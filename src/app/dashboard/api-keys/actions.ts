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
