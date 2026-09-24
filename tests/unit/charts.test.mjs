// Pruebas de las funciones puras de js/charts.js (periodos, escalas «redondas», ejes y búsqueda binaria).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PERIODS, DEFAULT_PERIOD, periodStart, getPeriod, setPeriod, COLORS,
  niceTicks, tickDecimals, timeTicks, barAxisLabels, nearestIndex, dayNum, dayStr, dateTitle, isWeekly, monthLabel, estimateText,
} from '../../js/charts.js';
import { addDays, weekStart, MONTH_SHORT, fmtNum, fmtDuration } from '../../js/util.js';

const TODAY = '2026-09-24'; // jueves

test('PERIODS: ids y etiquetas del contrato', () => {
  assert.deepEqual(PERIODS, [
    { id: '4w', label: '4 sem' }, { id: '3m', label: '3 meses' }, { id: '6m', label: '6 meses' },
    { id: '1y', label: '1 año' }, { id: 'all', label: 'Todo' },
  ]);
  assert.equal(DEFAULT_PERIOD, '3m');
});

test('periodStart: mismo día hace 4 semanas / 3, 6, 12 meses; «todo» = primer dato', () => {
  assert.equal(periodStart('4w', TODAY), '2026-08-27');
  assert.equal(periodStart('3m', TODAY), '2026-06-24');
  assert.equal(periodStart('6m', TODAY), '2026-03-24');
  assert.equal(periodStart('1y', TODAY), '2025-09-24');
  assert.equal(periodStart('all', TODAY, '2025-01-02'), '2025-01-02');
  assert.equal(periodStart('all', TODAY), null);
  assert.equal(periodStart('xx', TODAY, '2025-01-02'), '2025-01-02', 'id desconocido = todo');
  // fin de mes y cambio de hora
  assert.equal(periodStart('3m', '2026-05-31'), '2026-02-28');
  assert.equal(periodStart('4w', '2026-11-10'), '2026-10-13');
  // por defecto usa hoy
  assert.match(periodStart('4w'), /^\d{4}-\d{2}-\d{2}$/);
});

test('getPeriod / setPeriod: valor por defecto, recuerdo y validación (sin localStorage en Node)', () => {
  assert.equal(getPeriod('t-unit-a'), '3m');
  assert.equal(getPeriod('t-unit-a', '1y'), '1y');
  assert.equal(getPeriod('t-unit-a', 'nope'), '3m');
  assert.equal(setPeriod('t-unit-a', '6m'), true);
  assert.equal(getPeriod('t-unit-a'), '6m');
  assert.equal(setPeriod('t-unit-a', 'bad'), false);
  assert.equal(getPeriod('t-unit-a'), '6m');
  assert.equal(getPeriod('t-unit-b'), '3m', 'cada clave por separado');
});

function mantissaOk(step) {
  const e = Math.floor(Math.log10(step) + 1e-9);
  const m = Math.round((step / 10 ** e) * 1000) / 1000;
  return [1, 2, 2.5, 5, 10].includes(m);
}
function rng(seed) {
  return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
}

test('niceTicks: 3–5 marcas redondas (1, 2, 2,5, 5 × 10^n) que cubren los datos', () => {
  const r = rng(42);
  for (let i = 0; i < 2000; i++) {
    const mag = 10 ** Math.floor(r() * 8 - 3);
    const a = (r() - 0.3) * 100 * mag;
    const b = a + r() * 100 * mag + 1e-6 * mag;
    const t = niceTicks(a, b);
    assert.ok(t.ticks.length >= 3 && t.ticks.length <= 5, `${a}..${b} → ${t.ticks}`);
    assert.ok(mantissaOk(t.step), `paso ${t.step}`);
    assert.ok(t.min <= a + 1e-9 * mag && t.max >= b - 1e-9 * mag, `${a}..${b} cubierto por ${t.min}..${t.max}`);
    for (let j = 1; j < t.ticks.length; j++) {
      assert.ok(Math.abs(t.ticks[j] - t.ticks[j - 1] - t.step) < t.step * 1e-6, 'equiespaciadas');
    }
    for (const v of t.ticks) assert.ok(Math.abs(v / t.step - Math.round(v / t.step)) < 1e-6, `${v} múltiplo de ${t.step}`);
  }
});

