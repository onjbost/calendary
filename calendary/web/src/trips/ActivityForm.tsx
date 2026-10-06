import { useState } from 'react';
import { Modal } from '../components/Modal';
import { TAGS, tripsApi, type Activity, type TagId, type Trip } from './api';
import { dayLabel, tripDates } from './logic';

/** An activity of the programme: new (on a day) or edited. With a time it goes in the calendar. */
export function ActivityForm({ trip, activity, day, onClose }: { trip: Trip; activity?: Activity; day?: string; onClose: () => void }) {
  const [tag, setTag] = useState<TagId>(activity?.tag || 'city');
  const [title, setTitle] = useState(activity?.title || '');
  const [d, setDay] = useState(activity ? activity.day : day || trip.startDate);
  const [time, setTime] = useState(activity?.time || '');
  const [minutes, setMinutes] = useState(String(activity?.minutes ?? 120));
  const [place, setPlace] = useState(activity?.place || '');
  const [notes, setNotes] = useState(activity?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const draft = { tag, title: title.trim() || TAGS[tag].label, day: d, time, minutes: Number(minutes) || 120, place, notes };
      if (activity) await tripsApi.updateActivity(activity.id, draft);
      else await tripsApi.addActivity(trip.id, draft);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!activity || !window.confirm('Elimino questa attività?')) return;
    await tripsApi.removeActivity(activity.id).then(onClose).catch((e) => setError((e as Error).message));
  };

  return (
    <Modal title={activity ? "Modifica l'attività" : '＋ Attività'} onClose={onClose} glow="cyan"
      footer={<>
        {activity && <button className="btn ghost" onClick={remove}>Elimina</button>}
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={save} disabled={busy}>Salva</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <div className="tag-pick">
          {(Object.keys(TAGS) as TagId[]).map((t) => (
            <button key={t} type="button" className={`chip ${tag === t ? 'on' : ''}`} onClick={() => setTag(t)}>{TAGS[t].emoji} {TAGS[t].label}</button>
          ))}
        </div>
        <label className="field">Cosa<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tag === 'dinner' ? 'Cena da Su Gologone' : TAGS[tag].label} /></label>
        <div className="grid-2">
          <label className="field">Giorno
            <select className="input" value={d} onChange={(e) => setDay(e.target.value)}>
              {d === '' && <option value="">Da riprogrammare</option>}
              {tripDates(trip).map((x, i) => <option key={x} value={x}>{dayLabel(x)} · giorno {i + 1}</option>)}
            </select>
          </label>
          <label className="field">Ora (facoltativa)
            <span className="row"><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              {time && <button type="button" className="btn sm ghost" onClick={() => setTime('')}>✕</button>}</span>
          </label>
        </div>
        {time && <label className="field">Durata (minuti)<input className="input" type="number" min={5} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>}
        <div className="faint tiny">{time ? 'Con l’orario finisce anche nel calendario.' : 'Senza orario resta solo nel programma del viaggio.'}</div>
        <label className="field">Dove<input className="input" value={place} onChange={(e) => setPlace(e.target.value)} /></label>
        <label className="field">Note<textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
    </Modal>
  );
}
