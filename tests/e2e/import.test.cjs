// E2E de la importación de actividades (#/import): GPX, TCX, FIT dentro de un .zip de Garmin, error por archivo,
// deporte desconocido, revisión en la hoja, duplicados y guardado en IndexedDB.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/import.test.cjs
// La fecha se fija con page.clock: sábado 26 de septiembre de 2026.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { openApp, go, reload, storeAll, idbAll, shot } = require('./helpers.cjs');

const NOW = new Date('2026-09-26T10:00:00Z');
const FIX = path.join(__dirname, '..', 'fixtures', 'import');
const f = (name) => path.join(FIX, name);
const hash = (page) => page.evaluate(() => location.hash);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const sheetPanel = (page) => page.locator('.sheet-overlay.open .sheet-panel').last();
/** Captura cuando han terminado la transición de pantalla y la animación de las hojas. */
async function snap(page, name) {
  await page.waitForFunction(() => !document.querySelector('.sheet-overlay:not(.open)'), null, { timeout: 5000 });
  await page.waitForTimeout(450);
  await shot(page, name);
}

async function setup() {
  const app = await openApp();
  await app.page.clock.setFixedTime(NOW);
  await reload(app.page);
  return app;
}

async function waitItems(page, n) {
  await page.waitForFunction((k) => document.querySelectorAll('.imp-item').length === k
    && !document.querySelector('.imp-pick[disabled]'), n, { timeout: 10000 });
}

const cardTitles = (page) => page.locator('.imp-item .imp-item-title').allInnerTexts();
const checks = (page) => page.locator('.imp-item .imp-check').evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked')));

