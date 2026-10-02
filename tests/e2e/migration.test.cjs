// E2E de la migración de IndexedDB (ronda 6, docs/MEJORAS6.md): una base de datos de la versión anterior (v2, ronda 5)
// o de la primera (v1, sin 'cycle') se abre con la app nueva (v3): se crean 'context', 'pastRecords' y 'races' y TODOS
// los registros antiguos siguen idénticos (sesiones, ejercicios, rutinas, peso, objetivos, ciclo, ajustes, plan,
// check-ins). Copias: formato 1 (sin los almacenes nuevos) se importa; formato 2 ida y vuelta; una copia más nueva se
// rechaza. Se prueba en Chromium y, si está instalado, en WebKit.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/migration.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, engineAvailable, waitReady } = require('./helpers.cjs');

const OLD_STORES_V2 = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle'];
const NEW_STORES = ['context', 'pastRecords', 'races'];

/**
 * Crea (en la página en blanco del mismo origen) la base 'entreno' tal como la dejaba una versión anterior de la app,
 * con datos de un usuario real de la ronda 5. Devuelve los registros escritos, por almacén.
 */
function createOldDb(page, version) {
  return page.evaluate(async (version) => {
    const seed = await import('/js/seed.js');
    const stores = version >= 2
      ? ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle']
      : ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals'];
    const t0 = Date.UTC(2026, 6, 1, 10);
    const settings = { id: 'settings', ...seed.defaultSettings(), createdAt: t0, updatedAt: t0, lastBackupAt: t0 + 864e5 * 60, secondaryFactor: 0.75 };
    if (version >= 2) settings.profile = { ...settings.profile, sex: 'female', goal: 'gain', experience: 'advanced', contraception: 'none', promptDismissed: true };
    else delete settings.profile; // la versión 1 no tenía perfil
    const set = (i, w, r, rir, type = 'effective') => ({ id: `set_${i}`, type, weight: w, reps: r, repsR: null, rir, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: t0 + i * 1000 });
    const data = {
      meta: [{ id: 'app', createdAt: t0, seedVersion: seed.SEED_VERSION, schema: 1, seedComplete: true }, settings],
      exercises: [
        ...seed.SEED_EXERCISES.slice(0, 12).map((e) => ({ custom: false, archived: false, aliases: [], secondary: [], notes: '', ...e, createdAt: t0, updatedAt: t0 })),
        { id: 'ex_custom_1', name: 'Remo en máquina Hammer', aliases: [], primary: ['back'], secondary: ['biceps'], pattern: 'horizontal_pull', logType: 'weight_reps', category: 'compound', region: 'upper', notes: 'asiento 4', custom: true, archived: false, createdAt: t0, updatedAt: t0 + 5 },
      ],
      templates: seed.SEED_TEMPLATES.map((t, i) => ({ order: i, notes: '', archived: false, ...t, createdAt: t0, updatedAt: t0 })),
      sessions: [
        { id: 'ses_1', kind: 'strength', date: '2026-09-21', planDate: '2026-09-21', templateId: 'tpl_d1', templateName: 'Día 1 — Upper pesado', status: 'done', startedAt: t0 + 1, endedAt: t0 + 3600e3, durationMin: 62, rpe: 8, notes: 'buena', parentId: null, templateItemId: null, createdAt: t0, updatedAt: t0 + 9, cursor: 0,
          exercises: [{ id: 'se_1', exerciseId: 'press_banca', exName: 'Press banca', templateItemId: 'ti_d1_1', alternatives: [], target: { sets: 3, repMin: 4, repMax: 6 }, notes: '', section: '', groupId: null, groupType: null,
            sets: [set(1, 40, 8, null, 'warmup'), set(2, 80, 6, 2), set(3, 80, 5, 1), set(4, 77.5, 6, 1)] }] },
        { id: 'act_1', kind: 'run', date: '2026-09-23', planDate: '2026-09-23', templateId: null, templateName: '', status: 'done', startedAt: t0 + 2, endedAt: t0 + 2700e3, durationMin: 45, rpe: 5, notes: '', parentId: null, templateItemId: null, createdAt: t0, updatedAt: t0,
          distanceKm: 8.4, movingSec: 2700, elapsedSec: 2760, elevationM: 60, hrAvg: 148, hrMax: 171, subtype: 'z2', feel: 'cómodo', source: { type: 'gpx', fileName: 'carrera.gpx' } },
      ],
      plan: [{ id: '2026-09-26', kind: 'free', label: 'Ruta en bici', activityKind: 'bike', status: null, updatedAt: t0 }],
      bodyweight: [{ id: '2026-09-20', kg: 74.6, createdAt: t0, updatedAt: t0 }, { id: '2026-09-27', kg: 75.1, createdAt: t0, updatedAt: t0 }],
      checkins: [{ id: 'ci_1', date: '2026-09-21', timing: 'pre', sessionId: 'ses_1', sleep: 1, energy: 2, soreness: 3, createdAt: t0, updatedAt: t0 }],
      goals: [{ id: 'goal_1', kind: 'strength', title: 'Banca 90 × 5', titleAuto: true, exerciseId: 'press_banca', weight: 90, reps: 5, createdAt: t0, updatedAt: t0, achievedAt: null, archived: false }],
      cycle: [{ id: '2026-09-10', flow: 'medium', symptoms: ['cramps'], notes: '', createdAt: t0, updatedAt: t0 }],
    };
    for (const s of Object.keys(data)) if (!stores.includes(s)) delete data[s];
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('entreno', version);
      req.onupgradeneeded = () => { for (const s of stores) req.result.createObjectStore(s, { keyPath: 'id' }); };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(stores, 'readwrite');
        for (const s of stores) for (const r of data[s] || []) tx.objectStore(s).put(r);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    return data;
  }, version);
}

