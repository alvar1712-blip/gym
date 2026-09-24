# Fase 3 — Panel semanal, check-in y objetivos (contrato)

Requisitos: `docs/REQUISITOS.md` §10 (panel semanal), §11 (check-in), §12 (objetivos) y el criterio de §15
«Cada sugerencia del panel muestra su "¿Por qué?" con los datos concretos que la generan».
Principio del usuario: **información primero, sugerencias después, siempre explicando el porqué**; tono informativo,
directo, sin alarmismo ni frases motivacionales vacías. Todos los umbrales salen de `settings` (editables en
`#/settings/thresholds`).

## Propietarios
| Archivo | Propietario |
|---|---|
| `js/insights.js` (+ `tests/unit/insights.test.mjs`), `js/views/weekly.js`, `css/weekly.css` (sección weekly), integración en `js/views/today.js` (hueco `.today-extra`) y `js/views/progress.js` (hueco `.progress-extra`) | panel |
| `js/goals-logic.js` (+ `tests/unit/goals.test.mjs`), `js/views/goals.js`, `css/weekly.css` (sección goals) | objetivos |
| `js/checkin.js` (+ tests), integración en la sesión (`js/views/session.js` / `js/session-view-*.js`) | check-in |

## Mensaje (forma común de información y sugerencias)
```js
{ id, section: 'info' | 'suggestion', level: 'neutral' | 'good' | 'warn',
  title: 'Espalda por debajo del rango',            // corto
  text:  '9 series esta semana; tu rango es 14–22.', // una o dos frases, datos concretos
  why: { rule: 'Texto de la regla con los umbrales actuales…',
         data: [{ label: 'Remo con pecho apoyado', value: '3 series × 1 = 3' }, …] },
  items?: [...] }                                     // p. ej. filas de una tabla de músculos
```
`why` es OBLIGATORIO en todos los mensajes (criterio de aceptación). La vista lo muestra con `ui.whyBox()`.

## `js/insights.js` (PURO; entrada `data` como en Fase 2: `{ sessions, exercises: Map, templates: Map, plan: Map, settings, bodyweight, checkins, today }`)
`weeklyInsights(data, weekStart)` → `{ week, inProgress, daysLeft, info: Message[], suggestions: Message[] }`
Usa `js/stats.js` y `js/calc.js` (no dupliques cálculos).

INFORMACIÓN (en este orden):
1. **Series efectivas por músculo** esta semana frente al rango (`settings.muscleTargets`), con comparación con la
   semana anterior (`items` = una fila por músculo con series, rango, estado debajo/dentro/encima y Δ). Semana en curso:
   indicar «a falta de N días» y no dar por «debajo» lo que aún puede completarse (texto prudente).
2. **Músculos por debajo / por encima** del rango (mensajes separados si los hay) y comparación con la semana anterior.
3. **Equilibrio empuje/tirón**: series de patrones push (push_h, push_v) frente a pull (pull_h, pull_v) (con
   secundarios según factor). Con la prioridad de espalda, lo deseable es tirones ≥ empujes → level good/warn.
4. **Carga semanal** total y por tipo (fuerza, carrera, bici, natación, otras) y variación % frente a la media de las
   4 semanas previas (si hay menos de 2 semanas previas con datos: «sin referencia suficiente»).
5. **Kilómetros semanales** por deporte y variación frente a la semana anterior y a la media de 4 semanas.
6. **Ejercicios que progresan, se mantienen o se estancan**: por ejercicio con ≥ 3 sesiones, 1RM estimado de la mejor
   serie por sesión. Estancado = sin superar su mejor 1RM estimado previo en las últimas `stall.sessions` sesiones o en
   las últimas `stall.weeks` semanas (con ≥ 2 sesiones en ese tramo). Progresa = nuevo mejor en ese tramo. Se mantiene
   = el resto. `why.data` = las cifras de 1RM por sesión.

SUGERENCIAS (en este orden):
1. **Doble progresión** por ejercicio (última sesión de cada ejercicio con rango de reps): si TODAS las series
   efectivas (tipo efectiva/al fallo/drop, no calentamientos) llegaron al TOPE del rango (`target.repMax`) con RIR ≥
   `progression.minRir` → «Sube X kg» con X = `increments.upperCompound` (compuesto tren superior), `lowerCompound`
   (compuesto tren inferior) o `isolation` (aislamiento/core; texto «1–2 kg» si es 1). Peso corporal: «añade lastre o
   reduce asistencia (±X kg)». Si no: «Mantén el peso y busca más repeticiones» (agrupar en un único mensaje con la
   lista para no saturar). `why` con las series concretas (peso × reps @RIR) y el rango.
