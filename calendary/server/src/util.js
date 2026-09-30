import { config } from './config.js';

export function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export const nowIso = () => new Date().toISOString();

export function toIso(value, field = 'data') {
  if (value === undefined || value === null || value === '') throw httpError(400, `Campo "${field}" mancante`);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, `Campo "${field}" non è una data valida`);
  return d.toISOString();
}

export function isYmd(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function ymd(date) {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseYmd(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function str(value, max = 500) {
  if (value === undefined || value === null) return null;
  return String(value).trim().slice(0, max);
}

const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: config.timezone });
const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: config.timezone });
const longDayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: config.timezone });

export const fmtTime = (iso) => timeFmt.format(new Date(iso));
export const fmtDay = (iso) => dayFmt.format(new Date(iso));
export const fmtLongDay = (iso) => longDayFmt.format(new Date(iso));
export const fmtDayTime = (iso) => `${fmtDay(iso)} ${fmtTime(iso)}`;

/** Local "YYYY-MM-DDTHH:mm" string, what the assistant reads and writes. */
export function localStamp(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${ymd(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function stripHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
