// LAB-002 (fase 5): una escritura que falla de forma persistente deja el dato solo en memoria. store.js anota esas claves y las
// reintenta con lo que haya en MEMORIA en ese momento (nunca con una copia vieja) y comprobando antes el disco: no pisa lo más
// nuevo (otra pestaña), no resucita lo borrado ni lo anterior a «sustituir todo». Fallos simulados sobre IDBObjectStore del
// contexto aislado de la prueba (nunca datos reales). Chromium y WebKit.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/persist-pending.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, idbAll, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

const fail = (page, what = 'put') => page.evaluate((w) => {
  const proto = IDBObjectStore.prototype;
  window.__orig = window.__orig || { put: proto.put, delete: proto.delete };
  proto[w] = function () { throw new DOMException('simulado por la prueba', 'QuotaExceededError'); };
}, what);
const heal = (page) => page.evaluate(() => { Object.assign(IDBObjectStore.prototype, window.__orig || {}); });
const onDisk = async (page, id) => (await idbAll(page, 'bodyweight')).find((b) => b.id === id);
const saveFailing = (page, rec) => page.evaluate(async (r) => { try { await window.__app.store.save('bodyweight', r); return 'ok'; } catch { return 'rechazada'; } }, rec);
const retry = (page) => page.evaluate(() => window.__app.store.retryUnsaved());

