/** Time helpers pinned to South African time (no DST, UTC+2). */
export const APP_TIMEZONE = 'Africa/Johannesburg';

const timeFmt = new Intl.DateTimeFormat('en-ZA', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('en-ZA', { timeZone: APP_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short' });
const isoDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });

export function formatTime(iso: string | Date): string {
  return timeFmt.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function formatDate(iso: string | Date): string {
  return dateFmt.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function formatDateTime(iso: string | Date): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}

/** "YYYY-MM-DD" for the given instant, in SA time. */
export function toSaDate(d: Date = new Date()): string {
  return isoDateFmt.format(d);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Minutes since local (SA) midnight for an instant — used to place calendar blocks. */
export function minutesIntoSaDay(iso: string | Date): number {
  const [h, m] = partsFmt.format(typeof iso === 'string' ? new Date(iso) : iso).split(':').map(Number) as [number, number];
  return (h % 24) * 60 + m;
}

/** Builds an ISO instant for a SA-local date + "HH:MM" (SA is fixed UTC+02:00). */
export function saLocalToIso(isoDate: string, hhmm: string): string {
  return new Date(`${isoDate}T${hhmm}:00+02:00`).toISOString();
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
