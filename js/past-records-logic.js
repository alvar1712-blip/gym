// past-records-logic.js — marcas históricas introducidas a mano (ronda 6, fase B; docs/MEJORAS6.md) y comparación del
// rendimiento actual con el mejor rendimiento anterior. PURO (sin DOM ni store): testeable en Node.
//
// REGISTRO (almacén 'pastRecords', separado de los récords que calcula stats.js con lo registrado en Entreno):
//   { id:'pr_…', exerciseId, weight, reps, rir:0–5|null, date:DateApprox|null, beforeApp:boolean,
//     bodyweightKg:20–400|null, note, createdAt, updatedAt }
//   weight: kg (unilateral: por lado; peso corporal: lastre, 0 = sin lastre, negativo = asistencia).
//   reps: 1–50 (unilateral: por lado). rir: opcional (sin apuntar → como al fallo, RIR 0, igual que calc.e1rm).
//   date: fecha aproximada opcional (context-logic: día · mes · estación · año). beforeApp: «anterior a Entreno».
//   bodyweightKg: solo en ejercicios de peso corporal, opcional (tu peso de entonces).
//
// COMPARACIÓN (exerciseRecovery):
//   ahora      = el mayor 1RM estimado de las series de trabajo de los últimos CURRENT_DAYS días (stats.exerciseHistory).
//   referencia = el mayor 1RM estimado entre tus marcas históricas y lo registrado en Entreno ANTES de esos días.
//   porcentaje = ahora ÷ referencia × 100, redondeado a la unidad («≈ 94 %»).
//   1RM estimado = calc.setMetrics / calc.e1rm (Epley con reps + RIR; solo series de 1 a 12 repeticiones). En peso
//   corporal la carga es tu peso corporal + lastre: el de entonces sale, por este orden, de la propia marca, de tus
//   pesajes cerca de esa fecha, de tu contexto (peso habitual o peso en esa fecha) o, si no hay nada, de tu peso
//   actual (y se dice).
import { setMetrics, E1RM_MAX_REPS } from './calc.js';
import { addDays, diffDays, isDateStr, fmtNum, fmtDate, todayStr } from './util.js';
import { normalizeApprox, approxFrom, approxTo, approxLabel, weightReferences, KG_MIN, KG_MAX } from './context-logic.js';
import { weightLabel } from './stats.js';

/** Tipos de registro que admiten marca (peso × repeticiones). */
export const MARK_LOG_TYPES = ['weight_reps', 'unilateral', 'bodyweight'];
/** «Ahora»: lo mejor de los últimos 28 días. */
export const CURRENT_DAYS = 28;
export const REPS_MIN = 1;
export const REPS_MAX = 50;
export const RIR_MAX = 5;
export const WEIGHT_MAX = 1000;
/** Asistencia máxima (peso corporal con asistencia, en negativo). */
export const ASSIST_MAX = 200;
/** Margen (días) alrededor de la fecha de la marca al buscar un pesaje. */
export const BW_MARGIN_DAYS = 14;
export const NOTE_MAX = 500;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const EPS = 1e-9;

/** ¿Se puede apuntar una marca de este ejercicio? */
export function markable(exercise) {
  return !!exercise && MARK_LOG_TYPES.includes(exercise.logType);
}

/** ¿Tiene 1RM estimado (y por tanto se puede comparar)? Core de peso corporal: no (el peso corporal no es la carga). */
export function comparableType(exercise) {
  return markable(exercise) && !(exercise.logType === 'bodyweight' && exercise.pattern === 'core');
}

// ---------------------------------------------------------------------------
// Registros
// ---------------------------------------------------------------------------

