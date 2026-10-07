// context-logic.js — contexto del usuario (ronda 6, docs/MEJORAS6.md): fases (periodos) y hechos (puntuales) de una
// línea temporal que admite también lo ocurrido antes de usar la app, con fecha aproximada. PURO (sin store ni DOM):
// lo usan la vista #/context, Hoy, el análisis y el informe para IA.
//
// Almacén 'context':
//   Fase:  { id, kind:'phase', type, start:Approx, end:Approx|null (null = sigue), text, notes, goalIds:[], sports:[],
//            createdAt, updatedAt }
//   Hecho: { id, kind:'event', type, date:Approx, text, notes, kg:number|null, createdAt, updatedAt }
//   Resultado de carrera (hecho type 'race_result'): además { result: { km, sec, effort:'race'|'training'|'test'|null,
//     elevationM:number|null, surface:'road'|'track'|'trail'|'mixed'|null } | null }; `text` = nombre de la carrera
//     (opcional), `notes` = nota. Es la ÚNICA copia de esa marca: los tiempos previstos (race-predict) y el informe la
//     leen de aquí. Algo que ya pasó (nunca en el futuro: eso es un evento deportivo, races-logic).
//   Approx = { date:'YYYY-MM-DD' (primer día del periodo), precision:'day'|'month'|'season'|'year' }
// Estaciones meteorológicas: primavera mar–may, verano jun–ago, otoño sep–nov, invierno dic–feb (la de diciembre de
// un año: «invierno 2026-27»).
import { isDateStr, todayStr, addDays, addMonths, diffDays, fmtDate, fmtNum, fmtRaceTime, fmtPaceKm, MONTH_LONG, MONTH_SHORT } from './util.js';

/**
 * Tipos de fase. `aspect` = qué aspecto describe; pueden estar vigentes VARIAS fases a la vez (p. ej. ganancia muscular +
 * preparación 10K + exámenes) y el análisis las consulta por aspecto:
 *   body      composición corporal (qué se busca con el peso)
 *   training  estado del entrenamiento (parón, vuelta, descarga)
 *   sport     preparación de un deporte o prueba
 *   life      circunstancias (enfermedad, lesión, viaje, estrés)
 *   custom    personalizada
 */
export const PHASE_TYPES = [
  { id: 'gain', label: 'Ganancia muscular', aspect: 'body' },
  { id: 'deficit', label: 'Déficit (perder grasa)', aspect: 'body' },
  { id: 'maintain', label: 'Mantenimiento', aspect: 'body' },
  { id: 'recomp', label: 'Recomposición', aspect: 'body' },
  { id: 'break', label: 'Parón o entrenamiento irregular', aspect: 'training' },
  { id: 'return', label: 'Vuelta tras vacaciones o parón', aspect: 'training' },
  { id: 'recondition', label: 'Reacondicionamiento', aspect: 'training' },
  { id: 'deload', label: 'Descarga', aspect: 'training' },
  { id: 'prep_5k', label: 'Preparación 5K', aspect: 'sport', sport: 'run' },
  { id: 'prep_10k', label: 'Preparación 10K', aspect: 'sport', sport: 'run' },
  { id: 'prep_half', label: 'Preparación media maratón', aspect: 'sport', sport: 'run' },
  { id: 'prep_marathon', label: 'Preparación maratón', aspect: 'sport', sport: 'run' },
  { id: 'prep_cycling', label: 'Preparación ciclismo', aspect: 'sport', sport: 'bike' },
  { id: 'hybrid', label: 'Entrenamiento híbrido', aspect: 'sport' },
  { id: 'illness', label: 'Enfermedad', aspect: 'life' },
  { id: 'injury', label: 'Lesión o molestia', aspect: 'life' },
  { id: 'travel', label: 'Viaje', aspect: 'life' },
  { id: 'stress', label: 'Exámenes o época de estrés', aspect: 'life' },
  { id: 'custom', label: 'Personalizada', aspect: 'custom' },
];
export const ASPECTS = ['body', 'training', 'sport', 'life', 'custom'];

