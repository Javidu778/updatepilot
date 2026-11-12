'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  MATCH_STATUSES,
  UPDATE_STATUSES,
  type ApplicationsQuery,
  type MatchStatus,
  type UpdateStatus,
} from '@updatepilot/shared';
import { updateStatusLabel } from '@/components/StatusBadge';
import { hasInventoryFilters } from '@/lib/inventory/search-params';

const MATCH_LABELS: Record<MatchStatus, string> = {
  MATCHED: 'Matched',
  UNMATCHED: 'Unmatched',
  UNSUPPORTED: 'Unsupported',
  UNKNOWN: 'Unknown',
};

type Props = {
  query: ApplicationsQuery;
  onChange: (patch: Partial<ApplicationsQuery>) => void;
};

/**
 * Search and filters. Every change goes into the URL, never into component state, so a filtered
 * view can be reloaded, shared and reached with the Back button.
 *
 * The search box is debounced: typing "firefox" sends one request, not seven.
 */
export function InventoryToolbar({ query, onChange }: Props) {
  const applied = query.q ?? '';
  const [term, setTerm] = useState(applied);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  // Back, Forward and "Clear filters" change the URL; the box follows it.
  useEffect(() => {
    setTerm(applied);
  }, [applied]);

  useEffect(() => {
    if (term === applied) return;
    const id = setTimeout(() => {
      const next = term.trim();
      changeRef.current({ q: next === '' ? undefined : next });
    }, 350);
    return () => clearTimeout(id);
  }, [term, applied]);

  return (
    <form className="toolbar" role="search" onSubmit={(event) => event.preventDefault()}>
      <div className="toolbar-field toolbar-field-search">
        <label htmlFor="inventory-search">Search applications</label>
        <div className="search-wrap">
          <Search className="search-icon" aria-hidden="true" size={16} />
          <input
            id="inventory-search"
            className="form-input"
            type="search"
            value={term}
            maxLength={100}
            placeholder="Name, publisher or package ID"
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
      </div>

      <div className="toolbar-field">
        <label htmlFor="inventory-update-status">Update status</label>
        <select
          id="inventory-update-status"
          className="form-input"
          value={query.updateStatus ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onChange({ updateStatus: value === '' ? undefined : (value as UpdateStatus) });
          }}
        >
          <option value="">All statuses</option>
          {UPDATE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {updateStatusLabel(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-field">
        <label htmlFor="inventory-match-status">Match status</label>
        <select
          id="inventory-match-status"
          className="form-input"
          value={query.matchStatus ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onChange({ matchStatus: value === '' ? undefined : (value as MatchStatus) });
          }}
        >
          <option value="">All matches</option>
          {MATCH_STATUSES.map((value) => (
            <option key={value} value={value}>
              {MATCH_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-spacer" />

      {hasInventoryFilters(query) ? (
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setTerm('');
              changeRef.current({
                q: undefined,
                updateStatus: undefined,
                matchStatus: undefined,
                source: undefined,
              });
            }}
          >
            Clear filters
          </button>
        </div>
      ) : null}
    </form>
  );
}
