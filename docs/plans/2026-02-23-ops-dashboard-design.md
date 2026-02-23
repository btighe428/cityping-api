# CityPing Ops Dashboard — Design Document

**Date:** 2026-02-23
**Status:** Approved

## Overview

Full operational dashboard inside the existing cityping-api Next.js app at `/admin`. Visualizes all 31 cron jobs, scrapers, email delivery, B2B API usage, and data pipeline health. Auto-refreshes every 30 seconds via client-side polling.

## Architecture

- New API route: `GET /api/admin/dashboard` — queries Prisma directly, returns structured JSON
- New page: `/admin` — React client component with 30s polling
- Auth: `ADMIN_SECRET` env var checked via Authorization header
- No new dependencies — Prisma queries + Tailwind CSS + vanilla React

## Dashboard Sections

### 1. System Health Banner
- Overall status: healthy / degraded / critical
- Counts: total jobs, healthy, warning, critical
- Last updated timestamp

### 2. Job Pipeline Grid
Jobs grouped by category, each showing:
- Name and display name
- Status indicator (green/yellow/red dot)
- Last run time (relative, e.g., "2 min ago")
- Duration of last run
- Items processed / failed
- Missed runs count

Categories:
- **Scrapers & Ingestion** (14): MTA alerts, news tiers, 311, air quality, dining, parks, events, streets, emergency, sample sales, housing, embed-content
- **Email Delivery** (6): email-router (morning/noon/evening), daily-digest, daily-pulse, weekly-digest
- **Data Processing** (5): orchestrate-data, curate-news, compile-briefing, preflight-check, aggregate-feedback
- **Monitoring** (4): health checks, data-quality agent, orchestrate-digest

### 3. Email Delivery Stats
- Today's emails by type: morning_briefing, midday_pulse, evening_winddown, daily_digest
- Counts per status: sent, failed, pending, skipped
- Total emails sent today

### 4. B2B API Stats
- Total API calls today
- API calls this month
- Latest compiled briefing age (minutes since last compile)
- Top 3 API keys by usage (prefix + call count)

### 5. Recent Failures
- Last 10 failed JobRun records
- Shows: job name, error message, timestamp, duration

## API Response Shape

```json
{
  "status": "healthy|degraded|critical",
  "updatedAt": "ISO8601",
  "summary": {
    "totalJobs": 31,
    "healthy": 28,
    "warning": 2,
    "critical": 1
  },
  "jobs": [
    {
      "name": "ingest-mta-alerts",
      "displayName": "MTA Subway Alerts",
      "category": "scraper",
      "status": "healthy|warning|critical|unknown",
      "lastRun": "ISO8601",
      "lastStatus": "success|failed|running|timeout",
      "durationMs": 1234,
      "itemsProcessed": 15,
      "itemsFailed": 0,
      "missedRuns": 0,
      "expectedFrequency": "5m"
    }
  ],
  "email": {
    "today": {
      "sent": 150,
      "failed": 2,
      "pending": 5,
      "skipped": 3
    },
    "byType": {
      "morning_briefing": { "sent": 50, "failed": 1 },
      "midday_pulse": { "sent": 45, "failed": 0 },
      "evening_winddown": { "sent": 55, "failed": 1 }
    }
  },
  "api": {
    "callsToday": 342,
    "callsThisMonth": 8500,
    "latestBriefingAge": 8,
    "topKeys": [
      { "prefix": "sk_live_Ab..", "calls": 200 },
      { "prefix": "sk_live_Cd..", "calls": 100 }
    ]
  },
  "recentFailures": [
    {
      "jobName": "scrape-311",
      "errorMessage": "Timeout after 30s",
      "startedAt": "ISO8601",
      "durationMs": 30000
    }
  ]
}
```

## Auth

Simple bearer token: `Authorization: Bearer <ADMIN_SECRET>`

The admin page stores the token in localStorage after initial entry. No sessions, no cookies, no user model.

## UI Design

Warm cream/charcoal palette matching existing app:
- Background: `#FAF8F5`
- Cards: white with `#E8E4DF` borders
- Text: `#2C2C2C` primary, `#6B6B6B` secondary
- Status: green `#22C55E`, yellow `#EAB308`, red `#EF4444`
- Monospace for job names and timestamps
