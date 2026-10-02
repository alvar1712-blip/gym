// checkin-logic.js — lógica PURA del check-in opcional: sueño, energía, estrés y agujetas (1 bajo · 2 normal · 3 alto)
// y, opcional, agujetas o molestias por zona (0–10). PROPIETARIO: módulo de check-in. No lee el store ni toca el DOM
// (se prueba en Node: tests/unit/checkin.test.mjs). La tarjeta (DOM + guardado) está en ./checkin.js, que reexporta esto.
//
// Store 'checkins': { id, date:'YYYY-MM-DD', timing:'pre'|'post', sessionId|null, sleep, energy, stress, soreness,
//                     areas?:[Area], createdAt, updatedAt } — uno por día y momento (si ya existe, se edita el mismo).
//   Area = { id, kind:'muscle'|'joint', zone (músculo de seed.MUSCLES o articulación de JOINTS),
//            side:null|'left'|'right'|'both', level:0..10, note }
// Ronda 6 (docs/MEJORAS6.md, fase B): `stress` y `areas` son opcionales; los check-ins antiguos (sin ellos) siguen
// valiendo tal cual. `soreness` (1–3) sigue siendo las agujetas en general: ni se convierte a 0–10 ni se le inventa zona.
// La regla de check-in «bajo» (sugerencia de descarga) no cambia: sueño bajo, energía baja o agujetas altas.
import { uid, isDateStr } from './util.js';
import { MUSCLES, MUSCLE_LABEL } from './seed.js';

export const TIMINGS = ['pre', 'post'];
export const LEVELS = [1, 2, 3];
/** Texto de los botones de cada fila (el mismo en todas, como pide el encargo). */
export const LEVEL_LABEL = { 1: 'Bajo', 2: 'Normal', 3: 'Alto' };
export const LEVEL_OPTIONS = LEVELS.map((v) => ({ value: v, label: LEVEL_LABEL[v] }));
export const TIMING_LABEL = { pre: 'Antes de entrenar', post: 'Después de entrenar' };
export const TIMING_SHORT = { pre: 'Antes', post: 'Después' };

/**
 * Las cuatro preguntas, en el orden de la tarjeta. `words` = el valor concordado con el nombre («energía baja»,
 * «agujetas altas»). `low` = el valor desfavorable. `lowRule` = cuenta para el check-in «bajo» (isLowCheckin): el
 * estrés se registra y se muestra, pero no cambia la regla de la sugerencia de descarga.
 */
export const FIELDS = [
  { key: 'sleep', label: 'Sueño', noun: 'sueño', words: { 1: 'bajo', 2: 'normal', 3: 'alto' }, low: 1, lowRule: true },
  { key: 'energy', label: 'Energía', noun: 'energía', words: { 1: 'baja', 2: 'normal', 3: 'alta' }, low: 1, lowRule: true },
  { key: 'stress', label: 'Estrés', noun: 'estrés', words: { 1: 'bajo', 2: 'normal', 3: 'alto' }, low: 3, lowRule: false },
  { key: 'soreness', label: 'Agujetas', noun: 'agujetas', words: { 1: 'bajas', 2: 'normales', 3: 'altas' }, low: 3, lowRule: true },
];
/** Las que deciden si un check-in es «bajo» (las de siempre). */
export const LOW_FIELDS = FIELDS.filter((f) => f.lowRule);
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

/** Tiene al menos un valor válido (una de las preguntas o una zona). */
export function hasValues(c) {
  return !!c && (FIELD_KEYS.some((k) => level(c[k]) != null) || areasOf(c).length > 0);
}

/** Las cuatro preguntas contestadas (las zonas son aparte y opcionales). */
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
  return LOW_FIELDS.filter((f) => level(c[f.key]) === f.low).map((f) => `${f.noun} ${f.words[f.low]}`);
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

/** «Sueño normal · Energía alta · Estrés bajo · Agujetas bajas» (solo lo contestado; '' si nada; sin zonas). */
export function checkinText(c) {
  if (!c) return '';
  const parts = FIELDS.map((f) => valueText(f.key, c[f.key])).filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' · ');
}

