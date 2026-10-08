// Auditoría de formatters (docs/PULIDO.md §15): con CUALQUIER entrada —null, undefined, '', NaN, ±Infinity, negativos,
// cero, enormes, cadenas— ningún formatter escribe «NaN», «Infinity», «undefined», «null», «[object», signos dobles
// («+−», «−−», «--»), un ritmo con horas («1:05:00 /km») ni minutos o segundos negativos («-5:-3»). Fallan de forma
// segura: «—» o una cifra válida.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../../js/util.js';
import { fmtMetric, fmtNumFast, weightLabel, distanceLabel, elevationLabel } from '../../js/stats.js';
import { fmtLastre, fmtSec, formatSet } from '../../js/session-logic.js';

const NASTY = [null, undefined, '', 'abc', NaN, Infinity, -Infinity, -1, -0.5, 0, 0.0001, 1e-9, 59.999, 3599.6, 3600, 86399.9, 1e7, 1e15, -1e7];
const BAD = /NaN|Infinity|undefined|null|\[object|[+−-]{2}|[+−]-|-[+−]|:\s*-|\d+:\d{2}:\d{2}\s?\/(km|100)/;
const ok = (fn, label) => {
  for (const v of NASTY) {
    let out;
    try { out = fn(v); } catch (err) { assert.fail(`${label}(${String(v)}) lanzó ${err.message}`); }
    if (out == null) continue; // «sin valor» explícito: la vista pone «—»
    assert.equal(typeof out, 'string', `${label}(${String(v)}) → ${typeof out}`);
    assert.ok(!BAD.test(out), `${label}(${String(v)}) → «${out}»`);
  }
};

test('números, pesos, porcentajes, signos', () => {
  ok((v) => U.fmtNum(v, 1), 'fmtNum');
  ok((v) => U.fmtNum(v, 0), 'fmtNum0');
  ok((v) => fmtNumFast(v, 1), 'fmtNumFast');
  ok((v) => U.fmtKg(v), 'fmtKg');
  ok((v) => U.fmtPct(v), 'fmtPct');
  ok((v) => U.fmtPct(v, 1, false), 'fmtPct sin signo');
  ok((v) => U.fmtSigned(v, 1, 'kg'), 'fmtSigned');
  ok((v) => weightLabel('weight_reps', v), 'weightLabel');
  ok((v) => weightLabel('bodyweight', v), 'weightLabel peso corporal');
  ok((v) => fmtLastre(v), 'fmtLastre');
});

test('tiempos, duraciones, ritmos, velocidades y distancias', () => {
  ok((v) => U.fmtDuration(v), 'fmtDuration');
  ok((v) => U.fmtMinutes(v), 'fmtMinutes');
  ok((v) => U.fmtPace(v), 'fmtPace');
  ok((v) => U.fmtPace(v, '/100 m'), 'fmtPace /100 m');
  ok((v) => U.fmtPaceKm(v), 'fmtPaceKm');
  ok((v) => U.fmtSpeed(v), 'fmtSpeed');
  ok((v) => U.fmtKm(v), 'fmtKm');
  ok((v) => U.fmtRaceTime(v), 'fmtRaceTime');
  ok((v) => U.fmtRaceRange(v, v), 'fmtRaceRange');
  ok((v) => U.fmtPaceRange(v, v), 'fmtPaceRange');
  ok((v) => fmtSec(v), 'fmtSec');
  ok((v) => distanceLabel('run', v), 'distanceLabel');
  ok((v) => distanceLabel('swim', v), 'distanceLabel natación');
  ok((v) => elevationLabel(v), 'elevationLabel');
});

test('métricas de stats con valores raros', () => {
  for (const m of ['volume', 'load', 'km.run', 'km.swim', 'sets', 'runPace', 'bikeSpeed', 'swimPace', 'minutes']) ok((v) => fmtMetric(m, v), `fmtMetric(${m})`);
});

test('fechas: cadenas inválidas o vacías no rompen', () => {
  for (const d of [null, undefined, '', '2026-13-45', 'ayer', '2026-02-30']) {
    for (const style of [undefined, 'day', 'full', 'long', 'longy', 'short']) {
      let out;
      try { out = U.fmtDate(d, style); } catch (err) { assert.fail(`fmtDate(${d}, ${style}) lanzó ${err.message}`); }
      if (out == null) continue;
      assert.ok(!BAD.test(String(out)), `fmtDate(${d}, ${style}) → «${out}»`);
    }
  }
});

test('series: peso corporal con lastre/asistencia, unilateral, tiempo y distancia, sin datos', () => {
  const sets = [
    { weight: 80, reps: 8, rir: 2 }, { weight: -20, reps: 6 }, { weight: 0, reps: 10 }, { weight: 10, reps: 5, repsR: 6 },
    { timeSec: 45 }, { distanceM: 30, timeSec: 4.4 }, { heightCm: 50, reps: 5 }, {}, { weight: NaN, reps: Infinity },
  ];
  for (const lt of ['weight_reps', 'bodyweight', 'unilateral', 'time', 'distance_time', 'jumps', 'cardio']) {
    for (const s of sets) {
      let out;
      try { out = formatSet(s, lt, { kg: true }); } catch (err) { assert.fail(`formatSet(${JSON.stringify(s)}, ${lt}) lanzó ${err.message}`); }
      assert.ok(!BAD.test(String(out)), `formatSet(${JSON.stringify(s)}, ${lt}) → «${out}»`);
    }
  }
});

test('ritmo de una hora o más por km: nunca con horas', () => {
  assert.equal(U.fmtPace(3600), '—');
  assert.equal(U.fmtPace(4000), '—');
  assert.equal(U.fmtPace(3599), '59:59 /km');
  assert.equal(U.fmtPace(330), '5:30 /km');
});
