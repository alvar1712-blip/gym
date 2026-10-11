// recovery-logic.js — evolución de los check-ins en el tiempo (ronda 8, F; docs/MEJORAS.md §10). PURO: no lee el
// store ni toca el DOM (tests/unit/recovery-logic.test.mjs). Reutiliza checkin-logic (escala 1–3 de sueño, energía,
// estrés y agujetas; zonas 0–10) y no guarda nada: todo se deriva de los check-ins de siempre.
//
//   dayValues      un valor por día y campo (el de antes de entrenar; si falta, el de después: como checkinFor)
//   wellbeingTrend bloques por día / semana / mes (o trimestre) de 4 semanas, 12 semanas o todo, con su media
//   zoneTrends     zonas apuntadas 3 veces o más: últimos valores y si van a mejor, a peor o igual
//   trendWindow    últimos 14 días frente a los 42 anteriores (lo usa el analista: analysis-training.js)
//
// Nada de esto interpreta médicamente: describe lo que el usuario ha apuntado.
import { addDays, diffDays, weekStart, fmtDate, fmtNum, MONTH_SHORT } from './util.js';
import { FIELDS, level, checkinsBetween, areasOf, areaName, valueWord, SIDES } from './checkin-logic.js';

export const RECOVERY_PERIODS = [
  { id: '4w', label: '4 semanas', days: 28 }, // una celda por día (28)
  { id: '12w', label: '12 semanas', days: 84 }, // una celda por semana (12, de lunes a domingo)
  { id: 'all', label: 'Todo', days: null }, // por mes; por trimestre si son más de 36 meses (y por año si aún no cabe)
];
/** Días con check-in en el periodo para dar medias. */
export const MIN_DAYS = 4;
/** Fechas distintas para considerar que una zona se repite. */
export const ZONE_MIN_TIMES = 3;
/** Valores que se muestran en la secuencia de una zona. */
export const ZONE_SEQ_MAX = 6;
/** Puntos (0–10) para hablar de mejora o empeoramiento de una zona. */
export const ZONE_DIFF = 2;
/** Ventana del analista: 14 días recientes frente a los 42 anteriores, con sus mínimos. */
export const TREND_RECENT_DAYS = 14;
export const TREND_BASE_DAYS = 42;
export const TREND_MIN_RECENT = 4;
export const TREND_MIN_BASE = 6;
export const TREND_MIN_DIFF = 0.5;
/** Celdas como mucho en «Todo». */
export const MAX_CELLS = 36;

const KEYS = FIELDS.map((f) => f.key);
const stampOf = (c) => c.updatedAt || c.createdAt || 0;
const meanOf = (xs) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);

/**
 * Un valor por día y campo entre `from` y `to` (incluidos; null = sin límite): el del check-in de antes de entrenar y,
 * si ese campo falta, el de después (la prioridad de checkinFor). Con copias repetidas del mismo momento, la editada
 * más tarde.
 * @returns {Map<string, {sleep, energy, stress, soreness}>} solo días con algún valor de los cuatro
 */
export function dayValues(checkins, from = null, to = null) {
  const byDate = new Map();
  for (const c of checkinsBetween(checkins, from, to)) {
    const t = c.timing === 'post' ? 'post' : c.timing === 'pre' ? 'pre' : null;
    if (!t) continue;
    let d = byDate.get(c.date);
    if (!d) { d = { pre: null, post: null }; byDate.set(c.date, d); }
    if (!d[t] || stampOf(c) > stampOf(d[t])) d[t] = c;
  }
  const out = new Map();
  for (const [date, { pre, post }] of byDate) {
    const v = {};
    let any = false;
    for (const k of KEYS) {
      v[k] = level(pre?.[k]) ?? level(post?.[k]) ?? null;
      if (v[k] != null) any = true;
    }
    if (any) out.set(date, v);
  }
  return out;
}

/** Primer día con algún valor (null sin check-ins). */
function firstDate(days) {
  let first = null;
  for (const d of days.keys()) if (!first || d < first) first = d;
  return first;
}

