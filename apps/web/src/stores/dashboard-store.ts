'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { toSaDate } from '@khula/shared';

export interface WalkInDraft {
  staffId: string;
  startsAt: string; // ISO
}

interface DashboardState {
  businessId: string | null;
  calendarDate: string; // YYYY-MM-DD (SA)
  pxPerMinute: number; // calendar zoom
  selectedAppointmentId: string | null;
  walkInDraft: WalkInDraft | null;
  setBusinessId: (id: string) => void;
  setCalendarDate: (date: string) => void;
  zoom: (direction: 'in' | 'out') => void;
  selectAppointment: (id: string | null) => void;
  openWalkIn: (draft: WalkInDraft | null) => void;
}

/**
 * UI-only state. Server data lives in React Query; nothing sensitive is
 * persisted — only the selected business id and zoom level.
 */
export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      businessId: null,
      calendarDate: toSaDate(),
      pxPerMinute: 1.2,
      selectedAppointmentId: null,
      walkInDraft: null,
      setBusinessId: (businessId) => set({ businessId, selectedAppointmentId: null }),
      setCalendarDate: (calendarDate) => set({ calendarDate, selectedAppointmentId: null }),
      zoom: (d) => set((s) => ({ pxPerMinute: Math.min(3, Math.max(0.6, s.pxPerMinute + (d === 'in' ? 0.3 : -0.3))) })),
      selectAppointment: (selectedAppointmentId) => set({ selectedAppointmentId }),
      openWalkIn: (walkInDraft) => set({ walkInDraft }),
    }),
    {
      name: 'khula-dashboard',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ businessId: s.businessId, pxPerMinute: s.pxPerMinute }),
    },
  ),
);
