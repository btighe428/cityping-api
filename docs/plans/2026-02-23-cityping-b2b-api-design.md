# CityPing B2B API Data-as-a-Service — Design Document

**Date:** 2026-02-23
**Status:** Approved

## Rules

1. NOT modifying the existing scraping/processing tasks
2. NOT deleting the Resend email logic
3. Strictly building a read-only REST API layer (`/api/v1/...`) that queries existing Supabase data, authenticates via API keys, and returns clean JSON

## Overview

Pivot CityPing from B2C email digest to B2B API Data-as-a-Service. Fork the existing repo, add an API authentication layer, a compiled payload system, REST endpoints, and a developer dashboard.

## Architecture

```
Existing scrapers → Supabase tables (UNTOUCHED)
                         ↓
Compiler task (every 15min) → CompiledBriefing table (JSONB)
                         ↓
GET /api/v1/briefing → Auth middleware (ApiKey) → Return payload (< 200ms)
```

### Approach: Pre-compiled Payload + Thin REST Layer

A new compiler task runs every 15 minutes, queries all data tables (AlertEvent, CityEvent, NewsArticle, ServiceAlert, AirQualityReading, DiningDeal, ParkEvent, etc.), structures a unified JSON briefing, and writes it to `CompiledBriefing.payload`. The API endpoint returns this pre-built JSON — no joins or AI calls at request time.

## New Prisma Models

### ApiClient
Lightweight B2B customer model, separate from existing B2C User/Account models.

| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| email | String (unique) | B2B customer email |
| companyName | String? | Optional company name |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### ApiKey
API key for authentication. Keys use `sk_live_` prefix and are stored hashed.

| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| hashedKey | String (unique) | SHA-256 hash of `sk_live_xxx` key |
| keyPrefix | String | First 8 chars for identification (`sk_live_Ab`) |
| apiClientId | String | FK to ApiClient |
| name | String? | User-friendly label |
| planTier | Enum (free/pro/enterprise) | Default: free |
| isActive | Boolean | Default: true |
| lastUsedAt | DateTime? | |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### ApiLog
Request logging for rate limiting and billing analytics.

| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| apiKeyId | String | FK to ApiKey |
| endpoint | String | e.g., `/api/v1/briefing` |
| statusCode | Int | HTTP status |
| responseTimeMs | Int | Latency tracking |
| createdAt | DateTime | |

### CompiledBriefing
Pre-built API response payload, refreshed every 15 minutes.

| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| city | String | e.g., "nyc" |
| payload | Json | Full JSONB briefing object |
| version | String | Schema version for backwards compat |
| createdAt | DateTime | Indexed for "latest" query |

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/briefing` | GET | Bearer token | Main briefing (`?city=nyc`) |
| `POST /api/v1/keys` | POST | Session | Generate new API key (dashboard) |
| `GET /api/v1/keys` | GET | Session | List user's keys (dashboard) |
| `GET /api/v1/usage` | GET | Session | Usage stats (dashboard) |

## Auth Flow

1. Client sends `Authorization: Bearer sk_live_xxxxx`
2. Middleware hashes the token with SHA-256
3. Looks up `ApiKey` by `hashedKey`
4. Checks `isActive === true`
5. Checks rate limit via `ApiLog` count in current window
6. If valid: proceed, log request to `ApiLog`
7. If invalid: return 401/429

### Rate Limits (by tier)

| Tier | Requests/day |
|------|-------------|
| free | 100 |
| pro | 10,000 |
| enterprise | unlimited |

## Compiled Briefing Payload Shape

```json
{
  "city": "nyc",
  "generatedAt": "2026-02-23T15:00:00Z",
  "version": "1.0",
  "weather": {
    "current": { ... },
    "airQuality": { ... }
  },
  "transit": {
    "alerts": [ ... ],
    "serviceChanges": [ ... ]
  },
  "parking": {
    "aspSuspended": true,
    "reason": "Presidents Day",
    "nextSuspension": { ... }
  },
  "events": {
    "featured": [ ... ],
    "today": [ ... ],
    "thisWeek": [ ... ]
  },
  "dining": [ ... ],
  "news": {
    "topStories": [ ... ]
  },
  "serviceAlerts": [ ... ],
  "parks": [ ... ]
}
```

## Developer Dashboard

Page at `/dashboard/api-keys/page.tsx`:
- Displays active API keys (masked except prefix)
- "Generate New Key" button (server action)
- Shows full key ONCE on creation (copy to clipboard)
- Monthly usage stats from ApiLog aggregation
- Uses existing Tailwind styling

## Key Generation

```typescript
import { randomBytes, createHash } from 'crypto';

function generateApiKey(): { raw: string; hashed: string; prefix: string } {
  const raw = `sk_live_${randomBytes(32).toString('base64url')}`;
  const hashed = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.substring(0, 12);
  return { raw, hashed, prefix };
}
```

The raw key is shown to the user exactly once. Only the hash is stored.

## OpenAPI Spec

Generate `openapi.yaml` (OpenAPI 3.0) for the GET `/api/v1/briefing` endpoint with:
- Bearer auth security scheme
- `?city=nyc` query parameter
- Full response schema matching compiled payload
- Professional descriptions targeting travel app developers and corporate concierge platforms

## Phases

1. **Fork repo** — Create `cityping-api` from `btighe428/cityping`
2. **Schema** — Add ApiClient, ApiKey, ApiLog, CompiledBriefing models; `prisma db push`
3. **Compiler task** — New task that queries all data tables and writes to CompiledBriefing
4. **API endpoint** — `GET /api/v1/briefing` with auth middleware
5. **Dashboard** — Developer portal for key management
6. **Documentation** — OpenAPI spec for Mintlify
