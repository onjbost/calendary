import { useEffect, useState } from 'react';
import { api, type MoveoOverview, type MoveoSession } from '../api';
import { fmt } from '../dates';
import { openMoveo } from '../suite';

const EMOJI: Record<string, string> = { desk: '🪑', recovery: '🌿', yoga: '🧘', pilates: '⭕', calisthenics: '💪', surf: '🏄' };
const emojiOf = (x: { emoji?: string; category?: string | null }) => x.emoji || EMOJI[x.category || ''] || '🏃';

function whenLabel(s: MoveoSession) {
  const today = fmt(new Date(), 'yyyy-MM-dd');
  const tomorrow = fmt(new Date(Date.now() + 86400e3), 'yyyy-MM-dd');
  const day = s.date === today ? 'Oggi' : s.date === tomorrow ? 'Domani' : fmt(new Date(`${s.date}T12:00`), 'EEE d MMM');
  return `${day} · ${s.time}`;
}

/** Moveo summary for the tablet tab, refreshed every 2 minutes. */
function useMoveoOverview() {
  const [data, setData] = useState<MoveoOverview | null>(null);
  useEffect(() => {
    const load = () => api.moveoOverview().then(setData).catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);
  return data;
}

/** Tablet "Moveo" tab: next and last workouts, desk breaks with "Fai una pausa", programs. */
export function MoveoBoard() {
  const m = useMoveoOverview();
  if (!m) return <div className="empty">Caricamento…</div>;
  if (!m.enabled) {
    return <div className="empty">Moveo non è collegato: imposta <code>api_token</code>, <code>moveo_url</code> e <code>moveo_public_url</code> nella configurazione dell'add-on.</div>;
  }
  if (m.error) return <div className="alert error">{m.error}</div>;

  const upcoming = m.upcoming?.length ? m.upcoming : [m.session, m.next].filter((x): x is MoveoSession => !!x);
  const b = m.breaks;

  return (
    <div className="kiosk-body moveo-board">
      <div className="kiosk-col col-scroll">
        <section className="glass pad glow-cyan">
          <div className="card-title"><h2>▶ Prossimi allenamenti</h2></div>
          {!upcoming.length && <div className="muted">Nessun allenamento pianificato. Scegli un programma e premi “Pianifica”.</div>}
          <div className="stack" style={{ gap: 10 }}>
            {upcoming.map((s, i) => (
              <div key={`${s.path}|${i}`} className="mv-row">
                <div className="mv-emoji">{emojiOf(s)}</div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 600 }}>{s.title}</div>
                  <div className="muted small ellipsis">{whenLabel(s)} · ≈ {s.durationMin} min · {s.programTitle}</div>
                </div>
                <button className={`btn ${i === 0 ? 'primary' : ''}`} onClick={() => openMoveo(s.path)}>▶ {i === 0 && m.session ? 'Avvia' : 'Vai'}</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="kiosk-col col-scroll">
        <section className="glass pad glow-pink mv-break">
          <div className="card-title"><h2>🪑 Pause</h2>{b && <span className="chip">{b.done}/{b.total} oggi</span>}</div>
          <button className="btn pink lg mv-break-btn" onClick={() => openMoveo(b?.open?.path || '/pausa')}>Fai una pausa</button>
          {b && (
            <div className="muted small" style={{ marginTop: 10 }}>
              {b.paused ? 'Pause sospese per oggi'
                : b.open ? <span className="neon-amber">Adesso: {b.open.title}</span>
                  : b.next ? `Prossima alle ${fmt(b.next.dueAt, 'HH:mm')}: ${b.next.title}` : 'Nessun\'altra pausa oggi'}
            </div>
          )}
        </section>
        <section className="glass pad">
          <div className="card-title"><h2>✓ Ultimi allenamenti</h2></div>
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            {!!m.streak && <span className="chip">🔥 {m.streak} {m.streak === 1 ? 'giorno' : 'giorni'} di fila</span>}
            {m.minutesWeek !== undefined && <span className="chip">⏱ {m.minutesWeek} min questa settimana</span>}
          </div>
          {m.recent?.length ? (
            <div className="stack" style={{ gap: 8 }}>
              {m.recent.map((r, i) => (
                <div key={`${r.finishedAt}|${i}`} className="mv-row small">
                  <div className="mv-emoji sm">{emojiOf(r)}</div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis">{r.title}</div>
                    <div className="faint tiny">{fmt(r.finishedAt, "EEE d MMM 'alle' HH:mm")}{r.durationSec ? ` · ${Math.round(r.durationSec / 60)} min` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted small">
              {m.doneToday?.length ? `Oggi: ${m.doneToday.map((d) => d.title).join(', ')} 💪` : 'Niente di registrato oggi.'}
            </div>
          )}
          <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => openMoveo('/storico')}>Storico completo ↗</button>
        </section>
      </div>

      <div className="kiosk-col col-scroll">
        <section className="glass pad glow-violet">
          <div className="card-title"><h2>📚 Programmi</h2></div>
          {m.programs?.length ? (
            <div className="mv-programs">
              {m.programs.map((p) => (
                <button key={p.id} className={`mv-program ${p.planned ? 'on' : ''}`} onClick={() => openMoveo(p.path || `/programmi/${p.id}`)}>
                  <span className="mv-emoji">{emojiOf(p)}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <b className="ellipsis" style={{ display: 'block' }}>{p.title}</b>
                    <span className="faint tiny">{[p.level, p.minutes ? `≈ ${p.minutes} min` : '', p.weeks ? `${p.weeks} sett.` : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <button className="btn" onClick={() => openMoveo('/programmi')}>📚 Tutti i programmi ↗</button>
              <button className="btn" onClick={() => openMoveo('/piano')}>🗓 I miei piani ↗</button>
              <button className="btn" onClick={() => openMoveo('/esercizi')}>🏋 Esercizi ↗</button>
            </div>
          )}
          {!m.overview && <div className="faint tiny" style={{ marginTop: 10 }}>Aggiorna Moveo per vedere qui l'elenco dei programmi e gli ultimi allenamenti.</div>}
        </section>
        <button className="btn ghost" onClick={() => openMoveo('/tablet')}>Apri Moveo ↗</button>
      </div>
    </div>
  );
}
