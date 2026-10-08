// store.js — estado en memoria + escritura inmediata en IndexedDB (write-through).
// Toda la app lee de aquí de forma SÍNCRONA; cada cambio se persiste al instante.
import * as db from './db.js';
import { SEED_VERSION, defaultSettings, exampleWeekPatterns, SEED_EXERCISES, SEED_TEMPLATES } from './seed.js';
import { deepClone, fillDefaults, sortBy, todayStr } from './util.js';
import { dataCounts } from './backup.js';

export const STORES = db.STORES;
export const APP_VERSION = '1.0.0';
// Formato de la copia JSON. 2 (ronda 6) añade 'context', 'pastRecords' y 'races'. Se aceptan copias de formato ≤ 2
// (en una de formato 1 esos almacenes llegan vacíos); una app antigua rechaza la 2 en vez de perderlos en silencio.
export const BACKUP_FORMAT = 2;
export const BACKUP_APP_ID = 'entreno-pwa';

const maps = Object.fromEntries(STORES.map((s) => [s, new Map()]));
const listeners = new Map();
const pendingTimers = new Map(); // `${store}:${id}` → {timer, obj}
const inflight = new Set();
// Revisiones (ronda 6, fase G; docs/MEJORAS6.md): cada almacén lleva un contador que sube en la MISMA llamada síncrona
// que cambia su memoria (save, saveSoon, remove, restore); `epoch` cambia cuando se sustituyen todos los datos de golpe
// (carga inicial, importar una copia, borrar todo). Las cachés en memoria (analysis-cache.js) guardan estos números y
// recalculan si alguno cambió. Solo en memoria: no se guardan ni viajan en las copias.
const revs = Object.fromEntries(STORES.map((s) => [s, 0]));
let epoch = 0;
const bump = (store) => { revs[store] = (revs[store] || 0) + 1; };
let persistInfo = { supported: false, persisted: false };

/** Revisiones actuales: { epoch, meta, exercises, …, races } (números; cambian con cada escritura). */
export function revisions() {
  return { epoch, ...revs };
}

// ---------- eventos ----------
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}
function emit(evt, detail) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(detail); } catch (err) { console.error(`[store] listener ${evt}`, err); }
  }
}

function track(promise, ctx) {
  const p = promise.catch((err) => {
    console.error('[store] error al guardar', ctx, err);
    emit('error', { error: err, ...ctx });
    throw err;
  });
  inflight.add(p);
  p.finally(() => inflight.delete(p)).catch(() => {});
  return p;
}

// ---------- arranque ----------
export async function init() {
  const all = await Promise.all(STORES.map((s) => db.getAll(s)));
  STORES.forEach((s, i) => {
    maps[s].clear();
    for (const obj of all[i]) maps[s].set(obj.id, obj);
  });
  if (!maps.meta.get('app')) {
    await seedAll();
  } else {
    await migrate();
  }
  epoch++;
  return true;
}

const seedExercise = (e, now) => ({ custom: false, archived: false, aliases: [], secondary: [], notes: '', ...deepClone(e), createdAt: now, updatedAt: now });
const seedTemplates = (now) => SEED_TEMPLATES.map((t, i) => ({ order: i, notes: '', archived: false, ...deepClone(t), createdAt: now, updatedAt: now }));

/** Carga inicial en UNA transacción: si la primera apertura se corta, no queda meta.app sin biblioteca. */
async function seedAll() {
  const now = Date.now();
  const app = { id: 'app', createdAt: now, seedVersion: SEED_VERSION, schema: 1, seedComplete: true };
  const settings = defaultSettings();
  settings.createdAt = now;
  settings.updatedAt = now;
  const exercises = SEED_EXERCISES.map((e) => seedExercise(e, now));
  const templates = seedTemplates(now);
  await db.putStores({ meta: [app, settings], exercises, templates });
  maps.meta.set('app', app);
  maps.meta.set('settings', settings);
  for (const e of exercises) maps.exercises.set(e.id, e);
  for (const t of templates) maps.templates.set(t.id, t);
}

/**
 * Instalaciones sembradas con la versión antigua (tres transacciones): si la primera apertura se cortó,
 * quedó meta.app sin ejercicios o sin rutinas. Se recupera UNA vez (después `seedComplete` lo impide,
 * para no resucitar rutinas que el usuario haya borrado).
 */
