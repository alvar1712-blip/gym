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
import { buildSeries, computeBestEfforts, encodeTrack } from '../../js/best-efforts.js';
import { enduranceRecords, runPartialsBySession } from '../../js/stats.js';

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
/**
 * Carrera importada como la guarda import-logic (C1): tramos [{ km, pace } | { stop: s }] a 1 Hz pasados por el mismo
 * cálculo que la importación (buildSeries + computeBestEfforts + encodeTrack); movingSec = sin las paradas.
 */
function imported(date, parts) {
  const t = [0];
  const d = [0];
  let ts = 0;
  let dm = 0;
  let moving = 0;
  for (const p of parts) {
    if (p.stop) {
      for (let i = 1; i <= p.stop; i++) { t.push(ts + i); d.push(dm); }
      ts += p.stop;
      continue;
    }
    const n = Math.round(p.km * p.pace);
    for (let i = 1; i <= n; i++) { t.push(ts + i); d.push(dm + (p.km * 1000 * i) / n); }
    ts += n; dm += p.km * 1000; moving += n;
  }
  const t0 = tsFromDate(date, 8) / 1000;
  const series = buildSeries({ t: t.map((x) => t0 + x), d, src: 'device' });
  const km = Math.round(dm) / 1000;
  const bestEfforts = computeBestEfforts({ series, basis: { km, sec: moving } });
  return { ...run(date, km, moving), source: { type: 'fit', fileName: 'carrera.fit' }, track: encodeTrack(series), bestEfforts };
}
/** 12,4 km: 3,12 km a 5:30, 5 km a 4:58 (24:50) y 4,28 km a 5:30 (ritmo medio ≈ 5:17; 5 km «a ritmo medio» ≈ 26:25). */
const twelve = (date = ago(5)) => imported(date, [{ km: 3.12, pace: 330 }, { km: 5, pace: 298 }, { km: 4.28, pace: 330 }]);
/** La misma carrera sin parciales (como una antigua o apuntada a mano): cuenta entera. */
const plain = (a) => { const { track, bestEfforts, source, ...rest } = a; return rest; };
/** F7: F1 + una carrera importada de 12,4 km con un 5 km rápido dentro (C4). */
const F7 = () => { const f = F1(); f.sessions.push(twelve()); return f; };
const FIXTURES = { F1, F2, F3, F4, F5, F6, F7 };
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

// --- C4: mejores tramos de carreras importadas en el motor -----------------------------------------------------------
const effortOf = (d, id) => analyzeRuns(d).valid.filter((e) => e.sessionId === id);

test('C4: el mejor 5 km real dentro de una carrera de 12,4 km es el esfuerzo y adelanta el 5 km previsto frente al ritmo medio', () => {
  const f = F7();
  const a = f.sessions.at(-1);
  const d = data(f);
  const [e] = effortOf(d, a.id);
  assert.deepEqual(e.partial, { id: '5k', ofKm: 12.4, atKm: 3.12 });
  assert.deepEqual([e.km, e.sec, e.wholeKm, e.wholeSec], [5, 1490, 12.4, a.movingSec]);
  assert.equal(e.label, '5 km en 24:50 (4:58/km) · mejor tramo de una carrera de 12,4 km');
  // La misma carrera sin parciales (ritmo medio): cuenta entera y el 5 km previsto sale más lento
  const g = F1();
  g.sessions.push(plain(a));
  const dPlain = data(g);
  assert.equal(effortOf(dPlain, a.id)[0].partial, null);
  assert.equal(effortOf(dPlain, a.id)[0].km, 12.4);
  const withPartial = predictFor(d, 5).prediction;
  const average = predictFor(dPlain, 5).prediction;
  assert.ok(withPartial.midExact < average.midExact - 1, `${withPartial.midExact} < ${average.midExact}`);
  assert.ok(withPartial.mid <= average.mid);
  // El volumen y la tirada más larga siguen siendo los de la carrera entera
  const ctx = analyzeRuns(d);
  assert.equal(ctx.volumeKm, analyzeRuns(dPlain).volumeKm);
  assert.equal(ctx.longest.km, 12.4);
  // Explicación y confianza lo dicen; el DTO base y el informe llevan el tramo
  const p = predictFor(d, 5).prediction;
  assert.ok(p.efforts.some((x) => x.partial?.id === '5k'));
  assert.match(p.why.rule, /mejor tramo continuo si es mejor referencia que la carrera entera \(una sola vez por carrera\)/);
  assert.ok(p.why.data.some((r) => r.label === 'Mejores tramos'));
  assert.match(p.why.data.find((r) => r.label === 'Confianza').value, /mejor tramo de una carrera importada/);
  assert.deepEqual(baseOf(p).refs.find((r) => r.sessionId === a.id).partial, { id: '5k', ofKm: 12.4, atKm: 3.12 });
  const rs = runningSummary(d).refs.find((r) => r.sessionId === a.id);
  assert.deepEqual(rs.partial, { id: '5k', ofKm: 12.4, atKm: 3.12 });
  assert.match(reportText(buildAnalysis(d, T)), /- 5 km — 24:50 — .*mejor tramo de 5 km dentro de una carrera de 12,4 km\)/);
  // Sin parciales en los datos, ninguna referencia ni explicación los menciona (nada cambia en las antiguas)
  const p1 = predictFor(dPlain, 5).prediction;
  assert.ok(p1.efforts.every((x) => x.partial === null && x.km === x.wholeKm && x.sec === x.wholeSec));
  assert.ok(!p1.why.data.some((r) => r.label === 'Mejores tramos'));
  assert.doesNotMatch(p1.why.rule, /mejor tramo/);
});

