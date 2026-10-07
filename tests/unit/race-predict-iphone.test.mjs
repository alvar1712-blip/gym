// Regresión de lo visto en un iPhone real en Progreso › Tiempos previstos (docs/MEJORAS6.md, corrección de tiempos
// previstos): «-47:-35–29:37:50», «-10:-19–5:55:34 /km», «previsto ≈ 14:25:40», «…–61:46:35» en 10 km.
// Solo usa la API que ya existía antes del arreglo (predictRaces, checkTarget, rangeText, paceRangeText, fmtDuration):
// con el código anterior estas pruebas FALLAN con exactamente esos textos; con el arreglo pasan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { predictRaces, checkTarget, rangeText, paceRangeText, RACES } from '../../js/race-predict.js';
import { addDays, tsFromDate, fmtDuration } from '../../js/util.js';

const TODAY = '2026-10-07';
let seq = 0;
function run(ago, km, sec) {
  const date = addDays(TODAY, -ago);
  return { id: `ip${++seq}`, kind: 'run', status: 'done', date, distanceKm: km, movingSec: sec, durationMin: sec / 60, rpe: 6, startedAt: tsFromDate(date, 8) };
}
const data = (sessions) => ({ sessions, exercises: new Map(), settings: {}, bodyweight: [], today: TODAY });

const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;
const RANGE = /^\d{1,2}:\d{2}(:\d{2})?–\d{1,2}:\d{2}(:\d{2})?$/;
const PACE_RANGE = /^\d{1,2}:\d{2}–\d{1,2}:\d{2} ?\/km$/;

/** Lo que pinta cada tarjeta: estimación, rango y ritmo, siempre bien formados y con low ≤ mid ≤ high > 0. */
function assertScreen(r, tag) {
  if (!r.ok) return;
  for (const race of RACES) {
    const p = r.predictions[race.id];
    if (p.usable === false) continue; // sin cifras en pantalla
    const shown = { estimación: fmtDuration(p.mid), rango: rangeText(p), ritmo: paceRangeText(p) };
    assert.ok(p.low > 0 && p.low <= p.mid && p.mid <= p.high, `${tag} ${race.id}: ${JSON.stringify(shown)}`);
    assert.match(shown.estimación, TIME, `${tag} ${race.id}`);
    assert.match(shown.rango, RANGE, `${tag} ${race.id}`);
    assert.match(shown.ritmo, PACE_RANGE, `${tag} ${race.id}`);
    // Ni el 5 km en más de 1 h por encima de lo razonable ni tiempos de 61 h en 10 km: el ritmo es de carrera.
    assert.ok(p.mid / p.km < 3600, `${tag} ${race.id}: ritmo ${p.mid / p.km} s/km`);
  }
}

// 5 km en 28:55 hace 4 días y otra de 5 km con «31:00» escrito en la casilla de las horas (31 h) hace 30 días.
const IPHONE = [run(4, 5, 1735), run(30, 5, 31 * 3600)];

test('iPhone: con el tiempo de 31 h, ninguna tarjeta enseña «-47:-35–29:37:50», «5:55:34 /km» ni «14:25:40»', () => {
  assertScreen(predictRaces(data(IPHONE)), 'dos carreras');
  assertScreen(predictRaces(data([...IPHONE, run(12, 4, 24 * 60 + 30)])), 'tres carreras');
});

test('iPhone: «¿Puedo hacerlo?» con esos datos no habla de tiempos negativos ni de 61 h', () => {
  for (const km of [5, 10, 21.0975]) {
    const c = checkTarget(data([...IPHONE, run(12, 4, 24 * 60 + 30)]), km, 3600);
    assert.ok(!/-\d|:-|\d{2,}:\d{2}:\d{2}/.test(c.text), c.text);
  }
});

test('ritmos creíbles pero contradictorios (dispersión > 100 %): el rango nunca es negativo', () => {
  // 5 km a 2:31 /km hoy y un maratón a 19:59 /km hace 80 días (5 km: dispersión ±112 %).
  assertScreen(predictRaces(data([run(0, 5, 5 * 151), run(80, 42.2, Math.round(42.2 * 1199))])), 'contradictorias');
});
