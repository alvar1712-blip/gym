// E2E de gestos y fluidez (§1 de docs/MEJORAS5.md): gesto de «atrás» del sistema sin animación doble y con el
// scroll donde estaba, hojas que se cierran con «atrás» (sin cambiar de pantalla ni dejar entradas muertas) y
// arrastrando hacia abajo, respuesta al toque sin falsos positivos al desplazar, «reducir movimiento», título
// grande → pequeño al desplazar, y capturas del cristal.
// Los toques son reales (CDP Input.dispatchTouchEvent: el navegador genera touch* y pointer* y desplaza la página).
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, shot, waitReady, devices, chromiumOnly } = require('./helpers.cjs');
const path = require('path');
const { pathToFileURL } = require('url');

const wait = (page, ms) => page.waitForTimeout(ms);

/**
 * Como openApp(), pero con composición por GPU (SwiftShader): el Chromium sin pantalla por defecto compone por
 * software y apenas pinta backdrop-filter (el texto de debajo del cristal sale nítido en las capturas, cosa
 * que en el iPhone no pasa). Así las capturas del cristal se parecen a lo que se ve en Safari. Si ese modo no
 * arranca, se usa openApp() tal cual.
 */
async function openGlassApp() {
  const { chromium } = require('playwright');
  let browser = null;
  try {
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  } catch {
    return openApp();
  }
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await mod.startServer(0);
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(server.url);
  await waitReady(page);
  return { browser, context, page, server, errors, close: async () => { await browser.close(); await server.close(); } };
}

/** Pantalla táctil: toques de un dedo por CDP. */
async function touchscreen(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  return {
    start: (x, y) => send('touchStart', [{ x, y }]),
    move: (x, y) => send('touchMove', [{ x, y }]),
    end: () => send('touchEnd'),
    cancel: () => send('touchCancel'),
    /** Arrastre de (x0,y0) a (x1,y1) en `steps` pasos separados `ms`. */
    async drag(x0, y0, x1, y1, { steps = 8, ms = 16, release = 'end', hold = 0 } = {}) {
      await send('touchStart', [{ x: x0, y: y0 }]);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }]);
        if (ms) await page.waitForTimeout(ms);
      }
      if (hold) await page.waitForTimeout(hold);
      await send(release === 'cancel' ? 'touchCancel' : 'touchEnd');
    },
  };
}

const settle = (page) => page.evaluate(async () => {
  const r = await import('./js/router.js');
  await r.settled();
  await new Promise((res) => setTimeout(res, 40));
});

/** Navega como la app (animado), espera a que termine. */
async function appNavigate(page, hash) {
  await page.evaluate(async (h) => (await import('./js/router.js')).navigate(h), hash);
  await page.waitForFunction((h) => location.hash === h, hash);
  await settle(page);
}

