# Informe · Ronda final de auditoría y mejora

Objetivo: dejar Entreno en un estado en que se pueda dejar de desarrollar una temporada y simplemente **entrenar
con ella**. No hay funciones nuevas de producto. Se ha auditado primero, se ha arreglado lo que se pudo demostrar y se
ha medido antes y después. Las reglas que deja la ronda están en [PULIDO.md](PULIDO.md) §28–§32 y en el apartado
de movimiento de §17.

Sin cambios en el esquema de datos: IndexedDB sigue en la v3 y el formato de copia en el 2, no hay migraciones y
ningún dato guardado se reescribe. Las copias son compatibles en ambos sentidos.

## 1. Qué se auditó

Primero se leyó el código para entender cómo está la app hoy. Después se hizo una auditoría por áreas, con evidencia
`archivo:línea` y reproducción en el navegador cuando el problema era observable. Cada lote de hallazgos pasó por un
verificador que intentaba refutarlos. Los que no se pudieron confirmar se descartaron.

| Área | Qué se miró |
|---|---|
| Datos y fiabilidad | Ida y vuelta **real**: datos variados en los 12 stores → copia → cambios y borrados → restaurar → comparación campo a campo. También copias antiguas, futuras, parciales y dañadas; ids, fechas y zona horaria; deshacer; duplicados; punto de restauración. |
| Coherencia del análisis | Hoy, Panel semanal, Análisis, Objetivos, Tiempos previstos y Récords con historiales realistas de 6 y 12 meses, y con 1, 3 y 6 sesiones. |
| Sesión de fuerza | Del principio al resumen: toques por serie, RIR, precarga, doble progresión, alternativas, superseries y circuitos, recargar a mitad, sesión olvidada. |
| Resistencia | Importación GPX/TCX/FIT (corrupta, truncada, sin GPS, con picos, horas repetidas, duplicada), parciales, mejores esfuerzos, récords, predicciones y eventos. |
| Gráficas | Variable, ejes, decimales, tooltip, uno y cero datos, banda de contexto. |
| Sistema visual | Inventario del patrón icono + etiqueta, **medido** en todas las pantallas a 375/390/430 px con texto al 100/125/150 %; tokens, radios y verdes. |
| Estados no felices | 45 rutas × 14 escenarios: usuario nuevo, 1 sesión, 5 años, solo running, menor, ciclo, offline, actualización del SW, recarga con formularios a medias… |
| PWA y accesibilidad | Service worker, metas iOS, áreas seguras, foco, VoiceOver, contraste y tamaños táctiles. |
| Rendimiento | Medido con CPU ×4, mediana de 5, historiales de 3 meses, 1 año y 5 años. |

## 2. Problemas encontrados

Se confirmaron **61 hallazgos** (deduplicados entre áreas). Ninguno es P0: ninguno corrompe ni pierde de forma irrecuperable datos ya guardados.
La ida y vuelta de la copia no pierde ni un campo en 12 stores. Por prioridad:

| Prioridad | Hallazgos |
|---|---|
| P1 | 9 |
| P2 | 16 |
| P3 | 24 |
| P4 | 12 |

Se descartó 1 por ser una decisión documentada: el RIR precargado, que pide REQUISITOS.md. La tabla completa con
evidencia está en la síntesis de la auditoría. Este informe resume lo que importa.

## 3. Los 10 más importantes

1. **Una sesión olvidada abierta se guardaba con 46 h** y una carga ×40, que inflaba la carga, el ACWR, el análisis
   y el informe.
2. **Consejos opuestos en la misma pantalla**: «reduce volumen de espalda» junto a «+1–2 series de espalda».
3. **«Haz una semana de descarga» (Hoy, Análisis) y «sin señales de descarga» (Panel)** a la vez.
4. **«Bien» falsos**: «Tus ejercicios progresan» sin datos o con todo estancado; «Todo evoluciona dentro de lo
   esperado» con una sesión.
5. **A un menor se le daban kcal y «déficit»** en el cruce peso × fuerza.
6. **Un pico del GPS inflaba la distancia**, la «Mayor distancia», el récord estimado y la base de predicción, que
   además salía con confianza alta.
7. **Con texto grande, los chips de RIR medían 14–19 px**: era fácil tocar el RIR equivocado, y con él la doble
   progresión salía equivocada.
8. **Un evento enlazado a un objetivo borrado ya no se podía guardar**: solo se podía borrar, y con él su resultado.
9. **El ⏱️ de «Tiempos previstos» a 30–44 px de su texto** (el resto a 6 px). La causa era un fallo de sistema que
   también afectaba a botones como «Registrar síntomas» o «Copiar informe» con el texto grande.
