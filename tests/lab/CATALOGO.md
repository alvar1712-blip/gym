# Catálogo de escenarios de Entreno Lab

Tres estados, sin duplicar trabajo: **Lab** = automatizado en `tests/lab/` (se ejecuta con cada perfil), **Existente** = ya
cubierto por una prueba del repositorio (se cita el archivo; se ha comprobado que existe y su tema por el nombre y cabecera,
no se ha revisado cada aserción) y **Pendiente** = diseñado, no automatizado todavía. Un escenario «pendiente» no está
verificado.

## A. Automatizados en el laboratorio (23)

| Id | Área | Qué comprueba | Nivel |
|---|---|---|---|
| N01 | Almacenamiento | Copia válida, sellada, y una serie modificada rompe el sello | Node |
| N02 | Almacenamiento | Exportar y leer no pierde ni altera ningún registro | Node |
| N03 | Progreso | Hoy, panel semanal, análisis e informe sin excepción ni NaN/undefined con datos extremos | Node |
| N04 | Progreso | El análisis no muta sus entradas y es repetible | Node |
| N05 | Progreso | «Sin señales de descarga» no convive con «descarga» | Node |
| N06 | Fuerza | Material/configuración nuevo no crea falsos récords; un récord por configuración | Node |
| N07 | Fuerza | Un peso absurdo pero «posible» no se queda como marca histórica | Node |
| N08 | Fuerza | e1RM solo con 1–12 reps y siempre finito | Node |
| N09 | Resistencia | GPX de una actividad ya registrada → duplicado | Node |
| N10 | Resistencia | Archivos vacíos/cortados/corruptos (GPX, FIT, ZIP, GZ, txt) sin excepciones | Node |
| N11 | Almacenamiento | CSV de fuerza y cardio sin pérdida de filas | Node |
| N12 | Progreso | Menores sin kcal/déficit; mayores de 65 con tope de 250 kcal | Node |
| N13 | Rendimiento | Análisis completo < 4 s con historiales de hasta 5 años (en Node) | Node |
| N14 | Casos límite | Fechas, semanas y marcas de tiempo coherentes en 5 husos durante 2024–2027 | Node |
| B01 | Almacenamiento | Historial restaurado persiste en IndexedDB y tras recargar | Navegador |
| B02 | UX | 5 pestañas montan sin errores y sin desbordamiento horizontal con la pantalla/texto del perfil | Navegador |
| B03 | Almacenamiento | Exportar → comprobar → restaurar; copia alterada rechazada; punto de restauración | Navegador |
| B04 | Fuerza | Sesión abierta sobrevive a recarga y terminarla la deja guardada | Navegador |
| B05 | Casos límite | Fallo de IndexedDB al guardar: aviso y coherencia memoria/disco | Navegador |
| B06 | Accesibilidad | Teclado: 25 Tab con elemento visible e indicador de foco | Navegador |
| B07 | Accesibilidad | «Reducir movimiento»: sin animaciones infinitas en Hoy | Navegador |
| B08 | Casos límite | Otro huso horario: «hoy» local y fechas guardadas sin desplazar | Navegador |
| B09 | Accesibilidad | Controles táctiles ≥ 44 px en Hoy, Calendario y Progreso | Navegador |

## B. Cubiertos por pruebas existentes (no se duplican)

