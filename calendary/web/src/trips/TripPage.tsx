import { useEffect, useState } from 'react';
import { Markdown } from '../markdown';
import { navigate } from '../router';
import { BAGS, MODES, TAGS, tripsApi, type Activity, type Leg, type Trip } from './api';
import { ActivityForm } from './ActivityForm';
import { useTrip } from './hooks';
import { LegForm } from './LegForm';
import { PackTab } from './PackTab';
import { dateRange, dayLabel, hhmm, outsideLegs, programmeOf, toYmd, tripDates, whenText } from './logic';
import { TripForm } from './TripForm';
import { WeatherStrip } from './WeatherStrip';
import './trips.css';

type Tab = 'programme' | 'legs' | 'pack' | 'notes';
const TABS: [Tab, string][] = [['programme', 'Programma'], ['legs', 'Spostamenti'], ['pack', 'Valigia'], ['notes', 'Note']];
const packLabel = (t: Trip) => (t.pack ? `Valigia ${t.pack.checked}/${t.pack.total}` : 'Valigia');

function LegLine({ leg, onOpen }: { leg: Leg; onOpen: () => void }) {
  return (
    <button className="trip-item leg" onClick={onOpen}>
      <span className="mono small">{hhmm(leg.departAt)}</span>
      <span>{MODES[leg.mode].emoji} {[leg.code, [leg.from, leg.to].filter(Boolean).join(' → ')].filter(Boolean).join(' ')}</span>
      <span className="faint tiny">arrivo {hhmm(leg.arriveAt)}</span>
    </button>
  );
}

function ActivityLine({ a, onOpen }: { a: Activity; onOpen: () => void }) {
  return (
    <button className="trip-item" onClick={onOpen}>
      <span className="mono small">{a.time || '·'}</span>
      <span>{TAGS[a.tag].emoji} {a.title}</span>
      {a.place && <span className="faint tiny">📍 {a.place}</span>}
    </button>
  );
}

function Programme({ trip, onLeg, onActivity, onAdd }: { trip: Trip; onLeg: (l: Leg) => void; onActivity: (a: Activity) => void; onAdd: (day: string) => void }) {
  const { before, after } = outsideLegs(trip);
  const unplanned = trip.activities.filter((a) => !a.day);
  return (
    <div className="stack">
      <WeatherStrip trip={trip} />
      {tripDates(trip).map((day, i, all) => {
        const items = programmeOf(trip, day);
        const extraLegs = i === 0 ? before : i === all.length - 1 ? after : [];
        return (
          <section key={day} className="trip-day glass">
            <div className="card-title">
              <b>{dayLabel(day)} · giorno {i + 1}</b>
              <button className="btn sm ghost" onClick={() => onAdd(day)}>＋ Attività</button>
            </div>
            {extraLegs.map((l) => <LegLine key={l.id} leg={l} onOpen={() => onLeg(l)} />)}
            {items.map((it) => (it.kind === 'leg'
              ? <LegLine key={it.leg.id} leg={it.leg} onOpen={() => onLeg(it.leg)} />
              : <ActivityLine key={it.activity.id} a={it.activity} onOpen={() => onActivity(it.activity)} />))}
            {!items.length && !extraLegs.length && <div className="faint small">Giornata libera.</div>}
          </section>
        );
      })}
      {unplanned.length > 0 && (
        <section className="trip-day glass">
          <div className="card-title"><b>Da riprogrammare</b></div>
          {unplanned.map((a) => <ActivityLine key={a.id} a={a} onOpen={() => onActivity(a)} />)}
        </section>
      )}
    </div>
  );
}

function Legs({ trip, onLeg }: { trip: Trip; onLeg: (l: Leg) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!trip.legs.length) return <div className="faint">Nessuna tratta: aggiungi aereo, treno, bus, auto o traghetto.</div>;
  return (
    <div className="stack">
      {trip.legs.map((l) => (
        <section key={l.id} className="glass pad leg-card">
          <div className="card-title">
            <b>{MODES[l.mode].emoji} {MODES[l.mode].label} {l.code}</b>
            <button className="btn sm ghost" onClick={() => onLeg(l)}>Modifica</button>
          </div>
          <div>{l.from || '?'} → {l.to || '?'}</div>
          <div className="muted small">{dayLabel(toYmd(new Date(l.departAt)))} {hhmm(l.departAt)} → {dayLabel(toYmd(new Date(l.arriveAt)))} {hhmm(l.arriveAt)}</div>
          {l.booking && (
            <button className="chip booking" title="Copia" onClick={() => navigator.clipboard?.writeText(l.booking).then(() => { setCopied(l.id); setTimeout(() => setCopied(null), 1500); })}>
              🎫 {l.booking} {copied === l.id ? '· copiato ✓' : ''}
            </button>
          )}
          {l.mode === 'plane' && l.checkinHours && <div className="faint tiny">Check-in: ti avviso {l.checkinHours} h prima della partenza.</div>}
          {l.notes && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{l.notes}</div>}
        </section>
      ))}
    </div>
  );
}

