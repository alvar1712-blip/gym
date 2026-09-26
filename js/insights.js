// insights.js — Fase 3: panel semanal. INFORMACIÓN primero y SUGERENCIAS después; cada mensaje lleva su
// «¿Por qué?» (la regla con los umbrales actuales y la lista de datos concretos que lo generan).
// PROPIETARIO: módulo del panel. PURO: no lee el store ni toca el DOM; recibe `data` por parámetro y se prueba
// en Node (tests/unit/insights.test.mjs). Los números salen de stats.js y calc.js: aquí no se duplican cálculos
// (series por músculo = stats.muscleTable, carga y km = stats.weeklySeries, 1RM por sesión = stats.exerciseHistory,
// contribución de cada ejercicio = calc.muscleContrib / calc.workSetCount, RIR = calc.rirValue).
//
// ENTRADA `data` (la de stats.js más los check-ins; ver progress-ui.dataFromStore):
//   { sessions, exercises: Map, templates: Map, plan: Map, settings, bodyweight, checkins: [...], today }
//   checkins: store 'checkins' { id, date, timing:'pre'|'post', sessionId, sleep, energy, soreness } (1 bajo,
//   2 normal, 3 alto). Solo son contexto: un mensaje de información «Check-ins de la semana» y la condición (c)
//   de la sugerencia de descarga (ninguna otra regla depende de ellos).
//
// SALIDA de weeklyInsights(data, weekStart):
//   { week, weekEnd, today, ref, inProgress, future, daysLeft, hasHistory, beforeHistory, firstDate,
//     info: Message[], suggestions: Message[] }
//   Message = { id, section: 'info'|'suggestion', level: 'neutral'|'good'|'warn', tag?, title, text,
//               why: { rule, data: [{ label, value, sub? }] }, items?: [{ label, value, … }] }
//   - why es OBLIGATORIO en todos los mensajes (rule y data nunca vacíos). data[].sub = fila de detalle de la
//     fila anterior (p. ej. las series de un ejercicio). tag = texto corto opcional para la etiqueta de nivel.
//   - Todos los umbrales salen de `settings` (Ajustes › Umbrales); si falta alguno, el de defaultSettings().
import { weekStart, addDays, diffDays, todayStr, isDateStr, fmtDate, fmtPct, fmtWeekRange } from './util.js';
import { isWorkSet, rirValue, muscleContrib, workSetCount, setMetrics } from './calc.js';
import {
  weeklySeries, muscleTable, exerciseHistory, exercisesWithHistory, dataRange, fmtMetric, fmtNumFast, weightLabel, KINDS,
} from './stats.js';
import { PATTERNS, PATTERN_LABEL, SET_TYPE_LABEL, defaultSettings } from './seed.js';
import { formatSet, targetText, LOAD_REP_TYPES } from './session-logic.js';
import { joinList } from './activity-logic.js';
import { checkinsBetween, isLowCheckin, valueText, FIELD_KEYS, summary as checkinSummary } from './checkin-logic.js';

// ===========================================================================
// Constantes y formato
// ===========================================================================

export const LEVELS = ['neutral', 'good', 'warn'];
/** Texto de cada nivel (la vista lo muestra junto al color: nunca solo color). */
export const LEVEL_LABEL = { neutral: 'Info', good: 'Bien', warn: 'Atención' };
/** Mínimo de sesiones de un ejercicio para valorar si progresa, se mantiene o se estanca (docs/FASE3.md). */
export const MIN_SESSIONS = 3;
/** Mínimo de sesiones con esfuerzo registrado para hablar de «esfuerzo alto sostenido» en la descarga. */
export const MIN_RPE_SESSIONS = 2;

const EPS = 1e-9;
const KIND_LABEL = { strength: 'Fuerza', run: 'Carrera', bike: 'Bici', swim: 'Natación', other: 'Otras' };
const SPORTS = ['run', 'bike', 'swim'];
const SPORT_LABEL = { run: 'Carrera', bike: 'Bici', swim: 'Natación' };
const GROUP_OF = Object.fromEntries(PATTERNS.map((p) => [p.id, p.group]));
const PUSH_PATTERNS = PATTERNS.filter((p) => p.group === 'push');
const PULL_PATTERNS = PATTERNS.filter((p) => p.group === 'pull');
const LEG_PATTERNS = PATTERNS.filter((p) => p.group === 'legs').map((p) => p.id);

const num = fmtNumFast;
const n1 = (v) => num(v, 1);
const n2 = (v) => num(v, 2);
const kg = (v) => `${num(v, 2)} kg`;
const kg1 = (v) => `${num(v, 1)} kg`;
const setsTxt = (v) => fmtMetric('sets', v);
const loadTxt = (v) => fmtMetric('load', v);
const distTxt = (kind, v) => fmtMetric(`km.${kind}`, v);
const pctTxt = (p) => fmtPct(p, 0);
const signedTxt = (d) => (Math.abs(d) < 0.05 ? '=' : d > 0 ? `+${n1(d)}` : `−${n1(-d)}`);
const rangeTxt = (min, max) => (min == null && max == null ? '—' : `${n1(min ?? 0)}–${n1(max ?? min)}`);
const day = (date) => fmtDate(date, 'day'); // «23 sep»
/** Tramo de fechas: «11–24 sep» o «31 ago – 13 sep». */
function spanTxt(a, b) {
  const [da, ma] = day(a).split(' ');
  const [db, mb] = day(b).split(' ');
  return ma === mb ? `${da}–${db} ${mb}` : `${day(a)} – ${day(b)}`;
}
/** «4 días (hoy incluido)» / «1 día (hoy)». */
const daysTxt = (n) => (n === 1 ? '1 día (hoy)' : `${n} días (hoy incluido)`);
/** Lo mismo sin paréntesis, para ir dentro de otro paréntesis: «4 días, hoy incluido» / «1 día, hoy». */
const daysIn = (n) => (n === 1 ? '1 día, hoy' : `${n} días, hoy incluido`);
/** «la última semana» / «las últimas 3 semanas» (W = 1 no dice «las últimas 1 semanas»). */
const lastWeeksTxt = (w) => (w === 1 ? 'la última semana' : `las últimas ${num(w, 0)} semanas`);
/** «la semana anterior» / «las 3 semanas anteriores». */
const prevWeeksTxt = (w) => (w === 1 ? 'la semana anterior' : `las ${num(w, 0)} semanas anteriores`);
/** «su última sesión» / «sus últimas 3 sesiones». */
const lastSessionsTxt = (n) => (n === 1 ? 'su última sesión' : `sus últimas ${num(n, 0)} sesiones`);
/** «la sesión anterior» / «las 3 sesiones anteriores». */
const prevSessionsTxt = (n) => (n === 1 ? 'la sesión anterior' : `las ${num(n, 0)} sesiones anteriores`);
const pctChange = (cur, base) => (base > 0 ? ((cur - base) / base) * 100 : null);
const cumple = (ok) => (ok ? 'se cumple' : 'no se cumple');
const plural = (n, one, many) => `${num(n, 0)} ${n === 1 ? one : many}`;
const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);
const toMap = (x) => {
  if (x instanceof Map) return x;
  if (Array.isArray(x)) return new Map(x.filter(Boolean).map((o) => [o.id, o]));
  return new Map(Object.entries(x || {}));
};
/** Lista corta de nombres: «A, B y C» o «A, B, C y 3 más». */
function shortList(names, max = 4) {
  if (names.length <= max) return joinList(names);
  return `${names.slice(0, max).join(', ')} y ${names.length - max} más`;
}

/** Mensaje con why obligatorio (si no hay datos se dice explícitamente, nunca queda vacío). */
function msg(section, id, level, { title, text, rule, data, items = null, tag = null, ...extra }) {
  const rows = (data || []).filter(Boolean);
  const m = {
    id, section, level, title, text,
    why: { rule, data: rows.length ? rows : [{ label: 'Datos', value: 'Sin datos en el periodo' }] },
  };
  if (tag) m.tag = tag;
  if (items && items.length) m.items = items;
  return Object.assign(m, extra);
}
const info = (id, level, o) => msg('info', id, level, o);
const sugg = (id, level, o) => msg('suggestion', id, level, o);

// ===========================================================================
// Ajustes (umbrales con valores por defecto)
// ===========================================================================

function cfgOf(settings) {
  const d = defaultSettings();
  const s = settings || {};
  const obj = (k) => ({ ...d[k], ...(s[k] && typeof s[k] === 'object' ? s[k] : {}) });
  const nOr = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  return {
    primaryFactor: nOr(s.primaryFactor, d.primaryFactor),
    secondaryFactor: nOr(s.secondaryFactor, d.secondaryFactor),
    increments: obj('increments'),
    progression: obj('progression'),
    loadWarn: obj('loadWarn'),
    runKmWarn: obj('runKmWarn'),
    stall: obj('stall'),
    deload: obj('deload'),
  };
}

// ===========================================================================
// Punto de entrada
// ===========================================================================

/**
 * Panel de una semana (lunes a domingo).
 * @param {object} data  entrada común (ver arriba); data.today fija «hoy» ('YYYY-MM-DD')
 * @param {string} [weekArg] cualquier fecha de la semana (por defecto, la de hoy)
 * @returns {{week, weekEnd, today, ref, inProgress, future, daysLeft, hasHistory, beforeHistory, firstDate,
 *   info: object[], suggestions: object[]}}
 *  - inProgress: es la semana de hoy; daysLeft = días que quedan contando hoy (jueves → 4).
 *  - ref: último día con datos que cuentan (hoy en la semana en curso; el domingo en las pasadas).
 *  - future / beforeHistory / !hasHistory → info y suggestions vacíos (la vista muestra su estado vacío).
 */
export function weeklyInsights(data, weekArg = null) {
  const d = data || {};
  const today = isDateStr(d.today) ? d.today : todayStr();
  const curWeek = weekStart(today);
  const week = weekStart(isDateStr(weekArg) ? weekArg : today);
  const weekEnd = addDays(week, 6);
  const inProgress = week === curWeek;
  const future = week > curWeek;
  const ref = inProgress ? today : weekEnd;
  const daysLeft = inProgress ? diffDays(today, weekEnd) + 1 : 0;
  const firstDate = dataRange(d).firstSession;
  const out = {
    week, weekEnd, today, ref, inProgress, future, daysLeft,
    hasHistory: !!firstDate, beforeHistory: false, firstDate, info: [], suggestions: [],
  };
  if (!firstDate || future) return out;
  if (firstDate > ref) { out.beforeHistory = true; return out; }

  const ctx = makeCtx(d, { week, weekEnd, ref, inProgress, daysLeft, firstDate });
  out.info = [
    ...muscleMessages(ctx),
    pushPullMessage(ctx),
    loadMessage(ctx),
    kmMessage(ctx),
    ...progressMessages(ctx),
    checkinMessage(ctx),
  ].filter(Boolean);
  out.suggestions = [
    ...doubleProgressionMessages(ctx),
    ...loadWarningMessages(ctx),
    deloadMessage(ctx),
  ].filter(Boolean);
  return out;
}

