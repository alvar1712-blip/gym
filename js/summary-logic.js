// summary-logic.js — resúmenes semanal, mensual y anual (docs/MEJORAS.md §5).
// PROPIETARIO: módulo de resúmenes. PURO: no lee el store ni toca el DOM; recibe `data` por parámetro (la
// entrada común de stats.js: progress-ui.dataFromStore()) y se prueba en Node (tests/unit/summary.test.mjs).
//
// Reutiliza stats.js (historial por ejercicio con su 1RM estimado y sus récords, deportes con distancia,
// distancias de carrera, formato) y calc.js (carga, duración, volumen, series por músculo, detección de récords):
// los números son los mismos que en Progreso y en el panel semanal.
//
// TIPOS DE SESIÓN: los de seed.ACTIVITY_KINDS (en su orden) más cualquier otro que aparezca en los datos, siempre
// con 'other' al final. Un tipo nuevo (p. ej. el senderismo, 'hike') sale solo en totales, deportes y comparación;
// no hay listas de deportes escritas a mano. Una sesión sin tipo cuenta como 'other'.
//
// REGLAS
//  - Periodos: semanas de lunes a domingo, meses y años naturales, con fechas locales 'YYYY-MM-DD'.
//    «En curso» = contiene a data.today.
//  - Solo sesiones `status:'done'`; series de trabajo (calc.isWorkSet); carga = calc.sessionLoad (min × RPE);
//    minutos = calc.sessionDurationMin. Una actividad enlazada a una fuerza cuenta como sesión de su deporte
//    (igual que stats.weeklySeries). Días entrenados = fechas distintas con alguna sesión.
//  - Récords del periodo: los batidos en sesiones del periodo frente a TODO el historial anterior (misma regla que
//    el resumen de la sesión y Progreso: calc.detectPRs; la primera vez con un ejercicio o un deporte no es récord).
//    Uno por ejercicio (el mejor del periodo) y uno por deporte y marca.
//  - Ejercicios que más progresan (1RM estimado, inicio → fin): «inicio» = la última sesión con el ejercicio en el
//    periodo anterior o, si no se hizo entonces, la primera del periodo; «fin» = el mejor 1RM estimado del periodo.
//    Solo subidas; orden por % y después por kg.
//  - Comparación: con el periodo anterior entero o, si el actual está en curso, con el MISMO tramo del anterior
//    (1–26 sep frente a 1–26 ago): comparar medio mes con un mes entero daría bajadas engañosas.
import { weekStart, addDays, addMonths, diffDays, dow, isDateStr, todayStr, fmtDate, fmtWeekRange, fmtDuration, fmtPace, fmtMinutes, round, MONTH_LONG, MONTH_SHORT, DAY_LONG } from './util.js';
import { isWorkSet, sessionLoad, sessionDurationMin, sessionVolume, sessionMuscleSets, makeBodyweightFn, orderKeyOf, emptyBests, addToBests, detectPRs } from './calc.js';
import { DISTANCE_KINDS, RACE_DISTANCES, ESTIMATE_FACTOR, exercisesWithHistory, exerciseHistory, distanceLabel, weightLabel, fmtNumFast, muscleTarget } from './stats.js';
import { ACTIVITY_KINDS, MUSCLES, MUSCLE_LABEL } from './seed.js';
import { formatSet, fmtSec, LOAD_REP_TYPES } from './session-logic.js';

// ===========================================================================
// Constantes y tipos de sesión
// ===========================================================================

export const UNITS = ['week', 'month', 'year'];
const EPS = 1e-9;
const num = fmtNumFast;
const pad2 = (n) => String(n).padStart(2, '0');
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** Etiquetas en plural para listas y tarjetas (el resto sale de seed.ACTIVITY_KINDS). */
const LIST_LABEL = { other: 'Otras actividades' };
/** Récord de mayor desnivel positivo: solo en senderismo (MEJORAS §1, igual que stats.enduranceRecords). */
const ELEVATION_KINDS = ['hike'];

/** Tipos de seed.ACTIVITY_KINDS en su orden, sin 'other' (que va siempre al final). */
const SEED_KIND_IDS = [...new Set(ACTIVITY_KINDS.map((a) => a && a.id).filter(Boolean))].filter((k) => k !== 'other');

/** Tipo de una sesión tal como viene (sin tipo → 'other'). */
const rawKind = (s) => (typeof s.kind === 'string' && s.kind.trim() ? s.kind : 'other');

/**
 * Tipos de sesión en orden de presentación: los de seed.ACTIVITY_KINDS, después los que aparezcan en `sessions`
 * y no estén en seed (en orden de aparición) y 'other' al final.
 * @param {object[]} [sessions]
 * @returns {string[]}
 */
export function kindIds(sessions = []) {
  const ids = [...SEED_KIND_IDS];
  for (const s of sessions || []) {
    if (!s) continue;
    const k = rawKind(s);
    if (k !== 'other' && !ids.includes(k)) ids.push(k);
  }
  ids.push('other');
  return ids;
}

