import { Fragment, useEffect, useState } from 'react';
import { addDays } from 'date-fns';
import { api, type Dose, type Pill, type PillDraft, type PillHistory } from '../api';
import { fmt, hm, parseYmd, ymd } from '../dates';
import { useDoses, useNow, usePills } from '../hooks';
import { notifyChanged, onChanged } from '../live';
import { Link } from '../router';
import { useUI } from '../ui';
import { Modal } from './Modal';

const DAYS = [
  { d: 1, l: 'L' }, { d: 2, l: 'M' }, { d: 3, l: 'M' }, { d: 4, l: 'G' }, { d: 5, l: 'V' }, { d: 6, l: 'S' }, { d: 0, l: 'D' },
];
const COLORS = ['#ff7ac8', '#5ee7ff', '#a8ff60', '#ffd54a', '#c49bff', '#ffab5c'];

export function daysLabel(days: number[]) {
  if (days.length === 7) return 'tutti i giorni';
  return DAYS.filter((x) => days.includes(x.d)).map((x) => ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][x.d]).join(' ');
}

// ------------------------------------------------------------- today card

/** Today's doses with a big "Presa ✓" button each (dashboard and tablet). */
export function PillsToday({ className = '', kiosk = false, managePage = false }: { className?: string; kiosk?: boolean; managePage?: boolean }) {
  const { toast } = useUI();
  const now = useNow(30_000);
  const day = ymd(now);
  const { data: doses, setData } = useDoses(day);
  const { data: pills } = usePills();
  const [editing, setEditing] = useState<Pill | null>(null);

  if (!doses.length) {
    if (kiosk) return null; // nothing scheduled: keep the tablet column for the rest
    return (
      <section className={`glass pad ${className}`}>
        <div className="card-title"><h2>💊 Pillole</h2><Link to="/pillole" className="btn sm ghost">Aggiungi →</Link></div>
        <div className="empty">Nessuna pillola oggi. Aggiungi le tue terapie per ricevere i promemoria (anche su Alexa).</div>
      </section>
    );
  }

  const toggle = async (d: Dose) => {
    const taken = !d.takenAt;
    setData((list) => list.map((x) => (x === d ? { ...x, takenAt: taken ? new Date().toISOString() : null } : x)));
    try {
      await api.setDose(d.pillId, d.date, d.time, taken);
      notifyChanged('pills');
      if (taken) toast(`💊 ${d.name}: presa ✓`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const left = doses.filter((d) => !d.takenAt).length;
  return (
    <section className={`glass pad ${className}`}>
      <div className="card-title" style={kiosk ? { marginBottom: 8 } : undefined}>
        {kiosk ? <h3>💊 Pillole di oggi</h3> : <h2>💊 Pillole di oggi</h2>}
        <span className="chip">{left ? `${left} da prendere` : 'tutte prese ✓'}</span>
        {!kiosk && !managePage && <Link to="/pillole" className="btn sm ghost">Gestisci →</Link>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {doses.map((d) => {
          const late = !d.takenAt && Date.parse(d.at) < now.getTime();
          return (
            <div key={`${d.pillId}|${d.time}`} className={`dose ${d.takenAt ? 'taken' : ''} ${late ? 'late' : ''}`}>
              <span className="dot" style={{ color: d.color }} />
              <span className="mono dose-time">{d.time}</span>
              <span className="grow">
                <button className="dose-name" onClick={() => setEditing(pills.find((p) => p.id === d.pillId) || null)} title="Modifica la terapia">
                  <b>{d.name}</b>{d.dose && <span className="muted small"> · {d.dose}</span>}
                </button>
                {late && <span className="neon-red small"> · in ritardo</span>}
              </span>
              <button className={`btn sm ${d.takenAt ? 'ghost' : late ? 'pink' : 'primary'}`} onClick={() => toggle(d)}
                title={d.takenAt ? 'Tocca per annullare' : 'Segna come presa'}>
                {d.takenAt ? `✓ ${hm(d.takenAt)}` : 'Presa ✓'}
              </button>
            </div>
          );
        })}
      </div>
      {editing && <PillModal pill={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

// ------------------------------------------------------------------ editor

function PillModal({ pill, onClose }: { pill?: Pill; onClose: () => void }) {
  const { toast } = useUI();
  const [f, setF] = useState<PillDraft>(() => pill
    ? { ...pill }
    : { name: '', dose: '', times: ['08:00'], days: [0, 1, 2, 3, 4, 5, 6], startDate: ymd(new Date()), endDate: null, alexa: true, active: true, color: COLORS[0], notes: '' });
  const [newTime, setNewTime] = useState('20:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const set = <K extends keyof PillDraft>(k: K, v: PillDraft[K]) => setF((p) => ({ ...p, [k]: v }));

  const addTime = () => {
    if (!/^\d{2}:\d{2}$/.test(newTime) || f.times.includes(newTime)) return;
    set('times', [...f.times, newTime].sort());
  };
  const toggleDay = (d: number) => {
    const days = f.days || [];
    set('days', days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  };

  const save = async () => {
    if (!f.name.trim()) return setError('Scrivi il nome della pillola');
    if (!f.times.length) return setError('Aggiungi almeno un orario');
    setBusy(true);
    setError(null);
    try {
      if (pill) await api.updatePill(pill.id, f);
      else await api.createPill(f);
      notifyChanged('pills');
      toast(pill ? 'Pillola aggiornata' : 'Pillola aggiunta 💊');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pill) return;
    await api.deletePill(pill.id);
    notifyChanged('pills');
    toast('Pillola eliminata');
    onClose();
  };

  return (
    <Modal title={pill ? 'Modifica pillola' : 'Nuova pillola'} onClose={onClose} glow="pink"
      footer={<>
        {pill && (confirm
          ? <button className="btn danger" onClick={remove}>Conferma eliminazione</button>
          : <button className="btn danger" onClick={() => setConfirm(true)}>Elimina</button>)}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Salvataggio…' : 'Salva'}</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <div className="grid-2">
          <label className="field">Nome
            <input className="input" value={f.name} autoFocus onChange={(e) => set('name', e.target.value)} placeholder="Es. Vitamina D" />
          </label>
          <label className="field">Dose
            <input className="input" value={f.dose || ''} onChange={(e) => set('dose', e.target.value)} placeholder="Es. 1 compressa" />
          </label>
        </div>
        <div className="field">Orari
          <div className="row">
            {f.times.map((t) => (
              <span key={t} className="chip time-chip">
                <span className="mono">{t}</span>
                <button className="chip-x" onClick={() => set('times', f.times.filter((x) => x !== t))} aria-label={`Togli ${t}`}>✕</button>
              </span>
            ))}
            <input className="input" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} style={{ width: 120 }} />
            <button className="btn sm" onClick={addTime}>＋ Orario</button>
          </div>
        </div>
        <div className="field">Giorni
          <div className="seg">
            {DAYS.map((x) => <button key={x.d} className={(f.days || []).includes(x.d) ? 'on' : ''} onClick={() => toggleDay(x.d)}>{x.l}</button>)}
          </div>
        </div>
        <div className="grid-2">
          <label className="field">Dal
            <input className="input" type="date" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} />
          </label>
          <label className="field">Al (facoltativo)
            <input className="input" type="date" value={f.endDate || ''} onChange={(e) => set('endDate', e.target.value || null)} />
          </label>
        </div>
        <div className="row">
          <label className="switch"><input type="checkbox" checked={!!f.alexa} onChange={(e) => set('alexa', e.target.checked)} /> 🔊 Sveglia su Alexa</label>
          <label className="switch"><input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked)} /> Terapia attiva</label>
        </div>
        <div className="row">
          <span className="muted small">Colore</span>
          {COLORS.map((c) => (
            <button key={c} className={`sticky-color ${c === f.color ? 'on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} aria-label="Colore" />
          ))}
        </div>
        <label className="field">Note
          <textarea className="input" rows={2} value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="Es. dopo i pasti" />
        </label>
        <div className="faint tiny">
          All'orario arriva una notifica su Calendary{f.alexa ? ' e una sveglia su Alexa' : ''}; se dopo 30 minuti non l'hai segnata come presa ricevi un secondo avviso.
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------- page

type Period = 14 | 30 | 90 | 365 | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: 14, label: '14 giorni' }, { id: 30, label: '30 giorni' }, { id: 90, label: '3 mesi' }, { id: 365, label: '1 anno' }, { id: 'all', label: 'Tutto' },
];

function useHistory(period: Period) {
  const [h, setH] = useState<PillHistory | null>(null);
  useEffect(() => {
    const load = () => api.pillHistory(period).then(setH).catch(() => {});
    load();
    return onChanged('pills', load);
  }, [period]);
  return h;
}

const pctClass = (pct: number) => (pct >= 90 ? 'neon-lime' : pct >= 60 ? 'neon-amber' : 'neon-red');
const cellClass = (s?: { scheduled: number; taken: number }) => (!s ? 'none' : s.taken >= s.scheduled ? 'full' : s.taken ? 'part' : 'miss');

function daysFrom(fromYmd: string, toYmd: string) {
  const out: Date[] = [];
  for (let d = parseYmd(fromYmd); ymd(d) <= toYmd; d = addDays(d, 1)) out.push(d);
  return out;
}

export function PillsPage() {
  const { data: pills } = usePills();
  const [editing, setEditing] = useState<Pill | 'new' | null>(null);
  const [period, setPeriod] = useState<Period>('all');
  const history = useHistory(period);
  const days = history ? daysFrom(history.from, history.to) : [];

  return (
    <div>
      <div className="page-head">
        <h1>Pillole</h1>
        <button className="btn primary" onClick={() => setEditing('new')}>＋ Nuova pillola</button>
      </div>
      <div className="dash">
        <PillsToday className="span-5 glow-pink" managePage />
        <section className="glass pad span-7">
          <div className="card-title"><h2>Terapie</h2></div>
          {!pills.length && <div className="empty">Nessuna pillola. Aggiungine una con “＋ Nuova pillola”.</div>}
          <div className="stack" style={{ gap: 8 }}>
            {pills.map((p) => (
              <div key={p.id} className={`dose ${p.active ? '' : 'taken'}`} style={{ cursor: 'pointer' }} onClick={() => setEditing(p)}>
                <span className="dot" style={{ color: p.color }} />
                <span className="grow">
                  <b>{p.name}</b>{p.dose && <span className="muted small"> · {p.dose}</span>}
                  <div className="faint small">{p.times.join(' · ')} · {daysLabel(p.days)}{p.endDate ? ` · fino al ${fmt(parseYmd(p.endDate), 'd MMM')}` : ''}</div>
                </span>
                {p.alexa && <span className="chip" title="Sveglia su Alexa">🔊</span>}
                {!p.active && <span className="chip">in pausa</span>}
                <button className="btn sm" onClick={(e) => { e.stopPropagation(); setEditing(p); }}>✎ Modifica</button>
              </div>
            ))}
          </div>
        </section>

        <section className="glass pad span-12">
          <div className="card-title">
            <h2>Storico</h2>
            <div className="seg">
              {PERIODS.map((x) => <button key={String(x.id)} className={period === x.id ? 'on' : ''} onClick={() => setPeriod(x.id)}>{x.label}</button>)}
            </div>
          </div>
          {!history || !history.pills.length ? (
            <div className="empty">Ancora nessuna dose da mostrare.</div>
          ) : (
            <div className="stack">
              <div className="faint small">
                {period === 'all' ? `Dal ${fmt(parseYmd(history.from), 'd MMMM yyyy')}, inizio della prima terapia` : `Dal ${fmt(parseYmd(history.from), 'd MMMM yyyy')}`} a oggi
              </div>
              <div className="ph-summary">
                {history.pills.map((p) => (
                  <div key={p.pillId} className="ph-card">
                    <div className="row" style={{ gap: 8 }}><span className="dot" style={{ color: p.color }} /><b>{p.name}</b></div>
                    <div className={`ph-pct mono ${pctClass(p.percent)}`}>{p.percent}%</div>
                    <div className="muted small">{p.taken} prese su {p.scheduled}{p.scheduled - p.taken ? ` · ${p.scheduled - p.taken} saltate` : ''}</div>
                    <div className="faint small">{p.streak ? `🔥 ${p.streak} ${p.streak === 1 ? 'giorno' : 'giorni'} di fila` : 'Serie interrotta'} · dal {fmt(parseYmd(p.firstDate), 'd MMM yyyy')}</div>
                  </div>
                ))}
              </div>
              {days.length <= 31 ? <DayGrid history={history} days={days} /> : <Heatmap history={history} days={days} />}
              <div className="row faint tiny">
                <span className="ph-cell full legend" /> tutte prese <span className="ph-cell part legend" /> in parte <span className="ph-cell miss legend" /> saltate <span className="ph-cell none legend" /> nessuna dose
              </div>
            </div>
          )}
        </section>

        <PillLog />
      </div>
      {editing && <PillModal pill={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Up to a month: one column per day, with the dates on top. */
function DayGrid({ history, days }: { history: PillHistory; days: Date[] }) {
  return (
    <div className="pill-history" style={{ gridTemplateColumns: `minmax(120px, 200px) repeat(${days.length}, minmax(18px, 1fr)) 44px` }}>
      <div />
      {days.map((d) => <div key={ymd(d)} className="faint tiny mono ph-day">{fmt(d, 'EEEEE d')}</div>)}
      <div className="faint tiny">%</div>
      {history.pills.map((p) => (
        <Fragment key={p.pillId}>
          <div className="ph-name"><span className="dot" style={{ color: p.color }} /> {p.name}</div>
          {days.map((d) => {
            const s = p.days[ymd(d)];
            return <div key={ymd(d)} className={`ph-cell ${cellClass(s)}`} title={`${fmt(d, 'd MMM')}: ${s ? `${s.taken}/${s.scheduled}` : 'nessuna dose'}`} />;
          })}
          <div className={`mono small ${pctClass(p.percent)}`}>{p.percent}%</div>
        </Fragment>
      ))}
    </div>
  );
}

/** Longer periods: one heatmap per pill, a column per week (Monday on top), month names above. */
function Heatmap({ history, days }: { history: PillHistory; days: Date[] }) {
  const pad = (days[0].getDay() + 6) % 7; // empty cells before the first day so rows are weekdays
  const cells: (Date | null)[] = [...Array(pad).fill(null), ...days];
  const weeks = Math.ceil(cells.length / 7);
  const months = Array.from({ length: weeks }, (_, w) => {
    // label the week where a month starts (and the very first column)
    const week = cells.slice(w * 7, w * 7 + 7).filter((d): d is Date => !!d);
    const start = week.find((d) => d.getDate() === 1) || (w === 0 ? week[0] : undefined);
    return start ? fmt(start, start.getMonth() === 0 ? 'MMM yy' : 'MMM') : '';
  });
  return (
    <div className="stack" style={{ gap: 16 }}>
      {history.pills.map((p) => (
        <div key={p.pillId} className="heat-wrap">
          <div className="ph-name" style={{ marginBottom: 6 }}><span className="dot" style={{ color: p.color }} /> {p.name}
            <span className={`mono small ${pctClass(p.percent)}`} style={{ marginLeft: 8 }}>{p.percent}%</span></div>
          <div className="heat" style={{ gridTemplateColumns: `repeat(${weeks}, 12px)` }}>
            {months.map((m, i) => <div key={`m${i}`} className="heat-month faint tiny" style={{ gridColumn: i + 1, gridRow: 1 }}>{m}</div>)}
            {cells.map((d, i) => d && (
              <div key={ymd(d)} className={`ph-cell heat-cell ${cellClass(p.days[ymd(d)])}`}
                style={{ gridColumn: Math.floor(i / 7) + 1, gridRow: (i % 7) + 2 }}
                title={`${fmt(d, 'EEE d MMM yyyy')}: ${p.days[ymd(d)] ? `${p.days[ymd(d)].taken}/${p.days[ymd(d)].scheduled}` : 'nessuna dose'}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Month-by-month register: every dose of every day, taken (with the time) or skipped. */
function PillLog() {
  const [month, setMonth] = useState(() => ymd(new Date()).slice(0, 7));
  const [doses, setDoses] = useState<Dose[] | null>(null);
  useEffect(() => {
    const load = () => api.pillLog(month).then(setDoses).catch(() => setDoses([]));
    load();
    return onChanged('pills', load);
  }, [month]);
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    setMonth(ymd(new Date(y, m - 1 + n, 1)).slice(0, 7));
  };
  const today = ymd(new Date());
  const thisMonth = today.slice(0, 7);
  const byDay = new Map<string, Dose[]>();
  for (const d of doses || []) byDay.set(d.date, [...(byDay.get(d.date) || []), d]);
  const dayList = [...byDay.keys()].sort().reverse();
  const taken = (doses || []).filter((d) => d.takenAt).length;

  return (
    <section className="glass pad span-12">
      <div className="card-title">
        <h2>Registro</h2>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn icon" onClick={() => shift(-1)} aria-label="Mese precedente">‹</button>
          <span className="mono" style={{ minWidth: 130, textAlign: 'center' }}>{fmt(parseYmd(`${month}-01`), 'MMMM yyyy')}</span>
          <button className="btn icon" onClick={() => shift(1)} disabled={month >= thisMonth} aria-label="Mese successivo">›</button>
        </div>
      </div>
      {!doses ? <div className="empty">Caricamento…</div> : !doses.length ? <div className="empty">Nessuna dose in questo mese.</div> : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="muted small">{taken} prese su {doses.length} nel mese</div>
          {dayList.map((day) => (
            <div key={day} className="log-day">
              <div className="log-date mono small">{fmt(parseYmd(day), 'EEE d')}</div>
              <div className="row" style={{ gap: 8 }}>
                {byDay.get(day)!.map((d) => {
                  const pending = !d.takenAt && d.date === today; // today's doses can still be taken
                  return (
                    <span key={`${d.pillId}|${d.time}`} className={`chip log-dose ${d.takenAt ? 'ok' : pending ? 'wait' : 'miss'}`}
                      title={d.takenAt ? `Presa alle ${hm(d.takenAt)}` : pending ? 'Ancora da prendere' : 'Saltata'}>
                      <span className="dot" style={{ color: d.color }} /> {d.time} {d.name} {d.takenAt ? `✓ ${hm(d.takenAt)}` : pending ? '…' : '✗'}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
