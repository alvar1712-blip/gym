// Pruebas de las marcas históricas y de la comparación «ahora frente a antes» (js/past-records-logic.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARK_LOG_TYPES, CURRENT_DAYS, markable, comparableType, normalizePastRecord, normalizePastRecords, validatePastRecord,
  pastRecordFrom, markLabel, markWhen, markBodyweight, markEstimate, exerciseRecovery, recoveryLine, recoveryWhy, groupByExercise,
} from '../../js/past-records-logic.js';
import { e1rm, E1RM_MAX_REPS } from '../../js/calc.js';
import { exerciseHistory } from '../../js/stats.js';

const TODAY = '2026-10-02';
const BENCH = { id: 'press_banca', name: 'Press banca', logType: 'weight_reps', pattern: 'push_h' };
const ROW = { id: 'remo_unilateral', name: 'Remo unilateral', logType: 'unilateral', pattern: 'pull_h' };
const PULL = { id: 'dominadas', name: 'Dominadas', logType: 'bodyweight', pattern: 'pull_v' };
const WHEEL = { id: 'rueda', name: 'Rueda abdominal', logType: 'bodyweight', pattern: 'core' };
const PLANK = { id: 'plancha', name: 'Plancha', logType: 'time', pattern: 'core' };
const mark = (o = {}) => ({ id: 'pr_1', exerciseId: 'press_banca', weight: 100, reps: 5, rir: null, date: { date: '2025-06-01', precision: 'season' }, beforeApp: true, bodyweightKg: null, note: '', createdAt: 1, updatedAt: 1, ...o });
const entry = (date, e1, extra = {}) => ({ date, e1rm: e1, sessionId: `s_${date}`, e1rmSet: { weight: 80, reps: 8, rir: 2 }, ...extra });

test('qué ejercicios admiten marca y cuáles se pueden comparar', () => {
  assert.deepEqual(MARK_LOG_TYPES, ['weight_reps', 'unilateral', 'bodyweight']);
  assert.equal(CURRENT_DAYS, 28);
  assert.equal(E1RM_MAX_REPS, 12);
  for (const ex of [BENCH, ROW, PULL, WHEEL]) assert.equal(markable(ex), true, ex.id);
  assert.equal(markable(PLANK), false);
  assert.equal(markable(null), false);
  assert.equal(comparableType(BENCH), true);
  assert.equal(comparableType(PULL), true);
  assert.equal(comparableType(WHEEL), false, 'core de peso corporal: sin 1RM estimado');
});

test('validación del formulario', () => {
  const ok = { exerciseId: 'press_banca', weight: 100, reps: 5, rir: null, date: null };
  assert.deepEqual(validatePastRecord(ok, BENCH, TODAY), {});
  assert.equal(validatePastRecord({ ...ok, exerciseId: null }, null, TODAY).exercise, 'Elige el ejercicio.');
  assert.equal(validatePastRecord({ ...ok, exerciseId: 'plancha' }, PLANK, TODAY).exercise, 'Este ejercicio no se registra con peso y repeticiones.');
  assert.equal(validatePastRecord({ ...ok, weight: null }, BENCH, TODAY).weight, 'Escribe el peso (kg).');
  assert.equal(validatePastRecord({ ...ok, weight: 0 }, BENCH, TODAY).weight, 'Escribe el peso (kg).');
  assert.equal(validatePastRecord({ ...ok, weight: 1001 }, BENCH, TODAY).weight, 'Como mucho 1000 kg.');
  for (const reps of [0, 51, 2.5, null]) assert.equal(validatePastRecord({ ...ok, reps }, BENCH, TODAY).reps, 'Repeticiones: de 1 a 50.', String(reps));
  assert.equal(validatePastRecord({ ...ok, rir: 6 }, BENCH, TODAY).rir, 'RIR: de 0 a 5.');
  assert.deepEqual(validatePastRecord({ ...ok, rir: 0 }, BENCH, TODAY), {});
  assert.equal(validatePastRecord({ ...ok, date: { date: '2026-11-01', precision: 'month' } }, BENCH, TODAY).date, 'La fecha no puede ser futura.');
  assert.deepEqual(validatePastRecord({ ...ok, date: { date: '2026-10-01', precision: 'month' } }, BENCH, TODAY), {}, 'el mes en curso vale');
  assert.equal(validatePastRecord({ ...ok, date: { date: 'nope', precision: 'day' } }, BENCH, TODAY).date, 'Fecha no válida.');
  // Peso corporal: el lastre es opcional (0 = sin lastre, negativo = asistencia) y el peso de entonces, opcional
  assert.deepEqual(validatePastRecord({ ...ok, exerciseId: 'dominadas', weight: null }, PULL, TODAY), {});
  assert.deepEqual(validatePastRecord({ ...ok, exerciseId: 'dominadas', weight: -20 }, PULL, TODAY), {});
  assert.match(validatePastRecord({ ...ok, exerciseId: 'dominadas', weight: -201 }, PULL, TODAY).weight, /^Lastre/);
  assert.match(validatePastRecord({ ...ok, exerciseId: 'dominadas', weight: 10, bodyweightKg: 15 }, PULL, TODAY).bodyweightKg, /^Peso corporal: de 20 a 400/);
  assert.deepEqual(validatePastRecord({ ...ok, exerciseId: 'dominadas', weight: 10, bodyweightKg: 74.5 }, PULL, TODAY), {});
});

