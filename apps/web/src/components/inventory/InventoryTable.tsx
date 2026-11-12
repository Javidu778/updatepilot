'use client';

import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { Application, ApplicationsQuery } from '@updatepilot/shared';
import { UpdateStatusBadge } from '@/components/StatusBadge';
import { NOT_AVAILABLE, formatRelativeTime, formatVersion } from '@/lib/format';
import {
  SORT_LABELS,
  toggleInventorySort,
  type ApplicationSortField,
} from '@/lib/inventory/search-params';

type Props = {
  rows: Application[];
  query: ApplicationsQuery;
  onChange: (patch: Partial<ApplicationsQuery>) => void;
};

function SortHeader({
  field,
  query,
  onChange,
}: {
  field: ApplicationSortField;
  query: ApplicationsQuery;
  onChange: (patch: Partial<ApplicationsQuery>) => void;
}) {
  const active = query.sort === field;
  const ascending = query.order === 'asc';
  const Icon = active ? (ascending ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <th scope="col" aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className="sort-button"
        onClick={() => onChange(toggleInventorySort(query, field))}
      >
        {SORT_LABELS[field]}
        <Icon aria-hidden="true" size={14} />
      </button>
    </th>
  );
}

/**
 * A real table with real header cells, so a screen reader can announce the sort state of each
 * column. Rows link to the detail page; the row itself is never a button.
 */
export function InventoryTable({ rows, query, onChange }: Props) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">
          Installed applications, {rows.length} on this page
        </caption>
        <thead>
          <tr>
            <SortHeader field="displayName" query={query} onChange={onChange} />
            <SortHeader field="publisher" query={query} onChange={onChange} />
            <SortHeader field="installedVersion" query={query} onChange={onChange} />
            <th scope="col">Available version</th>
            <SortHeader field="updateStatus" query={query} onChange={onChange} />
            <SortHeader field="lastSeenAt" query={query} onChange={onChange} />
          </tr>
        </thead>
        <tbody>
          {rows.map((application) => (
            <tr key={application.id}>
              <td>
                <Link className="row-link" href={`/applications/${application.id}`}>
                  {application.displayName}
                </Link>
                <span className="cell-secondary mono">
                  {application.packageId ?? NOT_AVAILABLE}
                </span>
              </td>
              <td>{application.publisher ?? NOT_AVAILABLE}</td>
              <td className="version">{formatVersion(application.installedVersion)}</td>
              <td className="version">{formatVersion(application.availableVersion)}</td>
              <td>
                <UpdateStatusBadge value={application.updateStatus} />
              </td>
              <td>{formatRelativeTime(application.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
