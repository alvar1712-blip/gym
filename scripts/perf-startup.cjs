// Mide el arranque de la app (pantalla Hoy) con historiales realistas de distinta longitud.
// Uso: npm run perf [-- --sets=3m,1y,2y,5y --runs=5 --cpu=4]
// Para cada historial: siembra los datos, abre la app `runs`+1 veces (la primera no cuenta) con la CPU frenada `cpu`
// veces (Chromium) y da la mediana de:
//   hoy     ms hasta que «Te toca hoy» está en pantalla
//   listo   ms hasta que las tarjetas del final de Hoy están completas (.today-extra[data-ready])
//   bloqTot suma de tareas largas (> 50 ms) durante el arranque
//   bloqMax tarea larga más larga (lo que se nota como «la pantalla no responde»)
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const SETS = (args.sets || '3m,1y,2y,5y').split(',');
const RUNS = Number(args.runs || 5);
const CPU = Number(args.cpu || 4);
const MONTHS = { '3m': 3, '1y': 12, '2y': 24, '5y': 60 };

/** Siembra `months` meses de historial: fuerza 4 días/semana, carrera, bici, pesajes diarios, check-ins, ciclo. */
function seed(page, months) {
  return page.evaluate(async (months) => {
    const db = await import('./js/db.js');
    const util = await import('./js/util.js');
    const { store } = window.__app;
    const templates = store.all('templates');
    const ex = new Map(store.all('exercises').map((e) => [e.id, e]));
    const today = util.todayStr();
    const start = util.addDays(today, -Math.round(months * 30.4));
    const sessions = []; const bodyweight = []; const checkins = []; const cycle = [];
    let n = 0; let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const tplByDow = { 0: 'tpl_d1', 1: 'tpl_d2', 3: 'tpl_d4', 5: 'tpl_d6' };
    let kg = 80;
    for (let d = start, i = 0; d < today; d = util.addDays(d, 1), i++) {
      const dow = util.dow(d);
      const base = util.tsFromDate(d, 18);
      kg += (rnd() - 0.52) * 0.25;
      bodyweight.push({ id: d, kg: Math.round(kg * 10) / 10, createdAt: base, updatedAt: base });
      const t = templates.find((x) => x.id === tplByDow[dow]);
      if (t && rnd() < 0.9) {
        const id = `perf_s${n++}`;
        const exercises = t.items.map((it, k) => {
          const e = ex.get(it.exerciseId);
          const sets = [];
          if (e && e.logType !== 'cardio') {
            for (let j = 0; j < (it.sets || 3); j++) {
              const loaded = e.logType === 'weight_reps' || e.logType === 'unilateral';
              sets.push({ id: `${id}_${k}_${j}`, type: 'effective', weight: loaded ? Math.round((40 * (1 + (i / 365) * 0.15) * (0.9 + rnd() * 0.2)) / 2.5) * 2.5 : null,
                reps: (it.repMin || 8) + Math.floor(rnd() * 3), repsR: e.logType === 'unilateral' ? 8 : null, rir: Math.floor(rnd() * 3),
                timeSec: e.logType === 'time' ? 40 : null, distanceM: e.logType === 'distance_time' ? 30 : null, heightCm: null, note: '', done: true, doneAt: base + j * 120e3 });
            }
          }
          return { id: `${id}_se${k}`, exerciseId: it.exerciseId, exName: e?.name || '?', templateItemId: it.id, alternatives: [],
            target: { sets: it.sets, repMin: it.repMin, repMax: it.repMax }, notes: '', section: it.section || '', groupId: it.groupId, groupType: it.groupType, sets };
        });
        sessions.push({ id, kind: 'strength', date: d, planDate: d, templateId: t.id, templateName: t.name, status: 'done', startedAt: base, endedAt: base + 70 * 60e3,
          durationMin: 70, rpe: 7 + Math.floor(rnd() * 2), notes: '', parentId: null, templateItemId: null, createdAt: base, updatedAt: base, exercises, cursor: 0,
          templateItemIds: t.items.map((x) => x.id) });
        for (const timing of ['pre', 'post']) {
          checkins.push({ id: `perf_c${n++}`, date: d, timing, sessionId: id, sleep: 1 + Math.floor(rnd() * 3), energy: 1 + Math.floor(rnd() * 3), soreness: 1 + Math.floor(rnd() * 3), createdAt: base, updatedAt: base });
        }
      }
      if (dow === 2 || dow === 6) {
        const km = dow === 6 ? 12 + rnd() * 6 : 6 + rnd() * 3; const sec = Math.round(km * (300 + rnd() * 40));
        sessions.push({ id: `perf_a${n++}`, kind: 'run', date: d, planDate: d, templateId: null, templateName: '', status: 'done', startedAt: base, endedAt: base + sec * 1000,
          durationMin: sec / 60, rpe: 6, notes: '', parentId: null, templateItemId: null, createdAt: base, updatedAt: base, distanceKm: Math.round(km * 100) / 100,
          movingSec: sec, elapsedSec: sec + 60, elevationM: 80, hrAvg: 150, hrMax: 175, subtype: dow === 6 ? 'long' : 'z2', feel: '' });
      }
      if (dow === 4) {
        const km = 30 + rnd() * 30; const sec = Math.round(km * 120);
        sessions.push({ id: `perf_a${n++}`, kind: 'bike', date: d, planDate: d, templateId: null, templateName: '', status: 'done', startedAt: base, endedAt: base + sec * 1000,
          durationMin: sec / 60, rpe: 6, notes: '', parentId: null, templateItemId: null, createdAt: base, updatedAt: base, distanceKm: Math.round(km * 100) / 100,
          movingSec: sec, elevationM: 300, hrAvg: 140, subtype: 'route', feel: '' });
      }
      if (i % 28 < 5) cycle.push({ id: d, flow: ['heavy', 'medium', 'medium', 'light', 'spotting'][i % 28], symptoms: ['cramps'], notes: '', createdAt: base, updatedAt: base });
    }
    const settings = store.settings();
    settings.profile = { ...(settings.profile || {}), sex: 'female', goal: 'gain', experience: 'intermediate', cycleTracking: true, promptDismissed: true };
    settings.lastBackupAt = Date.now();
    const now = Date.now();
    const goals = [
      { id: 'perf_g1', kind: 'strength', title: 'Banca', titleAuto: true, exerciseId: 'press_banca', weight: 80, reps: 5, createdAt: now - 90 * 864e5, updatedAt: now, achievedAt: null, archived: false },
      { id: 'perf_g2', kind: 'endurance', title: '10k', titleAuto: true, sport: 'run', distanceKm: 10, timeSec: 2700, createdAt: now - 60 * 864e5, updatedAt: now, achievedAt: null, archived: false },
      { id: 'perf_g3', kind: 'bodyweight', title: 'Peso', titleAuto: true, targetKg: 76, direction: 'down', createdAt: now - 60 * 864e5, updatedAt: now, achievedAt: null, archived: false },
    ];
    await db.putStores({ sessions, bodyweight, checkins, cycle, goals, meta: [settings] });
    return sessions.length;
  }, months);
}

