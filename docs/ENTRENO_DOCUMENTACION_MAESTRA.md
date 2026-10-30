# Entreno: documentación maestra

Fecha de revisión: **30 de octubre de 2026**. Código de referencia: **`3e27bdebdf1528f260d29c73eca62d901ac63faa`**. Repositorio local revisado: `C:\Users\Usuario\Documents\GitHub\gym`. Esta documentación corresponde a Entreno; Álvar OS es otro proyecto.

Documento de entrada para una conversación nueva: [ENTRENO_INICIO_CHAT.md](ENTRENO_INICIO_CHAT.md). Los enlaces relativos al código y a documentos anteriores se resuelven desde `docs/` en el repositorio; en las copias de Descargas o de este chat, utiliza las mismas rutas dentro de `C:\Users\Usuario\Documents\GitHub\gym`.

## 1. Resumen ejecutivo y alcance de la evidencia

Entreno es una aplicación personal de fuerza y resistencia, instalable como PWA y utilizada principalmente en iPhone. Registra sesiones, actividades y peso; organiza una semana de entrenamiento; calcula progreso, récords, objetivos, recuperación y recomendaciones contextuales. Todo el registro y análisis se ejecuta en el dispositivo. No necesita cuenta, servidor de aplicación, suscripción ni un servicio de IA.

La interfaz usa HTML, CSS y módulos ES de JavaScript, sin compilación ni dependencias de producción declaradas. IndexedDB conserva los registros; un service worker mantiene los recursos para abrir la aplicación sin conexión. Los JSON exportados son la vía de continuidad entre dispositivos. El informe para una IA es texto que el usuario copia y decide compartir, sin conexión automática con un modelo.

Se han revisado la tabla completa de rutas, los módulos de persistencia, sesiones, actividades, planificación, cálculos, análisis, importación, copias, navegación, presentación y pruebas; también la documentación y el historial reciente. Se han ejecutado las pruebas unitarias y la comprobación de recursos, y consultado GitHub y los recursos públicos de Pages. No se han abierto datos personales del iPhone ni restaurado copias del usuario.

### Cómo interpretar las afirmaciones

| Etiqueta | Significado en este documento |
|---|---|
| **IMPLEMENTADO Y VERIFICADO EN CÓDIGO** | Existe una ruta y/o implementación concreta revisada. No equivale por sí solo a haber probado el gesto en un iPhone real. Es el estado de las funciones descritas en las secciones 4 a 10, salvo indicación expresa. |
| **DOCUMENTADO PERO NO VERIFICADO** | Consta en documentación anterior, pero no se ha reproducido su resultado o condición en esta revisión. |
| **LIMITACIÓN O PROBLEMA CONOCIDO** | Restricción visible en código o explícitamente conservada en documentación, con su alcance indicado. |
| **IDEA FUTURA NO IMPLEMENTADA** | Propuesta que no debe confundirse con una capacidad disponible. |
| **No verificado** | No se dispone de evidencia suficiente para resolver ese punto. |

La ejecución actual de las E2E, el comportamiento físico de Safari instalado, VoiceOver y el estado de caché/datos del iPhone quedan **No verificados**. La documentación no es una nueva auditoría global ni una revisión de la validez científica de las fuentes que cita la aplicación.

## 2. Producto y decisiones del propietario

Las siguientes decisiones proceden del encargo del propietario y forman parte del contexto permanente, aunque no todas estuvieran escritas antes en el repositorio:

1. La finalidad principal es mejorar su entrenamiento y su salud.
2. La utilidad, rapidez, fiabilidad y sencillez tienen prioridad sobre añadir funciones innecesarias.
3. Debe seguir siendo completamente gratuita, sin costes fijos obligatorios.
4. El funcionamiento offline y la conservación de los datos son prioridades.
5. Registrar y consultar entrenamientos no debe depender de servicios externos.
6. El dispositivo principal es el iPhone.
7. Se conserva el historial y se evitan migraciones innecesarias.
8. Las recomendaciones distinguen datos sólidos de estimaciones poco fiables.
9. Los pequeños defectos se corrigen de forma localizada, sin rediseños o refactorizaciones generales.
10. El desarrollo se hace en ramas separadas, con pruebas y posibilidad de marcha atrás.
11. El propietario prefiere comprobar las mejoras visuales en su iPhone tras publicarlas, sin revisar continuamente grabaciones de emuladores. La publicación requiere la autorización correspondiente al trabajo futuro.
12. La aplicación debe mantenerse durante años con el menor coste y complejidad razonables.

El seguimiento del ciclo es una función configurable del producto. No permite inferir el sexo, la salud ni los registros reales de su propietario. La biblioteca y las rutinas precargadas tampoco son prueba de que haya realizado esos entrenamientos.

## 3. Estado de Git y publicación al cierre de la revisión

### 3.1 Estado comprobado

