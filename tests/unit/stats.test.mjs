// Pruebas de js/stats.js (estadísticas y récords de la Fase 2) con datos construidos a mano.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex, dataRange, exercisesWithHistory, searchExercises, exerciseHistory, exerciseSeries, strengthRecords,
  exerciseRecord, exerciseSummary, enduranceRecords, weeklySeries, weeklyPoints, weeklyAverage, muscleWeekly,
  muscleTable, muscleTarget, targetStatus, runPaceSeries, bikeSpeedSeries, swimPaceSeries, bodyweightSeries,
  adherenceSeries, adherenceTotals, fmtNumFast, fmtMetric, weightLabel, distanceLabel, RACE_DISTANCES, KINDS,
} from '../../js/stats.js';
import { e1rm, sessionVolume, sessionLoad, sessionPRs, makeBodyweightFn, movingAverage, weeklyMuscleSets } from '../../js/calc.js';
import { bwStats, bwPoints } from '../../js/activity-logic.js';
import { adherence, makeCtx, trackingSince } from '../../js/plan.js';
import { defaultSettings, SEED_TEMPLATES, SEED_EXERCISES } from '../../js/seed.js';
import { tsFromDate, fmtNum, addDays, deepClone, weekStart } from '../../js/util.js';

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------
// Hoy = jueves 24 sep 2026. Semanas (lunes): 31 ago, 7 sep, 14 sep, 21 sep.
const TODAY = '2026-09-24';

const EX = {
  bench: { id: 'bench', name: 'Press banca', aliases: ['bench press'], logType: 'weight_reps', primary: ['chest'], secondary: ['triceps', 'frontdelt'] },
  pullup: { id: 'pullup', name: 'Dominadas', aliases: ['pull-up'], logType: 'bodyweight', primary: ['back'], secondary: ['biceps'] },
  row1: { id: 'row1', name: 'Remo unilateral', aliases: [], logType: 'unilateral', primary: ['back'], secondary: [] },
  plank: { id: 'plank', name: 'Plancha', aliases: ['plank'], logType: 'time', primary: ['core'], secondary: [] },
  jump: { id: 'jump', name: 'Saltos verticales', aliases: [], logType: 'jumps', primary: ['quads'], secondary: [] },
  sprint: { id: 'sprint', name: 'Sprint', aliases: [], logType: 'distance_time', primary: ['hamstrings'], secondary: [] },
  squat: { id: 'squat', name: 'Sentadilla', aliases: [], logType: 'weight_reps', primary: ['quads', 'glutes'], secondary: [] },
  correr: { id: 'correr', name: 'Correr', aliases: [], logType: 'cardio', sport: 'run', primary: [], secondary: [] },
};

let seq = 0;
const set = (weight, reps, extra = {}) => ({ id: `st${++seq}`, type: 'effective', weight, reps, repsR: null, rir: null, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: 1, ...extra });
const warm = (weight, reps) => set(weight, reps, { type: 'warmup' });
const pend = (weight, reps) => set(weight, reps, { done: false, doneAt: null });

/** Sesión de fuerza: items = [[exerciseId, sets], …]. */
function ses(id, date, items, extra = {}) {
  return {
    id, kind: 'strength', date, planDate: date, status: 'done', parentId: null, templateId: null, templateName: 'Sesión libre',
    startedAt: tsFromDate(date, extra.hour ?? 18), createdAt: tsFromDate(date, extra.hour ?? 18), durationMin: 60, rpe: 7, notes: '',
    exercises: items.map(([exerciseId, sets], i) => ({ id: `${id}_se${i}`, exerciseId, exName: exerciseId, templateItemId: null, sets })),
    ...extra,
  };
}
/** Actividad (carrera, bici, natación, otra); durationMin = movingSec / 60, como la guarda el formulario. */
function act(id, kind, date, extra = {}) {
  const movingSec = 'movingSec' in extra ? extra.movingSec : 3600;
  return {
    id, kind, date, planDate: date, status: 'done', parentId: null, templateId: null, startedAt: null,
    createdAt: tsFromDate(date, extra.hour ?? 8), movingSec, durationMin: movingSec != null ? movingSec / 60 : null, rpe: 5, distanceKm: null, ...extra,
  };
}
const exMap = () => new Map(Object.values(EX).map((e) => [e.id, e]));
function mk(over = {}) {
  return { sessions: [], exercises: exMap(), templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], today: TODAY, ...over };
}
const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) < eps, msg || `${a} ≠ ${b}`);

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

test('fmtNumFast da exactamente lo mismo que util.fmtNum', () => {
  const values = [0, 1, -1, 0.05, 0.15, 1.005, 2.5, 72.5, 75.45, 999, 1000, 4350, 12500, 12500.55, 123456.789, -15, -0.04, NaN, null, Infinity];
  for (const v of values) for (const dec of [0, 1, 2]) assert.equal(fmtNumFast(v, dec), fmtNum(v, dec), `${v} con ${dec} decimales`);
  assert.equal(fmtNumFast(5, 2, 2), fmtNum(5, 2, 2));
  for (let i = 0; i < 2000; i++) { const v = (i * 7.919) % 3000 - 500; assert.equal(fmtNumFast(v, 1), fmtNum(v, 1)); }
});

test('etiquetas en español: coma decimal y unidades', () => {
  assert.equal(fmtMetric('kg', 82.5), '82,5 kg');
  assert.equal(fmtMetric('volume', 12500), '12.500 kg');
  assert.equal(fmtMetric('load', 350), '350');
  assert.equal(fmtMetric('km.run', 25.34), '25,3 km');
  assert.equal(fmtMetric('km.swim', 1.5), '1.500 m');
  assert.equal(fmtMetric('runPace', 312), '5:12 /km');
  assert.equal(fmtMetric('bikeSpeed', 28.33), '28,3 km/h');
  assert.equal(fmtMetric('swimPace', 120), '2:00 /100 m');
  assert.equal(fmtMetric('sets', 12.5), '12,5 series');
  assert.equal(fmtMetric('sets', 1), '1 serie');
  assert.equal(fmtMetric('runPace', null), '—');
  assert.equal(weightLabel('weight_reps', 82.5), '82,5 kg');
  assert.equal(weightLabel('bodyweight', 10), '+10 kg');
  assert.equal(weightLabel('bodyweight', -15), '−15 kg asist.');
  assert.equal(weightLabel('bodyweight', 0), 'Sin lastre');
  assert.equal(distanceLabel('run', 10), '10 km');
  assert.equal(distanceLabel('bike', 42.53), '42,5 km');
  assert.equal(distanceLabel('swim', 2), '2.000 m');
});

// ---------------------------------------------------------------------------
// Historial por ejercicio
// ---------------------------------------------------------------------------

test('exerciseHistory: solo sesiones terminadas y series de trabajo (sin calentamientos ni pendientes), en orden', () => {
  const data = mk({
    sessions: [
      ses('s2', '2026-09-08', [['bench', [set(82.5, 5, { rir: 1 })]]]),
      ses('s1', '2026-09-01', [['bench', [warm(100, 10), set(80, 6, { rir: 2 }), set(80, 5, { rir: 1 }), pend(120, 5), set(60, 13)]]]),
      ses('sa', '2026-09-10', [['bench', [set(150, 5)]]], { status: 'active' }),
      ses('s3', '2026-09-15', [['bench', [warm(60, 8)]]]), // solo calentamiento → no es historial
    ],
  });
  const h = exerciseHistory(data, 'bench');
  assert.deepEqual(h.map((e) => e.sessionId), ['s1', 's2']);
  const [a, b] = h;
  assert.equal(a.date, '2026-09-01');
  assert.equal(a.workSets, 3);
  assert.deepEqual(a.sets.map((s) => s.weight), [80, 80, 60]);
  assert.equal(a.maxWeight, 80); // ni el calentamiento de 100 ni la pendiente de 120
  assert.equal(a.e1rm, e1rm(80, 6, 2)); // 60×13 no tiene 1RM (más de 12 reps)
  assert.equal(a.volume, 80 * 6 + 80 * 5 + 60 * 13);
  assert.equal(a.bestSetLabel, '80 kg × 6 @2');
  assert.equal(a.maxWeightLabel, '80 kg × 6 @2');
  assert.equal(a.templateName, 'Sesión libre');
  assert.equal(a.bw, null);
  assert.deepEqual(a.setLabels, ['80×6 @2', '80×5 @1', '60×13']);
  assert.equal(a.summary, '80×6 @2 · 80×5 @1 · 60×13');
  assert.equal(b.maxWeight, 82.5);
  assert.equal(b.e1rm, e1rm(82.5, 5, 1));
  assert.equal(b.bestSetLabel, '82,5 kg × 5 @1');
  // Sin textos por serie si no se piden.
  assert.equal(exerciseHistory(data, 'bench', { labels: false })[0].setLabels, undefined);
  assert.deepEqual(exerciseHistory(data, 'nope'), []);
});

