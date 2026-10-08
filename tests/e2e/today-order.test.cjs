// Hoy adaptativo (docs/PULIDO.md §8): el orden depende del momento del día, sin quitar nada.
//   · Antes de entrenar: «Te toca hoy» arriba; el check-in y «Lo importante esta semana», al final.
//   · Sesión abierta que cuenta para hoy: «Sesión en curso» manda (con «En lugar de …» si no es lo planificado) y
//     «Te toca hoy» no la repite.
//   · Descanso: nada que empezar → el hueco de «Lo importante» sube por encima de «Registrar».
//   · Evento a 14 días o menos: tarjeta bajo «Te toca hoy»; más lejos, una línea.
// 390×844, Chromium y WebKit. Semana tipo por defecto: lunes Día 1 … miércoles Día 3 — Cardio, viernes descanso.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/today-order.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const WED = '2026-10-07';
const FRI = '2026-10-09';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const top = (page, sel) => page.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().top ?? null, sel);
const ready = (page) => page.waitForFunction(() => document.querySelector('.today-extra')?.dataset.ready === '1');
const addRace = (page, id, date) => page.evaluate(async ([i, d]) => {
  await window.__app.store.save('races', { id: i, name: '', type: '10k', date: d, distanceKm: 10, targetSec: 2700, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1 });
}, [id, date]);

async function weekday(browser) {
  const app = await openApp({ browser, exampleWeek: true, beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(WED) }); } });
  const { page } = app;
  try {
    // --- Antes de entrenar: «Te toca hoy» → Registrar → Esta semana → (check-in, lo importante) ---
    await go(page, '#/today');
    await ready(page);
    assert.match(await page.locator('.today-plan .today-plan-name').innerText(), /Día 3/);
    const order = [await top(page, '.today-plan'), await top(page, '.today-quick'), await top(page, '.today-weekcard'), await top(page, '.today-extra')];
    assert.deepStrictEqual([...order].sort((a, b) => a - b), order, `antes de entrenar: ${order}`);

    // --- Evento lejano (40 días): una línea; a 5 días: tarjeta justo debajo de «Te toca hoy» ---
    await addRace(page, 'far', '2026-11-16');
    await go(page, '#/calendar');
    await go(page, '#/today');
    assert.strictEqual(await page.locator('.today-race').count(), 1);
    assert.strictEqual(await page.locator('.today-race-card').count(), 0);
    await page.evaluate(async () => { await window.__app.store.remove('races', 'far'); });
    await addRace(page, 'near', '2026-10-12');
    await go(page, '#/calendar');
    await go(page, '#/today');
    const card = page.locator('.today-race-card');
    assert.strictEqual(await card.count(), 1);
    assert.strictEqual(await page.locator('.today-race').count(), 0, 'no se repite como línea');
    assert.match(await card.locator('.today-race-title').innerText(), /^10K · En 5 días$/);
    assert.match(await card.locator('.today-race-sub').innerText(), /objetivo <45:00/);
    assert.strictEqual(await page.evaluate(() => document.querySelector('.today-plan').nextElementSibling?.classList.contains('today-race-card')), true);
    assert.ok((await card.boundingBox()).height >= 44);

    // --- Sesión del Día 1 abierta hoy (sustituye al Día 3): manda, dice qué sustituye y «Te toca hoy» no la repite ---
    await page.evaluate(async (d) => {
      const sl = await import('./js/session-logic.js');
      await sl.createStrengthSession({ templateId: 'tpl_d1', date: d, planDate: d });
    }, WED);
    await go(page, '#/calendar');
    await go(page, '#/today');
    await ready(page);
    const live = page.locator('.today-active');
    assert.strictEqual(await live.getAttribute('data-live'), '1');
    assert.strictEqual(await live.locator('.today-active-name').innerText(), 'Día 1 — Upper pesado');
    assert.match(await live.locator('.today-active-sub').innerText(), /^0 de \d+ series · En lugar de Día 3 — Cardio$/);
    assert.strictEqual(await page.locator('.today-plan').count(), 0, '«Te toca hoy» no repite la sesión');
    // Lo primero (tras el aviso compacto de copia de seguridad, si lo hay)
    assert.strictEqual(await page.evaluate(() => [...document.querySelector('#view .content').children].find((e) => !e.classList.contains('today-backup'))?.classList.contains('today-active')), true, 'lo primero');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

async function restDay(browser) {
  const app = await openApp({ browser, exampleWeek: true, beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(FRI) }); } });
  const { page } = app;
  try {
    await go(page, '#/today');
    await ready(page);
    assert.strictEqual(await page.locator('.today-plan').getAttribute('data-kind'), 'rest');
    // Nada que empezar: el check-in (y, con datos, «Lo importante esta semana») antes de «Registrar»
    assert.ok(await top(page, '.today-extra') < await top(page, '.today-quick'), 'el hueco sube en un día de descanso');
    assert.strictEqual(await page.locator('.today-extra .today-checkin').count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('Hoy adaptativo: antes de entrenar, evento cercano y lejano, sesión abierta que sustituye a lo planificado', () => weekday('chromium'));
test('Hoy adaptativo: en un día de descanso, «Lo importante» sube por encima de «Registrar»', () => restDay('chromium'));
test('WebKit: Hoy adaptativo (entre semana)', { skip: skipWebkit }, () => weekday('webkit'));
test('WebKit: Hoy adaptativo (descanso)', { skip: skipWebkit }, () => restDay('webkit'));
