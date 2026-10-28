// Mensajes de felicitación y récords que se destacan al terminar una sesión (js/celebrate-logic.js).
// Ejecutar: node --test tests/unit/celebrate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, MAIN_LIFTS, pickMessage, mainRecord } from '../../js/celebrate-logic.js';
import { sessionPRs, makeBodyweightFn } from '../../js/calc.js';
import { SEED_EXERCISES } from '../../js/seed.js';

const exMap = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const exOf = (id) => exMap.get(id);
const bwFn = makeBodyweightFn([], 75);
const set = (id, weight, reps) => ({ id, weight, reps, done: true, type: 'work', rir: 2 });
const strength = (id, date, exercises) => ({ id, kind: 'strength', status: 'done', date, startedAt: Date.parse(`${date}T10:00:00Z`), exercises });
const lift = (exerciseId, sets, setup = '') => ({ exerciseId, setup, sets });

/** Historial: ayer 80 kg en banca y 10 kg en laterales; hoy 90 kg en banca y 12 kg en laterales. */
function build(todayExercises, history) {
  const hist = strength('h1', '2026-09-01', history);
  const today = strength('t1', '2026-09-08', todayExercises);
  return { today, prs: sessionPRs(today, [hist, today], exMap, bwFn) };
}

test('mensajes: cortos, con exclamación, sin raya larga ni frases largas, y nunca el mismo dos veces seguidas', () => {
  assert.ok(MESSAGES.length >= 3);
  for (const m of MESSAGES) {
    assert.match(m, /^¡.+!$/);
    assert.ok(m.length <= 16, `${m}: ha de caber en una línea`);
    assert.ok(!m.includes('—'));
  }
  for (const last of MESSAGES) {
    for (const r of [0, 0.3, 0.6, 0.99]) assert.notEqual(pickMessage(() => r, last), last);
  }
  assert.ok(MESSAGES.includes(pickMessage(() => 0.5, null)));
  assert.equal(pickMessage(() => 0.999999, null), MESSAGES.at(-1), 'el límite superior no se sale de la lista');
});

test('la lista inicial es corta y exclusiva: banca, sentadilla, peso muerto, dominadas y su variante supina', () => {
  assert.deepEqual(MAIN_LIFTS, ['press_banca', 'sentadilla', 'peso_muerto', 'dominadas', 'dominadas_supinas']);
  for (const id of MAIN_LIFTS) assert.ok(exMap.has(id), `${id} existe en la biblioteca`);
  // Accesorios y, por ahora, press militar y remo con barra: nunca destacan
  for (const id of ['press_militar', 'remo_barra', 'elevaciones_laterales', 'face_pull', 'curl_barra', 'curl_mancuerna', 'crunch_polea', 'press_banca_mancuerna', 'peso_muerto_rumano']) {
    assert.ok(!MAIN_LIFTS.includes(id), `${id} no se destaca`);
  }
});

