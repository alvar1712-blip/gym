// Sensación de app nativa en iPhone (V4):
//   · hojas inferiores: la base de la pantalla de detrás llega hasta el borde y el panel hasta el límite visible (sin franja
//     negra), con varios tamaños y con el teclado; se cierran al tocar fuera;
//   · zoom y scroll: sin zoom por doble toque, sin indicadores de desplazamiento en táctil, el scroll sigue funcionando,
//     campos ≥ 16 px (Safari hace autozoom con los menores) y sin desbordes horizontales;
//   · fuerza libre desde Hoy: entra al instante, sin pantalla encima, y un doble toque no crea dos sesiones;
//   · la felicitación nace del botón real (mismo rectángulo) y la hoja se cierra cuando ya lo cubre;
//   · borrar una sesión y «Deshacer».
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/native-feel.test.cjs  (E2E_BROWSER=webkit para Safari)
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, idbAll } = require('./helpers.cjs');

const SIZES = [[320, 568], [375, 667], [390, 844], [430, 932]];

async function withApp(fn) {
  const app = await openApp({ exampleWeek: true });
  try {
    await fn(app);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

/** Base de la tarjeta de detrás: origen del encogimiento, y su borde inferior si el motor mide 100dvh como lo visible
 *  (el WebKit de Playwright no actualiza dvh al redimensionar la ventana; en iOS sí). Se ejecuta DENTRO de la página. */
const baseOf = () => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;height:100dvh';
  document.body.appendChild(d);
  const dvh = d.getBoundingClientRect().height;
  d.remove();
  return { originY: Math.round(parseFloat(getComputedStyle(document.querySelector('#view')).transformOrigin.split(' ')[1])), viewBottom: Math.round(document.querySelector('#view').getBoundingClientRect().bottom), dvhOk: Math.abs(dvh - innerHeight) < 1 };
};

/** Una sesión de fuerza con una serie hecha (activa o terminada). */
function seed(page, { done = false } = {}) {
  return page.evaluate(async (done) => {
    const m = await import('./js/session-logic.js');
    const s = await m.createStrengthSession({ templateId: null });
    const se = m.newSessionExercise('press_banca', s);
    const set = m.newSet(null, se);
    Object.assign(set, { weight: 60, reps: 8, done: true, doneAt: Date.now() });
    se.sets = [set];
    s.exercises.push(se);
    if (done) Object.assign(s, { status: 'done', durationMin: 40, rpe: 7 });
    await window.__app.store.save('sessions', s);
    return s.id;
  }, done);
}

test('hoja de opciones de la sesión: sin franja negra abajo en 4 tamaños; se cierra al tocar fuera', () => withApp(async ({ page }) => {
  const id = await seed(page);
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await go(page, `#/session/${id}`);
    await page.locator('.ses-menu-btn').click();
    await page.locator('.sheet-panel').waitFor();
    await page.waitForTimeout(650); // termina la animación de la hoja y del efecto tarjeta
    const m = {
      ...await page.evaluate(() => ({ vh: innerHeight, panelBottom: Math.round(document.querySelector('.sheet-panel').getBoundingClientRect().bottom), cardOn: document.documentElement.classList.contains('sheet-card') })),
      ...await page.evaluate(baseOf),
    };
    assert.ok(m.cardOn, `${w}px: efecto tarjeta activo`);
    assert.strictEqual(m.panelBottom, m.vh, `${w}px: el panel llega al límite visible`);
    assert.strictEqual(m.originY, m.vh, `${w}px: la base de la tarjeta se ancla en el borde visible (no se mueve al encogerse)`);
    if (m.dvhOk) assert.ok(m.viewBottom >= m.vh - 1, `${w}px: la tarjeta de detrás no deja negro bajo el panel (base en ${m.viewBottom}, límite ${m.vh})`);
    // Tocar fuera (arriba del todo) cierra
    await page.mouse.click(w / 2, 6);
    await page.waitForFunction(() => !document.querySelector('.sheet-panel'), null, { timeout: 2000 });
    assert.strictEqual(await page.evaluate(() => document.documentElement.classList.contains('sheet-card')), false, `${w}px: la pantalla vuelve a su tamaño`);
  }
}));

