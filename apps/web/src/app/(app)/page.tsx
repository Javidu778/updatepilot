import type { Metadata } from 'next';
import { OverviewDashboard } from '@/components/dashboard/OverviewDashboard';

// The title template in layout.tsx does not apply to the page in the same route segment, so this one is absolute.
export const metadata: Metadata = { title: { absolute: 'Overview | UpdatePilot' } };
// A client-fetched dashboard is not instant; that is expected, not a defect.
export const instant = false;

export default function OverviewPage() {
  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <p className="muted">Summary of your applications, updates and agent connection.</p>
      </div>
      <OverviewDashboard />
    </>
  );
}
