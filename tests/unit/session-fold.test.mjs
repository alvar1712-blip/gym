// Sesiones largas (ronda 8, H): bloques, estado de cada ítem, plegado automático y salto al siguiente pendiente.
// Funciones puras de js/session-logic.js (sin DOM ni store).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listBlocks, itemState, itemStates, foldedKeys, nextPendingIndex, jumpTarget, foldedSetCount,
} from '../../js/session-logic.js';

const set = (done, type = 'effective') => ({ id: Math.random().toString(36).slice(2), done, type });
/** Ítem con `done` de `total` series hechas. */
const item = (id, done, total, extra = {}) => ({
  id, exerciseId: extra.exerciseId || `ex_${id}`, groupId: null, groupType: null, section: '',
  sets: Array.from({ length: total }, (_, i) => set(i < done)), ...extra,
});
const session = (exercises, extra = {}) => ({ id: 's1', status: 'active', cursor: 0, exercises, ...extra });

test('itemState: fuerza pendiente, en curso y hecha; sin series → pendiente; cardio por actividades enlazadas', () => {
  assert.equal(itemState(item('a', 0, 3)), 'pending');
  assert.equal(itemState(item('a', 2, 4)), 'progress');
  assert.equal(itemState(item('a', 3, 3)), 'done');
  assert.equal(itemState(item('a', 0, 0)), 'pending', 'sin series no está hecho');
  assert.equal(itemState({ id: 'c', sets: [] }, { cardio: true, linked: 0 }), 'pending');
  assert.equal(itemState({ id: 'c', sets: [] }, { cardio: true, linked: 1 }), 'done');
});

test('itemStates: alineados con la sesión; el cardio cuenta sus actividades enlazadas', () => {
  const s = session([item('a', 3, 3), item('run', 0, 0, { exerciseId: 'correr' }), item('b', 1, 3), item('bike', 0, 0, { exerciseId: 'bici' })]);
  const logTypeOf = (eid) => (eid === 'correr' || eid === 'bici' ? 'cardio' : 'weight_reps');
  assert.deepEqual(itemStates(s, { logTypeOf, linkedBySe: new Map([['run', 1]]) }), ['done', 'done', 'progress', 'pending']);
  assert.deepEqual(itemStates(s), ['done', 'pending', 'progress', 'pending'], 'sin logTypeOf: todo es fuerza');
});

test('listBlocks: sueltos, superserie de 2, circuito de 3, groupId aislado, secciones y letras A, B', () => {
  const exs = [
    item('a', 0, 3, { section: 'Bloque 1' }),
    item('b', 0, 3, { section: 'Bloque 1', groupId: 'g1', groupType: 'superset' }),
    item('c', 0, 3, { section: 'Bloque 2', groupId: 'g1', groupType: 'superset' }),
    item('d', 0, 3, { section: 'Bloque 2', groupId: 'solo' }),
    item('e', 0, 3, { groupId: 'g2', groupType: 'circuit' }),
    item('f', 0, 3, { groupId: 'g2', groupType: 'circuit' }),
    item('g', 0, 3, { groupId: 'g2', groupType: 'circuit' }),
    item('h', 0, 3),
  ];
  assert.deepEqual(listBlocks(exs), [
    { key: 'se:a', start: 0, end: 1, groupId: null, groupType: null, letter: null },
    { key: 'g:g1', start: 1, end: 3, groupId: 'g1', groupType: 'superset', letter: 'A' },
    { key: 'se:d', start: 3, end: 4, groupId: null, groupType: null, letter: null },
    { key: 'g:g2', start: 4, end: 7, groupId: 'g2', groupType: 'circuit', letter: 'B' },
    { key: 'se:h', start: 7, end: 8, groupId: null, groupType: null, letter: null },
  ]);
  assert.deepEqual(listBlocks([]), []);
  // el mismo groupId en dos tramos separados: dos bloques con claves distintas
  const split = listBlocks([item('x', 0, 1, { groupId: 'g' }), item('y', 0, 1, { groupId: 'g' }), item('z', 0, 1), item('w', 0, 1, { groupId: 'g' }), item('v', 0, 1, { groupId: 'g' })]);
  assert.deepEqual(split.map((b) => b.key), ['g:g', 'se:z', 'g:g:3']);
});