test('registro guardado y lectura saneada (también de copias o datos raros)', () => {
  const rec = pastRecordFrom({ exerciseId: 'press_banca', weight: 100, reps: 5, rir: 2, date: { date: '2025-07-15', precision: 'season' }, beforeApp: true, note: '  en mi antiguo gimnasio ', bodyweightKg: 80 }, BENCH, { id: 'pr_x', now: 5 });
  assert.deepEqual(rec, {
    id: 'pr_x', exerciseId: 'press_banca', weight: 100, reps: 5, rir: 2, date: { date: '2025-06-01', precision: 'season' }, beforeApp: true,
    bodyweightKg: null, note: 'en mi antiguo gimnasio', createdAt: 5, updatedAt: 5,
  }, 'fecha normalizada al inicio del periodo; sin peso corporal fuera de los ejercicios de peso corporal');
  const edited = pastRecordFrom({ exerciseId: 'dominadas', weight: null, reps: 12, rir: null, date: null, beforeApp: false, bodyweightKg: 74 }, PULL, { id: 'pr_y', now: 9, createdAt: 3 });
  assert.deepEqual([edited.weight, edited.date, edited.beforeApp, edited.bodyweightKg, edited.createdAt, edited.updatedAt], [0, null, false, 74, 3, 9]);
  // Lectura: campos de menos o de más
  assert.equal(normalizePastRecord(null), null);
  assert.equal(normalizePastRecord({ id: 'a', exerciseId: 'x', weight: 50 }), null, 'sin reps');
  assert.equal(normalizePastRecord({ id: 'a', exerciseId: 'x', weight: '50', reps: 5 }), null, 'peso no numérico');
  const n = normalizePastRecord({ id: 'a', exerciseId: 'x', weight: 50, reps: 5, rir: 9, date: '2024-03-10', bodyweightKg: 5, extra: 1 });
  assert.deepEqual(n, { id: 'a', exerciseId: 'x', weight: 50, reps: 5, rir: null, date: { date: '2024-03-10', precision: 'day' }, beforeApp: true, bodyweightKg: null, note: '', createdAt: null, updatedAt: null });
  assert.equal(normalizePastRecords([n, null, { id: 'b' }]).length, 1);
});

test('textos de una marca', () => {
  assert.equal(markLabel(mark(), 'weight_reps'), '100 kg × 5');
  assert.equal(markLabel(mark({ weight: 102.5, rir: 1 }), 'weight_reps'), '102,5 kg × 5 @1');
  assert.equal(markLabel(mark({ weight: 32, reps: 8 }), 'unilateral'), '32 kg × 8 por lado');
  assert.equal(markLabel(mark({ weight: 10, reps: 6 }), 'bodyweight'), '+10 kg × 6');
  assert.equal(markLabel(mark({ weight: 0, reps: 12 }), 'bodyweight'), '12 reps sin lastre');
  assert.match(markLabel(mark({ weight: -20, reps: 8 }), 'bodyweight'), /^−20 kg.* × 8$/);
  assert.equal(markWhen(mark()), 'verano 2025');
  assert.equal(markWhen(mark({ date: { date: '2024-01-01', precision: 'year' } })), '2024');
  assert.equal(markWhen(mark({ date: null })), 'sin fecha');
});

