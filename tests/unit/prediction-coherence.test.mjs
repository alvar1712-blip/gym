// Ronda 8 · B1: UN SOLO motor de predicción de carrera (race-predict.js). Pruebas cruzadas: con los mismos datos,
// Tiempos previstos, «¿Puedo hacerlo?», Eventos («Cómo vas»), Objetivos (carrera con tiempo), el resumen de running,
// el análisis (incluida la previsión a 4 semanas) y el informe para tu IA dan el MISMO resultado base: previsto,
// rango, confianza, estado, referencias y método. Datos sintéticos y neutros; hoy = 24 sep 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../js/context-logic.js';
import {
  predictRaces, predictFor, checkTarget, baseOf, runningSummary, predictionSeries, predictWindow, analyzeRuns,
  predictDistance, raceFor, rangeText, METHOD, VERDICT_LABEL, TOP_N,
} from '../../js/race-predict.js';
import { racePrediction, linkedGoalProgress } from '../../js/races-progress.js';
import { goalProgress } from '../../js/goals-logic.js';
import { buildAnalysis } from '../../js/analysis.js';
import { reportText } from '../../js/analysis-report.js';
import { analyzeEndurance } from '../../js/analysis-training.js';
import { addDays, tsFromDate, fmtRaceTime, weekStart } from '../../js/util.js';
import { defaultSettings } from '../../js/seed.js';

const T = '2026-09-24';
const ago = (n) => addDays(T, -n);
let seq = 0;
const run = (date, km, sec) => ({ id: `run${++seq}`, kind: 'run', status: 'done', date, distanceKm: km, movingSec: sec, durationMin: sec / 60, rpe: 5, startedAt: tsFromDate(date, 8) });
const result = (date, precision, km, sec) => C.entryRecord({ kind: 'event', type: 'race_result', date: { date, precision }, text: '', notes: '', result: { km, sec } }, { id: `res${++seq}`, now: seq });
const phase = (type, start, end) => C.entryRecord({ kind: 'phase', type, start: { date: start, precision: 'day' }, end: end ? { date: end, precision: 'day' } : null, text: '', notes: '' }, { id: `ph${++seq}`, now: seq });
const data = ({ sessions = [], context = [], goals = [], races = [] } = {}) => ({
  sessions, context, goals, races, exercises: new Map(), settings: defaultSettings(), bodyweight: [], checkins: [], cycleDays: [], pastRecords: [], today: T,
});
const runGoal = (km, sec, o = {}) => ({ id: `g${++seq}`, kind: 'endurance', sport: 'run', distanceKm: km, timeSec: sec, title: 'Objetivo', createdAt: tsFromDate('2026-07-01', 10), achievedAt: null, archived: false, ...o });
const raceOf = (type, targetSec, o = {}) => ({ id: `rc${++seq}`, name: '', type, date: addDays(T, 40), distanceKm: null, targetSec, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1, ...o });

// --- Fixtures -----------------------------------------------------------------------------------------------------
/** F1: seis carreras de 8 km a 5:40 /km (una por semana) y un 5 km a 4:50 /km hace 10 días (la divergencia medida). */
const F1 = () => {
  const s = [];
  for (let i = 0; i < 6; i++) s.push(run(ago(3 + 7 * i), 8, 8 * 340));
  s.push(run(ago(10), 5, 5 * 290));
  return { sessions: s };
};
/** F2: F1 + un resultado antiguo de tu contexto + una fase «Enfermedad» después de él. */
const F2 = () => ({ ...F1(), context: [result('2026-03-14', 'day', 10, 2820), phase('illness', '2026-04-10', '2026-04-24')] });
/** F3: media maratón con poco volumen (tentative): tres carreras cortas. */
const F3 = () => ({ sessions: [run(ago(4), 5, 1600), run(ago(15), 6, 1950), run(ago(30), 5, 1620)] });
/** F4: esfuerzos que se contradicen (dispersión > ±25 %: incoherent). */
const F4 = () => ({ sessions: [run(ago(5), 5, 1200), run(ago(12), 10, 4800)] });
/** F5: una sola carrera (insuficiente). */
const F5 = () => ({ sessions: [run(ago(6), 8, 2720)] });
/** F6: F1 + un 10 km en 18:20 (1:50 /km, un error de datos) el 20 sep. */
const F6 = () => { const f = F1(); f.sessions.push(run('2026-09-20', 10, 1100)); return f; };
const FIXTURES = { F1, F2, F3, F4, F5, F6 };
const DISTANCES = [5, 10, 21.0975, 42.195, 15];
const TYPE = { 5: '5k', 10: '10k', 21.0975: 'half', 42.195: 'marathon' };

