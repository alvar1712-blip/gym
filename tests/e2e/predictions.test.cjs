// E2E de #/predictions (tiempos previstos y «¿Puedo hacerlo?», docs/MEJORAS.md §4). Fecha fijada: jueves 24 sep
// 2026. Estado vacío (sin carreras y con 1 válida), tarjetas de 5 km / 10 km / media / maratón con los mismos números
// que js/race-predict.js, «¿Por qué?», base del cálculo (el senderismo no cuenta) y el comprobador en sus tres
// veredictos y con «Otra» distancia. Deja capturas a 390 px en test-results/.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/predictions.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
// Motor: Chromium por defecto o WebKit con E2E_BROWSER=webkit (fase H de la ronda 6).
const playwright = require('playwright');
const { devices } = playwright;
const { waitReady, go, BROWSER } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');
const TODAY = '2026-09-24';
/** Hora local de Madrid (CEST, +02:00). */
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}
const ago = (n) => addDays(TODAY, -n);

async function launch({ width = 390, height = 844 } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await playwright[BROWSER].launch();
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width, height }, deviceScaleFactor: 2, locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block',
  });
  await context.clock.install({ time: madrid(TODAY, 12) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(server.url);
  await waitReady(page);
  return { browser, page, errors, close: async () => { await browser.close(); await server.close(); } };
}

/** Espera a que se monte la vista nueva (no la anterior mientras carga el módulo). */
async function open(page, hash) {
  await page.evaluate(() => { const el = document.querySelector('#view > *'); if (el) el.dataset.stale = '1'; });
  await go(page, hash);
  await page.waitForFunction(() => {
    const el = document.querySelector('#view > *');
    return !!el && !el.dataset.stale && !!el.querySelector('.topbar');
  }, null, { timeout: 5000 });
  await page.waitForTimeout(120);
}

async function shot(page, name, fullPage = false) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}
/** Texto visible sin espacios duros ni uniones invisibles (la vista evita cortes feos con ellos). */
const clean = (t) => String(t ?? '').replace(/\u00a0/g, ' ').replace(/\u2060/g, '');
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

function activity(id, kind, date, km, sec, extra = {}) {
  const at = madrid(date, 8);
  return {
    id, kind, date, planDate: date, templateId: null, templateName: null, status: 'done', startedAt: null, endedAt: null,
    movingSec: sec, elapsedSec: sec, durationMin: sec / 60, rpe: 6, distanceKm: km, subtype: null, notes: '', parentId: null,
    parentItemId: null, templateItemId: null, createdAt: at, updatedAt: at, ...extra,
  };
}
async function seed(page, sessions) {
  await page.evaluate(async (list) => {
    for (const s of list) await window.__app.store.save('sessions', s);
  }, sessions);
}
/** Lo que calcula js/race-predict.js con los datos del store (la vista debe enseñar lo mismo). */
async function expected(page) {
  return page.evaluate(async () => {
    const rp = await import('./js/race-predict.js');
    const { dataFromStore } = await import('./js/progress-ui.js');
    const r = rp.predictRaces(dataFromStore());
    if (!r.ok) return { ok: false, valid: r.valid };
    const out = {};
    for (const [id, p] of Object.entries(r.predictions)) {
      out[id] = { low: p.low, mid: p.mid, high: p.high, range: rp.rangeText(p), confidence: p.confidence, adjusted: p.adjusted, k: p.k };
    }
    return { ok: true, predictions: out, basis: r.basis.map((e) => ({ id: e.sessionId, km: e.km })), weeklyKm: r.weeklyKm, longestRecentKm: r.longestRecentKm };
  });
}
async function setTarget(page, sec) {
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  await page.fill('.prd-check input[aria-label="Tiempo objetivo: h"]', hh ? String(hh) : '');
  await page.fill('.prd-check input[aria-label="Tiempo objetivo: min"]', String(mm));
  await page.fill('.prd-check input[aria-label="Tiempo objetivo: s"]', String(ss));
  await page.waitForTimeout(60);
}
const verdict = (page) => page.locator('.prd-verdict').evaluate((el) => ({
  verdict: el.dataset.verdict,
  label: el.querySelector('.prd-v-label').textContent,
  gap: el.querySelector('.prd-v-gap')?.textContent || '',
  text: el.querySelector('.prd-v-text').textContent,
  border: getComputedStyle(el).borderTopColor,
}));

// Carreras de las últimas semanas (~13 km/sem, tirada de 12 km) + senderismo y bici que NO deben contar.
const RUNS = [
  activity('run_a', 'run', ago(2), 10, 49 * 60 + 10), // 10 km en 49:10
  activity('run_b', 'run', ago(6), 5, 23 * 60 + 40), // 5 km en 23:40
  activity('run_c', 'run', ago(9), 6, 32 * 60), // suave
  activity('run_d', 'run', ago(13), 8, 40 * 60 + 30),
  activity('run_e', 'run', ago(20), 12, 63 * 60),
  activity('run_f', 'run', ago(27), 5, 24 * 60 + 5),
  activity('run_g', 'run', ago(34), 7, 37 * 60),
  activity('run_h', 'run', ago(41), 2.5, 13 * 60), // corta: suma km pero no es esfuerzo válido
  activity('run_old', 'run', ago(120), 21.1, 100 * 60), // fuera de las 12 semanas
];
const OTHERS = [
  activity('hike_fast', 'hike', ago(3), 20, 80 * 60, { elevationM: 600, templateName: 'Senderismo' }), // 4:00 /km: dominaría si contara
  activity('bike_1', 'bike', ago(4), 40, 80 * 60),
];

