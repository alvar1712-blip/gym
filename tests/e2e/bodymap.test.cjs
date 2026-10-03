// E2E del mapa corporal (js/bodymap.js) sobre el banco de pruebas tests/fixtures/bodymap.html.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/bodymap.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { waitReady } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');
const MAIN = '#card-main';

async function openBench({ width = 390, height = 844 } = {}) {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await mod.startServer(0);
  const browser = await chromium.launch();
  const dev = devices['iPhone 13'];
  const context = await browser.newContext({ ...dev, viewport: { width, height }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${server.url}tests/fixtures/bodymap.html`);
  await waitReady(page);
  return { browser, page, errors, close: async () => { await browser.close(); await server.close(); } };
}

const zone = (page, id) => page.locator(`${MAIN} .bm-zone[data-muscle="${id}"]`);
const detailText = (page) => page.locator(`${MAIN} .bm-detail-main`).textContent();
const selections = (page) => page.evaluate(() => [...window.__bm.selections]);

test('16 zonas con los ids de seed.MUSCLES, accesibles y coloreadas por estado, con leyenda', async () => {
  const app = await openBench();
  try {
    const { page } = app;
    const info = await page.evaluate((sel) => {
      const root = document.querySelector(`${sel} .bm`);
      const zones = [...root.querySelectorAll('.bm-zone')];
      return {
        muscles: window.__bm.lib.MUSCLES.map((m) => m.id),
        data: window.__bm.data,
        zones: zones.map((g) => ({
          id: g.dataset.muscle,
          status: g.dataset.status,
          role: g.getAttribute('role'),
          tabindex: g.getAttribute('tabindex'),
          pressed: g.getAttribute('aria-pressed'),
          label: g.getAttribute('aria-label'),
          paths: g.querySelectorAll('path').length,
          fill: getComputedStyle(g.querySelector('path')).fill,
        })),
        legend: [...root.querySelectorAll('.bm-legend-item')].map((li) => ({
          status: li.dataset.status, label: li.querySelector('.bm-legend-label').textContent, n: Number(li.querySelector('.bm-legend-n').textContent),
        })),
        hint: root.querySelector('.bm-detail').textContent,
      };
    }, MAIN);

    assert.strictEqual(info.zones.length, 16);
    assert.deepStrictEqual(info.zones.map((z) => z.id).sort(), [...info.muscles].sort());
    for (const z of info.zones) {
      assert.strictEqual(z.role, 'button', z.id);
      assert.strictEqual(z.tabindex, '0', z.id);
      assert.strictEqual(z.pressed, 'false', z.id);
      assert.ok(z.paths >= 2, `${z.id}: una forma por lado`);
      assert.strictEqual(z.status, info.data[z.id].status, z.id);
    }
    const byId = Object.fromEntries(info.zones.map((z) => [z.id, z]));
    assert.strictEqual(byId.chest.label, 'Pecho: 24 series, objetivo 12–22, por encima');
    assert.strictEqual(byId.core.label, 'Core / abdomen: 8 series, objetivo 12–22, por debajo');
    assert.strictEqual(byId.triceps.label, 'Tríceps: 7,5 series, objetivo 10–20, por debajo');
    assert.strictEqual(byId.calves.label, 'Gemelos: 0 series, objetivo 10–20, sin series');
    // Zonas compartidas: se ven delante y detrás (4 formas); las de una sola vista, 2 o más.
    for (const id of ['sidedelt', 'forearms', 'calves', 'adductors']) {
      const views = await zone(page, id).locator('path').evaluateAll((ps) => [...new Set(ps.map((p) => p.dataset.view))].sort());
      assert.deepStrictEqual(views, ['back', 'front'], id);
    }

    // Colores = tokens del tema (por debajo --warn, en rango --ok, por encima --info, sin series gris).
    const COLOR = { below: 'rgb(251, 191, 36)', in: 'rgb(74, 222, 128)', above: 'rgb(96, 165, 250)', none: 'rgb(59, 66, 78)' };
    const seen = new Set();
    for (const z of info.zones) {
      assert.strictEqual(z.fill, COLOR[z.status], `${z.id} (${z.status})`);
      seen.add(z.status);
    }
    assert.deepStrictEqual([...seen].sort(), ['above', 'below', 'in', 'none'], 'el ejemplo tiene los cuatro estados');

    // Leyenda con los cuatro estados y cuántos músculos hay en cada uno.
    assert.deepStrictEqual(info.legend.map((l) => l.label), ['Por debajo', 'En rango', 'Por encima', 'Sin series']);
    const count = (st) => info.zones.filter((z) => z.status === st).length;
    for (const l of info.legend) assert.strictEqual(l.n, count(l.status), l.status);
    assert.strictEqual(info.legend.reduce((a, l) => a + l.n, 0), 16);
    assert.match(info.hint, /Toca un músculo/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('tocar una zona la resalta, escribe el detalle y llama a onSelect', async () => {
  const app = await openBench();
  try {
    const { page } = app;
    await zone(page, 'chest').locator('path').first().tap();
    assert.strictEqual(await detailText(page), 'Pecho · 24 series · objetivo 12–22 · por encima');
    assert.strictEqual(await page.locator(`${MAIN} .bm-detail-sub`).textContent(), '2 series por encima del máximo');
    assert.deepStrictEqual(await selections(page), ['chest']);
    assert.strictEqual(await zone(page, 'chest').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await page.locator(`${MAIN} .bm`).getAttribute('data-selected'), 'chest');
    // Resaltado: contorno claro sobre sus dos formas; el resto, atenuado.
    assert.strictEqual(await page.locator(`${MAIN} .bm-hl path`).count(), await zone(page, 'chest').locator('path').count());
    // La atenuación tiene una transición de 160 ms: se espera a la condición (leerla una vez justo tras el toque
    // podía dar 1 con la máquina cargada).
    await page.waitForFunction((sel) => Number(getComputedStyle(document.querySelector(sel)).opacity) < 1, `${MAIN} .bm-zone[data-muscle="back"]`, { timeout: 5000 });
    const op = await zone(page, 'back').evaluate((g) => getComputedStyle(g).opacity);
    assert.ok(Number(op) < 1, `las demás zonas se atenúan (${op})`);
    assert.strictEqual(await zone(page, 'chest').evaluate((g) => getComputedStyle(g).opacity), '1');

    // Otra zona (vista posterior): cambia la elegida, el detalle y onSelect.
    await zone(page, 'hamstrings').locator('path[data-view="back"]').first().tap();
    assert.strictEqual(await detailText(page), 'Isquiotibiales · 9 series · objetivo 10–20 · por debajo');
    assert.strictEqual(await page.locator(`${MAIN} .bm-detail-sub`).textContent(), 'Falta 1 serie para el mínimo');
    assert.strictEqual(await zone(page, 'chest').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await page.locator(`${MAIN} .bm-detail`).getAttribute('data-status'), 'below');
    // Zona compartida: se resaltan sus formas de delante y de detrás.
    await zone(page, 'sidedelt').locator('path').first().tap();
    assert.strictEqual(await page.locator(`${MAIN} .bm-hl path`).count(), 4);
    assert.strictEqual(await detailText(page), 'Hombro lateral · 12 series · objetivo 10–20 · en rango');
    // Sin series: el estado va en texto, no solo en gris.
    await zone(page, 'tibialis').locator('path').first().tap();
    assert.strictEqual(await detailText(page), 'Tibial anterior · 0 series · objetivo 0–10 · sin series');
    assert.deepStrictEqual(await selections(page), ['chest', 'hamstrings', 'sidedelt', 'tibialis']);
    assert.match(await page.locator('#log').textContent(), /tibialis$/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('zonas pequeñas: tocar muy cerca (en la mano) elige el antebrazo; tocar lejos no cambia nada', async () => {
  const app = await openBench();
  try {
    const { page } = app;
    const fore = await zone(page, 'forearms').locator('path[data-view="front"]').first().boundingBox();
    // Justo debajo del antebrazo, sobre la mano (fuera de la forma).
    await page.touchscreen.tap(fore.x + fore.width * 0.7, fore.y + fore.height + 5);
    assert.deepStrictEqual(await selections(page), ['forearms']);
    assert.match(await detailText(page), /^Antebrazo · 4 series · objetivo 0–10 · en rango$/);
    // Encima de la cabeza (lejos de cualquier zona): no cambia.
    const svg = await page.locator(`${MAIN} .bm-svg`).boundingBox();
    await page.touchscreen.tap(svg.x + svg.width * 0.25, svg.y + 4);
    assert.deepStrictEqual(await selections(page), ['forearms']);
  } finally {
    await app.close();
  }
});

test('teclado: Tab recorre las zonas y Enter / Espacio eligen', async () => {
  const app = await openBench();
  try {
    const { page } = app;
    await zone(page, 'frontdelt').focus();
    await page.keyboard.press('Enter');
    assert.deepStrictEqual(await selections(page), ['frontdelt']);
    assert.strictEqual(await detailText(page), 'Hombro anterior · 0 series · objetivo 0–12 · sin series');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.muscle);
    assert.strictEqual(focused, 'sidedelt');
    await page.keyboard.press(' ');
    assert.deepStrictEqual(await selections(page), ['frontdelt', 'sidedelt']);
    const focusStroke = await zone(page, 'sidedelt').locator('path').first().evaluate((p) => getComputedStyle(p).stroke);
    assert.strictEqual(focusStroke, 'rgb(243, 245, 247)', 'foco visible (contorno claro)');
  } finally {
    await app.close();
  }
});

test('selected al montar (sin onSelect) y update() recolorea sin volver a montar', async () => {
  const app = await openBench();
  try {
    const { page } = app;
    assert.strictEqual(await page.locator('#card-pre .bm').getAttribute('data-selected'), 'hamstrings');
    assert.strictEqual(await page.locator('#card-pre .bm-detail-main').textContent(), 'Isquiotibiales · 25 series · objetivo 10–20 · por encima');
    // Semana vacía: todo sin series.
    const emptyStatuses = await page.locator('#card-empty .bm-zone').evaluateAll((gs) => [...new Set(gs.map((g) => g.dataset.status))]);
    assert.deepStrictEqual(emptyStatuses, ['none']);
    assert.strictEqual(await page.locator('#card-empty .bm-legend-item[data-status="none"] .bm-legend-n').textContent(), '16');

    await zone(page, 'chest').locator('path').first().tap();
    const res = await page.evaluate(() => {
      const { main, lib, settings, weekSets } = window.__bm;
      const g = main.querySelector('.bm-zone[data-muscle="chest"]');
      main.update(lib.bodyMapData({ ...weekSets, chest: 14 }, settings));
      return {
        same: main.querySelector('.bm-zone[data-muscle="chest"]') === g,
        status: g.dataset.status,
        label: g.getAttribute('aria-label'),
        detail: main.querySelector('.bm-detail-main').textContent,
        above: main.querySelector('.bm-legend-item[data-status="above"] .bm-legend-n').textContent,
      };
    });
    assert.deepStrictEqual(res, {
      same: true, status: 'in', label: 'Pecho: 14 series, objetivo 12–22, en rango',
      detail: 'Pecho · 14 series · objetivo 12–22 · en rango', above: '1',
    });
    // select(null) quita la selección sin llamar a onSelect.
    await page.evaluate(() => window.__bm.main.select(null));
    assert.strictEqual(await page.locator(`${MAIN} .bm`).getAttribute('data-selected'), '');
    assert.strictEqual(await page.locator(`${MAIN} .bm-hl path`).count(), 0);
    assert.deepStrictEqual(await selections(page), ['chest']);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('modo elegir (check-in, ronda 6): sin leyenda ni series, marcas por intensidad, describe() y update() de marcas', async () => {
  const app = await openBench();
  try {
    const { page } = app;
    const res = await page.evaluate(() => {
      const { lib } = window.__bm;
      const picked = [];
      const m = lib.bodyMap({
        legend: false, compact: true, marks: { hamstrings: 'high', quads: 'low', calves: 'none' },
        describe: (id) => `Zona ${id}`, emptyHint: 'Toca el músculo con agujetas.', onSelect: (id) => picked.push(id),
      });
      m.id = 'pick-map';
      document.getElementById('bench').appendChild(m);
      const z = (id) => m.querySelector(`.bm-zone[data-muscle="${id}"]`);
      const before = {
        cls: m.classList.contains('bm-pick'), legend: m.querySelectorAll('.bm-legend').length,
        hint: m.querySelector('.bm-detail').textContent,
        statuses: [...new Set([...m.querySelectorAll('.bm-zone')].map((g) => g.dataset.status))],
        marks: ['hamstrings', 'quads', 'calves', 'chest'].map((id) => z(id).dataset.mark),
        label: z('hamstrings').getAttribute('aria-label'),
        fills: ['hamstrings', 'chest'].map((id) => getComputedStyle(z(id).querySelector('path')).fill),
      };
      z('quads').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const afterTap = { picked: [...picked], selected: m.dataset.selected, detail: m.querySelector('.bm-detail').textContent, pressed: z('quads').getAttribute('aria-pressed') };
      const g = z('chest');
      m.update(null, { chest: 'mid' });
      return { before, afterTap, update: { same: z('chest') === g, chest: z('chest').dataset.mark, ham: z('hamstrings').dataset.mark, selected: m.dataset.selected } };
    });
    assert.deepStrictEqual(res.before.cls, true);
    assert.strictEqual(res.before.legend, 0, 'sin leyenda de series');
    assert.strictEqual(res.before.hint, 'Toca el músculo con agujetas.');
    assert.deepStrictEqual(res.before.statuses, ['none'], 'no colorea por series');
    assert.deepStrictEqual(res.before.marks, ['high', 'low', 'none', '']);
    assert.strictEqual(res.before.label, 'Zona hamstrings', 'aria-label con describe()');
    assert.notStrictEqual(res.before.fills[0], res.before.fills[1], 'lo marcado se ve distinto');
    assert.deepStrictEqual(res.afterTap, { picked: ['quads'], selected: 'quads', detail: 'Zona quads', pressed: 'true' });
    assert.deepStrictEqual(res.update, { same: true, chest: 'mid', ham: '', selected: 'quads' }, 'update() cambia las marcas sin volver a montar ni perder lo elegido');
    // El mapa de series de siempre sigue con su leyenda
    assert.strictEqual(await page.locator(`${MAIN} .bm-legend`).count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

for (const width of [375, 430]) {
  test(`nítido y legible a ${width} px: sin scroll horizontal, figura ancha y texto ≥ 12 px (captura)`, async () => {
    const app = await openBench({ width });
    try {
      const { page } = app;
      const m = await page.evaluate((sel) => {
        const root = document.querySelector(`${sel} .bm`);
        const svg = root.querySelector('.bm-svg').getBoundingClientRect();
        const fonts = [...root.querySelectorAll('.bm-legend-label, .bm-caption, .bm-detail-hint')].map((el) => parseFloat(getComputedStyle(el).fontSize));
        const zoneBoxes = [...root.querySelectorAll('.bm-zone')].map((g) => {
          const r = [...g.querySelectorAll('path')].map((p) => p.getBoundingClientRect());
          return { id: g.dataset.muscle, w: Math.max(...r.map((b) => b.width)), h: Math.max(...r.map((b) => b.height)) };
        });
        return {
          scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
          svgW: svg.width, svgH: svg.height, svgRight: svg.right, cardRight: root.getBoundingClientRect().right,
          minFont: Math.min(...fonts), zoneBoxes,
        };
      }, MAIN);
      assert.ok(m.scrollW <= m.innerW, `sin scroll horizontal (${m.scrollW} > ${m.innerW})`);
      assert.ok(m.svgW >= 300 && m.svgW <= 322, `ancho de la figura ${m.svgW}`);
      assert.ok(m.svgH >= 340 && m.svgH <= 400, `alto de la figura ${m.svgH}`);
      assert.ok(m.svgRight <= m.cardRight + 0.5, 'la figura no se sale de la tarjeta');
      assert.ok(m.minFont >= 12, `texto ≥ 12 px (${m.minFont})`);
      for (const z of m.zoneBoxes) assert.ok(z.w >= 4 && z.h >= 14, `${z.id} visible (${z.w.toFixed(1)}×${z.h.toFixed(1)})`);

      fs.mkdirSync(RESULTS, { recursive: true });
      await page.locator(MAIN).screenshot({ path: path.join(RESULTS, `bodymap-${width}.png`) });
      await zone(page, 'core').locator('path').first().tap();
      await page.waitForTimeout(200);
      await page.locator(MAIN).screenshot({ path: path.join(RESULTS, `bodymap-${width}-core.png`) });
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}
