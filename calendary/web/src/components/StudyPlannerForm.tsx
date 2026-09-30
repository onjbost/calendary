import { useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import { api, type Proposal, type StudyPlanInput } from '../api';
import { ymd } from '../dates';
import { useCalendars, useLocalStorage } from '../hooks';

const DAY_LABELS = [
  { d: 1, l: 'Lun' }, { d: 2, l: 'Mar' }, { d: 3, l: 'Mer' }, { d: 4, l: 'Gio' },
  { d: 5, l: 'Ven' }, { d: 6, l: 'Sab' }, { d: 0, l: 'Dom' },
];

type Prefs = Pick<StudyPlanInput, 'sessionMaxHours' | 'maxHoursPerDay' | 'breakMinutes' | 'bufferDays' | 'days' | 'weekdayWindows' | 'weekendWindows' | 'finalReview' | 'important' | 'reminderMinutes'>;

const DEFAULT_PREFS: Prefs = {
  sessionMaxHours: 1.5,
  maxHoursPerDay: 3,
  breakMinutes: 15,
  bufferDays: 1,
  days: [1, 2, 3, 4, 5, 6],
  weekdayWindows: [{ from: '18:00', to: '21:00' }],
  weekendWindows: [{ from: '09:30', to: '12:30' }, { from: '15:00', to: '18:00' }],
  finalReview: true,
  important: false,
  reminderMinutes: 15,
};

function WindowsEditor({ value, onChange }: { value: { from: string; to: string }[]; onChange: (v: { from: string; to: string }[]) => void }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {value.map((w, i) => (
        <div key={i} className="row nowrap">
          <input className="input" type="time" value={w.from} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
          <span className="faint">→</span>
          <input className="input" type="time" value={w.to} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
          <button className="btn icon ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} disabled={value.length <= 1} aria-label="Rimuovi fascia">✕</button>
        </div>
      ))}
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...value, { from: '14:00', to: '16:00' }])}>＋ fascia oraria</button>
    </div>
  );
}

