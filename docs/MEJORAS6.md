# Mejoras (ronda 6) — contexto del usuario · contrato

Idea central: **DATO → CONTEXTO → INTERPRETACIÓN → CONFIANZA → RECOMENDACIÓN**, sin precisión falsa: con datos
insuficientes se dice; recomendaciones conservadoras, explicables y basadas en los datos personales. Evoluciona la
arquitectura existente (nada de reescrituras); todo sigue local, sin cuentas ni servidor y sin conexión.

## Fases
| Fase | Contenido |
|---|---|
| 0 | WebKit (motor de Safari) en Playwright junto a Chromium; `scripts/perf-startup.cjs` y medición base |
| A | IndexedDB v3 (`context`, `pastRecords`, `races`), copia formato 2, perfil ampliado, contexto (fases + hechos, también anteriores a la app), onboarding |
| B | Check-in ampliado (< 10 s: estrés, agujetas por zona 0–10 con el mapa corporal, dolor/molestia) y marcas históricas |
| C | `confidence.js` común + insight ampliado (observación, contexto, interpretación, confianza, recomendación, evidencia) |
| D | Volumen con contexto, vuelta/recuperación de marcas, modo híbrido, carga por deporte |
| E | Eventos deportivos (`races`, enlazables a un objetivo de resistencia) |
| F | Informe para IA (contexto, cambios recientes, datos con baja confianza) |
| G | Caché persistente: antes, comparar contadores de revisión con otras estrategias y elegir la más robusta (corrección > ms) |
| H | Flujos en WebKit + checklist manual en iPhone real + regresión completa |

Tras cada fase: pruebas relevantes + unitarias completas, compatibilidad con datos antiguos, resumen y commit.

## Decisiones del usuario
- `races` es un almacén propio, enlazado opcionalmente con `goals` (`goalId`); el modelo de objetivos no cambia.
- Edad: `profile.birthDate` completa ('YYYY-MM-DD'), opcional; perfiles y copias sin ella siguen funcionando
  (edad desconocida → reglas de adulto general, sin suposiciones).
- Agujetas antiguas (`checkins.soreness` 1–3): no se convierten a 0–10 ni se les inventa zona; solo cuentan como
  indicador general histórico.
- Caché (fase G): estudiar primero contadores de revisión por dominio guardados en `meta` (cada alta/cambio/borrado
  incrementa; el resultado guarda las revisiones con que se calculó) frente a otras opciones.
- La línea temporal de contexto admite hechos anteriores a la app con fecha aproximada («Verano 2026: entrenamiento
  irregular», «Peso habitual previo: 75 kg»).

## Fase A — modelo de datos

### IndexedDB v3 (`js/db.js`)
Solo se AÑADEN almacenes (keyPath `id`); `onupgradeneeded` crea los que falten y no toca los existentes. No hay
reescritura de registros: los campos nuevos son opcionales y se completan al leer (`getProfile`, `normalizeContext`…).

- `context` — línea temporal del usuario. Dos clases en el mismo almacén (se consultan juntas):
  ```
  Fase:  { id:'ctx_…', kind:'phase', type, start:DateApprox, end:DateApprox|null, title?, text, goalIds:[], sports:[],
           notes, createdAt, updatedAt }
  Hecho: { id:'ctx_…', kind:'event', type, date:DateApprox, text, value?:{ kg? }, notes, createdAt, updatedAt }
  DateApprox = { date:'YYYY-MM-DD', precision:'day'|'month'|'season'|'year' }
  ```
  `date` es el primer día del periodo indicado (mes → día 1; estación → primer día de la estación; año → 1 ene);
  `precision` dice cómo mostrarlo («ago 2026», «verano 2026») y cuánto margen tiene al analizar. Fase sin `end` =
  vigente. Tipos de fase: `gain`, `deficit`, `maintain`, `recomp`, `return` (vuelta tras parón), `recondition`,
  `prep_5k`, `prep_10k`, `prep_half`, `prep_marathon`, `prep_cycling`, `hybrid`, `deload`, `illness`, `injury`,
  `travel`, `stress`, `custom`. Tipos de hecho: `creatine_start`, `creatine_stop`, `gym_return`, `holidays`, `illness`,
  `routine_change`, `nutrition_change`, `injury`, `usual_weight` (con `value.kg`), `weight_note` (con `value.kg`), `other`.
