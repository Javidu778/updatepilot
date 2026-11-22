'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { historyResponseSchema, type HistoryItem } from '@updatepilot/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataStates';
import { JobStateBadge } from '@/components/StatusBadge';
import { useApiResource } from '@/lib/api/use-api-resource';
import { useAuth } from '@/lib/auth/session';
import { countOf, formatDate, formatRelativeTime } from '@/lib/format';

const TYPES = ['update', 'scan', 'audit'] as const;
type HistoryType = (typeof TYPES)[number];

const TYPE_LABELS: Record<HistoryType, string> = {
  update: 'Updates',
  scan: 'Scans',
  audit: 'Activity',
};

const PAGE_SIZE = 25;

function readType(params: { get: (name: string) => string | null }): HistoryType {
  const value = params.get('type');
  return (TYPES as readonly string[]).includes(value ?? '') ? (value as HistoryType) : 'update';
}

function readPage(params: { get: (name: string) => string | null }): number {
  const value = Number(params.get('page') ?? '1');
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/** One row of the timeline. Audit rows have no outcome, so they show their category instead. */
function Result({ item }: { item: HistoryItem }) {
  if (item.outcome) return <JobStateBadge value={item.outcome} />;
  return (
    <span className="muted">{item.actorType === 'AGENT' ? 'Agent' : (item.actorType ?? '—')}</span>
  );
}

/** The extra facts behind a row: package, versions, exit code or the stored failure reason. */
function Details({ item }: { item: HistoryItem }) {
  const entries = Object.entries(item.details).filter(
    ([key, value]) => value !== null && value !== undefined && value !== '' && key !== 'eventType',
  );
  if (entries.length === 0) return null;

  return (
    <details className="history-details">
      <summary>Details</summary>
      <dl className="detail-grid">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd className="mono">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * The History page: updates, scans or activity, one at a time.
 *
 * The chosen timeline lives in the URL, so a view can be reloaded and shared. Every row comes from
 * the API; nothing here is reconstructed from memory of what happened.
 */
export function HistoryTimeline() {
  const params = useSearchParams();
  const router = useRouter();
  const { api } = useAuth();

  const type = readType(params);
  const page = readPage(params);
  const query = `type=${type}&page=${page}&pageSize=${PAGE_SIZE}`;

  const { resource, reload } = useApiResource(`history:${query}`, (signal) =>
    api.get(`/api/v1/history?${query}`, { schema: historyResponseSchema, signal }),
  );

  const go = useCallback(
    (nextType: HistoryType, nextPage: number) => {
      const search = new URLSearchParams();
      if (nextType !== 'update') search.set('type', nextType);
      if (nextPage > 1) search.set('page', String(nextPage));
      const suffix = search.toString();
      router.replace(suffix ? `/history?${suffix}` : '/history');
    },
    [router],
  );

  const tabs = (
    <div className="history-tabs" role="tablist" aria-label="What to show">
      {TYPES.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={value === type}
          className={value === type ? 'btn btn-primary' : 'btn btn-ghost'}
          onClick={() => go(value, 1)}
        >
          {TYPE_LABELS[value]}
        </button>
      ))}
    </div>
  );

  if (resource.status === 'loading') {
    return (
      <>
        {tabs}
        <LoadingState label="Loading history…" />
      </>
    );
  }

  if (resource.status === 'error') {
    return (
      <>
        {tabs}
        <ErrorState
          error={resource.error}
          onRetry={reload}
          title="We could not load the history"
          subject="the history"
        />
      </>
    );
  }

  const { data, total, totalPages } = resource.data;

  if (data.length === 0) {
    return (
      <>
        {tabs}
        <EmptyState
          title="Nothing recorded yet"
          body={
            type === 'update'
              ? 'Updates you confirm will be listed here with the verified before and after versions.'
              : type === 'scan'
                ? 'Scans appear here once the agent has run one.'
                : 'Sign-ins, pairings, scans and updates appear here.'
          }
        />
      </>
    );
  }

  return (
    <>
      {tabs}

      <p className="muted update-count" role="status">
        {countOf(total, type === 'audit' ? 'event' : type === 'scan' ? 'scan' : 'update')} recorded.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">
            History of {TYPE_LABELS[type].toLowerCase()}
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Result</th>
              <th scope="col">Recorded facts</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={`${item.type}-${item.id}`}>
                <td>
                  {formatRelativeTime(item.timestamp)}
                  <span className="cell-secondary">{formatDate(item.timestamp)}</span>
                </td>
                <td>{item.summary}</td>
                <td>
                  <Result item={item} />
                </td>
                <td>
                  <Details item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <p className="pagination-summary">
          Page {page} of {Math.max(totalPages, 1)}
        </p>
        <div className="pagination-pages">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => go(type, page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page >= totalPages}
            onClick={() => go(type, page + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {type === 'update' ? (
        <p className="muted">
          An update appears here only after the agent reports a result.{' '}
          <Link href="/updates">Review updates</Link>
        </p>
      ) : null}
    </>
  );
}
