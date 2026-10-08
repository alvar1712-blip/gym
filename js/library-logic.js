// library-logic.js — lógica PURA de plantillas (rutinas) y biblioteca de ejercicios.
// PROPIETARIO: módulo de biblioteca. No importa store.js ni ui.js: recibe los datos por parámetro
// y se prueba en Node (tests/unit/library.test.mjs).
import { normalize, uid, deepClone, fmtNum, sortBy, plural } from './util.js';
import { isWorkSet, setMetrics } from './calc.js';

/** Campos de objetivo de un ítem de plantilla. */
export const TARGET_KEYS = ['sets', 'setsMax', 'repMin', 'repMax', 'timeMin', 'timeMax', 'distance'];
/** Tipos de registro cuyo objetivo es un rango de repeticiones. */
export const REP_LOG_TYPES = ['weight_reps', 'bodyweight', 'unilateral', 'jumps'];
export const GROUP_TYPES = ['superset', 'circuit'];
export const GROUP_LABEL = { superset: 'Superserie', circuit: 'Circuito' };
export const CATEGORY_OPTIONS = [
  { value: 'compound', label: 'Compuesto' },
  { value: 'isolation', label: 'Aislamiento' },
];
export const REGION_OPTIONS = [
  { value: 'upper', label: 'Tren superior' },
  { value: 'lower', label: 'Tren inferior' },
  { value: 'core', label: 'Core' },
  { value: 'full', label: 'Cuerpo completo' },
];
export const SPORT_OPTIONS = [
  { value: 'run', label: 'Carrera' },
  { value: 'bike', label: 'Bici' },
  { value: 'swim', label: 'Natación' },
];
/** Etiqueta corta del tipo de registro (listas). */
export const LOG_SHORT = {
  weight_reps: 'Peso × reps', bodyweight: 'Peso corporal', unilateral: 'Unilateral', time: 'Por tiempo',
  distance_time: 'Distancia y tiempo', jumps: 'Saltos', cardio: 'Cardio',
};
export const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.value, o.label]));
export const REGION_LABEL = Object.fromEntries(REGION_OPTIONS.map((o) => [o.value, o.label]));
export const SPORT_LABEL = Object.fromEntries(SPORT_OPTIONS.map((o) => [o.value, o.label]));

const logTypeOf = (ex) => (typeof ex === 'string' ? ex : ex?.logType) || 'weight_reps';

/** Familia de objetivo: 'reps' | 'time' | 'distance' | 'cardio'. */
export function targetFamily(logType) {
  if (logType === 'cardio') return 'cardio';
  if (logType === 'time') return 'time';
  if (logType === 'distance_time') return 'distance';
  return 'reps';
}

// ===========================================================================
// Texto del objetivo
// ===========================================================================

function range(a, b, dec = 1) {
  if (a == null && b == null) return '';
  if (a != null && b != null && b !== a) return `${fmtNum(a, dec)}–${fmtNum(b, dec)}`;
  return fmtNum(a ?? b, dec);
}

/**
 * Texto del objetivo tal y como se verá: «3×4–6», «2–3×30 m», «3×30–45 s», «30–45 min», «2×8/lado»,
 * «3 series». `exercise` puede ser el ejercicio o directamente su logType.
 */
