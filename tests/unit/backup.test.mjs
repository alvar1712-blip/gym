// Pruebas de la lógica pura de Ajustes: copias JSON y CSV (js/backup.js) y umbrales / semana tipo
// (js/settings-logic.js). Ejecutar: node --test 'tests/unit/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backupFileName, csvFileName, fileStamp, buildBackupObject, backupSummary, dataCounts, parseBackupText, lostSectionsWarning,
  csvFormat, csvNumber, csvText, buildCsv, strengthCsv, strengthRows, cardioCsv, cardioRows, csvCounts,
  STRENGTH_COLUMNS, CARDIO_COLUMNS, hms, formatBytes, localKeysToClear,
} from '../../js/backup.js';
import {
  THRESHOLD_KEYS, thresholdDefaults, getPath, setPath, fixPair, planLabel, shortPlanLabel, weekSummaryText, patternFromDate,
} from '../../js/settings-logic.js';
import { validateBackup, BACKUP_APP_ID, BACKUP_FORMAT } from '../../js/store.js';
import { defaultSettings, SEED_EXERCISES, SEED_TEMPLATES, TEMPLATE_IDS } from '../../js/seed.js';
import { deepClone } from '../../js/util.js';

const BOM = '\uFEFF';

/** Parser CSV (RFC 4180) mínimo para comprobar el escapado haciendo el viaje de ida y vuelta. */
function parseCsv(text, sep) {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\r' && src[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Filas como objetos {cabecera: valor}. */
function csvObjects(text, sep) {
  const [head, ...rows] = parseCsv(text, sep);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const exMap = new Map(SEED_EXERCISES.map((e) => [e.id, { ...deepClone(e), custom: false, archived: false }]));
const set = (o) => ({ id: `s${Math.random()}`, type: 'effective', weight: null, reps: null, repsR: null, rir: null, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: 1, ...o });
const se = (id, exerciseId, sets, exName = '') => ({ id, exerciseId, exName, templateItemId: null, alternatives: [], target: {}, notes: '', section: '', groupId: null, groupType: null, sets });

function strengthSession(o = {}) {
  return {
    id: 'st1', kind: 'strength', date: '2026-09-21', planDate: '2026-09-21', templateId: TEMPLATE_IDS.d1, templateName: 'Día 1 — Upper pesado',
    status: 'done', startedAt: 1000, endedAt: 1000 + 3600000, durationMin: 62.5, rpe: 8, notes: 'Buen día; algo cansado', parentId: null, cursor: 0,
    createdAt: 1000, updatedAt: 1000,
    exercises: [
      se('se1', 'press_banca', [
        set({ type: 'warmup', weight: 40, reps: 10 }),
        set({ weight: 100, reps: 5, rir: 1, note: 'Pausa "larga"' }),
        set({ weight: 72.5, reps: 8, rir: 'F', type: 'failure' }),
        set({ weight: 80, reps: 8, done: false }), // pendiente: no se exporta
      ]),
      se('se2', 'dominadas', [set({ weight: 10, reps: 6, rir: 2 })]),
      se('se3', 'bulgara', [set({ weight: 20, reps: 8, repsR: 7, rir: 2 })]),
      se('se4', 'plancha', [set({ timeSec: 45 })]),
      se('se5', 'sprint', [set({ distanceM: 20, timeSec: 3.45 })]),
      se('se6', 'saltos_verticales', [set({ reps: 3, heightCm: 55.5 })]),
      se('se7', 'ejercicio_borrado', [set({ weight: 30, reps: 10 })], 'Máquina rara'),
    ],
    ...o,
  };
}

const run = {
  id: 'a1', kind: 'run', date: '2026-09-22', status: 'done', subtype: 'z2', distanceKm: 10, movingSec: 3000, elapsedSec: 3125, durationMin: 50,
  elevationM: 85, hrAvg: 148, hrMax: 171, cadence: 172, rpe: 5, feel: 'Z2 cómoda', notes: 'Línea 1\nLínea 2', parentId: null, createdAt: 2000,
};
const swim = {
  id: 'a2', kind: 'swim', date: '2026-09-20', status: 'done', distanceKm: 1.5, movingSec: 1800, durationMin: 30, poolType: 'pool', poolLengthM: 25,
  stroke: 'free', rpe: 6, notes: '', parentId: null, createdAt: 1500,
};
const bike = {
  id: 'a3', kind: 'bike', date: '2026-09-21', status: 'done', subtype: 'route', distanceKm: 40.25, movingSec: 5400, durationMin: 90, powerAvg: 180, powerNp: 195,
  rpe: 6, parentId: 'st1', parentItemId: 'se9', notes: '', createdAt: 5000,
};
const other = { id: 'a4', kind: 'other', date: '2026-09-23', status: 'done', subtype: 'basketball', durationMin: 60, movingSec: 3600, rpe: 7, notes: '=peligro', createdAt: 6000 };

// ---------------------------------------------------------------------------
// Nombres de archivo
// ---------------------------------------------------------------------------
test('backupFileName: entreno-copia-AAAA-MM-DD-HHMM.json en hora local', () => {
  assert.equal(backupFileName(new Date(2026, 8, 3, 7, 5)), 'entreno-copia-2026-09-03-0705.json');
  assert.equal(backupFileName(new Date(2026, 11, 31, 23, 59)), 'entreno-copia-2026-12-31-2359.json');
  // También acepta un instante en ms.
  assert.equal(backupFileName(new Date(2027, 0, 1, 0, 0).getTime()), 'entreno-copia-2027-01-01-0000.json');
  assert.match(backupFileName(), /^entreno-copia-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  assert.equal(fileStamp(new Date(2026, 0, 2, 3, 4)), '2026-01-02-0304');
});

test('csvFileName: fuerza y cardio por separado', () => {
  const d = new Date(2026, 8, 23, 18, 30);
  assert.equal(csvFileName('fuerza', d), 'entreno-fuerza-2026-09-23-1830.csv');
  assert.equal(csvFileName('cardio', d), 'entreno-cardio-2026-09-23-1830.csv');
});

// ---------------------------------------------------------------------------
// Copia JSON
// ---------------------------------------------------------------------------
function sampleExport() {
  const settings = { ...defaultSettings(), secondaryFactor: 0.75, lastBackupAt: null };
  return {
    app: BACKUP_APP_ID, format: BACKUP_FORMAT, appVersion: '1.0.0', exportedAt: '2026-01-01T00:00:00.000Z',
    data: {
      meta: [{ id: 'app', createdAt: 1, seedVersion: 1, schema: 1 }, settings],
      exercises: [{ ...deepClone(SEED_EXERCISES[0]) }, { id: 'mi_ej', name: 'Mío', custom: true }],
      templates: deepClone(SEED_TEMPLATES),
      sessions: [strengthSession(), run, swim],
      plan: [{ id: '2026-09-26', kind: 'free', label: 'Ruta en bici', activityKind: 'bike' }],
      bodyweight: [{ id: '2026-09-20', kg: 75.4 }, { id: '2026-09-21', kg: 75.1 }],
      checkins: [{ id: 'c1', date: '2026-09-21', timing: 'pre', sleep: 2 }],
      goals: [],
    },
  };
}

test('buildBackupObject: lastBackupAt = ahora DENTRO de la copia, sin mutar el original', () => {
  const src = sampleExport();
  const before = JSON.stringify(src);
  const now = new Date(2026, 8, 23, 10, 0).getTime();
  const obj = buildBackupObject(src, now);
  assert.equal(JSON.stringify(src), before, 'no muta el objeto de entrada');
  const settings = obj.data.meta.find((m) => m.id === 'settings');
  assert.equal(settings.lastBackupAt, now);
  assert.equal(obj.exportedAt, new Date(now).toISOString());
  // El resto de datos queda igual.
  for (const s of ['exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals']) assert.deepEqual(obj.data[s], src.data[s]);
  assert.equal(settings.secondaryFactor, 0.75);
  assert.equal(obj.app, BACKUP_APP_ID);
  assert.ok(validateBackup(obj).ok);
});

test('dataCounts / backupSummary: recuento por tipo y fecha de la copia', () => {
  const obj = buildBackupObject(sampleExport(), Date.UTC(2026, 8, 23, 8, 0));
  const c = dataCounts(obj.data);
  assert.deepEqual(c, { strength: 1, activities: 2, templates: 5, exercises: 2, customExercises: 1, bodyweight: 2, plan: 1, checkins: 1, goals: 0, context: 0, pastRecords: 0, races: 0 });
  const sum = backupSummary(obj);
  assert.equal(sum.exportedAt, Date.UTC(2026, 8, 23, 8, 0));
  assert.equal(sum.appVersion, '1.0.0');
  assert.equal(sum.firstDate, '2026-09-20');
  assert.equal(sum.lastDate, '2026-09-22');
  // Sin exportedAt legible se usa lastBackupAt.
  const o2 = buildBackupObject(sampleExport(), 12345);
  o2.exportedAt = 'no es fecha';
  assert.equal(backupSummary(o2).exportedAt, 12345);
  assert.deepEqual(dataCounts({}), { strength: 0, activities: 0, templates: 0, exercises: 0, customExercises: 0, bodyweight: 0, plan: 0, checkins: 0, goals: 0, context: 0, pastRecords: 0, races: 0 });
  assert.equal(dataCounts({ races: [{ id: 'r1' }] }).races, 1);
  assert.equal(dataCounts({ context: [{ id: 'a' }, { id: 'b' }] }).context, 2);
  assert.equal(dataCounts({ pastRecords: [{ id: 'a' }] }).pastRecords, 1);
});

test('lostSectionsWarning: solo avisa si la copia no trae una sección en la que ahora hay datos', () => {
  const v1 = { format: 1, data: { meta: [], sessions: [] } };
  const v2 = { format: 2, data: { meta: [], context: [], pastRecords: [], races: [] } };
  assert.equal(lostSectionsWarning(v1, { context: 5 }),
    'Esta copia se hizo con una versión anterior de la app y no contiene contexto, marcas históricas ni eventos deportivos. '
    + 'Al restaurarla se borrará lo que tienes ahora en esa sección: 5 apuntes de contexto.');
  assert.match(lostSectionsWarning(v1, { context: 1, pastRecords: 0, races: 2 }), /en esas secciones: 1 apunte de contexto y 2 eventos deportivos\.$/);
  assert.equal(lostSectionsWarning(v1, {}), null, 'sin datos actuales en esas secciones no hay nada que perder');
  assert.equal(lostSectionsWarning(v1, { context: 0 }), null);
  assert.equal(lostSectionsWarning(v2, { context: 5, races: 1 }), null, 'una copia que trae las secciones (aunque vacías) no avisa');
  assert.match(lostSectionsWarning({ data: { context: [] } }, { races: 3 }), /no contiene marcas históricas ni eventos deportivos\. .*3 eventos deportivos\.$/);
  assert.equal(lostSectionsWarning(null, { context: 2 }).startsWith('Esta copia'), true);
});

test('parseBackupText: copia válida (también con BOM y espacios)', () => {
  const obj = buildBackupObject(sampleExport(), 1);
  for (const text of [JSON.stringify(obj), `${BOM}  ${JSON.stringify(obj, null, 2)}\n`]) {
    const r = parseBackupText(text, validateBackup);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.backup, obj);
    assert.equal(r.summary.strength, 1);
    assert.equal(r.summary.activities, 2);
  }
});

test('parseBackupText: errores amables para archivos que no son una copia válida', () => {
  const bad = (text, re) => {
    const r = parseBackupText(text, validateBackup);
    assert.equal(r.ok, false, `debería fallar: ${String(text).slice(0, 40)}`);
    assert.equal(typeof r.error, 'string');
    if (re) assert.match(r.error, re);
    assert.equal(r.backup, undefined);
  };
  bad('', /vacío/);
  bad('   \n', /vacío/);
  bad(null, /vacío/);
  bad('hola, esto no es JSON', /JSON/);
  bad('{"app": "entreno-pwa", ', /JSON/); // truncado
  bad('Fecha;Sesión\r\n2026-09-21;D1\r\n', /JSON/); // un CSV
  bad('[1,2,3]', /no es una copia/);
  bad('42', /no es una copia/);
  bad('"texto"', /no es una copia/);
  bad('null', /no es una copia/);
  bad(JSON.stringify({ app: 'otra-app', format: 1, data: {} }), /no es una copia de esta app/);
  const obj = sampleExport();
  bad(JSON.stringify({ ...obj, format: BACKUP_FORMAT + 1 }), /versión más nueva/);
  bad(JSON.stringify({ ...obj, data: null }), /no contiene datos/);
  bad(JSON.stringify({ ...obj, data: { ...obj.data, sessions: { a: 1 } } }), /dañada/);
  bad(JSON.stringify({ ...obj, data: { ...obj.data, sessions: [{ kind: 'run' }] } }), /sin id/);
  bad(JSON.stringify({ ...obj, data: { ...obj.data, meta: [{ id: 'app' }] } }), /ajustes/);
  // Sin validador externo: al menos exige un bloque data.
  assert.equal(parseBackupText('{"x":1}').ok, false);
  assert.equal(parseBackupText(JSON.stringify(obj)).ok, true);
});

// ---------------------------------------------------------------------------
// CSV: escapado, números, formato
// ---------------------------------------------------------------------------
test('csvText: comillas, separador y saltos de línea', () => {
  assert.equal(csvText('simple', ';'), 'simple');
  assert.equal(csvText('a;b', ';'), '"a;b"');
  assert.equal(csvText('a;b', ','), 'a;b', 'el ; no se escapa si el separador es ,');
  assert.equal(csvText('a,b', ','), '"a,b"');
  assert.equal(csvText('dijo "hola"', ','), '"dijo ""hola"""');
  assert.equal(csvText('línea 1\nlínea 2', ','), '"línea 1\nlínea 2"');
  assert.equal(csvText('retorno\r', ','), '"retorno\r"');
  assert.equal(csvText(null, ','), '');
  assert.equal(csvText(undefined, ','), '');
  assert.equal(csvText('ñandú 💪', ';'), 'ñandú 💪');
  // En modo Excel se neutralizan las fórmulas (inyección CSV).
  assert.equal(csvText('=SUMA(A1)', ';', true), "'=SUMA(A1)");
  assert.equal(csvText('+34 600', ';', true), "'+34 600");
  assert.equal(csvText('@x', ';', true), "'@x");
  assert.equal(csvText('=a;b', ';', true), `"'=a;b"`);
  assert.equal(csvText('=SUMA(A1)', ',', false), '=SUMA(A1)', 'en formato estándar el texto va tal cual');
});

test('csvNumber: coma decimal en Excel, punto en estándar, redondeo y vacíos', () => {
  assert.equal(csvNumber(72.5, 2, true), '72,5');
  assert.equal(csvNumber(72.5, 2, false), '72.5');
  assert.equal(csvNumber(1.006, 2, false), '1.01');
  assert.equal(csvNumber(62.5, 0, false), '63');
  assert.equal(csvNumber(120.04, 1, true), '120');
  assert.equal(csvNumber(1234567.891, 1, true), '1234567,9', 'sin separador de miles');
  assert.equal(csvNumber(-2.5, 1, true), '-2,5');
  assert.equal(csvNumber(-0.01, 1, true), '0', 'sin «-0»');
  assert.equal(csvNumber(0, 1, true), '0');
  assert.equal(csvNumber(null), '');
  assert.equal(csvNumber(NaN), '');
  assert.equal(csvNumber(Infinity), '');
  assert.equal(csvNumber('7'), '', 'solo números');
});

test('buildCsv: BOM + ";" en Excel, "," sin BOM en estándar, CRLF y cabecera', () => {
  const cols = [{ h: 'Texto' }, { h: 'Número', dec: 1 }, { h: 'Vacío' }];
  const rows = [['a;b', 1.25, null], ['x "y"\nz', -3, undefined]];
  const excel = buildCsv(cols, rows, { excel: true });
  assert.ok(excel.startsWith(BOM), 'BOM UTF-8 al principio');
  assert.equal(excel, `${BOM}Texto;Número;Vacío\r\n"a;b";1,3;\r\n"x ""y""\nz";-3;\r\n`);
  const std = buildCsv(cols, rows, { excel: false });
  assert.ok(!std.startsWith(BOM));
  assert.equal(std, 'Texto,Número,Vacío\r\na;b,1.3,\r\n"x ""y""\nz",-3,\r\n');
  // Ida y vuelta.
  assert.deepEqual(parseCsv(excel, ';'), [['Texto', 'Número', 'Vacío'], ['a;b', '1,3', ''], ['x "y"\nz', '-3', '']]);
  assert.deepEqual(csvFormat(true), { sep: ';', dec: ',', bom: BOM, excel: true });
  assert.deepEqual(csvFormat(false), { sep: ',', dec: '.', bom: '', excel: false });
  // Sin filas: solo cabecera.
  assert.equal(buildCsv(cols, [], { excel: false }), 'Texto,Número,Vacío\r\n');
});

// ---------------------------------------------------------------------------
// CSV de fuerza
// ---------------------------------------------------------------------------
test('strengthCsv: columnas pedidas y una fila por serie HECHA', () => {
  const headers = STRENGTH_COLUMNS.map((c) => c.h);
  assert.deepEqual(headers, [
    'Fecha', 'Sesión', 'Ejercicio', 'Músculo principal', 'Orden ejercicio', 'Nº serie', 'Tipo de serie', 'Peso (kg)', 'Reps', 'Reps derecha',
    'RIR (F = fallo)', 'Tiempo (s)', 'Distancia (m)', 'Altura (cm)', 'Nota serie', '1RM estimado (kg)', 'Volumen (kg)',
    'Duración sesión (min)', 'RPE sesión', 'Carga sesión', 'Nota sesión',
  ]);
  const settings = defaultSettings();
  const csv = strengthCsv([strengthSession(), run], exMap, settings, { excel: true, bodyweight: [{ id: '2026-09-01', kg: 80 }] });
  assert.ok(csv.startsWith(BOM));
  const rows = csvObjects(csv, ';');
  assert.equal(rows.length, 9, '9 series hechas (la pendiente y la actividad no cuentan)');
  assert.ok(rows.every((r) => Object.keys(r).length === headers.length));

  const [warm, top, fail, dom, bul, plank, sprint, jump, gone] = rows;
  // Calentamiento: se exporta, pero sin 1RM ni volumen.
  assert.equal(warm['Tipo de serie'], 'Calentamiento');
  assert.equal(warm['1RM estimado (kg)'], '');
  assert.equal(warm['Volumen (kg)'], '');
  assert.equal(warm['Nº serie'], '1');
  // Serie efectiva: 100 × 5 con RIR 1 → Epley con 6 reps = 120 kg; volumen 500.
  assert.equal(top.Fecha, '2026-09-21');
  assert.equal(top['Sesión'], 'Día 1 — Upper pesado');
  assert.equal(top.Ejercicio, exMap.get('press_banca').name);
  assert.equal(top['Músculo principal'], 'Pecho');
  assert.equal(top['Orden ejercicio'], '1');
  assert.equal(top['Nº serie'], '2');
  assert.equal(top['Tipo de serie'], 'Efectiva');
  assert.equal(top['Peso (kg)'], '100');
  assert.equal(top.Reps, '5');
  assert.equal(top['RIR (F = fallo)'], '1');
  assert.equal(top['Nota serie'], 'Pausa "larga"');
  assert.equal(top['1RM estimado (kg)'], '120');
  assert.equal(top['Volumen (kg)'], '500');
  assert.equal(top['Duración sesión (min)'], '62,5');
  assert.equal(top['RPE sesión'], '8');
  assert.equal(top['Carga sesión'], '500');
  assert.equal(top['Nota sesión'], 'Buen día; algo cansado');
  // Coma decimal y RIR «F».
  assert.equal(fail['Peso (kg)'], '72,5');
  assert.equal(fail['RIR (F = fallo)'], 'F');
  assert.equal(fail['Tipo de serie'], 'Al fallo');
  assert.equal(fail['1RM estimado (kg)'], '91,8'); // 72,5 × (1 + 8/30)
  // Peso corporal: carga = peso corporal del día (80) + lastre (10).
  assert.equal(dom['Músculo principal'], 'Espalda');
  assert.equal(dom['Peso (kg)'], '10');
  assert.equal(dom['Volumen (kg)'], '540');
  assert.equal(dom['Orden ejercicio'], '2');
  // Unilateral: reps izquierda y derecha.
  assert.equal(bul.Reps, '8');
  assert.equal(bul['Reps derecha'], '7');
  assert.equal(bul['Músculo principal'], 'Cuádriceps / Glúteos');
  assert.equal(bul['Volumen (kg)'], '300');
  // Tiempo, distancia, altura.
  assert.equal(plank['Tiempo (s)'], '45');
  assert.equal(plank['1RM estimado (kg)'], '');
  assert.equal(sprint['Distancia (m)'], '20');
  assert.equal(sprint['Tiempo (s)'], '3,45', 'sprint con centésimas (no se redondea a segundos)');
  assert.equal(jump['Altura (cm)'], '55,5');
  // Ejercicio que ya no existe: se usa el nombre copiado en la sesión.
  assert.equal(gone.Ejercicio, 'Máquina rara');
  assert.equal(gone['Músculo principal'], '');
  assert.equal(gone['1RM estimado (kg)'], '');
});

test('strengthCsv: formato estándar, orden cronológico, sesión libre y sin sesiones', () => {
  const s1 = strengthSession({ id: 'b', date: '2026-09-22', templateName: '', templateId: null, startedAt: 10 });
  const s2 = strengthSession({ id: 'a', date: '2026-09-21', startedAt: 20, rpe: null, durationMin: null, startedAt_: 0, endedAt: null, notes: '' });
  const s3 = strengthSession({ id: 'c', date: '2026-09-22', startedAt: 5 });
  const csv = strengthCsv([s1, s2, s3], exMap, defaultSettings(), { excel: false });
  assert.ok(!csv.startsWith(BOM));
  const rows = csvObjects(csv, ',');
  assert.equal(rows.length, 27);
  // 21 sep primero; el 22, la que empezó antes (c) antes que b.
  assert.equal(rows[0].Fecha, '2026-09-21');
  assert.equal(rows[9].Fecha, '2026-09-22');
  assert.equal(rows[9]['Sesión'], 'Día 1 — Upper pesado');
  assert.equal(rows[18]['Sesión'], 'Sesión libre');
  assert.equal(rows[2]['Peso (kg)'], '72.5');
  assert.equal(rows[6]['Tiempo (s)'], '3.45', 'sprint con centésimas');
  assert.equal(rows[5]['Tiempo (s)'], '45', 'tiempo entero sin decimales');
  assert.equal(rows[0]['Carga sesión'], '', 'sin RPE no hay carga');
  assert.equal(rows[0]['RPE sesión'], '');
  // Sin sesiones: solo la cabecera.
  assert.equal(strengthCsv([], exMap, defaultSettings(), { excel: false }).split('\r\n').filter(Boolean).length, 1);
  // Por defecto usa el formato de los ajustes (csv.excel).
  assert.ok(strengthCsv([], exMap, defaultSettings()).startsWith(BOM));
  assert.ok(!strengthCsv([], exMap, { ...defaultSettings(), csv: { excel: false } }).startsWith(BOM));
  // exMap también puede ser un objeto simple.
  assert.equal(strengthRows([strengthSession()], Object.fromEntries(exMap), {}).length, 9);
});

// ---------------------------------------------------------------------------
// CSV de cardio
// ---------------------------------------------------------------------------
test('cardioCsv: una fila por actividad con ritmos, velocidades y etiquetas', () => {
  const headers = CARDIO_COLUMNS.map((c) => c.h);
  for (const h of ['Fecha', 'Tipo', 'Subtipo', 'Distancia (km)', 'Duración (min)', 'Tiempo total (h:mm:ss)', 'Ritmo (min/km)', 'Velocidad (km/h)',
    'Ritmo (min/100 m)', 'Desnivel (m)', 'FC media', 'FC máx', 'Cadencia', 'Potencia media (W)', 'NP (W)', 'Piscina / aguas abiertas', 'Estilo',
    'RPE', 'Carga', 'Sensaciones', 'Notas']) assert.ok(headers.includes(h), `falta la columna ${h}`);

  const csv = cardioCsv([run, strengthSession(), swim, bike, other], { excel: true });
  assert.ok(csv.startsWith(BOM));
  const rows = csvObjects(csv, ';');
  assert.equal(rows.length, 4, 'la sesión de fuerza no entra');
  assert.deepEqual(rows.map((r) => r.Tipo), ['Natación', 'Bici', 'Carrera', 'Otra actividad'], 'orden cronológico');
  const [sw, bk, rn, ot] = rows;

  assert.equal(rn.Fecha, '2026-09-22');
  assert.equal(rn.Subtipo, 'Rodaje / Z2');
  assert.equal(rn['Distancia (km)'], '10');
  assert.equal(rn['Duración (min)'], '50');
  assert.equal(rn['Duración (h:mm:ss)'], '0:50:00');
  assert.equal(rn['Tiempo total (h:mm:ss)'], '0:52:05');
  assert.equal(rn['Ritmo (min/km)'], '0:05:00', 'h:mm:ss: Excel leería «5:00» como 5 horas');
  assert.equal(rn['Velocidad (km/h)'], '12');
  assert.equal(rn['Ritmo (min/100 m)'], '', 'ritmo /100 m solo en natación');
  assert.equal(rn['Desnivel (m)'], '85');
  assert.equal(rn['FC media'], '148');
  assert.equal(rn['FC máx'], '171');
  assert.equal(rn.Cadencia, '172');
  assert.equal(rn.RPE, '5');
  assert.equal(rn.Carga, '250');
  assert.equal(rn.Sensaciones, 'Z2 cómoda');
  assert.equal(rn.Notas, 'Línea 1\nLínea 2', 'salto de línea dentro de la celda');
  assert.equal(rn['Dentro de la sesión'], '');

  assert.equal(sw['Ritmo (min/100 m)'], '0:02:00');
  assert.equal(sw['Piscina / aguas abiertas'], 'Piscina');
  assert.equal(sw['Largo piscina (m)'], '25');
  assert.equal(sw.Estilo, 'Crol');
  assert.equal(sw['Distancia (km)'], '1,5');

  assert.equal(bk.Subtipo, 'Ruta');
  assert.equal(bk['Distancia (km)'], '40,25');
  assert.equal(bk['Velocidad (km/h)'], '26,8'); // 40,25 km en 1 h 30 min
  assert.equal(bk['Potencia media (W)'], '180');
  assert.equal(bk['NP (W)'], '195');
  assert.equal(bk['Duración (h:mm:ss)'], '1:30:00');
  assert.equal(bk['Dentro de la sesión'], 'Día 1 — Upper pesado', 'actividad registrada dentro de una sesión de fuerza');

  assert.equal(ot.Subtipo, 'Baloncesto');
  assert.equal(ot['Distancia (km)'], '');
  assert.equal(ot['Ritmo (min/km)'], '');
  assert.equal(ot.Notas, "'=peligro", 'fórmula neutralizada en Excel');
  assert.equal(ot.Carga, '420');

  // Formato estándar.
  const std = cardioCsv([bike], { excel: false });
  assert.ok(!std.startsWith(BOM));
  const [b2] = csvObjects(std, ',');
  assert.equal(b2['Distancia (km)'], '40.25');
  assert.equal(b2['Velocidad (km/h)'], '26.8');
  // Subtipo libre (texto propio) y aguas abiertas.
  const [x] = cardioRows([{ id: 'x', kind: 'other', date: '2026-09-01', subtype: 'Pádel', durationMin: 45 }]);
  assert.equal(x[2], 'Pádel');
  assert.equal(x[4], 45);
  assert.equal(x[5], '0:45:00', 'sin movingSec se usa durationMin');
  const [open] = csvObjects(cardioCsv([{ id: 'y', kind: 'swim', date: '2026-09-02', poolType: 'open', poolLengthM: 25, movingSec: 600, distanceKm: 0.5 }], { excel: false }), ',');
  assert.equal(open['Piscina / aguas abiertas'], 'Aguas abiertas');
  assert.equal(open['Largo piscina (m)'], '', 'el largo solo tiene sentido en piscina');
  assert.equal(open['Ritmo (min/100 m)'], '0:02:00', 'también en formato estándar');
});

test('CSV de fuerza: tiempos de sprint con centésimas en ambos formatos', () => {
  const s = strengthSession({ exercises: [se('se1', 'sprint', [set({ distanceM: 20, timeSec: 3.45 }), set({ distanceM: 20, timeSec: 3.12 }), set({ distanceM: 30, timeSec: 4.1 })])] });
  const xl = csvObjects(strengthCsv([s], exMap, defaultSettings(), { excel: true }), ';');
  assert.deepEqual(xl.map((r) => r['Tiempo (s)']), ['3,45', '3,12', '4,1']);
  assert.deepEqual(xl.map((r) => r['Distancia (m)']), ['20', '20', '30']);
  const std = csvObjects(strengthCsv([s], exMap, defaultSettings(), { excel: false }), ',');
  assert.deepEqual(std.map((r) => r['Tiempo (s)']), ['3.45', '3.12', '4.1']);
});

test('csvCounts: series hechas y actividades', () => {
  assert.deepEqual(csvCounts([strengthSession(), run, swim, null]), { sets: 9, activities: 2 });
  assert.deepEqual(csvCounts([]), { sets: 0, activities: 0 });
});

test('hms y formatBytes', () => {
  assert.equal(hms(0), '0:00:00');
  assert.equal(hms(3725), '1:02:05');
  assert.equal(hms(59.6), '0:01:00');
  assert.equal(hms(null), null);
  assert.equal(hms(-1), null);
  // Ritmos: siempre con horas para que la hoja de cálculo los lea como minutos y no como horas.
  assert.equal(hms(300), '0:05:00');
  assert.equal(hms(125.4), '0:02:05');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1,5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(formatBytes(250 * 1024 * 1024), '250 MB');
  assert.equal(formatBytes(null), '—');
});

test('localKeysToClear: borradores y estado de la app, nada ajeno', () => {
  const keys = ['draft:activity:run', 'draft:activity:swim', 'entreno.exercise.draft', 'entreno.exercises.seg', 'lastRoute', 'otra-app', 'Draft:x', null];
  assert.deepEqual(localKeysToClear(keys), ['draft:activity:run', 'draft:activity:swim', 'entreno.exercise.draft', 'entreno.exercises.seg']);
  assert.deepEqual(localKeysToClear([]), []);
  assert.deepEqual(localKeysToClear(undefined), []);
});

// ---------------------------------------------------------------------------
// settings-logic: umbrales y semana tipo
// ---------------------------------------------------------------------------
test('thresholdDefaults: solo umbrales (no semana tipo, lastBackupAt ni formato CSV)', () => {
  const d = thresholdDefaults();
  assert.deepEqual(Object.keys(d).sort(), [...THRESHOLD_KEYS].sort());
  for (const k of ['weekPatterns', 'lastBackupAt', 'csv', 'id']) assert.ok(!(k in d), `no debe incluir ${k}`);
  const def = defaultSettings();
  assert.deepEqual(d.muscleTargets, def.muscleTargets);
  assert.equal(d.secondaryFactor, 0.5);
  assert.deepEqual(d.increments, { upperCompound: 2.5, lowerCompound: 5, isolation: 1 });
  // Copia profunda: modificarla no toca la siguiente.
  d.muscleTargets.back[0] = 99;
  assert.equal(thresholdDefaults().muscleTargets.back[0], 14);
  // Aplicado sobre unos ajustes cambiados, deja intactos semana tipo y última copia.
  const s = { ...defaultSettings(), secondaryFactor: 0.75, lastBackupAt: 123, csv: { excel: false }, weekPatterns: [{ from: '2026-09-21', days: [] }] };
  Object.assign(s, thresholdDefaults());
  assert.equal(s.secondaryFactor, 0.5);
  assert.equal(s.lastBackupAt, 123);
  assert.deepEqual(s.csv, { excel: false });
  assert.equal(s.weekPatterns[0].from, '2026-09-21');
});

test('getPath / setPath con objetos y arrays', () => {
  const o = { a: { b: [1, 2] } };
  assert.equal(getPath(o, ['a', 'b', 1]), 2);
  assert.equal(getPath(o, ['x', 'y']), undefined);
  setPath(o, ['a', 'b', 0], 5);
  assert.deepEqual(o.a.b, [5, 2]);
  setPath(o, ['m', 'back', 1], 20);
  assert.ok(Array.isArray(o.m.back), 'crea un array si la clave siguiente es un índice');
  assert.equal(o.m.back.length, 2);
  assert.equal(o.m.back[1], 20);
  setPath(o, ['top'], 1);
  assert.equal(o.top, 1);
});

test('fixPair: mantiene mín ≤ máx moviendo el otro valor', () => {
  assert.deepEqual(fixPair(10, 20, 'lo'), { lo: 10, hi: 20 });
  assert.deepEqual(fixPair(25, 20, 'lo'), { lo: 25, hi: 25 });
  assert.deepEqual(fixPair(25, 20, 'hi'), { lo: 20, hi: 20 });
  assert.deepEqual(fixPair(null, 20, 'lo'), { lo: null, hi: 20 });
});

test('planLabel / shortPlanLabel / weekSummaryText de la semana tipo', () => {
  const tpls = SEED_TEMPLATES.map((t) => ({ ...t, archived: false }));
  const days = defaultSettings().weekPatterns[0].days;
  assert.equal(weekSummaryText(days, tpls), 'L D1 · M D2 · X D3 · J D4 · V — · S D6 · D —');
  assert.deepEqual(planLabel({ kind: 'rest' }, tpls), { kind: 'rest', text: 'Descanso', emoji: '😴', items: null, missing: false, archived: false });
  const d1 = planLabel({ kind: 'template', templateId: TEMPLATE_IDS.d1 }, tpls);
  assert.equal(d1.text, 'Día 1 — Upper pesado');
  assert.equal(d1.items, 7);
  const free = planLabel({ kind: 'free', label: 'Ruta en bici', activityKind: 'bike' }, tpls);
  assert.equal(free.kind, 'free');
  assert.equal(free.text, 'Ruta en bici');
  assert.equal(free.emoji, '🚴');
  assert.equal(shortPlanLabel({ kind: 'free', activityKind: 'bike' }, tpls), '🚴');
  const gone = planLabel({ kind: 'template', templateId: 'no_existe' }, tpls);
  assert.equal(gone.missing, true);
  assert.equal(shortPlanLabel({ kind: 'template', templateId: 'no_existe' }, tpls), '?');
  const arch = planLabel({ kind: 'template', templateId: 't' }, [{ id: 't', name: 'Push', archived: true, items: [] }]);
  assert.equal(arch.archived, true);
  assert.match(arch.text, /archivada/);
  // Nombres sin «Día N»: primera palabra (recortada si es larga).
  assert.equal(shortPlanLabel({ kind: 'template', templateId: 't' }, [{ id: 't', name: 'Push A', items: [] }]), 'Push');
  assert.equal(shortPlanLabel({ kind: 'template', templateId: 't' }, [{ id: 't', name: 'Hipertrofia torso', items: [] }]), 'Hipe.');
  assert.equal(shortPlanLabel({ kind: 'template', templateId: 't' }, new Map([['t', { id: 't', name: 'dia 12 pierna' }]])), 'D12');
  assert.equal(shortPlanLabel(undefined, tpls), '—');
});

test('patternFromDate: inicio de la vigencia aplicable', () => {
  const s = { weekPatterns: [{ from: '2026-09-21', days: [] }, { from: '2000-01-01', days: [] }, { from: '2026-10-05', days: [] }] };
  assert.equal(patternFromDate(s, '2026-09-23'), '2026-09-21');
  assert.equal(patternFromDate(s, '2026-09-20'), '2000-01-01');
  assert.equal(patternFromDate(s, '2026-10-05'), '2026-10-05');
  assert.equal(patternFromDate({ weekPatterns: [{ from: '2026-09-21', days: [] }] }, '2026-01-01'), '2026-09-21');
  assert.equal(patternFromDate({}, '2026-01-01'), null);
});