test('peso corporal de una marca: la marca → pesaje cercano → contexto → peso actual → por defecto', () => {
  const bodyweight = [{ id: '2025-05-20', kg: 78 }, { id: '2025-08-10', kg: 79 }, { id: '2026-09-30', kg: 74 }];
  const context = [
    { id: 'c1', kind: 'event', type: 'usual_weight', date: { date: '2024-01-01', precision: 'year' }, kg: 80 },
    { id: 'c2', kind: 'event', type: 'weight', date: { date: '2023-03-01', precision: 'month' }, kg: 82 },
  ];
  const env = { bodyweight, context, fallbackKg: 75 };
  assert.deepEqual(markBodyweight(mark({ bodyweightKg: 77 }), env), { kg: 77, source: 'record' });
  // verano 2025 (1 jun – 31 ago): el pesaje más cercano a la mitad (16 jul) dentro del periodo ± 14 días
  assert.deepEqual(markBodyweight(mark(), env), { kg: 79, source: 'log', date: '2025-08-10' });
  // marzo 2023: sin pesajes; un peso en esa fecha en el contexto
  assert.deepEqual(markBodyweight(mark({ date: { date: '2023-03-01', precision: 'month' } }), env), { kg: 82, source: 'context', date: '2023-03-01' });
  // 2024 (año): sin pesajes ni peso puntual cerca; el peso habitual apuntado
  assert.deepEqual(markBodyweight(mark({ date: { date: '2024-06-01', precision: 'month' } }), env), { kg: 80, source: 'context', date: '2024-01-01' });
  // 2020: nada de entonces (el peso habitual es de después) → el último pesaje, y se dice
  assert.deepEqual(markBodyweight(mark({ date: { date: '2020-01-01', precision: 'year' } }), env), { kg: 74, source: 'current', date: '2026-09-30' });
  assert.deepEqual(markBodyweight(mark({ date: null }), env), { kg: 74, source: 'current', date: '2026-09-30' }, 'sin fecha');
  assert.deepEqual(markBodyweight(mark({ date: null }), { fallbackKg: 72 }), { kg: 72, source: 'default' });
});

test('1RM estimado de una marca: el mismo cálculo que en las sesiones (Epley, reps + RIR, 1–12 reps)', () => {
  assert.equal(markEstimate(mark(), BENCH).e1rm, e1rm(100, 5, null));
  assert.equal(markEstimate(mark({ rir: 2 }), BENCH).e1rm, e1rm(100, 5, 2));
  assert.ok(Math.abs(markEstimate(mark(), BENCH).e1rm - 116.667) < 0.01);
  const high = markEstimate(mark({ reps: 15 }), BENCH);
  assert.deepEqual([high.e1rm, high.reason], [null, 'reps']);
  assert.equal(markEstimate(mark({ exerciseId: 'remo_unilateral', weight: 32, reps: 8 }), ROW).e1rm, e1rm(32, 8));
  // Peso corporal: (peso de entonces + lastre)
  const pu = markEstimate(mark({ exerciseId: 'dominadas', weight: 10, reps: 6, bodyweightKg: 80 }), PULL);
  assert.equal(pu.load, 90);
  assert.equal(pu.e1rm, e1rm(90, 6));
  assert.deepEqual(pu.bw, { kg: 80, source: 'record' });
  const wheel = markEstimate(mark({ exerciseId: 'rueda', weight: 0, reps: 10 }), WHEEL);
  assert.deepEqual([wheel.e1rm, wheel.reason], [null, 'type']);
});

