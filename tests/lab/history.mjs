// Generador determinista de historiales sintéticos con el esquema REAL de Entreno (docs/ARCHITECTURE.md §6): sesiones de
// fuerza (con calentamientos, RIR, configuraciones de material, cambios de ejercicio), actividades de resistencia, pesajes,
// check-ins, objetivos, eventos y perfil. Función PURA: mismo perfil + semilla = mismos registros. No toca el store.
// Las fechas son civiles (YYYY-MM-DD) y los instantes se calculan en la zona horaria del PROCESO: el runner fija Europe/Madrid.
import { rng, hashSeed } from './rng.mjs';
import { addDays, dow as dowOf, tsFromDate, diffDays } from '../../js/util.js';
import { SEED_EXERCISES, SEED_TEMPLATES, defaultSettings, exampleWeekPatterns } from '../../js/seed.js';

export const TODAY = '2026-10-15'; // jueves, igual que las pruebas de coherencia existentes
export const NOW = Date.parse(`${TODAY}T12:00:00`);

const EX = new Map(SEED_EXERCISES.map((e) => [e.id, { archived: false, ...e }]));
const TPL_ORDER = ['tpl_d1', 'tpl_d2', 'tpl_d4', 'tpl_d6', 'tpl_d3'];
const STRENGTH_DOWS = [0, 1, 3, 4, 5]; // lun mar jue vie sáb
const CARDIO_DOWS = [2, 6, 4, 5, 0, 3, 1];
const GOAL_MAP = { hypertrophy: 'gain', strength: 'gain', performance: 'gain' };
const SEXFACTOR = { female: 0.6, male: 1 };
const EXPFACTOR = { beginner: 0.55, intermediate: 0.85, advanced: 1.15 };
const round = (v, step) => Math.round(v / step) * step;