test('estado vacío: sin carreras y con 1 válida; acceso a registrar una carrera', async () => {
  const app = await launch();
  const { page, errors } = app;
  try {
    await open(page, '#/predictions');
    assert.equal(await page.locator('.topbar h1').textContent(), 'Tiempos previstos');
    assert.equal(await page.locator('.back-btn').count(), 1, 'botón atrás');
    assert.equal(await page.locator('.content.prd').getAttribute('data-ok'), '0');
    const txt = await page.locator('.prd-empty').textContent();
    assert.match(txt, /Aún no hay datos suficientes/);
    assert.match(txt, /al menos 2 carreras de 3 km o más en las últimas 12 semanas/);
    assert.match(txt, /0 de 2 carreras válidas/);
    assert.equal(await page.locator('.prd-race').count(), 0);
    assert.equal(await page.locator('.prd-check').count(), 0);
    assert.ok(await noHScroll(page));
    await shot(page, 'predictions-empty');

    // Una válida + una corta + senderismo → sigue vacío, «1 de 2» y qué no cuenta.
    await seed(page, [RUNS[0], RUNS[7], OTHERS[0]]);
    await open(page, '#/today');
    await open(page, '#/predictions');
    const txt2 = await page.locator('.prd-empty').textContent();
    assert.match(txt2, /1 de 2 carreras válidas/);
    assert.match(txt2, /Llevas 1: te falta otra/);
    assert.match(txt2, /No cuentan: 1 carrera de menos de 3\s?km/);
    assert.equal(await page.locator('.prd-dot.on').count(), 1);
    await page.locator('.prd-empty .why-btn').click();
    assert.match(await page.locator('.prd-empty .why-body').textContent(), /Carreras válidas1 de 2 necesarias/);
    await shot(page, 'predictions-empty-one');
    assert.ok(await noHScroll(page));

    await page.getByRole('button', { name: 'Registrar una carrera' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/activity/new'));
    assert.equal(await page.evaluate(() => location.hash), '#/activity/new?kind=run');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('con carreras: tarjetas de las 4 distancias, «¿Por qué?», base (sin senderismo) y comprobador', async () => {
  const app = await launch();
  const { page, errors } = app;
  try {
    await seed(page, [...RUNS, ...OTHERS]);
    await open(page, '#/predictions');
    assert.equal(await page.locator('.content.prd').getAttribute('data-ok'), '1');
    const exp = await expected(page);
    assert.equal(exp.ok, true);

    // --- Tarjetas: mismos números que la lógica ---
    const cards = await page.locator('.prd-race').evaluateAll((els) => els.map((el) => ({
      race: el.dataset.race,
      confidence: el.dataset.confidence,
      name: el.querySelector('.prd-race-name').textContent,
      range: el.querySelector('.prd-race-range').textContent,
      pace: el.querySelector('.prd-race-pace').textContent.replace(/\u00a0/g, ' ').replace(/\u2060/g, ''),
      badge: el.querySelector('.prd-conf').textContent,
      note: el.querySelector('.prd-race-note')?.textContent || null,
    })));
    assert.deepEqual(cards.map((c) => c.race), ['5k', '10k', 'half', 'marathon']);
    assert.deepEqual(cards.map((c) => c.name), ['5 km', '10 km', 'Media maratón', 'Maratón']);
    for (const c of cards) {
      const e = exp.predictions[c.race];
      assert.equal(c.range, e.range, c.race);
      assert.match(c.range, /^\d{1,2}:\d{2}(:\d{2})?–\d{1,2}:\d{2}(:\d{2})?$/);
      assert.equal(c.confidence, e.confidence);
      assert.equal(c.badge, `Confianza ${e.confidence}`);
      assert.match(c.pace, /^\d:\d{2}–\d:\d{2}\s\/km$/);
      assert.equal(!!c.note, e.adjusted, `nota de volumen en ${c.race}`);
    }
    // Poco volumen para maratón: k mayor, confianza baja y nota.
    assert.ok(exp.predictions.marathon.k > 1.06);
    assert.equal(exp.predictions.marathon.confidence, 'baja');
    assert.match(cards[3].note, /Más prudente por volumen/);

    // --- El senderismo y la bici no cuentan ---
    assert.ok(!exp.basis.some((b) => b.id === 'hike_fast' || b.id === 'bike_1'));
    assert.equal(exp.longestRecentKm, 12);
    const efforts = await page.locator('.prd-effort').evaluateAll((els) => els.map((el) => el.dataset.session));
    assert.deepEqual(efforts, exp.basis.map((b) => b.id));
    assert.equal(efforts.length, 3);
    const kpis = await page.locator('.prd-kpis .kpi').evaluateAll((els) => els.map((el) => el.querySelector('.kpi-value').textContent));
    assert.equal(kpis[1].replace(/\s/g, ' '), '12 km');
    assert.equal(kpis[2], '7'); // válidas: 8 de ≥ 3 km en 12 semanas menos la corta
    assert.ok(await noHScroll(page));
    await shot(page, 'predictions-top');
    await shot(page, 'predictions-full', true);

    // --- «¿Por qué?» de la media ---
    const half = page.locator('.prd-race[data-race="half"]');
    await half.locator('.why-btn').click();
    const why = await half.locator('.why-body').textContent();
    assert.match(why, /Regla\. Fórmula de Riegel/);
    assert.match(why, /k usado/);
    assert.match(why, /Km por semana/);
    assert.match(why, /Tirada más larga/);
    assert.match(why, /estimación, no una promesa/);
    await half.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -70));
    await page.waitForTimeout(80);
    assert.ok(await noHScroll(page));
    await shot(page, 'predictions-why');
    await half.locator('.why-btn').click();

    // --- ¿Puedo hacerlo? ---
    const check = page.locator('.prd-check');
    await check.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -70));
    assert.match(await check.locator('.prd-verdict-empty').textContent(), /Escribe tu tiempo objetivo/);
    await check.getByRole('button', { name: '5 km', exact: true }).click();
    const p5 = exp.predictions['5k'];
    assert.match(clean(await check.locator('.prd-check-hint').textContent()), new RegExp(`Previsto en 5 km: ${p5.range}`));

    await setTarget(page, p5.high + 30);
    const vp = await verdict(page);
    assert.equal(vp.verdict, 'probable');
    assert.equal(vp.label, 'Probable');
    assert.match(vp.gap, /Margen/);

    await setTarget(page, p5.mid);
    const va = await verdict(page);
    assert.equal(va.verdict, 'ajustado');
    assert.equal(va.label, 'Ajustado');
    assert.match(va.text, /sin margen/);

    const target = p5.low - 60;
    await setTarget(page, target);
    const vn = await verdict(page);
    assert.equal(vn.verdict, 'hoy_no');
    assert.equal(vn.label, 'Hoy no');
    const gapWords = await page.evaluate(async (g) => (await import('./js/race-predict.js')).fmtGap(g), p5.mid - target);
    assert.match(clean(vn.gap), new RegExp(`Te faltan≈ ${gapWords}`));
    assert.match(vn.text, /hoy te faltarían unos/);
    assert.notEqual(vn.border, vp.border, 'cada veredicto con su color');
    assert.notEqual(vn.border, va.border);
    await check.locator('.prd-verdict .why-btn').click();
    const vwhy = await check.locator('.prd-verdict .why-body').textContent();
    assert.match(vwhy, /→ hoy no/);
    assert.match(vwhy, /Diferencia\s*faltan/);
    await check.locator('.prd-verdict').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -250));
    await page.waitForTimeout(80);
    await shot(page, 'predictions-check-hoy-no');

    // Maratón en 3 h: hoy no, con confianza baja avisada.
    await check.getByRole('button', { name: 'Maratón', exact: true }).click();
    await setTarget(page, 3 * 3600);
    const vm = await verdict(page);
    assert.equal(vm.verdict, 'hoy_no');
    assert.match(vm.text, /confianza de esta estimación es baja/);

    // Otra distancia: 15 km.
    await check.getByRole('button', { name: 'Otra', exact: true }).click();
    const kmInput = check.locator('input[aria-label="Otra distancia en km"]');
    await kmInput.waitFor({ state: 'visible' });
    await kmInput.fill('0,5');
    assert.match(await check.locator('.prd-verdict-empty').textContent(), /entre 1 y 100 km/);
    await kmInput.fill('15');
    await setTarget(page, 2 * 3600);
    const vo = await verdict(page);
    assert.equal(vo.verdict, 'probable');
    assert.match(clean(await check.locator('.prd-check-hint').textContent()), /Previsto en 15 km: /);
    assert.ok(await noHScroll(page));
    await check.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -70));
    await page.waitForTimeout(80);
    await shot(page, 'predictions-check-otra');

    // Al volver a la pantalla se conserva lo elegido.
    await open(page, '#/progress');
    await open(page, '#/predictions');
    assert.equal(await page.locator('.prd-check input[aria-label="Otra distancia en km"]').inputValue(), '15');
    assert.equal(await page.locator('.prd-verdict').getAttribute('data-verdict'), 'probable');

    // Base al final de la pantalla.
    await page.locator('.prd-basis').evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(80);
    await shot(page, 'predictions-basis');

    // Un esfuerzo abre su actividad.
    await page.locator('.prd-effort').first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/activity/'));
    assert.equal(await page.evaluate(() => location.hash), `#/activity/${exp.basis[0].id}`);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});
