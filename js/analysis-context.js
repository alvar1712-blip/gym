// analysis-context.js — el contexto del usuario tal como lo usa «tu analista» (ronda 6, fase C; docs/MEJORAS6.md). PURO.
//
// Junta lo que el usuario apuntó en «Tu contexto» (contextSummary / recentChanges de context-logic.js) con lo que se ve
// en sus datos (un parón y la vuelta a entrenar, por las fechas de sus sesiones) y con su perfil (edad):
//
//   analysisContext({ context, sessions, today, profile }) → {
//     today, summary (contextSummary), recent (recentChanges, 42 días),
//     training: { returning, since, source:'context'|'event'|'detected'|null, gapDays, breakActive, deload },
//     creatine: { start, days, early (≤ 14 días), water (≤ 42 días) } | null   (sin «dejo la creatina» posterior)
//     body: { type, goal:'gain'|'lose'|'maintain', since, entry } | null      (la fase de composición vigente)
//     health: { illness, injury } (vigentes o terminadas hace ≤ 14 días; entradas o null)
//     life: { stress, travel } (vigentes), sports: [fases de preparación vigentes],
//     usualWeight: { kg, date } | null, weights (weightReferences),
//     age: { group:'minor'|'adult'|'senior'|'unknown', years:number|null },
//     changes: [{ text, date }] (cambios recientes legibles), labels: [{ key, text }] (lo vigente, para la pantalla)
//   }
// Nada de esto es una conclusión: son hechos con fecha que cada análisis usa para interpretar y para la confianza.
import { addDays, diffDays, isDateStr, todayStr, fmtDate } from './util.js';
import { contextSummary, recentChanges, weightReferences, entryRange, entryTitle, entryWhen, normalizeAll, approxFrom } from './context-logic.js';
import { ageGroup, ageOn } from './profile.js';

/** Parón detectado: este tiempo o más sin ninguna sesión terminada (de cualquier tipo). */
export const BREAK_DAYS = 21;
/** La vuelta tras un parón cuenta como reciente estas semanas. */
export const RETURN_DAYS = 56;
/** Creatina: los primeros 14 días (subida rápida de agua) y hasta 6 semanas (aún puede notarse en el peso). */
export const CREATINE_EARLY_DAYS = 14;
export const CREATINE_WATER_DAYS = 42;
/** Enfermedad o lesión terminada hace poco: sigue contando unos días. */
export const HEALTH_TAIL_DAYS = 14;
/** Cambios recientes del contexto (como context-logic.RECENT_DAYS). */
export const CHANGE_DAYS = 42;

const BODY_GOAL = { gain: 'gain', deficit: 'lose', maintain: 'maintain', recomp: 'maintain' };
const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);
const dayTxt = (d, today) => fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full');

/** Fechas (ordenadas, sin repetir) con alguna sesión terminada hasta hoy. */
function sessionDates(sessions, today) {
  const set = new Set();
  for (const s of toArr(sessions)) if (s && s.status === 'done' && isDateStr(s.date) && s.date <= today) set.add(s.date);
  return [...set].sort();
}

/**
 * Parón y vuelta según las fechas de las sesiones: el último hueco de BREAK_DAYS días o más cuya sesión de vuelta es de
 * las últimas RETURN_DAYS. → { since, gapDays, gapFrom } | null
 */
export function detectReturn(sessions, today = todayStr()) {
  const ds = sessionDates(sessions, today);
  for (let i = ds.length - 1; i > 0; i--) {
    const gap = diffDays(ds[i - 1], ds[i]);
    if (gap >= BREAK_DAYS) {
      if (diffDays(ds[i], today) > RETURN_DAYS) return null;
      return { since: ds[i], gapDays: gap, gapFrom: ds[i - 1] };
    }
    if (diffDays(ds[i], today) > RETURN_DAYS) return null;
  }
  return null;
}

function changeText(c, today) {
  const t = entryTitle(c.entry);
  if (c.what === 'event') return `${t} (${dayTxt(c.date, today)})`;
  if (c.what === 'start') return `Empieza: ${t.charAt(0).toLowerCase()}${t.slice(1)} (${dayTxt(c.date, today)})`;
  return `Termina: ${t.charAt(0).toLowerCase()}${t.slice(1)} (${dayTxt(c.date, today)})`;
}

/**
 * Contexto para el análisis de un día. `context` = almacén 'context' (se sanea aquí), `sessions` = las sesiones,
 * `profile` = getProfile(settings).
 */
