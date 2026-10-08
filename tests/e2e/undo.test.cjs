// «Deshacer» de verdad (docs/PULIDO.md §16), en la app y con los casos que fallaban:
//   · borrar un evento entrando desde Hoy y deshacer ya en Hoy → el evento vuelve a verse sin salir de la pantalla;
//   · tocar sin querer otra alternativa en la sesión (sin series hechas) → «Deshacer» deja el ítem igual que estaba;
//   · quitar un ítem de cardio con su carrera → la carrera borrada no aparece en «Otras actividades de esta sesión»;
//   · resumen → «Ver / editar sesión» → borrar → se vuelve a la pantalla de origen, no a «Esta sesión no existe»;
//   · quitar una zona del check-in → «Deshacer» la devuelve tal cual.
// 375 px, Chromium y WebKit. Datos sintéticos.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/undo.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, idbAll, settle, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const card = (page, seId) => page.locator(`[data-se="${seId}"]`);
const undo = (page) => page.locator('.toast-undo .toast-action').click();
const getSession = (page, id) => page.evaluate((sid) => JSON.parse(JSON.stringify(window.__app.store.get('sessions', sid))), id);
const newSession = (page, templateId) => page.evaluate(async (tid) => (await (await import('./js/session-logic.js')).createStrengthSession({ templateId: tid })).id, templateId);

async function raceFromToday(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    await window.__app.store.save('races', { id: 'race_u', name: 'Popular', type: '10k', date: u.addDays(u.todayStr(), 30), distanceKm: 10, targetSec: null, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1 });
  });
  await go(page, '#/today');
  const line = page.locator('.today-race, .today-race-card').first();
  await line.waitFor();
  await line.click();
  await page.waitForFunction(() => location.hash === '#/races/race_u');
  await page.locator('.rc-delete').click();
  await page.locator('.sheet-panel .btn-danger', { hasText: 'Borrar' }).click();
  await page.waitForFunction(() => location.hash === '#/today' && !document.querySelector('.today-race, .today-race-card'));
  await undo(page);
  // Sin salir de Hoy: el evento vuelve a verse
  await page.locator('.today-race, .today-race-card').first().waitFor();
  assert.strictEqual((await idbAll(page, 'races')).length, 1);
}

async function alternativeUndo(page) {
  const id = await newSession(page, 'tpl_d2');
  await go(page, `#/session/${id}`);
  let s = await getSession(page, id);
  const prensa = s.exercises.find((x) => x.exerciseId === 'prensa');
  const before = s.exercises.find((x) => x.id === prensa.id);
  await card(page, prensa.id).locator('.ses-alt-chips .chip', { hasText: 'Sentadilla hack' }).click();
  await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises.some((x) => x.exerciseId === 'hack_squat'), id);
  assert.match(await page.locator('.toast-undo').innerText(), /Cambiado a «Sentadilla hack»/);
  await undo(page);
  await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises.some((x) => x.exerciseId === 'prensa'), id);
  s = await getSession(page, id);
  assert.deepStrictEqual(s.exercises.find((x) => x.id === prensa.id), before, 'el ítem queda exactamente como estaba');
  assert.match(await card(page, prensa.id).locator('.ses-name, .ses-title, h3').first().innerText(), /Prensa/);
}

async function cardioRemove(page) {
  const id = await newSession(page, 'tpl_d3');
  const { seId } = await page.evaluate(async (sid) => {
    const st = window.__app.store;
    const ses = st.get('sessions', sid);
    const run = ses.exercises.find((x) => st.exercise(x.exerciseId)?.logType === 'cardio');
    await st.save('sessions', { id: 'act_u', kind: 'run', date: ses.date, planDate: ses.date, status: 'done', parentId: sid, parentItemId: run.id, distanceKm: 6.2, movingSec: 2100, durationMin: 35 });
    return { seId: run.id };
  }, id);
  await go(page, `#/session/${id}`);
  await card(page, seId).locator('.ses-act').waitFor();
  await card(page, seId).locator('.ses-more').click();
  await page.locator('.action-item', { hasText: 'Quitar de esta sesión' }).click();
  await page.locator('.sheet-panel button', { hasText: 'Sí, borrar también la actividad' }).click();
  await page.waitForFunction(() => !window.__app.store.get('sessions', 'act_u'));
  await page.locator('.toast-undo').waitFor();
  assert.strictEqual(await page.locator('.ses-orphans .ses-act').count(), 0, 'la carrera borrada no queda a la vista');
  await undo(page);
  await card(page, seId).locator('.ses-act').waitFor();
  assert.strictEqual(await page.locator('.ses-orphans .ses-act').count(), 0);
}

async function deleteFromSummary(page) {
  const id = await page.evaluate(async () => {
    const m = await import('./js/session-logic.js');
    const s = await m.createStrengthSession({ templateId: 'tpl_d1' });
    s.exercises[0].sets[0].weight = 60; s.exercises[0].sets[0].reps = 8; s.exercises[0].sets[0].done = true;
    m.finishSession(s, { durationMin: 50 });
    await window.__app.store.save('sessions', s);
    return s.id;
  });
  await go(page, '#/calendar');
  await go(page, `#/session/${id}`);
  await page.locator('.ses-to-summary').click();
  await page.waitForFunction((sid) => location.hash.startsWith(`#/session/${sid}/summary`), id);
  await page.locator('.ses-sum-edit').click();
  await page.waitForFunction((sid) => location.hash === `#/session/${sid}`, id);
  await page.locator('.ses-card').first().waitFor();
  await page.locator('.ses-menu-btn').click();
  await page.locator('.action-item', { hasText: 'Borrar sesión' }).click();
  await page.locator('.sheet-panel button', { hasText: 'Borrar sesión' }).click();
  await page.waitForFunction(() => location.hash.startsWith('#/calendar'));
  assert.strictEqual(await page.getByText('Esta sesión no existe').count(), 0);
  await undo(page);
  await page.waitForFunction((sid) => !!window.__app.store.get('sessions', sid), id);
}

