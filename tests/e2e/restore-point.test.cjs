// E2E del punto de restauración (ronda 8, B3; docs/PULIDO.md §22): antes de importar una copia o de «Borrar todo» se
// guarda en el dispositivo lo que hay, se relee y se comprueba; si no se puede, no se destruye nada. «Recuperar el
// estado anterior» lo restaura (doble confirmación) y deja lo de ahora como nuevo punto.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/restore-point.test.cjs  (también WebKit, si está instalado)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { openApp, go, reload, idbAll, shot, engineAvailable } = require('./helpers.cjs');

const NOW = new Date('2026-09-23T10:00:00Z'); // 12:00 en Madrid
const STORES = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle', 'context', 'pastRecords', 'races'];
const INFO = '~restorePoint';
const DATA = '~restorePoint:data';

const byId = (arr) => [...arr].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
const sheetPanel = (page) => page.locator('.sheet-overlay.open .sheet-panel').last();
const sheetBtn = (page, text) => sheetPanel(page).locator('button', { hasText: text });
const waitNoSheet = (page) => page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 5000 });
const isReserved = (o) => String(o.id).startsWith('~');

/** Todo lo de la app: en memoria (exportData) y en disco (sin los registros reservados), por almacén y por id. */
async function state(page) {
  await page.evaluate(() => window.__app.store.flush());
  const mem = await page.evaluate(() => window.__app.store.exportData().data);
  const out = { mem: {}, disk: {} };
  for (const s of STORES) {
    out.mem[s] = byId(mem[s]);
    out.disk[s] = byId((await idbAll(page, s)).filter((o) => !isReserved(o)));
  }
  return out;
}
const reservedOnDisk = async (page) => (await idbAll(page, 'meta')).filter(isReserved);
const rpData = async (page) => (await idbAll(page, 'meta')).find((o) => o.id === DATA) || null;

function assertSame(a, b, label) {
  for (const s of STORES) {
    assert.deepStrictEqual(a.mem[s], b.mem[s], `${label}: memoria «${s}»`);
    assert.deepStrictEqual(a.disk[s], b.disk[s], `${label}: disco «${s}»`);
  }
}

async function setup(browser) {
  const app = await openApp({ exampleWeek: true, browser });
  await app.page.clock.setFixedTime(NOW);
  await reload(app.page);
  return app;
}

/** Datos del usuario (variados) y ajustes cambiados. `tag` los distingue entre dos estados. */
async function seed(page, tag = 'a', n = 3) {
  await page.evaluate(async ({ tag, n }) => {
    const st = window.__app.store;
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      await st.save('sessions', { id: `act_${tag}${i}`, kind: 'run', date: `2026-09-${String(10 + i).padStart(2, '0')}`, planDate: null, status: 'done',
        subtype: 'z2', distanceKm: 8 + i, movingSec: 2700 + i * 60, durationMin: 45 + i, rpe: 5, notes: `Rodaje ${tag}`, parentId: null, startedAt: now, endedAt: now });
    }
    await st.save('bodyweight', { id: '2026-09-20', kg: tag === 'a' ? 75.4 : 70.1 });
    await st.save('exercises', { id: `ex_${tag}`, name: `Ejercicio propio ${tag}`, aliases: [], primary: ['back'], secondary: [], pattern: 'pull_h', logType: 'weight_reps', category: 'compound', region: 'upper', notes: '', custom: true, archived: false });
    await st.save('context', { id: `ctx_${tag}`, kind: 'event', type: 'other', date: '2026-09-15', title: `Hecho ${tag}` });
    const s = st.settings();
    s.secondaryFactor = tag === 'a' ? 0.75 : 0.6;
    await st.save('meta', s);
  }, { tag, n });
}

async function wipeViaUI(page) {
  await go(page, '#/settings/data');
  await page.locator('.cfg-wipe').click();
  await sheetBtn(page, 'Continuar').click();
  await page.waitForFunction(() => document.querySelector('.sheet-overlay.open input'));
  await sheetPanel(page).locator('input').fill('BORRAR');
  await sheetBtn(page, 'Borrar todo').click();
}

