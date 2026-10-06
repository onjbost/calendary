import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../components/Modal';
import { BAGS, tripsApi, type Pack, type PackGroup, type PackLine, type PackResult, type Trip, type WardrobeHit } from './api';
import { toYmd } from './logic';

const GROUPS: [PackGroup, string][] = [
  ['top', 'Sopra'], ['bottom', 'Sotto'], ['dress', 'Abiti'], ['outerwear', 'Capispalla'], ['shoes', 'Scarpe'],
  ['underwear', 'Intimo e notte'], ['swim', 'Mare'], ['accessory', 'Accessori'], ['essential', 'Da portare'],
];

function Line({ l, readOnly, onToggle, onRemove }: { l: PackLine; readOnly: boolean; onToggle: () => void; onRemove: () => void }) {
  return (
    <div className={`pack-line ${l.checked ? 'done' : ''}`}>
      <input type="checkbox" className="check" checked={l.checked} disabled={readOnly} onChange={onToggle} aria-label={`Spunta ${l.name}`} />
      {l.thumbUrl ? <img src={l.thumbUrl} alt="" className="pack-thumb" loading="lazy" /> : <span className="pack-thumb empty">{l.itemId ? '👕' : '＋'}</span>}
      <div className="pack-name">
        <span>{l.name}{l.qty > 1 && <b className="pack-qty"> ×{l.qty}</b>}{l.dirty && <span className="chip tiny-chip">nel cesto</span>}</span>
        {l.reasons.length > 0 && <span className="faint tiny">{l.reasons.join(' · ')}</span>}
      </div>
      {!readOnly && <button className="chip-x" onClick={onRemove} title="Togli dalla valigia" aria-label={`Togli ${l.name}`}>✕</button>}
    </div>
  );
}

function AddItem({ trip, onClose, onAdded }: { trip: Trip; onClose: () => void; onAdded: (r: PackResult) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<WardrobeHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      tripsApi.wardrobe(q.trim()).then(setHits).catch((e) => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);
  const add = (id: string) => tripsApi.addPackItem(trip.id, id).then(onAdded).catch((e) => setError((e as Error).message));
  return (
    <Modal title="Aggiungi un capo" onClose={onClose} glow="cyan">
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nell'armadio di WardApp" />
        <div className="pack-hits">
          {hits.map((h) => (
            <button key={h.id} className="pack-hit" onClick={() => add(h.id)}>
              {h.thumbUrl ? <img src={h.thumbUrl} alt="" className="pack-thumb" /> : <span className="pack-thumb empty">👕</span>}
              <span>{h.name}</span>
            </button>
          ))}
          {!hits.length && <div className="faint small">Nessun capo trovato.</div>}
        </div>
      </div>
    </Modal>
  );
}

function BackHome({ trip, pack, onClose }: { trip: Trip; pack: Pack; onClose: () => void }) {
  const items = pack.lines.filter((l) => l.itemId && (l.checked || l.worn));
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(items.map((l) => l.itemId!)));
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    try {
      const r = await tripsApi.returnFromTrip(trip.id, [...chosen]);
      setDone(`Fatto: ${chosen.size} capi nel cesto di WardApp (in tutto ${r.count}).`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="🏠 Sono tornato" onClose={onClose} glow="cyan"
      footer={done ? <button className="btn primary" onClick={onClose}>Chiudi</button> : <>
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={send} disabled={!chosen.size}>Metti {chosen.size} capi nel cesto</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        {done ? <div className="alert ok">{done}</div> : (
          <>
            <div className="muted small">I capi che hai portato vanno nel cesto dei panni di WardApp. Togli la spunta a quelli che non hai usato.</div>
            {items.map((l) => (
              <label key={l.key} className="row nowrap small">
                <input type="checkbox" className="check" checked={chosen.has(l.itemId!)}
                  onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(l.itemId!); else n.delete(l.itemId!); return n; })} />
                {l.name}
              </label>
            ))}
            {!items.length && <div className="faint small">Nessun capo spuntato in valigia.</div>}
          </>
        )}
      </div>
    </Modal>
  );
}

