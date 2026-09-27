// E2E de las pantallas de progreso (Fase 2): #/progress, #/progress/exercise/:id, #/records y la gráfica de
// #/bodyweight. Siembra ~14 semanas de datos realistas (rutina precargada D1–D6, carreras, bici, natación,
// baloncesto y pesajes) con la fecha fijada (jueves 24 sep 2026) y comprueba gráficas, periodo, globo exacto,
// historial, récords, estados vacíos, desbordamiento horizontal y consola. Deja capturas en test-results/.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/progress.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { waitReady, go } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');
const TODAY = '2026-09-24'; // jueves
const START = '2026-06-15'; // lunes, 14 semanas antes
/** Hora local de Madrid (CEST, +02:00 hasta el 25 de octubre). */
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}
const dowOf = (s) => (new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))).getUTCDay() + 6) % 7; // 0 = lunes
const weekStart = (s) => addDays(s, -dowOf(s));
const roundTo = (v, step) => Math.round(v / step) * step;
const r1 = (v) => Math.round(v * 10) / 10;

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
  await page.waitForFunction(() => {
    const el = document.querySelector('#view > *');
    return !!el && !el.dataset.stale && !!el.querySelector('.topbar');
  }, null, { timeout: 5000 });
  await page.waitForTimeout(120);
}

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function shot(page, name) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
/** Capturas de toda la pantalla a varias alturas de scroll (una por «pantalla»). */
async function scrollShots(page, prefix, max = 12) {
  const { H, vh } = await page.evaluate(() => ({ H: document.documentElement.scrollHeight, vh: window.innerHeight }));
  const step = vh - 140; // solapa un poco (cabecera y pestañas fijas)
  const files = [];
  for (let y = 0, i = 0; i < max; y += step, i++) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(120);
    files.push(await shot(page, `${prefix}-${i}`));
    if (y + vh >= H) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return files;
}

/** Caja del SVG de una gráfica (centrada en pantalla) + su marco (data-*). */
async function svgBox(page, sel) {
  const loc = page.locator(`${sel} .chart-svg`);
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(80);
  const box = await loc.boundingBox();
  const ds = await loc.evaluate((el) => ({ ...el.dataset }));
  return { ...box, ds };
}
function xOfBar(b, i) {
  const slot = (Number(b.ds.r) - Number(b.ds.l)) / Number(b.ds.n);
  return b.x + Number(b.ds.l) + slot * (i + 0.5);
}
function xOfDate(b, dateStr) {
  const d = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  const t = (d(dateStr) - d(b.ds.from)) / (d(b.ds.to) - d(b.ds.from));
  return b.x + Number(b.ds.x0) + t * (Number(b.ds.x1) - Number(b.ds.x0));
}
/** Nº de puntos pintados en una gráfica de líneas (cada punto es «M x y h0.01» en la ruta de puntos). */
const dotCount = (page, sel) => page.locator(`${sel} .chart-dots`).evaluateAll((els) => els.reduce((t, e) => t + (e.getAttribute('d').match(/h0\.01/g) || []).length, 0));
const chartState = (page, sel) => page.locator(sel).evaluate((card) => ({
  svg: !!card.querySelector('.chart-svg:not([hidden])'),
  empty: !card.querySelector('.chart-empty').hidden,
  emptyText: card.querySelector('.chart-empty').textContent,
  aria: card.querySelector('.chart-svg').getAttribute('aria-label'),
  n: card.querySelector('.chart-svg').dataset.n || null,
  from: card.querySelector('.chart-svg').dataset.from || null,
}));

// ---------------------------------------------------------------------------
// Datos sembrados (deterministas)
// ---------------------------------------------------------------------------
const BASE = { // [peso inicial, kg por semana]
  press_banca: [72.5, 1.25], press_inclinado_mancuerna: [24, 0.5], remo_pecho_apoyado: [55, 1], elevaciones_laterales: [9, 0.2],
  face_pull: [20, 0.5], crunch_polea: [35, 1], sentadilla: [90, 2.5], peso_muerto_rumano: [80, 2], prensa: [140, 5], hack_squat: [100, 2.5],
  curl_femoral: [40, 1], gemelos_pie: [60, 1], tibialis_raises: [5, 0], press_inclinado_smith: [55, 1.25], aperturas_mancuerna: [12, 0.25],
  jalon_pecho: [55, 1.25], curl_supinador: [12, 0.25], triceps_sobre_cabeza: [20, 0.5], remo_unilateral: [24, 0.5], bulgara: [14, 0.5],
};
const COMPOUNDS = new Set(['press_banca', 'sentadilla', 'peso_muerto_rumano', 'press_inclinado_smith']);

function setsFor(sid, i, it, ex, w, at) {
  const sets = [];
  let j = 0;
  const mk = (o) => ({
    id: `${sid}_s${i}_${sets.length}`, type: 'effective', weight: null, reps: null, repsR: null, rir: null, timeSec: null,
    distanceM: null, heightCm: null, note: '', done: true, doneAt: at + (i * 5 + sets.length) * 60000, ...o,
  });
  const n = it.sets || 1;
  const repMax = it.repMax ?? it.repMin ?? 8;
  const repMin = it.repMin ?? repMax;
  const repsAt = (k) => Math.max(repMin, repMax - k);
  const rirAt = (k) => [2, 1, 1, 1][k] ?? 1;
  switch (ex.logType) {
    case 'weight_reps': {
      const [b, inc] = BASE[ex.id] || [20, 0.5];
      const W = roundTo(b + inc * w, b >= 40 ? 2.5 : 0.5);
      if (COMPOUNDS.has(ex.id)) sets.push(mk({ type: 'warmup', weight: roundTo(W * 0.5, 2.5), reps: 8 }));
      for (j = 0; j < n; j++) sets.push(mk({ weight: W, reps: repsAt(j), rir: rirAt(j) }));
      break;
    }
    case 'bodyweight': {
      const lastre = ex.id === 'dominadas' ? roundTo(1.25 * w, 1.25) : 0;
      for (j = 0; j < n; j++) sets.push(mk({ weight: lastre || null, reps: repsAt(j), rir: rirAt(j) }));
      break;
    }
    case 'unilateral': {
      const [b, inc] = BASE[ex.id] || [16, 0.5];
      const W = roundTo(b + inc * w, 0.5);
      for (j = 0; j < n; j++) sets.push(mk({ weight: W, reps: repsAt(j), repsR: repsAt(j), rir: rirAt(j) }));
      break;
    }
    case 'time':
      for (j = 0; j < n; j++) sets.push(mk({ timeSec: 45 + 3 * w - 5 * j }));
      break;
    case 'distance_time': {
      const d = it.distance || 20;
      const base = ex.id === 'sprint' ? (d === 20 ? 3.4 : 4.65) : 5.9;
      for (j = 0; j < n; j++) sets.push(mk({ distanceM: d, timeSec: Math.round((base - 0.012 * w + 0.02 * j) * 100) / 100 }));
      break;
    }
    case 'jumps':
      for (j = 0; j < n; j++) sets.push(mk({ reps: repMax, heightCm: ex.id === 'saltos_verticales' ? r1(42 + 0.4 * w + 0.5 * (j % 2)) : null }));
      break;
    default: // cardio: sin series (va como actividad)
      break;
  }
  return sets;
}

