import { useEffect, useRef, useState } from 'react';
import { api, type Proposal } from '../api';
import { ProposalCard, type ProposalStatus } from '../components/ProposalCard';
import { StudyPlannerForm } from '../components/StudyPlannerForm';
import { useLocalStorage } from '../hooks';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  proposals?: { proposal: Proposal; status: ProposalStatus }[];
}

const WELCOME: Msg = {
  role: 'assistant',
  content: 'Ciao! Sono il tuo assistente di pianificazione. Posso organizzare piani di studio, aggiungere impegni e riempire la matrice di Eisenhower. Ogni modifica ti viene proposta: decidi tu cosa approvare.',
};

const SUGGESTIONS = [
  'Vorrei fare un corso di inglese di 15 ore diviso in 5 moduli da 3 ore, da finire entro fine ottobre',
  'Cosa ho in programma domani?',
  'Aggiungi dentista giovedì alle 15:30, importante',
  'Aiutami a riempire la matrice di oggi: devo consegnare la tesina, fare la spesa, rispondere alle mail',
];

export function AssistantPage() {
  const [messages, setMessages] = useLocalStorage<Msg[]>('calendary.chat', [WELCOME]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ enabled: boolean; model: string; provider: string } | null>(null);
  const [plannerProposals, setPlannerProposals] = useState<{ proposal: Proposal; status: ProposalStatus }[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.assistantStatus().then(setStatus).catch(() => setStatus({ enabled: false, model: '', provider: '' }));
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const ask = async (conversation: Msg[]) => {
    setBusy(true);
    setError(null);
    try {
      const history = conversation.filter((m) => m.content !== WELCOME.content).map(({ role, content }) => ({ role, content }));
      const r = await api.chat(history);
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, proposals: r.proposals.map((p) => ({ proposal: p, status: 'pending' })) }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = (text = input) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    ask(next);
  };

  // The last message is still unanswered (e.g. the AI was overloaded): resend it as is.
  const canRetry = !busy && messages.at(-1)?.role === 'user';

  const resolve = (msgIndex: number, pIndex: number, st: ProposalStatus) =>
    setMessages((ms) => ms.map((m, i) => (i === msgIndex && m.proposals
      ? { ...m, proposals: m.proposals.map((p, j) => (j === pIndex ? { ...p, status: st } : p)) }
      : m)));

  return (
    <div>
      <div className="page-head">
        <h1>Assistente</h1>
        {status?.enabled && <span className="chip"><span className="dot" style={{ color: 'var(--lime)' }} /> {status.model}</span>}
        <button className="btn sm ghost" onClick={() => setMessages([WELCOME])}>Nuova conversazione</button>
      </div>

      <div className="assistant">
        <section className="glass pad chat glow-cyan">
          <div className="chat-log" ref={logRef}>
            {messages.map((m, i) => (
              <div key={i} className="stack" style={{ gap: 8 }}>
                <div className={`msg ${m.role}`}>{m.content}</div>
                {m.proposals?.map((p, j) => (
                  <ProposalCard key={p.proposal.id} proposal={p.proposal} status={p.status} onResolved={(st) => resolve(i, j, st)} />
                ))}
              </div>
            ))}
            {busy && <div className="msg assistant typing"><span /><span /><span /></div>}
            {messages.length <= 1 && status?.enabled && (
              <div className="suggestions">
                {SUGGESTIONS.map((s) => <button key={s} className="btn sm" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
          </div>
          {(error || canRetry) && (
            <div className="alert error row nowrap" style={{ marginBottom: 10 }}>
              <span className="grow">{error || 'L’ultimo messaggio non ha ancora ricevuto risposta.'}</span>
              {canRetry && <button className="btn sm" onClick={() => ask(messages)}>↻ Riprova</button>}
            </div>
          )}
          {status && !status.enabled ? (
            <div className="alert">
              Assistente AI non configurato. Nelle opzioni dell'add-on inserisci <code>ai_api_key</code> (es. una chiave gratuita di Google AI Studio) e riavvia.
              Il <b>pianificatore di studio</b> qui a fianco funziona anche senza AI.
            </div>
          ) : (
            <div className="chat-input">
              <textarea
                className="input"
                placeholder="Scrivi una richiesta… (Invio per inviare, Maiusc+Invio per andare a capo)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
              />
              <button className="btn primary" onClick={() => send()} disabled={busy || !input.trim()}>Invia</button>
            </div>
          )}
        </section>

        <div className="stack">
          <StudyPlannerForm onProposal={(p) => setPlannerProposals((ps) => [{ proposal: p, status: 'pending' }, ...ps])} />
          {plannerProposals.map((p, i) => (
            <ProposalCard key={p.proposal.id} proposal={p.proposal} status={p.status}
              onResolved={(st) => setPlannerProposals((ps) => ps.map((x, j) => (j === i ? { ...x, status: st } : x)))} />
          ))}
        </div>
      </div>
    </div>
  );
}
