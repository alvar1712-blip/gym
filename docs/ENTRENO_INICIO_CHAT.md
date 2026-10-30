# Entreno: contexto para un nuevo chat de desarrollo

Revisión: **30/10/2026**. Lee este documento al empezar y consulta [ENTRENO_DOCUMENTACION_MAESTRA.md](ENTRENO_DOCUMENTACION_MAESTRA.md) para inventario, rutas, datos, algoritmos, límites y pruebas. Entreno y Álvar OS son proyectos distintos.

## Producto y propietario

Entreno es mi aplicación personal de entrenamiento y salud, una PWA utilizada principalmente en iPhone. Registra fuerza y resistencia, planifica mi semana y me ayuda a interpretar el progreso. Debe seguir siendo gratuita, rápida, sencilla, fiable y mantenible durante años. No presupongas que las rutinas de ejemplo son mi historial real ni inventes datos de mi iPhone.

Ya implementa:

- Rutinas y biblioteca editable; fuerza libre o desde plantilla; series prellenadas, RIR, tipos de serie, calentamientos, lastre/asistencia, configuración de material, check-ins y reanudación de la sesión abierta.
- Carrera, bici, natación, senderismo y otras actividades; tiempo/distancia/RPE y campos específicos. Importación local de GPX/TCX/FIT y ZIP/GZIP, revisión y duplicados.
- Calendario, semana tipo con vigencias, excepciones por día, estados, movimientos, historial y adherencia. Una instalación nueva empieza sin semana planificada.
- Progreso, gráficas SVG, mapa muscular, comparación de sesiones, récords de fuerza por material y de resistencia, marcas históricas y predicciones de carrera con confianza. Las estimaciones de ritmo medio se separan de los récords reales.
- Objetivos de fuerza, resistencia y peso; eventos deportivos A/B/C con resultados; perfil y fases/hechos de contexto con fecha aproximada.
- Peso, recuperación, sueño/energía/estrés/agujetas y zonas, análisis híbrido, recomendaciones contextuales de energía/proteína y seguimiento opcional del ciclo.
- «Lo importante esta semana», panel semanal, analista local con explicaciones y fuentes, resúmenes mensual/anual e informe de texto para copiar a una IA externa. La app no llama a una IA.
- JSON con sello SHA-256, «Comprobar copia», restauración con punto local de recuperación, CSV y funcionamiento offline. El punto local no sustituye una copia fuera del navegador.

No hay grabación GPS en vivo, mapas de recorridos, sincronización con servicios deportivos, cuenta en la nube, planificador automático de preparación ni aplicación nativa/App Store. `track` guarda distancia–tiempo, sin coordenadas originales. Hay cronómetro de sesión, sin temporizador de descansos entre series.

## Arquitectura que debes respetar

