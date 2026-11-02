import test from 'node:test';
import assert from 'node:assert/strict';
import { platesPerSide } from '../../js/plates.js';

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
