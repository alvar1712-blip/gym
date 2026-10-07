// Portada de Progreso (js/overview.js, docs/PULIDO.md §7): Fuerza, Resistencia, Cuerpo y Recuperación con su cifra
// clave, el cambio reciente (4 últimas semanas completas frente a las 4 anteriores), la minigráfica y su destino.
// Sin datos: qué falta, nunca NaN. Hoy = miércoles 7 oct 2026. Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { progressOverview, SPARK_WEEKS } from '../../js/overview.js';
import { addDays, weekStart } from '../../js/util.js';

const T = '2026-10-07';
const W0 = weekStart(T); // semana en curso
/** n semanas completas (más la en curso), con km de carrera, series y carga por semana. */
function weeks(n, f) {
  const out = [];
  for (let i = n; i >= 0; i--) {
    const week = addDays(W0, -7 * i);
    out.push({ week, current: i === 0, workSets: 0, loadTotal: 0, km: { run: 0, bike: 0, swim: 0, hike: 0 }, ...f(i) });
  }
  return out;
}
const rows = (o) => Object.fromEntries(progressOverview({ today: T, ...o }).map((r) => [r.area, r]));
const noBad = (r) => assert.ok(!/NaN|Infinity|undefined|null/.test(JSON.stringify([r.value, r.change, r.label])), JSON.stringify(r));

test('sin datos: las cuatro filas dicen qué falta (nada roto) y llevan su destino', () => {
  const r = progressOverview({ today: T, weeks: [], analysis: null, bodyweight: [] });
  assert.deepEqual(r.map((x) => x.area), ['strength', 'endurance', 'body', 'recovery']);
  for (const x of r) {
    noBad(x);
    assert.equal(x.state?.kind, 'insufficient', x.area);
    assert.ok(x.href.startsWith('#/'));
  }
  assert.match(r[2].change, /Pésate/);
  assert.equal(r[3].value, 'Sin check-ins');
});

test('resistencia: el deporte al que dedicas más tiempo, media de las 4 últimas semanas completas frente a las 4 anteriores', () => {
  // 8 semanas completas: carrera 4 antiguas a 20 km y 4 recientes a 25 km (unas 2 h/sem); bici, más km pero menos
  // tiempo (60 km en 2 h en total): manda la carrera. La semana en curso (a medias) no cuenta.
  const ws = weeks(8, (i) => ({
    km: { run: i === 0 ? 3 : i <= 4 ? 25 : 20, bike: i === 2 ? 60 : 0, swim: 0, hike: 0 },
    minutes: { run: i === 0 ? 15 : 125, bike: i === 2 ? 120 : 0, swim: 0, hike: 0 },
  }));
  const e = rows({ weeks: ws }).endurance;
  assert.equal(e.label, 'Resistencia · carrera');
  assert.equal(e.value, '25 km/sem');
  assert.equal(e.change, '+25 % frente a las 4 anteriores');
  assert.equal(e.spark.length, 8);
  assert.equal(e.spark.at(-1), 25, 'la minigráfica acaba en la última semana completa');
  noBad(e);
});

test('la minigráfica tiene como mucho 12 semanas y sin la semana en curso', () => {
  const ws = weeks(30, (i) => ({ workSets: 40 + i, loadTotal: 1000 }));
  const s = rows({ weeks: ws }).strength;
  assert.equal(s.spark.length, SPARK_WEEKS);
  assert.equal(s.spark.at(-1), 41);
});

test('fuerza: «N de M mejoran» y el ritmo típico del analista; progresa si mejoran la mitad o más', () => {
  const analysis = { strength: { summary: { improving: 6, mainCount: 10, stalled: 3, down: 1, trendPctPerWeek: 0.62 } } };
  const s = rows({ weeks: weeks(4, () => ({ workSets: 50 })), analysis }).strength;
  assert.equal(s.value, '6 de 10 mejoran');
  assert.equal(s.change, 'Ritmo típico +0,62 %/sem');
  assert.deepEqual(s.state, { kind: 'progress', label: 'Progresa' });
  const stalled = rows({ weeks: [], analysis: { strength: { summary: { improving: 2, mainCount: 10, stalled: 6, down: 1, trendPctPerWeek: 0 } } } }).strength;
  assert.equal(stalled.state.kind, 'stalled');
  assert.equal(rows({ weeks: [], analysis: { strength: { summary: { improving: 1, mainCount: 1, stalled: 0, down: 0, trendPctPerWeek: 1.2 } } } }).strength.value, '1 de 1 mejora');
});

test('cuerpo: tendencia y ritmo del analista; minigráfica con la media de cada semana pesada (sin inventar semanas)', () => {
  const analysis = { weight: { ok: true, status: 'in', trend: { currentKg: 80.64, ratePerWeekKg: -0.234 } } };
  const bw = [];
  for (let d = addDays(W0, -21); d < W0; d = addDays(d, 1)) if (d < addDays(W0, -14) || d >= addDays(W0, -7)) bw.push({ id: d, kg: 80 });
  bw.push({ id: T, kg: 79 }); // esta semana: no entra (a medias)
  const b = rows({ weeks: [], analysis, bodyweight: bw }).body;
  assert.equal(b.value, '80,6 kg');
  assert.equal(b.change, '−0,2 kg por semana');
  assert.deepEqual(b.state, { kind: 'ok', label: 'En tu rango' });
  assert.deepEqual(b.spark, [80, 80], 'dos semanas con pesajes; la del medio, sin pesar, no se inventa');
  const few = rows({ weeks: [], analysis: { weight: { ok: false, trend: { currentKg: 80, ratePerWeekKg: NaN } } } }).body;
  assert.equal(few.change, 'Aún pocos pesajes para ver tu ritmo');
  noBad(few);
});

test('recuperación: señales de cansancio de los check-ins y la carga frente a las semanas anteriores', () => {
  const ws = weeks(8, (i) => ({ loadTotal: i <= 4 ? 900 : 1000 }));
  const tired = { wellbeing: { count: 10, daysWith: 8, sleep: { n: 10, low: 5 }, energy: { n: 10, low: 4 } } };
  const r = rows({ weeks: ws, analysis: tired }).recovery;
  assert.equal(r.value, 'Señales de cansancio');
  assert.equal(r.state.kind, 'warn');
  assert.equal(r.change, 'Carga −10 % frente a las 4 anteriores');
  const fine = rows({ weeks: [], analysis: { wellbeing: { count: 6, daysWith: 6, sleep: { n: 6, low: 0 }, energy: { n: 6, low: 1 } } } }).recovery;
  assert.deepEqual([fine.value, fine.state.kind, fine.change], ['Sin señales de fatiga', 'ok', '6 días con check-in en 4 semanas']);
});