Repositorio: `C:\Users\Usuario\Documents\GitHub\gym`, remoto [alvar1712-blip/gym](https://github.com/alvar1712-blip/gym), aplicación [GitHub Pages](https://alvar1712-blip.github.io/gym/).

HTML/CSS/JavaScript con módulos ES nativos; sin framework, compilación ni dependencias de producción declaradas. `js/app.js` define rutas hash y carga vistas bajo demanda. Cinco pestañas: Hoy, Calendario, Progreso, Ejercicios y Ajustes. `ui.js` y `router.js` resuelven componentes, hojas, navegación, scroll, foco y transiciones.

`store.js` mantiene Map en memoria y escribe en IndexedDB mediante `db.js`. Lecturas síncronas; `save()` espera transacción, `saveSoon()` agrupa tecleo y `flush()` vacía pendientes. Revisiones y epoch invalidan análisis en memoria. La base `entreno` tiene DB_VERSION 3 y 12 almacenes: meta, exercises, templates, sessions, plan, bodyweight, checkins, goals, cycle, context, pastRecords y races. Schema de app 1, formato JSON 2 (admite 1), versión de app 1.0.0: son conceptos distintos del sello del SW.

Fuerza y deportes comparten `sessions`. `date` es fecha real y `planDate` el vínculo al plan. El cardio hijo usa `parentId/parentItemId/templateItemId`; su duración se resta de fuerza cuando se acepta el cálculo automático. La instantánea de ítems protege el cumplimiento pasado si cambia una rutina. Series pendientes y calentamientos no cuentan como trabajo. Fechas civiles locales `YYYY-MM-DD`, semanas desde lunes y números es-ES.

Antes de inventar otro cálculo, busca: `calc.js`/`stats.js` para métricas; `progression.js` para progresión, estancamiento y fatiga; `race-predict.js` para carrera (lo consumen objetivos); `analysis-*.js` para interpretación; `confidence.js` para confianza; `focus.js` para priorización. Las vistas viven en `js/views/`. Los objetivos de fuerza y las marcas históricas miran todo el historial; progreso/récords distinguen configuración de material. Conserva ese matiz.

## Restricciones innegociables

1. Offline y conservación de historial primero. Registrar/consultar no debe depender de un servicio externo ni de pagos obligatorios.
2. Cambios pequeños y localizados. Reutiliza lo existente y evita nuevas dependencias, abstracciones y migraciones innecesarias. Aplica Ponytail Full en tareas de programación, conservando requisitos, validación, seguridad y accesibilidad.
3. No cambies ids estables ni formatos de datos sin estudiar compatibilidad, copias y reversión. No borres registros para resolver un error.
4. Distingue mediciones, estimaciones, poca muestra y asociaciones; no prometas resultados deportivos ni conviertas reglas en diagnósticos.
5. iPhone es el dispositivo principal: conserva texto grande, teclado, foco, movimiento reducido, zonas seguras, gestos y accesibilidad.
6. Usa ramas separadas, pruebas relevantes y posibilidad de marcha atrás. No hagas push, merge o despliegue sin autorización del encargo.
7. Prefiero probar las mejoras visuales en mi iPhone después de publicarlas a revisar continuamente grabaciones de emuladores.

## Estado verificado y desarrollo

En esta revisión la rama activa, predeterminada y del último despliegue fue `claude/personal-training-mobile-app-e82j38`, HEAD **`3e27bdebdf1528f260d29c73eca62d901ac63faa`**. [Pages terminó correctamente](https://github.com/alvar1712-blip/gym/actions/runs/40748549266) para ese commit el 28/10/2026. SW local/publicado: **`v1-d813a6c4a2`**. Se compararon cinco recursos públicos con el checkout y coincidían. Las demás ramas examinadas son antecesoras, con cero commits exclusivos pendientes; «ronda10-sin-publicar» es un nombre histórico. Recomprueba todo al empezar: no es un estado permanente.

`npm run check` pasó: **834/834 unitarias**, sin omitidas, y 111 recursos precacheados con sello correcto. Las E2E existen para Chromium y WebKit, pero **no se ejecutaron en esta revisión porque Playwright no estaba disponible**. El iPhone real, su caché/datos y la configuración administrativa exacta de Pages quedaron **No verificados**. Los informes históricos no sustituyen pruebas actuales.

Desde la raíz:

```powershell
npm run serve  # http://127.0.0.1:8080/
npm test
npm run check
```

`npm test` enumera unitarias de forma compatible con Windows; no uses el glob del README como garantía. Los scripts npm E2E usan sintaxis Unix. La maestra incluye comandos equivalentes PowerShell para Playwright cuando esté instalado; no instales dependencias por rutina en una tarea de solo lectura.

Tras cambiar archivos de aplicación, añade los recursos nuevos a `sw.js`/ASSETS, ejecuta `npm run stamp` y luego `npm run check` antes de una publicación autorizada. El sello normaliza LF, también en Windows. Las rutas de recursos son relativas porque se publica bajo `/gym/`. Actualizar se ofrece al usuario en raíces de pestañas, sin interrumpir una sesión. Un rollback de recursos no revierte IndexedDB automáticamente.

Importar JSON sustituye todo, no fusiona. Antes de importar/borrar hay un punto local verificado; el sello incorrecto se bloquea y las copias antiguas sin sello se aceptan con información. Una copia de formato 1 puede omitir secciones/ciclo y vaciarlas al sustituir. No pruebes importaciones, borrados o migraciones en mi almacenamiento real. La copia compartida en iPhone solo consta como hecha tras confirmar que se guardó.

## Cómo debe trabajar el asistente

Comprende el flujo, revisa código y pruebas de la zona y describe qué evidencia tienes. Distingue **IMPLEMENTADO Y VERIFICADO EN CÓDIGO**, **DOCUMENTADO PERO NO VERIFICADO**, **LIMITACIÓN O PROBLEMA CONOCIDO** e **IDEA FUTURA NO IMPLEMENTADA**. Si no puedes comprobarlo, escribe «No verificado». No conviertas propuestas antiguas en tareas autorizadas ni fallos ya corregidos en incidencias actuales.

Empieza por la maestra y su mapa funcional → archivos → datos → pruebas. Consulta después `docs/ARCHITECTURE.md` para contratos, `docs/GUIA.md` para instalación/publicación, `docs/PULIDO.md` y `docs/RONDA11.md` para decisiones y `docs/PRUEBAS.md` para comprobaciones. `REQUISITOS.md`, fases e informes explican historia; el código actual prevalece para afirmar comportamiento. El estudio App Store describe una opción futura, sin autorización para desarrollarla.

Esta tarea de transferencia solo creó los dos Markdown, sin cambios de código/datos ni publicación. Permanecen sin commit en el repositorio y existen copias en `%USERPROFILE%\Downloads\Entreno-documentacion`.
