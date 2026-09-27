// analysis-weight.js — «tu analista»: análisis del peso corporal (ronda 5, docs/MEJORAS5.md §3a).
// PROPIETARIO: parte «peso» de la ronda 5. PURO: sin store, ui ni DOM; «hoy» inyectable (input.today). Solo
// importa util.js y profile.js (no importa cycle-logic.js: la fase de cada fecha se calcula aquí con los campos del
// CycleInfo). Pruebas: tests/unit/analysis-weight.test.mjs.
//
// MÉTODO (orientativo; cada Insight lo explica en su «¿Por qué?»)
//  - Pesajes: uno por día (id 'YYYY-MM-DD'), entre 20 y 400 kg, hasta hoy (las fechas futuras se ignoran).
//  - Tendencia (curva y peso de tendencia): media móvil EXPONENCIAL por tiempo, τ = 10 días (cada pesaje pesa
//    1 − e^(−Δdías/10) y los huecos entre pesajes se respetan), sembrada con la mediana de los 3 primeros pesajes
//    y con el salto de cada pesaje limitado a ±2,5 kg (una errata no arrastra la curva). currentKg = la tendencia
//    en el último pesaje.
//  - Ritmo: pendiente robusta de Theil–Sen (mediana de las pendientes entre cada par de pesajes) sobre los pesajes
//    de la ventana, con su intervalo de confianza del 95 % (método de Sen). Se calcula sobre los pesajes y no sobre
//    la media exponencial porque la media va con retraso y sus valores no son independientes (el intervalo saldría
//    falsamente estrecho). Ventana: 28 días hasta hoy (mujer: al menos un ciclo, 28–42 días); si hay pocos pesajes
//    o mucho ruido se amplía a 42 y 56 días. Mínimo: 8 pesajes en ≥ 14 días y el último hace ≤ 14 días; si no,
//    status 'insufficient' con consejos para pesarse.
//  - «No inventar ritmo»: si el intervalo incluye el 0 la dirección es 'stable' (texto «estable» o «unos…» con
//    aviso de margen de error); si además es muy ancho (± > 0,4 %/sem) no se da ritmo: 'insufficient' (ruido).
//  - Mujer con ciclo natural (CycleInfo con reglas y sin anticonceptivo hormonal): los pesajes de los 5 días previos
//    a la regla (lútea tardía / premenstrual) y de los días 1–3 de la regla se marcan «posible retención de líquidos»
//    (points[].retention), no mueven la curva y no cuentan para el ritmo. Con ≥ 2 ciclos con pesajes, el ritmo
//    compara días equivalentes de los dos últimos ciclos (p. ej. folicular con folicular: mediana de las pendientes
//    entre pesajes del mismo día del ciclo ±2) → trend.method 'phase'. Con anticonceptivo hormonal no hay fases.
//  - Rangos (% del peso por semana, con signo: + subir, − bajar; ver TARGETS): status 'below' | 'in' | 'above' se
//    refiere a esa recta con signo. Ojo en «perder grasa» (−1…−0,5): 'below' = bajas MÁS rápido de lo recomendado y
//    'above' = bajas poco (o subes). `paceLabel` da el texto corto ya interpretado.
//  - kcal/día ≈ ritmo (kg/sem) × 7700 / 7 (aproximación, Hall 2008). Sugerencia de ajuste: lo que llevaría el ritmo
//    del borde al centro del rango recomendado, redondeado a 50 kcal (100–500 kcal).
//  - Proteína 1,6–2,2 g/kg/día (en déficit, hacia la parte alta). Igual para mujeres y hombres.
//  - Energía baja (REDs): pérdida > 1 %/sem (mujer > 0,75 %), o pérdida con mucha resistencia (≥ 300 min/sem de
//    media en 4 semanas; mujer ≥ 240); en mujer, además, regla retrasada > 7 días / ausente ≥ 90 días / alerta del
//    ciclo + pérdida o mucha resistencia → aviso de consultar a un profesional.
//
// ENTRADA analyzeWeight(input):
//   { bodyweight:[{ id:'YYYY-MM-DD', kg }], today, profile (profile.getProfile(settings)),
//     strength?: { trendPctPerWeek, n } | null, endurance?: { weeklyMinutes4w } | null, cycle?: CycleInfo | null }
// SALIDA (contrato §3a + campos extra documentados en analyzeWeight):
//   { ok, reason?, trend:{ points:[{ date, kg, trendKg }], currentKg, ratePerWeekKg, ratePerWeekPct, windowDays, n },
//     target:{ minPct, maxPct, label } | null, status:'below'|'in'|'above'|'insufficient'|'no_goal',
//     kcalPerDay:{ estimate, suggestion:{ min, max } | null }, proteinG:{ min, max }, insights: Insight[],
//     goalSuggestion?: { targetKg, byFrom, byTo, title } }
import { addDays, diffDays, isDateStr, todayStr, fmtDate, fmtNum, round } from './util.js';
import { g, isFemale, isHormonal } from './profile.js';

/**
 * @typedef {{ label:string, value:string }} WhyRow
 * @typedef {{ short:string, detail:string }} Source
 * @typedef {{ id:string, area:'weight', level:'good'|'neutral'|'warn'|'info', priority:number, title:string,
 *   text:string, why:{ rule:string, data:WhyRow[] }, sources:Source[], action?:{ label:string, href:string } }} Insight
 */

// ===========================================================================
// Constantes
// ===========================================================================

/** Mínimo de pesajes y de días entre el primero y el último para calcular un ritmo. */
export const MIN_POINTS = 8;
export const MIN_SPAN_DAYS = 14;
/** Si el último pesaje es más antiguo que esto, no se describe «cómo vas ahora». */
export const STALE_DAYS = 14;
/** Constante de tiempo de la media exponencial (≈ 10 días). */
export const EMA_TAU_DAYS = 10;
/** Ventana del ritmo (días hasta hoy) y máxima al ampliarla. */
export const WINDOW_DAYS = 28;
export const MAX_WINDOW_DAYS = 56;
/** kcal por kg de peso corporal (regla aproximada). */
export const KCAL_PER_KG = 7700;
/** Proteína diaria (g por kg); en déficit, hacia la parte alta (desde `deficit`). */
export const PROTEIN_G_PER_KG = { min: 1.6, max: 2.2, deficit: 2.0 };
/** Minutos semanales de resistencia (media de 4 semanas) a partir de los que se considera «mucha resistencia». */
export const HIGH_ENDURANCE_MIN = { male: 300, female: 240 };
/** Pérdida (% del peso/semana) a partir de la que se avisa de energía baja. */
export const FAST_LOSS_PCT = { male: 1, female: 0.75 };
/** Por debajo de este ritmo (|%/sem|) se habla de peso estable aunque la tendencia sea estadísticamente clara. */
export const STABLE_PCT = 0.05;
/** Semiancho máximo del intervalo (%/sem) para dar un ritmo cuando no hay dirección clara. */
export const NOISY_HALF_PCT = 0.4;

const Z = 1.96;
const MAX_STEP_KG = 2.5;
const MIN_KCAL = 100;
const MAX_KCAL = 500;
const LATE_DAYS = 7;
const AMENORRHEA_DAYS = 90;
const LONG_CYCLE_DAYS = 38;
const PRE_DAYS = 5;
const MENSES_RETENTION_DAYS = 3;
const REF = '2000-01-01';
const GOAL_WEEKS = { gain: 12, lose: 8 };
const GOAL_IDS = ['gain', 'lose', 'maintain', 'performance'];
const EXP_IDS = ['beginner', 'intermediate', 'advanced'];
const GOAL_NAME = { gain: 'ganar músculo', lose: 'perder grasa', maintain: 'mantener', performance: 'rendimiento' };
const EXP_NAME = { beginner: 'principiante', intermediate: 'intermedio', advanced: 'avanzado' };
const EXP_NAME_F = { beginner: 'principiante', intermediate: 'intermedia', advanced: 'avanzada' };

/**
 * Rangos de cambio de peso por objetivo, en % del peso por semana CON SIGNO (+ subir, − bajar).
 * gain por sexo y experiencia (mujer algo más prudente: el mismo % supone menos masa magra absoluta);
 * lose.lowerHalf = la mitad baja recomendada con mucha resistencia o en mujer.
 */
export const TARGETS = Object.freeze({
  gain: {
    male: { beginner: [0.25, 0.5], intermediate: [0.25, 0.5], advanced: [0.1, 0.25] },
    female: { beginner: [0.2, 0.4], intermediate: [0.2, 0.4], advanced: [0.1, 0.2] },
  },
  lose: { range: [-1, -0.5], lowerHalf: [-0.75, -0.5] },
  maintain: { range: [-0.25, 0.25] },
  performance: { range: [-0.25, 0.25] },
});

/** Fuentes citadas (todas de la lista permitida de docs/MEJORAS5.md §5). */
export const SOURCES = Object.freeze({
  morton2018: { short: 'Morton et al., 2018', detail: 'Br J Sports Med · meta-análisis: con entrenamiento de fuerza, la proteína ayuda a ganar músculo hasta ~1,6 g/kg/día (IC hasta ~2,2)' },
  jager2017: { short: 'Jäger et al., 2017', detail: 'J Int Soc Sports Nutr · posición de la ISSN sobre proteína y ejercicio: 1,4–2,0 g/kg/día' },
  iraki2019: { short: 'Iraki et al., 2019', detail: 'Sports · nutrición fuera de temporada: ganar ~0,25–0,5 % del peso por semana para ganar músculo con poca grasa' },
  helms2014: { short: 'Helms, Aragon y Fitschen, 2014', detail: 'J Int Soc Sports Nutr · perder 0,5–1 % del peso por semana para conservar el músculo; proteína alta en déficit' },
  garthe2011: { short: 'Garthe et al., 2011', detail: 'Int J Sport Nutr Exerc Metab · en deportistas, perder peso despacio (0,7 %/sem) conservó mejor músculo y fuerza que rápido (1,4 %/sem)' },
  hall2008: { short: 'Hall, 2008', detail: 'Int J Obes · la regla de 3500 kcal por libra (≈ 7700 kcal/kg) es solo una aproximación' },
  mountjoy2023: { short: 'Mountjoy et al., 2023', detail: 'Br J Sports Med · consenso del COI sobre REDs: la energía baja perjudica salud y rendimiento; la alteración menstrual es una señal clave' },
  roberts2020: { short: 'Roberts, Nuckols y Krieger, 2020', detail: 'J Strength Cond Res · mujeres y hombres ganan fuerza y músculo de forma parecida en términos relativos' },
  white2011: { short: 'White et al., 2011', detail: 'Obstet Gynecol Int · la retención de líquidos cambia a lo largo del ciclo y es máxima el primer día de la regla' },
  munro2018: { short: 'Munro et al. (FIGO), 2018', detail: 'Int J Gynaecol Obstet · ciclo normal de 24–38 días, con variación ≤ 7–9 días' },
});

