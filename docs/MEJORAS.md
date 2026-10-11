# Mejoras (ronda 4) — contrato

Pedidas por el usuario tras usar la app: senderismo, importar actividades desde archivos, calentamiento sugerido
(plegado), tiempos previstos + «¿Puedo hacerlo?», resúmenes semanal/mensual/anual, mapa corporal, y transiciones
tipo iPhone con efecto cristal («Liquid Glass») manteniendo colores e interfaz.
Quedan FUERA: notas fijas por ejercicio, medidas corporales, km por zapatillas, sesiones combinadas de triatlón.

Rutas nuevas (ya definidas en `js/app.js`, con vistas provisionales): `#/import` (views/import.js · mountImport),
`#/predictions` (views/predictions.js · mountPredictions), `#/summary?p=month|year&d=YYYY-MM-DD`
(views/summary.js · mountSummary). CSS nuevos ya enlazados y precacheados: `css/import.css`, `css/predictions.css`,
`css/summary.css`, `css/bodymap.css`. Token de color nuevo: `--act-hike: #2dd4bf`.

## 1. Senderismo (`kind: 'hike'`)
Registro en la store `sessions` como las demás actividades (ARCHITECTURE §3), `status:'done'`:
`{ kind:'hike', date, planDate, movingSec, elapsedSec, durationMin (= movingSec/60), distanceKm, elevationM (desnivel +),
elevationLossM (desnivel −), altMaxM, hrAvg, hrMax, rpe, packKg, notes, templateName:'Senderismo' }`.
- `seed.ACTIVITY_KINDS` gana `{ id:'hike', label:'Senderismo', emoji:'🥾' }` (colocado tras la natación).
- Cuenta en la carga (min × RPE) con su propio tipo, y en km con su propia columna (`km.hike`), separado de la carrera.
- Aparece en: formulario de actividad (tipo seleccionable), accesos rápidos de Hoy, sesión libre del calendario
  (pickers FREE), historial y filtros, CSV de cardio (columnas nuevas: desnivel −, altitud máx., mochila kg), gráficas de
  carga y km por deporte, récords (mayor distancia y mayor desnivel en senderismo), resúmenes, panel semanal (km).
- La carrera sigue siendo lo único que alimenta los avisos de km de carrera y las predicciones.

## 2. Importar actividades (`#/import`)
- Formatos: **GPX** (1.1, con extensiones Garmin TrackPointExtension: hr, cad), **TCX**, **FIT** (binario; decodificador
  propio mínimo: mensajes file_id, session, lap, record, sport), cualquiera de ellos **.gz**, y **.zip** (p. ej. el
  «Exportar original» de Garmin; lector ZIP propio con `DecompressionStream('deflate-raw')`). Varios archivos a la vez
  (`ui.pickFile` con multiple o input propio `accept=".gpx,.tcx,.fit,.gz,.zip"`).
- Por archivo: deporte (running/trail → run; cycling/biking → bike; hiking → hike; swimming → swim; walking → other
  con subtipo «Caminata»; desconocido → elegir), fecha/hora de inicio, distancia (del archivo o haversine con los puntos),
  tiempo total y **tiempo en movimiento** (excluye pausas: puntos con velocidad < 0,5 m/s o huecos > 30 s sin avance),
  desnivel + y − (suavizado y umbral de 3 m para no sumar ruido del GPS), altitud máxima, FC media/máx, cadencia media,
  potencia media si hay.
- **Vista previa editable** antes de guardar (tipo, fecha, datos, esfuerzo percibido opcional) y **duplicados**: se
  marca «ya registrada» si existe una actividad del mismo tipo con `startedAt` a ±2 min o, si no tiene hora, la misma
  fecha con distancia y duración a ±3 %. Guardar crea registros normales (`status:'done'`) con
  `startedAt` (ms) y `source: { type:'gpx'|'tcx'|'fit', fileName }`. No se guardan los puntos GPS.
- **Parciales de las carreras (ronda 8, C1+C2; `js/best-efforts.js`, puro).** Sin subir la versión de la BD ni
  almacén nuevo: campos opcionales del registro, solo en `kind:'run'` (las actividades antiguas no los tienen y no se
  migran). `track` = serie distancia–tiempo SIN coordenadas (dispositivo o, con GPS, los tramos en movimiento: la misma
  distancia que el resumen), simplificada con un filtro de abanico (ε = 1 m) y codificada en base 36 (segundos y
  decímetros; un «-» marca un intervalo original largo, p. ej. una pausa); `laps` (≥ 2 vueltas FIT/TCX:
  `{at, sec, timerSec, m}`); `bestEfforts = {v, basis:{km, sec}, src:'track'|'laps', items:{1k|5k|10k|half|marathon:
  {sec, atKm, pausedSec, approx}}}`, calculado una vez al importar con la serie completa. Solo se guardan si el usuario
  no cambió distancia ni tiempo en la revisión (que lo dice: «Se guardan los parciales…» / «Sin parciales: …») y la
  serie acaba en la distancia del registro (± máx(20 m, 1 %)) con ≤ 10 % de horas inválidas. Ventana más rápida exacta
  sobre la interpolación lineal (dos pasadas O(n)), con tiempo TRANSCURRIDO (las pausas cuentan; quedarse quieto antes
  de empezar no), sin ritmos < 2:30 /km, midiendo sin los metros de saltos del GPS (> 10 m/s) y descartando ventanas con
  más del 1 % de ellos; `approx` si la separación de muestras en los bordes supera máx(5 s, 1 %). Solo vueltas: rachas
  que suman X…X·1,005 + 5 m, todas con tiempo total; las vueltas de descanso de 0 m se guardan (`m: 0`) y su tiempo
  cuenta dentro del tramo, igual que un hueco entre vueltas (por `at`): un descanso nunca hace un tramo más rápido.
  `effortsOf(rec)` devuelve los parciales VÁLIDOS (huella `basis` = distancia y tiempo actuales, ± 0,005 km —la
  precisión con que el formulario muestra la distancia— y ± 0,5 s; si se editan dejan de contar y vuelven al deshacer,
  también escribiendo de nuevo la distancia que se ve; en la revisión de la importación, volver a escribir el mismo
  valor tampoco cuenta como cambio) y recalcula desde `track` solo si sube `BEST_EFFORTS_VERSION` (memorizado por
  registro); `splitsOf(rec)` da los parciales por km. Tamaño medido (perf, serie de 1 Hz con ritmo variable): ~1,6 KB
  por carrera de una hora (5 años: 522 carreras, 859 KB) y sin cambio medible en el arranque. Con GPS de móvil (GPX
  sin distancia del reloj, ruido correlacionado de 2–5 m) el filtro conserva más puntos: ~3,5–6 KB por hora. Las copias JSON los conservan en ida y vuelta (el formato no cambia; el CSV tampoco).
  Pruebas: tests/unit/best-efforts.test.mjs, tests/e2e/import-splits.test.cjs.
