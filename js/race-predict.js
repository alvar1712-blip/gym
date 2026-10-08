// race-predict.js — tiempos previstos de carrera (5 km, 10 km, media y maratón) y comprobador «¿Puedo hacerlo?».
// PROPIETARIO: módulo de predicciones. PURO: sin DOM ni store; se prueba en Node (tests/unit/race-predict.test.mjs).
// Contrato: docs/MEJORAS.md §4. La vista (js/views/predictions.js) construye `data` con progress-ui.dataFromStore()
// UNA vez por render y llama a predictRaces(data) y checkTarget(data, km, segundos).
// «Hoy» es inyectable: data.today ('YYYY-MM-DD') o el último parámetro { today } (manda sobre data.today).
//
// Reutiliza (no duplica cálculos):
//  - stats.js: runPaceSeries (carreras terminadas con distancia y tiempo en movimiento —o duración en registros
//    antiguos—, incluidas las enlazadas a una sesión de fuerza; SOLO kind 'run': senderismo, bici… no cuentan),
//    enduranceRecords (mejor marca registrada en cada distancia, como contexto en «¿Por qué?») y RACE_DISTANCES.
//  - calc.js: riegel, pace y RIEGEL_K (1,06); util.js: fmtTimeWords.
//  Dirección de dependencias: calc ← race-predict ← goals-logic (los objetivos de carrera con tiempo consumen este
//  motor: predictFor, predictionSeries, checkTarget, baseOf). Este módulo NO importa goals-logic.
//
// REGLAS
//  1. Esfuerzos válidos: carreras con fecha en las últimas 12 semanas (hoy y los 83 días anteriores), distancia
//     ≥ 3 km y ritmo creíble: entre 2:30 /km (más rápido es un error de datos) y 20:00 /km (más lento que caminar:
//     casi siempre un tiempo mal apuntado, p. ej. 31 min escritos en la casilla de las horas = 31 h). Las que no
//     cuentan por el ritmo salen en `suspect` para poder revisarlas. El esfuerzo de una carrera es su tiempo
//     en movimiento en su distancia. Menos de 2 válidos → ok:false, reason 'datos insuficientes'.
//  2. Base: los 3 mejores esfuerzos por rendimiento equivalente de Riegel (T / D^1,06, menor = mejor; empate → el más
//     reciente). La misma base para todas las distancias.
//  3. Para una distancia D: cada esfuerzo predice tᵢ = Tᵢ × (D / Dᵢ)^k y pesa
//     wᵢ = recencia × parecido, recencia = 1 − días / 168 (1 hoy, ≈ 0,5 a las 12 semanas) y
//     parecido = √(menor / mayor) entre Dᵢ y D. Previsto = Σ wᵢ·tᵢ / Σ wᵢ. Dispersión = desviación típica ponderada de
//     las tᵢ; margen = máx(3 %, dispersión / previsto), como mucho ±25 %; rango = previsto × (1 ± margen). Se
//     redondea hacia fuera (low hacia abajo, high hacia arriba; previsto al más cercano) a 5 s (< 15 km), 10 s
//     (< 30 km) o 30 s. «Previsto» (la estimación actual, el número grande de la vista) = esa media ponderada.
//     Con una dispersión de más de ±25 % los esfuerzos se contradicen: la predicción no es útil (estado
//     'incoherent') y el tope del margen solo evita números absurdos (antes, con dispersión ≥ 100 %, low < 0).
//  4. Volumen (media y maratón; en otra distancia: perfil «media» de 15 a < 30 km y «maratón» desde 30 km):
//     km semanales = km de carrera de las últimas 6 semanas (hoy y los 41 días anteriores, cualquier distancia) / 6
//     (las semanas sin carreras cuentan como 0); tirada más larga = la carrera más larga de esas 6 semanas.
//     Umbrales: media 25 km/sem y tirada de 14 km; maratón 40 km/sem y 24 km. Lo que falta de cada uno =
//     máx(0, 1 − valor / umbral); k = 1,06 + 0,04 × (lo que más falte de los dos) → como mucho 1,10.
//  5. Confianza: parte de «alta» y baja un nivel por cada motivo: solo 2 esfuerzos; ningún esfuerzo entre D / 4 y
//     4 × D (extrapolación larga); dispersión > ±8 %; y en media/maratón, km semanales bajo el umbral y tirada bajo el
//     umbral. Más allá del maratón o por debajo de 1,5 km, siempre «baja».
//  1b. Resultados de carrera de «Tu contexto» (context-logic, hecho 'race_result'; la ÚNICA copia de esa marca): con
//     fecha la mitad de su periodo («mayo 2026» → 16 may). Los de las últimas 12 semanas cuentan como una carrera
//     registrada más (≥ 1 km: una marca apuntada es un esfuerzo a tope; también suman al volumen). Los anteriores son
//     «referencias históricas»: entran en cada distancia como mucho las HISTORY_TOP de más peso, aparte de la base.
//     Mismo filtro de ritmo (las que no cuentan, en `suspect`, con source 'context'). Si una carrera registrada válida
//     es la misma (fecha dentro del periodo ±1 día, distancia y tiempo a ±5 %), cuenta solo la registrada
//     (`duplicates`): nada se borra.
//  3b. Recencia más allá de 12 semanas (solo referencias históricas): sigue la misma curva sin saltos (mismo valor y
//     pendiente a los 84 días): 0,5 · e^(−(días − 84) / 84), así que se reduce a la mitad cada ~8 semanas y nunca llega
//     a 0 (≈ 0,23 a los 5 meses, ≈ 0,02 al año). Parón: un esfuerzo anterior a un parón pesa la mitad (BREAK_FACTOR):
//     parón = una fase de tu contexto «Parón o entrenamiento irregular», «Vuelta tras vacaciones o parón»,
//     «Enfermedad» o «Lesión» que empieza después, o un hecho «Vacaciones», «Enfermedad» o «Lesión» posterior; en una
//     referencia histórica, también RUN_GAP_DAYS (4 semanas) o más sin correr después de ella. Sin nada apuntado, las
//     carreras de las últimas 12 semanas pesan exactamente como antes.
//  5b. Estado (status) de cada predicción: 'ok'; 'tentative' («todavía poco fiable»: a la media o al maratón les falta
//     más de la mitad de un umbral de volumen, o hay menos de 2 carreras recientes y la estimación se apoya en tus
//     referencias históricas; la fórmula lo calcula pero no es una predicción útil; confianza «baja»);
//     'incoherent' (dispersión > ±25 %; confianza «baja»); 'invalid' (algún número no finito o ≤ 0; no debería pasar).
//     usable = 'ok' o 'tentative'. advice = { note (aviso corto para la tarjeta), improve (qué dato la mejoraría) }.
//  5c. Más motivos de confianza: más del 30 % de la estimación sale de referencias históricas ('old'); la carrera más
//     reciente que se usa es anterior a un parón ('break').
//     Se puede predecir con ≥ 2 carreras recientes válidas o con al menos un resultado de tu contexto (canPredict).
//  6. checkTarget: objetivo ≥ high → 'probable'; low ≤ objetivo < high → 'ajustado'; objetivo < low → 'hoy_no';
//     sin datos o sin predicción útil (incoherent/invalid) → 'insuficiente'. gapSec = previsto − objetivo (> 0: lo que
//     falta respecto al tiempo previsto; ≤ 0: margen). Se compara con los valores redondeados que se muestran.
//  7. Formato: tiempos con util.fmtRaceTime («29:37», «1:42:16»), ritmos con util.fmtPaceKm («5:55/km»), rangos con
//     fmtRaceRange / fmtPaceRange (siempre de menor a mayor). Nunca negativos ni «h:mm:ss /km».
// Tono: siempre estimación, nunca promesa.
import {
  addDays, diffDays, todayStr, isDateStr, fmtDate, fmtNum, fmtRaceTime, fmtPaceKm, fmtRaceRange, fmtPaceRange, fmtTimeWords,
} from './util.js';
import { riegel, pace, RUN_PACE_MIN, RUN_PACE_MAX, RIEGEL_K } from './calc.js';
import { runPaceSeries, enduranceRecords, RACE_DISTANCES } from './stats.js';
import { raceResults, normalizeAll, entryRange, entryTitle, entryWhen, approxLabel, matchesRun, RESULT_DUP_TOL } from './context-logic.js';

// ===========================================================================
// Constantes
// ===========================================================================

