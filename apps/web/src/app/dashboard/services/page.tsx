import type { Metadata } from 'next';
import { ServiceManager } from '@/components/services/service-manager';
import { QuoteInbox } from '@/components/services/quote-inbox';

export const metadata: Metadata = { title: 'Services & Quotes' };

export default function ServicesPage() {
  return (
    <div className="space-y-8">
      <ServiceManager />
      <QuoteInbox />
    </div>
  );
}
