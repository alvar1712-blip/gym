// E2E del check-in ampliado (ronda 6, fase B; docs/MEJORAS6.md): estrés y agujetas o molestias por zona (0–10, opcional)
// en Hoy, el check-in en el día del calendario (añadir y editar también días pasados) y que los check-ins antiguos
// (sin estrés ni zonas) se siguen viendo y editando. La misma ruta de zonas se repite en WebKit (motor de Safari) si
// está instalado. La fecha se fija con el reloj de Playwright (jueves 24 sep 2026, 18:00 en Madrid).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/checkin-zones.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const playwright = require('playwright');
const { waitReady, go, reload, idbAll, settle, shot, engineAvailable } = require('./helpers.cjs');

const TODAY = '2026-09-24';
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

async function launch({ width = 390, height = 844, browser: name = 'chromium' } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await playwright[name].launch();
  const context = await browser.newContext({
    ...playwright.devices['iPhone 13'], viewport: { width, height }, locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block',
  });
  await context.clock.install({ time: madrid(TODAY) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(server.url);
  await waitReady(page);
  return { browser, context, page, errors, close: async () => { await browser.close(); await server.close(); } };
}

const pick = (root, field, label) => root.locator(`.ci-row[data-field="${field}"] .seg-btn`, { hasText: new RegExp(`^${label}$`) });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const areaSheet = (page) => page.locator('.sheet-panel.ci-area-sheet');
const chipsOf = (root) => root.locator('.ci-zone').allInnerTexts();
/** Los check-ins en disco, sin las marcas de tiempo ni los ids generados. */
async function disk(page) {
  return (await idbAll(page, 'checkins')).sort((a, b) => (a.date + a.timing < b.date + b.timing ? -1 : 1));
}
const plainAreas = (c) => (c.areas || []).map(({ kind, zone, side, level, note }) => ({ kind, zone, side, level, note }));

/** Abre la hoja de zona desde un bloque de check-in y espera a que esté quieta (el mapa se carga al abrirla). */
async function openAreaSheet(page, root, { add = true, chip = null } = {}) {
  if (chip) await root.locator('.ci-zone', { hasText: chip }).click();
  else await root.locator('.ci-zone-add').click();
  const sh = areaSheet(page);
  await sh.waitFor();
  await settle(page);
  return sh;
}
/** Toca un músculo del mapa (evento directo: el centro de la caja puede caer en otra zona). */
async function tapMuscle(sh, id) {
  await sh.locator(`.bm-zone[data-muscle="${id}"]`).first().dispatchEvent('click');
}
async function closeSheet(page) {
  await page.waitForSelector('.sheet-overlay', { state: 'detached' });
  await settle(page);
}

/** El recorrido de zonas en la tarjeta de Hoy (compartido por Chromium y WebKit). */
async function zonesFlow(page, { shots = false } = {}) {
  await go(page, '#/today');
  const ci = page.locator('.today-checkin');
  await ci.waitFor();
  await ci.scrollIntoViewIfNeeded();
  assert.deepStrictEqual(await ci.locator('.ci-label').allInnerTexts(), ['Sueño', 'Energía', 'Estrés', 'Agujetas']);
  assert.match(await ci.locator('.ci-zones-head').innerText(), /Agujetas o molestias por zona\s*Opcional/);
  assert.strictEqual(await ci.locator('.ci-zone').count(), 0);
  assert.strictEqual(await ci.locator('.ci-zone-add').innerText(), 'Añadir zona');

  // 1) Agujetas en un músculo: el mapa corporal, sin leyenda de series, con lo elegido debajo
  let sh = await openAreaSheet(page, ci);
  assert.strictEqual(await sh.locator('.sheet-title').innerText(), 'Agujetas o molestia');
  assert.deepStrictEqual(await sh.locator('.ci-area-kind .seg-btn').allInnerTexts(), ['Agujetas', 'Molestia o dolor']);
  assert.strictEqual(await sh.locator('.ci-area-kind .seg-btn.active').innerText(), 'Agujetas');
  assert.strictEqual(await sh.locator('.bm.bm-pick').count(), 1, 'mapa en modo elegir');
  assert.strictEqual(await sh.locator('.bm-legend').count(), 0, 'sin la leyenda de series');
  assert.match(await sh.locator('.bm-detail').innerText(), /Toca el músculo con agujetas/);
  // sin músculo ni intensidad no se guarda nada, y se dice por qué
  await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
  assert.strictEqual(await sh.locator('.ci-area-err').innerText(), 'Toca el músculo en el mapa.');
  await tapMuscle(sh, 'hamstrings');
  assert.strictEqual(await sh.locator('.bm-detail-name').innerText(), 'Isquiotibiales');
  assert.strictEqual(await sh.locator('.bm-zone[data-muscle="hamstrings"]').first().getAttribute('aria-pressed'), 'true');
  await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
  assert.strictEqual(await sh.locator('.ci-area-err').innerText(), 'Elige la intensidad (0–10).');
  assert.deepStrictEqual(await disk(page), [], 'nada guardado aún');
  assert.deepStrictEqual(await sh.locator('.ci-area-level .chip').allInnerTexts(), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.deepStrictEqual(await sh.locator('.ci-area-side .chip').allInnerTexts(), ['Izquierda', 'Derecha', 'Ambos lados']);
  for (const b of await sh.locator('.ci-area-kind .seg-btn, .ci-area-side .chip, .ci-area-level .chip, .sheet-actions button').all()) {
    assert.ok((await b.boundingBox()).height >= 44, 'botones de la hoja ≥ 44 px');
  }
  await sh.locator('.ci-area-side .chip', { hasText: 'Izquierda' }).click();
  await sh.locator('.ci-area-level .chip', { hasText: /^7$/ }).click();
  await sh.locator('input[aria-label="Nota"]').fill('tras el peso muerto rumano');
  if (shots) await shot(page, 'checkin-zone-muscle');
  await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
  await closeSheet(page);
  let d = await disk(page);
  assert.strictEqual(d.length, 1, 'una zona sola ya crea el check-in de ese día');
  assert.deepStrictEqual([d[0].date, d[0].timing, d[0].sessionId, d[0].sleep, d[0].energy, d[0].stress, d[0].soreness], [TODAY, 'pre', null, null, null, null, null]);
  assert.deepStrictEqual(plainAreas(d[0]), [{ kind: 'muscle', zone: 'hamstrings', side: 'left', level: 7, note: 'tras el peso muerto rumano' }]);
  assert.match(d[0].areas[0].id, /^ar_/);
  const hamId = d[0].areas[0].id;
  assert.deepStrictEqual(await chipsOf(ci), ['Isquiotibiales izq. · 7']);
  assert.match(await ci.locator('.ci-zone').getAttribute('class'), /ci-band-high/);
  assert.strictEqual(await ci.locator('.ci-zone-add').innerText(), 'Otra zona');
  assert.strictEqual(await ci.locator('.ci-skip').isHidden(), true, 'con algo apuntado, nada que omitir');

  // 2) Molestia en una articulación: sin mapa, la lista de articulaciones
  sh = await openAreaSheet(page, ci);
  await sh.locator('.ci-area-kind .seg-btn', { hasText: 'Molestia o dolor' }).click();
  assert.strictEqual(await sh.locator('.bm').count(), 0, 'sin mapa');
  assert.deepStrictEqual(await sh.locator('.ci-area-joints .chip').allInnerTexts(),
    ['Cuello', 'Hombro', 'Codo', 'Muñeca', 'Zona lumbar', 'Cadera', 'Rodilla', 'Tobillo', 'Pie', 'Otra zona']);
  await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
  assert.strictEqual(await sh.locator('.ci-area-err').innerText(), 'Elige la zona.');
  await sh.locator('.ci-area-joints .chip', { hasText: 'Rodilla' }).click();
  await sh.locator('.ci-area-level .chip', { hasText: /^3$/ }).click();
  if (shots) await shot(page, 'checkin-zone-joint');
  await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
  await closeSheet(page);
  d = await disk(page);
  assert.deepStrictEqual(plainAreas(d[0]).map((a) => [a.kind, a.zone, a.side, a.level]), [['muscle', 'hamstrings', 'left', 7], ['joint', 'knee', null, 3]]);
  assert.deepStrictEqual(await chipsOf(ci), ['Isquiotibiales izq. · 7', 'Rodilla · molestia 3']);

  // 3) El mismo músculo y lado otra vez: lo sustituye (una zona por músculo y lado); el mapa marca lo apuntado
  sh = await openAreaSheet(page, ci);
  assert.strictEqual(await sh.locator('.bm-zone[data-muscle="hamstrings"]').first().getAttribute('data-mark'), 'high');
  assert.strictEqual(await sh.locator('.bm-zone[data-muscle="quads"]').first().getAttribute('data-mark'), '', 'sin apuntar, sin marca');
  await tapMuscle(sh, 'hamstrings');
  await sh.locator('.ci-area-side .chip', { hasText: 'Izquierda' }).click();
  await sh.locator('.ci-area-level .chip', { hasText: /^4$/ }).click();
  await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
  await closeSheet(page);
  d = await disk(page);
  assert.deepStrictEqual(plainAreas(d[0]).map((a) => [a.zone, a.level]), [['knee', 3], ['hamstrings', 4]]);
  assert.deepStrictEqual((await chipsOf(ci)).sort(), ['Isquiotibiales izq. · 4', 'Rodilla · molestia 3']);

  // 4) Editar tocando la ficha: la misma zona (mismo id), con lo elegido marcado
  sh = await openAreaSheet(page, ci, { chip: 'Rodilla' });
  assert.strictEqual(await sh.locator('.sheet-title').innerText(), 'Editar zona');
  assert.strictEqual(await sh.locator('.ci-area-kind .seg-btn.active').innerText(), 'Molestia o dolor');
  assert.strictEqual(await sh.locator('.ci-area-joints .chip.active').innerText(), 'Rodilla');
  assert.strictEqual(await sh.locator('.ci-area-level .chip.active').innerText(), '3');
  const kneeId = d[0].areas.find((a) => a.zone === 'knee').id;
  await sh.locator('.ci-area-side .chip', { hasText: 'Derecha' }).click();
  await sh.locator('.ci-area-level .chip', { hasText: /^5$/ }).click();
  await sh.locator('.sheet-actions button', { hasText: 'Guardar' }).click();
  await closeSheet(page);
  d = await disk(page);
  const knee = d[0].areas.find((a) => a.zone === 'knee');
  assert.deepStrictEqual([knee.id, knee.side, knee.level], [kneeId, 'right', 5], 'se edita la misma');
  assert.strictEqual(d[0].areas.length, 2);
  assert.ok(d[0].areas.every((a) => a.id !== hamId), 'la de antes se sustituyó');

  // 5) Las cuatro preguntas siguen igual, junto a las zonas
  await pick(ci, 'sleep', 'Normal').click();
  await pick(ci, 'stress', 'Alto').click();
  d = await disk(page);
  assert.deepStrictEqual([d[0].sleep, d[0].energy, d[0].stress, d[0].soreness, d[0].areas.length], [2, null, 3, null, 2]);
  assert.ok(await noHScroll(page), 'sin desplazamiento horizontal');

  // 6) Quitar: las zonas y luego las respuestas; sin nada, el registro desaparece (no se guarda un check-in vacío)
  sh = await openAreaSheet(page, ci, { chip: 'Isquiotibiales' });
  await sh.locator('.sheet-actions button', { hasText: 'Quitar' }).click();
  await closeSheet(page);
  sh = await openAreaSheet(page, ci, { chip: 'Rodilla' });
  await sh.locator('.sheet-actions button', { hasText: 'Quitar' }).click();
  await closeSheet(page);
  assert.strictEqual(await ci.locator('.ci-zone').count(), 0);
  d = await disk(page);
  assert.deepStrictEqual([d.length, d[0].areas], [1, []], 'quedan sueño y estrés');
  await pick(ci, 'sleep', 'Normal').click();
  await page.waitForTimeout(500); // pasa el margen de doble toque antes de tocar el siguiente elegido
  await pick(ci, 'stress', 'Alto').click();
  await page.waitForFunction(async () => {
    const n = await new Promise((res) => {
      const r = indexedDB.open('entreno');
      r.onsuccess = () => { const q = r.result.transaction('checkins').objectStore('checkins').count(); q.onsuccess = () => { res(q.result); r.result.close(); }; };
    });
    return n === 0;
  });
  assert.deepStrictEqual(await disk(page), [], 'sin nada apuntado no queda ningún check-in');
}

test('zonas en el check-in de Hoy: músculo en el mapa, articulación, sustituir, editar y quitar (IndexedDB)', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await zonesFlow(page, { shots: true });
    // Apuntar una y cerrar y volver a abrir la app: sigue ahí (Hoy ya no lo ofrece, y el día lo muestra)
    const ci = page.locator('.today-checkin');
    const sh = await openAreaSheet(page, ci);
    await tapMuscle(sh, 'quads');
    await sh.locator('.ci-area-side .chip', { hasText: 'Ambos lados' }).click();
    await sh.locator('.ci-area-level .chip', { hasText: /^6$/ }).click();
    await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
    await closeSheet(page);
    await reload(page);
    await settle(page);
    assert.strictEqual(await page.locator('.today-checkin').count(), 0, 'ya hecho hoy: Hoy no lo vuelve a ofrecer');
    await go(page, `#/day/${TODAY}`);
    const sum = page.locator('.cal-dayview .ci-sum');
    await sum.waitFor();
    assert.strictEqual(await sum.locator('.ci-sum-zones').innerText(), 'Cuádriceps (ambos lados): agujetas 6/10', 'con un solo check-in, sin repetir «Ese día»');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('WebKit: zonas en el check-in de Hoy (mapa, articulación, editar, quitar)', { skip: skipWebkit }, async () => {
  const app = await launch({ browser: 'webkit' });
  try {
    await zonesFlow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

/** Un día pasado sin sesión, otro con una sesión de fuerza terminada (con un check-in antiguo) y ninguno en el futuro. */
async function seedDays(page) {
  return page.evaluate(async () => {
    const m = await import('./js/session-logic.js');
    const { store } = window.__app;
    const s = await m.createStrengthSession({ templateId: 'tpl_d1', date: '2026-09-21', past: true });
    for (const se of s.exercises) se.sets.forEach((x) => Object.assign(x, { weight: 40, reps: 8, done: true, doneAt: 1 }));
    m.finishSession(s, { durationMin: 50, rpe: 7 });
    await store.save('sessions', s);
    // Check-in de la versión anterior: sin estrés ni zonas (como en las copias y bases de datos de antes)
    await store.save('checkins', { id: 'ci_old', date: '2026-09-21', timing: 'pre', sessionId: s.id, sleep: 1, energy: 2, soreness: 3, createdAt: 1, updatedAt: 1 });
    return s.id;
  });
}

test('día del calendario (375 px): añadir el check-in de un día pasado sin sesión, con zona; editar; nada en el futuro', async () => {
  const app = await launch({ width: 375, height: 667 });
  const { page } = app;
  try {
    await seedDays(page);
    // Día pasado sin sesión: «Añadir check-in»
    await go(page, '#/day/2026-09-22');
    const add = page.locator('.cal-checkin-add');
    await add.waitFor();
    assert.strictEqual(await add.innerText(), 'Añadir check-in (sueño, energía, estrés, agujetas)');
    assert.ok((await add.boundingBox()).height >= 44);
    await add.click();
    const ed = page.locator('.sheet-panel.ci-sheet');
    await ed.waitFor();
    await settle(page);
    assert.deepStrictEqual(await ed.locator('.ci-ctitle').allInnerTexts(), ['Ese día'], 'sin sesión: uno solo');
    assert.strictEqual(await ed.locator('.ci-skip').count(), 0);
    assert.deepStrictEqual(await idbAll(page, 'checkins').then((l) => l.filter((c) => c.date === '2026-09-22')), [], 'nada solo por abrirla');
    const card = ed.locator('.ci-compact');
    await pick(card, 'sleep', 'Bajo').click();
    await pick(card, 'energy', 'Normal').click();
    await pick(card, 'stress', 'Alto').click();
    await pick(card, 'soreness', 'Normal').click();
    // una zona desde la hoja del día (hoja sobre hoja)
    await card.locator('.ci-zone-add').scrollIntoViewIfNeeded();
    const sh = await openAreaSheet(page, card);
    await sh.locator('.ci-area-kind .seg-btn', { hasText: 'Molestia o dolor' }).click();
    await sh.locator('.ci-area-joints .chip', { hasText: 'Zona lumbar' }).click();
    await sh.locator('.ci-area-level .chip', { hasText: /^2$/ }).click();
    assert.ok(await noHScroll(page), 'hoja de zona sin desplazamiento horizontal a 375 px');
    await shot(page, 'checkin-day-zone');
    await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
    await page.waitForFunction(() => !document.querySelector('.sheet-panel.ci-area-sheet'));
    await settle(page);
    assert.ok(await ed.isVisible(), 'vuelve a la hoja del día');
    assert.deepStrictEqual(await chipsOf(card), ['Zona lumbar · molestia 2']);
    await ed.locator('.sheet-actions button', { hasText: 'Listo' }).click();
    await closeSheet(page);
    let c = (await disk(page)).find((x) => x.date === '2026-09-22');
    assert.deepStrictEqual([c.timing, c.sessionId, c.sleep, c.energy, c.stress, c.soreness], ['pre', null, 1, 2, 3, 2]);
    assert.deepStrictEqual(plainAreas(c), [{ kind: 'joint', zone: 'lowback', side: null, level: 2, note: '' }]);
    // El día muestra el resumen (y ya no «Añadir»)
    const sum = page.locator('.cal-dayview .ci-sum');
    await sum.waitFor();
    assert.strictEqual(await page.locator('.cal-checkin-add').count(), 0);
    assert.deepStrictEqual(await sum.locator('.ci-sum-when').allInnerTexts(), ['ESE DÍA']);
    assert.deepStrictEqual(await sum.locator('.ci-sum-row[data-timing="pre"] .ci-sum-v').allInnerTexts(), ['Bajo', 'Normal', 'Alto', 'Normales']);
    assert.strictEqual(await sum.locator('.ci-sum-zones').innerText(), 'Zona lumbar: molestia 2/10');
    assert.ok(await noHScroll(page));
    await sum.scrollIntoViewIfNeeded();
    await shot(page, 'checkin-day-summary');
    // Editar desde el resumen: otra vez «Ese día» (sin «después»)
    await sum.locator('.ci-sum-edit').click();
    await ed.waitFor();
    await settle(page);
    assert.deepStrictEqual(await ed.locator('.ci-ctitle').allInnerTexts(), ['Ese día']);
    await pick(ed.locator('.ci-compact'), 'stress', 'Normal').click();
    await ed.locator('.sheet-actions button', { hasText: 'Listo' }).click();
    await closeSheet(page);
    c = (await disk(page)).find((x) => x.date === '2026-09-22');
    assert.strictEqual(c.stress, 2);
    assert.deepStrictEqual(await page.locator('.cal-dayview .ci-sum-row[data-timing="pre"] .ci-sum-v').allInnerTexts(), ['Bajo', 'Normal', 'Normal', 'Normales']);

    // Un día futuro: nada que añadir
    await go(page, '#/day/2026-09-26');
    assert.strictEqual(await page.locator('.cal-checkin-add').count(), 0);
    assert.strictEqual(await page.locator('.ci-sum').count(), 0);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('check-in antiguo (sin estrés ni zonas): se ve en el día y en el resumen de la sesión, y se edita sin perder nada', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const sid = await seedDays(page);
    // Día con sesión de fuerza: «Antes» con lo de entonces y «—» en estrés
    await go(page, '#/day/2026-09-21');
    const sum = page.locator('.cal-dayview .ci-sum');
    await sum.waitFor();
    assert.deepStrictEqual(await sum.locator('.ci-sum-when').allInnerTexts(), ['ANTES']);
    assert.deepStrictEqual(await sum.locator('.ci-sum-row[data-timing="pre"] .ci-sum-v').allInnerTexts(), ['Bajo', 'Normal', '—', 'Altas']);
    assert.strictEqual(await sum.locator('.ci-sum-zones').count(), 0);
    // Resumen de la sesión: igual
    await go(page, `#/session/${sid}/summary`);
    const ss = page.locator('.ci-sum');
    await ss.waitFor();
    assert.deepStrictEqual(await ss.locator('.ci-sum-row[data-timing="pre"] .ci-sum-v').allInnerTexts(), ['Bajo', 'Normal', '—', 'Altas']);
    // Editar: con sesión, «Antes» y «Después»; añadir el estrés y una zona conserva lo de antes
    await ss.locator('.ci-sum-edit').click();
    const ed = page.locator('.sheet-panel.ci-sheet');
    await ed.waitFor();
    await settle(page);
    assert.deepStrictEqual(await ed.locator('.ci-ctitle').allInnerTexts(), ['Antes de entrenar', 'Después de entrenar']);
    const pre = ed.locator('.ci-compact[data-checkin="pre"]');
    assert.deepStrictEqual(await pre.locator('.seg-btn.active').allInnerTexts(), ['Bajo', 'Normal', 'Alto'], 'lo de antes, marcado');
    await pick(pre, 'stress', 'Bajo').click();
    const sh = await openAreaSheet(page, pre);
    await tapMuscle(sh, 'glutes');
    await sh.locator('.ci-area-level .chip', { hasText: /^5$/ }).click();
    await sh.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
    await page.waitForFunction(() => !document.querySelector('.sheet-panel.ci-area-sheet'));
    // y el «después», que no existía: otro registro, con su zona
    const post = ed.locator('.ci-compact[data-checkin="post"]');
    await pick(post, 'soreness', 'Alto').click();
    await post.locator('.ci-zone-add').scrollIntoViewIfNeeded();
    const sh2 = await openAreaSheet(page, post);
    await sh2.locator('.ci-area-kind .seg-btn', { hasText: 'Molestia o dolor' }).click();
    await sh2.locator('.ci-area-joints .chip', { hasText: 'Hombro' }).click();
    await sh2.locator('.ci-area-side .chip', { hasText: 'Derecha' }).click();
    await sh2.locator('.ci-area-level .chip', { hasText: /^4$/ }).click();
    await sh2.locator('.sheet-actions button', { hasText: 'Añadir' }).click();
    await page.waitForFunction(() => !document.querySelector('.sheet-panel.ci-area-sheet'));
    await ed.locator('.sheet-actions button', { hasText: 'Listo' }).click();
    await closeSheet(page);
    const c = (await disk(page)).find((x) => x.id === 'ci_old');
    assert.deepStrictEqual([c.sessionId, c.sleep, c.energy, c.stress, c.soreness, c.createdAt], [sid, 1, 2, 1, 3, 1], 'mismo registro, nada perdido');
    assert.deepStrictEqual(plainAreas(c), [{ kind: 'muscle', zone: 'glutes', side: null, level: 5, note: '' }]);
    const all = await disk(page);
    assert.strictEqual(all.length, 2, 'el antiguo se edita; solo el «después» es nuevo');
    const cp = all.find((x) => x.timing === 'post');
    assert.deepStrictEqual([cp.sessionId, cp.sleep, cp.stress, cp.soreness], [sid, null, null, 3]);
    assert.deepStrictEqual(plainAreas(cp), [{ kind: 'joint', zone: 'shoulder', side: 'right', level: 4, note: '' }]);
    assert.deepStrictEqual(await ss.locator('.ci-sum-row[data-timing="pre"] .ci-sum-v').allInnerTexts(), ['Bajo', 'Normal', 'Bajo', 'Altas']);
    assert.deepStrictEqual(await ss.locator('.ci-sum-row[data-timing="post"] .ci-sum-v').allInnerTexts(), ['—', '—', '—', 'Altas']);
    assert.deepStrictEqual(await ss.locator('.ci-sum-zones').allInnerTexts(), ['ANTES: Glúteos: agujetas 5/10', 'DESPUÉS: Hombro (der.): molestia 4/10']);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
