// E2E de la bienvenida y del perfil ampliado (ronda 6, docs/MEJORAS6.md): perfil nuevo → 3 pasos saltables (4 con «Tu
// semana», ronda 8 B2, que prueba week-setup.test) que guardan
// al momento (sexo, fecha de nacimiento, objetivo, experiencia, deportes, días, otros objetivos, fase actual y
// molestias); saltarlo todo no obliga a nada; usuarios existentes nunca la ven (invitación discreta en Análisis); campos
// nuevos en #/settings/profile.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/onboarding.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, idbAll, shot } = require('./helpers.cjs');

const TODAY = '2026-10-02';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const atToday = { beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } };

const hashOf = (page) => page.evaluate(() => location.hash);
const diskProfile = async (page) => (await idbAll(page, 'meta')).find((m) => m.id === 'settings').profile;
async function waitView(page, sel) { await page.waitForSelector(sel, { timeout: 8000 }); await page.waitForTimeout(200); }
const chip = (page, block, text) => page.locator(`[data-block="${block}"] .chip`, { hasText: text }).first();
async function setDate(page, sel, value) {
  await page.locator(sel).fill(value);
  await page.locator(sel).dispatchEvent('change');
  await page.waitForTimeout(150);
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const smallButtons = (page, sel) => page.locator(`${sel} button, ${sel} input`).evaluateAll((els) => els
  .filter((e) => e.offsetParent !== null)
  .map((e) => ({ t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), h: e.getBoundingClientRect().height }))
  .filter((r) => r.h < 43.5));

