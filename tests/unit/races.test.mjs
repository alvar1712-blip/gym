// Pruebas de la ronda 6, fase E (docs/MEJORAS6.md): eventos deportivos (js/races-logic.js). Hoy = viernes 2 oct 2026.
// Datos sintéticos (ningún dato personal real).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../js/races-logic.js';
import { racePrediction, linkedGoalProgress } from '../../js/races-progress.js';
import { analysisContext } from '../../js/analysis-context.js';
import { addDays, tsFromDate } from '../../js/util.js';
import { SEED_EXERCISES, defaultSettings } from '../../js/seed.js';

const TODAY = '2026-10-02';
const race = (o = {}) => ({ id: `r${Math.random().toString(36).slice(2, 7)}`, name: '', type: '10k', date: addDays(TODAY, 73), distanceKm: null, targetSec: null, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1, ...o });

test('tipos, deporte y distancia: las carreras con nombre tienen distancia fija; triatlón y «otro», opcional', () => {
  assert.deepEqual(R.RACE_TYPES.map((t) => t.value), ['5k', '10k', 'half', 'marathon', 'cycling', 'hiking', 'triathlon', 'custom']);
  assert.equal(R.fixedKm('half'), 21.0975);
  assert.equal(R.fixedKm('cycling'), null);
  assert.deepEqual(['5k', 'cycling', 'hiking', 'triathlon', 'custom'].map((t) => R.sportOf({ type: t })), ['run', 'bike', 'hike', null, null]);
  assert.equal(R.distanceRequired('cycling'), true);
  assert.equal(R.distanceRequired('triathlon'), false);
  // normalizeRace: la distancia de una carrera con nombre es la del tipo aunque se guardara otra; tipo desconocido → «otro»
  assert.equal(R.normalizeRace(race({ type: 'marathon', distanceKm: 40 })).distanceKm, 42.195);
  assert.equal(R.normalizeRace(race({ type: 'mystery', name: 'X' })).type, 'custom');
  assert.equal(R.normalizeRace(race({ priority: 'Z' })).priority, 'B');
  assert.equal(R.normalizeRace(race({ date: '2026-13-01' })), null);
  assert.equal(R.normalizeRace(null), null);
});

test('validación y registro', () => {
  const goals = [
    { id: 'g1', kind: 'endurance', sport: 'run', distanceKm: 10, timeSec: 3000, title: '10 km en menos de 50 min', archived: false, achievedAt: null },
    { id: 'g2', kind: 'endurance', sport: 'bike', distanceKm: 40, title: '40 km en bici', archived: false, achievedAt: null },
    { id: 'g3', kind: 'endurance', sport: 'run', distanceKm: 5, title: '5 km', archived: true, achievedAt: null },
    { id: 'g4', kind: 'strength', exerciseId: 'press_banca', title: 'Press', archived: false, achievedAt: null },
  ];
  assert.deepEqual(R.validateRace(race(), { goals }), {});
  assert.ok(R.validateRace(race({ type: 'custom', name: '' })).name);
  assert.ok(R.validateRace(race({ type: 'cycling' })).distanceKm, 'ciclismo: distancia obligatoria');
  assert.deepEqual(R.validateRace(race({ type: 'triathlon' })), {}, 'triatlón: distancia opcional');
  assert.ok(R.validateRace(race({ type: 'hiking', distanceKm: 900 })).distanceKm);
  assert.ok(R.validateRace(race({ targetSec: -5 })).targetSec);
  assert.ok(R.validateRace(race({ date: null })).date);
  assert.ok(R.validateRace(race({ priority: null })).priority);
  // Objetivos enlazables: de resistencia, activos y del mismo deporte
  assert.deepEqual(R.linkableGoals(goals, race()).map((g) => g.id), ['g1']);
  assert.deepEqual(R.linkableGoals(goals, race({ type: 'cycling' })).map((g) => g.id), ['g2']);
  assert.ok(R.validateRace(race({ goalId: 'g2' }), { goals }).goalId, 'un objetivo de bici no se enlaza a un 10K');
  assert.deepEqual(R.validateRace(race({ goalId: 'g1' }), { goals }), {});
  const rec = R.raceRecord({ ...race({ name: '  San Silvestre  ', type: '10k', distanceKm: 3, targetSec: 2999.6, goalId: 'g1' }) }, { id: 'race_1', now: 5 });
  assert.deepEqual(rec, { id: 'race_1', name: 'San Silvestre', type: '10k', date: addDays(TODAY, 73), distanceKm: 10, targetSec: 3000, priority: 'A', note: '', goalId: 'g1', createdAt: 5, updatedAt: 5 });
  assert.equal(R.raceRecord({ ...rec }, { id: 'race_1', createdAt: 2, now: 9 }).createdAt, 2, 'al editar se conserva createdAt');
});