- **Récords con mejores esfuerzos (ronda 8, C3).** Una sola regla derivada, `stats.runMarkFor(a, X)`, para
  Progreso › Récords (`enduranceRecords`), los récords del resumen (`summary-logic`), el «conseguido» de los objetivos
  de tiempo (`goals-logic`), el informe para IA y el récord que enseña «¿Por qué?» de Tiempos previstos: carrera de X a
  X·1,02 → `'full'` (tiempo en movimiento × X / km, como siempre); más larga con un mejor esfuerzo válido
  (`effortsOf`, no `approx`, ritmo 2:30–20:00 /km) → `'partial'` (su tramo continuo, ritmo del tramo); si no →
  `'estimated'` (ritmo medio, distintivo «estimado»). Las marcas históricas usan `scaledRunMark` (ritmo medio). Cada
  récord lleva `how` y `partial:{id, ofKm, atKm, src}`; `estimated` sigue y vale `how === 'estimated'`. En una misma
  carrera el parcial sustituye a la estimación aunque sea más lento (una pausa dentro cuenta); las estimaciones de otras
  carreras siguen compitiendo, etiquetadas. Editar la distancia o el tiempo oculta el parcial sin tocar datos.
  En Récords: «Parcial dentro de 12,4 km» (sin distintivo). Solo hay parciales en 1/5/10/21,0975/42,195 km: un
  objetivo de otra distancia usa la estimación. Pruebas: tests/unit/records-partials.test.mjs,
  tests/e2e/records-partials.test.cjs.
- Explicación breve en la pantalla de cómo exportar: Strava (web: «⋯ → Exportar GPX»; la app de Strava no exporta),
  Garmin Connect (web: «⚙ → Exportar original / GPX / TCX»), Apple (Salud no exporta entrenamientos sueltos: vía
  Strava si el reloj sincroniza, o apps como HealthFit/RunGap).
- Entradas: botón en `#/settings/data`, en el formulario de actividad y en Hoy (integración).

## 3. Calentamiento sugerido (sesión de fuerza)
Pura: `warmupPlan({ workWeight, reps, exercise, settings })` → `[{ pct, weight, reps }]` en `js/session-logic.js`.
Esquema: peso de trabajo ≥ 60 kg → 40 %×8, 60 %×5, 80 %×3; 30–60 kg → 50 %×8, 75 %×4; < 30 kg → 50 %×10; redondeo al
incremento cargable (2,5 kg compuestos; 1 kg aislamiento), sin pasos repetidos ni por debajo de ~20 % útil; peso
corporal/tiempo/distancia/saltos → sin sugerencia. UI: línea plegada «Calentamiento sugerido ▸» en la tarjeta del
ejercicio (solo si hay carga y aún no hay calentamientos hechos); al abrir, los pasos y «Añadir estas series» (series
de calentamiento pendientes al principio). No cambia el registro de 1 toque ni ocupa espacio si no se abre.

## 4. Tiempos previstos (`js/race-predict.js`, puro; vista `#/predictions`)
- `predictRaces(data)` → `{ ok, reason?, basis:[esfuerzos usados], weeklyKm, longestRecentKm, predictions: { '5k'|'10k'|
  'half'|'marathon': { low, mid, high (segundos), confidence:'alta'|'media'|'baja', why:{ rule, data:[{label,value}] } } } }`.
  Base: carreras de las últimas 12 semanas ≥ 3 km (mejor esfuerzo por carrera = tiempo en movimiento), Riegel
  `t2 = t1·(d2/d1)^k` con k = 1,06; se usan los 3 mejores esfuerzos (más peso a los más recientes y de distancia más
  parecida) y el rango sale de su dispersión con un mínimo de ±3 %. Media/maratón: si los km semanales (media de 6
  semanas) o la tirada más larga reciente se quedan cortos (p. ej. maratón: < 40 km/sem o tirada < 24 km; media:
  < 25 km/sem o tirada < 14 km), k sube hasta 1,10 y la confianza baja, explicándolo en `why`. Menos de 2 carreras
  válidas → `ok:false` («datos insuficientes»).
  Corrección de la ronda 6 (docs/MEJORAS6.md): solo cuentan ritmos de 2:30 a 20:00 /km (las demás, en `suspect`); el
  margen del rango tiene un tope de ±25 %; cada predicción lleva `status` ('ok' | 'tentative' | 'incoherent' |
  'invalid'), `usable` y `advice {note, improve}`. `mid` = estimación actual (media ponderada). Formato solo con
  `util.fmtRaceTime` / `fmtPaceKm` / `fmtRaceRange` / `fmtPaceRange` (null si el dato no vale).
  Resultados de carrera de «Tu contexto» (ronda 6, docs/MEJORAS6.md): los de 12 semanas cuentan como una carrera más; los
  anteriores, como referencias históricas con menos peso cuanto más antiguos y la mitad si después hubo un parón;
  `history`, `duplicates`, `canPredict`; `status:'tentative'` también con menos de 2 carreras recientes.
- `checkTarget(data, distanceKm, targetSec)` → `{ verdict:'probable'|'ajustado'|'hoy_no'|'insuficiente', prediction,
  gapSec, why }`: objetivo ≥ `high` → probable; dentro del rango → ajustado; < `low` → hoy no (con cuánto falta).
- **Motor único (ronda 8, B1).** `race-predict.js` es la única fuente de cualquier tiempo o ritmo de carrera a pie
  estimado; nadie más llama a `calc.riegel` para carrera. Entradas finas (sin matemáticas nuevas):
  `predictFor(data, km, { today }?)` → `{ ok:true, prediction }` | `insufficient(ctx)`; `baseOf(p)` → DTO canónico
  `{ method:'riegel-ponderado', id, km, mid, low, high, pace…, midExact, k, confidence, confidenceLabel,
  confidenceCodes, status, usable, refs, note }` (lo que comparan las pruebas cruzadas); `predictionSeries(data, km,
  fechas)` (fotos del mismo motor en fechas pasadas: tendencia e inicio de un objetivo); `predictWindow(data, km,
  { from, to })` (solo carreras registradas de la ventana: forma por bloques de Análisis); `predictionDataset(p)`
  (atributos `data-mid/low/high/confidence` de las vistas); `METHOD`. `analyzeRuns` se memoriza por (`data`, hoy) y
  se invalida como `stats.getIndex` (otra lista o distinta longitud de `sessions`/`context`). `checkTarget` pasa por
  `predictFor`; `runningSummary().predictions[i]` añade `low`, `high`, `midExact`, `usable`, `confidenceCodes`, `method`.
  Consumidores: Tiempos previstos (tabla y distancia propia), **Objetivos** de carrera con tiempo (`goals-logic`:
  «Actual» = `predictFor().mid`, veredicto = `checkTarget`, «Al alcance» ⇔ `probable`, «Ajustado» u «Orientativo»
  sin fecha, tendencia = regresión de las fotos semanales del motor, `prediction` = `baseOf`; conseguido exige además
  un ritmo creíble), Eventos (`racePrediction().base`), Análisis (tile «5 km previsto» = el de hoy; la serie por
  bloques se llama «Forma en 5 km por bloques»; la previsión a 4 semanas parte del 5 km de hoy) y el informe
  (previsto, rango y confianza). Bici, natación y senderismo con tiempo siguen con su Riegel en `goals-logic` (ninguna
  otra pantalla los predice). Pruebas cruzadas: `tests/unit/prediction-coherence.test.mjs`,
  `tests/e2e/prediction-coherence.test.cjs`.
