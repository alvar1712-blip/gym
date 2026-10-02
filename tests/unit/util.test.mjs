import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNum, fmtNum, weekStart, dow, addDays, diffDays, isDateStr, parseDate, toDateStr, fmtDate, parseDuration, fmtDuration,
  numToInput, fmtWeekRange,
} from '../../js/util.js';

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
test('formato es-ES con varios decimales (formateadores reutilizados)', () => {
  assert.equal(fmtNum(1234.567, 2), '1.234,57');
  assert.equal(fmtNum(12345.6), '12.345,6');
  assert.equal(fmtNum(80, 1, 1), '80,0');
  assert.equal(fmtNum(80, 2), '80');
  assert.equal(fmtNum(72.25, 0), '72');
  assert.equal(fmtNum(null), '—');
  assert.equal(fmtNum(NaN), '—');
});
test('aritmética de fechas: cambios de hora, bisiestos y fechas imposibles', () => {
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2); // cambio de hora de marzo
  assert.equal(diffDays('2026-10-30', '2026-10-24'), -6); // de octubre, hacia atrás
  assert.equal(diffDays('2025-01-01', '2026-01-01'), 365);
  assert.equal(diffDays('2024-01-01', '2025-01-01'), 366);
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(dow('2024-02-29'), 3); // jueves
  assert.equal(dow('2027-01-03'), 6); // domingo
  assert.equal(isDateStr('2024-02-29'), true);
  assert.equal(isDateStr('2026-02-29'), false);
  assert.equal(isDateStr('2026-04-31'), false);
  assert.equal(isDateStr('2026-13-01'), false);
  assert.equal(isDateStr('2026-00-10'), false);
  assert.equal(isDateStr('2026-9-3'), false);
  assert.equal(isDateStr('0999-01-01'), false);
  assert.equal(isDateStr(20260101), false);
  // parseDate sigue devolviendo la fecha LOCAL a mediodía
  const d = parseDate('2026-10-25');
  assert.equal(toDateStr(d), '2026-10-25');
  assert.equal(d.getHours(), 12);
});
test('duraciones', () => {
  assert.equal(parseDuration('45'), 2700);
  assert.equal(parseDuration('45:30'), 2730);
  assert.equal(parseDuration('1:05:30'), 3930);
  assert.equal(fmtDuration(3930), '1:05:30');
  assert.equal(fmtDuration(330), '5:30');
});
