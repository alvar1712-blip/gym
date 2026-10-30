# Informe de Entreno Lab

Generado: 2026-10-30T10:21:53.631Z · semilla 1 · 20 perfiles sintéticos · hoy simulado = 2026-10-15

## Qué se ejecutó realmente

- Escenarios distintos ejecutados: **23**; ejecuciones (escenario × perfil): **332**; superadas **314**, con fallo **18**.
- Nivel 1 (Node, lógica real de la app sobre historiales sintéticos): 242 ejecuciones.
- Nivel 2 (navegador Playwright, chromium 156.0.8078.4): 90 ejecuciones.
- Motor: chromium 156.0.8078.4, emulación de iPhone (viewport/táctil). **No es un iPhone físico ni Safari real.**

## Resultados por escenario

| Escenario | Área | Título | Perfiles ok/total | Estado |
|---|---|---|---|---|
| N01 | Almacenamiento | La copia JSON del historial es válida, lleva sello y detecta una modificación | 20/20 | OK |
| N02 | Almacenamiento | Ida y vuelta de la copia sin pérdida de registros | 20/20 | OK |
| N03 | Progreso | Hoy, panel semanal, análisis e informe no fallan ni muestran NaN/undefined/Infinity con datos extremos | 20/20 | OK |
| N04 | Progreso | El análisis no modifica sus entradas y es repetible | 20/20 | OK |
| N05 | Progreso | Coherencia entre pantallas: «sin señales de descarga» no convive con «descarga» | 20/20 | OK |
| N06 | Fuerza | Un material/configuración nuevo no genera falsos récords | 20/20 | OK |
| N07 | Fuerza | Un dato absurdo (peso ×10, 100 reps) no se convierte en récord histórico | 7/20 | FALLO |
| N08 | Fuerza | e1RM solo para 1–12 repeticiones y siempre finito | 20/20 | OK |
| N09 | Resistencia | Un GPX de una actividad ya registrada se detecta como duplicado | 20/20 | OK |
| N10 | Resistencia | Archivos corruptos o truncados no lanzan excepciones | 1/1 | OK |
| N11 | Almacenamiento | Exportar CSV con historial completo no falla y no pierde filas | 20/20 | OK |
| N12 | Progreso | Menores no reciben kcal/déficit; mayores de 65 no pasan de 250 kcal | 20/20 | OK |
| N13 | Rendimiento | Historial largo: análisis completo en menos de 4 s (en Node) | 20/20 | OK |
| N14 | Casos límite | Fechas y zonas horarias: addDays/weekStart/dow/tsFromDate coherentes en 5 husos durante 2024–2027 | 1/1 | OK |
| B01 | Almacenamiento | El historial restaurado persiste en IndexedDB y sobrevive a una recarga | 20/20 | OK |
| B02 | UX y accesibilidad | Las 5 pestañas montan sin errores y sin scroll horizontal con el tamaño de pantalla y texto del perfil | 20/20 | OK |
| B03 | Almacenamiento | Exportar → comprobar → restaurar conserva todo; una copia alterada se rechaza y queda punto de restauración | 20/20 | OK |
| B04 | Fuerza | Sesión abierta: las series hechas y la sesión sobreviven a recargar; al terminar queda guardada y ya no hay sesión activa | 20/20 | OK |
| B05 | Casos límite | Si IndexedDB falla al guardar, la app avisa y la memoria no muestra datos que no están en disco | 0/2 | FALLO |
| B09 | UX y accesibilidad | Controles táctiles de al menos 44×44 px en Hoy, Calendario y Progreso | 0/3 | FALLO |
| B07 | UX y accesibilidad | Con «reducir movimiento» no quedan animaciones en bucle en Hoy | 3/3 | OK |
| B06 | UX y accesibilidad | Navegación con teclado: cada Tab lleva a un elemento visible con indicador de foco | 1/1 | OK |
| B08 | Casos límite | Zona horaria distinta (viaje): «hoy» es la fecha local y las fechas guardadas no se desplazan | 1/1 | OK |