function strength(id, date, tpl, w, exById, { dur = 65, rpe = 8 } = {}) {
  const at = madrid(date, 18);
  return {
    id, kind: 'strength', date, planDate: date, templateId: tpl.id, templateName: tpl.name, status: 'done',
    startedAt: at, endedAt: at + dur * 60000, durationMin: dur, rpe, notes: '', parentId: null, templateItemId: null, cursor: 0,
    templateItemIds: tpl.items.map((it) => it.id), createdAt: at, updatedAt: at,
    exercises: tpl.items.map((it, i) => {
      const ex = exById[it.exerciseId];
      return {
        id: `${id}_se${i}`, exerciseId: it.exerciseId, exName: ex.name, templateItemId: it.id, alternatives: it.alternatives || [],
        target: { sets: it.sets, repMin: it.repMin ?? null, repMax: it.repMax ?? null, distance: it.distance ?? null }, notes: '', section: it.section || '',
        groupId: null, groupType: null, sets: setsFor(id, i, it, ex, w, at),
      };
    }),
  };
}
function activity(id, kind, date, { km = null, sec, rpe = 5, subtype = null, hh = 8 }) {
  const at = madrid(date, hh);
  return {
    id, kind, date, planDate: date, templateId: null, templateName: null, status: 'done', startedAt: null, endedAt: null,
    movingSec: sec, elapsedSec: sec, durationMin: sec / 60, rpe, distanceKm: km, subtype, notes: '', parentId: null, parentItemId: null,
    templateItemId: null, createdAt: at, updatedAt: at,
  };
}

/** Construye el historial: 14 semanas + la actual (lunes a miércoles). */
function buildSeed(templates, exercises) {
  const tpl = Object.fromEntries(templates.map((t) => [t.id, t]));
  const exById = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const sessions = [];
  for (let w = 0; w <= 14; w++) {
    const mon = addDays(START, 7 * w);
    const day = (d) => addDays(mon, d);
    const add = (s) => { if (s.date < TODAY) sessions.push(s); };
    add(strength(`s${w}_d1`, day(0), tpl.tpl_d1, w, exById));
    if (w !== 4) add(strength(`s${w}_d2`, day(1), tpl.tpl_d2, w, exById, { dur: 70 }));
    // Día 3: plancha en la sesión de fuerza + carrera y bici sueltas ese día
    add(strength(`s${w}_d3`, day(2), tpl.tpl_d3, w, exById, { dur: 10, rpe: 6 }));
    if (day(2) === '2026-09-02') add(activity(`r${w}_tempo`, 'run', day(2), { km: 8, sec: 2240, rpe: 8, subtype: 'tempo' })); // 4:40 /km
    else add(activity(`r${w}_z2`, 'run', day(2), { km: 6, sec: 6 * (340 - 2 * w), rpe: 5, subtype: 'z2' }));
    add(activity(`b${w}_easy`, 'bike', day(2), { km: 30, sec: Math.round((30 / (24 + 0.25 * w)) * 3600), rpe: 5, subtype: 'easy', hh: 19 }));
    if (w !== 7) add(strength(`s${w}_d4`, day(3), tpl.tpl_d4, w, exById, { dur: 70 }));
    if ([2, 6, 10].includes(w)) add(activity(`sw${w}`, 'swim', day(4), { km: 1.5, sec: 1800, rpe: 6 }));
    if (w === 13) add(activity(`sw${w}`, 'swim', day(4), { km: 2, sec: 2500, rpe: 6 }));
    if (w === 9) add(activity(`b${w}_route`, 'bike', day(5), { km: 70, sec: Math.round((70 / 27) * 3600), rpe: 7, subtype: 'route', hh: 9 })); // sustituye al Día 6
    else add(strength(`s${w}_d6`, day(5), tpl.tpl_d6, w, exById, { dur: 60, rpe: 7 }));
    if (w % 2 === 0) {
      if (day(6) === '2026-09-13') add(activity(`r${w}_long`, 'run', day(6), { km: 15, sec: 5400, rpe: 7, subtype: 'long', hh: 9 }));
      else add(activity(`r${w}_long`, 'run', day(6), { km: 12, sec: 4200, rpe: 6, subtype: 'long', hh: 9 }));
    } else {
      add(activity(`o${w}_bask`, 'other', day(6), { sec: 3600, rpe: 7, subtype: 'basketball', hh: 11 }));
    }
  }
  const bodyweight = [];
  for (let i = 0, d = START; d <= TODAY; i++, d = addDays(d, 1)) {
    if (d !== TODAY && (i % 7 === 3 || i % 11 === 5)) continue; // huecos reales
    bodyweight.push({ id: d, kg: r1(74.6 + 0.011 * i + 0.25 * Math.sin(i / 3.5)) });
  }
  return { sessions, bodyweight };
}

/** Siembra los datos en la app abierta (memoria + IndexedDB) y fija el inicio del registro. */
async function seed(page) {
  const base = await page.evaluate(() => ({
    templates: window.__app.store.all('templates').map((t) => ({ id: t.id, name: t.name, items: t.items })),
    exercises: window.__app.store.all('exercises').map((e) => ({ id: e.id, name: e.name, logType: e.logType })),
  }));
  const s = buildSeed(base.templates, base.exercises);
  await page.evaluate(async ({ sessions, bodyweight, createdAt }) => {
    const { store } = window.__app;
    const meta = store.get('meta', 'app');
    meta.createdAt = createdAt;
    await store.save('meta', meta);
    await Promise.all([...sessions.map((x) => store.save('sessions', x)), ...bodyweight.map((b) => store.save('bodyweight', b))]);
  }, { ...s, createdAt: madrid(START, 9) });
  return s;
}

/** Números esperados, calculados aquí (sin stats.js) a partir de lo sembrado. */
function expected(s) {
  const loadOfWeek = (ws) => s.sessions.filter((x) => weekStart(x.date) === ws).reduce((t, x) => t + Math.round(x.durationMin * x.rpe), 0);
  const bench = s.sessions.filter((x) => x.kind === 'strength' && x.exercises.some((e) => e.exerciseId === 'press_banca'));
  const benchWork = bench.flatMap((x) => x.exercises.filter((e) => e.exerciseId === 'press_banca').flatMap((e) => e.sets.filter((st) => st.type !== 'warmup')));
  const lastBench = bench[bench.length - 1];
  const lastBenchTop = lastBench.exercises.find((e) => e.exerciseId === 'press_banca').sets.find((st) => st.type !== 'warmup');
  return {
    loadOfWeek,
    benchSessions: bench.length,
    benchMax: Math.max(...benchWork.map((st) => st.weight)),
    lastBench,
    lastBenchTop,
    bwToday: s.bodyweight.find((b) => b.id === TODAY).kg,
  };
}

// ===========================================================================
// Pruebas
// ===========================================================================

