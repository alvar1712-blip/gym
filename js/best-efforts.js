// best-efforts.js — parciales y mejores esfuerzos de las carreras importadas (ronda 8, bloque C). PURO: sin DOM ni
// store, no importa stats (stats lo importará); se prueba en Node (tests/unit/best-efforts.test.mjs).
//
// Qué guarda una carrera importada (campos opcionales del registro de 'sessions'; las antiguas no los tienen):
//   rec.track = { v, src:'device'|'gps', eps, step, t0, n, dt, dd, spikes }
//     Serie compacta de distancia acumulada frente al tiempo (sin coordenadas: no se guarda el recorrido).
//     dt / dd: deltas en base 36 separados por comas, el primero 0: segundos enteros (> 0) y decímetros (≥ 0).
//     Un delta de tiempo con «-» delante marca un intervalo ORIGINAL largo (> step + 1 s, p. ej. una pausa): sus dos
//     extremos son muestras reales del archivo, y así se sabe lo poco precisa que es una ventana que empieza o acaba
//     ahí. step = intervalo de muestreo típico (mediana, s). spikes = [[desdeDm, hastaDm]] tramos de GPS imposibles.
//     Se simplifica con un filtro de abanico (swing): solo quedan las muestras necesarias para que todas las
//     descartadas estén a ≤ eps metros de la recta entre las que quedan (error de una ventana ≤ 2·eps/v s).
//   rec.laps = [{ at, sec, timerSec, m }]  (solo con ≥ 2 vueltas) at = s desde track.t0 (o desde la 1.ª vuelta si
//     no hay serie); sec = tiempo total de la vuelta (o null); timerSec = cronómetro; m = metros enteros.
//   rec.bestEfforts = { v, basis:{ km, sec }, src:'track'|'laps', items:{ '1k'|'5k'|'10k'|'half'|'marathon':
//     { sec, atKm, pausedSec, approx } } }
//     Calculado UNA vez al importar con la serie completa (exacto). basis = distanceKm y movingSec del registro al
//     calcular (huella): si después se editan, los parciales dejan de contar sin tocar los datos (effortsOf).
//
// Algoritmo (fastestWindow): la serie es la interpolación lineal de (t, d). La duración de una ventana de X m varía
// linealmente entre puntos de ruptura, así que el mínimo está donde el inicio o el final caen en una muestra: dos
// pasadas de dos punteros, O(n). El tiempo de la ventana es el TRANSCURRIDO (pausas incluidas): parar el reloj nunca
// hace un parcial más rápido; quedarse quieto antes de empezar tampoco cuenta (inicio = último instante en esa
// distancia). Los metros de saltos del GPS no cuentan para llegar a X (la ventana se mide sin ellos) y una ventana con
// más del 1 % de esos metros, o con un ritmo imposible (< 2:30 /km), se descarta.
// Precisión: segundos enteros; si la separación entre muestras en los bordes es grande (u > máx(5 s, 1 %)) el
// resultado es aproximado (approx) y no debe usarse como récord ni para predecir.
import { RUN_PACE_MIN } from './calc.js';

