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
//  - calc.js: riegel y pace.
//  - goals-logic.js: RIEGEL_K (1,06), MIN_KM.run (3 km) y fmtTimeWords, los mismos que usan los objetivos de carrera.
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
//  5b. Estado (status) de cada predicción: 'ok'; 'tentative' («todavía poco fiable»: a la media o al maratón les falta
//     más de la mitad de un umbral de volumen; la fórmula lo calcula pero no es una predicción útil; confianza «baja»);
//     'incoherent' (dispersión > ±25 %; confianza «baja»); 'invalid' (algún número no finito o ≤ 0; no debería pasar).
//     usable = 'ok' o 'tentative'. advice = { note (aviso corto para la tarjeta), improve (qué dato la mejoraría) }.
//  6. checkTarget: objetivo ≥ high → 'probable'; low ≤ objetivo < high → 'ajustado'; objetivo < low → 'hoy_no';
//     sin datos o sin predicción útil (incoherent/invalid) → 'insuficiente'. gapSec = previsto − objetivo (> 0: lo que
//     falta respecto al tiempo previsto; ≤ 0: margen). Se compara con los valores redondeados que se muestran.
//  7. Formato: tiempos con util.fmtRaceTime («29:37», «1:42:16»), ritmos con util.fmtPaceKm («5:55/km»), rangos con
//     fmtRaceRange / fmtPaceRange (siempre de menor a mayor). Nunca negativos ni «h:mm:ss /km».
// Tono: siempre estimación, nunca promesa.
import {
  addDays, diffDays, todayStr, isDateStr, fmtDate, fmtNum, fmtRaceTime, fmtPaceKm, fmtRaceRange, fmtPaceRange,
} from './util.js';
import { riegel, pace, RUN_PACE_MIN, RUN_PACE_MAX } from './calc.js';
import { runPaceSeries, enduranceRecords, RACE_DISTANCES } from './stats.js';
import { RIEGEL_K, MIN_KM as GOAL_MIN_KM, fmtTimeWords } from './goals-logic.js';

// ===========================================================================
// Constantes
// ===========================================================================

/** Exponente de Riegel (el mismo de los objetivos de carrera). */
export const K = RIEGEL_K;
/** Exponente máximo cuando el volumen se queda corto (media y maratón). */
export const K_MAX = 1.1;
/** Distancia mínima de un esfuerzo válido (km; la misma de los objetivos de carrera). */
export const MIN_KM = GOAL_MIN_KM.run;
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

/** Las 4 distancias: { id, km, label, short (chip), phrase («en la media maratón»), noun, profile }. */
export const RACES = RACE_DISTANCES.map((r) => ({
  id: r.id, km: r.km, label: r.label, short: SHORT[r.id] || r.label, phrase: PHRASE[r.id] || `en ${r.label}`,
  noun: NOUN[r.id] || r.label, profile: r.id === 'half' || r.id === 'marathon' ? r.id : null,
}));

// ===========================================================================
// Piezas de la regla (exportadas para las pruebas)
// ===========================================================================

