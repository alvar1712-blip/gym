// Perfiles sintéticos del laboratorio. TODOS FICTICIOS: describen patrones de uso, no personas; la edad o el sexo no
// determinan por sí solos el comportamiento (cada perfil fija sus propios parámetros).
//
// Campos:
//   sports     sesiones por semana de cada deporte {strength, run, bike, swim, hike, other}
//   adherence  probabilidad (0–1) de cumplir cada sesión prevista
//   weeks      semanas de historial antes de «hoy»
//   gaps       parones [{endWeeksAgo, weeks}]: sin entrenar ese tramo
//   progress   fracción de semanas con subida de carga (fuerza); plateauAfter: semanas hasta estancarse
//   dirty      probabilidad de dato incompleto o erróneo por serie/actividad (0 = datos limpios)
//   setups     true: alterna configuraciones de material en máquinas (Hammer / polea alta…)
//   editsRoutines true: cambia a menudo de ejercicios (alternativas y nombres distintos)
//   race       {type, weeksAhead} evento próximo; goalChange: cambia de objetivo a mitad del historial
//   a11y       {textScale, reducedMotion, keyboard}; viewport/dpr del dispositivo; tz zona horaria
import { rng } from './rng.mjs';

const S = (o) => ({ strength: 0, run: 0, bike: 0, swim: 0, hike: 0, other: 0, ...o });
const PHONE = { w: 390, h: 844 }; // iPhone 13/14
const SMALL = { w: 320, h: 568 }; // iPhone SE 1.ª gen. / pantallas pequeñas
const BIG = { w: 430, h: 932 }; // Pro Max
const A11Y0 = { textScale: 1, reducedMotion: false, keyboard: false };