/** { id, label, emoji } de un tipo de sesión (etiqueta de lista: «Carrera», «Otras actividades»). */
export function kindInfo(kind) {
  const a = ACTIVITY_KINDS.find((x) => x && x.id === kind) || null;
  const other = ACTIVITY_KINDS.find((x) => x && x.id === 'other') || null;
  return {
    id: kind,
    label: LIST_LABEL[kind] || a?.label || cap(String(kind)),
    emoji: a?.emoji || other?.emoji || '⚡',
  };
}

/** Deportes con récords de distancia: los de stats.DISTANCE_KINDS y cualquier tipo de seed salvo fuerza y otras. */
const ENDURANCE_KINDS = [...new Set([...DISTANCE_KINDS, ...SEED_KIND_IDS])].filter((k) => k !== 'strength' && k !== 'other');

/** Segundos de una actividad: tiempo en movimiento o, en registros antiguos, la duración (como stats.js). */
const actSec = (a) => (a.movingSec > 0 ? a.movingSec : a.durationMin > 0 ? a.durationMin * 60 : null);
const toMap = (x) => {
  if (x instanceof Map) return x;
  if (Array.isArray(x)) return new Map(x.filter(Boolean).map((o) => [o.id, o]));
  return new Map(Object.entries(x || {}));
};

// ===========================================================================
// Formato
// ===========================================================================

/** Distancia total de un deporte: natación en metros, el resto en km con 1 decimal («42,5 km», «3.200 m»). */
export function fmtKm(kind, km) {
  if (km == null || !Number.isFinite(km)) return '—';
  if (kind === 'swim') return `${num(km * 1000, 0)} m`;
  return `${num(km, 1)} km`;
}

/**
 * Formato de un valor del resumen por métrica: sessions «3», days «12», minutes «4 h 05 min», load «1.250»,
 * volume «12.500 kg», workSets «48», km (con `kind`) «42,5 km» / «3.200 m».
 */
export function fmtValue(metric, v, kind = null) {
  if (v == null || !Number.isFinite(v)) return '—';
  switch (metric) {
    case 'minutes': return fmtMinutes(v);
    case 'volume': return `${num(v, 0)} kg`;
    case 'km': return fmtKm(kind, v);
    case 'sets': return num(v, 1);
    default: return num(v, 0);
  }
}

// ===========================================================================
// Periodos
// ===========================================================================

/** Primer día del periodo que contiene `date`: lunes, día 1 del mes o 1 de enero. */
export function periodStart(unit, date) {
  const d = isDateStr(date) ? date : todayStr();
  if (unit === 'week') return weekStart(d);
  if (unit === 'year') return `${d.slice(0, 4)}-01-01`;
  return `${d.slice(0, 7)}-01`;
}

/** Primer día del periodo desplazado `n` unidades desde el que contiene `date` (n < 0 hacia atrás). */
export function shiftPeriod(unit, date, n) {
  const s = periodStart(unit, date);
  if (unit === 'week') return addDays(s, 7 * n);
  if (unit === 'year') return `${String(+s.slice(0, 4) + n).padStart(4, '0')}-01-01`;
  const m = +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1) + n;
  return `${String(Math.floor(m / 12)).padStart(4, '0')}-${pad2((m % 12) + 1)}-01`;
}

/** Último día del periodo que contiene `date`: domingo, fin de mes o 31 de diciembre. */
export function periodEnd(unit, date) {
  const s = periodStart(unit, date);
  if (unit === 'week') return addDays(s, 6);
  if (unit === 'year') return `${s.slice(0, 4)}-12-31`;
  return addDays(shiftPeriod('month', s, 1), -1);
}

/** Título: «Semana 21–27 sep», «Septiembre 2026», «2026». */
export function periodTitle(unit, date) {
  const s = periodStart(unit, date);
  if (unit === 'week') return `Semana ${fmtWeekRange(s)}`;
  if (unit === 'year') return s.slice(0, 4);
  return `${cap(MONTH_LONG[+s.slice(5, 7) - 1])} ${s.slice(0, 4)}`;
}

/** Nombre del periodo dentro de una frase: «la semana del 21–27 sep», «septiembre de 2026», «2026». */
export function periodName(unit, date) {
  const s = periodStart(unit, date);
  if (unit === 'week') return `la semana del ${fmtWeekRange(s)}`;
  if (unit === 'year') return s.slice(0, 4);
  return `${MONTH_LONG[+s.slice(5, 7) - 1]} de ${s.slice(0, 4)}`;
}

/** Enlace a la pantalla de resúmenes: «#/summary?p=month&d=2026-09-01». */
export function summaryHref(unit, date) {
  const u = unit === 'year' ? 'year' : 'month';
  return `#/summary?p=${u}&d=${isDateStr(date) ? date : todayStr()}`;
}

