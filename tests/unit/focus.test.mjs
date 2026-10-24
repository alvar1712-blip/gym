// «Lo importante esta semana» (js/focus.js, docs/PULIDO.md §6): un principal y hasta dos secundarios, sin repetir
// tema entre el panel semanal y el analista, cada uno con un único paso siguiente; sin avisos, «no necesitas cambiar
// nada». Mensajes sintéticos con la forma de insights.js y analysis.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekFocus, nextStep, topicOf, STEPS, ALL_GOOD, FEW_DATA, shortParagraphs } from '../../js/focus.js';

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
  // Ronda 9: sin nada evaluado no se afirma «Todo evoluciona dentro de lo esperado»
  assert.equal(r.allGood, false);
  assert.equal(r.fewData, true);
  assert.equal(r.message, FEW_DATA);
});

test('ronda 9: solo «faltan datos», notas o confianza insuficiente → «Aún pocos datos…», nunca «Todo evoluciona…»', () => {
  const r = weekFocus({
    weekly: [wk('load', 'neutral'), wk('km', 'neutral'), wk('checkins', 'neutral')],
    analysis: [an('weight-insufficient', 'neutral', 'weight', 30), an('strength-insufficient', 'info', 'strength', 12), an('forecast-weight', 'info', 'forecast', 34),
      an('strength-summary', 'good', 'strength', 62, { confidence: { level: 'insufficient', label: 'Datos insuficientes' } })],
  });
  assert.notEqual(r.message, ALL_GOOD);
  assert.equal(r.message, FEW_DATA);
  assert.equal(r.allGood, false);
  // Con un solo mensaje que valora (del panel o del analista), vuelve «Todo evoluciona…»
  assert.equal(weekFocus({ weekly: [wk('ex-progress', 'good')], analysis: [an('weight-insufficient', 'neutral', 'weight', 30)] }).message, ALL_GOOD);
  assert.equal(weekFocus({ analysis: [an('strength-summary', 'neutral', 'strength', 62, { confidence: { level: 'medium' } })] }).message, ALL_GOOD);
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

// Tarjeta plegable (PULIDO §33): el texto desplegado va en párrafos cortos sin perder nada
test('shortParagraphs: una frase por párrafo, las cortas se juntan y no se pierde ni un carácter', () => {
  const t = 'Vas mejorando en 2 de 12 ejercicios principales; el que más, Press banca +2,6 %/sem. Tu ritmo típico es −0,38 %/sem, por debajo de lo habitual para tu nivel (intermedia: +0,25 % a +0,75 %/sem). 3 estancados y 6 bajando: en cada uno tienes qué probar. En 1 ejercicio sigues por debajo de tu mejor marca anterior: es compatible con recuperar rendimiento que ya tenías.';
  const p = shortParagraphs(t);
  assert.strictEqual(p.join(' '), t, 'unidos, el texto original');
  assert.strictEqual(p.length, 4);
  assert.match(p[2], /^3 estancados/, 'corta también antes de una cifra');
  // «1RM est. baja»: no se corta tras una abreviatura seguida de minúscula
  assert.deepStrictEqual(shortParagraphs('Su 1RM est. baja un 2,8 % por semana: de ~65,8 kg a ~57,8 kg en 5 semanas.'), ['Su 1RM est. baja un 2,8 % por semana: de ~65,8 kg a ~57,8 kg en 5 semanas.']);
  // Una frase corta se queda con su vecina (nada de párrafos de tres palabras)
  assert.deepStrictEqual(shortParagraphs('Bien hecho. Sigue así con la misma carga durante las próximas dos semanas, sin cambios.'), ['Bien hecho. Sigue así con la misma carga durante las próximas dos semanas, sin cambios.']);
  assert.deepStrictEqual(shortParagraphs(''), []);
  assert.deepStrictEqual(shortParagraphs(null), []);
});

// ---------------------------------------------------------------------------
// Ronda 11 (bloque 6): la confianza influye en la prioridad, sin esconder avisos
// ---------------------------------------------------------------------------

test('R11 · entre avisos igual de graves va primero el mejor respaldado; el de confianza baja sigue saliendo', () => {
  const conf = (level) => ({ level });
  const r = weekFocus({
    analysis: [
      an('weight-rate', 'warn', 'weight', 70, { confidence: conf('low') }),
      an('recovery-sleep', 'warn', 'recovery', 60, { confidence: conf('high') }),
      an('strength-down-x', 'warn', 'strength', 62, { confidence: conf('medium') }),
    ],
  });
  assert.deepEqual(r.items.map((i) => i.id), ['recovery-sleep', 'strength-down-x', 'weight-rate'], 'alta, media y, al final, la baja (aunque su prioridad bruta sea la mayor)');
  assert.equal(r.items.length, 3, 'ningún aviso desaparece por tener poca base');
});

test('R11 · un aviso de confianza baja, solo, sigue siendo el principal; no se prescribe tocar series con datos flojos', () => {
  const r = weekFocus({ analysis: [an('strength-volume', 'warn', 'strength', 58, { title: 'Reduce un poco el volumen de pecho', confidence: { level: 'low' } })] });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].level, 'warn');
  assert.equal(r.items[0].step, 'recheck', 'en vez de «Reduce 1–2 series»: primero se reevalúa');
  assert.equal(r.items[0].stepLabel, STEPS.recheck);
  // Con confianza media o alta, la acción de siempre
  const ok = weekFocus({ analysis: [an('strength-volume', 'warn', 'strength', 58, { title: 'Reduce un poco el volumen de pecho', confidence: { level: 'medium' } })] });
  assert.equal(ok.items[0].step, 'reduce');
  // Un aviso de recuperación o de energía baja mantiene su paso (es de seguridad, no de ajuste de series)
  const rec = weekFocus({ analysis: [an('recovery-sleep', 'warn', 'recovery', 60, { confidence: { level: 'low' } })] });
  assert.equal(rec.items[0].step, 'recover');
});

