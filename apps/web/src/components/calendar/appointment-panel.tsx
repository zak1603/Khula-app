'use client';

import { useState } from 'react';
import { Ban, CheckCheck, CheckCircle2, MapPin, Navigation, Phone, Play, UserRound } from 'lucide-react';
import {
  DEPOSIT_LABEL,
  JOB_PROGRESS,
  PROGRESS_LABEL,
  formatDateTime,
  formatZar,
  maskPhone,
  saLocalToIso,
  type AppointmentWithRelations,
  type StaffMember,
} from '@khula/shared';
import { useAppointmentActions } from '@/hooks/queries';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Badge, Button, Dialog, ErrorNotice, Field, Input, Select, StatusBadge, Textarea } from '@/components/ui/primitives';

export function AppointmentPanel({ appointments, staff }: { appointments: AppointmentWithRelations[]; staff: StaffMember[] }) {
  const businessId = useDashboardStore((s) => s.businessId);
  const selectedId = useDashboardStore((s) => s.selectedAppointmentId);
  const select = useDashboardStore((s) => s.selectAppointment);
  const a = appointments.find((x) => x.id === selectedId) ?? null;
  const { updateStatus, updateProgress, reschedule } = useAppointmentActions(businessId);

  const [cancelReason, setCancelReason] = useState('');
  const [showPhone, setShowPhone] = useState(false);
  const [moveDate, setMoveDate] = useState('');
  const [moveTime, setMoveTime] = useState('');
  const [moveStaff, setMoveStaff] = useState('');

  const close = () => {
    select(null);
    setCancelReason('');
    setShowPhone(false);
    updateStatus.reset();
    updateProgress.reset();
    reschedule.reset();
  };

  const error = updateStatus.error ?? updateProgress.error ?? reschedule.error;
  const started = a ? Date.parse(a.starts_at) <= Date.now() : false;
  const phone = a?.client?.phone ?? a?.walk_in_phone ?? null;

  return (
    <Dialog open={!!a} onClose={close} title="Appointment" side>
      {a && (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={a.status} />
              {a.deposit_status !== 'not_required' && <Badge tone={a.deposit_status === 'paid' ? 'brand' : 'amber'}>{DEPOSIT_LABEL[a.deposit_status]}</Badge>}
              {a.is_mobile && <Badge tone="violet">On-site · {PROGRESS_LABEL[a.progress]}</Badge>}
            </div>
            <h3 className="text-lg font-semibold">{a.service?.title}</h3>
            <p className="text-sm text-ink-muted">{formatDateTime(a.starts_at)} · {a.staff?.display_name ?? 'Unassigned'}</p>
            <p className="text-sm font-medium">{a.total_price_cents !== null ? formatZar(a.total_price_cents) : 'Awaiting quote'}</p>
          </div>

          <dl className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-ink-subtle" aria-hidden />
              <dd>{a.client?.full_name ?? a.walk_in_name ?? 'Client'}</dd>
            </div>
            {phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-ink-subtle" aria-hidden />
                {/* Phone masked by default: reduces shoulder-surfing exposure (POPIA s19). */}
                <dd className="tabular-nums">{showPhone ? phone : maskPhone(phone)}</dd>
                <button className="text-xs font-medium text-brand-700" onClick={() => setShowPhone((v) => !v)}>
                  {showPhone ? 'Hide' : 'Reveal'}
                </button>
              </div>
            )}
            {a.is_mobile && a.client_address_line1 && (
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 text-ink-subtle" aria-hidden />
                <dd>
                  {[a.client_address_line1, a.client_address_line2, a.client_suburb, a.client_city, a.client_postal_code].filter(Boolean).join(', ')}
                </dd>
              </div>
            )}
            {a.client_message && <p className="whitespace-pre-wrap border-t border-slate-200 pt-2 text-ink-muted">“{a.client_message}”</p>}
          </dl>

          <ErrorNotice error={error} />

          {/* Status actions */}
          <div className="grid gap-2">
            {a.status === 'requested' && a.total_price_cents !== null && a.deposit_status !== 'pending' && (
              <Button loading={updateStatus.isPending} onClick={() => updateStatus.mutate({ id: a.id, status: 'confirmed' })}>
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirm booking
              </Button>
            )}
            {a.status === 'confirmed' && a.is_mobile && (
              <div className="grid grid-cols-3 gap-2">
                {(['en_route', 'arrived', 'in_progress'] as const).map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant="secondary"
                    // Progress only moves forward (mirrors update_job_progress()).
                    disabled={JOB_PROGRESS.indexOf(a.progress) >= JOB_PROGRESS.indexOf(p)}
                    loading={updateProgress.isPending && updateProgress.variables?.progress === p}
                    onClick={() => updateProgress.mutate({ id: a.id, progress: p })}
                  >
                    {p === 'en_route' ? <Navigation className="h-3.5 w-3.5" /> : p === 'arrived' ? <MapPin className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {PROGRESS_LABEL[p]}
                  </Button>
                ))}
              </div>
            )}
            {a.status === 'confirmed' && (
              <Button
                variant="secondary"
                disabled={!started}
                title={started ? undefined : 'Available once the appointment has started'}
                loading={updateStatus.isPending && updateStatus.variables?.status === 'completed'}
                onClick={() => updateStatus.mutate({ id: a.id, status: 'completed' })}
              >
                <CheckCheck className="h-4 w-4" aria-hidden /> Mark completed
              </Button>
            )}
          </div>

          {/* Reschedule */}
          {['requested', 'quoted', 'confirmed'].includes(a.status) && (
            <form
              className="space-y-3 rounded-xl border border-slate-200 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!moveDate || !moveTime) return;
                reschedule.mutate({ id: a.id, startsAt: saLocalToIso(moveDate, moveTime), staffId: moveStaff || undefined });
              }}
            >
              <p className="text-sm font-medium">Move appointment</p>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" aria-label="New date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} required />
                <Input type="time" step={900} aria-label="New time" value={moveTime} onChange={(e) => setMoveTime(e.target.value)} required />
              </div>
              <Select aria-label="Staff member" value={moveStaff} onChange={(e) => setMoveStaff(e.target.value)}>
                <option value="">Keep {a.staff?.display_name ?? 'unassigned'}</option>
                {staff.filter((s) => s.id !== a.staff_id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm" variant="secondary" loading={reschedule.isPending}>
                Move
              </Button>
            </form>
          )}

          {/* Cancel */}
          {['requested', 'quoted', 'confirmed'].includes(a.status) && (
            <form
              className="space-y-2 rounded-xl border border-red-100 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                updateStatus.mutate({ id: a.id, status: 'cancelled', reason: cancelReason.trim() });
              }}
            >
              <Field label="Cancellation reason (shared with client)">
                {(p) => <Textarea {...p} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} required minLength={3} />}
              </Field>
              {a.deposit_status === 'paid' && <p className="text-xs text-ink-muted">The client&apos;s deposit will be refunded automatically.</p>}
              <Button type="submit" variant="danger" size="sm" loading={updateStatus.isPending && updateStatus.variables?.status === 'cancelled'}>
                <Ban className="h-4 w-4" aria-hidden /> Cancel appointment
              </Button>
            </form>
          )}
        </div>
      )}
    </Dialog>
  );
}
