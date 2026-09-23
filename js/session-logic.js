// session-logic.js — creación y lógica de sesiones de fuerza (sin DOM).
// PROPIETARIO: módulo de sesión.
// Las funciones marcadas «pura» no leen el store: reciben los datos por parámetro y se prueban en Node.
import * as store from './store.js';
import { uid, todayStr, tsFromDate, fmtNum, fmtDuration, deepClone, sum, round } from './util.js';
import { lastPerformance, orderKeyOf, isWorkSet, sessionDurationMin } from './calc.js';

/** Tipos de registro que llevan carga + repeticiones (tienen RIR, 1RM y volumen). */
export const LOAD_REP_TYPES = ['weight_reps', 'bodyweight', 'unilateral'];

// ===========================================================================
// Creación (usa el store)
// ===========================================================================

/**
 * Crea (y guarda) una sesión de fuerza en estado 'active'.
 * @param {{templateId?:string|null, date?:string, planDate?:string|null, past?:boolean}} opts
 *  - past=true: sesión con fecha anterior (sin cronómetro; la duración se introduce a mano).
 * @returns {Promise<object>} la sesión guardada
 */
export async function createStrengthSession({ templateId = null, date = todayStr(), planDate = undefined, past = false } = {}) {
  const tpl = templateId ? store.get('templates', templateId) : null;
  const now = Date.now();
  const session = {
    id: uid('s_'),
    kind: 'strength',
    date,
    planDate: planDate === undefined ? date : planDate,
    templateId: tpl ? tpl.id : null,
    templateName: tpl ? tpl.name : 'Sesión libre',
    status: 'active',
    startedAt: past ? null : now,
    endedAt: null,
    durationMin: null,
    rpe: null,
    notes: '',
    parentId: null,
    cursor: 0,
    exercises: [],
    createdAt: now,
    updatedAt: now,
  };
  if (past) session.createdAt = tsFromDate(date, 12);
  if (tpl) {
    for (const item of tpl.items || []) session.exercises.push(sessionExerciseFromItem(item, session));
  }
  await store.save('sessions', session);
  return session;
}

/** Crea el ejercicio de sesión a partir de un elemento de plantilla, con series prellenadas. */
export function sessionExerciseFromItem(item, session) {
  const ex = store.exercise(item.exerciseId);
  const se = {
    id: uid('se_'),
    exerciseId: item.exerciseId,
    exName: ex ? ex.name : '',
    templateItemId: item.id,
    // Ejercicio principal del ítem al crear la sesión (para los chips de alternativas).
    baseExerciseId: item.exerciseId,
    alternatives: [...(item.alternatives || [])],
    target: {
      sets: item.sets ?? null,
      setsMax: item.setsMax ?? null,
      repMin: item.repMin ?? null,
      repMax: item.repMax ?? null,
      timeMin: item.timeMin ?? null,
      timeMax: item.timeMax ?? null,
      distance: item.distance ?? null,
    },
    notes: item.notes || '',
    note: '',
    section: item.section || '',
    groupId: item.groupId || null,
    groupType: item.groupType || null,
    sets: [],
  };
  se.sets = prefillSets(se, session);
  return se;
}

/** Última vez (anterior a `session`) que se hizo el ejercicio. */
export function lastFor(exerciseId, session, sessions = store.all('sessions')) {
  return lastPerformance(sessions, exerciseId, {
    excludeSessionId: session?.id ?? null,
    beforeKey: session && session.date ? orderKeyOf(session) : null,
  });
}

/** Series pendientes (done:false) prellenadas con lo de la última vez. */
export function prefillSets(se, session, n = Math.max(1, se.target?.sets || 1)) {
  const ex = store.exercise(se.exerciseId);
  if (!ex || ex.logType === 'cardio') return [];
  return prefillFromLast(lastFor(se.exerciseId, session), se, n, ex.logType);
}