/** Versión del cálculo: si sube, effortsOf recalcula desde `track` (y lo memoriza). */
export const BEST_EFFORTS_VERSION = 1;
/** Versión del formato de `track`. */
export const TRACK_VERSION = 1;
/** Distancias de mejor esfuerzo (mismos ids que stats.RECORD_DISTANCES; una prueba lo comprueba). */
export const EFFORT_DISTANCES = [
  { id: '1k', km: 1 }, { id: '5k', km: 5 }, { id: '10k', km: 10 }, { id: 'half', km: 21.0975 }, { id: 'marathon', km: 42.195 },
];
/** Tolerancia de la simplificación (m de distancia). */
export const TRACK_EPS_M = 1;
/** Un tramo de más de SPIKE_MIN_M a más de SPIKE_SPEED m/s es un salto del GPS (corriendo no se va a 36 km/h). */
export const SPIKE_SPEED = 10;
export const SPIKE_MIN_M = 5;
/** Una ventana con más de este tanto de metros imposibles no vale. */
export const SPIKE_MAX_SHARE = 0.01;
/** Incertidumbre de los bordes por encima de máx(APPROX_MIN_SEC, APPROX_SHARE·tiempo) → aproximado. */
export const APPROX_MIN_SEC = 5;
export const APPROX_SHARE = 0.01;
/** Vueltas: una racha de vueltas cuenta para X si suma entre X y X·(1 + LAP_TOL) + LAP_TOL_M. */
export const LAP_TOL = 0.005;
export const LAP_TOL_M = 5;
/** Serie inservible si más de este tanto de puntos tiene la hora mal (falta, repetida o hacia atrás). */
export const INVALID_MAX_SHARE = 0.1;
/** La serie (o las vueltas) debe acabar en la distancia del registro: ± máx(20 m, 1 %). */
export const MATCH_TOL_M = 20;
export const MATCH_TOL_SHARE = 0.01;
/** Pausa (solo informativa): tramo a menos de 0,5 m/s (import-parse.MOVING_MIN_SPEED). */
export const PAUSE_SPEED = 0.5;
/** Huella del registro: distancia (km) y tiempo en movimiento (s) deben seguir siendo los del cálculo. */
export const BASIS_TOL_KM = 0.0005;
export const BASIS_TOL_SEC = 0.5;

const fin = Number.isFinite;
const round2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Serie limpia
// ---------------------------------------------------------------------------
/**
 * Serie de distancia acumulada a partir de los puntos que tienen distancia (import-parse.pointMetrics).
 * Limpieza: fuera los puntos sin hora o con hora ≤ la anterior (cuentan en `invalid`; los metros que traían pasan al
 * siguiente punto, porque `d` es acumulada); los tramos a más de SPIKE_SPEED (y > SPIKE_MIN_M) se conservan en `d`
 * (el total sigue cuadrando con la distancia de la actividad) y se apuntan en `spikes`.
 * @param {{ t: ArrayLike<number> (s absolutos, NaN si no hay), d: ArrayLike<number> (m acumulados), src }} raw
 * @returns {{ t0, t: Float64Array (s desde t0), d: Float64Array, src, n, total, invalid, step, spikes: number[][] } | null}
 */
export function buildSeries({ t, d, src = 'device' }) {
  const total = t.length;
  if (total < 2) return null;
  const tt = new Float64Array(total);
  const dd = new Float64Array(total);
  let n = 0;
  let invalid = 0;
  for (let i = 0; i < total; i++) {
    const ti = t[i];
    const di = fin(d[i]) ? d[i] : (n ? dd[n - 1] : 0);
    if (!fin(ti) || (n && ti <= tt[n - 1])) { invalid++; continue; }
    tt[n] = ti;
    dd[n] = n && di < dd[n - 1] ? dd[n - 1] : di; // nunca hacia atrás
    n++;
  }
  if (n < 2) return null;
  const t0 = tt[0];
  const d0 = dd[0];
  const ts = new Float64Array(n);
  const ds = new Float64Array(n);
  const gaps = new Float64Array(n - 1);
  const spikes = [];
  for (let k = 0; k < n; k++) {
    ts[k] = tt[k] - t0;
    ds[k] = dd[k] - d0;
    if (k) {
      const dt = ts[k] - ts[k - 1];
      const dm = ds[k] - ds[k - 1];
      gaps[k - 1] = dt;
      if (dm > SPIKE_MIN_M && dm / dt > SPIKE_SPEED) {
        const last = spikes[spikes.length - 1];
        if (last && last[1] >= ds[k - 1]) last[1] = ds[k];
        else spikes.push([ds[k - 1], ds[k]]);
      }
    }
  }
  return { t0: t0 * 1000, t: ts, d: ds, src, n, total, invalid, step: medianStep(gaps), spikes };
}

/** Intervalo de muestreo típico (mediana, segundos enteros ≥ 1). */
function medianStep(gaps) {
  if (!gaps.length) return 1;
  const s = Float64Array.from(gaps).sort();
  return Math.max(1, Math.round(s[Math.floor(s.length / 2)]));
}

/** Distancia final de la serie (m). */
export const seriesEndM = (series) => (series && series.n ? series.d[series.n - 1] : 0);