// ===========================================================================
// Utilidades numéricas y de formato
// ===========================================================================

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
const roundHalf = (v) => Math.round(v * 2) / 2;
function median(arr) {
  const a = arr.filter(isNum).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function meanOf(arr) {
  const a = arr.filter(isNum);
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
}
const xOf = (date) => diffDays(REF, date);
const spanOf = (pts) => (pts.length ? diffDays(pts[0].date, pts[pts.length - 1].date) : 0);
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

const kgTxt = (v, dec = 1) => `${fmtNum(v, dec)} kg`;
/** Ritmo en kg sin signo: 2 decimales por debajo de 0,1 («0,05»), si no 1 («0,3»). */
const kgAbs = (v) => fmtNum(Math.abs(v), Math.abs(v) < 0.095 ? 2 : 1);
/** Porcentaje sin signo con hasta 2 decimales («0,4», «0,52»). */
const pctAbs = (v) => fmtNum(Math.abs(v), 2);
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
const signedKgW = (v) => `${sgn(r2(v))}${fmtNum(Math.abs(v), 2)} kg/sem`;
const signedPctW = (v) => `${sgn(r2(v))}${fmtNum(Math.abs(v), 2)} %/sem`;
const pctRange = (a, b) => `${fmtNum(Math.abs(a), 2)}–${fmtNum(Math.abs(b), 2)}`;
const kgRange = (a, b) => `${fmtNum(Math.abs(a), 2)}–${fmtNum(Math.abs(b), 2)}`;
/** Rango del objetivo en kg/sem sin signo: «0,19–0,38», «0,4–0,8» (bajar) o «±0,19» (mantener). */
function rangeKgTxt(t) {
  if (t.goal === 'maintain' || t.goal === 'performance') return `±${fmtNum(Math.abs(t.maxKg), 2)}`;
  return t.goal === 'lose' ? kgRange(t.maxKg, t.minKg) : kgRange(t.minKg, t.maxKg);
}
const day = (d) => fmtDate(d, 'day');
const hoursTxt = (min) => fmtNum(Math.max(0.5, roundHalf(min / 60)), 1);
/** «del 1 al 27 sep» · «del 30 ago al 27 sep» · «el 3 sep». */
function spanTxt(a, b) {
  if (!a || !b) return '—';
  if (a === b) return `el ${day(a)}`;
  const [da, ma] = day(a).split(' ');
  const [db, mb] = day(b).split(' ');
  return ma === mb && a.slice(0, 4) === b.slice(0, 4) ? `del ${da} al ${db} ${mb}` : `del ${day(a)} al ${day(b)}`;
}
/** «las últimas 4 semanas» (≥ 21 días) o «los últimos 16 días». */
function periodTxt(days) {
  return days >= 21 ? `las últimas ${Math.round(days / 7)} semanas` : `los últimos ${days} días`;
}
/** «entre el 1 dic y el 5 feb» (con año si no es el de hoy). */
function dateRangeTxt(from, to, today) {
  const f = (d) => fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full');
  return `entre el ${f(from)} y el ${f(to)}`;
}
function listDates(dates, max = 4) {
  const ds = dates.map(day);
  if (ds.length <= max) return ds.join(', ');
  return `${ds.slice(0, max).join(', ')} y ${ds.length - max} más`;
}
const pesajes = (n) => `${n} ${n === 1 ? 'pesaje' : 'pesajes'}`;

// ===========================================================================
// Estadística robusta
// ===========================================================================

/**
 * Pendiente de Theil–Sen (mediana de las pendientes entre cada par de puntos con x distinta) con intervalo de
 * confianza de Sen (varianza de la S de Kendall, z = 1,96 por defecto).
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {{slope, intercept, lo, hi, n, pairs}|null} lo/hi = extremos del intervalo de la pendiente.
 */
export function theilSen(xs, ys, { z = Z } = {}) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const slopes = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    }
  }
  if (!slopes.length) return null;
  slopes.sort((a, b) => a - b);
  const N = slopes.length;
  const slope = median(slopes);
  const intercept = median(xs.slice(0, n).map((x, i) => ys[i] - slope * x));
  const C = z * Math.sqrt((n * (n - 1) * (2 * n + 5)) / 18);
  const m1 = Math.floor((N - C) / 2);
  const m2 = Math.ceil((N + C) / 2);
  const lo = slopes[clampN(m1 - 1, 0, N - 1)];
  const hi = slopes[clampN(m2, 0, N - 1)];
  return { slope, intercept, lo: Math.min(lo, slope), hi: Math.max(hi, slope), n, pairs: N };
}

/**
 * Media móvil exponencial por tiempo sobre pesajes ordenados: nivel += (1 − e^(−Δdías/τ)) × (kg − nivel), con el
 * salto limitado a ±maxStepKg. Sembrada con la mediana de los 3 primeros pesajes usados (dentro de 7 días).
 * `skip(p)` → true: ese pesaje no mueve la curva (lleva el valor anterior; p. ej. retención de líquidos).
 * @param {{date:string, kg:number}[]} points ordenados por fecha
 * @returns {number[]} tendencia en cada punto (mismo orden)
 */
export function emaSeries(points, { tauDays = EMA_TAU_DAYS, skip = null, maxStepKg = MAX_STEP_KG } = {}) {
  const n = points.length;
  if (!n) return [];
  const use = points.map((p, i) => !(skip && skip(p, i)));
  if (!use.some(Boolean)) use.fill(true);
  const firstIdx = use.indexOf(true);
  const first = points[firstIdx];
  const seed = [];
  for (let i = firstIdx; i < n && seed.length < 3; i++) {
    if (use[i] && diffDays(first.date, points[i].date) < 7) seed.push(points[i].kg);
  }
  let level = median(seed);
  let lastDate = first.date;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (i >= firstIdx && use[i]) {
      const dt = Math.max(0, diffDays(lastDate, p.date));
      const w = 1 - Math.exp(-dt / tauDays);
      level += w * clampN(p.kg - level, -maxStepKg, maxStepKg);
      lastDate = p.date;
    }
    out[i] = level;
  }
  return out;
}

// ===========================================================================
// Ciclo (fase de una fecha a partir del CycleInfo, sin depender de cycle-logic.js)
// ===========================================================================

const PHASE_LABEL = {
  menstrual: 'regla', follicular: 'folicular', ovulation: 'ovulación (aprox.)', luteal: 'lútea', premenstrual: 'premenstrual',
};

/** Inicios de regla del CycleInfo (periods[].start y cycles[].start), ordenados y sin repetir. */
export function periodStarts(cycle) {
  if (!cycle) return [];
  const s = new Set();
  for (const p of cycle.periods || []) if (isDateStr(p?.start)) s.add(p.start);
  for (const c of cycle.cycles || []) if (isDateStr(c?.start)) s.add(c.start);
  return [...s].sort();
}

/**
 * Fase estimada de una fecha con los datos del CycleInfo (ciclo natural). Días de posible retención de líquidos:
 * los 5 previos a la regla (lútea tardía / premenstrual) y los días 1–3 de la regla. En el ciclo en curso la
 * duración es la media (avgCycle) o `cycleLength`; si la regla se retrasa, se sigue considerando premenstrual
 * hasta 7 días después de la fecha prevista y a partir de ahí la fase es desconocida.
 * @returns {{start, day, length, estimated, phase, phaseLabel, retention:'premenstrual'|'menstrual'|null}|null}
 *  null con anticonceptivo hormonal, sin reglas registradas o antes de la primera.
 */
export function cyclePhaseFor(cycle, date, opts = {}) {
  return phaseFinder(cycle, opts)(date);
}

/** Igual que cyclePhaseFor pero precalculando las reglas una vez: devuelve (date) → fase | null. */
function phaseFinder(cycle, { cycleLength = 28, periodLength = 5 } = {}) {
  if (!cycle || cycle.hormonal || cycle.enabled === false) return () => null;
  const starts = periodStarts(cycle);
  if (!starts.length) return () => null;
  const perByStart = new Map((cycle.periods || []).filter((p) => isDateStr(p?.start)).map((p) => [p.start, p]));
  const avgLen = Math.round(isNum(cycle.avgCycle) && cycle.avgCycle > 0 ? cycle.avgCycle : cycleLength);
  return (date) => {
    if (!isDateStr(date) || date < starts[0]) return null;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { // último inicio ≤ fecha
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= date) lo = mid; else hi = mid - 1;
    }
    const start = starts[lo];
    const next = starts[lo + 1] || null;
    const dayN = diffDays(start, date) + 1;
    let length = next ? diffDays(start, next) : avgLen;
    if (!next && !(length >= 15 && length <= 60)) length = cycleLength;
    const estimated = !next;
    if (estimated && dayN > length + LATE_DAYS) {
      return { start, day: dayN, length, estimated, phase: null, phaseLabel: 'desconocida', retention: null };
    }
    const perLen = clampN(Math.round(perByStart.get(start)?.lengthDays || cycle.avgPeriod || periodLength), 1, 12);
    const ovu = length - 14;
    let phase;
    if (dayN <= perLen) phase = 'menstrual';
    else if (dayN > length - PRE_DAYS) phase = 'premenstrual';
    else if (Math.abs(dayN - ovu) <= 2) phase = 'ovulation';
    else if (dayN < ovu) phase = 'follicular';
    else phase = 'luteal';
    const retention = dayN <= MENSES_RETENTION_DAYS ? 'menstrual' : phase === 'premenstrual' ? 'premenstrual' : null;
    return { start, day: dayN, length, estimated, phase, phaseLabel: PHASE_LABEL[phase], retention };
  };
}

/**
 * Irregularidad del ciclo relevante para la energía baja: regla retrasada > 7 días, ausente ≥ 90 días, ciclos muy
 * largos (media > 38 días, con ≥ 3 reglas) o alerta del CycleInfo sobre reglas retrasadas/ausentes. Con anticonceptivo hormonal no se valora (los sangrados no reflejan el
 * ciclo natural).
 * @returns {{flagged, lateDays, sinceDays, absent, longCycles, avgCycle, alerts:string[], lastStart}|null}
 */
