// races-logic.js — eventos deportivos (ronda 6, fase E; docs/MEJORAS6.md). PURO: sin DOM ni store.
//
// Registro del almacén 'races' (fase A; independiente de 'goals', enlazable con goalId):
//   { id, name, type, date:'YYYY-MM-DD', distanceKm|null, targetSec|null, priority:'A'|'B'|'C', note, goalId|null,
//     createdAt, updatedAt }
// Tipos: 5k · 10k · half · marathon (carrera) · cycling · hiking · triathlon · custom.
// No hay planificador: el evento se apunta, se ve en Hoy (un hueco) y el analista lo usa como contexto.
// LIGERO a propósito (solo util.js): lo importan Hoy y el contexto del análisis. «Cómo vas» (tiempo previsto con
// race-predict y el objetivo enlazado con goalProgress) está en races-progress.js.
import { todayStr, isDateStr, diffDays, fmtDate, fmtDuration, fmtNum } from './util.js';

export const RACE_TYPES = [
  { value: '5k', label: '5K', long: '5 km', sport: 'run', km: 5 },
  { value: '10k', label: '10K', long: '10 km', sport: 'run', km: 10 },
  { value: 'half', label: 'Media maratón', long: 'Media maratón', sport: 'run', km: 21.0975 },
  { value: 'marathon', label: 'Maratón', long: 'Maratón', sport: 'run', km: 42.195 },
  { value: 'cycling', label: 'Ciclismo', long: 'Ciclismo', sport: 'bike', km: null },
  { value: 'hiking', label: 'Senderismo', long: 'Senderismo', sport: 'hike', km: null },
  { value: 'triathlon', label: 'Triatlón', long: 'Triatlón', sport: null, km: null },
  { value: 'custom', label: 'Otro', long: 'Otro evento', sport: null, km: null },
];
const TYPE = Object.fromEntries(RACE_TYPES.map((t) => [t.value, t]));
export const PRIORITIES = [
  { value: 'A', label: 'A · principal', short: 'A' },
  { value: 'B', label: 'B · importante', short: 'B' },
  { value: 'C', label: 'C · de preparación', short: 'C' },
];
const PRIORITY_IDS = PRIORITIES.map((p) => p.value);
export const NAME_MAX = 80;
export const NOTE_MAX = 500;
/** Hoy enseña el próximo evento A o B de los próximos 365 días; si no hay, uno C de los próximos 30. */
export const TODAY_AB_DAYS = 365;
export const TODAY_C_DAYS = 30;
/** El analista cuenta como «evento próximo» lo de las próximas 26 semanas. */
export const CONTEXT_DAYS = 182;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);

export const typeInfo = (type) => TYPE[type] || TYPE.custom;
/** Deporte del evento ('run' | 'bike' | 'hike' | null): el de sus objetivos enlazables y sus análisis. */
export const sportOf = (race) => typeInfo(race?.type).sport;
/** Distancia fija del tipo (las carreras con nombre) o null. */
export const fixedKm = (type) => typeInfo(type).km;
/** ¿La distancia es obligatoria? En triatlón y «otro» es opcional (varias distancias o ninguna). */
export const distanceRequired = (type) => !['triathlon', 'custom'].includes(typeInfo(type).value);

/** Registro saneado (copias antiguas o manipuladas): null si no es un evento utilizable. */
export function normalizeRace(r) {
  if (!r || typeof r !== 'object' || !r.id || !isDateStr(r.date)) return null;
  const type = TYPE[r.type] ? r.type : 'custom';
  const km = fixedKm(type) ?? (isNum(r.distanceKm) && r.distanceKm > 0 ? r.distanceKm : null);
  return {
    id: String(r.id),
    name: String(r.name || '').trim().slice(0, NAME_MAX),
    type,
    date: r.date,
    distanceKm: km,
    targetSec: isNum(r.targetSec) && r.targetSec > 0 ? Math.round(r.targetSec) : null,
    priority: PRIORITY_IDS.includes(r.priority) ? r.priority : 'B',
    note: String(r.note || '').slice(0, NOTE_MAX),
    goalId: r.goalId ? String(r.goalId) : null,
    createdAt: isNum(r.createdAt) ? r.createdAt : null,
    updatedAt: isNum(r.updatedAt) ? r.updatedAt : null,
  };
}