async function repairPartialSeed(app) {
  if (app.seedComplete) return;
  const now = Date.now();
  const data = {};
  if (maps.exercises.size === 0) data.exercises = SEED_EXERCISES.map((e) => seedExercise(e, now));
  if (maps.templates.size === 0 && maps.sessions.size === 0) data.templates = seedTemplates(now);
  const next = { ...app, seedComplete: true };
  await db.putStores({ ...data, meta: [next] });
  for (const e of data.exercises || []) maps.exercises.set(e.id, e);
  for (const t of data.templates || []) maps.templates.set(t.id, t);
  maps.meta.set('app', next);
}

async function migrate() {
  // Ajustes: rellenar claves nuevas sin tocar las existentes.
  // La semana tipo NO se rellena con la de por defecto (vacía desde la ronda 8, B2): unos datos existentes sin semana
  // guardada veían la de ejemplo y la conservan; los que ya tienen la suya (aunque esté vacía) no cambian.
  let settings = maps.meta.get('settings');
  if (!settings) {
    settings = { ...defaultSettings(), weekPatterns: exampleWeekPatterns() };
    maps.meta.set('settings', settings);
    await db.put('meta', settings);
  } else {
    const before = JSON.stringify(settings);
    if (!Array.isArray(settings.weekPatterns)) settings.weekPatterns = exampleWeekPatterns();
    fillDefaults(settings, defaultSettings());
    if (JSON.stringify(settings) !== before) await db.put('meta', settings);
  }
  await repairPartialSeed(maps.meta.get('app'));
  // Biblioteca: añadir ejercicios semilla nuevos (sin sobrescribir ediciones del usuario).
  const app = maps.meta.get('app');
  if ((app.seedVersion || 0) < SEED_VERSION) {
    const now = Date.now();
    const added = [];
    for (const e of SEED_EXERCISES) {
      if (!maps.exercises.has(e.id)) {
        const ex = seedExercise(e, now);
        maps.exercises.set(ex.id, ex);
        added.push(ex);
      }
    }
    if (added.length) await db.putMany('exercises', added);
    app.seedVersion = SEED_VERSION;
    await db.put('meta', app);
  }
}

// ---------- lectura ----------
export function get(store, id) {
  return id == null ? null : maps[store].get(id) ?? null;
}
export function all(store) {
  return [...maps[store].values()];
}
export function count(store) {
  return maps[store].size;
}
export function settings() {
  return maps.meta.get('settings');
}
export function exercise(id) {
  return get('exercises', id);
}
/** Ejercicios no archivados, ordenados por nombre. */
export function exercisesList({ includeArchived = false } = {}) {
  return sortBy(all('exercises').filter((e) => includeArchived || !e.archived), (e) => e.name.toLocaleLowerCase('es'));
}
export function templatesList({ includeArchived = false } = {}) {
  return sortBy(all('templates').filter((t) => includeArchived || !t.archived), 'order', 'name');
}
/** Sesiones (todas las clases) de más reciente a más antigua. */
export function sessionsList() {
  return sortBy(all('sessions'), '-date', (s) => -(s.startedAt || s.createdAt || 0));
}
export function activeSession() {
  return all('sessions').find((s) => s.status === 'active' && s.kind === 'strength') || null;
}
export function bodyweightList() {
  return sortBy(all('bodyweight'), 'id');
}
export function persistStatus() {
  return persistInfo;
}

// ---------- escritura ----------
function stamp(obj) {
  const now = Date.now();
  obj.updatedAt = now;
  if (!obj.createdAt) obj.createdAt = now;
  return obj;
}

/** Guarda YA (se resuelve cuando está en disco). Actualiza la memoria de forma síncrona. */
export function save(store, obj) {
  if (!obj || obj.id == null) throw new Error(`save(${store}): objeto sin id`);
  const key = `${store}:${obj.id}`;
  const pending = pendingTimers.get(key);
  if (pending) { clearTimeout(pending.timer); pendingTimers.delete(key); }
  stamp(obj);
  maps[store].set(obj.id, obj);
  bump(store);
  emit('change', { store, id: obj.id, op: 'put', obj });
  return track(db.put(store, obj), { store, id: obj.id });
}

/**
 * Guarda con un pequeño retardo (para escritura mientras se teclea).
 * La memoria se actualiza al momento; el disco en `ms` milisegundos
 * o antes si se llama a flush() (la app lo hace al pasar a segundo plano).
 */
export function saveSoon(store, obj, ms = 250) {
  const key = `${store}:${obj.id}`;
  stamp(obj);
  maps[store].set(obj.id, obj);
  bump(store);
  const prev = pendingTimers.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    track(db.put(store, obj), { store, id: obj.id }).catch(() => {});
  }, ms);
  pendingTimers.set(key, { timer, obj, store });
  emit('change', { store, id: obj.id, op: 'put', obj, soon: true });
}