/** Mismo día un periodo antes (fin del tramo comparable de un periodo en curso). 31 mar → 28/29 feb. */
function sameDayBefore(unit, date) {
  if (unit === 'week') return addDays(date, -7);
  return addMonths(date, unit === 'year' ? -12 : -1);
}
const minDate = (a, b) => (a < b ? a : b);

/**
 * Cuadrícula de un mes (lunes a domingo) para el calendario de días entrenados.
 * @param {string} date cualquier día del mes
 * @param {{date:string, kinds:string[]}[]} trainedDates
 * @param {string} today
 * @returns {{date:string|null, day:number|null, kinds:string[], future:boolean, today:boolean}[][]} semanas de 7 celdas
 *  (null = relleno antes del día 1 o después del último)
 */
export function monthGrid(date, trainedDates = [], today = todayStr()) {
  const s = periodStart('month', date);
  const e = periodEnd('month', s);
  const map = new Map((trainedDates || []).map((t) => [t.date, t.kinds || []]));
  const cells = [];
  for (let i = 0; i < dow(s); i++) cells.push({ date: null, day: null, kinds: [], future: false, today: false });
  for (let d = s; d <= e; d = addDays(d, 1)) {
    cells.push({ date: d, day: +d.slice(8, 10), kinds: map.get(d) || [], future: d > today, today: d === today });
  }
  while (cells.length % 7) cells.push({ date: null, day: null, kinds: [], future: false, today: false });
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ===========================================================================
// Contexto (una vez por objeto `data`)
// ===========================================================================

const CACHE = new WeakMap();

function context(data) {
  const d = data && typeof data === 'object' ? data : {};
  const sessions = Array.isArray(d.sessions) ? d.sessions : [];
  const hit = CACHE.get(d);
  if (hit && hit.sessions === sessions && hit.len === sessions.length && hit.exercises === d.exercises
    && hit.bodyweight === d.bodyweight && hit.bwLen === (d.bodyweight?.length ?? 0) && hit.settings === d.settings) return hit;
  const settings = d.settings || {};
  const baseBw = makeBodyweightFn(d.bodyweight || [], settings.bodyweightDefault ?? 75);
  const bwCache = new Map();
  const bwFn = (date) => {
    let v = bwCache.get(date);
    if (v === undefined) { v = baseBw(date); bwCache.set(date, v); }
    return v;
  };
  const keyed = [];
  for (const s of sessions) if (s && s.status === 'done' && isDateStr(s.date)) keyed.push({ s, k: orderKeyOf(s) });
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)); // la clave empieza por la fecha: orden por fecha
  const done = keyed.map((x) => x.s);
  const kinds = kindIds(done);
  const ctx = {
    data: d, sessions, len: sessions.length, exercises: d.exercises, bodyweight: d.bodyweight, bwLen: d.bodyweight?.length ?? 0,
    settings, exMap: toMap(d.exercises), bwFn, done, kinds,
    firstDate: done.length ? done[0].date : null,
    lastDate: done.length ? done[done.length - 1].date : null,
    strengthPRs: null, endurancePRs: null, e1rmHist: null,
  };
  if (data && typeof data === 'object') CACHE.set(data, ctx);
  return ctx;
}

/** Primer índice de ctx.done con fecha ≥ date. */
function lowerBound(done, date) {
  let lo = 0;
  let hi = done.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (done[m].date < date) lo = m + 1; else hi = m; }
  return lo;
}

// ===========================================================================
// Agregados de un tramo de fechas
// ===========================================================================

const zeroKind = () => ({ count: 0, minutes: 0, km: 0, load: 0, noLoad: 0, elevationM: 0 });

