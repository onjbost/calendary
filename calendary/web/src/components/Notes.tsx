import { useEffect, useRef, useState } from 'react';
import { api, type Note, type NoteFolder } from '../api';
import { fmt } from '../dates';
import { useNoteFolders, useNotes } from '../hooks';
import { notifyChanged } from '../live';
import { useUI } from '../ui';
import { Modal } from './Modal';

export const NOTE_COLORS = ['#ffd54a', '#ff7ac8', '#5ee7ff', '#a8ff60', '#c49bff', '#ffab5c'];

type Filter = 'all' | 'none' | string; // all notes, notes without folder, or a folder id

/** Text area that grows with its content. */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, min: number) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(min, el.scrollHeight)}px`;
  }, [ref, value, min]);
}

/** One sticky note: title + description, edited in place, saved while typing (debounced) and on blur. */
function StickyNote({ note, folders, showFolder, onChange, onDelete, autoFocus }: {
  note: Note;
  folders: NoteFolder[];
  showFolder: boolean;
  onChange: (id: string, patch: Partial<Note>) => void;
  onDelete: (id: string) => void;
  autoFocus?: boolean;
}) {
  const [title, setTitle] = useState(note.title);
  const [text, setText] = useState(note.text);
  const [focused, setFocused] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const titleRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(textRef, text, 70);

  // Edited on another device (or by Claude): follow it, unless we're typing here.
  useEffect(() => {
    if (!focused) {
      setTitle(note.title);
      setText(note.text);
    }
  }, [note.title, note.text, focused]);

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  const flush = (t = title, x = text) => {
    clearTimeout(timer.current);
    const patch: Partial<Note> = {};
    if (t !== note.title) patch.title = t;
    if (x !== note.text) patch.text = x;
    if (Object.keys(patch).length) onChange(note.id, patch);
  };
  const schedule = (t: string, x: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(t, x), 800);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const folder = folders.find((f) => f.id === note.folderId);
  const focusProps = { onFocus: () => setFocused(true), onBlur: () => { setFocused(false); flush(); } };

  return (
    <div className={`sticky ${note.done ? 'done' : ''} ${note.pinned ? 'pinned' : ''}`} style={{ ['--note' as string]: note.color }}>
      <div className="sticky-bar">
        <button className={`sticky-btn ${note.pinned ? 'on' : ''}`} onClick={() => onChange(note.id, { pinned: !note.pinned })}
          title={note.pinned ? 'Togli dalla cima' : 'Fissa in cima'} aria-label="Fissa">📌</button>
        <button className={`sticky-btn ${note.done ? 'on' : ''}`} onClick={() => onChange(note.id, { done: !note.done })}
          title={note.done ? 'Da fare' : 'Fatto'} aria-label="Fatto">✓</button>
        {note.source === 'claude' && <span className="sticky-src" title="Aggiunta da Claude">✦</span>}
        <span className="spacer" />
        {NOTE_COLORS.map((c) => (
          <button key={c} className={`sticky-color ${c === note.color ? 'on' : ''}`} style={{ background: c }}
            onClick={() => onChange(note.id, { color: c })} aria-label="Colore" />
        ))}
      </div>
      <input
        ref={titleRef}
        className="sticky-title"
        value={title}
        placeholder="Titolo"
        {...focusProps}
        onChange={(e) => { setTitle(e.target.value); schedule(e.target.value, text); }}
      />
      <textarea
        ref={textRef}
        className="sticky-text"
        value={text}
        placeholder="Descrizione…"
        {...focusProps}
        onChange={(e) => { setText(e.target.value); schedule(title, e.target.value); }}
      />
      <div className="sticky-foot">
        <select className="sticky-folder" value={note.folderId || ''} onChange={(e) => onChange(note.id, { folderId: e.target.value || null })}
          title="Cartella" style={showFolder || !folder ? undefined : { opacity: 0.6 }}>
          <option value="">Senza cartella</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <span className="faint tiny">{fmt(note.updatedAt, 'd MMM')}</span>
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

/** Create / rename / delete a folder (a project). */
function FolderModal({ folder, onClose, onSaved }: { folder?: NoteFolder; onClose: () => void; onSaved: (f: NoteFolder | null) => void }) {
  const { toast } = useUI();
  const [name, setName] = useState(folder?.name || '');
  const [description, setDescription] = useState(folder?.description || '');
  const [color, setColor] = useState(folder?.color || NOTE_COLORS[2]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const save = async () => {
    try {
      const f = folder
        ? await api.updateNoteFolder(folder.id, { name, description, color })
        : await api.createNoteFolder({ name, description, color });
      notifyChanged('notes');
      onSaved(f);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (withNotes: boolean) => {
    if (!folder) return;
    await api.deleteNoteFolder(folder.id, withNotes);
    notifyChanged('notes');
    toast(withNotes ? 'Cartella e note eliminate' : 'Cartella eliminata: le note restano senza cartella');
    onSaved(null);
    onClose();
  };

  return (
    <Modal title={folder ? 'Modifica cartella' : 'Nuova cartella'} onClose={onClose} glow="violet"
      footer={<>
        {folder && !confirm && <button className="btn danger" onClick={() => setConfirm(true)}>Elimina</button>}
        {folder && confirm && (
          <>
            <button className="btn danger" onClick={() => remove(false)}>Solo la cartella</button>
            <button className="btn danger" onClick={() => remove(true)}>Cartella e note</button>
          </>
        )}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Annulla</button>
        <button className="btn primary" onClick={save}>Salva</button>
      </>}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <label className="field">Nome del progetto
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Es. Calendary" onKeyDown={(e) => e.key === 'Enter' && save()} />
        </label>
        <label className="field">Descrizione
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Es. Modifiche e idee per l'app Calendary" />
        </label>
        <div className="row">
          <span className="muted small">Colore</span>
          {NOTE_COLORS.map((c) => (
            <button key={c} className={`sticky-color ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label="Colore" />
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Board of sticky notes grouped in folders (one per project). Used by the /note page and the tablet. */
export function NotesBoard() {
  const { toast } = useUI();
  const { data: notes, setData, reload } = useNotes();
  const { data: folders } = useNoteFolders();
  const [filter, setFilter] = useState<Filter>('all');
  const [fresh, setFresh] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editFolder, setEditFolder] = useState<NoteFolder | 'new' | null>(null);

  // the selected folder was deleted elsewhere
  useEffect(() => {
    if (filter !== 'all' && filter !== 'none' && folders.length && !folders.some((f) => f.id === filter)) setFilter('all');
  }, [folders, filter]);

  const current = folders.find((f) => f.id === filter);

  const add = async () => {
    try {
      const folderId = current ? current.id : null;
      const n = await api.createNote({ folderId, ...(current ? {} : { color: NOTE_COLORS[notes.length % NOTE_COLORS.length] }) });
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
      // pin/done/folder change the order or the counts: reload; plain text edits keep the cards where they are
      if (patch.pinned !== undefined || patch.done !== undefined || patch.folderId !== undefined) notifyChanged('notes');
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

  const visible = notes.filter((n) => (filter === 'all' ? true : filter === 'none' ? !n.folderId : n.folderId === filter));
  const open = visible.filter((n) => !n.done);
  const done = visible.filter((n) => n.done);
  const looseCount = notes.filter((n) => !n.folderId && !n.done).length;
  const card = (n: Note) => (
    <StickyNote key={n.id} note={n} folders={folders} showFolder={filter === 'all'} onChange={change} onDelete={remove} autoFocus={n.id === fresh} />
  );

  return (
    <div className="stack notes-board">
      <div className="folder-bar">
        <button className={`folder-chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          Tutte <span className="faint">{notes.filter((n) => !n.done).length}</span>
        </button>
        {folders.map((f) => (
          <button key={f.id} className={`folder-chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}
            style={{ ['--note' as string]: f.color }} title={f.description || f.name}>
            <span className="dot" style={{ color: f.color }} /> {f.name} <span className="faint">{f.open}</span>
          </button>
        ))}
        {looseCount > 0 && folders.length > 0 && (
          <button className={`folder-chip ${filter === 'none' ? 'on' : ''}`} onClick={() => setFilter('none')}>
            Senza cartella <span className="faint">{looseCount}</span>
          </button>
        )}
        <button className="folder-chip add" onClick={() => setEditFolder('new')}>＋ Cartella</button>
      </div>

      {current && (
        <div className="folder-head">
          <span className="dot" style={{ color: current.color }} />
          <b>{current.name}</b>
          {current.description && <span className="muted small">{current.description}</span>}
          <button className="btn sm ghost" onClick={() => setEditFolder(current)}>✎ Modifica</button>
        </div>
      )}

      <div className="row">
        <button className="btn primary lg" onClick={add}>＋ Nuova nota{current ? ` in ${current.name}` : ''}</button>
        <span className="faint small">
          {open.length ? `${open.length} ${open.length === 1 ? 'nota' : 'note'}` : 'Nessuna nota: scrivi qui le cose da ricordare senza una data.'}
        </span>
        <span className="spacer" />
        {done.length > 0 && (
          <button className="btn sm ghost" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Nascondi' : 'Mostra'} completate ({done.length})</button>
        )}
      </div>
      <div className="sticky-grid">{open.map(card)}</div>
      {showDone && done.length > 0 && (
        <>
          <div className="muted small mono">COMPLETATE</div>
          <div className="sticky-grid">{done.map(card)}</div>
        </>
      )}
      {editFolder && (
        <FolderModal folder={editFolder === 'new' ? undefined : editFolder} onClose={() => setEditFolder(null)}
          onSaved={(f) => setFilter(f ? f.id : 'all')} />
      )}
    </div>
  );
}