- `pastRecords` — marcas históricas manuales (fase B): `{ id, exerciseId, weight, reps, date:DateApprox|null, note,
  createdAt, updatedAt }`. Separadas de los récords calculados (`stats.js`).
- `races` — eventos deportivos (fase E): `{ id, name, type, date, distanceKm, targetSec|null, priority, note,
  goalId|null, createdAt, updatedAt }`.

#### Fases simultáneas y datos estructurados (cierre de la fase A)
- Pueden estar vigentes varias fases a la vez (p. ej. ganancia muscular + preparación 10K + exámenes). Cada tipo de fase
  tiene un `aspect`: `body` (composición), `training` (parón, vuelta, descarga), `sport` (preparaciones, híbrido),
  `life` (enfermedad, lesión, viaje, estrés) o `custom`.
- `contextOn(list, date)` → TODAS las fases vigentes (de la más reciente a la más antigua; a igualdad, la última creada).
- `contextSummary(list, date)` → lo que recibirá el análisis: `phases`, `byAspect`, `types` (Set), `events` del día,
  `usualWeight` y `weights` (`weightReferences`: peso habitual y pesos en una fecha como números con su rango de
  fechas y precisión). Ningún cálculo lee números del texto libre: los hechos de peso guardan `kg` (20–400) aparte del
  texto. Si más adelante otro hecho necesita un número (p. ej. una dosis), tendrá su campo propio y validado, no un
  «valor + unidad» genérico.
