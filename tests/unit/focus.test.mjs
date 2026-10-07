// «Lo importante esta semana» (js/focus.js, docs/PULIDO.md §6): un principal y hasta dos secundarios, sin repetir
// tema entre el panel semanal y el analista, cada uno con un único paso siguiente; sin avisos, «no necesitas cambiar
// nada». Mensajes sintéticos con la forma de insights.js y analysis.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekFocus, nextStep, topicOf, STEPS, ALL_GOOD } from '../../js/focus.js';

const why = { rule: 'regla', data: [{ label: 'x', value: '1' }] };
const wk = (id, level, extra = {}) => ({ id, section: 'info', level, title: `wk ${id}`, text: 't', why, ...extra });
const an = (id, level, area, priority = 50, extra = {}) => ({ id, area, level, priority, title: `an ${id}`, text: 't', why, ...extra });

test('como mucho 3: el principal es el aviso más importante; nunca dos del mismo tema', () => {
  const r = weekFocus({
    weekly: [wk('ex-stalled', 'warn'), wk('muscles-below', 'warn'), wk('ex-progress', 'good'), wk('load', 'neutral')],
    analysis: [an('strength-stalled-press_banca', 'warn', 'strength', 70), an('recovery-sleep', 'warn', 'recovery', 60), an('weight-rate', 'good', 'weight', 40)],
  });
  assert.equal(r.items.length, 3);
  assert.equal(r.allGood, false);
  assert.equal(r.message, null);
  const topics = r.items.map((i) => i.topic);
  assert.equal(new Set(topics).size, topics.length, `temas repetidos: ${topics}`);
  // Fuerza la dicen los dos: se queda la del analista (lleva confianza y fuentes)
  const strength = r.items.find((i) => i.topic === 'strength');
  assert.equal(strength.source, 'analysis');
  assert.ok(r.items.every((i) => i.level === 'warn'), 'con tres avisos, lo que va bien no entra');
});

test('lo informativo no ocupa un hueco: con dos avisos y una nota, salen los dos avisos', () => {
  const r = weekFocus({ analysis: [an('weight-rate', 'warn', 'weight', 60), an('strength-down-x', 'warn', 'strength', 55), an('forecast-x', 'info', 'forecast', 50)] });
  assert.deepEqual(r.items.map((i) => i.id), ['weight-rate', 'strength-down-x']);
});

test('cada mensaje lleva un único paso siguiente de la lista', () => {
  assert.equal(nextStep(wk('muscles-above', 'warn')), 'reduce');
  assert.equal(nextStep(wk('muscles-below', 'warn')), 'add');
  assert.equal(nextStep(wk('ex-stalled', 'warn')), 'recheck');
  assert.equal(nextStep(wk('dp-up-press', 'good')), 'up');
  assert.equal(nextStep(wk('dp-hold-press', 'neutral')), 'keep');
  assert.equal(nextStep(an('recovery-sleep', 'warn', 'recovery')), 'recover');
  assert.equal(nextStep(an('strength-volume', 'warn', 'strength', 58, { title: 'Reduce un poco el volumen de pecho' })), 'reduce');
  assert.equal(nextStep(an('strength-volume', 'warn', 'strength', 44, { title: 'Puedes añadir 1–2 series de pecho' })), 'add');
  assert.equal(nextStep(an('weight-insufficient', 'neutral', 'weight')), 'data');
  assert.equal(nextStep(an('weight-rate', 'warn', 'weight', 50, { confidence: { level: 'insufficient' } })), 'data');
  assert.equal(nextStep(an('endurance-fitness', 'good', 'endurance')), 'keep');
  assert.equal(nextStep(an('cycle-length', 'neutral', 'cycle')), 'none');
  for (const k of ['keep', 'none', 'data', 'recheck', 'recover', 'reduce', 'add', 'up']) assert.ok(STEPS[k]);
  const r = weekFocus({ weekly: [wk('muscles-above', 'warn')] });
  assert.deepEqual([r.items[0].step, r.items[0].stepLabel], ['reduce', 'Reduce 1–2 series']);
});

test('sin avisos: «Todo evoluciona dentro de lo esperado…» y, como mucho, dos cosas que van bien (nada informativo)', () => {
  const r = weekFocus({
    weekly: [wk('ex-progress', 'good'), wk('load', 'neutral'), wk('km', 'neutral')],
    analysis: [an('weight-rate', 'good', 'weight'), an('endurance-fitness', 'good', 'endurance'), an('cycle-length', 'neutral', 'cycle')],
  });
  assert.equal(r.allGood, true);
  assert.equal(r.message, ALL_GOOD);
  assert.equal(r.items.length, 2);
  assert.ok(r.items.every((i) => i.level === 'good' && i.step === 'keep'));
});

test('«Puedes subir peso» cuenta como importante (es una acción), aunque sea buena noticia', () => {
  const r = weekFocus({ weekly: [{ ...wk('dp-up-summary', 'good'), section: 'suggestion' }, wk('ex-progress', 'good')] });
  assert.equal(r.allGood, false);
  assert.equal(r.items[0].id, 'dp-up-summary');
  assert.equal(r.items[0].stepLabel, 'Sube el peso');
});

test('nada que decir → sin elementos; los «faltan datos» del analista y el check-in semanal no entran', () => {
  assert.deepEqual(weekFocus({}).items, []);
  const r = weekFocus({ weekly: [wk('checkins', 'neutral')], analysis: [an('strength-insufficient', 'neutral', 'strength', 30)] });
  assert.deepEqual(r.items, []);
  assert.equal(r.allGood, true);
});

test('temas: el mismo asunto en las dos fuentes cae en el mismo tema', () => {
  assert.equal(topicOf(wk('ex-stalled', 'warn')), topicOf(an('strength-stalled-press', 'warn', 'strength')));
  assert.equal(topicOf(wk('muscles-below', 'warn')), topicOf(an('strength-volume', 'warn', 'strength')));
  assert.equal(topicOf(wk('load', 'warn')), topicOf(an('load-sport', 'warn', 'endurance')));
  assert.notEqual(topicOf(an('weight-rate', 'warn', 'weight')), topicOf(an('recovery-sleep', 'warn', 'recovery')));
});

test('si el analista ya dice qué hacer, esa es la acción (no una genérica que la contradiga) y no se repite en el texto', () => {
  const parts = { observation: 'Tu peso está estable.', interpretation: 'Para ganar músculo conviene subir un poco.', recommendation: 'Come unas 150–250 kcal más al día y revisa en 3 semanas.' };
  const ins = an('weight-rate', 'warn', 'weight', 60, { parts, text: `${parts.observation} ${parts.interpretation} ${parts.recommendation}` });
  const [it] = weekFocus({ analysis: [ins] }).items;
  assert.equal(it.stepLabel, parts.recommendation);
  assert.equal(it.text, 'Tu peso está estable. Para ganar músculo conviene subir un poco.');
  assert.doesNotMatch(it.stepLabel, /una semana/);
});

test('el destino de cada uno: su acción si la tiene; si no, su pantalla', () => {
  const r = weekFocus({ weekly: [wk('muscles-above', 'warn')], analysis: [an('recovery-sleep', 'warn', 'recovery', 60, { action: { label: 'x', href: '#/cycle' } })] });
  assert.deepEqual(r.items.map((i) => i.href).sort(), ['#/cycle', '#/weekly']);
});
