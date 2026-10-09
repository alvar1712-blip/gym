// Récords con los mejores esfuerzos de las carreras importadas (ronda 8, C3). Una sola regla derivada
// (stats.runMarkFor) para Progreso › Récords, los récords del resumen, el «conseguido» de los objetivos, el informe y
// el récord que enseña Tiempos previstos: la carrera completa (X…X·1,02), su mejor tramo continuo si es una importada
// con parciales válidos («Parcial dentro de 12,4 km») o, en último recurso, a su ritmo medio («estimado»).
// Datos sintéticos: perfiles por tramos a 1 Hz pasados por el mismo cálculo que la importación
// (best-efforts.buildSeries + computeBestEfforts + encodeTrack). Hoy = 7 oct 2026.
process.env.TZ = 'Europe/Madrid';

import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../js/context-logic.js';
import { buildSeries, computeBestEfforts, encodeTrack, EFFORT_DISTANCES, BEST_EFFORTS_VERSION } from '../../js/best-efforts.js';
import { enduranceRecords, runMarkFor, scaledRunMark, RECORD_DISTANCES, ESTIMATE_FACTOR } from '../../js/stats.js';
import { periodSummary } from '../../js/summary-logic.js';
import { goalProgress } from '../../js/goals-logic.js';
import { predictRaces } from '../../js/race-predict.js';
import { buildAnalysis } from '../../js/analysis.js';
import { reportText } from '../../js/analysis-report.js';
import { addDays, tsFromDate, fmtDuration } from '../../js/util.js';
import { SEED_EXERCISES, defaultSettings } from '../../js/seed.js';

const T = '2026-10-07';
const ago = (n) => addDays(T, -n);
const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
let seq = 0;
const run = (date, km, sec, extra = {}) => ({ id: `run${++seq}`, kind: 'run', status: 'done', date, distanceKm: km, movingSec: sec, durationMin: sec / 60, rpe: 6, startedAt: tsFromDate(date, 8), ...extra });
const mark = (date, km, sec) => C.entryRecord({ kind: 'event', type: 'race_result', date: { date, precision: 'day' }, text: '', notes: '', result: { km, sec } }, { id: `res${++seq}`, now: seq });
const data = (sessions, context = [], extra = {}) => ({ sessions, context, exercises: EX, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], today: T, ...extra });
const best = (d, id) => enduranceRecords(d).run.best[id];

/**
 * Carrera importada como la guarda import-logic: tramos [{ km, pace } | { stop: s }] a 1 Hz; movingSec = tiempo sin
 * las paradas (como el del reloj); track + bestEfforts con la huella { km, sec } del registro.
 */
function imported(date, parts, extra = {}) {
  const t = [0];
  const d = [0];
  let ts = 0;
  let dm = 0;
  let moving = 0;
  for (const p of parts) {
    if (p.stop) {
      for (let i = 1; i <= p.stop; i++) { t.push(ts + i); d.push(dm); }
      ts += p.stop;
      continue;
    }
    const n = Math.round(p.km * p.pace);
    for (let i = 1; i <= n; i++) { t.push(ts + i); d.push(dm + (p.km * 1000 * i) / n); }
    ts += n; dm += p.km * 1000; moving += n;
  }
  const t0 = tsFromDate(date, 8) / 1000;
  const series = buildSeries({ t: t.map((x) => t0 + x), d, src: 'device' });
  const km = Math.round(dm) / 1000;
  const bestEfforts = computeBestEfforts({ series, basis: { km, sec: moving } });
  return run(date, km, moving, { source: { type: 'fit', fileName: 'carrera.fit' }, track: encodeTrack(series), bestEfforts, ...extra });
}
/** 12,4 km: 3,12 km a 5:30, 5 km a 4:58 (24:50) y 4,28 km a 5:30. Ritmo medio ≈ 5:17 → 5 km «a ritmo medio» ≈ 26:25. */
const twelve = (date = ago(3), extra) => imported(date, [{ km: 3.12, pace: 330 }, { km: 5, pace: 298 }, { km: 4.28, pace: 330 }], extra);

