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

## En curso
- [ ] Fase 3 · **en revisión**: revisión adversarial y correcciones; criterio de aceptación del «¿Por qué?»; commit
      «Fase 3 completa» (workflow `fase3`, run `wf_bf989875-8b9`: si se corta, reanudarlo con resumeFromRunId)
- [ ] Decisiones a confirmar con el usuario (de los informes de la Fase 3): empuje/tirón cuenta 1 por serie según el
      patrón del ejercicio (sin factor secundario); mínimo de 2 sesiones para el «esfuerzo alto sostenido» de la
      descarga (fijo, no en Ajustes); incremento de unilaterales por lado sin dividir; «Al alcance» en objetivos de
      fuerza (el 1RM estimado ya llega pero aún no se ha hecho peso × reps); «en menos de» estricto en objetivos de tiempo
- [ ] Cierre: documentación final (ARCHITECTURE, GUIA, README), `stamp-sw`, batería completa de pruebas