/**
 * Nuevo ejercicio de sesión (añadido durante la sesión, sin plantilla).
 * Objetivo: el de la última vez si lo tenía; si no, 3 series. Series prellenadas de la última vez.
 */
export function newSessionExercise(exerciseId, session, { section = '' } = {}) {
  const ex = store.exercise(exerciseId);
  const last = lastFor(exerciseId, session);
  const lt = last?.sessionExercise?.target || {};
  const se = {
    id: uid('se_'),
    exerciseId,
    exName: ex ? ex.name : '',
    templateItemId: null,
    baseExerciseId: exerciseId,
    alternatives: [],
    target: {
      sets: lt.sets ?? 3,
      setsMax: lt.setsMax ?? null,
      repMin: lt.repMin ?? null,
      repMax: lt.repMax ?? null,
      timeMin: lt.timeMin ?? null,
      timeMax: lt.timeMax ?? null,
      distance: lt.distance ?? null,
    },
    notes: '',
    note: '',
    section,
    groupId: null,
    groupType: null,
    sets: [],
  };
  if (ex && ex.logType !== 'cardio') se.sets = prefillFromLast(last, se, se.target.sets || 3, ex.logType);
  return se;
}

/**
 * Cambia el ejercicio de un ejercicio de sesión (alternativa u otro ejercicio).
 * Conserva las series hechas y vuelve a prellenar las pendientes con la última vez del nuevo.
 */
export function switchExercise(se, exerciseId, session) {
  const ex = store.exercise(exerciseId);
  const pending = (se.sets || []).filter((s) => !s.done).length;
  se.exerciseId = exerciseId;
  se.exName = ex ? ex.name : '';
  const done = (se.sets || []).filter((s) => s.done);
  // Mismo nº de pendientes; si no quedaba ninguna serie (p. ej. venía de cardio), las del objetivo.
  const n = pending > 0 ? pending : done.length === 0 ? Math.max(1, se.target?.sets || 3) : 0;
  const fresh = ex && ex.logType !== 'cardio' && n > 0
    ? prefillFromLast(lastFor(exerciseId, session), se, n, ex.logType)
    : [];
  se.sets = [...done, ...fresh];
  return se;
}

// ===========================================================================
// Series (puras)
// ===========================================================================

/** Serie pendiente nueva copiando valores de `src` (o del objetivo). pura */
export function newSet(src, se, logType = null) {
  const uni = logType === 'unilateral';
  return {
    id: uid('set_'),
    type: src ? (src.type === 'warmup' ? 'effective' : src.type) : 'effective',
    weight: src?.weight ?? null,
    reps: src?.reps ?? (se?.target?.repMin ?? null),
    repsR: src?.repsR ?? (uni ? (src?.reps ?? se?.target?.repMin ?? null) : null),
    rir: src ? (src.type === 'warmup' ? null : src.rir ?? null) : null,
    timeSec: src?.timeSec ?? (se?.target?.timeMin ?? null),
    distanceM: src?.distanceM ?? (se?.target?.distance ?? null),
    heightCm: src?.heightCm ?? null,
    note: '',
    done: false,
    doneAt: null,
  };
}

/** n series pendientes a partir de la última vez (series de trabajo, en orden). pura */
export function prefillFromLast(last, se, n, logType = null) {
  const lastWork = last ? (last.sets || []).filter((s) => s.done !== false && s.type !== 'warmup') : [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = lastWork[i] || lastWork[lastWork.length - 1] || null;
    out.push(newSet(src, se, logType));
  }
  return out;
}

/** «+ Serie»: prellenada con la última serie hecha hoy (de trabajo si la hay). pura */
export function extraSet(se, last = null, logType = null) {
  const sets = se.sets || [];
  const doneSets = sets.filter((s) => s.done);
  const src = [...doneSets].reverse().find((s) => s.type !== 'warmup')
    || doneSets[doneSets.length - 1]
    || [...sets].reverse().find((s) => s.type !== 'warmup')
    || (last ? [...last.sets].reverse().find((s) => s.type !== 'warmup') : null)
    || null;
  return newSet(src, se, logType);
}

