// Modo foco (docs/PULIDO.md §18): en la pantalla de una sesión de fuerza en curso, la barra de pestañas pasa a ser la
// barra de la sesión («Hoy» · «En sesión 2/18 series» · «Terminar»). Comprueba, en Chromium y WebKit, a 375/390/430 px
// y con el texto al 100 % y al 150 %:
//   · solo en #/session/<en curso>: fuera (Hoy, Progreso, una sesión terminada) vuelven las pestañas;
//   · la barra cabe (nada se sale ni se pisa, 44 px de alto, nada por debajo de 12 px) y respeta el área segura;
//   · «+ Serie», «Registrar» y los demás controles no quedan tapados por la barra;
//   · n/N series es la misma cuenta que Hoy y se actualiza al registrar;
//   · «Hoy» sale sin cerrar la sesión (y se vuelve con «Continuar») y «Terminar» la termina.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/focus-bar.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { openApp, go, settle, idbAll, engineAvailable } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const OUT = path.join(__dirname, '..', '..', 'test-results', 'visual');
const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

const beforeLoad = (scale) => async (page) => {
  await page.context().clock.install({ time: madrid(TODAY) });
  if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('entreno.textScale', String(s)); } catch { /* */ } }, scale);
};

/** Estado de la barra de abajo: ¿modo foco?, pestañas visibles, texto de n/N y problemas de maquetación de la barra. */
function inspectBar() {
  const bar = document.getElementById('tabbar');
  const vw = innerWidth;
  const r = bar.getBoundingClientRect();
  const issues = [];
  const shown = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const fb = bar.querySelector('.focusbar');
  if (fb && shown(fb)) {
    if (r.left < 0 || r.right > vw) issues.push(`la barra se sale por un lado [${Math.round(r.left)}–${Math.round(r.right)}]`);
    if (r.bottom > innerHeight) issues.push(`la barra se sale por abajo (${Math.round(r.bottom)} > ${innerHeight})`);
    const parts = ['.fb-exit', '.fb-status', '.fb-finish'].map((s) => [s, fb.querySelector(s).getBoundingClientRect()]);
    for (const [s, p] of parts) {
      if (p.left < r.left || p.right > r.right + 0.5 || p.top < r.top || p.bottom > r.bottom + 0.5) issues.push(`${s} se sale de la barra`);
    }
    for (let i = 1; i < parts.length; i++) {
      if (parts[i][1].left < parts[i - 1][1].right - 0.5) issues.push(`${parts[i][0]} pisa a ${parts[i - 1][0]}`);
    }
    for (const b of fb.querySelectorAll('button')) {
      if (b.getBoundingClientRect().height < 43.5) issues.push(`objetivo táctil de ${Math.round(b.getBoundingClientRect().height)} px: ${b.textContent}`);
    }
    for (const el of fb.querySelectorAll('*')) {
      if (!shown(el) || el.closest('svg') || el.classList.contains('sr-only')) continue;
      const cs = getComputedStyle(el);
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own && parseFloat(cs.fontSize) < 11.9) issues.push(`texto de ${cs.fontSize}: ${el.textContent}`);
      if (el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline') issues.push(`texto que se sale de su caja: ${el.className} «${el.textContent}»`);
    }
  }
  return {
    focus: bar.classList.contains('tabbar-focus') && document.documentElement.classList.contains('focus-mode'),
    tabsVisible: [...bar.querySelectorAll('.tab')].filter(shown).length,
    label: bar.getAttribute('aria-label'),
    count: fb && shown(fb) ? fb.querySelector('.fb-count').innerText.trim() : null,
    top: r.top,
    issues,
  };
}

