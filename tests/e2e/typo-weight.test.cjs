// LAB-001 (fase 5), en la app de verdad: 175 kg tecleado con 17,5 kg de costumbre → «¿Seguro?» (no bloquea); «Corregir» no registra;
// «Sí, registrar» registra y no vuelve a preguntar por lo mismo hoy; sin historial no pregunta. 375 px, Chromium y WebKit. Datos sintéticos.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/typo-weight.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

async function typeInto(page, locator, value) {
  await locator.click({ force: true }); // el toque lo recibe .stepper-field (regla), no el <input>
  await locator.fill(value);
  await locator.press('Tab');
}

/** Cuatro sesiones terminadas con 3 series del primer ejercicio de «Día 1» a `kg` (12 series de historial). */
async function seed(page, kg) {
  await page.evaluate(async (w) => {
    const u = await import('./js/util.js');
    const m = await import('./js/session-logic.js');
    const { store } = window.__app;
    for (let i = 1; i <= 4; i++) {
      const s = await m.createStrengthSession({ templateId: 'tpl_d1', date: u.addDays(u.todayStr(), -7 * i), past: true });
      const se = s.exercises[0];
      se.sets.forEach((x) => Object.assign(x, { weight: w, reps: 8, rir: 2, done: true, doneAt: 1 }));
      s.exercises = [se];
      m.finishSession(s, { durationMin: 45, rpe: 7 });
      await store.save('sessions', s);
    }
  }, kg);
}

async function flow(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await seed(page, 17.5);
  const id = await page.evaluate(async () => (await (await import('./js/session-logic.js')).createStrengthSession({ templateId: 'tpl_d1' })).id);
  await go(page, `#/session/${id}`);
  const card = page.locator('.ses-card').first();
  await card.locator('.ses-editor[data-state="editing"]').waitFor();
  const sheet = page.locator('.sheet-overlay.open');
  const done = () => page.evaluate((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.filter((x) => x.done).map((x) => x.weight), id);

  await typeInto(page, card.locator('.ses-editor input[aria-label="Peso"]'), '175');
  await card.locator('.ses-register').click();
  await sheet.waitFor();
  assert.match(clean(await sheet.innerText()), /¿Seguro\?.*Has puesto 175 kg, bastante más de lo que sueles usar en este ejercicio \(unos 17,5 kg\)\. ¿Es correcto\?/);
  await sheet.locator('button', { hasText: 'Corregir' }).click();
  await page.waitForFunction(() => !document.querySelector('.sheet-overlay.open'));
  assert.deepStrictEqual(await done(), [], '«Corregir» no registra');

  // corrige el error: 17,5 se registra sin preguntar
  await typeInto(page, card.locator('.ses-editor input[aria-label="Peso"]'), '17,5');
  await card.locator('.ses-register').click();
  await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.some((x) => x.done), id);
  assert.strictEqual(await page.locator('.sheet-overlay.open').count(), 0);
  assert.deepStrictEqual(await done(), [17.5]);

  // una marca real (con la intención de 175): se confirma y se registra tal cual (600 ms: «Registrar» ignora un doble toque en los 400 ms siguientes)
  await page.waitForTimeout(600);
  await typeInto(page, card.locator('.ses-editor input[aria-label="Peso"]'), '175');
  await card.locator('.ses-register').click();
  await sheet.waitFor();
  await sheet.locator('button', { hasText: 'Sí, registrar' }).click();
  await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.filter((x) => x.done).length === 2, id);
  assert.deepStrictEqual(await done(), [17.5, 175]);

  // la serie siguiente (con 175 prellenado o tecleado) ya no vuelve a preguntar
  await page.waitForTimeout(600);
  await typeInto(page, card.locator('.ses-editor input[aria-label="Peso"]'), '175');
  await card.locator('.ses-register').click();
  await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.filter((x) => x.done).length === 3, id);
  assert.strictEqual(await page.locator('.sheet-overlay.open').count(), 0, 'sin segunda pregunta por lo ya confirmado');
}

async function firstSession(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  const id = await page.evaluate(async () => (await (await import('./js/session-logic.js')).createStrengthSession({ templateId: 'tpl_d1' })).id);
  await go(page, `#/session/${id}`);
  const card = page.locator('.ses-card').first();
  await card.locator('.ses-editor[data-state="editing"]').waitFor();
  await typeInto(page, card.locator('.ses-editor input[aria-label="Peso"]'), '175');
  await card.locator('.ses-register').click();
  await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.some((x) => x.done), id);
  assert.strictEqual(await page.locator('.sheet-overlay.open').count(), 0, 'sin historial no hay con qué comparar');
}

for (const [name, browser, skip] of [['Chromium', 'chromium', false], ['WebKit', 'webkit', skipWebkit]]) {
  test(`peso muy superior al habitual: pregunta, no bloquea y no insiste (${name})`, { skip }, async () => {
    const app = await openApp({ browser });
    try { await flow(app.page); } finally { await app.close(); }
  });
  test(`primera sesión del ejercicio: 175 kg no pregunta (${name})`, { skip }, async () => {
    const app = await openApp({ browser });
    try { await firstSession(app.page); } finally { await app.close(); }
  });
}