test('exerciseHistory: un ejercicio repetido en la sesión se une; una serie sin reps no es «peso máximo»', () => {
  const data = mk({ sessions: [ses('s1', '2026-09-01', [['sprint', [set(null, null, { distanceM: 20, timeSec: 3.4 })]], ['bench', [set(100, 0), set(70, 8)]], ['sprint', [set(null, null, { distanceM: 30, timeSec: 4.6 }), set(null, null, { distanceM: 20, timeSec: 3.3 })]]])] });
  const [sp] = exerciseHistory(data, 'sprint');
  assert.equal(sp.workSets, 3);
  assert.deepEqual(sp.sprints, { 20: 3.3, 30: 4.6 });
  assert.equal(sp.maxWeight, null);
  assert.equal(sp.volume, null);
  const [b] = exerciseHistory(data, 'bench');
  assert.equal(b.maxWeight, 70);
  assert.equal(b.volume, 560);
});

test('exerciseHistory: la mejor serie es la de mayor 1RM estimado (aunque otra tenga más reps sin 1RM)', () => {
  // calc.bestSet compararía 11 (1RM de 10×3) con 20 (reps de 8×20); aquí solo se comparan 1RM.
  const data = mk({ sessions: [ses('s1', '2026-09-01', [['bench', [set(10, 3), set(8, 20)]]])] });
  const [e] = exerciseHistory(data, 'bench');
  assert.equal(e.bestSet.weight, 10);
  // Si ninguna serie tiene 1RM (todas > 12 reps), la mejor es la de más peso × reps (no solo más reps).
  const d2 = mk({ sessions: [ses('s1', '2026-09-01', [['bench', [set(10, 15), set(8, 20), set(5, 25)]]])] });
  const [e2] = exerciseHistory(d2, 'bench');
  assert.equal(e2.e1rm, null);
  assert.equal(e2.bestSetLabel, '8 kg × 20'); // 160 kg > 150 > 125 (calc.bestSet daría 5 × 25)
  assert.equal(exerciseSeries(d2, 'bench').maxWeight.length, 1);
});

test('exerciseSeries: «mejor serie» también en ejercicios de más de 12 reps; y = peso de la serie, no el 1RM', () => {
  // Elevaciones laterales 3×12–20: ninguna serie tiene 1RM, pero cada sesión tiene su mejor serie.
  const data = mk({
    sessions: [
      ses('s1', '2026-09-14', [['bench', [set(10, 16, { rir: 2 })]]]),
      ses('s2', '2026-09-21', [['bench', [set(10, 20, { rir: 1 }), set(10, 18, { rir: 1 }), set(12, 15, { rir: 0 })]]]),
      // Empate de peso × reps (180): gana la de más peso; dos sesiones sin 1RM el mismo día → la mejor de las dos.
      ses('s3', '2026-09-22', [['bench', [set(10, 18)]]], { hour: 9 }),
      ses('s4', '2026-09-22', [['bench', [set(12, 15), set(9, 20)]]], { hour: 19 }),
    ],
  });
  const ser = exerciseSeries(data, 'bench');
  assert.deepEqual(ser.e1rm, []);
  assert.deepEqual(ser.bestSet.map((p) => [p.x, p.y, p.label, p.sessionId, p.reps, p.e1rm]), [
    ['2026-09-14', 10, '10 kg × 16 @2', 's1', 16, null],
    ['2026-09-21', 10, '10 kg × 20 @1', 's2', 20, null], // 200 kg > 180
    ['2026-09-22', 12, '12 kg × 15', 's4', 15, null],
  ]);
  // La lista del historial dice la misma mejor serie que la gráfica.
  assert.deepEqual(exerciseHistory(data, 'bench').map((e) => e.bestSetLabel), ['10 kg × 16 @2', '10 kg × 20 @1', '10 kg × 18', '12 kg × 15']);
  // Con 1RM, la mejor serie es la de mayor 1RM, pero su altura es su PESO (el globo «80 kg × 6 @2» cae en 80).
  const d2 = mk({ sessions: [ses('s1', '2026-09-07', [['bench', [set(80, 6, { rir: 2 }), set(85, 4, { rir: 1 }), set(60, 15)]]])] });
  const s2 = exerciseSeries(d2, 'bench');
  assert.deepEqual(s2.bestSet.map((p) => [p.y, p.label, p.reps, p.e1rm]), [[80, '80 kg × 6 @2', 6, e1rm(80, 6, 2)]]);
  assert.equal(s2.e1rm[0].y, e1rm(80, 6, 2));
  assert.notEqual(s2.bestSet[0].y, s2.e1rm[0].y);
  // Un día con una sesión con 1RM y otra sin 1RM: manda el 1RM (no se mezcla con peso × reps).
  const d3 = mk({ sessions: [
    ses('a', '2026-09-07', [['bench', [set(20, 30)]]], { hour: 9 }),
    ses('b', '2026-09-07', [['bench', [set(15, 10)]]], { hour: 19 }),
  ] });
  assert.deepEqual(exerciseSeries(d3, 'bench').bestSet.map((p) => [p.y, p.sessionId]), [[15, 'b']]);
});

test('peso corporal: carga = peso corporal del día + lastre (asistencia negativa); «peso máximo» = lastre', () => {
  const data = mk({
    bodyweight: [{ id: '2026-09-01', kg: 74 }, { id: '2026-09-08', kg: 76 }],
    sessions: [
      ses('s1', '2026-09-01', [['pullup', [warm(0, 5), set(0, 8), set(-10, 10), set(10, 5, { rir: 1 })]]]),
      ses('s2', '2026-09-09', [['pullup', [set(null, 9)]]]),
    ],
  });
  const [a, b] = exerciseHistory(data, 'pullup');
  assert.equal(a.bw, 74);
  assert.equal(a.maxWeight, 10);
  assert.equal(a.e1rm, e1rm(84, 5, 1)); // (74 + 10) × (1 + 6/30) = 100,8 > 74 × (1 + 8/30) y 64 × (1 + 10/30)
  assert.equal(a.volume, 74 * 8 + 64 * 10 + 84 * 5);
  assert.equal(a.bestSetLabel, '+10 kg × 5 @1');
  assert.equal(b.bw, 76); // último pesaje en o antes de la fecha
  assert.equal(b.maxWeight, 0); // sin lastre
  assert.equal(b.maxWeightLabel, 'Sin lastre · 9 reps');
  assert.equal(b.e1rm, e1rm(76, 9));

  const ser = exerciseSeries(data, 'pullup');
  assert.deepEqual(ser.maxWeight.map((p) => [p.x, p.y, p.label]), [['2026-09-01', 10, '+10 kg × 5 @1'], ['2026-09-09', 0, 'Sin lastre · 9 reps']]);
  assert.deepEqual(ser.maxReps.map((p) => p.y), [10, 9]);
  // Mejor serie en peso corporal: y = lastre de la serie de mayor 1RM (0 = sin lastre).
  assert.deepEqual(ser.bestSet.map((p) => [p.y, p.label]), [[10, '+10 kg × 5 @1'], [0, 'Sin lastre · 9 reps']]);
  assert.equal(ser.e1rm[0].label, `${fmtNum(e1rm(84, 5, 1), 1)} kg · +10 kg × 5 @1 · peso corporal 74 kg`);

  const r = exerciseRecord(data, 'pullup');
  assert.equal(r.bestWeight.value, 10);
  assert.equal(r.bestWeight.label, '+10 kg');
  assert.equal(r.bestE1rm.value, e1rm(84, 5, 1));
  assert.equal(r.bestE1rm.bw, 74);
  assert.equal(r.bwLabel, 'peso corporal 74 kg');
  assert.deepEqual(r.repsAtWeight.map((x) => [x.weight, x.reps, x.label]), [[10, 5, '+10 kg × 5'], [0, 9, 'Sin lastre × 9'], [-10, 10, '−10 kg asist. × 10']]);
  // 0 kg: 8 reps el 1 sep y 9 el 9 sep → cuenta el 9 sep (más reps)
  assert.equal(r.repsAtWeight[1].date, '2026-09-09');
});