const monthStart = (d) => `${d.slice(0, 7)}-01`;
function addMonthsYmd(d, n) {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const quarterStart = (d) => `${d.slice(0, 4)}-${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
const yearStart = (d) => `${d.slice(0, 4)}-01-01`;

/** Celdas vacías (from, to, label) del periodo. */
function cellRanges(bucket, from, to) {
  const cells = [];
  if (bucket === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) cells.push({ from: d, to: d, label: fmtDate(d, 'day') });
    return cells;
  }
  if (bucket === 'week') {
    for (let d = from; d <= to; d = addDays(d, 7)) cells.push({ from: d, to: addDays(d, 6) < to ? addDays(d, 6) : to, label: `semana del ${fmtDate(d, 'day')}` });
    return cells;
  }
  const step = bucket === 'month' ? 1 : bucket === 'quarter' ? 3 : 12;
  for (let d = from; d <= to; d = addMonthsYmd(d, step)) {
    const end = addDays(addMonthsYmd(d, step), -1);
    const m = Number(d.slice(5, 7)) - 1;
    const label = bucket === 'month' ? `${MONTH_SHORT[m]} ${d.slice(0, 4)}`
      : bucket === 'quarter' ? `${MONTH_SHORT[m]}–${MONTH_SHORT[m + 2]} ${d.slice(0, 4)}` : d.slice(0, 4);
    cells.push({ from: d, to: end < to ? end : to, label });
  }
  return cells;
}

/** Media y número de días de un campo entre dos fechas (los días ya calculados). */
function statOf(days, key, from, to) {
  const xs = [];
  for (const [d, v] of days) if (d >= from && d <= to && v[key] != null) xs.push(v[key]);
  return { mean: meanOf(xs), n: xs.length };
}

/**
 * Evolución de sueño, energía, estrés y agujetas en un periodo.
 * @param {Iterable|Map|Array} checkins
 * @param {string} today 'YYYY-MM-DD'
 * @param {'4w'|'12w'|'all'} periodId (un id desconocido, o 'all' sin historial para ello, → '4w')
 * @returns {{ period, from, to, bucket:'day'|'week'|'month'|'quarter'|'year', daysWith, enough, hasAll,
 *   rows: { key, label, cells:{from, to, label, mean, n, level}[], mean, n, word, prevMean, prevN }[] }}
 *   mean de una fila: null con menos de MIN_DAYS días con ese campo. prevMean: el periodo anterior de la misma
 *   duración (null en «Todo» o con menos de MIN_DAYS días).
 */
export function wellbeingTrend(checkins, today, periodId = '4w') {
  const all = dayValues(checkins, null, today);
  const first = firstDate(all);
  const hasAll = !!first && diffDays(first, today) >= 84;
  let period = RECOVERY_PERIODS.find((p) => p.id === periodId) || RECOVERY_PERIODS[0];
  if (period.id === 'all' && !hasAll) period = RECOVERY_PERIODS[0];
  let from; let bucket; let prevFrom = null; let prevTo = null;
  if (period.id === '4w') {
    from = addDays(today, -27);
    bucket = 'day';
  } else if (period.id === '12w') {
    from = addDays(weekStart(today), -77);
    bucket = 'week';
  } else {
    const months = monthsBetween(first, today) + 1;
    if (months <= MAX_CELLS) { bucket = 'month'; from = monthStart(first); } else if (Math.ceil(months / 3) + 1 <= MAX_CELLS) { bucket = 'quarter'; from = quarterStart(first); } else { bucket = 'year'; from = yearStart(first); }
  }
  if (period.days) {
    prevTo = addDays(from, -1);
    prevFrom = addDays(from, -diffDays(from, today) - 1);
  }
  const ranges = cellRanges(bucket, from, today);
  let daysWith = 0;
  for (const d of all.keys()) if (d >= from && d <= today) daysWith++;
  const rows = FIELDS.map((f) => {
    const cells = ranges.map((r) => {
      const s = statOf(all, f.key, r.from, r.to);
      return { ...r, mean: s.mean, n: s.n, level: s.mean == null ? null : Math.round(s.mean) };
    });
    const cur = statOf(all, f.key, from, today);
    const mean = cur.n >= MIN_DAYS ? cur.mean : null;
    const prev = prevFrom ? statOf(all, f.key, prevFrom, prevTo) : { mean: null, n: 0 };
    return {
      key: f.key, label: f.label, cells, mean, n: cur.n,
      word: mean == null ? null : valueWord(f.key, Math.round(mean)),
      prevMean: prev.n >= MIN_DAYS ? prev.mean : null, prevN: prev.n,
    };
  });
  return { period: period.id, from, to: today, bucket, daysWith, enough: daysWith >= MIN_DAYS, hasAll, rows };
}

/**
 * Regla de las zonas (se explica en la pantalla): media de los 2 últimos valores menos la de los 2 primeros de la
 * secuencia mostrada; ≤ −2 → 'better', ≥ +2 → 'worse'; si no, 'stable'.
 * @param {number[]} levels (0–10, en orden)
 * @returns {{ trend:'better'|'worse'|'stable', diff:number|null }}
 */
export function zoneTrend(levels) {
  const xs = (levels || []).filter((v) => Number.isFinite(v));
  if (xs.length < 2) return { trend: 'stable', diff: null };
  const diff = meanOf(xs.slice(-2)) - meanOf(xs.slice(0, 2));
  return { trend: diff <= -ZONE_DIFF ? 'better' : diff >= ZONE_DIFF ? 'worse' : 'stable', diff };
}

/** «Rodilla izq.», «Isquiotibiales», «Hombro ambos lados». */
export function zoneName(a) {
  const side = a.side ? SIDES.find((x) => x.id === a.side)?.short : null;
  return side ? `${areaName(a)} ${side}` : areaName(a);
}

/**
 * Zonas apuntadas en ZONE_MIN_TIMES fechas distintas o más (desde `from`, hasta hoy). Izquierda y derecha son zonas
 * distintas; el mismo día con antes y después cuenta una vez, con el valor más alto.
 * @returns {{ key, kind, zone, side, name, kindWord, seq:{date, level}[], times, trend, diff, lastDate,
 *   note:{date, text}|null }[]} la apuntada más recientemente primero
 */
export function zoneTrends(checkins, today, { from = null } = {}) {
  const zones = new Map();
  for (const c of checkinsBetween(checkins, from, today)) {
    for (const a of areasOf(c)) {
      const key = `${a.kind}:${a.zone}:${a.side || ''}`;
      let z = zones.get(key);
      if (!z) { z = { key, kind: a.kind, zone: a.zone, side: a.side, name: zoneName(a), dates: new Map(), note: null }; zones.set(key, z); }
      z.dates.set(c.date, Math.max(z.dates.get(c.date) ?? -1, a.level));
      // Por fecha y momento (antes, después): la última nota no vacía gana
      if (a.note) z.note = { date: c.date, text: a.note };
    }
  }
  const out = [];
  for (const z of zones.values()) {
    if (z.dates.size < ZONE_MIN_TIMES) continue;
    const dates = [...z.dates.keys()].sort();
    const seq = dates.slice(-ZONE_SEQ_MAX).map((date) => ({ date, level: z.dates.get(date) }));
    const { trend, diff } = zoneTrend(seq.map((x) => x.level));
    out.push({
      key: z.key, kind: z.kind, zone: z.zone, side: z.side, name: z.name, kindWord: z.kind === 'muscle' ? 'agujetas' : 'molestia',
      seq, times: dates.length, trend, diff, lastDate: dates[dates.length - 1], note: z.note,
    });
  }
  return out.sort((a, b) => (a.lastDate === b.lastDate ? a.name.localeCompare(b.name, 'es') : a.lastDate < b.lastDate ? 1 : -1));
}

/**
 * Últimos TREND_RECENT_DAYS días (hoy incluido) frente a los TREND_BASE_DAYS anteriores, para los cuatro campos, con
 * un valor por día. `diff` = media reciente − media de base (null si falta una de las dos).
 * @returns {{ [key]: { recent:{mean, n}, base:{mean, n}, diff } }}
 */
export function trendWindows(checkins, today) {
  const recentFrom = addDays(today, -(TREND_RECENT_DAYS - 1));
  const baseTo = addDays(recentFrom, -1);
  const baseFrom = addDays(recentFrom, -TREND_BASE_DAYS);
  const days = dayValues(checkins, baseFrom, today);
  const out = {};
  for (const k of KEYS) {
    const recent = statOf(days, k, recentFrom, today);
    const base = statOf(days, k, baseFrom, baseTo);
    out[k] = { recent, base, diff: recent.mean != null && base.mean != null ? recent.mean - base.mean : null };
  }
  return out;
}

/** trendWindows de un solo campo. */
export function trendWindow(checkins, today, key) {
  return trendWindows(checkins, today)[key] || null;
}

/** «2,1» (una cifra decimal). */
export const fmtMean = (v) => fmtNum(v, 1, 1);
