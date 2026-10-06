import { navigate } from '../router';
import { MODES, TAGS } from './api';
import { useTrips } from './hooks';
import { dateRange, daysUntil, groupTrips, hhmm, programmeOf, toYmd, whenText } from './logic';
import { WeatherStrip } from './WeatherStrip';
import './trips.css';

/** Dashboard card: the trip in progress, or the next one leaving within 7 days. Nothing otherwise. */
export function TripCard({ className = '' }: { className?: string }) {
  const { data } = useTrips();
  const today = toYmd(new Date());
  const { now, next } = groupTrips(data, today);
  const trip = now[0] || next.find((t) => daysUntil(t.startDate, today) <= 7);
  if (!trip) return null;
  const inProgress = now[0] === trip;
  const items = inProgress ? programmeOf(trip, today) : [];
  const firstLeg = trip.legs[0];
  return (
    <section className={`glass pad trip-dash ${className}`} onClick={() => navigate(`/viaggi/${trip.id}`)} style={{ cursor: 'pointer' }}>
      <div className="card-title" style={{ marginBottom: 10 }}>
        <h2 style={{ color: '#7dd3fc' }}>🧳 {trip.place?.name || trip.name}</h2>
        <span className="chip">{whenText(trip, today)}</span>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="muted small">{trip.name !== (trip.place?.name || trip.name) ? `${trip.name} · ` : ''}{dateRange(trip.startDate, trip.endDate)}</div>
        <WeatherStrip trip={trip} compact />
        {inProgress ? (
          items.length ? items.slice(0, 4).map((it) => (
            <div key={it.kind === 'leg' ? it.leg.id : it.activity.id} className="small">
              {it.kind === 'leg'
                ? `${hhmm(it.leg.departAt)} ${MODES[it.leg.mode].emoji} ${[it.leg.from, it.leg.to].filter(Boolean).join(' → ')}`
                : `${it.activity.time || '·'} ${TAGS[it.activity.tag].emoji} ${it.activity.title}`}
            </div>
          )) : <div className="faint small">Oggi giornata libera.</div>
        ) : firstLeg ? (
          <div className="small">{MODES[firstLeg.mode].emoji} {[firstLeg.code, [firstLeg.from, firstLeg.to].filter(Boolean).join(' → ')].filter(Boolean).join(' ')} · {hhmm(firstLeg.departAt)}</div>
        ) : null}
      </div>
    </section>
  );
}