10. **«Siguiente pendiente» a veces no movía la página**: el desplazamiento suave se cancelaba o lo arrastraba una
    animación anterior. Se descubrió persiguiendo un fallo intermitente de una prueba, en vez de darlo por «flaky».

## 4. Qué se cambió (12 commits)

| Commit | Bloque |
|---|---|
| 5c9c823 | **Análisis**: una sola decisión por pregunta (volumen, descarga, peso × fuerza), sin «Bien» sin datos, menores sin kcal, recuento de músculos igual a la leyenda del mapa y respeto al objetivo de peso activo. |
| 5a280c4 | **Sistema visual**: regla icono + etiqueta con su guarda automática, y ejes honestos en las gráficas. |
| 5aca599 | **Datos**: evento con objetivo borrado editable, check-in a medias visible y borradores en eventos, marcas y contexto. |
| 9024bae | **Sesión de fuerza**: sesión olvidada, RIR tocable y «Aplicar a la plantilla» segura por defecto. |
| 7171209 | **Resistencia**: picos del GPS, archivos cortados, horas repetidas y duplicados apuntado a mano ↔ importado. |
| a6f9868 | **Accesibilidad**: contraste del texto atenuado y emoji de cabecera que no se separa ni lo lee VoiceOver. |
| ed779f4 | **Rendimiento**: historial de ejercicio por lotes, copia sin clones dobles y restauración con un montaje e indicador. |
| 00d4b47 | **Pruebas estables**: esperar a que se retire el splash tras recargar. |
| 33874ce | **Desplazamiento garantizado** (`ui.scrollPageTo`). |
| 6af4b4f | **Progreso**: baldosas anchas alineadas al inicio. |
| 57cc9bd | **Copias**: una copia dañada se rechaza con un mensaje claro y una importación fallida no pierde el punto de restauración. |
| 9feba3e | **Análisis**: «Estancado» solo cuando lo es para el panel y la sesión. |

## 5. Qué NO se cambió y por qué

- **Dos tareas de rendimiento con 5 años de historial**:
  - perf-2: reutilizar el índice de `stats` entre pantallas.
  - perf-3: montaje diferido de Progreso.

  Darían 100–300 ms, pero tienen riesgo medio: un `data` compartido que alguien mute, y cambiar el contrato de
  `router.settled` del que dependen muchas pruebas. Con 1 o 2 años de datos todo va fluido.
- **El «peso actual» se calcula de dos formas** (79,3 frente a 78,9 kg) y el `stallOf` de Objetivos es propio.
  La diferencia es pequeña y va etiquetada; unificarlo toca Progreso, Objetivos y sus pruebas.
- **El 1RM de ejercicios con peso corporal usa el 100 % del peso.** Cambiarlo alteraría los e1RM históricos, los
  récords y los objetivos: riesgo alto.
- **Parciales en la ficha de la actividad** y la opción «Sustituir» una actividad duplicada: son funciones nuevas,
  no arreglos.
- **El paso del stepper de peso sigue siendo de ±2,5.** Uno de 1 kg empeoraría las máquinas de placas.
- **Unos 20 emoji siguen metidos dentro de cadenas.** Se arreglaron los que se rompían; el resto es una
  refactorización de componentes sin fallo visible.
- **Fases contradictorias simultáneas en el contexto**: el análisis ya elige una de forma determinista y documentada.
- **El SW recarga cuando se activa desde otra ventana.** Es deliberado, para no mezclar versiones. Su impacto
  (perder lo tecleado) lo eliminan los borradores nuevos.
- **El splash no se ha tocado.** Es una decisión del propietario.

## 6. Bugs reales corregidos

Cada uno tiene una prueba que falla sin el arreglo y pasa con él.

- Sesión olvidada guardada con 46 h y carga ×40 (19.810 → 455).
- Chips de RIR de 14–19 px con el texto grande. La causa era una regla `html.text-large .chip` que pisaba el reparto
  de **todas** las filas de chips: también las de RPE y sensación (0–10) y las de las marcas históricas.
- Evento bloqueado al borrar su objetivo enlazado.
- Check-in a medias que desaparecía de Hoy.
- Formularios de eventos, marcas históricas y contexto que perdían lo tecleado al recargar o volver a la app.
- «Aplicar a la plantilla» traía marcado por defecto quitar un ejercicio que solo te saltaste y volver a añadir uno
  borrado.
- Pico de GPS que sumaba 1 km (12,998 → 12,00 km).
- Horas repetidas que restaban km (11,40 → 12,0 km).
- GPX/TCX/FIT truncado importado como completo, ahora con aviso y desmarcado.
- Carrera apuntada a mano + importada no detectada como duplicada.
- Copia sin la sección de ejercicios aceptada: te dejaba con 0 ejercicios para siempre.
- Copia con ids repetidos o no válidos: con ids repetidos se perdía un registro sin avisar; con ids no válidos fallaba
  a mitad con un mensaje técnico en inglés.
