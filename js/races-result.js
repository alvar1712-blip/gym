// races-result.js — «¿Cómo te fue?»: el resultado de un evento pasado (ronda 8, D; docs/MEJORAS.md §8). PURO.
//
// Una sola fuente de verdad: el evento (races-logic, campo `outcome`) solo REFERENCIA su resultado.
//   · actividad vinculada (`activityId` → 'sessions'): el tiempo es el de la actividad (stats.actSec, el mismo de
//     Récords, predicciones y objetivos) o, si fue claramente más larga, su mejor tramo (stats.runMarkFor);
//   · resultado a mano de una carrera a pie (`contextId` → un 'race_result' de tu contexto): se lee de esa entrada, que
//     también usan Récords, los tiempos previstos y el informe (ninguno necesita código nuevo);
//   · resultado a mano de otro deporte (`manual`): única copia, porque nadie más la lee (una ruta de 20 km en 5 h no
//     debe entrar en el motor de carrera).
// La predicción previa NO se guarda: es race-predict.predictFor con «hoy» = la víspera del evento (determinista, sin
// datos posteriores). El récord es el de stats.enduranceRecords (ni un segundo sistema ni una copia).
// Aparte de races-logic.js para que Hoy no cargue race-predict ni stats.
import { addDays, diffDays, isDateStr, fmtDate, fmtNum, fmtRaceTime, fmtTimeWords } from './util.js';
import { predictFor, baseOf, rangeText } from './race-predict.js';
import { enduranceRecords, runMarkFor, actSec, RECORD_DISTANCES } from './stats.js';
import { normalizeEntry, normalizeAll, isRaceResult, entryRange, approxFrom, RESULT_DUP_TOL } from './context-logic.js';
import { normalizeRace, normalizeRaces, normalizeOutcome, sportOf, fixedKm, typeInfo, raceTitle, targetText } from './races-logic.js';
import { activityTitle } from './activity-logic.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toArr = (x) => (Array.isArray(x) ? x : x instanceof Map ? [...x.values()] : x && typeof x === 'object' ? Object.values(x) : []);
const kmTxt = (km) => `${fmtNum(km, 2)} km`;
const EPS = 1e-9;

/** Una actividad cuenta como el recorrido entero de la prueba si su distancia está a ±5 % (GPS; la regla de matchesRun). */
export const COMPARABLE_TOL = RESULT_DUP_TOL;
/** Candidata «cercana»: distancia a ±10 % de la del evento. */
export const CLOSE_TOL = 0.1;
/** Tipos de actividad que pueden ser el resultado de cada deporte (triatlón y «otro»: cualquiera salvo fuerza). */
const KINDS_FOR = { run: ['run'], bike: ['bike'], hike: ['hike'] };
const ANY_KIND = ['run', 'bike', 'swim', 'hike', 'other'];

/** Distancia del evento (la fija de su tipo o la apuntada) o null. */
export const raceKm = (race) => (race ? fixedKm(race.type) ?? (isNum(race.distanceKm) && race.distanceKm > 0 ? race.distanceKm : null) : null);
const kindsFor = (race) => KINDS_FOR[sportOf(race)] || ANY_KIND;

/** Ids ya vinculados a OTRO evento (una actividad o una marca es el resultado de un solo evento). */
function takenBy(races, raceId) {
  const acts = new Set();
  const ctx = new Set();
  for (const r of normalizeRaces(races)) {
    if (r.id === raceId || r.outcome?.status !== 'done') continue;
    if (r.outcome.activityId) acts.add(r.outcome.activityId);
    if (r.outcome.contextId) ctx.add(r.outcome.contextId);
  }
  return { acts, ctx };
}

/**
 * Qué se puede vincular: actividades hechas del día anterior al posterior al evento, del deporte del evento (fuerza
 * nunca) y, en carrera a pie, tus resultados de carrera de esos días. Sin lo que ya es el resultado de otro evento.
 * Orden: lo más cercano al día del evento y, después, a su distancia.
 * @returns {{ activities:{id, kind, date, km, sec, label, sub, dayOffset, close}[], results:{id, date, km, sec, label, sub}[] }}
 */
