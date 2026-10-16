// Historiales largos (bloque perf/final, M20; docs/PULIDO.md §32): el «Historial completo» del progreso de un ejercicio
// se pinta por lotes de 30 con «Ver más (N)» (con 5 años eran ~480 filas y 50.000 px de golpe) y los récords 🏆 se
// siguen marcando con todo el historial; restaurar una copia muestra «Restaurando copia…» mientras dura, monta Hoy UNA
// sola vez (antes, dos) y deja exactamente los datos de la copia. Datos sintéticos (tests/e2e/realistic-data.cjs).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/long-history.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, settle, engineAvailable } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const STORES = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle', 'context', 'pastRecords', 'races'];
const sheetPanel = (page) => page.locator('.sheet-overlay.open .sheet-panel').last();
const sheetBtn = (page, text) => sheetPanel(page).locator('button', { hasText: text });

/** Ejercicio con más sesiones (con peso) y su número de sesiones. */
const topExercise = (page) => page.evaluate(() => {
  const c = new Map();
  for (const s of window.__app.store.all('sessions')) {
    if (s.kind !== 'strength' || s.status !== 'done') continue;
    for (const e of new Set((s.exercises || []).filter((x) => (x.sets || []).some((st) => st.weight != null)).map((x) => x.exerciseId))) c.set(e, (c.get(e) || 0) + 1);
  }
  return [...c].sort((a, b) => b[1] - a[1])[0][0];
});

const rowsOf = (page) => page.locator('.prg-hrow').evaluateAll((els) => els.map((e) => ({ id: e.dataset.session, pr: e.dataset.pr })));

test('progreso de un ejercicio con 5 años: 30 filas al abrir, «Ver más (N)» por lotes de 30 y los récords de siempre', { timeout: 240000 }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seedRealistic(page, { months: 60, female: false });
    const ex = await topExercise(page);
    await go(page, `#/progress/exercise/${ex}`);
    await page.locator('.prg-hist').waitFor();
    const total = Number((await page.locator('.prg-hist-head .muted').innerText()).match(/\d+/)[0]);
    assert.ok(total > 90, `historial largo: ${total} sesiones`);
    const first = await rowsOf(page);
    assert.strictEqual(first.length, 30, `al abrir, solo las 30 más recientes (${first.length} de ${total})`);
    const more = page.locator('.prg-hist-more');
    assert.strictEqual(await more.innerText(), `Ver más (${total - 30})`);

    await more.click();
    assert.strictEqual(await page.locator('.prg-hrow').count(), 60, 'un lote más de 30');
    assert.strictEqual(await more.innerText(), `Ver más (${total - 60})`);
    while (await more.isVisible()) await more.click();
    const all = await rowsOf(page);
    assert.strictEqual(all.length, total, 'al final, todas las sesiones');
    assert.strictEqual(new Set(all.map((r) => r.id)).size, total, 'sin filas repetidas');
    // Las 30 primeras no cambian al ampliar (mismas sesiones, mismos 🏆: se calculan con TODO el historial)
    assert.deepStrictEqual(all.slice(0, 30), first);
    assert.ok(all.some((r) => r.pr === '1'), 'hay récords marcados');
    assert.strictEqual(all.at(-1).pr, '', 'la primera sesión nunca marca récord');
    // El botón desaparece con el último lote: el foco no cae a <body>, pasa a la primera fila nueva
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('prg-hrow')), 'foco en una fila del historial');

    // Abrir una sesión de un lote ampliado y volver: las mismas filas y la misma posición (no solo las 30 primeras)
    const target = all[total - 5].id;
    await page.locator(`.prg-hrow[data-session="${target}"]`).click();
    await page.waitForFunction((id) => location.hash === `#/session/${id}`, target);
    await settle(page);
    await page.goBack();
    await page.waitForFunction(() => location.hash.startsWith('#/progress/exercise/'));
    await page.locator(`.prg-hrow[data-session="${target}"]`).waitFor();
    await settle(page);
    assert.strictEqual(await page.locator('.prg-hrow').count(), total, 'al volver, todas las filas que había');
    assert.ok(await page.locator(`.prg-hrow[data-session="${target}"]`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }), 'al volver, la fila tocada sigue a la vista');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// Con navigate + refresh, WebKit (Safari, el del iPhone) montaba Hoy dos veces; en Chromium el segundo anulaba al primero.
