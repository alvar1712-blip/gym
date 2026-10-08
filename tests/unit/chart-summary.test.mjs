// La frase encima de una gráfica (js/chart-summary.js, docs/PULIDO.md §12): lo que hay que entender del periodo.
// Hoy = 7 oct 2026. Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelSummary, weeklySummary, sinceText } from '../../js/chart-summary.js';
import { addDays, weekStart } from '../../js/util.js';

const T = '2026-10-07';
const pts = (list) => list.map(([x, y]) => ({ x, y }));

test('nivel: «+7,5 kg desde septiembre», «−1,2 kg desde el 20 sep», estable con su oscilación', () => {
  assert.deepEqual(levelSummary(pts([['2026-08-03', 80], ['2026-09-01', 84], ['2026-10-06', 87.5]]), { today: T }), { text: '+7,5 kg desde agosto', dir: 'up' });
  assert.equal(levelSummary(pts([['2026-09-20', 81.4], ['2026-10-06', 80.2]]), { today: T }).text, '−1,2 kg desde el 20 sep');
  assert.deepEqual(levelSummary(pts([['2026-07-10', 80.1], ['2026-08-10', 80.5], ['2026-10-06', 80.2]]), { today: T, stable: 0.3 }),
    { text: 'Estable: ±0,2 kg en el periodo', dir: 'flat' });
  assert.equal(levelSummary(pts([['2025-11-02', 60], ['2026-10-01', 70]]), { today: T }).text, '+10 kg desde noviembre de 2025');
});

test('nivel: solo el periodo que se ve; sin 2 puntos válidos → sin frase; nunca NaN ni signos dobles', () => {
  const p = pts([['2026-05-01', 70], ['2026-09-01', 80], ['2026-10-01', 82]]);
  assert.equal(levelSummary(p, { from: '2026-08-01', today: T }).text, '+2 kg desde el 1 sep', 'el primer punto del periodo, no el de mayo');
  assert.equal(levelSummary(pts([['2026-10-01', 80]]), { today: T }), null);
  assert.equal(levelSummary(pts([['2026-10-01', NaN], ['2026-10-02', 81]]), { today: T }), null);
  assert.equal(levelSummary(null, { today: T }), null);
  const t = levelSummary(pts([['2026-09-01', 80], ['2026-10-01', 79.99]]), { today: T }).text;
  assert.ok(!/NaN|Infinity|[+−]{2}|--/.test(t), t);
  assert.equal(t, 'Estable: ±0 kg en el periodo', 'un cambio que redondea a 0 no es «−0»');
});

test('nivel con ruido: los extremos se promedian (una sesión rara al principio o al final no decide)', () => {
  // 1RM por sesión: 55,5 · 54 · 55,5 | … | 52,5 · 50,5 · 55 → media inicial 55, final ~52,7 → −2,3 kg (no −0,5 ni −5)
  const p = pts([['2026-07-08', 55.5], ['2026-07-15', 54], ['2026-07-22', 55.5], ['2026-08-05', 49.5], ['2026-08-20', 54], ['2026-09-02', 57],
    ['2026-09-16', 52.5], ['2026-09-23', 50.5], ['2026-09-30', 55]]);
  assert.equal(levelSummary(p, { today: T }).text, '−2,3 kg desde julio');
});

test('semanal: media de las semanas completas y cambio frente al periodo anterior de la misma duración', () => {
  const W = weekStart(T);
  const rows = [];
  for (let i = 12; i >= 0; i--) rows.push({ week: addDays(W, -7 * i), current: i === 0, km: i === 0 ? 3 : i <= 4 ? 25 : 20 });
  const from = addDays(W, -7 * 4);
  assert.deepEqual(weeklySummary(rows, (r) => r.km, { from, unit: 'km' }), { text: 'Media 25 km/sem · +25 % frente al periodo anterior', dir: 'up' });
  // Sin periodo anterior entero: solo la media
  assert.deepEqual(weeklySummary(rows.slice(-6), (r) => r.km, { from: addDays(W, -7 * 4), unit: 'km' }), { text: 'Media 25 km/sem', dir: null });
  // Nada en el periodo → sin frase
  assert.equal(weeklySummary(rows.map((r) => ({ ...r, km: 0 })), (r) => r.km, { from, unit: 'km' }), null);
  assert.equal(weeklySummary([], (r) => r.km, { from, unit: 'km' }), null);
});

test('«desde…»: fecha cercana con día; lejana, el mes (y el año si no es este)', () => {
  assert.equal(sinceText('2026-09-28', T), 'desde el 28 sep');
  assert.equal(sinceText('2026-06-15', T), 'desde junio');
  assert.equal(sinceText('2025-06-15', T), 'desde junio de 2025');
});
