// Calentamiento sugerido (MEJORAS §3): warmupPlan y ayudantes puros de session-logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  warmupPlan, warmupIncrement, warmupReference, suggestedWarmup, warmupSetsFromPlan, formatSet,
} from '../../js/session-logic.js';
import { SEED_EXERCISES, defaultSettings } from '../../js/seed.js';
import { isWorkSet, sessionVolume, workSetCount, sessionMuscleSets, detectPRs, emptyBests, addToBests, sessionPRs } from '../../js/calc.js';

const EX = Object.fromEntries(SEED_EXERCISES.map((e) => [e.id, e]));
const settings = defaultSettings();
const bench = EX.press_banca;
const curl = EX.curl_barra;
const plan = (workWeight, exercise = bench, extra = {}) => warmupPlan({ workWeight, reps: 5, exercise, settings, ...extra });
const steps = (p) => p.map((s) => `${s.pct}%·${s.weight}×${s.reps}`);

test('ejercicios de la semilla: compuesto e aislamiento de peso × reps', () => {
  assert.equal(bench.logType, 'weight_reps');
  assert.equal(bench.category, 'compound');
  assert.equal(curl.category, 'isolation');
});

test('warmupPlan: tramos del esquema (≥ 60, 30–60, < 30 kg)', () => {
  assert.deepEqual(plan(100), [
    { pct: 40, weight: 40, reps: 8 },
    { pct: 60, weight: 60, reps: 5 },
    { pct: 80, weight: 80, reps: 3 },
  ]);
  // 60 kg ya es el tramo alto: 24 → 25, 36 → 35, 48 → 47,5 (múltiplos de 2,5)
  assert.deepEqual(steps(plan(60)), ['40%·25×8', '60%·35×5', '80%·47.5×3']);
  // 30–60 kg
  assert.deepEqual(steps(plan(59.5)), ['50%·30×8', '75%·45×4']);
  assert.deepEqual(steps(plan(50)), ['50%·25×8', '75%·37.5×4']);
  assert.deepEqual(steps(plan(30)), ['50%·15×8', '75%·22.5×4']);
  // < 30 kg
  assert.deepEqual(steps(plan(27.5)), ['50%·15×10']);
  assert.deepEqual(steps(plan(20)), ['50%·10×10']);
});

test('warmupPlan: redondeo al incremento cargable (2,5 kg compuestos; aislamiento, el de ajustes: 1 kg)', () => {
  assert.equal(warmupIncrement(bench, settings), 2.5);
  assert.equal(warmupIncrement(EX.sentadilla || { category: 'compound', region: 'lower' }, settings), 2.5, 'compuesto de pierna también 2,5');
  assert.equal(warmupIncrement(curl, settings), 1);
  assert.equal(warmupIncrement(curl, null), 1, 'sin ajustes: 1 kg');
  assert.equal(warmupIncrement(curl, { increments: { isolation: 2 } }), 2, 'el de los ajustes del usuario');
  assert.equal(warmupIncrement({ ...bench, increment: 1.25 }, settings), 1.25, 'el del ejercicio si lo tiene');
  // 82,5 kg: 33 → 32,5 · 49,5 → 50 · 66 → 65
  assert.deepEqual(steps(plan(82.5)), ['40%·32.5×8', '60%·50×5', '80%·65×3']);
  // aislamiento de 17 kg: 8,5 → 9 (1 kg)
  assert.deepEqual(steps(plan(17, curl)), ['50%·9×10']);
  // aislamiento de 36 kg: 18 y 27
  assert.deepEqual(steps(plan(36, curl)), ['50%·18×8', '75%·27×4']);
  // incremento propio del ejercicio (p. ej. discos de 1,25 kg)
  assert.deepEqual(steps(plan(45, { ...bench, increment: 1.25 })), ['50%·22.5×8', '75%·33.75×4']);
  for (const w of [22.5, 37.5, 62.5, 87.5, 102.5, 142.5, 200]) {
    for (const s of plan(w)) assert.equal(Math.abs(s.weight / 2.5 - Math.round(s.weight / 2.5)) < 1e-9, true, `${w}: ${s.weight} múltiplo de 2,5`);
  }
});

