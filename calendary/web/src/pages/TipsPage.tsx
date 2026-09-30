import { useState } from 'react';
import { TipCard } from '../components/TipCard';
import { CATEGORY_LABEL, TIPS, tipOfTheDay, type TipCategory } from '../tips';
import { useUI } from '../ui';

export function TipsPage() {
  const { startFive } = useUI();
  const [cat, setCat] = useState<TipCategory | 'all'>('all');
  const today = tipOfTheDay();
  const list = TIPS.filter((t) => cat === 'all' || t.category === cat);

  return (
    <div>
      <div className="page-head"><h1>Tips & motivazione</h1></div>

      <div className="dash" style={{ marginBottom: 22 }}>
        <section className="glass pad span-7 glow-pink stack" style={{ justifyContent: 'center' }}>
          <div className="mono small neon-pink">REGOLA DEI 5 SECONDI</div>
          <h1 className="neon-pink" style={{ fontSize: '2.2rem' }}>5 · 4 · 3 · 2 · 1</h1>
          <div>Quando devi fare qualcosa di importante e senti che stai esitando, conta all'indietro da 5 e al “1” muoviti. Il conto alla rovescia sposta l'attenzione dal dubbio all'azione, prima che il cervello trovi una scusa.</div>
          <button className="btn pink lg" style={{ alignSelf: 'flex-start' }} onClick={() => startFive()}>Avvia il conto alla rovescia</button>
        </section>
        <div className="span-5 stack">
          <div className="muted mono small">TIP DEL GIORNO</div>
          <TipCard tip={today} className="glow-amber" />
        </div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>Tutti</button>
          {(Object.keys(CATEGORY_LABEL) as TipCategory[]).map((c) => (
            <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]}</button>
          ))}
        </div>
      </div>
      <div className="tips-grid">
        {list.map((t) => <TipCard key={t.id} tip={t} />)}
      </div>
    </div>
  );
}