/** Totales de las sesiones terminadas entre `from` y `to` (incluidos). */
function aggregate(ctx, from, to) {
  const byKind = Object.fromEntries(ctx.kinds.map((k) => [k, zeroKind()]));
  const dayKinds = new Map();
  let sessions = 0; let minutes = 0; let load = 0; let noLoad = 0;
  const st = { sessions: 0, volume: 0, workSets: 0, muscleSets: {} };
  for (let i = lowerBound(ctx.done, from); i < ctx.done.length; i++) {
    const s = ctx.done[i];
    if (s.date > to) break;
    const k = rawKind(s);
    const b = byKind[k] || byKind.other;
    sessions++;
    b.count++;
    if (!dayKinds.has(s.date)) dayKinds.set(s.date, []);
    if (!dayKinds.get(s.date).includes(k)) dayKinds.get(s.date).push(k);
    const l = sessionLoad(s);
    if (l != null) { b.load += l; load += l; } else { b.noLoad++; noLoad++; }
    const m = sessionDurationMin(s);
    if (m != null) { b.minutes += m; minutes += m; }
    if (k === 'strength') {
      st.sessions++;
      st.volume += sessionVolume(s, ctx.exMap, ctx.bwFn);
      for (const se of s.exercises || []) for (const x of se.sets || []) if (isWorkSet(x)) st.workSets++;
      for (const [mu, n] of Object.entries(sessionMuscleSets(s, ctx.exMap, ctx.settings))) st.muscleSets[mu] = (st.muscleSets[mu] || 0) + n;
    } else {
      if (s.distanceKm > 0) b.km += s.distanceKm;
      if (s.elevationM > 0) b.elevationM += s.elevationM;
    }
  }
  for (const b of Object.values(byKind)) {
    b.minutes = round(b.minutes, 0.01);
    b.km = round(b.km, 0.001);
    b.elevationM = round(b.elevationM, 1);
  }
  for (const mu of Object.keys(st.muscleSets)) st.muscleSets[mu] = round(st.muscleSets[mu], 0.001);
  st.volume = round(st.volume, 0.01);
  return {
    from, to, sessions, days: dayKinds.size, minutes: round(minutes, 0.01), load, noLoad, byKind, strength: st,
    trainedDates: [...dayKinds].map(([date, kinds]) => ({ date, kinds })),
  };
}

// ===========================================================================
// Récords (una pasada por todo el historial; después se filtran por periodo)
// ===========================================================================

/**
 * Sesiones de fuerza con récords, por ejercicio y en orden: la misma detección que stats.exerciseHistory().prs
 * (calc.detectPRs frente al historial anterior, con el peso corporal del día en peso corporal) pero guardando
 * qué serie batió qué, para poder describirlo.
 */
function strengthPRs(ctx) {
  if (ctx.strengthPRs) return ctx.strengthPRs;
  const out = [];
  for (const it of exercisesWithHistory(ctx.data)) {
    const ex = ctx.exMap.get(it.exerciseId);
    if (!ex) continue;
    const hist = exerciseHistory(ctx.data, it.exerciseId, { labels: false });
    if (!hist.some((e) => e.prs && e.prs.length)) continue;
    const bests = emptyBests();
    for (const e of hist) {
      bests.prior = bests.count;
      const found = [];
      for (const set of e.sets) {
        for (const pr of detectPRs(set, ex, bests, e.bw)) found.push({ ...pr, set });
        addToBests(bests, set, ex, e.bw);
      }
      if (found.length) {
        out.push({
          exerciseId: it.exerciseId, name: ex.name || it.exerciseId, logType: ex.logType, date: e.date, sessionId: e.sessionId,
          prs: found, prKinds: [...new Set(found.map((f) => f.kind))],
        });
      }
    }
  }
  ctx.strengthPRs = out;
  return out;
}

/** El récord de un tipo con el mejor valor de la sesión (`lower`: gana el menor, p. ej. tiempo de sprint). */
function bestPr(prs, kind, lower = false) {
  let best = null;
  for (const p of prs) {
    if (p.kind !== kind) continue;
    if (!best || (lower ? p.value < best.value - EPS : p.value > best.value + EPS)) best = p;
  }
  return best;
}

/** Texto de lo batido en una sesión de fuerza: «1RM est. 96,5 kg (85 kg × 6 @1) · peso 90 kg × 3 @2». */
export function strengthPrDetail(entry) {
  const lt = entry.logType;
  const prs = entry.prs || [];
  const setTxt = (s) => formatSet(s, lt, { kg: true });
  const parts = [];
  const e1 = bestPr(prs, 'e1rm');
  const w = bestPr(prs, 'weight');
  if (e1) parts.push(`1RM est. ${num(e1.value, 1)} kg (${setTxt(e1.set)}${lt === 'bodyweight' ? ', con tu peso' : ''})`);
  if (w && (!e1 || w.set !== e1.set)) parts.push(`peso ${setTxt(w.set)}`);
  if (!e1 && !w) {
    const r = bestPr(prs, 'reps');
    if (r) {
      const side = lt === 'unilateral' ? ' por lado' : '';
      parts.push(lt === 'bodyweight' && !r.weight ? `${num(r.value, 0)} reps${side} sin lastre` : `${num(r.value, 0)} reps${side} con ${weightLabel(lt, r.weight)}`);
    }
  }
  const t = bestPr(prs, 'time', lt === 'distance_time');
  if (t) parts.push(lt === 'distance_time' ? `${num(t.distanceM, 1)} m en ${num(t.value, 2)} s` : fmtSec(t.value));
  const hgt = bestPr(prs, 'height');
  if (hgt) parts.push(`salto de ${num(hgt.value, 1)} cm`);
  return parts.join(' · ') || 'Récord';
}

/**
 * Récords de resistencia en orden: mayor distancia por deporte, mejores tiempos de carrera (5 km, 10 km, media,
 * maratón; tiempo al ritmo medio de una carrera igual o más larga, como stats.enduranceRecords) y mayor
 * desnivel en senderismo. Solo cuenta como récord si ya había una marca anterior de ese tipo.
 */
