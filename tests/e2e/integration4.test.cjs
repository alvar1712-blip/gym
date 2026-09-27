// E2E de la integración de la ronda 4 (docs/MEJORAS.md): accesos a #/import (Hoy, formulario de actividad nueva,
// Copias y datos), a #/summary y #/predictions (Progreso y Récords › Resistencia).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/integration4.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go } = require('./helpers.cjs');

/** Espera a que la ruta sea `hash` y la vista nueva tenga su cabecera. */
async function waitRoute(page, hash) {
  await page.waitForFunction((h) => location.hash.startsWith(h) && !!document.querySelector('#view .topbar'), hash, { timeout: 5000 });
  await page.waitForTimeout(150);
}

test('accesos de la ronda 4: importar, resúmenes y tiempos previstos', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    // Hoy → Importar
    const todayLink = page.locator('.today-import');
    await todayLink.scrollIntoViewIfNeeded();
    assert.strictEqual((await todayLink.innerText()).trim(), 'Importar desde un archivo');
    await todayLink.click();
    await waitRoute(page, '#/import');

    // Actividad nueva y suelta → Importar; una actividad enlazada o ya guardada no lo muestra
    await go(page, '#/activity/new?kind=hike');
    await waitRoute(page, '#/activity/new');
    await page.locator('.act-import-link').click();
    await waitRoute(page, '#/import');

    // Copias y datos → Importar
    await go(page, '#/settings/data');
    await waitRoute(page, '#/settings/data');
    const setBtn = page.getByRole('button', { name: /Importar actividades/ });
    await setBtn.scrollIntoViewIfNeeded();
    await setBtn.click();
    await waitRoute(page, '#/import');

    // Progreso → Resúmenes y Predicciones
    await go(page, '#/progress');
    await waitRoute(page, '#/progress');
    await page.locator('.prg-link[data-link="summary"]').click();
    await waitRoute(page, '#/summary');
    await go(page, '#/progress');
    await waitRoute(page, '#/progress');
    await page.locator('.prg-link[data-link="predictions"]').click();
    await waitRoute(page, '#/predictions');
    // Ninguna etiqueta de acceso cortada con «…»
    await go(page, '#/progress');
    await waitRoute(page, '#/progress');
    const clipped = await page.locator('.prg-link-label').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    assert.deepStrictEqual(clipped, []);

    // Récords › Resistencia → Tiempos previstos
    await go(page, '#/records');
    await waitRoute(page, '#/records');
    await page.getByRole('radio', { name: /Resistencia/ }).or(page.getByRole('button', { name: /Resistencia/ })).first().click();
    const recLink = page.locator('.prg-link-row[data-link="predictions"]');
    await recLink.scrollIntoViewIfNeeded();
    await recLink.click();
    await waitRoute(page, '#/predictions');

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
