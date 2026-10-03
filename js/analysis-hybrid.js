// analysis-hybrid.js — «tu analista», ronda 6 fase D (docs/MEJORAS6.md): carga por deporte, volumen con contexto,
// interferencia con datos PERSONALES y agujetas por ejercicio. PURO (sin store ni DOM; «hoy» inyectable).
//
//   analyzeHybrid(data, { today, profile, context, strength }) → {
//     sportLoad:   { weeks, rows:[{ kind, label, minutes4w, load4w, sessions4w, noRpe4w, prevLoad4w, changePct, lastWeekLoad, spike }] },
//     volume:      { muscles:[{ muscleId, name, avgSets, target, decision:'keep'|'add'|'reduce'|'none', reasons }] },
//     associations:[{ id, kind, …, n1, n2, diff, effect, pattern:'worse'|'better'|'none'|'insufficient', confidence }],
//     doms:        [{ exerciseId, name, muscleId, withEx, without, n1, n2, diff, pattern, byDay, peakDay, dose }],
//     volumeChanges:[{ muscleId, avgA, avgB, direction, exerciseId, rateA, rateB, diff, pattern, confidence }],
//     insights:    Insight[] (áreas 'strength', 'endurance' y 'recovery')
//   }
//   data = el de buildAnalysis (dataFromStore + checkins + context + …); strength = analyzeStrength(…) (para el volumen);
//   endurance = analyzeEndurance(…) (sus veces de interferencia acompañan a la asociación personal de la pierna).
//
// findInterference (analysis-training) sigue siendo la regla GENERAL (cuenta las veces); cuando hay datos personales
// suficientes para «pierna tras resistencia exigente», buildAnalysis enseña la asociación personal en su lugar.
//
// REGLAS COMUNES de las asociaciones personales (plan aprobado): al menos MIN_OBS veces con el factor y MIN_OBS sin él,
// repartidas en MIN_SPAN_DAYS días o más, y una diferencia apreciable (rendimiento ≥ 3 % y d de Cohen ≥ 0,5; agujetas
// ≥ 1,5 puntos de 10 y d ≥ 0,5; ritmo ≥ 2 % y d ≥ 0,5). Lenguaje: «en tus registros… aparece asociado a / coincide con»,
// nunca «causa». Si hay datos suficientes y NO hay diferencia, también se dice (resultado personal positivo).
import { addDays, diffDays, isDateStr, todayStr, fmtDate, fmtNum, fmtPace, weekStart, round } from './util.js';
import { isWorkSet, setMetrics, sessionDurationMin, pace, rirValue } from './calc.js';
import { weeklySeries, adherenceSeries, adherenceTotals, runPaceSeries, weekPlanOf, exerciseHistory } from './stats.js';
import { MUSCLE_LABEL, defaultSettings } from './seed.js';
import { areasOf, checkinsBetween } from './checkin-logic.js';
import { combine, byCount, bySpan, capAt, insufficient as confInsufficient, confidenceRow } from './confidence.js';
import {
  sessionPerformance, classifyIntensity, demandingEndurance, legSetsOf, muscleAverages, fatigueSignals, LEG_MUSCLES, ENDURANCE_KINDS,
  theilSen, median, rateText,
} from './analysis-training.js';

/** Mínimos de las asociaciones personales. */
export const MIN_OBS = 6;
export const MIN_SPAN_DAYS = 28;
/** Ventana de búsqueda de asociaciones (semanas). */
export const ASSOC_WEEKS = 26;
/** Diferencias apreciables. */
export const PERF_PCT = 3;
export const DOMS_POINTS = 1.5;
export const PACE_PCT = 2;
export const EFFECT_D = 0.5;
/** Agujetas «después» de una sesión: check-ins de 1 a 3 días después (24–72 h). */
export const DOMS_FROM_DAYS = 1;
export const DOMS_TO_DAYS = 3;
/** Pico de carga de un deporte: la última semana ≥ 50 % por encima de su media de las 4 anteriores (con ≥ 3 semanas con datos). */
export const SPIKE_PCT = 50;
/** Volumen: agujetas fuertes (≥ 7/10) repetidas en un músculo (≥ 2 veces en 14 días) cuentan como «mucha molestia». */
export const DOMS_HIGH = 7;
export const DOMS_HIGH_TIMES = 2;
export const DOMS_RECENT_DAYS = 14;
/** Constancia baja: menos del 70 % de lo planificado hecho en 4 semanas. */
export const ADHERENCE_LOW_PCT = 70;
/** Sesiones de fuerza saltadas o a medias: diferencia apreciable de 15 puntos porcentuales entre semanas. */
export const SKIP_POINTS = 15;
/** Cambios de volumen: bloques de 6 semanas completas; cambio ≥ 25 % y ≥ 2 series/sem; ritmo distinto ≥ 0,5 %/sem. */
export const VOLUME_BLOCK_WEEKS = 6;
export const VOLUME_CHANGE_PCT = 25;
export const VOLUME_CHANGE_SETS = 2;
export const RATE_DIFF_PCT = 0.5;

export const SPORT_LABEL = { strength: 'Fuerza', run: 'Carrera', bike: 'Bici', swim: 'Natación', hike: 'Senderismo', other: 'Otras' };
const SPORTS = ['strength', 'run', 'bike', 'swim', 'hike', 'other'];
const EPS = 1e-9;

