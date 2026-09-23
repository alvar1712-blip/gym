import test from 'node:test';
import assert from 'node:assert/strict';
import {
  templateDiff, applyTemplateDiff, inheritWeight, formatSet, targetText, prMessage, proposedDuration,
  finishSession, prefillFromLast, newSet, extraSet, warmupSet, validateSet, pendingCount, linkedActivities,
  itemFromSessionExercise,
} from '../../js/session-logic.js';
import { SEED_TEMPLATES } from '../../js/seed.js';
import { detectPRs, bestsForExercise } from '../../js/calc.js';

const D1 = SEED_TEMPLATES.find((t) => t.id === 'tpl_d1');
const D2 = SEED_TEMPLATES.find((t) => t.id === 'tpl_d2');

/** Sesión «tal cual la plantilla»: un ejercicio por ítem. */
function sessionFrom(tpl) {
  return {
    id: 's1', kind: 'strength', date: '2026-09-23', templateId: tpl.id,
    exercises: tpl.items.map((it, i) => ({
      id: `se${i}`, exerciseId: it.exerciseId, baseExerciseId: it.exerciseId, templateItemId: it.id,
      alternatives: [...(it.alternatives || [])], target: { sets: it.sets, repMin: it.repMin, repMax: it.repMax },
      section: it.section || '', sets: [],
    })),
  };
}
const names = { press_banca: 'Press banca', dominadas: 'Dominadas', curl_martillo: 'Curl martillo', press_militar: 'Press militar con barra' };
const nameOf = (id) => names[id];

test('templateDiff: sin cambios → []; elegir una alternativa definida no es un cambio', () => {
  assert.deepEqual(templateDiff(D1, sessionFrom(D1)), []);
  const s = sessionFrom(D2);
  const prensa = s.exercises.find((se) => se.exerciseId === 'prensa');
  prensa.exerciseId = 'hack_squat'; // alternativa definida
  assert.deepEqual(templateDiff(D2, s), []);
});

test('templateDiff: añadido, quitado, cambiado por no-alternativa y orden', () => {
  const s = sessionFrom(D1);
  // cambia Press banca por Press militar (no es alternativa)
  s.exercises[0].exerciseId = 'press_militar';
  // quita Face pull (ti_d1_6)
  s.exercises = s.exercises.filter((se) => se.templateItemId !== 'ti_d1_6');
  // añade Curl martillo al final
  s.exercises.push({ id: 'seX', exerciseId: 'curl_martillo', templateItemId: null, alternatives: [], target: { sets: 3 }, sets: [] });
  // intercambia Dominadas y Press inclinado
  [s.exercises[1], s.exercises[2]] = [s.exercises[2], s.exercises[1]];
  const ch = templateDiff(D1, s, { nameOf });
  const byType = Object.fromEntries(ch.map((c) => [c.type, c]));
  assert.equal(ch.length, 4);
  assert.equal(byType.swap.itemId, 'ti_d1_1');
  assert.equal(byType.swap.to, 'press_militar');
  assert.match(byType.swap.label, /Press banca.*Press militar/);
  assert.equal(byType.add.seId, 'seX');
  assert.equal(byType.add.label, 'Añadir «Curl martillo»');
  assert.equal(byType.remove.itemId, 'ti_d1_6');
  assert.equal(byType.order.id, 'order');
  // ids estables
  assert.deepEqual(ch.map((c) => c.id).sort(), ['add:seX', 'order', 'remove:ti_d1_6', 'swap:ti_d1_1']);
});

test('templateDiff: un ítem que se repite en la sesión cuenta como añadido', () => {
  const s = sessionFrom(D1);
  s.exercises.push({ ...s.exercises[0], id: 'dup' });
  const ch = templateDiff(D1, s);
  assert.deepEqual(ch.map((c) => c.id), ['add:dup']);
});

