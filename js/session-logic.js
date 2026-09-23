// session-logic.js — creación y lógica de sesiones de fuerza (sin DOM).
// PROPIETARIO: módulo de sesión. Esta es la versión base; el módulo de sesión la amplía.
import * as store from './store.js';
import { uid, todayStr, tsFromDate } from './util.js';
import { lastPerformance } from './calc.js';

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
    section: item.section || '',
    groupId: item.groupId || null,
    groupType: item.groupType || null,
    sets: [],
  };
  se.sets = prefillSets(se, session);
  return se;
}

/** Series pendientes (done:false) prellenadas con lo de la última vez. */
export function prefillSets(se, session) {
  const ex = store.exercise(se.exerciseId);
  if (!ex || ex.logType === 'cardio') return [];
  const n = Math.max(1, se.target?.sets || 1);
  const last = lastPerformance(store.all('sessions'), se.exerciseId, { excludeSessionId: session?.id });
  const lastWork = last ? last.sets.filter((s) => s.type !== 'warmup') : [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = lastWork[i] || lastWork[lastWork.length - 1] || null;
    out.push(newSet(src, se));
  }
  return out;
}

export function newSet(src, se) {
  return {
    id: uid('set_'),
    type: src ? (src.type === 'warmup' ? 'effective' : src.type) : 'effective',
    weight: src?.weight ?? null,
    reps: src?.reps ?? (se?.target?.repMin ?? null),
    repsR: src?.repsR ?? null,
    rir: src?.rir ?? null,
    timeSec: src?.timeSec ?? (se?.target?.timeMin ?? null),
    distanceM: src?.distanceM ?? (se?.target?.distance ?? null),
    heightCm: src?.heightCm ?? null,
    note: '',
    done: false,
    doneAt: null,
  };
}