/** Al final de la sesión (desplazada hasta abajo): ningún control de la pantalla queda bajo la barra. */
async function controlsUncovered() {
  const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const sh = document.documentElement.scrollHeight;
    window.scrollTo(0, sh);
    await frame();
    if (sh === last && Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1) break;
    last = sh;
  }
  const barTop = document.getElementById('tabbar').getBoundingClientRect().top;
  const covered = [];
  const ctrls = [...document.querySelectorAll('#view button, #view input, #view textarea, #view a[href]')];
  for (const el of ctrls) {
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || b.bottom < 0) continue;
    if (b.bottom > barTop + 1) covered.push(`${el.className} «${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}» ${Math.round(b.bottom)} > ${Math.round(barTop)}`);
  }
  // Los últimos de la pantalla, además, se pueden tocar (nada encima): el último «+ Serie» y «Terminar sesión».
  for (const sel of ['.ses-add-set', '.ses-finish']) {
    const all = [...document.querySelectorAll(`#view ${sel}`)];
    const el = all[all.length - 1];
    if (!el) { covered.push(`no hay ${sel}`); continue; }
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (!el.contains(hit)) covered.push(`${sel} no se puede tocar (encima: ${hit && hit.className})`);
  }
  return covered;
}

const progressOf = (page, id) => page.evaluate(async (sid) => {
  const { setProgress } = await import('./js/calc.js');
  return setProgress(window.__app.store.get('sessions', sid));
}, id);

