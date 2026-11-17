import type { AppointmentStatus, DepositStatus, JobProgress } from './types';

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  requested: 'Requested',
  quoted: 'Quote sent',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PROGRESS_LABEL: Record<JobProgress, string> = {
  not_started: 'Scheduled',
  en_route: 'On the way',
  arrived: 'Arrived',
  in_progress: 'In progress',
  finished: 'Finished',
};

export const DEPOSIT_LABEL: Record<DepositStatus, string> = {
  not_required: 'No deposit',
  pending: 'Deposit due',
  paid: 'Deposit paid',
  refunded: 'Deposit refunded',
  forfeited: 'Deposit forfeited',
};

/** Mirrors public.is_valid_appointment_transition(). */
export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  switch (from) {
    case 'requested':
      return to === 'quoted' || to === 'confirmed' || to === 'cancelled';
    case 'quoted':
      return to === 'requested' || to === 'confirmed' || to === 'cancelled';
    case 'confirmed':
      return to === 'completed' || to === 'cancelled';
    default:
      return false;
  }
}

export interface TrackerStep {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
}

/** Ordered tracker steps for the client's live booking screen. */
export function trackerSteps(status: AppointmentStatus, progress: JobProgress, isMobile: boolean): TrackerStep[] {
  const order: Array<{ key: string; label: string }> = [
    { key: 'requested', label: 'Requested' },
    { key: 'confirmed', label: 'Confirmed' },
    ...(isMobile ? [{ key: 'en_route', label: 'On the way' }] : []),
    { key: 'arrived', label: isMobile ? 'Arrived' : 'Checked in' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'completed', label: 'Done' },
  ];

  let reached: string;
  if (status === 'completed') reached = 'completed';
  else if (status === 'confirmed') reached = progress === 'not_started' || progress === 'finished' ? 'confirmed' : progress;
  else reached = 'requested';

  const idx = order.findIndex((s) => s.key === reached);
  return order.map((s, i) => ({ ...s, done: i <= idx, current: i === idx }));
}
