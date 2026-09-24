// checkin-logic.js — lógica PURA del check-in opcional (sueño, energía y agujetas; 1 bajo · 2 normal · 3 alto).
// PROPIETARIO: módulo de check-in. No lee el store ni toca el DOM (se prueba en Node: tests/unit/checkin.test.mjs).
// La tarjeta (DOM + guardado) está en ./checkin.js, que reexporta todo esto.
//
// Store 'checkins': { id, date:'YYYY-MM-DD', timing:'pre'|'post', sessionId|null, sleep, energy, soreness,
//                     createdAt, updatedAt } — uno por día y momento (si ya existe, se edita el mismo).
// Solo se usa como contexto en el panel semanal y en la sugerencia de descarga (js/insights.js).
import { uid, isDateStr } from './util.js';

export const TIMINGS = ['pre', 'post'];
export const LEVELS = [1, 2, 3];
/** Texto de los botones de cada fila (el mismo en las tres, como pide el encargo). */
export const LEVEL_LABEL = { 1: 'Bajo', 2: 'Normal', 3: 'Alto' };
export const LEVEL_OPTIONS = LEVELS.map((v) => ({ value: v, label: LEVEL_LABEL[v] }));
export const TIMING_LABEL = { pre: 'Antes de entrenar', post: 'Después de entrenar' };
export const TIMING_SHORT = { pre: 'Antes', post: 'Después' };

/**
 * Las tres preguntas. `words` = el valor concordado con el nombre («energía baja», «agujetas altas»).
 * `low` = el valor que cuenta como check-in bajo (sueño o energía bajos, o agujetas altas).
 */
export const FIELDS = [
  { key: 'sleep', label: 'Sueño', noun: 'sueño', words: { 1: 'bajo', 2: 'normal', 3: 'alto' }, low: 1 },
  { key: 'energy', label: 'Energía', noun: 'energía', words: { 1: 'baja', 2: 'normal', 3: 'alta' }, low: 1 },
  { key: 'soreness', label: 'Agujetas', noun: 'agujetas', words: { 1: 'bajas', 2: 'normales', 3: 'altas' }, low: 3 },
];
export const FIELD_KEYS = FIELDS.map((f) => f.key);

/** 1, 2 o 3; cualquier otra cosa → null. */
export function level(v) {
  return v === 1 || v === 2 || v === 3 ? v : null;
}

/** Acepta un array, un Map o cualquier iterable de check-ins. */
function toList(checkins) {
  if (!checkins) return [];
  if (Array.isArray(checkins)) return checkins;
  if (checkins instanceof Map) return [...checkins.values()];
  if (typeof checkins[Symbol.iterator] === 'function') return [...checkins];
  return [];
}

const stampOf = (c) => c.updatedAt || c.createdAt || 0;

/**
 * Check-in de ese día y momento (null si no hay). Si hubiera varios (copias antiguas), el editado más tarde.
 * Sin `timing`: el de antes y, si no hay, el de después.
 */
export function checkinFor(checkins, date, timing = null) {
  if (!isDateStr(date)) return null;
  if (timing == null) return checkinFor(checkins, date, 'pre') || checkinFor(checkins, date, 'post');
  let best = null;
  for (const c of toList(checkins)) {
    if (!c || c.date !== date || c.timing !== timing) continue;
    if (!best || stampOf(c) > stampOf(best)) best = c;
  }
  return best;
}

/** Tiene al menos un valor válido. */
export function hasValues(c) {
  return !!c && FIELD_KEYS.some((k) => level(c[k]) != null);
}

/** Las tres preguntas contestadas. */
export function isComplete(c) {
  return !!c && FIELD_KEYS.every((k) => level(c[k]) != null);
}

/** Check-in «bajo»: sueño bajo, energía baja o agujetas altas (el mismo criterio que la sugerencia de descarga). */
export function isLowCheckin(c) {
  return !!c && (level(c.sleep) === 1 || level(c.energy) === 1 || level(c.soreness) === 3);
}

/** Motivos por los que es bajo: ['sueño bajo', 'energía baja', 'agujetas altas'] (los que se cumplan). */
export function lowReasons(c) {
  if (!c) return [];
  return FIELDS.filter((f) => level(c[f.key]) === f.low).map((f) => `${f.noun} ${f.words[f.low]}`);
}

/** «Bajo», «Alta», «Normales»… (concordado; null si no hay valor). */
export function valueWord(key, v) {
  const f = FIELDS.find((x) => x.key === key);
  const w = f && level(v) ? f.words[level(v)] : null;
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : null;
}

/** «sueño bajo», «energía alta»… (null si no hay valor). */
export function valueText(key, v) {
  const f = FIELDS.find((x) => x.key === key);
  const l = level(v);
  return f && l ? `${f.noun} ${f.words[l]}` : null;
}

