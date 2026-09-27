// Pruebas de la importación de actividades: formatos (GPX, TCX, FIT, .gz, .zip), métricas, deporte → tipo,
// registro con la forma del formulario de actividad y duplicados.
// Ejecutar: node --test tests/unit/import.test.mjs
process.env.TZ = 'Europe/Madrid';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectFormat, walkXml, getAttr, decodeEntities, parseGPX, parseTCX, parseFIT, pointMetrics, elevationStats, summarize,
  haversine, readActivityFile, ImportError, FIT_EPOCH_S,
} from '../../js/import-parse.js';
import { gunzip, zipEntries, zipRead, isJunkEntry, baseName } from '../../js/import-zip.js';
import {
  sportToKind, stepsCadence, itemFromEntry, setItemKind, setItemField, setItemDate, setItemTime, itemTime, itemProblems,
  problemText, itemRecord, itemForm, isSameActivity, findDuplicate, updateDuplicates, selectedItems, itemFacts, WALK_SUBTYPE,
} from '../../js/import-logic.js';
import { buildRecord, emptyForm, activityTitle } from '../../js/activity-logic.js';
import {
  makeTrack, gpxFromPoints, tcxFromPoints, FitWriter, T, fitTs, semis, buildFitActivity, makeZip, gzip, sampleRun,
  sampleRide, sampleHike,
} from '../fixtures/import/builders.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'import');
const enc = (s) => new TextEncoder().encode(s);
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} ≉ ${expected} (±${tol})`);
const TODAY = '2026-09-26';

// ---------------------------------------------------------------------------
// Detección y XML
// ---------------------------------------------------------------------------
test('detectFormat: por contenido (gzip, zip, FIT, GPX, TCX) y por extensión como último recurso', () => {
  assert.equal(detectFormat(gzip('hola')), 'gzip');
  assert.equal(detectFormat(makeZip([{ name: 'a.txt', data: 'x' }])), 'zip');
  assert.equal(detectFormat(buildFitActivity({ points: sampleHike().points.slice(0, 5), sport: 17 })), 'fit');
  assert.equal(detectFormat(enc('﻿<?xml version="1.0"?>\n<gpx version="1.1">')), 'gpx');
  assert.equal(detectFormat(enc('<?xml version="1.0"?><TrainingCenterDatabase xmlns="x">')), 'tcx', 'con cualquier nombre');
  assert.equal(detectFormat(enc('<?xml version="1.0"?><!-- raro --><root/>'), 'ruta.gpx'), 'gpx', 'extensión si el contenido es XML');
  assert.equal(detectFormat(enc('Esto no es una actividad'), 'notas.txt'), null);
  assert.equal(detectFormat(enc('texto'), 'carrera.gpx'), null, 'un .gpx que no es XML no se reconoce');
});

test('walkXml: nombres locales sin prefijo, texto directo, entidades, CDATA, comentarios y autocerrados', () => {
  const seen = [];
  walkXml('<?xml version="1.0"?><!DOCTYPE x><a:Root x="1"><!-- c --><b>uno &amp; dos</b><c/><d><![CDATA[<tres> & cuatro]]></d><e att=\'a>b\'>5</e></a:Root>', {
    onOpen: (name, raw) => seen.push(['open', name, raw.trim()]),
    onClose: (name, text, stack) => seen.push(['close', name, text, stack.join('/')]),
  });
  assert.deepEqual(seen.filter((s) => s[0] === 'close').map((s) => s.slice(1)), [
    ['b', 'uno & dos', 'root'], ['c', '', 'root'], ['d', '<tres> & cuatro', 'root'], ['e', '5', 'root'], ['root', '', ''],
  ]);
  assert.equal(getAttr(' lat="40.5" lon=\'-3.7\'', 'lon'), '-3.7');
  assert.equal(getAttr(' Sport="Running"', 'sport'), 'Running');
  assert.equal(getAttr(' xsi:type="Device_t"', 'type'), 'Device_t');
  assert.equal(decodeEntities('a &lt;b&gt; &#241; &#xF1; &quot;'), 'a <b> ñ ñ "');
});

// ---------------------------------------------------------------------------
// GPX / TCX
// ---------------------------------------------------------------------------
test('GPX 1.1 de Garmin: puntos con altitud, hora y extensiones hr/cad; tipo y nombre', () => {
  const run = sampleRun();
  const [a] = parseGPX(gpxFromPoints(run.points, { type: 'running', name: 'Carrera de mañana' }));
  assert.equal(a.format, 'gpx');
  assert.equal(a.sport, 'running');
  assert.equal(a.name, 'Carrera de mañana');
  assert.equal(a.points.length, run.points.length);
  assert.equal(a.startTime, Date.UTC(2026, 8, 20, 6, 0, 0));
  const p = a.points[1];
  near(p.lat, run.points[1].lat, 1e-6, 'lat');
  near(p.ele, run.points[1].ele, 0.06, 'ele');
  assert.equal(p.hr, run.points[1].hr);
  assert.equal(p.cad, run.points[1].cad);
});

test('GPX: extensiones sin prefijo (power, speed), varios tramos, rutas sin pista y archivo vacío', () => {
  const xml = `<gpx><trk><type>cycling</type><trkseg>
    <trkpt lat="40" lon="-3"><time>2026-09-01T10:00:00Z</time><extensions><power>210</power><gpxtpx:TrackPointExtension><gpxtpx:speed>7.5</gpxtpx:speed><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  </trkseg><trkseg><trkpt lat="40.001" lon="-3"><time>2026-09-01T10:00:20Z</time></trkpt></trkseg></trk></gpx>`;
  const [a] = parseGPX(xml);
  assert.equal(a.points.length, 2);
  assert.deepEqual([a.points[0].power, a.points[0].speed, a.points[0].hr], [210, 7.5, 140]);
  const [r] = parseGPX('<gpx><rte><rtept lat="1" lon="2"/><rtept lat="1.01" lon="2"/></rte></gpx>');
  assert.equal(r.points.length, 2, 'sin <trk> se usan los puntos de la ruta');
  assert.equal(r.startTime, null);
  assert.throws(() => parseGPX('<gpx><metadata/></gpx>'), ImportError);
});

test('TCX: deporte, vueltas (tiempo, distancia, FC) y puntos con distancia acumulada, FC, cadencia y vatios', () => {
  const ride = sampleRide();
  const [a] = parseTCX(tcxFromPoints(ride.points, { sport: 'Biking', laps: 2 }));
  assert.equal(a.format, 'tcx');
  assert.equal(a.sport, 'Biking');
  assert.equal(a.startTime, Date.UTC(2026, 8, 21, 16, 0, 0));
  assert.equal(a.points.length, ride.points.length);
  near(a.totals.timerSec, 2700, 0.5, 'tiempo de las vueltas');
  near(a.totals.distanceM, 20000, 1, 'distancia de las vueltas');
  assert.ok(a.totals.hrMax >= 146 && a.totals.hrMax <= 152);
  const p = a.points[3];
  assert.equal(p.power, ride.points[3].power);
  assert.equal(p.cad, ride.points[3].cad);
  near(p.dist, ride.points[3].dist, 0.1, 'distancia acumulada');
  near(p.speed, 20000 / 2700, 0.001, 'velocidad TPX');
  // Dos actividades en el mismo archivo
  const two = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-09-01T07:00:00Z</Id><Lap StartTime="2026-09-01T07:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>2000</DistanceMeters></Lap></Activity>
    <Activity Sport="Other"><Id>2026-09-02T07:00:00Z</Id><Lap><TotalTimeSeconds>60</TotalTimeSeconds></Lap></Activity></Activities></TrainingCenterDatabase>`;
  const acts = parseTCX(two);
  assert.deepEqual(acts.map((x) => x.sport), ['Running', 'Other']);
  assert.equal(acts[0].totals.distanceM, 2000);
  assert.throws(() => parseTCX('<TrainingCenterDatabase><Courses/></TrainingCenterDatabase>'), ImportError);
});

