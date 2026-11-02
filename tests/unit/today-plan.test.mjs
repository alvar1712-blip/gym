import test from 'node:test';
import assert from 'node:assert/strict';
import { progressionHint, todayPlan } from '../../js/progression.js';

const ex = { id: 'e1', name: 'Press banca', logType: 'weight_reps', category: 'compound', region: 'upper', pattern: 'push' };
const set = (weight, reps, rir = 1, extra = {}) => ({ weight, reps, rir, type: 'effective', done: true, ...extra });
const target = { sets: 3, repMin: 6, repMax: 8 };
const plan = (lastSets, t = target, e = ex) => {
  const hint = progressionHint({ exercise: e, target: t, lastSets, settings: null });
  return { hint, p: todayPlan({ exercise: e, hint, target: t }) };
};

test('todas las series al tope con RIR suficiente: sube el incremento y vuelve a la base del rango', () => {
  const { hint, p } = plan([set(80, 8), set(80, 8), set(80, 8)]);
  assert.equal(hint.kind, 'up');
  assert.equal(p.kind, 'up');
  assert.equal(p.weight, 82.5);
  assert.equal(p.reps, 6);
});

test('sin llegar al tope: mismo peso y una repetición más que la serie más corta', () => {
  const { hint, p } = plan([set(80, 7), set(80, 6), set(80, 6)]);
  assert.equal(hint.kind, 'hold');
  assert.equal(p.weight, 80);
  assert.equal(p.reps, 7);
});

test('nunca pasa del tope ni propone subir con series sin hacer', () => {
  const { hint, p } = plan([set(80, 8), set(80, 8)]); // faltan series del objetivo (3)
  assert.equal(hint.kind, 'hold');
  assert.equal(p.weight, 80);
  assert.equal(p.reps, 8);
});

test('sin propuesta: sin última vez, peso corporal, RIR sin registrar o sin rango', () => {
  assert.equal(plan([]).p, null);
  assert.equal(plan([set(80, 8, null), set(80, 8, null), set(80, 8, null)]).p, null); // «mantén y reevalúa»
  const bw = { ...ex, logType: 'bodyweight' };
  assert.equal(plan([set(10, 8), set(10, 8), set(10, 8)], target, bw).p, null);
  assert.equal(plan([set(80, 8)], null).p, null);
});

test('la propuesta coincide con «Siguiente paso»: si sube, el peso es el de la pista', () => {
  const { hint, p } = plan([set(100, 8), set(100, 8), set(100, 8)]);
  assert.match(hint.text, /102,5/);
  assert.equal(p.weight, 102.5);
});
