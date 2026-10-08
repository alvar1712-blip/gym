// Valores imposibles o muy raros al apuntar (js/sanity.js, docs/PULIDO.md §14): imposible → no se guarda; muy raro
// → «¿Seguro?»; normal → se guarda. Los ejemplos son los del encargo; los límites no bloquean deportes reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, checkSet, checkBodyweight, checkActivity, split, RULES } from '../../js/sanity.js';

const levels = (issues) => issues.map((i) => `${i.field}:${i.level}`);

test('clases: dentro de lo normal → ok; raro → rare; fuera de lo posible (o no numérico) → impossible; vacío → ok', () => {
  assert.equal(classify(RULES.weight, 100), 'ok');
  assert.equal(classify(RULES.weight, 350), 'rare');
  assert.equal(classify(RULES.weight, -20), 'impossible');
  assert.equal(classify(RULES.weight, NaN), 'impossible');
  assert.equal(classify(RULES.weight, Infinity), 'impossible');
  assert.equal(classify(RULES.weight, null), 'ok');
});

test('fuerza: 900 kg de banca → «¿Seguro?»; 1000 repeticiones → imposible; lastre y asistencia; deportes reales sin aviso', () => {
  assert.deepEqual(levels(checkSet({ weight: 900, reps: 1 }, 'weight_reps')), ['weight:rare']);
  assert.match(checkSet({ weight: 900, reps: 1 }, 'weight_reps')[0].message, /^Has puesto 900 kg\.$/);
  assert.deepEqual(levels(checkSet({ weight: 1200, reps: 1 }, 'weight_reps')), ['weight:impossible']);
  assert.deepEqual(levels(checkSet({ weight: 60, reps: 1001 }, 'weight_reps')), ['reps:impossible']);
  assert.deepEqual(levels(checkSet({ weight: 60, reps: 150 }, 'weight_reps')), ['reps:rare']);
  assert.deepEqual(levels(checkSet({ weight: -20, reps: 8 }, 'bodyweight')), [], 'dominadas con 20 kg de asistencia');
  assert.deepEqual(levels(checkSet({ weight: -200, reps: 8 }, 'bodyweight')), ['weight:rare']);
  assert.deepEqual(levels(checkSet({ weight: 200, reps: 1 }, 'unilateral')), ['weight:rare'], 'por lado');
  // Reales: peso muerto de 300 kg, sentadilla de 250, 50 reps de flexiones, plancha de 5 min
  assert.deepEqual(levels(checkSet({ weight: 300, reps: 1 }, 'weight_reps')), []);
  assert.deepEqual(levels(checkSet({ weight: 0, reps: 50 }, 'bodyweight')), []);
  assert.deepEqual(levels(checkSet({ timeSec: 300 }, 'time')), []);
  assert.deepEqual(levels(checkSet({ heightCm: 140 }, 'jumps')), ['heightCm:rare'], 'un salto de 1,40 m');
});

test('peso corporal: 900 kg → imposible; 15 kg → imposible; 210 kg → raro; 75 kg → normal', () => {
  assert.deepEqual(levels(checkBodyweight(900)), ['kg:impossible']);
  assert.deepEqual(levels(checkBodyweight(15)), ['kg:impossible']);
  assert.deepEqual(levels(checkBodyweight(210)), ['kg:rare']);
  assert.deepEqual(checkBodyweight(75), []);
});

test('actividad: 10 km en 2 minutos → imposible (con el ritmo en el mensaje); FC 600 → imposible; media > máxima', () => {
  const r = checkActivity({ kind: 'run', distanceKm: 10, movingSec: 120 });
  assert.deepEqual(levels(r), ['pace:impossible']);
  assert.match(r[0].message, /10 km en 2:00 sería un ritmo de 0:12 \/km: revisa la distancia o el tiempo\./);
  assert.deepEqual(levels(checkActivity({ kind: 'run', distanceKm: 10, movingSec: 3000, hrAvg: 600 })), ['hrAvg:impossible']);
  assert.deepEqual(levels(checkActivity({ kind: 'run', distanceKm: 10, movingSec: 3000, hrAvg: 170, hrMax: 160 })), ['hrAvg:impossible']);
  // Raros pero posibles: 10 km en 27 min (casi récord del mundo), FC máx 220
  assert.deepEqual(levels(checkActivity({ kind: 'run', distanceKm: 10, movingSec: 27 * 60, hrMax: 220 })), ['pace:rare', 'hrMax:rare']);
  // Normales: 10 km en 50 min con FC 150/178; maratón en 3 h 30 min; caminar/correr lento 10 km a 12:00/km
  assert.deepEqual(checkActivity({ kind: 'run', distanceKm: 10, movingSec: 3000, hrAvg: 150, hrMax: 178 }), []);
  assert.deepEqual(checkActivity({ kind: 'run', distanceKm: 42.195, movingSec: 3.5 * 3600 }), []);
  assert.deepEqual(checkActivity({ kind: 'run', distanceKm: 10, movingSec: 7200 }), []);
});

test('bici, senderismo y natación: velocidades imposibles y raras; duración; desnivel', () => {
  assert.deepEqual(levels(checkActivity({ kind: 'bike', distanceKm: 100, movingSec: 1800 })), ['speed:impossible'], '200 km/h');
  assert.deepEqual(levels(checkActivity({ kind: 'bike', distanceKm: 60, movingSec: 3600 })), ['speed:rare']);
  assert.deepEqual(checkActivity({ kind: 'bike', distanceKm: 90, movingSec: 3 * 3600, elevationM: 1500 }), []);
  assert.deepEqual(levels(checkActivity({ kind: 'hike', distanceKm: 20, movingSec: 1800 })), ['speed:impossible']);
  assert.deepEqual(levels(checkActivity({ kind: 'swim', distanceKm: 1, movingSec: 300 })), ['pace:impossible'], '30 s cada 100 m');
  assert.deepEqual(checkActivity({ kind: 'swim', distanceKm: 1.5, movingSec: 30 * 60 }), []);
  assert.deepEqual(levels(checkActivity({ kind: 'run', distanceKm: 10, movingSec: -60 })), ['duration:impossible']);
  assert.deepEqual(levels(checkActivity({ kind: 'hike', distanceKm: 20, movingSec: 8 * 3600, elevationM: 20000 })), ['elevationM:impossible']);
  assert.deepEqual(levels(checkActivity({ kind: 'other', movingSec: 3600 })), []);
});

test('mensajes sin NaN ni signos raros; split separa lo que bloquea de lo que se pregunta', () => {
  const all = [
    ...checkSet({ weight: 900, reps: 1001 }, 'weight_reps'),
    ...checkActivity({ kind: 'run', distanceKm: 10, movingSec: 120, hrAvg: 600, hrMax: 225 }),
    ...checkBodyweight(210),
  ];
  for (const i of all) assert.ok(!/NaN|Infinity|undefined|null|--/.test(i.message), i.message);
  const s = split(all);
  assert.deepEqual(s.impossible.map((i) => i.field), ['reps', 'pace', 'hrAvg', 'hrAvg']);
  assert.deepEqual(s.rare.map((i) => i.field), ['weight', 'hrMax', 'kg']);
});
