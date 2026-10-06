import { useState } from 'react';
import { navigate } from '../router';
import { BAGS, MODES, type Trip } from './api';
import { useTrips } from './hooks';
import { dateRange, groupTrips, toYmd, weatherIcon, whenText } from './logic';
import { TripForm } from './TripForm';
import './trips.css';

function TripRow({ trip, today }: { trip: Trip; today: string }) {
  const modes = [...new Set(trip.legs.map((l) => MODES[l.mode].emoji))].join(' ');
  const w = trip.weather?.[0];
  return (
    <button className="trip-card glass" onClick={() => navigate(`/viaggi/${trip.id}`)}>
      <div className="trip-card-main">
        <div className="trip-card-name">{trip.name}</div>
        <div className="muted small">{trip.place ? `📍 ${trip.place.name} · ` : ''}{dateRange(trip.startDate, trip.endDate)}</div>
      </div>
      <div className="trip-card-side">
        <span className="chip">{whenText(trip, today)}</span>
        <span className="small">{modes || BAGS[trip.bag].emoji}{w ? ` · ${weatherIcon(w.code, w.rainy)} ${w.max !== null ? Math.round(w.max) : ''}°` : ''}</span>
      </div>
    </button>
  );
}

export function TripsPage() {
  const { data, loading, error } = useTrips();
  const [creating, setCreating] = useState(false);
  const today = toYmd(new Date());
  const { now, next, past } = groupTrips(data, today);
  const section = (title: string, list: Trip[]) => list.length > 0 && (
    <section className="stack">
      <div className="mono small muted">{title}</div>
      {list.map((t) => <TripRow key={t.id} trip={t} today={today} />)}
    </section>
  );
  return (
    <div className="trips-page">
      <div className="page-head">
        <h1>🧳 Viaggi</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>＋ Nuovo viaggio</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {!loading && !data.length && (
        <div className="glass pad stack">
          <div>Nessun viaggio ancora. Crea il primo: date, destinazione e spostamenti finiscono nel calendario senza riempirlo, e i promemoria arrivano da soli.</div>
          <div className="faint small">Puoi anche trasformare in viaggio un evento di più giorni del calendario.</div>
        </div>
      )}
      <div className="stack trips-sections">
        {section('IN CORSO', now)}
        {section('PROSSIMI', next)}
        {section('PASSATI', past)}
      </div>
      {creating && <TripForm onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); navigate(`/viaggi/${t.id}`); }} />}
    </div>
  );
}