test('warmupPlan: sin pasos repetidos, por debajo del ~20 % o de la barra vacía, ni casi en el de trabajo', () => {
  // Incremento enorme: 40 % y 60 % de 60 redondean a 30 (repetido) y 80 % a 45 (a < 2 incrementos de 60).
  assert.deepEqual(steps(plan(60, { ...bench, increment: 15 })), ['40%·30×8']);
  // Pesos minúsculos: el redondeo lo deja en 0 o casi en el de trabajo → nada
  assert.deepEqual(plan(2), []);
  assert.deepEqual(plan(5), [], '2,5 antes de 5 no calienta nada');
  assert.deepEqual(plan(2, curl), []);
  assert.deepEqual(steps(plan(4, curl)), ['50%·2×10']);
  // Barra vacía (si el ejercicio lo tiene en sus datos): 50 % de 35 = 17,5 < 20 → fuera
  const barbell = { ...bench, barKg: 20 };
  assert.deepEqual(steps(plan(35, barbell)), ['75%·27.5×4']);
  assert.deepEqual(steps(plan(45, barbell)), ['50%·22.5×8', '75%·35×4']);
  assert.deepEqual(plan(25, barbell), [], '12,5 kg está por debajo de la barra');
  assert.deepEqual(steps(plan(100, barbell)), ['40%·40×8', '60%·60×5', '80%·80×3']);
  for (const w of [7.5, 12.5, 30, 47.5, 60, 95, 180]) {
    const p = plan(w);
    const ws = p.map((s) => s.weight);
    assert.equal(new Set(ws).size, ws.length, `${w}: sin repetidos`);
    for (const s of p) {
      assert.ok(s.weight >= w * 0.2 && s.weight < w, `${w}: ${s.weight} útil y por debajo del de trabajo`);
      assert.ok(s.reps > 0);
    }
    for (let i = 1; i < p.length; i++) assert.ok(p[i].weight > p[i - 1].weight, `${w}: creciente`);
  }
});

test('warmupPlan: antes de un doble o un sencillo, los pasos pesados no llevan más reps', () => {
  assert.deepEqual(steps(plan(100, bench, { reps: 1 })), ['40%·40×8', '60%·60×5', '80%·80×1']);
  assert.deepEqual(steps(plan(50, bench, { reps: 2 })), ['50%·25×8', '75%·37.5×2']);
  assert.deepEqual(steps(plan(100, bench, { reps: null })), ['40%·40×8', '60%·60×5', '80%·80×3']);
});

test('warmupPlan: unilateral sí; peso corporal, tiempo, distancia, saltos y cardio → []', () => {
  const uni = SEED_EXERCISES.find((e) => e.logType === 'unilateral');
  assert.ok(uni, 'hay un unilateral en la semilla');
  assert.ok(warmupPlan({ workWeight: 40, reps: 8, exercise: uni, settings }).length > 0);
  for (const lt of ['bodyweight', 'time', 'distance_time', 'jumps', 'cardio']) {
    const ex = SEED_EXERCISES.find((e) => e.logType === lt) || { ...bench, logType: lt };
    assert.deepEqual(warmupPlan({ workWeight: 80, reps: 5, exercise: ex, settings }), [], lt);
  }
  // Sin peso de trabajo o sin ejercicio
  for (const w of [null, undefined, 0, -10, NaN, 'abc']) assert.deepEqual(plan(w), [], String(w));
  assert.deepEqual(warmupPlan({ workWeight: 80, reps: 5, exercise: null, settings }), []);
  assert.deepEqual(warmupPlan(), []);
});

// --- Sesión: referencia, cuándo se ofrece y series que añade ---

const set = (o) => ({ id: `s${Math.random().toString(36).slice(2, 8)}`, type: 'effective', weight: null, reps: null, repsR: null, rir: null, timeSec: null, distanceM: null, heightCm: null, note: '', done: false, doneAt: null, ...o });
const seWith = (sets, extra = {}) => ({ id: 'se1', exerciseId: 'press_banca', target: { sets: 3, repMin: 4, repMax: 6 }, sets, ...extra });

test('warmupReference: primera serie de trabajo pendiente con peso; si no, la «última vez»', () => {
  const se = seWith([set({ weight: 80, reps: 6 }), set({ weight: 82.5, reps: 5 })]);
  assert.deepEqual(warmupReference(se), { weight: 80, reps: 6 });
  // Pendientes sin peso (primera vez, o borrado): la última vez
  const last = { sets: [set({ type: 'warmup', weight: 40, reps: 8, done: true }), set({ weight: 77.5, reps: 6, done: true })] };
  assert.deepEqual(warmupReference(seWith([set({ weight: null, reps: 6 })]), last), { weight: 77.5, reps: 6 });
  assert.deepEqual(warmupReference(seWith([]), last), { weight: 77.5, reps: 6 });
  assert.equal(warmupReference(seWith([set({ reps: 6 })])), null);
  assert.equal(warmupReference(null), null);
});