async function checkinZone(page) {
  await go(page, '#/today');
  const ci = page.locator('.today-checkin');
  await ci.waitFor();
  const sh = page.locator('.sheet-panel.ci-area-sheet');
  const addKnee = async (lvl) => {
    await ci.locator('.ci-zone-add').click();
    await sh.waitFor();
    await sh.locator('.ci-area-kind .seg-btn', { hasText: 'Molestia o dolor' }).click();
    await sh.locator('.ci-area-joints .chip', { hasText: 'Rodilla' }).click();
    await sh.locator('.ci-area-level .chip', { hasText: new RegExp(`^${lvl}$`) }).click();
    await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
    await page.waitForSelector('.sheet-overlay', { state: 'detached' });
  };
  await addKnee(3);
  await page.waitForFunction(() => window.__app.store.all('checkins').length === 1);
  const before = JSON.parse(JSON.stringify((await idbAll(page, 'checkins'))[0]));
  // La misma zona otra vez la sustituye: se dice qué había y se puede deshacer
  await addKnee(5);
  assert.match(await page.locator('.toast-undo').innerText(), /Zona sustituida \(antes: Rodilla · molestia 3\)/);
  await undo(page);
  await page.waitForFunction(() => window.__app.store.all('checkins')[0].areas[0].level === 3);
  assert.deepStrictEqual(await ci.locator('.ci-zone').allInnerTexts(), ['Rodilla · molestia 3']);
  // Quitar la única zona borra el check-in; «Deshacer» lo devuelve exactamente igual
  await ci.locator('.ci-zone').first().click();
  await sh.waitFor();
  await sh.locator('button', { hasText: 'Quitar' }).click();
  await page.waitForFunction(() => window.__app.store.all('checkins').length === 0);
  assert.strictEqual(await ci.locator('.ci-zone').count(), 0);
  await undo(page);
  await ci.locator('.ci-zone').first().waitFor();
  await page.waitForFunction(async () => (await new Promise((res) => {
    const r = indexedDB.open('entreno');
    r.onsuccess = () => { const q = r.result.transaction('checkins').objectStore('checkins').getAll(); q.onsuccess = () => { res(q.result.length === 1 && q.result[0].areas.length === 1); r.result.close(); }; };
  })));
  const after = (await idbAll(page, 'checkins'))[0];
  assert.deepStrictEqual({ ...after, updatedAt: 0 }, { ...before, updatedAt: 0 }, 'vuelve igual (la zona con su id)');
}

/** Borrar una marca de «Tu contexto» con el disco lento y tocar Hoy enseguida: el «atrás» tardío no te devuelve. */
async function slowDiskThenLeave(page) {
  await page.evaluate(async () => {
    const C = await import('./js/context-logic.js');
    await window.__app.store.save('context', C.entryRecord({ kind: 'event', type: 'creatine_start', date: '2026-09-15' }, { id: 'ctx_u' }));
  });
  await go(page, '#/context');
  await go(page, '#/context/ctx_u');
  await page.locator('.ctx-delete').click();
  // Una transacción de escritura abierta en 'context' retiene el borrado de la app (el disco lento de un iPhone)
  // hasta que la prueba la suelta: así el borrado termina SIEMPRE después de tocar Hoy, con o sin carga.
  await page.evaluate(() => new Promise((ready) => {
    window.__holdDisk = true;
    const r = indexedDB.open('entreno');
    r.onsuccess = () => {
      const tx = r.result.transaction('context', 'readwrite');
      const spin = () => { if (window.__holdDisk) tx.objectStore('context').get('nada').onsuccess = spin; };
      spin();
      tx.oncomplete = () => r.result.close();
      ready();
    };
  }));
  await page.locator('.sheet-panel .btn-danger').click();
  await page.evaluate(() => window.__app.navigate('#/today'));
  await page.waitForFunction(() => location.hash === '#/today');
  await page.evaluate(() => { window.__holdDisk = false; });
  await page.waitForFunction(() => !window.__app.store.get('context', 'ctx_u') && document.querySelector('.toast-undo'));
  await settle(page); // un «atrás» tardío ya habría llegado (settle espera también a los «atrás» en camino)
  assert.strictEqual(await page.evaluate(() => location.hash), '#/today', 'sigue en Hoy');
  await undo(page);
  await page.waitForFunction(() => !!window.__app.store.get('context', 'ctx_u'));
}

for (const browser of ['chromium', 'webkit']) {
  test(`${browser === 'webkit' ? 'WebKit: ' : ''}«Deshacer» repinta y restaura: evento desde Hoy, alternativa, cardio, borrar desde el resumen y zona del check-in`,
    { skip: browser === 'webkit' ? skipWebkit : false }, async () => {
      const app = await openApp({ browser });
      try {
        await app.page.setViewportSize({ width: 375, height: 812 });
        await checkinZone(app.page); // primero: Hoy sin sesiones (su check-in es el de antes de entrenar)
        await raceFromToday(app.page);
        await alternativeUndo(app.page);
        await cardioRemove(app.page);
        await deleteFromSummary(app.page);
        await slowDiskThenLeave(app.page);
        assert.deepStrictEqual(app.errors, []);
      } finally {
        await app.close();
      }
    });
}
