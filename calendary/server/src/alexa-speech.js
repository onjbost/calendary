import { config } from './config.js';
import { addDays, startOfDay } from './util.js';

// Italian phrasing for what Alexa says aloud ("alle 9", "all'una e 30", "domani", "tra 2 ore").

/** "alle 9", "alle 15:30", "all'una", "a mezzanotte". */
export function atTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const mm = m ? `:${String(m).padStart(2, '0')}` : '';
  if (h === 0 && !m) return 'a mezzanotte';
  if (h === 12 && !m) return 'a mezzogiorno';
  if (h === 1) return `all'una${m ? ` e ${m}` : ''}`;
  return `alle ${h}${mm}`;
}

const weekdayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: config.timezone });

/** "oggi", "domani", "dopodomani" or "giovedì 8 ottobre". */
export function dayLabel(date, now = new Date()) {
  const day = startOfDay(date).getTime();
  const today = startOfDay(now);
  if (day === today.getTime()) return 'oggi';
  if (day === addDays(today, 1).getTime()) return 'domani';
  if (day === addDays(today, 2).getTime()) return 'dopodomani';
  return weekdayFmt.format(new Date(date));
}

/** "tra 10 minuti", "tra un'ora", "tra 2 ore e 15 minuti", "domani". */
export function inMinutes(min) {
  if (min <= 0) return 'adesso';
  if (min < 60) return min === 1 ? 'tra un minuto' : `tra ${min} minuti`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!m && h === 24) return 'domani a questa ora';
  if (!m && h % 24 === 0) return `tra ${h / 24} giorni`;
  const hours = h === 1 ? "un'ora" : `${h} ore`;
  return m ? `tra ${hours} e ${m} minuti` : `tra ${hours}`;
}

/** "a, b e c" */
export function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}
