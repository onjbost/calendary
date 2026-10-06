// Pure rules of the lamp modes, shared by every page (no imports: also runs under `node --test`).

export type LampMode = 'normal' | 'eco' | 'night';
export interface LampOverride { mode: LampMode; sig: string }

/** Automatic conditions every page can compute the same way (no kiosk idle time in here). */
export interface AutoConditions { ecoAuto: boolean; charging: boolean | null; nightHours: boolean }

export const nextMode = (m: LampMode): LampMode => (m === 'normal' ? 'eco' : m === 'eco' ? 'night' : 'normal');

/** Changes whenever the automatic conditions change: a manual choice lasts until then. */
export const autoSignature = (c: AutoConditions) => `${c.ecoAuto ? 1 : 0}|${c.charging === null ? '-' : c.charging ? 1 : 0}|${c.nightHours ? 1 : 0}`;

/** An unknown charging state ('-') cannot prove that the conditions changed. */
function sameConditions(sig: string, c: AutoConditions) {
  const now = autoSignature(c).split('|');
  const then = sig.split('|');
  return now.length === then.length && now.every((v, i) => v === then[i] || (i === 1 && v === '-'));
}

/**
 * Current mode: the manual choice (lamp tap) while the automatic conditions are the ones it was made
 * under; otherwise night if the page says so (`nightAuto`), power saving if automatic, else normal.
 * Until the conditions are `settled` (battery state still unknown on a page just opened) the manual
 * choice is kept as it is.
 */
export function resolveMode(c: AutoConditions & { nightAuto: boolean; override: LampOverride | null; settled?: boolean }): { mode: LampMode; override: LampOverride | null } {
  const override = c.override && (c.settled === false || sameConditions(c.override.sig, c)) ? c.override : null;
  if (override) return { mode: override.mode, override };
  return { mode: c.nightAuto ? 'night' : c.ecoAuto ? 'eco' : 'normal', override: null };
}
