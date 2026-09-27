// E2E de «tu analista» (ronda 5, docs/MEJORAS5.md §3c): #/analysis (Resumen, Peso con minigráfica y rango, Fuerza,
// Resistencia, Recuperación, Ciclo en modo mujer, Próximas semanas), cada Insight con «¿Por qué?» y «Fuentes»,
// «Copiar informe para tu IA» (portapapeles simulado, alternativa con texto seleccionable, «Incluir mi ciclo»),
// «Crear objetivo» desde la recomendación del peso, tarjeta «Tu análisis» en Hoy y en el panel semanal, acceso
// «Análisis» en Progreso, estado vacío, textos en femenino, sin errores de consola ni scroll horizontal a 375 px.
// Siembra ~16 semanas (fuerza, carreras, pesajes, check-ins y, en modo mujer, reglas) con la fecha fijada (jueves
// 24 sep 2026). Capturas en test-results/analysis-*.png (390×844).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/analysis.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { waitReady, go, idbAll } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');
const TODAY = '2026-09-24'; // jueves
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}
const ago = (n) => addDays(TODAY, -n);

async function launch({ width = 390, height = 844 } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await chromium.launch();
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
async function open(page, hash) {
  await markStale(page);
  await go(page, hash);
  await waitFresh(page);
}
async function clickAndWait(page, locator) {
  await markStale(page);
  await locator.click();
  await waitFresh(page);
}
const hashOf = (page) => page.evaluate(() => location.hash);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function shot(page, name) {
  fs.mkdirSync(RESULTS, { recursive: true });
  await page.screenshot({ path: path.join(RESULTS, `${name}.png`), fullPage: false });
}
/** Captura con un elemento arriba de la pantalla (bajo la cabecera). */
async function shotAt(page, selector, name, offset = 64) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate((o) => window.scrollBy(0, -o), offset);
  await page.waitForTimeout(150);
  await shot(page, name);
  await page.evaluate(() => window.scrollTo(0, 0));
}
/** Botones visibles de menos de 44 px de alto dentro de `sel`. */
const smallButtons = (page, sel) => page.locator(`${sel} button`).evaluateAll((els) => els
  .filter((e) => e.offsetParent !== null && !e.closest('[hidden]'))
  .map((e) => ({ t: e.textContent.trim().slice(0, 30), h: e.getBoundingClientRect().height }))
  .filter((r) => r.h < 43.5));

// ---------------------------------------------------------------------------
// Datos sembrados
// ---------------------------------------------------------------------------
let seq = 0;
const wFor = (e1rm, reps = 5, rir = 1) => Math.round((e1rm / (1 + (reps + rir) / 30)) * 4) / 4;
function strength(date, items) {
  const id = `sx${++seq}`;
  const at = madrid(date, 18);
  return {
    id, kind: 'strength', date, planDate: date, templateId: null, templateName: 'Fuerza', status: 'done',
    startedAt: at, endedAt: at + 60 * 60000, durationMin: 60, rpe: 7, notes: '', parentId: null, cursor: 0, createdAt: at, updatedAt: at,
    exercises: items.map(([exerciseId, name, e1rm], i) => ({
      id: `${id}_se${i}`, exerciseId, exName: name, notes: '', section: '', groupId: null, groupType: null,
      target: { sets: 3, repMin: 5, repMax: 5 },
      sets: [0, 1, 2].map((j) => ({
        id: `${id}_s${i}_${j}`, type: 'effective', weight: wFor(e1rm), reps: 5, repsR: null, rir: 1, timeSec: null, distanceM: null,
        heightCm: null, note: '', done: true, doneAt: at + (i * 5 + j) * 60000,
      })),
    })),
  };
}
function run(date, { min = 40, km = 7, rpe = 4, subtype = 'z2' } = {}) {
  const at = madrid(date, 8);
  return {
    id: `rx${++seq}`, kind: 'run', date, planDate: date, templateId: null, templateName: null, status: 'done', startedAt: at, endedAt: null,
    movingSec: min * 60, elapsedSec: min * 60, durationMin: min, rpe, distanceKm: km, subtype, notes: '', parentId: null, createdAt: at, updatedAt: at,
  };
}