/** Versión y almacenes de la base en disco, y todos sus registros. */
function readDisk(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('entreno');
    req.onsuccess = () => {
      const db = req.result;
      const names = [...db.objectStoreNames];
      const out = { version: db.version, stores: names.sort(), data: {} };
      const tx = db.transaction(names, 'readonly');
      for (const n of names) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out.data[n] = r.result; }; }
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }));
}

const byId = (arr) => Object.fromEntries((arr || []).map((r) => [r.id, r]));

for (const browser of ['chromium', 'webkit']) {
  const skip = browser === 'webkit' && !engineAvailable('webkit') ? 'WebKit no instalado (scripts/setup-webkit.sh)' : false;

  for (const version of [2, 1]) {
    test(`${browser}: base v${version} → v3 sin perder ni reescribir nada`, { skip }, async () => {
      let before = null;
      const app = await openApp({ browser, beforeLoad: async (page) => { before = await createOldDb(page, version); } });
      const { page } = app;
      try {
        // La app arranca con los datos antiguos: Hoy, sin bienvenida forzada.
        assert.strictEqual(await page.evaluate(() => location.hash), '#/today');
        assert.strictEqual(await page.locator('.today-plan').count(), 1);
        await page.waitForTimeout(500); // escrituras de la migración (si las hubiera)
        const disk = await readDisk(page);
        assert.strictEqual(disk.version, 3);
        assert.deepStrictEqual(disk.stores, [...OLD_STORES_V2, ...NEW_STORES].sort());
        for (const s of NEW_STORES) assert.deepStrictEqual(disk.data[s], [], `${s} nuevo y vacío`);
        if (version === 1) assert.deepStrictEqual(disk.data.cycle, [], 'v1 → también se crea cycle');
        // Cada registro antiguo, idéntico (los ajustes de la v1 ganan las claves nuevas por defecto, sin tocar las suyas).
        for (const s of Object.keys(before)) {
          const was = byId(before[s]); const now = byId(disk.data[s]);
          assert.deepStrictEqual(Object.keys(now).sort(), Object.keys(was).sort(), `${s}: mismos registros`);
          for (const id of Object.keys(was)) {
            if (s === 'meta' && id === 'settings' && version === 1) {
              for (const [k, v] of Object.entries(was[id])) if (k !== 'updatedAt') assert.deepStrictEqual(now[id][k], v, `settings.${k}`);
              assert.strictEqual(now[id].profile.sex, null, 'perfil nuevo vacío');
            } else {
              assert.deepStrictEqual(now[id], was[id], `${s}/${id} idéntico`);
            }
          }
        }
        // La app lee bien lo antiguo: perfil, check-in sin estrés ni dolor y contexto vacío.
        const st = await page.evaluate(async () => {
          const { getProfile } = await import('./js/profile.js');
          const p = getProfile(window.__app.store.settings());
          return { sex: p.sex, birthDate: p.birthDate, sports: p.sports, checkin: window.__app.store.get('checkins', 'ci_1'), context: window.__app.store.all('context') };
        });
        if (version === 2) assert.deepStrictEqual([st.sex, st.birthDate, st.sports], ['female', null, []]);
        if (version === 2) assert.strictEqual(st.checkin.soreness, 3);
        assert.deepStrictEqual(st.context, []);
        // Y sigue funcionando: se puede apuntar contexto y queda en disco.
        await page.evaluate(async () => {
          const C = await import('./js/context-logic.js');
          await window.__app.store.save('context', C.entryRecord({ kind: 'event', type: 'gym_return', date: { date: '2026-09-01', precision: 'month' } }, { id: 'ctx_mig' }));
        });
        assert.strictEqual((await readDisk(page)).data.context.length, 1);
        // Reabrir: nada cambia.
        await page.reload();
        await waitReady(page);
        const again = await readDisk(page);
        assert.deepStrictEqual(byId(again.data.sessions), byId(disk.data.sessions));
        assert.strictEqual(again.version, 3);
        assert.deepStrictEqual(app.errors, []);
      } finally {
        await app.close();
      }
    });
  }

  test(`${browser}: copias de formato 1 y 2, y una más nueva rechazada`, { skip }, async () => {
    const app = await openApp({ browser });
    const { page } = app;
    try {
      const r = await page.evaluate(async () => {
        const { store } = window.__app;
        const C = await import('./js/context-logic.js');
        await store.save('context', C.entryRecord({ kind: 'event', type: 'creatine_start', date: '2026-09-15' }, { id: 'ctx_a' }));
        await store.save('bodyweight', { id: '2026-09-30', kg: 75 });
        // Copia de formato 1 (app anterior): sin los almacenes nuevos.
        const v1 = store.exportData();
        v1.format = 1;
        for (const s of ['context', 'pastRecords', 'races']) delete v1.data[s];
        v1.data.bodyweight = [{ id: '2026-09-01', kg: 73.2, createdAt: 1, updatedAt: 1 }];
        const okV1 = store.validateBackup(v1);
        await store.importData(v1);
        const afterV1 = { context: store.all('context'), bodyweight: store.all('bodyweight'), pastRecords: store.all('pastRecords'), races: store.all('races') };
        // Formato 2: ida y vuelta con contexto.
        await store.save('context', C.entryRecord({ kind: 'phase', type: 'return', start: { date: '2026-09-01', precision: 'month' }, end: null }, { id: 'ctx_b' }));
        const v2 = store.exportData();
        await store.wipeAll();
        const wiped = store.all('context').length;
        await store.importData(JSON.parse(JSON.stringify(v2)));
        const newer = { ...store.exportData(), format: 3 };
        return {
          okV1, afterV1, v2format: v2.format, v2stores: Object.keys(v2.data).sort(), wiped, ctxBack: store.all('context').map((x) => x.id),
          newer: store.validateBackup(newer),
        };
      });
      assert.strictEqual(r.okV1.ok, true);
      assert.deepStrictEqual(r.afterV1.context, [], 'una copia de formato 1 deja el contexto vacío (sustituye todo)');
      assert.deepStrictEqual(r.afterV1.bodyweight.map((b) => b.kg), [73.2]);
      assert.deepStrictEqual([r.afterV1.pastRecords, r.afterV1.races], [[], []]);
      assert.strictEqual(r.v2format, 2);
      assert.deepStrictEqual(r.v2stores, [...OLD_STORES_V2, ...NEW_STORES].sort());
      assert.strictEqual(r.wiped, 0);
      assert.deepStrictEqual(r.ctxBack, ['ctx_b']);
      assert.strictEqual(r.newer.ok, false);
      assert.match(r.newer.error, /versión más nueva/);
      const disk = await readDisk(page);
      assert.deepStrictEqual(disk.data.context.map((x) => x.id), ['ctx_b']);
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}