test('suggestedWarmup: solo mientras no hay calentamientos ni series hechas', () => {
  const pending = [set({ weight: 80, reps: 6 }), set({ weight: 80, reps: 5 })];
  const s = suggestedWarmup(seWith(pending), bench, settings);
  assert.deepEqual(steps(s.plan), ['40%·32.5×8', '60%·47.5×5', '80%·65×3']);
  assert.deepEqual(s.ref, { weight: 80, reps: 6 });
  // ya añadidos (pendientes) o hechos → nada
  assert.deepEqual(suggestedWarmup(seWith([set({ type: 'warmup', weight: 40, reps: 8 }), ...pending]), bench, settings).plan, []);
  assert.deepEqual(suggestedWarmup(seWith([set({ type: 'warmup', weight: 40, reps: 8, done: true }), ...pending]), bench, settings).plan, []);
  // una serie de trabajo ya hecha → ya no es calentamiento
  assert.deepEqual(suggestedWarmup(seWith([set({ weight: 80, reps: 6, done: true }), pending[1]]), bench, settings).plan, []);
  // sin carga / peso corporal
  assert.deepEqual(suggestedWarmup(seWith([set({ reps: 6 })]), bench, settings).plan, []);
  assert.deepEqual(suggestedWarmup(seWith([set({ weight: 10, reps: 8 })]), EX.dominadas, settings).plan, []);
});

test('warmupSetsFromPlan: calentamientos pendientes al principio, que no cuentan como trabajo, récord ni volumen', () => {
  const work = [set({ weight: 80, reps: 6, rir: 2 }), set({ weight: 80, reps: 5, rir: 1 })];
  const se = seWith([...work]);
  const p = suggestedWarmup(se, bench, settings).plan;
  const { sets, index } = warmupSetsFromPlan(p, se, 'weight_reps');
  assert.equal(index, 0, 'al principio del ejercicio');
  assert.equal(sets.length, 3);
  for (const [i, x] of sets.entries()) {
    assert.equal(x.type, 'warmup');
    assert.equal(x.done, false);
    assert.equal(x.rir, null);
    assert.equal(x.weight, p[i].weight);
    assert.equal(x.reps, p[i].reps);
    assert.ok(x.id && !work.some((w) => w.id === x.id));
  }
  assert.equal(new Set(sets.map((x) => x.id)).size, 3, 'ids distintos');
  assert.deepEqual(sets.map((x) => formatSet(x, 'weight_reps')), ['32,5×8', '47,5×5', '65×3']);

  // Unilateral: mismas reps por lado
  const u = warmupSetsFromPlan([{ pct: 50, weight: 20, reps: 8 }], seWith([]), 'unilateral');
  assert.deepEqual([u.sets[0].reps, u.sets[0].repsR, u.index], [8, 8, 0]);

  // Hechos, siguen sin contar para nada (calc.isWorkSet)
  se.sets.splice(index, 0, ...sets);
  for (const x of se.sets) Object.assign(x, { done: true, doneAt: 1 });
  assert.equal(sets.every((x) => !isWorkSet(x)), true);
  assert.equal(workSetCount(se), 2);
  const session = { id: 'sx', kind: 'strength', date: '2026-09-26', status: 'done', exercises: [se] };
  const exMap = new Map([['press_banca', bench]]);
  assert.equal(sessionVolume(session, exMap), 80 * 6 + 80 * 5, 'volumen solo de las de trabajo');
  assert.deepEqual(sessionMuscleSets(session, exMap, settings).chest, 2);
  // Un calentamiento más pesado que todo el historial no es récord
  const bests = emptyBests();
  addToBests(bests, { type: 'effective', weight: 60, reps: 5, done: true }, bench);
  assert.deepEqual(detectPRs({ ...sets[2], weight: 100 }, bench, bests), []);
  assert.ok(detectPRs({ ...sets[2], type: 'effective', weight: 100 }, bench, bests).length > 0, 'la misma serie de trabajo sí lo sería');
  const prs = sessionPRs(session, [], exMap);
  for (const x of sets) assert.equal(prs.has(x.id), false);
});
