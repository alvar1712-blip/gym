// sanity.js — valores imposibles o muy raros al apuntar (docs/PULIDO.md §14). Tres clases:
//   impossible → no se guarda (se dice qué revisar);
//   rare       → se puede guardar, pero se pregunta «¿Seguro?» (900 kg de banca, FC 225, 10 km en 25 min…);
//   ok         → se guarda sin más.
// Los límites son amplios a propósito: no deben bloquear deportes reales (récords mundiales incluidos) ni a nadie
// que entrene de verdad. Un dato que falta no es un error (lo dicen las validaciones de cada formulario). PURO.
// Pruebas: tests/unit/sanity.test.mjs.
import { fmtNum, fmtDuration } from './util.js';

/** [mín, máx] de lo posible y de lo normal. Fuera de «posible» → impossible; fuera de «normal» → rare. */
export const RULES = {
  weight: { possible: [0, 1000], normal: [0, 300] }, // kg en la barra / máquina
  weightSide: { possible: [0, 500], normal: [0, 150] }, // unilateral: por lado
  lastre: { possible: [-300, 400], normal: [-100, 120] }, // peso corporal: + lastre / − asistencia
  reps: { possible: [0, 1000], normal: [0, 100] },
  setSec: { possible: [0, 86400], normal: [0, 1800] },
  sprintM: { possible: [0, 100000], normal: [0, 2000] },
  heightCm: { possible: [0, 300], normal: [0, 130] },
  bodyweight: { possible: [20, 400], normal: [35, 200] },
  hr: { possible: [25, 250], normal: [35, 215] },
  elevationM: { possible: [0, 15000], normal: [0, 4500] },
  movingSec: { possible: [1, 7 * 86400], normal: [1, 12 * 3600] },
  cadence: { possible: [0, 300], normal: [0, 230] },
  powerW: { possible: [0, 3000], normal: [0, 600] },
  packKg: { possible: [0, 100], normal: [0, 40] },
};
/** Distancia por deporte (km): [posible, normal]. */
export const DISTANCE = {
  run: { possible: [0, 500], normal: [0, 110] },
  bike: { possible: [0, 1500], normal: [0, 400] },
  swim: { possible: [0, 60], normal: [0, 15] },
  hike: { possible: [0, 300], normal: [0, 80] },
};
/**
 * Ritmo o velocidad media por deporte (con al menos 400 m): carrera y senderismo en s/km, natación en s/100 m,
 * bici en km/h. Más rápido que «posible» no puede ser (el récord de 1 km ronda los 2:12/km).
 */
