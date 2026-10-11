# Informe · Ronda 8: coherencia, running real y contexto

Objetivo de la ronda: que Entreno sea más **coherente**, no más grande. Base: a20dbe7 · final: 9481143.
Sin migraciones (IndexedDB sigue en v3, formato de copia 2) y sin dependencias nuevas.

## 1. Cambios por bloque

**A · Quick wins visuales**
- A1 Modo foco: en la sesión de fuerza activa la barra de pestañas se convierte en una barra de sesión
  («‹ Hoy» · «En sesión 2/20 series» · «Terminar»), con safe areas. «Hoy» sale sin cerrar la sesión.
- A2 Texto grande: anillo del ciclo, formulario de actividad («Senderismo» entero; unidades bajo el número),
  «Cómo vas» y ~15 desbordes más, por reflujo y apilado (sin reducir fuentes).
- A3 Hoy con un solo botón verde (la acción principal); enlaces y datos en texto normal o secundario.
- A4 Deltas neutros por defecto (`util.deltaTone`); verde o ámbar solo cuando una regla lo justifica.
- A5 Ficha de ejercicio con «Última vez», «Mejor serie», «1RM estimado» y «Tendencia» arriba; 1RM primero en
  Progreso, cambios con 1 decimal y ejes con un rango mínimo razonable.
- A6 Resumen: sin récords no hay casilla «Récords 0»; con récords, una tarjeta destacada.

**B · Coherencia de datos**
- B1 Un solo motor de predicción de carrera (`js/race-predict.js`) para Objetivos, Tiempos previstos, Eventos,
  «Cómo vas», Análisis e informe para IA.
- B2 «Tu semana» en la bienvenida; un perfil nuevo ya no hereda la semana de ejemplo.
- B3 Punto de restauración verificado antes de importar una copia o de «Borrar todo».
- B4 Una sola decisión de progresión (sesión, panel y análisis): subir, mantener y reevaluar, o estancado.

**C · Running real**: parciales y mejores esfuerzos de las carreras importadas, en Récords y en predicciones.

**D · Eventos**: «¿Cómo te fue?», resultado referenciado, comparación objetivo / resultado / predicción previa.

**E · Contexto en las gráficas**: franja discreta con fases y hechos; interruptor «Contexto» por gráfica.

**F · Recuperación**: #/recovery con la evolución de sueño, energía, estrés, agujetas y zonas.

**G · Puesta a punto**: una bajada de carga antes de un evento A/B se interpreta, no se alarma.

**H · Sesiones largas**: terminados plegados, estado claro y salto al siguiente pendiente.

## 2. Fallos reales encontrados y corregidos (todos con prueba que falla antes)

1. Objetivos predecía con su propio Riegel: 10K «actual» 50:23 frente a 55:30 en Tiempos previstos, y la misma
   tarjeta decía «Al alcance» y «Hoy no».
2. Un 10K en 18:20 (error de tecleo) daba por conseguido un objetivo de 45:00.
3. Un perfil nuevo veía «Te toca Día 3 — Cardio» sin haber configurado nada.
4. El panel decía «estancado» y la sesión «Sube a 82,5 kg» a la vez.
5. «Borrar todo» o importar sin ninguna copia previa; y el primer punto de restauración no protegía rutinas,
   semana ni perfil de quien aún no había entrenado.
6. Calendario (WebKit): tras cambiar el plan de un día la vista se quedaba a media página (WebKit cancela un
   desplazamiento suave si se sustituye el contenido).
7. Editar un evento perdía campos nuevos, y «Guardar cambios» pisaba el resultado con el borrador.
8. «Cómo vas» mostraba la predicción de hoy en eventos ya pasados.
9. La predicción previa de un evento podía contar el propio resultado.
10. Importación con solo vueltas: los descansos hacían el tramo más rápido de lo real.
11. Volver a escribir la distancia que ya se ve (6,23 de 6,234 km) borraba los parciales.
12. Un resultado de «Tu contexto» y el tramo de la misma carrera habrían contado dos veces en la predicción.
13. Gráfica de ejercicio: «−1,67 kg» y un eje de 40 a 45 kg que exageraba una bajada pequeña.
14. Resumen: «1 h 10 min» partido en tres líneas a 375 px.
15. Biblioteca: un nombre de una sola palabra larga se salía de la fila con texto grande.
16. Sesión larga: tocar la tarjeta recién terminada antes del salto movía el cursor y la vista.
17. Abrir una sesión activa forzaba un layout síncrono a mitad de montaje (+39 % en la apertura con 1 año).

## 3. El motor único de predicciones