export function resultCandidates(data, race, races = []) {
  const r = normalizeRace(race);
  if (!r) return { activities: [], results: [] };
  const lo = addDays(r.date, -1);
  const hi = addDays(r.date, 1);
  const X = raceKm(r);
  const kinds = kindsFor(r);
  const { acts, ctx } = takenBy(races, r.id);
  const activities = [];
  for (const a of toArr(data?.sessions)) {
    if (!a || a.status !== 'done' || !kinds.includes(a.kind) || !isDateStr(a.date) || a.date < lo || a.date > hi || acts.has(String(a.id))) continue;
    const km = a.distanceKm > 0 ? a.distanceKm : null;
    const sec = actSec(a);
    const dayOffset = diffDays(r.date, a.date);
    activities.push({
      id: String(a.id), kind: a.kind, date: a.date, km, sec, dayOffset,
      close: X != null && km != null && Math.abs(km - X) <= CLOSE_TOL * X + EPS,
      label: activityTitle(a),
      sub: [fmtDate(a.date), km != null ? kmTxt(km) : null, fmtRaceTime(sec)].filter(Boolean).join(' · '),
    });
  }
  const kmGap = (x) => (X == null || x.km == null ? Infinity : Math.abs(x.km - X));
  activities.sort((a, b) => Math.abs(a.dayOffset) - Math.abs(b.dayOffset) || kmGap(a) - kmGap(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const results = [];
  if (sportOf(r) === 'run') {
    for (const e of normalizeAll(toArr(data?.context))) {
      if (!isRaceResult(e) || !e.result || ctx.has(String(e.id))) continue;
      const { from, to } = entryRange(e);
      if (!from || to < lo || from > hi) continue;
      results.push({
        id: String(e.id), date: from, km: e.result.km, sec: e.result.sec,
        label: e.text || 'Resultado de carrera',
        sub: [e.date.precision === 'day' ? fmtDate(from) : null, kmTxt(e.result.km), fmtRaceTime(e.result.sec)].filter(Boolean).join(' · '),
      });
    }
    results.sort((a, b) => kmGap(a) - kmGap(b) || (a.id < b.id ? -1 : 1));
  }
  return { activities, results };
}

const findById = (list, id) => toArr(list).find((x) => x && String(x.id) === String(id)) || null;

/**
 * El resultado al que apunta el evento, leído de su fuente.
 * @returns {{ state:'pending'|'done'|'dns'|'skipped'|'missing', source:'activity'|'context'|'manual'|null, sec, km, date, dateExact (día exacto: actividad o marca de precisión «día»),
 *   kind, activityId, contextId, how:'full'|'partial'|null, partialText, missing:'activity'|'context'|null,
 *   comparable, place, note }}
 *  how 'partial': la actividad fue claramente más larga que la prueba (más de un 5 %) y tiene un mejor tramo válido en
 *  esa distancia (stats.runMarkFor): «Parcial dentro de 12,4 km». Si no, el tiempo es el de la actividad entera
 *  (nunca se estima a ritmo medio: un resultado es un tiempo medido). comparable = la distancia del resultado es la del
 *  evento a ±5 % (o el evento no tiene distancia): solo entonces se compara con el objetivo y con la predicción.
 */
export function resolveResult(data, race) {
  const r = normalizeRace(race);
  const o = r ? r.outcome : normalizeOutcome(race?.outcome);
  const empty = { source: null, sec: null, km: null, date: null, dateExact: false, kind: null, activityId: null, contextId: null, how: null, partialText: null, missing: null, comparable: false, place: null, note: o?.note || '' };
  if (!o) return { ...empty, state: 'pending' };
  if (o.status !== 'done') return { ...empty, state: o.status };
  const X = r ? raceKm(r) : null;
  const run = r && sportOf(r) === 'run';
  const near = (km) => X == null || (km != null && Math.abs(km - X) <= COMPARABLE_TOL * X + EPS);
  const base = { ...empty, place: o.place, note: o.note, activityId: o.activityId, contextId: o.contextId };
  if (o.activityId) {
    const a = findById(data?.sessions, o.activityId);
    if (!a || a.status !== 'done' || a.kind === 'strength') return { ...base, state: 'missing', source: 'activity', missing: 'activity' };
    const km = a.distanceKm > 0 ? a.distanceKm : null;
    const sec = actSec(a);
    if (run && X != null && km != null && km > X * (1 + COMPARABLE_TOL) + EPS) {
      const m = runMarkFor(a, X);
      if (m && m.how === 'partial') {
        return { ...base, state: 'done', source: 'activity', sec: Math.round(m.timeSec), km: X, date: a.date, dateExact: true, kind: a.kind, how: 'partial', partialText: `Parcial dentro de ${fmtNum(km, 1)} km`, comparable: true };
      }
    }
    return { ...base, state: 'done', source: 'activity', sec: isNum(sec) ? Math.round(sec) : null, km, date: a.date, dateExact: true, kind: a.kind, how: 'full', comparable: isNum(sec) && near(km) };
  }
  if (o.contextId) {
    const e = normalizeEntry(findById(data?.context, o.contextId));
    if (!e || !isRaceResult(e) || !e.result) return { ...base, state: 'missing', source: 'context', missing: 'context' };
    return { ...base, state: 'done', source: 'context', sec: e.result.sec, km: e.result.km, date: approxFrom(e.date), dateExact: e.date.precision === 'day', kind: 'run', how: 'full', comparable: near(e.result.km) };
  }
  const m = o.manual;
  return { ...base, state: 'done', source: 'manual', sec: m.sec, km: m.km, date: r?.date ?? null, kind: sportOf(r) || null, how: 'full', comparable: X == null || m.km == null || near(m.km) };
}

/**
 * Resultado frente al objetivo, en tono neutro y exacto al segundo (es un tiempo medido: sin el redondeo de fmtGap).
 * @returns {{ diffSec, kind:'better'|'worse'|'equal', text, short }|null}  diffSec = resultado − objetivo.
 */
export function compareResult(sec, targetSec) {
  if (!isNum(sec) || !isNum(targetSec) || !(sec > 0) || !(targetSec > 0)) return null;
  const diffSec = Math.round(sec) - Math.round(targetSec);
  if (Math.abs(diffSec) < 1) return { diffSec: 0, kind: 'equal', text: 'Igual que el objetivo', short: 'igual que el objetivo' };
  const w = fmtTimeWords(Math.abs(diffSec));
  return diffSec < 0
    ? { diffSec, kind: 'better', text: `${w} mejor que el objetivo`, short: `${w} mejor` }
    : { diffSec, kind: 'worse', text: `${w} peor que el objetivo`, short: `${w} peor` };
}

const NO_PRIOR = {
  no_run: 'La predicción previa solo existe para carreras a pie.',
  no_distance: 'Sin predicción previa: el evento no tiene distancia.',
  insuficiente: 'Sin predicción previa: no había datos suficientes antes del evento.',
  no_util: 'Sin predicción previa: tus carreras de antes del evento no daban una estimación útil.',
};

/**
 * Lo que el motor ÚNICO (race-predict.predictFor) estimaba la víspera del evento, con los datos hasta ese día (nada
 * posterior: ni el propio resultado). Se calcula al mostrarla; no se guarda.
 * `resultDate` (día exacto del resultado vinculado): si es ANTERIOR al evento (la ventana de vínculo admite el día
 * anterior: zona horaria, fecha del evento mal puesta), la previsión es la de su víspera; si no, el resultado
 * entraría en su propia predicción previa.
 * @returns {{ ok:true, asOf, low, high, mid, range, confidence, confidenceLabel, status, base } |
 *   { ok:false, reason:'no_run'|'no_distance'|'insuficiente'|'no_util', text, asOf }}
 */
export function priorPrediction(data, race, { resultDate = null } = {}) {
  const r = normalizeRace(race);
  const asOf = r ? addDays(isDateStr(resultDate) && resultDate < r.date ? resultDate : r.date, -1) : null;
  const no = (reason) => ({ ok: false, reason, text: NO_PRIOR[reason], asOf });
  if (!r || sportOf(r) !== 'run') return no('no_run');
  const km = raceKm(r);
  if (km == null) return no('no_distance');
  const res = predictFor(data, km, { today: asOf });
  if (!res.ok) return no('insuficiente');
  const p = res.prediction;
  if (!p.usable) return no('no_util');
  return { ok: true, asOf, low: p.low, high: p.high, mid: p.mid, range: rangeText(p), confidence: p.confidence, confidenceLabel: p.confidenceLabel, status: p.status, base: baseOf(p) };
}

/** ¿Dónde cayó el resultado respecto al rango previsto? Los extremos cuentan como dentro. */
export function rangePosition(sec, prior) {
  if (!isNum(sec) || !prior || !prior.ok) return null;
  if (sec < prior.low) return 'faster';
  if (sec > prior.high) return 'slower';
  return 'inside';
}
export const POSITION_TEXT = { inside: 'Dentro del rango previsto', faster: 'Más rápido que el rango previsto', slower: 'Más lento que el rango previsto' };
const POSITION_SHORT = { inside: 'dentro del rango', faster: 'más rápido que el rango', slower: 'más lento que el rango' };

// Récords «en su momento»: los mismos récords (stats.enduranceRecords) con los datos hasta el día del evento.
const AS_OF = new WeakMap();
function recordsAsOf(data, date) {
  let m = AS_OF.get(data);
  if (!m || m.sessions !== data.sessions || m.context !== data.context) {
    m = { sessions: data.sessions, context: data.context, byDate: new Map() };
    AS_OF.set(data, m);
  }
  if (!m.byDate.has(date)) {
    const cut = {
      ...data,
      sessions: toArr(data.sessions).filter((s) => s && isDateStr(s.date) && s.date <= date),
      context: toArr(data.context).filter((e) => { const n = normalizeEntry(e); return !!n && n.kind === 'event' && approxFrom(n.date) <= date; }),
      today: date,
    };
    m.byDate.set(date, enduranceRecords(cut));
  }
  return m.byDate.get(date);
}

/**
 * ¿Es (o fue) récord? Reutiliza stats.enduranceRecords: «récord actual» si el resultado vinculado es hoy el titular
 * (por sessionId, entryId o alsoContext) y, si no, «fue tu récord en su momento» con los récords hasta el día del
 * evento. Bici y senderismo: «tu salida/ruta más larga» si es el titular de `longest`.
 * @returns {{ current:{id,label}|null, atTheTime:{id,label}|null, longest:string|null, href:'#/records?seg=endurance' }|null}
 */
export function resultRecord(data, race, res, { atTheTime = true } = {}) {
  const r = normalizeRace(race);
  if (!r || !res || res.state !== 'done' || !data) return null;
  const sport = sportOf(r);
  if (sport === 'run') {
    const X = raceKm(r);
    const rd = X != null && res.comparable ? RECORD_DISTANCES.find((d) => Math.abs(d.km - X) < 1e-6) : null;
    if (!rd || (!res.activityId && !res.contextId)) return null;
    const holds = (b) => !!b && ((res.activityId && b.sessionId === res.activityId) || (res.contextId && (b.entryId === res.contextId || b.alsoContext === res.contextId)));
    const current = holds(enduranceRecords(data).run.best[rd.id]) ? { id: rd.id, label: `Tu récord en ${rd.label}` } : null;
    const then = !current && atTheTime && holds(recordsAsOf(data, r.date).run.best[rd.id]) ? { id: rd.id, label: `Fue tu récord en ${rd.label} en su momento` } : null;
    return current || then ? { current, atTheTime: then, longest: null, href: '#/records?seg=endurance' } : null;
  }
  if ((sport === 'bike' || sport === 'hike') && res.activityId && res.kind === sport) {
    const l = enduranceRecords(data)[sport]?.longest;
    if (l && l.sessionId === res.activityId) return { current: null, atTheTime: null, longest: sport === 'bike' ? 'Tu salida en bici más larga' : 'Tu ruta más larga', href: '#/records?seg=endurance' };
  }
  return null;
}

/**
 * Todo lo que enseña un evento sobre su resultado. `prior` y `record` cuestan más (un análisis de carreras y los
 * récords): la lista los pide apagados; el detalle, encendidos.
 * @returns {{ state, result, target:{sec, text}|null, diff, prior, position, record, rowText:string|null }}
 *  rowText (fila de la lista): «Resultado 49:18 · 42 s mejor que el objetivo» · «No participaste» · «El resultado ya
 *  no existe» · null (sin responder u omitido).
 */
export function outcomeView(data, race, { prior = true, record = true } = {}) {
  const r = normalizeRace(race);
  const result = resolveResult(data, r || race);
  const target = r && isNum(r.targetSec) ? { sec: r.targetSec, text: targetText(r) } : null;
  const done = result.state === 'done';
  const diff = done && result.comparable && target ? compareResult(result.sec, target.sec) : null;
  const pr = done && prior && r && sportOf(r) === 'run' ? priorPrediction(data, r, { resultDate: result.dateExact ? result.date : null }) : null;
  const position = pr && pr.ok && result.comparable ? rangePosition(result.sec, pr) : null;
  const rec = done && record ? resultRecord(data, r, result) : null;
  let rowText = null;
  if (done) rowText = `Resultado ${fmtRaceTime(result.sec) ?? '—'}${diff ? ` · ${diff.text}` : ''}`;
  else if (result.state === 'dns') rowText = 'No participaste';
  else if (result.state === 'missing') rowText = 'El resultado ya no existe';
  return { state: result.state, result, target, diff, prior: pr, position, record: rec, rowText };
}

/** Eventos de los últimos `days` días con resultado o «no participó», del más reciente al más antiguo, para el informe. */
export const REPORT_PAST_MAX = 6;

/**
 * Eventos recientes para el informe para IA: { race, date, bits:[…] } con el resultado frente al objetivo y a la
 * previsión previa (o «no participó»). Los omitidos, los sin responder y los de resultado borrado no salen. Sin notas
 * (privacidad, como el resto del informe).
 */
export function pastEventsForReport(data, races, today, days = 182) {
  const from = addDays(today, -days);
  const out = [];
  for (const r of normalizeRaces(races).reverse()) {
    if (r.date > today || r.date < from || !r.outcome || r.outcome.status === 'skipped') continue;
    const tgt = targetText(r);
    if (r.outcome.status === 'dns') {
      out.push({ race: r, date: r.date, bits: [tgt ? `objetivo ${tgt}` : null, 'no participó'].filter(Boolean) });
    } else {
      const v = outcomeView(data, r, { record: false });
      if (v.state !== 'done') continue;
      const res = v.result;
      const bits = [tgt ? `objetivo ${tgt}` : null];
      const kmBit = res.km != null && (!res.comparable || raceKm(r) == null) ? `, ${kmTxt(res.km)}` : '';
      bits.push(`resultado ${fmtRaceTime(res.sec) ?? '—'}${kmBit}${v.diff ? ` (${v.diff.short})` : ''}${res.how === 'partial' ? ` (${res.partialText.toLowerCase()})` : ''}`);
      if (res.place) bits.push(`puesto ${fmtNum(res.place, 0)}`);
      if (v.prior?.ok) bits.push(`previsión previa ${v.prior.range}${v.position ? ` (${POSITION_SHORT[v.position]})` : ''}`);
      out.push({ race: r, date: r.date, bits: bits.filter(Boolean) });
    }
    if (out.length >= REPORT_PAST_MAX) break;
  }
  return out;
}

/** Título del evento con su tipo si tiene nombre (para textos): «San Silvestre (10K)» · «10K». */
export function eventLabel(race) {
  const t = typeInfo(race?.type);
  return race?.name ? `${race.name}${t.km != null ? ` (${t.label})` : ''}` : raceTitle(race);
}
