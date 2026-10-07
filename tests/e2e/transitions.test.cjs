// E2E de transiciones y efecto cristal (§7 de docs/MEJORAS.md): dirección de la animación entre pantallas
// (push / pop / tab / sin animación), una sola vista en el DOM, toques durante la animación, saltar una
// transición en curso, hojas con cierre animado, «reducir movimiento» y alternativa sin View Transitions.
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, shot, engineAvailable } = require('./helpers.cjs');

const wait = (page, ms) => page.waitForTimeout(ms);

/**
 * Navega con el router de la app (como un botón o enlace; `__app.navigate` de las pruebas no anima) y
 * devuelve, en cuanto empieza la animación, el tipo de transición y los fotogramas clave de las imágenes.
 */
async function navAndInspect(page, how, hash) {
  return page.evaluate(async ([how, hash]) => {
    const r = await import('./js/router.js');
    const from = location.hash;
    const before = r.navInfo().transition;
    if (how === 'back') r.back('#/today');
    else r.navigate(hash, how === 'tab' ? { transition: 'tab' } : {});
    // hashchange (asíncrono) → carga de la vista → startViewTransition
    const started = () => location.hash !== from && r.navInfo().transition && r.navInfo().transition !== before
      && r.navInfo().path === r.parseHash().path;
    for (let i = 0; i < 200 && !started(); i++) await new Promise((res) => setTimeout(res, 5));
    const info = r.navInfo();
    if (info.transition) await info.transition.ready.catch(() => {});
    const anims = document.getAnimations()
      .filter((a) => a.effect && a.effect.pseudoElement)
      .map((a) => ({
        pe: a.effect.pseudoElement,
        dur: a.effect.getTiming().duration,
        kf: a.effect.getKeyframes().map((k) => ({ t: k.transform || null, o: k.opacity ?? null })),
      }));
    return {
      kind: info.kind, mode: info.mode, active: info.active, nav: document.documentElement.dataset.nav || null,
      views: document.querySelectorAll('.view-inner').length, anims,
      pe: getComputedStyle(document.documentElement, '::view-transition').pointerEvents,
    };
  }, [how, hash]);
}

const anim = (res, pe) => res.anims.find((a) => a.pe === pe);
const transforms = (a) => (a ? a.kf.map((k) => k.t).filter(Boolean).join(' | ') : '');

/** Espera a que no quede ninguna transición en curso y comprueba que solo hay una vista viva. */
async function settledState(page) {
  return page.evaluate(async () => {
    const r = await import('./js/router.js');
    await r.settled();
    await new Promise((res) => setTimeout(res, 30));
    return {
      views: document.querySelectorAll('.view-inner').length,
      topbars: document.querySelectorAll('.view-inner > .topbar').length,
      nav: document.documentElement.dataset.nav || null,
      active: r.navInfo().active,
      pseudo: document.getAnimations().filter((a) => a.effect && a.effect.pseudoElement && a.effect.pseudoElement.startsWith('::view-transition')).length,
      hash: location.hash,
    };
  });
}

