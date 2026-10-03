// analysis.js — «tu analista» (ronda 5, docs/MEJORAS5.md §3c): orquestador PURO de los análisis de peso
// (analysis-weight.js), fuerza, resistencia y recuperación (analysis-training.js) y ciclo (cycle-logic.js).
// Sin store, ui ni DOM; «hoy» inyectable. Lo usan #/analysis, la tarjeta «Tu análisis» de Hoy y del panel semanal
// y el informe para pegar en una IA (analysis-report.js). Pruebas: tests/unit/analysis.test.mjs.
//
// ENTRADA `data` = progress-ui.dataFromStore(today) + `checkins` (store 'checkins') + `cycleDays` (store 'cycle') y, desde la
// ronda 6, `context` (store 'context') y `pastRecords` (store 'pastRecords'); sin ellos, el análisis es el de siempre.
// El envoltorio que la construye desde el store vive en la vista (views/analysis.js · analysisData()).
//
// SALIDA buildAnalysis(data, today) → {
//   today, profile, profileIncomplete, female, hasData,
//   weight   : analyzeWeight(...)                       (+ nada: tal cual)
//   strength : analyzeStrength(...)
//   endurance: analyzeEndurance(...) + { weeklyMinutes4w }
//   recovery : analyzeRecovery(...)                     (sus insights de área 'cycle' se enseñan en «Ciclo»)
//   cycle    : null (sin modo mujer o sin seguimiento) | { info: CycleInfo, state, next, basis, hormonal, insights }
//   forecast : Insight[] (área 'forecast': fuerza, 5 km y la proyección del peso de aquí)
//   keyPoints: Insight[] (hasta 3, los de mayor prioridad y de áreas distintas; ver pickKeyPoints)
//   all      : Insight[] (todos, sin repetir id, por prioridad), errors: [{ area, message }],
//   context  : analysis-context.analysisContext(...) (ronda 6: lo que se tuvo en cuenta del contexto) }
// Ronda 6 (fase C): los Insights pueden llevar `confidence` (confidence.js), `context` y `parts`; ver analysis-weight.js.
// Un fallo en un análisis no tumba los demás: su parte queda vacía y se anota en `errors`.
import { addDays, isDateStr, todayStr, fmtNum, fmtDate } from './util.js';
import { sessionDurationMin } from './calc.js';
import { getProfile, cycleEnabled, isFemale, profileIncomplete } from './profile.js';
import { analyzeWeight } from './analysis-weight.js';
import { analyzeStrength, analyzeEndurance, analyzeRecovery, ENDURANCE_KINDS } from './analysis-training.js';
import { cycleInfo, fmtRange, LIMITS as CYCLE_LIMITS } from './cycle-logic.js';
import { analysisContext } from './analysis-context.js';

/** Orden de las áreas (desempates y orden de las tarjetas). */
export const AREAS = ['weight', 'strength', 'endurance', 'recovery', 'cycle', 'forecast'];
export const AREA_LABEL = {
  weight: 'Peso', strength: 'Fuerza', endurance: 'Resistencia', recovery: 'Recuperación', cycle: 'Ciclo', forecast: 'Previsión',
};
export const LEVEL_LABEL = { good: 'Bien', neutral: 'Nota', warn: 'Atención', info: 'Info' };
/** Nota fija de la pantalla y del informe. */
export const DISCLAIMER = 'Estimaciones orientativas basadas en estudios; no sustituyen a un profesional.';

/** Semanas de la proyección del peso. */
export const WEIGHT_FORECAST_WEEKS = 4;
/** Semiancho mínimo (kg) de la proyección del peso: el ruido diario no deja afinar más. */
export const WEIGHT_FORECAST_MIN_KG = 0.3;
/** Placeholders de «faltan datos» por debajo de esta prioridad no entran en el resumen. */
const PLACEHOLDER_MIN_PRIORITY = 20;
/** Relleno del resumen (segunda del mismo área) solo con Insights de esta prioridad o más. */
const FILL_MIN_PRIORITY = 40;
/**
 * Insights que dicen lo mismo que otro con otras palabras: si el primero entra en el resumen, los otros no
 * (siguen en su tarjeta). El aviso de energía baja con la regla alterada ya incluye el retraso o la falta de regla.
 */