`js/race-predict.js` es la fuente de verdad de cualquier tiempo o ritmo de carrera: actual, en una fecha pasada
o por bloque. Entradas: carreras (completas y sus mejores tramos), resultados de «Tu contexto», parones y volumen
de 6 semanas. Método: los 3 mejores esfuerzos de 12 semanas (≥ 3 km, ritmo 2:30–20:00 /km), Riegel con k ajustado
por volumen en media y maratón, peso por recencia, cercanía de distancia y parones. Salida: estimación central,
rango, confianza, estado, referencias y explicación. API: `predictFor`, `baseOf`, `predictionSeries`,
`predictWindow`, `checkTarget`, `runningSummary`; resultados cacheados por datos y fecha. La presentación cambia
por pantalla; el cálculo no. Pruebas cruzadas (`prediction-coherence`) exigen la misma base en todas.

## 4. Objetivos antes y después

Antes: «actual» = el mejor Riegel (k fijo 1,06) de los últimos 28 días, sin filtro de ritmo, sin resultados de
contexto, sin rango ni confianza; «conseguido» con cualquier carrera escalada, aunque el ritmo fuera imposible.
Después: actual, veredicto, tendencia y punto de partida salen del motor único (misma cifra, rango y confianza
que Tiempos previstos); «conseguido» usa la regla de Récords (`runMarkFor`) y rechaza ritmos imposibles. Bici,
natación y senderismo conservan su Riegel propio (no hay motor de carrera para ellos ni otra pantalla que los
prediga).

## 5. Cómo se guardan los parciales

En el propio registro de la carrera importada, opcional (sin store nuevo):
- `track`: tiempo y distancia acumulada simplificados con error ≤ 1 m, en base 36, sin coordenadas
  (~450–760 bytes por hora con distancia del reloj; 3,5–6 KB con GPS de móvil ruidoso).
- `laps` (si hay ≥ 2) y `bestEfforts` {1k, 5k, 10k, half, marathon} con la huella {km, sec} con la que se
  calcularon. No se guardan si se edita distancia o tiempo en la revisión, si la serie no cuadra o si hay
  demasiadas marcas de tiempo inválidas. Las actividades antiguas no cambian.

## 6. Algoritmo de mejores esfuerzos

Ventana continua más rápida, exacta sobre la interpolación lineal de la serie (dos pasadas O(n)). Tiempo
transcurrido: una pausa dentro del tramo cuenta, así que nunca sale más rápido por parar el reloj. Se rechazan
tramos por debajo de 2:30 /km (picos GPS) y no se inventa precisión (segundos enteros). Sin serie, con vueltas:
solo agregados de vueltas completas, contando descansos y huecos. Una carrera de 4,9 km no tiene 5K.

## 7. Cómo entran en Récords

Una regla única (`stats.runMarkFor`) para Récords, resumen de periodo, «conseguido» de objetivos, informe y
«¿Por qué?»: carrera de X km → completa; más larga con tramo válido → «Parcial dentro de 12,4 km»; si no hay
tramo, ritmo medio como último recurso con «estimado». Los récords siguen siendo derivados (nada se copia).

## 8. Cómo entran en predicciones

Cada carrera ofrece su recorrido completo y sus tramos de ≥ 3 km; cuenta UNA (la de mejor sec/km^1.06; a ritmo
constante gana la completa). Un resultado de «Tu contexto» se compara con la carrera completa para no contar dos
veces. «¿Por qué?» y el informe dicen «mejor tramo de una carrera de 12,4 km».

## 9. «¿Cómo te fue?»

En eventos pasados A/B/C, discreto en la lista y la ficha (y una línea neutra en Hoy para A/B de los últimos 7
días; deja de preguntar a los 60 días). Opciones: vincular actividad (candidatas por fecha ±1 día y distancia),
resultado a mano, «No participé», «Omitir». El evento guarda `outcome`, que apunta al resultado (actividad o
entrada `race_result` de «Tu contexto»); nunca copia la actividad.

## 10. Objetivo, predicción y resultado

Objetivo · Resultado · Diferencia («42 s mejor que el objetivo», tono neutro) · Predicción previa (el motor con
los datos hasta la víspera, y si el resultado cayó dentro del rango). Sin puntuación. Si es récord, lo dice el
sistema de récords existente.

## 11. Contexto en las gráficas

Franja superior: fases como segmentos de un único color neutro (simultáneas unidas; nombres en el globo con
«+N»), hechos como puntos (día: relleno; mes: hueco; estación/año: no se dibujan) y eventos pasados con
resultado. Tocar: «15 sep · Inicio creatina». El globo de un punto añade una línea con la fase o el hecho.
Interruptor «Contexto» recordado por gráfica (encendido en peso, ejercicio y ritmos; apagado en carga y km).

## 12. Recuperación