export function targetText(item, exercise) {
  const t = item || {};
  const lt = logTypeOf(exercise);
  const fam = targetFamily(lt);
  if (fam === 'cardio') {
    const parts = [];
    const time = range(t.timeMin != null ? t.timeMin / 60 : null, t.timeMax != null ? t.timeMax / 60 : null, 0);
    if (time) parts.push(`${time} min`);
    if (t.distance > 0) parts.push(t.distance >= 1000 ? `${fmtNum(t.distance / 1000, 1)} km` : `${fmtNum(t.distance, 0)} m`);
    return parts.join(' · ');
  }
  const sets = range(t.sets, t.setsMax != null && t.sets != null && t.setsMax > t.sets ? t.setsMax : null, 0);
  const x = (s) => (sets ? `${sets}×${s}` : s);
  const reps = range(t.repMin, t.repMax, 0);
  if (fam === 'reps' && reps) return x(`${reps}${lt === 'unilateral' ? '/lado' : ''}`);
  const time = range(t.timeMin, t.timeMax, 0);
  if (fam === 'time' && time) return x(`${time} s`);
  if (fam === 'distance' && t.distance > 0) return x(`${fmtNum(t.distance, 1)} m`);
  if (sets) return `${sets} ${t.sets === 1 && !(t.setsMax > 1) ? 'serie' : 'series'}`;
  return '';
}

/** Objetivo por defecto al añadir un ejercicio a una plantilla. */
export function defaultTarget(logType) {
  switch (targetFamily(logType)) {
    case 'cardio': return { sets: 1, timeMin: 1800, timeMax: 2700 };
    case 'time': return { sets: 3, timeMin: 30, timeMax: 45 };
    case 'distance': return { sets: 4, distance: 20 };
    default: return logType === 'jumps' ? { sets: 3, repMin: 5, repMax: 5 } : { sets: 3, repMin: 8, repMax: 12 };
  }
}

/** Ítem de plantilla nuevo para un ejercicio. */
export function newItem(exerciseId, logType, { id = uid('ti_'), section = '' } = {}) {
  return {
    id, exerciseId, alternatives: [], ...defaultTarget(logType),
    notes: '', section: section || '', groupId: null, groupType: null,
  };
}

/**
 * Cambia el ejercicio de un ítem. Si el tipo de objetivo cambia (p. ej. reps → tiempo), el objetivo
 * pasa al de por defecto del tipo nuevo conservando el nº de series. Quita el nuevo de las alternativas.
 * Devuelve un ítem nuevo.
 */
export function changeItemExercise(item, exerciseId, oldLogType, newLogType) {
  const out = { ...item, exerciseId, alternatives: (item.alternatives || []).filter((a) => a !== exerciseId) };
  if (targetFamily(oldLogType) !== targetFamily(newLogType)) {
    for (const k of TARGET_KEYS) delete out[k];
    Object.assign(out, defaultTarget(newLogType));
    if (targetFamily(newLogType) !== 'cardio' && targetFamily(oldLogType) !== 'cardio' && item.sets > 0) {
      out.sets = item.sets;
      if (item.setsMax > item.sets) out.setsMax = item.setsMax;
    }
  }
  return out;
}

/**
 * Nuevo valor de «series máx.» tras tocar su stepper.
 *  - Un valor mayor que `sets` se acepta.
 *  - Con + desde vacío (el stepper propone un valor ≤ series) → series + 1.
 *  - Con − hasta ≤ series, o escrito ≤ series → vacío (sin rango).
 */
export function stepSetsMax(sets, prev, next, { typed = false } = {}) {
  if (next == null) return null;
  if (sets == null || next > sets) return next;
  return prev == null && !typed ? sets + 1 : null;
}

/**
 * Rango mín–máx tras cambiar un extremo (`which`: 'min' | 'max') a `value`. Si se cruzan, el otro
 * extremo se iguala; si el extremo estaba vacío (se pulsó +/− desde vacío), es él el que se ajusta al otro.
 * Devuelve [min, max].
 */
export function rangeChange(min, max, which, value, { fromEmpty = false } = {}) {
  const a = which === 'min' ? value : min;
  const b = which === 'max' ? value : max;
  if (a == null || b == null || a <= b) return [a, b];
  if (fromEmpty) return which === 'min' ? [b, b] : [a, a];
  return which === 'min' ? [a, a] : [b, b];
}