// ---------------------------------------------------------------------------
// FIT
// ---------------------------------------------------------------------------
test('FIT: escalas y desplazamientos (semicírculos, altitud 5/500, velocidad, distancia /100, origen 1989-12-31)', () => {
  const t0 = Date.UTC(2026, 8, 19, 8, 0, 0);
  const w = new FitWriter();
  w.define(0, 0, [[0, T.enum], [4, T.uint32]]).data(0, { 0: 4, 4: fitTs(t0) });
  w.define(1, 20, [[253, T.uint32], [0, T.sint32], [1, T.sint32], [2, T.uint16], [3, T.uint8], [4, T.uint8], [5, T.uint32], [6, T.uint16], [7, T.uint16]]);
  w.data(1, { 253: fitTs(t0), 0: semis(42.5), 1: semis(-3.25), 2: (1234.4 + 500) * 5, 3: 150, 4: 80, 5: 123456, 6: 3250, 7: 250 });
  // Valores inválidos: sin posición ni FC
  w.data(1, { 253: fitTs(t0) + 1, 0: null, 1: null, 2: null, 3: null, 4: null, 5: 123789, 6: 3300, 7: null });
  // Mismo mensaje con altitud y velocidad «enhanced» (uint32)
  w.define(2, 20, [[253, T.uint32], [78, T.uint32], [73, T.uint32]]);
  w.data(2, { 253: fitTs(t0) + 2, 78: Math.round((-12.2 + 500) * 5), 73: 4100 });
  const [a] = parseFIT(w.build());
  const [p0, p1, p2] = a.points;
  assert.equal(p0.t, t0);
  assert.equal(FIT_EPOCH_S, Date.UTC(1989, 11, 31) / 1000);
  near(p0.lat, 42.5, 1e-7, 'lat');
  near(p0.lon, -3.25, 1e-7, 'lon');
  near(p0.ele, 1234.4, 0.1, 'altitud');
  assert.deepEqual([p0.hr, p0.cad, p0.power], [150, 80, 250]);
  near(p0.dist, 1234.56, 1e-9, 'distancia en m');
  near(p0.speed, 3.25, 1e-9, 'velocidad en m/s');
  assert.deepEqual([p1.lat, p1.lon, p1.ele, p1.hr, p1.power], [null, null, null, null, null]);
  near(p2.ele, -12.2, 0.1, 'enhanced_altitude');
  near(p2.speed, 4.1, 1e-9, 'enhanced_speed');
});

