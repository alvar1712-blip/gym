// E2E del check-in opcional (js/checkin.js) en la sesión de fuerza: «¿Cómo llegas hoy?» arriba (plegado, 3 toques
// una vez abierto, guardado al instante en IndexedDB), editar, «Omitir» (sin guardar nada), «¿Cómo ha ido?» en la
// hoja de terminar, el check-in en el resumen y que registrar una serie prellenada sigue costando 1 toque. En una
// sesión a posteriori (sin cronómetro) el «antes» no va arriba sino en la hoja de terminar, junto al «después».
// La fecha se fija con el reloj de Playwright (jueves 24 sep 2026, 18:00 en Madrid; el tiempo sigue corriendo).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/checkin.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { waitReady, go, reload, idbAll, storeAll, shot } = require('./helpers.cjs');

const TODAY = '2026-09-24';
const YESTERDAY = '2026-09-23';
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const HINT = 'Solo se usa como contexto en el panel semanal y en la sugerencia de descarga.';

async function launch({ width = 390, height = 844, sat = null } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width, height }, locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block',
  });
  await context.clock.install({ time: madrid(TODAY) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(server.url);
  await waitReady(page);
  if (sat != null) await page.addStyleTag({ content: `:root{--sat:${sat}px !important}` });
  return { browser, context, page, errors, close: async () => { await browser.close(); await server.close(); } };
}

/** Día 1 de hace una semana, hecho (así las series de hoy vienen prellenadas). */
async function seedHistory(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const m = await import('./js/session-logic.js');
    const { store } = window.__app;
    const s = await m.createStrengthSession({ templateId: 'tpl_d1', date: u.addDays(u.todayStr(), -7), past: true });
    for (const se of s.exercises) {
      const lt = store.exercise(se.exerciseId).logType;
      se.sets.forEach((x, i) => Object.assign(x, { weight: lt === 'bodyweight' ? 5 : 40, reps: (se.target.repMax || 8) - i, rir: 1, done: true, doneAt: 1 }));
    }
    m.finishSession(s, { durationMin: 60, rpe: 7 });
    await store.save('sessions', s);
  });
}

async function openSession(page, opts = { templateId: 'tpl_d1' }) {
  const id = await page.evaluate(async (o) => {
    const m = await import('./js/session-logic.js');
    return (await m.createStrengthSession(o)).id;
  }, opts);
  await go(page, `#/session/${id}`);
  await page.waitForSelector('.ses-card');
  return id;
}

const getSession = (page, id) => page.evaluate((i) => JSON.parse(JSON.stringify(window.__app.store.get('sessions', i))), id);
const diskCheckins = async (page) => (await idbAll(page, 'checkins')).sort((a, b) => (a.timing < b.timing ? 1 : -1));
const values = (c) => c && [c.date, c.timing, c.sleep, c.energy, c.soreness];
const pick = (root, field, label) => root.locator(`.ci-row[data-field="${field}"] .seg-btn`, { hasText: new RegExp(`^${label}$`) });

async function countTaps(page) {
  await page.evaluate(() => {
    window.__taps = 0;
    if (!window.__tapsOn) {
      window.__tapsOn = true;
      document.addEventListener('click', (e) => { if (e.isTrusted) window.__taps++; }, true);
    }
  });
  return () => page.evaluate(() => { const n = window.__taps; window.__taps = 0; return n; });
}

/** «Registrar serie» de la primera tarjeta: a la vista, sin desplazar, y no tapado (pestañas, cabecera). */
function registerVisible(page) {
  return page.evaluate(() => {
    const b = document.querySelector('.ses-card .ses-editor .ses-register');
    const r = b.getBoundingClientRect();
    const hdr = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const tab = document.getElementById('tabbar').getBoundingClientRect().top;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: r.top >= hdr - 1 && r.bottom <= tab + 1 && b.contains(hit), top: Math.round(r.top), bottom: Math.round(r.bottom), tab: Math.round(tab) };
  });
}

