import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/DataStates';
import { HistoryTimeline } from '@/components/history/HistoryTimeline';

export const metadata: Metadata = { title: 'History' };
export const instant = false;

export default function HistoryPage() {
  return (
    <>
      <div className="page-header">
        <h1>History</h1>
        <p className="muted">
          Every update, scan and recorded action, with the facts the server stored at the time.
        </p>
      </div>

      {/* HistoryTimeline reads useSearchParams (the chosen timeline is in the URL). */}
      <Suspense fallback={<LoadingState label="Loading history…" />}>
        <HistoryTimeline />
      </Suspense>
    </>
  );
}
