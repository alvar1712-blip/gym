# Entreno — arquitectura y contrato entre módulos

PWA sin compilación (HTML + CSS + ES modules nativos) para iPhone/Safari, instalada en la pantalla de inicio.
Sin servidor, sin cuentas, sin IA. Datos en IndexedDB. Se publica tal cual en GitHub Pages (subruta `/gym/`,
así que **todas las rutas son relativas**: nunca `/js/...`, siempre `js/...` o `./`).

Este documento es el **contrato**. Los requisitos completos del usuario están en `docs/REQUISITOS.md` (texto original).

---

## 1. Mapa de archivos y propietarios

| Archivo | Qué es | Propietario |
|---|---|---|
| `index.html`, `manifest.json`, `sw.js`, `icons/*` | Shell PWA, precaché offline | núcleo |
| `css/app.css` | Sistema de diseño común (tokens, botones, listas, hojas, stepper…) | núcleo |
| `js/app.js` | Arranque, **tabla de rutas**, barra de pestañas, SW, reanudar sesión activa | núcleo |
| `js/router.js` | Router por hash | núcleo |
| `js/db.js` | IndexedDB (stores con keyPath `id`) | núcleo |
| `js/store.js` | Estado en memoria + escritura inmediata | núcleo |
| `js/util.js` | Fechas locales, números es-ES, duraciones, colecciones | núcleo |
| `js/ui.js` | `h()`, iconos, cabecera, hojas, confirmaciones, toasts/deshacer, stepper, chips, RPE, duración, compartir archivos | núcleo |
| `js/calc.js` | Cálculos puros: 1RM, métricas de serie, series por músculo, carga, ritmos, media móvil, regresión, Riegel, récords | núcleo |
| `js/pickers.js` | `pickExercise()`, `quickCreateExercise()`, `pickTemplate()` | núcleo |
| `js/seed.js` | Constantes (MUSCLES, PATTERNS, LOG_TYPES…), `defaultSettings()`, **SEED_EXERCISES**, **SEED_TEMPLATES** | seed |
| `js/session-logic.js`, `js/views/session.js`, `css/session.css` | Registro de fuerza | sesión |
| `js/views/activity.js`, `js/views/bodyweight.js`, `css/activity.css` | Cardio, natación, otras, peso corporal | actividad |
| `js/plan.js`, `js/views/today.js`, `js/views/calendar.js`, `js/views/history.js`, `css/calendar.css` | Semana tipo, calendario, estados, Hoy, historial | calendario |
| `js/views/templates.js`, `js/views/exercises.js`, `css/library.css` | Plantillas y biblioteca | biblioteca |
| `js/views/settings.js`, `js/backup.js`, `css/settings.css` | Ajustes, copias JSON, CSV, borrado | ajustes |
| `js/charts.js`, `js/stats.js`, `js/views/progress.js`, `css/progress.css` | Fase 2: gráficas y récords | progreso |
| `js/insights.js`, `js/views/weekly.js`, `css/weekly.css` (sección weekly) | Fase 3: panel semanal | panel |
| `js/goals-logic.js`, `js/views/goals.js`, `css/weekly.css` (sección goals) | Fase 3: objetivos | objetivos |
| `js/checkin-logic.js`, `js/checkin.js` (estilos `.ci-*` en `css/session.css`) | Fase 3: check-in (ronda 6: estrés y zonas) | check-in |
| `js/context-logic.js`, `js/views/context.js`, `js/approx-input.js`, `css/context.css` | Ronda 6: tu contexto y el campo de fecha aproximada | contexto |
| `js/past-records-logic.js`, `js/views/past-records.js` (estilos `.pr-*` en `css/progress.css`) | Ronda 6: marcas históricas | progreso |
| `js/confidence.js`, `js/analysis-context.js` | Ronda 6: confianza común y contexto del análisis | analista |
| `js/analysis-hybrid.js` | Ronda 6: carga por deporte, volumen con contexto, asociaciones personales, agujetas por ejercicio | analista |
| `js/races-logic.js`, `js/races-progress.js`, `js/views/races.js` (estilos `.rc-*` en `css/progress.css`) | Ronda 6: eventos deportivos | progreso |
| `js/analysis-cache.js` | Ronda 6: caché en memoria del análisis (contadores de revisión del store) | analista |

**Regla de propiedad:** cada módulo solo edita SUS archivos. Los archivos del núcleo son de solo lectura para
los módulos; si necesitas un cambio en el núcleo, impleméntalo localmente en tu módulo y descríbelo en tu
informe final (`coreRequests`). Puedes crear archivos nuevos propios (p. ej. `js/<modulo>-logic.js`), pero
entonces **añádelos a `ASSETS` en `sw.js`** (única excepción permitida de edición del núcleo: añadir líneas a
`ASSETS`) y comprueba con `node scripts/check-assets.mjs`.

**Versión del service worker:** `VERSION` de `sw.js` sale del contenido (hash de todos los `ASSETS` y del propio
`sw.js`); no se edita a mano. Tras cualquier cambio en la app, y siempre antes de publicar, ejecuta
`node scripts/stamp-sw.mjs` (o `npm run stamp`): si `VERSION` no cambia, los iPhone que ya tienen la app instalada
no reciben la versión nueva. `check-assets.mjs` falla si `VERSION` no corresponde al contenido. Cada versión usa su
propia caché (`entreno-<VERSION>`); el SW nunca reescribe la caché de la versión activa (si llegara un `sw.js`
distinto con la misma `VERSION`, la instalación falla y la versión actual sigue intacta). La versión nueva se
ofrece con un aviso fijo «Hay una versión nueva · Actualizar» en las pantallas raíz de las pestañas; solo recarga
cuando el usuario lo pulsa.

---

## 2. Rutas (definidas en `js/app.js`)

Cada vista exporta funciones `mountX(root, params)`; `root` es un `<div>` vacío; `params` = parámetros de ruta
+ query (`#/activity/new?kind=run&date=2026-09-23` → `{kind:'run', date:'2026-09-23'}`). Puede devolver una
función de limpieza (se llama al salir). Puede ser `async`.