test('FIT: marcas de tiempo comprimidas (con vuelta de 32 s), campos de desarrollador, big endian y mensajes desconocidos', () => {
  const t0 = Date.UTC(2026, 8, 19, 8, 0, 0);
  const base = fitTs(t0);
  const w = new FitWriter();
  w.define(0, 20, [[253, T.uint32], [3, T.uint8]], { devFields: [[0, 3, 0], [1, 1, 0]] });
  w.data(0, { 253: base, 3: 100 });
  w.define(1, 20, [[3, T.uint8]], { devFields: [[0, 3, 0]] });
  const times = [base];
  let ts = base;
  for (let k = 1; k <= 12; k++) {
    ts += 7; // cruza varias veces el límite de 32 s
    times.push(ts);
    w.data(1, { 3: 100 + k }, { compressed: ts & 0x1f });
  }
  w.define(2, 999, [[0, T.uint32], [1, T.string, 8]]).data(2, { 0: 5, 1: 'x' }); // mensaje desconocido
  w.define(3, 18, [[253, T.uint32], [2, T.uint32], [5, T.enum], [6, T.enum], [7, T.uint32], [8, T.uint32], [9, T.uint32], [16, T.uint8], [22, T.uint16], [128, T.uint32]], { bigEndian: true });
  w.data(3, { 253: ts, 2: base, 5: 1, 6: 3, 7: 84000, 8: 80000, 9: 1000000, 16: 150, 22: 321, 128: (1500 + 500) * 5 });
  const [a] = parseFIT(w.build());
  assert.deepEqual(a.points.map((p) => p.t), times.map((x) => (x + FIT_EPOCH_S) * 1000));
  assert.deepEqual(a.points.map((p) => p.hr), times.map((_, k) => 100 + k));
  assert.equal(a.sport, 'running');
  assert.equal(a.subSport, 'trail');
  assert.deepEqual([a.totals.elapsedSec, a.totals.timerSec, a.totals.distanceM, a.totals.hrAvg, a.totals.ascentM, a.totals.altMaxM], [84, 80, 10000, 150, 321, 1500]);
  assert.equal(a.startTime, t0);
});

test('FIT: senderismo completo, multideporte por sesiones, archivo truncado y archivos que no son actividad', () => {
  const hike = sampleHike();
  const bytes = buildFitActivity({ points: hike.points, sport: 17, session: { hrAvg: 121, hrMax: 152, cadence: 56, ascent: 598, descent: 601, maxAltM: 1502 } });
  const [a] = parseFIT(bytes);
  assert.equal(a.sport, 'hiking');
  assert.equal(a.points.length, hike.points.length);
  assert.equal(a.totals.ascentM, 598);
  near(a.totals.distanceM, hike.distanceM, 0.02, 'distancia de la sesión');
  // Truncado a la mitad: se leen los registros completos que haya
  const half = parseFIT(bytes.subarray(0, Math.floor(bytes.length / 2)));
  assert.ok(half[0].points.length > 50 && half[0].points.length < hike.points.length);
  // Dos sesiones (p. ej. multideporte): una actividad por sesión, con sus puntos
  const t0 = Date.UTC(2026, 8, 1, 7, 0, 0);
  const w = new FitWriter();
  w.define(0, 20, [[253, T.uint32], [5, T.uint32]]);
  for (let s = 0; s < 120; s += 10) w.data(0, { 253: fitTs(t0) + s, 5: s * 300 });
  w.define(1, 18, [[253, T.uint32], [2, T.uint32], [5, T.enum], [7, T.uint32]]);
  w.data(1, { 253: fitTs(t0) + 50, 2: fitTs(t0), 5: 5, 7: 50000 });
  w.data(1, { 253: fitTs(t0) + 55, 2: fitTs(t0) + 50, 5: 3, 7: 5000 }); // transición: se ignora
  w.data(1, { 253: fitTs(t0) + 110, 2: fitTs(t0) + 60, 5: 2, 7: 50000 });
  const multi = parseFIT(w.build());
  assert.deepEqual(multi.map((m) => m.sport), ['swimming', 'cycling']);
  assert.deepEqual(multi.map((m) => m.points.length), [6, 6]);
  // No es FIT / FIT sin actividad
  assert.throws(() => parseFIT(enc('hola, esto no es un FIT')), ImportError);
  const settings = new FitWriter().define(0, 0, [[0, T.enum]]).data(0, { 0: 2 }).build();
  assert.throws(() => parseFIT(settings), /no tiene datos de actividad/);
});

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------
test('haversine: 0,01° de latitud ≈ 1112 m', () => {
  near(haversine({ lat: 40, lon: -3 }, { lat: 40.01, lon: -3 }), 1111.95, 0.5, 'distancia');
});

