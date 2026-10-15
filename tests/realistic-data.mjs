// Datos sintéticos realistas (ronda de pulido; docs/PULIDO.md): `months` meses de fuerza 4 días/semana con sus
// check-ins, carrera y bici, pesajes diarios, ciclo (modo mujer), objetivos, tu contexto (una fase, creatina y un
// resultado de carrera), una marca histórica de fuerza y un evento próximo. Semilla fija: nada personal.
// UNA sola fuente: la usan las pruebas E2E (tests/e2e/realistic-data.cjs, en el navegador) y la prueba cruzada de
// coherencia del análisis (tests/unit/analysis-consistency.test.mjs, en Node). Función PURA: recibe la biblioteca
// (ejercicios y rutinas), «hoy» y el instante actual; devuelve los registros, sin tocar el store.
// `recovery: true` (ronda 8, F): además, estrés en los check-ins y una zona que se repite (rodilla izquierda, con una
// nota) y unas agujetas en cuádriceps; sin la opción, los datos son exactamente los de siempre (no toca el generador).
// `birthDate`: la del perfil (por defecto, un adulto); la prueba cruzada la cambia para un menor.
import { addDays, dow as dowOf, tsFromDate } from '../js/util.js';

/**
 * @param {{ months?, female?, recovery?, birthDate?, today: string, now: number, templates: object[], exercises: Map }} o
 * @returns {{ sessions, bodyweight, checkins, cycle, goals, context, races, pastRecords, profile }}
 */
export function realisticData({ months = 6, female = true, recovery = false, birthDate = '1990-06-15', today, now, templates, exercises }) {
  const ex = exercises;
  const start = addDays(today, -Math.round(months * 30.4));
  const sessions = []; const bodyweight = []; const checkins = []; const cycle = [];
  let n = 0; let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const tplByDow = { 0: 'tpl_d1', 1: 'tpl_d2', 3: 'tpl_d4', 5: 'tpl_d6' };
  let kg = 80;
  for (let d = start, i = 0; d < today; d = addDays(d, 1), i++) {
    const dow = dowOf(d);
    const base = tsFromDate(d, 18);
    kg += (rnd() - 0.52) * 0.25;
    bodyweight.push({ id: d, kg: Math.round(kg * 10) / 10, createdAt: base, updatedAt: base });
    const t = templates.find((x) => x.id === tplByDow[dow]);
    if (t && rnd() < 0.9) {
      const id = `rs_s${n++}`;
      const exs = t.items.map((it, k) => {
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
        durationMin: 70, rpe: 7 + Math.floor(rnd() * 2), notes: '', parentId: null, templateItemId: null, createdAt: base, updatedAt: base, exercises: exs, cursor: 0,
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
  if (recovery) {
    // Determinista y después del bucle: el resto de los datos no cambia
    checkins.forEach((c, k) => { c.stress = 1 + (k % 3); });
    const recent = checkins.filter((c) => c.timing === 'pre' && c.date >= addDays(today, -40));
    const knee = [7, 6, 6, 5, 4, 3, 3, 2];
    recent.slice(-knee.length).forEach((c, k) => {
      c.areas = [{ id: `rs_z${k}`, kind: 'joint', zone: 'knee', side: 'left', level: knee[k], note: k === 1 ? 'Molestia al bajar escaleras tras la sentadilla' : '' }];
      if (k % 2 === 0) c.areas.push({ id: `rs_q${k}`, kind: 'muscle', zone: 'quads', side: null, level: 3 + (k % 3), note: '' });
    });
  }
  const profile = { sex: female ? 'female' : 'male', goal: 'gain', experience: 'intermediate', cycleTracking: female, promptDismissed: true, onboardedAt: 1, birthDate };
  const goals = [
    { id: 'rs_g1', kind: 'strength', title: 'Banca', titleAuto: true, exerciseId: 'press_banca', weight: 80, reps: 5, createdAt: now - 90 * 864e5, updatedAt: now, achievedAt: null, archived: false },
    { id: 'rs_g2', kind: 'endurance', title: '10k', titleAuto: true, sport: 'run', distanceKm: 10, timeSec: 2700, createdAt: now - 60 * 864e5, updatedAt: now, achievedAt: null, archived: false },
    { id: 'rs_g3', kind: 'bodyweight', title: 'Peso', titleAuto: true, targetKg: 76, direction: 'down', createdAt: now - 60 * 864e5, updatedAt: now, achievedAt: null, archived: false },
  ];
  const ap = (date, precision) => ({ date, precision });
  const context = [
    { id: 'rs_ctx1', kind: 'phase', type: 'prep_10k', start: ap(addDays(today, -40), 'day'), end: null, text: '', notes: '', goalIds: [], sports: ['run'], createdAt: 1, updatedAt: 1 },
    { id: 'rs_ctx2', kind: 'event', type: 'creatine_start', date: ap(addDays(today, -20), 'day'), text: '', notes: '', kg: null, createdAt: 2, updatedAt: 2 },
    { id: 'rs_ctx3', kind: 'event', type: 'race_result', date: ap(addDays(today, -400), 'month'), text: 'Carrera popular', notes: '', result: { km: 10, sec: 2950, effort: 'race', elevationM: null, surface: 'road' }, createdAt: 3, updatedAt: 3 },
  ];
  const races = [{ id: 'rs_race1', name: '', type: '10k', date: addDays(today, 24), distanceKm: 10, targetSec: 2700, priority: 'A', note: '', goalId: 'rs_g2', createdAt: 1, updatedAt: 1 }];
  const pastRecords = [{ id: 'rs_pr1', exerciseId: 'press_banca', weight: 82.5, reps: 5, rir: null, date: ap('2024-06-01', 'season'), beforeApp: true, bodyweightKg: null, note: '', createdAt: 1, updatedAt: 1 }];
  return { sessions, bodyweight, checkins, cycle, goals, context, races, pastRecords, profile };
}