/** Exponente de Riegel (el mismo de los objetivos de carrera). */
export const K = RIEGEL_K;
/** Exponente máximo cuando el volumen se queda corto (media y maratón). */
export const K_MAX = 1.1;
/** Distancia mínima de un esfuerzo válido (km). Este módulo es su dueño; goals-logic.MIN_KM.run la reexporta. */
export const MIN_KM = 3;
/** Ventana de los esfuerzos: 12 semanas. */
export const WINDOW_WEEKS = 12;
export const WINDOW_DAYS = WINDOW_WEEKS * 7;
/** Ventana del volumen (km semanales y tirada más larga): 6 semanas. */
export const VOLUME_WEEKS = 6;
export const VOLUME_DAYS = VOLUME_WEEKS * 7;
/** Esfuerzos que se usan (los mejores). */
export const TOP_N = 3;
/** Mínimo de esfuerzos válidos para predecir. */
export const MIN_VALID = 2;
/** Margen mínimo del rango (±3 %). */
export const MIN_MARGIN = 0.03;
/** Dispersión a partir de la cual la confianza baja un nivel (±8 %). */
export const SPREAD_WARN = 0.08;
/** Recencia: 1 − días / RECENCY_DAYS (a las 12 semanas cuenta la mitad). */
export const RECENCY_DAYS = WINDOW_DAYS * 2;
/** Ritmo más rápido creíble (s/km): 2:30 /km (calc.RUN_PACE_MIN). */
export const MIN_PACE = RUN_PACE_MIN;
/**
 * Ritmo más lento creíble para una carrera (s/km): 20:00 /km (calc.RUN_PACE_MAX; 3 km/h, más lento que caminar). Más
 * lento casi siempre es un tiempo mal apuntado (31 min escritos en la casilla de las horas son 31 h: 6:12:00 /km en 5 km).
 */
export const MAX_PACE = RUN_PACE_MAX;
/** Dispersión a partir de la cual los esfuerzos se contradicen y la predicción no es útil (±25 %); tope del margen. */
export const MAX_SPREAD = 0.25;
/** A la media o al maratón les falta más de esta parte de un umbral de volumen → «todavía poco fiable». */
export const TENTATIVE_SHORT = 0.5;
/** Estados de una predicción (regla 5b). */
export const STATUSES = ['ok', 'tentative', 'incoherent', 'invalid'];
/** Un esfuerzo «cercano» está entre D / NEAR_FACTOR y D × NEAR_FACTOR. */
export const NEAR_FACTOR = 4;
/** Por debajo de esta distancia (km) la fórmula es poco fiable: confianza baja. */
export const SHORT_LIMIT_KM = 1.5;
/** Umbrales de volumen por perfil. */
export const VOLUME = {
  half: { weeklyKm: 25, longKm: 14, label: 'media maratón' },
  marathon: { weeklyKm: 40, longKm: 24, label: 'maratón' },
};
export const CONFIDENCE_LEVELS = ['baja', 'media', 'alta'];
export const CONFIDENCE_LABEL = { alta: 'Alta', media: 'Media', baja: 'Baja' };
export const VERDICTS = ['probable', 'ajustado', 'hoy_no', 'insuficiente'];
export const VERDICT_LABEL = { probable: 'Probable', ajustado: 'Ajustado', hoy_no: 'Hoy no', insuficiente: 'Datos insuficientes' };
/** Motivo de ok:false en predictRaces. */
export const INSUFFICIENT = 'datos insuficientes';

const MARATHON_KM = 42.195;
const EPS = 1e-9;
const SHORT = { '5k': '5 km', '10k': '10 km', half: 'Media', marathon: 'Maratón' };
const PHRASE = { '5k': 'en 5 km', '10k': 'en 10 km', half: 'en la media maratón', marathon: 'en el maratón' };
/** Nombre en minúscula dentro de una frase («para la media maratón»). */
const NOUN = { '5k': 'los 5 km', '10k': 'los 10 km', half: 'la media maratón', marathon: 'el maratón' };

/** Distancia mínima de un resultado de tu contexto para predecir (km; un test de 1 km sí cuenta). */
export const CONTEXT_MIN_KM = 1;
/** Referencias históricas (resultados de tu contexto de hace más de 12 semanas) por distancia, como mucho. */
export const HISTORY_TOP = 2;
/** Un esfuerzo anterior a un parón pesa esto (la mitad). */
export const BREAK_FACTOR = 0.5;
/** Hueco sin correr que cuenta como parón después de una referencia histórica (días). */
export const RUN_GAP_DAYS = 28;
/** Fases y hechos de tu contexto que cuentan como parón. */
export const BREAK_PHASES = ['break', 'return', 'illness', 'injury'];
export const BREAK_EVENTS = ['holidays', 'illness', 'injury'];
/** Si las referencias históricas pesan más de esto en una estimación, la confianza baja un nivel. */
export const OLD_SHARE_WARN = 0.3;
/** Misma carrera (registrada y apuntada en tu contexto): distancia y tiempo a ±5 % (context-logic.matchesRun). */
export const DUP_TOL = RESULT_DUP_TOL;

/** Las 4 distancias: { id, km, label, short (chip), phrase («en la media maratón»), noun, profile }. */
export const RACES = RACE_DISTANCES.map((r) => ({
  id: r.id, km: r.km, label: r.label, short: SHORT[r.id] || r.label, phrase: PHRASE[r.id] || `en ${r.label}`,
  noun: NOUN[r.id] || r.label, profile: r.id === 'half' || r.id === 'marathon' ? r.id : null,
}));

// ===========================================================================
// Piezas de la regla (exportadas para las pruebas)
// ===========================================================================

/**
 * Peso por recencia: 1 − días / 168 en las 12 semanas de la ventana; después (solo referencias históricas), la misma
 * curva sigue sin saltos y sin llegar a 0: 0,5 · e^(−(días − 84) / 84).
 */
export function recencyWeight(ageDays) {
  const a = Math.max(0, ageDays);
  if (a <= WINDOW_DAYS) return 1 - a / RECENCY_DAYS;
  return (1 - WINDOW_DAYS / RECENCY_DAYS) * Math.exp(-(a - WINDOW_DAYS) / (RECENCY_DAYS - WINDOW_DAYS));
}

/** Peso por parecido de distancia: √(menor / mayor). */
export function distanceWeight(km, targetKm) {
  if (!(km > 0 && targetKm > 0)) return 0;
  return Math.sqrt(Math.min(km, targetKm) / Math.max(km, targetKm));
}

/** Perfil de volumen de una distancia cualquiera: 'marathon' (≥ 30 km), 'half' (15 a < 30 km) o null. */
export function volumeProfile(km) {
  if (km >= 30 - EPS) return 'marathon';
  if (km >= 15 - EPS) return 'half';
  return null;
}

/**
 * Ajuste de k por volumen.
 * @returns {{profile, weeklyKm, longKm, weeklyTarget, longTarget, weeklyShort, longShort, short, weeklyOk, longOk, k}|null}
 *  weeklyShort / longShort = máx(0, 1 − valor / umbral); short = el mayor; k = 1,06 + 0,04 × short.
 */
export function volumeAdjust(profile, weeklyKm, longKm) {
  const t = VOLUME[profile];
  if (!t) return null;
  const wk = weeklyKm > 0 ? weeklyKm : 0;
  const lg = longKm > 0 ? longKm : 0;
  const weeklyShort = Math.max(0, 1 - wk / t.weeklyKm);
  const longShort = Math.max(0, 1 - lg / t.longKm);
  const short = Math.max(weeklyShort, longShort);
  return {
    profile, weeklyKm: wk, longKm: lg, weeklyTarget: t.weeklyKm, longTarget: t.longKm,
    weeklyShort, longShort, short, weeklyOk: weeklyShort <= EPS, longOk: longShort <= EPS,
    k: K + (K_MAX - K) * short,
  };
}

/** Redondeo del rango mostrado: 5 s (< 15 km), 10 s (< 30 km) o 30 s. */
export function stepFor(km) {
  return km < 15 - EPS ? 5 : km < 30 - EPS ? 10 : 30;
}

/** Distancia estándar (5k, 10k, media, maratón) que coincide con `km`, o null. */
export function raceFor(km) {
  return RACES.find((r) => Math.abs(r.km - km) < 0.001) || null;
}

// ===========================================================================
// Formato
// ===========================================================================