export const EVENT_TYPES = [
  { id: 'creatine_start', label: 'Empiezo creatina' },
  { id: 'creatine_stop', label: 'Dejo la creatina' },
  { id: 'gym_return', label: 'Vuelvo al gimnasio' },
  { id: 'holidays', label: 'Vacaciones' },
  { id: 'illness', label: 'Enfermedad' },
  { id: 'routine_change', label: 'Cambio importante de rutina' },
  { id: 'nutrition_change', label: 'Cambio en la alimentación' },
  { id: 'injury', label: 'Lesión' },
  { id: 'usual_weight', label: 'Peso habitual', kg: true },
  { id: 'weight', label: 'Peso en esa fecha', kg: true },
  { id: 'race_result', label: 'Resultado de carrera', race: true },
  { id: 'other', label: 'Otro' },
];

/**
 * Distancias rápidas de un resultado de carrera (km). Las de 5 km a maratón son las de stats.RACE_DISTANCES (una
 * prueba lo comprueba); 1 km, para un test.
 */
export const RESULT_DISTANCES = [
  { id: '1k', km: 1, label: '1 km' },
  { id: '5k', km: 5, label: '5 km' },
  { id: '10k', km: 10, label: '10 km' },
  { id: 'half', km: 21.0975, label: 'Media maratón' },
  { id: 'marathon', km: 42.195, label: 'Maratón' },
];
export const RESULT_EFFORTS = [
  { id: 'race', label: 'Carrera oficial' },
  { id: 'training', label: 'Entrenamiento' },
  { id: 'test', label: 'Test' },
];
export const RESULT_SURFACES = [
  { id: 'road', label: 'Asfalto' },
  { id: 'track', label: 'Pista' },
  { id: 'trail', label: 'Trail' },
  { id: 'mixed', label: 'Mixta' },
];
/** Límites de un resultado: distancia (km) y tiempo (s; menos de 100 h). */
export const RESULT_KM_MIN = 0.1;
export const RESULT_KM_MAX = 250;
export const RESULT_SEC_MAX = 100 * 3600;
export const RESULT_ELEVATION_MAX = 20000;

export const PRECISIONS = [
  { id: 'day', label: 'Día' },
  { id: 'month', label: 'Mes' },
  { id: 'season', label: 'Estación' },
  { id: 'year', label: 'Año' },
];
/** Estaciones por su primer mes (1–12). */
export const SEASONS = [
  { id: 'spring', label: 'primavera', month: 3 },
  { id: 'summer', label: 'verano', month: 6 },
  { id: 'autumn', label: 'otoño', month: 9 },
  { id: 'winter', label: 'invierno', month: 12 },
];
/** Peso admitido en los hechos con kg. */
export const KG_MIN = 20;
export const KG_MAX = 400;
/** «Cambios recientes»: lo que empezó (o pasó) en las últimas RECENT_DAYS. */
export const RECENT_DAYS = 42;

const PHASE_IDS = new Set(PHASE_TYPES.map((t) => t.id));
const EVENT_IDS = new Set(EVENT_TYPES.map((t) => t.id));
const PRECISION_IDS = new Set(PRECISIONS.map((p) => p.id));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const phaseType = (id) => PHASE_TYPES.find((t) => t.id === id) || null;
export const eventType = (id) => EVENT_TYPES.find((t) => t.id === id) || null;
export const typeOf = (e) => (e?.kind === 'event' ? eventType(e.type) : phaseType(e?.type));
export const hasKg = (e) => e?.kind === 'event' && !!eventType(e.type)?.kg;
export const isRaceResult = (e) => e?.kind === 'event' && e.type === 'race_result';

// ---------------------------------------------------------------------------
// Fechas aproximadas
// ---------------------------------------------------------------------------

/** Primer mes (1–12) de la estación que contiene el mes `m`. */
function seasonStartMonth(m) {
  return m === 12 || m <= 2 ? 12 : m <= 5 ? 3 : m <= 8 ? 6 : 9;
}

/**
 * Fecha aproximada normalizada: `{date, precision}` con `date` en el primer día del periodo (mes → día 1; estación →
 * primer día de la estación, enero y febrero van al invierno que empezó en diciembre del año anterior; año → 1 ene).
 * Acepta 'YYYY-MM-DD' (precisión día). null si no es válida.
 */
