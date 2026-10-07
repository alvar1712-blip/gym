// Resultados de carrera en «Tu contexto» (hecho 'race_result', docs/MEJORAS6.md): dato estructurado en el almacén
// context (única copia), su uso en los tiempos previstos (referencia con menos peso cuanto más antigua y si después hubo
// un parón), duplicados con carreras registradas, confianza, «¿Por qué?» e informe para tu IA. Hoy = 7 oct 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../js/context-logic.js';
import {
  predictRaces, checkTarget, analyzeRuns, predictDistance, recencyWeight, breakAfter, runningReferences, rangeText,
  paceRangeText, RACES, WINDOW_DAYS, HISTORY_TOP, BREAK_FACTOR, MIN_KM, STATUSES,
} from '../../js/race-predict.js';
import { racePrediction } from '../../js/races-progress.js';
import { buildAnalysis } from '../../js/analysis.js';
import { reportText, MAX_RUN_REFS } from '../../js/analysis-report.js';
import { RACE_DISTANCES } from '../../js/stats.js';
import { addDays, tsFromDate, fmtRaceTime } from '../../js/util.js';
import { SEED_EXERCISES, defaultSettings } from '../../js/seed.js';
import { validateBackup, BACKUP_APP_ID, BACKUP_FORMAT } from '../../js/store.js';

const T = '2026-10-07';
const ago = (n) => addDays(T, -n);
let seq = 0;
function run(date, km, sec, extra = {}) {
  return { id: `run${++seq}`, kind: 'run', status: 'done', date, distanceKm: km, movingSec: sec, durationMin: sec / 60, rpe: 6, startedAt: tsFromDate(date, 8), ...extra };
}
/** Resultado de carrera tal como lo guarda el formulario (C.entryRecord). */
function result(date, precision, km, sec, extra = {}) {
  return C.entryRecord({ kind: 'event', type: 'race_result', date: { date, precision }, text: '', notes: '', result: { km, sec }, ...extra }, { id: `res${++seq}`, now: seq });
}
const phase = (type, start, end, precision = 'month') => C.entryRecord({ kind: 'phase', type, start: { date: start, precision }, end: end ? { date: end, precision } : null, text: '', notes: '' }, { id: `ph${++seq}`, now: seq });
const data = (sessions, context = [], today = T) => ({ sessions, context, exercises: new Map(), settings: {}, bodyweight: [], today });
const approx = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
/** Carreras regulares en las últimas 4 semanas (7 carreras de 5 a 10 km a ~5:30/km). */
const REGULAR = () => [run(ago(3), 5, 1630), run(ago(7), 8, 2700), run(ago(10), 6, 2000), run(ago(14), 10, 3400), run(ago(17), 5, 1650), run(ago(21), 7, 2350), run(ago(28), 10, 3450)];

/** Invariantes de lo que se pinta (las de la corrección anterior siguen valiendo con resultados del contexto). */
function assertSane(p, tag) {
  assert.ok(STATUSES.includes(p.status), tag);
  for (const k of ['low', 'mid', 'high', 'pace']) assert.ok(Number.isFinite(p[k]) && p[k] > 0, `${tag}: ${k}`);
  assert.ok(p.low <= p.mid && p.mid <= p.high, tag);
  if (!p.usable) return;
  assert.match(fmtRaceTime(p.mid), /^\d{1,2}:\d{2}(:\d{2})?$/, tag);
  assert.match(rangeText(p), /^\d{1,2}:\d{2}(:\d{2})?–\d{1,2}:\d{2}(:\d{2})?$/, tag);
  assert.match(paceRangeText(p), /^\d{1,2}:\d{2}–\d{1,2}:\d{2}\/km$/, tag);
}

// ---------------------------------------------------------------------------
// El dato: hecho estructurado en el almacén context
// ---------------------------------------------------------------------------