test('hoja con el teclado abierto: se coloca encima del teclado (--kb) y la base de detrás no se mueve', () => withApp(async ({ page }) => {
  const id = await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, `#/session/${id}`);
  await page.locator('.ses-menu-btn').click();
  await page.locator('.sheet-panel').waitFor();
  await page.evaluate(() => document.documentElement.style.setProperty('--kb', '300px')); // lo que pone visualViewport al subir el teclado
  await page.waitForTimeout(500);
  const m = { ...await page.evaluate(() => ({ vh: innerHeight, panelBottom: Math.round(document.querySelector('.sheet-panel').getBoundingClientRect().bottom) })), ...await page.evaluate(baseOf) };
  assert.strictEqual(m.panelBottom, m.vh - 300, 'encima del teclado');
  assert.strictEqual(m.originY, m.vh, 'la base de la tarjeta de detrás sigue anclada en el borde visible, con el teclado o sin él');
}));

test('zoom y scroll: sin zoom por doble toque, sin indicadores en táctil y el scroll funciona; sin desbordes ni campos < 16 px', () => withApp(async ({ page }) => {
  const css = await page.evaluate(() => ({
    touch: getComputedStyle(document.documentElement).touchAction,
    bar: getComputedStyle(document.querySelector('#view')).scrollbarWidth,
    coarse: matchMedia('(hover: none) and (pointer: coarse)').matches,
    vp: document.querySelector('meta[name=viewport]').content,
  }));
  assert.strictEqual(css.touch, 'manipulation');
  assert.ok(css.coarse, 'el contexto emula un iPhone táctil');
  assert.strictEqual(css.bar, 'none', 'sin indicador de desplazamiento en táctil');
  assert.ok(!/user-scalable|maximum-scale/.test(css.vp), 'el pellizco (accesibilidad) no se desactiva');
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const route of ['#/today', '#/exercises', '#/settings', '#/activity/new?kind=run', '#/exercise/new']) {
      await go(page, route);
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const small = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')]
          .filter((e) => e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => `${e.tagName}.${e.className}`);
        const d = document.documentElement;
        return { small, over: d.scrollWidth - d.clientWidth };
      });
      assert.deepStrictEqual(r.small, [], `${w}px ${route}: campos < 16 px`);
      assert.ok(r.over <= 1, `${w}px ${route}: desborde horizontal de ${r.over}px`);
    }
  }
  // El scroll sigue funcionando aunque no se vea el indicador
  await page.setViewportSize({ width: 375, height: 667 });
  await go(page, '#/settings');
  await page.waitForTimeout(300);
  const y = await page.evaluate(async () => { window.scrollTo(0, 400); await new Promise((r) => setTimeout(r, 100)); return scrollY; });
  assert.ok(y > 100, `la lista se desplaza (scrollY ${y})`);
}));

test('fuerza libre desde Hoy: entra al instante, sin pantalla encima, y un doble toque crea una sola sesión', () => withApp(async ({ page }) => {
  await go(page, '#/today');
  await page.waitForTimeout(500);
  const btn = page.getByText('Fuerza libre', { exact: true }).first();
  await btn.scrollIntoViewIfNeeded();
  const t0 = Date.now();
  await btn.dblclick();
  await page.locator('.ses-menu-btn').waitFor({ timeout: 2000 });
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, `la sesión aparece en ${ms} ms`);
  assert.strictEqual(await page.locator('.cele-start, .cele').count(), 0, 'nada tapa la entrada');
  await page.evaluate(() => window.__app.store.flush());
  const active = (await idbAll(page, 'sessions')).filter((s) => s.status === 'active');
  assert.strictEqual(active.length, 1, 'una sola sesión en curso');
}));

