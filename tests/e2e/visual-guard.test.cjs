// Guardas visuales estables (docs/PULIDO.md): recorre TODAS las pantallas con datos realistas (6 meses de fuerza,
// carrera, bici, peso, ciclo, objetivos, contexto, un evento y una sesión a medias) a 375 y 430 px, y también con la
// app vacía, y comprueba invariantes de maquetación que no dependen de píxeles:
//   · ningún texto roto («null», «undefined», NaN, Infinity, «[object …]», «:-5», ritmos «h:mm:ss /km»);
//   · sin scroll horizontal ni nada que se salga por los lados (salvo dentro de un carrusel);
//   · la cabecera no tapa el principio del contenido y lo último queda por encima de la barra de pestañas;
//   · ningún texto por debajo de 12 px, ninguno cortado con «…» y ningún botón por debajo de 44 px de alto;
//   · ningún error en la consola.
// Deja una captura de cada pantalla en test-results/visual/ (para mirarlas, no se comparan píxel a píxel).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/visual-guard.test.cjs  (E2E_BROWSER=webkit para WebKit)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { openApp, go, engineAvailable } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const OUT = path.join(__dirname, '..', '..', 'test-results', 'visual');
const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

/** Pantallas: [clave, hash]; `ids` da las que dependen de los datos (null → se omiten con la app vacía). */
const routes = (ids) => [
  ['today', '#/today'], ['calendar', '#/calendar'], ['day', `#/day/${ids.doneDate || TODAY}`], ['history', '#/history'],
  ids.activeId && ['session', `#/session/${ids.activeId}`], ids.done && ['summary', `#/session/${ids.done}/summary`],
  ['activity-new', '#/activity/new?kind=run'], ids.run && ['activity', `#/activity/${ids.run}`],
  ['bodyweight', '#/bodyweight'], ['exercises', '#/exercises'], ['exercise', '#/exercise/press_banca'], ['exercise-edit', '#/exercise/press_banca/edit'],
  ['templates', '#/templates'], ['template', '#/template/tpl_d1'],
  ['settings', '#/settings'], ['settings-week', '#/settings/week'], ['settings-thresholds', '#/settings/thresholds'], ['settings-data', '#/settings/data'], ['profile', '#/settings/profile'],
  ['progress', '#/progress'], ['progress-exercise', '#/progress/exercise/press_banca'], ['records', '#/records'], ['records-past', '#/records/past'], ['records-past-new', '#/records/past/new'],
  ['races', '#/races'], ['race-new', '#/races/new'], ['weekly', '#/weekly'], ['goals', '#/goals'], ['goal-new', '#/goal/new'],
  ['import', '#/import'], ['predictions', '#/predictions'], ['summary-period', '#/summary'], ['analysis', '#/analysis'],
  ids.female && ['cycle', '#/cycle'], ['context', '#/context'], ['context-new', '#/context/new?kind=event&type=race_result'],
].filter(Boolean);

/** Medición en la página (pantalla arriba del todo): devuelve la lista de problemas. */
function inspectTop() {
  const vw = innerWidth;
  const issues = [];
  const cls = (el) => String(el.className?.baseVal ?? el.className ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  const desc = (el) => `${el.tagName.toLowerCase()}${cls(el) ? `.${cls(el)}` : ''} «${(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40)}»`;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || el.closest('[hidden], [aria-hidden="true"]')) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  /** ¿Lo recorta (o lo desplaza) un antepasado con overflow? Entonces no «se sale» de la pantalla. */
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`scroll horizontal: ${document.documentElement.scrollWidth} px > ${vw}`);
  const root = document.querySelector('#view');
  for (const el of root.querySelectorAll('*')) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) issues.push(`se sale por el lado: ${desc(el)} [${Math.round(r.left)}–${Math.round(r.right)}]`);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    // Recortado con «…» (una etiqueta, una cifra, un nombre): con los datos de prueba, nada debe cortarse
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) issues.push(`texto cortado con «…»: ${desc(el)}`);
    if (own.trim()) {
      if (parseFloat(cs.fontSize) < 11.9) issues.push(`texto de ${cs.fontSize}: ${desc(el)}`);
      if (/\bnull\b|\bundefined\b|NaN|Infinity|\[object |:-\d|\d+:\d{2}:\d{2}\s?\/km/.test(own)) issues.push(`texto roto: ${desc(el)}`);
    }
    const tappable = el.matches('button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=button], [role=tab]');
    // Las zonas del mapa corporal (SVG) son regiones del dibujo, no botones: se tocan por su área
    if (tappable && r.height < 43.5 && !el.closest('svg, .why-body')) issues.push(`objetivo táctil de ${Math.round(r.width)}×${Math.round(r.height)}: ${desc(el)}`);
  }
  // La cabecera (título compacto) no tapa el primer bloque del contenido
  const top = root.querySelector('.topbar');
  const content = root.querySelector('.content');
  const first = content && [...content.children].find((c) => c.getBoundingClientRect().height > 0);
  if (top && first && first.getBoundingClientRect().top < top.getBoundingClientRect().bottom - 1) issues.push(`la cabecera tapa ${desc(first)}`);
  return [...new Set(issues)];
}