test('crear: fecha exacta o aproximada, distancia estándar o personalizada; datos estructurados, no texto', () => {
  const may = result('2026-05-20', 'month', 10, 3600);
  assert.deepEqual(may.date, { date: '2026-05-01', precision: 'month' });
  assert.deepEqual(may.result, { km: 10, sec: 3600, effort: null, elevationM: null, surface: null });
  assert.equal(may.kg, undefined);
  assert.equal(C.entryLine(may), '🏁 10 km · 1:00:00');
  assert.equal(C.entryWhen(may), 'may 2026');
  assert.equal(C.entryTitle(may), 'Resultado de carrera: 10 km en 1:00:00');

  const exact = result('2026-09-15', 'day', 7.5, 2400, { text: 'Carrera popular', result: { km: 7.5, sec: 2400, effort: 'race', elevationM: 85, surface: 'trail' } });
  assert.equal(C.entryLine(exact), '🏁 Carrera popular · 7,5 km · 40:00');
  assert.equal(C.entryWhen(exact), '15 sep 2026');
  assert.deepEqual(exact.result, { km: 7.5, sec: 2400, effort: 'race', elevationM: 85, surface: 'trail' });
  assert.equal(C.resultPace(exact.result), '5:20/km');

  assert.equal(C.entryLine(result('2026-04-01', 'season', 21.0975, 6300)), '🏁 Media maratón · 1:45:00');
  assert.equal(C.entryLine(result('2025-01-01', 'year', 42.195, 14400)), '🏁 Maratón · 4:00:00');
  // Las distancias rápidas son las de los récords (más 1 km)
  assert.deepEqual(C.RESULT_DISTANCES.slice(1).map((d) => d.km), RACE_DISTANCES.map((d) => d.km));
  assert.equal(C.RESULT_DISTANCES[0].km, 1);
  // Otro tipo de hecho nunca guarda `result`
  assert.equal(C.entryRecord({ kind: 'event', type: 'holidays', date: { date: T, precision: 'day' }, result: { km: 5, sec: 1500 } }, { id: 'h' }).result, undefined);
});

test('validar: distancia y tiempo obligatorios, límites, nada en el futuro (eso es un evento deportivo)', () => {
  const base = { kind: 'event', type: 'race_result', date: { date: ago(10), precision: 'day' }, text: '', notes: '' };
  assert.deepEqual(C.validateEntry({ ...base, result: { km: 10, sec: 3600 } }, T), {});
  const e1 = C.validateEntry({ ...base, result: {} }, T);
  assert.deepEqual(Object.keys(e1).sort(), ['km', 'sec']);
  assert.match(C.validateEntry({ ...base, result: { km: 0.05, sec: 60 } }, T).km, /Entre 0,1 y 250 km/);
  assert.match(C.validateEntry({ ...base, result: { km: 10, sec: 0 } }, T).sec, /Indica el tiempo/);
  assert.match(C.validateEntry({ ...base, date: { date: addDays(T, 3), precision: 'day' }, result: { km: 10, sec: 3600 } }, T).date, /Eventos deportivos/);
  // El mes en curso sí (empieza antes de hoy)
  assert.deepEqual(C.validateEntry({ ...base, date: { date: T, precision: 'month' }, result: { km: 10, sec: 3600 } }, T), {});
  assert.match(C.validateEntry({ ...base, result: { km: 10, sec: 3600, elevationM: -5 } }, T).elevationM, /Entre 0/);
});

test('leer: un resultado ilegible se conserva sin números (se ve, no se calcula); fecha efectiva = mitad del periodo', () => {
  const damaged = C.normalizeEntry({ id: 'x', kind: 'event', type: 'race_result', date: { date: '2026-05-01', precision: 'month' }, result: { km: 'diez', sec: -1 } });
  assert.equal(damaged.result, null);
  assert.match(C.entryLine(damaged), /sin distancia o tiempo válidos/);
  assert.deepEqual(C.raceResults([damaged], T), []);
  const may = result('2026-05-01', 'month', 10, 3600);
  assert.equal(C.resultDate(may, T), '2026-05-16');
  assert.equal(C.resultDate(result(T, 'month', 10, 3600), T), T, 'el mes en curso no pasa de hoy');
  assert.equal(C.resultDate(result('2026-01-01', 'year', 10, 3600), T), '2026-07-02');
  // Ordenados de lo más reciente a lo más antiguo
  const list = [may, result(ago(20), 'day', 5, 1500), result('2025-11-01', 'month', 21.0975, 7000)];
  assert.deepEqual(C.raceResults(list, T).map((r) => r.km), [5, 10, 21.0975]);
});

