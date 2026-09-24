// goals-logic.js — objetivos (Fase 3): progreso hacia el objetivo y estimación (rango de fechas) de cuándo se
// alcanzaría. PROPIETARIO: módulo de objetivos. PURO: sin DOM ni store; se prueba en Node (tests/unit/goals.test.mjs).
// La vista (js/views/goals.js) construye `data` con progress-ui.dataFromStore() UNA vez por render y llama a
// goalProgress(data, goal) para cada objetivo.
//
// Reutiliza (no duplica cálculos):
//  - stats.js: exerciseHistory (series de trabajo por sesión, 1RM estimado de cada sesión, peso corporal del día) y
//    runPaceSeries / bikeSpeedSeries / swimPaceSeries (actividades terminadas con distancia y tiempo, incluidas las
//    enlazadas a una sesión de fuerza). Su índice se cachea por objeto `data`.
//  - calc.js: e1rm (Epley con reps + RIR), setMetrics, riegel, linearRegression (con error típico de la pendiente),
//    movingAverage, dayIndex, makeBodyweightFn.
//  - activity-logic.js: bwPoints + bwTrend, la misma media móvil de 7 días y tendencia que #/bodyweight.
//
// OBJETIVO (store 'goals'):
//  { id, kind:'strength'|'endurance'|'bodyweight', title, titleAuto:boolean, createdAt (ms), updatedAt,
//    achievedAt:'YYYY-MM-DD'|null (fecha del registro que lo consiguió; la vista la sincroniza con goalProgress),
//    archived:boolean,
//    fuerza:        exerciseId, weight (kg; peso corporal: lastre, 0 = sin lastre, negativo = asistencia), reps
//    resistencia:   sport:'run'|'bike'|'swim', distanceKm (también natación, en km), timeSec|null (null = solo distancia)
//    peso corporal: targetKg, direction:'up'|'down' (se fija al crearlo según la media de 7 días de ese momento) }
//
// REGLAS COMUNES
//  - Solo sesiones terminadas y series de trabajo (lo garantiza stats.js). Registros con fecha ≤ hoy.
//  - «Actual» = el mejor valor de los últimos 28 días (peso corporal: la media de 7 días del último pesaje); si no
//    hay nada en 28 días, el mejor de los 28 días que terminan en el último registro.
//  - «Inicio» = el valor al crear el objetivo (el mejor de los 28 días hasta ese día; peso corporal: la media de 7
//    días del último pesaje hasta ese día); sin datos previos, el primer registro posterior. El progreso (%) va de
//    inicio a objetivo; en «solo distancia», distancia más larga reciente / distancia objetivo.
//  - Datos suficientes: ≥ settings.goals.minRecords registros en ≥ settings.goals.minWeeks semanas distintas
//    (lunes a domingo) dentro de la ventana de la tendencia (12 semanas; peso corporal, 28 días como #/bodyweight;
//    si minWeeks es mayor, la ventana se alarga a minWeeks semanas).
//  - Tendencia = regresión lineal (calc.linearRegression) de los puntos de la ventana. Pendiente nula o en contra
//    → 'no_trend'. Si no, tiempo restante = lo que falta desde «actual» / pendiente, y el RANGO sale de la
//    pendiente ± 1 error típico, con un margen mínimo de ±20 % del tiempo restante. Nunca una fecha exacta.
//  - Conseguido: fuerza, una serie de trabajo con peso ≥ y reps ≥ desde el día en que se creó; resistencia, una
//    sesión de distancia ≥ objetivo (y, con tiempo, por debajo del tiempo a ritmo medio de esa sesión); peso
//    corporal, la media de 7 días llega al objetivo desde que se creó.
//  - «Al alcance» (ready): el valor actual ya llega al objetivo pero no hay un registro que lo consiga desde que se
//    creó (p. ej. 1RM estimado de 90 × 3 frente a un objetivo de 80 × 5). status 'estimate', eta null.
import { addDays, diffDays, weekStart, dateFromTs, todayStr, isDateStr, fmtDate, fmtNum, fmtDuration, fmtPace, fmtWeekRange, fmtSigned, round, plural, MONTH_SHORT, parseDate } from './util.js';
import { e1rm, setMetrics, riegel, linearRegression, dayIndex, movingAverage, makeBodyweightFn } from './calc.js';
import { exerciseHistory, runPaceSeries, bikeSpeedSeries, swimPaceSeries } from './stats.js';
import { bwPoints, bwTrend, BW_TREND } from './activity-logic.js';
import { formatSet, fmtLastre } from './session-logic.js';

// ===========================================================================
// Constantes
// ===========================================================================

export const GOAL_KINDS = [
  { value: 'strength', label: 'Fuerza' },
  { value: 'endurance', label: 'Resistencia' },
  { value: 'bodyweight', label: 'Peso' },
];
export const GOAL_SPORTS = [
  { value: 'run', label: 'Carrera' },
  { value: 'bike', label: 'Bici' },
  { value: 'swim', label: 'Natación' },
];
const SPORT_IDS = GOAL_SPORTS.map((s) => s.value);
/** Tipos de registro válidos para un objetivo de fuerza (peso × reps). */
export const STRENGTH_LOG_TYPES = ['weight_reps', 'unilateral', 'bodyweight'];
/** Semanas de la tendencia (fuerza y resistencia). */
export const TREND_WEEKS = 12;
/** Días que cuentan como «reciente» para el valor actual. */
export const RECENT_DAYS = 28;
/** Margen mínimo del rango (± fracción del tiempo restante). */
export const MIN_MARGIN = 0.2;
/** Más allá de estos días se dice «más de 2 años al ritmo actual». */
export const LONG_DAYS = 730;
/** Exponente de Riegel. */
export const RIEGEL_K = 1.06;
/** Distancia mínima de una sesión para predecir con Riegel (km). */
export const MIN_KM = { run: 3, bike: 10, swim: 0.4 };
/** Distancias habituales (km) para los atajos del formulario. */
export const DISTANCE_PRESETS = {
  run: [5, 10, 21.0975, 42.195],
  bike: [20, 40, 90, 180],
  swim: [0.4, 0.75, 1.5, 1.9, 3.8],
};
export const DEFAULT_RULES = { minRecords: 4, minWeeks: 3 };

