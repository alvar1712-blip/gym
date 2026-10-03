// Pruebas de la ronda 6, fase D (docs/MEJORAS6.md): carga por deporte, volumen con contexto, asociaciones personales
// (interferencia, agujetas, estrés) y agujetas por ejercicio (js/analysis-hybrid.js). Hoy = viernes 2 oct 2026.
// Datos sintéticos; las asociaciones necesitan ≥ 6 veces con y ≥ 6 sin, en ≥ 4 semanas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeHybrid, sportLoad, volumeReview, volumeChanges, personalAssociations, domsByExercise, compareGroups, associationConfidence,
  MIN_OBS, MIN_SPAN_DAYS,
} from '../../js/analysis-hybrid.js';
import { analyzeStrength } from '../../js/analysis-training.js';
import { buildAnalysis, areaInsights } from '../../js/analysis.js';
import { addDays, tsFromDate } from '../../js/util.js';
import { SEED_EXERCISES, defaultSettings } from '../../js/seed.js';

const TODAY = '2026-10-02';
const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const ago = (n) => addDays(TODAY, -n);
const NOPLAN = { ...defaultSettings(), weekPatterns: [] };
let seq = 0;
const set = (weight, reps = 5, rir = 0) => ({ id: `st${++seq}`, type: 'effective', weight, reps, rir, done: true, doneAt: 1 });
function ses(date, items, { rpe = 7, min = 60 } = {}) {
  const id = `s${++seq}`;
  return {
    id, kind: 'strength', date, status: 'done', startedAt: tsFromDate(date, 18), durationMin: min, rpe,
    exercises: items.map(([exerciseId, sets], i) => ({ id: `${id}_${i}`, exerciseId, sets })),
  };
}
function act(kind, date, { min = 45, rpe = null, subtype = null, km = null } = {}) {
  return { id: `a${++seq}`, kind, date, status: 'done', startedAt: tsFromDate(date, 8), durationMin: min, movingSec: min * 60, rpe, subtype, distanceKm: km };
}
const data = (over = {}) => ({ sessions: [], exercises: EX, templates: new Map(), plan: new Map(), settings: NOPLAN, bodyweight: [], checkins: [], context: [], pastRecords: [], today: TODAY, ...over });
const ck = (date, extra = {}) => ({ id: `ck${++seq}`, date, timing: 'pre', sessionId: null, sleep: 2, energy: 2, soreness: 2, createdAt: 1, ...extra });
const NO_CAUSE = /\bcausa\b(?! demostrada)/;

test('comparación de grupos y confianza de una asociación (sin probabilidades)', () => {
  const c = compareGroups([0.94, 0.95, 0.93], [1, 1.01, 0.99]);
  assert.ok(c.diff < -5 && c.d < -3, JSON.stringify(c));
  assert.equal(associationConfidence(6, 10, 30, -2).level, 'low');
  assert.equal(associationConfidence(12, 14, 90, -2).level, 'high');
  assert.equal(associationConfidence(12, 14, 90, -0.6).level, 'medium', 'efecto moderado → media como mucho');
  assert.equal(associationConfidence(5, 10, 90).level, 'insufficient');
  assert.ok(MIN_OBS === 6 && MIN_SPAN_DAYS === 28);
});

test('carga por deporte: 3 h de senderismo suave no pesan como 3 h de carrera; pico de una semana; sesiones sin RPE', () => {
  const sessions = [];
  // 4 semanas anteriores completas: 1 carrera de 180 min RPE 7 y 1 ruta de 180 min RPE 3 por semana; otra sin RPE
  for (let w = 1; w <= 8; w++) {
    sessions.push(act('run', addDays('2026-09-28', -7 * w + 1), { min: 180, rpe: 7 }));
    sessions.push(act('hike', addDays('2026-09-28', -7 * w + 2), { min: 180, rpe: 3 }));
  }
  sessions.push(act('bike', '2026-09-24', { min: 60 }));
  // Esta semana: carrera mucho más larga
  sessions.push(act('run', '2026-09-29', { min: 120, rpe: 8 }), act('run', '2026-10-01', { min: 150, rpe: 8 }));
  const sl = sportLoad(data({ sessions }), TODAY);
  const run = sl.rows.find((r) => r.kind === 'run');
  const hike = sl.rows.find((r) => r.kind === 'hike');
  assert.deepEqual([run.minutes4w, hike.minutes4w], [180, 180], 'mismos minutos');
  assert.deepEqual([run.load4w, hike.load4w], [1260, 540], 'distinta carga (minutos × esfuerzo)');
  assert.equal(run.spike, true, 'esta semana 2160 frente a 1260 de media');
  assert.equal(hike.spike, false);
  assert.equal(sl.rows.find((r) => r.kind === 'bike').noRpe4w, 1);
  const a = analyzeHybrid(data({ sessions }), { today: TODAY });
  const ins = a.insights.find((i) => i.id === 'load-sport');
  assert.equal(ins.title, 'Pico de carga en carrera');
  assert.match(ins.parts.observation, /^Esta semana llevas una carga de carrera de 2\.160, un 71\s%/);
  assert.equal(ins.confidence.level, 'medium', 'una sesión sin RPE la limita');
});