/** Registros de un perfil: { sessions, bodyweight, checkins, goals, races, context, pastRecords, plan, cycle, profile }. */
export function generateHistory(p, { seed = 1, today = TODAY } = {}) {
  const r = rng(hashSeed(p.id) ^ seed);
  const start = addDays(today, -p.weeks * 7);
  const sessions = []; const bodyweight = []; const checkins = [];
  let n = 0;
  const inGap = (d) => {
    const wk = Math.floor(diffDays(d, today) / 7); // diffDays(a,b) = a→b; semanas hacia atrás
    return (p.gaps || []).some((g) => wk > g.endWeeksAgo && wk <= g.endWeeksAgo + g.weeks);
  };
  const afterGapWeeks = (d) => {
    let best = null;
    for (const g of p.gaps || []) {
      const endDate = addDays(today, -g.endWeeksAgo * 7);
      const k = Math.floor(diffDays(endDate, d) / 7);
      if (k >= 0 && (best == null || k < best)) best = k;
    }
    return best;
  };
  const strengthDows = STRENGTH_DOWS.slice(0, Math.min(5, p.sports.strength || 0));
  const cardio = ['run', 'bike', 'swim', 'hike', 'other'].flatMap((k) => Array(p.sports[k] || 0).fill(k));
  const cardioDow = new Map();
  cardio.forEach((k, i) => { const d = CARDIO_DOWS[i % 7]; if (!strengthDows.includes(d) || cardio.length > 2) cardioDow.set(`${d}:${i}`, k); });
  const baseW = new Map();
  const baseOf = (id, e) => {
    if (!baseW.has(id)) baseW.set(id, Math.max(5, (12 + (hashSeed(id) % 40)) * (e.category === 'compound' ? 1.5 : 1) * (SEXFACTOR[p.sex] ?? 0.8) * (EXPFACTOR[p.experience] ?? 0.8)));
    return baseW.get(id);
  };
  const dirtySet = (set, e) => {
    const v = Math.floor(r() * 6);
    if (v === 0) set.weight = null; // peso olvidado
    else if (v === 1) set.reps = 0;
    else if (v === 2) set.reps = null;
    else if (v === 3) set.weight = (set.weight || 20) * 10; // coma mal puesta
    else if (v === 4) set.reps = 100;
    else set.rir = 9;
    return set;
  };

  for (let d = start, i = 0; d < today; d = addDays(d, 1), i++) {
    const dow = dowOf(d);
    const base = tsFromDate(d, 18);
    if (p.weighIn !== false && i % 7 === 0) bodyweight.push({ id: d, kg: round(55 + (hashSeed(p.id) % 35) + (r() - 0.5) * 2, 0.1), createdAt: base, updatedAt: base });
    if (inGap(d)) continue;
    const w = Math.floor(i / 7);
    const si = strengthDows.indexOf(dow);
    if (si >= 0 && r() < p.adherence) {
      const t = SEED_TEMPLATES.find((x) => x.id === TPL_ORDER[si]);
      const id = `lab_s${n++}`;
      const ag = afterGapWeeks(d);
      const growth = 1 + (p.progress || 0) * 0.02 * Math.min(w, p.plateauAfter ?? 99);
      const detrain = ag != null && ag < 2 ? 0.9 : 1;
      const exs = t.items.map((it, k) => {
        let e = EX.get(it.exerciseId);
        if (p.editsRoutines && e.logType !== 'cardio' && r() < 0.25) { // cambia de ejercicio por otro del mismo patrón
          const alts = SEED_EXERCISES.filter((x) => x.pattern === e.pattern && x.logType === e.logType && x.id !== e.id);
          if (alts.length) e = EX.get(alts[Math.floor(r() * alts.length)].id);
        }
        const sets = [];
        const useSetup = p.setups && e.logType === 'weight_reps' && hashSeed(e.id) % 3 === 0;
        const alt = useSetup && Math.floor(w / 6) % 2 === 1; // bloques de 6 semanas con otra máquina
        if (e.logType !== 'cardio') {
          const nSets = it.sets || 3;
          const w0 = round(baseOf(e.id, e) * growth * detrain * (alt ? 1.3 : 1) * (0.95 + r() * 0.1), 2.5);
          for (let j = -(e.category === 'compound' && r() < 0.5 ? 1 : 0); j < nSets; j++) {
            const loaded = e.logType === 'weight_reps' || e.logType === 'unilateral';
            const warm = j < 0;
            let set = { id: `${id}_${k}_${j + 1}`, type: warm ? 'warmup' : 'effective', weight: loaded ? (warm ? round(w0 * 0.5, 2.5) : w0) : e.logType === 'bodyweight' ? 0 : null,
              reps: warm ? 10 : (it.repMin || 8) + Math.floor(r() * 3), repsR: e.logType === 'unilateral' ? (it.repMin || 8) : null, rir: warm ? null : Math.floor(r() * 3),
              timeSec: e.logType === 'time' ? 40 : null, distanceM: e.logType === 'distance_time' ? 30 : null, heightCm: null, note: '', done: true, doneAt: base + (j + 2) * 120e3 };
            if (!warm && p.dirty && r() < p.dirty) set = dirtySet(set, e);
            sets.push(set);
          }
        }
        const se = { id: `${id}_se${k}`, exerciseId: e.id, exName: e.name, templateItemId: it.id, alternatives: [], target: { sets: it.sets, repMin: it.repMin, repMax: it.repMax },
          notes: '', section: it.section || '', groupId: it.groupId, groupType: it.groupType, sets };
        if (useSetup) se.setup = alt ? 'Polea alta' : 'Hammer';
        return se;
      });
      sessions.push({ id, kind: 'strength', date: d, planDate: d, templateId: t.id, templateName: t.name, status: 'done', startedAt: base, endedAt: base + 70 * 60e3,
        durationMin: 70, rpe: 6 + Math.floor(r() * 3), notes: '', parentId: null, templateItemId: null, createdAt: base, updatedAt: base, exercises: exs, cursor: 0, templateItemIds: t.items.map((x) => x.id) });
      if (p.tech === 'expert' && r() < 0.6) checkins.push({ id: `lab_c${n++}`, date: d, timing: 'pre', sessionId: id, sleep: 1 + Math.floor(r() * 3), energy: 1 + Math.floor(r() * 3), soreness: 1 + Math.floor(r() * 3), createdAt: base, updatedAt: base });
    }
    for (const [key, kind] of cardioDow) {
      if (Number(key.split(':')[0]) !== dow || r() >= p.adherence) continue;
      sessions.push(activity(p, kind, d, base, `lab_a${n++}`, r));
    }
  }
  if (p.dirty) for (const s of sessions) if (s.kind !== 'strength' && r() < p.dirty) { // actividad con datos erróneos
    const v = Math.floor(r() * 3);
    if (v === 0) s.distanceKm = 0; else if (v === 1) { s.movingSec = null; s.durationMin = 0; } else s.distanceKm = (s.distanceKm || 5) * 10;
  }
  const goals = [];
  const mk = (o) => ({ titleAuto: true, createdAt: NOW - 90 * 864e5, updatedAt: NOW, achievedAt: null, archived: false, ...o });
  if (p.goalChange) {
    goals.push(mk({ id: 'lab_g1', kind: 'endurance', title: 'Maratón', sport: 'run', distanceKm: 42.195, timeSec: 3 * 3600 + 30 * 60, archived: true }));
    goals.push(mk({ id: 'lab_g2', kind: 'strength', title: 'Sentadilla', exerciseId: 'sentadilla', weight: 100, reps: 5 }));
  } else if (p.sports.strength) goals.push(mk({ id: 'lab_g1', kind: 'strength', title: 'Press banca', exerciseId: 'press_banca', weight: round(baseOf('press_banca', EX.get('press_banca')) * 1.4, 2.5), reps: 5 }));
  const races = p.race ? [{ id: 'lab_race1', name: '', type: p.race.type, date: addDays(today, p.race.weeksAhead * 7), distanceKm: p.race.type === 'marathon' ? 42.195 : 10, targetSec: p.race.type === 'marathon' ? 12600 : 2700, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1 }] : [];
  const [y, m, dd] = today.split('-').map(Number);
  const profile = { sex: p.sex, goal: GOAL_MAP[p.goal] || 'maintain', experience: p.experience, cycleTracking: false, promptDismissed: true, onboardedAt: 1,
    birthDate: `${y - p.age}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}` };
  return { sessions, bodyweight, checkins, goals, races, context: [], pastRecords: [], plan: [], cycle: [], profile };
}