| Hash | Módulo · export | Qué muestra |
|---|---|---|
| `#/today` | today · `mountToday` | Lo que toca hoy (1 toque para empezar), sesión en curso, aviso de copia, accesos rápidos (cardio, peso), mini semana; al final (Fase 3) check-in de hoy, resumen del panel semanal y objetivos |
| `#/calendar?week=YYYY-MM-DD` | calendar · `mountCalendar` | Semana (lunes–domingo) con plan y estado de cada día; navegar semanas |
| `#/day/:date` | calendar · `mountDay` | Detalle de un día: plan, sesiones, cambiar/mover/sustituir/marcar, registrar sesión pasada |
| `#/history` | history · `mountHistory` | Lista de todas las sesiones (fuerza + actividades), filtrable |
| `#/session/:id` | session · `mountSession` | Registro de fuerza (activa o edición de una pasada) |
| `#/session/:id/summary` | session · `mountSessionSummary` | Resumen al terminar (récords, volumen, series, carga) |
| `#/activity/new?kind=run\|bike\|swim\|hike\|other&date=&parent=&item=&planDate=&subtype=` | activity · `mountActivity` | Formulario de actividad nueva (`subtype` preelige el tipo de sesión, p. ej. «Ruta» al registrar la ruta en bici del plan) |
| `#/activity/:id` | activity · `mountActivity` | Editar actividad |
| `#/bodyweight` | bodyweight · `mountBodyweight` | Peso corporal: registro rápido + lista (+ gráfica en fase 2) |
| `#/exercises?seg=library\|templates` | exercises · `mountExercises` | Pestaña Ejercicios: segmentado **Rutinas / Biblioteca** |
| `#/exercise/:id` | exercises · `mountExerciseDetail` | Ficha: músculos, patrón, tipo, historial |
| `#/exercise/new`, `#/exercise/:id/edit` | exercises · `mountExerciseEdit` | Crear / editar ejercicio |
| `#/templates` | templates · `mountTemplates` | Lista de plantillas (también embebible, ver §7) |
| `#/template/:id` | templates · `mountTemplateEdit` | Editor de plantilla |
| `#/settings` | settings · `mountSettings` | Ajustes (índice) |
| `#/settings/week` | settings · `mountWeekPattern` | Editor de la semana tipo |
| `#/settings/thresholds` | settings · `mountThresholds` | Umbrales de reglas |
| `#/settings/data` | settings · `mountData` | Copias, CSV, almacenamiento, borrar todo |
| `#/progress` | progress · `mountProgress` | Accesos (Panel semanal, Objetivos, Resúmenes, Predicciones, Récords, Peso, Ejercicios), resúmenes del panel y de objetivos (Fase 3), gráficas por periodo |
| `#/progress/exercise/:id` | progress · `mountExerciseProgress` | Fase 2 |
| `#/records` | progress · `mountRecords` | Fase 2 |
| `#/weekly?week=YYYY-MM-DD` | weekly · `mountWeekly` | Panel semanal (cualquier día de la semana; por defecto la actual): INFORMACIÓN y después SUGERENCIAS, cada mensaje con «¿Por qué?» (back `#/progress`) |
| `#/goals` | goals · `mountGoals` | Objetivos activos (barra, rango de fechas, «¿Por qué?»); conseguidos y archivados plegados |
| `#/goal/new?kind=&exercise=`, `#/goal/:id` | goals · `mountGoalEdit` | Crear (con borrador) / editar al instante, archivar, borrar con confirmación + deshacer |
| `#/import` | import · `mountImport` | Ronda 4: importar actividades desde GPX, TCX, FIT (.gz, .zip), vista previa editable y duplicados |
| `#/predictions` | predictions · `mountPredictions` | Ronda 4: tiempos previstos 5k/10k/media/maratón (estimación actual, rango probable y ritmo; «todavía poco fiable» sin datos suficientes) y «¿Puedo hacerlo?» (back `#/progress`) |
| `#/summary?p=month\|year&d=YYYY-MM-DD` | summary · `mountSummary` | Ronda 4: resumen mensual / anual con comparación con el periodo anterior |
| `#/analysis` | analysis · `mountAnalysis` | Ronda 5: «tu analista» (peso, fuerza, resistencia, recuperación, ciclo, próximas semanas) + «Copiar informe para tu IA» |
| `#/cycle` | cycle · `mountCycle` | Ronda 5 (modo mujer): anillo del ciclo, registro de días y síntomas, calendario, historial, «Cómo te afecta», alertas |
| `#/settings/profile` | settings · `mountProfile` | Ronda 5: sexo, objetivo, experiencia y (mujer) ciclo y anticonceptivo; ronda 6: fecha de nacimiento, otros objetivos, deportes, días por semana y molestias |
| `#/context` | context · `mountContext` | Ronda 6: «Tu contexto» (fases y hechos, también anteriores a la app, con fecha aproximada): lo vigente y el historial |
| `#/context/new?kind=phase\|event&type=`, `#/context/:id` | context · `mountContextEdit` | Ronda 6: añadir / editar / borrar (con deshacer) |
| `#/welcome` | welcome · `mountWelcome` | Ronda 6: bienvenida de 3 pasos para perfiles nuevos (nunca se abre sola) |
| `#/records/past` | past-records · `mountPastRecords` | Ronda 6: marcas históricas por ejercicio con «Rendimiento actual ≈ N % de tu mejor marca histórica» (back `#/records`) |
| `#/records/past/new?exercise=`, `#/records/past/:id` | past-records · `mountPastRecordEdit` | Ronda 6: añadir / editar / borrar (con deshacer) una marca |

Pestaña resaltada: la de la ruta; las rutas de sesión y actividad (`inherit` en la tabla) mantienen la pestaña
desde la que se abrieron (p. ej. Calendario › Historial › sesión), salvo una sesión de fuerza en curso, que es de «Hoy».

Navegación: `import { navigate, back, refresh, replaceUrl } from '../router.js'` (`replaceUrl(hash)` cambia la URL sin
volver a montar la vista). `navigate('#/x')` apila; `back(fallback)`
vuelve dentro de la app (en modo standalone de iOS no hay botón atrás del navegador: **toda pantalla que no sea
raíz de pestaña debe llevar botón atrás** vía `header({back:'#/fallback'})`). `refresh()` vuelve a montar la vista
actual conservando el scroll (úsalo tras cambios estructurales; para cambios pequeños actualiza el DOM a mano).

Al arrancar, si existe una sesión de fuerza `status:'active'`, la app abre `#/session/:id` directamente.

---

## 3. Modelo de datos (IndexedDB `entreno`, todas las stores con keyPath `id`)

Fechas de calendario: **siempre** cadenas locales `'YYYY-MM-DD'` (usa `util.todayStr()`, `util.addDays()`…; nunca
`toISOString().slice(0,10)`). Instantes: milisegundos (`Date.now()`). Semanas: empiezan en **lunes**
(`util.weekStart()`); `dow()` devuelve 0 = lunes … 6 = domingo. Números en UI: coma decimal (`fmtNum`, `parseNum`).

### meta
- `{ id:'app', createdAt, seedVersion, schema, seedComplete }` (la carga inicial —meta, ejercicios y rutinas— se escribe en una sola transacción)
- `{ id:'settings', ...defaultSettings() }` — ver `seed.js`. Claves principales:
  - `weekPatterns: [{ from:'YYYY-MM-DD', days:[7 × DayPlan] }]` — vigencias de la semana tipo (la vigente para una
    fecha es la de mayor `from` ≤ fecha). Cambiar la semana tipo **añade** una vigencia con `from = lunes de la semana
    actual` (no reescribe el pasado).
  - `DayPlan = { kind:'template', templateId } | { kind:'rest' } | { kind:'free', label, activityKind }`
  - `muscleTargets: { muscleId: [min, max] }`, `primaryFactor` (1), `secondaryFactor` (0,5)
  - `increments: { upperCompound:2.5, lowerCompound:5, isolation:1 }`, `progression.minRir` (1)
  - `loadWarn: {low:20, high:30}` (%), `runKmWarn: {low:10, high:15}` (%)
  - `stall: {sessions:3, weeks:3}`, `deload: {minStalled:3, rpeHigh:8, weeks:2}`, `goals: {minRecords:4, minWeeks:3}`
  - `csv: {excel:true}` (true → `;` y coma decimal + BOM, para Excel en español)
  - `lastBackupAt` (ms | null), `backupReminderDays` (7), `bodyweightDefault` (75)

