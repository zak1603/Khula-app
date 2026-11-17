import type { Metadata } from 'next';
import { StaffCommissionTracker } from '@/components/staff/staff-commission-tracker';
import { TipsLedger } from '@/components/staff/tips-ledger';

export const metadata: Metadata = { title: 'Staff & Commission' };

export default function StaffPage() {
  return (
    <div className="space-y-8">
      <StaffCommissionTracker />
      <TipsLedger />
    </div>
  );
}
