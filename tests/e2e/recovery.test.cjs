// Ronda 8 (F): #/recovery, la evolución de los check-ins. Estado vacío desde Progreso › Recuperación; con datos: las
// tiras de 4 y 12 semanas, la frase de tendencia del analista con su confianza (la MISMA que la tarjeta Recuperación de
// #/analysis, que enlaza con «Ver evolución») y una zona que se repite («Rodilla izq. 6 → 5 → 4 → 2 · Mejorando»).
// Texto al 150 % a 375 px sin scroll horizontal. Fecha fijada: sábado 10 oct 2026. Datos sintéticos.
// Chromium y WebKit (si está instalado). Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/recovery.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, waitRoute, settle, reload, shot, engineAvailable } = require('./helpers.cjs');

const TODAY = '2026-10-10';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

/** Abre la app con el reloj fijado (y, si se pide, el texto agrandado). */
function open(browser, { scale = 1 } = {}) {
  return openApp({
    browser,
    beforeLoad: async (page) => {
      await page.context().clock.install({ time: madrid(TODAY) });
      if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('entreno.textScale', String(s)); } catch { /* */ } }, scale);
    },
  });
}

/**
 * Pesajes (para que Progreso y el análisis tengan datos) y, con `checkins`, check-ins: energía 3 entre hace 3 y 8
 * semanas y 1 en las 2 últimas (sueño, estrés y agujetas, 2 siempre), y la rodilla izquierda 6, 5, 4, 2.
 */
async function seed(page, { checkins = true } = {}) {
  await page.evaluate(async ({ checkins }) => {
    const db = await import('./js/db.js');
    const util = await import('./js/util.js');
    const { store } = window.__app;
    const today = util.todayStr();
    const bodyweight = [];
    for (let i = 60; i >= 0; i -= 3) bodyweight.push({ id: util.addDays(today, -i), kg: 75 + (i % 2) * 0.2, createdAt: 1, updatedAt: 1 });
    const list = [];
    if (checkins) {
      const byDate = new Map();
      const add = (ago, energy) => {
        const date = util.addDays(today, -ago);
        const c = { id: `rcv_${ago}`, date, timing: 'pre', sessionId: null, sleep: 2, energy, stress: 2, soreness: 2, areas: [], createdAt: 1, updatedAt: 1 };
        byDate.set(date, c);
        list.push(c);
        return c;
      };
      for (let ago = 22; ago <= 56; ago += 2) add(ago, 3);
      for (let ago = 0; ago <= 12; ago += 2) add(ago, 1);
      [[26, 6], [24, 5], [10, 4], [4, 2]].forEach(([ago, level], k) => {
        const c = byDate.get(util.addDays(today, -ago)) || add(ago, 2);
        c.areas.push({ id: `rcv_z${k}`, kind: 'joint', zone: 'knee', side: 'left', level, note: k === 0 ? 'tras el peso muerto rumano' : '' });
      });
    }
    const settings = store.settings();
    settings.profile = { ...(settings.profile || {}), sex: 'male', goal: 'maintain', experience: 'intermediate', promptDismissed: true, onboardedAt: 1, birthDate: '1990-06-15' };
    settings.lastBackupAt = Date.now();
    await db.putStores({ bodyweight, checkins: list, meta: [settings] });
  }, { checkins });
  await reload(page);
}

/** Celdas por tira (una por campo) en la pantalla. */
const cellsPerStrip = (page) => page.locator('.rcv-strip').evaluateAll((els) => els.map((e) => e.querySelectorAll('.rcv-cell').length));