- **Mejores tramos en el motor (ronda 8, C4; regla 1c de race-predict.js).** De cada carrera importada con parciales
  válidos (`stats.runPartialsBySession(data, MIN_KM)`: la misma `runMarkFor` de Récords, solo `how:'partial'`; el de
  1 km nunca, < 3 km) el esfuerzo es el candidato con menor `T / D^1,06` entre la carrera entera y sus tramos de 5 km,
  10 km, media o maratón (empate → la entera): UNO por carrera, nunca la carrera y su tramo. La carrera entera tiene
  que pasar antes ventana, ≥ 3 km y ritmo creíble (sospechosa → sus tramos tampoco). El esfuerzo añade
  `partial:{id, ofKm, atKm}|null`, `wholeKm`, `wholeSec`; volumen y tirada más larga usan la carrera entera, y un
  resultado de tu contexto se compara con la carrera ENTERA (`matchesRun` con `wholeKm/wholeSec`: si no, un 12,4 km
  apuntado dejaría de ser «la misma» en cuanto contara su 5 km y se contaría dos veces). Sin matemáticas nuevas: el
  tramo pesa por su propia distancia (también para la confianza: «ningún esfuerzo cercano» mira 5 km). A ritmo
  uniforme gana la carrera entera; solo cambia algo cuando el tramo es de verdad más rápido que su equivalente.
  Explicación: etiqueta «5 km en 24:50 (4:58/km) · mejor tramo de una carrera de 12,4 km», frase y fila «Mejores
  tramos» en «¿Por qué?», nota en la fila de confianza; `baseOf().refs[]` y `runningSummary().refs[]` llevan
  `partial`; el informe dice «mejor tramo de 5 km dentro de una carrera de 12,4 km»; «Con qué se calcula» lo marca
  (`data-partial`). Objetivos, Eventos, Análisis e informe pasan por `predictFor`/`baseOf` y siguen coherentes.
  Pruebas: `tests/unit/prediction-coherence.test.mjs` (fixture F7 en la prueba cruzada + 6 pruebas C4),
  `tests/e2e/prediction-coherence.test.cjs` (Chromium y WebKit, 375 px, 100 % y 150 %).
- Vista: tabla de las 4 distancias (rango, ritmo, confianza, «¿Por qué?»), comprobador (distancia: 5k/10k/media/
  maratón/otra en km + tiempo con `ui.durationInput`) con veredicto y «¿Por qué?». Tono prudente: estimación, no promesa.

## 5. Resúmenes (`js/summary-logic.js`, puro; vista `#/summary`)
`periodSummary(data, { unit:'week'|'month'|'year', start })` → `{ start, end, prevStart, prevEnd, inProgress,
days, sessions, byKind:{ [kind]: { count, minutes, km, load } }, load, strength:{ sessions, volume, workSets,
muscleSets }, records:[{ label, detail, date, sessionId }], topProgress:[{ exerciseId, name, from, to, delta }],
compare:{ … deltas frente al periodo anterior } }` (reutiliza `js/stats.js`, que ya sabe de todas las clases).
Vista `#/summary`: segmentado Mes / Año, navegación ‹ ›, tarjetas de totales por deporte, días entrenados, fuerza
(volumen, series por músculo), récords del periodo, ejercicios que más progresan y comparación con el anterior.
Bloque «Resumen de la semana» arriba del panel semanal (`#/weekly`), con la comparación con la semana anterior.

## 6. Mapa corporal (`js/bodymap.js`)
`bodyMap({ muscles: { [muscleId]: { sets, min, max, status:'below'|'in'|'above'|'none' } }, onSelect }) → HTMLElement`:
silueta SVG de frente y de espalda (lado a lado) con las 16 zonas de `seed.MUSCLES` coloreadas por estado (con
leyenda; no solo color: tocar una zona muestra nombre, series y rango), accesible y nítida en 375–430 px. Se usa en el
panel semanal y en Progreso (integración).

## 7. Transiciones y efecto cristal
- Navegación: al entrar (navigate) la vista nueva entra deslizándose desde la derecha; al volver (back) sale hacia la
  derecha y se ve la anterior; cambio de pestaña con fundido suave; `replace` sin animación. Preferente: View
  Transitions API (`document.startViewTransition`, Safari 18+/Chromium: captura una imagen de la vista anterior, sin
  duplicar DOM); si no existe, animación solo de entrada de la vista nueva (sin clonar la antigua). Sin romper la
  restauración del scroll ni las pruebas (nunca dos copias vivas de la misma vista).
- Hojas inferiores con la curva de iOS (≈ `cubic-bezier(0.32,0.72,0,1)`, 350 ms), fondo que se oscurece con fundido;
  botones, filas y chips con respuesta al toque (escala ~0,97 y atenuación, 120 ms).
- Cristal: barra superior, barra de pestañas (flotante tipo cápsula como en iOS 26 si queda bien y no tapa contenido),
  hojas y toasts translúcidos con `backdrop-filter: blur() saturate()`, borde interior brillante sutil y reflejo
  suave; con alternativa opaca si no hay soporte. Mismos colores y tipografía.
- `@media (prefers-reduced-motion: reduce)` → sin animaciones de desplazamiento. 60 fps: animar solo transform/opacity.

## 8. Eventos: «¿Cómo te fue?» (ronda 8, D1–D4)
Un evento pasado no se archiva sin más: se cierra con su resultado. **El evento REFERENCIA su resultado; no copia una
actividad ni un tiempo** (una sola fuente; los récords siguen siendo derivados). Sin subir la versión de la BD (v3) ni
`BACKUP_FORMAT` (2): `outcome` es un campo opcional más del registro de `races` (las copias lo guardan tal cual en ambas
direcciones; una copia antigua sin él = «sin responder»; una app antigua lo ignora, pero lo pierde si edita ese evento).
- **Datos** (`races-logic.js`, ligero: lo importa Hoy). `outcome: null | { status:'done'|'dns'|'skipped', activityId,
  contextId, manual:{sec, km|null}|null, place (entero 1–99 999)|null, note (≤ 500), at }`. Con `done`, exactamente
  UNA referencia (si llegan varias: actividad > contexto > a mano; sin ninguna válida → null); con `dns`/`skipped`,
  ninguna y sin puesto. `normalizeOutcome`, `validateOutcome(d, race)`, `withOutcome(raw, o, now)` (parte del registro
  del almacén, no de un borrador), `needsOutcome` (antes de hoy y sin responder), `outcomeDue` (≤ 60 días, la etiqueta
  de la lista), `pendingOutcome(list, today)` (A/B más reciente de los últimos 7 días: el aviso de Hoy),
  `outcomePrompt` («¿Cómo te fue en el 10K del domingo?»), `raceLinkedTo` / `linkedWarning` (búsqueda inversa al
  borrar). `validateRace(d, { today })`: un evento con resultado (hecho o «no participé») no se mueve al futuro.
  - **Corregido**: `normalizeRace` y `raceRecord` reconstruían el evento campo a campo y perdían `outcome`; y el
    formulario `#/races/:id` guardaba su copia de cuando se abrió (machacaba un resultado guardado entretanto). Ahora
    los dos lo conservan y «Guardar cambios» toma `outcome` del almacén en ese momento.
  - **Corregido**: el detalle de un evento pasado enseñaba «Cómo vas» con la predicción de HOY. Ahora «Cómo vas» solo
    sale en lo que aún no ha pasado; un evento pasado (o de hoy) muestra la tarjeta «Resultado».