## Hallazgos

Clases: **A** error confirmado · **B** riesgo técnico · **C** hipótesis UX · **D** mejora propuesta · **E** limitación del laboratorio.

### Clase B

#### LAB-002 · Si el guardado falla (p. ej. almacenamiento lleno), el dato sigue visible en memoria aunque no esté en disco

- **Categoría:** Almacenamiento · **Gravedad:** baja · **Confianza:** alta (reproducido con un fallo simulado de IndexedDB) · **Prioridad recomendada:** baja
- **Perfiles afectados (2):** p01-adolescente-baloncesto, p09-veterano-5-anios
- **Pasos para reproducir:**
  1. Abrir la app con historial.
  2. Hacer que IDBObjectStore.put lance QuotaExceededError.
  3. store.save("bodyweight", {id: hoy, kg: 71.3}).
  4. Comprobar store.all("bodyweight") frente a IndexedDB.
- **Esperado:** Tras el error, o bien se revierte la memoria, o la interfaz deja claro que ese dato NO está guardado hasta reintentar.
- **Observado:**
  - [p01-adolescente-baloncesto] el peso 71,3 kg figura en memoria (y por tanto en pantalla) pero NO está en disco: desaparecerá al recargar
  - [p09-veterano-5-anios] el peso 71,3 kg figura en memoria (y por tanto en pantalla) pero NO está en disco: desaparecerá al recargar
- **Evidencia:** tests/lab/out/resultados.json (escenario B05)
- **Relacionado:** js/store.js (save: maps[store].set antes de db.put; track → emit("error")), js/app.js (toast «No se pudo guardar… Vuelve a intentarlo»)
- **Propuesta:** La app SÍ avisa con un toast de 6 s. Mejora mínima: en save(), si db.put falla, restaurar el valor previo en el mapa (o marcarlo «sin guardar») para que al cerrar la app no se pierda un dato que parecía guardado. Riesgo real bajo: requiere cuota llena o fallo del disco; en iOS ocurre sobre todo con almacenamiento del sitio purgado.

### Clase C

#### LAB-003 · Controles táctiles por debajo de 44 px: tira de días de Hoy con texto grande y zonas del mapa muscular

- **Categoría:** UX y accesibilidad · **Gravedad:** media · **Confianza:** media (medición real de cajas; el impacto en personas requiere validar con usuarios) · **Prioridad recomendada:** media
- **Perfiles afectados (3):** p01-adolescente-baloncesto, p08-mayor-75-simple, p18-baja-vision
- **Pasos para reproducir:**
  1. Abrir en una pantalla de 320–390 px (con texto ×1,5 la tira de días de Hoy llega a 37×91 px; el mapa muscular de Progreso mide 29–31 px de alto incluso a ×1).
  2. Hoy: la tira de días; Progreso: mapa muscular y chips de deporte.
- **Esperado:** Objetivo táctil mínimo de 44×44 px (guía de Apple y WCAG 2.5.8 pide 24 px mínimo, 44 recomendado).
- **Observado:**
  - [p01-adolescente-baloncesto] #/progress: 11 controles < 44 px, p. ej. g«Hombro anterior: 1 s» 76×29; g«Hombro lateral: 0 se» 218×31; g«Hombro posterior: 0 » 76×29
  - [p08-mayor-75-simple] #/today: 7 controles < 44 px, p. ej. button«lunes, 26 de octubre» 37×91; button«martes, 27 de octubr» 37×91; button«miércoles, 28 de oct» 37×91
  - [p08-mayor-75-simple] #/progress: 12 controles < 44 px, p. ej. button«Bici» 36×44; g«Hombro anterior: 1 s» 76×29; g«Hombro lateral: 0 se» 218×31
  - [p18-baja-vision] #/today: 7 controles < 44 px, p. ej. button«lunes, 26 de octubre» 37×91; button«martes, 27 de octubr» 37×91; button«miércoles, 28 de oct» 37×91
  - [p18-baja-vision] #/progress: 12 controles < 44 px, p. ej. button«Bici» 36×44; g«Hombro anterior: 1 s» 76×29; g«Hombro lateral: 0 se» 218×31