| Elemento | Resultado |
|---|---|
| Repositorio | [alvar1712-blip/gym](https://github.com/alvar1712-blip/gym), remoto `origin` por HTTPS. |
| Rama activa local y rama predeterminada de GitHub | `claude/personal-training-mobile-app-e82j38`. |
| HEAD local y cabeza remota consultada con `git ls-remote` | `3e27bdebdf1528f260d29c73eca62d901ac63faa`. |
| Último despliegue registrado | Entorno `github-pages`, id `7394387136`, mismo SHA y misma rama, creado el 28/10/2026 a las 18:48:48 UTC. |
| Flujo de Pages | [pages build and deployment, ejecución 40748549266](https://github.com/alvar1712-blip/gym/actions/runs/40748549266), `completed / success`, SHA `3e27bde…`. |
| Aplicación pública | [Entreno](https://alvar1712-blip.github.io/gym/). La lectura HTTP de recursos fue satisfactoria. |
| Comparación público/local | `index.html`, `sw.js`, `js/app.js`, `js/store.js` y `manifest.json` coinciden como texto normalizado a LF. No se descargó ni comparó cada recurso publicado. |
| Service worker | `VERSION = 'v1-d813a6c4a2'`, caché `entreno-v1-d813a6c4a2`; misma versión en el [SW publicado](https://alvar1712-blip.github.io/gym/sw.js). |
| Árbol inicial | Limpio: `git status --short` sin salida. Al terminar solo se añaden estos dos documentos en `docs/`. |
| Incidencias/PR abiertos | La API pública de issues devolvió 0 elementos abiertos en la consulta (incluye los PR que devuelve ese endpoint). No garantiza ausencia de problemas no registrados. |

El commit publicado queda respaldado por el despliegue, el flujo satisfactorio y la coincidencia de los recursos comprobados. Esto no verifica que un iPhone concreto haya aceptado ya la actualización. Los endpoints públicos `/pages` y `/pages/builds/latest` devolvieron 404: la configuración administrativa exacta de Pages (directorio fuente y opciones de publicación) está **No verificada**. No se debe interpretar ese 404 como una caída de la aplicación.

### 3.2 Ramas y cambios pendientes

Se comprobó la ascendencia con `git rev-list --left-right --count HEAD...<rama>`. Todas las ramas locales y referencias remotas examinadas tienen **0 commits exclusivos frente a HEAD**; están integradas por ascendencia, aunque sus nombres contengan «sin publicar» o «mejoras».

| Rama o referencia | Commits de HEAD que le faltan | Commits exclusivos pendientes |
|---|---:|---:|
| `claude/mejoras-locales` y `origin/claude/mejoras-locales` | 22 | 0 |
| `feat/animacion-final-v2` | 4 | 0 |
| `feat/animaciones-inicio-fin-bienvenida` | 12 | 0 |
| `feat/celebracion-pulido-final` y su remota | 1 | 0 |
| `feat/celebracion-ritmo` | 0 | 0 |
| `feat/celebracion-strava-fiel` y su remota | 2 | 0 |
| `fix/seguridad-importaciones-copias` | 18 | 0 |
| `origin/claude/produccion-antes-ronda10` | 41 | 0 |
| `origin/claude/ronda10-sin-publicar` | 32 | 0 |

`git ls-remote --heads origin` confirmó las seis cabezas remotas existentes: producción, mejoras locales, producción anterior a ronda 10, ronda 10 y las dos ramas de celebración publicadas. No se hizo `fetch`, cambio de rama, commit, push, merge ni despliegue durante esta tarea. No hay cambios de código confirmados pero sin publicar identificados en esas ramas. Los nuevos documentos quedan sin confirmar y sin publicar.

### 3.3 Documentación anterior y precedencia

| Fuente | Uso adecuado |
|---|---|
| [README](../README.md) y [GUIA](GUIA.md) | Presentación, arranque, publicación e instalación. Algunos comandos de pruebas del README son propios de shells Unix. |
| [ARCHITECTURE](ARCHITECTURE.md) | Contratos y modelo general. Sus listas de rutas y algunos comentarios corresponden a fases anteriores: contrastar con `js/app.js` y los módulos actuales. |
| [REQUISITOS](REQUISITOS.md) | Encargo original, no inventario automático de lo que existe hoy. |
| [FASE2](FASE2.md), [FASE3](FASE3.md), [MEJORAS](MEJORAS.md), [MEJORAS5](MEJORAS5.md), [MEJORAS6](MEJORAS6.md) | Evolución y decisiones por funcionalidad. |
| [PULIDO](PULIDO.md), [RONDA11](RONDA11.md), [PRUEBAS](PRUEBAS.md) | Matices de interacción, compatibilidad, material/configuración y copias. Leer los cierres y correcciones posteriores dentro de cada documento. |
| [ESTADO](ESTADO.md), [INFORME-FINAL](INFORME-FINAL.md), [INFORME-PULIDO](INFORME-PULIDO.md), [INFORME-RONDA8](INFORME-RONDA8.md) | Fotografías históricas; no tratar su lista de pendientes como incidencias actuales sin comprobarla. |
| [ESTUDIO-APP-STORE](ESTUDIO-APP-STORE.md) | Estudio de una posible distribución nativa. **IDEA FUTURA NO IMPLEMENTADA**: no hay proyecto Capacitor ni aplicación nativa en el árbol revisado. Sus precios y requisitos externos no se han actualizado en este trabajo. |

Ejemplos de información superada: el cierre de `RONDA11.md` corrige su advertencia anterior sobre CRLF; `stamp-sw.mjs` ya normaliza LF. La bienvenida actual añade «Tu semana» cuando no hay planificación (tres o cuatro pasos). Los objetivos de resistencia incluyen senderismo en `goals-logic.js`, aunque una descripción antigua enumerase solo carrera, bici y natación. `races` ya tiene pantallas y lógica de resultados. El inventario vigente de rutas es `ROUTES` de `app.js`.

## 4. Arquitectura y organización

### 4.1 Componentes y dependencias

```text
index.html + manifest.json + css/* + icons/*
       |
       v
js/app.js -> js/router.js -> importación diferida de js/views/*.js
       |                         |             |
       v                         v             v
js/store.js <------------------- UI       lógica deportiva pura
       |                                  calc / stats / plan
       v                                  progression / analysis-*
js/db.js -> IndexedDB entreno

js/ui.js: componentes comunes, hojas, campos, avisos, compartir
sw.js: precaché y actualizaciones de recursos; no almacena el historial
scripts/*: comprobaciones y herramientas de desarrollo; no son servicios
```

La lectura habitual es síncrona desde los `Map` de `store.js`. Las vistas construyen objetos de entrada para cálculos puros, que devuelven métricas y mensajes. Las mutaciones pasan por el store, que actualiza memoria y persiste. No hay framework de interfaz, API propia, autenticación ni ORM. `package.json` declara `type: module`, versión `1.0.0`, sin `dependencies` ni `devDependencies`; Playwright es un requisito externo para E2E, no una dependencia de la PWA.

| Grupo de archivos | Responsabilidad y relaciones |
|---|---|
| [app.js](../js/app.js), [router.js](../js/router.js) | Arranque, rutas, pestañas, reanudación, splash y actualización; historial, scroll y transiciones. |
| [db.js](../js/db.js), [store.js](../js/store.js) | IndexedDB, estado, escrituras, carga inicial, compatibilidad, copias y punto de restauración. |
| [seed.js](../js/seed.js), [util.js](../js/util.js) | Catálogos e identificadores estables, biblioteca y rutinas iniciales, ajustes; fechas locales y formato es-ES. |
| [ui.js](../js/ui.js), [pickers.js](../js/pickers.js), [approx-input.js](../js/approx-input.js) | DOM y componentes compartidos; selección de ejercicios/rutinas; fechas aproximadas. |
| [session-logic.js](../js/session-logic.js), `session-view-card.js`, `session-view-summary.js`, `session-compare.js` | Crear y cerrar fuerza, series, comparación, tarjetas y resumen. La vista `views/session.js` coordina la interacción. |
| [activity-logic.js](../js/activity-logic.js), `views/activity.js`, `views/bodyweight.js` | Formularios y métricas de actividades y peso. |
| [library-logic.js](../js/library-logic.js), `views/templates.js`, `views/exercises.js` | Rutinas, objetivos de cada ítem y biblioteca. `targetText` evita diferencias entre rutina, sesión y Hoy. |
| [plan.js](../js/plan.js), `plan-ui.js`, `history-logic.js` | Semana tipo, excepciones, estados, adherencia y presentación de registros. |
| [calc.js](../js/calc.js), [stats.js](../js/stats.js) | Métricas elementales e índices de historial, series temporales y récords. |
| [progression.js](../js/progression.js), [insights.js](../js/insights.js) | Decisión común de progresión/estancamiento/fatiga y panel semanal. |
| [analysis.js](../js/analysis.js), `analysis-weight.js`, `analysis-training.js`, `analysis-hybrid.js`, `analysis-context.js` | Ensamblaje y análisis local de peso, fuerza, resistencia, recuperación y contexto. |
| [confidence.js](../js/confidence.js), [analysis-cache.js](../js/analysis-cache.js) | Confianza explicada e invalidación de cálculos por revisiones del store. |
| [focus.js](../js/focus.js), [overview.js](../js/overview.js) | Priorización de mensajes y portada «Cómo vas». Las vistas `focus.js` y `focus-item.js` son componentes, sin ruta propia. |
| [race-predict.js](../js/race-predict.js), [goals-logic.js](../js/goals-logic.js) | Predicciones y objetivos; la predicción no importa objetivos, estos consumen el motor de carrera. |
| [races-logic.js](../js/races-logic.js), `races-progress.js`, `races-result.js`, `views/race-result.js` | Eventos, prioridad, progreso y resultado. `race-result.js` aporta tarjetas/hojas, no una ruta independiente. |
| `context-logic.js`, `past-records-logic.js`, `profile.js` | Contexto temporal, marcas históricas y perfil opcional. |
| `checkin-logic.js`, `checkin.js`, `recovery-logic.js`, `cycle-logic.js` | Bienestar, zonas, evolución y ciclo opcional. |
| `charts.js`, `chart-summary.js`, `chart-context.js`, `bodymap.js`, `progress-ui.js`, `summary-logic.js` | SVG, accesibilidad de gráficos, anotaciones contextuales, mapa corporal y resúmenes. |
| `import-parse.js`, `import-zip.js`, `import-logic.js`, `best-efforts.js` | Lectura, descompresión, normalización, duplicados y parciales. |
| `backup.js`, `sha256.js`, `settings-logic.js`, `sanity.js` | Copias/CSV/integridad, umbrales y validación de valores. |
| `celebrate.js`, `celebrate-logic.js`, `celebrate-data.js`, `css/celebrate.css` | Finalización visual, mensajes y formas animadas. |

La convención de propietarios de módulos está descrita en `ARCHITECTURE.md`: conservar contratos del núcleo y delimitar cambios. No implica crear otra arquitectura para resolver un defecto puntual.

### 4.2 Arranque y persistencia

1. `index.html` presenta el shell y el logo; `app.js` inicializa el store y monta la ruta.
2. `db.openDB()` abre `entreno`, versión **3**, creando solo almacenes que falten. `onversionchange` cierra la conexión; ante un fallo de operación hay una reapertura y un reintento, útil tras suspensión de iOS.
3. `store.init()` carga los 12 almacenes en memoria. Si falta `meta.app`, `seedAll()` escribe metadatos, ejercicios y rutinas en una sola transacción. Si existe, `migrate()` completa ajustes, repara una siembra antigua incompleta cuando procede y añade semillas nuevas sin sustituir ediciones.
4. Una sesión de fuerza `active` se reanuda al abrir. Los módulos de pantallas se cargan bajo demanda; las tarjetas secundarias de Hoy se calculan después de lo principal, en tareas separadas.
5. `save()` cambia memoria inmediatamente y devuelve una promesa que se resuelve al completarse la transacción. `saveSoon()` agrupa escritura al teclear, con 250 ms por defecto. `flush()` inicia pendientes y espera las operaciones en vuelo; el arranque conecta los eventos de ocultación/cierre con el guardado.
6. `change`, `reset`, `error` y `restorepoint` permiten actualizar interfaz y avisos. Los contadores de revisión y `epoch` invalidan cachés; no viajan en copias ni viven en disco.

**LIMITACIÓN O PROBLEMA CONOCIDO:** actualizar memoria no prueba que el dato haya llegado a disco. `flush()` usa `Promise.allSettled`; los fallos se notifican mediante el canal de errores. La finalización de fuerza tiene además recuperación explícita de su estado en memoria si falla el guardado. No debe generalizarse esa garantía a cualquier mutación de la aplicación.

## 5. Pantallas, navegación y operaciones

Hay cinco pestañas: **Hoy, Calendario, Progreso, Ejercicios y Ajustes**. La navegación usa hashes `#/…`, apropiados para Pages sin rutas de servidor. Las pantallas interiores incluyen vuelta; sesiones y actividades conservan la pestaña de origen, excepto la fuerza activa, asociada a Hoy. La fuente de verdad es [ROUTES](../js/app.js).

### 5.1 Inventario completo de rutas

| Ruta o familia | Vista | Pantalla y operaciones |
|---|---|---|
| `#/today` | `views/today.js` | Continuar sesión, plan de hoy, empezar rutina o fuerza libre, registrar deportes, importar, peso rápido, mini semana, check-in, contexto, evento y objetivos. |
| `#/calendar` | `views/calendar.js` | Semana de lunes a domingo, navegación entre semanas, días y acceso a historial. `?week=YYYY-MM-DD` selecciona semana. |
| `#/day/:date` | `views/calendar.js` | Plan y registros del día; cambiar, mover/intercambiar, sustituir, marcar estado, restablecer y registrar con fecha pasada. |
| `#/history` | `views/history.js` | Sesiones y actividades por meses, filtros por tipo, apertura de registros y carga por lotes del historial. |
| `#/session/:id` | `views/session.js` | Ejecución o edición de fuerza, ejercicio actual, series, metadatos, check-ins y cierre/borrado. |
| `#/session/:id/summary` | `views/session.js` + `session-view-summary.js` | Resumen, récords, volumen/series, duración/carga, comparación equivalente y acceso al registro. |
| `#/activity/new`, `#/activity/:id` | `views/activity.js` | Registro/edición de carrera, bici, natación, senderismo y otra; borrador, validación, autoguardado válido y borrado. |
| `#/bodyweight` | `views/bodyweight.js` | Añadir/editar peso por fecha, historial, diferencias, media móvil y tendencia. |
| `#/exercises` | `views/exercises.js` | Segmentos Rutinas/Biblioteca (`?seg=templates` o `library`), búsqueda y selección. |
| `#/exercise/new`, `#/exercise/:id/edit` | `views/exercises.js` | Crear/editar ejercicio, nombre, músculos, patrón, tipo de registro y notas. |
| `#/exercise/:id` | `views/exercises.js` | Ficha, última vez, mejor registro, historial y enlace a progreso. |
| `#/templates`, `#/template/:id` | `views/templates.js` | Lista alternativa de rutinas; crear, duplicar, ordenar, editar y borrar; arrancar una rutina. |
| `#/progress` | `views/progress.js` | «Cómo vas», accesos al análisis y otras consultas, gráficos por periodo, músculos y ejercicios. |
| `#/progress/exercise/:id` | `views/progress.js` | Métricas y curvas del ejercicio, configuraciones de material e historial completo por lotes. |
| `#/records` | `views/progress.js` | Récords de fuerza/resistencia, procedencia, material, marcas reales y estimaciones separadas. |
| `#/records/past`, `#/records/past/new`, `#/records/past/:id` | `views/past-records.js` | Marcas históricas manuales de fuerza, fecha aproximada u omitida, comparación con rendimiento reciente, editar/borrar/deshacer. |
| `#/races`, `#/races/new`, `#/races/:id` | `views/races.js` | Eventos próximos/pasados, tipo, fecha, distancia, prioridad, objetivo, enlace y resultado «¿Cómo te fue?». |
| `#/weekly` | `views/weekly.js` | Panel de cualquier semana: información primero, sugerencias después, reglas y datos en «¿Por qué?». |
| `#/goals`, `#/goal/new`, `#/goal/:id` | `views/goals.js` | Objetivos de fuerza, resistencia y peso; progreso, estimación de fechas, conseguidos, archivados, edición y borrado. |
| `#/import` | `views/import.js` | Elegir archivos, revisar/editar actividades, duplicados, seleccionar, guardar, resultado y deshacer importación. |
| `#/predictions` | `views/predictions.js` | Tiempos de 5 km, 10 km, media y maratón; intervalos, confianza y «¿Puedo hacerlo?». |
| `#/summary` | `views/summary.js` | Resumen mensual o anual (`?p=month\|year&d=YYYY-MM-DD`), calendario, totales y comparación. |
| `#/analysis` | `views/analysis.js` | Resumen, peso, fuerza, resistencia, recuperación, ciclo cuando procede, previsiones e informe copiable. `?area=` desplaza a un área. |
| `#/recovery` | `views/recovery.js` | Evolución de sueño, energía, estrés, agujetas y zonas. |
| `#/cycle` | `views/cycle.js` | Seguimiento opcional de ciclo, anillo/fases, calendario, registro de días, síntomas, historial y asociaciones. |
| `#/settings` | `views/settings.js` | Índice: perfil, contexto, semana tipo, reglas, biblioteca, copias e instrucciones de instalación. |
| `#/settings/week` | `views/settings.js` | Semana tipo por días, rutinas/sesiones libres/descansos y semana de ejemplo. |
| `#/settings/thresholds` | `views/settings.js` | Series por músculo, factores, incrementos, progresión, avisos, estancamiento, descarga y mínimos de objetivos. |
| `#/settings/data` | `views/settings.js` | Exportar/importar/comprobar JSON, CSV, estado de almacenamiento, persistencia, punto de restauración y borrado total. |
| `#/settings/profile` | `views/settings.js` | Sexo, fecha de nacimiento, objetivo, experiencia, deportes, frecuencia, limitaciones y opciones de ciclo. |
| `#/context`, `#/context/new`, `#/context/:id` | `views/context.js` | Fases y hechos con fechas aproximadas, historial, crear/editar/borrar/deshacer y resultados de carrera. |
| `#/welcome` | `views/welcome.js` | Bienvenida opcional, tres o cuatro pasos; se abre desde la invitación de perfil, no fuerza un asistente al arrancar. |

Los parámetros de actividad pueden incluir `kind`, `date`, `parent`, `item`, `planDate` y `subtype`. Vinculan un cardio con un ítem de fuerza o preseleccionan lo planificado. Los formularios no son todos iguales: algunos editan inmediatamente un registro, otros mantienen un borrador hasta «Guardar». Conservar su semántica al intervenir.

### 5.2 Hoy y vistas inteligentes existentes

Hoy adapta el orden al momento: una sesión abierta ofrece «Continuar» antes que el plan; antes de entrenar prima empezar; después o en descanso sube «Lo importante esta semana». Los objetivos permanecen al final. El aviso de copia no tapa la sesión activa y puede posponerse; Ajustes conserva su indicador.

El evento relevante aparece como línea o como tarjeta si quedan 14 días o menos. Se selecciona A/B entre los próximos 365 días o C entre 30; un evento A/B pasado reciente sin respuesta puede mostrar «¿Cómo te fue?». La fase vigente se presenta como «Ahora: …». En modo de ciclo habilitado aparece su tarjeta.

`focus.weekFocus()` reúne panel y analista en hasta tres mensajes, uno por tema, con un paso siguiente. La confianza ajusta prioridades sin ocultar un aviso por debajo de mensajes que solo dicen que todo va bien. Con base insuficiente se pide reevaluar/acumular datos; no se presenta ausencia de datos como buena evolución. Esto es priorización de información, no generación de una programación semanal automática.

### 5.3 Fuerza, rutinas y biblioteca

Las rutinas iniciales son cinco: D1, D2, D3, D4 y D6 (`TEMPLATE_IDS`); la expresión histórica «D1–D6» no implica seis plantillas ni un D5. Se pueden crear, duplicar, ordenar y editar rutinas, cambiar ejercicios y alternativas, objetivos de series/reps/tiempo/distancia, secciones, notas y grupos consecutivos de superserie/circuito. La edición se guarda sola; ejecutar una rutina crea una sesión con su instantánea, sin convertir cada cambio durante el entrenamiento en una modificación de la plantilla.

La biblioteca identifica músculos primarios/secundarios, patrón, categoría, región y tipo de registro. Permite ejercicios propios y edición, archivo y desarchivo; el archivo conserva referencias. El borrado definitivo se reserva a ejercicios sin uso en sesiones, plantillas, objetivos ni marcas históricas. Los tipos son peso×reps, peso corporal con lastre/asistencia, unilateral, tiempo, distancia+tiempo, saltos y cardio. Un ítem de cardio abre una actividad enlazada en vez de inventar series de fuerza.

Una sesión puede partir de rutina o ser libre, iniciarse ahora o registrarse a posteriori. Las series se prellenan con la última sesión anterior pertinente. Ejercicios repetidos dentro de una rutina distinguen su ítem y objetivo para no cruzar, por ejemplo, dos distancias de sprint. Se pueden añadir/quitar/reordenar ejercicios y series, cambiar a una alternativa, modificar objetivos y notas, ajustar peso/reps/RIR, registrar/rectificar series y consultar la última vez. Las tarjetas muestran progreso y siguiente paso cuando hay base.

Se distinguen calentamiento, efectiva, fallo y drop set. El calentamiento sugerido está plegado y puede incorporarse de una vez. Solo las series de trabajo confirmadas cuentan en volumen, músculos y récords; ni pendientes ni calentamientos suman. Las pendientes se eliminan al finalizar, con información previa. El RIR se registra de 0 a 5 o `F`; el esfuerzo global RPE es de 1 a 10. **No hay cronómetro de descanso entre series**: existe cronómetro de sesión, según la implementación de `views/session.js`.

«Material o configuración» es texto opcional de hasta 40 caracteres por ejercicio de sesión: máquina, polea, agarre, etc. Se hereda lo habitual, se ofrecen configuraciones previas y se normaliza la clave sin mayúsculas/tildes/espacios sobrantes. La última vez, comparaciones, récords, estancamiento y progreso comparan configuraciones equivalentes; estrenar máquina crea referencia, no un récord falso. Un campo ausente en datos antiguos significa sin especificar: no se rellena retroactivamente. El lastre/asistencia se registra como carga de la serie (asistencia negativa), sin un inventario estructurado de equipamiento.

El modo foco facilita registrar el ejercicio en curso, con controles inferiores propios; el trabajo completado puede plegarse en sesiones largas. No cambia los datos ni añade otra clase de sesión. Al terminar se puede aplicar a la plantilla un cambio elegido explícitamente. La sesión pasada mantiene su propio registro.

La edición permite cambiar fecha, hora de inicio cuando procede, duración, esfuerzo y notas, abrir resumen, descartar una sesión vacía o borrar con confirmación/deshacer. Mover la fecha arrastra los check-ins y las actividades enlazadas pertinentes. Solo se ofrece una fuerza activa a la vez desde el flujo de interfaz; no es una restricción relacional de IndexedDB.

### 5.4 Flujo de finalización y comparación

1. `createStrengthSession()` crea `kind:'strength'`, `status:'active'`, ejercicios/objetivos de la plantilla, `templateItemIds` y series pendientes prellenadas; guarda antes de navegar.
2. Las entradas se guardan durante el entrenamiento. `startedAt` alimenta el cronómetro; una sesión pasada puede no tenerlo.
3. Al terminar, `proposedDuration()` propone transcurrido menos cardio enlazado. Si hay más de 60 minutos sin registrar actividad, trata la sesión como olvidada: usa el último registro y un margen; la duración sigue siendo revisable. Una sesión larga activa no se recorta por su duración total.
4. Se revisan duración/RPE/notas y series pendientes. `finishSession()` descarta pendientes, fija `done`, fin, duración y `durationAuto`; se espera `store.save()`. Si falla, la vista recupera el objeto anterior y permite reintentar.
5. Si hay diferencias aplicables a la rutina, se consulta antes. Después se presenta la celebración y se monta debajo el resumen.
6. `previousEquivalent()` busca una sesión terminada anterior de la misma plantilla. `compareSessions()` compara ejercicios con misma configuración: serie más pesada y reps, series, volumen y duración. Sin equivalente o ejercicios comparables no inventa comparación.
7. Si posteriormente cambia un cardio enlazado, `syncLinkedDuration()` recalcula fuerza cuando se aceptó duración automática. No reemplaza una duración manual arbitrariamente.

### 5.5 Resistencia y otras actividades

| Tipo | Registro y métricas disponibles |
|---|---|
| Carrera | Fecha, tiempo en movimiento, distancia opcional, RPE, notas; ritmo; tipo rodaje/Z2, series, tempo, tirada larga o competición; sensaciones, tiempo total, desnivel, pulso y cadencia. |
| Bici | Tiempo, distancia, velocidad, RPE/notas; rodaje, ruta, series o rodillo; tiempo total, desnivel, pulso/cadencia, potencia media y normalizada. |
| Natación | Tiempo, distancia presentada en metros y almacenada en km, ritmo/100 m, piscina/aguas abiertas, longitud 25/50 m y estilo. |
| Senderismo | Tiempo en movimiento y total, distancia, ritmo, desnivel positivo/negativo, altitud máxima, mochila y pulso. Récords de distancia y ascenso. |
| Otra | Duración, RPE/notas y tipo baloncesto, agilidad, movilidad, deporte libre u otro texto. No tiene el conjunto de métricas de distancia de carrera. |

Tipo, fecha válida y duración positiva son mínimos del formulario; distancia y RPE no son obligatorios para guardar. Sin RPE no hay una carga medida equivalente a minutos×RPE. La vista muestra lo que falta y conserva borrador local antes de que el registro sea válido. Una vez válido guarda cambios y permite editar después; «Listo» no debe confundirse con el único momento de persistencia.

Cambiar deporte avisa de campos que se perderían. `KIND_FIELDS` conserva desnivel negativo y altitud máxima importados entre carrera, bici y senderismo, aunque no todos tengan controles visibles para cada campo. Hay avisos de valores sospechosos y límites imposibles en `sanity.js`; un aviso orientativo no equivale a bloquear cualquier dato raro. Se detectan actividades que parecen duplicadas, incluso frente a entradas manuales.

No hay grabación GPS en vivo, sincronización con Garmin/Strava ni mapa geográfico de recorridos en las vistas revisadas. Se importan archivos que el usuario proporciona. `track` es una serie compacta distancia–tiempo, no un mapa de coordenadas. La ficha de actividad no presenta un visor completo de parciales/mejores tramos: los datos se usan en récords y predicciones; esa pantalla de comprobación figura como posible mejora histórica.

### 5.6 Importación deportiva

El flujo está en `views/import.js`: escoger uno o varios archivos, detectar formato por contenido, leer, mostrar errores por entrada y vista previa editable, detectar duplicados (inicialmente desmarcados), seleccionar y guardar como sesiones ordinarias. Al concluir puede abrirse el historial o deshacerse la importación del lote recién guardado.

`import-parse.js` admite GPX, TCX y FIT, también GZIP/ZIP. Usa lector XML propio, datos FIT y `DecompressionStream`; `import-zip.js` admite ZIP almacenado y deflate, sin ZIP64 ni cifrado. Límites de salida descomprimida: **50 MiB por archivo y 250 MiB acumulados**, comprobando bytes reales. Si no hay API de descompresión, se pide descomprimir antes. No se instala una biblioteca alternativa automáticamente.

Se derivan distancia, tiempos, desnivel suavizado y métricas disponibles, priorizando datos del dispositivo cuando corresponde. El movimiento se estima con umbral de 0,5 m/s, ventana de velocidad y tratamiento de huecos; la altitud suavizada evita sumar todo el ruido. Se detectan picos GPS y datos incompletos. Estas decisiones se pueden consultar en los parámetros de `import-parse.js` y pruebas de importación.

Los puntos GPS originales no se guardan. En carreras se pueden conservar `track`, `laps` y `bestEfforts` con versión y base de distancia/tiempo. Se usa la serie o vueltas válidas para mejores esfuerzos continuos; se incluyen pausas del tramo. Un esfuerzo aproximado o con ritmo imposible no se convierte en récord real. Editar distancia/tiempo invalida la base derivada cuando ya no coincide.

**LIMITACIÓN O PROBLEMA CONOCIDO:** guardar un lote deportivo es secuencial, no una transacción global de todo el lote. Si falla una escritura pueden quedar actividades ya guardadas y se informa del resultado. Esta operación añade sesiones; importar JSON de copia sustituye toda la base y tiene otro flujo de protección. La limpieza de picos depende del deporte detectado originalmente; cambiar carrera↔bici en la revisión no vuelve a procesar el archivo.

### 5.7 Planificación e historial

`settings.weekPatterns` conserva vigencias de semana tipo. `setWeekPattern()` añade/sustituye la vigencia desde el lunes elegido, sin reescribir las semanas anteriores. Una instalación nueva tiene **semana vacía**; la de ejemplo se elige expresamente. Se puede planificar plantilla, descanso o sesión libre con tipo/nombre.

Los cambios de un día se guardan en `plan`, con id de fecha. Mover/intercambiar/sustituir o marcar un día no modifica la semana tipo. `date` es la fecha del registro y `planDate` su vinculación al plan; los hijos de fuerza no cuentan como otro día independiente.

`dayStatus()` distingue hecho, parcial, sustituido, saltado, descanso, pendiente y sin registro. Un estado manual prevalece. En plantilla se comprueba qué ítems se cubrieron mediante trabajo o actividad; `templateItemIds` preserva la referencia de creación frente a cambios posteriores de rutina. Antes del primer uso no se pintan falsos días saltados. La adherencia cuenta días planificados con cumplimiento hecho/parcial/sustituido y distingue extras y pendientes; no es un porcentaje de cada serie programada.

El historial mezcla fuerza y actividades, filtra por tipo, agrupa por mes y permite abrir y editar lo anterior. Las listas largas se amplían por lotes; no es una base remota paginada. La recuperación de un borrado ordinario se ofrece con «Deshacer» cuando el flujo lo permite; el punto de restauración protege sustituciones completas, no un historial ilimitado de revisiones.

### 5.8 Progreso, resúmenes, objetivos y eventos

Progreso presenta cuatro áreas en «Cómo vas»: fuerza, resistencia, cuerpo y recuperación. Las comparaciones semanales de portada usan cuatro semanas completas frente a las cuatro anteriores para evitar juzgar una semana a medias; las minigráficas pueden abarcar doce. El deporte principal de resistencia se elige por tiempo, evitando que los km de bici dominen por unidad.

Hay gráficos SVG propios de carga, volumen, músculo, km, ritmos/velocidad, peso y adherencia, con selector de periodo y valores al tocar. La ficha de ejercicio incluye historial, carga máxima, mejor serie, 1RM estimado o métricas propias de tiempo/distancia/saltos. El mapa corporal relaciona músculos con series y rangos; cero significa sin series y una semana en curso por debajo del mínimo no se trata automáticamente como incumplimiento final. Las gráficas pueden superponer fases/hechos/eventos pertinentes mediante `chart-context.js`, con explicaciones y control de visibilidad.

El panel semanal separa información de sugerencias: series por músculo y equilibrio empuje/tirón, carga y km frente a referencia, progreso/estancamiento, doble progresión, recuperación y descarga. Cada regla incorpora «¿Por qué?» y cifras. No es un entrenador que reescriba automáticamente la rutina.

Los resúmenes mensual/anual incluyen calendario, días y totales por deporte, minutos/carga, volumen/series, récords y ejercicios con mejora. El periodo en curso se compara con el mismo tramo anterior; los cerrados con el periodo completo. La semana se consulta en el panel semanal.

Los objetivos se crean para peso×reps de fuerza, distancia/tiempo de resistencia (carrera, bici, natación, senderismo) o peso corporal. Tienen título, progreso, estado activo/conseguido/archivado y rango de fechas cuando la tendencia lo permite. Pueden editarse, archivarse y borrarse con los controles correspondientes. «Al alcance» es una estimación, no haber logrado una marca. Un objetivo conseguido se resincroniza si se modifica o borra el registro que lo sustentaba.

Los eventos deportivos son distintos de los objetivos: 5K, 10K, media, maratón, ciclismo, senderismo, triatlón u otro; fecha, distancia, tiempo objetivo, prioridad A/B/C, nota y `goalId` opcional. Informan Hoy, gráficas y análisis; no generan un plan de preparación. Solo las carreras a pie tienen predicción de tiempo. El resultado se vincula a una actividad o a un resultado de carrera de contexto; en otros deportes puede ser manual. También puede registrarse «no participé». Se compara con objetivo y previsión previa cuando hay base, sin duplicar la misma carrera en varios almacenes como hechos independientes.

### 5.9 Peso, perfil, contexto, bienestar y ciclo

El peso admite un valor por día, edición, borrado y registro rápido desde Hoy. La vista ordinaria muestra media móvil de siete días y tendencia de sus puntos en 28 días (mínimo cuatro puntos y catorce días de amplitud). El analista usa otro estimador robusto; sus cifras tienen etiquetas distintas, como «Peso de tendencia» y «Último pesaje», para no presentar pesos con definiciones diferentes como si fueran idénticos.

El perfil opcional recoge sexo, nacimiento, objetivo principal/secundarios, experiencia, deportes, días semanales y limitaciones. Modifica rangos, mensajes y cautelas por edad; no presupone datos ausentes. La bienvenida ofrece Sobre ti, Tu entrenamiento, Tu semana si falta y Ahora mismo. Cada paso es saltable.

«Tu contexto» permite fases de composición (ganancia, déficit, mantenimiento, recomposición), parón/vuelta/reacondicionamiento/descarga, preparación de carreras/ciclismo, híbrido, enfermedad, lesión, viaje, estrés y personalizadas. Los hechos incluyen inicio/fin de creatina, vuelta al gimnasio, vacaciones, enfermedad, cambios de rutina/alimentación, lesión, peso habitual/pasado, resultado de carrera u otro. Usa día, mes, estación o año; una fecha aproximada conserva su precisión y no debe transformarse en un día observado. Las fases pueden tener fin abierto y relación con deportes/objetivos.

Los check-ins son opcionales antes/después: sueño, energía, estrés y agujetas generales en escala 1–3. Las zonas musculares/articulares llevan lado y nivel 0–10 y nota. Se pueden guardar parcialmente o saltar. El indicador de check-in bajo usa sueño/energía bajos o agujetas altas, no añade estrés a esa definición. El analista sí puede utilizar estrés y zonas en asociaciones. Una omisión no inventa un check-in.

Recuperación muestra cuatro semanas por días, doce por semanas o todo por meses/trimestres/años según longitud. Las medias requieren días suficientes; las zonas repetidas se resumen con evolución. No es una escala diagnóstica de dolor ni un detector clínico de fatiga.

El ciclo se habilita con el perfil correspondiente y puede desactivarse. Registra flujo, inicio/fin, síntomas y notas, muestra calendario/historial, fases y próxima regla estimadas, avisos y «Cómo te afecta» con datos personales cuando hay muestra. Considera anticoncepción y evita presentar fases estimadas como ovulación confirmada. Su inclusión en informes externos es opcional y está desactivada por defecto.

### 5.10 Interfaz, accesibilidad y animaciones

La UI emplea tema oscuro, acento verde, barras/hojas con efecto cristal, zonas seguras y alturas adaptadas a Safari. `ui.sheet()` gestiona hojas apiladas, cierre, foco y bloqueo de scroll; `router.js` conserva scroll por entrada y reconoce navegación atrás. El gesto real del borde en iPhone permanece **No verificado** en esta revisión.

Hay controles táctiles, etiquetas ARIA, estado de pestaña con `aria-current`, anuncios, foco visible, teclado, descripción de gráficas y soporte de `prefers-reduced-motion`. `app.js` mide Dynamic Type y aplica escala de 1 a 1,5; `entreno.textScale` sirve para forzar pruebas, sin ajuste público propio. No se certifica cumplimiento íntegro de WCAG por inspección de código.

El splash presenta el logo y se retira cuando la pantalla está preparada, con mínimo de 800 ms y tope de espera de tarjetas; una reapertura con actividad en los últimos cinco minutos lo omite. Esa reapertura es distinta del asistente de bienvenida. El inicio de fuerza/actividad precarga vistas cuando puede y evita una pantalla negra artificial prolongada.

La celebración actual sigue una máquina de estados de una sola dirección: `idle → launching → celebration → exiting → completed`. Parte del botón pulsado, cubre la pantalla, monta el destino debajo, muestra emoji/mensaje y una curva verde y sale. Respeta movimiento reducido y se puede omitir después de cubrir; el guardado sucede antes. Los récords destacados se limitan a los ejercicios de `MAIN_LIFTS`; los accesorios siguen teniendo récords en estadísticas aunque no disparen ese mensaje. La animación no debe ser requisito para conservar una sesión.

## 6. Modelo de datos y relaciones

### 6.1 Versiones y convenciones

La base `entreno` tiene `DB_VERSION=3`; todos los almacenes usan `keyPath:'id'`, sin claves foráneas impuestas por IndexedDB. `meta.app.schema` sigue siendo **1**, `SEED_VERSION=1`, `APP_VERSION=1.0.0` y formato de copia **2**. Son versiones con propósitos distintos; ninguna sustituye el sello de recursos del SW.

Fechas civiles: cadenas locales `YYYY-MM-DD` mediante `util.js`; instantes: milisegundos. Las semanas empiezan en lunes. No construir fechas civiles con `toISOString().slice(0,10)`: cambia el día en algunos husos. UI es-ES, coma decimal; representación interna numérica.

| Almacén | Datos relevantes | Relaciones y conservación |
|---|---|---|
| `meta` | `app`: creación, seed/schema y siembra completa. `settings`: semana tipo, rangos musculares, factores, incrementos, progresión, carga/km, estancamiento/descarga, CSV, recordatorio/fecha de copia, perfil y ajustes del análisis. | También guarda registros reservados `~restorePoint` y `~restorePoint:data`, excluidos de la memoria normal/copias. |
| `exercises` | `id,name,aliases,primary,secondary,pattern,logType,category,region,sport,notes,custom,archived,createdAt,updatedAt`. | Referenciados por plantilla, sesión, objetivo y marca histórica; ids del catálogo estables. |
| `templates` | `id,name,order,notes,archived,items[]`. Cada ítem: id, ejercicio, alternativas, series/rangos, tiempo/distancia, sección, agrupación/notas. | `exerciseId`, `alternatives`, `groupId/groupType`. No es el historial de ejecución. |
| `sessions` | Comunes: id, kind, date, planDate, templateId/name, status, inicio/fin, duración, RPE, notas, parentId y timestamps. Fuerza: exercises, cursor, instantánea de ítems, duración automática/borrador y omisiones de check-in. | Fuerza y todos los deportes comparten almacén. Hijos cardio enlazados a sesión/ejercicio/ítem. |
| `plan` | id=fecha; excepción opcional de tipo, plantilla, etiqueta/deporte, estado y nota. | Complementa las vigencias de semana tipo, sin sobrescribirlas. |
| `bodyweight` | id=fecha, kg y timestamps. | Base de curva corporal y de carga efectiva en peso corporal. |
| `checkins` | id, date, timing pre/post, sessionId, sleep/energy/stress/soreness, areas, timestamps. | Un valor lógico por día/momento; ante duplicados se elige el actualizado más reciente. |
| `goals` | id, kind, title/titleAuto, achievedAt, archived y campos propios. Fuerza: ejercicio/peso/reps; resistencia: deporte/distancia/tiempo; peso: targetKg/direction. | Se evalúa contra registros; puede estar enlazado desde `races.goalId`. |
| `cycle` | id=fecha, flow, symptoms, notes, ended/auto y timestamps. | Seguimiento opcional conservado aunque la vista no esté habilitada. |
| `context` | id, kind phase/event, type, start/end o date aproximados, text/notes, goalIds/sports y kg/result cuando aplica. | `result` de carrera: km, sec, esfuerzo, desnivel, superficie; única referencia manual de esa carrera. |
| `pastRecords` | id, exerciseId, weight, reps, rir, date aproximada o nula, beforeApp, bodyweightKg, note, timestamps. | Marcas manuales de fuerza separadas del historial de series. |
| `races` | id, name/type/date, distanceKm, targetSec, priority, note, goalId, outcome y timestamps. | Resultado referenciado a `sessions` o `context`; manual solo donde corresponde. |

`SessionExercise` guarda `id, exerciseId, exName, templateItemId, baseExerciseId, alternatives, target, notes, note, section, groupId/groupType, setup?, sets[]`. `SetEntry` guarda `id,type,weight,reps,repsR,rir,timeSec,distanceM,heightCm,note,done,doneAt` y temporalmente `origWeight`. La copia de nombre/objetivo permite comprender una ejecución aunque cambie la rutina.

Una actividad contiene `distanceKm,movingSec,elapsedSec,elevationM,elevationLossM,altMaxM,hrAvg,hrMax,cadence,powerAvg,powerNp,subtype,feel,poolType,poolLengthM,stroke,packKg` según tipo. La duración se deriva de `movingSec/60`. Las importadas añaden `source:{type,fileName}` y fecha/hora de inicio; las carreras pueden añadir derivados versionados `track,laps,bestEfforts`. No todos los campos se rellenan ni se muestran para todos los deportes.

### 6.2 Relaciones que deben conservarse

- `sessions.templateId` identifica la rutina original; los ítems fotografiados evitan que editarla cambie el cumplimiento pasado.
- El cardio usa `parentId` de fuerza, `parentItemId` del ejercicio de sesión y `templateItemId`. Los ítems eliminados pueden dejar actividades huérfanas visibles aparte, sin ocultarlas.
- `checkins.sessionId` relaciona bienestar y rendimiento; los registros por fecha siguen siendo opcionales.
- `races.outcome` referencia un hecho ya existente. No copiar una carrera a `sessions` y `context` como si fueran dos pruebas independientes.
- `setup` distingue series de un ejercicio por material; objetivos y marcas históricas de fuerza mantienen alcance global, sin esa dimensión.
- Los normalizadores toleran campos opcionales antiguos al leer. La validación de copia es estructural y no convierte todos los datos históricos en perfectos.

### 6.3 Almacenamiento auxiliar

IndexedDB es el historial durable del navegador. `localStorage` conserva borradores y preferencias/avisos, como `draft:activity:*`, borradores de objetivos, omisiones de check-in y `entreno.lastActive`; `sessionStorage` ayuda a restaurar scroll (`entreno:scroll`). Caché HTTP y Cache Storage guardan recursos, no entrenamientos. La limpieza posterior a importar/borrar elimina claves auxiliares de la aplicación para que un borrador viejo no reaparezca sobre los datos restaurados. Los JSON no son una exportación completa de todas esas preferencias transitorias ni del punto reservado.

## 7. Reglas deportivas y límites de los algoritmos

### 7.1 Series, volumen, 1RM y récords de fuerza

`calc.isWorkSet()` exige serie hecha y tipo de trabajo. Volumen de peso×reps es carga por reps; unilateral suma repeticiones de los dos lados para volumen, pero usa el lado con menos reps para estimar fuerza/progresión. En peso corporal la carga efectiva es peso del día más lastre o menos asistencia. `makeBodyweightFn()` busca último pesaje anterior, si falta el primero posterior y, sin ninguno, el valor configurable (75 kg por defecto): un resultado con fallback es estimado, no un pesaje real. El core de peso corporal evita atribuir todo el cuerpo como carga y no genera 1RM.

`e1rm()` aplica Epley con repeticiones más RIR, solo para 1–12 repeticiones realizadas y carga positiva; RIR ausente se trata como 0, `F` como 0. Un sencillo al fallo devuelve su carga; en los demás casos `peso × (1 + (reps + RIR)/30)`. No mide una máxima real ni debe extenderse a saltos, cardio o series por tiempo.

Los récords requieren historial anterior equivalente: la primera sesión/configuración crea referencia, no récord contra otra serie de ese mismo estreno. Se distinguen métricas según tipo. Las dominadas no obtienen un récord atribuido únicamente a haber subido el peso corporal. El cómputo muscular suma contribución primaria/secundaria (por defecto 1 y 0,5), no una medición anatómica de estímulo o hipertrofia. Los rangos musculares son configurables.

### 7.2 Progresión, estancamiento y fatiga

`progression.js` es la fuente común para sesión, panel y analista. La doble progresión exige series objetivo suficientes, todas las de trabajo en el tope de reps y RIR mínimo. Incrementos iniciales: compuesto superior 2,5 kg, inferior 5 kg, aislamiento 1 kg (puede expresarse 1–2). Con asistencia recomienda reducirla y luego lastre cuando procede.

El estado reciente exige al menos tres sesiones; compara ventanas configurables de sesiones/semanas, no solo la diferencia entre las dos últimas. Un parón de 28 días corta la referencia. `progressionHint()` reúne tendencia, estancamiento, RIR y confianza antes de decidir; `fatigueState()` centraliza fatiga/descarga para evitar mensajes incompatibles. Por defecto el estancamiento se valora en tres sesiones/tres semanas, y la descarga usa mínimo de tres ejercicios estancados, RPE alto 8 y dos semanas, junto con las condiciones de la función.

La carga de sesión es minutos×RPE, no calorías, TSS, TRIMP ni riesgo clínico. Los avisos iniciales comparan con cuatro semanas previas (carga +20/+30 %, km de carrera +10/+15 % y base mínima). Las semanas en curso se contextualizan; una bajada cerca de un evento prioritario puede explicarse como puesta a punto en vez de falta de constancia. Estos umbrales son heurísticas editables, no garantías contra lesiones.

### 7.3 Récords de carrera y mejores esfuerzos

`stats.runMarkFor()` centraliza el criterio que consumen récords y otros módulos:

- Si la carrera no llega a la distancia objetivo, no hay marca en ella.
- Entre la distancia objetivo y el 102 %, usa la actividad completa proporcionalmente a la distancia (`how:'full'`).
- Si es más larga y tiene un mejor esfuerzo válido, usa ese tramo continuo (`partial`), con tiempo transcurrido y pausas.
- Sin tramo válido, calcula el tiempo a ritmo medio (`estimated`).

La implementación actual separa `run.best` de `run.estimates`: una extrapolación a ritmo medio **nunca desplaza una marca real**. Una estimación más lenta que la real ni se muestra. Se indica origen registrado/importado/contexto y precisión de fecha. Las distancias de récord incluyen 1 km, 5 km, 10 km, media y maratón. Bici/natación tienen mayor distancia; senderismo también mayor desnivel positivo.

`best-efforts.js` valida series distancia–tiempo y vueltas, elimina/identifica datos problemáticos, simplifica la serie, busca ventanas rápidas e indica aproximación. Sus tolerancias son parte del resultado: un tramo interpolado con muestreo insuficiente no debe ascender a récord observado. Los resultados manuales de contexto conservan valor histórico, con detección de duplicado frente a una actividad semejante por fecha/distancia/tiempo.

### 7.4 Predicción de carreras y objetivos

`race-predict.js` usa Riegel (exponente base 1,06), esfuerzos recientes de doce semanas, por defecto carreras ≥3 km y ritmos entre 2:30 y 20:00/km. Necesita dos carreras recientes válidas, o la vía de referencias manuales de contexto (estas admiten resultados desde 1 km). Mejores tramos importados válidos pueden aportar evidencia sin contar la misma sesión varias veces como sesiones independientes.

Selecciona hasta tres esfuerzos de mayor valor para cada distancia y pondera recencia/proximidad; los históricos pierden peso, y los anteriores a un parón se penalizan. El rango tiene margen mínimo ±3 % y crece con dispersión. Para media/maratón considera seis semanas de volumen y tirada larga: referencias de 25 km/sem y 14 km de tirada para media, 40/24 para maratón; el exponente puede aumentar hasta 1,10 si falta base. No equivale a haber entrenado o tolerado esa carrera.

Devuelve `ok`, `tentative`, `incoherent` o `invalid`; la confianza baja por extrapolación, muestra escasa, dispersión, falta de volumen y referencias antiguas. «¿Puedo hacerlo?» compara el objetivo con los extremos redondeados y devuelve probable, ajustado, hoy no o insuficiente. No ofrece promesas ni una fecha de preparación garantizada.

Los objetivos usan registros desde su creación para acreditar logro, y mejores valores recientes para mostrar situación. Una fuerza exige peso y reps reales, no solo 1RM equivalente. Un tiempo se cumple estrictamente por debajo, no igualándolo. La carrera con tiempo consume el motor compartido; no replicar otra predicción dentro de objetivos. La ETA de objetivos requiere por defecto cuatro registros en tres semanas, amplitud real suficiente, pendiente a favor y ausencia de estancamiento aplicable. Presenta rango, no fecha exacta; los parones reinician tramo y las estimaciones lejanas se expresan como más de dos años.

### 7.5 Análisis de peso y energía

`analysis-weight.js` diferencia última medida, EMA de tendencia con constante temporal de diez días y pendiente robusta Theil–Sen. Parte de una ventana de 28 días, ampliable hasta 56, mínimo ocho pesajes y catorce días; evalúa ruido, antigüedad y contexto/ciclo. El rango de pendiente es una estimación estadística del modelo, no una probabilidad individual de resultado.

La fase corporal vigente de contexto tiene prioridad sobre el objetivo general del perfil. La vuelta tras parón y el inicio de creatina pueden explicar aumentos; no se concluye ganancia de grasa automáticamente. La proteína usa un peso de referencia coherente en las áreas de análisis; las recomendaciones de energía son ajustes orientativos derivados de tendencia (aproximación 7700 kcal/kg), no un registro de comidas ni una medición del gasto.

Con confianza baja se evitan cambios calóricos salvo condiciones prudentes específicas como una pérdida excesiva; menores no reciben ajustes calóricos y en mayores de 65 se limitan a 250 kcal. Los rangos por sexo/experiencia/objetivo son reglas de la aplicación. Este documento verifica su presencia, sin convertirlos en asesoramiento nutricional personalizado ni validar de nuevo cada fuente científica.

### 7.6 Fuerza a medio plazo, intensidad y análisis híbrido

`analysis-training.js` estima tendencia robusta en ventanas de 6, 8, 10 o 12 semanas; mínimo cuatro sesiones en tres semanas y ejercicio reciente (28 días), con reinicio tras parón. Compara ritmos con umbrales orientativos por experiencia y estima cuatro/ocho semanas con rendimientos decrecientes y ruido. El estado de estancamiento procede del módulo común de progresión, evitando una segunda definición.

La distribución de intensidad examina cuatro semanas por tipo/RPE, con muestra mínima de seis sesiones, tres semanas y 180 minutos. La referencia aproximada 80/20 no representa zonas fisiológicas calculadas desde una prueba de umbral; la clasificación puede proceder del subtipo declarado. La interferencia fuerza/resistencia considera proximidad, tren inferior y repetición, y puede sustituir una regla general por una asociación personal con base suficiente.

`analysis-hybrid.js` separa carga por deporte y perfiles de otras actividades, picos frente a base (referencia +50 %), volumen muscular con contexto, cambios de bloques de seis semanas y asociaciones de rendimiento/estrés/sueño/agujetas. Las asociaciones piden al menos seis observaciones por grupo, 28 días y efecto d≥0,5; se aplican diferencias mínimas (p. ej., rendimiento 3 %, ritmo 2 %, agujetas 1,5/10). Son asociaciones observacionales, sin causalidad demostrada. Los minutos totales de resistencia para energía y la carga minutos×RPE para estrés deportivo tienen funciones distintas.

### 7.7 Recuperación, confianza y presentación

`recovery-logic.js` da prioridad al check-in previo por día/campo y usa el posterior si falta. Las tendencias comparan catorce días recientes con 42 previos, mínimos de cuatro y seis días respectivamente y diferencia de 0,5 en escala general. Las zonas requieren repetición. No se rellenan los días sin registro como normales.

`confidence.js` define insuficiente/baja/media/alta. Combina muestra, amplitud, ruido y topes contextuales quedándose con el factor más débil, con motivos y base explicables. Estas etiquetas no son porcentajes de certeza ni garantías médicas.

`buildAnalysis()` ensambla áreas con aislamiento de errores, evita duplicar mensajes por id, prioriza y construye puntos clave. La caché de `analysis-cache.js` incluye día, versión y revisiones de todos los almacenes; se invalida al escribir/importar/borrar. Vive solo en memoria. `stats.js` también reutiliza índices para los mismos datos: no modificar sus entradas silenciosamente y esperar un recálculo sin actualizar el store/contexto de datos.

### 7.8 Informe para análisis externo

`analysis-report.reportText()` produce perfil, objetivos, contexto/cambios, peso, fuerza, marcas, volumen, deportes, récords reales, estimaciones y predicción por separado, carga, recuperación, eventos, conclusiones/confianza y una pregunta para la IA. La interfaz permite copiar el texto. El ciclo se excluye por defecto (`includeCycle=false`) y solo se añade si se solicita. El informe no sustituye una copia JSON; puede contener información personal si el usuario lo genera con sus datos. No existe envío automático, API de IA ni coste de inferencia dentro de Entreno.

## 8. Copias, seguridad de importación y recuperación

### 8.1 JSON y comprobación

`store.exportData()` produce `{app:'entreno-pwa',format:2,appVersion,exportedAt,data}` con los 12 almacenes ordinarios. `backup.buildBackupFile()` añade `integrity:{algorithm:'sha256',hash,stores}`. El hash cubre `JSON.stringify(data)`; los recuentos ayudan a explicar diferencias. No es firma, contraseña ni cifrado: alguien puede recalcularlo y el archivo sigue conteniendo datos legibles.

SHA-256 es síncrono (`sha256.js`) para construir y compartir desde el toque válido en iOS. La sustitución por Web Crypto asíncrono no es trivial: podría perder el gesto o requerir precálculo e invalidación. La decisión y vectores de prueba constan en `RONDA11.md` y las pruebas de integridad.

«Comprobar copia» lee y describe estructura, formato, fechas, secciones y sello sin escribir datos ni actualizar la fecha de copia o el punto de restauración. Distingue verificada, sin sello, sello distinto y método no reconocido. Una copia antigua sin sello se acepta con esa advertencia; un sello que no coincide se bloquea antes de restaurar, incluso desde `store.importData()`. Un método desconocido no debe describirse como integridad comprobada.

`validateBackup()` exige identificador de app, formato entero admitido (1/2), datos, secciones obligatorias como listas, ids válidos sin duplicados, ajustes y tipos mínimos necesarios para que las vistas funcionen. Formato 1 puede no traer ciclo y las tres secciones añadidas en formato 2; las ausentes llegan vacías. Se advierte de pérdida de secciones nuevas con datos actuales. No hay validación relacional completa de todas las posibilidades semánticas.

### 8.2 Exportación y fecha de copia

En iPhone se usa la hoja de compartir; si se cancela no consta copia hecha. Como iOS puede cerrar la hoja con éxito aunque se cancele «Guardar en Archivos», Entreno pregunta si el archivo se guardó antes de actualizar `lastBackupAt`. En navegadores sin compartir archivos se ofrece descarga. El recordatorio predeterminado es de siete días, con margen desde instalación para la primera copia y opción de posponer su aviso de Hoy.

Guardar fuera del navegador es una acción del usuario. Una fecha reciente no demuestra que el archivo siga disponible ni que sea la copia más actual; el sello tampoco demuestra actualidad. El JSON completo es la vía de traslado entre Safari, PWA instalada y otro dispositivo; no hay sincronización de fondo.

### 8.3 Sustituir datos y punto de restauración

Importar un JSON **sustituye todos los datos**, no fusiona historiales. El flujo de Ajustes explica pérdida, ofrece exportar antes si hay contenido propio y pide confirmaciones. Antes de importar o borrar todo, el store:

1. Vacía escrituras pendientes y crea un punto con el contenido actual si merece protección.
2. Lo escribe en metadatos reservados, lo relee y verifica contenido/recuentos.
3. Si no cabe o no puede comprobarlo, cancela la sustitución/borrado.
4. Sustituye los almacenes en una transacción `db.replaceAll()`; si falla esa escritura, intenta devolver el punto anterior.
5. Actualiza memoria y compatibilidad; emite reset. La interfaz limpia borradores auxiliares.

Solo existe el último punto. Borrar de nuevo una instalación vacía no pisa el punto con el historial que se quería proteger. Recuperar intercambia el estado actual protegido con el anterior en la misma transacción; se puede eliminar el punto explícitamente. No viaja en JSON, no se carga como datos ordinarios y desaparece si se borran los datos del sitio. **No es una copia externa**.

`db.replaceAll()` es atómico para la sustitución; los pasos de compatibilidad posteriores son adicionales. No extender la afirmación de atomicidad a toda operación futura, si incorpora más escrituras fuera de la transacción.

### 8.4 CSV y borrado

Se exportan CSV de fuerza y de actividades. Fuerza incluye configuración de material al final. Modo Excel español: separador `;`, coma decimal y BOM UTF-8; modo estándar: coma y punto decimal. Se escapan textos y se protege la interpretación de fórmulas en Excel. CSV sirve para análisis, **no es un formato de restauración completa** de rutinas/perfil/contexto/ciclo.

«Borrar todos los datos» confirma dos veces, protege con punto cuando procede y repone la instalación inicial. El punto se puede eliminar aparte si se quiere quitar también la recuperación local. No se debe usar ese flujo como una operación de mantenimiento rutinaria o para «arreglar» una migración sin preservar copia.

## 9. Offline, actualización y publicación

`manifest.json` define `start_url` y `scope` relativos `./`, display standalone, orientación retrato, idioma español e iconos. Toda ruta de recursos debe funcionar bajo `/gym/`; un `/js/…` absoluto rompería la publicación en subruta.

`sw.js` precachea shell, JS, CSS, manifiesto e iconos. `check-assets.mjs` confirmó **111 archivos listados** existentes y sello correcto. La primera instalación necesita red y tiempo para completar el precaché; después la navegación usa `index.html` cacheado y los recursos usan caché primero. Las peticiones de otros orígenes no se interceptan. Fallos sin caché devuelven error offline; no hay garantía de abrir algo que nunca se llegó a instalar.

Cada `VERSION` produce otra caché. Durante instalación el SW rechaza reescribir una caché marcada activa con el mismo sello; evita mezclar código viejo y nuevo. En activación limpia cachés `entreno-*` anteriores, marca la activa y toma control. Primera instalación activa directamente; las siguientes esperan `SKIP_WAITING`.

`app.registerSW()` ofrece aviso persistente en raíces de pestaña, sin interrumpir formularios/sesión. «Actualizar» solicita activar; un cambio de controlador vacía pendientes y recarga según las condiciones del arranque. «Ahora no» lo oculta hasta próxima vuelta a primer plano. Una activación desde otra pestaña también puede provocar el cambio de controlador; no prometer que otra pestaña nunca afectará a la abierta.

`scripts/stamp-sw.mjs` calcula hash de rutas/contenidos de ASSETS y SW con la línea de versión neutralizada, normalizando texto CRLF a LF y conservando binarios. Tras un cambio de aplicación se ejecuta `npm run stamp` antes de publicar y después `npm run check`. **No se ejecutó stamp en esta tarea documental**. `docs/` no forma parte del precaché ni modifica su sello.

Desarrollo/publicación futuros: rama separada, cambio localizado, pruebas relevantes, comprobación de recursos/sello, revisión y autorización para publicar según el encargo. Pages sirve archivos estáticos sin build de aplicación. Volver a un commit anterior de recursos no implica revertir IndexedDB; comprobar compatibilidad de versiones antes de una marcha atrás. No bajar `DB_VERSION` como estrategia de reversión.

## 10. Pruebas y trabajo de desarrollo

### 10.1 Resultado de esta revisión

| Comprobación | Resultado actual |
|---|---|
| Node | `v24.22.0` en Windows/PowerShell. No es una declaración de versión mínima universal. |
| `npm run check` | Correcto: precaché/sello y **834 pruebas, 834 correctas, 0 fallos, 0 omitidas**. Duración del runner unitario aproximada: 7,8 s. |
| E2E Chromium/WebKit | **No verificado en esta revisión**: `require('playwright')` no resolvió el módulo con la raíz global npm disponible. No se instalaron paquetes/navegadores. |
| Pruebas de iPhone real | **No verificado**. No se accedió al dispositivo ni a sus datos. |
| Historial de resultados E2E y mediciones | **DOCUMENTADO PERO NO VERIFICADO** como resultado actual. Existen informes y tests; sus cifras históricas no se presentan como una ejecución de hoy. |

Las pruebas usan `node:test`, aserciones y fixtures sintéticos; E2E utiliza Playwright con contexto nuevo, locale es-ES, zona Europe/Madrid e iPhone 13 emulado. Por defecto bloquea SW, por lo que offline requiere un caso con SW permitido. WebKit omite pruebas específicas de CDP cuando procede; no interpretar todos los omitidos como un fallo de aplicación ni todos los pases Chromium como prueba de Safari real.

### 10.2 Comandos correctos

Desde la raíz del repositorio:

```powershell
npm run serve
# http://127.0.0.1:8080/
npm test
npm run check
node scripts/check-assets.mjs
```

`scripts/run-unit.mjs` enumera archivos y falla si no se ejecutan pruebas. Usar `npm test`, evitando confiar en la expansión de `tests/unit/*.test.mjs` en PowerShell/cmd.

Los scripts npm `e2e`, `e2e:webkit` y `perf` contienen sintaxis Unix (`NODE_PATH=$(npm root -g)`, asignación de variable ante comando). En PowerShell, **si Playwright y el motor ya están disponibles**, el equivalente es:

```powershell
$env:NODE_PATH = (npm root -g)
$entrenoE2eFiles = @(Get-ChildItem -LiteralPath tests/e2e -Filter '*.test.cjs' |
    Sort-Object Name | ForEach-Object FullName)
node --test --test-concurrency=4 @entrenoE2eFiles
# Para la batería WebKit:
$env:E2E_BROWSER = 'webkit'
node --test --test-concurrency=3 @entrenoE2eFiles
Remove-Item Env:E2E_BROWSER
```

Los helpers levantan su servidor de pruebas y contextos aislados. No dirigirlos a una sesión personal con datos. `tests/serve.mjs` permite servidor manual; `tests/realistic-data.mjs` y fixtures generan historias sintéticas. Los scripts `perf-*` y `measure-*` son mediciones de desarrollo, sin afirmar cifras de iPhone a partir de escritorio. Inspeccionar cualquier script antes de ejecutarlo y evitar los que escriban recursos en una tarea de solo documentación.

### 10.3 Mapa funcional → código → datos → pruebas

En la columna de pruebas, `U:` significa archivo bajo `tests/unit/` y `E:` bajo `tests/e2e/`; son referencias existentes, no una afirmación de ejecución E2E hoy.

| Función | Archivos principales | Datos | Pruebas relacionadas |
|---|---|---|---|
| Arranque, rutas y sesión reanudada | `app.js`, `router.js`, `index.html` | meta, sessions, scroll/actividad local | U: `setup.test.mjs`, `seed.test.mjs`; E: `core.test.cjs`, `setup.test.cjs`, `splash.test.cjs`, `transitions.test.cjs` |
| Rutinas/biblioteca | `library-logic.js`, `pickers.js`, vistas exercises/templates | exercises, templates | U: `library.test.mjs`; E: `library.test.cjs`, `week-setup.test.cjs` |
| Ejecutar/cerrar fuerza | `session-logic.js`, `views/session.js`, tarjetas/resumen | sessions, exercises, templates, checkins | U: `session.test.mjs`, `session-fold.test.mjs`; E: `session.test.cjs`, `session-long.test.cjs`, `session-polish.test.cjs`, `undo.test.cjs` |
| Material, lastre, calentamiento | `calc.js`, `session-logic.js`, `session-view-card.js` | setup y series, bodyweight, ajustes | U: `setup.test.mjs`, `warmup.test.mjs`, `calc.test.mjs`; E: `setup.test.cjs`, `warmup.test.cjs` |
| Comparar fuerza/celebrar | `session-compare.js`, `celebrate*.js`, CSS | sesiones equivalentes y PRs | U: `session-compare.test.mjs`, `celebrate.test.mjs`; E: `celebrate.test.cjs` |
| Actividades y senderismo | `activity-logic.js`, `views/activity.js`, `sanity.js` | sessions y borradores | U: `activity.test.mjs`, `hike.test.mjs`, `sanity.test.mjs`; E: `activity.test.cjs`, `hike.test.cjs`, `form-drafts.test.cjs` |
| Importar formatos y proteger recursos | `import-parse.js`, `import-zip.js`, `import-logic.js` | archivos → sesiones normalizadas | U: `import.test.mjs`, `import-limits.test.mjs`; E: `import.test.cjs`, `import-splits.test.cjs` |
| Tramos y récords reales/estimados | `best-efforts.js`, `stats.js`, vista progress | track/laps/bestEfforts, context | U: `best-efforts.test.mjs`, `records-partials.test.mjs`, `race-records.test.mjs`; E: `records-partials.test.cjs`, `race-records.test.cjs` |
| Calendario/adherencia/historial | `plan.js`, `plan-ui.js`, `history-logic.js`, vistas | weekPatterns, plan, sessions | U: `plan.test.mjs`, `stats.test.mjs`; E: `calendar.test.cjs`, `long-history.test.cjs` |
| Progreso/gráficas/mapa | `stats.js`, `charts.js`, `chart-summary.js`, `bodymap.js`, vista progress | sessions, exercises, bodyweight, plan | U: `stats.test.mjs`, `charts.test.mjs`, `bodymap.test.mjs`, `exercise-glance.test.mjs`; E: `progress.test.cjs`, `charts.test.cjs`, `bodymap.test.cjs` |
| Contexto en gráficas | `chart-context.js`, `context-logic.js` | context, races, sessions | U: `chart-context.test.mjs`; E: `chart-context.test.cjs` |
| Panel, progresión y fatiga | `insights.js`, `progression.js`, `focus.js` | series, RPE, checkins, ajustes | U: `insights.test.mjs`, `progression-decision.test.mjs`, `strength-coherence.test.mjs`, `focus.test.mjs`; E: `weekly.test.cjs`, `focus-disclosure.test.cjs` |
| Peso y análisis de energía | `activity-logic.js`, `analysis-weight.js`, vista bodyweight | bodyweight, perfil, context, ciclo | U: `activity.test.mjs`, `analysis-weight.test.mjs`; E: `activity.test.cjs`, `analysis.test.cjs` |
| Objetivos y predicciones | `goals-logic.js`, `race-predict.js`, vistas | goals, sessions, context | U: `goals.test.mjs`, `race-predict.test.mjs`, `prediction-coherence.test.mjs`; E: `goals.test.cjs`, `predictions.test.cjs`, `prediction-coherence.test.cjs` |
| Eventos/resultados | `races-logic.js`, `races-progress.js`, `races-result.js`, vistas | races, goals, sessions, context | U: `races.test.mjs`, `races-result.test.mjs`, `race-results.test.mjs`; E: `races.test.cjs`, `race-outcome.test.cjs`, `race-results.test.cjs` |
| Perfil/contexto/marcas antiguas | `profile.js`, `context-logic.js`, `past-records-logic.js` | meta.profile, context, pastRecords | U: `profile.test.mjs`, `context.test.mjs`, `past-records.test.mjs`; E: `profile.test.cjs`, `context.test.cjs`, `past-records.test.cjs`, `onboarding.test.cjs` |
| Check-ins/recuperación/ciclo | `checkin-logic.js`, `recovery-logic.js`, `cycle-logic.js`, vistas | checkins, cycle, perfil | U: `checkin.test.mjs`, `recovery-logic.test.mjs`, `cycle.test.mjs`; E: `checkin-zones.test.cjs`, `recovery.test.cjs`, `cycle.test.cjs` |
| Analista/híbrido/informe/caché | `analysis*.js`, `confidence.js`, vistas analysis/focus | conjunto de datos y revisiones | U: `analysis-training.test.mjs`, `analysis-hybrid.test.mjs`, `analysis-report.test.mjs`, `analysis-cache.test.mjs`, `analysis-consistency.test.mjs`; E: `analysis.test.cjs`, `analysis-hybrid.test.cjs`, `analysis-cache.test.cjs` |
| JSON, integridad y recuperación | `store.js`, `db.js`, `backup.js`, `sha256.js`, vista settings | todos los almacenes y meta reservado | U: `backup.test.mjs`, `integrity.test.mjs`; E: `restore-invalid.test.cjs`, `restore-point.test.cjs`, `check-backup.test.cjs`, `migration.test.cjs` |
| Accesibilidad y sensación móvil | `ui.js`, `router.js`, CSS y vistas | estado UI y preferencias | E: `gestures.test.cjs`, `large-text-rows.test.cjs`, `native-feel.test.cjs`, `inputs.test.cjs`, `visual-guard.test.cjs` |
| Offline/sello de recursos | `sw.js`, `stamp-sw.mjs`, `check-assets.mjs` | recursos, Cache Storage | U: `assets.test.mjs`; E: `smoke.test.cjs`, `core.test.cjs` |

## 11. Riesgos, límites y propuestas separadas

| Estado | Punto y efecto práctico |
|---|---|
| **LIMITACIÓN O PROBLEMA CONOCIDO** | Datos locales por navegador/origen/instalación. Borrado del sitio, pérdida del dispositivo, falta de espacio o decisiones de iOS pueden eliminar historial y punto de recuperación. Exportar JSON fuera del navegador es esencial. |
| **LIMITACIÓN O PROBLEMA CONOCIDO** | No hay sincronización multidispositivo ni recuperación desde cuenta/servidor. Safari y la PWA pueden tener almacenes distintos; trasladar mediante copia comprobada. |
| **LIMITACIÓN O PROBLEMA CONOCIDO** | Formato 1 antiguo puede carecer de ciclo y vaciarlo al sustituir. El aviso de secciones nuevas se centra en context/pastRecords/races; no prometer aviso exhaustivo de ciclo. |
| **LIMITACIÓN O PROBLEMA CONOCIDO** | Objetivos de fuerza y marcas históricas manuales miran todo el historial, mientras progreso/récords/estancamiento distinguen material. Un objetivo puede cumplirse en otra máquina. Decisión conservada en RONDA11. |
| **LIMITACIÓN O PROBLEMA CONOCIDO** | Importaciones deportivas por lote pueden quedar parcialmente guardadas; picos GPS no se reprocesan al cambiar deporte en vista previa. |
| **LIMITACIÓN O PROBLEMA CONOCIDO** | Sin puntos originales ni mapa de recorrido. Los derivados de carrera no son una grabación GPS ni evidencia de precisión perfecta. |
| **LIMITACIÓN O PROBLEMA CONOCIDO** | Una sesión inactiva más de 60 minutos activa tratamiento de olvidada; se puede continuar o revisar su duración. No confundirlo con cerrar automáticamente una sesión larga activa. |
| **LIMITACIÓN O PROBLEMA CONOCIDO** | Copias sin cifrar y sello sin autenticación. Solo el usuario decide almacenamiento y compartir; este trabajo no ha incluido credenciales ni datos personales. |
| **DOCUMENTADO PERO NO VERIFICADO** | Resultados y tiempos históricos E2E/performance de informes. No trasladar la antigua tarea de ~800 ms a una incidencia actual sin medir: existen optimizaciones posteriores de montaje progresivo e índices. |
| **No verificado** | Apariencia final y gestos reales del iPhone, VoiceOver integral, espacio/persistencia concedida y versión de SW activa en ese dispositivo. |
| **IDEA FUTURA NO IMPLEMENTADA** | Sistema general de migraciones puras por schema; RONDA11 propone diseño, pero hoy existe compatibilidad aditiva en `store.migrate()`. `createRestorePoint()` es interna, no una API pública exportada lista para invocar desde una migración nueva. |
| **IDEA FUTURA NO IMPLEMENTADA** | Aplicación nativa/App Store, sincronización externa o servicios de IA. Ninguna debe introducirse por interpretar un estudio o el informe copiable como requisito vigente. |
| **IDEA FUTURA NO IMPLEMENTADA** | Visor completo de parciales en ficha de actividad y centralización adicional de metadatos de formatos de copia citados como mejoras históricas. No forman parte de una lista de trabajo autorizada. |

No se ha reconstruido una lista global de defectos ni abierto incidencias. Los problemas ya corregidos (sello Windows, restauración de sello incorrecto, mezcla de estimaciones con récords reales) no se presentan como errores pendientes.

## 12. Guía de continuidad para otro agente

1. Leer el documento breve y consultar esta maestra según el área; comprobar rama, HEAD, estado de trabajo y publicación de nuevo. Esta fotografía puede quedar antigua.
2. Comprender el flujo en la vista, seguir la lógica que llama, su modelo y pruebas antes de editar. Distinguir cambios de UI de cambios en reglas o persistencia.
3. Buscar funciones existentes en el mapa: `targetText`, `runMarkFor`, `predictFor`, `progressionHint`, `fatigueState`, `analysisWeightTrend`, `weekFocus`. Reutilizarlas para conservar criterios comunes.
4. Trabajar en una rama separada; conservar cambios ajenos. No ejecutar migraciones, importar copias o borrar almacenamiento real como parte de una prueba.
5. Mantener ids, campos opcionales y fechas locales. Para un campo aditivo, valorar compatibilidad sin subir DB_VERSION/schema/formato por rutina. Para cambios de forma, diseñar y probar recuperación antes de migrar.
6. Usar `save/saveSoon/remove/restore` y los contadores del store; no escribir directamente IndexedDB desde una vista ni mutar datos sin notificar el cambio y esperar que una caché se actualice.
7. Probar el comportamiento afectado y sus reglas cruzadas. En importación/copias incluir casos antiguos, dañados, duplicados, fallo de escritura y deshacer. En análisis incluir poca muestra y mensajes contradictorios; en interfaz, texto grande, teclado, foco y movimiento reducido.
8. Si se añade un archivo de ejecución, incluirlo en ASSETS. Tras cambios de app, sellar y ejecutar check; no modificar SW para una simple documentación que no se sirve dentro de la aplicación.
9. Antes de publicar, preparar cambio y comprobaciones revisables; respetar autorización y posibilidad de reversión. Verificar Pages y su SW tras publicar, y que el propietario pueda probarlo en su iPhone.
10. Actualizar los documentos cuando cambien contratos, rutas, modelo o decisiones. Mantener etiquetas de evidencia y separar propuestas. No inventar el historial personal ni dar por implementado un futuro deseable.

### Qué se hizo en este encargo

Se crearon únicamente `docs/ENTRENO_DOCUMENTACION_MAESTRA.md` y `docs/ENTRENO_INICIO_CHAT.md` en el repositorio, con copias de esos mismos documentos en `%USERPROFILE%\Downloads\Entreno-documentacion` y en la carpeta de entregables de este chat. No se modificaron código, pruebas, dependencias, service worker, estructuras ni datos personales. No se ejecutó la aplicación sobre la base del iPhone, ni migraciones, despliegues, push o merge. El estado de pruebas y de publicación indicado corresponde a las comprobaciones descritas, no a una suposición sobre el dispositivo.