const kmTxt = (km) => `${fmtNum(km, 2)} km`;
const pctTxt = (x) => `${fmtNum(x * 100, 1)} %`;
const dayTxt = (d) => fmtDate(d, 'day');
const kTxt = (k) => fmtNum(k, 3, 2);
/** Tiempo «29:37» / «1:42:16» o '—' si no vale. */
const timeTxt = (s) => fmtRaceTime(s) ?? '—';
/** Ritmo «5:55/km» o '—' si no vale. */
const paceTxt = (s) => fmtPaceKm(s) ?? '—';
/** «23:40–24:50» (de la mejor estimación a la más prudente); 'Datos insuficientes' si algún extremo no vale. */
export const rangeText = (p) => fmtRaceRange(p?.low, p?.high) ?? 'Datos insuficientes';
/** Ritmo del rango: «4:44–4:58/km»; '—' si no vale. */
export const paceRangeText = (p) => fmtPaceRange(p?.paceLow, p?.paceHigh) ?? '—';
/** ¿Es creíble este ritmo (s/km) para un esfuerzo de carrera? Entre 2:30 y 20:00 /km. */
export const plausibleRunPace = (secPerKm) => secPerKm >= MIN_PACE && secPerKm <= MAX_PACE;
/** «3 carreras» / «1 carrera». */
const runsTxt = (n) => `${n} ${n === 1 ? 'carrera' : 'carreras'}`;

/** Diferencia de tiempo en palabras: «7 s», «1 min 20 s», «1 h 02 min 30 s» (≥ 1 min, redondeada a 5 s). */
export function fmtGap(sec) {
  const s = Math.round(Math.abs(sec));
  return fmtTimeWords(s < 60 ? s : Math.round(s / 5) * 5);
}

/** Diferencia por km: «8 s/km», «menos de 1 s/km», «1:05/km». */
export function fmtGapPerKm(secPerKm) {
  const s = Math.abs(secPerKm);
  if (!Number.isFinite(s)) return '—';
  if (s < 0.5) return 'menos de 1 s/km';
  if (s < 59.5) return `${Math.round(s)} s/km`;
  return paceTxt(s);
}

// ===========================================================================
// Análisis de las carreras
// ===========================================================================

function todayOf(data, opts) {
  if (opts && isDateStr(opts.today)) return opts.today;
  if (data && isDateStr(data.today)) return data.today;
  return todayStr();
}

const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);
const ageTxt = (days) => (days < 14 ? `hace ${days} ${days === 1 ? 'día' : 'días'}` : days < 60 ? `hace ${Math.round(days / 7)} semanas` : `hace ${Math.round(days / 30.44)} meses`);

/** Parones apuntados en tu contexto hasta `today`: { from, label } (fases y hechos de BREAK_PHASES / BREAK_EVENTS). */
function contextBreaks(context, today) {
  const out = [];
  for (const e of normalizeAll(context)) {
    const types = e.kind === 'phase' ? BREAK_PHASES : BREAK_EVENTS;
    if (!types.includes(e.type)) continue;
    const from = entryRange(e).from;
    if (from && from <= today) out.push({ kind: 'context', from, label: `«${entryTitle(e)}» (${entryWhen(e)})` });
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** Fechas (ordenadas, sin repetir) con alguna carrera registrada terminada hasta hoy (con o sin distancia). */
function runDates(d, today) {
  const set = new Set();
  for (const s of toArr(d.sessions)) if (s && s.kind === 'run' && s.status === 'done' && isDateStr(s.date) && s.date <= today) set.add(s.date);
  return [...set].sort();
}

/** Huecos de RUN_GAP_DAYS o más entre fechas de carrera consecutivas (y de la última a hoy), memorizados por lista. */
const GAPS = new WeakMap();
function bigGaps(dates, today) {
  const m = GAPS.get(dates);
  if (m && m.today === today) return m.list;
  const list = [];
  for (let i = 0; i < dates.length; i++) {
    const next = i + 1 < dates.length ? dates[i + 1] : today;
    const days = diffDays(dates[i], next);
    if (days >= RUN_GAP_DAYS) list.push({ after: dates[i], next, days });
  }
  GAPS.set(dates, { today, list });
  return list;
}
const gapInfo = (after, next, days, today) => ({ kind: 'gap', from: addDays(after, 1), label: `${Math.floor(days / 7)} semanas sin correr${next === today ? ' (hasta hoy)' : ''}` });

/**
 * Primer parón después de `date` (regla 3b): uno de tu contexto que empieza después (manda: es lo que tú apuntaste) o,
 * si no hay y con `gaps`, RUN_GAP_DAYS o más sin correr entre `date` y hoy (`dates` = fechas de carrera ordenadas).
 * → { kind:'context'|'gap', from, label } | null
 */
export function breakAfter(date, { breaks = [], dates = [], today, gaps = false } = {}) {
  const best = breaks.find((b) => b.from > date) || null;
  if (best || !gaps) return best;
  // Primera carrera después de `date` (búsqueda binaria) y, desde ella, el primer hueco largo precalculado
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] <= date) lo = m + 1; else hi = m; }
  const first = lo < dates.length ? dates[lo] : today;
  const d0 = diffDays(date, first);
  if (d0 >= RUN_GAP_DAYS) return gapInfo(date, first, d0, today);
  if (lo >= dates.length) return null;
  const g = bigGaps(dates, today).find((x) => x.after >= first);
  return g ? gapInfo(g.after, g.next, g.days, today) : null;
}

/** ¿Hay datos para predecir? ≥ 2 carreras recientes válidas o al menos un resultado de tu contexto utilizable. */
export const canPredict = (ctx) => ctx.valid.length >= MIN_VALID || (ctx.valid.length + ctx.history.length >= 1 && ctx.contextUsed > 0);

/**
 * Esfuerzos, base, referencias históricas y volumen a partir de `data` (entrada común de stats.js; `data.context` =
 * almacén 'context' para los resultados de carrera y los parones).
 * @param {object} data
 * @param {{today?:string}} [opts]
 * @returns {{ today, from, volumeFrom, runs, valid:Effort[], basis:Effort[], history:Effort[], duplicates, excluded:{old,
 *   short, implausible, slow}, contextExcluded:{short}, contextUsed, suspect:Suspect[], breaks, weeklyKm, volumeKm,
 *   volumeRuns, longest:{km, sec, date, sessionId, entryId}|null, longestRecentKm, records }}
 *  Effort = { source:'run'|'context', sessionId|null, entryId|null, date, when, km, sec, pace (s/km), age (días),
 *    score (T / D^1,06), old (referencia histórica), interrupted (breakAfter)|null, label «10 km en 44:30 (4:27/km)» }
 *  valid: carreras registradas y resultados de tu contexto de las últimas 12 semanas; history: resultados anteriores.
 *  excluded (carreras registradas): implausible = más rápidas de 2:30 /km; slow = más lentas de 20:00 /km.
 *  Suspect = { source, sessionId|null, entryId|null, date, km, sec, pace, why:'fast'|'slow', label } (para revisarlas).
 *  duplicates = [{ entryId, sessionId, label, when }]: resultados de tu contexto que son una carrera registrada válida.
 */
export function analyzeRuns(data, opts = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const today = todayOf(d, opts);
  // Memo por objeto `data` y «hoy» (la tendencia de un objetivo pide ~12 fechas): como stats.getIndex, se invalida si
  // cambian las listas de sesiones o de contexto (otra lista o distinta longitud). El ctx devuelto es de solo lectura.
  if (d !== data) return buildRuns(d, today);
  let m = RUNS_MEMO.get(d);
  if (!m || m.sessions !== d.sessions || m.sessionsLen !== lenOf(d.sessions) || m.context !== d.context || m.contextLen !== lenOf(d.context)) {
    m = { sessions: d.sessions, sessionsLen: lenOf(d.sessions), context: d.context, contextLen: lenOf(d.context), byDay: new Map() };
    RUNS_MEMO.set(d, m);
  }
  let ctx = m.byDay.get(today);
  if (!ctx) { ctx = buildRuns(d, today); m.byDay.set(today, ctx); }
  return ctx;
}

const RUNS_MEMO = new WeakMap();
const lenOf = (x) => (Array.isArray(x) ? x.length : x instanceof Map ? x.size : x && typeof x === 'object' ? Object.keys(x).length : 0);