/**
 * «+ Calentamiento»: copia el calentamiento equivalente de la última vez o,
 * si no hay, la mitad del peso de la siguiente serie de trabajo (redondeado a 2,5 kg). pura
 * Devuelve { set, index } (posición donde insertarla: antes de la primera pendiente de trabajo).
 */
export function warmupSet(se, last = null, logType = null) {
  const sets = se.sets || [];
  const k = sets.filter((s) => s.type === 'warmup').length;
  const lastWarm = last ? last.sets.filter((s) => s.type === 'warmup') : [];
  let set;
  if (lastWarm[k]) {
    set = newSet(lastWarm[k], se, logType);
  } else {
    const ref = sets.find((s) => !s.done && s.type !== 'warmup') || [...sets].reverse().find((s) => s.type !== 'warmup') || null;
    set = newSet(ref, se, logType);
    if (ref && ref.weight > 0 && (logType === 'weight_reps' || logType === 'unilateral')) {
      set.weight = Math.max(0, round(ref.weight * 0.5 / 2.5, 1) * 2.5);
    }
  }
  set.type = 'warmup';
  set.rir = null;
  let index = sets.findIndex((s) => !s.done && s.type !== 'warmup');
  if (index < 0) index = sets.length;
  return { set, index };
}

export function sameNum(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 1e-9;
}

/**
 * Herencia de peso: al confirmar la serie `fromIndex` con `newWeight` cuando estaba prellenada con
 * `prevWeight`, las siguientes series PENDIENTES de la misma clase (calentamiento / trabajo) que tenían
 * `prevWeight` pasan a `newWeight`. Muta `sets`. Devuelve cuántas cambió. pura
 */
export function inheritWeight(sets, fromIndex, prevWeight, newWeight) {
  if (sameNum(prevWeight, newWeight)) return 0;
  const src = sets[fromIndex];
  const warm = src ? src.type === 'warmup' : false;
  let n = 0;
  for (let i = fromIndex + 1; i < sets.length; i++) {
    const s = sets[i];
    if (s.done || (s.type === 'warmup') !== warm) continue;
    if (sameNum(s.weight, prevWeight)) {
      s.weight = newWeight;
      n++;
    }
  }
  return n;
}

/** Índice de la primera serie pendiente (o -1). pura */
export function firstPendingIndex(se) {
  return (se.sets || []).findIndex((s) => !s.done);
}

/** Series pendientes (sin confirmar) de toda la sesión. pura */
export function pendingCount(session) {
  return sum(session.exercises || [], (se) => (se.sets || []).filter((s) => !s.done).length);
}

/** Series hechas (incluye calentamientos) de toda la sesión. pura */
export function doneCount(session) {
  return sum(session.exercises || [], (se) => (se.sets || []).filter((s) => s.done).length);
}

/** ¿Tiene la serie el dato mínimo para registrarse? Devuelve mensaje de error o null. pura */
export function validateSet(set, logType) {
  switch (logType) {
    case 'weight_reps':
    case 'bodyweight':
    case 'jumps':
      return set.reps > 0 ? null : 'Indica las repeticiones.';
    case 'unilateral':
      return set.reps > 0 || set.repsR > 0 ? null : 'Indica las repeticiones.';
    case 'time':
      return set.timeSec > 0 ? null : 'Indica los segundos.';
    case 'distance_time':
      return set.timeSec > 0 || set.distanceM > 0 ? null : 'Indica metros o segundos.';
    default:
      return null;
  }
}

// ===========================================================================
// Formato (puras)
// ===========================================================================

const MINUS = '−';
const kgTxt = (w) => fmtNum(w, 2);

/** '+10 kg', '−15 kg asist.', '' (sin lastre). */
export function fmtLastre(w) {
  if (!(typeof w === 'number') || w === 0) return '';
  return w > 0 ? `+${kgTxt(w)} kg` : `${MINUS}${kgTxt(-w)} kg asist.`;
}

