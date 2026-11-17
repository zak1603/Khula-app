import type { GeoPoint } from './types';

const EARTH_RADIUS_KM = 6371.0088;

export const SA_BOUNDS = { minLat: -35.5, maxLat: -21.5, minLng: 16, maxLng: 33.5 } as const;

export function isInSouthAfrica({ lat, lng }: GeoPoint): boolean {
  return lat >= SA_BOUNDS.minLat && lat <= SA_BOUNDS.maxLat && lng >= SA_BOUNDS.minLng && lng <= SA_BOUNDS.maxLng;
}

/** Great-circle distance in km (haversine). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Client-side pre-check for mobile_onsite bookings (UX only).
 * The server (PostGIS ST_DWithin) is authoritative. Because the public
 * business location is fuzzed to ~1 km, we allow a small tolerance here and
 * let the server make the final call.
 */
export function isWithinTravelRadius(base: GeoPoint, client: GeoPoint, radiusKm: number, toleranceKm = 1.5): boolean {
  return haversineKm(base, client) <= radiusKm + toleranceKm;
}

export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}
