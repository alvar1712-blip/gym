// E2E de la ronda 6, fase D (docs/MEJORAS6.md): carga por deporte, volumen con contexto e interferencia personal en
// «Tu análisis». Datos sintéticos relativos a hoy: pierna cada 4 días durante 10 semanas, la mitad con una carrera
// exigente el día antes (y esas sesiones un 6 % peores), y una carrera larga hoy (pico de carga de carrera).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/analysis-hybrid.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, settle, shot, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

async function seed(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const db = await import('./js/db.js');
    const { store } = window.__app;
    const T = u.todayStr();
    const back = (k) => u.addDays(T, -k);
    const sessions = [];
    let n = 0;
    const leg = (date, w) => {
      const id = `s${n++}`;
      sessions.push({ id, kind: 'strength', status: 'done', date, planDate: date, templateName: 'Pierna', startedAt: u.tsFromDate(date, 18), createdAt: u.tsFromDate(date, 18), durationMin: 60, rpe: 7,
        exercises: [{ id: `${id}e`, exerciseId: 'sentadilla', exName: 'Sentadilla', sets: [0, 1].map((k) => ({ id: `${id}x${k}`, type: 'effective', done: true, weight: w, reps: 5, rir: 0 })) }] });
    };
    const run = (date, min, rpe) => {
      const id = `r${n++}`;
      sessions.push({ id, kind: 'run', status: 'done', date, subtype: 'intervals', startedAt: u.tsFromDate(date, 8), createdAt: u.tsFromDate(date, 8), durationMin: min, movingSec: min * 60, distanceKm: 8, rpe });
    };
    for (let i = 17; i >= 1; i--) {
      const date = back(i * 4 - 2);
      const bad = i % 2 === 0;
      leg(date, bad ? 94 : 100);
      if (bad) run(u.addDays(date, -1), 45, 8);
    }
    run(T, 100, 8);
    const settings = store.settings();
    settings.weekPatterns = [];
    settings.profile = { ...(settings.profile || {}), sex: 'male', goal: 'gain', experience: 'intermediate', birthDate: '1990-05-01', sports: ['strength', 'run'], weeklyFrequency: 3, promptDismissed: true, onboardedAt: 1 };
    await db.putStores({ sessions, meta: [settings] });
  });
  await reload(page);
}

async function flow(page, { shots = false } = {}) {
  await seed(page);
  await go(page, '#/analysis');
  // Carga por deporte: cada deporte aparte, con su carga media semanal
  const load = page.locator('.an-card-endurance [data-block="sport-load"]');
  await load.waitFor();
  const sports = await load.locator('.an-load-row').evaluateAll((els) => els.map((e) => e.dataset.sport));
  assert.ok(sports.includes('run') && sports.includes('strength'), sports.join(','));
  assert.match(await load.locator('.an-load-row[data-sport="run"] .an-load-val').innerText(), /^\d+\smin · carga [\d.]+$/);
  // Pico de carga de carrera esta semana (con su confianza)
  const spike = page.locator('.an-ins[data-insight="load-sport"]');
  assert.strictEqual(await spike.locator('.an-ins-title').innerText(), 'Pico de carga en carrera');
  assert.ok(await spike.getAttribute('data-confidence'));
  // Interferencia personal: «aparece asociado», nunca «causa»
  const assoc = page.locator('.an-ins[data-insight="assoc-legs-after-endurance"]');
  assert.match(await assoc.locator('.an-ins-text').innerText(), /aparecen asociadas a un rendimiento un \d+(,\d)?\s% menor/);
  assert.doesNotMatch(await assoc.locator('.an-ins-text').innerText(), /\bcausa\b(?! demostrada)/);
  // Volumen con contexto en la tarjeta de fuerza
  assert.strictEqual(await page.locator('.an-card-strength .an-ins[data-insight="strength-volume"]').count(), 1);
  // Todas las conclusiones, en todas las tarjetas, llevan su confianza (la proteína es una referencia, no una conclusión)
  const missing = await page.locator('.an-ins').evaluateAll((els) => els.filter((e) => !e.dataset.confidence && !/protein|retention/.test(e.dataset.insight)).map((e) => e.dataset.insight));
  assert.deepStrictEqual(missing, [], 'sin confianza');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sin desplazamiento horizontal');
  if (shots) { await load.scrollIntoViewIfNeeded(); await settle(page); await shot(page, 'analysis-hybrid-load'); }
}

test('análisis híbrido: carga por deporte, pico, interferencia personal y volumen, todo con confianza (375 px)', async () => {
  const app = await openApp();
  try {
    await app.page.setViewportSize({ width: 375, height: 667 });
    await flow(app.page, { shots: true });
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// Regresión (fallo anterior a la ronda 6): con un objetivo elegido y ningún pesaje, la tarjeta de peso no tenía
// proteína ni ajuste que mostrar, nutritionRow devolvía null y appendChild(null) rompía toda la pantalla.
test('objetivo elegido y ningún pesaje: «Tu análisis» se abre y la tarjeta de peso lleva a registrar el peso', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.evaluate(async () => {
      const u = await import('./js/util.js');
      const db = await import('./js/db.js');
      const settings = window.__app.store.settings();
      settings.profile = { ...(settings.profile || {}), sex: 'female', goal: 'lose', birthDate: '1985-02-01', promptDismissed: true, onboardedAt: 1 };
      const date = u.addDays(u.todayStr(), -10);
      const sessions = [{ id: 's1', kind: 'run', status: 'done', date, startedAt: u.tsFromDate(date, 8), createdAt: u.tsFromDate(date, 8), durationMin: 30, movingSec: 1800, distanceKm: 5, rpe: 5 }];
      await db.putStores({ sessions, meta: [settings] });
    });
    await reload(page);
    await go(page, '#/analysis');
    const wcard = page.locator('.an-card-weight');
    await wcard.waitFor();
    assert.strictEqual(await wcard.locator('.an-kpis').count(), 0, 'sin tiles de proteína ni de calorías');
    assert.match(await wcard.innerText(), /Peso corporal: registrar y ver la gráfica/);
    assert.strictEqual(await page.locator('.an-card-endurance [data-block="sport-load"] .an-load-row[data-sport="run"]').count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('WebKit: análisis híbrido', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit' });
  try {
    await flow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