test('tiempo en movimiento: excluye la parada (GPS quieto con ruido) y distancia por haversine sin el zigzag', () => {
  const run = sampleRun();
  const pts = run.points.map(({ speed, dist, ...p }) => p); // como un GPX: sin velocidad ni distancia del reloj
  const m = pointMetrics(pts);
  assert.equal(m.elapsedSec, 1620);
  near(m.movingSec, 1500, 20, 'movimiento (25 min de 27)');
  near(m.distanceM, 5000, 30, 'distancia');
  assert.equal(m.distanceSource, 'gps');
  assert.ok(m.hrMax >= 158 && m.hrAvg > 140 && m.hrAvg < 158);
  near(m.cadence, 85.5 * (1500 / 1500) * (150 / 151), 3, 'cadencia media (sin ceros)');
});

test('huecos de más de 30 s: sin avance no cuentan (pausa automática); con avance sí (túnel)', () => {
  const t0 = Date.UTC(2026, 8, 1, 7, 0, 0);
  const mk = (gapSec, gapMeters) => {
    const pts = [];
    let lat = 40;
    let t = t0;
    for (let k = 0; k <= 30; k++) { pts.push({ t, lat, lon: -3 }); t += 5000; lat += 15 / 111320; } // 3 m/s
    t += (gapSec - 5) * 1000;
    lat += (gapMeters - 15) / 111320;
    for (let k = 0; k <= 30; k++) { pts.push({ t, lat, lon: -3 }); t += 5000; lat += 15 / 111320; }
    return pointMetrics(pts);
  };
  const paused = mk(300, 5);
  near(paused.movingSec, 300, 1, 'pausa de 5 min excluida');
  near(paused.elapsedSec, 600, 1, 'tiempo total con la pausa');
  const tunnel = mk(120, 360);
  near(tunnel.movingSec, 420, 1, 'hueco de 2 min con 360 m: cuenta');
  near(tunnel.distanceM, 900 + 360, 5, 'distancia con el hueco');
});

test('distancia y velocidad del dispositivo cuando existen (FIT/TCX); sin puntos útiles → null', () => {
  const pts = [0, 10, 20, 30, 40].map((s, i) => ({ t: s * 1000, dist: i * 25, speed: i === 2 ? 0.2 : 2.5 }));
  const m = pointMetrics(pts);
  assert.equal(m.distanceSource, 'device');
  assert.equal(m.distanceM, 100);
  assert.equal(m.movingSec, 30, 'el tramo con velocidad 0,2 m/s del reloj no cuenta');
  const empty = pointMetrics([{ t: 0, hr: 100 }, { t: 60000, hr: 120 }]);
  assert.equal(empty.movingSec, null);
  assert.equal(empty.distanceM, null);
  assert.equal(empty.elapsedSec, 60);
  assert.equal(empty.hrAvg, 110);
});

test('desnivel: suavizado + umbral de 3 m; el ruido en llano no suma y una subida cuenta entera', () => {
  const rnd = ((s) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 0xffffffff) * 2 - 1; })(42);
  const flat = Array.from({ length: 400 }, () => 700 + rnd() * 2);
  const f = elevationStats(flat);
  assert.equal(f.ascentM, 0);
  assert.equal(f.descentM, 0);
  const hill = [];
  for (let i = 0; i <= 200; i++) hill.push(500 + i * 0.5 + rnd() * 1.5); // +100 m
  for (let i = 1; i <= 160; i++) hill.push(600 - i * 0.5 + rnd() * 1.5); // −80 m
  const e = elevationStats(hill);
  near(e.ascentM, 100, 3, 'desnivel +');
  near(e.descentM, 80, 3, 'desnivel −');
  near(e.altMaxM, 600, 2, 'altitud máxima (suavizada)');
  // Umbral: dientes de sierra de 2 m no cuentan; de 6 m sí
  const saw = (amp) => Array.from({ length: 60 }, (_, i) => 100 + (Math.floor(i / 5) % 2 ? amp : 0));
  assert.equal(elevationStats(saw(2), { smooth: 0 }).ascentM, 0);
  assert.equal(elevationStats(saw(6), { smooth: 0 }).ascentM, 36);
  assert.deepEqual(elevationStats([null, undefined]), { ascentM: null, descentM: null, altMaxM: null });
});

