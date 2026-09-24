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
//   2 normal, 3 alto). Solo se usan como contexto en la sugerencia de descarga.
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
import { isWorkSet, rirValue, muscleContrib, workSetCount } from './calc.js';
import {
  weeklySeries, muscleTable, exerciseHistory, exercisesWithHistory, dataRange, fmtMetric, fmtNumFast, weightLabel, KINDS,
} from './stats.js';
import { PATTERNS, PATTERN_LABEL, SET_TYPE_LABEL, defaultSettings } from './seed.js';
import { formatSet, targetText, LOAD_REP_TYPES } from './session-logic.js';
import { joinList } from './activity-logic.js';

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
const CK_LEVEL = { 1: 'bajo', 2: 'normal', 3: 'alto' };
const CK_SORE = { 1: 'bajas', 2: 'normales', 3: 'altas' };

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
/** «4 días (hoy incluido)» / «1 día (hoy)». */
const daysTxt = (n) => (n === 1 ? '1 día (hoy)' : `${n} días (hoy incluido)`);
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
  const pending = ctx.inProgress ? ` La semana está en curso (quedan ${daysTxt(ctx.daysLeft)}): lo que aún no llega al mínimo se puede completar.` : '';
  const out = [];

  // 1 · Tabla de todos los músculos frente a su rango.
  out.push(info('muscles', !below.length && !above.length ? 'good' : 'neutral', {
    title: 'Series efectivas por músculo',
    text: ctx.inProgress
      ? `Semana en curso, a falta de ${daysTxt(ctx.daysLeft)}: ${nIn} de ${withT.length} músculos ya dentro de su rango, ${above.length} por encima y ${below.length} aún sin llegar al mínimo. Llevas ${setsTxt(total)} efectivas (${prevTotalTxt}).`
      : `${nIn} de ${withT.length} músculos dentro de su rango, ${below.length} por debajo y ${above.length} por encima. ${setsTxt(total)} efectivas de fuerza (${prevTotalTxt}).`,
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
      rule: `Un músculo está por debajo si sus series efectivas de la semana no llegan al mínimo de su rango (Ajustes › Umbrales › Series semanales por músculo). ${factorRule(ctx)}${ctx.inProgress ? ` La semana no ha terminado (quedan ${daysTxt(ctx.daysLeft)}): es un recuento provisional, no un resultado.` : ''}`,
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
        ? `${setsTxt(one.sets)} esta semana; tu máximo es ${n1(one.max)}. ${ctx.hasPrev ? `Semana anterior: ${n1(one.prevSets)} (${one.deltaLabel}).` : 'Es la primera semana con registros.'}`
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
  const rule = `Se cuentan las series efectivas de cada ejercicio según su patrón de movimiento (ficha del ejercicio): empuje = ${labels(PUSH_PATTERNS)}; tirón = ${labels(PULL_PATTERNS)}. Cada serie cuenta 1 (sin factor de músculo secundario) y los ejercicios de aislamiento (curl, tríceps, elevaciones…) no cuentan. Con tu prioridad de espalda, lo deseable es que los tirones igualen o superen a los empujes.`;
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
        ? `Aún no hay series de empuje ni de tirón (quedan ${daysTxt(ctx.daysLeft)}); ${prevTxt}.`
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
  const byKind = KINDS.map((k) => {
    const m = avg((r) => r.load[k]);
    return { kind: k, name: KIND_LABEL[k], value: cur.load[k], mean: m, pct: enough && m > 0 ? pctChange(cur.load[k], m) : null };
  });
  ctx.memo.load = { total: cur.loadTotal, mean, enough, withData, weeks, pct, byKind, noLoad: cur.noLoad };
  return ctx.memo.load;
}

const weeksTxt = (n) => (n === 1 ? 'la semana previa' : `las ${n} semanas previas`);

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
    text = `${loadTxt(L.total)} (minutos × esfuerzo), ${pctTxt(L.pct)} frente a la media de ${weeksTxt(L.weeks)} (${loadTxt(L.mean)}).`;
  }
  const items = L.byKind.filter((k) => k.value > 0 || k.mean > 0).map((k) => ({
    kind: k.kind, label: k.name, value: `${loadTxt(k.value)} · media ${k.mean != null ? loadTxt(k.mean) : '—'}${!ctx.inProgress && k.pct != null ? ` (${pctTxt(k.pct)})` : ''}`,
    load: k.value, mean: k.mean, pct: k.pct,
  }));
  const data = [
    { label: 'Esta semana', value: `${loadTxt(L.total)}${ctx.inProgress ? ' (en curso)' : ''}` },
    ...L.byKind.filter((k) => k.value > 0).map((k) => ({ label: k.name, value: loadTxt(k.value), sub: true })),
    { label: `Semanas previas (${L.weeks})`, value: L.weeks ? `${L.withData} con carga` : 'ninguna todavía' },
    ...loadWeekRows(ctx),
    { label: 'Media de las semanas previas', value: L.enough ? loadTxt(L.mean) : 'sin referencia suficiente' },
    {
      label: ctx.inProgress ? 'De momento' : 'Variación',
      value: L.pct == null ? 'sin referencia suficiente' : ctx.inProgress ? `el ${num((L.total / L.mean) * 100, 0)} % de la media (semana en curso)` : pctTxt(L.pct),
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
  const vsPrev = (x) => (!ctx.hasPrev ? 'primera semana con registros' : x.prev > 0 ? `${pctTxt(x.pctPrev)} frente a la semana anterior` : 'sin km la semana anterior');
  const text = ctx.inProgress
    ? `De momento, a falta de ${daysTxt(ctx.daysLeft)}: ${list.map((x) => `${x.name} ${distTxt(x.kind, x.cur)} (semana anterior ${distTxt(x.kind, x.prev)})`).join(' · ')}.`
    : `${list.map((x) => `${x.name} ${distTxt(x.kind, x.cur)} (${vsPrev(x)})`).join(' · ')}.`;
  const items = list.map((x) => ({
    kind: x.kind, label: x.name,
    value: `${distTxt(x.kind, x.cur)} · sem. ant. ${distTxt(x.kind, x.prev)}${!ctx.inProgress && x.prev > 0 ? ` (${pctTxt(x.pctPrev)})` : ''} · media ${x.enough ? distTxt(x.kind, x.mean) : 'sin ref.'}${!ctx.inProgress && x.pctMean != null ? ` (${pctTxt(x.pctMean)})` : ''}`,
    km: x.cur, prevKm: x.prev, meanKm: x.enough ? x.mean : null, pctPrev: x.pctPrev, pctMean: x.pctMean,
  }));
  const data = [];
  for (const x of list) {
    data.push({ label: x.name, value: `${distTxt(x.kind, x.cur)} esta semana${ctx.inProgress ? ' (en curso)' : ''}` });
    const vary = (p) => (ctx.inProgress || p == null ? '' : ` (variación ${pctTxt(p)})`);
    data.push({ label: 'Semana anterior', value: x.prev > 0 ? `${distTxt(x.kind, x.prev)}${vary(x.pctPrev)}` : `${distTxt(x.kind, 0)} (sin variación calculable)`, sub: true });
    data.push({ label: `Media de ${weeksTxt(x.weeks)}`, value: x.enough ? `${distTxt(x.kind, x.mean)}${vary(x.pctMean)}` : `sin referencia suficiente (${x.withKm} ${x.withKm === 1 ? 'semana' : 'semanas'} con km)`, sub: true });
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

/**
 * Clasificación de los ejercicios con 1RM estimado hasta `ctx.ref`: progress | maintain | stalled.
 * Solo ejercicios con ≥ MIN_SESSIONS sesiones con 1RM estimado y alguna en las últimas stall.weeks semanas.
 */
function classify(ctx) {
  if (ctx.memo.classes) return ctx.memo.classes;
  const S = Math.max(1, Math.round(ctx.cfg.stall.sessions));
  const W = Math.max(1, Math.round(ctx.cfg.stall.weeks));
  const from = addDays(ctx.ref, -7 * W + 1);
  const out = [];
  for (const it of exercisesWithHistory(ctx.d)) {
    const hist = exerciseHistory(ctx.d, it.exerciseId, { labels: false }).filter((e) => e.date <= ctx.ref && e.e1rm != null);
    if (hist.length < MIN_SESSIONS || hist[hist.length - 1].date < from) continue;
    let best = -Infinity;
    const entries = hist.map((e, i) => {
      const record = i > 0 && e.e1rm > best + EPS;
      if (e.e1rm > best + EPS) best = e.e1rm;
      return { date: e.date, sessionId: e.sessionId, e1rm: e.e1rm, label: e.bestSetLabel, record };
    });
    const n = entries.length;
    const lastS = entries.slice(-S);
    const win = entries.filter((e) => e.date >= from);
    const hasPrior = entries.some((e) => e.date < from);
    const bySessions = n >= S + 1 && !lastS.some((e) => e.record);
    const byWeeks = win.length >= 2 && hasPrior && !win.some((e) => e.record);
    const recS = lastS.some((e) => e.record);
    const recW = win.some((e) => e.record);
    const status = bySessions || byWeeks ? 'stalled' : recS || recW ? 'progress' : 'maintain';
    // Tramo que se enseña en el «¿Por qué?»: el que decide el estado (el más largo si deciden los dos),
    // precedido del mejor 1RM estimado de antes de ese tramo.
    const idxS = n - lastS.length;
    const idxW = win.length ? n - win.length : n;
    let startIdx;
    if (status === 'stalled') startIdx = bySessions && byWeeks ? Math.min(idxS, idxW) : bySessions ? idxS : idxW;
    else if (status === 'progress') startIdx = recS && recW ? Math.min(idxS, idxW) : recS ? idxS : idxW;
    else startIdx = idxS;
    startIdx = Math.max(0, Math.min(startIdx, n - 1));
    let priorBest = null;
    for (const e of entries.slice(0, startIdx)) if (!priorBest || e.e1rm > priorBest.e1rm + EPS) priorBest = e;
    let bestE = null;
    for (const e of entries) if (!bestE || e.e1rm > bestE.e1rm + EPS) bestE = e;
    out.push({
      exerciseId: it.exerciseId, name: it.name, status, bySessions, byWeeks,
      sessions: n, shown: entries.slice(startIdx), priorBest, best: bestE, last: entries[n - 1],
    });
  }
  out.sort((a, b) => (a.last.date === b.last.date ? a.name.localeCompare(b.name, 'es') : a.last.date < b.last.date ? 1 : -1));
  ctx.memo.classes = { list: out, S, W, from };
  return ctx.memo.classes;
}

function progressRule(S, W) {
  return `1RM estimado (Epley con repeticiones + RIR, series de 1 a 12 repeticiones) de la mejor serie de cada sesión, en ejercicios con al menos ${MIN_SESSIONS} sesiones y alguna en las últimas ${W} semanas. Progresa: nuevo mejor 1RM estimado en sus últimas ${S} sesiones o ${W} semanas. Estancado: sin superar su mejor 1RM estimado previo en las últimas ${S} sesiones o en las últimas ${W} semanas (con al menos 2 sesiones en ese tramo). Se mantiene: el resto (sin nuevo mejor reciente, pero sin sesiones suficientes para hablar de estancamiento). Umbrales en Ajustes › Umbrales › Estancamiento.`;
}

function classWhyRows(list) {
  const rows = [];
  for (const x of list) {
    rows.push({ label: x.name, value: x.priorBest ? `mejor anterior ${kg1(x.priorBest.e1rm)} (${day(x.priorBest.date)})` : 'sin sesiones anteriores al tramo' });
    for (const e of x.shown) rows.push({ label: day(e.date), value: `${kg1(e.e1rm)} · ${e.label}${e.record ? ' · nuevo mejor' : ''}`, sub: true });
  }
  return rows;
}

function progressMessages(ctx) {
  if (!ctx.hasStrength) return [];
  const { list, S, W } = classify(ctx);
  const rule = progressRule(S, W);
  if (!list.length) {
    const counts = exercisesWithHistory(ctx.d).map((it) => ({
      name: it.name, n: exerciseHistory(ctx.d, it.exerciseId, { labels: false }).filter((e) => e.date <= ctx.ref && e.e1rm != null).length,
    })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 8);
    return [info('ex-none', 'neutral', {
      title: 'Aún sin datos para valorar el progreso',
      text: `Hace falta que un ejercicio tenga al menos ${MIN_SESSIONS} sesiones con 1RM estimado y alguna en las últimas ${W} semanas.`,
      rule,
      data: counts.length ? counts.map((x) => ({ label: x.name, value: plural(x.n, 'sesión', 'sesiones') })) : [{ label: 'Ejercicios con 1RM estimado', value: 'ninguno todavía' }],
    })];
  }
  const out = [];
  const item = (x) => ({
    exerciseId: x.exerciseId, label: x.name,
    value: x.status === 'progress' ? `${kg1(x.best.e1rm)} (${day(x.best.date)})` : `mejor ${kg1(x.best.e1rm)} · última ${kg1(x.last.e1rm)}`,
    status: x.status, best: x.best.e1rm, lastE1rm: x.last.e1rm, sessions: x.sessions,
  });
  const prog = list.filter((x) => x.status === 'progress');
  const keep = list.filter((x) => x.status === 'maintain');
  const stall = list.filter((x) => x.status === 'stalled');
  if (prog.length) {
    const one = prog.length === 1 ? prog[0] : null;
    const rec = one ? [...one.shown].reverse().find((e) => e.record) : null;
    out.push(info('ex-progress', 'good', {
      title: one ? `${one.name} progresa` : `${prog.length} ejercicios progresan`,
      text: one
        ? `Nuevo mejor 1RM estimado: ${kg1(rec.e1rm)} (${day(rec.date)}, ${rec.label}).`
        : `Con un nuevo mejor 1RM estimado en sus últimas ${S} sesiones o ${W} semanas.`,
      rule, data: classWhyRows(prog), items: prog.map(item),
    }));
  }
  if (keep.length) {
    const one = keep.length === 1 ? keep[0] : null;
    out.push(info('ex-maintain', 'neutral', {
      title: one ? `${one.name} se mantiene` : `${keep.length} ejercicios se mantienen`,
      text: one
        ? `Sin nuevo mejor 1RM estimado reciente (mejor: ${kg1(one.best.e1rm)}, ${day(one.best.date)}), pero aún sin sesiones suficientes para hablar de estancamiento.`
        : 'Sin nuevo mejor 1RM estimado reciente, pero aún sin sesiones suficientes para hablar de estancamiento.',
      rule, data: classWhyRows(keep), items: keep.map(item),
    }));
  }
  if (stall.length) {
    const one = stall.length === 1 ? stall[0] : null;
    const why = (x) => (x.bySessions && x.byWeeks ? `las últimas ${S} sesiones ni en las últimas ${W} semanas` : x.bySessions ? `las últimas ${S} sesiones` : `las últimas ${W} semanas`);
    out.push(info('ex-stalled', 'warn', {
      tag: 'Estancado',
      title: one ? `${one.name} estancado` : `${stall.length} ejercicios estancados`,
      text: one
        ? `Sin superar su mejor 1RM estimado (${kg1(one.priorBest ? one.priorBest.e1rm : one.best.e1rm)}, ${day((one.priorBest || one.best).date)}) en ${why(one)}.`
        : `Sin superar su mejor 1RM estimado en las últimas ${S} sesiones o ${W} semanas.`,
      rule, data: classWhyRows(stall), items: stall.map(item),
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
    if (!ex || !LOAD_REP_TYPES.includes(ex.logType)) continue;
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
    out.push({
      exercise: ex, exerciseId: ex.id, name: ex.name || ex.id, logType: lt, date: last.date, sessionId: last.sessionId,
      templateName: s?.templateName || 'Sesión libre', target: se.target, targetLabel: targetText(se.target, lt), top, minRir,
      checks, up: checks.every((c) => c.ok), nTop: checks.filter((c) => c.repsOk).length,
      nRirLow: checks.filter((c) => c.repsOk && !c.rirOk).length, weight: Math.max(...weights),
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
        short: `reduce ${inc.text} la asistencia`,
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
  return `Doble progresión (última sesión de cada ejercicio con rango de repeticiones, de esta semana o la anterior): si TODAS las series efectivas (efectiva, al fallo o drop; sin calentamientos) llegaron al tope del rango con RIR ≥ ${minRir}, se sugiere subir el peso: ${kg(Number(inc.upperCompound) || 0)} en compuestos de tren superior, ${kg(Number(inc.lowerCompound) || 0)} en compuestos de tren inferior y ${iso} en aislamiento y core (peso corporal: añade lastre o reduce asistencia; unilateral: por lado). Si no, se mantiene el peso y se buscan más repeticiones dentro del rango. Incrementos y RIR mínimo en Ajustes › Umbrales › Doble progresión.`;
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
      text: `En la última sesión (${day(ev.date)}) todas las series efectivas llegaron al tope del rango (${num(ev.top, 0)} reps) con RIR ≥ ${num(ev.minRir, 0)}. Próxima vez: ${act.detail}.`,
      rule,
      data: [
        { label: 'Última sesión', value: `${fmtDate(ev.date)} · ${ev.templateName}` },
        { label: 'Objetivo', value: `${ev.targetLabel || `${num(ev.top, 0)} reps`} (tope ${num(ev.top, 0)} reps)` },
        { label: 'Series efectivas', value: `${ev.checks.length} de ${ev.checks.length} en el tope con RIR ≥ ${num(ev.minRir, 0)}` },
        ...setRows(ev),
        { label: 'Incremento', value: `${inc.label}: ${inc.text}${ev.logType === 'unilateral' ? ' por lado' : ''}` },
      ],
      items: [{ exerciseId: ev.exerciseId, label: ev.name, value: act.detail, date: ev.date, sessionId: ev.sessionId, weight: ev.weight, increment: inc }],
      exerciseId: ev.exerciseId,
    }));
  }
  const hold = evs.filter((e) => !e.up);
  if (hold.length) {
    const reason = (ev) => (ev.nTop < ev.checks.length
      ? `${ev.nTop} de ${ev.checks.length} series en el tope (${num(ev.top, 0)} reps)`
      : `todas en el tope, pero ${ev.nRirLow} con RIR por debajo de ${num(ev.minRir, 0)} o sin registrar`);
    const one = hold.length === 1 ? hold[0] : null;
    const data = [];
    for (const ev of hold) {
      data.push({ label: `${ev.name} · ${ev.targetLabel || `tope ${num(ev.top, 0)}`}`, value: `${day(ev.date)} · ${reason(ev)}` });
      data.push(...setRows(ev));
    }
    out.push(sugg('dp-hold', 'neutral', {
      tag: 'Mantener',
      title: 'Mantén el peso y busca más repeticiones',
      text: one
        ? `${one.name}: ${reason(one)} en la última sesión (${day(one.date)}). Con el mismo peso, intenta sumar repeticiones hasta el tope.`
        : `En ${hold.length} ejercicios no todas las series efectivas llegaron al tope del rango con RIR ≥ ${num(hold[0].minRir, 0)}; con el mismo peso, intenta sumar repeticiones hasta el tope.`,
      rule,
      data,
      items: hold.map((ev) => ({ exerciseId: ev.exerciseId, label: ev.name, value: reason(ev), date: ev.date, sessionId: ev.sessionId, weight: ev.weight })),
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
  const now = ctx.inProgress ? `De momento (quedan ${daysTxt(ctx.daysLeft)}), la` : 'La';
  const loadRuleTxt = `Aviso orientativo si la carga de la semana (minutos × esfuerzo) supera la media de las 4 semanas previas en más de un ${num(low, 0)} % (aviso suave) o de un ${num(high, 0)} % (aviso). Umbrales en Ajustes › Umbrales › Aviso de carga semanal. Es una referencia prudente para que las subidas sean graduales, no una predicción de lesión.`;
  const runRuleTxt = `Aviso orientativo si los km de carrera de la semana suben más de un ${num(R.low, 0)} % (aviso suave) o de un ${num(R.high, 0)} % (aviso) frente a la semana anterior; solo se evalúa si la semana anterior tuvo al menos ${num(R.minBaseKm, 1)} km (con menos, un cambio pequeño da porcentajes grandes). Umbrales en Ajustes › Umbrales › Aviso de km de carrera. Es una referencia prudente, no una predicción de lesión.`;
  const loadData = () => [
    { label: 'Esta semana', value: `${loadTxt(L.total)}${ctx.inProgress ? ' (en curso)' : ''}` },
    { label: `Media de ${weeksTxt(L.weeks)}`, value: L.enough ? loadTxt(L.mean) : `sin referencia suficiente (${L.withData} ${L.withData === 1 ? 'semana' : 'semanas'} con carga)` },
    ...loadWeekRows(ctx),
    { label: 'Variación', value: L.pct != null ? pctTxt(L.pct) : '—' },
    { label: 'Umbrales', value: `+${num(low, 0)} % aviso suave · +${num(high, 0)} % aviso` },
  ];
  const runData = () => [
    { label: 'Km de carrera esta semana', value: `${distTxt('run', R.cur)}${ctx.inProgress ? ' (en curso)' : ''}` },
    { label: 'Semana anterior', value: distTxt('run', R.prev) },
    { label: 'Variación', value: R.pct != null ? pctTxt(R.pct) : R.prev > 0 ? `no se evalúa (menos de ${num(R.minBaseKm, 1)} km)` : 'no se evalúa (sin km la semana anterior)' },
    { label: 'Umbrales', value: `+${num(R.low, 0)} % aviso suave · +${num(R.high, 0)} % aviso · mínimo ${num(R.minBaseKm, 1)} km la semana anterior` },
  ];
  const out = [];
  if (L.pct != null && L.pct > low + EPS) {
    const hi = L.pct > high + EPS;
    out.push(sugg('load-warn', 'warn', {
      tag: hi ? 'Aviso' : 'Aviso suave',
      severity: hi ? 'high' : 'soft',
      title: `${hi ? 'Aviso' : 'Aviso suave'}: la carga sube un ${num(L.pct, 0)} %`,
      text: `${now} carga de esta semana (${loadTxt(L.total)}) supera en un ${num(L.pct, 0)} % la media de ${weeksTxt(L.weeks)} (${loadTxt(L.mean)}). Aviso orientativo: conviene que las subidas de carga sean graduales.`,
      rule: loadRuleTxt,
      data: loadData(),
      pct: L.pct,
    }));
  }
  if (R.pct != null && R.pct > R.low + EPS) {
    const hi = R.pct > R.high + EPS;
    out.push(sugg('runkm-warn', 'warn', {
      tag: hi ? 'Aviso' : 'Aviso suave',
      severity: hi ? 'high' : 'soft',
      title: `${hi ? 'Aviso' : 'Aviso suave'}: km de carrera +${num(R.pct, 0)} %`,
      text: `${ctx.inProgress ? 'De momento llevas' : 'Corriste'} ${distTxt('run', R.cur)} esta semana frente a ${distTxt('run', R.prev)} la anterior (+${num(R.pct, 0)} %). Aviso orientativo: en carrera conviene subir el volumen de forma gradual.`,
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
  else parts.push(`La carga queda ${L.pct >= 0 ? `un ${num(L.pct, 0)} % por encima` : `un ${num(-L.pct, 0)} % por debajo`} de tu media (aviso desde +${num(low, 0)} %)`);
  const runs = R.cur > 0 || R.prev > 0;
  if (runs) {
    if (R.evaluated) parts.push(ctx.inProgress ? `km de carrera: de momento ${distTxt('run', R.cur)} frente a ${distTxt('run', R.prev)} (aviso desde +${num(R.low, 0)} %)` : `km de carrera ${pctTxt(R.pct)} frente a la semana anterior (aviso desde +${num(R.low, 0)} %)`);
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

/** Check-in «bajo»: sueño o energía bajos (1) o agujetas altas (3). */
export function isLowCheckin(c) {
  return !!c && (c.sleep === 1 || c.energy === 1 || c.soreness === 3);
}

function checkinText(c) {
  const parts = [];
  if (c.sleep) parts.push(`sueño ${CK_LEVEL[c.sleep] || '—'}`);
  if (c.energy) parts.push(`energía ${CK_LEVEL[c.energy] || '—'}`);
  if (c.soreness) parts.push(`agujetas ${CK_SORE[c.soreness] || '—'}`);
  return parts.join(' · ') || 'sin valores';
}

function deloadMessage(ctx) {
  if (!ctx.hasStrength) return null;
  const { minStalled, rpeHigh } = ctx.cfg.deload;
  const W = Math.max(1, Math.round(ctx.cfg.deload.weeks));
  const from = addDays(ctx.ref, -7 * W + 1);
  const stalled = classify(ctx).list.filter((x) => x.status === 'stalled');
  const a = stalled.length >= minStalled;
  const rpeSessions = ctx.sessions.filter((s) => s.kind === 'strength' && s.date >= from && s.date <= ctx.ref && s.rpe >= 1)
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const rpeMean = rpeSessions.length ? rpeSessions.reduce((t, s) => t + s.rpe, 0) / rpeSessions.length : null;
  const b = rpeSessions.length >= MIN_RPE_SESSIONS && rpeMean >= rpeHigh - EPS;
  const cks = toArr(ctx.d.checkins)
    .filter((c) => c && isDateStr(c.date) && c.date >= from && c.date <= ctx.ref && (c.sleep || c.energy || c.soreness))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (x.timing === 'pre' ? -1 : 1)));
  const lows = cks.filter(isLowCheckin);
  const cApplies = cks.length > 0;
  const c = !cApplies || lows.length * 2 >= cks.length;
  const period = `${day(from)}–${day(ctx.ref)}`;
  const rule = `Se sugiere una semana de descarga solo si coinciden: (a) al menos ${num(minStalled, 0)} ejercicios estancados (ver «Ejercicios estancados»); (b) esfuerzo percibido (RPE) medio de las sesiones de fuerza de las últimas ${W} semanas de ${n1(rpeHigh)} o más, con al menos ${MIN_RPE_SESSIONS} sesiones con esfuerzo registrado; y (c) si registraste check-ins en ese periodo, que al menos la mitad sean bajos (sueño o energía bajos, o agujetas altas). Umbrales en Ajustes › Umbrales › Sugerencia de descarga.`;
  const data = [
    { label: '(a) Ejercicios estancados', value: `${num(stalled.length, 0)} (mínimo ${num(minStalled, 0)}) · ${cumple(a)}` },
    ...stalled.map((x) => ({ label: x.name, value: `mejor ${kg1((x.priorBest || x.best).e1rm)} · última ${kg1(x.last.e1rm)}`, sub: true })),
    {
      label: `(b) RPE medio de fuerza (${period})`,
      value: rpeSessions.length
        ? `${n1(rpeMean)} en ${plural(rpeSessions.length, 'sesión', 'sesiones')} (umbral ${n1(rpeHigh)}) · ${cumple(b)}`
        : `sin sesiones con esfuerzo registrado · ${cumple(false)}`,
    },
    ...rpeSessions.map((s) => ({ label: `${day(s.date)} · ${s.templateName || 'Sesión libre'}`, value: `RPE ${num(s.rpe, 1)}`, sub: true })),
    {
      label: `(c) Check-ins (${period})`,
      value: cApplies ? `${lows.length} de ${cks.length} bajos (hace falta la mitad) · ${cumple(c)}` : 'sin check-ins en el periodo · no se tiene en cuenta',
    },
    ...cks.map((k) => ({ label: `${day(k.date)} · ${k.timing === 'post' ? 'después' : 'antes'}`, value: `${checkinText(k)}${isLowCheckin(k) ? ' · bajo' : ''}`, sub: true })),
  ];
  const extra = { rule, data, conditions: { stalled: a, rpe: b, checkins: c, checkinsApply: cApplies }, stalledCount: stalled.length, rpeMean };
  if (a && b && c) {
    return sugg('deload', 'warn', {
      ...extra,
      tag: 'Descarga',
      title: 'Valora una semana de descarga',
      text: `Coinciden ${plural(stalled.length, 'ejercicio estancado', 'ejercicios estancados')}${cApplies ? ', ' : ' y '}un RPE medio de ${n1(rpeMean)} en las sesiones de fuerza de las últimas ${W} semanas${cApplies ? ` y check-ins bajos (${lows.length} de ${cks.length})` : ''}. Una semana con menos series y menos esfuerzo puede ayudarte a recuperar y retomar la progresión.`,
    });
  }
  const yes = (ok) => (ok ? 'sí' : 'no');
  const status = [
    `estancados ${num(stalled.length, 0)} (mínimo ${num(minStalled, 0)}): ${yes(a)}`,
    `RPE medio de fuerza ${rpeMean != null ? n1(rpeMean) : '—'} (umbral ${n1(rpeHigh)}): ${yes(b)}`,
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
 * por músculo. Los mensajes neutros de «sin avisos» no se muestran. Cada uno conserva su why.
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
        text: shortList(ups.map((m) => m.items[0].label), 3),
        why: {
          rule: ups[0].why.rule,
          data: ups.map((m) => ({ label: m.items[0].label, value: m.items[0].value })),
        },
        items: ups.map((m) => m.items[0]),
      },
    });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, max).map((x) => x.m);
}