test('#/progress con datos: se pinta cada gráfica, periodo global, globo con el valor exacto, chips y lista de ejercicios', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const s = await seed(page);
    const exp = expected(s);
    await open(page, '#/progress');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Progreso');
    assert.strictEqual(await page.locator('.progress-extra').count(), 1, 'hueco de la Fase 3');
    assert.strictEqual(await page.locator('.prg-nodata').count(), 0);
    assert.strictEqual(await page.locator('.prg-links [data-link="records"]').count(), 1);
    assert.strictEqual(await page.locator('.prg-links [data-link="bodyweight"]').count(), 1);

    // Cada gráfica se pinta (con datos, sin el mensaje vacío)
    for (const id of ['load', 'volume', 'muscle', 'km', 'run-pace', 'bike-speed', 'swim-pace', 'bodyweight', 'adherence']) {
      const st = await chartState(page, `[data-chart="${id}"]`);
      assert.ok(st.svg && !st.empty, `${id}: la gráfica debe tener datos (${st.emptyText})`);
    }
    assert.strictEqual(await page.locator('[data-chart="load"] .chart-legend-item').count(), 6, 'leyenda de la carga: 5 tipos + media de las semanas previas');
    assert.deepStrictEqual(await page.locator('[data-chart="load"] .chart-legend-label').allTextContents(), ['Fuerza', 'Otras', 'Carrera', 'Bici', 'Natación', 'Media 4 sem. previas']);
    // Periodo por defecto: 3 meses → 14 semanas (22 jun – 21 sep); las líneas empiezan el mismo lunes 22 jun
    assert.strictEqual((await chartState(page, '[data-chart="load"]')).n, '14');
    assert.strictEqual((await chartState(page, '[data-chart="run-pace"]')).from, '2026-06-22');

    // Tabla «esta semana»: los 16 músculos con su estado
    assert.strictEqual(await page.locator('.prg-mrow').count(), 16);
    const back = await page.locator('.prg-mrow[data-muscle="back"]').innerText();
    assert.match(back, /Espalda/);
    assert.match(back, /14–22/);
    assert.match(back, /Faltan \d|Dentro|Por encima/);

    // Cambio de periodo global → 4 semanas: 5 barras semanales (desde el lunes 24 ago) y las líneas empiezan
    // ese mismo lunes: con el mismo selector, todas las tarjetas cuentan los mismos días.
    await page.locator('.prg-period-bar .seg-btn', { hasText: '4 sem' }).click();
    await page.waitForTimeout(150);
    assert.strictEqual((await chartState(page, '[data-chart="load"]')).n, '5');
    assert.strictEqual((await chartState(page, '[data-chart="volume"]')).n, '5');
    assert.strictEqual((await chartState(page, '[data-chart="adherence"]')).n, '5');
    assert.strictEqual((await chartState(page, '[data-chart="run-pace"]')).from, '2026-08-24');
    assert.strictEqual((await chartState(page, '[data-chart="bodyweight"]')).from, '2026-08-24');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('entreno.period.global')), '4w');

    // Toque en la barra de la semana del 14 sep → globo con el total exacto de carga
    const b = await svgBox(page, '[data-chart="load"]');
    await page.touchscreen.tap(xOfBar(b, 3), b.y + b.height * 0.6);
    const tip = page.locator('[data-chart="load"] .chart-tip');
    assert.ok(await tip.isVisible(), 'globo visible');
    // Mismo formato que la app (es-ES con separador de miles: «3.277»)
    const total = await page.evaluate((v) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: true }).format(v), exp.loadOfWeek('2026-09-14'));
    const tipTxt = await tip.innerText();
    assert.match(tipTxt, /14–20 sep 2026/);
    assert.strictEqual(await page.locator('[data-chart="load"] .chart-tip-total .chart-tip-val').innerText(), total);
    await shot(page, 'progress-tip-load');

    // Toque en el peso corporal de hoy → pesaje exacto
    const bb = await svgBox(page, '[data-chart="bodyweight"]');
    await page.touchscreen.tap(xOfDate(bb, TODAY), bb.y + bb.height / 2);
    const bwTip = await page.locator('[data-chart="bodyweight"] .chart-tip').innerText();
    const bwTxt = `${String(exp.bwToday).replace('.', ',')} kg`;
    assert.ok(bwTip.includes('24 sep 2026') && bwTip.includes(bwTxt), `pesaje de hoy ${bwTxt}: ${bwTip}`);

    // Chips de músculo: por defecto Espalda; al elegir Pecho cambia solo esa gráfica
    const muscleAria = () => page.locator('[data-chart="muscle"] .chart-svg').getAttribute('aria-label');
    assert.match(await muscleAria(), /Espalda/);
    assert.match(await page.locator('[data-chart="muscle"] .prg-caption').innerText(), /Espalda · objetivo 14–22/);
    const loadSvgBefore = await page.locator('[data-chart="load"] .chart-svg').evaluate((el) => el.innerHTML.length);
    await page.locator('[data-chart="muscle"] .chip', { hasText: 'Pecho' }).click();
    await page.waitForTimeout(100);
    assert.match(await muscleAria(), /Pecho/);
    assert.match(await page.locator('[data-chart="muscle"] .prg-caption').innerText(), /Pecho · objetivo 12–22/);
    assert.ok(await page.locator('[data-chart="muscle"] .chart-band').count() >= 1, 'franja del rango objetivo');
    assert.strictEqual(await page.locator('[data-chart="load"] .chart-svg').evaluate((el) => el.innerHTML.length), loadSvgBefore, 'la carga no se redibuja');
    // Tocar un músculo de la tabla lo elige en la gráfica
    await page.locator('.prg-mrow[data-muscle="core"]').click();
    await page.waitForTimeout(150);
    assert.match(await muscleAria(), /Core/);

    // Km: filtro por deporte (solo carrera)
    await page.locator('[data-chart="km"] .seg-btn', { hasText: 'Carrera' }).click();
    await page.waitForTimeout(80);
    assert.strictEqual(await page.locator('[data-chart="km"] .chart-legend').count(), 0, 'un solo deporte: sin leyenda');
    await page.locator('[data-chart="km"] .seg-btn', { hasText: 'Todos' }).click();

    // Lista de ejercicios con historial, buscador y enlace
    const rows = page.locator('.prg-ex-row');
    assert.ok(await rows.count() >= 20, `ejercicios con historial: ${await rows.count()}`);
    const benchRow = page.locator('.prg-ex-row[data-id="press_banca"]');
    assert.match(await benchRow.innerText(), /Press banca/);
    assert.match(await benchRow.innerText(), /1RM EST\.|1RM est\./i);
    await page.locator('.prg-search').fill('press banca');
    await page.waitForTimeout(80);
    assert.strictEqual(await rows.count(), 1);
    await page.locator('.prg-search').fill('zzzz');
    assert.match(await page.locator('.prg-ex-empty').innerText(), /Ningún ejercicio/);
    await page.locator('.prg-search').fill('banca');
    await benchRow.scrollIntoViewIfNeeded();
    const yList = await page.evaluate(() => window.scrollY);
    await benchRow.click();
    await page.waitForFunction(() => location.hash === '#/progress/exercise/press_banca');
    await page.waitForSelector('.prg-hist');
    // Al volver atrás se recupera el scroll (la lista de ejercicios está al final de la pantalla)
    await page.locator('.topbar .back-btn').click();
    await page.waitForFunction(() => location.hash === '#/progress' && !!document.querySelector('.prg-ex-row'));
    await page.waitForTimeout(250);
    const yBack = await page.evaluate(() => window.scrollY);
    assert.ok(yList > 1500 && Math.abs(yBack - yList) < 5, `scroll recuperado: ${yList} → ${yBack}`);
    assert.strictEqual(await page.locator('.prg-search').inputValue(), 'banca', 'se conserva la búsqueda');
    // «Todo» (periodo global) sigue funcionando al volver
    await page.locator('.prg-period-bar .seg-btn', { hasText: 'Todo' }).click();
    await page.waitForTimeout(120);
    assert.strictEqual((await chartState(page, '[data-chart="load"]')).n, '15');
    assert.ok(await noHScroll(page), 'sin scroll horizontal');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('#/progress/exercise/:id: KPIs, gráficas con periodo, globo «80 kg × 6 @2», historial completo con récords y enlaces', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const s = await seed(page);
    const exp = expected(s);
    await open(page, '#/progress/exercise/press_banca');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Press banca');
    assert.strictEqual(await page.locator('.topbar .back-btn').count(), 1, 'botón atrás');
    const kpi = (k) => page.locator(`.prg-kpis [data-kpi="${k}"] .kpi-value`).innerText();
    assert.strictEqual(await kpi('weight'), `${String(exp.benchMax).replace('.', ',')} kg`);
    assert.match(await kpi('e1rm'), /^\d+(,\d)? kg$/);
    assert.strictEqual(await kpi('sessions'), String(exp.benchSessions));
    assert.strictEqual(await kpi('last'), '21 sep');
    for (const id of ['maxWeight', 'e1rm', 'bestSet', 'volume']) {
      const st = await chartState(page, `[data-chart="${id}"]`);
      assert.ok(st.svg && !st.empty, `${id} con datos`);
    }
    // Nota del 1RM visible
    assert.match(await page.locator('[data-chart="e1rm"] .prg-note').innerText(), /Estimación con la fórmula de Epley usando reps \+ RIR; solo series de 1–12 reps/);
    // Globo de la mejor serie en la última sesión: «W kg × 6 @2»
    const b = await svgBox(page, '[data-chart="bestSet"]');
    await page.touchscreen.tap(xOfDate(b, exp.lastBench.date), b.y + b.height / 2);
    const setTxt = `${String(exp.lastBenchTop.weight).replace('.', ',')} kg × ${exp.lastBenchTop.reps} @${exp.lastBenchTop.rir}`;
    assert.match(await page.locator('[data-chart="bestSet"] .chart-tip').innerText(), new RegExp(setTxt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await shot(page, 'progress-exercise-tip');
    // Periodo del ejercicio (clave propia)
    await page.locator('.prg-period-bar .seg-btn', { hasText: '4 sem' }).click();
    await page.waitForTimeout(100);
    assert.strictEqual((await chartState(page, '[data-chart="e1rm"]')).from, '2026-08-24');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('entreno.period.exercise')), '4w');

    // Historial completo: una fila por sesión, más reciente arriba, sin calentamientos, con récords
    const rows = page.locator('.prg-hrow');
    assert.strictEqual(await rows.count(), exp.benchSessions);
    const first = await rows.first().innerText();
    assert.match(first, /21 sep 2026/);
    const firstSets = await rows.first().locator('.prg-set').count();
    assert.strictEqual(firstSets, 3, 'solo las 3 series de trabajo (el calentamiento no sale)');
    assert.ok(await page.locator('.prg-set-pr').count() >= 5, 'récords marcados 🏆');
    assert.strictEqual(await rows.last().locator('.prg-set-pr').count(), 0, 'la primera sesión nunca marca récord');
    await rows.first().click();
    await page.waitForFunction((id) => location.hash === `#/session/${id}`, exp.lastBench.id);
    await open(page, '#/progress/exercise/press_banca');
    await page.locator('[data-link="ficha"]').click();
    await page.waitForFunction(() => location.hash === '#/exercise/press_banca');

    // Tipos sin carga: plancha (tiempo), saltos (altura), sprint (tiempo por distancia, invertido)
    await open(page, '#/progress/exercise/plancha');
    assert.ok((await chartState(page, '[data-chart="maxTime"]')).svg);
    assert.match(await page.locator('.prg-kpis [data-kpi="time"] .kpi-value').innerText(), /1:\d\d min|\d+ s/);
    await open(page, '#/progress/exercise/saltos_verticales');
    assert.ok((await chartState(page, '[data-chart="maxHeight"]')).svg);
    await open(page, '#/progress/exercise/sprint');
    const sp = await chartState(page, '[data-chart="sprint"]');
    assert.ok(sp.svg);
    assert.deepStrictEqual(await page.locator('[data-chart="sprint"] .chart-legend-label').allTextContents(), ['20 m', '30 m']);
    // Dominadas (peso corporal): lastre, 1RM (incluye peso corporal), mejor serie, reps y volumen
    await open(page, '#/progress/exercise/dominadas');
    for (const id of ['maxWeight', 'e1rm', 'bestSet', 'maxReps', 'volume']) assert.ok((await chartState(page, `[data-chart="${id}"]`)).svg, `dominadas ${id}`);
    assert.match(await page.locator('[data-chart="e1rm"] .prg-note').innerText(), /peso corporal/);
    // Core con peso corporal y sin lastre (elevaciones de piernas): sin 1RM ni volumen ficticio; se sigue por reps
    await open(page, '#/progress/exercise/elevaciones_piernas');
    assert.deepStrictEqual(await page.locator('.prg-kpis .kpi').evaluateAll((els) => els.map((e) => e.dataset.kpi)), ['reps', 'sets', 'sessions', 'last']);
    assert.deepStrictEqual(await page.locator('[data-chart]').evaluateAll((els) => els.map((e) => e.dataset.chart)), ['maxReps']);
    // Ejercicio sin historial y que no existe
    await open(page, '#/progress/exercise/hack_squat');
    assert.match(await page.locator('#view').innerText(), /Sin historial todavía/);
    await open(page, '#/progress/exercise/no_existe');
    assert.match(await page.locator('#view').innerText(), /Ejercicio no encontrado/);
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('#/records: fuerza (mejor peso, 1RM estimado, reps a cada peso, buscador) y resistencia (5 km estimado desde 8 km…)', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const s = await seed(page);
    const exp = expected(s);
    await open(page, '#/records');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Récords');
    assert.strictEqual(await page.locator('.topbar .back-btn').count(), 1);
    const bench = page.locator('.prg-rec[data-ex="press_banca"]');
    assert.strictEqual(await bench.locator('[data-rec="weight"] .prg-rec-value').innerText(), `${String(exp.benchMax).replace('.', ',')} kg`);
    const e1 = await bench.locator('[data-rec="e1rm"]').innerText();
    assert.match(e1, /1RM estimado/);
    assert.match(e1, /estimación/i);
    assert.match(await bench.locator('[data-rec="weight"] .prg-rec-sub').innerText(), /2026/);
    // Mejores repeticiones a cada peso (desplegable)
    assert.ok(await bench.locator('.prg-rec-reps').isHidden());
    await bench.locator('.prg-rec-toggle').click();
    assert.ok(await bench.locator('.prg-rec-reps').isVisible());
    assert.ok(await bench.locator('.prg-rec-reps .prg-rec-row').count() >= 5);
    await shot(page, 'records-strength-reps');
    // Enlace a la sesión del récord
    const sid = await bench.locator('[data-rec="weight"]').getAttribute('data-session');
    assert.ok(s.sessions.some((x) => x.id === sid));
    // Buscador
    await page.locator('.prg-search').fill('sentad');
    await page.waitForTimeout(60);
    const found = await page.locator('.prg-rec[data-ex]').evaluateAll((els) => els.map((e) => e.dataset.ex));
    assert.ok(found.includes('sentadilla') && !found.includes('press_banca') && found.length < 6, `búsqueda «sentad»: ${found}`);
    await page.locator('.prg-search').fill('');
    // Tipos sin carga
    assert.match(await page.locator('.prg-rec[data-ex="plancha"] [data-rec="time"]').innerText(), /Tiempo máximo/);
    assert.match(await page.locator('.prg-rec[data-ex="sprint"]').innerText(), /Mejor en 20 m/);
    await page.locator('.prg-rec[data-ex="press_banca"] [data-rec="weight"]').click();
    await page.waitForFunction((id) => location.hash === `#/session/${id}`, sid);

    // Resistencia
    await open(page, '#/records');
    await page.locator('.seg-btn', { hasText: 'Resistencia' }).click();
    const run = page.locator('.prg-rec[data-sport="run"]');
    const row = (k) => run.locator(`[data-rec="${k}"]`).innerText();
    const r5 = await row('5k');
    assert.match(r5, /23:20/);
    assert.match(r5, /estimado a ritmo medio desde una carrera de 8 km/);
    assert.match(r5, /2 sep 2026/);
    const r10 = await row('10k');
    assert.match(r10, /58:20/);
    assert.match(r10, /desde una carrera de 12 km/);
    assert.match(await row('half'), /sin datos/);
    assert.match(await row('marathon'), /sin datos/);
    assert.match(await row('longest'), /15 km/);
    assert.match(await page.locator('.prg-rec[data-sport="bike"] [data-rec="longest"]').innerText(), /70 km/);
    assert.match(await page.locator('.prg-rec[data-sport="swim"] [data-rec="longest"]').innerText(), /2\.000 m/);
    await run.locator('[data-rec="5k"]').click();
    await page.waitForFunction(() => location.hash === '#/activity/r11_tempo' || location.hash === '#/session/r11_tempo');
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('base de datos vacía: estados vacíos útiles; #/bodyweight: la gráfica se redibuja al guardar, editar y borrar un pesaje', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await open(page, '#/progress');
    assert.ok(await page.locator('.prg-nodata').isVisible());
    assert.match(await page.locator('.prg-nodata').innerText(), /Aún no hay datos/);
    const load = await chartState(page, '[data-chart="load"]');
    assert.ok(load.empty && /Registra tu primera sesión/.test(load.emptyText), load.emptyText);
    assert.match((await chartState(page, '[data-chart="volume"]')).emptyText, /primera sesión de fuerza/);
    assert.match((await chartState(page, '[data-chart="muscle"]')).emptyText, /primera sesión de fuerza/);
    assert.match((await chartState(page, '[data-chart="km"]')).emptyText, /primera carrera/);
    assert.match((await chartState(page, '[data-chart="run-pace"]')).emptyText, /primera carrera/);
    assert.match((await chartState(page, '[data-chart="bike-speed"]')).emptyText, /primera salida en bici/);
    assert.match((await chartState(page, '[data-chart="bodyweight"]')).emptyText, /primer pesaje/);
    assert.strictEqual(await page.locator('[data-chart="swim-pace"]').count(), 0);
    // Sin ninguna serie de fuerza no hay tabla «esta semana» (16 músculos «por debajo» no dicen nada)
    assert.strictEqual(await page.locator('[data-chart="muscle-table"]').count(), 0);
    assert.strictEqual(await page.locator('.prg-mrow').count(), 0);
    assert.match(await page.locator('.prg-ex').innerText(), /Sin ejercicios todavía/);
    assert.ok(await noHScroll(page));
    await scrollShots(page, 'progress-empty', 4);

    await open(page, '#/records');
    assert.match(await page.locator('#view').innerText(), /Aún no hay récords de fuerza/);
    await page.locator('.seg-btn', { hasText: 'Resistencia' }).click();
    // Carrera (distancia + 4 tiempos), bici, natación y senderismo (distancia y desnivel)
    assert.strictEqual(await page.locator('.prg-rec-na', { hasText: 'sin datos' }).count(), 9);
    await shot(page, 'records-empty');

    await open(page, '#/progress/exercise/press_banca');
    assert.match(await page.locator('#view').innerText(), /Sin historial todavía/);

    // #/bodyweight: vacía → guardar → 1 punto → otro día → 2 → editar → borrar
    await open(page, '#/bodyweight');
    const slot = '.bw-chart-slot';
    let st = await chartState(page, slot);
    assert.ok(st.empty && /Registra tu primer pesaje/.test(st.emptyText));
    assert.strictEqual(await page.locator(`${slot} .chart-period`).count(), 1, 'selector de periodo propio');
    await page.fill('[aria-label="Peso (kg)"]', '75,4');
    await page.locator('.bw-entry .btn-primary').click();
    await page.waitForTimeout(200);
    st = await chartState(page, slot);
    assert.ok(st.svg && !st.empty, 'la gráfica aparece al guardar');
    assert.strictEqual(await dotCount(page, `${slot} [data-id="daily"]`), 1);
    await page.fill('.bw-date', '2026-09-20');
    await page.locator('.bw-date').dispatchEvent('change');
    await page.fill('[aria-label="Peso (kg)"]', '76,1');
    await page.locator('.bw-entry .btn-primary').click();
    await page.waitForTimeout(200);
    assert.strictEqual(await dotCount(page, `${slot} [data-id="daily"]`), 2);
    // Toque en el 20 sep: pesaje exacto
    let b = await svgBox(page, slot);
    await page.touchscreen.tap(xOfDate(b, '2026-09-20'), b.y + b.height / 2);
    assert.match(await page.locator(`${slot} .chart-tip`).innerText(), /20 sep 2026[\s\S]*76,1 kg/);
    // Editar el pesaje del 20 sep desde la lista (hoja): la gráfica se redibuja con el valor nuevo
    await page.locator('.bw-row[data-id="2026-09-20"]').click();
    await page.locator('.sheet-overlay.open [aria-label="Peso del pesaje (kg)"]').fill('77');
    await page.locator('.sheet-overlay.open [aria-label="Peso del pesaje (kg)"]').dispatchEvent('change');
    await page.locator('.sheet-overlay.open .sheet-actions .btn', { hasText: 'Listo' }).click();
    await page.waitForTimeout(350);
    b = await svgBox(page, slot);
    await page.touchscreen.tap(xOfDate(b, '2026-09-20'), b.y + b.height / 2);
    assert.match(await page.locator(`${slot} .chart-tip`).innerText(), /77 kg/);
    // Borrar → 1 punto
    await page.locator('.bw-row[data-id="2026-09-20"]').click();
    await page.locator('.sheet-overlay.open button', { hasText: 'Borrar pesaje' }).click();
    await page.waitForTimeout(350);
    assert.strictEqual(await dotCount(page, `${slot} [data-id="daily"]`), 1);
    // Periodo propio de la gráfica de peso
    await page.locator(`${slot} .seg-btn`, { hasText: '1 año' }).click();
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('entreno.period.bodyweight')), '1y');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('sin desbordamiento horizontal a 375 y 390 px, sin errores de consola; capturas de todas las pantallas', async () => {
  for (const [w, hgt] of [[390, 844], [375, 667]]) {
    const app = await launch({ width: w, height: hgt });
    const { page } = app;
    try {
      await seed(page);
      const tag = `${w}`;
      await open(page, '#/progress');
      assert.ok(await noHScroll(page), `#/progress a ${w}px`);
      await scrollShots(page, `progress-${tag}`, 16);
      await open(page, '#/progress/exercise/press_banca');
      assert.ok(await noHScroll(page), `ejercicio a ${w}px`);
      await scrollShots(page, `progress-exercise-${tag}`, 8);
      await open(page, '#/progress/exercise/dominadas');
      assert.ok(await noHScroll(page));
      await open(page, '#/progress/exercise/sprint');
      assert.ok(await noHScroll(page));
      await shot(page, `progress-exercise-sprint-${tag}`);
      await open(page, '#/records');
      assert.ok(await noHScroll(page), `récords a ${w}px`);
      await scrollShots(page, `records-${tag}`, 3);
      await page.locator('.seg-btn', { hasText: 'Resistencia' }).click();
      await page.waitForTimeout(100);
      assert.ok(await noHScroll(page));
      await scrollShots(page, `records-endurance-${tag}`, 3);
      await page.locator('.seg-btn', { hasText: 'Fuerza' }).click();
      await open(page, '#/bodyweight');
      assert.ok(await noHScroll(page), `peso a ${w}px`);
      await page.locator('.bw-chart-slot').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -70));
      await page.waitForTimeout(100);
      await shot(page, `bodyweight-chart-${tag}`);
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  }
});