function buildRuns(d, today) {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const volumeFrom = addDays(today, -(VOLUME_DAYS - 1));
  const runs = runPaceSeries(d).filter((a) => a.x <= today && a.km > 0 && a.sec > 0);
  const breaks = contextBreaks(d.context, today);
  const results = raceResults(d.context, today);
  // Días en que corriste: lo registrado y los resultados de tu contexto (para los huecos sin correr)
  const dates = [...new Set([...runDates(d, today), ...results.map((r) => r.date)])].sort();
  const excluded = { old: 0, short: 0, implausible: 0, slow: 0 };
  const contextExcluded = { short: 0 };
  const suspect = [];
  const valid = [];
  const history = [];
  const duplicates = [];
  let volumeKm = 0;
  let volumeRuns = 0;
  let longest = null;
  const addVolume = (km, sec, date, sessionId, entryId = null) => {
    if (date < volumeFrom) return;
    volumeKm += km;
    volumeRuns++;
    if (!longest || km > longest.km + EPS || (Math.abs(km - longest.km) <= EPS && date > longest.date)) longest = { km, sec, date, sessionId, entryId };
  };
  const label = (km, sec, p) => `${kmTxt(km)} en ${timeTxt(sec)} (${paceTxt(p)})`;
  for (const a of runs) {
    addVolume(a.km, a.sec, a.x, a.sessionId);
    if (a.x < from) { excluded.old++; continue; }
    if (a.km + EPS < MIN_KM) { excluded.short++; continue; }
    const p = pace(a.sec, a.km);
    if (!plausibleRunPace(p)) {
      const why = p < MIN_PACE ? 'fast' : 'slow';
      excluded[why === 'fast' ? 'implausible' : 'slow']++;
      suspect.push({ source: 'run', sessionId: a.sessionId, entryId: null, date: a.x, km: a.km, sec: a.sec, pace: p, why, label: `${kmTxt(a.km)} en ${timeTxt(a.sec)}` });
      continue;
    }
    valid.push({
      source: 'run', sessionId: a.sessionId, entryId: null, date: a.x, when: dayTxt(a.x), km: a.km, sec: a.sec, pace: p,
      age: diffDays(a.x, today), score: a.sec / a.km ** K, old: false, interrupted: breakAfter(a.x, { breaks, today }), label: label(a.km, a.sec, p),
    });
  }

  // Resultados de carrera de tu contexto (regla 1b)
  for (const r of results) {
    const p = pace(r.sec, r.km);
    if (!plausibleRunPace(p)) {
      suspect.push({ source: 'context', sessionId: null, entryId: r.id, date: r.date, km: r.km, sec: r.sec, pace: p, why: p < MIN_PACE ? 'fast' : 'slow', label: `${kmTxt(r.km)} en ${timeTxt(r.sec)}` });
      continue;
    }
    const same = valid.find((e) => e.source === 'run' && matchesRun(r, e));
    if (same) {
      duplicates.push({ entryId: r.id, sessionId: same.sessionId, label: `${kmTxt(r.km)} en ${timeTxt(r.sec)}`, when: r.precision === 'day' ? dayTxt(r.date) : r.when, runWhen: same.when });
      continue;
    }
    if (r.km + EPS < CONTEXT_MIN_KM) { contextExcluded.short++; continue; }
    addVolume(r.km, r.sec, r.date, null, r.id);
    const recent = r.date >= from;
    const e = {
      source: 'context', sessionId: null, entryId: r.id, date: r.date, when: r.precision === 'day' ? dayTxt(r.date) : r.when,
      precision: r.precision, whenLong: r.precision === 'day' ? fmtDate(r.date, 'full') : approxLabel(r.entry.date), name: r.name || '',
      effort: r.effort, surface: r.surface, elevationM: r.elevationM, km: r.km, sec: r.sec, pace: p, age: diffDays(r.date, today), score: r.sec / r.km ** K,
      old: !recent, interrupted: breakAfter(r.date, { breaks, dates, today, gaps: !recent }), label: label(r.km, r.sec, p),
    };
    (recent ? valid : history).push(e);
  }
  const contextUsed = valid.filter((e) => e.source === 'context').length + history.length;
  suspect.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  valid.sort((x, y) => x.score - y.score || (x.date < y.date ? 1 : x.date > y.date ? -1 : 0) || String(x.sessionId ?? x.entryId).localeCompare(String(y.sessionId ?? y.entryId)));
  history.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  return {
    today, from, volumeFrom, runs: runs.length, valid, basis: valid.slice(0, TOP_N), history, duplicates, excluded,
    contextExcluded, contextUsed, suspect, breaks, weeklyKm: volumeKm / VOLUME_WEEKS, volumeKm, volumeRuns, longest,
    longestRecentKm: longest ? longest.km : 0, records: enduranceRecords(d).run,
  };
}

// ===========================================================================
// Predicción de una distancia
// ===========================================================================

/**
 * Predicción para `km` con la base de `ctx` (analyzeRuns; necesita ≥ 1 esfuerzo en ctx.basis).
 * `race` = definición estándar (RACES) o null (otra distancia).
 * @returns {{ id, km, label, phrase, noun, profile, k, adjusted, volume, efforts, midExact, lowExact, highExact, spread,
 *   margin, step, low, mid, high, pace, paceLow, paceHigh, confidence, confidenceLabel, confidenceReasons,
 *   confidenceCodes, status, usable, tentativeWhy:('history'|'volume')[], recentCount, oldShare, duplicates,
 *   advice:{note, improve}, record, why:{rule, data} }}
 *  mid = la estimación actual (media ponderada, regla 3); low–high = el rango (mejor estimación – más prudente).
 *  efforts: la base y, aparte (old: true), hasta HISTORY_TOP referencias históricas; cada uno con wRecency, wDistance,
 *  wBreak, weight y share. confidenceCodes (en el orden de confidenceReasons): 'few' | 'far' | 'spread' | 'weekly' |
 *  'long' | 'old' | 'break' | 'history' | 'tentative' | 'incoherent' | 'beyond' | 'short'.
 */