function endurancePRs(ctx) {
  if (ctx.endurancePRs) return ctx.endurancePRs;
  const out = [];
  const state = {};
  for (const a of ctx.done) {
    const k = rawKind(a);
    const tracksElevation = ELEVATION_KINDS.includes(k);
    if (!ENDURANCE_KINDS.includes(k) && !tracksElevation) continue;
    const st = state[k] || (state[k] = { longest: null, race: {}, elev: null });
    const km = a.distanceKm > 0 ? a.distanceKm : null;
    const sec = actSec(a);
    const base = { kind: k, date: a.date, sessionId: a.id, km, sec };
    if (km != null && ENDURANCE_KINDS.includes(k)) {
      if (st.longest != null && km > st.longest + EPS) out.push({ ...base, metric: 'longest', value: km, prev: st.longest });
      if (st.longest == null || km > st.longest) st.longest = km;
      if (k === 'run' && sec > 0) {
        for (const r of RACE_DISTANCES) {
          if (km + EPS < r.km) continue;
          const t = (sec * r.km) / km;
          const prev = st.race[r.id];
          if (prev != null && t < prev - EPS) {
            out.push({ ...base, metric: r.id, value: t, prev, raceLabel: r.label, raceKm: r.km, paceSec: sec / km, estimated: km > r.km * ESTIMATE_FACTOR });
          }
          if (prev == null || t < prev) st.race[r.id] = t;
        }
      }
    }
    if (tracksElevation && a.elevationM > 0) {
      if (st.elev != null && a.elevationM > st.elev + EPS) out.push({ ...base, metric: 'elevation', value: a.elevationM, prev: st.elev });
      if (st.elev == null || a.elevationM > st.elev) st.elev = a.elevationM;
    }
  }
  ctx.endurancePRs = out;
  return out;
}

function enduranceLabel(r) {
  const k = kindInfo(r.kind).label;
  if (r.metric === 'longest') return `${k} · mayor distancia`;
  if (r.metric === 'elevation') return `${k} · mayor desnivel`;
  return `${k} · ${r.raceLabel}`;
}
function enduranceDetail(r) {
  if (r.metric === 'longest') return `${distanceLabel(r.kind, r.value)}${r.sec > 0 ? ` en ${fmtDuration(r.sec)}` : ''}`;
  if (r.metric === 'elevation') return `+${num(r.value, 0)} m${r.km ? ` · ${distanceLabel(r.kind, r.km)}` : ''}`;
  return `${fmtDuration(r.value)} · ${fmtPace(r.paceSec)}${r.estimated ? ` · de ${distanceLabel('run', r.km)}, a ritmo medio` : ''}`;
}

const METRIC_ORDER = ['longest', ...RACE_DISTANCES.map((r) => r.id), 'elevation'];

/** Récords batidos entre `from` y `to`: uno por ejercicio (y por deporte y marca), el más reciente primero. */
function periodRecords(ctx, from, to) {
  const inRange = (e) => e.date >= from && e.date <= to;
  const out = [];
  // Fuerza: por ejercicio, la última sesión con récord de 1RM (la mejor del periodo, porque cada récord supera al
  // anterior); si no hubo, la última con récord de peso; si no, la última con cualquier récord.
  const byEx = new Map();
  for (const e of strengthPRs(ctx)) {
    if (!inRange(e)) continue;
    if (!byEx.has(e.exerciseId)) byEx.set(e.exerciseId, []);
    byEx.get(e.exerciseId).push(e);
  }
  for (const list of byEx.values()) {
    const last = (kind) => [...list].reverse().find((e) => e.prKinds.includes(kind));
    const rep = last('e1rm') || last('weight') || list[list.length - 1];
    out.push({
      type: 'strength', kind: 'strength', exerciseId: rep.exerciseId, label: rep.name, detail: strengthPrDetail(rep),
      date: rep.date, sessionId: rep.sessionId, count: list.length, prKinds: [...new Set(list.flatMap((e) => e.prKinds))],
    });
  }
  // Resistencia: por deporte y marca, la última del periodo (la mejor: cada una supera a la anterior).
  const byMetric = new Map();
  for (const r of endurancePRs(ctx)) {
    if (!inRange(r)) continue;
    const key = `${r.kind}|${r.metric}`;
    if (!byMetric.has(key)) byMetric.set(key, []);
    byMetric.get(key).push(r);
  }
  for (const list of byMetric.values()) {
    const rep = list[list.length - 1];
    out.push({
      type: 'endurance', kind: rep.kind, metric: rep.metric, label: enduranceLabel(rep), detail: enduranceDetail(rep),
      date: rep.date, sessionId: rep.sessionId, count: list.length, value: rep.value, prev: list[0].prev,
    });
  }
  const typeRank = (r) => (r.type === 'strength' ? 0 : 1 + ctx.kinds.indexOf(r.kind) + METRIC_ORDER.indexOf(r.metric) / 100);
  return out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : typeRank(a) - typeRank(b) || a.label.localeCompare(b.label, 'es')));
}