test('summarize: prefiere los totales del archivo (sesión FIT) y el movimiento sale de los puntos', () => {
  const hike = sampleHike();
  const [a] = parseFIT(buildFitActivity({ points: hike.points, sport: 17, session: { hrAvg: 121, hrMax: 152, cadence: 56, ascent: 598, descent: 601, maxAltM: 1502 } }));
  const s = summarize(a);
  assert.equal(s.format, 'fit');
  assert.equal(s.startedAt, Date.UTC(2026, 8, 19, 8, 0, 0));
  assert.equal(s.elapsedSec, 10800);
  assert.equal(s.timerSec, 10800);
  near(s.movingSec, 9900, 30, 'sin la parada en la cima ni la pausa automática');
  near(s.distanceM, hike.distanceM, 0.02, 'distancia de la sesión');
  assert.deepEqual([s.ascentM, s.descentM, s.altMaxM, s.hrAvg, s.hrMax, s.cadence], [598, 601, 1502, 121, 152, 56]);
  // Sin totales: todo sale de los puntos; sin puntos con movimiento: cronómetro
  const bare = summarize({ format: 'tcx', points: [{ t: 0 }, { t: 1000 }], totals: { timerSec: 1800 } });
  assert.equal(bare.movingSec, 1800);
  assert.equal(bare.elapsedSec, 1800, 'el total no es menor que el cronómetro');
  assert.equal(bare.startedAt, 0);
});

// ---------------------------------------------------------------------------
// .gz y .zip
// ---------------------------------------------------------------------------
test('gz y zip: entradas stored y deflate, carpetas y basura de macOS, zip dentro de zip, dañados', async () => {
  const gpx = gpxFromPoints(sampleRun().points.slice(0, 20));
  assert.equal(new TextDecoder().decode(await gunzip(gzip(gpx))), gpx);
  const zip = makeZip([
    { name: 'actividades/', data: '', method: 0 },
    { name: 'actividades/uno.gpx', data: gpx, method: 0 },
    { name: 'actividades/dos.gpx.gz', data: gzip(gpx), method: 8 },
    { name: '__MACOSX/actividades/._uno.gpx', data: 'basura', method: 0 },
    { name: 'leeme.txt', data: 'hola', method: 8 },
  ]);
  const entries = zipEntries(zip);
  assert.deepEqual(entries.map((e) => e.name), ['actividades/', 'actividades/uno.gpx', 'actividades/dos.gpx.gz', '__MACOSX/actividades/._uno.gpx', 'leeme.txt']);
  assert.deepEqual(entries.map(isJunkEntry), [true, false, false, true, false]);
  assert.equal(new TextDecoder().decode(await zipRead(zip, entries[1])), gpx);
  assert.equal(baseName('a/b/c.fit'), 'c.fit');
  const res = await readActivityFile('export.zip', zip);
  assert.deepEqual(res.map((r) => [r.label, r.format, r.fileName]), [
    ['export.zip › uno.gpx', 'gpx', 'uno.gpx'],
    ['export.zip › dos.gpx.gz', 'gpx', 'dos.gpx.gz'],
  ], 'leeme.txt se ignora sin error dentro de un zip');
  const nested = await readActivityFile('todo.zip', makeZip([{ name: 'dentro.zip', data: zip }]));
  assert.equal(nested.filter((r) => r.summary).length, 2);
  const none = await readActivityFile('fotos.zip', makeZip([{ name: 'a.jpg', data: 'x' }]));
  assert.equal(none.length, 1);
  assert.match(none[0].error, /no contiene actividades/);
  const broken = await readActivityFile('roto.zip', zip.subarray(0, 60));
  assert.match(broken[0].error, /dañado|incompleto/);
  const badGz = await readActivityFile('roto.gpx.gz', gzip(gpx).subarray(0, 40));
  assert.match(badGz[0].error, /dañado|incompleto/);
});

test('archivos de ejemplo (tests/fixtures/import): cada formato se lee; un .txt da un error claro sin romper el resto', async () => {
  const read = async (name) => readActivityFile(name, fs.readFileSync(path.join(FIX, name)));
  const [gpx] = await read('carrera.gpx');
  const [gz] = await read('carrera.gpx.gz');
  const [tcx] = await read('bici.tcx');
  const [fit] = await read('ruta.fit');
  const [zip] = await read('ruta-garmin.zip');
  const [unk] = await read('sin-deporte.gpx');
  const [txt] = await read('notas.txt');
  assert.deepEqual([gpx.format, gz.format, tcx.format, fit.format, zip.format, unk.format], ['gpx', 'gpx', 'tcx', 'fit', 'fit', 'gpx']);
  assert.equal(gz.fileName, 'carrera.gpx.gz');
  assert.equal(zip.label, 'ruta-garmin.zip › 1234567890_ACTIVITY.fit');
  assert.equal(zip.fileName, '1234567890_ACTIVITY.fit');
  assert.deepEqual(gz.summary, gpx.summary);
  assert.deepEqual(zip.summary, fit.summary);
  near(gpx.summary.distanceM, 5000, 30, 'carrera');
  near(tcx.summary.distanceM, 20000, 1, 'bici');
  assert.match(txt.error, /Formato no reconocido/);
});