### exercises
```
{ id, name, aliases:[], primary:[muscleId], secondary:[muscleId], pattern, logType,
  category:'compound'|'isolation', region:'upper'|'lower'|'core'|'full', sport?:'run'|'bike'|'swim',
  notes:'', custom:bool, archived:bool, createdAt, updatedAt }
```
- `logType`: `weight_reps` | `bodyweight` (peso = lastre, negativo = asistencia) | `unilateral` (reps = izquierda,
  repsR = derecha, mismo peso) | `time` (timeSec, peso opcional) | `distance_time` (distanceM + timeSec) |
  `jumps` (reps, heightCm opcional) | `cardio` (no tiene series: en una sesión abre el formulario de actividad; `sport`
  indica el tipo).
- Ejercicios con historial no se borran: se **archivan** (`archived:true`, ocultos en selectores). Solo se borran de
  verdad si no se usan en ninguna sesión ni plantilla (con confirmación + deshacer).

### templates
```
{ id, name, order, notes:'', archived:false, items:[TemplateItem], createdAt, updatedAt }
TemplateItem = { id, exerciseId, alternatives:[exerciseId], sets, setsMax?, repMin?, repMax?,
                 timeMin?, timeMax? (segundos; en cardio = duración objetivo), distance? (m),
                 notes:'', section:'' (p. ej. 'Bloque potencia'), groupId:null|string, groupType:null|'superset'|'circuit' }
```
Texto del objetivo: `3×4–6`, `2–3×30 m`, `3×30–45 s`, `30–45 min`, `2×8/lado` (unilateral).
Superserie/circuito: ítems consecutivos con el mismo `groupId`; se muestran agrupados (A1, A2…).

### sessions (fuerza Y actividades en la misma store)
```
{ id, kind:'strength'|'run'|'bike'|'swim'|'hike'|'other', date:'YYYY-MM-DD', planDate:'YYYY-MM-DD'|null,
  templateId|null, templateName, status:'active'|'done', startedAt|null, endedAt|null,
  durationMin|null, rpe:1..10|null, notes:'', parentId|null, templateItemId|null, createdAt, updatedAt,
  // fuerza
  exercises:[SessionExercise], cursor:number,
  templateItemIds?:[itemId],  // ítems de la plantilla al crear la sesión (estado del día, ver §4)
  durationAuto?:boolean,      // la duración es la propuesta automática: se recalcula si cambian las actividades enlazadas
  durationDraft?:number,      // borrador de la hoja «Terminar» mientras está activa (se borra al terminar)
  // actividades (todas opcionales salvo kind, date y duración)
  distanceKm, movingSec, elapsedSec, elevationM, hrAvg, hrMax, cadence, powerAvg, powerNp,
  subtype (run: z2|intervals|tempo|long|race; bike: easy|route|intervals|trainer; other: basketball|agility|mobility|sport|<texto>),
  feel:'' (zona / sensaciones), poolType:'pool'|'open', poolLengthM, stroke,
  // senderismo (ronda 4): elevationM = desnivel +, elevationLossM = desnivel −, altMaxM, packKg (mochila)
  elevationLossM, altMaxM, packKg,
  // importadas (ronda 4): startedAt (ms, hora de inicio del archivo) y source:{ type:'gpx'|'tcx'|'fit', fileName }
  source }
SessionExercise = { id, exerciseId, exName (copia del nombre), templateItemId|null, alternatives:[ids],
  target:{sets, setsMax, repMin, repMax, timeMin, timeMax, distance}, notes, section, groupId, groupType,
  sets:[SetEntry] }
SetEntry = { id, type:'warmup'|'effective'|'failure'|'drop', weight|null, reps|null, repsR|null,
  rir: 0..5 | 'F' | null, timeSec|null, distanceM|null, heightCm|null, note:'', done:bool, doneAt|null,
  origWeight? }  // peso prellenado antes del primer cambio (herencia de peso); se borra al confirmar y al terminar
```
- Actividades: `durationMin = movingSec / 60` (se guarda también `durationMin`). `status:'done'` siempre.
- Una actividad registrada desde un ítem de cardio de una sesión de fuerza lleva `parentId` (id de la sesión de
  fuerza), `parentItemId` (id del SessionExercise de cardio) y `templateItemId` (el de ese SessionExercise, si
  tiene). La sesión de fuerza muestra en ese ítem las actividades con `parentId === session.id && parentItemId === se.id`.
  Se abre con `#/activity/new?kind=<sport>&date=<fecha sesión>&parent=<session.id>&item=<se.id>`; al guardar, la
  actividad hereda `date` y `planDate` de la sesión padre y vuelve atrás (a la sesión). Cuenta para km, ritmos y récords de resistencia y para la carga de su tipo. Al terminar la sesión
  padre, la duración propuesta de la fuerza = tiempo transcurrido − duración de las actividades enlazadas (editable),
  para no contar dos veces la carga. Si se acepta la propuesta (`durationAuto`), registrar, editar o borrar después
  una actividad enlazada la recalcula (`syncLinkedDuration`).
- Series **pendientes** (`done:false`) son las prellenadas aún no confirmadas; no cuentan para nada. Al terminar la
  sesión se descartan (avisando).
- Calentamientos (`type:'warmup'`) no cuentan para volumen, series semanales ni récords (`calc.isWorkSet`).
- Solo puede haber UNA sesión de fuerza `active` a la vez.

### plan (excepciones del calendario; `id` = fecha)
```
{ id:'YYYY-MM-DD', kind?:'template'|'rest'|'free', templateId?, label?, activityKind?, status?:null|'done'|'partial'|'skipped'|'rest', note?, updatedAt }
```
Solo existe si el usuario modificó ese día. **Modificar un día concreto nunca toca `weekPatterns`.**
`kind` ausente → se usa el de la semana tipo (el registro solo guarda un estado manual).

### cycle (ronda 5, IndexedDB v2; `id` = fecha): `{ id:'YYYY-MM-DD', flow:'none'|'spotting'|'light'|'medium'|'heavy', symptoms:[ids], notes, ended?, auto?, createdAt, updatedAt }`
### context, pastRecords, races (ronda 6, IndexedDB v3) — ver `docs/MEJORAS6.md` («Fase A — modelo de datos»)
- `context`: fases `{ id, kind:'phase', type, start:Approx, end:Approx|null, text, notes, goalIds, sports }` y hechos
  `{ id, kind:'event', type, date:Approx, text, notes, kg? }`; `Approx = { date:'YYYY-MM-DD', precision:'day'|'month'|'season'|'year' }`.
  Lógica pura en `js/context-logic.js` (`normalizeEntry` sanea al leer; `contextOn`, `recentChanges`, `timeline`).
- `pastRecords` (fase B, marcas históricas manuales, aparte de los récords de `stats.js`): `{ id:'pr_…', exerciseId, weight,
  reps, rir:0–5|null, date:Approx|null, beforeApp, bodyweightKg|null, note, createdAt, updatedAt }`. `weight` en kg
  (unilateral: por lado; peso corporal: lastre, 0 = sin lastre, negativo = asistencia); `bodyweightKg` solo en ejercicios
  de peso corporal. Lógica pura en `js/past-records-logic.js` (`normalizePastRecord` sanea al leer).
