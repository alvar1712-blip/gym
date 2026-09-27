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