/** Escribe inmediatamente todo lo pendiente y espera a que termine. */
export async function flush() {
  for (const [key, p] of pendingTimers) {
    clearTimeout(p.timer);
    pendingTimers.delete(key);
    track(db.put(p.store, p.obj), { store: p.store, id: p.obj.id }).catch(() => {});
  }
  await Promise.allSettled([...inflight]);
}

/** Elimina y devuelve el objeto eliminado (para poder deshacer con restore()). */
export async function remove(store, id) {
  const key = `${store}:${id}`;
  const pending = pendingTimers.get(key);
  if (pending) { clearTimeout(pending.timer); pendingTimers.delete(key); }
  const obj = maps[store].get(id) ?? null;
  maps[store].delete(id);
  bump(store);
  emit('change', { store, id, op: 'delete', obj });
  await track(db.del(store, id), { store, id });
  return obj;
}

/** Vuelve a guardar un objeto eliminado tal cual (deshacer), sin cambiar updatedAt. */
export function restore(store, obj) {
  const key = `${store}:${obj.id}`;
  const pending = pendingTimers.get(key);
  if (pending) { clearTimeout(pending.timer); pendingTimers.delete(key); }
  maps[store].set(obj.id, obj);
  bump(store);
  emit('change', { store, id: obj.id, op: 'put', obj });
  return track(db.put(store, obj), { store, id: obj.id });
}

export function saveSettings(patch = {}) {
  const s = settings();
  Object.assign(s, patch);
  return save('meta', s);
}

// ---------- copias / borrado ----------
export function exportData() {
  const data = {};
  for (const s of STORES) data[s] = deepClone(all(s));
  return {
    app: BACKUP_APP_ID,
    format: BACKUP_FORMAT,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** Valida una copia. Devuelve { ok, error?, counts? }. */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'El archivo no es una copia válida.' };
  if (obj.app !== BACKUP_APP_ID) return { ok: false, error: 'El archivo no es una copia de esta app.' };
  if (typeof obj.format !== 'number' || obj.format > BACKUP_FORMAT) return { ok: false, error: 'La copia es de una versión más nueva de la app.' };
  if (!obj.data || typeof obj.data !== 'object') return { ok: false, error: 'La copia no contiene datos.' };
  const counts = {};
  for (const s of STORES) {
    const arr = obj.data[s] ?? [];
    if (!Array.isArray(arr)) return { ok: false, error: `Sección «${s}» dañada.` };
    if (arr.some((x) => !x || typeof x !== 'object' || x.id == null)) return { ok: false, error: `Registros sin id en «${s}».` };
    counts[s] = arr.length;
  }
  if (!obj.data.meta?.some((m) => m.id === 'settings')) return { ok: false, error: 'La copia no contiene ajustes.' };
  return { ok: true, counts };
}

// ---------- punto de restauración (ronda 8, B3; docs/PULIDO.md §22) ----------
// Antes de sustituir o borrar TODO (importar una copia, «Borrar todo») se guarda en este dispositivo una copia completa
// de lo que hay, se vuelve a leer del disco y se comprueba (recuento por almacén y contenido idéntico). Si no se puede
// guardar o comprobar, NO se destruye nada. Solo hay uno (el último): dos registros reservados de 'meta' (db.js
// RESERVED_PREFIX), fuera de la memoria, de las copias exportadas y de «sustituir todo». Vive en el IndexedDB de este
// navegador: si se borran los datos del sitio, desaparece con todo lo demás (no sustituye a una copia exportada).
export const RESTORE_INFO_ID = `${db.RESERVED_PREFIX}restorePoint`;
export const RESTORE_DATA_ID = `${db.RESERVED_PREFIX}restorePoint:data`;
const isReserved = (id) => typeof id === 'string' && id.startsWith(db.RESERVED_PREFIX);

/** Error al crear el punto de restauración: no se ha destruido nada. `reason`: 'space' | 'write' | 'verify'. */
export class RestorePointError extends Error {
  constructor(reason, message, cause = null) {
    super(message);
    this.name = 'RestorePointError';
    this.reason = reason;
    this.cause = cause;
  }
}

// Almacenes cuyo contenido es del usuario (no lo vuelve a crear la carga inicial).
const USER_STORES = ['sessions', 'bodyweight', 'goals', 'checkins', 'cycle', 'context', 'pastRecords', 'races', 'plan'];