function makeCtx(d, { week, weekEnd, ref, inProgress, daysLeft, firstDate }) {
  const settings = d.settings || {};
  const sessions = toArr(d.sessions).filter((s) => s && s.status === 'done' && isDateStr(s.date));
  // 4 semanas previas + esta (stats.weeklySeries: todas las semanas, las vacías con ceros).
  const rows = weeklySeries(d, addDays(week, -28), week);
  const firstWeek = weekStart(firstDate);
  return {
    d, settings, cfg: cfgOf(settings), exMap: toMap(d.exercises), sessions,
    byId: new Map(sessions.map((s) => [s.id, s])),
    week, weekEnd, prevWeek: addDays(week, -7), ref, inProgress, daysLeft,
    cur: rows[rows.length - 1],
    prev: rows[rows.length - 2],
    // Semanas previas que cuentan para la media: las 4 anteriores, sin las de antes del primer registro.
    prevRows: rows.slice(0, -1).filter((r) => r.week >= firstWeek),
    hasStrength: sessions.some((s) => s.kind === 'strength' && s.date <= ref),
    // ¿Hay semana anterior con la que comparar? (no en la primera semana con registros)
    hasPrev: addDays(week, -7) >= firstWeek,
    memo: {},
  };
}

// ===========================================================================
// INFORMACIÓN 1–2 · Series efectivas por músculo
// ===========================================================================

const STATUS_TXT = { below: 'Por debajo', in: 'Dentro', above: 'Por encima', none: 'Sin rango' };

/** Aportación de cada ejercicio a cada músculo en la semana: Map(muscleId → [{exerciseId, name, sets, factor, value}]). */
function muscleBreakdown(ctx) {
  const out = new Map();
  for (const s of ctx.sessions) {
    if (s.kind !== 'strength' || s.date < ctx.week || s.date > ctx.weekEnd) continue;
    for (const se of s.exercises || []) {
      const ex = ctx.exMap.get(se.exerciseId);
      if (!ex) continue;
      const n = workSetCount(se);
      if (!n) continue;
      for (const [m, f] of Object.entries(muscleContrib(ex, ctx.settings))) {
        if (!(f > 0)) continue;
        if (!out.has(m)) out.set(m, new Map());
        const byEx = out.get(m);
        const e = byEx.get(ex.id) || { exerciseId: ex.id, name: ex.name || ex.id, sets: 0, factor: f, secondary: !(ex.primary || []).includes(m) };
        e.sets += n;
        byEx.set(ex.id, e);
      }
    }
  }
  const res = new Map();
  for (const [m, byEx] of out) {
    res.set(m, [...byEx.values()].map((e) => ({ ...e, value: e.sets * e.factor })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'es')));
  }
  return res;
}

function muscleRows(ctx) {
  if (ctx.memo.muscles) return ctx.memo.muscles;
  const rows = muscleTable(ctx.d, ctx.week).map((r) => {
    const delta = r.sets - r.prevSets;
    const pending = ctx.inProgress && r.status === 'below';
    const missing = r.status === 'below' ? r.min - r.sets : 0;
    return {
      muscleId: r.muscleId, name: r.name, sets: r.sets, prevSets: r.prevSets, delta, min: r.min, max: r.max,
      status: r.status, pending, missing, excess: r.status === 'above' ? r.sets - r.max : 0,
      prevStatus: r.target && ctx.hasPrev ? (r.prevSets < r.min - EPS ? 'below' : r.prevSets > r.max + EPS ? 'above' : 'in') : 'none',
      hasPrev: ctx.hasPrev,
      label: r.name,
      value: r.target ? `${n1(r.sets)} / ${rangeTxt(r.min, r.max)}` : n1(r.sets),
      range: r.target ? rangeTxt(r.min, r.max) : null,
      statusLabel: pending ? `Faltan ${n1(missing)}` : STATUS_TXT[r.status],
      deltaLabel: ctx.hasPrev ? signedTxt(delta) : '—',
    };
  });
  ctx.memo.muscles = rows;
  return rows;
}

function factorRule(ctx) {
  return `Cada serie efectiva (sin calentamientos ni series sin confirmar) suma ${n2(ctx.cfg.primaryFactor)} al músculo principal del ejercicio y ${n2(ctx.cfg.secondaryFactor)} a cada secundario (Ajustes › Umbrales › Valor de cada serie).`;
}

/** «semana anterior 12 (−3)»; en curso sin Δ (una semana a medias frente a una entera); sin semana anterior: «sin registros». */
function prevSetsTxt(ctx, r) {
  if (!ctx.hasPrev) return 'semana anterior sin registros';
  return `semana anterior ${n1(r.prevSets)}${ctx.inProgress ? '' : ` (${r.deltaLabel})`}`;
}

function muscleWhyRows(ctx, list, breakdown) {
  const rows = [];
  for (const r of list) {
    rows.push({ label: r.name, value: `${setsTxt(r.sets)} · rango ${r.range ?? '—'} · ${prevSetsTxt(ctx, r)}` });
    const parts = breakdown.get(r.muscleId) || [];
    if (!parts.length) rows.push({ label: 'Sin series esta semana', value: '0', sub: true });
    for (const p of parts) {
      rows.push({ label: `${p.name}${p.secondary ? ' (secundario)' : ''}`, value: `${plural(p.sets, 'serie', 'series')} × ${n2(p.factor)} = ${n1(p.value)}`, sub: true });
    }
  }
  return rows;
}

function muscleMessages(ctx) {
  const rows = muscleRows(ctx);
  const withT = rows.filter((r) => r.status !== 'none');
  const below = rows.filter((r) => r.status === 'below');
  const above = rows.filter((r) => r.status === 'above');
  const nIn = withT.length - below.length - above.length;
  const total = ctx.cur.workSets;
  const prevTotalTxt = ctx.hasPrev ? `semana anterior: ${num(ctx.prev.workSets, 0)}` : 'primera semana con registros';
  const pending = ctx.inProgress ? ` La semana está en curso (quedan ${daysIn(ctx.daysLeft)}): lo que aún no llega al mínimo se puede completar.` : '';
  const effTxt = `${num(total, 1)} ${total === 1 ? 'serie efectiva' : 'series efectivas'}`;
  const out = [];

  // 1 · Tabla de todos los músculos frente a su rango.
  out.push(info('muscles', !below.length && !above.length ? 'good' : 'neutral', {
    title: 'Series efectivas por músculo',
    text: ctx.inProgress
      ? `Semana en curso, a falta de ${daysTxt(ctx.daysLeft)}: ${nIn} de ${withT.length} músculos ya dentro de su rango, ${above.length} por encima y ${below.length} aún sin llegar al mínimo. Llevas ${effTxt} (${prevTotalTxt}).`
      : `${nIn} de ${withT.length} músculos dentro de su rango, ${below.length} por debajo y ${above.length} por encima. ${effTxt} de fuerza (${prevTotalTxt}).`,
    rule: `${factorRule(ctx)} El rango de cada músculo es el de Ajustes › Umbrales › Series semanales por músculo; Δ es la diferencia con la semana anterior.${pending}`,
    data: rows.map((r) => ({ label: r.name, value: `${setsTxt(r.sets)} · rango ${r.range ?? 'sin rango'} · ${prevSetsTxt(ctx, r)}` })),
    items: rows,
    inProgress: ctx.inProgress,
  }));

  if (!below.length && !above.length) return out;
  const breakdown = muscleBreakdown(ctx);

  // 2a · Por debajo (semana en curso: «aún sin llegar al mínimo», sin darlo por malo).
  if (below.length) {
    const alsoPrev = below.filter((r) => r.prevStatus === 'below');
    const one = below.length === 1 ? below[0] : null;
    const prevNote = alsoPrev.length === below.length
      ? (below.length === 1 ? ' También estaba por debajo la semana anterior.' : ' Todos estaban también por debajo la semana anterior.')
      : alsoPrev.length ? ` ${alsoPrev.length === 1 ? `${alsoPrev[0].name} ya estaba` : `${alsoPrev.length} ya estaban`} por debajo la semana anterior.` : '';
    const base = {
      rule: `Un músculo está por debajo si sus series efectivas de la semana no llegan al mínimo de su rango (Ajustes › Umbrales › Series semanales por músculo). ${factorRule(ctx)}${ctx.inProgress ? ` La semana no ha terminado (quedan ${daysIn(ctx.daysLeft)}): es un recuento provisional, no un resultado.` : ''}`,
      data: muscleWhyRows(ctx, below, breakdown),
      items: below.map((r) => ({ ...r, value: `${n1(r.sets)} / ${r.range} · faltan ${n1(r.missing)}${ctx.hasPrev ? ` · sem. ant. ${n1(r.prevSets)}` : ''}` })),
    };
    if (ctx.inProgress) {
      out.push(info('muscles-below', 'neutral', {
        ...base,
        tag: 'En curso',
        title: one ? `${one.name}: aún por debajo del mínimo` : `${below.length} músculos aún por debajo del mínimo`,
        text: one
          ? `Llevas ${setsTxt(one.sets)} de un mínimo de ${n1(one.min)} (faltan ${n1(one.missing)}); quedan ${daysTxt(ctx.daysLeft)}.`
          : `A falta de ${daysTxt(ctx.daysLeft)}, aún no llegan al mínimo: ${shortList(below.map((r) => `${r.name} (faltan ${n1(r.missing)})`))}. Se puede completar en lo que queda de semana.`,
      }));
    } else {
      out.push(info('muscles-below', 'warn', {
        ...base,
        tag: 'Por debajo',
        title: one ? `${one.name} por debajo del rango` : `${below.length} músculos por debajo del rango`,
        text: one
          ? `${setsTxt(one.sets)} esta semana; tu rango es ${one.range}. ${ctx.hasPrev ? `Semana anterior: ${n1(one.prevSets)} (${one.deltaLabel}).` : 'Es la primera semana con registros.'}`
          : `No llegaron al mínimo: ${shortList(below.map((r) => `${r.name} (${n1(r.sets)} de ${n1(r.min)})`))}.${prevNote}`,
      }));
    }
  }

  // 2b · Por encima (ya es definitivo aunque la semana siga en curso: las series no bajan).
  if (above.length) {
    const one = above.length === 1 ? above[0] : null;
    out.push(info('muscles-above', 'warn', {
      tag: 'Por encima',
      title: one ? `${one.name} por encima del rango` : `${above.length} músculos por encima del rango`,
      text: one
        ? `${setsTxt(one.sets)} esta semana; tu máximo es ${n1(one.max)}. ${ctx.hasPrev ? `Semana anterior: ${n1(one.prevSets)}${ctx.inProgress ? '' : ` (${one.deltaLabel})`}.` : 'Es la primera semana con registros.'}`
        : `Superan el máximo de su rango: ${shortList(above.map((r) => `${r.name} (${n1(r.sets)} de ${n1(r.max)})`))}.${ctx.inProgress ? ` Quedan ${daysTxt(ctx.daysLeft)}.` : ''}`,
      rule: `Un músculo está por encima si sus series efectivas de la semana superan el máximo de su rango (Ajustes › Umbrales › Series semanales por músculo). ${factorRule(ctx)}`,
      data: muscleWhyRows(ctx, above, breakdown),
      items: above.map((r) => ({ ...r, value: `${n1(r.sets)} / ${r.range} · sobran ${n1(r.excess)}${ctx.hasPrev ? ` · sem. ant. ${n1(r.prevSets)}` : ''}` })),
    }));
  }
  return out;
}