/** '45 s' ; '1:30 min' */
export function fmtSec(sec, dec = 0) {
  if (sec == null) return '—';
  if (sec >= 60 && dec === 0) return `${fmtDuration(sec)} min`;
  return `${fmtNum(sec, dec)} s`;
}

function rirTxt(rir) {
  return rir === 'F' ? '@F' : `@${rir}`;
}

/**
 * Texto de una serie según el tipo de registro.
 *  weight_reps: '80×6 @2' (kg:true → '80 kg × 6 @2')   bodyweight: '+10 kg × 8 @1' / '−15 kg asist. × 8' / '8 reps'
 *  unilateral: '20 kg × 10/9'   time: '45 s'   distance_time: '20 m en 3,4 s'   jumps: '3 reps · 45 cm'
 * opts.rir=false omite el RIR. pura
 */
export function formatSet(set, logType, { kg = false, rir = true } = {}) {
  if (!set) return '';
  const w = typeof set.weight === 'number' ? set.weight : null;
  const reps = set.reps ?? '—';
  let main;
  switch (logType) {
    case 'bodyweight': {
      const l = fmtLastre(w);
      main = l ? `${l} × ${reps}` : `${reps} reps`;
      break;
    }
    case 'unilateral': {
      const r = `${set.reps ?? '—'}/${set.repsR ?? '—'}`;
      main = w != null ? `${kgTxt(w)} kg × ${r}` : `${r} reps`;
      break;
    }
    case 'time':
      main = fmtSec(set.timeSec);
      if (w) main += ` · ${fmtLastre(w)}`;
      break;
    case 'distance_time': {
      const d = set.distanceM != null ? `${fmtNum(set.distanceM, 1)} m` : '';
      const t = set.timeSec != null ? `${fmtNum(set.timeSec, 2)} s` : '';
      main = d && t ? `${d} en ${t}` : d || t || '—';
      break;
    }
    case 'jumps':
      main = `${reps} reps${set.heightCm ? ` · ${fmtNum(set.heightCm, 1)} cm` : ''}`;
      break;
    default:
      main = w != null ? (kg ? `${kgTxt(w)} kg × ${reps}` : `${kgTxt(w)}×${reps}`) : `${reps} reps`;
  }
  if (rir && LOAD_REP_TYPES.includes(logType) && set.rir != null && set.rir !== '') main += ` ${rirTxt(set.rir)}`;
  return main;
}

function range(a, b, dec = 1) {
  if (a == null && b == null) return '';
  if (a != null && b != null && b !== a) return `${fmtNum(a, dec)}–${fmtNum(b, dec)}`;
  return fmtNum(a ?? b, dec);
}

/** «3×4–6», «2–3×30 m», «3×30–45 s», «2×8/lado», «30–45 min», «3 series». pura */
export function targetText(target, logType) {
  const t = target || {};
  const sets = range(t.sets, t.setsMax);
  if (logType === 'cardio') {
    const time = range(t.timeMin != null ? t.timeMin / 60 : null, t.timeMax != null ? t.timeMax / 60 : null, 0);
    const parts = [];
    if (time) parts.push(`${time} min`);
    if (t.distance) parts.push(`${fmtNum(t.distance / 1000, 1)} km`);
    return parts.join(' · ');
  }
  const x = (s) => (sets ? `${sets}×${s}` : s);
  const reps = range(t.repMin, t.repMax, 0);
  if (reps && logType !== 'time' && logType !== 'distance_time') return x(`${reps}${logType === 'unilateral' ? '/lado' : ''}`);
  const time = range(t.timeMin, t.timeMax, 0);
  if (time && logType !== 'distance_time') return x(`${time} s`);
  if (t.distance) return x(`${fmtNum(t.distance, 1)} m`);
  if (time) return x(`${time} s`);
  if (reps) return x(reps);
  if (sets) return `${sets} ${t.sets === 1 && !t.setsMax ? 'serie' : 'series'}`;
  return '';
}

