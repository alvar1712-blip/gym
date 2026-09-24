// E2E de la librería de gráficas (js/charts.js) sobre el banco de pruebas tests/fixtures/charts.html.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/charts.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { waitReady } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');

async function openBench({ width = 390, height = 844, dpr } = {}) {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await mod.startServer(0);
  const browser = await chromium.launch();
  const dev = devices['iPhone 13'];
  const context = await browser.newContext({
    ...dev, viewport: { width, height }, deviceScaleFactor: dpr || dev.deviceScaleFactor, locale: 'es-ES', timezoneId: 'Europe/Madrid',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${server.url}tests/fixtures/charts.html`);
  await waitReady(page);
  await page.waitForTimeout(100);
  return { browser, context, page, errors, url: server.url, close: async () => { await browser.close(); await server.close(); } };
}

const tipText = (page, card) => page.locator(`#card-${card} .chart-tip`).innerText();
/** Filas del globo: [{ val, name }]. */
const tipRows = (page, card) => page.locator(`#card-${card} .chart-tip-row`).evaluateAll((rows) => rows.map((r) => ({
  val: r.querySelector('.chart-tip-val')?.textContent, name: r.querySelector('.chart-tip-name')?.textContent || '',
})));
const tipVisible = (page, card) => page.locator(`#card-${card} .chart-tip`).isVisible();
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Caja del SVG en pantalla + datos del marco que deja la gráfica en data-* (para calcular dónde tocar). */
async function svgBox(page, card) {
  const loc = page.locator(`#card-${card} .chart-svg`);
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  const ds = await loc.evaluate((el) => ({ ...el.dataset }));
  return { ...box, ds };
}
/** x en pantalla de una fecha en una gráfica de líneas. */
function xOfDate(b, dateStr) {
  const d = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  const t = (d(dateStr) - d(b.ds.from)) / (d(b.ds.to) - d(b.ds.from));
  return b.x + Number(b.ds.x0) + t * (Number(b.ds.x1) - Number(b.ds.x0));
}
/** x en pantalla del centro de la barra i. */
function xOfBar(b, i) {
  const slot = (Number(b.ds.r) - Number(b.ds.l)) / Number(b.ds.n);
  return b.x + Number(b.ds.l) + slot * (i + 0.5);
}
async function touchDrag(page, pts) {
  const cdp = await page.context().newCDPSession(page);
  const [first, ...rest] = pts;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first[0], y: first[1] }] });
  for (const [x, y] of rest) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function chunkShots(page, prefix) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const { H, W } = await page.evaluate(() => ({ H: document.documentElement.scrollHeight, W: window.innerWidth }));
  const files = [];
  for (let y = 0, i = 0; y < H; y += 800, i++) {
    const file = path.join(RESULTS, `${prefix}-${i}.png`);
    await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width: W, height: Math.min(800, H - y) } });
    files.push(file);
  }
  return files;
}

