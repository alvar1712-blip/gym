// races-progress.js — «Cómo vas» de un evento deportivo (ronda 6, fase E; docs/MEJORAS6.md). PURO.
// Reutiliza (no duplica): race-predict.checkTarget / predictDistance para el tiempo previsto de las carreras a pie y
// goals-logic.goalProgress para el objetivo enlazado. Aparte de races-logic.js para que Hoy no cargue race-predict.
import { fmtDuration } from './util.js';
import { checkTarget, analyzeRuns, predictDistance, raceFor, MIN_VALID, rangeText } from './race-predict.js';
import { goalProgress } from './goals-logic.js';
import { fixedKm, sportOf } from './races-logic.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);

/**
 * Tiempo previsto de una carrera (solo carrera a pie con distancia): con objetivo, el veredicto de checkTarget
 * (probable · ajustado · hoy no); sin objetivo, el rango previsto. null si no aplica; { verdict:'insuficiente' } sin
 * carreras suficientes.
 */
export function racePrediction(data, race, { today = null } = {}) {
  const km = race ? fixedKm(race.type) ?? race.distanceKm : null;
  if (!race || sportOf(race) !== 'run' || !isNum(km)) return null;
  const opts = today ? { today } : {};
  if (isNum(race.targetSec)) {
    const c = checkTarget(data, km, race.targetSec, opts);
    return { verdict: c.verdict, label: c.label, text: c.text, range: c.prediction ? rangeText(c.prediction) : null, mid: c.prediction?.mid ?? null, confidence: c.prediction?.confidence ?? null, why: c.why };
  }
  const ctx = analyzeRuns(data, opts);
  if (ctx.valid.length < MIN_VALID) return { verdict: 'insuficiente', label: 'Datos insuficientes', text: `Con ${MIN_VALID} carreras de 3 km o más en las últimas 12 semanas verás aquí tu tiempo previsto.`, range: null, mid: null, confidence: null, why: null };
  const p = predictDistance(ctx, km, raceFor(km));
  return { verdict: 'prevision', label: 'Previsto', text: `Tiempo previsto hoy: ${rangeText(p)} (${fmtDuration(p.mid)}). Es una estimación con tus carreras de las últimas 12 semanas.`, range: rangeText(p), mid: p.mid, confidence: p.confidence, why: p.why };
}

/** Progreso del objetivo enlazado (goalProgress) o null. */
export function linkedGoalProgress(data, race, goals) {
  if (!race?.goalId) return null;
  const goal = toArr(goals).find((g) => g && g.id === race.goalId);
  if (!goal) return null;
  return { goal, progress: goalProgress(data, goal) };
}
