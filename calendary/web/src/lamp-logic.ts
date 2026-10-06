// Pure rules of the lamp modes, shared by every page (no imports: also runs under `node --test`).

export type LampMode = 'normal' | 'eco' | 'night';
export interface LampOverride { mode: LampMode; sig: string }

/** Automatic conditions every page can compute the same way (no kiosk idle time in here). */
export interface AutoConditions { ecoAuto: boolean; charging: boolean | null; nightHours: boolean }

export const nextMode = (m: LampMode): LampMode => (m === 'normal' ? 'eco' : m === 'eco' ? 'night' : 'normal');

/** Changes whenever the automatic conditions change: a manual choice lasts until then. */
export const autoSignature = (c: AutoConditions) => `${c.ecoAuto ? 1 : 0}|${c.charging === null ? '-' : c.charging ? 1 : 0}|${c.nightHours ? 1 : 0}`;

/**
 * Current mode: the manual choice (lamp tap) while the automatic conditions are the ones it was made
 * under; otherwise night if the page says so (`nightAuto`), power saving if automatic, else normal.
 */
export function resolveMode(c: AutoConditions & { nightAuto: boolean; override: LampOverride | null }): { mode: LampMode; override: LampOverride | null } {
  const override = c.override && c.override.sig === autoSignature(c) ? c.override : null;
  if (override) return { mode: override.mode, override };
  return { mode: c.nightAuto ? 'night' : c.ecoAuto ? 'eco' : 'normal', override: null };
}
