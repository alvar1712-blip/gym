// E2E del panel semanal (Fase 3): #/weekly?week=YYYY-MM-DD y la tarjeta resumen weeklySummaryCard().
// Siembra 6 semanas + la actual (lunes a miércoles) de datos realistas con la rutina precargada (D1, D2, D3, D4,
// D6), carreras, bici y check-ins, con la fecha fijada (jueves 24 sep 2026). Comprueba: bloque INFORMACIÓN y
// después SUGERENCIAS, cada mensaje con su «¿Por qué?» y datos concretos, navegación de semanas, estados vacíos,
// sin errores de consola ni desbordamiento horizontal. Deja capturas en test-results/ (weekly-*.png).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/weekly.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { waitReady, go } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');
const TODAY = '2026-09-24'; // jueves
const START = '2026-08-10'; // lunes, 6 semanas antes de la actual (21 sep)
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}
const dowOf = (s) => (new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))).getUTCDay() + 6) % 7;
const weekStart = (s) => addDays(s, -dowOf(s));
const nf0 = (v) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: true }).format(v);

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
  return { browser, context, page, errors, url: server.url, close: async () => { await browser.close(); await server.close(); } };
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
/** Pulsa algo que cambia de pantalla y espera a la nueva. */
async function clickAndWait(page, locator) {
  await page.evaluate(() => { const el = document.querySelector('#view > *'); if (el) el.dataset.stale = '1'; });
  await locator.click();
  await waitFresh(page);
}

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Textos recortados («…» o line-clamp) dentro de `sel`: devuelve los que no caben en su caja. */
const clipped = (page, sel) => page.locator(sel).evaluateAll((els) => els
  .filter((el) => el.offsetParent && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1))
  .map((el) => el.textContent));

/** Ancho (px) de la barra de cada fila de la tabla de músculos. */
const barWidths = (page) => page.locator('.wk-mbar').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));

/**
 * Listas de datos de los «¿Por qué?» abiertos dentro de `root`: cada lista va entera en dos columnas o entera
 * apilada (nunca en zigzag) y, en dos columnas, ningún valor se parte en dos líneas. Devuelve los fallos.
 */
const whyLayoutIssues = (page, root) => page.locator(`${root} .wk-why-data`).evaluateAll((lists) => {
  const lines = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
  };
  const out = [];
  for (const ul of lists) {
    if (!ul.offsetParent) continue;
    const stacked = ul.classList.contains('wk-why-stacked');
    const dirs = new Set([...ul.children].map((li) => getComputedStyle(li).flexDirection));
    if (dirs.size !== 1) out.push(`zigzag: ${ul.textContent.slice(0, 60)}`);
    if (stacked) continue;
    for (const v of ul.querySelectorAll('.wk-why-value')) if (lines(v) > 1) out.push(`valor partido: ${v.textContent}`);
  }
  return out;
});

