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