test('peso corporal: sin pesajes se usa settings.bodyweightDefault; solo asistencia → récord negativo', () => {
  const settings = { ...defaultSettings(), bodyweightDefault: 80 };
  const data = mk({ settings, sessions: [ses('s1', '2026-09-01', [['pullup', [set(-20, 6), set(-15, 5)]]])] });
  const [e] = exerciseHistory(data, 'pullup');
  assert.equal(e.bw, 80);
  assert.equal(e.maxWeight, -15);
  assert.equal(e.e1rm, Math.max(e1rm(60, 6), e1rm(65, 5)));
  const r = exerciseRecord(data, 'pullup');
  assert.equal(r.bestWeight.value, -15);
  assert.equal(r.bestWeight.label, '−15 kg asist.');
});

test('unilateral: reps = el lado con menos (calc.setMetrics), volumen = ambos lados', () => {
  const data = mk({ sessions: [ses('s1', '2026-09-01', [['row1', [set(20, 10, { repsR: 8, rir: 2 }), set(22.5, 6, { repsR: 7 })]]])] });
  const [e] = exerciseHistory(data, 'row1');
  assert.equal(e.e1rm, Math.max(e1rm(20, 8, 2), e1rm(22.5, 6)));
  assert.equal(e.volume, 20 * 18 + 22.5 * 13);
  assert.equal(e.maxWeight, 22.5);
  assert.equal(e.setLabels[0], '20 kg × 10/8 @2');
  const r = exerciseRecord(data, 'row1');
  assert.deepEqual(r.repsAtWeight.map((x) => x.label), ['22,5 kg × 6 por lado', '20 kg × 8 por lado']);
  assert.equal(r.maxReps.value, 8);
  assert.equal(r.maxReps.label, '8 reps por lado');
});

test('exerciseSeries: puntos {x, y, label} desde una fecha; dos sesiones el mismo día se unen', () => {
  const data = mk({
    sessions: [
      ses('s1', '2026-09-01', [['bench', [set(80, 6, { rir: 2 })]]]),
      ses('s2', '2026-09-08', [['bench', [set(82.5, 5, { rir: 1 }), set(80, 8)]]], { hour: 9 }),
      ses('s3', '2026-09-08', [['bench', [set(85, 3)]]], { hour: 19 }),
    ],
  });
  const all = exerciseSeries(data, 'bench');
  assert.equal(all.logType, 'weight_reps');
  assert.deepEqual(all.maxWeight.map((p) => [p.x, p.y, p.label, p.sessionId]), [['2026-09-01', 80, '80 kg × 6 @2', 's1'], ['2026-09-08', 85, '85 kg × 3', 's3']]);
  const best8 = Math.max(e1rm(82.5, 5, 1), e1rm(80, 8), e1rm(85, 3));
  assert.equal(all.e1rm[1].y, best8);
  assert.equal(all.e1rm[1].label, `${fmtNum(best8, 1)} kg · 80 kg × 8`);
  assert.equal(all.bestSet[1].label, '80 kg × 8');
  assert.equal(all.bestSet[1].y, 80); // peso de la serie de mayor 1RM (no el 1RM)
  assert.equal(all.bestSet[1].e1rm, best8);
  assert.equal(all.bestSet[1].sessionId, 's2');
  assert.deepEqual(all.volume.map((p) => p.y), [480, 82.5 * 5 + 640 + 255]); // volumen del día sumado
  assert.equal(all.volume[1].label, `${fmtNum(82.5 * 5 + 640 + 255, 0)} kg`);
  const from = exerciseSeries(data, 'bench', '2026-09-02');
  assert.deepEqual(from.maxWeight.map((p) => p.x), ['2026-09-08']);
  assert.deepEqual(exerciseSeries(data, 'bench', null, '2026-09-05').e1rm.map((p) => p.x), ['2026-09-01']);
  assert.deepEqual(exerciseSeries(data, 'nope'), { logType: null, maxWeight: [], e1rm: [], bestSet: [], volume: [], maxReps: [], maxTime: [], maxHeight: [], sprint: [] });
});

test('exerciseSeries: tiempo, saltos y sprints por distancia', () => {
  const data = mk({
    sessions: [
      ses('s1', '2026-09-01', [['plank', [set(null, null, { timeSec: 45 }), set(null, null, { timeSec: 60 })]], ['jump', [set(null, 3, { heightCm: 40 }), set(null, 3)]], ['sprint', [set(null, null, { distanceM: 20, timeSec: 3.4 })]]]),
      ses('s2', '2026-09-08', [['plank', [set(null, null, { timeSec: 90 })]], ['jump', [set(null, 5)]], ['sprint', [set(null, null, { distanceM: 20, timeSec: 3.3 }), set(null, null, { distanceM: 30, timeSec: 4.5 })]]]),
    ],
  });
  const p = exerciseSeries(data, 'plank');
  assert.deepEqual(p.maxTime.map((x) => [x.y, x.label]), [[60, '1:00 min'], [90, '1:30 min']]);
  assert.deepEqual(p.bestSet.map((x) => x.y), [60, 90]);
  assert.deepEqual(p.e1rm, []);
  const j = exerciseSeries(data, 'jump');
  assert.deepEqual(j.maxHeight.map((x) => [x.x, x.y, x.label]), [['2026-09-01', 40, '40 cm']]);
  assert.deepEqual(j.maxReps.map((x) => x.y), [3, 5]);
  const s = exerciseSeries(data, 'sprint');
  assert.deepEqual(s.sprint.map((x) => [x.distanceM, x.label, x.points.map((q) => q.y)]), [[20, '20 m', [3.4, 3.3]], [30, '30 m', [4.5]]]);
  assert.equal(s.sprint[0].points[1].label, '3,3 s'); // la distancia ya es el nombre de la serie («20 m»)
});

test('exerciseHistory.prs coincide con los récords del resumen de sesión (calc.sessionPRs)', () => {
  const sessions = [
    ses('s1', '2026-09-01', [['bench', [set(80, 6), set(82.5, 3)]], ['pullup', [set(5, 6)]]]),
    ses('s2', '2026-09-08', [['bench', [set(80, 7), set(85, 2)]], ['pullup', [set(5, 6)]]]),
    ses('s3', '2026-09-15', [['bench', [set(70, 10)]], ['pullup', [set(7.5, 6)]]]),
  ];
  const bodyweight = [{ id: '2026-09-01', kg: 75 }, { id: '2026-09-08', kg: 77 }];
  const data = mk({ sessions, bodyweight });
  const bwFn = makeBodyweightFn(bodyweight, 75);
  for (const exId of ['bench', 'pullup']) {
    for (const e of exerciseHistory(data, exId)) {
      const s = sessions.find((x) => x.id === e.sessionId);
      const prs = sessionPRs(s, sessions, exMap(), bwFn);
      const kinds = [];
      for (const set of e.sets) for (const pr of prs.get(set.id) || []) if (!kinds.includes(pr.kind)) kinds.push(pr.kind);
      assert.deepEqual(e.prs, kinds, `${exId} ${e.sessionId}`);
    }
  }
  assert.deepEqual(exerciseHistory(data, 'bench')[0].prs, []); // la primera sesión nunca marca récord
  assert.ok(exerciseHistory(data, 'bench')[1].prs.includes('weight'));
});

