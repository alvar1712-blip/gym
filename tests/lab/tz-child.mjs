// Proceso hijo de N14: se ejecuta con TZ=<huso> y comprueba las utilidades de fecha en 4 años (incluye cambios de hora).
// Sale con código 1 e imprime los fallos si encuentra alguno.
import { addDays, dow, weekStart, diffDays, dateFromTs, tsFromDate, isDateStr } from '../../js/util.js';

const bad = [];
let d = '2024-01-01';
for (let i = 0; i < 1460; i++, d = addDays(d, 1)) {
  const next = addDays(d, 1);
  if (!isDateStr(d)) bad.push(`fecha inválida ${d}`);
  if (diffDays(d, next) !== 1) bad.push(`diffDays(${d},${next}) = ${diffDays(d, next)}`);
  if (dow(weekStart(d)) !== 0) bad.push(`weekStart(${d}) no es lunes`);
  if (dow(next) !== (dow(d) + 1) % 7) bad.push(`dow salta en ${d}`);
  for (const h of [0, 1, 12, 23]) if (dateFromTs(tsFromDate(d, h)) !== d) bad.push(`dateFromTs(tsFromDate(${d},${h})) = ${dateFromTs(tsFromDate(d, h))}`);
  if (bad.length > 5) break;
}
if (bad.length) { console.log(bad.slice(0, 5).join('\n')); process.exit(1); }
