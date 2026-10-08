// Ronda 8 (A4): los deltas comparativos son neutros por defecto. «Carrera 0 km · −100 %» a mitad de semana (aún no
// has corrido esta semana) no debe salir en ámbar/rojo; el ámbar solo aparece si el analista ya avisa de esa subida
// (sugerencia «runkm-warn» del panel). Fecha fijada: jueves 8 oct 2026. Chromium y WebKit (si está instalado).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/deltas-neutral.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, shot, engineAvailable } = require('./helpers.cjs');

const TODAY = '2026-10-08'; // jueves
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

/** Abre la app con el reloj fijado y siembra actividades { date, kind, km } (perfil ya configurado). */
async function openSeeded(browser, acts) {
  const app = await openApp({ browser, beforeLoad: (page) => page.context().clock.install({ time: madrid(TODAY) }) });
  await app.page.evaluate(async ({ acts }) => {
    const db = await import('./js/db.js');
    const util = await import('./js/util.js');
    const { store } = window.__app;
    const sessions = acts.map((a, i) => {
      const base = util.tsFromDate(a.date, 18);
      const sec = Math.round(a.km * (a.kind === 'run' ? 330 : 120));
      return { id: `dn_${i}`, kind: a.kind, date: a.date, planDate: a.date, templateId: null, templateName: '', status: 'done', startedAt: base,
        endedAt: base + sec * 1000, durationMin: sec / 60, rpe: 6, notes: '', parentId: null, templateItemId: null, createdAt: base, updatedAt: base,
        distanceKm: a.km, movingSec: sec, elapsedSec: sec, elevationM: 40, subtype: '', feel: '' };
    });
    const settings = store.settings();
    settings.profile = { ...(settings.profile || {}), sex: 'male', goal: 'maintain', experience: 'intermediate', promptDismissed: true, onboardedAt: 1, birthDate: '1990-06-15' };
    settings.lastBackupAt = Date.now();
    await db.putStores({ sessions, meta: [settings] });
  }, { acts });
  await app.page.reload();
  await app.page.waitForFunction(() => document.documentElement.classList.contains('ready'), null, { timeout: 15000 });
  await go(app.page, '#/weekly');
  await app.page.locator('.wk-recap').waitFor();
  return app;
}

/** Chip del deporte en «Resumen de la semana»: texto, tono y si su color coincide con el de aviso/peligro. */
const runChip = (page) => page.evaluate(() => {
  const chip = document.querySelector('.wk-recap-km-row[data-kind="run"] .sum-delta');
  if (!chip) return null;
  const probe = (v) => {
    const el = document.createElement('span');
    el.style.color = `var(${v})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  };
  const color = getComputedStyle(chip).color;
  return {
    text: chip.textContent.trim(), dir: chip.dataset.dir, tone: chip.dataset.tone, color,
    isWarn: color === probe('--warn'), isDanger: color === probe('--danger'), isOk: color === probe('--ok'),
  };
});

/** Tonos de todos los chips del bloque. */
const allTones = (page) => page.locator('.wk-recap .sum-delta').evaluateAll((els) => els.map((e) => ({ dir: e.dataset.dir, tone: e.dataset.tone })));

for (const browser of ['chromium', 'webkit']) {
  test(`[${browser}] «Carrera 0 km −100 %» a mitad de semana: neutro, ni ámbar ni rojo`, { skip: engineAvailable(browser) ? false : `${browser} no instalado` }, async () => {
    // Semana anterior: carrera el martes (dentro del tramo lunes → jueves); esta semana solo bici, aún sin correr.
    const app = await openSeeded(browser, [
      { date: '2026-09-22', kind: 'run', km: 8 },
      { date: '2026-09-29', kind: 'run', km: 10 },
      { date: '2026-10-01', kind: 'bike', km: 30 },
      { date: '2026-10-06', kind: 'bike', km: 25 },
    ]);
    try {
      const { page, errors } = app;
      const c = await runChip(page);
      assert.ok(c, 'hay chip de carrera');
      assert.strictEqual(c.dir, 'down');
      assert.match(c.text, /−100 %/, c.text);
      assert.strictEqual(c.tone, 'neutral', JSON.stringify(c));
      assert.ok(!c.isWarn && !c.isDanger && !c.isOk, `color neutro: ${JSON.stringify(c)}`);
      // Ningún chip del bloque lleva tono sin una regla (aquí no hay avisos de carga ni de km)
      const tones = await allTones(page);
      assert.ok(tones.length >= 3 && tones.every((t) => t.tone === 'neutral'), JSON.stringify(tones));
      await shot(page, `deltas-neutral-${browser}-390`);
      assert.deepStrictEqual(errors, []);
    } finally {
      await app.close();
    }
  });

  test(`[${browser}] subida de km de carrera con aviso del panel: ese chip sí en ámbar`, { skip: engineAvailable(browser) ? false : `${browser} no instalado` }, async () => {
    const app = await openSeeded(browser, [
      { date: '2026-09-22', kind: 'run', km: 10 },
      { date: '2026-09-29', kind: 'run', km: 10 },
      { date: '2026-10-05', kind: 'run', km: 10 },
      { date: '2026-10-07', kind: 'run', km: 10 },
    ]);
    try {
      const { page, errors } = app;
      // El panel ya avisa (sugerencia runkm-warn): la regla existente es la que da el tono
      assert.strictEqual(await page.locator('.wk-msg[data-id="runkm-warn"][data-level="warn"]').count(), 1, 'el panel muestra el aviso de km de carrera');
      const c = await runChip(page);
      assert.strictEqual(c.dir, 'up');
      assert.strictEqual(c.tone, 'warn', JSON.stringify(c));
      assert.ok(c.isWarn, `color de aviso: ${JSON.stringify(c)}`);
      // «Carga» solo en ámbar si el panel también avisa de la carga (load-warn); el resto, neutro
      const loadWarn = await page.locator('.wk-msg[data-id="load-warn"][data-level="warn"]').count();
      const loadTone = await page.locator('.wk-recap-kpi[data-kpi="load"] .sum-delta').getAttribute('data-tone');
      assert.strictEqual(loadTone, loadWarn ? 'warn' : 'neutral');
      const tones = await allTones(page);
      assert.strictEqual(tones.filter((t) => t.tone === 'warn').length, 1 + loadWarn, JSON.stringify(tones));
      assert.ok(tones.every((t) => t.tone !== 'good'), JSON.stringify(tones));
      assert.deepStrictEqual(errors, []);
    } finally {
      await app.close();
    }
  });
}