const matches = (m, km) => km > 0 && Math.abs(m - km * 1000) <= Math.max(MATCH_TOL_M, MATCH_TOL_SHARE * km * 1000);

/**
 * ¿Sirve la serie para un registro de `km`? null si sí; si no, el motivo: 'none' | 'invalid' (demasiadas horas mal) |
 * 'mismatch' (no acaba en la distancia del registro).
 */
export function seriesProblem(series, km) {
  if (!series || !(series.n >= 2)) return 'none';
  if (series.invalid > INVALID_MAX_SHARE * series.total) return 'invalid';
  if (!matches(seriesEndM(series), km)) return 'mismatch';
  return null;
}

// ---------------------------------------------------------------------------
// Simplificación y codificación
// ---------------------------------------------------------------------------
/**
 * Filtro de abanico (swing) con error vertical acotado: índices de las muestras que se quedan, de modo que cada
 * muestra descartada está a ≤ eps de la recta entre las dos que la rodean. Los dos extremos de un intervalo de más de
 * maxDt segundos se quedan siempre (son muestras reales a los dos lados de una pausa o un hueco). O(n).
 * @returns {Int32Array}
 */
export function simplifyIdx(t, d, eps = TRACK_EPS_M, maxDt = Infinity) {
  const n = t.length;
  if (n <= 2) return Int32Array.from({ length: n }, (_, i) => i);
  const keep = [0];
  let a = 0;
  let lo = -Infinity;
  let hi = Infinity;
  for (let j = 1; j < n; j++) {
    if (t[j] - t[j - 1] > maxDt) {
      if (j - 1 !== a) keep.push(j - 1);
      keep.push(j);
      a = j;
      lo = -Infinity;
      hi = Infinity;
      continue;
    }
    let dt = t[j] - t[a];
    const s = (d[j] - d[a]) / dt;
    if (s < lo || s > hi) {
      keep.push(j - 1);
      a = j - 1;
      dt = t[j] - t[a];
      lo = (d[j] - eps - d[a]) / dt;
      hi = (d[j] + eps - d[a]) / dt;
      continue;
    }
    lo = Math.max(lo, (d[j] - eps - d[a]) / dt);
    hi = Math.min(hi, (d[j] + eps - d[a]) / dt);
  }
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
  return Int32Array.from(keep);
}

/**
 * Serie → `track` compacto (ver cabecera). null si no hay serie útil.
 * @returns {{ v, src, eps, step, t0, n, dt, dd, spikes } | null}
 */
export function encodeTrack(series, { eps = TRACK_EPS_M } = {}) {
  if (!series || !(series.n >= 2)) return null;
  const { t, d, step } = series;
  const maxDt = step + 1;
  const idx = simplifyIdx(t, d, eps, maxDt);
  // Segundos enteros: si dos muestras que se quedan caen en el mismo segundo, sobra la primera (nunca la última).
  const kept = [];
  for (let q = 0; q < idx.length; q++) {
    const k = idx[q];
    const T = Math.round(t[k]);
    if (kept.length && T <= kept[kept.length - 1].T) {
      if (q < idx.length - 1 || kept.length < 2) continue; // el primero se queda
      kept.pop(); // el último se queda siempre (la distancia final)
    }
    kept.push({ k, T, D: Math.round(d[k] * 10) });
  }
  if (kept.length < 2) return null;
  const dts = ['0'];
  const dds = ['0'];
  for (let i = 1; i < kept.length; i++) {
    const p = kept[i - 1];
    const q = kept[i];
    const raw = q.k === p.k + 1 && t[q.k] - t[p.k] > maxDt;
    dts.push((raw ? '-' : '') + (q.T - p.T).toString(36));
    dds.push(Math.max(0, q.D - p.D).toString(36));
  }
  return {
    v: TRACK_VERSION,
    src: series.src,
    eps,
    step,
    t0: Math.round(series.t0 + kept[0].T * 1000),
    n: kept.length,
    dt: dts.join(','),
    dd: dds.join(','),
    spikes: (series.spikes || []).map(([a, b]) => [Math.round(a * 10), Math.round(b * 10)]),
  };
}

const TOKEN = /^-?[0-9a-z]+$/;

