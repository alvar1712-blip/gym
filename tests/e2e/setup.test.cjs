// E2E de la configuración del ejercicio (ronda 11: máquina, polea, agarre, sistema de lastre…): el chip y la hoja de la tarjeta,
// la configuración habitual heredada, que cambiar de máquina no genere un récord falso, que con la misma sí, los récords por
// configuración y que la copia JSON conserve el campo sin inventarlo en el historial anterior. 375 px, Chromium y WebKit.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/setup.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

/** Sesión de press banca ya terminada con un solo peso; `setup` undefined = sin el campo (historial anterior). */
const done = (page, { id, date, w, setup }) => page.evaluate(async (o) => {
  const at = o.at;
  const se = { id: `${o.id}_e`, exerciseId: 'press_banca', exName: 'Press banca', templateItemId: null, alternatives: [], target: { sets: 1 }, notes: '', section: '', sets: [{ id: `${o.id}_s`, type: 'effective', done: true, weight: o.w, reps: 5, rir: 1, doneAt: at }] };
  if (o.setup !== undefined) se.setup = o.setup;
  await window.__app.store.save('sessions', { id: o.id, kind: 'strength', date: o.date, planDate: o.date, templateId: null, templateName: 'Sesión libre', status: 'done', startedAt: at, endedAt: at + 3600e3, durationMin: 60, rpe: 7, notes: '', exercises: [se], createdAt: at, updatedAt: at });
}, { id, date, w, setup, at: madrid(date) });