/** Compact list for the tablet dashboard: open notes (pinned first), tap to open the Note tab. */
export function NotesMini({ onOpen, max = 6 }: { onOpen: () => void; max?: number }) {
  const { data: notes } = useNotes();
  const { data: folders } = useNoteFolders();
  const open = notes.filter((n) => !n.done && (n.title || n.text));
  const byId = new Map(folders.map((f) => [f.id, f]));
  return (
    <section className="glass pad glow-amber">
      <div className="card-title" style={{ marginBottom: 10 }}>
        <h3>✎ Note</h3>
        <span className="chip">{open.length}</span>
        <button className="btn sm ghost" onClick={onOpen}>Apri →</button>
      </div>
      {!open.length ? (
        <div className="muted small" onClick={onOpen} style={{ cursor: 'pointer' }}>Nessuna nota. Tocca per scriverne una.</div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {open.slice(0, max).map((n) => {
            const folder = n.folderId ? byId.get(n.folderId) : null;
            return (
              <div key={n.id} className="note-mini" style={{ ['--note' as string]: n.color }} onClick={onOpen}>
                <div className="ellipsis">{n.pinned ? '📌 ' : ''}<b>{n.title || n.text.split('\n')[0]}</b></div>
                <div className="faint tiny ellipsis">
                  {folder && <span><span className="dot" style={{ color: folder.color, width: 7, height: 7, display: 'inline-block' }} /> {folder.name}</span>}
                  {folder && n.title && n.text ? ' · ' : ''}{n.title ? n.text.replace(/\s+/g, ' ') : ''}
                </div>
              </div>
            );
          })}
          {open.length > max && <div className="faint tiny" onClick={onOpen} style={{ cursor: 'pointer' }}>+{open.length - max} altre</div>}
        </div>
      )}
    </section>
  );
}
