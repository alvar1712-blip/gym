import test from 'node:test';
import assert from 'node:assert/strict';
import {
  targetText, defaultTarget, newItem, changeItemExercise, stepSetsMax, rangeChange, uniqueName, copyName,
  duplicateTemplate, insertAfter, moveTemplate, renumber, templatePreviewText, patternDaysFor, templateCalendarUse,
  blocks, normalizeGroups, groupWithNext, ungroupItem, setGroupType, setSection, moveItem, canMove, removeItem,
  undoRemove, duplicateItem, groupLabels, sectionsOf, searchExercises, parseAliases, validateExerciseName,
  assignMuscles, exerciseUsage, summarizeSets, setTexts, exerciseHistory,
} from '../../js/library-logic.js';
import { SEED_TEMPLATES, SEED_EXERCISES, defaultSettings, exampleWeekPatterns } from '../../js/seed.js';
import { formatSet } from '../../js/session-logic.js';

const seq = (p) => { let n = 0; return () => `${p}${++n}`; };
const it = (id, extra = {}) => ({ id, exerciseId: `ex_${id}`, alternatives: [], sets: 3, notes: '', section: '', groupId: null, groupType: null, ...extra });
const ids = (items) => items.map((x) => x.id).join(',');
const groups = (items) => items.map((x) => x.groupId || '-').join(',');

// ---------------------------------------------------------------------------
// Texto del objetivo
// ---------------------------------------------------------------------------
test('targetText según el tipo de registro', () => {
  assert.equal(targetText({ sets: 3, repMin: 4, repMax: 6 }, 'weight_reps'), '3×4–6');
  assert.equal(targetText({ sets: 3, repMin: 4, repMax: 6 }, { logType: 'weight_reps' }), '3×4–6', 'acepta el ejercicio');
  assert.equal(targetText({ sets: 2, setsMax: 3, distance: 30 }, 'distance_time'), '2–3×30 m');
  assert.equal(targetText({ sets: 4, distance: 20 }, 'distance_time'), '4×20 m');
  assert.equal(targetText({ sets: 3, timeMin: 30, timeMax: 45 }, 'time'), '3×30–45 s');
  assert.equal(targetText({ sets: 2, repMin: 8, repMax: 8 }, 'unilateral'), '2×8/lado');
  assert.equal(targetText({ sets: 1, timeMin: 1800, timeMax: 2700 }, 'cardio'), '30–45 min');
  assert.equal(targetText({ sets: 1, timeMin: 2700, timeMax: 4500 }, 'cardio'), '45–75 min');
  assert.equal(targetText({ sets: 1, timeMin: 1800, timeMax: 1800, distance: 5000 }, 'cardio'), '30 min · 5 km');
  assert.equal(targetText({ sets: 3 }, 'time'), '3 series');
  assert.equal(targetText({ sets: 1 }, 'time'), '1 serie');
  assert.equal(targetText({ sets: 3, setsMax: 4 }, 'distance_time'), '3–4 series');
  assert.equal(targetText({ sets: 3, repMin: 3, repMax: 3 }, 'jumps'), '3×3');
  assert.equal(targetText({ sets: 2, repMin: 8, repMax: 12 }, 'bodyweight'), '2×8–12');
  assert.equal(targetText({ sets: 3, setsMax: 3, repMin: 8 }, 'weight_reps'), '3×8', 'setsMax ≤ sets se ignora');
  assert.equal(targetText({ sets: 3, repMin: 8, repMax: 12 }, 'time'), '3 series', 'reps no aplican a tiempo');
  assert.equal(targetText({}, 'weight_reps'), '');
  assert.equal(targetText(null, null), '');
});

test('targetText de todas las plantillas precargadas', () => {
  const ex = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
  const d6 = SEED_TEMPLATES.find((t) => t.id === 'tpl_d6');
  const txt = d6.items.map((i) => targetText(i, ex.get(i.exerciseId)));
  assert.deepEqual(txt, ['2×20', '3×3', '4×20 m', '2–3×30 m', '3–4 series', '2×8/lado', '2×8–10', '2×12–15', '2×8–12', '2×10–15']);
  const d3 = SEED_TEMPLATES.find((t) => t.id === 'tpl_d3');
  assert.deepEqual(d3.items.map((i) => targetText(i, ex.get(i.exerciseId))), ['30–45 min', '45–75 min', '3 series']);
});

