import test from 'node:test';
import assert from 'node:assert/strict';
import { platesPerSide, plateRects, groupPlates } from '../../js/plates.js';

test('barra de 20 kg: cargas habituales, discos por lado', () => {
  assert.deepEqual(platesPerSide(60).perSide, [20]);
  assert.deepEqual(platesPerSide(80).perSide, [25, 5]);
  assert.deepEqual(platesPerSide(82.5).perSide, [25, 5, 1.25]);
  assert.deepEqual(platesPerSide(100).perSide, [25, 15]);
  assert.equal(platesPerSide(100).reason, null);
  assert.deepEqual(platesPerSide(20).perSide, []); // la barra sola
});

test('cargas que no se pueden montar: se dice cuánto falta', () => {
  const r = platesPerSide(41.25);
  assert.equal(r.reason, 'inexact');
  assert.equal(r.loaded, 40);
  assert.equal(r.missing, 1.25);
  assert.equal(platesPerSide(17.5).reason, 'below-bar');
});

test('otra barra y sin errores de coma flotante', () => {
  assert.deepEqual(platesPerSide(60, { bar: 15 }).perSide, [20, 2.5]);
  assert.equal(platesPerSide(22.5, { bar: 20 }).loaded, 22.5);
  assert.deepEqual(platesPerSide(22.5).perSide, [1.25]);
  assert.equal(platesPerSide(NaN).reason, 'below-bar');
  assert.equal(platesPerSide(null).reason, 'below-bar');
});

test('nunca monta más de lo pedido (centésimas por debajo del reparto)', () => {
  const r = platesPerSide(32.49);
  assert.ok(r.loaded <= 32.49 + 1e-9, `cargado ${r.loaded}`);
  assert.ok(r.missing >= 0);
  assert.equal(r.reason, 'inexact');
});

test('geometría: los discos caben siempre en el manguito, de mayor a menor, y se agrupan en el texto', () => {
  const total = (rs, gap = 2) => rs.reduce((s, r) => s + r.w + gap, 0);
  const few = plateRects([25, 5, 1.25]);
  assert.deepEqual(few.map((r) => r.p), [25, 5, 1.25]);
  assert.ok(few[0].k > few[1].k && few[1].k > few[2].k, 'el alto sigue al peso');
  assert.equal(few[0].w, 22, 'pocos discos: grosor natural');
  // 300 kg → por lado 140 kg = 5 × 25 + 15; 999 kg → muchísimos discos
  for (const kg of [100, 300, 600, 999]) {
    const rs = plateRects(platesPerSide(kg).perSide);
    assert.ok(total(rs) <= 130 + 3 * rs.length, `${kg} kg cabe: ${total(rs)} px`);
    assert.ok(rs.every((r) => r.w >= 3));
  }
  assert.equal(groupPlates([25, 25, 5, 1.25], (n) => String(n).replace('.', ',')), '2 × 25 + 5 + 1,25');
  assert.equal(groupPlates([]), '');
});
