'use client';

import Link from 'next/link';
import { Info, RefreshCw } from 'lucide-react';
import { dashboardSchema, type Dashboard } from '@updatepilot/shared';
import { ErrorState, LoadingState } from '@/components/DataStates';
import { ConnectionBadge } from '@/components/StatusBadge';
import { useApiResource } from '@/lib/api/use-api-resource';
import { useAuth } from '@/lib/auth/session';
import { formatRelativeTime } from '@/lib/format';

/**
 * The numbers from GET /api/v1/dashboard: application and update counts, the last scan, the
 * agent connection and recent activity.
 *
 * Every tile links to the list that proves it, so a number is never a dead end. Sample data is
 * labelled, because the proposal forbids presenting seeded rows as a live scan result.
 */
export function OverviewDashboard() {
  const { api } = useAuth();
  const { resource, reload } = useApiResource<Dashboard>('dashboard', (signal) =>
    api.get('/api/v1/dashboard', { schema: dashboardSchema, signal }),
  );

  if (resource.status === 'loading') {
    return <LoadingState label="Loading your dashboard…" />;
  }

  if (resource.status === 'error') {
    return (
      <ErrorState
        error={resource.error}
        onRetry={reload}
        title="We could not load your dashboard"
        subject="your dashboard"
      />
    );
  }

  const dashboard = resource.data;
  const needsAttention = dashboard.counts.unmatched + dashboard.counts.unsupported;
  const noDevice = dashboard.agent.deviceId === null;

  return (
    <>
      {dashboard.isSample ? (
        <div className="banner banner-warning" role="status">
          <Info aria-hidden="true" size={16} />
          <p>
            <strong>Sample data.</strong> These numbers come from seeded rows, not from a scan of
            this computer.
          </p>
        </div>
      ) : null}

      {noDevice ? (
        <div className="banner banner-info" role="status">
          <Info aria-hidden="true" size={16} />
          <p>
            No agent is paired yet. Pairing and real scans arrive in Week 3. Until then the
            inventory stays empty unless sample data is loaded.
          </p>
        </div>
      ) : null}

      <dl className="metric-grid">
        <div className="card metric-card">
          <dt className="metric-label">Applications</dt>
          <dd className="metric-value">{dashboard.counts.applications}</dd>
          <dd className="metric-action">
            <Link href="/applications">View inventory</Link>
          </dd>
        </div>

        <div className="card metric-card">
          <dt className="metric-label">Updates available</dt>
          <dd className="metric-value">{dashboard.counts.updatesAvailable}</dd>
          <dd className="metric-action">
            <Link href="/applications?updateStatus=UPDATE_AVAILABLE&sort=displayName">
              Show applications with updates
            </Link>
          </dd>
        </div>

        <div className="card metric-card">
          <dt className="metric-label">Needs attention</dt>
          <dd className="metric-value">{needsAttention}</dd>
          <dd className="metric-action">
            <Link href="/applications?matchStatus=UNMATCHED">Unmatched or unsupported</Link>
          </dd>
        </div>

        <div className="card metric-card">
          <dt className="metric-label">Last scan</dt>
          <dd className="metric-value">{formatRelativeTime(dashboard.lastScanAt)}</dd>
          <dd className="metric-action">
            {dashboard.lastScanAt ? (
              <Link href="/history">Scan history</Link>
            ) : (
              <span className="muted">No successful scan yet</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="overview-grid">
        <section className="card" aria-labelledby="agent-state-heading">
          <div className="section-heading">
            <h2 id="agent-state-heading">Agent</h2>
            <ConnectionBadge value={dashboard.agent.connection} />
          </div>
          <p className="muted">Last seen {formatRelativeTime(dashboard.agent.lastSeenAt)}.</p>
          <p>
            <Link href="/settings">Agent settings</Link>
          </p>
        </section>

        <section className="card" aria-labelledby="recent-activity-heading">
          <div className="section-heading">
            <h2 id="recent-activity-heading">Recent activity</h2>
            <RefreshCw aria-hidden="true" size={16} className="muted" />
          </div>
          {dashboard.recentActivity.length === 0 ? (
            <p className="muted">
              Nothing has happened yet. Activity appears here after scans and update attempts.
            </p>
          ) : (
            <ul className="activity-list">
              {dashboard.recentActivity.map((item) => (
                <li key={item.id} className="activity-item">
                  <span>{item.summary}</span>
                  <span className="activity-time">{formatRelativeTime(item.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
