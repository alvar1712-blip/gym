import test from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, setMetrics, muscleContrib, movingAverage, linearRegression, riegel, detectPRs, bestsForExercise, sessionLoad, lastPerformance, sessionPRs } from '../../js/calc.js';

test('e1rm: Epley con reps + RIR, solo 1–12 reps', () => {
  assert.equal(e1rm(100, 5, 0), 100 * (1 + 5 / 30));
  assert.equal(e1rm(100, 5, 2), 100 * (1 + 7 / 30));
  assert.equal(e1rm(100, 5, 'F'), 100 * (1 + 5 / 30));
  assert.equal(e1rm(100, 1, 0), 100);
  assert.equal(e1rm(100, 13, 0), null);
  assert.equal(e1rm(0, 5, 0), null);
  assert.equal(e1rm(100, 0, 0), null);
});

test('setMetrics por tipo de registro', () => {
  const wr = { logType: 'weight_reps' };
  assert.deepEqual(setMetrics({ weight: 80, reps: 6, rir: 1 }, wr), { load: 80, reps: 6, e1rm: 80 * (1 + 7 / 30), volume: 480 });
  const uni = { logType: 'unilateral' };
  const m = setMetrics({ weight: 20, reps: 10, repsR: 8, rir: 2 }, uni);
  assert.equal(m.volume, 360);
  assert.equal(m.reps, 8);
  const bw = { logType: 'bodyweight' };
  const b = setMetrics({ weight: 10, reps: 8, rir: 1 }, bw, 75);
  assert.equal(b.load, 85);
  assert.equal(b.volume, 680);
  assert.equal(setMetrics({ timeSec: 60 }, { logType: 'time' }).e1rm, null);
});

test('muscleContrib: 1 principal, 0,5 secundario (editable)', () => {
  const ex = { primary: ['chest'], secondary: ['triceps', 'frontdelt'] };
  assert.deepEqual(muscleContrib(ex, { secondaryFactor: 0.5 }), { chest: 1, triceps: 0.5, frontdelt: 0.5 });
  assert.deepEqual(muscleContrib(ex, { secondaryFactor: 0.25, primaryFactor: 1 }), { chest: 1, triceps: 0.25, frontdelt: 0.25 });
});

test('media móvil de 7 días naturales', () => {
  const pts = [
    { date: '2026-09-01', value: 75 }, { date: '2026-09-02', value: 76 }, { date: '2026-09-09', value: 74 },
  ];
  const ma = movingAverage(pts, 7);
  assert.equal(ma[1].ma, 75.5);
  assert.equal(ma[2].ma, 74); // 9-sep: ventana 3–9 sep
});

test('regresión y Riegel', () => {
  const r = linearRegression([0, 1, 2, 3], [1, 3, 5, 7]);
  assert.equal(r.slope, 2);
  assert.equal(r.intercept, 1);
  assert.ok(Math.abs(riegel(1500, 5, 10) - 1500 * 2 ** 1.06) < 1e-9);
});

test('carga = duración × RPE', () => {
  assert.equal(sessionLoad({ kind: 'strength', durationMin: 60, rpe: 7 }), 420);
  assert.equal(sessionLoad({ kind: 'run', movingSec: 1800, rpe: 5 }), 150);
  assert.equal(sessionLoad({ kind: 'run', movingSec: 1800, rpe: null }), null);
});

test('récords: sin historial no hay PR; con historial detecta peso, 1RM y reps', () => {
  const ex = { id: 'bench', logType: 'weight_reps' };
  const hist = [{ id: 'a', kind: 'strength', date: '2026-09-01', exercises: [{ exerciseId: 'bench', sets: [
    { id: 'x1', type: 'warmup', weight: 100, reps: 10, done: true },
    { id: 'x2', type: 'effective', weight: 80, reps: 6, rir: 1, done: true },
  ] }] }];
  const bests = bestsForExercise(hist, 'bench', ex);
  assert.equal(bests.maxWeight, 80, 'el calentamiento no cuenta');
  assert.deepEqual(detectPRs({ type: 'effective', weight: 80, reps: 6, rir: 1, done: true }, ex, bests), []);
  const prs = detectPRs({ type: 'effective', weight: 82.5, reps: 6, rir: 1, done: true }, ex, bests).map((p) => p.kind);
  assert.deepEqual(prs, ['weight', 'e1rm']);
  const reps = detectPRs({ type: 'effective', weight: 80, reps: 7, rir: 1, done: true }, ex, bests).map((p) => p.kind);
  assert.deepEqual(reps, ['e1rm', 'reps']);
  assert.deepEqual(detectPRs({ type: 'effective', weight: 90, reps: 3, done: true }, ex, bestsForExercise([], 'bench', ex)), []);
});

test('lastPerformance y sessionPRs', () => {
  const exMap = new Map([['bench', { id: 'bench', logType: 'weight_reps' }]]);
  const s1 = { id: 's1', kind: 'strength', date: '2026-09-01', startedAt: 1, exercises: [{ exerciseId: 'bench', sets: [{ id: 'a', type: 'effective', weight: 80, reps: 6, done: true }] }] };
  const s2 = { id: 's2', kind: 'strength', date: '2026-09-05', startedAt: 2, exercises: [{ exerciseId: 'bench', sets: [
    { id: 'b', type: 'effective', weight: 82.5, reps: 5, done: true },
    { id: 'c', type: 'effective', weight: 82.5, reps: 5, done: true },
    { id: 'd', type: 'effective', weight: 82.5, reps: 6, done: true },
  ] }] };
  assert.equal(lastPerformance([s1, s2], 'bench', { excludeSessionId: 's2' }).session.id, 's1');
  assert.equal(lastPerformance([s1, s2], 'bench').session.id, 's2');
  const prs = sessionPRs(s2, [s1, s2], exMap);
  assert.deepEqual(prs.get('b').map((p) => p.kind), ['weight', 'e1rm']);
  assert.equal(prs.get('c'), undefined);
  assert.deepEqual(prs.get('d').map((p) => p.kind), ['e1rm', 'reps']);
});