function Notes({ trip }: { trip: Trip }) {
  const [text, setText] = useState(trip.notes);
  const [editing, setEditing] = useState(!trip.notes);
  useEffect(() => setText(trip.notes), [trip.notes]);
  const save = () => {
    if (text !== trip.notes) tripsApi.update(trip.id, { notes: text }).catch(() => {});
    if (text.trim()) setEditing(false);
  };
  if (!editing) {
    return (
      <div className="glass pad stack">
        <Markdown text={text} />
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(true)}>Modifica</button>
      </div>
    );
  }
  return <textarea className="input trip-notes" rows={10} value={text} autoFocus={!!trip.notes} onChange={(e) => setText(e.target.value)} onBlur={save}
    placeholder={'Indirizzo dell’alloggio, contatti, cose da non dimenticare…\n\n- [ ] Adattatore\n- [ ] Crema solare'} />;
}

export function TripPage({ id }: { id: string }) {
  const { data: trip, error, loading, reload } = useTrip(id);
  const [tab, setTab] = useState<Tab>('programme');
  const [editTrip, setEditTrip] = useState(false);
  const [leg, setLeg] = useState<Leg | 'new' | null>(null);
  const [activity, setActivity] = useState<{ a?: Activity; day?: string } | null>(null);

  if (!trip) {
    return (
      <div className="trips-page">
        <div className="page-head"><h1>🧳 Viaggio</h1></div>
        {error ? <div className="alert error">{error}</div> : loading && <div className="faint">…</div>}
        <button className="btn ghost" onClick={() => navigate('/viaggi')}>← Viaggi</button>
      </div>
    );
  }
  const today = toYmd(new Date());
  const remove = async () => {
    if (!window.confirm(`Elimino il viaggio "${trip.name}"? Spariscono anche i suoi eventi dal calendario.`)) return;
    await tripsApi.remove(trip.id);
    navigate('/viaggi');
  };

  return (
    <div className="trips-page">
      <div className="page-head trip-head">
        <button className="btn icon ghost" onClick={() => navigate('/viaggi')} aria-label="Viaggi">←</button>
        <div className="trip-title">
          <h1>{trip.name}</h1>
          <div className="muted small">
            {trip.place ? `📍 ${trip.place.name}${trip.place.country ? `, ${trip.place.country}` : ''} · ` : ''}{dateRange(trip.startDate, trip.endDate)} · {whenText(trip, today)} · {BAGS[trip.bag].emoji} {BAGS[trip.bag].label}{trip.quietAlexa ? ' · 🔕 Alexa in silenzio' : ''}
          </div>
        </div>
        <button className="btn ghost" onClick={() => setEditTrip(true)}>Modifica</button>
        <button className="btn ghost" onClick={remove}>Elimina</button>
      </div>

      <div className="row trip-tabs">
        <div className="seg">
          {TABS.map(([t, label]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'pack' ? packLabel(trip) : label}</button>)}
        </div>
        <span className="spacer" />
        {(tab === 'programme' || tab === 'legs') && <button className="btn sm" onClick={() => setLeg('new')}>＋ Tratta</button>}
      </div>

      {tab === 'programme' && <Programme trip={trip} onLeg={setLeg} onActivity={(a) => setActivity({ a })} onAdd={(day) => setActivity({ day })} />}
      {tab === 'legs' && <Legs trip={trip} onLeg={setLeg} />}
      {tab === 'pack' && <PackTab trip={trip} onChange={reload} />}
      {tab === 'notes' && <Notes trip={trip} />}

      {editTrip && <TripForm trip={trip} onClose={() => setEditTrip(false)} onSaved={() => { setEditTrip(false); reload(); }} />}
      {leg && <LegForm trip={trip} leg={leg === 'new' ? undefined : leg} onClose={() => { setLeg(null); reload(); }} />}
      {activity && <ActivityForm trip={trip} activity={activity.a} day={activity.day} onClose={() => { setActivity(null); reload(); }} />}
    </div>
  );
}