// Datos del perfil que escribe el usuario (no los avisos descartados ni las preferencias que se guardan solas).
const PROFILE_KEYS = ['sex', 'goal', 'experience', 'birthDate', 'weeklyFrequency', 'onboardedAt', 'contraception', 'limitations', 'sports', 'secondaryGoals'];
const filled = (v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');
// Contenido de un registro sin sus marcas de tiempo, con las claves ordenadas: compara con lo que siembra seedAll.
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => k !== 'createdAt' && k !== 'updatedAt').sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));
let pristine = null; // Map(id → canon) de los ejercicios y rutinas iniciales, calculado una vez
function pristineOf() {
  if (!pristine) {
    pristine = {
      exercises: new Map(SEED_EXERCISES.map((e) => [e.id, canon(seedExercise(e, 0))])),
      templates: new Map(seedTemplates(0).map((t) => [t.id, canon(t)])),
    };
  }
  return pristine;
}
const edited = (st, o) => pristineOf()[st].get(o.id) !== canon(o);

/**
 * ¿Hay algo que proteger? Todo lo que no es «recién instalada»: registros del usuario, ejercicios propios o editados,
 * rutinas propias, editadas o borradas, la semana tipo y el perfil. Lo que se guarda solo (fecha de la última copia,
 * avisos descartados) no cuenta: si contara, borrar dos veces seguidas pisaría el punto con los datos de verdad.
 */
export function hasDataToProtect() {
  if (USER_STORES.some((st) => count(st) > 0)) return true;
  const p = pristineOf();
  for (const st of ['exercises', 'templates']) {
    const list = all(st);
    if (list.length !== p[st].size || list.some((o) => edited(st, o))) return true;
  }
  const s = settings() || {};
  if (Array.isArray(s.weekPatterns) && s.weekPatterns.length > 0) return true;
  return PROFILE_KEYS.some((k) => filled(s.profile?.[k]));
}

let restoreInfo; // undefined = sin leer; null = no hay
const countsOf = (data) => Object.fromEntries(STORES.map((st) => [st, (data[st] || []).length]));

/**
 * Resumen del punto guardado, o null: { createdAt, reason: 'import'|'wipe'|'recover', counts: {store: n},
 * summary: backup.dataCounts (fuerza/actividades… para los textos) }.
 */
export async function restorePointInfo() {
  if (restoreInfo === undefined) {
    try {
      const info = await db.get('meta', RESTORE_INFO_ID);
      restoreInfo = info ? infoOf(info) : null;
    } catch (err) {
      console.warn('[store] punto de restauración', err);
      return null;
    }
  }
  return restoreInfo;
}

const infoOf = (r) => ({ createdAt: r.createdAt, reason: r.reason, counts: r.counts, summary: r.summary });

function restoreRecords(backup, reason) {
  const createdAt = Date.now();
  return [
    { id: RESTORE_INFO_ID, createdAt, reason, counts: countsOf(backup.data), summary: dataCounts(backup.data) },
    { id: RESTORE_DATA_ID, createdAt, backup },
  ];
}

const isQuota = (err) => /quota/i.test(`${err?.name} ${err?.message}`);

/**
 * Guarda lo que hay ahora como punto de restauración y lo comprueba releyéndolo del disco. Si no hay nada que
 * proteger y ya existe un punto, se conserva el anterior (borrar dos veces seguidas no pisa los datos de verdad).
 * Lanza RestorePointError si no se puede guardar o comprobar.
 * @returns {Promise<{kept:boolean}|null>}  null si no hacía falta (nada que proteger y sin punto previo)
 */
async function createRestorePoint(reason) {
  await flush();
  if (!hasDataToProtect()) return (await restorePointInfo()) ? { kept: true } : null;
  const backup = exportData();
  const [info, rec] = restoreRecords(backup, reason);
  try {
    await db.putStores({ meta: [info, rec] });
  } catch (err) {
    throw isQuota(err)
      ? new RestorePointError('space', 'No hay espacio libre suficiente en este dispositivo para guardar el punto de restauración.', err)
      : new RestorePointError('write', `No se pudo guardar el punto de restauración (${err?.message || err}).`, err);
  }
  let ok = false;
  try {
    const [bi, br] = await Promise.all([db.get('meta', RESTORE_INFO_ID), db.get('meta', RESTORE_DATA_ID)]);
    ok = bi?.createdAt === info.createdAt && br?.createdAt === info.createdAt
      && STORES.every((st) => Array.isArray(br.backup?.data?.[st]) && br.backup.data[st].length === info.counts[st]
        && bi.counts?.[st] === info.counts[st])
      && JSON.stringify(br.backup) === JSON.stringify(backup);
  } catch { ok = false; }
  if (!ok) {
    // Un punto que no coincide no debe ofrecerse como recuperable.
    await Promise.allSettled([db.del('meta', RESTORE_INFO_ID), db.del('meta', RESTORE_DATA_ID)]);
    restoreInfo = null;
    emit('restorepoint', null);
    throw new RestorePointError('verify', 'El punto de restauración guardado no coincide con tus datos al volver a leerlo.');
  }
  restoreInfo = infoOf(info);
  emit('restorepoint', restoreInfo);
  return { kept: false };
}

