import { useEffect, useState } from 'react';

/** Full-screen 5-4-3-2-1-VAI countdown: the "5 second rule" against hesitation. */
export function FiveSeconds({ label, onDone }: { label?: string; onDone: () => void }) {
  const [n, setN] = useState(5);

  useEffect(() => {
    if (n < 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setN((v) => v - 1), n === 0 ? 2200 : 1000);
    if ('vibrate' in navigator) navigator.vibrate?.(n === 0 ? [200, 80, 200] : 40);
    return () => clearTimeout(t);
  }, [n, onDone]);

  const colors = ['neon-lime', 'neon-pink', 'neon-violet', 'neon-cyan', 'neon-amber', 'neon-pink'];

  return (
    <div className="five-overlay" onClick={onDone}>
      <div className="stack" style={{ alignItems: 'center', gap: 28 }}>
        <div className="muted mono small">{label ? `Prossima azione: ${label}` : 'Regola dei 5 secondi'}</div>
        <div className={`five-ring ${n <= 0 ? 'go' : ''}`}>
          {n > 0 ? (
            <span key={n} className={`five-num ${colors[n]}`}>{n}</span>
          ) : (
            <span className="five-go neon-lime">VAI!</span>
          )}
        </div>
        <div className="muted">{n > 0 ? 'Niente pensieri: al “1” ti muovi.' : 'Alzati e inizia. Adesso.'}</div>
        <div className="faint tiny">Tocca per chiudere</div>
      </div>
    </div>
  );
}
