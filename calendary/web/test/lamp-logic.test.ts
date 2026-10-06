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
