// Hoy adaptativo (docs/PULIDO.md §8): el orden depende del momento del día, sin quitar nada.
//   · Antes de entrenar: «Te toca hoy» arriba; el check-in y «Lo importante esta semana», al final.
//   · Sesión abierta que cuenta para hoy: «Sesión en curso» manda (con «En lugar de …» si no es lo planificado) y
//     «Te toca hoy» no la repite.
//   · Descanso: igual que un día de entreno; «Lo importante» va tras «Registrar» y el peso. Sin línea de fase de contexto.
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
    const order = [await top(page, '.today-plan'), await top(page, '.today-quick'), await top(page, '.bwq'), await top(page, '.today-weekcard'), await top(page, '.today-extra')];
    assert.deepStrictEqual([...order].sort((a, b) => a - b), order, `antes de entrenar: ${order}`);
    // Una fase de «Tu contexto» vigente ya no ocupa el inicio de Hoy
    await page.evaluate(async () => {
      await window.__app.store.save('context', { id: 'ctx1', kind: 'phase', type: 'gain', start: { date: '2026-09-01', precision: 'day' }, end: null, text: '', notes: '', goalIds: [], sports: [], createdAt: 1, updatedAt: 1 });
    });
    await go(page, '#/calendar');
    await go(page, '#/today');
    await ready(page);
    assert.match(await page.evaluate(async () => (await import('./js/context-logic.js')).currentLabel(window.__app.store.all('context'), '2026-10-07') || ''), /Ganancia muscular/, 'la fase existe');
    assert.strictEqual(await page.locator('.today-context').count(), 0, 'sin línea de fase en Hoy');

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
    // También en descanso: el check-in y «Lo importante» van después de «Registrar» y del peso
    assert.ok(await top(page, '.today-extra') > await top(page, '.bwq'), 'el hueco no sube en un día de descanso');
    assert.ok(await top(page, '.today-extra') > await top(page, '.today-quick'));
    assert.strictEqual(await page.locator('.today-extra .today-checkin').count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

/**
 * Ronda 10 (UX-3, §8): con el día resuelto (descanso o la rutina de hoy hecha) solo sube lo de hoy (check-in y «Lo
 * importante»); los objetivos, que son de consulta, siguen al final, debajo de «Registrar», el peso y «Esta semana».
 */
async function settledGoals(browser) {
  const app = await openApp({ browser, exampleWeek: true, beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(FRI) }); } });
  const { page } = app;
  try {
    await page.evaluate(async () => {
      await window.__app.store.save('goals', { id: 'g10k', kind: 'endurance', title: '10 km en menos de 45 min', sport: 'run', distanceKm: 10, timeSec: 2700, achievedAt: null, archived: false });
    });
    const check = async (label) => {
      await go(page, '#/calendar');
      await go(page, '#/today');
      await ready(page);
      assert.strictEqual(await page.locator('.goal-sum').count(), 1, `${label}: hay tarjeta de objetivos`);
      const y = { extra: await top(page, '.today-extra'), quick: await top(page, '.today-quick'), bwq: await top(page, '.bwq'), week: await top(page, '.today-weekcard'), goals: await top(page, '.goal-sum') };
      assert.ok(y.extra > y.quick && y.extra > y.bwq, `${label}: «Lo importante» tras «Registrar» y el peso (${JSON.stringify(y)})`);
      assert.ok(y.goals > y.extra && y.goals > y.week, `${label}: los objetivos, al final (${JSON.stringify(y)})`);
    };
    await check('descanso');
    assert.strictEqual(await page.locator('.today-plan').getAttribute('data-kind'), 'rest');
    // Jueves (Día 4) con su rutina terminada
    await page.context().clock.setSystemTime(madrid('2026-10-08'));
    await page.evaluate(async () => {
      const sl = await import('./js/session-logic.js');
      const u = await import('./js/util.js');
      const st = window.__app.store;
      const d = u.todayStr();
      const tpl = st.settings().weekPatterns[0].days[3].templateId;
      const s = await sl.createStrengthSession({ templateId: tpl, date: d, planDate: d });
      for (const se of s.exercises) for (const x of se.sets) Object.assign(x, { weight: 40, reps: 8, rir: 2, done: true, doneAt: Date.now() });
      sl.finishSession(s, { durationMin: 60, rpe: 7 });
      await st.save('sessions', s);
    });
    await check('hecho');
    assert.strictEqual(await page.locator('.today-plan').getAttribute('data-status'), 'done');
    // UX-6: el nombre de la rutina sale una vez (en el título); la fila de la sesión dice qué fue y cuánto
    const name = (await page.locator('.today-plan .today-plan-name').innerText()).trim();
    assert.match(name, /^Día \d/);
    const rows = await page.locator('.today-plan .cal-ses-row .list-item-title').allInnerTexts();
    assert.deepStrictEqual(rows.map((t) => t.trim()), ['Fuerza'], `la fila no repite «${name}»`);
    assert.match(await page.locator('.today-plan .cal-ses-row').innerText(), /series · [\d.]+ kg/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('Hoy adaptativo: antes de entrenar, evento cercano y lejano, sesión abierta que sustituye a lo planificado', () => weekday('chromium'));
test('Hoy: en un día de descanso, «Lo importante» sigue después de «Registrar» y el peso', () => restDay('chromium'));
test('WebKit: Hoy adaptativo (entre semana)', { skip: skipWebkit }, () => weekday('webkit'));
test('WebKit: Hoy adaptativo (descanso)', { skip: skipWebkit }, () => restDay('webkit'));
test('Hoy resuelto (descanso y hecho): los objetivos, al final; hecho sin repetir el nombre de la rutina', () => settledGoals('chromium'));
test('WebKit: Hoy resuelto, los objetivos al final', { skip: skipWebkit }, () => settledGoals('webkit'));