// ===========================================================================
// Ejercicios que más progresan (1RM estimado)
// ===========================================================================

/** Por ejercicio con carga × reps: sesiones con 1RM estimado [{date, e1rm, sessionId}] en orden (cacheado). */
function e1rmHistories(ctx) {
  if (ctx.e1rmHist) return ctx.e1rmHist;
  const out = [];
  for (const it of exercisesWithHistory(ctx.data)) {
    if (!LOAD_REP_TYPES.includes(it.logType)) continue;
    const list = exerciseHistory(ctx.data, it.exerciseId, { labels: false })
      .filter((e) => e.e1rm != null)
      .map((e) => ({ date: e.date, e1rm: e.e1rm, sessionId: e.sessionId }));
    if (list.length) out.push({ exerciseId: it.exerciseId, name: it.name, logType: it.logType, list });
  }
  ctx.e1rmHist = out;
  return out;
}

function topProgress(ctx, start, end, prevStart, prevEnd, max) {
  const out = [];
  for (const h of e1rmHistories(ctx)) {
    const inP = h.list.filter((e) => e.date >= start && e.date <= end);
    if (!inP.length) continue;
    let top = inP[0];
    for (const e of inP) if (e.e1rm > top.e1rm + EPS) top = e;
    const inPrev = h.list.filter((e) => e.date >= prevStart && e.date <= prevEnd);
    let ref = null;
    let basis = null;
    if (inPrev.length) { ref = inPrev[inPrev.length - 1]; basis = 'prev'; } else if (inP.length > 1) { ref = inP[0]; basis = 'first'; }
    if (!ref || ref === top) continue;
    const delta = top.e1rm - ref.e1rm;
    if (!(delta >= 0.05)) continue; // solo subidas (menos de 50 g es redondeo)
    out.push({
      exerciseId: h.exerciseId, name: h.name, logType: h.logType, from: round(ref.e1rm, 0.01), to: round(top.e1rm, 0.01),
      delta: round(delta, 0.01), pct: round((delta / ref.e1rm) * 100, 0.1), basis, fromDate: ref.date, toDate: top.date,
      sessionId: top.sessionId, sessions: inP.length,
    });
  }
  out.sort((a, b) => b.pct - a.pct || b.delta - a.delta || a.name.localeCompare(b.name, 'es'));
  return { list: out.slice(0, Math.max(0, max)), total: out.length };
}

// ===========================================================================
// Comparación
// ===========================================================================

/** { cur, prev, delta, pct }: pct null si el anterior es 0 (no hay % de «nada»). */
export function delta(cur, prev) {
  const c = Number.isFinite(cur) ? cur : 0;
  const p = Number.isFinite(prev) ? prev : 0;
  return { cur: c, prev: p, delta: round(c - p, 0.001), pct: p > 0 ? round(((c - p) / p) * 100, 0.1) : null };
}

/**
 * Dirección y texto de una diferencia, sin juicio (subir no es «bueno» ni bajar «malo»):
 *  { dir:'up'|'down'|'same'|'none', arrow:'▲'|'▼'|'='|'', text, absText, pctText, words }
 *   text   '+3 (+25 %)' · '−1 (−10 %)' · '+2 (antes 0)' · 'igual' · 'sin datos'
 *   absText '+3' (la diferencia con signo) y pctText '+25 %' por separado, para pintarlos sin partirlos por dentro
 *   words  la misma diferencia en palabras, para lectores de pantalla: «sube 3, un 25 %».
 *  fmt(v) formatea el valor absoluto de la diferencia (por defecto, entero). Si la diferencia formateada es 0 → igual.
 */
export function deltaInfo(d, fmt = (v) => num(v, 0)) {
  if (!d || (d.prev === 0 && d.cur === 0)) return { dir: 'none', arrow: '', text: 'sin datos', absText: '', pctText: '', words: 'sin datos en ninguno de los dos' };
  const absTxt = fmt(Math.abs(d.delta));
  if (Math.abs(d.delta) < EPS || absTxt === fmt(0)) return { dir: 'same', arrow: '=', text: 'igual', absText: '', pctText: '', words: 'igual' };
  const dir = d.delta > 0 ? 'up' : 'down';
  const sign = dir === 'up' ? '+' : '−';
  const verb = dir === 'up' ? 'sube' : 'baja';
  if (d.pct == null) {
    return { dir, arrow: '▲', text: `${sign}${absTxt} (antes 0)`, absText: `${sign}${absTxt}`, pctText: '', words: `${verb} ${absTxt}, antes 0` };
  }
  const a = Math.abs(d.pct);
  const pctAbs = num(a, a < 1 ? 1 : 0);
  const pctText = `${sign}${pctAbs} %`;
  return { dir, arrow: dir === 'up' ? '▲' : '▼', text: `${sign}${absTxt} (${pctText})`, absText: `${sign}${absTxt}`, pctText, words: `${verb} ${absTxt}, un ${pctAbs} %` };
}

