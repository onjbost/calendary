import { useState } from 'react';
import { api, type Goal, type GoalItemDraft, type GoalStatus, type ItemKind, type ItemPeriod, type Routine, type RoutineDraft } from '../api';
import { ymd } from '../dates';
import { DAY_SHORT, KIND_LABEL, PERIOD_LABEL, STATUS_LABEL, WEEK_ORDER } from '../goals';
import { notifyChanged } from '../live';
import { useUI } from '../ui';
import { Modal } from './Modal';

const PALETTE = ['#00e5ff', '#ff2bd6', '#a66bff', '#9dff3a', '#ffb020', '#ff3d6e', '#3d8bff', '#00d5a0'];

function changed() {
  notifyChanged('goals');
  notifyChanged('events');
}

// ------------------------------------------------------------------ goal

export function GoalEditor({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const { toast } = useUI();
  const [f, setF] = useState(() => ({
    title: goal?.title || '',
    category: goal?.category || '',
    description: goal?.description || '',
    startDate: goal?.startDate || ymd(new Date()),
    deadline: goal?.deadline || '',
    status: (goal?.status || 'in_progress') as GoalStatus,
    color: goal?.color || PALETTE[Math.floor(Math.random() * PALETTE.length)],
    requiredItems: goal?.requiredItems ? String(goal.requiredItems) : '',
    manualProgress: goal?.manualProgress !== null && goal?.manualProgress !== undefined ? String(goal.manualProgress) : '',
  }));
  const [items, setItems] = useState<GoalItemDraft[]>(() => goal?.items.map((i) => ({ ...i })) || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const setItem = (idx: number, p: GoalItemDraft) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...p } : it)));
  const hasMeasures = items.some((i) => i.kind === 'check' || (i.target !== null && i.target !== undefined && String(i.target) !== ''));

  const save = async () => {
    if (!f.title.trim()) return setError("Dai un titolo all'obiettivo");
    if (!f.deadline) return setError('Imposta la scadenza');
    setBusy(true);
    setError(null);
    const payload = {
      ...f,
      requiredItems: f.requiredItems ? Number(f.requiredItems) : null,
      manualProgress: f.manualProgress !== '' ? Number(f.manualProgress) : null,
      items: items.filter((i) => (i.title || '').trim()).map((i) => ({
        ...i,
        target: i.target === null || i.target === undefined || String(i.target) === '' ? null : Number(i.target),
        current: i.current === null || i.current === undefined || String(i.current) === '' ? null : Number(i.current),
      })),
    };
    try {
      if (goal) await api.updateGoal(goal.id, payload);
      else await api.createGoal(payload);
      changed();
      toast(goal ? 'Obiettivo aggiornato' : 'Obiettivo creato');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!goal) return;
    setBusy(true);
    try {
      await api.deleteGoal(goal.id);
      changed();
      toast('Obiettivo eliminato');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={goal ? 'Modifica obiettivo' : 'Nuovo obiettivo'} onClose={onClose} wide glow="violet"
      footer={<>
        {goal && (confirmDelete
          ? <button className="btn danger" onClick={remove} disabled={busy}>Conferma: elimina obiettivo, misure, routine ed evidenze</button>
          : <button className="btn danger" onClick={() => setConfirmDelete(true)}>Elimina</button>)}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Salvataggio…' : 'Salva'}</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <input className="input" style={{ fontSize: '1.1rem' }} placeholder="Titolo dell'obiettivo" value={f.title} autoFocus onChange={(e) => set('title', e.target.value)} />
        <div className="grid-2">
          <label className="field">Categoria
            <input className="input" value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Es. Grow Yourself" />
          </label>
          <label className="field">Stato
            <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as GoalStatus)}>
              {(Object.keys(STATUS_LABEL) as GoalStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
        </div>
        <div className="grid-2">
          <label className="field">Inizio
            <input className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </label>
          <label className="field">Scadenza
            <input className="input" type="date" value={f.deadline} onChange={(e) => set('deadline', e.target.value)} />
          </label>
        </div>
        <div className="field">
          <span>Colore</span>
          <div className="color-swatches">
            {PALETTE.map((c) => <button key={c} className={f.color === c ? 'on' : ''} style={{ ['--sw' as string]: c }} onClick={() => set('color', c)} aria-label={c} />)}
          </div>
        </div>
        <label className="field">Descrizione, criteri ed evidenze da raccogliere
          <textarea className="input" rows={5} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </label>

        <div className="field">
          <span>Misure</span>
          <div className="faint tiny">
            <b>Spunta</b>: risultato fatto/non fatto · <b>Valore/target</b>: es. 55 su 100 % · <b>Conteggio evidenze</b>: conta le evidenze collegate
            (in totale, a settimana o a trimestre — le routine collegate aggiungono un'evidenza quando le spunti).
          </div>
          <div className="stack" style={{ gap: 8, marginTop: 6 }}>
            {items.map((it, idx) => (
              <div key={it.id || idx} className="item-row">
                <input className="input" value={it.title || ''} placeholder="Descrizione della misura" onChange={(e) => setItem(idx, { title: e.target.value })} />
                <select className="input" value={it.kind || 'check'} onChange={(e) => setItem(idx, { kind: e.target.value as ItemKind })}>
                  {(Object.keys(KIND_LABEL) as ItemKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                {it.kind !== 'check' ? (
                  <input className="input" type="number" step="any" placeholder="Target" value={it.target ?? ''}
                    onChange={(e) => setItem(idx, { target: e.target.value === '' ? null : Number(e.target.value) })} />
                ) : <span />}
                {it.kind === 'number' ? (
                  <input className="input" placeholder="Unità" value={it.unit || ''} onChange={(e) => setItem(idx, { unit: e.target.value })} />
                ) : it.kind === 'count' ? (
                  <select className="input" value={it.period || 'total'} onChange={(e) => setItem(idx, { period: e.target.value as ItemPeriod })}>
                    {(Object.keys(PERIOD_LABEL) as ItemPeriod[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
                  </select>
                ) : (
                  <input className="input" type="date" title="Data di scadenza (facoltativa, compare nel calendario)" value={it.due || ''}
                    onChange={(e) => setItem(idx, { due: e.target.value || null })} />
                )}
                <button className="btn icon ghost" onClick={() => setItems((l) => l.filter((_, i) => i !== idx))} aria-label="Rimuovi misura">✕</button>
              </div>
            ))}
            <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setItems((l) => [...l, { title: '', kind: 'check' }])}>＋ misura</button>
          </div>
        </div>

        <div className="grid-2">
          <label className="field">Soglia (facoltativa): raggiunto con almeno N misure
            <input className="input" type="number" min={1} value={f.requiredItems} onChange={(e) => set('requiredItems', e.target.value)} placeholder={`es. 6 su ${items.length || 9}`} />
          </label>
          {!hasMeasures && (
            <label className="field">Avanzamento manuale (%)
              <input className="input" type="number" min={0} max={100} value={f.manualProgress} onChange={(e) => set('manualProgress', e.target.value)} placeholder="Usato se non ci sono misure" />
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- routine

const MONTH_DAYS = [...Array.from({ length: 28 }, (_, i) => i + 1), -1];

export function RoutineEditor({ goals, routine, goalId, draft, onClose }: {
  goals: Goal[];
  routine?: Routine;
  goalId?: string;
  draft?: RoutineDraft;
  onClose: () => void;
}) {
  const { toast } = useUI();
  const [f, setF] = useState<RoutineDraft>(() => ({
    goalId: routine?.goalId || goalId || goals[0]?.id,
    title: '',
    freq: 'weekly',
    days: [1],
    intervalWeeks: 1,
    monthDay: -1,
    time: '09:00',
    duration: 30,
    reminderMinutes: 10,
    startDate: ymd(new Date()),
    endDate: null,
    itemId: null,
    active: true,
    ...draft,
    ...routine,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof RoutineDraft>(k: K, v: RoutineDraft[K]) => setF((p) => ({ ...p, [k]: v }));
  const goal = goals.find((g) => g.id === f.goalId);

  const save = async () => {
    if (!f.title?.trim()) return setError('Descrivi la routine con un titolo');
    setBusy(true);
    setError(null);
    try {
      if (routine) await api.updateRoutine(routine.id, f);
      else await api.createRoutine(f);
      changed();
      toast(routine ? 'Routine aggiornata' : 'Routine aggiunta: la trovi nel calendario');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!routine) return;
    await api.deleteRoutine(routine.id).catch((e) => setError(e.message));
    changed();
    toast('Routine eliminata');
    onClose();
  };

  return (
    <Modal title={routine ? 'Modifica routine' : 'Nuova routine'} onClose={onClose} glow="cyan"
      footer={<>
        {routine && (confirmDelete
          ? <button className="btn danger" onClick={remove}>Conferma eliminazione</button>
          : <button className="btn danger" onClick={() => setConfirmDelete(true)}>Elimina</button>)}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Salvataggio…' : 'Salva'}</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <input className="input" style={{ fontSize: '1.05rem' }} placeholder="Azione concreta, es. Time sheet settimanale" value={f.title || ''} autoFocus onChange={(e) => set('title', e.target.value)} />
        <label className="field">Obiettivo
          <select className="input" value={f.goalId} onChange={(e) => setF((p) => ({ ...p, goalId: e.target.value, itemId: null }))}>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </label>
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {(['weekly', 'monthly', 'quarterly'] as const).map((fr) => (
            <button key={fr} className={f.freq === fr ? 'on' : ''} onClick={() => set('freq', fr)}>
              {fr === 'weekly' ? 'Settimanale' : fr === 'monthly' ? 'Mensile' : 'Trimestrale'}
            </button>
          ))}
        </div>
        {f.freq === 'weekly' ? (
          <div className="grid-2">
            <div className="field">
              <span>Giorni</span>
              <div className="days-picker">
                {WEEK_ORDER.map((d) => (
                  <button key={d} className={f.days?.includes(d) ? 'on' : ''}
                    onClick={() => set('days', f.days?.includes(d) ? f.days.filter((x) => x !== d) : [...(f.days || []), d])}>{DAY_SHORT[d]}</button>
                ))}
              </div>
            </div>
            <label className="field">Frequenza
              <select className="input" value={f.intervalWeeks || 1} onChange={(e) => set('intervalWeeks', Number(e.target.value))}>
                <option value={1}>Ogni settimana</option>
                <option value={2}>Ogni 2 settimane</option>
                <option value={3}>Ogni 3 settimane</option>
                <option value={4}>Ogni 4 settimane</option>
              </select>
            </label>
          </div>
        ) : (
          <label className="field">{f.freq === 'monthly' ? 'Giorno del mese' : 'Giorno del mese (a marzo, giugno, settembre, dicembre)'}
            <select className="input" value={f.monthDay ?? -1} onChange={(e) => set('monthDay', Number(e.target.value))}>
              {MONTH_DAYS.map((d) => <option key={d} value={d}>{d === -1 ? 'Ultimo giorno lavorativo' : d}</option>)}
            </select>
            <span className="faint tiny">Se cade di sabato o domenica, la routine va al venerdì prima.</span>
          </label>
        )}
        <div className="grid-2">
          <label className="field">Orario
            <input className="input" type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
          </label>
          <label className="field">Durata (minuti)
            <input className="input" type="number" min={5} step={5} value={f.duration} onChange={(e) => set('duration', Number(e.target.value))} />
          </label>
        </div>
        <div className="grid-2">
          <label className="field">Promemoria
            <select className="input" value={f.reminderMinutes ?? ''} onChange={(e) => set('reminderMinutes', e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">Nessuno</option>
              <option value={0}>All'inizio</option>
              <option value={5}>5 min prima</option>
              <option value={10}>10 min prima</option>
              <option value={15}>15 min prima</option>
              <option value={30}>30 min prima</option>
              <option value={60}>1 ora prima</option>
            </select>
          </label>
          <label className="field">Fa avanzare la misura
            <select className="input" value={f.itemId || ''} onChange={(e) => set('itemId', e.target.value || null)}>
              <option value="">— nessuna —</option>
              {goal?.items.filter((i) => i.kind === 'count').map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
            </select>
          </label>
        </div>
        <div className="grid-2">
          <label className="field">Dal
            <input className="input" type="date" value={f.startDate || ''} onChange={(e) => set('startDate', e.target.value)} />
          </label>
          <label className="field">Fino al (vuoto = scadenza dell'obiettivo)
            <input className="input" type="date" value={f.endDate || ''} onChange={(e) => set('endDate', e.target.value || null)} />
          </label>
        </div>
        {routine && <label className="switch"><input type="checkbox" checked={f.active !== false} onChange={(e) => set('active', e.target.checked)} /> Attiva (in pausa non compare in calendario)</label>}
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------- evidence

export function EvidenceModal({ goal, itemId, onClose }: { goal: Goal; itemId?: string | null; onClose: () => void }) {
  const { toast } = useUI();
  const [date, setDate] = useState(ymd(new Date()));
  const [text, setText] = useState('');
  const [item, setItem] = useState(itemId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!text.trim()) return setError('Scrivi cosa hai fatto o ottenuto');
    setBusy(true);
    try {
      await api.addEvidence(goal.id, { date, text, itemId: item || null });
      notifyChanged('goals');
      toast('Evidenza salvata ✨');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Nuova evidenza" onClose={onClose} glow="pink"
      footer={<>
        <button className="btn" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={save} disabled={busy}>Salva evidenza</button>
      </>}>
      <div className="stack">
        <div className="muted small">{goal.title}</div>
        {error && <div className="alert error">{error}</div>}
        <textarea className="input" rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Cosa hai fatto e con quale risultato? Es. «Generato con l'AI il payload dei test R6.2: preparazione da 3 h a 1 h»" />
        <div className="grid-2">
          <label className="field">Data
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">Conta per la misura
            <select className="input" value={item} onChange={(e) => setItem(e.target.value)}>
              <option value="">— nessuna —</option>
              {goal.items.filter((i) => i.kind === 'count').map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}