- **Dónde vive el resultado.** Actividad registrada o importada → `activityId` (cualquier tipo salvo fuerza). Carrera a
  pie a mano → se crea una entrada `race_result` de tu contexto (precisión «día», la del evento, `effort:'race'`) y el
  evento guarda su id: Récords, Tiempos previstos y el informe la leen sin código nuevo. Otro deporte a mano →
  `outcome.manual` (única copia: nadie más lo lee; una ruta de 20 km en 5 h no entra en el motor de carrera).
- **Lógica** (`races-result.js`, puro; usa `race-predict`, `stats`, `context-logic`).
  - `resultCandidates(data, race, races)`: actividades hechas de D−1 a D+1 del deporte del evento (triatlón y «otro»:
    cualquiera salvo fuerza), sin lo vinculado a otro evento, del día más cercano y la distancia más parecida
    (`close` = ±10 %); en carrera a pie, también tus `race_result` de esos días.
  - `resolveResult(data, race)` → `{ state:'pending'|'done'|'dns'|'skipped'|'missing', source, sec, km, how, partialText,
    missing, comparable, place, note }`. El tiempo es `stats.actSec` (tiempo en movimiento: el de Récords, predicciones y
    objetivos). **Corrección del diseño:** si la actividad mide la distancia del evento ±5 % (la tolerancia de
    `matchesRun`; el GPS suele medir de más) cuenta ENTERA; solo si es claramente más larga (> 5 %) y tiene un mejor
    tramo válido cuenta ese tramo (`stats.runMarkFor`, «Parcial dentro de 12,4 km»). Nunca se estima a ritmo medio (un
    resultado es un tiempo medido): sin tramo, el tiempo entero y `comparable:false` (no se compara con el objetivo ni
    con el rango). Lo vinculado borrado → `missing:'activity'|'context'`; nada se limpia: al deshacer el borrado vuelve.
  - `compareResult(sec, target)` → «42 s mejor que el objetivo» / «1 min 5 s peor…» / «Igual que el objetivo», exacto
    al segundo (`fmtTimeWords`), tono neutro (ni verde ni rojo). Sin puntuaciones.
  - `priorPrediction(data, race)`: el motor único, `predictFor(data, km, { today: D−1 })` + `baseOf`; no se guarda
    (determinista; «con tus datos hasta el sáb 3 oct»: si luego importas carreras anteriores, cambia). `analyzeRuns`
    solo usa lo de hasta esa fecha (carreras, resultados de contexto, parones): el propio resultado nunca entra (si el
    resultado vinculado es del día ANTERIOR al evento —la ventana de vínculo es ±1 día—, «hoy» = la víspera del
    resultado, `{ resultDate }`; revisión adversarial). Única
    fuga conocida: `p.record`/`p.why` usan los récords de hoy; esta vista no los enseña. `rangePosition` (los extremos
    cuentan como dentro).
  - `resultRecord`: el MISMO `stats.enduranceRecords`: «Tu récord en 10 km» si el resultado es hoy el titular (por
    `sessionId`, `entryId` o `alsoContext`); si no, «Fue tu récord en 10 km en su momento» con los récords recortados
    al día del evento (memorizado por `data` y fecha; solo en el detalle). Bici/senderismo: «Tu salida/ruta más
    larga». Enlaza a `#/records?seg=endurance` (Récords acepta `?seg=`).
  - `outcomeView(data, race, { prior, record })` (la lista los pide apagados) y `pastEventsForReport` (informe).
- **Vistas.** Lista: las filas pasadas dicen «Resultado 49:18 · 42 s mejor que el objetivo», «No participaste», «El
  resultado ya no existe» o, sin responder y de ≤ 60 días, la etiqueta «¿Cómo te fue?»; la cabecera plegada,
  «Pasados (n) · 1 sin resultado». Detalle (`views/race-result.js`, `data-block="result"`, `data-state`): sin
  responder, 4 filas de ≥ 44 px (Vincular una actividad con los candidatos en línea —sin candidatos, «Registrar
  actividad» / «Importar»—, Introducir resultado con su formulario en línea —tiempo, distancia, puesto y nota—, No
  participé, Omitir); con resultado, Objetivo · Resultado · Diferencia · Predicción previa (`data-inside`), que se
  apilan con texto grande, el récord (🏆) y Ver actividad / Editar resultado (la MISMA entrada de contexto) / Cambiar /
  Quitar (quitar no borra la marca: «la marca sigue en tu contexto»). Cada acción ofrece «Deshacer» (vuelve el evento
  como estaba y quita o restaura la marca de contexto); la marca se escribe antes que el evento. Hoy: con
  `pendingOutcome`, una línea neutra «🏁 ¿Cómo te fue en el 10K del domingo?» → el evento. Borrar una actividad o una
  marca vinculada avisa: «Es el resultado de «10K»; el evento quedará sin resultado.».
- **Informe para IA**: «EVENTOS RECIENTES» (últimos 6 meses, máx. 6; `analysis.pastEvents`, la caché ya depende de
  races, sessions y context): «10K · 4 oct · objetivo <50:00 · resultado 49:18 (42 s mejor) · puesto 41 · previsión
  previa 51:35–54:50 (más rápido que el rango)» o «no participó»; omitidos y sin responder no salen; sin notas.
- **Rendimiento**: `outcomeView` del detalle con 600 carreras ≈ 5–10 ms en Node (predicción de la víspera + dos
  índices de récords); límite en la prueba, 150 ms.
- **Pendiente**: no se crea una actividad desde el evento (se registra o importa y se vuelve a vincular). Borrar una
  sesión de fuerza con actividades enlazadas (`views/session.js`) no avisa si una de ellas es un resultado (sigue
  siendo recuperable con «Deshacer» y el evento muestra «El resultado ya no existe»).
- **Pruebas**: `tests/unit/races-result.test.mjs` (16), `tests/unit/races.test.mjs`, `tests/e2e/race-outcome.test.cjs`
  (Chromium; omitir y vincular también en WebKit), pantalla `race-result` en `tests/e2e/visual-guard.test.cjs`.