/** Copia saneada (para leer lo guardado o importado). null si no tiene la forma mínima. */
export function normalizePastRecord(r) {
  if (!r || typeof r !== 'object' || r.id == null || typeof r.exerciseId !== 'string' || !r.exerciseId) return null;
  if (!isNum(r.weight) || !Number.isInteger(r.reps) || r.reps < REPS_MIN || r.reps > REPS_MAX) return null;
  return {
    id: r.id,
    exerciseId: r.exerciseId,
    weight: r.weight,
    reps: r.reps,
    rir: Number.isInteger(r.rir) && r.rir >= 0 && r.rir <= RIR_MAX ? r.rir : null,
    date: r.date ? normalizeApprox(r.date) : null,
    beforeApp: r.beforeApp !== false,
    bodyweightKg: isNum(r.bodyweightKg) && r.bodyweightKg >= KG_MIN && r.bodyweightKg <= KG_MAX ? r.bodyweightKg : null,
    note: typeof r.note === 'string' ? r.note.trim().slice(0, NOTE_MAX) : '',
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

export function normalizePastRecords(list) {
  return (Array.isArray(list) ? list : []).map(normalizePastRecord).filter(Boolean);
}

/**
 * Valida un borrador del formulario. → { campo: mensaje } (vacío = se puede guardar).
 * `exercise` = el ejercicio elegido (o null).
 */
export function validatePastRecord(d, exercise, today = todayStr()) {
  const err = {};
  if (!d?.exerciseId || !exercise) err.exercise = 'Elige el ejercicio.';
  else if (!markable(exercise)) err.exercise = 'Este ejercicio no se registra con peso y repeticiones.';
  const bw = exercise?.logType === 'bodyweight';
  if (bw) {
    if (d?.weight != null && (!isNum(d.weight) || d.weight < -ASSIST_MAX || d.weight > WEIGHT_MAX)) err.weight = `Lastre: de −${ASSIST_MAX} a ${WEIGHT_MAX} kg (negativo = asistencia).`;
  } else if (!isNum(d?.weight) || d.weight <= 0) err.weight = 'Escribe el peso (kg).';
  else if (d.weight > WEIGHT_MAX) err.weight = `Como mucho ${WEIGHT_MAX} kg.`;
  if (!Number.isInteger(d?.reps) || d.reps < REPS_MIN || d.reps > REPS_MAX) err.reps = `Repeticiones: de ${REPS_MIN} a ${REPS_MAX}.`;
  if (d?.rir != null && !(Number.isInteger(d.rir) && d.rir >= 0 && d.rir <= RIR_MAX)) err.rir = `RIR: de 0 a ${RIR_MAX}.`;
  if (d?.date != null) {
    const a = normalizeApprox(d.date);
    if (!a) err.date = 'Fecha no válida.';
    else if (a.date > today) err.date = 'La fecha no puede ser futura.';
  }
  if (bw && d?.bodyweightKg != null && !(isNum(d.bodyweightKg) && d.bodyweightKg >= KG_MIN && d.bodyweightKg <= KG_MAX)) {
    err.bodyweightKg = `Peso corporal: de ${KG_MIN} a ${KG_MAX} kg.`;
  }
  return err;
}

/** Registro a guardar a partir del borrador ya validado. Conserva createdAt al editar. */
export function pastRecordFrom(d, exercise, { id, now = Date.now(), createdAt = null } = {}) {
  const bw = exercise?.logType === 'bodyweight';
  return {
    id,
    exerciseId: d.exerciseId,
    weight: bw ? (isNum(d.weight) ? d.weight : 0) : d.weight,
    reps: d.reps,
    rir: Number.isInteger(d.rir) ? d.rir : null,
    date: d.date ? normalizeApprox(d.date) : null,
    beforeApp: d.beforeApp !== false,
    bodyweightKg: bw && isNum(d.bodyweightKg) ? d.bodyweightKg : null,
    note: typeof d.note === 'string' ? d.note.trim().slice(0, NOTE_MAX) : '',
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** «100 kg × 5» · «20 kg × 8 por lado» · «+10 kg × 6» · «12 reps sin lastre» · «−20 kg asist. × 8»; « @2» con RIR. */
export function markLabel(r, logType) {
  const rir = r.rir != null ? ` @${r.rir}` : '';
  if (logType === 'bodyweight') {
    if (!r.weight) return `${r.reps} reps sin lastre${rir}`;
    return `${weightLabel('bodyweight', r.weight)} × ${r.reps}${rir}`;
  }
  return `${fmtNum(r.weight, 2)} kg × ${r.reps}${logType === 'unilateral' ? ' por lado' : ''}${rir}`;
}

/** «verano 2025» · «sin fecha». */
export function markWhen(r) {
  return r.date ? approxLabel(r.date) : 'sin fecha';
}

const kgTxt = (v) => `${fmtNum(v, 1)} kg`;

// ---------------------------------------------------------------------------
// Peso corporal de una marca (solo ejercicios de peso corporal)
// ---------------------------------------------------------------------------

/**
 * Peso corporal con el que se calcula una marca de peso corporal.
 * → { kg, source:'record'|'log'|'context'|'current'|'default', date?:string }
 *   record: el apuntado en la propia marca · log: el pesaje más cercano a esa fecha (± BW_MARGIN_DAYS alrededor del
 *   periodo) · context: tu peso habitual o un peso en esa fecha (Tu contexto) · current: tu último pesaje (no había
 *   nada de entonces) · default: el peso por defecto de Ajustes (no hay ningún pesaje).
 */
export function markBodyweight(r, { bodyweight = [], context = [], fallbackKg = 75, today = todayStr() } = {}) {
  if (isNum(r.bodyweightKg)) return { kg: r.bodyweightKg, source: 'record' };
  const logs = (bodyweight || []).filter((b) => b && b.kg > 0 && isDateStr(b.id));
  if (r.date) {
    const from = approxFrom(r.date);
    const to = approxTo(r.date);
    const mid = addDays(from, Math.floor(diffDays(from, to) / 2));
    const lo = addDays(from, -BW_MARGIN_DAYS);
    const hi = addDays(to, BW_MARGIN_DAYS);
    let best = null;
    for (const b of logs) {
      if (b.id < lo || b.id > hi) continue;
      const dist = Math.abs(diffDays(mid, b.id));
      if (!best || dist < best.dist) best = { b, dist };
    }
    if (best) return { kg: best.b.kg, source: 'log', date: best.b.id };
    const refs = weightReferences(context, to);
    let point = null;
    for (const x of refs) {
      if (x.kind !== 'point' || x.to < lo || x.from > hi) continue;
      const dist = Math.abs(diffDays(mid, x.from));
      if (!point || dist < point.dist) point = { x, dist };
    }
    if (point) return { kg: point.x.kg, source: 'context', date: point.x.from };
    const usual = refs.filter((x) => x.kind === 'usual').pop();
    if (usual) return { kg: usual.kg, source: 'context', date: usual.from };
  }
  if (logs.length) {
    const last = logs.reduce((a, b) => (b.id > a.id ? b : a));
    return { kg: last.kg, source: 'current', date: last.id };
  }
  return { kg: isNum(fallbackKg) && fallbackKg > 0 ? fallbackKg : 75, source: 'default' };
}

const BW_SOURCE_TXT = {
  record: 'el que apuntaste en la marca',
  log: 'tu pesaje más cercano a esa fecha',
  context: 'tu contexto (peso habitual o peso en esa fecha)',
  current: 'tu peso actual: no hay un pesaje de entonces (añádelo en la marca para afinar)',
  default: 'el peso por defecto de Ajustes: no hay ningún pesaje (añádelo en la marca para afinar)',
};

// ---------------------------------------------------------------------------
// 1RM estimado de una marca
// ---------------------------------------------------------------------------

/**
 * → { record, e1rm:number|null, load:number|null, bw:{kg,source,date?}|null, reason:null|'type'|'reps' }
 *   reason 'type': el ejercicio no tiene 1RM estimado (core de peso corporal); 'reps': más de 12 repeticiones.
 */
export function markEstimate(r, exercise, env = {}) {
  const isBw = exercise?.logType === 'bodyweight';
  const bw = isBw ? markBodyweight(r, env) : null;
  if (!comparableType(exercise)) return { record: r, e1rm: null, load: null, bw, reason: 'type' };
  const m = setMetrics({ weight: r.weight, reps: r.reps, repsR: r.reps, rir: r.rir }, exercise, bw ? bw.kg : null);
  return { record: r, e1rm: m.e1rm, load: m.load, bw, reason: m.e1rm == null ? 'reps' : null };
}

// ---------------------------------------------------------------------------
// Ahora frente a antes
// ---------------------------------------------------------------------------

function bestEntry(entries) {
  let best = null;
  for (const e of entries) if (e.e1rm != null && (!best || e.e1rm > best.e1rm + EPS)) best = e;
  return best;
}

/**
 * Compara el rendimiento actual de un ejercicio con el mejor rendimiento anterior.
 * @param {object} p
 * @param {object} p.exercise
 * @param {object[]} p.marks      sus marcas históricas (pastRecords, se sanean aquí)
 * @param {object[]} p.history    stats.exerciseHistory(data, id, { labels:false }) (asc, una fila por sesión)
 * @param {string}   p.today
 * @param {object}   [p.env]      { bodyweight, context, fallbackKg } para el peso corporal de las marcas
 * @param {number}   [p.days]     ventana de «ahora» (CURRENT_DAYS)
 * @returns {{
 *   status:'ok'|'no_reference'|'no_current'|'not_comparable', reason:null|'type'|'logtype'|'reps',
 *   pct:number|null, ratio:number|null, since:string,
 *   marks: object[],           // markEstimate de cada marca, de la de más 1RM a la de menos (sin 1RM al final)
 *   bestMark: object|null,     // la de más 1RM estimado
 *   current: object|null,      // fila de stats.exerciseHistory con el mayor 1RM desde `since`
 *   appBefore: object|null,    // ídem, antes de `since`
 *   reference: {source:'mark', e1rm, mark} | {source:'app', e1rm, entry} | null,
 *   lastDate: string|null      // última sesión con este ejercicio
 * }}
 */
export function exerciseRecovery({ exercise, marks = [], history = [], today = todayStr(), env = {}, days = CURRENT_DAYS }) {
  const since = addDays(today, -(days - 1));
  const own = normalizePastRecords(marks).filter((r) => r.exerciseId === exercise?.id);
  const est = own.map((r) => markEstimate(r, exercise, { ...env, today }))
    .sort((a, b) => (b.e1rm ?? -Infinity) - (a.e1rm ?? -Infinity) || (b.record.date?.date || '').localeCompare(a.record.date?.date || ''));
  const withE1 = est.filter((x) => x.e1rm != null);
  const bestMark = withE1[0] || null;
  const hist = Array.isArray(history) ? history : [];
  const current = bestEntry(hist.filter((e) => e.date >= since && e.date <= today));
  const appBefore = bestEntry(hist.filter((e) => e.date < since));
  const lastDate = hist.length ? hist[hist.length - 1].date : null;
  const out = { status: 'no_reference', reason: null, pct: null, ratio: null, since, marks: est, bestMark, current, appBefore, reference: null, lastDate };

  // Sin 1RM estimado: core de peso corporal ('type') o un ejercicio que ya no se registra con peso y reps ('logtype').
  if (!comparableType(exercise)) return { ...out, status: own.length ? 'not_comparable' : 'no_reference', reason: own.length ? (markable(exercise) ? 'type' : 'logtype') : null };
  if (bestMark && (!appBefore || bestMark.e1rm >= appBefore.e1rm - EPS)) out.reference = { source: 'mark', e1rm: bestMark.e1rm, mark: bestMark };
  else if (appBefore) out.reference = { source: 'app', e1rm: appBefore.e1rm, entry: appBefore };
  if (!out.reference) return { ...out, status: own.length ? 'not_comparable' : 'no_reference', reason: own.length ? 'reps' : null };
  if (!current) return { ...out, status: 'no_current' };
  out.ratio = current.e1rm / out.reference.e1rm;
  out.pct = Math.round(out.ratio * 100);
  out.status = 'ok';
  return out;
}

/** Una línea para la ficha y la lista. null si no hay nada que decir (sin marcas ni historial anterior). */
export function recoveryLine(r) {
  if (!r) return null;
  const refTxt = r.reference?.source === 'app' ? 'tu mejor marca anterior en Entreno' : 'tu mejor marca histórica';
  if (r.status === 'ok') {
    if (r.pct > 100) return `Rendimiento actual ≈ ${r.pct} % de ${refTxt}: ya la has superado.`;
    if (r.pct === 100) return `Rendimiento actual ≈ 100 % de ${refTxt}: estás a su altura.`;
    return `Rendimiento actual ≈ ${r.pct} % de ${refTxt}.`;
  }
  if (r.status === 'no_current') {
    return r.lastDate
      ? `Sin series de 1–12 repeticiones en las últimas ${Math.round(CURRENT_DAYS / 7)} semanas: aún no se puede comparar con ${refTxt}.`
      : `Cuando registres este ejercicio (series de 1–12 repeticiones), verás aquí qué porcentaje de ${refTxt} llevas recuperado.`;
  }
  if (r.status === 'not_comparable') {
    if (r.reason === 'type') return 'Este ejercicio no tiene 1RM estimado (en core el peso corporal no es la carga): la marca se guarda, pero no se compara.';
    if (r.reason === 'logtype') return 'Este ejercicio ya no se registra con peso y repeticiones: la marca se guarda, pero no se compara.';
    return `Tus marcas tienen más de ${E1RM_MAX_REPS} repeticiones: el 1RM estimado no sería fiable, así que no se compara.`;
  }
  return null;
}

/**
 * «¿Cómo se calcula?»: filas { label, value } y notas (strings) con los datos concretos.
 * `labels` = { setLabel(entry) → texto de la serie de una fila del historial } (lo pone la vista).
 */
export function recoveryWhy(r, exercise, { setLabel = () => '', today = todayStr() } = {}) {
  const rows = [];
  const notes = [];
  const lt = exercise?.logType;
  const day = (d) => fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full');
  if (r.current) rows.push({ label: 'Ahora', value: `${kgTxt(r.current.e1rm)} · ${setLabel(r.current)} · ${day(r.current.date)}`, sub: `el mayor 1RM estimado desde el ${day(r.since)} (últimas ${Math.round(CURRENT_DAYS / 7)} semanas)` });
  const ref = r.reference;
  if (ref?.source === 'mark') {
    const m = ref.mark;
    rows.push({ label: 'Mejor marca histórica', value: `${kgTxt(m.e1rm)} · ${markLabel(m.record, lt)} · ${markWhen(m.record)}`, sub: m.record.beforeApp ? 'introducida a mano · anterior a Entreno' : 'introducida a mano' });
  } else if (ref?.source === 'app') {
    rows.push({ label: 'Mejor marca anterior en Entreno', value: `${kgTxt(ref.e1rm)} · ${setLabel(ref.entry)} · ${day(ref.entry.date)}`, sub: `registrada en Entreno antes del ${day(r.since)}` });
  }
  if (r.status === 'ok') rows.push({ label: 'Cálculo', value: `${fmtNum(r.current.e1rm, 1)} ÷ ${fmtNum(ref.e1rm, 1)} = ${r.pct} %` });
  notes.push(`El 1RM estimado usa la fórmula de Epley (peso × (1 + repeticiones ÷ 30), contando reps + RIR) y solo series de 1 a ${E1RM_MAX_REPS} repeticiones. Es una estimación para comparar, no un peso levantado.`);
  notes.push('Se comparan tus marcas introducidas a mano y lo registrado en Entreno antes de estas semanas: la referencia es la mayor de las dos (los récords de Entreno siguen aparte, en Récords).');
  if (ref?.source === 'mark') {
    const m = ref.mark;
    if (m.record.rir == null) notes.push('La marca no tiene RIR apuntado: se cuenta como serie al fallo (RIR 0).');
    if (!m.record.date) notes.push('La marca no tiene fecha: no se sabe cuánto hace.');
    else if (m.record.date.precision !== 'day') notes.push(`Fecha aproximada (${markWhen(m.record)}).`);
    if (m.bw) notes.push(`Peso corporal de entonces: ${kgTxt(m.bw.kg)}, ${BW_SOURCE_TXT[m.bw.source]}.`);
  }
  if (lt === 'bodyweight' && (r.current || ref?.source === 'app')) notes.push('En Entreno, el peso corporal de cada día sale de tus pesajes.');
  return { rows, notes };
}

/** Marcas agrupadas por ejercicio para la lista: [{ exerciseId, records:[…] }] (las más recientes primero). */
export function groupByExercise(list) {
  const map = new Map();
  for (const r of normalizePastRecords(list)) {
    if (!map.has(r.exerciseId)) map.set(r.exerciseId, []);
    map.get(r.exerciseId).push(r);
  }
  const key = (r) => r.date?.date || '';
  return [...map.entries()].map(([exerciseId, records]) => ({
    exerciseId,
    records: records.sort((a, b) => key(b).localeCompare(key(a)) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
  }));
}
