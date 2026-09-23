# Encargo original: app móvil de entrenamiento personal (fuerza + resistencia)

> Texto del encargo del usuario (fuente de verdad de los requisitos). Decisiones tomadas tras consultarle:
> - Semana tipo por defecto: **L D1 · M D2 · X D3 · J D4 · V descanso · S D6 · D descanso** (editable).
> - Se construyen las 3 fases seguidas, cada una probada y subida con su commit.

Quiero que me construyas una app web para usar SOLO en mi iPhone con Safari, instalada en la pantalla de inicio como si fuera una app nativa. Debe ser gratuita para siempre: sin suscripciones, sin servidor, sin cuentas y sin depender de ninguna IA para funcionar. La alojaré gratis en GitHub Pages.

## 1. Sobre mí y el objetivo de la app
Tengo 20 años, mido 186 cm y peso unos 75 kg. Mi prioridad actual es ganar masa muscular manteniendo una apariencia definida, con algo de trabajo atlético y de resistencia. Prioridades musculares: 1) espalda, 2) core/abdomen, 3) pecho. A futuro me atraen maratón, triatlón e Ironman, así que la app debe soportar carrera, bici y natación desde ya.
Quiero una app que me sirva para registrar rápido en el gimnasio, ver mi progreso con gráficas y recibir información clara sobre cómo voy, sin que me dirija la vida: información primero, sugerencias después, y siempre explicando el porqué.

## 2. Requisitos técnicos (obligatorios)
- Entrega: `index.html` + `manifest.json` + `sw.js` (service worker) + icono, listos para subir a GitHub Pages. Incluye una guía paso a paso, para alguien no programador, de cómo publicarla y añadirla a la pantalla de inicio del iPhone.
- Funciona sin conexión (el gimnasio puede no tener cobertura).
- Modo standalone en iOS (sin barra de Safari), respetando safe areas (notch y barra inferior).
- Guardado automático e inmediato: cada serie, cambio o edición se guarda al instante. Si cierro la app o se apaga el móvil a mitad de sesión, al volver la sesión sigue abierta donde la dejé.
- Almacenamiento en IndexedDB, solicitando `navigator.storage.persist()`.
- Copias de seguridad:
  - Botón "Exportar copia" (JSON completo) usando la hoja de compartir de iOS, para guardarla en Archivos o Google Drive.
  - "Importar copia" que restaure todo, con confirmación previa.
  - Recordatorio visible dentro de la app si hace más de 7 días de la última copia.
- Exportación CSV (sesiones de fuerza y de cardio por separado) para analizarla en Excel o con Claude.
- Librerías solo desde CDN fiable (p. ej. Chart.js), o sin librerías. Nada que requiera compilación.
- Rendimiento fluido en iPhone.
- Nunca borrar datos sin confirmación. Opción de deshacer al eliminar series, ejercicios o sesiones.

## 3. Diseño e interfaz
- Tema oscuro SIEMPRE. Alto contraste, legible bajo luz de gimnasio.
- Idioma: español. Unidades: kg, km, min/km, km/h, min/100 m.
- Pensada para usar con una mano entre series:
  - botones grandes y pocos toques por serie;
  - teclado numérico decimal en los campos de peso;
  - botones +/− rápidos (±2,5 kg, ±1 rep).
- Navegación inferior con pestañas: Hoy · Calendario · Progreso · Ejercicios · Ajustes.

## 4. Rutinas (plantillas) y calendario
- Puedo crear, editar, duplicar, reordenar y borrar plantillas de día con nombre libre (p. ej. "Día 1 — Upper fuerza", "Día 2 — Pierna explosiva").
- Cada ejercicio de una plantilla lleva:
  - series objetivo y rango de repeticiones (p. ej. 3×4–6) o de tiempo/distancia;
  - notas;
  - alternativas opcionales ("Prensa o Hack", "Nordic o curl femoral"), para elegir en la sesión cuál hice.
- Posibilidad de agrupar ejercicios en superserie o circuito (uso poco frecuente, pero debe existir).
- Calendario semanal:
  - Defino una "semana tipo" (orden de días) y la app la muestra en el calendario.
  - Puedo modificar cualquier semana concreta sin alterar la semana tipo: mover días, cambiar un día por otro, o sustituirlo por una sesión libre (p. ej. un sábado cambio el Día 6 por una ruta en bici).
  - Cada día se marca como: hecho, hecho parcialmente, sustituido, saltado o descanso.
  - La pantalla "Hoy" muestra lo que me toca hoy y permite empezar con un toque.