test('objetivo por defecto, ítem nuevo y cambio de ejercicio', () => {
  assert.deepEqual(defaultTarget('weight_reps'), { sets: 3, repMin: 8, repMax: 12 });
  assert.deepEqual(defaultTarget('cardio'), { sets: 1, timeMin: 1800, timeMax: 2700 });
  assert.deepEqual(defaultTarget('distance_time'), { sets: 4, distance: 20 });
  const n = newItem('plancha', 'time', { id: 'x', section: 'Core' });
  assert.deepEqual(n, { id: 'x', exerciseId: 'plancha', alternatives: [], sets: 3, timeMin: 30, timeMax: 45, notes: '', section: 'Core', groupId: null, groupType: null });

  const base = { ...it('a'), sets: 4, setsMax: 5, repMin: 6, repMax: 8, alternatives: ['hack_squat', 'prensa'] };
  // misma familia (reps): se conserva el objetivo y el nuevo sale de las alternativas
  const same = changeItemExercise(base, 'hack_squat', 'weight_reps', 'unilateral');
  assert.deepEqual([same.exerciseId, same.sets, same.setsMax, same.repMin, same.repMax], ['hack_squat', 4, 5, 6, 8]);
  assert.deepEqual(same.alternatives, ['prensa']);
  // otra familia: objetivo por defecto del tipo nuevo, conservando series
  const toTime = changeItemExercise(base, 'plancha', 'weight_reps', 'time');
  assert.deepEqual([toTime.sets, toTime.setsMax, toTime.repMin, toTime.timeMin, toTime.timeMax], [4, 5, undefined, 30, 45]);
  const toCardio = changeItemExercise(base, 'correr', 'weight_reps', 'cardio');
  assert.deepEqual([toCardio.sets, toCardio.setsMax, toCardio.timeMin], [1, undefined, 1800]);
  assert.equal(base.exerciseId, 'ex_a', 'no muta el original');
});

test('stepSetsMax y rangeChange', () => {
  assert.equal(stepSetsMax(3, null, 2), 4, '+ desde vacío → series + 1');
  assert.equal(stepSetsMax(3, 4, 5), 5);
  assert.equal(stepSetsMax(3, 4, 3), null, '− hasta series → sin rango');
  assert.equal(stepSetsMax(3, null, 2, { typed: true }), null, 'escrito ≤ series → vacío');
  assert.equal(stepSetsMax(3, null, null), null);
  assert.deepEqual(rangeChange(8, 12, 'min', 10), [10, 12]);
  assert.deepEqual(rangeChange(8, 12, 'min', 14), [14, 14], 'mín por encima del máx arrastra el máx');
  assert.deepEqual(rangeChange(8, 12, 'max', 6), [6, 6]);
  assert.deepEqual(rangeChange(8, null, 'max', 2, { fromEmpty: true }), [8, 8], 'máx desde vacío se ajusta al mín');
  assert.deepEqual(rangeChange(null, 5, 'min', 9, { fromEmpty: true }), [5, 5]);
  assert.deepEqual(rangeChange(8, 12, 'max', null), [8, null]);
});

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------
test('duplicateTemplate: copia profunda con ids nuevos y grupos conservados', () => {
  const tpl = {
    id: 'tpl_x', name: 'Día X', order: 2, notes: 'n', archived: false, createdAt: 1, updatedAt: 2,
    items: [
      it('i1', { groupId: 'g1', groupType: 'circuit', alternatives: ['alt'] }),
      it('i2', { groupId: 'g1', groupType: 'circuit' }),
      it('i3'),
      it('i4', { groupId: 'g2', groupType: 'superset' }),
      it('i5', { groupId: 'g2', groupType: 'superset' }),
    ],
  };
  const copy = duplicateTemplate(tpl, { name: 'Día X (copia)', order: 3, newId: () => 'tpl_y', newItemId: seq('n'), newGroupId: seq('G') });
  assert.equal(copy.id, 'tpl_y');
  assert.equal(copy.name, 'Día X (copia)');
  assert.equal(copy.order, 3);
  assert.equal(copy.createdAt, undefined, 'la store pondrá fechas nuevas');
  assert.deepEqual(copy.items.map((x) => x.id), ['n1', 'n2', 'n3', 'n4', 'n5']);
  assert.deepEqual(copy.items.map((x) => x.groupId), ['G1', 'G1', null, 'G2', 'G2']);
  assert.deepEqual(copy.items.map((x) => x.groupType), ['circuit', 'circuit', null, 'superset', 'superset']);
  assert.deepEqual(copy.items.map((x) => x.exerciseId), tpl.items.map((x) => x.exerciseId));
  // independiente del original
  copy.items[0].alternatives.push('otra');
  copy.items[0].sets = 9;
  assert.deepEqual(tpl.items[0].alternatives, ['alt']);
  assert.equal(tpl.items[0].sets, 3);
  assert.equal(tpl.id, 'tpl_x');
  // ids por defecto: todos distintos de los originales
  const d1 = SEED_TEMPLATES[0];
  const c2 = duplicateTemplate(d1);
  assert.notEqual(c2.id, d1.id);
  assert.equal(c2.name, `${d1.name} (copia)`);
  const orig = new Set(d1.items.map((x) => x.id));
  assert.ok(c2.items.every((x) => !orig.has(x.id)));
  assert.equal(new Set(c2.items.map((x) => x.id)).size, c2.items.length);
});

