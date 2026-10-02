// profile.js — perfil del usuario (ronda 5, docs/MEJORAS5.md; ampliado en la ronda 6, docs/MEJORAS6.md). PURO: lee
// settings.profile con valores por defecto y ofrece ayudas para textos en masculino/femenino y para la edad. Lo usan
// los análisis, el ciclo y las vistas. Todos los campos son opcionales: un perfil antiguo sigue valiendo tal cual.
import { isDateStr, todayStr } from './util.js';

export const SEXES = [{ id: 'male', label: 'Hombre' }, { id: 'female', label: 'Mujer' }];
export const GOALS = [
  { id: 'gain', label: 'Ganar músculo' },
  { id: 'lose', label: 'Perder grasa' },
  { id: 'maintain', label: 'Mantener' },
  { id: 'performance', label: 'Rendimiento' },
];
export const EXPERIENCES = [
  { id: 'beginner', label: 'Principiante', sub: 'menos de 1 año entrenando fuerza en serio' },
  { id: 'intermediate', label: 'Intermedio', sub: '1–3 años' },
  { id: 'advanced', label: 'Avanzado', sub: 'más de 3 años' },
];
export const CONTRACEPTION = [
  { id: 'none', label: 'Ninguno hormonal', hormonal: false },
  { id: 'copper_iud', label: 'DIU de cobre', hormonal: false },
  { id: 'combined_pill', label: 'Píldora combinada', hormonal: true },
  { id: 'progestin_pill', label: 'Minipíldora (solo gestágeno)', hormonal: true },
  { id: 'hormonal_iud', label: 'DIU hormonal', hormonal: true },
  { id: 'implant', label: 'Implante', hormonal: true },
  { id: 'ring_patch', label: 'Anillo o parche', hormonal: true },
  { id: 'injection', label: 'Inyección', hormonal: true },
  { id: 'other', label: 'Otro hormonal', hormonal: true },
];

/** Objetivos secundarios (además del principal `goal`, que manda en los rangos del análisis). */
export const SECONDARY_GOALS = [
  ...GOALS,
  { id: 'strength', label: 'Ganar fuerza' },
  { id: 'health', label: 'Salud y bienestar' },
];
/** Deportes que practica (para dar prioridad en el análisis y en el onboarding). */
export const SPORTS = [
  { id: 'strength', label: 'Fuerza' },
  { id: 'run', label: 'Carrera' },
  { id: 'bike', label: 'Bici' },
  { id: 'swim', label: 'Natación' },
  { id: 'hike', label: 'Senderismo' },
  { id: 'other', label: 'Otros deportes' },
];

/** Menor de edad por debajo de MINOR_AGE; mayor desde SENIOR_AGE. */
export const MINOR_AGE = 18;
export const SENIOR_AGE = 65;
/** Edad máxima admitida en la fecha de nacimiento (por encima es casi seguro un error al escribirla). */
export const MAX_AGE = 110;

const DEFAULTS = {
  sex: null, goal: null, experience: null, cycleTracking: true, contraception: null,
  cycleLengthGuess: 28, periodLengthGuess: 5, cycleInReport: false, promptDismissed: false,
  // ronda 6
  birthDate: null, secondaryGoals: [], sports: [], limitations: '', weeklyFrequency: null, onboardedAt: null,
};

/** Perfil con todos los campos (los que falten, por defecto; las listas, copias nuevas). */
export function getProfile(settings) {
  const p = { ...DEFAULTS, ...(settings?.profile || {}) };
  p.secondaryGoals = Array.isArray(p.secondaryGoals) ? [...p.secondaryGoals] : [];
  p.sports = Array.isArray(p.sports) ? [...p.sports] : [];
  if (typeof p.limitations !== 'string') p.limitations = '';
  return p;
}

/**
 * Edad cumplida el día `today` según la fecha de nacimiento ('YYYY-MM-DD'). null si falta, no es una fecha, es
 * posterior a hoy o da más de MAX_AGE años. Nacidos un 29 de febrero cumplen el 1 de marzo en años no bisiestos.
 */
export function ageOn(birthDate, today = todayStr()) {
  if (!isDateStr(birthDate) || !isDateStr(today) || birthDate > today) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const age = ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  return age <= MAX_AGE ? age : null;
}

/** ¿Es una fecha de nacimiento admisible? (ver ageOn) */
export function validBirthDate(birthDate, today = todayStr()) {
  return ageOn(birthDate, today) != null;
}

/** 'minor' (< 18) | 'adult' | 'senior' (≥ 65) | 'unknown' (sin fecha de nacimiento válida). */
export function ageGroup(p, today = todayStr()) {
  const age = ageOn(p?.birthDate, today);
  if (age == null) return 'unknown';
  if (age < MINOR_AGE) return 'minor';
  if (age >= SENIOR_AGE) return 'senior';
  return 'adult';
}

/** Perfil nuevo: sin ninguno de los datos básicos y sin haber pasado por el onboarding. */
export function isNewProfile(p) {
  return !p.sex && !p.goal && !p.experience && !p.onboardedAt;
}

/** Datos de la ronda 6 que faltan en un perfil (para la invitación discreta a completarlo). */
export function profileExtrasMissing(p) {
  const out = [];
  if (!p.birthDate) out.push('birthDate');
  if (!p.sports.length) out.push('sports');
  if (!p.weeklyFrequency) out.push('weeklyFrequency');
  return out;
}

export const isFemale = (p) => p?.sex === 'female';

/** Anticonceptivo hormonal (sin ciclo natural: no se estiman fases). */
export function isHormonal(p) {
  return !!CONTRACEPTION.find((c) => c.id === p?.contraception)?.hormonal;
}

/** Seguimiento del ciclo activo: modo mujer + seguimiento encendido. */
export const cycleEnabled = (p) => isFemale(p) && p.cycleTracking !== false;

/** Texto según el sexo del perfil: g(p, 'cansado', 'cansada'). Sin contestar → masculino genérico. */
export function g(p, male, female) {
  return isFemale(p) ? female : male;
}

/** ¿Faltan los datos básicos del perfil? (para la tarjeta «Completa tu perfil»). */
export function profileIncomplete(p) {
  return !p.sex || !p.goal || !p.experience;
}

export function label(list, id) {
  return list.find((x) => x.id === id)?.label ?? '—';
}
