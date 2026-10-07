// calc.js — cálculos de dominio PUROS (sin DOM ni store). Testeables en Node.
// Convenciones:
//  - Una «serie de trabajo» es una serie hecha (done) cuyo tipo NO es calentamiento.
//  - RIR: número 0–5, 'F' (fallo = 0) o null (desconocido → se trata como 0 en el 1RM).
import { diffDays, parseDate, sortBy, weekStart, addDays, round } from './util.js';

export const WORK_TYPES = ['effective', 'failure', 'drop'];

export function isWorkSet(set) {
  return !!set && set.done === true && set.type !== 'warmup';
}

export function rirValue(rir) {
  if (rir === 'F') return 0;
  return typeof rir === 'number' && Number.isFinite(rir) ? rir : null;
}

/** Repeticiones máximas de una serie para estimar el 1RM (por encima, la estimación no es fiable). */
export const E1RM_MAX_REPS = 12;

/**
 * 1RM estimado (Epley) usando reps + RIR como repeticiones hasta el fallo.
 * Solo para series de 1–12 repeticiones hechas. Devuelve null si no aplica.
 */
export function e1rm(weight, reps, rir = null) {
  if (!(weight > 0) || !(reps >= 1 && reps <= E1RM_MAX_REPS)) return null;
  const r = reps + (rirValue(rir) ?? 0);
  return r <= 1 ? weight : weight * (1 + r / 30);
}

/** Epley inverso: peso para hacer `reps` (con `rir`) dado un 1RM. */
export function weightForReps(oneRm, reps, rir = 0) {
  if (!(oneRm > 0) || !(reps >= 1)) return null;
  const r = reps + (rirValue(rir) ?? 0);
  return r <= 1 ? oneRm : oneRm / (1 + r / 30);
}

// ---------------------------------------------------------------------------
// Peso corporal
// ---------------------------------------------------------------------------

/**
 * Crea una función date → kg a partir de la lista de pesajes [{id:'YYYY-MM-DD', kg}].
 * Usa el último pesaje en o antes de la fecha; si no hay, el primero posterior; si no, fallback.
 */
export function makeBodyweightFn(bodyweightList, fallback = 75) {
  const sorted = sortBy((bodyweightList || []).filter((b) => b && b.kg > 0), 'id');
  return (date) => {
    if (!sorted.length) return fallback;
    let best = null;
    for (const b of sorted) {
      if (b.id <= date) best = b;
      else break;
    }
    return (best || sorted[0]).kg;
  };
}

// ---------------------------------------------------------------------------
// Métricas por serie
// ---------------------------------------------------------------------------

/**
 * Métricas de una serie según el tipo de registro del ejercicio.
 * @returns {{load:number|null, reps:number|null, e1rm:number|null, volume:number|null}}
 *  load   = kg «efectivos» (peso corporal: peso corporal + lastre, asistencia negativa)
 *  reps   = reps usadas para 1RM (unilateral: el lado con menos reps)
 *  volume = kg × reps (unilateral: suma de ambos lados; peso corporal: (pc + lastre) × reps)
 *  Peso corporal de core (exercise.pattern === 'core': rueda abdominal, elevaciones de piernas, crunch): el peso
 *  corporal no es la carga que se mueve, así que no cuenta: load = lastre (> 0; si no, null), volume = lastre × reps
 *  (null sin lastre) y e1rm = null siempre.
 */
