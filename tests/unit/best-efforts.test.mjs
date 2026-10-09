// Pruebas de los parciales y mejores esfuerzos de las carreras importadas (js/best-efforts.js) y de su paso por la
// importación (serie, vueltas, track compacto). Datos sintéticos: perfiles por tramos muestreados sobre la curva
// verdadera (la respuesta analítica se conoce) y archivos FIT/TCX/GPX generados con tests/fixtures/import/builders.mjs.
// Ejecutar: node --test tests/unit/best-efforts.test.mjs
process.env.TZ = 'Europe/Madrid';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEST_EFFORTS_VERSION, EFFORT_DISTANCES, TRACK_EPS_M, buildSeries, seriesProblem, simplifyIdx, encodeTrack, decodeTrack,
  fastestWindow, bestEffortsFromSeries, bestEffortsFromLaps, lapsForRecord, computeBestEfforts, effortsOf, splitsOf,
  recomputeCount, isApprox,
} from '../../js/best-efforts.js';
import { readActivityFile, pointMetrics } from '../../js/import-parse.js';
import { itemFromEntry, itemRecord, setItemField, setItemKind } from '../../js/import-logic.js';
import { RECORD_DISTANCES } from '../../js/stats.js';
import { buildFitActivity, gpxFromPoints, tcxFromPoints, makeTrack, noise } from '../fixtures/import/builders.mjs';

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} ≉ ${expected} (±${tol})`);
const T0 = Date.UTC(2026, 8, 6, 6, 0, 0);
const TODAY = '2026-09-26';

/**
 * Perfil por tramos → muestras sobre la curva verdadera.
 * parts: [{ km, pace (s/km) } | { stop: s } (parado con muestras) | { gap: s } (reloj parado: sin muestras)].
 * step: s entre muestras, o función (i) → s.
 * @returns {{ t: number[] (s), d: number[] (m), points: [{t (ms), dist}], bp: [[s, m]] }}
 */
function profile(parts, { step = 1 } = {}) {
  const bp = [[0, 0]];
  const gaps = [];
  for (const p of parts) {
    const [t, d] = bp[bp.length - 1];
    if (p.km != null) bp.push([t + p.km * p.pace, d + p.km * 1000]);
    else if (p.stop != null) bp.push([t + p.stop, d]);
    else { bp.push([t + p.gap, d]); gaps.push([t, t + p.gap]); }
  }
  const T = bp[bp.length - 1][0];
  const at = (x) => {
    let k = 1;
    while (k < bp.length - 1 && bp[k][0] < x) k++;
    const [ta, da] = bp[k - 1];
    const [tb, db] = bp[k];
    return tb === ta ? db : da + ((x - ta) / (tb - ta)) * (db - da);
  };
  const t = [];
  const d = [];
  for (let x = 0, i = 0; x < T; i++) {
    if (!gaps.some(([a, b]) => x > a && x < b)) { t.push(x); d.push(at(x)); }
    x += typeof step === 'function' ? step(i) : step;
  }
  if (t[t.length - 1] !== T) { t.push(T); d.push(at(T)); }
  return { t, d, bp, points: t.map((x, i) => ({ t: T0 + x * 1000, dist: d[i] })) };
}
const seriesOf = (p) => buildSeries({ t: p.t.map((x) => T0 / 1000 + x), d: p.d, src: 'device' });

/** Puntos completos (posición en línea recta, velocidad) para FIT/GPX/TCX a partir de un perfil. */
function fullPoints(p) {
  const R = 111320;
  return p.points.map((q, i) => ({
    ...q, lat: 40.4 + q.dist / R, lon: -3.7, ele: 650, hr: 150, cad: 85,
    speed: i ? (q.dist - p.points[i - 1].dist) / ((q.t - p.points[i - 1].t) / 1000) : 0,
  }));
}

async function itemFrom(name, bytes, kind = null) {
  const [e] = await readActivityFile(name, bytes);
  assert.ok(e && !e.error, `se lee ${name}: ${e?.error}`);
  const it = itemFromEntry(e, { key: 'k', today: TODAY });
  if (kind) setItemKind(it, kind);
  return it;
}

// ---------------------------------------------------------------------------
// Ventana más rápida
// ---------------------------------------------------------------------------
test('las distancias de mejor esfuerzo son las de los récords (stats.RECORD_DISTANCES)', () => {
  assert.deepEqual(EFFORT_DISTANCES.map((x) => [x.id, x.km]), RECORD_DISTANCES.map((x) => [x.id, x.km]));
});

test('1. 5,00 km constantes a 1 Hz: 5 km = el total (±1 s) y 1 km = ritmo constante', () => {
  const s = seriesOf(profile([{ km: 5, pace: 300 }]));
  const r = bestEffortsFromSeries(s);
  near(r['5k'].sec, 1500, 1, '5 km');
  assert.equal(r['1k'].sec, 300);
  assert.equal(r['5k'].atKm, 0);
  assert.equal(r['5k'].approx, false);
  assert.equal(r['5k'].pausedSec, 0);
  assert.deepEqual(Object.keys(r), ['1k', '5k'], 'sin 10 km');
});

test('2. 12 km con un 5 km rápido en medio (24:50): el parcial es 1490 s, no el ritmo medio × 5', () => {
  const s = seriesOf(profile([{ km: 3, pace: 330 }, { km: 5, pace: 298 }, { km: 4, pace: 330 }]));
  const r = bestEffortsFromSeries(s);
  near(r['5k'].sec, 1490, 1, '5 km');
  near(r['5k'].atKm, 3, 0.01, 'empieza en el km 3');
  const avg5 = ((3 * 330 + 1490 + 4 * 330) / 12) * 5;
  assert.ok(avg5 - r['5k'].sec > 90, `ritmo medio × 5 = ${avg5} sería mucho peor`);
  assert.equal(r['1k'].sec, 298);
  near(r['10k'].sec, 1490 + 5 * 330, 1, '10 km: incluye el tramo rápido');
});

test('3. 10 km y media maratón; 25 km dan media pero no maratón', () => {
  const r = bestEffortsFromSeries(seriesOf(profile([{ km: 25, pace: 300 }], { step: 2 })));
  near(r['10k'].sec, 3000, 1, '10 km');
  near(r.half.sec, 21.0975 * 300, 1, 'media');
  assert.equal(r.marathon, undefined);
});

test('4. maratón de 42,3 km a 1 Hz (~12 600 puntos): exacto y dentro de presupuesto de tiempo', () => {
  const p = profile([{ km: 20, pace: 300 }, { km: 22.3, pace: 290 }]);
  assert.ok(p.t.length > 12000);
  const s = seriesOf(p);
  const t0 = performance.now();
  const r = bestEffortsFromSeries(s);
  const ms = performance.now() - t0;
  // Mejor 42,195: empezar a 0,105 km para dejar fuera lo más lento.
  near(r.marathon.sec, (20 - 0.105) * 300 + 22.3 * 290, 1, 'maratón');
  near(r.marathon.atKm, 0.11, 0.01, 'empieza en 0,105 km');
  near(r.half.sec, 21.0975 * 290, 1, 'media en la parte rápida');
  assert.ok(ms < 250, `cinco distancias en ${ms.toFixed(1)} ms`);
});

test('5. muestreo irregular (1–10 s): coincide con la respuesta analítica ±1 s; bordes separados → aproximado', () => {
  const rnd = noise(5);
  const p = profile([{ km: 2, pace: 300 }, { km: 5, pace: 270 }, { km: 2, pace: 300 }], { step: () => 1 + Math.round((rnd() + 1) * 4.5) });
  const r = bestEffortsFromSeries(seriesOf(p));
  near(r['5k'].sec, 1350, 1, '5 km');
  near(r['1k'].sec, 270, 1, '1 km');
  assert.equal(r['5k'].approx, false, 'u ≤ 10 s < 1 % de 1350 s (13,5 s)');
  // Cada 10 s: la incertidumbre de los bordes (10 s) supera máx(5 s, 1 % de 4:30) en 1 km, no en 5 km.
  const sparse = bestEffortsFromSeries(seriesOf(profile([{ km: 6, pace: 270 }], { step: 10 })));
  assert.equal(sparse['1k'].approx, true);
  assert.equal(sparse['5k'].approx, false);
  assert.equal(isApprox(5, 300), false);
  assert.equal(isApprox(5.1, 300), true);
  assert.equal(isApprox(14, 1500), false, '1 % de 1500 s = 15 s');
});

test('6. pausa dentro de la mejor ventana (reloj parado 120 s): cuenta; nunca más rápido que sin pausa', () => {
  const parts = [{ km: 3, pace: 360 }, { km: 2.5, pace: 270 }, { gap: 120 }, { km: 2.5, pace: 270 }, { km: 2, pace: 360 }];
  const r = bestEffortsFromSeries(seriesOf(profile(parts)));
  const noPause = bestEffortsFromSeries(seriesOf(profile(parts.filter((x) => x.gap == null))));
  near(noPause['5k'].sec, 1350, 1, 'sin pausa');
  near(r['5k'].sec, 1470, 1, 'con la pausa dentro');
  assert.ok(r['5k'].sec >= noPause['5k'].sec);
  near(r['5k'].pausedSec, 120, 1, 'pausedSec');
  // Lo mismo desde un FIT real (marca de tiempo con salto, distancia del reloj)
  const p = profile(parts);
  return (async () => {
    const it = await itemFrom('pausa.fit', buildFitActivity({ points: fullPoints(p), sport: 1 }));
    const rec = itemRecord(it, { id: 'a_p', now: 1 });
    near(rec.bestEfforts.items['5k'].sec, 1470, 1, '5 km desde el FIT');
    near(rec.bestEfforts.items['5k'].pausedSec, 120, 1, 'pausa desde el FIT');
    assert.equal(rec.movingSec, 3 * 360 + 5 * 270 + 2 * 360, 'el tiempo en movimiento no cuenta la pausa');
  })();
});

test('7. quedarse quieto antes de empezar no cuenta: la ventana empieza al arrancar', () => {
  const r = bestEffortsFromSeries(seriesOf(profile([{ km: 1, pace: 360 }, { stop: 300 }, { km: 5, pace: 290 }])));
  near(r['5k'].sec, 1450, 1, '5 km');
  near(r['5k'].atKm, 1, 0.01, 'desde el km 1');
  assert.equal(r['5k'].pausedSec, 0);
  // Y quedarse quieto al final tampoco alarga nada
  const w = fastestWindow([0, 300, 600, 900], [0, 1000, 1000, 2000], 1000);
  assert.equal(w.sec, 300);
});

test('8. salto del GPS (un punto a 300 m): las ventanas que lo cruzan no valen; las demás, igual', () => {
  const run = makeTrack({ start: T0, stepSec: 1, heading: 0, phases: [{ sec: 2400, speed: 1000 / 300, hr: 150 }] });
  const pts = run.points.map(({ speed, dist, ...q }) => ({ ...q }));
  const k = 1800; // km 6
  pts[k] = { ...pts[k], lon: pts[k].lon + 300 / (111320 * Math.cos((40.4 * Math.PI) / 180)) };
  const m = pointMetrics(pts);
  assert.equal(m.series.spikes.length, 1, 'ida y vuelta: un solo tramo');
  near(m.series.spikes[0][1] - m.series.spikes[0][0], 600, 15, 'metros imposibles');
  near(m.distanceM, 8000 + 600, 20, 'el total sigue siendo el de la actividad');
  const r = bestEffortsFromSeries(m.series);
  near(r['5k'].sec, 1500, 2, '5 km fuera del salto');
  near(r['1k'].sec, 300, 2, '1 km');
  // Sin el filtro, una ventana con el salto parecería mucho más rápida
  const raw = fastestWindow(m.series.t, m.series.d, 5000);
  assert.ok(raw.sec < 1400, `sin descartar: ${raw.sec}`);
});

test('9. datos inválidos: horas que faltan, repetidas o hacia atrás; reinicio de distancia; >10 %; ruta sin horas', async () => {
  const p = profile([{ km: 5, pace: 300 }]);
  const t = p.t.map((x) => T0 / 1000 + x);
  // 2 % de horas mal: se descartan y el resultado no cambia
  const bad = t.slice();
  for (let i = 10; i < bad.length - 1; i += 50) bad[i] = i % 100 === 10 ? NaN : bad[i - 1];
  bad[600] = bad[590]; // hacia atrás
  const s = buildSeries({ t: bad, d: p.d });
  assert.ok(s.invalid > 20 && s.invalid < 0.1 * s.total);
  assert.equal(seriesProblem(s, 5), null);
  near(bestEffortsFromSeries(s)['5k'].sec, 1500, 1, '5 km');
  // >10 % → inservible
  const worse = t.map((x, i) => (i % 8 === 3 ? NaN : x));
  const sw = buildSeries({ t: worse, d: p.d });
  assert.equal(seriesProblem(sw, 5), 'invalid');
  assert.equal(computeBestEfforts({ series: sw, basis: { km: 5, sec: 1500 } }), null);
  // Distancia que no cuadra con el registro
  assert.equal(seriesProblem(s, 5.2), 'mismatch');
  assert.equal(computeBestEfforts({ series: s, basis: { km: 5.2, sec: 1500 } }), null);
  assert.equal(seriesProblem(null, 5), 'none');
  assert.equal(buildSeries({ t: [1, NaN], d: [0, 10] }), null, 'menos de 2 puntos válidos');
  // Reinicio de la distancia del reloj (FIT): no resta ni suma; la serie acaba en la distancia del resumen
  const reset = fullPoints(profile([{ km: 6, pace: 300 }]));
  const cut = 1200;
  const base = reset[cut].dist;
  for (let i = cut; i < reset.length; i++) reset[i] = { ...reset[i], dist: reset[i].dist - base };
  const m = pointMetrics(reset);
  near(m.series.d[m.series.n - 1], m.distanceM, 1e-6, 'serie = distancia');
  near(m.distanceM, 6000 - 1000 / 300, 0.01, 'solo se pierde el tramo del reinicio');
  near(bestEffortsFromSeries(m.series)['5k'].sec, 1500, 1, '5 km');
  // GPX de una ruta sin horas
  const route = `<gpx><rte>${fullPoints(profile([{ km: 2, pace: 300 }], { step: 30 })).map((q) => `<rtept lat="${q.lat}" lon="${q.lon}"/>`).join('')}</rte></gpx>`;
  const it = await itemFrom('ruta.gpx', new TextEncoder().encode(route), 'run');
  assert.equal(it.series, null);
  setItemField(it, 'movingSec', 600);
  const rec = itemRecord(it, { id: 'a_r', now: 1 });
  assert.ok(!('track' in rec) && !('bestEfforts' in rec));
});

test('10. solo vueltas: autovueltas de 1 km dan 5 y 10 km; vuelta sin tiempo total no vale; vueltas 0,6 % largas tampoco', async () => {
  const paces = [300, 300, 290, 280, 280, 280, 280, 280, 300, 310];
  let at = T0;
  const laps = paces.map((sec) => { const l = { start: at, elapsedSec: sec, timerSec: sec, distanceM: 1000 }; at += sec * 1000; return l; });
  const fit = buildFitActivity({ points: [], records: false, laps, sport: 1 });
  const it = await itemFrom('vueltas.fit', fit);
  assert.equal(it.series, null);
  assert.equal(it.laps.length, 10);
  assert.equal(it.distanceKm, 10);
  const rec = itemRecord(it, { id: 'a_l', now: 1 });
  assert.equal(rec.bestEfforts.src, 'laps');
  assert.deepEqual(rec.bestEfforts.items['5k'], { sec: 1400, atKm: 3, pausedSec: 0, approx: false });
  assert.equal(rec.bestEfforts.items['10k'].sec, paces.reduce((a, b) => a + b, 0));
  assert.equal(rec.bestEfforts.items['1k'].sec, 280);
  assert.equal(rec.laps.length, 10);
  assert.deepEqual(rec.laps[1], { at: 300, sec: 300, timerSec: 300, m: 1000 });
  assert.ok(!('track' in rec));
  // Una vuelta con solo cronómetro dentro del mejor tramo: esas rachas no cuentan
  const stored = lapsForRecord(laps.map((l) => ({ startT: l.start, elapsedSec: l.elapsedSec, timerSec: l.timerSec, distanceM: l.distanceM })));
  stored[5] = { ...stored[5], sec: null };
  const r = bestEffortsFromLaps(stored);
  assert.ok(r['5k'].sec > 1400, `sin la vuelta 6: ${r['5k'].sec}`);
  assert.equal(r['10k'], undefined);
  // Pausa: tiempo total > cronómetro
  const paused = stored.map((l, i) => (i === 3 ? { ...l, sec: 340, timerSec: 280 } : { ...l, sec: l.sec ?? 280 }));
  assert.equal(bestEffortsFromLaps(paused)['10k'].pausedSec, 60);
  // 0,6 % largas: 5 vueltas = 5035 m > 5000 · 1,005 + 5
  const long = stored.map((l) => ({ ...l, sec: 290, m: 1007 }));
  const rl = bestEffortsFromLaps(long);
  assert.equal(rl['5k'], undefined);
  assert.equal(rl['1k'].sec, Math.round((290 * 1000) / 1007));
  // Vueltas TCX sin puntos: la última no tiene tiempo total
  const tcx = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-09-06T06:00:00Z</Id>${
    paces.map((sec, i) => `<Lap StartTime="${new Date(laps[i].start).toISOString()}"><TotalTimeSeconds>${sec}</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters></Lap>`).join('')
  }</Activity></Activities></TrainingCenterDatabase>`;
  const itT = await itemFrom('vueltas.tcx', new TextEncoder().encode(tcx));
  assert.equal(itT.laps[9].elapsedSec, null);
  assert.equal(itT.laps[8].elapsedSec, 300);
  const recT = itemRecord(itT, { id: 'a_t', now: 1 });
  assert.equal(recT.bestEfforts.items['5k'].sec, 1400);
  assert.equal(recT.bestEfforts.items['10k'], undefined, 'la última vuelta no tiene tiempo total');
});

