// plan.js — lógica de calendario: semana tipo (con vigencias), excepciones por día y estados.
// PROPIETARIO: módulo de calendario. Las funciones de este bloque inicial son CONTRATO
// (las usa Ajustes): conservar nombres y firmas.
//
// Estructura del archivo:
//  1. Contrato de semana tipo (patternFor, setWeekPattern, currentPattern).
//  2. Lógica PURA: recibe un contexto `ctx = { settings, plan, sessions, templates, today, since? }`
//     (plan: Map fecha → excepción; templates: Map id → plantilla). No lee el store: se prueba en Node.
//     `since` (opcional) = primer día con registro: los días anteriores sin sesiones no son «saltados»
//     sino 'none' (sin registro), para que instalar la app no llene de rojo las semanas previas.
//  3. Envoltorios que leen del store (ctxFromStore) y mutaciones (overrideDay, swapDays…).
//     Modificar un día concreto NUNCA toca settings.weekPatterns.
import * as store from './store.js';
import { weekStart, todayStr, deepClone, dow, weekDates, addDays, addMonths, dateFromTs } from './util.js';
import { isWorkSet } from './calc.js';
import { ACTIVITY_LABEL, ACTIVITY_EMOJI } from './seed.js';

/** Semana tipo vigente para una fecha: days[0]=lunes … days[6]=domingo. */
export function patternFor(settings, date) {
  const list = [...(settings.weekPatterns || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  let cur = list[0] || { days: Array.from({ length: 7 }, () => ({ kind: 'rest' })) };
  for (const p of list) if (p.from <= date) cur = p;
  return cur.days;
}

/**
 * Guarda una nueva semana tipo vigente desde el lunes de la semana actual
 * (las semanas anteriores conservan su semana tipo). Devuelve la promesa de guardado.
 */
export function setWeekPattern(days, { from = weekStart(todayStr()) } = {}) {
  const s = store.settings();
  const list = (s.weekPatterns || []).filter((p) => p.from !== from);
  list.push({ from, days: deepClone(days) });
  list.sort((a, b) => (a.from < b.from ? -1 : 1));
  return store.saveSettings({ weekPatterns: list });
}

/**
 * ¿Hay semana tipo? Sin ninguna vigencia guardada (perfil nuevo que saltó «Tu semana», ronda 8 B2) no hay
 * planificación: todos los días salen como descanso y Hoy ofrece una sesión libre en lugar de «Te toca hoy».
 */
export function hasWeekPattern(settings) {
  return Array.isArray(settings?.weekPatterns) && settings.weekPatterns.length > 0;
}

/** Semana tipo vigente hoy. */
export function currentPattern() {
  return patternFor(store.settings(), todayStr());
}

// ===========================================================================
// Constantes
// ===========================================================================

// 'none' = día anterior al inicio del registro (ver ctx.since): no se cuenta como saltado.
export const STATUSES = ['done', 'partial', 'substituted', 'skipped', 'rest', 'pending', 'none'];
/** Estados que se pueden fijar a mano («Marcar como…»). */
export const MANUAL_STATUSES = ['done', 'partial', 'substituted', 'skipped', 'rest'];
export const STATUS_LABEL = {
  done: 'hecho',
  partial: 'hecho parcialmente',
  substituted: 'sustituido',
  skipped: 'saltado',
  rest: 'descanso',
  pending: 'pendiente',
  none: 'sin registro',
};
export const PLAN_KINDS = ['template', 'rest', 'free'];
export const MISSING_TEMPLATE_LABEL = 'Plantilla eliminada';

// ===========================================================================
// Lógica PURA
// ===========================================================================

const CTX = Symbol('planCtx');

const toMap = (x) => {
  if (x instanceof Map) return x;
  if (Array.isArray(x)) return new Map(x.filter(Boolean).map((o) => [o.id, o]));
  return new Map(Object.entries(x || {}));
};

/**
 * Normaliza un contexto: acepta plan/templates como Map, array u objeto y rellena `today`.
 * Si ya está normalizado lo devuelve tal cual (las funciones se pueden encadenar sin coste).
 */
export function makeCtx(ctx = {}) {
  if (ctx[CTX]) return ctx;
  const out = {
    settings: ctx.settings || { weekPatterns: [] },
    plan: toMap(ctx.plan),
    sessions: Array.isArray(ctx.sessions) ? ctx.sessions : [],
    templates: toMap(ctx.templates),
    exercises: toMap(ctx.exercises),
    today: ctx.today || todayStr(),
    since: ctx.since || null,
  };
  Object.defineProperty(out, CTX, { value: { index: null, indexLen: -1, indexOf: null } });
  return out;
}

/** DayPlan limpio: {kind:'template', templateId} | {kind:'rest'} | {kind:'free', label, activityKind}. */
export function normalizePlan(p) {
  if (!p || !PLAN_KINDS.includes(p.kind)) return { kind: 'rest' };
  if (p.kind === 'template') return { kind: 'template', templateId: p.templateId ?? null };
  if (p.kind === 'free') {
    const activityKind = p.activityKind || 'other';
    return { kind: 'free', label: p.label || ACTIVITY_LABEL[activityKind] || 'Sesión libre', activityKind };
  }
  return { kind: 'rest' };
}

/** ¿Dos planes de día son el mismo? (misma plantilla, descanso, o misma sesión libre). */
export function samePlan(a, b) {
  const x = normalizePlan(a);
  const y = normalizePlan(b);
  if (x.kind !== y.kind) return false;
  if (x.kind === 'template') return x.templateId === y.templateId;
  if (x.kind === 'free') return x.activityKind === y.activityKind && x.label === y.label;
  return true;
}

/** Día de la semana tipo vigente para la fecha. */
export function patternDay(settings, date) {
  return normalizePlan(patternFor(settings || {}, date)[dow(date)]);
}

/** Plantilla utilizable (existe y no está archivada) o null. */
export function templateAvailable(templateId, templates) {
  const t = templateId ? toMap(templates).get(templateId) : null;
  return t && !t.archived ? t : null;
}

/** Nombre legible de un plan de día. Plantilla borrada o archivada → «Plantilla eliminada». */
export function planLabel(plan, templates) {
  const p = normalizePlan(plan);
  if (p.kind === 'rest') return 'Descanso';
  if (p.kind === 'free') return p.label;
  const t = templateAvailable(p.templateId, templates);
  return t ? t.name : MISSING_TEMPLATE_LABEL;
}

/**
 * Emoji del plan: 😴 descanso, el de la actividad en sesión libre y, en una plantilla, 🏋️ salvo que
 * la mayoría de sus ítems sean de cardio (entonces, el del deporte del primero: «Día 3 — Cardio» → 🏃).
 * Acepta el resultado de effectiveDay (que ya trae `emoji`) o un DayPlan con `template` + mapa de ejercicios.
 */
export function planEmoji(plan, exercises = null) {
  if (plan && typeof plan.emoji === 'string') return plan.emoji;
  const p = normalizePlan(plan);
  if (p.kind === 'rest') return '😴';
  if (p.kind === 'free') return ACTIVITY_EMOJI[p.activityKind] || '⚡';
  const items = (plan && plan.template && plan.template.items) || [];
  const exMap = toMap(exercises);
  const sports = items.map((it) => cardioSport(exMap.get(it.exerciseId))).filter(Boolean);
  if (items.length && sports.length * 2 > items.length) return ACTIVITY_EMOJI[sports[0]] || '🏋️';
  return '🏋️';
}

/** Deporte de un ejercicio de cardio (logType 'cardio' con `sport`), o null. */
function cardioSport(ex) {
  return ex && ex.logType === 'cardio' && ex.sport ? ex.sport : null;
}

/**
 * Plan efectivo de un día: excepción del calendario si cambia el plan; si no, semana tipo vigente.
 * @returns {{date, kind, templateId, label, activityKind, source:'pattern'|'override', substituted:boolean,
 *            override:object|null, patternDay:object, template:object|null, missing:boolean, emoji:string}}
 *  substituted = hay excepción y su plan es distinto del de la semana tipo (distintivo «Cambiado»).
 *  missing     = el plan es una plantilla borrada o archivada.
 */
export function effectiveDay(date, ctx) {
  const c = makeCtx(ctx);
  const pDay = patternDay(c.settings, date);
  const override = c.plan.get(date) || null;
  const hasOverride = !!(override && PLAN_KINDS.includes(override.kind));
  const plan = hasOverride ? normalizePlan(override) : pDay;
  const template = plan.kind === 'template' ? templateAvailable(plan.templateId, c.templates) : null;
  return {
    date,
    kind: plan.kind,
    templateId: plan.kind === 'template' ? plan.templateId : null,
    label: planLabel(plan, c.templates),
    activityKind: plan.kind === 'free' ? plan.activityKind : null,
    source: hasOverride ? 'override' : 'pattern',
    substituted: hasOverride && !samePlan(plan, pDay),
    override,
    patternDay: pDay,
    template,
    missing: plan.kind === 'template' && !template,
    emoji: planEmoji({ ...plan, template }, c.exercises),
  };
}

/** DayPlan limpio a partir del resultado de effectiveDay (para guardarlo en otro día). */
export function planOf(eff) {
  return normalizePlan(eff);
}

/** Índice fecha de plan → sesiones que cuentan (se reconstruye si cambia la lista). */
function sessionIndex(c) {
  const meta = c[CTX];
  if (meta.index && meta.indexLen === c.sessions.length && meta.indexOf === c.sessions) return meta.index;
  const idx = new Map();
  for (const s of c.sessions) {
    if (!s || s.status !== 'done' || s.parentId) continue;
    const key = s.planDate ?? s.date;
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(s);
  }
  for (const list of idx.values()) list.sort((a, b) => (a.startedAt || a.createdAt || 0) - (b.startedAt || b.createdAt || 0));
  meta.index = idx;
  meta.indexLen = c.sessions.length;
  meta.indexOf = c.sessions;
  return idx;
}

/**
 * Sesiones que cuentan para un día: terminadas, con (planDate ?? date) === fecha y sin parentId
 * (las actividades enlazadas a una sesión de fuerza cuentan dentro de ella).
 */
export function daySessions(date, ctx) {
  return sessionIndex(makeCtx(ctx)).get(date) || [];
}

/**
 * Instante (ms) codificado en un id de util.uid() («s_» + Date.now() en base 36 + aleatorio), o null si
 * el id no tiene ese formato (ids de la carga inicial como 'ti_d1_1', ids escritos a mano…). pura
 */
export function idTime(id) {
  const m = /^[a-z]+_([0-9a-z]{8})/.exec(typeof id === 'string' ? id : '');
  if (!m) return null;
  const t = parseInt(m[1], 36);
  return t > 1e12 && t < 4e12 ? t : null; // 2001–2096: descarta textos que solo lo parecen
}

/**
 * ¿Está completa una sesión de fuerza respecto a su plantilla?
 * Un ítem está cubierto si su ejercicio de sesión tiene ≥1 serie de trabajo o una actividad enlazada
 * (parentId = session.id) o, si es de cardio, una actividad SUELTA del mismo deporte (`opts.loose`: la
 * carrera o la bici del día registradas fuera de la sesión; cada una cubre un solo ítem).
 * Ítems considerados (no depende de `updatedAt`, así que editar la plantilla no cambia días pasados):
 *  - con `session.templateItemIds` (instantánea al crear la sesión): esos ítems, si siguen en la plantilla;
 *  - sin ella: los ítems que la sesión conoce más los que ya existían al crearla (por el instante de su
 *    id; los ids sin instante, como los de la carga inicial, cuentan como previos).
 *  Así, un ejercicio quitado con «Quitar de esta sesión» sigue contando como pendiente, y uno añadido a la
 *  plantilla después no convierte la sesión en parcial. Si la plantilla ya no existe, se usa la
 *  instantánea de la sesión (sus ejercicios con templateItemId).
 * @param {object} session  (`{exercises:[]}` para evaluar solo actividades sueltas)
 * @param {object|null} template
 * @param {{sessions?:object[], exercises?:Map}} [ctx] actividades enlazadas y ejercicios (nombres, deporte)
 * @param {{loose?:object[]}} [opts]
 * @returns {{total:number, covered:number, complete:boolean, missing:string[]}}  missing = nombres
 */
export function completeness(session, template, ctx = null, { loose = [] } = {}) {
  const ses = (session && session.exercises) || [];
  const sid = session && session.id;
  const linked = sid ? (ctx && Array.isArray(ctx.sessions) ? ctx.sessions : [])
    .filter((a) => a && a.parentId === sid && a.kind !== 'strength') : [];
  const exMap = ctx && ctx.exercises instanceof Map ? ctx.exercises : null;
  const exName = (id) => (exMap ? exMap.get(id)?.name : null) || id;
  const sportOf = (ids) => ids.map((id) => cardioSport(exMap && exMap.get(id))).find(Boolean) || null;
  const covers = (se) => (se.sets || []).some(isWorkSet) || linked.some((a) => a.parentItemId === se.id);

  // Unidades a cubrir: {mine: ejercicios de sesión, exIds: ejercicio(s) del ítem, name}.
  const units = [];
  const items = template && Array.isArray(template.items) ? template.items : null;
  if (items) {
    const known = new Set(ses.map((se) => se.templateItemId).filter(Boolean));
    const snap = session && Array.isArray(session.templateItemIds) ? new Set(session.templateItemIds) : null;
    const born = sid ? idTime(sid) ?? session.createdAt ?? null : null;
    const existed = (it) => {
      const t = idTime(it.id);
      return t == null || born == null || t <= born;
    };
    for (const it of items) {
      if (!known.has(it.id) && !(snap ? snap.has(it.id) : existed(it))) continue;
      const mine = ses.filter((se) => se.templateItemId === it.id);
      units.push({ mine, exIds: [...mine.map((se) => se.exerciseId), it.exerciseId], name: (mine[0] && mine[0].exName) || exName(it.exerciseId) });
    }
  } else {
    const snap = ses.filter((se) => se.templateItemId);
    for (const se of snap.length ? snap : ses) units.push({ mine: [se], exIds: [se.exerciseId], name: se.exName || exName(se.exerciseId) });
  }

  const done = units.map((u) => u.mine.some(covers));
  // Actividades sueltas: solo para los ítems de cardio aún sin cubrir, cada una una vez.
  const pool = (loose || []).filter((a) => a && !a.parentId && a.kind !== 'strength');
  units.forEach((u, i) => {
    if (done[i] || !pool.length) return;
    const sport = sportOf(u.exIds);
    const at = sport ? pool.findIndex((a) => a.kind === sport) : -1;
    if (at >= 0) { pool.splice(at, 1); done[i] = true; }
  });
  const total = units.length;
  const covered = done.filter(Boolean).length;
  const missing = units.filter((_, i) => !done[i]).map((u) => u.name);
  return { total, covered, complete: total === 0 ? true : covered === total, missing };
}

/** Estado automático (sin mirar el estado manual). */
function autoStatus(date, eff, sessions, c) {
  if (!sessions.length) {
    if (eff.kind === 'rest') return { status: 'rest', reason: 'Día de descanso.' };
    if (c.since && date < c.since) return { status: 'none', reason: 'Es anterior a tu primer registro en la app.' };
    if (date < c.today) return { status: 'skipped', reason: 'No hay ninguna sesión registrada para este día.' };
    return { status: 'pending', reason: date === c.today ? 'Aún no has registrado la sesión de hoy.' : 'Día futuro.' };
  }
  if (eff.kind === 'rest') return { status: 'done', extra: true, reason: 'Entreno extra en un día de descanso.' };
  if (eff.kind === 'template') {
    // Plantilla del día (de la semana tipo, cambiada o movida): hecho / parcial según lo registrado de
    // ESA plantilla; las actividades sueltas cubren sus ítems de cardio (la carrera del Día 3 desde Hoy).
    const own = sessions.filter((s) => s.kind === 'strength' && s.templateId && s.templateId === eff.templateId);
    const loose = sessions.filter((s) => s.kind !== 'strength');
    const tpl = c.templates.get(eff.templateId) || null;
    const comps = own.map((s) => completeness(s, tpl, c, { loose }));
    if (!own.length && tpl && loose.length) {
      const only = completeness({ exercises: [] }, tpl, c, { loose });
      if (only.covered) comps.push(only);
    }
    if (!comps.length) {
      return {
        status: 'substituted',
        reason: eff.substituted
          ? `Has hecho otra sesión en lugar de la planificada (semana tipo: ${planLabel(eff.patternDay, c.templates)}).`
          : 'Has hecho otra sesión en lugar de la planificada.',
      };
    }
    const best = comps.reduce((a, b) => (b.covered / (b.total || 1) > a.covered / (a.total || 1) ? b : a));
    if (comps.some((x) => x.complete)) return { status: 'done', completeness: best, reason: 'Todos los ejercicios de la rutina están registrados.' };
    const miss = best.missing.length ? ` Sin registrar: ${best.missing.slice(0, 4).join(', ')}${best.missing.length > 4 ? '…' : ''}.` : '';
    return { status: 'partial', completeness: best, reason: `${best.covered} de ${best.total} ejercicios registrados.${miss}` };
  }
  // Sesión libre. Si sustituye a una rutina de la semana tipo (p. ej. el Día 6 → ruta en bici) el día
  // queda «sustituido»; si está en la semana tipo o se planifica en un descanso, «hecho» si coincide el tipo.
  if (eff.substituted && eff.patternDay.kind !== 'rest') {
    return { status: 'substituted', reason: `Has cambiado el plan de este día (semana tipo: ${planLabel(eff.patternDay, c.templates)}).` };
  }
  const want = eff.activityKind;
  if (sessions.some((s) => s.kind === want)) return { status: 'done', reason: 'Has registrado la actividad planificada.' };
  return { status: 'substituted', reason: 'Has hecho otra actividad en lugar de la planificada.' };
}

/**
 * Estado de un día (ver §4 de ARCHITECTURE.md):
 *  1. estado manual si existe; 2. sesiones que cuentan; 3. descanso → rest / done (extra);
 *  4. plantilla (de la semana tipo, cambiada o movida) → done / partial según lo registrado de ESA
 *  plantilla (las actividades sueltas cubren sus ítems de cardio); nada de ella → substituted;
 *  5. sesión libre que sustituye a una rutina de la semana tipo → substituted; en la semana tipo o en
 *  un descanso → done si coincide el tipo, si no substituted;
 *  6. sin sesiones → skipped (pasado) / pending (hoy o futuro); antes de ctx.since → none.
 * @returns {{status, manual:boolean, auto:string, sessions:object[], reason:string, extra:boolean,
 *            completeness:object|null, plan:object}}
 */
export function dayStatus(date, ctx) {
  const c = makeCtx(ctx);
  const eff = effectiveDay(date, c);
  const sessions = daySessions(date, c);
  const auto = autoStatus(date, eff, sessions, c);
  const manual = eff.override && MANUAL_STATUSES.includes(eff.override.status) ? eff.override.status : null;
  return {
    status: manual || auto.status,
    manual: !!manual,
    auto: auto.status,
    sessions,
    reason: manual ? 'Marcado a mano.' : auto.reason,
    extra: !manual && !!auto.extra,
    completeness: auto.completeness || null,
    plan: eff,
  };
}

/** Semana (lunes ws): 7 × {date, plan, status, manual, sessions, reason, extra}. */
export function weekPlan(ws, ctx) {
  const c = makeCtx(ctx);
  return weekDates(ws).map((date) => {
    const st = dayStatus(date, c);
    return { date, plan: st.plan, status: st.status, manual: st.manual, sessions: st.sessions, reason: st.reason, extra: st.extra };
  });
}

/**
 * Adherencia de la semana: días planificados (plan no descanso, no marcados como descanso y no
 * anteriores al inicio del registro) frente a días hechos, parciales o sustituidos.
 * Los entrenos en días de descanso van en `extra`.
 * @returns {{planned, done, partial, substituted, skipped, pending, completed, extra, pct:number|null}}
 */
export function adherence(ws, ctx) {
  const out = { planned: 0, done: 0, partial: 0, substituted: 0, skipped: 0, pending: 0, completed: 0, extra: 0, pct: null };
  for (const d of weekPlan(ws, makeCtx(ctx))) {
    const planned = d.plan.kind !== 'rest' && d.status !== 'rest' && d.status !== 'none';
    if (!planned) {
      if (d.status === 'done' || d.status === 'partial' || d.status === 'substituted') out.extra++;
      continue;
    }
    out.planned++;
    if (d.status in out) out[d.status]++;
  }
  out.completed = out.done + out.partial + out.substituted;
  out.pct = out.planned ? Math.round((out.completed / out.planned) * 100) : null;
  return out;
}

/** «3 de 5 hechas · 1 parcial · 1 saltada» */
export function adherenceText(a) {
  if (!a || !a.planned) return a && a.extra ? `Sin días planificados · ${a.extra} extra` : 'Sin días planificados';
  const parts = [`${a.completed} de ${a.planned} hechas`];
  if (a.partial) parts.push(`${a.partial} ${a.partial === 1 ? 'parcial' : 'parciales'}`);
  if (a.substituted) parts.push(`${a.substituted} ${a.substituted === 1 ? 'sustituida' : 'sustituidas'}`);
  if (a.skipped) parts.push(`${a.skipped} ${a.skipped === 1 ? 'saltada' : 'saltadas'}`);
  if (a.extra) parts.push(`${a.extra} extra`);
  return parts.join(' · ');
}

/** Lunes de las semanas que cubren el mes de `date` (para la vista mensual). */
export function monthWeeks(date) {
  const first = `${date.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const out = [];
  for (let ws = weekStart(first); ws <= last; ws = addDays(ws, 7)) out.push(ws);
  return out;
}

// ===========================================================================
// Envoltorios sobre el store
// ===========================================================================

/**
 * Primer día con registro: el más antiguo entre la instalación de la app, la primera sesión y la
 * primera excepción del calendario. pura
 */
export function trackingSince({ createdAt = null, sessions = [], plan = [] } = {}) {
  let since = createdAt ? dateFromTs(createdAt) : null;
  const consider = (d) => { if (d && (!since || d < since)) since = d; };
  for (const s of sessions) if (s) { consider(s.date); consider(s.planDate); }
  for (const p of plan) if (p) consider(p.id);
  return since;
}

/** Contexto con los datos actuales del store (constrúyelo una vez por render). */
export function ctxFromStore(today = todayStr()) {
  const sessions = store.all('sessions');
  const plan = store.all('plan');
  return makeCtx({
    settings: store.settings(),
    plan,
    sessions,
    templates: store.all('templates'),
    exercises: store.all('exercises'),
    today,
    since: trackingSince({ createdAt: store.get('meta', 'app')?.createdAt, sessions, plan }),
  });
}

/** Plan efectivo de una fecha con los datos del store. */
export function effectiveDayNow(date) {
  return effectiveDay(date, ctxFromStore());
}

/** Estado de una fecha con los datos del store. */
export function dayStatusNow(date) {
  return dayStatus(date, ctxFromStore());
}

// ===========================================================================
// Mutaciones (excepciones del calendario, store 'plan'; id = fecha)
// ===========================================================================

const PLAN_FIELDS = ['kind', 'templateId', 'label', 'activityKind'];
const isEmptyRecord = (r) => !r.kind && !r.status && !r.note;

/**
 * Registro de excepción resultante de poner `dayPlan` en `date` (null = el registro sobra).
 * Si el plan coincide con la semana tipo no se guarda como cambio. Conserva estado y nota. pura
 */
export function recordWithPlan(rec, date, dayPlan, settings) {
  const out = { ...(rec || {}), id: date };
  for (const k of PLAN_FIELDS) delete out[k];
  const plan = normalizePlan(dayPlan);
  if (!samePlan(plan, patternDay(settings, date))) Object.assign(out, plan);
  return isEmptyRecord(out) ? null : out;
}

/** Registro con el estado manual fijado (o quitado con null). pura */
export function recordWithStatus(rec, date, status) {
  if (status != null && !MANUAL_STATUSES.includes(status)) throw new Error(`Estado no válido: ${status}`);
  const out = { ...(rec || {}), id: date };
  if (status) out.status = status;
  else delete out.status;
  return isEmptyRecord(out) ? null : out;
}

/** Registro sin el cambio de plan (vuelve a la semana tipo; conserva estado y nota). pura */
export function recordWithoutPlan(rec, date) {
  if (!rec) return null;
  const out = { ...rec, id: date };
  for (const k of PLAN_FIELDS) delete out[k];
  return isEmptyRecord(out) ? null : out;
}

/** Mover días: registros resultantes de intercambiar los planes efectivos de A y B. pura */
export function swapRecords(dateA, dateB, ctx) {
  const c = makeCtx(ctx);
  const a = effectiveDay(dateA, c);
  const b = effectiveDay(dateB, c);
  return [
    recordWithPlan(a.override, dateA, planOf(b), c.settings),
    recordWithPlan(b.override, dateB, planOf(a), c.settings),
  ];
}

/** Guarda el registro, o lo elimina si ya no aporta nada. */
async function commit(date, next) {
  if (next) await store.save('plan', next);
  else if (store.get('plan', date)) await store.remove('plan', date);
  return next;
}

/**
 * Cambia el plan de UN día (no toca la semana tipo). Si el plan coincide con la semana tipo,
 * se quita la excepción. Conserva el estado manual y la nota del día.
 * @param {string} date 'YYYY-MM-DD'
 * @param {object} dayPlan DayPlan
 */
export function overrideDay(date, dayPlan) {
  return commit(date, recordWithPlan(store.get('plan', date), date, dayPlan, store.settings()));
}

/** Mover días: intercambia los planes efectivos de dos fechas. */
export function swapDays(dateA, dateB) {
  if (dateA === dateB) return Promise.resolve([]);
  const [a, b] = swapRecords(dateA, dateB, ctxFromStore());
  return Promise.all([commit(dateA, a), commit(dateB, b)]);
}

/** Fija un estado manual (done|partial|substituted|skipped|rest) o lo quita (null → automático). */
export function setManualStatus(date, status) {
  return commit(date, recordWithStatus(store.get('plan', date), date, status));
}

/**
 * Vuelve a la semana tipo en ese día (quita el cambio de plan). El estado manual y la nota se
 * conservan; para volver al estado automático usa setManualStatus(date, null).
 */
export function resetDay(date) {
  return commit(date, recordWithoutPlan(store.get('plan', date), date));
}

/**
 * Instantánea de las excepciones de unas fechas para poder deshacer.
 * @returns {() => Promise} función que las deja como estaban
 */
export function planSnapshot(...dates) {
  const prev = dates.map((d) => [d, deepClone(store.get('plan', d))]);
  return () => Promise.all(prev.map(([d, obj]) => (obj ? store.restore('plan', obj) : store.get('plan', d) ? store.remove('plan', d) : null)));
}
