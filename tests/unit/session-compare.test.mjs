// Resumen de sesión frente a la anterior equivalente (js/session-compare.js, docs/PULIDO.md §9): solo datos reales
// (la serie más pesada de cada ejercicio y sus reps, series, volumen, duración); sin sesión comparable, nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { previousEquivalent, compareSessions, MAX_ROWS } from '../../js/session-compare.js';
import { SEED_EXERCISES } from '../../js/seed.js';

const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
let n = 0;
const set = (weight, reps, extra = {}) => ({ id: `x${++n}`, type: 'effective', done: true, weight, reps, rir: 2, ...extra });
const ses = (id, date, tpl, exercises, extra = {}) => ({ id, kind: 'strength', status: 'done', date, templateId: tpl, startedAt: Date.parse(`${date}T18:00:00Z`), durationMin: 60, exercises: exercises.map(([exerciseId, sets], i) => ({ id: `${id}_${i}`, exerciseId, sets })), ...extra });

test('la anterior equivalente: misma rutina, terminada y de antes (no la propia ni otra rutina ni una en curso)', () => {
  const cur = ses('c', '2026-10-07', 'tpl_d1', []);
  const all = [
    cur,
    ses('p1', '2026-09-28', 'tpl_d1', []),
    ses('p2', '2026-10-05', 'tpl_d1', []),
    ses('o', '2026-10-06', 'tpl_d2', []),
    ses('a', '2026-10-06', 'tpl_d1', [], { status: 'active' }),
    ses('f', '2026-10-09', 'tpl_d1', []),
  ];
  assert.equal(previousEquivalent(cur, all).id, 'p2');
  assert.equal(previousEquivalent({ ...cur, templateId: null }, all), null, 'sesión libre: no hay equivalente');
  assert.equal(previousEquivalent(cur, [cur]), null);
  // El mismo día: la que empezó antes
  const early = ses('e', '2026-10-07', 'tpl_d1', [], { startedAt: cur.startedAt - 3600e3 });
  assert.equal(previousEquivalent(cur, [cur, early]).id, 'e');
  assert.equal(previousEquivalent(early, [cur, early]), null);
});

test('por ejercicio: más peso → «+2,5 kg»; mismo peso y más reps → «+2 reps»; igual; menos → abajo', () => {
  const prev = ses('p', '2026-10-05', 'tpl_d1', [
    ['press_banca', [set(80, 6), set(80, 5)]],
    ['dominadas', [set(10, 6), set(10, 6)]],
    ['remo_barra', [set(60, 8)]],
    ['press_militar', [set(40, 8)]],
  ]);
  const cur = ses('c', '2026-10-07', 'tpl_d1', [
    ['press_banca', [set(80, 8), set(80, 7), set(40, 10, { type: 'warmup' })]],
    ['dominadas', [set(12.5, 6)]],
    ['remo_barra', [set(60, 8)]],
    ['press_militar', [set(37.5, 8)]],
    ['curl_martillo', [set(14, 10)]], // nuevo: no se compara
  ]);
  const r = compareSessions(cur, prev, EX);
  const by = Object.fromEntries(r.rows.map((x) => [x.exerciseId, [x.dir, x.text]]));
  assert.deepEqual(by, {
    dominadas: ['up', '+2,5 kg'],
    press_banca: ['up', '+2 reps'],
    press_militar: ['down', '−2,5 kg'],
    remo_barra: ['same', 'Igual'],
  });
  assert.deepEqual(r.rows.map((x) => x.dir), ['up', 'up', 'down', 'same'], 'primero lo que mejora');
  assert.equal(r.prevDate, '2026-10-05');
  assert.deepEqual(r.sets, { cur: 6, prev: 6 }, 'series de trabajo (sin calentamientos)');
  assert.ok(r.volume.cur > 0 && r.volume.prev > 0);
  assert.deepEqual(r.duration, { cur: 60, prev: 60 });
});

test('no comparable → nada: sin ejercicios en común, sin series de trabajo o sin sesión anterior', () => {
  const a = ses('a', '2026-10-05', 'tpl_d1', [['press_banca', [set(80, 6)]]]);
  assert.equal(compareSessions(ses('b', '2026-10-07', 'tpl_d1', [['sentadilla', [set(100, 5)]]]), a, EX), null);
  assert.equal(compareSessions(ses('b', '2026-10-07', 'tpl_d1', [['press_banca', [set(80, 6, { done: false })]]]), a, EX), null);
  assert.equal(compareSessions(ses('b', '2026-10-07', 'tpl_d1', [['press_banca', [set(80, 6)]]]), null, EX), null);
});

test('como mucho MAX_ROWS filas; el resto se cuenta; nunca NaN ni signos dobles', () => {
  const ids = [...EX.values()].filter((e) => e.logType === 'weight_reps').slice(0, MAX_ROWS + 3).map((e) => e.id);
  const prev = ses('p', '2026-10-05', 'tpl_d1', ids.map((id) => [id, [set(20, 10)]]));
  const cur = ses('c', '2026-10-07', 'tpl_d1', ids.map((id, i) => [id, [set(20 + i * 1.25, 10)]]));
  const r = compareSessions(cur, prev, EX);
  assert.equal(r.rows.length, MAX_ROWS);
  assert.equal(r.more, 3);
  for (const x of r.rows) assert.match(x.text, /^(Igual|[+−]\d+(,\d+)? (kg|reps?))$/, x.text);
  assert.equal(r.rows[0].text, '+8,75 kg', 'el que más cambia primero');
});
