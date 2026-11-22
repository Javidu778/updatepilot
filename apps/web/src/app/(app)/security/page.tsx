import type { Metadata } from 'next';
import { SecurityInsights } from '@/components/security/SecurityInsights';

export const metadata: Metadata = { title: 'Security insights' };
export const instant = false;

export default function SecurityPage() {
  return (
    <>
      <div className="page-header">
        <h1>Security insights</h1>
        <p className="muted">
          Known advisories for the packages you have installed, with the source and the date
          checked.
        </p>
      </div>
      <SecurityInsights />
    </>
  );
}