async function recoverViaUI(page) {
  await go(page, '#/settings/data');
  await page.locator('.cfg-rp-recover').click();
  await sheetBtn(page, 'Continuar').click();
  await page.waitForFunction(() => document.querySelector('.sheet-overlay.open .sheet-title')?.textContent === 'Confirmación final');
  await sheetBtn(page, 'Recuperar').click();
}

async function importViaUI(page, obj) {
  await go(page, '#/settings/data');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-import').click()]);
  await fc.setFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj), 'utf8') });
  await sheetPanel(page).waitFor();
}

const browsers = ['chromium', ...(engineAvailable('webkit') ? ['webkit'] : [])];

for (const browser of browsers) {
  test(`${browser}: borrar todo — cancelar no guarda nada; borrar guarda el punto; recuperar deja todo IDÉNTICO`, async () => {
    const app = await setup(browser);
    const { page } = app;
    try {
      await seed(page, 'a');
      const before = await state(page);
      await go(page, '#/settings/data');
      assert.ok(await page.locator('.cfg-rp').isHidden(), 'sin punto de restauración, no hay tarjeta');

      // Cancelar en la 1.ª y en la 2.ª confirmación: ni datos borrados ni punto de restauración.
      await page.locator('.cfg-wipe').click();
      const msg = await sheetPanel(page).innerText();
      assert.match(msg, /punto de restauración/);
      assert.match(msg, /Solo vive en este iPhone/);
      assert.match(msg, /se borran los datos del sitio, también se pierde/);
      assert.match(msg, /exporta una copia/i);
      await shot(page, `restore-wipe-guard-${browser}`);
      await sheetBtn(page, 'Cancelar').click();
      await waitNoSheet(page);
      await page.locator('.cfg-wipe').click();
      await sheetBtn(page, 'Continuar').click();
      await page.waitForFunction(() => document.querySelector('.sheet-overlay.open input'));
      assert.ok(await sheetBtn(page, 'Borrar todo').isDisabled(), 'sin escribir BORRAR no se puede');
      await sheetBtn(page, 'Cancelar').click();
      await waitNoSheet(page);
      assertSame(await state(page), before, 'tras cancelar');
      assert.deepStrictEqual(await reservedOnDisk(page), [], 'cancelar no crea punto de restauración');

      // Borrar: el punto contiene lo de antes, entero.
      await wipeViaUI(page);
      await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 0, null, { timeout: 5000 });
      const rp = await rpData(page);
      assert.ok(rp, 'hay punto de restauración en disco');
      for (const s of STORES) assert.deepStrictEqual(byId(rp.backup.data[s]), before.disk[s], `punto = lo de antes: «${s}»`);
      const info = (await idbAll(page, 'meta')).find((o) => o.id === INFO);
      assert.strictEqual(info.reason, 'wipe');
      assert.strictEqual(info.counts.sessions, 3);

      // El punto no viaja en las copias ni está en memoria.
      const exported = await page.evaluate(() => window.__app.store.exportData());
      assert.ok(!exported.data.meta.some(isReservedIn), 'la copia no lleva el punto');
      await go(page, '#/settings/data');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.cfg-export').click()]);
      const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
      assert.deepStrictEqual(file.data.meta.map((m) => m.id).sort(), ['app', 'settings']);

      // Tarjeta con fecha, motivo, recuentos y la advertencia honesta.
      await page.locator('.cfg-rp').waitFor();
      const card = await page.locator('.cfg-rp').innerText();
      assert.match(card, /Punto de restauración/);
      assert.match(card, /23 sep 2026, 12:00/);
      assert.match(card, /Antes de borrar todo/);
      assert.match(card, /3 actividades/);
      assert.match(card, /solo en este iPhone/);
      assert.match(card, /no sustituye a una copia exportada/);
      await page.locator('.cfg-rp').scrollIntoViewIfNeeded();
      await shot(page, `restore-card-${browser}`);

      // Recuperar (doble confirmación): todo idéntico, también tras recargar. Lo de ahora no tenía datos: el punto se consume.
      await recoverViaUI(page);
      await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 3, null, { timeout: 5000 });
      assertSame(await state(page), before, 'tras recuperar');
      assert.deepStrictEqual(await reservedOnDisk(page), [], 'sin datos que conservar, el punto se consume');
      await reload(page);
      assertSame(await state(page), before, 'tras recuperar y recargar');
      await go(page, '#/settings/data');
      assert.ok(await page.locator('.cfg-rp').isHidden());
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });

  test(`${browser}: importar — punto de restauración, recuperar y volver (intercambio)`, async () => {
    const app = await setup(browser);
    const { page } = app;
    try {
      await seed(page, 'a');
      const stateA = await state(page);
      // Copia B: otros datos. Trae además un registro reservado plantado: no debe entrar.
      const backupB = await page.evaluate(() => {
        const o = window.__app.store.exportData();
        o.data.sessions = o.data.sessions.slice(0, 1).map((s) => ({ ...s, id: 'act_b0', notes: 'Rodaje b' }));
        o.data.bodyweight = [{ id: '2026-09-20', kg: 70.1 }];
        o.data.meta.push({ id: '~restorePoint', createdAt: 1, reason: 'wipe', counts: {} });
        return o;
      });
      await importViaUI(page, backupB);
      const msg = await sheetPanel(page).innerText();
      assert.match(msg, /SUSTITUYE/);
      assert.match(msg, /punto de restauración con lo de ahora/);
      await shot(page, `restore-import-guard-${browser}`);
      await sheetBtn(page, 'Sustituir todo').click();
      await page.waitForFunction(() => window.__app.store.count('sessions') === 1, null, { timeout: 5000 });
      const stateB = await state(page);
      assert.strictEqual(stateB.mem.sessions[0].id, 'act_b0');
      const info = (await idbAll(page, 'meta')).find((o) => o.id === INFO);
      assert.strictEqual(info.reason, 'import', 'la copia no puede plantar su propio punto');
      assert.strictEqual(info.counts.sessions, 3);

      // Recuperar → A idéntico; B pasa a ser el punto (motivo «recuperar»).
      await recoverViaUI(page);
      await page.waitForFunction(() => window.__app.store.count('sessions') === 3, null, { timeout: 5000 });
      assertSame(await state(page), stateA, 'recuperado A');
      const rp = await rpData(page);
      for (const s of STORES) assert.deepStrictEqual(byId(rp.backup.data[s]), stateB.disk[s], `el nuevo punto es B: «${s}»`);
      await go(page, '#/settings/data');
      await page.locator('.cfg-rp').waitFor();
      assert.match(await page.locator('.cfg-rp-reason').innerText(), /Antes de recuperar el estado anterior/);

      // Y volver: B idéntico.
      await recoverViaUI(page);
      await page.waitForFunction(() => window.__app.store.count('sessions') === 1, null, { timeout: 5000 });
      assertSame(await state(page), stateB, 'vuelta a B');
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });

  test(`${browser}: si el punto no se puede guardar (sin espacio) o no coincide al releerlo, NO se borra ni se importa nada`, async () => {
    const app = await setup(browser);
    const { page } = app;
    try {
      await seed(page, 'a');
      const before = await state(page);
      // Sin espacio: cualquier escritura de un registro reservado falla con QuotaExceededError.
      await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        window.__failRp = true;
        IDBObjectStore.prototype.put = function (v, ...rest) {
          if (window.__failRp && v && String(v.id).startsWith('~')) throw new DOMException('Sin espacio', 'QuotaExceededError');
          return put.call(this, v, ...rest);
        };
      });
      await wipeViaUI(page);
      await page.locator('.cfg-rp-error').waitFor();
      const err = await page.locator('.cfg-rp-error').innerText();
      assert.match(err, /No se ha borrado nada/);
      assert.match(err, /No hay espacio libre suficiente/);
      assert.match(err, /Tus datos siguen intactos/);
      await shot(page, `restore-error-${browser}`);
      await sheetBtn(page, 'Entendido').click();
      await waitNoSheet(page);
      assertSame(await state(page), before, 'sin espacio: borrar');
      assert.deepStrictEqual(await reservedOnDisk(page), []);

      const backup = await page.evaluate(() => { const o = window.__app.store.exportData(); o.data.sessions = []; return o; });
      await importViaUI(page, backup);
      await sheetBtn(page, 'Sustituir todo').click();
      await page.locator('.cfg-rp-error').waitFor();
      assert.match(await page.locator('.cfg-rp-error').innerText(), /No se ha importado nada/);
      await sheetBtn(page, 'Entendido').click();
      await waitNoSheet(page);
      assertSame(await state(page), before, 'sin espacio: importar');

      // Se guarda, pero al releerlo no coincide (disco que devuelve otra cosa): tampoco se borra, y no queda punto.
      await page.evaluate(() => {
        window.__failRp = false;
        const desc = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result');
        Object.defineProperty(IDBRequest.prototype, 'result', {
          configurable: true,
          get() {
            const r = desc.get.call(this);
            if (r && r.id === '~restorePoint:data') return { ...r, backup: { ...r.backup, data: { ...r.backup.data, sessions: [] } } };
            return r;
          },
        });
      });
      const res = await page.evaluate(async () => {
        try { await window.__app.store.wipeAll(); return 'borrado'; } catch (e) { return `${e.name}:${e.reason}`; }
      });
      assert.strictEqual(res, 'RestorePointError:verify');
      assertSame(await state(page), before, 'verificación fallida');
      assert.deepStrictEqual(await reservedOnDisk(page), [], 'un punto que no coincide no se ofrece');
      assert.deepStrictEqual(app.errors.filter((e) => !/Sin espacio|QuotaExceeded|reintentando/.test(e)), []);
    } finally {
      await app.close();
    }
  });
}

