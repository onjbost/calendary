import { useMemo } from 'react';
import { navigate } from '../router';
import type { TripDay } from './api';
import { useTripDays } from './hooks';
import { groupDaysByDate } from './logic';
import './trips.css';

/** Day strips of a date range, by date (YYYY-MM-DD → strips). `to` is included. */
export function useTripDayMap(from: string, to: string) {
  const { data } = useTripDays(from, to);
  return useMemo(() => groupDaysByDate(data), [data]);
}

/** "🌴 In viaggio · Cagliari · 3/5": opens the trip. Clicks don't reach the day cell below. */
export function DayStrips({ days, big = false, short = false }: { days: TripDay[] | undefined; big?: boolean; short?: boolean }) {
  if (!days?.length) return null;
  return (
    <div className="trip-strips">
      {days.map((d) => (
        <button key={d.tripId} type="button" className={`trip-strip ${big ? 'big' : ''}`} title={d.label}
          onClick={(e) => { e.stopPropagation(); navigate(`/viaggi/${d.tripId}`); }}>
          <span>{d.emoji}</span>
          <span>{short ? d.name : d.label}</span>
        </button>
      ))}
    </div>
  );
}