| Tema | Dónde |
|---|---|
| Registro de fuerza: prellenado, RIR, calentamientos, deshacer, sesiones largas | `tests/e2e/session*.test.cjs`, `warmup`, `undo`, `tests/unit/session*.test.mjs` |
| Récords por material y parciales | `tests/unit/strength-coherence`, `records-partials`, `past-records`, E2E `records-partials`, `past-records` |
| Importación GPX/TCX/FIT/ZIP/GZIP, duplicados, parciales, límites | `tests/unit/import*.test.mjs`, `tests/e2e/import*.test.cjs`, `fit-12k.cjs`, `tests/fixtures/import/` |
| Calendario, semana tipo, excepciones, adherencia | `tests/e2e/calendar`, `week-setup`, `weekly`, `tests/unit/plan.test.mjs` |
| Progreso, gráficas, predicciones, coherencia entre pantallas | `tests/e2e/progress`, `charts`, `predictions`, `prediction-coherence`, `tests/unit/analysis-consistency` |
| Objetivos y eventos de carrera | `tests/e2e/goals`, `races`, `race-*`, `tests/unit/goals`, `races*` |
| Copias, integridad, restauración, migración | `tests/e2e/check-backup`, `restore-invalid`, `restore-point`, `migration`, `tests/unit/backup`, `integrity` |
| Historiales largos | `tests/e2e/long-history.test.cjs` |
| Recuperación, check-in, ciclo | `tests/e2e/recovery`, `checkin*`, `cycle`, `tests/unit/recovery-logic`, `cycle` |
| Texto grande, gestos, aspecto nativo, guarda visual | `tests/e2e/large-text-rows`, `gestures`, `native-feel`, `visual-guard` |

Línea base de esta ejecución: `npm run check` y las unitarias existentes: 834/834. Las E2E existentes no se han vuelto a
ejecutar enteras (la memoria del proyecto anota 18 fallos de entorno en Chromium y ~70 en WebKit en este PC).

## C. Pendientes (diseñados, sin automatizar)

| Id | Escenario | Por qué importa |
|---|---|---|
| P01 | Crear una rutina desde cero por interfaz con teclado y con toque (p11 cambia rutinas) | Flujo más largo de la app |
| P02 | Registrar series con RIR, lastre y asistencia por interfaz con datos erróneos (p12) | Validaciones de formulario |
| P03 | Cambio de ejercicio durante la sesión y su efecto en récords (p11) | Alternativas y `baseExerciseId` |
| P04 | Suspensión real (pagehide/visibilitychange) en mitad de una serie | iOS cierra la PWA en segundo plano |
| P05 | Comparación de sesiones con configuraciones distintas (p09, p15) | Evitar comparaciones engañosas |
| P06 | Importar por interfaz archivos VÁLIDOS FIT/TCX/ZIP/GZIP generados por perfil y revisar parciales (p05, p04) | N09 solo cubre GPX |
| P07 | Duplicado entre actividad manual (sin hora) y archivo importado | Regla `likelyDuplicate` |
| P08 | Calendario: mover, saltar, sustituir, descanso y adherencia con parones (p06, p10) | Cálculo de adherencia |
| P09 | Semana tipo con vigencias y cambio de semana a mitad de historial | Fechas de vigencia |
| P10 | Objetivos: logro con estancamiento y cambio de objetivo (p16) | Objetivo archivado y nuevo |
| P11 | Predicción de carrera: rango lo ≤ hi y confianza coherente por perfil (p04, p16) | Promesas deportivas |
| P12 | Estancamiento/descarga detectados en p15 (plateau tras 16 semanas) | Recomendaciones fiables |
| P13 | Recuperación irregular tras lesión (p19): zonas y tendencias | Mensajes de carga |
| P14 | Copia formato 1 antigua restaurada con historial de perfil | Compatibilidad hacia atrás |
| P15 | Recuperar el punto de restauración tras una importación | Marcha atrás |
| P16 | Cuota llena durante importar/restaurar | Pérdida de datos |
| P17 | Sesión que cruza medianoche y cambio de horario (DST) | Fecha de la sesión |
| P18 | Funcionamiento offline y actualización del service worker con historial | PWA |
| P19 | Contraste de color y roles ARIA automáticos (axe) en cada pestaña | WCAG |
| P20 | VoiceOver y teclado completos en iPhone real | Imposible en el laboratorio |
| P21 | Rendimiento en un iPhone real con 5 años de historial | N13 mide Node, no iOS |
| P22 | Observación con personas reales de p07, p08 y p12 | Las clases C son hipótesis |