test('exportar antes desde la confirmación: se comparte la copia y solo entonces sigue (cancelar compartir no sigue)', async () => {
  const app = await setup('chromium');
  const { page } = app;
  try {
    await seed(page, 'a');
    const before = await state(page);
    await go(page, '#/settings/data');
    await page.evaluate(() => {
      window.__shared = [];
      window.__shareMode = 'abort';
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async ({ files }) => {
          if (window.__shareMode === 'abort') throw new DOMException('cancelado', 'AbortError');
          for (const f of files) window.__shared.push({ name: f.name, text: await f.text() });
        },
      });
    });
    // Cancelar la hoja de compartir: no se sigue.
    await page.locator('.cfg-wipe').click();
    await sheetBtn(page, 'Exportar copia antes').click();
    await waitNoSheet(page);
    assert.strictEqual(await page.locator('.sheet-overlay').count(), 0, 'sin copia, no pasa a la confirmación final');
    // Compartir: la copia se guarda (sin el punto) y pasa a la confirmación final (escribir BORRAR).
    await page.evaluate(() => { window.__shareMode = 'ok'; });
    await page.locator('.cfg-wipe').click();
    await sheetBtn(page, 'Exportar copia antes').click();
    await page.waitForFunction(() => document.querySelector('.sheet-overlay.open input'));
    const [f] = await page.evaluate(() => window.__shared);
    assert.match(f.name, /^entreno-copia-2026-09-23-1200\.json$/);
    const file = JSON.parse(f.text);
    assert.strictEqual(file.data.sessions.length, 3);
    assert.ok(!file.data.meta.some((m) => String(m.id).startsWith('~')));
    assert.strictEqual(await page.evaluate(() => window.__app.store.settings().lastBackupAt), NOW.getTime());
    await sheetBtn(page, 'Cancelar').click();
    await waitNoSheet(page);
    const after = await state(page);
    for (const s of STORES.filter((x) => x !== 'meta')) assert.deepStrictEqual(after.mem[s], before.mem[s]);
    assert.deepStrictEqual(await reservedOnDisk(page), []);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('sin datos que proteger, borrar otra vez conserva el punto; «Eliminar» lo quita del dispositivo', async () => {
  const app = await setup('chromium');
  const { page } = app;
  try {
    await seed(page, 'a');
    await wipeViaUI(page);
    await page.waitForFunction(() => window.__app.store.count('sessions') === 0, null, { timeout: 5000 });
    const first = await rpData(page);
    await page.clock.setFixedTime(new Date(NOW.getTime() + 3600000));
    await go(page, '#/settings/data');
    await page.locator('.cfg-wipe').click();
    assert.match(await sheetPanel(page).innerText(), /se conserva el punto de restauración del 23 sep 2026, 12:00/);
    await sheetBtn(page, 'Cancelar').click();
    await waitNoSheet(page);
    await wipeViaUI(page);
    await page.waitForFunction(() => location.hash === '#/today');
    await page.evaluate(() => window.__app.store.flush());
    const second = await rpData(page);
    assert.strictEqual(second.createdAt, first.createdAt, 'el punto con los datos de verdad sigue ahí');
    assert.strictEqual(second.backup.data.sessions.length, 3);

    await go(page, '#/settings/data');
    await page.locator('.cfg-rp-discard').click();
    await sheetBtn(page, 'Eliminar').click();
    await page.locator('.cfg-rp').waitFor({ state: 'hidden' });
    assert.deepStrictEqual(await reservedOnDisk(page), []);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('rutinas, perfil y semana sin entrenos aún también se protegen; lo recién instalado, no', async () => {
  // Regresión (revisión B3): hasDataToProtect solo miraba registros y ejercicios propios, así que alguien que había
  // preparado sus rutinas, su perfil y su semana pero no había entrenado perdía todo al borrar o importar, sin punto.
  const app = await openApp({ browser: 'chromium' });
  const { page } = app;
  try {
    await page.clock.setFixedTime(NOW);
    await reload(page);
    assert.strictEqual(await page.evaluate(() => window.__app.store.hasDataToProtect()), false, 'recién instalada: nada que proteger');
    const variants = {
      // una rutina propia
      template: async () => { const st = window.__app.store; await st.save('templates', { id: 'tpl_mine', name: 'Mi rutina', order: 9, notes: '', archived: false, items: [] }); },
      // una rutina inicial editada
      edited: async () => { const st = window.__app.store; const t = st.all('templates')[0]; t.notes = 'cambiada'; await st.save('templates', t); },
      // una rutina inicial borrada
      removed: async () => { const st = window.__app.store; await st.remove('templates', st.all('templates')[0].id); },
      // un ejercicio inicial editado
      exercise: async () => { const st = window.__app.store; const e = st.all('exercises')[0]; e.notes = 'mi nota'; await st.save('exercises', e); },
      // la semana tipo
      week: async () => { const { exampleWeekPatterns } = await import('./js/seed.js'); await window.__app.store.saveSettings({ weekPatterns: exampleWeekPatterns() }); },
      // el perfil
      profile: async () => { const st = window.__app.store; const s = st.settings(); s.profile = { ...(s.profile || {}), sex: 'female', birthDate: '1990-05-01' }; await st.save('meta', s); },
    };
    for (const [name, fn] of Object.entries(variants)) {
      await page.evaluate(`(${fn})()`);
      assert.strictEqual(await page.evaluate(() => window.__app.store.hasDataToProtect()), true, `${name}: hay algo que proteger`);
      await page.evaluate(() => window.__app.store.wipeAll());
      assert.strictEqual(await page.evaluate(() => window.__app.store.hasDataToProtect()), false, `${name}: tras borrar vuelve a estar recién instalada`);
      assert.ok(await rpData(page), `${name}: se guardó un punto de restauración`);
      await page.evaluate(() => window.__app.store.discardRestorePoint());
    }
    // Tras borrar y volver a abrir (la carga inicial migra), sigue sin haber nada que proteger
    await reload(page);
    assert.strictEqual(await page.evaluate(() => window.__app.store.hasDataToProtect()), false, 'recién borrada y reabierta: nada que proteger');
    // Ajustes técnicos que se guardan solos (fecha de la última copia, avisos descartados) no cuentan: pisarían el punto
    await page.evaluate(async () => { const st = window.__app.store; const s = st.settings(); s.lastBackupAt = Date.now(); s.profile = { ...(s.profile || {}), promptDismissed: true }; await st.save('meta', s); });
    assert.strictEqual(await page.evaluate(() => window.__app.store.hasDataToProtect()), false, 'la fecha de la copia o un aviso descartado no son datos tuyos');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

function isReservedIn(m) { return String(m.id).startsWith('~'); }
