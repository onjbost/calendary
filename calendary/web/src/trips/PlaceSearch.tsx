import { useEffect, useRef, useState } from 'react';
import { tripsApi, type Place, type PlaceHit } from './api';

/** City search on Open-Meteo (through the server), 300 ms after the last keystroke. */
export function PlaceSearch({ value, onChange }: { value: Place | null; onChange: (p: Place | null) => void }) {
  const [q, setQ] = useState(value?.name || '');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    const text = q.trim();
    if (!text || text === value?.name) { setHits([]); return; }
    timer.current = window.setTimeout(() => {
      tripsApi.geocode(text).then((h) => { setHits(h); setError(null); }).catch((e) => setError((e as Error).message));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q, value?.name]);

  return (
    <div className="place-search">
      <input className="input" value={q} placeholder="Cerca la città (es. Cagliari)"
        onChange={(e) => { setQ(e.target.value); if (value) onChange(null); }} />
      {value && <div className="faint tiny">📍 {value.name}{value.country ? `, ${value.country}` : ''}</div>}
      {error && <div className="faint tiny">{error}</div>}
      {hits.length > 0 && (
        <div className="place-hits">
          {hits.map((h) => (
            <button key={`${h.lat},${h.lon}`} type="button" className="place-hit"
              onClick={() => { onChange({ name: h.name, country: h.country, lat: h.lat, lon: h.lon }); setQ(h.name); setHits([]); }}>
              <b>{h.name}</b> <span className="faint">{[h.region, h.country].filter(Boolean).join(', ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
