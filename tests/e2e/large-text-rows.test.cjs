// Regresión (revisión del bloque A, ronda 8): con texto grande, las filas de lista pasan la cifra de la derecha a otra
// línea antes que partir una palabra (css/app.css, html.text-large .list-item). La primera versión lo hacía con
// `min-width: min-content` en .list-item-main, que nunca encoge por debajo de su palabra más larga: un nombre con una
// palabra más ancha que la fila («Euskalherriamaratoia», un evento) empujaba el texto fuera de la fila (se cortaba
// por la derecha). Ahora la base del texto es su palabra más larga, pero nunca más que la fila.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/large-text-rows.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado';

async function run(browser) {
  const app = await openApp({ browser, beforeLoad: async (p) => { await p.evaluate(() => localStorage.setItem('entreno.textScale', '1.5')); } });
  const { page } = app;
  try {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.evaluate(async () => {
      const u = await import('./js/util.js');
      const base = { type: 'custom', distanceKm: 12, targetSec: null, priority: 'B', note: '', goalId: null, createdAt: 1, updatedAt: 1 };
      await window.__app.store.save('races', { ...base, id: 'r_long', name: 'Euskalherriamaratoiaren lasterketa', date: u.addDays(u.todayStr(), 30) });
      await window.__app.store.save('races', { ...base, id: 'r_short', name: 'Carrera popular', date: u.addDays(u.todayStr(), 40) });
    });
    await go(page, '#/races');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('text-large')));
    const rows = await page.evaluate(() => [...document.querySelectorAll('.rc-row')].map((row) => {
      const r = row.getBoundingClientRect();
      const main = row.querySelector('.list-item-main').getBoundingClientRect();
      const title = row.querySelector('.rc-row-title');
      return { id: row.dataset.id, rowRight: r.right, mainRight: main.right, overflow: row.scrollWidth - row.clientWidth, titleLines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)) };
    }));
    assert.strictEqual(rows.length, 2);
    for (const r of rows) {
      assert.ok(r.mainRight <= r.rowRight + 0.5, `${r.id}: el texto se sale de la fila (${r.mainRight} > ${r.rowRight})`);
      assert.ok(r.overflow <= 1, `${r.id}: la fila desborda ${r.overflow} px`);
    }
    assert.ok(rows.find((r) => r.id === 'r_long').titleLines >= 2, 'el nombre largo ocupa más líneas en vez de salirse');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sin scroll horizontal');
    // Biblioteca: un ejercicio propio con un nombre de una sola palabra más ancha que la fila (la lista recorta lo
    // que sobresale: sin scroll horizontal, pero el nombre quedaba cortado; se mide el texto, no su caja)
    await page.evaluate(async () => {
      const ex = { ...window.__app.store.exercise('press_banca'), id: 'ex_long', name: 'Pressdebancaconagarrecerradoymancuernas', custom: true, archived: false };
      await window.__app.store.save('exercises', ex);
    });
    await go(page, '#/exercises?seg=library');
    const lib = await page.evaluate(() => {
      const name = [...document.querySelectorAll('.lib-ex-name')].find((n) => n.textContent.includes('Pressdebanca'));
      const row = name.closest('button, a, li, .list-item');
      return { nameRight: name.firstElementChild.getBoundingClientRect().right, rowRight: row.getBoundingClientRect().right, sw: document.documentElement.scrollWidth };
    });
    assert.ok(lib.nameRight <= lib.rowRight + 0.5, `biblioteca: el nombre se sale de la fila (${lib.nameRight} > ${lib.rowRight})`);
    assert.ok(lib.sw <= 375 + 1, 'biblioteca sin scroll horizontal');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

/**
 * Regresión (ronda 8, B2): con texto grande el subtítulo de la cabecera se parte en dos líneas; al compactarse se
 * ensanchaba hasta caber en una, la cabecera perdía una línea de alto y, con el anclaje del scroll, la página volvía
 * arriba, la cabecera crecía, bajaba otra vez… sin fin (en la bienvenida, «Saltar» nunca dejaba de moverse).
 */
async function compactHeader(browser) {
  const app = await openApp({ browser, beforeLoad: async (p) => { await p.evaluate(() => localStorage.setItem('entreno.textScale', '1.5')); } });
  const { page } = app;
  try {
    await page.setViewportSize({ width: 375, height: 844 });
    await go(page, '#/welcome');
    const measure = () => page.evaluate(() => {
      const bar = document.querySelector('#view .topbar');
      return { bar: bar.offsetHeight, sub: bar.querySelector('.topbar-sub').offsetHeight, page: document.documentElement.scrollHeight };
    });
    const big = await measure();
    assert.ok(big.sub > 30, `el subtítulo ocupa dos líneas al 150 % (${big.sub} px)`);
    await page.evaluate(() => window.scrollTo(0, 60));
    await page.waitForFunction(() => document.querySelector('#view .topbar').classList.contains('is-compact'));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.deepStrictEqual(await measure(), big, 'la cabecera compacta mide lo mismo (no cambia el alto de la página)');
    assert.ok(await page.evaluate(() => document.querySelector('#view .topbar').classList.contains('is-compact')), 'y se queda compacta');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('texto al 150 %: una palabra más ancha que la fila no saca el texto de la fila', () => run('chromium'));
test('WebKit: texto al 150 %, palabra más ancha que la fila', { skip: skipWebkit }, () => run('webkit'));
test('texto al 150 %: la cabecera no cambia de alto al compactarse (subtítulo en dos líneas)', () => compactHeader('chromium'));
test('WebKit: texto al 150 %, la cabecera no cambia de alto al compactarse', { skip: skipWebkit }, () => compactHeader('webkit'));