const OBSERVE = () => {
  window.__perf = { marks: {}, long: [] };
  const mark = (k) => { if (!(k in window.__perf.marks)) window.__perf.marks[k] = Math.round(performance.now()); };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(Math.round(e.duration)); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* sin longtask */ }
  new MutationObserver(() => {
    if (document.querySelector('.today-plan')) mark('hoy');
    if (document.querySelector('.today-extra[data-ready="1"]')) mark('listo');
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ready'] });
};

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

(async () => {
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'tests/serve.mjs')).href);
  const server = await startServer(0);
  console.log(`Arranque de Hoy · CPU ×${CPU} · mediana de ${RUNS} aperturas (ms)`);
  console.log('historial   sesiones   hoy   listo  bloqTot  bloqMax');
  try {
    for (const set of SETS) {
      const browser = await chromium.launch();
      const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block' });
      await context.addInitScript(OBSERVE);
      const page = await context.newPage();
      page.on('pageerror', (e) => console.error('pageerror', e.message));
      await page.goto(server.url);
      await page.waitForFunction(() => document.documentElement.classList.contains('ready'));
      const count = await seed(page, MONTHS[set] ?? Number(set));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
      const runs = [];
      for (let r = 0; r <= RUNS; r++) {
        await page.reload();
        await page.waitForFunction(() => window.__perf?.marks.listo, null, { timeout: 120000 });
        await page.waitForTimeout(300);
        const p = await page.evaluate(() => window.__perf);
        if (r > 0) runs.push({ hoy: p.marks.hoy, listo: p.marks.listo, bloqTot: p.long.reduce((a, b) => a + b, 0), bloqMax: Math.max(0, ...p.long) });
      }
      const m = (k) => String(median(runs.map((x) => x[k]))).padStart(7);
      console.log(`${set.padEnd(9)} ${String(count).padStart(9)} ${m('hoy')} ${m('listo')} ${m('bloqTot')} ${m('bloqMax')}`);
      await browser.close();
    }
  } finally {
    await server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