/**
 * `track` → { t (s desde t0), d (m), sdt (separación de muestreo de cada tramo, para la incertidumbre), spikes (m),
 * t0, src }, o null si está mal formado (versión desconocida, longitudes distintas, tiempo que no avanza…).
 */
export function decodeTrack(track) {
  if (!track || typeof track !== 'object' || track.v !== TRACK_VERSION) return null;
  const { n } = track;
  if (!Number.isInteger(n) || n < 2 || typeof track.dt !== 'string' || typeof track.dd !== 'string' || !fin(track.t0)) return null;
  const dtT = track.dt.split(',');
  const ddT = track.dd.split(',');
  if (dtT.length !== n || ddT.length !== n) return null;
  const step = Number.isInteger(track.step) && track.step >= 1 ? track.step : 1;
  const t = new Float64Array(n);
  const d = new Float64Array(n);
  const sdt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = dtT[i];
    const b = ddT[i];
    if (!TOKEN.test(a) || !TOKEN.test(b) || b[0] === '-') return null;
    const raw = a[0] === '-';
    const dt = parseInt(raw ? a.slice(1) : a, 36);
    const dd = parseInt(b, 36);
    if (!fin(dt) || !fin(dd)) return null;
    if (i === 0) {
      if (dt !== 0 || dd !== 0) return null;
      continue;
    }
    if (!(dt > 0)) return null;
    t[i] = t[i - 1] + dt;
    d[i] = d[i - 1] + dd / 10;
    // Un tramo sin marca puede juntar varias muestras de ≤ step + 1 s: esa es la separación que se supone.
    sdt[i] = raw ? dt : Math.min(dt, step + 1);
  }
  const spikes = [];
  if (Array.isArray(track.spikes)) {
    for (const s of track.spikes) {
      if (!Array.isArray(s) || !fin(s[0]) || !fin(s[1]) || !(s[1] > s[0])) return null;
      spikes.push([s[0] / 10, s[1] / 10]);
    }
  }
  return { t, d, sdt, spikes, t0: track.t0, src: track.src === 'gps' ? 'gps' : 'device', n };
}

// ---------------------------------------------------------------------------
// Ventana continua más rápida
// ---------------------------------------------------------------------------
/** Metros de salto del GPS por debajo de x: F(x) con los tramos [a, b] ordenados y sin solapes. */
function spikeMeter(spikes) {
  if (!spikes || !spikes.length) return null;
  const list = spikes.slice().sort((p, q) => p[0] - q[0]);
  const pre = [0];
  for (const [a, b] of list) pre.push(pre[pre.length - 1] + (b - a));
  return (x) => {
    let lo = 0;
    let hi = list.length; // primer tramo con a ≥ x
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] < x) lo = mid + 1; else hi = mid;
    }
    if (!lo) return 0;
    const [a, b] = list[lo - 1];
    return pre[lo - 1] + Math.min(b, x) - a;
  };
}

/**
 * Ventana continua más rápida de `meters` metros en la serie (t estrictamente creciente, d no decreciente).
 * Exacta para la interpolación lineal. Devuelve el tiempo TRANSCURRIDO (pausas incluidas).
 * @param {{ spikes?: number[][], sdt?: ArrayLike<number>, minPace?: number }} [opts]
 *   spikes: tramos [a, b] (m) de saltos del GPS; sdt: separación de muestreo de cada tramo k (k-1 → k) para la
 *   incertidumbre (por defecto t[k] − t[k-1]); minPace: ritmo más rápido creíble (s/km).
 * @returns {{ sec, startM, startT, endT, pausedSec, edgeDt } | null}
 */