export function cycleIrregularity(cycle, today) {
  if (!cycle || cycle.hormonal || cycle.enabled === false) return null;
  const starts = periodStarts(cycle);
  const lastStart = starts.length ? starts[starts.length - 1] : null;
  const sinceDays = lastStart ? diffDays(lastStart, today) : null;
  let lateDays = isNum(cycle.lateDays) ? cycle.lateDays : 0;
  if (!isNum(cycle.lateDays) && lastStart && isNum(cycle.avgCycle) && cycle.avgCycle > 0) {
    lateDays = Math.max(0, sinceDays - Math.round(cycle.avgCycle));
  }
  const absent = sinceDays != null && sinceDays >= AMENORRHEA_DAYS;
  // Ciclos muy largos (media > 38 días, fuera del rango normal de la FIGO): reglas espaciadas.
  const longCycles = starts.length >= 3 && isNum(cycle.avgCycle) && cycle.avgCycle > LONG_CYCLE_DAYS;
  const re = /late|retras|amenor|absent|ausen|missed|sin[ -]regla|no[ -]period/i;
  const alerts = (cycle.alerts || []).filter((a) => a && re.test(`${a.id || ''} ${a.title || ''}`));
  return {
    flagged: lateDays > LATE_DAYS || absent || longCycles || alerts.length > 0,
    lateDays, sinceDays, absent, longCycles, avgCycle: isNum(cycle.avgCycle) ? cycle.avgCycle : null,
    alerts: alerts.map((a) => a.title || a.id), lastStart,
  };
}

// ===========================================================================
// Tendencia
// ===========================================================================

function cleanPoints(list, today) {
  const byDate = new Map();
  for (const b of list || []) {
    const date = b?.id ?? b?.date;
    const kg = typeof b?.kg === 'number' ? b.kg : Number(b?.kg);
    if (!isDateStr(date) || !(kg >= 20 && kg <= 400) || date > today) continue;
    byDate.set(date, kg);
  }
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, kg]) => ({ date, kg }));
}

function robustFit(pts) {
  const ts = theilSen(pts.map((p) => p.x), pts.map((p) => p.kg));
  if (!ts) return null;
  const res = pts.map((p) => p.kg - (ts.intercept + ts.slope * p.x));
  const mr = median(res);
  const noise = 1.4826 * median(res.map((r) => Math.abs(r - mr)));
  return { ...ts, noise };
}

/** Ritmo en la ventana (sin los días de retención si quedan ≥ 6 pesajes en ≥ 14 días). */
function fitWindow(win, refKg) {
  const nonRet = win.filter((p) => !p.retention);
  const excl = nonRet.length < win.length && nonRet.length >= 6 && spanOf(nonRet) >= MIN_SPAN_DAYS;
  const used = excl ? nonRet : win;
  const f = robustFit(used);
  if (!f) return null;
  return {
    used, excluded: excl ? win.filter((p) => p.retention) : [], method: excl ? 'no-retention' : 'all',
    rateKg: f.slope * 7, lo: f.lo * 7, hi: f.hi * 7, noise: f.noise, refKg,
  };
}

/**
 * Ritmo comparando días equivalentes de dos ciclos seguidos (el más reciente con datos y el anterior): pesajes sin
 * retención desde el día 4, hasta el último día del ciclo en curso que tenga pesaje; mediana de las pendientes entre
 * pesajes del mismo día del ciclo (±2). Intervalo aproximado: diferencia de medianas con el ruido del ajuste.
 */
function phaseMatched(pts, today, sigma) {
  const groups = new Map();
  for (const p of pts) {
    if (!p.ph || p.retention || !p.ph.phase || p.ph.day < MENSES_RETENTION_DAYS + 1) continue;
    if (!groups.has(p.ph.start)) groups.set(p.ph.start, []);
    groups.get(p.ph.start).push(p);
  }
  const starts = [...groups.keys()].sort();
  const s = Math.max(isNum(sigma) ? sigma : 0, 0.1);
  for (let k = starts.length - 1; k >= 1; k--) {
    const sA = starts[k - 1];
    const sB = starts[k];
    if (diffDays(sB, today) > 70) break;
    if (diffDays(sA, sB) > 45) continue; // falta una regla entre medias: no son ciclos seguidos
    const A0 = groups.get(sA);
    const B0 = groups.get(sB);
    const dMax = Math.min(Math.max(...A0.map((p) => p.ph.day)), Math.max(...B0.map((p) => p.ph.day)));
    const A = A0.filter((p) => p.ph.day <= dMax);
    const B = B0.filter((p) => p.ph.day <= dMax);
    if (A.length < 2 || B.length < 2) continue;
    let slopes = [];
    for (const a of A) for (const b of B) if (Math.abs(a.ph.day - b.ph.day) <= 2) slopes.push((b.kg - a.kg) / (b.x - a.x));
    if (slopes.length < 3) {
      slopes = [];
      for (const a of A) for (const b of B) slopes.push((b.kg - a.kg) / (b.x - a.x));
    }
    const slope = median(slopes);
    const dt = meanOf(B.map((p) => p.x)) - meanOf(A.map((p) => p.x));
    if (!(dt > 0)) continue;
    const se = (1.2533 * s * Math.sqrt(1 / A.length + 1 / B.length)) / dt;
    return {
      rateKg: slope * 7, lo: (slope - Z * se) * 7, hi: (slope + Z * se) * 7,
      used: [...A, ...B].sort((a, b) => a.x - b.x), startA: sA, startB: sB,
      dayFrom: Math.min(...A.map((p) => p.ph.day), ...B.map((p) => p.ph.day)), dayTo: dMax,
      medA: median(A.map((p) => p.kg)), medB: median(B.map((p) => p.kg)), nA: A.length, nB: B.length, pairs: slopes.length,
    };
  }
  return null;
}

/**
 * Tendencia del peso: curva exponencial (≈ 10 días) y ritmo robusto (Theil–Sen) con su intervalo.
 * @param {{id:string, kg:number}[]} bodyweight pesajes (id = fecha)
 * @param {object} [opts]
 * @param {string} [opts.today] 'YYYY-MM-DD' (por defecto, hoy)
 * @param {object} [opts.profile] perfil (sexo y duraciones de ciclo por defecto)
 * @param {object|null} [opts.cycle] CycleInfo de un ciclo NATURAL (con anticonceptivo hormonal, pásalo null)
 * @param {number} [opts.windowDays] ventana base (por defecto 28; mujer, al menos un ciclo)
 * @returns {{ ok:boolean, reasonCode:null|'no_data'|'few_data'|'stale'|'noisy', reason:string,
 *   points:{date, kg, trendKg, retention?:'premenstrual'|'menstrual'}[], currentKg:number|null,
 *   ratePerWeekKg:number|null, ratePerWeekPct:number|null, windowDays:number, n:number,
 *   from:string|null, to:string|null, spanDays:number, extended:boolean,
 *   ci:{lo, hi}|null (kg/sem), ciPct:{lo, hi}|null, clear:boolean, direction:'up'|'down'|'stable'|null,
 *   noiseKg:number|null, method:'all'|'no-retention'|'phase'|null, excluded:string[] (fechas con retención fuera
 *   del cálculo), phaseCompare:{startA, startB, dayFrom, dayTo, medA, medB, nA, nB}|null, estimateKg:number|null,
 *   lastDate, lastKg, windowCount, windowSpan, partialCycle:boolean }}
 */
