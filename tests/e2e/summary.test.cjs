// E2E de los resúmenes (MEJORAS §5): #/summary?p=month|year&d=YYYY-MM-DD y el bloque «Resumen de la semana» de
// #/weekly. Siembra ~16 meses de datos deterministas (fuerza con progresión, carrera, bici, senderismo, natación y
// otras; diciembre de 2025 vacío) con la fecha fijada (sábado 26 sep 2026). Comprueba: título del periodo, aviso
// «en curso», totales y deportes (color de cada tipo + nombre), días entrenados, fuerza, récords, progreso y
// comparación (flechas y % con texto) frente a lo que calcula summary-logic; navegación ‹ › sin pasar del periodo
// actual y sin llenar el historial (replaceUrl); Mes / Año; estados vacíos; sin errores de consola ni
// desbordamiento horizontal. Capturas en test-results/ (summary-*.png).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/summary.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { waitReady, go } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');
const TODAY = '2026-09-26'; // sábado
const START = '2025-06-02'; // lunes
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

async function launch({ width = 390, height = 844, time = madrid(TODAY, 12) } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width, height }, deviceScaleFactor: 2, locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block',
  });
  if (time) await context.clock.install({ time });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(server.url);
  await waitReady(page);
  return { browser, context, page, errors, close: async () => { await browser.close(); await server.close(); } };
}

/** Espera a que se monte la vista nueva (no la anterior mientras carga el módulo). */
async function open(page, hash) {
  await page.evaluate(() => { const el = document.querySelector('#view > *'); if (el) el.dataset.stale = '1'; });
  await go(page, hash);
  await waitFresh(page);
}
async function waitFresh(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('#view > *');
    return !!el && !el.dataset.stale && !!el.querySelector('.topbar');
  }, null, { timeout: 5000 });
  await page.waitForTimeout(120);
}
async function clickAndWait(page, locator) {
  await page.evaluate(() => { const el = document.querySelector('#view > *'); if (el) el.dataset.stale = '1'; });
  await locator.click();
  await waitFresh(page);
}
/** Pulsa algo que vuelve a pintar la pantalla EN SITIO (replaceUrl, sin montar otra vista). */
async function clickInPlace(page, locator) {
  await page.evaluate(() => { const c = document.querySelector('.sum'); if (c) c.dataset.old = '1'; });
  await locator.click();
  await page.waitForFunction(() => { const c = document.querySelector('.sum'); return !!c && !c.dataset.old; }, null, { timeout: 5000 });
  await page.waitForTimeout(60);
}

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const clipped = (page, sel) => page.locator(sel).evaluateAll((els) => els
  .filter((el) => el.offsetParent && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1))
  .map((el) => el.textContent));