test('la felicitación nace del botón real: mismo rectángulo, y la hoja se cierra cuando ya lo cubre', () => withApp(async ({ page }) => {
  const id = await seed(page);
  await go(page, `#/session/${id}`);
  await page.locator('.ses-finish').click();
  const fin = page.locator('.sheet-panel.ses-finish-sheet');
  await fin.waitFor();
  await fin.locator('.ses-dur input').fill('45');
  await page.waitForTimeout(500);
  const btn = fin.locator('.sheet-actions .btn-primary');
  const box = await btn.boundingBox();
  const btnBg = await btn.evaluate((e) => getComputedStyle(e).backgroundColor);
  // Sin rAF la forma no avanza: se lee exactamente el primer fotograma (si no, depende de cuántos pasen antes de leerlo)
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await btn.click();
  await page.locator('.cele-mass path').waitFor({ state: 'attached' });
  // Primer fotograma: la masa ES la silueta del botón (tolerancia de una fila: la forma se muestrea en 96 filas)
  const o = await page.evaluate(() => {
    const p = document.querySelector('.cele-mass path');
    // Filas con anchura de la silueta (las prolongaciones hasta los bordes tienen ancho cero y no se ven)
    const pts = p.getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
    const byY = new Map();
    for (let i = 0; i < pts.length; i += 2) { const [x, y] = [pts[i], pts[i + 1]]; const v = byY.get(y) || [x, x]; byY.set(y, [Math.min(v[0], x), Math.max(v[1], x)]); }
    const rows = [...byY].filter(([, [a, b]]) => b - a > 1);
    return { left: Math.min(...rows.map(([, v]) => v[0])), right: Math.max(...rows.map(([, v]) => v[1])), top: Math.min(...rows.map(([y]) => y)), bottom: Math.max(...rows.map(([y]) => y)), sheetOpen: !!document.querySelector('.ses-finish-sheet'), fill: getComputedStyle(p).fill };
  });  const rowPx = 844 / 96;
  // El botón hace un pequeño rebote de escala (≈3 %) al soltarlo: la masa parte de su tamaño visible en ese instante
  const tol = 0.04 * box.width;
  assert.ok(Math.abs(o.left - box.x) <= tol && Math.abs(o.right - (box.x + box.width)) <= tol, `arranca en el botón (x ${o.left}-${o.right} vs ${box.x}-${box.x + box.width})`);
  assert.ok(Math.abs(o.top - box.y) <= rowPx + 4 && Math.abs(o.bottom - (box.y + box.height)) <= rowPx + 4, `y con su altura (y ${o.top}-${o.bottom} vs ${box.y}-${box.y + box.height})`);
  assert.strictEqual(o.fill, btnBg, 'del color del botón');
  assert.ok(o.sheetOpen, 'la hoja sigue ahí mientras el botón crece (sin saltos)');
  await page.waitForFunction(() => !document.querySelector('.ses-finish-sheet'), null, { timeout: 2000 });
  assert.match(await page.evaluate(() => location.hash), new RegExp(`#/session/${id}/summary`), 'ya montó el resumen debajo');
  assert.ok(await page.locator('.cele').count() === 1, 'la celebración sigue en marcha');
}));

test('borrar una sesión y «Deshacer»: vuelve igual, una sola vez', () => withApp(async ({ page }) => {
  const id = await seed(page, { done: true });
  await go(page, `#/session/${id}`);
  await page.locator('.ses-menu-btn').click();
  await page.locator('.action-item.danger', { hasText: 'Borrar sesión' }).click();
  await page.locator('button', { hasText: /^Borrar sesión$/ }).last().click();
  await page.waitForFunction((sid) => !window.__app.store.get('sessions', sid), id, { timeout: 3000 });
  const undo = page.locator('.toast button', { hasText: 'Deshacer' });
  await undo.waitFor();
  await undo.click();
  await page.waitForFunction((sid) => !!window.__app.store.get('sessions', sid), id, { timeout: 3000 });
  await page.evaluate(() => window.__app.store.flush());
  const back = (await idbAll(page, 'sessions')).filter((s) => s.id === id);
  assert.strictEqual(back.length, 1, 'restaurada una sola vez en disco');
  assert.strictEqual(back[0].exercises[0].sets.length, 1, 'con sus series');
}));
