import test from 'node:test';
import assert from 'node:assert/strict';
import { rulerValue } from '../../js/ruler.js';

const W = { step: 2.5, min: 0, max: 999 };

test('arrastrar a la izquierda sube y a la derecha baja, en pasos enteros', () => {
  assert.equal(rulerValue(60, -11, W), 62.5);
  assert.equal(rulerValue(60, 22, W), 55);
  assert.equal(rulerValue(60, 4, W), 60); // menos de media marca: no cambia
});

test('de 40 a 100 kg caben en una pasada razonable (≤ 300 px)', () => {
  assert.equal(rulerValue(40, -264, W), 100);
});

test('los pesos decimales son alcanzables y no se redondean al soltar sin mover', () => {
  assert.equal(rulerValue(15, -11, W), 17.5);
  assert.equal(rulerValue(10, -11, W), 12.5);
  assert.equal(rulerValue(41.25, 0, W), 41.25);
  assert.equal(rulerValue(41.25, -11, W), 43.75);
});

test('respeta los límites y parte de 0 si no hay valor', () => {
  assert.equal(rulerValue(5, 200, W), 0);
  assert.equal(rulerValue(990, -500, W), 999);
  assert.equal(rulerValue(null, -22, W), 5);
  assert.equal(rulerValue(8, -33, { step: 1, min: 0, max: 999 }), 11);
});