test('un resultado no es un «cambio reciente» (es una referencia, como el peso habitual)', () => {
  const list = [result(ago(3), 'day', 10, 3000), C.entryRecord({ kind: 'event', type: 'holidays', date: { date: ago(5), precision: 'day' } }, { id: 'v' })];
  assert.deepEqual(C.recentChanges(list, T).map((c) => c.entry.type), ['holidays']);
});

test('copia de seguridad: el resultado viaja estructurado y la copia se valida', () => {
  const ctx = [result('2026-05-01', 'month', 10, 3600, { notes: 'Con calor' })];
  const backup = { app: BACKUP_APP_ID, format: BACKUP_FORMAT, exportedAt: 1, data: { meta: [{ id: 'settings', ...defaultSettings() }], context: JSON.parse(JSON.stringify(ctx)) } };
  const v = validateBackup(backup);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.counts.context, 1);
  const back = C.normalizeAll(backup.data.context)[0];
  assert.deepEqual(back.result, ctx[0].result);
  assert.equal(back.notes, 'Con calor');
});

// ---------------------------------------------------------------------------
// Tiempos previstos
// ---------------------------------------------------------------------------

test('recencia más allá de 12 semanas: sigue la misma curva sin saltos, baja y nunca llega a 0', () => {
  approx(recencyWeight(WINDOW_DAYS), 0.5);
  const slopeIn = recencyWeight(WINDOW_DAYS) - recencyWeight(WINDOW_DAYS - 1);
  const slopeOut = recencyWeight(WINDOW_DAYS + 1) - recencyWeight(WINDOW_DAYS);
  approx(slopeIn, slopeOut, 1e-4); // misma pendiente (las diferencias discretas difieren en O(h²))
  approx(recencyWeight(150), 0.5 * Math.exp(-66 / 84));
  assert.ok(recencyWeight(150) > 0.2 && recencyWeight(150) < 0.25, String(recencyWeight(150)));
  assert.ok(recencyWeight(365) > 0 && recencyWeight(365) < 0.02);
  for (let d = 0; d < 700; d += 7) assert.ok(recencyWeight(d + 7) < recencyWeight(d));
});

test('caso A: un 10K de hace 3 semanas + running regular → cuenta como una carrera más; confianza alta', () => {
  const ctx = analyzeRuns(data(REGULAR(), [result(ago(21), 'day', 10, 3300)]));
  assert.equal(ctx.history.length, 0);
  const c = ctx.valid.find((e) => e.source === 'context');
  assert.ok(c && !c.old && c.km === 10);
  const r = predictRaces(data(REGULAR(), [result(ago(21), 'day', 10, 3300)]));
  const p = r.predictions['10k'];
  assert.equal(p.status, 'ok');
  assert.equal(p.confidence, 'alta');
  assert.ok(p.efforts.some((e) => e.source === 'context'), 'en la base: es de las mejores');
  for (const race of RACES) assertSane(r.predictions[race.id], race.id);
});