- Precarga mi rutina actual como plantillas iniciales (editable):
  - DÍA 1 — Upper pesado: Press banca 3×4–6 · Dominadas 3×5–8 · Press inclinado mancuerna 3×8–10 · Remo pecho apoyado 3×8–10 · Elevaciones laterales 3×12–20 · Face pull 2×15–20 · Crunch polea 3×10–15
  - DÍA 2 — Pierna fuerza + potencia:
    - Bloque potencia: Saltos verticales 3×3 · Pogo jumps 2×15–20
    - Bloque fuerza: Sentadilla 3×4–6 · Peso muerto rumano 3×6–8 · Prensa/Hack 2×8–12 · Curl femoral o Nordic 2×8–12 · Gemelos 3×10–15 · Tibialis raises 2×15–20 · Elevaciones de piernas 3×8–12
  - DÍA 3 — Cardio: Correr Z2 30–45 min · Bici 45–75 min · Plancha 3 series
  - DÍA 4 — Upper hipertrofia: Press inclinado Smith 4×6–8 · Aperturas 3×10–15 · Jalón al pecho 3×8–12 · Remo unilateral 3×8–12 · Curl supinador 2×10–15 · Elevaciones laterales 3×15–25 · Face pull 2×15–20 · Tríceps sobre cabeza 2×10–15 · Rueda abdominal 3×10–12
  - DÍA 6 — Atlético + pierna ligera: Pogo jumps 2×20 · Saltos 3×3 · Sprint 20 m ×4 · Sprint 30 m ×2–3 · Cambios de dirección ×3–4 · Búlgara 2×8/lado · Nordic/curl femoral 2×8–10 · Gemelos 2×12–15 · Dominadas/jalón 2×8–12 · Flexiones/fondos/cruce 2×10–15
  - Semana tipo: D1 → D2 → D3 → D4 → D6 → descanso.

## 5. Registro de sesiones de fuerza
- Por cada serie registro:
  - peso;
  - repeticiones;
  - RIR (0–5, con opción "fallo");
  - tipo de serie: calentamiento, efectiva, al fallo o drop set;
  - nota opcional.
- Tipos de ejercicio, porque no todo es peso × repeticiones:
  - peso × repeticiones;
  - peso corporal con lastre o con asistencia (dominadas, fondos, flexiones);
  - por tiempo (plancha);
  - por distancia y tiempo (sprints);
  - saltos (repeticiones, altura opcional);
  - unilateral, registrando por lado (búlgara, remo unilateral).
- Al registrar cada ejercicio veo lo que hice la ÚLTIMA vez en ese mismo ejercicio (series, pesos, reps, RIR). Las series de hoy se prellenan con esos valores para solo ajustar.
- Indicador de récord personal en el momento en que lo bato.
- Puedo añadir, quitar o cambiar ejercicios durante la sesión sin modificar la plantilla. Al terminar, la app me pregunta si quiero aplicar esos cambios a la plantilla.
- SIN temporizador de descanso (entreno por sensaciones). Sí quiero la duración total de la sesión, con inicio automático y edición manual.
- Nota general de sesión y esfuerzo percibido de la sesión (1–10) al terminar.
- Puedo editar o borrar sesiones pasadas y crear sesiones con fecha anterior.
- Las series de calentamiento no cuentan para volumen, series semanales ni récords.

## 6. Biblioteca de ejercicios
- Lista precargada y buscable de ejercicios comunes de gimnasio (incluyendo todos los de mi rutina), cada uno con:
  - músculos principales y secundarios;
  - patrón de movimiento (empuje horizontal/vertical, tirón horizontal/vertical, sentadilla, bisagra de cadera, core, potencia…);
  - tipo de registro (ver sección 5).
- Puedo crear ejercicios propios y editar su asignación muscular.
- Cómputo de series por músculo: 1 serie efectiva cuenta como 1 para el músculo principal y 0,5 para cada secundario (valores editables en Ajustes).

## 7. Cardio, natación y otras actividades
- Registro manual rápido, con campos equivalentes a los de Strava (de donde saco los datos). Todos son opcionales salvo tipo, fecha y duración:
  - Carrera: distancia, tiempo en movimiento, tiempo total, ritmo medio (calculado), desnivel, FC media y máxima, cadencia, esfuerzo percibido (1–10), tipo de sesión (rodaje/Z2, series, tempo, tirada larga, competición), zona o sensaciones, notas.
  - Bici: distancia, tiempo, velocidad media (calculada), desnivel, FC media y máxima, potencia media y normalizada si la tengo, cadencia, esfuerzo percibido, tipo (rodaje, ruta, series, rodillo), notas.
  - Natación: distancia, tiempo, ritmo/100 m (calculado), piscina o aguas abiertas, estilo principal, esfuerzo percibido, notas.
  - Otras (baloncesto, agilidad, movilidad, deporte libre): tipo, duración, esfuerzo percibido y notas.
- Carga de sesión para TODAS las actividades, incluida la fuerza: duración (min) × esfuerzo percibido (1–10). Así puedo sumar y comparar fuerza, cardio y deportes difíciles de cuantificar en una misma carga semanal.

## 8. Peso corporal
- Registro rápido diario u ocasional (p. ej. 75,4 kg).
- Gráfica con los valores diarios y una media móvil de 7 días destacada, para no interpretar fluctuaciones aisladas como tendencia.
- Tendencia semanal (kg/semana) calculada sobre la media móvil.