- `races` (eventos deportivos) se crea ya vacío; se usa en la fase E.
- Perfil (`settings.profile`, `js/profile.js`): campos opcionales `birthDate`, `secondaryGoals`, `sports`, `limitations`,
  `weeklyFrequency`, `onboardedAt`; `getProfile` los completa al leer (no se reescriben perfiles antiguos). `ageGroup`:
  `minor` (< 18) · `adult` · `senior` (≥ 65) · `unknown` (sin fecha).
- Copia JSON: `format: 2` (acepta 1 y 2; una de formato 1 deja vacíos los almacenes nuevos).
### bodyweight (`id` = fecha): `{ id:'YYYY-MM-DD', kg, createdAt, updatedAt }` (un valor por día; el último manda)
### checkins: `{ id:'ci_…', date, timing:'pre'|'post', sessionId|null, sleep:1|2|3|null, energy:1|2|3|null, stress?:1|2|3|null, soreness:1|2|3|null, areas?:Area[], createdAt, updatedAt }` (1 bajo, 2 normal, 3 alto)
Ronda 6 (fase B): `stress` y `areas` son opcionales (los check-ins antiguos no los tienen y no se reescriben).
`Area = { id:'ar_…', kind:'muscle'|'joint', zone, side:'left'|'right'|'both'|null, level:0–10, note }`: `zone` es un id de
`seed.MUSCLES` (agujetas, en el mapa corporal) o de `JOINTS` (molestia o dolor: cuello, hombro, codo, muñeca, zona
lumbar, cadera, rodilla, tobillo, pie, otra). Una por clase, zona y lado. `soreness` 1–3 sigue siendo el indicador
general (no se convierte a 0–10). El check-in «bajo» no cambia: sueño o energía bajos o agujetas altas (el estrés y las
zonas se guardan y se muestran; las fases C y D decidirán cómo usarlos).
Uno por día y momento (si hay duplicados manda el editado más reciente). Sin ningún valor se elimina. «Omitir» no
guarda check-in: marca `session.checkinDismissed = {pre?, post?}` y la clave de `localStorage`
`entreno:checkin-omitido:<fecha>:<momento>` (así tampoco se ofrece en Hoy ese día). Al cambiar la fecha de una
sesión, sus check-ins van con ella (`moveSessionCheckins`).
### goals: `{ id:'goal_…', kind:'strength'|'endurance'|'bodyweight', title, titleAuto, createdAt, updatedAt, achievedAt:'YYYY-MM-DD'|null, archived, …campos del tipo }`
Campos por tipo (solo se guardan los del suyo): fuerza `exerciseId, weight, reps`; resistencia `sport:'run'|'bike'|'swim',
distanceKm` (km también en natación), `timeSec|null` (null = solo distancia); peso corporal `targetKg, direction:'up'|'down'`.
`titleAuto:true` → el título sigue a los datos. `achievedAt` = fecha del registro que lo consiguió; la lista y la tarjeta
resumen lo resincronizan con el cálculo (editar el objetivo o borrar esa sesión puede devolverlo a activo).

---

## 4. Estados del calendario (`js/plan.js`)

`effectiveDay(date)` = excepción de `plan` si existe, si no la semana tipo vigente. `dayStatus(date, today)`:
1. Estado manual (`plan[date].status`) si existe.
2. Sesiones que cuentan para el día: `status:'done'`, `(planDate ?? date) === date`, sin `parentId`.
3. Plan `rest`: sin sesiones → `rest`; con sesiones → `done` (entreno extra).
4. Plan de plantilla (semana tipo, cambiado o movido) → `done`/`partial` según lo registrado de ESA plantilla: un ítem
   está cubierto por ≥1 serie de trabajo, una actividad enlazada o, si es de cardio, una actividad suelta del mismo
   deporte ese día (cada actividad cubre un ítem); si no hay nada de esa plantilla → `substituted`.
5. Sesión libre: si sustituye una rutina de la semana tipo (p. ej. D6 → ruta en bici) → `substituted`; en la semana
   tipo o planificada en un día de descanso → `done` si el tipo coincide, si no `substituted`.

Los ítems que cuentan no dependen de `template.updatedAt`: son la instantánea opcional `session.templateItemIds` o,
sin ella, los que la sesión conoce más los que ya existían al crearla (instante codificado en el id de `uid()`).
6. Sin sesiones: fecha < hoy → `skipped`; hoy o futuro → `pending`.

Firma real: `dayStatus(date, ctx)` con `ctx = ctxFromStore()` (construye el ctx UNA vez por render y reutilízalo).
Estado adicional `none` («sin registro»): días anteriores al primer uso de la app (`ctx.since`), que no cuentan en la
adherencia. `weekPlan(ws, ctx)` devuelve por día `{date, plan, status, manual, reason, extra, sessions}`.
`adherence(ws, ctx)` → `{planned, done, partial, substituted, skipped, pending, completed, extra, pct}`;
`adherenceText(a)` → «3 de 5 hechas · 1 parcial».
Etiquetas: hecho · hecho parcialmente · sustituido · saltado · descanso · pendiente · sin registro. Clases CSS `status status-<estado>`.
Adherencia semanal = días planificados (no descanso) frente a días con `done`/`partial`/`substituted`.

---

## 5. API del núcleo (resumen; ver JSDoc en cada archivo)

### store.js (lectura SÍNCRONA; escritura inmediata)
`init()`, `get(store,id)`, `all(store)`, `count(store)`, `settings()`, `exercise(id)`,
`exercisesList({includeArchived})`, `templatesList()`, `sessionsList()` (desc), `activeSession()`, `bodyweightList()` (asc),
`save(store,obj)` → Promise (en disco al resolver; la memoria se actualiza al instante),
`saveSoon(store,obj,ms=250)` (para escritura al teclear; `flush()` se llama al ocultar la app),
`remove(store,id)` → objeto eliminado, `restore(store,obj)` (deshacer), `saveSettings(patch)`,
`exportData()`, `validateBackup(obj)`, `importData(obj)` (atómico), `wipeAll()`, `backupOverdue()`,
`persistStatus()`, `requestPersist()`, `on('change'|'reset'|'error', fn)` → unsubscribe.
**Muta el objeto obtenido con get() y pásalo a save()**; no hace falta clonar.