#/recovery (desde «Cómo vas»): sueño, energía, estrés y agujetas por 4 semanas, 12 semanas o todo; zonas
registradas varias veces con su evolución («Rodilla izq. 6 → 5 → 4 → 2», mejorando/empeorando/estable por una
regla explícita), sin diagnosticar; insights del analista con mínimos de datos y confianza.

## 13. Puesta a punto

Evento A o B en los próximos 28 días + bajada de carga → «Puesta a punto · Compatible con una puesta a punto
antes del 10K del domingo.», neutro, en el panel, el analista y el informe. Sin porcentajes prescritos. Sin evento,
con evento C o pasado: como antes.

## 14–15. Visual y accesibilidad

Barra de sesión, un solo verde en Hoy, deltas neutros, ficha de ejercicio, tarjeta de récords, franja de contexto,
pantalla de recuperación, tarjeta de resultado, sesión plegada. La guarda visual recorre todas las pantallas a
375/390/430 px, con texto al 125 % y 150 %, en Chromium y WebKit, y ahora detecta palabras partidas, valores
montados sobre su unidad y texto que no cabe en un anillo.

## 16. Pruebas nuevas

Unitarias: best-efforts, chart-context, exercise-glance, prediction-coherence, progression-decision,
races-result, records-partials, recovery-logic, session-fold (+ ampliaciones). E2E: chart-context,
deltas-neutral, exercise-glance, focus-bar, import-splits, large-text-rows, prediction-coherence,
progression-decision, race-outcome, records-partials, recovery, restore-point, session-long, taper, today-green,
week-setup (+ guarda visual ampliada).

## 17–19. Resultados (última batería completa sobre 9481143)

- Unitarias: **722/722**.
- E2E Chromium: **303/303**.
- E2E WebKit: **291 pasan, 1 falla, 11 omitidas** (solo Chromium: CDP y gestos táctiles). El fallo era de la
  prueba, no de la app: «#/bodyweight: la gráfica se redibuja al guardar, editar y borrar» esperaba 350 ms fijos
  antes de contar los puntos y, con la máquina cargada, el redibujado aún no había llegado. Pasa sola 3/3; ahora
  espera por condición (los puntos, la fila con el valor nuevo) y pasa 6/6 con seis ejecuciones WebKit simultáneas
  y en Chromium (progress.test 11/11).
- Cada bloque pasó además su batería completa en los dos motores al cerrarlo (A: 234; B: 258; C: 269; D: 280).

## 20. Rendimiento (antes a20dbe7 → después; CPU ×4, mediana de 5, media de 2 rondas intercaladas, ms)

Arranque de Hoy (hoy / listo / tarea más larga):

| Historial | Antes | Después |
|---|---|---|
| 3 meses | 627 / 1136 / 187 | 562 / 1079 / 153 |
| 1 año | 682 / 1410 / 226 | 708 / 1492 / 225 |
| 2 años | 744 / 1707 / 306 | 749 / 1684 / 305 |
| 5 años | 980 / 2450 / 647 | 1002 / 2344 / 585 |

Sesión activa de 12 ejercicios (visible / tarea más larga): 1 año 195/228 → 208/226; 5 años 582/628 → 514/529.
Progreso: 1 año 652 → 717 (+10 %, la tarjeta de objetivos usa ahora el motor único); 5 años 1256 → 1237.
Con 5 años de carreras con parciales (521 carreras, 853 KB) el arranque no cambia de forma apreciable.

## 21–22. Migraciones y copias

Ninguna migración: IndexedDB v3, formato de copia 2. Los campos nuevos son opcionales (`track`, `laps`,
`bestEfforts`, `outcome`, `weekPatterns` vacío) y sobreviven a exportar/importar en ambas direcciones; las copias
antiguas importan igual. El punto de restauración vive en `meta` con ids `~…` y nunca entra en una copia.

## 24. Problemas conocidos

- Progreso a 1 año ~+10 % (por debajo del umbral; se podría pintar la tarjeta de objetivos tras el primer fotograma).
- Con texto al 150 %, una sesión plegada aún necesita desplazar (nombres en 2–3 líneas).
- Picos GPS siguen inflando la distancia TOTAL de una GPX (afecta a la estimación a ritmo medio, no a los tramos).
- Un archivo con > 10 % de marcas de tiempo repetidas no guarda parciales (degrada de forma segura).
- Un evento de tipo «Otro» no tiene predicción. Una versión antigua de la app que edite un evento pierde `outcome`.
- Dos copias guardadas de la misma carrera cuentan dos veces en las predicciones (como antes).
- progress.test.cjs (y otros archivos antiguos) aún tienen esperas fijas cortas; se han quitado las de la prueba que
  falló. Conviene ir sustituyéndolas por condiciones.
- En la sesión, el texto corto «Estancado · revisar» / «Mantén y reevalúa» (la frase completa va en VoiceOver y en
  el panel) para no añadir altura en un iPhone SE.