test('foldedKeys: sesión terminada → nada; hecho fuera del cursor → plegado; con el cursor → abierto', () => {
  const exs = [item('a', 3, 3), item('b', 3, 3), item('c', 1, 3), item('d', 0, 3)];
  const st = (s) => itemStates(s);
  let s = session(exs, { cursor: 1 });
  assert.deepEqual([...foldedKeys(s, st(s))], ['se:a'], 'b tiene el cursor');
  s = session(exs, { cursor: 2 });
  assert.deepEqual([...foldedKeys(s, st(s))], ['se:a', 'se:b']);
  s = session(exs, { cursor: 2, status: 'done' });
  assert.deepEqual([...foldedKeys(s, st(s))], [], 'terminada o editada después: nada plegado');
});

test('foldedKeys: editor abierto, override abrir/plegar y override en un ítem no hecho', () => {
  const s = session([item('a', 3, 3), item('b', 3, 3), item('c', 0, 3)], { cursor: 2 });
  const states = itemStates(s);
  assert.deepEqual([...foldedKeys(s, states, { editing: new Map([['a', 'set1']]) })], ['se:b'], 'con el editor abierto no se pliega');
  assert.deepEqual([...foldedKeys(s, states, { override: new Map([['se:a', 'open']]) })], ['se:b']);
  // plegado a mano aunque tenga el cursor
  const s2 = session(s.exercises, { cursor: 0 });
  assert.deepEqual([...foldedKeys(s2, states, { override: new Map([['se:a', 'folded']]) })], ['se:a', 'se:b']);
  // un ítem sin terminar no se pliega aunque se haya plegado a mano antes
  assert.deepEqual([...foldedKeys(s, states, { override: new Map([['se:c', 'folded']]) })], ['se:a', 'se:b']);
});

test('foldedKeys: un grupo se pliega entero solo cuando todos están hechos y el cursor está fuera', () => {
  const g = { groupId: 'g1', groupType: 'superset' };
  let s = session([item('a1', 3, 3, g), item('a2', 1, 3, g), item('b', 0, 3)], { cursor: 2 });
  assert.deepEqual([...foldedKeys(s, itemStates(s))], [], '1 de 2 hechos: abierto (nunca un ejercicio suelto del grupo)');
  s = session([item('a1', 3, 3, g), item('a2', 3, 3, g), item('b', 0, 3)], { cursor: 2 });
  assert.deepEqual([...foldedKeys(s, itemStates(s))], ['g:g1']);
  s = session(s.exercises, { cursor: 1 });
  assert.deepEqual([...foldedKeys(s, itemStates(s))], [], 'cursor dentro del grupo: abierto');
  assert.deepEqual([...foldedKeys(s, itemStates(s), { editing: new Set(['a1']) })], []);
});

test('nextPendingIndex: el siguiente, con vuelta; solo `from` pendiente → `from`; todo hecho → −1', () => {
  const P = 'pending'; const D = 'done'; const G = 'progress';
  assert.equal(nextPendingIndex([D, P, D, P], 1), 3);
  assert.equal(nextPendingIndex([P, D, D, D], 2), 0, 'vuelta al principio');
  assert.equal(nextPendingIndex([D, G, D], 1), 1, 'solo queda el de partida');
  assert.equal(nextPendingIndex([D, D, D], 0), -1);
  assert.equal(nextPendingIndex([], 0), -1);
  assert.equal(nextPendingIndex([P, D], -1), 0, 'sin cursor: el primero');
});

test('jumpTarget: el cursor si está pendiente y no se ve; si no, el siguiente pendiente', () => {
  const P = 'pending'; const D = 'done';
  assert.equal(jumpTarget([D, P, P, D], 1, false), 1);
  assert.equal(jumpTarget([D, P, P, D], 1, true), 2);
  assert.equal(jumpTarget([D, P, D, D], 0, false), 1, 'cursor hecho: el siguiente');
  assert.equal(jumpTarget([P, D, D], 2, true), 0, 'con vuelta');
  assert.equal(jumpTarget([D, D], 1, false), -1);
  assert.equal(jumpTarget([P, D], 9, false), 0, 'cursor fuera de rango: el primero');
});

test('foldedSetCount: series hechas sin calentamientos; si solo hay calentamientos, todas', () => {
  assert.equal(foldedSetCount({ sets: [set(true, 'warmup'), set(true), set(true), set(false)] }), 2);
  assert.equal(foldedSetCount({ sets: [set(true, 'warmup'), set(true, 'warmup')] }), 2);
  assert.equal(foldedSetCount({ sets: [] }), 0);
});