for (const browser of ['chromium', 'webkit']) {
  test(`restaurar una copia con 12 meses: «Restaurando copia…» mientras dura, Hoy se monta UNA vez y los datos son los de la copia (${browser})`, { timeout: 180000, skip: browser === 'webkit' && skipWebkit }, async () => {
    const app = await openApp({ browser });
    const { page } = app;
    try {
      await seedRealistic(page, { months: 12, female: true });
      // Exportar sin copiar los datos (se serializan en el acto): el archivo es idéntico al de una copia profunda.
      const exp = await page.evaluate(async () => {
        const { buildBackupObject } = await import('./js/backup.js');
        const store = window.__app.store;
        const now = Date.now();
        const live = store.exportData({ clone: false });
        const s0 = live.data.sessions[0];
        return {
          same: JSON.stringify(buildBackupObject(live, now)) === JSON.stringify(buildBackupObject(store.exportData(), now)),
          shared: s0 === store.get('sessions', s0.id),
          cloned: store.exportData().data.sessions[0] !== store.get('sessions', s0.id),
        };
      });
      assert.deepStrictEqual(exp, { same: true, shared: true, cloned: true });
      const text = await page.evaluate(async () => {
        const { buildBackupObject } = await import('./js/backup.js');
        return JSON.stringify(buildBackupObject(window.__app.store.exportData()));
      });
      // Montajes y el indicador, vistos desde la página (MutationObserver: el indicador puede durar poco). Un montaje =
      // un contenedor .view-inner nuevo en #view (router.mountView); los ganchos onMount no sirven para contarlos: con
      // una vista asíncrona como Hoy se llaman dos veces en cada montaje.
      await page.evaluate(async () => {
        window.__mounts = null;
        new MutationObserver((recs) => {
          for (const rec of recs) {
            for (const n of rec.addedNodes) if (window.__mounts && n.classList?.contains('view-inner')) window.__mounts.push(location.hash);
          }
        }).observe(document.getElementById('view'), { childList: true });
        window.__busy = [];
        new MutationObserver(() => {
          const el = document.querySelector('.cfg-busy');
          if (el) window.__busy.push({ text: el.innerText, inert: document.getElementById('app').inert });
        }).observe(document.body, { childList: true });
      });

      // 1) Desde Ajustes → Datos, con la interfaz
      await go(page, '#/settings/data');
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-import').click()]);
      await fc.setFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
      await page.evaluate(() => { window.__mounts = []; });
      await sheetBtn(page, 'Sustituir todo').click();
      await page.locator('.toast', { hasText: 'Copia importada' }).waitFor({ timeout: 60000 });
      await settle(page);
      assert.strictEqual(await page.evaluate(() => location.hash), '#/today');
      assert.deepStrictEqual(await page.evaluate(() => window.__mounts), ['#/today'], 'Hoy se monta una sola vez');
      const busy = await page.evaluate(() => window.__busy);
      assert.ok(busy.length > 0, 'se mostró el indicador');
      assert.match(busy[0].text, /Restaurando copia…/);
      assert.strictEqual(busy[0].inert, true, 'la app no admite toques mientras restaura');
      assert.strictEqual(await page.locator('.cfg-busy').count(), 0, 'el indicador se quita al terminar');
      assert.strictEqual(await page.evaluate(() => document.getElementById('app').inert), false);
      // Los datos, exactamente los de la copia (memoria)
      const backup = JSON.parse(text).data;
      const mem = await page.evaluate(() => window.__app.store.exportData().data);
      const byId = (arr) => [...arr].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
      for (const s of STORES) assert.deepStrictEqual(byId(mem[s]), byId(backup[s] || []), `almacén «${s}»`);

      // 2) Ya en Hoy (misma URL): también un solo montaje
      await page.evaluate(() => { window.__mounts = []; });
      await page.evaluate(async (t) => { await window.__app.store.importData(JSON.parse(t)); }, text);
      await settle(page);
      assert.deepStrictEqual(await page.evaluate(() => window.__mounts), ['#/today'], 'desde Hoy, también una vez');
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}