async function run(browser, scale) {
  const app = await openApp({ browser, beforeLoad: beforeLoad(scale) });
  const { page } = app;
  const tag = `focus-${browser}-${Math.round(scale * 100)}`;
  fs.mkdirSync(OUT, { recursive: true });
  try {
    const { activeId } = await seedRealistic(page, { months: 2, activeSession: true });
    const doneId = await page.evaluate(() => window.__app.store.all('sessions').find((s) => s.kind === 'strength' && s.status === 'done').id);
    const problems = [];
    for (const w of [375, 390, 430]) {
      await page.setViewportSize({ width: w, height: 844 });
      // Fuera de la sesión: pestañas
      await go(page, '#/today');
      let st = await page.evaluate(inspectBar);
      assert.deepStrictEqual([st.focus, st.tabsVisible, st.label], [false, 5, 'Secciones'], `Hoy @${w}`);
      // En la sesión en curso: la barra de la sesión
      await go(page, `#/session/${activeId}`);
      await page.waitForSelector('#tabbar .focusbar');
      await page.evaluate(() => window.scrollTo(0, 0));
      st = await page.evaluate(inspectBar);
      const p = await progressOf(page, activeId);
      assert.deepStrictEqual([st.focus, st.tabsVisible, st.label], [true, 0, 'Sesión en curso'], `sesión @${w}`);
      assert.strictEqual(st.count, scale > 1 ? `${p.done}/${p.total}` : `${p.done}/${p.total} series`, 'n/N series (con texto grande, sin la palabra)');
      assert.strictEqual(await page.locator('.topbar .ses-finish-bar, .topbar [aria-label="Terminar sesión"]').count(), 0, '«Terminar» no se repite en la cabecera');
      for (const i of st.issues) problems.push(`@${w}: ${i}`);
      await page.screenshot({ path: path.join(OUT, `${tag}-session-${w}.png`) });
      for (const c of await page.evaluate(controlsUncovered)) problems.push(`@${w} al final: ${c}`);
      await page.screenshot({ path: path.join(OUT, `${tag}-session-end-${w}.png`) });
      // Una sesión terminada (editar) y otra pantalla: pestañas
      await go(page, `#/session/${doneId}`);
      await page.waitForSelector('.ses-card');
      st = await page.evaluate(inspectBar);
      assert.deepStrictEqual([st.focus, st.tabsVisible], [false, 5], `sesión terminada @${w}`);
      await go(page, '#/progress');
      st = await page.evaluate(inspectBar);
      assert.deepStrictEqual([st.focus, st.tabsVisible], [false, 5], `Progreso @${w}`);
    }
    assert.deepStrictEqual(problems, [], problems.join('\n'));

    // Registrar una serie: n/N sube y el «Registrar» siguiente queda por encima de la barra
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE: lo más justo
    await go(page, `#/session/${activeId}`);
    await page.waitForSelector('#tabbar .focusbar');
    const before = await progressOf(page, activeId);
    await page.locator('.ses-editor[data-state="editing"] .ses-register').first().click();
    await page.waitForFunction((n) => document.querySelector('#tabbar .fb-count').textContent.startsWith(`${n}/`), before.done + 1);
    await page.waitForFunction(() => {
      const b = document.querySelector('.ses-editor[data-state="editing"] .ses-register');
      if (!b) return true;
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.bottom <= document.getElementById('tabbar').getBoundingClientRect().top + 1 && b.contains(hit);
    }, null, { timeout: 4000 });

    // «Hoy»: sale sin cerrar la sesión; Hoy la muestra con la misma cuenta y «Continuar» vuelve al modo foco
    await page.locator('#tabbar .fb-exit').click();
    await page.waitForFunction(() => location.hash === '#/today');
    await settle(page);
    let st = await page.evaluate(inspectBar);
    assert.deepStrictEqual([st.focus, st.tabsVisible], [false, 5], 'Hoy tras salir');
    assert.strictEqual((await idbAll(page, 'sessions')).find((s) => s.id === activeId).status, 'active', 'la sesión sigue abierta');
    const after = await progressOf(page, activeId);
    assert.match(await page.locator('.today-active-sub').textContent(), new RegExp(`^${after.done} de ${after.total} series`), 'Hoy cuenta lo mismo');
    await page.locator('.today-active').click();
    await page.waitForSelector('#tabbar .focusbar');
    // Atrás de la cabecera: también fuera del modo foco
    await page.locator('.topbar .back-btn').click();
    await page.waitForFunction(() => !location.hash.startsWith('#/session/'));
    await page.waitForFunction(() => !document.getElementById('tabbar').classList.contains('tabbar-focus'));
    await go(page, `#/session/${activeId}`);
    await page.waitForSelector('#tabbar .focusbar');

    // «Terminar» desde la barra: hoja, terminar, resumen con las pestañas de vuelta
    await page.locator('#tabbar .ses-finish-bar').click();
    const fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    await page.screenshot({ path: path.join(OUT, `${tag}-finish-sheet-375.png`) });
    await fin.locator('.sheet-actions .btn-primary').click();
    const diff = page.locator('.sheet-panel.ses-diff-sheet');
    await Promise.race([
      page.waitForFunction((sid) => location.hash === `#/session/${sid}/summary`, activeId),
      diff.waitFor().then(() => diff.getByRole('button', { name: 'Solo esta vez' }).click()),
    ]);
    await page.waitForFunction((sid) => location.hash === `#/session/${sid}/summary`, activeId);
    await settle(page);
    st = await page.evaluate(inspectBar);
    assert.deepStrictEqual([st.focus, st.tabsVisible, st.label], [false, 5, 'Secciones'], 'resumen: pestañas');
    assert.strictEqual((await idbAll(page, 'sessions')).find((s) => s.id === activeId).status, 'done', 'sesión terminada');
    // Volver a la sesión ya terminada (editar): sin modo foco
    await go(page, `#/session/${activeId}`);
    await page.waitForSelector('.ses-card');
    st = await page.evaluate(inspectBar);
    assert.strictEqual(st.focus, false);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('modo foco: barra de la sesión en Chromium (375/390/430, texto 100 %)', () => run('chromium', 1));
test('modo foco: barra de la sesión en Chromium con el texto al 150 %', () => run('chromium', 1.5));
test('WebKit: modo foco, barra de la sesión (375/390/430, texto 100 %)', { skip: skipWebkit }, () => run('webkit', 1));
test('WebKit: modo foco con el texto al 150 %', { skip: skipWebkit }, () => run('webkit', 1.5));