/** «Nueva rutina», «Nueva rutina 2»… sin repetir nombres existentes. */
export function uniqueName(base, existingNames = []) {
  const taken = new Set(existingNames.map((n) => normalize(n)));
  let out = base;
  let k = 2;
  while (taken.has(normalize(out))) out = `${base} ${k++}`;
  return out;
}

// ===========================================================================
// Plantillas: duplicar, ordenar, resumen
// ===========================================================================

/** «X (copia)», «X (copia 2)»… sin repetir nombres existentes. */
export function copyName(name, existingNames = []) {
  const taken = new Set(existingNames.map((n) => normalize(n)));
  let out = `${name} (copia)`;
  let k = 2;
  while (taken.has(normalize(out))) out = `${name} (copia ${k++})`;
  return out;
}

/**
 * Copia profunda de una plantilla con ids nuevos (plantilla, ítems y grupos).
 * Los grupos se conservan: los ítems que compartían groupId comparten el nuevo.
 */
export function duplicateTemplate(tpl, { name = null, order = null, newId = () => uid('tpl_'), newItemId = () => uid('ti_'), newGroupId = () => uid('g_') } = {}) {
  const copy = deepClone(tpl);
  copy.id = newId();
  copy.name = name ?? `${tpl.name} (copia)`;
  if (order != null) copy.order = order;
  copy.archived = false;
  delete copy.createdAt;
  delete copy.updatedAt;
  const groups = new Map();
  copy.items = (copy.items || []).map((it) => {
    let groupId = null;
    if (it.groupId) {
      if (!groups.has(it.groupId)) groups.set(it.groupId, newGroupId());
      groupId = groups.get(it.groupId);
    }
    return { ...it, id: newItemId(), alternatives: [...(it.alternatives || [])], groupId, groupType: groupId ? it.groupType || 'superset' : null };
  });
  return copy;
}

/** Lista ordenada por `order` (y nombre). */
export function sortTemplates(templates) {
  return sortBy(templates || [], 'order', (t) => normalize(t.name));
}

/** Inserta `tpl` justo después de `afterId` en la lista ordenada. Devuelve la lista nueva (usa renumber). */
export function insertAfter(templates, tpl, afterId) {
  const list = sortTemplates(templates).filter((t) => t.id !== tpl.id);
  const i = list.findIndex((t) => t.id === afterId);
  list.splice(i < 0 ? list.length : i + 1, 0, tpl);
  return list;
}

