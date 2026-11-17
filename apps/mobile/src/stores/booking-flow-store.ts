import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { toSaDate, type BookingAddress } from '@khula/shared';

export type BookingStep = 'staff' | 'time' | 'location' | 'details' | 'review';

interface BookingFlowState {
  serviceId: string | null;
  staffId: string | null; // null = any available professional
  date: string;
  slotStart: string | null;
  slotStaffId: string | null;
  address: BookingAddress | null;
  message: string;
  /** Generated once per flow so network retries never create duplicate bookings. */
  idempotencyKey: string;
  start: (serviceId: string) => void;
  set: (patch: Partial<Omit<BookingFlowState, 'start' | 'set' | 'reset'>>) => void;
  reset: () => void;
}

const initial = () => ({
  serviceId: null,
  staffId: null,
  date: toSaDate(),
  slotStart: null,
  slotStaffId: null,
  address: null,
  message: '',
  idempotencyKey: Crypto.randomUUID(),
});

/** Ephemeral (not persisted): the client's address never touches disk. */
export const useBookingFlow = create<BookingFlowState>()((set, get) => ({
  ...initial(),
  start: (serviceId) => {
    if (get().serviceId !== serviceId) set({ ...initial(), serviceId });
  },
  set: (patch) => set(patch),
  reset: () => set(initial()),
}));
