import { useMemo } from 'react';
import { addDays } from 'date-fns';
import { api, type Task } from '../api';
import { Agenda } from '../components/Agenda';
import { HubLamp } from '../components/HubLamp';
import { GoalsMini, WeekRoutines } from '../components/GoalWidgets';
import { MiniMatrix } from '../components/Matrix';
import { MoveoCard } from '../components/MoveoCard';
import { PillsToday } from '../components/Pills';
import { TipCard } from '../components/TipCard';
import { WardappCard } from '../components/WardappCard';
import { capitalize, countdown, fmt, greeting, hm, parseYmd, ymd } from '../dates';
import { useEvents, useGoals, useNow, useTasks } from '../hooks';
import { notifyChanged } from '../live';
import { Link, navigate } from '../router';
import { tipOfTheDay, TIPS } from '../tips';
import { useUI } from '../ui';

export function Dashboard() {
  const { openEvent, newEvent, startFive } = useUI();
  const now = useNow(1000);
  const dayKey = ymd(now);
  const range = useMemo(() => {
    const from = parseYmd(dayKey);
    return { from, to: addDays(from, 8) };
  }, [dayKey]);
  const { data: events } = useEvents(range.from, range.to);
  const { data: taskData, setData: setTaskData } = useTasks(dayKey);
  const { data: goals } = useGoals();

  const todayEnd = addDays(range.from, 1).getTime();
  const today = events.filter((e) => Date.parse(e.start) < todayEnd);
  const next = events.find((e) => !e.allDay && Date.parse(e.start) > now.getTime());
  const upcomingImportant = events.filter((e) => e.important && Date.parse(e.start) >= todayEnd).slice(0, 5);
  const tip = tipOfTheDay(now);
  const five = TIPS[0];

  const toggleTask = async (t: Task) => {
    setTaskData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) }));
    await api.updateTask(t.id, { done: !t.done }).catch(() => {});
    notifyChanged('tasks');
  };

  const openTasks = taskData.tasks.filter((t) => !t.done).length;

  return (
    <div className="dash">
      <section className="glass pad span-8 glow-cyan">
        <div className="hero">
          <HubLamp size="large" className="hero-lamp" />
          <div className="grow">
            <div className="muted mono small">{greeting(now).toUpperCase()}</div>
            <div className="big-clock neon-cyan">{hm(now)}<span className="sec">{fmt(now, 'ss')}</span></div>
            <div className="neon-violet mono" style={{ marginTop: 6 }}>{capitalize(fmt(now, 'EEEE d MMMM yyyy'))}</div>
          </div>
          <div className="next-card" style={{ minWidth: 240 }}>
            <div className="muted small mono">PROSSIMO</div>
            {next ? (
              <>
                <div className="countdown neon-pink">tra {countdown(Date.parse(next.start) - now.getTime())}</div>
                <div style={{ cursor: 'pointer' }} onClick={() => openEvent(next)}>
                  <b>{next.important ? '⚡ ' : ''}{next.title}</b>
                  <div className="muted small">{capitalize(fmt(next.start, 'EEE d MMM'))} · {hm(next.start)} – {hm(next.end)}</div>
                </div>
              </>
            ) : (
              <div className="muted">Nessun impegno nei prossimi giorni ✨</div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary sm" onClick={() => newEvent()}>＋ Evento</button>
              <button className="btn pink sm" onClick={() => startFive(next?.title)}>⚡ 5 secondi</button>
            </div>
          </div>
        </div>
      </section>

      <TipCard tip={tip.id === five.id ? TIPS[1] : tip} compact className="span-4 glow-amber" />

      <section className="glass pad span-7">
        <div className="card-title">
          <h2>Oggi</h2>
          <Link to={`/calendario?view=day&date=${dayKey}`} className="btn sm ghost">Vista oraria →</Link>
        </div>
        <Agenda events={today} now={now} onEventClick={openEvent} empty="Giornata libera: pianifica qualcosa di importante (quadrante 2)." />
      </section>

      <MoveoCard className="span-5 glow-cyan" />

      <PillsToday className="span-7 glow-pink" />

      <section className="glass pad span-5 glow-violet">
        <div className="card-title">
          <h2 className="neon-violet">Matrice di oggi</h2>
          <Link to="/matrice" className="btn sm ghost">{openTasks ? `${openTasks} da fare →` : 'Apri →'}</Link>
        </div>
        <MiniMatrix tasks={taskData.tasks} onToggle={toggleTask} />
        {taskData.pendingBefore > 0 && (
          <div className="alert small" style={{ marginTop: 12 }}>
            Hai {taskData.pendingBefore} attività non completate dei giorni scorsi. <Link to="/matrice" className="neon-amber">Recuperale →</Link>
          </div>
        )}
      </section>

      <WardappCard className="span-12 glow-amber" />

      {goals.length > 0 && (
        <>
          <section className="glass pad span-5 glow-cyan">
            <div className="card-title">
              <h2>Routine di oggi</h2>
              <Link to="/obiettivi" className="btn sm ghost">Settimana →</Link>
            </div>
            <WeekRoutines anchor={now} onlyToday compact />
          </section>
          <section className="glass pad span-7">
            <div className="card-title">
              <h2>Obiettivi</h2>
              <Link to="/obiettivi" className="btn sm ghost">Apri →</Link>
            </div>
            <GoalsMini goals={goals} onOpen={() => navigate('/obiettivi')} />
          </section>
        </>
      )}

      <section className="glass pad span-7">
        <div className="card-title"><h2>Prossimi importanti</h2></div>
        {upcomingImportant.length ? (
          <Agenda events={upcomingImportant} now={now} onEventClick={openEvent} />
        ) : (
          <div className="empty">Nessun evento ⚡ importante nei prossimi 7 giorni.</div>
        )}
      </section>

      <TipCard tip={five} className="span-5 glow-pink" />
    </div>
  );
}