/** Registro nuevo (sin valores). */
export function newCheckin({ date, timing = 'pre', sessionId = null } = {}, now = Date.now(), id = uid('ci_')) {
  return {
    id, date, timing: TIMINGS.includes(timing) ? timing : 'pre', sessionId: sessionId || null,
    sleep: null, energy: null, stress: null, soreness: null, areas: [], createdAt: now,
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
 *     fields:{ sleep:{n, counts:{1,2,3}, mean}, energy, stress, soreness }, list, text }
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
  const lowBy = Object.fromEntries(LOW_FIELDS.map((f) => [f.key, fields[f.key].counts[f.low]]));
  const low = list.filter(isLowCheckin).length;
  const count = list.length;
  let text = 'Sin check-ins';
  if (count) {
    const why = LOW_FIELDS.filter((f) => lowBy[f.key]).map((f) => `${f.noun} ${f.words[f.low]} ×${lowBy[f.key]}`);
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

// ---------------------------------------------------------------------------
// Agujetas y molestias por zona (opcional; 0–10)
// ---------------------------------------------------------------------------

export const AREA_KINDS = [
  { id: 'muscle', label: 'Agujetas', sub: 'músculo' },
  { id: 'joint', label: 'Molestia o dolor', sub: 'articulación' },
];
/** Articulaciones y zonas que no son un músculo del mapa. */
export const JOINTS = [
  { id: 'neck', label: 'Cuello' },
  { id: 'shoulder', label: 'Hombro' },
  { id: 'elbow', label: 'Codo' },
  { id: 'wrist', label: 'Muñeca' },
  { id: 'lowback', label: 'Zona lumbar' },
  { id: 'hip', label: 'Cadera' },
  { id: 'knee', label: 'Rodilla' },
  { id: 'ankle', label: 'Tobillo' },
  { id: 'foot', label: 'Pie' },
  { id: 'other', label: 'Otra zona' },
];
export const SIDES = [
  { id: 'left', label: 'Izquierda', short: 'izq.' },
  { id: 'right', label: 'Derecha', short: 'der.' },
  { id: 'both', label: 'Ambos lados', short: 'ambos lados' },
];
export const AREA_MIN = 0;
export const AREA_MAX = 10;
const MUSCLE_IDS = new Set(MUSCLES.map((m) => m.id));
const JOINT_IDS = new Set(JOINTS.map((j) => j.id));
const SIDE_IDS = new Set(SIDES.map((x) => x.id));

/** Zona saneada (para leer lo guardado o importado) o null si no se puede leer. */
export function normalizeArea(a) {
  if (!a || typeof a !== 'object') return null;
  const kind = a.kind === 'joint' ? 'joint' : a.kind === 'muscle' ? 'muscle' : null;
  if (!kind || !(kind === 'muscle' ? MUSCLE_IDS : JOINT_IDS).has(a.zone)) return null;
  if (!Number.isInteger(a.level) || a.level < AREA_MIN || a.level > AREA_MAX) return null;
  return {
    id: typeof a.id === 'string' && a.id ? a.id : `${kind}:${a.zone}:${a.side || ''}`,
    kind, zone: a.zone, side: SIDE_IDS.has(a.side) ? a.side : null, level: a.level,
    note: typeof a.note === 'string' ? a.note.trim().slice(0, 200) : '',
  };
}

/** Zonas de un check-in (las antiguas no tienen ninguna). */
export function areasOf(c) {
  return Array.isArray(c?.areas) ? c.areas.map(normalizeArea).filter(Boolean) : [];
}

/** «Isquiotibiales» · «Rodilla». */
export function areaName(a) {
  return a.kind === 'muscle' ? MUSCLE_LABEL[a.zone] || a.zone : JOINTS.find((j) => j.id === a.zone)?.label || a.zone;
}

/** «Isquiotibiales (izq.): agujetas 7/10» · «Rodilla (der.): molestia 4/10». */
export function areaText(a) {
  const side = a.side ? ` (${SIDES.find((x) => x.id === a.side).short})` : '';
  return `${areaName(a)}${side}: ${a.kind === 'muscle' ? 'agujetas' : 'molestia'} ${a.level}/10`;
}

/** Corto, para una ficha: «Isquiotibiales izq. · 7» · «Rodilla · molestia 3». */
export function areaShort(a) {
  const side = a.side ? ` ${SIDES.find((x) => x.id === a.side).short}` : '';
  return `${areaName(a)}${side} · ${a.kind === 'joint' ? 'molestia ' : ''}${a.level}`;
}

/** Banda para el color: 0 → 'none', 1–3 → 'low', 4–6 → 'mid', 7–10 → 'high'. */
export function levelBand(lv) {
  return lv >= 7 ? 'high' : lv >= 4 ? 'mid' : lv >= 1 ? 'low' : 'none';
}

/** «Isquiotibiales (izq.): agujetas 7/10 · Rodilla: molestia 3/10» ('' sin zonas). */
export function areasText(c) {
  return areasOf(c).map(areaText).join(' · ');
}

/** Valida un borrador de zona: { field: mensaje } (vacío = se puede guardar). */
export function validateArea(a) {
  const err = {};
  if (!a || (a.kind !== 'muscle' && a.kind !== 'joint')) err.kind = 'Elige agujetas o molestia.';
  else if (!(a.kind === 'muscle' ? MUSCLE_IDS : JOINT_IDS).has(a.zone)) err.zone = a.kind === 'muscle' ? 'Toca el músculo en el mapa.' : 'Elige la zona.';
  if (!Number.isInteger(a?.level) || a.level < AREA_MIN || a.level > AREA_MAX) err.level = 'Elige la intensidad (0–10).';
  return err;
}

/**
 * Añade o cambia una zona en el check-in de ese día y momento (lo crea si no existe). Una zona por clase, músculo o
 * articulación y lado: volver a apuntar la misma la sustituye. MUTA el registro (patrón del store).
 * → { record, created, empty }
 */
export function upsertArea(checkins, { date, timing = 'pre', sessionId = null }, area, now = Date.now()) {
  const a = normalizeArea({ ...area, id: area.id || uid('ar_') });
  if (!a) throw new Error('Zona de check-in no válida');
  let record = checkinFor(checkins, date, timing);
  let created = false;
  if (!record) {
    record = newCheckin({ date, timing, sessionId }, now);
    created = true;
  }
  const same = (x) => x.id === a.id || (x.kind === a.kind && x.zone === a.zone && (x.side || null) === a.side);
  record.areas = [...areasOf(record).filter((x) => !same(x)), a];
  if (sessionId && !record.sessionId) record.sessionId = sessionId;
  return { record, created, empty: !hasValues(record) };
}

/** Quita una zona (por id). → { record|null, empty } (record null si no había check-in). */
export function removeArea(checkins, { date, timing = 'pre' }, areaId) {
  const record = checkinFor(checkins, date, timing);
  if (!record) return { record: null, empty: true };
  record.areas = areasOf(record).filter((x) => x.id !== areaId);
  return { record, empty: !hasValues(record) };
}
