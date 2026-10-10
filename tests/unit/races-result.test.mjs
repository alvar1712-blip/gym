// «¿Cómo te fue?» (ronda 8, D; docs/MEJORAS.md §8): el resultado de un evento pasado. El evento REFERENCIA su resultado
// (una actividad o un resultado de carrera de tu contexto; solo el tiempo de otros deportes vive en el evento); la
// predicción previa es el motor único (race-predict.predictFor) con «hoy» = la víspera; el récord, stats.enduranceRecords.
// Datos sintéticos. Hoy = viernes 9 oct 2026; el evento, el domingo 4 oct.
process.env.TZ = 'Europe/Madrid';

import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../js/races-logic.js';
import * as RR from '../../js/races-result.js';
import * as C from '../../js/context-logic.js';
import { predictFor, baseOf } from '../../js/race-predict.js';
import { enduranceRecords } from '../../js/stats.js';
import { buildSeries, computeBestEfforts, encodeTrack } from '../../js/best-efforts.js';
import { buildAnalysis } from '../../js/analysis.js';
import { reportText } from '../../js/analysis-report.js';
import { addDays, tsFromDate } from '../../js/util.js';
import { SEED_EXERCISES, defaultSettings } from '../../js/seed.js';
import { validateBackup, BACKUP_APP_ID, BACKUP_FORMAT } from '../../js/store.js';
import { parseBackupText, buildBackupObject } from '../../js/backup.js';

const T = '2026-10-09';
const D = '2026-10-04';
const ago = (n, from = T) => addDays(from, -n);
const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
let seq = 0;
const act = (kind, date, km, sec, extra = {}) => ({ id: `${kind}${++seq}`, kind, status: 'done', date, distanceKm: km, movingSec: sec, durationMin: sec / 60, rpe: 6, startedAt: tsFromDate(date, 9), ...extra });
const run = (date, km, sec, extra) => act('run', date, km, sec, extra);
const mark = (date, km, sec, precision = 'day', id = `res${++seq}`) => C.entryRecord({ kind: 'event', type: 'race_result', date: { date, precision }, text: '', notes: '', result: { km, sec, effort: 'race' } }, { id, now: seq });
const data = (sessions, context = [], extra = {}) => ({ sessions, context, exercises: EX, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], today: T, ...extra });
const race = (o = {}) => ({ id: `race${++seq}`, name: '', type: '10k', date: D, distanceKm: 10, targetSec: 3000, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1, ...o });
/** Las carreras de antes del evento: 4 rodajes de 8–10 km a ~5:10–5:30 (más lentos que 49:18 en 10 km). */
const before = () => [run(ago(5, D), 10, 3150), run(ago(12, D), 8, 2560), run(ago(20, D), 10, 3200), run(ago(33, D), 9, 2900)];

/** Carrera importada como la guarda import-logic (tramos { km, pace } a 1 Hz) con sus mejores esfuerzos. */
function imported(date, parts) {
  const t = [0];
  const d = [0];
  let ts = 0;
  let dm = 0;
  for (const p of parts) {
    const n = Math.round(p.km * p.pace);
    for (let i = 1; i <= n; i++) { t.push(ts + i); d.push(dm + (p.km * 1000 * i) / n); }
    ts += n; dm += p.km * 1000;
  }
  const t0 = tsFromDate(date, 9) / 1000;
  const series = buildSeries({ t: t.map((x) => t0 + x), d, src: 'device' });
  const km = Math.round(dm) / 1000;
  return run(date, km, ts, { source: { type: 'fit', fileName: 'c.fit' }, track: encodeTrack(series), bestEfforts: computeBestEfforts({ series, basis: { km, sec: ts } }) });
}