/** Pone en memoria (y en disco, en UNA transacción) los datos de `data`; `reserved` como en db.replaceAll. */
async function replaceEverything(data, reason, { reserved = null } = {}) {
  await db.replaceAll(data, { reserved });
  STORES.forEach((s) => {
    maps[s].clear();
    for (const o of data[s]) maps[s].set(o.id, o);
  });
  epoch++; // en cuanto cambia la memoria (y otra vez al terminar la migración)
  if (!maps.meta.get('app')) {
    const app = { id: 'app', createdAt: Date.now(), seedVersion: 0, schema: 1 };
    maps.meta.set('app', app);
    await db.put('meta', app);
  }
  await migrate();
  epoch++;
  emit('reset', { reason });
}

/** Copia profunda de los datos de una copia, sin registros reservados (una copia no puede traer un punto). */
function backupData(obj) {
  const data = {};
  for (const s of STORES) data[s] = deepClone(obj.data[s] || []).filter((o) => !(s === 'meta' && isReserved(o.id)));
  return data;
}

/**
 * Sustituye TODOS los datos por los de la copia (atómico). Antes guarda y comprueba el punto de restauración: si
 * falla, lanza RestorePointError sin tocar nada.
 */
export async function importData(obj) {
  const v = validateBackup(obj);
  if (!v.ok) throw new Error(v.error);
  const data = backupData(obj);
  await createRestorePoint('import');
  await replaceEverything(data, 'import');
}

/**
 * Vuelve al punto de restauración. Si lo de ahora merece protegerse, pasa a ser el nuevo punto en la MISMA
 * transacción (se puede volver atrás); si no, el punto se consume. Si algo falla, no cambia nada.
 */
export async function recoverRestorePoint() {
  await flush();
  const rec = await db.get('meta', RESTORE_DATA_ID);
  const v = rec?.backup ? validateBackup(rec.backup) : { ok: false, error: 'No hay ningún punto de restauración.' };
  if (!v.ok) throw new Error(v.error);
  const reserved = hasDataToProtect() ? restoreRecords(exportData(), 'recover') : [];
  await replaceEverything(backupData(rec.backup), 'recover', { reserved });
  restoreInfo = reserved.length ? infoOf(reserved[0]) : null;
  emit('restorepoint', restoreInfo);
}

/** Elimina el punto de restauración (p. ej. tras «Borrar todo» para no dejar nada en el dispositivo). */
export async function discardRestorePoint() {
  // Primero el resumen: aunque fallara lo segundo, ya no se ofrece (y el siguiente punto lo sobrescribe).
  await db.del('meta', RESTORE_INFO_ID);
  await db.del('meta', RESTORE_DATA_ID);
  restoreInfo = null;
  emit('restorepoint', null);
}

/**
 * Borra todo y vuelve a cargar los datos iniciales. Antes guarda y comprueba el punto de restauración: si falla,
 * lanza RestorePointError sin tocar nada.
 */
export async function wipeAll() {
  await createRestorePoint('wipe');
  await db.replaceAll({});
  STORES.forEach((s) => maps[s].clear());
  epoch++;
  await seedAll();
  epoch++;
  emit('reset', { reason: 'wipe' });
}

export async function requestPersist() {
  persistInfo = await db.requestPersist();
  emit('persist', persistInfo);
  return persistInfo;
}

/** true si hay datos del usuario (sesiones, peso…) y no hay copia en `days` días. */
export function backupOverdue(now = Date.now()) {
  const s = settings();
  const hasUserData = ['sessions', 'bodyweight', 'goals', 'checkins', 'context', 'pastRecords', 'races'].some((st) => count(st) > 0);
  if (!hasUserData) return false;
  const days = s.backupReminderDays ?? 7;
  if (!s.lastBackupAt) return true;
  return now - s.lastBackupAt > days * 86400000;
}

export function today() {
  return todayStr();
}
