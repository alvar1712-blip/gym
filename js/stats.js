// stats.js — estadísticas y récords de la Fase 2 (progreso, gráficas, récords, adherencia).
// PROPIETARIO: módulo de estadísticas. PURO: no lee el store ni toca el DOM; recibe los datos por parámetro
// y se prueba en Node (tests/unit/stats.test.mjs). Reutiliza calc.js (1RM, métricas de serie, carga…),
// activity-logic.js (media móvil y tendencia del peso), plan.js (adherencia del Calendario) y
// session-logic.formatSet (texto de una serie). plan.js y session-logic.js importan store.js, pero aquí
// solo se usan sus funciones puras (el import es inocuo en Node: no abre IndexedDB).
//
// ENTRADA COMÚN `data` (la construye la vista una vez por render; ver dataFromStore en docs/FASE2.md):
//   { sessions: [...store.all('sessions')],                      // fuerza y actividades, cualquier estado
//     exercises: Map(id → ejercicio) | array | objeto,
//     templates: Map | array, plan: Map | array,                   // solo para la adherencia
//     settings, bodyweight: store.bodyweightList(), today: 'YYYY-MM-DD',
//     createdAt?: store.get('meta','app')?.createdAt,             // para que la adherencia coincida con el Calendario
//     since?: 'YYYY-MM-DD', planCtx?: plan.ctxFromStore() }       // alternativas a createdAt
//
// REGLAS: solo sesiones `status:'done'`; series de trabajo (calc.isWorkSet): nunca calentamientos ni pendientes;
// 1RM = calc.e1rm (Epley con reps + RIR, solo 1–12 reps); peso corporal: carga = peso corporal del día
// (calc.makeBodyweightFn con settings.bodyweightDefault) + lastre; carga = calc.sessionLoad (min × RPE) para
// todas las actividades; semanas de lunes; ritmos semanales ponderados por distancia (Σ tiempo / Σ km).
//
// RENDIMIENTO: todo se apoya en un índice (sesiones terminadas ordenadas, series de trabajo por ejercicio,
// actividades por deporte, agregados por semana) que se construye UNA vez por objeto `data` y se reutiliza
// en las llamadas siguientes con el mismo objeto (WeakMap). Si cambian los datos, construye un `data` nuevo
// (o llama a buildIndex(data) para forzar la reconstrucción). No mutes los objetos devueltos.
import { weekStart, addDays, diffDays, todayStr, isDateStr, fmtDuration, fmtPace, fmtMinutes, fmtSigned, normalize, round } from './util.js';
import {
  isWorkSet, setMetrics, makeBodyweightFn, sessionLoad, sessionDurationMin, sessionVolume, sessionMuscleSets,
  pace, speed, pace100, movingAverage, bestSet as calcBestSet, weeksBetween, orderKeyOf, emptyBests, addToBests,
  detectPRs,
} from './calc.js';
import { bwPoints, bwTrend } from './activity-logic.js';
import { makeCtx, adherence, adherenceText, trackingSince } from './plan.js';
import { formatSet, fmtLastre, fmtSec, LOAD_REP_TYPES } from './session-logic.js';
import { MUSCLES, MUSCLE_LABEL } from './seed.js';

// ===========================================================================
// Constantes
// ===========================================================================

/** Tipos de sesión para la carga (las desconocidas cuentan como 'other'). */
export const KINDS = ['strength', 'run', 'bike', 'swim', 'other'];
/** Deportes con distancia. */
export const DISTANCE_KINDS = ['run', 'bike', 'swim'];
/** Distancias de los récords de carrera (km). */
export const RACE_DISTANCES = [
  { id: '5k', km: 5, label: '5 km' },
  { id: '10k', km: 10, label: '10 km' },
  { id: 'half', km: 21.0975, label: 'Media maratón' },
  { id: 'marathon', km: 42.195, label: 'Maratón' },
];
/** Una carrera más larga que la distancia × 1,02 da un tiempo «estimado a ritmo medio». */
export const ESTIMATE_FACTOR = 1.02;

const EPS = 1e-9;
const kindOf = (s) => (KINDS.includes(s.kind) ? s.kind : 'other');
const zeroKinds = () => ({ strength: 0, run: 0, bike: 0, swim: 0, other: 0 });
const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);
/** Segundos de una actividad: tiempo en movimiento o, en registros antiguos, la duración. */
const actSec = (a) => (a.movingSec > 0 ? a.movingSec : a.durationMin > 0 ? a.durationMin * 60 : null);
/** Misma clave de peso que calc.js (repsAtWeight): redondeo a 0,25 kg. */
const weightKey = (w) => String(round(w ?? 0, 0.25));

// ===========================================================================
// Formato (es-ES)
// ===========================================================================

const NF = new Map();
/**
 * Igual que util.fmtNum (misma salida: Number#toLocaleString('es-ES') equivale por especificación a
 * Intl.NumberFormat con las mismas opciones) pero reutilizando el formateador: toLocaleString crea uno en
 * cada llamada (~20 µs) y las gráficas formatean cientos de etiquetas.
 */
export function fmtNumFast(n, dec = 1, minDec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const key = `${dec}|${minDec}`;
  let f = NF.get(key);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec, minimumFractionDigits: minDec, useGrouping: true });
    NF.set(key, f);
  }
  return f.format(n);
}
const num = fmtNumFast;

/** Texto de un peso según el tipo: «80 kg»; peso corporal: «+10 kg», «−15 kg asist.», «Sin lastre». */
export function weightLabel(logType, w) {
  if (logType === 'bodyweight') return fmtLastre(w) || 'Sin lastre';
  return w == null ? '—' : `${num(w, 2)} kg`;
}

/** Texto de una distancia: carrera y bici en km, natación en metros. */
export function distanceLabel(kind, km) {
  if (km == null || !Number.isFinite(km)) return '—';
  if (kind === 'swim') return `${num(km * 1000, 0)} m`;
  return `${num(km, kind === 'run' ? 2 : 1)} km`;
}

/**
 * Formato de una métrica (etiquetas de gráficas y tablas):
 *  volume «12.500 kg» · kg «82,5 kg» · load «350» · km.run «25,3 km» · km.swim «1500 m» · runPace «5:12 /km»
 *  bikeSpeed «28,3 km/h» · swimPace «2:00 /100 m» · sets «12,5 series» · minutes «1 h 05 min» · sessions «3 sesiones»
 */
export function fmtMetric(metric, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  switch (metric) {
    case 'volume': return `${num(v, 0)} kg`;
    case 'kg': return `${num(v, 1)} kg`;
    case 'load': return num(v, 0);
    case 'km.run': return `${num(v, 1)} km`;
    case 'km.bike': return `${num(v, 1)} km`;
    case 'km.swim': return `${num(v * 1000, 0)} m`;
    case 'runPace': return fmtPace(v);
    case 'bikeSpeed': return `${num(v, 1)} km/h`;
    case 'swimPace': return fmtPace(v, '/100 m');
    case 'sets': return `${num(v, 1)} ${v === 1 ? 'serie' : 'series'}`;
    case 'minutes': return fmtMinutes(v);
    case 'sessions': return `${num(v, 0)} ${v === 1 ? 'sesión' : 'sesiones'}`;
    default: return num(v, 1);
  }
}