const EPS = 1e-9;
const MAX_DAYS = 36500;
const EMOJI = { strength: '🏋️', run: '🏃', bike: '🚴', swim: '🏊', bodyweight: '⚖️' };
const STATUS_LABEL = {
  achieved: 'Conseguido', ready: 'Al alcance', estimate: 'Estimación', insufficient: 'Datos insuficientes', no_trend: 'Sin tendencia',
};
/** Línea fija que acompaña a toda estimación. */
export const NONLINEAR_NOTE = 'El progreso no es lineal: hay semanas de avance, de meseta y de retroceso. Las fechas son un rango orientativo que se recalcula con cada registro.';

// ===========================================================================
// Formato (es-ES)
// ===========================================================================

const toMap = (x) => {
  if (x instanceof Map) return x;
  if (Array.isArray(x)) return new Map(x.filter(Boolean).map((o) => [o.id, o]));
  return new Map(Object.entries(x || {}));
};
const kgTxt = (v, dec = 1) => `${fmtNum(v, dec)} kg`;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sameYearAs = (date, ref) => date.slice(0, 4) === ref.slice(0, 4);
/** «18 sep» este año; «18 sep 2025» otro año. */
export function fmtDay(date, today = todayStr()) {
  if (!date) return '—';
  return fmtDate(date, sameYearAs(date, today) ? 'day' : 'full');
}

/** Distancia: carrera y bici en km, natación en metros; media maratón y maratón por su nombre si se pide. */
export function fmtDistance(sport, km, { named = false } = {}) {
  if (!isNum(km)) return '—';
  if (named && sport === 'run') {
    if (Math.abs(km - 21.0975) < 0.01) return 'media maratón';
    if (Math.abs(km - 42.195) < 0.01) return 'maratón';
  }
  if (sport === 'swim') return `${fmtNum(km * 1000, 0)} m`;
  return `${fmtNum(km, 2)} km`;
}

