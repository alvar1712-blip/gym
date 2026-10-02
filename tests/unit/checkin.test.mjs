// Pruebas de la lógica del check-in (js/checkin-logic.js; js/checkin.js la reexporta).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS, FIELD_KEYS, LOW_FIELDS, LEVEL_OPTIONS, level, checkinFor, hasValues, isComplete, isLowCheckin, lowReasons, valueWord,
  valueText, checkinText, newCheckin, applyValue, checkinsBetween, summary, dismissKey,
  AREA_KINDS, JOINTS, SIDES, normalizeArea, areasOf, areaName, areaText, areasText, levelBand, validateArea, upsertArea, removeArea,
} from '../../js/checkin-logic.js';
import { isLowCheckin as insightsIsLow } from '../../js/insights.js';

const ck = (id, date, timing, sleep, energy, soreness, extra = {}) => ({ id, date, timing, sessionId: null, sleep, energy, soreness, createdAt: 1, ...extra });

test('cuatro preguntas (ronda 6: + estrés) con tres opciones Bajo · Normal · Alto (1/2/3)', () => {
  assert.deepEqual(FIELD_KEYS, ['sleep', 'energy', 'stress', 'soreness']);
  assert.deepEqual(FIELDS.map((f) => f.label), ['Sueño', 'Energía', 'Estrés', 'Agujetas']);
  assert.deepEqual(LOW_FIELDS.map((f) => f.key), ['sleep', 'energy', 'soreness'], 'el check-in «bajo» sigue con sus tres de siempre');
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
  assert.equal(isComplete(ck('a', '2026-09-24', 'pre', 1, 2, 3, { stress: 2 })), true);
  assert.equal(isComplete(ck('a', '2026-09-24', 'pre', 1, 2, 3)), false, 'sin estrés (como los antiguos) no está completo, pero vale');
  assert.equal(isComplete(ck('a', '2026-09-24', 'pre', 1, 2, null, { stress: 2 })), false);
  assert.equal(hasValues(ck('a', '2026-09-24', 'pre', null, null, null, { stress: 3 })), true, 'solo el estrés');
  assert.equal(hasValues(ck('a', '2026-09-24', 'pre', null, null, null, { areas: [{ kind: 'muscle', zone: 'hamstrings', level: 6 }] })), true, 'solo una zona');
  assert.equal(hasValues(ck('a', '2026-09-24', 'pre', null, null, null, { areas: [{ kind: 'muscle', zone: 'nope', level: 6 }] })), false, 'una zona ilegible no cuenta');
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
  assert.deepEqual(c, { id: 'ci_1', date: '2026-09-24', timing: 'post', sessionId: 's1', sleep: null, energy: null, stress: null, soreness: null, areas: [], createdAt: 1234 });
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
  assert.equal(isComplete(store[0]), false, 'falta el estrés');
  applyValue(store, key, 'stress', 2);
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
  applyValue(store, key, 'stress', null);
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

test('check-ins antiguos (sin estrés ni zonas) siguen valiendo tal cual', () => {
  const old = { id: 'old', date: '2026-08-10', timing: 'pre', sessionId: 's1', sleep: 1, energy: 2, soreness: 3, createdAt: 1, updatedAt: 1 };
  assert.equal(hasValues(old), true);
  assert.equal(isLowCheckin(old), true);
  assert.deepEqual(lowReasons(old), ['sueño bajo', 'agujetas altas']);
  assert.equal(checkinText(old), 'Sueño bajo · Energía normal · Agujetas altas');
  assert.deepEqual(areasOf(old), []);
  assert.equal(areasText(old), '');
  const s = summary([old], '2026-08-01', '2026-08-31');
  assert.deepEqual([s.count, s.low, s.fields.stress.n, s.fields.soreness.mean], [1, 1, 0, 3]);
  assert.match(s.text, /1 check-in · 1 bajo \(sueño bajo ×1, agujetas altas ×1\)/);
  // Su «agujetas» (1–3) no se convierte ni se le inventa zona.
  assert.equal(old.soreness, 3);
  assert.equal('areas' in old, false);
});

test('el estrés se registra y se muestra, pero no cambia la regla del check-in «bajo»', () => {
  const c = ck('a', '2026-09-24', 'pre', 2, 2, 2, { stress: 3 });
  assert.equal(isLowCheckin(c), false);
  assert.deepEqual(lowReasons(c), []);
  assert.equal(checkinText(c), 'Sueño normal · Energía normal · Estrés alto · Agujetas normales');
  assert.equal(valueWord('stress', 1), 'Bajo');
  const s = summary([c, ck('b', '2026-09-25', 'pre', 2, 2, 2, { stress: 1 })]);
  assert.deepEqual(s.fields.stress, { n: 2, counts: { 1: 1, 2: 0, 3: 1 }, mean: 2 });
  assert.equal(s.low, 0);
  assert.equal('stress' in s.lowBy, false);
});

test('zonas: catálogo, saneado al leer y textos', () => {
  assert.deepEqual(AREA_KINDS.map((k) => k.id), ['muscle', 'joint']);
  assert.ok(JOINTS.some((j) => j.id === 'knee') && JOINTS.length === new Set(JOINTS.map((j) => j.id)).size);
  assert.deepEqual(SIDES.map((x) => x.id), ['left', 'right', 'both']);
  assert.deepEqual(normalizeArea({ id: 'a1', kind: 'muscle', zone: 'hamstrings', side: 'left', level: 7, note: '  tras el RDL ', extra: 1 }),
    { id: 'a1', kind: 'muscle', zone: 'hamstrings', side: 'left', level: 7, note: 'tras el RDL' });
  assert.equal(normalizeArea({ kind: 'muscle', zone: 'knee', level: 3 }), null, 'una articulación no es un músculo');
  assert.equal(normalizeArea({ kind: 'joint', zone: 'hamstrings', level: 3 }), null);
  assert.equal(normalizeArea({ kind: 'muscle', zone: 'quads', level: 11 }), null);
  assert.equal(normalizeArea({ kind: 'muscle', zone: 'quads', level: 2.5 }), null);
  assert.equal(normalizeArea({ kind: 'muscle', zone: 'quads', level: 0 }).level, 0, '0 = nada, válido');
  assert.equal(normalizeArea({ kind: 'joint', zone: 'knee', level: 4, side: 'arriba' }).side, null);
  assert.equal(normalizeArea({ kind: 'joint', zone: 'knee', level: 4 }).id, 'joint:knee:', 'sin id: uno estable');
  assert.equal(areaName({ kind: 'muscle', zone: 'hamstrings' }), 'Isquiotibiales');
  assert.equal(areaName({ kind: 'joint', zone: 'knee' }), 'Rodilla');
  assert.equal(areaText({ kind: 'muscle', zone: 'hamstrings', side: 'left', level: 7 }), 'Isquiotibiales (izq.): agujetas 7/10');
  assert.equal(areaText({ kind: 'joint', zone: 'knee', side: null, level: 3 }), 'Rodilla: molestia 3/10');
  assert.deepEqual([0, 1, 3, 4, 6, 7, 10].map(levelBand), ['none', 'low', 'low', 'mid', 'mid', 'high', 'high']);
  assert.deepEqual(validateArea({ kind: 'muscle', zone: 'quads', level: 5 }), {});
  assert.ok(validateArea({ kind: 'muscle', zone: null, level: 5 }).zone);
  assert.ok(validateArea({ kind: 'joint', zone: 'knee', level: null }).level);
  assert.ok(validateArea({}).kind);
});

test('upsertArea / removeArea: una por clase, zona y lado; crea el check-in si hace falta', () => {
  const store = [];
  const key = { date: '2026-09-25', timing: 'pre' };
  let r = upsertArea(store, key, { kind: 'muscle', zone: 'hamstrings', side: 'both', level: 7 }, 100);
  assert.equal(r.created, true);
  assert.deepEqual([r.record.sleep, r.record.stress, r.record.soreness], [null, null, null], 'sin tocar las preguntas');
  store.push(r.record);
  const firstId = r.record.areas[0].id;
  assert.match(firstId, /^ar_/);
  // misma zona y lado: la sustituye (sin duplicar)
  r = upsertArea(store, key, { kind: 'muscle', zone: 'hamstrings', side: 'both', level: 5 });
  assert.equal(r.created, false);
  assert.deepEqual(areasOf(store[0]).map((a) => [a.zone, a.side, a.level]), [['hamstrings', 'both', 5]]);
  // otro lado u otra clase: otra zona
  upsertArea(store, key, { kind: 'muscle', zone: 'hamstrings', side: 'left', level: 8 });
  upsertArea(store, key, { kind: 'joint', zone: 'knee', side: 'right', level: 3, note: 'al bajar escaleras' });
  assert.equal(areasOf(store[0]).length, 3);
  assert.equal(areasText(store[0]), 'Isquiotibiales (ambos lados): agujetas 5/10 · Isquiotibiales (izq.): agujetas 8/10 · Rodilla (der.): molestia 3/10');
  // editar por id
  const knee = areasOf(store[0]).find((a) => a.zone === 'knee');
  upsertArea(store, key, { ...knee, level: 2 });
  assert.equal(areasOf(store[0]).find((a) => a.zone === 'knee').level, 2);
  assert.equal(areasOf(store[0]).length, 3);
  // quitar
  for (const a of areasOf(store[0])) r = removeArea(store, key, a.id);
  assert.equal(r.empty, true, 'sin zonas ni respuestas: vacío');
  assert.deepEqual(removeArea([], key, 'x'), { record: null, empty: true });
  assert.throws(() => upsertArea([], key, { kind: 'muscle', zone: 'nope', level: 3 }));
});
