'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { applicationsResponseSchema, type ApplicationsQuery } from '@updatepilot/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataStates';
import { useApiResource } from '@/lib/api/use-api-resource';
import { useAuth } from '@/lib/auth/session';
import {
  applyInventoryPatch,
  hasInventoryFilters,
  inventoryHref,
  readInventoryQuery,
  toApiQueryString,
} from '@/lib/inventory/search-params';
import { InventoryTable } from './InventoryTable';
import { InventoryToolbar } from './InventoryToolbar';
import { Pagination } from './Pagination';
import { Search } from 'lucide-react';

/**
 * The inventory screen: URL in, list out.
 *
 * The URL is parsed with the API's own query schema, so a hand-edited address cannot produce a
 * request the API rejects. Every interaction writes a new URL; this component only reads it.
 */
export function InventoryBrowser() {
  const params = useSearchParams();
  const router = useRouter();
  const { api } = useAuth();

  const query = readInventoryQuery(params);
  const apiQuery = toApiQueryString(query);

  const { resource, reload } = useApiResource(`applications:${apiQuery}`, (signal) =>
    api.get(`/api/v1/applications?${apiQuery}`, {
      schema: applicationsResponseSchema,
      signal,
    }),
  );

  const change = useCallback(
    (patch: Partial<ApplicationsQuery>) => {
      router.replace(inventoryHref(applyInventoryPatch(query, patch)));
    },
    [query, router],
  );

  return (
    <>
      <InventoryToolbar query={query} onChange={change} />

      {resource.status === 'loading' ? (
        <LoadingState label="Loading applications…" />
      ) : resource.status === 'error' ? (
        <ErrorState
          error={resource.error}
          onRetry={reload}
          title="We could not load the inventory"
          subject="the inventory"
        />
      ) : resource.data.data.length > 0 ? (
        <>
          <InventoryTable rows={resource.data.data} query={query} onChange={change} />
          <Pagination
            query={query}
            total={resource.data.total}
            totalPages={resource.data.totalPages}
            onChange={change}
          />
        </>
      ) : query.page > 1 ? (
        <EmptyState
          title="This page is empty"
          body="The list changed since you opened this page. Go back to the first page."
          action={{ label: 'Go to the first page', onClick: () => change({ page: 1 }) }}
        />
      ) : hasInventoryFilters(query) ? (
        <EmptyState
          icon={Search}
          title="No applications match these filters"
          body="Try a different search, or clear the filters to see everything."
          action={{
            label: 'Clear filters',
            onClick: () =>
              change({
                q: undefined,
                updateStatus: undefined,
                matchStatus: undefined,
                source: undefined,
              }),
          }}
        />
      ) : (
        <EmptyState
          title="No applications yet"
          body="Pair an agent and run a scan to fill the inventory. Pairing arrives in Week 3."
        />
      )}
    </>
  );
}
