// Mensajes de felicitación y récords que se destacan al terminar una sesión (js/celebrate-logic.js).
// Ejecutar: node --test tests/unit/celebrate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, MAIN_LIFTS, pickMessage, mainRecord } from '../../js/celebrate-logic.js';
import { sessionPRs, makeBodyweightFn } from '../../js/calc.js';
import { SEED_EXERCISES } from '../../js/seed.js';

const exMap = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const exOf = (id) => exMap.get(id);
const bwFn = makeBodyweightFn([], 75);
const set = (id, weight, reps) => ({ id, weight, reps, done: true, type: 'work', rir: 2 });
const strength = (id, date, exercises) => ({ id, kind: 'strength', status: 'done', date, startedAt: Date.parse(`${date}T10:00:00Z`), exercises });
const lift = (exerciseId, sets, setup = '') => ({ exerciseId, setup, sets });

/** Historial: ayer 80 kg en banca y 10 kg en laterales; hoy 90 kg en banca y 12 kg en laterales. */
function build(todayExercises, history) {
  const hist = strength('h1', '2026-09-01', history);
  const today = strength('t1', '2026-09-08', todayExercises);
  return { today, prs: sessionPRs(today, [hist, today], exMap, bwFn) };
}

test('mensajes: cortos, con exclamación, sin raya larga ni frases largas, y nunca el mismo dos veces seguidas', () => {
  assert.ok(MESSAGES.length >= 3);
  for (const m of MESSAGES) {
    assert.match(m, /^¡.+!$/);
    assert.ok(m.length <= 16, `${m}: ha de caber en una línea`);
    assert.ok(!m.includes('—'));
  }
  for (const last of MESSAGES) {
    for (const r of [0, 0.3, 0.6, 0.99]) assert.notEqual(pickMessage(() => r, last), last);
  }
  assert.ok(MESSAGES.includes(pickMessage(() => 0.5, null)));
  assert.equal(pickMessage(() => 0.999999, null), MESSAGES.at(-1), 'el límite superior no se sale de la lista');
});

test('la lista inicial es corta y exclusiva: banca, sentadilla, peso muerto, dominadas y su variante supina', () => {
  assert.deepEqual(MAIN_LIFTS, ['press_banca', 'sentadilla', 'peso_muerto', 'dominadas', 'dominadas_supinas']);
  for (const id of MAIN_LIFTS) assert.ok(exMap.has(id), `${id} existe en la biblioteca`);
  // Accesorios y, por ahora, press militar y remo con barra: nunca destacan
  for (const id of ['press_militar', 'remo_barra', 'elevaciones_laterales', 'face_pull', 'curl_barra', 'curl_mancuerna', 'crunch_polea', 'press_banca_mancuerna', 'peso_muerto_rumano']) {
    assert.ok(!MAIN_LIFTS.includes(id), `${id} no se destaca`);
  }
});

test('récord en press militar o remo con barra (fuera de la lista por ahora): no se destaca; el de banca sí', () => {
  let r = build([lift('press_militar', [set('s1', 60, 5)]), lift('remo_barra', [set('r1', 80, 8)])],
    [lift('press_militar', [set('p1', 50, 5)]), lift('remo_barra', [set('q1', 70, 8)])]);
  assert.ok(r.prs.size > 0, 'sí son récords para el sistema de récords');
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  r = build([lift('press_militar', [set('s1', 60, 5)]), lift('press_banca', [set('b1', 90, 5)])],
    [lift('press_militar', [set('p1', 50, 5)]), lift('press_banca', [set('b0', 80, 5)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf).exerciseId, 'press_banca');
});

test('variantes: las dominadas supinas cuentan con su propio historial; banca con mancuernas no entra y no se mezcla con la de barra', () => {
  let r = build([lift('dominadas_supinas', [set('s1', 0, 10)])], [lift('dominadas_supinas', [set('p1', 0, 8)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf).exerciseId, 'dominadas_supinas');
  // Primera vez con la variante (aunque se hayan hecho dominadas pronas): no es récord, no son comparables
  r = build([lift('dominadas_supinas', [set('s1', 0, 12)])], [lift('dominadas', [set('p1', 0, 8)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  r = build([lift('press_banca_mancuerna', [set('s1', 40, 8)])], [lift('press_banca_mancuerna', [set('p1', 30, 8)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
});

test('récord en un ejercicio principal: mensaje con el nombre del ejercicio', () => {
  const { today, prs } = build([lift('press_banca', [set('s1', 90, 5)])], [lift('press_banca', [set('p1', 80, 5)])]);
  const rec = mainRecord(today, prs, exOf);
  assert.equal(rec.exerciseId, 'press_banca');
  assert.equal(rec.text, '¡Nuevo récord en press banca!');
  assert.ok(['e1rm', 'weight'].includes(rec.kind));
});

test('récord en un accesorio: NO se destaca, aunque sea un récord real', () => {
  const { today, prs } = build([lift('elevaciones_laterales', [set('s1', 12, 12)])], [lift('elevaciones_laterales', [set('p1', 10, 12)])]);
  assert.ok(prs.size > 0, 'sí es un récord para el sistema de récords (sigue en el resumen y en Progreso)');
  assert.equal(mainRecord(today, prs, exOf), null);
});

test('con récords en un accesorio y en un principal gana el principal; con varios principales, el de más prioridad', () => {
  const { today, prs } = build(
    [lift('elevaciones_laterales', [set('a1', 12, 12)]), lift('sentadilla', [set('s1', 120, 5)]), lift('press_banca', [set('b1', 90, 5)])],
    [lift('elevaciones_laterales', [set('a0', 10, 12)]), lift('sentadilla', [set('s0', 100, 5)]), lift('press_banca', [set('b0', 80, 5)])]);
  assert.equal(mainRecord(today, prs, exOf).exerciseId, 'press_banca', 'press_banca va antes que sentadilla en MAIN_LIFTS');
  assert.equal(mainRecord(today, prs, exOf, ['sentadilla', 'press_banca']).exerciseId, 'sentadilla', 'la selección es configurable');
});

test('sin récord real no hay mensaje especial: primera sesión con el ejercicio, misma marca o menos, configuración nueva', () => {
  // Primera vez con el ejercicio: nada con lo que comparar
  let r = build([lift('press_banca', [set('s1', 90, 5)])], [lift('sentadilla', [set('p1', 100, 5)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  // Igualar o bajar no es récord
  r = build([lift('press_banca', [set('s1', 80, 5)])], [lift('press_banca', [set('p1', 80, 5)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  // Otra configuración de material: la primera sesión con ella es solo una referencia
  r = build([lift('press_banca', [set('s1', 100, 5)], 'smith')], [lift('press_banca', [set('p1', 80, 5)], 'barra')]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  // Sin datos
  assert.equal(mainRecord({ exercises: [] }, new Map(), exOf), null);
  assert.equal(mainRecord({ exercises: [] }, null, exOf), null);
});

test('dominadas (peso corporal): más repeticiones sin lastre cuentan como récord principal', () => {
  const { today, prs } = build([lift('dominadas', [set('s1', 0, 10)])], [lift('dominadas', [set('p1', 0, 8)])]);
  const rec = mainRecord(today, prs, exOf);
  assert.equal(rec?.exerciseId, 'dominadas');
  assert.equal(rec.text, '¡Nuevo récord en dominadas!');
});
