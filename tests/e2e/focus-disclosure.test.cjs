// «Lo importante esta semana» (Hoy) y el «Resumen» de Análisis como conclusiones plegables (views/focus-item.js,
// docs/PULIDO.md §33):
//   · plegadas por defecto: icono del nivel + título + «qué hacer» a la vista; el panel, a 0 px e `inert`;
//   · toda la cabecera es el botón (≥ 44 px), con aria-expanded/aria-controls y el panel como región con nombre;
//   · tocar el título abre y vuelve a tocar cierra; Intro y Espacio desde el teclado; el chevron gira;
//   · NADA se pierde: el título, el paso y el texto (en párrafos cortos) son exactamente los de weekFocus;
//   · 375/390/430 px y texto al 100/125/150 %, Chromium y WebKit: sin desbordar ni recortar;
//   · «Reducir movimiento»: sin transición; lo abierto se recuerda al volver a Hoy;
//   · abrir y cerrar cuestan poco: layout + estilos medidos con las métricas del motor (Chromium).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/focus-disclosure.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, settle, reload, engineAvailable, chromiumOnly } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const CARD = '.today-extra .focus';

async function openToday(page) {
  await go(page, '#/today');
  await page.waitForSelector(`.today-extra[data-ready="1"] .focus`, { timeout: 15000 });
  await settle(page);
}
const settled = (page, sel) => page.waitForFunction((s) => {
  const li = document.querySelector(s);
  return li && li.classList.contains('is-settled');
}, sel);
const closedFully = (page, sel) => page.waitForFunction((s) => {
  const li = document.querySelector(s);
  return li && li.dataset.open !== '1' && li.querySelector('.focus-panel').getBoundingClientRect().height < 1;
}, sel);

/** Lo que calcula el motor para la tarjeta de Hoy (mismas entradas que focusCard). */
const expectedToday = (page) => page.evaluate(async () => {
  const { todayStr } = await import('./js/util.js');
  const { weeklyData } = await import('./js/views/weekly.js');
  const { focusWeekly } = await import('./js/views/focus.js');
  const { analysisFor } = await import('./js/views/analysis.js');
  const { keyMessages } = await import('./js/insights.js');
  const { weekFocus } = await import('./js/focus.js');
  const today = todayStr();
  const data = weeklyData(today);
  const r = focusWeekly(data);
  const a = analysisFor(today, data);
  const f = weekFocus({ weekly: r.hasHistory ? keyMessages(r, 6) : [], analysis: a.hasData ? a.keyPoints : [] });
  return f.items.map((it) => ({ id: it.id, title: it.title, step: it.stepLabel, text: it.text, hasWhy: !!(it.why && it.why.rule) }));
});

/** Estado de cada punto de la tarjeta, leído del DOM. */
const domItems = (page, root) => page.locator(`${root} .focus-item`).evaluateAll((els) => els.map((li) => {
  const t = li.querySelector('.focus-toggle');
  const p = li.querySelector('.focus-panel');
  const r = t.getBoundingClientRect();
  return {
    id: li.dataset.id,
    open: li.dataset.open === '1',
    expanded: t.getAttribute('aria-expanded'),
    controls: t.getAttribute('aria-controls') === p.id,
    labelled: p.getAttribute('role') === 'region' && p.getAttribute('aria-labelledby') === t.id,
    heading: /^H[34]$/.test(t.parentElement.tagName),
    inert: p.inert,
    panelH: p.getBoundingClientRect().height,
    toggleH: r.height,
    toggleW: r.width,
    title: li.querySelector('.focus-title').textContent,
    step: li.querySelector('.focus-step-txt').textContent,
    text: [...li.querySelectorAll('.focus-text p')].map((x) => x.textContent).join(' '),
    why: !!li.querySelector('.why-btn'),
    level: li.querySelector('.focus-toggle .sr-only').textContent,
    icon: !!li.querySelector('.focus-ico .icon'),
  };
}));