export function normalizeApprox(x) {
  const src = typeof x === 'string' ? { date: x, precision: 'day' } : x;
  if (!src || !isDateStr(src.date)) return null;
  const precision = PRECISION_IDS.has(src.precision) ? src.precision : 'day';
  let [y, m] = src.date.split('-').map(Number);
  if (precision === 'day') return { date: src.date, precision };
  if (precision === 'month') return { date: `${y}-${pad(m)}-01`, precision };
  if (precision === 'year') return { date: `${y}-01-01`, precision };
  const sm = seasonStartMonth(m);
  if (sm === 12 && m !== 12) y -= 1;
  m = sm;
  return { date: `${y}-${pad(m)}-01`, precision };
}

/** Fecha aproximada a partir de las piezas del formulario. null si faltan. */
export function makeApprox(precision, { date = null, year = null, month = null, season = null } = {}) {
  if (precision === 'day') return normalizeApprox({ date, precision });
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (precision === 'month') return Number.isInteger(month) && month >= 1 && month <= 12 ? normalizeApprox({ date: `${year}-${pad(month)}-01`, precision }) : null;
  if (precision === 'season') {
    const s = SEASONS.find((x) => x.id === season);
    return s ? { date: `${year}-${pad(s.month)}-01`, precision } : null;
  }
  if (precision === 'year') return { date: `${year}-01-01`, precision };
  return null;
}

/** Primer día del periodo. */
export function approxFrom(a) {
  return normalizeApprox(a)?.date ?? null;
}

/** Último día del periodo (día → el mismo; mes → fin de mes; estación → 3 meses; año → 31 dic). */
export function approxTo(a) {
  const n = normalizeApprox(a);
  if (!n) return null;
  if (n.precision === 'day') return n.date;
  const months = n.precision === 'month' ? 1 : n.precision === 'season' ? 3 : 12;
  return addDays(addMonths(n.date, months), -1);
}

/** Texto: '23 sep 2026' · 'agosto 2026' · 'verano 2026' · 'invierno 2026-27' · '2026'. */
export function approxLabel(a, { short = false } = {}) {
  const n = normalizeApprox(a);
  if (!n) return '—';
  const [y, m] = n.date.split('-').map(Number);
  if (n.precision === 'day') return fmtDate(n.date, 'full');
  if (n.precision === 'month') return `${short ? MONTH_SHORT[m - 1] : MONTH_LONG[m - 1]} ${y}`;
  if (n.precision === 'year') return String(y);
  const s = SEASONS.find((x) => x.month === m);
  return m === 12 ? `${s.label} ${y}-${String(y + 1).slice(2)}` : `${s.label} ${y}`;
}

/** Piezas para rellenar el formulario a partir de una fecha aproximada (o de hoy). */
export function approxParts(a, today = todayStr()) {
  const n = normalizeApprox(a) || { date: today, precision: 'day' };
  const [y, m] = n.date.split('-').map(Number);
  const s = SEASONS.find((x) => x.month === seasonStartMonth(m));
  return { precision: n.precision, date: n.date, year: y, month: m, season: s.id };
}

// ---------------------------------------------------------------------------
// Registros
// ---------------------------------------------------------------------------

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const uniqStrings = (xs) => (Array.isArray(xs) ? [...new Set(xs.filter((x) => typeof x === 'string' && x))] : []);

const RESULT_EFFORT_IDS = new Set(RESULT_EFFORTS.map((x) => x.id));
const RESULT_SURFACE_IDS = new Set(RESULT_SURFACES.map((x) => x.id));

/** Resultado de carrera saneado: { km, sec, effort, elevationM, surface } o null si faltan distancia o tiempo válidos. */
export function normalizeResult(x) {
  if (!x || typeof x !== 'object') return null;
  if (!isNum(x.km) || x.km < RESULT_KM_MIN || x.km > RESULT_KM_MAX) return null;
  if (!isNum(x.sec) || Math.round(x.sec) <= 0 || x.sec >= RESULT_SEC_MAX) return null;
  return {
    km: Math.round(x.km * 10000) / 10000,
    sec: Math.round(x.sec),
    effort: RESULT_EFFORT_IDS.has(x.effort) ? x.effort : null,
    elevationM: isNum(x.elevationM) && x.elevationM >= 0 && x.elevationM <= RESULT_ELEVATION_MAX ? Math.round(x.elevationM) : null,
    surface: RESULT_SURFACE_IDS.has(x.surface) ? x.surface : null,
  };
}

