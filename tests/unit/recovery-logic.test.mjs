// Pruebas de js/recovery-logic.js (ronda 8, F: evolución de los check-ins y zonas que se repiten). Datos sintéticos;
// hoy = sábado 10 oct 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayValues, wellbeingTrend, zoneTrends, zoneTrend, trendWindow, trendWindows, zoneName, MIN_DAYS, ZONE_SEQ_MAX,
} from '../../js/recovery-logic.js';
import { addDays, dow, diffDays } from '../../js/util.js';

const TODAY = '2026-10-10';
const ago = (n) => addDays(TODAY, -n);
const approx = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
let seq = 0;
const ci = (date, vals = {}, timing = 'pre', extra = {}) => ({
  id: `c${++seq}`, date, timing, sessionId: null, sleep: null, energy: null, stress: null, soreness: null, createdAt: seq, ...vals, ...extra,
});
const zone = (kind, zoneId, level, side = null, note = '') => ({ id: `z${++seq}`, kind, zone: zoneId, side, level, note });
const row = (t, key) => t.rows.find((r) => r.key === key);

test('datos escasos: sin check-ins y con 3 días en 4 semanas no hay medias', () => {
  const none = wellbeingTrend([], TODAY, '4w');
  assert.equal(none.daysWith, 0);
  assert.equal(none.enough, false);
  assert.equal(none.hasAll, false);
  assert.ok(none.rows.every((r) => r.mean == null && r.word == null && r.cells.every((c) => c.n === 0 && c.level == null)));

  const few = [ci(ago(1), { energy: 1 }), ci(ago(5), { energy: 3 }), ci(ago(9), { energy: 2, sleep: 2 })];
  const t = wellbeingTrend(few, TODAY, '4w');
  assert.equal(t.daysWith, 3);
  assert.equal(t.enough, false);
  const e = row(t, 'energy');
  assert.equal(e.n, 3);
  assert.equal(e.mean, null, 'menos de MIN_DAYS días: sin media');
  const cell = e.cells.find((c) => c.from === ago(5));
  assert.deepEqual([cell.n, cell.mean, cell.level], [1, 3, 3], 'los bloques sí se pintan');
  assert.equal(MIN_DAYS, 4);
});

test('periodos: 28 días, 12 semanas desde un lunes, «Todo» por meses o trimestres; fuera del periodo no cuenta', () => {
  const list = [];
  for (let i = 0; i < 70; i += 2) list.push(ci(ago(i), { energy: i < 28 ? 3 : 1 })); // 10 semanas de historial
  const t4 = wellbeingTrend(list, TODAY, '4w');
  assert.equal(t4.bucket, 'day');
  assert.equal(row(t4, 'energy').cells.length, 28);
  assert.equal(t4.from, ago(27));
  assert.equal(row(t4, 'energy').mean, 3, 'lo anterior a las 4 semanas no cuenta');
  assert.equal(row(t4, 'energy').prevMean, 1, 'el periodo anterior (28 días antes)');
  assert.equal(t4.hasAll, false, '10 semanas: no hay «Todo»');

  const t12 = wellbeingTrend(list, TODAY, '12w');
  assert.equal(t12.bucket, 'week');
  const cells = row(t12, 'energy').cells;
  assert.equal(cells.length, 12);
  assert.ok(cells.every((c) => dow(c.from) === 0), 'cada semana empieza en lunes');
  assert.equal(cells[11].to, TODAY, 'la semana en curso acaba hoy');
  assert.equal(diffDays(cells[0].from, cells[11].from), 77);

  assert.equal(wellbeingTrend(list, TODAY, 'all').period, '4w', '«Todo» sin historial suficiente cae en 4 semanas');

  const long = [ci(ago(280), { sleep: 2 }), ci(ago(3), { sleep: 3 })]; // 40 semanas
  const all = wellbeingTrend(long, TODAY, 'all');
  assert.equal(all.hasAll, true);
  assert.equal(all.bucket, 'month');
  assert.equal(all.rows[0].cells[0].from, `${ago(280).slice(0, 7)}-01`);
  assert.equal(all.rows[0].cells.at(-1).to, TODAY);
  assert.equal(all.rows[0].prevMean, null, '«Todo» no tiene periodo anterior');

  const huge = [ci('2022-03-15', { sleep: 2 }), ci(ago(1), { sleep: 2 })]; // más de 36 meses
  const q = wellbeingTrend(huge, TODAY, 'all');
  assert.equal(q.bucket, 'quarter');
  assert.ok(q.rows[0].cells.length <= 36);
  assert.equal(q.rows[0].cells[0].from, '2022-01-01');
  assert.equal(q.rows[0].cells[0].label, 'ene–mar 2022');
});

test('mismo día antes y después: manda el de antes y el de después rellena lo que falta', () => {
  const list = [
    ci(ago(2), { sleep: 1, energy: 1 }, 'pre'),
    ci(ago(2), { sleep: 3, energy: 3, soreness: 3 }, 'post'),
  ];
  const v = dayValues(list).get(ago(2));
  assert.deepEqual(v, { sleep: 1, energy: 1, stress: null, soreness: 3 });
  // Dos copias del mismo momento: la editada más tarde
  const dup = [ci(ago(1), { energy: 1 }, 'pre', { updatedAt: 5 }), ci(ago(1), { energy: 3 }, 'pre', { updatedAt: 9 })];
  assert.equal(dayValues(dup).get(ago(1)).energy, 3);
});

