// E2E de la franja de contexto en las gráficas (ronda 8, E; docs/MEJORAS.md §9): fases (una fila de segmentos
// neutros), hechos (puntos) y eventos pasados con resultado en Progreso, la ficha de ejercicio, #/bodyweight y el
// análisis; el interruptor «Contexto» (recordado por gráfica), el globo, la descripción accesible, el modo mujer y
// texto al 150 %. En Chromium y en WebKit (E2E_BROWSER=webkit o la prueba propia de WebKit del final).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/chart-context.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, settle, reload, shot, engineAvailable, BROWSER } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayLabel = (s) => `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]}`;
const T = (n) => addDays(TODAY, n);

/**
 * Datos realistas (6 meses, modo mujer con ciclo; ya traen «Prep. 10K» abierta desde T−40 e «Inicio creatina» en T−20)
 * y, además: ganancia T−60…T−30, parón T−50…T−36, enfermedad T−45…T−40 (tres fases a la vez en T−42), descarga
 * T−10…T−5 y un 10K pasado con su carrera vinculada.
 */
async function openSeeded({ browser = BROWSER, scale = 1, width = 375 } = {}) {
  const app = await openApp({
    browser,
    beforeLoad: async (page) => {
      await page.context().clock.install({ time: madrid(TODAY) });
      if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('entreno.textScale', String(s)); } catch { /* */ } }, scale);
    },
  });
  await app.page.setViewportSize({ width, height: 844 });
  await seedRealistic(app.page, { months: 6, female: true });
  const race = await app.page.evaluate(async (days) => {
    const st = window.__app.store;
    const ap = (date) => ({ date, precision: 'day' });
    const base = { text: '', notes: '', goalIds: [], sports: [], createdAt: 10, updatedAt: 10 };
    await st.save('context', { ...base, id: 'cc_gain', kind: 'phase', type: 'gain', start: ap(days.gain0), end: ap(days.gain1) });
    await st.save('context', { ...base, id: 'cc_break', kind: 'phase', type: 'break', start: ap(days.break0), end: ap(days.break1) });
    await st.save('context', { ...base, id: 'cc_ill', kind: 'phase', type: 'illness', start: ap(days.ill0), end: ap(days.ill1) });
    await st.save('context', { ...base, id: 'cc_deload', kind: 'phase', type: 'deload', start: ap(days.del0), end: ap(days.del1) });
    // Un 10K pasado con su carrera (la última antes de T−3) como resultado
    const runs = st.all('sessions').filter((s) => s.kind === 'run' && s.status === 'done' && s.date < days.cut).sort((a, b) => (a.date < b.date ? 1 : -1));
    const r = runs[0];
    await st.save('races', { id: 'cc_race', name: '10K Valencia', type: 'custom', date: r.date, distanceKm: r.distanceKm, targetSec: null, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1, outcome: { status: 'done', activityId: r.id, contextId: null, manual: null, place: null, note: '', at: 1 } });
    const sec = Math.round(r.movingSec || r.durationMin * 60);
    return { date: r.date, sec };
  }, { gain0: T(-60), gain1: T(-30), break0: T(-50), break1: T(-36), ill0: T(-45), ill1: T(-40), del0: T(-10), del1: T(-5), cut: T(-3) });
  return { ...app, race };
}

/** Tarjeta de Progreso por data-chart (desplazada al centro para que nada pegajoso la tape). */
async function card(page, id) {
  const loc = page.locator(`section[data-chart="${id}"]`).first();
  await loc.evaluate((el) => el.querySelector('.chart-svg')?.scrollIntoView({ block: 'center' }));
  await settle(page);
  return loc;
}
/** Caja del SVG + su data-* (marco y dominio de fechas). */
async function svgBox(loc) {
  const svg = loc.locator('.chart-svg');
  const box = await svg.boundingBox();
  const ds = await svg.evaluate((el) => ({ ...el.dataset }));
  return { ...box, ds };
}
function xOfDate(b, dateStr) {
  const d = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  const t = (d(dateStr) - d(b.ds.from)) / (d(b.ds.to) - d(b.ds.from));
  return b.x + Number(b.ds.x0) + t * (Number(b.ds.x1) - Number(b.ds.x0));
}

