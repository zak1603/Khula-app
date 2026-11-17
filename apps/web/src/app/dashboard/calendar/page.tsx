import type { Metadata } from 'next';
import { CalendarManager } from '@/components/calendar/calendar-manager';

export const metadata: Metadata = { title: 'Calendar' };

export default function CalendarPage() {
  return <CalendarManager />;
}
