// Récords de running con tus marcas históricas de «Tu contexto» (docs/MEJORAS6.md): Progreso › Récords es una vista
// derivada (stats.enduranceRecords) de las carreras registradas o importadas y de los resultados de carrera del contexto,
// sin copias. Un récord es la mejor marca de SIEMPRE (la antigüedad no le quita valor); en la predicción actual, en
// cambio, una marca antigua pesa poco. Hoy = 7 oct 2026. Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../js/context-logic.js';
import { enduranceRecords, historicalRunMarks, strengthRecords, RECORD_DISTANCES, RECORD_ORIGIN, RACE_DISTANCES } from '../../js/stats.js';
import { predictRaces } from '../../js/race-predict.js';
import { periodSummary } from '../../js/summary-logic.js';
import { addDays, tsFromDate } from '../../js/util.js';
import { SEED_EXERCISES, defaultSettings } from '../../js/seed.js';

const T = '2026-10-07';
const ago = (n) => addDays(T, -n);
const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
let seq = 0;
const run = (date, km, sec, extra = {}) => ({ id: `run${++seq}`, kind: 'run', status: 'done', date, distanceKm: km, movingSec: sec, durationMin: sec / 60, rpe: 6, startedAt: tsFromDate(date, 8), ...extra });
const mark = (date, precision, km, sec, extra = {}) => C.entryRecord({ kind: 'event', type: 'race_result', date: { date, precision }, text: '', notes: '', result: { km, sec }, ...extra }, { id: `res${++seq}`, now: seq });
const data = (sessions, context = []) => ({ sessions, context, exercises: EX, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], today: T });
const best = (d, id) => enduranceRecords(d).run.best[id];

test('las distancias de Récords: 1 km, 5 km, 10 km, media y maratón (1 km solo en Récords, no en las predicciones)', () => {
  assert.deepEqual(RECORD_DISTANCES.map((r) => r.id), ['1k', '5k', '10k', 'half', 'marathon']);
  assert.deepEqual(RACE_DISTANCES.map((r) => r.id), ['5k', '10k', 'half', 'marathon']);
  assert.deepEqual(Object.keys(predictRaces(data([run(ago(2), 5, 1500), run(ago(9), 10, 3100)])).predictions), ['5k', '10k', 'half', 'marathon']);
});

test('una marca histórica de 5 km o de 10 km es récord sin ninguna carrera registrada (fecha exacta y aproximada)', () => {
  const five = mark('2026-04-12', 'day', 5, 24 * 60 + 32, { text: 'Carrera popular' });
  const ten = mark('2026-05-20', 'month', 10, 3600);
  const r = enduranceRecords(data([], [five, ten]));
  assert.equal(r.run.count, 0);
  assert.equal(r.run.historyCount, 2);
  const b5 = r.run.best['5k'];
  assert.deepEqual({ t: b5.timeLabel, when: b5.when, source: b5.source, origin: b5.origin, entryId: b5.entryId, sessionId: b5.sessionId, name: b5.name, estimated: b5.estimated },
    { t: '24:32', when: '12 abr 2026', source: 'context', origin: 'Marca histórica', entryId: five.id, sessionId: null, name: 'Carrera popular', estimated: false });
  const b10 = r.run.best['10k'];
  assert.deepEqual({ t: b10.timeLabel, when: b10.when, precision: b10.precision, source: b10.source }, { t: '1:00:00', when: 'may 2026', precision: 'month', source: 'context' });
  assert.equal(b10.date, '2026-05-01', 'solo para ordenar: el principio de su periodo');
  // 1 km: al ritmo medio de la marca más rápida (estimado), como con las carreras registradas
  assert.deepEqual([r.run.best['1k'].timeLabel, r.run.best['1k'].estimated], ['4:54', true]);
  assert.equal(r.run.best.half, null);
  assert.equal(r.run.longest.source, 'context');
  assert.equal(r.run.longest.distanceKm, 10);
});