// ===========================================================================
// INFORMACIÓN 3 · Equilibrio empuje / tirón
// ===========================================================================

/** Series efectivas por patrón de empuje/tirón en la semana `ws` (cada serie cuenta 1). */
function pushPullOf(ctx, ws) {
  const we = addDays(ws, 6);
  const byEx = new Map();
  let push = 0;
  let pull = 0;
  for (const s of ctx.sessions) {
    if (s.kind !== 'strength' || s.date < ws || s.date > we) continue;
    for (const se of s.exercises || []) {
      const ex = ctx.exMap.get(se.exerciseId);
      const group = ex ? GROUP_OF[ex.pattern] : null;
      if (group !== 'push' && group !== 'pull') continue;
      const n = workSetCount(se);
      if (!n) continue;
      if (group === 'push') push += n;
      else pull += n;
      const e = byEx.get(ex.id) || { exerciseId: ex.id, name: ex.name || ex.id, group, pattern: ex.pattern, sets: 0 };
      e.sets += n;
      byEx.set(ex.id, e);
    }
  }
  const list = [...byEx.values()].sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name, 'es'));
  return { push, pull, list };
}

function pushPullMessage(ctx) {
  const c = pushPullOf(ctx, ctx.week);
  const p = pushPullOf(ctx, ctx.prevWeek);
  if (!ctx.hasStrength) return null;
  const prevTxt = ctx.hasPrev ? `semana anterior: ${num(p.pull, 0)} de tirón y ${num(p.push, 0)} de empuje` : 'primera semana con registros';
  const labels = (list) => joinList(list.map((x) => x.label.toLowerCase()));
  const rule = `Se cuentan las series efectivas de cada ejercicio según su patrón de movimiento (ficha del ejercicio): empuje = ${labels(PUSH_PATTERNS)}; tirón = ${labels(PULL_PATTERNS)}. Cada serie cuenta 1 (sin factor de músculo secundario). No cuentan los ejercicios con patrón de aislamiento o de core (curl, extensiones de tríceps, elevaciones laterales…); si un ejercicio de aislamiento tiene patrón de tirón o de empuje en su ficha (p. ej. el face pull, tirón horizontal), sí cuenta. Con tu prioridad de espalda, lo deseable es que los tirones igualen o superen a los empujes.`;
  const data = [{ label: 'Tirón', value: setsTxt(c.pull) }];
  for (const e of c.list.filter((x) => x.group === 'pull')) data.push({ label: `${e.name} · ${PATTERN_LABEL[e.pattern]}`, value: setsTxt(e.sets), sub: true });
  data.push({ label: 'Empuje', value: setsTxt(c.push) });
  for (const e of c.list.filter((x) => x.group === 'push')) data.push({ label: `${e.name} · ${PATTERN_LABEL[e.pattern]}`, value: setsTxt(e.sets), sub: true });
  data.push({ label: 'Semana anterior', value: ctx.hasPrev ? `tirón ${num(p.pull, 0)} · empuje ${num(p.push, 0)}` : 'sin registros' });
  const extra = { rule, data, push: c.push, pull: c.pull, prevPush: p.push, prevPull: p.pull };

  if (c.push + c.pull === 0) {
    return info('push-pull', 'neutral', {
      ...extra,
      title: 'Empuje/tirón: sin series esta semana',
      text: ctx.inProgress
        ? `Aún no hay series de empuje ni de tirón (quedan ${daysIn(ctx.daysLeft)}); ${prevTxt}.`
        : `No hubo series de empuje ni de tirón; ${prevTxt}.`,
    });
  }
  if (c.pull >= c.push) {
    return info('push-pull', 'good', {
      ...extra,
      title: c.pull === c.push ? 'Tirones igual que empujes' : 'Más tirones que empujes',
      text: `${setsTxt(c.pull)} de tirón y ${num(c.push, 0)} de empuje (${prevTxt}). Cumple lo deseable con tu prioridad de espalda: tirones ≥ empujes.`,
    });
  }
  const gap = c.push - c.pull;
  if (ctx.inProgress) {
    return info('push-pull', 'neutral', {
      ...extra,
      tag: 'En curso',
      title: 'De momento, más empujes que tirones',
      text: `Llevas ${setsTxt(c.push)} de empuje y ${num(c.pull, 0)} de tirón, a falta de ${daysTxt(ctx.daysLeft)}; para igualar harían falta ${plural(gap, 'serie', 'series')} de tirón más.`,
    });
  }
  return info('push-pull', 'warn', {
    ...extra,
    title: 'Más empujes que tirones',
    text: `${setsTxt(c.push)} de empuje y ${num(c.pull, 0)} de tirón (${prevTxt}). Con tu prioridad de espalda, lo deseable es tirones ≥ empujes: faltaron ${plural(gap, 'serie', 'series')} de tirón.`,
  });
}

// ===========================================================================
// INFORMACIÓN 4 · Carga semanal
// ===========================================================================

function loadStats(ctx) {
  if (ctx.memo.load) return ctx.memo.load;
  const { cur, prevRows } = ctx;
  const weeks = prevRows.length;
  const withData = prevRows.filter((r) => r.loadTotal > 0).length;
  const enough = withData >= 2;
  const avg = (fn) => (weeks ? prevRows.reduce((t, r) => t + fn(r), 0) / weeks : null);
  const mean = avg((r) => r.loadTotal);
  const pct = enough && mean > 0 ? pctChange(cur.loadTotal, mean) : null;
  // Por tipo, la misma regla que el total y que los km: con menos de 2 semanas previas con carga de ese tipo
  // no hay referencia (ni media ni %), aunque el total sí la tenga.
  const byKind = KINDS.map((k) => {
    const kWith = prevRows.filter((r) => r.load[k] > 0).length;
    const kEnough = kWith >= 2;
    const m = avg((r) => r.load[k]);
    return { kind: k, name: KIND_LABEL[k], value: cur.load[k], mean: m, enough: kEnough, withData: kWith, pct: kEnough && m > 0 ? pctChange(cur.load[k], m) : null };
  });
  ctx.memo.load = { total: cur.loadTotal, mean, enough, withData, weeks, pct, byKind, noLoad: cur.noLoad };
  return ctx.memo.load;
}

const weeksTxt = (n) => (n === 1 ? 'la semana previa' : `las ${n} semanas previas`);
/** «Media de las 4 semanas previas»; sin semanas previas (primera semana), «Media de semanas previas». */
const meanLabel = (n) => (n > 0 ? `Media de ${weeksTxt(n)}` : 'Media de semanas previas');
/** «sin referencia suficiente (1 semana con km)»; sin semanas previas: «aún no hay semanas previas». */
const noRefTxt = (weeks, withN, what) => (weeks > 0 ? `sin referencia suficiente (${withN === 0 ? 'ninguna semana' : withN === 1 ? '1 semana' : `${withN} semanas`} con ${what})` : 'aún no hay semanas previas');
/**
 * % de un aviso: sin decimales, salvo a menos de 1 punto de un umbral (entonces 1 decimal: «+20,3 %» y no «+20 %»
 * junto a «aviso desde +20 %»). Los avisos comparan este mismo valor redondeado a 1 decimal (warnOver).
 */
const r1 = (p) => Math.round(p * 10) / 10;
const warnPct = (p, ths, signed = true) => fmtPct(r1(p), ths.some((t) => Math.abs(p - t) < 1) ? 1 : 0, signed);
const warnOver = (p, t) => p != null && r1(p) > t + EPS;
/** % de carga / de km de carrera con el mismo formato que sus avisos (información y sugerencias coinciden). */
const lwPct = (ctx, p) => warnPct(p, [ctx.cfg.loadWarn.low, ctx.cfg.loadWarn.high]);
const kmPct = (ctx, kind, p) => (kind === 'run' ? warnPct(p, [ctx.cfg.runKmWarn.low, ctx.cfg.runKmWarn.high]) : pctTxt(p));

function loadRule() {
  return 'Carga de cada sesión = duración en minutos × esfuerzo percibido (RPE 1–10), en fuerza y en actividades. Se compara el total de la semana con la media de las 4 semanas anteriores (sin contar esta; si empezaste a registrar hace menos, las que haya). Con menos de 2 semanas previas con carga no hay referencia suficiente. Las sesiones sin esfuerzo percibido no suman carga.';
}

function loadWeekRows(ctx) {
  return ctx.prevRows.map((r) => ({ label: `Semana ${fmtWeekRange(r.week)}`, value: r.loadTotal > 0 ? loadTxt(r.loadTotal) : '0 (sin carga)', sub: true }));
}

