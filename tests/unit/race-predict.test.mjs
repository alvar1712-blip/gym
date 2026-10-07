// Pruebas de js/race-predict.js (tiempos previstos y «¿Puedo hacerlo?», docs/MEJORAS.md §4) con datos a mano.
// Hoy = jueves 24 sep 2026 (inyectado con data.today o { today }).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  predictRaces, checkTarget, analyzeRuns, predictDistance, volumeAdjust, volumeProfile, recencyWeight, distanceWeight,
  stepFor, raceFor, fmtGap, fmtGapPerKm, rangeText, paceRangeText, RACES, K, K_MAX, MIN_KM, MIN_MARGIN, WINDOW_DAYS,
  VOLUME_DAYS, RECENCY_DAYS, INSUFFICIENT, VERDICT_LABEL, MAX_PACE, MIN_PACE, MAX_SPREAD, STATUSES,
} from '../../js/race-predict.js';
import { fmtRaceTime, fmtPaceKm } from '../../js/util.js';
import { addDays, tsFromDate } from '../../js/util.js';

const TODAY = '2026-09-24';
let seq = 0;
/** Carrera terminada: km y segundos en movimiento. */
function run(date, km, sec, extra = {}) {
  return { id: `r${++seq}`, kind: 'run', status: 'done', date, distanceKm: km, movingSec: sec, durationMin: sec / 60, rpe: 6, startedAt: tsFromDate(date, 8), ...extra };
}
const ago = (n) => addDays(TODAY, -n);
const data = (sessions, today = TODAY) => ({ sessions, exercises: new Map(), settings: {}, bodyweight: [], today });
const approx = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const riegelT = (t, d1, d2, k = K) => t * (d2 / d1) ** k;

// ---------------------------------------------------------------------------
// Datos insuficientes
// ---------------------------------------------------------------------------

test('insuficiente: sin carreras, con 1 válida (más cortas, antiguas y senderismo no cuentan) → ok:false', () => {
  const empty = predictRaces(data([]));
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, INSUFFICIENT);
  assert.equal(empty.reason, 'datos insuficientes');
  assert.deepEqual(empty.predictions, {});
  assert.equal(empty.valid, 0);
  assert.ok(empty.why.rule.includes('al menos 2 carreras'));

  const r = predictRaces(data([
    run(ago(3), 10, 3000),
    run(ago(2), 2.5, 700), // más corta de 3 km
    run(ago(100), 10, 2900), // fuera de las 12 semanas
    run(ago(1), 12, 1200), // ritmo imposible (1:40 /km)
    { ...run(ago(4), 15, 5400), kind: 'hike' }, // senderismo
    { ...run(ago(5), 40, 4800), kind: 'bike' }, // bici
  ]));
  assert.equal(r.ok, false);
  assert.equal(r.valid, 1);
  assert.deepEqual(r.excluded, { old: 1, short: 1, implausible: 1, slow: 0 });
  assert.match(r.message, /Solo hay 1 carrera válida/);
  assert.match(r.message, /1 carrera de menos de 3 km/);
  assert.match(r.message, /1 carrera de hace más de 12 semanas/);
  assert.ok(r.why.data.some((d) => d.label === 'Carreras válidas' && d.value === '1 de 2 necesarias'));

  const c = checkTarget(data([run(ago(3), 10, 3000)]), 10, 2900);
  assert.equal(c.verdict, 'insuficiente');
  assert.equal(c.label, VERDICT_LABEL.insuficiente);
  assert.equal(c.prediction, null);
  assert.equal(c.gapSec, null);
  assert.ok(c.why.rule.length > 0);

  const bad = checkTarget(data([run(ago(3), 10, 3000), run(ago(5), 5, 1400)]), 0, 1500);
  assert.equal(bad.verdict, 'insuficiente');
  assert.equal(bad.reason, 'input');
});

// ---------------------------------------------------------------------------
// 5 km exacto y rango mínimo ±3 %
// ---------------------------------------------------------------------------

