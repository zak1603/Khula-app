import { useCallback, useState } from 'react';
import * as Location from 'expo-location';
import { isInSouthAfrica, type GeoPoint } from '@khula/shared';

export interface ResolvedAddress {
  line1: string;
  suburb: string;
  city: string;
  postalCode: string;
}

/**
 * Foreground-only location (no background permission is ever requested).
 * Coordinates live in memory only; they're sent to the server solely as part
 * of a search query or an on-site booking the user explicitly confirms.
 */
export function useDeviceLocation() {
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'denied' | 'outside_sa' | 'ready' | 'error'>('idle');

  const request = useCallback(async (): Promise<GeoPoint | null> => {
    setStatus('loading');
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        setStatus('denied');
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!isInSouthAfrica(p)) {
        setStatus('outside_sa');
        return null;
      }
      setPoint(p);
      setStatus('ready');
      return p;
    } catch {
      setStatus('error');
      return null;
    }
  }, []);

  return { point, status, request, clear: () => { setPoint(null); setStatus('idle'); } };
}

export async function reverseGeocode(p: GeoPoint): Promise<ResolvedAddress | null> {
  const [r] = await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng });
  if (!r) return null;
  return {
    line1: [r.streetNumber, r.street].filter(Boolean).join(' ') || r.name || '',
    suburb: r.district ?? r.subregion ?? '',
    city: r.city ?? r.region ?? '',
    postalCode: r.postalCode ?? '',
  };
}

export async function geocodeAddress(a: ResolvedAddress): Promise<GeoPoint | null> {
  const results = await Location.geocodeAsync(`${a.line1}, ${a.suburb}, ${a.city}, ${a.postalCode}, South Africa`);
  const r = results[0];
  return r ? { lat: r.latitude, lng: r.longitude } : null;
}
