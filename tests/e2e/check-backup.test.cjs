// E2E de «Comprobar copia» (ronda 11): la copia exportada lleva su sello de integridad (SHA-256 de los datos); «Comprobar
// copia» abre un archivo SIN escribir ni sustituir nada y distingue una copia con la estructura válida de otra con la
// integridad comprobada (sin sello = de una versión anterior; sello que no coincide = modificada o dañada). 375 px.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/check-backup.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { openApp, go, idbAll, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const STORES = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle', 'context', 'pastRecords', 'races'];
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const at = new Date('2026-09-29T18:00:00+02:00').getTime();

async function seed(page) {
  await page.evaluate(async (t) => {
    const { store } = window.__app;
    await store.save('sessions', { id: 's1', kind: 'strength', date: '2026-09-29', planDate: '2026-09-29', templateId: null, templateName: 'Sesión libre', status: 'done', startedAt: t, endedAt: t + 3600e3, durationMin: 60, rpe: 7, notes: '', createdAt: t, updatedAt: t,
      exercises: [{ id: 'e', exerciseId: 'press_banca', exName: 'Press banca', templateItemId: null, alternatives: [], notes: '', section: '', target: { sets: 1 }, sets: [{ id: 'st', type: 'effective', done: true, weight: 60, reps: 8, rir: 2, doneAt: t }] }] });
    await store.save('sessions', { id: 'r1', kind: 'run', date: '2026-09-30', planDate: '2026-09-30', status: 'done', startedAt: t + 864e5, movingSec: 2700, durationMin: 45, rpe: 5, distanceKm: 8.2, notes: '', parentId: null, createdAt: t, updatedAt: t });
    await store.save('bodyweight', { id: '2026-09-30', kg: 80.4 });
  }, at);
}
const snapshot = async (page) => {
  const out = {};
  for (const st of STORES) out[st] = JSON.stringify((await idbAll(page, st)).sort((a, b) => String(a.id).localeCompare(String(b.id))));
  return out;
};
const openCheck = async (page, name, content) => {
  await go(page, '#/settings/data');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-verify-btn').click()]);
  await fc.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content, 'utf8') });
  await page.locator('.sheet-panel').waitFor();
  return clean(await page.locator('.sheet-panel').innerText());
};
const closeSheet = async (page) => {
  await page.locator('.cfg-verify-ok, .sheet-panel .btn').first().click();
  await page.waitForSelector('.sheet-panel', { state: 'detached' });
};

