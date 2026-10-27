// Topes de descompresión de la importación (.gz / .zip): se aplican a los bytes realmente descomprimidos, no a lo que
// declara el archivo, y hay un presupuesto acumulado por importación.
// Ejecutar: node --test tests/unit/import-limits.test.mjs
process.env.TZ = 'Europe/Madrid';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readActivityFile } from '../../js/import-parse.js';
import { gunzip, zipEntries, zipRead, MAX_INFLATED, newInflateBudget } from '../../js/import-zip.js';
import { makeZip, gzip, gpxFromPoints, sampleRun } from '../fixtures/import/builders.mjs';

const MB = 1024 * 1024;
const zeros = (mb) => new Uint8Array(mb * MB);
const gpx = gpxFromPoints(sampleRun().points.slice(0, 20));

test('un .gz que se expande por encima del tope por archivo se corta y da un error claro', async () => {
  await assert.rejects(() => gunzip(gzip(zeros(MAX_INFLATED / MB + 10))), /demasiado grandes/);
  const res = await readActivityFile('bomba.gpx.gz', gzip(zeros(MAX_INFLATED / MB + 10)));
  assert.equal(res.length, 1);
  assert.match(res[0].error, /demasiado grandes/);
  assert.equal(res[0].summary, undefined);
});

test('zip con el tamaño declarado falseado: manda lo realmente descomprimido', async () => {
  const zip = makeZip([{ name: 'a.gpx', data: zeros(MAX_INFLATED / MB + 10), method: 8 }]);
  const [entry] = zipEntries(zip);
  assert.ok(entry.size > MAX_INFLATED, 'sin falsear, el tamaño declarado ya lo delata');
  // Falsea el tamaño sin comprimir del directorio central a 100 bytes.
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i < zip.length - 4; i++) {
    if (dv.getUint32(i, true) === 0x02014b50) { dv.setUint32(i + 24, 100, true); break; }
  }
  const [fake] = zipEntries(zip);
  assert.equal(fake.size, 100);
  await assert.rejects(() => zipRead(zip, fake), /demasiado grandes/);
  const res = await readActivityFile('falso.zip', zip);
  assert.ok(res.every((r) => r.error), 'ninguna actividad sale de un zip así');
});

test('una entrada excesiva no impide leer las demás del mismo zip', async () => {
  const zip = makeZip([
    { name: 'bomba.gpx', data: zeros(MAX_INFLATED / MB + 10), method: 8 },
    { name: 'buena.gpx', data: gpx, method: 8 },
  ]);
  const res = await readActivityFile('mezcla.zip', zip);
  assert.equal(res.filter((r) => r.summary).length, 1);
  assert.equal(res.filter((r) => r.error).length, 1);
  assert.match(res.find((r) => r.error).error, /demasiado grandes/);
});

test('presupuesto acumulado: varias descompresiones pequeñas agotan el total y la siguiente se rechaza', async () => {
  const budget = { left: 2500 };
  const piece = gzip(new Uint8Array(1000));
  assert.equal((await gunzip(piece, budget)).length, 1000);
  assert.equal((await gunzip(piece, budget)).length, 1000);
  assert.equal(budget.left, 500);
  await assert.rejects(() => gunzip(piece, budget), /demasiado grandes/);
  assert.equal(budget.left, 500, 'una descompresión rechazada no gasta presupuesto');
});

test('zip con muchas entradas: el total acumulado se corta y el resto da error sin colgar la lectura', async () => {
  // Simula el presupuesto de una importación con poco margen: cada entrada gasta del mismo `budget`.
  const zip = makeZip(Array.from({ length: 6 }, (_, i) => ({ name: `e${i}.gpx`, data: gpx, method: 8 })));
  const budget = { left: gpx.length * 3 + 10 };
  const bytes = [];
  for (const e of zipEntries(zip)) {
    try { bytes.push((await zipRead(zip, e, budget)).length); } catch { bytes.push('error'); }
  }
  assert.deepEqual(bytes, [gpx.length, gpx.length, gpx.length, 'error', 'error', 'error']);
});

test('con el tope acumulado real (250 MB), lo que lo supera se rechaza y lo anterior ya se leyó', async () => {
  const zip = makeZip(Array.from({ length: 6 }, (_, i) => ({ name: `g${i}.gpx`, data: zeros(49), method: 8 })));
  const budget = newInflateBudget();
  const lens = [];
  for (const e of zipEntries(zip)) {
    try { lens.push((await zipRead(zip, e, budget)).length / MB); } catch (err) { lens.push(err.message.includes('250 MB') ? 'tope' : 'otro'); }
  }
  assert.deepEqual(lens, [49, 49, 49, 49, 49, 'tope'], '5 × 49 MB = 245 MB caben; el sexto no');
  assert.ok(budget.left < 49 * MB && budget.left >= 0);
});

test('los archivos válidos de siempre siguen funcionando (gz, zip, zip con .gz dentro, ~5 MB)', async () => {
  const [a] = await readActivityFile('a.gpx.gz', gzip(gpx));
  assert.equal(a.format, 'gpx');
  const [b, c] = await readActivityFile('b.zip', makeZip([
    { name: 'x.gpx', data: gpx, method: 8 },
    { name: 'y.gpx.gz', data: gzip(gpx), method: 8 },
  ]));
  assert.equal(b.format, 'gpx');
  assert.equal(c.format, 'gpx');
  const grande = await gunzip(gzip(zeros(5)));
  assert.equal(grande.length, 5 * MB);
  assert.equal(newInflateBudget().left > MAX_INFLATED, true);
});
