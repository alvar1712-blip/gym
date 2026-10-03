# Estado del trabajo

> Hoja de ruta viva: se actualiza en cada paso para poder retomar el trabajo en cualquier momento.

## Hecho
- [x] Base PWA (núcleo, service worker, IndexedDB, UI común) y guía de publicación (`docs/GUIA.md`)
- [x] **Fase 1** completa: registro de fuerza, actividades y peso, calendario y Hoy, plantillas y biblioteca, ajustes,
      copias y CSV. Revisión adversarial (71 hallazgos corregidos) y criterios de aceptación en verde.
- [x] Fase 2 · librería de gráficas SVG (`js/charts.js`)
- [x] Fase 2 · estadísticas y récords (`js/stats.js`)
- [x] Fase 2 · pantallas de Progreso, ficha de progreso por ejercicio, Récords y gráfica de peso (`js/views/progress.js`)
- [x] **Fase 2** completa: revisión (29 hallazgos corregidos), 180 pruebas unitarias y 80 E2E en verde
- [x] Fase 3 · construida: panel semanal con «¿Por qué?» (`js/insights.js`, `js/views/weekly.js`), check-in
      (`js/checkin-logic.js`, `js/checkin.js`, en la sesión de fuerza), objetivos (`js/goals-logic.js`,
      `js/views/goals.js`) según `docs/FASE3.md`
- [x] Fase 3 · integración: Hoy (check-in de hoy, resumen del panel y objetivos al final; «Empezar» sigue arriba) y
      Progreso (accesos «Panel semanal» y «Objetivos» + las dos tarjetas resumen); rutas `#/weekly`, `#/goals`,
      `#/goal/new`, `#/goal/:id`; APIs en `docs/ARCHITECTURE.md` §5 «Fase 3». 266 unitarias y 100 E2E en verde
- [x] Fase 3 · revisión adversarial y correcciones (panel, objetivos, check-in, integración). Rangos de series por
      músculo por defecto según §10: 10–20; más altos en espalda (14–22), core y pecho (12–22); 0–X en los indirectos
- [x] Fase 3 · **criterio de aceptación** «Cada sugerencia del panel muestra su "¿Por qué?" con los datos concretos que
      la generan»: `CRITERIO 6` en `tests/e2e/acceptance.test.cjs` (datos sembrados que disparan TODAS las sugerencias:
      «sube» en sus 6 variantes, «mantén» con sus 3 motivos, aviso de carga, aviso de km, descarga, «sin avisos de
      carga» y «sin señales de descarga»; abre cada «¿Por qué?» y comprueba la regla con los umbrales de Ajustes y las
      cifras). El criterio 5 (sin conexión) recorre también las pantallas de las fases 2 y 3
- [x] **Fase 3** completa: `stamp-sw` + `check-assets` OK, 282 unitarias y 102 E2E en verde (8 de aceptación), sin
      errores de consola; recorrido visual de Hoy, panel, objetivos, sesión con check-in y Progreso a 390×844 y 375×667

- [x] **Cierre**: documentación final (README, GUIA con primeros pasos, ARCHITECTURE §5), `stamp-sw`, batería completa
      (282 unitarias y 102 E2E en verde) y commit «Fase 3 completa»

- [x] **Ronda 4 de mejoras** (contrato `docs/MEJORAS.md`): senderismo (`kind:'hike'`), importar GPX/TCX/FIT (.gz, .zip),
      calentamiento sugerido plegado, tiempos previstos + «¿Puedo hacerlo?», resúmenes semanal/mensual/anual, mapa
      corporal (panel semanal y Progreso), transiciones tipo iOS y efecto cristal. Integración de accesos (Hoy,
      actividad nueva, Copias y datos, Progreso, Récords), `stamp-sw` + `check-assets` OK, 363 unitarias y 128 E2E en
      verde. Fuera por decisión del usuario: notas fijas por ejercicio, medidas corporales, km por zapatillas.
- [x] **Ronda 5** (contrato `docs/MEJORAS5.md`): gesto de «atrás» sin doble animación ni saltos, hojas con su entrada
      de historial y arrastre para cerrar, `.is-pressed`, títulos compactos, efecto tarjeta, píldora líquida y cristal
      más marcado; perfil (sexo, objetivo, experiencia); «tu analista» (peso, fuerza, resistencia, recuperación,
      previsiones, informe para IA) basado en estudios; modo mujer con ciclo menstrual completo. IndexedDB v2 (store
      `cycle`). `stamp-sw` + `check-assets` OK, 444 unitarias y 151 E2E en verde.
