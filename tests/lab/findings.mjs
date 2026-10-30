// Metadatos de los hallazgos. FINDINGS: se activan SOLO si el escenario con ese id falla; la clase (A–E) la declara el
// escenario según qué demuestra el fallo. STATIC_FINDINGS: riesgos, hipótesis, mejoras y limitaciones que no dependen
// de un fallo del run; cada uno cita lo que lo respalda. Nada aquí es un fallo «inventado»: lo que no se ha reproducido
// se declara como B/C/D/E, nunca como A.
export const FINDINGS = {
  N07: {
    id: 'LAB-001', class: 'D', severity: 'media', category: 'Fuerza / récords', confidence: 'alta (el comportamiento se reproduce; que sea un defecto es decisión de producto)', priority: 'media',
    title: 'Un peso mal tecleado pero «posible» (p. ej. 17,5 → 175 kg) entra en Récords y queda como marca histórica',
    steps: ['Registrar series con pesos habituales (10–30 kg) en un ejercicio de aislamiento.', 'Guardar una serie con 175 kg (coma mal puesta). Está por debajo de los límites de js/sanity.js, que son amplios a propósito, así que no pregunta «¿Seguro?».', 'Abrir Progreso › Récords del ejercicio.'],
    expected: 'Un valor ≥4× la mediana personal del ejercicio se avisa al guardarlo o se señala en Récords, en vez de presentarse como mejor marca.',
    files: ['js/sanity.js (checkSet)', 'js/stats.js (strengthRecords)', 'js/session-view-card.js'],
    fix: 'En checkSet, comparar con la mediana de las últimas series del mismo ejercicio/configuración (≥ 6 series previas) y preguntar «¿Seguro?» si supera 4×. Sin tocar el esquema. Alternativa: en Récords, marcar «marca única muy superior a tu historial» y permitir descartarla.',
  },
  B05: {
    id: 'LAB-002', class: 'B', severity: 'baja', category: 'Almacenamiento', confidence: 'alta (reproducido con un fallo simulado de IndexedDB)', priority: 'baja',
    title: 'Si el guardado falla (p. ej. almacenamiento lleno), el dato sigue visible en memoria aunque no esté en disco',
    steps: ['Abrir la app con historial.', 'Hacer que IDBObjectStore.put lance QuotaExceededError.', 'store.save("bodyweight", {id: hoy, kg: 71.3}).', 'Comprobar store.all("bodyweight") frente a IndexedDB.'],
    expected: 'Tras el error, o bien se revierte la memoria, o la interfaz deja claro que ese dato NO está guardado hasta reintentar.',
    files: ['js/store.js (save: maps[store].set antes de db.put; track → emit("error"))', 'js/app.js (toast «No se pudo guardar… Vuelve a intentarlo»)'],
    fix: 'La app SÍ avisa con un toast de 6 s. Mejora mínima: en save(), si db.put falla, restaurar el valor previo en el mapa (o marcarlo «sin guardar») para que al cerrar la app no se pierda un dato que parecía guardado. Riesgo real bajo: requiere cuota llena o fallo del disco; en iOS ocurre sobre todo con almacenamiento del sitio purgado.',
  },
  B09: {
    id: 'LAB-003', class: 'C', severity: 'media', category: 'UX y accesibilidad', confidence: 'media (medición real de cajas; el impacto en personas requiere validar con usuarios)', priority: 'media',
    title: 'Controles táctiles por debajo de 44 px: tira de días de Hoy con texto grande y zonas del mapa muscular',
    steps: ['Abrir en una pantalla de 320–390 px (con texto ×1,5 la tira de días de Hoy llega a 37×91 px; el mapa muscular de Progreso mide 29–31 px de alto incluso a ×1).', 'Hoy: la tira de días; Progreso: mapa muscular y chips de deporte.'],
    expected: 'Objetivo táctil mínimo de 44×44 px (guía de Apple y WCAG 2.5.8 pide 24 px mínimo, 44 recomendado).',
    files: ['css/app.css', 'css/bodymap.css', 'js/bodymap.js', 'js/views/today.js'],
    fix: 'Subir min-height/min-width de los botones de la tira de días (37 px de ancho) y ampliar el área de toque de los grupos SVG del mapa con un rect transparente. Validar primero en el iPhone: las medidas son de Chromium emulado.',
  },
};