function compareBlock(ctx, cur, prev) {
  const m = {
    sessions: delta(cur.sessions, prev.sessions),
    days: delta(cur.days, prev.days),
    minutes: delta(cur.minutes, prev.minutes),
    load: delta(cur.load, prev.load),
    strengthSessions: delta(cur.strength.sessions, prev.strength.sessions),
    volume: delta(cur.strength.volume, prev.strength.volume),
    workSets: delta(cur.strength.workSets, prev.strength.workSets),
  };
  const kinds = {};
  for (const k of ctx.kinds) {
    const a = cur.byKind[k];
    const b = prev.byKind[k];
    if (!a.count && !b.count) continue;
    kinds[k] = {
      count: delta(a.count, b.count),
      minutes: delta(a.minutes, b.minutes),
      load: delta(a.load, b.load),
      km: a.km > 0 || b.km > 0 ? delta(a.km, b.km) : null,
    };
  }
  return { ...m, kinds };
}

/** Texto de la comparación: «Frente al mismo tramo de agosto (1–26 ago)», «Frente a 2025», … */
export function compareLabel(sum) {
  const c = sum && sum.compare;
  if (!c) return '';
  const u = sum.unit;
  if (u === 'week') {
    return c.partial ? `Frente a la semana anterior hasta el ${DAY_LONG[dow(c.end)]}` : 'Frente a la semana anterior';
  }
  if (u === 'year') {
    const y = c.start.slice(0, 4);
    return c.partial ? `Frente a ${y} hasta el ${fmtDate(c.end, 'day')}` : `Frente a ${y}`;
  }
  const mName = MONTH_LONG[+c.start.slice(5, 7) - 1];
  const withYear = c.start.slice(0, 4) !== sum.start.slice(0, 4) ? ` de ${c.start.slice(0, 4)}` : '';
  if (!c.partial) return `Frente a ${mName}${withYear}`;
  const d1 = +c.start.slice(8, 10);
  const d2 = +c.end.slice(8, 10);
  return `Frente al mismo tramo de ${mName}${withYear} (${d1 === d2 ? d1 : `${d1}–${d2}`} ${MONTH_SHORT[+c.start.slice(5, 7) - 1]})`;
}

// ===========================================================================
// Punto de entrada
// ===========================================================================

/**
 * Resumen de una semana, un mes o un año.
 * @param {object} data  entrada común de stats.js (progress-ui.dataFromStore); data.today fija «hoy»
 * @param {{unit?:'week'|'month'|'year', start?:string, today?:string, maxProgress?:number}} [opts]
 *   start: cualquier fecha del periodo (por defecto, hoy); se normaliza al primer día.
 * @returns {{
 *   unit, start, end, prevStart, prevEnd, title, name, today, inProgress, future, daysTotal, daysElapsed, daysLeft,
 *   hasHistory, firstDate, lastDate, beforeHistory, empty, lastBefore, nextAfter,
 *   nav:{ prev:string|null, next:string|null, current:string },          // primer día del periodo anterior/siguiente
 *   sessions, days, minutes, load, noLoad, kinds:string[],               // kinds: tipos con sesiones en el periodo
 *   kindOrder:string[],                                                  // todos los tipos (seed + datos, 'other' al final)
 *   byKind:{ [kind]: { count, minutes, km, load, noLoad, elevationM } }, // todos los tipos (ceros incluidos)
 *   strength:{ sessions, volume, workSets, muscleSets:{[muscleId]:n}, weeks,
 *              muscles:[{ muscleId, name, sets, perWeek, target:[min,max]|null }] },   // de más a menos series
 *   trainedDates:[{ date, kinds }],
 *   records:[{ type:'strength'|'endurance', kind, label, detail, date, sessionId, count, exerciseId?, metric?, prKinds? }],
 *   topProgress:[{ exerciseId, name, logType, from, to, delta, pct, basis:'prev'|'first', fromDate, toDate, sessionId, sessions }],
 *   progressTotal,
 *   compare:{ available, partial, start, end, label, sessions, days, minutes, load, strengthSessions, volume, workSets,
 *             kinds:{ [kind]: { count, minutes, load, km|null } }, prevTotals:{ sessions, days, minutes, load, volume, workSets } },
 *   months?:[{ start, end, label, title, inProgress, future, sessions, days, minutes, load, byKind }]   // solo en el año
 * }}
 *  Cada diferencia es { cur, prev, delta, pct } (pct null si el anterior es 0).
 */
