// Ronda 8, A5: ficha de ejercicio «de un vistazo» (stats.exerciseGlance / exercisePrimaryMetric), redondeo humano
// de los cambios (EXERCISE_METRIC_SUMMARY) y ejes con un rango mínimo (charts.widenDomain / relativeSpan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseGlance, exercisePrimaryMetric, exerciseSeries, exerciseRecord, EXERCISE_METRIC_SUMMARY } from '../../js/stats.js';
import { widenDomain, relativeSpan, niceTicks } from '../../js/charts.js';
import { levelSummary } from '../../js/chart-summary.js';
import { e1rm } from '../../js/calc.js';
import { defaultSettings } from '../../js/seed.js';
import { tsFromDate } from '../../js/util.js';

const TODAY = '2026-10-07';
const EX = {
  bench: { id: 'bench', name: 'Press banca', logType: 'weight_reps', primary: ['chest'], secondary: [] },
  raises: { id: 'raises', name: 'Elevaciones de piernas', logType: 'bodyweight', pattern: 'core', primary: ['core'], secondary: [] },
  plank: { id: 'plank', name: 'Plancha', logType: 'time', primary: ['core'], secondary: [] },
  sprint: { id: 'sprint', name: 'Sprint', logType: 'distance_time', primary: ['hamstrings'], secondary: [] },
  run: { id: 'run', name: 'Correr', logType: 'cardio', sport: 'run', primary: [], secondary: [] },
};
let seq = 0;
const set = (weight, reps, extra = {}) => ({ id: `st${++seq}`, type: 'effective', weight, reps, repsR: null, rir: null, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: 1, ...extra });
function ses(id, date, items, extra = {}) {
  return {
    id, kind: 'strength', date, planDate: date, status: 'done', parentId: null, templateId: null, templateName: 'Sesión libre',
    startedAt: tsFromDate(date, 18), createdAt: tsFromDate(date, 18), durationMin: 60, rpe: 7, notes: '',
    exercises: items.map(([exerciseId, sets], i) => ({ id: `${id}_se${i}`, exerciseId, exName: exerciseId, templateItemId: null, sets })),
    ...extra,
  };
}
const mk = (sessions) => ({ sessions, exercises: new Map(Object.values(EX).map((e) => [e.id, e])), templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], today: TODAY });

test('exerciseGlance: última vez, mejor serie, 1RM estimado (último y récord) y tendencia, de los cálculos de stats', () => {
  const data = mk([
    ses('a', '2026-07-20', [['bench', [set(80, 6, { rir: 2 }), set(80, 5, { rir: 1 })]]]),
    ses('b', '2026-08-20', [['bench', [set(85, 5, { rir: 1 })]]]),
    ses('c', '2026-09-20', [['bench', [set(82.5, 5, { rir: 1 }), set(80, 6, { rir: 1 })]]]),
    // en curso: no cuenta como «última vez»
    ses('d', '2026-10-06', [['bench', [set(90, 5, { rir: 0 })]]], { status: 'active' }),
  ]);
  const g = exerciseGlance(data, 'bench', { from: '2026-07-06' });
  assert.equal(g.last.sessionId, 'c');
  assert.equal(g.last.date, '2026-09-20');
  assert.deepEqual(g.last.setLabels, ['82,5×5 @1', '80×6 @1']);
  // Mejor serie = la del récord de 1RM estimado (la misma que exerciseRecord)
  const rec = exerciseRecord(data, 'bench');
  assert.equal(g.best.kind, 'e1rm');
  assert.equal(g.best.label, rec.bestE1rm.setLabel);
  assert.equal(g.best.sessionId, 'b');
  // 1RM estimado: el de la última sesión y el récord (fórmula de calc, sin duplicar)
  const last = Math.max(e1rm(82.5, 5, 1), e1rm(80, 6, 1));
  assert.ok(Math.abs(g.e1rm.value - last) < 1e-9);
  assert.equal(g.e1rm.date, '2026-09-20');
  assert.ok(Math.abs(g.e1rm.best.value - e1rm(85, 5, 1)) < 1e-9);
  // Tendencia = la frase de la gráfica (levelSummary con el mismo redondeo)
  assert.equal(g.metric, 'e1rm');
  const ser = exerciseSeries(data, 'bench');
  assert.deepEqual(g.trend, levelSummary(ser.e1rm, { from: '2026-07-06', today: TODAY, ...EXERCISE_METRIC_SUMMARY.e1rm }));
  assert.match(g.trend.text, /^[+−]\d+(,\d)? kg desde julio$/);
});

