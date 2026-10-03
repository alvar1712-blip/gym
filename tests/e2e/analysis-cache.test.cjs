// E2E de la ronda 6, fase G (docs/MEJORAS6.md): caché del análisis con contadores de revisión, en la app de verdad.
// Oráculo: tras CADA tipo de escritura del store (save, saveSoon, remove, restore, ajustes, contexto, eventos, check-ins,
// importar, borrar todo), lo que da la caché es idéntico a calcular el análisis desde cero; y sin escrituras se reutiliza
// el mismo resultado (Hoy → Análisis → Hoy no recalcula). Datos sintéticos relativos a hoy.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/analysis-cache.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, settle, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

async function seed(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const db = await import('./js/db.js');
    const { store } = window.__app;
    const T = u.todayStr();
    const sessions = []; const bodyweight = [];
    for (let i = 60; i >= 1; i--) {
      bodyweight.push({ id: u.addDays(T, -i), kg: 80 + i * 0.02, createdAt: 1, updatedAt: 1 });
      if (i % 3 === 0) {
        const date = u.addDays(T, -i);
        sessions.push({ id: `s${i}`, kind: 'strength', status: 'done', date, planDate: date, startedAt: u.tsFromDate(date, 18), createdAt: 1, updatedAt: 1, durationMin: 60, rpe: 7,
          exercises: [{ id: `e${i}`, exerciseId: 'press_banca', sets: [0, 1, 2].map((k) => ({ id: `x${i}_${k}`, type: 'effective', done: true, weight: 80 + (60 - i) * 0.3, reps: 5, rir: 2 })) }] });
      }
    }
    const settings = store.settings();
    settings.profile = { ...(settings.profile || {}), sex: 'male', goal: 'gain', experience: 'intermediate', birthDate: '1990-01-01', promptDismissed: true, onboardedAt: 1 };
    await db.putStores({ sessions, bodyweight, meta: [settings] });
  });
  await reload(page);
}

/**
 * Llama a `mutate` (en la página) entre dos lecturas de la caché y comprueba: la segunda lectura recalcula (un fallo más),
 * da algo distinto de la primera y es idéntica a calcular desde cero.
 */
async function invalidates(page, label, mutate) {
  const r = await page.evaluate(async (src) => {
    const v = await import('./js/views/analysis.js');
    const an = await import('./js/analysis.js');
    const u = await import('./js/util.js');
    const { store } = window.__app;
    const T = u.todayStr();
    const before = JSON.stringify(v.analysisFor(T));
    const s0 = v.analysisCacheStats();
    await (new Function('store', 'u', 'T', `return (async () => { ${src} })()`))(store, u, T);
    const cached = JSON.stringify(v.analysisFor(T));
    const s1 = v.analysisCacheStats();
    const fresh = JSON.stringify(an.buildAnalysis(v.analysisData(T), T));
    return { recalculated: s1.misses === s0.misses + 1, changed: cached !== before, same: cached === fresh };
  }, mutate);
  assert.deepStrictEqual(r, { recalculated: true, changed: true, same: true }, label);
}

async function flow(page) {
  await seed(page);
  await go(page, '#/today');
  await page.locator('.today-extra[data-ready="1"]').waitFor({ state: 'attached' });
  const stats = () => page.evaluate(async () => (await import('./js/views/analysis.js')).analysisCacheStats());
  const s0 = await stats();
  assert.ok(s0.misses >= 1, 'Hoy calculó el análisis');
  // Sin escrituras: Análisis y la vuelta a Hoy reutilizan el resultado
  await go(page, '#/analysis');
  await page.locator('.an-card-weight').waitFor();
  await go(page, '#/today');
  await page.locator('.today-extra[data-ready="1"]').waitFor({ state: 'attached' });
  const s1 = await stats();
  assert.strictEqual(s1.misses, s0.misses, 'sin recalcular');
  assert.strictEqual(s1.hits, s0.hits + 2, 'Análisis y Hoy, desde la caché');
  assert.ok(await page.evaluate(async () => { const v = await import('./js/views/analysis.js'); const u = await import('./js/util.js'); return v.analysisFor(u.todayStr()) === v.analysisFor(u.todayStr()); }), 'el mismo objeto');

  // Cada tipo de escritura invalida y el resultado coincide con calcular desde cero
  await invalidates(page, 'save (pesaje)', "await store.save('bodyweight', { id: T, kg: 83.4 });");
  await invalidates(page, 'saveSoon (pesaje mientras se teclea)', "store.saveSoon('bodyweight', { id: u.addDays(T, -1), kg: 84.1 });");
  await invalidates(page, 'remove (borrar una sesión)', "window.__removed = await store.remove('sessions', 's3');");
  await invalidates(page, 'restore (deshacer el borrado)', "store.restore('sessions', window.__removed);");
  await invalidates(page, 'ajustes (objetivo del perfil)', "const s = store.settings(); s.profile = { ...s.profile, goal: 'lose' }; await store.save('meta', s);");
  await invalidates(page, 'contexto (empiezo creatina)', "await store.save('context', { id: 'ctx_c', kind: 'event', type: 'creatine_start', date: { date: u.addDays(T, -5), precision: 'day' }, text: '', notes: '', kg: null });");
  await invalidates(page, 'eventos (un 10K)', "await store.save('races', { id: 'race_x', name: '', type: '10k', date: u.addDays(T, 40), distanceKm: 10, targetSec: 3000, priority: 'A', note: '', goalId: null });");
  await invalidates(page, 'check-in', "await store.save('checkins', { id: 'ck_x', date: T, timing: 'pre', sessionId: null, sleep: 1, energy: 2, stress: 3, soreness: 2 });");
  await invalidates(page, 'importar una copia', "const b = store.exportData(); b.data.bodyweight = b.data.bodyweight.slice(0, 10); await store.importData(b);");
  await invalidates(page, 'borrar todo', 'await store.wipeAll();');
}

test('caché del análisis: Hoy → Análisis → Hoy sin recalcular; cada escritura invalida y coincide con calcular desde cero', async () => {
  const app = await openApp();
  try {
    await flow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('WebKit: caché del análisis', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit' });
  try {
    await flow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('caché del análisis: al cambiar el día (la app abierta de un día para otro) se recalcula', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seed(page);
    const r = await page.evaluate(async () => {
      const v = await import('./js/views/analysis.js');
      const u = await import('./js/util.js');
      const T = u.todayStr();
      const a = v.analysisFor(T);
      const s0 = v.analysisCacheStats();
      const b = v.analysisFor(u.addDays(T, 1));
      const s1 = v.analysisCacheStats();
      return { recalculated: s1.misses === s0.misses + 1, other: a !== b, today: b.today === u.addDays(T, 1) };
    });
    assert.deepStrictEqual(r, { recalculated: true, other: true, today: true });
    await settle(page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
