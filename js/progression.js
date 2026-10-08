// progression.js — doble progresión (docs/FASE3.md, docs/PULIDO.md §10): incrementos por tipo de ejercicio, la
// comprobación de una sesión (¿todas las series de trabajo al tope del rango con RIR suficiente?) y el «Siguiente
// paso» de la sesión en curso. PURO. Lo usan el panel semanal (insights.js, que lo reexporta) y la tarjeta de un
// ejercicio en la sesión (session-view-card.js): así los dos dicen lo mismo. Pruebas: tests/unit/insights.test.mjs.
// Ronda 8 (B4): aquí vive también el ESTANCAMIENTO (progressStatus / stallEval, el «progresa · se mantiene ·
// estancado» del panel y el estado del análisis) y progressionHint decide con todo junto (progreso reciente,
// estancamiento, RIR, tope del rango y confianza): una sola decisión para la sesión y el panel.
// Pruebas cruzadas: tests/unit/progression-decision.test.mjs.
import { isWorkSet, rirValue, setMetrics } from './calc.js';
import { addDays, diffDays } from './util.js';
import { fmtNumFast, weightLabel } from './stats.js';
import { PATTERNS, SET_TYPE_LABEL, defaultSettings } from './seed.js';
import { formatSet, LOAD_REP_TYPES } from './session-logic.js';

/** Mínimo de sesiones de un ejercicio para valorar si progresa, se mantiene o se estanca (docs/FASE3.md). */
export const MIN_SESSIONS = 3;
/** Días seguidos sin un ejercicio a partir de los cuales su comparación vuelve a empezar (parón, vacaciones…). */
export const GAP_DAYS = 28;
const EPS = 1e-9;

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

// ===========================================================================
// Estancamiento (una sola regla: panel semanal, análisis y «Siguiente paso» de la sesión)
// ===========================================================================