test('exerciseGlance: sin datos, con una sola sesión (sin tendencia) y tipos sin 1RM', () => {
  assert.equal(exerciseGlance(mk([]), 'bench'), null);
  assert.equal(exerciseGlance(mk([]), 'run'), null);
  const one = exerciseGlance(mk([ses('a', '2026-09-20', [['bench', [set(60, 8)]]])]), 'bench', { from: '2026-07-06' });
  assert.equal(one.trend, null, 'una sesión no hace tendencia');
  assert.ok(one.e1rm);
  // Core de peso corporal sin lastre: sin 1RM; se sigue por repeticiones
  const core = exerciseGlance(mk([
    ses('a', '2026-09-10', [['raises', [set(null, 12)]]]),
    ses('b', '2026-09-20', [['raises', [set(null, 15)]]]),
  ]), 'raises', { from: '2026-07-06' });
  assert.equal(core.e1rm, null);
  assert.equal(core.metric, 'maxReps');
  assert.equal(core.best.kind, 'reps');
  assert.equal(core.trend.text, '+3 reps desde el 10 sep');
  // Tiempo
  const plank = exerciseGlance(mk([
    ses('a', '2026-09-10', [['plank', [set(null, null, { timeSec: 60 })]]]),
    ses('b', '2026-09-20', [['plank', [set(null, null, { timeSec: 75 })]]]),
  ]), 'plank', { from: '2026-07-06' });
  assert.equal(plank.metric, 'maxTime');
  assert.equal(plank.best.kind, 'time');
  assert.equal(plank.trend.text, '+15 s desde el 10 sep');
  // Sprint: sin métrica única (varias distancias) → sin tendencia, pero con mejor marca
  const sp = exerciseGlance(mk([ses('a', '2026-09-10', [['sprint', [set(null, null, { distanceM: 20, timeSec: 3.2 })]]])]), 'sprint');
  assert.equal(sp.metric, null);
  assert.equal(sp.trend, null);
  assert.equal(sp.best.kind, 'sprint');
});

test('exercisePrimaryMetric: 1RM estimado cuando lo hay; si no, lo que sigue el progreso del tipo', () => {
  const ser = (o = {}) => ({ e1rm: [], maxWeight: [], maxReps: [], maxHeight: [], ...o });
  assert.equal(exercisePrimaryMetric('weight_reps', ser({ e1rm: [{ y: 1 }], maxWeight: [{ y: 1 }] })), 'e1rm');
  assert.equal(exercisePrimaryMetric('weight_reps', ser({ maxWeight: [{ y: 10 }] })), 'maxWeight', 'todo de más de 12 reps');
  assert.equal(exercisePrimaryMetric('bodyweight', ser({ maxWeight: [{ y: 0 }] })), 'maxReps');
  assert.equal(exercisePrimaryMetric('bodyweight', ser({ maxWeight: [{ y: 5 }] })), 'maxWeight');
  assert.equal(exercisePrimaryMetric('time', ser()), 'maxTime');
  assert.equal(exercisePrimaryMetric('jumps', ser({ maxHeight: [{ y: 40 }] })), 'maxHeight');
  assert.equal(exercisePrimaryMetric('jumps', ser()), 'maxReps');
  assert.equal(exercisePrimaryMetric('distance_time', ser()), null);
  assert.equal(exercisePrimaryMetric('cardio', ser()), null);
});

test('redondeo humano: el peso máximo cambia «−1,7 kg», no «−1,67 kg» (regresión)', () => {
  // 45, 45, 45 | 45, 40, 45 … promedios de los extremos: 45 → 43,33 (antes «−1,67 kg desde julio»)
  const pts = [['2026-07-06', 45], ['2026-07-13', 45], ['2026-07-20', 45], ['2026-08-03', 45], ['2026-08-10', 42.5], ['2026-09-01', 45],
    ['2026-09-21', 40], ['2026-09-28', 45], ['2026-10-05', 45]].map(([x, y]) => ({ x, y }));
  const r = levelSummary(pts, { today: TODAY, ...EXERCISE_METRIC_SUMMARY.maxWeight });
  assert.equal(r.text, '−1,7 kg desde julio');
  for (const k of Object.keys(EXERCISE_METRIC_SUMMARY)) assert.ok(EXERCISE_METRIC_SUMMARY[k].decimals <= 1, `${k}: como mucho un decimal`);
});

test('widenDomain / relativeSpan: el eje no exagera cambios pequeños, sin cruzar el cero', () => {
  assert.deepEqual(widenDomain(40, 45, 9), [38, 47]);
  assert.deepEqual(widenDomain(30, 70, 9), [30, 70], 'ya es más ancho');
  assert.deepEqual(widenDomain(1, 2, 10), [0, 10], 'positivos: no baja de 0');
  assert.deepEqual(widenDomain(-5, -4, 4), [-6.5, -2.5]);
  assert.deepEqual(widenDomain(5, 5, NaN), [5, 5]);
  assert.deepEqual(widenDomain(5, 5, 0), [5, 5]);
  const span = relativeSpan(0.2, 5);
  assert.equal(span(98, 101), 0.2 * 101);
  assert.equal(span(10, 12), 5, 'mínimo absoluto');
  // 1RM 100 → 101,7 kg: el eje cubre al menos ~20 kg (antes, 100–102)
  const [lo, hi] = widenDomain(100, 101.7, span(100, 101.7));
  const t = niceTicks(lo, hi);
  assert.ok(t.max - t.min >= 20, `${t.min}–${t.max}`);
  assert.ok(t.min <= 100 && t.max >= 101.7);
});