export function predictDistance(ctx, km, race = raceFor(km)) {
  const D = race ? race.km : km;
  const profile = race ? race.profile : volumeProfile(D);
  const volume = profile ? volumeAdjust(profile, ctx.weeklyKm, ctx.longestRecentKm) : null;
  const k = volume ? volume.k : K;
  const weigh = (e) => {
    const wRecency = recencyWeight(e.age);
    const wDistance = distanceWeight(e.km, D);
    const wBreak = e.interrupted ? BREAK_FACTOR : 1;
    return { ...e, pred: riegel(e.sec, e.km, D, k), wRecency, wDistance, wBreak, weight: wRecency * wDistance * wBreak };
  };
  // La base (carreras recientes) y, aparte, las referencias históricas de más peso para ESTA distancia (regla 1b)
  const recent = ctx.basis.map(weigh);
  const old = (ctx.history || []).map(weigh).sort((a, b) => b.weight - a.weight || (a.date < b.date ? 1 : -1)).slice(0, HISTORY_TOP);
  const efforts = [...recent, ...old];
  const W = efforts.reduce((t, e) => t + e.weight, 0);
  for (const e of efforts) e.share = W > 0 ? e.weight / W : 0;
  let top = null;
  for (const e of efforts) if (!top || e.share > top.share + EPS) top = e;
  for (const e of efforts) e.top = e === top && efforts.length > 1;
  const midExact = efforts.reduce((t, e) => t + e.weight * e.pred, 0) / W;
  const variance = efforts.reduce((t, e) => t + e.weight * (e.pred - midExact) ** 2, 0) / W;
  const spread = Math.sqrt(variance) / midExact;
  // Con esfuerzos que se contradicen (dispersión > ±25 %) la predicción no es útil; el tope del margen solo evita
  // que el rango salga negativo (con dispersión ≥ 100 %, previsto × (1 − margen) < 0).
  const coherent = spread <= MAX_SPREAD + EPS;
  const margin = Math.max(MIN_MARGIN, Math.min(spread, MAX_SPREAD));
  const lowExact = midExact * (1 - margin);
  const highExact = midExact * (1 + margin);
  const step = stepFor(D);
  const low = Math.floor(lowExact / step + EPS) * step;
  const high = Math.ceil(highExact / step - EPS) * step;
  const mid = Math.round(midExact / step) * step;
  const noun = race ? race.noun : kmTxt(D);

  // Confianza
  const reasons = [];
  const codes = [];
  const why = (code, text) => { codes.push(code); reasons.push(text); };
  // Con menos de 2 carreras recientes la estimación se apoya en tus marcas anteriores: lo dice 'history' (más abajo)
  const tentativeHistory = recent.length < MIN_VALID;
  if (!old.length && recent.length < TOP_N && !tentativeHistory) why('few', `solo ${recent.length} esfuerzos válidos (lo ideal son ${TOP_N})`);
  else if (old.length && recent.length < TOP_N && !tentativeHistory) why('few', `solo ${recent.length} carreras recientes válidas (lo ideal son ${TOP_N})`);
  const near = efforts.some((e) => e.km * NEAR_FACTOR >= D - EPS && e.km <= D * NEAR_FACTOR + EPS);
  if (!near) why('far', `ningún esfuerzo entre ${kmTxt(D / NEAR_FACTOR)} y ${kmTxt(D * NEAR_FACTOR)}: la extrapolación es larga`);
  if (spread > SPREAD_WARN + EPS) why('spread', `tus esfuerzos no coinciden entre sí (dispersión ±${pctTxt(spread)})`);
  if (volume && !volume.weeklyOk) why('weekly', `${fmtNum(volume.weeklyKm, 1)} km/sem de media, por debajo de ${volume.weeklyTarget}`);
  if (volume && !volume.longOk) why('long', `tirada más larga de ${kmTxt(volume.longKm)}, por debajo de ${volume.longTarget} km`);
  const oldShare = old.reduce((t, e) => t + e.share, 0);
  if (old.length && oldShare > OLD_SHARE_WARN + EPS && !tentativeHistory) why('old', `el ${fmtNum(oldShare * 100, 0)} % de la estimación sale de marcas de hace más de ${WINDOW_WEEKS} semanas`);
  const latest = efforts.reduce((m, e) => (!m || e.date > m.date ? e : m), null);
  if (latest?.interrupted) why('break', `después de tu carrera más reciente (${latest.when}) hubo un parón: ${latest.interrupted.label}`);
  let level = Math.max(0, CONFIDENCE_LEVELS.length - 1 - reasons.length);
  const tentativeVolume = !!volume && volume.short >= TENTATIVE_SHORT - EPS;
  const tentative = tentativeVolume || tentativeHistory;
  if (!coherent) {
    level = 0;
    why('incoherent', `con una dispersión de más de ±${fmtNum(MAX_SPREAD * 100, 0)} % la predicción no es útil`);
  } else if (tentative) {
    level = 0;
    if (tentativeHistory) why('history', `${recent.length ? 'solo 1 carrera reciente' : 'sin carreras recientes'}${old.length ? ': la estimación se apoya en tus marcas anteriores' : ''}; predicción todavía poco fiable`);
    if (tentativeVolume) why('tentative', `falta más de la mitad del volumen de referencia para ${noun}: predicción todavía poco fiable`);
  }
  if (D > MARATHON_KM + 0.01) {
    level = 0;
    why('beyond', 'más allá del maratón la fórmula de Riegel es poco fiable');
  } else if (D < SHORT_LIMIT_KM - EPS) {
    level = 0;
    why('short', `por debajo de ${fmtNum(SHORT_LIMIT_KM, 1)} km la fórmula de Riegel es poco fiable`);
  }
  const confidence = CONFIDENCE_LEVELS[level];
  const finite = [midExact, lowExact, highExact, low, mid, high].every((v) => Number.isFinite(v) && v > 0) && low <= mid && mid <= high;
  const status = !finite ? 'invalid' : !coherent ? 'incoherent' : tentative ? 'tentative' : 'ok';

  const rec = race ? ctx.records?.best?.[race.id] ?? null : null;
  const record = rec ? { timeSec: rec.timeSec, date: rec.date, when: rec.when, origin: rec.origin, source: rec.source, estimated: !!rec.estimated, fromKm: rec.fromKm, sessionId: rec.sessionId, entryId: rec.entryId } : null;
  const p = {
    id: race ? race.id : 'custom', km: D, label: race ? race.label : kmTxt(D), phrase: race ? race.phrase : `en ${kmTxt(D)}`,
    noun, profile, k, adjusted: !!volume && volume.short > EPS, volume, efforts, midExact,
    lowExact, highExact, spread, margin, step, low, mid, high, pace: mid / D, paceLow: low / D, paceHigh: high / D,
    confidence, confidenceLabel: CONFIDENCE_LABEL[confidence], confidenceReasons: reasons, confidenceCodes: codes,
    status, usable: status === 'ok' || status === 'tentative', tentativeWhy: [tentativeHistory ? 'history' : null, tentativeVolume ? 'volume' : null].filter(Boolean),
    recentCount: recent.length, oldShare, duplicates: ctx.duplicates || [], record,
  };
  p.advice = predictionAdvice(p);
  p.why = predictionWhy(ctx, p);
  return p;
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const runWord = (n) => (n === 1 ? 'carrera válida reciente' : 'carreras válidas recientes');

/** «10 km en 1:00:00 (may 2026)» de una referencia. */
const refTxt = (e) => `${kmTxt(e.km)} en ${timeTxt(e.sec)} (${e.when})`;
/** Por qué pesa menos una referencia: «es de hace 5 meses y después hubo «Parón…» (jun 2026)». '' si no. */
function lessWeight(e) {
  const bits = [];
  if (e.old) bits.push(`es de ${ageTxt(e.age)}`);
  if (e.interrupted) bits.push(`después hubo ${e.interrupted.label}`);
  return bits.join(' y ');
}

/**
 * Aviso corto para la tarjeta (note) y qué dato mejoraría la predicción (improve). Sin aviso con confianza alta.
 * Prioridad: estado (incoherent, tentative por pocas carreras recientes o por volumen) → volumen → parón → distancia
 * lejana → pocos esfuerzos → marcas antiguas → dispersión → límites.
 */
export function predictionAdvice(p) {
  const v = p.volume;
  const has = (c) => p.confidenceCodes.includes(c);
  const volRef = v ? `${v.weeklyTarget} km por semana y a una tirada de ${v.longTarget} km` : '';
  const volNow = v ? `ahora ${fmtNum(v.weeklyKm, 1)} km/sem y una tirada de ${kmTxt(v.longKm)}` : '';
  const olds = p.efforts.filter((e) => e.old);
  const moreRuns = `Registra carreras recientes de ${MIN_KM} km o más: pesan más que tus marcas anteriores.`;
  if (p.status === 'invalid') return { note: 'Datos insuficientes para esta distancia.', improve: 'Registra carreras de 3 km o más con su distancia y su tiempo en movimiento.' };
  if (p.status === 'incoherent') {
    return {
      note: `Tus carreras recientes no coinciden entre sí (±${pctTxt(p.spread)}): puede que alguna tenga mal apuntado el tiempo o la distancia.`,
      improve: 'Revisa las carreras de «Con qué se calcula»; con datos coherentes vuelve la estimación.',
    };
  }
  if (p.status === 'tentative' && p.tentativeWhy.includes('history')) {
    // «Tu historial importa, pero tu estado reciente importa más»
    if (olds.length) {
      const main = olds.reduce((m, e) => (e.share > m.share ? e : m), olds[0]);
      const why = lessWeight(main);
      return {
        note: `Tienes pocos datos recientes. Tu referencia es ${refTxt(main)}${why ? `, pero ${why}` : ''}, así que sirve como orientación, no como predicción de hoy.`,
        improve: moreRuns,
      };
    }
    return { note: 'Solo tienes una carrera reciente: tómalo como orientación hasta que registres más.', improve: moreRuns };
  }
  if (p.status === 'tentative') {
    return {
      note: `Tu volumen actual todavía es demasiado bajo para estimar ${p.noun} con precisión.`,
      improve: `Acercarte a ${volRef} (${volNow}).`,
    };
  }
  if (p.confidence === 'alta') return { note: null, improve: null };
  const n = p.recentCount;
  if (has('weekly') || has('long')) {
    return { note: `Más prudente por volumen: ${volNow}, por debajo de la referencia.`, improve: `Acercarte a ${volRef}.` };
  }
  if (has('break')) {
    const latest = p.efforts.reduce((m, e) => (!m || e.date > m.date ? e : m), null);
    return { note: `Después de tu carrera más reciente hubo un parón (${latest.interrupted.label}): tu forma de hoy puede ser otra.`, improve: `Una carrera de ${MIN_KM} km o más ahora pondrá la estimación al día.` };
  }
  if (has('far')) {
    const shorter = p.efforts.every((e) => e.km * NEAR_FACTOR < p.km - EPS);
    const ref = shorter ? `de ${fmtNum(Math.ceil(p.km / NEAR_FACTOR), 0)} km o más` : `de ${fmtNum(Math.floor(p.km * NEAR_FACTOR), 0)} km o menos`;
    return {
      note: `Ninguna carrera reciente se parece a ${p.noun}: es una extrapolación larga, tómalo como orientación.`,
      improve: `Una carrera ${ref} la haría más fiable.`,
    };
  }
  if (has('few')) {
    return {
      note: `Solo tienes ${n} ${runWord(n)}, así que este rango es orientativo. La precisión mejorará cuando registres más.`,
      improve: `Registra otra carrera de ${MIN_KM} km o más, con su tiempo en movimiento (lo ideal son ${TOP_N}).`,
    };
  }
  if (has('old')) {
    return { note: `Una parte de la estimación (${fmtNum(p.oldShare * 100, 0)} %) sale de marcas de hace más de ${WINDOW_WEEKS} semanas.`, improve: moreRuns };
  }
  if (has('spread')) {
    return {
      note: `Tus carreras recientes no coinciden del todo entre sí (±${pctTxt(p.spread)}), por eso el rango es amplio.`,
      improve: 'Más carreras a un esfuerzo parecido estrechan el rango.',
    };
  }
  if (has('beyond') || has('short')) return { note: `${cap(p.confidenceReasons[p.confidenceCodes.indexOf(has('beyond') ? 'beyond' : 'short')])}.`, improve: null };
  return { note: null, improve: null };
}

function predictionWhy(ctx, p) {
  const n = p.efforts.length;
  const nOld = p.efforts.filter((e) => e.old).length;
  const parts = [
    `Fórmula de Riegel: T₂ = T₁ × (D₂ / D₁)^k, con k = ${kTxt(K)}.`,
    `Se aplica a tus ${p.recentCount} mejores esfuerzos (carreras de ${MIN_KM} km o más de las últimas ${WINDOW_WEEKS} semanas, cada una con su tiempo en movimiento; el senderismo y otros deportes no cuentan, ni las de ritmo imposible: más rápido de ${paceTxt(MIN_PACE)} o más lento de ${paceTxt(MAX_PACE)})${nOld ? ` y a ${nOld === 1 ? 'una referencia histórica' : `${nOld} referencias históricas`} de tu contexto` : ''}.`,
    `Cada esfuerzo pesa más cuanto más reciente es (1 − días / ${RECENCY_DAYS}) y cuanto más se parece su distancia a ${p.noun} (√(menor / mayor)).`,
    `Estimación actual (el número grande): la media ponderada de lo que predice cada esfuerzo. Rango probable: ± la dispersión de esas predicciones (desviación típica ponderada, aquí ±${pctTxt(p.spread)}), con un mínimo de ±${fmtNum(MIN_MARGIN * 100, 0)} %, redondeado a ${p.step} s; de la mejor estimación a la más prudente.`,
    `Si la dispersión pasa de ±${fmtNum(MAX_SPREAD * 100, 0)} %, tus carreras se contradicen y no se da una predicción.`,
  ];
  const anyContext = (ctx.contextUsed || 0) > 0 || (ctx.duplicates || []).length > 0;
  if (anyContext) {
    parts.push(`Tus resultados de carrera de «Tu contexto» también cuentan: los de las últimas ${WINDOW_WEEKS} semanas, como una carrera más; los anteriores, como referencia histórica (como mucho ${HISTORY_TOP} por distancia), con un peso que sigue bajando con la antigüedad (a las ${WINDOW_WEEKS} semanas pesa la mitad que hoy y luego se reduce a la mitad cada 8 semanas, sin llegar a 0). Si un resultado es la misma carrera que una registrada, cuenta solo una vez. Tu historial importa, pero tu estado reciente importa más.`);
  }
  if (anyContext || (ctx.breaks || []).length) {
    parts.push(`Lo anterior a un parón apuntado en tu contexto (parón, vuelta tras vacaciones, enfermedad, lesión o vacaciones) pesa la mitad; en una referencia histórica, también si después hubo ${RUN_GAP_DAYS / 7} semanas o más sin correr.`);
  }
  if (p.volume) {
    const v = p.volume;
    parts.push(`Volumen (${VOLUME[v.profile].label}): con menos de ${v.weeklyTarget} km por semana (media de las últimas ${VOLUME_WEEKS} semanas) o una tirada de menos de ${v.longTarget} km, k sube de ${kTxt(K)} hacia ${kTxt(K_MAX)} según lo que más falte (el tiempo previsto sale más lento) y la confianza baja un nivel por cada criterio que no se cumple. Si falta más de la mitad de alguno, la predicción es todavía poco fiable (confianza baja).`);
    if (v.short > EPS) {
      const miss = [];
      if (!v.weeklyOk) miss.push(`a los km semanales les falta un ${pctTxt(v.weeklyShort)}`);
      if (!v.longOk) miss.push(`a la tirada le falta un ${pctTxt(v.longShort)}`);
      parts.push(`Con ${fmtNum(v.weeklyKm, 1)} km/sem y una tirada de ${kmTxt(v.longKm)}, ${miss.join(' y ')} → k = ${kTxt(p.k)}.`);
    } else {
      parts.push(`Con ${fmtNum(v.weeklyKm, 1)} km/sem y una tirada de ${kmTxt(v.longKm)} se cumplen los dos: k = ${kTxt(K)}.`);
    }
  }
  parts.push(`Confianza: parte de alta y baja un nivel con solo ${MIN_VALID} esfuerzos, si ninguno está entre ${kmTxt(p.km / NEAR_FACTOR)} y ${kmTxt(p.km * NEAR_FACTOR)} o si la dispersión pasa de ±${fmtNum(SPREAD_WARN * 100, 0)} %${p.volume ? ', y otro por cada criterio de volumen que falte' : ''}.`);
  parts.push('Es una estimación, no una promesa: el recorrido, el calor, el descanso y cómo repartas el esfuerzo cuentan. Si tus carreras fueron suaves, sale conservadora.');

  const data = p.efforts.map((e) => ({
    label: `${e.when} · ${e.label}${e.old ? ' · referencia histórica' : e.source === 'context' ? ' · de tu contexto' : ''}`,
    value: `→ ${timeTxt(e.pred)} · pesa un ${fmtNum(e.share * 100, 0)} %${e.top ? ' (la que más)' : ''}`,
  }));
  for (const e of p.efforts.filter((x) => x.old || x.interrupted)) {
    data.push({ label: `Por qué pesa menos (${kmTxt(e.km)}, ${e.when})`, value: `${cap(lessWeight(e))}.` });
  }
  for (const x of p.duplicates) {
    data.push({ label: 'No se cuenta dos veces', value: `${x.label} (${x.when}, de tu contexto) es la misma carrera que la registrada el ${x.runWhen}: cuenta la registrada.` });
  }
  if (p.usable) {
    data.push({ label: 'Estimación actual (media ponderada)', value: `${timeTxt(p.mid)} · ${paceTxt(p.pace)}` });
  }
  data.push({
    label: 'Dispersión de las predicciones',
    value: p.spread + EPS >= MIN_MARGIN ? `±${pctTxt(p.spread)}` : `±${pctTxt(p.spread)} → se usa el mínimo, ±${fmtNum(MIN_MARGIN * 100, 0)} %`,
  });
  data.push({ label: 'Rango probable', value: p.usable ? `${rangeText(p)} (${paceRangeText(p)})` : 'no se da: las predicciones se contradicen' });
  data.push({ label: `Km por semana (media de ${VOLUME_WEEKS} semanas)`, value: `${fmtNum(ctx.weeklyKm, 1)} km${p.volume ? ` · referencia ${p.volume.weeklyTarget} km` : ''}` });
  data.push({
    label: `Tirada más larga (${VOLUME_WEEKS} semanas)`,
    value: ctx.longest ? `${kmTxt(ctx.longest.km)} · ${dayTxt(ctx.longest.date)}${p.volume ? ` · referencia ${p.volume.longTarget} km` : ''}` : 'ninguna',
  });
  data.push({ label: 'k usado', value: kTxt(p.k) });
  data.push({
    label: 'Confianza',
    value: `${p.confidenceLabel} — ${p.confidenceReasons.length ? p.confidenceReasons.join('; ') : `${n} esfuerzos de distancia parecida y coherentes entre sí${p.volume ? ', con volumen suficiente' : ''}`}`,
  });
  if (p.advice.improve) data.push({ label: 'Para mejorarla', value: p.advice.improve });
  if (p.record) {
    const r = p.record;
    data.push({
      // Récord personal (la mejor de siempre, su antigüedad no le quita valor) ≠ estimación de hoy
      label: `Tu récord en ${p.noun.replace(/^(los|la|el) /, '')} (la mejor de siempre)`,
      value: `${timeTxt(r.timeSec)} · ${r.when || fmtDate(r.date, 'full')}${r.origin ? ` · ${r.origin.toLowerCase()}` : ''}${r.estimated ? ` (a ritmo medio de una carrera de ${kmTxt(r.fromKm)})` : ''}`,
    });
  }
  return { rule: parts.join(' '), data };
}

// ===========================================================================
// API
// ===========================================================================

function insufficient(ctx) {
  const n = ctx.valid.length;
  const ex = ctx.excluded;
  const notes = [];
  if (ex.short) notes.push(`${runsTxt(ex.short)} de menos de ${MIN_KM} km`);
  if (ex.old) notes.push(`${runsTxt(ex.old)} de hace más de ${WINDOW_WEEKS} semanas`);
  if (ex.implausible) notes.push(`${runsTxt(ex.implausible)} con un ritmo imposible (más rápido de ${paceTxt(MIN_PACE)})`);
  if (ex.slow) notes.push(`${runsTxt(ex.slow)} con un ritmo más lento de ${paceTxt(MAX_PACE)} (¿un tiempo mal apuntado?)`);
  const cs = ctx.contextExcluded?.short || 0;
  if (cs) notes.push(`${cs} ${cs === 1 ? 'resultado' : 'resultados'} de tu contexto de menos de ${CONTEXT_MIN_KM} km`);
  const cSus = (ctx.suspect || []).filter((x) => x.source === 'context').length;
  if (cSus) notes.push(`${cSus} ${cSus === 1 ? 'resultado' : 'resultados'} de tu contexto con un ritmo imposible`);
  let message;
  if (!ctx.runs) message = 'Aún no hay carreras con distancia y tiempo.';
  else if (!n) message = `Ninguna carrera cuenta todavía: hacen falta al menos ${MIN_VALID} de ${MIN_KM} km o más en las últimas ${WINDOW_WEEKS} semanas.`;
  else message = `Solo hay 1 carrera válida (${MIN_KM} km o más en las últimas ${WINDOW_WEEKS} semanas); hacen falta al menos ${MIN_VALID}.`;
  const notCounted = notes.length ? `No cuentan: ${notes.join(', ')}.` : null;
  if (notCounted) message += ` ${notCounted}`;
  const data = ctx.valid.map((e) => ({ label: e.when, value: e.label }));
  data.push({ label: 'Carreras válidas', value: `${n} de ${MIN_VALID} necesarias` });
  if (ex.short) data.push({ label: `De menos de ${MIN_KM} km`, value: String(ex.short) });
  if (ex.old) data.push({ label: `De hace más de ${WINDOW_WEEKS} semanas`, value: String(ex.old) });
  if (ex.implausible) data.push({ label: 'Con ritmo imposible', value: String(ex.implausible) });
  if (ex.slow) data.push({ label: `Más lentas de ${paceTxt(MAX_PACE)}`, value: String(ex.slow) });
  return {
    ok: false, reason: INSUFFICIENT, message, notCounted, today: ctx.today, from: ctx.from, valid: n, needed: MIN_VALID,
    excluded: { ...ex }, suspect: ctx.suspect, efforts: ctx.valid, basis: ctx.basis, history: ctx.history,
    duplicates: ctx.duplicates, weeklyKm: ctx.weeklyKm, longestRecentKm: ctx.longestRecentKm, longest: ctx.longest, predictions: {},
    why: {
      rule: `Para estimar tiempos hacen falta al menos ${MIN_VALID} carreras de ${MIN_KM} km o más en las últimas ${WINDOW_WEEKS} semanas (desde el ${fmtDate(ctx.from, 'full')}), con distancia y tiempo, o un resultado de carrera apuntado en «Tu contexto» (aunque sea antiguo: cuenta como referencia, con menos peso). Cada carrera cuenta con su tiempo en movimiento; se usan las ${TOP_N} mejores con la fórmula de Riegel (k = ${kTxt(K)}). El senderismo y otros deportes no cuentan, ni las carreras de ritmo imposible (más rápido de ${paceTxt(MIN_PACE)} o más lento de ${paceTxt(MAX_PACE)}).`,
      data,
    },
  };
}

/** Referencias históricas que se listan en el informe, como mucho. */
export const REPORT_HISTORY_MAX = 3;

/**
 * Lo que usa la predicción ACTUAL (para el informe para tu IA; aquí la recencia sí importa, a diferencia de los
 * récords): las carreras recientes de la base y las referencias históricas más recientes (como mucho
 * REPORT_HISTORY_MAX), de lo más reciente a lo más antiguo, y el tiempo previsto hoy en cada distancia.
 * @returns {{ refs:[{ source:'run'|'context', sessionId, entryId, km, sec, when, whenLong, age, ageText, old,
 *   interrupted, effort, surface, elevationM }], predictions:[{ id, label, km, mid, midExact, low, high, status, usable,
 *   confidence, confidenceCodes, method }], duplicates,
 *   historyTotal }}
 */
export function runningSummary(data, opts = {}) {
  const ctx = analyzeRuns(data, opts);
  const refs = [...ctx.basis, ...ctx.history.slice(0, REPORT_HISTORY_MAX)]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((e) => ({
      source: e.source, sessionId: e.sessionId, entryId: e.entryId, km: e.km, sec: e.sec, when: e.when,
      whenLong: e.whenLong || fmtDate(e.date, 'full'), age: e.age, ageText: ageTxt(e.age), old: e.old,
      interrupted: e.interrupted ? e.interrupted.label : null, effort: e.effort ?? null, surface: e.surface ?? null,
      elevationM: e.elevationM ?? null,
    }));
  const predictions = canPredict(ctx)
    ? RACES.map((r) => {
      const p = predictDistance(ctx, r.km, r);
      // El mismo trío (previsto, rango, confianza) que enseñan las pantallas
      return {
        id: r.id, label: r.label, km: r.km, mid: p.usable ? p.mid : null, midExact: p.usable ? p.midExact : null,
        low: p.usable ? p.low : null, high: p.usable ? p.high : null, status: p.status, usable: p.usable,
        confidence: p.confidence, confidenceCodes: p.confidenceCodes, method: METHOD,
      };
    })
    : [];
  return { refs, predictions, duplicates: ctx.duplicates, historyTotal: ctx.history.length };
}

/**
 * Tiempos previstos para 5 km, 10 km, media maratón y maratón.
 * @param {object} data  entrada común de stats.js (data.today = «hoy»)
 * @param {{today?:string}} [opts]  «hoy» inyectable (manda sobre data.today)
 * @returns {{ ok:true, today, from, valid, excluded, suspect, efforts, basis, history, duplicates, weeklyKm,
 *   longestRecentKm, longest, predictions:{ '5k'|'10k'|'half'|'marathon': Prediction } }
 *   | { ok:false, reason:'datos insuficientes', message, notCounted (qué carreras no cuentan)|null, valid, needed,
 *       excluded, suspect, efforts, basis, weeklyKm,
 *       longestRecentKm, longest, predictions:{}, why:{rule, data} }}
 *  Prediction: ver predictDistance (low, mid, high en segundos; confidence 'alta'|'media'|'baja'; status; advice;
 *  why {rule, data}). suspect: carreras que no cuentan por un ritmo imposible (para revisarlas).
 */
export function predictRaces(data, opts = {}) {
  const ctx = analyzeRuns(data, opts);
  if (!canPredict(ctx)) return insufficient(ctx);
  const predictions = {};
  for (const r of RACES) predictions[r.id] = predictDistance(ctx, r.km, r);
  return {
    ok: true, today: ctx.today, from: ctx.from, valid: ctx.valid.length, excluded: { ...ctx.excluded }, suspect: ctx.suspect,
    efforts: ctx.valid, basis: ctx.basis, history: ctx.history, duplicates: ctx.duplicates, weeklyKm: ctx.weeklyKm,
    longestRecentKm: ctx.longestRecentKm, longest: ctx.longest, predictions,
  };
}

/**
 * ¿Puedo hacer `targetSec` en `distanceKm`? Misma predicción que la tabla (o la de esa distancia si es otra).
 * @param {{today?:string}} [opts]  «hoy» inyectable (manda sobre data.today)
 * @returns {{ verdict:'probable'|'ajustado'|'hoy_no'|'insuficiente', label, text, reason?, distanceKm, distanceLabel,
 *   targetSec, prediction:Prediction|null, gapSec:number|null, gapPerKmSec:number|null, rangeGapSec:number|null,
 *   why:{rule, data} }}
 *  gapSec = previsto − objetivo: > 0, lo que falta (habría que ir más rápido que lo previsto); ≤ 0, margen.
 *  rangeGapSec: en 'hoy_no', lo que falta incluso frente al extremo rápido del rango (low − objetivo); en
 *  'probable', el margen sobre el extremo lento (objetivo − high); si no, 0.
 */
export function checkTarget(data, distanceKm, targetSec, opts = {}) {
  const D = Number(distanceKm);
  const T = Number(targetSec);
  const base = { distanceKm: D, targetSec: T, prediction: null, gapSec: null, gapPerKmSec: null, rangeGapSec: null };
  if (!(D > 0) || !(T > 0) || !Number.isFinite(D) || !Number.isFinite(T)) {
    return {
      ...base, verdict: 'insuficiente', reason: 'input', label: VERDICT_LABEL.insuficiente, distanceLabel: D > 0 ? kmTxt(D) : '—',
      text: 'Indica una distancia y un tiempo objetivo.',
      why: { rule: 'Hace falta una distancia (km) y un tiempo objetivo mayores que cero.', data: [] },
    };
  }
  const race = raceFor(D);
  const distanceLabel = race ? race.label : kmTxt(D);
  const r = predictFor(data, D, opts);
  if (!r.ok) return { ...base, verdict: 'insuficiente', reason: INSUFFICIENT, label: VERDICT_LABEL.insuficiente, distanceLabel, text: r.message, why: r.why };
  const p = r.prediction;
  if (!p.usable) {
    // Sin predicción útil (esfuerzos que se contradicen): no se compara con números que no significan nada.
    return {
      ...base, verdict: 'insuficiente', reason: p.status, label: VERDICT_LABEL.insuficiente, distanceLabel,
      text: `No hay una previsión útil para ${p.noun}. ${p.advice.note}`,
      why: { rule: `Para comparar un objetivo hace falta una predicción útil. ${p.why.rule}`, data: p.why.data },
    };
  }
  const gap = p.mid - T;
  const perKm = gap / p.km;
  const verdict = T >= p.high ? 'probable' : T >= p.low ? 'ajustado' : 'hoy_no';
  const rangeGap = verdict === 'hoy_no' ? p.low - T : verdict === 'probable' ? T - p.high : 0;
  const tTxt = timeTxt(T);
  const range = rangeText(p);
  const midTxt = timeTxt(p.mid);
  let text;
  if (verdict === 'probable') {
    const where = T === p.high ? 'coincide con el extremo lento del' : 'es más lento que todo el';
    text = `Tu objetivo (${tTxt}) ${where} rango previsto (${range}): con tu forma actual es un tiempo a tu alcance, con unos ${fmtGap(gap)} de margen sobre tu tiempo previsto (${midTxt}), ≈ ${fmtGapPerKm(perKm)}.`;
  } else if (verdict === 'ajustado') {
    if (Math.abs(gap) < 2.5) text = `Tu objetivo (${tTxt}) coincide con tu tiempo previsto, dentro del rango (${range}): es posible, pero sin margen; dependerá del día y de cómo repartas el esfuerzo.`;
    else if (gap > 0) text = `Tu objetivo (${tTxt}) cae dentro del rango previsto (${range}): es posible, pero justo; te pide unos ${fmtGap(gap)} menos que tu tiempo previsto (${midTxt}), ≈ ${fmtGapPerKm(perKm)} más rápido.`;
    else text = `Tu objetivo (${tTxt}) cae dentro del rango previsto (${range}): es posible, con poco margen (unos ${fmtGap(gap)} sobre tu tiempo previsto, ${midTxt}); dependerá del día.`;
  } else {
    text = `Tu objetivo (${tTxt}) es más rápido que todo el rango previsto (${range}): hoy te faltarían unos ${fmtGap(gap)} ${p.phrase} respecto a tu tiempo previsto (${midTxt}), ≈ ${fmtGapPerKm(perKm)}. Con entrenamiento puede llegar; vuelve a comprobarlo cuando registres carreras más rápidas.`;
  }
  if (p.confidence === 'baja') text += ` Ojo: la confianza de esta estimación es baja. ${p.advice.note || `${cap(p.confidenceReasons[0])}.`} Tómalo solo como orientación.`;

  const rule = `Se compara tu objetivo con el rango previsto para ${p.noun} (la misma estimación que la tabla): igual o más lento que el extremo lento del rango (${timeTxt(p.high)}) → probable; dentro del rango (${range}) → ajustado; más rápido que el extremo rápido (${timeTxt(p.low)}) → hoy no. La diferencia se mide frente al tiempo previsto (${midTxt}). ${p.why.rule}`;
  const whyData = [
    { label: 'Objetivo', value: `${tTxt} · ${paceTxt(T / p.km)}` },
    { label: 'Tiempo previsto', value: `${midTxt} · ${paceTxt(p.pace)}` },
    { label: 'Rango previsto', value: `${range} (${paceRangeText(p)})` },
    {
      label: 'Diferencia',
      value: Math.abs(gap) < 2.5 ? 'ninguna' : gap > 0 ? `faltan ${fmtGap(gap)} (≈ ${fmtGapPerKm(perKm)})` : `${fmtGap(gap)} de margen (≈ ${fmtGapPerKm(perKm)})`,
    },
    ...p.why.data,
  ];
  return {
    ...base, verdict, label: VERDICT_LABEL[verdict], distanceLabel, text, prediction: p, gapSec: gap, gapPerKmSec: perKm,
    rangeGapSec: rangeGap, why: { rule, data: whyData },
  };
}

// ===========================================================================
// Entradas únicas para el resto de la app (ronda 8, B1: un solo motor de predicción de carrera)
// ===========================================================================
// Tiempos previstos, Objetivos (carrera con tiempo), Eventos, Análisis y el informe consumen ESTAS funciones: nadie
// más calcula un tiempo de carrera con calc.riegel. Son envoltorios finos: no hay matemáticas nuevas.

/** Identifica el método en cada resultado base (baseOf) y en las pruebas cruzadas. */
export const METHOD = 'riegel-ponderado';

/**
 * Predicción de UNA distancia «a fecha de hoy» (o de opts.today).
 * @returns {{ ok:true, today, prediction:Prediction } | { ok:false, reason:'datos insuficientes', message, notCounted,
 *   why, … }}  prediction = predictDistance(...) (puede no ser útil: status incoherent/invalid → mira `.usable`);
 *   ok:false = insufficient(ctx), lo mismo que predictRaces sin datos.
 */
export function predictFor(data, km, opts = {}) {
  const ctx = analyzeRuns(data, opts);
  if (!canPredict(ctx)) return insufficient(ctx);
  const D = Number(km);
  return { ok: true, today: ctx.today, prediction: predictDistance(ctx, D, raceFor(D)) };
}

/**
 * Resultado base canónico de una predicción: lo que toda pantalla enseña (previsto, rango, confianza, referencias,
 * método) y lo que comparan las pruebas cruzadas. null sin predicción.
 */
export function baseOf(p) {
  if (!p) return null;
  return {
    method: METHOD, id: p.id, km: p.km, mid: p.mid, low: p.low, high: p.high, pace: p.pace, paceLow: p.paceLow, paceHigh: p.paceHigh,
    midExact: p.midExact, k: p.k, confidence: p.confidence, confidenceLabel: p.confidenceLabel, confidenceCodes: [...p.confidenceCodes],
    status: p.status, usable: p.usable,
    refs: p.efforts.map((e) => ({
      source: e.source, sessionId: e.sessionId ?? null, entryId: e.entryId ?? null, date: e.date, km: e.km, sec: e.sec, share: e.share,
      old: !!e.old, interrupted: !!e.interrupted,
    })),
    note: p.advice?.note ?? null,
  };
}

/**
 * Atributos data-* de una predicción para las vistas (y las pruebas E2E que comparan pantallas): { mid, low, high,
 * confidence } en texto, solo si es útil; {} si no. Acepta una Prediction o su baseOf.
 */
export function predictionDataset(p) {
  if (!p || !p.usable) return {};
  return { mid: String(p.mid), low: String(p.low), high: String(p.high), confidence: p.confidence };
}

/**
 * Fotos del MISMO motor en fechas pasadas (tendencia y punto de partida de un objetivo): analyzeRuns con
 * { today: fecha } (memorizado) para cada una.
 * @returns {{date, ok, mid, midExact, low, high, confidence, status, usable}[]}  ok:false → mid null.
 */
export function predictionSeries(data, km, dates) {
  return (dates || []).map((date) => {
    const r = predictFor(data, km, { today: date });
    if (!r.ok) return { date, ok: false, mid: null, midExact: null, low: null, high: null, confidence: null, status: null, usable: false };
    const p = r.prediction;
    return { date, ok: true, mid: p.mid, midExact: p.midExact, low: p.low, high: p.high, confidence: p.confidence, status: p.status, usable: p.usable };
  });
}

/**
 * Predicción solo con las carreras REGISTRADAS de [from, to] (sin resultados de tu contexto ni referencias
 * históricas): la forma de un bloque en Análisis. No es la estimación de hoy (esa es predictFor).
 * @returns {Prediction & {runs}|null} runs = carreras válidas de la ventana. null con menos de MIN_VALID o si no es útil.
 */
export function predictWindow(data, km, { from, to } = {}) {
  const ctx = analyzeRuns(data, { today: to });
  const valid = ctx.valid.filter((e) => e.source === 'run' && e.date >= from);
  if (valid.length < MIN_VALID) return null;
  const D = Number(km);
  const p = predictDistance({ ...ctx, valid, basis: valid.slice(0, TOP_N), history: [], duplicates: [] }, D, raceFor(D));
  if (!p.usable) return null;
  p.runs = valid.length; // carreras válidas de la ventana (la base usa las TOP_N mejores)
  return p;
}