test('bienvenida completa: guarda el perfil al momento y crea la fase actual', async () => {
  const app = await openApp(atToday);
  const { page } = app;
  try {
    await page.locator('.today-profile .an-prompt-go').click();
    await waitView(page, '.wel-title');
    assert.strictEqual(await hashOf(page), '#/welcome');
    assert.match(await page.locator('.wel-title').innerText(), /1\. Sobre ti/);
    assert.strictEqual(await page.locator('.wel-progress').getAttribute('aria-valuenow'), '1');

    // Paso 1: Mujer, 16 años (menor)
    await page.locator('[data-block="sex"] .seg-btn', { hasText: 'Mujer' }).click();
    await setDate(page, '.wel-birth', '2010-05-20');
    assert.match(await page.locator('.wel-age').innerText(), /Tienes 16 años/);
    let p = await diskProfile(page);
    assert.deepStrictEqual([p.sex, p.birthDate], ['female', '2010-05-20'], 'cada respuesta se guarda ya');
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await smallButtons(page, '.wel'), []);
    await shot(page, 'welcome-1');
    await page.locator('.wel-next').click();

    // Paso 2: objetivo, experiencia (en femenino), deportes, días y otros objetivos
    await waitView(page, '[data-step="2"]');
    await chip(page, 'goal', 'Ganar músculo').click();
    assert.strictEqual(await page.locator('[data-block="secondary"] .chip', { hasText: 'Ganar músculo' }).count(), 0, 'el principal no se ofrece como secundario');
    assert.match(await page.locator('[data-block="experience"]').innerText(), /Principiante[\s\S]*Intermedia[\s\S]*Avanzada/);
    await chip(page, 'experience', 'Principiante').click();
    await chip(page, 'sports', 'Fuerza').click();
    await chip(page, 'sports', 'Carrera').click();
    await chip(page, 'frequency', '3').click();
    await chip(page, 'secondary', 'Salud y bienestar').click();
    assert.deepStrictEqual(await smallButtons(page, '.wel'), []);
    await shot(page, 'welcome-2');
    await page.locator('.wel-next').click();

    // Paso 3 (ronda 8, B2): «Tu semana», solo para un perfil sin semana tipo; aquí se salta (week-setup.test lo prueba)
    await waitView(page, '[data-step="3"][data-id="week"]');
    await page.locator('.wel-skip').click();

    // Paso 4: fase actual y molestias → Listo
    await waitView(page, '[data-step="4"]');
    await chip(page, 'phase', 'Vuelta tras vacaciones o parón').click();
    await page.locator('[data-block="limitations"] textarea').fill('Molestia en la rodilla izquierda al correr cuesta abajo');
    await shot(page, 'welcome-3');
    await page.locator('.wel-next').click();
    await waitView(page, '.today-plan');
    assert.strictEqual(await hashOf(page), '#/today');

    p = await diskProfile(page);
    assert.deepStrictEqual(
      [p.sex, p.birthDate, p.goal, p.experience, p.sports, p.weeklyFrequency, p.secondaryGoals, p.limitations],
      ['female', '2010-05-20', 'gain', 'beginner', ['strength', 'run'], 3, ['health'], 'Molestia en la rodilla izquierda al correr cuesta abajo'],
    );
    assert.strictEqual(typeof p.onboardedAt, 'number');
    const ctx = await idbAll(page, 'context');
    assert.strictEqual(ctx.length, 1);
    assert.deepStrictEqual([ctx[0].kind, ctx[0].type, ctx[0].start, ctx[0].end], ['phase', 'return', { date: '2026-10-01', precision: 'month' }, null]);

    // Hoy: sin invitación (perfil completo), con la línea «Ahora» y, en modo mujer, la tarjeta del ciclo
    assert.strictEqual(await page.locator('.today-profile').count(), 0);
    assert.match(await page.locator('.today-context').innerText(), /Vuelta tras vacaciones o parón · desde oct 2026/);
    await page.waitForSelector('.cyc-today');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('bienvenida saltada: nada obligatorio y no se vuelve a ofrecer como perfil nuevo', async () => {
  const app = await openApp(atToday);
  const { page } = app;
  try {
    await page.locator('.today-profile .an-prompt-go').click();
    await waitView(page, '.wel-title');
    // Fecha imposible: aviso y no se guarda
    await setDate(page, '.wel-birth', '2027-01-01');
    assert.match(await page.locator('[data-block="birth"] .form-error').innerText(), /Revisa la fecha/);
    assert.strictEqual((await diskProfile(page)).birthDate ?? null, null, 'no se guarda (en disco el campo ni existe aún)');
    await page.locator('.wel-skip').click();
    await waitView(page, '[data-step="2"]');
    await page.locator('.wel-prev').click();
    await waitView(page, '[data-step="1"]');
    await page.locator('.wel-skip').click();
    await page.locator('.wel-skip').click();
    await waitView(page, '[data-step="3"]');
    assert.match(await page.locator('.wel-skip').innerText(), /^Saltar$/, '«Tu semana» (ronda 8, B2) también se salta');
    await page.locator('.wel-skip').click();
    await waitView(page, '[data-step="4"]');
    assert.match(await page.locator('.wel-skip').innerText(), /Saltar y terminar/);
    await page.locator('.wel-skip').click();
    await waitView(page, '.today-plan');
    const p = await diskProfile(page);
    assert.deepStrictEqual([p.sex, p.goal, p.experience, p.birthDate], [null, null, null, null]);
    assert.strictEqual(typeof p.onboardedAt, 'number');
    assert.deepStrictEqual(await idbAll(page, 'context'), [], 'sin fase elegida no se crea contexto');
    // La invitación de Hoy sigue (perfil sin completar), pero ya lleva al perfil, no a la bienvenida
    await page.locator('.today-profile .an-prompt-go').click();
    await waitView(page, '.cfg-profile');
    assert.strictEqual(await hashOf(page), '#/settings/profile');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('usuario existente: nunca ve la bienvenida; invitación discreta en Análisis y campos nuevos en el perfil', async () => {
  const app = await openApp(atToday);
  const { page } = app;
  try {
    // Perfil de la ronda 5 ya completo (sin los datos nuevos)
    await page.evaluate(async () => {
      const s = window.__app.store; const st = s.settings();
      st.profile = { ...st.profile, sex: 'male', goal: 'gain', experience: 'advanced' };
      await s.save('meta', st);
    });
    await go(page, '#/today');
    await waitView(page, '.today-plan');
    assert.strictEqual(await page.locator('.today-profile').count(), 0, 'Hoy no cambia para un perfil completo');
    await go(page, '#/analysis');
    await waitView(page, '.an-profile-more');
    assert.match(await page.locator('.an-profile-more').innerText(), /Completa tu perfil para mejorar el análisis \(fecha de nacimiento, deportes, días por semana\)/);
    assert.strictEqual(await page.locator('.an-profile').count(), 0);
    await page.locator('.an-profile-more').click();
    await waitView(page, '.cfg-profile');
    assert.strictEqual(await hashOf(page), '#/settings/profile');

    // Fecha de nacimiento: edad y prudencia; una futura se rechaza
    await setDate(page, '.cfg-birth', '1958-03-10');
    assert.match(await page.locator('[data-block="birth"] .cfg-why').innerText(), /68 años/);
    assert.strictEqual((await diskProfile(page)).birthDate, '1958-03-10');
    await setDate(page, '.cfg-birth', '2030-01-01');
    assert.match(await page.locator('[data-err="birthDate"]').innerText(), /Revisa la fecha/);
    assert.strictEqual((await diskProfile(page)).birthDate, '1958-03-10');
    // Otros objetivos (sin el principal), deportes, días y molestias
    assert.strictEqual(await page.locator('[data-block="secondary"] .chip', { hasText: 'Ganar músculo' }).count(), 0);
    await chip(page, 'secondary', 'Ganar fuerza').click();
    await chip(page, 'sports', 'Senderismo').click();
    await page.locator('[data-block="sports"] .cfg-frequency .chip', { hasText: '4' }).click();
    await page.locator('[data-block="limitations"] textarea').fill('Hombro derecho');
    await page.waitForTimeout(500);
    const p = await diskProfile(page);
    assert.deepStrictEqual([p.secondaryGoals, p.sports, p.weeklyFrequency, p.limitations, p.onboardedAt], [['strength'], ['hike'], 4, 'Hombro derecho', null]);
    assert.deepStrictEqual(await smallButtons(page, '.cfg-profile'), []);
    assert.ok(await noHScroll(page));
    await page.locator('.cfg-context-link').click();
    await waitView(page, '.ctx-now');
    assert.strictEqual(await hashOf(page), '#/context');
    // Con todo completo, la invitación de Análisis desaparece
    await go(page, '#/analysis');
    await waitView(page, '.an-note');
    assert.strictEqual(await page.locator('.an-profile-more').count(), 0);
    // La bienvenida nunca se abre sola
    await go(page, '#/today');
    await waitView(page, '.today-plan');
    assert.strictEqual(await hashOf(page), '#/today');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
