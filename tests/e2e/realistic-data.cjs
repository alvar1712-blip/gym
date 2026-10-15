// Datos sintéticos realistas para las pruebas visuales (ronda de pulido; docs/PULIDO.md): siembra en el navegador lo que
// genera tests/realistic-data.mjs (UNA sola fuente, la misma que la prueba cruzada de coherencia del análisis) y, si se
// pide, una sesión de fuerza en curso. Semilla fija: nada personal.
// `recovery: true` (ronda 8, F): además, estrés en los check-ins y una zona que se repite (rodilla izquierda, con una
// nota) y unas agujetas en cuádriceps; sin la opción, los datos son exactamente los de siempre (no toca el generador).
async function seedRealistic(page, { months = 6, female = true, activeSession = false, recovery = false } = {}) {
  return page.evaluate(async ({ months, female, recovery }) => {
    const db = await import('./js/db.js');
    const util = await import('./js/util.js');
    const { realisticData } = await import('./tests/realistic-data.mjs');
    const { store } = window.__app;
    // Un usuario con meses de datos tiene semana tipo: la de ejemplo (ronda 8, B2: ya no se siembra por defecto).
    const { exampleWeekPatterns } = await import('./js/seed.js');
    await store.saveSettings({ weekPatterns: exampleWeekPatterns() });
    const { profile, ...stores } = realisticData({
      months, female, recovery, today: util.todayStr(), now: Date.now(),
      templates: store.all('templates'), exercises: new Map(store.all('exercises').map((e) => [e.id, e])),
    });
    const settings = store.settings();
    settings.profile = { ...(settings.profile || {}), ...profile };
    settings.lastBackupAt = Date.now();
    await db.putStores({ ...stores, meta: [settings] });
    return stores.sessions.length;
  }, { months, female, recovery }).then(async (count) => {
    await page.reload();
    await page.waitForFunction(() => document.documentElement.classList.contains('ready'), null, { timeout: 30000 });
    let activeId = null;
    if (activeSession) {
      activeId = await page.evaluate(async () => {
        const sl = await import('./js/session-logic.js');
        const s = await sl.createStrengthSession({ templateId: 'tpl_d1' });
        // Dos series hechas en el primer ejercicio: una sesión a medias, como durante un entrenamiento
        const se = s.exercises[0];
        for (const set of se.sets.slice(0, 2)) { set.weight = set.weight ?? 60; set.reps = set.reps ?? 8; set.rir = 2; set.done = true; set.doneAt = Date.now(); }
        await window.__app.store.save('sessions', s);
        return s.id;
      });
    }
    return { count, activeId };
  });
}

module.exports = { seedRealistic };