test('5k exacto: dos 5 km iguales → previsto = su tiempo, rango ±3 % redondeado hacia fuera a 5 s', () => {
  const T = 20 * 60; // 20:00
  const r = predictRaces(data([run(ago(2), 5, T), run(ago(20), 5, T)]));
  assert.equal(r.ok, true);
  const p = r.predictions['5k'];
  approx(p.midExact, T);
  assert.equal(p.mid, T);
  approx(p.spread, 0, 1e-12);
  assert.equal(p.margin, MIN_MARGIN);
  assert.equal(p.step, 5);
  assert.equal(p.low, 1160); // 1164 → hacia abajo a 5 s
  assert.equal(p.high, 1240); // 1236 → hacia arriba a 5 s
  assert.ok(p.low <= T * (1 - MIN_MARGIN) && p.high >= T * (1 + MIN_MARGIN));
  assert.equal(rangeText(p), '19:20–20:40');
  approx(p.pace, 240);
  // Solo 2 esfuerzos → confianza media (un nivel menos), con el motivo.
  assert.equal(p.confidence, 'media');
  assert.match(p.confidenceReasons[0], /solo 2 esfuerzos/);
  // 10 km con k = 1,06 desde los 5 km.
  approx(r.predictions['10k'].midExact, riegelT(T, 5, 10));
  assert.equal(r.predictions['10k'].k, K);
  // Cada predicción con su «¿Por qué?».
  for (const race of RACES) {
    const q = r.predictions[race.id];
    assert.ok(q.why.rule.includes('Riegel'));
    assert.ok(q.why.data.length > 0);
    for (const d of q.why.data) assert.ok(d.label && d.value, JSON.stringify(d));
    assert.ok(q.low < q.mid && q.mid < q.high);
    assert.ok(['alta', 'media', 'baja'].includes(q.confidence));
  }
});

test('rango mínimo ±3 %: con esfuerzos muy parecidos nunca es más estrecho; con dispersión grande se ensancha', () => {
  const tight = predictRaces(data([run(ago(1), 5, 1500), run(ago(8), 5, 1503), run(ago(15), 5, 1497)])).predictions['5k'];
  assert.ok(tight.spread < MIN_MARGIN);
  assert.equal(tight.margin, MIN_MARGIN);
  assert.ok(tight.low <= tight.midExact * 0.97 + 1e-9);
  assert.ok(tight.high >= tight.midExact * 1.03 - 1e-9);
  assert.equal(tight.confidence, 'alta');

  // Esfuerzos incoherentes (misma distancia, tiempos muy distintos): margen = dispersión > 8 % → confianza baja un nivel.
  const wide = predictRaces(data([run(ago(1), 5, 1200), run(ago(2), 5, 1500), run(ago(3), 5, 1250)])).predictions['5k'];
  assert.ok(wide.spread > 0.08, String(wide.spread));
  assert.equal(wide.margin, wide.spread);
  approx(wide.lowExact, wide.midExact * (1 - wide.spread));
  assert.equal(wide.confidence, 'media');
  assert.ok(wide.confidenceReasons.some((t) => t.includes('dispersión')));
});

// ---------------------------------------------------------------------------
// Base: carreras válidas, 3 mejores, pesos
// ---------------------------------------------------------------------------

