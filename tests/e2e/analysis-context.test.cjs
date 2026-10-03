// E2E de la ronda 6, fase C (docs/MEJORAS6.md): «Tu análisis» con contexto y confianza. Con una bajada de peso previa,
// un parón, la vuelta a entrenar, creatina y una marca histórica de banca, la pantalla debe: mostrar «Tu contexto»,
// no recortar calorías (mantener y reevaluar), decir la confianza de cada conclusión, leer la banca como recuperación
// de una marca anterior y llevar la confianza a la tarjeta de Hoy. También en WebKit si está instalado.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/analysis-context.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, settle, shot, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

/** Datos sintéticos relativos a hoy (ningún dato personal real). */
async function seed(page, { birthDate = '2000-05-01', goal = 'gain', creatine = true } = {}) {
  await page.evaluate(async ({ birthDate, goal, creatine }) => {
    const u = await import('./js/util.js');
    const db = await import('./js/db.js');
    const { store } = window.__app;
    const T = u.todayStr();
    const back = (k) => u.addDays(T, -k);
    const bodyweight = [];
    for (let i = 150; i >= 0; i--) {
      let kg;
      if (i > 93) kg = 75; else if (i > 31) kg = 75 - 3.5 * ((93 - i) / 62); else kg = 71.5 + 0.45 * ((31 - i) / 7);
      if (i % 2 === 0 || i <= 31) bodyweight.push({ id: back(i), kg: Math.round((kg + [0.2, -0.3, 0.1, 0.25, -0.15, -0.2, 0.05][i % 7]) * 10) / 10 });
    }
    const sessions = [];
    let n = 0;
    const bench = (ago, w) => {
      const date = back(ago);
      sessions.push({ id: `s${n++}`, kind: 'strength', status: 'done', date, planDate: date, templateName: 'Sesión', startedAt: u.tsFromDate(date, 18), createdAt: u.tsFromDate(date, 18), durationMin: 60, rpe: 7,
        exercises: [{ id: `se${n}`, exerciseId: 'press_banca', exName: 'Press banca', sets: [0, 1, 2].map((k) => ({ id: `x${n}_${k}`, type: 'effective', done: true, weight: w, reps: 6, rir: 2 })) }] });
    };
    for (const [a, w] of [[150, 85], [136, 87.5], [122, 90], [108, 90], [94, 92.5]]) bench(a, w);
    for (const [a, w] of [[24, 72.5], [21, 75], [17, 77.5], [14, 77.5], [10, 80], [7, 82.5], [3, 82.5], [1, 85]]) bench(a, w);
    const context = creatine ? [{ id: 'c1', kind: 'event', type: 'creatine_start', date: { date: back(12), precision: 'day' }, text: '', notes: '', createdAt: 1, updatedAt: 1 }] : [];
    const pastRecords = [{ id: 'pr1', exerciseId: 'press_banca', weight: 102.5, reps: 5, rir: null, date: { date: '2025-06-01', precision: 'season' }, beforeApp: true, bodyweightKg: null, note: '', createdAt: 1, updatedAt: 1 }];
    const settings = store.settings();
    settings.profile = { ...(settings.profile || {}), sex: 'male', goal, experience: 'advanced', birthDate, sports: ['strength'], weeklyFrequency: 3, promptDismissed: true, onboardedAt: 1 };
    await db.putStores({ sessions, bodyweight, context, pastRecords, meta: [settings] });
  }, { birthDate, goal, creatine });
  await reload(page);
}