test('niceTicks: casos concretos (peso, ceros, iguales, negativos, enteros, fijos)', () => {
  assert.deepEqual(niceTicks(74.2, 76.1).ticks, [74, 75, 76, 77]);
  assert.deepEqual(niceTicks(0, 437, { fixedMin: true }).ticks, [0, 250, 500]);
  assert.deepEqual(niceTicks(0, 20, { fixedMin: true, integer: true }).ticks, [0, 5, 10, 15, 20]);
  // todos iguales: el valor queda centrado
  const eq = niceTicks(80, 80);
  assert.ok(eq.ticks.includes(80) && eq.ticks[0] < 80 && eq.ticks.at(-1) > 80, String(eq.ticks));
  assert.equal(eq.ticks.length, 5);
  // todo a cero con base 0 y enteros
  assert.deepEqual(niceTicks(0, 0, { fixedMin: true, integer: true }).ticks, [0, 1, 2]);
  const z = niceTicks(0, 0);
  assert.ok(z.ticks.includes(0) && z.ticks.length >= 3);
  // negativos (asistencia)
  assert.deepEqual(niceTicks(-25, -10, { integer: true }).ticks, [-25, -20, -15, -10]);
  const mix = niceTicks(-3.2, 4.1);
  assert.ok(mix.ticks.includes(0), 'cruza el cero');
  // enteros: nunca 0,5 series
  for (const [a, b] of [[0, 3], [0, 1], [2, 5], [0, 7]]) {
    const t = niceTicks(a, b, { integer: true, fixedMin: a === 0 });
    assert.ok(t.ticks.every(Number.isInteger), `${a}..${b}: ${t.ticks}`);
    assert.ok(t.ticks.length >= 3 && t.ticks.length <= 5);
  }
  // sin -0 ni decimales basura
  const t = niceTicks(-0.3, 0.7);
  assert.ok(t.ticks.every((v) => !Object.is(v, -0)));
  assert.ok(t.ticks.every((v) => String(v).length <= 5), String(t.ticks));
  // extremo fijo (yMin)
  const f = niceTicks(60, 82, { fixedMin: true });
  assert.equal(f.min, 60);
  assert.ok(f.max >= 82);
});

test('tickDecimals: decimales que escribe el formateador del eje', () => {
  assert.equal(tickDecimals((v) => fmtNum(v, 0)), 0);
  assert.equal(tickDecimals((v) => fmtNum(v, 1), 70, 71), 1);
  assert.equal(tickDecimals((v) => `${fmtNum(v, 2)} s`, 3, 4), 2);
  assert.equal(tickDecimals((v) => fmtNum(v, 2, 2)), 2, 'con ceros fijos («3,00»)');
  assert.equal(tickDecimals((v) => fmtNum(v * 1000, 0)), 3, 'km → metros');
  assert.equal(tickDecimals(fmtDuration, 280, 340), 0, 'min:s');
  assert.equal(tickDecimals((v) => fmtNum(v, 1), 999, 1001), 1, 'con separador de miles');
  assert.equal(tickDecimals(() => ''), null, 'texto fijo: sin límite');
  assert.equal(tickDecimals(null), null);
  assert.equal(tickDecimals(() => { throw new Error('x'); }), null);
});

/** Rótulos tal y como los escribe fmtNum(v, dec): únicos, equiespaciados y iguales a su valor. */
function assertExactLabels(t, dec, ctx) {
  const labels = t.ticks.map((v) => fmtNum(v, dec));
  assert.equal(new Set(labels).size, labels.length, `${ctx}: rótulos repetidos ${labels.join(' | ')}`);
  const back = labels.map((l) => Number(l.replace(/\./g, '').replace(',', '.')));
  back.forEach((v, i) => assert.ok(Math.abs(v - t.ticks[i]) < 1e-9, `${ctx}: «${labels[i]}» ≠ ${t.ticks[i]}`));
}

test('niceTicks maxDecimals: el paso se escribe con los decimales del eje (sin «28» para 27,5)', () => {
  // Casos de la revisión: bici (0 decimales), 1RM y peso (1 decimal), sprint (2) y altura (1)
  const cases = [
    [27.9, 31.2, 0], [26.9, 27.1, 0], [101.1, 102.2, 1], [100, 101, 1], [70.0, 70.7, 1], [75.0, 75.8, 1],
    [3.25, 3.27, 2], [47.5, 47.7, 1],
  ];
  for (const [a, b, dec] of cases) {
    const t = niceTicks(a, b, { maxDecimals: dec });
    assertExactLabels(t, dec, `${a}..${b} (${dec})`);
    assert.ok(t.ticks.length >= 3 && t.ticks.length <= 5, `${a}..${b}: ${t.ticks}`);
    assert.ok(t.min <= a && t.max >= b, `${a}..${b} cubierto por ${t.min}..${t.max}`);
  }
  assert.deepEqual(niceTicks(26.9, 27.1, { maxDecimals: 0 }).ticks, [26, 27, 28]);
  assert.ok(!niceTicks(27.9, 31.2, { maxDecimals: 0 }).ticks.includes(27.5));
  // Sin límite, el paso 2,5 sigue permitido (el eje con 1 decimal lo escribe bien)
  assert.deepEqual(niceTicks(27.9, 31.2, { maxDecimals: 1 }).ticks, [27.5, 30, 32.5]);
  // Aleatorio: 3–5 marcas exactas que cubren los datos, con 0, 1 y 2 decimales
  const r = rng(1234);
  for (let i = 0; i < 3000; i++) {
    const dec = i % 3;
    const mag = 10 ** Math.floor(r() * 4 - 1);
    const a = 40 + r() * 80 * mag;
    const b = a + r() * 5 * mag + 1e-6;
    const t = niceTicks(a, b, { maxDecimals: dec });
    assertExactLabels(t, dec, `${a}..${b} (${dec})`);
    assert.ok(t.ticks.length >= 3 && t.ticks.length <= 5, `${a}..${b}: ${t.ticks}`);
    assert.ok(t.min <= a + 1e-9 && t.max >= b - 1e-9, `${a}..${b} cubierto por ${t.min}..${t.max}`);
    assert.ok(mantissaOk(t.step), `paso ${t.step}`);
  }
  // Base cero fija (barras) y enteros
  assert.deepEqual(niceTicks(0, 0.3, { fixedMin: true, maxDecimals: 0 }).ticks, [0, 1, 2]);
  assert.ok(niceTicks(0, 12.4, { fixedMin: true, maxDecimals: 0 }).ticks.every(Number.isInteger));
});

