'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import {
  WEEKDAYS,
  formatTime,
  minutesIntoSaDay,
  saLocalToIso,
  toSaDate,
  type AppointmentWithRelations,
  type StaffMember,
  type Weekday,
} from '@khula/shared';
import { useDashboardStore } from '@/stores/dashboard-store';
import { cn } from '@/lib/utils';

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const STATUS_BLOCK: Record<string, string> = {
  requested: 'border-amber-400 bg-amber-50 text-amber-900',
  quoted: 'border-violet-400 bg-violet-50 text-violet-900',
  confirmed: 'border-emerald-500 bg-emerald-50 text-emerald-900',
  completed: 'border-sky-500 bg-sky-50 text-sky-900',
  cancelled: 'border-slate-300 bg-slate-50 text-slate-400 line-through',
};

function weekdayOf(date: string): Weekday {
  const js = new Date(`${date}T12:00:00+02:00`).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(js + 6) % 7]!;
}

export function CalendarGrid({
  date,
  staff,
  appointments,
}: {
  date: string;
  staff: StaffMember[];
  appointments: AppointmentWithRelations[];
}) {
  const px = useDashboardStore((s) => s.pxPerMinute);
  const selectAppointment = useDashboardStore((s) => s.selectAppointment);
  const openWalkIn = useDashboardStore((s) => s.openWalkIn);
  const weekday = weekdayOf(date);

  // Visible range: union of working hours and booked times, padded, clamped to the day.
  const [startMin, endMin] = useMemo(() => {
    let lo = 8 * 60;
    let hi = 18 * 60;
    for (const s of staff) for (const iv of s.working_hours[weekday] ?? []) {
      lo = Math.min(lo, toMin(iv.start));
      hi = Math.max(hi, toMin(iv.end));
    }
    for (const a of appointments) {
      lo = Math.min(lo, minutesIntoSaDay(a.starts_at));
      hi = Math.max(hi, minutesIntoSaDay(a.starts_at) + Math.round((Date.parse(a.blocked_until) - Date.parse(a.starts_at)) / 60_000));
    }
    return [Math.max(0, Math.floor(lo / 60) * 60 - 60), Math.min(24 * 60, Math.ceil(hi / 60) * 60 + 60)];
  }, [staff, appointments, weekday]);

  const height = (endMin - startMin) * px;
  const hours = Array.from({ length: (endMin - startMin) / 60 + 1 }, (_, i) => startMin + i * 60);

  // Live "now" line
  const [nowMin, setNowMin] = useState(() => minutesIntoSaDay(new Date()));
  useEffect(() => {
    const t = setInterval(() => setNowMin(minutesIntoSaDay(new Date())), 60_000);
    return () => clearInterval(t);
  }, []);
  const showNow = date === toSaDate() && nowMin >= startMin && nowMin <= endMin;

  const byStaff = useMemo(() => {
    const map = new Map<string, AppointmentWithRelations[]>();
    for (const a of appointments) {
      if (!a.staff_id) continue;
      map.set(a.staff_id, [...(map.get(a.staff_id) ?? []), a]);
    }
    return map;
  }, [appointments]);
  const unassigned = appointments.filter((a) => !a.staff_id && a.status !== 'cancelled');

  function handleLaneClick(e: React.MouseEvent<HTMLDivElement>, staffId: string) {
    if (e.target !== e.currentTarget) return; // clicked an appointment
    const y = e.nativeEvent.offsetY;
    const minute = Math.floor((startMin + y / px) / 15) * 15;
    openWalkIn({ staffId, startsAt: saLocalToIso(date, toHHMM(minute)) });
  }

  if (!staff.length) {
    return <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-ink-muted">Add staff to see calendar lanes.</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {unassigned.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {unassigned.length} request{unassigned.length > 1 ? 's' : ''} without a staff member —{' '}
          {unassigned.map((a, i) => (
            <button key={a.id} className="font-medium underline" onClick={() => selectAppointment(a.id)}>
              {formatTime(a.starts_at)} {a.service?.title}
              {i < unassigned.length - 1 ? ', ' : ''}
            </button>
          ))}
        </div>
      )}

      <div className="flex overflow-x-auto">
        {/* Time axis */}
        <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-slate-100 bg-white">
          <div className="h-12 border-b border-slate-100" />
          <div className="relative" style={{ height }}>
            {hours.map((m) => (
              <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-ink-subtle" style={{ top: (m - startMin) * px }}>
                {toHHMM(m)}
              </span>
            ))}
          </div>
        </div>

        {/* Staff lanes */}
        {staff.map((s) => {
          const intervals = s.working_hours[weekday] ?? [];
          return (
            <div key={s.id} className="min-w-[180px] flex-1 border-r border-slate-100 last:border-r-0">
              <div className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-slate-100 bg-white px-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                  {s.display_name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.display_name}</p>
                  <p className="text-[11px] text-ink-subtle">{intervals.length ? intervals.map((i) => `${i.start}–${i.end}`).join(', ') : 'Off today'}</p>
                </div>
              </div>

              <div
                className="relative cursor-copy bg-hatch"
                style={{ height }}
                onClick={(e) => handleLaneClick(e, s.id)}
                role="grid"
                aria-label={`${s.display_name}'s schedule`}
              >
                {/* Working-hours background (white = available) */}
                {intervals.map((iv) => (
                  <div
                    key={iv.start}
                    className="pointer-events-none absolute inset-x-0 bg-white"
                    style={{ top: (toMin(iv.start) - startMin) * px, height: (toMin(iv.end) - toMin(iv.start)) * px }}
                  />
                ))}
                {/* Hour lines */}
                {hours.map((m) => (
                  <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-slate-100" style={{ top: (m - startMin) * px }} />
                ))}

                {(byStaff.get(s.id) ?? []).map((a) => {
                  const top = (minutesIntoSaDay(a.starts_at) - startMin) * px;
                  const dur = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000);
                  const buf = a.status === 'cancelled' ? 0 : a.buffer_minutes;
                  return (
                    <div key={a.id} className="absolute inset-x-1" style={{ top, height: (dur + buf) * px }}>
                      <button
                        type="button"
                        onClick={() => selectAppointment(a.id)}
                        className={cn(
                          'flex w-full flex-col overflow-hidden rounded-md border-l-4 px-2 py-1 text-left shadow-sm transition hover:shadow-md',
                          STATUS_BLOCK[a.status],
                        )}
                        style={{ height: Math.max(dur * px, 22) }}
                        aria-label={`${a.service?.title ?? 'Appointment'} at ${formatTime(a.starts_at)}, ${a.status}`}
                      >
                        <span className="truncate text-xs font-semibold">
                          {formatTime(a.starts_at)} · {a.service?.title}
                        </span>
                        {dur * px > 34 && (
                          <span className="flex items-center gap-1 truncate text-[11px] opacity-80">
                            {a.is_mobile && <MapPin className="h-3 w-3 shrink-0" aria-label="On-site" />}
                            {a.client?.full_name ?? a.walk_in_name ?? 'Client'}
                            {a.source === 'walk_in' && ' (walk-in)'}
                          </span>
                        )}
                      </button>
                      {buf > 0 && (
                        <div
                          className="pointer-events-none rounded-b-md bg-hatch-amber"
                          style={{ height: buf * px }}
                          title={`${buf} min buffer`}
                          aria-hidden
                        />
                      )}
                    </div>
                  );
                })}

                {showNow && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: (nowMin - startMin) * px }}>
                    <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