/** "Valigia" tab of a trip: the list WardApp prepared, to tick while packing. */
export function PackTab({ trip, onChange }: { trip: Trip; onChange?: () => void }) {
  const [res, setRaw] = useState<PackResult | null>(null);
  // the trip carries the pack counts (tab label, cards): reload it after every change of the list
  const setRes = (r: PackResult) => { setRaw(r); onChange?.(); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [back, setBack] = useState(false);

  const load = useCallback(() => tripsApi.pack(trip.id).then(setRaw).catch((e) => setError((e as Error).message)), [trip.id]);
  useEffect(() => { load(); }, [load]);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      setRes(await tripsApi.preparePack(trip.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = (p: Promise<PackResult>) => p.then(setRes).catch((e) => setError((e as Error).message));

  if (!res) return <div className="glass pad">{error ? <div className="alert error">{error}</div> : <span className="faint">…</span>}</div>;
  if (!res.enabled) {
    return <div className="glass pad stack"><b>🧳 Valigia</b><div>Collega WardApp (opzioni <code>wardapp_url</code> e <code>api_token</code>) per preparare la valigia con i capi del tuo armadio.</div></div>;
  }
  const pack = res.pack;
  const readOnly = res.stale;
  if (!pack) {
    return (
      <div className="glass pad stack">
        <b>🧳 Valigia</b>
        <div>WardApp prepara la lista con i capi del tuo armadio: outfit per ogni attività del programma, riuso, essenziali, cosa indossare in partenza, adatta al bagaglio ({BAGS[trip.bag].label}) e al meteo.</div>
        {(error || res.error) && <div className="alert error">{error || res.error}</div>}
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={prepare} disabled={busy}>{busy ? 'Preparo…' : 'Prepara la valigia'}</button>
      </div>
    );
  }
  const cap = pack.capacity;
  const pct = cap ? Math.min(100, Math.round((cap.used / cap.max) * 100)) : 0;
  const worn = pack.lines.filter((l) => l.worn);
  const today = toYmd(new Date());
  return (
    <div className="stack">
      {readOnly && <div className="alert row">WardApp non risponde: è l'ultima lista ricevuta, in sola lettura. {res.error} <button className="btn sm" onClick={load}>Riprova</button></div>}
      {!readOnly && res.error && <div className="alert row">Non sono riuscito a rigenerare: {res.error} <button className="btn sm" onClick={prepare} disabled={busy}>Riprova</button></div>}
      {error && <div className="alert error">{error}</div>}
      {trip.weatherChanged && !readOnly && (
        <div className="alert row">Il meteo è cambiato da quando hai preparato la valigia. <button className="btn sm" onClick={prepare} disabled={busy}>Rigenera</button></div>
      )}
      <section className="glass pad stack">
        <div className="card-title pack-head">
          <b>🧳 {pack.counts.checked}/{pack.counts.total} in valigia</b>
          <div className="row pack-actions">
            {!readOnly && <button className="btn sm ghost" onClick={() => setAdding(true)}>＋ Aggiungi capo</button>}
            {!readOnly && <button className="btn sm" onClick={prepare} disabled={busy}>{busy ? 'Preparo…' : '↻ Rigenera'}</button>}
            {!readOnly && today >= trip.endDate && <button className="btn sm primary" onClick={() => setBack(true)}>🏠 Sono tornato</button>}
          </div>
        </div>
        {cap && (
          <div className="stack" style={{ gap: 4 }}>
            <div className={`pack-bar ${cap.fits ? '' : 'over'}`}><span style={{ width: `${pct}%` }} /></div>
            <div className="faint tiny">{BAGS[trip.bag].emoji} {BAGS[trip.bag].label}: {Math.round(cap.used * 10) / 10} su {cap.max} punti di ingombro{cap.fits ? '' : ' · non ci sta'}</div>
          </div>
        )}
        {pack.warnings.map((w) => <div key={w} className="alert small">{w}</div>)}
      </section>

      {worn.length > 0 && (
        <section className="glass pad stack pack-group">
          <b>Da indossare in partenza</b>
          {worn.map((l) => <Line key={`w-${l.key}`} l={l} readOnly={readOnly} onToggle={() => act(tripsApi.markPackItem(trip.id, l.key, { checked: !l.checked }))} onRemove={() => act(tripsApi.markPackItem(trip.id, l.key, { removed: true }))} />)}
        </section>
      )}
      {GROUPS.map(([g, label]) => {
        const ls = pack.lines.filter((l) => l.group === g && !l.worn);
        if (!ls.length) return null;
        return (
          <section key={g} className="glass pad stack pack-group">
            <b>{label}</b>
            {ls.map((l) => <Line key={l.key} l={l} readOnly={readOnly} onToggle={() => act(tripsApi.markPackItem(trip.id, l.key, { checked: !l.checked }))} onRemove={() => act(tripsApi.markPackItem(trip.id, l.key, { removed: true }))} />)}
          </section>
        );
      })}
      {pack.tips.length > 0 && (
        <section className="glass pad stack">
          <b>Consigli{pack.ai ? ' ✨' : ''}</b>
          <ul className="pack-tips">{pack.tips.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      )}
      {adding && <AddItem trip={trip} onClose={() => setAdding(false)} onAdded={(r) => { setRes(r); setAdding(false); }} />}
      {back && <BackHome trip={trip} pack={pack} onClose={() => setBack(false)} />}
    </div>
  );
}
