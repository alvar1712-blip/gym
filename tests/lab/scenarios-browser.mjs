// Escenarios de NIVEL 2 (navegador): la PWA real servida en local (tests/serve.mjs) con Playwright. Cada perfil abre un
// contexto NUEVO (IndexedDB y localStorage vacíos, service worker bloqueado), restaura su historial sintético con
// store.importData (la misma vía que «Restaurar copia») y ejecuta los escenarios. Nunca se visita la app publicada.
// Reutiliza tests/e2e/helpers.cjs (waitReady, go, settle, idbAll). Motor: LAB_BROWSER=chromium (por defecto) | webkit.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateHistory, buildBackup } from './history.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const MENU = ['#/today', '#/calendar', '#/progress', '#/exercises', '#/settings'];

const TABS = {
  id: 'B02', area: 'UX y accesibilidad', title: 'Las 5 pestañas montan sin errores y sin scroll horizontal con el tamaño de pantalla y texto del perfil',
  async run({ page, H, errors, profile }) {
    const out = [];
    for (const hash of MENU) {
      const before = errors.length;
      await H.go(page, hash);
      // Se compara con el ancho CONFIGURADO del perfil: Chromium en modo móvil ensancha innerWidth cuando algo desborda y lo oculta
      const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth }));
      if (ov.sw > profile.viewport.w + 1) out.push(`${hash}: el contenido mide ${ov.sw}px en una pantalla de ${profile.viewport.w}px (texto ×${profile.a11y.textScale})`);
      if (errors.length > before) out.push(`${hash}: ${errors.slice(before).join(' | ').slice(0, 200)}`);
    }
    return out;
  },
};