### ui.js
`h(tag, attrs, ...children)` (tag admite clases `'div.card.row'`; attrs: `class`, `style`, `dataset`, `onClick`…,
`value`/`checked`/`disabled` como propiedad, `html`, `text`), `icon(name, size)`, `header({title, subtitle, back, actions})`,
`screen(root, headerOpts)` → contenedor `.content`, `sheet({title, body, actions, onClose, tall})`,
`confirmDialog({title, message, confirmText, danger, requireText})` → Promise<bool>, `promptDialog()`,
`actionSheet({title, actions:[{label, icon, danger, onClick}]})`, `toast(msg, {actionLabel, onAction, kind, duration, closeOnNavigate})`,
`undoToast(msg, onUndo)` (los avisos con acción se cierran al cambiar de pantalla; uno mostrado justo después de
`navigate()`/`back()` pertenece a la pantalla de destino y sigue visible allí), `stepper({value, step, min, max, decimals, inputmode, suffix, label, showStep, size:'lg'|'md'|'sm', onChange(v,{final})})`,
`segmented({options, value, onChange})`, `chips({options, value, multi, allowNone, onChange})`,
`rpePicker({value, onChange})`, `durationInput({seconds, onChange, showHours, showSeconds})` (no recorta: 75 min =
4500 s; al salir del campo normaliza a 1 h 15 min), `field(label, control, hint)`,
`textInput()`, `numInput()`, `emptyState()`, `whyBox(content)`, `shareFile(file)` → 'shared'|'downloaded'|'cancelled'
('downloaded' solo si el navegador no puede compartir archivos; con la hoja ya abierta —doble toque— o sin permiso
del sistema devuelve 'cancelled' y no descarga nada: no des la copia por hecha),
`downloadFile(file)`, `pickFile({accept})`, `isStandalone()`, `closeAllSheets()`.
Iconos disponibles: ver `ICON_NAMES` en ui.js. Para deportes usa emojis (`ACTIVITY_EMOJI` en seed.js).

### calc.js
`isWorkSet`, `rirValue`, `e1rm(w, reps, rir)` (Epley con reps+RIR, 1–12 reps), `weightForReps`, `makeBodyweightFn(list, fallback)`,
`setMetrics(set, exercise, bwKg)` → {load, reps, e1rm, volume}, `sessionVolume`, `muscleContrib`, `sessionMuscleSets`,
`weeklyMuscleSets(sessions, weekStart, exMap, settings)`, `sessionDurationMin`, `sessionLoad` (min × RPE),
`pace`, `speed`, `pace100`, `riegel`, `movingAverage(points, 7)`, `linearRegression(xs, ys)`, `dayIndex`,
`lastPerformance(sessions, exerciseId, {excludeSessionId})`, `bestsForExercise`, `addToBests`, `detectPRs`,
`sessionPRs(session, sessions, exMap, bwFn)` → Map(setId → récords), `bestSet`, `weeksBetween`, `orderKeyOf`.
Récords: solo si hay historial ANTERIOR a la sesión (`bests.prior`, lo fija `bestsForExercise`; `addToBests` lo deja
igual): en la primera sesión con un ejercicio no hay récords aunque una serie supere a otra del mismo día. En peso
corporal, el récord de 1RM compara con el peso corporal del día (si solo sube el peso corporal, no es récord).
`bestSet`: por 1RM; tiempo → más larga; saltos → más alta; distancia+tiempo → más rápida.
`exMap` puede ser un `Map` o un objeto; construye uno con `new Map(store.all('exercises').map(e => [e.id, e]))`.

### plan.js (contrato mínimo, lo usa Ajustes)
`patternFor(settings, date)` → days[7], `setWeekPattern(days)` (nueva vigencia desde el lunes de esta semana),
`currentPattern()`. El módulo de calendario añade el resto (effectiveDay —devuelve también `emoji`—, dayStatus, weekPlan,
adherence, overrideDay, swapDays, setManualStatus, resetDay…) e `idTime(id)` (instante codificado en un id de `uid()`,
o null).

### views/bodyweight.js (contrato, lo usa Hoy)
`bodyweightQuickEntry({onSaved})` → HTMLElement (tarjeta de registro rápido de peso).

### pickers.js
`pickExercise({title, excludeIds, filter, allowCreate, preferIds})` → Promise<id|null>,
`quickCreateExercise(name)`, `pickTemplate({title, includeRest, includeFree})` → Promise<DayPlan|null>.

### session-logic.js
`createStrengthSession({templateId, date, planDate, past})` → sesión guardada (activa, con series prellenadas de la
última vez), `sessionExerciseFromItem(item, session)`, `prefillSets(se, session)`, `newSet(src, se)`,
`lastFor(se|exerciseId, session)` y `lastPerformanceFor(sessions, se, session)` (última vez; distinguen ejercicios
repetidos como Sprint 20 m / 30 m), `syncLinkedDuration(sessionId)` → `{from, to}|null` (recalcula la duración
automática de la fuerza de una sesión terminada; lo llama el formulario de actividad al guardar o borrar una enlazada),
`formatSet(set, logType, {kg, rir})` (formato de una serie, también en la ficha del ejercicio) y
`targetText` = `library-logic.targetText` (mismo texto de objetivo en plantilla, sesión, Hoy y actividad).

### Fase 3 (contrato detallado en `docs/FASE3.md`)
Entrada común de la lógica pura: `data` = `progress-ui.dataFromStore(today)` + `checkins` (`weekly.weeklyData(today)` lo
construye). Umbrales, siempre de `data.settings` (`#/settings/thresholds`).

**`insights.js` (puro)** — `weeklyInsights(data, weekStart?)` → `{ week, weekEnd, today, ref, inProgress, future,
daysLeft (hoy incluido), hasHistory, beforeHistory, firstDate, info: Message[], suggestions: Message[] }` (semana
futura, anterior al primer registro o sin datos → listas vacías).
`Message = { id, section:'info'|'suggestion', level:'neutral'|'good'|'warn', tag?, title, text, why:{ rule, data:[{label,
value, sub?}] }, items?:[{label, value, …}], …extras }`; `why.rule` y `why.data` nunca vacíos.
- Info, en orden: `muscles` (fila por músculo: series, rango, estado, Δ), `muscles-below`, `muscles-above`, `push-pull`
  (series por patrón, 1 por serie, sin aislamientos), `load` (total y por tipo frente a la media de las 4 previas;
  < 2 semanas previas → «sin referencia suficiente»), `km` (por deporte, frente a la anterior y a la media de 4),
  `ex-progress` / `ex-maintain` / `ex-stalled` (≥ `MIN_SESSIONS` = 3 sesiones con 1RM estimado) o `ex-none`.
- Sugerencias, en orden: `dp-up-<exerciseId>` (doble progresión: sube X kg / lastre / asistencia, «por lado» en
  unilaterales) y un único `dp-hold` agrupado; `load-warn` y/o `runkm-warn` (`severity:'soft'|'high'`; nunca predicción
  de lesión) o `load-ok`; `deload` (coinciden estancados ≥ `deload.minStalled`, RPE medio de fuerza ≥ `deload.rpeHigh`
  con ≥ `MIN_RPE_SESSIONS` = 2 sesiones, y check-ins bajos ≥ la mitad si los hay) o `deload-none` con el estado de cada
  condición.
- Semana en curso: «a falta de N días», sin Δ negativos de media semana y avisos solo con un umbral ya superado.
- `keyMessages(result, max = 3)` (tarjeta resumen: avisos primero, varios «sube» agrupados en `dp-up-summary`),
  `incrementFor(exercise, increments)`, `isLowCheckin(c)`, `LEVEL_LABEL` (Info / Bien / Atención).

**`views/weekly.js`** — `mountWeekly`, `weeklyData(today?)`, `weeklySummaryCard({ data?, max = 3 })` →
`section.card.wk-summary` (2–3 mensajes clave + «Ver panel semanal») | **null** sin sesiones. Si `data` no trae
`checkins` se le añaden al mismo objeto (conserva la caché de `stats.js`, que va por objeto).