test('normalizeOutcome: estados, una sola referencia (actividad > contexto > a mano), puesto y nota', () => {
  assert.equal(R.normalizeOutcome(null), null);
  assert.equal(R.normalizeOutcome({ status: 'raro' }), null);
  assert.equal(R.normalizeOutcome({ status: 'done' }), null, '«hecho» sin referencia = sin responder');
  assert.equal(R.normalizeOutcome({ status: 'done', manual: { sec: 0 } }), null);
  const all = R.normalizeOutcome({ status: 'done', activityId: 'a1', contextId: 'c1', manual: { sec: 100 }, place: 12, note: '  calor  ', at: 5 });
  assert.deepEqual(all, { status: 'done', activityId: 'a1', contextId: null, manual: null, place: 12, note: 'calor', at: 5 });
  assert.equal(R.normalizeOutcome({ status: 'done', contextId: 'c1', manual: { sec: 100 } }).manual, null);
  assert.deepEqual(R.normalizeOutcome({ status: 'done', manual: { sec: 18000.4, km: 20 } }).manual, { sec: 18000, km: 20 });
  assert.equal(R.normalizeOutcome({ status: 'done', manual: { sec: 100, km: 9999 } }).manual.km, null, 'km fuera de rango → sin km');
  for (const [p, ok] of [[1, 1], [R.PLACE_MAX, R.PLACE_MAX], [0, null], [R.PLACE_MAX + 1, null], [3.5, null], ['4', null]]) {
    assert.equal(R.normalizeOutcome({ status: 'done', activityId: 'a', place: p }).place, ok, `puesto ${p}`);
  }
  assert.equal(R.normalizeOutcome({ status: 'done', activityId: 'a', note: 'x'.repeat(900) }).note.length, R.NOTE_MAX);
  // «No participé» y «omitir»: sin referencias ni puesto
  assert.deepEqual(R.normalizeOutcome({ status: 'dns', activityId: 'a', place: 3, note: 'lesión' }), { status: 'dns', activityId: null, contextId: null, manual: null, place: null, note: 'lesión', at: null });
  assert.equal(R.normalizeOutcome({ status: 'skipped', contextId: 'c' }).contextId, null);
});

// Regresión: normalizeRace y raceRecord reconstruían el evento campo a campo y perdían cualquier campo nuevo (al editar
// el evento, su resultado desaparecía).
test('regresión: normalizeRace y raceRecord conservan el resultado', () => {
  const outcome = { status: 'done', activityId: 'run1', contextId: null, manual: null, place: 7, note: '', at: 9 };
  assert.deepEqual(R.normalizeRace(race({ outcome })).outcome, outcome);
  assert.deepEqual(R.raceRecord(race({ outcome, name: 'Otro nombre' }), { id: 'x', now: 10 }).outcome, outcome);
  assert.equal(R.normalizeRace(race()).outcome, null, 'sin el campo = sin responder');
  assert.equal(R.raceRecord(race(), { id: 'x' }).outcome, null);
});

test('validateRace: un evento con resultado no se mueve al futuro (omitido sí); validateOutcome', () => {
  const done = { status: 'done', activityId: 'a' };
  assert.match(R.validateRace(race({ date: addDays(T, 3), outcome: done }), { today: T }).date, /ya tiene resultado/);
  assert.match(R.validateRace(race({ date: addDays(T, 3), outcome: { status: 'dns' } }), { today: T }).date, /ya tiene resultado/);
  assert.equal(R.validateRace(race({ date: addDays(T, 3), outcome: { status: 'skipped' } }), { today: T }).date, undefined);
  assert.equal(R.validateRace(race({ date: T, outcome: done }), { today: T }).date, undefined, 'hoy sí');
  assert.equal(R.validateRace(race({ date: addDays(T, 3), outcome: done })).date, undefined, 'sin «hoy» no se comprueba');
  const ten = race();
  assert.deepEqual(R.validateOutcome({ sec: 2958, km: 10 }, ten), {});
  assert.ok(R.validateOutcome({ sec: null, km: 10 }, ten).sec);
  assert.ok(R.validateOutcome({ sec: 2958, km: null }, ten).km, 'carrera a pie: distancia obligatoria');
  assert.deepEqual(R.validateOutcome({ sec: 18000, km: null }, race({ type: 'hiking', distanceKm: 20 })), {}, 'senderismo: opcional');
  assert.ok(R.validateOutcome({ sec: 2958, km: 10, place: 0 }, ten).place);
  assert.ok(R.validateOutcome({ sec: 100 * 3600, km: 10 }, ten).sec);
});