export const BROWSER_SCENARIOS = [
  { id: 'B01', area: 'Almacenamiento', title: 'El historial restaurado persiste en IndexedDB y sobrevive a una recarga',
    async run({ page, H, h, errors }) {
      const out = [];
      for (const phase of ['tras restaurar', 'tras recargar']) {
        if (phase === 'tras recargar') await H.reload(page);
        for (const s of ['sessions', 'bodyweight', 'checkins', 'goals', 'races']) {
          const n = (await H.idbAll(page, s)).length;
          if (n !== h[s].length) out.push(`${phase}: ${s} tiene ${n}, esperado ${h[s].length}`);
        }
      }
      if (errors.length) out.push(`errores de consola: ${errors.slice(0, 2).join(' | ').slice(0, 200)}`);
      return out;
    } },
  TABS,
  { id: 'B03', area: 'Almacenamiento', title: 'Exportar → comprobar → restaurar conserva todo; una copia alterada se rechaza y queda punto de restauración',
    async run({ page, h }) {
      return page.evaluate(async (expected) => {
        const out = [];
        const { store } = window.__app;
        const bk = await import('./js/backup.js');
        const { text } = bk.buildBackupFile(store.exportData());
        const p = bk.parseBackupText(text, store.validateBackup);
        if (!p.ok) return [`la copia propia no se acepta: ${p.error}`];
        if (bk.verifyBackupIntegrity(p.backup).status !== 'verified') out.push('copia propia sin sello verificado');
        const tampered = JSON.parse(text);
        const s = tampered.data.sessions[0];
        if (s) { s.notes = `${s.notes || ''}x`; try { await store.importData(tampered); out.push('importData ACEPTÓ una copia con sello alterado'); } catch { /* esperado */ } }
        if (store.all('sessions').length !== expected) out.push(`tras rechazar la copia alterada hay ${store.all('sessions').length} sesiones, esperado ${expected}`);
        await store.importData(p.backup, { owned: true });
        if (store.all('sessions').length !== expected) out.push(`tras restaurar hay ${store.all('sessions').length} sesiones, esperado ${expected}`);
        const rp = await import('./js/db.js').then((d) => d.get('meta', '~restorePoint'));
        if (!rp) out.push('no hay punto de restauración tras sustituir datos');
        return out;
      }, h.sessions.length);
    } },
  { id: 'B04', area: 'Fuerza', title: 'Sesión abierta: las series hechas y la sesión sobreviven a recargar; al terminar queda guardada y ya no hay sesión activa',
    async run({ page, H, h }) {
      const out = [];
      const id = await page.evaluate(async () => {
        const sl = await import('./js/session-logic.js');
        const s = await sl.createStrengthSession({ templateId: 'tpl_d1' });
        for (const set of s.exercises[0].sets.slice(0, 2)) { set.weight = set.weight ?? 50; set.reps = set.reps ?? 8; set.rir = 2; set.done = true; set.doneAt = Date.now(); }
        await window.__app.store.save('sessions', s);
        return s.id;
      });
      await H.reload(page);
      const hash = await page.evaluate(() => location.hash);
      if (!hash.startsWith('#/session/')) out.push(`tras recargar con sesión abierta la app está en ${hash}, no en la sesión`);
      const disk = (await H.idbAll(page, 'sessions')).find((s) => s.id === id);
      if (!disk) return [...out, 'la sesión abierta no está en IndexedDB'];
      if (disk.exercises[0].sets.filter((x) => x.done).length !== 2) out.push('las series hechas no sobreviven a la recarga');
      const left = await page.evaluate(async (sid) => {
        const sl = await import('./js/session-logic.js');
        const { store } = window.__app;
        const s = JSON.parse(JSON.stringify(store.get('sessions', sid)));
        sl.finishSession(s, { durationMin: 50, rpe: 7 });
        await store.save('sessions', s);
        return { active: store.activeSession()?.id ?? null };
      }, id);
      if (left.active) out.push(`tras terminar sigue habiendo sesión activa (${left.active})`);
      await H.reload(page);
      const done = (await H.idbAll(page, 'sessions')).filter((s) => s.id === id && s.status === 'done');
      if (done.length !== 1) out.push('la sesión terminada no persiste tras recargar');
      if ((await H.idbAll(page, 'sessions')).length !== h.sessions.length + 1) out.push('el número de sesiones guardadas no cuadra');
      return out;
    } },
  { id: 'B05', area: 'Casos límite', title: 'Si IndexedDB falla al guardar, la app avisa y la memoria no muestra datos que no están en disco', only: (p) => p.id === 'p01-adolescente-baloncesto' || p.id === 'p09-veterano-5-anios',
    async run({ page, H }) {
      const out = [];
      await page.evaluate(() => {
        window.__origPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function () { throw new DOMException('simulado por Entreno Lab', 'QuotaExceededError'); };
      });
      const r = await page.evaluate(async () => {
        const { store } = window.__app;
        const u = await import('./js/util.js');
        const rec = { id: u.todayStr(), kg: 71.3 };
        let rejected = false;
        try { await store.save('bodyweight', rec); } catch { rejected = true; }
        await new Promise((res) => setTimeout(res, 150));
        const toast = [...document.querySelectorAll('[role="status"],[role="alert"],.toast')].map((e) => e.textContent).join(' ').trim();
        return { rejected, inMemory: store.all('bodyweight').some((b) => b.id === rec.id && b.kg === 71.3), toast };
      });
      await page.evaluate(() => { IDBObjectStore.prototype.put = window.__origPut; });
      const onDisk = (await H.idbAll(page, 'bodyweight')).some((b) => b.kg === 71.3);
      if (!r.rejected) out.push('store.save no rechazó la promesa cuando IndexedDB falló');
      if (!/No se pudo guardar/.test(r.toast)) out.push(`no se vio el aviso de error (texto visible: «${r.toast.slice(0, 80)}»)`);
      if (r.inMemory && !onDisk) out.push('el peso 71,3 kg figura en memoria (y por tanto en pantalla) pero NO está en disco: desaparecerá al recargar');
      return out;
    } },
  { id: 'B06', area: 'UX y accesibilidad', title: 'Navegación con teclado: cada Tab lleva a un elemento visible con indicador de foco', only: (p) => p.a11y.keyboard,
    async run({ page, H }) {
      await H.go(page, '#/today');
      const bad = [];
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(400); // el navegador desplaza el foco a la vista con animación: se mide cuando termina
        const f = await page.evaluate(() => {
          const e = document.activeElement; if (!e || e === document.body) return null;
          const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
          return { tag: e.tagName, label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight,
            ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' };
        });
        if (f && (!f.visible || !f.ring)) bad.push(`${f.tag} «${f.label}» ${!f.visible ? 'fuera de pantalla' : 'sin indicador de foco'}`);
      }
      return bad.length ? [`${bad.length} paradas de Tab problemáticas de 25: ${[...new Set(bad)].slice(0, 4).join('; ')}`] : [];
    } },
  { id: 'B07', area: 'UX y accesibilidad', title: 'Con «reducir movimiento» no quedan animaciones en bucle en Hoy', only: (p) => p.a11y.reducedMotion,
    async run({ page, H }) {
      await H.go(page, '#/today');
      await page.waitForTimeout(800);
      const loops = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity).map((a) => a.animationName || a.transitionProperty || a.constructor.name));
      return loops.length ? [`${loops.length} animaciones infinitas activas: ${[...new Set(loops)].join(', ')}`] : [];
    } },
  { id: 'B08', area: 'Casos límite', title: 'Zona horaria distinta (viaje): «hoy» es la fecha local y las fechas guardadas no se desplazan', only: (p) => p.tz && p.tz !== 'Europe/Madrid',
    async run({ page, h, profile, H }) {
      const out = [];
      const today = await page.evaluate(async () => (await import('./js/util.js')).todayStr());
      const expected = new Intl.DateTimeFormat('en-CA', { timeZone: profile.tz }).format(new Date());
      if (today !== expected) out.push(`todayStr()=${today}, fecha local en ${profile.tz}=${expected}`);
      const ids = new Set(h.sessions.map((s) => s.id)); // solo las del historial: B04 ya pudo añadir una sesión de hoy
      const dates = (await H.idbAll(page, 'sessions')).filter((s) => ids.has(s.id)).map((s) => s.date).sort().join();
      if (dates !== h.sessions.map((s) => s.date).sort().join()) out.push('las fechas de las sesiones cambian al abrir en otro huso');
      return out;
    } },
  { id: 'B09', area: 'UX y accesibilidad', title: 'Controles táctiles de al menos 44×44 px en Hoy, Calendario y Progreso', only: (p) => ['p01-adolescente-baloncesto', 'p08-mayor-75-simple', 'p18-baja-vision'].includes(p.id),
    async run({ page, H }) {
      const out = [];
      for (const hash of ['#/today', '#/calendar', '#/progress']) {
        await H.go(page, hash);
        const small = await page.evaluate(() => [...document.querySelectorAll('button, a[href], [role="button"], input:not([type=hidden]), select')].map((e) => ({ e, r: e.getBoundingClientRect() }))
          .filter(({ r, e }) => r.width > 0 && r.height > 0 && Math.min(r.width, r.height) < 44 && getComputedStyle(e).visibility !== 'hidden')
          .map(({ e, r }) => `${e.tagName.toLowerCase()}«${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20)}» ${Math.round(r.width)}×${Math.round(r.height)}`));
        if (small.length) out.push(`${hash}: ${small.length} controles < 44 px, p. ej. ${small.slice(0, 3).join('; ')}`);
      }
      return out;
    } },
];