/** Distancia de un resultado: «10 km», «Media maratón», «7,5 km». */
export function resultDistanceLabel(km) {
  const std = RESULT_DISTANCES.find((d) => Math.abs(d.km - km) < 0.001);
  return std ? std.label : `${fmtNum(km, 2)} km`;
}

/** «10 km · 1:00:00» (con nombre: «San Silvestre · 10 km · 1:00:00»). '' sin resultado válido. */
export function resultText(e) {
  const r = e?.result;
  if (!r) return '';
  return `${e.text ? `${e.text} · ` : ''}${resultDistanceLabel(r.km)} · ${fmtRaceTime(r.sec) ?? '—'}`;
}

/** Ritmo de un resultado: «6:00/km» o null. */
export const resultPace = (r) => (r && r.km > 0 ? fmtPaceKm(r.sec / r.km) : null);

/**
 * Fecha en que se toma un resultado para calcular su antigüedad: la mitad de su periodo (día → ese día; «mayo 2026» →
 * 16 may), sin pasar de hoy.
 */
export function resultDate(e, today = todayStr()) {
  const r = entryRange(e);
  if (!r.from) return null;
  const mid = addDays(r.from, Math.floor(diffDays(r.from, r.to) / 2));
  return mid > today ? (r.from > today ? null : today) : mid;
}

/**
 * Resultados de carrera con números válidos ocurridos hasta `today` (el periodo empieza hoy o antes), de lo más reciente
 * a lo más antiguo: { id, entry, km, sec, date (resultDate), from, to (su periodo), lo, hi (periodo ±1 día, para
 * matchesRun), name, effort, elevationM, surface, when (approxLabel), precision }.
 */