test('base: solo carreras (kind run) de ≥ 3 km en 12 semanas; tiempo en movimiento (o duración); los 3 mejores', () => {
  const sessions = [
    run(ago(0), 5, 1500), // hoy cuenta
    run(ago(WINDOW_DAYS - 1), 10, 3000), // día 83: dentro
    run(ago(WINDOW_DAYS), 10, 2500), // día 84: fuera
    run(ago(10), 3, 1000), // 3 km justos cuenta
    run(ago(12), 8, 3000), // el peor esfuerzo: fuera de los 3 mejores
    { ...run(ago(6), 10, 2400), kind: 'hike' }, // senderismo rapidísimo: no cuenta
    { ...run(ago(7), 10, 2400), status: 'active' }, // sin terminar: no cuenta
    run(addDays(TODAY, 2), 10, 2400), // futura: no cuenta
    { id: 'old', kind: 'run', status: 'done', date: ago(9), distanceKm: 6, durationMin: 30 }, // sin movingSec → duración
  ];
  const ctx = analyzeRuns(data(sessions));
  assert.equal(ctx.valid.length, 5);
  assert.equal(ctx.excluded.old, 1);
  const legacy = ctx.valid.find((e) => e.sessionId === 'old');
  assert.equal(legacy.sec, 1800);
  // Ranking por rendimiento equivalente T / D^1,06 (menor = mejor).
  const scores = ctx.valid.map((e) => e.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
  assert.equal(ctx.basis.length, 3);
  assert.ok(!ctx.basis.some((e) => e.km === 8), 'el 8 km lento no entra');
  // El senderismo no suma km de carrera.
  const vol = sessions.filter((s) => s.kind === 'run' && s.status === 'done' && s.date <= TODAY && s.date >= ago(VOLUME_DAYS - 1));
  approx(ctx.volumeKm, vol.reduce((t, s) => t + s.distanceKm, 0));
  approx(ctx.weeklyKm, ctx.volumeKm / 6);
});

test('pesos: recencia (1 − días / 168) × parecido de distancia (√(menor / mayor)); previsto = media ponderada', () => {
  assert.equal(recencyWeight(0), 1);
  approx(recencyWeight(84), 0.5);
  assert.equal(RECENCY_DAYS, 168);
  approx(distanceWeight(5, 10), Math.sqrt(0.5));
  approx(distanceWeight(10, 5), Math.sqrt(0.5));
  assert.equal(distanceWeight(0, 5), 0);

  const a = run(ago(0), 5, 1500);
  const b = run(ago(42), 10, 3150);
  const p = predictRaces(data([a, b])).predictions['10k'];
  const wa = 1 * Math.sqrt(5 / 10);
  const wb = (1 - 42 / 168) * 1;
  const ta = riegelT(1500, 5, 10);
  const tb = 3150;
  approx(p.midExact, (wa * ta + wb * tb) / (wa + wb));
  const sd = Math.sqrt((wa * (ta - p.midExact) ** 2 + wb * (tb - p.midExact) ** 2) / (wa + wb)) / p.midExact;
  approx(p.spread, sd);
  approx(p.efforts[0].share + p.efforts[1].share, 1);
});

// ---------------------------------------------------------------------------
// Media y maratón: volumen, k y confianza
// ---------------------------------------------------------------------------

test('maratón con poco volumen: k mayor (≤ 1,10), confianza baja y explicado en «¿Por qué?»', () => {
  // ~12 km/sem, tirada de 10 km (6 semanas).
  const sessions = [run(ago(1), 10, 2900), run(ago(8), 5, 1380), run(ago(15), 8, 2350), run(ago(22), 6, 1750), run(ago(29), 10, 2950), run(ago(36), 8, 2380), run(ago(40), 5, 1400)];
  const r = predictRaces(data(sessions));
  assert.equal(r.ok, true);
  assert.equal(r.longestRecentKm, 10);
  approx(r.weeklyKm, 52 / 6);
  const m = r.predictions.marathon;
  const v = volumeAdjust('marathon', r.weeklyKm, 10);
  assert.ok(m.k > K && m.k <= K_MAX, String(m.k));
  approx(m.k, v.k);
  approx(m.k, K + (K_MAX - K) * Math.max(1 - r.weeklyKm / 40, 1 - 10 / 24));
  assert.equal(m.adjusted, true);
  assert.equal(m.confidence, 'baja');
  assert.ok(m.confidenceReasons.some((t) => t.includes('km/sem')));
  assert.ok(m.confidenceReasons.some((t) => t.includes('tirada')));
  assert.match(m.why.rule, /k sube de 1,06 hacia 1,10/);
  assert.match(m.why.rule, /km semanales les falta/);
  assert.ok(m.why.data.some((d) => d.label === 'k usado' && d.value === m.k.toLocaleString('es-ES', { maximumFractionDigits: 3, minimumFractionDigits: 2 })));
  // Más lento que con k = 1,06 (la predicción se vuelve prudente).
  const plain = m.efforts.reduce((t, e) => t + e.weight * riegelT(e.sec, e.km, 42.195), 0) / m.efforts.reduce((t, e) => t + e.weight, 0);
  assert.ok(m.midExact > plain);
  // 5 km y 10 km no dependen del volumen.
  assert.equal(r.predictions['5k'].k, K);
  assert.equal(r.predictions['10k'].volume, null);
  // Media: también ajustada (umbral 25 km/sem y 14 km).
  const half = r.predictions.half;
  approx(half.k, volumeAdjust('half', r.weeklyKm, 10).k);
  assert.ok(half.k > K && half.k < m.k);
});

test('maratón con volumen suficiente: k = 1,06 y la confianza no baja por volumen; sin volumen reciente → k = 1,10', () => {
  const sessions = [];
  for (let w = 0; w < 6; w++) {
    sessions.push(run(ago(w * 7 + 1), 10, 2700), run(ago(w * 7 + 3), 12, 3400), run(ago(w * 7 + 5), 25, 7800));
  }
  const r = predictRaces(data(sessions));
  assert.ok(r.weeklyKm >= 40);
  assert.equal(r.longestRecentKm, 25);
  const m = r.predictions.marathon;
  assert.equal(m.k, K);
  assert.equal(m.adjusted, false);
  assert.ok(!m.confidenceReasons.some((t) => t.includes('km/sem') || t.includes('tirada')));
  assert.notEqual(m.confidence, 'baja');
  assert.match(m.why.rule, /se cumplen los dos/);

  // Carreras válidas de hace 7–12 semanas y nada en las últimas 6 → 0 km/sem, sin tirada → k máximo.
  const idle = predictRaces(data([run(ago(50), 10, 2800), run(ago(60), 5, 1350)]));
  assert.equal(idle.weeklyKm, 0);
  assert.equal(idle.longestRecentKm, 0);
  approx(idle.predictions.marathon.k, K_MAX);
  approx(idle.predictions.half.k, K_MAX);
});

test('volumeAdjust / volumeProfile / stepFor / raceFor', () => {
  approx(volumeAdjust('half', 25, 14).k, K);
  approx(volumeAdjust('half', 12.5, 14).k, K + (K_MAX - K) * 0.5);
  approx(volumeAdjust('marathon', 40, 12).k, K + (K_MAX - K) * 0.5);
  assert.equal(volumeAdjust('marathon', 0, 0).k, K_MAX);
  assert.equal(volumeAdjust(null, 10, 10), null);
  assert.equal(volumeProfile(10), null);
  assert.equal(volumeProfile(15), 'half');
  assert.equal(volumeProfile(30), 'marathon');
  assert.equal(stepFor(5), 5);
  assert.equal(stepFor(21.0975), 10);
  assert.equal(stepFor(42.195), 30);
  assert.equal(raceFor(21.0975).id, 'half');
  assert.equal(raceFor(12), null);
  assert.equal(MIN_KM, 3);
});

// ---------------------------------------------------------------------------
// ¿Puedo hacerlo?
// ---------------------------------------------------------------------------

test('checkTarget: probable (≥ high), ajustado (dentro del rango), hoy no (< low) con cuánto falta', () => {
  const d = data([run(ago(2), 5, 1500), run(ago(9), 10, 3120), run(ago(16), 5, 1530)]);
  const p = predictRaces(d).predictions['5k'];

  const pr = checkTarget(d, 5, p.high);
  assert.equal(pr.verdict, 'probable');
  assert.equal(pr.label, 'Probable');
  assert.equal(pr.gapSec, p.mid - p.high);
  assert.ok(pr.gapSec < 0);
  assert.equal(pr.rangeGapSec, 0);
  assert.equal(checkTarget(d, 5, p.high + 60).verdict, 'probable');
  assert.match(pr.text, /a tu alcance/);

  const aj = checkTarget(d, 5, p.low);
  assert.equal(aj.verdict, 'ajustado');
  assert.equal(aj.gapSec, p.mid - p.low);
  assert.match(aj.text, /posible, pero justo/);
  assert.equal(checkTarget(d, 5, p.high - 1).verdict, 'ajustado');
  const same = checkTarget(d, 5, p.mid);
  assert.equal(same.verdict, 'ajustado');
  assert.equal(same.gapSec, 0);
  assert.match(same.text, /sin margen/);

  const no = checkTarget(d, 5, p.low - 30);
  assert.equal(no.verdict, 'hoy_no');
  assert.equal(no.label, 'Hoy no');
  assert.equal(no.gapSec, p.mid - (p.low - 30));
  assert.ok(no.gapSec > 0);
  assert.equal(no.rangeGapSec, 30);
  approx(no.gapPerKmSec, no.gapSec / 5);
  assert.match(no.text, /hoy te faltarían unos/);
  assert.match(no.text, new RegExp(fmtGap(no.gapSec)));
  // Misma predicción que la tabla.
  assert.equal(no.prediction.low, p.low);
  assert.equal(no.prediction.high, p.high);
  // «¿Por qué?» con la regla del veredicto y los datos.
  assert.match(no.why.rule, /hoy no/);
  assert.ok(no.why.data.some((x) => x.label === 'Diferencia' && x.value.startsWith('faltan')));
  assert.ok(no.why.data.some((x) => x.label === 'Rango previsto'));
});

test('checkTarget con otra distancia: 15 km usa el perfil de la media; 50 km → confianza baja', () => {
  const d = data([run(ago(2), 10, 2900), run(ago(9), 5, 1400), run(ago(16), 8, 2400)]);
  const c15 = checkTarget(d, 15, 90 * 60);
  assert.equal(c15.prediction.id, 'custom');
  assert.equal(c15.prediction.profile, 'half');
  assert.equal(c15.distanceLabel, '15 km');
  assert.equal(c15.prediction.step, 10);
  const c50 = checkTarget(d, 50, 5 * 3600);
  assert.equal(c50.prediction.confidence, 'baja');
  assert.match(c50.text, /confianza de esta estimación es baja/);
  // Distancia estándar escrita a mano → la misma que la tabla.
  const half = checkTarget(d, 21.0975, 2 * 3600);
  assert.equal(half.prediction.id, 'half');
  assert.equal(half.distanceLabel, 'Media maratón');
});

// ---------------------------------------------------------------------------
// «Hoy» inyectable y formato
// ---------------------------------------------------------------------------

test('hoy inyectable: data.today y { today } (manda sobre data.today)', () => {
  const sessions = [run('2026-09-10', 10, 3000), run('2026-09-01', 5, 1450)];
  assert.equal(predictRaces(data(sessions, '2026-09-24')).ok, true);
  // Tres meses después, fuera de la ventana de 12 semanas.
  const later = predictRaces(data(sessions, '2026-12-24'));
  assert.equal(later.ok, false);
  assert.equal(later.excluded.old, 2);
  assert.equal(predictRaces(data(sessions, '2026-09-24'), { today: '2026-12-24' }).ok, false);
  // Antes de la segunda carrera: solo cuenta la primera (las futuras no).
  assert.equal(predictRaces(data(sessions), { today: '2026-09-05' }).ok, false);
  // La recencia depende de «hoy».
  const a = predictRaces(data(sessions), { today: '2026-09-12' }).predictions['5k'].efforts;
  const b = predictRaces(data(sessions), { today: '2026-10-20' }).predictions['5k'].efforts;
  assert.ok(a[0].wRecency > b[0].wRecency);
  assert.equal(checkTarget(data(sessions), 5, 1400, { today: '2026-12-24' }).verdict, 'insuficiente');
});

test('formato de diferencias', () => {
  assert.equal(fmtGap(7.4), '7 s');
  assert.equal(fmtGap(-45), '45 s');
  assert.equal(fmtGap(82), '1 min 20 s');
  assert.equal(fmtGap(3752), '1 h 02 min 30 s');
  assert.equal(fmtGapPerKm(0.2), 'menos de 1 s/km');
  assert.equal(fmtGapPerKm(-8.4), '8 s/km');
  assert.equal(fmtGapPerKm(65), '1:05/km');
});

test('predictDistance por debajo de 1,5 km → confianza baja', () => {
  const ctx = analyzeRuns(data([run(ago(2), 5, 1500), run(ago(9), 10, 3120), run(ago(16), 5, 1530)]));
  const p = predictDistance(ctx, 1);
  assert.equal(p.confidence, 'baja');
  assert.ok(p.mid > 0);
});

// ---------------------------------------------------------------------------
// Corrección de tiempos previstos (docs/MEJORAS6.md): lo que se vio en un iPhone real
// ---------------------------------------------------------------------------

/** Forma de lo que enseña la pantalla: «29:37» / «1:42:16», rango ordenado y ritmo «m:ss/km». */
const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;
const RANGE = /^\d{1,2}:\d{2}(:\d{2})?–\d{1,2}:\d{2}(:\d{2})?$/;
const PACE_RANGE = /^\d{1,2}:\d{2}–\d{1,2}:\d{2}\/km$/;
/** Invariantes de una predicción usable: números finitos > 0, low ≤ mid ≤ high y textos bien formados. */
function assertSane(p, tag) {
  assert.ok(STATUSES.includes(p.status), `${tag}: estado ${p.status}`);
  for (const k of ['low', 'mid', 'high', 'lowExact', 'midExact', 'highExact', 'pace', 'paceLow', 'paceHigh']) {
    assert.ok(Number.isFinite(p[k]) && p[k] > 0, `${tag}: ${k} = ${p[k]}`);
  }
  assert.ok(p.low <= p.mid && p.mid <= p.high, `${tag}: ${p.low} ≤ ${p.mid} ≤ ${p.high}`);
  assert.ok(p.margin >= MIN_MARGIN && p.margin <= MAX_SPREAD + 1e-12, `${tag}: margen ${p.margin}`);
  if (!p.usable) return;
  assert.match(fmtRaceTime(p.mid), TIME, tag);
  assert.match(rangeText(p), RANGE, tag);
  assert.match(paceRangeText(p), PACE_RANGE, tag);
  assert.match(fmtPaceKm(p.pace), /^\d{1,2}:\d{2}\/km$/, tag);
  for (const d of p.why.data) assert.ok(!/[-−]\d|:-|NaN|Infinity|\d+:\d{2}:\d{2}\/km/.test(d.value), `${tag}: ${d.label} = ${d.value}`);
}

// Dos carreras de 5 km: una de 28:55 hace 4 días y otra de «31:00» guardada como 31 h 00 min hace 30 días (los minutos
// escritos en la casilla de las horas). Con el código anterior daba EXACTAMENTE lo visto en el iPhone:
//   5 km   low −2795 s, mid 51 940 s, high 106 670 s → «-47:-35–29:37:50», «-10:-19–5:55:34 /km», «previsto ≈ 14:25:40»
//   10 km  high 222 395 s → «…–61:46:35»
const IPHONE = [run(ago(4), 5, 1735), run(ago(30), 5, 31 * 3600)];

test('regresión iPhone: un tiempo de 31 h en 5 km ya no envenena las predicciones (ni rango negativo ni h:mm:ss/km)', () => {
  const r = predictRaces(data(IPHONE));
  // La carrera de 31 h (6:12:00 /km) no es un esfuerzo de carrera: no cuenta y queda señalada para revisarla.
  assert.equal(r.excluded.slow, 1);
  assert.equal(r.suspect.length, 1);
  assert.deepEqual({ km: r.suspect[0].km, sec: r.suspect[0].sec, why: r.suspect[0].why }, { km: 5, sec: 111600, why: 'slow' });
  assert.equal(r.suspect[0].sessionId, IPHONE[1].id);
  // Queda 1 sola válida → datos insuficientes, diciendo por qué la otra no cuenta (nunca cifras absurdas).
  assert.equal(r.ok, false);
  assert.match(r.message, /1 carrera con un ritmo más lento de 20:00\/km/);
  assert.deepEqual(r.predictions, {});

  // Con una carrera normal más, las 4 distancias salen bien formadas.
  const r2 = predictRaces(data([...IPHONE, run(ago(12), 4, 24 * 60 + 30)]));
  assert.equal(r2.ok, true);
  assert.equal(r2.excluded.slow, 1);
  for (const race of RACES) assertSane(r2.predictions[race.id], race.id);
  const p5 = r2.predictions['5k'];
  assert.equal(p5.status, 'ok');
  assert.equal(rangeText(p5), '28:50–31:00');
  assert.equal(fmtRaceTime(p5.mid), '29:55');
  assert.equal(paceRangeText(p5), '5:46–6:12/km');
  assert.equal(fmtPaceKm(p5.pace), '5:59/km');
  // checkTarget con esos datos tampoco compara contra números absurdos
  const c = checkTarget(data([...IPHONE, run(ago(12), 4, 24 * 60 + 30)]), 10, 50 * 60);
  assert.ok(['probable', 'ajustado', 'hoy_no'].includes(c.verdict));
  assert.ok(!/[-−]\d|:-/.test(c.text), c.text);
});

test('ritmo creíble: de 2:30 a 20:00 /km (los extremos cuentan); más lento, a revisar', () => {
  const ctx = analyzeRuns(data([run(ago(1), 5, 5 * MAX_PACE), run(ago(2), 5, 5 * MAX_PACE + 5), run(ago(3), 5, 5 * MIN_PACE), run(ago(4), 5, 5 * MIN_PACE - 5)]));
  assert.deepEqual(ctx.valid.map((e) => e.sec).sort((a, b) => a - b), [5 * MIN_PACE, 5 * MAX_PACE]);
  assert.deepEqual(ctx.excluded, { old: 0, short: 0, implausible: 1, slow: 1 });
  assert.deepEqual(ctx.suspect.map((x) => x.why), ['slow', 'fast'], 'de más reciente a más antigua');
  assert.match(ctx.suspect[0].label, /^5 km en 1:40:05$/);
});

test('rango: con ritmos creíbles pero contradictorios (dispersión > 100 %) nunca sale negativo; la predicción no es útil', () => {
  // 5 km a 2:31 /km hoy y un maratón a 19:59 /km hace 80 días: para 5 km la dispersión es de ±112 %.
  // Con el código anterior: low = previsto × (1 − 1,12) < 0.
  const d = data([run(ago(0), 5, 5 * 151), run(ago(80), 42.2, Math.round(42.2 * 1199))]);
  const r = predictRaces(d);
  assert.equal(r.ok, true);
  const p = r.predictions['5k'];
  assert.ok(p.spread > 1, String(p.spread));
  assert.equal(p.margin, MAX_SPREAD, 'el margen se acota');
  assert.equal(p.status, 'incoherent');
  assert.equal(p.usable, false);
  assert.equal(p.confidence, 'baja');
  assert.ok(p.confidenceCodes.includes('incoherent'));
  assert.match(p.advice.note, /no coinciden entre sí/);
  assertSane(p, '5k incoherente');
  for (const race of RACES) assertSane(r.predictions[race.id], race.id);
  // ¿Puedo hacerlo? no compara con una predicción que no es útil
  const c = checkTarget(d, 5, 20 * 60);
  assert.equal(c.verdict, 'insuficiente');
  assert.equal(c.reason, 'incoherent');
  assert.equal(c.prediction, null);
  assert.equal(c.gapSec, null);
  assert.match(c.text, /No hay una previsión útil para los 5 km/);
});

test('propiedad: con cualquier mezcla de carreras (también absurdas) los números y textos son siempre válidos', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let i = 0; i < 300; i++) {
    const n = 2 + Math.floor(rnd() * 6);
    const sessions = [];
    for (let j = 0; j < n; j++) {
      const km = pick([3, 3.5, 4, 5, 6, 8, 10, 12, 15, 21.1, 30, 42.2]) * (0.9 + rnd() * 0.2);
      // ritmos de 2:00 a 30:00 /km y, a veces, el error de horas por minutos (× 60) o de segundos por minutos (÷ 60)
      let sec = km * (120 + rnd() * 1680);
      const r = rnd();
      if (r < 0.1) sec *= 60; else if (r < 0.15) sec /= 60;
      sessions.push(run(ago(Math.floor(rnd() * 120)), Math.round(km * 100) / 100, Math.round(sec)));
    }
    const d = data(sessions);
    const res = predictRaces(d);
    if (!res.ok) { assert.deepEqual(res.predictions, {}); continue; }
    for (const race of RACES) assertSane(res.predictions[race.id], `#${i} ${race.id}`);
    const km = pick([1, 5, 10, 15, 21.0975, 42.195, 60]);
    const c = checkTarget(d, km, 3600);
    assert.ok(['probable', 'ajustado', 'hoy_no', 'insuficiente'].includes(c.verdict));
    if (c.prediction) assertSane(c.prediction, `#${i} checkTarget ${km}`);
    assert.ok(!/[-−]\d|:-|NaN|Infinity/.test(c.text), c.text);
  }
});