- **Evidencia:** tests/lab/out/resultados.json (escenario B09)
- **Relacionado:** css/app.css, css/bodymap.css, js/bodymap.js, js/views/today.js
- **Propuesta:** Subir min-height/min-width de los botones de la tira de días (37 px de ancho) y ampliar el área de toque de los grupos SVG del mapa con un rect transparente. Validar primero en el iPhone: las medidas son de Chromium emulado.

### Clase D

#### LAB-001 · Un peso mal tecleado pero «posible» (p. ej. 17,5 → 175 kg) entra en Récords y queda como marca histórica

- **Categoría:** Fuerza / récords · **Gravedad:** media · **Confianza:** alta (el comportamiento se reproduce; que sea un defecto es decisión de producto) · **Prioridad recomendada:** media
- **Perfiles afectados (13):** p01-adolescente-baloncesto, p03-principiante-28, p06-irregular-55, p07-mayor-67-fuerza, p08-mayor-75-simple, p09-veterano-5-anios, p10-abandona-retoma, p11-cambia-rutinas, p12-datos-erroneos, p17-teclado-motriz, p18-baja-vision, p19-recuperacion-lesion, p20-viajero-zona-horaria
- **Pasos para reproducir:**
  1. Registrar series con pesos habituales (10–30 kg) en un ejercicio de aislamiento.
  2. Guardar una serie con 175 kg (coma mal puesta). Está por debajo de los límites de js/sanity.js, que son amplios a propósito, así que no pregunta «¿Seguro?».
  3. Abrir Progreso › Récords del ejercicio.
- **Esperado:** Un valor ≥4× la mediana personal del ejercicio se avisa al guardarlo o se señala en Récords, en vez de presentarse como mejor marca.
- **Observado:**
  - [p01-adolescente-baloncesto] Peso muerto rumano: récord de peso 150 kg (2026-01-13) frente a mediana 17.5 kg
  - [p01-adolescente-baloncesto] Sentadilla: récord de peso 250 kg (2026-03-17) frente a mediana 27.5 kg
  - [p03-principiante-28] Remo con pecho apoyado: récord de peso 200 kg (2026-09-21) frente a mediana 17.5 kg
  - [p06-irregular-55] Elevaciones laterales: récord de peso 175 kg (2026-02-05) frente a mediana 17.5 kg
  - [p06-irregular-55] Face pull: récord de peso 250 kg (2026-08-24) frente a mediana 27.5 kg
  - [p07-mayor-67-fuerza] Curl femoral: récord de peso 175 kg (2026-04-28) frente a mediana 15 kg
  - [p07-mayor-67-fuerza] Gemelos de pie: récord de peso 125 kg (2026-02-03) frente a mediana 12.5 kg
- **Evidencia:** tests/lab/out/resultados.json (escenario N07)
- **Relacionado:** js/sanity.js (checkSet), js/stats.js (strengthRecords), js/session-view-card.js
- **Propuesta:** En checkSet, comparar con la mediana de las últimas series del mismo ejercicio/configuración (≥ 6 series previas) y preguntar «¿Seguro?» si supera 4×. Sin tocar el esquema. Alternativa: en Récords, marcar «marca única muy superior a tu historial» y permitir descartarla.

#### LAB-005 · El texto de la app sigue a Dynamic Type solo hasta ×1,5

- **Categoría:** UX y accesibilidad · **Gravedad:** media · **Confianza:** media (el tope está en el código; su efecto en personas con baja visión no se ha medido) · **Prioridad recomendada:** media
- **Pasos para reproducir:**
  1. Leer js/app.js, applyTextScale: Math.min(1.5, Math.max(1, px / 17)).
  2. Con un tamaño de letra de accesibilidad de iOS superior a ≈ ×1,5 la app deja de crecer.