test('nombres de copia y nombres únicos', () => {
  assert.equal(copyName('Día 1', ['Día 1']), 'Día 1 (copia)');
  assert.equal(copyName('Día 1', ['Día 1', 'día 1 (copia)']), 'Día 1 (copia 2)');
  assert.equal(uniqueName('Nueva rutina', []), 'Nueva rutina');
  assert.equal(uniqueName('Nueva rutina', ['Nueva rutina', 'Nueva rutina 2']), 'Nueva rutina 3');
});

test('orden de plantillas: subir, bajar, insertar copia y renumerar', () => {
  const list = [{ id: 'a', order: 0, name: 'A' }, { id: 'b', order: 1, name: 'B' }, { id: 'c', order: 2, name: 'C' }];
  assert.equal(moveTemplate(list, 'a', -1), null);
  assert.equal(moveTemplate(list, 'c', 1), null);
  const m = moveTemplate(list, 'c', -1);
  assert.deepEqual(m.map((t) => t.id), ['a', 'c', 'b']);
  assert.deepEqual(renumber(m), [{ id: 'c', order: 1 }, { id: 'b', order: 2 }]);
  const copy = { id: 'a2', order: null, name: 'A (copia)' };
  const ins = insertAfter(list, copy, 'a');
  assert.deepEqual(ins.map((t) => t.id), ['a', 'a2', 'b', 'c']);
  assert.deepEqual(renumber(ins), [{ id: 'a2', order: 1 }, { id: 'b', order: 2 }, { id: 'c', order: 3 }]);
});

test('resumen y uso en el calendario', () => {
  const names = { a: 'Press banca', b: 'Dominadas', c: 'Remo', d: 'Curl' };
  const tpl = { items: ['a', 'b', 'c', 'd'].map((e) => ({ exerciseId: e })) };
  assert.equal(templatePreviewText(tpl, (id) => names[id], 3), 'Press banca · Dominadas · Remo …');
  assert.equal(templatePreviewText({ items: [] }, () => null), 'Sin ejercicios todavía');

  const settings = { ...defaultSettings(), weekPatterns: exampleWeekPatterns() };
  assert.equal(patternDaysFor(settings.weekPatterns, '2026-09-23')[0].templateId, 'tpl_d1');
  settings.weekPatterns.push({ from: '2026-10-05', days: [{ kind: 'rest' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'template', templateId: 'tpl_d1' }] });
  const use = templateCalendarUse('tpl_d1', {
    settings,
    plan: [{ id: '2026-09-30', kind: 'template', templateId: 'tpl_d1' }, { id: '2026-09-01', kind: 'template', templateId: 'tpl_d1' }, { id: '2026-10-01', status: 'done' }],
    today: '2026-09-23',
  });
  assert.deepEqual(use.weekDays, [0, 6], 'lunes (vigente) y domingo (vigencia futura)');
  assert.deepEqual(use.overrides, ['2026-09-30'], 'solo excepciones de hoy en adelante');
  assert.deepEqual(templateCalendarUse('tpl_zz', { settings, plan: [], today: '2026-09-23' }), { weekDays: [], overrides: [] });
});

