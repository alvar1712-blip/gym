// E2E de los parciales de una carrera importada (ronda 8, C1+C2): un FIT sintético de 12,4 km con un 5 km rápido en
// medio (24:50) y autovueltas de 1 km se importa; la revisión dice que se guardan los parciales; en IndexedDB quedan
// track (serie compacta, sin coordenadas), laps y bestEfforts, y sobreviven a exportar → importar una copia. Si se
// cambia la distancia en la revisión, no se guarda ningún parcial. Chromium y WebKit, a 375 px y con texto al 150 %.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/import-splits.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, idbAll, storeAll, shot, engineAvailable } = require('./helpers.cjs');
const { fit12kBuffer: fitBuffer } = require('./fit-12k.cjs');

const NOW = new Date('2026-09-26T10:00:00Z');
const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado';

async function setup(browser, large) {
  const app = await openApp({
    browser,
    beforeLoad: large ? async (p) => { await p.evaluate(() => localStorage.setItem('entreno.textScale', '1.5')); } : null,
  });
  await app.page.setViewportSize({ width: 375, height: 760 });
  await app.page.clock.setFixedTime(NOW);
  await reload(app.page);
  return app;
}

async function importFile(page, buffer) {
  await go(page, '#/import');
  await page.waitForSelector('.imp-intro');
  await page.setInputFiles('input.imp-file', { name: 'carrera-12k.fit', mimeType: 'application/octet-stream', buffer });
  await page.waitForFunction(() => document.querySelectorAll('.imp-item').length === 1 && !document.querySelector('.imp-pick[disabled]'));
}

/** Abre la revisión y espera a que la hoja termine de entrar (sin esperas fijas). */
async function openReview(page) {
  await page.locator('.imp-item .imp-item-main').click();
  const sh = page.locator('.sheet-overlay.open .sheet-panel').last();
  await sh.waitFor();
  await page.waitForFunction(() => {
    const p = document.querySelector('.sheet-overlay.open .sheet-panel');
    return p && p.getAnimations({ subtree: true }).every((a) => a.playState !== 'running');
  });
  return sh;
}

async function closeReview(page, sh) {
  await sh.locator('.sheet-actions button', { hasText: 'Listo' }).click();
  await page.waitForFunction(() => !document.querySelector('.sheet-overlay'));
}

async function importAndSave(browser, large) {
  const app = await setup(browser, large);
  const { page } = app;
  const tag = `${browser}-${large ? '150' : '100'}`;
  try {
    assert.strictEqual(await page.evaluate(() => document.documentElement.classList.contains('text-large')), large);
    await importFile(page, await fitBuffer());
    const card = page.locator('.imp-item');
    assert.strictEqual(await card.locator('.imp-item-title').innerText(), 'Carrera');
    assert.match(await card.innerText(), /12,4 km · 1:05:32/);

    const sh = await openReview(page);
    const note = sh.locator('.imp-splits');
    assert.strictEqual(await note.innerText(), 'Se guardan los parciales (tiempo y distancia, sin el recorrido).');
    await note.scrollIntoViewIfNeeded();
    const fits = await note.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const p = el.closest('.sheet-panel').getBoundingClientRect();
      return r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && el.scrollWidth <= el.clientWidth + 1;
    });
    assert.ok(fits, 'la nota cabe en la hoja');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sin scroll horizontal');
    await shot(page, `import-splits-review-375-${tag}`);
    await closeReview(page, sh);

    await page.locator('.imp-save').click();
    await page.waitForSelector('.imp-done');
    const [rec] = await idbAll(page, 'sessions');
    assert.strictEqual(rec.kind, 'run');
    assert.strictEqual(rec.distanceKm, 12.4);
    assert.strictEqual(rec.movingSec, 3932);
    assert.deepStrictEqual(rec.bestEfforts.basis, { km: 12.4, sec: 3932 });
    assert.strictEqual(rec.bestEfforts.src, 'track');
    const five = rec.bestEfforts.items['5k'];
    assert.ok(Math.abs(five.sec - 1490) <= 1, `mejor 5 km ${five.sec}`);
    assert.ok(Math.abs(five.atKm - 3) <= 0.01, `empieza en el km ${five.atKm}`);
    assert.strictEqual(five.approx, false);
    assert.ok(Math.abs(rec.bestEfforts.items['10k'].sec - (1490 + 5 * 330)) <= 1);
    assert.strictEqual(rec.track.src, 'device');
    assert.strictEqual(rec.track.v, 1);
    assert.ok(rec.track.n >= 2 && rec.track.n < 200, `track de ${rec.track.n} puntos`);
    assert.strictEqual(rec.laps.length, 13);
    assert.ok(!('points' in rec) && !JSON.stringify(rec).includes('"lat"'), 'sin puntos ni coordenadas');
    // El mismo cálculo desde la app (best-efforts.effortsOf) y lo mismo en memoria que en disco
    const fromApp = await page.evaluate(async (id) => {
      const be = await import('./js/best-efforts.js');
      return be.effortsOf(window.__app.store.all('sessions').find((s) => s.id === id));
    }, rec.id);
    assert.deepStrictEqual(fromApp, rec.bestEfforts.items);
    assert.deepStrictEqual((await storeAll(page, 'sessions'))[0], rec);

    // Copia: exportar → importar (sustituir todo) conserva los parciales tal cual
    await page.evaluate(async () => {
      const { store } = window.__app;
      await store.importData(JSON.parse(JSON.stringify(store.exportData())));
    });
    const after = await idbAll(page, 'sessions');
    assert.strictEqual(after.length, 1);
    assert.deepStrictEqual(after[0], rec);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

async function editedDistance(browser) {
  const app = await setup(browser, true);
  const { page } = app;
  try {
    await importFile(page, await fitBuffer());
    const sh = await openReview(page);
    await sh.locator('[aria-label="Distancia (km)"]').fill('12,5');
    await page.waitForFunction(() => /^Sin parciales: has cambiado la distancia o el tiempo\.$/.test(document.querySelector('.imp-splits')?.textContent || ''));
    await sh.locator('.imp-splits').scrollIntoViewIfNeeded();
    await shot(page, `import-splits-edited-375-${browser}-150`);
    await closeReview(page, sh);
    await page.locator('.imp-save').click();
    await page.waitForSelector('.imp-done');
    const [rec] = await idbAll(page, 'sessions');
    assert.strictEqual(rec.distanceKm, 12.5);
    assert.ok(!('track' in rec) && !('laps' in rec) && !('bestEfforts' in rec), 'sin parciales');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('carrera importada (Chromium): se guardan track, vueltas y mejores esfuerzos; sobreviven a la copia (texto 100 %)', () => importAndSave('chromium', false));
test('carrera importada (Chromium, texto 150 %)', () => importAndSave('chromium', true));
test('carrera importada (WebKit, texto 150 %)', { skip: skipWebkit }, () => importAndSave('webkit', true));
test('distancia cambiada en la revisión: no se guardan parciales (Chromium)', () => editedDistance('chromium'));
test('distancia cambiada en la revisión: no se guardan parciales (WebKit)', { skip: skipWebkit }, () => editedDistance('webkit'));