/** Hombre: press y sentadilla suben, el rumano se estanca; carreras cada 3 días; peso subiendo ~0,3 kg/sem. */
function maleSeed() {
  const sessions = [];
  const checkins = [];
  for (let i = 0; i < 20; i++) {
    const date = ago(2 + 4 * (19 - i));
    const w = (4 * i) / 7;
    const s = strength(date, [
      ['press_banca', 'Press banca', 90 * (1 + 0.008 * w)],
      ['sentadilla', 'Sentadilla', 120 * (1 + 0.005 * w)],
      ['peso_muerto_rumano', 'Peso muerto rumano', 110],
    ]);
    sessions.push(s);
    checkins.push({ id: `ck${i}`, date, timing: 'pre', sessionId: s.id, sleep: i % 4 ? 2 : 1, energy: 2, soreness: 2, createdAt: madrid(date, 17), updatedAt: madrid(date, 17) });
  }
  for (let i = 0; i < 26; i++) sessions.push(run(ago(1 + 3 * i), i % 4 ? {} : { rpe: 8, subtype: 'intervals', min: 35 }));
  const bodyweight = [];
  for (let i = 0; i < 56; i++) {
    const id = ago(56 - i);
    bodyweight.push({ id, kg: Math.round((77 + 0.042 * i + (i % 3 ? 0.25 : -0.3)) * 10) / 10, createdAt: madrid(id, 8), updatedAt: madrid(id, 8) });
  }
  return { sessions, checkins, bodyweight, cycle: [], profile: { sex: 'male', goal: 'gain', experience: 'intermediate' } };
}

/** Mujer: hip thrust, sentadilla y press; reglas cada 29 días (la última hace 11 días → hoy, día 12). */
function femaleSeed() {
  const sessions = [];
  const checkins = [];
  for (let i = 0; i < 34; i++) {
    const date = ago(1 + 3 * (33 - i));
    const w = (3 * i) / 7;
    const s = strength(date, [
      ['hip_thrust', 'Hip thrust', 80 * (1 + 0.006 * w)],
      ['sentadilla', 'Sentadilla', 60 * (1 + 0.005 * w)],
      ['press_banca', 'Press banca', i > 20 ? 41 : 40 * (1 + 0.004 * w)],
    ]);
    sessions.push(s);
    checkins.push({ id: `ck${i}`, date, timing: 'pre', sessionId: s.id, sleep: 2, energy: i % 4 ? 2 : 1, soreness: 2, createdAt: madrid(date, 17), updatedAt: madrid(date, 17) });
  }
  const starts = [ago(11), ago(40), ago(69), ago(98)];
  const cycle = [];
  for (const st of starts) {
    for (let k = 0; k < 5; k++) cycle.push({ id: addDays(st, k), flow: k < 2 ? 'medium' : 'light', symptoms: k === 0 ? ['cramps'] : [], notes: '', createdAt: 1, updatedAt: 1 });
  }
  const bodyweight = [];
  for (let i = 0; i < 60; i++) {
    const id = ago(60 - i);
    const pre = starts.some((st) => { const d = (Date.parse(st) - Date.parse(id)) / 864e5; return d >= 0 && d <= 5; });
    bodyweight.push({ id, kg: Math.round((61 + 0.02 * i + (pre ? 0.9 : 0) + (i % 2 ? 0.2 : -0.2)) * 10) / 10, createdAt: madrid(id, 8), updatedAt: madrid(id, 8) });
  }
  return {
    sessions, checkins, bodyweight, cycle,
    profile: { sex: 'female', goal: 'gain', experience: 'intermediate', cycleTracking: true, contraception: 'none', cycleInReport: false },
  };
}