- [x] **Arranque más rápido con meses de datos** (la app se volvía lenta al entrar a medida que crecía el historial):
      `fmtNum` reutiliza un `Intl.NumberFormat` por formato (`toLocaleString` creaba uno en cada llamada: casi la
      mitad del tiempo al abrir); `addDays`/`diffDays`/`dow`/`isDateStr` con aritmética de días sin zona horaria
      (idénticos a los de antes, comprobado en 1,5 millones de casos y 7 zonas horarias); las tarjetas del final de Hoy
      (check-in, panel, objetivos, análisis) se calculan cada una en su tarea, después de pintar lo principal. Con un año
      de datos (CPU ×4), el bloqueo más largo al abrir pasa de ~750 a ~130 ms y el total de ~900 a ~350 ms. Las pruebas
      E2E que registraban series seguidas esperan 450 ms (el seguro contra doble toque es de 400 ms desde la ronda 5).
- [x] **Ronda 6 · fase 0** (contrato `docs/MEJORAS6.md`): WebKit (motor de Safari) en Playwright junto a Chromium
      (`scripts/setup-webkit.sh`, `npm run e2e:webkit`), `npm run perf` (arranque con 3 meses, 1, 2 y 5 años) y
      `docs/PRUEBAS.md`.
- [x] **Ronda 6 · fase A**: IndexedDB v3 (`context`, `pastRecords`, `races`; solo se añaden almacenes), copia formato 2
      (acepta la 1), perfil ampliado (fecha de nacimiento completa y opcional, grupos de edad, otros objetivos, deportes,
      días por semana, molestias), «Tu contexto» (fases y hechos, también de antes de la app, con fecha aproximada:
      día, mes, estación o año), línea «Ahora» en Hoy y bienvenida de 3 pasos para perfiles nuevos. Pruebas de
      migración v1/v2 → v3 y de copias en Chromium y WebKit. Arranque sin cambios medibles (rondas alternas, 1 año:
      «hoy» 735 → 635 ms, bloqueo máx. 232 → 198 ms, dentro del ruido).
- [x] **Ronda 6 · cierre de la fase A**: (1) la prueba intermitente de tiempos previstos era un fallo real de los campos
      numéricos: el `select()` diferido de un campo ya abandonado le devolvía el foco (con dos campos, el foco saltaba
      entre ellos sin parar y lo escrito iba al campo anterior). `ui.selectOnFocus`: solo selecciona si el campo sigue
      enfocado y aún no se ha escrito, con `setSelectionRange` (no mueve el foco); regresión en `tests/e2e/inputs.test.cjs`
      (Chromium y WebKit); 0 fallos en 25 repeticiones. (2) Fases simultáneas por aspecto y `contextSummary` para el
      análisis. (3) Pesos del contexto como números (`weightReferences`). (4) Aviso al restaurar una copia antigua que
      borrará contexto, marcas históricas o eventos.

- [x] **Ronda 6 · fase B**: check-in con estrés (4 preguntas) y agujetas o molestias por zona (0–10, mapa corporal en
      modo elegir o articulación, lado y nota), sin convertir los check-ins antiguos; check-in de cada día en
      Calendario › día (ver, añadir y editar, también días pasados); marcas históricas (`pastRecords`) con el porcentaje
      de rendimiento recuperado y su «¿Cómo se calcula?», en Récords y en la ficha de progreso de cada ejercicio.
      463 → 479 unitarias y 170 → 178 E2E (3 ejecuciones completas en verde, WebKit incluido). Arranque sin cambios
      (aperturas intercaladas antes/después, CPU ×4, mediana de 15: 1 año 670 → 674 ms, 2 años 679 → 681 ms hasta
      «Te toca hoy»; las rondas alternas daban saltos de ±200 ms por la carga de la máquina, no por el código).

- [x] **Ronda 6 · fase C**: confianza común (`js/confidence.js`: insuficiente · baja · media · alta, con motivos),
      contexto del análisis (`js/analysis-context.js`: vuelta a entrenar detectada o apuntada, creatina, fase vigente,
      salud, edad), peso con contexto («mantén y reevalúa» en vez de recortar calorías cuando el contexto explica parte
      del cambio), fuerza que distingue recuperación de marcas, ejercicio nuevo y mejor marca, reglas por edad (menores
      y 65+) e Insight ampliado (confianza, contexto, observación/interpretación/recomendación) en la pantalla.

- [x] **Ronda 6 · fase D**: `js/analysis-hybrid.js`: carga por deporte (minutos × RPE, tabla en Resistencia y aviso de
      pico), volumen con contexto (mantener si progresas aunque estés por debajo del rango; reducir con agujetas fuertes o
      fatiga; añadir solo sin progreso, sin fatiga y con constancia; cambios de volumen antes/después), interferencia y
      recuperación con datos personales (≥ 6 y 6 en ≥ 4 semanas; «aparece asociado», nunca «causa»; sustituye a la regla
      general cuando hay datos) y agujetas por ejercicio (24/48/72 h, series, RIR y carga). Arreglo: «Tu análisis» no se
      abría con objetivo y sin pesajes.