export const SPEED = {
  run: { paceFastest: 120, paceRare: 170, paceSlowRare: 1500 }, // 2:00 imposible · 2:50 raro · 25:00/km raro
  hike: { kmhImpossible: 25, kmhRare: 9 },
  bike: { kmhImpossible: 120, kmhRare: 55 },
  swim: { per100Fastest: 40, per100Rare: 60 }, // s/100 m
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const out = (v, [lo, hi]) => v < lo || v > hi;

/** 'ok' | 'rare' | 'impossible' de un valor con una regla (sin valor → 'ok'). */
export function classify(rule, v) {
  if (v == null || v === '') return 'ok';
  if (!isNum(v)) return 'impossible';
  if (out(v, rule.possible)) return 'impossible';
  if (out(v, rule.normal)) return 'rare';
  return 'ok';
}

const n1 = (v) => fmtNum(v, 1);
const issue = (field, level, message) => ({ field, level, message });

/**
 * Una serie de fuerza (peso, reps, tiempo, metros, altura) según el tipo de registro del ejercicio.
 * @returns {{ field, level: 'rare'|'impossible', message }[]}
 */
export function checkSet(set, logType) {
  const res = [];
  if (!set) return res;
  const add = (field, rule, v, text) => {
    const level = classify(rule, v);
    if (level !== 'ok') res.push(issue(field, level, text(level)));
  };
  if (logType === 'weight_reps' || logType === 'unilateral') {
    const rule = logType === 'unilateral' ? RULES.weightSide : RULES.weight;
    const side = logType === 'unilateral' ? ' por lado' : '';
    add('weight', rule, set.weight, (l) => (l === 'impossible' ? `Un peso de ${n1(set.weight)} kg${side} no es posible: revísalo.` : `Has puesto ${n1(set.weight)} kg${side}.`));
  }
  if (logType === 'bodyweight') {
    add('weight', RULES.lastre, set.weight, (l) => (l === 'impossible' ? `${n1(Math.abs(set.weight))} kg de ${set.weight < 0 ? 'asistencia' : 'lastre'} no es posible: revísalo.`
      : `Has puesto ${n1(Math.abs(set.weight))} kg de ${set.weight < 0 ? 'asistencia' : 'lastre'}.`));
  }
  for (const k of ['reps', 'repsR']) {
    add(k, RULES.reps, set[k], (l) => (l === 'impossible' ? `${fmtNum(set[k], 0)} repeticiones no es posible: revísalo.` : `Has puesto ${fmtNum(set[k], 0)} repeticiones en una serie.`));
  }
  if (logType === 'time' || logType === 'distance_time') {
    add('timeSec', RULES.setSec, set.timeSec, (l) => (l === 'impossible' ? 'Ese tiempo no es posible: revísalo.' : `Has puesto ${fmtDuration(set.timeSec)} en una serie.`));
  }
  if (logType === 'distance_time') add('distanceM', RULES.sprintM, set.distanceM, (l) => (l === 'impossible' ? 'Esa distancia no es posible: revísala.' : `Has puesto ${fmtNum(set.distanceM, 0)} m en una serie.`));
  if (set.heightCm != null) add('heightCm', RULES.heightCm, set.heightCm, (l) => (l === 'impossible' ? 'Esa altura no es posible: revísala.' : `Has puesto un salto de ${n1(set.heightCm)} cm.`));
  return res;
}

/** Peso corporal (kg). */
export function checkBodyweight(kg) {
  const level = classify(RULES.bodyweight, kg);
  if (level === 'ok') return [];
  return [issue('kg', level, level === 'impossible' ? `${n1(kg)} kg no es un peso corporal posible: revísalo.` : `Has puesto ${n1(kg)} kg de peso corporal.`)];
}

/** «4:12 /km» para los mensajes (el formato de la app sin depender de calc). */
const paceTxt = (sec) => (sec >= 3600 ? 'más de una hora por km' : `${fmtDuration(sec)} /km`); // nunca «1:05:00 /km»

/**
 * Una actividad (formulario de activity-logic): distancia, duración, ritmo o velocidad, FC, desnivel, potencia…
 * @param {object} f { kind, distanceKm, movingSec, elevationM, hrAvg, hrMax, cadence, powerAvg, powerNp, packKg }
 * @returns {{ field, level, message }[]}
 */
export function checkActivity(f) {
  const res = [];
  if (!f) return res;
  const add = (field, level, message) => { if (level !== 'ok') res.push(issue(field, level, message)); };
  const km = f.distanceKm;
  const sec = f.movingSec;
  const d = DISTANCE[f.kind];
  if (d && isNum(km)) {
    const l = classify(d, km);
    add('distanceKm', l, l === 'impossible' ? `${n1(km)} km no es posible en una sesión: revisa la distancia.` : `Has puesto ${n1(km)} km.`);
  }
  if (sec != null) {
    const l = classify(RULES.movingSec, sec);
    add('duration', l, l === 'impossible' ? 'Esa duración no es posible: revísala.' : `Has puesto ${fmtDuration(sec)} de actividad.`);
  }
  // Ritmo o velocidad (con al menos 400 m y algo de tiempo): lo que delata un tiempo o una distancia mal escritos
  if (isNum(km) && km >= 0.4 && isNum(sec) && sec > 0) {
    const sp = SPEED[f.kind];
    if (f.kind === 'run' && sp) {
      const pace = sec / km;
      if (pace < sp.paceFastest) add('pace', 'impossible', `${n1(km)} km en ${fmtDuration(sec)} sería un ritmo de ${paceTxt(pace)}: revisa la distancia o el tiempo.`);
      else if (pace < sp.paceRare) add('pace', 'rare', `${n1(km)} km en ${fmtDuration(sec)} es un ritmo de ${paceTxt(pace)}.`);
      else if (pace > sp.paceSlowRare) add('pace', 'rare', `${n1(km)} km en ${fmtDuration(sec)} es un ritmo de ${paceTxt(pace)}.`);
    } else if ((f.kind === 'bike' || f.kind === 'hike') && sp) {
      const kmh = km / (sec / 3600);
      if (kmh > sp.kmhImpossible) add('speed', 'impossible', `${n1(km)} km en ${fmtDuration(sec)} serían ${fmtNum(kmh, 0)} km/h de media: revisa la distancia o el tiempo.`);
      else if (kmh > sp.kmhRare) add('speed', 'rare', `${n1(km)} km en ${fmtDuration(sec)} son ${fmtNum(kmh, 0)} km/h de media.`);
    } else if (f.kind === 'swim' && sp) {
      const per100 = sec / (km * 10);
      if (per100 < sp.per100Fastest) add('pace', 'impossible', `${fmtNum(km * 1000, 0)} m en ${fmtDuration(sec)} sería ${fmtDuration(per100)} cada 100 m: revisa la distancia o el tiempo.`);
      else if (per100 < sp.per100Rare) add('pace', 'rare', `${fmtNum(km * 1000, 0)} m en ${fmtDuration(sec)} es ${fmtDuration(per100)} cada 100 m.`);
    }
  }
  for (const k of ['hrAvg', 'hrMax']) {
    const l = classify(RULES.hr, f[k]);
    add(k, l, l === 'impossible' ? `Una frecuencia cardiaca de ${fmtNum(f[k], 0)} lpm no es posible: revísala.` : `Has puesto una frecuencia cardiaca de ${fmtNum(f[k], 0)} lpm.`);
  }
  if (isNum(f.hrAvg) && isNum(f.hrMax) && f.hrAvg > f.hrMax) add('hrAvg', 'impossible', 'La FC media no puede ser mayor que la máxima: revísalas.');
  for (const [k, rule, unit] of [['elevationM', RULES.elevationM, 'm de desnivel'], ['cadence', RULES.cadence, 'de cadencia'], ['powerAvg', RULES.powerW, 'W de potencia'], ['powerNp', RULES.powerW, 'W de potencia'], ['packKg', RULES.packKg, 'kg de mochila']]) {
    const l = classify(rule, f[k]);
    add(k, l, l === 'impossible' ? `${fmtNum(f[k], 0)} ${unit} no es posible: revísalo.` : `Has puesto ${fmtNum(f[k], 0)} ${unit}.`);
  }
  return res;
}

/** Resumen para decidir: { impossible: issues[], rare: issues[] }. */
export function split(issues) {
  return { impossible: issues.filter((i) => i.level === 'impossible'), rare: issues.filter((i) => i.level === 'rare') };
}
