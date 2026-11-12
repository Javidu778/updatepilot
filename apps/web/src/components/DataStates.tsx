'use client';

import { AlertCircle, Inbox, type LucideIcon } from 'lucide-react';
import { describeFailure } from '@/lib/api/describe-failure';

/**
 * The three states every page that reads the API shows, in one place so they look and read the
 * same everywhere. Each one says what happened and what the user can do next.
 */

/** A block that matches the final layout, with `aria-busy` so assistive tech knows it is not final. */
export function LoadingState({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div className="table-wrap" aria-busy="true">
      <div className="state-block">
        <p className="muted" role="status">
          {label}
        </p>
        {Array.from({ length: rows }, (_, index) => (
          <span
            key={index}
            className={index % 3 === 0 ? 'skeleton skeleton-wide' : 'skeleton'}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

type EmptyStateProps = {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
  icon?: LucideIcon;
};

export function EmptyState({ title, body, action, icon: Icon = Inbox }: EmptyStateProps) {
  return (
    <div className="table-wrap">
      <div className="state-block">
        <Icon className="state-icon" aria-hidden="true" size={24} />
        <h2>{title}</h2>
        <p className="muted">{body}</p>
        {action ? (
          <button type="button" className="btn btn-primary" onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

type ErrorStateProps = {
  error: unknown;
  onRetry: () => void;
  title?: string;
  subject?: string;
};

export function ErrorState({
  error,
  onRetry,
  title = 'We could not load this',
  subject,
}: ErrorStateProps) {
  return (
    <div className="table-wrap">
      <div className="state-block" role="alert">
        <AlertCircle className="state-icon" aria-hidden="true" size={24} />
        <h2>{title}</h2>
        <p className="muted">{describeFailure(error, subject)}</p>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