// ---------------------------------------------------------------------------
// Track compacto
// ---------------------------------------------------------------------------
test('11. encodeTrack → decodeTrack: recalcular desde el track coincide con la serie completa (±1 s + 2ε/v)', () => {
  const rnd = noise(9);
  // 12 km a 1 Hz con ritmo que varía todo el rato y una pausa de 90 s (sin muestras)
  const parts = [];
  for (let k = 0; k < 48; k++) parts.push({ km: 0.25, pace: 300 + rnd() * 25 - (k >= 12 && k < 32 ? 20 : 0) });
  parts.splice(30, 0, { gap: 90 });
  const p = profile(parts);
  const s = seriesOf(p);
  const tr = encodeTrack(s);
  assert.equal(tr.v, 1);
  assert.equal(tr.eps, TRACK_EPS_M);
  assert.equal(tr.step, 1);
  assert.ok(tr.n < s.n / 5, `simplifica: ${s.n} → ${tr.n}`);
  assert.match(tr.dt, /(^|,)-[0-9a-z]+/, 'la pausa queda marcada como intervalo original');
  const dec = decodeTrack(JSON.parse(JSON.stringify(tr)));
  near(dec.d[dec.n - 1], s.d[s.n - 1], 0.05, 'misma distancia final');
  const a = bestEffortsFromSeries(s);
  const b = bestEffortsFromSeries(dec);
  assert.deepEqual(Object.keys(b), Object.keys(a));
  for (const id of Object.keys(a)) {
    near(b[id].sec, a[id].sec, 1 + (2 * TRACK_EPS_M) / 3, id);
    assert.equal(b[id].approx, a[id].approx, `${id} approx`);
    near(b[id].pausedSec, a[id].pausedSec, 2, `${id} pausa`);
  }
  // Cada muestra descartada está a ≤ ε de la recta entre las que quedan
  const idx = simplifyIdx(s.t, s.d, 1);
  for (let q = 1; q < idx.length; q++) {
    const i = idx[q - 1];
    const j = idx[q];
    for (let k = i + 1; k < j; k++) {
      const lin = s.d[i] + ((s.t[k] - s.t[i]) / (s.t[j] - s.t[i])) * (s.d[j] - s.d[i]);
      assert.ok(Math.abs(lin - s.d[k]) <= 1 + 1e-9, `muestra ${k}`);
    }
  }
  // Tamaño por hora
  const bytes = tr.dt.length + tr.dd.length;
  const hours = s.t[s.n - 1] / 3600;
  assert.ok(bytes / hours < 3000, `${Math.round(bytes / hours)} B/h`);
  // Mal formados → null
  assert.equal(decodeTrack(null), null);
  assert.equal(decodeTrack({ ...tr, v: 2 }), null);
  assert.equal(decodeTrack({ ...tr, n: tr.n + 1 }), null);
  assert.equal(decodeTrack({ ...tr, dd: tr.dd.replace(/,([0-9a-z]+)/, ',-$1') }), null, 'distancia hacia atrás');
  assert.equal(decodeTrack({ ...tr, dt: tr.dt.replace(/,[0-9a-z]+/, ',0') }), null, 'tiempo que no avanza');
  assert.equal(decodeTrack({ ...tr, dt: tr.dt.replace(/,[0-9a-z]+/, ',x!') }), null);
  assert.equal(decodeTrack({ ...tr, t0: 'ayer' }), null);
  assert.equal(decodeTrack({ ...tr, spikes: [[5, 2]] }), null);
});

