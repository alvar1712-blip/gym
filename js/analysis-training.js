// analysis-training.js — «tu analista» de entrenamiento (ronda 5, docs/MEJORAS5.md §3b): fuerza, resistencia y
// recuperación. PROPIETARIO: módulo de análisis de entrenamiento. PURO: sin store, sin DOM; «hoy» inyectable. Se prueba
// en Node (tests/unit/analysis-training.test.mjs).
//
// ENTRADA `data` = progress-ui.dataFromStore(today) + `checkins` (+ `cycleDays`, que aquí no se usa: el ciclo llega
// ya resumido como CycleInfo en analyzeRecovery(…, { cycle })). Opciones comunes: { profile, today }; si falta
// `profile` se lee de data.settings (profile.getProfile) y si falta `today`, data.today (o la fecha de hoy).
//
// SALIDA: cada función devuelve sus números y `insights: Insight[]` (docs/MEJORAS5.md §3):
//   Insight = { id, area, level:'good'|'neutral'|'warn'|'info', priority 0..100, title, text,
//               why:{ rule, data:[{label, value}] }, sources:[{ short, detail }], action?:{ label, href } }
//   why.rule y why.data nunca van vacíos; sources SOLO de la lista del contrato (§5) — ver SOURCES.
//
// No duplica el panel semanal (insights.js): allí se dice qué ejercicio progresa o se estanca frente a lo inmediato
// y cuándo subir peso; aquí se mide el RITMO (pendiente robusta de 6–12 semanas), se compara con lo habitual para tu
// nivel, se estima el rendimiento de las próximas semanas y se sugiere qué probar, con la evidencia.
// Reutiliza stats.js (historial por ejercicio con 1RM estimado, series semanales por músculo, ritmos), race-predict.js
// (5 km previsto con Riegel), checkin-logic.js y profile.js; los umbrales de estancamiento y descarga salen de settings.
import { addDays, diffDays, weekStart, todayStr, isDateStr, fmtDate, fmtNum, fmtDuration, fmtPace, round } from './util.js';
import { isWorkSet, setMetrics, sessionDurationMin, pace } from './calc.js';
import { exercisesWithHistory, exerciseHistory, weeklySeries, runPaceSeries, dataRange, adherenceSeries, adherenceTotals } from './stats.js';
import { analyzeRuns, predictDistance, raceFor, MIN_KM as RUN_MIN_KM, MIN_PACE, MIN_VALID } from './race-predict.js';
import { getProfile, isFemale, g } from './profile.js';
import { checkinFor, level as ckLevel, checkinsBetween, isLowCheckin, areasOf } from './checkin-logic.js';
import { defaultSettings, MUSCLE_LABEL } from './seed.js';
import { formatSet, LOAD_REP_TYPES } from './session-logic.js';
import { exerciseRecovery, markLabel, markWhen } from './past-records-logic.js';
import { combine, byCount, bySpan, byNoise, capAt, insufficient as confInsufficient, confidenceRow, minLevel } from './confidence.js';

// ===========================================================================
// Constantes
// ===========================================================================

/** Fuentes que cita este módulo (todas de docs/MEJORAS5.md §5). */
export const SOURCES = {
  morton2018: { short: 'Morton et al., 2018', detail: 'Br J Sports Med · meta-análisis: proteína ≥ 1,6 g/kg/día (IC hasta ~2,2)' },
  schoenfeld2017: { short: 'Schoenfeld et al., 2017', detail: 'J Sports Sci · dosis-respuesta: ≥ 10 series/semana por músculo' },
  roberts2020: { short: 'Roberts et al., 2020', detail: 'J Strength Cond Res · mujeres y hombres ganan fuerza y músculo parecido en términos relativos' },
  helms2014: { short: 'Helms et al., 2014', detail: 'J Int Soc Sports Nutr · perder 0,5–1 % del peso por semana para conservar músculo' },
  seiler2010: { short: 'Seiler, 2010', detail: 'Int J Sports Physiol Perform · distribución de la intensidad en resistencia (~80 % suave)' },
  schumann2022: { short: 'Schumann et al., 2022', detail: 'Sports Med · entrenamiento concurrente: la fuerza máxima y la hipertrofia apenas se resienten; la potencia sí, sobre todo en la misma sesión' },
  eddens2018: { short: 'Eddens et al., 2018', detail: 'Sports Med · si van en la misma sesión, mejor la fuerza antes que la resistencia' },
  knowles2018: { short: 'Knowles et al., 2018', detail: 'J Sci Med Sport · dormir poco reduce la fuerza en ejercicios compuestos' },
  mcnulty2020: { short: 'McNulty et al., 2020', detail: 'Sports Med · meta-análisis: la fase del ciclo afecta de forma trivial y variable al rendimiento; enfoque individual' },
  colensoSemple2023: { short: 'Colenso-Semple et al., 2023', detail: 'Front Sports Act Living · sin efecto claro de la fase del ciclo en la fuerza ni en las adaptaciones' },
  // Ronda 6 (fase C; docs/MEJORAS6.md)
  lloyd2014: { short: 'Lloyd et al., 2014', detail: 'Br J Sports Med · consenso sobre fuerza en jóvenes: técnica, progresión gradual y supervisión cualificada' },
  fragala2019: { short: 'Fragala et al., 2019', detail: 'J Strength Cond Res · posición de la NSCA: fuerza en mayores, progresión individualizada y prudente' },
};

/** Ventanas posibles de la tendencia (semanas): la más corta con MIN_WINDOW_POINTS sesiones; si ninguna, 12. */
export const WINDOW_STEPS = [6, 8, 10, 12];
export const MIN_WINDOW_POINTS = 6;
/** Mínimo para calcular la tendencia de un ejercicio: 4 sesiones en 3 semanas distintas (≥ 14 días entre la primera y la última). */
export const MIN_SESSIONS = 4;
export const MIN_WEEKS = 3;
/** La última sesión del ejercicio tiene que ser de las últimas 4 semanas (si no, ya no se entrena). */
export const RECENT_DAYS = 28;
/** Parón: 4 semanas o más sin el ejercicio → la tendencia empieza después (como el panel semanal). */
export const GAP_DAYS = 28;
/**
 * Umbrales orientativos por experiencia (% del 1RM estimado por semana): bien ≥ good, rápido ≥ fast; cap = tope prudente
 * del ritmo en la previsión.
 */
export const THRESHOLDS = {
  beginner: { good: 0.75, fast: 1.5, cap: 2 },
  intermediate: { good: 0.25, fast: 0.75, cap: 1 },
  advanced: { good: 0.1, fast: 0.4, cap: 0.5 },
};
/** Bajando: pendiente ≤ −0,25 %/sem y caída total en la ventana ≥ 1,5 %. */
export const DOWN_PCT = 0.25;
export const DOWN_TOTAL_PCT = 1.5;
/** Rendimientos decrecientes: ganancia(t) = ritmo × τ × ln(1 + t/τ), τ = 8 semanas. */
export const TAU_WEEKS = 8;
export const FORECAST_WEEKS = [4, 8];
/** Ruido mínimo del 1RM estimado entre sesiones (1 %) para el rango de la previsión. */
export const MIN_NOISE = 0.01;

/** Resistencia: reparto de las últimas 4 semanas frente a ~80/20. */
export const INTENSITY_WEEKS = 4;
export const EASY_TARGET = 0.8;
export const EASY_SUBTYPES = ['z2', 'long', 'easy', 'route'];
export const HARD_SUBTYPES = ['intervals', 'tempo', 'race'];
export const ENDURANCE_KINDS = ['run', 'bike', 'swim', 'hike'];
/** Forma: 5 km previsto por bloques de 4 semanas (lunes a domingo), hasta 6 bloques. */
export const BLOCK_WEEKS = 4;
export const FITNESS_BLOCKS = 6;
/** Interferencia: se mira en 8 semanas y solo se comenta si se repite (≥ 2) y la última es de las 4 últimas semanas. */
export const INTERFERENCE_WEEKS = 8;
export const INTERFERENCE_MIN = 2;
/** Mismo día: cuenta si la resistencia termina menos de 3 h antes de empezar la fuerza (casi la misma sesión). */
export const SAME_DAY_HOURS = 3;
/** Recuperación: check-ins enlazados a sesiones de fuerza con rendimiento relativo (26 semanas). */
export const RECOVERY_WEEKS = 26;
export const MIN_LINKED = 8;
export const MIN_GROUP = 3;
/** Patrón claro: diferencia ≥ 3 % y tamaño del efecto (d de Cohen) ≥ 0,5. */
export const PATTERN_PCT = 3;
export const PATTERN_D = 0.5;
/** Rendimiento relativo: mejor 1RM estimado de la sesión / máximo de las 4 semanas previas del ejercicio. */
export const REL_DAYS = 28;
/**
 * Ronda 6 (fase C): ¿qué clase de mejora es? Recuperación: el nivel actual está por debajo de RECOVERY_BELOW_PCT % de tu
 * mejor referencia anterior (marca histórica o lo registrado antes de las últimas 4 semanas). Ejercicio nuevo: su primera
 * sesión es de hace menos de NEW_EXERCISE_DAYS días y no tiene marca histórica (mejora rápida por técnica).
 */
export const RECOVERY_BELOW_PCT = 97;
export const NEW_EXERCISE_DAYS = 42;
/** Confianza de la tendencia de un ejercicio: sesiones, días cubiertos y ruido entre sesiones (% del nivel). */
export const STRENGTH_CONF = { count: { low: MIN_SESSIONS, medium: 6, high: 8 }, span: { low: 14, medium: 28, high: 42 }, noisePct: { medium: 2.5, low: 4 } };
const KIND_LABEL = { recovery: 'recuperando', new_exercise: 'ejercicio nuevo', new_best: 'mejor marca', progress: 'mejora' };

const EPS = 1e-9;
const EXPERIENCE_IDS = ['beginner', 'intermediate', 'advanced'];
const KIND_NOUN = { run: 'carrera', bike: 'bici', swim: 'natación', hike: 'senderismo' };
const LEG_MUSCLES = ['quads', 'hamstrings', 'glutes'];
const ATHLETIC = ['power', 'sprint', 'carry', 'cardio'];

// ===========================================================================
// Utilidades puras
// ===========================================================================