export function fastestWindow(t, d, meters, { spikes = null, sdt = null, minPace = RUN_PACE_MIN } = {}) {
  const n = t.length;
  const F = spikeMeter(spikes);
  // Con saltos del GPS, la ventana se mide en metros «buenos» (D = d − metros imposibles por debajo): un salto no
  // acerca nunca el final. Además, una ventana con más del 1 % de metros imposibles no vale (dato poco fiable).
  let D = d;
  if (F) {
    D = new Float64Array(n);
    for (let k = 0; k < n; k++) D[k] = d[k] - F(d[k]);
  }
  if (n < 2 || !(meters > 0) || !(D[n - 1] - D[0] >= meters)) return null;
  const maxSpike = SPIKE_MAX_SHARE * meters;
  const minSec = (minPace * meters) / 1000;
  const seg = (k) => (sdt ? sdt[k] : t[k] - t[k - 1]);
  let best = null;
  const consider = (ts, te, sM, eM, kS, kE) => {
    const sec = te - ts;
    if (!(sec > 0) || sec < minSec) return;
    if (F && eM - sM - meters > maxSpike) return;
    if (best && !(sec < best.sec - 1e-9)) return;
    best = { sec, startM: sM, startT: ts, endT: te, edgeDt: (seg(kS) + seg(kE)) / 2 };
  };
  // A: el inicio cae en la muestra i (la última en esa distancia: quedarse quieto antes no cuenta).
  for (let i = 0, j = 1; i < n - 1; i++) {
    if (!(D[i + 1] > D[i])) continue;
    const e = D[i] + meters;
    if (j <= i) j = i + 1;
    while (j < n && D[j] < e) j++;
    if (j >= n) break;
    const f = (e - D[j - 1]) / (D[j] - D[j - 1]);
    consider(t[i], t[j - 1] + f * (t[j] - t[j - 1]), d[i], d[j - 1] + f * (d[j] - d[j - 1]), i + 1, j);
  }
  // B: el final cae en la muestra j (la primera en llegar a esa distancia).
  for (let j = 1, k = 0; j < n; j++) {
    if (!(D[j] > D[j - 1])) continue;
    const s = D[j] - meters;
    if (s < D[0]) continue;
    while (k + 1 < n && D[k + 1] <= s) k++;
    if (k + 1 > j) continue;
    const f = D[k] === s ? 0 : (s - D[k]) / (D[k + 1] - D[k]);
    consider(t[k] + f * (t[k + 1] - t[k]), t[j], d[k] + f * (d[k + 1] - d[k]), d[j], k + 1, j);
  }
  if (!best) return null;
  // Tiempo parado dentro de la ventana (solo informativo).
  let paused = 0;
  for (let k = 1; k < n; k++) {
    if (t[k] <= best.startT) continue;
    if (t[k - 1] >= best.endT) break;
    const dt = t[k] - t[k - 1];
    if ((d[k] - d[k - 1]) / dt >= PAUSE_SPEED) continue;
    paused += Math.min(best.endT, t[k]) - Math.max(best.startT, t[k - 1]);
  }
  best.pausedSec = paused;
  return best;
}

/** ¿Resultado aproximado? Incertidumbre de los bordes por encima de máx(5 s, 1 % del tiempo). */
export const isApprox = (edgeDt, sec) => edgeDt > Math.max(APPROX_MIN_SEC, APPROX_SHARE * sec);

/**
 * Mejores esfuerzos de una serie ({ t, d, spikes, sdt? }): { [id]: { sec, atKm, pausedSec, approx } } para cada
 * distancia que cabe en la serie.
 */
export function bestEffortsFromSeries(series) {
  const items = {};
  if (!series || !(series.t?.length >= 2)) return items;
  const { t, d } = series;
  const total = d[d.length - 1] - d[0];
  for (const { id, km } of EFFORT_DISTANCES) {
    const X = km * 1000;
    if (total < X) break;
    const w = fastestWindow(t, d, X, { spikes: series.spikes, sdt: series.sdt });
    if (!w) continue;
    items[id] = { sec: Math.round(w.sec), atKm: round2(w.startM / 1000), pausedSec: Math.round(w.pausedSec), approx: isApprox(w.edgeDt, w.sec) };
  }
  return items;
}

// ---------------------------------------------------------------------------
// Vueltas
// ---------------------------------------------------------------------------
/**
 * Vueltas leídas (import-parse: { startT (ms), elapsedSec, timerSec, distanceM }) → forma guardada
 * [{ at, sec, timerSec, m }] con `at` en segundos desde t0 (ms). Sin distancia → fuera. null si quedan < 2.
 */