/** Sesión de fuerza mínima a mano: items = [[exerciseId, [series]]]. */
let manualSeq = 0;
function manualStrength(date, items, { dur = 60, rpe = 8 } = {}) {
  const at = madrid(date, 18);
  const id = `man${++manualSeq}`;
  return {
    id, kind: 'strength', date, planDate: date, templateId: null, templateName: 'Sesión libre', status: 'done', startedAt: at, endedAt: at + dur * 60000,
    durationMin: dur, rpe, notes: '', parentId: null, templateItemId: null, cursor: 0, templateItemIds: [], createdAt: at, updatedAt: at,
    exercises: items.map(([exerciseId, sets], i) => ({
      id: `${id}_se${i}`, exerciseId, exName: exerciseId, templateItemId: null, alternatives: [], target: { sets: sets.length, repMin: null, repMax: null },
      notes: '', section: '', groupId: null, groupType: null,
      sets: sets.map((x, j) => ({ id: `${id}_s${i}_${j}`, type: 'effective', weight: null, reps: null, repsR: null, rir: null, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: at + j * 60000, ...x })),
    })),
  };
}
async function put(page, sessions, createdAt = null) {
  await page.evaluate(async ({ sessions, createdAt }) => {
    const { store } = window.__app;
    if (createdAt) { const meta = store.get('meta', 'app'); meta.createdAt = createdAt; await store.save('meta', meta); }
    await Promise.all(sessions.map((x) => store.save('sessions', x)));
  }, { sessions, createdAt });
}
const fmt0 = (page, v) => page.evaluate((x) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: true }).format(x), v);

