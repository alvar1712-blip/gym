import test from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, setMetrics, muscleContrib, movingAverage, linearRegression, riegel, detectPRs, bestsForExercise, sessionLoad, lastPerformance, sessionPRs, addToBests, makeBodyweightFn, bestSet, sessionVolume } from '../../js/calc.js';

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

test('setMetrics: peso corporal de core (rueda, elevaciones de piernas, crunch) no cuenta el peso corporal', () => {
  const core = { logType: 'bodyweight', pattern: 'core' };
  // Sin lastre: sin carga, sin 1RM y sin volumen (antes: 75 kg × 10 = 750 kg y un «1RM» de 111 kg)
  assert.deepEqual(setMetrics({ weight: null, reps: 10, rir: 2 }, core, 75), { load: null, reps: 10, e1rm: null, volume: null });
  assert.deepEqual(setMetrics({ weight: 0, reps: 12, rir: 1 }, core, 75), { load: null, reps: 12, e1rm: null, volume: null });
  // Con lastre: carga y volumen = lastre (× reps); el 1RM sigue sin aplicar
  assert.deepEqual(setMetrics({ weight: 5, reps: 10, rir: 1 }, core, 75), { load: 5, reps: 10, e1rm: null, volume: 50 });
  // Asistencia (negativa) en core: no es carga
  assert.deepEqual(setMetrics({ weight: -10, reps: 8 }, core, 75), { load: null, reps: 8, e1rm: null, volume: null });
  // Los demás ejercicios de peso corporal (dominadas, fondos…) siguen sumando el peso corporal
  const pull = { logType: 'bodyweight', pattern: 'pull_v' };
  assert.equal(setMetrics({ weight: null, reps: 8, rir: 1 }, pull, 75).load, 75);
  assert.equal(setMetrics({ weight: null, reps: 8, rir: 1 }, pull, 75).volume, 600);
  assert.ok(setMetrics({ weight: null, reps: 8, rir: 1 }, pull, 75).e1rm > 75);
});