// ---------------------------------------------------------------------------
// Récords de fuerza
// ---------------------------------------------------------------------------

test('strengthRecords: mejor peso, mejor 1RM y reps a cada peso con la PRIMERA fecha en que se lograron', () => {
  const data = mk({
    sessions: [
      ses('s3', '2026-09-15', [['bench', [set(80, 7)]]]),
      ses('s1', '2026-09-01', [['bench', [warm(90, 5), set(80, 6)]]]),
      ses('s2b', '2026-09-08', [['bench', [set(80, 6), set(75, 8)]]], { hour: 19 }),
      ses('s2a', '2026-09-08', [['bench', [set(75, 8)]]], { hour: 9 }), // mismo día, antes: es la primera vez
      ses('s4', '2026-09-16', [['bench', [pend(100, 5)]]]),
    ],
  });
  const recs = strengthRecords(data);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.exerciseId, 'bench');
  assert.equal(r.name, 'Press banca');
  assert.equal(r.sessions, 4);
  assert.equal(r.lastDate, '2026-09-15');
  assert.deepEqual([r.bestWeight.value, r.bestWeight.date, r.bestWeight.sessionId, r.bestWeight.label, r.bestWeight.setLabel], [80, '2026-09-01', 's1', '80 kg', '80 kg × 6']);
  assert.deepEqual([r.bestE1rm.value, r.bestE1rm.date, r.bestE1rm.sessionId, r.bestE1rm.label], [e1rm(80, 7), '2026-09-15', 's3', `${fmtNum(e1rm(80, 7), 1)} kg`]);
  assert.deepEqual(r.repsAtWeight.map((x) => [x.weight, x.reps, x.date, x.sessionId, x.dominated]), [
    [80, 7, '2026-09-15', 's3', false],
    [75, 8, '2026-09-08', 's2a', false],
  ]);
  assert.equal(r.maxTime, undefined);
  assert.equal(r.bestSprint, undefined);
});

test('strengthRecords: a igual peso en la misma sesión, «mejor peso» es la serie con más reps (primera sesión)', () => {
  const data = mk({
    sessions: [
      ses('s1', '2026-09-07', [['bench', [set(40, 12, { rir: 2 }), set(40, 15, { rir: 1 }), set(40, 14)]]]),
      ses('s2', '2026-09-14', [['bench', [set(40, 20)]]]), // mismo peso otro día: sigue contando la primera vez
    ],
  });
  const r = exerciseRecord(data, 'bench');
  assert.deepEqual([r.bestWeight.value, r.bestWeight.reps, r.bestWeight.date, r.bestWeight.setLabel], [40, 15, '2026-09-07', '40 kg × 15 @1']);
  // Coincide con el «peso máximo» del historial y de la gráfica de ese día.
  assert.equal(exerciseSeries(data, 'bench').maxWeight[0].label, r.bestWeight.setLabel);
  assert.equal(r.bestWeight.setId, data.sessions[0].exercises[0].sets[1].id);
  assert.equal(exerciseHistory(data, 'bench')[0].maxWeightSet.id, r.bestWeight.setId);
});

test('strengthRecords: reps a cada peso ordenadas por peso desc, con las dominadas marcadas; empate de 1RM → primera vez', () => {
  const data = mk({
    sessions: [
      ses('s1', '2026-09-01', [['squat', [set(100, 5), set(90, 4), set(80, 10)]]]),
      ses('s2', '2026-09-08', [['squat', [set(100, 5), set(102.5, 1)]]]),
    ],
  });
  const r = exerciseRecord(data, 'squat');
  assert.deepEqual(r.repsAtWeight.map((x) => [x.weight, x.reps, x.dominated]), [[102.5, 1, false], [100, 5, false], [90, 4, true], [80, 10, false]]);
  assert.equal(r.repsAtWeight[0].label, '102,5 kg × 1');
  assert.equal(r.bestWeight.value, 102.5);
  assert.equal(r.bestWeight.date, '2026-09-08');
  // 1RM: 100×5 = 116,67 el 1 sep y otra vez el 8 sep; 80×10 = 106,67; 102,5×1 = 102,5 → cuenta el 1 sep.
  assert.equal(r.bestE1rm.value, e1rm(100, 5));
  assert.equal(r.bestE1rm.sessionId, 's1');
  assert.equal(r.maxReps.value, 10);
});

test('strengthRecords: tiempo máximo, altura máxima y mejor tiempo por distancia', () => {
  const data = mk({
    sessions: [
      ses('s1', '2026-09-01', [['plank', [set(null, null, { timeSec: 45 }), set(null, null, { timeSec: 60 })]], ['jump', [set(null, 3, { heightCm: 40 })]], ['sprint', [set(null, null, { distanceM: 20, timeSec: 3.4 }), set(null, null, { distanceM: 30, timeSec: 4.6 })]]]),
      ses('s2', '2026-09-08', [['plank', [set(null, null, { timeSec: 60 })]], ['jump', [set(null, 3, { heightCm: 45 }), warm(null, 3)]], ['sprint', [set(null, null, { distanceM: 20, timeSec: 3.3 }), set(null, null, { distanceM: 30, timeSec: 4.6 })]]]),
      ses('s3', '2026-09-15', [['jump', [set(null, 3, { heightCm: 45 }), { ...set(null, 3, { heightCm: 60 }), type: 'warmup' }]]]),
    ],
  });
  const recs = new Map(strengthRecords(data).map((r) => [r.exerciseId, r]));
  const plank = recs.get('plank');
  assert.deepEqual([plank.maxTime.value, plank.maxTime.date, plank.maxTime.label], [60, '2026-09-01', '1:00 min']);
  assert.equal(plank.bestWeight, null);
  assert.deepEqual(plank.repsAtWeight, []);
  const jump = recs.get('jump');
  assert.deepEqual([jump.maxHeight.value, jump.maxHeight.date, jump.maxHeight.sessionId, jump.maxHeight.label], [45, '2026-09-08', 's2', '45 cm']);
  const sp = recs.get('sprint');
  assert.deepEqual(Object.keys(sp.bestSprint), ['20', '30']);
  assert.deepEqual([sp.bestSprint['20'].timeSec, sp.bestSprint['20'].date, sp.bestSprint['20'].label], [3.3, '2026-09-08', '20 m en 3,3 s']);
  assert.deepEqual([sp.bestSprint['30'].timeSec, sp.bestSprint['30'].date], [4.6, '2026-09-01']); // empate: primera vez
  // Orden: del usado más recientemente al más antiguo.
  assert.equal(strengthRecords(data)[0].exerciseId, 'jump');
});

test('exercisesWithHistory: con al menos una serie de trabajo, por última fecha desc; buscable', () => {
  const data = mk({
    sessions: [
      ses('s1', '2026-09-01', [['bench', [set(80, 5)]], ['squat', [warm(60, 5)]], ['pullup', [pend(0, 8)]]]),
      ses('s2', '2026-09-10', [['plank', [set(null, null, { timeSec: 30 })]], ['bench', [set(80, 6)]]]),
      ses('s3', '2026-09-12', [['row1', [set(20, 10, { repsR: 10 })]]], { status: 'active' }),
      act('r1', 'run', '2026-09-11', { parentId: 's2', distanceKm: 5 }),
    ],
  });
  const list = exercisesWithHistory(data);
  // Misma última fecha → por nombre («Plancha» < «Press banca»).
  assert.deepEqual(list.map((x) => [x.exerciseId, x.sessions, x.lastDate]), [['plank', 1, '2026-09-10'], ['bench', 2, '2026-09-10']]);
  const bench = list.find((x) => x.exerciseId === 'bench');
  assert.equal(bench.firstDate, '2026-09-01');
  assert.equal(bench.workSets, 2);
  assert.equal(bench.exercise, data.exercises.get('bench'));
  assert.deepEqual(searchExercises(list, 'BENCH').map((x) => x.exerciseId), ['bench']); // alias
  assert.deepEqual(searchExercises(list, 'prés').map((x) => x.exerciseId), ['bench']); // sin tildes
  assert.equal(searchExercises(list, '  ').length, 2);
  const sum = exerciseSummary(data, 'bench');
  assert.equal(sum.sessions, 2);
  assert.equal(sum.last.sessionId, 's2');
  assert.equal(sum.last.summary, '80×6');
  assert.equal(sum.record.bestWeight.value, 80);
  assert.equal(exerciseSummary(data, 'nope'), null);
});