export function raceResults(list, today = todayStr()) {
  const out = [];
  for (const e of normalizeAll(list)) {
    if (!isRaceResult(e) || !e.result) continue;
    const { from, to } = entryRange(e);
    if (!from || from > today) continue;
    const mid = addDays(from, Math.floor(diffDays(from, to) / 2));
    const date = mid > today ? today : mid;
    out.push({
      id: e.id, entry: e, ...e.result, date, from, to, lo: addDays(from, -1), hi: addDays(to, 1), name: e.text,
      when: approxLabel(e.date, { short: true }), precision: e.date.precision,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Misma carrera: distancia y tiempo a ±5 %. */
export const RESULT_DUP_TOL = 0.05;

/**
 * ¿Es este resultado de tu contexto la misma carrera que una registrada (p. ej. importada de un FIT)? Fecha de la carrera
 * dentro del periodo del resultado ±1 día, y distancia y tiempo a ±RESULT_DUP_TOL. `res` = un elemento de raceResults;
 * `run` = { date, km, sec }. La ÚNICA regla de duplicados: la usan los tiempos previstos, los récords y los resúmenes
 * (cuenta la registrada; nada se borra).
 */
export function matchesRun(res, run) {
  if (!res || !run || !(run.km > 0) || !(run.sec > 0)) return false;
  // Primero lo barato (números); la ventana de fechas viene precalculada en raceResults (lo, hi)
  if (Math.abs(run.km - res.km) > RESULT_DUP_TOL * res.km + 1e-9 || Math.abs(run.sec - res.sec) > RESULT_DUP_TOL * res.sec + 1e-9) return false;
  let { lo, hi } = res;
  if (!lo) {
    if (!res.entry) return false;
    const { from, to } = entryRange(res.entry);
    if (!from) return false;
    lo = addDays(from, -1); hi = addDays(to, 1);
  }
  return isDateStr(run.date) && run.date >= lo && run.date <= hi;
}

/**
 * Copia saneada de un registro (para leer datos guardados o importados con campos de menos o de más).
 * null si no tiene la forma mínima (clase y fecha de inicio/del hecho válidas).
 */
export function normalizeEntry(r) {
  if (!r || typeof r !== 'object' || r.id == null) return null;
  const base = { id: r.id, text: cleanText(r.text, 200), notes: cleanText(r.notes, 2000), createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null };
  if (r.kind === 'event') {
    const date = normalizeApprox(r.date);
    if (!date) return null;
    const type = EVENT_IDS.has(r.type) ? r.type : 'other';
    const kg = eventType(type)?.kg && isNum(r.kg) && r.kg >= KG_MIN && r.kg <= KG_MAX ? r.kg : null;
    // Un resultado ilegible (copia dañada) se conserva sin números: se ve en la línea temporal, no se usa para calcular.
    if (type === 'race_result') return { ...base, kind: 'event', type, date, kg: null, result: normalizeResult(r.result) };
    return { ...base, kind: 'event', type, date, kg };
  }
  if (r.kind !== 'phase') return null;
  const start = normalizeApprox(r.start);
  if (!start) return null;
  // Un fin ilegible o anterior al inicio (copia dañada) cierra la fase en su inicio: nunca la deja «vigente».
  let end = r.end == null ? null : normalizeApprox(r.end);
  if (r.end != null && (!end || approxTo(end) < start.date)) end = start;
  return {
    ...base, kind: 'phase', type: PHASE_IDS.has(r.type) ? r.type : 'custom', start, end,
    goalIds: uniqStrings(r.goalIds), sports: uniqStrings(r.sports),
  };
}

/** Lista saneada (descarta lo que no se puede leer). */
export function normalizeAll(list) {
  return (Array.isArray(list) ? list : []).map(normalizeEntry).filter(Boolean);
}

/**
 * Errores de un borrador antes de guardarlo: { field: mensaje }. Vacío = se puede guardar.
 * Una fase personalizada necesita texto; el fin no puede ser anterior al inicio; los kg, entre KG_MIN y KG_MAX.
 */
export function validateEntry(d, today = todayStr()) {
  const err = {};
  if (!d || (d.kind !== 'phase' && d.kind !== 'event')) return { kind: 'Elige fase o hecho.' };
  if (d.kind === 'phase') {
    if (!PHASE_IDS.has(d.type)) err.type = 'Elige el tipo de fase.';
    const start = normalizeApprox(d.start);
    if (!start) err.start = 'Indica cuándo empezó.';
    if (d.end != null) {
      const end = normalizeApprox(d.end);
      if (!end) err.end = 'Indica cuándo terminó o marca «Sigue ahora».';
      else if (start && approxTo(end) < start.date) err.end = 'El fin no puede ser anterior al inicio.';
    }
    if (d.type === 'custom' && !cleanText(d.text, 200)) err.text = 'Escribe de qué se trata.';
  } else {
    if (!EVENT_IDS.has(d.type)) err.type = 'Elige qué pasó.';
    if (!normalizeApprox(d.date)) err.date = 'Indica cuándo (aunque sea aproximado).';
    if (d.type === 'other' && !cleanText(d.text, 200)) err.text = 'Escribe qué pasó.';
    if (eventType(d.type)?.kg) {
      if (!isNum(d.kg)) err.kg = 'Indica el peso.';
      else if (d.kg < KG_MIN || d.kg > KG_MAX) err.kg = `Entre ${KG_MIN} y ${KG_MAX} kg.`;
    }
    if (d.type === 'race_result') {
      const r = d.result || {};
      if (!isNum(r.km)) err.km = 'Indica la distancia.';
      else if (r.km < RESULT_KM_MIN || r.km > RESULT_KM_MAX) err.km = `Entre ${fmtNum(RESULT_KM_MIN, 1)} y ${RESULT_KM_MAX} km.`;
      if (!isNum(r.sec) || Math.round(r.sec) <= 0) err.sec = 'Indica el tiempo.';
      else if (r.sec >= RESULT_SEC_MAX) err.sec = 'El tiempo es demasiado largo.';
      const date = normalizeApprox(d.date);
      if (date && approxFrom(date) > today) err.date = 'Un resultado es algo que ya pasó. Para una carrera que quieres hacer, usa «Eventos deportivos».';
      if (r.elevationM != null && !(isNum(r.elevationM) && r.elevationM >= 0 && r.elevationM <= RESULT_ELEVATION_MAX)) err.elevationM = `Entre 0 y ${RESULT_ELEVATION_MAX} m.`;
    }
  }
  return err;
}

/** Registro listo para guardar a partir de un borrador válido (conserva id y createdAt si los hay). */
export function entryRecord(d, { id, now = Date.now() } = {}) {
  const n = normalizeEntry({ ...d, id: d.id ?? id, createdAt: d.createdAt ?? now, updatedAt: now });
  if (!n) throw new Error('Registro de contexto no válido');
  if (n.kind === 'event' && !eventType(n.type)?.kg) delete n.kg;
  if (n.kind === 'event' && n.type !== 'race_result') delete n.result;
  return n;
}

/** Rango de fechas que cubre: { from, to } (to = null en una fase que sigue). */
export function entryRange(e) {
  if (e.kind === 'event') return { from: approxFrom(e.date), to: approxTo(e.date) };
  return { from: approxFrom(e.start), to: e.end ? approxTo(e.end) : null };
}

/** ¿Está vigente la fase el día `date`? (empezada y sin terminar o terminada ese día o después) */
export function phaseActiveOn(e, date) {
  if (e.kind !== 'phase') return false;
  const { from, to } = entryRange(e);
  return from <= date && (to == null || to >= date);
}

/**
 * Título: el tipo («Vuelta tras vacaciones o parón»); en una personalizada u «Otro», su texto; en un resultado de
 * carrera, «Resultado de carrera: 10 km en 1:00:00» (o con su nombre: «San Silvestre: 10 km en 1:00:00»).
 */
export function entryTitle(e) {
  if (isRaceResult(e)) {
    const r = e.result;
    if (!r) return e.text || 'Resultado de carrera';
    return `${e.text || 'Resultado de carrera'}: ${resultDistanceLabel(r.km)} en ${fmtRaceTime(r.sec) ?? '—'}`;
  }
  if ((e.type === 'custom' || e.type === 'other') && e.text) return e.text;
  const t = typeOf(e);
  return t ? t.label : 'Contexto';
}

/** Cuándo: «desde sep 2026» (sigue) · «jun 2026 – ago 2026» · «verano 2026» · «28 ago 2026». */
export function entryWhen(e, { short = true } = {}) {
  if (e.kind === 'event') return approxLabel(e.date, { short });
  const a = approxLabel(e.start, { short });
  if (!e.end) return `desde ${a}`;
  const b = approxLabel(e.end, { short });
  return a === b ? a : `${a} – ${b}`;
}

/** Línea de resumen: «Peso habitual: 75 kg» · «Vuelta tras vacaciones o parón» (+ el texto si aporta). */
export function entryLine(e) {
  if (isRaceResult(e)) return e.result ? `🏁 ${resultText(e)}` : `🏁 ${e.text || 'Resultado de carrera'} · sin distancia o tiempo válidos`;
  const title = entryTitle(e);
  const kg = isNum(e.kg) ? `: ${fmtNum(e.kg, 1)} kg` : '';
  const extra = e.text && e.text !== title ? ` · ${e.text}` : '';
  return `${title}${kg}${extra}`;
}

/** Orden: de lo más reciente a lo más antiguo (por fecha de inicio; a igualdad, lo último creado). */
function newestFirst(a, b) {
  const fa = entryRange(a).from; const fb = entryRange(b).from;
  if (fa !== fb) return fa < fb ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

/** Línea temporal: de lo más reciente a lo más antiguo. */
export function timeline(list) {
  return normalizeAll(list).sort(newestFirst);
}

/**
 * Contexto el día `date`: fases vigentes, hechos cuyo periodo incluye ese día y último peso habitual anotado (que va
 * aparte: es una referencia, no algo que pase ese día).
 * @returns {{ phases, events, usualWeight: {kg, date}|null }}
 */
export function contextOn(list, date = todayStr()) {
  const all = normalizeAll(list);
  const phases = all.filter((e) => phaseActiveOn(e, date)).sort(newestFirst);
  const events = all.filter((e) => e.kind === 'event' && e.type !== 'usual_weight' && entryRange(e).from <= date && entryRange(e).to >= date);
  const usual = all.filter((e) => e.kind === 'event' && e.type === 'usual_weight' && isNum(e.kg) && entryRange(e).from <= date)
    .sort((a, b) => (entryRange(a).from < entryRange(b).from ? 1 : -1))[0];
  return { phases, events, usualWeight: usual ? { kg: usual.kg, date: usual.date } : null };
}

/**
 * Cambios recientes: fases que empezaron o terminaron y hechos ocurridos en los últimos `days` días (hasta hoy), de lo
 * más reciente a lo más antiguo. Cuenta el PRINCIPIO del periodo de cada fecha aproximada («verano 2026» no es reciente
 * en octubre aunque el año 2026 lo sea); el peso habitual y los resultados de carrera son referencias, no cambios.
 * @returns {{ entry, what:'start'|'end'|'event', date }[]}
 */
export function recentChanges(list, today = todayStr(), days = RECENT_DAYS) {
  const from = addDays(today, -days);
  const inWindow = (d) => d != null && d >= from && d <= today;
  const out = [];
  for (const e of normalizeAll(list)) {
    const r = entryRange(e);
    if (e.kind === 'event') {
      // El peso habitual y los resultados de carrera son referencias, no cambios
      if (e.type !== 'usual_weight' && e.type !== 'race_result' && inWindow(r.from)) out.push({ entry: e, what: 'event', date: r.from });
      continue;
    }
    if (inWindow(r.from)) out.push({ entry: e, what: 'start', date: r.from });
    if (inWindow(r.to)) out.push({ entry: e, what: 'end', date: r.to });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Lo que el análisis necesita del contexto un día: TODAS las fases vigentes (por aspecto y por tipo), los hechos de
 * ese día y las referencias de peso estructuradas. Un aspecto puede tener más de una fase (p. ej. dos preparaciones):
 * van de la más reciente a la más antigua.
 * @returns {{ date, phases, byAspect:{body,training,sport,life,custom}, types:Set<string>, events, usualWeight, weights }}
 */
export function contextSummary(list, date = todayStr()) {
  const { phases, events, usualWeight } = contextOn(list, date);
  const byAspect = Object.fromEntries(ASPECTS.map((a) => [a, []]));
  for (const p of phases) byAspect[phaseType(p.type)?.aspect || 'custom'].push(p);
  return { date, phases, byAspect, types: new Set(phases.map((p) => p.type)), events, usualWeight, weights: weightReferences(list, date) };
}

/**
 * Referencias de peso apuntadas a mano (peso habitual y pesos en una fecha) hasta `date`, de la más antigua a la más
 * reciente: { kind:'usual'|'point', kg, from, to, precision, id }. Números estructurados: nada se lee del texto.
 */
export function weightReferences(list, date = todayStr()) {
  return normalizeAll(list)
    .filter((e) => e.kind === 'event' && (e.type === 'usual_weight' || e.type === 'weight') && isNum(e.kg) && entryRange(e).from <= date)
    .map((e) => ({ id: e.id, kind: e.type === 'usual_weight' ? 'usual' : 'point', kg: e.kg, ...entryRange(e), precision: e.date.precision }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * Línea compacta de Hoy. Una fase: «Vuelta tras vacaciones o parón · desde sep 2026». Varias: sus nombres, de la más
 * reciente a la más antigua («Exámenes o época de estrés · Preparación 10K · Ganancia muscular»), hasta 3 y «+N».
 */
export function currentLabel(list, today = todayStr()) {
  const { phases } = contextOn(list, today);
  if (!phases.length) return null;
  if (phases.length === 1) return `${cap(entryTitle(phases[0]))} · ${entryWhen(phases[0])}`;
  const names = phases.slice(0, 3).map((p) => cap(entryTitle(p)));
  return `${names.join(' · ')}${phases.length > 3 ? ` · +${phases.length - 3}` : ''}`;
}
