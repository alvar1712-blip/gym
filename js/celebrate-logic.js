// celebrate-logic.js — qué se dice al terminar una sesión. PURO (sin DOM ni store): se prueba en Node
// (tests/unit/celebrate.test.mjs). La animación está en celebrate.js.

/** Mensajes de felicitación: cortos y sin sermones. */
export const MESSAGES = ['¡Buen trabajo!', '¡Bien hecho!', '¡Gran esfuerzo!', '¡Así se hace!'];

/**
 * Ejercicios cuyos récords se destacan al terminar (por id, no por nombre: renombrar un ejercicio no lo saca de la
 * lista). El orden es la prioridad si en la misma sesión hay varios. Los accesorios (laterales, face pull, curl, crunch…)
 * NUNCA disparan el mensaje de récord; sus marcas siguen en Progreso y en el resumen. Selección inicial, deliberadamente
 * corta: los cuatro básicos y la variante supina de las dominadas (mismo movimiento; cada id lleva su propio historial,
 * así que sus marcas nunca se mezclan con las de otra variante). Press militar y remo con barra, fuera por ahora.
 * Para ampliarla basta con añadir ids aquí.
 */
export const MAIN_LIFTS = ['press_banca', 'sentadilla', 'peso_muerto', 'dominadas', 'dominadas_supinas'];

/** Mensaje distinto del último mostrado (`rand`: () => [0,1), inyectable para probar; `last`: el anterior). */
export function pickMessage(rand = Math.random, last = null) {
  const pool = MESSAGES.filter((m) => m !== last);
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

/**
 * Récord que merece destacarse, o null. `prMap`: Map(setId → récords) de calc.sessionPRs (que ya exige historial previo
 * y compara solo la misma configuración de material: la primera sesión con un ejercicio o una configuración nueva no
 * cuenta). Solo vale una marca real de fuerza: más peso o 1RM estimado más alto; en peso corporal (dominadas) también
 * más repeticiones. Un solo récord: el del ejercicio principal de la lista con más prioridad.
 * @returns {{exerciseId: string, name: string, kind: string, text: string} | null}
 */
export function mainRecord(session, prMap, exerciseOf, mainLifts = MAIN_LIFTS) {
  if (!prMap || !prMap.size) return null;
  let best = null;
  for (const se of session.exercises || []) {
    const rank = mainLifts.indexOf(se.exerciseId);
    if (rank < 0) continue;
    const ex = exerciseOf(se.exerciseId);
    if (!ex) continue;
    for (const set of se.sets || []) {
      const kinds = (prMap.get(set.id) || []).map((p) => p.kind);
      const kind = kinds.includes('e1rm') ? 'e1rm' : kinds.includes('weight') ? 'weight'
        : ex.logType === 'bodyweight' && kinds.includes('reps') ? 'reps' : null;
      if (kind && (!best || rank < best.rank)) best = { rank, exerciseId: se.exerciseId, name: ex.name || se.exerciseId, kind };
    }
  }
  if (!best) return null;
  const { rank, ...rec } = best;
  return { ...rec, text: `¡Nuevo récord en ${rec.name.toLocaleLowerCase('es')}!` };
}
