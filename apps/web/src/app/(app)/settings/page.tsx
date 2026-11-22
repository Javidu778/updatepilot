import type { Metadata } from 'next';
import { DeviceManager } from '@/components/settings/DeviceManager';

export const metadata: Metadata = { title: 'Settings & agent' };
export const instant = false;

export default function SettingsPage() {
  return (
    <>
      <div className="page-header">
        <h1>Settings &amp; agent</h1>
        <p className="muted">
          Pair a computer, check its connection, and revoke one you no longer use.
        </p>
      </div>
      <div className="stack">
        <DeviceManager />
      </div>
    </>
  );
}