function loadMessage(ctx) {
  const L = loadStats(ctx);
  if (!ctx.cur.sessions && !ctx.prevRows.some((r) => r.sessions > 0)) return null; // sin sesiones en estas 5 semanas
  let text;
  if (!L.total && !ctx.inProgress && L.noLoad) {
    text = `Sin carga calculable: ${plural(L.noLoad, 'sesión', 'sesiones')} sin esfuerzo percibido (RPE) o sin duración.`;
  } else if (!L.enough) {
    text = `${loadTxt(L.total)} (minutos × esfuerzo). Sin referencia suficiente: hacen falta al menos 2 semanas previas con carga (hay ${L.withData}).`;
  } else if (ctx.inProgress) {
    text = `De momento ${loadTxt(L.total)} (minutos × esfuerzo), el ${num((L.total / L.mean) * 100, 0)} % de la media de ${weeksTxt(L.weeks)} (${loadTxt(L.mean)}), a falta de ${daysTxt(ctx.daysLeft)}.`;
  } else {
    text = `${loadTxt(L.total)} (minutos × esfuerzo), ${lwPct(ctx, L.pct)} frente a la media de ${weeksTxt(L.weeks)} (${loadTxt(L.mean)}).`;
  }
  const items = L.byKind.filter((k) => k.value > 0 || k.mean > 0).map((k) => ({
    kind: k.kind, label: k.name, value: `${loadTxt(k.value)} · media ${k.enough ? loadTxt(k.mean) : 'sin ref.'}${!ctx.inProgress && k.pct != null ? ` (${pctTxt(k.pct)})` : ''}`,
    load: k.value, mean: k.enough ? k.mean : null, pct: k.pct,
  }));
  const data = [
    { label: 'Esta semana', value: `${loadTxt(L.total)}${ctx.inProgress ? ' (en curso)' : ''}` },
    ...L.byKind.filter((k) => k.value > 0).map((k) => ({ label: k.name, value: loadTxt(k.value), sub: true })),
    { label: `Semanas previas (${L.weeks})`, value: L.weeks ? `${L.withData} con carga` : 'ninguna todavía' },
    ...loadWeekRows(ctx),
    { label: 'Media de las semanas previas', value: L.enough ? loadTxt(L.mean) : 'sin referencia suficiente' },
    {
      label: ctx.inProgress ? 'De momento' : 'Variación',
      value: L.pct == null ? 'sin referencia suficiente' : ctx.inProgress ? `el ${num((L.total / L.mean) * 100, 0)} % de la media (semana en curso)` : lwPct(ctx, L.pct),
    },
    L.noLoad ? { label: 'Sesiones sin esfuerzo percibido', value: `${L.noLoad} (no suman carga)` } : null,
  ];
  return info('load', 'neutral', {
    title: 'Carga semanal', text, rule: loadRule(), data, items,
    total: L.total, mean: L.mean, pct: L.pct, enough: L.enough,
  });
}

// ===========================================================================
// INFORMACIÓN 5 · Kilómetros semanales
// ===========================================================================

function kmStats(ctx) {
  if (ctx.memo.km) return ctx.memo.km;
  const weeks = ctx.prevRows.length;
  ctx.memo.km = SPORTS.map((k) => {
    const cur = ctx.cur.km[k];
    const prev = ctx.prev.km[k];
    const withKm = ctx.prevRows.filter((r) => r.km[k] > 0).length;
    const enough = withKm >= 2;
    const mean = weeks ? ctx.prevRows.reduce((t, r) => t + r.km[k], 0) / weeks : null;
    return {
      kind: k, name: SPORT_LABEL[k], cur, prev, mean, enough, withKm, weeks,
      pctPrev: pctChange(cur, prev), pctMean: enough && mean > 0 ? pctChange(cur, mean) : null,
      any: cur > 0 || withKm > 0,
    };
  }).filter((x) => x.any);
  return ctx.memo.km;
}

function kmMessage(ctx) {
  const list = kmStats(ctx);
  if (!list.length) return null;
  const vsPrev = (x) => (!ctx.hasPrev ? 'primera semana con registros' : x.prev > 0 ? `${kmPct(ctx, x.kind, x.pctPrev)} frente a la semana anterior` : 'sin km la semana anterior');
  const text = ctx.inProgress
    ? `De momento, a falta de ${daysTxt(ctx.daysLeft)}: ${list.map((x) => `${x.name} ${distTxt(x.kind, x.cur)} (semana anterior ${distTxt(x.kind, x.prev)})`).join(' · ')}.`
    : `${list.map((x) => `${x.name} ${distTxt(x.kind, x.cur)} (${vsPrev(x)})`).join(' · ')}.`;
  const items = list.map((x) => ({
    kind: x.kind, label: x.name,
    value: `${distTxt(x.kind, x.cur)} · sem. ant. ${distTxt(x.kind, x.prev)}${!ctx.inProgress && x.prev > 0 ? ` (${kmPct(ctx, x.kind, x.pctPrev)})` : ''} · media ${x.enough ? distTxt(x.kind, x.mean) : 'sin ref.'}${!ctx.inProgress && x.pctMean != null ? ` (${pctTxt(x.pctMean)})` : ''}`,
    km: x.cur, prevKm: x.prev, meanKm: x.enough ? x.mean : null, pctPrev: x.pctPrev, pctMean: x.pctMean,
  }));
  const data = [];
  for (const x of list) {
    data.push({ label: x.name, value: `${distTxt(x.kind, x.cur)} esta semana${ctx.inProgress ? ' (en curso)' : ''}` });
    const vary = (p) => (ctx.inProgress || p == null ? '' : ` (variación ${pctTxt(p)})`);
    data.push({ label: 'Semana anterior', value: x.prev > 0 ? `${distTxt(x.kind, x.prev)}${ctx.inProgress || x.pctPrev == null ? '' : ` (variación ${kmPct(ctx, x.kind, x.pctPrev)})`}` : `${distTxt(x.kind, 0)} (sin variación calculable)`, sub: true });
    data.push({ label: meanLabel(x.weeks), value: x.enough ? `${distTxt(x.kind, x.mean)}${vary(x.pctMean)}` : noRefTxt(x.weeks, x.withKm, 'km'), sub: true });
    data.push({ label: 'Semanas previas', value: ctx.prevRows.length ? ctx.prevRows.map((r) => distTxt(x.kind, r.km[x.kind])).join(' · ') : '—', sub: true });
  }
  return info('km', 'neutral', {
    title: 'Kilómetros semanales',
    text,
    rule: 'Suma de la distancia de las actividades terminadas de la semana (también las registradas dentro de una sesión de fuerza). Se compara con la semana anterior y con la media de las 4 semanas previas (sin contar esta; con menos de 2 semanas previas con km de ese deporte no hay referencia suficiente).',
    data, items,
  });
}

// ===========================================================================
// INFORMACIÓN 6 · Ejercicios que progresan, se mantienen o se estancan
// ===========================================================================

/** Días seguidos sin un ejercicio a partir de los cuales su comparación vuelve a empezar (parón, vacaciones…). */
export const GAP_DAYS = 28;

/**
 * Mejor serie de una sesión de peso corporal por 1RM estimado con el peso corporal `bw` (calc.setMetrics):
 * { value, label } o null. Etiqueta como stats.js («+5 kg × 8 @1», «Sin lastre · 10 reps @1»).
 */
function bestAtBodyweight(sets, ex, bw) {
  let best = null;
  for (const st of sets || []) {
    if (!isWorkSet(st)) continue;
    const v = setMetrics(st, ex, bw).e1rm;
    if (v != null && (!best || v > best.value + EPS)) best = { value: v, set: st };
  }
  if (!best) return null;
  const txt = formatSet(best.set, 'bodyweight', { kg: true });
  return { value: best.value, label: best.set.weight ? txt : `Sin lastre · ${txt}` };
}

/**
 * Evalúa un tramo de sesiones frente a su referencia. Una sesión «mejora» si su 1RM estimado supera al de todas
 * las sesiones de la referencia y al de las anteriores del tramo.
 * @returns {{tramo, refs, marks:boolean[], prev:({value, entry}|null)[], improved:boolean}}
 */
function evalTramo(tramo, refs) {
  const prev = tramo.map((e, i) => {
    let best = null;
    for (const r of refs.concat(tramo.slice(0, i))) if (!best || r.e1rm > best.value) best = { value: r.e1rm, entry: r };
    return best;
  });
  const marks = tramo.map((e, i) => !!prev[i] && e.e1rm > prev[i].value + EPS);
  return { tramo, refs, marks, prev, improved: marks.some(Boolean) };
}

const maxBy = (list) => list.reduce((b, e) => (!b || e.e1rm > b.e1rm + EPS ? e : b), null);

/**
 * Clasificación de los ejercicios con 1RM estimado hasta `ctx.ref`: progress | maintain | stalled.
 * Solo ejercicios con ≥ MIN_SESSIONS sesiones con 1RM estimado y alguna en las últimas stall.weeks semanas.
 * Se compara lo reciente con lo inmediatamente anterior (referencia acotada, no el mejor de siempre):
 *  - por sesiones: las últimas S sesiones frente a las S anteriores;
 *  - por semanas: las sesiones de las últimas W semanas frente a las de las W semanas anteriores (si en esas W
 *    semanas no hubo sesiones, frente a las anteriores del propio tramo, y no se puede hablar de estancamiento).
 * Tras un parón de GAP_DAYS o más sin el ejercicio, lo de antes deja de ser referencia (vuelta de vacaciones, de
 * una lesión…: si mejora sesión a sesión, progresa, aunque siga por debajo de su nivel de antes).
 * Peso corporal: el 1RM de TODAS las sesiones se recalcula con un mismo peso corporal (el de la última sesión),
 * así que si solo cambia la báscula no hay mejora ni empeora (la idea de los récords de calc.detectPRs) y las
 * cifras del «¿Por qué?» se pueden comparar entre sí.
 * Estancado = sin mejora por sesiones (con S anteriores) o por semanas (con ≥ 2 sesiones en el tramo y alguna en
 * la referencia). Progresa = alguna mejora. Se mantiene = el resto.
 */
