// db.js — capa mínima sobre IndexedDB. Todas las stores usan keyPath 'id'.
// Las escrituras se resuelven cuando la transacción se COMPLETA (dato en disco).

export const DB_NAME = 'entreno';
export const DB_VERSION = 1;
export const STORES = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals'];

let dbPromise = null;

function openOnce() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('No se pudo abrir la base de datos'));
    req.onblocked = () => console.warn('[db] apertura bloqueada por otra pestaña');
  });
}

export function openDB() {
  if (!dbPromise) {
    dbPromise = openOnce().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// iOS puede perder la conexión con IndexedDB tras pasar a segundo plano:
// si una operación falla, se reabre la base de datos y se reintenta una vez.
async function withRetry(fn) {
  try {
    return await fn(await openDB());
  } catch (err) {
    console.warn('[db] reintentando tras error:', err);
    dbPromise = null;
    return fn(await openDB());
  }
}

function runTx(db, storeNames, mode, body) {
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = db.transaction(storeNames, mode);
    } catch (err) {
      reject(err);
      return;
    }
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('Error de transacción'));
    t.onabort = () => reject(t.error || new Error('Transacción abortada'));
    try {
      result = body(t);
    } catch (err) {
      try { t.abort(); } catch { /* ya abortada */ }
      reject(err);
    }
  });
}

export function getAll(store) {
  return withRetry((db) => new Promise((resolve, reject) => {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  }));
}

export function put(store, value) {
  return withRetry((db) => runTx(db, [store], 'readwrite', (t) => { t.objectStore(store).put(value); }));
}

export function putMany(store, values) {
  return withRetry((db) => runTx(db, [store], 'readwrite', (t) => {
    const os = t.objectStore(store);
    for (const v of values) os.put(v);
  }));
}

export function del(store, id) {
  return withRetry((db) => runTx(db, [store], 'readwrite', (t) => { t.objectStore(store).delete(id); }));
}

/**
 * Sustituye TODO el contenido en una única transacción (atómica):
 * si algo falla, no se borra nada.
 * @param {Record<string, object[]>} data  { store: [registros] }
 */
export function replaceAll(data) {
  return withRetry((db) => runTx(db, STORES, 'readwrite', (t) => {
    for (const s of STORES) {
      const os = t.objectStore(s);
      os.clear();
      for (const v of data[s] || []) os.put(v);
    }
  }));
}

/** Pide almacenamiento persistente. Devuelve { supported, persisted }. */
export async function requestPersist() {
  const out = { supported: false, persisted: false };
  try {
    if (navigator.storage && navigator.storage.persist) {
      out.supported = true;
      out.persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
    }
  } catch (err) {
    console.warn('[db] persist()', err);
  }
  return out;
}

export async function estimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* no disponible */ }
  return null;
}