/** Objetivos alrededor del rango: más rápido que todo, dentro, exactamente el previsto, más lento que todo. */
function targetsFor(p) {
  if (!p || !p.usable) return [3000];
  return [p.low - 30, Math.round((p.low + p.mid) / 2), p.mid, p.high + 30];
}

// --- Regresiones (fallaban antes de B1) ------------------------------------------------------------------------------
test('regresión F1: Objetivos ya no da su propio «Actual» (50:23, «Al alcance») frente a 55:30 / «Hoy no» del motor', () => {
  const d = data(F1());
  const engine = predictFor(d, 10).prediction;
  assert.equal(engine.mid, 3330, '55:30 en Tiempos previstos');
  const g = goalProgress(d, runGoal(10, 51 * 60));
  assert.equal(g.current, engine.mid, 'antes: 3023 (Riegel suelto de la mejor carrera de 28 días)');
  assert.equal(g.ready, false, 'antes: «Al alcance»');
  assert.equal(g.verdict, 'hoy_no');
  assert.equal(g.verdict, checkTarget(d, 10, 51 * 60).verdict);
  // Y en «Cómo vas» del evento enlazado los dos bloques dicen lo mismo
  const goal = runGoal(10, 51 * 60);
  const race = raceOf('10k', 51 * 60, { goalId: goal.id });
  const ev = racePrediction(d, race);
  const lg = linkedGoalProgress(d, race, [goal]);
  assert.equal(ev.verdict, lg.progress.verdict);
  assert.equal(ev.mid, lg.progress.current);
});

test('regresión F6: un 10 km en 18:20 (1:50 /km, error de datos) ya no marca como conseguido «10 km en menos de 45:00»', () => {
  const d = data(F6());
  const g = goalProgress(d, runGoal(10, 45 * 60));
  assert.notEqual(g.status, 'achieved', 'antes: conseguido el 20 sep');
  assert.equal(g.achievedOn, null);
  // Tiempos previstos la lista como sospechosa (la misma regla de ritmo creíble)
  assert.ok(predictRaces(d).suspect.some((x) => x.date === '2026-09-20' && x.why === 'fast'));
  // Una carrera creíble sí lo consigue
  const ok = data(F1());
  ok.sessions.push(run('2026-09-20', 10, 2650));
  assert.equal(goalProgress(ok, runGoal(10, 45 * 60)).achievedOn, '2026-09-20');
});

test('regresión: la previsión a 4 semanas del 5 km parte del 5 km de Tiempos previstos («ahora ~X»), no del bloque', () => {
  // 24 semanas de carreras de 6 km cada vez más rápidas + un 5 km apuntado en tu contexto hace 30 días (el bloque no lo ve)
  const sessions = [];
  for (let i = 0; i < 48; i++) sessions.push(run(ago(1 + i * 3.5 | 0), 6, Math.round(6 * (300 + i * 1.2))));
  const d = data({ sessions, context: [result(ago(30), 'day', 5, 1290)] });
  const now5 = predictFor(d, 5).prediction;
  const e = analyzeEndurance(d, { today: T });
  const fc = e.insights.find((i) => i.id === 'forecast-5k');
  assert.ok(fc, 'hay previsión');
  assert.notEqual(e.fitness.at(-1).pred5kSec, now5.mid, 'el bloque (sin tu contexto) y la estimación actual difieren');
  assert.ok(fc.text.includes(`ahora ~${fmtRaceTime(now5.mid)}`), fc.text);
  // Y el informe no llama «5 km previsto» a un valor de bloque
  const a = buildAnalysis(d, T);
  const txt = reportText(a);
  assert.doesNotMatch(txt, /5 km previsto por bloques|TENDENCIAS[\s\S]*- 5 km previsto:/);
  assert.match(txt, /Forma en 5 km por bloques de 4 semanas: /);
});

