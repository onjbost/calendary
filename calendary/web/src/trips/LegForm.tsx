import { useState } from 'react';
import { Modal } from '../components/Modal';
import { MODES, tripsApi, type Leg, type ModeId, type Trip } from './api';
import { hhmm, toYmd } from './logic';

const iso = (day: string, time: string) => new Date(`${day}T${time}`).toISOString();

/** A leg (plane, train, bus, car, ferry): new or edited. */
export function LegForm({ trip, leg, onClose }: { trip: Trip; leg?: Leg; onClose: () => void }) {
  const first = leg ? toYmd(new Date(leg.departAt)) : trip.startDate;
  const [mode, setMode] = useState<ModeId>(leg?.mode || 'plane');
  const [from, setFrom] = useState(leg?.from || '');
  const [to, setTo] = useState(leg?.to || trip.place?.name || '');
  const [departDay, setDepartDay] = useState(first);
  const [departTime, setDepartTime] = useState(leg ? hhmm(leg.departAt) : '09:00');
  const [arriveDay, setArriveDay] = useState(leg ? toYmd(new Date(leg.arriveAt)) : first);
  const [arriveTime, setArriveTime] = useState(leg ? hhmm(leg.arriveAt) : '11:00');
  const [code, setCode] = useState(leg?.code || '');
  const [booking, setBooking] = useState(leg?.booking || '');
  const [checkin, setCheckin] = useState(String(leg?.checkinHours ?? 24));
  const [notes, setNotes] = useState(leg?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const draft = {
        mode, from, to, code, booking, notes,
        departAt: iso(departDay, departTime), arriveAt: iso(arriveDay, arriveTime),
        checkinHours: mode === 'plane' ? Number(checkin) || 24 : null,
      };
      if (leg) await tripsApi.updateLeg(leg.id, draft);
      else await tripsApi.addLeg(trip.id, draft);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!leg || !window.confirm('Elimino questa tratta? Sparisce anche dal calendario.')) return;
    await tripsApi.removeLeg(leg.id).then(onClose).catch((e) => setError((e as Error).message));
  };

  return (
    <Modal title={leg ? 'Modifica la tratta' : '＋ Tratta'} onClose={onClose} glow="cyan"
      footer={<>
        {leg && <button className="btn ghost" onClick={remove}>Elimina</button>}
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={save} disabled={busy}>Salva</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <div className="seg mode-seg">
          {(Object.keys(MODES) as ModeId[]).map((m) => (
            <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{MODES[m].emoji} {MODES[m].label}</button>
          ))}
        </div>
        <div className="grid-2">
          <label className="field">Da<input className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Pisa" /></label>
          <label className="field">A<input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Cagliari" /></label>
        </div>
        <div className="grid-2">
          <label className="field">Partenza
            <span className="row"><input className="input" type="date" value={departDay} onChange={(e) => { setDepartDay(e.target.value); if (e.target.value > arriveDay) setArriveDay(e.target.value); }} />
              <input className="input" type="time" value={departTime} onChange={(e) => setDepartTime(e.target.value)} /></span>
          </label>
          <label className="field">Arrivo
            <span className="row"><input className="input" type="date" value={arriveDay} onChange={(e) => setArriveDay(e.target.value)} />
              <input className="input" type="time" value={arriveTime} onChange={(e) => setArriveTime(e.target.value)} /></span>
          </label>
        </div>
        <div className="grid-2">
          <label className="field">{mode === 'plane' ? 'Numero del volo' : mode === 'train' ? 'Numero del treno' : 'Codice (facoltativo)'}
            <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={mode === 'plane' ? 'FR1234' : ''} /></label>
          <label className="field">Codice di prenotazione<input className="input" value={booking} onChange={(e) => setBooking(e.target.value.toUpperCase())} /></label>
        </div>
        {mode === 'plane' && (
          <label className="field">Il check-in si apre (ore prima della partenza)
            <input className="input" type="number" min={1} max={720} value={checkin} onChange={(e) => setCheckin(e.target.value)} />
            <span className="faint tiny">Ti avviso quando si apre. Di solito 24 h; alcune compagnie 48 h o più.</span>
          </label>
        )}
        <label className="field">Note<textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Terminal, posto, bagaglio…" /></label>
      </div>
    </Modal>
  );
}
