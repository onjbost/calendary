import crypto from 'node:crypto';
import { db } from './db.js';
import { httpError, nowIso, str } from './util.js';

// Sticky notes: things to remember that have no date (shopping, ideas, changes to make to an app…),
// optionally grouped in folders, one per project.

export const NOTE_COLORS = ['#ffd54a', '#ff7ac8', '#5ee7ff', '#a8ff60', '#c49bff', '#ffab5c'];
const color = (c, fallback) => (NOTE_COLORS.includes(c) ? c : fallback);
const randomColor = () => NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];

// ------------------------------------------------------------------ folders

function mapFolder(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    color: r.color,
    position: r.position,
    count: r.count ?? 0,
    open: r.open ?? 0,
  };
}

export function listFolders() {
  return db.prepare(`SELECT f.*, COUNT(n.id) AS count, SUM(CASE WHEN n.done = 0 THEN 1 ELSE 0 END) AS open
    FROM note_folders f LEFT JOIN notes n ON n.folder_id = f.id
    GROUP BY f.id ORDER BY f.position, f.name`).all().map(mapFolder);
}

export function getFolder(id) {
  const row = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(id);
  return row ? mapFolder(row) : null;
}

/** A folder by id or by name (case insensitive). */
export function findFolder(ref) {
  const r = str(ref, 80);
  if (!r) return null;
  return getFolder(r) || (() => {
    const row = db.prepare('SELECT * FROM note_folders WHERE lower(name) = lower(?)').get(r);
    return row ? mapFolder(row) : null;
  })();
}

export function createFolder(input = {}) {
  const name = str(input.name, 80);
  if (!name) throw httpError(400, 'La cartella deve avere un nome');
  if (findFolder(name)) throw httpError(400, `Esiste già una cartella "${name}"`);
  const id = crypto.randomUUID();
  const now = nowIso();
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM note_folders').get().p;
  db.prepare('INSERT INTO note_folders (id, name, description, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, str(input.description, 1000) || '', color(input.color, randomColor()), pos, now, now);
  return getFolder(id);
}

export function updateFolder(id, patch = {}) {
  const f = getFolder(id);
  if (!f) throw httpError(404, 'Cartella non trovata');
  const name = patch.name !== undefined ? str(patch.name, 80) : f.name;
  if (!name) throw httpError(400, 'La cartella deve avere un nome');
  const clash = findFolder(name);
  if (clash && clash.id !== id) throw httpError(400, `Esiste già una cartella "${name}"`);
  db.prepare('UPDATE note_folders SET name = ?, description = ?, color = ?, position = ?, updated_at = ? WHERE id = ?').run(
    name,
    patch.description !== undefined ? str(patch.description, 1000) || '' : f.description,
    patch.color !== undefined ? color(patch.color, f.color) : f.color,
    patch.position !== undefined && Number.isFinite(Number(patch.position)) ? Number(patch.position) : f.position,
    nowIso(), id,
  );
  return getFolder(id);
}

/** Deleting a folder keeps its notes (they go back to "no folder") unless `withNotes`. */
export function deleteFolder(id, { withNotes = false } = {}) {
  if (!getFolder(id)) throw httpError(404, 'Cartella non trovata');
  if (withNotes) db.prepare('DELETE FROM notes WHERE folder_id = ?').run(id);
  else db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(id);
  db.prepare('DELETE FROM note_folders WHERE id = ?').run(id);
}

// -------------------------------------------------------------------- notes

function mapNote(r) {
  return {
    id: r.id,
    title: r.title || '',
    text: r.text,
    color: r.color,
    folderId: r.folder_id || null,
    pinned: !!r.pinned,
    done: !!r.done,
    position: r.position,
    source: r.source || 'manual',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const getNote = (id) => {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  return row ? mapNote(row) : null;
};

/** Pinned first, then by position (newest on top). `folderId`: a folder, 'none' (no folder) or empty (all). */
export function listNotes({ folderId } = {}) {
  const where = folderId === 'none' ? 'WHERE folder_id IS NULL' : folderId ? 'WHERE folder_id = ?' : '';
  const args = folderId && folderId !== 'none' ? [folderId] : [];
  return db.prepare(`SELECT * FROM notes ${where} ORDER BY pinned DESC, done, position DESC, created_at DESC`).all(...args).map(mapNote);
}

function folderIdOf(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const f = getFolder(value);
  if (!f) throw httpError(400, 'Cartella non trovata');
  return f.id;
}

export function createNote(input = {}, { source = 'manual' } = {}) {
  const id = crypto.randomUUID();
  const now = nowIso();
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM notes').get().p;
  const folderId = folderIdOf(input.folderId) ?? null;
  // notes of a folder take its color unless one is given
  const fallback = folderId ? getFolder(folderId).color : randomColor();
  db.prepare(`INSERT INTO notes (id, title, text, color, folder_id, pinned, done, position, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`).run(
    id, str(input.title, 200) || '', str(input.text, 5000) || '', color(input.color, fallback), folderId,
    input.pinned ? 1 : 0, pos, str(source, 20) || 'manual', now, now,
  );
  return getNote(id);
}

export function updateNote(id, patch = {}) {
  const n = getNote(id);
  if (!n) throw httpError(404, 'Nota non trovata');
  const folderId = folderIdOf(patch.folderId);
  const next = {
    title: patch.title !== undefined ? str(patch.title, 200) || '' : n.title,
    text: patch.text !== undefined ? str(patch.text, 5000) || '' : n.text,
    color: patch.color !== undefined ? color(patch.color, n.color) : n.color,
    folderId: folderId !== undefined ? folderId : n.folderId,
    pinned: patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : (n.pinned ? 1 : 0),
    done: patch.done !== undefined ? (patch.done ? 1 : 0) : (n.done ? 1 : 0),
    position: patch.position !== undefined && Number.isFinite(Number(patch.position)) ? Number(patch.position) : n.position,
  };
  db.prepare('UPDATE notes SET title = ?, text = ?, color = ?, folder_id = ?, pinned = ?, done = ?, position = ?, updated_at = ? WHERE id = ?')
    .run(next.title, next.text, next.color, next.folderId, next.pinned, next.done, next.position, nowIso(), id);
  return getNote(id);
}

export function deleteNote(id) {
  if (!db.prepare('DELETE FROM notes WHERE id = ?').run(id).changes) throw httpError(404, 'Nota non trovata');
}
