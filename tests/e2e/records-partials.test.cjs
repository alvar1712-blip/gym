// E2E de Récords con los mejores esfuerzos de una carrera importada (ronda 8, C3): un FIT sintético de 12,4 km con un
// 5 km rápido (24:50) dentro se importa; Progreso › Récords › Resistencia enseña el 5 km de ese tramo con «Parcial
// dentro de 12,4 km» (sin distintivo «estimado») y el 10 km también por tramo; al editar la distancia de la actividad
// el parcial deja de contar (vuelve «estimado» a ritmo medio) y al deshacer la edición vuelve. Sin copias: todo se
// deriva de la sesión. Chromium y WebKit, 375 px, texto al 100 % y al 150 %.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/records-partials.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, idbAll, shot, engineAvailable } = require('./helpers.cjs');
const { fit12kBuffer } = require('./fit-12k.cjs');

const NOW = new Date('2026-09-26T10:00:00Z');
const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado';
const clean = (t) => String(t ?? '').replace(/[  ]/g, ' ').replace(/⁠/g, '').replace(/\s+/g, ' ').trim();

async function setup(browser, large) {
  const app = await openApp({
    browser,
    beforeLoad: large ? async (p) => { await p.evaluate(() => localStorage.setItem('entreno.textScale', '1.5')); } : null,
  });
  await app.page.setViewportSize({ width: 375, height: 812 });
  await app.page.clock.setFixedTime(NOW);
  await reload(app.page);
  return app;
}

async function importRun(page) {
  await go(page, '#/import');
  await page.waitForSelector('.imp-intro');
  await page.setInputFiles('input.imp-file', { name: 'carrera-12k.fit', mimeType: 'application/octet-stream', buffer: await fit12kBuffer() });
  await page.waitForFunction(() => document.querySelectorAll('.imp-item').length === 1 && !document.querySelector('.imp-pick[disabled]'));
  await page.locator('.imp-save').click();
  await page.waitForSelector('.imp-done');
  const [rec] = await idbAll(page, 'sessions');
  return rec;
}

async function openRecords(page) {
  await go(page, '#/records');
  await page.waitForSelector('.prg-rec-body');
  await page.locator('.seg-btn', { hasText: 'Resistencia' }).click();
  await page.waitForSelector('.prg-rec[data-sport="run"] [data-rec="5k"]');
}

/** Fila de un récord de carrera tal como se ve. */
const row = (page, id) => page.locator(`.prg-rec[data-sport="run"] [data-rec="${id}"]`).evaluate((el) => ({
  value: el.querySelector('.prg-rec-value').textContent,
  sub: el.querySelector('.prg-rec-sub')?.textContent ?? '',
  badge: el.querySelector('.badge')?.textContent ?? '',
  how: el.dataset.how || '', session: el.dataset.session || '', source: el.dataset.source || '',
}));

/** Cambia la distancia en la ficha de la actividad y espera a que el store la tenga. */
async function editDistance(page, id, txt, km) {
  await go(page, `#/activity/${id}`);
  const input = page.locator('[aria-label="Distancia (km)"]');
  await input.waitFor();
  await input.fill(txt);
  await page.waitForFunction(([sid, v]) => window.__app.store.all('sessions').find((s) => s.id === sid)?.distanceKm === v, [id, km]);
}

async function flow(browser, large) {
  const app = await setup(browser, large);
  const { page } = app;
  const tag = `${browser}-${large ? '150' : '100'}`;
  try {
    const rec = await importRun(page);
    assert.strictEqual(rec.distanceKm, 12.4);
    const five = rec.bestEfforts.items['5k'].sec;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    await openRecords(page);
    let r5 = await row(page, '5k');
    assert.strictEqual(r5.value, fmt(five), 'el tiempo del mejor tramo');
    assert.ok(Math.abs(five - 1490) <= 1, `mejor 5 km ${five}`);
    assert.deepStrictEqual([r5.how, r5.badge, r5.session, r5.source], ['partial', '', rec.id, 'import']);
    assert.match(clean(r5.sub), /^20 sep\.? 2026 · Actividad importada · Parcial dentro de 12,4 km$/);
    const r10 = await row(page, '10k');
    assert.deepStrictEqual([r10.how, r10.badge], ['partial', '']);
    assert.match(clean(r10.sub), /Parcial dentro de 12,4 km$/);
    const r1 = await row(page, '1k');
    assert.strictEqual(r1.how, 'partial');
    const note = clean(await page.locator('.prg-rec[data-sport="run"] .prg-hist-note').textContent());
    assert.match(note, /cuenta tu mejor tramo continuo cuando la importaste de un archivo; si no, se estima con su ritmo medio/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sin scroll horizontal');
    // Cada línea del texto (Range: las cajas reales de cada trozo, también los que no se parten) queda a la izquierda del tiempo
    const overflow = await page.locator('.prg-rec[data-sport="run"] .prg-rec-row').evaluateAll((els) => els
      .filter((e) => {
        const s = e.querySelector('.prg-rec-main');
        const v = e.querySelector('.prg-rec-value');
        if (!s || !v) return false;
        const r = document.createRange();
        r.selectNodeContents(s);
        const left = v.getBoundingClientRect().left;
        return [...r.getClientRects()].some((b) => b.width > 0 && b.right > left + 0.5);
      })
      .map((e) => e.dataset.rec));
    assert.deepStrictEqual(overflow, [], 'el texto del parcial no se monta sobre el tiempo');
    await page.locator('.prg-rec[data-sport="run"]').scrollIntoViewIfNeeded();
    await shot(page, `records-partials-375-${tag}`);

    // Editar la distancia: el parcial deja de contar sin tocar los datos (vuelve «estimado» a ritmo medio)
    await editDistance(page, rec.id, '12,5', 12.5);
    await openRecords(page);
    r5 = await row(page, '5k');
    assert.deepStrictEqual([r5.how, r5.badge], ['estimated', 'estimado']);
    assert.match(clean(r5.sub), /Actividad importada · de una carrera de 12,5 km$/);
    const stored = (await idbAll(page, 'sessions'))[0];
    assert.deepStrictEqual(stored.bestEfforts, rec.bestEfforts, 'los parciales siguen guardados, solo no cuentan');
    if (large) await shot(page, `records-partials-edited-375-${tag}`);

    // Deshacer la edición: vuelve el parcial
    await editDistance(page, rec.id, '12,4', 12.4);
    await openRecords(page);
    r5 = await row(page, '5k');
    assert.deepStrictEqual([r5.how, r5.value], ['partial', fmt(five)]);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('Récords: el 5 km es el mejor tramo de la carrera importada; editar la distancia lo oculta (Chromium, texto 100 %)', () => flow('chromium', false));
test('Récords con parciales (Chromium, texto 150 %)', () => flow('chromium', true));
test('Récords con parciales (WebKit, texto 150 %)', { skip: skipWebkit }, () => flow('webkit', true));
test('Récords con parciales (WebKit, texto 100 %)', { skip: skipWebkit }, () => flow('webkit', false));