test('carga: «Media N sem.» es la media de las semanas completas ANTERIORES (sin la semana en curso); km con un deporte: globo con su nombre', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const s = await seed(page);
    const exp = expected(s);
    await open(page, '#/progress');
    // Jueves 24 sep: la referencia son las 4 semanas completas del 24 ago al 20 sep (la del 21 sep está a medias)
    const prev4 = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14'].map(exp.loadOfWeek);
    const avg4 = prev4.reduce((a, b) => a + b, 0) / 4;
    const stats = page.locator('[data-chart="load"] .prg-stat');
    assert.strictEqual(await stats.count(), 3);
    assert.strictEqual(await stats.nth(2).locator('.prg-stat-label').innerText(), 'Media 4 sem.');
    assert.strictEqual(await stats.nth(2).locator('.prg-stat-value').innerText(), await fmt0(page, avg4));
    assert.strictEqual(await stats.nth(2).locator('.prg-stat-sub').innerText(), 'anteriores');
    assert.strictEqual(await stats.nth(0).locator('.prg-stat-value').innerText(), await fmt0(page, exp.loadOfWeek('2026-09-21')));
    // La línea de la semana en curso vale lo mismo; su nombre dice cuántas semanas promedia y el valor va solo
    await page.locator('.prg-period-bar .seg-btn', { hasText: '4 sem' }).click();
    await page.waitForTimeout(120);
    const b = await svgBox(page, '[data-chart="load"]');
    await page.touchscreen.tap(xOfBar(b, 4), b.y + b.height * 0.6);
    const tipRow = (name) => page.locator('[data-chart="load"] .chart-tip .chart-tip-row', { hasText: name }).locator('.chart-tip-val').innerText();
    assert.strictEqual(await tipRow('Media 4 sem. previas'), await fmt0(page, avg4));
    assert.doesNotMatch(await page.locator('[data-chart="load"] .chart-tip').innerText(), /aún no hay 4/, 'con 4 semanas no hay aclaración');
    // Semana del 14 sep: su referencia son las 4 anteriores (17 ago – 13 sep), no ella misma
    await page.touchscreen.tap(xOfBar(b, 3), b.y + b.height * 0.6);
    const ref14 = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'].map(exp.loadOfWeek).reduce((a, x) => a + x, 0) / 4;
    assert.strictEqual(await tipRow('Media 4 sem. previas'), await fmt0(page, ref14));

    // Kilómetros con un solo deporte: el globo dice «Carrera» (no la clave interna «run»)
    await page.locator('[data-chart="km"] .seg-btn', { hasText: 'Carrera' }).click();
    await page.waitForTimeout(80);
    const kb = await svgBox(page, '[data-chart="km"]');
    await page.touchscreen.tap(xOfBar(kb, 2), kb.y + kb.height * 0.7); // 7–13 sep: 6 + 15 km
    const kt = await page.locator('[data-chart="km"] .chart-tip').innerText();
    assert.match(kt, /7–13 sep 2026/);
    assert.match(kt, /Carrera/);
    assert.doesNotMatch(kt, /\brun\b/);
    await page.locator('[data-chart="km"] .seg-btn', { hasText: 'Bici' }).click();
    await page.waitForTimeout(80);
    await page.touchscreen.tap(xOfBar(kb, 2), kb.y + kb.height * 0.7);
    assert.match(await page.locator('[data-chart="km"] .chart-tip').innerText(), /Bici/);
    await page.locator('[data-chart="km"] .seg-btn', { hasText: 'Todos' }).click();

    // Mismo periodo, mismos días: con «4 sem» el ritmo cuenta las carreras desde el lunes 24 ago (como las barras)
    const runs = s.sessions.filter((x) => x.kind === 'run' && x.date >= '2026-08-24');
    assert.match(await page.locator('[data-chart="run-pace"] .prg-stats').innerText(), new RegExp(`en ${runs.length} carreras`));
    // «Hechas» de la adherencia: rótulo corto, entero (sin «…»)
    assert.strictEqual(await page.locator('[data-chart="adherence"] .prg-stat-label').first().innerText(), 'Hechas');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('carga con pocas semanas: «Media N sem.» con las que hay; recién empezado (1.ª semana) no hay media', async () => {
  const app = await launch();
  const { page } = app;
  try {
    // Tres semanas completas (31 ago, 7 y 14 sep) + la semana en curso vacía
    await put(page, [
      manualStrength('2026-08-31', [['press_banca', [{ weight: 80, reps: 5, rir: 2 }]]], { dur: 60, rpe: 8 }),
      manualStrength('2026-09-07', [['press_banca', [{ weight: 80, reps: 6, rir: 2 }]]], { dur: 50, rpe: 8 }),
      manualStrength('2026-09-14', [['press_banca', [{ weight: 80, reps: 8, rir: 1 }]]], { dur: 40, rpe: 8 }),
    ]);
    await open(page, '#/progress');
    const stats = page.locator('[data-chart="load"] .prg-stat');
    assert.strictEqual(await stats.nth(2).locator('.prg-stat-label').innerText(), 'Media 3 sem.');
    assert.strictEqual(await stats.nth(2).locator('.prg-stat-value').innerText(), '400'); // (480 + 400 + 320) / 3
    assert.strictEqual(await stats.nth(0).locator('.prg-stat-value').innerText(), '0');
    // En el globo de la semana en curso, la media es solo el valor y la aclaración va como nota
    await page.evaluate(() => localStorage.setItem('entreno.period.global', 'all'));
    await open(page, '#/progress');
    const b = await svgBox(page, '[data-chart="load"]');
    assert.strictEqual(b.ds.n, '4', '31 ago – 21 sep');
    await page.touchscreen.tap(xOfBar(b, 3), b.y + b.height * 0.6);
    const tip = page.locator('[data-chart="load"] .chart-tip');
    assert.strictEqual(await tip.locator('.chart-tip-row', { hasText: 'Media 4 sem. previas' }).locator('.chart-tip-val').innerText(), '400');
    assert.match(await tip.locator('.chart-tip-note').allInnerTexts().then((x) => x.join(' | ')), /Media de solo 3 semanas anteriores \(aún no hay 4\)/);
  } finally {
    await app.close();
  }
  const app2 = await launch();
  try {
    await put(app2.page, [manualStrength('2026-09-22', [['press_banca', [{ weight: 80, reps: 5, rir: 2 }]]])]);
    await open(app2.page, '#/progress');
    const labels = await app2.page.locator('[data-chart="load"] .prg-stat-label').allInnerTexts();
    assert.deepStrictEqual(labels, ['Esta semana'], 'primera semana: sin semana pasada ni media');
    assert.deepStrictEqual(app2.errors, []);
  } finally {
    await app2.close();
  }
});

test('#/records: con un solo peso (doble progresión) salen las mejores reps a ese peso y su fecha', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await put(page, [
      manualStrength('2026-08-31', [['elevaciones_laterales', [{ weight: 10, reps: 12, rir: 2 }, { weight: 10, reps: 11, rir: 1 }]], ['press_banca', [{ weight: 80, reps: 5, rir: 2 }]], ['remo_unilateral', [{ weight: 24, reps: 8, repsR: 8, rir: 2 }]], ['dominadas', [{ weight: null, reps: 8, rir: 2 }]]]),
      manualStrength('2026-09-07', [['elevaciones_laterales', [{ weight: 10, reps: 15, rir: 2 }, { weight: 10, reps: 14, rir: 1 }]], ['press_banca', [{ weight: 80, reps: 6, rir: 2 }]], ['remo_unilateral', [{ weight: 24, reps: 10, repsR: 10, rir: 2 }]], ['dominadas', [{ weight: null, reps: 10, rir: 2 }]]]),
      manualStrength('2026-09-14', [['elevaciones_laterales', [{ weight: 10, reps: 18, rir: 2 }, { weight: 10, reps: 16, rir: 1 }]], ['press_banca', [{ weight: 80, reps: 8, rir: 1 }]], ['remo_unilateral', [{ weight: 24, reps: 12, repsR: 12, rir: 1 }]], ['dominadas', [{ weight: null, reps: 12, rir: 1 }]]]),
    ]);
    await open(page, '#/records');
    const card = (id) => page.locator(`.prg-rec[data-ex="${id}"]`);
    const lat = card('elevaciones_laterales').locator('[data-rec="reps-at"]');
    assert.strictEqual(await lat.count(), 1);
    assert.match(await lat.locator('.prg-rec-label').innerText(), /Mejores reps con 10 kg/);
    assert.strictEqual(await lat.locator('.prg-rec-value').innerText(), '× 18');
    assert.match(await lat.locator('.prg-rec-sub').innerText(), /14 sep 2026/);
    // El mejor peso sigue diciendo la primera vez que lo alcanzaste
    assert.match(await card('elevaciones_laterales').locator('[data-rec="weight"] .prg-rec-sub').innerText(), /31 ago 2026/);
    assert.strictEqual(await card('press_banca').locator('[data-rec="reps-at"] .prg-rec-value').innerText(), '× 8');
    assert.strictEqual(await card('remo_unilateral').locator('[data-rec="reps-at"] .prg-rec-value').innerText(), '× 12/lado');
    // Sin desplegable (un solo peso) y sin fila repetida en peso corporal sin lastre («Más repeticiones» ya lo dice)
    assert.strictEqual(await card('press_banca').locator('.prg-rec-toggle').count(), 0);
    assert.strictEqual(await card('dominadas').locator('[data-rec="reps-at"]').count(), 0);
    assert.match(await card('dominadas').locator('[data-rec="reps"]').innerText(), /12 reps/);
    const sid = await lat.getAttribute('data-session');
    await lat.click();
    await page.waitForFunction((id) => location.hash === `#/session/${id}`, sid);
    // Ficha: la «mejor serie» también sale los días sin 1RM estimado (todas las series de más de 12 reps)
    await page.evaluate(() => localStorage.setItem('entreno.period.exercise', 'all'));
    await open(page, '#/progress/exercise/elevaciones_laterales');
    assert.strictEqual(await dotCount(page, '[data-chart="bestSet"] [data-id="bestSet"]'), 3);
    const bs = await svgBox(page, '[data-chart="bestSet"]');
    await page.touchscreen.tap(xOfDate(bs, '2026-09-14'), bs.y + bs.height / 2);
    assert.match(await page.locator('[data-chart="bestSet"] .chart-tip').innerText(), /10 kg × 18 @2/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('ficha: «Mejor serie» con doble progresión dibuja las reps (según el periodo); core sin 1RM estimado', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await put(page, [
      // 4 may: la serie más pesada (85 × 1) no es la mejor (80 × 6 @2 tiene más 1RM estimado)
      manualStrength('2026-05-04', [['press_banca', [{ weight: 80, reps: 6, rir: 2 }, { weight: 85, reps: 1, rir: 0 }]], ['rueda_abdominal', [{ reps: 10, rir: 2 }, { reps: 8, rir: 1 }]]]),
      manualStrength('2026-09-07', [['press_banca', [{ weight: 80, reps: 5, rir: 2 }]], ['rueda_abdominal', [{ reps: 12, rir: 1 }]]]),
      manualStrength('2026-09-14', [['press_banca', [{ weight: 80, reps: 6, rir: 2 }]], ['rueda_abdominal', [{ reps: 12, rir: 2 }, { weight: 5, reps: 8, rir: 1 }]]]),
    ]);
    await page.evaluate(() => localStorage.setItem('entreno.period.exercise', 'all'));
    await open(page, '#/progress/exercise/press_banca');
    const card = page.locator('[data-chart="bestSet"]');
    assert.strictEqual(await card.getAttribute('data-mode'), 'weight', 'con el 4 may, la mejor serie no siempre es la más pesada');
    assert.strictEqual(await card.locator('.prg-card-sub').innerText(), 'kg · la serie con mayor 1RM estimado de cada sesión (sin series de 1–12 reps, la de más peso × reps)');
    let bs = await svgBox(page, '[data-chart="bestSet"]');
    await page.touchscreen.tap(xOfDate(bs, '2026-05-04'), bs.y + bs.height / 2);
    assert.match(await card.locator('.chart-tip').innerText(), /80 kg × 6 @2/);
    // 4 semanas: siempre 80 kg, igual que el peso máximo → la gráfica pasa a las reps de esa serie
    await page.locator('.prg-period-bar .seg-btn', { hasText: '4 sem' }).click();
    await page.waitForTimeout(150);
    assert.strictEqual(await card.getAttribute('data-mode'), 'reps');
    assert.match(await card.locator('.prg-card-sub').innerText(), /^reps · la mejor serie de cada sesión \(en este periodo, su peso es siempre el peso máximo\)$/);
    bs = await svgBox(page, '[data-chart="bestSet"]');
    await page.touchscreen.tap(xOfDate(bs, '2026-09-14'), bs.y + bs.height / 2);
    assert.match(await card.locator('.chart-tip').innerText(), /80 kg × 6 @2/, 'el globo sigue dando la serie entera');
    const ticks = await card.locator('.chart-svg text').allTextContents();
    assert.ok(ticks.includes('6') && !ticks.some((x) => /^8\d$/.test(x)), `eje en reps: ${ticks.join(' | ')}`);

    // Core de peso corporal (rueda abdominal): sin KPI ni gráfica de 1RM; volumen = solo el lastre
    await open(page, '#/progress/exercise/rueda_abdominal');
    assert.deepStrictEqual(await page.locator('.prg-kpis .kpi').evaluateAll((els) => els.map((e) => e.dataset.kpi)), ['weight', 'reps', 'sessions', 'last']);
    assert.deepStrictEqual(await page.locator('[data-chart]').evaluateAll((els) => els.map((e) => e.dataset.chart)), ['maxWeight', 'bestSet', 'maxReps', 'volume']);
    assert.strictEqual(await page.locator('[data-chart="volume"] .prg-card-sub').innerText(), 'kg por sesión · lastre × reps (en core el peso corporal no cuenta)');
    await open(page, '#/records');
    const wheel = page.locator('.prg-rec[data-ex="rueda_abdominal"]');
    assert.strictEqual(await wheel.locator('[data-rec="e1rm"]').count(), 0, 'sin «Mejor 1RM estimado» de 111 kg');
    assert.strictEqual(await page.locator('.prg-rec[data-ex="press_banca"] [data-rec="e1rm"]').count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('«Esta semana por músculo» sin alarmas a mitad de semana; adherencia de 1 año legible (hechas delante de planificadas)', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/progress');
    // Jueves con 3 sesiones hechas: lo que aún no llega al mínimo sale en gris («Faltan N»), nunca «Por debajo»
    assert.strictEqual(await page.locator('.prg-mrow[data-status="below"]').count(), 0);
    assert.strictEqual(await page.locator('.prg-status-below').count(), 0);
    const short = page.locator('.prg-mrow[data-status="short"]');
    assert.ok(await short.count() >= 1);
    assert.match(await short.first().locator('.prg-status').innerText(), /^Faltan \d+(,\d)?$/);
    assert.match(await short.first().getAttribute('aria-label'), /faltan [\d,]+ series? para el mínimo/);
    // Mapa corporal de la tarjeta (ronda 4): semana en curso → «Faltan series» en vez de «Por debajo»
    const card = page.locator('[data-chart="muscle-table"]');
    assert.strictEqual(await card.locator('.bm.bm-in-progress .bm-zone').count(), 16);
    assert.deepStrictEqual(await card.locator('.bm-legend-label').allInnerTexts(), ['Faltan series', 'En rango', 'Por encima', 'Sin series']);
    // Globo de la semana en curso en la gráfica por músculo
    const b = await svgBox(page, '[data-chart="muscle"]');
    const n = Number(b.ds.n);
    await page.touchscreen.tap(xOfBar(b, n - 1), b.y + b.height * 0.6);
    const tip = await page.locator('[data-chart="muscle"] .chart-tip').innerText();
    assert.match(tip, /Semana en curso/);
    assert.doesNotMatch(tip, /Por debajo/);
  } finally {
    await app.close();
  }

  // 60 semanas de historial (una sesión cada lunes): con «Todo», las barras de adherencia se superponen (la
  // hecha delante de la planificada) en vez de ser sub-barras de 1 px una al lado de otra.
  const app2 = await launch();
  try {
    const { page: p2 } = app2;
    const mondays = [];
    for (let d = weekStart(addDays(TODAY, -7 * 60)); d < TODAY; d = addDays(d, 7)) mondays.push(d);
    await put(p2, mondays.map((d) => manualStrength(d, [['press_banca', [{ weight: 80, reps: 5, rir: 2 }]]])), madrid(mondays[0], 9));
    await p2.evaluate(() => localStorage.setItem('entreno.period.global', 'all'));
    await open(p2, '#/progress');
    const paths = await p2.locator('[data-chart="adherence"] .chart-bar').evaluateAll((els) => els.map((e) => ({
      fill: e.style.fill, xs: [...e.getAttribute('d').matchAll(/M([\d.]+) /g)].map((m) => Number(m[1])),
    })));
    assert.strictEqual(paths.length, 2, JSON.stringify(paths.map((x) => x.fill)));
    const [planned, done] = paths; // capa trasera (planificadas) primero
    assert.ok(planned.xs.length > 50 && done.xs.length > 50, `${planned.xs.length} / ${done.xs.length}`);
    const same = done.xs.filter((x) => planned.xs.some((y) => Math.abs(x - y) < 0.2)).length;
    assert.ok(same / done.xs.length > 0.9, `hechas encima de planificadas: ${same} de ${done.xs.length}`);
    await p2.locator('[data-chart="adherence"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await p2.waitForTimeout(100);
    await shot(p2, 'progress-adherence-all');
    assert.deepStrictEqual(app2.errors, []);
  } finally {
    await app2.close();
  }
});

test('selector de periodo: compacto, solo pegado sobre las gráficas (no sobre la tabla semanal, la lista ni el historial); textos sin «…»', async () => {
  for (const [w, hgt] of [[375, 667], [390, 844]]) {
    const app = await launch({ width: w, height: hgt });
    const { page } = app;
    try {
      await seed(page);
      await open(page, '#/progress');
      const barBox = () => page.evaluate(() => {
        const bar = document.querySelector('.prg-period-bar').getBoundingClientRect();
        const top = document.querySelector('.topbar').getBoundingClientRect();
        return { top: bar.top, bottom: bar.bottom, height: bar.height, topbar: top.bottom };
      });
      const bb = await barBox();
      assert.ok(bb.height <= 60, `alto del selector ${bb.height}`);
      // En mitad de las gráficas se pega bajo la cabecera
      await page.locator('[data-chart="km"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(100);
      let b = await barBox();
      assert.ok(Math.abs(b.top - b.topbar) < 2, `pegado bajo la cabecera: ${JSON.stringify(b)}`);
      // Sobre la tabla «esta semana» y la lista de ejercicios ya no está
      for (const sel of ['[data-chart="muscle-table"]', '.prg-ex']) {
        await page.locator(sel).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(100);
        b = await barBox();
        assert.ok(b.bottom <= b.topbar + 1, `${sel}: el selector se va con las gráficas (${JSON.stringify(b)})`);
      }
      // Etiquetas de datos y nombres de ejercicio enteros (sin cortar con «…»)
      const cut = await page.evaluate(() => [...document.querySelectorAll('.prg-stat-label, .prg-ex-row .list-item-title')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      assert.deepStrictEqual(cut, [], `textos cortados a ${w}px`);
      const incl = page.locator('.prg-ex-row', { hasText: 'Press inclinado con mancuernas' });
      assert.ok(await incl.count() >= 1);
      if (w === 375) {
        await page.locator('[data-chart="adherence"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(80);
        await shot(page, 'progress-375-adherence');
        await incl.first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(80);
        await shot(page, 'progress-375-exercises');
      }
      // Ficha del ejercicio: el historial no queda bajo el selector
      await open(page, '#/progress/exercise/press_banca');
      await page.locator('.prg-hist').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(100);
      b = await barBox();
      assert.ok(b.bottom <= b.topbar + 1, `historial sin selector encima (${JSON.stringify(b)})`);
      await page.locator('[data-chart="volume"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(100);
      b = await barBox();
      assert.ok(Math.abs(b.top - b.topbar) < 2, `ficha: pegado sobre las gráficas (${JSON.stringify(b)})`);
      assert.ok(await noHScroll(page));
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  }
});

// Reutilizables desde scripts de diagnóstico (p. ej. medir el rendimiento con más datos).
module.exports = { launch, open, seed, buildSeed, expected, addDays, madrid, TODAY, START };