/** Sube (dir −1) o baja (+1) una plantilla. Devuelve la lista nueva o null si no se puede. */
export function moveTemplate(templates, id, dir) {
  const list = sortTemplates(templates);
  const i = list.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/** Cambios de `order` para dejar la lista numerada 0..n-1: [{id, order}] solo de los que cambian. */
export function renumber(list) {
  return list.map((t, i) => ({ id: t.id, order: i, changed: t.order !== i })).filter((x) => x.changed).map(({ id, order }) => ({ id, order }));
}

/** Nombres de los primeros ejercicios de una plantilla: «Press banca · Dominadas · Remo…». */
export function templatePreviewText(tpl, nameOf, max = 3) {
  const names = (tpl.items || []).map((it) => nameOf(it.exerciseId) || 'Ejercicio eliminado');
  if (!names.length) return 'Sin ejercicios todavía';
  return names.slice(0, max).join(' · ') + (names.length > max ? ' …' : '');
}

/** Semana tipo (días) vigente en `date`: la vigencia con mayor `from` ≤ fecha. */
export function patternDaysFor(weekPatterns, date) {
  const list = [...(weekPatterns || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  let cur = list[0] || null;
  for (const p of list) if (p.from <= date) cur = p;
  return cur ? cur.days || [] : [];
}

/**
 * Dónde se usa una plantilla en el calendario (de hoy en adelante):
 *  weekDays: índices 0 = lunes … 6 = domingo de la semana tipo vigente (o futuras vigencias),
 *  overrides: fechas concretas (excepciones del calendario) que la usan.
 */
export function templateCalendarUse(templateId, { settings = null, plan = [], today }) {
  const pats = (settings?.weekPatterns || []);
  const relevant = [patternDaysFor(pats, today), ...pats.filter((p) => p.from > today).map((p) => p.days || [])];
  const days = new Set();
  for (const d of relevant) d.forEach((p, i) => { if (p && p.kind === 'template' && p.templateId === templateId) days.add(i); });
  const overrides = (plan || []).filter((p) => p && p.id >= today && p.kind === 'template' && p.templateId === templateId).map((p) => p.id).sort();
  return { weekDays: [...days].sort(), overrides };
}

// ===========================================================================
// Ítems: grupos (superserie / circuito), secciones y orden
// ===========================================================================

/**
 * Bloques de la lista: un grupo (≥2 ítems contiguos con el mismo groupId) o un ítem suelto.
 * @returns {{start:number, end:number, groupId:string|null}[]} (end exclusivo)
 */
export function blocks(items) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    const g = items[i].groupId || null;
    let j = i + 1;
    if (g) while (j < items.length && items[j].groupId === g) j++;
    out.push({ start: i, end: j, groupId: g && j - i >= 2 ? g : null });
    i = j;
  }
  return out;
}

/**
 * Deja los grupos coherentes: un grupo = ítems CONTIGUOS con el mismo groupId (≥2), con el mismo
 * groupType y la misma sección. Un ítem solo pierde el grupo; un groupId repetido en dos tramos
 * separados se divide (el segundo tramo recibe id nuevo). Devuelve ítems nuevos.
 */
export function normalizeGroups(items, newGroupId = () => uid('g_')) {
  const out = items.map((it) => ({ ...it }));
  const used = new Set();
  for (const b of blocks(out)) {
    const first = out[b.start];
    if (!b.groupId) {
      first.groupId = null;
      first.groupType = null;
      continue;
    }
    const id = used.has(b.groupId) ? newGroupId() : b.groupId;
    used.add(id);
    const type = GROUP_TYPES.includes(first.groupType) ? first.groupType : 'superset';
    for (let k = b.start; k < b.end; k++) {
      out[k].groupId = id;
      out[k].groupType = type;
      out[k].section = first.section || '';
    }
  }
  return out;
}

/**
 * «Agrupar con el siguiente»: el ítem y el siguiente pasan a compartir grupo. Si alguno ya estaba en un
 * grupo, se unen (manda el tipo del grupo existente; si no, `type`).
 */
export function groupWithNext(items, index, type = 'superset', newGroupId = () => uid('g_')) {
  if (index < 0 || index >= items.length - 1) return items;
  const a = items[index];
  const b = items[index + 1];
  if (a.groupId && a.groupId === b.groupId) return items;
  const gid = a.groupId || b.groupId || newGroupId();
  const gtype = (a.groupId && a.groupType) || (b.groupId && b.groupType) || type;
  const joining = new Set([a.groupId, b.groupId].filter(Boolean));
  const out = items.map((it, i) => (i === index || i === index + 1 || (it.groupId && joining.has(it.groupId))
    ? { ...it, groupId: gid, groupType: gtype }
    : it));
  return normalizeGroups(out, newGroupId);
}

/**
 * «Sacar del grupo»: el ítem deja su grupo. Si estaba en medio, se coloca justo detrás del grupo
 * para no partirlo. Un grupo que se queda con un ítem desaparece.
 */
export function ungroupItem(items, index, newGroupId = () => uid('g_')) {
  const it = items[index];
  if (!it || !it.groupId) return items;
  const b = blocks(items).find((x) => index >= x.start && index < x.end);
  const out = [...items];
  const freed = { ...it, groupId: null, groupType: null };
  if (b && index > b.start && index < b.end - 1) {
    out.splice(index, 1);
    out.splice(b.end - 1, 0, freed);
  } else {
    out[index] = freed;
  }
  return normalizeGroups(out, newGroupId);
}

/** Convierte un grupo en superserie o circuito. */
export function setGroupType(items, groupId, type) {
  if (!GROUP_TYPES.includes(type)) return items;
  return items.map((it) => (it.groupId && it.groupId === groupId ? { ...it, groupType: type } : it));
}

/** Cambia la sección de un ítem (y de todo su grupo, que comparte sección). */
export function setSection(items, index, section) {
  const b = blocks(items).find((x) => index >= x.start && index < x.end);
  if (!b) return items;
  const s = String(section || '').trim();
  return items.map((it, i) => (i >= b.start && i < b.end ? { ...it, section: s } : it));
}

/**
 * Sube (dir = −1) o baja (+1) un ítem:
 *  - dentro de un grupo, se intercambia con el vecino del grupo;
 *  - en el borde de un grupo, se mueve el grupo entero;
 *  - un ítem suelto salta por encima de un grupo completo (no lo parte);
 *  - si el vecino es de otra sección, el bloque pasa a esa sección (cruza el encabezado) sin cambiar de sitio.
 * Devuelve la lista nueva, o la MISMA lista si no se puede mover.
 */
export function moveItem(items, index, dir) {
  const it = items[index];
  if (!it || (dir !== -1 && dir !== 1)) return items;
  const bl = blocks(items);
  const bi = bl.findIndex((x) => index >= x.start && index < x.end);
  const b = bl[bi];
  if (b.groupId) {
    const j = index + dir;
    if (j >= b.start && j < b.end) {
      const out = [...items];
      [out[index], out[j]] = [out[j], out[index]];
      return out;
    }
  }
  const nb = bl[bi + dir];
  if (!nb) return items;
  const sec = items[nb.start].section || '';
  if ((it.section || '') !== sec) {
    return items.map((x, i) => (i >= b.start && i < b.end ? { ...x, section: sec } : x));
  }
  const mine = items.slice(b.start, b.end);
  const other = items.slice(nb.start, nb.end);
  const before = items.slice(0, Math.min(b.start, nb.start));
  const after = items.slice(Math.max(b.end, nb.end));
  return dir < 0 ? [...before, ...mine, ...other, ...after] : [...before, ...other, ...mine, ...after];
}

export const canMove = (items, index, dir) => moveItem(items, index, dir) !== items;

/** Quita un ítem (los grupos se reajustan). */
export function removeItem(items, index, newGroupId = () => uid('g_')) {
  if (index < 0 || index >= items.length) return items;
  return normalizeGroups(items.filter((_, i) => i !== index), newGroupId);
}

/**
 * Deshacer «Quitar»: vuelve a insertar el ítem `removedId` (tal como estaba en `before`) detrás de su
 * vecino anterior y recompone el grupo que se deshizo al quitarlo. Conserva el resto de cambios de `current`.
 */
export function undoRemove(current, before, removedId, newGroupId = () => uid('g_')) {
  const at0 = before.findIndex((x) => x.id === removedId);
  if (at0 < 0 || current.some((x) => x.id === removedId)) return current;
  const removed = before[at0];
  const out = current.map((x) => ({ ...x }));
  let at = Math.min(at0, out.length);
  for (let k = at0 - 1; k >= 0; k--) {
    const j = out.findIndex((x) => x.id === before[k].id);
    if (j >= 0) { at = j + 1; break; }
    if (k === 0) at = 0;
  }
  out.splice(at, 0, deepClone(removed));
  if (removed.groupId) {
    for (const x of out) {
      const b = before.find((y) => y.id === x.id);
      if (b && b.groupId === removed.groupId && !x.groupId) { x.groupId = b.groupId; x.groupType = b.groupType; }
    }
  }
  return normalizeGroups(out, newGroupId);
}

/** Duplica un ítem justo debajo (mismo grupo y sección; id nuevo). */
export function duplicateItem(items, index, newId = () => uid('ti_')) {
  const it = items[index];
  if (!it) return items;
  const copy = { ...deepClone(it), id: newId() };
  const out = [...items];
  out.splice(index + 1, 0, copy);
  return out;
}

/** Etiquetas de grupo: { itemId: 'A1' } para los ítems agrupados (A, B, C… por orden de aparición). */
export function groupLabels(items) {
  const labels = {};
  let letter = 0;
  for (const b of blocks(items)) {
    if (!b.groupId) continue;
    const L = String.fromCharCode(65 + (letter++ % 26));
    for (let k = b.start; k < b.end; k++) labels[items[k].id] = `${L}${k - b.start + 1}`;
  }
  return labels;
}

/** Secciones distintas usadas en la plantilla (en orden de aparición). */
export function sectionsOf(items) {
  return [...new Set((items || []).map((it) => (it.section || '').trim()).filter(Boolean))];
}

// ===========================================================================
// Biblioteca
// ===========================================================================

/**
 * Filtra y ordena ejercicios. Búsqueda sin tildes por nombre y alias (todas las palabras deben aparecer).
 * Orden: nombre que empieza por la búsqueda, nombre que la contiene, coincidencia en alias; luego alfabético.
 */
export function searchExercises(list, { q = '', muscle = null, pattern = null, archived = false } = {}) {
  const nq = normalize(q);
  const words = nq.split(/\s+/).filter(Boolean);
  let out = (list || []).filter((e) => archived || !e.archived);
  if (muscle) out = out.filter((e) => (e.primary || []).includes(muscle) || (e.secondary || []).includes(muscle));
  if (pattern) out = out.filter((e) => e.pattern === pattern);
  if (words.length) {
    out = out.filter((e) => {
      const hay = [e.name, ...(e.aliases || [])].map((s) => normalize(s));
      return words.every((w) => hay.some((s) => s.includes(w)));
    });
  }
  const rank = (e) => {
    if (!nq) return 0;
    const n = normalize(e.name);
    return n.startsWith(nq) ? 0 : n.includes(nq) ? 1 : 2;
  };
  return sortBy(out, rank, (e) => normalize(e.name));
}

/** Alias desde un texto separado por comas (sin vacíos ni repetidos). */
export function parseAliases(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/[,;\n]/)) {
    const a = raw.trim().replace(/\s+/g, ' ');
    const k = normalize(a);
    if (a && !seen.has(k)) { seen.add(k); out.push(a); }
  }
  return out;
}