**`goals-logic.js` (puro)** — `goalProgress(data, goal)` → `{ status:'achieved'|'insufficient'|'no_trend'|'estimate',
ready (ya al alcance: `eta` null), statusLabel, current, target, progressPct 0–100|null, eta:{from, to|null, beyond,
…}|null, etaText, method, rule, dataUsed:[{date,label,value}], explanation, warning|null, metric, counts, trend, … }`.
Fuerza: 1RM estimado (Epley) equivalente, tendencia del mejor 1RM por sesión en `TREND_WEEKS` = 12 semanas,
conseguido con una serie ≥ peso y ≥ reps desde su creación. Resistencia: Riegel (1,06) desde sesiones ≥ `MIN_KM`,
la mejor predicción por semana (bici y natación, con aviso); solo distancia → la más larga reciente. Peso corporal:
media móvil de 7 días (misma que `#/bodyweight`). Suficiencia: ≥ `goals.minRecords` registros en ≥ `goals.minWeeks`
semanas distintas (lunes–domingo). ETA siempre rango: pendiente ± 1 error típico con margen mínimo ±20 %; más de 2 años
→ «más de 2 años al ritmo actual». Otras: `goalRules`, `sufficiency`, `etaRange`, `etaText`, `progressPercent`,
`autoTitle`, `validateGoal`, `goalRecord`, `splitGoals` → `{active, achieved, archived}`, `NONLINEAR_NOTE`.

**`views/goals.js`** — `mountGoals`, `mountGoalEdit`, `goalsSummaryCard({ data?, max = 3 })` → `section.card.goal-sum`
(hasta 3 activos y los conseguidos en los últimos 7 días; filas y «Ver todos» → `#/goals`) | **null** sin objetivos.

**`checkin-logic.js` (puro) / `checkin.js` (DOM; reexporta la lógica)** — `checkinCard({ date = hoy, timing:'pre'|'post',
sessionId, compact, open, title, ignoreDismissed, skippable, onChange })` → HTMLElement | **null** (omitido y sin datos).
`compact:false` = franja plegable de 44 px (sesión de fuerza, arriba: no añade toques para registrar); `compact:true` =
las cuatro filas a la vista, 4 toques (hoja «Terminar» y Hoy). Guardado al instante; tocar el valor elegido lo quita.
Debajo, «Agujetas o molestias por zona» (opcional): fichas por zona y «Añadir zona» → `areaSheet({ date, timing,
sessionId, area, onDone })` (mapa corporal en modo elegir, cargado al abrirla, o articulaciones; lado; 0–10; nota).
`checkinSummary({ date, sessionId })` (resumen antes/después, o «Ese día» sin sesión, con zonas y «Editar check-in»),
`checkinEditSheet({ date, sessionId, timings })` (también desde Calendario › día, días pasados incluidos),
`isDismissed` / `setDismissed`, `moveSessionCheckins`, `CHECKIN_HINT`. Lógica: `checkinFor(checkins, date, timing?)`,
`hasValues` (una zona sola cuenta), `isComplete` (las cuatro), `isLowCheckin` (sueño 1, energía 1 o agujetas 3; igual que
en `insights.js`; `LOW_FIELDS`), `summary(checkins, from, to)`, `applyValue`, `checkinText`, `FIELDS`, `TIMINGS`;
zonas: `AREA_KINDS`, `JOINTS`, `SIDES`, `normalizeArea`, `areasOf`, `areaText`, `areaShort`, `levelBand`,
`validateArea`, `upsertArea`, `removeArea`. Mapa corporal: `bodyMap({ legend:false, marks:{id:'none'|'low'|'mid'|'high'},
describe(id), emptyHint })` = modo elegir (sin leyenda ni colores de series); `root.update(data, marks)`.

**Integración.** Hoy (`views/today.js`): tras pintar lo principal («Te toca hoy» y «Empezar» siguen arriba), importa los
módulos de la Fase 3 y rellena `.today-extra` (al final) con: check-in de hoy (`compact`, `pre`; solo si hoy no hay
ninguno ni se ha omitido y no hay ya una fuerza terminada hoy; enlazado a la sesión de hoy en curso), resumen del panel
y de objetivos (cada tarjeta aislada con try/catch; `data-ready="1"` al terminar). Progreso (`views/progress.js`):
accesos «Panel semanal» y «Objetivos» junto a Récords / Peso / Ejercicios y, debajo, `.progress-extra` con las dos
tarjetas (reutilizan el `data` de la pantalla). Sesión de fuerza: franja «¿Cómo llegas hoy?» arriba (solo activa), filas
«¿Cómo ha ido?» en la hoja «Terminar» y resumen del check-in en `#/session/:id/summary`.

---

### Ronda 4 (contrato en `docs/MEJORAS.md`)
- **Senderismo** (`kind:'hike'`, `seed.ACTIVITY_KINDS`): carga propia (min × RPE) y km propios (`km.hike` en
  `stats.weeklySeries`), separado de la carrera; `stats.enduranceRecords().hike = { count, longest, maxGain }`,
  `stats.hikePaceSeries`, `stats.elevationLabel`. Solo la carrera alimenta los avisos de km y las predicciones.
- **Importar** (`#/import`): `import-zip.js` (ZIP propio + `DecompressionStream('deflate-raw'|'gzip')`),
  `import-parse.js` (detección por contenido; GPX/TCX con un parser XML propio para que el mismo código corra en
  Safari y en Node; FIT binario propio: file_id, session, lap, record, sport; métricas: tiempo en movimiento, desnivel
  con histéresis de 3 m, haversine), `import-logic.js` (puro: deporte → kind, registro con
  `activity-logic.buildRecord` + `startedAt` + `source`, duplicados ±2 min / ±3 %). No se guardan puntos GPS.
- **Calentamiento** (`session-logic.js`): `warmupPlan({ workWeight, reps, exercise, settings })` → `[{ pct, weight,
  reps }]`, `suggestedWarmup(se, exercise, settings, last)`, `warmupSetsFromPlan(plan, se, logType)`,
  `warmupIncrement`, `warmupReference`. UI plegada al final de la tarjeta del ejercicio (`session-view-card.js`).
- **Tiempos previstos** (`race-predict.js`, puro): `predictRaces(data, { today }?)`, `checkTarget(data, km, sec)`,
  `analyzeRuns`; Riegel k = 1,06 (hasta 1,10 con poco volumen en media/maratón), rango mínimo ±3 % y máximo ±25 %;
  esfuerzos con ritmo de 2:30 a 20:00 /km (`calc.RUN_PACE_MIN/MAX`; las demás en `suspect`); cada predicción con
  `status` ('ok' | 'tentative' | 'incoherent' | 'invalid'), `usable` y `advice`. Formato estricto en `util.js`:
  `fmtRaceTime`, `fmtPaceKm`, `fmtRaceRange`, `fmtPaceRange` (null si el dato no vale: la vista nunca pinta
  negativos ni «h:mm:ss/km»). `activity-logic.paceWarning` avisa en el formulario de un ritmo de carrera imposible.
- **Resúmenes** (`summary-logic.js`, puro): `periodSummary(data, { unit:'week'|'month'|'year', start, today? })`,
  `summaryHref`, `kindInfo`, `fmtValue`, `fmtKm`; bloque «Resumen de la semana» arriba de `#/weekly`.