async function shot(page, name) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
async function scrollShots(page, prefix, max = 14) {
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
// Datos sembrados (deterministas)
// ---------------------------------------------------------------------------
// Por ejercicio: (semana, plantilla) → { weight, reps:[…], rir:[…] }. Diseñado para que haya de todo:
// press banca progresa y en la última sesión llega al tope (→ sube 2,5 kg); remo con pecho apoyado, jalón y
// sentadilla no mejoran (estancados); sentadilla hack solo 3 sesiones iguales (se mantiene); curl supinador y
// búlgara al tope (aislamiento 1–2 kg y tren inferior por lado).
const top = (it) => it.repMax ?? it.repMin ?? 8;
const lin = (base, inc) => (w) => base + inc * w;
const PLAN = {
  press_banca: (w) => ({ weight: 70 + 2.5 * w, reps: w === 6 ? [6, 6, 6] : [6, 5, 5], rir: [2, 1, 1] }),
  dominadas: (w, it) => (it.repMax === 8
    ? { weight: 1.25 * w || null, reps: [8, 8, 8], rir: [1, 1, 1] }
    : { weight: 1.25 * w || null, reps: [10, 9], rir: [1, 1] }),
  remo_pecho_apoyado: () => ({ weight: 60, reps: [10, 9, 8], rir: [1, 1, 1] }),
  jalon_pecho: () => ({ weight: 55, reps: [12, 11, 10], rir: [1, 1, 1] }),
  sentadilla: () => ({ weight: 100, reps: [6, 5, 5], rir: [2, 2, 2] }),
  hack_squat: () => ({ weight: 100, reps: [12, 11], rir: [1, 1] }),
  curl_supinador: () => ({ weight: 12, reps: [15, 15], rir: [1, 1] }),
  bulgara: (w) => ({ weight: 14 + 0.5 * w, reps: [8, 8], rir: [1, 1] }),
  nordic: (w) => ({ weight: null, reps: [Math.min(10, 8 + Math.floor(w / 2)), 8], rir: [1, 1] }),
};
const WEIGHT = {
  press_inclinado_mancuerna: lin(24, 0.5), elevaciones_laterales: lin(10, 0), face_pull: lin(20, 0.5), crunch_polea: lin(35, 1),
  peso_muerto_rumano: lin(80, 2.5), prensa: lin(140, 5), curl_femoral: lin(40, 1), gemelos_pie: lin(60, 1), tibialis_raises: lin(5, 0),
  press_inclinado_smith: lin(55, 1.25), aperturas_mancuerna: lin(12, 0.25), remo_unilateral: lin(24, 0.5), triceps_sobre_cabeza: lin(20, 0.5),
};

function setsFor(sid, i, it, ex, w, at) {
  const sets = [];
  const mk = (o) => ({
    id: `${sid}_s${i}_${sets.length}`, type: 'effective', weight: null, reps: null, repsR: null, rir: null, timeSec: null,
    distanceM: null, heightCm: null, note: '', done: true, doneAt: at + (i * 5 + sets.length) * 60000, ...o,
  });
  const n = it.sets || 1;
  const plan = PLAN[ex.id] ? PLAN[ex.id](w, it) : null;
  const t = top(it);
  const repsDefault = Array.from({ length: n }, (_, j) => Math.max(it.repMin ?? t, t - j));
  switch (ex.logType) {
    case 'weight_reps':
    case 'bodyweight': {
      const p = plan || { weight: ex.logType === 'bodyweight' ? null : (WEIGHT[ex.id] || lin(20, 0.5))(w), reps: repsDefault, rir: repsDefault.map(() => 1) };
      if (ex.id === 'press_banca' || ex.id === 'sentadilla') sets.push(mk({ type: 'warmup', weight: Math.round(p.weight * 0.5), reps: 8 }));
      p.reps.forEach((r, j) => sets.push(mk({ weight: p.weight, reps: r, rir: p.rir[j] ?? 1 })));
      break;
    }
    case 'unilateral': {
      const p = plan || { weight: (WEIGHT[ex.id] || lin(16, 0.5))(w), reps: repsDefault, rir: repsDefault.map(() => 1) };
      p.reps.forEach((r, j) => sets.push(mk({ weight: p.weight, reps: r, repsR: r, rir: p.rir[j] ?? 1 })));
      break;
    }
    case 'time':
      for (let j = 0; j < n; j++) sets.push(mk({ timeSec: 45 + 3 * w - 5 * j }));
      break;
    case 'distance_time':
      for (let j = 0; j < n; j++) sets.push(mk({ distanceM: it.distance || 20, timeSec: 3.4 + 0.02 * j }));
      break;
    case 'jumps':
      for (let j = 0; j < n; j++) sets.push(mk({ reps: t, heightCm: ex.id === 'saltos_verticales' ? 42 + w : null }));
      break;
    default:
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
      // Semanas 4–6: prensa → sentadilla hack (su alternativa); solo 3 sesiones iguales → «se mantiene».
      const exId = it.exerciseId === 'prensa' && w >= 4 ? 'hack_squat' : it.exerciseId;
      const ex = exById[exId];
      return {
        id: `${id}_se${i}`, exerciseId: exId, exName: ex.name, templateItemId: it.id, alternatives: it.alternatives || [],
        target: { sets: it.sets, setsMax: null, repMin: it.repMin ?? null, repMax: it.repMax ?? null, timeMin: it.timeMin ?? null, timeMax: it.timeMax ?? null, distance: it.distance ?? null },
        notes: '', section: it.section || '', groupId: null, groupType: null, sets: setsFor(id, i, it, ex, w, at),
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

function buildSeed(templates, exercises) {
  const tpl = Object.fromEntries(templates.map((t) => [t.id, t]));
  const exById = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const sessions = [];
  for (let w = 0; w <= 6; w++) {
    const mon = addDays(START, 7 * w);
    const day = (d) => addDays(mon, d);
    const add = (s) => { if (s.date < TODAY) sessions.push(s); };
    const hard = w >= 5 ? 9 : 8; // esfuerzo alto sostenido en las dos últimas semanas
    add(strength(`s${w}_d1`, day(0), tpl.tpl_d1, w, exById, { rpe: hard }));
    add(strength(`s${w}_d2`, day(1), tpl.tpl_d2, w, exById, { dur: 70, rpe: hard }));
    add(strength(`s${w}_d3`, day(2), tpl.tpl_d3, w, exById, { dur: 10, rpe: 6 }));
    add(activity(`r${w}_z2`, 'run', day(2), { km: 6, sec: 2160, rpe: 5, subtype: 'z2' }));
    add(activity(`b${w}_easy`, 'bike', day(2), { km: 30, sec: 4500, rpe: 5, subtype: 'easy', hh: 19 }));
    add(strength(`s${w}_d4`, day(3), tpl.tpl_d4, w, exById, { dur: 70, rpe: hard }));
    add(strength(`s${w}_d6`, day(5), tpl.tpl_d6, w, exById, { dur: 60, rpe: 8 }));
    // Semana 5 (14–20 sep): ruta larga en bici y tirada más larga → avisos de carga y de km de carrera.
    if (w === 5) add(activity(`b${w}_route`, 'bike', day(5), { km: 80, sec: 10800, rpe: 7, subtype: 'route', hh: 9 }));
    add(activity(`r${w}_long`, 'run', day(6), { km: w === 5 ? 16 : 12, sec: w === 5 ? 5600 : 4200, rpe: 6, subtype: 'long', hh: 9 }));
  }
  const checkins = [
    { id: 'ck1', date: '2026-09-21', timing: 'pre', sessionId: 's6_d1', sleep: 2, energy: 2, soreness: 2 },
    { id: 'ck2', date: '2026-09-22', timing: 'pre', sessionId: 's6_d2', sleep: 1, energy: 2, soreness: 2 },
    { id: 'ck3', date: '2026-09-23', timing: 'post', sessionId: 's6_d3', sleep: 2, energy: 1, soreness: 3 },
  ].map((c) => ({ ...c, createdAt: madrid(c.date, 17) }));
  return { sessions, checkins };
}

async function seed(page) {
  const base = await page.evaluate(() => ({
    templates: window.__app.store.all('templates').map((t) => ({ id: t.id, name: t.name, items: t.items })),
    exercises: window.__app.store.all('exercises').map((e) => ({ id: e.id, name: e.name, logType: e.logType })),
  }));
  const s = buildSeed(base.templates, base.exercises);
  await page.evaluate(async ({ sessions, checkins, createdAt }) => {
    const { store } = window.__app;
    const meta = store.get('meta', 'app');
    meta.createdAt = createdAt;
    await store.save('meta', meta);
    await Promise.all([...sessions.map((x) => store.save('sessions', x)), ...checkins.map((x) => store.save('checkins', x))]);
  }, { ...s, createdAt: madrid(START, 9) });
  return s;
}

const loadOf = (s) => Math.round(s.durationMin * s.rpe);
function loadOfWeek(sessions, ws) {
  return sessions.filter((x) => weekStart(x.date) === ws).reduce((t, x) => t + loadOf(x), 0);
}

/** Estado de cada tarjeta de mensaje (en orden de pantalla). */
const cards = (page) => page.locator('.wk-msg').evaluateAll((els) => els.map((el) => ({
  id: el.dataset.id, level: el.dataset.level, section: el.dataset.section,
  block: el.closest('.wk-block')?.dataset.section,
  badge: el.querySelector('.wk-level')?.textContent.trim(),
  title: el.querySelector('.wk-msg-title')?.textContent,
  text: el.querySelector('.wk-msg-text')?.textContent,
  why: !!el.querySelector('.why-btn'),
})));

/** Abre el «¿Por qué?» de un mensaje y devuelve { rule, rows:[{label, value}] }. */
async function openWhy(page, id) {
  const card = page.locator(`.wk-msg[data-id="${id}"]`);
  const btn = card.locator('.why-btn');
  await btn.scrollIntoViewIfNeeded();
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  const body = card.locator('.why-body');
  assert.ok(await body.isVisible(), `${id}: «¿Por qué?» abierto`);
  assert.strictEqual(await btn.getAttribute('aria-expanded'), 'true');
  return body.evaluate((b) => ({
    rule: b.querySelector('.wk-why-rule').textContent,
    rows: [...b.querySelectorAll('.wk-why-row')].map((r) => ({ label: r.querySelector('.wk-why-label').textContent, value: r.querySelector('.wk-why-value').textContent, sub: r.classList.contains('wk-why-sub') })),
  }));
}

// ===========================================================================
// Pruebas
// ===========================================================================

test('#/weekly (semana en curso): Información y después Sugerencias; cada mensaje abre su «¿Por qué?» con datos concretos', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const s = await seed(page);
    await open(page, '#/weekly');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 21–27 sep');
    assert.match(await page.locator('.topbar-sub').innerText(), /En curso · quedan 4 días \(hoy incluido\)/);
    assert.strictEqual(await page.locator('.back-btn').count(), 1, 'botón atrás');
    assert.ok(await page.locator('[data-nav="next"]').isDisabled(), 'no se puede ir a semanas futuras');
    assert.ok(await page.locator('[data-nav="current"]').isDisabled(), '«Esta semana» ya está seleccionada');
    await shot(page, 'weekly-390-top');

    // Bloques visibles y en orden: INFORMACIÓN antes que SUGERENCIAS
    const blocks = await page.locator('.wk-block').evaluateAll((els) => els.map((e) => ({ s: e.dataset.section, t: e.querySelector('.wk-block-title').textContent, y: e.getBoundingClientRect().top })));
    assert.deepStrictEqual(blocks.map((b) => b.s), ['info', 'suggestion']);
    assert.deepStrictEqual(blocks.map((b) => b.t), ['Información', 'Sugerencias']);
    assert.ok(blocks[0].y < blocks[1].y);

    const list = await cards(page);
    const ids = list.map((c) => c.id);
    const info = list.filter((c) => c.block === 'info');
    const sugg = list.filter((c) => c.block === 'suggestion');
    assert.ok(info.every((c) => c.section === 'info') && sugg.every((c) => c.section === 'suggestion'), 'cada mensaje en su bloque');
    assert.deepStrictEqual(info.map((c) => c.id).slice(0, 5), ['muscles', 'muscles-below', 'push-pull', 'load', 'km'], `orden de la información: ${ids}`);
    for (const id of ['ex-progress', 'ex-maintain', 'ex-stalled']) assert.ok(ids.includes(id), `${id} en la información`);
    for (const id of ['dp-up-press_banca', 'dp-up-dominadas', 'dp-up-curl_supinador', 'dp-up-bulgara', 'dp-hold', 'deload']) assert.ok(ids.includes(id), `${id} en las sugerencias (${ids})`);
    // Orden de las sugerencias: doble progresión → avisos de carga → descarga
    const sIdx = (id) => sugg.findIndex((c) => c.id === id);
    assert.ok(sIdx('dp-hold') < sIdx('load-ok') && sIdx('load-ok') < sIdx('deload'), `orden de las sugerencias: ${sugg.map((c) => c.id)}`);
    // Todos con «¿Por qué?» y nivel con texto (no solo color)
    for (const c of list) {
      assert.ok(c.why, `${c.id}: botón «¿Por qué?»`);
      assert.ok(c.badge && c.badge.length > 2, `${c.id}: etiqueta de nivel con texto`);
      assert.ok(['neutral', 'good', 'warn'].includes(c.level));
    }

    // Semana en curso: prudente, sin dar por malo lo que aún se puede completar
    const below = list.find((c) => c.id === 'muscles-below');
    assert.strictEqual(below.level, 'neutral');
    assert.match(below.title, /aún por debajo del mínimo/);
    assert.match(await page.locator('.wk-msg[data-id="muscles"] .wk-msg-text').innerText(), /a falta de 4 días/);
    assert.strictEqual(await page.locator('.wk-mrow').count(), 16, 'tabla de músculos');
    assert.match(await page.locator('.wk-mrow[data-muscle="back"]').innerText(), /Espalda[\s\S]*14–22/);
    await scrollShots(page, 'weekly-390'); // vista general (con los «¿Por qué?» cerrados)

    // Doble progresión: press banca al tope → «sube 2,5 kg», de 85 a 87,5 kg, con las series concretas en el porqué
    const up = list.find((c) => c.id === 'dp-up-press_banca');
    assert.strictEqual(up.title, 'Press banca: sube 2,5 kg');
    assert.match(up.text, /de 85 a 87,5 kg/);
    const whyUp = await openWhy(page, 'dp-up-press_banca');
    assert.match(whyUp.rule, /RIR ≥ 1/);
    assert.match(whyUp.rule, /2,5 kg en compuestos de tren superior, 5 kg en compuestos de tren inferior y 1–2 kg en aislamiento/);
    assert.strictEqual(whyUp.rows.filter((r) => /^Serie \d/.test(r.label)).length, 3, 'las 3 series efectivas (sin el calentamiento)');
    assert.ok(whyUp.rows.some((r) => r.value.startsWith('85 kg × 6 @2')), JSON.stringify(whyUp.rows));
    assert.ok(whyUp.rows.some((r) => r.label === 'Objetivo' && /3×4–6 \(tope 6 reps\)/.test(r.value)));
    await shot(page, 'weekly-390-why-dp');
    assert.match(list.find((c) => c.id === 'dp-up-curl_supinador').title, /sube 1–2 kg/);
    assert.match(list.find((c) => c.id === 'dp-up-bulgara').title, /sube 5 kg por lado/);
    assert.match(list.find((c) => c.id === 'dp-up-dominadas').title, /añade 2,5 kg de lastre/);

    // Mantener: un único mensaje agrupado con la lista
    assert.strictEqual(list.filter((c) => c.title === 'Mantén el peso y busca más repeticiones').length, 1);
    assert.ok(await page.locator('.wk-msg[data-id="dp-hold"] .wk-item').count() > 3);
    const whyHold = await openWhy(page, 'dp-hold');
    assert.ok(whyHold.rows.some((r) => /^Remo con pecho apoyado · 3×8–10/.test(r.label)), 'ejercicio con su rango');
    assert.ok(whyHold.rows.some((r) => r.value.startsWith('60 kg × 9 @1 · falta 1 rep')), 'serie concreta con lo que falta');

    // Estancados (remo con pecho apoyado, jalón y sentadilla): cifras de 1RM por sesión
    const whyStall = await openWhy(page, 'ex-stalled');
    for (const name of ['Remo con pecho apoyado', 'Jalón al pecho', 'Sentadilla']) assert.ok(whyStall.rows.some((r) => r.label === name && !r.sub), `${name} estancado`);
    assert.ok(whyStall.rows.some((r) => r.sub && /^82 kg · 60 kg × 10 @1$/.test(r.value)), '1RM estimado por sesión del remo');

    // Descarga: 3 estancados + RPE medio alto + check-ins bajos (2 de 3)
    const whyDeload = await openWhy(page, 'deload');
    assert.ok(whyDeload.rows.some((r) => /^\(a\)/.test(r.label) && /3 \(mínimo 3\) · se cumple/.test(r.value)), JSON.stringify(whyDeload.rows));
    assert.ok(whyDeload.rows.some((r) => /^\(b\)/.test(r.label) && /se cumple/.test(r.value)));
    assert.ok(whyDeload.rows.some((r) => /^\(c\)/.test(r.label) && /2 de 3 bajos/.test(r.value)));
    assert.ok(whyDeload.rows.some((r) => r.sub && /sueño bajo/.test(r.value)), 'detalle de los check-ins');

    // Todos los demás mensajes también abren su porqué con datos
    for (const c of list) {
      if (['dp-up-press_banca', 'dp-hold', 'ex-stalled', 'deload'].includes(c.id)) continue;
      const w = await openWhy(page, c.id);
      assert.ok(w.rule.length > 40, `${c.id}: regla`);
      assert.ok(w.rows.length > 0 && w.rows.every((r) => r.label && r.value), `${c.id}: datos`);
      assert.ok(w.rows.some((r) => /\d/.test(r.value)), `${c.id}: cifras concretas`);
    }
    // Carga: la semana en curso frente a la media de las 4 previas, con las cifras de cada semana
    const whyLoad = await openWhy(page, 'load');
    assert.ok(whyLoad.rows.some((r) => r.label === 'Esta semana' && r.value.startsWith(nf0(loadOfWeek(s.sessions, '2026-09-21')))), JSON.stringify(whyLoad.rows.slice(0, 3)));
    assert.ok(whyLoad.rows.some((r) => r.label === 'Semana 14–20 sep' && r.value === nf0(loadOfWeek(s.sessions, '2026-09-14'))));

    assert.ok(await noHScroll(page), 'sin desbordamiento horizontal');
    await page.locator('.wk-msg[data-id="deload"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -70));
    await shot(page, 'weekly-390-why-deload');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('#/weekly: navegación de semanas (‹ › y «Esta semana») y semana terminada con avisos de carga y km', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const s = await seed(page);
    await open(page, '#/progress'); // se entra desde Progreso
    await open(page, '#/weekly');
    await clickAndWait(page, page.locator('[data-nav="prev"]'));
    assert.match(page.url(), /#\/weekly\?week=2026-09-14$/);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 14–20 sep');
    assert.strictEqual(await page.locator('.topbar-sub').innerText(), 'Semana terminada');
    assert.ok(!(await page.locator('[data-nav="next"]').isDisabled()));
    assert.strictEqual(await page.locator('[data-nav="current"]').innerText(), 'Ir a esta semana');
    assert.strictEqual(await page.locator('.wk-provisional').count(), 0);

    const list = await cards(page);
    const byId = Object.fromEntries(list.map((c) => [c.id, c]));
    // Aviso de carga (ruta larga en bici): alto (> 30 %), redactado como orientativo, nunca predicción
    const cur = loadOfWeek(s.sessions, '2026-09-14');
    const prev = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'].map((w) => loadOfWeek(s.sessions, w));
    const mean = prev.reduce((a, b) => a + b, 0) / 4;
    const pct = ((cur - mean) / mean) * 100;
    assert.ok(pct > 30, `subida de carga sembrada: ${pct}`);
    assert.strictEqual(byId['load-warn'].level, 'warn');
    assert.strictEqual(byId['load-warn'].badge, 'Aviso');
    assert.match(byId['load-warn'].text, new RegExp(`supera en un ${nf0(pct)} %`));
    assert.match(byId['load-warn'].text, /Aviso orientativo/);
    const whyLoad = await openWhy(page, 'load-warn');
    assert.match(whyLoad.rule, /no una predicción de lesión/);
    assert.ok(whyLoad.rows.some((r) => r.label === 'Esta semana' && r.value === nf0(cur)));
    assert.ok(whyLoad.rows.some((r) => /Media de las 4 semanas previas/.test(r.label) && r.value === nf0(mean)));
    // Km de carrera: 22 frente a 18 (+22 %) → aviso (umbral alto 15 %), la semana anterior ≥ 5 km
    assert.strictEqual(byId['runkm-warn'].level, 'warn');
    assert.match(byId['runkm-warn'].title, /km de carrera \+22 %/);
    const whyKm = await openWhy(page, 'runkm-warn');
    assert.ok(whyKm.rows.some((r) => r.label === 'Semana anterior' && r.value === '18 km'));
    // Descarga: el esfuerzo alto tiene que sostenerse CADA semana del periodo; la del 7–13 sep se queda en 7,6
    // (< 8) aunque la del 14–20 llegue a 8,2 → mensaje neutral con el estado de cada condición y la media por semana
    assert.strictEqual(byId['deload-none'].level, 'neutral');
    const whyDl = await openWhy(page, 'deload-none');
    assert.ok(whyDl.rows.some((r) => /^\(b\)/.test(r.label) && /no se cumple: semana 7–13 sep con RPE medio 7,6 \(umbral 8\)/.test(r.value)), JSON.stringify(whyDl.rows.filter((r) => !r.sub)));
    assert.ok(whyDl.rows.some((r) => r.sub && r.label === 'Semana 7–13 sep' && r.value === 'RPE medio 7,6 en 5 sesiones'));
    assert.ok(whyDl.rows.some((r) => r.sub && r.label === 'Semana 14–20 sep' && r.value === 'RPE medio 8,2 en 5 sesiones'));
    assert.ok(whyDl.rows.some((r) => /^\(c\)/.test(r.label) && /sin check-ins/.test(r.value)));
    // Semana terminada: lo que no llegó al mínimo ya es «por debajo» (warn)
    if (byId['muscles-below']) assert.strictEqual(byId['muscles-below'].level, 'warn');
    await shot(page, 'weekly-390-prev-week');
    assert.ok(await noHScroll(page));

    // › vuelve a la semana en curso; dos atrás y «Ir a esta semana»
    await clickAndWait(page, page.locator('[data-nav="next"]'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 21–27 sep');
    await clickAndWait(page, page.locator('[data-nav="prev"]'));
    await clickAndWait(page, page.locator('[data-nav="prev"]'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 7–13 sep');
    await clickAndWait(page, page.locator('[data-nav="current"]'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 21–27 sep');
    // Atrás → Progreso (la navegación de semanas no apila historial)
    await clickAndWait(page, page.locator('.back-btn'));
    assert.match(page.url(), /#\/progress$/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('#/weekly a 375×667 y tarjeta resumen weeklySummaryCard() (2–3 mensajes clave + «Ver panel semanal»)', async () => {
  const app = await launch({ width: 375, height: 667 });
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/weekly');
    assert.ok(await noHScroll(page), 'sin desbordamiento horizontal a 375 px');
    // Todos los «¿Por qué?» abiertos a la vez tampoco desbordan
    const n = await page.locator('.wk-msg .why-btn').count();
    for (let i = 0; i < n; i++) await page.locator('.wk-msg .why-btn').nth(i).click();
    assert.ok(await noHScroll(page), 'sin desbordamiento con los porqués abiertos');
    // Objetivos táctiles ≥ 44 px
    const small = await page.locator('.wk-nav button, .why-btn, .wk-settings-link').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length);
    assert.strictEqual(small, 0, 'botones de al menos 44 px');
    // Los «¿Por qué?» abiertos: cada lista de datos igual de principio a fin, sin valores partidos a media frase
    assert.deepStrictEqual(await whyLayoutIssues(page, '.wk'), []);
    // Nada recortado con «…»: nombres de músculo, textos y el subtítulo del enlace a Ajustes
    assert.deepStrictEqual(await clipped(page, '.wk-mrow-name, .wk-msg-title, .wk-msg-text, .wk-settings-link .list-item-sub'), []);
    // En curso, la columna «ant. N» cambia de ancho según la cifra: las barras miden igual en todas las filas
    assert.strictEqual(new Set(await barWidths(page)).size, 1, `barras de distinta longitud: ${await barWidths(page)}`);
    await scrollShots(page, 'weekly-375');
    for (let i = 0; i < n; i++) await page.locator('.wk-msg .why-btn').nth(i).click();

    // Semana terminada a 375 px (estados «Por debajo»/«Por encima» y cifras con decimales): nombres enteros y
    // barras de la misma longitud en todas las filas (el mismo rango cae en el mismo sitio)
    await open(page, '#/weekly?week=2026-09-14');
    assert.deepStrictEqual(await clipped(page, '.wk-mrow-name, .wk-mstatus, .wk-mrow-delta'), []);
    const bars = await barWidths(page);
    assert.strictEqual(bars.length, 16);
    assert.strictEqual(new Set(bars).size, 1, `barras de distinta longitud: ${bars}`);
    const band = (m) => page.locator(`.wk-mrow[data-muscle="${m}"] .wk-mbar-band`).evaluate((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; });
    assert.deepStrictEqual(await band('hamstrings'), await band('calves'), 'Isquiotibiales y Gemelos (10–20) en el mismo sitio');
    await page.locator('.wk-msg[data-id="muscles"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -70));
    await shot(page, 'weekly-375-prev-muscles');
    // Mapa corporal encima de la tabla (ronda 4): semana terminada → estados normales; tocar una zona da el detalle
    const map = page.locator('.wk-msg[data-id="muscles"] .wk-muscles > .bm');
    assert.strictEqual(await map.count(), 1);
    assert.strictEqual(await map.evaluate((el) => el.classList.contains('bm-in-progress')), false);
    assert.strictEqual(await map.locator('.bm-zone').count(), 16);
    await map.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -70));
    await map.locator('.bm-zone[data-muscle="chest"] .bm-shape').first().click();
    assert.match(await map.locator('.bm-detail').innerText(), /^Pecho · /);
    await shot(page, 'weekly-375-prev-bodymap');
    for (const id of ['dp-hold', 'ex-stalled', 'deload-none']) await openWhy(page, id);
    assert.deepStrictEqual(await whyLayoutIssues(page, '.wk'), []);
    assert.ok(await noHScroll(page));

    // Tarjeta resumen: Hoy la pinta en su hueco (.today-extra) al terminar de cargar lo principal
    await open(page, '#/today');
    await page.waitForFunction(() => document.querySelector('.today-extra')?.dataset.ready === '1', null, { timeout: 5000 });
    await page.locator('.today-extra .wk-summary').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -70));
    await page.waitForTimeout(150);
    const card = page.locator('.wk-summary');
    assert.strictEqual(await card.count(), 1);
    const items = await card.locator('.wk-summary-item').count();
    assert.ok(items >= 2 && items <= 3, `2–3 mensajes clave (${items})`);
    assert.match(await card.locator('.wk-summary-sub').innerText(), /21–27 sep · quedan 4 días/);
    assert.ok(await card.locator('.wk-summary-item .wk-level').first().innerText());
    // Información primero y después sugerencias, cada grupo con su rótulo (como en #/weekly)
    const groups = await card.locator('.wk-summary-group').evaluateAll((els) => els.map((g) => ({
      sec: g.dataset.section, head: g.querySelector('.wk-summary-ghead').textContent,
      ids: [...g.querySelectorAll('.wk-summary-item')].map((li) => li.dataset.section),
    })));
    assert.ok(groups.length >= 1 && groups.length <= 2);
    assert.deepStrictEqual(groups.map((g) => g.sec), ['info', 'suggestion'].filter((x) => groups.some((g) => g.sec === x)), 'información antes que sugerencias');
    for (const g of groups) {
      assert.strictEqual(g.head, g.sec === 'info' ? 'Información' : 'Sugerencias');
      assert.ok(g.ids.every((x) => x === g.sec), `cada mensaje en su grupo: ${JSON.stringify(g)}`);
    }
    // Cada mensaje con su texto completo (sin recortar) y su «¿Por qué?» con la regla y datos concretos
    assert.deepStrictEqual(await clipped(page, '.wk-summary-mtext, .wk-summary-mtitle'), []);
    assert.strictEqual(await card.locator('.wk-summary-item .why-btn').count(), items, 'un «¿Por qué?» por mensaje');
    await shot(page, 'weekly-375-summary-card');
    for (let i = 0; i < items; i++) {
      const it = card.locator('.wk-summary-item').nth(i);
      await it.locator('.why-btn').click();
      assert.ok(await it.locator('.why-body').isVisible(), 'porqué abierto');
      assert.ok((await it.locator('.wk-why-rule').innerText()).length > 40, 'regla');
      const vals = await it.locator('.wk-why-value').allInnerTexts();
      assert.ok(vals.length > 0 && vals.some((v) => /\d/.test(v)), `datos con cifras: ${vals}`);
    }
    assert.deepStrictEqual(await whyLayoutIssues(page, '.wk-summary'), []);
    // La descarga (si está entre los clave) enseña sus cifras en el texto, no solo en el porqué
    const dl = card.locator('.wk-summary-item[data-id="deload"] .wk-summary-mtext');
    if (await dl.count()) assert.match(await dl.innerText(), /check-ins bajos \(2 de 3\)/);
    assert.ok(await noHScroll(page));
    await card.locator('.wk-summary-item').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -70));
    await shot(page, 'weekly-375-summary-why');
    await clickAndWait(page, card.locator('.wk-summary-btn'));
    assert.match(page.url(), /#\/weekly\?week=2026-09-21$/);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 21–27 sep');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('#/weekly: estados vacíos (sin datos, semana futura y anterior al primer registro)', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await open(page, '#/weekly');
    assert.strictEqual(await page.locator('.wk-empty .empty-title').innerText(), 'Aún no hay datos');
    assert.strictEqual(await page.locator('.wk-block').count(), 0);
    assert.strictEqual(await page.evaluate(async () => (await import('./js/views/weekly.js')).weeklySummaryCard()), null, 'sin datos, sin tarjeta resumen');
    await shot(page, 'weekly-390-empty');
    assert.ok(await noHScroll(page));

    await seed(page);
    await open(page, '#/weekly?week=2026-10-05');
    assert.strictEqual(await page.locator('.wk-empty .empty-title').innerText(), 'Semana futura');
    await clickAndWait(page, page.locator('.wk-empty .btn'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 21–27 sep');

    await open(page, '#/weekly?week=2026-07-01');
    assert.strictEqual(await page.locator('.wk-empty .empty-title').innerText(), 'Sin registros hasta esta semana');
    assert.match(await page.locator('.wk-empty .empty-text').innerText(), /10 ago 2026/);
    await clickAndWait(page, page.locator('.wk-empty .btn'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 10–16 ago');
    // Primera semana: sin semanas previas → «sin referencia suficiente» en la carga
    assert.match(await page.locator('.wk-msg[data-id="load"] .wk-msg-text').innerText(), /Sin referencia suficiente/);
    await shot(page, 'weekly-390-first-week');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