test('caso B: un 10K de hace 5 meses + poco running → referencia con poco peso; confianza baja y «todavía poco fiable»', () => {
  const sessions = [run(ago(5), 4, 1500)];
  const ref = result('2026-05-01', 'month', 10, 3600);
  const r = predictRaces(data(sessions, [ref]));
  assert.equal(r.ok, true, 'mejor que «Datos insuficientes»: hay una marca real');
  const p = r.predictions['10k'];
  assert.equal(p.status, 'tentative');
  assert.deepEqual(p.tentativeWhy, ['history']);
  assert.equal(p.confidence, 'baja');
  const old = p.efforts.find((e) => e.old);
  assert.ok(old.share < 0.2, `pesa poco: ${old.share}`);
  assert.equal(old.interrupted.kind, 'gap', 'después estuvo semanas sin correr');
  assert.match(p.advice.note, /^Tienes pocos datos recientes\. Tu referencia es 10 km en 1:00:00 \(may 2026\), pero es de hace 5 meses y después hubo \d+ semanas sin correr, así que sirve como orientación, no como predicción de hoy\.$/);
  assertSane(p, '10k');
});

test('caso C: 10K antiguo + parón apuntado después + sin actividad → influencia mínima, explicada; la referencia sola sigue sirviendo', () => {
  const ref = result('2026-05-01', 'month', 10, 3600);
  const brk = phase('break', '2026-06-01', '2026-08-01');
  const r = predictRaces(data([], [ref, brk]));
  assert.equal(r.ok, true);
  const p = r.predictions['10k'];
  assert.equal(p.status, 'tentative');
  assert.equal(p.confidence, 'baja');
  const e = p.efforts[0];
  assert.equal(e.interrupted.kind, 'context', 'manda el parón que apuntaste');
  assert.equal(e.wBreak, BREAK_FACTOR);
  approx(e.weight, recencyWeight(e.age) * 1 * BREAK_FACTOR);
  assert.equal(fmtRaceTime(p.mid), '1:00:00', 'la referencia sola: su propio tiempo');
  assert.ok(p.confidenceCodes.includes('break') && p.confidenceCodes.includes('history'));
  assert.match(p.advice.note, /después hubo «Parón o entrenamiento irregular» \(jun 2026 – ago 2026\)/);
  // Con una carrera reciente, esa marca influye muy poco
  const r2 = predictRaces(data([run(ago(4), 5, 1700), run(ago(12), 6, 2100)], [ref, brk]));
  const old = r2.predictions['10k'].efforts.find((x) => x.old);
  assert.ok(old.share < 0.1, `muy poco: ${old.share}`);
  assert.equal(old.wBreak, BREAK_FACTOR);
});

test('reciente frente a antigua: el mismo 10K pesa mucho menos con 5 meses; antes de un parón, la mitad', () => {
  const w = (ctx) => predictDistance(ctx, 10).efforts.find((e) => e.source === 'context').weight;
  const recent = analyzeRuns(data([run(ago(2), 5, 1600), run(ago(9), 6, 1950)], [result(ago(20), 'day', 10, 3300)]));
  const old = analyzeRuns(data([run(ago(2), 5, 1600), run(ago(9), 6, 1950)], [result(ago(150), 'day', 10, 3300)]));
  approx(w(recent), recencyWeight(20));
  assert.ok(w(old) < w(recent) / 3, `${w(old)} ≪ ${w(recent)}`);
  // Un parón apuntado después reduce a la mitad también lo registrado antes de él (sin nada apuntado, igual que siempre)
  const runs = [run(ago(40), 10, 3000), run(ago(45), 5, 1450)];
  const plain = predictDistance(analyzeRuns(data(runs)), 10);
  assert.ok(plain.efforts.every((e) => e.wBreak === 1 && !e.interrupted));
  const ill = predictDistance(analyzeRuns(data(runs, [phase('illness', ago(30), ago(20), 'day')])), 10);
  assert.ok(ill.efforts.every((e) => e.wBreak === BREAK_FACTOR && e.interrupted.kind === 'context'));
  assert.ok(ill.confidenceCodes.includes('break'));
  assert.match(ill.advice.note, /^Después de tu carrera más reciente hubo un parón/);
  // Un parón antes de la carrera no la toca
  assert.equal(breakAfter(ago(10), { breaks: [{ kind: 'context', from: ago(20), label: 'x' }], today: T }), null);
});