function activity(p, kind, d, base, id, r) {
  const q = { beginner: 1.25, intermediate: 1, advanced: 0.88 }[p.experience] || 1; // más lento cuanto menos experiencia
  const km = { run: 4 + r() * 8, bike: 20 + r() * 40, swim: 0.8 + r() * 1.5, hike: 6 + r() * 12, other: 0 }[kind];
  const secPerKm = { run: 330 * q, bike: 125, swim: 1800 / 1, hike: 720, other: 0 }[kind] * (0.95 + r() * 0.1);
  const sec = kind === 'other' ? Math.round((45 + r() * 45) * 60) : Math.round(km * secPerKm);
  const rec = { id, kind, date: d, planDate: d, templateId: null, templateName: '', status: 'done', startedAt: base, endedAt: base + sec * 1000,
    durationMin: sec / 60, rpe: 5 + Math.floor(r() * 3), notes: '', parentId: null, templateItemId: null, createdAt: base, updatedAt: base,
    movingSec: sec, subtype: '', feel: '' };
  if (kind !== 'other') rec.distanceKm = Math.round(km * 100) / 100;
  if (kind === 'run' || kind === 'bike' || kind === 'hike') { rec.elapsedSec = sec + 60; rec.elevationM = kind === 'hike' ? 400 : 60; rec.hrAvg = 145; rec.hrMax = 172; }
  if (kind === 'swim') { rec.poolType = 'pool'; rec.poolLengthM = 25; }
  return rec;
}

/** Copia JSON (formato 2) con los ejercicios y rutinas de serie, lista para validateBackup / store.importData. */
export function buildBackup(h) {
  const settings = { ...defaultSettings(), weekPatterns: exampleWeekPatterns() };
  settings.profile = { ...settings.profile, ...h.profile };
  settings.lastBackupAt = NOW;
  const { profile, ...stores } = h;
  return {
    app: 'entreno-pwa', format: 2, appVersion: '1.0.0', exportedAt: new Date(NOW).toISOString(),
    data: { meta: [{ id: 'app', createdAt: NOW, seedVersion: 1, schema: 1, seedComplete: true }, settings], exercises: SEED_EXERCISES.map((e) => ({ archived: false, ...e })), templates: SEED_TEMPLATES, ...stores },
  };
}

/** `data` en la forma que consumen las pantallas (como analysis-consistency.test.mjs): para ejecutar el análisis en Node. */
export function screenData(h) {
  const settings = { ...defaultSettings(), weekPatterns: exampleWeekPatterns() };
  settings.profile = { ...settings.profile, ...h.profile };
  return {
    sessions: h.sessions, exercises: EX, templates: new Map(SEED_TEMPLATES.map((t) => [t.id, t])), plan: new Map(), settings,
    bodyweight: [...h.bodyweight].sort((a, b) => (a.id < b.id ? -1 : 1)), context: h.context, today: TODAY, createdAt: null,
    checkins: h.checkins, cycleDays: h.cycle, pastRecords: h.pastRecords, races: h.races, goals: h.goals,
  };
}

export const EXERCISES = EX;