test('C4: una sola vez por carrera (la carrera o su tramo, nunca los dos); a ritmo uniforme cuenta la carrera entera', () => {
  const f = F7();
  const even = imported(ago(8), [{ km: 12, pace: 310 }]);
  f.sessions.push(even);
  const d = data(f);
  const ctx = analyzeRuns(d);
  const ids = ctx.valid.filter((e) => e.source === 'run').map((e) => e.sessionId);
  assert.equal(new Set(ids).size, ids.length, 'un esfuerzo por sesión');
  assert.equal(ctx.valid.filter((e) => e.source === 'run').length, f.sessions.length);
  // Ritmo uniforme: sus tramos existen (Récords los usa) pero T / D^1,06 favorece a la carrera entera
  assert.ok(runPartialsBySession(d, 3).get(even.id).some((x) => x.id === '5k'));
  const [e] = effortOf(d, even.id);
  assert.equal(e.partial, null);
  assert.equal(e.km, 12);
});

test('C4 regresión: un resultado de tu contexto que es la carrera entera sigue siendo la misma aunque cuente su mejor tramo', () => {
  const f = F7();
  const a = f.sessions.at(-1);
  // El 10 km… aquí la misma carrera de 12,4 km apuntada en tu contexto (mismo día, misma distancia y tiempo)
  f.context = [result(a.date, 'day', 12.4, a.movingSec)];
  const d = data(f);
  const ctx = analyzeRuns(d);
  assert.equal(effortOf(d, a.id)[0].partial?.id, '5k', 'cuenta su mejor 5 km');
  assert.equal(ctx.duplicates.length, 1, 'antes del arreglo se comparaba con el tramo (5 km) y se contaba dos veces');
  assert.equal(ctx.duplicates[0].sessionId, a.id);
  assert.equal(ctx.valid.filter((e) => e.source === 'context').length, 0);
  assert.equal(ctx.volumeKm, analyzeRuns(data(F7())).volumeKm, 'tampoco suma dos veces al volumen');
});

test('C4: el tramo de 1 km nunca cuenta; con la carrera entera sospechosa, sus tramos tampoco', () => {
  // 4 km con un km muy rápido: solo tiene tramo de 1 km
  const four = imported(ago(6), [{ km: 1.5, pace: 380 }, { km: 1, pace: 200 }, { km: 1.5, pace: 380 }]);
  assert.ok(four.bestEfforts.items['1k']);
  const f = F1();
  f.sessions.push(four);
  const d = data(f);
  assert.equal(runPartialsBySession(d, 3).has(four.id), false);
  assert.equal(effortOf(d, four.id)[0].partial, null);
  assert.ok(analyzeRuns(d).valid.every((e) => e.partial?.id !== '1k'));
  // Carrera entera con un ritmo imposible (más lenta de 20:00 /km con su tiempo guardado): fuera, con sus tramos
  const slow = twelve(ago(4));
  slow.movingSec = 12.4 * 1300;
  slow.bestEfforts = { ...slow.bestEfforts, basis: { km: 12.4, sec: slow.movingSec } };
  const g = F1();
  g.sessions.push(slow);
  const ds = data(g);
  assert.ok(runPartialsBySession(ds, 3).get(slow.id).some((x) => x.id === '5k'), 'el tramo es válido por sí solo');
  assert.equal(effortOf(ds, slow.id).length, 0);
  assert.ok(analyzeRuns(ds).suspect.some((x) => x.sessionId === slow.id && x.why === 'slow'));
});

test('C4: editar la distancia o el tiempo de la importada la devuelve a la carrera entera; deshacerlo recupera el tramo', () => {
  const f = F7();
  const a = f.sessions.at(-1);
  a.distanceKm = 12.5;
  assert.equal(effortOf(data(f), a.id)[0].partial, null);
  assert.equal(effortOf(data(f), a.id)[0].km, 12.5);
  a.distanceKm = 12.4;
  assert.equal(effortOf(data(f), a.id)[0].partial?.id, '5k');
});

test('C4: Objetivos, Tiempos previstos, Eventos, récords y el informe dicen lo mismo con un tramo en la base', () => {
  // Sin el 5 km rápido de F1 (4:50 /km): así el récord de 5 km también es el tramo
  const f = F7();
  f.sessions = f.sessions.filter((x) => x.distanceKm !== 5);
  const d = data({ ...f, races: [raceOf('5k', 25 * 60)] });
  const p = predictFor(d, 5).prediction;
  assert.ok(p.efforts.some((e) => e.partial));
  const base = baseOf(p);
  assert.deepEqual(baseOf(predictRaces(d).predictions['5k']), base);
  const goal = runGoal(5, 24 * 60);
  assert.deepEqual(goalProgress(d, goal).prediction, base);
  assert.deepEqual(racePrediction(d, raceOf('5k', 25 * 60)).base, base);
  assert.deepEqual(checkTarget(d, 5, 24 * 60).prediction && baseOf(checkTarget(d, 5, 24 * 60).prediction), base);
  const a = buildAnalysis(d, T);
  assert.equal(a.running.predictions.find((x) => x.id === '5k').mid, p.mid);
  assert.deepEqual(a.events[0].prediction.base, base);
  // El récord de 5 km es el mismo tramo (una sola regla) y la predicción lo cita como tal
  const rec = enduranceRecords(d).run.best['5k'];
  assert.equal(rec.how, 'partial');
  assert.equal(rec.timeSec, 1490);
  assert.match(p.why.data.find((r) => /^Tu récord/.test(r.label)).value, /mejor tramo de una carrera de 12,4 km/);
});