function classify(ctx) {
  if (ctx.memo.classes) return ctx.memo.classes;
  const S = Math.max(1, Math.round(ctx.cfg.stall.sessions));
  const W = Math.max(1, Math.round(ctx.cfg.stall.weeks));
  const from = addDays(ctx.ref, -7 * W + 1);
  const priorFrom = addDays(from, -7 * W);
  const out = [];
  for (const it of exercisesWithHistory(ctx.d)) {
    const ex = it.exercise;
    const isBw = ex.logType === 'bodyweight';
    const hist = exerciseHistory(ctx.d, it.exerciseId, { labels: false }).filter((e) => e.date <= ctx.ref && e.e1rm != null);
    if (hist.length < MIN_SESSIONS || hist[hist.length - 1].date < from) continue;
    let start = 0;
    for (let i = 1; i < hist.length; i++) if (diffDays(hist[i - 1].date, hist[i].date) >= GAP_DAYS) start = i;
    const lastH = hist[hist.length - 1];
    const bwRef = isBw && lastH.bw > 0 ? lastH.bw : null;
    const era = hist.slice(start).map((e) => {
      const o = { date: e.date, sessionId: e.sessionId, e1rm: e.e1rm, label: e.bestSetLabel };
      const b = bwRef != null ? bestAtBodyweight(e.sets, ex, bwRef) : null;
      if (b) { o.e1rm = b.value; o.label = b.label; }
      return o;
    });
    const n = era.length;
    const lastS = era.slice(-S);
    const prevS = era.slice(Math.max(0, n - 2 * S), n - lastS.length);
    const bySes = { kind: 'sessions', ...evalTramo(lastS, prevS) };
    const win = era.filter((e) => e.date >= from);
    const prior = era.filter((e) => e.date >= priorFrom && e.date < from);
    const byWk = { kind: 'weeks', ...evalTramo(win, prior) };
    // Tras un parón, con menos de MIN_SESSIONS sesiones desde entonces aún no se valora (como un ejercicio nuevo).
    const fresh = n < MIN_SESSIONS;
    const bySessions = !fresh && prevS.length > 0 && !bySes.improved;
    const byWeeks = !fresh && prior.length > 0 && win.length >= 2 && !byWk.improved;
    const status = bySessions || byWeeks ? 'stalled' : !fresh && (bySes.improved || byWk.improved) ? 'progress' : 'maintain';
    // Tramo que se enseña en el «¿Por qué?»: el que decide el estado (el más largo si deciden los dos).
    const longer = (a, b) => (a.tramo.length >= b.tramo.length ? a : b);
    let sh;
    if (status === 'stalled') sh = bySessions && byWeeks ? longer(bySes, byWk) : bySessions ? bySes : byWk;
    else if (status === 'progress') sh = bySes.improved && byWk.improved ? longer(bySes, byWk) : bySes.improved ? bySes : byWk;
    else sh = bySes;
    if (fresh) sh = { kind: 'sessions', tramo: era, refs: [], marks: era.map(() => false), prev: era.map(() => null) };
    const shown = sh.tramo.map((e, i) => ({ ...e, record: sh.marks[i] }));
    const recIdx = sh.marks.lastIndexOf(true);
    out.push({
      exerciseId: it.exerciseId, name: it.name, archived: !!it.archived, isBw: bwRef != null, bwRef, status, bySessions, byWeeks, fresh, eraSessions: n,
      sessions: hist.length, gapFrom: start > 0 ? hist[start - 1].date : null,
      refKind: sh.kind, refs: sh.refs, refBest: maxBy(sh.refs), shown,
      rec: recIdx >= 0 ? shown[recIdx] : null, recPrev: recIdx >= 0 ? sh.prev[recIdx] : null,
      best: maxBy(era), last: era[n - 1],
    });
  }
  out.sort((a, b) => (a.last.date === b.last.date ? a.name.localeCompare(b.name, 'es') : a.last.date < b.last.date ? 1 : -1));
  ctx.memo.classes = { list: out, S, W, from, priorFrom };
  return ctx.memo.classes;
}

function progressRule(S, W) {
  return `1RM estimado (Epley con repeticiones + RIR, series de 1 a 12 repeticiones) de la mejor serie de cada sesión, en ejercicios con al menos ${MIN_SESSIONS} sesiones y alguna en ${lastWeeksTxt(W)}. Se compara lo reciente con lo inmediatamente anterior: ${lastSessionsTxt(S)} con ${prevSessionsTxt(S)}, y ${lastWeeksTxt(W)} con ${prevWeeksTxt(W)}. Una sesión «mejora» si su 1RM estimado supera al de esa referencia y al de las sesiones anteriores del tramo. Progresa: alguna sesión mejora. Estancado: ninguna mejora en ${lastSessionsTxt(S)} o en ${lastWeeksTxt(W)} (con al menos 2 sesiones en ese tramo). Se mantiene: el resto (sin mejora, pero aún sin sesiones anteriores con las que comparar). Tras un parón de ${GAP_DAYS / 7} semanas o más sin el ejercicio, la comparación empieza de cero (no se compara con tu nivel de antes del parón) y hacen falta otra vez ${MIN_SESSIONS} sesiones para valorarlo. En ejercicios de peso corporal, el 1RM de todas las sesiones se calcula con el mismo peso corporal (el de tu última sesión): si solo cambia tu peso, no cuenta como mejora. Umbrales en Ajustes › Umbrales › Estancamiento.`;
}

/** «de las 3 sesiones anteriores» / «de las 3 semanas anteriores (17 ago–6 sep)». */
function refTxt(x, cls) {
  return x.refKind === 'sessions' ? prevSessionsTxt(x.refs.length) : `${prevWeeksTxt(cls.W)} (${spanTxt(cls.priorFrom, addDays(cls.from, -1))})`;
}
function classWhyRows(list, cls) {
  const rows = [];
  for (const x of list) {
    let value;
    if (x.refBest) value = `mejor de ${refTxt(x, cls)}: ${kg1(x.refBest.e1rm)} (${day(x.refBest.date)})`;
    else if (x.gapFrom) value = `sin sesiones anteriores desde el parón (último registro previo: ${day(x.gapFrom)})`;
    else value = 'sin sesiones anteriores al tramo';
    rows.push({ label: x.name, value });
    if (x.isBw) rows.push({ label: 'Peso corporal usado', value: `${kg1(x.bwRef)} en todas las sesiones (el del ${day(x.last.date)})`, sub: true });
    for (const e of x.shown) rows.push({ label: day(e.date), value: `${kg1(e.e1rm)} · ${e.label}${e.record ? ' · mejora' : ''}`, sub: true });
  }
  return rows;
}

function progressMessages(ctx) {
  if (!ctx.hasStrength) return [];
  const cls = classify(ctx);
  const { list, S, W } = cls;
  const rule = progressRule(S, W);
  if (!list.length) {
    const counts = exercisesWithHistory(ctx.d).map((it) => ({
      name: it.name, n: exerciseHistory(ctx.d, it.exerciseId, { labels: false }).filter((e) => e.date <= ctx.ref && e.e1rm != null).length,
    })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 8);
    return [info('ex-none', 'neutral', {
      title: 'Aún sin datos para valorar el progreso',
      text: `Hace falta que un ejercicio tenga al menos ${MIN_SESSIONS} sesiones con 1RM estimado y alguna en ${lastWeeksTxt(W)}.`,
      rule,
      data: counts.length ? counts.map((x) => ({ label: x.name, value: plural(x.n, 'sesión', 'sesiones') })) : [{ label: 'Ejercicios con 1RM estimado', value: 'ninguno todavía' }],
    })];
  }
  const out = [];
  const recent = `${S === 1 ? 'su última sesión' : `sus últimas ${num(S, 0)} sesiones`} o en ${lastWeeksTxt(W)}`;
  const names = (arr) => shortList(arr.map((x) => x.name));
  const item = (x) => ({
    exerciseId: x.exerciseId, label: x.name,
    value: x.status === 'progress' ? `${kg1(x.rec.e1rm)} (${day(x.rec.date)})`
      : x.status === 'stalled' ? `mejor previo ${kg1(x.refBest.e1rm)} · última ${kg1(x.last.e1rm)}`
        : `mejor ${kg1(x.best.e1rm)} · última ${kg1(x.last.e1rm)}`,
    status: x.status, best: x.best.e1rm, lastE1rm: x.last.e1rm, sessions: x.sessions,
  });
  const prog = list.filter((x) => x.status === 'progress');
  const keep = list.filter((x) => x.status === 'maintain');
  const stall = list.filter((x) => x.status === 'stalled');
  if (prog.length) {
    const one = prog.length === 1 ? prog[0] : null;
    out.push(info('ex-progress', 'good', {
      title: one ? `${one.name} progresa` : `${prog.length} ejercicios progresan`,
      text: one
        ? `Mejora su 1RM estimado: ${kg1(one.rec.e1rm)} (${day(one.rec.date)}, ${one.rec.label}), por encima de ${kg1(one.recPrev.value)} (${day(one.recPrev.entry.date)})${one.isBw ? `, con tu peso corporal de ${kg1(one.bwRef)} en todas` : ''}.`
        : `Mejoran su 1RM estimado en ${recent}: ${names(prog)}.`,
      rule, data: classWhyRows(prog, cls), items: prog.map(item),
    }));
  }
  if (keep.length) {
    const one = keep.length === 1 ? keep[0] : null;
    out.push(info('ex-maintain', 'neutral', {
      title: one ? `${one.name} se mantiene` : `${keep.length} ejercicios se mantienen`,
      text: one
        ? (one.fresh
          ? `Vuelve tras un parón (último registro previo: ${day(one.gapFrom)}): la comparación empieza de cero y, con ${plural(one.eraSessions, 'sesión', 'sesiones')} desde entonces, aún no se valora (hacen falta ${MIN_SESSIONS}).`
          : `Sin mejora del 1RM estimado (mejor: ${kg1(one.best.e1rm)}, ${day(one.best.date)}), pero aún sin sesiones suficientes para hablar de estancamiento.`)
        : keep.some((x) => x.fresh)
          ? `Aún sin sesiones suficientes para valorar si progresan o se estancan (sin mejora reciente o de vuelta tras un parón): ${names(keep)}.`
          : `Sin mejora del 1RM estimado, pero aún sin sesiones suficientes para hablar de estancamiento: ${names(keep)}.`,
      rule, data: classWhyRows(keep, cls), items: keep.map(item),
    }));
  }
  if (stall.length) {
    const one = stall.length === 1 ? stall[0] : null;
    const oneText = (x) => {
      const ref = `${kg1(x.refBest.e1rm)}, ${day(x.refBest.date)}`;
      if (x.bySessions && x.byWeeks) return `Ni en ${lastSessionsTxt(S)} ni en ${lastWeeksTxt(W)} supera su mejor 1RM estimado de antes (${ref}).`;
      if (x.bySessions) {
        const subj = S === 1 ? 'Su última sesión no supera' : `Sus últimas ${num(S, 0)} sesiones no superan`;
        return `${subj} el mejor 1RM estimado de ${prevSessionsTxt(x.refs.length)} (${ref}).`;
      }
      return `En ${lastWeeksTxt(W)} no supera el mejor 1RM estimado de ${prevWeeksTxt(W)} (${ref}).`;
    };
    out.push(info('ex-stalled', 'warn', {
      tag: 'Estancado',
      title: one ? `${one.name} estancado` : `${stall.length} ejercicios estancados`,
      text: one ? oneText(one) : `Sin mejora del 1RM estimado en ${recent}: ${names(stall)}.`,
      rule, data: classWhyRows(stall, cls), items: stall.map(item),
    }));
  }
  return out;
}

// ===========================================================================
// SUGERENCIA 1 · Doble progresión
// ===========================================================================

/**
 * Incremento de la doble progresión para un ejercicio: aislamiento/core → isolation; compuesto de tren inferior
 * (región lower, o patrón de pierna si la región no es upper) → lowerCompound; resto de compuestos → upperCompound.
 * @returns {{kind:'upperCompound'|'lowerCompound'|'isolation', kg:number, label:string, text:string}}
 *  text: «2,5 kg»; aislamiento con 1 kg → «1–2 kg».
 */