2. **Aviso orientativo de carga**: si la carga de la semana supera la media de las 4 previas en más de `loadWarn.low` %
   (aviso suave) o `loadWarn.high` % (aviso). **Km de carrera**: si suben más de `runKmWarn.low` / `runKmWarn.high` %
   frente a la semana anterior (solo si la semana anterior tuvo ≥ `runKmWarn.minBaseKm` km). Redactado como aviso
   prudente, NUNCA como predicción de lesión.
3. **Semana de descarga**: se sugiere solo si coinciden (a) ≥ `deload.minStalled` ejercicios estancados, (b) RPE medio de
   las sesiones de las últimas `deload.weeks` semanas ≥ `deload.rpeHigh`, y (c) si hay check-ins en ese periodo, que
   predominen los bajos (sueño o energía bajos, o agujetas altas en ≥ la mitad). Si no coinciden, un mensaje neutral
   «Sin señales de necesitar descarga» con el estado de cada condición en `why`.

## `js/views/weekly.js`
`#/weekly?week=YYYY-MM-DD` (back `#/progress`): navegación de semanas, título «Semana 21–27 sep», bloque
**INFORMACIÓN** y después bloque **SUGERENCIAS**, claramente separados; cada mensaje con su «¿Por qué?».
Exporta `weeklySummaryCard()` (tarjeta breve para Hoy y Progreso: 2–3 mensajes clave + «Ver panel semanal»).

## Check-in (`js/checkin.js`)
Opcional y saltable, 3 toques: **sueño, energía y agujetas**, cada uno Bajo · Normal · Alto (1/2/3). Store
`checkins` `{ id, date, timing:'pre'|'post', sessionId|null, sleep, energy, soreness, createdAt }` (uno por día y
momento; se edita). `checkinCard({ date, timing, sessionId, compact })` → HTMLElement (guardado al instante, botón
«Omitir»/ocultar). Se usa: en la sesión de fuerza (tarjeta plegable arriba «¿Cómo llegas?» = pre; en la hoja de
terminar = post) sin añadir toques obligatorios (empezar sigue siendo 1 toque) y en Hoy. Solo se usa como contexto en
el panel y en la sugerencia de descarga.

## Objetivos (`js/goals-logic.js`, puro; `js/views/goals.js`)
Tipos: fuerza `{exerciseId, weight, reps}` («Remo 80 kg × 5»), resistencia `{sport, distanceKm, timeSec}` («10 km en
menos de 45 min»; también solo distancia) y peso corporal `{targetKg}`.
`goalProgress(data, goal)` → `{ status: 'achieved'|'insufficient'|'no_trend'|'estimate', current, target,
progressPct, eta: { from, to } | null, method, dataUsed: [...], explanation }`:
- Fuerza: objetivo como 1RM estimado equivalente (`calc.e1rm(weight, reps, 0)`); actual = mejor 1RM estimado reciente;
  conseguido si existe una serie con peso ≥ objetivo y reps ≥ objetivo desde que se creó. Estimación = regresión lineal
  del mejor 1RM estimado por sesión en las últimas 12 semanas.
- Carrera: predicción con **Riegel** (`calc.riegel`, exponente 1,06) desde carreras recientes (≥ 3 km), la mejor
  predicción por semana; tendencia de esas predicciones → fecha en que cruzaría el objetivo.
- Peso corporal: tendencia de la media móvil de 7 días (misma que `#/bodyweight`).
- Solo con datos suficientes: ≥ `settings.goals.minRecords` registros abarcando ≥ `settings.goals.minWeeks` semanas; si
  no, «datos insuficientes». Pendiente ≤ 0 (o en contra) → `no_trend` («con la tendencia actual no se acerca»).
- La estimación es SIEMPRE un **rango de fechas** (p. ej. pendiente ± 1 error típico, con un mínimo de ±20 %), nunca una
  fecha exacta, y la vista explica que **el progreso no es lineal y que la estimación se recalcula con cada registro**.
Vista `#/goals` (lista con barra de progreso, rango de fechas y «¿Por qué?» con los datos usados), `#/goal/new` y
`#/goal/:id` (crear/editar/archivar/borrar con deshacer). Exporta `goalsSummaryCard()` para Hoy y Progreso.
