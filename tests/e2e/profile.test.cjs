// E2E del perfil (ronda 5, docs/MEJORAS5.md §2): fila «Perfil» arriba de Ajustes, #/settings/profile (sexo, objetivo,
// experiencia y, en modo mujer, seguimiento del ciclo, anticonceptivo, duraciones y «Incluir el ciclo en el informe»)
// con guardado inmediato en IndexedDB, tarjeta «Completa tu perfil (30 s)» de Hoy («Ahora no» la descarta para
// siempre) y textos en femenino. Botones ≥ 44 px, sin scroll horizontal a 375 px y sin errores de consola.
// Capturas en test-results/profile-*.png (390×844).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/profile.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { waitReady, go, idbAll, reload } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');
const TODAY = '2026-09-24';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

async function launch({ width = 390, height = 844 } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width, height }, deviceScaleFactor: 2, locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block',
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
const markStale = (page) => page.evaluate(() => { const el = document.querySelector('#view > *'); if (el) el.dataset.stale = '1'; });
async function waitFresh(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('#view > *');
    if (!el || el.dataset.stale || !el.querySelector('.topbar')) return false;
    const extra = el.querySelector('.today-extra');
    return !extra || extra.dataset.ready === '1';
  }, null, { timeout: 8000 });
  await page.waitForTimeout(150);
}
async function open(page, hash) { await markStale(page); await go(page, hash); await waitFresh(page); }
async function clickAndWait(page, locator) { await markStale(page); await locator.click(); await waitFresh(page); }
const hashOf = (page) => page.evaluate(() => location.hash);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function shot(page, name) {
  fs.mkdirSync(RESULTS, { recursive: true });
  await page.screenshot({ path: path.join(RESULTS, `${name}.png`), fullPage: false });
}
async function shotAt(page, selector, name, offset = 64) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate((o) => window.scrollBy(0, -o), offset);
  await page.waitForTimeout(150);
  await shot(page, name);
  await page.evaluate(() => window.scrollTo(0, 0));
}
/** Perfil guardado en disco (IndexedDB). */
const diskProfile = async (page) => (await idbAll(page, 'meta')).find((m) => m.id === 'settings').profile;
/** Botones y filas con interruptor (toda la fila es la etiqueta del interruptor) de menos de 44 px de alto. */
const smallButtons = (page, sel) => page.locator(`${sel} button, ${sel} label.switch-row`).evaluateAll((els) => els
  .filter((e) => e.offsetParent !== null)
  .map((e) => ({ t: e.textContent.trim().slice(0, 30), h: e.getBoundingClientRect().height }))
  .filter((r) => r.h < 43.5));
const startVisible = (page) => page.evaluate(() => {
  const b = document.querySelector('.today-plan .today-start');
  const tab = document.getElementById('tabbar').getBoundingClientRect().top;
  return !!b && b.getBoundingClientRect().bottom <= tab;
});

