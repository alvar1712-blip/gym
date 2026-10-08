// Ronda 8 (B4): estancamiento frente a doble progresión. UNA decisión (progression.progressionHint) para el
// «Siguiente paso» de la sesión y el panel semanal: con el mismo historial, la misma respuesta en los dos.
// Antes, un ejercicio con las series al tope durante semanas salía a la vez «estancado» en el panel y «Sube a …»
// en la sesión. Hoy = jueves 24 sep 2026 (semana en curso desde el lunes 21). Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyInsights } from '../../js/insights.js';
import { progressionHint, progressStatus, stallEval } from '../../js/progression.js';
import { stallState } from '../../js/analysis-training.js';
import { exerciseHistory } from '../../js/stats.js';
import { defaultSettings, SEED_EXERCISES } from '../../js/seed.js';
import { tsFromDate, addDays } from '../../js/util.js';

const TODAY = '2026-09-24';
const EXMAP = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const TARGET = { sets: 3, setsMax: null, repMin: 4, repMax: 6, timeMin: null, timeMax: null, distance: null };

let seq = 0;
const set = (weight, reps, rir = 2) => ({ id: `st${++seq}`, type: 'effective', weight, reps, repsR: null, rir, done: true, doneAt: 1 });
/** Sesión con press banca (3×4–6): sets = [[peso, reps, rir], …]. */
function ses(id, date, sets, exerciseId = 'press_banca') {
  return {
    id, kind: 'strength', date, planDate: date, status: 'done', templateId: null, templateName: 'Día 1',
    startedAt: tsFromDate(date, 18), createdAt: tsFromDate(date, 18), durationMin: 60, rpe: 7, notes: '',
    exercises: [{ id: `${id}_se0`, exerciseId, exName: exerciseId, templateItemId: null, target: { ...TARGET }, sets: sets.map(([w, r, rir]) => set(w, r, rir)) }],
  };
}
const mk = (sessions, settings = defaultSettings()) => ({ sessions, exercises: EXMAP, templates: new Map(), plan: new Map(), settings, bodyweight: [], checkins: [], today: TODAY });
/** Historial semanal que acaba hoy: una sesión por semana, la última hoy. */
const weekly = (rows) => rows.map((sets, i) => ses(`s${i}`, addDays(TODAY, -7 * (rows.length - 1 - i)), sets));
const x3 = (w, r, rir = 2) => [[w, r, rir], [w, r, rir], [w, r, rir]];

/** Lo que la tarjeta de la sesión pide (session-view-card): la última vez, el historial y la fecha de la sesión. */
function sessionDecision(data, id = 'press_banca', ref = TODAY) {
  const history = exerciseHistory(data, id, { labels: false });
  const last = history[history.length - 1];
  return progressionHint({ exercise: EXMAP.get(id), target: TARGET, lastSets: last.sets, settings: data.settings, history, ref, lastDate: last.date });
}
/** Lo que dice el panel de ese ejercicio: dp-up · dp-hold (mantener / volver a evaluar) · «Ejercicios estancados». */
function panelDecision(data, id = 'press_banca') {
  const r = weeklyInsights(data);
  const all = [...r.info, ...r.suggestions];
  const name = EXMAP.get(id).name;
  const out = [];
  if (r.suggestions.some((m) => m.id === `dp-up-${id}`)) out.push('up');
  const hold = r.suggestions.find((m) => m.id === 'dp-hold')?.items.find((x) => x.exerciseId === id);
  if (hold) out.push(hold.hold === 'review' ? 'review' : 'hold');
  const st = all.find((m) => m.id === 'ex-stalled');
  if (st?.why.data.some((d) => d.label === `${name} · siguiente paso`)) out.push('stalled');
  return { decisions: out, stalledListed: !!st?.items.some((x) => x.exerciseId === id), stalledMsg: st };
}

test('progresa y al tope con RIR → «Sube a …» en la sesión y «Subir peso» en el panel', () => {
  const data = mk(weekly([x3(75, 5), x3(75, 6), x3(77.5, 5), x3(77.5, 6)]));
  const s = sessionDecision(data);
  assert.equal(s.kind, 'up');
  assert.equal(s.text, 'Sube a 80 kg');
  assert.equal(s.status.status, 'progress');
  assert.deepEqual(panelDecision(data).decisions, ['up']);
});

test('datos ambiguos (al tope, sin RIR registrado) → «Mantén y vuelve a evaluar» en los dos', () => {
  const data = mk(weekly([x3(75, 5), x3(75, 6), x3(77.5, 5), x3(77.5, 6, null)]));
  const s = sessionDecision(data);
  assert.equal(s.kind, 'review');
  assert.equal(s.text, 'Mantén y vuelve a evaluar');
  assert.match(s.label, /sin RIR registrado/);
  assert.deepEqual(panelDecision(data).decisions, ['review']);
  const msg = weeklyInsights(data).suggestions.find((m) => m.id === 'dp-hold');
  assert.equal(msg.title, 'Mantén y vuelve a evaluar');
  assert.match(msg.text, /Press banca: todas en el tope, pero alguna sin RIR registrado .*registra el RIR y vuelve a evaluar/);
  // Con RIR mínimo 0 no hace falta el RIR: al tope → sube
  const s0 = sessionDecision(mk(data.sessions, { ...defaultSettings(), progression: { minRir: 0 } }));
  assert.equal(s0.kind, 'up');
});