test('un resultado reciente del contexto también es «haber corrido»: no hay hueco sin correr después de la marca antigua', () => {
  const ref = result('2026-05-01', 'month', 10, 3480);
  const alone = predictRaces(data([], [ref])).predictions['10k'].efforts.find((e) => e.old);
  assert.equal(alone.interrupted.kind, 'gap');
  // Con carreras apuntadas cada pocas semanas desde mayo, ningún hueco llega a 4 semanas
  const steady = ['2026-06-05', '2026-06-28', '2026-07-20', '2026-08-12', '2026-09-03', '2026-09-25'].map((d) => result(d, 'day', 5, 1600));
  const p = predictRaces(data([], [ref, ...steady])).predictions['10k'];
  const old = p.efforts.find((e) => e.old && e.km === 10);
  assert.ok(old, 'la de mayo entra como referencia');
  assert.equal(old.interrupted, null);
  assert.equal(old.wBreak, 1);
});

test('varias marcas históricas: como mucho HISTORY_TOP por distancia, las de más peso para ESA distancia', () => {
  const ctx = [
    result('2026-05-01', 'month', 10, 3600), result('2026-03-15', 'day', 21.0975, 8400), result('2025-11-01', 'month', 5, 1500),
    result('2024-05-01', 'year', 42.195, 15000),
  ];
  const a = analyzeRuns(data([run(ago(5), 5, 1630), run(ago(18), 6, 2050)], ctx));
  assert.equal(a.history.length, 4);
  for (const race of RACES) {
    const p = predictDistance(a, race.km, race);
    const olds = p.efforts.filter((e) => e.old);
    assert.equal(olds.length, HISTORY_TOP, race.id);
    const all = a.history.map((e) => e.km);
    assert.ok(olds.every((e) => all.includes(e.km)));
    assertSane(p, race.id);
  }
});

test('combinación: carreras recientes + una marca histórica → la estimación casi no cambia y lo explica', () => {
  const runs = [run(ago(3), 5, 1600), run(ago(8), 8, 2750), run(ago(15), 6, 2000)];
  const without = predictRaces(data(runs)).predictions['10k'];
  const withRef = predictRaces(data(runs, [result('2026-04-01', 'month', 10, 3000)])).predictions['10k'];
  const old = withRef.efforts.find((e) => e.old);
  assert.ok(old.share < 0.1, `${old.share}`);
  assert.ok(Math.abs(withRef.mid - without.mid) / without.mid < 0.03, `${withRef.mid} vs ${without.mid}`);
  assert.equal(withRef.status, 'ok');
  // «¿Por qué?»: qué se usó, que es histórica y por qué pesa menos
  const rows = withRef.why.data.map((x) => `${x.label} = ${x.value}`);
  assert.ok(rows.some((t) => /^abr 2026 · 10 km en 50:00 \(5:00\/km\) · referencia histórica = → 50:00 · pesa un \d+ %$/.test(t)), rows.join('\n'));
  // Después de abril no corrió hasta finales de septiembre: también pesa la mitad por ese hueco
  assert.ok(rows.some((t) => /^Por qué pesa menos \(10 km, abr 2026\) = Es de hace 6 meses y después hubo \d+ semanas sin correr\.$/.test(t)), rows.join('\n'));
  assert.match(withRef.why.rule, /Tus resultados de carrera de «Tu contexto» también cuentan/);
  assert.match(withRef.why.rule, /Tu historial importa, pero tu estado reciente importa más/);
});