/**
 * ¿Se ve entera la franja plegada? Compara su captura tal cual con otra en la que nada recorta (overflow visible):
 * si algo corta la tilde de «ENERGÍA» o la virgulilla de «SUEÑO» (o cualquier texto), las dos capturas difieren.
 */
async function stripUnclipped(page, ci) {
  const b = await ci.boundingBox();
  const clip = { x: Math.floor(b.x), y: Math.floor(b.y) - 4, width: Math.ceil(b.width), height: Math.ceil(b.height) + 8 };
  const asIs = await page.screenshot({ clip });
  const tag = await page.addStyleTag({ content: '.ci-card, .ci-card * { overflow: visible !important; }' });
  const free = await page.screenshot({ clip });
  await tag.evaluate((n) => n.remove());
  return asIs.equals(free);
}

test('check-in «antes» en la sesión: plegado, 3 toques guardados al instante, editar; «después» en Terminar y en el resumen', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seedHistory(page);
    const id = await openSession(page);
    const ci = page.locator('.ci-card[data-checkin="pre"]');
    await ci.waitFor();

    // Plegado arriba: una franja de 44 px que no quita «Registrar serie 1» de la vista
    assert.strictEqual(await ci.locator('.ci-title').innerText(), '¿Cómo llegas hoy?');
    assert.strictEqual(await ci.locator('.ci-body').isHidden(), true, 'plegado');
    assert.strictEqual(await ci.locator('.ci-toggle').getAttribute('aria-expanded'), 'false');
    assert.ok((await ci.boundingBox()).height <= 46, 'franja de una línea');
    const firstCard = await page.locator('.ses-card').first().boundingBox();
    assert.ok((await ci.boundingBox()).y < firstCard.y, 'va arriba, antes del primer ejercicio');
    assert.ok((await registerVisible(page)).ok, JSON.stringify(await registerVisible(page)));
    assert.ok(await ci.locator('.ci-skip').isVisible(), '«Omitir» a mano');
    assert.deepStrictEqual(await storeAll(page, 'checkins'), [], 'no guarda nada solo por mostrarse');
    await shot(page, 'checkin-pre-collapsed');

    // Abrir (1 toque) y contestar: 3 toques, cada uno guardado al instante en IndexedDB
    const taps = await countTaps(page);
    await ci.locator('.ci-toggle').click();
    assert.strictEqual(await taps(), 1);
    assert.strictEqual(await ci.locator('.ci-body').isVisible(), true);
    assert.strictEqual(await ci.locator('.ci-hint').innerText(), HINT);
    assert.deepStrictEqual(await ci.locator('.ci-label').allInnerTexts(), ['Sueño', 'Energía', 'Agujetas']);
    assert.deepStrictEqual(await ci.locator('.ci-row[data-field="sleep"] .seg-btn').allInnerTexts(), ['Bajo', 'Normal', 'Alto']);
    for (const b of await ci.locator('.ci-row .seg-btn').all()) assert.ok((await b.boundingBox()).height >= 44, 'botones ≥ 44 px');
    await shot(page, 'checkin-pre-open');

    await pick(ci, 'sleep', 'Normal').click();
    let disk = await diskCheckins(page);
    assert.strictEqual(disk.length, 1);
    assert.deepStrictEqual(values(disk[0]), [TODAY, 'pre', 2, null, null], 'el primer toque ya está en disco');
    assert.strictEqual(disk[0].sessionId, id);
    const ckId = disk[0].id;
    await pick(ci, 'energy', 'Alto').click();
    await pick(ci, 'soreness', 'Bajo').click();
    assert.strictEqual(await taps(), 3, 'tres toques');
    disk = await diskCheckins(page);
    assert.strictEqual(disk.length, 1);
    assert.deepStrictEqual(values(disk[0]), [TODAY, 'pre', 2, 3, 1]);
    assert.ok(disk[0].createdAt > 0);
    // el elegido, resaltado
    assert.strictEqual(await pick(ci, 'energy', 'Alto').getAttribute('aria-pressed'), 'true');
    assert.match(await pick(ci, 'energy', 'Alto').getAttribute('class'), /active/);
    assert.strictEqual(await ci.locator('.ci-row[data-field="energy"] .seg-btn.active').count(), 1);

    // Al contestar las tres, se pliega sola con el resumen
    await ci.locator('.ci-body').waitFor({ state: 'hidden' });
    assert.deepStrictEqual(await ci.locator('.ci-mini-v').allInnerTexts(), ['Normal', 'Alta', 'Bajas']);
    assert.deepStrictEqual(await ci.locator('.ci-mini-k').allInnerTexts(), ['SUEÑO', 'ENERGÍA', 'AGUJETAS']);
    assert.ok(await stripUnclipped(page, ci), 'la franja plegada no recorta las tildes («SUEÑO», «ENERGÍA»)');
    assert.strictEqual(await ci.locator('.ci-skip').isHidden(), true, 'ya no hay nada que omitir');
    assert.match(await ci.locator('.ci-toggle').getAttribute('aria-label'), /Sueño normal · Energía alta · Agujetas bajas/);
    assert.ok((await ci.boundingBox()).height <= 46);
    assert.ok((await registerVisible(page)).ok, 'sigue a la vista');
    await shot(page, 'checkin-pre-done');

    // Registrar la serie prellenada sigue costando 1 toque
    const bench = page.locator('.ses-card').first();
    assert.strictEqual(await bench.locator('.ses-editor input[aria-label="Peso"]').inputValue(), '40');
    await taps();
    await bench.locator('.ses-register').click();
    assert.strictEqual(await taps(), 1, 'la serie 1 se registra con 1 toque');
    let s = await getSession(page, id);
    assert.deepStrictEqual([s.exercises[0].sets[0].done, s.exercises[0].sets[0].weight, s.exercises[0].sets[0].reps], [true, 40, 6]);

    // Editar: el mismo registro (uno por día y momento)
    await page.evaluate(() => window.scrollTo(0, 0));
    await ci.locator('.ci-toggle').click();
    await pick(ci, 'energy', 'Bajo').click();
    disk = await diskCheckins(page);
    assert.strictEqual(disk.length, 1);
    assert.strictEqual(disk[0].id, ckId, 'se edita el mismo');
    assert.deepStrictEqual(values(disk[0]), [TODAY, 'pre', 2, 1, 1]);
    // editar no lo pliega de golpe (solo al completar por primera vez)
    await page.waitForTimeout(800);
    assert.strictEqual(await ci.locator('.ci-body').isVisible(), true);
    // doble toque accidental sobre el elegido: no lo quita
    await pick(ci, 'energy', 'Bajo').dblclick();
    assert.strictEqual((await diskCheckins(page))[0].energy, 1, 'doble toque ignorado');
    // tocar el elegido (con calma) lo quita; tocar otro lo vuelve a poner
    await page.waitForTimeout(500);
    await pick(ci, 'energy', 'Bajo').click();
    assert.strictEqual((await diskCheckins(page))[0].energy, null, 'tocar el elegido lo quita');
    assert.strictEqual(await ci.locator('.ci-row[data-field="energy"] .seg-btn.active').count(), 0);
    await pick(ci, 'energy', 'Normal').click();
    assert.deepStrictEqual(values((await diskCheckins(page))[0]), [TODAY, 'pre', 2, 2, 1]);
    await ci.locator('.ci-toggle').click();
    assert.strictEqual(await ci.locator('.ci-body').isHidden(), true, 'se pliega al tocar la cabecera');

    // Cerrar y volver a abrir la app: sigue ahí
    await reload(page);
    await page.waitForSelector('.ci-card[data-checkin="pre"]');
    assert.deepStrictEqual(await page.locator('.ci-card .ci-mini-v').allInnerTexts(), ['Normal', 'Normal', 'Bajas']);

    // Terminar: «¿Cómo ha ido?» compacto (3 toques, sin plegar)
    await page.locator('.ses-finish').click();
    const fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    const post = fin.locator('.ci-compact[data-checkin="post"]');
    assert.strictEqual(await post.locator('.ci-ctitle').innerText(), '¿Cómo ha ido?');
    assert.strictEqual(await post.locator('.ci-hint').innerText(), HINT);
    assert.strictEqual(await post.locator('.ci-row').count(), 3);
    await post.scrollIntoViewIfNeeded();
    await fin.locator('.rpe-chips .chip', { hasText: /^7$/ }).click();
    const taps2 = await countTaps(page); // la recarga borró el contador
    await pick(post, 'sleep', 'Normal').click();
    await pick(post, 'energy', 'Bajo').click();
    await pick(post, 'soreness', 'Alto').click();
    assert.strictEqual(await taps2(), 3, '«después» en 3 toques');
    await page.waitForTimeout(700);
    assert.strictEqual(await post.locator('.ci-row').count(), 3, 'la versión compacta no se pliega');
    disk = await diskCheckins(page);
    assert.strictEqual(disk.length, 2);
    assert.deepStrictEqual(disk.map(values), [[TODAY, 'pre', 2, 2, 1], [TODAY, 'post', 2, 1, 3]]);
    assert.strictEqual(disk[1].sessionId, id);
    await post.locator('.ci-row[data-field="soreness"]').scrollIntoViewIfNeeded();
    await shot(page, 'checkin-post-finish');
    await fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' }).click();
    const diff = page.locator('.sheet-panel.ses-diff-sheet');
    if (await diff.isVisible().catch(() => false)) await diff.locator('.sheet-actions button', { hasText: 'Solo esta vez' }).click();
    await page.waitForFunction((sid) => location.hash === `#/session/${sid}/summary`, id);
    s = await getSession(page, id);
    assert.deepStrictEqual([s.status, s.rpe], ['done', 7]);

    // Resumen: el check-in (antes y después), con su «para qué»
    const sum = page.locator('.ci-sum');
    await sum.waitFor();
    await page.waitForSelector('.sheet-overlay', { state: 'detached' }); // la hoja de terminar ya se ha ido
    await sum.scrollIntoViewIfNeeded();
    const row = (t) => sum.locator(`.ci-sum-row[data-timing="${t}"] .ci-sum-v`);
    assert.deepStrictEqual(await row('pre').allInnerTexts(), ['Normal', 'Normal', 'Bajas']);
    assert.deepStrictEqual(await row('post').allInnerTexts(), ['Normal', 'Baja', 'Altas']);
    assert.deepStrictEqual(await sum.locator('.ci-sum-when').allInnerTexts(), ['ANTES', 'DESPUÉS']);
    assert.match(await sum.innerText(), /panel semanal y en la sugerencia de descarga/);
    await shot(page, 'checkin-summary');

    // Editar desde el resumen: hoja con los dos, sin «Omitir»
    await sum.locator('.ci-sum-edit').click();
    const ed = page.locator('.sheet-panel.ci-sheet');
    await ed.waitFor();
    assert.deepStrictEqual(await ed.locator('.ci-ctitle').allInnerTexts(), ['Antes de entrenar', 'Después de entrenar']);
    assert.strictEqual(await ed.locator('.ci-skip').count(), 0);
    await pick(ed.locator('.ci-compact[data-checkin="post"]'), 'soreness', 'Normal').click();
    await shot(page, 'checkin-summary-edit');
    await ed.locator('.sheet-actions button', { hasText: 'Listo' }).click();
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await row('post').allInnerTexts(), ['Normal', 'Baja', 'Normales']);
    assert.strictEqual((await diskCheckins(page)).find((c) => c.timing === 'post').soreness, 2);
    assert.strictEqual((await diskCheckins(page)).length, 2);

    // La sesión terminada (ver / editar) ya no muestra «¿Cómo llegas hoy?»
    await page.locator('.ses-sum-edit').click();
    await page.waitForSelector('.ses-card');
    assert.strictEqual(await page.locator('.ci-card').count(), 0);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('«Omitir»: oculta el check-in de esa sesión y día sin guardar nada (con deshacer), también en la hoja de terminar', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const id = await openSession(page);
    const ci = page.locator('.ci-card[data-checkin="pre"]');
    await ci.waitFor();
    await ci.locator('.ci-skip').click();
    assert.strictEqual(await ci.isHidden(), true);
    const t = page.locator('.toast');
    await t.waitFor();
    assert.match(await t.innerText(), /Check-in omitido/);
    assert.deepStrictEqual(await idbAll(page, 'checkins'), [], 'no guarda ningún check-in');
    let disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.deepStrictEqual(disk.checkinDismissed, { pre: true }, 'se recuerda en la sesión');
    // Deshacer lo vuelve a mostrar
    await t.locator('.toast-action').click();
    assert.strictEqual(await ci.isVisible(), true);
    disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.strictEqual(disk.checkinDismissed, undefined);
    // Omitir otra vez y volver a abrir la app: sigue oculto
    await ci.locator('.ci-skip').click();
    await page.waitForTimeout(100);
    await reload(page);
    await page.waitForSelector('.ses-card');
    assert.strictEqual(await page.locator('.ci-card').count(), 0, 'omitido para esta sesión');
    // …y para ese día (p. ej. la tarjeta de Hoy, sin sesión)
    assert.strictEqual(await page.evaluate(async (d) => (await import('./js/checkin.js')).isDismissed({ date: d, timing: 'pre' }), TODAY), true);
    assert.strictEqual(await page.evaluate(async (d) => (await import('./js/checkin.js')).checkinCard({ date: d, timing: 'pre' }), TODAY), null);
    assert.ok((await registerVisible(page)).ok);

    // Terminar: «¿Cómo ha ido?» también se puede omitir
    await page.locator('.ses-finish').click();
    let fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    const post = fin.locator('.ci-compact[data-checkin="post"]');
    await post.locator('.ci-skip').click();
    assert.strictEqual(await post.isHidden(), true);
    assert.deepStrictEqual(await idbAll(page, 'checkins'), []);
    await fin.locator('.sheet-head button[aria-label="Cerrar"]').click();
    await page.waitForTimeout(300);
    await page.locator('.ses-finish').click();
    fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    assert.strictEqual(await fin.locator('.ci-compact').count(), 0, 'no vuelve a salir');
    disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.deepStrictEqual(disk.checkinDismissed, { pre: true, post: true });
    await fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' }).click();
    await page.waitForFunction((sid) => location.hash === `#/session/${sid}/summary`, id);
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator('.ci-sum').count(), 0, 'sin check-in, el resumen no lo muestra');
    assert.deepStrictEqual(await idbAll(page, 'checkins'), []);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('sesión a posteriori (iPhone SE): sin franja arriba, «Registrar serie 1» a la vista; «¿Cómo llegaste?» en Terminar y se mueve con la fecha', async () => {
  const app = await launch({ width: 375, height: 667, sat: 20 });
  const { page } = app;
  try {
    // D2 empieza por Saltos verticales (editor de dos filas) y ya lleva el aviso «registrada a posteriori».
    const id = await openSession(page, { templateId: 'tpl_d2', date: '2026-09-22', past: true });
    await page.locator('.ses-past-banner').waitFor();
    assert.strictEqual(await page.locator('.ses-content .ci-card').count(), 0, 'sin cronómetro, el «antes» no va arriba');
    const v = await registerVisible(page);
    assert.ok(v.ok, `«Registrar serie 1» a la vista sin desplazar (${JSON.stringify(v)})`);
    await shot(page, 'checkin-past-session');

    // Terminar: «¿Cómo llegaste?» y «¿Cómo fue?», los dos opcionales (nada guardado solo por mostrarse)
    await page.locator('.ses-finish-top').click();
    let fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    assert.deepStrictEqual(await fin.locator('.ci-compact').evaluateAll((els) => els.map((e) => e.dataset.checkin)), ['pre', 'post']);
    assert.deepStrictEqual(await fin.locator('.ci-ctitle').allInnerTexts(), ['¿Cómo llegaste?', '¿Cómo fue?']);
    assert.deepStrictEqual(await storeAll(page, 'checkins'), []);
    const pre = fin.locator('.ci-compact[data-checkin="pre"]');
    await pre.scrollIntoViewIfNeeded();
    await pick(pre, 'sleep', 'Bajo').click();
    await pick(pre, 'energy', 'Normal').click();
    let disk = await diskCheckins(page);
    assert.strictEqual(disk.length, 1);
    assert.deepStrictEqual(values(disk[0]), ['2026-09-22', 'pre', 1, 2, null], 'con la fecha de la sesión, guardado al instante');
    assert.strictEqual(disk[0].sessionId, id);
    await page.waitForTimeout(250);
    await shot(page, 'checkin-past-finish');
    await fin.locator('.sheet-head button[aria-label="Cerrar"]').click();
    await page.waitForSelector('.sheet-overlay', { state: 'detached' });

    // Cambiar la fecha de la sesión (menú ⋯ › Cambiar fecha): el check-in va con ella
    await page.locator('.ses-menu-btn').click();
    await page.locator('.action-item', { hasText: 'Cambiar fecha' }).click();
    const inp = page.locator('.ses-date-input');
    await inp.waitFor();
    await inp.fill(YESTERDAY);
    await inp.dispatchEvent('change');
    await page.locator('.sheet-actions button', { hasText: 'Listo' }).click();
    await page.waitForSelector('.sheet-overlay', { state: 'detached' });
    disk = await diskCheckins(page);
    assert.strictEqual(disk.length, 1);
    assert.deepStrictEqual(values(disk[0]), [YESTERDAY, 'pre', 1, 2, null], 'el check-in se mueve con la sesión');
    assert.strictEqual((await getSession(page, id)).date, YESTERDAY);
    assert.strictEqual(await page.locator('.ses-content .ci-card').count(), 0, 'tras rehacer la vista, sigue sin franja');
    assert.ok((await registerVisible(page)).ok);

    // Al volver a Terminar sale lo contestado
    await page.locator('.ses-finish-top').click();
    fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    const pre2 = fin.locator('.ci-compact[data-checkin="pre"]');
    assert.deepStrictEqual(await pre2.locator('.seg-btn.active').allInnerTexts(), ['Bajo', 'Normal']);
    assert.strictEqual(await pre2.locator('.ci-skip').isHidden(), true, 'contestado: nada que omitir');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sin desplazamiento horizontal');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('una mano en iPhone SE: con el check-in arriba, «Registrar serie 1» sigue a la vista y cuesta 1 toque', async () => {
  const app = await launch({ width: 375, height: 667, sat: 20 });
  const { page } = app;
  try {
    await seedHistory(page);
    const id = await openSession(page);
    const ci = page.locator('.ci-card[data-checkin="pre"]');
    await ci.waitFor();
    let v = await registerVisible(page);
    assert.ok(v.ok, `«Registrar serie 1» a la vista con el check-in plegado (${JSON.stringify(v)})`);
    await shot(page, 'checkin-se-collapsed');
    await ci.locator('.ci-toggle').click();
    await shot(page, 'checkin-se-open');
    await pick(ci, 'sleep', 'Alto').click();
    await pick(ci, 'energy', 'Normal').click();
    await pick(ci, 'soreness', 'Alto').click();
    await ci.locator('.ci-body').waitFor({ state: 'hidden' });
    assert.deepStrictEqual(values((await diskCheckins(page))[0]), [TODAY, 'pre', 3, 2, 3]);
    v = await registerVisible(page);
    assert.ok(v.ok, `sigue a la vista con el resumen (${JSON.stringify(v)})`);
    assert.ok(await stripUnclipped(page, ci), 'resumen plegado sin recortes en 375 px');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sin desplazamiento horizontal');
    await shot(page, 'checkin-se-done');
    const taps = await countTaps(page);
    await page.locator('.ses-card').first().locator('.ses-register').click();
    assert.strictEqual(await taps(), 1);
    const s = await getSession(page, id);
    assert.strictEqual(s.exercises[0].sets[0].done, true);
    // la hoja de terminar en pantalla pequeña
    await page.locator('.ses-finish-top').click();
    const fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    await fin.locator('.ci-compact').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await shot(page, 'checkin-se-finish');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