// ===========================================================================
// Índice
// ===========================================================================

const CACHE = new WeakMap();
const SRC_KEYS = ['sessions', 'exercises', 'templates', 'plan', 'settings', 'bodyweight', 'today', 'createdAt', 'since', 'planCtx'];

const toMap = (x) => {
  if (x instanceof Map) return x;
  if (Array.isArray(x)) return new Map(x.filter(Boolean).map((o) => [o.id, o]));
  return new Map(Object.entries(x || {}));
};

function isFresh(idx, d) {
  if (SRC_KEYS.some((k) => idx.src[k] !== d[k])) return false;
  return idx.src.sessionsLen === (d.sessions?.length ?? 0) && idx.src.bodyweightLen === (d.bodyweight?.length ?? 0);
}

/**
 * Construye (y cachea para este objeto `data`) el índice que usan todas las funciones. No hace falta llamarla:
 * cada función lo obtiene sola; sirve para precalentar o para forzar la reconstrucción si mutaste `data`.
 * @returns {object} índice opaco (no dependas de su forma)
 */
export function buildIndex(data) {
  const d = data || {};
  const settings = d.settings || {};
  const sessions = Array.isArray(d.sessions) ? d.sessions : [];
  const exMap = toMap(d.exercises);
  // makeBodyweightFn recorre la lista en cada llamada: se memoriza por fecha.
  const baseBw = makeBodyweightFn(d.bodyweight || [], settings.bodyweightDefault ?? 75);
  const bwCache = new Map();
  const bwFn = (date) => {
    let v = bwCache.get(date);
    if (v === undefined) { v = baseBw(date); bwCache.set(date, v); }
    return v;
  };

  // Sesiones terminadas en orden cronológico (fecha y hora de inicio, como calc.orderKeyOf).
  const keyed = [];
  for (const s of sessions) if (s && s.status === 'done' && isDateStr(s.date)) keyed.push({ s, k: orderKeyOf(s) });
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const done = keyed.map((x) => x.s);

  // Series de trabajo por ejercicio: una entrada por sesión (un ejercicio repetido en la sesión se une).
  const byExercise = new Map();
  const activities = { run: [], bike: [], swim: [], other: [] };
  for (const s of done) {
    if (s.kind === 'strength') {
      const local = new Map();
      for (const se of s.exercises || []) {
        if (!se || !se.exerciseId) continue;
        const work = (se.sets || []).filter(isWorkSet);
        if (!work.length) continue;
        const e = local.get(se.exerciseId);
        if (e) e.sets.push(...work);
        else local.set(se.exerciseId, { session: s, sets: work });
      }
      for (const [id, e] of local) {
        if (!byExercise.has(id)) byExercise.set(id, []);
        byExercise.get(id).push(e);
      }
    } else {
      activities[kindOf(s)].push(s); // carrera, bici, natación u otra (desconocida → otra)
    }
  }

  let firstBodyweight = null;
  let lastBodyweight = null;
  for (const b of d.bodyweight || []) {
    if (!b || !(b.kg > 0) || !isDateStr(b.id)) continue;
    if (!firstBodyweight || b.id < firstBodyweight) firstBodyweight = b.id;
    if (!lastBodyweight || b.id > lastBodyweight) lastBodyweight = b.id;
  }

  const src = Object.fromEntries(SRC_KEYS.map((k) => [k, d[k]]));
  src.sessionsLen = d.sessions?.length ?? 0;
  src.bodyweightLen = d.bodyweight?.length ?? 0;
  const idx = {
    src,
    data: d,
    settings,
    exMap,
    bwFn,
    today: d.today || todayStr(),
    done,
    byExercise,
    activities,
    firstSession: done.length ? done[0].date : null, // `done` va ordenado por fecha
    lastSession: done.length ? done[done.length - 1].date : null,
    firstBodyweight,
    lastBodyweight,
    weeks: null, // Map(lunes → agregado), perezoso
    hist: new Map(), // exerciseId → entradas de historial
    records: new Map(), // exerciseId → récord
    planCtx: null,
    setTxt: new Map(), // SetEntry → texto (por índice: si los datos cambian, el índice es otro)
  };
  if (data && typeof data === 'object') CACHE.set(data, idx);
  return idx;
}

function getIndex(data) {
  if (!data || typeof data !== 'object') return buildIndex({});
  const idx = CACHE.get(data);
  return idx && isFresh(idx, data) ? idx : buildIndex(data);
}

/** Texto de una serie con unidades («80 kg × 6 @2»), memorizado en el índice. */
function setLabel(idx, set, logType) {
  let t = idx.setTxt.get(set);
  if (t === undefined) {
    t = formatSet(set, logType, { kg: true });
    if (logType === 'bodyweight' && !set.weight) t = `Sin lastre · ${t}`;
    idx.setTxt.set(set, t);
  }
  return t;
}

/**
 * Rango de fechas con datos: { first, last, firstSession, lastSession, firstBodyweight, lastBodyweight }.
 * first = lo más antiguo entre sesiones terminadas y pesajes (para el periodo «Todo»).
 */
export function dataRange(data) {
  const idx = getIndex(data);
  const minD = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
  const maxD = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  return {
    first: minD(idx.firstSession, idx.firstBodyweight),
    last: maxD(idx.lastSession, idx.lastBodyweight),
    firstSession: idx.firstSession,
    lastSession: idx.lastSession,
    firstBodyweight: idx.firstBodyweight,
    lastBodyweight: idx.lastBodyweight,
  };
}

// ===========================================================================
// Ejercicios
// ===========================================================================

const collator = new Intl.Collator('es', { sensitivity: 'base' });
const byLastThenName = (a, b) => (a.lastDate === b.lastDate ? collator.compare(a.name || '', b.name || '') : a.lastDate < b.lastDate ? 1 : -1);

/**
 * Ejercicios con al menos una serie de trabajo en una sesión terminada, del usado más recientemente al más antiguo.
 * @returns {{exerciseId, name, logType, archived, sessions, workSets, firstDate, lastDate, exercise}[]}
 */
export function exercisesWithHistory(data) {
  const idx = getIndex(data);
  const out = [];
  for (const [id, entries] of idx.byExercise) {
    const ex = idx.exMap.get(id);
    if (!ex || ex.logType === 'cardio') continue;
    let workSets = 0;
    for (const e of entries) workSets += e.sets.length;
    out.push({
      exerciseId: id, name: ex.name || id, logType: ex.logType, archived: !!ex.archived, sessions: entries.length, workSets,
      firstDate: entries[0].session.date, lastDate: entries[entries.length - 1].session.date, exercise: ex,
    });
  }
  return out.sort(byLastThenName);
}