- **Mapa corporal** (`bodymap.js`): `bodyMap({ muscles, onSelect?, selected?, label?, compact?, inProgress? })` →
  `div.bm` (con `el.select(id)` y `el.update(muscles)`), `bodyMapData(muscleSets, ranges?)` (acepta `{id:n}`, `Map` o
  filas `stats.muscleTable` / ítems de `insights`). `inProgress`: lo que aún no llega al mínimo sale en gris
  («Faltan series»). Integrado en la tarjeta «Esta semana por músculo» de Progreso y en el mensaje `muscles` del panel.
- **Accesos**: Hoy («Importar desde un archivo»), actividad nueva suelta («Importar desde archivo»), Copias y datos
  («Importar actividades»), Progreso (Resúmenes, Predicciones), Récords › Resistencia › Carrera («Tiempos previstos»),
  panel semanal («Ver mes» / «Ver año»).
- **Transiciones y cristal** (`router.js`, `ui.js`, `css/app.css`): `navigate(hash, { transition:'push'|'pop'|'tab'|'none' })`
  (por defecto `push`; `replace`/`refresh` sin animación; `back()` = `pop`; pestañas = `tab`, o `pop` si se pulsa la
  pestaña actual desde una pantalla interior). Con View Transitions API (Safari 18+) se anima una imagen de la vista
  anterior (una sola vista en el DOM; `::view-transition { pointer-events:none }`, cabecera y barra de pestañas con
  `view-transition-name` propio); sin la API (iOS 17) solo entra la vista nueva (`.view-enter-*`). El tipo va en
  `<html data-nav>`; `router.navInfo()` y `router.settled()` para pruebas; `window.__app.navigate` salta SIN animación.
  Hojas con curva iOS (350 ms) y cierre animado (`.closing` + `inert`; si se abre otra, la vieja se quita al momento);
  respuesta al toque (escala 0,97, 120 ms). Cristal: barra superior, cápsula flotante de pestañas y hojas translúcidas
  (`backdrop-filter: blur() saturate()`, opacidad alta para que nunca se lea el texto de debajo; alternativa opaca con
  `@supports not`); los avisos son opacos. `prefers-reduced-motion` → solo fundidos cortos.

### Ronda 5 (contrato en `docs/MEJORAS5.md`)
- **Perfil** (`settings.profile`, `js/profile.js`): `getProfile`, `isFemale`, `isHormonal`, `cycleEnabled`, `g(p, m, f)`
  (textos en femenino), `profileIncomplete`. Hoy muestra «Completa tu perfil (30 s)» hasta contestar o descartar.
- **Análisis** (puros; «hoy» inyectable; `Insight = { id, area, level, priority, title, text, why:{rule,data}, sources,
  action? }`): `analysis-weight.analyzeWeight(input)` (tendencia EMA ≈ 10 días + Theil–Sen; rangos con signo por
  objetivo/sexo/experiencia; kcal y proteína orientativas; REDs; retención del ciclo; `goalSuggestion`),
  `analysis-training.analyzeStrength / analyzeEndurance / analyzeRecovery`, `analysis.buildAnalysis(data, today)`
  (orquestador: `keyPoints` = 3 de áreas distintas, `forecast`, `errors`), `analysis-report.reportText(a, { includeCycle })`.
  Vista `views/analysis.js` (`analysisData`, `analysisSummaryCard` para Hoy y el panel semanal).
- **Ciclo** (`cycle-logic.js`, puro): `periodsFromDays`, `cycleInfo(days, profile, today)`, `phaseForDate`, `phaseStats`,
  `calendarMarks`, `todayTip`; alertas FIGO (24–38 días, variación), retraso > 7 días, ≥ 90 días sin regla (REDs),
  reglas abundantes (hierro). Con anticonceptivo hormonal no se estiman fases. Vista `views/cycle.js` (`mountCycle`,
  `cycleTodayCard`, `openDaySheet`, `periodStartedToday`, `periodEndedSheet`); marcas en el calendario y bandas en la
  gráfica de peso (`charts.lineChart({ bands, bandsLegend })`).
- **Gestos y fluidez** (`router.js`, `ui.js`, `app.css`): el «atrás» del sistema (borde izquierdo; `hasUAVisualTransition`
  o toque desde ≤ 24 px, o cualquier recorrido del historial no pedido en la app instalada) no anima otra vez; scroll por
  entrada del historial (`__idx → scrollY`, `sessionStorage` `entreno:scroll`, `scrollRestoration = 'manual'`); cada
  hoja tiene su entrada de historial (`router.pushOverlay(onPop) → release`, `overlayDepth()`): «atrás» la cierra;
  `ui.closeStaleSheets()` al cambiar de ruta; arrastrar hacia abajo cierra hojas (`html.sheet-dragging`); efecto
  tarjeta (`html.sheet-card`); `.is-pressed` (JS, sin falsos positivos al hacer scroll) en vez de `:active`
  (`ui.clearPressed()`); títulos grandes que se compactan (`.topbar-root.is-compact`); aparición escalonada
  (`.view-stagger`, solo push); `router.onMount(fn)`; cristal con opacidad 66–78 % y `blur(28px) saturate(190%)`
  (alternativas opacas con `@supports not` y `prefers-reduced-transparency`).

### Ronda 6 (contrato en `docs/MEJORAS6.md`)
- **Confianza** (`confidence.js`, puro): `LEVELS` (`insufficient`, `low`, `medium`, `high`; nunca probabilidades),
  `combine(factors)` → `{ level, label, short, reasons, basis, factors }` (manda el factor más débil), `byCount`,
  `bySpan`, `byNoise`, `capAt`, `insufficient`, `confidenceRow`.
- **Contexto del análisis** (`analysis-context.js`, puro): `analysisContext({ context, sessions, today, profile })` →
  `{ summary, recent, training:{returning, since, source}, creatine, body:{goal}, health, life, usualWeight, age, labels,
  changes }`; `detectReturn(sessions, today)`. `buildAnalysis` lo calcula una vez y lo pasa al peso y a la fuerza;
  `analysisData()` añade `context` y `pastRecords` del store.
- **Insight ampliado**: opcionales `confidence`, `context` (strings) y `parts` ({ observation, interpretation,
  recommendation }); `text` = texto completo (compatibilidad). `analyzeWeight` devuelve además `confidence`, `goal`,
  `goalSource` ('profile'|'phase'), `regain`, `age` y `projectable`; cada fila de `analyzeStrength().exercises` lleva
  `kind` ('recovery'|'new_exercise'|'new_best'|'progress'|'insufficient'), `recovery` y `confidence`.
- **Híbrido** (`analysis-hybrid.js`, puro; fase D): `analyzeHybrid(data, { today, profile, context, strength, endurance })`
  → `{ sportLoad:{rows}, volume:{muscles}, volumeChanges, associations, doms, insights }`; piezas exportadas
  `sportLoad`, `volumeReview`, `volumeChanges`, `personalAssociations`, `domsByExercise`, `compareGroups`,
  `associationConfidence`, `personalInterference`. `buildAnalysis` devuelve `hybrid` y, si `personalInterference`,
  quita `endurance-interference` (`endurance.interferenceBasis = 'personal'`). `areaInsights` mezcla los Insights
  híbridos en fuerza, resistencia y recuperación. `stats.weekPlanOf(data, ws)` = `plan.weekPlan` con el contexto
  cacheado de la adherencia. Vista: tabla `[data-block="sport-load"]` en la tarjeta de Resistencia.