test('11b. horas con decimales (TCX con milisegundos): segundos enteros, siempre crecientes, el final se conserva', () => {
  const t = [];
  const d = [];
  for (let i = 0; i <= 600; i++) { t.push(T0 / 1000 + i * 0.6); d.push(i * 2); }
  const tr = encodeTrack(buildSeries({ t, d }));
  const dec = decodeTrack(tr);
  for (let i = 1; i < dec.n; i++) assert.ok(dec.t[i] > dec.t[i - 1]);
  near(dec.d[dec.n - 1], 1200, 0.05, 'distancia final');
  near(dec.t[dec.n - 1], 360, 0.5, 'tiempo final');
});

test('12. versión anterior: se recalcula desde el track una sola vez (memoria por registro); editar lo oculta', () => {
  const s = seriesOf(profile([{ km: 3, pace: 330 }, { km: 5, pace: 298 }, { km: 4, pace: 330 }]));
  const rec = {
    id: 'a1', kind: 'run', distanceKm: 12, movingSec: 3800, rpe: 6,
    track: encodeTrack(s), bestEfforts: { v: BEST_EFFORTS_VERSION - 1, basis: { km: 12, sec: 3800 }, src: 'track', items: { '5k': { sec: 1, atKm: 0, pausedSec: 0, approx: false } } },
  };
  const before = recomputeCount();
  const items = effortsOf(rec);
  near(items['5k'].sec, 1490, 2, 'recalculado, no el valor viejo');
  assert.equal(recomputeCount(), before + 1);
  assert.equal(effortsOf(rec), items, 'misma respuesta memorizada');
  Object.assign(rec, { rpe: 7, notes: 'x' }); // edición que no toca distancia ni tiempo (como activity.js)
  assert.equal(effortsOf(rec), items);
  assert.equal(recomputeCount(), before + 1, 'sin recalcular');
  // Editar la distancia o el tiempo: dejan de contar; deshacer: vuelven
  rec.distanceKm = 12.4;
  assert.equal(effortsOf(rec), null);
  rec.distanceKm = 12;
  rec.movingSec = 3700;
  assert.equal(effortsOf(rec), null);
  rec.movingSec = 3800;
  assert.equal(effortsOf(rec), items);
  rec.kind = 'bike';
  assert.equal(effortsOf(rec), null, 'otro deporte: no cuenta');
  rec.kind = 'run';
  assert.equal(recomputeCount(), before + 1);
  // Versión actual: se leen tal cual
  const cur = { kind: 'run', distanceKm: 12, movingSec: 3800, bestEfforts: { v: BEST_EFFORTS_VERSION, basis: { km: 12, sec: 3800 }, src: 'track', items: { '5k': { sec: 1490, atKm: 3, pausedSec: 0, approx: false } } } };
  assert.equal(effortsOf(cur).fiveK, undefined);
  assert.equal(effortsOf(cur)['5k'].sec, 1490);
  assert.equal(recomputeCount(), before + 1);
  // Registros antiguos o manuales
  assert.equal(effortsOf({ kind: 'run', distanceKm: 10, movingSec: 3000 }), null);
  assert.equal(effortsOf(null), null);
  // Track dañado y versión vieja: nada (sin romper)
  assert.equal(effortsOf({ ...rec, track: { v: 1, n: 3, dt: '0', dd: '0', t0: 1 } }), null);
});