async function flow(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await seed(page);
  await go(page, '#/settings/data');

  // La copia exportada lleva el sello: SHA-256 del texto JSON de `data`
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.cfg-export').click()]);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  const backup = JSON.parse(text);
  assert.strictEqual(backup.format, 2, 'el formato no cambia');
  assert.strictEqual(backup.integrity.algorithm, 'sha256');
  assert.strictEqual(backup.integrity.hash, createHash('sha256').update(JSON.stringify(backup.data), 'utf8').digest('hex'));
  assert.strictEqual(backup.integrity.stores.sessions, 2);
  await page.waitForTimeout(400);
  const before = await snapshot(page);
  const settingsBefore = await page.evaluate(() => JSON.stringify(window.__app.store.settings()));

  // 1) Íntegra
  let msg = await openCheck(page, 'copia.json', text);
  assert.match(msg, /Copia válida con integridad comprobada/);
  assert.match(msg, /1 sesión de fuerza/);
  assert.match(msg, /1 actividad/);
  assert.match(msg, /29 sep 2026/);
  assert.match(msg, /Formato 2/);
  assert.match(msg, /no ha cambiado ni escrito nada/);
  assert.strictEqual(await page.locator('.cfg-verify-status').getAttribute('data-status'), 'verified');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal');
  const small = await page.locator('.sheet-panel button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.textContent.trim()));
  assert.deepStrictEqual(small, [], 'botones de 44 px o más');
  await closeSheet(page);

  // 2) Copia de una versión anterior (sin sello): estructura válida, integridad no comprobable
  const legacy = JSON.parse(text);
  delete legacy.integrity;
  msg = await openCheck(page, 'antigua.json', JSON.stringify(legacy));
  assert.match(msg, /Estructura válida, sin sello de integridad/);
  assert.match(msg, /no se puede comprobar/);
  assert.strictEqual(await page.locator('.cfg-verify-status').getAttribute('data-status'), 'unsealed');
  await closeSheet(page);

  // 3) Modificada o incompleta: el sello no coincide y se dice qué falta
  const cut = JSON.parse(text);
  cut.data.sessions.pop();
  msg = await openCheck(page, 'incompleta.json', JSON.stringify(cut));
  assert.match(msg, /el sello de integridad no coincide/);
  assert.match(msg, /Sesiones: el sello dice 2 y el archivo trae 1/);
  assert.strictEqual(await page.locator('.cfg-verify-status').getAttribute('data-status'), 'mismatch');
  await closeSheet(page);
  const edited = JSON.parse(text);
  edited.data.sessions[0].exercises[0].sets[0].weight = 600;
  msg = await openCheck(page, 'editada.json', JSON.stringify(edited));
  assert.match(msg, /no coincide/);
  assert.match(msg, /mismo número de registros/);
  await closeSheet(page);

  // 4) Truncada o no es una copia: error claro, sin tocar nada
  msg = await openCheck(page, 'rota.json', text.slice(0, Math.floor(text.length / 2)));
  assert.match(msg, /No es una copia utilizable/);
  assert.match(msg, /No se ha cambiado nada/);
  await closeSheet(page);
  msg = await openCheck(page, 'otra.json', JSON.stringify({ hola: 'mundo' }));
  assert.match(msg, /No es una copia utilizable/);
  await closeSheet(page);

  // Nada se escribió: ni datos, ni ajustes (fecha de la última copia incluida), ni punto de restauración
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await snapshot(page), before, 'IndexedDB idéntico tras todas las comprobaciones');
  assert.strictEqual(await page.evaluate(() => JSON.stringify(window.__app.store.settings())), settingsBefore);
  assert.strictEqual(await page.evaluate(async () => (await window.__app.store.restorePointInfo()) === null), true, 'ningún punto de restauración nuevo');

  // Importar una copia con el sello incorrecto NO se puede: ni se ofrece sustituir, ni se toca nada (datos, ajustes, punto de restauración)
  for (const [name, content] of [['editada.json', edited], ['incompleta.json', cut]]) {
    await go(page, '#/settings/data');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-import').click()]);
    await fc.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(content), 'utf8') });
    await page.locator('.sheet-panel').waitFor();
    const txt = clean(await page.locator('.sheet-panel').innerText());
    assert.match(txt, /No se puede importar/);
    assert.match(txt, /no se restaura/);
    assert.doesNotMatch(txt, /Sustituir todo/);
    await closeSheet(page);
  }
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await snapshot(page), before, 'tras intentar importar copias manipuladas, IndexedDB idéntico');
  assert.strictEqual(await page.evaluate(async () => (await window.__app.store.restorePointInfo()) === null), true, 'sin punto de restauración nuevo');
  // El propio almacén la rechaza aunque se llegue por otro camino
  const rejected = await page.evaluate(async (c) => { try { await window.__app.store.importData(c); return 'importada'; } catch (e) { return e.message; } }, edited);
  assert.match(rejected, /sello de integridad/);
  assert.deepStrictEqual(await snapshot(page), before);

  // Una copia anterior SIN sello sigue siendo compatible: se ofrece restaurarla y se restaura
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-import').click()]);
  await fc2.setFiles({ name: 'antigua.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy), 'utf8') });
  await page.locator('.sheet-panel').waitFor();
  assert.match(clean(await page.locator('.sheet-panel').innerText()), /Sustituir todo/);
  await page.locator('.sheet-panel .btn', { hasText: 'Sustituir todo' }).click();
  await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 2, null, { timeout: 8000 });
}

test('Comprobar copia: sello, estados, sin escribir nada (Chromium, 375 px)', async () => {
  const app = await openApp();
  try {
    await flow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Comprobar copia (WebKit, 375 px)', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit' });
  try {
    await flow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