async function seed(page, s) {
  await page.evaluate(async ({ sessions, checkins, bodyweight, cycle, profile, createdAt }) => {
    const { store } = window.__app;
    const meta = store.get('meta', 'app');
    meta.createdAt = createdAt;
    await store.save('meta', meta);
    const st = store.settings();
    st.profile = { ...st.profile, ...profile };
    await store.save('meta', st);
    await Promise.all([
      ...sessions.map((x) => store.save('sessions', x)),
      ...checkins.map((x) => store.save('checkins', x)),
      ...bodyweight.map((x) => store.save('bodyweight', x)),
      ...cycle.map((x) => store.save('cycle', x)),
    ]);
  }, { ...s, createdAt: madrid(ago(140), 9) });
}

/** Sustituye el portapapeles: guarda lo copiado en window.__copied (o falla si fail) y quita navigator.share. */
async function stubClipboard(page, { fail = false } = {}) {
  await page.evaluate((f) => {
    window.__copied = null;
    const clip = { writeText: (t) => (f ? Promise.reject(new DOMException('no', 'NotAllowedError')) : ((window.__copied = t), Promise.resolve())) };
    Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  }, fail);
}

// ===========================================================================

test('Hombre (390×844): Hoy y panel con «Tu análisis», #/analysis completo, «¿Por qué?», fuentes, informe y objetivo', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page, maleSeed());

    // Hoy: «Te toca hoy» y «Empezar» siguen arriba; perfil completo → sin invitación; sin ciclo; «Tu análisis» al final
    await open(page, '#/today');
    assert.strictEqual(await page.locator('.today-profile').count(), 0);
    assert.strictEqual(await page.locator('.cyc-today, .today-cycle-slot').count(), 0);
    const sum = page.locator('.today-extra .an-sum');
    assert.strictEqual(await sum.count(), 1);
    assert.strictEqual(await page.evaluate(() => document.querySelector('.today-extra').lastElementChild.classList.contains('an-sum')), true, 'la última del hueco');
    const n = await sum.locator('.an-sum-item').count();
    assert.ok(n >= 2 && n <= 3, `2–3 puntos (${n})`);
    const areas = await sum.locator('.an-sum-item').evaluateAll((els) => els.map((e) => e.dataset.area));
    assert.strictEqual(new Set(areas).size, areas.length, `áreas distintas: ${areas}`);
    await shotAt(page, '.today-extra .an-sum', 'analysis-today-male');

    // Panel semanal: bloque compacto tras el resumen de la semana
    await open(page, '#/weekly');
    const order = await page.evaluate(() => {
      const y = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? null;
      return [y('.wk-recap'), y('.wk-analysis'), y('.wk-block-info')];
    });
    assert.ok(order.every((v) => v != null) && order[0] < order[1] && order[1] < order[2], `resumen → análisis → información: ${order}`);
    assert.ok((await page.locator('.wk-analysis .an-sum-item').count()) >= 2);
    // En una semana pasada no se enseña (es el análisis de ahora)
    await page.locator('.wk-nav [data-nav="prev"]').click();
    await page.waitForTimeout(400);
    assert.strictEqual(await page.locator('.wk-analysis').count(), 0);

    // Progreso: acceso «Análisis» arriba, etiquetas enteras
    await open(page, '#/progress');
    await clickAndWait(page, page.locator('.prg-links [data-link="analysis"]'));
    assert.strictEqual(await hashOf(page), '#/analysis');

    // #/analysis
    assert.match(await page.locator('.an-note').innerText(), /Estimaciones orientativas basadas en estudios; no sustituyen a un profesional/);
    const cards = await page.locator('.an-card').evaluateAll((els) => els.map((e) => e.dataset.area));
    assert.deepStrictEqual(cards, ['summary', 'weight', 'strength', 'endurance', 'recovery', 'forecast', 'report']);
    const keys = page.locator('.an-card-summary .an-key');
    assert.strictEqual(await keys.count(), 3);
    assert.ok(await noHScroll(page));
    await shot(page, 'analysis-top-male');

    // Peso: KPIs, minigráfica, barra del rango, proteína y objetivo propuesto
    const w = page.locator('.an-card-weight');
    assert.match(await w.locator('.an-pace').innerText(), /Buen ritmo/);
    assert.match(await w.locator('[data-kpi="trend"] .kpi-value').innerText(), /^\d+(,\d)?\skg$/);
    assert.match(await w.locator('[data-kpi="rate"] .kpi-value').innerText(), /^\+0,\d+\skg$/);
    assert.strictEqual(await w.locator('.an-chart svg').count() >= 1, true, 'minigráfica');
    assert.strictEqual(await w.locator('.an-gauge .an-gauge-band').count(), 1);
    assert.match(await w.locator('.an-gauge-legend').innerText(), /subir 0,25–0,5 % por semana/);
    assert.match(await w.locator('[data-kpi="protein"] .kpi-value').innerText(), /^\d+–\d+\sg$/);
    await shotAt(page, '.an-card-weight', 'analysis-weight-male');

    // Un Insight: nivel, título, texto, «¿Por qué?» (regla + datos) y «Fuentes» (short · detail), plegados
    const rate = w.locator('.an-ins[data-insight="weight-rate"]');
    assert.strictEqual(await rate.locator('.an-level').count(), 1);
    assert.ok(await rate.locator('.an-fold-body[data-fold="why"]').isHidden());
    await rate.locator('.an-fold-btn[data-fold="why"]').click();
    const why = rate.locator('.an-fold-body[data-fold="why"]');
    assert.ok(await why.isVisible());
    assert.match(await why.innerText(), /Regla\.[\s\S]*Theil–Sen[\s\S]*Datos/i);
    assert.ok((await why.locator('.wk-why-row').count()) >= 3);
    await rate.locator('.an-fold-btn[data-fold="sources"]').click();
    assert.match(await rate.locator('.an-fold-body[data-fold="sources"]').innerText(), /Iraki et al\., 2019 · Sports/);
    await shotAt(page, '.an-ins[data-insight="weight-rate"]', 'analysis-why-male', 90);

    // Resumen → toca un punto y baja a su detalle
    const firstKey = await keys.first().getAttribute('data-insight');
    await keys.first().locator('button').click();
    await page.waitForTimeout(700);
    const inView = await page.evaluate((id) => {
      const el = [...document.querySelectorAll('.an-card:not(.an-card-summary) [data-insight]')].find((x) => x.dataset.insight === id);
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight;
    }, firstKey);
    assert.ok(inView, `detalle de ${firstKey} a la vista`);

    // Fuerza: lista con estado y ritmo; el estancado con «qué probar»
    const s = page.locator('.an-card-strength');
    assert.match(await s.locator('.an-ex[data-exercise="peso_muerto_rumano"]').innerText(), /Estancado/);
    assert.match(await s.locator('.an-ex[data-exercise="press_banca"]').innerText(), /\+0,\d+ %\/sem/);
    assert.ok(await s.locator('.an-ins[data-insight="strength-stalled-peso_muerto_rumano"]').count());
    assert.match(await s.innerText(), /Si te notas cansado/);
    // Previsiones
    assert.ok(await page.locator('.an-card-forecast .an-ins[data-insight="forecast-weight"]').count());
    // Todas las cajas de fuentes con «short · detail»
    const src = await page.locator('.an-source').evaluateAll((els) => els.map((e) => e.textContent));
    assert.ok(src.length > 0 && src.every((t) => / · /.test(t)), 'fuentes con detalle');

    // Botones ≥ 44 px
    assert.deepStrictEqual(await smallButtons(page, '.an'), []);

    // Copiar informe (portapapeles simulado)
    await stubClipboard(page);
    await page.locator('.an-copy').click();
    await page.waitForFunction(() => !!window.__copied);
    const txt = await page.evaluate(() => window.__copied);
    assert.match(txt, /^INFORME DE ENTRENAMIENTO · Entreno · 24 sep 2026/);
    for (const k of ['PERFIL', 'PESO CORPORAL', 'FUERZA', 'RESISTENCIA', 'RECUPERACIÓN', 'PRÓXIMAS SEMANAS', 'PREGUNTA']) assert.ok(txt.includes(k), k);
    assert.ok(!/CICLO/.test(txt));
    await page.locator('.toast', { hasText: 'Informe copiado' }).waitFor();
    // El icono de la cabecera también copia
    await page.evaluate(() => { window.__copied = null; window.scrollTo(0, 0); });
    await page.locator('.topbar-actions button[aria-label="Copiar informe para tu IA"]').click();
    await page.waitForFunction(() => !!window.__copied);
    // Sin portapapeles ni compartir: hoja con el texto seleccionable
    await stubClipboard(page, { fail: true });
    await page.locator('.an-copy').click();
    const area = page.locator('.sheet-panel textarea.an-report-text');
    await area.waitFor({ state: 'visible' });
    assert.match(await area.inputValue(), /^INFORME DE ENTRENAMIENTO/);
    assert.match(await page.locator('.an-report-fail').innerText(), /Mantén pulsado el texto/);
    await shot(page, 'analysis-report-sheet');
    await page.locator('.sheet-panel button[aria-label="Cerrar"]').click();
    await page.waitForTimeout(450);

    // «Crear objetivo» desde la recomendación del peso → formulario prellenado → se crea
    const gbox = page.locator('.an-goal');
    const target = Number(await gbox.getAttribute('data-target'));
    assert.ok(target > 77, `objetivo propuesto ${target}`);
    await clickAndWait(page, gbox.locator('.an-goal-btn'));
    assert.match(await hashOf(page), new RegExp(`^#/goal/new\\?kind=bodyweight&target=${String(target).replace('.', '\\.')}&direction=up$`));
    assert.strictEqual(await page.locator('.seg-btn.active', { hasText: /^Peso$/ }).count(), 1);
    assert.strictEqual(await page.locator('[data-field="targetKg"] input').inputValue(), String(target).replace('.', ','));
    assert.strictEqual(await page.locator('.seg-btn.active', { hasText: 'Subir' }).count(), 1);
    await clickAndWait(page, page.locator('.topbar-actions button[aria-label="Crear objetivo"]'));
    const goals = await idbAll(page, 'goals');
    assert.strictEqual(goals.length, 1);
    assert.strictEqual(goals[0].kind, 'bodyweight');
    assert.strictEqual(goals[0].targetKg, target);
    assert.strictEqual(goals[0].direction, 'up');

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Mujer (390×844): ciclo en Hoy y en #/analysis, textos en femenino, «Incluir mi ciclo» en el informe', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page, femaleSeed());
    await open(page, '#/today');
    // Tarjeta del ciclo justo después de «Te toca hoy»; «Empezar»/«Te toca hoy» sigue arriba
    await page.waitForSelector('.cyc-today');
    const next = await page.evaluate(() => document.querySelector('.today-plan').nextElementSibling?.className || '');
    assert.match(next, /cyc-today/);
    assert.match(await page.locator('.cyc-today').innerText(), /Día 12/);
    assert.strictEqual(await page.locator('.today-extra .an-sum').count(), 1);
    await shot(page, 'analysis-today-female-top');
    await shotAt(page, '.today-extra .an-sum', 'analysis-today-female');

    await open(page, '#/analysis');
    const cards = await page.locator('.an-card').evaluateAll((els) => els.map((e) => e.dataset.area));
    assert.deepStrictEqual(cards, ['summary', 'weight', 'strength', 'endurance', 'recovery', 'cycle', 'forecast', 'report']);
    const cy = page.locator('.an-card-cycle');
    assert.match(await cy.locator('.an-cyc-state').innerText(), /^Día 12 · fase folicular \(estimada\)$/);
    assert.match(await cy.locator('.an-cyc-next').innerText(), /^Próxima regla ~/);
    // Los de recuperación por fase van en «Ciclo», no en «Recuperación»
    assert.strictEqual(await page.locator('.an-card-recovery [data-area="cycle"]').count(), 0);
    assert.ok(await cy.locator('.an-ins[data-insight="cycle-performance"]').count());
    // Femenino: la regla de la fuerza habla de «intermedia»
    await page.locator('.an-card-strength .an-ins[data-insight="strength-summary"] .an-fold-btn[data-fold="why"]').click();
    assert.match(await page.locator('.an-card-strength .an-ins[data-insight="strength-summary"] .an-fold-body[data-fold="why"]').innerText(), /intermedia/);
    assert.match(await page.locator('.an-card-strength .an-ins[data-insight="strength-summary"]').innerText(), /para tu nivel \(intermedia/);
    // Minigráfica con los días de regla
    assert.ok(await page.locator('.an-card-weight .an-chart svg').count());
    assert.ok(await noHScroll(page));
    await shot(page, 'analysis-top-female');
    await shotAt(page, '.an-card-cycle', 'analysis-cycle-female');

    // Informe: «Incluir mi ciclo» refleja profile.cycleInReport (no por defecto)
    await stubClipboard(page);
    const chk = page.locator('.an-report-cycle input');
    assert.strictEqual(await chk.isChecked(), false);
    await page.locator('.an-copy').click();
    await page.waitForFunction(() => !!window.__copied);
    let txt = await page.evaluate(() => window.__copied);
    assert.ok(!/CICLO MENSTRUAL|Anticonceptivo|Día 12/.test(txt), 'sin permiso no sale el ciclo');
    assert.match(txt, /- Sexo: Mujer/);
    assert.match(txt, /Experiencia en fuerza: Intermedia/);
    await page.locator('.an-report-cycle .switch').click();
    assert.strictEqual(await chk.isChecked(), true);
    await page.waitForTimeout(200);
    assert.strictEqual((await idbAll(page, 'meta')).find((m) => m.id === 'settings').profile.cycleInReport, true);
    await page.evaluate(() => { window.__copied = null; });
    await page.locator('.an-copy').click();
    await page.waitForFunction(() => !!window.__copied);
    txt = await page.evaluate(() => window.__copied);
    assert.match(txt, /CICLO MENSTRUAL\n- Anticonceptivo: Ninguno hormonal/);
    assert.match(txt, /- Hoy: Día 12 · fase folicular \(estimada\)/);
    await shotAt(page, '.an-card-report', 'analysis-report-female');

    // La casilla del perfil refleja lo mismo
    await open(page, '#/settings/profile');
    assert.strictEqual(await page.locator('[data-switch="report"] input').isChecked(), true);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('375×667: sin datos → estado vacío útil (y al perfil); con datos, sin scroll horizontal ni etiquetas cortadas', async () => {
  const app = await launch({ width: 375, height: 667 });
  const { page } = app;
  try {
    await open(page, '#/analysis');
    assert.match(await page.locator('.an-nodata').innerText(), /Aún no hay datos que analizar/);
    assert.strictEqual(await page.locator('.an-card').count(), 0);
    assert.match(await page.locator('.an-profile').innerText(), /Completa tu perfil \(30 s\)/);
    await shot(page, 'analysis-empty-375');
    await clickAndWait(page, page.locator('.an-profile'));
    assert.strictEqual(await hashOf(page), '#/settings/profile');
    // Hoy sin datos: sin «Tu análisis» (solo diría «faltan datos»)
    await open(page, '#/today');
    assert.strictEqual(await page.locator('.an-sum').count(), 0);

    await seed(page, maleSeed());
    await open(page, '#/analysis');
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await smallButtons(page, '.an'), []);
    const cut = await page.locator('.an .kpi-value, .an .kpi-label, .an-ex .list-item-title, .an-ex .list-item-sub').evaluateAll((els) => els.filter((e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      return e.scrollWidth > e.clientWidth + 1 || r.getBoundingClientRect().width > e.getBoundingClientRect().width + 1;
    }).map((e) => e.textContent));
    assert.deepStrictEqual(cut, [], 'KPIs sin recortar');
    await shot(page, 'analysis-top-375');
    await shotAt(page, '.an-card-strength', 'analysis-strength-375');
    await open(page, '#/progress');
    const labels = await page.locator('.prg-link-label').evaluateAll((els) => els.map((e) => ({ t: e.textContent, cut: e.scrollWidth > e.clientWidth + 1 })));
    assert.strictEqual(labels[0].t, 'Análisis');
    assert.ok(labels.every((l) => !l.cut), JSON.stringify(labels));
    await shot(page, 'analysis-progress-375');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