test('la última vez fue hace semanas (vuelta tras un parón) → «Mantén y vuelve a evaluar» aunque llegara al tope', () => {
  const data = mk([ses('a', '2026-07-20', x3(80, 5)), ses('b', '2026-07-27', x3(80, 6))]);
  const s = sessionDecision(data);
  assert.equal(s.kind, 'review');
  assert.match(s.label, /la última vez fue hace 8 semanas/);
});

test('estancamiento documentado (mismas reps sin llegar al tope) → «Llevas 3 sesiones sin progresar · revisar» en los dos', () => {
  const data = mk(weekly([x3(80, 5), x3(80, 5), x3(80, 5), x3(80, 5), x3(80, 5)]));
  const s = sessionDecision(data);
  assert.equal(s.kind, 'stalled');
  assert.equal(`${s.text} · ${s.action}`, 'Llevas 3 sesiones sin progresar · revisar');
  const p = panelDecision(data);
  assert.deepEqual(p.decisions, ['stalled']);
  assert.ok(p.stalledListed);
  // Discreto: el panel lo cuenta en «Ejercicios estancados» (sin mensaje de «Mantén el peso» que diga otra cosa)
  assert.equal(weeklyInsights(data).suggestions.find((m) => m.id === 'dp-hold'), undefined);
});

test('regresión: estancado con las series al tope → nunca «Sube a …» en la sesión ni «Subir peso» en el panel', () => {
  // 80 × 6/6/6 cinco semanas seguidas: el 1RM estimado no mejora (estancado), y la doble progresión sola decía «sube»
  const data = mk(weekly([x3(80, 6), x3(80, 6), x3(80, 6), x3(80, 6), x3(80, 6)]));
  const s = sessionDecision(data);
  assert.equal(s.kind, 'stalled', 'la sesión no sugiere subir un ejercicio que el panel da por estancado');
  const p = panelDecision(data);
  assert.deepEqual(p.decisions, ['stalled']);
  // El panel da más detalle: quizá solo falta subir el peso (sugerir, no imponer)
  const row = p.stalledMsg.why.data.find((d) => d.label === 'Press banca · siguiente paso');
  assert.match(row.value, /^Llevas 3 sesiones sin progresar · revisar · en la última sesión llegaste al tope del rango: .*sube 2,5 kg/);
});

test('historiales aleatorios: el panel y la sesión deciden siempre lo mismo (y «estancado» en el panel ⇔ en la sesión)', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const seen = new Set();
  for (let k = 0; k < 300; k++) {
    const n = 1 + Math.floor(rnd() * 7);
    const sessions = [];
    let date = TODAY;
    for (let i = 0; i < n; i++) {
      const w = pick([75, 77.5, 80, 82.5]);
      const sets = Array.from({ length: pick([2, 3, 3, 3]) }, () => [w, pick([4, 5, 6, 6, 7]), pick([null, 0, 1, 2, 2])]);
      sessions.unshift(ses(`r${k}_${i}`, date, sets));
      date = addDays(date, -pick([2, 3, 4, 7, 7, 10]));
    }
    const data = mk(sessions);
    const s = sessionDecision(data);
    const p = panelDecision(data);
    assert.deepEqual(p.decisions, s ? [s.kind] : [], `historial ${k}: panel ${p.decisions} · sesión ${s?.kind}`);
    if (s) assert.equal(p.stalledListed, s.kind === 'stalled', `historial ${k}: «estancado» en el panel ⇔ en la sesión`);
    if (s) seen.add(s.kind);
  }
  assert.deepEqual([...seen].sort(), ['hold', 'review', 'stalled', 'up'], 'los cuatro casos salen en la muestra');
});

test('el análisis usa la misma regla de estancamiento (stallState = stallEval = progressStatus)', () => {
  const data = mk(weekly([x3(80, 6), x3(82.5, 5), x3(80, 6), x3(80, 6), x3(80, 6)]));
  const history = exerciseHistory(data, 'press_banca', { labels: false });
  const era = history.map((e) => ({ date: e.date, e1rm: e.e1rm }));
  const st = progressStatus({ exercise: EXMAP.get('press_banca'), history, ref: TODAY, stall: data.settings.stall });
  const ev = stallEval(era, TODAY, data.settings.stall);
  const an = stallState(era, TODAY, data.settings.stall);
  assert.equal(st.status, 'stalled');
  assert.deepEqual([ev.stalled, ev.bySessions, ev.byWeeks], [an.stalled, an.bySessions, an.byWeeks]);
  assert.deepEqual([st.bySessions, st.byWeeks], [an.bySessions, an.byWeeks]);
});