- **Eventos** (fase E): `races-logic.js` (puro, solo util): `RACE_TYPES`, `PRIORITIES`, `normalizeRace(s)`,
  `validateRace`, `raceRecord`, `linkableGoals`, `splitRaces`, `nextRelevant` (Hoy), `todayLine`, `racesContext`
  (analista). `races-progress.js` (puro): `racePrediction` (race-predict) y `linkedGoalProgress` (goalProgress).
  Rutas `#/races`, `#/races/new`, `#/races/:id` (pestaña Progreso). `analysisData()` añade `races`;
  `analysisContext` devuelve `events`. `backup.dataCounts` cuenta `races`.
- **Informe** (fase F): `reportText(analysis, { includeCycle })` (puro) con las secciones de `docs/MEJORAS6.md` › Fase F;
  `SHOWN_IN_SECTIONS(i)` = Insights que ya salen en su sección. `buildAnalysis` añade `wellbeing`
  (`wellbeingSummary(checkins, today, 28)`), `events` (eventos próximos + `racePrediction`) y `goals` (activos).
- **Revisiones y caché** (fase G): `store.revisions()` → `{ epoch, <almacén>: n }` (suben con `save`, `saveSoon`,
  `remove`, `restore`; `epoch` con `init`, `importData`, `wipeAll`; solo en memoria). `dataFromStore()` incluye
  `revisions`. `views/analysis.analysisFor(today, base?)` = `buildAnalysis` con `analysis-cache.createAnalysisCache`
  (clave: fecha, `APP_VERSION`, `ANALYSIS_VERSION`, `epoch` y la revisión de cada almacén); el resultado no se modifica.
  Toda escritura de datos DEBE pasar por esas funciones de `store.js` (ya era así: no hay escrituras directas a `db.js`).
- **Contexto** (`context-logic.js`, puro): fechas aproximadas (`normalizeApprox`, `makeApprox`, `approxFrom/To`,
  `approxLabel`), `contextOn`, `contextSummary`, `weightReferences`, `currentLabel`. Campo de fecha aproximada
  compartido: `approx-input.approxInput({ label, value, today, key, onChange })`.
- **Marcas históricas** (`past-records-logic.js`, puro): `markable(ex)` (peso × reps, unilateral, peso corporal),
  `comparableType(ex)` (con 1RM estimado: no el core de peso corporal), `validatePastRecord(draft, ex, today)`,
  `pastRecordFrom`, `markLabel`, `markWhen`, `markBodyweight(r, env)` (la marca → pesaje ± 14 días alrededor del periodo
  → contexto → último pesaje → `bodyweightDefault`, con `source`), `markEstimate` (calc.setMetrics: Epley con reps +
  RIR, 1–12 reps), `exerciseRecovery({ exercise, marks, history, today, env, days = 28 })` → `{ status:'ok'|
  'no_reference'|'no_current'|'not_comparable', pct, current, reference:{source:'mark'|'app'}, … }` (ahora = mayor 1RM
  estimado de los últimos 28 días; referencia = el mayor entre las marcas y lo registrado antes de esos días),
  `recoveryLine`, `recoveryWhy` (filas y notas del «¿Cómo se calcula?»), `groupByExercise`. Vista
  `views/past-records.js`: `mountPastRecords`, `mountPastRecordEdit`, `pastRecoveryCard(ex, data)` (ficha de progreso) y
  `pastRecordsLink()` (Récords › Fuerza).

## 6. Convenciones de UI (obligatorias)

- Tema oscuro fijo. Usa las variables de `css/app.css` (`--surface`, `--accent`, `--muted`…) y sus componentes
  (`.card`, `.list`/`.list-item`, `.btn .btn-primary|secondary|ghost|danger .btn-lg .btn-block`, `.chip`, `.seg`,
  `.badge-*`, `.kpis/.kpi`, `.banner-*`, `.field`, `.input`, `.stepper`, `.section-title`, `.status-*`).
  Tu CSS propio va en tu archivo `css/<módulo>.css` con clases prefijadas (`.ses-…`, `.cal-…`, `.act-…`, `.lib-…`, `.set-…`).
- Objetivos táctiles ≥ 44 px (botones principales 48–56 px). Una mano: acciones principales abajo o a mano del pulgar.
- Campos numéricos: `<input type="text" inputmode="decimal">` (peso, km) o `inputmode="numeric"` (reps, FC).
  **Nunca `type="number"`** (en iOS con coma decimal falla). Parsear con `parseNum` (acepta `72,5`). Tamaño de fuente
  ≥ 16 px en inputs (si no, iOS hace zoom).
- Todo en español; unidades kg, km, min/km, km/h, min/100 m. Fechas con `fmtDate`.
- Guardado automático: cada cambio se guarda ya (`store.save`) o con `saveSoon` mientras se teclea. No hay botones
  «Guardar» salvo al crear algo nuevo en un formulario (e incluso ahí, conviene guardar borrador).
- Borrados: siempre con confirmación (`confirmDialog`) **o** con deshacer (`undoToast` + `store.restore`); para
  series, ejercicios de sesión y sesiones: deshacer obligatorio. Borrar todo: doble confirmación (`requireText:'BORRAR'`).
- Mensajes informativos, directos, sin alarmismo ni frases motivacionales vacías.
- Seguridad: no uses `innerHTML` con datos del usuario (usa `h()` / `textContent`).
- Pantallas no raíz: `header({ back: '#/ruta-de-vuelta' })`.

---

## 7. Pruebas

- Unitarias (Node, sin navegador): `node --test 'tests/unit/*.test.mjs'`. Los módulos puros (`util`, `calc`, `plan`
  si se hace puro, `stats`, `insights`…) no deben importar `store.js`/`ui.js` para poder testearse.
  (Si tu lógica necesita datos, recibe los datos por parámetro y deja un envoltorio fino que lea del store.)
- E2E (Playwright + Chromium emulando iPhone 13): `NODE_PATH=$(npm root -g) node --test 'tests/e2e/*.test.cjs'`.
  Helpers en `tests/e2e/helpers.cjs`: `openApp()` (servidor propio en puerto libre + contexto nuevo con BD vacía),
  `go(page, '#/ruta')`, `reload(page)`, `storeAll(page, store)`, `idbAll(page, store)` (lee el disco), `shot(page, nombre)`
  (captura en `test-results/`; revísala con la herramienta Read para comprobar el diseño).
  En la página: `window.__app.store` y `window.__app.navigate`.
  Nombra tus pruebas `tests/e2e/<módulo>.test.cjs` y `tests/unit/<módulo>.test.mjs`.
- `node scripts/check-assets.mjs` verifica que `sw.js` precachea todos los archivos y que `VERSION` corresponde al
  contenido (si falla por eso: `node scripts/stamp-sw.mjs`).
- Antes de terminar, todo lo anterior debe pasar y la consola del navegador no debe tener errores.