/** Pierna (sentadilla) cada 4 días durante 10 semanas; en `bad` días el 1RM baja un 6 %. */
function legHistory({ bad = new Set(), weeks = 10, extra = () => [], sets = 2 } = {}) {
  const sessions = [];
  const n = Math.floor((weeks * 7) / 4);
  for (let i = n; i >= 1; i--) {
    const date = ago(i * 4 - 2);
    const w = bad.has(i) ? 94 : 100;
    sessions.push(ses(date, [['sentadilla', Array.from({ length: sets }, () => set(w))]]), ...extra(date, i));
  }
  return sessions;
}

test('interferencia personal: pierna tras resistencia exigente el día antes (≥ 6 y 6) → «aparece asociado»; sin diferencia también se dice', () => {
  const bad = new Set([2, 4, 6, 8, 10, 12, 14, 16]);
  const withRun = (date, i) => (bad.has(i) ? [act('run', addDays(date, -1), { min: 45, rpe: 8, subtype: 'intervals', km: 8 })] : []);
  const list = personalAssociations(data({ sessions: legHistory({ bad, extra: withRun }) }), TODAY);
  const x = list.find((y) => y.id === 'legs-after-endurance');
  assert.equal(x.pattern, 'worse');
  assert.ok(x.n1 >= MIN_OBS && x.n2 >= MIN_OBS && x.span >= MIN_SPAN_DAYS);
  assert.ok(x.diff < -3);
  const a = analyzeHybrid(data({ sessions: legHistory({ bad, extra: withRun }) }), { today: TODAY });
  const ins = a.insights.find((i) => i.id === 'assoc-legs-after-endurance');
  assert.match(ins.parts.observation, /^En tus registros, las sesiones de pierna con resistencia exigente el día antes aparecen asociadas a un rendimiento un \d+(,\d)?\s% menor/);
  assert.match(ins.parts.interpretation, /no una causa demostrada/);
  assert.doesNotMatch(ins.text, NO_CAUSE);
  assert.ok(ins.confidence);
  // Mismas carreras sin peor rendimiento → resultado personal positivo
  const same = analyzeHybrid(data({ sessions: legHistory({ extra: withRun }) }), { today: TODAY }).insights.find((i) => i.id === 'assoc-legs-after-endurance');
  assert.equal(same.title, 'Tu pierna tolera la resistencia del día antes');
  assert.match(same.text, /no coincide con peor rendimiento/);
  // Pocas veces (5): sin conclusión
  const few = new Set([2, 4, 6, 8, 10]);
  const f = personalAssociations(data({ sessions: legHistory({ bad: few, extra: (d, i) => (few.has(i) ? withRun(d, 2) : []) }) }), TODAY).find((y) => y.id === 'legs-after-endurance');
  assert.equal(f.pattern, 'insufficient');
  assert.equal(f.confidence.level, 'insufficient');
  assert.ok(!analyzeHybrid(data({ sessions: legHistory({ bad: few, extra: (d, i) => (few.has(i) ? withRun(d, 2) : []) }) }), { today: TODAY }).insights.some((i) => i.id === 'assoc-legs-after-endurance'));
});