test('fase, hecho, varias fases y globo en la gráfica de peso de Progreso', async () => {
  const { page, errors, close } = await openSeeded();
  try {
    await go(page, '#/progress');
    const bw = await card(page, 'bodyweight');
    const b = await svgBox(bw);
    assert.strictEqual(b.ds.t, '18', 'con contexto, el margen de arriba es la franja');
    assert.strictEqual(b.ds.ctx, '1');
    // Fases: la unión ganancia ∪ parón ∪ enfermedad en una sola fila y la descarga aparte (Prep. 10K no explica el peso)
    const segs = await bw.locator('.chart-ctx-seg').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { from: e.dataset.from, to: e.dataset.to, open: e.dataset.open || '', cy: Math.round((r.top + r.bottom) / 2), fill: getComputedStyle(e).fill, op: getComputedStyle(e).fillOpacity };
    }));
    assert.deepStrictEqual(segs.map((s) => [s.from, s.to, s.open]), [[T(-60), T(-30), ''], [T(-10), T(-5), '']]);
    assert.strictEqual(new Set(segs.map((s) => s.cy)).size, 1, 'todas las fases en la misma fila');
    assert.strictEqual(new Set(segs.map((s) => s.fill)).size, 1, 'un único color (sin arcoíris)');
    assert.ok(Math.abs(segs[0].cy - (b.y + 9)) <= 1, `la fila va en la franja de arriba (${segs[0].cy} vs ${b.y + 9})`);
    // El hecho de tu contexto (los resultados de carrera no explican el peso)
    const facts = await bw.locator('.chart-ctx-fact').evaluateAll((els) => els.map((e) => e.dataset.date));
    assert.deepStrictEqual(facts, [T(-20)]);
    const fb = await bw.locator(`.chart-ctx-fact[data-date="${T(-20)}"]`).boundingBox();
    await page.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
    const tip = bw.locator('.chart-tip');
    await tip.waitFor({ state: 'visible' });
    assert.strictEqual((await tip.innerText()).trim(), `${dayLabel(T(-20))} · Inicio creatina`);
    // Un toque cerca (±22 px) pero dentro de la franja abre el mismo hecho; fuera de la franja, el pesaje
    await page.touchscreen.tap(fb.x + fb.width / 2 + 15, b.y + 30);
    assert.strictEqual((await tip.locator('.chart-tip-title').innerText()).trim(), `${dayLabel(T(-20))} · Inicio creatina`);
    // Globo de un pesaje con tres fases a la vez: «Enfermedad · +2» (vida > entrenamiento > cuerpo), en una línea
    await page.touchscreen.tap(xOfDate(b, T(-42)), b.y + b.height * 0.6);
    const ctxLine = tip.locator('.chart-tip-ctx');
    await ctxLine.waitFor();
    assert.strictEqual(await ctxLine.innerText(), 'Enfermedad · +2');
    assert.match(await tip.locator('.chart-tip-title').innerText(), /2026/);
    const lines = await ctxLine.evaluate((el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).fontSize) * 1.6, ws: getComputedStyle(el).whiteSpace }));
    assert.strictEqual(lines.ws, 'nowrap');
    assert.ok(lines.h <= lines.lh, `una sola línea (${lines.h} px)`);
    // Un pesaje sin contexto no lleva la línea
    await page.touchscreen.tap(xOfDate(b, T(-1)), b.y + b.height * 0.6);
    assert.strictEqual(await tip.locator('.chart-tip-ctx').count(), 0);
    // Accesible: la descripción dice el contexto
    const aria = await bw.locator('.chart-svg').getAttribute('aria-label');
    // (las fases por prioridad —vida, entrenamiento, cuerpo— y después los hechos; 3 como mucho y «y N más»)
    assert.ok(aria.endsWith('. Contexto: Enfermedad (fase), Descarga (fase), Parón (fase) y 2 más'), aria);
    await shot(page, `chart-context-${BROWSER}-progress`);
    assert.deepStrictEqual(errors, []);
  } finally {
    await close();
  }
});

