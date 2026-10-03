// E2E de la ronda 6, fase E (docs/MEJORAS6.md): eventos deportivos. Desde Objetivos › «Eventos deportivos» se apunta un
// 10K con tiempo objetivo y un objetivo de resistencia enlazado; Hoy muestra UNA línea «🏁 10K · N días · objetivo
// <50:00»; la ficha dice «Cómo vas» (race-predict y goalProgress); el análisis lo lleva en «Tu contexto»; borrar se
// deshace. También en WebKit si está instalado. Datos sintéticos relativos a hoy.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/races.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, settle, shot, idbAll, engineAvailable, waitRoute } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

/** Dos carreras recientes (para el tiempo previsto) y un objetivo de 10 km en menos de 45 min (aún no conseguido). */
async function seed(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const db = await import('./js/db.js');
    const T = u.todayStr();
    const run = (ago, km, sec) => { const date = u.addDays(T, -ago); return { id: `run_${ago}`, kind: 'run', status: 'done', date, startedAt: u.tsFromDate(date, 8), createdAt: u.tsFromDate(date, 8), durationMin: sec / 60, movingSec: sec, distanceKm: km, rpe: 6 }; };
    const goal = { id: 'goal_10k', kind: 'endurance', sport: 'run', distanceKm: 10, timeSec: 2700, title: '10 km en menos de 45 min', titleAuto: true, createdAt: u.tsFromDate(u.addDays(T, -30), 9), achievedAt: null, archived: false };
    const bike = { id: 'goal_bike', kind: 'endurance', sport: 'bike', distanceKm: 40, timeSec: null, title: '40 km en bici', titleAuto: true, createdAt: 1, achievedAt: null, archived: false };
    await db.putStores({ sessions: [run(5, 10, 2940), run(12, 8, 2300)], goals: [goal, bike] });
  });
  await reload(page);
}

const fill = async (loc, text) => { await loc.click(); await loc.fill(text); };