// --- API del motor ---------------------------------------------------------------------------------------------------
test('predictFor = predictDistance(analyzeRuns) para distancias estándar y otras; insuficiente = predictRaces sin datos', () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    const d = data(f());
    const ctx = analyzeRuns(d);
    for (const km of DISTANCES) {
      const r = predictFor(d, km);
      const all = predictRaces(d);
      if (!all.ok) {
        assert.equal(r.ok, false, name);
        assert.equal(r.message, all.message, name);
        continue;
      }
      assert.deepEqual(baseOf(r.prediction), baseOf(predictDistance(ctx, km, raceFor(km))), `${name} ${km}`);
      const std = raceFor(km);
      if (std) assert.deepEqual(baseOf(r.prediction), baseOf(all.predictions[std.id]), `${name} ${km}`);
    }
  }
});

test('analyzeRuns memoriza por (data, hoy) y se invalida si cambian las sesiones o el contexto', () => {
  const d = data(F1());
  assert.equal(analyzeRuns(d), analyzeRuns(d));
  assert.equal(analyzeRuns(d, { today: ago(7) }), analyzeRuns(d, { today: ago(7) }));
  assert.notEqual(analyzeRuns(d), analyzeRuns(d, { today: ago(7) }));
  const before = analyzeRuns(d);
  d.sessions.push(run(ago(1), 10, 3000));
  const after = analyzeRuns(d);
  assert.notEqual(before, after);
  assert.equal(after.valid.length, before.valid.length + 1);
  d.context = [result(ago(20), 'day', 5, 1400)];
  assert.equal(analyzeRuns(d).contextUsed, 1);
});

test('baseOf: DTO canónico con método, rango, confianza y referencias; null sin predicción', () => {
  assert.equal(baseOf(null), null);
  const p = predictFor(data(F2()), 10).prediction;
  const b = baseOf(p);
  assert.equal(b.method, METHOD);
  assert.deepEqual([b.mid, b.low, b.high, b.confidence, b.status, b.usable], [p.mid, p.low, p.high, p.confidence, p.status, p.usable]);
  assert.equal(b.refs.length, p.efforts.length);
  assert.ok(b.refs.some((r) => r.source === 'context' && r.old && r.interrupted), 'la referencia histórica, antes de la enfermedad');
  assert.ok(Math.abs(b.refs.reduce((t, r) => t + r.share, 0) - 1) < 1e-9);
});

test('predictionSeries: fotos del mismo motor en fechas pasadas (= predictFor con ese «hoy»)', () => {
  const d = data(F1());
  const dates = [ago(40), ago(14), T];
  const s = predictionSeries(d, 10, dates);
  assert.equal(s.length, 3);
  for (const x of s) {
    const r = predictFor(d, 10, { today: x.date });
    if (!r.ok) { assert.equal(x.ok, false); assert.equal(x.mid, null); continue; }
    assert.deepEqual([x.mid, x.midExact, x.low, x.high, x.confidence, x.status], [r.prediction.mid, r.prediction.midExact, r.prediction.low, r.prediction.high, r.prediction.confidence, r.prediction.status]);
  }
  assert.equal(s[0].ok, false, 'hace 40 días solo había 1 carrera');
});

test('predictWindow: solo carreras registradas de la ventana (= el antiguo cálculo por bloques), sin contexto', () => {
  const d = data(F2());
  d.context.push(result(ago(9), 'day', 5, 1300));
  const from = ago(27);
  const ctx = analyzeRuns(d, { today: T });
  const valid = ctx.valid.filter((e) => e.source === 'run' && e.date >= from);
  const old = predictDistance({ ...ctx, valid, basis: valid.slice(0, TOP_N), history: [], duplicates: [] }, 5, raceFor(5));
  const p = predictWindow(d, 5, { from, to: T });
  assert.deepEqual(baseOf(p), baseOf(old));
  assert.ok(p.efforts.every((e) => e.source === 'run'));
  assert.equal(predictWindow(d, 5, { from: ago(4), to: T }), null, 'una sola carrera en la ventana');
});