/** Nada desborda ni se recorta en la tarjeta (título y paso, siempre; el texto, abierto). */
const layoutIssues = (page, root) => page.evaluate((r) => {
  const out = [];
  const card = document.querySelector(r);
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('scroll horizontal');
  for (const el of card.querySelectorAll('.focus-title, .focus-step, .focus-item.is-settled .focus-text p')) {
    if (el.scrollWidth > el.clientWidth + 1) out.push(`recortado: ${el.textContent.slice(0, 30)}`);
    const a = el.getBoundingClientRect(); const c = card.getBoundingClientRect();
    if (a.right > c.right + 1 || a.left < c.left - 1) out.push(`fuera de la tarjeta: ${el.textContent.slice(0, 30)}`);
  }
  // El icono y el chevron no se encogen ni se montan en el título
  for (const li of card.querySelectorAll('.focus-item')) {
    const i = li.querySelector('.focus-ico').getBoundingClientRect();
    const t = li.querySelector('.focus-title').getBoundingClientRect();
    const v = li.querySelector('.focus-chev').getBoundingClientRect();
    if (i.width < 29) out.push(`icono encogido (${i.width})`);
    if (t.left < i.right + 4) out.push('título montado en el icono');
    if (v.left < t.right - 1 && v.top < t.bottom && v.bottom > t.top) out.push('chevron montado en el título');
  }
  return out;
}, root);

/** Puntos que dicen su confianza dos veces: baja en la cabecera («· confianza baja») y otra vez dentro. */
const confTwice = (page, root) => page.locator(`${root} .focus-item`).evaluateAll((els) => els
  .filter((li) => li.querySelector('.focus-low') && li.querySelector('.focus-panel [class*="state-conf-"]'))
  .map((li) => li.dataset.id));