/** Rule-based study planner: works without any AI key. */
export function StudyPlannerForm({ onProposal }: { onProposal: (p: Proposal) => void }) {
  const { data: calendars } = useCalendars();
  const localCals = useMemo(() => calendars.filter((c) => c.type === 'local'), [calendars]);
  const studio = localCals.find((c) => /studio/i.test(c.name));

  const [prefs, setPrefs] = useLocalStorage<Prefs>('calendary.plannerPrefs', DEFAULT_PREFS);
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState(ymd(addDays(new Date(), 21)));
  const [startDate, setStartDate] = useState(ymd(new Date()));
  const [modules, setModules] = useState([{ name: 'Modulo 1', hours: 3 }]);
  const [quickN, setQuickN] = useState(5);
  const [quickH, setQuickH] = useState(3);
  const [calendarId, setCalendarId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const total = modules.reduce((s, m) => s + (Number(m.hours) || 0), 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.planStudy({
        ...prefs,
        title: title.trim() || 'Studio',
        deadline,
        startDate,
        modules: modules.map((m) => ({ name: m.name, hours: Number(m.hours) })),
        calendarId: calendarId || studio?.id || localCals[0]?.id,
      });
      onProposal(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass pad glow-violet stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        <h2 className="neon-violet">Pianificatore di studio</h2>
        <span className="chip">{total} h</span>
      </div>
      <div className="muted small">Dividi un corso in moduli: le sessioni vengono distribuite nel tempo libero prima della scadenza, evitando i tuoi impegni. Tu approvi prima che finiscano in calendario.</div>

      <label className="field">Corso / obiettivo
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Corso di inglese" />
      </label>
      <div className="grid-2">
        <label className="field">Inizio
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field">Scadenza
          <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>

      <div className="field">
        <span>Moduli</span>
        <div className="row nowrap small">
          <input className="input" type="number" min={1} max={50} value={quickN} onChange={(e) => setQuickN(Number(e.target.value))} style={{ width: 70 }} />
          <span className="faint">moduli da</span>
          <input className="input" type="number" min={0.5} step={0.5} value={quickH} onChange={(e) => setQuickH(Number(e.target.value))} style={{ width: 80 }} />
          <span className="faint">ore</span>
          <button className="btn sm" onClick={() => setModules(Array.from({ length: Math.max(1, Math.min(50, quickN)) }, (_, i) => ({ name: `Modulo ${i + 1}`, hours: quickH })))}>Genera</button>
        </div>
        <div className="modules">
          {modules.map((m, i) => (
            <div key={i} className="module-row">
              <input className="input" value={m.name} onChange={(e) => setModules((ms) => ms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input" type="number" min={0.25} step={0.25} value={m.hours} onChange={(e) => setModules((ms) => ms.map((x, j) => (j === i ? { ...x, hours: Number(e.target.value) } : x)))} />
              <button className="btn icon ghost" onClick={() => setModules((ms) => ms.filter((_, j) => j !== i))} disabled={modules.length <= 1} aria-label="Rimuovi modulo">✕</button>
            </div>
          ))}
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setModules((ms) => [...ms, { name: `Modulo ${ms.length + 1}`, hours: 2 }])}>＋ modulo</button>
        </div>
      </div>

      <div className="field">
        <span>Giorni di studio</span>
        <div className="days-picker">
          {DAY_LABELS.map(({ d, l }) => (
            <button key={d} className={prefs.days.includes(d) ? 'on' : ''}
              onClick={() => setPref('days', prefs.days.includes(d) ? prefs.days.filter((x) => x !== d) : [...prefs.days, d])}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <label className="field">Sessione max (ore)
          <input className="input" type="number" min={0.5} max={8} step={0.25} value={prefs.sessionMaxHours} onChange={(e) => setPref('sessionMaxHours', Number(e.target.value))} />
        </label>
        <label className="field">Max al giorno (ore)
          <input className="input" type="number" min={0.5} max={12} step={0.5} value={prefs.maxHoursPerDay} onChange={(e) => setPref('maxHoursPerDay', Number(e.target.value))} />
        </label>
      </div>

      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced((a) => !a)}>{advanced ? '▾' : '▸'} Fasce orarie e opzioni</button>
      {advanced && (
        <div className="stack">
          <div className="grid-2">
            <div className="field"><span>Fasce feriali</span><WindowsEditor value={prefs.weekdayWindows} onChange={(v) => setPref('weekdayWindows', v)} /></div>
            <div className="field"><span>Fasce weekend</span><WindowsEditor value={prefs.weekendWindows} onChange={(v) => setPref('weekendWindows', v)} /></div>
          </div>
          <div className="grid-2">
            <label className="field">Pausa tra sessioni (min)
              <input className="input" type="number" min={0} max={120} step={5} value={prefs.breakMinutes} onChange={(e) => setPref('breakMinutes', Number(e.target.value))} />
            </label>
            <label className="field">Giorni di margine prima della scadenza
              <input className="input" type="number" min={0} max={30} value={prefs.bufferDays} onChange={(e) => setPref('bufferDays', Number(e.target.value))} />
            </label>
          </div>
          <div className="grid-2">
            <label className="field">Calendario
              <select className="input" value={calendarId || studio?.id || localCals[0]?.id || ''} onChange={(e) => setCalendarId(e.target.value)}>
                {localCals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field">Promemoria
              <select className="input" value={prefs.reminderMinutes === null ? '' : String(prefs.reminderMinutes)} onChange={(e) => setPref('reminderMinutes', e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">Nessuno</option>
                <option value="5">5 min prima</option>
                <option value="15">15 min prima</option>
                <option value="30">30 min prima</option>
                <option value="60">1 ora prima</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label className="switch"><input type="checkbox" checked={prefs.finalReview} onChange={(e) => setPref('finalReview', e.target.checked)} /> Ripasso finale</label>
            <label className="switch"><input type="checkbox" checked={prefs.important} onChange={(e) => setPref('important', e.target.checked)} /> ⚡ Sessioni importanti</label>
          </div>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}
      <button className="btn primary lg" onClick={submit} disabled={busy || !prefs.days.length}>{busy ? 'Calcolo…' : '✨ Crea proposta di piano'}</button>
    </div>
  );
}