test('récord en press militar o remo con barra (fuera de la lista por ahora): no se destaca; el de banca sí', () => {
  let r = build([lift('press_militar', [set('s1', 60, 5)]), lift('remo_barra', [set('r1', 80, 8)])],
    [lift('press_militar', [set('p1', 50, 5)]), lift('remo_barra', [set('q1', 70, 8)])]);
  assert.ok(r.prs.size > 0, 'sí son récords para el sistema de récords');
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  r = build([lift('press_militar', [set('s1', 60, 5)]), lift('press_banca', [set('b1', 90, 5)])],
    [lift('press_militar', [set('p1', 50, 5)]), lift('press_banca', [set('b0', 80, 5)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf).exerciseId, 'press_banca');
});

test('variantes: las dominadas supinas cuentan con su propio historial; banca con mancuernas no entra y no se mezcla con la de barra', () => {
  let r = build([lift('dominadas_supinas', [set('s1', 0, 10)])], [lift('dominadas_supinas', [set('p1', 0, 8)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf).exerciseId, 'dominadas_supinas');
  // Primera vez con la variante (aunque se hayan hecho dominadas pronas): no es récord, no son comparables
  r = build([lift('dominadas_supinas', [set('s1', 0, 12)])], [lift('dominadas', [set('p1', 0, 8)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  r = build([lift('press_banca_mancuerna', [set('s1', 40, 8)])], [lift('press_banca_mancuerna', [set('p1', 30, 8)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
});

test('récord en un ejercicio principal: mensaje con el nombre del ejercicio', () => {
  const { today, prs } = build([lift('press_banca', [set('s1', 90, 5)])], [lift('press_banca', [set('p1', 80, 5)])]);
  const rec = mainRecord(today, prs, exOf);
  assert.equal(rec.exerciseId, 'press_banca');
  assert.equal(rec.text, '¡Nuevo récord en press banca!');
  assert.ok(['e1rm', 'weight'].includes(rec.kind));
});

test('récord en un accesorio: NO se destaca, aunque sea un récord real', () => {
  const { today, prs } = build([lift('elevaciones_laterales', [set('s1', 12, 12)])], [lift('elevaciones_laterales', [set('p1', 10, 12)])]);
  assert.ok(prs.size > 0, 'sí es un récord para el sistema de récords (sigue en el resumen y en Progreso)');
  assert.equal(mainRecord(today, prs, exOf), null);
});

test('con récords en un accesorio y en un principal gana el principal; con varios principales, el de más prioridad', () => {
  const { today, prs } = build(
    [lift('elevaciones_laterales', [set('a1', 12, 12)]), lift('sentadilla', [set('s1', 120, 5)]), lift('press_banca', [set('b1', 90, 5)])],
    [lift('elevaciones_laterales', [set('a0', 10, 12)]), lift('sentadilla', [set('s0', 100, 5)]), lift('press_banca', [set('b0', 80, 5)])]);
  assert.equal(mainRecord(today, prs, exOf).exerciseId, 'press_banca', 'press_banca va antes que sentadilla en MAIN_LIFTS');
  assert.equal(mainRecord(today, prs, exOf, ['sentadilla', 'press_banca']).exerciseId, 'sentadilla', 'la selección es configurable');
});

test('sin récord real no hay mensaje especial: primera sesión con el ejercicio, misma marca o menos, configuración nueva', () => {
  // Primera vez con el ejercicio: nada con lo que comparar
  let r = build([lift('press_banca', [set('s1', 90, 5)])], [lift('sentadilla', [set('p1', 100, 5)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  // Igualar o bajar no es récord
  r = build([lift('press_banca', [set('s1', 80, 5)])], [lift('press_banca', [set('p1', 80, 5)])]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  // Otra configuración de material: la primera sesión con ella es solo una referencia
  r = build([lift('press_banca', [set('s1', 100, 5)], 'smith')], [lift('press_banca', [set('p1', 80, 5)], 'barra')]);
  assert.equal(mainRecord(r.today, r.prs, exOf), null);
  // Sin datos
  assert.equal(mainRecord({ exercises: [] }, new Map(), exOf), null);
  assert.equal(mainRecord({ exercises: [] }, null, exOf), null);
});

test('dominadas (peso corporal): más repeticiones sin lastre cuentan como récord principal', () => {
  const { today, prs } = build([lift('dominadas', [set('s1', 0, 10)])], [lift('dominadas', [set('p1', 0, 8)])]);
  const rec = mainRecord(today, prs, exOf);
  assert.equal(rec?.exerciseId, 'dominadas');
  assert.equal(rec.text, '¡Nuevo récord en dominadas!');
});

// ---------------------------------------------------------------------------
// Siluetas animadas: datos trazados + interpolación y path
// ---------------------------------------------------------------------------
import { frameAt, rowsPath, colsPath, pillFrame, withPill, smooth, axisOf, tubePath, revealBand, roundTop } from '../../js/celebrate-logic.js';
import { MASS, TOP, BOT, TOP_AXIS } from '../../js/celebrate-data.js';

test('datos de las siluetas: tiempos crecientes, mismas dimensiones y valores dentro de pantalla (con margen)', () => {
  for (const [name, d, n] of [['MASS', MASS, 96], ['TOP', TOP, 72], ['BOT', BOT, 64]]) {
    assert.ok(d.t.length >= 10, name);
    for (let i = 1; i < d.t.length; i++) assert.ok(d.t[i] > d.t[i - 1], `${name}: tiempos crecientes`);
    assert.equal(d.a.length, d.t.length);
    assert.equal(d.b.length, d.t.length);
    for (let i = 0; i < d.t.length; i++) {
      assert.equal(d.a[i].length, n, `${name}[${i}] filas`);
      assert.equal(d.b[i].length, n);
      for (let k = 0; k < n; k++) {
        assert.ok(d.a[i][k] >= -30 && d.b[i][k] <= 1030, `${name}[${i}][${k}] dentro de la pantalla`);
        assert.ok(d.b[i][k] >= d.a[i][k] - 1, `${name}[${i}][${k}] b ≥ a`);
      }
    }
  }
  // La masa acaba cubriendo toda la pantalla; las cintas acaban quietas (dos últimos fotogramas casi iguales o ya estables)
  assert.ok(MASS.a.at(-1).every((v) => v <= 0) && MASS.b.at(-1).every((v) => v >= 1000), 'la masa llena la pantalla');
  assert.ok(MASS.t[0] > 0 && MASS.t.at(-1) < 800, 'cubre en menos de 0,8 s');
  assert.ok(TOP.t[0] >= 900 && BOT.t[0] >= 1700 && BOT.t.at(-1) <= 2300, 'cintas entran en su momento');
});

test('frameAt: interpola entre fotogramas y se mantiene antes del primero y después del último', () => {
  const d = { t: [0, 100], a: [[0, 10], [100, 30]], b: [[1000, 1000], [900, 800]] };
  assert.deepEqual(frameAt(d, -5).a, [0, 10]);
  assert.deepEqual(frameAt(d, 50).a, [50, 20]);
  assert.deepEqual(frameAt(d, 50).b, [950, 900]);
  assert.deepEqual(frameAt(d, 500).b, [900, 800]);
});

test('rowsPath / colsPath: polígono cerrado con 2 vértices por fila (más los bordes)', () => {
  const p = rowsPath([0, 0, 0], [1000, 1000, 1000], 100, 200, { edges: true });
  assert.match(p, /^M.*Z$/);
  assert.equal((p.match(/[ML]/g) || []).length, 2 * (3 + 2), 'filas + 2 de borde, por lado');
  assert.ok(p.startsWith('M0 0L'), 'prolongado hasta el borde superior');
  const c = colsPath([500, 500], [1000, 1000], 100, 200);
  assert.match(c, /^M25 100L75 100L75 200L25 200Z$/);
});

test('pillFrame: la silueta del botón en filas (esquinas redondeadas) y nada fuera de él', () => {
  const W = 390, H = 844, n = 96;
  const rect = { left: 16, right: 374, top: 770, bottom: 822 };
  const f = pillFrame(rect, 14, W, H, n);
  const rows = f.a.map((a, k) => k).filter((k) => f.b[k] - f.a[k] > 1);
  assert.ok(rows.length >= 4 && rows.length <= 7, `unas 6 filas (${rows.length})`);
  const mid = rows[Math.floor(rows.length / 2)];
  assert.ok(Math.abs(f.a[mid] - (16 / W) * 1000) < 1 && Math.abs(f.b[mid] - (374 / W) * 1000) < 1, 'ancho del botón en el centro');
  assert.ok(f.a[rows[0]] > f.a[mid], 'la fila de arriba está recortada por la esquina redondeada');
  // Un botón más bajo que una fila sigue dando forma
  const tiny = pillFrame({ left: 10, right: 20, top: 100, bottom: 102 }, 1, W, H, n);
  assert.ok(tiny.b.some((b, k) => b - tiny.a[k] > 1));
  const w = withPill(MASS, f);
  assert.equal(w.t[0], 0);
  assert.equal(w.t.length, MASS.t.length + 1);
});

// Cintas: forma fija que solo se descubre con una cabeza redondeada (sin puntas ni saltos)
const nums = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);

test('smooth: conserva una recta y alisa un pico sin salirse del rango', () => {
  assert.deepEqual(smooth([5, 5, 5, 5, 5]), [5, 5, 5, 5, 5]);
  const s = smooth([0, 0, 100, 0, 0]);
  assert.ok(s[2] < 100 && s[2] > 0 && s.every((v) => v >= 0 && v <= 100));
});

test('tubePath: crece con la longitud, termina en un semicírculo y con s ≥ longitud es la cinta entera', () => {
  const W = 390, H = 844;
  const ax = axisOf(TOP_AXIS.p.map(([x, y]) => [x * W, y * H]));
  const L = ax.len.at(-1);
  assert.ok(L > 600 && L < 1200, `longitud del eje (${L})`);
  const hw = W * TOP_AXIS.r;
  assert.equal(tubePath(ax, hw, 0), '');
  let prev = 0;
  for (const s of [0.1, 0.3, 0.6, 0.9, 1, 1.5]) {
    const d = tubePath(ax, hw, s * L);
    assert.match(d, /^M.*A[\d.]+ [\d.]+ 0 0 1 .*Z$/, 'cabeza con arco, polígono cerrado');
    assert.ok(nums(d).every(Number.isFinite));
    assert.ok(d.length >= prev, 'cada vez más larga');
    prev = d.length;
  }
  assert.equal(tubePath(ax, hw, L), tubePath(ax, hw, 5 * L), 'pasada la longitud es la forma completa');
  // El radio del arco es el de la cinta (cabeza redondeada, no una punta)
  assert.ok(tubePath(ax, hw, 0.5 * L).includes(`A${Math.round(hw)} ${Math.round(hw)} 0 0 1`));
});

test('revealBand: la cinta inferior avanza sin retroceder, con cabeza elíptica, y llena la pantalla al final', () => {
  const W = 390, H = 844;
  const a = smooth(BOT.a.at(-1));
  const b = smooth(BOT.b.at(-1));
  assert.equal(revealBand(a, b, W, H, 0), '');
  assert.match(revealBand(a, b, W, H, 120), /^M.*A[\d.]+ [\d.]+ 0 0 1 .*Z$/);
  let prev = -Infinity;
  for (const xh of [20, 100, 200, 300, 390, W + H * 0.06]) {
    const d = revealBand(a, b, W, H, xh);
    assert.ok(nums(d).every(Number.isFinite), `xh=${xh}`);
    const maxX = Math.max(...(d.match(/(?<=[ML])-?[\d.]+(?= )/g) || ['0']).map(Number));
    assert.ok(maxX >= prev, 'el borde del trazo nunca retrocede');
    prev = maxX;
  }
  assert.ok(prev >= W, 'a pantalla completa el trazo llega al borde derecho');
});

test('roundTop: quita la aguja de la cima del dedo y la cierra redonda; no toca el botón ni la masa ancha', () => {
  const W = 390, H = 844, n = 96;
  // dedo: 3 filas de aguja (4 px) sobre un cuerpo de 60 px
  const a = new Array(n).fill(700), b = new Array(n).fill(700);
  for (let k = 60; k < 63; k++) { a[k] = 700; b[k] = 710; }
  for (let k = 63; k < n; k++) { a[k] = 700; b[k] = 700 + (60 / W) * 1000; }
  const r = roundTop(a, b, W, H);
  for (let k = 60; k < 63; k++) assert.ok(r.b[k] - r.a[k] < 1, `fila ${k}: la aguja desaparece`);
  const w = (k) => ((r.b[k] - r.a[k]) / 1000) * W;
  assert.ok(w(63) < w(66) && w(66) <= 60.5, 'la cima crece hasta el ancho del cuerpo (redonda, no plana)');
  assert.ok(w(90) > 59.5, 'el cuerpo no se toca');
  // el botón (ancho, 52 px de alto) y una masa a pantalla completa pasan intactos
  const pill = pillFrame({ left: 16, right: 374, top: 770, bottom: 822 }, 14, W, H, n);
  assert.deepEqual(roundTop(pill.a, pill.b, W, H), pill);
  assert.deepEqual(roundTop(MASS.a.at(-1), MASS.b.at(-1), W, H).a, MASS.a.at(-1));
});