// ---------------------------------------------------------------------------
// Reglas de grupos (superserie / circuito)
// ---------------------------------------------------------------------------
test('blocks y normalizeGroups', () => {
  const items = [it('a', { groupId: 'g' }), it('b', { groupId: 'g' }), it('c'), it('d', { groupId: 'g' }), it('e', { groupId: 'h', groupType: 'circuit' })];
  assert.deepEqual(blocks(items).map((b) => [b.start, b.end, b.groupId]), [[0, 2, 'g'], [2, 3, null], [3, 4, null], [4, 5, null]]);
  const n = normalizeGroups(items, seq('N'));
  assert.equal(groups(n), 'g,g,-,-,-', 'un ítem solo pierde el grupo');
  assert.deepEqual(n.map((x) => x.groupType), ['superset', 'superset', null, null, null], 'tipo por defecto superserie');
  // mismo id en dos tramos separados → el segundo recibe id nuevo
  const split = normalizeGroups([it('a', { groupId: 'g' }), it('b', { groupId: 'g' }), it('c'), it('d', { groupId: 'g' }), it('e', { groupId: 'g' })], seq('N'));
  assert.equal(groups(split), 'g,g,-,N1,N1');
  // el grupo comparte tipo y sección (la del primero)
  const mixed = normalizeGroups([it('a', { groupId: 'g', groupType: 'circuit', section: 'Potencia' }), it('b', { groupId: 'g', groupType: 'superset', section: 'Fuerza' })]);
  assert.deepEqual(mixed.map((x) => [x.groupType, x.section]), [['circuit', 'Potencia'], ['circuit', 'Potencia']]);
});

test('groupWithNext: crear, ampliar y unir grupos', () => {
  const base = [it('a'), it('b'), it('c'), it('d')];
  const g1 = groupWithNext(base, 0, 'superset', seq('G'));
  assert.equal(groups(g1), 'G1,G1,-,-');
  assert.deepEqual(g1.slice(0, 2).map((x) => x.groupType), ['superset', 'superset']);
  assert.equal(base[0].groupId, null, 'no muta la entrada');
  // ampliar: el último del grupo con el siguiente (manda el tipo del grupo)
  const g2 = groupWithNext(g1, 1, 'circuit', seq('X'));
  assert.equal(groups(g2), 'G1,G1,G1,-');
  assert.ok(g2.slice(0, 3).every((x) => x.groupType === 'superset'));
  // ítem suelto con el primero de un grupo → se une a ese grupo
  const g3 = groupWithNext([it('z'), ...g1], 0, 'circuit');
  assert.equal(groups(g3), 'G1,G1,G1,-,-');
  // dos grupos contiguos se unen
  const two = [it('a', { groupId: 'g', groupType: 'circuit' }), it('b', { groupId: 'g', groupType: 'circuit' }), it('c', { groupId: 'h' }), it('d', { groupId: 'h' })];
  const merged = groupWithNext(two, 1, 'superset');
  assert.equal(groups(merged), 'g,g,g,g');
  assert.ok(merged.every((x) => x.groupType === 'circuit'));
  // último ítem o ya agrupados: sin cambios
  assert.equal(groupWithNext(base, 3), base);
  assert.equal(groupWithNext(g1, 0), g1);
  // el siguiente adopta la sección del primero
  const sec = groupWithNext([it('a', { section: 'Potencia' }), it('b', { section: 'Fuerza' })], 0, 'superset', seq('S'));
  assert.deepEqual(sec.map((x) => x.section), ['Potencia', 'Potencia']);
});