/**
 * Mensaje del toast de récord. prs: resultado de calc.detectPRs. pura
 *  «🏆 Récord: 85 kg en Press banca · 1RM est. 98,3 kg» / «🏆 Récord de 1RM estimado: 98,3 kg en Press banca»
 *  «🏆 Récord: 8 reps con 80 kg en Press banca»
 */
export function prMessage(prs, exercise) {
  if (!prs || !prs.length) return '';
  const name = exercise?.name || '';
  const bw = exercise?.logType === 'bodyweight';
  const by = Object.fromEntries(prs.map((p) => [p.kind, p]));
  // En peso corporal el 1RM incluye el propio peso: solo se nombra si es el único récord.
  const e1 = by.e1rm && !bw ? `1RM est. ${fmtNum(by.e1rm.value, 1)} kg` : '';
  const loadTxt = (w) => (bw ? (w ? fmtLastre(w) : 'peso corporal') : `${kgTxt(w)} kg`);
  if (by.weight) return `🏆 Récord: ${loadTxt(by.weight.value)} en ${name}${e1 ? ` · ${e1}` : ''}`;
  if (by.reps) return `🏆 Récord: ${by.reps.value} reps con ${loadTxt(by.reps.weight)} en ${name}${e1 ? ` · ${e1}` : ''}`;
  if (by.e1rm) return `🏆 Récord de 1RM estimado${bw ? ' (con peso corporal)' : ''}: ${fmtNum(by.e1rm.value, 1)} kg en ${name}`;
  if (by.time) {
    return by.time.distanceM
      ? `🏆 Récord: ${fmtNum(by.time.value, 2)} s en ${fmtNum(by.time.distanceM, 1)} m (${name})`
      : `🏆 Récord: ${fmtSec(by.time.value)} en ${name}`;
  }
  if (by.height) return `🏆 Récord: salto de ${fmtNum(by.height.value, 1)} cm en ${name}`;
  return `🏆 Récord en ${name}`;
}

/** Descripción corta de un récord para listas (resumen). pura */
export function prLabel(pr, exercise) {
  const bw = exercise?.logType === 'bodyweight';
  const w = (v) => (bw ? (v ? fmtLastre(v) : 'peso corporal') : `${kgTxt(v)} kg`);
  switch (pr.kind) {
    case 'weight': return `Peso máximo: ${w(pr.value)} (antes ${w(pr.prev)})`;
    case 'e1rm': return `1RM estimado${bw ? ' (con peso corporal)' : ''}: ${fmtNum(pr.value, 1)} kg (antes ${fmtNum(pr.prev, 1)} kg)`;
    case 'reps': return `${pr.value} reps con ${w(pr.weight)} (antes ${pr.prev})`;
    case 'time': return pr.distanceM
      ? `${fmtNum(pr.value, 2)} s en ${fmtNum(pr.distanceM, 1)} m (antes ${fmtNum(pr.prev, 2)} s)`
      : `${fmtSec(pr.value)} (antes ${fmtSec(pr.prev)})`;
    case 'height': return `Salto de ${fmtNum(pr.value, 1)} cm (antes ${fmtNum(pr.prev, 1)} cm)`;
    default: return 'Récord';
  }
}

// ===========================================================================
// Terminar (puras)
// ===========================================================================

/** Actividades (carrera, bici…) enlazadas a la sesión (opcionalmente a un ítem). pura */
export function linkedActivities(session, sessions, seId = null) {
  return (sessions || []).filter((a) => a && a.kind !== 'strength' && a.parentId === session.id
    && (seId == null || a.parentItemId === seId));
}

/**
 * Duración propuesta al terminar: minutos desde el inicio menos la duración de las actividades
 * enlazadas (para no contar dos veces la carga). Sesión pasada (sin startedAt): proposed = null. pura
 */