export const PROFILES = [
  { id: 'p01-adolescente-baloncesto', label: 'Adolescente 16 años: baloncesto y fuerza', age: 16, sex: 'male', experience: 'beginner', goal: 'performance', sports: S({ strength: 2, other: 3 }), adherence: 0.8, weeks: 40, gaps: [{ endWeeksAgo: 20, weeks: 3 }], progress: 0.5, plateauAfter: 99, dirty: 0.02, tech: 'expert', a11y: A11Y0, viewport: PHONE },
  { id: 'p02-gym-carrera-22', label: 'Hombre 22: gimnasio + carrera', age: 22, sex: 'male', experience: 'intermediate', goal: 'hybrid', sports: S({ strength: 3, run: 2 }), adherence: 0.85, weeks: 52, gaps: [], progress: 0.35, plateauAfter: 30, dirty: 0, tech: 'expert', a11y: A11Y0, viewport: PHONE },
  { id: 'p03-principiante-28', label: 'Mujer 28: empieza a entrenar', age: 28, sex: 'female', experience: 'beginner', goal: 'health', sports: S({ strength: 2 }), adherence: 0.7, weeks: 6, gaps: [], progress: 0.6, plateauAfter: 99, dirty: 0.03, tech: 'expert', a11y: A11Y0, viewport: PHONE },
  { id: 'p04-corredora-10k', label: 'Corredora 35: prepara un 10K', age: 35, sex: 'female', experience: 'intermediate', goal: 'endurance', sports: S({ run: 4, strength: 1 }), adherence: 0.9, weeks: 30, gaps: [], progress: 0.3, plateauAfter: 99, dirty: 0, tech: 'expert', a11y: A11Y0, viewport: PHONE, race: { type: '10k', weeksAhead: 6 } },
  { id: 'p05-ciclista-fit', label: 'Ciclista 45: importa archivos FIT', age: 45, sex: 'male', experience: 'advanced', goal: 'endurance', sports: S({ bike: 4, strength: 1 }), adherence: 0.85, weeks: 60, gaps: [{ endWeeksAgo: 30, weeks: 4 }], progress: 0.2, plateauAfter: 20, dirty: 0, tech: 'expert', a11y: A11Y0, viewport: BIG, fit: true },
  { id: 'p06-irregular-55', label: 'Persona 55: entrenamiento irregular', age: 55, sex: 'male', experience: 'intermediate', goal: 'health', sports: S({ strength: 3, hike: 1 }), adherence: 0.4, weeks: 40, gaps: [{ endWeeksAgo: 25, weeks: 6 }, { endWeeksAgo: 8, weeks: 2 }], progress: 0.2, plateauAfter: 12, dirty: 0.05, tech: 'low', a11y: A11Y0, viewport: PHONE },
  { id: 'p07-mayor-67-fuerza', label: 'Mujer 67: mantiene fuerza y movilidad', age: 67, sex: 'female', experience: 'beginner', goal: 'maintenance', sports: S({ strength: 2, other: 2 }), adherence: 0.8, weeks: 50, gaps: [{ endWeeksAgo: 15, weeks: 2 }], progress: 0.1, plateauAfter: 10, dirty: 0.04, tech: 'low', a11y: { textScale: 1.3, reducedMotion: true, keyboard: false }, viewport: PHONE },
  { id: 'p08-mayor-75-simple', label: 'Hombre 75: necesita experiencia sencilla', age: 75, sex: 'male', experience: 'beginner', goal: 'health', sports: S({ strength: 2, hike: 2 }), adherence: 0.7, weeks: 26, gaps: [], progress: 0.05, plateauAfter: 8, dirty: 0.08, tech: 'low', a11y: { textScale: 1.5, reducedMotion: true, keyboard: false }, viewport: SMALL },
  { id: 'p09-veterano-5-anios', label: 'Deportista con 5 años de historial', age: 38, sex: 'male', experience: 'advanced', goal: 'strength', sports: S({ strength: 4, run: 1, bike: 1 }), adherence: 0.88, weeks: 260, gaps: [{ endWeeksAgo: 200, weeks: 5 }, { endWeeksAgo: 120, weeks: 3 }, { endWeeksAgo: 40, weeks: 4 }], progress: 0.15, plateauAfter: 40, dirty: 0.01, setups: true, tech: 'expert', a11y: A11Y0, viewport: PHONE },
  { id: 'p10-abandona-retoma', label: 'Abandona y retoma tras meses', age: 31, sex: 'female', experience: 'intermediate', goal: 'health', sports: S({ strength: 3, run: 1 }), adherence: 0.75, weeks: 70, gaps: [{ endWeeksAgo: 30, weeks: 24 }], progress: 0.3, plateauAfter: 99, dirty: 0.02, tech: 'expert', a11y: A11Y0, viewport: PHONE },
  { id: 'p11-cambia-rutinas', label: 'Cambia de rutinas y ejercicios a menudo', age: 26, sex: 'male', experience: 'intermediate', goal: 'hypertrophy', sports: S({ strength: 4 }), adherence: 0.8, weeks: 36, gaps: [], progress: 0.3, plateauAfter: 99, dirty: 0.02, editsRoutines: true, setups: true, tech: 'expert', a11y: A11Y0, viewport: PHONE },
  { id: 'p12-datos-erroneos', label: 'Registra datos incompletos o erróneos', age: 34, sex: 'female', experience: 'beginner', goal: 'health', sports: S({ strength: 3, run: 1, swim: 1 }), adherence: 0.6, weeks: 30, gaps: [], progress: 0.3, plateauAfter: 99, dirty: 0.35, tech: 'low', a11y: A11Y0, viewport: PHONE },
  { id: 'p13-nadadora', label: 'Nadadora 29: natación y core', age: 29, sex: 'female', experience: 'intermediate', goal: 'endurance', sports: S({ swim: 3, strength: 1 }), adherence: 0.85, weeks: 40, gaps: [], progress: 0.2, plateauAfter: 99, dirty: 0.01, tech: 'expert', a11y: A11Y0, viewport: PHONE },
  { id: 'p14-senderista', label: 'Senderista 50: rutas y fuerza ligera', age: 50, sex: 'female', experience: 'intermediate', goal: 'health', sports: S({ hike: 2, strength: 1 }), adherence: 0.7, weeks: 44, gaps: [{ endWeeksAgo: 18, weeks: 5 }], progress: 0.2, plateauAfter: 99, dirty: 0.02, tech: 'low', a11y: { textScale: 1.15, reducedMotion: false, keyboard: false }, viewport: PHONE },
  { id: 'p15-hipertrofia-avanzado', label: 'Avanzado 30: hipertrofia, estancamiento', age: 30, sex: 'male', experience: 'advanced', goal: 'hypertrophy', sports: S({ strength: 5 }), adherence: 0.92, weeks: 104, gaps: [{ endWeeksAgo: 50, weeks: 2 }], progress: 0.1, plateauAfter: 16, dirty: 0, setups: true, tech: 'expert', a11y: A11Y0, viewport: BIG },
  { id: 'p16-maraton-cambio-objetivo', label: 'Maratón y cambio de objetivo a fuerza', age: 41, sex: 'male', experience: 'advanced', goal: 'endurance', sports: S({ run: 5, strength: 1 }), adherence: 0.9, weeks: 52, gaps: [], progress: 0.2, plateauAfter: 99, dirty: 0, goalChange: true, tech: 'expert', a11y: A11Y0, viewport: PHONE, race: { type: 'marathon', weeksAhead: 10 } },
  { id: 'p17-teclado-motriz', label: 'Navega con teclado externo (necesidad motriz)', age: 47, sex: 'female', experience: 'intermediate', goal: 'maintenance', sports: S({ strength: 2, other: 1 }), adherence: 0.7, weeks: 30, gaps: [], progress: 0.15, plateauAfter: 99, dirty: 0.03, tech: 'expert', a11y: { textScale: 1, reducedMotion: false, keyboard: true }, viewport: PHONE },
  { id: 'p18-baja-vision', label: 'Baja visión: texto muy grande', age: 62, sex: 'male', experience: 'beginner', goal: 'health', sports: S({ strength: 2, hike: 1 }), adherence: 0.65, weeks: 20, gaps: [], progress: 0.1, plateauAfter: 99, dirty: 0.05, tech: 'low', a11y: { textScale: 1.5, reducedMotion: true, keyboard: false }, viewport: SMALL },
  { id: 'p19-recuperacion-lesion', label: 'Vuelta tras lesión: recuperación irregular', age: 39, sex: 'male', experience: 'intermediate', goal: 'recovery', sports: S({ strength: 2, bike: 1 }), adherence: 0.5, weeks: 30, gaps: [{ endWeeksAgo: 14, weeks: 8 }], progress: 0.25, plateauAfter: 99, dirty: 0.04, tech: 'expert', a11y: A11Y0, viewport: PHONE },
  { id: 'p20-viajero-zona-horaria', label: 'Viajero: entrena en otra zona horaria', age: 33, sex: 'female', experience: 'intermediate', goal: 'hybrid', sports: S({ strength: 3, run: 2 }), adherence: 0.75, weeks: 52, gaps: [{ endWeeksAgo: 26, weeks: 2 }], progress: 0.25, plateauAfter: 99, dirty: 0.02, tech: 'expert', a11y: A11Y0, viewport: PHONE, tz: 'Pacific/Auckland' },
];