export function setMetrics(set, exercise, bwKg = null) {
  const out = { load: null, reps: null, e1rm: null, volume: null };
  if (!set || !exercise) return out;
  const type = exercise.logType;
  const w = typeof set.weight === 'number' ? set.weight : null;
  const reps = typeof set.reps === 'number' ? set.reps : null;
  if (type === 'weight_reps') {
    out.load = w;
    out.reps = reps;
    if (w != null && reps != null) out.volume = w * reps;
  } else if (type === 'unilateral') {
    const r2 = typeof set.repsR === 'number' ? set.repsR : null;
    out.load = w;
    out.reps = reps != null && r2 != null ? Math.min(reps, r2) : reps ?? r2;
    if (w != null) out.volume = w * ((reps || 0) + (r2 || 0));
  } else if (type === 'bodyweight' && exercise.pattern === 'core') {
    out.load = w != null && w > 0 ? w : null;
    out.reps = reps;
    if (out.load != null && reps != null) out.volume = out.load * reps;
    return out; // sin 1RM estimado
  } else if (type === 'bodyweight') {
    const bw = bwKg || null;
    out.load = bw != null ? bw + (w || 0) : null;
    out.reps = reps;
    if (out.load != null && reps != null) out.volume = out.load * reps;
  } else {
    // time, distance_time, jumps, cardio: sin 1RM ni volumen en kg.
    out.reps = reps;
    return out;
  }
  if (out.load != null && out.reps != null) out.e1rm = e1rm(out.load, out.reps, set.rir);
  return out;
}

