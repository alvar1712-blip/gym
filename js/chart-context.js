// chart-context.js — «Tu contexto» dentro de las gráficas (ronda 8, E; docs/MEJORAS.md §9). PURO: sin DOM ni store.
//
// Las gráficas de Progreso, de la ficha de ejercicio, de #/bodyweight y del análisis pintan una franja fina arriba
// (charts.js, opción `context`) con las fases (segmentos de un solo color neutro) y los hechos (puntos) de tu
// contexto. Aquí se decide QUÉ entra en cada gráfica y con qué nombre; charts.js solo dibuja.
//
//   contextItems({ context, races, sessions, today, rev }) → { phases, facts }   (todo normalizado, caché de un hueco)
//   chartContext(items, profileId, { key, defaultOn, sport }) → cc               (lo que recibe charts.js)
//   ctxLine(cc, d0, d1) → 'Inicio creatina · +1' | null                         (línea del globo de un punto)
//   ctxAria(cc, d0, d1) → 'Contexto: Parón (fase), Inicio creatina el 15 sep y 2 más' | ''
//
// Una sola fuente de verdad: nada se copia. Las fases y hechos se leen de 'context'; un evento pasado con resultado,
// de 'races' + resolveResult (el mismo resultado que la tarjeta «¿Cómo te fue?»). Un resultado de carrera de tu
// contexto que es el resultado de un evento (outcome.contextId) se pinta UNA vez, como evento.
// Nombres: `short` del tipo («Parón»); en los tipos personalizada y «Otro», su texto (que entonces sí es un nombre).
import { fmtDate, fmtRaceTime, addDays, isDateStr } from './util.js';
import { normalizeAll, entryRange, approxLabel, phaseType, eventType, resultDistanceLabel, isRaceResult } from './context-logic.js';
import { normalizeRaces, sportOf, raceShortLabel } from './races-logic.js';
import { resolveResult } from './races-result.js';

/**
 * Perfiles: qué entra en cada gráfica. El orden de `aspects` es la prioridad de las fases (la primera da el nombre
 * cuando hay varias a la vez). facts 'noRace': sin resultados ni eventos de carrera (no explican el peso ni la fuerza).
 * sportFilter: las fases de deporte de OTRO deporte (y los eventos de otro deporte) no entran (Prep. ciclismo no explica
 * tu ritmo de carrera; Híbrido, sin deporte, sí).
 */
export const CHART_PROFILES = {
  weight: { aspects: ['life', 'training', 'body', 'custom'], facts: 'noRace' },
  strength: { aspects: ['life', 'training', 'body', 'custom'], facts: 'noRace' },
  endurance: { aspects: ['life', 'training', 'sport', 'custom'], facts: 'all', sportFilter: true },
  load: { aspects: ['life', 'training', 'sport', 'custom'], facts: 'all' },
};
/** Referencias, no cosas que pasen: nunca salen en una gráfica. */
const SKIP_FACTS = new Set(['usual_weight', 'weight']);
/** Precisión que se puede situar con honradez en un eje de días: día (relleno) y mes (hueco, a mitad de mes). */
const DRAWN = new Set(['day', 'month']);

const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);
const get = (v) => (typeof v === 'function' ? v() : v); // los datos pueden llegar perezosos (solo se leen si falta la caché)

/** Nombre de una entrada en la franja: su texto en personalizada / «Otro»; si no, el nombre corto del tipo. */
function nameOf(e) {
  if (isRaceResult(e)) {
    const r = e.result;
    if (!r) return e.text || 'Resultado de carrera';
    return `${e.text || resultDistanceLabel(r.km)} · ${fmtRaceTime(r.sec) ?? '—'}`;
  }
  if ((e.type === 'custom' || e.type === 'other') && e.text) return e.text;
  const t = e.kind === 'event' ? eventType(e.type) : phaseType(e.type);
  return t?.short || t?.label || 'Contexto';
}

/**
 * Hecho ya situado: día → ese día; mes → día 15 (mitad de mes, marcador hueco). null si no se puede situar.
 * Mes en curso con el día 15 aún por llegar: hoy (si no, «oct 2026» desaparecía de todas las gráficas hasta el 15).
 */
function placeFact(approx, today) {
  if (!approx || !DRAWN.has(approx.precision)) return null;
  if (approx.precision === 'day') return { date: approx.date, when: fmtDate(approx.date, 'day'), hollow: false };
  const mid = addDays(approx.date, 14);
  const date = today && approx.date <= today && mid > today ? today : mid;
  return { date, when: approxLabel(approx, { short: true }), hollow: true };
}

let cache = { key: null, value: null };

/**
 * Todo el contexto que puede salir en una gráfica, normalizado una vez:
 *   fase:  { id, kind:'phase', from, to|null, name, aspect, sport|null, type }
 *   hecho: { id, kind:'fact', date, when, name, hollow, type, race, sport|null }
 * Caché de un solo hueco por revisiones (`rev` = store.revisions()) y `today`: con la misma clave devuelve el MISMO
 * objeto. `context`, `races` y `sessions` pueden ser funciones (se llaman solo si hay que recalcular).
 */