/** Al final de la pantalla: lo último visible queda por encima de la barra de pestañas (o del pie fijo). */
function inspectBottom() {
  const tab = document.querySelector('#tabbar');
  const tr = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect() : null;
  let limit = tr && tr.height ? tr.top : innerHeight;
  for (const f of document.querySelectorAll('#view *')) {
    const cs = getComputedStyle(f);
    const r = f.getBoundingClientRect();
    if (cs.position === 'fixed' && r.top > innerHeight / 2 && r.height > 20 && !f.closest('.toast')) limit = Math.min(limit, r.top);
  }
  let last = null;
  for (const el of document.querySelectorAll('#view *')) {
    if (el.children.length) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden], .sticky-foot, [class*="footer"]')) continue;
    let r = el.getBoundingClientRect();
    if (r.height < 1 || r.width < 1) continue;
    // Recortado por un antepasado (carrusel, gráfica): cuenta solo lo que se ve
    let bottom = r.bottom;
    for (let p = el.parentElement; p && p.id !== 'view'; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflowY !== 'visible' || pcs.overflowX !== 'visible') bottom = Math.min(bottom, p.getBoundingClientRect().bottom);
      if (pcs.position === 'sticky' || pcs.position === 'fixed') { bottom = -1; break; }
    }
    if (!last || bottom > last.bottom) last = { bottom, who: `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).split(' ')[0]} «${(el.textContent || '').trim().slice(0, 30)}»` };
  }
  return last && last.bottom > limit + 1 ? [`lo último (${last.who}) acaba en ${Math.round(last.bottom)} px, por debajo de la barra (${Math.round(limit)} px)`] : [];
}

/**
 * Baja hasta el final y espera a que la página deje de crecer (listas y gráficas que se pintan después): por
 * condición —la altura no cambia entre dos fotogramas y se está abajo del todo—, no por tiempo.
 */
async function scrollToEnd() {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const sh = document.documentElement.scrollHeight;
    window.scrollTo(0, sh);
    await frame();
    if (sh === last && Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1) return;
    last = sh;
  }
}

async function sweep(app, { tag, widths, ids }) {
  const { page } = app;
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 844 });
    for (const [key, hash] of routes(ids)) {
      await go(page, '#/today'); // se entra siempre desde Hoy (como en el uso real)
      await go(page, hash);
      await page.evaluate(() => window.scrollTo(0, 0));
      const top = await page.evaluate(inspectTop);
      await page.screenshot({ path: path.join(OUT, `${tag}-${key}-${w}.png`) });
      await page.evaluate(scrollToEnd);
      const bottom = await page.evaluate(inspectBottom);
      for (const p of [...top, ...bottom]) problems.push(`${key} @${w}: ${p}`);
    }
  }
  return problems;
}

async function withData(browser, tag) {
  const app = await openApp({ browser, beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
  try {
    const { activeId } = await seedRealistic(app.page, { months: 6, female: true, activeSession: true });
    const ids = await app.page.evaluate(() => {
      const ss = window.__app.store.all('sessions');
      const done = ss.filter((s) => s.status === 'done' && s.kind === 'strength').sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const run = ss.filter((s) => s.kind === 'run').sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      return { done: done.id, doneDate: done.date, run: run.id };
    });
    const problems = await sweep(app, { tag, widths: [375, 430], ids: { ...ids, activeId, female: true } });
    assert.deepStrictEqual(problems, [], problems.join('\n'));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

async function empty(browser, tag) {
  const app = await openApp({ browser, beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
  try {
    const problems = await sweep(app, { tag, widths: [375], ids: {} });
    assert.deepStrictEqual(problems, [], problems.join('\n'));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('guardas visuales con datos realistas: todas las pantallas a 375 y 430 px', () => withData('chromium', 'chromium'));
test('guardas visuales con la app vacía (estados vacíos) a 375 px', () => empty('chromium', 'chromium-vacia'));
test('WebKit: guardas visuales con datos realistas a 375 y 430 px', { skip: skipWebkit }, () => withData('webkit', 'webkit'));
test('WebKit: guardas visuales con la app vacía a 375 px', { skip: skipWebkit }, () => empty('webkit', 'webkit-vacia'));