- **Esperado:** Una persona con baja visión (perfil p18) que usa tamaños de accesibilidad mayores esperaría que la app los respetase o que el límite fuese una decisión consciente y documentada.
- **Observado:**
  - Con ×1,5 en pantallas de 320–430 px el laboratorio no encuentra desbordamiento horizontal (B02 superado en Chromium y WebKit). Con ×2 forzado a 320 px, WebKit sí desborda (p. ej. botón «Ahora no» y «Ver todo» en Hoy, insignia de versión en Ajustes): es el motivo probable del tope.
- **Evidencia:** js/app.js:151-171; sondeo puntual en WebKit con texto ×2 a 320 px (no es un escenario permanente)
- **Relacionado:** js/app.js, css/app.css
- **Propuesta:** No cambiar sin probarlo en el iPhone: subir el tope exigiría rehacer filas y botones para que quepan. Decisión del propietario; si se mantiene, documentarlo en Ajustes › Ayuda.

### Clase E

#### LAB-E1 · No se ha probado en un iPhone físico ni en Safari real

- **Categoría:** Limitación · **Gravedad:** media · **Confianza:** alta · **Prioridad recomendada:** —
- **Esperado:** Verificación en dispositivo.
- **Observado:**
  - Todo el nivel 2 usa Chromium con emulación de iPhone 13 (viewport, táctil, user-agent). WebKit de Playwright se puede activar con LAB_BROWSER=webkit; tampoco es Safari de iOS (sin cuota de almacenamiento, purga de datos del sitio, hoja de compartir, teclado virtual, zonas seguras reales).
- **Evidencia:** tests/lab/scenarios-browser.mjs
- **Propuesta:** Probar en el iPhone lo que el informe marca como C o B.

#### LAB-E3 · Los usuarios sintéticos no son usuarios reales

- **Categoría:** Limitación · **Gravedad:** media · **Confianza:** alta · **Prioridad recomendada:** —
- **Esperado:** Evidencia sobre personas.
- **Observado:**
  - Los perfiles fijan parámetros (frecuencia, regularidad, errores) elegidos por el laboratorio. Detectan fallos de datos y lógica, no si algo «resulta confuso». Las clases C son hipótesis hasta probar con personas; no se ha usado ninguna IA para opinar sobre la experiencia.
- **Propuesta:** Cinco sesiones de observación con personas reales de los perfiles p07/p08/p12 antes de rediseñar nada.

#### LAB-E4 · Cobertura parcial: los flujos de interfaz completos siguen en las E2E existentes

- **Categoría:** Limitación · **Gravedad:** media · **Confianza:** alta · **Prioridad recomendada:** —
- **Esperado:** Recorridos de usuario completos por perfil.
- **Observado:**
  - El laboratorio crea/termina sesiones por la lógica de la app (session-logic) y valida persistencia y pantallas, pero no hace clic en cada paso de registro de series, calendario, objetivos ni importación por interfaz: eso lo cubren las E2E existentes (tests/e2e) y queda como pendiente en tests/lab/CATALOGO.md.
- **Propuesta:** Ampliar el nivel 2 con recorridos con clics por perfil donde el catálogo lo marca pendiente.

#### LAB-E2 · El «texto grande» es el ajuste propio de la app, no Dynamic Type de iOS

- **Categoría:** Limitación · **Gravedad:** baja · **Confianza:** alta · **Prioridad recomendada:** —
- **Esperado:** Probar con el tamaño de letra del sistema.
- **Observado:**
  - El laboratorio escribe localStorage["entreno.textScale"], el gancho que la app ofrece para forzar la escala (js/app.js:149). Dynamic Type y Zoom de pantalla de iOS no son emulables en Playwright.
- **Evidencia:** tests/lab/scenarios-browser.mjs
- **Propuesta:** Revisión manual en el iPhone con tamaños de accesibilidad.

## Rendimiento del análisis (Node, no representa un iPhone)

- p09-veterano-5-anios: 115 ms
- p15-hipertrofia-avanzado: 44 ms
- p02-gym-carrera-22: 32 ms
- p11-cambia-rutinas: 24 ms
- p20-viajero-zona-horaria: 24 ms