test('Hoy: un solo hueco, «10K · 73 días · objetivo <50:00»; A o B del próximo año, C solo si es en 30 días', () => {
  const ten = race({ id: 'a', type: '10k', targetSec: 3000, date: addDays(TODAY, 73), priority: 'A' });
  assert.equal(R.todayLine(ten, TODAY), '10K · 73 días · objetivo <50:00');
  assert.equal(R.todayLine(race({ type: 'half', date: TODAY, targetSec: 6300 }), TODAY), 'Media maratón · hoy · objetivo <1:45:00');
  assert.equal(R.todayLine(race({ type: 'cycling', name: 'Quebrantahuesos', distanceKm: 200, date: addDays(TODAY, 1) }), TODAY), 'Quebrantahuesos · mañana');
  const cSoon = race({ id: 'c', type: '5k', date: addDays(TODAY, 10), priority: 'C' });
  const bLater = race({ id: 'b', type: 'half', date: addDays(TODAY, 120), priority: 'B' });
  const past = race({ id: 'p', type: 'marathon', date: addDays(TODAY, -3), priority: 'A' });
  assert.equal(R.nextRelevant([cSoon, bLater, ten, past], TODAY).id, 'a', 'el A/B más cercano, aunque haya un C antes');
  assert.equal(R.nextRelevant([cSoon, past], TODAY).id, 'c', 'sin A ni B, el C de los próximos 30 días');
  assert.equal(R.nextRelevant([race({ priority: 'C', date: addDays(TODAY, 40) })], TODAY), null);
  assert.equal(R.nextRelevant([race({ priority: 'A', date: addDays(TODAY, 400) })], TODAY), null, 'más de un año: no');
  assert.equal(R.nextRelevant([past], TODAY), null);
  assert.equal(R.nextRelevant([], TODAY), null);
  // Misma fecha: manda la prioridad
  const sameDay = [race({ id: 'x', priority: 'B', date: addDays(TODAY, 20) }), race({ id: 'y', priority: 'A', date: addDays(TODAY, 20) })];
  assert.equal(R.nextRelevant(sameDay, TODAY).id, 'y');
  const { upcoming, past: gone } = R.splitRaces([past, bLater, ten, cSoon], TODAY);
  assert.deepEqual(upcoming.map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(gone.map((r) => r.id), ['p']);
});

const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
let seq = 0;
const run = (ago, km, sec) => { const date = addDays(TODAY, -ago); return { id: `run${++seq}`, kind: 'run', date, status: 'done', startedAt: tsFromDate(date, 8), durationMin: sec / 60, movingSec: sec, distanceKm: km, rpe: 6 }; };
const data = (sessions) => ({ sessions, exercises: EX, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], today: TODAY });

test('cómo vas: reutiliza race-predict (veredicto con objetivo, rango sin él) y goalProgress del objetivo enlazado', () => {
  const runs = data([run(5, 10, 2940), run(12, 8, 2300), run(20, 5, 1380), run(30, 12, 3700)]);
  const p = racePrediction(runs, race({ type: '10k', targetSec: 3000 }), { today: TODAY });
  assert.ok(['probable', 'ajustado', 'hoy_no'].includes(p.verdict), p.verdict);
  assert.match(p.range, /^\d+:\d\d–\d+:\d\d$/);
  const noTarget = racePrediction(runs, race({ type: 'half' }), { today: TODAY });
  assert.equal(noTarget.verdict, 'prevision');
  assert.match(noTarget.text, /^Tiempo previsto hoy: /);
  assert.equal(racePrediction(data([]), race(), { today: TODAY }).verdict, 'insuficiente');
  assert.equal(racePrediction(runs, race({ type: 'cycling', distanceKm: 100 }), { today: TODAY }), null, 'solo carreras a pie');
  const goal = { id: 'g1', kind: 'endurance', sport: 'run', distanceKm: 10, timeSec: 3000, title: '10 km en menos de 50 min', createdAt: tsFromDate(addDays(TODAY, -60), 9), archived: false, achievedAt: null };
  const lg = linkedGoalProgress(runs, race({ goalId: 'g1' }), [goal]);
  assert.equal(lg.goal.id, 'g1');
  assert.ok(lg.progress.statusLabel);
  assert.equal(linkedGoalProgress(runs, race({ goalId: 'nope' }), [goal]), null);
});

test('contexto del analista: los eventos de las próximas 26 semanas, con el más relevante', () => {
  const list = [race({ id: 'a', type: '10k', targetSec: 3000, date: addDays(TODAY, 73), name: 'San Silvestre' }), race({ id: 'z', date: addDays(TODAY, 300), priority: 'A' })];
  const rc = R.racesContext(list, TODAY);
  assert.deepEqual(rc.upcoming.map((x) => x.race.id), ['a']);
  assert.equal(rc.next.race.id, 'a');
  assert.equal(rc.next.weeks, 10);
  assert.match(rc.labels[0].text, /^San Silvestre \(10K\) · .* \(en 73 días\) · objetivo <50:00 · prioridad A$/);
  // analysisContext los recoge (y sin eventos sigue igual)
  const ctx = analysisContext({ context: [], sessions: [], races: list, today: TODAY });
  assert.equal(ctx.events.next.race.id, 'a');
  assert.ok(ctx.labels.some((l) => l.key === 'race:a'));
  const none = analysisContext({ context: [], sessions: [], today: TODAY });
  assert.deepEqual([none.events.next, none.events.upcoming], [null, []]);
});