async function flow(page, { shots = false } = {}) {
  await seed(page);
  await go(page, '#/analysis');
  // «Tu contexto»: lo detectado (parón y vuelta) y lo apuntado (creatina), con acceso para editarlo
  const ctx = page.locator('.an-ctx');
  const items = await ctx.locator('.an-ctx-item').allInnerTexts();
  assert.ok(items.some((t) => /^Vuelta tras 10 semanas sin entrenar · desde el /.test(t)), items.join(' | '));
  assert.ok(items.some((t) => /^Creatina · desde el /.test(t)), items.join(' | '));
  assert.match(await ctx.locator('.an-ctx-changes').innerText(), /Empiezo creatina/);
  // Peso: contexto, confianza y «Qué hacer» aparte; sin ajuste de calorías
  const w = page.locator('.an-card-weight .an-ins[data-insight="weight-rate"]');
  assert.strictEqual(await w.locator('.an-ins-title').innerText(), 'Subes rápido, pero hay contexto');
  assert.match(await w.locator('.an-conf').innerText(), /^Confianza (baja|media)$/);
  assert.match(await w.locator('.an-ins-text').innerText(), /Parte del aumento podría corresponder a/);
  assert.match(await w.locator('.an-ins-ctx').innerText(), /^Contexto: vienes de una bajada de peso reciente/);
  assert.strictEqual(await w.locator('.an-ins-rec').innerText(), 'Qué hacer: Mantén lo que haces y reevalúa en 3–4 semanas, cuando haya más datos estables.');
  assert.strictEqual(await page.locator('.an-card-weight [data-kpi="adjust"] .kpi-value').innerText(), 'Sin cambios', 'sin «Ajuste orientativo» de calorías');
  assert.strictEqual(await page.locator('.an-card-weight [data-kpi="adjust"] .kpi-sub').innerText(), 'por ahora: reevalúa en unas semanas', 'no dice «estás en tu rango»');
  assert.strictEqual(await page.locator('.an-card-weight [data-kpi="kcal"] .kpi-value').innerText(), '—', 'sin balance en kcal');
  await w.locator('.an-fold-btn[data-fold="why"]').click();
  const rows = await w.locator('.wk-why-label').allInnerTexts();
  assert.deepStrictEqual(rows.slice(-2), ['Contexto tenido en cuenta', 'Confianza'], 'el porqué termina con el contexto y la confianza');
  if (shots) { await w.scrollIntoViewIfNeeded(); await settle(page); await shot(page, 'analysis-context-weight'); }
  // Fuerza: la banca, recuperando la marca anterior (no «progreso por encima de tu nivel»)
  const r = page.locator('.an-card-strength .an-ins[data-insight="strength-recovery"]');
  assert.strictEqual(await r.locator('.an-ins-title').innerText(), 'Press banca: recuperando tu marca anterior');
  assert.match(await r.locator('.an-ins-text').innerText(), /todavía está al \d+ % de tu mejor referencia: 102,5 kg × 5 · verano 2025 \(marca histórica\)/);
  assert.match(await page.locator('.an-ex[data-exercise="press_banca"] .list-item-sub').innerText(), /al \d+\s% de tu marca/);
  // Cada conclusión de peso, fuerza y previsiones lleva su confianza (la proteína es una referencia, no una conclusión)
  const missing = await page.locator('.an-card-weight .an-ins, .an-card-strength .an-ins, .an-card-forecast .an-ins')
    .evaluateAll((els) => els.filter((e) => !e.dataset.confidence && !/protein|retention/.test(e.dataset.insight)).map((e) => e.dataset.insight));
  assert.deepStrictEqual(missing, [], 'sin confianza');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sin desplazamiento horizontal');
  // Hoy: la tarjeta «Tu análisis» con la confianza junto a cada punto
  await go(page, '#/today');
  const sum = page.locator('.an-sum');
  await sum.waitFor();
  const confs = await sum.locator('.an-sum-item .an-conf').allInnerTexts();
  assert.ok(confs.length >= 1 && confs.every((t) => /^(Confianza (alta|media|baja)|Datos insuficientes)$/.test(t)), confs.join(' | '));
  if (shots) { await sum.scrollIntoViewIfNeeded(); await settle(page); await shot(page, 'analysis-context-today'); }
}

test('análisis con contexto y confianza: mantener y reevaluar, recuperación de marca y tarjeta de Hoy (375 px)', async () => {
  const app = await openApp();
  try {
    await app.page.setViewportSize({ width: 375, height: 667 });
    await flow(app.page, { shots: true });
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('WebKit: análisis con contexto y confianza', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit' });
  try {
    await flow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('menor de 18: el análisis no da calorías, ritmos de pérdida ni proyección del peso', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seed(page, { birthDate: '2011-03-01', goal: 'lose', creatine: false });
    await go(page, '#/analysis');
    const w = page.locator('.an-card-weight .an-ins[data-insight="weight-rate"]');
    assert.strictEqual(await w.locator('.an-ins-title').innerText(), 'Tu peso, sin cifras de dieta');
    const card = await page.locator('.an-card-weight').innerText();
    assert.doesNotMatch(card, /kcal|Ajuste orientativo|déficit|Bajar 0,5/i);
    assert.strictEqual(await page.locator('.an-card-weight [data-kpi="adjust"], .an-card-weight [data-kpi="kcal"]').count(), 0, 'sin tiles de calorías');
    assert.strictEqual(await page.locator('.an-card-weight .an-gauge').count(), 0, 'sin barra frente a un rango de pérdida');
    assert.strictEqual(await page.locator('.an-ins[data-insight="forecast-weight"]').count(), 0);
    assert.strictEqual(await page.locator('.an-goal').count(), 0, 'sin objetivo de peso propuesto');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
