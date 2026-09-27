// profile.js — perfil del usuario (ronda 5, docs/MEJORAS5.md). PURO: lee settings.profile con valores por
// defecto y ofrece ayudas para textos en masculino/femenino. Lo usan los análisis, el ciclo y las vistas.

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

const DEFAULTS = {
  sex: null, goal: null, experience: null, cycleTracking: true, contraception: null,
  cycleLengthGuess: 28, periodLengthGuess: 5, cycleInReport: false, promptDismissed: false,
};

/** Perfil con todos los campos (los que falten, por defecto). */
export function getProfile(settings) {
  return { ...DEFAULTS, ...(settings?.profile || {}) };
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
