import type { Metadata } from 'next';
import { UpdateCenter } from '@/components/updates/UpdateCenter';

export const metadata: Metadata = { title: 'Updates' };
export const instant = false;

export default function UpdatesPage() {
  return (
    <>
      <div className="page-header">
        <h1>Updates</h1>
        <p className="muted">
          Review each available update and confirm it. Nothing installs until you say so.
        </p>
      </div>
      <UpdateCenter />
    </>
  );
}