// ---------------------------------------------------------------------------
// Deporte → tipo
// ---------------------------------------------------------------------------
test('sportToKind: running/trail → run, cycling/biking → bike, hiking → hike, swimming → swim, walking → Caminata', () => {
  const k = (...a) => { const r = sportToKind(...a); return [r.kind, r.subtype, r.poolType]; };
  assert.deepEqual(k('running'), ['run', null, null]);
  assert.deepEqual(k('trail_running'), ['run', null, null]);
  assert.deepEqual(k('TrailRun'), ['run', null, null]);
  assert.deepEqual(k('Running'), ['run', null, null], 'TCX');
  assert.deepEqual(k('9'), ['run', null, null], 'Strava numérico');
  assert.deepEqual(k('cycling'), ['bike', null, null]);
  assert.deepEqual(k('Biking'), ['bike', null, null]);
  assert.deepEqual(k('road_biking'), ['bike', null, null]);
  assert.deepEqual(k('cycling', 'indoor_cycling'), ['bike', 'trainer', null]);
  assert.deepEqual(k('VirtualRide'), ['bike', 'trainer', null]);
  assert.deepEqual(k('EBikeRide'), ['bike', null, null]);
  assert.deepEqual(k('hiking'), ['hike', null, null]);
  assert.deepEqual(k('mountaineering'), ['hike', null, null]);
  assert.deepEqual(k('swimming', 'open_water'), ['swim', null, 'open']);
  assert.deepEqual(k('lap_swimming'), ['swim', null, 'pool']);
  assert.deepEqual(k('walking'), ['other', WALK_SUBTYPE, null]);
  assert.deepEqual(k('Walk'), ['other', WALK_SUBTYPE, null]);
  assert.deepEqual(k('basketball'), ['other', 'basketball', null]);
  assert.deepEqual(k('', '', 'Carrera de mañana'), ['run', null, null], 'sin tipo, por el nombre');
  assert.deepEqual(k('', '', 'Ruta de senderismo'), ['hike', null, null]);
  assert.deepEqual(k('Other'), [null, null, null]);
  assert.deepEqual(k('generic'), [null, null, null]);
  assert.deepEqual(k('', '', 'Actividad'), [null, null, null]);
});

test('stepsCadence: zancadas → pasos por minuto en carrera y andando; rpm en bici', () => {
  assert.equal(stepsCadence('run', 85), 170);
  assert.equal(stepsCadence('run', 172), 172, 'ya en pasos');
  assert.equal(stepsCadence('hike', 56), 112);
  assert.equal(stepsCadence('hike', 110), 110);
  assert.equal(stepsCadence('bike', 88.6), 89);
  assert.equal(stepsCadence('run', null), null);
});

// ---------------------------------------------------------------------------
// Item → registro
// ---------------------------------------------------------------------------
async function itemOf(name, key = 'i1') {
  const [e] = await readActivityFile(name, fs.readFileSync(path.join(FIX, name)));
  return itemFromEntry(e, { key, today: TODAY });
}

test('registro importado: misma forma que el formulario de actividad + startedAt y source; sin puntos GPS', async () => {
  const it = await itemOf('carrera.gpx');
  assert.equal(it.kind, 'run');
  assert.equal(it.date, '2026-09-20');
  assert.equal(itemTime(it), '08:00');
  assert.equal(it.cadence, it.cadenceRaw > 0 ? Math.round(it.cadenceRaw * 2) : null);
  it.rpe = 6;
  const now = Date.UTC(2026, 8, 26, 10);
  const rec = itemRecord(it, { id: 'a_test', now });
  const formRec = buildRecord(emptyForm('run', { date: '2026-09-20' }), null, { id: 'a_form', now });
  assert.deepEqual(Object.keys(rec).sort(), [...Object.keys(formRec), 'source'].sort(), 'mismas claves que el formulario (+ source)');
  assert.equal(rec.id, 'a_test');
  assert.equal(rec.kind, 'run');
  assert.equal(rec.status, 'done');
  assert.equal(rec.date, '2026-09-20');
  assert.equal(rec.planDate, '2026-09-20');
  assert.equal(rec.startedAt, Date.UTC(2026, 8, 20, 6, 0, 0));
  assert.deepEqual(rec.source, { type: 'gpx', fileName: 'carrera.gpx' });
  assert.equal(rec.durationMin, rec.movingSec / 60);
  near(rec.movingSec, 1500, 20, 'movimiento');
  assert.equal(rec.elapsedSec, 1620);
  near(rec.distanceKm, 5, 0.03, 'km');
  assert.equal(rec.rpe, 6);
  assert.equal(rec.templateName, 'Carrera');
  assert.ok(rec.elevationM >= 27 && rec.elevationM <= 33);
  assert.ok(rec.elevationLossM >= 27 && rec.elevationLossM <= 33);
  assert.equal(rec.altMaxM, 680);
  assert.ok(rec.cadence >= 160 && rec.cadence <= 176, 'pasos por minuto');
  assert.ok(!JSON.stringify(rec).includes('"lat"'), 'no guarda puntos');
});