test('estado «todavía poco fiable»: media y maratón con mucho menos volumen del de referencia (la fórmula sí lo calcula)', () => {
  // Poco volumen: dos carreras de 5 km y una de 4 km en 6 semanas (≈ 2,3 km/sem, tirada de 5 km).
  const d = data([run(ago(3), 5, 1780), run(ago(10), 4, 1460), run(ago(24), 5, 1800)]);
  const r = predictRaces(d);
  const { '5k': p5, half, marathon } = r.predictions;
  assert.equal(p5.status, 'ok');
  for (const p of [half, marathon]) {
    assert.equal(p.status, 'tentative');
    assert.equal(p.usable, true, 'los números existen y son válidos');
    assert.equal(p.confidence, 'baja');
    assert.ok(p.confidenceCodes.includes('tentative'));
    assert.match(p.advice.note, new RegExp(`demasiado bajo para estimar ${p.noun}`));
    assert.match(p.advice.improve, /^Acercarte a \d+ km por semana y a una tirada de \d+ km \(ahora [\d,]+ km\/sem y una tirada de [\d,]+ km\)\.$/);
    assertSane(p, p.id);
  }
  // Con algo más de la mitad del volumen de referencia ya no es «poco fiable» (sí más prudente y con menos confianza).
  const mid = data([run(ago(2), 10, 3000), run(ago(6), 8, 2400), run(ago(9), 15, 4700), run(ago(16), 12, 3700), run(ago(23), 10, 3050), run(ago(30), 14, 4400), run(ago(37), 9, 2750)]);
  const h2 = predictRaces(mid).predictions.half;
  assert.ok(h2.volume.short > 0 && h2.volume.short < 0.5, String(h2.volume.short));
  assert.equal(h2.status, 'ok');
  assert.equal(h2.adjusted, true);
  assert.match(h2.advice.note, /Más prudente por volumen/);
  // ¿Puedo hacerlo? con una media «poco fiable»: sí da un veredicto, avisando de que es orientativo
  const c = checkTarget(d, 21.0975, 2 * 3600);
  assert.ok(['probable', 'ajustado', 'hoy_no'].includes(c.verdict));
  assert.match(c.text, /confianza de esta estimación es baja\. Tu volumen actual todavía es demasiado bajo/);
});