test('interruptor «Contexto»: apaga la franja, se recuerda al navegar y recargar, por gráfica; carga apagada por defecto', async () => {
  const { page, errors, close } = await openSeeded();
  try {
    await go(page, '#/progress');
    let bw = await card(page, 'bodyweight');
    const toggle = bw.locator('.chart-ctx-toggle');
    assert.strictEqual(await toggle.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await toggle.getAttribute('aria-label'), 'Mostrar contexto en la gráfica');
    assert.ok((await toggle.boundingBox()).height >= 44, 'objetivo de 44 px');
    assert.strictEqual(await bw.locator('.prg-ctx-howto').isVisible(), true, 'la frase de ayuda sale con contexto');
    await toggle.click();
    assert.strictEqual(await toggle.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await bw.locator('.chart-ctx').count(), 0, 'sin franja');
    assert.strictEqual(await bw.locator('.prg-ctx-howto').isVisible(), false, 'sin franja, sin la frase que la explica');
    let ds = await bw.locator('.chart-svg').evaluate((el) => ({ ...el.dataset }));
    assert.strictEqual(ds.t, '10', 'apagado, la gráfica queda como antes');
    assert.strictEqual(ds.ctx, undefined);
    assert.doesNotMatch(await bw.locator('.chart-svg').getAttribute('aria-label'), /Contexto:/);
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('entreno.chartctx.bodyweight')), '0');
    // Navegar y volver: sigue apagado
    await go(page, '#/today');
    await go(page, '#/progress');
    bw = await card(page, 'bodyweight');
    assert.strictEqual(await bw.locator('.chart-ctx-toggle').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await bw.locator('.chart-ctx').count(), 0);
    // Recargar: sigue apagado
    await reload(page);
    await go(page, '#/progress');
    bw = await card(page, 'bodyweight');
    assert.strictEqual(await bw.locator('.chart-ctx-toggle').getAttribute('aria-pressed'), 'false');
    // La carga semanal empieza apagada (barras con ruido); al encenderla, la franja va sobre las semanas
    const load = await card(page, 'load');
    const lt = load.locator('.chart-ctx-toggle');
    assert.strictEqual(await lt.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await load.locator('.chart-ctx').count(), 0);
    await lt.click();
    assert.strictEqual(await load.locator('.chart-svg').getAttribute('data-t'), '18');
    assert.ok(await load.locator('.chart-ctx-seg').count() >= 1);
    // Globo de una barra: la semana entera (la del inicio de la creatina) cuenta sus hechos y fases
    const lb = await svgBox(load);
    const n = Number(lb.ds.n);
    const slot = (Number(lb.ds.r) - Number(lb.ds.l)) / n;
    await page.touchscreen.tap(lb.x + Number(lb.ds.l) + slot * (n - 3 - 0.5), lb.y + lb.height * 0.6);
    await load.locator('.chart-tip').waitFor({ state: 'visible' });
    const weekCtx = await load.locator('.chart-tip-ctx').allInnerTexts();
    assert.strictEqual(weekCtx.length, 1, 'la semana con el inicio de la creatina lleva contexto');
    assert.match(weekCtx[0], /^Inicio creatina · \+1$/);
    // Cada clave es independiente: la ficha de ejercicio sigue con contexto
    await go(page, '#/progress/exercise/press_banca');
    const ex = page.locator('.prg-card').first();
    await ex.locator('.chart-ctx').waitFor();
    assert.strictEqual(await ex.locator('.chart-ctx-toggle').getAttribute('aria-pressed'), 'true');
    assert.match(await ex.locator('.chart-svg').getAttribute('aria-label'), /Contexto:/);
    await shot(page, `chart-context-${BROWSER}-exercise`);
    assert.deepStrictEqual(errors, []);
  } finally {
    await close();
  }
});

