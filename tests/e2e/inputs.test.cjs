// E2E de los campos numéricos (ui.selectOnFocus): al enfocar uno se selecciona su texto (lo escrito sustituye al valor,
// p. ej. cambiar los segundos «45» por «0») y NUNCA se roba el foco a otro campo. Regresión: el select() diferido de
// un campo ya abandonado le devolvía el foco; con dos campos enfocados casi a la vez, el foco saltaba entre ellos sin
// parar y lo escrito acababa en el campo anterior (causa de la prueba intermitente de tiempos previstos).
// En Chromium y, si está instalado, en WebKit. Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/inputs.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, engineAvailable } = require('./helpers.cjs');

/**
 * Enfoca `first` y enseguida `second` (antes de que corra ninguna tarea pendiente, como al pasar de campo muy rápido)
 * y deja correr las tareas diferidas `ticks` veces. Devuelve dónde acaba el foco y cuántas veces más se movió.
 */
function focusRace(page, firstSel, secondSel, ticks = 6) {
  return page.evaluate(async ({ firstSel, secondSel, ticks }) => {
    const a = document.querySelector(firstSel); const b = document.querySelector(secondSel);
    let moves = 0;
    const onFocus = () => { moves++; };
    a.focus();
    b.focus();
    document.addEventListener('focusin', onFocus, true);
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
    document.removeEventListener('focusin', onFocus, true);
    const active = document.activeElement;
    return { active: active === b ? 'second' : active === a ? 'first' : (active && active.getAttribute('aria-label')), moves };
  }, { firstSel, secondSel, ticks });
}

/**
 * Vuelve a un campo ya escrito (como al editar más tarde: se sale de él y se toca de nuevo) y espera, por condición y no
 * por tiempo, a que su texto quede seleccionado entero.
 */
async function tapAndWaitSelected(page, sel) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.locator(sel).first().click();
  await page.waitForFunction((s) => {
    const el = document.querySelector(s);
    return !!el && document.activeElement === el && el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length;
  }, sel, { timeout: 3000 });
}

for (const browser of ['chromium', 'webkit']) {
  const skip = browser === 'webkit' && !engineAvailable('webkit') ? 'WebKit no instalado (scripts/setup-webkit.sh)' : false;

  test(`${browser}: campos de duración y número no se roban el foco y lo escrito sustituye al valor`, { skip }, async () => {
    const app = await openApp({ browser });
    const { page } = app;
    try {
      await go(page, '#/activity/new?kind=run');
      await page.waitForSelector('.dur-input');
      const H = '.dur-input[aria-label="Tiempo en movimiento: h"]';
      const M = '.dur-input[aria-label="Tiempo en movimiento: min"]';
      const S = '.dur-input[aria-label="Tiempo en movimiento: s"]';
      const KM = 'input[aria-label="Distancia (km)"]';

      // Dos campos enfocados casi a la vez: el foco se queda en el segundo y no salta más.
      assert.deepStrictEqual(await focusRace(page, H, M), { active: 'second', moves: 0 });
      assert.deepStrictEqual(await focusRace(page, M, S), { active: 'second', moves: 0 });
      assert.deepStrictEqual(await focusRace(page, S, KM), { active: 'second', moves: 0 });

      // Escribir un tiempo y después cambiar solo los segundos: «45» → «0» (lo escrito sustituye, nada se pierde).
      await page.locator(H).click();
      await page.keyboard.type('0');
      await page.locator(M).click();
      await page.keyboard.type('22');
      await page.locator(S).click();
      await page.keyboard.type('45');
      assert.deepStrictEqual(await page.$$eval('.dur-input', (els) => els.slice(0, 3).map((e) => e.value)), ['0', '22', '45']);
      await tapAndWaitSelected(page, S);
      await page.keyboard.type('0');
      await tapAndWaitSelected(page, M);
      await page.keyboard.type('21');
      assert.deepStrictEqual(await page.$$eval('.dur-input', (els) => els.slice(0, 3).map((e) => e.value)), ['0', '21', '0']);

      // Número con decimales: «10,5» → «8»
      await page.locator(KM).click();
      await page.keyboard.type('10,5');
      await tapAndWaitSelected(page, KM);
      await page.keyboard.type('8');
      assert.strictEqual(await page.locator(KM).inputValue(), '8');
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });

  test(`${browser}: el stepper del peso selecciona su valor al tocarlo sin robar el foco`, { skip }, async () => {
    const app = await openApp({ browser });
    const { page } = app;
    try {
      const W = '.today .stepper input';
      await page.waitForSelector(W);
      await page.locator(W).first().click();
      await page.keyboard.type('74,2');
      await tapAndWaitSelected(page, W);
      await page.keyboard.type('73,8');
      assert.strictEqual(await page.locator(W).first().inputValue(), '73,8');
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}
