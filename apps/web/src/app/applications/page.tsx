import type { Metadata } from 'next';
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