test('zonas: secuencia, tendencia, lados aparte, mismo día = máximo, mínimo 3 fechas, 6 últimos y última nota', () => {
  const list = [
    ci(ago(30), {}, 'pre', { areas: [zone('joint', 'knee', 6, 'left', 'tras el peso muerto rumano')] }),
    ci(ago(20), {}, 'pre', { areas: [zone('joint', 'knee', 5, 'left'), zone('joint', 'knee', 2, 'right')] }),
    ci(ago(10), {}, 'pre', { areas: [zone('joint', 'knee', 3, 'left'), zone('joint', 'knee', 3, 'right')] }),
    ci(ago(10), {}, 'post', { areas: [zone('joint', 'knee', 4, 'left')] }),
    ci(ago(4), {}, 'pre', { areas: [zone('joint', 'knee', 2, 'left', ''), zone('joint', 'knee', 4, 'right'), zone('muscle', 'quads', 7)] }),
    ci(ago(3), {}, 'pre', { areas: [zone('muscle', 'quads', 5)] }),
  ];
  const z = zoneTrends(list, TODAY);
  const left = z.find((x) => x.key === 'joint:knee:left');
  assert.deepEqual(left.seq.map((x) => x.level), [6, 5, 4, 2], 'mismo día antes 3 y después 4 → 4');
  assert.equal(left.trend, 'better');
  approx(left.diff, -2.5);
  assert.equal(left.name, 'Rodilla izq.');
  assert.equal(left.kindWord, 'molestia');
  assert.equal(left.times, 4);
  assert.equal(left.lastDate, ago(4));
  assert.deepEqual(left.note, { date: ago(30), text: 'tras el peso muerto rumano' }, 'la última nota no vacía');
  const right = z.find((x) => x.key === 'joint:knee:right');
  assert.deepEqual(right.seq.map((x) => x.level), [2, 3, 4], 'la derecha va aparte');
  assert.equal(right.name, 'Rodilla der.');
  assert.equal(z.find((x) => x.zone === 'quads'), undefined, 'solo 2 registros: no aparece');
  assert.deepEqual(z.map((x) => x.key), ['joint:knee:right', 'joint:knee:left'], 'la más reciente primero (empate: por nombre, «der.» antes que «izq.»)');
  // Desde una fecha: lo anterior no cuenta
  assert.deepEqual(zoneTrends(list, TODAY, { from: ago(25) }).map((x) => x.key), ['joint:knee:right', 'joint:knee:left']);
  assert.deepEqual(zoneTrends(list, TODAY, { from: ago(15) }).map((x) => x.key), []);
});

test('zonas: la regla de mejora y empeoramiento y la ventana de 6 valores', () => {
  assert.equal(zoneTrend([3, 4, 3, 4]).trend, 'stable');
  assert.equal(zoneTrend([2, 3, 5, 6]).trend, 'worse');
  assert.equal(zoneTrend([6, 5, 4, 2]).trend, 'better');
  assert.equal(zoneTrend([5, 4, 3]).trend, 'stable', '(5+4)/2 − (4+3)/2 = −1');
  const list = [8, 8, 8, 7, 6, 5, 4, 3].map((lv, i) => ci(ago(40 - i * 5), {}, 'pre', { areas: [zone('muscle', 'hamstrings', lv, null, i === 2 ? 'nota vieja' : i === 6 ? 'nota nueva' : '')] }));
  const [h] = zoneTrends(list, TODAY);
  assert.equal(h.seq.length, ZONE_SEQ_MAX);
  assert.deepEqual(h.seq.map((x) => x.level), [8, 7, 6, 5, 4, 3]);
  assert.equal(h.times, 8);
  assert.equal(h.trend, 'better');
  assert.equal(h.note.text, 'nota nueva');
  assert.equal(h.kindWord, 'agujetas');
  assert.equal(zoneName({ kind: 'joint', zone: 'shoulder', side: 'both' }), 'Hombro ambos lados');
});

test('trendWindow: 14 días recientes frente a los 42 anteriores, un valor por día', () => {
  const list = [];
  // Base (días 14–55): 10 días, 4 con 3 y 6 con 2 → 2,4
  [15, 18, 21, 24].forEach((d) => list.push(ci(ago(d), { energy: 3 })));
  [27, 30, 33, 36, 40, 50].forEach((d) => list.push(ci(ago(d), { energy: 2 })));
  list.push(ci(ago(60), { energy: 3 })); // fuera de la base
  // Recientes (0–13): 1, 1, 1, 2, 2 → 1,4 (el «después» del mismo día no pisa el «antes»)
  [0, 2, 4].forEach((d) => list.push(ci(ago(d), { energy: 1 })));
  [6, 9].forEach((d) => list.push(ci(ago(d), { energy: 2 })));
  list.push(ci(ago(0), { energy: 3 }, 'post'));
  const w = trendWindow(list, TODAY, 'energy');
  assert.equal(w.recent.n, 5);
  approx(w.recent.mean, 1.4);
  assert.equal(w.base.n, 10);
  approx(w.base.mean, 2.4);
  approx(w.diff, -1);
  assert.equal(trendWindows(list, TODAY).sleep.diff, null, 'sin datos de sueño');
});
