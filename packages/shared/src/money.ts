/** Money helpers. All arithmetic is on integer cents; Rand floats never round-trip. */

const zarFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 85000 → "R 850,00" (en-ZA conventions). */
export function formatZar(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return zarFormatter.format(cents / 100);
}

/** Compact for cards/charts: 1250000 → "R12.5k". */
export function formatZarCompact(cents: number): string {
  const rand = cents / 100;
  if (Math.abs(rand) >= 1_000_000) return `R${(rand / 1_000_000).toFixed(1)}m`;
  if (Math.abs(rand) >= 1_000) return `R${(rand / 1_000).toFixed(1)}k`;
  return `R${rand.toFixed(0)}`;
}

/**
 * Parses a human-entered Rand amount into cents without float error.
 * Accepts "850", "850.5", "850,50", "R 1 250.00", "1,250.00", 850.5
 * Returns null for anything ambiguous or malformed.
 */
export function randToCents(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  let s = input.trim().replace(/^R\s*/i, '').replace(/[\s ]/g, '');
  if (s === '') return null;

  // "1,250.00" → thousands comma; "850,50" → decimal comma (common in ZA)
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');

  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** cents → "850.00" for form inputs. */
export function centsToRandString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

/** Banker-safe share: round half away from zero, matching Postgres round(). */
export function applyBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}
