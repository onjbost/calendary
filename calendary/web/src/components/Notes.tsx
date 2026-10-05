import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type Note, type NoteFolder } from '../api';
import { fmt } from '../dates';
import { useNoteFolders, useNotes } from '../hooks';
import { notifyChanged } from '../live';
import { checklistCount, Markdown, plainText, toggleCheck } from '../markdown';
import { useUI } from '../ui';
import { Modal } from './Modal';

export const NOTE_COLORS = ['#ffd54a', '#ff7ac8', '#5ee7ff', '#a8ff60', '#c49bff', '#ffab5c'];

type Filter = 'all' | 'none' | string; // all notes, notes without folder, or a folder id

// ------------------------------------------------------------------- card

/** Fixed-height card with a rendered preview; tap to open the note. */
function NoteCard({ note, folder, onOpen }: { note: Note; folder?: NoteFolder; onOpen: () => void }) {
  const checks = checklistCount(note.text);
  return (
    <button className={`note-card ${note.done ? 'done' : ''} ${note.pinned ? 'pinned' : ''}`} style={{ ['--note' as string]: note.color }} onClick={onOpen}>
      <div className="note-card-head">
        <b className="note-card-title">{note.title || 'Senza titolo'}</b>
        {note.pinned && <span title="Fissata">📌</span>}
        {note.source === 'claude' && <span className="sticky-src" title="Aggiunta da Claude">✦</span>}
      </div>
      <div className="note-card-body">
        {note.text.trim() ? <Markdown text={note.text} /> : <span className="faint">Nessun testo</span>}
      </div>
      <div className="note-card-foot faint tiny">
        {folder && <span className="note-card-folder"><span className="dot" style={{ color: folder.color }} /> {folder.name}</span>}
        {checks.total > 0 && <span>☑ {checks.done}/{checks.total}</span>}
        <span className="spacer" />
        <span>{fmt(note.updatedAt, 'd MMM')}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------- toolbar

/** Inserts Markdown at the cursor: prefixes for lines, wrappers for selections, templates for blocks. */
function useEditorTools(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, onChange: (v: string) => void) {
  const apply = (fn: (before: string, sel: string, after: string) => { text: string; cursor: number }) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const { text, cursor } = fn(value.slice(0, s), value.slice(s, e), value.slice(e));
    onChange(text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };
  /** Prefix every selected line (or the current one). */
  const linePrefix = (prefix: (i: number) => string) => apply((before, sel, after) => {
    const lineStart = before.lastIndexOf('\n') + 1;
    const head = before.slice(0, lineStart);
    const lines = (before.slice(lineStart) + sel).split('\n');
    const body = lines.map((l, i) => prefix(i) + l.replace(/^(#{1,3}\s|[-*]\s\[[ xX]\]\s|[-*]\s|\d+[.)]\s|>\s)/, '')).join('\n');
    return { text: head + body + after, cursor: (head + body).length };
  });
  const wrap = (mark: string) => apply((before, sel, after) => {
    const inner = sel || 'testo';
    return { text: `${before}${mark}${inner}${mark}${after}`, cursor: (before + mark + inner + mark).length };
  });
  const block = (tpl: string) => apply((before, sel, after) => {
    const pre = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const text = `${before}${pre}${tpl}${sel}\n`;
    return { text: text + after, cursor: text.length };
  });
  return [
    { label: 'H1', title: 'Titolo grande', run: () => linePrefix(() => '# ') },
    { label: 'H2', title: 'Titolo', run: () => linePrefix(() => '## ') },
    { label: 'H3', title: 'Sottotitolo', run: () => linePrefix(() => '### ') },
    { label: 'B', title: 'Grassetto', run: () => wrap('**'), cls: 'b' },
    { label: 'I', title: 'Corsivo', run: () => wrap('*'), cls: 'i' },
    { label: 'S', title: 'Barrato', run: () => wrap('~~'), cls: 's' },
    { label: '• Lista', title: 'Elenco puntato', run: () => linePrefix(() => '- ') },
    { label: '1. Lista', title: 'Elenco numerato', run: () => linePrefix((i) => `${i + 1}. `) },
    { label: '☑ Checklist', title: 'Lista di controllo', run: () => linePrefix(() => '- [ ] ') },
    { label: '❝ Citazione', title: 'Citazione', run: () => linePrefix(() => '> ') },
    { label: '🎸 Tablatura', title: 'Tablatura per chitarra', run: () => block('```tab\ne|-----------------|\nB|-----------------|\nG|-----------------|\nD|-----------------|\nA|-----------------|\nE|-----------------|\n```') },
    { label: '</> Codice', title: 'Blocco di codice', run: () => block('```\n\n```') },
    { label: '― Linea', title: 'Separatore', run: () => block('---') },
  ];
}

// --------------------------------------------------------------- full view

/** The note at full page: read it (checklists are tickable), "✎ Modifica" to edit with the formatting toolbar. */
function NoteView({ note, folders, startEditing, onClose, onChange, onDelete }: {
  note: Note;
  folders: NoteFolder[];
  startEditing?: boolean;
  onClose: () => void;
  onChange: (id: string, patch: Partial<Note>) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(!!startEditing);
  const [title, setTitle] = useState(note.title);
  const [text, setText] = useState(note.text);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // follow edits from other devices (or Claude) while only reading
  useEffect(() => {
    if (!editing) {
      setTitle(note.title);
      setText(note.text);
    }
  }, [note.title, note.text, editing]);
  useEffect(() => {
    if (startEditing) titleRef.current?.focus();
  }, [startEditing]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editing && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  const flush = (t = title, x = text) => {
    clearTimeout(timer.current);
    const patch: Partial<Note> = {};
    if (t !== note.title) patch.title = t;
    if (x !== note.text) patch.text = x;
    if (Object.keys(patch).length) onChange(note.id, patch);
  };
  const schedule = (t: string, x: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(t, x), 1000);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const setBody = (v: string) => { setText(v); schedule(title, v); };
  const tools = useEditorTools(area, text, setBody);
  const done = () => { flush(); setEditing(false); setPreview(false); };
  const close = () => { flush(); onClose(); };
  const tick = (line: number) => {
    const next = toggleCheck(text, line);
    setText(next);
    onChange(note.id, { text: next });
  };

  return createPortal(
    <div className="note-view" style={{ ['--note' as string]: note.color }}>
      <header className="note-view-bar">
        <button className="btn" onClick={close}>← Note</button>
        <span className="spacer" />
        <select className="input note-view-folder" value={note.folderId || ''} onChange={(e) => onChange(note.id, { folderId: e.target.value || null })} title="Cartella">
          <option value="">Senza cartella</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <div className="row nowrap" style={{ gap: 4 }}>
          {NOTE_COLORS.map((c) => (
            <button key={c} className={`sticky-color ${c === note.color ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(note.id, { color: c })} aria-label="Colore" />
          ))}
        </div>
        <button className={`btn icon ${note.pinned ? 'primary' : ''}`} onClick={() => onChange(note.id, { pinned: !note.pinned })} title={note.pinned ? 'Togli dalla cima' : 'Fissa in cima'}>📌</button>
        <button className={`btn ${note.done ? 'primary' : ''}`} onClick={() => onChange(note.id, { done: !note.done })}>{note.done ? '✓ Fatta' : '✓ Segna fatta'}</button>
        {confirm ? (
          <>
            <button className="btn danger" onClick={() => { clearTimeout(timer.current); onDelete(note.id); onClose(); }}>Elimina</button>
            <button className="btn ghost" onClick={() => setConfirm(false)}>No</button>
          </>
        ) : <button className="btn icon" onClick={() => setConfirm(true)} title="Elimina">🗑</button>}
        {editing
          ? <button className="btn primary" onClick={done}>✓ Fine</button>
          : <button className="btn primary" onClick={() => setEditing(true)}>✎ Modifica</button>}
      </header>

      <div className="note-view-page">
        {editing ? (
          <>
            <input ref={titleRef} className="note-view-title-input" value={title} placeholder="Titolo"
              onChange={(e) => { setTitle(e.target.value); schedule(e.target.value, text); }} />
            <div className="note-tools">
              {tools.map((t) => (
                <button key={t.label} type="button" className={`note-tool ${t.cls || ''}`} title={t.title}
                  onMouseDown={(e) => e.preventDefault()} onClick={t.run} disabled={preview}>{t.label}</button>
              ))}
              <span className="spacer" />
              <button type="button" className={`note-tool ${preview ? 'on' : ''}`} onClick={() => setPreview((v) => !v)}>👁 Anteprima</button>
            </div>
            {preview
              ? <Markdown text={text} className="note-view-body" />
              : <textarea ref={area} className="note-editor" value={text} onChange={(e) => setBody(e.target.value)}
                  placeholder={'Scrivi qui…\n\n# Titolo\n- elenco\n- [ ] da fare'} />}
          </>
        ) : (
          <>
            <h1 className="note-view-title">{note.title || 'Senza titolo'}</h1>
            <div className="faint small" style={{ marginBottom: 18 }}>
              {folders.find((f) => f.id === note.folderId)?.name || 'Senza cartella'} · modificata {fmt(note.updatedAt, "d MMMM 'alle' HH:mm")}
              {note.source === 'claude' ? ' · ✦ aggiunta da Claude' : ''}
            </div>
            {text.trim()
              ? <Markdown text={text} onToggle={tick} className="note-view-body" />
              : <div className="empty" onClick={() => setEditing(true)} style={{ cursor: 'pointer' }}>Nota vuota: tocca “✎ Modifica” per scrivere.</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ folders

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

// -------------------------------------------------------------------- board

/** Notes grouped in folders (one per project): cards with a preview, full page on tap. Used by /note and the tablet. */
export function NotesBoard() {
  const { toast } = useUI();
  const { data: notes, setData, reload } = useNotes();
  const { data: folders } = useNoteFolders();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<{ id: string; edit: boolean } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editFolder, setEditFolder] = useState<NoteFolder | 'new' | null>(null);

  // the selected folder was deleted elsewhere
  useEffect(() => {
    if (filter !== 'all' && filter !== 'none' && folders.length && !folders.some((f) => f.id === filter)) setFilter('all');
  }, [folders, filter]);

  const current = folders.find((f) => f.id === filter);
  const byId = new Map(folders.map((f) => [f.id, f]));

  const add = async () => {
    try {
      const n = await api.createNote({ folderId: current ? current.id : null, ...(current ? {} : { color: NOTE_COLORS[notes.length % NOTE_COLORS.length] }) });
      setData((list) => [n, ...list]);
      setOpen({ id: n.id, edit: true });
      notifyChanged('notes');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const change = async (id: string, patch: Partial<Note>) => {
    setData((list) => list.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)));
    try {
      await api.updateNote(id, patch);
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
  const openList = visible.filter((n) => !n.done);
  const doneList = visible.filter((n) => n.done);
  const looseCount = notes.filter((n) => !n.folderId && !n.done).length;
  const opened = open ? notes.find((n) => n.id === open.id) : null;
  const card = (n: Note) => <NoteCard key={n.id} note={n} folder={n.folderId ? byId.get(n.folderId) : undefined} onOpen={() => setOpen({ id: n.id, edit: false })} />;

  return (
    <div className="stack notes-board">
      <div className="folder-bar">
        <button className={`folder-chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          Tutte <span className="faint">{notes.filter((n) => !n.done).length}</span>
        </button>
        {folders.map((f) => (
          <button key={f.id} className={`folder-chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)} title={f.description || f.name}>
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
          {openList.length ? `${openList.length} ${openList.length === 1 ? 'nota' : 'note'}` : 'Nessuna nota: scrivi qui le cose da ricordare senza una data.'}
        </span>
        <span className="spacer" />
        {doneList.length > 0 && (
          <button className="btn sm ghost" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Nascondi' : 'Mostra'} completate ({doneList.length})</button>
        )}
      </div>
      <div className="note-grid">{openList.map(card)}</div>
      {showDone && doneList.length > 0 && (
        <>
          <div className="muted small mono">COMPLETATE</div>
          <div className="note-grid">{doneList.map(card)}</div>
        </>
      )}
      {opened && (
        <NoteView key={opened.id} note={opened} folders={folders} startEditing={open?.edit}
          onClose={() => setOpen(null)} onChange={change} onDelete={remove} />
      )}
      {editFolder && (
        <FolderModal folder={editFolder === 'new' ? undefined : editFolder} onClose={() => setEditFolder(null)}
          onSaved={(f) => setFilter(f ? f.id : 'all')} />
      )}
    </div>
  );
}

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
                <div className="ellipsis">{n.pinned ? '📌 ' : ''}<b>{n.title || plainText(n.text).slice(0, 80)}</b></div>
                <div className="faint tiny ellipsis">
                  {folder && <span><span className="dot" style={{ color: folder.color, width: 7, height: 7, display: 'inline-block' }} /> {folder.name}</span>}
                  {folder && n.title && n.text ? ' · ' : ''}{n.title ? plainText(n.text) : ''}
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