- Importación fallida que sustituía el punto de restauración anterior.
- «Siguiente pendiente» que no movía la página.
- Al volver de una sesión desde un historial ampliado se perdían las filas y la posición (regresión que detectó el
  revisor de rendimiento).
- Dos pruebas que fallaban siempre desde el splash: tocaban mientras la pantalla de arranque seguía encima.

## 7. Inconsistencias de datos y de lógica resueltas

- **Volumen por músculo**: una sola decisión (`volumeReview`), que consumen la tarjeta de volumen y los consejos de
  los ejercicios estancados. Ya no se pide «reducir» y «+1–2 series» del mismo músculo.
- **Descarga**: una sola regla (`fatigueState`), la del panel. «Descarga» y «semana más suave» solo aparecen si se
  cumple. Con señales sueltas de fatiga el consejo es «revisa sueño y cansancio».
- **Peso × fuerza**:
  - Ya no dice «come más» y «quizá ganas grasa» a la vez.
  - Ya no da un «Bien, conservas la fuerza» con un tercio de los ejercicios bajando.
  - Con un objetivo de peso activo no propone otro. Si va en contra del objetivo de composición, sale una nota
    neutra, sin kcal.
- **«Estancado»**: solo cuando lo es según `stallEval`, la misma fuente que usan el panel y la sesión. Una pendiente
  plana sin estancamiento sale como «Despacio», y nunca aparece «+1,2 %/sem · Estancado».
- **Recuento de músculos del panel** igual a la leyenda del mapa corporal.
- **Prueba cruzada nueva** (`analysis-consistency.test.mjs`): con el generador realista de 6 y 12 meses, en hombre y
  mujer, adulto y menor, junta todos los textos de Hoy, Panel, Análisis e informe para IA. Comprueba que no coexisten
  los pares contradictorios. Antes fallaba en los 8 casos.

## 8. Mejoras visuales

- **Icono + etiqueta como regla de sistema** (PULIDO §29):
  - el icono nunca se encoge;
  - una etiqueta junto a un icono no se centra por dentro;
  - el emoji en caja fija no escala;
  - la distancia entre icono y texto es la del `gap`.

  Una guarda nueva lo mide con Range en **todas** las pantallas, a 375/390/430 px y con el texto al 100/125/150 %,
  en Chromium y WebKit. Encontró unos 30 casos más además del ⏱️.
- **Baldosas de Progreso alineadas al inicio**, como «Análisis»: los emojis forman columna y ninguna queda cargada a
  un lado cuando su etiqueta parte de línea.
- **Gráficas honestas**:
  - Rango mínimo de eje por gráfica (peso 2,5 % o 2 kg; ritmo 5 % o 20 s; bici 10 % o 3 km/h). El ruido ya no parece
    un cambio grande.
  - «Estable: ±0» ya no aparece con una oscilación visible.
- **Contraste**: el texto atenuado se atenúa con color, no con `opacity` (había 2,07:1). Una guarda nueva lo vigila.

## 9. Mejoras de experiencia de uso

- **Sesión olvidada**: Hoy dice «Sesión sin terminar · Abierta desde el mié 14 oct · Terminar». La hoja propone
  «hasta tu última serie (18:00–19:05)» y lo explica.
- **RIR**: con el texto grande, «Fallo» arriba y 0–5 debajo, a 44 px.
- **«Siguiente pendiente»** siempre llega a su ejercicio.
- **Borradores**: lo que tecleas en eventos, marcas y contexto sobrevive a que iOS descargue la PWA. El borrador de
  un evento nunca incluye su resultado.
- **Check-in a medias**: se puede cerrar con «Listo» (con deshacer) y conserva lo respondido.
- **Importación**:
  - «Descontados 0,99 km de saltos del GPS».
  - «El archivo parece incompleto: termina a los 5,49 km».
  - «Puede ser la misma que «Carrera» del 4 oct (apuntada a mano)».

  Todos estos avisos avisan y desmarcan, sin bloquear.
- **Restaurar una copia** muestra «Restaurando copia…» mientras tarda.
- **Copias dañadas**: el mensaje dice qué pasa en español («La copia está incompleta: falta «Ejercicios».») y no se
  escribe nada.

## 10. Mejoras de rendimiento

Con 5 años de datos, CPU ×4 y mediana de 5:

| Flujo | Antes | Después |
|---|---|---|
| Progreso de un ejercicio (bloqueo máximo) | 558 ms | 155 ms (la lista pinta 30 filas + «Ver más») |
| Exportar copia | 1.028 ms | 465 ms (sin el deepClone doble) |
| Restaurar copia | 2 montajes de Hoy | 1 montaje, con indicador |