test('pendingOutcome: A/B de los últimos 7 días sin responder; C, respondidos, omitidos y el de hoy no', () => {
  const r7 = race({ id: 'a7', date: ago(7), priority: 'A' });
  assert.equal(R.pendingOutcome([r7], T)?.id, 'a7');
  assert.equal(R.pendingOutcome([race({ date: ago(8) })], T), null, 'hace 8 días: no');
  assert.equal(R.pendingOutcome([race({ date: ago(2), priority: 'C' })], T), null);
  assert.equal(R.pendingOutcome([race({ date: ago(2), outcome: { status: 'dns' } })], T), null);
  assert.equal(R.pendingOutcome([race({ date: ago(2), outcome: { status: 'skipped' } })], T), null);
  assert.equal(R.pendingOutcome([race({ date: T })], T), null, 'el de hoy aún no');
  // El más reciente de los dos
  assert.equal(R.pendingOutcome([r7, race({ id: 'b3', date: ago(3), priority: 'B' })], T).id, 'b3');
  assert.equal(R.outcomePrompt(race({ date: D }), T), '¿Cómo te fue en el 10K del domingo?');
  assert.equal(R.outcomePrompt(race({ name: 'San Silvestre', date: ago(1) }), T), '¿Cómo te fue en San Silvestre de ayer?');
  assert.equal(R.outcomePrompt(race({ type: 'half', date: ago(7) }), T), '¿Cómo te fue en la media maratón del viernes pasado?');
  // La lista: «¿Cómo te fue?» en los de los últimos 60 días
  assert.equal(R.outcomeDue(race({ date: ago(60) }), T), true);
  assert.equal(R.outcomeDue(race({ date: ago(61) }), T), false);
  // Búsqueda inversa (aviso al borrar)
  const linked = race({ name: 'Carrera del barrio', outcome: { status: 'done', activityId: 'run9' } });
  assert.equal(R.raceLinkedTo([linked], { activityId: 'run9' }).id, linked.id);
  assert.equal(R.raceLinkedTo([linked], { contextId: 'run9' }), null);
  assert.equal(R.linkedWarning([linked], { activityId: 'run9' }), 'Es el resultado de «Carrera del barrio»; el evento quedará sin resultado.');
});

test('resultCandidates: ±1 día, deporte del evento, sin fuerza ni lo vinculado a otro evento, con tus resultados; orden', () => {
  const near = run(D, 10.05, 2958);
  const dayBefore = run(ago(1, D), 10, 3100);
  const far = run(ago(2, D), 10, 3000);
  const short = run(D, 5, 1500);
  const bike = act('bike', D, 40, 5400);
  const strength = { id: 'st1', kind: 'strength', status: 'done', date: D, exercises: [] };
  const planned = run(D, 10, 2900, { status: 'planned' });
  const taken = run(addDays(D, 1), 10, 2990);
  const res = mark(D, 10, 2958);
  const other = race({ id: 'other', outcome: { status: 'done', activityId: taken.id } });
  const d = data([near, dayBefore, far, short, bike, strength, planned, taken], [res, mark(ago(5, D), 10, 3100)]);
  const ten = race({ id: 'ten' });
  const c = RR.resultCandidates(d, ten, [ten, other]);
  assert.deepEqual(c.activities.map((a) => a.id), [near.id, short.id, dayBefore.id], 'el mismo día primero; después, la distancia más parecida');
  assert.deepEqual(c.activities.map((a) => a.close), [true, false, true]);
  assert.equal(c.activities[0].sec, 2958);
  assert.deepEqual(c.results.map((x) => x.id), [res.id]);
  // Ciclismo: solo bici, sin resultados de carrera; «otro»: cualquier deporte salvo fuerza
  assert.deepEqual(RR.resultCandidates(d, race({ type: 'cycling', distanceKm: 40 }), []).activities.map((a) => a.id), [bike.id]);
  assert.deepEqual(RR.resultCandidates(d, race({ type: 'cycling', distanceKm: 40 }), []).results, []);
  const any = RR.resultCandidates(d, race({ type: 'custom', name: 'X', distanceKm: null }), [other]).activities.map((a) => a.id);
  assert.ok(any.includes(bike.id) && !any.includes('st1') && !any.includes(taken.id) && !any.includes(planned.id));
});