export function incrementFor(exercise, increments) {
  const inc = { ...defaultSettings().increments, ...(increments || {}) };
  const ex = exercise || {};
  const iso = ex.category === 'isolation' || ex.region === 'core' || ex.pattern === 'core' || (!ex.category && ex.pattern === 'isolation');
  let kind;
  if (iso) kind = 'isolation';
  else if (ex.region === 'lower' || (ex.region !== 'upper' && LEG_PATTERNS.includes(ex.pattern))) kind = 'lowerCompound';
  else kind = 'upperCompound';
  const v = Number(inc[kind]) || 0;
  const label = { isolation: 'aislamiento o core', lowerCompound: 'compuesto de tren inferior', upperCompound: 'compuesto de tren superior' }[kind];
  return { kind, kg: v, label, text: kind === 'isolation' && v === 1 ? '1–2 kg' : kg(v) };
}

/** Repeticiones de una serie para la doble progresión (unilateral: el lado con menos). */
function repsOf(set, logType) {
  const a = typeof set.reps === 'number' ? set.reps : null;
  if (logType !== 'unilateral') return a;
  const b = typeof set.repsR === 'number' ? set.repsR : null;
  return a != null && b != null ? Math.min(a, b) : a ?? b;
}

/** Evaluación de la última sesión de cada ejercicio con rango de repeticiones (esta semana o la anterior). */
function dpEvaluations(ctx) {
  const minRir = Number(ctx.cfg.progression.minRir) || 0;
  const out = [];
  for (const it of exercisesWithHistory(ctx.d)) {
    const ex = it.exercise;
    // Archivado = ya no está en tu rutina: no se sugiere nada para él.
    if (!ex || ex.archived || !LOAD_REP_TYPES.includes(ex.logType)) continue;
    const hist = exerciseHistory(ctx.d, it.exerciseId, { labels: false }).filter((e) => e.date <= ctx.ref);
    const last = hist[hist.length - 1];
    if (!last || last.date < ctx.prevWeek) continue;
    const s = ctx.byId.get(last.sessionId);
    const se = (s?.exercises || []).find((x) => x.exerciseId === ex.id && x.target && (x.target.repMax != null || x.target.repMin != null));
    if (!se) continue;
    const top = se.target.repMax ?? se.target.repMin;
    if (!(top >= 1)) continue;
    const lt = ex.logType;
    const sets = last.sets.filter(isWorkSet);
    if (!sets.length) continue;
    const weights = sets.map((st) => (lt === 'bodyweight' ? (typeof st.weight === 'number' ? st.weight : 0) : st.weight)).filter((w) => typeof w === 'number');
    if (!weights.length) continue;
    const checks = sets.map((st) => {
      const reps = repsOf(st, lt);
      const rir = rirValue(st.rir);
      const repsOk = reps != null && reps >= top;
      const rirOk = rir != null ? rir >= minRir : minRir <= 0;
      let note;
      if (repsOk && rirOk) note = '✓ tope y RIR';
      else if (!repsOk) { const k = top - (reps ?? 0); note = `${k === 1 ? 'falta' : 'faltan'} ${plural(k, 'rep', 'reps')}`; }
      else note = rir == null ? 'sin RIR registrado' : `RIR ${num(rir, 0)} < ${num(minRir, 0)}`;
      const type = st.type && st.type !== 'effective' ? ` (${SET_TYPE_LABEL[st.type]?.toLowerCase() || st.type})` : '';
      return { set: st, reps, rir, repsOk, rirOk, ok: repsOk && rirOk, note, type, text: formatSet(st, lt, { kg: true }) };
    });
    // Series que pide el objetivo (target.sets): si se hicieron menos, no se sube aunque las hechas lleguen al tope.
    const reqSets = Number.isFinite(se.target.sets) && se.target.sets >= 1 ? se.target.sets : null;
    const setsOk = reqSets == null || checks.length >= reqSets;
    const nTop = checks.filter((c) => c.repsOk).length;
    const allOk = checks.every((c) => c.ok);
    out.push({
      exercise: ex, exerciseId: ex.id, name: ex.name || ex.id, logType: lt, date: last.date, sessionId: last.sessionId,
      templateName: s?.templateName || 'Sesión libre', target: se.target, targetLabel: targetText(se.target, lt), top, minRir,
      checks, reqSets, setsOk, up: setsOk && allOk, nTop,
      nRirLow: checks.filter((c) => c.repsOk && !c.rirOk).length, weight: Math.max(...weights),
      // Motivo de mantener: faltan series del objetivo · faltan reps hasta el tope · solo falla el RIR
      hold: setsOk && allOk ? null : !setsOk ? 'sets' : nTop < checks.length ? 'reps' : 'rir',
    });
  }
  out.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, 'es') : a.date < b.date ? 1 : -1));
  return out;
}

/** Texto de la acción de subir: título corto y «de … a …». */
function upAction(ev, inc) {
  const w = ev.weight;
  const next = (x) => (inc.text === '1–2 kg' ? `${num(x + 1, 2)}–${num(x + 2, 2)}` : num(x + inc.kg, 2));
  if (ev.logType === 'bodyweight') {
    if (w < 0) {
      const after = w + (inc.text === '1–2 kg' ? 1 : inc.kg);
      return {
        // Con menos asistencia que el incremento, no se puede «reducir 2,5 kg»: se quita.
        short: after >= 0 ? 'quita la asistencia' : `reduce ${inc.text} la asistencia`,
        detail: after >= 0 ? `quita la asistencia (ahora ${weightLabel('bodyweight', w)})` : `asistencia de ${num(-w, 2)} a ${inc.text === '1–2 kg' ? `${num(-w - 2, 2)}–${num(-w - 1, 2)}` : num(-after, 2)} kg`,
      };
    }
    return {
      short: `añade ${inc.text} de lastre`,
      detail: w > 0 ? `lastre de +${num(w, 2)} a +${next(w)} kg` : `+${inc.text === '1–2 kg' ? '1–2' : num(inc.kg, 2)} kg de lastre (ahora sin lastre)`,
    };
  }
  const side = ev.logType === 'unilateral' ? ' por lado' : '';
  return { short: `sube ${inc.text}${side}`, detail: `de ${num(w, 2)} a ${next(w)} kg${side}` };
}

function dpRule(ctx) {
  const inc = ctx.cfg.increments;
  const minRir = num(Number(ctx.cfg.progression.minRir) || 0, 0);
  const iso = Number(inc.isolation) === 1 ? '1–2 kg' : kg(Number(inc.isolation) || 0);
  return `Doble progresión (última sesión de cada ejercicio con rango de repeticiones, de esta semana o la anterior): si hiciste al menos las series del objetivo y TODAS las series efectivas (efectiva, al fallo o drop; sin calentamientos) llegaron al tope del rango con RIR ≥ ${minRir}, se sugiere subir el peso: ${kg(Number(inc.upperCompound) || 0)} en compuestos de tren superior, ${kg(Number(inc.lowerCompound) || 0)} en compuestos de tren inferior y ${iso} en aislamiento y core (peso corporal: añade lastre o reduce asistencia; unilateral: por lado). Si no, se mantiene el peso: si faltan repeticiones, se buscan más hasta el tope; si ya estás en el tope pero con RIR por debajo de ${minRir}, se busca completarlo con RIR ≥ ${minRir}; si faltaron series, se completan todas. Incrementos y RIR mínimo en Ajustes › Umbrales › Doble progresión.`;
}

function setRows(ev) {
  return ev.checks.map((c, i) => ({ label: `Serie ${i + 1}${c.type}`, value: `${c.text} · ${c.note}`, sub: true }));
}

function doubleProgressionMessages(ctx) {
  const evs = dpEvaluations(ctx);
  if (!evs.length) return [];
  const rule = dpRule(ctx);
  const out = [];
  for (const ev of evs.filter((e) => e.up)) {
    const inc = incrementFor(ev.exercise, ctx.cfg.increments);
    const act = upAction(ev, inc);
    out.push(sugg(`dp-up-${ev.exerciseId}`, 'good', {
      tag: 'Subir peso',
      title: `${ev.name}: ${act.short}`,
      text: `En la última sesión (${day(ev.date)}) ${ev.reqSets != null ? `hiciste las ${plural(ev.reqSets, 'serie', 'series')} del objetivo y ` : ''}todas las series efectivas llegaron al tope del rango (${num(ev.top, 0)} reps) con RIR ≥ ${num(ev.minRir, 0)}. Próxima vez: ${act.detail}.`,
      rule,
      data: [
        { label: 'Última sesión', value: `${fmtDate(ev.date)} · ${ev.templateName}` },
        { label: 'Objetivo', value: `${ev.targetLabel || `${num(ev.top, 0)} reps`} (tope ${num(ev.top, 0)} reps)` },
        { label: 'Series efectivas', value: `${ev.checks.length} de ${ev.checks.length} en el tope con RIR ≥ ${num(ev.minRir, 0)}${ev.reqSets != null ? ` (objetivo: ${plural(ev.reqSets, 'serie', 'series')})` : ''}` },
        ...setRows(ev),
        { label: 'Incremento', value: `${inc.label}: ${inc.text}${ev.logType === 'unilateral' ? ' por lado' : ''}` },
      ],
      items: [{ exerciseId: ev.exerciseId, label: ev.name, value: act.detail, date: ev.date, sessionId: ev.sessionId, weight: ev.weight, increment: inc }],
      exerciseId: ev.exerciseId,
    }));
  }
  const hold = evs.filter((e) => !e.up);
  if (hold.length) {
    const rir = num(hold[0].minRir, 0);
    const reason = (ev) => {
      if (ev.hold === 'sets') {
        const done = ev.checks.length;
        return `${done} de ${ev.reqSets} series del objetivo registradas${ev.nTop < done ? ` (${ev.nTop} en el tope)` : done === 1 ? ' (en el tope)' : ' (todas en el tope)'}`;
      }
      if (ev.hold === 'reps') return `${ev.nTop} de ${ev.checks.length} series en el tope (${num(ev.top, 0)} reps)`;
      return `todas en el tope, pero ${ev.nRirLow === ev.checks.length ? (ev.nRirLow === 1 ? 'con' : `las ${ev.nRirLow} con`) : `${ev.nRirLow} con`} RIR por debajo de ${num(ev.minRir, 0)} o sin registrar`;
    };
    // Qué hacer con el mismo peso, según el motivo (no «busca más repeticiones» si ya estás en el tope).
    const ADVICE = {
      reps: 'intenta sumar repeticiones hasta el tope',
      rir: `busca completar el tope con RIR ≥ ${rir}`,
      sets: 'completa todas las series del objetivo en el tope',
    };
    const TITLE = {
      reps: 'Mantén el peso y busca más repeticiones',
      rir: `Mantén el peso y termina con RIR ≥ ${rir}`,
      sets: 'Mantén el peso y completa las series',
    };
    const kinds = ['reps', 'rir', 'sets'].filter((k) => hold.some((ev) => ev.hold === k));
    const one = hold.length === 1 ? hold[0] : null;
    const data = [];
    for (const ev of hold) {
      data.push({ label: `${ev.name} · ${ev.targetLabel || `tope ${num(ev.top, 0)}`}`, value: `${day(ev.date)} · ${reason(ev)}` });
      data.push(...setRows(ev));
    }
    const groups = kinds.map((k) => `${ADVICE[k]}: ${shortList(hold.filter((ev) => ev.hold === k).map((ev) => ev.name), 3)}`);
    out.push(sugg('dp-hold', 'neutral', {
      tag: 'Mantener',
      title: kinds.length === 1 ? TITLE[kinds[0]] : 'Mantén el peso',
      text: one
        ? `${one.name}: ${reason(one)} en la última sesión (${day(one.date)}). Con el mismo peso, ${ADVICE[one.hold]}.`
        : kinds.length === 1
          ? `En ${hold.length} ejercicios aún no toca subir (${shortList(hold.map((ev) => ev.name), 3)}); con el mismo peso, ${ADVICE[kinds[0]]}.`
          : `En ${hold.length} ejercicios aún no toca subir. Con el mismo peso, ${groups.join('; ')}.`,
      rule,
      data,
      items: hold.map((ev) => ({ exerciseId: ev.exerciseId, label: ev.name, value: reason(ev), date: ev.date, sessionId: ev.sessionId, weight: ev.weight, hold: ev.hold })),
    }));
  }
  return out;
}