test('runMarkFor: completa hasta X·1,02, parcial si hay mejor esfuerzo válido, estimada en último recurso; null si es más corta', () => {
  assert.deepEqual(EFFORT_DISTANCES.map((e) => e.id), RECORD_DISTANCES.map((r) => r.id), 'mismas distancias en récords y parciales');
  // Manuales: la regla de siempre
  assert.equal(runMarkFor(run(T, 4.99, 1500), 5), null);
  assert.deepEqual(runMarkFor(run(T, 5 * ESTIMATE_FACTOR, 1530), 5), { timeSec: 1500, paceSec: 300, how: 'full', partial: null });
  const est = runMarkFor(run(T, 5.11, 1533), 5);
  assert.equal(est.how, 'estimated');
  assert.ok(Math.abs(est.timeSec - 1500) < 1e-9);
  // Importada de 12,4 km: mejor tramo
  const a = twelve();
  assert.equal(a.bestEfforts.v, BEST_EFFORTS_VERSION);
  const m5 = runMarkFor(a, 5);
  assert.deepEqual(m5, { timeSec: 1490, paceSec: 298, how: 'partial', partial: { id: '5k', ofKm: 12.4, atKm: 3.12, src: 'track' } });
  assert.equal(runMarkFor(a, 10).how, 'partial');
  assert.equal(runMarkFor(a, 1).timeSec, 298);
  assert.equal(runMarkFor(a, 21.0975), null, 'no llega a la media');
  // Una distancia sin parciales (8 km) cae en la estimación
  assert.equal(runMarkFor(a, 8).how, 'estimated');
  // Cambiada a bici: sus parciales no cuentan como carrera
  assert.equal(runMarkFor({ ...a, kind: 'bike' }, 5).how, 'estimated');
  // Las marcas históricas: solo a ritmo medio
  assert.equal(scaledRunMark(10, 3000, 5).how, 'estimated');
});

test('Récords: el mejor 5 km de una carrera importada de 12,4 km es su tramo de 24:50, no ritmo medio × 5', () => {
  const a = twelve();
  const b = best(data([a]), '5k');
  assert.equal(b.timeSec, 1490);
  assert.equal(b.timeLabel, '24:50');
  assert.equal(b.paceLabel, '4:58 /km', 'el ritmo del tramo, no el medio de la actividad');
  assert.equal(b.how, 'partial');
  assert.equal(b.estimated, false);
  assert.deepEqual(b.partial, { id: '5k', ofKm: 12.4, atKm: 3.12, src: 'track' });
  assert.deepEqual([b.fromKm, b.source, b.sessionId], [12.4, 'import', a.id]);
  const avg = (a.movingSec * 5) / a.distanceKm;
  assert.ok(avg - b.timeSec > 90, `ritmo medio × 5 = ${fmtDuration(avg)} sería otra cosa`);
});

test('en la misma carrera el parcial sustituye a la estimación (aunque sea más lento por una pausa); nunca conviven', () => {
  // 4 km · parada 10 min · 4 km · parada 10 min · 4,4 km, todo a 5:00: a ritmo medio (tiempo en movimiento) serían 25:00,
  // pero no hay 5 km seguidos sin parar: el mejor tramo real (tiempo transcurrido) es 35:00
  const a = imported(ago(2), [{ km: 4, pace: 300 }, { stop: 600 }, { km: 4, pace: 300 }, { stop: 600 }, { km: 4.4, pace: 300 }]);
  const b = best(data([a]), '5k');
  assert.deepEqual([b.timeSec, b.how, b.estimated, b.sessionId], [2100, 'partial', false, a.id]);
  // 1 km sí cabe entero sin parar
  assert.equal(best(data([a]), '1k').timeSec, 300);
});

test('una estimación de otra carrera (manual) sigue compitiendo y, si gana, se etiqueta «estimado»', () => {
  const a = twelve(ago(10));
  const manual = run(ago(5), 6, 1680); // 5 km a ritmo medio = 23:20 < 24:50
  const b = best(data([a, manual]), '5k');
  assert.deepEqual([b.sessionId, b.how, b.estimated, b.timeLabel], [manual.id, 'estimated', true, '23:20']);
  // Una manual más lenta no gana al parcial
  const slow = run(ago(5), 6, 1900);
  assert.equal(best(data([a, slow]), '5k').sessionId, a.id);
});

test('editar la distancia o el tiempo de la importada oculta su parcial (vuelve a ritmo medio); deshacerlo lo devuelve', () => {
  const a = twelve();
  a.distanceKm = 12.5; // editada en el formulario (el registro se cambia en su sitio)
  let b = best(data([a]), '5k');
  assert.deepEqual([b.how, b.estimated, b.partial], ['estimated', true, null]);
  a.distanceKm = 12.4;
  b = best(data([a]), '5k');
  assert.equal(b.how, 'partial');
  a.movingSec += 30;
  assert.equal(best(data([a]), '5k').how, 'estimated');
  a.movingSec -= 30;
  assert.equal(best(data([a]), '5k').how, 'partial');
});

test('un parcial aproximado (bordes con muestras muy separadas) no es récord: estimado', () => {
  const a = twelve();
  a.bestEfforts = { ...a.bestEfforts, items: { ...a.bestEfforts.items, '5k': { ...a.bestEfforts.items['5k'], approx: true } } };
  assert.equal(best(data([a]), '5k').how, 'estimated');
  assert.equal(best(data([a]), '10k').how, 'partial', 'los demás parciales siguen valiendo');
});