// --- Prueba cruzada --------------------------------------------------------------------------------------------------
test('mismos datos → mismo resultado base en Tiempos previstos, comprobador, Eventos, Objetivos, resumen, análisis e informe', () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    for (const km of DISTANCES) {
      const d0 = data(f());
      const r = predictFor(d0, km);
      const p = r.ok ? r.prediction : null;
      const std = raceFor(km);
      const tag = `${name} · ${km} km`;
      // 1. Tiempos previstos (tabla o distancia propia)
      const all = predictRaces(d0);
      const table = all.ok ? (std ? all.predictions[std.id] : predictFor(d0, km).prediction) : null;
      assert.deepEqual(baseOf(table), baseOf(p), tag);
      // 5. Resumen de running (informe)
      const rs = runningSummary(d0).predictions.find((x) => std && x.id === std.id);
      if (rs) {
        assert.equal(rs.method, METHOD);
        assert.deepEqual([rs.mid, rs.low, rs.high, rs.confidence, rs.status], p.usable ? [p.mid, p.low, p.high, p.confidence, p.status] : [null, null, null, p.confidence, p.status], tag);
      }
      for (const T0 of targetsFor(p)) {
        const ttag = `${tag} · objetivo ${T0}`;
        // 2. «¿Puedo hacerlo?»
        const c = checkTarget(d0, km, T0);
        assert.deepEqual(baseOf(c.prediction), p && p.usable ? baseOf(p) : null, ttag);
        // 4. Objetivos
        const goal = runGoal(km, T0);
        const g = goalProgress(d0, goal);
        if (g.status !== 'achieved') {
          assert.deepEqual(g.prediction, baseOf(p), ttag);
          assert.equal(g.verdict, c.verdict, ttag);
          assert.equal(g.verdictLabel, VERDICT_LABEL[c.verdict], ttag);
          assert.equal(g.current, p && p.usable ? p.mid : null, ttag);
          assert.equal(g.ready, c.verdict === 'probable', `${ttag}: ready ⇔ probable`);
          if (p && p.status === 'tentative') assert.equal(g.eta, null, `${ttag}: sin fecha con una previsión orientativa`);
          if (!r.ok) {
            assert.equal(g.status, 'insufficient', ttag);
            assert.ok(g.explanation.includes(r.message), ttag);
          }
          if (p && p.usable) assert.ok(g.explanation.startsWith(`Tu tiempo previsto para`), ttag);
          if (p && p.usable) assert.ok(g.explanation.includes(`${fmtRaceTime(p.mid)} (${rangeText(p)}`), ttag);
        }
        // 3. Eventos (con objetivo; el objetivo enlazado dice lo mismo)
        if (TYPE[km]) {
          const race = raceOf(TYPE[km], T0, { goalId: goal.id });
          const ev = racePrediction(d0, race);
          assert.deepEqual(ev.base, p && p.usable ? baseOf(p) : null, ttag);
          assert.equal(ev.verdict, c.verdict, ttag);
          const lg = linkedGoalProgress(d0, race, [goal]);
          if (lg.progress.status !== 'achieved') assert.equal(lg.progress.verdict, ev.verdict, ttag);
        }
      }
      // 3b. Eventos sin objetivo
      if (TYPE[km]) {
        const ev = racePrediction(d0, raceOf(TYPE[km], null));
        assert.deepEqual(ev.base, p && p.usable ? baseOf(p) : null, tag);
        if (p && p.usable) assert.equal(ev.mid, p.mid, tag);
      }
    }
    // 6–7. Análisis e informe (un evento 10K con objetivo)
    const d = data({ ...f(), races: [raceOf('10k', 50 * 60)] });
    const p10 = predictFor(d, 10);
    const a = buildAnalysis(d, T);
    const txt = reportText(a);
    if (p10.ok) {
      for (const std of ['5k', '10k', 'half', 'marathon']) {
        const pe = predictFor(d, raceFor({ '5k': 5, '10k': 10, half: 21.0975, marathon: 42.195 }[std]).km).prediction;
        const ap = a.running.predictions.find((x) => x.id === std);
        assert.equal(ap.mid, pe.usable ? pe.mid : null, `${name} análisis ${std}`);
        if (pe.usable) assert.ok(txt.includes(`${fmtRaceTime(pe.mid)} (${rangeText(pe)}, `), `${name} informe ${std}`);
      }
      const pe = p10.prediction;
      assert.equal(a.events[0].prediction.mid, pe.usable ? pe.mid : null, `${name} evento`);
      assert.deepEqual(a.events[0].prediction.base, pe.usable ? baseOf(pe) : null, `${name} evento`);
    } else {
      assert.deepEqual(a.running.predictions, [], name);
    }
  }
});