const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);
const toMap = (x) => (x instanceof Map ? x : new Map(toArr(x).filter(Boolean).map((o) => [o.id, o])));
const meanOf = (xs) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);
function sdOf(xs) {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((t, v) => t + (v - m) ** 2, 0) / (xs.length - 1));
}
const plural = (n, one, many) => `${fmtNum(n, 0)} ${n === 1 ? one : many}`;
/** d de Cohen legible: sin variación en un grupo sale enorme (o infinito); por encima de 10 se dice así. */
const dTxt = (d) => (d == null || Number.isNaN(d) ? '—' : Math.abs(d) >= 10 ? (d > 0 ? 'más de 10' : 'menos de −10') : fmtNum(d, 2));
const pctTxt = (v, dec = 0) => `${fmtNum(v, dec)} %`;
const dayTxt = (d, today) => fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full');
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const muscleName = (m) => (MUSCLE_LABEL[m] || m).toLowerCase();
function joinList(xs) {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

/** Diferencia de dos grupos: medias, diferencia relativa o absoluta y d de Cohen (con desviación conjunta). */
export function compareGroups(a, b, { relative = true } = {}) {
  const m1 = meanOf(a); const m2 = meanOf(b);
  if (m1 == null || m2 == null) return null;
  const n1 = a.length; const n2 = b.length;
  const pooled = n1 + n2 > 2 ? Math.sqrt(((n1 - 1) * sdOf(a) ** 2 + (n2 - 1) * sdOf(b) ** 2) / (n1 + n2 - 2)) : 0;
  const delta = m1 - m2;
  const d = pooled > 0 ? delta / pooled : delta !== 0 ? Math.sign(delta) * Infinity : 0;
  return { m1, m2, n1, n2, diff: relative ? (m2 !== 0 ? (delta / Math.abs(m2)) * 100 : null) : delta, d };
}

/** Confianza de una asociación: observaciones del grupo menor, días cubiertos y tamaño del efecto. */
export function associationConfidence(n1, n2, spanDays, d = null) {
  const n = Math.min(n1, n2);
  const f = [
    byCount(n, { low: MIN_OBS, medium: 8, high: 12 }, (k) => `${k} ${k === 1 ? 'vez' : 'veces'} en el grupo más pequeño`, 'count'),
    bySpan(spanDays, { low: MIN_SPAN_DAYS, medium: 42, high: 84 }),
  ];
  if (d != null && Number.isFinite(d) && Math.abs(d) < 0.8) f.push(capAt('medium', 'diferencia moderada', 'effect'));
  return combine(f);
}

/** Insight con why y confianza (mismo formato que analysis-training). */
function insight(o) {
  const data = (o.data || []).filter(Boolean);
  if (o.context?.length) data.push({ label: 'Contexto tenido en cuenta', value: o.context.join(' · ') });
  if (o.confidence) data.push(confidenceRow(o.confidence));
  const out = {
    id: o.id, area: o.area, level: o.level, priority: Math.max(0, Math.min(100, Math.round(o.priority))), title: o.title,
    text: o.text || [o.parts?.observation, o.parts?.interpretation, o.parts?.recommendation].filter(Boolean).join(' '),
    why: { rule: o.rule, data: data.length ? data : [{ label: 'Datos', value: 'sin datos en el periodo' }] },
    sources: (o.sources || []).filter(Boolean),
  };
  if (o.action) out.action = o.action;
  if (o.confidence) out.confidence = { level: o.confidence.level, label: o.confidence.label, short: o.confidence.short, reasons: o.confidence.reasons };
  if (o.context?.length) out.context = o.context.slice();
  if (o.parts) out.parts = { ...o.parts };
  return out;
}

// ===========================================================================
// Carga por deporte (weekAgg vía stats.weeklySeries)
// ===========================================================================

/**
 * Carga (min × RPE) y minutos por deporte: últimas 4 semanas completas frente a las 4 anteriores, y la semana en curso
 * frente a la media de las 4 anteriores (pico). La carga total de siempre no cambia: esto la reparte. Un deporte sin
 * RPE no tiene carga (se cuentan esas sesiones).
 */
export function sportLoad(d, today) {
  const cw = weekStart(today);
  const rows = weeklySeries(d, addDays(cw, -56), cw);
  const cur = rows[rows.length - 1];
  const last4 = rows.slice(-5, -1);
  const prev4 = rows.slice(-9, -5);
  const sum = (list, f) => list.reduce((t, r) => t + (f(r) || 0), 0);
  const noRpe = new Map(SPORTS.map((k) => [k, 0]));
  const from4 = last4.length ? last4[0].week : cw;
  for (const s of toArr(d.sessions)) {
    if (!s || s.status !== 'done' || !isDateStr(s.date) || s.date < from4 || s.date >= cw) continue;
    const k = SPORTS.includes(s.kind) ? s.kind : 'other';
    if (!(s.rpe >= 1)) noRpe.set(k, noRpe.get(k) + 1);
  }
  const out = SPORTS.map((k) => {
    const load4 = sum(last4, (r) => r.load[k]);
    const prevLoad4 = sum(prev4, (r) => r.load[k]);
    const weeksWith = last4.filter((r) => r.load[k] > 0).length;
    const avgWeek = load4 / 4;
    const lastWeekLoad = cur ? cur.load[k] : 0;
    return {
      kind: k, label: SPORT_LABEL[k],
      minutes4w: round(sum(last4, (r) => r.minutes[k]) / 4, 1),
      load4w: round(avgWeek, 1),
      sessions4w: sum(last4, (r) => r.count[k]),
      noRpe4w: noRpe.get(k),
      prevLoad4w: round(prevLoad4 / 4, 1),
      changePct: prevLoad4 > 0 ? round(((load4 - prevLoad4) / prevLoad4) * 100, 1) : null,
      lastWeekLoad,
      spike: weeksWith >= 3 && avgWeek > 0 && lastWeekLoad >= avgWeek * (1 + SPIKE_PCT / 100) && lastWeekLoad - avgWeek >= 120,
    };
  }).filter((r) => r.sessions4w > 0 || r.lastWeekLoad > 0);
  const total4w = out.reduce((t, r) => t + r.load4w, 0);
  for (const r of out) r.share = total4w > 0 ? round((r.load4w / total4w) * 100, 1) : null;
  return { weeks: 4, from: from4, to: addDays(cw, -1), currentWeek: cw, rows: out.sort((a, b) => b.load4w - a.load4w), total4w: round(total4w, 1) };
}

function sportLoadInsight(sl, today) {
  const rows = sl.rows;
  const withLoad = rows.filter((r) => r.load4w > 0);
  if (withLoad.length < 2 && !rows.some((r) => r.spike)) return null;
  const spikes = rows.filter((r) => r.spike);
  const data = rows.map((r) => ({
    label: r.label,
    value: `${fmtNum(r.minutes4w, 0)} min/sem · carga ${fmtNum(r.load4w, 0)}/sem${r.share != null ? ` (${pctTxt(r.share)})` : ''}${r.changePct != null ? ` · ${r.changePct >= 0 ? '+' : '−'}${pctTxt(Math.abs(r.changePct))} frente a las 4 anteriores` : ''}${r.noRpe4w ? ` · ${plural(r.noRpe4w, 'sesión sin RPE', 'sesiones sin RPE')}` : ''}`,
  }));
  const noRpe = rows.reduce((t, r) => t + r.noRpe4w, 0);
  const conf = combine([
    byCount(rows.reduce((t, r) => t + r.sessions4w, 0), { low: 4, medium: 8, high: 12 }, (k) => `${k} sesiones en 4 semanas`, 'count'),
    noRpe ? capAt('medium', `${plural(noRpe, 'sesión sin esfuerzo (RPE)', 'sesiones sin esfuerzo (RPE)')}: sin carga`, 'rpe') : null,
  ]);
  const top = withLoad.slice(0, 3).map((r) => `${r.label.toLowerCase()} ${pctTxt(r.share)}`);
  let parts;
  if (spikes.length) {
    const s = spikes[0];
    parts = {
      observation: `Esta semana llevas una carga de ${s.label.toLowerCase()} de ${fmtNum(s.lastWeekLoad, 0)}, un ${pctTxt(((s.lastWeekLoad - s.load4w) / s.load4w) * 100)} por encima de tu media de las 4 semanas anteriores (${fmtNum(s.load4w, 0)}).`,
      interpretation: 'Las subidas bruscas de carga de un deporte suelen notarse en el cansancio y en las demás sesiones, aunque la carga total parezca normal.',
      recommendation: 'Si te notas cansado o rindes peor, suaviza las próximas sesiones de ese deporte; si te encuentras bien, no hace falta cambiar nada.',
    };
  } else {
    parts = {
      observation: `En las últimas 4 semanas tu carga se reparte así: ${joinList(top)}.`,
      interpretation: 'Cada deporte se mide por separado (minutos × esfuerzo): 3 horas de senderismo suave no cuentan como 3 horas de carrera.',
      recommendation: null,
    };
  }
  return insight({
    id: 'load-sport', area: 'endurance', level: spikes.length ? 'warn' : 'info', priority: spikes.length ? 48 : 26,
    title: spikes.length ? `Pico de carga en ${spikes[0].label.toLowerCase()}` : 'Tu carga por deporte',
    parts,
    rule: `Carga de cada sesión = minutos × esfuerzo percibido (RPE 1–10); sin RPE no hay carga. Por deporte: media semanal de las 4 semanas completas anteriores frente a las 4 de antes, y la semana en curso frente a esa media (pico: un ${SPIKE_PCT} % más o más, con al menos 3 semanas con carga y 120 de diferencia). La carga total de Progreso es la suma de todas.`,
    data, confidence: conf, sources: [],
  });
}

// ===========================================================================
// Agujetas por zona tras las sesiones
// ===========================================================================

/**
 * Agujetas por músculo de los check-ins de cada día de 1 a 3 días después de `date` (24, 48 y 72 h): por día, Map(músculo
 * → nivel máximo) o null si ese día no hay check-in con zonas. En un check-in con zonas, un músculo no apuntado cuenta 0.
 */
function domsByDay(byDate, date) {
  const out = [];
  for (let k = DOMS_FROM_DAYS; k <= DOMS_TO_DAYS; k++) {
    let m = null;
    for (const c of byDate.get(addDays(date, k)) || []) {
      const areas = areasOf(c).filter((a) => a.kind === 'muscle');
      if (!areas.length) continue;
      m = m || new Map();
      for (const a of areas) m.set(a.zone, Math.max(m.get(a.zone) ?? 0, a.level));
    }
    out.push(m);
  }
  return out;
}

/** Agujetas por músculo de las 24–72 h siguientes a `date` (la máxima de esos días). → Map(músculo → nivel) | null */
function domsAfter(byDate, date) {
  const days = domsByDay(byDate, date).filter(Boolean);
  if (!days.length) return null;
  const out = new Map();
  for (const m of days) for (const [z, l] of m) out.set(z, Math.max(out.get(z) ?? 0, l));
  return out;
}

function checkinsByDate(d, from, to) {
  const m = new Map();
  for (const c of checkinsBetween(d.checkins, from, to)) {
    if (!m.has(c.date)) m.set(c.date, []);
    m.get(c.date).push(c);
  }
  return m;
}

/** Parte en dos por la mediana (los iguales a la mediana van arriba o abajo, lo que deje los dos grupos con ≥ MIN_OBS). */
function splitByMedian(rows, f) {
  const vals = rows.map(f).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (vals.length < 2 * MIN_OBS || vals[0] === vals[vals.length - 1]) return null;
  const med = vals[Math.floor(vals.length / 2)];
  for (const strict of [true, false]) {
    const hi = rows.filter((x) => Number.isFinite(f(x)) && (strict ? f(x) > med : f(x) >= med));
    const lo = rows.filter((x) => Number.isFinite(f(x)) && !(strict ? f(x) > med : f(x) >= med));
    if (hi.length >= MIN_OBS && lo.length >= MIN_OBS) return { hi, lo, cut: med, strict };
  }
  return null;
}

/** Dosis del ejercicio frente a las agujetas de su músculo: series, RIR y carga (volumen = Σ peso × reps). */
const DOSE = {
  sets: { label: 'series', hiTxt: (c) => `${c.strict ? fmtNum(c.cut + 1, 0) : fmtNum(c.cut, 0)} series o más`, loTxt: () => 'menos series' },
  rir: { label: 'RIR', hiTxt: () => 'RIR 0–1 (cerca del fallo)', loTxt: () => 'RIR 2 o más' },
  load: { label: 'carga', hiTxt: () => 'más carga (series × repeticiones × peso)', loTxt: () => 'menos carga' },
};

function doseComparison(withEx, id) {
  const stat = (x) => x.exercises.get(id);
  const cands = [];
  const sp = splitByMedian(withEx, (x) => stat(x).sets);
  if (sp) cands.push({ factor: 'sets', ...sp });
  const withRir = withEx.filter((x) => stat(x).rir != null);
  const hard = withRir.filter((x) => stat(x).rir <= 1); const easy = withRir.filter((x) => stat(x).rir >= 2);
  if (hard.length >= MIN_OBS && easy.length >= MIN_OBS) cands.push({ factor: 'rir', hi: hard, lo: easy, cut: 1, strict: false });
  const lp = splitByMedian(withEx, (x) => stat(x).tonnage);
  if (lp) cands.push({ factor: 'load', ...lp });
  let best = null;
  for (const c of cands) {
    const dates = [...c.hi, ...c.lo].map((x) => x.date).sort();
    const span = diffDays(dates[0], dates[dates.length - 1]);
    if (span < MIN_SPAN_DAYS) continue;
    const cmp = compareGroups(c.hi.map((x) => x.level), c.lo.map((x) => x.level), { relative: false });
    const worse = cmp.diff >= DOMS_POINTS - EPS && cmp.d >= EFFECT_D - EPS;
    const row = {
      factor: c.factor, label: DOSE[c.factor].label, hiTxt: DOSE[c.factor].hiTxt(c), loTxt: DOSE[c.factor].loTxt(c),
      m1: round(cmp.m1, 0.1), m2: round(cmp.m2, 0.1), n1: cmp.n1, n2: cmp.n2, diff: round(cmp.diff, 0.1), d: cmp.d, span,
      pattern: worse ? 'worse' : 'none',
      confidence: combine([...associationConfidence(cmp.n1, cmp.n2, span, cmp.d).factors, capAt('medium', 'se miran a la vez las series, el RIR y la carga', 'multi')]),
    };
    if (!best || (row.pattern === 'worse' && (best.pattern !== 'worse' || row.diff > best.diff))) best = row;
  }
  return best;
}

/** Media de las agujetas de cada día (24, 48, 72 h) con al menos MIN_OBS check-ins con zonas ese día; y el día del pico. */
function domsCurve(rows) {
  const byDay = [0, 1, 2].map((k) => {
    const v = rows.map((x) => x.byDay[k]).filter((y) => y != null);
    return v.length >= MIN_OBS ? { mean: round(meanOf(v), 0.1), n: v.length } : null;
  });
  const known = byDay.map((x, k) => (x ? { k, ...x } : null)).filter(Boolean);
  const peak = known.length >= 2 ? known.reduce((a, b) => (b.mean > a.mean ? b : a)) : null;
  return { byDay, peakDay: peak && peak.mean > 0 ? (peak.k + DOMS_FROM_DAYS) : null };
}

/**
 * Agujetas por ejercicio: para cada ejercicio y su músculo principal, agujetas de ese músculo en los check-ins de las
 * 24–72 h siguientes a las sesiones CON el ejercicio frente a las sesiones con ese músculo SIN él (solo sesiones con
 * algún check-in con zonas en esos días; ≥ MIN_OBS en cada grupo y ≥ MIN_SPAN_DAYS). Además, dentro de las sesiones con
 * el ejercicio: la dosis (series, RIR, carga) frente a las agujetas, y la curva de 24, 48 y 72 h.
 */
export function domsByExercise(d, today) {
  const exMap = toMap(d.exercises);
  const from = addDays(today, -(ASSOC_WEEKS * 7 - 1));
  const byDate = checkinsByDate(d, from, addDays(today, DOMS_TO_DAYS));
  const ses = toArr(d.sessions).filter((s) => s && s.kind === 'strength' && s.status === 'done' && isDateStr(s.date) && s.date >= from && s.date <= today);
  // muscle → [{ date, level, byDay:[24 h, 48 h, 72 h], exercises: Map(id → { sets, rir, tonnage }), sets }]
  const byMuscle = new Map();
  for (const s of ses) {
    const days = domsByDay(byDate, s.date);
    if (!days.some(Boolean)) continue;
    const perMuscle = new Map();
    for (const se of s.exercises || []) {
      const ex = exMap.get(se.exerciseId);
      const work = (se.sets || []).filter(isWorkSet);
      if (!ex || !work.length) continue;
      const rirs = work.map((st) => rirValue(st.rir)).filter((v) => v != null);
      const vols = work.map((st) => setMetrics(st, ex, null).volume).filter((v) => Number.isFinite(v) && v > 0);
      const stat = { sets: work.length, rir: rirs.length ? meanOf(rirs) : null, tonnage: vols.length ? vols.reduce((t, v) => t + v, 0) : null };
      for (const m of ex.primary || []) {
        if (!perMuscle.has(m)) perMuscle.set(m, { exercises: new Map(), sets: 0 });
        const pm = perMuscle.get(m);
        const prev = pm.exercises.get(ex.id);
        pm.exercises.set(ex.id, prev ? { sets: prev.sets + stat.sets, rir: stat.rir ?? prev.rir, tonnage: (prev.tonnage || 0) + (stat.tonnage || 0) || null } : stat);
        pm.sets += work.length;
      }
    }
    for (const [m, pm] of perMuscle) {
      if (!byMuscle.has(m)) byMuscle.set(m, []);
      const byDay = days.map((x) => (x ? x.get(m) ?? 0 : null));
      byMuscle.get(m).push({ date: s.date, level: Math.max(...byDay.filter((v) => v != null)), byDay, exercises: pm.exercises, sets: pm.sets });
    }
  }
  const out = [];
  for (const [m, list] of byMuscle) {
    const exIds = new Set(list.flatMap((x) => [...x.exercises.keys()]));
    for (const id of exIds) {
      const withEx = list.filter((x) => x.exercises.has(id));
      const without = list.filter((x) => !x.exercises.has(id));
      if (withEx.length < MIN_OBS) continue;
      const dose = doseComparison(withEx, id);
      const curve = domsCurve(withEx);
      const row = { exerciseId: id, name: exMap.get(id)?.name || id, muscleId: m, n1: withEx.length, n2: without.length, dose, ...curve };
      const dates = list.map((x) => x.date).sort();
      const span = diffDays(dates[0], dates[dates.length - 1]);
      if (without.length >= MIN_OBS && span >= MIN_SPAN_DAYS) {
        const cmp = compareGroups(withEx.map((x) => x.level), without.map((x) => x.level), { relative: false });
        const pattern = cmp.diff >= DOMS_POINTS - EPS && cmp.d >= EFFECT_D - EPS ? 'worse' : cmp.diff <= -(DOMS_POINTS - EPS) && cmp.d <= -(EFFECT_D - EPS) ? 'better' : 'none';
        Object.assign(row, { withEx: round(cmp.m1, 0.1), without: round(cmp.m2, 0.1), diff: round(cmp.diff, 0.1), d: cmp.d, span, pattern, confidence: associationConfidence(cmp.n1, cmp.n2, span, cmp.d) });
      } else {
        Object.assign(row, { withEx: round(meanOf(withEx.map((x) => x.level)), 0.1), without: null, diff: null, d: null, span, pattern: 'insufficient', confidence: confInsufficient(`hacen falta ${MIN_OBS} sesiones que trabajen ${muscleName(m)} sin ese ejercicio (hay ${without.length})`) });
      }
      out.push(row);
    }
  }
  return out.sort((a, b) => (b.pattern === 'worse') - (a.pattern === 'worse') || (b.diff ?? -99) - (a.diff ?? -99));
}

const HOURS = { 1: '24 h', 2: '48 h', 3: '72 h' };
const curveTxt = (x) => x.byDay.map((y, k) => (y ? `${HOURS[k + DOMS_FROM_DAYS]}: ${fmtNum(y.mean, 1)}/10` : null)).filter(Boolean).join(' · ');

function domsInsight(doms, today) {
  const worse = doms.filter((x) => x.pattern === 'worse').slice(0, 3);
  if (!worse.length) return null;
  const x = worse[0];
  const peak = x.peakDay ? ` Suelen notarse más a las ${HOURS[x.peakDay]}.` : '';
  return insight({
    id: 'doms-exercise', area: 'strength', level: 'info', priority: 36,
    title: `Agujetas de ${muscleName(x.muscleId)} tras ${x.name}`,
    parts: {
      observation: `En tus registros, las agujetas de ${muscleName(x.muscleId)} de las 24–72 h siguientes son de ${fmtNum(x.withEx, 1)}/10 de media tras las sesiones con ${x.name}, frente a ${fmtNum(x.without, 1)}/10 en las que trabajan ${muscleName(x.muscleId)} sin él (${x.n1} y ${x.n2} sesiones).${peak}`,
      interpretation: `Ese ejercicio aparece asociado a más agujetas${worse.length > 1 ? `, igual que ${joinList(worse.slice(1).map((y) => `${y.name} (${muscleName(y.muscleId)})`))}` : ''}. Es una asociación en tus datos, no una causa demostrada: también influyen las series, el RIR y lo nuevo que sea el ejercicio.`,
      recommendation: 'Si esas agujetas te molestan en las sesiones siguientes, prueba 1 serie menos o un RIR más en ese ejercicio unas semanas y mira si cambian.',
    },
    rule: `Agujetas por zona (0–10) de los check-ins de 1 a 3 días después de cada sesión de fuerza de las últimas ${ASSOC_WEEKS} semanas (solo las sesiones con algún check-in con zonas en esos días). Para cada ejercicio y su músculo principal, sesiones con el ejercicio frente a sesiones que trabajan ese músculo sin él. Solo con al menos ${MIN_OBS} sesiones en cada grupo, repartidas en ${MIN_SPAN_DAYS / 7} semanas o más, y una diferencia de ${fmtNum(DOMS_POINTS, 1)} puntos o más con un efecto moderado (d ≥ ${fmtNum(EFFECT_D, 1)}). Por día (24, 48 y 72 h), solo con ${MIN_OBS} check-ins o más ese día.`,
    data: [
      ...worse.map((y) => ({ label: `${y.name} · ${muscleName(y.muscleId)}`, value: `${fmtNum(y.withEx, 1)}/10 con él (${y.n1}) · ${fmtNum(y.without, 1)}/10 sin él (${y.n2})` })),
      curveTxt(x) ? { label: `Por día tras ${x.name}`, value: curveTxt(x) } : null,
    ],
    confidence: worse.reduce((c, y) => (c && LEVEL_RANK[c.level] <= LEVEL_RANK[y.confidence.level] ? c : y.confidence), null),
  });
}

/** Dosis frente a agujetas dentro de un ejercicio: el factor (series, RIR o carga) con la mayor diferencia apreciable. */
function domsDoseInsight(doms) {
  const list = doms.filter((x) => x.dose && x.dose.pattern === 'worse').sort((a, b) => b.dose.diff - a.dose.diff);
  if (!list.length) return null;
  const x = list[0]; const q = x.dose;
  const rec = {
    sets: `Si esas agujetas te limitan, prueba con 1 serie menos de ${x.name} unas semanas y mira si cambian.`,
    rir: `Si esas agujetas te limitan, deja 1–2 repeticiones en reserva en ${x.name} unas semanas y mira si cambian.`,
    load: `Si esas agujetas te limitan, baja un poco la carga total de ${x.name} (una serie o unas repeticiones menos) y mira si cambian.`,
  }[q.factor];
  return insight({
    id: 'doms-dose', area: 'strength', level: 'info', priority: 34,
    title: `Más agujetas de ${muscleName(x.muscleId)} con más ${q.factor === 'rir' ? 'esfuerzo' : q.label} en ${x.name}`,
    parts: {
      observation: `En tus registros, las sesiones de ${x.name} con ${q.hiTxt} aparecen asociadas a más agujetas de ${muscleName(x.muscleId)} en las 24–72 h siguientes (${fmtNum(q.m1, 1)}/10 frente a ${fmtNum(q.m2, 1)}/10 con ${q.loTxt}; ${q.n1} y ${q.n2} sesiones).`,
      interpretation: 'Es una asociación en tus datos, no una causa demostrada: unas agujetas moderadas no son malas por sí mismas.',
      recommendation: rec,
    },
    rule: `Dentro de las sesiones con el ejercicio (últimas ${ASSOC_WEEKS} semanas, con check-in con zonas 1–3 días después): series por encima o por debajo de tu mediana, RIR medio de 0–1 frente a 2 o más, y carga (Σ peso × repeticiones) por encima o por debajo de tu mediana, frente a las agujetas de su músculo principal. Solo con al menos ${MIN_OBS} sesiones en cada grupo en ${MIN_SPAN_DAYS / 7} semanas o más y una diferencia de ${fmtNum(DOMS_POINTS, 1)} puntos o más con un efecto moderado (d ≥ ${fmtNum(EFFECT_D, 1)}); se enseña el factor con más diferencia.`,
    data: [
      { label: cap(q.hiTxt), value: `${fmtNum(q.m1, 1)}/10 · ${q.n1} sesiones` },
      { label: cap(q.loTxt), value: `${fmtNum(q.m2, 1)}/10 · ${q.n2} sesiones` },
      { label: 'Efecto (d de Cohen)', value: dTxt(q.d) },
      curveTxt(x) ? { label: `Por día tras ${x.name}`, value: curveTxt(x) } : null,
    ],
    confidence: q.confidence,
  });
}
const LEVEL_RANK = { insufficient: 0, low: 1, medium: 2, high: 3 };

// ===========================================================================
// Interferencia y recuperación con datos personales
// ===========================================================================

/**
 * Asociaciones personales (fuerza ↔ resistencia, agujetas, estrés):
 *   legs-after-endurance: rendimiento de pierna tras resistencia exigente el día antes vs. el resto.
 *   run-after-legs: ritmo de los rodajes suaves al día siguiente de pierna vs. el resto.
 *   doms-after-leg-volume: agujetas de pierna (24–72 h) tras sesiones con más series de pierna (≥ la mediana) vs. menos.
 *   perf-with-doms: rendimiento de la sesión con agujetas fuertes antes (general «altas» o una zona ≥ 6) vs. sin ellas.
 *   perf-with-stress: rendimiento de la sesión con estrés alto en el check-in vs. normal o bajo.
 *   skips-with-endurance: % de días de fuerza planificados saltados o a medias en las semanas con más carga de
 *                         resistencia (≥ la mediana) vs. el resto (semanas completas con algún día de fuerza planificado).
 */
export function personalAssociations(d, today) {
  const exMap = toMap(d.exercises);
  const from = addDays(today, -(ASSOC_WEEKS * 7 - 1));
  const out = [];
  const spanOf = (dates) => (dates.length ? diffDays(dates.reduce((a, b) => (a < b ? a : b)), dates.reduce((a, b) => (a > b ? a : b))) : 0);
  const push = (o) => { if (o) out.push(o); };
  const ses = toArr(d.sessions).filter((s) => s && s.status === 'done' && isDateStr(s.date) && s.date >= addDays(from, -1) && s.date <= today);
  const endu = ses.filter((s) => ENDURANCE_KINDS.includes(s.kind));
  const demandingDays = new Set(endu.filter((s) => demandingEndurance(s)).map((s) => s.date));
  const legDays = new Set(ses.filter((s) => s.kind === 'strength' && legSetsOf(s, exMap) >= 3).map((s) => s.date));

  // 1. Pierna tras resistencia exigente el día antes
  const legPerf = sessionPerformance(d, { today, from, filter: (ex) => (ex.primary || []).some((m) => LEG_MUSCLES.includes(m)) });
  {
    const a = []; const b = []; const dates = [];
    for (const r of legPerf.values()) {
      (demandingDays.has(addDays(r.date, -1)) ? a : b).push(r.ratio);
      dates.push(r.date);
    }
    push(assoc('legs-after-endurance', a, b, dates, { relative: true, threshold: PERF_PCT, lowerIsWorse: true }));
  }
  // 2. Rodajes suaves al día siguiente de pierna (ritmo; más lento = peor)
  {
    const byId = new Map(ses.map((s) => [s.id, s]));
    const easy = [];
    for (const a of runPaceSeries(d)) {
      if (a.x > today || a.x < from || !(a.km >= 3)) continue;
      const s = byId.get(a.sessionId);
      if (!s || classifyIntensity(s) !== 'easy') continue;
      easy.push({ date: a.x, pace: pace(a.sec, a.km) });
    }
    if (easy.length) {
      const med = [...easy].map((x) => x.pace).sort((x, y) => x - y)[Math.floor(easy.length / 2)];
      const a = []; const b = [];
      for (const x of easy) (legDays.has(addDays(x.date, -1)) ? a : b).push(med / x.pace); // > 1 = más rápido que tu mediana
      push(assoc('run-after-legs', a, b, easy.map((x) => x.date), { relative: true, threshold: PACE_PCT, lowerIsWorse: true }));
    }
  }
  // 3. Volumen de pierna → agujetas de pierna (24–72 h)
  {
    const byDate = checkinsByDate(d, from, addDays(today, DOMS_TO_DAYS));
    const rows = [];
    for (const s of ses) {
      if (s.kind !== 'strength') continue;
      const sets = legSetsOf(s, exMap);
      if (sets < 3) continue;
      const doms = domsAfter(byDate, s.date);
      if (!doms) continue;
      rows.push({ date: s.date, sets, level: Math.max(0, ...LEG_MUSCLES.map((m) => doms.get(m) ?? 0)) });
    }
    if (rows.length >= 2 * MIN_OBS) {
      const sorted = rows.map((x) => x.sets).sort((x, y) => x - y);
      const medSets = sorted[Math.floor(sorted.length / 2)];
      const hi = rows.filter((x) => x.sets >= medSets); const lo = rows.filter((x) => x.sets < medSets);
      const o = assoc('doms-after-leg-volume', hi.map((x) => x.level), lo.map((x) => x.level), rows.map((x) => x.date), { relative: false, threshold: DOMS_POINTS, lowerIsWorse: false });
      if (o) { o.medSets = medSets; push(o); }
    }
  }
  // 4–5. Agujetas fuertes o estrés alto antes de la sesión → rendimiento de la sesión
  {
    const allPerf = sessionPerformance(d, { today, from });
    const cks = checkinsBetween(d.checkins, from, today);
    const pre = new Map();
    for (const c of cks) {
      if (c.sessionId && (!pre.has(c.sessionId) || c.timing === 'pre')) pre.set(c.sessionId, c);
    }
    const byDayPre = new Map(cks.filter((c) => c.timing === 'pre').map((c) => [c.date, c]));
    const domsHigh = (c) => c && (c.soreness === 3 || areasOf(c).some((a) => a.kind === 'muscle' && a.level >= 6));
    const domsKnown = (c) => c && (c.soreness != null || areasOf(c).length > 0);
    const a1 = []; const b1 = []; const a2 = []; const b2 = []; const d1 = []; const d2 = [];
    for (const r of allPerf.values()) {
      const c = pre.get(r.sessionId) || byDayPre.get(r.date);
      if (domsKnown(c)) { (domsHigh(c) ? a1 : b1).push(r.ratio); d1.push(r.date); }
      if (c && c.stress != null) { (c.stress === 3 ? a2 : b2).push(r.ratio); d2.push(r.date); }
    }
    push(assoc('perf-with-doms', a1, b1, d1, { relative: true, threshold: PERF_PCT, lowerIsWorse: true }));
    push(assoc('perf-with-stress', a2, b2, d2, { relative: true, threshold: PERF_PCT, lowerIsWorse: true }));
  }
  // 6. Semanas con más resistencia → días de fuerza saltados o a medias (la misma adherencia que el Calendario)
  {
    const cw = weekStart(today);
    const weeks = weeklySeries(d, addDays(cw, -7 * ASSOC_WEEKS), addDays(cw, -1));
    const rows = [];
    for (const r of weeks) {
      let planned = 0; let missed = 0;
      for (const day of weekPlanOf(d, r.week)) {
        if (day.plan?.kind !== 'template' || !['done', 'partial', 'substituted', 'skipped'].includes(day.status)) continue;
        planned++;
        if (day.status === 'skipped' || day.status === 'partial') missed++;
      }
      if (!planned) continue;
      rows.push({ week: r.week, load: ENDURANCE_KINDS.reduce((t, k) => t + (r.load[k] || 0), 0), missedPct: (missed / planned) * 100 });
    }
    const loads = rows.filter((x) => x.load > 0).map((x) => x.load).sort((x, y) => x - y);
    if (loads.length) {
      const med = loads[Math.floor(loads.length / 2)];
      const high = (x) => x.load > 0 && x.load >= med;
      const o = assoc('skips-with-endurance', rows.filter(high).map((x) => x.missedPct), rows.filter((x) => !high(x)).map((x) => x.missedPct),
        rows.map((x) => x.week), { relative: false, threshold: SKIP_POINTS, lowerIsWorse: false });
      if (o) { o.medLoad = med; push(o); }
    }
  }
  return out;

  function assoc(id, a, b, dates, { relative, threshold, lowerIsWorse }) {
    const span = spanOf(dates);
    const base = { id, n1: a.length, n2: b.length, span };
    if (a.length < MIN_OBS || b.length < MIN_OBS || span < MIN_SPAN_DAYS) return { ...base, pattern: 'insufficient', confidence: confInsufficient(`hacen falta ${MIN_OBS} veces con y ${MIN_OBS} sin, en ${MIN_SPAN_DAYS / 7} semanas o más (hay ${a.length} y ${b.length})`) };
    const cmp = compareGroups(a, b, { relative });
    const signed = lowerIsWorse ? -cmp.diff : cmp.diff; // > 0 = peor con el factor
    const dW = lowerIsWorse ? -cmp.d : cmp.d;
    const pattern = signed >= threshold - EPS && dW >= EFFECT_D - EPS ? 'worse' : signed <= -(threshold - EPS) && dW <= -(EFFECT_D - EPS) ? 'better' : 'none';
    return { ...base, m1: cmp.m1, m2: cmp.m2, diff: cmp.diff, d: cmp.d, pattern, confidence: associationConfidence(a.length, b.length, span, cmp.d) };
  }
}

const ASSOC_TEXT = {
  'legs-after-endurance': {
    area: 'endurance', unit: 'ratio', with: 'tras resistencia exigente el día antes', without: 'el resto', metric: 'rendimiento de pierna',
    worse: (x) => `En tus registros, las sesiones de pierna con resistencia exigente el día antes aparecen asociadas a un rendimiento un ${pctTxt(Math.abs(x.diff), 1)} menor (${x.n1} sesiones frente a ${x.n2}).`,
    none: (x) => `En tus registros, la resistencia exigente el día antes no coincide con peor rendimiento de pierna (${x.n1} sesiones con ella y ${x.n2} sin ella): de momento, tu combinación funciona.`,
    better: (x) => `En tus registros, tus sesiones de pierna tras resistencia exigente el día antes no rinden menos (incluso un ${pctTxt(Math.abs(x.diff), 1)} más; ${x.n1} frente a ${x.n2}).`,
    rec: 'Si quieres sacar más de la pierna, prueba a dejar 24 h o más entre la sesión exigente y la pierna y mira si cambia.',
  },
  'run-after-legs': {
    area: 'endurance', unit: 'ratio', with: 'al día siguiente de pierna', without: 'el resto', metric: 'ritmo de los rodajes suaves',
    worse: (x) => `En tus registros, los rodajes suaves del día siguiente a la pierna van un ${pctTxt(Math.abs(x.diff), 1)} más lentos que tu ritmo habitual (${x.n1} rodajes frente a ${x.n2}).`,
    none: (x) => `En tus registros, correr al día siguiente de la pierna no coincide con rodajes más lentos (${x.n1} con pierna el día antes y ${x.n2} sin ella).`,
    better: (x) => `En tus registros, tus rodajes del día siguiente a la pierna no van más lentos (${x.n1} frente a ${x.n2}).`,
    rec: 'Si esos rodajes te cuestan, haz el día después de la pierna el más suave de la semana.',
  },
  'doms-after-leg-volume': {
    area: 'recovery', unit: 'doms', with: 'con más series de pierna', without: 'con menos', metric: 'agujetas de pierna (24–72 h)',
    worse: (x) => `En tus registros, las sesiones con ${x.medSets} series de pierna o más aparecen asociadas a más agujetas en las piernas después (${fmtNum(x.m1, 1)}/10 frente a ${fmtNum(x.m2, 1)}/10; ${x.n1} y ${x.n2} sesiones).`,
    none: (x) => `En tus registros, hacer más series de pierna (${x.medSets} o más) no coincide con más agujetas después (${x.n1} y ${x.n2} sesiones): tu volumen de pierna parece tolerable.`,
    better: (x) => `En tus registros, las sesiones con más series de pierna no dejan más agujetas (${x.n1} y ${x.n2} sesiones).`,
    rec: 'Si esas agujetas te limitan, reparte las series de pierna en dos días o quita 1–2 series y mira si cambian.',
  },
  'perf-with-doms': {
    area: 'recovery', unit: 'ratio', with: 'con agujetas fuertes antes', without: 'sin ellas', metric: 'rendimiento de la sesión',
    worse: (x) => `En tus registros, empezar una sesión con agujetas fuertes aparece asociado a un rendimiento un ${pctTxt(Math.abs(x.diff), 1)} menor (${x.n1} sesiones frente a ${x.n2}).`,
    none: (x) => `En tus registros, las agujetas antes de entrenar no coinciden con peor rendimiento (${x.n1} sesiones con agujetas fuertes y ${x.n2} sin ellas).`,
    better: (x) => `En tus registros, entrenar con agujetas no coincide con rendir menos (${x.n1} frente a ${x.n2}).`,
    rec: 'Con agujetas fuertes, mejor una sesión de otro grupo muscular o más suave ese día.',
  },
  'perf-with-stress': {
    area: 'recovery', unit: 'ratio', with: 'con estrés alto', without: 'con estrés normal o bajo', metric: 'rendimiento de la sesión',
    worse: (x) => `En tus registros, los días de estrés alto aparecen asociados a un rendimiento un ${pctTxt(Math.abs(x.diff), 1)} menor (${x.n1} sesiones frente a ${x.n2}).`,
    none: (x) => `En tus registros, el estrés alto no coincide con peor rendimiento (${x.n1} sesiones con estrés alto y ${x.n2} sin él).`,
    better: (x) => `En tus registros, los días de estrés alto no rindes menos (${x.n1} frente a ${x.n2}).`,
    rec: 'Los días de estrés alto, no fuerces récords: mantén el plan con algo menos de peso si lo notas.',
  },
  'skips-with-endurance': {
    area: 'strength', unit: 'pct', with: 'semanas con más resistencia', without: 'el resto de semanas', metric: '% de días de fuerza planificados saltados o a medias',
    worse: (x) => `En tus registros, las semanas con más carga de resistencia coinciden con más sesiones de fuerza saltadas o a medias: ${pctTxt(x.m1)} de las planificadas, frente a ${pctTxt(x.m2)} el resto (${x.n1} y ${x.n2} semanas).`,
    none: (x) => `En tus registros, las semanas con más resistencia no coinciden con saltarte más sesiones de fuerza (${x.n1} semanas con más resistencia y ${x.n2} con menos).`,
    better: (x) => `En tus registros, las semanas con más resistencia no te saltas más sesiones de fuerza (${pctTxt(x.m1)} frente a ${pctTxt(x.m2)}; ${x.n1} y ${x.n2} semanas).`,
    rec: 'Si en las semanas fuertes de resistencia no llegas a todo, planifica menos días de fuerza esas semanas: mejor sesiones completas que a medias.',
  },
};
const ASSOC_TITLE = {
  'legs-after-endurance': ['Pierna tras resistencia exigente', 'Tu pierna tolera la resistencia del día antes'],
  'run-after-legs': ['Rodajes tras el día de pierna', 'Tus rodajes toleran la pierna del día antes'],
  'doms-after-leg-volume': ['Volumen de pierna y agujetas', 'Tu volumen de pierna no deja más agujetas'],
  'perf-with-doms': ['Agujetas y rendimiento', 'Las agujetas no te restan rendimiento'],
  'perf-with-stress': ['Estrés y rendimiento', 'El estrés no te resta rendimiento'],
  'skips-with-endurance': ['Semanas de mucha resistencia, fuerza a medias', 'La resistencia no te quita sesiones de fuerza'],
};
const ASSOC_THRESHOLD = (id) => ({ 'doms-after-leg-volume': `${fmtNum(DOMS_POINTS, 1)} puntos de 10`, 'run-after-legs': `${PACE_PCT} %`, 'skips-with-endurance': `${SKIP_POINTS} puntos porcentuales` }[id] || `${PERF_PCT} %`);
const assocValue = (unit, m, n) => (unit === 'doms' ? `${fmtNum(m, 1)}/10 · ${n}` : unit === 'pct' ? `${pctTxt(m)} · ${n} semanas` : `${fmtNum(m * 100, 1)} % · ${n}`);

function associationInsights(list, { interference = [], today = null } = {}) {
  const out = [];
  for (const x of list) {
    const t = ASSOC_TEXT[x.id];
    if (!t || x.pattern === 'insufficient') continue;
    const worse = x.pattern === 'worse';
    out.push(insight({
      id: `assoc-${x.id}`, area: t.area, level: worse ? 'neutral' : 'good', priority: worse ? 40 : 24,
      title: worse ? ASSOC_TITLE[x.id][0] : ASSOC_TITLE[x.id][1],
      parts: {
        observation: (worse ? t.worse : x.pattern === 'better' ? t.better : t.none)(x),
        interpretation: worse ? 'Es una asociación en tus datos, no una causa demostrada: otras cosas (sueño, horario, tipo de sesión) pueden influir.' : null,
        recommendation: worse ? t.rec : null,
      },
      rule: `Comparación personal del ${t.metric} ${t.with} frente a ${t.without}, con tus registros de las últimas ${ASSOC_WEEKS} semanas. Solo se dice algo con al menos ${MIN_OBS} veces en cada grupo repartidas en ${MIN_SPAN_DAYS / 7} semanas o más; hay asociación si la diferencia es apreciable (${ASSOC_THRESHOLD(x.id)} o más) y con un efecto moderado (d de Cohen ≥ ${fmtNum(EFFECT_D, 1)}).${t.unit === 'ratio' ? ' Rendimiento de una sesión: su mejor 1RM estimado por ejercicio frente al máximo de las 4 semanas previas.' : ''}${x.id === 'skips-with-endurance' ? ' Días de fuerza planificados: los de rutina de tu semana tipo o del Calendario (saltados o parciales, como en el Calendario).' : ''}${x.id === 'legs-after-endurance' ? ' Con estos datos personales, sustituye a la regla general de «Resistencia intensa pegada a la pierna».' : ''}`,
      data: [
        { label: cap(t.with), value: assocValue(t.unit, x.m1, x.n1) },
        { label: cap(t.without), value: assocValue(t.unit, x.m2, x.n2) },
        { label: 'Efecto (d de Cohen)', value: dTxt(x.d) },
        ...(x.id === 'legs-after-endurance' && today ? interference.slice(-5).map((y) => ({ label: dayTxt(y.date, today), value: y.text })) : []),
      ],
      confidence: x.confidence,
    }));
  }
  return out;
}

// ===========================================================================
// Volumen con contexto
// ===========================================================================

/**
 * Revisión del volumen por músculo (media de series de las 4 semanas completas): mantener, añadir o reducir, con sus
 * motivos. NO se pide más volumen solo por estar por debajo del rango teórico:
 *   reduce — agujetas fuertes repetidas en ese músculo o señales de fatiga, con sus ejercicios estancados o bajando
 *            (aunque esté dentro del rango);
 *   keep   — sus ejercicios progresan (aunque esté por debajo del rango) o está en el rango sin problemas;
 *   add    — por debajo del mínimo, con sus ejercicios estancados, sin fatiga ni agujetas fuertes y con constancia
 *            (≥ 70 % de lo planificado): +1–2 series;
 *   none   — sin ejercicios con tendencia que lo trabajen (no hay datos para decidir).
 * Menores: nunca «añadir» (técnica primero). 65+: no añadir si hay fatiga o molestias.
 */
export function volumeReview(d, today, { strength = null, age = 'unknown' } = {}) {
  const exMap = toMap(d.exercises);
  const settings = d.settings || {};
  const targets = settings.muscleTargets && typeof settings.muscleTargets === 'object' ? settings.muscleTargets : defaultSettings().muscleTargets;
  const mus = muscleAverages(d, today);
  const fat = fatigueSignals(d, today);
  const adh = adherenceTotals(adherenceSeries(d, addDays(weekStart(today), -28), addDays(weekStart(today), -1)));
  const lowAdherence = adh.pctPast != null && adh.planned >= 4 && adh.pctPast < ADHERENCE_LOW_PCT;
  // Agujetas fuertes recientes por músculo
  const strong = new Map();
  for (const c of checkinsBetween(d.checkins, addDays(today, -(DOMS_RECENT_DAYS - 1)), today)) {
    for (const a of areasOf(c)) if (a.kind === 'muscle' && a.level >= DOMS_HIGH) strong.set(a.zone, (strong.get(a.zone) || 0) + 1);
  }
  const rows = (strength?.exercises || []).filter((x) => x.status !== 'insufficient');
  const out = [];
  if (!mus.weeks) return { weeks: 0, muscles: [], fatigue: fat, adherence: adh, lowAdherence };
  for (const [m, t] of Object.entries(targets)) {
    if (!Array.isArray(t) || !(t[1] > 0)) continue;
    const avg = mus.avg[m] || 0;
    const exs = rows.filter((x) => (exMap.get(x.exerciseId)?.primary || []).includes(m));
    if (!exs.length && avg < 1) continue;
    const progressing = exs.some((x) => x.status === 'fast' || x.status === 'good') && !exs.some((x) => x.status === 'down');
    const struggling = exs.some((x) => x.status === 'stalled' || x.status === 'down');
    const sore = (strong.get(m) || 0) >= DOMS_HIGH_TIMES;
    const below = t[0] > 0 && avg < t[0] - EPS;
    const above = avg > t[1] + EPS;
    const reasons = [];
    let decision;
    if (!exs.length) { decision = 'none'; reasons.push('sin ejercicios con tendencia que lo trabajen'); }
    else if ((sore || fat.any) && (struggling || sore)) {
      decision = 'reduce';
      if (sore) reasons.push(`agujetas fuertes (≥ ${DOMS_HIGH}/10) ${strong.get(m)} veces en ${DOMS_RECENT_DAYS} días`);
      if (fat.any) reasons.push('señales de fatiga (RPE alto o check-ins bajos)');
      if (struggling) reasons.push('sus ejercicios no progresan');
    } else if (progressing) {
      decision = 'keep';
      reasons.push(below ? 'progresas con este volumen aunque esté por debajo del rango' : 'progresas con este volumen');
    } else if (below && struggling && !lowAdherence && age !== 'minor' && !(age === 'senior' && (fat.any || sore))) {
      decision = 'add';
      reasons.push('por debajo del mínimo y sus ejercicios no progresan, sin fatiga ni agujetas fuertes');
    } else {
      decision = 'keep';
      if (below && lowAdherence) reasons.push('primero, constancia: hiciste menos de lo planificado');
      else if (below && age === 'minor') reasons.push('con menos de 18 años, primero técnica y constancia');
      else reasons.push(above ? 'por encima del rango, pero sin problemas a la vista' : 'dentro del rango y sin problemas a la vista');
    }
    out.push({ muscleId: m, name: MUSCLE_LABEL[m] || m, avgSets: round(avg, 0.1), target: t, below, above, decision, reasons, exercises: exs.map((x) => x.name), sore });
  }
  const order = { reduce: 0, add: 1, keep: 2, none: 3 };
  out.sort((a, b) => order[a.decision] - order[b.decision] || (b.below - a.below) || a.name.localeCompare(b.name, 'es'));
  return { weeks: mus.weeks, muscles: out, fatigue: fat, adherence: adh, lowAdherence };
}

function volumeInsight(vr, age) {
  if (!vr.weeks || !vr.muscles.length) return null;
  const reduce = vr.muscles.filter((x) => x.decision === 'reduce');
  const add = vr.muscles.filter((x) => x.decision === 'add');
  const keepBelow = vr.muscles.filter((x) => x.decision === 'keep' && x.below && x.exercises.length && /progresas/.test(x.reasons[0]));
  const conf = combine([
    bySpan(vr.weeks * 7, { low: 7, medium: 14, high: 28 }),
    byCount(vr.muscles.filter((x) => x.decision !== 'none').length, { low: 1, medium: 2, high: 3 }, (k) => `${k} ${k === 1 ? 'músculo' : 'músculos'} con ejercicios que valorar`, 'count'),
  ]);
  let parts; let level = 'good'; let priority = 34; let title;
  if (reduce.length) {
    level = 'warn'; priority = 58;
    title = `Reduce un poco el volumen de ${joinList(reduce.slice(0, 2).map((x) => x.name.toLowerCase()))}`;
    parts = {
      observation: `${joinList(reduce.map((x) => `${x.name} (${fmtNum(x.avgSets, 1)} series/sem: ${x.reasons.join(', ')})`))}.`,
      interpretation: 'Aunque estés dentro de tu rango, el volumen que te sienta bien es el que te deja recuperarte y progresar.',
      recommendation: 'Quita 2–4 series por semana de ese músculo durante 1–2 semanas y vuelve a mirar cómo respondes.',
    };
  } else if (add.length) {
    level = 'neutral'; priority = 44;
    title = `Puedes añadir 1–2 series de ${joinList(add.slice(0, 2).map((x) => x.name.toLowerCase()))}`;
    parts = {
      observation: `${joinList(add.map((x) => `${x.name}: ${fmtNum(x.avgSets, 1)} series/sem (rango ${x.target[0]}–${x.target[1]})`))}, y sus ejercicios no progresan.`,
      interpretation: 'Sin fatiga ni agujetas fuertes y con constancia, un poco más de volumen es lo más sencillo de probar.',
      recommendation: 'Añade 1–2 series por semana (no más) y revisa en 3–4 semanas.',
    };
  } else {
    title = keepBelow.length ? 'Tu volumen actual te funciona' : 'Sin cambios de volumen a la vista';
    parts = {
      observation: keepBelow.length
        ? `${joinList(keepBelow.slice(0, 3).map((x) => `${x.name} (${fmtNum(x.avgSets, 1)} series/sem, por debajo de ${x.target[0]})`))}: aun así, sus ejercicios progresan.`
        : 'Tus ejercicios progresan o se mantienen sin señales de fatiga ni agujetas fuertes repetidas.',
      interpretation: keepBelow.length ? 'Estás progresando con el volumen actual. No hay una razón clara para aumentarlo.' : 'No hay una razón clara para cambiar el volumen.',
      recommendation: null,
    };
    if (vr.lowAdherence) parts.recommendation = `Antes que más series, constancia: en 4 semanas hiciste el ${vr.adherence.pctPast} % de lo planificado.`;
  }
  return insight({
    id: 'strength-volume', area: 'strength', level, priority, title, parts,
    rule: `Media de series efectivas por semana de cada músculo en las 4 semanas completas anteriores frente a su rango (Ajustes › Umbrales), cruzada con lo que importa: si sus ejercicios progresan (tendencia de 6–12 semanas), si hay agujetas fuertes repetidas (≥ ${DOMS_HIGH}/10 ${DOMS_HIGH_TIMES} veces en ${DOMS_RECENT_DAYS} días), señales de fatiga (RPE alto o la mitad de los check-ins bajos) o poca constancia (< ${ADHERENCE_LOW_PCT} % de lo planificado). No se pide más volumen solo por estar por debajo del rango: si progresas, se mantiene; con fatiga o agujetas fuertes y sin progreso, se reduce aunque estés dentro del rango; se añade (1–2 series) solo si estás por debajo, sin progreso y sin señales de fatiga.${age === 'minor' ? ' Con menos de 18 años no se propone añadir volumen: técnica y constancia primero.' : age === 'senior' ? ' A partir de 65 no se añade volumen si hay fatiga o molestias.' : ''}`,
    data: [
      ...vr.muscles.map((x) => ({ label: x.name, value: `${fmtNum(x.avgSets, 1)} series/sem · rango ${x.target[0]}–${x.target[1]} · ${{ keep: 'mantener', add: 'añadir', reduce: 'reducir', none: 'sin datos para decidir' }[x.decision]} (${x.reasons.join(', ')})` })),
      vr.adherence.planned ? { label: 'Constancia (4 semanas)', value: `${vr.adherence.completed} de ${vr.adherence.planned - vr.adherence.pending} sesiones planificadas${vr.adherence.pctPast != null ? ` (${vr.adherence.pctPast} %)` : ''}` } : null,
    ],
    confidence: conf,
  });
}

// ===========================================================================
// Cambios de volumen y progreso (antes / después)
// ===========================================================================

/**
 * Para cada músculo cuyo volumen cambió de forma clara entre las 6 semanas completas anteriores y las 6 de antes
 * (≥ 25 % y ≥ 2 series/sem, entrenado ≥ 4 semanas en cada bloque), el ritmo de 1RM estimado de sus ejercicios en cada
 * bloque (Theil–Sen, % por semana; ≥ MIN_OBS sesiones en cada uno). 'better' / 'worse' si el ritmo cambia ≥ 0,5 %/sem.
 * Es un antes / después: la confianza nunca pasa de media, y baja con cambios recientes del contexto o una vuelta.
 */
export function volumeChanges(d, today, { strength = null, context = null } = {}) {
  const exMap = toMap(d.exercises);
  const B = VOLUME_BLOCK_WEEKS;
  const cw = weekStart(today);
  const weeks = weeklySeries(d, addDays(cw, -7 * 2 * B), addDays(cw, -1));
  if (weeks.length < 2 * B) return [];
  const blockA = weeks.slice(-2 * B, -B); const blockB = weeks.slice(-B);
  const fromA = blockA[0].week; const fromB = blockB[0].week; const toB = addDays(cw, -1);
  const settings = d.settings || {};
  const targets = settings.muscleTargets && typeof settings.muscleTargets === 'object' ? settings.muscleTargets : defaultSettings().muscleTargets;
  const rows = (strength?.exercises || []).filter((x) => x.exerciseId);
  const ctxFactors = [
    capAt('medium', 'es un antes / después: otras cosas pudieron cambiar a la vez', 'before-after'),
    context?.training?.returning ? capAt('low', 'vuelves de un parón: al principio casi todo mejora rápido', 'return') : null,
    context?.changes?.length ? capAt('low', `también cambió tu contexto: ${context.changes[0].text}`, 'context') : null,
  ];
  const rate = (h) => {
    const f = theilSen(h.map((e) => ({ x: diffDays(fromA, e.date) / 7, y: e.e1rm })));
    const med = median(h.map((e) => e.e1rm));
    return f && med > 0 ? (f.slope / med) * 100 : null;
  };
  const out = [];
  for (const m of Object.keys(targets)) {
    const setsA = blockA.map((r) => r.muscleSets?.[m] || 0); const setsB = blockB.map((r) => r.muscleSets?.[m] || 0);
    if (setsA.filter((v) => v > 0).length < 4 || setsB.filter((v) => v > 0).length < 4) continue;
    const avgA = meanOf(setsA); const avgB = meanOf(setsB);
    const delta = avgB - avgA;
    if (Math.abs(delta) < Math.max(VOLUME_CHANGE_SETS, (avgA * VOLUME_CHANGE_PCT) / 100) - EPS) continue;
    for (const x of rows) {
      if (!(exMap.get(x.exerciseId)?.primary || []).includes(m)) continue;
      const hist = exerciseHistory(d, x.exerciseId, { labels: false }).filter((e) => e.e1rm != null && e.date >= fromA && e.date <= toB);
      const ha = hist.filter((e) => e.date < fromB); const hb = hist.filter((e) => e.date >= fromB);
      if (ha.length < MIN_OBS || hb.length < MIN_OBS) continue;
      const ra = rate(ha); const rb = rate(hb);
      if (ra == null || rb == null) continue;
      const diff = rb - ra;
      out.push({
        muscleId: m, name: MUSCLE_LABEL[m] || m, avgA: round(avgA, 0.1), avgB: round(avgB, 0.1), direction: delta > 0 ? 'up' : 'down',
        exerciseId: x.exerciseId, exName: exMap.get(x.exerciseId)?.name || x.name || x.exerciseId, rateA: ra, rateB: rb, diff, n1: ha.length, n2: hb.length,
        pattern: diff >= RATE_DIFF_PCT - EPS ? 'better' : diff <= -(RATE_DIFF_PCT - EPS) ? 'worse' : 'none',
        confidence: combine([byCount(Math.min(ha.length, hb.length), { low: MIN_OBS, medium: 8, high: 12 }, (k) => `${k} sesiones en el bloque más corto`, 'count'), ...ctxFactors]),
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

function volumeChangeInsight(list) {
  const shown = list.filter((x) => x.pattern !== 'none');
  if (!shown.length) return null;
  const x = shown[0];
  const better = x.pattern === 'better';
  const verb = x.direction === 'up' ? 'subiste' : 'bajaste';
  const B = VOLUME_BLOCK_WEEKS;
  return insight({
    id: 'volume-change', area: 'strength', level: better ? 'good' : 'neutral', priority: better ? 30 : 42,
    title: `${x.exName} progresa ${better ? 'más' : 'menos'} desde que ${verb} el volumen de ${muscleName(x.muscleId)}`,
    parts: {
      observation: `En tus registros, desde que ${verb} el volumen de ${muscleName(x.muscleId)} (de ${fmtNum(x.avgA, 1)} a ${fmtNum(x.avgB, 1)} series por semana: últimas ${B} semanas frente a las ${B} anteriores), ${x.exName} progresa ${better ? 'más' : 'menos'}: ${rateText(x.rateB)} frente a ${rateText(x.rateA)}.`,
      interpretation: 'Coincide en el tiempo, pero no demuestra que sea por el volumen: el descanso, la técnica, la comida o el contexto también cuentan.',
      recommendation: better ? 'Si te sienta bien, no hay motivo para volver al volumen anterior.' : `Si sigue así 2–3 semanas más, prueba a volver a unas ${fmtNum(x.avgA, 0)} series por semana.`,
    },
    rule: `Series efectivas por semana de cada músculo: las ${B} semanas completas anteriores frente a las ${B} de antes. Cambio claro: un ${VOLUME_CHANGE_PCT} % o más y ${VOLUME_CHANGE_SETS} series/sem o más, con el músculo entrenado al menos 4 semanas en cada bloque. Para cada ejercicio con tendencia que lo trabaja, ritmo de su 1RM estimado en cada bloque (pendiente robusta de Theil–Sen, en % por semana), con al menos ${MIN_OBS} sesiones en cada uno. Se comenta si el ritmo cambia ${fmtNum(RATE_DIFF_PCT, 1)} %/sem o más. Es una comparación antes / después: la confianza nunca pasa de media.`,
    data: shown.slice(0, 4).map((y) => ({ label: `${y.exName} · ${muscleName(y.muscleId)}`, value: `${fmtNum(y.avgA, 1)} → ${fmtNum(y.avgB, 1)} series/sem · ${rateText(y.rateA)} → ${rateText(y.rateB)} (${y.n1} y ${y.n2} sesiones)` })),
    confidence: x.confidence,
  });
}

// ===========================================================================
// Todo junto
// ===========================================================================

/** Análisis híbrido (fase D). Ver la cabecera. */
export function analyzeHybrid(data = {}, { today = null, profile = {}, context = null, strength = null, endurance = null } = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const t = isDateStr(today) ? today : isDateStr(d.today) ? d.today : todayStr();
  const age = context?.age?.group || 'unknown';
  const sl = sportLoad(d, t);
  const volume = volumeReview(d, t, { strength, age });
  const associations = personalAssociations(d, t);
  const doms = domsByExercise(d, t);
  const changes = volumeChanges(d, t, { strength, context });
  const insights = [
    sportLoadInsight(sl, t), volumeInsight(volume, age), volumeChangeInsight(changes), domsInsight(doms, t), domsDoseInsight(doms),
    ...associationInsights(associations, { interference: endurance?.interference || [], today: t }),
  ].filter(Boolean);
  return { sportLoad: sl, volume, volumeChanges: changes, associations, doms, insights };
}

/** ¿Hay datos personales suficientes para «pierna tras resistencia exigente»? (entonces sustituye a la regla general) */
export function personalInterference(hybrid) {
  return (hybrid?.associations || []).find((x) => x.id === 'legs-after-endurance' && x.pattern !== 'insufficient') || null;
}