// ---------------------------------------------------------------------------
// Récords de resistencia
// ---------------------------------------------------------------------------

test('enduranceRecords: 5k/10k/media reales y estimados desde tiradas más largas; mayor distancia', () => {
  const data = mk({
    sessions: [
      act('r1', 'run', '2026-09-01', { distanceKm: 5, movingSec: 1500 }), // 5k exacto 25:00
      act('r2', 'run', '2026-09-05', { distanceKm: 10, movingSec: 2880 }), // 10k exacto; 5k estimado 24:00
      act('r3', 'run', '2026-09-10', { distanceKm: 5.08, movingSec: 1440 }), // 5k (≤ 5,1 km → no estimado)
      act('r4', 'run', '2026-09-11', { distanceKm: 4.9, movingSec: 1000 }), // no llega a 5 km
      act('r5', 'run', '2026-09-13', { distanceKm: 21.1, movingSec: 6300 }), // media
      act('r6', 'run', '2026-09-15', { distanceKm: 10.5, movingSec: 3000, parentId: 's1' }), // enlazada: cuenta (10k estimado)
      act('r7', 'run', '2026-09-16', { distanceKm: 30, movingSec: 20000, status: 'active' }), // no terminada
      act('b1', 'bike', '2026-09-02', { distanceKm: 42.5, movingSec: 5400 }),
      act('b2', 'bike', '2026-09-09', { distanceKm: 60.2, movingSec: 7200 }),
      act('w1', 'swim', '2026-09-03', { distanceKm: 1.5, movingSec: 1800 }),
      act('w2', 'swim', '2026-09-12', { distanceKm: 2, movingSec: 2600 }),
      act('o1', 'other', '2026-09-04', { distanceKm: 99 }),
    ],
  });
  const r = enduranceRecords(data);
  assert.equal(r.run.count, 6);
  assert.deepEqual([r.run.longest.distanceKm, r.run.longest.sessionId, r.run.longest.label], [21.1, 'r5', '21,1 km']);
  const b5 = r.run.best['5k'];
  assert.equal(b5.sessionId, 'r3');
  close(b5.timeSec, (1440 * 5) / 5.08);
  assert.equal(b5.estimated, false);
  assert.equal(b5.fromKm, 5.08);
  assert.equal(b5.timeLabel, '23:37');
  assert.equal(b5.paceLabel, '4:43 /km');
  const b10 = r.run.best['10k'];
  assert.equal(b10.sessionId, 'r6');
  close(b10.timeSec, (3000 * 10) / 10.5);
  assert.equal(b10.estimated, true);
  const half = r.run.best.half;
  assert.equal(half.sessionId, 'r5');
  close(half.timeSec, (6300 * 21.0975) / 21.1);
  assert.equal(half.estimated, false);
  assert.equal(half.label, 'Media maratón');
  assert.equal(r.run.best.marathon, null);
  assert.deepEqual([r.bike.longest.distanceKm, r.bike.longest.label, r.bike.count], [60.2, '60,2 km', 2]);
  assert.deepEqual([r.swim.longest.distanceKm, r.swim.longest.sessionId, r.swim.longest.label], [2, 'w2', '2.000 m']);
  assert.deepEqual(RACE_DISTANCES.map((x) => x.km), [5, 10, 21.0975, 42.195]);
});

test('enduranceRecords: 5k estimado desde un 10k y exacto; empates → la primera; sin datos → null', () => {
  const data = mk({
    sessions: [
      act('r1', 'run', '2026-09-01', { distanceKm: 10, movingSec: 2800 }), // 5k estimado 23:20
      act('r2', 'run', '2026-09-08', { distanceKm: 5, movingSec: 1400 }), // mismo tiempo exacto → sigue r1
      act('r3', 'run', '2026-09-10', { distanceKm: 5.1, movingSec: 1500 }), // 5,1 = 5 × 1,02 → no estimado (y más lento)
      act('r4', 'run', '2026-09-12', { distanceKm: 42.195, movingSec: 14400 }), // maratón exacto
      act('r5', 'run', '2026-09-13', { distanceKm: 12, movingSec: null }), // sin tiempo: no da marcas
    ],
  });
  const r = enduranceRecords(data);
  assert.equal(r.run.best['5k'].sessionId, 'r1');
  assert.equal(r.run.best['5k'].timeSec, 1400);
  assert.equal(r.run.best['5k'].estimated, true);
  assert.equal(r.run.best.marathon.timeSec, 14400);
  assert.equal(r.run.best.marathon.estimated, false);
  assert.equal(r.run.best.marathon.timeLabel, '4:00:00');
  // estimado solo si distanceKm > X × 1,02
  const d2 = mk({ sessions: [act('r3', 'run', '2026-09-10', { distanceKm: 5.1, movingSec: 1500 }), act('r4', 'run', '2026-09-11', { distanceKm: 5.11, movingSec: 1300 })] });
  const r2 = enduranceRecords(d2);
  assert.equal(r2.run.best['5k'].estimated, true);
  assert.equal(enduranceRecords(mk({ sessions: [act('r3', 'run', '2026-09-10', { distanceKm: 5.1, movingSec: 1500 })] })).run.best['5k'].estimated, false);
  const empty = enduranceRecords(mk());
  assert.deepEqual(empty, { run: { count: 0, longest: null, best: { '5k': null, '10k': null, half: null, marathon: null } }, bike: { count: 0, longest: null }, swim: { count: 0, longest: null } });
});

// ---------------------------------------------------------------------------
// Semanas
// ---------------------------------------------------------------------------

function weekData(settings = defaultSettings()) {
  return mk({
    settings,
    sessions: [
      // Semana 31 ago
      ses('s1', '2026-09-01', [['bench', [warm(60, 10), set(80, 6), set(80, 6), set(80, 5)]], ['pullup', [set(0, 8)]]]), // 60 min × 7
      act('r1', 'run', '2026-09-02', { distanceKm: 10, movingSec: 3000, rpe: 6 }), // 5:00 /km
      act('r2', 'run', '2026-09-03', { distanceKm: 5, movingSec: 1800, rpe: 4 }), // 6:00 /km
      act('r3', 'run', '2026-09-04', { distanceKm: null, movingSec: 1200, durationMin: 20, rpe: 3 }), // sin distancia
      act('b1', 'bike', '2026-09-05', { distanceKm: 30, movingSec: 3600, rpe: 5 }),
      act('b2', 'bike', '2026-09-06', { distanceKm: 20, movingSec: 3600, rpe: null }), // sin carga
      // Semana 7 sep: vacía
      // Semana 14 sep: fuerza con carrera enlazada + natación + otra
      ses('s2', '2026-09-14', [['squat', [set(100, 5), set(100, 5)]]], { durationMin: 30, rpe: 8 }),
      act('r4', 'run', '2026-09-14', { distanceKm: 8, movingSec: 2400, rpe: 7, parentId: 's2', parentItemId: 's2_se9' }),
      act('w1', 'swim', '2026-09-16', { distanceKm: 1.5, movingSec: 1800, rpe: 5 }),
      act('o1', 'other', '2026-09-19', { movingSec: 5400, durationMin: 90, rpe: 6, subtype: 'basketball' }),
      ses('sa', '2026-09-17', [['bench', [set(200, 5)]]], { status: 'active' }), // en curso: no cuenta
      // Semana 21 sep (actual)
      ses('s3', '2026-09-22', [['bench', [set(82.5, 5)]]], { rpe: 8 }),
    ],
  });
}