export function weightTrend(bodyweight, opts = {}) {
  const today = isDateStr(opts.today) ? opts.today : todayStr();
  const profile = opts.profile || {};
  const female = isFemale(profile);
  const cycle = female && opts.cycle && !opts.cycle.hormonal && opts.cycle.enabled !== false ? opts.cycle : null;
  const starts = periodStarts(cycle);
  const useCycle = !!cycle && starts.length > 0;
  const guessLen = clampN(Math.round(isNum(profile.cycleLengthGuess) ? profile.cycleLengthGuess : 28), 21, 45);
  const guessPer = clampN(Math.round(isNum(profile.periodLengthGuess) ? profile.periodLengthGuess : 5), 2, 10);

  const phaseOf = phaseFinder(useCycle ? cycle : null, { cycleLength: guessLen, periodLength: guessPer });
  const pts = cleanPoints(bodyweight, today).map((p) => {
    const ph = phaseOf(p.date);
    return { ...p, x: xOf(p.date), ph, retention: ph?.retention || null };
  });
  const tv = emaSeries(pts, { skip: (p) => !!p.retention });
  const points = pts.map((p, i) => {
    const o = { date: p.date, kg: p.kg, trendKg: r2(tv[i]) };
    if (p.retention) o.retention = p.retention;
    return o;
  });

  let baseDays = opts.windowDays > 0 ? Math.round(opts.windowDays) : WINDOW_DAYS;
  if (female && !(opts.windowDays > 0)) {
    const len = isNum(cycle?.avgCycle) && cycle.avgCycle > 0 ? Math.round(cycle.avgCycle) : guessLen;
    baseDays = clampN(Math.max(WINDOW_DAYS, len), WINDOW_DAYS, 42);
  }
  const last = pts.length ? pts[pts.length - 1] : null;
  const res = {
    ok: false, reasonCode: null, reason: '', points,
    currentKg: points.length ? points[points.length - 1].trendKg : null,
    ratePerWeekKg: null, ratePerWeekPct: null, windowDays: baseDays, n: 0,
    from: null, to: null, spanDays: 0, extended: false, ci: null, ciPct: null, clear: false, direction: null,
    noiseKg: null, method: null, excluded: [], phaseCompare: null, estimateKg: null,
    lastDate: last?.date ?? null, lastKg: last?.kg ?? null, windowCount: 0, windowSpan: 0, partialCycle: false,
  };
  const maxDays = Math.max(baseDays, MAX_WINDOW_DAYS);
  const recent = pts.filter((p) => p.date >= addDays(today, -(maxDays - 1)));
  res.windowCount = recent.length;
  res.windowSpan = spanOf(recent);
  const need = `Hacen falta al menos ${MIN_POINTS} pesajes repartidos en ${MIN_SPAN_DAYS} días o más`;
  if (!pts.length) return { ...res, reasonCode: 'no_data', reason: 'Aún no hay pesajes.' };
  if (diffDays(last.date, today) > STALE_DAYS) {
    return { ...res, reasonCode: 'stale', reason: `El último pesaje es del ${fmtDate(last.date, 'full')}: hace más de ${STALE_DAYS} días.` };
  }

  const candidates = [...new Set([baseDays, 42, MAX_WINDOW_DAYS].filter((d) => d >= baseDays))].sort((a, b) => a - b);
  const refKg = res.currentKg ?? last.kg;
  let chosen = null;
  for (const W of candidates) {
    const win = pts.filter((p) => p.date >= addDays(today, -(W - 1)));
    if (win.length < MIN_POINTS || spanOf(win) < MIN_SPAN_DAYS) continue;
    const fit = fitWindow(win, refKg);
    if (!fit) continue;
    chosen = { W, fit };
    const clear = fit.lo > 0 || fit.hi < 0;
    if (clear || ((fit.hi - fit.lo) / 2 / refKg) * 100 <= NOISY_HALF_PCT) break;
  }
  if (!chosen) {
    return { ...res, reasonCode: 'few_data', reason: `${need} (en las últimas ${Math.round(maxDays / 7)} semanas hay ${recent.length} en ${res.windowSpan} días).` };
  }

  let { rateKg, lo, hi, used, method } = chosen.fit;
  let excluded = chosen.fit.excluded;
  let phaseCompare = null;
  if (useCycle && starts.length >= 2) {
    const pm = phaseMatched(pts, today, chosen.fit.noise);
    if (pm) {
      ({ rateKg, lo, hi, used } = pm);
      method = 'phase';
      excluded = pts.filter((p) => p.retention && p.date >= pm.used[0].date);
      phaseCompare = { startA: pm.startA, startB: pm.startB, dayFrom: pm.dayFrom, dayTo: pm.dayTo, medA: r2(pm.medA), medB: r2(pm.medB), nA: pm.nA, nB: pm.nB };
    }
  }
  const pct = (rateKg / refKg) * 100;
  const clear = lo > 0 || hi < 0;
  const halfPct = ((hi - lo) / 2 / refKg) * 100;
  const out = {
    ...res,
    windowDays: method === 'phase' ? Math.max(chosen.W, diffDays(used[0].date, today) + 1) : chosen.W,
    extended: chosen.W > baseDays,
    n: used.length, from: used[0].date, to: used[used.length - 1].date, spanDays: spanOf(used),
    ci: { lo: r2(lo), hi: r2(hi) }, ciPct: { lo: r2((lo / refKg) * 100), hi: r2((hi / refKg) * 100) },
    clear, noiseKg: r2(chosen.fit.noise), method, excluded: excluded.map((p) => p.date), phaseCompare,
    estimateKg: r2(rateKg),
    partialCycle: female && !useCycle && spanOf(used) < 27,
  };
  if (!clear && halfPct > NOISY_HALF_PCT) {
    return {
      ...out, reasonCode: 'noisy',
      reason: `Los pesajes varían mucho (±${fmtNum(chosen.fit.noise, 1)} kg) y aún no se ve una tendencia clara: el margen del ritmo va de ${signedKgW(lo)} a ${signedKgW(hi)}.`,
    };
  }
  out.ok = true;
  out.ratePerWeekKg = r2(rateKg);
  out.ratePerWeekPct = r2(pct);
  out.direction = clear && Math.abs(pct) >= STABLE_PCT ? (rateKg > 0 ? 'up' : 'down') : 'stable';
  return out;
}

// ===========================================================================
// Rangos, estado, kcal y proteína
// ===========================================================================

/**
 * Rango recomendado para el perfil. Experiencia sin indicar → intermedio; sexo sin indicar → rangos de hombre.
 * @returns {{goal, minPct, maxPct, label, minKg, maxKg, sex, experience, experienceGuessed:boolean, basis,
 *   recommended:{minPct, maxPct, minKg, maxKg, label, reason:'endurance'|'female'}|null}|null} null sin objetivo.
 *   minPct ≤ maxPct con signo (perder grasa: −1 y −0,5). minKg/maxKg: lo mismo en kg/sem con el peso actual.
 */
export function targetFor(profile, { currentKg = null, enduranceHigh = false } = {}) {
  const goal = GOAL_IDS.includes(profile?.goal) ? profile.goal : null;
  if (!goal) return null;
  const female = isFemale(profile);
  const sex = female ? 'female' : 'male';
  const experience = EXP_IDS.includes(profile?.experience) ? profile.experience : 'intermediate';
  const range = goal === 'gain' ? TARGETS.gain[sex][experience] : TARGETS[goal].range;
  const kgw = (p) => (currentKg > 0 ? r2((currentKg * p) / 100) : null);
  const [minPct, maxPct] = range;
  let label;
  if (goal === 'gain') label = `subir ${pctRange(minPct, maxPct)} % por semana`;
  else if (goal === 'lose') label = `bajar ${pctRange(maxPct, minPct)} % por semana`;
  else if (goal === 'maintain') label = 'mantener: ±0,25 % por semana';
  else label = 'peso estable: ±0,25 % por semana';
  let recommended = null;
  if (goal === 'lose' && (enduranceHigh || female)) {
    const [a, b] = TARGETS.lose.lowerHalf;
    recommended = { minPct: a, maxPct: b, minKg: kgw(a), maxKg: kgw(b), label: `bajar ${pctRange(b, a)} % por semana`, reason: enduranceHigh ? 'endurance' : 'female' };
  }
  const expName = (female ? EXP_NAME_F : EXP_NAME)[experience];
  const basis = goal === 'gain' ? `${female ? 'mujer' : 'hombre'}, ${expName}${profile?.experience ? '' : ' (sin indicar)'}` : (female ? 'mujer' : 'hombre');
  return {
    goal, minPct, maxPct, label, minKg: kgw(minPct), maxKg: kgw(maxPct), sex, experience,
    experienceGuessed: !EXP_IDS.includes(profile?.experience), basis, recommended,
  };
}

/** 'below' | 'in' | 'above' del ritmo (%/sem con signo, redondeado a 2 decimales como se muestra) frente al rango. */
export function classifyRate(ratePct, target) {
  if (!target || !isNum(ratePct)) return null;
  const r = r2(ratePct);
  if (r < target.minPct - 1e-9) return 'below';
  if (r > target.maxPct + 1e-9) return 'above';
  return 'in';
}

/**
 * Ajuste de kcal/día para llevar el ritmo al rango (del borde al centro), con 7700 kcal/kg: redondeado a 50 kcal,
 * entre 100 y 500. Con signo: positivo = comer más. null si el ritmo ya está en el rango.
 * @param {number} ratePerWeekKg
 * @param {number} currentKg
 * @param {{minPct, maxPct}} band
 * @returns {{min:number, max:number}|null}
 */
export function kcalSuggestion(ratePerWeekKg, currentKg, band) {
  if (!isNum(ratePerWeekKg) || !(currentKg > 0) || !band) return null;
  const lo = (currentKg * band.minPct) / 100;
  const hi = (currentKg * band.maxPct) / 100;
  const mid = (lo + hi) / 2;
  const k = KCAL_PER_KG / 7;
  const r = ratePerWeekKg;
  let a;
  let b;
  let sign;
  const rp = r2((r / currentKg) * 100);
  if (rp < band.minPct - 1e-9) { a = (lo - r) * k; b = (mid - r) * k; sign = 1; }
  else if (rp > band.maxPct + 1e-9) { a = (r - hi) * k; b = (r - mid) * k; sign = -1; }
  else return null;
  let small = Math.max(MIN_KCAL, round(a, 50));
  let large = Math.max(small + 50, round(b, 50));
  if (large > MAX_KCAL) { large = MAX_KCAL; small = Math.min(small, MAX_KCAL - 150); }
  return sign > 0 ? { min: small, max: large } : { min: -large, max: -small };
}

/**
 * Proteína diaria orientativa: 1,6–2,2 g/kg (redondeado a 5 g). En déficit, `focus` = 2,0–2,2 g/kg o algo más.
 * @returns {{min, max, perKg:{min, max}, focus:{min, max}|null, refKg}}
 */
export function proteinFor(kg, deficit = false) {
  const ok = kg > 0;
  const f = (p) => (ok ? round(kg * p, 5) : null);
  return {
    min: f(PROTEIN_G_PER_KG.min), max: f(PROTEIN_G_PER_KG.max),
    perKg: { min: PROTEIN_G_PER_KG.min, max: PROTEIN_G_PER_KG.max },
    focus: deficit && ok ? { min: f(PROTEIN_G_PER_KG.deficit), max: f(PROTEIN_G_PER_KG.max) } : null,
    refKg: ok ? r2(kg) : null,
  };
}

/** Texto corto del estado, ya interpretado según el objetivo («Subes poco», «Bajas muy rápido», «Buen ritmo»…). */
export function paceLabel(goal, status, direction) {
  if (status === 'insufficient') return 'Faltan datos';
  const dirWord = direction === 'up' ? 'Subiendo' : direction === 'down' ? 'Bajando' : 'Estable';
  if (status === 'no_goal' || !goal) return dirWord;
  if (status === 'in') return goal === 'maintain' || goal === 'performance' ? 'Estable' : 'Buen ritmo';
  if (goal === 'gain') {
    if (status === 'above') return 'Subes rápido';
    return direction === 'up' ? 'Subes poco' : direction === 'down' ? 'Bajando' : 'Sin subir';
  }
  if (goal === 'lose') {
    if (status === 'below') return 'Bajas muy rápido';
    return direction === 'down' ? 'Bajas poco' : direction === 'up' ? 'Subiendo' : 'Sin bajar';
  }
  return status === 'above' ? 'Subiendo' : 'Bajando';
}

// ===========================================================================
// Textos comunes
// ===========================================================================

function kcalTxt(s) {
  if (!s) return '';
  const a = Math.min(Math.abs(s.min), Math.abs(s.max));
  const b = Math.max(Math.abs(s.min), Math.abs(s.max));
  return `${fmtNum(a, 0)}–${fmtNum(b, 0)} kcal ${s.max > 0 ? 'más' : 'menos'} al día`;
}
function foodMore(s) {
  const b = Math.max(Math.abs(s.min), Math.abs(s.max));
  if (b <= 200) return 'un yogur con un puñado de frutos secos';
  if (b <= 350) return 'un bocadillo o un batido';
  return 'un bocadillo y un batido';
}
const FOOD_LESS = 'por ejemplo, menos aceite, picoteo o bebidas azucaradas';