/** Mediana de una lista de números (null si está vacía). */
export function median(xs) {
  const a = (xs || []).filter((v) => Number.isFinite(v)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const meanOf = (xs) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);
function sdOf(xs) {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((t, v) => t + (v - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Pendiente robusta de Theil–Sen: mediana de las pendientes entre todos los pares de puntos (con x distinta);
 * ordenada = mediana de y − pendiente·x. Un día raro (un 1RM disparado o hundido) apenas la mueve.
 * @param {{x:number, y:number}[]} points
 * @returns {{slope, intercept, n, residuals:number[], mad, sd, xMean, sxx}|null} sd = 1,4826 × MAD de los residuos
 *  (desviación típica robusta); xMean/sxx sirven para ensanchar el rango al extrapolar. null con < 2 puntos útiles.
 */
export function theilSen(points) {
  const pts = (points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 2) return null;
  const slopes = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = pts[j].x - pts[i].x;
      if (dx !== 0) slopes.push((pts[j].y - pts[i].y) / dx);
    }
  }
  if (!slopes.length) return null;
  const slope = median(slopes);
  const intercept = median(pts.map((p) => p.y - slope * p.x));
  const residuals = pts.map((p) => p.y - (intercept + slope * p.x));
  const mr = median(residuals);
  const mad = median(residuals.map((r) => Math.abs(r - mr)));
  const xMean = pts.reduce((t, p) => t + p.x, 0) / n;
  const sxx = pts.reduce((t, p) => t + (p.x - xMean) ** 2, 0);
  return { slope, intercept, n, residuals, mad, sd: 1.4826 * mad, xMean, sxx };
}

const toMap = (x) => {
  if (x instanceof Map) return x;
  if (Array.isArray(x)) return new Map(x.filter(Boolean).map((o) => [o.id, o]));
  return new Map(Object.entries(x || {}));
};
const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);

function optsOf(data, opts = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const today = isDateStr(opts.today) ? opts.today : isDateStr(d.today) ? d.today : todayStr();
  const profile = opts.profile || getProfile(d.settings);
  return { d, today, profile };
}

/** Experiencia del perfil; sin contestar → intermedio (assumed: true). */
export function experienceOf(profile) {
  const e = profile?.experience;
  return EXPERIENCE_IDS.includes(e) ? { id: e, assumed: false } : { id: 'intermediate', assumed: true };
}

function expLabel(p, id) {
  if (id === 'beginner') return 'principiante';
  if (id === 'advanced') return g(p, 'avanzado', 'avanzada');
  return g(p, 'intermedio', 'intermedia');
}

// ===========================================================================
// Formato (es-ES)
// ===========================================================================

const kg = (v) => `${fmtNum(v, 1)} kg`;
const pctTxt = (v, dec = 0) => `${fmtNum(v, dec)} %`;
/** «+1,1 %/sem», «+0,15 %/sem», «−0,4 %/sem». */
export function rateText(pct) {
  if (!Number.isFinite(pct)) return '—';
  const a = Math.abs(pct);
  const r = a < 1 ? round(a, 0.01) : round(a, 0.1);
  const sign = r === 0 ? '±' : pct > 0 ? '+' : '−';
  return `${sign}${fmtNum(r, a < 1 ? 2 : 1)} %/sem`;
}
const dayTxt = (d, today) => fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full');
const plural = (n, one, many) => `${fmtNum(n, 0)} ${n === 1 ? one : many}`;
function joinList(xs) {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const kgRange = (lo, hi) => (Math.abs(hi - lo) < EPS ? kg(lo) : `${fmtNum(lo, 1)}–${fmtNum(hi, 1)} kg`);
const weeksTxt = (w) => plural(w, 'semana', 'semanas');

/** Insight con why y sources siempre presentes. */
function insight(o) {
  const data = (o.data || []).filter(Boolean);
  // Al final de los datos: contexto tenido en cuenta y confianza (las filas de siempre no cambian de sitio).
  if (o.context?.length) data.push({ label: 'Contexto tenido en cuenta', value: o.context.join(' · ') });
  if (o.confidence) data.push(confidenceRow(o.confidence));
  const out = {
    id: o.id,
    area: o.area,
    level: o.level,
    priority: Math.max(0, Math.min(100, Math.round(o.priority))),
    title: o.title,
    text: o.text || [o.parts?.observation, o.parts?.interpretation, o.parts?.recommendation].filter(Boolean).join(' '),
    why: { rule: o.rule, data: data.length ? data : [{ label: 'Datos', value: 'sin datos en el periodo' }] },
    sources: (o.sources || []).filter(Boolean).map((s) => ({ short: s.short, detail: s.detail })),
  };
  if (o.action) out.action = o.action;
  if (o.confidence) out.confidence = { level: o.confidence.level, label: o.confidence.label, short: o.confidence.short, reasons: o.confidence.reasons };
  if (o.context?.length) out.context = o.context.slice();
  if (o.parts) out.parts = { ...o.parts };
  if (o.extra) Object.assign(out, o.extra);
  return out;
}

// ===========================================================================
// FUERZA
// ===========================================================================

/** ¿Ejercicio con 1RM estimado? (peso × reps, unilateral o peso corporal que no sea de core). */
function hasE1rm(ex) {
  return !!ex && LOAD_REP_TYPES.includes(ex.logType) && !(ex.logType === 'bodyweight' && ex.pattern === 'core');
}

/** Principal: compuesto con 1RM estimado (no pliometría, sprints, transporte ni cardio). */
export function isMainExercise(ex) {
  if (!hasE1rm(ex)) return false;
  if (ATHLETIC.includes(ex.pattern)) return false;
  if (ex.category) return ex.category === 'compound';
  return ex.pattern !== 'isolation' && ex.pattern !== 'core';
}

/** Mejor 1RM estimado de unas series recalculado con el peso corporal `bw` (ejercicios de peso corporal). */
function bestAtBw(sets, ex, bw) {
  let best = null;
  for (const st of sets || []) {
    if (!isWorkSet(st)) continue;
    const v = setMetrics(st, ex, bw).e1rm;
    if (v != null && (!best || v > best.value + EPS)) best = { value: v, set: st };
  }
  return best;
}

/**
 * Puntos del ejercicio (uno por día: el mejor 1RM estimado), hasta `today`. En peso corporal, todos con el peso
 * corporal de la última sesión (si solo cambia la báscula no hay tendencia; como el panel semanal).
 * @returns {{ points:{date, e1rm, set, sessionId}[], hist, lastPrDate, bwRef }}
 */
function exercisePoints(data, ex, today) {
  const hist = exerciseHistory(data, ex.id, { labels: false }).filter((e) => e.date <= today && e.e1rm != null);
  const isBw = ex.logType === 'bodyweight';
  const bwRef = isBw && hist.length && hist[hist.length - 1].bw > 0 ? hist[hist.length - 1].bw : null;
  const byDay = new Map();
  let lastPrDate = null;
  for (const e of hist) {
    let v = e.e1rm;
    let set = e.e1rmSet;
    if (bwRef != null) {
      const b = bestAtBw(e.sets, ex, bwRef);
      if (b) { v = b.value; set = b.set; }
    }
    if ((e.prs || []).includes('e1rm')) lastPrDate = e.date;
    const cur = byDay.get(e.date);
    if (!cur || v > cur.e1rm + EPS) byDay.set(e.date, { date: e.date, e1rm: v, set, sessionId: e.sessionId, sets: e.sets, bw: e.bw });
  }
  return { points: [...byDay.values()], hist, lastPrDate, bwRef };
}

/**
 * Tendencia de un ejercicio: tramo desde el último parón (≥ 4 semanas sin él), ventana de 6 a 12 semanas (la más corta
 * con al menos 6 sesiones; si ninguna, 12) y pendiente de Theil–Sen del mejor 1RM estimado por sesión.
 * @param {{date:string, e1rm:number}[]} points  en orden de fecha (uno por día)
 * @param {{today:string}} opts
 * @returns {{ ok, reason?, reasonText?, era, gapFrom, windowWeeks, from, points, n, weeks, spanDays, lastDate,
 *   slopePerDay?, ratePctPerWeek?, level?, startLevel?, totalChangePct?, residualSd?, residualPct?, fit? }}
 *  level = valor de la tendencia el día de la última sesión (tu nivel actual «limpio» de días buenos y malos).
 */
export function exerciseTrend(points, { today } = {}) {
  const all = (points || []).filter((p) => p && isDateStr(p.date) && p.e1rm > 0 && (!today || p.date <= today))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let start = 0;
  for (let i = 1; i < all.length; i++) if (diffDays(all[i - 1].date, all[i].date) >= GAP_DAYS) start = i;
  const era = all.slice(start);
  const gapFrom = start > 0 ? all[start - 1].date : null;
  const ref = today || (all.length ? all[all.length - 1].date : todayStr());
  let windowWeeks = WINDOW_STEPS[WINDOW_STEPS.length - 1];
  let from = addDays(ref, -(windowWeeks * 7 - 1));
  let pts = era.filter((p) => p.date >= from);
  for (const w of WINDOW_STEPS) {
    const f = addDays(ref, -(w * 7 - 1));
    const inWin = era.filter((p) => p.date >= f);
    if (inWin.length >= MIN_WINDOW_POINTS) { windowWeeks = w; from = f; pts = inWin; break; }
  }
  const n = pts.length;
  const weeks = new Set(pts.map((p) => weekStart(p.date))).size;
  const spanDays = n ? diffDays(pts[0].date, pts[n - 1].date) : 0;
  const lastDate = all.length ? all[all.length - 1].date : null;
  const base = { era, gapFrom, windowWeeks, from, points: pts, n, weeks, spanDays, lastDate };
  if (!lastDate || diffDays(lastDate, ref) >= RECENT_DAYS) {
    return { ok: false, reason: 'old', reasonText: `sin sesiones en las últimas ${RECENT_DAYS / 7} semanas`, ...base };
  }
  if (n < MIN_SESSIONS) {
    return { ok: false, reason: 'sessions', reasonText: `${plural(n, 'sesión', 'sesiones')} en ${weeksTxt(windowWeeks)}${gapFrom ? ' desde el parón' : ''} (hacen falta ${MIN_SESSIONS})`, ...base };
  }
  if (weeks < MIN_WEEKS || spanDays < (MIN_WEEKS - 1) * 7) {
    return { ok: false, reason: 'weeks', reasonText: `sesiones en solo ${weeksTxt(weeks)} (hacen falta ${MIN_WEEKS} semanas distintas)`, ...base };
  }
  const x0 = pts[0].date;
  const xy = pts.map((p) => ({ x: diffDays(x0, p.date), y: p.e1rm }));
  const fit = theilSen(xy);
  if (!fit) return { ok: false, reason: 'sessions', reasonText: 'sin variación en el tiempo', ...base };
  const xLast = xy[xy.length - 1].x;
  const level = fit.intercept + fit.slope * xLast;
  const startLevel = fit.intercept;
  if (!(level > 0)) return { ok: false, reason: 'sessions', reasonText: 'datos incoherentes', ...base };
  const ratePctPerWeek = ((fit.slope * 7) / level) * 100;
  const totalChangePct = startLevel > 0 ? ((level - startLevel) / startLevel) * 100 : 0;
  return {
    ok: true, ...base, fit, xLast, slopePerDay: fit.slope, ratePctPerWeek, level, startLevel, totalChangePct,
    residualSd: fit.sd, residualPct: (fit.sd / level) * 100,
  };
}

/**
 * Estancamiento con los umbrales del panel semanal (settings.stall): sin mejora en las últimas S sesiones frente a las
 * S anteriores, o en las últimas W semanas frente a las W anteriores (con ≥ 2 sesiones en el tramo). Una sesión mejora
 * si supera a la referencia y a las anteriores del tramo. `era` = puntos desde el último parón, en orden.
 * @returns {{ stalled, bySessions, byWeeks, S, W, best:{date, e1rm}|null }}
 */
export function stallState(era, today, stall = {}) {
  const def = defaultSettings().stall;
  const S = Math.max(1, Math.round(Number(stall.sessions) || def.sessions));
  const W = Math.max(1, Math.round(Number(stall.weeks) || def.weeks));
  const pts = era || [];
  const n = pts.length;
  const improved = (tramo, refs) => tramo.some((e, i) => {
    let best = null;
    for (const r of refs.concat(tramo.slice(0, i))) if (best == null || r.e1rm > best) best = r.e1rm;
    return best != null && e.e1rm > best + EPS;
  });
  const lastS = pts.slice(-S);
  const prevS = pts.slice(Math.max(0, n - 2 * S), n - lastS.length);
  const from = addDays(today, -7 * W + 1);
  const priorFrom = addDays(from, -7 * W);
  const win = pts.filter((p) => p.date >= from);
  const prior = pts.filter((p) => p.date >= priorFrom && p.date < from);
  const fresh = n < 3;
  const bySessions = !fresh && prevS.length > 0 && !improved(lastS, prevS);
  const byWeeks = !fresh && prior.length > 0 && win.length >= 2 && !improved(win, prior);
  let best = null;
  for (const p of pts) if (!best || p.e1rm > best.e1rm + EPS) best = { date: p.date, e1rm: p.e1rm };
  return { stalled: bySessions || byWeeks, bySessions, byWeeks, S, W, best };
}

/**
 * Estado según el ritmo y la experiencia: bajando (≤ −0,25 %/sem y caída ≥ 1,5 % en la ventana) → down; estancado
 * (settings.stall) o sin tendencia al alza (≤ 0) → stalled; ≥ fast → fast; ≥ good → good; por debajo de good pero
 * subiendo y sin estancamiento → good con slow:true (mejora, despacio para tu nivel).
 * @returns {{ status:'fast'|'good'|'stalled'|'down', slow:boolean, byTrend:boolean }}
 */
export function strengthStatus({ ratePctPerWeek, totalChangePct = null, stalled = false }, experience = 'intermediate') {
  const t = THRESHOLDS[experience] || THRESHOLDS.intermediate;
  const r = ratePctPerWeek;
  const drop = totalChangePct == null ? r * 4 : totalChangePct;
  if (r <= -DOWN_PCT + EPS && drop <= -DOWN_TOTAL_PCT + EPS) return { status: 'down', slow: false, byTrend: false };
  if (stalled) return { status: 'stalled', slow: false, byTrend: false };
  if (r <= 0) return { status: 'stalled', slow: false, byTrend: true };
  if (r >= t.fast - EPS) return { status: 'fast', slow: false, byTrend: false };
  if (r >= t.good - EPS) return { status: 'good', slow: false, byTrend: false };
  return { status: 'good', slow: true, byTrend: false };
}

/**
 * Previsión del 1RM estimado a `weeks` semanas desde hoy con rendimientos decrecientes:
 *   medio = nivel × (1 + r × τ × ln(1 + t/τ)), t = semanas desde la última sesión, τ = 8;
 *   r = ritmo de la tendencia (estancado → como mucho 0), limitado a ±tope por experiencia.
 * Rango: ± √(ep² + (½·ganancia)²), con ep = ruido de los residuos (Theil–Sen, mínimo 1 %) × √(1 + 1/n + (x−x̄)²/Sxx)
 * (crece al alejarse de los datos) y media ganancia prevista como incertidumbre del modelo (el tope limita el ritmo y,
 * con él, el valor medio). low hacia abajo, high hacia arriba y medio al más cercano, a 0,5 kg.
 * @returns {{weeks, date, low, mid, high, rateUsed}[]}
 */
export function forecastE1rm(trend, { today, experience = 'intermediate', status = 'good', weeks = FORECAST_WEEKS } = {}) {
  if (!trend || !trend.ok) return [];
  const capPct = (THRESHOLDS[experience] || THRESHOLDS.intermediate).cap;
  let r = trend.ratePctPerWeek / 100;
  if (status === 'stalled') r = Math.min(r, 0);
  r = Math.max(-capPct / 100, Math.min(capPct / 100, r));
  const L = trend.level;
  const lead = Math.max(0, diffDays(trend.lastDate, today) / 7);
  const noise = Math.max(trend.residualSd || 0, MIN_NOISE * L);
  const decay = (t) => TAU_WEEKS * Math.log(1 + t / TAU_WEEKS);
  return weeks.map((w) => {
    const t = lead + w;
    const gain = L * r * decay(t);
    const capHigh = L * (1 + (capPct / 100) * decay(t));
    const x = trend.xLast + t * 7;
    const fit = trend.fit;
    const lev = fit && fit.sxx > 0 ? (x - fit.xMean) ** 2 / fit.sxx : 0;
    const ep = noise * Math.sqrt(1 + 1 / trend.n + lev);
    const hw = Math.sqrt(ep ** 2 + (0.5 * gain) ** 2);
    const midExact = Math.min(L + gain, capHigh);
    const low = Math.floor((midExact - hw) * 2 + EPS) / 2;
    const high = Math.ceil((midExact + hw) * 2 - EPS) / 2;
    const mid = Math.min(Math.max(Math.round(midExact * 2) / 2, low), high);
    return { weeks: w, date: addDays(today, w * 7), low, mid, high, rateUsed: r * 100 };
  });
}

/** Media de series semanales por músculo en las 4 semanas completas anteriores (sin las previas al primer registro). */
function muscleAverages(d, today) {
  const cw = weekStart(today);
  const first = dataRange(d).firstSession;
  if (!first) return { weeks: 0, avg: {} };
  const firstW = weekStart(first);
  const rows = weeklySeries(d, addDays(cw, -28), addDays(cw, -7)).filter((r) => r.week >= firstW);
  const avg = {};
  for (const r of rows) for (const [m, v] of Object.entries(r.muscleSets || {})) avg[m] = (avg[m] || 0) + v;
  for (const m of Object.keys(avg)) avg[m] /= rows.length || 1;
  return { weeks: rows.length, avg };
}

function targetsOf(settings) {
  const t = settings && settings.muscleTargets && typeof settings.muscleTargets === 'object' ? settings.muscleTargets : defaultSettings().muscleTargets;
  return t;
}

/** Señales de fatiga (para sugerir descarga): RPE de fuerza alto sostenido y check-ins bajos (settings.deload). */
function fatigueSignals(d, today) {
  const dl = { ...defaultSettings().deload, ...((d.settings && d.settings.deload) || {}) };
  const W = Math.max(1, Math.round(dl.weeks));
  const from = addDays(today, -7 * W + 1);
  const rpe = toArr(d.sessions).filter((s) => s && s.kind === 'strength' && s.status === 'done' && s.date >= from && s.date <= today && s.rpe >= 1);
  const rpeMean = rpe.length ? meanOf(rpe.map((s) => s.rpe)) : null;
  const rpeHigh = rpe.length >= 2 && rpeMean >= dl.rpeHigh - EPS;
  const cks = checkinsBetween(d.checkins, from, today);
  const lows = cks.filter(isLowCheckin).length;
  const ckLow = cks.length >= 2 && lows * 2 >= cks.length;
  return { W, from, rpeMean, rpeCount: rpe.length, rpeHigh, rpeLimit: dl.rpeHigh, checkins: cks.length, lows, ckLow, any: rpeHigh || ckLow };
}

/** Último peso corporal registrado hasta hoy (kg) o null. */
function lastBodyweight(d, today) {
  let best = null;
  for (const b of toArr(d.bodyweight)) {
    if (!b || !(b.kg > 0) || !isDateStr(b.id) || b.id > today) continue;
    if (!best || b.id > best.id) best = b;
  }
  return best ? best.kg : null;
}

/** Ronda 6 (fase D): veces con agujetas fuertes (≥ level/10) por músculo en los check-ins de los últimos `days` días. */
export function strongDomsByMuscle(d, today, { level = 7, days = 14 } = {}) {
  const out = new Map();
  for (const c of checkinsBetween(d.checkins, addDays(today, -(days - 1)), today)) {
    for (const a of areasOf(c)) if (a.kind === 'muscle' && a.level >= level) out.set(a.zone, (out.get(a.zone) || 0) + 1);
  }
  return out;
}

/** Ronda 6 (fase D): constancia de las 4 semanas completas anteriores (planificado frente a hecho). low: < 70 % con ≥ 4 planificadas. */
export function adherence4w(d, today) {
  const ws = weekStart(today);
  const t = adherenceTotals(adherenceSeries(d, addDays(ws, -28), addDays(ws, -1)));
  return { ...t, low: t.pctPast != null && t.planned >= 4 && t.pctPast < 70 };
}

/** Repeticiones típicas (mediana) de las series de trabajo de las últimas 3 sesiones. */
function typicalReps(pointsEra, ex) {
  const reps = [];
  for (const p of pointsEra.slice(-3)) for (const st of p.sets || []) if (isWorkSet(st)) { const r = setMetrics(st, ex, p.bw).reps; if (r >= 1) reps.push(r); }
  return median(reps);
}

function repRangeTip(reps) {
  if (reps == null) return 'otro rango de repeticiones 3–4 semanas';
  const r = Math.round(reps);
  if (r <= 6) return `otro rango de repeticiones 3–4 semanas (sueles hacer ~${r}: prueba 8–10 con algo menos de peso)`;
  if (r >= 10) return `otro rango de repeticiones 3–4 semanas (sueles hacer ~${r}: prueba 5–8 con más peso)`;
  return `otro rango de repeticiones 3–4 semanas (sueles hacer ~${r}: prueba 4–6 o 10–12)`;
}

function proteinText(bwKg) {
  if (!(bwKg > 0)) return 'proteína (1,6–2,2 g/kg al día)';
  return `proteína (1,6–2,2 g/kg al día: ≈ ${fmtNum(round(bwKg * 1.6, 5), 0)}–${fmtNum(round(bwKg * 2.2, 5), 0)} g para tus ${fmtNum(bwKg, 1)} kg)`;
}

const STATUS_LABEL = { fast: 'rápido', good: 'bien', stalled: 'estancado', down: 'bajando', insufficient: 'sin datos suficientes' };

/** Confianza de la tendencia de un ejercicio (sesiones, semanas y ruido) más factores extra. */
export function trendConfidence(trend, extra = []) {
  if (!trend || !trend.ok) return confInsufficient(trend?.reasonText || 'sin datos suficientes');
  return combine([
    byCount(trend.n, STRENGTH_CONF.count, (k) => plural(k, 'sesión', 'sesiones'), 'count'),
    bySpan(trend.spanDays, STRENGTH_CONF.span),
    byNoise(trend.residualPct, STRENGTH_CONF.noisePct, (r) => `variación entre sesiones de ±${fmtNum(r, 1)} %`),
    ...extra,
  ]);
}

/**
 * Clase de mejora de un ejercicio que mejora (fast/good): 'recovery' (por debajo de tu mejor referencia anterior),
 * 'new_exercise' (empezado hace < 6 semanas, sin marca histórica), 'new_best' (≥ 100 % de la referencia) o 'progress'.
 * Sin tendencia → 'insufficient'; estancado o bajando → null.
 */
export function progressKind({ trend, status, recovery, firstDate, today }) {
  if (!trend?.ok) return 'insufficient';
  if (status !== 'fast' && status !== 'good') return null;
  if (recovery?.status === 'ok' && recovery.pct < RECOVERY_BELOW_PCT) return 'recovery';
  const hasMarks = (recovery?.marks || []).length > 0;
  if (!hasMarks && firstDate && diffDays(firstDate, today) < NEW_EXERCISE_DAYS) return 'new_exercise';
  if (recovery?.status === 'ok' && recovery.pct >= 100) return 'new_best';
  return 'progress';
}

/** Referencia de la recuperación en texto: «100 kg × 5 · verano 2025 (marca histórica)» · «80 kg × 8 @2 · 12 mar (en Entreno)». */
function referenceLabel(rec, ex, today) {
  const ref = rec?.reference;
  if (!ref) return null;
  if (ref.source === 'mark') return `${markLabel(ref.mark.record, ex.logType)} · ${markWhen(ref.mark.record)} (marca histórica)`;
  return `${formatSet(ref.entry.e1rmSet, ex.logType, { kg: true })} · ${dayTxt(ref.entry.date, today)} (en Entreno)`;
}

/**
 * Fuerza: ritmo de mejora por ejercicio, comparación con lo habitual para tu experiencia y previsión a 4 y 8 semanas.
 * @param {object} data  progress-ui.dataFromStore(today) + checkins
 * @param {{profile?:object, today?:string}} [opts]
 * @returns {{ exercises:{ exerciseId, name, sessions, e1rmNow, ratePctPerWeek, status, lastPrDate,
 *   forecast:{weeks, date, low, mid, high}[], main, slow, windowWeeks, e1rmStart, e1rmBest, reason?, stall? }[],
 *   summary:{ trendPctPerWeek, improving, stalled, down, mainCount, analyzed, experience, experienceAssumed },
 *   insights: Insight[] }}
 *  summary.* cuenta los ejercicios principales (compuestos) con tendencia; si no hay ninguno, todos los que la tienen.
 */
export function analyzeStrength(data, opts = {}) {
  const { d, today, profile: p } = optsOf(data, opts);
  const exp = experienceOf(p);
  const th = THRESHOLDS[exp.id];
  const settings = d.settings || {};
  const context = opts.context || null;
  const age = context?.age?.group || 'unknown';
  const env = { bodyweight: d.bodyweight || [], context: d.context || [], fallbackKg: settings.bodyweightDefault ?? 75 };
  const routineChange = (context?.changes || []).find((c) => c.type === 'routine_change' && diffDays(c.date, today) <= 28) || null;
  const exercises = [];
  const ctx = [];
  for (const it of exercisesWithHistory(d)) {
    const ex = it.exercise;
    if (!ex || ex.archived || !hasE1rm(ex)) continue;
    const { points, lastPrDate, hist } = exercisePoints(d, ex, today);
    if (!points.length) continue;
    if (diffDays(points[points.length - 1].date, today) >= WINDOW_STEPS[WINDOW_STEPS.length - 1] * 7) continue;
    const trend = exerciseTrend(points, { today });
    const main = isMainExercise(ex);
    const recovery = exerciseRecovery({ exercise: ex, marks: d.pastRecords || [], history: hist, today, env });
    const row = {
      exerciseId: ex.id, name: ex.name || ex.id, sessions: trend.n, e1rmNow: null, ratePctPerWeek: null, status: 'insufficient',
      lastPrDate, forecast: [], main, slow: false, windowWeeks: trend.windowWeeks, logType: ex.logType,
      firstDate: hist[0]?.date ?? null, kind: 'insufficient',
      recovery: recovery.reference ? {
        status: recovery.status, pct: recovery.pct, refSource: recovery.reference.source, refE1rm: round(recovery.reference.e1rm, 0.1),
        refLabel: referenceLabel(recovery, ex, today), hasMarks: recovery.marks.length > 0,
      } : null,
    };
    row.confidence = trendConfidence(trend, routineChange ? [capAt('medium', 'cambiaste de rutina hace poco', 'routine')] : []);
    if (!trend.ok) {
      row.reason = trend.reasonText;
      exercises.push(row);
      continue;
    }
    const stall = stallState(trend.era, today, settings.stall);
    const st = strengthStatus({ ratePctPerWeek: trend.ratePctPerWeek, totalChangePct: trend.totalChangePct, stalled: stall.stalled }, exp.id);
    row.e1rmNow = round(trend.level, 0.1);
    row.e1rmStart = round(trend.startLevel, 0.1);
    row.e1rmBest = round(Math.max(...trend.points.map((q) => q.e1rm)), 0.1);
    row.ratePctPerWeek = round(trend.ratePctPerWeek, 0.01);
    row.status = st.status;
    row.slow = st.slow;
    row.stall = { bySessions: stall.bySessions, byWeeks: stall.byWeeks, byTrend: st.byTrend, best: stall.best, S: stall.S, W: stall.W };
    row.kind = progressKind({ trend, status: st.status, recovery, firstDate: row.firstDate, today });
    // Previsión: sin cifras para menores; con el tope prudente de «avanzado» a partir de 65; recuperando, hasta tu referencia.
    if (age !== 'minor') {
      row.forecast = forecastE1rm(trend, { today, experience: age === 'senior' ? 'advanced' : exp.id, status: st.status });
      if (row.kind === 'recovery' && row.recovery) {
        const cap = Math.ceil(row.recovery.refE1rm * 2) / 2;
        row.forecast = row.forecast.map((f) => {
          if (f.high <= cap) return f;
          const high = Math.max(cap, Math.ceil(row.e1rmNow * 2) / 2);
          const mid = Math.min(f.mid, high);
          return { ...f, high, mid, low: Math.min(f.low, mid), capped: true };
        });
      }
    }
    exercises.push(row);
    ctx.push({ row, ex, trend, stall, st, recovery });
  }
  const order = { fast: 0, good: 1, stalled: 2, down: 3, insufficient: 4 };
  exercises.sort((a, b) => (a.status === 'insufficient') - (b.status === 'insufficient') || (b.main - a.main)
    || (a.status === 'insufficient' ? b.sessions - a.sessions : (b.ratePctPerWeek - a.ratePctPerWeek)) || (order[a.status] - order[b.status])
    || a.name.localeCompare(b.name, 'es'));

  const analyzed = exercises.filter((x) => x.status !== 'insufficient');
  const mains = analyzed.filter((x) => x.main);
  const base = mains.length ? mains : analyzed;
  const improvingBase = base.filter((x) => x.status === 'fast' || x.status === 'good');
  const summary = {
    trendPctPerWeek: base.length ? round(median(base.map((x) => x.ratePctPerWeek)), 0.01) : null,
    improving: improvingBase.length,
    recovering: improvingBase.filter((x) => x.kind === 'recovery').length,
    newExercises: improvingBase.filter((x) => x.kind === 'new_exercise').length,
    newBest: improvingBase.filter((x) => x.kind === 'new_best').length,
    recoveryShare: improvingBase.length ? round(improvingBase.filter((x) => x.kind === 'recovery').length / improvingBase.length, 0.01) : null,
    stalled: base.filter((x) => x.status === 'stalled').length,
    down: base.filter((x) => x.status === 'down').length,
    mainCount: base.length,
    mainOnly: mains.length > 0,
    analyzed: analyzed.length,
    experience: exp.id,
    experienceAssumed: exp.assumed,
  };
  const insights = strengthInsights({ d, today, p, exp, th, exercises, analyzed, base, summary, ctx, context, age });
  return { exercises, summary, insights };
}

function strengthRule(p, exp, th) {
  const lvl = expLabel(p, exp.id);
  return `Para cada ejercicio se toma el mejor 1RM estimado de cada sesión (Epley con repeticiones + RIR, series de 1 a 12 repeticiones; en peso corporal, todas las sesiones con tu peso corporal más reciente) y se calcula su pendiente robusta (Theil–Sen: la mediana de las pendientes entre cada par de sesiones, así un día raro apenas cuenta) en la ventana más corta de ${WINDOW_STEPS[0]} a ${WINDOW_STEPS[WINDOW_STEPS.length - 1]} semanas con al menos ${MIN_WINDOW_POINTS} sesiones (si no, ${WINDOW_STEPS[WINDOW_STEPS.length - 1]}; tras un parón de ${GAP_DAYS / 7} semanas o más, desde el parón). Hacen falta al menos ${MIN_SESSIONS} sesiones en ${MIN_WEEKS} semanas distintas y alguna en las últimas ${RECENT_DAYS / 7}. El ritmo es la pendiente semanal en % de tu nivel actual. Umbrales orientativos para tu nivel (${lvl}${exp.assumed ? g(p, '; sin experiencia en el perfil se usa intermedio', '; sin experiencia en el perfil se usa intermedia') : ''}): bien desde ${rateText(th.good)}, rápido desde ${rateText(th.fast)} (principiante 0,75 / 1,5; ${g(p, 'intermedio', 'intermedia')} 0,25 / 0,75; ${g(p, 'avanzado', 'avanzada')} 0,1 / 0,4). Estancado: sin mejora en las últimas sesiones o semanas (Ajustes › Umbrales › Estancamiento) o sin tendencia al alza. Bajando: ${rateText(-DOWN_PCT)} o menos y una caída de ${fmtNum(DOWN_TOTAL_PCT, 1)} % o más en la ventana. Los ejercicios principales son los compuestos.${isFemale(p) ? ' Las mujeres progresan en términos relativos de forma parecida a los hombres, así que los umbrales en % son los mismos.' : ''}`;
}

function exRow(x, p) {
  const tag = x.status === 'good' && x.slow ? 'bien, despacio para tu nivel' : STATUS_LABEL[x.status];
  return { label: x.name, value: `${rateText(x.ratePctPerWeek)} · 1RM est. ${kg(x.e1rmNow)} · ${plural(x.sessions, 'sesión', 'sesiones')} en ${weeksTxt(x.windowWeeks)} · ${tag}` };
}

/** Confianza de un grupo de ejercicios: la del más débil, con un mínimo de ejercicios para «alta». */
function groupConfidence(rows, minHigh = 1) {
  const fs = rows.flatMap((x) => x.confidence?.factors || []);
  if (rows.length < minHigh) fs.push(capAt('medium', `solo ${plural(rows.length, 'ejercicio', 'ejercicios')}`, 'exercises'));
  return combine(fs);
}

/** Calidad de la referencia de una recuperación (marca sin fecha o con fecha aproximada). */
function referenceFactors(row, c) {
  const ref = c?.recovery?.reference;
  if (!ref || ref.source !== 'mark') return [];
  const r = ref.mark.record;
  if (!r.date) return [capAt('low', 'la marca histórica no tiene fecha', 'refdate')];
  if (r.date.precision === 'year' || r.date.precision === 'season') return [capAt('medium', `fecha de la marca aproximada (${markWhen(r)})`, 'refdate')];
  return [];
}

function strengthInsights({ d, today, p, exp, th, exercises, analyzed, base, summary, ctx, context = null, age = 'unknown' }) {
  const out = [];
  const minor = age === 'minor';
  const senior = age === 'senior';
  const ctxNotes = [];
  if (context?.training?.returning && context.training.since) ctxNotes.push(`vuelta a entrenar desde el ${dayTxt(context.training.since, today)}`);
  const rc = (context?.changes || []).find((c) => c.type === 'routine_change' && diffDays(c.date, today) <= 28);
  if (rc) ctxNotes.push(`cambio de rutina el ${dayTxt(rc.date, today)}`);
  if (minor) ctxNotes.push('menos de 18 años');
  else if (senior) ctxNotes.push('65 años o más');
  const lvl = expLabel(p, exp.id);
  const rule = strengthRule(p, exp, th);
  const female = isFemale(p);
  const profileAction = exp.assumed ? { label: 'Completar perfil', href: '#/settings/profile' } : null;
  const byId = new Map(ctx.map((c) => [c.row.exerciseId, c]));
  const progAction = (id) => ({ label: 'Ver progreso', href: `#/progress/exercise/${id}` });

  if (!analyzed.length) {
    if (!exercises.length) return out;
    const near = exercises.filter((x) => x.sessions > 0 && !/^sin sesiones/.test(x.reason || '')).slice(0, 3);
    const allOld = exercises.every((x) => /^sin sesiones/.test(x.reason || ''));
    out.push(insight({
      id: 'strength-insufficient', area: 'strength', level: 'info', priority: 12,
      confidence: confInsufficient(`ningún ejercicio con ${MIN_SESSIONS} sesiones en ${MIN_WEEKS} semanas distintas`),
      title: 'Aún faltan datos para ver tu ritmo en fuerza',
      text: allOld
        ? `Hace más de ${RECENT_DAYS / 7} semanas que no registras ejercicios con peso: cuando retomes, en ${MIN_WEEKS} semanas verás a qué ritmo mejoras.`
        : `Para medir cómo mejoras hacen falta al menos ${MIN_SESSIONS} sesiones de un ejercicio en ${MIN_WEEKS} semanas distintas.${near.length ? ` Lo que más se acerca: ${joinList(near.map((x) => `${x.name} (${plural(x.sessions, 'sesión', 'sesiones')})`))}.` : ''}`,
      rule, data: exercises.slice(0, 8).map((x) => ({ label: x.name, value: x.reason || STATUS_LABEL.insufficient })),
      action: profileAction,
    }));
    return out;
  }

  // --- Resumen global ------------------------------------------------------
  const improving = base.filter((x) => x.status === 'fast' || x.status === 'good');
  const top = [...improving].sort((a, b) => b.ratePctPerWeek - a.ratePctPerWeek)[0] || null;
  const M = base.length;
  const noun = summary.mainOnly ? (M === 1 ? 'ejercicio principal' : 'ejercicios principales') : (M === 1 ? 'ejercicio' : 'ejercicios');
  let text;
  if (!improving.length) text = `No mejoras de forma clara en ${M === 1 ? `tu ${noun} con datos suficientes` : `ninguno de tus ${M} ${noun}`}.`;
  else if (M === 1) text = `Vas mejorando en tu ${noun} con datos suficientes: ${top.name} ${rateText(top.ratePctPerWeek)}.`;
  else text = `Vas mejorando en ${improving.length} de ${M} ${noun}; el que más, ${top.name} ${rateText(top.ratePctPerWeek)}.`;
  const med = summary.trendPctPerWeek;
  if (med != null && M >= 2) {
    const where = med >= th.fast - EPS ? 'por encima de lo habitual' : med >= th.good - EPS ? 'dentro de lo habitual' : 'por debajo de lo habitual';
    text += ` Tu ritmo típico es ${rateText(med)}, ${where} para tu nivel (${lvl}: ${rateText(th.good).replace('/sem', '')} a ${rateText(th.fast)}).`;
  }
  const bits = [];
  if (summary.stalled) bits.push(plural(summary.stalled, 'estancado', 'estancados'));
  if (summary.down) bits.push(`${fmtNum(summary.down, 0)} bajando`);
  if (bits.length) text += ` ${cap(joinList(bits))}: en cada uno tienes qué probar.`;
  // Ronda 6: ¿qué clase de mejora es? Recuperar marcas anteriores o empezar un ejercicio no es tu ritmo de fondo.
  const recN = summary.recovering || 0;
  const newN = summary.newExercises || 0;
  if (improving.length && recN) {
    text += med != null && med >= th.fast - EPS && recN * 2 >= improving.length
      ? ` No estás necesariamente progresando a ${rateText(med)} por encima de tu nivel: en ${recN === improving.length ? (recN === 1 ? 'ese ejercicio' : 'todos ellos') : plural(recN, 'ejercicio', 'ejercicios')} sigues por debajo de tu mejor marca anterior, así que estás recuperando rendimiento que ya habías alcanzado.`
      : ` En ${plural(recN, 'ejercicio', 'ejercicios')} sigues por debajo de tu mejor marca anterior: es compatible con recuperar rendimiento que ya tenías.`;
  }
  if (improving.length && newN) text += ` ${newN === 1 ? 'Un ejercicio es nuevo' : `${fmtNum(newN, 0)} ejercicios son nuevos`} (menos de 6 semanas): al principio se mejora rápido por técnica.`;
  if (minor) text += ' Con menos de 18 años lo importante es la técnica, la constancia y subir poco a poco, mejor con supervisión.';
  else if (senior) text += ' A partir de los 65, mejor progresar con calma: técnica, constancia y recuperarte bien entre sesiones.';
  if (exp.assumed) text += ' Indica tu experiencia en el perfil para afinar la comparación.';
  const lvlSum = summary.down * 2 >= M && summary.down > 0 ? 'warn' : improving.length * 2 >= M ? 'good' : 'neutral';
  out.push(insight({
    id: 'strength-summary', area: 'strength', level: lvlSum, priority: lvlSum === 'warn' ? 70 : 62,
    title: improving.length ? `Mejoras en ${improving.length} de ${M} ${noun}` : `Sin mejoras claras en tus ${noun}`,
    text, rule, confidence: groupConfidence(base, 2), context: ctxNotes,
    data: [
      { label: 'Nivel usado', value: exp.assumed ? g(p, 'Intermedio (sin experiencia en el perfil)', 'Intermedia (sin experiencia en el perfil)') : cap(lvl) },
      { label: 'Ritmo típico (mediana)', value: med != null ? rateText(med) : '—' },
      ...base.map((x) => exRow(x, p)),
    ],
    sources: [female ? SOURCES.roberts2020 : null, minor ? SOURCES.lloyd2014 : null, senior ? SOURCES.fragala2019 : null],
    action: profileAction,
  }));

  // --- Recuperación de marcas anteriores (ronda 6) -------------------------------
  const recList = analyzed.filter((x) => x.kind === 'recovery').sort((a, b) => (b.main - a.main) || a.recovery.pct - b.recovery.pct).slice(0, 3);
  if (recList.length) {
    const x0 = recList[0];
    const one = recList.length === 1;
    const conf = combine(recList.flatMap((x) => [...(x.confidence?.factors || []), ...referenceFactors(x, byId.get(x.exerciseId))]));
    out.push(insight({
      id: 'strength-recovery', area: 'strength', level: 'good', priority: 56,
      title: one ? `${x0.name}: recuperando tu marca anterior` : 'Recuperando marcas anteriores',
      parts: {
        observation: one
          ? `${x0.name} mejora ${rateText(x0.ratePctPerWeek)} (1RM est. ~${kg(x0.e1rmNow)}), pero todavía está al ${x0.recovery.pct} % de tu mejor referencia: ${x0.recovery.refLabel}.`
          : `${joinList(recList.map((x) => `${x.name} mejora ${rateText(x.ratePctPerWeek)} y está al ${x.recovery.pct} % de su referencia`))}.`,
        interpretation: 'Es compatible con recuperar rendimiento que ya habías alcanzado, que suele ir más rápido que mejorar por encima de tu mejor marca. No es un dato de tu músculo, solo de tu rendimiento.',
        recommendation: 'Sigue subiendo poco a poco; al acercarte a tu marca anterior es normal que el ritmo se frene.',
      },
      rule: `Para cada ejercicio que mejora se compara su 1RM estimado actual (el mayor de las últimas ${RECENT_DAYS / 7} semanas) con tu mejor referencia anterior: la mayor entre tus marcas históricas (introducidas a mano) y lo registrado en Entreno antes de esas semanas. Por debajo del ${RECOVERY_BELOW_PCT} % se considera que recuperas rendimiento previo. 1RM estimado con Epley (reps + RIR, series de 1 a 12 repeticiones): es una estimación.`,
      data: recList.map((x) => ({ label: x.name, value: `${x.recovery.pct} % · ahora ${kg(x.e1rmNow)} · referencia ${kg(x.recovery.refE1rm)}: ${x.recovery.refLabel}` })),
      confidence: conf, context: ctxNotes,
      sources: [],
      action: one ? progAction(x0.exerciseId) : { label: 'Ver marcas históricas', href: '#/records/past' },
    }));
  }

  // --- Ejercicios nuevos: adaptación inicial (ronda 6) -------------------------------
  const newList = analyzed.filter((x) => x.kind === 'new_exercise').sort((a, b) => b.ratePctPerWeek - a.ratePctPerWeek).slice(0, 3);
  if (newList.length) {
    const one = newList.length === 1;
    out.push(insight({
      id: 'strength-new', area: 'strength', level: 'info', priority: 40,
      title: one ? `${newList[0].name}: primeras semanas` : 'Ejercicios nuevos: primeras semanas',
      parts: {
        observation: `${joinList(newList.map((x) => `${x.name} (${rateText(x.ratePctPerWeek)})`))} ${one ? 'lleva' : 'llevan'} menos de ${NEW_EXERCISE_DAYS / 7} semanas en tu registro.`,
        interpretation: 'Al empezar un ejercicio es normal mejorar rápido por técnica y coordinación (adaptación inicial): todavía no es tu ritmo de fondo.',
        recommendation: 'Sube poco a poco y cuida la técnica; en unas semanas se verá tu ritmo real.',
      },
      rule: `Ejercicio nuevo: su primera sesión registrada es de hace menos de ${NEW_EXERCISE_DAYS / 7} semanas y no tiene marca histórica. Las primeras semanas la mejora es sobre todo técnica y coordinación.`,
      data: newList.map((x) => ({ label: x.name, value: `desde el ${dayTxt(x.firstDate, today)} · ${rateText(x.ratePctPerWeek)} · ${plural(x.sessions, 'sesión', 'sesiones')}` })),
      confidence: combine([...groupConfidence(newList).factors, capAt('low', `menos de ${NEW_EXERCISE_DAYS / 7} semanas de datos del ejercicio`, 'new')]),
      sources: minor ? [SOURCES.lloyd2014] : [],
    }));
  }

  // --- Lo que más progresa -----------------------------------------------------
  const risers = analyzed.filter((x) => (x.status === 'fast' || x.status === 'good') && !x.slow).sort((a, b) => b.ratePctPerWeek - a.ratePctPerWeek).slice(0, 3);
  if (risers.length >= 2) {
    const parts = risers.map((x) => {
      const c = byId.get(x.exerciseId);
      const kindTxt = x.kind === 'recovery' ? ', recuperando una marca anterior' : x.kind === 'new_exercise' ? ', ejercicio nuevo' : x.kind === 'new_best' ? ', por encima de tu mejor marca anterior' : '';
      return `${x.name} ${rateText(x.ratePctPerWeek)} (de ~${kg(x.e1rmStart)} a ~${kg(x.e1rmNow)} en ${weeksTxt(Math.max(1, Math.round(c.trend.spanDays / 7)))}${x.status === 'fast' && !kindTxt ? ', rápido para tu nivel' : ''}${kindTxt})`;
    });
    out.push(insight({
      id: 'strength-top', area: 'strength', level: 'good', priority: 48,
      title: 'Lo que más progresa',
      text: `${joinList(parts)}. Lo que funciona en esos ejercicios (series, repeticiones, frecuencia) es buena pista para los demás.`,
      rule, data: risers.map((x) => exRow(x, p)), confidence: groupConfidence(risers),
      sources: female ? [SOURCES.roberts2020] : [],
    }));
  }

  // --- Estancados: qué probar ---------------------------------------------------
  const stalledList = analyzed.filter((x) => x.status === 'stalled').sort((a, b) => (b.main - a.main) || a.ratePctPerWeek - b.ratePctPerWeek);
  if (stalledList.length) {
    const mus = muscleAverages(d, today);
    const targets = targetsOf(d.settings);
    const fat = fatigueSignals(d, today);
    const bwKg = lastBodyweight(d, today);
    const sore = strongDomsByMuscle(d, today);
    const adh = adherence4w(d, today);
    stalledList.slice(0, 3).forEach((x, i) => {
      const c = byId.get(x.exerciseId);
      const tips = [];
      const tipRows = [];
      const srcs = [];
      if (fat.any) {
        const why = [];
        if (fat.rpeHigh) why.push(`RPE medio de fuerza ${fmtNum(fat.rpeMean, 1)} en ${lastWeeks(fat.W)}`);
        if (fat.ckLow) why.push(`${fat.lows} de ${fat.checkins} check-ins bajos`);
        tips.push(`una semana de descarga (menos series, RPE 6–7), porque hay señales de fatiga (${joinList(why)})`);
        tipRows.push({ label: 'Fatiga', value: `${joinList(why)} → descarga` });
      } else {
        tipRows.push({ label: 'Fatiga', value: fat.rpeCount ? `RPE medio ${fmtNum(fat.rpeMean, 1)} en ${lastWeeks(fat.W)} (umbral ${fmtNum(fat.rpeLimit, 1)}) · sin señales` : 'sin RPE ni check-ins bajos recientes' });
      }
      const below = [];
      for (const m of c.ex.primary || []) {
        const t = targets[m];
        if (!Array.isArray(t) || !(t[0] > 0) || !mus.weeks) continue;
        const avg = mus.avg[m] || 0;
        tipRows.push({ label: `Series/sem de ${(MUSCLE_LABEL[m] || m).toLowerCase()}`, value: `${fmtNum(avg, 1)} de media (${plural(mus.weeks, 'semana', 'semanas')}) · rango ${t[0]}–${t[1]}` });
        if (avg < t[0] - EPS) below.push({ m, avg, t });
      }
      if (minor) {
        tips.push('revisar la técnica con alguien que sepa (entrenador o profesor) y subir el peso solo cuando todas las repeticiones salgan limpias');
        srcs.push(SOURCES.lloyd2014);
      } else if (senior) {
        tips.push('cuidar la técnica y recuperarte bien entre sesiones antes de añadir más trabajo');
        srcs.push(SOURCES.fragala2019);
      }
      // Ronda 6 (fase D): más volumen solo si no hay agujetas fuertes repetidas en ese músculo ni poca constancia; con
      // agujetas fuertes, al revés: quitar algo.
      const soreM = (c.ex.primary || []).find((m) => (sore.get(m) || 0) >= 2);
      if (soreM) {
        tips.push(`quitar 2–4 series por semana de ${(MUSCLE_LABEL[soreM] || soreM).toLowerCase()} 1–2 semanas, porque has tenido agujetas fuertes ahí ${sore.get(soreM)} veces en 2 semanas`);
        tipRows.push({ label: 'Agujetas fuertes', value: `${(MUSCLE_LABEL[soreM] || soreM).toLowerCase()}: ${sore.get(soreM)} veces ≥ 7/10 en 14 días → menos volumen, no más` });
      } else if (below.length && adh.low) {
        tipRows.push({ label: 'Constancia', value: `${adh.completed} de ${adh.planned - adh.pending} sesiones planificadas (${adh.pctPast} %) → antes que más series, constancia` });
        tips.push(`antes que más series, constancia: en 4 semanas hiciste el ${adh.pctPast} % de lo planificado`);
      } else if (below.length && !minor && !(senior && fat.any)) {
        const b = below[0];
        tips.push(`+1–2 series por semana de ${(MUSCLE_LABEL[b.m] || b.m).toLowerCase()} (haces ${fmtNum(b.avg, 1)} y tu rango es ${b.t[0]}–${b.t[1]})`);
        srcs.push(SOURCES.schoenfeld2017);
      }
      const reps = typicalReps(c.trend.era, c.ex);
      if (!minor) tips.push(repRangeTip(reps));
      tipRows.push({ label: 'Repeticiones típicas', value: reps != null ? `~${fmtNum(reps, 0)} por serie (últimas 3 sesiones)` : '—' });
      tips.push(`cuida el sueño y la ${proteinText(bwKg)}`);
      srcs.push(SOURCES.knowles2018, SOURCES.morton2018);
      const best = x.stall.best;
      const since = best ? diffDays(best.date, today) : 0;
      let ruleTxt;
      if (x.stall.byTrend) ruleTxt = `Sin tendencia al alza en ${weeksTxt(x.windowWeeks)} (${rateText(x.ratePctPerWeek)}).`;
      else if (since >= 14) ruleTxt = `Lleva ${weeksTxt(Math.round(since / 7))} sin superar su mejor 1RM est. (${kg(best.e1rm)}, el ${dayTxt(best.date, today)}).`;
      else ruleTxt = `${x.stall.bySessions ? `Sus últimas ${plural(x.stall.S, 'sesión', 'sesiones')} no superan` : `En ${lastWeeks(x.stall.W)} no supera`} su mejor 1RM est. (${kg(best.e1rm)}, el ${dayTxt(best.date, today)}).`;
      out.push(insight({
        id: `strength-stalled-${x.exerciseId}`, area: 'strength', level: 'warn', priority: (x.main ? 64 : 52) - i * 2,
        confidence: x.confidence, context: ctxNotes,
        title: `${x.name}: qué probar para desatascarlo`,
        text: `${ruleTxt} Qué probar, por este orden: ${tips.join('; ')}.${fat.any ? '' : g(p, ' Si te notas cansado, empieza por descansar.', ' Si te notas cansada, empieza por descansar.')}`,
        rule: `${rule} Qué probar ante un estancamiento: si hay fatiga (RPE medio de fuerza ≥ ${fmtNum(fat.rpeLimit, 1)} en ${lastWeeks(fat.W)} con 2 sesiones o más, o la mitad de los check-ins bajos), una semana de descarga; si su músculo principal hace menos series semanales que el mínimo de su rango (Ajustes › Umbrales), 1–2 series más (más volumen, más progreso hasta ~10–20 series); un cambio de rango de repeticiones unas semanas; y revisar sueño y proteína.`,
        data: [exRow(x, p), ...c.trend.points.slice(-6).map((q) => ({ label: dayTxt(q.date, today), value: `${kg(q.e1rm)}${q.set ? ` · ${formatSet(q.set, c.ex.logType, { kg: true })}` : ''}` })), ...tipRows],
        sources: srcs,
        action: progAction(x.exerciseId),
      }));
    });
    if (stalledList.length > 3) {
      const rest = stalledList.slice(3);
      out.push(insight({
        id: 'strength-stalled-more', area: 'strength', level: 'warn', priority: 46, confidence: groupConfidence(rest),
        title: `${plural(rest.length, 'ejercicio más estancado', 'ejercicios más estancados')}`,
        text: `${joinList(rest.map((x) => x.name))}: mismas ideas (descarga si hay fatiga, más series si su músculo va corto, otro rango de repeticiones, sueño y proteína).`,
        rule, data: rest.map((x) => exRow(x, p)),
        sources: [SOURCES.schoenfeld2017, SOURCES.morton2018],
      }));
    }
  }

  // --- Bajando -----------------------------------------------------------------
  const downList = analyzed.filter((x) => x.status === 'down').sort((a, b) => (b.main - a.main) || a.ratePctPerWeek - b.ratePctPerWeek).slice(0, 3);
  if (downList.length) {
    const lose = p.goal === 'lose';
    const endu = enduranceMinutesChange(d, today);
    const fat = fatigueSignals(d, today);
    downList.forEach((x, i) => {
      const c = byId.get(x.exerciseId);
      const ctxBits = [];
      const rows = [exRow(x, p)];
      if (endu.more) ctxBits.push(`un ${pctTxt(endu.pct)} más de minutos de resistencia (${fmtNum(endu.cur, 0)} frente a ${fmtNum(endu.prev, 0)} min en 4 semanas)`);
      rows.push({ label: 'Minutos de resistencia (4 sem / 4 anteriores)', value: `${fmtNum(endu.cur, 0)} / ${fmtNum(endu.prev, 0)} min` });
      if (fat.rpeHigh) ctxBits.push(`un RPE medio de fuerza alto (${fmtNum(fat.rpeMean, 1)} en ${lastWeeks(fat.W)})`);
      if (fat.ckLow) ctxBits.push(`${fat.lows} de ${fat.checkins} check-ins bajos en ${lastWeeks(fat.W)}`);
      let t = `Su 1RM est. baja un ${fmtNum(Math.abs(x.ratePctPerWeek), 1)} % por semana: de ~${kg(x.e1rmStart)} a ~${kg(x.e1rmNow)} en ${weeksTxt(Math.max(1, Math.round(c.trend.spanDays / 7)))}.`;
      if (ctxBits.length) t += ` Coincide con ${joinList(ctxBits)}.`;
      if (lose) t += ' Estás en déficit: no subir es normal, pero para conservar músculo intenta que la pérdida no pase de 0,5–1 % del peso por semana y mantén pesos altos con menos series.';
      else t += ` Mira el sueño, la comida y el cansancio acumulado; una semana más suave suele ayudar a recuperar el nivel${ctxBits.length ? '' : ', y si sigue bajando, revisa la técnica o cambia el ejercicio por una variante'}.`;
      out.push(insight({
        id: `strength-down-${x.exerciseId}`, area: 'strength', level: lose ? 'neutral' : 'warn', priority: lose ? 44 - i * 2 : (x.main ? 66 : 54) - i * 2,
        confidence: x.confidence, context: ctxNotes,
        title: `${x.name} baja`,
        text: t, rule,
        data: [...rows, ...c.trend.points.slice(-6).map((q) => ({ label: dayTxt(q.date, today), value: kg(q.e1rm) }))],
        sources: lose ? [SOURCES.helms2014] : [SOURCES.knowles2018],
        action: progAction(x.exerciseId),
      }));
    });
  }

  // --- Próximas semanas (previsión) ----------------------------------------------
  const fc = analyzed.filter((x) => (x.status === 'fast' || x.status === 'good') && x.forecast.length)
    .sort((a, b) => (b.main - a.main) || (a.logType === 'bodyweight') - (b.logType === 'bodyweight') || b.ratePctPerWeek - a.ratePctPerWeek).slice(0, 3);
  fc.forEach((x, i) => {
    const c = byId.get(x.exerciseId);
    const [f4, f8] = x.forecast;
    const bw = x.logType === 'bodyweight' ? ' (con tu peso corporal)' : '';
    const capped = Math.abs(f4.rateUsed - x.ratePctPerWeek) > 0.005;
    const refCap = x.forecast.some((f) => f.capped);
    out.push(insight({
      id: `forecast-${x.exerciseId}`, area: 'forecast', level: 'info', priority: 42 - i * 2,
      confidence: combine([...(x.confidence?.factors || []), capAt('medium', 'es una proyección: el ritmo cambia', 'forecast')]),
      title: `${x.name}: 1RM est. ${kgRange(f4.low, f4.high)} en ${weeksTxt(f4.weeks)}`,
      text: `Previsto hacia el ${dayTxt(f4.date, today)}${bw}, si sigues así${f8 ? `; ${kgRange(f8.low, f8.high)} hacia el ${dayTxt(f8.date, today)}` : ''} (ahora ~${kg(x.e1rmNow)}). Es una estimación: el progreso se frena con el tiempo y no es lineal.${refCap ? ` Como estás recuperando una marca anterior, el tope de la previsión es esa marca (~${kg(x.recovery.refE1rm)}): superarla suele ir más despacio.` : ''}`,
      rule: `Previsión con rendimientos decrecientes: nivel actual (la tendencia el día de tu última sesión) × (1 + ritmo × τ × ln(1 + t/τ)), con τ = ${TAU_WEEKS} semanas y t = semanas desde tu última sesión; el ritmo es el de tu tendencia, con un tope prudente para tu nivel (${lvl}: ${rateText(th.cap)}). Rango: el ruido de tus sesiones respecto a la tendencia (mínimo ±${pctTxt(MIN_NOISE * 100)}), que crece al alejarse de tus datos, más media ganancia prevista por si el ritmo se frena antes. ${rule}`,
      data: [
        { label: 'Nivel actual (tendencia)', value: kg(x.e1rmNow) },
        { label: 'Ritmo', value: `${rateText(x.ratePctPerWeek)}${capped ? ` → se usa el tope ${rateText(f4.rateUsed)}` : ''}` },
        { label: 'Ruido entre sesiones', value: `±${fmtNum(c.trend.residualPct, 1)} %` },
        ...x.forecast.map((f) => ({ label: `En ${weeksTxt(f.weeks)} (${dayTxt(f.date, today)})`, value: `${kgRange(f.low, f.high)} · medio ${kg(f.mid)}` })),
      ],
      sources: [],
      action: progAction(x.exerciseId),
    }));
  });
  return out;
}

const lastWeeks = (w) => (w === 1 ? 'la última semana' : `las últimas ${w} semanas`);

/** Minutos de resistencia (carrera, bici, natación, senderismo) en 28 días frente a los 28 anteriores. */
function enduranceMinutesChange(d, today) {
  const from = addDays(today, -27);
  const prevFrom = addDays(from, -28);
  let cur = 0; let prev = 0;
  for (const s of toArr(d.sessions)) {
    if (!s || s.status !== 'done' || !ENDURANCE_KINDS.includes(s.kind) || !isDateStr(s.date) || s.date > today) continue;
    const m = sessionDurationMin(s) || 0;
    if (s.date >= from) cur += m;
    else if (s.date >= prevFrom) prev += m;
  }
  const pct = prev > 0 ? ((cur - prev) / prev) * 100 : null;
  return { cur, prev, pct, more: pct != null && pct >= 30 && cur - prev >= 60 };
}

// ===========================================================================
// RESISTENCIA
// ===========================================================================

/**
 * Intensidad de una sesión de resistencia: subtipo suave (z2, long, easy, route) → 'easy'; intenso (intervals, tempo,
 * race) → 'hard'; sin subtipo (o rodillo), RPE ≤ 5 → 'easy' y ≥ 6 → 'hard'; senderismo sin RPE → 'easy' (es de
 * intensidad baja); el resto sin datos → null (no cuenta).
 */
export function classifyIntensity(s) {
  if (!s) return null;
  if (EASY_SUBTYPES.includes(s.subtype)) return 'easy';
  if (HARD_SUBTYPES.includes(s.subtype)) return 'hard';
  if (s.rpe >= 1) return s.rpe <= 5 ? 'easy' : 'hard';
  if (s.kind === 'hike') return 'easy';
  return null;
}

function enduranceSessions(d, from, to) {
  return toArr(d.sessions).filter((s) => s && s.status === 'done' && ENDURANCE_KINDS.includes(s.kind) && isDateStr(s.date) && s.date >= from && s.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Reparto suave / intenso de las últimas `weeks` semanas (hoy y los días anteriores) por minutos de sesión.
 * @returns {{ easyMin, hardMin, easyShare:number|null, weeks, from, to, easyCount, hardCount, unknownCount, sessions }}
 */
export function intensitySplit(d, { today, weeks = INTENSITY_WEEKS } = {}) {
  const from = addDays(today, -(weeks * 7 - 1));
  let easyMin = 0; let hardMin = 0; let easyCount = 0; let hardCount = 0; let unknownCount = 0;
  const sessions = [];
  for (const s of enduranceSessions(d, from, today)) {
    const min = sessionDurationMin(s);
    const c = classifyIntensity(s);
    sessions.push({ id: s.id, date: s.date, kind: s.kind, subtype: s.subtype || null, rpe: s.rpe ?? null, min, intensity: c });
    if (!c || !(min > 0)) { unknownCount++; continue; }
    if (c === 'easy') { easyMin += min; easyCount++; } else { hardMin += min; hardCount++; }
  }
  const total = easyMin + hardMin;
  return { easyMin: round(easyMin, 1), hardMin: round(hardMin, 1), easyShare: total > 0 ? easyMin / total : null, weeks, from, to: today, easyCount, hardCount, unknownCount, sessions };
}

/** Sesión de fuerza con pierna: ≥ 3 series de trabajo de ejercicios con cuádriceps, isquios o glúteos como principales. */
function legSets(s, exMap) {
  let n = 0;
  for (const se of s.exercises || []) {
    const ex = exMap.get(se.exerciseId);
    if (!ex || !(ex.primary || []).some((m) => LEG_MUSCLES.includes(m))) continue;
    n += (se.sets || []).filter(isWorkSet).length;
  }
  return n;
}

/** Resistencia exigente para las piernas: intensa (carrera, bici, senderismo), larga (≥ 150 min) o ruta con ≥ 700 m de desnivel. */
function demanding(s) {
  if (!['run', 'bike', 'hike'].includes(s.kind)) return null;
  const min = sessionDurationMin(s) || 0;
  if (classifyIntensity(s) === 'hard') return s.subtype === 'intervals' ? 'series' : s.subtype === 'tempo' ? 'tempo' : s.subtype === 'race' ? 'competición' : 'intensa';
  if (s.kind === 'hike' && s.elevationM >= 700) return 'con mucho desnivel';
  if (min >= 150) return 'larga';
  return null;
}

function enduranceLabel(s, why) {
  const noun = KIND_NOUN[s.kind] || s.kind;
  if (why === 'series') return `series de ${noun}`;
  if (why === 'tempo') return `tempo de ${noun}`;
  if (why === 'competición') return `competición de ${noun}`;
  if (s.kind === 'hike') return `ruta de senderismo ${why}`;
  return `${noun} ${why}`;
}

/** Resistencia justo antes de la fuerza: con hora de inicio en las dos, empieza antes y termina menos de 3 h antes. */
function closeBefore(e, L) {
  if (!(e.startedAt > 0) || !(L.startedAt > 0) || !(e.startedAt < L.startedAt)) return false;
  const end = e.startedAt + (sessionDurationMin(e) || 0) * 60000;
  return (L.startedAt - end) / 3600000 < SAME_DAY_HOURS;
}

/**
 * Interferencia: resistencia exigente el día antes de una sesión con pierna, o el mismo día justo antes de la fuerza
 * (termina menos de 3 h antes; con hora de inicio en las dos). Últimas `weeks` semanas.
 * @returns {{date, text, kind:'day-before'|'same-day', enduranceId, strengthId, enduranceDate}[]}
 */
export function findInterference(d, { today, weeks = INTERFERENCE_WEEKS } = {}) {
  const exMap = toMap(d.exercises);
  const from = addDays(today, -(weeks * 7 - 1));
  const endu = enduranceSessions(d, addDays(from, -1), today).map((s) => ({ s, why: demanding(s) })).filter((x) => x.why);
  const out = [];
  const legs = toArr(d.sessions).filter((s) => s && s.kind === 'strength' && s.status === 'done' && isDateStr(s.date) && s.date >= from && s.date <= today && legSets(s, exMap) >= 3)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const L of legs) {
    const prev = addDays(L.date, -1);
    const before = endu.find((x) => x.s.date === prev);
    if (before) {
      out.push({
        date: L.date, kind: 'day-before', enduranceId: before.s.id, strengthId: L.id, enduranceDate: prev,
        text: `${cap(enduranceLabel(before.s, before.why))} el ${fmtDate(prev)} y pierna al día siguiente`,
      });
      continue;
    }
    const same = endu.find((x) => x.s.date === L.date && closeBefore(x.s, L));
    if (same) {
      out.push({
        date: L.date, kind: 'same-day', enduranceId: same.s.id, strengthId: L.id, enduranceDate: L.date,
        text: `${cap(enduranceLabel(same.s, same.why))} antes de la pierna el ${fmtDate(L.date)}`,
      });
    }
  }
  return out;
}

/** 5 km previsto de un bloque [from, to] con race-predict (solo carreras de ese bloque; ≥ 2 válidas). */
function blockPrediction(d, from, to) {
  const ctx = analyzeRuns(d, { today: to });
  const valid = ctx.valid.filter((e) => e.date >= from);
  if (valid.length < MIN_VALID) return null;
  const p = predictDistance({ ...ctx, valid, basis: valid.slice(0, 3) }, 5, raceFor(5));
  return { pred5kSec: p.mid, low: p.low, high: p.high, runs: valid.length, efforts: p.efforts.map((e) => e.label) };
}

/**
 * Forma en carrera: 5 km previsto (race-predict: Riegel con los 3 mejores esfuerzos del bloque) por bloques de 4
 * semanas de lunes a domingo; el último termina hoy. Solo carrera (≥ 3 km). Devuelve solo los bloques con previsión.
 * @returns {{weekStart, weekEnd, pred5kSec, low, high, runs}[]} (de más antiguo a más reciente)
 */
export function fitnessBlocks(d, { today, blocks = FITNESS_BLOCKS } = {}) {
  const out = [];
  const cw = weekStart(today);
  for (let k = blocks - 1; k >= 0; k--) {
    const ws = addDays(cw, -7 * (BLOCK_WEEKS * (k + 1) - 1));
    const we = k === 0 ? today : addDays(ws, BLOCK_WEEKS * 7 - 1);
    const p = blockPrediction(d, ws, we);
    if (p) out.push({ weekStart: ws, weekEnd: we, ...p });
  }
  return out;
}

const timeTxt = (sec) => fmtDuration(sec);

/**
 * Resistencia: tendencia de forma (5 km previsto por bloques de 4 semanas), reparto suave/intenso de las 4 últimas
 * semanas frente a ~80/20, interferencia con la pierna y ritmo de los rodajes suaves.
 * @returns {{ fitness:{weekStart, weekEnd, pred5kSec, low, high, runs}[], intensity:{ easyMin, hardMin, easyShare, weeks, … },
 *   interference:{date, text, kind, …}[], insights: Insight[] }}
 */
export function analyzeEndurance(data, opts = {}) {
  const { d, today, profile: p } = optsOf(data, opts);
  const fitness = fitnessBlocks(d, { today });
  const intensity = intensitySplit(d, { today });
  const interference = findInterference(d, { today });
  const insights = [];

  // --- Forma (5 km previsto) ----------------------------------------------------
  const last = fitness[fitness.length - 1];
  const curBlockStart = addDays(weekStart(today), -7 * (BLOCK_WEEKS - 1));
  if (last && last.weekStart === curBlockStart && fitness.length >= 2) {
    const prev = fitness[fitness.length - 2];
    const diff = prev.pred5kSec - last.pred5kSec; // > 0: más rápido
    const gapW = diffDays(prev.weekStart, last.weekStart) / 7;
    const prevTxt = gapW === BLOCK_WEEKS ? 'en el bloque anterior' : `hace ${weeksTxt(gapW)}`;
    const pct = (diff / prev.pred5kSec) * 100;
    const rows = fitness.map((b) => ({ label: `${dayTxt(b.weekStart, today)} – ${dayTxt(b.weekEnd, today)}`, value: `${timeTxt(b.pred5kSec)} (${timeTxt(b.low)}–${timeTxt(b.high)}) · ${plural(b.runs, 'carrera', 'carreras')}` }));
    const rule = `5 km previsto con la misma fórmula que Tiempos previstos (Riegel, k = 1,06, con los 3 mejores esfuerzos de ${RUN_MIN_KM} km o más), pero solo con las carreras de cada bloque de ${BLOCK_WEEKS} semanas (lunes a domingo; el último termina hoy) y al menos ${MIN_VALID} carreras por bloque. Se compara el bloque actual con el anterior que tenga previsión: mejora o empeora si cambia un 1,5 % o más. El senderismo, la bici y la natación no cuentan. Si en un bloque solo hiciste rodajes suaves, la previsión sale más lenta de lo que podrías correr.`;
    let lvl; let title; let text; let prio;
    if (pct >= 1.5) {
      lvl = 'good'; prio = 50; title = 'Tu forma en carrera mejora';
      text = `5 km previsto ~${timeTxt(last.pred5kSec)}, frente a ~${timeTxt(prev.pred5kSec)} ${prevTxt} (${timeTxt(Math.abs(diff))} menos, un ${pctTxt(pct, 1)}).`;
    } else if (pct <= -1.5) {
      lvl = 'neutral'; prio = 40; title = 'Tu 5 km previsto va algo más lento';
      text = `~${timeTxt(last.pred5kSec)} frente a ~${timeTxt(prev.pred5kSec)} ${prevTxt} (+${timeTxt(Math.abs(diff))}). Puede ser que este bloque hayas corrido más suave, con calor o cansancio: no es preocupante si tus carreras fueron rodajes.`;
    } else {
      lvl = 'neutral'; prio = 22; title = 'Tu forma en carrera se mantiene';
      text = `5 km previsto ~${timeTxt(last.pred5kSec)} (${prevTxt} ~${timeTxt(prev.pred5kSec)}).`;
    }
    insights.push(insight({
      id: 'endurance-fitness', area: 'endurance', level: lvl, priority: prio, title, text, rule, data: rows, sources: [],
      confidence: combine([
        byCount(fitness.length, { low: 2, medium: 3, high: 4 }, (k) => `${k} bloques de ${BLOCK_WEEKS} semanas con previsión`, 'blocks'),
        byCount(last.runs, { low: 2, medium: 3, high: 5 }, (k) => `${k} carreras en el último bloque`, 'runs'),
      ]),
      action: { label: 'Tiempos previstos', href: '#/predictions' },
    }));

    // Previsión a 4 semanas (solo si mejora con ≥ 3 bloques)
    if (fitness.length >= 3 && pct > 0) {
      const xy = fitness.map((b) => ({ x: diffDays(fitness[0].weekStart, b.weekStart) / 7, y: b.pred5kSec }));
      const fit = theilSen(xy);
      if (fit && fit.slope < 0) {
        const rPct = Math.min((-fit.slope / last.pred5kSec) * 100, 0.75);
        const decay = TAU_WEEKS * Math.log(1 + BLOCK_WEEKS / TAU_WEEKS);
        const mid = last.pred5kSec * (1 - (rPct / 100) * decay);
        const margin = Math.max(0.03, (fit.sd / last.pred5kSec) || 0);
        const lo = Math.floor((mid * (1 - margin)) / 5) * 5;
        const hi = Math.ceil((mid * (1 + margin)) / 5) * 5;
        const date = addDays(today, BLOCK_WEEKS * 7);
        insights.push(insight({
          id: 'forecast-5k', area: 'forecast', level: 'info', priority: 36,
          confidence: combine([byCount(fitness.length, { low: 3, medium: 4, high: 6 }, (k) => `${k} bloques`, 'blocks'), capAt('medium', 'es una proyección: el ritmo cambia', 'forecast')]),
          title: `5 km: ${timeTxt(lo)}–${timeTxt(hi)} hacia el ${dayTxt(date, today)}`,
          text: `Si sigues así, tu 5 km previsto podría estar en ${timeTxt(lo)}–${timeTxt(hi)} hacia el ${dayTxt(date, today)} (ahora ~${timeTxt(last.pred5kSec)}). Es una estimación.`,
          rule: `Pendiente robusta (Theil–Sen) del 5 km previsto de tus bloques de ${BLOCK_WEEKS} semanas, en % por semana, con un tope prudente de 0,75 %/sem y rendimientos decrecientes (τ = ${TAU_WEEKS} semanas); rango ±3 % como mínimo (o la dispersión de los bloques si es mayor), redondeado a 5 s.`,
          data: [...rows, { label: 'Mejora usada', value: `${fmtNum(rPct, 2)} %/sem` }],
          sources: [],
          action: { label: 'Tiempos previstos', href: '#/predictions' },
        }));
      }
    }
  }

  // --- Reparto suave / intenso -------------------------------------------------
  const total = intensity.easyMin + intensity.hardMin;
  if (intensity.easyShare != null && intensity.easyCount + intensity.hardCount >= 4 && total >= 90) {
    const share = intensity.easyShare * 100;
    const shareTxt = pctTxt(share);
    const rows = [
      { label: `Suave (${INTENSITY_WEEKS} semanas)`, value: `${fmtNum(intensity.easyMin, 0)} min · ${plural(intensity.easyCount, 'sesión', 'sesiones')}` },
      { label: 'Intenso', value: `${fmtNum(intensity.hardMin, 0)} min · ${plural(intensity.hardCount, 'sesión', 'sesiones')}` },
      { label: 'Reparto', value: `${shareTxt} suave / ${pctTxt(100 - share)} intenso` },
    ];
    if (intensity.unknownCount) rows.push({ label: 'Sin tipo ni esfuerzo (no cuentan)', value: String(intensity.unknownCount) });
    for (const s of intensity.sessions.slice(-10)) {
      rows.push({ label: `${dayTxt(s.date, today)} · ${KIND_NOUN[s.kind]}${s.subtype ? ` (${s.subtype})` : ''}`, value: `${s.min != null ? `${fmtNum(s.min, 0)} min` : '—'}${s.rpe ? ` · RPE ${s.rpe}` : ''} → ${s.intensity === 'easy' ? 'suave' : s.intensity === 'hard' ? 'intenso' : 'no cuenta'}` });
    }
    const rule = `Minutos de carrera, bici, natación y senderismo de las últimas ${INTENSITY_WEEKS} semanas. Suave: rodaje/Z2, tirada larga, rodaje en bici o ruta; intenso: series, tempo o competición. Sin tipo, por el esfuerzo (RPE 5 o menos, suave; 6 o más, intenso); senderismo sin esfuerzo, suave. Referencia: ~80 % del entrenamiento de resistencia suave y ~20 % intenso (distribución habitual de los deportistas de resistencia). Por debajo del 65 % suave, demasiado intenso; 65–75 %, algo alto; por encima del 95 % con 150 min o más, casi todo suave. La fuerza no cuenta aquí.`;
    const unk = intensity.unknownCount ? ` (${plural(intensity.unknownCount, 'sesión sin tipo ni esfuerzo no cuenta', 'sesiones sin tipo ni esfuerzo no cuentan')}: añade el RPE)` : '';
    let o;
    if (share < 65) {
      const shift = Math.max(0, Math.round(EASY_TARGET * total - intensity.easyMin));
      o = {
        level: 'warn', priority: 60, title: 'Demasiada intensidad en tu resistencia',
        text: `Solo el ${shareTxt} de tus minutos de resistencia de las últimas ${INTENSITY_WEEKS} semanas fue suave${unk}. Lo recomendado ronda el 80 %: pasa ~${fmtNum(shift, 0)} min de intenso a suave (unos ${fmtNum(Math.round(shift / INTENSITY_WEEKS), 0)} min por semana), por ejemplo convirtiendo una sesión intensa en rodaje en Z2 (puedes hablar). Seguirás mejorando y llegarás más ${g(p, 'fresco', 'fresca')} a la fuerza.`,
      };
    } else if (share < 75) {
      o = {
        level: 'neutral', priority: 38, title: 'Reparto de intensidad algo alto',
        text: `El ${shareTxt} de tus minutos de resistencia fue suave${unk}: un poco por debajo del ~80 %. Basta con que una de cada dos o tres sesiones intensas sea suave.`,
      };
    } else if (share > 95 && total >= 150) {
      o = {
        level: 'info', priority: 28, title: 'Casi toda tu resistencia es suave',
        text: `El ${shareTxt} de tus minutos fue suave${unk}. Es una buena base; si quieres mejorar tu forma, una sesión de calidad por semana (series o tempo), en torno al 20 %, suele bastar.`,
      };
    } else {
      o = {
        level: 'good', priority: 34, title: 'Buen reparto suave / intenso',
        text: `El ${shareTxt} de tus minutos de resistencia fue suave${unk}: en línea con el ~80/20 que se recomienda.`,
      };
    }
    insights.push(insight({
      id: 'endurance-intensity', area: 'endurance', rule, data: rows, sources: [SOURCES.seiler2010], ...o,
      confidence: combine([
        byCount(intensity.easyCount + intensity.hardCount, { low: 4, medium: 6, high: 10 }, (k) => `${k} sesiones con tipo o esfuerzo`, 'count'),
        intensity.unknownCount ? capAt('medium', `${plural(intensity.unknownCount, 'sesión sin tipo ni esfuerzo', 'sesiones sin tipo ni esfuerzo')}`, 'unknown') : null,
      ]),
    }));
  }

  // --- Interferencia -----------------------------------------------------------
  const recent = interference.filter((x) => diffDays(x.date, today) < RECENT_DAYS);
  if (interference.length >= INTERFERENCE_MIN && recent.length) {
    const before = interference.filter((x) => x.kind === 'day-before').length;
    const same = interference.length - before;
    const impact = legImpact(d, today, interference);
    const parts = [];
    if (before) parts.push(`${plural(before, 'vez', 'veces')} resistencia exigente el día antes de pierna`);
    if (same) parts.push(`${plural(same, 'vez', 'veces')} la resistencia justo antes de la pierna`);
    const ex = interference[interference.length - 1];
    let text = `En ${weeksTxt(INTERFERENCE_WEEKS)}: ${joinList(parts)} (la última, ${ex.text.charAt(0).toLowerCase()}${ex.text.slice(1)}).`;
    if (impact && impact.pct >= 3) text += ` Esos días tu pierna rindió un ${pctTxt(impact.pct)} menos que en las demás sesiones.`;
    text += ' La fuerza máxima apenas se resiente por combinar, pero la pierna llega cansada y la potencia sí lo nota:';
    const tips = [];
    if (before) tips.push('deja ≥ 24 h entre la sesión intensa y la pierna (mejor la carrera intensa después de la pierna o dos días antes)');
    tips.push('si van el mismo día, haz la fuerza primero');
    text += ` ${joinList(tips)}.`;
    const rows = interference.map((x) => ({ label: dayTxt(x.date, today), value: x.text }));
    if (impact) rows.push({ label: 'Rendimiento de pierna (esos días / resto)', value: `${pctTxt(impact.affected * 100, 1)} / ${pctTxt(impact.others * 100, 1)} de tu máximo de 4 semanas (${impact.nAffected} y ${impact.nOthers} sesiones)` });
    insights.push(insight({
      id: 'endurance-interference', area: 'endurance', level: interference.length >= 4 ? 'warn' : 'info', priority: interference.length >= 4 ? 50 : 44,
      confidence: combine([
        byCount(interference.length, { low: 2, medium: 3, high: 5 }, (k) => `${k} veces en ${INTERFERENCE_WEEKS} semanas`, 'count'),
        impact ? byCount(Math.min(impact.nAffected, impact.nOthers), { low: 2, medium: 4, high: 6 }, (k) => `${k} sesiones en el grupo más pequeño para comparar el rendimiento`, 'impact') : capAt('medium', 'es un recuento: sin sesiones suficientes para comparar tu rendimiento', 'impact'),
      ]),
      title: 'Resistencia intensa pegada a la pierna',
      text,
      rule: `Sesiones de fuerza con pierna (3 series o más de ejercicios de cuádriceps, isquiotibiales o glúteos) de las últimas ${INTERFERENCE_WEEKS} semanas con carrera, bici o senderismo exigente (series, tempo, competición, RPE 6 o más, 150 min o más, o una ruta con 700 m de desnivel o más) el día antes, o el mismo día y terminada menos de ${SAME_DAY_HOURS} h antes de la fuerza. Solo se comenta si se repite (${INTERFERENCE_MIN} veces o más) y la última es de las últimas ${RECENT_DAYS / 7} semanas.${impact ? ' Rendimiento de pierna: mejor 1RM estimado de cada ejercicio de pierna frente a su máximo de las 4 semanas previas.' : ''}`,
      data: rows,
      sources: [SOURCES.schumann2022, SOURCES.eddens2018],
    }));
  }

  // --- Rodajes suaves más rápidos ----------------------------------------------
  const easyPace = easyRunPace(d, today);
  if (easyPace && easyPace.pct >= 2) {
    insights.push(insight({
      id: 'endurance-easy-pace', area: 'endurance', level: 'good', priority: 30,
      confidence: combine([byCount(Math.min(easyPace.nCur, easyPace.nPrev), { low: 2, medium: 3, high: 5 }, (k) => `${k} carreras suaves en el tramo más corto`, 'count'), capAt('medium', 'el terreno y el calor también cambian el ritmo', 'terrain')]),
      title: 'Tus rodajes suaves van más rápidos',
      text: `Mediana de ${fmtPace(easyPace.cur)} en las últimas 4 semanas frente a ${fmtPace(easyPace.prev)} antes (un ${pctTxt(easyPace.pct, 1)} más rápido). Si el esfuerzo es el mismo, es señal de mejor base aeróbica.`,
      rule: `Ritmo mediano de las carreras suaves (rodaje/Z2, tirada larga o RPE 5 o menos) de ${RUN_MIN_KM} km o más: últimas 4 semanas frente a las 8 anteriores, con al menos 2 en cada tramo. Se comenta si es un 2 % o más rápido. El terreno y el calor también cuentan.`,
      data: [
        { label: 'Últimas 4 semanas', value: `${fmtPace(easyPace.cur)} · ${plural(easyPace.nCur, 'carrera', 'carreras')}` },
        { label: 'Las 8 anteriores', value: `${fmtPace(easyPace.prev)} · ${plural(easyPace.nPrev, 'carrera', 'carreras')}` },
      ],
      sources: [],
    }));
  }
  return { fitness: fitness.map(({ efforts, ...b }) => b), intensity, interference, insights };
}

/** Ritmo mediano de las carreras suaves: últimos 28 días frente a los 56 anteriores. */
function easyRunPace(d, today) {
  const from = addDays(today, -27);
  const prevFrom = addDays(from, -56);
  const byId = new Map(toArr(d.sessions).filter(Boolean).map((s) => [s.id, s]));
  const cur = []; const prev = [];
  for (const a of runPaceSeries(d)) {
    if (a.x > today || a.x < prevFrom || !(a.km >= RUN_MIN_KM) || !(a.sec / a.km >= MIN_PACE)) continue;
    const s = byId.get(a.sessionId);
    if (classifyIntensity(s) !== 'easy') continue;
    (a.x >= from ? cur : prev).push(pace(a.sec, a.km));
  }
  if (cur.length < 2 || prev.length < 2) return null;
  const c = median(cur); const pv = median(prev);
  return { cur: c, prev: pv, pct: ((pv - c) / pv) * 100, nCur: cur.length, nPrev: prev.length };
}

// ===========================================================================
// Rendimiento relativo por sesión (recuperación e interferencia)
// ===========================================================================

/**
 * Rendimiento relativo de cada sesión de fuerza: para cada ejercicio con 1RM estimado, mejor 1RM de la sesión / máximo
 * de ese ejercicio en los 28 días previos (en peso corporal, todo con el peso corporal del día de la sesión); la sesión
 * se queda con la media (recortada a 0,7–1,3 por si hay errores de datos). Solo sesiones con algún ejercicio con
 * historial previo.
 * @param {{today:string, from?:string, filter?:(ex)=>boolean}} opts
 * @returns {Map<string, {sessionId, date, ratio, n, parts:{name, ratio}[]}>}
 */
export function sessionPerformance(d, { today, from = null, filter = null } = {}) {
  const out = new Map();
  for (const it of exercisesWithHistory(d)) {
    const ex = it.exercise;
    if (!hasE1rm(ex) || (filter && !filter(ex))) continue;
    const hist = exerciseHistory(d, ex.id, { labels: false }).filter((e) => e.date <= today && e.e1rm != null);
    const isBw = ex.logType === 'bodyweight';
    for (let i = 0; i < hist.length; i++) {
      const e = hist[i];
      if (from && e.date < from) continue;
      const lo = addDays(e.date, -REL_DAYS);
      let priorMax = null;
      for (let j = i - 1; j >= 0 && hist[j].date >= lo; j--) {
        if (hist[j].date >= e.date) continue;
        const v = isBw && e.bw > 0 ? bestAtBw(hist[j].sets, ex, e.bw)?.value : hist[j].e1rm;
        if (v != null && (priorMax == null || v > priorMax)) priorMax = v;
      }
      if (!(priorMax > 0)) continue;
      const ratio = Math.max(0.7, Math.min(1.3, e.e1rm / priorMax));
      let row = out.get(e.sessionId);
      if (!row) { row = { sessionId: e.sessionId, date: e.date, ratio: 0, n: 0, parts: [] }; out.set(e.sessionId, row); }
      row.parts.push({ name: ex.name || ex.id, ratio });
      row.n++;
    }
  }
  for (const row of out.values()) row.ratio = row.parts.reduce((t, x) => t + x.ratio, 0) / row.n;
  return out;
}

function legImpact(d, today, interference) {
  const perf = sessionPerformance(d, { today, from: addDays(today, -(INTERFERENCE_WEEKS * 7 - 1)), filter: (ex) => (ex.primary || []).some((m) => LEG_MUSCLES.includes(m)) });
  const hit = new Set(interference.map((x) => x.strengthId));
  const a = []; const b = [];
  for (const r of perf.values()) (hit.has(r.sessionId) ? a : b).push(r.ratio);
  if (a.length < 2 || b.length < 2) return null;
  const affected = meanOf(a); const others = meanOf(b);
  return { affected, others, pct: ((others - affected) / others) * 100, nAffected: a.length, nOthers: b.length };
}

// ===========================================================================
// RECUPERACIÓN
// ===========================================================================

/** Check-in enlazado a una sesión: el que lleva su id (antes primero) o, si no, el de ese día (antes, después). */
function linkedCheckin(checkins, bySession, s) {
  const own = bySession.get(s.id);
  if (own && own.length) return own.find((c) => c.timing === 'pre') || own[0];
  return checkinFor(checkins, s.date, 'pre') || checkinFor(checkins, s.date, 'post');
}

/**
 * Compara el rendimiento relativo con un valor del check-in bajo (1) frente a normal o alto (2–3).
 * @returns {{ key, nLow, nOther, low, other, pct, d, pattern:boolean }}
 */
export function compareByCheckin(pairs, key) {
  const lowV = []; const otherV = [];
  for (const x of pairs) {
    const v = ckLevel(x.checkin[key]);
    if (v == null) continue;
    (v === 1 ? lowV : otherV).push(x.ratio);
  }
  const low = meanOf(lowV); const other = meanOf(otherV);
  const res = { key, nLow: lowV.length, nOther: otherV.length, low, other, pct: null, d: null, pattern: false };
  if (low == null || other == null) return res;
  res.pct = ((other - low) / other) * 100;
  const n1 = lowV.length; const n2 = otherV.length;
  const pooled = n1 + n2 > 2 ? Math.sqrt(((n1 - 1) * sdOf(lowV) ** 2 + (n2 - 1) * sdOf(otherV) ** 2) / (n1 + n2 - 2)) : 0;
  res.d = pooled > 0 ? (other - low) / pooled : other - low > 0 ? Infinity : 0;
  res.pattern = n1 >= MIN_GROUP && n2 >= MIN_GROUP && res.pct >= PATTERN_PCT - EPS && res.d >= PATTERN_D - EPS;
  return res;
}

/**
 * Fase estimada de un día con los ciclos COMPLETOS del CycleInfo (docs/MEJORAS5.md §4): regla (días de regla),
 * premenstrual (últimos 5 días), ovulación aprox. (duración − 14 ± 2), folicular (antes) y lútea (después).
 * Con anticonceptivo hormonal no hay fases naturales → null.
 * @returns {{ phase:'menstrual'|'follicular'|'ovulation'|'luteal'|'premenstrual', day, cycleStart }|null}
 */
export function cyclePhase(cycle, date) {
  if (!cycle || cycle.hormonal || !isDateStr(date)) return null;
  for (const c of cycle.cycles || []) {
    if (!c || !isDateStr(c.start) || !(c.lengthDays > 0)) continue;
    const day = diffDays(c.start, date) + 1;
    if (day < 1 || day > c.lengthDays) continue;
    const L = c.lengthDays;
    const pd = c.periodDays > 0 ? c.periodDays : cycle.avgPeriod > 0 ? Math.round(cycle.avgPeriod) : 5;
    const ov = L - 14;
    let phase;
    if (day <= pd) phase = 'menstrual';
    else if (day > L - 5) phase = 'premenstrual';
    else if (day >= ov - 2 && day <= ov + 2) phase = 'ovulation';
    else if (day < ov - 2) phase = 'follicular';
    else phase = 'luteal';
    return { phase, day, cycleStart: c.start };
  }
  return null;
}

/** Grupos para comparar (la ovulación va con la folicular: pocos días y estimados). */
const PHASE_GROUP = { menstrual: 'menstrual', follicular: 'follicular', ovulation: 'follicular', luteal: 'luteal', premenstrual: 'premenstrual' };
const PHASE_LABEL = { menstrual: 'la regla', follicular: 'la fase folicular', luteal: 'la fase lútea', premenstrual: 'la fase premenstrual' };

/**
 * Recuperación: sueño y energía del check-in frente al rendimiento relativo de la sesión (≥ 8 check-ins enlazados) y,
 * en modo mujer con CycleInfo (ciclo natural y ≥ 2 ciclos completos con sesiones), lo que dice SU historial por fase.
 * @param {{profile?:object, today?:string, cycle?:object|null}} [opts]
 * @returns {{ insights: Insight[], linked:number, sleep, energy, phases }}
 */
export function analyzeRecovery(data, opts = {}) {
  const { d, today, profile: p } = optsOf(data, opts);
  const cycle = opts.cycle || null;
  const insights = [];
  const from = addDays(today, -(RECOVERY_WEEKS * 7 - 1));
  const perf = sessionPerformance(d, { today, from });
  const sessions = new Map(toArr(d.sessions).filter((s) => s && s.kind === 'strength' && s.status === 'done').map((s) => [s.id, s]));
  const checkins = toArr(d.checkins);
  const bySession = new Map();
  for (const c of checkins) {
    if (!c || !c.sessionId) continue;
    if (!bySession.has(c.sessionId)) bySession.set(c.sessionId, []);
    bySession.get(c.sessionId).push(c);
  }
  const pairs = [];
  for (const r of perf.values()) {
    const s = sessions.get(r.sessionId);
    if (!s) continue;
    const c = linkedCheckin(checkins, bySession, s);
    if (!c || (ckLevel(c.sleep) == null && ckLevel(c.energy) == null)) continue;
    pairs.push({ ...r, checkin: c });
  }
  pairs.sort((a, b) => (a.date < b.date ? -1 : 1));
  const rule = `Rendimiento relativo de cada sesión de fuerza: para cada ejercicio, su mejor 1RM estimado de ese día frente a su máximo de las ${REL_DAYS / 7} semanas previas (media de los ejercicios de la sesión). Se enlaza con el check-in de esa sesión (o de ese día) de las últimas ${RECOVERY_WEEKS} semanas y se compara la media de los días con sueño (o energía) bajo con la de los días normales o buenos. Hacen falta ${MIN_LINKED} sesiones con check-in o más y ${MIN_GROUP} en cada grupo; patrón claro: una diferencia del ${PATTERN_PCT} % o más y consistente (tamaño del efecto ≥ ${fmtNum(PATTERN_D, 1)}).`;
  let sleep = null; let energy = null;
  if (pairs.length < MIN_LINKED) {
    insights.push(insight({
      id: 'recovery-insufficient', area: 'recovery', level: 'info', priority: 8,
      confidence: confInsufficient(`${pairs.length} de ${MIN_LINKED} sesiones con check-in`),
      title: 'Check-ins: aún pocos para ver patrones',
      text: `Llevas ${plural(pairs.length, 'sesión', 'sesiones')} de fuerza con check-in (sueño o energía). Con ${MIN_LINKED} o más podré decirte si dormir mal o llegar con poca energía cambia tu rendimiento.`,
      rule, data: [{ label: 'Sesiones con check-in y rendimiento', value: `${pairs.length} de ${MIN_LINKED}` }],
      sources: [SOURCES.knowles2018],
    }));
  } else {
    sleep = compareByCheckin(pairs, 'sleep');
    energy = compareByCheckin(pairs, 'energy');
    const groupConf = (c) => combine([
      byCount(Math.min(c.nLow, c.nOther), { low: MIN_GROUP, medium: 5, high: 8 }, (k) => `${k} sesiones en el grupo más pequeño`, 'count'),
      Number.isFinite(c.d) && c.d < 0.8 ? capAt('medium', 'diferencia moderada', 'effect') : null,
      capAt('medium', 'es una asociación en tus datos, no una causa demostrada', 'assoc'),
    ]);
    const pairRows = pairs.slice(-12).map((x) => ({ label: dayTxt(x.date, today), value: `${pctTxt(x.ratio * 100, 1)} de tu máximo · sueño ${word(x.checkin.sleep, 'sleep')} · energía ${word(x.checkin.energy, 'energy')}` }));
    const groupRows = (c, noun, lowW) => [
      { label: `${cap(noun)} ${lowW}`, value: c.nLow ? `${pctTxt(c.low * 100, 1)} de media · ${plural(c.nLow, 'sesión', 'sesiones')}` : 'ninguna sesión' },
      { label: `${cap(noun)} normal o ${noun === 'sueño' ? 'bueno' : 'alta'}`, value: c.nOther ? `${pctTxt(c.other * 100, 1)} de media · ${plural(c.nOther, 'sesión', 'sesiones')}` : 'ninguna sesión' },
    ];
    if (sleep.pattern) {
      const pr = Math.round(sleep.pct);
      insights.push(insight({
        id: 'recovery-sleep', area: 'recovery', level: pr >= 5 ? 'warn' : 'info', priority: 56, confidence: groupConf(sleep),
        title: 'Dormir mal te resta fuerza',
        text: `Los días que dormiste mal rendiste un ${pctTxt(pr)} menos (${plural(sleep.nLow, 'sesión', 'sesiones')} con sueño bajo frente a ${fmtNum(sleep.nOther, 0)} con sueño normal o bueno). Esos días, prioriza la técnica y no busques récords; si se repite a menudo, cuidar el horario de sueño es de lo que más te puede aportar.`,
        rule, data: [...groupRows(sleep, 'sueño', 'bajo'), ...pairRows], sources: [SOURCES.knowles2018],
      }));
    }
    if (energy.pattern) {
      const pr = Math.round(energy.pct);
      insights.push(insight({
        id: 'recovery-energy', area: 'recovery', level: 'info', priority: 50, confidence: groupConf(energy),
        title: 'Con poca energía rindes menos',
        text: `Los días que llegaste ${g(p, 'cansado', 'cansada')} (energía baja) rendiste un ${pctTxt(pr)} menos (${plural(energy.nLow, 'sesión', 'sesiones')} frente a ${fmtNum(energy.nOther, 0)}). Si pasa a menudo, mira el descanso, la comida antes de entrenar y el total de carga de la semana.`,
        rule, data: [...groupRows(energy, 'energía', 'baja'), ...pairRows], sources: [SOURCES.knowles2018],
      }));
    }
    if (!sleep.pattern && !energy.pattern) {
      const few = [];
      if (sleep.nLow < MIN_GROUP) few.push(`días con sueño bajo (${sleep.nLow})`);
      if (energy.nLow < MIN_GROUP) few.push(`días con energía baja (${energy.nLow})`);
      const diffs = [sleep, energy].filter((c) => c.pct != null).map((c) => `${c.key === 'sleep' ? 'sueño' : 'energía'} ${Math.abs(c.pct) < 0.5 ? '±0' : `${c.pct > 0 ? '−' : '+'}${fmtNum(Math.abs(c.pct), 1)}`} %`);
      insights.push(insight({
        id: 'recovery-no-pattern', area: 'recovery', level: 'neutral', priority: 15,
        confidence: combine([byCount(pairs.length, { low: MIN_LINKED, medium: 12, high: 20 }, (k) => `${k} sesiones con check-in`, 'count')]),
        title: 'Sin un patrón claro con el sueño y la energía',
        text: `Con ${plural(pairs.length, 'sesión', 'sesiones')} con check-in, tu rendimiento no cambia de forma clara según cómo duermes o llegas${diffs.length ? ` (${diffs.join(', ')} los días bajos)` : ''}.${few.length ? ` Aún hay pocos ${joinList(few)} para compararlo bien.` : ''}`,
        rule, data: [...groupRows(sleep, 'sueño', 'bajo'), ...groupRows(energy, 'energía', 'baja'), ...pairRows], sources: [SOURCES.knowles2018],
      }));
    }
  }

  // --- Ciclo (modo mujer, ciclo natural) ------------------------------------------
  let phases = null;
  if (isFemale(p) && cycle && cycle.enabled !== false && !cycle.hormonal) {
    phases = phaseAnalysis({ perf, checkins, cycle, today, from });
    if (phases.ok) insights.push(phaseInsight(phases, today, p));
  }
  return { insights, linked: pairs.length, sleep, energy, phases };
}

const word = (v, key) => {
  const l = ckLevel(v);
  if (l == null) return '—';
  return key === 'sleep' ? { 1: 'bajo', 2: 'normal', 3: 'alto' }[l] : { 1: 'baja', 2: 'normal', 3: 'alta' }[l];
};

function phaseAnalysis({ perf, checkins, cycle, today, from }) {
  const groups = {};
  const cyclesWith = new Set();
  for (const r of perf.values()) {
    const ph = cyclePhase(cycle, r.date);
    if (!ph) continue;
    const k = PHASE_GROUP[ph.phase];
    (groups[k] ||= { perf: [], energy: [] }).perf.push(r.ratio);
    cyclesWith.add(ph.cycleStart);
  }
  for (const c of checkinsBetween(checkins, from, today)) {
    const e = ckLevel(c.energy);
    if (e == null) continue;
    const ph = cyclePhase(cycle, c.date);
    if (!ph) continue;
    (groups[PHASE_GROUP[ph.phase]] ||= { perf: [], energy: [] }).energy.push(e);
  }
  const rows = Object.entries(groups).map(([k, v]) => ({
    phase: k, n: v.perf.length, perf: meanOf(v.perf), nEnergy: v.energy.length, energy: meanOf(v.energy),
  })).filter((x) => x.n >= MIN_GROUP);
  const ok = cyclesWith.size >= 2 && rows.length >= 2;
  if (!ok) return { ok: false, cycles: cyclesWith.size, rows };
  rows.sort((a, b) => b.perf - a.perf);
  const best = rows[0]; const worst = rows[rows.length - 1];
  const pct = ((best.perf - worst.perf) / best.perf) * 100;
  return { ok: true, cycles: cyclesWith.size, rows, best, worst, pct, pattern: pct >= PATTERN_PCT - EPS };
}

/** Confianza del análisis por fases: ciclos con sesiones y sesiones de la fase con menos datos; fases estimadas → media como mucho. */
function phaseConf(ph) {
  return combine([
    byCount(ph.cycles, { low: 2, medium: 3, high: 4 }, (k) => `${k} ciclos completos con sesiones`, 'cycles'),
    byCount(Math.min(...ph.rows.map((r) => r.n)), { low: MIN_GROUP, medium: 5, high: 8 }, (k) => `${k} sesiones en la fase con menos datos`, 'count'),
    capAt('medium', 'las fases son estimaciones', 'phase'),
  ]);
}

function phaseInsight(ph, today, p) {
  const rows = ph.rows.map((r) => ({
    label: cap(PHASE_LABEL[r.phase]),
    value: `${pctTxt(r.perf * 100, 1)} de tu máximo · ${plural(r.n, 'sesión', 'sesiones')}${r.energy != null ? ` · energía media ${fmtNum(r.energy, 1)} de 3 (${r.nEnergy})` : ''}`,
  }));
  rows.unshift({ label: 'Ciclos completos con sesiones', value: String(ph.cycles) });
  const rule = `Solo tu historial: fase estimada de cada sesión con tus ciclos completos (regla, folicular con la ovulación aproximada, lútea y premenstrual, los 5 últimos días) y, en cada fase con ${MIN_GROUP} sesiones o más, la media del rendimiento relativo (mejor 1RM estimado frente al máximo de las 4 semanas previas) y de la energía del check-in. Hace falta haber entrenado en 2 ciclos completos o más. Se habla de diferencia si la mejor y la peor fase se separan un ${PATTERN_PCT} % o más. Las fases son estimaciones y con pocos datos una diferencia puede ser casualidad.`;
  if (ph.pattern) {
    return insight({
      id: 'cycle-performance', area: 'cycle', level: 'info', priority: 38, confidence: phaseConf(ph),
      title: `En tu historial, ${PHASE_LABEL[ph.worst.phase]} es tu fase más floja`,
      text: `En ${PHASE_LABEL[ph.worst.phase]} rindes un ${pctTxt(Math.round(ph.pct))} menos que en ${PHASE_LABEL[ph.best.phase]} (${plural(ph.worst.n, 'sesión', 'sesiones')} y ${fmtNum(ph.best.n, 0)}). Es lo que dicen tus datos, no una regla: en promedio la fase afecta poco y de forma distinta a cada mujer. Si esos días te notas peor, baja un poco la carga sin culpa; si te sientes bien, entrena normal.`,
      rule, data: rows, sources: [SOURCES.mcnulty2020],
    });
  }
  return insight({
    id: 'cycle-performance', area: 'cycle', level: 'neutral', priority: 24, confidence: phaseConf(ph),
    title: 'Tu rendimiento apenas cambia con el ciclo',
    text: `En tu historial no se ve una diferencia clara de rendimiento entre fases (como mucho un ${pctTxt(ph.pct, 1)}). Coincide con la evidencia: en promedio la fase afecta poco. Entrena según cómo te sientas cada día${g(p, '.', '; si algún día estás cansada, ajusta sin culpa.')}`,
    rule, data: rows, sources: [SOURCES.mcnulty2020, SOURCES.colensoSemple2023],
  });
}

// Ronda 6 (fase D): piezas que usa analysis-hybrid.js (carga por deporte, volumen, interferencia personal).
export { legSets as legSetsOf, demanding as demandingEndurance, muscleAverages, fatigueSignals, LEG_MUSCLES };
