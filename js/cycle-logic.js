// cycle-logic.js — ciclo menstrual (ronda 5, docs/MEJORAS5.md §4). PURO: sin store ni DOM; «hoy» inyectable.
//
// Store 'cycle': un registro por día anotado
//   { id:'YYYY-MM-DD', flow:'none'|'spotting'|'light'|'medium'|'heavy', symptoms:[ids], notes, createdAt, updatedAt,
//     ended?:true (último día de esa regla, «Ha terminado»), auto?:true (día rellenado al marcar el final) }
// Una regla = días seguidos con flow ≥ light (se admite 1 día de hueco). El manchado no cuenta como regla.
//
// API:
//   periodsFromDays(days) → [{ start, end, lengthDays, heavyDays, ended }]
//   cycleInfo(days, profile, today) → CycleInfo (ver JSDoc)
//   phaseForDate(info, date) → { date, day, phase, phaseLabel, estimated, logged, predicted, ovulationDay, … } | null
//   phaseStats(info, data) → medias por fase de SU historial (≥ 2 ciclos completos)
//   calendarMarks(info, from, to) → Map(fecha → { period, predicted, ovulation, symptoms, flow })
//   phaseTips(info) / PHASE_TIPS / EVIDENCE_NOTE / SOURCES / FLOWS / SYMPTOMS / PHASES
// Las estimaciones son orientativas: ni diagnóstico ni método anticonceptivo.
import { addDays, diffDays, isDateStr, fmtDate, fmtNum, MONTH_SHORT, parseDate } from './util.js';
import { cycleEnabled, isHormonal } from './profile.js';
import { setMetrics, isWorkSet, makeBodyweightFn } from './calc.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
export const FLOWS = [
  { id: 'none', label: 'Nada' },
  { id: 'spotting', label: 'Manchado' },
  { id: 'light', label: 'Leve' },
  { id: 'medium', label: 'Moderado' },
  { id: 'heavy', label: 'Abundante' },
];
export const FLOW_RANK = { none: 0, spotting: 1, light: 2, medium: 3, heavy: 4 };
export const FLOW_LABEL = Object.fromEntries(FLOWS.map((f) => [f.id, f.label]));

export const SYMPTOMS = [
  { id: 'cramps', label: 'Dolor/calambres' },
  { id: 'bloating', label: 'Hinchazón' },
  { id: 'headache', label: 'Dolor de cabeza' },
  { id: 'fatigue', label: 'Cansancio' },
  { id: 'low_mood', label: 'Ánimo bajo' },
  { id: 'breast', label: 'Pecho sensible' },
  { id: 'acne', label: 'Acné' },
  { id: 'cravings', label: 'Antojos' },
  { id: 'bad_sleep', label: 'Dormir mal' },
  { id: 'back_pain', label: 'Dolor lumbar' },
];
export const SYMPTOM_LABEL = Object.fromEntries(SYMPTOMS.map((s) => [s.id, s.label]));

/** Fases estimadas de un ciclo natural, en orden. `label` = texto de «Día 12 · fase folicular». */
export const PHASES = [
  { id: 'menstrual', name: 'Regla', label: 'regla' },
  { id: 'follicular', name: 'Folicular', label: 'fase folicular' },
  { id: 'ovulation', name: 'Ovulación aprox.', label: 'ovulación aprox.' },
  { id: 'luteal', name: 'Lútea', label: 'fase lútea' },
  { id: 'premenstrual', name: 'Premenstrual', label: 'fase premenstrual' },
];
export const PHASE_IDS = PHASES.map((p) => p.id);
const PHASE_BY_ID = Object.fromEntries(PHASES.map((p) => [p.id, p]));
export const phaseName = (id) => PHASE_BY_ID[id]?.name ?? '—';
export const phaseLabel = (id) => PHASE_BY_ID[id]?.label ?? null;

/** Umbrales (FIGO 2018 y reglas propias, prudentes). */
export const LIMITS = {
  normalMin: 24, normalMax: 38, // duración normal del ciclo (FIGO)
  variationMax: 9, // variación entre el más corto y el más largo (7–9 según la edad; se avisa por encima de 9)
  periodMaxDays: 8, // regla prolongada > 8 días (FIGO)
  lateAlertDays: 7, // retraso que merece aviso
  amenorrheaDays: 90, // sin regla ≥ 90 días
  minCyclesOwn: 2, // ciclos completos para usar SUS medias (antes, lo que indicó en el perfil)
  minCyclesRegular: 3, // ciclos para juzgar la regularidad
  statsCycles: 2, // ciclos completos para «Cómo te afecta»
  avgWindow: 6, // últimos ciclos para las medias
  validCycleMin: 15, validCycleMax: 90, // fuera de esto no entra en la media (sangrado intermedio o meses sin datos)
  ovulationSpread: 2, // ovulación ≈ ciclo − 14 ± 2
  premenstrualDays: 5,
};

