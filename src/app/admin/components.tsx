'use client';

import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  TypeScript interfaces                                              */
/* ------------------------------------------------------------------ */

interface JobInfo {
  name: string;
  displayName: string;
  category: string;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  lastRun: string;
  lastStatus: string;
  expectedFrequency: string;
  missedRuns: number;
  consecutiveFailures: number;
  durationMs: number;
  itemsProcessed: number;
  itemsFailed: number;
}

interface EmailToday {
  sent: number;
  failed: number;
  pending: number;
  skipped: number;
}

interface EmailTypeStats {
  sent: number;
  failed: number;
  pending: number;
  skipped: number;
}

interface EmailInfo {
  today: EmailToday;
  byType: Record<string, EmailTypeStats>;
}

interface TopKey {
  prefix: string;
  calls: number;
}

interface ApiInfo {
  callsToday: number;
  callsThisMonth: number;
  latestBriefingAgeMin: number;
  topKeys: TopKey[];
}

interface RecentFailure {
  jobName: string;
  errorMessage: string;
  startedAt: string;
  durationMs: number;
}

interface DashboardSummary {
  totalJobs: number;
  healthy: number;
  warning: number;
  critical: number;
  unknown: number;
}

interface DashboardData {
  status: 'healthy' | 'degraded' | 'critical';
  updatedAt: string;
  summary: DashboardSummary;
  jobs: JobInfo[];
  email: EmailInfo;
  api: ApiInfo;
  recentFailures: RecentFailure[];
}

/* ------------------------------------------------------------------ */
/*  Helper functions                                                   */
/* ------------------------------------------------------------------ */

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ------------------------------------------------------------------ */
/*  Color / style helpers                                              */
/* ------------------------------------------------------------------ */

const STATUS_DOT: Record<string, string> = {
  healthy: '#22C55E',
  warning: '#EAB308',
  critical: '#EF4444',
  unknown: '#9CA3AF',
};

const BANNER_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  healthy: { bg: '#F0FDF4', border: '#BBF7D0', text: '#166534' },
  degraded: { bg: '#FEFCE8', border: '#FEF08A', text: '#854D0E' },
  critical: { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B' },
};

const CATEGORY_ORDER = ['scraper', 'email', 'processing', 'other'];

function categoryLabel(cat: string): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1) + 's';
}

/* ------------------------------------------------------------------ */
/*  Login screen                                                       */
/* ------------------------------------------------------------------ */

function LoginScreen({ onLogin }: { onLogin: (secret: string) => void }) {
  const [value, setValue] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) onLogin(value.trim());
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FAF8F5',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: '#fff',
          border: '1px solid #E8E4DF',
          borderRadius: 12,
          padding: 32,
          width: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, color: '#2C2C2C' }}>CityPing Ops Dashboard</h1>
        <p style={{ margin: 0, fontSize: 14, color: '#6B6B6B' }}>
          Enter the admin secret to continue.
        </p>
        <input
          type="password"
          placeholder="Admin secret"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            padding: '10px 12px',
            border: '1px solid #E8E4DF',
            borderRadius: 8,
            fontSize: 14,
            outline: 'none',
            color: '#2C2C2C',
            background: '#F0EDE8',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '10px 16px',
            background: '#2C2C2C',
            color: '#FAF8F5',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Sign in
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatusBanner({ data }: { data: DashboardData }) {
  const style = BANNER_STYLES[data.status] ?? BANNER_STYLES.critical;
  const { summary } = data;
  return (
    <div
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 12,
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div>
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: style.text,
            textTransform: 'uppercase',
          }}
        >
          System {data.status}
        </span>
        <span style={{ marginLeft: 12, fontSize: 13, color: '#6B6B6B' }}>
          Updated {timeAgo(data.updatedAt)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#2C2C2C' }}>
        <span>
          <b style={{ color: '#22C55E' }}>{summary.healthy}</b> healthy
        </span>
        <span>
          <b style={{ color: '#EAB308' }}>{summary.warning}</b> warning
        </span>
        <span>
          <b style={{ color: '#EF4444' }}>{summary.critical}</b> critical
        </span>
        <span>
          <b style={{ color: '#9CA3AF' }}>{summary.unknown}</b> unknown
        </span>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E8E4DF',
        borderRadius: 12,
        padding: '16px 20px',
        flex: '1 1 200px',
      }}
    >
      <div style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 4, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#2C2C2C' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#6B6B6B', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function StatsRow({ data }: { data: DashboardData }) {
  const { email, api } = data;
  const topKeysStr = api.topKeys
    .slice(0, 3)
    .map((k) => `${k.prefix} (${k.calls})`)
    .join(', ');
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
      }}
    >
      <StatCard
        label="Emails Today"
        value={email.today.sent}
        sub={`${email.today.failed} failed / ${email.today.pending} pending`}
      />
      <StatCard
        label="API Calls"
        value={api.callsToday}
        sub={`${api.callsThisMonth.toLocaleString()} this month`}
      />
      <StatCard
        label="Latest Briefing"
        value={`${api.latestBriefingAgeMin}m`}
        sub="age of latest briefing"
      />
      <StatCard label="Top API Keys" value={api.topKeys.length} sub={topKeysStr || 'none'} />
    </div>
  );
}