const cases = {
  async 'fallo persistente y recuperación: lo que solo estaba en memoria llega a disco al reintentar'(page) {
    await fail(page);
    assert.strictEqual(await saveFailing(page, { id: '2026-10-02', kg: 71.3 }), 'rechazada');
    assert.strictEqual(await onDisk(page, '2026-10-02'), undefined, 'sigue sin estar en disco mientras falla');
    assert.strictEqual(await page.evaluate(() => window.__app.store.unsavedCount()), 1);
    assert.strictEqual(await retry(page), 1, 'con el fallo activo sigue pendiente');
    await heal(page);
    assert.strictEqual(await retry(page), 0);
    assert.strictEqual((await onDisk(page, '2026-10-02')).kg, 71.3);
    assert.strictEqual(await page.evaluate(() => window.__app.store.unsavedCount()), 0);
  },
  async 'se reintenta solo con la siguiente escritura correcta y al volver a primer plano'(page) {
    await fail(page);
    await saveFailing(page, { id: '2026-10-02', kg: 70 });
    await heal(page);
    await page.evaluate(() => window.__app.store.save('bodyweight', { id: '2026-10-03', kg: 70.5 }));
    await page.waitForFunction(() => window.__app.store.unsavedCount() === 0, null, { timeout: 5000 });
    assert.strictEqual((await onDisk(page, '2026-10-02')).kg, 70, 'la anterior se guardó sola');
    await fail(page);
    await saveFailing(page, { id: '2026-10-04', kg: 69 });
    await heal(page);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => window.__app.store.unsavedCount() === 0, null, { timeout: 5000 });
    assert.strictEqual((await onDisk(page, '2026-10-04')).kg, 69);
  },
  async 'orden: si se edita después del fallo, se guarda lo último (no la primera versión) y nada más nuevo se pisa'(page) {
    await fail(page);
    await saveFailing(page, { id: '2026-10-02', kg: 70 });
    await saveFailing(page, { id: '2026-10-02', kg: 72 }); // segunda edición, también falla
    await heal(page);
    await retry(page);
    assert.strictEqual((await onDisk(page, '2026-10-02')).kg, 72);
    // fallo, edición correcta (queda en disco), y el reintento no la pisa con nada viejo
    await fail(page);
    await saveFailing(page, { id: '2026-10-05', kg: 60 });
    await heal(page);
    await page.evaluate(() => window.__app.store.save('bodyweight', { id: '2026-10-05', kg: 61 }));
    await retry(page);
    assert.strictEqual((await onDisk(page, '2026-10-05')).kg, 61);
  },
  async 'otra pestaña con un dato más nuevo en disco: el reintento no lo pisa'(page) {
    await fail(page);
    await saveFailing(page, { id: '2026-10-06', kg: 80 });
    await heal(page);
    // «otra pestaña» escribe después (updatedAt posterior) directamente en disco
    await page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('entreno');
      r.onsuccess = () => { const t = r.result.transaction('bodyweight', 'readwrite'); t.objectStore('bodyweight').put({ id: '2026-10-06', kg: 99, createdAt: 1, updatedAt: Date.now() + 5000 }); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
    }));
    await retry(page);
    assert.strictEqual((await onDisk(page, '2026-10-06')).kg, 99, 'conserva lo más nuevo');
    assert.strictEqual(await page.evaluate(() => window.__app.store.unsavedCount()), 0);
  },
  async 'otra pestaña escribe un dato más nuevo entre el aborto y el segundo intento (revisión de Codex nº 5): el reintento no lo pisa'(page) {
    await fail(page);
    await saveFailing(page, { id: '2026-10-13', kg: 70 });
    await heal(page);
    await page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('entreno');
      r.onsuccess = () => {
        const ext = r.result; const orig = IDBObjectStore.prototype.put; let n = 0;
        IDBObjectStore.prototype.put = function (...a) {
          const rq = orig.apply(this, a);
          // el primer intento aborta y, ya creada la transacción de «otra pestaña», el segundo intento de db.js escribe después
          if (n++ === 0 && a[0].id === '2026-10-13') { this.transaction.abort(); ext.transaction('bodyweight', 'readwrite').objectStore('bodyweight').put({ id: '2026-10-13', kg: 99, createdAt: 1, updatedAt: Date.now() + 5000 }); }
          return rq;
        };
        res();
      };
      r.onerror = () => rej(r.error);
    }));
    await retry(page);
    await heal(page);
    assert.strictEqual((await onDisk(page, '2026-10-13')).kg, 99, 'conserva lo más nuevo');
  },
  async 'borrado que falla: se completa al reintentar; si se deshizo (restore) no se borra'(page) {
    await page.evaluate(() => Promise.all([window.__app.store.save('bodyweight', { id: '2026-10-07', kg: 66 }), window.__app.store.save('bodyweight', { id: '2026-10-08', kg: 67 })]));
    await fail(page, 'delete');
    const o1 = await page.evaluate(async () => { try { await window.__app.store.remove('bodyweight', '2026-10-07'); } catch { /* esperado */ } return window.__app.store.get('bodyweight', '2026-10-07'); });
    assert.strictEqual(o1, null);
    const o2 = await page.evaluate(async () => { const st = window.__app.store; const obj = st.get('bodyweight', '2026-10-08'); try { await st.remove('bodyweight', '2026-10-08'); } catch { /* esperado */ } await st.restore('bodyweight', obj); return st.get('bodyweight', '2026-10-08').kg; });
    assert.strictEqual(o2, 67);
    await heal(page);
    await retry(page);
    assert.strictEqual(await onDisk(page, '2026-10-07'), undefined, 'borrado completado');
    assert.strictEqual((await onDisk(page, '2026-10-08')).kg, 67, 'el deshecho se respeta');
  },
  async 'borrado que falla y otra pestaña edita después (revisión de Codex nº 6): el reintento no borra lo más nuevo y avisa'(page) {
    for (const [id, upd] of [['2026-10-14', () => Date.now() + 5000], ['2026-10-15', null]]) { // 2.º: mismo updatedAt (ms) pero otro contenido
      await page.evaluate((i) => window.__app.store.save('bodyweight', { id: i, kg: 66 }), id);
      await fail(page, 'delete');
      await page.evaluate(async (i) => { try { await window.__app.store.remove('bodyweight', i); } catch { /* esperado */ } }, id);
      await heal(page);
      await page.evaluate((a) => new Promise((res, rej) => {
        const [i, newer] = a;
        const r = indexedDB.open('entreno');
        r.onsuccess = () => {
          const g = r.result.transaction('bodyweight').objectStore('bodyweight').get(i);
          g.onsuccess = () => {
            const t = r.result.transaction('bodyweight', 'readwrite');
            t.objectStore('bodyweight').put({ ...g.result, kg: 99, updatedAt: newer ?? g.result.updatedAt });
            t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error);
          };
        };
      }), [id, upd && upd()]);
      await retry(page);
      assert.strictEqual((await onDisk(page, id)).kg, 99, 'conserva lo que otra pestaña escribió');
      assert.strictEqual(await page.evaluate(() => window.__app.store.unsavedCount()), 0);
      assert.strictEqual(await page.evaluate((i) => window.__app.store.get('bodyweight', i)?.kg, id), 99, 'la pantalla vuelve a mostrarlo');
    }
    await page.waitForFunction(() => /no se completó el borrado/i.test(document.body.innerText), null, { timeout: 5000 });
  },
  async 'guardado pendiente cuyo reintento aborta y un borrado concurrente que también falla (revisión de Codex nº 7): el borrado sigue pendiente'(page) {
    await page.evaluate(() => window.__app.store.save('bodyweight', { id: '2026-10-16', kg: 60 })); // versión ya en disco
    await fail(page);
    await saveFailing(page, { id: '2026-10-16', kg: 66 });
    await heal(page);
    await page.evaluate(() => {
      const op = IDBObjectStore.prototype.put; const od = IDBObjectStore.prototype.delete; let n = 0;
      IDBObjectStore.prototype.put = function (...a) {
        const r = op.apply(this, a);
        if (n++ === 0) { this.transaction.abort(); window.__removed = window.__app.store.remove('bodyweight', '2026-10-16').catch(() => {}); }
        return r;
      };
      IDBObjectStore.prototype.delete = function () { throw new DOMException('simulado por la prueba', 'QuotaExceededError'); };
      window.__orig = { put: op, delete: od };
    });
    await retry(page);
    await page.evaluate(() => window.__removed);
    assert.strictEqual(await page.evaluate(() => window.__app.store.unsavedCount()), 1, 'el borrado fallido sigue pendiente');
    await heal(page);
    await retry(page);
    assert.strictEqual(await onDisk(page, '2026-10-16'), undefined, 'borrado completado');
  },
  async 'borrado concurrente con un reintento que aborta (revisión de Codex): el registro borrado no reaparece ni se da por guardado'(page) {
    await fail(page);
    await saveFailing(page, { id: '2026-10-12', kg: 58 });
    await heal(page);
    // el primer intento del reintento aborta de forma asíncrona y, en ese instante, se borra el registro
    await page.evaluate(() => {
      const orig = IDBObjectStore.prototype.put;
      let n = 0;
      IDBObjectStore.prototype.put = function (...a) {
        const r = orig.apply(this, a);
        if (n++ === 0) { this.transaction.abort(); window.__removed = window.__app.store.remove('bodyweight', '2026-10-12'); }
        else if (n === 2) this.transaction.abort(); // el reintento de db.js (y cualquier escritura de corrección) también aborta
        return r;
      };
    });
    await retry(page);
    await page.evaluate(() => window.__removed);
    await heal(page);
    await retry(page);
    assert.strictEqual(await page.evaluate(() => window.__app.store.get('bodyweight', '2026-10-12')), null);
    assert.strictEqual(await onDisk(page, '2026-10-12'), undefined, 'borrado y sigue borrado en disco');
  },
  async 'sustituir todo (restaurar una copia) descarta lo pendiente: nada se resucita'(page) {
    const snap = await page.evaluate(() => JSON.parse(JSON.stringify(window.__app.store.exportData())));
    await fail(page);
    await saveFailing(page, { id: '2026-10-09', kg: 55 });
    await heal(page);
    await page.evaluate(async (s) => { await window.__app.store.importData(s); }, snap);
    assert.strictEqual(await page.evaluate(() => window.__app.store.unsavedCount()), 0);
    await retry(page);
    assert.strictEqual(await onDisk(page, '2026-10-09'), undefined);
    assert.strictEqual(await page.evaluate(() => window.__app.store.get('bodyweight', '2026-10-09')), null);
  },
  async 'el fallo transitorio sigue resolviéndose en db.js sin dejar nada pendiente ni aviso'(page) {
    await page.evaluate(() => { const o = IDBObjectStore.prototype.put; window.__orig = { put: o }; let n = 0; IDBObjectStore.prototype.put = function (...a) { if (n++ === 0) throw new DOMException('simulado', 'UnknownError'); return o.apply(this, a); }; });
    assert.strictEqual(await saveFailing(page, { id: '2026-10-10', kg: 70 }), 'ok');
    await heal(page);
    assert.strictEqual(await page.evaluate(() => window.__app.store.unsavedCount()), 0);
    assert.strictEqual((await onDisk(page, '2026-10-10')).kg, 70);
  },
  async 'el aviso dice que se reintentará y, al recuperarse, se avisa de que ya se guardó'(page) {
    await fail(page);
    await saveFailing(page, { id: '2026-10-11', kg: 70 });
    await page.waitForFunction(() => /No se pudo guardar/.test(document.body.innerText));
    const msg = await page.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"],.toast')].map((e) => e.textContent).join(' '));
    assert.match(msg, /reintentar/i);
    await heal(page);
    await retry(page);
    await page.waitForFunction(() => /ya está guardado|Ya se guardó/i.test(document.body.innerText), null, { timeout: 5000 });
  },
};

for (const [browser, skip] of [['chromium', false], ['webkit', skipWebkit]]) {
  for (const [name, fn] of Object.entries(cases)) {
    test(`${name} (${browser})`, { skip }, async () => {
      const app = await openApp({ browser });
      try { await fn(app.page); } finally { await app.close(); }
    });
  }
}