test('actividad vinculada: tiempo en movimiento; más larga con mejor tramo → parcial; borrada → ya no existe', () => {
  const a = run(D, 10.04, 2958, { elapsedSec: 3010 });
  const ten = race({ outcome: { status: 'done', activityId: a.id } });
  const r = RR.resolveResult(data([a]), ten);
  assert.deepEqual([r.state, r.source, r.sec, r.km, r.how, r.comparable], ['done', 'activity', 2958, 10.04, 'full', true]);
  // 5K dentro de una carrera de 12,4 km importada (con calentamiento): su mejor 5 km
  const long = imported(D, [{ km: 3.12, pace: 330 }, { km: 5, pace: 298 }, { km: 4.28, pace: 330 }]);
  const five = race({ type: '5k', distanceKm: 5, targetSec: 1500, outcome: { status: 'done', activityId: long.id } });
  const p = RR.resolveResult(data([long]), five);
  assert.deepEqual([p.how, p.sec, p.km, p.partialText, p.comparable], ['partial', 1490, 5, 'Parcial dentro de 12,4 km', true]);
  // Más larga y sin parciales (a mano): el tiempo de la actividad entera, sin comparar (nunca se estima a ritmo medio)
  const manualLong = run(D, 12, 3700);
  const m = RR.resolveResult(data([manualLong]), race({ outcome: { status: 'done', activityId: manualLong.id } }));
  assert.deepEqual([m.sec, m.how, m.comparable], [3700, 'full', false]);
  assert.equal(RR.outcomeView(data([manualLong]), race({ outcome: { status: 'done', activityId: manualLong.id } })).diff, null);
  // Borrada
  const gone = RR.resolveResult(data([]), ten);
  assert.deepEqual([gone.state, gone.missing], ['missing', 'activity']);
  assert.equal(RR.outcomeView(data([]), ten).rowText, 'El resultado ya no existe');
});

test('resultado a mano (carrera a pie): se lee de su entrada de contexto; al editarla cambia; borrada → ya no existe', () => {
  const e = mark(D, 10, 2958);
  const ten = race({ outcome: { status: 'done', contextId: e.id, place: 41 } });
  const v = RR.outcomeView(data([], [e]), ten);
  assert.deepEqual([v.result.source, v.result.sec, v.result.place], ['context', 2958, 41]);
  assert.equal(v.rowText, 'Resultado 49:18 · 42 s mejor que el objetivo');
  const edited = C.entryRecord({ ...e, result: { ...e.result, sec: 3005 } }, { id: e.id });
  const v2 = RR.outcomeView(data([], [edited]), ten);
  assert.equal(v2.result.sec, 3005);
  assert.equal(v2.diff.text, '5 s peor que el objetivo');
  assert.deepEqual([RR.resolveResult(data([], []), ten).state, RR.resolveResult(data([], []), ten).missing], ['missing', 'context']);
});

test('senderismo a mano: vive en el evento (outcome.manual), sin predicción previa y fuera del motor de carrera', () => {
  const sessions = before();
  const d = data(sessions);
  const hike = race({ type: 'hiking', distanceKm: 20, targetSec: null, outcome: { status: 'done', manual: { sec: 18000, km: 20 } } });
  const v = RR.outcomeView(d, hike);
  assert.deepEqual([v.state, v.result.source, v.result.sec, v.result.km, v.prior, v.record, v.diff], ['done', 'manual', 18000, 20, null, null, null]);
  assert.equal(v.rowText, 'Resultado 5:00:00');
  // El motor de carrera no lo ve (no está ni en sessions ni en context): la predicción es la misma con y sin el evento
  assert.deepEqual(baseOf(predictFor({ ...d, races: [hike] }, 10).prediction), baseOf(predictFor(data(sessions), 10).prediction));
  assert.equal(RR.priorPrediction(d, hike).reason, 'no_run');
});