/** Umbrales de estancamiento (settings.stall) con los de por defecto: S sesiones y W semanas (enteros ≥ 1). */
export function stallThresholds(stall) {
  const c = { ...defaultSettings().stall, ...(stall && typeof stall === 'object' ? stall : {}) };
  return { S: Math.max(1, Math.round(Number(c.sessions) || 1)), W: Math.max(1, Math.round(Number(c.weeks) || 1)) };
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

/**
 * La regla del estancamiento sobre un tramo ya preparado (`era`: {date, e1rm} desde el último parón, en orden):
 *  - por sesiones: las últimas S sesiones frente a las S anteriores;
 *  - por semanas: las de las últimas W semanas hasta `ref` frente a las de las W anteriores (con ≥ 2 en el tramo).
 * Con menos de MIN_SESSIONS sesiones aún no se valora (fresh). PURA. La usan progressStatus (panel y sesión) y el
 * análisis (analysis-training.stallState).
 * @returns {{ S, W, from, priorFrom, bySes, byWk, fresh, bySessions, byWeeks, stalled:boolean }}
 */
export function stallEval(era, ref, stall) {
  const { S, W } = stallThresholds(stall);
  const pts = era || [];
  const n = pts.length;
  const from = addDays(ref, -7 * W + 1);
  const priorFrom = addDays(from, -7 * W);
  const lastS = pts.slice(-S);
  const prevS = pts.slice(Math.max(0, n - 2 * S), n - lastS.length);
  const bySes = { kind: 'sessions', ...evalTramo(lastS, prevS) };
  const win = pts.filter((e) => e.date >= from);
  const prior = pts.filter((e) => e.date >= priorFrom && e.date < from);
  const byWk = { kind: 'weeks', ...evalTramo(win, prior) };
  const fresh = n < MIN_SESSIONS;
  const bySessions = !fresh && prevS.length > 0 && !bySes.improved;
  const byWeeks = !fresh && prior.length > 0 && win.length >= 2 && !byWk.improved;
  return { S, W, from, priorFrom, bySes, byWk, fresh, bySessions, byWeeks, stalled: bySessions || byWeeks };
}

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

const maxBy = (list) => list.reduce((b, e) => (!b || e.e1rm > b.e1rm + EPS ? e : b), null);

/**
 * Progreso reciente de UN ejercicio hasta `ref`: progress | maintain | stalled (el panel semanal lo enseña y el
 * «Siguiente paso» de la sesión lo consulta). PURA.
 * Solo con ≥ MIN_SESSIONS sesiones con 1RM estimado y alguna en las últimas W semanas (si no → null).
 * Se compara lo reciente con lo inmediatamente anterior (stallEval); tras un parón de GAP_DAYS o más sin el
 * ejercicio, lo de antes deja de ser referencia. Peso corporal: el 1RM de TODAS las sesiones se recalcula con un
 * mismo peso corporal (el de la última sesión), así que si solo cambia la báscula no hay mejora ni empeora.
 * Estancado = sin mejora por sesiones o por semanas. Progresa = alguna mejora. Se mantiene = el resto.
 * @param {{ exercise:object, history:object[], ref:string, stall?:object }} o  history = stats.exerciseHistory
 *   (data, id, { labels:false }), en orden.
 * @returns {null|{ status, bySessions, byWeeks, fresh, eraSessions, sessions, gapFrom, isBw, bwRef, refKind, refs,
 *   refBest, shown, rec, recPrev, best, last, S, W, from, priorFrom }}
 */
export function progressStatus({ exercise, history, ref, stall = null }) {
  const ex = exercise || {};
  const hist = (history || []).filter((e) => e && e.date <= ref && e.e1rm != null);
  const { W } = stallThresholds(stall);
  if (hist.length < MIN_SESSIONS || hist[hist.length - 1].date < addDays(ref, -7 * W + 1)) return null;
  let start = 0;
  for (let i = 1; i < hist.length; i++) if (diffDays(hist[i - 1].date, hist[i].date) >= GAP_DAYS) start = i;
  const lastH = hist[hist.length - 1];
  const bwRef = ex.logType === 'bodyweight' && lastH.bw > 0 ? lastH.bw : null;
  const era = hist.slice(start).map((e) => {
    const o = { date: e.date, sessionId: e.sessionId, e1rm: e.e1rm, label: e.bestSetLabel };
    const b = bwRef != null ? bestAtBodyweight(e.sets, ex, bwRef) : null;
    if (b) { o.e1rm = b.value; o.label = b.label; }
    return o;
  });
  const n = era.length;
  const se = stallEval(era, ref, stall);
  const { bySes, byWk, fresh, bySessions, byWeeks } = se;
  const status = se.stalled ? 'stalled' : !fresh && (bySes.improved || byWk.improved) ? 'progress' : 'maintain';
  // Tramo que se enseña en el «¿Por qué?»: el que decide el estado (el más largo si deciden los dos).
  const longer = (a, b) => (a.tramo.length >= b.tramo.length ? a : b);
  let sh;
  if (status === 'stalled') sh = bySessions && byWeeks ? longer(bySes, byWk) : bySessions ? bySes : byWk;
  else if (status === 'progress') sh = bySes.improved && byWk.improved ? longer(bySes, byWk) : bySes.improved ? bySes : byWk;
  else sh = bySes;
  if (fresh) sh = { kind: 'sessions', tramo: era, refs: [], marks: era.map(() => false), prev: era.map(() => null) };
  const shown = sh.tramo.map((e, i) => ({ ...e, record: sh.marks[i] }));
  const recIdx = sh.marks.lastIndexOf(true);
  return {
    status, bySessions, byWeeks, fresh, eraSessions: n, sessions: hist.length, gapFrom: start > 0 ? hist[start - 1].date : null,
    isBw: bwRef != null, bwRef, refKind: sh.kind, refs: sh.refs, refBest: maxBy(sh.refs), shown,
    rec: recIdx >= 0 ? shown[recIdx] : null, recPrev: recIdx >= 0 ? sh.prev[recIdx] : null,
    best: maxBy(era), last: era[n - 1], S: se.S, W: se.W, from: se.from, priorFrom: se.priorFrom,
  };
}

// ===========================================================================
// La decisión: «Siguiente paso» (sesión) y doble progresión del panel
// ===========================================================================

/**
 * «Siguiente paso» de la doble progresión: UNA decisión para la sesión en curso (session-view-card) y el panel
 * semanal (insights.dpEvaluations), con la última vez de ese ejercicio, la MISMA regla e incrementos y, si se le
 * pasa el historial, el progreso reciente (progressStatus). No es una orden: sugiere, no cambia la rutina. PURA.
 * Orden de la decisión:
 *   1. estancamiento documentado (progressStatus 'stalled') → stalled: «Llevas 3 sesiones sin progresar» (en la
 *      sesión, «Estancado», la etiqueta del panel) + action
 *      «revisar» (discreto, sin alerta: «revisar» lleva al progreso del ejercicio; el panel lo explica en
 *      «Ejercicios estancados»);
 *   2. datos ambiguos → review: «Mantén y vuelve a evaluar» (en la sesión, «Mantén y reevalúa») — todas las series al tope pero sin RIR registrado
 *      (no se sabe si sobró margen) o la última vez fue hace GAP_DAYS o más (vuelta tras un parón);
 *   3. todas las series al tope con RIR suficiente y las series del objetivo → up: «Sube a 47,5 kg» («… por lado»;
 *      peso corporal: «Lastre +12,5 kg», «Asistencia 17,5 kg», «Sin asistencia»);
 *   4. si no → hold: «6/6/6 → +2,5 kg»: al completar 6/6/6, +2,5 kg («6/6/6 con RIR ≥ 1 → …» si solo falló el RIR;
 *      «+2,5 kg de lastre», «−2,5 kg de asistencia», «+2,5 kg por lado»).
 *   label: la frase entera para VoiceOver («Siguiente paso: +2,5 kg cuando completes 6/6/6»).
 * @param {{ exercise: object, target: object, lastSets: object[], settings?: object, history?: object[],
 *   ref?: string, lastDate?: string }} o  settings: los de la app (o el cfg del panel: progression, increments,
 *   stall); history: stats.exerciseHistory del ejercicio (sin él no se mira el estancamiento); ref: el día de la
 *   decisión (la fecha de la sesión; en el panel, su día de referencia); lastDate: el día de `lastSets`.
 * @returns {null|{ kind: 'up'|'hold'|'review'|'stalled', text: string, label: string, reason: string|null,
 *   short?: string, action?: 'revisar', check: object, status: object|null }}  short: el texto de la sesión si es otro. null sin rango de reps, sin última vez o sin pesos.
 */
export function progressionHint({ exercise, target, lastSets, settings = null, history = null, ref = null, lastDate = null }) {
  const lt = exercise?.logType;
  if (!LOAD_REP_TYPES.includes(lt) || !lastSets?.length) return null;
  const def = defaultSettings();
  const minRir = Number(settings?.progression?.minRir ?? def.progression.minRir) || 0;
  const pc = progressionCheck({ logType: lt, target, sets: lastSets, minRir });
  if (!pc) return null;
  const day = ref || lastDate || (history?.length ? history[history.length - 1].date : null);
  const status = history && day ? progressStatus({ exercise, history, ref: day, stall: settings?.stall }) : null;
  const out = (kind, text, label, reason = null) => ({ kind, text, label, reason, check: pc, status });
  // 1. Estancamiento documentado: manda sobre «sube» (el panel dice «estancado»: la sesión no puede decir otra cosa)
  if (status?.status === 'stalled') {
    const n = Math.max(status.shown.length, 2);
    // En la línea del objetivo, la forma corta («Estancado · revisar», la palabra del panel: cabe junto a
    // «Objetivo 3×4–6» sin sumar una línea a la tarjeta); la frase entera, para VoiceOver y en el panel.
    return { ...out('stalled', `Llevas ${num(n, 0)} sesiones sin progresar`,
      `Siguiente paso: revisar. Llevas ${num(n, 0)} sesiones sin progresar (sin mejorar tu 1RM estimado)`, status.bySessions ? 'sessions' : 'weeks'), short: 'Estancado', action: 'revisar' };
  }
  // 2. Datos ambiguos: mantener y volver a evaluar (no se sugiere subir ni se da por bueno el tope)
  const noRir = pc.hold === 'rir' && pc.checks.every((c) => c.rirOk || c.rir == null);
  const stale = !!(lastDate && ref && diffDays(lastDate, ref) >= GAP_DAYS);
  if (noRir || (stale && pc.up)) {
    const why = noRir ? 'llegaste al tope sin RIR registrado' : `la última vez fue hace ${plural(Math.floor(diffDays(lastDate, ref) / 7), 'semana', 'semanas')}`;
    // En la sesión, la forma corta (cabe junto al objetivo); la frase entera, para VoiceOver y en el panel.
    return { ...out('review', 'Mantén y vuelve a evaluar', `Siguiente paso: mantén el peso y vuelve a evaluar (${why})`, noRir ? 'rir' : 'gap'), short: 'Mantén y reevalúa' };
  }
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
    return out('up', text, `Siguiente paso: ${text.charAt(0).toLowerCase()}${text.slice(1)}`);
  }
  const n = Math.min(pc.reqSets ?? pc.checks.length, 6);
  const tops = Array.from({ length: n }, () => num(pc.top, 0)).join('/');
  const what = lt !== 'bodyweight' ? `+${inc.text}${side}`
    : w < 0 ? (w + step >= 0 ? 'sin asistencia' : `−${inc.text} de asistencia`) : `+${inc.text} de lastre`;
  const rir = pc.hold === 'rir' ? ` con RIR ≥ ${num(minRir, 0)}` : '';
  // En pantalla, la notación de las series («6/6/6 → +2,5 kg»); para VoiceOver, la frase entera
  return out('hold', `${tops}${rir} → ${what}`, `Siguiente paso: ${what} cuando completes ${tops}${rir}`, pc.hold);
}