test('applyTemplateDiff: aplica todo sin mutar la plantilla original', () => {
  const before = JSON.stringify(D1);
  const s = sessionFrom(D1);
  s.exercises[0].exerciseId = 'press_militar';
  s.exercises = s.exercises.filter((se) => se.templateItemId !== 'ti_d1_6');
  const added = {
    id: 'seX', exerciseId: 'curl_martillo', templateItemId: null, alternatives: [], target: { sets: 3 }, section: '',
    sets: [
      { id: 'a', type: 'warmup', reps: 15, done: true },
      { id: 'b', type: 'effective', weight: 14, reps: 12, done: true },
      { id: 'c', type: 'effective', weight: 14, reps: 10, done: true },
    ],
  };
  // Curl martillo tras Dominadas (posición 2)
  s.exercises.splice(2, 0, added);
  [s.exercises[0], s.exercises[1]] = [s.exercises[1], s.exercises[0]]; // Dominadas primero
  const ch = templateDiff(D1, s);
  const out = applyTemplateDiff(D1, s, ch, { newId: () => 'ti_new' });
  assert.equal(JSON.stringify(D1), before, 'no muta la plantilla');
  const ids = out.items.map((i) => i.exerciseId);
  assert.deepEqual(ids, ['dominadas', 'press_militar', 'curl_martillo', 'press_inclinado_mancuerna', 'remo_pecho_apoyado', 'elevaciones_laterales', 'crunch_polea']);
  const nu = out.items.find((i) => i.id === 'ti_new');
  assert.equal(nu.sets, 2, 'series de trabajo hechas (sin calentamiento)');
  assert.equal(nu.repMin, 10);
  assert.equal(nu.repMax, 12);
  assert.deepEqual(nu.alternatives, []);
  // el ítem cambiado conserva id y objetivo
  const swapped = out.items.find((i) => i.id === 'ti_d1_1');
  assert.equal(swapped.exerciseId, 'press_militar');
  assert.equal(swapped.repMin, 4);
});

test('applyTemplateDiff: solo aplica los cambios elegidos', () => {
  const s = sessionFrom(D1);
  s.exercises = s.exercises.filter((se) => se.templateItemId !== 'ti_d1_7');
  s.exercises.push({ id: 'seX', exerciseId: 'curl_martillo', templateItemId: null, alternatives: [], target: { sets: 3, repMin: 10, repMax: 12 }, sets: [] });
  const out = applyTemplateDiff(D1, s, ['add:seX'], { newId: () => 'n1' });
  assert.equal(out.items.length, 8, 'el quitado sigue en la plantilla');
  assert.equal(out.items[5].exerciseId, 'face_pull');
  assert.equal(out.items[6].exerciseId, 'curl_martillo', 'añadido tras el anterior de la sesión (Face pull)');
  assert.equal(out.items[7].exerciseId, 'crunch_polea', 'el no quitado conserva su sitio');
  assert.equal(out.items[6].sets, 3);
  assert.equal(out.items[6].repMin, 10);
  const out2 = applyTemplateDiff(D1, s, ['remove:ti_d1_7']);
  assert.deepEqual(out2.items.map((i) => i.id), D1.items.slice(0, 6).map((i) => i.id));
  assert.equal(applyTemplateDiff(D1, s, []).items.length, 7);
});

test('applyTemplateDiff: reordenar deja en su hueco los ítems que no están en la sesión', () => {
  const s = sessionFrom(D1);
  // quita Dominadas (no se aplica) y pone Crunch al principio
  s.exercises = s.exercises.filter((se) => se.templateItemId !== 'ti_d1_2');
  const crunch = s.exercises.pop();
  s.exercises.unshift(crunch);
  const out = applyTemplateDiff(D1, s, ['order']);
  assert.deepEqual(out.items.map((i) => i.id), ['ti_d1_7', 'ti_d1_2', 'ti_d1_1', 'ti_d1_3', 'ti_d1_4', 'ti_d1_5', 'ti_d1_6']);
});

test('inheritWeight: las pendientes con el mismo peso heredan el nuevo', () => {
  const sets = [
    { id: 1, type: 'effective', weight: 80, done: true },
    { id: 2, type: 'effective', weight: 80, done: false },
    { id: 3, type: 'effective', weight: 77.5, done: false },
    { id: 4, type: 'effective', weight: 80, done: false },
    { id: 5, type: 'warmup', weight: 80, done: false },
  ];
  // la 1 estaba prellenada con 80 y se confirmó con 82,5
  sets[0].weight = 82.5;
  const n = inheritWeight(sets, 0, 80, 82.5);
  assert.equal(n, 2);
  assert.deepEqual(sets.map((s) => s.weight), [82.5, 82.5, 77.5, 82.5, 80]);
  // sin cambio de peso no toca nada
  assert.equal(inheritWeight(sets, 1, 82.5, 82.5), 0);
  // de null a un peso (primera vez)
  const s2 = [{ type: 'effective', weight: 20, done: true }, { type: 'effective', weight: null, done: false }];
  assert.equal(inheritWeight(s2, 0, null, 20), 1);
  assert.equal(s2[1].weight, 20);
  // no toca series ya hechas ni anteriores
  const s3 = [{ type: 'effective', weight: 60, done: false }, { type: 'effective', weight: 62.5, done: true }, { type: 'effective', weight: 60, done: true }];
  assert.equal(inheritWeight(s3, 1, 60, 62.5), 0);
  assert.equal(s3[0].weight, 60);
});