test('compareResult: exacto al segundo y neutro', () => {
  assert.deepEqual(RR.compareResult(2958, 3000), { diffSec: -42, kind: 'better', text: '42 s mejor que el objetivo', short: '42 s mejor' });
  assert.deepEqual(RR.compareResult(3065, 3000), { diffSec: 65, kind: 'worse', text: '1 min 5 s peor que el objetivo', short: '1 min 5 s peor' });
  assert.equal(RR.compareResult(3000, 3000).text, 'Igual que el objetivo');
  assert.equal(RR.compareResult(3000.4, 3000).kind, 'equal');
  assert.equal(RR.compareResult(2958, null), null);
  assert.equal(RR.compareResult(3600 + 125, 3600).text, '2 min 5 s peor que el objetivo');
});

test('predicción previa: el motor único la víspera, sin fugas del día del evento ni de después', () => {
  const sessions = before();
  const res = run(D, 10, 2958);
  const later = run(addDays(D, 2), 10, 2800);
  const d = data([...sessions, res, later], [mark(addDays(D, 1), 5, 1300)]);
  const ten = race({ outcome: { status: 'done', activityId: res.id } });
  const p = RR.priorPrediction(d, ten);
  assert.equal(p.ok, true);
  assert.equal(p.asOf, '2026-10-03');
  assert.deepEqual(p.base, baseOf(predictFor(d, 10, { today: '2026-10-03' }).prediction), 'es exactamente predictFor con «hoy» = la víspera');
  // Igual que con los datos recortados a antes del evento (nada posterior entra)
  const cut = baseOf(predictFor(data(sessions, [], { today: '2026-10-03' }), 10).prediction);
  for (const k of ['mid', 'low', 'high', 'confidence', 'status']) assert.deepEqual(p.base[k], cut[k], k);
  assert.deepEqual(p.base.refs, cut.refs);
  // Añadir el resultado del propio día (como actividad o como resultado de contexto) no la cambia
  const p2 = RR.priorPrediction(data([...sessions, res, run(D, 10, 2700)], [mark(D, 10, 2900)]), ten);
  assert.deepEqual([p2.low, p2.mid, p2.high], [p.low, p.mid, p.high]);
  // Dos objetos `data` con los mismos datos → lo mismo (la memoria por objeto no influye)
  assert.deepEqual(RR.priorPrediction(data([...sessions, res, later], [mark(addDays(D, 1), 5, 1300)]), ten), p);
  // Pocos datos → sin predicción; otro deporte → no_run
  const few = RR.priorPrediction(data([res]), ten);
  assert.deepEqual([few.ok, few.reason], [false, 'insuficiente']);
  assert.match(few.text, /no había datos suficientes antes del evento/);
  assert.equal(RR.priorPrediction(d, race({ type: 'cycling', distanceKm: 40 })).reason, 'no_run');
  assert.equal(RR.priorPrediction(d, race({ type: 'custom', name: 'X', distanceKm: null })).reason, 'no_run');
});

test('predicción previa: si la actividad vinculada es de la víspera (la ventana admite ±1 día), no entra en su propia previsión', () => {
  const sessions = before();
  const res = run(addDays(D, -1), 10, 2700); // mucho más rápida: si entrara, movería el rango
  const ten = race({ outcome: { status: 'done', activityId: res.id } });
  const d = data([...sessions, res]);
  assert.ok(RR.resultCandidates(d, race()).activities.some((a) => a.id === res.id), 'es candidata (día anterior)');
  const v = RR.outcomeView(d, ten);
  assert.equal(v.prior.ok, true);
  assert.equal(v.prior.asOf, addDays(D, -2), 'la víspera del resultado, no la del evento');
  const clean = baseOf(predictFor(data(sessions, [], { today: addDays(D, -2) }), 10).prediction);
  assert.deepEqual([v.prior.low, v.prior.mid, v.prior.high], [clean.low, clean.mid, clean.high], 'sin el propio resultado');
  assert.ok(!v.prior.base.refs.some((r) => r.sessionId === res.id), 'el resultado no es referencia de su previsión');
  // Resultado a mano del mismo día: la víspera del evento, como siempre
  const e = mark(D, 10, 2900);
  assert.equal(RR.outcomeView(data(sessions, [e]), race({ outcome: { status: 'done', contextId: e.id } })).prior.asOf, addDays(D, -1));
});

