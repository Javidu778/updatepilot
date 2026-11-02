import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export const metadata: Metadata = { title: 'History' };

export default function HistoryPage() {
  return (
    <PlaceholderPage
      title="History"
      summary="Scans, update attempts and audit events."
      builtIn="Week 4 (update history) and Week 5 (exports)"
      planned={[
        'Scan and update history with before and after versions',
        'Failure diagnostics and audit trail',
        'Filters and export',
      ]}
    />
  );
}