test('formatSet por tipo de registro', () => {
  assert.equal(formatSet({ weight: 80, reps: 6, rir: 2 }, 'weight_reps'), '80×6 @2');
  assert.equal(formatSet({ weight: 77.5, reps: 6, rir: 1 }, 'weight_reps'), '77,5×6 @1');
  assert.equal(formatSet({ weight: 80, reps: 6, rir: 'F' }, 'weight_reps', { kg: true }), '80 kg × 6 @F');
  assert.equal(formatSet({ weight: 10, reps: 8, rir: 1 }, 'bodyweight'), '+10 kg × 8 @1');
  assert.equal(formatSet({ weight: -15, reps: 6 }, 'bodyweight'), '−15 kg asist. × 6');
  assert.equal(formatSet({ weight: 0, reps: 12 }, 'bodyweight'), '12 reps');
  assert.equal(formatSet({ weight: 20, reps: 10, repsR: 9 }, 'unilateral', { rir: false }), '20 kg × 10/9');
  assert.equal(formatSet({ timeSec: 45 }, 'time'), '45 s');
  assert.equal(formatSet({ timeSec: 90, weight: 10 }, 'time'), '1:30 min · +10 kg');
  assert.equal(formatSet({ distanceM: 20, timeSec: 3.4 }, 'distance_time'), '20 m en 3,4 s');
  assert.equal(formatSet({ reps: 3, heightCm: 45 }, 'jumps'), '3 reps · 45 cm');
  assert.equal(formatSet({ reps: 20 }, 'jumps'), '20 reps');
});

test('targetText', () => {
  assert.equal(targetText({ sets: 3, repMin: 4, repMax: 6 }, 'weight_reps'), '3×4–6');
  assert.equal(targetText({ sets: 2, setsMax: 3, distance: 30 }, 'distance_time'), '2–3×30 m');
  assert.equal(targetText({ sets: 4, distance: 20 }, 'distance_time'), '4×20 m');
  assert.equal(targetText({ sets: 3, timeMin: 30, timeMax: 45 }, 'time'), '3×30–45 s');
  assert.equal(targetText({ sets: 2, repMin: 8, repMax: 8 }, 'unilateral'), '2×8/lado');
  assert.equal(targetText({ sets: 1, timeMin: 1800, timeMax: 2700 }, 'cardio'), '30–45 min');
  assert.equal(targetText({ sets: 3 }, 'time'), '3 series');
  assert.equal(targetText({ sets: 3, setsMax: 4 }, 'distance_time'), '3–4 series');
  assert.equal(targetText({ sets: 3, repMin: 3, repMax: 3 }, 'jumps'), '3×3');
  assert.equal(targetText({}, 'weight_reps'), '');
});

test('prMessage con los récords de calc', () => {
  const ex = { id: 'press_banca', name: 'Press banca', logType: 'weight_reps' };
  const hist = [{ id: 'h', kind: 'strength', date: '2026-09-01', exercises: [{ exerciseId: 'press_banca', sets: [{ id: 'x', type: 'effective', weight: 80, reps: 6, rir: 2, done: true }] }] }];
  const bests = bestsForExercise(hist, 'press_banca', ex);
  const heavier = detectPRs({ type: 'effective', weight: 85, reps: 5, rir: 1, done: true }, ex, bests);
  assert.equal(prMessage(heavier, ex), '🏆 Récord: 85 kg en Press banca · 1RM est. 102 kg');
  const moreReps = detectPRs({ type: 'effective', weight: 80, reps: 8, rir: 0, done: true }, ex, bests);
  assert.match(prMessage(moreReps, ex), /^🏆 Récord: 8 reps con 80 kg en Press banca/);
  const onlyE1 = [{ kind: 'e1rm', value: 98.33, prev: 96 }];
  assert.equal(prMessage(onlyE1, ex), '🏆 Récord de 1RM estimado: 98,3 kg en Press banca');
  // calentamiento: nunca es récord
  assert.deepEqual(detectPRs({ type: 'warmup', weight: 100, reps: 5, done: true }, ex, bests), []);
});

