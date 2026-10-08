// E2E de #/predictions (tiempos previstos y «¿Puedo hacerlo?», docs/MEJORAS.md §4). Fecha fijada: jueves 24 sep
// 2026. Estado vacío (sin carreras y con 1 válida), tarjetas de 5 km / 10 km / media / maratón con los mismos números
// que js/race-predict.js (estimación actual en grande, rango probable y ritmo), «¿Por qué?», base del cálculo (el
// senderismo no cuenta) y el comprobador en sus tres veredictos y con «Otra» distancia. Regresión del iPhone (un tiempo
// de 31 h; poco volumen → media y maratón «todavía poco fiable») con la maquetación comprobada a 375, 390 y 430 px.
// Deja capturas en test-results/.
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
    const u = await import('./js/util.js');
    const out = {};
    for (const [id, p] of Object.entries(r.predictions)) {
      out[id] = {
        low: p.low, mid: p.mid, high: p.high, range: rp.rangeText(p), confidence: p.confidence, adjusted: p.adjusted, k: p.k,
        status: p.status, time: u.fmtRaceTime(p.mid), pace: u.fmtPaceKm(p.pace), note: p.advice.note,
      };
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
const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;
const RANGE = /^\d{1,2}:\d{2}(:\d{2})?–\d{1,2}:\d{2}(:\d{2})?$/;
/** Lo que enseña cada tarjeta (texto limpio). */
const cardsOf = (page) => page.locator('.prd-race').evaluateAll((els) => els.map((el) => {
  const t = (sel) => { const x = el.querySelector(sel); return x ? x.textContent.replace(/\u00a0/g, ' ').replace(/\u2060/g, '') : null; };
  return {
    race: el.dataset.race, confidence: el.dataset.confidence, status: el.dataset.status, name: t('.prd-race-name'),
    badge: t('.prd-conf'), time: t('.prd-race-time'), caption: t('.prd-race-caption'), range: t('.prd-race-range'),
    pace: t('.prd-race-pace'), labels: [...el.querySelectorAll('.prd-fact dt')].map((d) => d.textContent),
    note: t('.prd-race-note'), state: t('.prd-race-state'), explain: t('.prd-race-explain'),
    vol: [...el.querySelectorAll('.prd-vol-row')].map((r) => [...r.children].map((x) => x.textContent.replace(/\u00a0/g, ' '))),
    estHidden: el.querySelector('.prd-est') ? el.querySelector('.prd-est').hidden : null,
  };
}));
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
    const cards = await cardsOf(page);
    assert.deepEqual(cards.map((c) => c.race), ['5k', '10k', 'half', 'marathon']);
    assert.deepEqual(cards.map((c) => c.name), ['5 km', '10 km', 'Media maratón', 'Maratón']);
    for (const c of cards) {
      const e = exp.predictions[c.race];
      assert.equal(c.status, e.status, c.race);
      assert.equal(c.confidence, e.confidence);
      assert.equal(c.badge, `Confianza ${e.confidence}`);
      if (e.status !== 'ok') continue;
      // Jerarquía: estimación actual grande; rango probable y ritmo debajo
      assert.equal(c.time, e.time, c.race);
      assert.match(c.time, TIME);
      assert.equal(c.caption, 'estimación actual');
      assert.equal(c.range, e.range, c.race);
      assert.match(c.range, RANGE);
      assert.equal(c.pace, e.pace);
      assert.match(c.pace, /^\d{1,2}:\d{2}\/km$/);
      assert.deepEqual(c.labels, ['Rango probable', 'Ritmo estimado']);
      assert.equal(c.note, e.note, `aviso de ${c.race}`);
    }
    // Media y maratón con ≈ 9 km/sem (menos de la mitad de la referencia): k mayor, confianza baja y «todavía poco
    // fiable» (la cifra, a un toque).
    for (const [i, id] of [[2, 'half'], [3, 'marathon']]) {
      assert.ok(exp.predictions[id].k > 1.06);
      assert.equal(exp.predictions[id].confidence, 'baja');
      assert.equal(cards[i].status, 'tentative');
      assert.equal(cards[i].state, 'Predicción todavía poco fiable');
      assert.equal(cards[i].estHidden, true);
      assert.match(cards[i].explain, /demasiado bajo para estimar/);
    }

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
    // 15 km usa el perfil de la media: con este volumen, orientativo (y lo dice)
    assert.match(clean(await check.locator('.prd-check-hint').textContent()), /^Orientativo en 15 km: \d:\d{2}:\d{2}–\d:\d{2}:\d{2} \(\d:\d{2}–\d:\d{2}\/km\)$/);
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

// ---------------------------------------------------------------------------
// Regresión del iPhone (docs/MEJORAS6.md, corrección de tiempos previstos)
// ---------------------------------------------------------------------------

/** Problemas de maquetación en las tarjetas: se sale, se corta, se superpone o letra de menos de 12 px. */
async function layoutIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw) issues.push(`scroll horizontal: ${document.documentElement.scrollWidth} > ${vw}`);
    const visible = (el) => !el.closest('[hidden]') && el.getClientRects().length > 0;
    const hit = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
    const ATOMS = '.prd-race-name, .prd-conf, .prd-race-time, .prd-race-caption, .prd-fact, .prd-race-note, .prd-race-state, .prd-race-explain, .prd-vol th, .prd-vol td, .prd-reveal, .why-btn, .prd-suspect-title, .prd-suspect-text, .prd-suspect-item';
    for (const card of document.querySelectorAll('.prd-race, .prd-suspect')) {
      const tag = card.dataset.race || 'avisos';
      const cr = card.getBoundingClientRect();
      for (const el of card.querySelectorAll('*')) {
        if (!visible(el) || el.closest('.why-body')) continue;
        const r = el.getBoundingClientRect();
        if (r.right > cr.right + 0.5 || r.left < cr.left - 0.5) issues.push(`${tag}: .${el.className} se sale de la tarjeta`);
        const cs = getComputedStyle(el);
        if (cs.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 1) issues.push(`${tag}: .${el.className} se corta`);
        if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 12) issues.push(`${tag}: .${el.className} a ${cs.fontSize}`);
      }
      const atoms = [...card.querySelectorAll(ATOMS)].filter((el) => visible(el) && !el.closest('.why-body'));
      for (let i = 0; i < atoms.length; i++) {
        for (let j = i + 1; j < atoms.length; j++) {
          if (atoms[i].contains(atoms[j]) || atoms[j].contains(atoms[i])) continue;
          if (hit(atoms[i].getBoundingClientRect(), atoms[j].getBoundingClientRect())) issues.push(`${tag}: .${atoms[i].className} se superpone a .${atoms[j].className}`);
        }
      }
    }
    return issues;
  });
}