export function normalizeRaces(list) {
  return toArr(list).map(normalizeRace).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
}

/** Errores de un borrador: { field: mensaje }. Campos: name, type, date, distanceKm, targetSec, priority, goalId. */
export function validateRace(draft, { goals = [] } = {}) {
  const e = {};
  const d = draft || {};
  if (!TYPE[d.type]) e.type = 'Elige el tipo de evento.';
  if (!isDateStr(d.date)) e.date = 'Indica la fecha del evento.';
  const type = typeInfo(d.type).value;
  if (type === 'custom' && !String(d.name || '').trim()) e.name = 'Ponle un nombre (p. ej. «Carrera de montaña»).';
  if (String(d.name || '').length > NAME_MAX) e.name = `Como mucho ${NAME_MAX} caracteres.`;
  if (fixedKm(type) == null) {
    const max = type === 'cycling' ? 2000 : type === 'hiking' ? 300 : 1000;
    if (d.distanceKm == null || d.distanceKm === '') {
      if (distanceRequired(type)) e.distanceKm = 'Indica la distancia.';
    } else if (!isNum(d.distanceKm) || !(d.distanceKm > 0)) e.distanceKm = 'Indica una distancia mayor que 0 km.';
    else if (d.distanceKm > max) e.distanceKm = `Distancia demasiado larga (máximo ${fmtNum(max, 0)} km).`;
  }
  if (d.targetSec != null && (!isNum(d.targetSec) || !(d.targetSec > 0) || d.targetSec > 7 * 86400)) e.targetSec = 'Tiempo objetivo no válido.';
  if (!PRIORITY_IDS.includes(d.priority)) e.priority = 'Elige la prioridad.';
  if (d.goalId && !linkableGoals(goals, d).some((g) => g.id === d.goalId)) e.goalId = 'Ese objetivo ya no se puede enlazar (borrado, archivado o de otro deporte).';
  if (String(d.note || '').length > NOTE_MAX) e.note = `Como mucho ${NOTE_MAX} caracteres.`;
  return e;
}