test('importar: botón en Copias y datos, vista vacía, 3 archivos a la vez, error por archivo, deporte a elegir, revisar y guardar', async () => {
  const app = await setup();
  const { page } = app;
  try {
    // Entrada desde Ajustes › Copias y datos
    await go(page, '#/settings/data');
    const btn = page.locator('.cfg-acts-import');
    assert.match(await btn.innerText(), /Importar actividades \(GPX, TCX, FIT\)/);
    await btn.click();
    await page.waitForSelector('.imp-intro');
    assert.strictEqual(await hash(page), '#/import');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Importar actividades');
    assert.ok(await page.locator('.back-btn').isVisible(), 'pantalla no raíz con botón atrás');
    // Explicación de cómo exportar (abierta con la lista vacía)
    const howto = page.locator('.imp-howto');
    assert.strictEqual(await howto.getAttribute('open'), '');
    const howText = await howto.innerText();
    assert.match(howText, /Strava[\s\S]*⋯ → Exportar GPX[\s\S]*La app de Strava no exporta/);
    assert.match(howText, /Garmin Connect[\s\S]*⚙ → Exportar original/);
    assert.match(howText, /Salud no exporta entrenamientos sueltos[\s\S]*HealthFit o RunGap/);
    // El selector no restringe por tipo (en iPhone dejaría los .fit en gris) y admite varios archivos
    assert.strictEqual(await page.locator('input.imp-file').getAttribute('accept'), null);
    assert.ok(await noHScroll(page));
    await snap(page, 'import-empty');

    // Elegir 3 archivos desde el botón (abre el selector del sistema)
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.imp-pick').click()]);
    assert.ok(fc.isMultiple(), 'selección múltiple');
    await fc.setFiles([f('carrera.gpx'), f('bici.tcx'), f('ruta-garmin.zip')]);
    await waitItems(page, 3);
    assert.deepStrictEqual(await cardTitles(page), ['Carrera', 'Bici', 'Senderismo']);
    assert.deepStrictEqual(await checks(page), ['true', 'true', 'true']);
    const cards = page.locator('.imp-item');
    assert.match(await cards.nth(0).innerText(), /dom 20 sep · 08:00[\s\S]*5 km · 25:\d\d · 5:0\d \/km · \+\d+ m[\s\S]*FC \d+ \/ \d+ · \d+ ppm/);
    assert.match(await cards.nth(1).innerText(), /lun 21 sep · 18:00[\s\S]*20 km · 45:00 · 26,7 km\/h/);
    assert.match(await cards.nth(2).innerText(), /sáb 19 sep · 10:00[\s\S]*11,34 km · 2:4\d:\d\d[\s\S]*\+598 m[\s\S]*ruta-garmin\.zip › 1234567890_ACTIVITY\.fit/);
    assert.strictEqual(await page.locator('.imp-save').innerText(), 'Guardar 3 actividades');
    assert.strictEqual(await page.locator('.imp-howto').getAttribute('open'), null, 'la explicación se pliega con la lista');
    assert.ok(await noHScroll(page));
    await snap(page, 'import-preview-3');

    // Añadir más (mismo input): un archivo sin deporte y otro que no es una actividad
    await page.setInputFiles('input.imp-file', [f('sin-deporte.gpx'), f('notas.txt')]);
    await waitItems(page, 4);
    const err = page.locator('.imp-error');
    assert.strictEqual(await err.count(), 1);
    assert.match(await err.innerText(), /notas\.txt[\s\S]*Formato no reconocido/);
    const unk = cards.nth(3);
    assert.strictEqual(await unk.locator('.imp-item-title').innerText(), 'Deporte sin identificar');
    assert.ok(await unk.locator('.imp-check').isDisabled(), 'no se puede marcar sin deporte');
    assert.strictEqual(await page.locator('.imp-save').innerText(), 'Guardar 3 actividades');
    await unk.locator('.imp-kind-chips .chip', { hasText: 'Otra' }).click();
    assert.strictEqual(await cards.nth(3).locator('.imp-item-title').innerText(), 'Otra actividad');
    assert.strictEqual(await cards.nth(3).locator('.imp-check').getAttribute('aria-checked'), 'true');
    assert.strictEqual(await page.locator('.imp-save').innerText(), 'Guardar 4 actividades');
    // …y se desmarca a mano
    await cards.nth(3).locator('.imp-check').click();
    assert.strictEqual(await page.locator('.imp-save').innerText(), 'Guardar 3 actividades');

    // Revisar la carrera: esfuerzo percibido y distancia corregida
    await cards.nth(0).locator('.imp-item-main').click();
    const sh = sheetPanel(page);
    await sh.waitFor();
    assert.strictEqual(await sh.locator('.sheet-title').innerText(), 'Revisar actividad');
    assert.strictEqual(await sh.locator('.imp-kinds .seg-btn.active').innerText(), 'Carrera');
    assert.strictEqual(await sh.locator('.imp-date').inputValue(), '2026-09-20');
    assert.strictEqual(await sh.locator('.imp-time').inputValue(), '08:00');
    await sh.locator('.rpe-chips .chip').nth(5).click();
    await sh.locator('[aria-label="Distancia (km)"]').fill('5,1');
    await page.waitForTimeout(400);
    await shot(page, 'import-edit-sheet');
    await sh.locator('.sheet-actions button', { hasText: 'Listo' }).click();
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay.open'));
    assert.match(await cards.nth(0).innerText(), /5,1 km[\s\S]*esfuerzo 6/);

    // Guardar
    await page.locator('.imp-save').click();
    await page.waitForSelector('.imp-done');
    assert.match(await page.locator('.imp-done').innerText(), /3 actividades importadas[\s\S]*1 no se ha importado/);
    assert.match(await page.locator('.toast').innerText(), /3 actividades importadas[\s\S]*Ver historial/);
    const saved = (await idbAll(page, 'sessions')).sort((a, b) => a.startedAt - b.startedAt);
    assert.deepStrictEqual(saved.map((s) => s.kind), ['hike', 'run', 'bike']);
    for (const s of saved) {
      assert.strictEqual(s.status, 'done');
      assert.strictEqual(s.planDate, s.date);
      assert.strictEqual(s.durationMin, s.movingSec / 60);
      assert.ok(/^a_/.test(s.id));
      assert.ok(!('points' in s));
    }
    const [hike, run, bike] = saved;
    assert.deepStrictEqual(run.source, { type: 'gpx', fileName: 'carrera.gpx' });
    assert.strictEqual(run.startedAt, Date.UTC(2026, 8, 20, 6, 0, 0));
    assert.strictEqual(run.date, '2026-09-20');
    assert.strictEqual(run.rpe, 6);
    assert.strictEqual(run.distanceKm, 5.1);
    assert.strictEqual(run.templateName, 'Carrera');
    assert.deepStrictEqual(bike.source, { type: 'tcx', fileName: 'bici.tcx' });
    assert.strictEqual(bike.movingSec, 2700);
    assert.ok(bike.powerAvg > 190 && bike.powerAvg < 220);
    assert.deepStrictEqual(hike.source, { type: 'fit', fileName: '1234567890_ACTIVITY.fit' });
    assert.deepStrictEqual([hike.templateName, hike.elevationM, hike.elevationLossM, hike.altMaxM, hike.hrAvg, hike.hrMax], ['Senderismo', 598, 601, 1502, 121, 152]);
    assert.strictEqual(hike.date, '2026-09-19');
    await snap(page, 'import-saved');

    // Opción de ir al historial
    await page.locator('.imp-history').click();
    await page.waitForFunction(() => location.hash === '#/history');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('duplicados: la carrera ya registrada sale «Ya registrada» y desmarcada; se guarda solo lo nuevo; deshacer', async () => {
  const app = await setup();
  const { page } = app;
  try {
    // Carrera registrada a mano con el reloj (inicio 08:01) el mismo día
    await page.evaluate(async () => {
      await window.__app.store.save('sessions', {
        id: 'a_manual', kind: 'run', date: '2026-09-20', planDate: '2026-09-20', templateId: null, templateName: 'Carrera',
        status: 'done', startedAt: Date.UTC(2026, 8, 20, 6, 1, 0), endedAt: null, movingSec: 1500, durationMin: 25, rpe: 5,
        notes: '', parentId: null, parentItemId: null, templateItemId: null, distanceKm: 5,
      });
    });
    await go(page, '#/import');
    await page.waitForSelector('.imp-intro');
    await page.setInputFiles('input.imp-file', [f('carrera.gpx'), f('carrera.gpx.gz'), f('bici.tcx')]);
    await waitItems(page, 3);
    const cards = page.locator('.imp-item');
    assert.deepStrictEqual(await checks(page), ['false', 'false', 'true']);
    assert.strictEqual(await cards.nth(0).locator('.imp-badge').innerText(), 'Ya registrada');
    assert.match(await cards.nth(0).locator('.imp-note-warn').innerText(), /Coincide con «Carrera» del dom 20 sep a las 08:01/);
    assert.strictEqual(await cards.nth(1).locator('.imp-badge').innerText(), 'Ya registrada');
    assert.strictEqual(await cards.nth(2).locator('.imp-badge').count(), 0);
    assert.match(await page.locator('.imp-head-text').innerText(), /3 actividades · 1 para guardar · 2 ya registradas/);
    assert.strictEqual(await page.locator('.imp-save').innerText(), 'Guardar 1 actividad');
    assert.ok(await noHScroll(page));
    await snap(page, 'import-duplicate');

    // Se puede marcar igualmente (y volver a desmarcar)
    await cards.nth(0).locator('.imp-check').click();
    assert.strictEqual(await page.locator('.imp-save').innerText(), 'Guardar 2 actividades');
    await cards.nth(0).locator('.imp-check').click();

    await page.locator('.imp-save').click();
    await page.waitForSelector('.imp-done');
    let sessions = await idbAll(page, 'sessions');
    assert.deepStrictEqual(sessions.map((s) => s.id === 'a_manual' ? 'manual' : s.kind).sort(), ['bike', 'manual']);

    // Deshacer la importación (con confirmación)
    await page.locator('.imp-undo').click();
    await sheetPanel(page).locator('button', { hasText: 'Quitar' }).click();
    await page.waitForFunction(() => !document.querySelector('.imp-done'));
    sessions = await idbAll(page, 'sessions');
    assert.deepStrictEqual(sessions.map((s) => s.id), ['a_manual']);
    assert.strictEqual((await storeAll(page, 'sessions')).length, 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
