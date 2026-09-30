import { useRef, useState } from 'react';
import { api, type Goal, type RoutineDraft } from '../api';
import { EvidenceModal, GoalEditor, RoutineEditor } from '../components/GoalModals';
import { GoalCard, ProgressBar, WeekRoutines } from '../components/GoalWidgets';
import { fmt, parseYmd } from '../dates';
import { pct } from '../goals';
import { useGoals, useNow } from '../hooks';
import { notifyChanged } from '../live';
import { useUI } from '../ui';

type Dialog =
  | { kind: 'goal'; goal?: Goal }
  | { kind: 'routine'; goalId?: string; routineId?: string; draft?: RoutineDraft }
  | { kind: 'evidence'; goal: Goal; itemId?: string };

async function download(url: string, fallbackName: string) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Download non riuscito (HTTP ${res.status})`);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function GoalsPage() {
  const { toast } = useUI();
  const { data: goals, loading } = useGoals();
  const now = useNow(60_000);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = goals.filter((g) => g.status !== 'done');
  const overall = goals.length ? goals.reduce((s, g) => s + g.progress, 0) / goals.length : 0;
  const expected = goals.length ? goals.reduce((s, g) => s + g.expected, 0) / goals.length : 0;
  const nextDeadline = active.map((g) => g.deadline).sort()[0];
  const behind = goals.filter((g) => g.pace === 'behind').length;
  const untracked = goals.filter((g) => g.pace === 'untracked').length;

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const r = await api.importGoals(data);
      notifyChanged('goals');
      notifyChanged('events');
      toast(`Importati ${r.created} obiettivi e ${r.routines} routine${r.skipped.length ? ` · ${r.skipped.length} già presenti, saltati` : ''}`);
    } catch (e) {
      toast(e instanceof SyntaxError ? 'Il file non è un JSON valido' : (e as Error).message, 'error');
    }
  };

  const openRoutine = (goal: Goal, routineId?: string) => setDialog({ kind: 'routine', goalId: goal.id, routineId });

  return (
    <div>
      <div className="page-head">
        <h1>Obiettivi</h1>
        <button className="btn primary" onClick={() => setDialog({ kind: 'goal' })}>＋ Obiettivo</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Importa</button>
        <button className="btn" onClick={() => download('/api/goals/export', 'obiettivi.json').catch((e) => toast(e.message, 'error'))} disabled={!goals.length}>Esporta</button>
        <button className="btn pink" onClick={() => download('/api/goals/report', 'report-obiettivi.md').catch((e) => toast(e.message, 'error'))} disabled={!goals.length}>Report per la review</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
      </div>

      {!loading && !goals.length ? (
        <section className="glass pad glow-violet stack" style={{ maxWidth: 720 }}>
          <h2 className="neon-violet">Tieni traccia dei tuoi obiettivi</h2>
          <div className="muted">
            Crea un obiettivo con le sue <b>misure</b> (spunte, valori con target, conteggi di evidenze), aggiungi <b>routine</b> settimanali che
            compaiono nel calendario con promemoria, e annota le <b>evidenze</b> man mano: a MidYear e Year-End scarichi il report già pronto.
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => setDialog({ kind: 'goal' })}>＋ Crea il primo obiettivo</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>Importa da file JSON</button>
          </div>
        </section>
      ) : (
        <>
          <div className="dash" style={{ marginBottom: 18 }}>
            <section className="glass pad span-5 glow-cyan stack">
              <div className="muted mono small">AVANZAMENTO COMPLESSIVO</div>
              <div className="row nowrap">
                <div className="big-clock neon-cyan" style={{ fontSize: '3.2rem' }}>{pct(overall)}</div>
                <div className="stack grow" style={{ gap: 6 }}>
                  <ProgressBar value={overall} expected={expected} color="var(--cyan)" />
                  <div className="faint tiny">atteso a oggi {pct(expected)}</div>
                </div>
              </div>
              <div className="row small">
                <span className="chip">{goals.length} obiettivi</span>
                {behind > 0 && <span className="chip neon-amber">{behind} in ritardo</span>}
                {untracked > 0 && <span className="chip muted">{untracked} da aggiornare</span>}
                {nextDeadline && (
                  <span className="chip">🏁 {fmt(parseYmd(nextDeadline), 'd MMM yyyy')} · {Math.ceil((parseYmd(nextDeadline).getTime() - now.getTime()) / 86400e3)} gg</span>
                )}
              </div>
              {untracked > 0 && (
                <div className="faint tiny">
                  “Da aggiornare”: non c’è ancora nessun valore. Spunta le misure già raggiunte e inserisci i valori attuali, così il confronto con il tempo trascorso diventa affidabile.
                </div>
              )}
            </section>
            <section className="glass pad span-7">
              <div className="card-title"><h2>Routine di questa settimana</h2></div>
              <WeekRoutines anchor={now} />
            </section>
          </div>

          <div className="goals-grid">
            {goals.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                onEdit={() => setDialog({ kind: 'goal', goal: g })}
                onRoutine={(routineId) => openRoutine(g, routineId)}
                onEvidence={(itemId) => setDialog({ kind: 'evidence', goal: g, itemId })}
              />
            ))}
          </div>
          <div className="faint small" style={{ marginTop: 14 }}>
            Suggerimento: nell’<b>Assistente</b> puoi chiedere «proponimi routine settimanali per l’obiettivo …»: verifica i tuoi impegni e ti propone orari da approvare.
          </div>
        </>
      )}

      {dialog?.kind === 'goal' && <GoalEditor goal={dialog.goal} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'routine' && (
        <RoutineEditor
          goals={goals}
          goalId={dialog.goalId}
          routine={goals.flatMap((g) => g.routines).find((r) => r.id === dialog.routineId)}
          draft={dialog.draft}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'evidence' && <EvidenceModal goal={dialog.goal} itemId={dialog.itemId} onClose={() => setDialog(null)} />}
    </div>
  );
}