/** Valida el nombre de un ejercicio. Devuelve mensaje de error o null. */
export function validateExerciseName(name, exercises = [], selfId = null) {
  const n = normalize(name);
  if (!n) return 'Pon un nombre.';
  if (exercises.some((e) => e.id !== selfId && normalize(e.name) === n)) return 'Ya existe un ejercicio con ese nombre.';
  return null;
}

/**
 * Asigna los músculos de un grupo ('primary' | 'secondary'). Un músculo no puede estar en ambos:
 * el que se acaba de elegir sale del otro grupo.
 */
export function assignMuscles(primary, secondary, which, next) {
  const sel = [...new Set(next || [])];
  if (which === 'primary') return { primary: sel, secondary: (secondary || []).filter((m) => !sel.includes(m)) };
  return { primary: (primary || []).filter((m) => !sel.includes(m)), secondary: sel };
}

/**
 * Dónde se usa un ejercicio: sesiones de fuerza (como ejercicio o alternativa), plantillas y objetivos.
 * Si se usa en algo, no se puede borrar (se archiva).
 */
export function exerciseUsage(exerciseId, { sessions = [], templates = [], goals = [], pastRecords = [] } = {}) {
  const inSe = (se) => se.exerciseId === exerciseId || se.baseExerciseId === exerciseId || (se.alternatives || []).includes(exerciseId);
  const ses = sessions.filter((s) => s && s.kind === 'strength' && (s.exercises || []).some(inSe));
  const tpls = templates.filter((t) => (t.items || []).some((it) => it.exerciseId === exerciseId || (it.alternatives || []).includes(exerciseId)));
  const gls = goals.filter((g) => g && g.exerciseId === exerciseId);
  const marks = pastRecords.filter((r) => r && r.exerciseId === exerciseId);
  return { sessions: ses, templates: tpls, goals: gls, marks, used: ses.length + tpls.length + gls.length + marks.length > 0 };
}

