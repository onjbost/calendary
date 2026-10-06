// Data hooks of the trips pages: load, then reload on live "changed" (trips, and events: a trip's events can be
// edited from the calendar).
import { useCallback, useEffect, useRef, useState } from 'react';
import { onChanged } from '../live';
import { tripsApi, type Trip, type TripDay } from './api';

function useLoad<T>(key: string, load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await loadRef.current();
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    reload();
    const offs = [onChanged('trips', reload), onChanged('events', reload)];
    return () => offs.forEach((off) => off());
  }, [key, reload]);
  return { data, setData, error, loading, reload };
}

export const useTrips = () => useLoad<Trip[]>('trips', () => tripsApi.list(), []);
export const useTrip = (id: string) => useLoad<Trip | null>(`trip:${id}`, () => tripsApi.get(id), null);
/** Day strips for the calendar views; an empty list when the module can't answer (never breaks the calendar). */
export const useTripDays = (from: string, to: string) =>
  useLoad<TripDay[]>(`days:${from}:${to}`, () => tripsApi.days(from, to).catch(() => []), []);