// ===========================================================================
// SUGERENCIA 2 · Avisos orientativos de carga y de km de carrera
// ===========================================================================

function runKmStats(ctx) {
  const { low, high, minBaseKm } = ctx.cfg.runKmWarn;
  const cur = ctx.cur.km.run;
  const prev = ctx.prev.km.run;
  const evaluated = prev > 0 && prev >= minBaseKm - EPS;
  const pct = evaluated ? pctChange(cur, prev) : null;
  return { cur, prev, evaluated, pct, low, high, minBaseKm };
}

function loadWarningMessages(ctx) {
  const L = loadStats(ctx);
  const R = runKmStats(ctx);
  const { low, high } = ctx.cfg.loadWarn;
  const now = ctx.inProgress ? `De momento (quedan ${daysIn(ctx.daysLeft)}), la` : 'La';
  const loadPct = (p, signed = true) => warnPct(p, [low, high], signed);
  const runPct = (p, signed = true) => warnPct(p, [R.low, R.high], signed);
  const loadRuleTxt = `Aviso orientativo si la carga de la semana (minutos × esfuerzo) supera la media de las 4 semanas previas en más de un ${num(low, 0)} % (aviso suave) o de un ${num(high, 0)} % (aviso). Umbrales en Ajustes › Umbrales › Aviso de carga semanal. Es una referencia prudente para que las subidas sean graduales, no una predicción de lesión.`;
  const runRuleTxt = `Aviso orientativo si los km de carrera de la semana suben más de un ${num(R.low, 0)} % (aviso suave) o de un ${num(R.high, 0)} % (aviso) frente a la semana anterior; solo se evalúa si la semana anterior tuvo al menos ${num(R.minBaseKm, 1)} km (con menos, un cambio pequeño da porcentajes grandes). Umbrales en Ajustes › Umbrales › Aviso de km de carrera. Es una referencia prudente, no una predicción de lesión.`;
  const loadData = () => [
    { label: 'Esta semana', value: `${loadTxt(L.total)}${ctx.inProgress ? ' (en curso)' : ''}` },
    { label: meanLabel(L.weeks), value: L.enough ? loadTxt(L.mean) : noRefTxt(L.weeks, L.withData, 'carga') },
    ...loadWeekRows(ctx),
    { label: 'Variación', value: L.pct != null ? loadPct(L.pct) : '—' },
    { label: 'Umbrales', value: `+${num(low, 0)} % aviso suave · +${num(high, 0)} % aviso` },
  ];
  const runData = () => [
    { label: 'Km de carrera esta semana', value: `${distTxt('run', R.cur)}${ctx.inProgress ? ' (en curso)' : ''}` },
    { label: 'Semana anterior', value: distTxt('run', R.prev) },
    { label: 'Variación', value: R.pct != null ? runPct(R.pct) : R.prev > 0 ? `no se evalúa (menos de ${num(R.minBaseKm, 1)} km)` : 'no se evalúa (sin km la semana anterior)' },
    { label: 'Umbrales', value: `+${num(R.low, 0)} % aviso suave · +${num(R.high, 0)} % aviso · mínimo ${num(R.minBaseKm, 1)} km la semana anterior` },
  ];
  const out = [];
  if (warnOver(L.pct, low)) {
    const hi = warnOver(L.pct, high);
    out.push(sugg('load-warn', 'warn', {
      tag: hi ? 'Aviso' : 'Aviso suave',
      severity: hi ? 'high' : 'soft',
      title: `${hi ? 'Aviso' : 'Aviso suave'}: la carga sube un ${loadPct(L.pct, false)}`,
      text: `${now} carga de esta semana (${loadTxt(L.total)}) supera en un ${loadPct(L.pct, false)} la media de ${weeksTxt(L.weeks)} (${loadTxt(L.mean)}). Aviso orientativo: conviene que las subidas de carga sean graduales.`,
      rule: loadRuleTxt,
      data: loadData(),
      pct: L.pct,
    }));
  }
  if (warnOver(R.pct, R.low)) {
    const hi = warnOver(R.pct, R.high);
    out.push(sugg('runkm-warn', 'warn', {
      tag: hi ? 'Aviso' : 'Aviso suave',
      severity: hi ? 'high' : 'soft',
      title: `${hi ? 'Aviso' : 'Aviso suave'}: km de carrera ${runPct(R.pct)}`,
      text: `${ctx.inProgress ? 'De momento llevas' : 'Corriste'} ${distTxt('run', R.cur)} esta semana frente a ${distTxt('run', R.prev)} la anterior (${runPct(R.pct)}). Aviso orientativo: en carrera conviene subir el volumen de forma gradual.`,
      rule: runRuleTxt,
      data: runData(),
      pct: R.pct,
    }));
  }
  if (out.length) return out;

  // Sin avisos: se dice, con los datos de cada regla.
  const parts = [];
  if (!L.enough) parts.push('Carga: sin referencia suficiente (hacen falta 2 semanas previas con carga)');
  else if (ctx.inProgress) parts.push(`De momento, la carga (${loadTxt(L.total)}) no supera la media de ${weeksTxt(L.weeks)} (${loadTxt(L.mean)}) en más de un ${num(low, 0)} %`);
  else parts.push(`La carga queda ${L.pct >= 0 ? `un ${loadPct(L.pct, false)} por encima` : `un ${loadPct(L.pct, false)} por debajo`} de tu media (aviso desde +${num(low, 0)} %)`);
  const runs = R.cur > 0 || R.prev > 0;
  if (runs) {
    if (R.evaluated) parts.push(ctx.inProgress ? `km de carrera: de momento ${distTxt('run', R.cur)} frente a ${distTxt('run', R.prev)} (aviso desde +${num(R.low, 0)} %)` : `km de carrera ${runPct(R.pct)} frente a la semana anterior (aviso desde +${num(R.low, 0)} %)`);
    else parts.push(R.prev > 0 ? `km de carrera: no se evalúa (la semana anterior tuvo ${distTxt('run', R.prev)}, menos de ${num(R.minBaseKm, 1)} km)` : 'km de carrera: no se evalúa (sin carrera la semana anterior)');
  }
  return [sugg('load-ok', 'neutral', {
    title: 'Sin avisos de carga',
    text: `${parts.join('; ')}.`,
    rule: runs ? `${loadRuleTxt} ${runRuleTxt}` : loadRuleTxt,
    data: runs ? [...loadData(), ...runData()] : loadData(),
  })];
}

// ===========================================================================
// SUGERENCIA 3 · Semana de descarga
// ===========================================================================

/** Check-in «bajo»: sueño o energía bajos (1) o agujetas altas (3). El mismo criterio que checkin-logic.js. */
export { isLowCheckin };

/** «sueño bajo · energía baja · agujetas normales» (concordado, solo lo contestado; checkin-logic.valueText). */
function checkinText(c) {
  return FIELD_KEYS.map((k) => valueText(k, c[k])).filter(Boolean).join(' · ') || 'sin valores';
}
/** Fila de un check-in en un «¿Por qué?»: «22 sep · antes» → «sueño bajo · energía normal · agujetas normales → cuenta como bajo». */
const checkinRow = (k) => ({
  label: `${day(k.date)} · ${k.timing === 'post' ? 'después' : 'antes'}`,
  value: `${checkinText(k)}${isLowCheckin(k) ? ' → cuenta como bajo' : ''}`,
  sub: true,
});
const CK_RULE = 'Un check-in cuenta como bajo si el sueño o la energía son bajos o las agujetas altas.';

/**
 * INFORMACIÓN · Check-ins de la semana (solo si los hay). Es contexto: ninguna regla del panel depende de él salvo
 * la sugerencia de descarga. Resumen con checkin-logic.summary.
 */
function checkinMessage(ctx) {
  const sum = checkinSummary(ctx.d.checkins, ctx.week, ctx.ref);
  if (!sum.count) return null;
  return info('checkins', 'neutral', {
    tag: 'Contexto',
    title: 'Check-ins de la semana',
    text: `${ctx.inProgress ? 'De momento, ' : ''}${sum.text}. Es contexto: solo lo tiene en cuenta la sugerencia de descarga (si al menos la mitad de los check-ins de su periodo son bajos).`,
    rule: `Check-ins opcionales de la semana, antes o después de entrenar: sueño, energía y agujetas (bajo, normal o alto). ${CK_RULE} Ninguna regla del panel depende de ellos salvo la sugerencia de descarga.`,
    data: [
      { label: 'Check-ins', value: `${plural(sum.count, 'check-in', 'check-ins')} en ${plural(sum.days, 'día', 'días')} · ${plural(sum.low, 'bajo', 'bajos')}` },
      ...sum.list.map(checkinRow),
    ],
    count: sum.count, low: sum.low,
  });
}