export async function runBrowserScenarios({ profiles, seed, results }) {
  const pw = require('playwright');
  const H = require('../e2e/helpers.cjs');
  const name = process.env.LAB_BROWSER === 'webkit' ? 'webkit' : 'chromium';
  if (!H.engineAvailable(name)) return { skipped: `el navegador ${name} de Playwright no está instalado (npx playwright install ${name})` };
  const { startServer } = await import(pathToFileURL(path.join(here, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await pw[name].launch();
  try {
    for (const p of profiles) {
      const h = generateHistory(p, { seed });
      const backup = buildBackup(h);
      const context = await browser.newContext({ ...pw.devices['iPhone 13'], viewport: { width: p.viewport.w, height: p.viewport.h }, locale: 'es-ES', timezoneId: p.tz || 'Europe/Madrid', serviceWorkers: 'block', reducedMotion: p.a11y.reducedMotion ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
      let setupError = null;
      try {
        await page.goto(`${server.url}tests/fixtures/blank.html`);
        if (p.a11y.textScale > 1) await page.evaluate((s) => localStorage.setItem('entreno.textScale', String(s)), p.a11y.textScale);
        await page.goto(server.url);
        await H.waitReady(page);
        await page.evaluate(async (b) => { await window.__app.store.importData(b, { owned: true }); }, backup);
        await H.reload(page, { timeout: 60000 }).catch(() => H.waitReady(page, { timeout: 60000 }));
        errors.length = 0;
      } catch (e) { setupError = e.message.split('\n')[0]; }
      for (const sc of BROWSER_SCENARIOS) {
        if (sc.only && !sc.only(p)) continue;
        const t0 = performance.now();
        let failures;
        try { failures = setupError ? [`No se pudo preparar el perfil: ${setupError}`] : await sc.run({ page, H, h, profile: p, errors }); }
        catch (e) { failures = [`El escenario lanzó una excepción: ${e.message.split('\n')[0]}`]; }
        results.push({ scenario: sc.id, area: sc.area, title: sc.title, level: 'browser', profile: p.id, ok: failures.length === 0, failures, ms: Math.round(performance.now() - t0), metrics: {} });
      }
      await context.close();
    }
  } finally { await browser.close(); await server.close(); }
  return { engine: `${name} ${browser.version?.() || ''}`.trim() };
}
