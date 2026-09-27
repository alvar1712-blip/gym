// Pruebas de js/race-predict.js (tiempos previstos y «¿Puedo hacerlo?», docs/MEJORAS.md §4) con datos a mano.
// Hoy = jueves 24 sep 2026 (inyectado con data.today o { today }).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  predictRaces, checkTarget, analyzeRuns, predictDistance, volumeAdjust, volumeProfile, recencyWeight, distanceWeight,
  stepFor, raceFor, fmtGap, fmtGapPerKm, rangeText, RACES, K, K_MAX, MIN_KM, MIN_MARGIN, WINDOW_DAYS, VOLUME_DAYS,
  RECENCY_DAYS, INSUFFICIENT, VERDICT_LABEL,
} from '../../js/race-predict.js';
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
  assert.deepEqual(r.excluded, { old: 1, short: 1, implausible: 1 });
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
  assert.equal(fmtGapPerKm(65), '1:05 /km');
});

test('predictDistance por debajo de 1,5 km → confianza baja', () => {
  const ctx = analyzeRuns(data([run(ago(2), 5, 1500), run(ago(9), 10, 3120), run(ago(16), 5, 1530)]));
  const p = predictDistance(ctx, 1);
  assert.equal(p.confidence, 'baja');
  assert.ok(p.mid > 0);
});