/** Volumen de trabajo (kg) de una sesión de fuerza. */
export function sessionVolume(session, exMap, bwFn = () => null) {
  let v = 0;
  for (const se of session.exercises || []) {
    const ex = exMap.get ? exMap.get(se.exerciseId) : exMap[se.exerciseId];
    if (!ex) continue;
    for (const s of se.sets || []) {
      if (!isWorkSet(s)) continue;
      const m = setMetrics(s, ex, bwFn(session.date));
      if (m.volume) v += m.volume;
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// Series por músculo
// ---------------------------------------------------------------------------

/** { muscleId: factor } — principal = primaryFactor (1), secundario = secondaryFactor (0,5). */
export function muscleContrib(exercise, settings) {
  const pf = settings?.primaryFactor ?? 1;
  const sf = settings?.secondaryFactor ?? 0.5;
  const out = {};
  for (const m of exercise?.secondary || []) out[m] = Math.max(out[m] || 0, sf);
  for (const m of exercise?.primary || []) out[m] = Math.max(out[m] || 0, pf);
  return out;
}

/** Nº de series de trabajo por ejercicio de sesión. */
export function workSetCount(sessionExercise) {
  return (sessionExercise.sets || []).filter(isWorkSet).length;
}

/** { muscleId: series } de una sesión. */
export function sessionMuscleSets(session, exMap, settings) {
  const out = {};
  for (const se of session.exercises || []) {
    const ex = exMap.get ? exMap.get(se.exerciseId) : exMap[se.exerciseId];
    if (!ex) continue;
    const n = workSetCount(se);
    if (!n) continue;
    for (const [m, f] of Object.entries(muscleContrib(ex, settings))) out[m] = (out[m] || 0) + n * f;
  }
  return out;
}

/** { muscleId: series } de las sesiones de fuerza terminadas en la semana que empieza en ws. */
export function weeklyMuscleSets(sessions, ws, exMap, settings) {
  const we = addDays(ws, 6);
  const out = {};
  for (const s of sessions) {
    if (s.kind !== 'strength' || s.status !== 'done' || s.date < ws || s.date > we) continue;
    for (const [m, n] of Object.entries(sessionMuscleSets(s, exMap, settings))) out[m] = (out[m] || 0) + n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Duración y carga (duración en min × esfuerzo percibido 1–10)
// ---------------------------------------------------------------------------

export function sessionDurationMin(session) {
  if (!session) return null;
  if (typeof session.durationMin === 'number' && session.durationMin >= 0) return session.durationMin;
  if (session.kind !== 'strength' && typeof session.movingSec === 'number') return session.movingSec / 60;
  if (session.startedAt && session.endedAt && session.endedAt > session.startedAt) return (session.endedAt - session.startedAt) / 60000;
  return null;
}

export function sessionLoad(session) {
  const d = sessionDurationMin(session);
  const rpe = session?.rpe;
  if (d == null || !(rpe >= 1)) return null;
  return Math.round(d * rpe);
}

// ---------------------------------------------------------------------------
// Ritmos y velocidades
// ---------------------------------------------------------------------------
/** s/km */
export function pace(sec, km) {
  return km > 0 && sec > 0 ? sec / km : null;
}
/**
 * Ritmos de carrera creíbles (s/km): de 2:30 /km (más rápido es un error de datos) a 20:00 /km (3 km/h, más lento que
 * caminar: casi siempre un tiempo mal apuntado, p. ej. 31 min escritos en la casilla de las horas). Los usan
 * race-predict (qué esfuerzos cuentan) y el aviso del formulario de actividad.
 */
export const RUN_PACE_MIN = 150;
export const RUN_PACE_MAX = 1200;
/** km/h */
export function speed(sec, km) {
  return km > 0 && sec > 0 ? km / (sec / 3600) : null;
}
/** s/100 m */
export function pace100(sec, km) {
  return km > 0 && sec > 0 ? sec / (km * 10) : null;
}
/** Riegel: tiempo estimado en d2 a partir de t1 en d1. */
export function riegel(t1, d1, d2, k = 1.06) {
  if (!(t1 > 0 && d1 > 0 && d2 > 0)) return null;
  return t1 * (d2 / d1) ** k;
}

// ---------------------------------------------------------------------------
// Series temporales
// ---------------------------------------------------------------------------

/** Media móvil de `days` días naturales. points: [{date, value}] (se ordenan). */
export function movingAverage(points, days = 7) {
  const sorted = sortBy(points.filter((p) => p && p.value != null), 'date');
  return sorted.map((p, i) => {
    let t = 0;
    let n = 0;
    for (let j = i; j >= 0; j--) {
      if (diffDays(sorted[j].date, p.date) >= days) break;
      t += sorted[j].value;
      n++;
    }
    return { ...p, ma: t / n };
  });
}

/** Regresión lineal simple. Devuelve { slope, intercept, r2, n, seSlope } o null. */
export function linearRegression(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0; let sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n; const my = sy / n;
  let sxx = 0; let sxy = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx; const dy = ys[i] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) { const e = ys[i] - (intercept + slope * xs[i]); sse += e * e; }
  const r2 = syy === 0 ? 1 : 1 - sse / syy;
  const seSlope = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : null;
  return { slope, intercept, r2, n, seSlope };
}

/** Días desde una fecha de referencia (para regresiones por fecha). */
export function dayIndex(date, ref = '2000-01-01') {
  return diffDays(ref, date);
}

// ---------------------------------------------------------------------------
// Historial por ejercicio: «última vez», mejores marcas y récords
// ---------------------------------------------------------------------------

function sessionOrderKey(s) {
  return `${s.date}|${String(s.startedAt || s.createdAt || 0).padStart(15, '0')}`;
}

/**
 * Última sesión (terminada o no, distinta de la actual) en la que se hizo el ejercicio
 * con al menos una serie hecha. Devuelve { session, sessionExercise, sets } o null.
 * `sets` = series hechas (incluye calentamientos) en su orden.
 */
export function lastPerformance(sessions, exerciseId, { excludeSessionId = null, beforeKey = null } = {}) {
  let best = null;
  let bestKey = '';
  for (const s of sessions) {
    if (s.kind !== 'strength' || s.id === excludeSessionId) continue;
    const key = sessionOrderKey(s);
    if (beforeKey && key >= beforeKey) continue;
    if (key <= bestKey) continue;
    const se = (s.exercises || []).find((e) => e.exerciseId === exerciseId && (e.sets || []).some((x) => x.done));
    if (!se) continue;
    best = { session: s, sessionExercise: se, sets: se.sets.filter((x) => x.done) };
    bestKey = key;
  }
  return best;
}

export function orderKeyOf(session) {
  return sessionOrderKey(session);
}

function weightKey(w) {
  return String(round(w ?? 0, 0.25));
}

/**
 * Estructura vacía de mejores marcas.
 *  count  = series de trabajo incorporadas (incluidas las de la sesión en curso, vía addToBests)
 *  prior  = series del historial ANTERIOR (lo fija bestsForExercise; addToBests no lo toca). Sin historial
 *           previo no hay récords, tampoco entre las series de la primera sesión con el ejercicio.
 *  bwFront = peso corporal: frente de pares {w: lastre, r: reps+RIR} para comparar el 1RM estimado con el
 *           peso corporal del DÍA (si solo sube el peso corporal, no es récord).
 */
export function emptyBests() {
  return { count: 0, prior: null, maxLoad: null, maxWeight: null, maxE1rm: null, repsAtWeight: {}, maxReps: null, maxTime: null, maxHeight: null, bestTimeAtDist: {}, maxVolumeSet: null, bwFront: [] };
}

/** 1RM (Epley) con repeticiones efectivas ya sumadas (reps + RIR). */
function e1rmFromEffective(load, r) {
  if (!(load > 0) || !(r >= 1)) return null;
  return r <= 1 ? load : load * (1 + r / 30);
}

/** Mejor 1RM estimado del historial de un ejercicio de peso corporal, recalculado con el peso corporal `bwKg`. */
function bwFrontE1rm(front, bwKg) {
  let best = null;
  for (const p of front || []) {
    const v = e1rmFromEffective(bwKg + p.w, p.r);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/** Incorpora una serie de trabajo a las mejores marcas (muta y devuelve `bests`). */
export function addToBests(bests, set, exercise, bwKg = null) {
  if (!isWorkSet(set) || !exercise) return bests;
  const m = setMetrics(set, exercise, bwKg);
  bests.count++;
  const t = exercise.logType;
  if (t === 'weight_reps' || t === 'unilateral' || t === 'bodyweight') {
    const w = t === 'bodyweight' ? (set.weight || 0) : set.weight;
    if (w != null) {
      if (bests.maxWeight == null || w > bests.maxWeight) bests.maxWeight = w;
      if (m.reps != null) {
        const k = weightKey(w);
        if (bests.repsAtWeight[k] == null || m.reps > bests.repsAtWeight[k]) bests.repsAtWeight[k] = m.reps;
      }
    }
    if (m.load != null && (bests.maxLoad == null || m.load > bests.maxLoad)) bests.maxLoad = m.load;
    if (m.e1rm != null && (bests.maxE1rm == null || m.e1rm > bests.maxE1rm)) bests.maxE1rm = m.e1rm;
    if (t === 'bodyweight' && m.e1rm != null) {
      // Frente de Pareto (lastre, reps efectivas): basta para recalcular el mejor 1RM con cualquier peso corporal.
      const p = { w: set.weight || 0, r: m.reps + (rirValue(set.rir) ?? 0) };
      const front = bests.bwFront || (bests.bwFront = []);
      if (!front.some((q) => q.w >= p.w && q.r >= p.r)) {
        bests.bwFront = front.filter((q) => !(p.w >= q.w && p.r >= q.r));
        bests.bwFront.push(p);
      }
    }
    if (m.volume != null && (bests.maxVolumeSet == null || m.volume > bests.maxVolumeSet)) bests.maxVolumeSet = m.volume;
  }
  if (m.reps != null && (bests.maxReps == null || m.reps > bests.maxReps)) bests.maxReps = m.reps;
  if (t === 'time' && set.timeSec > 0 && (bests.maxTime == null || set.timeSec > bests.maxTime)) bests.maxTime = set.timeSec;
  if (t === 'jumps' && set.heightCm > 0 && (bests.maxHeight == null || set.heightCm > bests.maxHeight)) bests.maxHeight = set.heightCm;
  if (t === 'distance_time' && set.distanceM > 0 && set.timeSec > 0) {
    const k = String(set.distanceM);
    if (bests.bestTimeAtDist[k] == null || set.timeSec < bests.bestTimeAtDist[k]) bests.bestTimeAtDist[k] = set.timeSec;
  }
  return bests;
}

/**
 * Mejores marcas de un ejercicio en el historial (series de trabajo, sin calentamientos).
 * opts.excludeSessionId: excluye una sesión (la actual). opts.bwFn: date → kg.
 */
export function bestsForExercise(sessions, exerciseId, exercise, { excludeSessionId = null, bwFn = () => null } = {}) {
  const bests = emptyBests();
  for (const s of sessions) {
    if (s.kind !== 'strength' || s.id === excludeSessionId) continue;
    for (const se of s.exercises || []) {
      if (se.exerciseId !== exerciseId) continue;
      for (const set of se.sets || []) addToBests(bests, set, exercise, bwFn(s.date));
    }
  }
  bests.prior = bests.count;
  return bests;
}

/**
 * Récords que bate `set` frente a `bests` (solo si ya había historial ANTERIOR a la sesión: `bests.prior`;
 * en la primera sesión con un ejercicio no hay récords, aunque una serie supere a otra del mismo día).
 * Devuelve [{kind:'weight'|'e1rm'|'reps'|'time'|'height', value, prev}]
 *  - weight: más peso (en peso corporal: más lastre / menos asistencia)
 *  - e1rm:   mayor 1RM estimado (en peso corporal, comparando con el peso corporal de hoy en todas las series)
 *  - reps:   más repeticiones con ese mismo peso
 *  - time:   más tiempo (tipo tiempo) o menos tiempo a igual distancia (sprints)
 *  - height: salto más alto
 */
export function detectPRs(set, exercise, bests, bwKg = null) {
  const out = [];
  if (!isWorkSet(set) || !exercise || !bests || bests.count === 0) return out;
  if ((bests.prior ?? bests.count) === 0) return out;
  const m = setMetrics(set, exercise, bwKg);
  const t = exercise.logType;
  if (t === 'weight_reps' || t === 'unilateral' || t === 'bodyweight') {
    const w = t === 'bodyweight' ? (set.weight || 0) : set.weight;
    if (w != null && bests.maxWeight != null && w > bests.maxWeight && (m.reps ?? 0) >= 1) out.push({ kind: 'weight', value: w, prev: bests.maxWeight });
    const prevE1rm = t === 'bodyweight' && bests.bwFront && bwKg != null ? bwFrontE1rm(bests.bwFront, bwKg) : bests.maxE1rm;
    if (m.e1rm != null && prevE1rm != null && m.e1rm > prevE1rm + 1e-9) out.push({ kind: 'e1rm', value: m.e1rm, prev: prevE1rm });
    if (w != null && m.reps != null) {
      const prev = bests.repsAtWeight[weightKey(w)];
      if (prev != null && m.reps > prev) out.push({ kind: 'reps', value: m.reps, prev, weight: w });
    }
  } else if (t === 'time') {
    if (set.timeSec > 0 && bests.maxTime != null && set.timeSec > bests.maxTime) out.push({ kind: 'time', value: set.timeSec, prev: bests.maxTime });
  } else if (t === 'jumps') {
    if (set.heightCm > 0 && bests.maxHeight != null && set.heightCm > bests.maxHeight) out.push({ kind: 'height', value: set.heightCm, prev: bests.maxHeight });
  } else if (t === 'distance_time') {
    const prev = bests.bestTimeAtDist[String(set.distanceM)];
    if (set.timeSec > 0 && prev != null && set.timeSec < prev) out.push({ kind: 'time', value: set.timeSec, prev, distanceM: set.distanceM });
  }
  return out;
}

/**
 * Marca los récords de todas las series de una sesión, en orden, comparando con el
 * historial ANTERIOR a esa sesión más las series previas de la misma sesión.
 * Devuelve Map(setId → [récords]).
 */
export function sessionPRs(session, sessions, exMap, bwFn = () => null) {
  const out = new Map();
  const key = sessionOrderKey(session);
  const earlier = sessions.filter((s) => s.kind === 'strength' && s.id !== session.id && sessionOrderKey(s) < key);
  const bestsCache = new Map();
  for (const se of session.exercises || []) {
    const ex = exMap.get ? exMap.get(se.exerciseId) : exMap[se.exerciseId];
    if (!ex) continue;
    if (!bestsCache.has(se.exerciseId)) bestsCache.set(se.exerciseId, bestsForExercise(earlier, se.exerciseId, ex, { bwFn }));
    const bests = bestsCache.get(se.exerciseId);
    const bw = bwFn(session.date);
    for (const set of se.sets || []) {
      if (!isWorkSet(set)) continue;
      const prs = detectPRs(set, ex, bests, bw);
      if (prs.length) out.set(set.id, prs);
      addToBests(bests, set, ex, bw);
    }
  }
  return out;
}

/**
 * Mejor serie de una lista de series: por 1RM estimado. Si ninguna lo tiene, en los tipos con carga
 * (peso × reps, unilateral, peso corporal) la de más peso × reps (setMetrics.volume: unilateral, los dos lados;
 * peso corporal, con el peso del día) y, a igualdad, la de más peso levantado (peso corporal: el lastre) y luego
 * más reps: la misma regla que stats.js (fallbackRank). Tiempo: la más larga; saltos: la más alta (o más reps);
 * distancia+tiempo: la más rápida (m/s; sin tiempo, la más larga).
 */
export function bestSet(sets, exercise, bwKg = null) {
  let best = null;
  let bestVal = -Infinity;
  let bestRank = null;
  const t = exercise?.logType;
  const withLoad = t === 'weight_reps' || t === 'unilateral' || t === 'bodyweight';
  // Si alguna serie tiene 1RM estimado, se compara SOLO por 1RM (no se mezcla con reps de otras series).
  const anyE1rm = (sets || []).some((s) => isWorkSet(s) && setMetrics(s, exercise, bwKg).e1rm != null);
  for (const s of sets || []) {
    if (!isWorkSet(s)) continue;
    const m = setMetrics(s, exercise, bwKg);
    if (!anyE1rm && withLoad) {
      if (!(m.reps >= 1)) continue;
      const lifted = typeof s.weight === 'number' ? s.weight : t === 'bodyweight' ? 0 : null;
      const rank = [m.volume ?? -Infinity, lifted ?? -Infinity, m.reps];
      if (!bestRank || rankGreater(rank, bestRank)) { bestRank = rank; best = s; }
      continue;
    }
    let val;
    if (anyE1rm) val = m.e1rm;
    else if (t === 'time') val = s.timeSec;
    else if (t === 'jumps') val = s.heightCm || s.reps;
    else if (t === 'distance_time') val = s.distanceM > 0 && s.timeSec > 0 ? s.distanceM / s.timeSec : s.distanceM;
    else val = m.reps;
    if (typeof val !== 'number' || !Number.isFinite(val)) continue;
    if (val > bestVal) { bestVal = val; best = s; }
  }
  return best;
}

/** a > b en orden lexicográfico, con tolerancia (a igualdad, la primera serie gana). */
function rankGreater(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i] + 1e-9) return true;
    if (a[i] < b[i] - 1e-9) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Semanas
// ---------------------------------------------------------------------------
/** Lista de lunes desde `from` hasta `to` (ambos incluidos, por semanas). */
export function weeksBetween(from, to) {
  const out = [];
  let w = weekStart(from);
  const end = weekStart(to);
  while (w <= end) { out.push(w); w = addDays(w, 7); }
  return out;
}

export function weekOf(date) {
  return weekStart(date);
}

export function isValidDateOrder(a, b) {
  return parseDate(a) <= parseDate(b);
}
