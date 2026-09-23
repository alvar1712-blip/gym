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
| `js/insights.js`, `js/goals-logic.js`, `js/views/weekly.js`, `js/views/goals.js`, `css/weekly.css` | Fase 3: panel semanal, check-in, objetivos | panel |

**Regla de propiedad:** cada módulo solo edita SUS archivos. Los archivos del núcleo son de solo lectura para
los módulos; si necesitas un cambio en el núcleo, impleméntalo localmente en tu módulo y descríbelo en tu
informe final (`coreRequests`). Puedes crear archivos nuevos propios (p. ej. `js/<modulo>-logic.js`), pero
entonces **añádelos a `ASSETS` en `sw.js`** (única excepción permitida de edición del núcleo: añadir líneas a
`ASSETS`) y comprueba con `node scripts/check-assets.mjs`.

---

## 2. Rutas (definidas en `js/app.js`)

Cada vista exporta funciones `mountX(root, params)`; `root` es un `<div>` vacío; `params` = parámetros de ruta
+ query (`#/activity/new?kind=run&date=2026-09-23` → `{kind:'run', date:'2026-09-23'}`). Puede devolver una
función de limpieza (se llama al salir). Puede ser `async`.

| Hash | Módulo · export | Qué muestra |
|---|---|---|
| `#/today` | today · `mountToday` | Lo que toca hoy (1 toque para empezar), sesión en curso, aviso de copia, accesos rápidos (cardio, peso), mini semana |
| `#/calendar?week=YYYY-MM-DD` | calendar · `mountCalendar` | Semana (lunes–domingo) con plan y estado de cada día; navegar semanas |
| `#/day/:date` | calendar · `mountDay` | Detalle de un día: plan, sesiones, cambiar/mover/sustituir/marcar, registrar sesión pasada |
| `#/history` | history · `mountHistory` | Lista de todas las sesiones (fuerza + actividades), filtrable |
| `#/session/:id` | session · `mountSession` | Registro de fuerza (activa o edición de una pasada) |
| `#/session/:id/summary` | session · `mountSessionSummary` | Resumen al terminar (récords, volumen, series, carga) |
| `#/activity/new?kind=run\|bike\|swim\|other&date=&parent=&item=&planDate=` | activity · `mountActivity` | Formulario de actividad nueva |
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
| `#/progress` | progress · `mountProgress` | Fase 2 |
| `#/progress/exercise/:id` | progress · `mountExerciseProgress` | Fase 2 |
| `#/records` | progress · `mountRecords` | Fase 2 |
| `#/weekly?week=` | weekly · `mountWeekly` | Fase 3 |
| `#/goals`, `#/goal/new`, `#/goal/:id` | goals · `mountGoals` / `mountGoalEdit` | Fase 3 |

Navegación: `import { navigate, back, refresh } from '../router.js'`. `navigate('#/x')` apila; `back(fallback)`
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
- `{ id:'app', createdAt, seedVersion, schema }`
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
{ id, kind:'strength'|'run'|'bike'|'swim'|'other', date:'YYYY-MM-DD', planDate:'YYYY-MM-DD'|null,
  templateId|null, templateName, status:'active'|'done', startedAt|null, endedAt|null,
  durationMin|null, rpe:1..10|null, notes:'', parentId|null, templateItemId|null, createdAt, updatedAt,
  // fuerza
  exercises:[SessionExercise], cursor:number,
  // actividades (todas opcionales salvo kind, date y duración)
  distanceKm, movingSec, elapsedSec, elevationM, hrAvg, hrMax, cadence, powerAvg, powerNp,
  subtype (run: z2|intervals|tempo|long|race; bike: easy|route|intervals|trainer; other: basketball|agility|mobility|sport|<texto>),
  feel:'' (zona / sensaciones), poolType:'pool'|'open', poolLengthM, stroke }
SessionExercise = { id, exerciseId, exName (copia del nombre), templateItemId|null, alternatives:[ids],
  target:{sets, setsMax, repMin, repMax, timeMin, timeMax, distance}, notes, section, groupId, groupType,
  sets:[SetEntry] }
SetEntry = { id, type:'warmup'|'effective'|'failure'|'drop', weight|null, reps|null, repsR|null,
  rir: 0..5 | 'F' | null, timeSec|null, distanceM|null, heightCm|null, note:'', done:bool, doneAt|null }