`importData` ≈ 4,4 s con 5 años; queda el coste de verificar el punto de restauración, que es su garantía.

## 11. Resultado de las pruebas

| Batería | Al empezar la ronda | Ahora |
|---|---|---|
| Unitarias | 723 | **762/762** |
| E2E Chromium | 309 | **329/329** |
| E2E WebKit | 298 + 11 solo de Chromium | **318/318** + 11 solo de Chromium, 0 fallos |

Cada bloque se cerró con su test que fallaba antes, la revisión adversarial y sus E2E en los dos motores.
`session-long` se pasó 8 veces seguidas en paralelo con carga: 8/8; antes fallaba 1 de cada 6.

## 12. Rendimiento antes y después (arranque)

Arranque de Hoy, CPU ×4, mediana de 5 aperturas, 2 rondas intercaladas. Antes = 8c78473 y después = HEAD.

| Historial | «Hoy listo» antes | «Hoy listo» después | Splash fuera, antes → después |
|---|---|---|---|
| 3 meses | 819 / 850 ms | 816 / 944 ms | 912 / 900 → 913 / 959 ms |
| 1 año | 993 / 982 ms | 983 / 1.066 ms | 1.013 / 996 → 1.001 / 1.080 ms |
| 5 años | 1.895 / 1.730 ms | 1.782 / 1.784 ms | 1.911 / 1.747 → 1.795 / 1.800 ms |

Las diferencias entre rondas (±90 ms) son mayores que las diferencias entre versiones: **el arranque no cambia**.

## 13. Capturas relevantes

Se generan en `test-results/visual/` con la guarda visual: todas las pantallas, a 375/390/430 px, con texto al
100/125/150 %, en Chromium y WebKit. Antes y después del sistema icono + etiqueta: accesos de Progreso, cabeceras de
Objetivos al 150 %, «Registrar síntomas» al 125 %, «Copiar informe» al 150 %. Sesión olvidada y RIR con texto
grande: 375 px al 100/125/150 %.

## 14. Riesgos y deuda técnica

- **Rendimiento con 5 años**: Hoy → Progreso tiene una tarea de ~800 ms (perf-3) y el índice de `stats` no se
  reutiliza (perf-2). Es la primera tarea si se retoma el desarrollo.
- **La sesión olvidada** se decide por «más de 60 min sin registrar nada». Quien deje la sesión abierta a propósito
  entre mañana y tarde verá «Terminar» en Hoy; puede cerrar la hoja y seguir.
- **El descuento de picos del GPS** depende del deporte que trae el archivo. Si cambias carrera ↔ bici en la revisión,
  no se recalcula.
- **Ids de texto vacío**: una copia con algún registro de id `''` (no se conoce ninguna ruta que lo produzca) ya no
  se importaría.
- **Las secciones opcionales del formato 1** se declaran en dos sitios (`store.js` y `backup.js`). Ahora son
  coherentes, pero no son una sola fuente.
- **Una copia de formato 1 anterior a la ronda 5** vacía el ciclo sin avisar. Es anterior a esta ronda y se dejó así
  para no tocar el modo mujer.

## 15. Posibles mejoras futuras (sin ampliar el producto)

1. perf-2 + perf-3, juntas y con `Object.freeze` en desarrollo.
2. Una sola definición de «peso actual» para Análisis y Progreso.
3. Ver en la ficha de una actividad los parciales y mejores tramos que ya se guardan, para poder comprobar un récord.
4. Helper común para «emoji + etiqueta» en los ~20 sitios que quedan.
5. Aviso al restaurar una copia muy antigua sin datos de ciclo.

## Valoración: si Entreno se quedara congelada 3 meses

> «Si Entreno fuese a quedarse congelada durante 3 meses y solo pudiera usarla, ¿hay algo importante que todavía
> arreglaría antes?»

Al terminar los bloques planificados quedaban tres cosas que sí habría arreglado antes de congelar, y se han
arreglado:

- una copia dañada que se aceptaba y te dejaba sin ejercicios;
- una importación fallida que se llevaba el punto de restauración;
- la última contradicción visible del análisis: el mismo ejercicio «progresa» en un sitio y «Estancado» en otro.

**Ahora, no.** Lo que queda es rendimiento con 5 años de historial, deuda interna sin efecto visible y funciones
nuevas. Nada de eso cambia el día a día de entrenar con ella durante tres meses. Los datos están protegidos:

- la ida y vuelta de la copia es exacta;
- hay punto de restauración antes de importar o borrar, y sobrevive a los fallos;
- las copias dañadas se rechazan sin tocar nada;
- los borradores sobreviven a que iOS cierre la app.

Lo que dice la app es coherente entre pantallas y lo vigilan pruebas cruzadas.