/** Duración en palabras: «45 min», «1 h 05 min», «22 min 30 s», «40 s». */
export function fmtTimeWords(sec) {
  if (!isNum(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const parts = [];
  if (hh) parts.push(`${hh} h`);
  if (mm || (hh && ss)) parts.push(hh ? `${String(mm).padStart(2, '0')} min` : `${mm} min`);
  if (ss || !parts.length) parts.push(`${ss} s`);
  return parts.join(' ');
}

/** Texto del peso de un objetivo de fuerza: «80 kg»; peso corporal: «+10 kg», «−15 kg asist.» o '' (sin lastre). */
export function goalWeightText(logType, w) {
  if (logType === 'bodyweight') return fmtLastre(isNum(w) ? w : 0);
  return isNum(w) ? kgTxt(w, 2) : '—';
}

/** «+0,62 kg/sem», «−12 s/sem»… */
function rateText(metric, perWeek, sport) {
  if (!isNum(perWeek)) return '—';
  const dec = Math.abs(perWeek) < 1 ? 2 : 1;
  switch (metric) {
    case 'e1rm':
    case 'bodyweight': return `${fmtSigned(perWeek, dec)} kg/sem`;
    case 'reps': return `${fmtSigned(perWeek, dec)} reps/sem`;
    case 'time': {
      const a = Math.abs(perWeek);
      const sign = perWeek > 0 ? '+' : perWeek < 0 ? '−' : '±';
      return a < 60 ? `${sign}${fmtNum(a, a < 10 ? 1 : 0)} s/sem` : `${sign}${fmtDuration(a)}/sem`;
    }
    case 'distance':
      return sport === 'swim' ? `${fmtSigned(perWeek * 1000, 0)} m/sem` : `${fmtSigned(perWeek, dec)} km/sem`;
    default: return fmtSigned(perWeek, dec);
  }
}

function missingText(c, noun) {
  const parts = [];
  if (c.missingRecords) parts.push(plural(c.missingRecords, noun[0], noun[1]));
  if (c.missingWeeks) parts.push(`${plural(c.missingWeeks, 'semana', 'semanas')} más con registros`);
  const verb = (c.missingRecords || c.missingWeeks) === 1 && parts.length === 1 ? 'falta' : 'faltan';
  return parts.length ? `${verb} ${parts.join(' y ')}` : '';
}

// ===========================================================================
// Reglas de datos suficientes y rango de fechas
// ===========================================================================

const posInt = (v, def, min = 1) => (isNum(v) && v >= min ? Math.round(v) : def);

/** Umbrales de settings.goals (con los valores por defecto si faltan). */
export function goalRules(settings) {
  const g = (settings && settings.goals) || {};
  return { minRecords: posInt(g.minRecords, DEFAULT_RULES.minRecords, 2), minWeeks: posInt(g.minWeeks, DEFAULT_RULES.minWeeks, 1) };
}

/**
 * ¿Hay datos suficientes? `dates` = fecha de cada registro de la ventana.
 * @returns {{records, weeks, minRecords, minWeeks, missingRecords, missingWeeks, ok}}
 */
export function sufficiency(dates, rules = DEFAULT_RULES) {
  const records = dates.length;
  const weeks = new Set(dates.map((d) => weekStart(d))).size;
  const missingRecords = Math.max(0, rules.minRecords - records);
  const missingWeeks = Math.max(0, rules.minWeeks - weeks);
  return { records, weeks, minRecords: rules.minRecords, minWeeks: rules.minWeeks, missingRecords, missingWeeks, ok: !missingRecords && !missingWeeks };
}

/**
 * Rango de días hasta cubrir `gap` (> 0) con una pendiente favorable `slope` (> 0, unidades por día) y su error
 * típico `se` (null si no se puede calcular): pendiente ± 1 error típico, con un mínimo de ±minMargin sobre el
 * tiempo restante. Devuelve null si la pendiente no es favorable.
 * @returns {{from, to:string|null, fromDays, toDays:number|null, centerDays, beyond:boolean, allBeyond:boolean}|null}
 *  to/toDays = null si con la pendiente menos favorable no se llegaría nunca. beyond = el extremo lento pasa de 2 años;
 *  allBeyond = incluso el extremo rápido pasa de 2 años.
 */
export function etaRange(gap, slope, se, today, { minMargin = MIN_MARGIN, longDays = LONG_DAYS } = {}) {
  if (!(gap > 0) || !(slope > 0) || !isDateStr(today)) return null;
  const center = gap / slope;
  const s = isNum(se) && se > 0 ? se : 0;
  let lo = gap / (slope + s);
  let hi = slope - s > 0 ? gap / (slope - s) : Infinity;
  lo = Math.min(lo, center * (1 - minMargin));
  hi = Math.max(hi, center * (1 + minMargin));
  const fromDays = Math.max(1, Math.floor(lo));
  const toDays = Number.isFinite(hi) ? Math.max(fromDays + 1, Math.ceil(hi)) : null;
  return {
    from: addDays(today, Math.min(fromDays, MAX_DAYS)),
    to: toDays != null && toDays <= MAX_DAYS ? addDays(today, toDays) : null,
    fromDays,
    toDays,
    centerDays: center,
    beyond: toDays == null || toDays > longDays,
    allBeyond: fromDays > longDays,
  };
}

/**
 * Texto del rango. Cada extremo cercano (≤ 60 días) va con día y los lejanos con mes; si el rango es estrecho
 * (≤ 45 días de ancho), los dos con día: «entre el 12 oct y el 3 nov», «entre nov 2026 y feb 2027»,
 * «entre el 20 oct y feb 2028», «entre abr 2027 y más de 2 años (al ritmo actual)» o «más de 2 años al ritmo actual».
 */
export function etaText(eta, today = todayStr()) {
  if (!eta) return '';
  if (eta.allBeyond) return 'más de 2 años al ritmo actual';
  const month = (d) => { const p = parseDate(d); return `${MONTH_SHORT[p.getMonth()]} ${p.getFullYear()}`; };
  const years = !sameYearAs(eta.from, today) || (eta.to && (!sameYearAs(eta.to, today) || !sameYearAs(eta.from, eta.to)));
  const day = (d) => `el ${fmtDate(d, years ? 'full' : 'day')}`;
  const end = (d, days, narrow) => (narrow || days <= 60 ? day(d) : month(d));
  if (eta.beyond) return `entre ${end(eta.from, eta.fromDays, false)} y más de 2 años (al ritmo actual)`;
  const narrow = eta.toDays - eta.fromDays <= 45;
  return `entre ${end(eta.from, eta.fromDays, narrow)} y ${end(eta.to, eta.toDays, narrow)}`;
}

// ===========================================================================
// Utilidades de series
// ===========================================================================

const better = (a, b, dir) => (dir > 0 ? a > b + EPS : a < b - EPS);
function bestOf(list, dir) {
  let best = null;
  for (const r of list) if (!best || better(r.value, best.value, dir)) best = r;
  return best;
}
const inWin = (d, from, to) => d >= from && d <= to;

/** Valor «actual»: el mejor de los últimos 28 días; si no hay, el mejor de los 28 días que acaban en el último registro. */
function recentBest(records, today, dir) {
  if (!records.length) return null;
  const from = addDays(today, -(RECENT_DAYS - 1));
  const recent = records.filter((r) => inWin(r.date, from, today));
  if (recent.length) return { ...bestOf(recent, dir), stale: false };
  const last = records[records.length - 1].date;
  const lf = addDays(last, -(RECENT_DAYS - 1));
  return { ...bestOf(records.filter((r) => inWin(r.date, lf, last)), dir), stale: true };
}

/** Valor al crear el objetivo: el mejor de los 28 días hasta ese día; si no hay, el primer registro posterior. */
function baselineBest(records, createdDate, dir) {
  if (!records.length || !createdDate) return null;
  const before = records.filter((r) => inWin(r.date, addDays(createdDate, -(RECENT_DAYS - 1)), createdDate));
  if (before.length) return bestOf(before, dir);
  return records.find((r) => r.date >= createdDate) || null;
}

/** Mejor registro de cada semana (lunes), en orden. */
function weeklyBest(records, dir) {
  const byWeek = new Map();
  for (const r of records) {
    const w = weekStart(r.date);
    const cur = byWeek.get(w);
    if (!cur || better(r.value, cur.value, dir)) byWeek.set(w, { ...r, week: w, count: (cur?.count || 0) + 1 });
    else cur.count++;
  }
  return [...byWeek.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Progreso (0–100) de inicio a objetivo; `ratio` = actual / objetivo (solo distancia). */
export function progressPercent({ start, current, target, dir, achieved = false, ratio = false }) {
  if (achieved) return 100;
  if (!isNum(current) || !isNum(target)) return null;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const byRatio = () => (dir > 0 ? (target > 0 ? clamp((current / target) * 100) : null) : current > 0 ? clamp((target / current) * 100) : null);
  if (ratio) return byRatio();
  const total = isNum(start) ? (target - start) * dir : 0;
  if (!(total > EPS)) {
    // Sin inicio o ya estaba al nivel del objetivo al crearlo.
    if ((current - target) * dir >= -EPS) return 100;
    return byRatio();
  }
  return clamp((((current - start) * dir) / total) * 100);
}

// ===========================================================================
// Modelos por tipo (qué se mide, registros, conseguido)
// ===========================================================================

function strengthModel(data, goal, today) {
  const exMap = toMap(data.exercises);
  const ex = exMap.get(goal.exerciseId);
  if (!ex) return { invalid: 'El ejercicio de este objetivo ya no existe en la biblioteca.' };
  const lt = ex.logType;
  if (!STRENGTH_LOG_TYPES.includes(lt)) return { invalid: `«${ex.name}» no se registra con peso y repeticiones.` };
  const W = lt === 'bodyweight' ? (isNum(goal.weight) ? goal.weight : 0) : goal.weight;
  const R = goal.reps;
  if (!isNum(W) || !(R >= 1)) return { invalid: 'Falta el peso o las repeticiones del objetivo.' };
  const settings = data.settings || {};
  const bwFn = makeBodyweightFn(data.bodyweight || [], settings.bodyweightDefault ?? 75);
  const bwToday = lt === 'bodyweight' ? bwFn(today) : null;
  const core = lt === 'bodyweight' && ex.pattern === 'core';
  const tgtE1rm = core ? null : e1rm(lt === 'bodyweight' ? bwToday + W : W, R, 0);
  const metric = tgtE1rm != null ? 'e1rm' : 'reps';
  const wTxt = goalWeightText(lt, W);
  const goalTxt = wTxt ? `${wTxt} × ${R}` : `${R} reps`;
  const lifted = (s) => (lt === 'bodyweight' ? (isNum(s.weight) ? s.weight : 0) : s.weight);
  const setTxt = (s) => {
    const t = formatSet(s, lt, { kg: true });
    return lt === 'bodyweight' && !s.weight ? `Sin lastre · ${t}` : t;
  };

  const hist = exerciseHistory(data, ex.id, { labels: false }).filter((e) => e.date <= today);
  const byDay = new Map(); // un registro por día (dos sesiones el mismo día: la mejor)
  for (const e of hist) {
    let rec = null;
    if (metric === 'e1rm') {
      if (e.e1rm == null) continue;
      const note = lt === 'bodyweight' ? ` (peso corporal ${kgTxt(e.bw)})` : '';
      rec = { date: e.date, value: e.e1rm, label: `${kgTxt(e.e1rm)} · ${setTxt(e.e1rmSet)}${note}`, src: setTxt(e.e1rmSet), sessionId: e.sessionId };
    } else {
      let best = null; let bestReps = -1;
      for (const s of e.sets) {
        const w = lifted(s);
        const reps = setMetrics(s, ex, e.bw).reps;
        if (!isNum(w) || w < W - EPS || !(reps >= 1)) continue;
        if (reps > bestReps) { bestReps = reps; best = s; }
      }
      if (!best) continue;
      rec = { date: e.date, value: bestReps, label: `${bestReps} reps · ${setTxt(best)}`, src: setTxt(best), sessionId: e.sessionId };
    }
    const cur = byDay.get(e.date);
    if (!cur || rec.value > cur.value + EPS) byDay.set(e.date, rec);
  }
  const records = [...byDay.values()];

  const createdDate = createdDateOf(goal);
  let achieved = null;
  for (const e of hist) {
    if (createdDate && e.date < createdDate) continue;
    const s = e.sets.find((x) => { const w = lifted(x); const reps = setMetrics(x, ex, e.bw).reps; return isNum(w) && w >= W - EPS && reps >= R; });
    if (s) { achieved = { date: e.date, label: setTxt(s) }; break; }
  }

  const fmt = metric === 'e1rm' ? (v) => kgTxt(v) : (v) => `${fmtNum(v, 0)} reps`;
  const fmtGap = metric === 'e1rm' ? (v) => kgTxt(v) : (v) => plural(round(v, 0.1), 'rep', 'reps');
  const method = metric === 'e1rm'
    ? `Objetivo convertido a 1RM estimado con Epley: ${goalTxt} ≈ ${kgTxt(tgtE1rm)}${lt === 'bodyweight' ? ` (con tu peso corporal actual, ${kgTxt(bwToday)})` : ''}. Actual: mejor 1RM estimado (reps + RIR, series de 1–12 reps) de las últimas 4 semanas. Tendencia: regresión lineal del mejor 1RM estimado de cada sesión en las últimas ${TREND_WEEKS} semanas.`
    : `Con más de 12 repeticiones${core ? ' o en un ejercicio de core con peso corporal' : ''} no se estima el 1RM: se sigue el máximo de repeticiones por sesión con ${wTxt || 'tu peso corporal'} o más. Tendencia: regresión lineal de ese máximo por sesión en las últimas ${TREND_WEEKS} semanas.`;
  return {
    metric, dir: 1, target: metric === 'e1rm' ? tgtE1rm : R,
    targetLabel: metric === 'e1rm' ? kgTxt(tgtE1rm) : `${R} reps`,
    targetNote: metric === 'e1rm' ? `1RM est. de ${goalTxt}` : wTxt ? `con ${wTxt}` : 'sin lastre',
    currentNoun: metric === 'e1rm' ? '1RM estimado' : 'máximo de repeticiones',
    fmt, fmtGap, records, achieved, method,
    noun: ['sesión', 'sesiones'], subject: metric === 'e1rm' ? `con ${ex.name}` : `con ${ex.name}${wTxt ? ` y ${wTxt} o más` : ''}`,
    windowDays: 0, exercise: ex, goalTxt,
    achievedText: (a) => `Conseguido el ${fmtDay(a.date, today)}: ${a.label} (objetivo ${goalTxt}).`,
    nowText: (cur) => (metric === 'e1rm' ? `Tu 1RM estimado actual es ${kgTxt(cur.value)}` : `Tu máximo reciente es de ${fmtNum(cur.value, 0)} reps ${wTxt ? `con ${wTxt} o más` : 'sin lastre'}`),
    readyText: (cur) => metric === 'e1rm'
      ? `Tu 1RM estimado reciente (${kgTxt(cur.value)}, de ${cur.src} el ${fmtDay(cur.date, today)}) ya iguala o supera el equivalente del objetivo (${kgTxt(tgtE1rm)}): ${goalTxt} está a tu alcance. Se marcará como conseguido cuando registres una serie de trabajo con ese peso y esas repeticiones o más.`
      : `Ya hiciste ${cur.src} el ${fmtDay(cur.date, today)}, antes de crear el objetivo: se marcará como conseguido con la próxima serie de ${goalTxt} o más.`,
  };
}

function enduranceModel(data, goal, today) {
  const sport = goal.sport;
  if (!SPORT_IDS.includes(sport)) return { invalid: 'Falta el deporte del objetivo.' };
  const D = goal.distanceKm;
  if (!(D > 0)) return { invalid: 'Falta la distancia del objetivo.' };
  const T = goal.timeSec > 0 ? goal.timeSec : null;
  const series = sport === 'run' ? runPaceSeries(data) : sport === 'bike' ? bikeSpeedSeries(data) : swimPaceSeries(data);
  const acts = series.filter((a) => a.x <= today && a.km > 0 && a.sec > 0);
  const dist = (km) => fmtDistance(sport, km);
  const Dtxt = fmtDistance(sport, D);
  const createdDate = createdDateOf(goal);
  const sportWord = { run: 'carreras', bike: 'salidas en bici', swim: 'sesiones de natación' }[sport];
  const sportOne = { run: 'carrera', bike: 'salida en bici', swim: 'sesión de natación' }[sport];
  const warning = sport === 'run' ? null
    : `La fórmula de Riegel está pensada para carrera: en ${sport === 'bike' ? 'bici' : 'natación'} la predicción es menos fiable (influyen ${sport === 'bike' ? 'el terreno, el viento y el drafting' : 'la técnica, la piscina o el agua abierta'}), así que tómala como una referencia aproximada.`;

  if (T) {
    const minKm = Math.min(MIN_KM[sport], D);
    const records = [];
    for (const a of acts) {
      if (a.km + EPS < minKm) continue;
      const pred = riegel(a.sec, a.km, D, RIEGEL_K);
      if (!isNum(pred)) continue;
      const paceTxt = sport === 'swim' ? fmtPace(a.sec / (a.km * 10), '/100 m') : sport === 'bike' ? `${fmtNum(a.km / (a.sec / 3600), 1)} km/h` : fmtPace(a.sec / a.km);
      const src = `${dist(a.km)} en ${fmtDuration(a.sec)} (${paceTxt})`;
      records.push({ date: a.x, value: Math.round(pred), label: `${fmtDuration(pred)} · desde ${src}`, src, sessionId: a.sessionId, km: a.km, sec: a.sec });
    }
    let achieved = null;
    for (const a of acts) {
      if (createdDate && a.x < createdDate) continue;
      if (a.km + EPS < D) continue;
      const scaled = Math.round((a.sec * D) / a.km);
      if (scaled < T) {
        const est = a.km > D * 1.02;
        achieved = { date: a.x, label: est ? `${dist(a.km)} en ${fmtDuration(a.sec)}: ${Dtxt} a ritmo medio en ${fmtDuration(scaled)}` : `${dist(a.km)} en ${fmtDuration(a.sec)}` };
        break;
      }
    }
    const minTxt = fmtDistance(sport, minKm);
    return {
      metric: 'time', dir: -1, target: T, targetLabel: fmtDuration(T), targetNote: `tiempo en ${Dtxt}`,
      currentNoun: 'predicción', fmt: (v) => fmtDuration(v), fmtGap: (v) => `${fmtTimeWords(v)} por bajar`, records, achieved, warning,
      weekly: true, strict: true, noun: [sportOne, sportWord], subject: `de ${minTxt} o más`,
      nowText: (cur) => `Tu predicción actual para ${Dtxt} es ${fmtDuration(cur.value)}`,
      method: `Predicción con la fórmula de Riegel (T₂ = T₁ × (D₂ / D₁)^1,06) para ${Dtxt} desde cada ${sportOne} de ${minTxt} o más; se usa la mejor predicción de cada semana. Actual: la mejor predicción de las últimas 4 semanas. Tendencia: regresión lineal de las predicciones semanales en las últimas ${TREND_WEEKS} semanas.`,
      achievedText: (a) => `Conseguido el ${fmtDay(a.date, today)}: ${a.label} (objetivo ${Dtxt} en menos de ${fmtDuration(T)}).`,
      readyText: (cur) => `Tu predicción actual para ${Dtxt} (${fmtDuration(cur.value)}, desde ${cur.src} el ${fmtDay(cur.date, today)}) ya baja del objetivo: se marcará como conseguido cuando registres ${Dtxt} o más en menos de ${fmtDuration(T)}.`,
    };
  }

  const records = acts.map((a) => ({ date: a.x, value: a.km, label: `${dist(a.km)} en ${fmtDuration(a.sec)}`, src: `${dist(a.km)} en ${fmtDuration(a.sec)}`, sessionId: a.sessionId }));
  let achieved = null;
  for (const a of acts) {
    if (createdDate && a.x < createdDate) continue;
    if (a.km + EPS >= D) { achieved = { date: a.x, label: `${dist(a.km)} en ${fmtDuration(a.sec)}` }; break; }
  }
  return {
    metric: 'distance', dir: 1, ratio: true, target: D, targetLabel: Dtxt, targetNote: 'en una sesión',
    currentNoun: `${sportOne === 'carrera' ? 'carrera' : 'sesión'} más larga`, fmt: dist, fmtGap: dist, records, achieved, warning: null,
    weekly: true, noun: [sportOne, sportWord], subject: '', sport,
    nowText: (cur) => `Tu ${sportOne} más larga reciente es de ${dist(cur.value)}`,
    method: `Progreso: la ${sportOne} más larga de las últimas 4 semanas frente a ${Dtxt}. Tendencia: regresión lineal de la sesión más larga de cada semana en las últimas ${TREND_WEEKS} semanas.`,
    achievedText: (a) => `Conseguido el ${fmtDay(a.date, today)}: ${a.label} (objetivo ${Dtxt}).`,
    readyText: (cur) => `Ya hiciste ${cur.src} el ${fmtDay(cur.date, today)}, antes de crear el objetivo: se marcará como conseguido con la próxima ${sportOne} de ${Dtxt} o más.`,
  };
}

function bodyweightModel(data, goal, today, rules) {
  const T = goal.targetKg;
  if (!(T > 0)) return { invalid: 'Falta el peso objetivo.' };
  const ma = movingAverage(bwPoints(data.bodyweight || []), 7).filter((p) => p.date <= today);
  const createdDate = createdDateOf(goal);
  const before = createdDate ? ma.filter((p) => p.date <= createdDate) : [];
  const basePt = before.length ? before[before.length - 1] : createdDate ? ma.find((p) => p.date >= createdDate) : ma[0];
  const base = basePt ? round(basePt.ma, 0.01) : null;
  const dir = goal.direction === 'down' ? -1 : goal.direction === 'up' ? 1 : base != null && T < base ? -1 : 1;
  const windowDays = Math.max(BW_TREND.windowDays, rules.minWeeks * 7);
  const wFrom = addDays(today, -(windowDays - 1));
  const records = ma.map((p) => ({ date: p.date, value: p.ma, kg: p.value, label: `${kgTxt(p.ma)} (pesaje ${kgTxt(p.value)})` }));
  let achieved = null;
  for (const p of ma) {
    if (createdDate && p.date < createdDate) continue;
    if ((round(p.ma, 0.1) - T) * dir >= -EPS) { achieved = { date: p.date, label: `la media de 7 días llegó a ${kgTxt(p.ma)}` }; break; }
  }
  const last = ma.length ? ma[ma.length - 1] : null;
  const verb = dir > 0 ? 'Subir' : 'Bajar';
  return {
    metric: 'bodyweight', dir, target: T, targetLabel: kgTxt(T), targetNote: `media 7 días · ${dir > 0 ? 'subir' : 'bajar'}`,
    currentNoun: 'media de 7 días', fmt: (v) => kgTxt(v), fmtGap: (v) => `${kgTxt(v)} por ${dir > 0 ? 'subir' : 'bajar'}`, records, achieved, warning: null,
    nowText: (cur) => `Tu media de 7 días es ${kgTxt(cur.value)}`,
    noun: ['pesaje', 'pesajes'], subject: '', windowDays, windowFrom: wFrom, maPoints: ma,
    current: last ? { date: last.date, value: last.ma, label: `media de 7 días (último pesaje ${kgTxt(last.value)} el ${fmtDay(last.date, today)})`, stale: diffDays(last.date, today) >= RECENT_DAYS } : null,
    start: basePt ? { date: basePt.date, value: basePt.ma, label: `media de 7 días el ${fmtDay(basePt.date, today)}` } : null,
    method: `Media móvil de 7 días (la misma de Peso corporal), para no confundir fluctuaciones de un día con la tendencia. Tendencia: regresión lineal de la media en los últimos ${windowDays} días (kg por semana).`,
    achievedText: (a) => `Conseguido el ${fmtDay(a.date, today)}: ${a.label} (objetivo ${verb.toLowerCase()} a ${kgTxt(T)}).`,
    readyText: () => `Tu media de 7 días ya está en el objetivo; se marcará como conseguido con el próximo pesaje.`,
  };
}

/** Fecha local ('YYYY-MM-DD') en que se creó el objetivo, o null. */
export function createdDateOf(goal) {
  return goal && isNum(goal.createdAt) && goal.createdAt > 0 ? dateFromTs(goal.createdAt) : null;
}

// ===========================================================================
// goalProgress
// ===========================================================================

/**
 * Progreso de un objetivo y estimación de cuándo se alcanzaría.
 * @param {object} data  entrada común de stats.js ({ sessions, exercises, settings, bodyweight, today, … })
 * @param {object} goal  registro del store 'goals'
 * @returns {{
 *   status: 'achieved'|'insufficient'|'no_trend'|'estimate', ready:boolean, statusLabel,
 *   current:number|null, target:number|null, start:number|null, progressPct:number|null,
 *   eta:{from, to, fromDays, toDays, centerDays, beyond, allBeyond}|null, etaText,
 *   method, rule, dataUsed:{date, label, value}[], explanation, warning:string|null,
 *   metric:'e1rm'|'reps'|'time'|'distance'|'bodyweight', dir:1|-1,
 *   currentLabel, currentNote, targetLabel, targetNote, startLabel,
 *   achievedOn:'YYYY-MM-DD'|null, trend:{slopePerWeek, sePerWeek, n, r2, label}|null,
 *   counts:{records, weeks, minRecords, minWeeks, missingRecords, missingWeeks, ok, windowFrom, windowTo, windowWeeks}|null }}
 *  current/target/start en la unidad de la métrica: kg (1RM estimado o peso corporal), reps, segundos (predicción
 *  de tiempo) o km (distancia). ready: el valor actual ya llega al objetivo sin un registro que lo consiga desde que
 *  se creó (status 'estimate', eta null).
 */
export function goalProgress(data, goal) {
  const d = data || {};
  const today = isDateStr(d.today) ? d.today : todayStr();
  const rules = goalRules(d.settings);
  const kind = goal && goal.kind;
  let m;
  if (kind === 'strength') m = strengthModel(d, goal, today);
  else if (kind === 'endurance') m = enduranceModel(d, goal, today);
  else if (kind === 'bodyweight') m = bodyweightModel(d, goal, today, rules);
  else m = { invalid: 'Tipo de objetivo desconocido.' };

  if (m.invalid) {
    return {
      status: 'insufficient', ready: false, statusLabel: STATUS_LABEL.insufficient, current: null, target: null, start: null,
      progressPct: null, eta: null, etaText: '', method: '', rule: '', dataUsed: [], explanation: m.invalid, warning: null,
      metric: null, dir: 1, currentLabel: '—', currentNote: '', targetLabel: '—', targetNote: '', startLabel: '—',
      achievedOn: null, trend: null, counts: null, invalid: true,
    };
  }

  const { dir, target, fmt } = m;
  const createdDate = createdDateOf(goal);
  const windowDays = m.windowDays || Math.max(TREND_WEEKS, rules.minWeeks) * 7;
  const wFrom = addDays(today, -(windowDays - 1));
  const winRecs = m.records.filter((r) => inWin(r.date, wFrom, today));
  const counts = { ...sufficiency(winRecs.map((r) => r.date), rules), windowFrom: wFrom, windowTo: today, windowWeeks: Math.round(windowDays / 7) };
  const current = m.current !== undefined ? m.current : recentBest(m.records, today, dir);
  const startRec = m.start !== undefined ? m.start : baselineBest(m.records, createdDate, dir);
  const achieved = m.achieved;
  const progressPct = progressPercent({ start: startRec?.value ?? null, current: current?.value ?? null, target, dir, achieved: !!achieved, ratio: !!m.ratio });

  // Puntos de la tendencia: semanal (resistencia: la mejor sesión de cada semana) o cada registro.
  const trendRecs = m.weekly ? weeklyBest(winRecs, dir) : winRecs;
  const dataUsed = m.weekly
    ? trendRecs.map((r) => ({ date: r.date, label: `Semana ${fmtWeekRange(r.week)}`, value: `${r.label}${r.count > 1 ? ` · mejor de ${r.count}` : ''}` }))
    : m.metric === 'bodyweight'
      ? weeklyBodyweight(winRecs, today)
      : winRecs.map((r) => ({ date: r.date, label: fmtDay(r.date, today), value: r.label }));

  let status;
  let ready = false;
  let eta = null;
  let trend = null;
  let explanation;
  // Peso corporal: con el mismo redondeo (0,1 kg) que «conseguido».
  const curCmp = current ? (m.metric === 'bodyweight' ? round(current.value, 0.1) : current.value) : null;
  const reaches = !!current && (m.strict ? (curCmp - target) * dir > EPS : (curCmp - target) * dir >= -EPS);
  const rangeTxt = `${plural(counts.records, m.noun[0], m.noun[1])}${m.subject ? ` ${m.subject}` : ''} en ${plural(counts.weeks, 'semana', 'semanas')}`;
  const windowTxt = m.metric === 'bodyweight' ? `los últimos ${windowDays} días` : `las últimas ${counts.windowWeeks} semanas`;

  // Regresión (si hay datos suficientes y al menos dos fechas distintas).
  let reg = null;
  if (counts.ok) {
    const xs = trendRecs.map((r) => dayIndex(r.date));
    const ys = trendRecs.map((r) => r.value);
    reg = linearRegression(xs, ys);
    if (reg && m.metric === 'bodyweight') {
      // La pendiente es la de #/bodyweight (bwTrend sobre la misma ventana); el error típico, de la misma regresión.
      const t = bwTrend(m.maPoints, today, { windowDays, minPoints: 2, minSpanDays: 0 });
      if (t.ok) reg = { ...reg, slope: t.kgPerWeek / 7 };
    }
    if (reg) {
      const se = isNum(reg.seSlope) ? reg.seSlope : null;
      trend = {
        slopePerWeek: reg.slope * 7, sePerWeek: se != null ? se * 7 : null, n: reg.n, r2: reg.r2,
        label: rateText(m.metric, reg.slope * 7, m.sport),
      };
    }
  }

  if (achieved) {
    status = 'achieved';
    explanation = m.achievedText(achieved);
  } else if (reaches) {
    status = 'estimate';
    ready = true;
    explanation = m.readyText(current);
  } else if (!counts.ok || !reg) {
    status = 'insufficient';
    const need = `Hacen falta ${plural(counts.minRecords, 'registro', 'registros')} en al menos ${plural(counts.minWeeks, 'semana distinta', 'semanas distintas')}`;
    explanation = counts.ok
      ? `Datos insuficientes: hacen falta registros en al menos dos ${m.weekly ? 'semanas distintas' : 'días distintos'} de ${windowTxt} para ver una tendencia.`
      : `Datos insuficientes para estimar: ${rangeTxt} (${windowTxt}). ${need}: ${missingText(counts, m.noun)}.`;
  } else {
    const fav = reg.slope * dir;
    if (!(fav > EPS)) {
      status = 'no_trend';
      const flat = Math.abs(trend.slopePerWeek) < 1e-6;
      explanation = `Con la tendencia actual no se acerca: ${m.metric === 'bodyweight' ? 'la media de 7 días' : `tu ${m.currentNoun}`} ${flat ? 'se mantiene' : `va en contra del objetivo (${trend.label})`} en ${windowTxt} (${plural(counts.records, m.noun[0], m.noun[1])}).`;
    } else {
      status = 'estimate';
      const gap = (target - current.value) * dir;
      eta = etaRange(gap, fav, reg.seSlope, today);
      explanation = `${m.nowText(current)}: faltan ${m.fmtGap(gap)}. Al ritmo de ${trend.label} (${plural(counts.records, m.noun[0], m.noun[1])} en ${windowTxt}), llegarías ${etaText(eta, today)}.`;
    }
  }

  const statusKey = ready ? 'ready' : status;
  const rule = `Solo se estima con ${plural(rules.minRecords, 'registro', 'registros')} o más en al menos ${plural(rules.minWeeks, 'semana distinta', 'semanas distintas')} (Ajustes › Umbrales). El rango sale de la pendiente ± 1 error típico, con un margen mínimo de ±20 % del tiempo restante; nunca es una fecha exacta.`;
  return {
    status,
    ready,
    statusLabel: STATUS_LABEL[statusKey],
    current: current ? current.value : null,
    target,
    start: startRec ? startRec.value : null,
    progressPct,
    eta,
    etaText: eta ? etaText(eta, today) : '',
    method: m.method,
    rule,
    dataUsed,
    explanation,
    warning: m.warning || null,
    metric: m.metric,
    dir,
    currentLabel: current ? fmt(current.value) : '—',
    currentNote: current ? currentNote(m, current, today) : 'sin registros',
    targetLabel: m.targetLabel,
    targetNote: m.targetNote,
    startLabel: startRec ? fmt(startRec.value) : '—',
    achievedOn: achieved ? achieved.date : null,
    trend,
    counts,
  };
}

function currentNote(m, cur, today) {
  const when = cur.stale ? `último registro ${fmtDay(cur.date, today)}` : fmtDay(cur.date, today);
  if (m.metric === 'bodyweight') return `media 7 días · ${fmtDay(cur.date, today)}`;
  if (m.metric === 'time') return `predicción · ${when}`;
  if (m.metric === 'e1rm' || m.metric === 'reps') return cur.src ? `${cur.src} · ${when}` : when;
  return `más larga · ${when}`;
}

/** Peso corporal: una fila por semana con la media de 7 días del último pesaje y el nº de pesajes. */
function weeklyBodyweight(recs, today) {
  const byWeek = new Map();
  for (const r of recs) {
    const w = weekStart(r.date);
    const cur = byWeek.get(w) || { week: w, n: 0, last: null };
    cur.n++;
    cur.last = r;
    byWeek.set(w, cur);
  }
  return [...byWeek.values()].map((w) => ({
    date: w.last.date,
    label: `Semana ${fmtWeekRange(w.week)}`,
    value: `media 7 días ${kgTxt(w.last.value)} el ${fmtDay(w.last.date, today)} (${plural(w.n, 'pesaje', 'pesajes')})`,
  }));
}

// ===========================================================================
// Formulario: título automático, validación y registro
// ===========================================================================

/** Emoji del objetivo (fuerza, deporte o peso). */
export function goalEmoji(goal) {
  if (!goal) return '🎯';
  if (goal.kind === 'endurance') return EMOJI[goal.sport] || EMOJI.run;
  return EMOJI[goal.kind] || '🎯';
}

/**
 * Título automático: «Remo con pecho apoyado 80 kg × 5», «Dominadas +10 kg × 5», «10 km en menos de 45 min»,
 * «40 km en bici en menos de 1 h 20 min», «Correr 15 km», «Subir a 80 kg».
 */
export function autoTitle(goal, exercise = null) {
  if (!goal) return '';
  if (goal.kind === 'strength') {
    if (!exercise) return ''; // sin ejercicio aún: el campo muestra su texto de ayuda
    const name = exercise.name;
    const lt = exercise.logType;
    const w = goalWeightText(lt, goal.weight);
    const reps = goal.reps >= 1 ? goal.reps : '—';
    return w && w !== '—' ? `${name} ${w} × ${reps}` : `${name} × ${reps}`;
  }
  if (goal.kind === 'endurance') {
    const sport = SPORT_IDS.includes(goal.sport) ? goal.sport : 'run';
    const named = fmtDistance(sport, goal.distanceKm, { named: true });
    const isNamed = sport === 'run' && (named === 'media maratón' || named === 'maratón');
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const distTxt = goal.distanceKm > 0 ? named : '—';
    if (goal.timeSec > 0) {
      const t = fmtTimeWords(goal.timeSec);
      if (sport === 'run') return `${isNamed ? cap(distTxt) : distTxt} en menos de ${t}`;
      if (sport === 'bike') return `${distTxt} en bici en menos de ${t}`;
      return `${distTxt} nadando en menos de ${t}`;
    }
    if (sport === 'run') return isNamed ? `Correr ${named === 'maratón' ? 'un maratón' : 'una media maratón'}` : `Correr ${distTxt}`;
    if (sport === 'bike') return `${distTxt} en bici`;
    return `Nadar ${distTxt}`;
  }
  if (goal.kind === 'bodyweight') {
    const kg = goal.targetKg > 0 ? kgTxt(goal.targetKg) : '—';
    if (goal.direction === 'down') return `Bajar a ${kg}`;
    if (goal.direction === 'up') return `Subir a ${kg}`;
    return `Peso corporal ${kg}`;
  }
  return 'Objetivo';
}

/**
 * Errores de un borrador de objetivo: { field: mensaje }. Campos: exerciseId, weight, reps, sport, distanceKm,
 * timeSec, targetKg, kind.
 */
export function validateGoal(goal, exercise = null) {
  const e = {};
  if (!goal || !GOAL_KINDS.some((k) => k.value === goal.kind)) { e.kind = 'Elige el tipo de objetivo.'; return e; }
  if (goal.kind === 'strength') {
    if (!goal.exerciseId || !exercise) e.exerciseId = 'Elige un ejercicio.';
    else if (!STRENGTH_LOG_TYPES.includes(exercise.logType)) e.exerciseId = `«${exercise.name}» no se registra con peso y repeticiones.`;
    const lt = exercise ? exercise.logType : 'weight_reps';
    if (lt === 'bodyweight') {
      if (goal.weight != null && (!isNum(goal.weight) || goal.weight < -200 || goal.weight > 300)) e.weight = 'Lastre entre −200 y 300 kg (negativo = asistencia).';
    } else if (!isNum(goal.weight) || !(goal.weight > 0) || goal.weight > 1000) e.weight = 'Indica un peso mayor que 0 kg.';
    if (!Number.isInteger(goal.reps) || goal.reps < 1 || goal.reps > 100) e.reps = 'Repeticiones entre 1 y 100.';
  } else if (goal.kind === 'endurance') {
    if (!SPORT_IDS.includes(goal.sport)) e.sport = 'Elige el deporte.';
    const max = goal.sport === 'swim' ? 50 : goal.sport === 'bike' ? 2000 : 500;
    if (!isNum(goal.distanceKm) || !(goal.distanceKm > 0)) e.distanceKm = 'Indica la distancia.';
    else if (goal.distanceKm > max) e.distanceKm = `Distancia demasiado larga (máximo ${fmtDistance(goal.sport, max)}).`;
    if (goal.timeSec != null && (!isNum(goal.timeSec) || !(goal.timeSec > 0) || goal.timeSec > 7 * 86400)) e.timeSec = 'Tiempo no válido.';
  } else if (goal.kind === 'bodyweight') {
    if (!isNum(goal.targetKg) || goal.targetKg < 20 || goal.targetKg > 300) e.targetKg = 'Peso objetivo entre 20 y 300 kg.';
    if (goal.direction != null && goal.direction !== 'up' && goal.direction !== 'down') e.direction = 'Elige subir o bajar.';
  }
  return e;
}

const KIND_FIELDS = {
  strength: ['exerciseId', 'weight', 'reps'],
  endurance: ['sport', 'distanceKm', 'timeSec'],
  bodyweight: ['targetKg', 'direction'],
};
const ALL_FIELDS = [...new Set(Object.values(KIND_FIELDS).flat())];

/**
 * Registro para guardar a partir de un borrador: solo los campos de su tipo (los demás, fuera), título
 * (automático si está vacío o titleAuto) y achievedAt/archived.
 */
export function goalRecord(draft, exercise = null, { id = null, now = Date.now() } = {}) {
  const g = { ...draft };
  delete g.dirty; // marca del borrador del formulario
  for (const k of ALL_FIELDS) if (!KIND_FIELDS[g.kind]?.includes(k)) delete g[k];
  if (g.kind === 'strength' && exercise && exercise.logType === 'bodyweight' && g.weight == null) g.weight = 0;
  if (g.kind === 'endurance' && !(g.timeSec > 0)) g.timeSec = null;
  const title = String(g.title || '').trim();
  // Sin el campo (copias antiguas): automático si el título coincide con el que se generaría.
  g.titleAuto = g.titleAuto === undefined ? !title || title === autoTitle(g, exercise) : g.titleAuto !== false || !title;
  g.title = g.titleAuto ? autoTitle(g, exercise) : title;
  if (id) g.id = id;
  if (!g.createdAt) g.createdAt = now;
  if (g.achievedAt === undefined) g.achievedAt = null;
  g.archived = !!g.archived;
  return g;
}

/** Reparte los objetivos: activos (ni archivados ni conseguidos), conseguidos y archivados; los más nuevos primero. */
export function splitGoals(goals) {
  const sorted = [...(goals || [])].filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return {
    active: sorted.filter((g) => !g.archived && !g.achievedAt),
    achieved: sorted.filter((g) => !g.archived && g.achievedAt),
    archived: sorted.filter((g) => g.archived),
  };
}
