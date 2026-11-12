import type { Metadata } from 'next';
import { ApplicationDetailView } from '@/components/applications/ApplicationDetailView';

export const metadata: Metadata = { title: 'Application' };
export const instant = false;

export default function ApplicationDetailPage() {
  return <ApplicationDetailView />;
}
