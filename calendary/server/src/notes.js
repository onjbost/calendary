import crypto from 'node:crypto';
import { db } from './db.js';
import { httpError, nowIso, str } from './util.js';

// Sticky notes: things to remember that have no date (shopping, ideas, "call the plumber"…).

export const NOTE_COLORS = ['#ffd54a', '#ff7ac8', '#5ee7ff', '#a8ff60', '#c49bff', '#ffab5c'];

function mapNote(r) {
  return {
    id: r.id,
    text: r.text,
    color: r.color,
    pinned: !!r.pinned,
    done: !!r.done,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const getNote = (id) => {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  return row ? mapNote(row) : null;
};

/** Pinned first, then by position (newest on top). */
export function listNotes() {
  return db.prepare('SELECT * FROM notes ORDER BY pinned DESC, done, position DESC, created_at DESC').all().map(mapNote);
}

const color = (c, fallback) => (NOTE_COLORS.includes(c) ? c : fallback);

export function createNote(input = {}) {
  const id = crypto.randomUUID();
  const now = nowIso();
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM notes').get().p;
  const fallback = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
  db.prepare('INSERT INTO notes (id, text, color, pinned, done, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)')
    .run(id, str(input.text, 5000) || '', color(input.color, fallback), input.pinned ? 1 : 0, pos, now, now);
  return getNote(id);
}

export function updateNote(id, patch = {}) {
  const n = getNote(id);
  if (!n) throw httpError(404, 'Nota non trovata');
  const next = {
    text: patch.text !== undefined ? str(patch.text, 5000) || '' : n.text,
    color: patch.color !== undefined ? color(patch.color, n.color) : n.color,
    pinned: patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : (n.pinned ? 1 : 0),
    done: patch.done !== undefined ? (patch.done ? 1 : 0) : (n.done ? 1 : 0),
    position: patch.position !== undefined && Number.isFinite(Number(patch.position)) ? Number(patch.position) : n.position,
  };
  db.prepare('UPDATE notes SET text = ?, color = ?, pinned = ?, done = ?, position = ?, updated_at = ? WHERE id = ?')
    .run(next.text, next.color, next.pinned, next.done, next.position, nowIso(), id);
  return getNote(id);
}

export function deleteNote(id) {
  if (!db.prepare('DELETE FROM notes WHERE id = ?').run(id).changes) throw httpError(404, 'Nota non trovata');
}