/** Vuelve atrás con el historial (como el gesto o el botón del sistema, sin pasar por router.back()). */
async function historyBack(page) {
  return page.evaluate(async () => {
    const r = await import('./js/router.js');
    const from = location.hash;
    const seen = { nav: [], vt: 0 };
    const mo = new MutationObserver(() => { if (document.documentElement.dataset.nav) seen.nav.push(document.documentElement.dataset.nav); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-nav'] });
    history.back();
    for (let i = 0; i < 200 && location.hash === from; i++) await new Promise((res) => setTimeout(res, 5));
    for (let i = 0; i < 60; i++) {
      if (document.getAnimations().some((a) => a.effect && a.effect.pseudoElement && a.effect.pseudoElement.startsWith('::view-transition'))) seen.vt++;
      await new Promise((res) => requestAnimationFrame(res));
      if (i > 8 && !r.navInfo().active) break;
    }
    mo.disconnect();
    await r.settled();
    const info = r.navInfo();
    return { hash: location.hash, kind: info.kind, mode: info.mode, ua: info.ua, nav: seen.nav, vtAnims: seen.vt, y: Math.round(scrollY), enter: !!document.querySelector('.view-enter') };
  });
}

/**
 * Navega (push animado) y, en cuanto aparece .view-stagger, lee la animación de cada bloque del contenido
 * (nombre, final = retraso + duración). Síncrono con la mutación: no depende de lo cargada que vaya la prueba.
 */
function staggerOnPush(page, hash) {
  return page.evaluate(async (h) => {
    const r = await import('./js/router.js');
    const seen = new Promise((resolve) => {
      const read = () => {
        const content = document.querySelector('.view-stagger > .content');
        if (!content) return false;
        mo.disconnect();
        resolve([...content.children].map((c) => {
          const cs = getComputedStyle(c);
          return { name: cs.animationName, end: (parseFloat(cs.animationDelay) + parseFloat(cs.animationDuration)) * 1000 };
        }).filter((t) => t.name !== 'none'));
        return true;
      };
      const mo = new MutationObserver(read);
      mo.observe(document.getElementById('view'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
      setTimeout(() => { mo.disconnect(); resolve([]); }, 3000);
    });
    r.navigate(h);
    const out = await seen;
    await r.settled();
    return out;
  }, hash);
}

test('gesto del borde izquierdo: la vuelta no se anima otra vez y la pantalla aparece con su scroll', { skip: chromiumOnly('toques reales con CDP (Input.dispatchTouchEvent)') }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    const ts = await touchscreen(page);
    await go(page, '#/settings');
    await page.evaluate(() => window.scrollTo(0, 420));
    await wait(page, 120);
    await appNavigate(page, '#/settings/data');
    assert.strictEqual(await page.evaluate(() => Math.round(scrollY)), 0, 'la pantalla nueva empieza arriba');

    // Deslizar desde x≈5 hacia el centro (el sistema cancela el toque) y el navegador vuelve atrás.
    await ts.drag(5, 420, 230, 430, { steps: 8, ms: 12, release: 'cancel' });
    let res = await historyBack(page);
    assert.strictEqual(res.hash, '#/settings');
    assert.deepStrictEqual([res.kind, res.mode, res.ua], ['none', 'none', true], 'sin transición propia');
    assert.deepStrictEqual(res.nav, [], 'sin <html data-nav>');
    assert.strictEqual(res.vtAnims, 0, 'sin animaciones de View Transitions');
    assert.strictEqual(res.y, 420, 'el scroll vuelve a donde estaba');
    assert.strictEqual(await page.evaluate(() => document.querySelector('#view .topbar').classList.contains('is-compact')), true, 'cabecera compacta, como estaba');
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('entreno:scroll') || '{}'));
    assert.ok(Object.values(stored).includes(420), `copia en sessionStorage (${JSON.stringify(stored)})`);

    // Un toque en el borde que no se desliza no cuenta: «atrás» normal, animado como pop.
    await appNavigate(page, '#/settings/data');
    await ts.start(5, 420);
    await ts.end();
    await wait(page, 30);
    res = await historyBack(page);
    assert.deepStrictEqual([res.kind, res.mode, res.ua], ['pop', 'vt', false]);
    assert.strictEqual(res.y, 420, 'también con la animación, cada entrada recuerda su scroll');

    // hasUAVisualTransition (Safari/Chromium cuando el navegador ya animó el gesto): tampoco se anima.
    await appNavigate(page, '#/settings/week');
    await page.evaluate(() => {
      for (const E of [PopStateEvent, HashChangeEvent]) Object.defineProperty(E.prototype, 'hasUAVisualTransition', { get: () => true, configurable: true });
    });
    res = await historyBack(page);
    assert.deepStrictEqual([res.kind, res.mode, res.ua, res.y], ['none', 'none', true, 420]);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('scroll por entrada: montaje asíncrono (Hoy), adelante/atrás y sin iOS 17 (sin entrada animada al volver)', { skip: chromiumOnly('toques reales con CDP (Input.dispatchTouchEvent)') }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    const ts = await touchscreen(page);
    await page.setViewportSize({ width: 390, height: 600 });
    await go(page, '#/today');
    await page.waitForSelector('.today-extra[data-ready="1"]', { state: 'attached' });
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    assert.ok(max > 200, `Hoy se puede desplazar (${max})`);
    // Al fondo (lo que pinta .today-extra después del montaje) y a otra pantalla.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await wait(page, 120);
    const y0 = await page.evaluate(() => Math.round(scrollY));
    await appNavigate(page, '#/import');
    await ts.drag(4, 300, 220, 305, { release: 'cancel' });
    const res = await historyBack(page);
    assert.deepStrictEqual([res.hash, res.kind], ['#/today', 'none']);
    assert.ok(Math.abs(res.y - y0) <= 1, `Hoy vuelve al fondo aunque se rellene después (${res.y} ≠ ${y0})`);

    // Adelante (entrada que ya existía): también con su scroll (arriba).
    await page.evaluate(() => history.forward());
    await page.waitForFunction(() => location.hash === '#/import');
    await settle(page);
    assert.strictEqual(await page.evaluate(() => Math.round(scrollY)), 0);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }

  // Sin View Transitions (iOS 17): la vuelta por el gesto tampoco anima la entrada de la vista.
  const app2 = await openApp();
  try {
    const { page } = app2;
    await page.addInitScript(() => { delete Document.prototype.startViewTransition; });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.classList.contains('ready'));
    const ts = await touchscreen(page);
    await go(page, '#/settings');
    await page.evaluate(() => window.scrollTo(0, 300));
    await wait(page, 100);
    await appNavigate(page, '#/settings/data');
    await ts.drag(6, 400, 240, 400, { release: 'cancel' });
    const res = await historyBack(page);
    assert.deepStrictEqual([res.kind, res.mode, res.enter, res.y], ['none', 'none', false, 300]);
    assert.deepStrictEqual(app2.errors, []);
  } finally {
    await app2.close();
  }
});

