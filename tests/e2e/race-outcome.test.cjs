// E2E de la ronda 8, D (docs/MEJORAS.md §8): «¿Cómo te fue?» en un evento pasado. Vincular una actividad (comparación
// con el objetivo, predicción previa del motor único y récord de Récords), resultado a mano (una marca de tu contexto que
// ven Récords y Tiempos previstos), no participé, omitir (y deshacer), actividad borrada, editar el resultado a mano,
// senderismo a mano y la regresión del formulario que machacaba el resultado. Los flujos 1 y 2, también en WebKit.
// Datos sintéticos relativos a hoy: un 10K (prioridad A, objetivo <50:00) de hace 5 días.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/race-outcome.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, settle, shot, idbAll, engineAvailable, waitRoute } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

/**
 * Cuatro carreras de antes del evento (para la predicción previa), la del día del evento (10 km en 49:18) y el evento.
 * `extra(u, T, D)` → registros adicionales { sessions, races, context }.
 */
async function seed(page, { race = {}, withRaceRun = true } = {}) {
  const ids = await page.evaluate(async ({ race: over, withRaceRun: rr }) => {
    const u = await import('./js/util.js');
    const db = await import('./js/db.js');
    const T = u.todayStr();
    const D = u.addDays(T, -5);
    const run = (id, date, km, sec) => ({ id, kind: 'run', status: 'done', date, startedAt: u.tsFromDate(date, 9), createdAt: u.tsFromDate(date, 9), durationMin: sec / 60, movingSec: sec, distanceKm: km, rpe: 6 });
    const sessions = [run('run_a', u.addDays(D, -5), 10, 3150), run('run_b', u.addDays(D, -12), 8, 2560), run('run_c', u.addDays(D, -20), 10, 3200), run('run_d', u.addDays(D, -33), 9, 2900)];
    if (rr) sessions.push(run('run_race', D, 10, 2958));
    const races = [{ id: 'race_10k', name: '', type: '10k', date: D, distanceKm: 10, targetSec: 3000, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1, ...over }];
    await db.putStores({ sessions, races });
    return { T, D };
  }, { race, withRaceRun });
  await reload(page);
  return ids;
}

const card = (page) => page.locator('.rc-result');
const state = (page) => card(page).getAttribute('data-state');
const waitState = (page, s) => page.waitForFunction((x) => document.querySelector('.rc-result')?.dataset.state === x, s);
const undo = async (page) => { await page.locator('.toast button', { hasText: 'Deshacer' }).click(); };
const storedOutcome = (page) => page.evaluate(() => window.__app.store.get('races', 'race_10k').outcome ?? null);