test('pantallas: push desde la derecha, atrás hacia la derecha, pestaña con fundido; replace sin animación; una sola vista', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/settings');
    await page.waitForSelector('.view-inner .topbar');

    // push: la nueva entra desde la derecha; la anterior se desplaza un poco a la izquierda y se atenúa
    let res = await navAndInspect(page, 'push', '#/settings/data');
    assert.strictEqual(res.kind, 'push');
    assert.strictEqual(res.mode, 'vt', 'Chromium tiene View Transitions');
    assert.strictEqual(res.nav, 'push', 'dirección en <html data-nav>');
    assert.strictEqual(res.pe, 'none', 'los toques atraviesan la animación');
    assert.strictEqual(res.views, 1, 'la vista anterior es una imagen, no otra copia en el DOM');
    assert.match(transforms(anim(res, '::view-transition-new(root)')), /translateX\(100%\)/);
    assert.match(transforms(anim(res, '::view-transition-old(root)')), /translateX\(-28%\)/);
    assert.ok(anim(res, '::view-transition-old(root)').kf.some((k) => k.o != null && Number(k.o) < 1), 'la anterior se atenúa');
    assert.ok(anim(res, '::view-transition-new(root)').dur >= 300 && anim(res, '::view-transition-new(root)').dur <= 450);
    // cabecera y barra de pestañas no se desplazan con la pantalla
    assert.strictEqual(transforms(anim(res, '::view-transition-new(topbar)')), '');
    assert.ok(!res.anims.some((a) => a.pe.includes('(tabbar)')), 'la barra de pestañas no se anima');
    let st = await settledState(page);
    assert.deepStrictEqual([st.views, st.topbars, st.nav, st.active, st.pseudo], [1, 1, null, false, 0]);
    assert.strictEqual(st.hash, '#/settings/data');

    // back: la actual sale hacia la derecha por encima; la anterior vuelve de la izquierda
    res = await navAndInspect(page, 'back');
    assert.deepStrictEqual([res.kind, res.mode, res.nav, res.views], ['pop', 'vt', 'pop', 1]);
    assert.match(transforms(anim(res, '::view-transition-old(root)')), /translateX\(100%\)/);
    assert.match(transforms(anim(res, '::view-transition-new(root)')), /translateX\(-28%\)/);
    st = await settledState(page);
    assert.deepStrictEqual([st.views, st.nav, st.active, st.hash], [1, null, false, '#/settings']);

    // atrás del navegador (sin back()): también es «pop»
    await navAndInspect(page, 'push', '#/settings/week');
    await settledState(page);
    const kind = await page.evaluate(async () => {
      const r = await import('./js/router.js');
      history.back();
      for (let i = 0; i < 100 && r.parseHash().path !== '/settings'; i++) await new Promise((res) => setTimeout(res, 5));
      await new Promise((res) => setTimeout(res, 30));
      return r.navInfo().kind;
    });
    assert.strictEqual(kind, 'pop');
    await settledState(page);

    // pestaña: fundido corto, sin desplazamiento (también al pulsar la barra de pestañas)
    res = await navAndInspect(page, 'tab', '#/progress');
    assert.deepStrictEqual([res.kind, res.mode, res.nav], ['tab', 'vt', 'tab']);
    const oldRoot = anim(res, '::view-transition-old(root)');
    assert.ok(oldRoot && oldRoot.dur <= 250, `fundido corto (${oldRoot && oldRoot.dur} ms)`);
    assert.strictEqual(transforms(oldRoot) + transforms(anim(res, '::view-transition-new(root)')), '', 'sin desplazamiento');
    await settledState(page);
    await page.locator('#tabbar .tab[data-tab="calendar"]').click();
    const tabKind = await page.evaluate(async () => {
      const r = await import('./js/router.js');
      for (let i = 0; i < 200 && r.navInfo().path !== '/calendar'; i++) await new Promise((res) => setTimeout(res, 5));
      return r.navInfo().kind;
    });
    assert.strictEqual(tabKind, 'tab', 'la barra de pestañas usa el fundido');
    await settledState(page);

    // replace y refresh: sin animación
    res = await page.evaluate(async () => {
      const r = await import('./js/router.js');
      r.navigate('#/history', { replace: true });
      // (la primera carga del módulo de la vista puede tardar con la batería en paralelo)
      for (let i = 0; i < 400 && r.navInfo().path !== '/history'; i++) await new Promise((res) => setTimeout(res, 5));
      const a = r.navInfo();
      await r.refresh();
      const b = r.navInfo();
      return { a: [a.kind, a.mode], b: [b.kind, b.mode], nav: document.documentElement.dataset.nav || null };
    });
    assert.deepStrictEqual(res, { a: ['none', 'none'], b: ['none', 'none'], nav: null });
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('«atrás» y enseguida otra pantalla: se acaba en la pedida (el paso atrás, asíncrono, ya no la deshace)', async () => {
  // Regresión (pulido): history.back() llega tarde; navegar mientras tanto acababa en la pantalla anterior a la del
  // «atrás» (aquí, Progreso en vez de Ajustes). En un iPhone lento basta con tocar una pestaña justo tras «atrás».
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/today');
    await go(page, '#/progress');
    await go(page, '#/records');
    await page.evaluate(async () => {
      const r = await import('./js/router.js');
      r.back('#/today');
      r.navigate('#/settings', { transition: 'tab' });
      await r.settled();
    });
    await page.waitForFunction(() => location.hash === '#/settings');
    await go(page, '#/settings'); // quieta
    assert.match(await page.locator('.view-inner .topbar h1').innerText(), /Ajustes/);
    // Y el historial sigue en orden: «atrás» desde Ajustes vuelve a Progreso (la pantalla a la que llevó el «atrás»)
    await page.evaluate(async () => { (await import('./js/router.js')).back('#/today'); });
    await page.waitForFunction(() => location.hash === '#/progress');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('toques durante la animación: el clic justo tras navegar llega a la pantalla nueva; otra navegación salta la transición', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/settings');
    await page.waitForSelector('.view-inner .topbar');
    // Push y, con la animación aún en marcha, pulsar «atrás» de la pantalla nueva (clic real de Playwright).
    const res = await navAndInspect(page, 'push', '#/settings/data');
    assert.strictEqual(res.active, true, 'la transición sigue en curso');
    await page.locator('.back-btn').click({ timeout: 2000 });
    await page.waitForFunction(() => location.hash === '#/settings');
    let st = await settledState(page);
    assert.deepStrictEqual([st.views, st.nav, st.active], [1, null, false]);

    // Pestaña pulsada justo después de navegar: la nueva navegación salta la transición en curso.
    await page.evaluate(async () => (await import('./js/router.js')).navigate('#/settings/week'));
    await wait(page, 40);
    await page.locator('#tabbar .tab[data-tab="today"]').click({ timeout: 2000 });
    await page.waitForFunction(() => location.hash === '#/today');
    st = await settledState(page);
    assert.deepStrictEqual([st.views, st.topbars, st.nav, st.active, st.pseudo], [1, 1, null, false, 0]);

    // Ráfaga de navegaciones: se queda la última, sin restos ni errores.
    await page.evaluate(async () => {
      const r = await import('./js/router.js');
      r.navigate('#/progress');
      await new Promise((res) => setTimeout(res, 15));
      r.navigate('#/records');
      await new Promise((res) => setTimeout(res, 15));
      r.back('#/today');
      await new Promise((res) => setTimeout(res, 15));
      r.navigate('#/settings', { transition: 'tab' });
    });
    await page.waitForFunction(() => location.hash === '#/settings');
    st = await settledState(page);
    assert.deepStrictEqual([st.views, st.topbars, st.nav, st.active, st.pseudo], [1, 1, null, false, 0]);
    assert.match(await page.locator('.view-inner .topbar h1').innerText(), /Ajustes/);

    // refresh() mientras se anima no la corta ni duplica la vista; conserva el scroll.
    await page.evaluate(async () => {
      const r = await import('./js/router.js');
      r.navigate('#/settings/data');
      await new Promise((res) => setTimeout(res, 40));
      await r.refresh();
    });
    st = await settledState(page);
    assert.deepStrictEqual([st.views, st.nav, st.hash], [1, null, '#/settings/data']);
    await page.evaluate(() => window.scrollTo(0, 300));
    await wait(page, 50);
    const y0 = await page.evaluate(() => window.scrollY);
    assert.ok(y0 > 100, `la pantalla se puede desplazar (${y0})`);
    await page.evaluate(async () => (await import('./js/router.js')).refresh());
    await wait(page, 100);
    assert.strictEqual(await page.evaluate(() => window.scrollY), y0, 'refresh() conserva el scroll');
    await page.evaluate(async () => (await import('./js/router.js')).back('#/settings'));
    await page.waitForFunction(() => location.hash === '#/settings');
    await settledState(page);
    assert.strictEqual(await page.evaluate(() => window.scrollY), 0, 'la pantalla nueva empieza arriba');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('hojas: curva de iOS al abrir y cerrar, cierre animado antes de quitarse, sin duplicados, foco de vuelta; respuesta al toque', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/today');
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'opener';
      b.textContent = 'Abrir';
      b.className = 'btn btn-secondary';
      b.style.cssText = 'position:fixed;top:120px;left:20px;z-index:50';
      document.body.appendChild(b);
      b.addEventListener('click', async () => {
        const ui = await import('./js/ui.js');
        window.__picked = null;
        ui.actionSheet({ title: 'Opciones', actions: [
          { label: 'Primera', onClick: () => { window.__picked = 'Primera'; } },
          { label: 'Segunda', onClick: () => { window.__picked = 'Segunda'; } },
        ] });
      });
    });
    await page.locator('#opener').click();
    await page.locator('.sheet-overlay.open').waitFor();
    const css = await page.evaluate(() => {
      const p = getComputedStyle(document.querySelector('.sheet-panel'));
      const bg = getComputedStyle(document.querySelector('.sheet-overlay'), '::before');
      return { dur: p.transitionDuration, ease: p.transitionTimingFunction, prop: p.transitionProperty, bgProp: bg.transitionProperty, bf: p.backdropFilter };
    });
    assert.strictEqual(css.dur, '0.35s');
    // Muelle amortiguado con linear() (o la curva de iOS donde no hay linear()): sin rebote al abrir.
    if (css.ease.startsWith('linear(')) {
      const stops = [...css.ease.matchAll(/(-?[\d.]+) [\d.]+%/g)].map((m) => Number(m[1]));
      assert.ok(stops.length >= 10 && stops[0] === 0 && stops[stops.length - 1] === 1, css.ease);
      assert.ok(stops.every((v, i) => v <= 1 && (i === 0 || v >= stops[i - 1])), 'monótono, sin pasarse');
    } else {
      assert.strictEqual(css.ease, 'cubic-bezier(0.32, 0.72, 0, 1)');
    }
    assert.strictEqual(css.prop, 'transform');
    assert.strictEqual(css.bgProp, 'opacity', 'el fondo se oscurece con un fundido');
    assert.match(css.bf, /blur\(/, 'hoja de cristal');
    await wait(page, 400);
    await shot(page, 'transitions-sheet');

    // Cerrar: sigue en el DOM mientras baja (sin toques, fuera de la accesibilidad) y luego se quita.
    await page.locator('.sheet-panel .icon-btn[aria-label="Cerrar"]').click();
    const closing = await page.evaluate(() => {
      const o = document.querySelector('.sheet-overlay');
      return o && { closing: o.classList.contains('closing'), open: o.classList.contains('open'), inert: o.inert, hidden: o.getAttribute('aria-hidden'), pe: getComputedStyle(o).pointerEvents };
    });
    assert.deepStrictEqual(closing, { closing: true, open: false, inert: true, hidden: 'true', pe: 'none' }, 'cierre animado');
    // Por condición, no a los 120 ms: mientras sigue en el DOM, la hoja baja. Solo en Chromium: WebKit sin pantalla
    // (Playwright en Linux) da fotogramas cada ~400 ms y su estilo calculado no avanza entre ellos, así que no se puede
    // ver la posición intermedia (en un iPhone de verdad, 60–120 fotogramas por segundo). Lo que sí se comprueba en
    // WebKit: que no se quita de golpe (prueba «cerrar mientras aún se abre», más abajo).
    if (app.browser.browserType().name() === 'chromium') {
      const mid = await page.waitForFunction(() => {
        const o = document.querySelector('.sheet-overlay');
        if (!o) return 'gone';
        const y = new DOMMatrix(getComputedStyle(o.querySelector('.sheet-panel')).transform).m42;
        return y > 0 ? y : false;
      }, null, { polling: 10, timeout: 2000 }).then((h) => h.jsonValue()).catch(() => null);
      assert.ok(typeof mid === 'number' && mid > 0, `a medio cerrar, la hoja va bajando (${mid})`);
    }
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 3000 });
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.id), 'opener', 'el foco vuelve al botón que la abrió');

    // Elegir una acción y abrir otra hoja mientras la primera aún baja: nunca dos menús a la vez.
    await page.locator('#opener').click();
    await page.locator('.action-item', { hasText: 'Primera' }).click();
    await page.locator('#opener').click();
    // El botón abre la hoja tras un import() (asíncrono): se cuenta cuando la nueva ya está abierta. Contar antes
    // fallaba con la máquina cargada (la vieja ya se había ido y la nueva aún no había llegado: 0).
    await page.locator('.sheet-overlay.open .action-item', { hasText: 'Segunda' }).waitFor();
    assert.strictEqual(await page.locator('.action-item', { hasText: 'Segunda' }).count(), 1, 'la hoja que se cerraba ya no está');
    await page.locator('.action-item', { hasText: 'Segunda' }).click();
    await page.waitForFunction(() => window.__picked === 'Segunda', null, { timeout: 3000 });
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 3000 });

    // confirmDialog: se resuelve al pulsar y desaparece con la animación
    const answer = page.evaluate(async () => (await import('./js/ui.js')).confirmDialog({ title: '¿Seguro?', confirmText: 'Sí' }));
    await page.locator('.sheet-overlay.open .btn-primary', { hasText: 'Sí' }).click();
    assert.strictEqual(await answer, true);
    // Condición con margen (no una pausa): en WebKit sin pantalla la transición de cierre puede arrancar tarde.
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 3000 });

    // Respuesta al toque: escala ~0,97 y atenuación en 120 ms, sin retrasar el clic
    const press = await page.evaluate(() => {
      const b = document.getElementById('opener');
      const cs = getComputedStyle(b);
      return { prop: cs.transitionProperty, dur: cs.transitionDuration };
    });
    assert.match(press.prop, /transform/);
    assert.match(press.dur, /^0\.12s/);
    const box = await page.locator('#opener').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Por condición: la escala llega tras un instante quieto y 120 ms de transición (en WebKit sin pantalla, a saltos).
    await page.waitForFunction(() => /matrix\(0\.97/.test(getComputedStyle(document.getElementById('opener')).transform), null, { timeout: 3000 }).catch(() => {});
    const pressed = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('opener')); return { t: cs.transform, o: Number(cs.opacity) }; });
    await page.mouse.up();
    assert.match(pressed.t, /matrix\(0\.97/, `escala al pulsar (${pressed.t})`);
    assert.ok(pressed.o < 1, 'se atenúa al pulsar');
    await page.locator('.sheet-overlay.open').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 3000 });

    // Aviso: un aviso nuevo sustituye al que se está ocultando (nunca dos .toast a la vez)
    await page.evaluate(async () => {
      const ui = await import('./js/ui.js');
      const t = ui.toast('Primero');
      await new Promise((r) => setTimeout(r, 300));
      t.close();
      ui.undoToast('Sesión borrada', () => {});
    });
    assert.strictEqual(await page.locator('.toast').count(), 1);
    await wait(page, 400);
    await shot(page, 'transitions-toast');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('cristal: barras, hojas y avisos con el mismo color y alternativa; captura de Hoy a 390 px', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, '#/today');
    await wait(page, 400);
    const s = await page.evaluate(() => {
      const tb = getComputedStyle(document.getElementById('tabbar'));
      const top = getComputedStyle(document.querySelector('.topbar'));
      const view = document.getElementById('view');
      const lastCard = [...view.querySelectorAll('.view-inner > .content > *')].pop();
      const r = document.getElementById('tabbar').getBoundingClientRect();
      return {
        tbBf: tb.backdropFilter, tbRadius: tb.borderRadius, topBf: top.backdropFilter, topBg: top.backgroundColor,
        tbBottom: Math.round(innerHeight - r.bottom), tbTop: Math.round(r.top),
        padBottom: parseFloat(getComputedStyle(view).paddingBottom),
        scrollMax: document.documentElement.scrollHeight - innerHeight,
        lastCard: !!lastCard,
      };
    });
    assert.match(s.tbBf, /blur\(/);
    assert.match(s.topBf, /blur\(/);
    assert.strictEqual(s.tbRadius, '999px', 'barra de pestañas en cápsula flotante');
    assert.ok(s.tbBottom >= 6, `la cápsula flota sobre el borde (${s.tbBottom}px)`);
    // Cristal más marcado (ronda 5): translúcido 65–78 % con desenfoque fuerte (el texto de debajo no se lee
    // porque el desenfoque lo impide; el Chromium de las pruebas no pinta backdrop-filter en páginas largas).
    const alpha = Number((s.topBg.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1] ?? 1);
    assert.ok(alpha >= 0.65 && alpha <= 0.78, `barra superior translúcida (${alpha})`);
    for (const bf of [s.topBf, s.tbBf]) {
      assert.ok(Number((bf.match(/blur\(([\d.]+)px\)/) || [])[1]) >= 24, `desenfoque fuerte (${bf})`);
      const sat = bf.match(/saturate\(([\d.]+)(%?)\)/) || [];
      assert.ok(Number(sat[1]) / (sat[2] ? 100 : 1) >= 1.8, `saturación (${bf})`);
    }
    // El contenido no queda tapado: al final del desplazamiento, lo último está encima de la cápsula.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await wait(page, 100);
    const covered = await page.evaluate(() => {
      const last = [...document.querySelectorAll('.view-inner > .content > *')].filter((e) => e.offsetParent).pop();
      return Math.round(last.getBoundingClientRect().bottom - document.getElementById('tabbar').getBoundingClientRect().top);
    });
    assert.ok(covered <= 0, `lo último de la pantalla no queda bajo la cápsula (${covered}px)`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(page, 100);
    await shot(page, 'transitions-today-390');

    // Sin backdrop-filter: superficies opacas con los mismos colores
    const opaque = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } });
      const sup = rules.find((r) => r.conditionText && /not/.test(r.conditionText) && /backdrop-filter/.test(r.conditionText));
      return sup ? [...sup.cssRules].map((r) => r.selectorText) : [];
    });
    for (const sel of ['.topbar', '.tabbar', '.sheet-panel']) assert.ok(opaque.includes(sel), `alternativa opaca para ${sel}`);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('reducir movimiento: sin desplazamientos (solo fundidos cortos) en pantallas, hojas y avisos', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await go(page, '#/settings');
    await page.waitForSelector('.view-inner .topbar');
    for (const [how, hash] of [['push', '#/settings/data'], ['back'], ['tab', '#/progress']]) {
      const res = await navAndInspect(page, how, hash);
      const all = res.anims.filter((a) => a.pe.startsWith('::view-transition'));
      assert.strictEqual(all.map(transforms).join(''), '', `${how}: sin desplazamiento (${JSON.stringify(all)})`);
      assert.ok(all.every((a) => a.dur <= 160), `${how}: como mucho fundidos cortos`);
      const st = await settledState(page);
      assert.strictEqual(st.views, 1);
    }
    // hoja: aparece con fundido, sin subir
    await page.evaluate(async () => { (await import('./js/ui.js')).actionSheet({ title: 'Opciones', actions: [{ label: 'Una', onClick() {} }] }); });
    await wait(page, 30);
    const sheetT = await page.evaluate(() => getComputedStyle(document.querySelector('.sheet-panel')).transform);
    assert.strictEqual(sheetT, 'none');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 1000 });
    // aviso: sin desplazamiento
    await page.evaluate(async () => { (await import('./js/ui.js')).toast('Hola'); });
    await wait(page, 30);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.toast')).transform), 'none');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('sin View Transitions (iOS 17): solo entra la vista nueva, sin clonar la anterior', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.addInitScript(() => { delete Document.prototype.startViewTransition; });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.classList.contains('ready'));
    assert.strictEqual(await page.evaluate(() => typeof document.startViewTransition), 'undefined');
    await go(page, '#/settings');
    const res = await page.evaluate(async () => {
      const r = await import('./js/router.js');
      r.navigate('#/settings/data');
      for (let i = 0; i < 100 && r.parseHash().path !== '/settings/data'; i++) await new Promise((res) => setTimeout(res, 5));
      await new Promise((res) => setTimeout(res, 30));
      const inner = document.querySelectorAll('.view-inner');
      const content = inner[0] && inner[0].querySelector(':scope > .content');
      return {
        info: [r.navInfo().kind, r.navInfo().mode], views: inner.length, cls: inner[0] && inner[0].className,
        anim: content ? content.getAnimations().map((a) => a.animationName) : [],
        topAnim: inner[0].querySelector(':scope > .topbar').getAnimations().length,
      };
    });
    assert.deepStrictEqual(res.info, ['push', 'css']);
    assert.strictEqual(res.views, 1, 'sin copia de la vista anterior');
    assert.match(res.cls, /view-enter view-enter-push/);
    assert.deepStrictEqual(res.anim, ['vt-enter-push']);
    assert.strictEqual(res.topAnim, 0, 'la cabecera no se mueve');
    await page.waitForFunction(() => !document.querySelector('.view-enter'), null, { timeout: 1500 });
    // atrás: entrada desde la izquierda; con una navegación encima se corta sin restos
    await page.evaluate(async () => {
      const r = await import('./js/router.js');
      r.back('#/settings');
      await new Promise((res) => setTimeout(res, 60));
      r.navigate('#/progress', { transition: 'tab' });
    });
    await page.waitForFunction(() => location.hash === '#/progress');
    await page.waitForFunction(() => !document.querySelector('.view-enter'), null, { timeout: 1500 });
    assert.strictEqual(await page.locator('.view-inner').count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// Regresión (WebKit, fase H): si se cerraba una hoja mientras su transición de abrir aún no había dado su
// transitionend, WebKit lo disparaba justo después de cerrar y la hoja se quitaba de golpe, sin bajar (visto en WebKit;
// Chromium cancela esa transición). El momento exacto depende de los fotogramas, así que se reproduce ese evento tal cual:
// un transitionend de transform justo después de cerrar, antes de que arranque la transición de cierre.
for (const engine of ['chromium', 'webkit']) {
  const skip = engine === 'webkit' && !engineAvailable('webkit') ? 'WebKit no instalado: ejecuta scripts/setup-webkit.sh' : false;
  test(`${engine}: un transitionend de la apertura que llega tras cerrar no quita la hoja de golpe`, { skip }, async () => {
    const app = await openApp({ browser: engine });
    const { page } = app;
    try {
      await go(page, '#/today');
      const stillThere = await page.evaluate(async () => {
        const ui = await import('./js/ui.js');
        ui.actionSheet({ title: 'Opciones', actions: [{ label: 'Primera', onClick: () => {} }] });
        const overlay = document.querySelector('.sheet-overlay');
        const panel = overlay.querySelector('.sheet-panel');
        panel.querySelector('.icon-btn[aria-label="Cerrar"]').click();
        panel.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'transform', elapsedTime: 0.35, bubbles: true }));
        await new Promise((res) => setTimeout(res, 0));
        return overlay.isConnected && overlay.classList.contains('closing');
      });
      assert.strictEqual(stillThere, true, 'sigue en el DOM, cerrándose');
      // Y se quita al terminar de bajar (o por el plazo de reserva)
      await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 3000 });
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}
