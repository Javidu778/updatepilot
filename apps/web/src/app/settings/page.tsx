import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export const metadata: Metadata = { title: 'Settings & agent' };

export default function SettingsPage() {
  return (
    <PlaceholderPage
      title="Settings & agent"
      summary="Pair and manage your agent, and choose your preferences."
      builtIn="Week 3 (pairing) and Week 5 (preferences)"
      planned={[
        'Secure agent pairing with a one-time code',
        'Agent status, last seen time and revocation',
        'Theme, scan preferences and data retention',
      ]}
    />
  );
}