test('core con peso corporal: sin volumen ficticio ni récords de 1RM; sí récords de reps y de lastre', () => {
  const ex = { id: 'rueda_abdominal', logType: 'bodyweight', pattern: 'core' };
  const exMap = new Map([[ex.id, ex]]);
  const bwFn = () => 75;
  const mk = (id, date, sets) => ({ id, kind: 'strength', date, startedAt: Date.parse(date), exercises: [{ exerciseId: ex.id, sets }] });
  const set = (id, o) => ({ id, type: 'effective', done: true, weight: null, rir: 1, ...o });
  const s1 = mk('s1', '2026-09-01', [set('a', { reps: 10 })]);
  const s2 = mk('s2', '2026-09-08', [set('b', { reps: 12 }), set('c', { reps: 8, weight: 5 })]);
  assert.equal(sessionVolume(s1, exMap, bwFn), 0, 'sin lastre no hay volumen');
  assert.equal(sessionVolume(s2, exMap, bwFn), 40, 'solo el lastre: 5 kg × 8');
  const prs = sessionPRs(s2, [s1, s2], exMap, bwFn);
  assert.deepEqual(prs.get('b').map((p) => p.kind), ['reps'], 'más reps sin lastre: récord de reps, no de 1RM');
  assert.deepEqual(prs.get('c').map((p) => p.kind), ['weight'], 'primer lastre: récord de peso, no de 1RM');
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

test('récords: en la primera sesión con un ejercicio no hay récords (aunque una serie supere a otra del mismo día)', () => {
  const exMap = new Map([['bench', { id: 'bench', logType: 'weight_reps' }], ['sprint', { id: 'sprint', logType: 'distance_time' }]]);
  const first = { id: 's1', kind: 'strength', date: '2026-09-01', startedAt: 1, exercises: [
    { exerciseId: 'bench', sets: [
      { id: 'a', type: 'effective', weight: 60, reps: 5, done: true },
      { id: 'b', type: 'effective', weight: 70, reps: 5, done: true },
    ] },
    { exerciseId: 'sprint', sets: [
      { id: 'c', type: 'effective', distanceM: 20, timeSec: 3.4, done: true },
      { id: 'd', type: 'effective', distanceM: 20, timeSec: 3.1, done: true },
    ] },
  ] };
  assert.equal(sessionPRs(first, [first], exMap).size, 0);
  // Igual que hace la vista de sesión: bests del historial previo (vacío) + series de hoy.
  const ex = exMap.get('bench');
  const bests = bestsForExercise([], 'bench', ex);
  addToBests(bests, first.exercises[0].sets[0], ex);
  assert.deepEqual(detectPRs(first.exercises[0].sets[1], ex, bests), []);
  // En la segunda sesión sí: se compara con la primera y con las series previas del mismo día.
  const second = { id: 's2', kind: 'strength', date: '2026-09-05', startedAt: 2, exercises: [{ exerciseId: 'bench', sets: [
    { id: 'e', type: 'effective', weight: 72.5, reps: 5, done: true },
    { id: 'f', type: 'effective', weight: 75, reps: 5, done: true },
  ] }] };
  const prs = sessionPRs(second, [first, second], exMap);
  assert.deepEqual(prs.get('e').map((p) => p.kind), ['weight', 'e1rm']);
  assert.deepEqual(prs.get('f').map((p) => p.kind), ['weight', 'e1rm']);
});

test('récords en peso corporal: subir solo el peso corporal no es récord de 1RM', () => {
  const ex = { id: 'rueda', logType: 'bodyweight' };
  const exMap = new Map([['rueda', ex]]);
  const bwFn = makeBodyweightFn([{ id: '2026-09-24', kg: 75 }, { id: '2026-10-01', kg: 75.3 }]);
  const mk = (id, date, sets) => ({ id, kind: 'strength', date, startedAt: Date.parse(date), exercises: [{ exerciseId: 'rueda', sets }] });
  const s1 = mk('s1', '2026-09-24', [{ id: 'a', type: 'effective', weight: null, reps: 12, rir: 1, done: true }]);
  const same = mk('s2', '2026-10-01', [{ id: 'b', type: 'effective', weight: null, reps: 12, rir: 1, done: true }]);
  assert.equal(sessionPRs(same, [s1, same], exMap, bwFn).size, 0, 'mismas reps y lastre con +0,3 kg de peso corporal');
  const better = mk('s3', '2026-10-01', [{ id: 'c', type: 'effective', weight: null, reps: 12, rir: 2, done: true }]);
  assert.deepEqual(sessionPRs(better, [s1, better], exMap, bwFn).get('c').map((p) => p.kind), ['e1rm']);
  // Dominadas 0 × 8 @1: 75 → 77 kg sin cambiar la serie → sin récord; con +2,5 kg de lastre → récord.
  const bw2 = makeBodyweightFn([{ id: '2026-09-01', kg: 75 }, { id: '2026-09-08', kg: 77 }]);
  const d = { id: 'dom', logType: 'bodyweight' };
  const hist = [{ id: 'h', kind: 'strength', date: '2026-09-01', exercises: [{ exerciseId: 'dom', sets: [{ type: 'effective', weight: 0, reps: 8, rir: 1, done: true }] }] }];
  const bests = bestsForExercise(hist, 'dom', d, { bwFn: bw2 });
  assert.deepEqual(detectPRs({ type: 'effective', weight: 0, reps: 8, rir: 1, done: true }, d, bests, 77), []);
  assert.deepEqual(detectPRs({ type: 'effective', weight: 2.5, reps: 8, rir: 1, done: true }, d, bests, 77).map((p) => p.kind), ['weight', 'e1rm']);
  // Si baja el peso corporal y se hace una rep más, sí es récord de 1RM (y de reps a ese lastre).
  assert.deepEqual(detectPRs({ type: 'effective', weight: 0, reps: 9, rir: 1, done: true }, d, bests, 74.5).map((p) => p.kind), ['e1rm', 'reps']);
});

test('bestSet: distancia+tiempo elige la más rápida; tiempo la más larga', () => {
  const sprint = { id: 'sprint', logType: 'distance_time' };
  const sets = [
    { id: 'a', type: 'effective', distanceM: 20, timeSec: 3.4, done: true },
    { id: 'b', type: 'effective', distanceM: 20, timeSec: 3.1, done: true },
    { id: 'c', type: 'warmup', distanceM: 20, timeSec: 2.9, done: true },
  ];
  assert.equal(bestSet(sets, sprint).id, 'b');
  assert.equal(bestSet([{ id: 'x', type: 'effective', distanceM: 30, timeSec: null, done: true }], sprint).id, 'x');
  assert.equal(bestSet([{ id: 'y', type: 'effective', distanceM: null, timeSec: null, done: true }], sprint), null);
  const plank = { id: 'plancha', logType: 'time' };
  assert.equal(bestSet([{ id: 'p1', type: 'effective', timeSec: 40, done: true }, { id: 'p2', type: 'effective', timeSec: 45, done: true }], plank).id, 'p2');
  const bench = { id: 'bench', logType: 'weight_reps' };
  assert.equal(bestSet([{ id: 'w1', type: 'effective', weight: 80, reps: 6, done: true }, { id: 'w2', type: 'effective', weight: 85, reps: 3, done: true }], bench).id, 'w1');
});

test('bestSet no mezcla 1RM con repeticiones de series sin 1RM', async () => {
  const { bestSet } = await import('../../js/calc.js');
  const ex = { logType: 'weight_reps' };
  const a = { id: 'a', type: 'effective', weight: 10, reps: 3, done: true };
  const b = { id: 'b', type: 'effective', weight: 8, reps: 20, done: true };
  assert.equal(bestSet([a, b], ex).id, 'a');
  assert.equal(bestSet([b], ex).id, 'b');
});

test('bestSet sin ninguna serie con 1RM: más peso × reps, luego más peso y luego más reps (regla de stats.js)', () => {
  const s = (id, o) => ({ id, type: 'effective', done: true, rir: 1, ...o });
  const lat = { logType: 'weight_reps' };
  // 12 kg × 15 (180) gana a 5 kg × 25 (125): antes ganaba la de más reps
  assert.equal(bestSet([s('a', { weight: 5, reps: 25 }), s('b', { weight: 12, reps: 15 })], lat).id, 'b');
  // Mismo peso × reps (10 × 18 = 180 = 12 × 15): gana el más pesado
  assert.equal(bestSet([s('a', { weight: 10, reps: 18 }), s('b', { weight: 12, reps: 15 })], lat).id, 'b');
  // Todo igual: la primera
  assert.equal(bestSet([s('a', { weight: 10, reps: 15 }), s('b', { weight: 10, reps: 15 })], lat).id, 'a');
  // Unilateral: volumen de los dos lados
  const uni = { logType: 'unilateral' };
  assert.equal(bestSet([s('a', { weight: 10, reps: 20, repsR: 14 }), s('b', { weight: 10, reps: 16, repsR: 16 })], uni).id, 'a');
  // Peso corporal (no core): volumen con el peso del día; a igualdad de volumen, más lastre
  const dips = { logType: 'bodyweight', pattern: 'push_v' };
  assert.equal(bestSet([s('a', { weight: null, reps: 20 }), s('b', { weight: 5, reps: 15 })], dips, 75).id, 'a'); // 1500 > 1200
  // Core sin lastre: sin volumen, cuenta el lastre (0) y luego las reps
  const core = { logType: 'bodyweight', pattern: 'core' };
  assert.equal(bestSet([s('a', { weight: null, reps: 10 }), s('b', { weight: null, reps: 12 })], core, 75).id, 'b');
  assert.equal(bestSet([s('a', { weight: null, reps: 15 }), s('b', { weight: 5, reps: 8 })], core, 75).id, 'b'); // 40 kg de volumen
  // Sin reps no es comparable
  assert.equal(bestSet([s('a', { weight: 20, reps: null })], lat), null);
});