test('superserie ↔ circuito, sacar del grupo y etiquetas A1, A2…', () => {
  let items = groupWithNext([it('a'), it('b'), it('c'), it('d'), it('e')], 0, 'superset', seq('G'));
  items = groupWithNext(items, 1, 'superset');
  items = groupWithNext(items, 3, 'circuit', seq('H'));
  assert.equal(groups(items), 'G1,G1,G1,H1,H1');
  assert.deepEqual(groupLabels(items), { a: 'A1', b: 'A2', c: 'A3', d: 'B1', e: 'B2' });
  const circ = setGroupType(items, 'G1', 'circuit');
  assert.deepEqual(circ.map((x) => x.groupType), ['circuit', 'circuit', 'circuit', 'circuit', 'circuit']);
  assert.equal(setGroupType(items, 'G1', 'otro'), items, 'tipo no válido');
  // sacar el del medio: se coloca detrás del grupo, que sigue entero
  const out = ungroupItem(items, 1);
  assert.equal(ids(out), 'a,c,b,d,e');
  assert.equal(groups(out), 'G1,G1,-,H1,H1');
  assert.deepEqual(groupLabels(out), { a: 'A1', c: 'A2', d: 'B1', e: 'B2' });
  // sacar uno de un grupo de 2 → el grupo desaparece
  const out2 = ungroupItem(out, 4);
  assert.equal(ids(out2), 'a,c,b,d,e');
  assert.equal(groups(out2), 'G1,G1,-,-,-');
  assert.equal(ungroupItem(out2, 2), out2, 'suelto: sin cambios');
});

test('moveItem: dentro del grupo, grupo entero, saltar grupos y cruzar secciones', () => {
  const items = [
    it('p1', { section: 'Potencia' }), it('p2', { section: 'Potencia' }),
    it('f1', { section: 'Fuerza', groupId: 'g', groupType: 'superset' }), it('f2', { section: 'Fuerza', groupId: 'g', groupType: 'superset' }),
    it('f3', { section: 'Fuerza' }),
  ];
  // dentro del grupo se intercambian
  assert.equal(ids(moveItem(items, 3, -1)), 'p1,p2,f2,f1,f3');
  // suelto que sube salta el grupo completo (no lo parte)
  const up = moveItem(items, 4, -1);
  assert.equal(ids(up), 'p1,p2,f3,f1,f2');
  assert.equal(groups(up), '-,-,-,g,g');
  // borde superior del grupo: el vecino es de otra sección → el grupo cruza el encabezado (misma posición)
  const cross = moveItem(items, 2, -1);
  assert.equal(ids(cross), ids(items));
  assert.deepEqual(cross.map((x) => x.section), ['Potencia', 'Potencia', 'Potencia', 'Potencia', 'Fuerza']);
  // y con otro toque sube el grupo entero
  assert.equal(ids(moveItem(cross, 2, -1)), 'p1,f1,f2,p2,f3');
  // p2 baja: cruza a «Fuerza»
  assert.deepEqual(moveItem(items, 1, 1).map((x) => x.section), ['Potencia', 'Fuerza', 'Fuerza', 'Fuerza', 'Fuerza']);
  // extremos
  assert.equal(moveItem(items, 0, -1), items);
  assert.equal(moveItem(items, 4, 1), items);
  assert.equal(canMove(items, 0, -1), false);
  assert.equal(canMove(items, 0, 1), true);
  // sin secciones: intercambio simple
  assert.equal(ids(moveItem([it('a'), it('b'), it('c')], 0, 1)), 'b,a,c');
});