/** 1) Pendiente: etiqueta en «Pasados», aviso en Hoy; omitir los quita; deshacer los devuelve. */
async function flowSkip(page, { shots = false } = {}) {
  await seed(page);
  await go(page, '#/races');
  assert.match((await page.locator('.rc-fold').innerText()).trim(), /^Pasados \(1\) · 1 sin resultado$/);
  await page.locator('.rc-fold').click();
  const row = page.locator('.rc-row[data-id="race_10k"]');
  assert.strictEqual((await row.locator('.rc-row-ask').innerText()).trim(), '¿Cómo te fue?');
  assert.strictEqual(await row.locator('.rc-row-pred').count(), 0, 'un evento pasado no enseña tiempo previsto');
  await go(page, '#/today');
  const line = page.locator('.today-outcome');
  assert.match((await line.innerText()).trim(), /^🏁 ¿Cómo te fue en el 10K del (lunes|martes|miércoles|jueves|viernes|sábado|domingo)\?$/);
  assert.notStrictEqual(await line.evaluate((el) => getComputedStyle(el).color), await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent')), 'neutra, sin verde');
  if (shots) { await line.scrollIntoViewIfNeeded(); await settle(page); await shot(page, 'race-outcome-today'); }
  await line.click();
  await waitRoute(page, /^#\/races\/race_10k$/);
  assert.strictEqual(await state(page), 'pending');
  assert.strictEqual(await page.locator('.rc-how').count(), 0, 'sin «Cómo vas» en un evento pasado');
  assert.deepStrictEqual(await card(page).locator('.rc-opt').evaluateAll((els) => els.map((e) => e.dataset.opt)), ['link', 'manual', 'dns', 'skip']);
  for (const h of await card(page).locator('.rc-opt').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) assert.ok(h >= 44, `fila de ${h} px`);
  if (shots) { await settle(page); await shot(page, 'race-outcome-pending'); }
  await card(page).locator('[data-opt="skip"]').click();
  await waitState(page, 'skipped');
  assert.strictEqual((await storedOutcome(page)).status, 'skipped');
  await undo(page);
  await waitState(page, 'pending');
  assert.strictEqual(await storedOutcome(page), null);
  // Omitir de nuevo: ni aviso en Hoy ni etiqueta en la lista
  await card(page).locator('[data-opt="skip"]').click();
  await waitState(page, 'skipped');
  await go(page, '#/today');
  assert.strictEqual(await page.locator('.today-outcome').count(), 0);
  await go(page, '#/races');
  assert.match((await page.locator('.rc-fold').innerText()).trim(), /^Pasados \(1\)$/);
  // En disco
  assert.strictEqual((await idbAll(page, 'races'))[0].outcome.status, 'skipped');
}

/** 2) Vincular la actividad del día: objetivo, resultado, diferencia, predicción previa y récord → Récords. */
async function flowLink(page, { shots = false } = {}) {
  await seed(page);
  await go(page, '#/races/race_10k');
  await card(page).locator('[data-opt="link"]').click();
  const cands = card(page).locator('.rc-cand');
  assert.strictEqual(await cands.first().getAttribute('data-cand'), 'run_race', 'la del mismo día, la primera');
  assert.strictEqual(await cands.count(), 1, 'solo carreras de ±1 día');
  await cands.first().click();
  await waitState(page, 'done');
  assert.deepStrictEqual(await storedOutcome(page).then((o) => ({ status: o.status, activityId: o.activityId, contextId: o.contextId, manual: o.manual })), { status: 'done', activityId: 'run_race', contextId: null, manual: null });
  const rows = card(page).locator('.rc-res-row');
  assert.deepStrictEqual(await rows.evaluateAll((els) => els.map((e) => e.dataset.row)), ['target', 'result', 'diff', 'prior']);
  assert.strictEqual(await card(page).locator('[data-row="target"] .rc-res-value').innerText(), '<50:00');
  assert.strictEqual(await card(page).locator('[data-row="result"] .rc-res-value').innerText(), '49:18');
  assert.strictEqual(await card(page).locator('[data-row="diff"] .rc-res-value').innerText(), '42 s mejor que el objetivo');
  // La predicción previa es la del motor único la víspera (mismos extremos), con su posición
  const prior = card(page).locator('[data-row="prior"]');
  const exp = await page.evaluate(async () => {
    const { priorPrediction, rangePosition } = await import('./js/races-result.js');
    const { dataFromStore } = await import('./js/progress-ui.js');
    const p = priorPrediction(dataFromStore(), window.__app.store.get('races', 'race_10k'));
    return { low: String(p.low), high: String(p.high), range: p.range, inside: rangePosition(2958, p) };
  });
  assert.deepStrictEqual(await prior.evaluate((e) => ({ low: e.dataset.low, high: e.dataset.high, inside: e.dataset.inside })), { low: exp.low, high: exp.high, inside: exp.inside });
  assert.match(await prior.locator('.rc-res-value').innerText(), new RegExp(`^${exp.range}\\n(Dentro del|Más rápido que el|Más lento que el) rango previsto · con tus datos hasta el `));
  // Récord: el mismo titular que Récords
  const pr = card(page).locator('.rc-res-pr');
  assert.strictEqual(await pr.getAttribute('data-pr'), 'current');
  assert.match(await pr.innerText(), /Tu récord en 10 km/);
  if (shots) { await card(page).scrollIntoViewIfNeeded(); await settle(page); await shot(page, 'race-outcome-done'); }
  // Lista: la línea del resultado
  await go(page, '#/races');
  await page.locator('.rc-fold').click();
  assert.strictEqual(await page.locator('.rc-row[data-id="race_10k"] .rc-row-outcome').innerText(), 'Resultado 49:18 · 42 s mejor que el objetivo');
  await page.locator('.rc-row[data-id="race_10k"]').click();
  await waitRoute(page, /^#\/races\/race_10k$/);
  await card(page).locator('.rc-res-pr').click();
  await waitRoute(page, /^#\/records/);
  assert.strictEqual(await page.locator('.prg-rec[data-sport="run"] .prg-rec-row[data-rec="10k"]').getAttribute('data-session'), 'run_race');
}

test('«¿Cómo te fue?»: aviso en Hoy y en la lista; omitir lo quita y «Deshacer» lo devuelve (375 px)', async () => {
  const app = await openApp();
  try {
    await app.page.setViewportSize({ width: 375, height: 740 });
    await flowSkip(app.page, { shots: true });
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

test('vincular la actividad del día: objetivo, resultado, «42 s mejor», predicción previa y récord', async () => {
  const app = await openApp();
  try {
    await app.page.setViewportSize({ width: 375, height: 740 });
    await flowLink(app.page, { shots: true });
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

test('WebKit: omitir y deshacer', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit' });
  try {
    await flowSkip(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

test('WebKit: vincular la actividad del día con comparación y récord', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit' });
  try {
    await flowLink(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

test('resultado a mano (carrera a pie): una marca de tu contexto que ven Récords y Tiempos previstos; «Deshacer» quita las dos cosas; editar mantiene el id', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    const { D } = await seed(page, { withRaceRun: false });
    await go(page, '#/races/race_10k');
    await card(page).locator('[data-opt="link"]').click();
    assert.match(await card(page).locator('.rc-no-cands').innerText(), /No hay actividades de ese día/);
    assert.strictEqual(await card(page).locator('[data-link="import"]').count(), 1);
    await card(page).locator('[data-opt="manual"]').click();
    const man = card(page).locator('.rc-manual');
    assert.strictEqual(await man.locator('[data-field="res-km"] input').inputValue(), '10', 'la distancia del evento, ya puesta');
    await man.locator('.rc-res-save').click();
    assert.match(await man.locator('[data-err="sec"]').innerText(), /Indica el tiempo/);
    await man.locator('[data-field="res-time"] .dur-input').nth(1).fill('49');
    await man.locator('[data-field="res-time"] .dur-input').nth(2).fill('18');
    await man.locator('[data-field="res-place"] input').fill('41');
    await man.locator('.rc-res-save').click();
    await waitState(page, 'done');
    const o = await storedOutcome(page);
    const ctx = await idbAll(page, 'context');
    assert.strictEqual(ctx.length, 1);
    assert.deepStrictEqual({ id: o.contextId, place: o.place, activityId: o.activityId, manual: o.manual }, { id: ctx[0].id, place: 41, activityId: null, manual: null });
    assert.deepStrictEqual({ type: ctx[0].type, date: ctx[0].date, km: ctx[0].result.km, sec: ctx[0].result.sec }, { type: 'race_result', date: { date: D, precision: 'day' }, km: 10, sec: 2958 });
    assert.strictEqual(await card(page).locator('[data-row="diff"] .rc-res-value').innerText(), '42 s mejor que el objetivo');
    assert.match(await card(page).locator('[data-row="result"] .rc-res-sub').innerText(), /Puesto 41/);
    // Récords y Tiempos previstos la ven (es la misma marca, sin copiarla)
    await go(page, '#/records?seg=endurance');
    assert.strictEqual(await page.locator('.prg-rec[data-sport="run"] .prg-rec-row[data-rec="10k"]').getAttribute('data-entry'), ctx[0].id);
    const used = await page.evaluate(async (id) => {
      const { analyzeRuns } = await import('./js/race-predict.js');
      const { dataFromStore } = await import('./js/progress-ui.js');
      return analyzeRuns(dataFromStore()).valid.some((e) => e.entryId === id);
    }, ctx[0].id);
    assert.ok(used, 'la marca entra en los tiempos previstos');
    await go(page, '#/predictions');
    await page.locator('.prd-races').waitFor();
    // Editar el resultado: la MISMA entrada de contexto
    await go(page, '#/races/race_10k');
    await card(page).locator('[data-act="edit"]').click();
    await card(page).locator('.rc-manual [data-field="res-time"] .dur-input').nth(2).fill('48');
    await card(page).locator('.rc-manual .rc-res-save').click();
    await waitState(page, 'done');
    assert.strictEqual(await card(page).locator('[data-row="result"]').getAttribute('data-sec'), '2988');
    // trim: WebKit añade un salto de línea final tras el hijo flex (innerText); el texto se compara entero
    assert.match((await card(page).locator('[data-row="result"] .rc-res-value').innerText()).trim(), /^49:48\nPuesto 41$/);
    assert.strictEqual(await card(page).locator('[data-row="diff"] .rc-res-value').innerText(), '12 s mejor que el objetivo');
    const ctx2 = await idbAll(page, 'context');
    assert.deepStrictEqual(ctx2.map((e) => [e.id, e.result.sec]), [[ctx[0].id, 2988]]);
    // Deshacer la edición: vuelve el tiempo anterior (misma entrada)
    await undo(page);
    await page.waitForFunction(() => document.querySelector('.rc-result [data-row="result"]')?.dataset.sec === '2958');
    // Quitar el resultado: la marca sigue en tu contexto
    await card(page).locator('[data-act="remove"]').click();
    await waitState(page, 'pending');
    await page.locator('.toast', { hasText: 'la marca sigue en tu contexto' }).waitFor();
    assert.strictEqual((await idbAll(page, 'context')).length, 1);
    await undo(page);
    await waitState(page, 'done');
    // Volver a empezar: «Cambiar» → No participé → Deshacer → el resultado a mano otra vez
    await card(page).locator('[data-act="change"]').click();
    await card(page).locator('[data-opt="dns"]').click();
    await waitState(page, 'dns');
    await undo(page);
    await waitState(page, 'done');
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

test('resultado a mano nuevo y «Deshacer»: quita el evento respondido Y la marca creada', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seed(page, { withRaceRun: false });
    await go(page, '#/races/race_10k');
    await card(page).locator('[data-opt="manual"]').click();
    const man = card(page).locator('.rc-manual');
    await man.locator('[data-field="res-time"] .dur-input').nth(1).fill('51');
    await man.locator('.rc-res-save').click();
    await waitState(page, 'done');
    assert.strictEqual(await card(page).locator('[data-row="diff"] .rc-res-value').innerText(), '1 min peor que el objetivo');
    assert.strictEqual((await idbAll(page, 'context')).length, 1);
    await undo(page);
    await waitState(page, 'pending');
    await page.waitForFunction(() => window.__app.store.all('context').length === 0);
    assert.strictEqual((await idbAll(page, 'context')).length, 0);
    assert.strictEqual(await storedOutcome(page), null);
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

test('no participé y «Deshacer»', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seed(page);
    await go(page, '#/races/race_10k');
    await card(page).locator('[data-opt="dns"]').click();
    await waitState(page, 'dns');
    assert.strictEqual(await card(page).locator('.rc-res-row').count(), 0, 'sin comparación ni predicción previa');
    await go(page, '#/races');
    await page.locator('.rc-fold').click();
    assert.strictEqual(await page.locator('.rc-row[data-id="race_10k"] .rc-row-outcome').innerText(), 'No participaste');
    await page.locator('.rc-row[data-id="race_10k"]').click();
    await waitRoute(page, /^#\/races\/race_10k$/);
    await card(page).locator('[data-act="remove"]').click();
    await waitState(page, 'pending');
    await undo(page);
    await waitState(page, 'dns');
    assert.strictEqual((await idbAll(page, 'races'))[0].outcome.status, 'dns');
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

test('actividad vinculada borrada: aviso al borrar, «El resultado ya no existe» y, al deshacer el borrado, vuelve', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seed(page, { race: { outcome: { status: 'done', activityId: 'run_race', contextId: null, manual: null, place: null, note: '', at: 1 } } });
    await go(page, '#/activity/run_race');
    await page.locator('.act-delete').click();
    const panel = page.locator('.sheet-panel').last();
    assert.match(await panel.innerText(), /Es el resultado de «10K»; el evento quedará sin resultado\./);
    await panel.locator('.btn-danger', { hasText: 'Borrar' }).click();
    await page.locator('.toast button', { hasText: 'Deshacer' }).waitFor();
    // (el evento no se toca: sigue apuntando a la actividad)
    assert.strictEqual((await storedOutcome(page)).activityId, 'run_race');
    // Se deshace desde el evento, más tarde: primero se ve que falta
    await go(page, '#/races/race_10k');
    await waitState(page, 'missing');
    assert.match(await card(page).innerText(), /El resultado ya no existe/);
    assert.deepStrictEqual(await card(page).locator('.rc-opt').evaluateAll((els) => els.map((e) => e.dataset.opt)), ['link', 'manual', 'dns']);
    await shot(page, 'race-outcome-missing');
    await page.evaluate(async () => {
      const { restore } = window.__app.store;
      await restore('sessions', { id: 'run_race', kind: 'run', status: 'done', date: window.__app.store.get('races', 'race_10k').date, durationMin: 2958 / 60, movingSec: 2958, distanceKm: 10, rpe: 6 });
    });
    await waitState(page, 'done');
    assert.strictEqual(await card(page).locator('[data-row="result"] .rc-res-value').innerText(), '49:18');
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

test('el aviso al borrar una marca de contexto vinculada; deshacer el borrado la devuelve al evento', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    const { D } = await seed(page, { withRaceRun: false });
    await page.evaluate(async (date) => {
      const C = await import('./js/context-logic.js');
      const st = window.__app.store;
      await st.save('context', C.entryRecord({ kind: 'event', type: 'race_result', date: { date, precision: 'day' }, text: '10K', notes: '', result: { km: 10, sec: 2958, effort: 'race' } }, { id: 'ctx_res' }));
      const r = st.get('races', 'race_10k');
      await st.save('races', { ...r, outcome: { status: 'done', activityId: null, contextId: 'ctx_res', manual: null, place: null, note: '', at: 1 } });
    }, D);
    await go(page, '#/context/ctx_res');
    await page.locator('.ctx-delete').click();
    const panel = page.locator('.sheet-panel').last();
    assert.match(await panel.innerText(), /Es el resultado de «10K»; el evento quedará sin resultado\./);
    await panel.locator('.btn-danger', { hasText: 'Borrar' }).click();
    await undo(page);
    await page.waitForFunction(() => window.__app.store.get('context', 'ctx_res'));
    await go(page, '#/races/race_10k');
    await waitState(page, 'done');
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

// Regresión: el formulario guardaba su copia del evento (de cuando se abrió la pantalla) y machacaba el resultado.
test('regresión: guardar el resultado y luego «Guardar cambios» del mismo formulario lo conserva', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seed(page);
    await go(page, '#/races/race_10k');
    await card(page).locator('[data-opt="link"]').click();
    await card(page).locator('.rc-cand').first().click();
    await waitState(page, 'done');
    const name = page.locator('[data-field="name"] input');
    await name.click();
    await name.fill('Carrera del barrio');
    // Mover un evento con resultado al futuro: no se puede
    const date = page.locator('.rc-date');
    const original = await date.inputValue();
    const future = await page.evaluate(async () => { const u = await import('./js/util.js'); return u.addDays(u.todayStr(), 10); });
    await date.fill(future);
    await date.dispatchEvent('change');
    await page.locator('.rc-save').click();
    assert.match(await page.locator('[data-err="date"]').innerText(), /ya tiene resultado/);
    await date.fill(original);
    await date.dispatchEvent('change');
    await page.locator('.rc-save').click();
    await page.waitForFunction(() => !location.hash.startsWith('#/races/'));
    const saved = (await idbAll(page, 'races'))[0];
    assert.strictEqual(saved.name, 'Carrera del barrio');
    assert.deepStrictEqual({ status: saved.outcome.status, activityId: saved.outcome.activityId }, { status: 'done', activityId: 'run_race' });
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});

test('senderismo a mano: sin predicción previa y sin marca nueva en tu contexto', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seed(page, { race: { type: 'hiking', name: 'Ruta de los lagos', distanceKm: 20, targetSec: null } });
    await go(page, '#/races/race_10k');
    await card(page).locator('[data-opt="link"]').click();
    assert.strictEqual(await card(page).locator('.rc-cand').count(), 0, 'una carrera a pie no es el resultado de una ruta');
    await card(page).locator('[data-opt="manual"]').click();
    const man = card(page).locator('.rc-manual');
    await man.locator('[data-field="res-time"] .dur-input').nth(0).fill('5');
    await man.locator('[data-field="res-time"] .dur-input').nth(1).fill('10');
    await man.locator('.rc-res-save').click();
    await waitState(page, 'done');
    assert.deepStrictEqual(await card(page).locator('.rc-res-row').evaluateAll((els) => els.map((e) => e.dataset.row)), ['result']);
    assert.strictEqual(await card(page).locator('[data-row="result"] .rc-res-value').innerText(), '5:10:00');
    assert.strictEqual((await idbAll(page, 'context')).length, 0);
    assert.deepStrictEqual((await storedOutcome(page)).manual, { sec: 18600, km: 20 });
    assert.deepStrictEqual(app.errors, []);
  } finally { await app.close(); }
});