export function contextItems({ context = [], races = [], sessions = [], today, rev = null } = {}) {
  const key = rev ? `${rev.epoch}|${rev.context}|${rev.races}|${rev.sessions}|${today}` : null;
  if (key != null && cache.key === key) return cache.value;
  const ctxList = toArr(get(context));
  const raceList = normalizeRaces(get(races));
  const phases = [];
  const facts = [];
  const usedCtx = new Set(); // resultados de carrera que ya son el resultado de un evento
  // Eventos pasados con resultado: un hecho más, con su tiempo («10K Valencia · 49:18»)
  let sess = null;
  for (const r of raceList) {
    if (!(r.date <= today) || r.outcome?.status !== 'done') continue;
    if (sess == null) sess = toArr(get(sessions));
    const res = resolveResult({ sessions: sess, context: ctxList }, r);
    if (res.state !== 'done') continue;
    if (res.contextId) usedCtx.add(String(res.contextId));
    const date = res.dateExact && isDateStr(res.date) ? res.date : r.date;
    if (date > today) continue;
    const t = res.sec != null ? fmtRaceTime(res.sec) : null;
    facts.push({
      id: `race:${r.id}`, kind: 'fact', date, when: fmtDate(date, 'day'), hollow: false, type: 'race', race: true,
      sport: sportOf(r), name: `${r.name || raceShortLabel(r)}${t ? ` · ${t}` : ''}`,
    });
  }
  for (const e of normalizeAll(ctxList)) {
    if (e.kind === 'phase') {
      const { from, to } = entryRange(e);
      const t = phaseType(e.type);
      phases.push({ id: e.id, kind: 'phase', from, to, name: nameOf(e), aspect: t?.aspect || 'custom', sport: t?.sport ?? null, type: e.type });
      continue;
    }
    if (SKIP_FACTS.has(e.type) || usedCtx.has(String(e.id))) continue;
    const at = placeFact(e.date, today);
    if (!at || at.date > today) continue;
    const race = isRaceResult(e);
    facts.push({ id: e.id, kind: 'fact', ...at, name: nameOf(e), type: e.type, race, sport: race ? 'run' : null });
  }
  // Por fecha; el mismo día, primero el de fecha exacta (relleno) y después el de un mes (hueco)
  facts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.hollow ? 1 : 0) - (b.hollow ? 1 : 0)));
  phases.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const value = { phases, facts, byProfile: new Map() };
  if (key != null) cache = { key, value };
  return value;
}

/**
 * Lo que recibe charts.js (opción `context`) para un perfil:
 *   { key, defaultOn, phases:[{ from, to|null, name, rank }], facts:[{ date, when, name, hollow }], line(d0, d1), aria(d0, d1) }
 * rank = prioridad (0 = la que da el nombre): orden del aspecto en el perfil y, a igualdad, la más reciente.
 * Cacheado por perfil + deporte dentro de `items` (se tira solo cuando cambia items).
 */
export function chartContext(items, profileId, { key, defaultOn = true, sport = null } = {}) {
  const prof = CHART_PROFILES[profileId] || CHART_PROFILES.weight;
  const ck = `${profileId}|${sport || ''}`;
  let base = items?.byProfile?.get(ck);
  if (!base) {
    const okSport = (s) => !prof.sportFilter || !sport || s == null || s === sport;
    const phases = (items?.phases || [])
      .filter((p) => prof.aspects.includes(p.aspect) && (p.aspect !== 'sport' || okSport(p.sport)))
      .map((p) => ({ from: p.from, to: p.to, name: p.name, prio: prof.aspects.indexOf(p.aspect) }))
      .sort((a, b) => a.prio - b.prio || (a.from < b.from ? 1 : a.from > b.from ? -1 : 0))
      .map((p, rank) => ({ from: p.from, to: p.to, name: p.name, rank }));
    const facts = (items?.facts || [])
      .filter((f) => (prof.facts === 'all' || !f.race) && (!f.race || okSport(f.sport)))
      .map((f) => ({ date: f.date, when: f.when, name: f.name, hollow: f.hollow }));
    base = { phases, facts };
    items?.byProfile?.set(ck, base);
  }
  const cc = { key, defaultOn: !!defaultOn, phases: base.phases, facts: base.facts };
  cc.line = (d0, d1) => ctxLine(cc, d0, d1);
  cc.aria = (d0, d1) => ctxAria(cc, d0, d1);
  return cc;
}

/** Fases vigentes algún día de [d0, d1], por prioridad. */
const phasesIn = (cc, d0, d1) => (cc?.phases || []).filter((p) => p.from <= d1 && (p.to == null || p.to >= d0)).sort((a, b) => a.rank - b.rank);
/** Hechos situados en [d0, d1], por fecha. */
const factsIn = (cc, d0, d1) => (cc?.facts || []).filter((f) => f.date >= d0 && f.date <= d1);

/**
 * Línea de contexto del globo de un punto (día: d0 = d1) o de una barra semanal: los hechos primero y después las
 * fases por prioridad; solo el primer nombre y «+N» con el resto. null si no hay nada.
 */
export function ctxLine(cc, d0, d1 = d0) {
  const names = [...factsIn(cc, d0, d1).map((f) => f.name), ...phasesIn(cc, d0, d1).map((p) => p.name)];
  if (!names.length) return null;
  return names.length > 1 ? `${names[0]} · +${names.length - 1}` : names[0];
}

/** Para el lector de pantalla: «Contexto: Parón (fase), Inicio creatina el 15 sep y 2 más» (3 como mucho). '' si nada. */
export function ctxAria(cc, d0, d1) {
  const items = [
    ...phasesIn(cc, d0, d1).map((p) => `${p.name} (fase)`),
    ...factsIn(cc, d0, d1).map((f) => `${f.name} ${f.hollow ? 'en' : 'el'} ${f.when}`),
  ];
  if (!items.length) return '';
  const shown = items.slice(0, 3);
  const rest = items.length - shown.length;
  if (rest > 0) return `Contexto: ${shown.join(', ')} y ${rest} más`;
  if (shown.length === 1) return `Contexto: ${shown[0]}`;
  return `Contexto: ${shown.slice(0, -1).join(', ')} y ${shown[shown.length - 1]}`;
}
