import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export const metadata: Metadata = { title: 'Security insights' };

export default function SecurityPage() {
  return (
    <PlaceholderPage
      title="Security insights"
      summary="Verified advisory information, always with its source and date checked."
      builtIn="Week 5"
      planned={[
        'Findings shown only when the package match and source are verified',
        'Source, date checked and known limitations on every finding',
        'Clear message when data is unavailable',
      ]}
    />
  );
}