/** Fuentes (docs/MEJORAS5.md §5; Armour 2019 es una revisión Cochrane, equivalente en solidez). */
export const SOURCES = {
  figo: { short: 'Munro et al. (FIGO), 2018', detail: 'Int J Gynaecol Obstet · sistema FIGO: ciclo normal de 24–38 días, variación de hasta 7–9 días entre ciclos y regla de hasta 8 días' },
  mcnulty: { short: 'McNulty et al., 2020', detail: 'Sports Med · meta-análisis: la fase del ciclo afecta de forma trivial y variable al rendimiento; enfoque individual' },
  colenso: { short: 'Colenso-Semple et al., 2023', detail: 'Front Sports Act Living · revisión: sin efecto claro de la fase en la fuerza ni en las adaptaciones al entrenamiento' },
  elliott: { short: 'Elliott-Sale et al., 2020', detail: 'Sports Med · meta-análisis: los anticonceptivos orales tienen un efecto trivial en el rendimiento' },
  white: { short: 'White et al., 2011', detail: 'Obstet Gynecol Int · la retención de líquidos varía a lo largo del ciclo y es máxima el primer día de regla' },
  pedlar: { short: 'Pedlar et al., 2018', detail: 'Eur J Sport Sci · hierro en la mujer deportista: sangrado abundante, ferritina baja y cansancio' },
  bruinvels: { short: 'Bruinvels et al., 2016', detail: 'Br J Sports Med · el sangrado menstrual abundante es frecuente en mujeres que hacen ejercicio' },
  mountjoy: { short: 'Mountjoy et al., 2023', detail: 'Br J Sports Med · consenso del COI sobre REDs: la alteración menstrual es una señal clave de energía baja' },
  armour: { short: 'Armour et al., 2019', detail: 'Cochrane Database Syst Rev · el ejercicio puede reducir la intensidad del dolor menstrual' },
  knowles: { short: 'Knowles et al., 2018', detail: 'J Sci Med Sport · dormir poco reduce la fuerza en ejercicios compuestos' },
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const rank = (flow) => FLOW_RANK[flow] ?? 0;
export const isBleeding = (d) => !!d && rank(d.flow) >= FLOW_RANK.light;
const clampNum = (v, lo, hi, fb) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
const avg = (arr) => (arr.length ? arr.reduce((t, x) => t + x, 0) / arr.length : null);
function sd(arr) {
  if (arr.length < 2) return null;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((t, x) => t + (x - m) ** 2, 0) / (arr.length - 1));
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const n1 = (v) => fmtNum(v, 1);

/** Lista de días válida (id = fecha), sin duplicados, ordenada. Acepta array, Map o iterable. */
export function normalizeDays(days) {
  let list = [];
  if (Array.isArray(days)) list = days;
  else if (days instanceof Map) list = [...days.values()];
  else if (days && typeof days[Symbol.iterator] === 'function') list = [...days];
  const byId = new Map();
  for (const d of list) if (d && isDateStr(d.id)) byId.set(d.id, d);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** «3–5 oct», «30 sep – 2 oct» o «3 oct». */
export function fmtRange(from, to) {
  if (!from) return '—';
  if (!to || to === from) return fmtDate(from, 'day');
  const a = parseDate(from);
  const b = parseDate(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`;
  return `${fmtDate(from, 'day')} – ${fmtDate(to, 'day')}`;
}

// ---------------------------------------------------------------------------
// Reglas y ciclos
// ---------------------------------------------------------------------------
/**
 * Reglas a partir de los días anotados: días con flow ≥ light, seguidos o con 1 día de hueco.
 * @returns {{ start, end, lengthDays, heavyDays, ended }[]} (ended: su último día lleva `ended`)
 */
export function periodsFromDays(days) {
  const list = normalizeDays(days).filter(isBleeding);
  const out = [];
  let cur = null;
  for (const d of list) {
    if (cur && diffDays(cur.end, d.id) <= 2) {
      cur.end = d.id;
      cur.heavyDays += d.flow === 'heavy' ? 1 : 0;
      cur.ended = !!d.ended;
    } else {
      cur = { start: d.id, end: d.id, lengthDays: 1, heavyDays: d.flow === 'heavy' ? 1 : 0, ended: !!d.ended };
      out.push(cur);
    }
  }
  for (const p of out) p.lengthDays = diffDays(p.start, p.end) + 1;
  return out;
}

/** Ciclos completos (de un inicio de regla al siguiente). */
export function cyclesFromPeriods(periods) {
  const out = [];
  for (let i = 0; i + 1 < periods.length; i++) {
    out.push({ start: periods[i].start, end: addDays(periods[i + 1].start, -1), lengthDays: diffDays(periods[i].start, periods[i + 1].start), periodDays: periods[i].lengthDays });
  }
  return out;
}

const HORMONAL_NOTE = {
  combined: 'Con la píldora combinada (o el anillo o el parche) no hay ovulación ni fases naturales: el sangrado de la semana de descanso es un sangrado por deprivación, no una regla natural. Aquí registras sangrados y síntomas para ver tus patrones.',
  other: 'Con un anticonceptivo hormonal no hay fases naturales que estimar, y el sangrado puede ser irregular o desaparecer (es habitual con DIU hormonal, implante o minipíldora). Aquí registras sangrados y síntomas para ver tus patrones y comentarlos con tu médico si algo te preocupa.',
};

/**
 * Estado del ciclo con SUS datos.
 * @param {Array|Map} days  registros de la store 'cycle'
 * @param {object} profile  profile.getProfile(settings)
 * @param {string} today    'YYYY-MM-DD'
 * @returns {{ enabled, hormonal, contraception, today, days, periods, cycles:{start,end,lengthDays,periodDays}[],
 *   avgCycle, sdCycle, variation, avgPeriod, regular, basis:'own'|'guess', cycleLength, periodLength,
 *   ongoing:{ start, day, lastLogged }|null,
 *   current:{ day, phase, phaseLabel, estimated, logged, cycleStart }|null,
 *   next:{ start, from, to, inDays }|null, lateDays, daysSinceStart, note:string|null, alerts: Insight[] }}
 */
export function cycleInfo(days, profile, today) {
  const p = profile || {};
  const all = normalizeDays(days).filter((d) => d.id <= today);
  const enabled = cycleEnabled(p);
  const hormonal = isHormonal(p);
  const periods = periodsFromDays(all);
  const cycles = cyclesFromPeriods(periods);
  const recent = cycles.slice(-LIMITS.avgWindow).map((c) => c.lengthDays).filter((n) => n >= LIMITS.validCycleMin && n <= LIMITS.validCycleMax);
  const avgCycle = round1(avg(recent));
  const sdCycle = round1(sd(recent));
  const yearCycles = cycles.slice(-12).map((c) => c.lengthDays).filter((n) => n >= LIMITS.validCycleMin && n <= LIMITS.validCycleMax);
  const variation = yearCycles.length >= 2 ? Math.max(...yearCycles) - Math.min(...yearCycles) : null;
  const last = periods.at(-1) || null;

  // Duración de la regla: las reglas terminadas (la última, si sigue, no cuenta).
  const guessCycle = clampNum(p.cycleLengthGuess, LIMITS.validCycleMin, LIMITS.validCycleMax, 28);
  const guessPeriod = clampNum(p.periodLengthGuess, 1, 12, 5);
  const ongoingFor = (per, periodLen) => !!per && !per.ended && today >= per.start
    && (diffDays(per.end, today) <= 2 || diffDays(per.start, today) <= Math.round(periodLen));
  const lastOpenGuess = ongoingFor(last, guessPeriod);
  const finished = periods.filter((x, i) => !(i === periods.length - 1 && lastOpenGuess)).slice(-LIMITS.avgWindow);
  const avgPeriod = round1(avg(finished.map((x) => x.lengthDays)));
  const own = recent.length >= LIMITS.minCyclesOwn;
  const cycleLength = own ? avgCycle : guessCycle;
  const periodLength = own && avgPeriod != null ? avgPeriod : guessPeriod;
  const Lr = Math.round(cycleLength);

  const isOngoing = ongoingFor(last, periodLength);
  const ongoing = isOngoing ? { start: last.start, day: diffDays(last.start, today) + 1, lastLogged: last.end } : null;
  const regular = yearCycles.length >= LIMITS.minCyclesRegular ? variation <= LIMITS.variationMax : null;

  const info = {
    enabled, hormonal, contraception: p.contraception ?? null, today, days: all, periods, cycles,
    avgCycle, sdCycle, variation, avgPeriod, regular,
    basis: own ? 'own' : 'guess', cycleLength, periodLength, cycleLengthGuess: guessCycle, periodLengthGuess: guessPeriod,
    ongoing, current: null, next: null, lateDays: 0,
    daysSinceStart: last ? diffDays(last.start, today) : null,
    note: hormonal ? (['combined_pill', 'ring_patch'].includes(p.contraception) ? HORMONAL_NOTE.combined : HORMONAL_NOTE.other) : null,
    alerts: [],
  };

  if (last && !hormonal) {
    // Rango de la próxima regla según SU variabilidad (± 1 desviación típica, 1–7 días); con estimación, ± 2.
    const spread = own && sdCycle != null ? Math.min(7, Math.max(1, Math.round(sdCycle))) : 2;
    const start = addDays(last.start, Lr);
    info.next = { start, from: addDays(start, -spread), to: addDays(start, spread), inDays: diffDays(today, start), spread };
    info.lateDays = isOngoing ? 0 : Math.max(0, diffDays(start, today));
  }
  if (last) {
    const ph = phaseForDate(info, today);
    info.current = ph ? { day: ph.day, phase: ph.phase, phaseLabel: ph.phaseLabel, estimated: ph.estimated, logged: ph.logged, cycleStart: ph.cycleStart } : null;
  }
  info.alerts = cycleAlerts(info);
  return info;
}

/**
 * Fase de un día del ciclo (1 = primer día de regla) con duración `len` y `menstrualDays` días de regla.
 * Ovulación ≈ len − 14 ± 2; premenstrual = los 5 últimos días.
 */
export function phaseOfDay(day, len, menstrualDays) {
  if (day <= menstrualDays) return 'menstrual';
  if (day > len - LIMITS.premenstrualDays) return 'premenstrual';
  const ov = len - 14;
  if (Math.abs(day - ov) <= LIMITS.ovulationSpread) return 'ovulation';
  return day < ov ? 'follicular' : 'luteal';
}

function result(date, day, phase, extra = {}) {
  return {
    date, day, phase, phaseLabel: phase ? phaseLabel(phase) : null,
    estimated: extra.logged ? false : phase != null, logged: false, predicted: false, ovulationDay: false,
    ...extra,
  };
}

/**
 * Fase (estimada) de cualquier fecha a partir de las reglas anotadas.
 * Ciclos pasados: con su duración real. Ciclo en curso: con la media (o la estimación del perfil).
 * Fechas futuras: proyección hasta 3 ciclos (reglas previstas); si la regla se retrasa, no se proyecta.
 * Anticonceptivo hormonal: sin fases (phase null), solo si es día de sangrado.
 * @returns {{ date, day, phase, phaseLabel, estimated, logged, predicted, ovulationDay, cycleStart, cycleLength, late? } | null}
 */
export function phaseForDate(info, date) {
  if (!info || !isDateStr(date) || !info.periods?.length) return null;
  const P = info.periods;
  let i = -1;
  for (let k = 0; k < P.length; k++) { if (P[k].start <= date) i = k; else break; }
  if (i < 0) return null;
  const per = P[i];
  const day = diffDays(per.start, date) + 1;
  const logged = date <= per.end;
  const base = { cycleStart: per.start };
  if (info.hormonal) return result(date, day, null, { ...base, logged, estimated: false, cycleLength: null });
  if (logged) return result(date, day, 'menstrual', { ...base, logged: true, cycleLength: P[i + 1] ? diffDays(per.start, P[i + 1].start) : Math.round(info.cycleLength) });

  const nextLogged = P[i + 1];
  if (nextLogged) { // ciclo completo: duración real
    const len = diffDays(per.start, nextLogged.start);
    const phase = phaseOfDay(day, len, per.lengthDays);
    return result(date, day, phase, { ...base, cycleLength: len, ovulationDay: day === len - 14 });
  }

  // Ciclo en curso (o futuro)
  const L = Math.round(info.cycleLength);
  const plen = Math.round(info.periodLength);
  const isCurrentOngoing = info.ongoing && info.ongoing.start === per.start;
  const menstrualDays = isCurrentOngoing ? Math.max(per.lengthDays, plen) : per.lengthDays;
  const today = info.today;
  if (day <= L) {
    const phase = phaseOfDay(day, L, menstrualDays);
    return result(date, day, phase, { ...base, cycleLength: L, ovulationDay: day === L - 14, predicted: false });
  }
  // Pasado el día previsto de la próxima regla (late = días desde el inicio previsto; 0 = el día previsto)
  const late = day - L - 1;
  if (info.lateDays > 0) { // la regla se retrasa: no se proyecta nada
    if (date > today) return result(date, day, null, { ...base, cycleLength: L, estimated: false, late });
    return result(date, day, late <= LIMITS.lateAlertDays ? 'premenstrual' : null, { ...base, cycleLength: L, late });
  }
  // Futuro (u hoy, si es el día previsto): ciclos previstos (hasta 3)
  const k = Math.floor((day - 1) / L);
  if (k > 3) return null;
  const dIn = day - k * L;
  const phase = phaseOfDay(dIn, L, plen);
  return result(date, dIn, phase, { cycleStart: addDays(per.start, k * L), cycleLength: L, predicted: phase === 'menstrual', ovulationDay: dIn === L - 14, projected: true });
}

/**
 * Marcas de calendario entre `from` y `to` (incluidos): regla anotada, regla prevista (futura), ovulación
 * aproximada (ventana ± 2) y días con síntomas. → Map(fecha → { period, predicted, ovulation, ovulationDay, symptoms, flow, phase })
 */
export function calendarMarks(info, from, to) {
  const out = new Map();
  if (!info || !isDateStr(from) || !isDateStr(to)) return out;
  const byId = new Map((info.days || []).map((d) => [d.id, d]));
  for (let d = from, n = 0; d <= to && n < 400; d = addDays(d, 1), n++) {
    const rec = byId.get(d);
    const ph = info.hormonal ? null : phaseForDate(info, d);
    // Regla anotada: el día sangra o cae dentro de una regla anotada (hueco de 1 día).
    const period = isBleeding(rec) || (!!ph?.logged && !info.hormonal);
    // Prevista: reglas futuras proyectadas y, en la regla en curso, los días que faltan (desde hoy).
    const predicted = !period && !!ph && (ph.predicted || (ph.phase === 'menstrual' && d >= info.today));
    const m = {
      period, predicted,
      ovulation: ph?.phase === 'ovulation',
      ovulationDay: !!ph?.ovulationDay,
      symptoms: !!rec?.symptoms?.length,
      flow: rec?.flow ?? null,
      phase: ph?.phase ?? null,
    };
    if (m.period || m.predicted || m.ovulation || m.symptoms || rec) out.set(d, m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Alertas (Insight[] de docs/MEJORAS5.md §3)
// ---------------------------------------------------------------------------
function insight(o) {
  return { area: 'cycle', level: 'info', priority: 50, ...o };
}

/** Alertas prudentes con evidencia: FIGO, retraso, amenorrea y reglas abundantes. */
export function cycleAlerts(info) {
  const out = [];
  if (!info || !info.enabled || !info.periods.length) return out;
  const { cycles, periods, today } = info;
  const last = periods.at(-1);
  const recentCycles = cycles.slice(-LIMITS.avgWindow);

  if (!info.hormonal) {
    const since = diffDays(last.start, today);
    if (since >= LIMITS.amenorrheaDays && !info.ongoing) {
      out.push(insight({
        id: 'cycle-amenorrhea', level: 'warn', priority: 95,
        title: `${since} días sin regla`,
        text: `Tu última regla anotada empezó el ${fmtDate(last.start, 'full')}. Tres meses o más sin regla (amenorrea) merece una consulta médica. En mujeres que entrenan, una causa frecuente es la energía baja: comer poco para lo que se gasta (REDs). Si sí te ha venido y no la apuntaste, regístrala para que las estimaciones sean correctas.`,
        why: {
          rule: `Aviso si pasan ${LIMITS.amenorrheaDays} días o más desde el inicio de la última regla (sin anticonceptivo hormonal). La falta de regla es una señal clave de energía baja según el consenso del COI.`,
          data: [{ label: 'Última regla', value: fmtDate(last.start, 'full') }, { label: 'Días desde entonces', value: String(since) }],
        },
        sources: [SOURCES.figo, SOURCES.mountjoy],
        action: { label: 'Registrar regla', href: '#/cycle' },
      }));
    } else if (info.lateDays > LIMITS.lateAlertDays) {
      out.push(insight({
        id: 'cycle-late', level: 'warn', priority: 80,
        title: `Regla con ${info.lateDays} días de retraso`,
        text: `Según tus ciclos, la esperabas hacia el ${fmtDate(info.next.start, 'day')}. Los retrasos puntuales son frecuentes (estrés, viajes, enfermedad, cambios de entrenamiento o de peso). Si puede haber embarazo, haz un test. Si pasan semanas sin regla, consulta con tu médico. Si ya te ha venido y no la apuntaste, regístrala.`,
        why: {
          rule: `Aviso cuando la regla lleva más de ${LIMITS.lateAlertDays} días de retraso respecto a la fecha prevista (inicio de la última + duración ${info.basis === 'own' ? 'media de tus ciclos' : 'que indicaste en tu perfil'}).`,
          data: [
            { label: 'Última regla', value: fmtDate(last.start, 'full') },
            { label: 'Duración usada', value: `${n1(info.cycleLength)} días` },
            { label: 'Fecha prevista', value: fmtDate(info.next.start, 'full') },
            { label: 'Retraso', value: plural(info.lateDays, 'día', 'días') },
          ],
        },
        sources: [SOURCES.figo],
        action: { label: 'Me ha venido', href: '#/cycle' },
      }));
    }

    // Duración: mediana de los últimos ciclos (una regla sin apuntar no la dispara sola).
    const lens = recentCycles.map((c) => c.lengthDays).filter((x) => x >= LIMITS.validCycleMin);
    const typical = lens.length >= LIMITS.minCyclesOwn ? median(lens) : null;
    if (typical != null && (typical < LIMITS.normalMin || typical > LIMITS.normalMax)) {
      const short = typical < LIMITS.normalMin;
      out.push(insight({
        id: 'cycle-length', level: 'warn', priority: 70,
        title: short ? 'Ciclos más cortos de lo habitual' : 'Ciclos más largos de lo habitual',
        text: `Tus ciclos duran unos ${n1(typical)} días; lo habitual es entre ${LIMITS.normalMin} y ${LIMITS.normalMax} (FIGO). Puede ser algo pasajero (estrés, cambios de entrenamiento o de peso), pero si se mantiene, coméntalo con tu ginecóloga o tu médico de cabecera.${short ? '' : ' Si alguna regla no la apuntaste, regístrala: los ciclos saldrán más largos de lo que son.'}`,
        why: {
          rule: `Ciclo normal según la FIGO: ${LIMITS.normalMin}–${LIMITS.normalMax} días. Se usa la mediana de tus últimos ciclos (hasta ${LIMITS.avgWindow}, al menos ${LIMITS.minCyclesOwn}).`,
          data: [
            { label: 'Duración típica (mediana)', value: `${n1(typical)} días` },
            { label: 'Ciclos', value: lens.join(' · ') },
          ],
        },
        sources: [SOURCES.figo],
      }));
    }

    if (info.regular === false) {
      const lens = cycles.slice(-12).map((c) => c.lengthDays).filter((n) => n >= LIMITS.validCycleMin && n <= LIMITS.validCycleMax);
      out.push(insight({
        id: 'cycle-irregular', level: 'warn', priority: 60,
        title: 'Ciclos bastante variables',
        text: `Entre tu ciclo más corto (${Math.min(...lens)} días) y el más largo (${Math.max(...lens)}) hay ${info.variation} días. La FIGO considera regular una variación de hasta 7–9 días (según la edad). Puede pasar en épocas de estrés, viajes o cambios en el entrenamiento; si se repite, coméntalo con un profesional. Las estimaciones de fases serán menos precisas.`,
        why: {
          rule: `Regularidad (FIGO): diferencia entre el ciclo más corto y el más largo de hasta 7–9 días. Aviso por encima de ${LIMITS.variationMax}, con al menos ${LIMITS.minCyclesRegular} ciclos.`,
          data: [
            { label: 'Ciclos (últimos)', value: lens.join(' · ') },
            { label: 'Variación', value: `${info.variation} días` },
          ],
        },
        sources: [SOURCES.figo],
      }));
    }
  }

  // Reglas abundantes o largas frecuentes (también con anticonceptivo hormonal).
  const recentPeriods = periods.filter((x) => !(info.ongoing && x.start === info.ongoing.start)).slice(-LIMITS.avgWindow);
  const heavy = recentPeriods.filter((x) => x.heavyDays >= 2);
  const long = recentPeriods.filter((x) => x.lengthDays > LIMITS.periodMaxDays);
  const flagged = recentPeriods.filter((x) => x.heavyDays >= 2 || x.lengthDays > LIMITS.periodMaxDays);
  if (flagged.length >= 2 && flagged.length * 2 >= recentPeriods.length) {
    const since = recentPeriods[0]?.start;
    const tired = info.days.some((d) => d.id >= since && d.symptoms?.includes('fatigue'));
    const parts = [];
    if (heavy.length >= 2) parts.push(`en ${heavy.length} de tus ${recentPeriods.length} últimas reglas has marcado varios días de sangrado abundante`);
    if (long.length >= 2) parts.push(`${long.length} de ellas han durado más de ${LIMITS.periodMaxDays} días`);
    const lead = parts.join(' y ') || `en ${flagged.length} de tus ${recentPeriods.length} últimas reglas hubo sangrado abundante o largo`;
    out.push(insight({
      id: 'cycle-heavy', level: tired ? 'warn' : 'info', priority: tired ? 75 : 55,
      title: 'Reglas abundantes a menudo',
      text: `${lead.charAt(0).toUpperCase()}${lead.slice(1)}. El sangrado abundante es frecuente en mujeres que hacen ejercicio y aumenta el riesgo de tener el hierro bajo. ${tired ? 'Como además has marcado cansancio, ' : 'Si notas cansancio a menudo, '}pide a tu médico que te mire el hierro (ferritina) antes de tomar suplementos por tu cuenta.`,
      why: {
        rule: `Aviso si al menos 2 (y la mitad) de tus últimas reglas tienen 2 o más días abundantes o duran más de ${LIMITS.periodMaxDays} días (FIGO: regla prolongada > 8 días).`,
        data: [
          ...recentPeriods.map((x) => ({ label: fmtDate(x.start, 'full'), value: `${plural(x.lengthDays, 'día', 'días')} · ${x.heavyDays} abundante${x.heavyDays === 1 ? '' : 's'}` })),
          { label: 'Cansancio anotado', value: tired ? 'sí' : 'no' },
        ],
      },
      sources: [SOURCES.bruinvels, SOURCES.pedlar, SOURCES.figo],
    }));
  }
  return out.sort((a, b) => b.priority - a.priority);
}

// ---------------------------------------------------------------------------
// Consejos por fase (evidencia, sin mitos) y nota de la evidencia
// ---------------------------------------------------------------------------
export const EVIDENCE_NOTE = {
  id: 'cycle-evidence', area: 'cycle', level: 'info', priority: 20,
  title: 'Lo que dice la ciencia',
  text: 'En promedio, la fase del ciclo influye poco en el rendimiento y en lo que ganas entrenando: el efecto es pequeño y cambia mucho de una mujer a otra. Por eso aquí no se cambia tu plan por fases: se miran tus propios datos, y entrenas según cómo te encuentres.',
  why: {
    rule: 'Meta-análisis y revisiones recientes no encuentran un efecto claro y consistente de la fase en la fuerza, el rendimiento ni las adaptaciones; recomiendan un enfoque individual.',
    data: [{ label: 'Efecto medio de la fase', value: 'trivial y variable' }, { label: 'Recomendación', value: 'individual, según síntomas' }],
  },
  sources: [SOURCES.mcnulty, SOURCES.colenso],
};

/** Consejos prácticos por fase. `short` = frase breve para la tarjeta de Hoy (null si no aporta). */
export const PHASE_TIPS = {
  menstrual: [
    {
      id: 'tip-period-pain', short: 'Si tienes dolor o mucho cansancio, una sesión más suave también cuenta; si te encuentras bien, entrena con normalidad.',
      title: 'Días de regla', text: 'Si tienes dolor o te notas sin fuerzas, baja la intensidad o haz una sesión más corta o suave (movilidad, cardio suave). Si te encuentras bien, entrena con normalidad: en promedio, la regla no reduce la fuerza.',
      why: { rule: 'El efecto medio de la fase en el rendimiento es trivial y muy variable; lo que cambia de una mujer a otra son los síntomas. El ejercicio, sobre todo suave o moderado, puede reducir el dolor menstrual.', data: [{ label: 'Efecto medio en el rendimiento', value: 'trivial' }, { label: 'Ejercicio y dolor menstrual', value: 'puede aliviarlo' }] },
      sources: [SOURCES.mcnulty, SOURCES.armour],
    },
    {
      id: 'tip-iron', short: null,
      title: 'Reglas abundantes y cansancio', text: 'Si tus reglas son abundantes y te notas cansada a menudo, pide a tu médico que te mire el hierro (ferritina). No tomes suplementos de hierro por tu cuenta sin un análisis.',
      why: { rule: 'El sangrado abundante es frecuente en mujeres que entrenan y es una causa habitual de hierro bajo, que da cansancio y resta rendimiento.', data: [{ label: 'Señales', value: 'reglas abundantes + cansancio' }, { label: 'Qué pedir', value: 'ferritina (hierro)' }] },
      sources: [SOURCES.bruinvels, SOURCES.pedlar],
    },
  ],
  follicular: [
    {
      id: 'tip-follicular', short: 'Si te notas con energía, es tan buen momento como cualquiera para apretar; no hace falta cambiar tu plan.',
      title: 'Fase folicular', text: 'Muchas mujeres se notan con más energía estos días, pero no hace falta planificar según la fase: si te encuentras bien, es tan buen momento como cualquiera para intentar marcas. Manda cómo te sientes, no el calendario.',
      why: { rule: 'No hay un efecto claro de la fase en la fuerza ni en las ganancias; las diferencias medias son triviales.', data: [{ label: 'Efecto de la fase en la fuerza', value: 'sin efecto claro' }] },
      sources: [SOURCES.mcnulty, SOURCES.colenso],
    },
  ],
  ovulation: [
    {
      id: 'tip-ovulation', short: null,
      title: 'Ovulación (aprox.)', text: 'La fecha se estima contando unos 14 días antes de la próxima regla (± 2 días), así que es aproximada y no sirve como método anticonceptivo. Para entrenar no cambia nada.',
      why: { rule: 'Sin medir hormonas ni temperatura, la ovulación solo se puede aproximar: ciclo − 14 días ± 2. El efecto de la fase en el rendimiento es trivial.', data: [{ label: 'Estimación', value: 'duración del ciclo − 14 ± 2 días' }] },
      sources: [SOURCES.mcnulty],
    },
  ],
  luteal: [
    {
      id: 'tip-luteal', short: 'Si notas más cansancio o duermes peor, ajusta la intensidad ese día y cuida el sueño.',
      title: 'Fase lútea', text: 'Algunas mujeres notan más cansancio o duermen peor en esta fase y otras no notan nada. Si te pasa, ajusta la intensidad ese día; dormir poco sí resta fuerza en los ejercicios grandes, así que cuida el sueño.',
      why: { rule: 'La fase afecta poco y de forma variable; dormir poco reduce la fuerza en ejercicios compuestos.', data: [{ label: 'Efecto medio de la fase', value: 'trivial y variable' }, { label: 'Sueño corto', value: 'menos fuerza en compuestos' }] },
      sources: [SOURCES.mcnulty, SOURCES.knowles],
    },
  ],
  premenstrual: [
    {
      id: 'tip-water', short: 'Es normal pesar algo más estos días por retención de líquidos: no es grasa.',
      title: 'Antes de la regla', text: 'Es normal que el peso suba un poco en los días previos y al empezar la regla por retención de líquidos: no es grasa. Compara tu peso con el de la misma fase de otros ciclos, no con el de la semana pasada.',
      why: { rule: 'La retención de líquidos cambia a lo largo del ciclo y es máxima el primer día de regla.', data: [{ label: 'Máxima retención', value: 'primer día de regla' }] },
      sources: [SOURCES.white],
    },
  ],
};
export const HORMONAL_TIP = {
  id: 'tip-hormonal', short: null,
  title: 'Con anticonceptivo hormonal', text: 'No hay fases naturales que estimar. En promedio, la píldora tiene un efecto trivial en el rendimiento: entrena según cómo te encuentres. Registrar sangrados y síntomas te ayuda a ver tus patrones.',
  why: { rule: 'Los anticonceptivos orales suprimen la ovulación; su efecto medio en el rendimiento es trivial.', data: [{ label: 'Efecto medio en el rendimiento', value: 'trivial' }] },
  sources: [SOURCES.elliott],
};

/** Consejo breve para hoy (tarjeta de Hoy): null si no aporta. */
export function todayTip(info) {
  if (!info || info.hormonal || !info.current?.phase) return null;
  const tip = (PHASE_TIPS[info.current.phase] || []).find((t) => t.short);
  return tip ? { ...tip } : null;
}

// ---------------------------------------------------------------------------
// «Cómo te afecta»: medias por fase de SU historial
// ---------------------------------------------------------------------------
const exGetter = (ex) => {
  if (!ex) return () => null;
  if (ex instanceof Map) return (id) => ex.get(id) || null;
  if (Array.isArray(ex)) { const m = new Map(ex.map((e) => [e.id, e])); return (id) => m.get(id) || null; }
  return (id) => ex[id] || null;
};

/** % de cada sesión de fuerza frente a su referencia (mediana del mismo ejercicio ± 6 semanas). */
function strengthScores(sessions, exercises, bodyweight) {
  const getEx = exGetter(exercises);
  const bwFn = makeBodyweightFn(bodyweight || [], 70);
  const byEx = new Map(); // exId → [{ date, e1rm, sid }]
  for (const s of sessions || []) {
    if (!s || s.kind !== 'strength' || s.status !== 'done' || !isDateStr(s.date)) continue;
    for (const se of s.exercises || []) {
      const ex = getEx(se.exerciseId) || { logType: 'weight_reps' };
      let best = null;
      for (const set of se.sets || []) {
        if (!isWorkSet(set)) continue;
        const m = setMetrics(set, ex, bwFn(s.date));
        if (m.e1rm && (best == null || m.e1rm > best)) best = m.e1rm;
      }
      if (best == null) continue;
      if (!byEx.has(se.exerciseId)) byEx.set(se.exerciseId, []);
      byEx.get(se.exerciseId).push({ date: s.date, e1rm: best, sid: s.id });
    }
  }
  const perSession = new Map(); // sid → { date, rels: [] }
  for (const pts of byEx.values()) {
    for (const p of pts) {
      const ref = median(pts.filter((q) => q !== p && Math.abs(diffDays(p.date, q.date)) <= 42).map((q) => q.e1rm));
      const others = pts.filter((q) => q !== p && Math.abs(diffDays(p.date, q.date)) <= 42).length;
      if (ref == null || others < 2) continue;
      if (!perSession.has(p.sid)) perSession.set(p.sid, { date: p.date, rels: [] });
      perSession.get(p.sid).rels.push(p.e1rm / ref - 1);
    }
  }
  return [...perSession.values()].map((x) => ({ date: x.date, pct: avg(x.rels) * 100 }));
}

/** Desvío de cada pesaje respecto a su tendencia (media de los demás pesajes ± 7 días; ≥ 3). */
function weightDeviations(bodyweight) {
  const list = (bodyweight || []).filter((b) => b && isDateStr(b.id) && b.kg > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
  const out = [];
  for (const b of list) {
    const others = list.filter((q) => q !== b && Math.abs(diffDays(b.id, q.id)) <= 7);
    if (others.length < 3) continue;
    out.push({ date: b.id, kg: b.kg - avg(others.map((q) => q.kg)) });
  }
  return out;
}

const stat = (vals) => ({ mean: vals.length ? avg(vals) : null, n: vals.length });

/**
 * Medias por fase de SU historial (solo ciclo natural y con ≥ 2 ciclos completos).
 * @param {object} info  cycleInfo(...)
 * @param {{ checkins?, sessions?, exercises?, bodyweight?, cycleDays? }} data
 * @returns {{ ok:boolean, reason?, needed?, cycles, phases:[{ id, name, label, days, energy:{mean,n}, sleep:{mean,n},
 *   rpe:{mean,n}, strength:{pct,n}, weight:{kg,n}, symptoms:[{id,label,count,share}] }], overall, insights: Insight[] }}
 */
export function phaseStats(info, data = {}) {
  const n = info?.cycles?.length || 0;
  const base = { ok: false, cycles: n, phases: [], overall: null, insights: [] };
  if (!info || !info.periods?.length) return { ...base, reason: 'Aún no hay reglas registradas.', needed: LIMITS.statsCycles };
  if (info.hormonal) return { ...base, reason: 'Con anticonceptivo hormonal no hay fases naturales que comparar.' };
  if (n < LIMITS.statsCycles) {
    const left = LIMITS.statsCycles - n;
    return { ...base, needed: left, reason: `Aparecerá cuando tengas ${LIMITS.statsCycles} ciclos completos registrados (te ${left === 1 ? 'falta 1' : `faltan ${left}`}).` };
  }
  const from = info.periods[0].start;
  const to = info.today;
  const phaseOf = new Map();
  const phaseAt = (date) => {
    if (date < from || date > to) return null;
    if (!phaseOf.has(date)) phaseOf.set(date, phaseForDate(info, date)?.phase ?? null);
    return phaseOf.get(date);
  };
  const acc = Object.fromEntries(PHASE_IDS.map((id) => [id, { energy: [], sleep: [], rpe: [], strength: [], weight: [], sym: new Map(), logged: 0, days: 0 }]));
  for (let d = from, k = 0; d <= to && k < 3000; d = addDays(d, 1), k++) {
    const ph = phaseAt(d);
    if (ph) acc[ph].days++;
  }
  for (const c of data.checkins || []) {
    const ph = c && isDateStr(c.date) ? phaseAt(c.date) : null;
    if (!ph) continue;
    if ([1, 2, 3].includes(c.energy)) acc[ph].energy.push(c.energy);
    if ([1, 2, 3].includes(c.sleep)) acc[ph].sleep.push(c.sleep);
  }
  for (const s of data.sessions || []) {
    if (!s || s.status !== 'done' || s.parentId || !isDateStr(s.date) || !(s.rpe >= 1 && s.rpe <= 10)) continue;
    const ph = phaseAt(s.date);
    if (ph) acc[ph].rpe.push(s.rpe);
  }
  for (const x of strengthScores(data.sessions, data.exercises, data.bodyweight)) {
    const ph = phaseAt(x.date);
    if (ph) acc[ph].strength.push(x.pct);
  }
  for (const x of weightDeviations(data.bodyweight)) {
    const ph = phaseAt(x.date);
    if (ph) acc[ph].weight.push(x.kg);
  }
  for (const d of normalizeDays(data.cycleDays ?? info.days)) {
    const ph = phaseAt(d.id);
    if (!ph) continue;
    acc[ph].logged++;
    for (const s of d.symptoms || []) acc[ph].sym.set(s, (acc[ph].sym.get(s) || 0) + 1);
  }
  const phases = PHASES.map((p) => {
    const a = acc[p.id];
    const symptoms = [...a.sym.entries()]
      .filter(([id, count]) => SYMPTOM_LABEL[id] && count >= 2)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([id, count]) => ({ id, label: SYMPTOM_LABEL[id], count, share: a.logged ? count / a.logged : null }));
    const st = stat(a.strength);
    const wt = stat(a.weight);
    return {
      id: p.id, name: p.name, label: p.label, days: a.days, loggedDays: a.logged,
      energy: stat(a.energy), sleep: stat(a.sleep), rpe: stat(a.rpe),
      strength: { pct: st.mean, n: st.n }, weight: { kg: wt.mean, n: wt.n }, symptoms,
    };
  });
  const allOf = (key) => PHASE_IDS.flatMap((id) => acc[id][key]);
  const overall = { energy: stat(allOf('energy')), sleep: stat(allOf('sleep')), rpe: stat(allOf('rpe')), strength: stat(allOf('strength')) };
  return { ok: true, cycles: n, phases, overall, insights: statsInsights(phases, overall, n) };
}

const MIN_N = 3; // valores por fase para sacar conclusiones

function statsInsights(phases, overall, cycles) {
  const out = [];
  const src = [SOURCES.mcnulty];
  // Energía
  if (overall.energy.n >= 8) {
    const cands = phases.filter((p) => p.energy.n >= MIN_N).map((p) => ({ p, diff: p.energy.mean - overall.energy.mean }));
    const low = cands.sort((a, b) => a.diff - b.diff)[0];
    if (low && low.diff <= -0.3) {
      out.push(insight({
        id: `cycle-energy-${low.p.id}`, level: 'info', priority: 45,
        title: `Menos energía en tu ${low.p.id === 'menstrual' ? 'regla' : low.p.label}`,
        text: `En tus check-ins, tu energía media en la ${low.p.id === 'menstrual' ? 'regla' : low.p.label} es ${n1(low.p.energy.mean)} de 3, frente a ${n1(overall.energy.mean)} de media. Si te pasa, está bien ajustar la intensidad esos días.`,
        why: { rule: `Media de la energía (1 baja · 2 normal · 3 alta) de tus check-ins por fase estimada, con ≥ ${MIN_N} check-ins en la fase; se destaca una diferencia de 0,3 o más.`, data: phases.filter((p) => p.energy.n).map((p) => ({ label: p.name, value: `${n1(p.energy.mean)} (${p.energy.n})` })) },
        sources: src,
      }));
    }
  }
  // Fuerza
  const strong = phases.filter((p) => p.strength.n >= MIN_N);
  if (strong.length >= 2) {
    const ext = strong.reduce((a, b) => (Math.abs(b.strength.pct) > Math.abs(a.strength.pct) ? b : a));
    const data = strong.map((p) => ({ label: p.name, value: `${p.strength.pct >= 0 ? '+' : '−'}${n1(Math.abs(p.strength.pct))} % (${p.strength.n})` }));
    const rule = 'Cada sesión de fuerza se compara con tu nivel de esas semanas (mediana del 1RM estimado de cada ejercicio ± 6 semanas) y se promedia por fase estimada, con ≥ 3 sesiones en la fase.';
    if (Math.abs(ext.strength.pct) >= 2.5) {
      out.push(insight({
        id: `cycle-strength-${ext.id}`, level: 'info', priority: 40,
        title: `Fuerza ${ext.strength.pct < 0 ? 'algo menor' : 'algo mayor'} en tu ${ext.id === 'menstrual' ? 'regla' : ext.label}`,
        text: `En tus datos, en la ${ext.id === 'menstrual' ? 'regla' : ext.label} rindes de media un ${n1(Math.abs(ext.strength.pct))} % ${ext.strength.pct < 0 ? 'por debajo' : 'por encima'} de tu nivel de esas semanas. Es tu patrón, no una regla: con más ciclos se verá si se mantiene.`,
        why: { rule, data }, sources: [SOURCES.mcnulty, SOURCES.colenso],
      }));
    } else {
      out.push(insight({
        id: 'cycle-strength-flat', level: 'good', priority: 35,
        title: 'Tu fuerza apenas cambia entre fases',
        text: 'En tus sesiones, la diferencia de fuerza entre fases es menor del 2,5 %: lo esperable según la evidencia. Entrena según cómo te encuentres.',
        why: { rule, data }, sources: [SOURCES.mcnulty, SOURCES.colenso],
      }));
    }
  }
  // Peso (retención de líquidos)
  const wph = phases.filter((p) => p.weight.n >= MIN_N);
  if (wph.length >= 2) {
    const hi = wph.reduce((a, b) => (b.weight.kg > a.weight.kg ? b : a));
    if (hi.weight.kg >= 0.3) {
      out.push(insight({
        id: 'cycle-weight', level: 'info', priority: 42,
        title: 'Retención de líquidos',
        text: `En tu ${hi.id === 'menstrual' ? 'regla' : hi.label} pesas de media ${n1(hi.weight.kg)} kg más que tu tendencia. Es retención de líquidos, normal: compara tu peso con el de la misma fase de otros ciclos.`,
        why: { rule: 'Desvío de cada pesaje respecto a la media de tus otros pesajes de ± 7 días, promediado por fase estimada (≥ 3 pesajes en la fase).', data: wph.map((p) => ({ label: p.name, value: `${p.weight.kg >= 0 ? '+' : '−'}${n1(Math.abs(p.weight.kg))} kg (${p.weight.n})` })) },
        sources: [SOURCES.white],
      }));
    }
  }
  // Síntomas
  for (const p of phases) {
    const top = p.symptoms[0];
    if (top && p.loggedDays >= 3 && top.share >= 0.4) {
      out.push(insight({
        id: `cycle-symptom-${p.id}`, level: 'neutral', priority: 30,
        title: `${top.label} en tu ${p.id === 'menstrual' ? 'regla' : p.label}`,
        text: `Has marcado «${top.label.toLowerCase()}» en ${top.count} de ${p.loggedDays} días anotados de esa fase. Saberlo te ayuda a planificar esos días con margen.`,
        why: { rule: 'Síntoma más frecuente entre tus días anotados de cada fase (se destaca si aparece en el 40 % o más, con ≥ 3 días anotados).', data: p.symptoms.map((s) => ({ label: s.label, value: `${s.count} de ${p.loggedDays} días` })) },
        sources: [SOURCES.mcnulty],
      }));
    }
  }
  const tested = [phases.filter((p) => p.energy.n >= MIN_N).length, strong.length, wph.length].some((k) => k >= 2);
  if (!out.length && !tested) {
    out.push(insight({
      id: 'cycle-stats-nodata', level: 'neutral', priority: 20,
      title: 'Faltan datos para comparar fases',
      text: 'Para ver cómo te afecta cada fase hacen falta check-ins, sesiones de fuerza o pesajes en las fechas de tus ciclos. Cuantos más registres, más fiable será la comparación.',
      why: { rule: 'Se compara cada fase cuando hay al menos 3 valores en 2 fases o más (energía del check-in, fuerza relativa o peso).', data: [{ label: 'Ciclos completos', value: String(cycles) }, { label: 'Check-ins con energía', value: String(overall.energy.n) }, { label: 'Sesiones de fuerza comparables', value: String(overall.strength.n) }] },
      sources: [SOURCES.mcnulty],
    }));
  } else if (!out.length) {
    out.push(insight({
      id: 'cycle-stats-none', level: 'neutral', priority: 25,
      title: 'Sin diferencias claras entre fases',
      text: `Con tus ${cycles} ciclos no se ve un patrón claro de energía, fuerza o peso por fase. Es lo más habitual: entrena según cómo te encuentres.`,
      why: { rule: 'Se buscan diferencias de energía (≥ 0,3 de 3), fuerza (≥ 2,5 %) y peso (≥ 0,3 kg) con al menos 3 valores por fase.', data: [{ label: 'Ciclos completos', value: String(cycles) }] },
      sources: [SOURCES.mcnulty, SOURCES.colenso],
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Acciones (puras: devuelven los registros a guardar; la vista los guarda)
// ---------------------------------------------------------------------------
/**
 * «Ha terminado»: registros a guardar para cerrar la regla en curso con último día `lastDay`.
 * Rellena los días sin anotar entre el inicio y `lastDay` (flow 'medium', auto) y marca `ended` en el último.
 * → { save: [registro nuevo o modificado (copias)], before: [registro previo | { id, missing:true }] }
 */
export function endPeriodPlan(info, lastDay, now = Date.now()) {
  const ong = info?.ongoing;
  if (!ong || !isDateStr(lastDay) || lastDay < ong.lastLogged || lastDay > info.today) return null;
  const byId = new Map((info.days || []).map((d) => [d.id, d]));
  const save = [];
  const before = [];
  for (let d = ong.start; d <= lastDay; d = addDays(d, 1)) {
    const rec = byId.get(d);
    if (!rec) {
      save.push({ id: d, flow: 'medium', symptoms: [], notes: '', auto: true, ...(d === lastDay ? { ended: true } : {}), createdAt: now });
      before.push({ id: d, missing: true });
    } else if (d === lastDay || rec.ended) {
      const next = { ...rec };
      if (d === lastDay) { next.ended = true; if (!isBleeding(next)) next.flow = 'medium'; } else delete next.ended;
      save.push(next);
      before.push({ ...rec });
    }
  }
  return { save, before };
}

/** ¿Tiene contenido un registro? (sin sangrado, síntomas ni notas no merece la pena guardarlo) */
export function dayHasContent(d) {
  return !!d && (rank(d.flow) > 0 || (d.symptoms?.length || 0) > 0 || !!(d.notes && d.notes.trim()));
}

/** Sangrado que se propone al abrir un día sin anotar: el de la regla en curso si cae dentro; si no, 'none'. */
export function suggestedFlow(info, date) {
  const ong = info?.ongoing;
  if (!ong || date < ong.start || date > info.today) return 'none';
  const last = [...(info.days || [])].reverse().find((d) => d.id <= date && d.id >= ong.start && isBleeding(d));
  return last ? last.flow : 'medium';
}