test('una marca histórica más rápida gana al parcial; una más lenta, no', () => {
  const a = twelve();
  assert.equal(best(data([a], [mark(ago(200), 5, 1400)]), '5k').source, 'context');
  const b = best(data([a], [mark(ago(200), 5, 1600)]), '5k');
  assert.deepEqual([b.source, b.how], ['import', 'partial']);
});

test('carreras antiguas (sin source ni track): exactamente la regla de siempre (ritmo medio)', () => {
  const runs = [run(ago(40), 5, 1560), run(ago(30), 10.1, 3150), run(ago(20), 12, 3700), run(ago(10), 21.5, 7000), run(ago(3), 43, 15000)];
  const r = enduranceRecords(data(runs)).run.best;
  for (const { id, km } of RECORD_DISTANCES) {
    // El mismo cálculo de antes (stats.computeEnduranceRecords previo a C3), escrito aparte
    let exp = null;
    for (const a of runs) {
      if (a.distanceKm + 1e-9 < km) continue;
      const t = (a.movingSec * km) / a.distanceKm;
      if (!exp || t < exp.t - 1e-9) exp = { t, id: a.id, est: a.distanceKm > km * 1.02 };
    }
    assert.ok(Math.abs(r[id].timeSec - exp.t) < 1e-9, id);
    assert.equal(r[id].sessionId, exp.id);
    assert.equal(r[id].estimated, exp.est);
    assert.equal(r[id].how, exp.est ? 'estimated' : 'full');
    assert.equal(r[id].partial, null);
  }
});

test('copia de seguridad: los parciales sobreviven a la ida y vuelta (JSON); una copia antigua sin ellos → estimado', () => {
  const a = twelve();
  const back = JSON.parse(JSON.stringify(a));
  assert.deepEqual(best(data([back]), '5k').partial, best(data([a]), '5k').partial);
  const { track, laps, bestEfforts, ...old } = back;
  assert.equal(best(data([old]), '5k').how, 'estimated');
});

test('resumen, objetivos y Récords usan la misma regla: mismos tiempos con parciales', () => {
  const prev = run('2026-09-02', 5, 1560); // 26:00: marca anterior
  const a = twelve('2026-09-20');
  const d = data([prev, a]);
  // Resumen del mes: récord de 5 km y 10 km = lo de Récords, con el texto del parcial
  const s = periodSummary(d, { unit: 'month', start: '2026-09-01', today: T });
  const r5 = s.records.find((r) => r.type === 'endurance' && r.metric === '5k');
  assert.ok(r5, 'récord de 5 km en el resumen');
  assert.equal(r5.detail, `${best(d, '5k').timeLabel} · 4:58 /km · parcial dentro de 12,4 km`);
  // Objetivo 5 km en menos de 25:00 creado antes: conseguido con el tramo (a ritmo medio serían 26:25: no llegaría)
  const goal = { id: 'g5', kind: 'endurance', sport: 'run', distanceKm: 5, timeSec: 25 * 60, createdAt: tsFromDate('2026-09-01', 10) };
  const p = goalProgress(d, goal);
  assert.equal(p.status, 'achieved');
  assert.equal(p.achievedOn, '2026-09-20');
  assert.match(p.explanation, /mejor tramo de 5 km en 24:50/);
  // Editada la distancia: ni récord del resumen por parcial ni objetivo conseguido
  a.distanceKm = 12.5;
  const d2 = data([prev, a]);
  assert.notEqual(goalProgress(d2, goal).status, 'achieved');
  const b2 = best(d2, '5k');
  assert.deepEqual([b2.sessionId, b2.how], [prev.id, 'full'], 'la 12,5 km a ritmo medio (26:13) ya no bate los 26:00');
  assert.ok(!periodSummary(d2, { unit: 'month', start: '2026-09-01', today: T }).records.some((r) => r.metric === '5k'));
});

test('informe para IA y «¿Por qué?» de Tiempos previstos nombran el parcial, no el ritmo medio', () => {
  const a = twelve(ago(4));
  const d = data([a, run(ago(9), 8, 2560), run(ago(16), 10, 3200)]);
  const txt = reportText(buildAnalysis(d, T));
  assert.match(txt, /- 5 km — 24:50 — .* — actividad importada \(mejor tramo dentro de una carrera de 12,4 km\)/);
  const p = predictRaces(d).predictions['5k'];
  assert.equal(p.record.how, 'partial');
  const row = p.why.data.find((x) => /Tu récord/.test(x.label));
  assert.match(row.value, /^24:50 · .* \(mejor tramo de una carrera de 12,4 km\)$/);
});
