// Pure rules of the lamp modes (Normal → Power saving → Night). Run: node --test test/
import assert from 'node:assert/strict';
import test from 'node:test';
import { autoSignature, nextMode, resolveMode } from '../src/lamp-logic.ts';

const base = { ecoAuto: false, charging: false, nightHours: false };

test('senza tocchi la modalità segue le condizioni automatiche', () => {
  assert.equal(resolveMode({ ...base, nightAuto: false, override: null }).mode, 'normal');
  assert.equal(resolveMode({ ...base, ecoAuto: true, nightAuto: false, override: null }).mode, 'eco');
  assert.equal(resolveMode({ ...base, ecoAuto: true, nightAuto: true, override: null }).mode, 'night');
});

test('il ciclo dei tocchi', () => {
  assert.equal(nextMode('normal'), 'eco');
  assert.equal(nextMode('eco'), 'night');
  assert.equal(nextMode('night'), 'normal');
});

test('un tocco vale finché le condizioni automatiche non cambiano', () => {
  const sig = autoSignature(base);
  const override = { mode: 'eco' as const, sig };
  assert.deepEqual(resolveMode({ ...base, nightAuto: false, override }), { mode: 'eco', override });
  // the charger is plugged in: the manual choice is forgotten
  const r = resolveMode({ ...base, charging: true, nightAuto: false, override });
  assert.equal(r.mode, 'normal');
  assert.equal(r.override, null);
});

test('la firma non dipende dall\'inattività del kiosk: tutte le pagine la calcolano uguale', () => {
  assert.equal(autoSignature({ ecoAuto: true, charging: true, nightHours: false }), autoSignature({ ecoAuto: true, charging: true, nightHours: false }));
  assert.notEqual(autoSignature({ ...base, nightHours: true }), autoSignature(base));
});

test('finché la batteria non è nota (pagina appena aperta) la scelta manuale resta', () => {
  const override = { mode: 'normal' as const, sig: autoSignature({ ...base, charging: true, nightHours: true }) };
  const loading = { ecoAuto: false, charging: null, nightHours: true, nightAuto: false, override };
  assert.deepEqual(resolveMode({ ...loading, settled: false }), { mode: 'normal', override });
  assert.equal(resolveMode({ ...loading, nightHours: false, settled: true }).override, null);
});

test('una batteria sconosciuta non basta a cancellare la scelta manuale', () => {
  const override = { mode: 'normal' as const, sig: autoSignature({ ...base, charging: true, nightHours: true }) };
  const r = resolveMode({ ecoAuto: false, charging: null, nightHours: true, nightAuto: false, override, settled: true });
  assert.equal(r.mode, 'normal');
  assert.equal(resolveMode({ ecoAuto: false, charging: null, nightHours: false, nightAuto: false, override, settled: true }).override, null);
});

test('sul tablet, dopo l\'inattività, la notte automatica torna anche se avevi toccato la lampada', () => {
  const sig = autoSignature({ ...base, charging: true, nightHours: true });
  for (const mode of ['normal', 'eco'] as const) {
    const r = resolveMode({ ecoAuto: false, charging: true, nightHours: true, nightAuto: true, override: { mode, sig } });
    assert.equal(r.mode, 'night');
  }
  // while you are using it (no idle night yet) the tap still counts
  assert.equal(resolveMode({ ecoAuto: false, charging: true, nightHours: true, nightAuto: false, override: { mode: 'eco', sig } }).mode, 'eco');
});

test('una scelta fatta prima che la batteria rispondesse resta quando la batteria diventa nota', () => {
  const override = { mode: 'eco' as const, sig: autoSignature({ ...base, charging: null }) };
  assert.equal(resolveMode({ ...base, charging: true, nightAuto: false, override }).mode, 'eco');
});
