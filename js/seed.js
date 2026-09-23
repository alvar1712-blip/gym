// seed.js — datos iniciales: músculos, patrones, tipos de registro, ajustes por defecto,
// biblioteca de ejercicios y plantillas de la rutina del usuario.
// Las constantes MUSCLES / PATTERNS / LOG_TYPES / ACTIVITY_KINDS son CONTRATO: no renombrar ids.

export const SEED_VERSION = 1;

/** Músculos (id → etiqueta). El orden es el de presentación. */
export const MUSCLES = [
  { id: 'back', label: 'Espalda' },
  { id: 'core', label: 'Core / abdomen' },
  { id: 'chest', label: 'Pecho' },
  { id: 'sidedelt', label: 'Hombro lateral' },
  { id: 'reardelt', label: 'Hombro posterior' },
  { id: 'frontdelt', label: 'Hombro anterior' },
  { id: 'biceps', label: 'Bíceps' },
  { id: 'triceps', label: 'Tríceps' },
  { id: 'forearms', label: 'Antebrazo' },
  { id: 'quads', label: 'Cuádriceps' },
  { id: 'hamstrings', label: 'Isquiotibiales' },
  { id: 'glutes', label: 'Glúteos' },
  { id: 'adductors', label: 'Aductores' },
  { id: 'calves', label: 'Gemelos' },
  { id: 'tibialis', label: 'Tibial anterior' },
  { id: 'lowerback', label: 'Lumbar' },
];
export const MUSCLE_LABEL = Object.fromEntries(MUSCLES.map((m) => [m.id, m.label]));

/** Patrones de movimiento. push/pull alimentan el equilibrio empuje/tirón. */
export const PATTERNS = [
  { id: 'push_h', label: 'Empuje horizontal', group: 'push' },
  { id: 'push_v', label: 'Empuje vertical', group: 'push' },
  { id: 'pull_h', label: 'Tirón horizontal', group: 'pull' },
  { id: 'pull_v', label: 'Tirón vertical', group: 'pull' },
  { id: 'squat', label: 'Sentadilla (rodilla)', group: 'legs' },
  { id: 'hinge', label: 'Bisagra de cadera', group: 'legs' },
  { id: 'lunge', label: 'Unilateral de pierna', group: 'legs' },
  { id: 'isolation', label: 'Aislamiento', group: 'other' },
  { id: 'core', label: 'Core', group: 'core' },
  { id: 'power', label: 'Potencia / pliometría', group: 'athletic' },
  { id: 'sprint', label: 'Velocidad / agilidad', group: 'athletic' },
  { id: 'carry', label: 'Transporte / agarre', group: 'other' },
  { id: 'cardio', label: 'Cardio', group: 'cardio' },
];
export const PATTERN_LABEL = Object.fromEntries(PATTERNS.map((p) => [p.id, p.label]));

/** Tipos de registro de una serie. */
export const LOG_TYPES = [
  { id: 'weight_reps', label: 'Peso × repeticiones' },
  { id: 'bodyweight', label: 'Peso corporal (lastre / asistencia)' },
  { id: 'unilateral', label: 'Unilateral (por lado)' },
  { id: 'time', label: 'Por tiempo' },
  { id: 'distance_time', label: 'Distancia y tiempo' },
  { id: 'jumps', label: 'Saltos (reps, altura opcional)' },
  { id: 'cardio', label: 'Cardio (se registra como actividad)' },
];
export const LOG_TYPE_LABEL = Object.fromEntries(LOG_TYPES.map((t) => [t.id, t.label]));

/** Tipos de sesión / actividad. */
export const ACTIVITY_KINDS = [
  { id: 'strength', label: 'Fuerza', emoji: '🏋️' },
  { id: 'run', label: 'Carrera', emoji: '🏃' },
  { id: 'bike', label: 'Bici', emoji: '🚴' },
  { id: 'swim', label: 'Natación', emoji: '🏊' },
  { id: 'other', label: 'Otra actividad', emoji: '⚡' },
];
export const ACTIVITY_LABEL = Object.fromEntries(ACTIVITY_KINDS.map((a) => [a.id, a.label]));
export const ACTIVITY_EMOJI = Object.fromEntries(ACTIVITY_KINDS.map((a) => [a.id, a.emoji]));

export const SET_TYPES = [
  { id: 'warmup', label: 'Calentamiento', short: 'C' },
  { id: 'effective', label: 'Efectiva', short: 'E' },
  { id: 'failure', label: 'Al fallo', short: 'F' },
  { id: 'drop', label: 'Drop set', short: 'D' },
];
export const SET_TYPE_LABEL = Object.fromEntries(SET_TYPES.map((t) => [t.id, t.label]));