test('rangePosition: los extremos cuentan como dentro', () => {
  const prior = { ok: true, low: 2970, high: 3120 };
  assert.equal(RR.rangePosition(2969, prior), 'faster');
  assert.equal(RR.rangePosition(2970, prior), 'inside');
  assert.equal(RR.rangePosition(3120, prior), 'inside');
  assert.equal(RR.rangePosition(3121, prior), 'slower');
  assert.equal(RR.rangePosition(3000, { ok: false }), null);
});

test('récord: el titular de enduranceRecords (actividad, marca a mano, duplicada) y «en su momento»', () => {
  const sessions = before();
  const res = run(D, 10, 2958);
  const ten = race({ outcome: { status: 'done', activityId: res.id } });
  const d = data([...sessions, res]);
  const rec = RR.resultRecord(d, ten, RR.resolveResult(d, ten));
  assert.deepEqual(rec, { current: { id: '10k', label: 'Tu récord en 10 km' }, atTheTime: null, longest: null, href: '#/records?seg=endurance' });
  assert.equal(enduranceRecords(d).run.best['10k'].sessionId, res.id, 'el mismo titular que Récords');
  // Una carrera posterior más rápida: ya no es el récord actual, pero lo fue en su momento
  const d2 = data([...sessions, res, run(addDays(D, 3), 10, 2900)]);
  const rec2 = RR.resultRecord(d2, ten, RR.resolveResult(d2, ten));
  assert.equal(rec2.current, null);
  assert.deepEqual(rec2.atTheTime, { id: '10k', label: 'Fue tu récord en 10 km en su momento' });
  assert.equal(RR.outcomeView(d2, ten).record.atTheTime.id, '10k');
  // Ni entonces: una anterior más rápida
  const d3 = data([run(ago(40, D), 10, 2800), ...sessions, res]);
  assert.equal(RR.resultRecord(d3, ten, RR.resolveResult(d3, ten)), null);
  // Marca a mano como récord (por entryId)
  const e = mark(D, 10, 2958);
  const tenM = race({ outcome: { status: 'done', contextId: e.id } });
  const dm = data(sessions, [e]);
  assert.equal(enduranceRecords(dm).run.best['10k'].entryId, e.id);
  assert.equal(RR.resultRecord(dm, tenM, RR.resolveResult(dm, tenM)).current.id, '10k');
  // Marca a mano que es la misma carrera que una actividad: cuenta la actividad (alsoContext)
  const dup = run(D, 10.02, 2960);
  const dd = data([...sessions, dup], [e]);
  const b = enduranceRecords(dd).run.best['10k'];
  assert.deepEqual([b.sessionId, b.alsoContext], [dup.id, e.id]);
  assert.equal(RR.resultRecord(dd, tenM, RR.resolveResult(dd, tenM)).current.id, '10k');
  // Bici: la salida más larga
  const ride = act('bike', D, 160, 21600);
  const db = data([act('bike', ago(9, D), 80, 10800), ride]);
  const qh = race({ type: 'cycling', distanceKm: 160, targetSec: null, outcome: { status: 'done', activityId: ride.id } });
  assert.equal(RR.resultRecord(db, qh, RR.resolveResult(db, qh)).longest, 'Tu salida en bici más larga');
});

test('no participé y omitido: sin comparación ni predicción previa', () => {
  const d = data(before());
  const dns = RR.outcomeView(d, race({ outcome: { status: 'dns' } }));
  assert.deepEqual([dns.state, dns.diff, dns.prior, dns.record, dns.rowText], ['dns', null, null, null, 'No participaste']);
  const sk = RR.outcomeView(d, race({ outcome: { status: 'skipped' } }));
  assert.deepEqual([sk.state, sk.rowText], ['skipped', null]);
  assert.deepEqual([RR.outcomeView(d, race()).state, RR.outcomeView(d, race()).rowText], ['pending', null]);
});