/** Filtra la lista de exercisesWithHistory por texto (nombre o alias, sin tildes ni mayúsculas). */
export function searchExercises(list, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((it) => {
    const hay = normalize([it.name, ...((it.exercise && it.exercise.aliases) || [])].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** Peso «levantado» de una serie para peso máximo / reps a un peso: peso corporal → lastre (0 si no hay). */
function liftedWeight(set, logType) {
  if (logType === 'bodyweight') return typeof set.weight === 'number' ? set.weight : 0;
  return typeof set.weight === 'number' ? set.weight : null;
}

/**
 * Orden de la «mejor serie» cuando ninguna serie de la sesión tiene 1RM estimado (todas de más de 12 reps o sin
 * peso) en los tipos con carga: más peso × reps (calc.setMetrics: unilateral, los dos lados; peso corporal, con
 * el peso corporal del día); a igualdad, más peso levantado y luego más reps. `m` = calc.setMetrics de la serie,
 * `w` = liftedWeight. Devuelve null si no es comparable (sin reps).
 */
function fallbackRank(m, w) {
  return m.reps >= 1 ? [m.volume ?? -Infinity, w ?? -Infinity, m.reps] : null;
}
/** a > b (lexicográfico, con tolerancia). */
function rankGt(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i] + EPS) return true;
    if (a[i] < b[i] - EPS) return false;
  }
  return false;
}

/** Entradas de historial (asc) de un ejercicio, sin textos por serie. Cacheadas en el índice. */
function historyOf(idx, exerciseId) {
  const cached = idx.hist.get(exerciseId);
  if (cached) return cached;
  const list = [];
  const ex = idx.exMap.get(exerciseId);
  const entries = idx.byExercise.get(exerciseId) || [];
  if (ex && ex.logType !== 'cardio') {
    const lt = ex.logType;
    const isBw = lt === 'bodyweight';
    const load = LOAD_REP_TYPES.includes(lt);
    const bests = emptyBests(); // récords batidos en cada sesión: misma regla que el resumen (calc.sessionPRs)
    for (const e of entries) {
      const s = e.session;
      const bw = isBw ? idx.bwFn(s.date) : null;
      bests.prior = bests.count;
      const prs = [];
      let maxWeight = null; let maxWeightSet = null; let maxWeightReps = 0;
      let e1 = null; let e1Set = null;
      let fbSet = null; let fbRank = null;
      let vol = 0; let hasVol = false;
      let maxReps = null; let maxTime = null; let maxHeight = null;
      const sprints = {};
      for (const set of e.sets) {
        for (const pr of detectPRs(set, ex, bests, bw)) if (!prs.includes(pr.kind)) prs.push(pr.kind);
        addToBests(bests, set, ex, bw);
        const m = setMetrics(set, ex, bw);
        if (load) {
          const w = liftedWeight(set, lt);
          if (w != null && m.reps >= 1) {
            if (maxWeight == null || w > maxWeight + EPS || (Math.abs(w - maxWeight) <= EPS && m.reps > maxWeightReps)) {
              maxWeight = w; maxWeightSet = set; maxWeightReps = m.reps;
            }
          }
          if (m.e1rm != null && (e1 == null || m.e1rm > e1 + EPS)) { e1 = m.e1rm; e1Set = set; }
          if (m.volume != null) { vol += m.volume; hasVol = true; }
          const rk = fallbackRank(m, w);
          if (rk && (!fbRank || rankGt(rk, fbRank))) { fbRank = rk; fbSet = set; }
        }
        if (m.reps != null && m.reps >= 1 && (maxReps == null || m.reps > maxReps)) maxReps = m.reps;
        if (lt === 'time' && set.timeSec > 0 && (maxTime == null || set.timeSec > maxTime)) maxTime = set.timeSec;
        if (lt === 'jumps' && set.heightCm > 0 && (maxHeight == null || set.heightCm > maxHeight)) maxHeight = set.heightCm;
        if (lt === 'distance_time' && set.distanceM > 0 && set.timeSec > 0) {
          const k = String(set.distanceM);
          if (sprints[k] == null || set.timeSec < sprints[k]) sprints[k] = set.timeSec;
        }
      }
      // Mejor serie: la de mayor 1RM estimado; si ninguna lo tiene (p. ej. todas de más de 12 reps), en los tipos
      // con carga la de más peso × reps (fallbackRank); en los demás, calc.bestSet.
      const best = e1Set || (load ? fbSet : null) || calcBestSet(e.sets, ex, bw);
      list.push({
        date: s.date,
        sessionId: s.id,
        templateName: s.templateName || 'Sesión libre',
        logType: lt,
        sets: e.sets,
        workSets: e.sets.length,
        maxWeight,
        maxWeightSet,
        maxWeightLabel: maxWeightSet ? setLabel(idx, maxWeightSet, lt) : null,
        e1rm: e1,
        e1rmSet: e1Set,
        bestSet: best,
        bestSetLabel: best ? setLabel(idx, best, lt) : null,
        volume: hasVol ? round(vol, 0.01) : null,
        maxReps,
        maxTime,
        maxHeight,
        sprints,
        bw,
        prs,
      });
    }
  }
  idx.hist.set(exerciseId, list);
  return list;
}

/**
 * Historial de un ejercicio en sesiones terminadas, de la más antigua a la más reciente (una fila por sesión;
 * un ejercicio repetido en la misma sesión se une). Solo series de trabajo.
 * @param {object} data
 * @param {string} exerciseId
 * @param {{labels?:boolean}} [opts] labels=false omite setLabels/summary (más rápido si no pintas la lista)
 * @returns {{date, sessionId, templateName, logType, sets, workSets, setLabels, summary,
 *   maxWeight, maxWeightLabel, e1rm, bestSet, bestSetLabel, volume, maxReps, maxTime, maxHeight,
 *   sprints:{[distanceM]:timeSec}, bw, prs:string[]}[]}
 *  maxWeight: peso corporal → lastre (negativo = asistencia); tipos sin carga → null.
 *  e1rm: mayor 1RM estimado de la sesión (null si ninguna serie de 1–12 reps con carga).
 *  bestSet: la serie de mayor 1RM estimado; si ninguna lo tiene, en los tipos con carga la de más peso × reps
 *           (a igualdad, más peso y luego más reps) y en los demás calc.bestSet. Es la de exerciseSeries().bestSet.
 *  bw: peso corporal usado ese día (solo en ejercicios de peso corporal; en los demás, null).
 *  prs: récords batidos en esa sesión frente al historial anterior ('weight','e1rm','reps','time','height'),
 *       con la misma regla que el resumen de la sesión (calc.detectPRs; la primera sesión nunca marca).
 */
export function exerciseHistory(data, exerciseId, { labels = true } = {}) {
  const idx = getIndex(data);
  const list = historyOf(idx, exerciseId);
  if (!labels) return list.slice();
  return list.map((e) => {
    const setLabels = e.sets.map((s) => formatSet(s, e.logType));
    return { ...e, setLabels, summary: setLabels.join(' · ') };
  });
}

/**
 * Series para las gráficas de un ejercicio desde `from` (incluido; null = todo) hasta `to` (opcional).
 * Un punto por día (si hay dos sesiones el mismo día se toma lo mejor y el volumen se suma).
 * Puntos {x:'YYYY-MM-DD', y, label, sessionId}. Arrays vacíos si no aplican al tipo.
 * @returns {{logType, maxWeight, e1rm, bestSet, volume, maxReps, maxTime, maxHeight,
 *            sprint:{distanceM, label, points}[]}}
 *  maxWeight: y = kg (peso corporal: lastre); label = la serie más pesada «80 kg × 6 @2».
 *  e1rm:      y = 1RM estimado; label «96,5 kg · 80 kg × 6 @2» (estimación; en peso corporal, que incluye el
 *             peso corporal del día: «100,8 kg · +10 kg × 5 @1 · peso corporal 74 kg»).
 *  bestSet:   carga × reps → la mejor serie del día: la de mayor 1RM estimado o, si ninguna serie tiene 1RM
 *             (todas de más de 12 reps), la de más peso × reps (a igualdad, más peso y luego más reps).
 *             y = peso levantado de esa serie (kg; peso corporal: lastre, 0 = sin lastre, negativo = asistencia),
 *             label = la serie entera «80 kg × 6 @2», reps (unilateral: el lado con menos) y e1rm (null si no
 *             aplica) de esa serie. Tiempo → y = segundos; saltos → y = cm (solo con altura).
 *  volume:    y = kg × reps de la sesión; maxReps: y = reps (unilateral: el lado con menos);
 *  maxTime:   y = s («1:30 min»); maxHeight: y = cm; sprint: por distancia (label de la serie «20 m»),
 *             y = s (menos es mejor), label del punto solo el tiempo «3,24 s».
 *  Las etiquetas de punto llevan solo el valor, nunca el nombre de la serie (el globo ya lo muestra).
 */
export function exerciseSeries(data, exerciseId, from = null, to = null) {
  const idx = getIndex(data);
  const ex = idx.exMap.get(exerciseId);
  const lt = ex ? ex.logType : null;
  const out = { logType: lt, maxWeight: [], e1rm: [], bestSet: [], volume: [], maxReps: [], maxTime: [], maxHeight: [], sprint: [] };
  const hist = historyOf(idx, exerciseId).filter((e) => inRange(e.date, from, to));
  const groups = [];
  for (const e of hist) {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  // Entrada del día con el mayor valor de `key` (empate: la primera sesión del día).
  const pick = (items, key) => {
    let best = null;
    for (const e of items) {
      const v = e[key];
      if (v != null && (best == null || v > best[key] + EPS)) best = e;
    }
    return best;
  };
  const load = LOAD_REP_TYPES.includes(lt);
  const perSide = lt === 'unilateral' ? ' por lado' : '';
  const sprintMap = new Map();
  for (const { date: x, items } of groups) {
    if (load) {
      const mw = pick(items, 'maxWeight');
      if (mw) out.maxWeight.push({ x, y: mw.maxWeight, label: mw.maxWeightLabel, sessionId: mw.sessionId });
      const e1 = pick(items, 'e1rm');
      if (e1) {
        const txt = setLabel(idx, e1.e1rmSet, lt);
        const bwTxt = lt === 'bodyweight' ? ` · peso corporal ${num(e1.bw, 1)} kg` : '';
        out.e1rm.push({ x, y: e1.e1rm, label: `${num(e1.e1rm, 1)} kg · ${txt}${bwTxt}`, sessionId: e1.sessionId });
      }
      // Mejor serie del día: la de la sesión con mayor 1RM; si ninguna tiene 1RM, la de más peso × reps.
      let bs = e1;
      if (!bs) {
        let bsRank = null;
        for (const e of items) {
          if (!e.bestSet) continue;
          const rk = fallbackRank(setMetrics(e.bestSet, ex, e.bw), liftedWeight(e.bestSet, lt));
          if (rk && (!bsRank || rankGt(rk, bsRank))) { bsRank = rk; bs = e; }
        }
      }
      const bsW = bs ? liftedWeight(bs.bestSet, lt) : null;
      if (bsW != null) {
        const m = setMetrics(bs.bestSet, ex, bs.bw);
        out.bestSet.push({ x, y: bsW, label: setLabel(idx, bs.bestSet, lt), sessionId: bs.sessionId, reps: m.reps, e1rm: m.e1rm });
      }
      let vol = 0; let sid = null;
      for (const e of items) if (e.volume != null) { vol += e.volume; sid = sid || e.sessionId; }
      if (vol > 0) out.volume.push({ x, y: round(vol, 0.01), label: fmtMetric('volume', vol), sessionId: sid });
    }
    const mr = pick(items, 'maxReps');
    if (mr) out.maxReps.push({ x, y: mr.maxReps, label: `${num(mr.maxReps, 0)} reps${perSide}`, sessionId: mr.sessionId });
    if (lt === 'time') {
      const mt = pick(items, 'maxTime');
      if (mt) {
        out.maxTime.push({ x, y: mt.maxTime, label: fmtSec(mt.maxTime), sessionId: mt.sessionId });
        out.bestSet.push({ x, y: mt.maxTime, label: setLabel(idx, mt.bestSet, lt), sessionId: mt.sessionId });
      }
    }
    if (lt === 'jumps') {
      const mh = pick(items, 'maxHeight');
      if (mh) {
        out.maxHeight.push({ x, y: mh.maxHeight, label: `${num(mh.maxHeight, 1)} cm`, sessionId: mh.sessionId });
        const best = mh.sets.find((s) => s.heightCm === mh.maxHeight) || mh.bestSet;
        out.bestSet.push({ x, y: mh.maxHeight, label: setLabel(idx, best, lt), sessionId: mh.sessionId });
      }
    }
    if (lt === 'distance_time') {
      const day = new Map();
      for (const e of items) {
        for (const [k, t] of Object.entries(e.sprints)) {
          const cur = day.get(k);
          if (!cur || t < cur.t) day.set(k, { t, sessionId: e.sessionId });
        }
      }
      for (const [k, { t, sessionId }] of day) {
        if (!sprintMap.has(k)) sprintMap.set(k, []);
        sprintMap.get(k).push({ x, y: t, label: `${num(t, 2)} s`, sessionId }); // la distancia es el nombre de la serie
      }
    }
  }
  out.sprint = [...sprintMap].map(([k, points]) => ({ distanceM: Number(k), label: `${num(Number(k), 1)} m`, points }))
    .sort((a, b) => a.distanceM - b.distanceM);
  return out;
}

// ===========================================================================
// Récords de fuerza
// ===========================================================================

/** Récord de un ejercicio (null si no tiene series de trabajo). Ver strengthRecords. */
function recordOf(idx, exerciseId) {
  if (idx.records.has(exerciseId)) return idx.records.get(exerciseId);
  const ex = idx.exMap.get(exerciseId);
  const entries = idx.byExercise.get(exerciseId) || [];
  if (!ex || ex.logType === 'cardio' || !entries.length) { idx.records.set(exerciseId, null); return null; }
  const lt = ex.logType;
  const isBw = lt === 'bodyweight';
  const load = LOAD_REP_TYPES.includes(lt);
  let bestWeight = null; let bestE1rm = null; let maxReps = null; let maxTime = null; let maxHeight = null;
  const atWeight = new Map(); // clave de peso → {weight, reps, date, sessionId, set}
  const sprint = new Map(); // distancia → {distanceM, timeSec, date, sessionId, set}
  let workSets = 0;
  for (const e of entries) {
    const s = e.session;
    const bw = isBw ? idx.bwFn(s.date) : null;
    for (const set of e.sets) {
      workSets++;
      const m = setMetrics(set, ex, bw);
      if (load) {
        const w = liftedWeight(set, lt);
        if (w != null && m.reps >= 1) {
          // Entre sesiones cuenta la primera vez; dentro de esa sesión, a igual peso, la serie con más reps
          // (como el «peso máximo» del historial y de la gráfica).
          const sameW = bestWeight && Math.abs(w - bestWeight.value) <= EPS;
          if (!bestWeight || w > bestWeight.value + EPS || (sameW && bestWeight.sessionId === s.id && m.reps > bestWeight.reps)) {
            bestWeight = { value: w, reps: m.reps, date: s.date, sessionId: s.id, set };
          }
          const k = weightKey(w);
          const cur = atWeight.get(k);
          if (!cur || m.reps > cur.reps) atWeight.set(k, { weight: cur ? cur.weight : w, reps: m.reps, date: s.date, sessionId: s.id, set });
        }
        if (m.e1rm != null && (!bestE1rm || m.e1rm > bestE1rm.value + EPS)) bestE1rm = { value: m.e1rm, date: s.date, sessionId: s.id, set, bw };
      }
      if (m.reps != null && m.reps >= 1 && (!maxReps || m.reps > maxReps.value)) maxReps = { value: m.reps, date: s.date, sessionId: s.id, set };
      if (lt === 'time' && set.timeSec > 0 && (!maxTime || set.timeSec > maxTime.value)) maxTime = { value: set.timeSec, date: s.date, sessionId: s.id, set };
      if (lt === 'jumps' && set.heightCm > 0 && (!maxHeight || set.heightCm > maxHeight.value)) maxHeight = { value: set.heightCm, date: s.date, sessionId: s.id, set };
      if (lt === 'distance_time' && set.distanceM > 0 && set.timeSec > 0) {
        const k = String(set.distanceM);
        const cur = sprint.get(k);
        if (!cur || set.timeSec < cur.timeSec - EPS) sprint.set(k, { distanceM: set.distanceM, timeSec: set.timeSec, date: s.date, sessionId: s.id, set });
      }
    }
  }
  const perSide = lt === 'unilateral' ? ' por lado' : '';
  const fin = (r, label) => {
    if (!r) return null;
    const { set, ...rest } = r;
    return { ...rest, setId: set.id ?? null, label, setLabel: setLabel(idx, set, lt) };
  };
  // Reps a cada peso, de más a menos peso; dominated = otro peso mayor tiene tantas reps o más.
  const repsAtWeight = [...atWeight.values()].sort((a, b) => b.weight - a.weight);
  let bestHeavier = -Infinity;
  const raw = repsAtWeight.map((r) => {
    const dominated = r.reps <= bestHeavier;
    bestHeavier = Math.max(bestHeavier, r.reps);
    return { weight: r.weight, reps: r.reps, date: r.date, sessionId: r.sessionId, setId: r.set.id ?? null, dominated, label: `${weightLabel(lt, r.weight)} × ${r.reps}${perSide}` };
  });
  const rec = {
    exerciseId,
    name: ex.name || exerciseId,
    logType: lt,
    archived: !!ex.archived,
    sessions: entries.length,
    workSets,
    firstDate: entries[0].session.date,
    lastDate: entries[entries.length - 1].session.date,
    bestWeight: load ? fin(bestWeight, bestWeight && weightLabel(lt, bestWeight.value)) : null,
    bestE1rm: load ? fin(bestE1rm, bestE1rm && `${num(bestE1rm.value, 1)} kg`) : null,
    // En peso corporal el 1RM incluye el peso corporal de ese día: la vista puede mostrarlo («peso corporal 74 kg»).
    bwLabel: isBw && bestE1rm ? `peso corporal ${num(bestE1rm.bw, 1)} kg` : null,
    repsAtWeight: load ? raw : [],
    maxReps: fin(maxReps, maxReps && `${num(maxReps.value, 0)} reps${perSide}`),
  };
  if (lt === 'time') rec.maxTime = fin(maxTime, maxTime && fmtSec(maxTime.value));
  if (lt === 'jumps') rec.maxHeight = fin(maxHeight, maxHeight && `${num(maxHeight.value, 1)} cm`);
  if (lt === 'distance_time') {
    rec.bestSprint = {};
    for (const k of [...sprint.keys()].sort((a, b) => Number(a) - Number(b))) {
      const r = sprint.get(k);
      rec.bestSprint[k] = fin(r, `${num(r.distanceM, 1)} m en ${num(r.timeSec, 2)} s`);
    }
  }
  idx.records.set(exerciseId, rec);
  return rec;
}

/**
 * Récords de fuerza de todos los ejercicios con historial (del usado más recientemente al más antiguo).
 * Cada valor lleva la fecha y la sesión de la PRIMERA vez que se alcanzó.
 * @returns {{exerciseId, name, logType, archived, sessions, workSets, firstDate, lastDate,
 *   bestWeight:{value, reps, date, sessionId, setId, label, setLabel}|null,   // peso corporal: lastre
 *   bestE1rm:{value, date, sessionId, setId, bw, label, setLabel}|null,      // bw: peso corporal del día
 *   bwLabel: 'peso corporal 74 kg'|null,                                      // solo peso corporal
 *   repsAtWeight:{weight, reps, date, sessionId, setId, dominated, label}[], // peso desc
 *   maxReps:{value, …}|null, maxTime?:{value(s), …}, maxHeight?:{value(cm), …},
 *   bestSprint?:{[distanceM]:{distanceM, timeSec, date, sessionId, setId, label, setLabel}}}[]}
 */
export function strengthRecords(data) {
  const idx = getIndex(data);
  const out = [];
  for (const id of idx.byExercise.keys()) {
    const r = recordOf(idx, id);
    if (r) out.push(r);
  }
  return out.sort(byLastThenName);
}

/** Récord de UN ejercicio (misma forma que un elemento de strengthRecords) o null. */
export function exerciseRecord(data, exerciseId) {
  return recordOf(getIndex(data), exerciseId);
}

/**
 * KPIs de la ficha de progreso de un ejercicio.
 * @returns {{exerciseId, name, logType, exercise, sessions, workSets, firstDate, lastDate, last, record}|null}
 *  last = última entrada del historial (con setLabels); record = exerciseRecord.
 */
export function exerciseSummary(data, exerciseId) {
  const idx = getIndex(data);
  const ex = idx.exMap.get(exerciseId);
  if (!ex) return null;
  const hist = historyOf(idx, exerciseId);
  const lastE = hist[hist.length - 1] || null;
  let workSets = 0;
  for (const e of hist) workSets += e.workSets;
  const last = lastE ? { ...lastE, setLabels: lastE.sets.map((s) => formatSet(s, lastE.logType)) } : null;
  if (last) last.summary = last.setLabels.join(' · ');
  return {
    exerciseId, name: ex.name || exerciseId, logType: ex.logType, exercise: ex, sessions: hist.length, workSets,
    firstDate: hist[0]?.date ?? null, lastDate: lastE?.date ?? null, last, record: recordOf(idx, exerciseId),
  };
}

// ===========================================================================
// Récords de resistencia
// ===========================================================================

/**
 * Récords de carrera, bici y natación (incluidas las actividades enlazadas a una sesión de fuerza).
 * @returns {{
 *   run:  { count, longest:{distanceKm, movingSec, date, sessionId, label}|null,
 *           best:{ '5k'|'10k'|'half'|'marathon': {id, label, distanceKm, timeSec, timeLabel, paceLabel,
 *                  date, sessionId, fromKm, fromSec, estimated}|null } },
 *   bike: { count, longest }, swim: { count, longest } }}
 *  best.X sale de carreras de distancia ≥ X: tiempo = movingSec × X / distanceKm (ritmo medio de esa carrera);
 *  estimated = distanceKm > X × 1,02 («estimado a ritmo medio»). Empates: cuenta la primera vez.
 */
export function enduranceRecords(data) {
  const idx = getIndex(data);
  const out = {
    run: { count: 0, longest: null, best: Object.fromEntries(RACE_DISTANCES.map((r) => [r.id, null])) },
    bike: { count: 0, longest: null },
    swim: { count: 0, longest: null },
  };
  for (const kind of DISTANCE_KINDS) {
    const bucket = out[kind];
    for (const a of idx.activities[kind]) {
      bucket.count++;
      const km = a.distanceKm > 0 ? a.distanceKm : null;
      if (km == null) continue;
      const sec = actSec(a);
      if (!bucket.longest || km > bucket.longest.distanceKm + EPS) {
        bucket.longest = { distanceKm: km, movingSec: sec, date: a.date, sessionId: a.id, label: distanceLabel(kind, km) };
      }
      if (kind !== 'run' || !(sec > 0)) continue;
      for (const r of RACE_DISTANCES) {
        if (km + EPS < r.km) continue;
        const t = (sec * r.km) / km;
        const cur = bucket.best[r.id];
        if (cur && !(t < cur.timeSec - EPS)) continue;
        bucket.best[r.id] = {
          id: r.id, label: r.label, distanceKm: r.km, timeSec: t, timeLabel: fmtDuration(t), paceLabel: fmtPace(sec / km),
          date: a.date, sessionId: a.id, fromKm: km, fromSec: sec, estimated: km > r.km * ESTIMATE_FACTOR,
        };
      }
    }
  }
  return out;
}

// ===========================================================================
// Semanas
// ===========================================================================

function emptyAgg() {
  return {
    sessions: 0, count: zeroKinds(), strengthVolume: 0, workSets: 0, load: zeroKinds(), noLoad: 0, minutes: zeroKinds(),
    km: { run: 0, bike: 0, swim: 0 }, paced: { run: { km: 0, sec: 0 }, bike: { km: 0, sec: 0 }, swim: { km: 0, sec: 0 } },
    muscleSets: {},
  };
}
const EMPTY_AGG = emptyAgg();

/** Agregados por semana de TODAS las sesiones terminadas (una pasada; perezoso y cacheado). */
function weekAgg(idx) {
  if (idx.weeks) return idx.weeks;
  const weeks = new Map();
  const wsCache = new Map();
  for (const s of idx.done) {
    let w = wsCache.get(s.date);
    if (!w) { w = weekStart(s.date); wsCache.set(s.date, w); }
    let a = weeks.get(w);
    if (!a) { a = emptyAgg(); weeks.set(w, a); }
    const kind = kindOf(s);
    a.sessions++;
    a.count[kind]++;
    const load = sessionLoad(s);
    if (load != null) a.load[kind] += load;
    else a.noLoad++;
    const min = sessionDurationMin(s);
    if (min != null) a.minutes[kind] += min;
    if (kind === 'strength') {
      a.strengthVolume += sessionVolume(s, idx.exMap, idx.bwFn);
      for (const se of s.exercises || []) for (const st of se.sets || []) if (isWorkSet(st)) a.workSets++;
      for (const [m, n] of Object.entries(sessionMuscleSets(s, idx.exMap, idx.settings))) a.muscleSets[m] = (a.muscleSets[m] || 0) + n;
    } else if (kind in a.km) {
      const km = s.distanceKm > 0 ? s.distanceKm : 0;
      a.km[kind] += km;
      const sec = actSec(s);
      if (km > 0 && sec > 0) { a.paced[kind].km += km; a.paced[kind].sec += sec; }
    }
  }
  idx.weeks = weeks;
  return weeks;
}

function weekRow(week, agg, idx) {
  const a = agg || EMPTY_AGG;
  const r3 = (v) => round(v, 0.001);
  const load = { ...a.load };
  const loadTotal = KINDS.reduce((t, k) => t + load[k], 0);
  const minutes = Object.fromEntries(KINDS.map((k) => [k, round(a.minutes[k], 0.01)]));
  const minutesTotal = round(KINDS.reduce((t, k) => t + a.minutes[k], 0), 0.01);
  const km = { run: r3(a.km.run), bike: r3(a.km.bike), swim: r3(a.km.swim) };
  const paced = {
    run: { km: r3(a.paced.run.km), sec: a.paced.run.sec },
    bike: { km: r3(a.paced.bike.km), sec: a.paced.bike.sec },
    swim: { km: r3(a.paced.swim.km), sec: a.paced.swim.sec },
  };
  const runPace = pace(a.paced.run.sec, a.paced.run.km);
  const bikeSpeed = speed(a.paced.bike.sec, a.paced.bike.km);
  const swimPace = pace100(a.paced.swim.sec, a.paced.swim.km);
  const muscleSets = {};
  for (const [m, n] of Object.entries(a.muscleSets)) muscleSets[m] = r3(n);
  const strengthVolume = round(a.strengthVolume, 0.01);
  return {
    week,
    weekEnd: addDays(week, 6),
    current: week === weekStart(idx.today),
    sessions: a.sessions,
    count: { ...a.count },
    strengthVolume,
    workSets: a.workSets,
    loadTotal,
    load,
    noLoad: a.noLoad,
    minutesTotal,
    minutes,
    km,
    runPace,
    bikeSpeed,
    swimPace,
    paced,
    muscleSets,
    labels: {
      strengthVolume: fmtMetric('volume', strengthVolume),
      loadTotal: fmtMetric('load', loadTotal),
      load: Object.fromEntries(KINDS.map((k) => [k, fmtMetric('load', load[k])])),
      km: { run: fmtMetric('km.run', km.run), bike: fmtMetric('km.bike', km.bike), swim: fmtMetric('km.swim', km.swim) },
      runPace: fmtMetric('runPace', runPace),
      bikeSpeed: fmtMetric('bikeSpeed', bikeSpeed),
      swimPace: fmtMetric('swimPace', swimPace),
      minutesTotal: fmtMetric('minutes', minutesTotal),
    },
  };
}

/**
 * Una fila por semana (lunes) de `from` a `to`, TODAS (las vacías con ceros) para que las barras no salten.
 * from = null → semana de la primera sesión terminada; to = null → semana de hoy (data.today).
 * @returns {{week, weekEnd, current, sessions, count:{strength,run,bike,swim,other}, strengthVolume, workSets,
 *   loadTotal, load:{strength,run,bike,swim,other}, noLoad, minutesTotal, minutes:{…}, km:{run,bike,swim},
 *   runPace (s/km|null), bikeSpeed (km/h|null), swimPace (s/100 m|null), paced:{run:{km,sec},…},
 *   muscleSets:{muscleId:n}, labels:{…}}[]}
 *  - La semana es la de `date` (el día en que se hizo), no la del plan.
 *  - load: calc.sessionLoad (min × RPE) de TODAS las sesiones, fuerza incluida; las actividades enlazadas a una
 *    sesión de fuerza cuentan en su deporte (la duración de la fuerza ya las descuenta). noLoad = sesiones sin
 *    carga (falta el esfuerzo percibido o la duración).
 *  - runPace/bikeSpeed/swimPace ponderados por distancia (Σ tiempo / Σ km de las que tienen distancia y tiempo).
 *  - muscleSets: calc.sessionMuscleSets con settings (primaryFactor/secondaryFactor).
 */
export function weeklySeries(data, from = null, to = null) {
  const idx = getIndex(data);
  const agg = weekAgg(idx);
  const end = to || idx.today;
  const start = from || idx.firstSession || end;
  return weeksBetween(start, end).map((w) => weekRow(w, agg.get(w), idx));
}

/** Rango objetivo [mín, máx] de un músculo (settings.muscleTargets) o null. */
export function muscleTarget(settings, muscleId) {
  const t = settings && settings.muscleTargets ? settings.muscleTargets[muscleId] : null;
  return Array.isArray(t) && t.length >= 2 ? [t[0], t[1]] : null;
}

/** 'below' | 'in' | 'above' | 'none' (sin rango) de unas series frente a su rango objetivo. */
export function targetStatus(sets, target) {
  if (!Array.isArray(target) || target.length < 2) return 'none';
  const [min, max] = target;
  if (min != null && sets < min - EPS) return 'below';
  if (max != null && sets > max + EPS) return 'above';
  return 'in';
}

/**
 * Series efectivas semanales de un músculo, con su rango objetivo.
 * @returns {{week, sets, target:[min,max]|null, status, label, current}[]}
 */
export function muscleWeekly(data, muscleId, from = null, to = null) {
  const idx = getIndex(data);
  const target = muscleTarget(idx.settings, muscleId);
  return weeklySeries(data, from, to).map((r) => {
    const sets = r.muscleSets[muscleId] || 0;
    return { week: r.week, sets, target, status: targetStatus(sets, target), label: fmtMetric('sets', sets), current: r.current };
  });
}

/**
 * Tabla «esta semana» de todos los músculos (orden de seed.MUSCLES) frente a su rango.
 * @param {string} [week] cualquier fecha de la semana (por defecto, hoy)
 * @returns {{muscleId, name, sets, prevSets, target, min, max, status, setsLabel}[]}
 */
export function muscleTable(data, week = null) {
  const idx = getIndex(data);
  const ws = weekStart(week || idx.today);
  const [prev, cur] = weeklySeries(data, addDays(ws, -7), ws);
  const ids = MUSCLES.map((m) => m.id);
  for (const m of Object.keys(cur.muscleSets)) if (!ids.includes(m)) ids.push(m);
  return ids.map((id) => {
    const target = muscleTarget(idx.settings, id);
    const sets = cur.muscleSets[id] || 0;
    return {
      muscleId: id, name: MUSCLE_LABEL[id] || id, sets, prevSets: prev.muscleSets[id] || 0, target,
      min: target ? target[0] : null, max: target ? target[1] : null, status: targetStatus(sets, target), setsLabel: fmtMetric('sets', sets),
    };
  });
}

/** Definición de una métrica semanal: valor de una fila, formato y, en ritmos, cómo promediar. */
function metricDef(metric) {
  const [head, sub] = String(metric).split('.');
  switch (head) {
    case 'strengthVolume': return { get: (r) => r.strengthVolume, fmt: (v) => fmtMetric('volume', v) };
    case 'loadTotal': return { get: (r) => r.loadTotal, fmt: (v) => fmtMetric('load', v) };
    case 'load': return { get: (r) => r.load[sub] ?? 0, fmt: (v) => fmtMetric('load', v) };
    case 'km': return { get: (r) => r.km[sub] ?? 0, fmt: (v) => fmtMetric(`km.${sub}`, v) };
    case 'minutesTotal': return { get: (r) => r.minutesTotal, fmt: (v) => fmtMetric('minutes', v) };
    case 'minutes': return { get: (r) => r.minutes[sub] ?? 0, fmt: (v) => fmtMetric('minutes', v) };
    case 'sessions': return { get: (r) => r.sessions, fmt: (v) => fmtMetric('sessions', v) };
    case 'workSets': return { get: (r) => r.workSets, fmt: (v) => fmtMetric('sets', v) };
    case 'muscle': return { get: (r) => r.muscleSets[sub] || 0, fmt: (v) => fmtMetric('sets', v) };
    case 'runPace': return { get: (r) => r.runPace, fmt: (v) => fmtMetric('runPace', v), ratio: 'run' };
    case 'bikeSpeed': return { get: (r) => r.bikeSpeed, fmt: (v) => fmtMetric('bikeSpeed', v), ratio: 'bike' };
    case 'swimPace': return { get: (r) => r.swimPace, fmt: (v) => fmtMetric('swimPace', v), ratio: 'swim' };
    default: throw new Error(`Métrica semanal desconocida: ${metric}`);
  }
}

/**
 * Puntos {x: lunes, y, label} de una métrica de las filas de weeklySeries. Las sumas incluyen las semanas a 0;
 * los ritmos (runPace, bikeSpeed, swimPace) omiten las semanas sin datos.
 * metric: 'strengthVolume' | 'loadTotal' | 'load.<tipo>' | 'km.run|bike|swim' | 'runPace' | 'bikeSpeed' |
 *         'swimPace' | 'minutesTotal' | 'minutes.<tipo>' | 'sessions' | 'workSets' | 'muscle.<id>'
 */
export function weeklyPoints(rows, metric) {
  const def = metricDef(metric);
  const out = [];
  for (const r of rows) {
    const y = def.get(r);
    if (y == null || !Number.isFinite(y)) continue;
    out.push({ x: r.week, y, label: def.fmt(y) });
  }
  return out;
}

/**
 * Media móvil de `n` semanas (la semana y las n−1 anteriores) de una métrica, para la línea sobre las barras.
 * Solo promedia semanas desde la primera sesión (no diluye con semanas previas a empezar a usar la app);
 * los ritmos se ponderan por distancia en toda la ventana. Puntos {x, y, label, weeks}: label = solo el valor
 * («2.254»); weeks = semanas promediadas (menos de `n` al principio del registro: la vista puede avisarlo).
 */
export function weeklyAverage(data, from = null, to = null, metric = 'loadTotal', n = 4) {
  const idx = getIndex(data);
  const def = metricDef(metric);
  if (!idx.firstSession) return [];
  const end = to || idx.today;
  const start = weekStart(from || idx.firstSession);
  const first = weekStart(idx.firstSession);
  const rows = weeklySeries(data, addDays(start, -7 * (n - 1)), end);
  const out = [];
  for (let i = n - 1; i < rows.length; i++) {
    const win = rows.slice(i - n + 1, i + 1).filter((r) => r.week >= first);
    if (!win.length) continue;
    let y;
    if (def.ratio) {
      const km = win.reduce((t, r) => t + r.paced[def.ratio].km, 0);
      const sec = win.reduce((t, r) => t + r.paced[def.ratio].sec, 0);
      y = def.ratio === 'run' ? pace(sec, km) : def.ratio === 'bike' ? speed(sec, km) : pace100(sec, km);
    } else {
      y = win.reduce((t, r) => t + def.get(r), 0) / win.length;
    }
    if (y == null || !Number.isFinite(y)) continue;
    out.push({ x: rows[i].week, y, label: def.fmt(y), weeks: win.length }); // weeks < n: ventana incompleta
  }
  return out;
}

// ===========================================================================
// Series por actividad
// ===========================================================================

function activitySeries(data, kind, from, to, metric, label) {
  const idx = getIndex(data);
  const out = [];
  for (const a of idx.activities[kind]) {
    if (!inRange(a.date, from, to)) continue;
    const km = a.distanceKm;
    const sec = actSec(a);
    const y = metric(sec, km);
    if (y == null) continue;
    out.push({ x: a.date, y, label: label(y, km), sessionId: a.id, km, sec });
  }
  return out;
}

/** Ritmo de cada carrera: {x, y: s/km, label «5:12 /km · 10,00 km», sessionId, km, sec}. */
export function runPaceSeries(data, from = null, to = null) {
  return activitySeries(data, 'run', from, to, pace, (y, km) => `${fmtPace(y)} · ${distanceLabel('run', km)}`);
}
/** Velocidad de cada salida en bici: y = km/h, label «28,3 km/h · 42,5 km». */
export function bikeSpeedSeries(data, from = null, to = null) {
  return activitySeries(data, 'bike', from, to, speed, (y, km) => `${fmtMetric('bikeSpeed', y)} · ${distanceLabel('bike', km)}`);
}
/** Ritmo de cada natación: y = s/100 m, label «2:00 /100 m · 1500 m». */
export function swimPaceSeries(data, from = null, to = null) {
  return activitySeries(data, 'swim', from, to, pace100, (y, km) => `${fmtPace(y, '/100 m')} · ${distanceLabel('swim', km)}`);
}

// ===========================================================================
// Peso corporal
// ===========================================================================

/**
 * Peso corporal para la gráfica: pesajes diarios y media móvil de 7 días (calculada sobre TODOS los pesajes y
 * recortada después, para que el primer punto del periodo tenga su semana completa), y la tendencia.
 * Los números son exactamente los de la vista de peso (activity-logic.bwStats / bwTrend).
 * Etiquetas de punto solo con el valor («75,2 kg»), también en la media (el nombre de la serie lo pone la vista).
 * @returns {{daily:{x,y,label}[], ma:{x,y,label}[], trend:{ok, kgPerWeek?, reason?, n, span, label},
 *            count, last, ma7, ma7Date, ma7N}}
 */
export function bodyweightSeries(data, from = null, to = null) {
  const idx = getIndex(data);
  const list = (data && data.bodyweight) || [];
  // Mismos pasos que activity-logic.bwStats (bwPoints → calc.movingAverage(7) → bwTrend), con la media
  // calculada UNA vez: la prueba unitaria exige que coincida con bwStats.
  const ma = movingAverage(bwPoints(list), 7);
  const t = bwTrend(ma, idx.today);
  const lastP = ma.length ? ma[ma.length - 1] : null;
  const daily = [];
  const maPts = [];
  let ma7N = 0;
  for (const p of ma) {
    if (lastP && diffDays(p.date, lastP.date) < 7) ma7N++;
    if (!inRange(p.date, from, to)) continue;
    daily.push({ x: p.date, y: p.value, label: `${num(p.value, 1)} kg` });
    maPts.push({ x: p.date, y: p.ma, label: `${num(p.ma, 1)} kg` });
  }
  return {
    daily,
    ma: maPts,
    trend: { ...t, label: t.ok ? `${fmtSigned(t.kgPerWeek, 2)} kg/sem` : 'Datos insuficientes' },
    count: ma.length,
    last: lastP ? { date: lastP.date, kg: lastP.value } : null,
    ma7: lastP ? lastP.ma : null,
    ma7Date: lastP ? lastP.date : null,
    ma7N,
  };
}

// ===========================================================================
// Adherencia (la misma que el Calendario: plan.adherence)
// ===========================================================================

function planCtxOf(idx) {
  if (idx.planCtx) return idx.planCtx;
  const d = idx.data;
  if (d.planCtx) {
    idx.planCtx = makeCtx(d.planCtx);
    return idx.planCtx;
  }
  const plan = d.plan instanceof Map ? [...d.plan.values()] : Array.isArray(d.plan) ? d.plan : Object.values(d.plan || {});
  const sessions = Array.isArray(d.sessions) ? d.sessions : [];
  const since = d.since !== undefined ? d.since : trackingSince({ createdAt: d.createdAt ?? null, sessions, plan });
  idx.planCtx = makeCtx({
    settings: d.settings || { weekPatterns: [] }, plan, sessions, templates: d.templates, exercises: d.exercises,
    today: idx.today, since,
  });
  return idx.planCtx;
}

/**
 * Adherencia por semana (días planificados frente a hechos), idéntica a plan.adherence del Calendario.
 * from = null → semana del inicio del registro (ctx.since o primera sesión); to = null → esta semana.
 * @returns {{week, planned, completed, done, partial, substituted, skipped, pending, extra, pct, label}[]}
 *  pct = completed / planned (como el Calendario: los días pendientes de la semana en curso cuentan como planificados).
 */
export function adherenceSeries(data, from = null, to = null) {
  const idx = getIndex(data);
  const ctx = planCtxOf(idx);
  const end = to || idx.today;
  const start = from || ctx.since || idx.firstSession || end;
  return weeksBetween(start, end).map((week) => {
    const a = adherence(week, ctx);
    return { week, ...a, label: adherenceText(a) };
  });
}

/**
 * Totales de un periodo a partir de adherenceSeries.
 * @returns {{planned, completed, done, partial, substituted, skipped, pending, extra, pct, pctPast}}
 *  pctPast excluye los días aún pendientes (hoy y futuro) del denominador.
 */
export function adherenceTotals(rows) {
  const t = { planned: 0, completed: 0, done: 0, partial: 0, substituted: 0, skipped: 0, pending: 0, extra: 0, pct: null, pctPast: null };
  for (const r of rows || []) for (const k of Object.keys(t)) if (k !== 'pct' && k !== 'pctPast') t[k] += r[k] || 0;
  t.pct = t.planned ? Math.round((t.completed / t.planned) * 100) : null;
  const past = t.planned - t.pending;
  t.pctPast = past > 0 ? Math.round((t.completed / past) * 100) : null;
  return t;
}