test('R11 · el mismo tema lo dicen los dos motores: sigue ganando el del analista (lleva su confianza); la confianza ordena los temas', () => {
  const r = weekFocus({
    weekly: [wk('ex-stalled', 'warn')],
    analysis: [an('strength-stalled-press_banca', 'warn', 'strength', 70, { confidence: { level: 'low' } }), an('recovery-sleep', 'warn', 'recovery', 50, { confidence: { level: 'high' } })],
  });
  assert.equal(r.items.length, 2);
  assert.equal(r.items.find((i) => i.topic === 'strength').source, 'analysis', 'el tema no cambia de motor por su confianza (Hoy sigue enseñando la confianza del analista)');
  assert.deepEqual(r.items.map((i) => i.topic), ['recovery', 'strength'], 'pero entre temas va antes el mejor respaldado');
});

test('R11 · pickKeyPoints: la prioridad se ajusta por confianza (baja pesa menos, alta algo más), sin descartar nada', async () => {
  const { pickKeyPoints } = await import('../../js/analysis.js');
  const mk = (id, area, priority, level) => ({ id, area, level: 'warn', priority, title: id, text: 't', why, confidence: { level } });
  const list = [mk('a-low', 'weight', 70, 'low'), mk('b-medium', 'strength', 62, 'medium'), mk('c-high', 'recovery', 58, 'high'), mk('d-low', 'endurance', 66, 'low')];
  // Con hueco para 3 de 4 (áreas distintas): queda fuera el peor respaldado ajustado (d-low: 66 − 14 = 52), no el de menor prioridad bruta (c-high: 58)
  assert.deepEqual(pickKeyPoints(list, 3).map((i) => i.id), ['a-low', 'b-medium', 'c-high'], 'se muestran por prioridad bruta');
  assert.ok(!pickKeyPoints(list, 3).some((i) => i.id === 'd-low'));
  assert.equal(pickKeyPoints([mk('solo-low', 'weight', 70, 'low')], 3).length, 1, 'un aviso de confianza baja, solo, entra');
});