test('quitar, deshacer y duplicar ítems', () => {
  const before = [it('a'), it('b', { groupId: 'g', groupType: 'circuit' }), it('c', { groupId: 'g', groupType: 'circuit' }), it('d')];
  const rm = removeItem(before, 1);
  assert.equal(ids(rm), 'a,c,d');
  assert.equal(groups(rm), '-,-,-', 'el grupo de 2 se deshace');
  // deshacer recompone el grupo y conserva otros cambios hechos después
  const edited = rm.map((x) => (x.id === 'd' ? { ...x, notes: 'cambio posterior' } : x));
  const back = undoRemove(edited, before, 'b');
  assert.equal(ids(back), 'a,b,c,d');
  assert.equal(groups(back), '-,g,g,-');
  assert.deepEqual(back.slice(1, 3).map((x) => x.groupType), ['circuit', 'circuit']);
  assert.equal(back[3].notes, 'cambio posterior');
  assert.equal(undoRemove(back, before, 'b'), back, 'ya está: sin cambios');
  // quitar el primero y deshacer
  assert.equal(ids(undoRemove(removeItem(before, 0), before, 'a')), 'a,b,c,d');
  // grupo de 3: quitar el del medio mantiene el grupo
  const three = [it('a', { groupId: 'g' }), it('b', { groupId: 'g' }), it('c', { groupId: 'g' })];
  assert.equal(groups(removeItem(three, 1)), 'g,g');
  // duplicar: debajo, mismo grupo, id nuevo, copia independiente
  const dup = duplicateItem(before, 1, () => 'b2');
  assert.equal(ids(dup), 'a,b,b2,c,d');
  assert.equal(groups(dup), '-,g,g,g,-');
  dup[2].alternatives.push('x');
  assert.deepEqual(before[1].alternatives, []);
  assert.equal(duplicateItem(before, 9), before);
});

test('secciones: setSection aplica a todo el grupo; sectionsOf', () => {
  const items = [it('a', { section: 'Potencia' }), it('b', { groupId: 'g' }), it('c', { groupId: 'g' })];
  const s = setSection(items, 2, '  Bloque fuerza ');
  assert.deepEqual(s.map((x) => x.section), ['Potencia', 'Bloque fuerza', 'Bloque fuerza']);
  assert.deepEqual(sectionsOf(s), ['Potencia', 'Bloque fuerza']);
  assert.deepEqual(sectionsOf(SEED_TEMPLATES.find((t) => t.id === 'tpl_d2').items), ['Bloque potencia', 'Bloque fuerza']);
});

// ---------------------------------------------------------------------------
// Biblioteca
// ---------------------------------------------------------------------------
test('searchExercises: sin tildes, por nombre y alias, filtros y archivados', () => {
  const lib = SEED_EXERCISES.map((e) => ({ ...e, archived: false }));
  const remo = searchExercises(lib, { q: 'remo' });
  assert.ok(remo.length >= 7);
  assert.ok(remo.slice(0, 7).every((e) => e.name.startsWith('Remo')), 'primero los que empiezan por «remo»');
  const bul = searchExercises(lib, { q: 'bulgara' });
  assert.equal(bul[0].id, 'bulgara');
  assert.equal(searchExercises(lib, { q: 'BÚLGARA' })[0].id, 'bulgara');
  assert.equal(searchExercises(lib, { q: 'rdl' })[0].id, 'peso_muerto_rumano', 'por alias');
  assert.deepEqual(searchExercises(lib, { q: 'jalon' }).slice(0, 2).map((e) => e.id), ['jalon_estrecho', 'jalon_pecho'], '«jalón» sin tilde');
  assert.deepEqual(searchExercises(lib, { q: 'remo barra' }).map((e) => e.id), ['remo_barra'], 'todas las palabras');
  // filtros
  const back = searchExercises(lib, { muscle: 'biceps' });
  assert.ok(back.every((e) => e.primary.includes('biceps') || e.secondary.includes('biceps')));
  assert.ok(back.some((e) => e.id === 'dominadas'), 'también como secundario');
  const pullV = searchExercises(lib, { pattern: 'pull_v' });
  assert.ok(pullV.length > 0 && pullV.every((e) => e.pattern === 'pull_v'));
  assert.deepEqual(searchExercises(lib, { q: 'remo', pattern: 'pull_v' }), []);
  // orden alfabético sin tildes
  const all = searchExercises(lib);
  assert.equal(all.length, lib.length);
  assert.equal(all[0].name, 'Abductores en máquina');
  // archivados ocultos salvo que se pidan
  lib.find((e) => e.id === 'remo_t').archived = true;
  assert.ok(!searchExercises(lib, { q: 'remo' }).some((e) => e.id === 'remo_t'));
  assert.ok(searchExercises(lib, { q: 'remo', archived: true }).some((e) => e.id === 'remo_t'));
});

