// history-logic.js — lógica PURA del historial y de los resúmenes de sesión (sin DOM ni store).
// PROPIETARIO: módulo de calendario. Se prueba en Node (tests/unit/plan.test.mjs).
import { fmtNum, fmtMinutes, fmtPace, fmtSpeed, fmtKm, sortBy, MONTH_LONG, parseDate } from './util.js';
import { isWorkSet, sessionVolume, sessionDurationMin, sessionLoad, pace, speed, pace100 } from './calc.js';
import { ACTIVITY_LABEL, ACTIVITY_EMOJI, RUN_TYPES, BIKE_TYPES, OTHER_TYPES } from './seed.js';

/** Filtros del historial (Todas, Fuerza, Carrera, Bici, Natación, Otras). */
export const HISTORY_FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'strength', label: 'Fuerza' },
  { value: 'run', label: 'Carrera' },
  { value: 'bike', label: 'Bici' },
  { value: 'swim', label: 'Natación' },
  { value: 'other', label: 'Otras' },
];
const FILTER_IDS = HISTORY_FILTERS.map((f) => f.value);
export const isHistoryFilter = (f) => FILTER_IDS.includes(f);

/** Sesiones del filtro, de más reciente a más antigua. */
export function filterSessions(sessions, filter = 'all') {
  const f = isHistoryFilter(filter) ? filter : 'all';
  const list = (sessions || []).filter((s) => s && s.date && (f === 'all' || s.kind === f));
  return sortBy(list, '-date', (s) => -(s.startedAt || s.createdAt || 0));
}

/** 'septiembre de 2026' → con mayúscula inicial. */
export function monthLabel(key) {
  const d = parseDate(`${key}-01`);
  const txt = `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/**
 * Agrupa por mes (clave 'YYYY-MM'), conservando el orden de entrada.
 * @returns {Array<{key, label, sessions, count, minutes}>}
 */
export function groupByMonth(sessions) {
  const groups = [];
  const byKey = new Map();
  for (const s of sessions || []) {
    const key = String(s.date).slice(0, 7);
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: monthLabel(key), sessions: [], count: 0, minutes: 0 };
      byKey.set(key, g);
      groups.push(g);
    }
    g.sessions.push(s);
    g.count++;
    // Las actividades enlazadas a una sesión de fuerza ya están descontadas de su duración.
    const m = s.status === 'done' ? sessionDurationMin(s) : null;
    if (m) g.minutes += m;
  }
  return groups;
}

/** Nº de series de trabajo de una sesión de fuerza. */
export function workSets(session) {
  let n = 0;
  for (const se of session.exercises || []) for (const st of se.sets || []) if (isWorkSet(st)) n++;
  return n;
}

const SUBTYPES = { run: RUN_TYPES, bike: BIKE_TYPES, other: OTHER_TYPES };

/** Nombre de la sesión: plantilla, «Sesión libre» o título de la actividad. */
export function sessionTitle(s) {
  if (!s) return '';
  if (s.kind === 'strength') return s.templateName || 'Sesión libre';
  if (s.templateName) return s.templateName;
  const base = ACTIVITY_LABEL[s.kind] || 'Actividad';
  const sub = (SUBTYPES[s.kind] || []).find((o) => o.id === s.subtype);
  if (s.kind === 'other' && s.subtype) return sub ? sub.label : String(s.subtype);
  return sub ? `${base} · ${sub.label}` : base;
}

/**
 * Dato clave de una sesión:
 *  fuerza → «12 series · 4.350 kg»; carrera → «10 km · 5:00 /km»; bici → «42,5 km · 28,3 km/h»;
 *  natación → «1.500 m · 2:00 /100 m»; otras → ''.
 * @param {object} s sesión
 * @param {{exMap?:Map|object, bwFn?:(date)=>number}} [opts] para el volumen de fuerza
 */
export function keyStat(s, { exMap = null, bwFn = () => null } = {}) {
  if (!s) return '';
  if (s.kind === 'strength') {
    const n = workSets(s);
    const parts = [`${n} ${n === 1 ? 'serie' : 'series'}`];
    if (exMap) {
      const v = sessionVolume(s, exMap, bwFn);
      if (v > 0) parts.push(`${fmtNum(v, 0)} kg`);
    }
    return parts.join(' · ');
  }
  const km = s.distanceKm;
  const sec = s.movingSec ?? (typeof s.durationMin === 'number' ? s.durationMin * 60 : null);
  if (!(km > 0)) return '';
  if (s.kind === 'run') {
    const p = pace(sec, km);
    return p ? `${fmtKm(km, 2)} · ${fmtPace(p)}` : fmtKm(km, 2);
  }
  if (s.kind === 'bike') {
    const v = speed(sec, km);
    return v ? `${fmtKm(km, 1)} · ${fmtSpeed(v)}` : fmtKm(km, 1);
  }
  if (s.kind === 'swim') {
    const p = pace100(sec, km);
    const m = `${fmtNum(km * 1000, 0)} m`;
    return p ? `${m} · ${fmtPace(p, '/100 m')}` : m;
  }
  return fmtKm(km, 2);
}

/**
 * Resumen para una fila de lista.
 * @returns {{emoji, title, duration, load, key, active:boolean, href}}
 */
export function sessionSummary(s, opts = {}) {
  const active = s.status === 'active';
  const min = active ? null : sessionDurationMin(s);
  const load = active ? null : sessionLoad(s);
  return {
    emoji: ACTIVITY_EMOJI[s.kind] || '⚡',
    title: sessionTitle(s),
    duration: active ? 'en curso' : min != null ? fmtMinutes(min) : '',
    load: load != null ? `carga ${fmtNum(load, 0)}` : '',
    key: keyStat(s, opts),
    active,
    href: s.kind === 'strength' ? `#/session/${s.id}` : `#/activity/${s.id}`,
  };
}
