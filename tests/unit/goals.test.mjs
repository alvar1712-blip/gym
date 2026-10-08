// Pruebas de js/goals-logic.js (objetivos, Fase 3) con datos construidos a mano.
// Hoy = jueves 24 sep 2026. Semanas (lunes): … 31 ago, 7 sep, 14 sep, 21 sep.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  goalProgress, goalRules, sufficiency, etaRange, etaText, progressPercent, autoTitle, validateGoal, goalRecord,
  splitGoals, fmtTimeWords, fmtDistance, goalWeightText, goalEmoji, createdDateOf, fmtDay, NONLINEAR_NOTE,
  TREND_WEEKS, RECENT_DAYS, MIN_MARGIN, LONG_DAYS, MIN_KM, DEFAULT_RULES,
} from '../../js/goals-logic.js';
import { e1rm, linearRegression, dayIndex } from '../../js/calc.js';
import { predictFor, predictionSeries, baseOf, rangeText } from '../../js/race-predict.js';
import { bwStats } from '../../js/activity-logic.js';
import { defaultSettings } from '../../js/seed.js';
import { tsFromDate, addDays, weekStart } from '../../js/util.js';

const TODAY = '2026-09-24';
const EX = {
  row: { id: 'row', name: 'Remo', logType: 'weight_reps', pattern: 'pull_h', primary: ['back'], secondary: [] },
  pull: { id: 'pull', name: 'Dominadas', logType: 'bodyweight', pattern: 'pull_v', primary: ['back'], secondary: [] },
  wheel: { id: 'wheel', name: 'Rueda abdominal', logType: 'bodyweight', pattern: 'core', primary: ['core'], secondary: [] },
  lunge: { id: 'lunge', name: 'Zancadas', logType: 'unilateral', pattern: 'lunge', primary: ['quads'], secondary: [] },
  plank: { id: 'plank', name: 'Plancha', logType: 'time', pattern: 'core', primary: ['core'], secondary: [] },
};

let seq = 0;
const set = (weight, reps, extra = {}) => ({ id: `st${++seq}`, type: 'effective', weight, reps, repsR: null, rir: 0, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: 1, ...extra });
/** Sesión de fuerza con un ejercicio. */
function ses(date, exerciseId, sets, extra = {}) {
  return { id: `s${++seq}`, kind: 'strength', status: 'done', date, startedAt: tsFromDate(date, 18), durationMin: 60, rpe: 8, exercises: [{ id: `se${seq}`, exerciseId, sets }], ...extra };
}
function act(kind, date, km, sec, extra = {}) {
  return { id: `a${++seq}`, kind, status: 'done', date, distanceKm: km, movingSec: sec, durationMin: sec / 60, rpe: 5, startedAt: tsFromDate(date, 8), ...extra };
}
function data({ sessions = [], bodyweight = [], settings = defaultSettings(), today = TODAY } = {}) {
  return { sessions, exercises: new Map(Object.values(EX).map((e) => [e.id, e])), settings, bodyweight, today };
}
const created = (date, h = 10) => tsFromDate(date, h);
const strengthGoal = (o = {}) => ({ id: 'g1', kind: 'strength', exerciseId: 'row', weight: 80, reps: 5, createdAt: created('2026-07-01'), achievedAt: null, archived: false, ...o });
const runGoal = (o = {}) => ({ id: 'g2', kind: 'endurance', sport: 'run', distanceKm: 10, timeSec: 45 * 60, createdAt: created('2026-07-01'), ...o });
const bwGoal = (o = {}) => ({ id: 'g3', kind: 'bodyweight', targetKg: 77, direction: 'up', createdAt: created('2026-08-01'), ...o });
/** Lunes de la semana `w` contando hacia atrás desde la actual (0 = 21 sep). */
const monday = (w) => addDays('2026-09-21', -7 * w);
/** Fórmula del rango, escrita aparte para comprobar etaRange. */
function expectedRange(gap, slope, se) {
  const t = gap / slope;
  const lo = Math.min(se ? gap / (slope + se) : t, t * (1 - MIN_MARGIN));
  const hi = Math.max(se && slope - se > 0 ? gap / (slope - se) : se ? Infinity : t, t * (1 + MIN_MARGIN));
  const fromDays = Math.max(1, Math.floor(lo));
  return { fromDays, toDays: Number.isFinite(hi) ? Math.max(fromDays + 1, Math.ceil(hi)) : null };
}
/** Remo semanal (lunes), `n` semanas hasta el 21 sep, peso que sube `inc` kg cada semana. 5 reps @0. */
function rowWeekly(n, start, inc, reps = 5) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(ses(monday(i), 'row', [set(start + inc * (n - 1 - i), reps)]));
  return out;
}

// ===========================================================================
// Reglas, suficiencia y rango
// ===========================================================================

test('goalRules: umbrales de settings.goals con valores por defecto', () => {
  assert.deepEqual(goalRules(defaultSettings()), { minRecords: 4, minWeeks: 3 });
  assert.deepEqual(goalRules({}), DEFAULT_RULES);
  assert.deepEqual(goalRules(null), DEFAULT_RULES);
  assert.deepEqual(goalRules({ goals: { minRecords: 6, minWeeks: 5 } }), { minRecords: 6, minWeeks: 5 });
  assert.deepEqual(goalRules({ goals: { minRecords: 'x', minWeeks: 0 } }), DEFAULT_RULES, 'inválidos → por defecto');
  assert.deepEqual(goalRules({ goals: { minRecords: 1, minWeeks: 1 } }), { minRecords: 4, minWeeks: 1 }, 'una regresión necesita ≥ 2 registros');
});