function JobRow({ job }: { job: JobInfo }) {
  return (
    <tr style={{ borderBottom: '1px solid #E8E4DF' }}>
      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: STATUS_DOT[job.status] ?? STATUS_DOT.unknown,
            marginRight: 8,
            verticalAlign: 'middle',
          }}
        />
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#2C2C2C' }}>
          {job.name}
        </span>
      </td>
      <td style={{ padding: '8px 12px', fontSize: 13, color: '#6B6B6B' }}>{job.displayName}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, color: '#6B6B6B', whiteSpace: 'nowrap' }}>
        {job.lastRun ? timeAgo(job.lastRun) : '—'}
      </td>
      <td style={{ padding: '8px 12px', fontSize: 13, color: '#6B6B6B', whiteSpace: 'nowrap' }}>
        {formatMs(job.durationMs)}
      </td>
      <td style={{ padding: '8px 12px', fontSize: 13, color: '#6B6B6B', textAlign: 'right' }}>
        {job.itemsProcessed}
        {job.itemsFailed > 0 && (
          <span style={{ color: '#EF4444', marginLeft: 4 }}>({job.itemsFailed} failed)</span>
        )}
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
        {job.missedRuns > 0 && (
          <span
            style={{
              background: '#FEF2F2',
              color: '#EF4444',
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 999,
            }}
          >
            {job.missedRuns} missed
          </span>
        )}
      </td>
    </tr>
  );
}