/** Registro para guardar a partir de un borrador válido (solo los campos del almacén). */
export function raceRecord(draft, { id, createdAt = null, now = Date.now() } = {}) {
  const type = typeInfo(draft.type).value;
  const km = fixedKm(type) ?? (isNum(draft.distanceKm) && draft.distanceKm > 0 ? draft.distanceKm : null);
  return {
    id,
    name: String(draft.name || '').trim().slice(0, NAME_MAX),
    type,
    date: draft.date,
    distanceKm: km,
    targetSec: isNum(draft.targetSec) && draft.targetSec > 0 ? Math.round(draft.targetSec) : null,
    priority: PRIORITY_IDS.includes(draft.priority) ? draft.priority : 'B',
    note: String(draft.note || '').trim().slice(0, NOTE_MAX),
    goalId: draft.goalId || null,
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
}

/** Objetivos que se pueden enlazar: de resistencia, activos (ni archivados ni conseguidos) y del mismo deporte. */
export function linkableGoals(goals, race) {
  const sport = sportOf(race);
  return toArr(goals).filter((g) => g && g.kind === 'endurance' && !g.archived && !g.achievedAt && (!sport || g.sport === sport));
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** Nombre corto: el tipo para las carreras con nombre («10K»), si no el nombre («Quebrantahuesos»). */
export function raceShortLabel(race) {
  const t = typeInfo(race?.type);
  if (t.km != null) return t.label;
  return race?.name || t.long;
}

/** Título de la fila: el nombre si lo hay, si no el tipo largo. */
export const raceTitle = (race) => race?.name || typeInfo(race?.type).long;

/** «hoy» · «mañana» · «en 73 días» · «hace 3 días». */
export function whenText(date, today = todayStr()) {
  const n = diffDays(today, date);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  return n > 0 ? `en ${fmtNum(n, 0)} días` : `hace ${fmtNum(-n, 0)} días`;
}

/** «10 km» · «21,1 km» · null. */
export const distanceText = (race) => (isNum(race?.distanceKm) ? `${fmtNum(race.distanceKm, race.distanceKm % 1 ? 1 : 0)} km` : null);
/** «<50:00» · null. */
export const targetText = (race) => (isNum(race?.targetSec) ? `<${fmtDuration(race.targetSec)}` : null);

/** La línea de Hoy: «10K · 73 días · objetivo <50:00» («hoy», «mañana»; sin objetivo, sin esa parte). */
export function todayLine(race, today = todayStr()) {
  const n = diffDays(today, race.date);
  const days = n === 0 ? 'hoy' : n === 1 ? 'mañana' : `${fmtNum(n, 0)} días`;
  const tgt = targetText(race);
  return [raceShortLabel(race), days, tgt ? `objetivo ${tgt}` : null].filter(Boolean).join(' · ');
}

/** Detalle de la fila: «sáb 13 dic · 10 km · A · en 73 días». */
export function rowMeta(race, today = todayStr()) {
  return [fmtDate(race.date, race.date.slice(0, 4) === today.slice(0, 4) ? 'short' : 'full'), distanceText(race), `Prioridad ${race.priority}`, whenText(race.date, today)].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Selección
// ---------------------------------------------------------------------------

/** Próximos (hoy incluido), del más cercano al más lejano, y pasados, del más reciente al más antiguo. */
export function splitRaces(list, today = todayStr()) {
  const all = normalizeRaces(list);
  return { upcoming: all.filter((r) => r.date >= today), past: all.filter((r) => r.date < today).reverse() };
}

/**
 * El evento de Hoy (como mucho uno): el más cercano de prioridad A o B en los próximos 365 días; si no hay, el más
 * cercano de prioridad C en los próximos 30. A igual fecha, el de mayor prioridad.
 */
export function nextRelevant(list, today = todayStr()) {
  const { upcoming } = splitRaces(list, today);
  const within = (r, days) => diffDays(today, r.date) <= days;
  const byPrio = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.priority.localeCompare(b.priority));
  const ab = upcoming.filter((r) => r.priority !== 'C' && within(r, TODAY_AB_DAYS)).sort(byPrio);
  if (ab.length) return ab[0];
  return upcoming.filter((r) => r.priority === 'C' && within(r, TODAY_C_DAYS)).sort(byPrio)[0] || null;
}

/**
 * Lo que el analista puede usar: los eventos de las próximas 26 semanas (y el más próximo), con días y semanas que
 * faltan. → { next, upcoming:[{ race, days, weeks, sport }], labels:[{ key, text }] }
 */
export function racesContext(list, today = todayStr()) {
  const upcoming = splitRaces(list, today).upcoming.filter((r) => diffDays(today, r.date) <= CONTEXT_DAYS)
    .map((race) => { const days = diffDays(today, race.date); return { race, days, weeks: Math.floor(days / 7), sport: sportOf(race) }; });
  const first = nextRelevant(list, today);
  const next = first ? upcoming.find((x) => x.race.id === first.id) || null : null;
  const labels = upcoming.slice(0, 3).map((x) => ({ key: `race:${x.race.id}`, text: `${raceTitle(x.race)}${x.race.name && typeInfo(x.race.type).km != null ? ` (${typeInfo(x.race.type).label})` : ''} · ${fmtDate(x.race.date, 'short')} (${whenText(x.race.date, today)})${x.race.targetSec ? ` · objetivo ${targetText(x.race)}` : ''} · prioridad ${x.race.priority}` }));
  return { next, upcoming, labels };
}