test('splitsOf: parciales por km (tiempo transcurrido) desde el track; con vueltas de 1 km; null si se edita', () => {
  const s = seriesOf(profile([{ km: 3, pace: 330 }, { km: 5, pace: 298 }, { km: 4.4, pace: 330 }]));
  const be = computeBestEfforts({ series: s, basis: { km: 12.4, sec: 3932 } });
  const rec = { kind: 'run', distanceKm: 12.4, movingSec: 3932, track: encodeTrack(s), bestEfforts: be };
  const sp = splitsOf(rec);
  assert.equal(sp.length, 13);
  assert.deepEqual(sp.slice(0, 4).map((x) => x.sec), [330, 330, 330, 298]);
  assert.deepEqual(sp[12], { km: 12.4, sec: 132, cumSec: 3932 });
  assert.equal(sp.reduce((a, x) => a + x.sec, 0), sp[12].cumSec);
  rec.distanceKm = 12;
  assert.equal(splitsOf(rec), null);
  const laps = { kind: 'run', distanceKm: 3, movingSec: 900, laps: [{ at: 0, sec: 300, timerSec: 300, m: 1000 }, { at: 300, sec: 290, timerSec: 290, m: 1001 }, { at: 590, sec: 310, timerSec: 310, m: 999 }] };
  assert.deepEqual(splitsOf(laps).map((x) => [x.km, x.sec, x.cumSec]), [[1, 300, 300], [2, 290, 590], [3, 310, 900]]);
  assert.equal(splitsOf({ ...laps, laps: laps.laps.map((l) => ({ ...l, m: 1600 })) }), null, 'vueltas que no son de 1 km');
});