export function proposedDuration(session, activities = [], now = Date.now()) {
  const activitiesMin = Math.round(sum(activities, (a) => sessionDurationMin(a)));
  if (!session.startedAt) return { elapsedMin: null, activitiesMin, proposed: null };
  const elapsedMin = Math.max(0, Math.round((now - session.startedAt) / 60000));
  return { elapsedMin, activitiesMin, proposed: Math.max(0, elapsedMin - activitiesMin) };
}

/**
 * Cierra la sesión: descarta las series pendientes y fija estado, fin, duración, RPE y notas.
 * Muta `session`. Devuelve el nº de series descartadas. pura
 */
export function finishSession(session, { durationMin = null, rpe = null, notes = session.notes, now = Date.now() } = {}) {
  let discarded = 0;
  for (const se of session.exercises || []) {
    const before = (se.sets || []).length;
    se.sets = (se.sets || []).filter((s) => s.done);
    discarded += before - se.sets.length;
  }
  session.status = 'done';
  session.endedAt = session.startedAt ? now : null;
  session.durationMin = durationMin != null && Number.isFinite(durationMin) ? Math.max(0, Math.round(durationMin)) : null;
  session.rpe = rpe >= 1 && rpe <= 10 ? rpe : null;
  session.notes = notes || '';
  return discarded;
}

// ===========================================================================
// Diferencias con la plantilla (puras)
// ===========================================================================

/** Empareja ítems de plantilla con ejercicios de sesión (el primero que lo referencia). */
function matchItems(template, session) {
  const byId = new Map((template.items || []).map((it) => [it.id, it]));
  const matched = new Map(); // itemId → se
  for (const se of session.exercises || []) {
    const it = se.templateItemId ? byId.get(se.templateItemId) : null;
    if (it && !matched.has(it.id)) matched.set(it.id, se);
  }
  return { byId, matched, isMatched: (se) => !!se.templateItemId && matched.get(se.templateItemId) === se };
}

/**
 * Cambios de la sesión respecto a su plantilla:
 *  add    — ejercicio añadido en la sesión          {seId, exerciseId}
 *  swap   — ejercicio cambiado por uno que NO es alternativa del ítem   {itemId, seId, from, to}
 *  remove — ítem de la plantilla quitado de la sesión  {itemId, exerciseId}
 *  order  — orden distinto de los ítems que siguen   {order:[itemId]}
 * Elegir una alternativa definida no es un cambio. Cada cambio lleva `id` estable y `label` legible.
 * opts.nameOf(exerciseId) → nombre (para las etiquetas).
 */
export function templateDiff(template, session, { nameOf = null } = {}) {
  if (!template || !session) return [];
  const nm = (id, fallback) => (nameOf && nameOf(id)) || fallback || id;
  const { matched, isMatched } = matchItems(template, session);
  const ses = session.exercises || [];
  const swaps = [];
  const adds = [];
  for (const se of ses) {
    if (!isMatched(se)) {
      adds.push({ id: `add:${se.id}`, type: 'add', seId: se.id, exerciseId: se.exerciseId, label: `Añadir «${nm(se.exerciseId, se.exName)}»` });
      continue;
    }
    const it = (template.items || []).find((i) => i.id === se.templateItemId);
    const allowed = [it.exerciseId, ...(it.alternatives || [])];
    if (!allowed.includes(se.exerciseId)) {
      swaps.push({
        id: `swap:${it.id}`, type: 'swap', itemId: it.id, seId: se.id, from: it.exerciseId, to: se.exerciseId,
        label: `Cambiar «${nm(it.exerciseId)}» por «${nm(se.exerciseId, se.exName)}»`,
      });
    }
  }
  const removes = (template.items || []).filter((it) => !matched.has(it.id)).map((it) => ({
    id: `remove:${it.id}`, type: 'remove', itemId: it.id, exerciseId: it.exerciseId, label: `Quitar «${nm(it.exerciseId)}»`,
  }));
  const changes = [...swaps, ...adds, ...removes];
  const sesOrder = ses.filter(isMatched).map((se) => se.templateItemId);
  const tplOrder = (template.items || []).filter((it) => matched.has(it.id)).map((it) => it.id);
  if (sesOrder.join('|') !== tplOrder.join('|')) {
    const names = ses.filter(isMatched).map((se) => nm(se.exerciseId, se.exName));
    const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '');
    changes.push({ id: 'order', type: 'order', order: sesOrder, label: `Nuevo orden: ${shown}` });
  }
  return changes;
}