test('Hoy: «Completa tu perfil (30 s)» tras «Te toca hoy»; «Completar» lleva al perfil y «Ahora no» la descarta para siempre', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await open(page, '#/today');
    const card = page.locator('.today-profile');
    assert.strictEqual(await card.count(), 1);
    assert.match(await card.innerText(), /Completa tu perfil \(30 s\)/);
    assert.strictEqual(await page.evaluate(() => document.querySelector('.today-plan').nextElementSibling.classList.contains('today-profile')), true, 'justo después de «Te toca hoy»');
    assert.ok(await startVisible(page), '«Empezar» sigue a la vista');
    for (const b of await card.locator('button').all()) assert.ok((await b.boundingBox()).height >= 44);
    await shot(page, 'profile-today-prompt');
    await clickAndWait(page, card.locator('.an-prompt-go'));
    assert.strictEqual(await hashOf(page), '#/settings/profile');
    await open(page, '#/today');
    await page.locator('.today-profile .an-prompt-later').click();
    assert.strictEqual(await page.locator('.today-profile').count(), 0);
    await page.waitForTimeout(200);
    assert.strictEqual((await diskProfile(page)).promptDismissed, true);
    await reload(page);
    await open(page, '#/today');
    assert.strictEqual(await page.locator('.today-profile').count(), 0, 'descartada también tras reabrir');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Perfil (390×844): hombre y mujer, guardado inmediato, fila de Ajustes y textos en femenino', async () => {
  const app = await launch();
  const { page } = app;
  try {
    // Ajustes: fila «Perfil» arriba del todo, sin completar
    await open(page, '#/settings');
    const row = page.locator('.cfg-profile-row');
    assert.strictEqual(await page.evaluate(() => document.querySelector('.content .list .cfg-profile-row') === document.querySelector('.content .list .list-item')), true, 'la primera fila');
    assert.match(await row.innerText(), /Perfil[\s\S]*Completar[\s\S]*Sexo, objetivo y experiencia/);
    await clickAndWait(page, row);
    assert.strictEqual(await hashOf(page), '#/settings/profile');
    assert.strictEqual(await page.locator('[data-block="cycle"]').count(), 0, 'sin sexo no hay bloque del ciclo');

    // Hombre · Ganar músculo · Intermedio (cada toque se guarda ya)
    await page.locator('[data-block="sex"] .seg-btn', { hasText: 'Hombre' }).click();
    assert.strictEqual((await diskProfile(page)).sex, 'male');
    await page.locator('[data-choice="goal"] [data-value="gain"]').click();
    await page.locator('[data-choice="experience"] [data-value="intermediate"]').click();
    let p = await diskProfile(page);
    assert.deepStrictEqual([p.sex, p.goal, p.experience], ['male', 'gain', 'intermediate']);
    assert.strictEqual(await page.locator('[data-choice="goal"] [data-value="gain"]').getAttribute('aria-checked'), 'true');
    assert.match(await page.locator('[data-choice="experience"]').innerText(), /Intermedio[\s\S]*Avanzado/);
    assert.strictEqual(await page.locator('[data-block="cycle"]').count(), 0);
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await smallButtons(page, '.cfg-profile'), []);
    await shot(page, 'profile-male');
    await open(page, '#/settings');
    assert.match(await page.locator('.cfg-profile-row .list-item-sub').innerText(), /^Hombre · Ganar músculo · Intermedio$/);
    assert.strictEqual(await page.locator('.cfg-profile-row .badge').count(), 0);
    await shot(page, 'profile-settings-row');

    // Mujer: bloque del ciclo y experiencia en femenino
    await open(page, '#/settings/profile');
    await page.locator('[data-block="sex"] .seg-btn', { hasText: 'Mujer' }).click();
    const cyc = page.locator('[data-block="cycle"]');
    assert.strictEqual(await cyc.count(), 1);
    assert.match(await page.locator('[data-choice="experience"]').innerText(), /Intermedia[\s\S]*Avanzada/);
    assert.strictEqual(await cyc.locator('[data-switch="tracking"] input').isChecked(), true, 'seguimiento activo por defecto');
    assert.strictEqual(await cyc.locator('[data-switch="report"] input').isChecked(), false, 'el ciclo no va en el informe por defecto');
    assert.match(await cyc.locator('.cfg-contra').innerText(), /Sin indicar/);
    // Anticonceptivo (lista de profile.CONTRACEPTION)
    await cyc.locator('.cfg-contra').click();
    const items = page.locator('.sheet-panel .action-item');
    assert.strictEqual(await items.count(), 9);
    await items.filter({ hasText: 'DIU de cobre' }).click();
    await page.waitForTimeout(400);
    assert.strictEqual((await diskProfile(page)).contraception, 'copper_iud');
    assert.match(await page.locator('[data-block="cycle"] .cfg-contra').innerText(), /DIU de cobre/);
    // Duraciones (steppers): 28 → 29 días; regla 5 → 4
    const cycLen = page.locator('[data-field="cycleLengthGuess"]');
    await cycLen.locator('.stepper-btn').last().click();
    assert.strictEqual(await cycLen.locator('input').inputValue(), '29');
    await page.locator('[data-field="periodLengthGuess"] .stepper-btn').first().click();
    await page.waitForTimeout(500);
    p = await diskProfile(page);
    assert.deepStrictEqual([p.cycleLengthGuess, p.periodLengthGuess], [29, 4]);
    // Incluir el ciclo en el informe
    await page.locator('[data-block="cycle"] [data-switch="report"] .switch').click();
    await page.waitForTimeout(200);
    assert.strictEqual((await diskProfile(page)).cycleInReport, true);
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await smallButtons(page, '.cfg-profile'), []);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    await shot(page, 'profile-female');
    await shotAt(page, '[data-block="cycle"]', 'profile-female-cycle');
    // Seguimiento apagado: se ocultan las opciones del ciclo
    await page.locator('[data-block="cycle"] [data-switch="tracking"] .switch').click();
    await page.waitForTimeout(200);
    assert.strictEqual((await diskProfile(page)).cycleTracking, false);
    assert.strictEqual(await page.locator('[data-block="cycle"] .cfg-contra').count(), 0);
    await page.locator('[data-block="cycle"] [data-switch="tracking"] .switch').click();
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator('[data-block="cycle"] .cfg-contra').count(), 1);

    await open(page, '#/settings');
    assert.match(await page.locator('.cfg-profile-row .list-item-sub').innerText(), /^Mujer · Ganar músculo · Intermedia$/);
    // Hoy en modo mujer: tarjeta del ciclo (sin reglas: «Registra tu regla»), sin invitación al perfil
    await open(page, '#/today');
    assert.strictEqual(await page.locator('.today-profile').count(), 0);
    assert.match(await page.locator('.cyc-today').innerText(), /Registra tu regla/);
    await shot(page, 'profile-today-female');

    // Vuelta a hombre: fuera el ciclo; la elección del ciclo se conserva por si vuelve
    await open(page, '#/settings/profile');
    await page.locator('[data-block="sex"] .seg-btn', { hasText: 'Hombre' }).click();
    assert.strictEqual(await page.locator('[data-block="cycle"]').count(), 0);
    assert.match(await page.locator('[data-choice="experience"]').innerText(), /Intermedio/);
    await open(page, '#/today');
    assert.strictEqual(await page.locator('.cyc-today').count(), 0);
    assert.strictEqual((await diskProfile(page)).contraception, 'copper_iud');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Perfil a 375×667: sin scroll horizontal, objetivos táctiles ≥ 44 px y atrás a Ajustes', async () => {
  const app = await launch({ width: 375, height: 667 });
  const { page } = app;
  try {
    await page.evaluate(async () => { const s = window.__app.store; const st = s.settings(); st.profile.sex = 'female'; await s.save('meta', st); });
    await open(page, '#/settings');
    await clickAndWait(page, page.locator('.cfg-profile-row'));
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await smallButtons(page, '.cfg-profile'), []);
    const cut = await page.locator('.cfg-profile .list-item-title, .cfg-profile .seg-btn').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    assert.deepStrictEqual(cut, []);
    await shot(page, 'profile-female-375');
    await clickAndWait(page, page.locator('.topbar .back-btn'));
    assert.strictEqual(await hashOf(page), '#/settings');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