test('pinta todas las gráficas: ancho del contenedor, 3–5 marcas Y, ≤ 6 etiquetas X sin solaparse, texto ≥ 11 px', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const info = await page.evaluate(() => [...document.querySelectorAll('.chart')].map((c) => {
      const svg = c.querySelector('.chart-svg');
      const plot = c.querySelector('.chart-plot');
      const empty = !c.querySelector('.chart-empty').hidden;
      const boxes = [...c.querySelectorAll('.chart-xlabel')].map((t) => t.getBoundingClientRect()).map((r) => [r.left, r.right]);
      const sizes = [...c.querySelectorAll('.chart-svg text')].map((t) => parseFloat(getComputedStyle(t).fontSize));
      return {
        id: c.closest('section')?.id, empty, role: svg.getAttribute('role'), aria: svg.getAttribute('aria-label'),
        w: Number(svg.getAttribute('width')), plotW: Math.floor(plot.clientWidth), svgRight: svg.getBoundingClientRect().right,
        yl: c.querySelectorAll('.chart-ylabel').length, xl: boxes, minFont: Math.min(...sizes),
        touch: getComputedStyle(plot).touchAction,
      };
    }));
    assert.strictEqual(info.length, 20, 'número de gráficas del banco');
    for (const c of info) {
      assert.strictEqual(c.touch, 'pan-y', `${c.id}: touch-action`);
      assert.strictEqual(c.role, 'img');
      assert.ok(c.aria && c.aria.length > 3, `${c.id}: aria-label`);
      if (c.empty) continue;
      assert.strictEqual(c.w, c.plotW, `${c.id}: el SVG mide lo que el contenedor`);
      assert.ok(c.yl >= 3 && c.yl <= 5, `${c.id}: ${c.yl} marcas Y`);
      assert.ok(c.xl.length >= 1 && c.xl.length <= 6, `${c.id}: ${c.xl.length} etiquetas X`);
      for (let i = 1; i < c.xl.length; i++) assert.ok(c.xl[i][0] >= c.xl[i - 1][1], `${c.id}: etiquetas X solapadas`);
      assert.ok(c.minFont >= 11, `${c.id}: texto de ${c.minFont}px`);
    }
    // Etiquetas concretas
    const yBw = await page.locator('#card-bw .chart-ylabel').allTextContents();
    assert.deepStrictEqual(yBw, ['73', '74', '75', '76']);
    assert.deepStrictEqual(await page.locator('#card-bw .chart-xlabel').allTextContents(), ['jul', 'ago', 'sep']);
    const paceY = await page.locator('#card-pace .chart-ylabel').allTextContents();
    assert.ok(paceY.every((t) => /^\d:\d\d$/.test(t)), `ritmo en min:s redondos: ${paceY.join(' ')}`);
    assert.ok(paceY.every((t) => Number(t.split(':')[1]) % 5 === 0), paceY.join(' '));
    // ritmo: invertY → el valor más bajo (más rápido) arriba
    const paceTicks = await page.locator('#card-pace .chart-ylabel').evaluateAll((els) => els.map((e) => ({ t: e.textContent, y: Number(e.getAttribute('y')) })));
    const sorted = [...paceTicks].sort((a, b) => a.y - b.y).map((p) => p.t);
    assert.ok(sorted[0] < sorted[sorted.length - 1], `ritmo invertido: ${sorted.join(' ')}`);
    assert.ok(await noHScroll(page), 'sin scroll horizontal');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('tocar muestra guía y globo con el valor exacto; arrastrar lo mueve; tocar fuera lo oculta; ratón también', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const { TODAY, daily, ma } = await page.evaluate(() => ({ TODAY: window.__bench.TODAY, daily: window.__bench.data.bw.daily, ma: window.__bench.data.bw.ma }));
    const fmt1 = (v) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });
    let b = await svgBox(page, 'bw');
    const y = b.y + b.height / 2;
    assert.strictEqual(await tipVisible(page, 'bw'), false);
    // Toque en el último día (hoy)
    await page.touchscreen.tap(xOfDate(b, TODAY), y);
    assert.ok(await tipVisible(page, 'bw'));
    let txt = await tipText(page, 'bw');
    assert.ok(txt.startsWith('24 sep 2026'), txt);
    assert.ok(txt.includes(`${fmt1(daily.at(-1).y)} kg`), `pesaje exacto: ${txt}`);
    assert.ok(txt.includes(ma.at(-1).label), `media 7 días (point.label): ${txt}`);
    assert.strictEqual(await page.locator('#card-bw .chart-guide').count(), 1);
    assert.strictEqual(await page.locator('#card-bw .chart-mark').count(), 2);

    // Arrastre horizontal hasta una fecha concreta con pesaje → el globo la sigue
    const target = daily[daily.length - 30];
    const xt = xOfDate(b, target.x);
    const x0 = xOfDate(b, TODAY);
    await touchDrag(page, Array.from({ length: 12 }, (_, i) => [x0 + ((xt - x0) * i) / 11, y]));
    txt = await tipText(page, 'bw');
    const title = await page.evaluate((d) => window.__bench.util.fmtDate(d, 'full'), target.x);
    assert.ok(txt.startsWith(title), `${title} ↔ ${txt}`);
    assert.ok(txt.includes(`${fmt1(target.y)} kg`), txt);
    assert.ok(txt.includes(ma.find((p) => p.x === target.x).label), txt);
    await page.screenshot({ path: path.join(RESULTS, 'charts-tip-bw.png'), clip: await page.locator('#card-bw').boundingBox() });

    // Tocar fuera lo oculta
    await page.touchscreen.tap(20, 20);
    assert.strictEqual(await tipVisible(page, 'bw'), false);
    assert.strictEqual(await page.locator('#card-bw .chart-guide').count(), 0);

    // Tocar otra gráfica cierra el globo de la primera
    await page.touchscreen.tap(xOfDate(b, TODAY), y);
    assert.ok(await tipVisible(page, 'bw'));
    const bp = await svgBox(page, 'pace');
    await page.touchscreen.tap(bp.x + bp.width * 0.5, bp.y + bp.height / 2);
    assert.ok(await tipVisible(page, 'pace'));
    assert.strictEqual(await tipVisible(page, 'bw'), false);
    const ptxt = await tipText(page, 'pace');
    assert.match(ptxt, /\d:\d\d \/km · \d+,\d km/, 'ritmo con point.label');

    // Ratón: al pasar por encima aparece y al salir se oculta
    b = await svgBox(page, 'bw');
    await page.mouse.move(xOfDate(b, TODAY), b.y + b.height / 2);
    assert.ok(await tipVisible(page, 'bw'));
    assert.ok((await tipText(page, 'bw')).startsWith('24 sep 2026'));
    await page.mouse.move(5, b.y - 60);
    assert.strictEqual(await tipVisible(page, 'bw'), false);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('barras apiladas: el globo da la semana, el total, cada tipo y la media exactos', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const exp = await page.evaluate(() => {
      const { data, curWeek, util } = window.__bench;
      const rows = data.load.filter((w) => w.week >= '2026-06-22'); // 3 meses → semanas desde el lunes del 24 jun
      const last = rows.at(-1);
      const prev = rows.at(-2);
      return { n: rows.length, curWeek, last, prev, range: util.fmtWeekRange(curWeek), rangePrev: util.fmtWeekRange(prev.week) };
    });
    const b = await svgBox(page, 'load');
    assert.strictEqual(Number(b.ds.n), exp.n);
    await page.touchscreen.tap(xOfBar(b, exp.n - 1), b.y + b.height * 0.6);
    let txt = await tipText(page, 'load');
    assert.ok(txt.startsWith(`${exp.range} 2026`), txt);
    const f0 = (v) => page.evaluate((x) => window.__bench.util.fmtNum(x, 0), v); // mismo formato que la página (ICU del navegador)
    const rows = await tipRows(page, 'load');
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.val]));
    assert.strictEqual(rows[0].name, 'Total', 'el total primero');
    assert.strictEqual(byName.Total, await f0(exp.last.total));
    const names = { strength: 'Fuerza', run: 'Carrera', bike: 'Bici', swim: 'Natación', other: 'Otras' };
    for (const [k, v] of Object.entries(exp.last.load)) {
      if (v) assert.strictEqual(byName[names[k]], await f0(v), `${k}: ${JSON.stringify(rows)}`);
      else assert.ok(!(names[k] in byName), `${k} a cero no aparece`);
    }
    assert.strictEqual(byName['Media 4 sem'], await f0(exp.last.avg4));
    assert.ok(txt.includes('Semana en curso'), 'líneas extra (bar.tooltip)');
    assert.strictEqual(await page.locator('#card-load .chart-guide-col').count(), 1);
    // arrastrar a la barra anterior
    await touchDrag(page, [[xOfBar(b, exp.n - 1), b.y + 60], [xOfBar(b, exp.n - 1) - 8, b.y + 60], [xOfBar(b, exp.n - 2), b.y + 60]]);
    txt = await tipText(page, 'load');
    assert.ok(txt.startsWith(`${exp.rangePrev} 2026`), txt);
    await page.screenshot({ path: path.join(RESULTS, 'charts-tip-load.png'), clip: await page.locator('#card-load').boundingBox() });

    // franja por barra: el globo muestra el rango objetivo de ESA semana
    const bc = await svgBox(page, 'chest');
    await page.touchscreen.tap(xOfBar(bc, Number(bc.ds.n) - 1), bc.y + bc.height * 0.5);
    txt = await tipText(page, 'chest');
    assert.ok(txt.includes('10–16') && txt.includes('Rango objetivo'), txt);
    await page.touchscreen.tap(xOfBar(bc, 0), bc.y + bc.height * 0.5);
    assert.ok((await tipText(page, 'chest')).includes('8–12'));
    // agrupadas: los dos valores y la nota
    const ba = await svgBox(page, 'adh');
    await page.touchscreen.tap(xOfBar(ba, Number(ba.ds.n) - 2), ba.y + ba.height * 0.5);
    txt = await tipText(page, 'adh');
    assert.match(txt, /Planificadas/);
    assert.match(txt, /Hechas/);
    assert.match(txt, /\d de \d hechas/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('point.label: la mejor serie muestra «kg × reps @RIR»; series de distinta longitud', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const bench = await page.evaluate(() => window.__bench.data.bench);
    const b = await svgBox(page, 'bench');
    const last = bench.best.at(-1);
    await page.touchscreen.tap(xOfDate(b, last.x), b.y + b.height / 2);
    const txt = await tipText(page, 'bench');
    assert.ok(txt.includes(last.label), `${last.label} ↔ ${txt}`);
    assert.ok(txt.includes(bench.e1rm.find((p) => p.x === last.x).label), txt);
    assert.match(last.label, /kg × \d+ @\d/);
    // Un día con solo 1RM (antes del inicio de la mejor serie): una sola fila
    const early = bench.e1rm.find((p) => p.x >= b.ds.from && p.x < bench.best[0].x);
    if (early) {
      await page.touchscreen.tap(xOfDate(b, early.x), b.y + b.height / 2);
      const t2 = await tipText(page, 'bench');
      assert.ok(t2.includes(early.label) && !t2.includes('Mejor serie'), t2);
    }
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

/** Valor numérico de un rótulo del eje Y: «1.250», «75,4», «80 kg», «-30», «5:15» (s). null si no es un número. */
function labelValue(t) {
  const txt = String(t).trim();
  let m = txt.match(/^(\d+):(\d\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = txt.match(/^(-?[\d.]+(?:,\d+)?)(?:\s*\S+)?$/);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
}

test('eje Y: cada rótulo es el valor de su raya (sin repetidos ni saltos desiguales), en todos los periodos', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const check = async (when) => {
      const axes = await page.evaluate(() => [...document.querySelectorAll('.chart:not(.chart-is-empty)')].map((c) => ({
        id: c.closest('section')?.id,
        ticks: [...c.querySelectorAll('.chart-ylabel')].map((t) => ({ t: t.textContent, y: Number(t.getAttribute('y')) })),
      })));
      for (const a of axes) {
        const vals = a.ticks.map((k) => labelValue(k.t));
        assert.ok(vals.every((v) => v != null), `${when} ${a.id}: rótulos ${a.ticks.map((k) => k.t).join(' | ')}`);
        assert.strictEqual(new Set(vals).size, vals.length, `${when} ${a.id}: repetidos ${a.ticks.map((k) => k.t).join(' | ')}`);
        const dv = vals[1] - vals[0];
        const dy = a.ticks[1].y - a.ticks[0].y;
        for (let i = 1; i < vals.length; i++) {
          assert.ok(Math.abs(vals[i] - vals[i - 1] - dv) < 1e-9, `${when} ${a.id}: saltos desiguales ${a.ticks.map((k) => k.t).join(' | ')}`);
          assert.ok(Math.abs(a.ticks[i].y - a.ticks[i - 1].y - dy) < 1.01, `${when} ${a.id}: rayas desiguales`);
        }
      }
      return axes;
    };
    const axes = await check('3 meses');
    const by = Object.fromEntries(axes.map((a) => [a.id, a.ticks.map((k) => k.t)]));
    assert.deepStrictEqual(by['card-ticks0'], ['26', '27', '28'], 'bici 26,9–27,1 con eje sin decimales');
    assert.deepStrictEqual(by['card-ticks1'], ['75', '75,2', '75,4', '75,6', '75,8'], 'peso 75,0–75,8 con eje de 1 decimal');
    for (const id of ['4 sem', '6 meses', '1 año', 'Todo']) {
      await page.locator('#global-period .seg-btn', { hasText: id }).click();
      await page.locator('#card-bw .chart-period .seg-btn', { hasText: id }).click();
      await check(id);
    }
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('varios puntos el mismo día: el globo da una fila por punto (y la media, la del final del día)', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const b = await svgBox(page, 'sameday');
    await page.touchscreen.tap(xOfDate(b, '2026-09-10'), b.y + b.height / 2);
    const rows = await tipRows(page, 'sameday');
    assert.deepStrictEqual(rows, [
      { val: '24 km/h · 12 km', name: 'Cada salida' },
      { val: '30 km/h · 60 km', name: 'Cada salida' },
      { val: '28,4 km/h', name: 'Media 5 últimas' },
    ]);
    assert.strictEqual(await page.locator('#card-sameday .chart-mark').count(), 3, 'una marca por fila');
    // los días con una sola salida siguen igual
    await page.touchscreen.tap(xOfDate(b, '2026-09-17'), b.y + b.height / 2);
    assert.deepStrictEqual((await tipRows(page, 'sameday')).map((r) => r.val), ['26,4 km/h · 22 km', '27,9 km/h']);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('globo con un valor largo: parte línea dentro de la gráfica, sin ensanchar la página (390, 375 y 320 px)', async () => {
  for (const width of [390, 375, 320]) {
    const app = await openBench({ width, height: 700 });
    const { page } = app;
    try {
      const pts = await page.evaluate(() => window.__bench.data.longtip);
      const b = await svgBox(page, 'longtip');
      for (const p of [pts[0], pts.at(-1)]) {
        await page.touchscreen.tap(xOfDate(b, p.x), b.y + b.height / 2);
        const r = await page.evaluate(() => {
          const tip = document.querySelector('#card-longtip .chart-tip');
          const plot = document.querySelector('#card-longtip .chart-plot').getBoundingClientRect();
          const t = tip.getBoundingClientRect();
          const cut = [...tip.querySelectorAll('.chart-tip-val, .chart-tip-name, .chart-tip-title, .chart-tip-note')]
            .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > t.right + 0.5).map((e) => e.textContent);
          return { left: t.left, right: t.right, pl: plot.left, pr: plot.right, cut, sw: document.documentElement.scrollWidth, iw: innerWidth };
        });
        assert.ok(r.left >= r.pl - 0.5 && r.right <= r.pr + 0.5, `${width}px: globo ${r.left}–${r.right} fuera de ${r.pl}–${r.pr}`);
        assert.deepStrictEqual(r.cut, [], `${width}px: texto cortado`);
        assert.ok(r.sw <= r.iw, `${width}px: scrollWidth ${r.sw} > ${r.iw}`);
        const txt = await tipText(page, 'longtip');
        assert.ok(txt.replace(/\s+/g, ' ').includes(p.label), `${width}px: ${txt}`);
        if (p.note) assert.ok(txt.replace(/\s+/g, ' ').includes(p.note), `point.note en el globo: ${txt}`);
      }
      if (width === 320) await page.screenshot({ path: path.join(RESULTS, 'charts-tip-long-320.png'), clip: await page.locator('#card-longtip').boundingBox() });
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  }
});

test('la línea que viene de un punto fuera del periodo se corta en el borde y no cruza el eje X', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const r = await page.locator('#card-edge .chart-svg').evaluate((svg) => {
      const nums = (svg.querySelector('.chart-line').getAttribute('d').match(/-?[\d.]+/g) || []).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      return { xs, ys, ds: { ...svg.dataset } };
    });
    const { ds } = r;
    assert.ok(Math.min(...r.xs) >= Number(ds.x0) - 0.1, `x ${Math.min(...r.xs)} < ${ds.x0}`);
    assert.ok(Math.max(...r.ys) <= Number(ds.b) + 0.1 && Math.min(...r.ys) >= Number(ds.t) - 0.1, `y ${r.ys} fuera de ${ds.t}–${ds.b}`);
    // el eje incluye el valor con el que la línea entra en el periodo (21 km/h el 27 ago)
    const yl = (await page.locator('#card-edge .chart-ylabel').allTextContents()).map(Number);
    assert.ok(yl[0] <= 21 && yl.at(-1) >= 27.2, yl.join(' '));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('el globo no queda debajo de una barra pegajosa (cabecera o selector de periodo)', async () => {
  const app = await openBench({ width: 375, height: 667 });
  const { page } = app;
  try {
    for (const card of ['load', 'pace', 'back']) {
      // La parte alta de la gráfica queda 60 px bajo el selector pegajoso.
      await page.evaluate((c) => {
        const svg = document.querySelector(`#card-${c} .chart-svg`);
        const bar = document.getElementById('global-period');
        window.scrollBy(0, svg.getBoundingClientRect().top - bar.offsetHeight + 60);
      }, card);
      await page.waitForTimeout(50);
      const g = await page.evaluate((c) => {
        const svg = document.querySelector(`#card-${c} .chart-svg`).getBoundingClientRect();
        const bar = document.getElementById('global-period').getBoundingClientRect();
        return { bar: bar.bottom, top: svg.top, bottom: svg.bottom, left: svg.left, width: svg.width };
      }, card);
      assert.ok(g.top < g.bar, `${card}: la gráfica empieza bajo el selector (${g.top} < ${g.bar})`);
      for (const fx of [0.5, 0.15, 0.9]) {
        await page.touchscreen.tap(g.left + g.width * fx, Math.min(g.bottom - 30, g.bar + 90));
        assert.ok(await tipVisible(page, card), `${card} ${fx}: globo visible`);
        const t = await page.locator(`#card-${card} .chart-tip`).boundingBox();
        assert.ok(t.y >= g.bar - 0.5, `${card} ${fx}: el globo empieza en ${t.y}, bajo el selector (${g.bar})`);
      }
    }
    await page.screenshot({ path: path.join(RESULTS, 'charts-tip-sticky.png') });
    // Sin nada encima, el globo sigue arriba del todo (4 px bajo el borde del área)
    await page.evaluate(() => window.scrollTo(0, 0));
    const b = await svgBox(page, 'bw');
    await page.evaluate(() => window.scrollBy(0, -10000));
    const b2 = await page.locator('#card-bw .chart-svg').boundingBox();
    await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
    const t = await page.locator('#card-bw .chart-tip').boundingBox();
    assert.ok(Math.abs(t.y - (b2.y + 4)) < 1.5 || t.y > b2.y + 4, `arriba: ${t.y} vs ${b2.y}`);
    assert.ok(b.width > 0);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('selector de periodo a 320 px: ningún rótulo se sale de su botón', async () => {
  const app = await openBench({ width: 320, height: 640 });
  const { page } = app;
  try {
    const bad = await page.evaluate(() => [...document.querySelectorAll('.chart-period .seg-btn')]
      .filter((b) => b.scrollWidth > b.clientWidth + 0.5).map((b) => `${b.textContent}: ${b.clientWidth}/${b.scrollWidth}`));
    assert.deepStrictEqual(bad, []);
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('estado vacío y casos límite (1 punto, iguales, negativos, ceros)', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    for (const [card, msg] of [['empty-line', 'Sin datos en este periodo'], ['empty-bar', 'Sin sesiones en este periodo']]) {
      const e = page.locator(`#card-${card} .chart-empty`);
      assert.ok(await e.isVisible(), card);
      assert.strictEqual((await e.innerText()).trim(), msg);
      assert.strictEqual(await page.locator(`#card-${card} .chart-svg`).isVisible(), false);
      // tocar un vacío no rompe nada
      const bx = await e.boundingBox();
      await page.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2);
      assert.strictEqual(await tipVisible(page, card), false);
    }
    // 1 punto: centrado, rotulado con su fecha, y se puede tocar
    assert.deepStrictEqual(await page.locator('#card-one .chart-xlabel').allTextContents(), ['20 sep']);
    let b = await svgBox(page, 'one');
    await page.touchscreen.tap(b.x + b.width * 0.2, b.y + b.height / 2);
    assert.ok((await tipText(page, 'one')).includes('82,5 kg × 5 @1'));
    // iguales: 80 kg en el centro del eje
    const flat = await page.locator('#card-flat .chart-ylabel').allTextContents();
    assert.strictEqual(flat[Math.floor(flat.length / 2)], '80 kg', flat.join(' '));
    // negativos
    const neg = await page.locator('#card-neg .chart-ylabel').allTextContents();
    assert.ok(neg.every((t) => t.startsWith('-')), neg.join(' '));
    b = await svgBox(page, 'neg');
    await page.touchscreen.tap(b.x + 2, b.y + b.height / 2);
    assert.ok((await tipText(page, 'neg')).includes('-30 kg × 8 (asistida)'), await tipText(page, 'neg'));
    // barras a cero (emptyWhenZero:false): eje 0–2 y globo con 0
    assert.deepStrictEqual(await page.locator('#card-zero-bar .chart-ylabel').allTextContents(), ['0', '1', '2']);
    b = await svgBox(page, 'zero-bar');
    await page.touchscreen.tap(b.x + b.width - 12, b.y + b.height / 2);
    assert.match(await tipText(page, 'zero-bar'), /\n?0\b/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('periodo: el selector redibuja con update() y se recuerda en localStorage', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const bwSel = page.locator('#card-bw .chart-period');
    assert.deepStrictEqual(await bwSel.locator('.seg-btn').allInnerTexts(), ['4 sem', '3 meses', '6 meses', '1 año', 'Todo']);
    assert.strictEqual(await bwSel.locator('.seg-btn.active').innerText(), '3 meses');
    await bwSel.locator('.seg-btn', { hasText: '4 sem' }).click();
    let b = await svgBox(page, 'bw');
    assert.strictEqual(b.ds.from, '2026-08-27');
    const xl = await page.locator('#card-bw .chart-xlabel').allTextContents();
    assert.ok(xl.length >= 3 && xl.every((t) => /^\d{1,2} [a-z]{3}$/.test(t)), xl.join(' '));
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('entreno.period.bench-bw')), '4w');
    // 'Todo' → desde el primer pesaje
    await bwSel.locator('.seg-btn', { hasText: 'Todo' }).click();
    b = await svgBox(page, 'bw');
    assert.strictEqual(b.ds.from, await page.evaluate(() => window.__bench.data.bw.first));
    // global: 1 año → 53 semanas en las barras, etiquetas de mes
    await page.locator('#global-period .seg-btn', { hasText: '1 año' }).click();
    const bl = await svgBox(page, 'load');
    assert.strictEqual(Number(bl.ds.n), 53);
    const lx = await page.locator('#card-load .chart-xlabel').allTextContents();
    assert.ok(lx.length >= 3 && lx.length <= 6 && lx.includes('2026'), lx.join(' '));
    // agrupadas con 53 semanas → superpuestas (planificadas detrás, hechas delante)
    const fills = await page.locator('#card-adh .chart-bar').evaluateAll((els) => els.map((e) => e.style.fill));
    assert.deepStrictEqual(fills, ['rgb(146, 155, 170)', 'rgb(184, 243, 74)'], 'capa trasera primero');
    // recarga: se recuerda
    await page.reload();
    await waitReady(page);
    assert.strictEqual(await page.locator('#card-bw .chart-period .seg-btn.active').innerText(), 'Todo');
    assert.strictEqual(await page.locator('#global-period .seg-btn.active').innerText(), '1 año');
    // getPeriod/setPeriod aguantan un localStorage que lanza (modo privado)
    const r = await page.evaluate(() => {
      const { getPeriod, setPeriod } = window.__bench.lib;
      const orig = Storage.prototype.getItem;
      const origSet = Storage.prototype.setItem;
      Storage.prototype.getItem = () => { throw new Error('bloqueado'); };
      Storage.prototype.setItem = () => { throw new Error('bloqueado'); };
      try {
        const a = getPeriod('privado');
        const ok = setPeriod('privado', '6m');
        return [a, ok, getPeriod('privado')];
      } finally { Storage.prototype.getItem = orig; Storage.prototype.setItem = origSet; }
    });
    assert.deepStrictEqual(r, ['3m', true, '6m']);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('400+ puntos: pocos nodos SVG y el globo sigue al dedo', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    await page.locator('#card-bw .chart-period .seg-btn', { hasText: 'Todo' }).click();
    const nodes = await page.evaluate(() => ({
      bw: document.querySelectorAll('#card-bw .chart-svg *').length,
      dense: document.querySelectorAll('#card-dense .chart-svg *').length,
      bwPoints: window.__bench.data.bw.daily.length,
    }));
    assert.ok(nodes.bwPoints >= 400, `${nodes.bwPoints} pesajes`);
    assert.ok(nodes.bw < 80, `peso: ${nodes.bw} nodos`);
    assert.ok(nodes.dense < 60, `480 puntos: ${nodes.dense} nodos`);
    const dense = await page.evaluate(() => window.__bench.data.dense);
    const b = await svgBox(page, 'dense');
    const y = b.y + b.height / 2;
    const t0 = Date.now();
    const pts = Array.from({ length: 60 }, (_, i) => [b.x + Number(b.ds.x1) - i * ((Number(b.ds.x1) - Number(b.ds.x0)) / 59), y]);
    await touchDrag(page, pts);
    const ms = Date.now() - t0;
    assert.ok(ms < 4000, `arrastre de 60 pasos en ${ms} ms`);
    const txt = await tipText(page, 'dense');
    assert.ok(txt.startsWith(await page.evaluate((d) => window.__bench.util.fmtDate(d, 'full'), dense[0].x)), txt);
    assert.ok(txt.includes(`${dense[0].y} ppm`), txt);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('redimensionado: redibuja al ancho nuevo (ResizeObserver) sin scroll horizontal', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const w390 = Number(await page.locator('#card-bw .chart-svg').getAttribute('width'));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(150);
    const w375 = Number(await page.locator('#card-bw .chart-svg').getAttribute('width'));
    assert.strictEqual(w390 - w375, 15, `${w390} → ${w375}`);
    const all = await page.evaluate(() => [...document.querySelectorAll('.chart')].filter((c) => !c.classList.contains('chart-is-empty'))
      .map((c) => [Number(c.querySelector('.chart-svg').getAttribute('width')), Math.floor(c.querySelector('.chart-plot').clientWidth)]));
    for (const [w, pw] of all) assert.strictEqual(w, pw);
    assert.ok(await noHScroll(page));
    // contenedor más estrecho (sin cambiar la ventana)
    await page.evaluate(() => { document.getElementById('slot-bw').style.width = '240px'; });
    await page.waitForTimeout(150);
    assert.strictEqual(Number(await page.locator('#card-bw .chart-svg').getAttribute('width')), 240);
    assert.ok((await page.locator('#card-bw .chart-xlabel').count()) >= 2);
    // el globo sobrevive al redibujado
    const b = await svgBox(page, 'bw');
    await page.touchscreen.tap(b.x + Number(b.ds.x1), b.y + b.height / 2);
    await page.evaluate(() => { document.getElementById('slot-bw').style.width = '300px'; });
    await page.waitForTimeout(150);
    assert.ok(await tipVisible(page, 'bw'));
    assert.ok((await tipText(page, 'bw')).startsWith('24 sep 2026'));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('destroy() quita el DOM, los listeners del documento y el ResizeObserver; update() tras destroy no hace nada', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const r = await page.evaluate(async () => {
      const added = [];
      const removed = [];
      const oa = document.addEventListener;
      const or = document.removeEventListener;
      document.addEventListener = function (t, fn, o) { added.push([t, fn]); return oa.call(this, t, fn, o); };
      document.removeEventListener = function (t, fn, o) { removed.push([t, fn]); return or.call(this, t, fn, o); };
      const RO = window.ResizeObserver;
      const ros = [];
      window.ResizeObserver = class extends RO {
        constructor(cb) { super(cb); this.disconnected = false; ros.push(this); }
        disconnect() { this.disconnected = true; super.disconnect(); }
      };
      const { lineChart, barChart } = window.__bench.lib;
      const host = document.createElement('div');
      document.getElementById('bench').appendChild(host);
      const pts = [{ x: '2026-09-01', y: 1 }, { x: '2026-09-10', y: 3 }];
      const c1 = lineChart(host, { series: [{ id: 'a', label: 'A', points: pts }, { id: 'b', label: 'B', points: pts }] });
      const c2 = barChart(host, { bars: [{ x: '2026-09-07', segments: [{ key: 'k', value: 2 }] }], legend: [{ key: 'k', label: 'K', color: '#fff' }] });
      await new Promise((res) => requestAnimationFrame(res));
      const before = host.querySelectorAll('.chart').length;
      c1.destroy();
      c2.destroy();
      c1.destroy(); // idempotente
      c1.update({ height: 300 });
      const docAdded = added.filter(([t]) => t === 'pointerdown');
      const allRemoved = docAdded.every(([t, fn]) => removed.some(([t2, fn2]) => t2 === t && fn2 === fn));
      document.addEventListener = oa;
      document.removeEventListener = or;
      window.ResizeObserver = RO;
      host.style.width = '200px';
      await new Promise((res) => setTimeout(res, 100));
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return { before, after: host.childElementCount, docAdded: docAdded.length, allRemoved, ros: ros.length, disconnected: ros.every((x) => x.disconnected) };
    });
    assert.deepStrictEqual(r, { before: 2, after: 0, docAdded: 2, allRemoved: true, ros: 2, disconnected: true });
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('pan-y: arrastrar en vertical sobre una gráfica desplaza la página y no deja el globo', async () => {
  const app = await openBench();
  const { page } = app;
  try {
    const b = await svgBox(page, 'load');
    const y0 = await page.evaluate(() => window.scrollY);
    const x = b.x + b.width / 2;
    const ys = Array.from({ length: 10 }, (_, i) => b.y + b.height * 0.8 - i * 18);
    await touchDrag(page, ys.map((y) => [x, y]));
    await page.waitForTimeout(300);
    const y1 = await page.evaluate(() => window.scrollY);
    assert.ok(y1 > y0 + 40, `la página se desplaza: ${y0} → ${y1}`);
    assert.strictEqual(await tipVisible(page, 'load'), false);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('capturas del banco a 390 y 375 px (revísalas con Read)', async () => {
  for (const width of [390, 375]) {
    const app = await openBench({ width, dpr: 2 });
    try {
      const files = await chunkShots(app.page, `charts-${width}`);
      assert.ok(files.length >= 4);
      assert.ok(await noHScroll(app.page));
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  }
});
