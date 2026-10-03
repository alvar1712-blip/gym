// confidence.js — confianza común de «tu analista» (ronda 6, fase C; docs/MEJORAS6.md). PURO.
//
// Cuatro niveles, NO probabilidades: 'insufficient' (no se concluye nada) · 'low' · 'medium' · 'high'.
// Cada análisis describe sus factores (cuántas observaciones, en cuánto tiempo, cuánto ruido, si faltan datos, si hay
// cambios recientes en el contexto) y la confianza es la del factor MÁS débil: así siempre se puede decir por qué no
// es más alta («12 pesajes en 18 días; empezaste creatina hace 10 días»).
//
//   const c = combine([byCount(n, { low: 8, medium: 12, high: 18 }, 'pesajes'), bySpan(days, …), capAt('medium', '…')]);
//   → { level:'medium', label:'Confianza media', short:'media', reasons:['…'], basis:['…', …] }
//   reasons = los factores que la limitan (por debajo de 'high'); basis = todos, para el «¿Por qué?».

export const LEVELS = ['insufficient', 'low', 'medium', 'high'];
export const CONF_LABEL = { insufficient: 'Datos insuficientes', low: 'Confianza baja', medium: 'Confianza media', high: 'Confianza alta' };
export const CONF_SHORT = { insufficient: 'insuficiente', low: 'baja', medium: 'media', high: 'alta' };

const rank = (l) => LEVELS.indexOf(l);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** El más bajo de dos niveles. */
export function minLevel(a, b) {
  return rank(a) <= rank(b) ? a : b;
}

/** ¿`level` es al menos `min`? */
export function atLeast(level, min) {
  return rank(level) >= rank(min);
}

/** Factor fijo: «como mucho `level`, porque `reason`». */
export function capAt(level, reason, key = 'cap') {
  return { key, level: LEVELS.includes(level) ? level : 'low', reason };
}

/**
 * Por número de observaciones: < low → insuficiente; < medium → baja; < high → media; si no, alta.
 * `text(n)` describe la cantidad («12 pesajes»).
 */
export function byCount(n, { low, medium, high }, text = (k) => String(k), key = 'count') {
  const v = isNum(n) ? n : 0;
  const level = v < low ? 'insufficient' : v < medium ? 'low' : v < high ? 'medium' : 'high';
  return { key, level, reason: level === 'high' ? text(v) : `${text(v)} (para confianza alta, ${text(high)} o más)` };
}

/** Por tiempo cubierto (días): mismos cortes que byCount. */
export function bySpan(days, { low, medium, high }, key = 'span') {
  const v = isNum(days) ? Math.max(0, Math.round(days)) : 0;
  const level = v < low ? 'insufficient' : v < medium ? 'low' : v < high ? 'medium' : 'high';
  const txt = (d) => (d >= 14 && d % 7 === 0 ? `${d / 7} semanas` : `${d} ${d === 1 ? 'día' : 'días'}`);
  return { key, level, reason: level === 'high' ? `datos de ${txt(v)}` : `datos de solo ${txt(v)} (para confianza alta, ${txt(high)} o más)` };
}

/**
 * Por ruido relativo (p. ej. variación diaria / peso, o residuo / nivel, en %): > low → baja; > medium → media.
 * `text(r)` describe el ruido.
 */
export function byNoise(rel, { medium, low }, text = (r) => `ruido ±${r} %`, key = 'noise') {
  if (!isNum(rel)) return { key, level: 'high', reason: 'ruido sin calcular' };
  const level = rel > low ? 'low' : rel > medium ? 'medium' : 'high';
  return { key, level, reason: text(rel) };
}

/**
 * Combina factores: la confianza es la del más débil.
 * @param {{key, level, reason}[]} factors (los null/undefined se ignoran)
 * @returns {{ level, label, short, reasons:string[], basis:string[], factors }}
 */
export function combine(factors) {
  const fs = (factors || []).filter((f) => f && LEVELS.includes(f.level));
  let level = 'high';
  for (const f of fs) level = minLevel(level, f.level);
  return {
    level,
    label: CONF_LABEL[level],
    short: CONF_SHORT[level],
    reasons: [...new Set(fs.filter((f) => f.level !== 'high' && f.reason).map((f) => f.reason))],
    basis: [...new Set(fs.filter((f) => f.reason).map((f) => f.reason))],
    factors: fs,
  };
}

/** Confianza «datos insuficientes» con su motivo (para los avisos de «faltan datos»). */
export function insufficient(reason) {
  return combine([capAt('insufficient', reason, 'data')]);
}

/** Fila del «¿Por qué?»: «Confianza media: 12 pesajes en 18 días; empezaste creatina hace 10 días». */
export function confidenceRow(c) {
  if (!c) return null;
  const why = c.reasons.length ? c.reasons : c.basis;
  return { label: 'Confianza', value: `${c.short.charAt(0).toUpperCase()}${c.short.slice(1)}${why.length ? `: ${why.join('; ')}` : ''}` };
}