test('posible duplicado con una actividad importada: cuenta una sola vez (la registrada); nada se borra', () => {
  const imported = run(ago(20), 10.12, 3615, { source: 'import' });
  const ref = result(ago(20), 'day', 10, 3600);
  const r = predictRaces(data([imported, run(ago(5), 5, 1630)], [ref]));
  assert.equal(r.duplicates.length, 1);
  assert.deepEqual({ entryId: r.duplicates[0].entryId, sessionId: r.duplicates[0].sessionId }, { entryId: ref.id, sessionId: imported.id });
  assert.equal(r.valid, 2, 'la carrera y la otra; no tres');
  assert.equal(r.weeklyKm, (10.12 + 5) / 6, 'el volumen tampoco se cuenta dos veces');
  const p = r.predictions['10k'];
  assert.ok(!p.efforts.some((e) => e.source === 'context'));
  assert.ok(p.why.data.some((x) => x.label === 'No se cuenta dos veces' && /la misma carrera que la registrada/.test(x.value)));
  // Fecha aproximada: dentro del periodo cuenta como la misma
  assert.equal(predictRaces(data([imported, run(ago(5), 5, 1630)], [result(ago(20), 'month', 10, 3600)])).duplicates.length, 1);
  // Fuera de tolerancia (tiempo +10 %) o carrera registrada antigua (fuera de las 12 semanas) → no es duplicado
  assert.equal(predictRaces(data([imported, run(ago(5), 5, 1630)], [result(ago(20), 'day', 10, 3960)])).duplicates.length, 0);
  const oldRun = run(ago(120), 10.05, 3610);
  const r3 = predictRaces(data([oldRun, run(ago(5), 5, 1630)], [result(ago(120), 'day', 10, 3600)]));
  assert.equal(r3.duplicates.length, 0);
  assert.equal(r3.history.length, 1, 'la registrada antigua no cuenta: la marca del contexto sí, como referencia');
});

test('qué basta para predecir: sin nada, insuficiente; un resultado del contexto, sí; una sola carrera registrada, como antes, no', () => {
  assert.equal(predictRaces(data([])).ok, false);
  assert.equal(predictRaces(data([run(ago(3), 5, 1500)])).ok, false);
  const only = predictRaces(data([], [result('2026-05-01', 'month', 10, 3600)]));
  assert.equal(only.ok, true);
  for (const race of RACES) assertSane(only.predictions[race.id], race.id);
  const recentOnly = predictRaces(data([], [result(ago(10), 'day', 5, 1500)])).predictions['5k'];
  assert.equal(recentOnly.status, 'tentative');
  assert.match(recentOnly.advice.note, /^Solo tienes una carrera reciente/);
  // Ritmo imposible o menos de 1 km: no cuenta (y se puede revisar)
  const bad = predictRaces(data([], [result(ago(10), 'day', 5, 31 * 3600), result(ago(12), 'day', 0.4, 80)]));
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.suspect.map((x) => [x.source, x.why]), [['context', 'slow']]);
  assert.match(bad.message, /1 resultado de tu contexto de menos de 1 km, 1 resultado de tu contexto con un ritmo imposible/);
  // «¿Puedo hacerlo?» y «Cómo vas» con solo la marca: veredicto orientativo, avisando
  const c = checkTarget(data([], [result('2026-05-01', 'month', 10, 3600)]), 10, 55 * 60);
  assert.equal(c.verdict, 'hoy_no');
  assert.match(c.text, /confianza de esta estimación es baja\. Tienes pocos datos recientes/);
  const rp = racePrediction(data([], [result('2026-05-01', 'month', 10, 3600)]), { id: 'x', type: '10k', date: addDays(T, 40), distanceKm: 10, targetSec: null }, { today: T });
  assert.equal(rp.label, 'Orientativo');
  assert.match(rp.text, /^Estimación orientativa hoy: /);
});