async function shot(page, name) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
async function scrollShots(page, prefix, max = 12) {
  const { H, vh } = await page.evaluate(() => ({ H: document.documentElement.scrollHeight, vh: window.innerHeight }));
  const step = vh - 140;
  for (let y = 0, i = 0; i < max; y += step, i++) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(100);
    await shot(page, `${prefix}-${i}`);
    if (y + vh >= H) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

// ---------------------------------------------------------------------------
// Datos sembrados
// ---------------------------------------------------------------------------
const r25 = (v) => Math.round(v / 2.5) * 2.5;

function strength(id, date, items, { dur = 60, rpe = 8 } = {}) {
  const at = madrid(date, 18);
  return {
    id, kind: 'strength', date, planDate: date, templateId: null, templateName: 'Sesión libre', status: 'done',
    startedAt: at, endedAt: at + dur * 60000, durationMin: dur, rpe, notes: '', parentId: null, templateItemId: null, cursor: 0,
    createdAt: at, updatedAt: at,
    exercises: items.map(([exerciseId, name, weight, reps, rir], i) => ({
      id: `${id}_se${i}`, exerciseId, exName: name, templateItemId: null, alternatives: [], target: {}, notes: '', section: '', groupId: null, groupType: null,
      sets: reps.map((r, j) => ({
        id: `${id}_s${i}_${j}`, type: 'effective', weight, reps: r, repsR: null, rir, timeSec: null, distanceM: null, heightCm: null,
        note: '', done: true, doneAt: at + (i * 5 + j) * 60000,
      })),
    })),
  };
}
function activity(id, kind, date, { km = null, sec, rpe = 5, subtype = null, hh = 8, elevationM = null }) {
  const at = madrid(date, hh);
  return {
    id, kind, date, planDate: date, templateId: null, templateName: null, status: 'done', startedAt: null, endedAt: null,
    movingSec: sec, elapsedSec: sec, durationMin: sec / 60, rpe, distanceKm: km, elevationM, subtype, notes: '', parentId: null,
    parentItemId: null, templateItemId: null, createdAt: at, updatedAt: at,
  };
}

function buildSeed() {
  const out = [];
  const add = (s) => { if (s.date < TODAY && s.date.slice(0, 7) !== '2025-12') out.push(s); };
  for (let w = 0; ; w++) {
    const mon = addDays(START, 7 * w);
    if (mon >= TODAY) break;
    const day = (d) => addDays(mon, d);
    add(strength(`a${w}`, day(0), [
      ['press_banca', 'Press banca', r25(60 + 0.4 * w), [6, 6, 5], 2],
      ['remo_pecho_apoyado', 'Remo con pecho apoyado', r25(50 + 0.2 * w), [10, 10, 9], 1],
    ], { dur: 65, rpe: 8 }));
    if (w % 3 === 1) add(activity(`sw${w}`, 'swim', day(1), { km: 1.5, sec: 2400, rpe: 5 }));
    add(activity(`rz${w}`, 'run', day(2), { km: 6 + (w % 3), sec: (6 + (w % 3)) * 330, rpe: 5, subtype: 'z2' }));
    add(strength(`b${w}`, day(3), [
      ['sentadilla', 'Sentadilla', r25(80 + 0.5 * w), [5, 5, 5], 2],
      ['peso_muerto_rumano', 'Peso muerto rumano', r25(70 + 0.3 * w), [8, 8, 8], 2],
      ['curl_supinador', 'Curl supinador', 10 + (w % 4 === 0 ? 1 : 0), [12, 12], 1],
    ], { dur: 60, rpe: 7 }));
    if (w % 4 === 2) add(activity(`o${w}`, 'other', day(4), { sec: 3600, rpe: 7, subtype: 'basketball', hh: 20 }));
    if (w % 2 === 0) add(activity(`bk${w}`, 'bike', day(5), { km: 40, sec: 5400, rpe: 6, subtype: 'route', hh: 9 }));
    else add(activity(`hk${w}`, 'hike', day(5), { km: 12 + (w % 4) * 2, sec: (12 + (w % 4) * 2) * 900, rpe: 4, elevationM: 500 + (w % 5) * 150, hh: 9 }));
    add(activity(`rl${w}`, 'run', day(6), { km: 10 + (w % 6), sec: (10 + (w % 6)) * 340, rpe: 6, subtype: 'long', hh: 9 }));
  }
  return out;
}

async function seed(page) {
  const sessions = buildSeed();
  await page.evaluate(async ({ sessions, createdAt }) => {
    const { store } = window.__app;
    const meta = store.get('meta', 'app');
    meta.createdAt = createdAt;
    await store.save('meta', meta);
    await Promise.all(sessions.map((x) => store.save('sessions', x)));
  }, { sessions, createdAt: madrid(START, 9) });
  return sessions;
}

/** Lo que calcula summary-logic con los datos del store (la misma entrada que la pantalla). */
const expected = (page, unit, start) => page.evaluate(async ({ unit, start, today }) => {
  const L = await import('./js/summary-logic.js');
  const P = await import('./js/progress-ui.js');
  const s = L.periodSummary(P.dataFromStore(today), { unit, start, today });
  return {
    title: s.title, days: s.days, sessions: s.sessions, kinds: s.kinds, label: s.compare.label, available: s.compare.available,
    muscles: s.strength.muscles.length, volume: L.fmtValue('volume', s.strength.volume), records: s.records.length,
    progress: s.topProgress.map((p) => p.name), minutes: L.fmtValue('minutes', s.minutes),
    km: Object.fromEntries(s.kinds.map((k) => [k, L.fmtKm(k, s.byKind[k].km)])), byKindKm: Object.fromEntries(s.kinds.map((k) => [k, s.byKind[k].km])),
    months: s.months ? s.months.map((m) => m.days) : null,
    daysDelta: L.deltaInfo(s.compare.days).text,
  };
}, { unit, start, today: TODAY });

const deltas = (page, root) => page.locator(`${root} .sum-delta`).evaluateAll((els) => els.map((e) => ({ dir: e.dataset.dir, text: e.textContent.trim() })));

// ===========================================================================
// Pruebas
// ===========================================================================

test('#/summary (mes en curso): totales, deportes, días, fuerza, récords, progreso y comparación', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/summary');
    const exp = await expected(page, 'month', TODAY);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Septiembre 2026');
    assert.strictEqual(await page.locator('.topbar-sub').innerText(), 'Resumen mensual · en curso');
    assert.strictEqual(await page.locator('.back-btn').count(), 1, 'botón atrás');
    assert.strictEqual(await page.locator('.sum-seg .seg-btn.active').innerText(), 'Mes');
    assert.ok(await page.locator('[data-nav="next"]').isDisabled(), 'no se puede pasar del mes actual');
    assert.ok(await page.locator('[data-nav="current"]').isDisabled());
    assert.strictEqual(await page.locator('[data-nav="current"]').innerText(), 'Este mes');
    assert.match(await page.locator('.sum-provisional').innerText(), /Mes en curso: quedan 5 días \(hoy incluido\)/);

    // Totales con su diferencia (flecha + texto)
    assert.strictEqual(await page.locator('.sum-kpi[data-kpi="days"] .sum-kpi-value').innerText(), String(exp.days));
    assert.match(await page.locator('.sum-kpi[data-kpi="days"] .sum-kpi-sub').innerText(), /de 26 días hasta hoy/);
    assert.strictEqual(await page.locator('.sum-kpi[data-kpi="sessions"] .sum-kpi-value').innerText(), String(exp.sessions));
    assert.strictEqual(await page.locator('.sum-kpi[data-kpi="minutes"] .sum-kpi-value').innerText(), exp.minutes);
    assert.strictEqual(await page.locator('.sum-totals .sum-card-sub').innerText(), exp.label);
    assert.match(exp.label, /^Frente al mismo tramo de agosto \(1–26 ago\)$/);
    assert.strictEqual((await page.locator('.sum-kpi[data-kpi="days"] .sum-delta').innerText()).replace(/\s+/g, ' ').trim().replace(/^[▲▼=] ?/, ''), exp.daysDelta);
    const kd = await deltas(page, '.sum-totals');
    assert.strictEqual(kd.length, 4);
    for (const d of kd) {
      assert.ok(['up', 'down', 'same'].includes(d.dir), JSON.stringify(d));
      assert.ok(d.dir === 'same' ? /^= ?igual$/.test(d.text) : /^[▲▼] ?[+−].+\([+−][\d,]+ %\)$/.test(d.text), `flecha y % con texto: ${d.text}`);
    }

    // Por deporte: una tarjeta por tipo con sesiones, con su color y su nombre
    const sports = await page.locator('.sum-sport').evaluateAll((els) => els.map((e) => ({
      kind: e.dataset.kind, name: e.querySelector('.sum-sport-name').textContent, main: e.querySelector('.sum-sport-main').textContent,
      border: getComputedStyle(e).borderTopColor, delta: !!e.querySelector('.sum-delta'),
    })));
    assert.deepStrictEqual(sports.map((s) => s.kind), exp.kinds);
    for (const k of ['strength', 'run', 'bike', 'hike', 'swim', 'other']) assert.ok(exp.kinds.includes(k), `${k} en septiembre`);
    const hike = sports.find((s) => s.kind === 'hike');
    assert.strictEqual(hike.name, 'Senderismo');
    assert.strictEqual(hike.border, 'rgb(45, 212, 191)', '--act-hike');
    assert.strictEqual(hike.main, exp.km.hike);
    assert.strictEqual(sports.find((s) => s.kind === 'run').border, 'rgb(249, 115, 22)', '--act-run');
    assert.strictEqual(sports.find((s) => s.kind === 'swim').main, exp.km.swim);
    assert.match(exp.km.swim, / m$/, 'natación en metros');
    assert.strictEqual(sports.find((s) => s.kind === 'strength').name, 'Fuerza');
    assert.ok(sports.every((s) => s.delta), 'cada deporte con su comparación');
    await shot(page, 'summary-390-month-top');

    // Días entrenados: calendario con los días (y su enlace al día)
    assert.strictEqual(await page.locator('.sum-cal-on').count(), exp.days);
    assert.strictEqual(await page.locator('.sum-cal-cell[data-date]').count(), 30);
    assert.strictEqual(await page.locator('.sum-cal-today').getAttribute('data-date'), TODAY);
    assert.match(await page.locator('.sum-cal-on').first().getAttribute('aria-label'), /: (Fuerza|Carrera|Bici|Natación|Senderismo|Otras actividades)/);
    assert.ok((await page.locator('.sum-legend-item').allInnerTexts()).some((t) => /Senderismo/.test(t)), 'leyenda con nombres');

    // Fuerza
    assert.strictEqual(await page.locator('.sum-kpi[data-kpi="volume"] .sum-kpi-value').innerText(), exp.volume);
    assert.strictEqual(await page.locator('.sum-mrow').count(), exp.muscles);
    assert.match(await page.locator('.sum-mrow').first().innerText(), /\/sem/);

    // Récords (plegados a 6) y ejercicios que más progresan
    assert.ok(exp.records > 0, 'hay récords en septiembre');
    assert.strictEqual(await page.locator('.sum-rec').count(), exp.records);
    const visibleRecs = await page.locator('.sum-rec:visible').count();
    assert.strictEqual(visibleRecs, Math.min(6, exp.records));
    if (exp.records > 6) {
      await page.locator('.sum-records .sum-more').click();
      assert.strictEqual(await page.locator('.sum-rec:visible').count(), exp.records);
    }
    assert.ok(exp.progress.length > 0);
    assert.deepStrictEqual(await page.locator('.sum-prog-name').allInnerTexts(), exp.progress);
    assert.match(await page.locator('.sum-prog').first().innerText(), /→[\s\S]*kg[\s\S]*desde tu última sesión del mes anterior/);
    const pd = await deltas(page, '.sum-progress');
    assert.ok(pd.every((d) => d.dir === 'up' && /^▲ ?\+[\d,]+ kg \(\+[\d,]+ %\)$/.test(d.text)), JSON.stringify(pd));

    // Comparación con el periodo anterior
    assert.strictEqual(await page.locator('.sum-compare .sum-card-sub').innerText(), exp.label);
    const rows = await page.locator('.sum-cmp-row').evaluateAll((els) => els.map((e) => e.dataset.row));
    for (const r of ['days', 'sessions', 'minutes', 'load', 'volume', 'work-sets', 'km-run', 'km-bike', 'km-hike', 'km-swim', 'count-strength', 'count-other']) {
      assert.ok(rows.includes(r), `fila ${r}: ${rows}`);
    }
    assert.match(await page.locator('.sum-cmp-row[data-row="km-hike"]').innerText(), /Senderismo · distancia[\s\S]*antes/);
    assert.match(await page.locator('.sum-compare .sum-note').innerText(), /^Agosto 2026 completo: /);
    assert.ok(await noHScroll(page), 'sin desbordamiento horizontal');
    await scrollShots(page, 'summary-390-month');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('#/summary: navegación ‹ › sin llenar el historial, Mes / Año, barras por mes y estados vacíos', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/progress');
    await open(page, '#/summary?p=month');
    const histLen = await page.evaluate(() => history.length);

    // ‹ agosto (terminado): sin aviso «en curso», comparación con julio entero
    await clickInPlace(page, page.locator('[data-nav="prev"]'));
    assert.match(page.url(), /#\/summary\?p=month&d=2026-08-01$/);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Agosto 2026');
    assert.strictEqual(await page.locator('.topbar-sub').innerText(), 'Resumen mensual');
    assert.strictEqual(await page.locator('.sum-provisional').count(), 0);
    assert.strictEqual(await page.locator('.sum-totals .sum-card-sub').innerText(), 'Frente a julio');
    assert.strictEqual(await page.locator('[data-nav="current"]').innerText(), 'Ir a este mes');
    assert.ok(!(await page.locator('[data-nav="next"]').isDisabled()));
    assert.strictEqual(await page.evaluate(() => history.length), histLen, 'replaceUrl: no apila historial');

    // Un día del calendario abre el día; «atrás» vuelve al mismo mes
    const day = await page.locator('.sum-cal-on').first().getAttribute('data-date');
    await clickAndWait(page, page.locator('.sum-cal-on').first());
    assert.match(page.url(), new RegExp(`#/day/${day}$`));
    await clickAndWait(page, page.locator('.back-btn'));
    assert.match(page.url(), /#\/summary\?p=month&d=2026-08-01$/);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Agosto 2026');

    // Año: 12 barras (días por mes), los meses futuros desactivados
    await clickInPlace(page, page.locator('.sum-seg .seg-btn', { hasText: 'Año' }));
    assert.match(page.url(), /#\/summary\?p=year&d=2026-08-01$/);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), '2026');
    assert.strictEqual(await page.locator('.topbar-sub').innerText(), 'Resumen anual · en curso');
    const exp = await expected(page, 'year', TODAY);
    const bars = await page.locator('.sum-mbar').evaluateAll((els) => els.map((e) => ({ days: +e.dataset.days, disabled: e.disabled, label: e.getAttribute('aria-label') })));
    assert.strictEqual(bars.length, 12);
    assert.deepStrictEqual(bars.map((b) => b.days), exp.months);
    assert.deepStrictEqual(bars.map((b) => b.disabled), [...Array(9).fill(false), true, true, true]);
    assert.match(bars[8].label, /^Septiembre: \d+ días, \d+ sesiones$/);
    assert.strictEqual(await page.locator('.sum-totals .sum-card-sub').innerText(), 'Frente a 2025 hasta el 26 sep');
    assert.ok(await page.locator('[data-nav="next"]').isDisabled(), 'no se puede pasar del año actual');
    await shot(page, 'summary-390-year-top');
    await scrollShots(page, 'summary-390-year');

    // Tocar un mes abre su resumen mensual
    await clickInPlace(page, page.locator('.sum-mbar').nth(5));
    assert.match(page.url(), /#\/summary\?p=month&d=2026-06-01$/);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Junio 2026');
    assert.strictEqual(await page.locator('.sum-seg .seg-btn.active').innerText(), 'Mes');

    // Año anterior (2025): sin datos de 2024 con los que comparar; diciembre a 0
    await clickInPlace(page, page.locator('.sum-seg .seg-btn', { hasText: 'Año' }));
    await clickInPlace(page, page.locator('[data-nav="prev"]'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), '2025');
    assert.match(page.url(), /#\/summary\?p=year&d=2025-06-01$/, 'conserva el mes de referencia');
    assert.ok(await page.locator('[data-nav="prev"]').isDisabled(), '2025 es el primer año con datos');
    assert.strictEqual(await page.locator('.sum-mbar').nth(11).getAttribute('data-days'), '0');
    assert.match(await page.locator('.sum-compare .sum-none').innerText(), /No hay registros del periodo anterior/);
    assert.strictEqual(await page.locator('.sum-kpi .sum-delta').count(), 0, 'sin flechas si no hay con qué comparar');

    // Atrás → Progreso (Mes / Año, ‹ › y las barras cambian la pantalla en sitio: una sola entrada de historial)
    await clickAndWait(page, page.locator('.back-btn'));
    assert.match(page.url(), /#\/progress$/);

    // Mes vacío entre registros (diciembre de 2025) y mes anterior al primer registro
    await open(page, '#/summary?p=month&d=2025-12-10');
    assert.strictEqual(await page.locator('.sum-empty .empty-title').innerText(), 'Sin entrenamientos en diciembre de 2025');
    assert.match(await page.locator('.sum-empty .empty-text').innerText(), /30 nov 2025/);
    await shot(page, 'summary-390-empty-month');
    await clickInPlace(page, page.locator('.sum-empty .btn'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Noviembre 2025');
    await open(page, '#/summary?p=month&d=2025-03-10');
    assert.strictEqual(await page.locator('.sum-empty .empty-title').innerText(), 'Sin registros en marzo de 2025');
    assert.ok(await page.locator('[data-nav="prev"]').isDisabled());
    await clickInPlace(page, page.locator('.sum-empty .btn'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Junio 2025');
    // Una fecha futura en la URL se queda en el periodo actual
    await open(page, '#/summary?p=month&d=2027-01-15');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Septiembre 2026');
    // «Ir a este mes»
    await clickInPlace(page, page.locator('[data-nav="prev"]'));
    await clickInPlace(page, page.locator('[data-nav="current"]'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Septiembre 2026');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('#/weekly: bloque «Resumen de la semana» arriba (totales, km por deporte, comparación) y enlaces a Mes / Año', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/weekly');
    const recap = page.locator('.wk-recap');
    assert.strictEqual(await recap.count(), 1);
    const order = await page.evaluate(() => {
      const y = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? null;
      return { nav: y('.wk-nav'), recap: y('.wk-recap'), info: y('.wk-block-info'), sugg: y('.wk-block-suggestion') };
    });
    assert.ok(order.nav < order.recap && order.recap < order.info && order.info < order.sugg, `orden: ${JSON.stringify(order)}`);
    assert.strictEqual(await recap.locator('.wk-recap-title').innerText(), 'Resumen de la semana');
    assert.strictEqual(await recap.locator('.wk-recap-sub').innerText(), 'Frente a la semana anterior hasta el sábado');
    const exp = await expected(page, 'week', TODAY);
    assert.deepStrictEqual(await recap.locator('.wk-recap-kpi').evaluateAll((els) => els.map((e) => e.dataset.kpi)), ['sessions', 'minutes', 'load', 'volume']);
    assert.strictEqual(await recap.locator('[data-kpi="sessions"] .wk-recap-value').innerText(), String(exp.sessions));
    assert.strictEqual(await recap.locator('[data-kpi="minutes"] .wk-recap-value').innerText(), exp.minutes);
    assert.strictEqual(await recap.locator('[data-kpi="volume"] .wk-recap-value').innerText(), exp.volume);
    const kmRows = await recap.locator('.wk-recap-km-row').evaluateAll((els) => els.map((e) => ({ kind: e.dataset.kind, text: e.innerText })));
    const withKm = Object.keys(exp.byKindKm).filter((k) => exp.byKindKm[k] > 0);
    for (const k of withKm) assert.ok(kmRows.some((r) => r.kind === k && r.text.includes(exp.km[k])), `km de ${k}: ${JSON.stringify(kmRows)}`);
    const d = await deltas(page, '.wk-recap');
    assert.ok(d.length >= 4 && d.every((x) => x.dir === 'none' || /[▲▼=]/.test(x.text)), JSON.stringify(d));
    // El panel sigue igual: información y después sugerencias, sin tarjetas nuevas entre sus mensajes
    assert.deepStrictEqual(await page.locator('.wk-block').evaluateAll((els) => els.map((e) => e.dataset.section)), ['info', 'suggestion']);
    assert.strictEqual(await recap.locator('.wk-msg, .why-btn').count(), 0);
    await recap.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -130));
    await shot(page, 'summary-390-weekly-block');
    assert.ok(await noHScroll(page));

    // Enlaces: «Ver mes» y «Ver año» (con atrás al panel)
    await clickAndWait(page, recap.locator('[data-link="month"]'));
    assert.match(page.url(), /#\/summary\?p=month&d=2026-09-26$/);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Septiembre 2026');
    await clickAndWait(page, page.locator('.back-btn'));
    assert.match(page.url(), /#\/weekly$/);
    await clickAndWait(page, page.locator('.wk-recap [data-link="year"]'));
    assert.match(page.url(), /#\/summary\?p=year&d=2026-09-26$/);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), '2026');
    await clickAndWait(page, page.locator('.back-btn'));

    // Semana terminada: frente a la anterior entera; el mes de la semana es el de su jueves
    await open(page, '#/weekly?week=2026-08-31');
    assert.strictEqual(await page.locator('.wk-recap-sub').innerText(), 'Frente a la semana anterior');
    await clickAndWait(page, page.locator('.wk-recap [data-link="month"]'));
    assert.match(page.url(), /#\/summary\?p=month&d=2026-09-03$/);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Septiembre 2026');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('#/summary y bloque semanal a 375×667: sin desbordar, objetivos táctiles ≥ 44 px, textos enteros; sin datos', async () => {
  const app = await launch({ width: 375, height: 667 });
  const { page } = app;
  try {
    // Sin datos: estado vacío amable, sin bloque en el panel
    await open(page, '#/summary');
    assert.strictEqual(await page.locator('.sum-empty .empty-title').innerText(), 'Aún no hay datos');
    assert.ok(await page.locator('[data-nav="prev"]').isDisabled() && await page.locator('[data-nav="next"]').isDisabled());
    await shot(page, 'summary-375-no-data');
    await open(page, '#/weekly');
    assert.strictEqual(await page.locator('.wk-recap').count(), 0, 'sin datos no hay bloque de resumen');

    await seed(page);
    for (const hash of ['#/summary?p=month', '#/summary?p=year']) {
      await open(page, hash);
      assert.ok(await noHScroll(page), `${hash}: sin desbordamiento a 375 px`);
      const small = await page.locator('.sum-nav button, .sum-seg .seg-btn, .sum-cal-cell[data-date], .sum-mbar, .sum-rec-btn, .sum-prog-btn, .sum-more')
        .evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44).length);
      assert.strictEqual(small, 0, `${hash}: objetivos táctiles de al menos 44 px de alto`);
      assert.deepStrictEqual(await clipped(page, '.sum-sport-name, .sum-rec-label, .sum-prog-name, .sum-cmp-label, .sum-mrow-name, .sum-kpi-label, .sum-card-title'), []);
    }
    await scrollShots(page, 'summary-375-year', 3);
    await open(page, '#/weekly');
    assert.ok(await noHScroll(page));
    const small = await page.locator('.wk-recap button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44).length);
    assert.strictEqual(small, 0);
    await page.locator('.wk-recap').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -70));
    await shot(page, 'summary-375-weekly-block');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