/** «Subes 0,3 kg por semana (0,4 % de tu peso)» / «Tu peso está estable» / «Subes unos 0,1 kg…» (sin dirección clara). */
function leadTxt(t) {
  const kg = t.ratePerWeekKg;
  const pct = t.ratePerWeekPct;
  if (t.direction === 'up' || t.direction === 'down') {
    return `${kg > 0 ? 'Subes' : 'Bajas'} ${kgAbs(kg)} kg por semana (${pctAbs(pct)} % de tu peso)`;
  }
  if (Math.abs(pct) < 0.15 || Math.abs(kg) < 0.05) return 'Tu peso está estable';
  return `${kg > 0 ? 'Subes' : 'Bajas'} unos ${kgAbs(kg)} kg por semana (${pctAbs(pct)} % de tu peso)`;
}
const HEDGE = ' Tus pesajes aún varían bastante: en 2–3 semanas se verá mejor.';
const needsHedge = (t) => t.direction === 'stable' && !(Math.abs(t.ratePerWeekPct) < 0.15 || Math.abs(t.ratePerWeekKg) < 0.05);

function trendRows(ctx) {
  const t = ctx.trend;
  const rows = [];
  if (t.ok) {
    rows.push({ label: 'Pesajes usados', value: `${t.n} · ${spanTxt(t.from, t.to)}` });
    rows.push({ label: 'Ventana', value: `${t.windowDays} días hasta hoy${t.extended ? ' (ampliada: pocos pesajes o mucho ruido)' : ''}` });
    rows.push({ label: 'Peso de tendencia', value: `${kgTxt(t.currentKg, 2)} (media exponencial ≈ ${EMA_TAU_DAYS} días)` });
    rows.push({ label: 'Último pesaje', value: `${kgTxt(t.lastKg)} · ${day(t.lastDate)}` });
    rows.push({ label: 'Ritmo (Theil–Sen)', value: `${signedKgW(t.ratePerWeekKg)} · ${signedPctW(t.ratePerWeekPct)}` });
    rows.push({ label: 'Margen (95 %)', value: `${signedKgW(t.ci.lo)} a ${signedKgW(t.ci.hi)}${t.clear ? '' : ' · incluye el 0: sin dirección clara'}` });
    rows.push({ label: 'Variación diaria típica', value: `±${fmtNum(t.noiseKg, 1)} kg alrededor de la tendencia` });
  } else if (t.points.length) {
    rows.push({ label: 'Pesajes recientes', value: `${t.windowCount} en ${t.windowSpan} días (mínimo ${MIN_POINTS} en ${MIN_SPAN_DAYS} días)` });
    rows.push({ label: 'Último pesaje', value: `${kgTxt(t.lastKg)} · ${fmtDate(t.lastDate, 'full')}` });
    if (t.reasonCode === 'noisy') rows.push({ label: 'Margen del ritmo', value: `${signedKgW(t.ci.lo)} a ${signedKgW(t.ci.hi)} (incluye el 0)` });
  } else {
    rows.push({ label: 'Pesajes', value: 'Ninguno todavía' });
  }
  if (ctx.female) {
    if (ctx.hormonal) rows.push({ label: 'Ciclo', value: 'Anticonceptivo hormonal: sin fases naturales; se usan todos los pesajes' });
    else if (ctx.cycle && periodStarts(ctx.cycle).length) {
      if (t.method === 'phase' && t.phaseCompare) {
        const pc = t.phaseCompare;
        rows.push({ label: 'Fases equivalentes', value: `días ${pc.dayFrom}–${pc.dayTo} de cada ciclo: ${kgTxt(pc.medA, 2)} (ciclo del ${day(pc.startA)}) → ${kgTxt(pc.medB, 2)} (ciclo del ${day(pc.startB)})` });
      }
      const ret = t.points.filter((p) => p.retention && (!t.from || p.date >= t.from));
      if (ret.length) {
        rows.push({
          label: 'Posible retención de líquidos',
          value: `${pesajes(ret.length)} (${listDates(ret.map((p) => p.date))})${t.excluded.length ? ' · fuera del ritmo' : ''}`,
        });
      }
    } else if (t.ok) {
      rows.push({ label: 'Ciclo', value: `Sin datos del ciclo: ventana de al menos un ciclo (${t.windowDays} días) para promediar la retención de líquidos` });
    }
  }
  return rows;
}

function methodRule(ctx) {
  const t = ctx.trend;
  let s = `Ritmo = pendiente robusta de Theil–Sen (la mediana de las pendientes entre cada par de pesajes: un día raro no la mueve) de tus pesajes de ${periodTxt(t.windowDays)}, en kg por semana y en % de tu peso de tendencia (media exponencial de ≈ ${EMA_TAU_DAYS} días). Si el margen del 95 % incluye el 0, se considera estable.`;
  if (t.method === 'phase') s += ' Con dos ciclos o más se comparan días equivalentes de cada ciclo (sin los de retención de líquidos).';
  else if (t.method === 'no-retention') s += ' Sin los días de posible retención de líquidos (5 previos a la regla y 3 primeros de la regla).';
  return s;
}

function insight(o) {
  const data = (o.data || []).filter(Boolean);
  const i = {
    id: o.id, area: 'weight', level: o.level, priority: o.priority, title: o.title, text: o.text,
    why: { rule: o.rule, data: data.length ? data : [{ label: 'Datos', value: 'Sin datos' }] },
    sources: (o.sources || []).filter(Boolean),
  };
  if (o.action) i.action = o.action;
  return i;
}

// ===========================================================================
// Insights
// ===========================================================================

function insufficientInsight(ctx) {
  const t = ctx.trend;
  const how = 'Pésate por la mañana, después de ir al baño y antes de desayunar, 3–4 veces por semana.';
  const noise = 'Es normal que el peso varíe 0,5–1,5 kg de un día a otro (agua, sal, comida): lo que cuenta es la tendencia.';
  const cyc = ctx.female && !ctx.hormonal ? ' En los días previos a la regla es normal pesar algo más por la retención de líquidos.' : '';
  let title;
  let text;
  if (t.reasonCode === 'no_data') {
    title = 'Empieza a pesarte';
    text = `Aún no hay pesajes. ${how} Con ${MIN_POINTS} pesajes en 2 semanas ya se ve tu tendencia. ${noise}${cyc}`;
  } else if (t.reasonCode === 'stale') {
    title = 'Hace tiempo que no te pesas';
    text = `Tu último pesaje es del ${fmtDate(t.lastDate, 'full')}. ${how} En 2 semanas verás cómo vas ahora. ${noise}${cyc}`;
  } else if (t.reasonCode === 'noisy') {
    title = 'Tus pesajes varían mucho';
    text = `Tus pesajes varían bastante de un día a otro (±${fmtNum(t.noiseKg, 1)} kg) y aún no se ve una tendencia clara. Pésate siempre en las mismas condiciones: por la mañana, después de ir al baño y antes de desayunar, 3–4 veces por semana. ${noise} En 2–3 semanas se verá.${cyc}`;
  } else {
    title = 'Aún faltan pesajes';
    const have = `Llevas ${pesajes(t.windowCount)} en ${t.windowSpan} ${t.windowSpan === 1 ? 'día' : 'días'}`;
    const missing = t.windowCount >= MIN_POINTS
      ? 'en cuanto abarquen 2 semanas se verá tu tendencia'
      : t.windowSpan >= MIN_SPAN_DAYS
        ? `con ${MIN_POINTS} ya se verá tu tendencia`
        : `con ${MIN_POINTS} en al menos 2 semanas ya se ve tu tendencia`;
    text = `${have}: ${missing}. ${how} ${noise}${cyc}`;
  }
  return insight({
    id: 'weight-insufficient', level: 'info', priority: 30, title, text,
    rule: `Para calcular un ritmo fiable hacen falta al menos ${MIN_POINTS} pesajes repartidos en ${MIN_SPAN_DAYS} días o más (ventana de hasta ${MAX_WINDOW_DAYS} días), el último de hace ${STALE_DAYS} días como mucho, y que el ruido deje ver una dirección (margen del ritmo ≤ ±${fmtNum(NOISY_HALF_PCT, 1)} % por semana si no hay una tendencia clara).`,
    data: trendRows(ctx),
    sources: ctx.female && !ctx.hormonal ? [SOURCES.white2011] : [],
  });
}

function noGoalInsight(ctx) {
  const t = ctx.trend;
  const action = { label: 'Elegir objetivo', href: '#/settings/profile' };
  if (!t.ok) {
    return insight({
      id: 'weight-no-goal', level: 'neutral', priority: 45, title: 'Elige tu objetivo',
      text: 'Elige en tu perfil si quieres ganar músculo, perder grasa, mantener o rendir: cuando haya pesajes suficientes te diré si vas a buen ritmo para ti.',
      rule: 'Sin objetivo en el perfil no hay rango con el que comparar tu ritmo.',
      data: [{ label: 'Objetivo', value: 'Sin elegir' }, ...trendRows(ctx)], sources: [], action,
    });
  }
  const lead = leadTxt(t);
  const kcal = ctx.kcal?.estimate;
  return insight({
    id: 'weight-no-goal', level: 'neutral', priority: 45, title: 'Elige tu objetivo para valorar tu peso',
    text: `${lead} en ${periodTxt(t.windowDays)}.${needsHedge(t) ? HEDGE : ''} Elige en tu perfil si quieres ganar músculo, perder grasa, mantener o rendir y te diré si es buen ritmo para ti.`,
    rule: `${methodRule(ctx)} Sin objetivo en el perfil no hay rango con el que compararlo.`,
    data: [
      { label: 'Objetivo', value: 'Sin elegir' },
      ...trendRows(ctx),
      isNum(kcal) ? { label: 'Balance estimado', value: `${signedKgW(t.ratePerWeekKg)} × 7700 / 7 ≈ ${sgn(kcal)}${fmtNum(Math.abs(kcal), 0)} kcal/día` } : null,
    ],
    sources: isNum(kcal) ? [SOURCES.hall2008] : [], action,
  });
}