/** Peso por recencia: 1 − días / 168 (días ≥ 0). */
export function recencyWeight(ageDays) {
  return 1 - Math.max(0, ageDays) / RECENCY_DAYS;
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

/**
 * Esfuerzos, base y volumen a partir de `data` (entrada común de stats.js).
 * @param {object} data
 * @param {{today?:string}} [opts]
 * @returns {{ today, from, volumeFrom, runs, valid:Effort[], basis:Effort[], excluded:{old, short, implausible, slow},
 *   suspect:Suspect[], weeklyKm, volumeKm, volumeRuns, longest:{km, sec, date, sessionId}|null, longestRecentKm,
 *   records }}
 *  Effort = { sessionId, date, km, sec, pace (s/km), age (días), score (T / D^1,06), label «10 km en 44:30 (4:27/km)» }
 *  excluded.implausible: más rápidas de 2:30 /km; excluded.slow: más lentas de 20:00 /km.
 *  Suspect = { sessionId, date, km, sec, pace, why:'fast'|'slow', label } (de ≥ 3 km en la ventana; para revisarlas).
 */
export function analyzeRuns(data, opts = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const today = todayOf(d, opts);
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const volumeFrom = addDays(today, -(VOLUME_DAYS - 1));
  const runs = runPaceSeries(d).filter((a) => a.x <= today && a.km > 0 && a.sec > 0);
  const excluded = { old: 0, short: 0, implausible: 0, slow: 0 };
  const suspect = [];
  const valid = [];
  let volumeKm = 0;
  let volumeRuns = 0;
  let longest = null;
  for (const a of runs) {
    if (a.x >= volumeFrom) {
      volumeKm += a.km;
      volumeRuns++;
      if (!longest || a.km > longest.km + EPS || (Math.abs(a.km - longest.km) <= EPS && a.x > longest.date)) {
        longest = { km: a.km, sec: a.sec, date: a.x, sessionId: a.sessionId };
      }
    }
    if (a.x < from) { excluded.old++; continue; }
    if (a.km + EPS < MIN_KM) { excluded.short++; continue; }
    const p = pace(a.sec, a.km);
    if (!plausibleRunPace(p)) {
      const why = p < MIN_PACE ? 'fast' : 'slow';
      excluded[why === 'fast' ? 'implausible' : 'slow']++;
      suspect.push({ sessionId: a.sessionId, date: a.x, km: a.km, sec: a.sec, pace: p, why, label: `${kmTxt(a.km)} en ${timeTxt(a.sec)}` });
      continue;
    }
    valid.push({
      sessionId: a.sessionId, date: a.x, km: a.km, sec: a.sec, pace: p, age: diffDays(a.x, today),
      score: a.sec / a.km ** K, label: `${kmTxt(a.km)} en ${timeTxt(a.sec)} (${paceTxt(p)})`,
    });
  }
  suspect.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  valid.sort((x, y) => x.score - y.score || (x.date < y.date ? 1 : x.date > y.date ? -1 : 0) || String(x.sessionId).localeCompare(String(y.sessionId)));
  return {
    today, from, volumeFrom, runs: runs.length, valid, basis: valid.slice(0, TOP_N), excluded, suspect,
    weeklyKm: volumeKm / VOLUME_WEEKS, volumeKm, volumeRuns, longest, longestRecentKm: longest ? longest.km : 0,
    records: enduranceRecords(d).run,
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
 *   confidenceCodes, status, usable, advice:{note, improve}, record, why:{rule, data} }}
 *  mid = la estimación actual (media ponderada, regla 3); low–high = el rango (mejor estimación – más prudente).
 *  confidenceCodes (en el orden de confidenceReasons): 'few' | 'far' | 'spread' | 'weekly' | 'long' | 'tentative' |
 *  'incoherent' | 'beyond' | 'short'.
 */
export function predictDistance(ctx, km, race = raceFor(km)) {
  const D = race ? race.km : km;
  const profile = race ? race.profile : volumeProfile(D);
  const volume = profile ? volumeAdjust(profile, ctx.weeklyKm, ctx.longestRecentKm) : null;
  const k = volume ? volume.k : K;
  const efforts = ctx.basis.map((e) => {
    const wRecency = recencyWeight(e.age);
    const wDistance = distanceWeight(e.km, D);
    return { ...e, pred: riegel(e.sec, e.km, D, k), wRecency, wDistance, weight: wRecency * wDistance };
  });
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
  if (efforts.length < TOP_N) why('few', `solo ${efforts.length} esfuerzos válidos (lo ideal son ${TOP_N})`);
  const near = efforts.some((e) => e.km * NEAR_FACTOR >= D - EPS && e.km <= D * NEAR_FACTOR + EPS);
  if (!near) why('far', `ningún esfuerzo entre ${kmTxt(D / NEAR_FACTOR)} y ${kmTxt(D * NEAR_FACTOR)}: la extrapolación es larga`);
  if (spread > SPREAD_WARN + EPS) why('spread', `tus esfuerzos no coinciden entre sí (dispersión ±${pctTxt(spread)})`);
  if (volume && !volume.weeklyOk) why('weekly', `${fmtNum(volume.weeklyKm, 1)} km/sem de media, por debajo de ${volume.weeklyTarget}`);
  if (volume && !volume.longOk) why('long', `tirada más larga de ${kmTxt(volume.longKm)}, por debajo de ${volume.longTarget} km`);
  let level = Math.max(0, CONFIDENCE_LEVELS.length - 1 - reasons.length);
  const tentative = !!volume && volume.short >= TENTATIVE_SHORT - EPS;
  if (!coherent) {
    level = 0;
    why('incoherent', `con una dispersión de más de ±${fmtNum(MAX_SPREAD * 100, 0)} % la predicción no es útil`);
  } else if (tentative) {
    level = 0;
    why('tentative', `falta más de la mitad del volumen de referencia para ${noun}: predicción todavía poco fiable`);
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
  const record = rec ? { timeSec: rec.timeSec, date: rec.date, estimated: !!rec.estimated, fromKm: rec.fromKm, sessionId: rec.sessionId } : null;
  const p = {
    id: race ? race.id : 'custom', km: D, label: race ? race.label : kmTxt(D), phrase: race ? race.phrase : `en ${kmTxt(D)}`,
    noun, profile, k, adjusted: !!volume && volume.short > EPS, volume, efforts, midExact,
    lowExact, highExact, spread, margin, step, low, mid, high, pace: mid / D, paceLow: low / D, paceHigh: high / D,
    confidence, confidenceLabel: CONFIDENCE_LABEL[confidence], confidenceReasons: reasons, confidenceCodes: codes,
    status, usable: status === 'ok' || status === 'tentative', record,
  };
  p.advice = predictionAdvice(p);
  p.why = predictionWhy(ctx, p);
  return p;
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const runWord = (n) => (n === 1 ? 'carrera válida reciente' : 'carreras válidas recientes');

/**
 * Aviso corto para la tarjeta (note) y qué dato mejoraría la predicción (improve). Sin aviso con confianza alta.
 * Prioridad: estado (incoherent, tentative) → volumen → distancia lejana → pocos esfuerzos → dispersión → límites.
 */
export function predictionAdvice(p) {
  const v = p.volume;
  const has = (c) => p.confidenceCodes.includes(c);
  const volRef = v ? `${v.weeklyTarget} km por semana y a una tirada de ${v.longTarget} km` : '';
  const volNow = v ? `ahora ${fmtNum(v.weeklyKm, 1)} km/sem y una tirada de ${kmTxt(v.longKm)}` : '';
  if (p.status === 'invalid') return { note: 'Datos insuficientes para esta distancia.', improve: 'Registra carreras de 3 km o más con su distancia y su tiempo en movimiento.' };
  if (p.status === 'incoherent') {
    return {
      note: `Tus carreras recientes no coinciden entre sí (±${pctTxt(p.spread)}): puede que alguna tenga mal apuntado el tiempo o la distancia.`,
      improve: 'Revisa las carreras de «Con qué se calcula»; con datos coherentes vuelve la estimación.',
    };
  }
  if (p.status === 'tentative') {
    return {
      note: `Tu volumen actual todavía es demasiado bajo para estimar ${p.noun} con precisión.`,
      improve: `Acercarte a ${volRef} (${volNow}).`,
    };
  }
  if (p.confidence === 'alta') return { note: null, improve: null };
  const n = p.efforts.length;
  if (has('weekly') || has('long')) {
    return { note: `Más prudente por volumen: ${volNow}, por debajo de la referencia.`, improve: `Acercarte a ${volRef}.` };
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
  const parts = [
    `Fórmula de Riegel: T₂ = T₁ × (D₂ / D₁)^k, con k = ${kTxt(K)}.`,
    `Se aplica a tus ${n} mejores esfuerzos (carreras de ${MIN_KM} km o más de las últimas ${WINDOW_WEEKS} semanas, cada una con su tiempo en movimiento; el senderismo y otros deportes no cuentan, ni las de ritmo imposible: más rápido de ${paceTxt(MIN_PACE)} o más lento de ${paceTxt(MAX_PACE)}).`,
    `Cada esfuerzo pesa más cuanto más reciente es (1 − días / ${RECENCY_DAYS}) y cuanto más se parece su distancia a ${p.noun} (√(menor / mayor)).`,
    `Estimación actual (el número grande): la media ponderada de lo que predice cada esfuerzo. Rango probable: ± la dispersión de esas predicciones (desviación típica ponderada, aquí ±${pctTxt(p.spread)}), con un mínimo de ±${fmtNum(MIN_MARGIN * 100, 0)} %, redondeado a ${p.step} s; de la mejor estimación a la más prudente.`,
    `Si la dispersión pasa de ±${fmtNum(MAX_SPREAD * 100, 0)} %, tus carreras se contradicen y no se da una predicción.`,
  ];
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
    label: `${dayTxt(e.date)} · ${e.label}`,
    value: `→ ${timeTxt(e.pred)} · pesa un ${fmtNum(e.share * 100, 0)} %${e.top ? ' (la que más)' : ''}`,
  }));
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
      label: `Tu mejor marca en ${p.noun.replace(/^(los|la|el) /, '')}`,
      value: `${timeTxt(r.timeSec)} · ${fmtDate(r.date, 'full')}${r.estimated ? ` (a ritmo medio de una carrera de ${kmTxt(r.fromKm)})` : ''}`,
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
  let message;
  if (!ctx.runs) message = 'Aún no hay carreras con distancia y tiempo.';
  else if (!n) message = `Ninguna carrera cuenta todavía: hacen falta al menos ${MIN_VALID} de ${MIN_KM} km o más en las últimas ${WINDOW_WEEKS} semanas.`;
  else message = `Solo hay 1 carrera válida (${MIN_KM} km o más en las últimas ${WINDOW_WEEKS} semanas); hacen falta al menos ${MIN_VALID}.`;
  const notCounted = notes.length ? `No cuentan: ${notes.join(', ')}.` : null;
  if (notCounted) message += ` ${notCounted}`;
  const data = ctx.valid.map((e) => ({ label: dayTxt(e.date), value: e.label }));
  data.push({ label: 'Carreras válidas', value: `${n} de ${MIN_VALID} necesarias` });
  if (ex.short) data.push({ label: `De menos de ${MIN_KM} km`, value: String(ex.short) });
  if (ex.old) data.push({ label: `De hace más de ${WINDOW_WEEKS} semanas`, value: String(ex.old) });
  if (ex.implausible) data.push({ label: 'Con ritmo imposible', value: String(ex.implausible) });
  if (ex.slow) data.push({ label: `Más lentas de ${paceTxt(MAX_PACE)}`, value: String(ex.slow) });
  return {
    ok: false, reason: INSUFFICIENT, message, notCounted, today: ctx.today, from: ctx.from, valid: n, needed: MIN_VALID,
    excluded: { ...ex }, suspect: ctx.suspect, efforts: ctx.valid, basis: ctx.basis, weeklyKm: ctx.weeklyKm,
    longestRecentKm: ctx.longestRecentKm, longest: ctx.longest, predictions: {},
    why: {
      rule: `Para estimar tiempos hacen falta al menos ${MIN_VALID} carreras de ${MIN_KM} km o más en las últimas ${WINDOW_WEEKS} semanas (desde el ${fmtDate(ctx.from, 'full')}), con distancia y tiempo. Cada carrera cuenta con su tiempo en movimiento; se usan las ${TOP_N} mejores con la fórmula de Riegel (k = ${kTxt(K)}). El senderismo y otros deportes no cuentan, ni las carreras de ritmo imposible (más rápido de ${paceTxt(MIN_PACE)} o más lento de ${paceTxt(MAX_PACE)}).`,
      data,
    },
  };
}

/**
 * Tiempos previstos para 5 km, 10 km, media maratón y maratón.
 * @param {object} data  entrada común de stats.js (data.today = «hoy»)
 * @param {{today?:string}} [opts]  «hoy» inyectable (manda sobre data.today)
 * @returns {{ ok:true, today, from, valid, excluded, suspect, efforts, basis, weeklyKm, longestRecentKm, longest,
 *   predictions:{ '5k'|'10k'|'half'|'marathon': Prediction } }
 *   | { ok:false, reason:'datos insuficientes', message, notCounted (qué carreras no cuentan)|null, valid, needed,
 *       excluded, suspect, efforts, basis, weeklyKm,
 *       longestRecentKm, longest, predictions:{}, why:{rule, data} }}
 *  Prediction: ver predictDistance (low, mid, high en segundos; confidence 'alta'|'media'|'baja'; status; advice;
 *  why {rule, data}). suspect: carreras que no cuentan por un ritmo imposible (para revisarlas).
 */
export function predictRaces(data, opts = {}) {
  const ctx = analyzeRuns(data, opts);
  if (ctx.valid.length < MIN_VALID) return insufficient(ctx);
  const predictions = {};
  for (const r of RACES) predictions[r.id] = predictDistance(ctx, r.km, r);
  return {
    ok: true, today: ctx.today, from: ctx.from, valid: ctx.valid.length, excluded: { ...ctx.excluded }, suspect: ctx.suspect,
    efforts: ctx.valid, basis: ctx.basis, weeklyKm: ctx.weeklyKm, longestRecentKm: ctx.longestRecentKm, longest: ctx.longest, predictions,
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
  const ctx = analyzeRuns(data, opts);
  if (ctx.valid.length < MIN_VALID) {
    const ins = insufficient(ctx);
    return { ...base, verdict: 'insuficiente', reason: INSUFFICIENT, label: VERDICT_LABEL.insuficiente, distanceLabel, text: ins.message, why: ins.why };
  }
  const p = predictDistance(ctx, D, race);
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