export const RUN_TYPES = [
  { id: 'z2', label: 'Rodaje / Z2' },
  { id: 'intervals', label: 'Series' },
  { id: 'tempo', label: 'Tempo' },
  { id: 'long', label: 'Tirada larga' },
  { id: 'race', label: 'Competición' },
];
export const BIKE_TYPES = [
  { id: 'easy', label: 'Rodaje' },
  { id: 'route', label: 'Ruta' },
  { id: 'intervals', label: 'Series' },
  { id: 'trainer', label: 'Rodillo' },
];
export const SWIM_STROKES = [
  { id: 'free', label: 'Crol' },
  { id: 'back', label: 'Espalda' },
  { id: 'breast', label: 'Braza' },
  { id: 'fly', label: 'Mariposa' },
  { id: 'mixed', label: 'Mixto' },
];
export const OTHER_TYPES = [
  { id: 'basketball', label: 'Baloncesto' },
  { id: 'agility', label: 'Agilidad' },
  { id: 'mobility', label: 'Movilidad' },
  { id: 'sport', label: 'Deporte libre' },
];

/** Ids de las plantillas precargadas (estables). */
export const TEMPLATE_IDS = { d1: 'tpl_d1', d2: 'tpl_d2', d3: 'tpl_d3', d4: 'tpl_d4', d6: 'tpl_d6' };

/** Ajustes por defecto. Toda clave nueva debe añadirse aquí (se rellena en datos antiguos). */
export function defaultSettings() {
  return {
    id: 'settings',
    // Semana tipo: lista de vigencias; days[0] = lunes … days[6] = domingo.
    weekPatterns: [
      {
        from: '2000-01-01',
        days: [
          { kind: 'template', templateId: TEMPLATE_IDS.d1 },
          { kind: 'template', templateId: TEMPLATE_IDS.d2 },
          { kind: 'template', templateId: TEMPLATE_IDS.d3 },
          { kind: 'template', templateId: TEMPLATE_IDS.d4 },
          { kind: 'rest' },
          { kind: 'template', templateId: TEMPLATE_IDS.d6 },
          { kind: 'rest' },
        ],
      },
    ],
    // Rango objetivo de series efectivas semanales por músculo [mín, máx].
    muscleTargets: {
      back: [14, 22],
      core: [12, 20],
      chest: [12, 20],
      sidedelt: [10, 20],
      reardelt: [8, 16],
      frontdelt: [0, 12],
      biceps: [8, 16],
      triceps: [8, 16],
      forearms: [0, 10],
      quads: [10, 18],
      hamstrings: [8, 16],
      glutes: [8, 16],
      adductors: [0, 10],
      calves: [8, 16],
      tibialis: [0, 10],
      lowerback: [0, 10],
    },
    primaryFactor: 1,
    secondaryFactor: 0.5,
    // Incrementos de la doble progresión (kg).
    increments: { upperCompound: 2.5, lowerCompound: 5, isolation: 1 },
    progression: { minRir: 1 },
    // Avisos de carga (% sobre la media de las 4 semanas previas).
    loadWarn: { low: 20, high: 30 },
    runKmWarn: { low: 10, high: 15 },
    // Estancamiento: sin mejora del 1RM estimado en N sesiones o N semanas.
    stall: { sessions: 3, weeks: 3 },
    // Descarga: nº de ejercicios estancados, RPE medio alto y semanas a mirar.
    deload: { minStalled: 3, rpeHigh: 8, weeks: 2 },
    // Estimaciones de objetivos: mínimo de registros y semanas.
    goals: { minRecords: 4, minWeeks: 3 },
    csv: { excel: true },
    lastBackupAt: null,
    backupReminderDays: 7,
    bodyweightDefault: 75,
  };
}

// ---------------------------------------------------------------------------
// Biblioteca de ejercicios.
// Forma: { id, name, aliases[], primary[], secondary[], pattern, logType,
//          category:'compound'|'isolation', region:'upper'|'lower'|'core'|'full', sport? }
// ---------------------------------------------------------------------------
export const SEED_EXERCISES = [
  // (se completa en seed de biblioteca)
];

// ---------------------------------------------------------------------------
// Plantillas precargadas (rutina actual del usuario).
// ---------------------------------------------------------------------------
export const SEED_TEMPLATES = [
  // (se completa en seed de plantillas)
];