function rateInsight(ctx) {
  const { trend: t, target, status, goal, kcal, endHigh, minutes, female } = ctx;
  const sug = kcal.suggestion;
  const lead = leadTxt(t);
  const hedge = needsHedge(t) ? HEDGE : '';
  const partial = t.partialCycle ? ' Aún no tienes un ciclo completo de pesajes: la retención de líquidos puede mover algo este ritmo.' : '';
  const rP = pctRange(target.minPct, target.maxPct);
  const rK = kgRange(target.minKg, target.maxKg);
  const rec = target.recommended;
  let level = 'warn';
  let priority = 66;
  let title;
  let text;
  let src = [];
  if (goal === 'gain') {
    src = [SOURCES.iraki2019, female ? SOURCES.roberts2020 : null];
    if (status === 'in') {
      level = 'good'; priority = 50;
      title = t.direction === 'up' ? 'Subes a buen ritmo' : 'Parece que vas bien';
      text = `${lead}: dentro del rango para ganar músculo con poca grasa (${rP} %). Si en el espejo no notas que acumulas grasa, vas bien.${hedge}`;
    } else if (status === 'below') {
      const extra = endHigh ? ` Con unas ${hoursTxt(minutes)} h de resistencia a la semana gastas mucho: es fácil quedarse corto de comida.` : '';
      const eat = `Prueba a comer unas ${kcalTxt(sug)} (${foodMore(sug)}) y revisa en 3 semanas.`;
      if (t.direction === 'up') {
        title = 'Subes poco para ganar músculo';
        text = `Subes muy poco para ganar músculo (${kgAbs(t.ratePerWeekKg)} kg/sem; lo recomendado es ${rP} % de tu peso, unos ${rK} kg/sem). ${eat}${extra}`;
      } else if (t.direction === 'down') {
        title = 'Estás bajando de peso';
        text = `${lead} y tu objetivo es ganar músculo, que necesita subir ${rP} % por semana (unos ${rK} kg). ${eat}${extra}`;
      } else {
        title = 'Tu peso no sube';
        text = `${lead} y para ganar músculo conviene subir ${rP} % por semana (unos ${rK} kg). ${eat}${extra}${hedge}`;
      }
    } else {
      priority = 64;
      title = 'Subes más rápido de lo necesario';
      text = `${lead}: más rápido de lo necesario para ganar músculo (${rP} %); lo que sobra suele ser grasa. Prueba a comer unas ${kcalTxt(sug)} (${FOOD_LESS}) y revisa en 3 semanas.`;
    }
  } else if (goal === 'lose') {
    src = [SOURCES.helms2014, rec || status === 'below' ? SOURCES.garthe2011 : null];
    const why = rec?.reason === 'endurance' ? 'con tanto entrenamiento de resistencia' : 'para cuidar tu energía y tu ciclo';
    if (ctx.reds?.id === 'weight-reds-cycle' && status !== 'below') {
      // Con regla alterada + pérdida o mucha resistencia no se anima a seguir bajando (ni a comer menos).
      level = 'neutral'; priority = 60;
      title = 'Ahora no conviene seguir bajando';
      text = `${lead}${status === 'in' ? ', dentro del rango para perder grasa (0,5–1 %)' : ''}, pero con las señales de energía baja que ves en el aviso, ahora es mejor no seguir bajando: come algo más y, cuando todo se normalice, retoma la pérdida despacio.`;
      src = [SOURCES.helms2014, SOURCES.mountjoy2023];
    } else if (status === 'in') {
      if (rec && t.ratePerWeekPct < rec.minPct - 1e-9) {
        level = 'neutral'; priority = 55;
        title = 'Bajas bien, pero algo rápido';
        text = `${lead}: dentro del rango para perder grasa conservando músculo (0,5–1 %), pero ${why} te conviene la mitad baja (${pctRange(rec.maxPct, rec.minPct)} %). Come un poco más: unas ${kcalTxt(sug)}.`;
      } else {
        level = 'good'; priority = 50;
        title = t.direction === 'down' ? 'Bajas a buen ritmo' : 'Parece que vas bien';
        text = `${lead}: dentro del rango para perder grasa conservando músculo (0,5–1 %${rec ? `; para ti, mejor ${pctRange(rec.maxPct, rec.minPct)} %` : ''}). Mantén la proteína alta y el entrenamiento de fuerza.${hedge}`;
      }
    } else if (status === 'below') {
      priority = 70;
      title = 'Bajas demasiado rápido';
      text = `Bajas ${pctAbs(t.ratePerWeekPct)} % de tu peso por semana (${kgAbs(t.ratePerWeekKg)} kg): más rápido de lo recomendado para conservar músculo (0,5–1 %${rec ? `; para ti, mejor ${pctRange(rec.maxPct, rec.minPct)} %` : ''}). Sube un poco lo que comes: unas ${kcalTxt(sug)}.`;
    } else {
      priority = 64;
      const eat = `Prueba a comer unas ${kcalTxt(sug)} (${FOOD_LESS}) o a moverte algo más, y revisa en 3 semanas.`;
      const band = rec || target;
      const bP = pctRange(band.maxPct, band.minPct);
      const bK = kgRange(band.maxKg, band.minKg);
      if (t.direction === 'down') {
        title = 'Bajas poco';
        text = `Bajas muy poco para perder grasa (${kgAbs(t.ratePerWeekKg)} kg/sem; lo recomendado es ${bP} % de tu peso, unos ${bK} kg/sem). ${eat}`;
      } else if (t.direction === 'up') {
        title = 'Estás subiendo de peso';
        text = `${lead} y tu objetivo es perder grasa (bajar ${bP} % por semana, unos ${bK} kg). ${eat}`;
      } else {
        title = 'Tu peso no baja';
        text = `${lead} y para perder grasa conviene bajar ${bP} % por semana (unos ${bK} kg). ${eat}${hedge}`;
      }
    }
  } else {
    const perf = goal === 'performance';
    src = [perf ? SOURCES.mountjoy2023 : null];
    if (status === 'in') {
      level = 'good'; priority = 48;
      title = 'Peso estable';
      const tail = perf
        ? 'bien para rendir. Sigue comiendo lo suficiente para entrenar y recuperarte.'
        : 'justo lo que buscas para mantener.';
      text = lead === 'Tu peso está estable'
        ? `Tu peso está estable en ${periodTxt(t.windowDays)}: ${tail}`
        : `${lead}: dentro de lo normal para ${perf ? 'rendir' : 'mantener'} (±0,25 %); ${tail}${hedge}`;
    } else if (status === 'above') {
      priority = 62;
      title = 'Tu peso sube';
      text = `${lead}: más de lo que encaja con ${perf ? 'un peso estable para rendir' : 'mantener'} (±0,25 %). Si no buscas subir, recorta unas ${kcalTxt(sug).replace(' menos', '')} (${FOOD_LESS}); si subes a propósito para ganar músculo, cambia tu objetivo en el perfil.${hedge}`;
    } else {
      priority = 64;
      title = 'Tu peso baja';
      const more = perf
        ? `Para rendir, comer por debajo de lo que gastas pasa factura: come unas ${kcalTxt(sug)}${endHigh ? ', sobre todo los días de entrenos largos' : ''}.`
        : `Come algo más: unas ${kcalTxt(sug)}${endHigh ? ', sobre todo los días de entrenos largos' : ''}.`;
      text = `${lead}: más de lo que encaja con ${perf ? 'un peso estable para rendir' : 'mantener'} (±0,25 %). ${more}${hedge}`;
    }
  }
  if (partial) text += partial;
  const kc = kcal.estimate;
  const rule = `${methodRule(ctx)} Rango para ${GOAL_NAME[goal]} (${target.basis}): ${target.label}${rec ? `; recomendado ${rec.label} (${rec.reason === 'endurance' ? 'mucha resistencia' : 'mujer'})` : ''}. Balance ≈ ritmo × 7700 / 7 kcal/día (aproximación); el ajuste lleva el ritmo del borde al centro del rango.`;
  return insight({
    id: 'weight-rate', level, priority, title, text, rule,
    data: [
      { label: 'Objetivo', value: `${cap(GOAL_NAME[goal])} (${target.basis})` },
      { label: 'Rango', value: `${target.label} = ${rangeKgTxt(target)} kg/sem` },
      rec ? { label: 'Recomendado para ti', value: `${rec.label} = ${kgRange(rec.maxKg, rec.minKg)} kg/sem` } : null,
      ...trendRows(ctx),
      { label: 'Estado', value: paceLabel(goal, status, t.direction) },
      isNum(kc) ? { label: 'Balance estimado', value: `${signedKgW(t.ratePerWeekKg)} × 7700 / 7 ≈ ${sgn(kc)}${fmtNum(Math.abs(kc), 0)} kcal/día` } : null,
      sug ? { label: 'Ajuste sugerido', value: `${kcalTxt(sug)} (${sug.max > 0 ? '+' : '−'}${fmtNum(Math.min(Math.abs(sug.min), Math.abs(sug.max)), 0)} a ${sug.max > 0 ? '+' : '−'}${fmtNum(Math.max(Math.abs(sug.min), Math.abs(sug.max)), 0)} kcal/día)` } : null,
      endHigh ? { label: 'Resistencia', value: `${fmtNum(minutes, 0)} min/sem de media (4 semanas)` } : null,
    ],
    sources: [...src, sug || isNum(kc) ? SOURCES.hall2008 : null],
  });
}

function validStrength(s) {
  if (!s || !isNum(s.trendPctPerWeek)) return null;
  if (s.n != null && !(s.n >= 1)) return null;
  return { trendPctPerWeek: s.trendPctPerWeek, n: s.n ?? null };
}
const STRENGTH_GOOD = { beginner: 0.75, intermediate: 0.25, advanced: 0.1 };

