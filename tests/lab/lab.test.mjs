// Pruebas del PROPIO laboratorio (no de Entreno): los perfiles y el generador de historiales deben ser deterministas y
// producir datos que la app acepta. Si esto falla, los hallazgos del laboratorio no son fiables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, generateProfiles } from './profiles.mjs';
import { generateHistory, buildBackup, TODAY } from './history.mjs';
import { validateBackup } from '../../js/store.js';
import { isDateStr } from '../../js/util.js';

test('hay 20 perfiles base con id único y campos mínimos', () => {
  assert.equal(PROFILES.length, 20);
  assert.equal(new Set(PROFILES.map((p) => p.id)).size, 20);
  for (const p of PROFILES) for (const k of ['label', 'age', 'experience', 'weeks', 'adherence', 'sports']) assert.ok(p[k] != null, `${p.id}.${k}`);
});

test('generateProfiles es reproducible por semilla y escala a cientos', () => {
  const a = generateProfiles(42, 300);
  assert.equal(a.length, 300);
  assert.deepEqual(a, generateProfiles(42, 300));
  assert.notDeepEqual(a.slice(0, 5), generateProfiles(43, 300).slice(0, 5));
  assert.equal(new Set(a.map((p) => p.id)).size, 300);
});

test('el historial es determinista y la app lo acepta como copia válida', () => {
  for (const p of PROFILES) {
    const h1 = generateHistory(p, { seed: 1 });
    assert.deepEqual(h1, generateHistory(p, { seed: 1 }), p.id);
    assert.ok(h1.sessions.length > 0, `${p.id} sin sesiones`);
    const v = validateBackup(buildBackup(h1));
    assert.ok(v.ok, `${p.id}: ${v.error}`);
    for (const s of h1.sessions) {
      assert.ok(isDateStr(s.date) && s.date <= TODAY, `${p.id} fecha ${s.date}`);
      assert.ok(s.endedAt >= s.startedAt, `${p.id} fin antes que inicio`);
    }
  }
});

test('la semilla cambia el historial', () => {
  assert.notDeepEqual(generateHistory(PROFILES[0], { seed: 1 }).sessions, generateHistory(PROFILES[0], { seed: 2 }).sessions);
});