test('fechas aproximadas: se muestran con la precisión apuntada (día, mes, estación, año), nunca con un día inventado', () => {
  const when = (precision, date) => best(data([], [mark(date, precision, 10, 3000)]), '10k').when;
  assert.equal(when('day', '2026-05-15'), '15 may 2026');
  assert.equal(when('month', '2026-05-15'), 'may 2026');
  assert.equal(when('season', '2026-04-10'), 'primavera 2026');
  assert.equal(when('year', '2026-08-01'), '2026');
});

test('histórico mejor que lo registrado después → sigue siendo el récord; una carrera mejor lo supera (sin tocar la marca)', () => {
  const hist = mark('2026-05-01', 'month', 10, 3600);
  const slower = run('2026-09-10', 10, 64 * 60 + 20);
  let b = best(data([slower], [hist]), '10k');
  assert.deepEqual([b.timeLabel, b.origin], ['1:00:00', 'Marca histórica']);
  const faster = run('2026-10-01', 10, 57 * 60 + 40);
  const ctx = [hist];
  b = best(data([slower, faster], ctx), '10k');
  assert.deepEqual([b.timeLabel, b.origin, b.sessionId, b.when], ['57:40', 'Registrado en Entreno', faster.id, '1 oct 2026']);
  assert.deepEqual(ctx, [hist], 'la marca sigue guardada tal cual');
  assert.equal(enduranceRecords(data([slower, faster], ctx)).run.historyCount, 1);
});

test('editar, borrar y deshacer: el récord se recalcula (vista derivada)', () => {
  const act = run('2026-09-20', 10, 55 * 60 + 30);
  const hist = mark('2026-03-01', 'month', 10, 55 * 60);
  assert.equal(best(data([act], [hist]), '10k').source, 'context');
  // Editar la marca a 56:00 → la carrera de 55:30 pasa a ser el récord
  const edited = C.entryRecord({ ...hist, result: { ...hist.result, sec: 56 * 60 } }, { id: hist.id });
  assert.deepEqual([best(data([act], [edited]), '10k').timeLabel, best(data([act], [edited]), '10k').source], ['55:30', 'app']);
  // Borrar → la carrera; deshacer (el mismo registro vuelve) → la marca otra vez
  assert.equal(best(data([act], []), '10k').sessionId, act.id);
  assert.deepEqual([best(data([act], [hist]), '10k').timeLabel, best(data([act], [hist]), '10k').entryId], ['55:00', hist.id]);
});

test('actividad importada que es la misma carrera que la marca → una sola vez (cuenta la importada); nada se borra', () => {
  const hist = mark('2026-09-15', 'day', 10, 3600, { text: 'Carrera de otoño' });
  const imported = run('2026-09-15', 10.08, 3620, { source: { type: 'fit', fileName: 'carrera.fit' } });
  const d = data([imported], [hist]);
  const { marks, duplicates } = historicalRunMarks(d);
  assert.deepEqual(marks, []);
  assert.equal(duplicates.get(imported.id), hist.id);
  const r = enduranceRecords(d);
  assert.equal(r.run.historyCount, 0);
  const b = r.run.best['10k'];
  assert.deepEqual([b.source, b.origin, b.sessionId, b.alsoContext], ['import', 'Actividad importada', imported.id, hist.id]);
  // Si no coincide (otro tiempo, +10 %), son dos carreras distintas y gana la mejor
  const other = mark('2026-09-15', 'day', 10, 3300);
  assert.equal(best(data([imported], [other]), '10k').source, 'context');
  // Las predicciones usan la misma regla (cuenta la registrada)
  assert.equal(predictRaces(data([imported, run(ago(4), 5, 1500)], [hist])).duplicates.length, 1);
});