function strengthInsight(ctx) {
  const { trend: t, strength, profile, goal, female, kcal } = ctx;
  if (!t.ok || !strength) return null;
  const exp = EXP_IDS.includes(profile.experience) ? profile.experience : 'intermediate';
  const s = strength.trendPctPerWeek;
  const sUp = s >= STRENGTH_GOOD[exp];
  const sDown = s <= -0.25;
  const sTxt = `${signedPctW(s)} de 1RM estimado`;
  const gainMax = TARGETS.gain[female ? 'female' : 'male'][exp][1];
  const up = t.direction === 'up';
  const down = t.direction === 'down';
  const rows = [
    { label: 'Ritmo del peso', value: `${signedKgW(t.ratePerWeekKg)} · ${signedPctW(t.ratePerWeekPct)}` },
    { label: 'Tendencia de la fuerza', value: `${sTxt}${strength.n ? ` (mediana de ${strength.n} ${strength.n === 1 ? 'ejercicio' : 'ejercicios'})` : ''}` },
    { label: 'Umbral «la fuerza sube»', value: `≥ ${fmtNum(STRENGTH_GOOD[exp], 2)} %/sem (${(female ? EXP_NAME_F : EXP_NAME)[exp]}) · baja ≤ −0,25 %/sem` },
  ];
  const rule = `Cruce del ritmo del peso con la tendencia de la fuerza (mejor 1RM estimado de tus ejercicios principales). Peso ↑ y fuerza ↑ → sobre todo músculo; peso ↑ más rápido que ${fmtNum(gainMax, 2)} %/sem con la fuerza plana → probablemente más grasa; peso ↓ y fuerza ↓ → déficit demasiado agresivo. No se ve el espejo ni el % de grasa: son pistas.`;
  const mk = (o) => insight({ id: 'weight-strength', rule, data: rows, ...o });
  if (up && sUp) {
    return mk({
      level: 'good', priority: 40, title: 'Peso y fuerza suben juntos',
      text: `Tu fuerza también sube (${signedPctW(s)}): buena señal de que lo que ganas es sobre todo músculo.`,
      sources: [SOURCES.iraki2019],
    });
  }
  if (up && !sUp && t.ratePerWeekPct > gainMax) {
    const cut = kcal?.suggestion && kcal.suggestion.max < 0 ? kcal.suggestion : { min: -300, max: -200 };
    return mk({
      level: 'warn', priority: 60, title: 'Subes rápido y la fuerza no acompaña',
      text: `Tu peso sube ${kgAbs(t.ratePerWeekKg)} kg por semana pero tu fuerza está ${sDown ? 'bajando' : 'estancada'} (${signedPctW(s)}): probablemente estés ganando más grasa que músculo. Come unas ${kcalTxt(cut)} y revisa que el entrenamiento progrese (más repeticiones o más peso).`,
      sources: [SOURCES.iraki2019, SOURCES.hall2008],
    });
  }
  if (up && !sUp) {
    return mk({
      level: 'neutral', priority: 38, title: 'Tu peso sube, tu fuerza aún no',
      text: `Tu peso sube pero tu fuerza aún no acompaña (${signedPctW(s)}). Revisa que el entrenamiento progrese (más repeticiones o más peso) y dale unas semanas; si sigue igual, puede que estés ganando más grasa que músculo.`,
      sources: [SOURCES.iraki2019],
    });
  }
  if (down && sDown) {
    return mk({
      level: 'warn', priority: 62, title: 'Bajas peso y pierdes fuerza',
      text: `Bajas ${kgAbs(t.ratePerWeekKg)} kg por semana y tu fuerza también baja (${signedPctW(s)}): señal de un déficit demasiado agresivo. Come algo más, mantén la proteína alta y sigue entrenando pesado para conservar el músculo.`,
      sources: [SOURCES.helms2014, SOURCES.garthe2011],
    });
  }
  if (down) {
    return mk({
      level: 'good', priority: 40, title: 'Bajas peso y conservas la fuerza',
      text: `Bajas ${kgAbs(t.ratePerWeekKg)} kg por semana y tu fuerza se mantiene${sUp ? ' e incluso sube' : ''} (${signedPctW(s)}): buena señal de que conservas el músculo.`,
      sources: [SOURCES.helms2014, SOURCES.garthe2011],
    });
  }
  if (sUp) {
    return mk({
      level: 'good', priority: 36, title: 'Peso estable y más fuerza',
      text: goal === 'gain'
        ? `Aunque tu peso apenas se mueve, tu fuerza sube (${signedPctW(s)}): buena señal. Para ganar músculo más rápido, come algo más.`
        : `Tu peso se mantiene y tu fuerza sube (${signedPctW(s)}): estás ganando fuerza sin ganar peso.`,
      sources: [SOURCES.iraki2019],
    });
  }
  return null;
}

function retentionInsight(ctx) {
  const { trend: t, female, cycle, today, profile } = ctx;
  if (!female || !cycle || !t.points.length) return null;
  const last = t.points[t.points.length - 1];
  if (!last.retention || diffDays(last.date, today) > 3) return null;
  const guessLen = clampN(Math.round(isNum(profile.cycleLengthGuess) ? profile.cycleLengthGuess : 28), 21, 45);
  const ph = cyclePhaseFor(cycle, last.date, { cycleLength: guessLen });
  const dev = isNum(last.trendKg) ? last.kg - last.trendKg : null;
  const devTxt = dev != null && dev >= 0.3 ? ` Tu último pesaje (${kgTxt(last.kg)}) está ${kgTxt(dev)} por encima de tu tendencia.` : '';
  const excl = t.excluded.includes(last.date) || t.method === 'phase' || t.method === 'no-retention';
  const tail = excl ? ' Tu ritmo se calcula sin estos días, así que este pico no cuenta como subida.' : ' Es un pico pasajero: no lo tomes como una subida.';
  const text = last.retention === 'premenstrual'
    ? `Es normal que ahora peses algo más: estás en los días previos a la regla${ph?.estimated ? ' (según tu ciclo estimado)' : ''} y el cuerpo retiene líquidos (suele ser entre 0,5 y 2 kg, y se va en unos días).${devTxt}${tail}`
    : `Es normal que estos días peses algo más: en los primeros días de la regla es cuando más líquido se retiene (suele irse en unos días).${devTxt}${tail}`;
  const inWin = t.points.filter((p) => p.retention && (!t.from || p.date >= t.from)).map((p) => p.date);
  return insight({
    id: 'weight-cycle-retention', level: 'info', priority: 42, title: 'Posible retención de líquidos', text,
    rule: `Días de posible retención de líquidos: los ${PRE_DAYS} previos a la regla (fase lútea tardía) y los ${MENSES_RETENTION_DAYS} primeros de la regla, estimados con tus reglas registradas${isNum(cycle.avgCycle) ? ` (ciclo medio de ${fmtNum(cycle.avgCycle, 0)} días)` : ''}. Se marcan como posible retención, no mueven tu tendencia y no cuentan para el ritmo.`,
    data: [
      { label: 'Último pesaje', value: `${kgTxt(last.kg)} · ${day(last.date)}` },
      ph ? { label: 'Día del ciclo', value: `día ${ph.day} de ~${ph.length} (${ph.phaseLabel}${ph.estimated ? ', estimada' : ''})` } : null,
      isNum(last.trendKg) ? { label: 'Tendencia', value: kgTxt(last.trendKg, 2) } : null,
      dev != null ? { label: 'Diferencia', value: `${sgn(r2(dev))}${fmtNum(Math.abs(dev), 1)} kg` } : null,
      inWin.length ? { label: 'Pesajes marcados', value: listDates(inWin, 6) } : null,
    ],
    sources: [SOURCES.white2011],
  });
}

function redsInsight(ctx) {
  const { trend: t, female, endHigh, minutes, cyc, goal, profile } = ctx; // profile: textos con g()
  const down = t.ok && t.direction === 'down';
  const pct = t.ok ? t.ratePerWeekPct : null;
  const fastThr = FAST_LOSS_PCT[female ? 'female' : 'male'];
  const fast = down && pct <= -fastThr;
  const lossEnd = down && endHigh && (female || pct <= -0.2);
  const hTxt = minutes != null ? `unas ${hoursTxt(minutes)} h` : '';
  const rows = [
    t.ok ? { label: 'Ritmo del peso', value: `${signedKgW(t.ratePerWeekKg)} · ${signedPctW(pct)}` } : { label: 'Ritmo del peso', value: 'Sin datos suficientes' },
    minutes != null ? { label: 'Resistencia', value: `${fmtNum(minutes, 0)} min/sem de media en 4 semanas (mucha: ≥ ${HIGH_ENDURANCE_MIN[female ? 'female' : 'male']})` } : null,
    { label: 'Pérdida rápida', value: `más de ${fmtNum(fastThr, 2)} % por semana${female ? ' (umbral más prudente en mujer)' : ''}` },
  ];
  if (female && cyc?.flagged && (down || endHigh)) {
    const late = cyc.absent
      ? `no te viene la regla desde hace ${cyc.sinceDays} días`
      : cyc.lateDays > LATE_DAYS ? `la regla se te retrasa ${cyc.lateDays} días`
        : cyc.longCycles ? `tus reglas vienen muy espaciadas (ciclos de unos ${fmtNum(cyc.avgCycle, 0)} días)`
          : 'tu ciclo muestra reglas retrasadas o ausentes';
    const what = down && endHigh
      ? `estás bajando de peso (${kgAbs(t.ratePerWeekKg)} kg por semana) con mucho entrenamiento de resistencia (${hTxt} a la semana)`
      : down ? `estás bajando de peso (${kgAbs(t.ratePerWeekKg)} kg por semana)` : `entrenas mucha resistencia (${hTxt} a la semana)`;
    return insight({
      id: 'weight-reds-cycle', level: 'warn', priority: 95, title: 'Atención: posible energía baja',
      text: `${cap(late)} y ${what}. Puede ser una señal de energía baja (REDs): cuando comes menos de lo que gastas, el cuerpo ahorra energía y la regla es de lo primero que se resiente. Si puede haber embarazo, haz un test. Si no, consúltalo con tu médico o en ginecología y, si puedes, con un dietista-nutricionista deportivo. Mientras tanto, no busques bajar peso y come más los días de entreno.`,
      rule: `Energía baja (REDs): reglas retrasadas (> ${LATE_DAYS} días), muy espaciadas (ciclos > ${LONG_CYCLE_DAYS} días) o ausentes (≥ ${AMENORRHEA_DAYS} días) junto con pérdida de peso o mucho entrenamiento de resistencia son una señal clave; conviene valoración profesional. Orientativo, no es un diagnóstico.`,
      data: [
        cyc.lastStart ? { label: 'Última regla', value: `${fmtDate(cyc.lastStart, 'full')} (hace ${cyc.sinceDays} días)` } : null,
        cyc.lateDays > 0 ? { label: 'Retraso', value: `${cyc.lateDays} días` } : null,
        cyc.alerts.length ? { label: 'Alertas del ciclo', value: cyc.alerts.join(' · ') } : null,
        ...rows,
      ],
      sources: [SOURCES.mountjoy2023, SOURCES.munro2018],
    });
  }
  const signs = `cansancio que no se va, peor sueño y recuperación, más lesiones o peor rendimiento${female ? ', y cambios en la regla' : ''}`;
  const rule = `Energía baja (REDs): perder más de ${fmtNum(fastThr, 2)} % del peso por semana, o perder peso con mucho entrenamiento de resistencia (≥ ${HIGH_ENDURANCE_MIN[female ? 'female' : 'male']} min/sem), aumenta el riesgo de comer menos de lo que el cuerpo necesita. Orientativo, no es un diagnóstico.`;
  if (fast) {
    const veryFast = pct <= -FAST_LOSS_PCT.male;
    return insight({
      id: 'weight-reds', level: 'warn', priority: veryFast ? 88 : 82,
      title: veryFast ? 'Bajas muy rápido: cuidado con la energía' : 'Bajas algo rápido: cuida tu energía',
      text: veryFast
        ? `Bajas ${pctAbs(pct)} % de tu peso por semana. A este ritmo es fácil quedarse en energía baja (REDs): ${signs}. Come más hasta bajar a un ritmo de 0,5–${female || endHigh ? '0,75' : '1'} % por semana y, si notas esas señales, consulta con un profesional sanitario.`
        : `Bajas ${pctAbs(pct)} % de tu peso por semana: en una mujer que entrena, por encima de 0,75 % sube el riesgo de energía baja (REDs): ${signs}. Come un poco más hasta bajar a 0,5–0,75 % por semana y, si notas esas señales, consulta con un profesional sanitario.`,
      rule, data: rows, sources: [SOURCES.mountjoy2023, SOURCES.garthe2011],
    });
  }
  if (lossEnd) {
    const intended = goal === 'lose';
    return insight({
      id: 'weight-reds', level: 'warn', priority: intended ? 80 : 85,
      title: intended ? 'Pierdes grasa entrenando mucho: vigila la energía' : 'Pierdes peso con mucho entrenamiento',
      text: intended
        ? `Bajas ${kgAbs(t.ratePerWeekKg)} kg por semana mientras haces ${hTxt} de resistencia a la semana. Para no quedarte sin energía (REDs), no bajes más rápido de 0,5–0,75 % por semana, come bien antes y después de los entrenos largos y para si notas ${signs}.`
        : `Bajas ${kgAbs(t.ratePerWeekKg)} kg por semana ${goal ? 'sin buscarlo ' : ''}y entrenas ${hTxt} de resistencia a la semana: probablemente comes menos de lo que gastas. Mantenido, eso lleva a energía baja (REDs): ${signs}. Come más, sobre todo hidratos y proteína alrededor de los entrenos largos; si te notas ${g(profile, 'cansado', 'cansada')} a menudo, consulta con un profesional sanitario.`,
      rule, data: rows, sources: [SOURCES.mountjoy2023, intended ? SOURCES.garthe2011 : null],
    });
  }
  return null;
}