async function flow(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  // Historial anterior: sin configuración (100 × 5)
  await done(page, { id: 'old1', date: '2026-09-20', w: 100 });

  // --- Sesión de hoy: se elige «Hammer» desde el menú de la tarjeta ---
  const id = await page.evaluate(async () => {
    const sl = await import('./js/session-logic.js');
    const s = await sl.createStrengthSession({ date: '2026-10-05', planDate: '2026-10-05' });
    s.exercises.push(sl.newSessionExercise('press_banca', s));
    await window.__app.store.save('sessions', s);
    return s.id;
  });
  await go(page, `#/session/${id}`);
  const card = page.locator('.ses-card', { has: page.locator('.ses-name', { hasText: /^Press banca$/ }) });
  await card.waitFor();
  assert.strictEqual(await card.locator('.ses-setup').count(), 0, 'sin configuración no hay chip: el historial anterior no se toca');
  assert.strictEqual(await page.evaluate((sid) => 'setup' in window.__app.store.get('sessions', sid).exercises[0], id), false);
  await card.locator('.ses-more').click();
  await page.locator('.action-item', { hasText: 'Material o configuración' }).click();
  await page.locator('.ses-setup-sheet input').waitFor();
  assert.strictEqual(await page.locator('.ses-setup-chips').count(), 0, 'sin historial de configuraciones no hay sugerencias');
  const inputSize = await page.locator('.ses-setup-sheet input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(inputSize >= 16, `campo de texto de 16 px o más (iOS no hace zoom): ${inputSize}`);
  await page.locator('.ses-setup-sheet input').fill('  Máquina   Hammer ');
  await page.locator('.ses-setup-save').click();
  await card.locator('.ses-setup').waitFor();
  await page.waitForSelector('.sheet-panel', { state: 'detached' }); // el efecto tarjeta escala la página mientras la hoja se cierra
  assert.strictEqual(clean(await card.locator('.ses-setup-txt').innerText()), 'Máquina Hammer', 'espacios normalizados');
  const chipH = await card.locator('.ses-setup').evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(chipH >= 43.5, `objetivo táctil de 44 px (${chipH})`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal');

  // Termina con 110 × 5 en la nueva máquina: más que los 100 anteriores, pero otra configuración → NO es récord
  await page.evaluate(async (sid) => {
    const s = window.__app.store.get('sessions', sid);
    s.exercises[0].sets = [{ id: 'n1', type: 'effective', done: true, weight: 110, reps: 5, rir: 1, doneAt: 1 }];
    s.status = 'done'; s.endedAt = s.startedAt + 3000e3; s.durationMin = 50; s.rpe = 7;
    await window.__app.store.save('sessions', s);
  }, id);
  await go(page, `#/session/${id}/summary`);
  await page.locator('.ses-sum-hero').waitFor();
  assert.strictEqual(await page.locator('.ses-sum-prs').count(), 0, 'cambiar de máquina no genera un récord falso');
  assert.match(clean(await page.locator('.ses-sum-best').first().innerText()), /Máquina Hammer/);

  // --- La siguiente sesión hereda la configuración habitual; escribirla distinto no la duplica ---
  const second = await page.evaluate(async () => {
    const sl = await import('./js/session-logic.js');
    const s = await sl.createStrengthSession({ date: '2026-10-12', planDate: '2026-10-12' });
    const se = sl.newSessionExercise('press_banca', s);
    s.exercises.push(se);
    const inherited = se.setup;
    sl.setSetup(se, '  máquina hammer', s);
    await window.__app.store.save('sessions', s);
    return { id: s.id, inherited, after: se.setup };
  });
  assert.strictEqual(second.inherited, 'Máquina Hammer');
  assert.strictEqual(second.after, 'Máquina Hammer', 'misma configuración con otra escritura: se reutiliza la ya usada');
  await go(page, `#/session/${second.id}`);
  const card2 = page.locator('.ses-card', { has: page.locator('.ses-name', { hasText: /^Press banca$/ }) });
  await card2.locator('.ses-setup').click();
  await page.locator('.ses-setup-chips').waitFor();
  assert.deepStrictEqual((await page.locator('.ses-setup-chips .chip').allInnerTexts()).map(clean), ['Máquina Hammer'], 'sugerencia del historial, sin duplicados');

  // Con la misma máquina: 115 × 5 sí es récord
  await page.evaluate(async (sid) => {
    const s = window.__app.store.get('sessions', sid);
    s.exercises[0].sets = [{ id: 'n2', type: 'effective', done: true, weight: 115, reps: 5, rir: 1, doneAt: 1 }];
    s.status = 'done'; s.endedAt = s.startedAt + 3000e3; s.durationMin = 50; s.rpe = 7;
    await window.__app.store.save('sessions', s);
  }, second.id);
  await go(page, `#/session/${second.id}/summary`);
  await page.locator('.ses-sum-hero').waitFor();
  assert.strictEqual(await page.locator('.ses-sum-prs').getAttribute('data-count'), '1', 'misma máquina: récord');
  assert.match(clean(await page.locator('.ses-sum-pr-name').first().innerText()), /Press banca · Máquina Hammer/);

  // --- Récords: uno por configuración (la anterior sin configuración, aparte) ---
  await go(page, '#/records');
  await page.waitForSelector('.prg-rec[data-ex="press_banca"]');
  const cards = await page.locator('.prg-rec[data-ex="press_banca"]').evaluateAll((els) => els.map((e) => [e.dataset.setup, e.querySelector('[data-rec="weight"] .prg-rec-value')?.textContent.replace(/\s+/g, ' ').trim()]));
  assert.deepStrictEqual(cards.sort(), [['Máquina Hammer', '115 kg'], ['sin especificar', '100 kg']].sort());

  // --- Plantillas: una sesión creada desde una rutina hereda la configuración habitual; la rutina no se modifica ---
  const tpl = await page.evaluate(async () => {
    const { store } = window.__app;
    const before = JSON.stringify(store.get('templates', 'tpl_d1'));
    const sl = await import('./js/session-logic.js');
    const s = await sl.createStrengthSession({ templateId: 'tpl_d1', date: '2026-10-19', planDate: '2026-10-19' });
    const bench = s.exercises.find((e) => e.exerciseId === 'press_banca');
    return { setup: bench ? bench.setup : 'sin-press', unchanged: JSON.stringify(store.get('templates', 'tpl_d1')) === before, anySetupInTemplate: JSON.stringify(store.get('templates', 'tpl_d1')).includes('"setup"') };
  });
  if (tpl.setup !== 'sin-press') assert.strictEqual(tpl.setup, 'Máquina Hammer', 'la rutina hereda la configuración habitual del press');
  assert.strictEqual(tpl.unchanged, true);
  assert.strictEqual(tpl.anySetupInTemplate, false, 'la configuración vive en la sesión, no en la rutina');

  // --- Copia: la configuración viaja y el historial anterior no recibe una inventada ---
  const exported = await page.evaluate(() => JSON.parse(JSON.stringify(window.__app.store.exportData())));
  const byId = Object.fromEntries(exported.data.sessions.map((s) => [s.id, s.exercises[0]]));
  assert.strictEqual(byId[second.id].setup, 'Máquina Hammer');
  assert.strictEqual('setup' in byId.old1, false);
  assert.strictEqual(exported.format, 2, 'el formato de la copia no cambia (campo opcional)');
}

test('Configuración del ejercicio: chip, hoja, herencia, récords sin falsos positivos y copia (Chromium, 375 px)', async () => {
  const app = await openApp();
  try {
    await flow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Configuración del ejercicio (WebKit, 375 px)', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit' });
  try {
    await flow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