## 9. Progreso y gráficas
Todas las gráficas llevan selector de periodo (4 semanas, 3 meses, 6 meses, 1 año, todo) y se tocan para ver el valor exacto.
- Por ejercicio:
  - peso máximo;
  - 1RM estimado con la fórmula de Epley, usando reps + RIR como repeticiones hasta el fallo; solo con series de 1–12 reps, e indicando que es una estimación;
  - mejor serie;
  - volumen (peso × reps);
  - historial completo en lista.
- Por músculo: series efectivas por semana, con barra del rango objetivo.
- Volumen total semanal de fuerza.
- Carga semanal total y por tipo de actividad.
- Kilómetros semanales por deporte, ritmo medio en carrera y velocidad media en bici a lo largo del tiempo.
- Récords personales:
  - Fuerza: mejor peso, mejor 1RM estimado y mejores repeticiones a un peso dado.
  - Resistencia: mayor distancia, mejores tiempos en 5 km, 10 km, media y maratón (a partir de sesiones de esa distancia o mayor) y mayor distancia en bici y natación.
- Adherencia: sesiones planificadas frente a hechas por semana.

## 10. Panel semanal: información y sugerencias
Una pestaña o tarjeta semanal que muestre primero INFORMACIÓN y después SUGERENCIAS, claramente separadas. Cada mensaje tiene un botón "¿Por qué?" que explica la regla y los datos que lo generan. Todos los umbrales son editables en Ajustes.

Información:
- Series efectivas por músculo esta semana frente al rango objetivo (por defecto 10–20 series semanales; más alto para espalda, core y pecho, según mis prioridades).
- Músculos por debajo o por encima del rango, y comparación con la semana anterior.
- Equilibrio empuje/tirón (con mi prioridad de espalda, lo deseable es igualar o superar los tirones).
- Carga semanal total y por tipo de actividad, con variación porcentual frente a la media de las 4 semanas previas.
- Kilómetros semanales y variación.
- Ejercicios que progresan, que se mantienen y que se estancan (sin mejora del 1RM estimado en 3 sesiones o 3 semanas).

Sugerencias:
- Progresión por ejercicio (doble progresión): si en la última sesión completé todas las series efectivas en el tope del rango con RIR ≥ 1, sugerir subir peso (2,5 kg en compuestos de tren superior, 5 kg en tren inferior, 1–2 kg en aislamiento; editable). Si no, mantener peso y buscar más repeticiones.
- Aviso orientativo si la carga semanal sube más de un 20–30 % respecto a la media de las 4 semanas previas, o si los km de carrera suben más de un 10–15 % semanal. Debe presentarse como aviso prudente, no como predicción de lesión.
- Sugerir una semana de descarga si coinciden estancamiento en varios ejercicios, esfuerzo percibido alto sostenido y, si lo registro, check-in bajo.
- Tono: informativo, directo, sin alarmismos ni mensajes motivacionales vacíos.

## 11. Check-in opcional
- Antes o después de entrenar, opcional y saltable: sueño, energía y agujetas, cada uno con 3 toques (bajo, normal, alto).
- Se usa solo como contexto en el panel semanal y en la sugerencia de descarga.

## 12. Objetivos
- Puedo crear objetivos de fuerza (p. ej. "Remo 80 kg × 5"), de resistencia (p. ej. "10 km en menos de 45 min") o de peso corporal.
- La app muestra el progreso hacia el objetivo y una estimación de cuándo podría alcanzarlo:
  - Fuerza y peso corporal: extrapolación de la tendencia reciente.
  - Carrera: estimación a partir de mis tiempos recientes (p. ej. fórmula de Riegel).
- Las estimaciones se muestran siempre como un rango de fechas, no como una fecha exacta.
- Solo se calculan con datos suficientes (al menos 4 registros en 3 semanas); si no los hay, se indica "datos insuficientes".
- Debe explicar que el progreso no es lineal y que la estimación se recalcula con cada registro.

## 13. Ajustes
- Semana tipo y umbrales de las reglas (rangos de series por músculo, incrementos de peso, avisos de carga).
- Valor de las series secundarias.
- Gestión de la biblioteca de ejercicios.
- Exportar e importar copia; exportar CSV; fecha de la última copia; borrar todos los datos (con doble confirmación).

## 14. Orden de construcción
Construye por fases y entrega cada fase funcionando y probada antes de pasar a la siguiente:
- Fase 1: almacenamiento, guardado automático, copias, plantillas, calendario, registro de fuerza con "última vez", biblioteca con músculos, registro de cardio, natación, otras actividades y peso corporal.
- Fase 2: gráficas y récords.
- Fase 3: panel semanal, check-in y objetivos.

## 15. Criterios de aceptación
- Cierro Safari o la app a mitad de sesión, vuelvo y no se ha perdido nada.
- Exporto una copia, borro los datos, importo la copia y todo queda idéntico.
- Registrar una serie con los valores prellenados me cuesta 1–2 toques.
- Sustituir el Día 6 de esta semana por una ruta en bici no modifica mi semana tipo.
- Cada sugerencia del panel muestra su "¿Por qué?" con los datos concretos que la generan.
- Funciona sin conexión una vez instalada en la pantalla de inicio.