test('senderismo desde FIT (zip de Garmin): desnivel ±, altitud máx., FC y cadencia (dato del archivo)', async () => {
  const it = await itemOf('ruta-garmin.zip');
  const rec = itemRecord(it, { id: 'a_h', now: 1 });
  assert.equal(rec.kind, 'hike');
  assert.equal(rec.templateName, 'Senderismo');
  assert.deepEqual([rec.elevationM, rec.elevationLossM, rec.altMaxM, rec.hrAvg, rec.hrMax], [598, 601, 1502, 121, 152]);
  assert.equal(rec.cadence, 112, 'se conserva aunque el formulario de senderismo no la pida');
  assert.equal(rec.packKg, null);
  near(rec.movingSec, 9900, 30, 'movimiento');
  assert.equal(rec.elapsedSec, 10800);
  assert.deepEqual(rec.source, { type: 'fit', fileName: '1234567890_ACTIVITY.fit' });
});

test('caminata → «otra actividad» Caminata (la distancia, que ese tipo no tiene, va a las notas)', () => {
  const walk = makeTrack({ start: Date.UTC(2026, 8, 22, 16, 0, 0), stepSec: 10, phases: [{ sec: 1800, speed: 1.4 }] });
  const it = itemFromEntry({ label: 'paseo.gpx', fileName: 'paseo.gpx', format: 'gpx', summary: summarize(parseGPX(gpxFromPoints(walk.points, { type: 'walking', name: 'Paseo' }))[0]) }, { key: 'w', today: TODAY });
  assert.equal(it.kind, 'other');
  assert.equal(it.subtype, WALK_SUBTYPE);
  const rec = itemRecord(it, { id: 'a_w', now: 1 });
  assert.equal(rec.subtype, 'Caminata');
  assert.equal(rec.templateName, 'Caminata');
  assert.equal(activityTitle(rec), 'Caminata');
  assert.equal(rec.distanceKm, null);
  assert.match(rec.notes, /^Distancia: 2,52 km$/);
  assert.equal(rec.movingSec, 1800);
});

test('deporte desconocido: hay que elegirlo; al elegir se calculan duración y cadencia; natación usa el cronómetro', async () => {
  const it = await itemOf('sin-deporte.gpx');
  assert.equal(it.kind, null);
  assert.equal(it.movingSec, null);
  assert.deepEqual(itemProblems(it, TODAY), ['kind', 'duration']);
  assert.equal(problemText(itemProblems(it, TODAY)), 'Elige el deporte · Falta la duración');
  setItemKind(it, 'hike');
  assert.equal(it.movingSec, 600);
  assert.deepEqual(itemProblems(it, TODAY), []);
  // Lo editado por el usuario no se recalcula al cambiar de tipo
  setItemField(it, 'movingSec', 700);
  setItemKind(it, 'run');
  assert.equal(it.movingSec, 700);
  const swim = itemFromEntry({ label: 's.fit', fileName: 's.fit', format: 'fit', summary: { format: 'fit', sport: 'swimming', subSport: 'lap_swimming', startedAt: Date.UTC(2026, 8, 3, 6), movingSec: 1500, timerSec: 2100, elapsedSec: 2400, distanceM: 2000, poolLengthM: 25 } }, { key: 's', today: TODAY });
  assert.deepEqual([swim.kind, swim.movingSec, swim.poolType, swim.poolLengthM], ['swim', 2100, 'pool', 25]);
  const srec = itemRecord(swim, { id: 'a_s', now: 1 });
  assert.deepEqual([srec.poolType, srec.poolLengthM, srec.distanceKm, srec.hrAvg], ['pool', 25, 2, null]);
});

test('fecha y hora editables: la fecha conserva la hora; sin hora del archivo se puede poner; fecha futura no vale', async () => {
  const it = await itemOf('bici.tcx');
  assert.equal(itemTime(it), '18:00');
  setItemDate(it, '2026-09-22');
  assert.equal(it.date, '2026-09-22');
  assert.equal(itemTime(it), '18:00');
  assert.equal(it.startedAt, new Date(2026, 8, 22, 18, 0, 0).getTime());
  setItemTime(it, '07:45');
  assert.equal(it.startedAt, new Date(2026, 8, 22, 7, 45, 0).getTime());
  setItemTime(it, '');
  assert.equal(it.startedAt, null);
  setItemTime(it, '19:05');
  assert.equal(it.startedAt, new Date(2026, 8, 22, 19, 5, 0).getTime());
  setItemDate(it, '2026-09-30');
  assert.deepEqual(itemProblems(it, TODAY), ['future']);
  setItemDate(it, 'no-es-fecha');
  assert.equal(it.date, '2026-09-30');
  assert.deepEqual(itemForm(it).kind, 'bike');
});

