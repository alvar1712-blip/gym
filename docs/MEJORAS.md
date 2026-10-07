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
- `checkTarget(data, distanceKm, targetSec)` → `{ verdict:'probable'|'ajustado'|'hoy_no'|'insuficiente', prediction,
  gapSec, why }`: objetivo ≥ `high` → probable; dentro del rango → ajustado; < `low` → hoy no (con cuánto falta).
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