/**
 * Series de trabajo resumidas: «80×6 @2 · 80×5 @1 · 77,5×6 @1».
 * fmtSet(set, logType) es el formateador de la sesión (session-logic.formatSet, el de «Última vez»): la ficha lee
 * cada serie igual que la sesión (p. ej. «−15 kg asist. × 8», nunca «−15×8»). Se recibe por parámetro para que
 * este módulo siga siendo puro (session-logic importa store.js y ya depende de este módulo). pura
 */
export function summarizeSets(sets, logType, fmtSet, max = 6) {
  return setTexts(sets, logType, fmtSet, max).join(' · ');
}

/** Lo mismo, por piezas (una por serie y «+N» si hay más de max): la vista no parte una serie entre dos líneas. pura */
export function setTexts(sets, logType, fmtSet, max = 6) {
  const txt = (sets || []).map((s) => fmtSet(s, logType));
  return txt.length > max ? [...txt.slice(0, max), `+${txt.length - max}`] : txt;
}

/**
 * Historial de un ejercicio (más reciente primero): una fila por sesión de fuerza con series de trabajo
 * (o, si es cardio, con actividades enlazadas).
 * opts.fmtSet: formateador de series (session-logic.formatSet); sin él, el resumen de fuerza da el nº de series.
 * @returns {{sessionId, date, templateName, status, workSets:number, summary, setTexts:string[], bestE1rm:number|null, activities:object[]}[]}
 */