/** Ítem de plantilla a partir de un ejercicio añadido en la sesión. pura */
export function itemFromSessionExercise(se, id = uid('ti_')) {
  const t = se.target || {};
  const work = (se.sets || []).filter(isWorkSet);
  const reps = work.map((s) => s.reps).filter((n) => typeof n === 'number' && n > 0);
  const item = {
    id,
    exerciseId: se.exerciseId,
    alternatives: [],
    sets: work.length || t.sets || 3,
    notes: '',
    section: se.section || '',
    groupId: null,
    groupType: null,
  };
  const repMin = t.repMin ?? (reps.length ? Math.min(...reps) : null);
  const repMax = t.repMax ?? (reps.length ? Math.max(...reps) : null);
  if (repMin != null) item.repMin = repMin;
  if (repMax != null) item.repMax = repMax;
  if (t.timeMin != null) item.timeMin = t.timeMin;
  if (t.timeMax != null) item.timeMax = t.timeMax;
  if (t.distance != null) item.distance = t.distance;
  return item;
}

/**
 * Aplica a una COPIA de la plantilla los cambios elegidos (ids o cambios de templateDiff).
 * No modifica `template`. Devuelve la plantilla nueva.
 */
export function applyTemplateDiff(template, session, selectedChanges = [], { newId = () => uid('ti_') } = {}) {
  const tpl = deepClone(template);
  const ids = new Set((selectedChanges || []).map((c) => (typeof c === 'string' ? c : c.id)));
  const chosen = templateDiff(template, session).filter((c) => ids.has(c.id));
  const ses = session.exercises || [];
  const { isMatched } = matchItems(template, session);
  let items = tpl.items || [];

  for (const c of chosen) {
    if (c.type !== 'swap') continue;
    const it = items.find((i) => i.id === c.itemId);
    if (it) {
      it.exerciseId = c.to;
      it.alternatives = (it.alternatives || []).filter((a) => a !== c.to);
    }
  }
  const rm = new Set(chosen.filter((c) => c.type === 'remove').map((c) => c.itemId));
  items = items.filter((i) => !rm.has(i.id));

  if (chosen.some((c) => c.type === 'order')) {
    // Reordena solo los ítems presentes en la sesión, en los huecos que ya ocupaban.
    const pos = new Map();
    ses.forEach((se, i) => { if (isMatched(se)) pos.set(se.templateItemId, i); });
    const slots = [];
    items.forEach((it, i) => { if (pos.has(it.id)) slots.push(i); });
    const sorted = slots.map((i) => items[i]).sort((a, b) => pos.get(a.id) - pos.get(b.id));
    slots.forEach((slot, k) => { items[slot] = sorted[k]; });
  }

  // Añadidos: detrás del ejercicio anterior de la sesión que esté en la plantilla.
  const seToItem = new Map();
  for (const se of ses) if (isMatched(se) && items.some((i) => i.id === se.templateItemId)) seToItem.set(se.id, se.templateItemId);
  const addIds = new Set(chosen.filter((c) => c.type === 'add').map((c) => c.seId));
  ses.forEach((se, idx) => {
    if (!addIds.has(se.id)) return;
    const item = itemFromSessionExercise(se, newId());
    let insertAt = 0;
    for (let j = idx - 1; j >= 0; j--) {
      const anchor = seToItem.get(ses[j].id);
      if (anchor) { insertAt = items.findIndex((i) => i.id === anchor) + 1; break; }
    }
    items.splice(insertAt, 0, item);
    seToItem.set(se.id, item.id);
  });
  tpl.items = items;
  return tpl;
}
