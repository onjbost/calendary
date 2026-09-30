import { useState, type DragEvent } from 'react';
import { addDays } from 'date-fns';
import { api, type Quadrant, type Task } from '../api';
import { parseYmd, ymd } from '../dates';
import { notifyChanged } from '../live';
import { useUI } from '../ui';

export const QUADRANTS: { q: Quadrant; title: string; sub: string; empty: string }[] = [
  { q: 1, title: 'Urgente e importante', sub: 'Fallo subito', empty: 'Le emergenze e le scadenze di oggi.' },
  { q: 2, title: 'Importante, non urgente', sub: 'Pianificalo', empty: 'Studio, progetti, salute: qui si costruisce il futuro.' },
  { q: 3, title: 'Urgente, non importante', sub: 'Delegalo o riducilo', empty: 'Interruzioni, alcune mail e telefonate.' },
  { q: 4, title: 'Né urgente né importante', sub: 'Eliminalo', empty: 'Distrazioni da tenere a bada.' },
];

function TaskRow({ task, onToggle, onRename, onDelete, onSchedule, onTomorrow, onMove }: {
  task: Task;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onSchedule: () => void;
  onTomorrow: () => void;
  onMove: (q: Quadrant) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);

  const commit = () => {
    setEditing(false);
    if (title.trim() && title.trim() !== task.title) onRename(title.trim());
    else setTitle(task.title);
  };

  return (
    <div
      className={`task ${task.done ? 'done' : ''}`}
      draggable={!editing}
      onDragStart={(e) => e.dataTransfer.setData('text/task-id', task.id)}
    >
      <input type="checkbox" className="check" checked={task.done} onChange={onToggle} />
      {editing ? (
        <input
          className="input"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setTitle(task.title);
              setEditing(false);
            }
          }}
          style={{ padding: '4px 8px' }}
        />
      ) : (
        <span className="task-title" onDoubleClick={() => setEditing(true)}>{task.title}</span>
      )}
      <div className="acts">
        {/* drag & drop doesn't exist on touch screens: move between quadrants from here */}
        <select className="move-q" title="Sposta in un altro quadrante" value={task.quadrant}
          onChange={(e) => onMove(Number(e.target.value) as Quadrant)}>
          {QUADRANTS.map((q) => <option key={q.q} value={q.q}>{q.q} · {q.title}</option>)}
        </select>
        <button className="btn icon ghost sm" title="Rinomina" onClick={() => setEditing(true)}>✎</button>
        <button className="btn icon ghost sm" title="Pianifica in calendario" onClick={onSchedule}>📅</button>
        {!task.done && <button className="btn icon ghost sm" title="Sposta a domani" onClick={onTomorrow}>↪</button>}
        <button className="btn icon ghost sm" title="Elimina" onClick={onDelete}>🗑</button>
      </div>
    </div>
  );
}

export function MatrixBoard({ date, tasks, setTasks }: {
  date: string;
  tasks: Task[];
  setTasks: (fn: (prev: Task[]) => Task[]) => void;
}) {
  const { toast, newEvent } = useUI();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [dropOn, setDropOn] = useState<Quadrant | null>(null);

  const run = async (fn: () => Promise<unknown>, optimistic?: (prev: Task[]) => Task[]) => {
    if (optimistic) setTasks(optimistic);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      notifyChanged('tasks');
    }
  };

  const add = (q: Quadrant) => {
    const title = (drafts[q] || '').trim();
    if (!title) return;
    setDrafts((d) => ({ ...d, [q]: '' }));
    run(() => api.createTask({ date, quadrant: q, title }));
  };

  const patch = (t: Task, p: Partial<Task>) =>
    run(() => api.updateTask(t.id, p), (prev) => prev.map((x) => (x.id === t.id ? { ...x, ...p } : x)));

  const onDrop = (q: Quadrant) => (e: DragEvent) => {
    e.preventDefault();
    setDropOn(null);
    const id = e.dataTransfer.getData('text/task-id');
    const t = tasks.find((x) => x.id === id);
    if (t && t.quadrant !== q) patch(t, { quadrant: q });
  };

  const tomorrow = ymd(addDays(parseYmd(date), 1));

  return (
    <div className="matrix">
      <div className="axis neon-red">URGENTE</div>
      <div className="axis neon-cyan">NON URGENTE</div>
      {QUADRANTS.map(({ q, title, sub, empty }) => {
        const list = tasks.filter((t) => t.quadrant === q).sort((a, b) => Number(a.done) - Number(b.done) || a.position - b.position);
        const doneCount = list.filter((t) => t.done).length;
        return (
          <section
            key={q}
            className={`glass quad q${q} ${dropOn === q ? 'drop' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropOn(q);
            }}
            onDragLeave={() => setDropOn((cur) => (cur === q ? null : cur))}
            onDrop={onDrop(q)}
          >
            <div className="quad-head">
              <span className="quad-num">{q}</span>
              <div className="grow">
                <div className="quad-title">{title}</div>
                <div className="quad-sub">{sub}</div>
              </div>
              {list.length > 0 && <span className="chip">{doneCount}/{list.length}</span>}
            </div>
            <div className="quad-list">
              {!list.length && <div className="faint small" style={{ padding: '8px 2px' }}>{empty}</div>}
              {list.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggle={() => patch(t, { done: !t.done })}
                  onMove={(q) => q !== t.quadrant && patch(t, { quadrant: q })}
                  onRename={(title) => patch(t, { title })}
                  onDelete={() => run(() => api.deleteTask(t.id), (prev) => prev.filter((x) => x.id !== t.id))}
                  onTomorrow={() => run(() => api.updateTask(t.id, { date: tomorrow }), (prev) => prev.filter((x) => x.id !== t.id)).then(() => toast('Spostata a domani'))}
                  onSchedule={() => {
                    const start = new Date(`${date}T09:00`);
                    newEvent({ title: t.title, start: start.toISOString(), end: new Date(start.getTime() + 3600e3).toISOString(), important: q <= 2 });
                  }}
                />
              ))}
            </div>
            <div className="quad-add">
              <input
                className="input"
                placeholder="Aggiungi attività…"
                value={drafts[q] || ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [q]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && add(q)}
              />
              <button className="btn primary icon" onClick={() => add(q)} aria-label="Aggiungi">＋</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Compact read/tick-only matrix for the kiosk and dashboard. */
export function MiniMatrix({ tasks, onToggle }: { tasks: Task[]; onToggle?: (t: Task) => void }) {
  return (
    <div className="mini-matrix">
      {QUADRANTS.map(({ q, title }) => {
        const list = tasks.filter((t) => t.quadrant === q).sort((a, b) => Number(a.done) - Number(b.done) || a.position - b.position);
        return (
          <div key={q} className={`mini-q q${q}`}>
            <div className="h">{q} · {title.toUpperCase()}</div>
            {!list.length && <div className="faint tiny">—</div>}
            {list.slice(0, 5).map((t) => (
              <div key={t.id} className={`it ${t.done ? 'done' : ''}`} onClick={() => onToggle?.(t)}>
                <span>{t.done ? '✔' : '○'}</span>
                <span>{t.title}</span>
              </div>
            ))}
            {list.length > 5 && <div className="faint tiny">+{list.length - 5}</div>}
          </div>
        );
      })}
    </div>
  );
}
