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

## Decisiones tomadas que conviene que el usuario confirme (se pueden cambiar)
- Equilibrio empuje/tirón: cuenta 1 por serie según el patrón del ejercicio (sin el factor de secundarios).
- «Esfuerzo alto sostenido» de la descarga: mínimo de 2 sesiones con RPE en el periodo (fijo, no en Ajustes).
- Unilaterales: el incremento sugerido es por lado, sin dividir.
- Objetivos de fuerza: estado «Al alcance» cuando el 1RM estimado ya llega pero aún no se ha hecho el peso × reps.
- Objetivos de tiempo: «en menos de» es estricto (igualar el tiempo no cuenta como conseguido).
