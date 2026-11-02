// «Registrar serie» no queda bajo la barra de abajo (fase 5). Causa que cubre: al desplazar más de 12 px la cabecera de la sesión
// se compactaba y crecía 19 px (layoutCompact fijaba el ancho del título al offsetWidth redondeado y la línea se partía), de modo
// que el desplazamiento calculado antes de compactar se quedaba corto. Mide geometría y pulsación real (elementFromPoint + clic
// sin desplazar) en varios tamaños, con texto ×1 y ×1,5, tras registrar series y tras «siguiente» de la barra.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openApp, go, reload } = require('./helpers.cjs');

const createSession = (page, opts) => page.evaluate(async (o) => (await (await import('./js/session-logic.js')).createStrengthSession(o)).id, opts);

const SIZES = [
  { name: '375×667 ×1', w: 375, h: 667, scale: 1 },
  { name: '375×667 ×1,5', w: 375, h: 667, scale: 1.5 },
  { name: '375×667 ×1,5 sin historial', w: 375, h: 667, scale: 1.5, noHistory: true },
  { name: '390×700 ×1', w: 390, h: 700, scale: 1 },
  { name: '390×844 ×1', w: 390, h: 844, scale: 1 },
];
const SAT = ':root{--sat:20px !important}';

async function seedHistory(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const m = await import('./js/session-logic.js');
    const { store } = window.__app;
    const s = await m.createStrengthSession({ templateId: 'tpl_d1', date: u.addDays(u.todayStr(), -7), past: true });
    for (const se of s.exercises) {
      const lt = store.exercise(se.exerciseId).logType;
      se.sets.forEach((x, i) => Object.assign(x, { weight: lt === 'bodyweight' ? 5 : 40, reps: (se.target.repMax || 8) - i, rir: 1, done: true, doneAt: 1 }));
    }
    m.finishSession(s, { durationMin: 60, rpe: 7 });
    await store.save('sessions', s);
  });
}

/** Geometría del botón «Registrar» del editor abierto frente a la cabecera y la barra, y si un toque real lo alcanza. */
const geo = (page) => page.evaluate(() => {
  const b = document.querySelector('.ses-editor[data-state="editing"] .ses-register');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const hdr = document.querySelector('.topbar').getBoundingClientRect().bottom;
  const tab = document.getElementById('tabbar').getBoundingClientRect().top;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const hitLow = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
  return { label: b.textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), hdr: Math.round(hdr), tab: Math.round(tab), tappable: b.contains(hit) && b.contains(hitLow), whole: r.top >= hdr - 1 && r.bottom <= tab - 1 };
});

for (const size of SIZES) {
  test(`«Registrar serie» entero y tocable tras cada serie y tras «siguiente» · ${size.name}`, async () => {
    const app = await openApp();
    const { page } = app;
    try {
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.addStyleTag({ content: SAT });
      if (size.scale !== 1) {
        await page.evaluate((s) => localStorage.setItem('entreno.textScale', String(s)), size.scale);
        await reload(page);
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.addStyleTag({ content: SAT });
      }
      if (!size.noHistory) await seedHistory(page);
      const id = await createSession(page, { templateId: 'tpl_d1' });
      await go(page, `#/session/${id}`);
      await page.waitForSelector('.ses-card');
      // A ×1,5 el botón de la serie 1 queda al abrir bajo el pliegue: «siguiente» de la barra lo trae a la vista
      { // Fase 7: el editor de la serie (regla de peso y de repeticiones) es alto: al abrir, «Registrar» queda bajo el pliegue; «siguiente» de la barra lo trae
        await page.locator('#tabbar .fb-next').first().click();
        await page.waitForTimeout(2000);
      }
      const misses = [];
      for (let i = 0; i < 6; i++) {
        const g = await geo(page);
        assert.ok(g, 'hay un editor abierto');
        if (!g.whole || !g.tappable) misses.push(`${g.label}: ${g.top}-${g.bottom} (cabecera ${g.hdr}, barra ${g.tab}, tocable ${g.tappable})`);
        await page.locator('.ses-editor[data-state="editing"] .ses-register').first().click({ timeout: 3000 }); // sin desplazar a mano: falla si lo tapa algo
        await page.waitForTimeout(1100);
      }
      assert.deepEqual(misses, [], `botón parcial o tapado: ${misses.join(' | ')}`);
    } finally {
      await app.close();
    }
  });
}