export const STATIC_FINDINGS = [
  { id: 'LAB-005', class: 'D', severity: 'media', category: 'UX y accesibilidad', confidence: 'media (el tope está en el código; su efecto en personas con baja visión no se ha medido)', priority: 'media',
    title: 'El texto de la app sigue a Dynamic Type solo hasta ×1,5',
    steps: ['Leer js/app.js, applyTextScale: Math.min(1.5, Math.max(1, px / 17)).', 'Con un tamaño de letra de accesibilidad de iOS superior a ≈ ×1,5 la app deja de crecer.'],
    expected: 'Una persona con baja visión (perfil p18) que usa tamaños de accesibilidad mayores esperaría que la app los respetase o que el límite fuese una decisión consciente y documentada.',
    observed: ['Con ×1,5 en pantallas de 320–430 px el laboratorio no encuentra desbordamiento horizontal (B02 superado en Chromium y WebKit). Con ×2 forzado a 320 px, WebKit sí desborda (p. ej. botón «Ahora no» y «Ver todo» en Hoy, insignia de versión en Ajustes): es el motivo probable del tope.'],
    evidence: 'js/app.js:151-171; sondeo puntual en WebKit con texto ×2 a 320 px (no es un escenario permanente)', files: ['js/app.js', 'css/app.css'],
    fix: 'No cambiar sin probarlo en el iPhone: subir el tope exigiría rehacer filas y botones para que quepan. Decisión del propietario; si se mantiene, documentarlo en Ajustes › Ayuda.' },  { id: 'LAB-E1', class: 'E', severity: 'media', category: 'Limitación', confidence: 'alta', priority: '—', title: 'No se ha probado en un iPhone físico ni en Safari real',
    expected: 'Verificación en dispositivo.', observed: ['Todo el nivel 2 usa Chromium con emulación de iPhone 13 (viewport, táctil, user-agent). WebKit de Playwright se puede activar con LAB_BROWSER=webkit; tampoco es Safari de iOS (sin cuota de almacenamiento, purga de datos del sitio, hoja de compartir, teclado virtual, zonas seguras reales).'], evidence: 'tests/lab/scenarios-browser.mjs', fix: 'Probar en el iPhone lo que el informe marca como C o B.' },
  { id: 'LAB-E2', class: 'E', severity: 'baja', category: 'Limitación', confidence: 'alta', priority: '—', title: 'El «texto grande» es el ajuste propio de la app, no Dynamic Type de iOS',
    expected: 'Probar con el tamaño de letra del sistema.', observed: ['El laboratorio escribe localStorage["entreno.textScale"], el gancho que la app ofrece para forzar la escala (js/app.js:149). Dynamic Type y Zoom de pantalla de iOS no son emulables en Playwright.'], evidence: 'tests/lab/scenarios-browser.mjs', fix: 'Revisión manual en el iPhone con tamaños de accesibilidad.' },
  { id: 'LAB-E3', class: 'E', severity: 'media', category: 'Limitación', confidence: 'alta', priority: '—', title: 'Los usuarios sintéticos no son usuarios reales',
    expected: 'Evidencia sobre personas.', observed: ['Los perfiles fijan parámetros (frecuencia, regularidad, errores) elegidos por el laboratorio. Detectan fallos de datos y lógica, no si algo «resulta confuso». Las clases C son hipótesis hasta probar con personas; no se ha usado ninguna IA para opinar sobre la experiencia.'], fix: 'Cinco sesiones de observación con personas reales de los perfiles p07/p08/p12 antes de rediseñar nada.' },
  { id: 'LAB-E4', class: 'E', severity: 'media', category: 'Limitación', confidence: 'alta', priority: '—', title: 'Cobertura parcial: los flujos de interfaz completos siguen en las E2E existentes',
    expected: 'Recorridos de usuario completos por perfil.', observed: ['El laboratorio crea/termina sesiones por la lógica de la app (session-logic) y valida persistencia y pantallas, pero no hace clic en cada paso de registro de series, calendario, objetivos ni importación por interfaz: eso lo cubren las E2E existentes (tests/e2e) y queda como pendiente en tests/lab/CATALOGO.md.'], fix: 'Ampliar el nivel 2 con recorridos con clics por perfil donde el catálogo lo marca pendiente.' },
];