test('agujetas por ejercicio: el ejercicio que aparece asociado a más agujetas de su músculo (24–72 h), con mínimos', () => {
  const sessions = [];
  const checkins = [];
  for (let i = 14; i >= 1; i--) {
    const date = ago(i * 4);
    const squat = i % 2 === 0;
    sessions.push(ses(date, [[squat ? 'sentadilla' : 'prensa', [set(80, 8, 1), set(80, 8, 1), set(80, 8, 1)]]]));
    checkins.push(ck(addDays(date, 1), { areas: [{ id: `ar${i}`, kind: 'muscle', zone: 'quads', side: null, level: squat ? 7 : 3, note: '' }] }));
  }
  const d = data({ sessions, checkins });
  const doms = domsByExercise(d, TODAY);
  const sq = doms.find((x) => x.exerciseId === 'sentadilla' && x.muscleId === 'quads');
  assert.equal(sq.pattern, 'worse');
  assert.deepEqual([sq.withEx, sq.without, sq.n1, sq.n2], [7, 3, 7, 7]);
  const ins = analyzeHybrid(d, { today: TODAY }).insights.find((i) => i.id === 'doms-exercise');
  assert.equal(ins.title, 'Agujetas de cuádriceps tras Sentadilla');
  assert.match(ins.parts.observation, /^En tus registros, las agujetas de cuádriceps de las 24–72 h siguientes son de 7\/10 de media tras las sesiones con Sentadilla, frente a 3\/10/);
  assert.match(ins.parts.interpretation, /aparece asociado a más agujetas/);
  assert.doesNotMatch(ins.text, NO_CAUSE);
  // Sin check-ins con zonas no hay nada que decir
  assert.deepEqual(domsByExercise(data({ sessions }), TODAY), []);
});

test('estrés y agujetas antes de entrenar frente al rendimiento de la sesión', () => {
  const sessions = [];
  const checkins = [];
  for (let i = 16; i >= 1; i--) {
    const date = ago(i * 4);
    const stressed = i % 2 === 0;
    const s = ses(date, [['press_banca', [set(stressed ? 93 : 100), set(stressed ? 93 : 100)]]]);
    sessions.push(s);
    checkins.push(ck(date, { sessionId: s.id, stress: stressed ? 3 : 2 }));
  }
  const x = personalAssociations(data({ sessions, checkins }), TODAY).find((y) => y.id === 'perf-with-stress');
  assert.equal(x.pattern, 'worse');
  const ins = analyzeHybrid(data({ sessions, checkins }), { today: TODAY }).insights.find((i) => i.id === 'assoc-perf-with-stress');
  assert.match(ins.parts.observation, /^En tus registros, los días de estrés alto aparecen asociados a un rendimiento/);
  assert.equal(ins.area, 'recovery');
});

/** Press banca (pecho) 3 series cada 4 días; `rate` = 1RM por sesión. */
function benchHistory(rate, { sets = 3 } = {}) {
  const out = [];
  for (let i = 16; i >= 1; i--) out.push(ses(ago(i * 4 - 2), [['press_banca', Array.from({ length: sets }, () => set(rate(16 - i)))]]));
  return out;
}

test('volumen con contexto: progresar por debajo del rango → mantener; estancado → añadir; agujetas fuertes → reducir; menores nunca añaden', () => {
  // Pecho: 3 series cada 4 días ≈ 5 series/sem (rango 12–22): por debajo
  const progressing = data({ sessions: benchHistory((k) => 80 + k * 1.2) });
  const st = analyzeStrength(progressing, { today: TODAY });
  const vr = volumeReview(progressing, TODAY, { strength: st });
  const chest = vr.muscles.find((m) => m.muscleId === 'chest');
  assert.equal(chest.below, true);
  assert.equal(chest.decision, 'keep');
  assert.match(chest.reasons[0], /progresas con este volumen aunque esté por debajo del rango/);
  const ins = analyzeHybrid(progressing, { today: TODAY, strength: st }).insights.find((i) => i.id === 'strength-volume');
  assert.equal(ins.title, 'Tu volumen actual te funciona');
  assert.equal(ins.parts.interpretation, 'Estás progresando con el volumen actual. No hay una razón clara para aumentarlo.');

  const flat = [80, 81, 80, 80.5, 81, 80, 80.5, 81, 80, 80.5, 81, 80, 80.5, 81, 80, 80.5];
  const stalled = data({ sessions: benchHistory((k) => flat[k]) });
  const st2 = analyzeStrength(stalled, { today: TODAY });
  assert.equal(st2.exercises[0].status, 'stalled');
  assert.equal(volumeReview(stalled, TODAY, { strength: st2 }).muscles.find((m) => m.muscleId === 'chest').decision, 'add');
  assert.equal(volumeReview(stalled, TODAY, { strength: st2, age: 'minor' }).muscles.find((m) => m.muscleId === 'chest').decision, 'keep', 'menores: técnica antes que volumen');

  // Agujetas fuertes de pecho 2 veces en 14 días → reducir aunque esté dentro del rango
  const sore = data({ sessions: benchHistory((k) => flat[k]), checkins: [ck(ago(3), { areas: [{ id: 'a1', kind: 'muscle', zone: 'chest', side: null, level: 8, note: '' }] }), ck(ago(9), { areas: [{ id: 'a2', kind: 'muscle', zone: 'chest', side: null, level: 7, note: '' }] })] });
  const vr3 = volumeReview(sore, TODAY, { strength: analyzeStrength(sore, { today: TODAY }) });
  const c3 = vr3.muscles.find((m) => m.muscleId === 'chest');
  assert.equal(c3.decision, 'reduce');
  assert.match(c3.reasons.join(' '), /agujetas fuertes/);
  const ins3 = analyzeHybrid(sore, { today: TODAY, strength: analyzeStrength(sore, { today: TODAY }) }).insights.find((i) => i.id === 'strength-volume');
  assert.match(ins3.title, /^Reduce un poco el volumen de pecho/);
  assert.equal(ins3.level, 'warn');
  // Y el «qué probar» del estancamiento ya no pide más series de pecho
  const stalledTip = analyzeStrength(sore, { today: TODAY }).insights.find((i) => i.id === 'strength-stalled-press_banca');
  assert.match(stalledTip.text, /quitar 2–4 series por semana de pecho/);
  assert.doesNotMatch(stalledTip.text, /\+1–2 series/);
});