async function flow(browser) {
  const app = await openApp({ browser });
  const { page } = app;
  try {
    await seedRealistic(page, { months: 6, female: true });
    await openToday(page);

    // 1) Plegados por defecto y con el contenido exacto del motor (nada perdido ni duplicado)
    const want = await expectedToday(page);
    let items = await domItems(page, CARD);
    assert.ok(items.length >= 1 && items.length <= 3, `1–3 puntos (${items.length})`);
    assert.deepStrictEqual(items.map((i) => i.id), want.map((w) => w.id), 'los mismos puntos, en el mismo orden');
    for (const [k, it] of items.entries()) {
      const w = want[k];
      assert.strictEqual(it.title, w.title, `${it.id}: título`);
      assert.strictEqual(it.step, w.step, `${it.id}: qué hacer`);
      assert.strictEqual(it.text, w.text, `${it.id}: el texto entero, en párrafos`);
      assert.strictEqual(it.why, w.hasWhy, `${it.id}: su «¿Por qué?»`);
      assert.ok(!it.open && it.expanded === 'false' && it.inert && it.panelH < 1, `${it.id}: plegado, a 0 px e inerte`);
      assert.ok(it.controls && it.labelled && it.heading, `${it.id}: botón en un encabezado, que controla una región con nombre`);
      assert.ok(it.icon && /^(Atención|Bien|Subir peso|Info): $/.test(it.level), `${it.id}: estado con icono y nombre (${it.level})`);
    }
    assert.deepStrictEqual(await confTwice(page, CARD), [], 'la confianza, una sola vez (Hoy)');
    // Un solo «Qué hacer» por punto (a la vista, también plegado) y ninguno repetido dentro
    assert.strictEqual(await page.locator(`${CARD} .focus-step`).count(), items.length);

    // 2) 375/390/430 px × texto 100/125/150 %: cabeceras ≥ 44 px a todo el ancho, sin desbordar ni recortar
    for (const scale of [1, 1.25, 1.5]) {
      await page.evaluate((s) => localStorage.setItem('entreno.textScale', String(s)), scale);
      await reload(page);
      await openToday(page);
      for (const width of [375, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        await settle(page);
        items = await domItems(page, CARD);
        const cardW = (await page.locator(CARD).boundingBox()).width;
        for (const it of items) {
          assert.ok(it.toggleH >= 44, `${width}px ${scale * 100} %: cabecera de ${it.toggleH} px`);
          assert.ok(it.toggleW >= cardW - 40, `${width}px ${scale * 100} %: toda la cabecera se puede tocar (${it.toggleW} de ${cardW})`);
        }
        assert.deepStrictEqual(await layoutIssues(page, CARD), [], `${width}px ${scale * 100} % plegado`);
        // Abiertos todos: tampoco
        for (const t of await page.locator(`${CARD} .focus-toggle`).all()) if (await t.getAttribute('aria-expanded') === 'false') await t.click();
        await page.waitForFunction((r) => [...document.querySelectorAll(`${r} .focus-item`)].every((e) => e.classList.contains('is-settled')), CARD);
        assert.deepStrictEqual(await layoutIssues(page, CARD), [], `${width}px ${scale * 100} % desplegado`);
        for (const t of await page.locator(`${CARD} .focus-toggle`).all()) if (await t.getAttribute('aria-expanded') === 'true') await t.click();
        await page.waitForFunction((r) => [...document.querySelectorAll(`${r} .focus-item`)].every((e) => e.dataset.open !== '1'), CARD);
      }
    }
    await page.evaluate(() => localStorage.setItem('entreno.textScale', '1'));
    await reload(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openToday(page);

    // 3) Tocar el TÍTULO (no solo el chevron) abre; el chevron gira; el contenido aparece; volver a tocar cierra
    const first = `${CARD} .focus-item:first-child`;
    await page.locator(`${first} .focus-title`).click();
    await settled(page, first);
    let st = (await domItems(page, CARD))[0];
    assert.ok(st.open && st.expanded === 'true' && !st.inert && st.panelH > 40, 'abierto: visible y accesible');
    assert.ok(await page.locator(`${first} .focus-text`).isVisible());
    // El chevron termina girado 180° (se espera a su propia transición: con la máquina cargada va con retraso)
    await page.waitForFunction((s) => {
      const m = getComputedStyle(document.querySelector(`${s} .focus-chev .icon`)).transform.match(/matrix\(([^)]+)\)/);
      if (!m) return false;
      const [a, , , d] = m[1].split(',').map(Number);
      return Math.abs(a + 1) < 0.001 && Math.abs(d + 1) < 0.001;
    }, first);
    // El «¿Por qué?» de dentro funciona y su anillo de foco no queda recortado (sin overflow al terminar de abrir)
    if (await page.locator(`${first} .why-btn`).count()) {
      await page.locator(`${first} .why-btn`).click();
      assert.ok(await page.locator(`${first} .why-body`).isVisible(), 'porqué abierto dentro del panel');
      assert.strictEqual(await page.locator(`${first} .focus-body`).evaluate((e) => getComputedStyle(e).overflow), 'visible');
    }
    await page.locator(`${first} .focus-toggle`).click();
    await closedFully(page, first);
    st = (await domItems(page, CARD))[0];
    assert.ok(!st.open && st.expanded === 'false' && st.inert, 'cerrado otra vez');

    // 4) Teclado: Intro abre, Espacio cierra; plegado, el contenido no se puede tabular (inert)
    await page.locator(`${first} .focus-toggle`).focus();
    await page.keyboard.press('Enter');
    await settled(page, first);
    assert.strictEqual(await page.locator(`${first} .focus-toggle`).getAttribute('aria-expanded'), 'true');
    await page.keyboard.press(' ');
    await closedFully(page, first);
    assert.strictEqual(await page.locator(`${first} .focus-toggle`).getAttribute('aria-expanded'), 'false');
    const tabbable = await page.evaluate((s) => {
      const p = document.querySelector(`${s} .focus-panel`);
      const b = p.querySelector('button');
      if (!b) return false;
      b.focus();
      return document.activeElement === b;
    }, first);
    assert.strictEqual(tabbable, false, 'plegado, nada del panel recibe el foco');

    // 5) Lo abierto se recuerda al volver a Hoy (un repintado no lo cierra); el principal sigue siendo el primero
    await page.locator(`${first} .focus-toggle`).click();
    await settled(page, first);
    await go(page, '#/calendar');
    await openToday(page);
    assert.strictEqual(await page.locator(`${first}`).getAttribute('data-open'), '1', 'sigue abierto al volver');
    assert.strictEqual(await page.locator(`${CARD} .focus-main`).count() + await page.locator(`${CARD} .focus-allgood`).count(), 1);

    // 6) Análisis › Resumen: mismo componente; «Ver detalle en …» lleva a su tarjeta
    await go(page, '#/analysis');
    await settle(page);
    const sum = '.an-card-summary';
    const aitems = await domItems(page, sum);
    assert.ok(aitems.length >= 1 && aitems.length <= 3);
    assert.ok(aitems.every((i) => i.expanded === 'false' && i.inert), 'plegados por defecto');
    assert.strictEqual(await page.locator(`${sum} .an-key-step`).count(), aitems.length, 'un «Qué hacer» por punto');
    assert.deepStrictEqual(await confTwice(page, sum), [], 'la confianza, una sola vez (Análisis)');
    assert.ok(await page.locator(`${sum} .focus-low`).count() >= 1, 'el escenario cubre una conclusión de confianza baja');
    const afirst = `${sum} .focus-item:first-child`;
    await page.locator(`${afirst} .focus-toggle`).click();
    await settled(page, afirst);
    const ins = await page.locator(afirst).getAttribute('data-insight');
    await page.locator(`${afirst} .focus-more`).click();
    await page.waitForFunction((id) => [...document.querySelectorAll('.an-card:not(.an-card-summary) [data-insight]')]
      .some((e) => e.dataset.insight === id && e.classList.contains('an-flash')), ins);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('plegables: contenido íntegro, abrir/cerrar, teclado, 375/390/430 × 100/125/150 % (Chromium)', () => flow('chromium'));
test('WebKit: plegables con el mismo comportamiento', { skip: skipWebkit }, () => flow('webkit'));

test('«Reducir movimiento»: abrir y cerrar sin transición; abrir y cerrar cuestan poco layout y estilo (Chromium)', { skip: chromiumOnly('métricas de rendimiento con CDP') }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seedRealistic(page, { months: 6, female: true });
    await openToday(page);
    const first = `${CARD} .focus-item:first-child`;
    // Con movimiento: la transición existe (≈ 260 ms)
    const dur = await page.locator(`${first} .focus-panel`).evaluate((e) => getComputedStyle(e).transitionDuration);
    assert.match(dur, /0\.26s/);
    // Rendimiento: se mide el TRABAJO que provoca abrir y cerrar (recuentos de layout y estilo del propio motor), no el
    // tiempo de pared: con la batería en paralelo la máquina cargada alarga cualquier tarea y eso no dice nada del
    // cambio. Medido sin carga: ~5 ms de layout y ~5 ms de estilos por apertura (≈ 22 fotogramas de 0,5 ms).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    for (const sel of [first, `${CARD} .focus-item:last-child`]) {
      const a = await metrics();
      await page.locator(`${sel} .focus-toggle`).click();
      await settled(page, sel);
      await page.locator(`${sel} .focus-toggle`).click();
      await closedFully(page, sel);
      const b = await metrics();
      // Recuentos (deterministas): como mucho un layout y un recálculo de estilos por fotograma de las dos animaciones
      // (260 ms cada una ≈ 32 fotogramas a 60 Hz) más los de los clics; nada de trabajo extra por fotograma desde JS.
      // La duración se informa en el mensaje, pero no se exige: con la batería en paralelo es tiempo de pared.
      const layouts = b.LayoutCount - a.LayoutCount;
      const styles = b.RecalcStyleCount - a.RecalcStyleCount;
      const ms = ((b.LayoutDuration - a.LayoutDuration) + (b.RecalcStyleDuration - a.RecalcStyleDuration)) * 1000;
      assert.ok(layouts <= 60 && styles <= 60, `${sel}: ${layouts} layouts y ${styles} recálculos de estilo (≤ 60; ${ms.toFixed(1)} ms)`);
    }
    // Con «Reducir movimiento»: sin transición; abre y cierra al instante
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const off = await page.locator(`${first} .focus-panel`).evaluate((e) => [getComputedStyle(e).transitionDuration, getComputedStyle(e.querySelector('.focus-body')).transitionDuration]);
    assert.ok(off.every((d) => /^0s(, 0s)*$/.test(d)), `sin transición: ${off}`);
    await page.locator(`${first} .focus-toggle`).click();
    assert.ok((await page.locator(`${first} .focus-panel`).boundingBox()).height > 40, 'abierto al instante');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
