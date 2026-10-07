// progression.js — doble progresión (docs/FASE3.md, docs/PULIDO.md §10): incrementos por tipo de ejercicio, la
// comprobación de una sesión (¿todas las series de trabajo al tope del rango con RIR suficiente?) y el «Siguiente
// paso» de la sesión en curso. PURO. Lo usan el panel semanal (insights.js, que lo reexporta) y la tarjeta de un
// ejercicio en la sesión (session-view-card.js): así los dos dicen lo mismo. Pruebas: tests/unit/insights.test.mjs.
import { isWorkSet, rirValue } from './calc.js';
import { fmtNumFast, weightLabel } from './stats.js';
import { PATTERNS, SET_TYPE_LABEL, defaultSettings } from './seed.js';
import { formatSet, LOAD_REP_TYPES } from './session-logic.js';

const LEG_PATTERNS = PATTERNS.filter((p) => p.group === 'legs').map((p) => p.id);
const num = fmtNumFast;
const kg = (v) => `${num(v, 2)} kg`;
const plural = (n, one, many) => `${num(n, 0)} ${n === 1 ? one : many}`;

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

/** Texto de la acción de subir: título corto y «de … a …». */
export function upAction(ev, inc) {
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

/**
 * Doble progresión de UNA sesión de un ejercicio (la regla de dpRule): ¿todas las series de trabajo llegaron al tope
 * del rango con RIR ≥ minRir y se hicieron las series del objetivo? → subir; si no, por qué se mantiene. PURA. La usan
 * el panel semanal (dpEvaluations) y la sesión en curso (session-view-card: «Siguiente paso»), así dicen lo mismo.
 * @param {{ logType: string, target: object, sets: object[], minRir: number }} o  sets: las de esa sesión (con o sin
 *   calentamientos: se cuentan solo las de trabajo hechas)
 * @returns {null|{ top, minRir, checks, reqSets, setsOk, up, nTop, nRirLow, weight, hold: null|'sets'|'reps'|'rir' }}
 *   null si no hay rango de repeticiones, series de trabajo o pesos.
 */
export function progressionCheck({ logType, target, sets, minRir = 0 }) {
  const top = target ? target.repMax ?? target.repMin : null;
  if (!(top >= 1)) return null;
  const lt = logType;
  const work = (sets || []).filter(isWorkSet);
  if (!work.length) return null;
  const weights = work.map((st) => (lt === 'bodyweight' ? (typeof st.weight === 'number' ? st.weight : 0) : st.weight)).filter((w) => typeof w === 'number' && Number.isFinite(w));
  if (!weights.length) return null;
  const checks = work.map((st) => {
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
  const reqSets = Number.isFinite(target.sets) && target.sets >= 1 ? target.sets : null;
  const setsOk = reqSets == null || checks.length >= reqSets;
  const nTop = checks.filter((c) => c.repsOk).length;
  const allOk = checks.every((c) => c.ok);
  return {
    top, minRir, checks, reqSets, setsOk, up: setsOk && allOk, nTop,
    nRirLow: checks.filter((c) => c.repsOk && !c.rirOk).length, weight: Math.max(...weights),
    // Motivo de mantener: faltan series del objetivo · faltan reps hasta el tope · solo falla el RIR
    hold: setsOk && allOk ? null : !setsOk ? 'sets' : nTop < checks.length ? 'reps' : 'rir',
  };
}

/**
 * «Siguiente paso» discreto de la sesión en curso (docs/PULIDO.md §10), con la última vez de ese ejercicio y la MISMA
 * regla e incrementos que el panel semanal. No es una orden: dice qué toca y cuándo se sube. PURA.
 *   up   → «Sube a 47,5 kg» («… por lado»; peso corporal: «Lastre +12,5 kg», «Asistencia 17,5 kg», «Sin asistencia»)
 *   hold → «6/6/6 → +2,5 kg»: al completar 6/6/6, +2,5 kg («6/6/6 con RIR ≥ 1 → …» si solo falló el RIR;
 *          «+2,5 kg de lastre», «−2,5 kg de asistencia», «+2,5 kg por lado»)
 *   label: la frase entera para VoiceOver («Siguiente paso: +2,5 kg cuando completes 6/6/6»).
 * @param {{ exercise: object, target: object, lastSets: object[], settings?: object }} o
 * @returns {null|{ kind: 'up'|'hold', text: string, label: string }} null sin rango de reps, sin última vez o sin pesos.
 */
export function progressionHint({ exercise, target, lastSets, settings = null }) {
  const lt = exercise?.logType;
  if (!LOAD_REP_TYPES.includes(lt) || !lastSets?.length) return null;
  const def = defaultSettings();
  const minRir = Number(settings?.progression?.minRir ?? def.progression.minRir) || 0;
  const pc = progressionCheck({ logType: lt, target, sets: lastSets, minRir });
  if (!pc) return null;
  const inc = incrementFor(exercise, settings?.increments);
  const w = pc.weight;
  const side = lt === 'unilateral' ? ' por lado' : '';
  const step = inc.text === '1–2 kg' ? 1 : inc.kg; // el mínimo del incremento (aislamiento: 1–2 kg)
  // Cortos: van en la línea de «Objetivo 3×4–6» (no añaden altura: «Registrar serie» sigue a la vista en un iPhone SE)
  if (pc.up) {
    let text;
    if (lt !== 'bodyweight') text = `Sube a ${inc.text === '1–2 kg' ? `${num(w + 1, 2)}–${num(w + 2, 2)}` : num(w + inc.kg, 2)} kg${side}`;
    else if (w < 0) text = w + step >= 0 ? 'Sin asistencia' : `Asistencia ${num(-(w + step), 2)} kg`;
    else text = `Lastre +${inc.text === '1–2 kg' ? `${num(w + 1, 2)}–${num(w + 2, 2)}` : num(w + inc.kg, 2)} kg`;
    return { kind: 'up', text, label: `Siguiente paso: ${text.charAt(0).toLowerCase()}${text.slice(1)}` };
  }
  const n = Math.min(pc.reqSets ?? pc.checks.length, 6);
  const tops = Array.from({ length: n }, () => num(pc.top, 0)).join('/');
  const what = lt !== 'bodyweight' ? `+${inc.text}${side}`
    : w < 0 ? (w + step >= 0 ? 'sin asistencia' : `−${inc.text} de asistencia`) : `+${inc.text} de lastre`;
  const rir = pc.hold === 'rir' ? ` con RIR ≥ ${num(minRir, 0)}` : '';
  // En pantalla, la notación de las series («6/6/6 → +2,5 kg»); para VoiceOver, la frase entera
  return { kind: 'hold', text: `${tops}${rir} → ${what}`, label: `Siguiente paso: ${what} cuando completes ${tops}${rir}` };
}