test('buildAnalysis: las conclusiones de la fase D van en sus tarjetas, con su confianza, y todo el análisis la lleva', () => {
  const bad = new Set([2, 4, 6, 8, 10, 12, 14, 16]);
  const sessions = legHistory({ bad, extra: (date, i) => (bad.has(i) ? [act('run', addDays(date, -1), { min: 45, rpe: 8, subtype: 'intervals', km: 8 })] : []) });
  const a = buildAnalysis(data({ sessions }), TODAY);
  assert.deepEqual(a.errors, []);
  assert.ok(areaInsights(a, 'endurance').some((i) => i.id === 'assoc-legs-after-endurance'));
  assert.ok(areaInsights(a, 'strength').some((i) => i.id === 'strength-volume'));
  const missing = a.all.filter((i) => !i.confidence && !['weight-protein', 'weight-cycle-retention'].includes(i.id)).map((i) => i.id);
  assert.deepEqual(missing, [], 'todas las conclusiones con su confianza');
  for (const i of a.all) assert.doesNotMatch(`${i.title} ${i.text}`, NO_CAUSE, i.id);
});

test('interferencia: con datos personales suficientes, la asociación personal sustituye a la regla general (y con pocos, no)', () => {
  const bad = new Set([2, 4, 6, 8, 10, 12, 14, 16]);
  const withRun = (date, i) => (bad.has(i) ? [act('run', addDays(date, -1), { min: 45, rpe: 8, subtype: 'intervals', km: 8 })] : []);
  // 3 series de pierna: también cuenta para la regla general (findInterference)
  const a = buildAnalysis(data({ sessions: legHistory({ bad, extra: withRun, sets: 3 }) }), TODAY);
  assert.deepEqual(a.errors, []);
  assert.ok(a.endurance.interference.length >= 2, 'la regla general vería las veces');
  assert.ok(!a.all.some((i) => i.id === 'endurance-interference'), 'la regla general no se repite');
  assert.equal(a.all.find((i) => i.id === 'assoc-legs-after-endurance').why.data.find((r) => r.label === 'Efecto (d de Cohen)').value, 'menos de −10', 'sin variación: sin cifras absurdas');
  assert.equal(a.endurance.interferenceBasis, 'personal');
  const p = a.all.find((i) => i.id === 'assoc-legs-after-endurance');
  assert.match(p.why.rule, /sustituye a la regla general/);
  assert.ok(p.why.data.some((r) => /y pierna al día siguiente$/.test(r.value)), 'las últimas veces siguen en el «¿Por qué?»');
  // Pocas veces: sin conclusión personal, queda la regla general
  const few = new Set([2, 4, 6, 8, 10]);
  const b = buildAnalysis(data({ sessions: legHistory({ bad: few, sets: 3, extra: (d, i) => (few.has(i) ? withRun(d, 2) : []) }) }), TODAY);
  assert.ok(b.all.some((i) => i.id === 'endurance-interference'));
  assert.ok(!b.all.some((i) => i.id === 'assoc-legs-after-endurance'));
  assert.equal(b.endurance.interferenceBasis, undefined);
});

