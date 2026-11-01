// LAB-001 (fase 5): «¿Seguro?» si el peso es muy superior al habitual del ejercicio y la configuración (un 17,5 tecleado como 175).
// Pregunta, no bloquea; sin historial suficiente o con otro material no avisa. Datos sintéticos: el umbral (4× la mediana de las
// últimas 12 series, mínimo 6) NO está validado con historiales reales (docs/ENTRENO_FASE5_MEJORAS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTypo, TYPO } from '../../js/sanity.js';
import { recentWorkWeights, bestsForExercise, detectPRs } from '../../js/calc.js';

const set = (weight, extra = {}) => ({ id: `s${Math.random()}`, type: 'normal', weight, reps: 8, rir: 2, done: true, ...extra });
const sess = (id, date, sets, extra = {}) => ({ id, kind: 'strength', date, status: 'done', exercises: [{ id: `se_${id}`, exerciseId: 'curl', setup: '', sets, ...extra }] });
const six = (w) => [set(w), set(w), set(w)];
/** 4 sesiones de 3 series a `w` kg: 12 series. */
const history = (w, setup = '') => [1, 2, 3, 4].map((i) => sess(`h${i}`, `2026-09-0${i}`, six(w), { setup }));

test('recentWorkWeights: series de trabajo hechas del ejercicio y la configuración, de las sesiones más recientes, hasta el límite', () => {
  const ss = history(20);
  assert.equal(recentWorkWeights(ss, 'curl', '').length, 12);
  assert.equal(recentWorkWeights(ss, 'curl', '', { limit: 5 }).length, 5);
  assert.deepEqual(recentWorkWeights(ss, 'press', ''), []);
});

test('recentWorkWeights: no cuenta calentamientos, pendientes, peso 0 ni otra configuración (setupKey: mayúsculas y tildes no importan)', () => {
  const ss = [sess('a', '2026-09-01', [set(10, { type: 'warmup' }), set(10, { done: false }), set(0), set(30), set(null)], { setup: 'Polea Alta' }), sess('b', '2026-09-02', [set(99)], { setup: 'hammer' })];
  assert.deepEqual(recentWorkWeights(ss, 'curl', 'polea alta'), [30]);
  assert.deepEqual(recentWorkWeights(ss, 'curl', 'hammer'), [99]);
  assert.deepEqual(recentWorkWeights(ss, 'curl', 'otra'), []);
});

test('error decimal evidente: 175 con 17,5 de costumbre → «¿Seguro?» (rare, campo weight) con el peso habitual en el mensaje', () => {
  const w = recentWorkWeights(history(17.5), 'curl', '');
  const r = checkTypo(175, w);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].field, r[0].level], ['weight', 'rare']);
  assert.match(r[0].message, /175 kg/);
  assert.match(r[0].message, /17,5 kg/);
  assert.equal(checkTypo(75, recentWorkWeights(history(7.5), 'curl', '')).length, 1); // 7,5 → 75
});

test('incremento legítimo, el mismo peso o menos: no avisa (el umbral es 4× la mediana, estrictamente mayor)', () => {
  const w = recentWorkWeights(history(20), 'curl', '');
  for (const kg of [20, 22.5, 25, 40, 60, 80, 5]) assert.deepEqual(checkTypo(kg, w), [], `${kg} kg`);
  assert.equal(checkTypo(80.5, w).length, 1);
});

test('historial insuficiente (menos de 6 series), sin historial o primera sesión: no avisa', () => {
  assert.deepEqual(checkTypo(500, []), []);
  assert.deepEqual(checkTypo(500, [20, 20, 20, 20, 20]), []);
  assert.equal(checkTypo(500, [20, 20, 20, 20, 20, 20]).length, 1);
  assert.equal(TYPO.minSets, 6);
});

test('material diferente: un peso muy distinto con otra configuración no dispara (no tiene historial)', () => {
  const ss = history(17.5, 'mancuernas');
  assert.deepEqual(checkTypo(175, recentWorkWeights(ss, 'curl', 'polea')), []);
  assert.deepEqual(checkTypo(175, recentWorkWeights(ss, 'curl', '')), []);
});

test('ya confirmado en esta sesión: si hay series hechas igual de altas del mismo ejercicio no vuelve a preguntar', () => {
  const w = recentWorkWeights(history(17.5), 'curl', '');
  assert.deepEqual(checkTypo(175, w, { sameSession: [175] }), []);
  assert.deepEqual(checkTypo(200, w, { sameSession: [175] }), []);
  assert.equal(checkTypo(175, w, { sameSession: [20] }).length, 1);
});

test('mediana, no media: unas pocas series anómalas ya guardadas no desactivan el aviso', () => {
  const ss = history(17.5);
  ss[0].exercises[0].sets.push(set(175), set(175)); // dos errores ya registrados entre 14 series
  const w = recentWorkWeights(ss, 'curl', '');
  assert.equal(checkTypo(175, w).length, 1);
});

test('principiante con progresión rápida pero legítima (×2 en pocas semanas): no avisa', () => {
  const w = recentWorkWeights([sess('a', '2026-09-01', [set(10), set(10), set(10)]), sess('b', '2026-09-08', [set(12.5), set(12.5), set(12.5)])], 'curl', '');
  assert.deepEqual(checkTypo(25, w), []);
});

test('las marcas no cambian: avisar no toca el cálculo de récords (un 175 confirmado sigue siendo récord de peso)', () => {
  const ex = { id: 'curl', logType: 'weight_reps' };
  const bests = bestsForExercise(history(17.5), 'curl', ex, { bwFn: () => 75, setup: '' });
  const prs = detectPRs(set(175, { reps: 5 }), ex, bests, 75);
  assert.ok(prs.length > 0);
});