export function exerciseHistory(sessions, exercise, { bwFn = () => null, fmtSet = null } = {}) {
  const out = [];
  const lt = exercise.logType;
  for (const s of sessions || []) {
    if (!s || s.kind !== 'strength') continue;
    const ses = (s.exercises || []).filter((se) => se.exerciseId === exercise.id);
    if (!ses.length) continue;
    if (lt === 'cardio') {
      const ids = new Set(ses.map((se) => se.id));
      const acts = sessions.filter((a) => a && a.kind !== 'strength' && a.parentId === s.id && ids.has(a.parentItemId));
      if (!acts.length) continue;
      const summary = acts.map((a) => [a.distanceKm ? `${fmtNum(a.distanceKm, 2)} km` : '', a.durationMin ? `${fmtNum(a.durationMin, 0)} min` : ''].filter(Boolean).join(' · ') || 'Actividad').join(' + ');
      out.push({ sessionId: s.id, date: s.date, templateName: s.templateName || '', status: s.status, workSets: 0, summary, setTexts: [], bestE1rm: null, activities: acts, key: s.startedAt || s.createdAt || 0 });
      continue;
    }
    const work = ses.flatMap((se) => (se.sets || []).filter(isWorkSet));
    if (!work.length) continue;
    const bw = bwFn(s.date);
    let best = null;
    for (const set of work) {
      const m = setMetrics(set, exercise, bw);
      if (m.e1rm != null && (best == null || m.e1rm > best)) best = m.e1rm;
    }
    const texts = fmtSet ? setTexts(work, lt, fmtSet) : [];
    const summary = texts.length ? texts.join(' · ') : plural(work.length, 'serie', 'series');
    out.push({ sessionId: s.id, date: s.date, templateName: s.templateName || '', status: s.status, workSets: work.length, summary, setTexts: texts, bestE1rm: best, activities: [], key: s.startedAt || s.createdAt || 0 });
  }
  return sortBy(out, '-date', (r) => -r.key);
}