test('weeklySeries: todas las semanas del rango (vacías con ceros), lunes, carga por tipo y total', () => {
  const data = weekData();
  const rows = weeklySeries(data, '2026-09-02', TODAY);
  assert.deepEqual(rows.map((r) => r.week), ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
  const [w1, w2, w3, w4] = rows;
  assert.equal(w1.weekEnd, '2026-09-06');
  assert.equal(w1.sessions, 6); // de fecha 1 sep: la semana es la del lunes 31 ago aunque `from` sea miércoles
  assert.deepEqual(w1.load, { strength: 420, run: 300 + 120 + 60, bike: 300, swim: 0, other: 0 });
  assert.equal(w1.loadTotal, 420 + 480 + 300);
  assert.equal(w1.noLoad, 1);
  assert.deepEqual(w1.km, { run: 15, bike: 50, swim: 0 });
  assert.equal(w1.runPace, (3000 + 1800) / 15); // ponderado por distancia: 5:20, no la media 5:30
  assert.equal(w1.labels.runPace, '5:20 /km');
  assert.equal(w1.bikeSpeed, 25); // 50 km en 2 h
  assert.equal(w1.labels.bikeSpeed, '25 km/h');
  assert.equal(w1.swimPace, null);
  assert.equal(w1.strengthVolume, 80 * 17 + 75 * 8); // sin el calentamiento; dominadas con peso corporal por defecto
  assert.equal(w1.workSets, 4);
  assert.equal(w1.count.run, 3);
  // Semana vacía: ceros y ritmos null.
  assert.deepEqual([w2.sessions, w2.loadTotal, w2.strengthVolume, w2.km.run, w2.runPace, w2.bikeSpeed], [0, 0, 0, 0, null, null]);
  assert.deepEqual(w2.load, { strength: 0, run: 0, bike: 0, swim: 0, other: 0 });
  assert.deepEqual(w2.muscleSets, {});
  // Carrera enlazada a la fuerza: cuenta en carrera (la duración de la fuerza ya la descuenta).
  assert.deepEqual(w3.load, { strength: 240, run: 280, bike: 0, swim: 150, other: 540 });
  assert.equal(w3.km.run, 8);
  assert.equal(w3.km.swim, 1.5);
  assert.equal(w3.swimPace, 120);
  assert.equal(w3.labels.km.swim, '1.500 m');
  assert.equal(w3.strengthVolume, 1000); // la sesión en curso (200 kg) no cuenta
  assert.equal(w4.current, true);
  assert.equal(w3.current, false);
  // La carga coincide con calc.sessionLoad sesión a sesión.
  const total = data.sessions.filter((s) => s.status === 'done').reduce((t, s) => t + (sessionLoad(s) || 0), 0);
  assert.equal(rows.reduce((t, r) => t + r.loadTotal, 0), total);
  assert.deepEqual(Object.keys(w1.load), KINDS);
});

test('weeklySeries: volumen = calc.sessionVolume; series por músculo = calc.sessionMuscleSets con settings', () => {
  const data = weekData();
  const [w1] = weeklySeries(data, '2026-08-31', '2026-08-31');
  const s1 = data.sessions[0];
  assert.equal(w1.strengthVolume, sessionVolume(s1, data.exercises, makeBodyweightFn([], 75)));
  assert.deepEqual(w1.muscleSets, { chest: 3, triceps: 1.5, frontdelt: 1.5, back: 1, biceps: 0.5 });
  assert.deepEqual(w1.muscleSets, weeklyMuscleSets(data.sessions, '2026-08-31', data.exercises, data.settings));
  const d2 = weekData({ ...defaultSettings(), secondaryFactor: 0.25 });
  assert.deepEqual(weeklySeries(d2, '2026-08-31', '2026-08-31')[0].muscleSets, { chest: 3, triceps: 0.75, frontdelt: 0.75, back: 1, biceps: 0.25 });
  // Rango por defecto: desde la primera sesión hasta hoy.
  assert.deepEqual(weeklySeries(data).map((r) => r.week), ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
  // Sin datos: una semana (la de hoy) vacía.
  assert.deepEqual(weeklySeries(mk()).map((r) => [r.week, r.sessions]), [['2026-09-21', 0]]);
});

test('weeklySeries: peso corporal del día en el volumen de fuerza', () => {
  const data = mk({ bodyweight: [{ id: '2026-09-01', kg: 70 }], sessions: [ses('s1', '2026-09-02', [['pullup', [set(10, 5), set(-10, 5)]]])] });
  assert.equal(weeklySeries(data)[0].strengthVolume, 80 * 5 + 60 * 5);
});

test('weeklyPoints y weeklyAverage: etiquetas, ritmos sin semanas vacías y media de 4 semanas sin diluir', () => {
  const data = weekData();
  const rows = weeklySeries(data, '2026-08-31', TODAY);
  const load = weeklyPoints(rows, 'loadTotal');
  assert.deepEqual(load.map((p) => p.x), rows.map((r) => r.week));
  assert.equal(load[1].y, 0);
  assert.equal(load[0].label, fmtNum(1200, 0));
  const pace = weeklyPoints(rows, 'runPace');
  assert.deepEqual(pace.map((p) => [p.x, p.label]), [['2026-08-31', '5:20 /km'], ['2026-09-14', '5:00 /km']]);
  assert.deepEqual(weeklyPoints(rows, 'km.swim').map((p) => p.y), [0, 0, 1.5, 0]);
  assert.deepEqual(weeklyPoints(rows, 'muscle.chest').map((p) => p.y), [3, 0, 0, 1]);
  assert.equal(weeklyPoints(rows, 'load.run')[2].y, 280);
  assert.throws(() => weeklyPoints(rows, 'nada'));

  const avg = weeklyAverage(data, '2026-08-31', TODAY, 'loadTotal', 4);
  const tot = rows.map((r) => r.loadTotal);
  // La primera semana con datos no se promedia con semanas anteriores a empezar (no se diluye).
  assert.deepEqual(avg.map((p) => [p.x, p.weeks]), [['2026-08-31', 1], ['2026-09-07', 2], ['2026-09-14', 3], ['2026-09-21', 4]]);
  close(avg[3].y, (tot[0] + tot[1] + tot[2] + tot[3]) / 4);
  close(avg[1].y, (tot[0] + tot[1]) / 2);
  // Etiqueta = solo el valor (sin « · media N sem.»); las semanas promediadas van aparte en `weeks`.
  assert.deepEqual(avg.map((p) => p.label), avg.map((p) => fmtNum(p.y, 0)));
  // Ritmo medio de 4 semanas ponderado por distancia en toda la ventana.
  const pAvg = weeklyAverage(data, '2026-08-31', TODAY, 'runPace', 4);
  close(pAvg[3].y, (3000 + 1800 + 2400) / (15 + 8));
  assert.deepEqual(weeklyAverage(mk(), null, null, 'loadTotal'), []);
});

test('muscleWeekly y muscleTable: series frente al rango objetivo', () => {
  const data = weekData();
  const m = muscleWeekly(data, 'chest', '2026-08-31', TODAY);
  const target = defaultSettings().muscleTargets.chest;
  assert.deepEqual(m.map((r) => [r.week, r.sets, r.status]), [['2026-08-31', 3, 'below'], ['2026-09-07', 0, 'below'], ['2026-09-14', 0, 'below'], ['2026-09-21', 1, 'below']]);
  assert.deepEqual(m[0].target, target);
  assert.equal(m[0].label, '3 series');
  assert.equal(muscleTarget({ muscleTargets: {} }, 'chest'), null);
  assert.equal(targetStatus(12, [12, 20]), 'in');
  assert.equal(targetStatus(20, [12, 20]), 'in');
  assert.equal(targetStatus(20.5, [12, 20]), 'above');
  assert.equal(targetStatus(11.5, [12, 20]), 'below');
  assert.equal(targetStatus(0, [0, 10]), 'in');
  assert.equal(targetStatus(5, null), 'none');
  const t = muscleTable(data, '2026-09-02');
  assert.equal(t[0].muscleId, 'back'); // orden de seed.MUSCLES
  const chest = t.find((r) => r.muscleId === 'chest');
  assert.deepEqual([chest.name, chest.sets, chest.prevSets, chest.min, chest.max, chest.status, chest.setsLabel], ['Pecho', 3, 0, target[0], target[1], 'below', '3 series']);
  const quads = muscleTable(data, '2026-09-14').find((r) => r.muscleId === 'quads');
  assert.equal(quads.sets, 2);
  const now = muscleTable(data); // semana de hoy
  assert.equal(now.find((r) => r.muscleId === 'chest').sets, 1);
});

// ---------------------------------------------------------------------------
// Series por actividad
// ---------------------------------------------------------------------------

test('runPaceSeries / bikeSpeedSeries / swimPaceSeries: un punto por actividad con distancia y tiempo', () => {
  const data = weekData();
  const run = runPaceSeries(data);
  assert.deepEqual(run.map((p) => [p.x, p.y, p.sessionId]), [['2026-09-02', 300, 'r1'], ['2026-09-03', 360, 'r2'], ['2026-09-14', 300, 'r4']]);
  assert.equal(run[0].label, '5:00 /km · 10 km');
  assert.deepEqual(runPaceSeries(data, '2026-09-03').map((p) => p.sessionId), ['r2', 'r4']);
  assert.deepEqual(runPaceSeries(data, null, '2026-09-10').map((p) => p.sessionId), ['r1', 'r2']);
  const bike = bikeSpeedSeries(data);
  assert.deepEqual(bike.map((p) => [p.y, p.label]), [[30, '30 km/h · 30 km'], [20, '20 km/h · 20 km']]);
  const swim = swimPaceSeries(data);
  assert.deepEqual(swim.map((p) => [p.y, p.label]), [[120, '2:00 /100 m · 1.500 m']]);
});

// ---------------------------------------------------------------------------
// Peso corporal
// ---------------------------------------------------------------------------

function bwList(days, start = '2026-08-16') {
  return Array.from({ length: days }, (_, i) => ({ id: addDays(start, i), kg: Math.round((75 + 0.03 * i + (((i * 7) % 5) - 2) * 0.15) * 10) / 10 }))
    .filter((_, i) => i % 6 !== 5); // algún día sin pesaje
}

test('bodyweightSeries: los mismos números que la vista de peso (activity-logic.bwStats)', () => {
  const list = bwList(40);
  const data = mk({ bodyweight: list });
  const s = bwStats(list, TODAY);
  const r = bodyweightSeries(data);
  assert.equal(r.count, s.count);
  assert.deepEqual(r.last, s.last);
  assert.equal(r.ma7, s.ma7);
  assert.equal(r.ma7N, s.ma7N);
  assert.equal(r.ma7Date, s.ma7Date);
  assert.equal(r.trend.ok, true);
  assert.equal(r.trend.kgPerWeek, s.trend.kgPerWeek);
  assert.deepEqual({ ...r.trend, label: undefined }, { ...s.trend, label: undefined });
  assert.equal(r.trend.label, `${r.trend.kgPerWeek > 0 ? '+' : '−'}${fmtNum(Math.abs(s.trend.kgPerWeek), 2)} kg/sem`);
  assert.equal(r.ma.at(-1).y, s.ma7);
  assert.equal(r.daily.length, s.count);
  const ma = movingAverage(bwPoints(list), 7);
  assert.deepEqual(r.ma.map((p) => p.y), ma.map((p) => p.ma));
  assert.deepEqual(r.daily.map((p) => p.y), ma.map((p) => p.value));
  assert.equal(r.daily[0].label, `${fmtNum(list[0].kg, 1)} kg`);
  // Solo el valor: el nombre de la serie («Media 7 días») lo pone la gráfica.
  assert.deepEqual(r.ma.map((p) => p.label), ma.map((p) => `${fmtNum(p.ma, 1)} kg`));
});

test('bodyweightSeries = bwStats también con pocos pesajes, uno solo o ninguno', () => {
  const lists = [[], [{ id: '2026-09-20', kg: 75.4 }], bwList(3, '2026-09-18'), bwList(10, '2026-09-10'), bwList(20, '2026-08-01'), bwList(90, '2026-06-20'),
    [{ id: '2026-09-20', kg: 75 }, { id: 'mal', kg: 80 }, { id: '2026-09-21', kg: 0 }, null, { id: '2026-09-22', kg: 76 }]];
  for (const list of lists) {
    const s = bwStats(list, TODAY);
    const r = bodyweightSeries(mk({ bodyweight: list }));
    const { daily, ma, trend, ...summary } = r;
    const { trend: t2, ...sum2 } = s;
    assert.deepEqual(summary, sum2);
    assert.deepEqual({ ...trend, label: undefined }, { ...t2, label: undefined });
  }
});

test('bodyweightSeries: con periodo, la media de los primeros días incluye pesajes anteriores al periodo', () => {
  const list = bwList(40);
  const data = mk({ bodyweight: list });
  const from = '2026-09-20';
  const r = bodyweightSeries(data, from);
  assert.ok(r.daily.every((p) => p.x >= from));
  const first = r.ma[0];
  const win = list.filter((b) => b.id <= first.x && b.id > addDays(first.x, -7));
  close(first.y, win.reduce((t, b) => t + b.kg, 0) / win.length);
  assert.ok(win.some((b) => b.id < from));
  // La tendencia no depende del periodo mostrado.
  assert.equal(r.trend.kgPerWeek, bwStats(list, TODAY).trend.kgPerWeek);
  // Sin pesajes
  const empty = bodyweightSeries(mk());
  assert.deepEqual([empty.daily, empty.ma, empty.count, empty.trend.ok, empty.trend.label], [[], [], 0, false, 'Datos insuficientes']);
});

// ---------------------------------------------------------------------------
// Adherencia
// ---------------------------------------------------------------------------

const tplMap = () => new Map(SEED_TEMPLATES.map((t) => [t.id, { ...deepClone(t), archived: false }]));
const seedExMap = () => new Map(SEED_EXERCISES.map((e) => [e.id, e]));
/** Sesión de fuerza de una plantilla precargada; `only` = índices de ítems registrados (null = todos). */
function tplSession(id, templateId, date, only = null, extra = {}) {
  const tpl = SEED_TEMPLATES.find((t) => t.id === templateId);
  return {
    ...ses(id, date, [], extra), templateId, templateName: tpl.name,
    exercises: tpl.items.map((it, i) => ({ id: `${id}_se${i}`, exerciseId: it.exerciseId, exName: it.exerciseId, templateItemId: it.id, sets: !only || only.includes(i) ? [set(50, 5)] : [] })),
  };
}

function adherenceData(extra = {}) {
  return {
    sessions: [
      tplSession('d1', 'tpl_d1', '2026-09-14'), // lunes: D1 completo → hecho
      tplSession('d2', 'tpl_d2', '2026-09-15', [0, 1, 2]), // martes: D2 a medias → parcial
      // miércoles D3, jueves D4 y sábado D6 sin nada → saltados
      act('run1', 'run', '2026-09-20'), // domingo (descanso) → extra
      tplSession('d1b', 'tpl_d1', '2026-09-21'), // semana actual: lunes hecho
      tplSession('d2b', 'tpl_d2', '2026-09-22', [], { status: 'active' }),
    ],
    exercises: seedExMap(), templates: tplMap(), plan: new Map([['2026-09-23', { id: '2026-09-23', kind: 'rest', updatedAt: 1 }]]),
    settings: defaultSettings(), bodyweight: [], today: TODAY, ...extra,
  };
}

test('adherenceSeries coincide con plan.adherence (el mismo cálculo que el Calendario)', () => {
  const data = adherenceData();
  const rows = adherenceSeries(data, '2026-09-07', TODAY);
  const planArr = [...data.plan.values()];
  const ctx = makeCtx({ ...data, plan: planArr, since: trackingSince({ sessions: data.sessions, plan: planArr }) });
  assert.deepEqual(rows.map((r) => r.week), ['2026-09-07', '2026-09-14', '2026-09-21']);
  for (const r of rows) {
    const { week, label, ...rest } = r;
    assert.deepEqual(rest, adherence(week, ctx), week);
  }
  const [w0, w1, w2] = rows;
  // Semana del 7: anterior al primer registro → nada planificado.
  assert.equal(w0.planned, 0);
  assert.deepEqual([w1.planned, w1.done, w1.partial, w1.skipped, w1.completed, w1.extra, w1.pct], [5, 1, 1, 3, 2, 1, 40]);
  assert.equal(w1.label, '2 de 5 hechas · 1 parcial · 3 saltadas · 1 extra');
  // Semana actual: lunes hecho, martes saltado (la sesión sigue en curso), miércoles pasado a descanso, jueves (hoy) y sábado pendientes.
  assert.deepEqual([w2.planned, w2.done, w2.skipped, w2.pending], [4, 1, 1, 2]);
  const tot = adherenceTotals(rows);
  assert.deepEqual([tot.planned, tot.completed, tot.pending, tot.pct, tot.pctPast], [9, 3, 2, 33, 43]);
  // Por defecto: desde el inicio del registro hasta esta semana.
  assert.deepEqual(adherenceSeries(data).map((r) => r.week), ['2026-09-14', '2026-09-21']);
});

test('adherenceSeries: createdAt (instalación) y planCtx dan el mismo inicio que el Calendario', () => {
  const createdAt = tsFromDate('2026-09-07', 10);
  const data = adherenceData({ createdAt });
  const [w0] = adherenceSeries(data, '2026-09-07', '2026-09-07');
  assert.deepEqual([w0.planned, w0.skipped], [5, 5]); // desde la instalación los días sin sesión son saltados
  const planArr = [...data.plan.values()];
  const planCtx = makeCtx({ ...data, plan: planArr, since: trackingSince({ createdAt, sessions: data.sessions, plan: planArr }) });
  const viaCtx = adherenceSeries({ ...adherenceData(), planCtx }, '2026-09-07', TODAY);
  assert.deepEqual(viaCtx, adherenceSeries(data, '2026-09-07', TODAY));
  assert.deepEqual(adherenceSeries({ ...adherenceData(), since: '2026-09-07' }, '2026-09-07', '2026-09-07')[0].planned, 5);
});

// ---------------------------------------------------------------------------
// Índice, rango y rendimiento
// ---------------------------------------------------------------------------

test('dataRange e índice: se reutiliza con el mismo objeto y se reconstruye si cambian los datos', () => {
  const data = weekData();
  data.bodyweight = [{ id: '2026-08-20', kg: 75 }, { id: '2026-09-20', kg: 76 }];
  assert.deepEqual(dataRange(data), { first: '2026-08-20', last: '2026-09-22', firstSession: '2026-09-01', lastSession: '2026-09-22', firstBodyweight: '2026-08-20', lastBodyweight: '2026-09-20' });
  const a = strengthRecords(data);
  const b = strengthRecords(data);
  assert.equal(a[0], b[0]); // mismo índice: mismos objetos
  data.sessions.push(ses('s9', '2026-09-23', [['bench', [set(90, 5)]]]));
  const c = strengthRecords(data);
  assert.notEqual(c.find((r) => r.exerciseId === 'bench'), a.find((r) => r.exerciseId === 'bench'));
  assert.equal(c.find((r) => r.exerciseId === 'bench').bestWeight.value, 90);
  const idx = buildIndex(data);
  assert.equal(typeof idx, 'object');
  assert.deepEqual(dataRange(mk()), { first: null, last: null, firstSession: null, lastSession: null, firstBodyweight: null, lastBodyweight: null });
});

/** ≈ 2 años: 500 sesiones de fuerza × 25 series (5 de calentamiento), 300 actividades y 730 pesajes. */
function bigData() {
  const start = '2024-09-23';
  const lib = SEED_EXERCISES.filter((e) => e.logType !== 'cardio');
  const sessions = [];
  for (let i = 0; i < 500; i++) {
    const date = addDays(start, Math.floor(i * 1.46));
    const exercises = [];
    for (let k = 0; k < 5; k++) {
      const ex = lib[(i * 5 + k * 7) % lib.length];
      const base = 20 + ((i + k * 13) % 60);
      const sets = [warm(base / 2, 10)];
      for (let j = 0; j < 4; j++) {
        sets.push(set(ex.logType === 'bodyweight' ? (j % 3) * 5 - 5 : base + (i % 10) * 0.5, 5 + ((i + j) % 8), {
          rir: (i + j) % 4, repsR: ex.logType === 'unilateral' ? 6 + (j % 3) : null,
          timeSec: ex.logType === 'time' ? 30 + j * 10 : null, distanceM: ex.logType === 'distance_time' ? 20 + (j % 2) * 10 : null,
          heightCm: ex.logType === 'jumps' ? 35 + (i % 15) : null,
        }));
      }
      exercises.push([ex.id, sets]);
    }
    sessions.push(ses(`s${i}`, date, exercises, { rpe: 6 + (i % 4), durationMin: 50 + (i % 30) }));
  }
  const kinds = ['run', 'bike', 'swim', 'other'];
  for (let i = 0; i < 300; i++) {
    const kind = kinds[i % 4];
    sessions.push(act(`a${i}`, kind, addDays(start, Math.floor(i * 2.43)), {
      distanceKm: kind === 'other' ? null : kind === 'swim' ? 1 + (i % 5) * 0.25 : 5 + (i % 17), movingSec: 1500 + (i % 40) * 60, rpe: 3 + (i % 6),
    }));
  }
  const bodyweight = Array.from({ length: 730 }, (_, i) => ({ id: addDays(start, i), kg: 74 + (i % 30) / 10 }));
  return { sessions, exercises: seedExMap(), templates: tplMap(), plan: new Map(), settings: defaultSettings(), bodyweight, today: TODAY };
}

test('rendimiento: 2 años de datos (500 sesiones × 25 series) → weeklySeries + strengthRecords < 300 ms', () => {
  const data = bigData();
  const t0 = performance.now();
  const rows = weeklySeries(data);
  const recs = strengthRecords(data);
  const ms = performance.now() - t0;
  assert.ok(rows.length >= 104, `${rows.length} semanas`);
  assert.ok(recs.length > 20);
  assert.ok(ms < 300, `weeklySeries + strengthRecords: ${ms.toFixed(1)} ms`);
  // Coherencia con calc en datos grandes: carga total y volumen.
  const done = data.sessions.filter((s) => s.status === 'done');
  assert.equal(rows.reduce((t, r) => t + r.loadTotal, 0), done.reduce((t, s) => t + (sessionLoad(s) || 0), 0));
  const bwFn = makeBodyweightFn(data.bodyweight, 75);
  const vol = done.filter((s) => s.kind === 'strength').reduce((t, s) => t + sessionVolume(s, data.exercises, bwFn), 0);
  close(rows.reduce((t, r) => t + r.strengthVolume, 0), vol, 1e-3);
  // El resto de la pantalla de Progreso también va holgado.
  const t1 = performance.now();
  const [top] = exercisesWithHistory(data);
  exerciseSeries(data, top.exerciseId);
  exerciseHistory(data, top.exerciseId);
  enduranceRecords(data);
  runPaceSeries(data);
  bodyweightSeries(data);
  muscleWeekly(data, 'back');
  muscleTable(data);
  weeklyAverage(data, null, null, 'loadTotal');
  const ms2 = performance.now() - t1;
  assert.ok(ms2 < 300, `resto de estadísticas: ${ms2.toFixed(1)} ms`);
  const t2 = performance.now();
  const adh = adherenceSeries(data);
  const ms3 = performance.now() - t2;
  assert.ok(adh.length >= 104);
  assert.ok(ms3 < 500, `adherencia de 2 años: ${ms3.toFixed(1)} ms`);
});

test('weekStart de las semanas: siempre lunes', () => {
  for (const r of weeklySeries(weekData(), '2026-08-01', TODAY)) assert.equal(weekStart(r.week), r.week);
});
