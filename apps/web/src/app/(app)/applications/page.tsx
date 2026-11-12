/*import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export const metadata: Metadata = { title: 'Applications' };

export default function ApplicationsPage() {
  return (
    <PlaceholderPage
      title="Applications"
      summary="Searchable inventory of installed software."
      builtIn="Week 2 (inventory UI) and Week 3 (real scan data)"
      planned={[
        'Search, filter, sort and pagination that work together',
        'Installed version, publisher, package identity and source',
        'Application detail pages with release information',
        'Explicit unmatched and unsupported states',
      ]}
    />
  );
}
*/

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/DataStates';
import { InventoryBrowser } from '@/components/inventory/InventoryBrowser';

export const metadata: Metadata = { title: 'Applications' };
export const instant = false;

export default function ApplicationsPage() {
  return (
    <>
      <div className="page-header">
        <h1>Applications</h1>
        <p className="muted">
          Every application found on your devices, with search, filters, sorting and pagination.
        </p>
      </div>

      {/*
        InventoryBrowser reads useSearchParams. Under Cache Components that requires a Suspense
        boundary, otherwise `next build` fails with "Missing Suspense boundary with useSearchParams".
      */}
      <Suspense fallback={<LoadingState label="Loading applications…" />}>
        <InventoryBrowser />
      </Suspense>
    </>
  );
}
