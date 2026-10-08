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
  { id: 'hike', label: 'Senderismo', emoji: '🥾' },
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

/**
 * Semana de ejemplo con las rutinas precargadas (L D1 · M D2 · X D3 · J D4 · V — · S D6 · D —). Ya no se siembra en
 * los perfiles nuevos (ronda 8, B2): solo se ofrece en Ajustes › Semana tipo y se conserva en los datos antiguos que
 * no tenían semana tipo guardada (era la que veían). days[0] = lunes … days[6] = domingo.
 */
export function exampleWeekPatterns() {
  return [
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
  ];
}

/** Ajustes por defecto. Toda clave nueva debe añadirse aquí (se rellena en datos antiguos). */
export function defaultSettings() {
  return {
    id: 'settings',
    // Semana tipo: lista de vigencias; days[0] = lunes … days[6] = domingo. Vacía = sin planificar (ronda 8, B2):
    // un perfil nuevo no hereda la semana de ejemplo; la elige en la bienvenida («Tu semana») o en Ajustes.
    weekPatterns: [],
    // Rango objetivo de series efectivas semanales por músculo [mín, máx] (REQUISITOS §10): 10–20 en los que
    // se entrenan de forma directa; más alto en espalda, core y pecho (prioridades); 0–X en los que solo
    // reciben trabajo indirecto o de accesorio (deltoides anterior, antebrazo, aductores, tibial, lumbar).
    muscleTargets: {
      back: [14, 22],
      core: [12, 22],
      chest: [12, 22],
      sidedelt: [10, 20],
      reardelt: [10, 20],
      frontdelt: [0, 12],
      biceps: [10, 20],
      triceps: [10, 20],
      forearms: [0, 10],
      quads: [10, 20],
      hamstrings: [10, 20],
      glutes: [10, 20],
      adductors: [0, 10],
      calves: [10, 20],
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
    runKmWarn: { low: 10, high: 15, minBaseKm: 5 },
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
    // Perfil (ronda 5, docs/MEJORAS5.md): personaliza los análisis. null = sin contestar.
    profile: {
      sex: null, // 'male' | 'female'
      goal: null, // 'gain' | 'lose' | 'maintain' | 'performance'
      experience: null, // 'beginner' | 'intermediate' | 'advanced'
      // Solo modo mujer:
      cycleTracking: true, // seguimiento del ciclo (si sex === 'female')
      contraception: null, // 'none' | 'combined_pill' | 'progestin_pill' | 'hormonal_iud' | 'implant' | 'ring_patch' | 'injection' | 'copper_iud' | 'other'
      cycleLengthGuess: 28, // estimación inicial hasta tener ciclos registrados
      periodLengthGuess: 5,
      cycleInReport: false, // incluir el ciclo en «Copiar informe para tu IA»
      promptDismissed: false, // tarjeta «Completa tu perfil» en Hoy
    },
  };
}

// ---------------------------------------------------------------------------
// Biblioteca de ejercicios.
// Forma: { id, name, aliases[], primary[], secondary[], pattern, logType,
//          category:'compound'|'isolation', region:'upper'|'lower'|'core'|'full', sport? }
// ---------------------------------------------------------------------------
export const SEED_EXERCISES = [
  {"id": "press_banca", "name": "Press banca", "aliases": ["press de banca", "press plano", "bench press"], "primary": ["chest"], "secondary": ["triceps", "frontdelt"], "pattern": "push_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "press_banca_mancuerna", "name": "Press banca con mancuernas", "aliases": ["press plano mancuernas"], "primary": ["chest"], "secondary": ["triceps", "frontdelt"], "pattern": "push_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "press_inclinado_mancuerna", "name": "Press inclinado con mancuernas", "aliases": ["press inclinado mancuerna", "incline dumbbell press"], "primary": ["chest"], "secondary": ["frontdelt", "triceps"], "pattern": "push_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "press_inclinado_barra", "name": "Press inclinado con barra", "aliases": ["incline bench"], "primary": ["chest"], "secondary": ["frontdelt", "triceps"], "pattern": "push_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "press_inclinado_smith", "name": "Press inclinado en Smith", "aliases": ["press inclinado multipower", "smith inclinado"], "primary": ["chest"], "secondary": ["frontdelt", "triceps"], "pattern": "push_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "press_declinado", "name": "Press declinado", "aliases": ["decline press"], "primary": ["chest"], "secondary": ["triceps"], "pattern": "push_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "press_pecho_maquina", "name": "Press de pecho en máquina", "aliases": ["chest press"], "primary": ["chest"], "secondary": ["triceps", "frontdelt"], "pattern": "push_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "press_cerrado", "name": "Press banca agarre cerrado", "aliases": ["close grip bench"], "primary": ["triceps", "chest"], "secondary": ["frontdelt"], "pattern": "push_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "aperturas_mancuerna", "name": "Aperturas con mancuernas", "aliases": ["aperturas", "flyes", "aperturas planas"], "primary": ["chest"], "secondary": ["frontdelt"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "aperturas_maquina", "name": "Aperturas en máquina (pec deck)", "aliases": ["pec deck", "contractor"], "primary": ["chest"], "secondary": ["frontdelt"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "cruce_poleas", "name": "Cruce de poleas", "aliases": ["cruce", "crossover", "aperturas en polea"], "primary": ["chest"], "secondary": ["frontdelt"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "flexiones", "name": "Flexiones", "aliases": ["push-ups", "lagartijas"], "primary": ["chest"], "secondary": ["triceps", "frontdelt", "core"], "pattern": "push_h", "logType": "bodyweight", "category": "compound", "region": "upper"},
  {"id": "fondos", "name": "Fondos en paralelas", "aliases": ["dips", "fondos"], "primary": ["chest", "triceps"], "secondary": ["frontdelt"], "pattern": "push_v", "logType": "bodyweight", "category": "compound", "region": "upper"},
  {"id": "press_militar", "name": "Press militar con barra", "aliases": ["overhead press", "press de hombro barra"], "primary": ["frontdelt"], "secondary": ["sidedelt", "triceps"], "pattern": "push_v", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "press_hombro_mancuerna", "name": "Press de hombro con mancuernas", "aliases": ["press militar mancuernas"], "primary": ["frontdelt"], "secondary": ["sidedelt", "triceps"], "pattern": "push_v", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "press_hombro_maquina", "name": "Press de hombro en máquina", "aliases": ["shoulder press"], "primary": ["frontdelt"], "secondary": ["sidedelt", "triceps"], "pattern": "push_v", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "elevaciones_laterales", "name": "Elevaciones laterales", "aliases": ["laterales", "lateral raise", "elevaciones laterales mancuerna"], "primary": ["sidedelt"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "elevaciones_laterales_polea", "name": "Elevaciones laterales en polea", "aliases": ["laterales polea"], "primary": ["sidedelt"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "elevaciones_frontales", "name": "Elevaciones frontales", "aliases": ["front raise"], "primary": ["frontdelt"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "face_pull", "name": "Face pull", "aliases": ["facepull", "jalón a la cara"], "primary": ["reardelt"], "secondary": ["back"], "pattern": "pull_h", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "pajaros", "name": "Pájaros (vuelos posteriores)", "aliases": ["reverse fly", "deltoides posterior", "pájaro"], "primary": ["reardelt"], "secondary": ["back"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "contractor_inverso", "name": "Contractor inverso", "aliases": ["pec deck inverso", "reverse pec deck"], "primary": ["reardelt"], "secondary": ["back"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "encogimientos", "name": "Encogimientos", "aliases": ["shrugs", "trapecio"], "primary": ["back"], "secondary": ["forearms"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "dominadas", "name": "Dominadas", "aliases": ["pull-up", "dominada prona", "dominadas pronas"], "primary": ["back"], "secondary": ["biceps", "reardelt", "forearms"], "pattern": "pull_v", "logType": "bodyweight", "category": "compound", "region": "upper"},
  {"id": "dominadas_supinas", "name": "Dominadas supinas", "aliases": ["chin-up", "dominada supina"], "primary": ["back", "biceps"], "secondary": ["forearms"], "pattern": "pull_v", "logType": "bodyweight", "category": "compound", "region": "upper"},
  {"id": "jalon_pecho", "name": "Jalón al pecho", "aliases": ["jalón", "lat pulldown", "polea al pecho", "jalon"], "primary": ["back"], "secondary": ["biceps", "reardelt"], "pattern": "pull_v", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "jalon_estrecho", "name": "Jalón agarre estrecho", "aliases": ["jalón neutro", "jalón agarre neutro"], "primary": ["back"], "secondary": ["biceps"], "pattern": "pull_v", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "remo_pecho_apoyado", "name": "Remo con pecho apoyado", "aliases": ["remo en banco inclinado", "chest supported row", "remo seal", "remo apoyado"], "primary": ["back"], "secondary": ["reardelt", "biceps"], "pattern": "pull_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "remo_barra", "name": "Remo con barra", "aliases": ["barbell row", "remo pendlay"], "primary": ["back"], "secondary": ["reardelt", "biceps", "lowerback"], "pattern": "pull_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "remo_unilateral", "name": "Remo unilateral con mancuerna", "aliases": ["remo mancuerna", "one arm row", "remo a una mano"], "primary": ["back"], "secondary": ["reardelt", "biceps"], "pattern": "pull_h", "logType": "unilateral", "category": "compound", "region": "upper"},
  {"id": "remo_polea_baja", "name": "Remo en polea baja", "aliases": ["remo sentado", "seated row", "gironda"], "primary": ["back"], "secondary": ["biceps", "reardelt"], "pattern": "pull_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "remo_maquina", "name": "Remo en máquina", "aliases": ["remo hammer"], "primary": ["back"], "secondary": ["biceps", "reardelt"], "pattern": "pull_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "remo_t", "name": "Remo en T", "aliases": ["t-bar row"], "primary": ["back"], "secondary": ["biceps", "reardelt", "lowerback"], "pattern": "pull_h", "logType": "weight_reps", "category": "compound", "region": "upper"},
  {"id": "remo_invertido", "name": "Remo invertido", "aliases": ["inverted row", "remo australiano"], "primary": ["back"], "secondary": ["biceps", "reardelt"], "pattern": "pull_h", "logType": "bodyweight", "category": "compound", "region": "upper"},
  {"id": "pullover_polea", "name": "Pullover en polea", "aliases": ["pullover", "straight arm pulldown"], "primary": ["back"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "curl_barra", "name": "Curl con barra", "aliases": ["curl bíceps barra"], "primary": ["biceps"], "secondary": ["forearms"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "curl_mancuerna", "name": "Curl con mancuernas", "aliases": ["curl bíceps"], "primary": ["biceps"], "secondary": ["forearms"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "curl_supinador", "name": "Curl supinador", "aliases": ["curl con supinación", "curl supinado"], "primary": ["biceps"], "secondary": ["forearms"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "curl_martillo", "name": "Curl martillo", "aliases": ["hammer curl"], "primary": ["biceps"], "secondary": ["forearms"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "curl_polea", "name": "Curl en polea", "aliases": ["cable curl"], "primary": ["biceps"], "secondary": ["forearms"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "curl_predicador", "name": "Curl predicador", "aliases": ["banco scott", "preacher curl"], "primary": ["biceps"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "triceps_sobre_cabeza", "name": "Tríceps sobre la cabeza", "aliases": ["extensión sobre la cabeza", "overhead extension", "francés sobre cabeza", "tríceps sobre cabeza"], "primary": ["triceps"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "triceps_polea", "name": "Extensión de tríceps en polea", "aliases": ["pushdown", "tríceps polea", "jalón de tríceps"], "primary": ["triceps"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "press_frances", "name": "Press francés", "aliases": ["skull crusher"], "primary": ["triceps"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "upper"},
  {"id": "sentadilla", "name": "Sentadilla", "aliases": ["sentadilla trasera", "back squat", "squat"], "primary": ["quads", "glutes"], "secondary": ["adductors", "lowerback"], "pattern": "squat", "logType": "weight_reps", "category": "compound", "region": "lower"},
  {"id": "sentadilla_frontal", "name": "Sentadilla frontal", "aliases": ["front squat"], "primary": ["quads"], "secondary": ["glutes", "core"], "pattern": "squat", "logType": "weight_reps", "category": "compound", "region": "lower"},
  {"id": "sentadilla_goblet", "name": "Sentadilla goblet", "aliases": ["goblet squat"], "primary": ["quads", "glutes"], "secondary": ["core"], "pattern": "squat", "logType": "weight_reps", "category": "compound", "region": "lower"},
  {"id": "prensa", "name": "Prensa", "aliases": ["prensa de piernas", "leg press", "prensa inclinada"], "primary": ["quads", "glutes"], "secondary": ["adductors"], "pattern": "squat", "logType": "weight_reps", "category": "compound", "region": "lower"},
  {"id": "hack_squat", "name": "Sentadilla hack", "aliases": ["hack", "hack squat", "jaca"], "primary": ["quads"], "secondary": ["glutes"], "pattern": "squat", "logType": "weight_reps", "category": "compound", "region": "lower"},
  {"id": "extension_cuadriceps", "name": "Extensión de cuádriceps", "aliases": ["leg extension", "extensiones"], "primary": ["quads"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "lower"},
  {"id": "bulgara", "name": "Sentadilla búlgara", "aliases": ["búlgara", "bulgarian split squat", "split squat búlgaro"], "primary": ["quads", "glutes"], "secondary": ["adductors", "hamstrings"], "pattern": "lunge", "logType": "unilateral", "category": "compound", "region": "lower"},
  {"id": "zancadas", "name": "Zancadas", "aliases": ["lunges", "estocadas"], "primary": ["quads", "glutes"], "secondary": ["adductors", "hamstrings"], "pattern": "lunge", "logType": "unilateral", "category": "compound", "region": "lower"},
  {"id": "step_up", "name": "Subida al banco", "aliases": ["step-up", "step up"], "primary": ["quads", "glutes"], "secondary": ["hamstrings"], "pattern": "lunge", "logType": "unilateral", "category": "compound", "region": "lower"},
  {"id": "peso_muerto", "name": "Peso muerto", "aliases": ["deadlift", "peso muerto convencional"], "primary": ["glutes", "hamstrings", "lowerback"], "secondary": ["back", "quads", "forearms"], "pattern": "hinge", "logType": "weight_reps", "category": "compound", "region": "lower"},
  {"id": "peso_muerto_rumano", "name": "Peso muerto rumano", "aliases": ["rumano", "pmr", "rdl", "romanian deadlift"], "primary": ["hamstrings", "glutes"], "secondary": ["lowerback", "forearms"], "pattern": "hinge", "logType": "weight_reps", "category": "compound", "region": "lower"},
  {"id": "hip_thrust", "name": "Hip thrust", "aliases": ["empuje de cadera", "puente de glúteo con barra"], "primary": ["glutes"], "secondary": ["hamstrings"], "pattern": "hinge", "logType": "weight_reps", "category": "compound", "region": "lower"},
  {"id": "hiperextensiones", "name": "Hiperextensiones", "aliases": ["extensiones lumbares", "back extension"], "primary": ["lowerback", "glutes"], "secondary": ["hamstrings"], "pattern": "hinge", "logType": "weight_reps", "category": "isolation", "region": "lower"},
  {"id": "swing_kettlebell", "name": "Swing con kettlebell", "aliases": ["kb swing", "swing"], "primary": ["glutes", "hamstrings"], "secondary": ["lowerback", "core"], "pattern": "hinge", "logType": "weight_reps", "category": "compound", "region": "lower"},
  {"id": "curl_femoral", "name": "Curl femoral", "aliases": ["femoral", "leg curl", "curl femoral tumbado", "curl femoral sentado"], "primary": ["hamstrings"], "secondary": ["calves"], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "lower"},
  {"id": "nordic", "name": "Nordic curl", "aliases": ["nordic", "nórdico", "curl nórdico"], "primary": ["hamstrings"], "secondary": [], "pattern": "isolation", "logType": "bodyweight", "category": "isolation", "region": "lower"},
  {"id": "gemelos_pie", "name": "Gemelos de pie", "aliases": ["gemelos", "calf raise", "elevación de talones"], "primary": ["calves"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "lower"},
  {"id": "gemelos_sentado", "name": "Gemelos sentado", "aliases": ["sóleo", "seated calf raise"], "primary": ["calves"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "lower"},
  {"id": "tibialis_raises", "name": "Tibialis raises", "aliases": ["elevaciones de tibial", "tibial anterior", "tib raises"], "primary": ["tibialis"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "lower"},
  {"id": "aductores_maquina", "name": "Aductores en máquina", "aliases": ["aductor"], "primary": ["adductors"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "lower"},
  {"id": "abductores_maquina", "name": "Abductores en máquina", "aliases": ["abductor"], "primary": ["glutes"], "secondary": [], "pattern": "isolation", "logType": "weight_reps", "category": "isolation", "region": "lower"},
  {"id": "crunch_polea", "name": "Crunch en polea", "aliases": ["crunch polea", "cable crunch", "crunch con cuerda"], "primary": ["core"], "secondary": [], "pattern": "core", "logType": "weight_reps", "category": "isolation", "region": "core"},
  {"id": "elevaciones_piernas", "name": "Elevaciones de piernas", "aliases": ["elevación de piernas", "leg raises", "hanging leg raise", "elevaciones de piernas colgado"], "primary": ["core"], "secondary": ["forearms"], "pattern": "core", "logType": "bodyweight", "category": "isolation", "region": "core"},
  {"id": "rueda_abdominal", "name": "Rueda abdominal", "aliases": ["ab wheel", "rodillo abdominal"], "primary": ["core"], "secondary": ["back"], "pattern": "core", "logType": "bodyweight", "category": "isolation", "region": "core"},
  {"id": "plancha", "name": "Plancha", "aliases": ["plank", "plancha frontal"], "primary": ["core"], "secondary": [], "pattern": "core", "logType": "time", "category": "isolation", "region": "core"},
  {"id": "plancha_lateral", "name": "Plancha lateral", "aliases": ["side plank"], "primary": ["core"], "secondary": [], "pattern": "core", "logType": "time", "category": "isolation", "region": "core"},
  {"id": "pallof", "name": "Press Pallof", "aliases": ["pallof press", "antirrotación"], "primary": ["core"], "secondary": [], "pattern": "core", "logType": "weight_reps", "category": "isolation", "region": "core"},
  {"id": "crunch", "name": "Crunch abdominal", "aliases": ["abdominales", "encogimiento abdominal"], "primary": ["core"], "secondary": [], "pattern": "core", "logType": "bodyweight", "category": "isolation", "region": "core"},
  {"id": "paseo_granjero", "name": "Paseo del granjero", "aliases": ["farmer walk", "farmer carry"], "primary": ["forearms", "core"], "secondary": ["back"], "pattern": "carry", "logType": "distance_time", "category": "compound", "region": "full"},
  {"id": "saltos_verticales", "name": "Saltos verticales", "aliases": ["saltos", "salto vertical", "cmj", "countermovement jump"], "primary": ["quads", "glutes"], "secondary": ["calves"], "pattern": "power", "logType": "jumps", "category": "compound", "region": "lower"},
  {"id": "pogo_jumps", "name": "Pogo jumps", "aliases": ["pogos", "pogo"], "primary": ["calves"], "secondary": ["tibialis"], "pattern": "power", "logType": "jumps", "category": "compound", "region": "lower"},
  {"id": "saltos_cajon", "name": "Saltos al cajón", "aliases": ["box jump", "saltos a cajón"], "primary": ["quads", "glutes"], "secondary": ["calves"], "pattern": "power", "logType": "jumps", "category": "compound", "region": "lower"},
  {"id": "sprint", "name": "Sprint", "aliases": ["sprints", "carrera corta", "aceleraciones"], "primary": ["hamstrings", "glutes"], "secondary": ["quads", "calves"], "pattern": "sprint", "logType": "distance_time", "category": "compound", "region": "lower"},
  {"id": "cambios_direccion", "name": "Cambios de dirección", "aliases": ["agilidad", "cod", "change of direction", "5-10-5"], "primary": ["quads", "glutes"], "secondary": ["adductors", "calves"], "pattern": "sprint", "logType": "distance_time", "category": "compound", "region": "lower"},
  {"id": "correr", "name": "Correr", "aliases": ["carrera", "running", "rodaje"], "primary": [], "secondary": [], "pattern": "cardio", "logType": "cardio", "category": "compound", "region": "full", "sport": "run"},
  {"id": "bici", "name": "Bici", "aliases": ["bicicleta", "ciclismo", "cycling"], "primary": [], "secondary": [], "pattern": "cardio", "logType": "cardio", "category": "compound", "region": "full", "sport": "bike"},
  {"id": "nadar", "name": "Natación", "aliases": ["nadar", "swim", "piscina"], "primary": [], "secondary": [], "pattern": "cardio", "logType": "cardio", "category": "compound", "region": "full", "sport": "swim"},
];

// ---------------------------------------------------------------------------
// Plantillas precargadas (rutina actual del usuario).
// ---------------------------------------------------------------------------
export const SEED_TEMPLATES = [
  {
    "id": "tpl_d1",
    "name": "Día 1 — Upper pesado",
    "order": 0,
    "items": [
      {
        "id": "ti_d1_1",
        "exerciseId": "press_banca",
        "alternatives": [],
        "sets": 3,
        "repMin": 4,
        "repMax": 6,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d1_2",
        "exerciseId": "dominadas",
        "alternatives": [],
        "sets": 3,
        "repMin": 5,
        "repMax": 8,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d1_3",
        "exerciseId": "press_inclinado_mancuerna",
        "alternatives": [],
        "sets": 3,
        "repMin": 8,
        "repMax": 10,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d1_4",
        "exerciseId": "remo_pecho_apoyado",
        "alternatives": [],
        "sets": 3,
        "repMin": 8,
        "repMax": 10,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d1_5",
        "exerciseId": "elevaciones_laterales",
        "alternatives": [],
        "sets": 3,
        "repMin": 12,
        "repMax": 20,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d1_6",
        "exerciseId": "face_pull",
        "alternatives": [],
        "sets": 2,
        "repMin": 15,
        "repMax": 20,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d1_7",
        "exerciseId": "crunch_polea",
        "alternatives": [],
        "sets": 3,
        "repMin": 10,
        "repMax": 15,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      }
    ],
    "notes": ""
  },
  {
    "id": "tpl_d2",
    "name": "Día 2 — Pierna fuerza + potencia",
    "order": 1,
    "items": [
      {
        "id": "ti_d2_1",
        "exerciseId": "saltos_verticales",
        "alternatives": [],
        "sets": 3,
        "repMin": 3,
        "repMax": 3,
        "notes": "",
        "section": "Bloque potencia",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d2_2",
        "exerciseId": "pogo_jumps",
        "alternatives": [],
        "sets": 2,
        "repMin": 15,
        "repMax": 20,
        "notes": "",
        "section": "Bloque potencia",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d2_3",
        "exerciseId": "sentadilla",
        "alternatives": [],
        "sets": 3,
        "repMin": 4,
        "repMax": 6,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d2_4",
        "exerciseId": "peso_muerto_rumano",
        "alternatives": [],
        "sets": 3,
        "repMin": 6,
        "repMax": 8,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d2_5",
        "exerciseId": "prensa",
        "alternatives": [
          "hack_squat"
        ],
        "sets": 2,
        "repMin": 8,
        "repMax": 12,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d2_6",
        "exerciseId": "curl_femoral",
        "alternatives": [
          "nordic"
        ],
        "sets": 2,
        "repMin": 8,
        "repMax": 12,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d2_7",
        "exerciseId": "gemelos_pie",
        "alternatives": [],
        "sets": 3,
        "repMin": 10,
        "repMax": 15,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d2_8",
        "exerciseId": "tibialis_raises",
        "alternatives": [],
        "sets": 2,
        "repMin": 15,
        "repMax": 20,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d2_9",
        "exerciseId": "elevaciones_piernas",
        "alternatives": [],
        "sets": 3,
        "repMin": 8,
        "repMax": 12,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      }
    ],
    "notes": ""
  },
  {
    "id": "tpl_d3",
    "name": "Día 3 — Cardio",
    "order": 2,
    "items": [
      {
        "id": "ti_d3_1",
        "exerciseId": "correr",
        "alternatives": [],
        "sets": 1,
        "timeMin": 1800,
        "timeMax": 2700,
        "notes": "Zona 2",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d3_2",
        "exerciseId": "bici",
        "alternatives": [],
        "sets": 1,
        "timeMin": 2700,
        "timeMax": 4500,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d3_3",
        "exerciseId": "plancha",
        "alternatives": [],
        "sets": 3,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      }
    ],
    "notes": ""
  },
  {
    "id": "tpl_d4",
    "name": "Día 4 — Upper hipertrofia",
    "order": 3,
    "items": [
      {
        "id": "ti_d4_1",
        "exerciseId": "press_inclinado_smith",
        "alternatives": [],
        "sets": 4,
        "repMin": 6,
        "repMax": 8,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d4_2",
        "exerciseId": "aperturas_mancuerna",
        "alternatives": [],
        "sets": 3,
        "repMin": 10,
        "repMax": 15,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d4_3",
        "exerciseId": "jalon_pecho",
        "alternatives": [],
        "sets": 3,
        "repMin": 8,
        "repMax": 12,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d4_4",
        "exerciseId": "remo_unilateral",
        "alternatives": [],
        "sets": 3,
        "repMin": 8,
        "repMax": 12,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d4_5",
        "exerciseId": "curl_supinador",
        "alternatives": [],
        "sets": 2,
        "repMin": 10,
        "repMax": 15,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d4_6",
        "exerciseId": "elevaciones_laterales",
        "alternatives": [],
        "sets": 3,
        "repMin": 15,
        "repMax": 25,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d4_7",
        "exerciseId": "face_pull",
        "alternatives": [],
        "sets": 2,
        "repMin": 15,
        "repMax": 20,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d4_8",
        "exerciseId": "triceps_sobre_cabeza",
        "alternatives": [],
        "sets": 2,
        "repMin": 10,
        "repMax": 15,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d4_9",
        "exerciseId": "rueda_abdominal",
        "alternatives": [],
        "sets": 3,
        "repMin": 10,
        "repMax": 12,
        "notes": "",
        "section": "",
        "groupId": null,
        "groupType": null
      }
    ],
    "notes": ""
  },
  {
    "id": "tpl_d6",
    "name": "Día 6 — Atlético + pierna ligera",
    "order": 4,
    "items": [
      {
        "id": "ti_d6_1",
        "exerciseId": "pogo_jumps",
        "alternatives": [],
        "sets": 2,
        "repMin": 20,
        "repMax": 20,
        "notes": "",
        "section": "Bloque atlético",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d6_2",
        "exerciseId": "saltos_verticales",
        "alternatives": [],
        "sets": 3,
        "repMin": 3,
        "repMax": 3,
        "notes": "",
        "section": "Bloque atlético",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d6_3",
        "exerciseId": "sprint",
        "alternatives": [],
        "sets": 4,
        "distance": 20,
        "notes": "",
        "section": "Bloque atlético",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d6_4",
        "exerciseId": "sprint",
        "alternatives": [],
        "sets": 2,
        "setsMax": 3,
        "distance": 30,
        "notes": "",
        "section": "Bloque atlético",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d6_5",
        "exerciseId": "cambios_direccion",
        "alternatives": [],
        "sets": 3,
        "setsMax": 4,
        "notes": "",
        "section": "Bloque atlético",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d6_6",
        "exerciseId": "bulgara",
        "alternatives": [],
        "sets": 2,
        "repMin": 8,
        "repMax": 8,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d6_7",
        "exerciseId": "nordic",
        "alternatives": [
          "curl_femoral"
        ],
        "sets": 2,
        "repMin": 8,
        "repMax": 10,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d6_8",
        "exerciseId": "gemelos_pie",
        "alternatives": [],
        "sets": 2,
        "repMin": 12,
        "repMax": 15,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d6_9",
        "exerciseId": "dominadas",
        "alternatives": [
          "jalon_pecho"
        ],
        "sets": 2,
        "repMin": 8,
        "repMax": 12,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      },
      {
        "id": "ti_d6_10",
        "exerciseId": "flexiones",
        "alternatives": [
          "fondos",
          "cruce_poleas"
        ],
        "sets": 2,
        "repMin": 10,
        "repMax": 15,
        "notes": "",
        "section": "Bloque fuerza",
        "groupId": null,
        "groupType": null
      }
    ],
    "notes": ""
  }
];