test('copia de seguridad: el resultado sobrevive a la ida y vuelta; una copia antigua sin él = sin responder', () => {
  const outcome = { status: 'done', activityId: 'run1', contextId: null, manual: null, place: 3, note: 'n', at: 7 };
  const exp = { app: BACKUP_APP_ID, format: BACKUP_FORMAT, appVersion: '1.0.0', exportedAt: '2026-10-09T10:00:00Z', data: { meta: [{ id: 'settings', ...defaultSettings() }], races: [race({ id: 'r1', outcome }), race({ id: 'r0' })] } };
  const r = parseBackupText(JSON.stringify(buildBackupObject(exp, 1)), validateBackup);
  assert.equal(r.ok, true, r.error);
  const back = r.backup.data.races;
  assert.deepEqual(R.normalizeRace(back.find((x) => x.id === 'r1')).outcome, outcome);
  assert.equal(R.normalizeRace(back.find((x) => x.id === 'r0')).outcome, null);
});

test('informe para IA: «EVENTOS RECIENTES» con el resultado frente al objetivo y a la previsión previa', () => {
  const sessions = before();
  const res = run(D, 10, 2958);
  const races = [
    race({ id: 'done', outcome: { status: 'done', activityId: res.id, place: 41, note: 'SECRETO' } }),
    race({ id: 'dns', type: '5k', distanceKm: 5, targetSec: null, date: ago(30), outcome: { status: 'dns', note: 'SECRETO' } }),
    race({ id: 'skip', type: 'half', date: ago(40), outcome: { status: 'skipped' } }),
    race({ id: 'old', date: ago(400), outcome: { status: 'dns' } }),
  ];
  const d = { ...data([...sessions, res]), races, checkins: [], cycleDays: [], goals: [] };
  const items = RR.pastEventsForReport(d, races, T);
  assert.deepEqual(items.map((x) => x.race.id), ['done', 'dns']);
  const p = RR.priorPrediction(d, races[0]);
  const pos = { inside: 'dentro del rango', faster: 'más rápido que el rango', slower: 'más lento que el rango' }[RR.rangePosition(2958, p)];
  assert.deepEqual(items[0].bits, ['objetivo <50:00', 'resultado 49:18 (42 s mejor)', 'puesto 41', `previsión previa ${p.range} (${pos})`]);
  const text = reportText(buildAnalysis(d, T));
  assert.match(text, /\nEVENTOS RECIENTES[^\n]*\n- 10K · 4 oct · objetivo <50:00 · resultado 49:18 \(42 s mejor\) · puesto 41 · previsión previa /);
  assert.match(text, /\n- 5K · 9 sep · no participó\n/);
  assert.doesNotMatch(text, /SECRETO/, 'sin notas');
  assert.doesNotMatch(text, /Media maratón · .* · omit/);
});

test('rendimiento: outcomeView del detalle con ~600 carreras (predicción previa y récords, también «en su momento»)', () => {
  const sessions = [];
  for (let i = 0; i < 600; i++) sessions.push(run(ago(i * 2 + 1, D), 6 + (i % 9), (6 + (i % 9)) * (300 + (i % 23))));
  const res = run(D, 10, 2958);
  sessions.push(res, run(addDays(D, 2), 10, 2900));
  const ten = race({ outcome: { status: 'done', activityId: res.id } });
  const t0 = performance.now();
  const v = RR.outcomeView(data(sessions), ten);
  const ms = performance.now() - t0;
  assert.equal(v.state, 'done');
  assert.ok(v.prior.ok);
  // Medido (Node, en frío, datos nuevos): 5–10 ms (un análisis de carreras de la víspera y dos índices de récords, el
  // actual y el «en su momento»). Límite ×15 para máquinas lentas o la batería en paralelo; salta si, por ejemplo, se
  // recalculara algo una vez por carrera.
  assert.ok(ms < 150, `outcomeView tardó ${Math.round(ms)} ms`);
});
