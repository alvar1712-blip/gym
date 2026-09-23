# Fase 2 — Gráficas y récords (contrato)

Requisitos: `docs/REQUISITOS.md` §8 (gráfica de peso corporal) y §9 (progreso, gráficas, récords, adherencia).
Sin librerías: gráficas SVG propias (funcionan sin conexión desde el primer momento y siguen el tema oscuro).

## Propietarios
| Archivo | Propietario |
|---|---|
| `js/charts.js`, `css/progress.css` (sección «charts») | gráficas |
| `js/stats.js` (+ `tests/unit/stats.test.mjs`) | estadísticas |
| `js/views/progress.js`, `css/progress.css` (resto), hueco `.bw-chart-slot` de `js/views/bodyweight.js` | progreso |

## `js/charts.js` (DOM, sin store)

```js
export const PERIODS = [
  { id: '4w', label: '4 sem' }, { id: '3m', label: '3 meses' }, { id: '6m', label: '6 meses' },
  { id: '1y', label: '1 año' }, { id: 'all', label: 'Todo' },
];
export function periodStart(periodId, today = todayStr(), firstDate = null) // 'YYYY-MM-DD' | null (all → firstDate)
export function getPeriod(key = 'global') / setPeriod(key, id)            // recordado en localStorage (try/catch)
export function periodSelector({ value, onChange })                        // → HTMLElement (segmentado)

export function lineChart(container, opts) → { update(opts), destroy() }
// opts = {
//   series: [{ id, label, color, points: [{ x:'YYYY-MM-DD', y:number, label?:string }],
//              line?:true, dots?:bool, width?:2, dashed?:false, emphasis?:false }],
//   height: 200, yFormat: (v)=>string, xDomain?: [from, to], yMin?, yMax?, zeroBased?: false,
//   invertY?: false,               // p. ej. ritmo: menos es mejor → arriba
//   band?: { min, max, label },    // franja horizontal (rango objetivo)
//   empty: 'Sin datos en este periodo', ariaLabel: '…' }

export function barChart(container, opts) → { update(opts), destroy() }
// opts = {
//   bars: [{ x:'YYYY-MM-DD' | 'texto', label?:string, segments:[{ key, value, color, label }], tooltip?: string[] }],
//   stacked: true, height: 200, yFormat, xFormat?,
//   band?: { min, max, label } | (bar) => ({min, max}),   // rango objetivo
//   overlay?: { points:[{ x, y }], color, label },        // línea encima (p. ej. media 4 semanas)
//   legend?: [{ key, label, color }], empty, ariaLabel }

export function legend(items) → HTMLElement
export const COLORS = { strength, run, bike, swim, other, accent, info, warn, danger, muted, grid, text }  // hex
```
Reglas: eje X temporal con etiquetas en español (`sep`, `oct`… o `23 sep` en periodos cortos); eje Y con 3–5
marcas «redondas»; **tocar o arrastrar** muestra guía vertical + globo con la fecha y el valor exacto de cada serie
(usa `point.label` si existe, p. ej. «82,5 kg × 5 @1»); tocar fuera lo oculta. `touch-action: pan-y` (el scroll
vertical de la página sigue funcionando). Ancho = el del contenedor (ResizeObserver), sin scroll horizontal.
Casos: 0 puntos (mensaje `empty`), 1 punto, valores iguales, negativos (asistencia), 400+ puntos sin tirones.
`role="img"` + `aria-label`. `destroy()` quita listeners/observers.

## `js/stats.js` (PURO: sin store ni DOM; testeable en Node)

Entrada común `data = { sessions:[], exercises: Map, templates: Map, plan: Map, settings, bodyweight:[], today }`.
Envoltorio en la vista: `dataFromStore()` (lo exporta `js/stats.js` importando el store de forma perezosa NO — lo
construye la vista: `{ sessions: store.all('sessions'), exercises: new Map(store.all('exercises').map(e=>[e.id,e])), … }`).

```js
exerciseHistory(data, exerciseId)          // [{ date, sessionId, templateName, sets (de trabajo), maxWeight, e1rm,
                                           //    bestSet, bestSetLabel, volume, workSets, bw }] asc
exerciseSeries(data, exerciseId, from)     // { maxWeight:[pts], e1rm:[pts], bestSet:[pts], volume:[pts] } (pts = {x,y,label})
strengthRecords(data)                      // [{ exerciseId, name, logType, bestWeight:{value,date,sessionId,label},
                                           //    bestE1rm:{…}, repsAtWeight:[{weight,reps,date,sessionId}], maxTime?, maxHeight?,
                                           //    bestSprint?: { [distanceM]: {timeSec,date,sessionId} } }]
enduranceRecords(data)                     // { run:{ longest, best:{ '5k','10k','half','marathon' } }, bike:{longest}, swim:{longest} }
                                           //   best.X = { timeSec, date, sessionId, fromKm, estimated } con sesiones de distancia ≥ X
                                           //   (tiempo = movingSec × X / distanceKm, «estimado a ritmo medio» si distanceKm > X·1,02)
weeklySeries(data, from, to)               // [{ week, strengthVolume, loadTotal, load:{strength,run,bike,swim,other},
                                           //    km:{run,bike,swim}, runPace, bikeSpeed, muscleSets:{m:n}, sessions }]
muscleWeekly(data, muscleId, from, to)     // [{ week, sets }] ; target = settings.muscleTargets[m]
runPaceSeries / bikeSpeedSeries / swimPaceSeries(data, from)   // pts por actividad
bodyweightSeries(data, from)               // { daily:[pts], ma:[pts], trend:{ ok, kgPerWeek, reason } }
adherenceSeries(data, from, to)            // [{ week, planned, completed, done, partial, substituted, skipped }]
```
Reglas: solo sesiones `status:'done'`; series de trabajo (`calc.isWorkSet`), nunca calentamientos ni pendientes;
1RM Epley con reps+RIR y solo 1–12 reps (`calc.e1rm`), siempre rotulado como estimación; carga = min × RPE
(`calc.sessionLoad`) para TODAS las actividades; semanas de lunes (`util.weekStart`); ritmo medio semanal ponderado
por distancia; km de natación desde `distanceKm`.

## Vistas (`js/views/progress.js`)
- `#/progress` (raíz de pestaña): selector de periodo global; tarjetas con: carga semanal total y por tipo (barras
  apiladas + leyenda), volumen semanal de fuerza, series por músculo (chips de músculo → barras semanales con la franja
  del rango objetivo; y tabla «esta semana» de todos los músculos frente a su rango), km semanales por deporte, ritmo
  medio de carrera y velocidad media de bici en el tiempo, peso corporal (diario + media 7 días), adherencia
  (planificadas frente a hechas por semana), acceso a Récords y lista buscable de ejercicios con historial →
  `#/progress/exercise/:id`. Hueco al principio `<div class="progress-extra"></div>` para la Fase 3.
- `#/progress/exercise/:id`: KPIs, gráficas de peso máximo, 1RM estimado (con la nota «estimación»), mejor serie
  (globo «80 kg × 6 @2»), volumen, e historial completo en lista (toca → sesión). Tipos sin carga: tiempo máx.,
  altura máx., mejor tiempo por distancia.
- `#/records`: fuerza (mejor peso, mejor 1RM estimado, mejores reps a cada peso) y resistencia (mayor distancia, 5 km,
  10 km, media, maratón —marcando «estimado a ritmo medio»—, mayor distancia en bici y natación).
- `#/bodyweight`: gráfica en `.bw-chart-slot` con selector de periodo.