async function flow(page, { shots = false } = {}) {
  await seed(page);
  // Objetivos › «Eventos deportivos» → vacío
  await go(page, '#/goals');
  await page.locator('.goal-races .rc-link').click();
  await waitRoute(page, /^#\/races$/);
  assert.match(await page.locator('.rc-empty').innerText(), /Sin eventos apuntados/);
  await page.locator('.rc-empty button').click();
  await waitRoute(page, /^#\/races\/new$/);
  // 10K (por defecto) · nombre · fecha dentro de 73 días · 50:00 · prioridad A · objetivo de carrera (el de bici no sale)
  assert.strictEqual(await page.locator('.rc-types .chip[aria-pressed="true"]').innerText(), '10K');
  await fill(page.locator('[data-field="name"] input'), 'San Silvestre');
  const date = await page.evaluate(async () => { const u = await import('./js/util.js'); return u.addDays(u.todayStr(), 73); });
  await page.locator('.rc-date').fill(date);
  await page.locator('.rc-date').dispatchEvent('change');
  await fill(page.locator('[data-field="target"] .dur-input').nth(1), '50');
  await page.locator('[data-field="target"] .dur-input').nth(1).dispatchEvent('change');
  assert.strictEqual(await page.locator('[data-field="priority"] .seg-btn[aria-pressed="true"]').innerText(), 'A');
  const goalChips = await page.locator('.rc-goals .chip').allInnerTexts();
  assert.deepStrictEqual(goalChips, ['10 km en menos de 45 min'], 'solo los objetivos de carrera activos');
  await page.locator('.rc-goals .chip').first().click();
  // «Cómo vas»: el veredicto de race-predict y el objetivo enlazado (goalProgress)
  const how = page.locator('.rc-how');
  await how.waitFor();
  assert.match(await how.locator('.rc-how-pred .rc-how-line').innerText(), /^(Probable|Ajustado|Hoy no) · previsto \d+:\d\d–\d+:\d\d$/);
  assert.match(await how.locator('.rc-how-goal .rc-how-line').innerText(), /^10 km en menos de 45 min · /);
  if (shots) { await how.scrollIntoViewIfNeeded(); await settle(page); await shot(page, 'races-edit-how'); }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sin desplazamiento horizontal');
  await page.locator('.rc-save').click();
  await waitRoute(page, /^#\/races$/);
  // Lista: la fila con su prioridad y el tiempo previsto
  const row = page.locator('.rc-row').first();
  assert.match(await row.locator('.rc-row-title').innerText(), /^San Silvestre · 10K$/);
  assert.match(await row.locator('.rc-row-meta').innerText(), /10 km · Prioridad A · en 73 días$/);
  assert.match(await row.locator('.rc-row-pred').innerText(), /^Objetivo <50:00 · previsto \d+:\d\d–\d+:\d\d · (Probable|Ajustado|Hoy no)$/);
  const saved = (await idbAll(page, 'races'))[0];
  assert.deepStrictEqual({ type: saved.type, name: saved.name, date: saved.date, distanceKm: saved.distanceKm, targetSec: saved.targetSec, priority: saved.priority, goalId: saved.goalId },
    { type: '10k', name: 'San Silvestre', date, distanceKm: 10, targetSec: 3000, priority: 'A', goalId: 'goal_10k' });
  if (shots) { await settle(page); await shot(page, 'races-list'); }
  // Hoy: UNA línea con el próximo evento
  await go(page, '#/today');
  const line = page.locator('.today-race');
  assert.strictEqual(await line.count(), 1);
  assert.strictEqual(await line.locator('.today-race-text').innerText(), '🏁 10K · 73 días · objetivo <50:00');
  if (shots) { await line.scrollIntoViewIfNeeded(); await settle(page); await shot(page, 'races-today'); }
  await line.click();
  await waitRoute(page, new RegExp(`^#/races/${saved.id}$`));
  assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Editar evento');
  // El analista lo tiene en cuenta como contexto
  await go(page, '#/analysis');
  const items = await page.locator('.an-ctx .an-ctx-item').allInnerTexts();
  assert.ok(items.some((t) => /^San Silvestre \(10K\) · .* \(en 73 días\) · objetivo <50:00 · prioridad A$/.test(t)), items.join(' | '));
  // Borrar (desde la lista, como se llega normalmente) y deshacer
  await go(page, '#/races');
  await page.locator('.rc-row').first().click();
  await waitRoute(page, new RegExp(`^#/races/${saved.id}$`));
  await page.locator('.rc-delete').click();
  await page.locator('.sheet-panel .btn-danger', { hasText: 'Borrar' }).click();
  await waitRoute(page, /^#\/races$/);
  await page.locator('.toast button').click();
  await page.waitForFunction(() => document.querySelectorAll('.rc-row').length === 1);
  assert.strictEqual((await idbAll(page, 'races')).length, 1);
}

test('eventos deportivos: apuntar un 10K, «Cómo vas», una línea en Hoy, contexto del analista y deshacer (375 px)', async () => {
  const app = await openApp();
  try {
    await app.page.setViewportSize({ width: 375, height: 667 });
    await flow(app.page, { shots: true });
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('eventos: validación (otro sin nombre, ciclismo sin distancia) y Hoy sin eventos relevantes', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/races/new');
    await page.locator('.rc-types .chip', { hasText: 'Otro' }).click();
    await page.locator('.rc-save').click();
    assert.match(await page.locator('[data-err="name"]').innerText(), /Ponle un nombre/);
    await page.locator('.rc-types .chip', { hasText: 'Ciclismo' }).click();
    await page.locator('.rc-save').click();
    assert.match(await page.locator('[data-err="distanceKm"]').innerText(), /Indica la distancia/);
    assert.strictEqual(await page.locator('.rc-how').count(), 0, 'sin «Cómo vas» en ciclismo');
    // Solo un evento C dentro de 2 meses: Hoy no lo enseña
    await page.evaluate(async () => {
      const u = await import('./js/util.js');
      await window.__app.store.save('races', { id: 'race_c', name: '', type: '5k', date: u.addDays(u.todayStr(), 60), distanceKm: 5, targetSec: null, priority: 'C', note: '', goalId: null, createdAt: 1, updatedAt: 1 });
    });
    await go(page, '#/today');
    await page.locator('.today-plan').waitFor();
    assert.strictEqual(await page.locator('.today-race').count(), 0);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// Regresión (anterior a la fase E): la confirmación de «Borrar todos los datos» no contaba las marcas históricas (ni
// contaría los eventos): con solo eso decía «tus registros».
test('«Borrar todos los datos» cuenta también las marcas históricas y los eventos deportivos', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.evaluate(async () => {
      const { store } = window.__app;
      await store.save('pastRecords', { id: 'pr1', exerciseId: 'press_banca', weight: 100, reps: 5, rir: null, date: null, beforeApp: true, bodyweightKg: null, note: '', createdAt: 1, updatedAt: 1 });
      await store.save('races', { id: 'race1', name: '', type: '10k', date: '2030-01-01', distanceKm: 10, targetSec: null, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1 });
    });
    await go(page, '#/settings/data');
    await page.locator('.cfg-wipe').click();
    const panel = page.locator('.sheet-panel').last();
    await panel.waitFor();
    assert.match(await panel.innerText(), /Se borrará todo lo de este iPhone: .*1 marca histórica, 1 evento deportivo, además de tus ajustes\./);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('WebKit: eventos deportivos', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit' });
  try {
    await flow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
