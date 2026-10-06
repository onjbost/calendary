import { useState } from 'react';
import { Modal } from '../components/Modal';
import { BAGS, tripsApi, type BagId, type Place, type Trip } from './api';
import { PlaceSearch } from './PlaceSearch';
import { addDaysYmd, toYmd } from './logic';

/** New trip, or edit of an existing one. */
export function TripForm({ trip, onClose, onSaved }: { trip?: Trip; onClose: () => void; onSaved: (t: Trip) => void }) {
  const today = toYmd(new Date());
  const [name, setName] = useState(trip?.name || '');
  const [place, setPlace] = useState<Place | null>(trip?.place || null);
  const [startDate, setStart] = useState(trip?.startDate || addDaysYmd(today, 7));
  const [endDate, setEnd] = useState(trip?.endDate || addDaysYmd(today, 10));
  const [bag, setBag] = useState<BagId>(trip?.bag || 'cabin');
  const [canWash, setCanWash] = useState(trip?.canWash || false);
  const [quietAlexa, setQuiet] = useState(trip?.quietAlexa || false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const draft = { name: name.trim() || place?.name || '', place, startDate, endDate, bag, canWash, quietAlexa };
      onSaved(trip ? await tripsApi.update(trip.id, draft) : await tripsApi.create(draft));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={trip ? 'Modifica il viaggio' : '🧳 Nuovo viaggio'} onClose={onClose} glow="cyan"
      footer={<>
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={save} disabled={busy}>{trip ? 'Salva' : 'Crea il viaggio'}</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <label className="field">Destinazione
          <PlaceSearch value={place} onChange={setPlace} />
        </label>
        <label className="field">Nome del viaggio
          <input className="input" value={name} placeholder={place?.name || 'Es. Sardegna'} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid-2">
          <label className="field">Partenza
            <input className="input" type="date" value={startDate} onChange={(e) => { setStart(e.target.value); if (e.target.value > endDate) setEnd(e.target.value); }} />
          </label>
          <label className="field">Ritorno
            <input className="input" type="date" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <div className="trip-field">Bagaglio
          <div className="bag-pick">
            {(Object.keys(BAGS) as BagId[]).map((b) => (
              <button key={b} type="button" className={`bag-opt ${bag === b ? 'on' : ''}`} onClick={() => setBag(b)}>
                <span className={b === 'backpack_s' ? 'bag-small' : ''}>{BAGS[b].emoji}</span>
                <span className="tiny">{BAGS[b].label}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="row nowrap small"><input type="checkbox" className="check" checked={canWash} onChange={(e) => setCanWash(e.target.checked)} /> Posso fare il bucato durante il viaggio</label>
        <label className="row nowrap small"><input type="checkbox" className="check" checked={quietAlexa} onChange={(e) => setQuiet(e.target.checked)} /> Alexa in silenzio durante il viaggio (modalità viaggio)</label>
      </div>
    </Modal>
  );
}