test('propiedad: mezclas aleatorias de carreras, resultados del contexto y parones → siempre números y textos válidos', () => {
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < 200; i++) {
    const sessions = Array.from({ length: Math.floor(rnd() * 5) }, () => { const km = pick([3, 5, 8, 10, 15, 21.1]); return run(ago(Math.floor(rnd() * 120)), km, Math.round(km * (180 + rnd() * 600))); });
    const context = Array.from({ length: Math.floor(rnd() * 4) }, () => { const km = pick([1, 5, 10, 21.0975, 42.195, 7.3]); return result(ago(Math.floor(rnd() * 700)), pick(['day', 'month', 'season', 'year']), km, Math.round(km * (170 + rnd() * 700))); });
    if (rnd() < 0.4) context.push(phase(pick(['break', 'illness', 'injury', 'return']), ago(Math.floor(rnd() * 200)), null, 'day'));
    const r = predictRaces(data(sessions, context));
    if (!r.ok) continue;
    for (const race of RACES) assertSane(r.predictions[race.id], `#${i} ${race.id}`);
    const c = checkTarget(data(sessions, context), pick([5, 10, 21.0975]), 3000);
    // Ni negativos ni basura («invierno 2025-26» sí es válido: guion entre cifras)
    assert.ok(!/(^|[^\d])[-−]\d|:-|NaN|Infinity|undefined/.test(c.text), c.text);
  }
});

// ---------------------------------------------------------------------------
// Informe para tu IA
// ---------------------------------------------------------------------------

test('informe: «REFERENCIAS HISTÓRICAS DE RUNNING» con las más recientes primero, como mucho 5, sin nombres ni notas', () => {
  const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
  const context = [
    result('2026-05-01', 'month', 10, 3600, { text: 'Carrera de mi barrio', notes: 'nota privada', result: { km: 10, sec: 3600, effort: 'race', surface: 'road' } }),
    result('2026-03-15', 'day', 21.0975, 8400), result('2025-11-01', 'month', 5, 1500), result('2025-06-01', 'season', 10, 3500),
    result('2025-01-01', 'year', 42.195, 15000), result('2024-01-01', 'year', 5, 1400), phase('break', '2026-06-01', '2026-08-01'),
  ];
  const d = { sessions: [run(ago(5), 5, 1630)], context, exercises: EX, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], checkins: [], today: T };
  const a = buildAnalysis(d, T);
  assert.equal(a.runningRefs.total, 6);
  const txt = reportText(a);
  const sec = txt.split('\n\n').find((b) => b.startsWith('REFERENCIAS HISTÓRICAS DE RUNNING'));
  assert.ok(sec, txt);
  const lines = sec.split('\n').slice(1);
  assert.equal(lines.length, MAX_RUN_REFS + 1);
  assert.match(lines[0], /^- 10 km — 1:00:00 — mayo 2026 \(hace 5 meses; carrera oficial; asfalto\) · después hubo «Parón o entrenamiento irregular» \(jun 2026 – ago 2026\)$/);
  assert.match(lines[1], /^- Media maratón — 2:20:00 — 15 mar 2026 \(hace 7 meses\) · después hubo «Parón o entrenamiento irregular»/);
  assert.equal(lines[5], '- (1 más antiguas sin listar)');
  assert.ok(!/Carrera de mi barrio|nota privada/.test(txt), 'sin nombres ni notas');
  // Justo después de RUNNING
  const blocks = txt.split('\n\n').map((b) => b.split('\n')[0]);
  assert.equal(blocks.indexOf(sec.split('\n')[0]) - 1, blocks.findIndex((b) => b.startsWith('RUNNING')));
  // Sin resultados apuntados: no sale
  assert.ok(!reportText(buildAnalysis({ ...d, context: [] }, T)).includes('REFERENCIAS HISTÓRICAS DE RUNNING'));
});

test('análisis: la «forma en carrera» por bloques sigue siendo solo lo registrado', async () => {
  const { fitnessBlocks } = await import('../../js/analysis-training.js');
  const sessions = [run(ago(3), 5, 1500), run(ago(10), 5, 1520)];
  const d = { sessions, context: [result(ago(6), 'day', 5, 1200)], exercises: new Map(), settings: {}, bodyweight: [], today: T };
  const with_ = fitnessBlocks(d, { today: T });
  const without = fitnessBlocks({ ...d, context: [] }, { today: T });
  assert.deepEqual(with_.map((b) => b.pred5kSec), without.map((b) => b.pred5kSec));
  assert.equal(with_.at(-1).runs, 2);
});
