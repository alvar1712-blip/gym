// backup.js — lógica PURA de copias de seguridad (JSON) y exportación CSV.
// PROPIETARIO: módulo de ajustes. Sin DOM ni store: recibe los datos por parámetro y se prueba
// en Node (tests/unit/backup.test.mjs). La vista (views/settings.js) lee del store y comparte los archivos.
import { deepClone, round, sortBy, isDateStr, fmtNum } from './util.js';
import { isWorkSet, setMetrics, makeBodyweightFn, sessionDurationMin, sessionLoad, pace, speed, pace100 } from './calc.js';
import { MUSCLE_LABEL, ACTIVITY_LABEL, SET_TYPE_LABEL, RUN_TYPES, BIKE_TYPES, OTHER_TYPES, SWIM_STROKES } from './seed.js';

const pad = (n) => String(n).padStart(2, '0');
const toDate = (d) => (d instanceof Date ? d : new Date(d ?? Date.now()));

/** 'AAAA-MM-DD-HHMM' en hora local. */
export function fileStamp(date = new Date()) {
  const d = toDate(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 'entreno-copia-AAAA-MM-DD-HHMM.json' */
export function backupFileName(date = new Date()) {
  return `entreno-copia-${fileStamp(date)}.json`;
}

/** 'entreno-fuerza-AAAA-MM-DD-HHMM.csv' / 'entreno-cardio-…csv' */
export function csvFileName(kind, date = new Date()) {
  return `entreno-${kind}-${fileStamp(date)}.csv`;
}

// ---------------------------------------------------------------------------
// Copia JSON
// ---------------------------------------------------------------------------

/**
 * Prepara el objeto que se guarda en el archivo a partir de store.exportData():
 * copia profunda con exportedAt = now y settings.lastBackupAt = now DENTRO de la copia,
 * para que al restaurarla la fecha de la última copia sea coherente.
 */
export function buildBackupObject(exported, now = Date.now()) {
  const obj = deepClone(exported) || {};
  obj.exportedAt = new Date(now).toISOString();
  const settings = (obj.data?.meta || []).find((m) => m && m.id === 'settings');
  if (settings) settings.lastBackupAt = now;
  return obj;
}

/** Recuento por tipo de dato de un bloque `data` ({store: [registros]}). */
export function dataCounts(data = {}) {
  const sessions = data.sessions || [];
  const exercises = data.exercises || [];
  return {
    strength: sessions.filter((s) => s.kind === 'strength').length,
    activities: sessions.filter((s) => s.kind !== 'strength').length,
    templates: (data.templates || []).length,
    exercises: exercises.length,
    customExercises: exercises.filter((e) => e.custom).length,
    bodyweight: (data.bodyweight || []).length,
    plan: (data.plan || []).length,
    checkins: (data.checkins || []).length,
    goals: (data.goals || []).length,
    context: (data.context || []).length,
    pastRecords: (data.pastRecords || []).length,
  };
}

/** Secciones que no existían en copias de versiones anteriores (formato 1). */
export const NEWER_SECTIONS = [
  { store: 'context', name: 'contexto', one: 'apunte de contexto', many: 'apuntes de contexto' },
  { store: 'pastRecords', name: 'marcas históricas', one: 'marca histórica', many: 'marcas históricas' },
  { store: 'races', name: 'eventos deportivos', one: 'evento deportivo', many: 'eventos deportivos' },
];

/**
 * Aviso al restaurar una copia de una versión anterior que NO trae alguna sección en la que ahora hay datos (restaurar
 * sustituye todo: esos datos se borrarán). null si no hace falta avisar.
 * @param {object} backup  copia (con .data)
 * @param {Record<string, number>} current  registros actuales por almacén ({ context: 5, … })
 */
export function lostSectionsWarning(backup, current = {}) {
  const data = backup?.data || {};
  const missing = NEWER_SECTIONS.filter((x) => !Array.isArray(data[x.store]));
  const lost = missing.filter((x) => (current[x.store] || 0) > 0);
  if (!lost.length) return null;
  const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ni ${xs.at(-1)}`);
  const joinY = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return `Esta copia se hizo con una versión anterior de la app y no contiene ${list(missing.map((x) => x.name))}. `
    + `Al restaurarla se borrará lo que tienes ahora en ${lost.length === 1 ? 'esa sección' : 'esas secciones'}: `
    + `${joinY(lost.map((x) => plural(current[x.store], x.one, x.many)))}.`;
}

/** Resumen de una copia para la confirmación de importar. */
export function backupSummary(obj) {
  const data = obj?.data || {};
  const settings = (data.meta || []).find((m) => m && m.id === 'settings');
  const dates = (data.sessions || []).map((s) => s.date).filter(isDateStr).sort();
  const parsed = Date.parse(obj?.exportedAt);
  return {
    ...dataCounts(data),
    exportedAt: Number.isFinite(parsed) ? parsed : settings?.lastBackupAt ?? null,
    appVersion: obj?.appVersion || null,
    firstDate: dates[0] || null,
    lastDate: dates.at(-1) || null,
  };
}

/**
 * Lee el texto de un archivo de copia: JSON.parse (con error amable) + validación.
 * @param {string} text
 * @param {(obj)=>{ok:boolean, error?:string}} validate  normalmente store.validateBackup
 * @returns {{ok:true, backup:object, summary:object} | {ok:false, error:string}}
 */
export function parseBackupText(text, validate = null) {
  const src = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!src) return { ok: false, error: 'El archivo está vacío.' };
  let obj;
  try {
    obj = JSON.parse(src);
  } catch {
    return { ok: false, error: 'El archivo no es una copia de Entreno (no tiene formato JSON). Elige el archivo «entreno-copia-….json» que exportaste.' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'El archivo no es una copia de Entreno.' };
  const v = validate ? validate(obj) : { ok: !!obj.data && typeof obj.data === 'object', error: 'La copia no contiene datos.' };
  if (!v || !v.ok) return { ok: false, error: v?.error || 'La copia no es válida.' };
  return { ok: true, backup: obj, summary: backupSummary(obj) };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Formato: Excel en español (';', coma decimal, BOM UTF-8) o estándar (',', punto decimal). */
export function csvFormat(excel) {
  return excel ? { sep: ';', dec: ',', bom: '\uFEFF', excel: true } : { sep: ',', dec: '.', bom: '', excel: false };
}

/** Número para CSV: redondeado, sin separador de miles; '' si no hay valor. */
export function csvNumber(n, decimals = 2, excel = false) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const r = round(n, 10 ** -decimals);
  let s = String(Object.is(r, -0) ? 0 : r);
  if (/e/i.test(s)) s = r.toFixed(decimals);
  return excel ? s.replace('.', ',') : s;
}

/**
 * Texto para CSV: entre comillas si contiene separador, comillas o saltos de línea
 * (las comillas se duplican). En modo Excel, un texto que empieza por = + - @ se precede
 * de un apóstrofo para que Excel no lo interprete como fórmula.
 */
export function csvText(value, sep = ',', excel = false) {
  let s = String(value ?? '');
  if (excel && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes('"') || s.includes(sep) || /[\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Construye el CSV. columns: [{h:'Cabecera', dec?:n}], rows: [[valor…]] (número, texto o null).
 * Filas separadas por CRLF (RFC 4180), con salto final.
 */
export function buildCsv(columns, rows, { excel = true } = {}) {
  const f = csvFormat(excel);
  const cell = (v, col) => (typeof v === 'number' ? csvNumber(v, col?.dec ?? 2, f.excel) : v == null ? '' : csvText(v, f.sep, f.excel));
  const lines = [columns.map((c) => csvText(c.h, f.sep, false)).join(f.sep)];
  for (const r of rows) lines.push(columns.map((c, i) => cell(r[i], c)).join(f.sep));
  return f.bom + lines.join('\r\n') + '\r\n';
}

const exOf = (exMap, id) => (exMap ? (exMap.get ? exMap.get(id) : exMap[id]) : null) || null;
const chrono = (list) => sortBy(list, 'date', (s) => s.startedAt || s.createdAt || 0);

export const STRENGTH_COLUMNS = [
  { h: 'Fecha' },
  { h: 'Sesión' },
  { h: 'Ejercicio' },
  { h: 'Músculo principal' },
  { h: 'Orden ejercicio', dec: 0 },
  { h: 'Nº serie', dec: 0 },
  { h: 'Tipo de serie' },
  { h: 'Peso (kg)', dec: 2 },
  { h: 'Reps', dec: 0 },
  { h: 'Reps derecha', dec: 0 },
  { h: 'RIR (F = fallo)', dec: 0 },
  { h: 'Tiempo (s)', dec: 2 }, // sprints con centésimas (3,45 s); los enteros salen sin decimales
  { h: 'Distancia (m)', dec: 1 },
  { h: 'Altura (cm)', dec: 1 },
  { h: 'Nota serie' },
  { h: '1RM estimado (kg)', dec: 1 },
  { h: 'Volumen (kg)', dec: 1 },
  { h: 'Duración sesión (min)', dec: 1 },
  { h: 'RPE sesión', dec: 1 },
  { h: 'Carga sesión', dec: 0 },
  { h: 'Nota sesión' },
];

/**
 * Filas del CSV de fuerza: una por SERIE hecha (done) de cada sesión de fuerza, en orden cronológico.
 * Los calentamientos se exportan (tipo «Calentamiento») pero sin 1RM ni volumen, como en el resto de la app.
 * @param {object[]} sessions  todas las sesiones (se filtran las de fuerza)
 * @param {Map|object} exMap   id → ejercicio
 * @param {object} settings    para bodyweightDefault
 * @param {{bodyweight?:object[]}} opts  pesajes, para la carga de los ejercicios de peso corporal
 */
export function strengthRows(sessions, exMap, settings = {}, { bodyweight = [] } = {}) {
  const bwFn = makeBodyweightFn(bodyweight, settings?.bodyweightDefault ?? 75);
  const rows = [];
  for (const s of chrono((sessions || []).filter((x) => x && x.kind === 'strength'))) {
    const dur = sessionDurationMin(s);
    const load = sessionLoad(s);
    const bw = bwFn(s.date);
    (s.exercises || []).forEach((se, i) => {
      const ex = exOf(exMap, se.exerciseId);
      const muscle = ex ? (ex.primary || []).map((m) => MUSCLE_LABEL[m] || m).join(' / ') : '';
      let n = 0;
      for (const set of se.sets || []) {
        if (!set || !set.done) continue;
        n++;
        const m = ex && isWorkSet(set) ? setMetrics(set, ex, bw) : { e1rm: null, volume: null };
        rows.push([
          s.date, s.templateName || 'Sesión libre', ex?.name || se.exName || se.exerciseId || '', muscle,
          i + 1, n, SET_TYPE_LABEL[set.type] || set.type || '',
          set.weight ?? null, set.reps ?? null, set.repsR ?? null, set.rir ?? null,
          set.timeSec ?? null, set.distanceM ?? null, set.heightCm ?? null, set.note || null,
          m.e1rm, m.volume || null, dur, s.rpe ?? null, load, s.notes || null,
        ]);
      }
    });
  }
  return rows;
}

/** CSV de fuerza (ver strengthRows). opts: {excel, bodyweight}. */
export function strengthCsv(sessions, exMap, settings = {}, { excel = settings?.csv?.excel ?? true, bodyweight = [] } = {}) {
  return buildCsv(STRENGTH_COLUMNS, strengthRows(sessions, exMap, settings, { bodyweight }), { excel });
}

export const CARDIO_COLUMNS = [
  { h: 'Fecha' },
  { h: 'Tipo' },
  { h: 'Subtipo' },
  { h: 'Distancia (km)', dec: 3 },
  { h: 'Duración (min)', dec: 1 },
  { h: 'Duración (h:mm:ss)' },
  { h: 'Tiempo total (h:mm:ss)' },
  { h: 'Ritmo (min/km)' }, // h:mm:ss (0:05:00): ver hms()
  { h: 'Velocidad (km/h)', dec: 1 },
  { h: 'Ritmo (min/100 m)' },
  { h: 'Desnivel (m)', dec: 0 }, // positivo
  { h: 'Desnivel − (m)', dec: 0 },
  { h: 'Altitud máx. (m)', dec: 0 },
  { h: 'FC media', dec: 0 },
  { h: 'FC máx', dec: 0 },
  { h: 'Cadencia', dec: 0 },
  { h: 'Potencia media (W)', dec: 0 },
  { h: 'NP (W)', dec: 0 },
  { h: 'Piscina / aguas abiertas' },
  { h: 'Largo piscina (m)', dec: 0 },
  { h: 'Estilo' },
  { h: 'Mochila (kg)', dec: 1 },
  { h: 'RPE', dec: 1 },
  { h: 'Carga', dec: 0 },
  { h: 'Sensaciones' },
  { h: 'Notas' },
  { h: 'Dentro de la sesión' },
];

const SUBTYPE_LABELS = {
  run: Object.fromEntries(RUN_TYPES.map((t) => [t.id, t.label])),
  bike: Object.fromEntries(BIKE_TYPES.map((t) => [t.id, t.label])),
  other: Object.fromEntries(OTHER_TYPES.map((t) => [t.id, t.label])),
};
const STROKE_LABEL = Object.fromEntries(SWIM_STROKES.map((t) => [t.id, t.label]));
const POOL_LABEL = { pool: 'Piscina', open: 'Aguas abiertas' };

/**
 * Segundos → 'h:mm:ss', siempre con horas. Se usa para duraciones Y ritmos: Excel, Numbers y Google Sheets
 * leen «5:00» como 5 horas (h:mm), pero «0:05:00» como 5 minutos, así que un ritmo de 5:00 /km sale «0:05:00».
 */
export function hms(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return null;
  const t = Math.round(sec);
  return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

/**
 * Filas del CSV de cardio: una por actividad (carrera, bici, natación, senderismo, otras), en orden cronológico.
 * Desnivel negativo y altitud máxima salen en cualquier deporte que los tenga (senderismo o actividades importadas
 * de un archivo); la mochila, solo en senderismo.
 */
export function cardioRows(sessions) {
  const all = sessions || [];
  const byId = new Map(all.filter(Boolean).map((s) => [s.id, s]));
  const rows = [];
  for (const s of chrono(all.filter((x) => x && x.kind && x.kind !== 'strength'))) {
    const sec = typeof s.movingSec === 'number' ? s.movingSec : typeof s.durationMin === 'number' ? s.durationMin * 60 : null;
    const km = typeof s.distanceKm === 'number' && s.distanceKm > 0 ? s.distanceKm : null;
    const parent = s.parentId ? byId.get(s.parentId) : null;
    const dur = sessionDurationMin(s);
    rows.push([
      s.date, ACTIVITY_LABEL[s.kind] || s.kind, s.subtype ? SUBTYPE_LABELS[s.kind]?.[s.subtype] || s.subtype : null,
      km, dur, hms(sec), hms(s.elapsedSec),
      hms(pace(sec, km)), speed(sec, km), s.kind === 'swim' ? hms(pace100(sec, km)) : null,
      s.elevationM ?? null, s.elevationLossM ?? null, s.altMaxM ?? null,
      s.hrAvg ?? null, s.hrMax ?? null, s.cadence ?? null, s.powerAvg ?? null, s.powerNp ?? null,
      POOL_LABEL[s.poolType] || s.poolType || null, s.poolType === 'pool' ? s.poolLengthM ?? null : null,
      s.stroke ? STROKE_LABEL[s.stroke] || s.stroke : null,
      s.kind === 'hike' ? s.packKg ?? null : null,
      s.rpe ?? null, sessionLoad(s), s.feel || null, s.notes || null,
      parent ? parent.templateName || 'Sesión de fuerza' : null,
    ]);
  }
  return rows;
}

/** CSV de cardio (ver cardioRows). */
export function cardioCsv(sessions, { excel = true } = {}) {
  return buildCsv(CARDIO_COLUMNS, cardioRows(sessions), { excel });
}

/** Nº de filas que tendría cada CSV (para los botones). */
export function csvCounts(sessions) {
  let sets = 0;
  let activities = 0;
  for (const s of sessions || []) {
    if (!s) continue;
    if (s.kind === 'strength') for (const se of s.exercises || []) sets += (se.sets || []).filter((x) => x && x.done).length;
    else if (s.kind) activities++;
  }
  return { sets, activities };
}

// ---------------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------------

/** Prefijos de las claves de localStorage de la app: borradores ('draft:activity:<tipo>') y 'entreno.…'. */
export const LOCAL_KEY_PREFIXES = ['draft:', 'entreno.'];

/**
 * Claves de localStorage que se eliminan al borrar todo o al importar una copia: los borradores
 * ('draft:activity:<tipo>', 'entreno.exercise.draft') y el estado de pantallas ('entreno.…'). Viven fuera de
 * IndexedDB, así que store.wipeAll/importData no los tocan. No se usa localStorage.clear(): el origen puede
 * ser compartido.
 * @param {string[]} keys  todas las claves (localStorage.key(i))
 */
export function localKeysToClear(keys) {
  return (keys || []).filter((k) => typeof k === 'string' && LOCAL_KEY_PREFIXES.some((p) => k.startsWith(p)));
}

/** 1536 → '1,5 KB' */
export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${fmtNum(v, v < 10 ? 1 : 0)} ${units[i]}`;
}