test('alias, validación de nombre y asignación de músculos', () => {
  assert.deepEqual(parseAliases(' remo hammer,  remo neutro , , Remo Hammer;otro'), ['remo hammer', 'remo neutro', 'otro']);
  assert.deepEqual(parseAliases(''), []);
  const list = [{ id: 'a', name: 'Press banca' }, { id: 'b', name: 'Remo' }];
  assert.equal(validateExerciseName('  ', list), 'Pon un nombre.');
  assert.equal(validateExerciseName('press BANCA', list), 'Ya existe un ejercicio con ese nombre.');
  assert.equal(validateExerciseName('Press banca', list, 'a'), null, 'el propio nombre vale');
  assert.equal(validateExerciseName('Préss banca', list), 'Ya existe un ejercicio con ese nombre.', 'sin tildes');
  assert.equal(validateExerciseName('Press banca inclinado', list), null);
  // un músculo no puede estar en ambos grupos
  let m = assignMuscles(['back'], ['biceps', 'reardelt'], 'primary', ['back', 'biceps']);
  assert.deepEqual(m, { primary: ['back', 'biceps'], secondary: ['reardelt'] });
  m = assignMuscles(m.primary, m.secondary, 'secondary', ['reardelt', 'back']);
  assert.deepEqual(m, { primary: ['biceps'], secondary: ['reardelt', 'back'] });
});

// ---------------------------------------------------------------------------
// Uso e historial
// ---------------------------------------------------------------------------
const set = (type, weight, reps, rir = null, extra = {}) => ({ id: `s${Math.random()}`, type, weight, reps, repsR: null, rir, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: 1, ...extra });

test('exerciseUsage: sesiones, plantillas (también como alternativa) y objetivos', () => {
  const sessions = [
    { id: 's1', kind: 'strength', exercises: [{ id: 'se1', exerciseId: 'press_banca', sets: [] }] },
    { id: 's2', kind: 'strength', exercises: [{ id: 'se2', exerciseId: 'prensa', alternatives: ['hack_squat'], sets: [] }] },
    { id: 'r1', kind: 'run' },
  ];
  assert.equal(exerciseUsage('press_banca', { sessions }).sessions.length, 1);
  assert.equal(exerciseUsage('hack_squat', { sessions }).used, true, 'alternativa en una sesión');
  const u = exerciseUsage('nordic', { templates: SEED_TEMPLATES });
  assert.deepEqual(u.templates.map((t) => t.id).sort(), ['tpl_d2', 'tpl_d6']);
  assert.equal(exerciseUsage('mi_ej', { goals: [{ id: 'g', exerciseId: 'mi_ej' }] }).used, true);
  assert.equal(exerciseUsage('mi_ej', { sessions, templates: SEED_TEMPLATES, goals: [] }).used, false);
  // Una marca histórica también lo usa: borrarlo la dejaría huérfana («Ejercicio borrado») — se archiva
  const m = exerciseUsage('mi_ej', { pastRecords: [{ id: 'pr1', exerciseId: 'mi_ej' }, { id: 'pr2', exerciseId: 'otro' }] });
  assert.equal(m.used, true);
  assert.deepEqual(m.marks.map((r) => r.id), ['pr1']);
});