## 9. Contexto dentro de las gráficas (ronda 8, E1–E4)

«Tu contexto» (fases y hechos) y los eventos pasados con resultado se ven DENTRO de las gráficas, para leerlas con lo
que pasaba (una bajada de peso durante una enfermedad, la fuerza tras empezar la creatina, el ritmo de una carrera).

- **Franja superior, no bandas de fondo** (`js/charts.js`, opción `context` de `lineChart` y `barChart`): solo existe
  con el contexto encendido y algo dentro del periodo; entonces el margen de arriba pasa de 10 a 18 px (`svg[data-t]`) y
  la franja va ahí. Apagada, la gráfica es exactamente la de antes. No choca con las franjas rosas de la regla (modo
  mujer), no tapa líneas ni barras y cabe a 375 px.
- **Fases**: una sola fila de segmentos de 5 px, un único color neutro (`--text-2` al 45 %; sin arcoíris). Varias a
  la vez se pintan como su UNIÓN (`mergeSegments`); los nombres solo salen en el globo, por prioridad y con «+N». Un
  lado que sigue fuera del periodo (fase abierta o que acaba después) tiene el extremo recto; si no, redondo.
- **Hechos**: punto de 3,5 px. Precisión día → relleno en su fecha; mes → hueco a mitad de mes («sep 2026»); estación o
  año → no se dibujan (no se pueden situar con honradez; siguen en «Tu contexto»). El peso habitual y los pesos en una
  fecha nunca salen (son referencias). Dos marcadores a menos de 12 px van juntos (`groupFacts`): «2 hechos».
- **Eventos pasados**: con resultado (`outcome.status 'done'`), un hecho más con su tiempo, leído con `resolveResult`
  (la misma fuente que «¿Cómo te fue?»): «10K Valencia · 49:18». Si el resultado vive en un resultado de carrera de tu
  contexto (`contextId`), se pinta una sola vez, como evento. «No participé», omitido, sin responder y futuros, no.
  Nombre: el del evento o, sin nombre, el corto del tipo («10K · 50:00»). (El diseño proponía `eventLabel`, que con un
  nombre como «10K Valencia» daría «10K Valencia (10K)»: se usa `name || raceShortLabel`.)
- **Toque**: un toque SIN arrastre que levanta en la franja (py ≤ T + 26, ≈ 44 px desde arriba) y a ±22 px de un hecho
  abre su globo de una línea, «15 sep · Inicio creatina» (varios: «3 hechos» y una fila por hecho, hasta 3 y «+N
  más»). Con ratón, al pasar por encima. El resto de toques y el arrastre, como siempre.
- **Globo de un punto**: una línea más, `.chart-tip-ctx`, siempre de una línea («…» si no cabe): hechos de ese día y
  después fases vigentes por prioridad, «Parón · +1». En barras semanales cuenta la semana entera. Así se lee «28 ago
  2026 · 72,7 kg · Parón de verano» (fecha, valor, contexto).
- **Interruptor «Contexto»** (`button.chart-ctx-toggle`, `aria-pressed`, `aria-label` «Mostrar contexto en la
  gráfica», ≥ 44 px): al final de la leyenda (o en una fila propia sin leyenda; con texto grande baja a su fila); su
  icono es una muestra de la franja. Solo aparece si algo cae en el periodo. Se recuerda por gráfica en
  `localStorage['entreno.chartctx.<key>']` ('1'/'0', respaldo en memoria), como el periodo: no va en la copia y «Borrar
  todo» o importar ya lo borran (`LOCAL_KEY_PREFIXES`). Pulsarlo solo redibuja (no recalcula datos).
  Encendido por defecto: `bodyweight` (Progreso, #/bodyweight y el análisis comparten la clave), `exercise` (todas las
  gráficas de la ficha), `run-pace`, `bike-speed`, `swim-pace`. Apagado (barras con ruido): `load`, `km`.
- **Accesibilidad**: con el contexto encendido, la descripción del SVG añade «Contexto: Parón (fase), Inicio creatina
  el 15 sep y 2 más» (3 como mucho; fases por prioridad y después hechos). Apagado, nada.
- **Qué entra en cada gráfica** (`js/chart-context.js`, puro): perfiles `weight` y `strength` (vida, entrenamiento,
  cuerpo, personalizada; sin carreras), `endurance` (vida, entrenamiento, deporte, personalizada; todo; las fases y
  eventos de OTRO deporte no entran: Prep. ciclismo no sale en el ritmo de carrera, Híbrido sí) y `load`. El orden de
  aspectos es la prioridad del nombre. Nombres: `short` nuevo en `PHASE_TYPES`/`EVENT_TYPES` («Parón», «Prep. 10K»,
  «Inicio creatina»…); en personalizada y «Otro», su texto (la descripción de un tipo con nombre no es un nombre: una
  fase de parón sale «Parón»). Resultado de carrera: «San Silvestre · 49:18» (o la distancia si no tiene nombre).
- **Gráficas con franja**: Progreso (peso, ritmo de carrera, velocidad en bici, ritmo de natación, carga semanal y km
  semanales —con un deporte elegido, su contexto; con «Todos», sin filtro—), ficha de ejercicio (todas sus gráficas),
  #/bodyweight (también con la regla) y el peso del análisis. Sin franja, a propósito: volumen, músculos, adherencia, las
  minigráficas de «Cómo vas» y las barras del ciclo. Las tarjetas con franja llevan una frase: «La franja de arriba es
  tu contexto: fases y hechos de «Tu contexto». Toca un punto para verlo.» (solo cuando hay contexto en el periodo).
- **Una fuente de verdad y caché**: nada se copia. `contextItems` normaliza contexto + eventos una vez por clave de
  revisiones (`epoch|context|races|sessions|hoy`; un hueco; los datos pueden llegar perezosos y solo se leen al
  recalcular); `chartContext` se cachea por perfil + deporte dentro de ese objeto. `progress-ui.chartCtxFor(data,
  perfil, opts)` lo usa con un `dataFromStore()` completo o, sin él, lee el store (un `data` parcial no entra en la
  caché). Sin cambios de esquema ni de versión de la BD; las copias no cambian.
- **Rendimiento** (Chromium, 5 años de pesajes diarios, 20 fases y 20 hechos, mediana de 40 redibujos): `lineChart` del
  peso 4,4–4,5 ms sin contexto y 4,7–5,0 ms con él (+0,3–0,5 ms); montaje de Progreso 66–72 ms frente a 68–76 ms antes
  (ruido). El arranque (Hoy) no carga ni charts.js ni chart-context.js: `npm run perf -- --sets=1y,5y --runs=5` → hoy
  538 / 761 ms, listo 1094 / 1859 ms.