test('un récord antiguo sigue siendo el récord (la antigüedad no le quita valor); en la predicción actual pesa poco', () => {
  const old = mark('2023-05-01', 'month', 10, 50 * 60);
  const recent = [run(ago(3), 5, 1600), run(ago(10), 8, 2700), run(ago(17), 6, 2000)];
  const d = data(recent, [old]);
  const b = best(d, '10k');
  assert.deepEqual([b.timeLabel, b.when, b.origin], ['50:00', 'may 2023', 'Marca histórica']);
  const p = predictRaces(d).predictions['10k'];
  const ref = p.efforts.find((e) => e.old);
  assert.ok(ref.share < 0.01, `en la predicción casi no pesa: ${ref.share}`);
  assert.ok(p.mid > 50 * 60 * 1.05, 'la estimación de hoy no es el récord');
  assert.ok(p.why.data.some((x) => x.label === 'Tu récord en 10 km (la mejor de siempre)' && /^50:00 · may 2023 · marca histórica$/.test(x.value)), JSON.stringify(p.why.data.map((x) => x.label)));
});

test('distancia personalizada: no crea filas nuevas; cuenta para las estándar menores (a ritmo medio) y para la mayor distancia', () => {
  const custom = mark('2026-06-01', 'month', 7.5, 2400);
  const r = enduranceRecords(data([], [custom]));
  assert.deepEqual(Object.keys(r.run.best), ['1k', '5k', '10k', 'half', 'marathon']);
  assert.deepEqual([r.run.best['5k'].timeLabel, r.run.best['5k'].estimated, r.run.best['5k'].fromKm], ['26:40', true, 7.5]);
  assert.equal(r.run.best['10k'], null);
  assert.equal(r.run.longest.distanceKm, 7.5);
});

test('lo que no vale no es récord: ritmo imposible; ni empata por delante de la primera vez', () => {
  assert.equal(best(data([], [mark('2026-05-01', 'day', 10, 31 * 3600)]), '10k'), null);
  assert.equal(best(data([], [mark('2026-05-01', 'day', 10, 1000)]), '10k'), null);
  // Empate exacto entre dos carreras distintas (20 km a ritmo de 1:00:00 el 10 km): cuenta la primera vez (la marca de
  // mayo, desde el principio de su periodo, va antes que una carrera del 20 de mayo; la de junio, después)
  const tie = run('2026-05-20', 20, 7200);
  assert.equal(best(data([tie], [mark('2026-05-01', 'month', 10, 3600)]), '10k').source, 'context');
  assert.equal(best(data([tie], [mark('2026-06-01', 'month', 10, 3600)]), '10k').source, 'app');
  // Misma fecha, distancia y tiempo: es la misma carrera (duplicado), no un empate → la registrada
  assert.equal(best(data([run('2026-05-20', 10, 3600)], [mark('2026-05-01', 'month', 10, 3600)]), '10k').source, 'app');
});

test('resúmenes: una carrera que no mejora tu marca histórica no es «récord del periodo»; si la mejora, sí', () => {
  const hist = mark('2026-05-01', 'month', 10, 3600);
  const sept = [run('2026-09-05', 10, 3900), run('2026-09-20', 10, 3800)];
  const recs = (sessions, ctx) => periodSummary(data(sessions, ctx), { unit: 'month', start: '2026-09-01', today: T }).records.filter((x) => x.type === 'endurance' && x.metric === '10k');
  assert.equal(recs(sept, []).length, 1, 'sin la marca, la del 20 sep mejora la del 5');
  assert.equal(recs(sept, [hist]).length, 0, 'con la marca de 1:00:00, ninguna es récord');
  assert.equal(recs([...sept, run('2026-09-28', 10, 3500)], [hist]).length, 1, '58:20 sí mejora tu marca');
});

test('los récords de fuerza no cambian con las marcas de carrera', () => {
  const s = { id: 'st1', kind: 'strength', status: 'done', date: ago(3), startedAt: tsFromDate(ago(3), 18), durationMin: 60, rpe: 7, exercises: [{ id: 'e1', exerciseId: 'press_banca', sets: [{ id: 'x', type: 'effective', done: true, weight: 80, reps: 5, rir: 2 }] }] };
  assert.deepEqual(strengthRecords(data([s], [mark('2026-05-01', 'month', 10, 3600)])), strengthRecords(data([s], [])));
  assert.equal(RECORD_ORIGIN.context, 'Marca histórica');
});