- Hoy: una sola línea. Una fase: «Vuelta tras vacaciones o parón · desde sep 2026»; varias: sus nombres
  («Exámenes o época de estrés · Preparación 10K · Ganancia muscular», hasta 3 y «+N»). «Ahora» (en #/context) las
  lista todas.

### Copias (`store.js`)
`BACKUP_FORMAT` pasa a 2: la app nueva acepta copias 1 y 2 (en una copia 1 los almacenes nuevos llegan vacíos); una
versión antigua de la app rechaza la copia 2 («versión más nueva») en vez de perder en silencio los datos nuevos.
Restaurar sustituye todo. Si la copia no trae una sección nueva (copia de formato 1) y en el iPhone hay datos en ella,
la confirmación lo dice antes de «Sustituir todo» (`backup.lostSectionsWarning`): «Esta copia se hizo con una versión
anterior de la app y no contiene contexto, marcas históricas ni eventos deportivos. Al restaurarla se borrará lo que
tienes ahora en esa sección: 2 apuntes de contexto.»

### Perfil (`settings.profile`, `js/profile.js`)
Campos nuevos (todos opcionales): `birthDate`, `secondaryGoals:[]`, `sports:[]`, `limitations` (texto),
`weeklyFrequency` (días/semana), `onboardedAt` (ms). Grupo de edad: `minor` (< 18), `adult`, `senior` (≥ 65) o
`unknown` sin fecha. Los días habituales salen de la semana tipo (no se duplican en el perfil).

### Onboarding (`#/welcome`, `js/views/welcome.js`)
- Perfil nuevo (`isNewProfile`: sin sexo, objetivo ni experiencia y sin `onboardedAt`): la tarjeta de Hoy «Completa tu
  perfil (30 s)» (misma posición y textos) lleva a la bienvenida: 3 pasos saltables (Sobre ti · Tu entrenamiento ·
  Ahora mismo). Cada respuesta se guarda al momento; «Listo» o «Saltar y terminar» marcan `onboardedAt` y, si se eligió
  una fase, la crean en `context` (desde el mes actual). Nunca se abre sola.
- Perfil a medias o ya pasado por la bienvenida: «Completar» lleva a `#/settings/profile`, como antes.
- Usuarios existentes con el perfil básico completo: Hoy no cambia; invitación discreta en Análisis
  («Completa tu perfil para mejorar el análisis (…)», `.an-profile-more`) hasta que añadan fecha de nacimiento,
  deportes y días por semana. Los campos nuevos están en `#/settings/profile` (fecha de nacimiento, otros objetivos,
  qué practicas, días por semana, molestias) con acceso a «Tu contexto».

### Contexto en la interfaz
- `#/context` (lista: «Ahora» + historial), `#/context/new?kind=phase|event`, `#/context/:id` (editar, borrar con
  deshacer). Fechas: Día (selector de fecha) · Mes · Estación · Año (desplegables, la rueda de iOS).
- Entradas: Ajustes (fila «Tu contexto» bajo Perfil), Perfil, Hoy (una sola línea «Ahora: …» si hay una fase vigente).

## Fase B — check-in ampliado y marcas históricas

### Check-in (`js/checkin-logic.js`, `js/checkin.js`)
- Cuatro preguntas, cada una Bajo · Normal · Alto (1/2/3): sueño, energía, **estrés** (nueva) y agujetas. Se contestan
  en 4 toques; la franja plegada de la sesión muestra las cuatro en 44 px.
- **Agujetas o molestias por zona** (opcional, debajo): «Añadir zona» abre una hoja: Agujetas (músculo, tocando el mapa
  corporal en modo elegir) o Molestia o dolor (articulación: cuello, hombro, codo, muñeca, zona lumbar, cadera, rodilla,
  tobillo, pie, otra); lado (izquierda, derecha, ambos; opcional); intensidad 0–10; nota. Una por zona y lado (volver a
  apuntarla la sustituye); tocar su ficha la edita o la quita. El mapa marca lo ya apuntado por intensidad (1–3 · 4–6 ·
  7–10) y se carga solo al abrir la hoja.
- Datos: `stress` y `areas` opcionales en el mismo registro (sin migración: los antiguos se leen igual, con «—» en
  estrés). `soreness` 1–3 sigue siendo el indicador general y NO se convierte a 0–10 (decisión del usuario). Una zona
  sola ya guarda el check-in; sin nada se elimina.
- Regla de check-in «bajo» SIN cambios (sueño o energía bajos, o agujetas altas): el estrés y las zonas se guardan y se
  ven (también en el «¿Por qué?» del panel semanal), pero no cambian ninguna regla hasta las fases C y D.
- Editar después: Calendario › día muestra el check-in de ese día (antes / después con sesión de fuerza, «Ese día» sin
  ella) con «Editar check-in», o «Añadir check-in» en días pasados y hoy (p. ej. las agujetas del día siguiente). Hoy no
  gana tarjetas: sigue ofreciendo el check-in solo si aún no hay ninguno.

### Marcas históricas (`js/past-records-logic.js`, `js/views/past-records.js`)
- Récords › Fuerza › «Marcas históricas» (`#/records/past`), y desde la ficha de progreso de cada ejercicio. Por marca:
  ejercicio (peso × reps, unilateral o peso corporal), peso (unilateral: por lado; peso corporal: lastre o asistencia),
  repeticiones (1–50), RIR opcional, fecha aproximada opcional (día · mes · estación · año, o sin fecha), «Anterior a
  Entreno» (encendido por defecto), peso corporal de entonces (solo peso corporal, opcional) y nota.
- Separadas siempre de los récords de Entreno: Récords los sigue calculando solo con lo registrado.
- **Porcentaje recuperado** («Rendimiento actual ≈ 94 % de tu mejor marca histórica»):
  - ahora = el mayor 1RM estimado de tus series de trabajo de los últimos 28 días;
  - referencia = el mayor 1RM estimado entre tus marcas históricas y lo registrado en Entreno antes de esos 28 días (se
    dice cuál: «tu mejor marca histórica» o «tu mejor marca anterior en Entreno»);
  - porcentaje = ahora ÷ referencia × 100, redondeado a la unidad; ≥ 100 % → «ya la has superado».
  - 1RM estimado = el mismo cálculo de toda la app (Epley con reps + RIR; sin RIR, como al fallo; solo series de 1 a
    12 repeticiones). En peso corporal la carga es peso corporal + lastre: el de entonces sale de la marca, del pesaje
    más cercano (± 14 días alrededor del periodo), del contexto (peso habitual o peso en esa fecha) o, si no hay nada,
    del peso actual (y se dice).
  - Sin porcentaje (y se explica por qué): sin series de 1–12 reps en los últimos 28 días, marcas de más de 12 reps,
    core de peso corporal (sin 1RM estimado), o nada con lo que comparar.
  - «¿Cómo se calcula?» muestra los números concretos (ahora, referencia, división) y las notas (estimación, RIR
    supuesto, fecha aproximada, de dónde sale el peso corporal).
- Lo que esta fase NO hace (fases C y D): interpretar si una subida rápida es recuperación, mejora real o adaptación
  inicial, ni usar el contexto de vuelta tras un parón; aquí solo se mide.

## Fase C — confianza común y análisis con contexto

### Confianza (`js/confidence.js`)
- Cuatro niveles, NO probabilidades: `insufficient` (datos insuficientes) · `low` · `medium` · `high`. Cada análisis
  describe sus factores y la confianza es la del más débil (`combine`), con los motivos que la limitan («datos de solo
  23 días», «empezaste creatina hace 12 días», «solo 1 ejercicio»). Ayudas: `byCount`, `bySpan`, `byNoise`, `capAt`.
- Peso: pesajes (8 · 12 · 18), días cubiertos (14 · 21 · 28), variación diaria (> 0,9 % media, > 1,5 % baja), margen
  que incluye el 0, ciclo incompleto, y contexto reciente (creatina ≤ 14 días → baja; ≤ 6 semanas, vuelta a entrenar,
  cambio de fase ≤ 4 semanas o recuperar peso previo → media; enfermedad o lesión → baja).
- Fuerza (por ejercicio): sesiones (4 · 6 · 8), días (14 · 28 · 42), ruido entre sesiones (> 2,5 % media, > 4 % baja),
  cambio de rutina reciente → media; marca histórica sin fecha → baja, con fecha de año o estación → media. Las
  previsiones nunca pasan de «media» (son proyecciones).

### Formato del Insight (compatible)
Se mantienen `id, area, level, priority, title, text, why, sources, action`. Nuevos y opcionales: `confidence`
({ level, label, short, reasons }), `context` (hechos tenidos en cuenta) y `parts` ({ observation, interpretation,
recommendation }); `text` sigue siendo el texto completo. En el «¿Por qué?» se añaden al final «Contexto tenido en
cuenta» y «Confianza». Pantalla: insignia de confianza, línea «Contexto:» y «Qué hacer:» aparte; la tarjeta de Hoy
muestra la confianza de cada punto. Arriba de #/analysis, «Tu contexto» (lo vigente y los cambios recientes).

### Contexto del análisis (`js/analysis-context.js`)
`analysisContext({ context, sessions, today, profile })` usa `contextSummary` y `recentChanges` de la fase A y añade:
vuelta a entrenar (fase «Vuelta»/«Reacondicionamiento», hecho «Vuelvo al gimnasio» o DETECTADA: ≥ 3 semanas sin
sesiones y la vuelta en las últimas 8), creatina (último «Empiezo» sin «Dejo» posterior), fase de composición vigente,
enfermedad o lesión (vigente o terminada hace ≤ 14 días), peso habitual y grupo de edad.

### Peso
- La fase de composición vigente (ganancia, déficit, mantenimiento, recomposición) manda sobre el objetivo del perfil
  (se dice en la regla).
- «Vienes de una bajada»: al empezar la ventana del ritmo, la tendencia estaba ≥ 1,5 % por debajo del peso habitual
  apuntado o de su máximo de los 120 días previos (y aún no has vuelto a él).
- Si el ritmo SUBE por encima del rango y coincide con recuperar peso previo, la vuelta a entrenar o creatina (≤ 6
  semanas): «Subes rápido, pero hay contexto» → dato, por qué sería elevado, qué lo puede explicar en parte («podría
  corresponder a…»), «Mantén lo que haces y reevalúa en 3–4 semanas». Sin ajuste ni balance en kcal, sin proyección ni
  objetivo propuesto. Si BAJA fuera del rango con enfermedad, lesión o viaje: «Bajas, pero hay contexto».
- Con confianza baja y el ritmo fuera del rango: «Aún es pronto para ajustar» (no se cambia lo que comes), salvo si
  bajas demasiado rápido.
- «Peso y fuerza suben juntos» no afirma que sea músculo si hay contexto o recuperas marcas.
- Edad: menores de 18 → sin calorías (ni ajuste ni balance), sin ritmos de pérdida, sin «déficit», sin proyección ni
  objetivo de peso; tarjeta con tendencia y ritmo solamente (Lloyd et al., 2014). 65 o más → pérdida en la mitad prudente
  del rango (0,5–0,75 %) y ajustes de como mucho 250 kcal (Fragala et al., 2019).

### Fuerza
Por ejercicio que mejora: `kind` = `recovery` (por debajo del 97 % de tu mejor referencia: la mayor entre tus marcas
históricas y lo registrado antes de las últimas 4 semanas), `new_exercise` (primera sesión hace < 6 semanas, sin
marca), `new_best` (≥ 100 % de la referencia), `progress`, o `insufficient`. Insights nuevos: «Recuperando tu marca
anterior» (`strength-recovery`) y «Primeras semanas» (`strength-new`); el resumen dice «No estás necesariamente
progresando a X por encima de tu nivel: … estás recuperando rendimiento que ya habías alcanzado». La previsión de un
ejercicio en recuperación no pasa de su referencia. Menores: sin previsiones de 1RM y consejos de técnica y supervisión
en lugar de más series; 65 o más: tope prudente («avanzado») en la previsión y técnica y recuperación antes de más
volumen. Las marcas manuales siguen separadas de los récords de Entreno (solo se leen).

### Arreglo encontrado de paso
- Las gráficas redibujaban dentro del callback de su ResizeObserver: en WebKit eso daba el error «ResizeObserver loop
  completed with undelivered notifications» en Análisis. Ahora redibujan en el siguiente fotograma (prueba WebKit en
  `tests/e2e/analysis-context.test.cjs`: falla sin el arreglo, pasa con él).
- La tarjeta del peso decía «Calorías: sin cambios · estás en tu rango» cuando no se proponía ajuste por el contexto o
  por confianza baja (sin estar en el rango): ahora dice «por ahora: reevalúa en unas semanas».

## Fase D — entrenamiento híbrido, volumen y recuperación (`js/analysis-hybrid.js`)

Módulo PURO nuevo: `analyzeHybrid(data, { today, profile, context, strength, endurance })` → `{ sportLoad, volume,
volumeChanges, associations, doms, insights }`. `buildAnalysis` lo llama después de fuerza y resistencia; sus Insights
van a las tarjetas de Fuerza, Resistencia y Recuperación y al resumen como los demás, todos con su confianza.

### Carga por deporte
- La carga total de Progreso no cambia. Aquí se reparte con lo que ya calcula `weekAgg` (`stats.weeklySeries`): carga =
  minutos × esfuerzo (RPE 1–10) por deporte (fuerza, carrera, bici, natación, senderismo, otras). 3 h de ruta suave
  (RPE 3) son 540; 3 h de carrera a RPE 7, 1.260. Una sesión sin RPE no tiene carga (se cuenta y baja la confianza).
- Tabla «Carga por deporte» en Resistencia: media semanal de las 4 últimas semanas completas y su cambio frente a las
  4 anteriores. Pico de un deporte («Pico de carga en carrera»): la semana en curso ≥ 50 % por encima de su media de
  las 4 anteriores (≥ 3 semanas con carga y ≥ 120 de diferencia).
- Decisión: el análisis de energía del peso (REDs) sigue usando los minutos totales de resistencia (es gasto, no carga).

### Volumen con contexto
- Por músculo (media de series de las 4 semanas completas frente a su rango): **mantener** si sus ejercicios progresan
  aunque esté por debajo del rango («Estás progresando con el volumen actual. No hay una razón clara para aumentarlo.»);
  **reducir** (2–4 series/sem, 1–2 semanas) si hay agujetas fuertes repetidas (≥ 7/10 dos veces en 14 días) o señales
  de fatiga con ejercicios estancados o bajando, aunque esté dentro del rango; **añadir** 1–2 series solo si está por
  debajo, sin progreso, sin fatiga ni agujetas fuertes y con constancia (≥ 70 % de lo planificado en 4 semanas).
- Menores: nunca «añadir» (técnica y constancia primero). 65+: no se añade si hay fatiga o molestias.
- El consejo de estancamiento de la fuerza ya no propone «+1–2 series» si ese músculo debe reducir o si la constancia
  es baja.
- **Cambios de volumen** (`volumeChanges`): si el volumen de un músculo cambió de forma clara entre las 6 semanas
  completas anteriores y las 6 de antes (≥ 25 % y ≥ 2 series/sem), se compara el ritmo del 1RM estimado de sus
  ejercicios en cada bloque (≥ 6 sesiones en cada uno; ≥ 0,5 %/sem de diferencia): «Press banca progresa más desde que
  bajaste el volumen de pecho… Coincide en el tiempo, pero no demuestra que sea por el volumen». Antes / después →
  confianza media como mucho; baja si vuelves de un parón o hubo cambios recientes en tu contexto.

### Híbrido / interferencia con datos PERSONALES
Reglas comunes: ≥ 6 veces con el factor y ≥ 6 sin él, repartidas en ≥ 4 semanas (últimas 26), y diferencia apreciable
con efecto moderado (d de Cohen ≥ 0,5). Lenguaje: «en tus registros… aparece asociado a / coincide con», nunca «causa».
Con datos suficientes y SIN diferencia también se dice («Tu pierna tolera la resistencia del día antes»).

| id | Compara | Diferencia apreciable |
|---|---|---|
| `legs-after-endurance` | rendimiento de pierna con resistencia exigente el día antes vs. el resto | ≥ 3 % |
| `run-after-legs` | ritmo de los rodajes suaves al día siguiente de pierna vs. el resto | ≥ 2 % |
| `doms-after-leg-volume` | agujetas de pierna (24–72 h) con ≥ la mediana de series de pierna vs. menos | ≥ 1,5 / 10 |
| `perf-with-doms` | rendimiento con agujetas fuertes antes (general «altas» o una zona ≥ 6) vs. sin ellas | ≥ 3 % |
| `perf-with-stress` | rendimiento con estrés alto en el check-in vs. normal o bajo | ≥ 3 % |
| `skips-with-endurance` | % de días de fuerza planificados saltados o a medias en semanas con más carga de resistencia vs. el resto | ≥ 15 puntos |

- Rendimiento de una sesión: su mejor 1RM estimado por ejercicio frente al máximo de las 4 semanas previas (el mismo
  de Recuperación). Saltados o a medias: la adherencia del Calendario (`plan.weekPlan`, días de rutina).
- **findInterference evoluciona**: sigue siendo la regla general (cuenta las veces: «Resistencia intensa pegada a la
  pierna»); cuando hay datos personales suficientes para `legs-after-endurance`, `buildAnalysis` quita la regla general
  y enseña la asociación personal (con las últimas veces en su «¿Por qué?»), para no decir dos cosas sobre lo mismo.

### Agujetas por ejercicio (zonas de la fase B)
- Para cada ejercicio y su músculo principal: agujetas de ese músculo en los check-ins de 1 a 3 días después (24–72 h)
  tras las sesiones CON el ejercicio frente a las que trabajan ese músculo SIN él (≥ 6 y 6, ≥ 4 semanas, ≥ 1,5 puntos).
- Dentro de las sesiones con el ejercicio: series (mediana), RIR (0–1 frente a 2 o más) y carga (Σ peso × reps,
  mediana) frente a las agujetas; se enseña el factor con más diferencia («Más agujetas de cuádriceps con más series en
  Sentadilla»). Varias comparaciones a la vez → confianza media como mucho.
- Curva 24 / 48 / 72 h: media de cada día con ≥ 6 check-ins ese día; «Suelen notarse más a las 48 h».
- El rendimiento posterior con agujetas se mide en `perf-with-doms` (sesión con agujetas fuertes en el check-in previo).
- Sin check-ins con zonas, o con menos de 6 sesiones en cada grupo, no se concluye nada.

### Arreglos encontrados de paso
- **«Tu análisis» no se abría** con un objetivo elegido y ningún pesaje (fallo anterior a la ronda 6): la tarjeta del
  peso añadía un bloque de proteína/calorías vacío (`appendChild(null)`). Prueba: `tests/e2e/analysis-hybrid.test.cjs`
  (falla sin el arreglo, pasa con él).
- Prueba inestable del mapa corporal (`tests/e2e/bodymap.test.cjs`): leía la opacidad justo tras el toque y la
  atenuación tiene una transición de 160 ms; ahora espera a la condición (sin pausas fijas).
- El d de Cohen sin variación en un grupo salía como un número enorme en el «¿Por qué?»: ahora «más de 10».

### Coste
`buildAnalysis` en Node con los historiales del medidor (mediana de 7, intercalado): 3 meses 11 → 15 ms, 1 año
21 → 30 ms, 2 años 27 → 37 ms, 5 años 58 → 68 ms. Lo resuelve la caché de la fase G (no recalcular si nada cambió).

## Fase E — eventos deportivos (`races`)

### Datos (`js/races-logic.js`, puro y ligero)
- Almacén propio `races` (fase A, ya en la copia de formato 2), enlazable con un objetivo (`goalId`); el modelo de
  objetivos no cambia. Registro: `{ id, name, type, date, distanceKm|null, targetSec|null, priority, note, goalId|null,
  createdAt, updatedAt }`.
- Tipos: 5K · 10K · media maratón · maratón (carrera; distancia fija) · ciclismo · senderismo (distancia obligatoria) ·
  triatlón · otro (distancia opcional; «otro» necesita nombre). Prioridad A (principal) · B (importante) · C (de
  preparación). Objetivo enlazable: de resistencia, activo y del mismo deporte (triatlón y «otro»: cualquiera de
  resistencia).
- Decisión: la fecha es un día concreto (un evento futuro tiene fecha); se admiten fechas pasadas (eventos ya hechos,
  en «Pasados»).

### Pantallas
- `#/races` (Próximos y Pasados plegados), `#/races/new`, `#/races/:id` (editar, borrar con deshacer). Entradas:
  Objetivos y Predicciones (fila «Eventos deportivos» con el próximo) y la línea de Hoy.
- «Cómo vas» (`js/races-progress.js`): en carreras a pie, el veredicto de `race-predict.checkTarget` con el tiempo
  objetivo (probable · ajustado · hoy no, con su «¿Por qué?») o el rango previsto sin él; y el objetivo enlazado con
  `goals-logic.goalProgress`. Nada de lógica duplicada. Ciclismo, senderismo y triatlón: sin previsión.
- **Hoy**: como mucho UNA línea, tras «Ahora: …»: «🏁 10K · 73 días · objetivo <50:00» → la ficha. Se elige el evento
  A o B más cercano de los próximos 365 días; si no hay, uno C de los próximos 30. Hoy importa solo `races-logic.js`
  (ligero): la previsión (`races-progress.js` → race-predict) no entra en el arranque.
- Sin planificador: apuntar un evento no cambia la semana tipo ni el plan.

### Contexto del analista
`analysisContext({ …, races })` añade `events` (`racesContext`: los de las próximas 26 semanas, el más relevante y sus
textos); salen en «Tu contexto» de Análisis y los usará el informe (fase F). No cambian ninguna regla.

### Arreglo encontrado de paso
- La confirmación de «Borrar todos los datos» (y el resumen de una copia al importarla) no contaban las marcas
  históricas: con solo marcas decía «tus registros». Ahora cuenta marcas y eventos (prueba en
  `tests/e2e/races.test.cjs`: falla sin el arreglo, pasa con él). Ajustes › Copias y datos tiene la fila «Eventos
  deportivos».