test('estimación central = media ponderada de las predicciones de Riegel; «¿Por qué?» dice qué carreras pesan y qué la mejoraría', () => {
  const d = data([run(ago(2), 5, 1500), run(ago(20), 10, 3150)]);
  const p = predictRaces(d).predictions['10k'];
  const w = p.efforts.map((e) => e.weight);
  approx(p.midExact, (w[0] * riegelT(1500, 5, 10) + w[1] * riegelT(3150, 10, 10)) / (w[0] + w[1]));
  assert.equal(p.mid, Math.round(p.midExact / 5) * 5);
  assert.equal(p.efforts.filter((e) => e.top).length, 1, 'una sola «la que más»');
  const top = p.efforts.find((e) => e.top);
  assert.ok(p.efforts.every((e) => e.share <= top.share));
  const rows = Object.fromEntries(p.why.data.map((x) => [x.label, x.value]));
  assert.ok(p.why.data.some((x) => /\(la que más\)$/.test(x.value)));
  assert.equal(rows['Estimación actual (media ponderada)'], `${fmtRaceTime(p.mid)} · ${fmtPaceKm(p.pace)}`);
  assert.equal(rows['Rango probable'], `${rangeText(p)} (${paceRangeText(p)})`);
  assert.match(rows['Para mejorarla'], /^Registra otra carrera de 3 km o más, con su tiempo en movimiento \(lo ideal son 3\)\.$/);
  assert.match(p.why.rule, /Estimación actual \(el número grande\): la media ponderada/);
  assert.match(p.why.rule, /más lento de 20:00\/km/);
  // Solo 2 carreras: confianza media y el aviso lo explica sin parecer un error
  assert.equal(p.confidence, 'media');
  assert.match(p.advice.note, /^Solo tienes 2 carreras válidas recientes, así que este rango es orientativo\./);
  // Con confianza alta, sin aviso
  const hi = predictRaces(data([run(ago(1), 10, 3000), run(ago(8), 10, 3010), run(ago(15), 8, 2380)])).predictions['10k'];
  assert.equal(hi.confidence, 'alta');
  assert.deepEqual(hi.advice, { note: null, improve: null });
});