test('sesiones de fuerza saltadas o a medias en las semanas con más resistencia (con la adherencia del Calendario)', () => {
  const tpl = { id: 'tA', name: 'A', items: [{ id: 'it1', exerciseId: 'press_banca' }, { id: 'it2', exerciseId: 'sentadilla' }] };
  const settings = { ...defaultSettings(), weekPatterns: [{ from: '2000-01-01', days: [{ kind: 'template', templateId: 'tA' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'template', templateId: 'tA' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'rest' }] }] };
  const full = (date) => ({ ...ses(date, [['press_banca', [set(80)]], ['sentadilla', [set(100)]]]), templateId: 'tA', templateItemIds: ['it1', 'it2'], exercises: [{ id: `f${++seq}`, exerciseId: 'press_banca', templateItemId: 'it1', sets: [set(80)] }, { id: `f${++seq}`, exerciseId: 'sentadilla', templateItemId: 'it2', sets: [set(100)] }] });
  const half = (date) => ({ ...full(date), exercises: [{ id: `h${++seq}`, exerciseId: 'press_banca', templateItemId: 'it1', sets: [set(80)] }] });
  const cw = '2026-09-28';
  const build = (heavyMiss) => {
    const sessions = [];
    for (let w = 1; w <= 16; w++) {
      const ws = addDays(cw, -7 * w);
      const heavy = w % 2 === 0;
      if (heavy) {
        for (const k of [1, 2, 5]) sessions.push(act('run', addDays(ws, k), { min: 60, rpe: 7 }));
        sessions.push(full(ws));
        if (heavyMiss === 'partial') sessions.push(half(addDays(ws, 3)));
        else if (heavyMiss === 'none') sessions.push(full(addDays(ws, 3)));
      } else {
        sessions.push(act('run', addDays(ws, 2), { min: 30, rpe: 4 }), full(ws), full(addDays(ws, 3)));
      }
    }
    return data({ sessions, settings, templates: new Map([['tA', tpl]]) });
  };
  const skipped = personalAssociations(build('skip'), TODAY).find((x) => x.id === 'skips-with-endurance');
  assert.equal(skipped.pattern, 'worse');
  assert.deepEqual([skipped.n1, skipped.n2, Math.round(skipped.m1), Math.round(skipped.m2)], [8, 8, 50, 0]);
  const ins = analyzeHybrid(build('partial'), { today: TODAY }).insights.find((i) => i.id === 'assoc-skips-with-endurance');
  assert.equal(ins.title, 'Semanas de mucha resistencia, fuerza a medias');
  assert.equal(ins.area, 'strength');
  assert.match(ins.parts.observation, /^En tus registros, las semanas con más carga de resistencia coinciden con más sesiones de fuerza saltadas o a medias: 50\s% de las planificadas, frente a 0\s% el resto \(8 y 8 semanas\)\./);
  assert.doesNotMatch(ins.text, NO_CAUSE);
  const fine = analyzeHybrid(build('none'), { today: TODAY }).insights.find((i) => i.id === 'assoc-skips-with-endurance');
  assert.equal(fine.title, 'La resistencia no te quita sesiones de fuerza');
  // Sin semana tipo no hay días planificados: nada que decir
  assert.ok(!personalAssociations({ ...build('skip'), settings: NOPLAN }, TODAY).some((x) => x.id === 'skips-with-endurance'));
});

