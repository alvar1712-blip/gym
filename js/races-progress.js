// races-progress.js — «Cómo vas» de un evento deportivo (ronda 6, fase E; docs/MEJORAS6.md). PURO.
// Reutiliza (no duplica): race-predict.checkTarget / predictFor para el tiempo previsto de las carreras a pie y
// goals-logic.goalProgress para el objetivo enlazado (que, en carrera con tiempo, consume el mismo motor: mismo
// previsto y mismo veredicto). `base` = race-predict.baseOf, el resultado base que comparan las pruebas cruzadas. Aparte de races-logic.js para que Hoy no cargue race-predict.
import { fmtRaceTime } from './util.js';
import { checkTarget, predictFor, baseOf, MIN_VALID, rangeText } from './race-predict.js';
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
    return { verdict: c.verdict, label: c.label, text: c.text, range: c.prediction ? rangeText(c.prediction) : null, mid: c.prediction?.mid ?? null, confidence: c.prediction?.confidence ?? null, status: c.prediction?.status ?? null, base: baseOf(c.prediction), why: c.why };
  }
  const r = predictFor(data, km, opts);
  if (!r.ok) return { verdict: 'insuficiente', label: 'Datos insuficientes', text: `Con ${MIN_VALID} carreras de 3 km o más en las últimas 12 semanas (o un resultado de carrera apuntado en tu contexto) verás aquí tu tiempo previsto.`, range: null, mid: null, confidence: null, status: null, base: null, why: null };
  const p = r.prediction;
  // Sin predicción útil (carreras que se contradicen): se dice, sin cifras.
  if (!p.usable) return { verdict: 'insuficiente', label: 'Datos insuficientes', text: `No hay una previsión útil para ${p.noun}. ${p.advice.note}`, range: null, mid: null, confidence: p.confidence, status: p.status, base: null, why: p.why };
  const tentative = p.status === 'tentative';
  return {
    verdict: 'prevision', label: tentative ? 'Orientativo' : 'Previsto',
    text: tentative
      ? `Estimación orientativa hoy: ${rangeText(p)} (${fmtRaceTime(p.mid)}). ${p.advice.note}`
      : `Tiempo previsto hoy: ${rangeText(p)} (${fmtRaceTime(p.mid)}). Es una estimación con tus carreras de las últimas 12 semanas.`,
    range: rangeText(p), mid: p.mid, confidence: p.confidence, status: p.status, base: baseOf(p), why: p.why,
  };
}

/** Progreso del objetivo enlazado (goalProgress) o null. */
export function linkedGoalProgress(data, race, goals) {
  if (!race?.goalId) return null;
  const goal = toArr(goals).find((g) => g && g.id === race.goalId);
  if (!goal) return null;
  return { goal, progress: goalProgress(data, goal) };
}
