// Entrada numérica exacta del editor de series: lo que se ve en el campo es lo que se guarda y se registra.
// Antes: «8,5» en repeticiones mostraba «9» pero guardaba 8,5; «82,555» mostraba «82,56» y guardaba 82,555.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/entry-precision.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go } = require('./helpers.cjs');

test('el valor tecleado se ajusta a la precisión del campo y lo guardado coincide con lo mostrado', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const id = await page.evaluate(async () => (await (await import('./js/session-logic.js')).createStrengthSession({ templateId: 'tpl_d1' })).id);
    await go(page, `#/session/${id}`);
    await page.waitForSelector('.ses-editor');
    const set = () => page.evaluate((sid) => JSON.parse(JSON.stringify(window.__app.store.get('sessions', sid).exercises[0].sets[0])), id);
    const card = page.locator('.ses-card').first();
    const reps = card.locator('.ses-editor [data-field="reps"]');
    const weight = card.locator('.ses-editor [data-field="weight"]');

    await reps.fill('8,5');
    await reps.blur();
    await page.waitForFunction((sid) => Number.isInteger(window.__app.store.get('sessions', sid).exercises[0].sets[0].reps), id);
    assert.strictEqual(await reps.inputValue(), '9');
    assert.strictEqual((await set()).reps, 9, 'repeticiones: se guarda lo que se ve');

    await weight.fill('82,555');
    await weight.blur();
    assert.strictEqual(await weight.inputValue(), '82,56');
    assert.strictEqual((await set()).weight, 82.56, 'peso: se guarda lo que se ve');

    // lo que sí cabe se conserva tal cual (precisión decimal intacta)
    await weight.fill('41,25');
    await weight.blur();
    assert.strictEqual((await set()).weight, 41.25);
    await weight.fill('82.5');
    await weight.blur();
    assert.strictEqual((await set()).weight, 82.5);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('«Siguiente» del teclado: Intro en el peso pasa a las repeticiones sin cerrar el teclado; en las repeticiones lo cierra', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const id = await page.evaluate(async () => (await (await import('./js/session-logic.js')).createStrengthSession({ templateId: 'tpl_d1' })).id);
    await go(page, `#/session/${id}`);
    await page.waitForSelector('.ses-editor');
    const card = page.locator('.ses-card').first();
    const weight = card.locator('.ses-editor [data-field="weight"]');
    const reps = card.locator('.ses-editor [data-field="reps"]');
    assert.strictEqual(await weight.getAttribute('enterkeyhint'), 'next');
    assert.strictEqual(await reps.getAttribute('enterkeyhint'), 'done');
    await weight.fill('67,5');
    await weight.press('Enter');
    assert.strictEqual(await page.evaluate(() => document.activeElement?.dataset?.field), 'reps', 'el foco pasa a las repeticiones');
    await reps.fill('7');
    await reps.press('Enter');
    assert.strictEqual(await page.evaluate(() => document.activeElement?.tagName), 'BODY', 'en el último campo se cierra el teclado');
    const s = await page.evaluate((sid) => window.__app.store.get('sessions', sid).exercises[0].sets[0], id);
    assert.deepStrictEqual([s.weight, s.reps, s.done], [67.5, 7, false], 'valores guardados y la serie sigue sin registrar');
  } finally {
    await app.close();
  }
});
