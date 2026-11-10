import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export const metadata: Metadata = { title: 'Updates' };

export default function UpdatesPage() {
  return (
    <PlaceholderPage
      title="Updates"
      summary="Review available updates, confirm them and watch progress."
      builtIn="Week 4"
      planned={[
        'List of available updates with target versions',
        'Confirmation dialog showing the exact package and version',
        'Progress states and post-update verification',
        'Failure reasons and safe next steps',
      ]}
    />
  );
}