// 5 km en 28:55 (hace 4 días), 4 km en 24:30 (hace 12) y 5 km con «31:00» escrito en la casilla de las horas (31 h).
const IPHONE = [
  activity('run_ok1', 'run', ago(4), 5, 28 * 60 + 55),
  activity('run_ok2', 'run', ago(12), 4, 24 * 60 + 30),
  activity('run_bad', 'run', ago(30), 5, 31 * 3600),
];
/** Lo que se veía en el iPhone y nunca debe volver: negativos, «:-», ritmos h:mm:ss/km, NaN… */
const GARBAGE = /[-−]\d|:-|\d+:\d{2}:\d{2}\s?\/km|NaN|Infinity|undefined/;

test('iPhone: un tiempo de 31 h no rompe la pantalla; media y maratón «todavía poco fiable»; 375, 390 y 430 px', async () => {
  const app = await launch({ width: 375, height: 812 });
  const { page, errors } = app;
  try {
    await seed(page, IPHONE);
    await open(page, '#/predictions');
    assert.equal(await page.locator('.content.prd').getAttribute('data-ok'), '1');
    const cardsText = clean(await page.locator('.prd-races').textContent());
    assert.ok(!GARBAGE.test(cardsText), cardsText.match(GARBAGE)?.[0]);
    assert.ok(!/14:25:40|29:37:50|61:46/.test(cardsText));

    // La carrera de 31 h no cuenta y se puede revisar
    const sus = page.locator('.prd-suspect');
    assert.equal(clean(await sus.locator('.prd-suspect-title').textContent()), '1 carrera no cuenta por su ritmo');
    assert.match(await sus.locator('.prd-suspect-text').textContent(), /minutos escritos en la casilla de las horas/);
    const item = sus.locator('.prd-suspect-item');
    assert.equal(await item.count(), 1);
    assert.equal(await item.getAttribute('data-session'), 'run_bad');
    assert.equal(await item.getAttribute('aria-label'), 'Revisar 5 km en 31:00:00');
    assert.equal(clean(await item.locator('.list-item-title').textContent()), '5 km en 31:00:00');
    assert.match(clean(await item.locator('.list-item-sub').textContent()), /más lenta de 20:00\/km$/);

    // 5 km y 10 km: estimación, rango y ritmo bien formados; confianza media (2 carreras) explicada sin parecer un error
    const exp = await expected(page);
    const cards = await cardsOf(page);
    for (const c of cards.slice(0, 2)) {
      const e = exp.predictions[c.race];
      assert.equal(c.status, 'ok', c.race);
      assert.equal(c.time, e.time);
      assert.match(c.time, TIME);
      assert.match(c.range, RANGE);
      assert.match(c.pace, /^\d{1,2}:\d{2}\/km$/);
      assert.equal(c.badge, 'Confianza media');
      assert.equal(c.note, 'Solo tienes 2 carreras válidas recientes, así que este rango es orientativo. La precisión mejorará cuando registres más.');
    }
    assert.equal(cards[0].time, '29:55');
    assert.equal(cards[0].range, '28:50–31:00');
    assert.equal(cards[0].pace, '5:59/km');

    // Media y maratón: lo que falta primero; la cifra, a un toque y marcada como orientativa
    for (const [i, noun, long, weekly] of [[2, 'la media maratón', 14, 25], [3, 'el maratón', 24, 40]]) {
      const c = cards[i];
      assert.equal(c.status, 'tentative');
      assert.equal(c.badge, 'Confianza baja');
      assert.equal(c.state, 'Predicción todavía poco fiable');
      assert.equal(c.explain, `Tu volumen actual todavía es demasiado bajo para estimar ${noun} con precisión.`);
      assert.deepEqual(c.vol, [['Tirada más larga', '5 km', `≥ ${long} km`], ['Km por semana', '2,3 km', `≥ ${weekly} km`]]);
      assert.equal(c.estHidden, true);
      assert.equal(c.time, exp.predictions[c.race].time, 'la cifra existe (oculta)');
    }
    const half = page.locator('.prd-race[data-race="half"]');
    await half.locator('.prd-reveal').click();
    assert.equal(await half.locator('.prd-reveal').getAttribute('aria-expanded'), 'true');
    assert.ok(await half.locator('.prd-est').isVisible());
    assert.equal(await half.locator('.prd-race-caption').textContent(), 'estimación orientativa');
    assert.match(clean(await half.locator('.prd-race-time').textContent()), /^\d:\d{2}:\d{2}$/);
    assert.equal(clean(await half.locator('.prd-reveal').textContent()), 'Ocultar estimación orientativa');

    // «¿Por qué?» del 5 km: qué carreras, cuál pesa más, fórmula, confianza, volumen y qué falta
    const five = page.locator('.prd-race[data-race="5k"]');
    await five.locator('.why-btn').click();
    const why = clean(await five.locator('.why-body').textContent());
    for (const re of [/Fórmula de Riegel/, /\(la que más\)/, /Estimación actual \(media ponderada\)29:55 · 5:59\/km/, /Km por semana/, /Tirada más larga/, /ConfianzaMedia — solo 2 esfuerzos válidos/, /Para mejorarlaRegistra otra carrera de 3 km o más/, /más lento de 20:00\/km/]) {
      assert.match(why, re);
    }
    assert.ok(!GARBAGE.test(why), why.match(GARBAGE)?.[0]);
    await five.locator('.why-btn').click();

    // Maquetación a 375, 390 y 430 px (con la estimación orientativa de la media abierta y cerrada). Para las capturas
    // de elemento la barra superior y la de pestañas (fijas) no se pintan encima.
    const bars = (on) => page.evaluate((v) => { for (const el of document.querySelectorAll('.topbar, .tabbar')) el.style.visibility = v ? '' : 'hidden'; }, on);
    for (const width of [375, 390, 430]) {
      await page.setViewportSize({ width, height: 812 });
      await open(page, '#/today');
      await open(page, '#/predictions');
      assert.deepEqual(await layoutIssues(page), [], `${width} px`);
      await shot(page, `predictions-iphone-${width}-top`);
      await bars(false);
      await page.locator('.prd-races').screenshot({ path: path.join(RESULTS, `predictions-iphone-${width}.png`) });
      await bars(true);
      await page.locator('.prd-race[data-race="half"] .prd-reveal').click();
      await page.locator('.prd-race[data-race="half"] .prd-est').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('.prd-race[data-race="half"] .prd-reveal .icon').getAnimations().length === 0);
      assert.deepEqual(await layoutIssues(page), [], `${width} px con la estimación orientativa`);
      await bars(false);
      await page.locator('.prd-race[data-race="half"]').screenshot({ path: path.join(RESULTS, `predictions-iphone-${width}-half-open.png`) });
      await bars(true);
    }
    await page.setViewportSize({ width: 375, height: 812 });

    // «Revisar» abre la carrera, y el formulario avisa del ritmo imposible
    await page.locator('.prd-suspect-item').click();
    await page.waitForFunction(() => location.hash === '#/activity/run_bad');
    await page.locator('.act-dur-hint').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.act-dur-hint').textContent(), 'Más de una hora por km: más lento que caminar. ¿Escribiste los minutos en la casilla de las horas?');
    assert.ok(await page.locator('.act-dur-hint').evaluate((el) => el.classList.contains('warn')));
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('carreras que se contradicen: sin cifras, explicando por qué; «¿Puedo hacerlo?» no compara', async () => {
  const app = await launch({ width: 375, height: 812 });
  const { page, errors } = app;
  try {
    // 5 km a 2:31 /km y un maratón a 19:59 /km: creíbles por separado, imposibles a la vez (dispersión > ±25 %).
    await seed(page, [activity('fast', 'run', ago(0), 5, 5 * 151), activity('slow', 'run', ago(80), 42.2, Math.round(42.2 * 1199))]);
    await open(page, '#/predictions');
    const cards = await cardsOf(page);
    for (const c of cards) {
      assert.equal(c.status, 'incoherent', c.race);
      assert.equal(c.state, 'Predicción todavía poco fiable');
      assert.match(c.explain, /^Tus carreras recientes no coinciden entre sí \(±[\d,]+ %\): puede que alguna tenga mal apuntado el tiempo o la distancia\.$/);
      assert.equal(c.time, null, 'sin cifra');
      assert.equal(c.range, null);
    }
    assert.ok(!GARBAGE.test(clean(await page.locator('.prd-races').textContent())));
    const check = page.locator('.prd-check');
    await check.getByRole('button', { name: '5 km', exact: true }).click();
    assert.equal(clean(await check.locator('.prd-check-hint').textContent()), 'Sin una previsión útil en 5 km.');
    await setTarget(page, 20 * 60);
    const v = await verdict(page);
    assert.equal(v.verdict, 'insuficiente');
    assert.match(clean(v.text), /^No hay una previsión útil para los 5 km\./);
    assert.deepEqual(await layoutIssues(page), []);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});