// ---------------------------------------------------------------------------
// Importación: FIT, TCX y GPX
// ---------------------------------------------------------------------------
test('13. FIT, TCX y GPX dan serie y vueltas; el registro guarda track, laps y bestEfforts solo en carreras', async () => {
  const p = profile([{ km: 3, pace: 330 }, { km: 5, pace: 298 }, { km: 4.4, pace: 330 }]);
  const pts = fullPoints(p);
  // FIT con autovueltas de 1 km
  const lapStarts = [];
  for (let km = 0; km < 12.4; km++) {
    const i = p.d.findIndex((x) => x >= km * 1000);
    lapStarts.push(i);
  }
  const fitLaps = lapStarts.map((i, k) => {
    const j = lapStarts[k + 1] ?? p.t.length - 1;
    return { start: pts[i].t, elapsedSec: (pts[j].t - pts[i].t) / 1000, timerSec: (pts[j].t - pts[i].t) / 1000, distanceM: pts[j].dist - pts[i].dist };
  });
  const fit = await itemFrom('carrera.fit', buildFitActivity({ points: pts, sport: 1, laps: fitLaps }));
  assert.equal(fit.series.src, 'device');
  assert.equal(fit.laps.length, 13);
  near(fit.laps[3].elapsedSec, 298, 1, 'vuelta 4');
  const rec = itemRecord(fit, { id: 'a_f', now: 1 });
  assert.equal(rec.distanceKm, 12.4);
  near(rec.bestEfforts.items['5k'].sec, 1490, 1, '5 km');
  assert.deepEqual(rec.bestEfforts.basis, { km: rec.distanceKm, sec: rec.movingSec });
  assert.equal(rec.bestEfforts.v, BEST_EFFORTS_VERSION);
  assert.equal(rec.track.src, 'device');
  assert.equal(rec.track.t0, pts[0].t);
  assert.equal(rec.laps.length, 13);
  assert.equal(rec.laps[0].at, 0);
  assert.ok(!JSON.stringify(rec).includes('"lat"'), 'sin coordenadas');
  assert.ok(JSON.stringify(rec).length < 2500, `registro compacto: ${JSON.stringify(rec).length} B`);
  assert.deepEqual(effortsOf(rec), rec.bestEfforts.items);
  // TCX (distancia del reloj, 2 vueltas)
  const tcx = await itemFrom('carrera.tcx', new TextEncoder().encode(tcxFromPoints(pts, { sport: 'Running', laps: 2 })));
  assert.equal(tcx.series.src, 'device');
  assert.equal(tcx.laps.length, 2);
  near(tcx.laps[0].elapsedSec + tcx.laps[1].elapsedSec, p.t[p.t.length - 1], 1, 'tiempo total de las vueltas');
  const recT = itemRecord(tcx, { id: 'a_t', now: 1 });
  near(recT.bestEfforts.items['5k'].sec, 1490, 1, '5 km TCX');
  assert.equal(recT.laps.length, 2);
  // GPX (haversine de los tramos en movimiento; sin vueltas)
  const gpx = await itemFrom('carrera.gpx', new TextEncoder().encode(gpxFromPoints(pts)));
  assert.equal(gpx.series.src, 'gps');
  assert.deepEqual(gpx.laps, []);
  const recG = itemRecord(gpx, { id: 'a_g', now: 1 });
  near(recG.bestEfforts.items['5k'].sec, 1490, 2, '5 km GPX');
  assert.ok(!('laps' in recG));
  // Otro deporte: nada de esto
  setItemKind(fit, 'bike');
  const bike = itemRecord(fit, { id: 'a_b', now: 1 });
  assert.ok(!('track' in bike) && !('laps' in bike) && !('bestEfforts' in bike));
});

