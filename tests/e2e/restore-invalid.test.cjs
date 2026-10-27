// E2E de la restauración de una copia con registros dañados: se rechaza ANTES de escribir nada (ni punto de
// restauración) y el historial y los ajustes actuales quedan intactos, en memoria y en disco. Una copia antigua
// legítima (campos opcionales ausentes) sí se restaura.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/restore-invalid.test.cjs  (también WebKit, si está instalado)
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, idbAll, engineAvailable } = require('./helpers.cjs');

const skip = !engineAvailable() && 'navegador no instalado';
const STORES = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle', 'context', 'pastRecords', 'races'];
const byId = (arr) => [...arr].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));

async function snapshot(page) {
  await page.evaluate(() => window.__app.store.flush());
  const out = {};
  for (const s of STORES) out[s] = byId(await idbAll(page, s));
  out.mem = await page.evaluate(() => window.__app.store.exportData().data);
  return out;
}

test('una copia con registros dañados se rechaza sin tocar nada y las pantallas siguen abriendo', { skip }, async () => {
  const app = await openApp({ exampleWeek: true });
  const { page } = app;
  try {
    await page.evaluate(async () => {
      const st = window.__app.store;
      await st.save('sessions', { id: 'act_1', kind: 'run', date: '2026-09-10', status: 'done', distanceKm: 8, movingSec: 2700, durationMin: 45, rpe: 5, notes: 'Rodaje', parentId: null, startedAt: 1, endedAt: 2 });
      await st.save('bodyweight', { id: '2026-09-20', kg: 75.4 });
    });
    const before = await snapshot(page);
    const good = await page.evaluate(() => window.__app.store.exportData());

    const bad = [
      ['ejercicio sin nombre', (d) => d.exercises.push({ id: 'bad_ex', primary: [], logType: 'weight_reps' })],
      ['series que no son lista', (d) => d.sessions.push({ id: 'bad_s', kind: 'strength', status: 'done', date: '2026-09-10', exercises: [{ exerciseId: 'x', sets: 7 }] })],
    ];
    for (const [name, mutate] of bad) {
      const obj = JSON.parse(JSON.stringify(good));
      mutate(obj.data);
      const msg = await page.evaluate(async (o) => { try { await window.__app.store.importData(o); return null; } catch (e) { return e.message; } }, obj);
      assert.match(msg || '', /registro dañado/, name);
      assert.deepStrictEqual(await snapshot(page), before, `${name}: memoria y disco intactos, sin punto de restauración`);
    }
    for (const r of ['#/today', '#/progress', '#/settings', '#/history']) {
      await go(page, r);
      assert.strictEqual(await page.locator('.card-danger').count(), 0, `${r} abre sin pantalla de error`);
    }

    // Copia antigua legítima: sesión de fuerza sin ejercicios ni fechas opcionales, actividad sin campos extra.
    const old = JSON.parse(JSON.stringify(good));
    old.data.sessions.push({ id: 'old_1', kind: 'strength', status: 'done', date: '2024-01-05' }, { id: 'old_2', kind: 'run', status: 'done', date: '2024-01-06' });
    await page.evaluate((o) => window.__app.store.importData(o), old);
    await reload(page);
    for (const r of ['#/progress', '#/history']) {
      await go(page, r);
      assert.strictEqual(await page.locator('.card-danger').count(), 0, `${r} tras restaurar una copia antigua`);
    }
    assert.ok((await idbAll(page, 'sessions')).some((s) => s.id === 'old_1'));
  } finally {
    await app.close();
  }
});
