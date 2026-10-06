// The trips module as Hubitat sees it (spec §3): everything else stays inside src/trips/.
import { installTripCalendar } from './calendar-port.js';
import { refreshUpcoming } from './weather.js';

export { registerTripRoutes } from './routes.js';
export { checkTripReminders } from './reminders.js';
export { tripDaySummary } from './days.js';
export { installTripCalendar };

const NIGHTLY = '03:30';

/** Calendar mirroring, and the destination weather refreshed at start and every night. */
export function startTrips() {
  installTripCalendar();
  const refresh = () => refreshUpcoming().catch((err) => console.warn('Meteo dei viaggi:', err.message));
  refresh();
  let lastRun = '';
  setInterval(() => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = now.toDateString();
    if (hhmm >= NIGHTLY && lastRun !== day) {
      lastRun = day;
      refresh();
    }
  }, 60_000).unref?.();
}