for (const browser of ['chromium', 'webkit']) {
  const skip = engineAvailable(browser) ? false : `${browser} no instalado`;

  test(`[${browser}] sin check-ins: Progreso › Recuperación lleva a #/recovery con su estado vacío`, { skip }, async () => {
    const app = await open(browser);
    try {
      const { page, errors } = app;
      await seed(page, { checkins: false });
      await go(page, '#/progress');
      await page.locator('.prg-ov-row[data-area="recovery"]').click();
      await waitRoute(page, /^#\/recovery$/);
      const empty = page.locator('.rcv-empty');
      await empty.waitFor();
      assert.match(await empty.innerText(), /Aún no hay check-ins/);
      assert.match(await empty.innerText(), /¿Cómo llegas hoy\?/);
      assert.strictEqual(await page.locator('.rcv-strip').count(), 0);
      await shot(page, `recovery-empty-${browser}`);
      await page.getByRole('button', { name: 'Ir a Hoy' }).click();
      await waitRoute(page, /^#\/today$/);
      assert.deepStrictEqual(errors, []);
    } finally {
      await app.close();
    }
  });

  test(`[${browser}] con check-ins: tiras de 4 y 12 semanas, tendencia con confianza, zona que mejora y el mismo insight en Análisis`, { skip }, async () => {
    const app = await open(browser);
    try {
      const { page, errors } = app;
      await seed(page);
      await go(page, '#/progress');
      await page.locator('.prg-ov-row[data-area="recovery"]').click();
      await waitRoute(page, /^#\/recovery$/);
      // Periodos: sin «Todo» (el primer check-in es de hace 8 semanas, menos de 84 días)
      const seg = page.locator('.rcv-period .seg-btn');
      assert.deepStrictEqual(await seg.allInnerTexts(), ['4 semanas', '12 semanas']);
      assert.deepStrictEqual(await cellsPerStrip(page), [28, 28, 28, 28]);
      const energy = page.locator('.rcv-row[data-field="energy"]');
      assert.match(await energy.innerText(), /Normal · media 1,6 · antes 3,0/);
      assert.match(await energy.locator('.rcv-strip').getAttribute('aria-label'), /^Energía, 4 semanas: 10 días con check-in, media 1,6 \(normal\)$/);
      // La frase de tendencia del analista, con su confianza y «¿Por qué?»
      const ins = page.locator('.rcv-insights [data-insight="recovery-trend-energy"]');
      await ins.waitFor();
      assert.strictEqual(await ins.locator('.an-ins-title').innerText(), 'Tu energía ha sido más baja durante las últimas dos semanas');
      // La frase se lee una vez (título); el texto sigue con el dato
      assert.match(await ins.locator('.an-ins-text').innerText(), /^Media 1,0 de 3 en 7 días con check-in, frente a 3,0 en las 6 semanas anteriores/);
      assert.strictEqual((await ins.innerText()).split('Tu energía ha sido más baja').length - 1, 1);
      assert.strictEqual(await ins.getAttribute('data-confidence'), 'medium');
      assert.match(await ins.locator('.an-conf').innerText(), /Confianza media/);
      await ins.locator('.an-fold-btn[data-fold="why"]').click();
      assert.match(await ins.locator('.an-fold-body[data-fold="why"]').innerText(), /no es un diagnóstico/);
      assert.strictEqual(await page.locator('.rcv-insights [data-insight]').count(), 1, 'solo la energía cambia');
      // La zona: 6 → 5 → 4 → 2, «Mejorando», último registro y su nota
      const z = page.locator('.rcv-zone[data-zone="joint:knee:left"]');
      assert.strictEqual(await z.getAttribute('data-trend'), 'better');
      assert.strictEqual(await z.locator('.rcv-zone-name').innerText(), 'Rodilla izq.');
      assert.strictEqual((await z.locator('.rcv-zone-seq').innerText()).replace(/\u00a0/g, ' '), '6 → 5 → 4 → 2');
      assert.match(await z.locator('.state').innerText(), /Mejorando/);
      assert.match(await z.innerText(), /Último: 6 oct/);
      assert.match(await z.innerText(), /Nota \(14 sep\): tras el peso muerto rumano/);
      assert.match(await page.locator('.rcv-foot').innerText(), /no es un diagnóstico/);
      await shot(page, `recovery-4w-${browser}`);
      // 12 semanas: 12 bloques por fila, y se recuerda al volver
      await seg.filter({ hasText: '12 semanas' }).click();
      assert.deepStrictEqual(await cellsPerStrip(page), [12, 12, 12, 12]);
      assert.strictEqual(await page.locator('.rcv-feel').getAttribute('data-bucket'), 'week');
      await shot(page, `recovery-12w-${browser}`);
      await reload(page);
      await page.locator('.rcv-feel').waitFor();
      assert.strictEqual(await page.locator('.rcv-period .seg-btn.active').innerText(), '12 semanas');
      assert.deepStrictEqual(await cellsPerStrip(page), [12, 12, 12, 12]);
      // El mismo insight en la tarjeta Recuperación de #/analysis, con «Ver evolución»
      await go(page, '#/analysis?area=recovery');
      const card = page.locator('.an-card[data-area="recovery"]');
      await card.locator('[data-insight="recovery-trend-energy"]').waitFor();
      await card.getByRole('button', { name: 'Ver evolución' }).click();
      await waitRoute(page, /^#\/recovery$/);
      await page.locator('.rcv-insights [data-insight="recovery-trend-energy"]').waitFor();
      assert.deepStrictEqual(errors, []);
    } finally {
      await app.close();
    }
  });

  test(`[${browser}] texto al 150 % a 375 px: sin scroll horizontal y los bloques dentro de la pantalla`, { skip }, async () => {
    const app = await open(browser, { scale: 1.5 });
    try {
      const { page, errors } = app;
      await page.setViewportSize({ width: 375, height: 812 });
      await seed(page);
      await go(page, '#/recovery');
      await page.locator('.rcv-zone').first().waitFor();
      await settle(page);
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out = [...document.querySelectorAll('.rcv-cell, .rcv-label, .rcv-sum, .rcv-zone-seq, .rcv-zone .state')]
          .map((e) => e.getBoundingClientRect()).filter((r) => r.left < -0.5 || r.right > vw + 0.5).length;
        return { sw: document.documentElement.scrollWidth, vw, out, large: document.documentElement.classList.contains('text-large') };
      });
      assert.ok(m.large, 'texto grande activo');
      assert.ok(m.sw <= m.vw, `sin scroll horizontal: ${m.sw} > ${m.vw}`);
      assert.strictEqual(m.out, 0);
      await shot(page, `recovery-150-${browser}`);
      assert.deepStrictEqual(errors, []);
    } finally {
      await app.close();
    }
  });
}