export function lapsForRecord(laps, t0 = null) {
  if (!Array.isArray(laps)) return null;
  const ok = laps.filter((l) => l && l.distanceM > 0);
  if (ok.length < 2) return null;
  const base = fin(t0) ? t0 : ok.find((l) => fin(l.startT))?.startT ?? null;
  const pos = (v) => (fin(v) && v > 0 ? Math.round(v * 10) / 10 : null);
  return ok.map((l) => ({
    at: fin(l.startT) && base != null ? Math.round((l.startT - base) / 1000) : null,
    sec: pos(l.elapsedSec),
    timerSec: pos(l.timerSec),
    m: Math.round(l.distanceM),
  }));
}

const lapsSumM = (laps) => (laps || []).reduce((s, l) => s + (l.m > 0 ? l.m : 0), 0);

/**
 * Mejores esfuerzos con vueltas (sin puntos): rachas de vueltas seguidas que suman entre X y X·(1 + LAP_TOL) + 5 m,
 * todas con tiempo total (una vuelta con solo cronómetro podría esconder una pausa: no vale);
 * tiempo = Σ tiempo · X / Σ m.
 */
export function bestEffortsFromLaps(laps) {
  const items = {};
  if (!Array.isArray(laps) || !laps.length) return items;
  const pre = [0];
  for (const l of laps) pre.push(pre[pre.length - 1] + (l.m > 0 ? l.m : 0));
  for (const { id, km } of EFFORT_DISTANCES) {
    const X = km * 1000;
    const hi = X * (1 + LAP_TOL) + LAP_TOL_M;
    let best = null;
    for (let a = 0; a < laps.length; a++) {
      let b = a;
      let sec = 0;
      let paused = 0;
      let ok = true;
      while (b < laps.length && pre[b + 1] - pre[a] < X) b++;
      if (b >= laps.length) break;
      const sum = pre[b + 1] - pre[a];
      if (sum > hi) continue;
      for (let k = a; k <= b; k++) {
        const l = laps[k];
        if (!(l.sec > 0) || !(l.m > 0)) { ok = false; break; }
        sec += l.sec;
        if (l.timerSec > 0 && l.sec > l.timerSec) paused += l.sec - l.timerSec;
      }
      if (!ok) continue;
      const scaled = (sec * X) / sum;
      if (scaled < (RUN_PACE_MIN * X) / 1000) continue;
      if (!best || scaled < best.sec) best = { sec: scaled, atKm: round2(pre[a] / 1000), pausedSec: Math.round(paused) };
    }
    if (best) items[id] = { sec: Math.round(best.sec), atKm: best.atKm, pausedSec: best.pausedSec, approx: false };
  }
  return items;
}

// ---------------------------------------------------------------------------
// Al importar
// ---------------------------------------------------------------------------
/**
 * Mejores esfuerzos al importar: con la serie completa si sirve (seriesProblem), si no con las vueltas (forma
 * guardada) si suman la distancia del registro. basis = { km: distanceKm, sec: movingSec } del registro.
 * @returns {{ v, basis, src:'track'|'laps', items } | null}  null si no hay nada que guardar.
 */
export function computeBestEfforts({ series = null, laps = null, basis }) {
  if (!basis || !(basis.km > 0) || !(basis.sec > 0)) return null;
  let src = null;
  let items = {};
  if (!seriesProblem(series, basis.km)) {
    src = 'track';
    items = bestEffortsFromSeries(series);
  } else if (Array.isArray(laps) && laps.length >= 2 && matches(lapsSumM(laps), basis.km)) {
    src = 'laps';
    items = bestEffortsFromLaps(laps);
  }
  if (!src || !Object.keys(items).length) return null;
  return { v: BEST_EFFORTS_VERSION, basis: { km: basis.km, sec: basis.sec }, src, items };
}

// ---------------------------------------------------------------------------
// Después: lectura derivada y validada
// ---------------------------------------------------------------------------
/** ¿Sigue el registro con la distancia y el tiempo con los que se calcularon sus parciales? */
export function basisMatches(rec, basis) {
  return !!rec && !!basis && rec.distanceKm > 0 && rec.movingSec > 0
    && Math.abs(rec.distanceKm - basis.km) <= BASIS_TOL_KM && Math.abs(rec.movingSec - basis.sec) <= BASIS_TOL_SEC;
}