test('niceTicks modo tiempo: segundos redondos para ritmos (5:00, 5:15…)', () => {
  const t = niceTicks(290, 340, { mode: 'time' });
  assert.deepEqual(t.ticks, [285, 300, 315, 330, 345]);
  const long = niceTicks(1500, 5400, { mode: 'time' });
  assert.ok([600, 900, 1200, 1800, 3600].includes(long.step), String(long.step));
  assert.ok(long.ticks.length >= 3 && long.ticks.length <= 5);
});

test('dayNum / dayStr: ida y vuelta, también en cambios de hora', () => {
  for (const d of ['1970-01-01', '2026-03-29', '2026-10-25', '2024-02-29', '2026-09-24', '2030-12-31']) {
    assert.equal(dayStr(dayNum(d)), d);
  }
  assert.equal(dayNum('2026-09-25') - dayNum('2026-09-24'), 1);
  assert.equal(dayNum('2026-10-26') - dayNum('2026-10-24'), 2);
  let d = '2025-01-01';
  for (let i = 0; i < 800; i++, d = addDays(d, 1)) assert.equal(dayStr(dayNum(d)), d);
});

test('nearestIndex: búsqueda binaria igual que la fuerza bruta', () => {
  assert.equal(nearestIndex([], 3), -1);
  assert.equal(nearestIndex([5], -100), 0);
  const r = rng(7);
  for (let k = 0; k < 200; k++) {
    const arr = [...new Set(Array.from({ length: 1 + Math.floor(r() * 500) }, () => Math.floor(r() * 2000)))].sort((a, b) => a - b);
    for (let q = 0; q < 20; q++) {
      const v = r() * 2200 - 100;
      const i = nearestIndex(arr, v);
      const best = Math.min(...arr.map((x) => Math.abs(x - v)));
      assert.ok(Math.abs(arr[i] - v) <= best + 1e-9);
    }
  }
});

test('timeTicks: etiquetas en español, ≤ 6 y sin solaparse', () => {
  const td = dayNum(TODAY);
  const months = new Set(MONTH_SHORT);
  for (const span of [7, 14, 28, 45, 92, 184, 365, 440, 730, 1500]) {
    for (const w of [120, 220, 300, 320, 360]) {
      const ticks = timeTicks(td - span, td, w);
      assert.ok(ticks.length >= 1 && ticks.length <= 6, `${span} días / ${w}px: ${ticks.length}`);
      for (let i = 1; i < ticks.length; i++) {
        const px = ((ticks[i].d - ticks[i - 1].d) / span) * w;
        const need = (estimateText(ticks[i].label) + estimateText(ticks[i - 1].label)) / 2 + 6;
        assert.ok(px >= need, `${span}d ${w}px: ${ticks[i - 1].label}→${ticks[i].label} ${px}px`);
      }
      for (const t of ticks) {
        assert.ok(t.d >= td - span && t.d <= td);
        assert.ok(/^\d{1,2} [a-zé]{3}$/.test(t.label) || months.has(t.label) || /^\d{4}$/.test(t.label), t.label);
      }
    }
  }
  // periodos cortos: «23 sep» en lunes; largos: meses y el año en enero
  const w4 = timeTicks(td - 28, td, 300);
  assert.deepEqual(w4.map((t) => t.label), ['31 ago', '7 sep', '14 sep', '21 sep']);
  assert.ok(w4.every((t) => dayStr(t.d) === weekStart(dayStr(t.d))), 'marcas en lunes');
  assert.deepEqual(timeTicks(td - 92, td, 300).map((t) => t.label), ['jul', 'ago', 'sep']);
  const y1 = timeTicks(td - 365, td, 300).map((t) => t.label);
  assert.ok(y1.includes('2026') && y1.includes('sep') && y1.length >= 4, y1.join(' '));
  assert.ok(y1.every((l) => l !== 'ene'), 'enero se rotula con el año');
});