function proteinInsight(ctx) {
  const p = ctx.proteinG;
  if (!isNum(p.min)) return null;
  const deficit = !!p.focus;
  return insight({
    id: 'weight-protein', level: 'info', priority: deficit ? 28 : 20, title: 'Proteína para tu peso',
    text: `Para tu peso (${kgTxt(p.refKg)}), apunta a unos ${fmtNum(p.min, 0)}–${fmtNum(p.max, 0)} g de proteína al día (1,6–2,2 g por kilo), repartidos en 3–5 comidas.${deficit ? ` Como estás en déficit, mejor en la parte alta: unos ${fmtNum(p.focus.min, 0)}–${fmtNum(p.focus.max, 0)} g o algo más, para conservar el músculo.` : ''}`,
    rule: 'Proteína diaria orientativa = peso × 1,6–2,2 g/kg (en déficit, hacia la parte alta o algo más). La misma recomendación para mujeres y hombres. No se registra la comida: es una referencia.',
    data: [
      { label: 'Peso de referencia', value: `${kgTxt(p.refKg, 2)} (tendencia)` },
      { label: 'Cálculo', value: `${fmtNum(p.refKg, 1)} × 1,6 ≈ ${fmtNum(p.min, 0)} g · ${fmtNum(p.refKg, 1)} × 2,2 ≈ ${fmtNum(p.max, 0)} g` },
      deficit ? { label: 'En déficit', value: `${fmtNum(p.refKg, 1)} × 2,0–2,2 ≈ ${fmtNum(p.focus.min, 0)}–${fmtNum(p.focus.max, 0)} g` } : null,
    ],
    sources: [SOURCES.morton2018, SOURCES.jager2017, deficit ? SOURCES.helms2014 : null],
  });
}

function suggestGoal(ctx) {
  const { trend: t, target, status, goal, today } = ctx;
  if (!t.ok || !target || !(t.currentKg > 0)) return null;
  const cur = t.currentKg;
  const mk = (targetKg, band, dir) => {
    const gap = Math.abs(targetKg - cur);
    const fast = (cur * Math.max(Math.abs(band.minPct), Math.abs(band.maxPct))) / 100;
    const slow = (cur * Math.min(Math.abs(band.minPct), Math.abs(band.maxPct))) / 100;
    const byFrom = addDays(today, Math.max(7, Math.round((gap / fast) * 7)));
    const byTo = addDays(today, Math.max(14, Math.round((gap / slow) * 7)));
    const title = `Llegar a ${fmtNum(targetKg, 1)} kg`;
    return {
      targetKg, byFrom, byTo, title, direction: dir,
      href: `#/goal/new?kind=bodyweight&target=${targetKg}&direction=${dir}`,
      text: `Al ritmo recomendado (${kgRange(Math.min(fast, slow), Math.max(fast, slow))} kg por semana) llegarías ${dateRangeTxt(byFrom, byTo, today)}.`,
    };
  };
  if (goal === 'gain' && (status === 'below' || status === 'in')) {
    const mid = (target.minPct + target.maxPct) / 2;
    let targetKg = roundHalf(cur * (1 + (mid / 100) * GOAL_WEEKS.gain));
    if (targetKg - cur < 1) targetKg = roundHalf(cur + 1);
    return mk(targetKg, target, 'up');
  }
  if (goal === 'lose' && (status === 'in' || status === 'above') && !ctx.strengthWarn) {
    const band = target.recommended || target;
    const mid = Math.abs((band.minPct + band.maxPct) / 2);
    let targetKg = roundHalf(cur * (1 - (mid / 100) * GOAL_WEEKS.lose));
    if (cur - targetKg < 1) targetKg = roundHalf(cur - 1);
    return mk(targetKg, band, 'down');
  }
  return null;
}

// ===========================================================================
// Análisis
// ===========================================================================

/**
 * Análisis del peso («tu analista»). PURO.
 * @param {object} input { bodyweight, today, profile, strength?, endurance?, cycle? } (ver cabecera)
 * @returns {{ ok:boolean, reason?:string, reasonCode?:string, trend:object (ver weightTrend), target:object|null
 *   (ver targetFor), status:'below'|'in'|'above'|'insufficient'|'no_goal', paceLabel:string,
 *   kcalPerDay:{ estimate:number|null, suggestion:{min, max}|null }, proteinG:{ min, max, perKg, focus, refKg },
 *   insights:Insight[] (ordenados por prioridad, de mayor a menor),
 *   goalSuggestion?:{ targetKg, byFrom, byTo, title, direction:'up'|'down', href, text } }}
 *   Extras respecto al contrato: reasonCode, paceLabel, trend.{from, to, spanDays, ci, ciPct, clear, direction,
 *   noiseKg, method, excluded, phaseCompare, …}, points[].retention, target.{minKg, maxKg, recommended, basis…},
 *   proteinG.{perKg, focus, refKg}, goalSuggestion.{direction, href, text}.
 */
export function analyzeWeight(input = {}) {
  const today = isDateStr(input.today) ? input.today : todayStr();
  const profile = { ...(input.profile || {}) };
  const female = isFemale(profile);
  const rawCycle = female && input.cycle && input.cycle.enabled !== false ? input.cycle : null;
  const hormonal = female && (isHormonal(profile) || !!rawCycle?.hormonal);
  const cycle = rawCycle && !hormonal ? rawCycle : null;
  const goal = GOAL_IDS.includes(profile.goal) ? profile.goal : null;
  const trend = weightTrend(input.bodyweight, { today, profile, cycle });
  const minutes = isNum(input.endurance?.weeklyMinutes4w) && input.endurance.weeklyMinutes4w >= 0 ? input.endurance.weeklyMinutes4w : null;
  const endHigh = minutes != null && minutes >= HIGH_ENDURANCE_MIN[female ? 'female' : 'male'];
  const refKg = trend.currentKg ?? trend.lastKg ?? null;
  const target = goal ? targetFor(profile, { currentKg: refKg, enduranceHigh: endHigh }) : null;
  const deficit = goal === 'lose' || (trend.ok && trend.ratePerWeekPct <= -0.25);
  const ctx = {
    today, profile, female, hormonal, cycle, goal, trend, target, minutes, endHigh,
    proteinG: proteinFor(refKg, deficit), cyc: cycle ? cycleIrregularity(cycle, today) : null,
    strength: validStrength(input.strength), status: null, kcal: { estimate: null, suggestion: null },
  };
  const insights = [];
  const reds = redsInsight(ctx);
  ctx.reds = reds;
  if (reds) insights.push(reds);
  if (!trend.ok) {
    ctx.status = 'insufficient';
    insights.push(insufficientInsight(ctx));
    if (!goal) insights.push(noGoalInsight(ctx));
  } else {
    ctx.kcal.estimate = round((trend.ratePerWeekKg * KCAL_PER_KG) / 7, 10);
    if (goal) {
      ctx.status = classifyRate(trend.ratePerWeekPct, target);
      ctx.kcal.suggestion = kcalSuggestion(trend.ratePerWeekKg, refKg, target.recommended || target);
      insights.push(rateInsight(ctx));
    } else {
      ctx.status = 'no_goal';
      insights.push(noGoalInsight(ctx));
    }
    const si = strengthInsight(ctx);
    if (si) insights.push(si);
    ctx.strengthWarn = si?.level === 'warn';
  }
  const ret = retentionInsight(ctx);
  if (ret) insights.push(ret);
  const prot = proteinInsight(ctx);
  if (prot) insights.push(prot);
  insights.sort((a, b) => b.priority - a.priority);

  const out = {
    ok: trend.ok, trend, target, status: ctx.status, paceLabel: paceLabel(goal, ctx.status, trend.direction),
    kcalPerDay: ctx.kcal, proteinG: ctx.proteinG, insights,
  };
  if (!trend.ok) { out.reason = trend.reason; out.reasonCode = trend.reasonCode; }
  const gs = reds ? null : suggestGoal(ctx);
  if (gs) out.goalSuggestion = gs;
  return out;
}