export function analysisContext({ context = [], sessions = [], today = todayStr(), profile = {} } = {}) {
  const t = isDateStr(today) ? today : todayStr();
  const list = normalizeAll(context);
  const summary = contextSummary(list, t);
  const recent = recentChanges(list, t, CHANGE_DAYS);
  const recentFrom = addDays(t, -RETURN_DAYS);

  // Entrenamiento: parón vigente, vuelta (apuntada en una fase o un hecho, o detectada por las fechas) y descarga
  const trPhases = summary.byAspect.training;
  const breakActive = trPhases.some((p) => p.type === 'break');
  const returnPhase = trPhases.find((p) => p.type === 'return' || p.type === 'recondition') || null;
  const returnEvent = list.filter((e) => e.kind === 'event' && e.type === 'gym_return' && entryRange(e).from >= recentFrom && entryRange(e).from <= t)
    .sort((a, b) => (entryRange(a).from < entryRange(b).from ? 1 : -1))[0] || null;
  const detected = detectReturn(sessions, t);
  let training = { returning: false, since: null, source: null, gapDays: detected?.gapDays ?? null, breakActive, deload: trPhases.some((p) => p.type === 'deload') };
  if (returnPhase) training = { ...training, returning: true, since: approxFrom(returnPhase.start), source: 'context', entry: returnPhase };
  else if (returnEvent) training = { ...training, returning: true, since: entryRange(returnEvent).from, source: 'event', entry: returnEvent };
  else if (detected) training = { ...training, returning: true, since: detected.since, source: 'detected', gapFrom: detected.gapFrom };

  // Creatina: el último «empiezo» sin un «dejo» posterior
  const evs = (type) => list.filter((e) => e.kind === 'event' && e.type === type && entryRange(e).from <= t).map((e) => entryRange(e).from).sort();
  const cStart = evs('creatine_start').pop() || null;
  const cStop = evs('creatine_stop').pop() || null;
  let creatine = null;
  if (cStart && !(cStop && cStop >= cStart)) {
    const days = diffDays(cStart, t);
    creatine = { start: cStart, days, early: days <= CREATINE_EARLY_DAYS, water: days <= CREATINE_WATER_DAYS };
  }

  // Composición: la fase vigente más reciente
  const bodyPhase = summary.byAspect.body.find((p) => BODY_GOAL[p.type]) || null;
  const body = bodyPhase ? { type: bodyPhase.type, goal: BODY_GOAL[bodyPhase.type], since: approxFrom(bodyPhase.start), entry: bodyPhase } : null;

  // Salud: vigente o terminada hace poco (fases y hechos)
  const tailFrom = addDays(t, -HEALTH_TAIL_DAYS);
  const healthOf = (type) => list.filter((e) => e.type === type && (
    e.kind === 'phase' ? (entryRange(e).from <= t && (entryRange(e).to == null || entryRange(e).to >= tailFrom))
      : (entryRange(e).from <= t && entryRange(e).to >= tailFrom)))
    .sort((a, b) => (entryRange(a).from < entryRange(b).from ? 1 : -1))[0] || null;
  const health = { illness: healthOf('illness'), injury: healthOf('injury') };
  const life = { stress: summary.byAspect.life.find((p) => p.type === 'stress') || null, travel: summary.byAspect.life.find((p) => p.type === 'travel') || null };

  const years = ageOn(profile?.birthDate, t);
  const age = { group: ageGroup(profile, t), years };

  // Textos: lo vigente (labels) y los cambios recientes (changes)
  const labels = [];
  for (const p of summary.phases) labels.push({ key: `phase:${p.type}`, text: `${entryTitle(p)} · ${entryWhen(p)}` });
  if (training.returning && training.source === 'detected') {
    labels.push({ key: 'return:detected', text: `Vuelta tras ${Math.round(training.gapDays / 7)} semanas sin entrenar · desde el ${dayTxt(training.since, t)}` });
  } else if (training.returning && training.source === 'event') {
    labels.push({ key: 'return:event', text: `Vuelta al gimnasio · ${dayTxt(training.since, t)}` });
  }
  if (creatine) labels.push({ key: 'creatine', text: `Creatina · desde el ${dayTxt(creatine.start, t)}` });
  if (summary.usualWeight) labels.push({ key: 'usualWeight', text: `Peso habitual apuntado: ${String(summary.usualWeight.kg).replace('.', ',')} kg` });
  for (const k of ['illness', 'injury']) {
    const e = health[k];
    if (e && e.kind === 'event') labels.push({ key: `health:${k}`, text: `${entryTitle(e)} · ${entryWhen(e)}` });
  }
  const changes = recent.map((c) => ({ text: changeText(c, t), date: c.date, type: c.entry.type, what: c.what }));

  return {
    today: t, summary, recent, training, creatine, body, health, life,
    sports: summary.byAspect.sport, usualWeight: summary.usualWeight, weights: weightReferences(list, t),
    age, labels, changes,
  };
}

/** Contexto vacío (sin nada apuntado ni detectado) para los análisis llamados sin contexto. */
export function emptyContext(today = todayStr(), profile = {}) {
  return analysisContext({ context: [], sessions: [], today, profile });
}