test('cambio de volumen y progreso (antes / después): «coincide», confianza media como mucho y baja con contexto reciente', () => {
  const cw = '2026-09-28';
  const sessions = [];
  for (let w = 12; w >= 1; w--) {
    const ws = addDays(cw, -7 * w);
    for (const k of [0, 3]) {
      const before = w > 6;
      const kg = before ? [100, 101, 100, 99.5][(w + k) % 4] : 100 * (1 + 0.012 * (6 - w + k / 7));
      sessions.push(ses(addDays(ws, k), [['press_banca', Array.from({ length: before ? 6 : 3 }, () => set(Math.round(kg * 2) / 2))]]));
    }
  }
  const d = data({ sessions });
  const st = analyzeStrength(d, { today: TODAY });
  const list = volumeChanges(d, TODAY, { strength: st });
  const chest = list.find((x) => x.muscleId === 'chest' && x.exerciseId === 'press_banca');
  assert.equal(chest.direction, 'down');
  assert.deepEqual([chest.avgA, chest.avgB], [12, 6]);
  assert.equal(chest.pattern, 'better');
  assert.ok(chest.confidence.level === 'medium' || chest.confidence.level === 'low');
  const ins = analyzeHybrid(d, { today: TODAY, strength: st }).insights.find((i) => i.id === 'volume-change');
  assert.equal(ins.title, 'Press banca progresa más desde que bajaste el volumen de pecho');
  assert.match(ins.parts.observation, /^En tus registros, desde que bajaste el volumen de pecho \(de 12 a 6 series por semana: últimas 6 semanas frente a las 6 anteriores\), Press banca progresa más: \+/);
  assert.match(ins.parts.interpretation, /no demuestra que sea por el volumen/);
  assert.doesNotMatch(ins.text, NO_CAUSE);
  // Con un cambio reciente en el contexto, confianza baja
  const ctx = { training: { returning: false }, changes: [{ text: 'Empieza: creatina (20 sep)' }] };
  assert.equal(volumeChanges(d, TODAY, { strength: st, context: ctx }).find((x) => x.muscleId === 'chest').confidence.level, 'low');
  // Sin cambio de volumen (siempre 3 series): nada
  const steady = data({ sessions: sessions.map((s) => ({ ...s, exercises: s.exercises.map((e) => ({ ...e, sets: e.sets.slice(0, 3) })) })) });
  assert.ok(!volumeChanges(steady, TODAY, { strength: analyzeStrength(steady, { today: TODAY }) }).some((x) => x.muscleId === 'chest'));
});

test('agujetas y dosis dentro de un ejercicio (series, RIR, carga) y curva de 24/48/72 h, con mínimos', () => {
  const build = (n) => {
    const sessions = []; const checkins = [];
    for (let i = n; i >= 1; i--) {
      const date = ago(i * 4);
      const many = i % 2 === 0;
      sessions.push(ses(date, [['sentadilla', Array.from({ length: many ? 5 : 3 }, () => set(100, 8, 1))]]));
      checkins.push(ck(addDays(date, 1), { areas: [{ id: `x${i}`, kind: 'muscle', zone: 'quads', side: null, level: many ? 5 : 2, note: '' }] }));
      checkins.push(ck(addDays(date, 2), { areas: [{ id: `y${i}`, kind: 'muscle', zone: 'quads', side: null, level: many ? 7 : 3, note: '' }] }));
    }
    return data({ sessions, checkins });
  };
  const rows = domsByExercise(build(14), TODAY);
  const sq = rows.find((x) => x.exerciseId === 'sentadilla' && x.muscleId === 'quads');
  assert.equal(sq.pattern, 'insufficient', 'no hay sesiones de cuádriceps sin sentadilla con las que comparar');
  assert.equal(sq.dose.factor, 'sets');
  assert.equal(sq.dose.pattern, 'worse');
  assert.deepEqual([sq.dose.m1, sq.dose.m2, sq.dose.n1, sq.dose.n2], [7, 3, 7, 7]);
  assert.deepEqual(sq.byDay.map((x) => x && x.mean), [3.5, 5, null]);
  assert.equal(sq.peakDay, 2, 'el pico, a las 48 h');
  const ins = analyzeHybrid(build(14), { today: TODAY }).insights.find((i) => i.id === 'doms-dose');
  assert.equal(ins.title, 'Más agujetas de cuádriceps con más series en Sentadilla');
  assert.match(ins.parts.observation, /^En tus registros, las sesiones de Sentadilla con 5 series o más aparecen asociadas a más agujetas de cuádriceps en las 24–72 h siguientes \(7\/10 frente a 3\/10 con menos series; 7 y 7 sesiones\)\./);
  assert.ok(['low', 'medium'].includes(ins.confidence.level), 'varias comparaciones a la vez → media como mucho');
  assert.ok(ins.why.data.some((r) => r.value === '24 h: 3,5/10 · 48 h: 5/10'));
  // 5 y 5 sesiones: sin conclusión
  assert.ok(!analyzeHybrid(build(10), { today: TODAY }).insights.some((i) => i.id === 'doms-dose'));
});
