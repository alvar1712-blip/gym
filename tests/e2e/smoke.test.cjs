const test = require('node:test');
const assert = require('node:assert');
const { openApp, go } = require('./helpers.cjs');

test('la app arranca, muestra la barra de pestañas y todas las rutas montan sin errores', async () => {
  const app = await openApp();
  try {
    const tabs = await app.page.locator('#tabbar .tab').count();
    assert.strictEqual(tabs, 5);
    for (const r of ['/today', '/calendar', '/progress', '/exercises', '/templates', '/settings', '/history', '/bodyweight', '/weekly', '/goals', '/records']) {
      await go(app.page, r);
      const txt = await app.page.locator('#view').innerText();
      assert.ok(!txt.includes('Algo ha fallado'), `La ruta ${r} falló: ${txt.slice(0, 300)}`);
    }
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
