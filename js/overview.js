// overview.js — portada de Progreso (docs/PULIDO.md §7): cuatro filas —Fuerza, Resistencia, Cuerpo y Recuperación—
// con su cifra clave, el cambio reciente, una minigráfica de las últimas semanas y a dónde ir para ver el detalle.
// PURO y sin cálculos propios: reutiliza las series semanales de stats.weeklySeries y el resultado del analista
// (analysis.buildAnalysis, que ya está en caché). Pruebas: tests/unit/overview.test.mjs.
//
// SALIDA progressOverview({ weeks, analysis, bodyweight, today }) → Row[]
//   Row = { area, label, value, change, state: null|{ kind, label }, spark: number[], sparkLabel, href }
//   - Las comparaciones son las 4 últimas semanas COMPLETAS frente a las 4 anteriores (la semana en curso está a medias).
//   - Sin datos suficientes: value '—', un cambio que dice qué falta y estado «Faltan datos». Nunca NaN ni Infinity.
import { fmtNum, weekStart, addDays } from './util.js';
import { rateText } from './analysis-training.js';

/** Semanas de la minigráfica (completas). */
export const SPARK_WEEKS = 12;
/** Semanas de cada mitad de la comparación. */
export const CMP_WEEKS = 4;
const SPORT_LABEL = { run: 'carrera', bike: 'bici', swim: 'natación', hike: 'senderismo' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const avg = (xs) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);
const signedPct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmtNum(Math.abs(v), 0)} %`;
const insufficient = { kind: 'insufficient', label: 'Faltan datos' };

/** «+12 % frente a las 4 anteriores» / «Carga igual que las 4 anteriores» (null si no hay con qué comparar). */
function changeVs(cur, prev, what = '') {
  if (!isNum(cur) || !isNum(prev) || prev <= 0) return null;
  const pct = ((cur - prev) / prev) * 100;
  const txt = Math.abs(pct) < 1 ? `igual que las ${CMP_WEEKS} anteriores` : `${signedPct(pct)} frente a las ${CMP_WEEKS} anteriores`;
  return what ? `${what} ${txt}` : txt.charAt(0).toUpperCase() + txt.slice(1);
}

/** Las semanas completas (sin la de hoy), de la más antigua a la más reciente. */
function completeWeeks(weeks, today) {
  const cur = weekStart(today);
  return (weeks || []).filter((w) => w && w.week < cur);
}

function halves(list, get) {
  const last = list.slice(-CMP_WEEKS).map(get);
  const prev = list.slice(-2 * CMP_WEEKS, -CMP_WEEKS).map(get);
  return { cur: last.length === CMP_WEEKS ? avg(last) : null, prev: prev.length === CMP_WEEKS ? avg(prev) : null };
}

function strengthRow(weeks, a) {
  const s = a?.strength?.summary;
  const spark = weeks.slice(-SPARK_WEEKS).map((w) => w.workSets || 0);
  const row = { area: 'strength', label: 'Fuerza', spark, sparkLabel: 'Series efectivas por semana', href: '#/analysis?area=strength' };
  if (!s || !s.mainCount) {
    return { ...row, value: '—', change: 'Con 3 sesiones de un ejercicio en 3 semanas verás si mejora', state: insufficient };
  }
  const state = s.improving * 2 >= s.mainCount ? { kind: 'progress', label: 'Progresa' }
    : s.stalled + s.down > s.improving ? { kind: 'stalled', label: 'Estancado' } : null;
  return {
    ...row,
    value: `${s.improving} de ${s.mainCount} ${s.mainCount === 1 ? 'mejora' : 'mejoran'}`,
    change: isNum(s.trendPctPerWeek) ? `Ritmo típico ${rateText(s.trendPctPerWeek)}` : null,
    state,
  };
}

function enduranceRow(weeks) {
  const recent = weeks.slice(-2 * CMP_WEEKS);
  // El deporte al que dedicas más TIEMPO (los km de bici son siempre más que los de carrera: no sirven para elegir)
  const sum = (k, f) => recent.reduce((t, w) => t + (f(w, k) || 0), 0);
  const sport = ['run', 'bike', 'swim', 'hike'].filter((k) => sum(k, (w) => w.km?.[k]) > 0)
    .map((k) => [k, sum(k, (w) => w.minutes?.[k]), sum(k, (w) => w.km?.[k])])
    .sort((x, y) => (y[1] - x[1]) || (y[2] - x[2]))[0]?.[0];
  const row = { area: 'endurance', label: 'Resistencia', href: '#/analysis?area=endurance' };
  if (!sport) {
    return { ...row, value: '—', change: `Sin actividades con distancia en ${2 * CMP_WEEKS} semanas`, state: insufficient, spark: [], sparkLabel: '' };
  }
  const get = (w) => w.km?.[sport] || 0;
  const { cur, prev } = halves(weeks, get);
  const value = isNum(cur) ? cur : avg(recent.slice(-CMP_WEEKS).map(get)) ?? 0;
  return {
    ...row,
    label: `Resistencia · ${SPORT_LABEL[sport]}`,
    value: `${fmtNum(value, value >= 10 ? 0 : 1)} km/sem`,
    change: changeVs(cur, prev) || `Media de las ${CMP_WEEKS} últimas semanas`,
    state: null,
    spark: weeks.slice(-SPARK_WEEKS).map(get),
    sparkLabel: `Kilómetros de ${SPORT_LABEL[sport]} por semana`,
  };
}

function bodyRow(a, bodyweight, today) {
  const w = a?.weight;
  const t = w?.trend;
  // Media de cada semana completa con pesajes (las semanas sin pesar no se inventan: se saltan)
  const byWeek = new Map();
  const from = addDays(weekStart(today), -7 * SPARK_WEEKS);
  for (const b of bodyweight || []) {
    const d = b?.id || b?.date;
    if (!d || d < from || d >= weekStart(today) || !isNum(b.kg)) continue;
    const k = weekStart(d);
    const o = byWeek.get(k) || { t: 0, n: 0 };
    o.t += b.kg; o.n++;
    byWeek.set(k, o);
  }
  const spark = [...byWeek.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([, o]) => o.t / o.n);
  const row = { area: 'body', label: 'Cuerpo', spark, sparkLabel: 'Peso medio por semana', href: '#/bodyweight' };
  if (!t || !isNum(t.currentKg)) {
    return { ...row, value: '—', change: 'Pésate 3–4 veces por semana para ver tu tendencia', state: insufficient };
  }
  const rate = w.ok && isNum(t.ratePerWeekKg)
    ? `${t.ratePerWeekKg > 0 ? '+' : t.ratePerWeekKg < 0 ? '−' : '±'}${fmtNum(Math.abs(t.ratePerWeekKg), Math.abs(t.ratePerWeekKg) < 0.095 ? 2 : 1)} kg por semana`
    : 'Aún pocos pesajes para ver tu ritmo';
  const state = !w.ok ? insufficient : w.status === 'in' ? { kind: 'ok', label: 'En tu rango' }
    : w.status === 'below' || w.status === 'above' ? { kind: 'warn', label: w.paceLabel || 'Fuera de tu rango' } : null;
  return { ...row, value: `${fmtNum(t.currentKg, 1)} kg`, change: rate, state };
}

function recoveryRow(weeks, a) {
  const wb = a?.wellbeing;
  const spark = weeks.slice(-SPARK_WEEKS).map((w) => w.loadTotal || 0);
  const { cur, prev } = halves(weeks, (w) => w.loadTotal || 0);
  const load = changeVs(cur, prev, 'Carga');
  const row = { area: 'recovery', label: 'Recuperación', spark, sparkLabel: 'Carga semanal (minutos × esfuerzo)', href: '#/analysis?area=recovery' };
  const n = (wb?.sleep?.n || 0) + (wb?.energy?.n || 0);
  if (!wb || !wb.count || !n) {
    return { ...row, value: 'Sin check-ins', change: load || 'Responde «¿Cómo llegas hoy?» para verla', state: insufficient };
  }
  const low = ((wb.sleep?.low || 0) + (wb.energy?.low || 0)) / n;
  const [value, state] = low >= 0.4 ? ['Señales de cansancio', { kind: 'warn', label: 'Atención' }]
    : low >= 0.2 ? ['Algo de cansancio', null]
      : ['Sin señales de fatiga', { kind: 'ok', label: 'Bien' }];
  return { ...row, value, change: load || `${wb.daysWith} ${wb.daysWith === 1 ? 'día' : 'días'} con check-in en 4 semanas`, state };
}

/**
 * Portada de Progreso.
 * @param {{ weeks: object[], analysis: object|null, bodyweight: object[], today: string }} input
 * @returns {object[]} filas en orden: Fuerza, Resistencia, Cuerpo, Recuperación
 */
export function progressOverview({ weeks = [], analysis = null, bodyweight = [], today }) {
  const full = completeWeeks(weeks, today);
  return [strengthRow(full, analysis), enduranceRow(full), bodyRow(analysis, bodyweight, today), recoveryRow(full, analysis)];
}