/** Abre un menú de acciones con un botón real (como la app) y espera a que esté abierto. */
async function openMenu(page, actions = null) {
  await page.evaluate((acts) => {
    let b = document.getElementById('menu-opener');
    if (!b) {
      b = document.createElement('button');
      b.id = 'menu-opener';
      b.className = 'btn btn-secondary';
      b.textContent = 'Menú';
      b.style.cssText = 'position:fixed;top:140px;right:16px;z-index:50';
      document.body.appendChild(b);
    }
    b.onclick = async () => {
      const ui = await import('./js/ui.js');
      const r = await import('./js/router.js');
      window.__picked = null;
      ui.actionSheet({ title: 'Opciones', actions: (acts || [{ label: 'Uno' }, { label: 'Dos' }]).map((a) => ({
        label: a.label,
        onClick: () => { window.__picked = a.label; if (a.go) r.navigate(a.go); },
      })) });
    };
  }, actions);
  await page.locator('#menu-opener').click();
  await page.locator('.sheet-overlay.open').waitFor();
  await wait(page, 380);
}

const sheetGone = (page) => page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 1500 });
const histState = (page) => page.evaluate(async () => ({
  hash: location.hash, st: history.state, len: history.length, depth: (await import('./js/router.js')).overlayDepth(),
}));