test('prefill: series de trabajo de la última vez, en orden; sin historial usa el objetivo', () => {
  const se = { target: { sets: 3, repMin: 4, repMax: 6 } };
  const last = { sets: [
    { type: 'warmup', weight: 40, reps: 8, done: true },
    { type: 'effective', weight: 80, reps: 6, rir: 2, done: true },
    { type: 'effective', weight: 80, reps: 5, rir: 1, done: true },
  ] };
  const sets = prefillFromLast(last, se, 3, 'weight_reps');
  assert.deepEqual(sets.map((s) => [s.weight, s.reps, s.rir, s.done, s.type]), [
    [80, 6, 2, false, 'effective'], [80, 5, 1, false, 'effective'], [80, 5, 1, false, 'effective'],
  ]);
  const fresh = prefillFromLast(null, se, 2, 'weight_reps');
  assert.deepEqual(fresh.map((s) => [s.weight, s.reps]), [[null, 4], [null, 4]]);
  const uni = newSet(null, { target: { repMin: 8 } }, 'unilateral');
  assert.equal(uni.repsR, 8);
  assert.equal(newSet(null, { target: { repMin: 8 } }, 'weight_reps').repsR, null);
});

test('extraSet y warmupSet', () => {
  const se = { target: { sets: 2 }, sets: [
    { type: 'effective', weight: 60, reps: 8, rir: 2, done: true },
    { type: 'effective', weight: 62.5, reps: 7, rir: 1, done: true },
  ] };
  const x = extraSet(se, null, 'weight_reps');
  assert.deepEqual([x.weight, x.reps, x.rir, x.done], [62.5, 7, 1, false]);
  const seP = { target: {}, sets: [{ type: 'effective', weight: 100, reps: 5, done: false }] };
  const w = warmupSet(seP, null, 'weight_reps');
  assert.equal(w.index, 0);
  assert.equal(w.set.type, 'warmup');
  assert.equal(w.set.weight, 50);
  assert.equal(w.set.rir, null);
  const w2 = warmupSet(seP, { sets: [{ type: 'warmup', weight: 40, reps: 10, done: true }] }, 'weight_reps');
  assert.equal(w2.set.weight, 40);
  assert.equal(w2.set.reps, 10);
});

test('validateSet', () => {
  assert.equal(validateSet({ reps: 5 }, 'weight_reps'), null);
  assert.ok(validateSet({ reps: null }, 'weight_reps'));
  assert.equal(validateSet({ timeSec: 30 }, 'time'), null);
  assert.ok(validateSet({ timeSec: null }, 'time'));
  assert.equal(validateSet({ reps: null, repsR: 8 }, 'unilateral'), null);
});

test('proposedDuration resta las actividades enlazadas; sesión pasada → null', () => {
  const now = Date.UTC(2026, 8, 23, 19, 0);
  const s = { id: 's1', startedAt: now - 95 * 60000 };
  const acts = [{ kind: 'run', parentId: 's1', movingSec: 1800, durationMin: 30 }];
  assert.deepEqual(proposedDuration(s, acts, now), { elapsedMin: 95, activitiesMin: 30, proposed: 65 });
  assert.deepEqual(proposedDuration(s, [], now), { elapsedMin: 95, activitiesMin: 0, proposed: 95 });
  assert.equal(proposedDuration({ startedAt: null }, [], now).proposed, null);
  const all = [...acts, { kind: 'strength', parentId: 's1' }, { kind: 'bike', parentId: 'otra' }];
  assert.equal(linkedActivities(s, all).length, 1);
});

test('finishSession: descarta pendientes y cierra', () => {
  const s = {
    id: 's1', status: 'active', startedAt: 1000, notes: '',
    exercises: [{ sets: [{ done: true }, { done: false }] }, { sets: [{ done: false }] }],
  };
  assert.equal(pendingCount(s), 2);
  const n = finishSession(s, { durationMin: 52.4, rpe: 8, notes: 'Bien', now: 5000 });
  assert.equal(n, 2);
  assert.equal(s.status, 'done');
  assert.equal(s.endedAt, 5000);
  assert.equal(s.durationMin, 52);
  assert.equal(s.rpe, 8);
  assert.equal(s.notes, 'Bien');
  assert.equal(pendingCount(s), 0);
  const past = { startedAt: null, exercises: [] };
  finishSession(past, { durationMin: null, rpe: 11 });
  assert.equal(past.endedAt, null);
  assert.equal(past.rpe, null);
});

test('itemFromSessionExercise usa el objetivo si lo hay', () => {
  const it = itemFromSessionExercise({ exerciseId: 'plancha', section: 'Core', target: { sets: 3, timeMin: 30, timeMax: 45 }, sets: [] }, 'x');
  assert.deepEqual(it, { id: 'x', exerciseId: 'plancha', alternatives: [], sets: 3, notes: '', section: 'Core', groupId: null, groupType: null, timeMin: 30, timeMax: 45 });
});