function deloadMessage(ctx) {
  if (!ctx.hasStrength) return null;
  const { minStalled, rpeHigh } = ctx.cfg.deload;
  const W = Math.max(1, Math.round(ctx.cfg.deload.weeks));
  const from = addDays(ctx.ref, -7 * W + 1);
  // (a) Los archivados (ya fuera de tu rutina) no cuentan.
  const stalled = classify(ctx).list.filter((x) => x.status === 'stalled' && !x.archived);
  const a = stalled.length >= minStalled;
  // (b) Esfuerzo alto SOSTENIDO: el periodo se parte en W bloques de 7 días (hasta hoy o el domingo) y en cada uno
  // tiene que haber sesiones de fuerza con esfuerzo registrado y un RPE medio ≥ rpeHigh (una semana sin entrenar
  // rompe la racha); además, al menos MIN_RPE_SESSIONS sesiones en total.
  const rpeSessions = ctx.sessions.filter((s) => s.kind === 'strength' && s.date >= from && s.date <= ctx.ref && s.rpe >= 1)
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const blocks = [];
  for (let k = W - 1; k >= 0; k--) {
    const bEnd = addDays(ctx.ref, -7 * k);
    const bStart = addDays(bEnd, -6);
    const list = rpeSessions.filter((s) => s.date >= bStart && s.date <= bEnd);
    const mean = list.length ? list.reduce((t, s) => t + s.rpe, 0) / list.length : null;
    blocks.push({ from: bStart, to: bEnd, list, mean, ok: mean != null && mean >= rpeHigh - EPS, label: spanTxt(bStart, bEnd) });
  }
  const rpeMean = rpeSessions.length ? rpeSessions.reduce((t, s) => t + s.rpe, 0) / rpeSessions.length : null;
  const emptyBlock = blocks.find((bk) => !bk.list.length);
  const lowBlock = blocks.find((bk) => bk.list.length && !bk.ok);
  const enoughRpe = rpeSessions.length >= MIN_RPE_SESSIONS;
  const b = enoughRpe && !emptyBlock && !lowBlock;
  // (c) Check-ins del periodo (si los hay): al menos la mitad bajos.
  const cks = checkinsBetween(ctx.d.checkins, from, ctx.ref);
  const lows = cks.filter(isLowCheckin);
  const cApplies = cks.length > 0;
  const c = !cApplies || lows.length * 2 >= cks.length;
  const period = spanTxt(from, ctx.ref);
  const perWeek = W === 1 ? 'en la última semana' : `en cada una de ${lastWeeksTxt(W)}`;
  const rule = `Se sugiere una semana de descarga solo si coinciden: (a) al menos ${num(minStalled, 0)} ejercicios estancados (ver «Ejercicios estancados»; los archivados no cuentan); (b) esfuerzo percibido alto sostenido: RPE medio de las sesiones de fuerza de ${n1(rpeHigh)} o más ${perWeek} (bloques de 7 días hasta ${ctx.inProgress ? 'hoy' : 'el domingo'}; una semana sin sesiones rompe la racha), con al menos ${MIN_RPE_SESSIONS} sesiones con esfuerzo registrado; y (c) si registraste check-ins en ese periodo, que al menos la mitad sean bajos. ${CK_RULE} Umbrales en Ajustes › Umbrales › Sugerencia de descarga.`;
  const meansTxt = blocks.map((bk) => (bk.mean != null ? n1(bk.mean) : '—')).join(' · ');
  let bValue;
  if (!rpeSessions.length) bValue = `sin sesiones con esfuerzo registrado · ${cumple(false)}`;
  else if (emptyBlock) bValue = `${cumple(false)}: semana ${emptyBlock.label} sin sesiones de fuerza con esfuerzo registrado`;
  else if (lowBlock) bValue = `${cumple(false)}: semana ${lowBlock.label} con RPE medio ${n1(lowBlock.mean)} (umbral ${n1(rpeHigh)})`;
  else if (!enoughRpe) bValue = `${n1(rpeMean)} en ${plural(rpeSessions.length, 'sesión', 'sesiones')} (hacen falta al menos ${MIN_RPE_SESSIONS}) · ${cumple(false)}`;
  else if (W === 1) bValue = `${n1(blocks[0].mean)} en ${plural(rpeSessions.length, 'sesión', 'sesiones')} (umbral ${n1(rpeHigh)}) · ${cumple(true)}`;
  else bValue = `medias por semana: ${meansTxt} (umbral ${n1(rpeHigh)}; ${plural(rpeSessions.length, 'sesión', 'sesiones')}) · ${cumple(true)}`;
  const data = [
    { label: '(a) Ejercicios estancados', value: `${num(stalled.length, 0)} (mínimo ${num(minStalled, 0)}) · ${cumple(a)}` },
    ...stalled.map((x) => ({ label: x.name, value: `mejor previo ${kg1(x.refBest.e1rm)} · última ${kg1(x.last.e1rm)}`, sub: true })),
    { label: `(b) RPE medio de fuerza (${period})`, value: bValue },
  ];
  for (const bk of blocks) {
    if (W > 1) data.push({ label: `Semana ${bk.label}`, value: bk.list.length ? `RPE medio ${n1(bk.mean)} en ${plural(bk.list.length, 'sesión', 'sesiones')}` : 'sin sesiones de fuerza con esfuerzo registrado', sub: true });
    for (const s of bk.list) data.push({ label: `${day(s.date)} · ${s.templateName || 'Sesión libre'}`, value: `RPE ${num(s.rpe, 1)}`, sub: true });
  }
  data.push(
    {
      label: `(c) Check-ins (${period})`,
      value: cApplies ? `${lows.length} de ${cks.length} bajos (hace falta la mitad) · ${cumple(c)}` : 'sin check-ins en el periodo · no se tiene en cuenta',
    },
    ...cks.map(checkinRow),
  );
  const extra = { rule, data, conditions: { stalled: a, rpe: b, checkins: c, checkinsApply: cApplies }, stalledCount: stalled.length, rpeMean, rpeWeeks: blocks.map((bk) => bk.mean) };
  if (a && b && c) {
    const rpeTxt = W === 1 ? `un RPE medio de ${n1(blocks[0].mean)} en las sesiones de fuerza de la última semana` : `un RPE medio de ${n1(rpeHigh)} o más en cada una de ${lastWeeksTxt(W)} (${meansTxt})`;
    return sugg('deload', 'warn', {
      ...extra,
      tag: 'Descarga',
      title: 'Valora una semana de descarga',
      text: `Coinciden ${plural(stalled.length, 'ejercicio estancado', 'ejercicios estancados')}${cApplies ? ', ' : ' y '}${rpeTxt}${cApplies ? ` y check-ins bajos (${lows.length} de ${cks.length})` : ''}. Una semana con menos series y menos esfuerzo puede ayudarte a recuperar y retomar la progresión.`,
    });
  }
  const yes = (ok) => (ok ? 'sí' : 'no');
  let bStatus;
  if (!rpeSessions.length) bStatus = 'RPE medio de fuerza: sin sesiones con esfuerzo registrado';
  else if (emptyBlock) bStatus = `RPE medio de fuerza: semana ${emptyBlock.label} sin sesiones`;
  else if (W === 1) bStatus = `RPE medio de fuerza ${n1(rpeMean)}${enoughRpe ? '' : ` en ${plural(rpeSessions.length, 'sesión', 'sesiones')}`} (umbral ${n1(rpeHigh)})`;
  else bStatus = `RPE medio de fuerza por semana ${meansTxt} (umbral ${n1(rpeHigh)})`;
  const status = [
    `estancados ${num(stalled.length, 0)} (mínimo ${num(minStalled, 0)}): ${yes(a)}`,
    `${bStatus}: ${yes(b)}`,
    cApplies ? `check-ins bajos ${lows.length} de ${cks.length}: ${yes(c)}` : 'sin check-ins (no cuentan)',
  ];
  return sugg('deload-none', 'neutral', {
    ...extra,
    title: 'Sin señales de necesitar descarga',
    text: `No coinciden las condiciones. ${status.join(' · ').replace(/^./, (ch) => ch.toUpperCase())}.`,
  });
}

// ===========================================================================
// Mensajes clave (tarjeta resumen de Hoy y Progreso)
// ===========================================================================

/**
 * 2–3 mensajes clave de un resultado de weeklyInsights, por prioridad: avisos de las sugerencias, avisos de
 * la información, subidas de peso (agrupadas en una si son varias), lo que falta en la semana (en curso, solo
 * cuando quedan 3 días o menos), lo que progresa, empuje/tirón… y, si no hay nada más, la carga y las series
 * por músculo. Los mensajes neutros de «sin avisos» y el de check-ins (contexto) no se muestran. Cada uno
 * conserva su why. Orden de salida: primero los de información y después las sugerencias (cada grupo por
 * prioridad); la puntuación solo elige cuáles entran.
 * @returns {object[]}
 */
export function keyMessages(result, max = 3) {
  if (!result) return [];
  const all = [...(result.info || []), ...(result.suggestions || [])];
  const ups = all.filter((m) => m.id.startsWith('dp-up-'));
  const scored = [];
  const score = (m) => {
    if (m.id.startsWith('dp-up-')) return -1; // se agrupan aparte
    if (m.section === 'suggestion' && m.level === 'warn') return 100;
    if (m.section === 'info' && m.level === 'warn') return m.id === 'ex-stalled' ? 75 : 80;
    // Lo que falta en la semana en curso solo es clave al final (con toda la semana por delante es obvio).
    if (m.id === 'muscles-below') return !result.inProgress || result.daysLeft <= 3 ? 60 : 12;
    if (m.id === 'ex-progress') return 50;
    if (m.id === 'push-pull') return m.level === 'neutral' ? 12 : 40;
    if (m.id === 'muscles') return m.level === 'good' ? 35 : 10;
    if (m.id === 'dp-hold') return 25;
    if (m.id === 'load') return 20;
    if (m.id === 'km') return 15;
    return -1;
  };
  for (const m of all) {
    const s = score(m);
    if (s >= 0) scored.push({ m, s });
  }
  if (ups.length === 1) scored.push({ m: ups[0], s: 70 });
  else if (ups.length > 1) {
    scored.push({
      s: 70,
      m: {
        id: 'dp-up-summary', section: 'suggestion', level: 'good', tag: 'Subir peso',
        title: `Puedes subir peso en ${ups.length} ejercicios`,
        // Nombres y cifras: «Press banca (de 80 a 82,5 kg), Sentadilla (de 100 a 105 kg) y 2 más».
        text: `${shortList(ups.map((m) => `${m.items[0].label} (${m.items[0].value})`), 3)}.`,
        why: {
          rule: ups[0].why.rule,
          data: ups.map((m) => ({ label: m.items[0].label, value: m.items[0].value })),
        },
        items: ups.map((m) => m.items[0]),
      },
    });
  }
  // La puntuación solo decide QUÉ mensajes entran; se devuelven con la información primero y las sugerencias
  // después (el principio del panel), cada grupo por prioridad.
  scored.sort((a, b) => b.s - a.s);
  const SEC = { info: 0, suggestion: 1 };
  return scored.slice(0, max).sort((a, b) => (SEC[a.m.section] - SEC[b.m.section]) || (b.s - a.s)).map((x) => x.m);
}
