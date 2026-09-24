// Pruebas de la lógica del check-in (js/checkin-logic.js; js/checkin.js la reexporta).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS, FIELD_KEYS, LEVEL_OPTIONS, level, checkinFor, hasValues, isComplete, isLowCheckin, lowReasons, valueWord,
  valueText, checkinText, newCheckin, applyValue, checkinsBetween, summary, dismissKey,
} from '../../js/checkin-logic.js';
import { isLowCheckin as insightsIsLow } from '../../js/insights.js';

const ck = (id, date, timing, sleep, energy, soreness, extra = {}) => ({ id, date, timing, sessionId: null, sleep, energy, soreness, createdAt: 1, ...extra });

test('tres preguntas con tres opciones Bajo · Normal · Alto (1/2/3)', () => {
  assert.deepEqual(FIELD_KEYS, ['sleep', 'energy', 'soreness']);
  assert.deepEqual(FIELDS.map((f) => f.label), ['Sueño', 'Energía', 'Agujetas']);
  assert.deepEqual(LEVEL_OPTIONS, [{ value: 1, label: 'Bajo' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Alto' }]);
  assert.deepEqual([level(1), level(2), level(3)], [1, 2, 3]);
  for (const bad of [0, 4, '2', null, undefined, 2.5, NaN]) assert.equal(level(bad), null, String(bad));
});

test('checkinFor: el del día y momento; array, Map o iterable; el editado más tarde si hubiera varios', () => {
  const list = [
    ck('a', '2026-09-24', 'pre', 2, 2, 2),
    ck('b', '2026-09-24', 'post', 1, 1, 3),
    ck('c', '2026-09-23', 'pre', 3, 3, 1),
  ];
  assert.equal(checkinFor(list, '2026-09-24', 'pre').id, 'a');
  assert.equal(checkinFor(list, '2026-09-24', 'post').id, 'b');
  assert.equal(checkinFor(list, '2026-09-23', 'post'), null);
  assert.equal(checkinFor(list, '2026-09-22', 'pre'), null);
  // sin momento: el de antes y, si no hay, el de después
  assert.equal(checkinFor(list, '2026-09-24').id, 'a');
  assert.equal(checkinFor([list[1]], '2026-09-24').id, 'b');
  // Map (como store) e iterable
  assert.equal(checkinFor(new Map(list.map((c) => [c.id, c])), '2026-09-23', 'pre').id, 'c');
  assert.equal(checkinFor(new Set(list), '2026-09-24', 'post').id, 'b');
  // duplicados (copias antiguas): manda el editado más tarde
  const dup = [ck('x', '2026-09-24', 'pre', 1, 1, 1, { updatedAt: 50 }), ck('y', '2026-09-24', 'pre', 2, 2, 2, { updatedAt: 90 }), ck('z', '2026-09-24', 'pre', 3, 3, 3, { createdAt: 70 })];
  assert.equal(checkinFor(dup, '2026-09-24', 'pre').id, 'y');
  // entradas raras
  assert.equal(checkinFor(null, '2026-09-24', 'pre'), null);
  assert.equal(checkinFor([null, undefined, {}], '2026-09-24', 'pre'), null);
  assert.equal(checkinFor(list, 'ayer', 'pre'), null);
});

test('isLowCheckin: sueño bajo, energía baja o agujetas altas (igual que la sugerencia de descarga)', () => {
  assert.equal(isLowCheckin(ck('a', '2026-09-24', 'pre', 1, 2, 2)), true);
  assert.equal(isLowCheckin(ck('a', '2026-09-24', 'pre', 2, 1, 2)), true);
  assert.equal(isLowCheckin(ck('a', '2026-09-24', 'pre', 2, 2, 3)), true);
  assert.equal(isLowCheckin(ck('a', '2026-09-24', 'pre', 2, 2, 2)), false);
  assert.equal(isLowCheckin(ck('a', '2026-09-24', 'pre', 3, 3, 1)), false, 'agujetas bajas no es «bajo»');
  assert.equal(isLowCheckin(ck('a', '2026-09-24', 'pre', null, null, null)), false);
  assert.equal(isLowCheckin(null), false);
  // Mismo criterio que js/insights.js en las 64 combinaciones (con valores sin contestar)
  const vals = [null, 1, 2, 3];
  for (const s of vals) for (const e of vals) for (const so of vals) {
    const c = ck('a', '2026-09-24', 'pre', s, e, so);
    assert.equal(isLowCheckin(c), insightsIsLow(c), JSON.stringify([s, e, so]));
  }
  assert.deepEqual(lowReasons(ck('a', '2026-09-24', 'pre', 1, 1, 3)), ['sueño bajo', 'energía baja', 'agujetas altas']);
  assert.deepEqual(lowReasons(ck('a', '2026-09-24', 'pre', 2, 3, 1)), []);
  assert.deepEqual(lowReasons(null), []);
});

test('hasValues / isComplete', () => {
  assert.equal(hasValues(ck('a', '2026-09-24', 'pre', null, 2, null)), true);
  assert.equal(hasValues(ck('a', '2026-09-24', 'pre', null, null, null)), false);
  assert.equal(hasValues(ck('a', '2026-09-24', 'pre', 0, 5, 'x')), false, 'valores fuera de 1–3 no cuentan');
  assert.equal(hasValues(null), false);
  assert.equal(isComplete(ck('a', '2026-09-24', 'pre', 1, 2, 3)), true);
  assert.equal(isComplete(ck('a', '2026-09-24', 'pre', 1, 2, null)), false);
  assert.equal(isComplete(null), false);
});

test('textos concordados: «Sueño normal · Energía alta · Agujetas bajas»', () => {
  assert.equal(checkinText(ck('a', '2026-09-24', 'pre', 2, 3, 1)), 'Sueño normal · Energía alta · Agujetas bajas');
  assert.equal(checkinText(ck('a', '2026-09-24', 'pre', 1, 1, 3)), 'Sueño bajo · Energía baja · Agujetas altas');
  assert.equal(checkinText(ck('a', '2026-09-24', 'pre', null, 2, 2)), 'Energía normal · Agujetas normales');
  assert.equal(checkinText(ck('a', '2026-09-24', 'pre', null, null, null)), '');
  assert.equal(checkinText(null), '');
  assert.deepEqual(['sleep', 'energy', 'soreness'].map((k) => valueWord(k, 3)), ['Alto', 'Alta', 'Altas']);
  assert.equal(valueWord('energy', null), null);
  assert.equal(valueText('soreness', 1), 'agujetas bajas');
  assert.equal(valueText('nada', 1), null);
});

test('newCheckin: forma del registro de la store «checkins»', () => {
  const c = newCheckin({ date: '2026-09-24', timing: 'post', sessionId: 's1' }, 1234, 'ci_1');
  assert.deepEqual(c, { id: 'ci_1', date: '2026-09-24', timing: 'post', sessionId: 's1', sleep: null, energy: null, soreness: null, createdAt: 1234 });
  const d = newCheckin({ date: '2026-09-24', timing: 'raro' }, 1);
  assert.equal(d.timing, 'pre');
  assert.equal(d.sessionId, null);
  assert.match(d.id, /^ci_/);
  assert.notEqual(newCheckin({ date: '2026-09-24' }).id, newCheckin({ date: '2026-09-24' }).id);
});

test('applyValue: uno por día y momento (crea el primero y después edita el mismo)', () => {
  const store = [];
  const key = { date: '2026-09-24', timing: 'pre', sessionId: 's1' };
  // 1.er toque: crea
  let r = applyValue(store, key, 'sleep', 2, 100);
  assert.equal(r.created, true);
  assert.equal(r.empty, false);
  assert.deepEqual([r.record.date, r.record.timing, r.record.sessionId, r.record.sleep, r.record.energy, r.record.soreness, r.record.createdAt], ['2026-09-24', 'pre', 's1', 2, null, null, 100]);
  store.push(r.record);
  const id = r.record.id;
  // 2.º y 3.er toque: el mismo registro
  r = applyValue(store, key, 'energy', 3);
  assert.equal(r.created, false);
  assert.equal(r.record.id, id);
  r = applyValue(store, key, 'soreness', 1);
  assert.equal(r.record, store[0], 'muta el existente');
  assert.equal(isComplete(store[0]), true);
  // editar
  applyValue(store, key, 'energy', 1);
  assert.equal(store[0].energy, 1);
  assert.equal(store.length, 1);
  // otro momento del mismo día: otro registro
  const post = applyValue(store, { ...key, timing: 'post' }, 'sleep', 2);
  assert.equal(post.created, true);
  assert.notEqual(post.record.id, id);
  // quitar valores (null): cuando no queda ninguno, empty
  applyValue(store, key, 'sleep', null);
  applyValue(store, key, 'energy', null);
  r = applyValue(store, key, 'soreness', null);
  assert.equal(r.empty, true);
  // sin registro y sin valor: no crea nada
  r = applyValue([], key, 'sleep', null);
  assert.deepEqual(r, { record: null, created: false, empty: true });
  // valor inválido = quitarlo
  r = applyValue([], key, 'sleep', 7);
  assert.equal(r.record, null);
  // enlaza la sesión si el check-in se hizo antes sin ella (p. ej. desde Hoy)
  const loose = [ck('h', '2026-09-24', 'pre', 2, null, null)];
  applyValue(loose, { date: '2026-09-24', timing: 'pre', sessionId: 's9' }, 'energy', 2);
  assert.equal(loose[0].sessionId, 's9');
  // no cambia una sesión ya enlazada
  applyValue(loose, { date: '2026-09-24', timing: 'pre', sessionId: 's10' }, 'energy', 3);
  assert.equal(loose[0].sessionId, 's9');
  assert.throws(() => applyValue([], key, 'humor', 1), /desconocido/);
});

test('checkinsBetween / summary: periodo incluido, orden y recuento de bajos', () => {
  const list = [
    ck('1', '2026-09-21', 'post', 2, 2, 3), // bajo (agujetas altas)
    ck('2', '2026-09-21', 'pre', 1, 2, 2), // bajo (sueño bajo)
    ck('3', '2026-09-23', 'pre', 2, 3, 1),
    ck('4', '2026-09-27', 'pre', 3, 3, 1), // fin del periodo (incluido)
    ck('5', '2026-09-28', 'pre', 1, 1, 3), // fuera
    ck('6', '2026-09-20', 'pre', 1, 1, 1), // fuera
    ck('7', '2026-09-22', 'pre', null, null, null), // vacío: no cuenta
    { id: '8', date: 'mal', timing: 'pre', sleep: 1 },
    null,
  ];
  assert.deepEqual(checkinsBetween(list, '2026-09-21', '2026-09-27').map((c) => c.id), ['2', '1', '3', '4'], 'por fecha, antes y después');
  assert.deepEqual(checkinsBetween(list).map((c) => c.id), ['6', '2', '1', '3', '4', '5'], 'sin límites');

  const s = summary(list, '2026-09-21', '2026-09-27');
  assert.equal(s.count, 4);
  assert.equal(s.days, 3);
  assert.equal(s.low, 2);
  assert.equal(s.lowShare, 0.5);
  assert.equal(s.mostlyLow, true, 'la mitad cuenta como «predominan los bajos»');
  assert.deepEqual(s.lowBy, { sleep: 1, energy: 0, soreness: 1 });
  assert.deepEqual(s.fields.sleep, { n: 4, counts: { 1: 1, 2: 2, 3: 1 }, mean: 2 });
  assert.deepEqual(s.fields.soreness.counts, { 1: 2, 2: 1, 3: 1 });
  assert.equal(s.fields.energy.mean, 2.5);
  assert.equal(s.text, '4 check-ins · 2 bajos (sueño bajo ×1, agujetas altas ×1)');
  assert.deepEqual(s.list.map((c) => c.id), ['2', '1', '3', '4']);

  const ok = summary(list, '2026-09-23', '2026-09-27');
  assert.deepEqual([ok.count, ok.low, ok.mostlyLow, ok.text], [2, 0, false, '2 check-ins · ninguno bajo']);
  const one = summary([ck('a', '2026-09-24', 'pre', 1, 1, 2)], '2026-09-21', '2026-09-27');
  assert.equal(one.text, '1 check-in · 1 bajo (sueño bajo ×1, energía baja ×1)');

  const none = summary([], '2026-09-21', '2026-09-27');
  assert.deepEqual([none.count, none.days, none.low, none.lowShare, none.mostlyLow, none.text], [0, 0, 0, null, false, 'Sin check-ins']);
  assert.deepEqual(none.fields.sleep, { n: 0, counts: { 1: 0, 2: 0, 3: 0 }, mean: null });
  // acepta un Map (la store)
  assert.equal(summary(new Map(list.filter(Boolean).map((c) => [c.id, c])), '2026-09-21', '2026-09-27').count, 4);
});

test('summary: valores parciales cuentan por pregunta', () => {
  const s = summary([ck('a', '2026-09-24', 'pre', 2, null, null), ck('b', '2026-09-24', 'post', null, 1, null)]);
  assert.equal(s.count, 2);
  assert.equal(s.fields.sleep.n, 1);
  assert.equal(s.fields.energy.n, 1);
  assert.equal(s.fields.soreness.n, 0);
  assert.equal(s.low, 1);
});

test('dismissKey: una clave por día y momento', () => {
  assert.equal(dismissKey('2026-09-24', 'pre'), 'entreno:checkin-omitido:2026-09-24:pre');
  assert.notEqual(dismissKey('2026-09-24', 'pre'), dismissKey('2026-09-24', 'post'));
});