const memo = new WeakMap();
let recomputed = 0;
/** Veces que effortsOf ha tenido que recalcular desde `track` (para comprobar la memoria en las pruebas). */
export const recomputeCount = () => recomputed;

/**
 * Mejores esfuerzos VÁLIDOS de un registro, o null: solo carreras cuya distancia y tiempo siguen siendo los del
 * cálculo (editar la distancia o el tiempo los oculta; deshacer la edición los devuelve). Si el cálculo es de una
 * versión anterior, se rehace desde `track` (o las vueltas) y se memoriza por registro: nunca en cada pintado.
 * Incluye los aproximados (approx): quien los use para récords o predicciones debe descartarlos.
 */
export function effortsOf(rec) {
  if (!rec || rec.kind !== 'run' || !rec.bestEfforts || typeof rec.bestEfforts !== 'object') return null;
  const be = rec.bestEfforts;
  if (!basisMatches(rec, be.basis)) return null;
  if (be.v === BEST_EFFORTS_VERSION) return be.items && typeof be.items === 'object' ? be.items : null;
  const m = memo.get(rec);
  if (m && m.be === be && m.track === rec.track && m.laps === rec.laps) return m.items;
  recomputed++;
  let items = null;
  const dec = decodeTrack(rec.track);
  if (dec) items = bestEffortsFromSeries(dec);
  else if (Array.isArray(rec.laps)) items = bestEffortsFromLaps(rec.laps);
  if (items && !Object.keys(items).length) items = null;
  memo.set(rec, { be, track: rec.track, laps: rec.laps, items });
  return items;
}

/**
 * Parciales por km (o cada `km`) de una carrera importada: [{ km (distancia al final del parcial), sec, cumSec }],
 * tiempo transcurrido. Con la serie si la hay; si no, con vueltas que caen en múltiplos de `km`. null si no hay o si
 * la distancia o el tiempo del registro se han editado.
 */
export function splitsOf(rec, km = 1) {
  if (!rec || rec.kind !== 'run' || !(km > 0) || !basisMatches(rec, rec.bestEfforts?.basis ?? splitBasis(rec))) return null;
  const step = km * 1000;
  const dec = decodeTrack(rec.track);
  if (dec) {
    const { t, d } = dec;
    const n = t.length;
    const end = d[n - 1];
    const out = [];
    let prev = 0;
    let j = 1;
    for (let b = step; b <= end + 1e-9; b += step) {
      while (j < n - 1 && d[j] < b) j++;
      const tb = d[j] === d[j - 1] ? t[j] : t[j - 1] + ((b - d[j - 1]) / (d[j] - d[j - 1])) * (t[j] - t[j - 1]);
      out.push({ km: round2(b / 1000), sec: Math.round(tb) - Math.round(prev), cumSec: Math.round(tb) });
      prev = tb;
    }
    if (end - (out.length * step) >= 0.05 * step) {
      out.push({ km: round2(end / 1000), sec: Math.round(t[n - 1]) - Math.round(prev), cumSec: Math.round(t[n - 1]) });
    }
    return out.length ? out : null;
  }
  const laps = rec.laps;
  if (!Array.isArray(laps) || laps.length < 2 || laps.some((l) => !(l.sec > 0))) return null;
  const out = [];
  let cumM = 0;
  let cumSec = 0;
  for (const l of laps) {
    cumM += l.m;
    cumSec += l.sec;
    const k = Math.round(cumM / step);
    const isLast = l === laps[laps.length - 1];
    if (!isLast && Math.abs(cumM - k * step) > LAP_TOL * step + LAP_TOL_M) return null;
    out.push({ km: round2((isLast ? cumM : k * step) / 1000), sec: Math.round(l.sec), cumSec: Math.round(cumSec) });
  }
  return out;
}

/** Sin bestEfforts (carrera de menos de 1 km) no hay huella: los parciales valen si la serie acaba en su distancia. */
function splitBasis(rec) {
  const dec = rec.track ? decodeTrack(rec.track) : null;
  const m = dec ? dec.d[dec.n - 1] : lapsSumM(rec.laps);
  return matches(m, rec.distanceKm) ? { km: rec.distanceKm, sec: rec.movingSec } : null;
}