test('Objetivos: estados del motor (orientativo sin fecha, ajustado, sin previsión útil, insuficiente) y punto de partida', () => {
  // Tentative (media con poco volumen): «Orientativo», sin fecha
  const d3 = data(F3());
  const p3 = predictFor(d3, 21.0975).prediction;
  assert.equal(p3.status, 'tentative');
  const g3 = goalProgress(d3, runGoal(21.0975, p3.low - 600));
  assert.equal(g3.status, 'estimate');
  assert.equal(g3.eta, null);
  assert.equal(g3.statusLabel, 'Orientativo');
  assert.match(g3.stateLine, /^Orientativo: previsto hoy .* \(confianza baja\)/);
  // Incoherente: sin número, insuficiente con el aviso del motor
  const d4 = data(F4());
  const p4 = predictFor(d4, 10).prediction;
  assert.equal(p4.status, 'incoherent');
  const g4 = goalProgress(d4, runGoal(10, 3000));
  assert.equal(g4.status, 'insufficient');
  assert.equal(g4.current, null);
  assert.equal(g4.currentLabel, '—');
  assert.ok(g4.explanation.includes(p4.advice.note));
  // Ajustado con el previsto ya en el objetivo (sin margen): sin fecha
  const d1 = data(F1());
  const p1 = predictFor(d1, 10).prediction;
  const g1 = goalProgress(d1, runGoal(10, p1.mid));
  assert.equal(g1.verdict, 'ajustado');
  assert.equal(g1.status, 'estimate');
  assert.equal(g1.eta, null);
  assert.match(g1.stateLine, /^Ajustado: tu tiempo previsto ya está en el objetivo, sin margen/);
  // Hoy no con tendencia: la pendiente es la de las fotos semanales del motor
  const g0 = goalProgress(d1, runGoal(10, 51 * 60));
  assert.equal(g0.verdict, 'hoy_no');
  assert.match(g0.currentNote, /^previsto hoy · \d+:\d+–\d+:\d+ · confianza alta$/);
  assert.match(g0.method, /^Tiempo previsto con el mismo cálculo que Tiempos previstos: /);
  for (const row of g0.dataUsed.filter((x) => /^Semana /.test(x.label))) assert.match(row.value, /^previsto \d+:\d+ · \d+ carreras?$/);
  // Inicio: la foto del motor el día en que se creó (si ya había previsión) o la primera semana con previsión después
  const late = goalProgress(d1, runGoal(10, 51 * 60, { createdAt: tsFromDate(ago(20), 10) }));
  const snap = predictionSeries(d1, 10, [ago(20)])[0];
  assert.equal(late.start, snap.mid);
  const early = goalProgress(d1, runGoal(10, 51 * 60, { createdAt: tsFromDate('2026-01-01', 10) }));
  const firstWeek = predictionSeries(d1, 10, [addDays(weekStart(ago(31)), 6)])[0];
  assert.equal(predictionSeries(d1, 10, [addDays(weekStart(ago(38)), 6)])[0].ok, false, 'la semana de la primera carrera: 1 sola');
  assert.ok(firstWeek.usable);
  assert.equal(early.start, firstWeek.mid, 'la primera semana con previsión después de crearlo');
});

test('bici, natación y senderismo con tiempo no usan el motor de carrera (sin prediction ni verdict)', () => {
  const s = [];
  for (let i = 0; i < 6; i++) s.push({ ...run(ago(3 + 7 * i), 40, 5400), kind: 'bike' });
  const g = goalProgress(data({ sessions: s }), { ...runGoal(40, 80 * 60), sport: 'bike' });
  assert.equal(g.prediction, undefined);
  assert.equal(g.verdict, undefined);
  assert.match(g.warning, /pensada para carrera/);
});
