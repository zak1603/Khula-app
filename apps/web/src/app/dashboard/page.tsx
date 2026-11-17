import type { Metadata } from 'next';
import { AnalyticsOverview } from '@/components/dashboard/analytics-overview';

export const metadata: Metadata = { title: 'Overview' };

export default function DashboardPage() {
  return <AnalyticsOverview />;
}