test('hojas y «atrás»: la cierra sin cambiar de pantalla; cerrar o navegar desde la hoja no deja entradas muertas', { skip: chromiumOnly('toques reales con CDP (Input.dispatchTouchEvent)') }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/settings');
    await page.evaluate(() => window.scrollTo(0, 200));
    await wait(page, 100);
    await page.evaluate(() => { document.querySelector('#view .view-inner').dataset.mark = '1'; });
    const base = await histState(page);
    assert.ok(!base.st.__ov);

    // Abrir: entrada propia (misma URL); «atrás» la cierra sin cambiar de pantalla ni volver a montarla.
    await openMenu(page);
    let hs = await histState(page);
    assert.strictEqual(hs.hash, '#/settings');
    assert.ok(hs.st.__ov, 'entrada de historial de la hoja');
    assert.strictEqual(hs.st.__idx, base.st.__idx, 'misma posición que la pantalla');
    assert.strictEqual(hs.depth, 1);
    await page.evaluate(() => history.back());
    await sheetGone(page);
    await settle(page);
    hs = await histState(page);
    assert.deepStrictEqual([hs.hash, !!hs.st.__ov, hs.depth], ['#/settings', false, 0]);
    assert.strictEqual(await page.evaluate(() => document.querySelector('#view .view-inner').dataset.mark), '1', 'la pantalla no se ha vuelto a montar');
    assert.strictEqual(await page.evaluate(() => Math.round(scrollY)), 200, 'ni se ha movido');

    // Con el gesto del borde: se quita al momento (el sistema ya lo ha animado).
    await openMenu(page);
    const ts = await touchscreen(page);
    await ts.drag(5, 300, 200, 300, { release: 'cancel' });
    const instant = await page.evaluate(async () => {
      history.back();
      await new Promise((r) => window.addEventListener('popstate', r, { once: true }));
      return !!document.querySelector('.sheet-overlay');
    });
    assert.strictEqual(instant, false, 'sin animación de cierre tras el gesto');
    await settle(page);

    // Cerrar con la interfaz (×): se quita su entrada (history.back) sin cambiar de pantalla.
    await openMenu(page);
    await page.locator('.sheet-panel .icon-btn[aria-label="Cerrar"]').click();
    await sheetGone(page);
    await settle(page);
    hs = await histState(page);
    assert.deepStrictEqual([hs.hash, !!hs.st.__ov, hs.depth], ['#/settings', false, 0]);

    // Elegir una acción que abre otra hoja: la segunda también tiene su entrada; «atrás» la cierra.
    await page.evaluate(async () => {
      const ui = await import('./js/ui.js');
      ui.actionSheet({ title: 'A', actions: [{ label: 'Abrir otra', onClick: () => ui.actionSheet({ title: 'B', actions: [{ label: 'Nada', onClick() {} }] }) }] });
    });
    await page.locator('.action-item', { hasText: 'Abrir otra' }).click();
    await page.locator('.sheet-overlay.open .sheet-title', { hasText: 'B' }).waitFor();
    await settle(page);
    hs = await histState(page);
    assert.deepStrictEqual([hs.hash, !!hs.st.__ov, hs.depth], ['#/settings', true, 1]);
    await page.evaluate(() => history.back());
    await sheetGone(page);
    await settle(page);
    assert.deepStrictEqual((await histState(page)).depth, 0);

    // Acción que navega: se quita la entrada de la hoja y luego se navega; «atrás» vuelve a Ajustes (sin
    // entradas muertas) y otra vez «atrás» sale de Ajustes.
    await openMenu(page, [{ label: 'Semana tipo', go: '#/settings/week' }]);
    await page.locator('.action-item', { hasText: 'Semana tipo' }).click();
    await page.waitForFunction(() => location.hash === '#/settings/week');
    await sheetGone(page);
    await settle(page);
    hs = await histState(page);
    assert.deepStrictEqual([!!hs.st.__ov, hs.st.__idx], [false, base.st.__idx + 1], 'la pantalla nueva va justo después');
    const back1 = await page.evaluate(async () => {
      const r = await import('./js/router.js');
      r.back('#/today');
      for (let i = 0; i < 200 && location.hash !== '#/settings'; i++) await new Promise((res) => setTimeout(res, 5));
      await r.settled();
      return { hash: location.hash, st: history.state };
    });
    assert.deepStrictEqual([back1.hash, !!back1.st.__ov, back1.st.__idx], ['#/settings', false, base.st.__idx]);

    // Un enlace (#/…) dentro de una hoja: igual.
    await page.evaluate(async () => {
      const ui = await import('./js/ui.js');
      const a = document.createElement('a');
      a.href = '#/settings/data';
      a.textContent = 'Copias';
      a.className = 'btn btn-secondary';
      ui.sheet({ title: 'Enlace', body: a });
    });
    await page.locator('.sheet-overlay.open').waitFor();
    await wait(page, 380);
    await page.locator('.sheet-panel a', { hasText: 'Copias' }).click();
    await page.waitForFunction(() => location.hash === '#/settings/data');
    await sheetGone(page);
    await settle(page);
    assert.deepStrictEqual([(await histState(page)).st.__idx, !!(await histState(page)).st.__ov], [base.st.__idx + 1, false]);
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => location.hash === '#/settings');
    await settle(page);
    assert.ok(!(await histState(page)).st.__ov, 'sin entrada muerta de la hoja');

    // replaceUrl() justo al cerrar una hoja: se aplica a la entrada de la pantalla (sin volver a montarla).
    await page.evaluate(() => { document.querySelector('#view .view-inner').dataset.mark = '2'; });
    await openMenu(page);
    await page.evaluate(async () => {
      const ui = await import('./js/ui.js');
      const r = await import('./js/router.js');
      ui.closeAllSheets();
      r.replaceUrl('#/settings?x=1');
    });
    await sheetGone(page);
    await settle(page);
    hs = await histState(page);
    assert.deepStrictEqual([hs.hash, !!hs.st.__ov], ['#/settings?x=1', false]);
    assert.strictEqual(await page.evaluate(() => document.querySelector('#view .view-inner').dataset.mark), '2');

    // Toda hoja se cierra al cambiar de pantalla (aunque la vista no la cierre).
    await openMenu(page);
    await page.evaluate(async () => (await import('./js/router.js')).navigate('#/settings/week'));
    await page.waitForFunction(() => location.hash === '#/settings/week');
    await sheetGone(page);
    await settle(page);
    assert.ok(!(await histState(page)).st.__ov);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('arrastrar hacia abajo: sigue al dedo, cierra por distancia o velocidad y rebota si no llega', { skip: chromiumOnly('toques reales con CDP (Input.dispatchTouchEvent)') }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    const ts = await touchscreen(page);
    await go(page, '#/settings');

    // Desde la cabecera, lejos: se cierra (y quita su entrada de historial).
    await openMenu(page);
    let head = await page.locator('.sheet-head').boundingBox();
    await ts.start(head.x + 120, head.y + head.height / 2);
    for (let i = 1; i <= 6; i++) { await ts.move(head.x + 120, head.y + head.height / 2 + i * 25); await wait(page, 16); }
    const mid = await page.evaluate(() => ({
      y: new DOMMatrix(getComputedStyle(document.querySelector('.sheet-panel')).transform).m42,
      bg: Number(getComputedStyle(document.querySelector('.sheet-overlay'), '::before').opacity),
      card: new DOMMatrix(getComputedStyle(document.getElementById('view')).transform).a,
    }));
    assert.ok(mid.y > 100, `la hoja sigue al dedo (${mid.y})`);
    assert.ok(mid.bg < 1, 'el fondo se aclara con ella');
    assert.ok(mid.card > 0.94, `la pantalla de detrás vuelve con ella (${mid.card})`);
    await ts.end();
    await sheetGone(page);
    await settle(page);
    assert.ok(!(await histState(page)).st.__ov, 'sin entrada de la hoja');
    assert.strictEqual(await page.evaluate(() => document.documentElement.classList.contains('sheet-card')), false);

    // Poco y despacio: vuelve arriba con un rebote (sigue abierta).
    await openMenu(page);
    head = await page.locator('.sheet-head').boundingBox();
    await ts.drag(head.x + 120, head.y + 20, head.x + 120, head.y + 60, { steps: 4, ms: 40, hold: 150 });
    const peak = await page.evaluate(async () => {
      const p = document.querySelector('.sheet-panel');
      let min = Infinity;
      for (let i = 0; i < 40; i++) {
        min = Math.min(min, new DOMMatrix(getComputedStyle(p).transform).m42);
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { min, end: new DOMMatrix(getComputedStyle(p).transform).m42, open: !!document.querySelector('.sheet-overlay.open') };
    });
    assert.strictEqual(peak.open, true, 'sigue abierta');
    assert.ok(peak.min < -0.5, `rebote por encima de su sitio (${peak.min})`);
    assert.ok(Math.abs(peak.end) < 1, `y vuelve a su sitio (${peak.end})`);

    await page.keyboard.press('Escape');
    await sheetGone(page);

    // Arrastrar desde el contenido (que está arriba del todo) más de un 30 %: se cierra y no pulsa la acción.
    await openMenu(page, ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map((label) => ({ label })));
    const h = await page.evaluate(() => document.querySelector('.sheet-panel').getBoundingClientRect().height);
    let item = await page.locator('.action-item').first().boundingBox();
    await ts.drag(item.x + 60, item.y + 10, item.x + 60, item.y + 10 + h * 0.45, { steps: 6, ms: 16 });
    await sheetGone(page);
    assert.strictEqual(await page.evaluate(() => window.__picked), null, 'arrastrar no pulsa la acción');

    // Gesto rápido y corto (un 22 %): se cierra por velocidad, no por distancia. Los tiempos los marca la
    // propia página (con la batería en paralelo, los toques por CDP llegan a destiempo).
    await openMenu(page, ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map((label) => ({ label })));
    item = await page.locator('.action-item').first().boundingBox();
    await page.evaluate(({ x, y, dy }) => {
      const target = document.elementFromPoint(x, y);
      const fire = (type, yy) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: x, clientY: yy, button: type === 'pointermove' ? -1 : 0,
      }));
      const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* espera activa */ } };
      fire('pointerdown', y);
      for (let i = 1; i <= 4; i++) { spin(8); fire('pointermove', y + (dy * i) / 4); }
      fire('pointerup', y + dy);
    }, { x: item.x + 60, y: item.y + 10, dy: h * 0.22 });
    await sheetGone(page);

    // Hacia arriba desde el contenido no arrastra la hoja.
    await openMenu(page);
    const it2 = await page.locator('.action-item').last().boundingBox();
    await ts.start(it2.x + 60, it2.y + 20);
    for (let i = 1; i <= 4; i++) { await ts.move(it2.x + 60, it2.y + 20 - i * 15); await wait(page, 16); }
    const upY = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.sheet-panel')).transform).m42);
    await ts.end();
    assert.ok(Math.abs(upY) < 1, `sin mover la hoja (${upY})`);
    await page.keyboard.press('Escape');
    await sheetGone(page);
    const touchAction = await page.evaluate(async () => {
      (await import('./js/ui.js')).actionSheet({ title: 'T', actions: [{ label: 'x', onClick() {} }] });
      return [getComputedStyle(document.querySelector('.sheet-head')).touchAction, getComputedStyle(document.querySelector('.sheet-grabber')).touchAction];
    });
    assert.deepStrictEqual(touchAction, ['none', 'none'], 'asa y cabecera sin desplazamiento del navegador');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('respuesta al toque: .is-pressed tras un instante quieto, nunca al desplazar', { skip: chromiumOnly('toques reales con CDP (Input.dispatchTouchEvent)') }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    const ts = await touchscreen(page);
    await go(page, '#/settings');
    await page.evaluate(() => {
      window.__pressed = [];
      new MutationObserver((ms) => {
        for (const m of ms) if (m.target.classList && m.target.classList.contains('is-pressed')) window.__pressed.push(m.target.className);
      }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    });
    // Empezar a desplazar sobre una fila de la lista: nada se «pulsa» y la página se mueve.
    const row = page.locator('#view .list-item, #view button.card, #view .cfg-link, #view button').nth(2);
    const box = await row.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await ts.drag(x, y, x, y - 220, { steps: 6, ms: 16 });
    await wait(page, 150);
    assert.deepStrictEqual(await page.evaluate(() => window.__pressed), [], 'sin falsos positivos al desplazar');
    assert.ok(await page.evaluate(() => scrollY) > 50, 'la página se ha desplazado');
    assert.strictEqual(await page.locator('.is-pressed').count(), 0);

    // Mantener quieto: se pulsa (escala 0,97 + atenuación); al mover, se suelta.
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'hold';
      b.className = 'btn btn-secondary';
      b.textContent = 'Mantener';
      b.style.cssText = 'position:fixed;top:200px;left:20px;z-index:50';
      document.body.appendChild(b);
    });
    const hb = await page.locator('#hold').boundingBox();
    await ts.start(hb.x + 20, hb.y + 10);
    await wait(page, 200);
    const held = await page.evaluate(() => {
      const b = document.getElementById('hold');
      const cs = getComputedStyle(b);
      return { on: b.classList.contains('is-pressed'), t: cs.transform, o: Number(cs.opacity) };
    });
    assert.strictEqual(held.on, true);
    assert.match(held.t, /matrix\(0\.97/);
    assert.ok(held.o < 1);
    await ts.move(hb.x + 20, hb.y + 40);
    await wait(page, 30);
    assert.strictEqual(await page.evaluate(() => document.getElementById('hold').classList.contains('is-pressed')), false, 'se quita al mover');
    await ts.end();
    // Ya no hay reglas :active en el sistema de diseño común.
    const activeRules = await page.evaluate(() => [...document.styleSheets].filter((sh) => /app\.css/.test(sh.href || ''))
      .flatMap((sh) => [...sh.cssRules]).filter((r) => r.selectorText && r.selectorText.includes(':active')).map((r) => r.selectorText));
    assert.deepStrictEqual(activeRules, []);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('título grande → pequeño centrado en la barra al desplazar; sin textos cortados', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const measure = () => page.evaluate(() => {
      const bar = document.querySelector('#view .topbar');
      const h1 = bar.querySelector('h1');
      const r = h1.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      const back = bar.querySelector('.back-btn');
      return {
        compact: bar.classList.contains('is-compact'), fs: parseFloat(getComputedStyle(h1).fontSize),
        scale: new DOMMatrix(getComputedStyle(h1).transform).a, cx: r.left + r.width / 2, barCx: b.left + b.width / 2,
        h: r.height, left: r.left, backRight: back ? back.getBoundingClientRect().right : 0, text: h1.innerText,
        barH: b.height, n: document.querySelectorAll('.topbar h1').length,
      };
    });
    await go(page, '#/settings');
    let m = await measure();
    assert.deepStrictEqual([m.compact, m.fs, m.scale, m.n], [false, 30, 1, 1], 'pantalla raíz: título grande');
    await page.evaluate(() => window.scrollTo(0, 300));
    await wait(page, 700);
    const mc = await measure();
    assert.strictEqual(mc.compact, true);
    assert.ok(Math.abs(mc.scale - 17 / 30) < 0.01, `se encoge a ~17 px (${mc.scale})`);
    assert.ok(Math.abs(mc.cx - mc.barCx) <= 2, `centrado en la barra (${mc.cx} / ${mc.barCx})`);
    assert.strictEqual(mc.barH, m.barH, 'la cabecera no cambia de alto');
    assert.strictEqual(mc.text, 'Ajustes');
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(page, 700);
    m = await measure();
    assert.deepStrictEqual([m.compact, m.scale], [false, 1], 'arriba vuelve a ser grande');

    // Pantalla interior (con «atrás»): el título compacto queda entre el botón y el borde, sin taparlo.
    await go(page, '#/settings/data');
    await page.evaluate(() => window.scrollTo(0, 300));
    await wait(page, 700);
    m = await measure();
    assert.strictEqual(m.compact, true);
    assert.ok(m.left >= m.backRight, 'no se monta sobre el botón atrás');
    assert.strictEqual(m.text, 'Copias y datos');

    // Pantallas raíz a 390 px: ni el título ni el subtítulo se cortan.
    for (const hash of ['#/today', '#/calendar', '#/progress', '#/exercises', '#/settings']) {
      await go(page, hash);
      const cut = await page.evaluate(() => [...document.querySelectorAll('#view .topbar h1, #view .topbar-sub')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      assert.deepStrictEqual(cut, [], `${hash}: textos completos`);
    }
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('reducir movimiento: sin desplazamientos (entrada escalonada, efecto tarjeta, cápsula) ', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await go(page, '#/settings');
    const res = await staggerOnPush(page, '#/settings/data');
    assert.ok(res.length >= 1, 'hay entrada escalonada');
    assert.deepStrictEqual([...new Set(res.map((t) => t.name))], ['vt-fade-in'], 'la entrada escalonada solo funde');
    await settle(page);
    await page.evaluate(async () => { (await import('./js/ui.js')).actionSheet({ title: 'x', actions: [{ label: 'a', onClick() {} }] }); });
    await wait(page, 80);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('view')).transform), 'none', 'sin encoger la pantalla');
    await page.keyboard.press('Escape');
    await sheetGone(page);
    await page.locator('#tabbar .tab[data-tab="progress"]').click();
    await wait(page, 60);
    const pill = await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.pseudoElement === '::before' && a.animationName).map((a) => a.animationName));
    assert.deepStrictEqual(pill, [], 'la cápsula no se estira');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('fluidez: entrada escalonada solo al avanzar, cápsula líquida y capturas del cristal (390 px)', async () => {
  const app = await openGlassApp();
  const { page } = app;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, '#/settings');
    // push: los primeros bloques aparecen escalonados (≤ 6, ≤ 250 ms, opacidad + transform)
    const st = (await staggerOnPush(page, '#/settings/data')).filter((t) => t.name === 'stagger-in');
    assert.ok(st.length >= 1 && st.length <= 6, `≤ 6 bloques (${st.length})`);
    assert.ok(st.every((t) => t.end <= 250), JSON.stringify(st));
    const props = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } });
      const kf = rules.find((r) => r.type === CSSRule.KEYFRAMES_RULE && r.name === 'stagger-in');
      return kf ? [...kf.cssRules].flatMap((k) => [...k.style]) : null;
    });
    assert.ok(props && props.length && props.every((p) => p === 'opacity' || p === 'transform'), `solo opacidad y transform (${props})`);
    await settle(page);
    // pop: sin escalonado
    const popStagger = await page.evaluate(async () => {
      const r = await import('./js/router.js');
      r.back('#/settings');
      for (let i = 0; i < 100 && location.hash !== '#/settings'; i++) await new Promise((res) => setTimeout(res, 5));
      await new Promise((res) => setTimeout(res, 60));
      return !!document.querySelector('.view-stagger');
    });
    assert.strictEqual(popStagger, false, 'al volver no se repite la entrada');
    await settle(page);

    // Cápsula: se estira en la dirección del movimiento y se recoge.
    await go(page, '#/today');
    await wait(page, 300);
    await page.locator('#tabbar .tab[data-tab="settings"]').click();
    const pill = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 120));
      const bar = document.getElementById('tabbar');
      const a = document.getAnimations().find((x) => x.effect && x.effect.pseudoElement === '::before' && /pill-stretch/.test(x.animationName || ''));
      return { name: a && a.animationName, origin: bar.style.getPropertyValue('--pill-origin'), stretch: Number(bar.style.getPropertyValue('--pill-stretch')), scale: getComputedStyle(bar, '::before').scale };
    });
    assert.match(pill.name || '', /pill-stretch/);
    assert.strictEqual(pill.origin, '0% 50%', 'hacia la derecha: se estira por delante');
    assert.ok(pill.stretch > 1.3, `más estirada cuanto más lejos (${pill.stretch})`);
    await settle(page);
    await wait(page, 500);
    await shot(page, 'gestures-tabbar-pill');

    // Capturas: Hoy (arriba y desplazada, con el título compacto sobre el contenido desenfocado), hoja con
    // efecto tarjeta y aviso.
    await go(page, '#/today');
    await wait(page, 400);
    await shot(page, 'gestures-today-390');
    await page.evaluate(() => window.scrollTo(0, 260));
    await wait(page, 700);
    assert.strictEqual(await page.evaluate(() => document.querySelector('#view .topbar').classList.contains('is-compact')), true);
    await shot(page, 'gestures-today-compact-390');
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(page, 600);
    await page.evaluate(async () => {
      (await import('./js/ui.js')).actionSheet({ title: 'Registrar', actions: [
        { label: 'Carrera', icon: 'play', onClick() {} }, { label: 'Peso corporal', icon: 'scale', onClick() {} }, { label: 'Nota', icon: 'note', onClick() {} },
      ] });
    });
    await wait(page, 500);
    const card = await page.evaluate(() => ({
      a: new DOMMatrix(getComputedStyle(document.getElementById('view')).transform).a,
      clip: getComputedStyle(document.getElementById('view')).clipPath,
      top: document.querySelector('#view .topbar').getBoundingClientRect().top,
    }));
    assert.ok(Math.abs(card.a - 0.94) < 0.005, `la pantalla de detrás se encoge (${card.a})`);
    assert.match(card.clip, /round/, 'y redondea');
    assert.ok(card.top > 0 && card.top < 40, `la cabecera sigue dentro de la tarjeta (${card.top})`);
    await shot(page, 'gestures-sheet-card');
    await page.keyboard.press('Escape');
    await sheetGone(page);
    await wait(page, 100);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('view')).transform), 'none');
    await page.evaluate(async () => { (await import('./js/ui.js')).undoToast('Serie borrada', () => {}); });
    await wait(page, 600);
    const toast = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.toast'));
      return { bf: cs.backdropFilter, bg: cs.backgroundColor };
    });
    assert.match(toast.bf, /blur\(/, 'aviso de cristal');
    await shot(page, 'gestures-toast');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