- [x] **Ronda 6 · fase E**: eventos deportivos (`races`): 5K, 10K, media, maratón, ciclismo, senderismo, triatlón y
      otro, con fecha, distancia, tiempo objetivo, prioridad A/B/C, nota y objetivo de resistencia enlazado. «Cómo vas»
      con race-predict y goalProgress; una línea en Hoy («🏁 10K · 73 días · objetivo <50:00»); contexto del analista.
      Sin planificador. Arreglo: «Borrar todos los datos» no contaba las marcas históricas.

## Decisiones tomadas que conviene que el usuario confirme (se pueden cambiar)
- Equilibrio empuje/tirón: cuenta 1 por serie según el patrón del ejercicio (sin el factor de secundarios).
- «Esfuerzo alto sostenido» de la descarga: mínimo de 2 sesiones con RPE en el periodo (fijo, no en Ajustes).
- Unilaterales: el incremento sugerido es por lado, sin dividir.
- Objetivos de fuerza: estado «Al alcance» cuando el 1RM estimado ya llega pero aún no se ha hecho el peso × reps.
- Objetivos de tiempo: «en menos de» es estricto (igualar el tiempo no cuenta como conseguido).
- Ronda 4 · Mapa corporal: un músculo con 0 series sale en gris «Sin series»; en la semana en curso, lo que aún no
  llega al mínimo sale en gris claro «Faltan series» (como en las tablas), no en amarillo.
- Ronda 4 · Importar: la distancia de una caminata (tipo «Otra») va a las notas, porque «Otra» no tiene distancia.
- Ronda 4 · Calentamiento: la línea plegada va al final de la tarjeta (junto a «+ Serie») para no mover el botón de
  registrar; en los pasos ≥ 75 % las reps no superan las de la serie de trabajo.
- Ronda 4 · Efecto cristal: barras y hojas con opacidad alta (nunca se lee el texto de debajo) y avisos opacos; en el
  iPhone real el desenfoque puede verse algo distinto que en las pruebas.
- Ronda 5 · Análisis: umbrales de progreso de fuerza por experiencia orientativos (no hay una cifra única en la
  literatura); en mujer, rangos de ganancia de peso algo más prudentes (0,2–0,4 %/sem).
- Ronda 5 · Doble toque en «Registrar serie»: se ignora un segundo toque en 400 ms (antes 300).
- Ronda 5 · El gesto real de «atrás» del iPhone solo se puede comprobar en el propio iPhone (en las pruebas se simula).
- Ronda 6 · Check-in: el estrés se guarda y se ve, pero aún no cuenta para el check-in «bajo» (que sigue siendo sueño,
  energía y agujetas); las zonas tampoco. Se decidirá en las fases C y D.
- Ronda 6 · Marcas históricas: «ahora» = lo mejor de los últimos 28 días; la referencia es la mayor entre tus marcas y lo
  registrado en Entreno antes de esos días; sin RIR apuntado, la marca se cuenta como serie al fallo (igual que en las
  sesiones). La fecha empieza apagada («sin fecha») y «Anterior a Entreno», encendido.
- Ronda 6 · Fase C: la fase de composición vigente de «Tu contexto» manda sobre el objetivo del perfil para el rango
  de peso (se dice en el «¿Por qué?»). Una vuelta a entrenar se detecta sola tras ≥ 3 semanas sin sesiones (cuenta 8
  semanas). La creatina se tiene en cuenta 6 semanas. Recuperación de fuerza: por debajo del 97 % de la referencia.
- Ronda 6 · Fase C: con confianza baja no se proponen cambios de calorías (salvo si bajas demasiado rápido); menores sin
  calorías; 65+ con ajustes ≤ 250 kcal.
- Ronda 6 · Fase D: asociaciones personales con ≥ 6 veces con y ≥ 6 sin, en ≥ 4 semanas (últimas 26) y d ≥ 0,5;
  diferencias apreciables: rendimiento 3 %, ritmo 2 %, agujetas 1,5/10, sesiones saltadas o a medias 15 puntos.
  Pico de carga de un deporte: +50 % sobre su media de 4 semanas. Constancia baja: < 70 % de lo planificado. Cambio de
  volumen: ≥ 25 % y ≥ 2 series/sem entre bloques de 6 semanas. El análisis de energía del peso sigue con los minutos
  totales de resistencia (gasto), no con la carga.
- Ronda 6 · Fase E: Hoy enseña el evento A o B más cercano del próximo año (o uno C si es en ≤ 30 días); la fecha de un
  evento es un día concreto; triatlón y «otro» admiten no poner distancia; solo las carreras a pie tienen tiempo
  previsto.
