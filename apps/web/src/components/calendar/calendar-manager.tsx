'use client';

import { ChevronLeft, ChevronRight, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { addDays, formatDate, saLocalToIso, toSaDate } from '@khula/shared';
import { useDayAppointments, useRealtimeAppointments, useServices, useStaff } from '@/hooks/queries';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Button, ErrorNotice, Skeleton } from '@/components/ui/primitives';
import { CalendarGrid } from './calendar-grid';
import { AppointmentPanel } from './appointment-panel';
import { WalkInDialog } from './walk-in-dialog';

export function CalendarManager() {
  const businessId = useDashboardStore((s) => s.businessId);
  const date = useDashboardStore((s) => s.calendarDate);
  const setDate = useDashboardStore((s) => s.setCalendarDate);
  const zoom = useDashboardStore((s) => s.zoom);
  const openWalkIn = useDashboardStore((s) => s.openWalkIn);

  const staff = useStaff(businessId);
  const services = useServices(businessId);
  const appointments = useDayAppointments(businessId, date);
  useRealtimeAppointments(businessId);

  const activeStaff = (staff.data ?? []).filter((s) => s.is_active);
  const isToday = date === toSaDate();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-ink-muted">Click an empty slot to add a walk-in. Hatched blocks are buffer/clean-up time.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-sand-200 bg-white">
            <button className="p-2 hover:bg-sand-50" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="border-x border-sand-200 px-2 py-1.5 text-sm"
              aria-label="Calendar date"
            />
            <button className="p-2 hover:bg-sand-50" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {!isToday && (
            <Button variant="secondary" size="sm" onClick={() => setDate(toSaDate())}>
              Today
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => zoom('out')} aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => zoom('in')} aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            disabled={!activeStaff.length}
            onClick={() => {
              const now = new Date();
              const mins = Math.ceil((now.getUTCHours() * 60 + now.getUTCMinutes() + 120) / 15) * 15; // SA = UTC+2
              const hhmm = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
              openWalkIn({ staffId: activeStaff[0]!.id, startsAt: saLocalToIso(date, isToday ? hhmm : '09:00') });
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> Walk-in
          </Button>
        </div>
      </header>

      <p className="text-sm font-medium text-ink-muted">{formatDate(saLocalToIso(date, '12:00'))}</p>

      <ErrorNotice error={appointments.error ?? staff.error} />

      {staff.isLoading || appointments.isLoading ? (
        <Skeleton className="h-[600px]" />
      ) : (
        <CalendarGrid date={date} staff={activeStaff} appointments={appointments.data ?? []} />
      )}

      <AppointmentPanel appointments={appointments.data ?? []} staff={activeStaff} />
      <WalkInDialog staff={activeStaff} services={(services.data ?? []).filter((s) => s.is_active)} />
    </div>
  );
}