test('14. distancia o tiempo cambiados en la vista previa, o serie que no cuadra → no se guarda ningún parcial', async () => {
  const pts = fullPoints(profile([{ km: 6, pace: 300 }]));
  const mk = async () => itemFrom('c.fit', buildFitActivity({ points: pts, sport: 1 }));
  const a = await mk();
  setItemField(a, 'distanceKm', 6.2);
  const ra = itemRecord(a, { id: 'a', now: 1 });
  assert.ok(!('track' in ra) && !('bestEfforts' in ra) && !('laps' in ra));
  const b = await mk();
  setItemField(b, 'movingSec', 1700);
  assert.ok(!('bestEfforts' in itemRecord(b, { id: 'b', now: 1 })));
  // El total de la sesión FIT dice 6,5 km pero los puntos suman 6 km
  const c = await itemFrom('c.fit', buildFitActivity({ points: pts, sport: 1, session: { distanceM: 6500 } }));
  assert.equal(c.distanceKm, 6.5);
  const rc = itemRecord(c, { id: 'c', now: 1 });
  assert.ok(!('track' in rc) && !('bestEfforts' in rc));
  // Sin tocar nada: sí
  const d = await mk();
  assert.ok('bestEfforts' in itemRecord(d, { id: 'd', now: 1 }));
});

test('rendimiento: importar una actividad de 4 h y otra de 12 h a 1 Hz (lectura + registro)', async () => {
  for (const hours of [4, 12]) {
    const p = profile([{ km: hours * 12, pace: 300 }]);
    const fit = buildFitActivity({ points: fullPoints(p), sport: 1 });
    const t0 = performance.now();
    const it = await itemFrom('largo.fit', fit);
    const t1 = performance.now();
    const rec = itemRecord(it, { id: 'x', now: 1 });
    const t2 = performance.now();
    assert.ok(rec.bestEfforts.items.marathon, `${hours} h: maratón`);
    console.log(`# ${hours} h a 1 Hz (${p.t.length} puntos): lectura ${(t1 - t0).toFixed(0)} ms, parciales ${(t2 - t1).toFixed(1)} ms, track ${rec.track.dt.length + rec.track.dd.length} B`);
    assert.ok(t2 - t1 < 500, `parciales en ${(t2 - t1).toFixed(0)} ms`);
  }
});