- **Pruebas**: `tests/unit/chart-context.test.mjs` (fases con día/mes/estación abiertas y cerradas, hechos por
  precisión, perfiles, eventos por actividad / contextId / a mano y los que no salen, `ctxLine`, `ctxAria`, caché),
  `tests/unit/charts.test.mjs` (`mergeSegments`, `groupFacts`, preferencia con localStorage que lanza),
  `tests/e2e/chart-context.test.cjs` (Chromium y WebKit: fase, hecho y su globo exacto, tres fases → «Enfermedad ·
  +2», interruptor que se recuerda al navegar y recargar y por clave, carga apagada, globo de una semana, evento con
  tiempo en el ritmo de carrera, modo mujer en #/bodyweight y el análisis, texto al 150 % a 375 px) y pantallas
  `progress-ctx-tip` y `progress-exercise-ctx-tip` en `tests/e2e/visual-guard.test.cjs`.

## 10. Recuperación: evolución de los check-ins (ronda 8, F1–F3)

Los check-ins (sueño, energía, estrés y agujetas de 1 a 3; zonas de 0 a 10) ya se guardaban y el analista los cruzaba
con el rendimiento, pero nada enseñaba **cómo evolucionan**. Ahora hay una pantalla sencilla, sin parte médica, y el
analista dice cuándo algo ha cambiado. Solo lectura: sin cambio de esquema ni de versión de la BD (v3), las copias no
cambian y no se añade ninguna nota general al check-in (solo existe la nota de cada zona).

- **Dónde**: ruta `#/recovery` (pestaña Progreso, «atrás» a `#/progress`, carga diferida: `js/views/recovery.js`).
  Entradas: la fila «Recuperación» de «Cómo vas» (antes iba a `#/analysis?area=recovery`; la cifra y el estado de la
  fila no cambian) y el botón «Ver evolución» de la tarjeta Recuperación de #/analysis.
- **Lógica pura** (`js/recovery-logic.js`, reutiliza `checkin-logic`): `dayValues` (un valor por día y campo: el de
  antes de entrenar y, si falta, el de después, como `checkinFor`; con copias repetidas, la editada más tarde);
  `wellbeingTrend(checkins, hoy, '4w'|'12w'|'all')` → bloques por día (28), por semana (12, de lunes a domingo; la
  última acaba hoy) o, en «Todo», por mes (trimestre si son más de 36 meses; año si ni así cabe: siempre ≤ 36 celdas),
  con la media del periodo (null con menos de 4 días con ese campo) y la del periodo anterior de la misma duración
  (null en «Todo» o con menos de 4 días). «Todo» solo existe si el primer check-in tiene 84 días o más. `zoneTrends`:
  zonas apuntadas en 3 fechas distintas o más del periodo (izquierda y derecha aparte; el mismo día antes y después →
  el máximo), las 6 últimas, la última nota no vacía y `zoneTrend`: media de los 2 últimos − media de los 2 primeros
  mostrados; ≤ −2 → mejorando, ≥ +2 → empeorando, si no, estable. `trendWindows`: últimos 14 días frente a los 42
  anteriores.
- **Analista** (`analysis-training.wellbeingTrendInsights`, llamada desde `analyzeRecovery`; una sola fuente: los
  mismos Insights salen en la tarjeta de #/analysis, en la pantalla nueva, en los puntos clave/«Lo importante» si
  tocan y en el informe para IA, que ya lista `a.all`): `recovery-trend-<sleep|energy|stress|soreness>` solo con ≥ 4
  días con check-in recientes, ≥ 6 en las 6 semanas anteriores y |diferencia| ≥ 0,5 (si no, nada: sin aviso nuevo de
  «faltan datos»). Peor (hacia el valor desfavorable de `FIELDS[].low`) → «Info», prioridad 34 y «Tenlo en cuenta al
  planificar la semana.»; mejor → «Bien», prioridad 18. Frases: «Tu energía ha sido más baja durante las últimas dos
  semanas.», «Has dormido peor…», «Tu estrés ha sido más alto…», «Has tenido más agujetas…» (y sus contrarias) como
  título, y el texto solo con el dato (no repite la frase: la tarjeta y el informe muestran título y texto)
  «Media 1,4 de 3 en 5 días con check-in, frente a 2,2 en las 6 semanas anteriores (11 días).» Confianza: días
  recientes (4/6/10), días de base (6/10/18), baja si la diferencia es < 0,75 y como mucho media («son tus
  valoraciones»). «¿Por qué?» con la regla y «no es un diagnóstico». Modo mujer: nada de esto habla del ciclo ni de
  fases (siguen solo en la tarjeta «Ciclo»); la pantalla no pinta franjas del ciclo. Menores: sin cambios (no hay kcal).
- **Pantalla**: periodo (`segmented` 4 semanas · 12 semanas · Todo, recordado en `localStorage
  'entreno.recovery.period'` con try/catch; «Borrar todo» e importar ya lo limpian por el prefijo `entreno.`); tarjeta
  «Cómo te has sentido» con una fila por campo («Normal · media 2,1 · antes 2,4», texto neutro, sin `deltaTone`) y su
  tira de bloques (`div.rcv-strip[role=img]` con `aria-label` «Energía, 4 semanas: 10 días con check-in, media 1,6
  (normal)», celdas ocultas a VoiceOver con `title`); con menos de 4 días, bloques sin medias y «En estas 4 semanas
  solo hay 2 días con check-in: aún pocos para ver una tendencia.»; «Tendencia reciente» (los `recovery-trend-*` con
  `insightList`, ahora exportada de views/analysis.js; nada si no hay); «Zonas que has apuntado» («Rodilla izq. ·
  molestia», `6 → 5 → 4 → 2`, «Mejorando» / «Estable» / «Empeorando» con `stateTag`, «Último: 6 oct · 4 veces», la
  nota) con el pie fijo que explica la regla y recomienda consultar a un profesional si una molestia sigue o va a más.
  Sin check-ins: estado vacío 🌙 «Aún no hay check-ins» con «Ir a Hoy».
- **Correcciones del diseño**: (1) prefijo CSS `rcv-` en vez de `rc-` (que ya usa Eventos: `.rc-row`, `.rc-opt`…);
  (2) leyenda «Tenue = bajo · intenso = alto» en vez de «Claro = bajo»: con el tema oscuro, la celda más «clara» es la
  del valor alto; (3) con la app totalmente vacía Progreso no muestra «Cómo vas» (solo aparece con alguna sesión o
  pesaje), así que la prueba del estado vacío entra desde Progreso con pesajes y sin check-ins (y la guarda visual abre
  `#/recovery` con la app vacía); (4) el campo del Insight se llama `field` (no `key`) para no confundirlo con otras
  claves; (5) se añade el cubo «año» por si «Todo» no cabe ni en 36 trimestres.
- **Rendimiento** (Node, 5 años: 2 088 check-ins): `trendWindows` 0,24 ms (lo único que se añade a `buildAnalysis`);
  la pantalla calcula `wellbeingTrend` + `zoneTrends` en 3–6 ms. El arranque no carga ninguno de los dos módulos nuevos.
- **Pruebas**: `tests/unit/recovery-logic.test.mjs` (datos escasos, periodos y cubos, antes/después, zonas y su regla,
  ventana de 14/42 días), `tests/unit/analysis-training.test.mjs` (insight con confianza baja y media, mínimos, estrés
  a la baja = «Bien»), `tests/unit/analysis.test.mjs` (modo mujer: área recuperación, sin ciclo/fase/regla, fuera de
  «Ciclo»), `tests/unit/overview.test.mjs` (`href '#/recovery'`), `tests/e2e/recovery.test.cjs` (Chromium y WebKit:
  vacío desde Progreso, tiras de 28 y 12, el periodo se recuerda, insight con confianza y «¿Por qué?», zona que
  mejora con su nota, el mismo insight en #/analysis y «Ver evolución», 150 % a 375 px) y pantallas `recovery` y
  `recovery-12w` en `tests/e2e/visual-guard.test.cjs` (con `seedRealistic({ recovery: true })`: estrés y zonas que se
  repiten; sin la opción los datos son los de siempre).

## 11. Puesta a punto contextual (ronda 8, G)

Evento de prioridad A o B cerca → una bajada de carga se lee como **compatible con una puesta a punto**, no como pérdida
de forma. Interpretar, no planificar: nunca cambia el nivel, nunca recomienda nada ni da un porcentaje de taper.

- **Ya resuelto antes de este bloque** (verificado): ninguna bajada de carga salía en ámbar (`load-warn`/`runkm-warn`
  solo saltan con subidas; `load`, `load-ok` y los chips del resumen son neutros en una bajada; «Lo importante» mira la
  semana en curso, donde no se calcula bajada).
- **Una sola regla** (`js/races-logic.js`, puro): `TAPER_DAYS = 28` y `taperRace(list, from, today)` → el evento A/B
  con `from ≤ date ≤ from + 28` y `date ≥ today` (ya pasado, fuera), el más cercano y, a igual fecha, A antes que B
  (`byPrio`, compartido con `nextRelevant`); los C no cuentan. `taperText(race, today)` → «Compatible con una puesta a
  punto antes del 10K del domingo.» (nombre o tipo con artículo, «de hoy» · «de mañana» · «del domingo» a 2–6 días ·
  «del 25 oct» a 7 o más). `racesContext(...)` añade `taper: { race, days } | null` (aditivo): el analista lo conoce
  en `analysis.context.events.taper`. `outcomePrompt` comparte con ella `raceRef` (sin cambios de texto).
- **Panel semanal** (`js/insights.js`): `data.races` es opcional (lo trae `views/weekly.js · weeklyData`;
  `dataFromStore` no cambia, así Progreso no lee nada más). Ancla = `ctx.ref` (el domingo en una semana terminada).
  Solo en una semana terminada, con referencia suficiente, carga > 0 y bajada que supera `loadWarn.low` con el mismo
  redondeo que el aviso de subida, en espejo (−20 % exacto no; −20,5 % sí). Entonces «Carga semanal» (id `load`, sigue
  `neutral`) añade la frase, `tag: 'Puesta a punto'`, la fila «Evento próximo» del «¿Por qué?» («10K · mié 14 oct ·
  10 km · Prioridad A · en 7 días»), la regla y `taper: { raceId, days }`. Sin carga (−100 %) no: es un parón. Una
  bajada extrema sigue siendo solo informativa.
- **Corrección del diseño**: el % de carga ahora usa un decimal también cerca de −`low` (antes «−20 %» junto a una
  regla «baja más de un 20 %» con −20,3 % real); afecta a «Carga semanal» y «Sin avisos de carga» con o sin evento.
  La fila «Evento próximo» usa el nombre o la etiqueta corta («10K»), no `raceTitle` («10 km · … · 10 km»).
- **Informe para IA** (`js/analysis-report.js · loadSection`): con `context.events.taper`, «- Evento A en 10 días: 10K,
  el 12 oct. Una bajada de carga en estas semanas es compatible con una puesta a punto: no la interpretes como pérdida
  de forma ni de constancia.» («hoy» / «mañana» a 0 y 1 días). En condicional: no calcula nada. La caché del análisis ya
  depende de la fecha y de `races`.
- **Fuera de alcance, a propósito**: semanas antiguas mirando atrás tras la carrera (evento pasado → como siempre),
  enfermedad o lesión (la frase dice «compatible», no «es») y el insight `load-sport` del analista (no trata las
  bajadas como negativas).
- Sin datos nuevos, sin subir la versión de la BD, copias sin cambios; sin archivos nuevos de la app ni CSS nuevo salvo
  dos reglas de texto grande en css/weekly.css (PULIDO §25). Modo mujer y menores no se ven afectados (no hay kcal).
- **Rendimiento**: `taperRace` es O(eventos) una vez por render del panel. Arranque de Hoy (CPU ×4, mediana de 5):
  1y listo 1015 ms (antes 1062), 5y 1768 ms (antes 1856): ruido.
- **Pruebas**: `tests/unit/races.test.mjs` (taperRace: 10/28/29 días, C, pasado, A antes que B, ancla antigua;
  taperText; outcomePrompt igual; racesContext.taper y analysisContext), `tests/unit/insights.test.mjs` (A a 10 días:
  neutro, etiqueta, frase, fila, regla, sin avisos; sin evento / C / pasado / a 29 días → idéntico; −20 % y −20,5 %,
  carga 0, subida, umbral editado, −70 %, semana en curso, «Lo importante»), `tests/unit/analysis-report.test.mjs`
  (línea en CARGA con A y con B mañana; sin evento, C, pasado o a 29 días → CARGA idéntica),
  `tests/e2e/taper.test.cjs` (Chromium y WebKit con `seedRealistic`: tarjeta neutra «Puesta a punto», frase, fila,
  chip de Carga neutro; esta semana sin frase; sin el evento «Info»; 150 % a 375 px con el «¿Por qué?» abierto y los
  chips del resumen dentro de su ficha) y pantalla `weekly-taper` en `tests/e2e/visual-guard.test.cjs`. Todas las
  unitarias y la E2E fallan con el código anterior.

## 12. Sesiones largas (ronda 8, H)

Con 9–12 ejercicios costaba ver qué estaba hecho, qué faltaba y cómo saltar. Solución mínima, sin pantalla nueva ni
lista aparte: lo terminado se pliega solo, cada tarjeta dice su estado y el centro de la barra de la sesión salta al
siguiente pendiente.

- **Antes de este bloque** (verificado en el código): una tarjeta hecha solo llevaba borde verde y ✓; no había plegado,
  ni «en curso», ni salto. `scrollToNext` iba siempre al índice + 1 (aunque estuviera hecho) y no movía el cursor.
- **Lógica pura** (`js/session-logic.js`): `listBlocks(exercises)` (un ejercicio suelto o una superserie/circuito de 2
  o más seguidos con el mismo `groupId`; `renderList` pinta con esto: una sola definición de grupo), `itemState` /
  `itemStates` ('pending' | 'progress' | 'done'; fuerza: todas las series hechas; cardio: alguna actividad enlazada),
  `foldedKeys(session, states, { editing, override })`, `nextPendingIndex(states, from)` (con vuelta),
  `jumpTarget(states, cursor, cursorVisible)` y `foldedSetCount(se)`. `renderCard` usa `itemState` en lugar de su
  cálculo propio (antes un ítem de cardio con su carrera registrada nunca salía como hecho; ahora sí, con su ✓).
- **Cuándo se pliega**: solo en una sesión en curso y en momentos naturales, nunca bajo el dedo: a los 350 ms de
  terminar un ejercicio (primero se ve el ✓ con la tarjeta abierta), al saltar y al volver a pintar la lista (montar,
  recargar, mover/añadir/quitar, deshacer). Un bloque terminado no se pliega si tiene el cursor, un editor abierto
  («Hecha · editando») o el usuario lo desplegó a mano. Dentro de una superserie o un circuito se pliega el grupo
  entero, nunca un ejercicio suelto. En una sesión terminada (editar) nada se pliega.
- **Una sola fuente**: lo plegado sale de los datos (series hechas, actividades enlazadas y `session.cursor`, que ya
  existía y se guarda); lo desplegado o plegado a mano vive solo en memoria (`ctx.override`). Tras recargar se ve igual
  sin guardar nada nuevo. Sin datos nuevos, sin subir la versión de la BD, copias sin cambios.
- **Al terminar un ejercicio** (`scrollToNext`): el cursor pasa al siguiente **pendiente** (con vuelta al principio) y
  se guarda; se pliega lo terminado y la tarjeta de destino sube (`revealCard`: con su «Registrar» por encima de la
  barra). El foco pasa a ella solo si seguía en la terminada (se mira antes de plegar). Si no queda nada pendiente, nada
  se mueve: la última tarjeta queda abierta con su ✓ y «Terminar» está en la barra.
- **Estados visibles sin más alto**: pendiente, como siempre; en curso, «2/4» discreto en la cabecera (`.ses-prog`,
  con «2 de 4 series hechas» para VoiceOver); hecho, la línea plegada (✓, nombre, «3 series» —hechas sin
  calentamientos; en cardio, el resumen de la actividad—, ⌄) o, desplegada, el borde verde y la cabecera como botón
  con ⌃. Grupo plegado: «SUPERSERIE A · 2 ejercicios · 6 series ✓». La tarjeta lleva `data-state`.
- **«Siguiente pendiente»**: el centro de la barra de la sesión (`button.fb-status.fb-next`, 44 px) con ⌄ junto a
  «En sesión» (con texto grande, junto a «n/N»). Destino: la tarjeta del cursor si no está hecha y no se ve; si no, el
  siguiente pendiente después del cursor, con vuelta. Cada toque mueve el cursor: tocar seguido recorre todos. Sin
  pendientes queda desactivado, sin ⌄ y sin atenuar. VoiceOver: «En sesión. Siguiente pendiente: Remo con barra. 12 de
  30 series hechas.» (la etiqueta se actualiza al desplazar, una vez por fotograma como mucho).
- **Vista** (`js/views/session.js`): `renderBlock` (tarjeta, línea plegada o grupo, con `data-block` y
  `data-folded`), `applyFolds` (sustituye **solo** los bloques que cambian; las demás tarjetas no se repintan, cada una
  consulta su historial), `toggleFold` (foco de vuelta al botón del bloque nuevo), `revealCard`, `jumpToPending`.
  `rerenderCard` de una tarjeta plegada (o dentro de un grupo plegado) recurre a `renderList`. Tarjetas:
  `renderFoldedCard`, `renderFoldedGroup`, `renderGroupHead` en `js/session-view-card.js`; `revealWarm` pasa a ser
  `reveal(el)` (opacidad y −6 px, 220 ms, nada con «reducir movimiento») y se usa también al desplegar.
- **Correcciones del diseño**: (1) el ⌄ va junto a «En sesión» y no junto a «n/N series»: a 375 px «2/20 series ⌄» no
  cabía sin partirse (la guarda de la barra lo detecta); con texto grande, donde «series» se oculta, va junto a n/N.
  (2) «2/4» lleva el texto para VoiceOver en un `sr-only`, no en `aria-label` de un `span` (que VoiceOver no lee
  fiable). (3) El chevron cambia de icono (⌄/⌃) en vez de girar: el bloque se vuelve a pintar entero al plegar, así que
  no hay transición que hacer. (4) Con «reducir movimiento» la app ya deja las transiciones CSS en 0,01 ms (la cabecera
  compacta al desplazar las crea), así que `document.getAnimations().length === 0` no es cierto en ninguna pantalla:
  la prueba exige que no haya ninguna animación visible (> 1 ms) ni ninguna Web Animation (`reveal`).
- **Pruebas**: `tests/unit/session-fold.test.mjs` (itemState, itemStates, listBlocks, foldedKeys, nextPendingIndex,
  jumpTarget, foldedSetCount); `tests/e2e/session-long.test.cjs` (Chromium y WebKit, `seedRealistic` + sesiones de 4,
  8 y 12 ejercicios: plegado con foco y cursor, recarga, desplegar/editar/«Listo»/plegar con el foco, superserie,
  circuito, recorrido de pendientes con vuelta y botón desactivado, salto a un pendiente y no al índice + 1, nada
  plegado sin nada hecho ni en una sesión terminada, «reducir movimiento», 375 × 667 al 150 %) y pantalla
  `session-long` en `tests/e2e/visual-guard.test.cjs`. Con el código anterior fallan la unitaria (no existen las
  funciones) y las cuatro E2E; con solo `scrollToNext` devuelto al índice + 1 falla «no salta a una tarjeta hecha».
- Modo mujer y menores no se ven afectados (no hay kcal). Sin archivos nuevos de la app.

## Propietarios en esta ronda
| Parte | Archivos |
|---|---|
| senderismo | seed.js (ACTIVITY_KINDS y tipos), activity.js, activity-logic.js, css/activity.css, stats.js, backup.js, history-logic.js, views/history.js, views/today.js, pickers.js, insights.js, goals-logic.js, views/goals.js, charts.js (COLORS), views/progress.js (km/carga por deporte), plan*.js si hace falta |
| importación | js/import-*.js (nuevos), views/import.js, css/import.css, views/settings.js (botón en Copias y datos) |
| calentamiento | session-logic.js, session-view-card.js, views/session.js, css/session.css |
| predicciones | js/race-predict.js (nuevo), views/predictions.js, css/predictions.css |
| resúmenes | js/summary-logic.js (nuevo), views/summary.js, css/summary.css, views/weekly.js y sección weekly de css/weekly.css |
| mapa corporal | js/bodymap.js (nuevo), css/bodymap.css, tests/fixtures/bodymap.html |
| transiciones | js/router.js, js/ui.js, css/app.css, js/app.js (sin tocar la tabla de rutas), index.html |