test('sufficiency: registros, semanas distintas (lunes a domingo) y días entre el primero y el último, con lo que falta', () => {
  const r = sufficiency(['2026-09-14', '2026-09-20', '2026-09-21'], { minRecords: 4, minWeeks: 3 });
  assert.deepEqual(r, { records: 3, weeks: 2, spanDays: 7, minRecords: 4, minWeeks: 3, minSpanDays: 14, missingRecords: 1, missingWeeks: 1, missingSpan: 7, ok: false });
  assert.equal(sufficiency(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'], DEFAULT_RULES).ok, true);
  assert.deepEqual(sufficiency([], DEFAULT_RULES), { records: 0, weeks: 0, spanDays: 0, minRecords: 4, minWeeks: 3, minSpanDays: 14, missingRecords: 4, missingWeeks: 3, missingSpan: 14, ok: false });
  // Domingo, lunes, domingo y lunes: 4 registros que tocan 3 semanas pero solo abarcan 8 días → no bastan
  const tight = sufficiency(['2026-09-13', '2026-09-14', '2026-09-20', '2026-09-21'], DEFAULT_RULES);
  assert.deepEqual([tight.records, tight.weeks, tight.spanDays, tight.missingSpan, tight.ok], [4, 3, 8, 6, false]);
  // Con 14 días entre el primero y el último, sí (el orden de las fechas da igual)
  assert.equal(sufficiency(['2026-09-21', '2026-09-07', '2026-09-14', '2026-09-15'], DEFAULT_RULES).ok, true);
  // Domingo y lunes siguiente = dos semanas, pero 1 día: con minWeeks 2 hacen falta 7 días
  assert.equal(sufficiency(['2026-09-20', '2026-09-21'], { minRecords: 2, minWeeks: 2 }).ok, false);
  assert.equal(sufficiency(['2026-09-14', '2026-09-21'], { minRecords: 2, minWeeks: 2 }).ok, true);
  // minWeeks 1: sin mínimo de días
  assert.equal(sufficiency(['2026-09-21', '2026-09-21'], { minRecords: 2, minWeeks: 1 }).minSpanDays, 0);
});

test('etaRange: pendiente ± 1 error típico con un mínimo de ±20 % del tiempo restante', () => {
  // Sin error típico: exactamente ±20 %
  let e = etaRange(10, 1, 0, TODAY);
  assert.deepEqual([e.fromDays, e.toDays], [8, 12]);
  assert.equal(e.from, '2026-10-02');
  assert.equal(e.to, '2026-10-06');
  assert.equal(e.centerDays, 10);
  assert.equal(e.beyond, false);
  // Error típico pequeño → manda el mínimo de ±20 %
  e = etaRange(10, 1, 0.01, TODAY);
  assert.deepEqual([e.fromDays, e.toDays], [8, 12]);
  // Error típico grande → manda la pendiente ± 1 error típico
  e = etaRange(10, 1, 0.5, TODAY);
  assert.deepEqual([e.fromDays, e.toDays], [6, 20]);
  assert.deepEqual([e.fromDays, e.toDays], [expectedRange(10, 1, 0.5).fromDays, expectedRange(10, 1, 0.5).toDays]);
  // Error típico ≥ pendiente → el extremo lento no llega nunca
  e = etaRange(10, 1, 1.2, TODAY);
  assert.equal(e.toDays, null);
  assert.equal(e.to, null);
  assert.equal(e.beyond, true);
  // Mínimo 1 día; siempre from < to (nunca una fecha exacta)
  e = etaRange(0.1, 1, 0, TODAY);
  assert.equal(e.fromDays, 1);
  assert.ok(e.toDays > e.fromDays);
  // No aplica
  assert.equal(etaRange(0, 1, 0, TODAY), null);
  assert.equal(etaRange(5, 0, 0, TODAY), null);
  assert.equal(etaRange(5, -1, 0, TODAY), null);
  assert.equal(etaRange(5, 1, 0, 'mañana'), null);
  // Más de 2 años
  e = etaRange(1000, 1, 0, TODAY);
  assert.equal(e.allBeyond, true);
  assert.equal(e.beyond, true);
  e = etaRange(700, 1, 0, TODAY); // 560–840 días
  assert.equal(e.allBeyond, false);
  assert.equal(e.beyond, true);
});

test('etaText: días si el rango es estrecho, meses si es ancho, «más de 2 años» si se va lejos', () => {
  assert.equal(etaText(etaRange(10, 1, 0, TODAY), TODAY), 'entre el 2 oct y el 6 oct');
  assert.equal(etaText(etaRange(200, 1, 0, TODAY), TODAY), 'entre mar 2027 y may 2027'); // 160–240 días
  // Estrecho (40 días de ancho) pero lejano y cruzando de año: con día y año
  assert.equal(etaText(etaRange(100, 1, 0, TODAY), TODAY), 'entre el 13 dic 2026 y el 22 ene 2027');
  assert.equal(etaText(etaRange(95, 1, 0.01, '2026-12-01'), '2026-12-01'), 'entre el 15 feb 2027 y el 25 mar 2027');
  assert.equal(etaText(etaRange(20, 1, 0, '2026-12-20'), '2026-12-20'), 'entre el 5 ene 2027 y el 13 ene 2027');
  // Extremo cercano con día y lejano con mes
  assert.equal(etaText(etaRange(50, 1, 0.9, TODAY), TODAY), 'entre el 20 oct 2026 y feb 2028');
  assert.equal(etaText(etaRange(700, 1, 0, TODAY), TODAY), 'entre abr 2028 y más de 2 años (al ritmo actual)');
  assert.equal(etaText(etaRange(1000, 1, 0, TODAY), TODAY), 'más de 2 años al ritmo actual');
  assert.equal(etaText(etaRange(10, 1, 2, TODAY), TODAY), 'entre el 27 sep y más de 2 años (al ritmo actual)');
  assert.equal(etaText(null), '');
});

test('progressPercent: de inicio a objetivo (subir y bajar), razón en «solo distancia», 100 si conseguido', () => {
  assert.equal(progressPercent({ start: 80, current: 85, target: 90, dir: 1 }), 50);
  assert.equal(progressPercent({ start: 80, current: 75, target: 90, dir: 1 }), 0, 'por debajo del inicio → 0');
  assert.equal(progressPercent({ start: 80, current: 95, target: 90, dir: 1 }), 100, 'no pasa de 100');
  assert.equal(progressPercent({ start: 3000, current: 2850, target: 2700, dir: -1 }), 50, 'tiempo: bajar');
  assert.equal(progressPercent({ start: 78, current: 77, target: 74, dir: -1 }), 25, 'peso: bajar');
  assert.equal(progressPercent({ start: 6, current: 8, target: 10, dir: 1, ratio: true }), 80);
  assert.equal(progressPercent({ start: null, current: 8, target: 10, dir: 1 }), null, 'sin inicio → sin porcentaje («—»), no actual / objetivo');
  assert.equal(progressPercent({ start: null, current: 3000, target: 2700, dir: -1 }), null);
  assert.equal(progressPercent({ start: null, current: 12, target: 10, dir: 1 }), 100, 'sin inicio pero ya llega');
  assert.equal(progressPercent({ start: 95, current: 85, target: 90, dir: 1 }), (85 / 90) * 100, 'ya estaba por encima al crearlo');
  assert.equal(progressPercent({ start: 95, current: 92, target: 90, dir: 1 }), 100);
  assert.equal(progressPercent({ start: 80, current: 82, target: 90, dir: 1, achieved: true }), 100);
  assert.equal(progressPercent({ start: 80, current: null, target: 90, dir: 1 }), null);
});

// ===========================================================================
// Fuerza
// ===========================================================================

test('fuerza: estimación = regresión del mejor 1RM estimado por sesión; rango con el mínimo ±20 %', () => {
  // 8 semanas: 60 → 77,5 kg × 5 @0 (1RM = peso × 7/6, +2,5 kg/semana)
  const sessions = rowWeekly(8, 60, 2.5);
  const p = goalProgress(data({ sessions }), strengthGoal());
  assert.equal(p.status, 'estimate');
  assert.equal(p.ready, false);
  assert.equal(p.metric, 'e1rm');
  assert.equal(p.target, e1rm(80, 5, 0));
  assert.equal(p.targetLabel, '93,3 kg');
  assert.equal(p.current, e1rm(77.5, 5, 0));
  assert.match(p.currentNote, /77,5 kg × 5 @0 · 21 sep/);
  // pendiente 2,5 × 7/6 por semana; datos exactos → error típico ≈ 0 → ±20 %
  assert.ok(Math.abs(p.trend.slopePerWeek - (2.5 * 7) / 6) < 1e-9);
  const gap = p.target - p.current; // 2,9167 kg → 7 días
  const exp = expectedRange(gap, (2.5 * 7) / 6 / 7, 0);
  assert.deepEqual([p.eta.fromDays, p.eta.toDays], [exp.fromDays, exp.toDays]);
  assert.deepEqual([p.eta.fromDays, p.eta.toDays], [5, 9]);
  assert.equal(p.eta.from, '2026-09-29');
  assert.equal(p.eta.to, '2026-10-03');
  assert.equal(p.etaText, 'entre el 29 sep y el 3 oct');
  assert.match(p.explanation, /Tu 1RM estimado actual es 90,4 kg: faltan 2,9 kg\. Al ritmo de \+2,9 kg\/sem \(8 sesiones en las últimas 12 semanas\), llegarías entre el 29 sep y el 3 oct\./);
  assert.match(p.method, /Epley/);
  assert.match(p.rule, /4 registros o más en al menos 3 semanas distintas/);
  assert.equal(p.dataUsed.length, 8);
  assert.deepEqual(p.dataUsed[0], { date: '2026-08-03', label: '3 ago', value: '70 kg · 60 kg × 5 @0' });
  assert.equal(p.counts.records, 8);
  assert.equal(p.counts.weeks, 8);
  assert.equal(p.statusLabel, 'Estimación');
  assert.equal(p.achievedOn, null);
});

test('fuerza: con ruido, el rango sale de la pendiente ± 1 error típico', () => {
  const ws = [60, 64, 61, 66, 63, 68, 65, 70, 67, 72];
  const sessions = ws.map((w, i) => ses(monday(ws.length - 1 - i), 'row', [set(w, 5)]));
  const p = goalProgress(data({ sessions }), strengthGoal({ weight: 90 }));
  assert.equal(p.status, 'estimate');
  const pts = sessions.map((s) => [dayIndex(s.date), e1rm(s.exercises[0].sets[0].weight, 5, 0)]);
  const reg = linearRegression(pts.map((x) => x[0]), pts.map((x) => x[1]));
  assert.ok(Math.abs(p.trend.slopePerWeek - reg.slope * 7) < 1e-9);
  assert.ok(Math.abs(p.trend.sePerWeek - reg.seSlope * 7) < 1e-9);
  const current = e1rm(72, 5, 0); // mejor de las últimas 4 semanas
  assert.equal(p.current, current);
  const exp = expectedRange(e1rm(90, 5, 0) - current, reg.slope, reg.seSlope);
  assert.deepEqual([p.eta.fromDays, p.eta.toDays], [exp.fromDays, exp.toDays]);
  // Con ese ruido el error típico ensancha el rango más allá del ±20 %
  const t = (e1rm(90, 5, 0) - current) / reg.slope;
  assert.ok(p.eta.toDays > Math.ceil(t * 1.2));
  assert.ok(p.eta.from < p.eta.to);
});

test('fuerza: conseguido con una serie de trabajo de peso ≥ y reps ≥ desde que se creó (no antes, ni calentamiento ni pendiente)', () => {
  const sessions = [
    ses('2026-06-20', 'row', [set(85, 6)]), // antes de crearlo: no cuenta
    ses('2026-09-01', 'row', [set(80, 5, { type: 'warmup' }), set(80, 6, { done: false }), set(77.5, 8)]),
    ses('2026-09-08', 'row', [set(80, 4), set(82.5, 5, { rir: 1 })]),
    ses('2026-09-15', 'row', [set(85, 5)]),
  ];
  const p = goalProgress(data({ sessions }), strengthGoal({ createdAt: created('2026-07-01') }));
  assert.equal(p.status, 'achieved');
  assert.equal(p.achievedOn, '2026-09-08');
  assert.equal(p.progressPct, 100);
  assert.equal(p.statusLabel, 'Conseguido');
  assert.equal(p.eta, null);
  assert.equal(p.explanation, 'Conseguido el 8 sep: 82,5 kg × 5 @1 (objetivo 80 kg × 5).');
  // Creado después del 8 sep → el 15 sep
  assert.equal(goalProgress(data({ sessions }), strengthGoal({ createdAt: created('2026-09-10') })).achievedOn, '2026-09-15');
  // El mismo día de creación cuenta (la sesión de ese día)
  assert.equal(goalProgress(data({ sessions }), strengthGoal({ createdAt: created('2026-09-08', 23) })).achievedOn, '2026-09-08');
  // Sesiones no terminadas no cuentan
  const active = [ses('2026-09-20', 'row', [set(90, 5)], { status: 'active' })];
  assert.notEqual(goalProgress(data({ sessions: active }), strengthGoal()).status, 'achieved');
});

test('fuerza: «al alcance» si el 1RM estimado reciente ya llega pero no hay una serie que lo consiga', () => {
  // 75 × 9 @1 → 1RM 100 kg > 93,3 kg del objetivo 80 × 5, pero ninguna serie de 80 kg
  const sessions = [ses('2026-09-14', 'row', [set(75, 9, { rir: 1 })]), ses('2026-09-21', 'row', [set(75, 8, { rir: 1 })])];
  const p = goalProgress(data({ sessions }), strengthGoal());
  assert.equal(p.status, 'estimate');
  assert.equal(p.ready, true);
  assert.equal(p.eta, null);
  assert.equal(p.statusLabel, 'Al alcance');
  assert.equal(p.progressPct, 100);
  assert.match(p.explanation, /ya iguala o supera el equivalente del objetivo \(93,3 kg\)/);
  // Una serie antes de crearlo que cumple: también «al alcance», no conseguido
  const before = [ses('2026-09-14', 'row', [set(80, 5)])];
  const q = goalProgress(data({ sessions: before }), strengthGoal({ createdAt: created('2026-09-20') }));
  assert.equal(q.status, 'estimate');
  assert.equal(q.ready, true);
});

test('fuerza: datos insuficientes con recuentos (y los umbrales salen de settings.goals)', () => {
  const sessions = [ses('2026-09-08', 'row', [set(60, 5)]), ses('2026-09-10', 'row', [set(61, 5)]), ses('2026-09-16', 'row', [set(62, 5)])];
  let p = goalProgress(data({ sessions }), strengthGoal());
  assert.equal(p.status, 'insufficient');
  assert.equal(p.statusLabel, 'Datos insuficientes');
  assert.equal(p.eta, null);
  assert.deepEqual([p.counts.records, p.counts.weeks, p.counts.missingRecords, p.counts.missingWeeks], [3, 2, 1, 1]);
  assert.equal(p.explanation, 'Datos insuficientes para estimar: 3 sesiones con Remo en 2 semanas (las últimas 12 semanas). Hacen falta 4 registros en al menos 3 semanas distintas, con 14 días o más entre el primero y el último: faltan 1 sesión y 1 semana más con registros.');
  assert.equal(p.current, e1rm(62, 5, 0), 'el valor actual se muestra igualmente');
  assert.equal(p.dataUsed.length, 3);
  // Solo falta un registro
  const s4 = [...sessions, ses('2026-08-31', 'row', [set(59, 5)])].slice(1);
  p = goalProgress(data({ sessions: s4 }), strengthGoal());
  assert.match(p.explanation, /: falta 1 sesión\.$/);
  // Umbrales más bajos en Ajustes → ya hay estimación
  const settings = defaultSettings();
  settings.goals = { minRecords: 3, minWeeks: 2 };
  p = goalProgress(data({ sessions, settings }), strengthGoal());
  assert.equal(p.status, 'estimate');
  assert.match(p.rule, /3 registros o más en al menos 2 semanas distintas/);
  // Umbrales más altos → insuficiente aunque haya 8 semanas
  settings.goals = { minRecords: 10, minWeeks: 3 };
  p = goalProgress(data({ sessions: rowWeekly(8, 60, 2.5), settings }), strengthGoal());
  assert.equal(p.status, 'insufficient');
  assert.equal(p.counts.missingRecords, 2);
  // Sin ningún registro
  p = goalProgress(data({ sessions: [] }), strengthGoal());
  assert.equal(p.status, 'insufficient');
  assert.equal(p.current, null);
  assert.equal(p.currentLabel, '—');
  assert.equal(p.progressPct, null);
  assert.match(p.explanation, /0 sesiones con Remo en 0 semanas.*faltan 4 sesiones y 3 semanas más con registros/);
});

test('fuerza: sin tendencia si la pendiente es nula o en contra', () => {
  let p = goalProgress(data({ sessions: rowWeekly(6, 75, -1.25) }), strengthGoal());
  assert.equal(p.status, 'no_trend');
  assert.equal(p.statusLabel, 'Sin tendencia');
  assert.equal(p.eta, null);
  assert.ok(p.trend.slopePerWeek < 0);
  assert.match(p.explanation, /^Con la tendencia actual no se acerca: tu 1RM estimado va en contra del objetivo \(−1,5 kg\/sem\)/);
  p = goalProgress(data({ sessions: rowWeekly(6, 70, 0) }), strengthGoal());
  assert.equal(p.status, 'no_trend');
  assert.match(p.explanation, /se mantiene en las últimas 12 semanas \(6 sesiones\)/);
});

test('fuerza: la tendencia solo usa las últimas 12 semanas (o minWeeks si es mayor)', () => {
  // Sesiones antiguas muy fuertes (hace 18–19 semanas) no cambian la pendiente reciente
  const old = [ses(monday(19), 'row', [set(100, 5)]), ses(monday(18), 'row', [set(100, 5)])];
  const recent = rowWeekly(6, 60, 2.5);
  const p = goalProgress(data({ sessions: [...old, ...recent] }), strengthGoal());
  assert.equal(p.status, 'estimate');
  assert.ok(Math.abs(p.trend.slopePerWeek - (2.5 * 7) / 6) < 1e-9);
  assert.equal(p.counts.records, 6);
  assert.equal(p.counts.windowFrom, addDays(TODAY, -(TREND_WEEKS * 7 - 1)));
  assert.equal(p.dataUsed.length, 6);
  // minWeeks = 20 → ventana de 20 semanas: entran más semanas
  const settings = defaultSettings();
  settings.goals = { minRecords: 4, minWeeks: 20 };
  const long = rowWeekly(18, 50, 1);
  assert.equal(goalProgress(data({ sessions: long }), strengthGoal()).counts.records, 12);
  const q = goalProgress(data({ sessions: long, settings }), strengthGoal());
  assert.equal(q.counts.windowWeeks, 20);
  assert.equal(q.counts.records, 18);
  // …pero las antiguas separadas por una pausa de 13 semanas no cuentan (la tendencia empieza tras la pausa)
  const r = goalProgress(data({ sessions: [...old, ...recent], settings }), strengthGoal());
  assert.equal(r.counts.records, 6);
  assert.deepEqual(r.counts.pause, { from: monday(18), to: monday(5), days: 91 });
});

test('fuerza: dos sesiones el mismo día cuentan como un registro (la mejor)', () => {
  const sessions = [...rowWeekly(4, 60, 2.5), ses(monday(0), 'row', [set(70, 5)])];
  const p = goalProgress(data({ sessions }), strengthGoal());
  assert.equal(p.counts.records, 4);
  assert.equal(p.current, e1rm(70, 5, 0));
});

test('fuerza: más de 12 repeticiones → se sigue el máximo de repeticiones con ese peso', () => {
  const sessions = [
    ses(monday(3), 'row', [set(40, 12), set(35, 20)]),
    ses(monday(2), 'row', [set(40, 13)]),
    ses(monday(1), 'row', [set(40, 14), set(37.5, 25)]),
    ses(monday(0), 'row', [set(42.5, 15)]),
  ];
  const p = goalProgress(data({ sessions }), strengthGoal({ weight: 40, reps: 20 }));
  assert.equal(p.metric, 'reps');
  assert.equal(p.target, 20);
  assert.equal(p.targetLabel, '20 reps');
  assert.equal(p.current, 15);
  assert.equal(p.status, 'estimate');
  assert.ok(Math.abs(p.trend.slopePerWeek - 1) < 1e-9);
  assert.match(p.method, /máximo de repeticiones por sesión con 40 kg o más/);
  assert.equal(p.dataUsed[0].value, '12 reps · 40 kg × 12 @0');
});

test('fuerza: peso corporal (lastre, asistencia, sin lastre) y core sin 1RM', () => {
  const bw = [{ id: '2026-08-01', kg: 75 }];
  const sessions = [
    ses(monday(3), 'pull', [set(null, 6)]),
    ses(monday(2), 'pull', [set(2.5, 6)]),
    ses(monday(1), 'pull', [set(5, 6)]),
    ses(monday(0), 'pull', [set(7.5, 6)]),
  ];
  const p = goalProgress(data({ sessions, bodyweight: bw }), strengthGoal({ exerciseId: 'pull', weight: 15, reps: 5 }));
  assert.equal(p.metric, 'e1rm');
  assert.equal(p.target, e1rm(75 + 15, 5, 0), 'peso corporal actual + lastre');
  assert.equal(p.current, e1rm(82.5, 6, 0));
  assert.match(p.targetNote, /\+15 kg × 5/);
  assert.match(p.method, /con tu peso corporal actual, 75 kg/);
  // Sin lastre = 0: cumple un objetivo «Dominadas × 6» (peso 0)
  const q = goalProgress(data({ sessions, bodyweight: bw }), strengthGoal({ exerciseId: 'pull', weight: 0, reps: 6, createdAt: created('2026-08-01') }));
  assert.equal(q.status, 'achieved');
  assert.equal(q.achievedOn, monday(3));
  assert.match(q.explanation, /Sin lastre · 6 reps/);
  // Asistencia (negativo): −10 kg asist. × 8 se cumple con −5 kg × 8
  const assisted = [ses(monday(0), 'pull', [set(-5, 8)])];
  assert.equal(goalProgress(data({ sessions: assisted, bodyweight: bw }), strengthGoal({ exerciseId: 'pull', weight: -10, reps: 8 })).status, 'achieved');
  // Core de peso corporal: sin 1RM → repeticiones
  const core = [ses(monday(0), 'wheel', [set(null, 10)])];
  const c = goalProgress(data({ sessions: core, bodyweight: bw }), strengthGoal({ exerciseId: 'wheel', weight: 0, reps: 12 }));
  assert.equal(c.metric, 'reps');
  assert.equal(c.current, 10);
});

test('fuerza: unilateral cuenta el lado con menos repeticiones', () => {
  const sessions = [ses(monday(0), 'lunge', [set(20, 10, { repsR: 7 })])];
  let p = goalProgress(data({ sessions }), strengthGoal({ exerciseId: 'lunge', weight: 20, reps: 8 }));
  assert.notEqual(p.status, 'achieved');
  assert.equal(p.current, e1rm(20, 7, 0));
  p = goalProgress(data({ sessions }), strengthGoal({ exerciseId: 'lunge', weight: 20, reps: 7, createdAt: created('2026-09-01') }));
  assert.equal(p.status, 'achieved');
});

test('fuerza: ejercicio inexistente o de otro tipo → objetivo incompleto', () => {
  let p = goalProgress(data(), strengthGoal({ exerciseId: 'nope' }));
  assert.equal(p.status, 'insufficient');
  assert.equal(p.invalid, true);
  assert.match(p.explanation, /ya no existe/);
  p = goalProgress(data(), strengthGoal({ exerciseId: 'plank' }));
  assert.equal(p.invalid, true);
  p = goalProgress(data(), { id: 'x', kind: 'otro' });
  assert.equal(p.invalid, true);
  assert.equal(goalProgress(data(), null).invalid, true);
});

test('fuerza: «actual» = mejor de las últimas 4 semanas; si no hay, el del último registro', () => {
  const sessions = [ses('2026-06-01', 'row', [set(70, 5)]), ses('2026-06-08', 'row', [set(65, 5)])];
  const p = goalProgress(data({ sessions }), strengthGoal({ createdAt: created('2026-05-01') }));
  assert.equal(p.current, e1rm(70, 5, 0));
  assert.match(p.currentNote, /último registro 1 jun/);
  const q = goalProgress(data({ sessions: rowWeekly(6, 60, 2.5) }), strengthGoal());
  assert.equal(q.current, e1rm(72.5, 5, 0));
  assert.equal(RECENT_DAYS, 28);
});

test('fuerza: inicio = el mejor de los 28 días hasta la creación; sin datos previos, el primer registro posterior', () => {
  const sessions = rowWeekly(8, 60, 2.5); // 3 ago … 21 sep
  let p = goalProgress(data({ sessions }), strengthGoal({ createdAt: created('2026-08-20') }));
  assert.equal(p.start, e1rm(65, 5, 0), 'el 17 ago (62,5 el 10 ago)');
  assert.equal(p.startLabel, '75,8 kg');
  const expPct = ((e1rm(77.5, 5, 0) - e1rm(65, 5, 0)) / (e1rm(80, 5, 0) - e1rm(65, 5, 0))) * 100;
  assert.ok(Math.abs(p.progressPct - expPct) < 1e-9);
  p = goalProgress(data({ sessions }), strengthGoal({ createdAt: created('2026-07-01') }));
  assert.equal(p.start, e1rm(60, 5, 0));
});

test('fuerza: estancado (regla de settings.stall) → sin tendencia aunque la pendiente de 12 semanas sea positiva', () => {
  // Sube 4 semanas (90 → 105 kg × 5) y se queda en 105 kg 6 sesiones más: la regresión de las 10 sesiones es
  // positiva, pero no hay mejor marca desde el 10 ago (R3C-02).
  const ws = [90, 95, 100, 105, 105, 105, 105, 105, 105, 105];
  const sessions = ws.map((w, i) => ses(monday(ws.length - 1 - i), 'row', [set(w, 5)]));
  const p = goalProgress(data({ sessions }), strengthGoal({ weight: 120, reps: 5 }));
  assert.ok(p.trend.slopePerWeek > 0, 'la pendiente sigue siendo positiva');
  assert.equal(p.status, 'no_trend');
  assert.equal(p.statusLabel, 'Sin tendencia');
  assert.equal(p.eta, null);
  assert.equal(p.etaText, '');
  assert.deepEqual(
    { since: p.stall.since, best: p.stall.best, after: p.stall.after, label: p.stall.bestLabel, S: p.stall.sessions, W: p.stall.weeks },
    { since: monday(6), best: e1rm(105, 5, 0), after: 6, label: '122,5 kg', S: 3, W: 3 },
  );
  assert.equal(p.explanation, 'Con la tendencia actual no se acerca: tu 1RM estimado no supera 122,5 kg (10 ago) en las 6 sesiones siguientes. Con tu umbral de estancamiento (3 sesiones o 3 semanas sin superar tu mejor marca) no se estima una fecha: la pendiente de +1,6 kg/sem en las últimas 12 semanas viene de las subidas anteriores.');
  assert.match(p.rule, /Si el ejercicio está estancado \(3 sesiones o 3 semanas sin superar su mejor marca/);
  // Umbrales de Ajustes más largos (7 sesiones / 8 semanas) → aún no está estancado → estimación
  const settings = defaultSettings();
  settings.stall = { sessions: 7, weeks: 8 };
  const q = goalProgress(data({ sessions, settings }), strengthGoal({ weight: 120, reps: 5 }));
  assert.equal(q.status, 'estimate');
  assert.equal(q.stall, null);
  assert.ok(q.eta);
  // Una meseta más corta que el umbral (2 sesiones iguales tras la mejor marca) no cuenta
  const short = [90, 95, 100, 105, 110, 115, 120, 120, 120].map((w, i, a) => ses(monday(a.length - 1 - i), 'row', [set(w, 5)]));
  const r = goalProgress(data({ sessions: short }), strengthGoal({ weight: 130, reps: 5 }));
  assert.equal(r.status, 'estimate');
  assert.equal(r.stall, null);
  // Estancado en repeticiones (más de 12 reps): mismo criterio
  const reps = [14, 15, 16, 16, 16, 16].map((n, i, a) => ses(monday(a.length - 1 - i), 'row', [set(40, n)]));
  const t = goalProgress(data({ sessions: reps }), strengthGoal({ weight: 40, reps: 20 }));
  assert.equal(t.metric, 'reps');
  assert.equal(t.status, 'no_trend');
  assert.match(t.explanation, /tu máximo de repeticiones no supera 16 reps \(31 ago\) en las 3 sesiones siguientes/);
  // Resistencia y peso corporal no usan esta regla
  assert.equal(goalProgress(data({ sessions }), runGoal()).stall, null);
});

test('fuerza: «actual» ante un empate de marca = el registro más reciente', () => {
  // 80 × 5 el 31 ago, el 7 y el 14 sep; 75 × 5 el 21 sep (R3C-09)
  const sessions = [ses(monday(3), 'row', [set(80, 5)]), ses(monday(2), 'row', [set(80, 5)]), ses(monday(1), 'row', [set(80, 5)]), ses(monday(0), 'row', [set(75, 5)])];
  const p = goalProgress(data({ sessions }), strengthGoal({ weight: 90 }));
  assert.equal(p.current, e1rm(80, 5, 0));
  assert.equal(p.currentNote, '80 kg × 5 @0 · 14 sep');
  // Sin registros recientes: el más reciente de los empatados de los 28 días que acaban en el último registro
  const old = [ses('2026-06-01', 'row', [set(70, 5)]), ses('2026-06-08', 'row', [set(70, 5)]), ses('2026-06-15', 'row', [set(65, 5)])];
  const q = goalProgress(data({ sessions: old }), strengthGoal({ createdAt: created('2026-05-01') }));
  assert.equal(q.currentNote, '70 kg × 5 @0 · último registro 8 jun');
});

test('fuerza: 4 sesiones en 8 días (tocan 3 semanas) no bastan para estimar', () => {
  // Domingo 13, lunes 14, domingo 20 y lunes 21 sep (L2)
  const sessions = [
    ses('2026-09-13', 'row', [set(80, 5)]), ses('2026-09-14', 'row', [set(82.5, 5)]),
    ses('2026-09-20', 'row', [set(82.5, 6)]), ses('2026-09-21', 'row', [set(85, 5)]),
  ];
  const p = goalProgress(data({ sessions }), strengthGoal({ weight: 120, reps: 5 }));
  assert.equal(p.status, 'insufficient');
  assert.equal(p.eta, null);
  assert.deepEqual([p.counts.records, p.counts.weeks, p.counts.spanDays, p.counts.missingSpan], [4, 3, 8, 6]);
  assert.equal(p.explanation, 'Datos insuficientes para estimar: 4 sesiones con Remo en 3 semanas, pero entre el primero y el último solo hay 8 días (las últimas 12 semanas). Hacen falta 4 registros en al menos 3 semanas distintas, con 14 días o más entre el primero y el último: faltan registros más separados en el tiempo.');
  assert.match(p.rule, /al menos 3 semanas distintas y con 14 días o más entre el primero y el último/);
  // Una sesión más una semana después → ya hay estimación
  const q = goalProgress(data({ sessions: [ses('2026-09-06', 'row', [set(77.5, 5)]), ...sessions] }), strengthGoal({ weight: 120, reps: 5 }));
  assert.equal(q.status, 'estimate');
});

test('fuerza: tras una pausa de 4 semanas o más, la tendencia empieza de nuevo', () => {
  // 90 × 5 cada semana en junio–julio; pausa; 70 → 82,5 kg en 6 sesiones en septiembre (L3)
  const old = [];
  for (let i = 0; i < 8; i++) old.push(ses(addDays('2026-06-01', 7 * i), 'row', [set(90, 5)]));
  const back = ['2026-09-07', '2026-09-10', '2026-09-14', '2026-09-17', '2026-09-21', '2026-09-24'].map((d, i) => ses(d, 'row', [set(70 + 2.5 * i, 5)]));
  const goal = strengthGoal({ weight: 95, reps: 5, createdAt: created('2026-09-07') });
  const p = goalProgress(data({ sessions: [...old, ...back] }), goal);
  assert.equal(p.status, 'estimate');
  assert.ok(p.trend.slopePerWeek > 0, 'sin la pausa, la regresión saldría en contra');
  assert.deepEqual(p.counts.pause, { from: '2026-07-20', to: '2026-09-07', days: 49 });
  assert.equal(p.counts.trendFrom, '2026-09-07');
  assert.equal(p.counts.records, 6);
  assert.equal(p.dataUsed.length, 6);
  assert.equal(p.dataUsed[0].date, '2026-09-07');
  const pts = back.map((s) => [dayIndex(s.date), e1rm(s.exercises[0].sets[0].weight, 5, 0)]);
  const reg = linearRegression(pts.map((x) => x[0]), pts.map((x) => x[1]));
  assert.ok(Math.abs(p.trend.slopePerWeek - reg.slope * 7) < 1e-9);
  assert.match(p.explanation, /\(6 sesiones desde el 7 sep, tras una pausa sin registros desde el 20 jul\), llegarías entre/);
  assert.match(p.method, /Hubo una pausa sin registros entre el 20 jul y el 7 sep \(49 días\): la tendencia solo usa lo registrado desde el 7 sep\.$/);
  assert.match(p.rule, /Tras una pausa de 4 semanas o más sin registros, la tendencia empieza de nuevo/);
  // Recién vuelto (2 sesiones): datos insuficientes, explicando que la tendencia empieza de nuevo
  const q = goalProgress(data({ sessions: [...old, ...back.slice(-2)] }), goal);
  assert.equal(q.status, 'insufficient');
  assert.equal(q.counts.records, 2);
  assert.match(q.explanation, /^Datos insuficientes para estimar: 2 sesiones con Remo en 1 semana \(desde el 21 sep, tras una pausa sin registros desde el 20 jul\)\..*Tras una pausa de 4 semanas o más, la tendencia empieza de nuevo con lo registrado desde la vuelta\.$/);
  // Un hueco de 27 días no es una pausa
  const gap = [ses('2026-08-01', 'row', [set(60, 5)]), ses('2026-08-08', 'row', [set(62.5, 5)]), ses('2026-09-04', 'row', [set(65, 5)]), ses('2026-09-11', 'row', [set(67.5, 5)])];
  const r = goalProgress(data({ sessions: gap }), strengthGoal());
  assert.equal(r.counts.pause, null);
  assert.equal(r.counts.records, 4);
});

test('sin inicio (nada en los 28 días antes de crearlo ni después): progreso «—», no actual / objetivo', () => {
  // Press solo en junio–julio; objetivo creado el 20 sep (L4)
  const sessions = [];
  for (let i = 0; i < 6; i++) sessions.push(ses(addDays('2026-06-01', 7 * i), 'row', [set(75 + i, 5)]));
  const runs = [];
  for (let i = 0; i < 6; i++) runs.push(act('run', addDays('2026-06-01', 7 * i), 5, 25 * 60));
  const d = data({ sessions: [...sessions, ...runs] });
  const p = goalProgress(d, strengthGoal({ weight: 90, reps: 5, createdAt: created('2026-09-20') }));
  assert.equal(p.start, null);
  assert.equal(p.startLabel, '—');
  assert.equal(p.current, e1rm(80, 5, 0));
  assert.equal(p.progressPct, null, 'antes: 93 / 105 = 89 %');
  // Carrera: el inicio es el tiempo previsto del motor el día en que se creó (2 carreras en sus 12 semanas); hoy ya no
  // hay previsión (solo 1 carrera en la ventana): sin «Actual», el progreso sigue siendo «—»
  const q = goalProgress(d, runGoal({ createdAt: created('2026-09-20') }));
  assert.equal(q.start, predictionSeries(d, 10, ['2026-09-20'])[0].mid);
  assert.equal(q.current, null);
  assert.equal(q.progressPct, null);
  // Con un registro desde la creación, ese es el inicio
  const r = goalProgress(data({ sessions: [...sessions, ses('2026-09-22', 'row', [set(78, 5)])] }), strengthGoal({ weight: 90, reps: 5, createdAt: created('2026-09-20') }));
  assert.equal(r.start, e1rm(78, 5, 0));
  assert.equal(r.progressPct, 0);
});

// ===========================================================================
// Resistencia
// ===========================================================================

/** 8 semanas de carreras de 6 km (miércoles) cada vez más rápidas: `pace` s/km − 3 s/km por semana. */
function runsWeekly(n = 8, pace = 330) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(act('run', addDays(monday(i), 2), 6, 6 * (pace - 3 * (n - 1 - i))));
  return out.filter((a) => a.date <= TODAY);
}

// Ronda 8 (B1): un objetivo de carrera con tiempo consume el motor de Tiempos previstos (race-predict.js): «Actual» =
// el tiempo previsto de hoy, veredicto = checkTarget, tendencia = fotos semanales del mismo motor. Antes: un Riegel
// propio de la mejor carrera de 28 días (sin volumen, recencia, contexto, filtro de ritmo, rango ni confianza).
test('carrera: «Actual» = tiempo previsto del motor; tendencia = sus fotos semanales; rango hasta cruzar el objetivo', () => {
  const sessions = [
    ...runsWeekly(8),
    act('run', '2026-09-22', 2.5, 600), // < 3 km: no cuenta
    act('run', addDays(monday(0), 1), 12, 12 * 360), // misma semana que la última de 6 km
  ];
  const d = data({ sessions });
  const p = goalProgress(d, runGoal());
  const engine = predictFor(d, 10).prediction;
  assert.equal(p.metric, 'time');
  assert.equal(p.dir, -1);
  assert.equal(p.status, 'estimate');
  assert.equal(p.verdict, 'hoy_no');
  assert.equal(p.warning, null);
  assert.equal(p.target, 2700);
  assert.equal(p.targetLabel, '45:00');
  assert.equal(p.current, engine.mid);
  assert.equal(p.currentLabel, '53:35');
  assert.equal(p.currentNote, `previsto hoy · ${rangeText(engine)} · confianza alta`);
  assert.deepEqual(p.prediction, baseOf(engine));
  assert.equal(p.counts.records, 9, '8 de 6 km + la de 12 km (la de 2,5 km no)');
  const weeks = p.dataUsed.filter((x) => /^Semana /.test(x.label));
  assert.equal(weeks.length, 7, 'una fila por semana con previsión (la primera semana, con 1 carrera, aún no tiene)');
  assert.equal(weeks.at(-1).value, 'previsto 53:35 · 2 carreras');
  // Pendiente = la de las fotos semanales del motor (domingo; hoy en la semana actual)
  const snapDates = [6, 5, 4, 3, 2, 1].map((w) => addDays(monday(w), 6)).concat(TODAY);
  const snaps = predictionSeries(d, 10, snapDates);
  assert.ok(snaps.every((x) => x.usable));
  const reg = linearRegression(snaps.map((x) => dayIndex(x.date)), snaps.map((x) => x.midExact));
  assert.ok(Math.abs(p.trend.slopePerWeek - reg.slope * 7) < 1e-9);
  const exp = expectedRange(engine.mid - 2700, -reg.slope, reg.seSlope);
  assert.deepEqual([p.eta.fromDays, p.eta.toDays], [exp.fromDays, exp.toDays]);
  assert.match(p.explanation, /^Tu tiempo previsto para 10 km es 53:35 \(51:55–55:15, confianza alta\): faltan 8 min 35 s por bajar\. Al ritmo de −\d+ s\/sem/);
  assert.match(p.method, /^Tiempo previsto con el mismo cálculo que Tiempos previstos: Fórmula de Riegel/);
  assert.ok(p.dataUsed.some((x) => x.label === 'Estimación actual (media ponderada)'), 'el «¿Por qué?» del motor');
  assert.equal(MIN_KM.run, 3);
});

test('carrera: conseguido con una sesión ≥ distancia por debajo del tiempo (a ritmo medio, ritmo creíble), desde que se creó', () => {
  const sessions = [
    act('run', '2026-06-20', 10, 2600), // antes de crearlo
    act('run', '2026-09-06', 10, 2700), // igual al objetivo: «en menos de» no se cumple
    act('run', '2026-09-13', 12, 3200), // 10 km a ritmo medio = 44:27
    act('run', '2026-09-20', 10, 2650),
  ];
  const p = goalProgress(data({ sessions }), runGoal());
  assert.equal(p.status, 'achieved');
  assert.equal(p.achievedOn, '2026-09-13');
  assert.equal(p.explanation, 'Conseguido el 13 sep: 12 km en 53:20: 10 km a ritmo medio en 44:27 (objetivo 10 km en menos de 45:00).');
  // Una de 9,9 km no llega a la distancia
  const short = [act('run', '2026-09-20', 9.9, 2400)];
  assert.notEqual(goalProgress(data({ sessions: short }), runGoal()).status, 'achieved');
  // Ritmo imposible (1:50 /km, un error de datos): no lo consigue (Tiempos previstos la marca como sospechosa)
  assert.notEqual(goalProgress(data({ sessions: [act('run', '2026-09-20', 10, 1100)] }), runGoal()).status, 'achieved');
  // Antes de crearlo no cuenta → «al alcance» si el veredicto del motor es «probable»
  const before = [act('run', '2026-09-03', 8, 2050), act('run', '2026-09-10', 10, 2600)];
  const q = goalProgress(data({ sessions: before }), runGoal({ createdAt: created('2026-09-15') }));
  assert.equal(q.status, 'estimate');
  assert.equal(q.ready, true);
  assert.equal(q.verdict, 'probable');
  assert.equal(q.statusLabel, 'Al alcance');
  assert.match(q.explanation, /^Tu tiempo previsto para 10 km es 43:20 .*está a tu alcance; se marcará como conseguido cuando registres 10 km o más en menos de 45:00\./);
  // Con una sola carrera el motor no predice: datos insuficientes con su mensaje (antes, «al alcance» desde 1 carrera)
  const one = goalProgress(data({ sessions: [act('run', '2026-09-10', 10, 2600)] }), runGoal({ createdAt: created('2026-09-15') }));
  assert.equal(one.status, 'insufficient');
  assert.equal(one.current, null);
  assert.ok(one.explanation.includes(predictFor(data({ sessions: [act('run', '2026-09-10', 10, 2600)] }), 10).message));
});

test('carrera: sin tendencia si el tiempo previsto empeora; insuficiente con recuentos (con el previsto de hoy delante)', () => {
  const worse = [];
  for (let i = 5; i >= 0; i--) worse.push(act('run', addDays(monday(i), 2), 6, 6 * (300 + 5 * (5 - i))));
  const p = goalProgress(data({ sessions: worse }), runGoal());
  assert.equal(p.status, 'no_trend');
  assert.match(p.explanation, /^Tu tiempo previsto para 10 km es 52:25 .*\. Con la tendencia actual no se acerca: tu tiempo previsto va en contra del objetivo \(\+[\d,]+ s\/sem\)/);
  // Con 2 carreras el motor ya predice, pero no hay tendencia: insuficiente con los recuentos de siempre
  const few = [act('run', '2026-09-09', 6, 1900), act('run', '2026-09-16', 8, 2600)];
  const q = goalProgress(data({ sessions: few }), runGoal());
  assert.equal(q.status, 'insufficient');
  assert.equal(q.current, predictFor(data({ sessions: few }), 10).prediction.mid);
  assert.match(q.explanation, /^Tu tiempo previsto para 10 km es 54:40 \(53:00–56:20, confianza media\)\. Datos insuficientes para estimar: 2 carreras de 3 km o más en 2 semanas \(las últimas 12 semanas\)\. Hacen falta 4 registros en al menos 3 semanas distintas, con 14 días o más entre el primero y el último: faltan 2 carreras y 1 semana más con registros\./);
});

test('bici y natación con tiempo: Riegel con aviso de menor fiabilidad; natación en metros', () => {
  const bikes = [];
  for (let i = 5; i >= 0; i--) bikes.push(act('bike', addDays(monday(i), 5), 40, Math.round((40 / (26 + 0.5 * (5 - i))) * 3600)));
  const p = goalProgress(data({ sessions: bikes }), runGoal({ sport: 'bike', distanceKm: 40, timeSec: 80 * 60 }));
  assert.equal(p.status, 'estimate');
  assert.match(p.warning, /Riegel está pensada para carrera: en bici/);
  assert.match(p.dataUsed[0].value, /km\/h/);
  const swims = [act('swim', '2026-09-10', 0.3, 400), act('swim', '2026-09-17', 1, 1300)];
  const q = goalProgress(data({ sessions: swims }), runGoal({ sport: 'swim', distanceKm: 1.5, timeSec: 1800 }));
  assert.match(q.warning, /natación/);
  assert.equal(q.counts.records, 1, 'solo sesiones de 400 m o más');
  assert.match(q.dataUsed[0].value, /1\.000 m en 21:40 \(2:10 \/100 m\)/);
  assert.equal(MIN_KM.swim, 0.4);
});

test('solo distancia: progreso = sesión más larga reciente / objetivo; conseguido al cubrirla; tendencia semanal', () => {
  const sessions = [];
  for (let i = 5; i >= 0; i--) sessions.push(act('run', addDays(monday(i), 6), 8 + (5 - i), 3600));
  const live = sessions.filter((a) => a.date <= TODAY); // la del domingo 27 sep aún no
  const p = goalProgress(data({ sessions: live }), runGoal({ distanceKm: 21.0975, timeSec: null }));
  assert.equal(p.metric, 'distance');
  assert.equal(p.status, 'estimate');
  assert.equal(p.current, 12);
  assert.equal(p.currentLabel, '12 km');
  assert.ok(Math.abs(p.progressPct - (12 / 21.0975) * 100) < 1e-9);
  assert.ok(Math.abs(p.trend.slopePerWeek - 1) < 1e-9);
  assert.match(p.explanation, /^Tu carrera más larga reciente es de 12 km: faltan 9,1 km\. Al ritmo de \+1 km\/sem/);
  // Conseguido
  const done = [...live, act('run', '2026-09-23', 21.1, 7200)];
  const q = goalProgress(data({ sessions: done }), runGoal({ distanceKm: 21.0975, timeSec: null }));
  assert.equal(q.status, 'achieved');
  assert.equal(q.achievedOn, '2026-09-23');
  // Hecho antes de crearlo → al alcance
  const r = goalProgress(data({ sessions: done }), runGoal({ distanceKm: 20, timeSec: null, createdAt: created('2026-09-24') }));
  assert.equal(r.ready, true);
  assert.match(r.explanation, /antes de crear el objetivo/);
  // Natación sin tiempo: en metros
  const sw = goalProgress(data({ sessions: [act('swim', '2026-09-20', 1.2, 1700)] }), runGoal({ sport: 'swim', distanceKm: 1.5, timeSec: null }));
  assert.equal(sw.currentLabel, '1.200 m', 'mismo formato que stats.distanceLabel');
  assert.equal(sw.targetLabel, '1.500 m');
});

// ===========================================================================
// Peso corporal
// ===========================================================================

function bwDaily(n, start, perDay, end = TODAY) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push({ id: addDays(end, -i), kg: Math.round((start + perDay * (n - 1 - i)) * 10) / 10 });
  return out;
}

test('peso corporal (subir): tendencia de la media móvil de 7 días, la misma que #/bodyweight', () => {
  const bodyweight = bwDaily(40, 75, 0.02);
  const p = goalProgress(data({ bodyweight }), bwGoal({ targetKg: 77 }));
  assert.equal(p.metric, 'bodyweight');
  assert.equal(p.status, 'estimate');
  const s = bwStats(bodyweight, TODAY);
  assert.ok(Math.abs(p.trend.slopePerWeek - s.trend.kgPerWeek) < 1e-9, 'misma pendiente que bwStats');
  assert.ok(Math.abs(p.current - s.ma7) < 1e-9, 'actual = media de 7 días del último pesaje');
  assert.equal(p.counts.records, 28, 'ventana de 28 días');
  assert.equal(p.dataUsed.length, 5, 'una fila por semana');
  assert.match(p.dataUsed.at(-1).value, /^media 7 días \d+,\d kg el 24 sep \(4 pesajes\)$/);
  assert.match(p.explanation, /^Tu media de 7 días es 75,7 kg: faltan 1,3 kg por subir\. Al ritmo de \+0,14 kg\/sem \(28 pesajes en los últimos 28 días\)/);
  assert.match(p.method, /media móvil de 7 días/i);
  assert.ok(p.eta.from < p.eta.to);
});

test('peso corporal (bajar): sin tendencia si la media sube; estimación si baja; conseguido al cruzar la media', () => {
  const up = bwDaily(40, 75, 0.02);
  let p = goalProgress(data({ bodyweight: up }), bwGoal({ targetKg: 73, direction: 'down' }));
  assert.equal(p.status, 'no_trend');
  assert.equal(p.dir, -1);
  assert.match(p.explanation, /la media de 7 días va en contra del objetivo \(\+0,14 kg\/sem\)/);
  const down = bwDaily(40, 78, -0.03);
  p = goalProgress(data({ bodyweight: down }), bwGoal({ targetKg: 75, direction: 'down' }));
  assert.equal(p.status, 'estimate');
  assert.ok(p.trend.slopePerWeek < 0);
  assert.match(p.explanation, /por bajar/);
  // Conseguido: primera media de 7 días ≤ objetivo desde la creación
  p = goalProgress(data({ bodyweight: down }), bwGoal({ targetKg: 77.5, direction: 'down', createdAt: created('2026-08-16') }));
  assert.equal(p.status, 'achieved');
  const ma = [];
  for (const b of down) ma.push(b);
  assert.match(p.achievedOn, /^2026-0[89]-\d\d$/);
  assert.match(p.explanation, /la media de 7 días llegó a 77,\d kg/);
  // La dirección se deduce del inicio si falta
  p = goalProgress(data({ bodyweight: down }), bwGoal({ targetKg: 70, direction: undefined }));
  assert.equal(p.dir, -1);
  p = goalProgress(data({ bodyweight: down }), bwGoal({ targetKg: 90, direction: undefined }));
  assert.equal(p.dir, 1);
});

test('peso corporal: datos insuficientes (pocos pesajes o pocas semanas) y ventana según minWeeks', () => {
  const few = [{ id: '2026-09-20', kg: 75 }, { id: '2026-09-22', kg: 75.2 }, { id: '2026-09-24', kg: 75.3 }];
  let p = goalProgress(data({ bodyweight: few }), bwGoal());
  assert.equal(p.status, 'insufficient');
  assert.deepEqual([p.counts.records, p.counts.weeks], [3, 2]);
  assert.match(p.explanation, /3 pesajes en 2 semanas \(los últimos 28 días\).*faltan 1 pesaje y 1 semana más con registros/);
  const settings = defaultSettings();
  settings.goals = { minRecords: 4, minWeeks: 6 };
  p = goalProgress(data({ bodyweight: bwDaily(60, 75, 0.02), settings }), bwGoal());
  assert.equal(p.counts.windowWeeks, 6);
  assert.equal(p.counts.records, 42);
  assert.equal(p.status, 'estimate');
  p = goalProgress(data({ bodyweight: [] }), bwGoal());
  assert.equal(p.status, 'insufficient');
  assert.equal(p.current, null);
  // Progreso: de la media al crearlo al objetivo
  const q = goalProgress(data({ bodyweight: bwDaily(40, 75, 0.02) }), bwGoal({ targetKg: 77, createdAt: created('2026-09-01') }));
  assert.ok(q.start > 75 && q.start < q.current);
  const pct = ((q.current - q.start) / (77 - q.start)) * 100;
  assert.ok(Math.abs(q.progressPct - pct) < 1e-9);
});

test('peso corporal: solo hay tendencia cuando #/bodyweight la da (4 pesajes en 14 días o más)', () => {
  // 13, 14, 20 y 21 sep (hoy 21 sep): 4 pesajes que tocan 3 semanas pero abarcan 8 días (L2)
  const bw = [{ id: '2026-09-13', kg: 80 }, { id: '2026-09-14', kg: 79.6 }, { id: '2026-09-20', kg: 79.4 }, { id: '2026-09-21', kg: 79 }];
  const goal = bwGoal({ targetKg: 75, direction: 'down', createdAt: created('2026-09-01') });
  const s = bwStats(bw, '2026-09-21');
  assert.equal(s.trend.ok, false, '#/bodyweight: «Datos insuficientes»');
  const p = goalProgress(data({ bodyweight: bw, today: '2026-09-21' }), goal);
  assert.equal(p.status, 'insufficient');
  assert.equal(p.trend, null);
  assert.equal(p.eta, null);
  assert.deepEqual([p.counts.records, p.counts.weeks, p.counts.spanDays], [4, 3, 8]);
  assert.match(p.explanation, /4 pesajes en 3 semanas, pero entre el primero y el último solo hay 8 días \(los últimos 28 días\)/);
  // Aunque en Ajustes se pida menos (2 registros en 1 semana), sin la tendencia de #/bodyweight no se estima
  const settings = defaultSettings();
  settings.goals = { minRecords: 2, minWeeks: 1 };
  const q = goalProgress(data({ bodyweight: bw, today: '2026-09-21', settings }), goal);
  assert.equal(q.counts.ok, true);
  assert.equal(q.status, 'insufficient');
  assert.equal(q.explanation, `Datos insuficientes para ver la tendencia (la misma que en Peso corporal): ${s.trend.reason}`);
  // Con 14 días de pesajes, las dos pantallas dan la misma tendencia
  const bw2 = [{ id: '2026-09-07', kg: 80.4 }, ...bw];
  const s2 = bwStats(bw2, '2026-09-21');
  const r = goalProgress(data({ bodyweight: bw2, today: '2026-09-21' }), goal);
  assert.equal(s2.trend.ok, true);
  assert.equal(r.status, 'estimate');
  assert.ok(Math.abs(r.trend.slopePerWeek - s2.trend.kgPerWeek) < 1e-9);
});

test('rango muy lejano: «más de 2 años al ritmo actual»', () => {
  const p = goalProgress(data({ bodyweight: bwDaily(40, 75, 0.005) }), bwGoal({ targetKg: 90 }));
  assert.equal(p.status, 'estimate');
  assert.equal(p.eta.allBeyond, true);
  assert.equal(p.etaText, 'más de 2 años al ritmo actual');
  assert.match(p.explanation, /llegarías más de 2 años al ritmo actual\./);
  assert.equal(LONG_DAYS, 730);
});

// ===========================================================================
// Formulario: títulos, validación, registro
// ===========================================================================

test('autoTitle: fuerza, resistencia (con y sin tiempo, carreras con nombre) y peso corporal', () => {
  assert.equal(autoTitle(strengthGoal(), EX.row), 'Remo 80 kg × 5');
  assert.equal(autoTitle(strengthGoal({ weight: 82.5 }), EX.row), 'Remo 82,5 kg × 5');
  assert.equal(autoTitle(strengthGoal({ weight: 10 }), EX.pull), 'Dominadas +10 kg × 5');
  assert.equal(autoTitle(strengthGoal({ weight: -15, reps: 8 }), EX.pull), 'Dominadas −15 kg asist. × 8');
  assert.equal(autoTitle(strengthGoal({ weight: 0, reps: 12 }), EX.pull), 'Dominadas × 12');
  assert.equal(autoTitle(runGoal()), '10 km en menos de 45 min');
  assert.equal(autoTitle(runGoal({ distanceKm: 21.0975, timeSec: 6300 })), 'Media maratón en menos de 1 h 45 min');
  assert.equal(autoTitle(runGoal({ distanceKm: 42.195, timeSec: null })), 'Correr un maratón');
  assert.equal(autoTitle(runGoal({ distanceKm: 21.0975, timeSec: null })), 'Correr una media maratón');
  assert.equal(autoTitle(runGoal({ distanceKm: 15, timeSec: null })), 'Correr 15 km');
  assert.equal(autoTitle(runGoal({ sport: 'bike', distanceKm: 40, timeSec: 4800 })), '40 km en bici en menos de 1 h 20 min');
  assert.equal(autoTitle(runGoal({ sport: 'bike', distanceKm: 100, timeSec: null })), '100 km en bici');
  assert.equal(autoTitle(runGoal({ sport: 'swim', distanceKm: 1.5, timeSec: 1650 })), '1.500 m nadando en menos de 27 min 30 s');
  assert.equal(autoTitle(runGoal({ sport: 'swim', distanceKm: 3.8, timeSec: null })), 'Nadar 3.800 m');
  assert.equal(autoTitle(bwGoal({ targetKg: 80 })), 'Subir a 80 kg');
  assert.equal(autoTitle(bwGoal({ targetKg: 72.5, direction: 'down' })), 'Bajar a 72,5 kg');
  assert.equal(autoTitle(bwGoal({ direction: null })), 'Peso corporal 77 kg');
  assert.equal(autoTitle(strengthGoal(), null), '', 'sin ejercicio todavía');
  assert.equal(autoTitle(null), '');
});

test('formato: tiempos en palabras, distancias, pesos, emoji y fechas', () => {
  assert.equal(fmtTimeWords(2700), '45 min');
  assert.equal(fmtTimeWords(3900), '1 h 05 min');
  assert.equal(fmtTimeWords(3600), '1 h');
  assert.equal(fmtTimeWords(3605), '1 h 00 min 5 s');
  assert.equal(fmtTimeWords(1350), '22 min 30 s');
  assert.equal(fmtTimeWords(40), '40 s');
  assert.equal(fmtTimeWords(0), '0 s');
  assert.equal(fmtDistance('run', 10), '10 km');
  assert.equal(fmtDistance('run', 21.0975), '21,1 km');
  assert.equal(fmtDistance('run', 21.0975, { named: true }), 'media maratón');
  assert.equal(fmtDistance('swim', 0.75), '750 m');
  assert.equal(fmtDistance('bike', null), '—');
  assert.equal(goalWeightText('weight_reps', 80), '80 kg');
  assert.equal(goalWeightText('bodyweight', 0), '');
  assert.equal(goalWeightText('bodyweight', null), '');
  assert.equal(goalEmoji(strengthGoal()), '🏋️');
  assert.equal(goalEmoji(runGoal({ sport: 'swim' })), '🏊');
  assert.equal(goalEmoji(bwGoal()), '⚖️');
  assert.equal(createdDateOf({ createdAt: tsFromDate('2026-09-01', 23) }), '2026-09-01');
  assert.equal(createdDateOf({}), null);
  assert.equal(fmtDay('2025-12-03', TODAY), '3 dic 2025');
  assert.match(NONLINEAR_NOTE, /no es lineal.*se recalcula con cada registro/);
});

test('validateGoal: errores por campo según el tipo', () => {
  assert.deepEqual(validateGoal(strengthGoal(), EX.row), {});
  assert.deepEqual(Object.keys(validateGoal(strengthGoal({ exerciseId: null }), null)), ['exerciseId', 'weight'].filter((k) => k === 'exerciseId'));
  assert.equal(validateGoal(strengthGoal({ exerciseId: 'plank' }), EX.plank).exerciseId, '«Plancha» no se registra con peso y repeticiones.');
  assert.equal(validateGoal(strengthGoal({ weight: 0 }), EX.row).weight, 'Indica un peso mayor que 0 kg.');
  assert.equal(validateGoal(strengthGoal({ weight: null }), EX.row).weight, 'Indica un peso mayor que 0 kg.');
  assert.deepEqual(validateGoal(strengthGoal({ weight: null }), EX.pull), {}, 'peso corporal sin lastre');
  assert.deepEqual(validateGoal(strengthGoal({ weight: -20 }), EX.pull), {}, 'asistencia');
  assert.equal(validateGoal(strengthGoal({ reps: 0 }), EX.row).reps, 'Repeticiones entre 1 y 100.');
  assert.equal(validateGoal(strengthGoal({ reps: 5.5 }), EX.row).reps, 'Repeticiones entre 1 y 100.');
  assert.deepEqual(validateGoal(runGoal()), {});
  assert.deepEqual(validateGoal(runGoal({ timeSec: null })), {});
  assert.equal(validateGoal(runGoal({ distanceKm: null })).distanceKm, 'Indica la distancia.');
  assert.match(validateGoal(runGoal({ sport: 'swim', distanceKm: 60 })).distanceKm, /máximo 50\.000 m/);
  assert.equal(validateGoal(runGoal({ sport: 'kayak' })).sport, 'Elige el deporte.');
  assert.equal(validateGoal(runGoal({ timeSec: -5 })).timeSec, 'Tiempo no válido.');
  assert.deepEqual(validateGoal(bwGoal()), {});
  assert.equal(validateGoal(bwGoal({ targetKg: 10 })).targetKg, 'Peso objetivo entre 20 y 300 kg.');
  assert.equal(validateGoal(bwGoal({ direction: 'sideways' })).direction, 'Elige subir o bajar.');
  assert.equal(validateGoal({ kind: 'nope' }).kind, 'Elige el tipo de objetivo.');
});

test('goalRecord: solo los campos de su tipo, título automático o propio, valores por defecto', () => {
  const draft = { kind: 'endurance', exerciseId: 'row', weight: 80, reps: 5, sport: 'run', distanceKm: 10, timeSec: 0, targetKg: 70, direction: 'up', title: '', titleAuto: true, dirty: true };
  const r = goalRecord(draft, null, { id: 'goal_1', now: 1000 });
  assert.deepEqual(r, { kind: 'endurance', sport: 'run', distanceKm: 10, timeSec: null, title: 'Correr 10 km', titleAuto: true, id: 'goal_1', createdAt: 1000, achievedAt: null, archived: false });
  const own = goalRecord({ ...strengthGoal(), title: '  Mi remo  ', titleAuto: false }, EX.row);
  assert.equal(own.title, 'Mi remo');
  assert.equal(own.titleAuto, false);
  assert.equal(own.createdAt, strengthGoal().createdAt, 'conserva createdAt');
  const empty = goalRecord({ ...strengthGoal(), title: '', titleAuto: false }, EX.row);
  assert.deepEqual([empty.title, empty.titleAuto], ['Remo 80 kg × 5', true]);
  // Sin el campo titleAuto (copias antiguas): automático solo si coincide con el generado
  assert.equal(goalRecord({ ...strengthGoal({ reps: 6 }), title: 'Remo 80 kg × 5', titleAuto: undefined }, EX.row).title, 'Remo 80 kg × 5');
  assert.equal(goalRecord({ ...strengthGoal({ reps: 6 }), title: 'Remo 80 kg × 6', titleAuto: undefined }, EX.row).titleAuto, true);
  const bw = goalRecord({ ...strengthGoal({ exerciseId: 'pull', weight: null }) }, EX.pull);
  assert.equal(bw.weight, 0);
  assert.equal(bw.title, 'Dominadas × 5');
  const g = goalRecord({ ...bwGoal(), achievedAt: '2026-09-01', archived: 1 }, null);
  assert.deepEqual([g.achievedAt, g.archived, g.direction, g.targetKg], ['2026-09-01', true, 'up', 77]);
  assert.ok(!('exerciseId' in g) && !('sport' in g));
});

test('splitGoals: activos, conseguidos y archivados, los más nuevos primero', () => {
  const gs = [
    { id: 'a', createdAt: 1 }, { id: 'b', createdAt: 3, achievedAt: '2026-09-01' }, { id: 'c', createdAt: 2, archived: true },
    { id: 'd', createdAt: 4 }, { id: 'e', createdAt: 5, archived: true, achievedAt: '2026-09-02' }, null,
  ];
  const s = splitGoals(gs);
  assert.deepEqual(s.active.map((g) => g.id), ['d', 'a']);
  assert.deepEqual(s.achieved.map((g) => g.id), ['b']);
  assert.deepEqual(s.archived.map((g) => g.id), ['e', 'c']);
  assert.deepEqual(splitGoals(null), { active: [], achieved: [], archived: [] });
});

test('la estimación es siempre un rango (from < to) y nunca antes de mañana', () => {
  const cases = [
    goalProgress(data({ sessions: rowWeekly(8, 60, 2.5) }), strengthGoal()),
    goalProgress(data({ sessions: rowWeekly(8, 60, 2.5) }), strengthGoal({ weight: 120 })),
    goalProgress(data({ sessions: runsWeekly(8) }), runGoal()),
    goalProgress(data({ bodyweight: bwDaily(40, 75, 0.02) }), bwGoal({ targetKg: 80 })),
    goalProgress(data({ bodyweight: bwDaily(40, 75, 0.02) }), bwGoal({ targetKg: 75.8 })),
  ];
  for (const p of cases) {
    assert.equal(p.status, 'estimate');
    assert.ok(p.eta && p.eta.from > TODAY, 'desde mañana como pronto');
    assert.ok(p.eta.to == null || p.eta.from < p.eta.to, 'rango, no fecha exacta');
    assert.ok(p.etaText.startsWith('entre') || p.etaText.startsWith('más de'));
    assert.ok(p.eta.fromDays <= Math.floor(p.eta.centerDays * 0.8) && (p.eta.toDays == null || p.eta.toDays >= Math.ceil(p.eta.centerDays * 1.2)), 'margen mínimo ±20 %');
  }
  assert.equal(weekStart(TODAY), '2026-09-21');
});
