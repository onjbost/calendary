import { addDays } from 'date-fns';
import { api } from '../api';
import { MatrixBoard } from '../components/Matrix';
import { capitalize, fmt, parseYmd, ymd } from '../dates';
import { useTasks } from '../hooks';
import { notifyChanged } from '../live';
import { navigate } from '../router';
import { useUI } from '../ui';

export function MatrixPage({ query }: { query: URLSearchParams }) {
  const { toast } = useUI();
  const date = query.get('date') || ymd(new Date());
  const day = parseYmd(date);
  const isToday = date === ymd(new Date());
  const { data, setData } = useTasks(date);

  const go = (d: Date) => navigate(`/matrice?date=${ymd(d)}`, { replace: true });

  const carryOver = async () => {
    const r = await api.carryOver(date);
    notifyChanged('tasks');
    toast(`${r.moved} attività portate a ${isToday ? 'oggi' : fmt(day, 'd MMM')}`);
  };

  const total = data.tasks.length;
  const done = data.tasks.filter((t) => t.done).length;

  return (
    <div>
      <div className="page-head">
        <h1>Matrice di Eisenhower</h1>
        <button className="btn icon" onClick={() => go(addDays(day, -1))} aria-label="Giorno precedente">‹</button>
        <button className="btn sm" onClick={() => go(new Date())}>Oggi</button>
        <button className="btn icon" onClick={() => go(addDays(day, 1))} aria-label="Giorno successivo">›</button>
        <input className="input" type="date" value={date} onChange={(e) => e.target.value && go(parseYmd(e.target.value))} style={{ width: 170 }} />
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="neon-violet mono">{capitalize(fmt(day, 'EEEE d MMMM'))}</div>
        {total > 0 && <span className="chip">{done}/{total} completate</span>}
        <span className="spacer" />
        {data.pendingBefore > 0 && (
          <button className="btn sm" onClick={carryOver}>↪ Porta qui {data.pendingBefore} attività non completate</button>
        )}
      </div>
      <MatrixBoard date={date} tasks={data.tasks} setTasks={(fn) => setData((d) => ({ ...d, tasks: fn(d.tasks) }))} />
      <div className="faint small" style={{ marginTop: 14 }}>
        Trascina le attività da un quadrante all'altro · doppio clic per rinominare · 📅 per trasformarle in un blocco in calendario.
      </div>
    </div>
  );
}
