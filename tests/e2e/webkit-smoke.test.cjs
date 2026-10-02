// E2E en WebKit (el motor de Safari): la app abre, navega por las pestañas y no da errores.
// Los flujos completos en WebKit se añaden en la fase H (docs/MEJORAS6.md). Si WebKit no está instalado en esta
// máquina, la prueba se omite diciéndolo (instalación: scripts/setup-webkit.sh).
const test = require('node:test');
const assert = require('node:assert');
const { openApp, engineAvailable } = require('./helpers.cjs');

const skip = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

test('WebKit: abre Hoy y recorre las cinco pestañas sin errores', { skip }, async () => {
  const app = await openApp({ browser: 'webkit' });
  const { page } = app;
  try {
    assert.ok(await page.locator('.today-plan').count(), 'Hoy muestra «Te toca hoy»');
    for (const tab of ['calendar', 'progress', 'exercises', 'settings', 'today']) {
      await page.locator(`#tabbar [data-tab="${tab}"]`).click();
      await page.waitForFunction((t) => document.querySelector(`#tabbar [data-tab="${t}"]`)?.classList.contains('active')
        && !!document.querySelector('#view .topbar'), tab);
    }
    assert.ok(await page.evaluate(() => location.hash === '#/today'));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
