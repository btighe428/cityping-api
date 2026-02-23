import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getSystemHealth } from "@/lib/job-monitor";

// ---------------------------------------------------------------------------
// Job category mapping
// ---------------------------------------------------------------------------

const JOB_CATEGORIES: Record<string, string> = {
  "ingest-mta-alerts": "scraper",
  "ingest-nyc-events": "scraper",
  "ingest-sample-sales": "scraper",
  "ingest-housing-lotteries": "scraper",
  "ingest-news": "scraper",
  "scrape-311": "scraper",
  "scrape-air-quality": "scraper",
  "scrape-dining": "scraper",
  "scrape-parks": "scraper",
  "scrape-events": "scraper",
  "scrape-streets": "scraper",
  "scrape-emergency": "scraper",

  "email-timeslot-morning": "email",
  "email-timeslot-noon": "email",
  "email-timeslot-evening": "email",
  "send-daily-pulse": "email",
  "send-daily-digest": "email",
  "send-day-ahead": "email",
  "send-weekly-digest": "email",
  "send-reminders": "email",
  "send-notifications": "email",
  "send-monthly-recap": "email",

  "embed-content": "processing",
  "curate-news": "processing",
  "orchestrate-data": "processing",
  "compile-briefing": "processing",
  "preflight-check": "processing",
  "aggregate-feedback": "processing",
};

function categoryFor(jobName: string): string {
  return JOB_CATEGORIES[jobName] ?? "other";
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  return token === secret;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Fire all queries in parallel
  const [
    health,
    emailByStatus,
    emailByType,
    apiCallsToday,
    apiCallsMonth,
    topKeysRaw,
    latestBriefing,
    recentFailures,
    lastRunDetails,
  ] = await Promise.all([
    // System health from job monitor
    getSystemHealth(),

    // Email stats by status today
    db.emailOutbox.groupBy({
      by: ["status"],
      _count: { id: true },
      where: { createdAt: { gte: todayStart } },
    }),

    // Email stats by type today
    db.emailOutbox.groupBy({
      by: ["emailType"],
      _count: { id: true },
      where: { createdAt: { gte: todayStart } },
    }),

    // API calls today
    db.apiLog.count({
      where: { createdAt: { gte: todayStart } },
    }),

    // API calls this month
    db.apiLog.count({
      where: { createdAt: { gte: monthStart } },
    }),

    // Top 3 API keys by usage today
    db.apiLog.groupBy({
      by: ["apiKeyId"],
      _count: { id: true },
      where: { createdAt: { gte: todayStart } },
      orderBy: { _count: { id: "desc" } },
      take: 3,
    }),

    // Latest compiled briefing
    db.compiledBriefing.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),

    // Recent failures (last 10)
    db.jobRun.findMany({
      where: { status: "failed" },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        jobName: true,
        errorMessage: true,
        startedAt: true,
        durationMs: true,
      },
    }),

    // Last run per job (for duration / items)
    db.jobRun.findMany({
      distinct: ["jobName"],
      orderBy: { startedAt: "desc" },
      select: {
        jobName: true,
        durationMs: true,
        itemsProcessed: true,
        itemsFailed: true,
      },
    }),
  ]);

  // --- Resolve API key prefixes for topKeys ---
  const apiKeyIds = topKeysRaw
    .map((k: { apiKeyId: string | null }) => k.apiKeyId)
    .filter(Boolean) as string[];

  const apiKeys =
    apiKeyIds.length > 0
      ? await db.apiKey.findMany({
          where: { id: { in: apiKeyIds } },
          select: { id: true, keyPrefix: true },
        })
      : [];

  const prefixMap = new Map(apiKeys.map((k: { id: string; keyPrefix: string }) => [k.id, k.keyPrefix]));

  const topKeys = topKeysRaw.map(
    (k: { apiKeyId: string | null; _count: { id: number } }) => ({
      prefix: prefixMap.get(k.apiKeyId ?? "") ?? k.apiKeyId ?? "unknown",
      calls: k._count.id,
    })
  );

  // --- Build last-run lookup ---
  const lastRunMap = new Map(
    lastRunDetails.map(
      (r: {
        jobName: string;
        durationMs: number | null;
        itemsProcessed: number | null;
        itemsFailed: number | null;
      }) => [r.jobName, r]
    )
  );

  // --- Build summary ---
  const summary = {
    totalJobs: health.jobs.length,
    healthy: health.jobs.filter((j) => j.status === "healthy").length,
    warning: health.jobs.filter((j) => j.status === "warning").length,
    critical: health.jobs.filter((j) => j.status === "critical").length,
    unknown: health.jobs.filter((j) => j.status === "unknown").length,
  };

  // --- Build enriched jobs list ---
  const jobs = health.jobs.map((j) => {
    const run = lastRunMap.get(j.jobName) as
      | {
          durationMs: number | null;
          itemsProcessed: number | null;
          itemsFailed: number | null;
        }
      | undefined;
    return {
      name: j.jobName,
      displayName: j.displayName,
      category: categoryFor(j.jobName),
      status: j.status,
      lastRun: j.lastRun,
      lastStatus: j.lastStatus,
      expectedFrequency: j.expectedFrequency,
      missedRuns: j.missedRuns,
      consecutiveFailures: j.consecutiveFailures,
      durationMs: run?.durationMs ?? null,
      itemsProcessed: run?.itemsProcessed ?? null,
      itemsFailed: run?.itemsFailed ?? null,
    };
  });

  // --- Build email section ---
  const emailStatusMap = new Map(
    emailByStatus.map(
      (e: { status: string; _count: { id: number } }) => [e.status, e._count.id]
    )
  );

  const emailTypeMap: Record<string, number> = {};
  for (const e of emailByType as { emailType: string; _count: { id: number } }[]) {
    emailTypeMap[e.emailType] = e._count.id;
  }

  const email = {
    today: {
      sent: emailStatusMap.get("sent") ?? 0,
      failed: emailStatusMap.get("failed") ?? 0,
      pending: emailStatusMap.get("pending") ?? 0,
      skipped: emailStatusMap.get("skipped") ?? 0,
    },
    byType: emailTypeMap,
  };

  // --- Build API section ---
  const latestBriefingAgeMin = latestBriefing
    ? Math.round(
        (now.getTime() - new Date(latestBriefing.createdAt).getTime()) /
          60_000
      )
    : null;

  const api = {
    callsToday: apiCallsToday,
    callsThisMonth: apiCallsMonth,
    latestBriefingAgeMin,
    topKeys,
  };

  // --- Response ---
  return NextResponse.json({
    status: health.status,
    updatedAt: now.toISOString(),
    summary,
    jobs,
    email,
    api,
    recentFailures: recentFailures.map(
      (f: {
        jobName: string;
        errorMessage: string | null;
        startedAt: Date;
        durationMs: number | null;
      }) => ({
        jobName: f.jobName,
        errorMessage: f.errorMessage,
        startedAt: f.startedAt,
        durationMs: f.durationMs,
      })
    ),
  });
  } catch (error) {
    console.error("[admin/dashboard] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
