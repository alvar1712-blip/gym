// store.js — estado en memoria + escritura inmediata en IndexedDB (write-through).
// Toda la app lee de aquí de forma SÍNCRONA; cada cambio se persiste al instante.
import * as db from './db.js';
import { SEED_VERSION, defaultSettings, SEED_EXERCISES, SEED_TEMPLATES } from './seed.js';
import { deepClone, fillDefaults, sortBy, todayStr } from './util.js';

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
let persistInfo = { supported: false, persisted: false };

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
  let settings = maps.meta.get('settings');
  if (!settings) {
    settings = defaultSettings();
    maps.meta.set('settings', settings);
    await db.put('meta', settings);
  } else {
    const before = JSON.stringify(settings);
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

/** Sustituye TODOS los datos por los de la copia (atómico). */
export async function importData(obj) {
  const v = validateBackup(obj);
  if (!v.ok) throw new Error(v.error);
  await flush();
  const data = {};
  for (const s of STORES) data[s] = deepClone(obj.data[s] || []);
  await db.replaceAll(data);
  STORES.forEach((s) => {
    maps[s].clear();
    for (const o of data[s]) maps[s].set(o.id, o);
  });
  if (!maps.meta.get('app')) {
    const app = { id: 'app', createdAt: Date.now(), seedVersion: 0, schema: 1 };
    maps.meta.set('app', app);
    await db.put('meta', app);
  }
  await migrate();
  emit('reset', { reason: 'import' });
}

/** Borra todo y vuelve a cargar los datos iniciales. */
export async function wipeAll() {
  await flush();
  await db.replaceAll({});
  STORES.forEach((s) => maps[s].clear());
  await seedAll();
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
