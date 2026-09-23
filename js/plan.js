// plan.js — lógica de calendario: semana tipo (con vigencias), excepciones por día y estados.
// PROPIETARIO: módulo de calendario. Las funciones de este bloque inicial son CONTRATO
// (las usa Ajustes): conservar nombres y firmas.
import * as store from './store.js';
import { weekStart, todayStr, deepClone } from './util.js';

/** Semana tipo vigente para una fecha: days[0]=lunes … days[6]=domingo. */
export function patternFor(settings, date) {
  const list = [...(settings.weekPatterns || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  let cur = list[0] || { days: Array.from({ length: 7 }, () => ({ kind: 'rest' })) };
  for (const p of list) if (p.from <= date) cur = p;
  return cur.days;
}

/**
 * Guarda una nueva semana tipo vigente desde el lunes de la semana actual
 * (las semanas anteriores conservan su semana tipo). Devuelve la promesa de guardado.
 */
export function setWeekPattern(days, { from = weekStart(todayStr()) } = {}) {
  const s = store.settings();
  const list = (s.weekPatterns || []).filter((p) => p.from !== from);
  list.push({ from, days: deepClone(days) });
  list.sort((a, b) => (a.from < b.from ? -1 : 1));
  return store.saveSettings({ weekPatterns: list });
}

/** Semana tipo vigente hoy. */
export function currentPattern() {
  return patternFor(store.settings(), todayStr());
}