test('exerciseHistory y resumen de series', () => {
  const bench = { id: 'press_banca', logType: 'weight_reps' };
  const sessions = [
    { id: 'old', kind: 'strength', date: '2026-09-01', status: 'done', templateName: 'Día 1', startedAt: 1, exercises: [
      { id: 'a', exerciseId: 'press_banca', sets: [set('warmup', 40, 8), set('effective', 80, 6, 2), set('effective', 80, 5, 1), set('effective', 77.5, 6, 1, { done: false })] },
    ] },
    { id: 'new', kind: 'strength', date: '2026-09-15', status: 'done', templateName: 'Día 1', startedAt: 2, exercises: [
      { id: 'b', exerciseId: 'press_banca', sets: [set('effective', 85, 5, 1)] },
    ] },
    { id: 'none', kind: 'strength', date: '2026-09-20', status: 'done', exercises: [{ id: 'c', exerciseId: 'press_banca', sets: [set('warmup', 40, 8)] }] },
    { id: 'run', kind: 'run', date: '2026-09-10' },
  ];
  const hist = exerciseHistory(sessions, bench, { fmtSet: formatSet });
  assert.deepEqual(hist.map((r) => r.sessionId), ['new', 'old'], 'más reciente primero; sin series de trabajo no sale');
  assert.equal(hist[1].summary, '80×6 @2 · 80×5 @1', 'sin calentamientos ni pendientes; con RIR, como «Última vez»');
  assert.equal(exerciseHistory(sessions, bench)[1].summary, '2 series', 'sin formateador: nº de series');
  assert.equal(hist[1].workSets, 2);
  assert.equal(Math.round(hist[1].bestE1rm * 10) / 10, 101.3, 'Epley con reps + RIR: 80 × (1 + 8/30)');
  assert.equal(Math.round(hist[0].bestE1rm * 10) / 10, 102, '85 × (1 + 6/30)');

  // peso corporal: el 1RM usa peso corporal + lastre
  const pull = { id: 'dominadas', logType: 'bodyweight' };
  const hs = exerciseHistory([{ id: 'p', kind: 'strength', date: '2026-09-02', exercises: [{ id: 'x', exerciseId: 'dominadas', sets: [set('effective', 10, 8, 0), set('effective', null, 10, 0)] }] }], pull, { bwFn: () => 75, fmtSet: formatSet });
  assert.equal(hs[0].summary, '+10 kg × 8 @0 · 10 reps @0');
  assert.equal(Math.round(hs[0].bestE1rm), Math.round(85 * (1 + 8 / 30)));

  // cardio: filas por actividades enlazadas
  const run = { id: 'correr', logType: 'cardio' };
  const cs = [
    { id: 'd3', kind: 'strength', date: '2026-09-03', exercises: [{ id: 'se_run', exerciseId: 'correr', sets: [] }] },
    { id: 'act', kind: 'run', date: '2026-09-03', parentId: 'd3', parentItemId: 'se_run', distanceKm: 6.2, durationMin: 35 },
  ];
  const hc = exerciseHistory(cs, run);
  assert.equal(hc.length, 1);
  assert.equal(hc[0].summary, '6,2 km · 35 min');

  // La ficha usa el formateador de la sesión: cada serie se lee igual que en «Última vez».
  const cases = [
    ['bodyweight', set('effective', -15, 8, 1)],
    ['unilateral', set('effective', 20, 10, null, { repsR: 9 })],
    ['distance_time', set('effective', null, null, null, { distanceM: 20, timeSec: 3.4 })],
    ['time', set('effective', null, null, null, { timeSec: 45 })],
    ['time', set('effective', 10, null, null, { timeSec: 90 })],
    ['jumps', set('effective', null, 3, null, { heightCm: 45 })],
  ];
  for (const [lt, s] of cases) assert.equal(summarizeSets([s], lt, formatSet), formatSet(s, lt), lt);
  // asistencia: etiquetada, no se confunde con un peso negativo
  assert.equal(summarizeSets([set('effective', -15, 8, 1)], 'bodyweight', formatSet), '−15 kg asist. × 8 @1');
  const hsa = exerciseHistory([{ id: 'p', kind: 'strength', date: '2026-09-02', exercises: [{ id: 'x', exerciseId: 'dominadas', sets: [set('effective', -15, 8, 1)] }] }], pull, { bwFn: () => 75, fmtSet: formatSet });
  assert.equal(hsa[0].summary, '−15 kg asist. × 8 @1');
  assert.deepEqual(hsa[0].setTexts, ['−15 kg asist. × 8 @1'], 'por piezas, para no partir una serie entre líneas');
  // «1:30 min · +10 kg» es UNA pieza (el separador interno no se confunde con el de series)
  assert.deepEqual(setTexts([set('effective', 10, null, null, { timeSec: 90 }), set('effective', null, null, null, { timeSec: 45 })], 'time', formatSet),
    [formatSet({ timeSec: 90, weight: 10 }, 'time'), '45 s']);
  assert.deepEqual(setTexts(Array.from({ length: 3 }, () => set('effective', 50, 10)), 'weight_reps', formatSet, 2), ['50×10', '50×10', '+1']);
  assert.equal(summarizeSets(Array.from({ length: 8 }, () => set('effective', 50, 10)), 'weight_reps', formatSet, 6), '50×10 · 50×10 · 50×10 · 50×10 · 50×10 · 50×10 · +2');
});
