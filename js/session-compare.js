// session-compare.js — la sesión frente a la anterior EQUIVALENTE (la misma rutina), para el resumen al terminar
// (docs/PULIDO.md §9). Solo datos reales: la serie más pesada de cada ejercicio (y sus reps), las series de trabajo,
// el volumen y la duración. Nada de puntuaciones inventadas. Si no hay sesión comparable (sesión libre, primera vez
// con esa rutina) o ningún ejercicio en común, no hay comparación. PURA. Pruebas: tests/unit/session-compare.test.mjs.
import { isWorkSet, sessionVolume, sessionDurationMin, workSetCount } from './calc.js';
import { fmtNum } from './util.js';
import { LOAD_REP_TYPES } from './session-logic.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const kgTxt = (v) => `${fmtNum(v, 2)} kg`; // fmtNum quita los ceros de sobra: «2,5 kg», «5 kg», «1,25 kg»
/** Máximo de filas por ejercicio en el resumen (las que más cambian primero). */
export const MAX_ROWS = 5;

/** La anterior sesión de fuerza TERMINADA de la misma rutina (null si es libre o no hay ninguna antes). */
export function previousEquivalent(session, sessions) {
  if (!session?.templateId) return null;
  const at = (s) => [s.date || '', s.startedAt || 0];
  const [d0, t0] = at(session);
  let best = null;
  for (const s of sessions || []) {
    if (!s || s.id === session.id || s.kind !== 'strength' || s.status !== 'done' || s.templateId !== session.templateId) continue;
    const [d, t] = at(s);
    if (d > d0 || (d === d0 && !(t < t0))) continue; // solo las de ANTES
    if (!best || d > best.date || (d === best.date && (s.startedAt || 0) > (best.startedAt || 0))) best = s;
  }
  return best;
}

/** La serie de trabajo más pesada (con más reps a ese peso) de un ejercicio de sesión; peso corporal: el lastre (0 sin). */
function topSet(se, logType) {
  let top = null;
  for (const s of se?.sets || []) {
    if (!isWorkSet(s)) continue;
    const w = logType === 'bodyweight' ? (isNum(s.weight) ? s.weight : 0) : s.weight;
    const r = logType === 'unilateral' && isNum(s.repsR) && isNum(s.reps) ? Math.min(s.reps, s.repsR) : s.reps;
    if (!isNum(w) || !isNum(r) || r < 1) continue;
    if (!top || w > top.w || (w === top.w && r > top.r)) top = { w, r };
  }
  return top;
}

/**
 * Comparación de `cur` con `prev` (la anterior equivalente).
 * @returns {null|{ prevDate, prevId, rows: { exerciseId, name, dir: 'up'|'same'|'down', text }[], more: number,
 *   sets: { cur, prev }, volume: { cur, prev }, duration: { cur, prev } }}
 *   rows: «+2,5 kg» (más peso en la serie más pesada), «+2 reps» (mismo peso, más reps), «Igual» o «−1 rep» / «−2,5 kg».
 *   Solo ejercicios con carga y repeticiones hechos en las dos; los demás no son comparables así y no salen.
 */
export function compareSessions(cur, prev, exMap, bwFn = () => null) {
  if (!cur || !prev) return null;
  const get = (id) => (exMap?.get ? exMap.get(id) : exMap?.[id]);
  const prevBy = new Map();
  for (const se of prev.exercises || []) if (!prevBy.has(se.exerciseId)) prevBy.set(se.exerciseId, se);
  const rows = [];
  const seen = new Set();
  for (const se of cur.exercises || []) {
    if (seen.has(se.exerciseId)) continue; // un ejercicio repetido se compara una vez (el primero)
    seen.add(se.exerciseId);
    const ex = get(se.exerciseId);
    if (!ex || !LOAD_REP_TYPES.includes(ex.logType)) continue;
    const a = topSet(se, ex.logType);
    const b = topSet(prevBy.get(se.exerciseId), ex.logType);
    if (!a || !b) continue;
    const dw = Math.round((a.w - b.w) * 100) / 100;
    const dr = a.r - b.r;
    let dir;
    let text;
    let mag;
    if (dw > 0) { dir = 'up'; text = `+${kgTxt(dw)}`; mag = 1000 + dw; } else if (dw < 0) { dir = 'down'; text = `−${kgTxt(-dw)}`; mag = -1000 + dw; } else if (dr > 0) { dir = 'up'; text = `+${dr} ${dr === 1 ? 'rep' : 'reps'}`; mag = dr; } else if (dr < 0) { dir = 'down'; text = `−${-dr} ${dr === -1 ? 'rep' : 'reps'}`; mag = dr; } else { dir = 'same'; text = 'Igual'; mag = 0; }
    rows.push({ exerciseId: se.exerciseId, name: ex.name || se.exName || se.exerciseId, dir, text, mag });
  }
  if (!rows.length) return null;
  const order = { up: 0, down: 1, same: 2 };
  rows.sort((x, y) => (order[x.dir] - order[y.dir]) || (Math.abs(y.mag) - Math.abs(x.mag)));
  const sets = (s) => (s.exercises || []).reduce((t, se) => t + workSetCount(se), 0);
  return {
    prevDate: prev.date,
    prevId: prev.id,
    rows: rows.slice(0, MAX_ROWS).map(({ mag, ...r }) => r),
    more: Math.max(0, rows.length - MAX_ROWS),
    sets: { cur: sets(cur), prev: sets(prev) },
    volume: { cur: sessionVolume(cur, exMap, bwFn), prev: sessionVolume(prev, exMap, bwFn) },
    duration: { cur: sessionDurationMin(cur), prev: sessionDurationMin(prev) },
  };
}