test('carrera: el evento pasado con resultado sale como hecho con su tiempo; Prep. 10K como fase', async () => {
  const { page, errors, close, race } = await openSeeded();
  try {
    await go(page, '#/progress');
    const run = await card(page, 'run-pace');
    const segs = await run.locator('.chart-ctx-seg').evaluateAll((els) => els.map((e) => [e.dataset.from, e.dataset.to, e.dataset.open || '']));
    // Prep. 10K (T−40, sigue) ∪ parón ∪ enfermedad ∪ descarga ∪ ganancia no (cuerpo no entra en resistencia)
    assert.ok(segs.some(([, to, open]) => to === TODAY && open === '1'), `la fase abierta llega a hoy con el extremo recto: ${JSON.stringify(segs)}`);
    const fact = run.locator(`.chart-ctx-fact[data-date="${race.date}"]`);
    await fact.waitFor();
    const fb = await fact.boundingBox();
    await page.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
    const tip = run.locator('.chart-tip');
    await tip.waitFor({ state: 'visible' });
    const mm = Math.floor(race.sec / 60);
    const ss = String(race.sec % 60).padStart(2, '0');
    const time = mm >= 60 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
    const text = (await tip.innerText()).trim();
    // Puede juntarse con otro hecho cercano (a < 12 px): entonces es una fila del globo
    assert.ok(text.includes(`${dayLabel(race.date)} · 10K Valencia · ${time}`), text);
    // En la gráfica de peso no sale (los eventos de carrera no explican el peso)
    const bw = await card(page, 'bodyweight');
    assert.strictEqual(await bw.locator(`.chart-ctx-fact[data-date="${race.date}"]`).count(), race.date === T(-20) ? 1 : 0);
    assert.deepStrictEqual(errors, []);
  } finally {
    await close();
  }
});

test('modo mujer: franjas de la regla y franja de contexto a la vez en #/bodyweight y en el análisis', async () => {
  const { page, errors, close } = await openSeeded();
  try {
    await go(page, '#/bodyweight');
    const bw = page.locator('.prg-bw-chart');
    await bw.locator('.chart-ctx').waitFor();
    assert.strictEqual(await bw.getAttribute('data-cycle'), '1');
    assert.ok(await bw.locator('.chart-vband').count() > 0, 'franjas rosas de la regla');
    assert.ok(await bw.locator('.chart-ctx-fact').count() > 0, 'y la franja de contexto');
    assert.ok((await bw.locator('.chart-legend .chart-legend-item').count()) >= 3, 'leyenda + interruptor');
    // La misma clave que Progreso: apagar aquí lo apaga allí
    await bw.locator('.chart-ctx-toggle').click();
    assert.strictEqual(await bw.locator('.chart-ctx').count(), 0);
    assert.ok(await bw.locator('.chart-vband').count() > 0, 'las franjas de la regla siguen');
    await bw.locator('.chart-ctx-toggle').click();
    await go(page, '#/analysis');
    const an = page.locator('.an-chart').first();
    await an.locator('.chart-ctx').waitFor();
    assert.ok(await an.locator('.chart-vband').count() > 0, 'franjas de la regla en el análisis');
    assert.ok(await an.locator('.chart-ctx-fact').count() > 0);
    assert.deepStrictEqual(errors, []);
  } finally {
    await close();
  }
});

async function largeText(browser) {
  const { page, errors, close } = await openSeeded({ browser, scale: 1.5, width: 375 });
  try {
    await go(page, '#/progress');
    const bw = await card(page, 'bodyweight');
    const b = await svgBox(bw);
    await page.touchscreen.tap(xOfDate(b, T(-42)), b.y + b.height * 0.6);
    const ctxLine = bw.locator('.chart-tip-ctx');
    await ctxLine.waitFor();
    const m = await ctxLine.evaluate((el) => ({ h: el.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(el).fontSize), cut: el.scrollWidth > el.clientWidth + 1 }));
    assert.ok(m.fs >= 17.9, `texto al 150 % (${m.fs} px)`);
    assert.ok(m.h <= m.fs * 1.6, 'una sola línea también con texto grande');
    assert.strictEqual(m.cut, false, '«Enfermedad · +2» cabe entero');
    const tb = await bw.locator('.chart-ctx-toggle').boundingBox();
    assert.ok(tb.height >= 44, `interruptor de ${tb.height} px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal');
    await shot(page, `chart-context-${browser}-150`);
    assert.deepStrictEqual(errors, []);
  } finally {
    await close();
  }
}

test('texto al 150 % a 375 px: el globo con contexto en una línea, interruptor de 44 px, sin scroll horizontal', () => largeText(BROWSER));
// El otro motor también (en la batería de WebKit, Chromium): los dos motores siempre con texto grande
const OTHER = BROWSER === 'webkit' ? 'chromium' : 'webkit';
test(`${OTHER}: texto al 150 % con contexto a 375 px`, { skip: OTHER === 'webkit' ? skipWebkit : false }, () => largeText(OTHER));