const RELATED = {
  'weight-reds-cycle': ['cycle-amenorrhea', 'cycle-late'],
  'cycle-amenorrhea': ['weight-reds-cycle'],
  'cycle-late': ['weight-reds-cycle'],
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);
const r1 = (v) => Math.round(v * 10) / 10;
const kg = (v) => `${fmtNum(v, 1)} kg`;
const signedKg = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmtNum(Math.abs(v), Math.abs(v) < 0.095 ? 2 : 1)} kg`;
const dayTxt = (d, today) => fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full');

/** «Faltan datos» (weight-insufficient, strength-insufficient, recovery-insufficient…): útil, pero no es un análisis. */
export const isPlaceholder = (i) => !!i && /-insufficient$/.test(i.id);

// ===========================================================================
// Piezas
// ===========================================================================

/**
 * Minutos semanales de resistencia (carrera, bici, natación y senderismo terminados), media de las `weeks` últimas
 * semanas hasta hoy (hoy incluido). Es la entrada `endurance.weeklyMinutes4w` de analyzeWeight.
 */
export function enduranceMinutesPerWeek(sessions, today, weeks = 4) {
  const from = addDays(today, -(weeks * 7 - 1));
  let total = 0;
  for (const s of toArr(sessions)) {
    if (!s || s.status !== 'done' || !ENDURANCE_KINDS.includes(s.kind) || !isDateStr(s.date) || s.date < from || s.date > today) continue;
    const m = sessionDurationMin(s);
    if (isNum(m) && m > 0) total += m;
  }
  return Math.round(total / weeks);
}

/** «Día 12 · fase folicular (estimada)», «Próxima regla ~3–5 oct» y la base de las estimaciones (textos del ciclo). */
export function cycleSummary(info) {
  if (!info) return null;
  const c = info.current;
  let state;
  if (!c) state = 'Sin reglas registradas';
  else if (info.hormonal) state = `Día ${c.day} desde el último sangrado`;
  else if (info.ongoing) state = `Día ${c.day} · regla`;
  else if (!c.phase) state = `Día ${c.day} · fase sin estimar`;
  else state = `Día ${c.day} · ${c.phaseLabel}${c.estimated ? ' (estimada)' : ''}`;
  let next = null;
  if (!info.hormonal && c && info.next) {
    const nx = info.next;
    if (info.ongoing) next = `Regla en curso · día ${info.ongoing.day}`;
    else if (info.today > nx.to) next = `Retraso de ${info.lateDays} ${info.lateDays === 1 ? 'día' : 'días'} · se esperaba ~${fmtRange(nx.from, nx.to)}`;
    else if (info.today >= nx.from) next = `Próxima regla: puede venir ya (~${fmtRange(nx.from, nx.to)})`;
    else next = `Próxima regla ~${fmtRange(nx.from, nx.to)}`;
  }
  let basis = null;
  if (info.hormonal) {
    basis = 'Con anticonceptivo hormonal no hay fases naturales: se registran sangrados y síntomas.';
  } else if (info.periods?.length) {
    if (info.basis === 'own' && isNum(info.avgCycle)) {
      const n = Math.min(info.cycles.length, CYCLE_LIMITS.avgWindow);
      basis = `Ciclo medio de ${fmtNum(info.avgCycle, 0)} días (${n} ${n === 1 ? 'ciclo' : 'ciclos'})${isNum(info.avgPeriod) ? ` · regla de ~${fmtNum(info.avgPeriod, 0)} días` : ''}${info.regular === true ? ' · regular' : info.regular === false ? ' · variable' : ''}.`;
    } else {
      basis = `Con menos de ${CYCLE_LIMITS.minCyclesOwn} ciclos registrados se usa lo que indicaste en tu perfil (${fmtNum(info.cycleLength, 0)} días).`;
    }
  }
  return { state, next, basis };
}

/**
 * Proyección del peso a 4 semanas «si sigues así» (Insight de área 'forecast'), o null: sin ritmo fiable, sin
 * intervalo o con un aviso de energía baja (no se anima a seguir bajando).
 */
export function weightForecast(weight, { today, female = false } = {}) {
  const t = weight?.trend;
  if (!weight?.ok || !t || !isNum(t.currentKg) || !isNum(t.ratePerWeekKg) || !t.ci || !isNum(t.ci.lo) || !isNum(t.ci.hi)) return null;
  // Ronda 6: sin proyección para menores, con confianza baja o si el contexto explica el cambio (weight.projectable).
  if (weight.projectable === false) return null;
  if ((weight.insights || []).some((i) => /^weight-reds/.test(i.id))) return null;
  const W = WEIGHT_FORECAST_WEEKS;
  const date = addDays(today, W * 7);
  const mid = t.currentKg + t.ratePerWeekKg * W;
  let lo = Math.min(mid, t.currentKg + t.ci.lo * W);
  let hi = Math.max(mid, t.currentKg + t.ci.hi * W);
  if (mid - lo < WEIGHT_FORECAST_MIN_KG) lo = mid - WEIGHT_FORECAST_MIN_KG;
  if (hi - mid < WEIGHT_FORECAST_MIN_KG) hi = mid + WEIGHT_FORECAST_MIN_KG;
  lo = r1(lo);
  hi = r1(hi);
  const range = `${fmtNum(lo, 1)}–${fmtNum(hi, 1)} kg`;
  const stable = t.direction === 'stable';
  const pace = stable ? 'con tu peso estable' : `al ritmo actual (${signedKg(t.ratePerWeekKg)} por semana)`;
  const water = female ? ' Los días de retención de líquidos el pesaje puede salir 0,5–2 kg por encima.' : '';
  return {
    id: 'forecast-weight', area: 'forecast', level: 'info', priority: 34,
    title: `Peso: ${range} hacia el ${dayTxt(date, today)}`,
    text: `Si sigues ${pace}, tu peso de tendencia estaría en ${range} hacia el ${dayTxt(date, today)} (ahora ~${kg(t.currentKg)}). Es una proyección: el ritmo cambia con lo que comes y entrenas.${water}`,
    why: {
      rule: `Proyección a ${W} semanas de tu peso de tendencia (media exponencial de ~10 días) con el ritmo de ${t.windowDays >= 21 ? `las últimas ${Math.round(t.windowDays / 7)} semanas` : `los últimos ${t.windowDays} días`} (pendiente robusta de Theil–Sen) y su margen del 95 %, con un margen mínimo de ±${fmtNum(WEIGHT_FORECAST_MIN_KG, 1)} kg por el ruido de los pesajes. Supone que sigues comiendo y entrenando igual.`,
      data: [
        { label: 'Peso de tendencia', value: kg(t.currentKg) },
        { label: 'Ritmo', value: `${signedKg(t.ratePerWeekKg)}/sem (margen ${signedKg(t.ci.lo)} a ${signedKg(t.ci.hi)})` },
        { label: `En ${W} semanas (${dayTxt(date, today)})`, value: `${range} · medio ${kg(r1(mid))}` },
      ],
    },
    sources: [],
    date, low: lo, mid: r1(mid), high: hi,
  };
}

/** Orden común: prioridad (de mayor a menor), área y id. */
export function sortInsights(list) {
  return [...list].sort((a, b) => (b.priority - a.priority) || (AREAS.indexOf(a.area) - AREAS.indexOf(b.area)) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Resumen: hasta `max` Insights de mayor prioridad y de áreas distintas. Primero los que analizan algo; después, si
 * falta hueco, los de «faltan datos» que dicen qué hacer (prioridad ≥ 20) y, al final, un segundo Insight de un área
 * ya usada si es importante (prioridad ≥ 40). Nunca dos que digan lo mismo (RELATED). Salen por prioridad.
 * @param {object[]} all Insights (en cualquier orden)
 */
export function pickKeyPoints(all, max = 3) {
  const list = sortInsights(all || []);
  const out = [];
  const areas = new Set();
  const blocked = new Set();
  const take = (i) => {
    out.push(i);
    areas.add(i.area);
    for (const r of RELATED[i.id] || []) blocked.add(r);
  };
  const passes = [
    (i) => !isPlaceholder(i) && !areas.has(i.area),
    (i) => isPlaceholder(i) && i.priority >= PLACEHOLDER_MIN_PRIORITY && !areas.has(i.area),
    (i) => !isPlaceholder(i) && i.priority >= FILL_MIN_PRIORITY,
  ];
  for (const ok of passes) {
    for (const i of list) {
      if (out.length >= max) break;
      if (out.includes(i) || blocked.has(i.id) || !ok(i)) continue;
      take(i);
    }
  }
  return sortInsights(out);
}

// ===========================================================================
// Orquestador
// ===========================================================================

function attempt(errors, area, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    errors.push({ area, message: String(err?.message || err) });
    return fallback;
  }
}

/**
 * «Tu analista»: ejecuta todos los análisis con el mismo `data` y el perfil de data.settings. PURO.
 * @param {object} data progress-ui.dataFromStore(today) + checkins + cycleDays
 * @param {string} [today] 'YYYY-MM-DD' (por defecto data.today o la fecha de hoy)
 */
export function buildAnalysis(data = {}, today) {
  const d = data && typeof data === 'object' ? data : {};
  const t = isDateStr(today) ? today : isDateStr(d.today) ? d.today : todayStr();
  const profile = getProfile(d.settings);
  const female = isFemale(profile);
  const errors = [];
  const context = attempt(errors, 'context', () => analysisContext({ context: d.context || [], sessions: d.sessions, today: t, profile }), null);
  const opts = { profile, today: t, context };

  const info = cycleEnabled(profile) ? attempt(errors, 'cycle', () => cycleInfo(d.cycleDays || [], profile, t), null) : null;
  const strength = attempt(errors, 'strength', () => analyzeStrength(d, opts),
    { exercises: [], summary: { trendPctPerWeek: null, improving: 0, stalled: 0, down: 0, mainCount: 0, analyzed: 0 }, insights: [] });
  const endurance = {
    ...attempt(errors, 'endurance', () => analyzeEndurance(d, opts), { fitness: [], intensity: null, interference: [], insights: [] }),
    weeklyMinutes4w: attempt(errors, 'endurance', () => enduranceMinutesPerWeek(d.sessions, t), 0),
  };
  const sum = strength.summary || {};
  const weight = attempt(errors, 'weight', () => analyzeWeight({
    bodyweight: d.bodyweight || [],
    today: t,
    profile,
    strength: isNum(sum.trendPctPerWeek) ? { trendPctPerWeek: sum.trendPctPerWeek, n: sum.mainCount, recoveryShare: sum.recoveryShare } : null,
    endurance: { weeklyMinutes4w: endurance.weeklyMinutes4w },
    cycle: info,
    context,
  }), { ok: false, trend: null, target: null, status: 'insufficient', insights: [] });
  const recovery = attempt(errors, 'recovery', () => analyzeRecovery(d, { ...opts, cycle: info }), { insights: [] });

  let cycle = null;
  if (info) {
    const cycleInsights = sortInsights([...(info.alerts || []), ...(recovery.insights || []).filter((i) => i.area === 'cycle')]);
    cycle = { info, hormonal: !!info.hormonal, ...cycleSummary(info), insights: cycleInsights };
  }

  const wf = attempt(errors, 'forecast', () => weightForecast(weight, { today: t, female }), null);
  const forecast = sortInsights([
    ...(strength.insights || []).filter((i) => i.area === 'forecast'),
    ...(endurance.insights || []).filter((i) => i.area === 'forecast'),
    ...(wf ? [wf] : []),
  ]);

  const byId = new Map();
  const pool = [
    ...(weight.insights || []), ...(strength.insights || []), ...(endurance.insights || []), ...(recovery.insights || []),
    ...(cycle ? cycle.insights : []), ...forecast,
  ];
  for (const i of pool) if (i && i.id && !byId.has(i.id)) byId.set(i.id, i);
  const all = sortInsights([...byId.values()]);
  const hasData = attempt(errors, 'data', () => toArr(d.sessions).some((s) => s && s.status === 'done') || toArr(d.bodyweight).length > 0, false);

  return {
    today: t, profile, profileIncomplete: profileIncomplete(profile), female, hasData,
    weight, strength, endurance, recovery, cycle, forecast,
    keyPoints: pickKeyPoints(all, 3), all, errors, context,
  };
}

/** Insights de un área para su tarjeta (la recuperación sin los del ciclo, que van en «Ciclo»). */
export function areaInsights(analysis, area) {
  if (!analysis) return [];
  if (area === 'weight') return (analysis.weight?.insights || []).slice();
  if (area === 'strength') return (analysis.strength?.insights || []).filter((i) => i.area === 'strength');
  if (area === 'endurance') return (analysis.endurance?.insights || []).filter((i) => i.area === 'endurance');
  if (area === 'recovery') return (analysis.recovery?.insights || []).filter((i) => i.area !== 'cycle');
  if (area === 'cycle') return analysis.cycle ? analysis.cycle.insights.slice() : [];
  if (area === 'forecast') return (analysis.forecast || []).slice();
  return [];
}
