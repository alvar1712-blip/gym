import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNum, fmtNum, weekStart, dow, addDays, fmtDate, parseDuration, fmtDuration, numToInput, fmtWeekRange } from '../../js/util.js';

test('parseNum acepta coma decimal', () => {
  assert.equal(parseNum('72,5'), 72.5);
  assert.equal(parseNum('72.5'), 72.5);
  assert.equal(parseNum(' 80 '), 80);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('abc'), null);
  assert.equal(parseNum('-2,5'), -2.5);
});
test('formato es-ES', () => {
  assert.equal(fmtNum(72.5), '72,5');
  assert.equal(fmtNum(80), '80');
  assert.equal(numToInput(72.5), '72,5');
  assert.equal(numToInput(null), '');
});
test('semanas empiezan en lunes', () => {
  assert.equal(dow('2026-09-21'), 0); // lunes
  assert.equal(dow('2026-09-27'), 6); // domingo
  assert.equal(weekStart('2026-09-27'), '2026-09-21');
  assert.equal(weekStart('2026-09-21'), '2026-09-21');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26'); // cruza el cambio de hora
  assert.equal(fmtDate('2026-09-23'), 'mié 23 sep');
  assert.equal(fmtWeekRange('2026-09-28'), '28 sep – 4 oct');
});
test('duraciones', () => {
  assert.equal(parseDuration('45'), 2700);
  assert.equal(parseDuration('45:30'), 2730);
  assert.equal(parseDuration('1:05:30'), 3930);
  assert.equal(fmtDuration(3930), '1:05:30');
  assert.equal(fmtDuration(330), '5:30');
});