// ---------------------------------------------------------------------------
// Duplicados
// ---------------------------------------------------------------------------
const act = (o) => ({ id: o.id || 'x', kind: 'run', status: 'done', date: '2026-09-20', startedAt: null, movingSec: 1500, durationMin: 25, distanceKm: 5, ...o });

test('isSameActivity: inicio a ±2 min; sin hora, misma fecha con duración y distancia a ±3 %', () => {
  const t = Date.UTC(2026, 8, 20, 6, 0, 0);
  const a = act({ startedAt: t });
  assert.equal(isSameActivity(a, act({ startedAt: t + 119000 })), true);
  assert.equal(isSameActivity(a, act({ startedAt: t + 121000 })), false);
  assert.equal(isSameActivity(a, act({ startedAt: t + 60000, kind: 'bike' })), false, 'otro tipo');
  assert.equal(isSameActivity(a, act({})), true, 'la guardada no tiene hora: fecha + ±3 %');
  assert.equal(isSameActivity(a, act({ movingSec: 1540, distanceKm: 5.14 })), true);
  assert.equal(isSameActivity(a, act({ movingSec: 1560 })), false, 'duración a más del 3 %');
  assert.equal(isSameActivity(a, act({ distanceKm: 5.2 })), false, 'distancia a más del 3 %');
  assert.equal(isSameActivity(a, act({ date: '2026-09-21' })), false, 'otra fecha');
  assert.equal(isSameActivity(a, act({ distanceKm: null })), false, 'solo una tiene distancia');
  assert.equal(isSameActivity(act({ distanceKm: null, kind: 'other' }), act({ distanceKm: null, kind: 'other', movingSec: null, durationMin: 25.3 })), true, 'sin distancia en ninguna: basta la duración');
  const list = [act({ id: 's1', kind: 'strength' }), act({ id: 's2', status: 'active' }), act({ id: 's3' })];
  assert.equal(findDuplicate(a, list).id, 's3', 'ni fuerza ni sesiones sin terminar');
});

test('updateDuplicates: «ya registrada» y repetidas en la misma importación se desmarcan; la selección del usuario se respeta', async () => {
  const it1 = await itemOf('carrera.gpx', 'i1');
  const it2 = await itemOf('carrera.gpx.gz', 'i2');
  const it3 = await itemOf('bici.tcx', 'i3');
  const it4 = await itemOf('sin-deporte.gpx', 'i4');
  const saved = [act({ id: 'old', startedAt: Date.UTC(2026, 8, 20, 6, 1, 0), templateName: 'Carrera' })];
  const items = [it1, it2, it3, it4];
  updateDuplicates(items, saved, TODAY);
  assert.deepEqual(items.map((i) => i.dup?.type ?? null), ['saved', 'saved', null, null]);
  assert.equal(it1.dup.id, 'old');
  assert.deepEqual(items.map((i) => i.selected), [false, false, true, false]);
  assert.deepEqual(selectedItems(items, TODAY).map((i) => i.key), ['i3']);
  // Sin la guardada: la segunda copia es repetida de la primera
  updateDuplicates(items, [], TODAY);
  assert.deepEqual(items.map((i) => i.dup?.type ?? null), [null, 'batch', null, null]);
  assert.equal(it2.dup.key, 'i1');
  assert.deepEqual(items.map((i) => i.selected), [true, false, true, false], 'deja de ser duplicada → se marca');
  // El usuario desmarca la bici: se respeta en el siguiente cálculo
  it3.selected = false;
  updateDuplicates(items, [], TODAY);
  assert.equal(it3.selected, false);
  // Al elegir el deporte de la desconocida se marca (ya se puede guardar)
  setItemKind(it4, 'other');
  updateDuplicates(items, [], TODAY);
  assert.equal(it4.selected, true);
  // Una marcada a mano como duplicada se puede importar igualmente
  it2.selected = true;
  updateDuplicates(items, [], TODAY);
  assert.equal(it2.selected, true);
});

test('itemFacts: datos principales y secundarios de la tarjeta', async () => {
  const run = await itemOf('carrera.gpx');
  const f = itemFacts(run);
  assert.equal(f.main[0], '5 km');
  assert.match(f.main[1], /^25:\d\d$/);
  assert.match(f.main[2], /^5:0\d \/km$/);
  assert.match(f.main[3], /^\+\d\d m$/);
  assert.match(f.extra.join(' · '), /^FC \d+ \/ \d+ · \d+ ppm · total 27:00$/);
  const bike = await itemOf('bici.tcx');
  assert.deepEqual(itemFacts(bike).main.slice(0, 3), ['20 km', '45:00', '26,7 km/h']);
  assert.match(itemFacts(bike).extra.join(' · '), /rpm · \d+ W/);
});