/** «Sueño normal · Energía alta · Agujetas bajas» (solo lo contestado; '' si nada). */
export function checkinText(c) {
  if (!c) return '';
  const parts = FIELDS.map((f) => valueText(f.key, c[f.key])).filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' · ');
}

/** Registro nuevo (sin valores). */
export function newCheckin({ date, timing = 'pre', sessionId = null } = {}, now = Date.now(), id = uid('ci_')) {
  return {
    id, date, timing: TIMINGS.includes(timing) ? timing : 'pre', sessionId: sessionId || null,
    sleep: null, energy: null, soreness: null, createdAt: now,
  };
}

/**
 * Aplica un toque: pone `key` = `value` (1/2/3, o null para quitarlo) en el check-in de ese día y momento,
 * creándolo si no existe. MUTA el existente (patrón del store: mutar y guardar).
 * → { record, created, empty } — `empty`: ya no le queda ningún valor (no merece la pena guardarlo).
 * `record` es null si no existía y el toque no pone nada.
 */
export function applyValue(checkins, { date, timing = 'pre', sessionId = null }, key, value, now = Date.now()) {
  if (!FIELD_KEYS.includes(key)) throw new Error(`Campo de check-in desconocido: ${key}`);
  const v = level(value);
  let record = checkinFor(checkins, date, timing);
  let created = false;
  if (!record) {
    if (v == null) return { record: null, created: false, empty: true };
    record = newCheckin({ date, timing, sessionId }, now);
    created = true;
  }
  record[key] = v;
  if (sessionId && !record.sessionId) record.sessionId = sessionId;
  return { record, created, empty: !hasValues(record) };
}

const TIMING_ORDER = { pre: 0, post: 1 };
function byDateTiming(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (TIMING_ORDER[a.timing] ?? 2) - (TIMING_ORDER[b.timing] ?? 2);
}

/** Check-ins con algún valor entre `from` y `to` (incluidos; null = sin límite), por fecha (antes, después). */
export function checkinsBetween(checkins, from = null, to = null) {
  return toList(checkins)
    .filter((c) => c && isDateStr(c.date) && hasValues(c) && (!from || c.date >= from) && (!to || c.date <= to))
    .sort(byDateTiming);
}

/**
 * Resumen de un periodo (para el panel semanal o la sugerencia de descarga).
 * → { from, to, count, days, low, lowShare, mostlyLow, lowBy:{sleep, energy, soreness},
 *     fields:{ sleep:{n, counts:{1,2,3}, mean}, … }, list, text }
 *   - count: check-ins con algún valor (antes y después cuentan por separado); days: fechas distintas.
 *   - low: cuántos son bajos (isLowCheckin); lowShare = low / count (null sin check-ins);
 *     mostlyLow: al menos la mitad son bajos (el criterio de la sugerencia de descarga).
 *   - lowBy: veces con sueño bajo, energía baja y agujetas altas.
 *   - text: «3 check-ins · 2 bajos (sueño bajo ×2, agujetas altas ×1)» o «Sin check-ins».
 */
export function summary(checkins, from = null, to = null) {
  const list = checkinsBetween(checkins, from, to);
  const fields = {};
  for (const f of FIELDS) {
    const counts = { 1: 0, 2: 0, 3: 0 };
    let n = 0;
    let total = 0;
    for (const c of list) {
      const v = level(c[f.key]);
      if (v == null) continue;
      counts[v]++;
      n++;
      total += v;
    }
    fields[f.key] = { n, counts, mean: n ? total / n : null };
  }
  const lowBy = Object.fromEntries(FIELDS.map((f) => [f.key, fields[f.key].counts[f.low]]));
  const low = list.filter(isLowCheckin).length;
  const count = list.length;
  let text = 'Sin check-ins';
  if (count) {
    const why = FIELDS.filter((f) => lowBy[f.key]).map((f) => `${f.noun} ${f.words[f.low]} ×${lowBy[f.key]}`);
    text = `${count} ${count === 1 ? 'check-in' : 'check-ins'} · ${low ? `${low} ${low === 1 ? 'bajo' : 'bajos'} (${why.join(', ')})` : 'ninguno bajo'}`;
  }
  return {
    from, to, count,
    days: new Set(list.map((c) => c.date)).size,
    low,
    lowShare: count ? low / count : null,
    mostlyLow: count > 0 && low * 2 >= count,
    lowBy, fields, list, text,
  };
}

/** Clave de localStorage que recuerda «Omitir» para ese día y momento (sin guardar ningún check-in). */
export function dismissKey(date, timing) {
  return `entreno:checkin-omitido:${date}:${timing}`;
}
