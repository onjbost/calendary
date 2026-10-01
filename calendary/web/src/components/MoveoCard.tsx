import type { MoveoSession } from '../api';
import { useMoveo, openMoveo } from '../suite';

const EMOJI: Record<string, string> = { desk: '🪑', recovery: '🌿', yoga: '🧘', pilates: '⭕', calisthenics: '💪', surf: '🏄' };

function when(s: MoveoSession) {
  const today = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today.getTime() + 86400e3);
  const day = s.date === ymd(today) ? 'Oggi' : s.date === ymd(tomorrow) ? 'Domani'
    : new Date(`${s.date}T12:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} alle ${s.time}`;
}

/** "Allenamento di oggi" card: next Moveo session and desk breaks, with one-tap start (already signed in). */
export function MoveoCard({ className = '', kiosk = false }: { className?: string; kiosk?: boolean }) {
  const m = useMoveo();
  if (!m || !m.enabled) return null;

  const main = m.session || m.next || null;
  const b = m.breaks;

  return (
    <section className={`glass pad moveo-card ${className}`}>
      <div className="card-title" style={{ marginBottom: 10 }}>
        {kiosk ? <h3>🏃 Allenamento</h3> : <h2 className="neon-cyan">🏃 Allenamento</h2>}
        <div className="row" style={{ gap: 6 }}>
          {!!m.streak && <span className="chip" title="Giorni di fila con almeno un allenamento o una pausa">🔥 {m.streak}</span>}
          {!kiosk && m.minutesWeek !== undefined && <span className="chip">{m.minutesWeek} min/sett.</span>}
          <button className="btn sm ghost" onClick={() => openMoveo(kiosk ? '/tablet' : '/')}>{kiosk ? '↗' : 'Moveo ↗'}</button>
        </div>
      </div>

      {m.error ? (
        <div className="muted small">{m.error}</div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {main ? (
            <div className="row nowrap" style={{ gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: '1.7rem' }}>{main.emoji || EMOJI[main.category || ''] || '🏃'}</div>
              <div className="grow" style={{ minWidth: 0 }}>
                {!kiosk && <div className="muted small mono">{m.session ? 'OGGI' : 'PROSSIMO'} · {main.programTitle.toUpperCase()}</div>}
                <div className="ellipsis" style={{ fontSize: '1.1rem', fontWeight: 600 }}>{main.title}</div>
                <div className="muted small ellipsis">{when(main)} · ≈ {main.durationMin} min{kiosk ? '' : ` · sett. ${main.week}${main.weeks ? `/${main.weeks}` : ''}`}</div>
              </div>
              <button className="btn primary" onClick={() => openMoveo(main.path)}>▶ {m.session ? 'Avvia' : kiosk ? 'Vai' : 'Anticipa'}</button>
            </div>
          ) : (
            <div className="muted small">
              {m.doneToday?.length ? `Fatto oggi: ${m.doneToday.map((d) => d.title).join(', ')} 💪` : 'Nessun allenamento pianificato. Scegli un programma in Moveo e premi “Pianifica”.'}
            </div>
          )}

          {b && (
            <div className="row" style={{ gap: 10, justifyContent: 'space-between' }}>
              <div className="small">
                <b>🪑 Pause</b> <span className="muted">{b.done}/{b.total} oggi</span>
                {b.paused ? <span className="faint"> · sospese</span>
                  : b.open ? <span className="neon-amber"> · ora: {b.open.title}</span>
                    : b.next ? <span className="faint"> · prossima {new Date(b.next.dueAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span> : null}
              </div>
              <button className="btn pink sm" onClick={() => openMoveo(b.open?.path || '/pausa')}>Pausa adesso</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
