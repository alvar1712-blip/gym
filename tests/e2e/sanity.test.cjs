// Valores imposibles o muy raros al apuntar (js/sanity.js, docs/PULIDO.md §14), en la app de verdad:
//   · sesión: 900 kg en una serie → «¿Seguro?»; «Corregir» no la registra; «Sí, registrar» sí;
//   · peso corporal: 210 kg → «¿Seguro?» antes de guardar;
//   · actividad (se guarda sola): 10 km en 2 minutos o FC 600 → no se escribe nada («Sin guardar: revisa los datos»),
//     «Listo» no deja salir; con datos posibles se guarda; uno muy raro pide confirmación al terminar.
// 375 px, Chromium y WebKit. Datos sintéticos.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/sanity.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, idbAll, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

async function typeInto(page, locator, value) {
  await locator.click();
  await locator.fill(value);
  await locator.press('Tab');
}

async function flow(page) {
  await page.setViewportSize({ width: 375, height: 812 });

  // --- Sesión: 900 kg en press banca → «¿Seguro?» ---
  const id = await page.evaluate(async () => (await (await import('./js/session-logic.js')).createStrengthSession({ templateId: 'tpl_d1' })).id);
  await go(page, `#/session/${id}`);
  const card = page.locator('.ses-card').first();
  await card.locator('.ses-editor[data-state="editing"]').waitFor();
  await typeInto(page, card.locator('.ses-editor input[aria-label="Peso"]'), '900');
  await typeInto(page, card.locator('.ses-editor input[aria-label="Repeticiones"]'), '1');
  await card.locator('.ses-register').click();
  const sheet = page.locator('.sheet-overlay.open');
  await sheet.waitFor();
  assert.match(clean(await sheet.innerText()), /¿Seguro\?.*Has puesto 900 kg\. ¿Es correcto\?/);
  await sheet.locator('button', { hasText: 'Corregir' }).click();
  await page.waitForFunction(() => !document.querySelector('.sheet-overlay.open'));
  let s = await page.evaluate((sid) => window.__app.store.get('sessions', sid), id);
  assert.strictEqual(s.exercises[0].sets.filter((x) => x.done).length, 0, '«Corregir» no registra');
  await card.locator('.ses-register').click();
  await sheet.waitFor();
  await sheet.locator('button', { hasText: 'Sí, registrar' }).click();
  await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.some((x) => x.done), id);
  s = await page.evaluate((sid) => window.__app.store.get('sessions', sid), id);
  assert.deepStrictEqual([s.exercises[0].sets[0].weight, s.exercises[0].sets[0].reps], [900, 1], 'confirmado, se registra tal cual');
  // Con un peso normal, nada que preguntar
  await typeInto(page, card.locator('.ses-editor input[aria-label="Peso"]'), '80');
  await card.locator('.ses-register').click();
  await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.filter((x) => x.done).length === 2, id);
  assert.strictEqual(await page.locator('.sheet-overlay.open').count(), 0);

  // --- Peso corporal en Hoy: 210 kg → «¿Seguro?» ---
  await go(page, '#/today');
  const bw = page.locator('.bwq-stepper input');
  await typeInto(page, bw, '210');
  await page.locator('.bwq-save').click();
  await sheet.waitFor();
  assert.match(clean(await sheet.innerText()), /Has puesto 210 kg de peso corporal\. ¿Es correcto\?/);
  await sheet.locator('button', { hasText: 'Sí, guardar' }).click();
  await page.waitForFunction(() => window.__app.store.all('bodyweight').some((b) => b.kg === 210));

  // --- Actividad: 10 km en 2 min → no se guarda; 50 min → se guarda; FC 600 → no se escribe ---
  await go(page, '#/activity/new?kind=run');
  await page.locator('.dur-input').first().waitFor();
  await typeInto(page, page.locator('input[aria-label="Distancia (km)"]'), '10');
  const min = page.locator('.dur-input[aria-label$=": min"]').first();
  await typeInto(page, min, '2');
  await page.waitForFunction(() => /Sin guardar: revisa los datos/.test(document.querySelector('.act-status')?.textContent || ''));
  assert.match(await page.locator('.field-hint.warn, .act-dur-hint, [class*="hint"].warn').first().innerText(), /demasiado rápido|sería un ritmo/);
  assert.strictEqual((await idbAll(page, 'sessions')).filter((x) => x.kind === 'run').length, 0, 'un ritmo imposible no se escribe');
  await page.locator('.act-done').click();
  await page.locator('.toast-error, .toast').first().waitFor();
  assert.match(page.url(), /#\/activity\/new/, '«Listo» no deja salir con un dato imposible');
  await typeInto(page, min, '50');
  await page.waitForFunction(() => /Guardado/.test(document.querySelector('.act-status')?.textContent || ''));
  const run = (await idbAll(page, 'sessions')).find((x) => x.kind === 'run');
  assert.ok(run && run.distanceKm === 10 && run.movingSec === 3000, JSON.stringify(run));
  await typeInto(page, page.locator('input[aria-label="FC media (lpm)"]'), '600');
  await page.waitForFunction(() => /Sin guardar: revisa los datos/.test(document.querySelector('.act-status')?.textContent || ''));
  assert.notStrictEqual((await idbAll(page, 'sessions')).find((x) => x.id === run.id).hrAvg, 600, 'la FC imposible no llega al disco');
  // Muy rara pero posible (FC 220): se guarda, y al terminar se pregunta
  await typeInto(page, page.locator('input[aria-label="FC media (lpm)"]'), '220');
  await page.waitForFunction(() => /Guardado/.test(document.querySelector('.act-status')?.textContent || ''));
  await page.locator('.act-done').click();
  await sheet.waitFor();
  assert.match(clean(await sheet.innerText()), /frecuencia cardiaca de 220 lpm/);
  await sheet.locator('button', { hasText: 'Sí, es correcto' }).click();
  await page.waitForFunction(() => !/#\/activity/.test(location.hash));
  assert.strictEqual((await idbAll(page, 'sessions')).find((x) => x.id === run.id).hrAvg, 220);
}

for (const browser of ['chromium', 'webkit']) {
  test(`${browser === 'webkit' ? 'WebKit: ' : ''}valores imposibles y muy raros: sesión, peso corporal y actividad (375 px)`,
    { skip: browser === 'webkit' ? skipWebkit : false }, async () => {
      const app = await openApp({ browser });
      try {
        await flow(app.page);
        assert.deepStrictEqual(app.errors, []);
      } finally {
        await app.close();
      }
    });
}
