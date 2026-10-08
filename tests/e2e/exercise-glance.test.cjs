// Ronda 8 (A5): ficha de ejercicio (#/exercise/:id) con «de un vistazo» arriba (última vez, mejor serie, 1RM
// estimado, tendencia), historial y metadatos debajo; y su gráfica de progreso (#/progress/exercise/:id) con el 1RM
// estimado primero, cambios con redondeo humano («−1,7 kg», nunca «−1,67 kg») y ejes con un rango mínimo relativo
// al valor. Datos realistas (tests/e2e/realistic-data.cjs), fecha fijada. Chromium y WebKit (si está instalado).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/exercise-glance.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, shot, engineAvailable } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

/** Números de los rótulos del eje Y de una gráfica («42,5» → 42.5). */
const yTicks = (page, sel) => page.locator(`${sel} .chart-ylabel`).evaluateAll((els) => els.map((e) => Number(e.textContent.replace(/\./g, '').replace(',', '.'))));

for (const browser of ['chromium', 'webkit']) {
  test(`ficha y progreso de un ejercicio: lo importante arriba, 1RM primero, redondeo humano, ejes informativos (${browser})`, { skip: browser === 'webkit' && skipWebkit }, async () => {
    const app = await openApp({ browser, beforeLoad: (page) => page.context().clock.install({ time: madrid(TODAY) }) });
    const { page } = app;
    try {
      await seedRealistic(page, { months: 6, female: false });
      // El periodo de las gráficas del ejercicio, el de por defecto (3 meses): el mismo que la tendencia de la ficha
      await page.evaluate(() => localStorage.removeItem('entreno.period.exercise'));

      // --- Ficha ---
      await go(page, '#/exercise/press_banca');
      const glance = page.locator('.lib-glance');
      await glance.waitFor();
      // Orden: de un vistazo → Ver progreso → historial → músculos → datos
      const tops = await page.evaluate(() => ['.lib-glance', '.lib-link', '.lib-hist', '.lib-muscles', '.lib-data']
        .map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? null));
      assert.ok(tops.every((t) => t != null), `todas las piezas: ${tops}`);
      for (let i = 1; i < tops.length; i++) assert.ok(tops[i] > tops[i - 1], `orden de la ficha: ${tops}`);
      // Última vez = la última sesión terminada, con sus series (mismo texto que la primera fila del historial)
      const lastSets = await glance.locator('.lib-glance-sets').innerText();
      const histSets = await page.locator('.lib-hist-row').first().locator('.lib-hist-sets').innerText();
      assert.strictEqual(lastSets, histSets);
      assert.match(await glance.locator('.lib-glance-last .lib-k').innerText(), /^Última vez · \d{1,2} [a-z]{3} · (hoy|ayer|hace \d+ días)$/);
      // Mejor serie y 1RM estimado, los mismos que en Progreso
      const best = await glance.locator('[data-kpi="best"] .kpi-value').innerText();
      assert.match(best, /^\d+(,\d+)? kg × \d+( @\d)?$/);
      const e1rm = await glance.locator('[data-kpi="e1rm"] .kpi-value').innerText();
      assert.match(e1rm, /^\d+(,\d)? kg$/);
      const trend = await glance.locator('.lib-glance-trend-v').innerText();
      assert.match(await glance.locator('.lib-glance-trend .lib-k').innerText(), /Tendencia · 1RM estimado · 3 meses/);
      assert.match(trend, /^(Estable: ±\d+(,\d)? kg en el periodo|[+−]\d+(,\d)? kg desde .+)$/, `tendencia con un decimal como mucho: ${trend}`);
      assert.strictEqual(await glance.locator('.lib-glance-trend').evaluate((e) => getComputedStyle(e.querySelector('.lib-glance-trend-v')).color === getComputedStyle(document.body).color), true, 'la tendencia no lleva color de juicio');
      await shot(page, `exercise-glance-${browser}`);

      // --- Progreso del ejercicio ---
      await go(page, '#/progress/exercise/press_banca');
      await page.locator('[data-chart] svg').first().waitFor();
      const order = await page.locator('[data-chart]').evaluateAll((els) => els.map((e) => e.dataset.chart));
      assert.strictEqual(order[0], 'e1rm', `el 1RM estimado, la primera gráfica: ${order}`);
      // Datos clave: el 1RM estimado primero; los mismos cuatro de antes (regresión: no aparece una casilla de más)
      assert.deepStrictEqual(await page.locator('.prg-kpis .kpi').evaluateAll((els) => els.map((e) => e.dataset.kpi)), ['e1rm', 'weight', 'sessions', 'last']);
      // La frase de la gráfica del 1RM = la tendencia de la ficha
      assert.strictEqual(await page.locator('[data-chart="e1rm"] .chart-summary').innerText(), trend);
      // Redondeo humano en todas las frases (regresión: «−1,67 kg desde julio» en Peso máximo)
      for (const t of await page.locator('.chart-summary:not([hidden])').allInnerTexts()) {
        assert.ok(!/\d,\d\d\b/.test(t), `como mucho un decimal: «${t}»`);
      }
      // Ejes informativos: con valores de ~40–60 kg, el eje cubre al menos un 20 % del valor (regresión: 40–45)
      for (const id of ['e1rm', 'maxWeight']) {
        const ticks = await yTicks(page, `[data-chart="${id}"]`);
        assert.ok(ticks.length >= 3, `${id}: marcas ${ticks}`);
        const span = ticks[ticks.length - 1] - ticks[0];
        assert.ok(span >= 0.2 * ticks[ticks.length - 1] - 1e-9, `${id}: eje ${ticks.join(' | ')} demasiado estrecho`);
      }
      await shot(page, `progress-exercise-glance-${browser}`);
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}

test('ficha sin historial: sin «de un vistazo» ni huecos', async () => {
  const app = await openApp({ beforeLoad: (page) => page.context().clock.install({ time: madrid(TODAY) }) });
  const { page } = app;
  try {
    await go(page, '#/exercise/press_banca');
    await page.locator('.lib-hist-empty').waitFor();
    assert.strictEqual(await page.locator('.lib-glance').count(), 0);
    assert.ok((await page.locator('#view').innerText()).includes('Todavía no hay sesiones con este ejercicio.'));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