```
- Actividades: `durationMin = movingSec / 60` (se guarda también `durationMin`). `status:'done'` siempre.
- Una actividad registrada desde un ítem de cardio de una plantilla lleva `parentId` (sesión de fuerza) y
  `templateItemId`. Cuenta para km, ritmos y récords de resistencia y para la carga de su tipo. Al terminar la sesión
  padre, la duración propuesta de la fuerza = tiempo transcurrido − duración de las actividades enlazadas (editable),
  para no contar dos veces la carga.
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

### bodyweight (`id` = fecha): `{ id:'YYYY-MM-DD', kg, createdAt, updatedAt }` (un valor por día; el último manda)
### checkins: `{ id, date, timing:'pre'|'post', sessionId|null, sleep:1|2|3|null, energy:1|2|3|null, soreness:1|2|3|null, createdAt }` (1 bajo, 2 normal, 3 alto)
### goals: `{ id, kind:'strength'|'endurance'|'bodyweight', title, exerciseId?, weight?, reps?, sport?, distanceKm?, timeSec?, targetKg?, createdAt, achievedAt|null, archived }`

---

## 4. Estados del calendario (`js/plan.js`)

`effectiveDay(date)` = excepción de `plan` si existe, si no la semana tipo vigente. `dayStatus(date, today)`:
1. Estado manual (`plan[date].status`) si existe.
2. Sesiones que cuentan para el día: `status:'done'`, `(planDate ?? date) === date`, sin `parentId`.
3. Plan `rest`: sin sesiones → `rest`; con sesiones → `done` (entreno extra).
4. Excepción que cambia el plan de la semana tipo (otra plantilla o sesión libre) y hay sesión → `substituted`.
5. Plan plantilla y la sesión es de esa plantilla → `done` si todos los ítems tienen ≥1 serie de trabajo (o actividad
   enlazada), si no `partial`. Sesión de otra plantilla / actividad libre sin excepción → `substituted`.
6. Sin sesiones: fecha < hoy → `skipped`; hoy o futuro → `pending`.

Etiquetas: hecho · hecho parcialmente · sustituido · saltado · descanso · pendiente. Clases CSS `status status-<estado>`.
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
`actionSheet({title, actions:[{label, icon, danger, onClick}]})`, `toast(msg, {actionLabel, onAction, kind})`,
`undoToast(msg, onUndo)`, `stepper({value, step, min, max, decimals, inputmode, suffix, label, showStep, size:'lg'|'md'|'sm', onChange(v,{final})})`,
`segmented({options, value, onChange})`, `chips({options, value, multi, allowNone, onChange})`,
`rpePicker({value, onChange})`, `durationInput({seconds, onChange, showHours, showSeconds})`, `field(label, control, hint)`,
`textInput()`, `numInput()`, `emptyState()`, `whyBox(content)`, `shareFile(file)` → 'shared'|'downloaded'|'cancelled',
`downloadFile(file)`, `pickFile({accept})`, `isStandalone()`, `closeAllSheets()`.
Iconos disponibles: ver `ICON_NAMES` en ui.js. Para deportes usa emojis (`ACTIVITY_EMOJI` en seed.js).

### calc.js
`isWorkSet`, `rirValue`, `e1rm(w, reps, rir)` (Epley con reps+RIR, 1–12 reps), `weightForReps`, `makeBodyweightFn(list, fallback)`,
`setMetrics(set, exercise, bwKg)` → {load, reps, e1rm, volume}, `sessionVolume`, `muscleContrib`, `sessionMuscleSets`,
`weeklyMuscleSets(sessions, weekStart, exMap, settings)`, `sessionDurationMin`, `sessionLoad` (min × RPE),
`pace`, `speed`, `pace100`, `riegel`, `movingAverage(points, 7)`, `linearRegression(xs, ys)`, `dayIndex`,
`lastPerformance(sessions, exerciseId, {excludeSessionId})`, `bestsForExercise`, `addToBests`, `detectPRs`,
`sessionPRs(session, sessions, exMap, bwFn)` → Map(setId → récords), `bestSet`, `weeksBetween`, `orderKeyOf`.
`exMap` puede ser un `Map` o un objeto; construye uno con `new Map(store.all('exercises').map(e => [e.id, e]))`.

### pickers.js
`pickExercise({title, excludeIds, filter, allowCreate, preferIds})` → Promise<id|null>,
`quickCreateExercise(name)`, `pickTemplate({title, includeRest, includeFree})` → Promise<DayPlan|null>.

### session-logic.js
`createStrengthSession({templateId, date, planDate, past})` → sesión guardada (activa, con series prellenadas de la
última vez), `sessionExerciseFromItem(item, session)`, `prefillSets(se, session)`, `newSet(src, se)`.

---

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
- `node scripts/check-assets.mjs` verifica que `sw.js` precachea todos los archivos.
- Antes de terminar, todo lo anterior debe pasar y la consola del navegador no debe tener errores.