function JobPipelineGrid({ jobs }: { jobs: JobInfo[] }) {
  const statusPriority: Record<string, number> = { critical: 0, warning: 1, unknown: 2, healthy: 3 };

  const grouped: Record<string, JobInfo[]> = {};
  for (const job of jobs) {
    const cat = CATEGORY_ORDER.includes(job.category) ? job.category : 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(job);
  }

  // Sort jobs within each category: critical first
  for (const cat of Object.keys(grouped)) {
    grouped[cat].sort(
      (a, b) => (statusPriority[a.status] ?? 9) - (statusPriority[b.status] ?? 9),
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#2C2C2C' }}>Job Pipeline</h2>
      {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => (
        <div key={cat}>
          <h3
            style={{
              margin: '0 0 8px',
              fontSize: 13,
              fontWeight: 600,
              color: '#6B6B6B',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {categoryLabel(cat)}
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                background: '#fff',
                border: '1px solid #E8E4DF',
                borderRadius: 8,
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #E8E4DF' }}>
                  <th style={thStyle}>Job</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Last Run</th>
                  <th style={thStyle}>Duration</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Items</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Missed</th>
                </tr>
              </thead>
              <tbody>
                {grouped[cat].map((job) => (
                  <JobRow key={job.name} job={job} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: '#6B6B6B',
  textTransform: 'uppercase',
  textAlign: 'left',
  letterSpacing: 0.5,
};

function EmailBreakdown({ email }: { email: EmailInfo }) {
  const types = Object.entries(email.byType);
  if (types.length === 0) return null;

  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: '#2C2C2C' }}>
        Email Breakdown
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        {types.map(([type, stats]) => (
          <div
            key={type}
            style={{
              background: '#fff',
              border: '1px solid #E8E4DF',
              borderRadius: 8,
              padding: '12px 16px',
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#2C2C2C',
                marginBottom: 6,
                textTransform: 'capitalize',
              }}
            >
              {type.replace(/[_-]/g, ' ')}
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#6B6B6B' }}>
              <span>
                <b style={{ color: '#22C55E' }}>{stats.sent}</b> sent
              </span>
              <span>
                <b style={{ color: '#EF4444' }}>{stats.failed}</b> fail
              </span>
              <span>
                <b style={{ color: '#EAB308' }}>{stats.pending}</b> pend
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentFailures({ failures }: { failures: RecentFailure[] }) {
  if (failures.length === 0) return null;

  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: '#2C2C2C' }}>
        Recent Failures
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {failures.map((f, i) => (
          <div
            key={`${f.jobName}-${i}`}
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 8,
              padding: '12px 16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  fontSize: 13,
                  color: '#991B1B',
                }}
              >
                {f.jobName}
              </span>
              <span style={{ fontSize: 12, color: '#6B6B6B' }}>
                {f.startedAt ? timeAgo(f.startedAt) : '—'} &middot; {formatMs(f.durationMs)}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#EF4444', fontFamily: 'monospace' }}>
              {f.errorMessage}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main dashboard component                                           */
/* ------------------------------------------------------------------ */

export function AdminDashboard() {
  const [secret, setSecret] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Restore secret from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('cityping_admin_secret');
    if (stored) setSecret(stored);
  }, []);

  const fetchDashboard = useCallback(async () => {
    if (!secret) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (res.status === 401 || res.status === 403) {
        setError('Invalid admin secret. Please try again.');
        setSecret(null);
        localStorage.removeItem('cityping_admin_secret');
        return;
      }
      if (!res.ok) {
        setError(`Dashboard API returned ${res.status}`);
        return;
      }
      const json: DashboardData = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [secret]);

  // Fetch on mount and every 30 seconds
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleLogin = (value: string) => {
    localStorage.setItem('cityping_admin_secret', value);
    setSecret(value);
    setError(null);
  };

  const handleLogout = () => {
    localStorage.removeItem('cityping_admin_secret');
    setSecret(null);
    setData(null);
  };

  // Show login screen if no secret
  if (!secret) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F5', color: '#2C2C2C' }}>
      {/* Header */}
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '24px 20px 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>CityPing Ops Dashboard</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {loading && (
            <span style={{ fontSize: 12, color: '#6B6B6B' }}>refreshing...</span>
          )}
          <button
            onClick={fetchDashboard}
            style={{
              padding: '6px 12px',
              border: '1px solid #E8E4DF',
              borderRadius: 6,
              background: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              color: '#2C2C2C',
            }}
          >
            Refresh
          </button>
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 12px',
              border: '1px solid #E8E4DF',
              borderRadius: 6,
              background: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              color: '#6B6B6B',
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '16px 20px 48px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {error && (
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 8,
              padding: '12px 16px',
              color: '#991B1B',
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        {data && (
          <>
            <StatusBanner data={data} />
            <StatsRow data={data} />
            <JobPipelineGrid jobs={data.jobs} />
            <EmailBreakdown email={data.email} />
            <RecentFailures failures={data.recentFailures} />
          </>
        )}

        {!data && !error && (
          <div style={{ textAlign: 'center', padding: 48, color: '#6B6B6B', fontSize: 14 }}>
            Loading dashboard...
          </div>
        )}
      </div>
    </div>
  );
}
