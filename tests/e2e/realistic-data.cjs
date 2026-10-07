// Datos sintéticos realistas para las pruebas visuales (ronda de pulido; docs/PULIDO.md): `months` meses de fuerza
// 4 días/semana con sus check-ins, carrera y bici, pesajes diarios, ciclo (modo mujer), objetivos, tu contexto (una
// fase, creatina y un resultado de carrera), una marca histórica de fuerza, un evento próximo y, si se pide, una sesión
// de fuerza en curso. Mismo generador que scripts/perf-startup.cjs (semilla fija): nada personal.
async function seedRealistic(page, { months = 6, female = true, activeSession = false } = {}) {
  return page.evaluate(async ({ months, female, activeSession }) => {
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
        const id = `rs_s${n++}`;
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
          checkins.push({ id: `rs_c${n++}`, date: d, timing, sessionId: id, sleep: 1 + Math.floor(rnd() * 3), energy: 1 + Math.floor(rnd() * 3), soreness: 1 + Math.floor(rnd() * 3), createdAt: base, updatedAt: base });
        }
      }
      if (dow === 2 || dow === 6) {
        const km = dow === 6 ? 12 + rnd() * 6 : 6 + rnd() * 3; const sec = Math.round(km * (300 + rnd() * 40));
        sessions.push({ id: `rs_a${n++}`, kind: 'run', date: d, planDate: d, templateId: null, templateName: '', status: 'done', startedAt: base, endedAt: base + sec * 1000,
          durationMin: sec / 60, rpe: 6, notes: '', parentId: null, templateItemId: null, createdAt: base, updatedAt: base, distanceKm: Math.round(km * 100) / 100,
          movingSec: sec, elapsedSec: sec + 60, elevationM: 80, hrAvg: 150, hrMax: 175, subtype: dow === 6 ? 'long' : 'z2', feel: '' });
      }
      if (dow === 4) {
        const km = 30 + rnd() * 30; const sec = Math.round(km * 120);
        sessions.push({ id: `rs_a${n++}`, kind: 'bike', date: d, planDate: d, templateId: null, templateName: '', status: 'done', startedAt: base, endedAt: base + sec * 1000,
          durationMin: sec / 60, rpe: 6, notes: '', parentId: null, templateItemId: null, createdAt: base, updatedAt: base, distanceKm: Math.round(km * 100) / 100,
          movingSec: sec, elevationM: 300, hrAvg: 140, subtype: 'route', feel: '' });
      }
      if (female && i % 28 < 5) cycle.push({ id: d, flow: ['heavy', 'medium', 'medium', 'light', 'spotting'][i % 28], symptoms: ['cramps'], notes: '', createdAt: base, updatedAt: base });
    }
    const settings = store.settings();
    settings.profile = { ...(settings.profile || {}), sex: female ? 'female' : 'male', goal: 'gain', experience: 'intermediate', cycleTracking: female, promptDismissed: true, onboardedAt: 1, birthDate: '1990-06-15' };
    settings.lastBackupAt = Date.now();
    const now = Date.now();
    const goals = [
      { id: 'rs_g1', kind: 'strength', title: 'Banca', titleAuto: true, exerciseId: 'press_banca', weight: 80, reps: 5, createdAt: now - 90 * 864e5, updatedAt: now, achievedAt: null, archived: false },
      { id: 'rs_g2', kind: 'endurance', title: '10k', titleAuto: true, sport: 'run', distanceKm: 10, timeSec: 2700, createdAt: now - 60 * 864e5, updatedAt: now, achievedAt: null, archived: false },
      { id: 'rs_g3', kind: 'bodyweight', title: 'Peso', titleAuto: true, targetKg: 76, direction: 'down', createdAt: now - 60 * 864e5, updatedAt: now, achievedAt: null, archived: false },
    ];
    const ap = (date, precision) => ({ date, precision });
    const context = [
      { id: 'rs_ctx1', kind: 'phase', type: 'prep_10k', start: ap(util.addDays(today, -40), 'day'), end: null, text: '', notes: '', goalIds: [], sports: ['run'], createdAt: 1, updatedAt: 1 },
      { id: 'rs_ctx2', kind: 'event', type: 'creatine_start', date: ap(util.addDays(today, -20), 'day'), text: '', notes: '', kg: null, createdAt: 2, updatedAt: 2 },
      { id: 'rs_ctx3', kind: 'event', type: 'race_result', date: ap(util.addDays(today, -400), 'month'), text: 'Carrera popular', notes: '', result: { km: 10, sec: 2950, effort: 'race', elevationM: null, surface: 'road' }, createdAt: 3, updatedAt: 3 },
    ];
    const races = [{ id: 'rs_race1', name: '', type: '10k', date: util.addDays(today, 24), distanceKm: 10, targetSec: 2700, priority: 'A', note: '', goalId: 'rs_g2', createdAt: 1, updatedAt: 1 }];
    const pastRecords = [{ id: 'rs_pr1', exerciseId: 'press_banca', weight: 82.5, reps: 5, rir: null, date: ap('2024-06-01', 'season'), beforeApp: true, bodyweightKg: null, note: '', createdAt: 1, updatedAt: 1 }];
    await db.putStores({ sessions, bodyweight, checkins, cycle, goals, context, races, pastRecords, meta: [settings] });
    return sessions.length;
  }, { months, female, activeSession }).then(async (count) => {
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