export function periodSummary(data, { unit = 'month', start = null, today = null, maxProgress = 5 } = {}) {
  const ctx = context(data);
  const u = UNITS.includes(unit) ? unit : 'month';
  const td = isDateStr(today) ? today : isDateStr(ctx.data.today) ? ctx.data.today : todayStr();
  const s0 = periodStart(u, isDateStr(start) ? start : td);
  const e0 = periodEnd(u, s0);
  const prevStart = shiftPeriod(u, s0, -1);
  const prevEnd = addDays(s0, -1);
  const current = periodStart(u, td);
  const inProgress = s0 <= td && td <= e0;
  const future = s0 > td;
  const daysTotal = diffDays(s0, e0) + 1;
  const daysElapsed = future ? 0 : diffDays(s0, inProgress ? td : e0) + 1;
  const daysLeft = inProgress ? diffDays(td, e0) + 1 : 0;

  const cur = aggregate(ctx, s0, e0);
  const weeks = Math.max(1, daysElapsed / 7);
  const muscleIds = MUSCLES.map((m) => m.id);
  for (const mu of Object.keys(cur.strength.muscleSets)) if (!muscleIds.includes(mu)) muscleIds.push(mu);
  const muscles = muscleIds
    .map((id) => ({ muscleId: id, name: MUSCLE_LABEL[id] || id, sets: cur.strength.muscleSets[id] || 0 }))
    .filter((m) => m.sets > 0)
    .map((m) => ({ ...m, perWeek: round(m.sets / weeks, 0.1), target: muscleTarget(ctx.settings, m.muscleId) }))
    .sort((a, b) => b.sets - a.sets || muscleIds.indexOf(a.muscleId) - muscleIds.indexOf(b.muscleId));

  // Comparación: el periodo anterior entero o, en curso, el mismo tramo (el último día ya cuenta como entero).
  const cmpEnd = inProgress && td < e0 ? minDate(sameDayBefore(u, td), prevEnd) : prevEnd;
  const cmp = aggregate(ctx, prevStart, cmpEnd);
  const full = cmpEnd === prevEnd ? cmp : aggregate(ctx, prevStart, prevEnd);
  const compare = {
    available: !!ctx.firstDate && ctx.firstDate <= cmpEnd && !future,
    partial: cmpEnd !== prevEnd,
    start: prevStart,
    end: cmpEnd,
    ...compareBlock(ctx, cur, cmp),
    prevTotals: { sessions: full.sessions, days: full.days, minutes: full.minutes, load: full.load, volume: full.strength.volume, workSets: full.strength.workSets },
  };

  const prog = topProgress(ctx, s0, e0, prevStart, prevEnd, maxProgress);
  const iStart = lowerBound(ctx.done, s0);
  const lastBefore = iStart > 0 ? ctx.done[iStart - 1].date : null;
  const iAfter = lowerBound(ctx.done, addDays(e0, 1));
  const nextAfter = iAfter < ctx.done.length ? ctx.done[iAfter].date : null;
  const firstPeriod = ctx.firstDate ? periodStart(u, ctx.firstDate) : null;

  const out = {
    unit: u, start: s0, end: e0, prevStart, prevEnd, title: periodTitle(u, s0), name: periodName(u, s0), today: td,
    inProgress, future, daysTotal, daysElapsed, daysLeft,
    hasHistory: !!ctx.firstDate, firstDate: ctx.firstDate, lastDate: ctx.lastDate,
    beforeHistory: !!ctx.firstDate && e0 < ctx.firstDate,
    empty: cur.sessions === 0, lastBefore, nextAfter,
    nav: {
      prev: firstPeriod && s0 > firstPeriod ? prevStart : null,
      next: s0 < current ? shiftPeriod(u, s0, 1) : null,
      current,
    },
    sessions: cur.sessions, days: cur.days, minutes: cur.minutes, load: cur.load, noLoad: cur.noLoad,
    kinds: ctx.kinds.filter((k) => cur.byKind[k].count > 0),
    kindOrder: [...ctx.kinds],
    byKind: cur.byKind,
    strength: { ...cur.strength, weeks: round(weeks, 0.01), muscles },
    trainedDates: cur.trainedDates,
    records: periodRecords(ctx, s0, e0),
    topProgress: prog.list,
    progressTotal: prog.total,
    compare,
  };
  out.compare.label = compareLabel(out);
  if (u === 'year') {
    out.months = Array.from({ length: 12 }, (_, i) => {
      const ms = `${s0.slice(0, 4)}-${pad2(i + 1)}-01`;
      const me = periodEnd('month', ms);
      const a = aggregate(ctx, ms, me);
      return {
        start: ms, end: me, label: MONTH_SHORT[i], title: cap(MONTH_LONG[i]), inProgress: ms <= td && td <= me, future: ms > td,
        sessions: a.sessions, days: a.days, minutes: a.minutes, load: a.load, byKind: a.byKind,
      };
    });
  }
  return out;
}