test('recuperación: ahora (28 días) frente a la mejor marca histórica', () => {
  const marks = [mark(), mark({ id: 'pr_2', weight: 90, reps: 8, date: { date: '2024-01-01', precision: 'year' } }), mark({ id: 'pr_3', exerciseId: 'otro' })];
  const history = [entry('2026-08-01', 95), entry('2026-09-10', 100), entry('2026-09-28', 105.5), entry('2026-10-01', 103)];
  const r = exerciseRecovery({ exercise: BENCH, marks, history, today: TODAY });
  assert.equal(r.status, 'ok');
  assert.equal(r.since, '2026-09-05', '28 días contando hoy');
  assert.equal(r.current.date, '2026-09-28', 'el mejor de la ventana, no el último');
  assert.equal(r.appBefore.e1rm, 95, 'lo de Entreno antes de la ventana');
  assert.equal(r.marks.length, 2, 'solo las de este ejercicio');
  assert.equal(r.bestMark.record.id, 'pr_1', '100 × 5 (116,7) supera a 90 × 8 (114)');
  assert.equal(r.reference.source, 'mark');
  assert.equal(r.pct, Math.round((105.5 / e1rm(100, 5)) * 100));
  assert.equal(r.pct, 90);
  assert.equal(recoveryLine(r), 'Rendimiento actual ≈ 90 % de tu mejor marca histórica.');
  // ¿Por qué?: los datos concretos y que es una estimación
  const why = recoveryWhy(r, BENCH, { setLabel: () => '80 kg × 8 @2', today: TODAY });
  assert.deepEqual(why.rows.map((x) => x.label), ['Ahora', 'Mejor marca histórica', 'Cálculo']);
  assert.equal(why.rows[0].value, '105,5 kg · 80 kg × 8 @2 · 28 sep');
  assert.equal(why.rows[1].value, '116,7 kg · 100 kg × 5 · verano 2025');
  assert.equal(why.rows[1].sub, 'introducida a mano · anterior a Entreno');
  assert.equal(why.rows[2].value, '105,5 ÷ 116,7 = 90 %');
  assert.ok(why.notes.some((n) => /Epley/.test(n) && /estimación/.test(n)));
  assert.ok(why.notes.includes('La marca no tiene RIR apuntado: se cuenta como serie al fallo (RIR 0).'));
  assert.ok(why.notes.includes('Fecha aproximada (verano 2025).'));
});

test('recuperación: si lo de Entreno de antes supera a la marca manual, la referencia es eso (y se dice)', () => {
  const history = [entry('2025-11-01', 125), entry('2026-09-20', 110)];
  const r = exerciseRecovery({ exercise: BENCH, marks: [mark()], history, today: TODAY });
  assert.equal(r.reference.source, 'app');
  assert.equal(r.reference.e1rm, 125);
  assert.equal(r.pct, 88);
  assert.equal(recoveryLine(r), 'Rendimiento actual ≈ 88 % de tu mejor marca anterior en Entreno.');
  const why = recoveryWhy(r, BENCH, { setLabel: () => 'x', today: TODAY });
  assert.equal(why.rows[1].label, 'Mejor marca anterior en Entreno');
  // Sin marcas manuales, con historial anterior: también compara
  assert.equal(exerciseRecovery({ exercise: BENCH, marks: [], history, today: TODAY }).pct, 88);
});

test('recuperación: superada, a la altura, sin datos actuales, sin referencia y no comparable', () => {
  const over = exerciseRecovery({ exercise: BENCH, marks: [mark()], history: [entry('2026-09-30', 120)], today: TODAY });
  assert.equal(over.pct, 103);
  assert.equal(recoveryLine(over), 'Rendimiento actual ≈ 103 % de tu mejor marca histórica: ya la has superado.');
  const same = exerciseRecovery({ exercise: BENCH, marks: [mark()], history: [entry('2026-09-30', e1rm(100, 5))], today: TODAY });
  assert.equal(recoveryLine(same), 'Rendimiento actual ≈ 100 % de tu mejor marca histórica: estás a su altura.');
  // Sin series en los últimos 28 días
  const old = exerciseRecovery({ exercise: BENCH, marks: [mark()], history: [entry('2026-09-04', 100)], today: TODAY });
  assert.equal(old.status, 'no_current');
  assert.equal(old.pct, null);
  assert.equal(old.reference.source, 'mark');
  assert.match(recoveryLine(old), /^Sin series de 1–12 repeticiones en las últimas 4 semanas/);
  const never = exerciseRecovery({ exercise: BENCH, marks: [mark()], history: [], today: TODAY });
  assert.equal(never.status, 'no_current');
  assert.match(recoveryLine(never), /^Cuando registres este ejercicio/);
  // Sin marcas ni historial anterior: nada que comparar (ni texto)
  const none = exerciseRecovery({ exercise: BENCH, marks: [], history: [entry('2026-09-30', 100)], today: TODAY });
  assert.equal(none.status, 'no_reference');
  assert.equal(recoveryLine(none), null);
  // Marca de más de 12 repeticiones y nada más: no se compara (sin precisión falsa)
  const reps = exerciseRecovery({ exercise: BENCH, marks: [mark({ reps: 20, weight: 60 })], history: [entry('2026-09-30', 100)], today: TODAY });
  assert.deepEqual([reps.status, reps.reason], ['not_comparable', 'reps']);
  assert.match(recoveryLine(reps), /más de 12 repeticiones/);
  // Core de peso corporal
  const wheel = exerciseRecovery({ exercise: WHEEL, marks: [mark({ exerciseId: 'rueda', weight: 0, reps: 10 })], history: [], today: TODAY });
  assert.deepEqual([wheel.status, wheel.reason], ['not_comparable', 'type']);
  // Un ejercicio que ya no es de peso y reps (se cambió su tipo): la marca sigue, pero no se compara
  const plank = exerciseRecovery({ exercise: PLANK, marks: [mark({ exerciseId: 'plancha' })], history: [], today: TODAY });
  assert.deepStrictEqual([plank.status, plank.reason], ['not_comparable', 'logtype']);
  assert.equal(recoveryLine(plank), 'Este ejercicio ya no se registra con peso y repeticiones: la marca se guarda, pero no se compara.');
  // La ventana se puede cambiar
  assert.equal(exerciseRecovery({ exercise: BENCH, marks: [mark()], history: [entry('2026-09-04', 100)], today: TODAY, days: 60 }).status, 'ok');
});

