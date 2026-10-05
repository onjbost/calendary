import { useEffect, useRef, useState } from 'react';
import { api, type Note } from '../api';
import { fmt } from '../dates';
import { useNotes } from '../hooks';
import { notifyChanged } from '../live';
import { useUI } from '../ui';

export const NOTE_COLORS = ['#ffd54a', '#ff7ac8', '#5ee7ff', '#a8ff60', '#c49bff', '#ffab5c'];

/** One sticky note: edited in place, saved while typing (debounced) and on blur. */
function StickyNote({ note, onChange, onDelete, autoFocus }: {
  note: Note;
  onChange: (id: string, patch: Partial<Note>) => void;
  onDelete: (id: string) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(note.text);
  const [focused, setFocused] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Edited on another device: follow it, unless we're typing here.
  useEffect(() => {
    if (!focused) setText(note.text);
  }, [note.text, focused]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Grow with the content.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(90, el.scrollHeight)}px`;
  }, [text]);

  const flush = (value = text) => {
    clearTimeout(timer.current);
    if (value !== note.text) onChange(note.id, { text: value });
  };

  const type = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(value), 800);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className={`sticky ${note.done ? 'done' : ''} ${note.pinned ? 'pinned' : ''}`} style={{ ['--note' as string]: note.color }}>
      <div className="sticky-bar">
        <button className={`sticky-btn ${note.pinned ? 'on' : ''}`} onClick={() => onChange(note.id, { pinned: !note.pinned })}
          title={note.pinned ? 'Togli dalla cima' : 'Fissa in cima'} aria-label="Fissa">📌</button>
        <button className={`sticky-btn ${note.done ? 'on' : ''}`} onClick={() => onChange(note.id, { done: !note.done })}
          title={note.done ? 'Da fare' : 'Fatto'} aria-label="Fatto">✓</button>
        <span className="spacer" />
        {NOTE_COLORS.map((c) => (
          <button key={c} className={`sticky-color ${c === note.color ? 'on' : ''}`} style={{ background: c }}
            onClick={() => onChange(note.id, { color: c })} aria-label="Colore" />
        ))}
      </div>
      <textarea
        ref={ref}
        className="sticky-text"
        value={text}
        placeholder="Scrivi qui…"
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); flush(); }}
        onChange={(e) => type(e.target.value)}
      />
      <div className="sticky-foot">
        <span className="faint tiny">{fmt(note.updatedAt, "d MMM 'alle' HH:mm")}</span>
        <span className="spacer" />
        {confirm ? (
          <>
            <button className="btn sm danger" onClick={() => onDelete(note.id)}>Elimina</button>
            <button className="btn sm ghost" onClick={() => setConfirm(false)}>No</button>
          </>
        ) : (
          <button className="sticky-btn" onClick={() => setConfirm(true)} aria-label="Elimina" title="Elimina">🗑</button>
        )}
      </div>
    </div>
  );
}

/** Board of sticky notes: things to remember without a date. Used by the /note page and the tablet. */
export function NotesBoard() {
  const { toast } = useUI();
  const { data: notes, setData, reload } = useNotes();
  const [fresh, setFresh] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const add = async () => {
    try {
      const n = await api.createNote({ color: NOTE_COLORS[notes.length % NOTE_COLORS.length] });
      setData((list) => [n, ...list]);
      setFresh(n.id);
      notifyChanged('notes');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const change = async (id: string, patch: Partial<Note>) => {
    setData((list) => list.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)));
    try {
      await api.updateNote(id, patch);
      // pin/done change the order: reload from the server; plain text edits keep the cards where they are
      if (patch.pinned !== undefined || patch.done !== undefined) reload();
    } catch (e) {
      toast((e as Error).message, 'error');
      reload();
    }
  };

  const remove = async (id: string) => {
    setData((list) => list.filter((n) => n.id !== id));
    await api.deleteNote(id).catch((e) => toast((e as Error).message, 'error'));
    notifyChanged('notes');
  };

  const open = notes.filter((n) => !n.done);
  const done = notes.filter((n) => n.done);

  return (
    <div className="stack notes-board">
      <div className="row">
        <button className="btn primary lg" onClick={add}>＋ Nuova nota</button>
        <span className="faint small">{open.length ? `${open.length} ${open.length === 1 ? 'nota' : 'note'}` : 'Nessuna nota: scrivi qui le cose da ricordare senza una data.'}</span>
        <span className="spacer" />
        {done.length > 0 && (
          <button className="btn sm ghost" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Nascondi' : 'Mostra'} completate ({done.length})</button>
        )}
      </div>
      <div className="sticky-grid">
        {open.map((n) => <StickyNote key={n.id} note={n} onChange={change} onDelete={remove} autoFocus={n.id === fresh} />)}
      </div>
      {showDone && done.length > 0 && (
        <>
          <div className="muted small mono">COMPLETATE</div>
          <div className="sticky-grid">
            {done.map((n) => <StickyNote key={n.id} note={n} onChange={change} onDelete={remove} />)}
          </div>
        </>
      )}
    </div>
  );
}