const pick = (r, a) => a[Math.floor(r() * a.length)];
const GOALS = ['health', 'strength', 'hypertrophy', 'endurance', 'hybrid', 'maintenance', 'recovery', 'performance'];
const EXPS = ['beginner', 'intermediate', 'advanced'];
const TZS = ['Europe/Madrid', 'America/Mexico_City', 'Pacific/Auckland', 'Asia/Kolkata'];

/**
 * Perfiles adicionales reproducibles: `n` perfiles a partir de `seed`. Combina parámetros independientes (no infiere
 * nada de la edad o el sexo). Ids: `g<seed>-<i>`. Uso: generateProfiles(7, 300).
 */
export function generateProfiles(seed, n) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const experience = pick(r, EXPS);
    const goal = pick(r, GOALS);
    const strength = Math.floor(r() * 5);
    const cardio = { run: Math.floor(r() * 4), bike: Math.floor(r() * 3), swim: Math.floor(r() * 3), hike: Math.floor(r() * 2), other: Math.floor(r() * 3) };
    const weeks = pick(r, [4, 12, 26, 52, 104, 208]);
    const gapN = Math.floor(r() * 3);
    return {
      id: `g${seed}-${i}`,
      label: `Generado ${seed}/${i}`,
      age: 14 + Math.floor(r() * 66),
      sex: pick(r, ['female', 'male']),
      experience, goal,
      sports: S({ strength, ...Object.fromEntries(Object.entries(cardio).filter(() => r() < 0.5)) }),
      adherence: Math.round((0.3 + r() * 0.65) * 100) / 100,
      weeks,
      gaps: Array.from({ length: gapN }, () => ({ endWeeksAgo: Math.floor(r() * Math.max(1, weeks - 4)), weeks: 1 + Math.floor(r() * 8) })),
      progress: Math.round(r() * 60) / 100,
      plateauAfter: pick(r, [8, 16, 40, 99]),
      dirty: pick(r, [0, 0, 0.03, 0.1, 0.3]),
      setups: r() < 0.3,
      editsRoutines: r() < 0.2,
      tech: pick(r, ['expert', 'low']),
      a11y: { textScale: pick(r, [1, 1, 1, 1.3, 1.5, 1.5]), reducedMotion: r() < 0.25, keyboard: r() < 0.1 },
      viewport: pick(r, [PHONE, SMALL, BIG]),
      tz: pick(r, TZS),
    };
  });
}
