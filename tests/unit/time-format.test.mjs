// Formateadores estrictos de tiempos de carrera y ritmos (js/util.js): fmtRaceTime, fmtPaceKm, fmtRaceRange,
// fmtPaceRange, y el signo de fmtDuration. Regresión del fallo visto en un iPhone en Progreso › Tiempos previstos:
// «-47:-35–29:37:50», «-10:-19–5:55:34 /km», «previsto ≈ 14:25:40» (docs/MEJORAS6.md, corrección de tiempos previstos).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtRaceTime, fmtPaceKm, fmtRaceRange, fmtPaceRange, fmtDuration, PACE_FMT_MAX } from '../../js/util.js';

const INVALID = [null, undefined, NaN, Infinity, -Infinity, -1, -2795, 0, 0.4, '300', '29:37', {}, [], true];

test('tiempo de carrera: m:ss por debajo de 1 h y h:mm:ss desde 1 h, sin 0 delante de las horas', () => {
  assert.equal(fmtRaceTime(5 * 60 + 3), '5:03');
  assert.equal(fmtRaceTime(29 * 60 + 37), '29:37');
  assert.equal(fmtRaceTime(59 * 60 + 59), '59:59');
  assert.equal(fmtRaceTime(3600), '1:00:00');
  assert.equal(fmtRaceTime(3600 + 45 * 60 + 8), '1:45:08');
  assert.equal(fmtRaceTime(2 * 3600 + 5), '2:00:05');
  assert.equal(fmtRaceTime(1), '0:01');
  // Se redondea al segundo antes de partir: 59:59,6 es 1:00:00 (nunca «59:60» ni «60:00»)
  assert.equal(fmtRaceTime(3599.6), '1:00:00');
  assert.equal(fmtRaceTime(29 * 60 + 37.4), '29:37');
  assert.equal(fmtRaceTime(119.5), '2:00');
});

test('tiempo de carrera: null con null, undefined, NaN, ±Infinity, negativos, 0 o lo que no es un número', () => {
  for (const v of INVALID) assert.equal(fmtRaceTime(v), null, `fmtRaceTime(${String(v)})`);
});

test('ritmo: «m:ss/km», redondeado al segundo; nunca «h:mm:ss/km»', () => {
  assert.equal(fmtPaceKm(355), '5:55/km');
  assert.equal(fmtPaceKm(355.4), '5:55/km');
  assert.equal(fmtPaceKm(359.6), '6:00/km'); // nunca «5:60/km»
  assert.equal(fmtPaceKm(240), '4:00/km');
  assert.equal(fmtPaceKm(65), '1:05/km');
  assert.equal(fmtPaceKm(1200), '20:00/km');
  assert.equal(fmtPaceKm(PACE_FMT_MAX - 1), '59:59/km');
  // 1 h/km o más no es un ritmo de carrera: el «5:55:34 /km» del iPhone era 21 334 s/km
  assert.equal(fmtPaceKm(PACE_FMT_MAX), null);
  assert.equal(fmtPaceKm(21334), null);
  for (const v of INVALID) assert.equal(fmtPaceKm(v), null, `fmtPaceKm(${String(v)})`);
});

test('rango de tiempos: de la mejor estimación a la más prudente, nunca al revés; null si algún extremo no vale', () => {
  assert.equal(fmtRaceRange(1778, 2050), '29:38–34:10');
  assert.equal(fmtRaceRange(2050, 1778), '29:38–34:10', 'al revés se ordena');
  assert.equal(fmtRaceRange(3570, 3730), '59:30–1:02:10');
  assert.equal(fmtRaceRange(1800, 1800.2), '30:00', 'iguales al redondear: un solo tiempo');
  // El rango del iPhone: low = −2795 s, high = 106 670 s → no se pinta
  assert.equal(fmtRaceRange(-2795, 106670), null);
  for (const v of INVALID) {
    assert.equal(fmtRaceRange(v, 1800), null);
    assert.equal(fmtRaceRange(1800, v), null);
  }
});

test('rango de ritmos: «5:55–6:20/km», ordenado; null si algún extremo no vale o llega a 1 h/km', () => {
  assert.equal(fmtPaceRange(355, 380), '5:55–6:20/km');
  assert.equal(fmtPaceRange(380, 355), '5:55–6:20/km');
  assert.equal(fmtPaceRange(355, 355.3), '5:55/km');
  assert.equal(fmtPaceRange(-559, 21334), null, 'el ritmo del iPhone: «-10:-19–5:55:34 /km»');
  assert.equal(fmtPaceRange(355, PACE_FMT_MAX), null);
  for (const v of INVALID) assert.equal(fmtPaceRange(v, 355), null);
});

test('los formatos estrictos nunca dan signos, dobles «:» ni partes negativas (barrido)', () => {
  const shape = /^\d{1,3}:\d{2}(:\d{2})?$/;
  for (let s = 1; s < 40 * 3600; s += 997) {
    const t = fmtRaceTime(s + 0.37);
    assert.match(t, shape, String(s));
    assert.ok(!/[-−]|::|:\d:|:\d$/.test(t), t);
  }
  for (let s = 1; s < PACE_FMT_MAX; s += 7) assert.match(fmtPaceKm(s + 0.49), /^\d{1,2}:\d{2}\/km$/);
});

test('fmtDuration con negativos: un solo signo delante (antes «-47:-35»)', () => {
  assert.equal(fmtDuration(-2795), '−46:35');
  assert.equal(fmtDuration(-3930), '−1:05:30');
  assert.ok(!/:-|:−/.test(fmtDuration(-2795)));
  assert.equal(fmtDuration(3930), '1:05:30');
  assert.equal(fmtDuration(NaN), '—');
});