test('recuperación con lo registrado de verdad (stats.exerciseHistory) y una marca de peso corporal', () => {
  const ses = (id, date, exerciseId, sets) => ({
    id, kind: 'strength', status: 'done', date, startedAt: null, exercises: [{ exerciseId, sets: sets.map(([weight, reps, rir], i) => ({ id: `${id}_${i}`, weight, reps, rir, type: 'effective', done: true })) }],
  });
  const data = {
    sessions: [
      ses('a', '2026-09-15', 'dominadas', [[0, 10, 1], [5, 6, 1]]),
      ses('b', '2026-09-29', 'dominadas', [[10, 5, 1]]),
    ],
    exercises: new Map([[PULL.id, PULL]]),
    settings: { bodyweightDefault: 75 },
    bodyweight: [{ id: '2026-09-01', kg: 72 }],
    today: TODAY,
  };
  const history = exerciseHistory(data, 'dominadas', { labels: false });
  const marks = [mark({ exerciseId: 'dominadas', weight: 20, reps: 5, rir: 1, date: { date: '2024-03-01', precision: 'month' }, bodyweightKg: 78 })];
  const r = exerciseRecovery({ exercise: PULL, marks, history, today: TODAY, env: { bodyweight: data.bodyweight, context: [], fallbackKg: 75 } });
  assert.equal(r.status, 'ok');
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
  near(r.current.e1rm, e1rm(72 + 10, 5, 1), 'ahora: 72 kg (pesaje) + 10 de lastre × 5 @1');
  near(r.reference.e1rm, e1rm(78 + 20, 5, 1), 'entonces: 78 kg (apuntado en la marca) + 20 × 5 @1');
  assert.equal(r.pct, Math.round((e1rm(82, 5, 1) / e1rm(98, 5, 1)) * 100));
  const why = recoveryWhy(r, PULL, { setLabel: () => '+10 kg × 5 @1', today: TODAY });
  assert.ok(why.notes.includes('Peso corporal de entonces: 78 kg, el que apuntaste en la marca.'));
  assert.ok(why.notes.includes('En Entreno, el peso corporal de cada día sale de tus pesajes.'));
});

test('lista agrupada por ejercicio, de la más reciente a la más antigua (sin fecha al final)', () => {
  const g = groupByExercise([
    mark({ id: 'a', date: { date: '2024-01-01', precision: 'year' } }),
    mark({ id: 'b', date: null }),
    mark({ id: 'c', date: { date: '2025-06-01', precision: 'season' } }),
    mark({ id: 'd', exerciseId: 'dominadas', weight: 0, reps: 12 }),
    { id: 'roto' },
  ]);
  assert.deepEqual(g.map((x) => [x.exerciseId, x.records.map((r) => r.id)]), [['press_banca', ['c', 'a', 'b']], ['dominadas', ['d']]]);
});