test('monthLabel y dateTitle', () => {
  assert.equal(monthLabel('2026-09-01'), 'sep');
  assert.equal(monthLabel('2027-01-01'), '2027');
  assert.equal(dateTitle('2026-09-23'), '23 sep 2026');
  assert.equal(dateTitle('2026-09-21', true), '21–27 sep 2026');
  assert.equal(dateTitle('2026-09-28', true), '28 sep – 4 oct 2026');
  assert.equal(dateTitle('2026-12-28', true), '28 dic – 3 ene 2027');
  assert.equal(dateTitle('Pecho'), 'Pecho');
});

test('isWeekly: lunes separados por semanas enteras', () => {
  assert.equal(isWeekly(['2026-09-07', '2026-09-14', '2026-09-21']), true);
  assert.equal(isWeekly(['2026-09-07', '2026-09-21']), true);
  assert.equal(isWeekly(['2026-09-21']), true);
  assert.equal(isWeekly(['2026-09-08', '2026-09-15']), false, 'martes');
  assert.equal(isWeekly(['2026-09-07', '2026-09-10']), false);
  assert.equal(isWeekly(['Pecho', 'Espalda']), false);
  assert.equal(isWeekly([]), false);
});

test('barAxisLabels: semanas cortas con día, largas con meses; texto aclarado', () => {
  const weeks = (n) => Array.from({ length: n }, (_, i) => addDays(weekStart(TODAY), -7 * (n - 1 - i)));
  // 5 semanas en 300 px: todas con «31 ago»…
  const w5 = barAxisLabels(weeks(5), 300);
  assert.equal(w5.length, 5);
  assert.deepEqual(w5.map((l) => l.label), ['24 ago', '31 ago', '7 sep', '14 sep', '21 sep']);
  // 14 semanas: meses en la primera semana de cada mes
  const w14 = barAxisLabels(weeks(14), 300);
  assert.deepEqual(w14.map((l) => l.label), ['jul', 'ago', 'sep']);
  const xs14 = weeks(14);
  for (const l of w14) assert.ok(+xs14[l.i].slice(8, 10) <= 7, 'primera semana del mes');
  // 53 semanas: ≤ 6 etiquetas, sin solaparse
  const xs53 = weeks(53);
  const w53 = barAxisLabels(xs53, 300);
  assert.ok(w53.length >= 3 && w53.length <= 6, w53.map((l) => l.label).join(' '));
  const slot = 300 / 53;
  for (let i = 1; i < w53.length; i++) {
    assert.ok((w53[i].i - w53[i - 1].i) * slot >= (estimateText(w53[i].label) + estimateText(w53[i - 1].label)) / 2 + 6);
  }
  // texto: se aclaran las que no caben
  const names = ['Espalda', 'Pecho', 'Hombro', 'Bíceps', 'Tríceps', 'Cuádriceps', 'Isquios', 'Glúteo', 'Core', 'Gemelo'];
  const tl = barAxisLabels(names, 300);
  assert.ok(tl.length < names.length && tl.length >= 2);
  assert.equal(tl.at(-1).i, names.length - 1, 'la última siempre rotulada');
  assert.deepEqual(barAxisLabels(['A', 'B', 'C'], 300).map((l) => l.label), ['A', 'B', 'C']);
  // formato propio
  assert.deepEqual(barAxisLabels(weeks(3), 300, { format: (x, i) => `S${i + 1}` }).map((l) => l.label), ['S1', 'S2', 'S3']);
  assert.deepEqual(barAxisLabels([], 300), []);
});

test('COLORS coincide con los tokens de css/app.css', () => {
  const css = fs.readFileSync(new URL('../../css/app.css', import.meta.url), 'utf8');
  const tok = (name) => (css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1]?.toLowerCase();
  const map = {
    strength: 'act-strength', run: 'act-run', bike: 'act-bike', swim: 'act-swim', other: 'act-other',
    accent: 'accent', info: 'info', warn: 'warn', danger: 'danger', ok: 'ok', muted: 'muted', text: 'text',
    grid: 'border', surface: 'surface', text2: 'text-2',
  };
  for (const [k, t] of Object.entries(map)) assert.equal(COLORS[k], tok(t), `${k} ↔ --${t}`);
  for (const v of Object.values(COLORS)) assert.match(v, /^#[0-9a-f]{6}$/);
});
