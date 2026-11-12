'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ApplicationsQuery } from '@updatepilot/shared';
import { countOf } from '@/lib/format';
import { applyInventoryPatch } from '@/lib/inventory/search-params';

const PAGE_SIZES = [10, 25, 50, 100];

type Props = {
  query: ApplicationsQuery;
  total: number;
  totalPages: number;
  onChange: (patch: Partial<ApplicationsQuery>) => void;
};

/** Page controls plus a page-size selector. The current page and range are announced, not implied. */
export function Pagination({ query, total, totalPages, onChange }: Props) {
  const first = total === 0 ? 0 : (query.page - 1) * query.pageSize + 1;
  const last = Math.min(query.page * query.pageSize, total);
  const canGoBack = query.page > 1;
  const canGoForward = query.page < totalPages;

  return (
    <div className="pagination">
      <p className="pagination-summary" role="status">
        {total === 0
          ? 'No results'
          : `Showing ${first}–${last} of ${countOf(total, 'application')}`}
      </p>

      <div className="pagination-pages">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!canGoBack}
          onClick={() => onChange(applyInventoryPatch(query, { page: query.page - 1 }))}
        >
          <ChevronLeft aria-hidden="true" size={16} />
          Previous
        </button>
        <span className="tabular">
          Page {query.page} of {Math.max(totalPages, 1)}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!canGoForward}
          onClick={() => onChange(applyInventoryPatch(query, { page: query.page + 1 }))}
        >
          Next
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>

      <div className="toolbar-field">
        <label htmlFor="inventory-page-size">Rows per page</label>
        <select
          id="inventory-page-size"
          className="form-input"
          value={String(query.pageSize)}
          onChange={(event) => onChange({ pageSize: Number(event.target.value) })}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
